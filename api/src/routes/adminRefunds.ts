// api/src/routes/adminRefunds.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyMany, notifyUser } from "../services/notifications.service.js";
import { requiredString } from "../lib/http.js";
import { syncProductInStockCacheTx } from "../services/inventory.service.js";
import { recomputeProductStockTx } from "../services/stockRecalc.service.js";

const router = Router();

const isAdmin = (role?: string) =>
  ["ADMIN", "SUPER_ADMIN"].includes(String(role || "").toUpperCase());

function norm(s?: any) {
  return String(s ?? "").trim();
}

function upper(s?: any) {
  return norm(s).toUpperCase();
}

function lower(s?: any) {
  return norm(s).toLowerCase();
}

async function getAdminUserIds() {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } as any },
    select: { id: true },
  });
  return admins.map((a: { id: string }) => a.id);
}

/**
 * GET /api/admin/refunds
 * Query:
 * - q: search by orderId, purchaseOrderId, supplierId, providerReference
 * - status: RefundStatus (optional)
 * - take, skip
 */
router.get("/", requireAuth, async (req: any, res) => {
  if (!isAdmin(req.user?.role)) return res.status(403).json({ error: "Admin only" });

  const q = lower(req.query.q);
  const status = upper(req.query.status); // optional
  const take = Math.min(100, Math.max(1, Number(req.query.take ?? 50)));
  const skip = Math.max(0, Number(req.query.skip ?? 0));

  const where: any = {};
  if (status) where.status = status;

  if (q) {
    where.OR = [
      { orderId: { contains: q, mode: "insensitive" } },
      { purchaseOrderId: { contains: q, mode: "insensitive" } },
      { supplierId: { contains: q, mode: "insensitive" } },
      { providerReference: { contains: q, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.refund.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: {
        order: { select: { id: true, userId: true, status: true, createdAt: true } },
        purchaseOrder: { select: { id: true, status: true, payoutStatus: true, supplierId: true } },
        supplier: { select: { id: true, name: true, userId: true } },
        requestedBy: { select: { id: true, email: true } },
        adminResolvedBy: { select: { id: true, email: true } },
        items: {
          include: {
            orderItem: { select: { id: true, title: true, quantity: true, unitPrice: true } },
          },
        },
        events: { orderBy: { createdAt: "desc" }, take: 8 },
      },
    }),
    prisma.refund.count({ where }),
  ]);

  return res.json({ data: rows, meta: { total, take, skip } });
});

/**
 * PATCH /api/admin/refunds/:id/decision
 * body: { decision: "APPROVE"|"REJECT", note? }
 *
 * Rules:
 * - You can only APPROVE/REJECT from certain states (prevents weird transitions)
 * - Writes RefundEvent
 * - Notifies: customer + supplier + admins (updated)
 */
router.patch("/:id/decision", requireAuth, async (req: any, res) => {
  if (!isAdmin(req.user?.role)) return res.status(403).json({ error: "Admin only" });

  const id = norm(req.params.id);
  const decision = upper(req.body?.decision);
  const note = norm(req.body?.note) || null;

  if (!["APPROVE", "REJECT"].includes(decision)) {
    return res.status(400).json({ error: "Invalid decision" });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          orderId: true,
          purchaseOrderId: true,
          supplierId: true,
          requestedByUserId: true,
        },
      });
      if (!refund) throw new Error("Refund not found");

      // Guard: only allow admin decision from specific statuses
      const allowed = new Set([
        "SUPPLIER_REVIEW",
        "SUPPLIER_ACCEPTED",
        "SUPPLIER_REJECTED",
        "ESCALATED",
        "REQUESTED",
      ]);
      if (!allowed.has(String(refund.status))) {
        throw new Error(`Cannot decide refund from status: ${refund.status}`);
      }

      const nextStatus = decision === "APPROVE" ? ("APPROVED" as any) : ("REJECTED" as any);

      const r2 = await tx.refund.update({
        where: { id },
        data: {
          status: nextStatus,
          adminResolvedAt: new Date(),
          adminResolvedById: req.user?.id ?? null,
          adminDecision: decision,
          adminNote: note ?? undefined,
        },
      });

      await tx.refundEvent.create({
        data: {
          refundId: id,
          type: decision === "APPROVE" ? "ADMIN_APPROVED" : "ADMIN_REJECTED",
          message: note ?? undefined,
          meta: { adminId: req.user?.id, decision },
        },
      });

      return { r2, refund };
    });

    // ---- Notifications (outside tx) ----
    const refundRow = updated.r2;
    const refundMeta = updated.refund;

    // Notify customer
    if (refundMeta.requestedByUserId) {
      await notifyUser(refundMeta.requestedByUserId, {
        type: "REFUND_STATUS_CHANGED",
        title: "Refund updated",
        body:
          decision === "APPROVE"
            ? `Your refund was approved for order ${refundMeta.orderId}.`
            : `Your refund was rejected for order ${refundMeta.orderId}.`,
        data: { refundId: refundMeta.id, orderId: refundMeta.orderId, decision },
      });
    }

    // Notify supplier user (if supplierId + supplier user exists)
    if (refundMeta.supplierId) {
      const supplier = await prisma.supplier.findUnique({
        where: { id: refundMeta.supplierId },
        select: { userId: true, name: true },
      });
      if (supplier?.userId) {
        await notifyUser(supplier.userId, {
          type: "REFUND_STATUS_CHANGED",
          title: "Refund updated",
          body:
            decision === "APPROVE"
              ? `Admin approved a refund on order ${refundMeta.orderId}.`
              : `Admin rejected a refund on order ${refundMeta.orderId}.`,
          data: { refundId: refundMeta.id, orderId: refundMeta.orderId, decision },
        });
      }
    }

    // Notify all admins
    const adminUserIds = await getAdminUserIds();
    await notifyMany(adminUserIds, {
      type: "REFUND_STATUS_CHANGED",
      title: "Refund decision recorded",
      body: `Admin ${decision} for refund on order ${refundMeta.orderId}.`,
      data: { refundId: refundMeta.id, orderId: refundMeta.orderId, decision },
    });

    return res.json({ ok: true, data: refundRow });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to record decision" });
  }
});

/**
 * POST /api/admin/refunds/:id/approve
 * Approves a refund request.
 *
 * Inventory behavior:
 * - restores stock for refunded order items immediately on approval
 * - increments chosen supplier offer qty back
 * - recomputes product stock cache
 *
 * Rules:
 * - only admin
 * - only allow approval from REQUESTED / SUPPLIER_REVIEW / SUPPLIER_ACCEPTED / ESCALATED
 * - if already APPROVED, returns current row
 */
router.post("/:id/approve", requireAuth, async (req: any, res) => {
  if (!isAdmin(req.user?.role)) {
    return res.status(403).json({ error: "Admin only" });
  }

  const id = norm(requiredString(req.params.id));

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          orderId: true,
          purchaseOrderId: true,
          supplierId: true,
          requestedByUserId: true,
        },
      });

      if (!refund) {
        throw new Error("Refund not found");
      }

      const currentStatus = String(refund.status || "").toUpperCase();

      if (currentStatus === "APPROVED") {
        const existing = await tx.refund.findUnique({ where: { id } });
        return { refund: existing, meta: refund, alreadyApproved: true };
      }

      if (
        !["REQUESTED", "SUPPLIER_REVIEW", "SUPPLIER_ACCEPTED", "ESCALATED"].includes(
          currentStatus
        )
      ) {
        throw new Error(`Cannot approve refund from status: ${refund.status}`);
      }

      const refundItems = await tx.refundItem.findMany({
        where: { refundId: id },
        select: {
          id: true,
          qty: true,
          orderItemId: true,
          orderItem: {
            select: {
              id: true,
              orderId: true,
              productId: true,
              variantId: true,
              quantity: true,
              chosenSupplierProductOfferId: true,
              chosenSupplierVariantOfferId: true,
            },
          },
        },
      });

      const approvedRefund = await tx.refund.update({
        where: { id },
        data: {
          status: "APPROVED" as any,
          adminResolvedAt: new Date(),
          adminResolvedById: String(req.user?.id),
          adminDecision: req.body?.adminDecision
            ? String(req.body.adminDecision)
            : "APPROVED",
          adminNote: req.body?.adminNote ? String(req.body.adminNote) : undefined,
        },
      });

      await tx.refundEvent.create({
        data: {
          refundId: id,
          type: "ADMIN_APPROVED",
          message: "Refund approved",
          meta: {
            adminId: req.user?.id,
            adminDecision: req.body?.adminDecision ?? "APPROVED",
            adminNote: req.body?.adminNote ?? null,
          },
        },
      });

      // Reflect refund-requested state on PO if present
      if (refund.purchaseOrderId) {
        try {
          await tx.purchaseOrder.update({
            where: { id: refund.purchaseOrderId },
            data: {
              status: "REFUND_REQUESTED" as any,
            },
          });
        } catch {
          // ignore
        }
      }

      // -----------------------------------
      // RESTORE INVENTORY ON APPROVAL
      // -----------------------------------
      for (const ri of refundItems) {
        const oi = ri.orderItem;
        if (!oi) continue;

        const restoreQty = Math.max(
          0,
          Number(ri.qty ?? oi.quantity ?? 0)
        );

        if (restoreQty <= 0) continue;

        if (oi.chosenSupplierVariantOfferId) {
          const updatedVariantOffer = await tx.supplierVariantOffer.update({
            where: { id: String(oi.chosenSupplierVariantOfferId) },
            data: {
              availableQty: { increment: restoreQty },
              inStock: true,
            },
            select: {
              id: true,
              availableQty: true,
              productId: true,
              variantId: true,
            },
          });

          const variantProductId =
            updatedVariantOffer.productId
              ? String(updatedVariantOffer.productId)
              : oi.productId
                ? String(oi.productId)
                : null;

          if (variantProductId) {
            await recomputeProductStockTx(tx, variantProductId);
            await syncProductInStockCacheTx(tx, variantProductId);
          }
        } else if (oi.chosenSupplierProductOfferId) {
          const updatedBaseOffer = await tx.supplierProductOffer.update({
            where: { id: String(oi.chosenSupplierProductOfferId) },
            data: {
              availableQty: { increment: restoreQty },
              inStock: true,
            },
            select: {
              id: true,
              availableQty: true,
              productId: true,
            },
          });

          const baseProductId =
            updatedBaseOffer.productId
              ? String(updatedBaseOffer.productId)
              : oi.productId
                ? String(oi.productId)
                : null;

          if (baseProductId) {
            await recomputeProductStockTx(tx, baseProductId);
            await syncProductInStockCacheTx(tx, baseProductId);
          }
        } else if (oi.productId) {
          // Fallback if chosen offer IDs are missing
          await recomputeProductStockTx(tx, String(oi.productId));
          await syncProductInStockCacheTx(tx, String(oi.productId));
        }
      }

      return {
        refund: approvedRefund,
        meta: refund,
        alreadyApproved: false,
      };
    });

    const refundMeta = updated.meta;

    // ---- Notifications ----

    // Customer
    if (refundMeta.requestedByUserId) {
      await notifyUser(refundMeta.requestedByUserId, {
        type: "REFUND_STATUS_CHANGED",
        title: "Refund approved",
        body: `Your refund has been approved for order ${refundMeta.orderId}.`,
        data: {
          refundId: refundMeta.id,
          orderId: refundMeta.orderId,
          status: "APPROVED",
        },
      });
    }

    // Supplier
    if (refundMeta.supplierId) {
      const supplier = await prisma.supplier.findUnique({
        where: { id: refundMeta.supplierId },
        select: { userId: true, name: true },
      });

      if (supplier?.userId) {
        await notifyUser(supplier.userId, {
          type: "REFUND_STATUS_CHANGED",
          title: "Refund approved",
          body: `A refund has been approved for order ${refundMeta.orderId}.`,
          data: {
            refundId: refundMeta.id,
            orderId: refundMeta.orderId,
            status: "APPROVED",
          },
        });
      }
    }

    // Admins
    const adminUserIds = await getAdminUserIds();
    await notifyMany(adminUserIds, {
      type: "REFUND_STATUS_CHANGED",
      title: "Refund approved",
      body: `Refund approved for order ${refundMeta.orderId}.`,
      data: {
        refundId: refundMeta.id,
        orderId: refundMeta.orderId,
        status: "APPROVED",
      },
    });

    return res.json({
      ok: true,
      data: updated.refund,
      meta: {
        inventoryRestored: !updated.alreadyApproved,
      },
    });
  } catch (e: any) {
    return res.status(400).json({
      error: e?.message || "Failed to approve refund",
    });
  }
});

export default router;
