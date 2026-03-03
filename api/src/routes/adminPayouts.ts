// api/src/routes/adminPayouts.ts
import { Router, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { paySupplierForPurchaseOrder } from "../services/payout.service.js";

// ✅ NEW: notifications helpers (same as in orders.ts)
import {
  notifyAdmins,
  notifySupplierBySupplierId,
} from "../services/notifications.service.js";
import { requiredString } from "../lib/http.js";
import { NotificationType, SupplierPaymentStatus } from "@prisma/client";

const router = Router();
const isAdmin = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";

const asInt = (v: any, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function safeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

async function hasOpenComplaintsForPOAdmin(tx: any, purchaseOrderId: string): Promise<boolean> {
  const openRefundRequests = await tx.refundRequest.count({
    where: {
      purchaseOrderId,
      status: {
        notIn: [
          "APPROVED",
          "REJECTED",
          "REFUNDED",
          "CLOSED",
        ] as any,
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
        notIn: [
          "APPROVED",
          "REJECTED",
          "REFUNDED",
          "CLOSED",
        ] as any,
      },
    },
  });

  return openRefundRequests > 0 || openDisputes > 0 || openRefunds > 0;
}


type ReleaseHeldPayoutOptions = {
  /**
   * When true, allow release even if we are still within the hold window
   * (payoutHoldUntil > now). For AUTO/cron you should keep this false.
   */
  allowBeforeHoldWindow?: boolean;

  /**
   * When true, allow release even if there is NO delivery evidence.
   * This is a nuclear admin override; generally avoid using it.
   */
  allowWithoutDeliveryProof?: boolean;
};

// Helper: has we got delivery proof?
async function hasDeliveryProofForPO(tx: any, po: { id: string; deliveredAt?: Date | null }) {
  if (po.deliveredAt) return true;

  // Fallback to OTP verification record
  const row = await tx.purchaseOrderDeliveryOtp.findFirst({
    where: { purchaseOrderId: po.id, verifiedAt: { not: null } },
    orderBy: { verifiedAt: "desc" },
    select: { id: true },
  });

  return !!row;
}

async function releaseHeldPayoutForPO_Tx(
  tx: any,
  purchaseOrderId: string,
  opts: ReleaseHeldPayoutOptions = {}
) {
  const now = new Date();
  const {
    allowBeforeHoldWindow = false,
    allowWithoutDeliveryProof = false,
  } = opts;

  const po = await tx.purchaseOrder.findUnique({
    where: { id: String(purchaseOrderId) },
    select: {
      id: true,
      orderId: true,
      supplierId: true,
      supplierAmount: true,
      status: true,
      payoutStatus: true,
      paidOutAt: true,
      payoutHoldUntil: true,
      deliveredAt: true,
      supplier: { select: { name: true } },
    },
  });

  if (!po) {
    const err: any = new Error("PurchaseOrder not found");
    err.status = 404;
    throw err;
  }

  const payoutStatus = String(po.payoutStatus || "").toUpperCase();

  // ✅ Idempotent: already fully released
  if (payoutStatus === "RELEASED" && po.paidOutAt) {
    return { ok: true, alreadyReleased: true, po };
  }

  // ✅ Require delivery proof (deliveredAt or OTP verified), unless admin uses a "hard override"
  if (!allowWithoutDeliveryProof) {
    const delivered = await hasDeliveryProofForPO(tx, po);
    if (!delivered) {
      const err: any = new Error("Cannot release payout: no delivery proof recorded yet.");
      err.status = 409;
      throw err;
    }
  }

  // ✅ Hold window (14 days) for auto flow
  if (!allowBeforeHoldWindow) {
    if (!po.payoutHoldUntil || po.payoutHoldUntil.getTime() > now.getTime()) {
      const err: any = new Error("Payout is still in hold period; cannot release yet.");
      err.status = 409;
      throw err;
    }
  }

  // ✅ Still block if there are *open* complaints.
  // Admin should CLOSE/RESOLVE disputes/refunds first to unblock.
  if (await hasOpenComplaintsForPOAdmin(tx, po.id)) {
    const err: any = new Error(
      "Payout is blocked due to an open customer complaint or refund."
    );
    err.status = 409;
    throw err;
  }

  const alloc = await tx.supplierPaymentAllocation.findFirst({
    where: {
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      status: SupplierPaymentStatus.HELD,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      amount: true,
      paymentId: true,
      orderId: true,
      holdUntil: true,
    },
  });

  if (!alloc) {
    // Maybe already marked PAID in a previous run; keep idempotent
    const paidAlloc = await tx.supplierPaymentAllocation.findFirst({
      where: {
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        status: SupplierPaymentStatus.PAID,
      },
      select: { id: true, releasedAt: true },
    });

    if (paidAlloc) {
      const updatedPO = await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          payoutStatus: "RELEASED" as any,
          ...(po.paidOutAt ? {} : { paidOutAt: paidAlloc.releasedAt ?? now }),
        },
      });

      return { ok: true, alreadyReleased: true, po: updatedPO };
    }

    const err: any = new Error("No HELD allocation found to release for this PO");
    err.status = 409;
    throw err;
  }

  const releasedAt = now;

  const updatedAlloc = await tx.supplierPaymentAllocation.update({
    where: { id: alloc.id },
    data: {
      status: SupplierPaymentStatus.PAID,
      releasedAt,
    },
  });

  const updatedPO = await tx.purchaseOrder.update({
    where: { id: po.id },
    data: {
      payoutStatus: "RELEASED" as any,
      paidOutAt: releasedAt,
    },
  });

  return { ok: true, allocation: updatedAlloc, po: updatedPO };
}

/**
 * GET /api/admin/payouts/allocations
 * Query:
 * - q: matches allocation.id/paymentId/purchaseOrderId/orderId/supplierId
 * - status: PENDING|PAID|FAILED|... (optional)
 * - supplierId: filter
 * - take, skip
 */
router.get("/allocations", requireAuth, async (req: any, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ error: "Forbidden" });

    const qRaw = String(req.query.q ?? "").trim();
    const statusRaw = safeUpper(req.query.status);
    const supplierId = String(req.query.supplierId ?? "").trim() || null;

    const take = Math.min(200, Math.max(1, asInt(req.query.take, 50)));
    const skip = Math.max(0, asInt(req.query.skip, 0));

    const where: any = {};
    if (supplierId) where.supplierId = supplierId;
    if (statusRaw) where.status = statusRaw;

    if (qRaw) {
      const q = qRaw;
      where.OR = [
        { id: { contains: q } },
        { paymentId: { contains: q } },
        { purchaseOrderId: { contains: q } },
        { supplierId: { contains: q } },
        // if purchaseOrder relation exists and has orderId
        { purchaseOrder: { is: { orderId: { contains: q } } } },
      ];
    }

    const rows = await prisma.supplierPaymentAllocation.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      skip,
      include: {
        supplier: { select: { id: true, name: true } },
        purchaseOrder: {
          select: {
            id: true,
            orderId: true,
            status: true,
            payoutStatus: true,
            paidOutAt: true,
            supplierAmount: true,
            subtotal: true,
          },
        },
        payment: { select: { id: true, status: true, reference: true, createdAt: true } },
      },
    });

    // total count for pagination
    const total = await prisma.supplierPaymentAllocation.count({ where });

    return res.json({
      ok: true,
      data: rows,
      meta: { q: qRaw || null, status: statusRaw || null, supplierId, take, skip, total },
    });
  } catch (e: any) {
    console.error("GET /api/admin/payouts/allocations failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to fetch allocations" });
  }
});

/**
 * POST /api/admin/payouts/allocations/:id/mark-paid
 * Manual override:
 * - sets allocation.status = PAID and releasedAt = now
 * - optional body.createLedger === true will create a ledger CREDIT (guarded from duplicate by referenceId)
 *
 * Body:
 * - createLedger?: boolean
 * - note?: string
 */
router.post("/allocations/:id/mark-paid", requireAuth, async (req: any, res: Response) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ error: "Forbidden" });

    const id = requiredString(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing allocation id" });

    const createLedger = req.body?.createLedger === true;
    const note = String(req.body?.note ?? "").trim() || null;
    const adminId = String(req.user?.id ?? "") || null;

    const out = await prisma.$transaction(
      async (tx: {
        supplierPaymentAllocation: {
          findUnique: (arg0: {
            where: { id: string };
            include: { purchaseOrder: { select: { id: boolean; orderId: boolean } } };
          }) => any;
          update: (arg0: {
            where: { id: string };
            data: { status: any; releasedAt: Date };
          }) => any;
        };
        supplierLedgerEntry: {
          findFirst: (arg0: { where: any; select: { id: boolean } }) => any;
          create: (arg0: {
            data: {
              supplierId: any;
              type: string;
              amount: any; // Decimal passthrough
              currency: string;
              referenceType: string;
              referenceId: any;
              meta: {
                manual: boolean;
                note: string | null;
                adminId: string | null;
                purchaseOrderId: any;
                paymentId: any;
                orderId: any;
              };
            };
          }) => any;
        };
      }) => {
        const alloc = await tx.supplierPaymentAllocation.findUnique({
          where: { id },
          include: {
            purchaseOrder: { select: { id: true, orderId: true } },
          },
        });
        if (!alloc) throw new Error("Allocation not found");

        // idempotent
        const cur = String(alloc.status || "").toUpperCase();
        if (cur === "PAID") {
          return { allocation: alloc, note: "Already PAID" };
        }

        const updated = await tx.supplierPaymentAllocation.update({
          where: { id },
          data: { status: "PAID" as any, releasedAt: new Date() },
        });

        if (createLedger) {
          // Guard: ensure we don't insert duplicate manual credits for same allocation
          const existing = await tx.supplierLedgerEntry.findFirst({
            where: {
              supplierId: updated.supplierId,
              referenceType: "ALLOCATION",
              referenceId: updated.id,
              type: "CREDIT",
            } as any,
            select: { id: true },
          });

          if (!existing) {
            await tx.supplierLedgerEntry.create({
              data: {
                supplierId: updated.supplierId,
                type: "CREDIT",
                amount: updated.amount as any, // Decimal passthrough
                currency: "NGN",
                referenceType: "ALLOCATION",
                referenceId: updated.id,
                meta: {
                  manual: true,
                  note,
                  adminId,
                  purchaseOrderId: updated.purchaseOrderId,
                  paymentId: updated.paymentId,
                  orderId: (alloc as any)?.purchaseOrder?.orderId ?? null,
                },
              },
            });
          }
        }

        // ✅ NEW: notifications – supplier + admins
        try {
          // Supplier notification: payout manually marked paid
          await notifySupplierBySupplierId(
            String(updated.supplierId),
            {
              type: NotificationType.SUPPLIER_PAYOUT_RELEASED,
              title: "Payout released",
              body: `An allocation of ₦${String(updated.amount)} has been marked as PAID by an admin.`,
              data: {
                allocationId: updated.id,
                purchaseOrderId: updated.purchaseOrderId,
                paymentId: updated.paymentId,
                orderId: (alloc as any)?.purchaseOrder?.orderId ?? null,
              },
            },
            tx as any
          );

          // Admin broadcast (other admins)
          await notifyAdmins(
            {
              type: NotificationType.SUPPLIER_PAYOUT_RELEASED,
              title: "Allocation marked as PAID",
              body: `Allocation ${updated.id} was marked PAID (₦${String(
                updated.amount
              )}).`,
              data: {
                allocationId: updated.id,
                supplierId: updated.supplierId,
                purchaseOrderId: updated.purchaseOrderId,
                paymentId: updated.paymentId,
                orderId: (alloc as any)?.purchaseOrder?.orderId ?? null,
                adminId,
              },
            },
            tx as any
          );
        } catch (notifErr) {
          console.error(
            "adminPayouts: failed to send notifications for mark-paid allocation:",
            notifErr
          );
        }

        return { allocation: updated };
      }
    );

    return res.json({ ok: true, data: out });
  } catch (e: any) {
    console.error("POST /api/admin/payouts/allocations/:id/mark-paid failed:", e);
    return res.status(400).json({ error: e?.message || "Failed to mark paid" });
  }
});

/**
 * POST /api/admin/payouts/purchase-orders/:purchaseOrderId/release
 * Uses your existing paySupplierForPurchaseOrder flow
 */
router.post(
  "/purchase-orders/:purchaseOrderId/release",
  requireAuth,
  async (req: any, res: Response) => {
    try {
      if (!isAdmin(req.user?.role)) return res.status(403).json({ error: "Forbidden" });

      const { purchaseOrderId } = req.params;
      const adminId = String(req.user?.id ?? "") || null;

      const result = await prisma.$transaction((tx) =>
        releaseHeldPayoutForPO_Tx(tx, String(purchaseOrderId))
      );

      // Notifications (same as before)
      try {
        const po = await prisma.purchaseOrder.findUnique({
          where: { id: String(purchaseOrderId) },
          select: {
            id: true,
            orderId: true,
            supplierId: true,
            supplierAmount: true,
            supplier: { select: { name: true } },
          },
        });

        if (po && po.supplierId) {
          await notifySupplierBySupplierId(
            String(po.supplierId),
            {
              type: NotificationType.SUPPLIER_PAYOUT_RELEASED,
              title: "Payout released",
              body: `Your payout for purchase order ${po.id} (order ${po.orderId}) has been released.`,
              data: {
                purchaseOrderId: po.id,
                orderId: po.orderId,
                amount: Number(po.supplierAmount ?? 0),
              },
            }
          );

          await notifyAdmins({
            type: NotificationType.SUPPLIER_PAYOUT_RELEASED,
            title: "Payout released for PO",
            body: `Payout released for purchase order ${po.id} (order ${po.orderId}) to supplier ${
              po.supplier?.name ?? po.supplierId
            }.`,
            data: {
              purchaseOrderId: po.id,
              orderId: po.orderId,
              supplierId: po.supplierId,
              amount: Number(po.supplierAmount ?? 0),
              triggeredByAdminId: adminId,
            },
          });
        }
      } catch (notifErr) {
        console.error(
          "adminPayouts: failed to send notifications for PO release:",
          notifErr
        );
      }

      return res.json({ ok: true, data: result });
    } catch (e: any) {
      const status = e?.status || 500;
      return res.status(status).json({ error: e?.message || "Failed to release payout" });
    }
  }
);

// at top of adminPayouts.ts
const CRON_SECRET = process.env.PAYOUT_CRON_SECRET ?? "";

// helper: is this request from our cron?
function isCronRequest(req: any) {
  const header = String(req.headers["x-cron-secret"] ?? "");
  if (!CRON_SECRET) return false;
  return header === CRON_SECRET;
}


/**
 * POST /api/admin/payouts/purchase-orders/auto-release-due
 *
 * Called by cron with header: x-cron-secret: <PAYOUT_CRON_SECRET>
 */
router.post(
  "/purchase-orders/auto-release-due",
  async (req: any, res: Response) => {
    try {
      if (!isCronRequest(req)) {
        return res.status(401).json({ error: "Unauthorized cron" });
      }

      const now = new Date();
      const HOLD_DAYS = 14;

      const cutoff = new Date(now.getTime() - HOLD_DAYS * 24 * 60 * 60 * 1000);

      const result = await prisma.$transaction(async (tx) => {
        // 1) Find POs that:
        // - are DELIVERED
        // - payoutStatus is PENDING or HELD
        // - deliveredAt is at least 14 days ago
        // - have NO open refund/dispute
        const pos = await tx.purchaseOrder.findMany({
          where: {
            status: "DELIVERED",
            payoutStatus: { in: ["PENDING", "HELD"] },
            deliveredAt: { lte: cutoff },
          },
          select: {
            id: true,
            orderId: true,
            supplierId: true,
            deliveredAt: true,
          },
        });

        let releasedCount = 0;

        for (const po of pos) {
          // Check if there are any "open" complaints for this PO
          const hasOpenRefund = await tx.refundRequest.findFirst({
            where: {
              purchaseOrderId: po.id,
              status: {
                in: [
                  "REQUESTED",
                  "SUPPLIER_REVIEW",
                  "SUPPLIER_ACCEPTED",
                  "ESCALATED",
                  "APPROVED",
                ],
              },
            },
            select: { id: true },
          });

          const hasOpenDispute = await tx.disputeCase.findFirst({
            where: {
              purchaseOrderId: po.id,
              status: { in: ["OPEN", "SUPPLIER_RESPONSE", "ESCALATED"] },
            },
            select: { id: true },
          });

          if (hasOpenRefund || hasOpenDispute) {
            // still in complaint window → do NOT release to supplier
            continue;
          }

          // No open complaints → safe to release payout for this PO.
          // You can reuse your existing logic here (e.g. releasePayoutForPOTx)
          await releaseHeldPayoutForPO_Tx(tx, po.id);
          releasedCount++;
        }

        return { releasedCount };
      });

      return res.json({ ok: true, data: result });
    } catch (e: any) {
      console.error("auto-release-due failed:", e);
      return res.status(500).json({ error: e?.message || "Failed to auto-release payouts" });
    }
  }
);

export default router;
