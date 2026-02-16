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
import { NotificationType } from "@prisma/client";

const router = Router();
const isAdmin = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";

const asInt = (v: any, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function safeUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
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
              type:  NotificationType.SUPPLIER_PAYOUT_RELEASED,
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
      const out = await paySupplierForPurchaseOrder(String(purchaseOrderId), {
        id: req.user?.id,
        role: req.user?.role,
      });

      // ✅ NEW: notifications after payout release
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
          // Supplier: payout released for this PO
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

          // Admins: audit trail
          await notifyAdmins({
            type: NotificationType.SUPPLIER_PAYOUT_RELEASED,
            title: "Payout released for PO",
            body: `Payout released for purchase order ${po.id} (order ${po.orderId}) to supplier ${po.supplier?.name ?? po.supplierId}.`,
            data: {
              purchaseOrderId: po.id,
              orderId: po.orderId,
              supplierId: po.supplierId,
              amount: Number(po.supplierAmount ?? 0),
              triggeredByAdminId: req.user?.id ?? null,
            },
          });
        }
      } catch (notifErr) {
        console.error(
          "adminPayouts: failed to send notifications for PO release:",
          notifErr
        );
      }

      return res.json({ ok: true, data: out });
    } catch (e: any) {
      const status = e?.status || 500;
      return res.status(status).json({ error: e?.message || "Failed to release payout" });
    }
  }
);

export default router;
