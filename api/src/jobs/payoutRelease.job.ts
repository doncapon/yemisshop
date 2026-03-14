// src/jobs/payoutRelease.job.ts
import { prisma } from "../lib/prisma.js";
import { SupplierPaymentStatus } from "@prisma/client";

function asDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(+d) ? null : d;
}

async function getDeliveryOtpVerifiedAtForPO(tx: any, purchaseOrderId: string): Promise<Date | null> {
  const row = await tx.purchaseOrderDeliveryOtp.findFirst({
    where: {
      purchaseOrderId,
      verifiedAt: { not: null },
    },
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
    throw new Error("Supplier is not payout-ready");
  }
}

export async function releaseDueHeldPayoutsOnce() {
  const now = new Date();

  const dueAllocs = await prisma.supplierPaymentAllocation.findMany({
    where: {
      status: "HELD" as SupplierPaymentStatus,
      holdUntil: { lte: now },
    },
    orderBy: { holdUntil: "asc" },
    select: {
      id: true,
      supplierId: true,
      orderId: true,
      paymentId: true,
      purchaseOrderId: true,
      amount: true,
      holdUntil: true,
      createdAt: true,
    },
  });

  const summary = {
    scanned: dueAllocs.length,
    released: 0,
    skipped: 0,
    failed: 0,
    details: [] as Array<{
      allocationId: string;
      purchaseOrderId: string | null;
      action: "released" | "skipped" | "failed";
      reason?: string;
    }>,
  };

  for (const alloc of dueAllocs) {
    try {
      await prisma.$transaction(async (tx) => {
        if (!alloc.purchaseOrderId) {
          throw new Error("Allocation has no purchaseOrderId");
        }

        const po = await tx.purchaseOrder.findUnique({
          where: { id: alloc.purchaseOrderId },
          select: {
            id: true,
            supplierId: true,
            status: true,
            payoutStatus: true,
            paidOutAt: true,
            payoutHoldUntil: true,
          },
        });

        if (!po) throw new Error("Purchase order not found");

        const poStatus = String(po.status || "").toUpperCase();
        if (poStatus !== "DELIVERED") {
          throw new Error(`PO not delivered (status=${poStatus})`);
        }

        const verifiedAt = await getDeliveryOtpVerifiedAtForPO(tx, po.id);
        if (!verifiedAt) {
          throw new Error("Delivery OTP not verified");
        }

        const latestAlloc = await tx.supplierPaymentAllocation.findUnique({
          where: { id: alloc.id },
          select: {
            id: true,
            status: true,
            releasedAt: true,
            holdUntil: true,
            supplierId: true,
            purchaseOrderId: true,
          },
        });

        if (!latestAlloc) {
          throw new Error("Allocation disappeared");
        }

        if (latestAlloc.status === "PAID") {
          summary.skipped++;
          summary.details.push({
            allocationId: alloc.id,
            purchaseOrderId: alloc.purchaseOrderId,
            action: "skipped",
            reason: "already_paid",
          });
          return;
        }

        if (latestAlloc.status !== "HELD") {
          summary.skipped++;
          summary.details.push({
            allocationId: alloc.id,
            purchaseOrderId: alloc.purchaseOrderId,
            action: "skipped",
            reason: `status_${String(latestAlloc.status).toLowerCase()}`,
          });
          return;
        }

        const latestHoldUntil = asDate(latestAlloc.holdUntil);
        if (latestHoldUntil && latestHoldUntil > now) {
          summary.skipped++;
          summary.details.push({
            allocationId: alloc.id,
            purchaseOrderId: alloc.purchaseOrderId,
            action: "skipped",
            reason: "hold_not_due",
          });
          return;
        }

        if (await hasOpenComplaintsForPO(tx, po.id)) {
          summary.skipped++;
          summary.details.push({
            allocationId: alloc.id,
            purchaseOrderId: alloc.purchaseOrderId,
            action: "skipped",
            reason: "open_complaint_or_refund",
          });
          return;
        }

        await assertSupplierPayoutReadyTx(tx, po.supplierId);

        const releasedAt = new Date();

        await tx.supplierPaymentAllocation.update({
          where: { id: latestAlloc.id },
          data: {
            status: "PAID" as SupplierPaymentStatus,
            releasedAt,
            holdUntil: null,
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

        summary.released++;
        summary.details.push({
          allocationId: alloc.id,
          purchaseOrderId: alloc.purchaseOrderId,
          action: "released",
        });
      });
    } catch (err: any) {
      summary.failed++;
      summary.details.push({
        allocationId: alloc.id,
        purchaseOrderId: alloc.purchaseOrderId,
        action: "failed",
        reason: err?.message || "unknown_error",
      });
    }
  }

  return summary;
}