// api/src/routes/supplierPayoutsAction.ts
import { Router, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { SupplierPaymentStatus } from "@prisma/client";
import { paySupplierForPurchaseOrder } from "../services/payout.service.js";

const router = Router();

const isSupplier = (role?: string) => role === "SUPPLIER";
const isAdmin = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";

const PAYOUT_EXECUTION_MODE = String(
  process.env.PAYOUT_EXECUTION_MODE ??
    (String(process.env.NODE_ENV || "").toLowerCase() === "production"
      ? "provider"
      : "mock")
).toLowerCase();

function asNum(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

async function getSupplierForUser(userId: string) {
  return prisma.supplier.findFirst({
    where: { userId },
    select: { id: true, name: true, status: true },
  });
}

async function getDeliveryOtpVerifiedAtForPO(
  tx: any,
  purchaseOrderId: string
): Promise<Date | null> {
  const row = await tx.purchaseOrderDeliveryOtp.findFirst({
    where: { purchaseOrderId, verifiedAt: { not: null } },
    orderBy: { verifiedAt: "desc" },
    select: { verifiedAt: true },
  });
  return row?.verifiedAt ?? null;
}

async function hasOpenComplaintsForPO(tx: any, purchaseOrderId: string): Promise<boolean> {
  const openRefundRequests = await tx.refundRequest.count({
    where: {
      purchaseOrderId,
      status: {
        notIn: ["APPROVED", "REJECTED", "REFUNDED", "CLOSED"] as any,
      },
    },
  });

  const openDisputes = await tx.disputeCase.count({
    where: {
      purchaseOrderId,
      status: {
        notIn: ["RESOLVED", "CLOSED"] as any,
      },
    },
  });

  const openRefunds = await tx.refund.count({
    where: {
      purchaseOrderId,
      status: {
        notIn: ["APPROVED", "REJECTED", "REFUNDED", "CLOSED"] as any,
      },
    },
  });

  return openRefundRequests > 0 || openDisputes > 0 || openRefunds > 0;
}

async function assertSupplierPayoutReadyTx(tx: any, supplierId: string) {
  const s = await tx.supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
      isPayoutEnabled: true,
      accountNumber: true,
      accountName: true,
      bankCode: true,
      bankName: true,
      bankCountry: true,
      bankVerificationStatus: true,
    },
  });

  if (!s) throw new Error("Supplier not found");

  const enabled = s.isPayoutEnabled !== false;
  const accNum = !!(s.accountNumber ?? null);
  const accName = !!(s.accountName ?? null);
  const bank = !!(s.bankCode ?? s.bankName ?? null);
  const country = s.bankCountry == null ? true : !!s.bankCountry;
  const verified = s.bankVerificationStatus === "VERIFIED";

  if (!(enabled && verified && accNum && accName && bank && country)) {
    throw new Error("Supplier is not payout-ready (missing bank details or payouts disabled).");
  }
}

function payoutEligibleStatuses(): SupplierPaymentStatus[] {
  return [
    SupplierPaymentStatus.HELD,
    SupplierPaymentStatus.APPROVED,
    SupplierPaymentStatus.PENDING,
  ];
}

/**
 * DEV / MOCK path:
 * marks allocation PAID and PO RELEASED without calling real provider
 */
async function mockPaySupplierForPurchaseOrderTx(
  tx: any,
  purchaseOrderId: string,
  actor: { id?: string; role?: string }
) {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      orderId: true,
      supplierId: true,
      supplierAmount: true,
      status: true,
      payoutStatus: true,
      paidOutAt: true,
      payoutHoldUntil: true,
    },
  });

  if (!po) {
    const err: any = new Error("PurchaseOrder not found");
    err.status = 404;
    throw err;
  }

  if (String(po.status || "").toUpperCase() !== "DELIVERED") {
    const err: any = new Error("Cannot payout unless purchase order is DELIVERED");
    err.status = 409;
    throw err;
  }

  const verifiedAt = await getDeliveryOtpVerifiedAtForPO(tx, po.id);
  if (!verifiedAt) {
    const err: any = new Error("Payout not allowed until delivery OTP is verified");
    err.status = 409;
    throw err;
  }

  if (await hasOpenComplaintsForPO(tx, po.id)) {
    const err: any = new Error(
      "Order has an open customer complaint/refund or dispute; payout cannot be released yet."
    );
    err.status = 409;
    throw err;
  }

  await assertSupplierPayoutReadyTx(tx, po.supplierId);

  const payoutStatus = String(po.payoutStatus || "").toUpperCase();
  if (po.paidOutAt || payoutStatus === "RELEASED") {
    return {
      ok: true,
      mode: "mock",
      alreadyReleased: true,
      purchaseOrderId: po.id,
      releasedAt: po.paidOutAt ?? null,
    };
  }

  const payment = await tx.payment.findFirst({
    where: { orderId: po.orderId, status: "PAID" as any },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (!payment) {
    const err: any = new Error("No PAID payment found for this order");
    err.status = 409;
    throw err;
  }

  const alloc = await tx.supplierPaymentAllocation.findFirst({
    where: {
      paymentId: payment.id,
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      status: { in: payoutEligibleStatuses() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      amount: true,
      status: true,
      meta: true,
      releasedAt: true,
      holdUntil: true,
    },
  });

  if (!alloc) {
    const paidAlloc = await tx.supplierPaymentAllocation.findFirst({
      where: {
        paymentId: payment.id,
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        status: "PAID" as any,
      },
      select: { id: true, releasedAt: true },
    });

    if (paidAlloc) {
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          payoutStatus: "RELEASED" as any,
          ...(po.paidOutAt ? {} : { paidOutAt: paidAlloc.releasedAt ?? new Date() }),
          payoutHoldUntil: null,
        },
      });

      return {
        ok: true,
        mode: "mock",
        alreadyReleased: true,
        purchaseOrderId: po.id,
        releasedAt: paidAlloc.releasedAt ?? null,
      };
    }

    const err: any = new Error("No eligible allocation found for payout");
    err.status = 409;
    throw err;
  }

  const releasedAt = new Date();

  await tx.supplierPaymentAllocation.update({
    where: { id: alloc.id },
    data: {
      status: "PAID" as any,
      releasedAt,
      holdUntil: null,
      meta: {
        ...(alloc.meta ?? {}),
        payoutMode: "mock",
        payoutExecutionMode: PAYOUT_EXECUTION_MODE,
        releasedByUserId: actor?.id ?? null,
        releasedByRole: actor?.role ?? null,
        releasedAt: releasedAt.toISOString(),
      },
    } as any,
  });

  await tx.purchaseOrder.update({
    where: { id: po.id },
    data: {
      payoutStatus: "RELEASED" as any,
      paidOutAt: releasedAt,
      payoutHoldUntil: null,
    },
  });

  return {
    ok: true,
    mode: "mock",
    purchaseOrderId: po.id,
    allocationId: alloc.id,
    amount: asNum(alloc.amount, 0),
    releasedAt,
  };
}

router.post(
  "/purchase-orders/:purchaseOrderId/release",
  requireAuth,
  async (req: any, res: Response) => {
    try {
      const role = req.user?.role;
      const userId = String(req.user?.id ?? "");
      const purchaseOrderId = String(req.params.purchaseOrderId ?? "");

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!isSupplier(role) && !isAdmin(role)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      let supplierId: string | null = null;

      if (isAdmin(role)) {
        supplierId = String(req.query?.supplierId ?? "").trim() || null;
      } else {
        const supplier = await getSupplierForUser(userId);
        supplierId = supplier?.id ?? null;
      }

      if (!supplierId) {
        return res.status(403).json({ error: "Supplier access required" });
      }

      const po = await prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        select: { id: true, supplierId: true },
      });

      if (!po) {
        return res.status(404).json({ error: "PurchaseOrder not found" });
      }

      if (String(po.supplierId) !== String(supplierId)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // DEV / LOCAL / MOCK path
      if (PAYOUT_EXECUTION_MODE !== "provider") {
        const out = await prisma.$transaction((tx) =>
          mockPaySupplierForPurchaseOrderTx(tx, purchaseOrderId, {
            id: req.user?.id,
            role: req.user?.role,
          })
        );

        return res.json({
          ok: true,
          data: out,
          executionMode: PAYOUT_EXECUTION_MODE,
        });
      }

      // PROD / REAL PROVIDER path
      const out = await paySupplierForPurchaseOrder(purchaseOrderId, {
        id: req.user?.id,
        role: req.user?.role,
      });

      return res.json({
        ok: true,
        data: out,
        executionMode: "provider",
      });
    } catch (e: any) {
      const status = Number(e?.status || 500);
      return res
        .status(status)
        .json({ error: e?.message || "Failed to release payout" });
    }
  }
);

export default router;