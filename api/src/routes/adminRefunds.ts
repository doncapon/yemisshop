// api/src/routes/adminRefunds.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyMany, notifyUser } from "../services/notifications.service.js";

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
    const updated = await prisma.$transaction(async (tx: {
      refund: {
        findUnique: (args: {
          where: { id: string };
          select: {
            id: boolean;
            status: boolean;
            orderId: boolean;
            purchaseOrderId: boolean;
            supplierId: boolean;
            requestedByUserId: boolean;
          };
        }) => any;
        update: (args: {
          where: { id: string };
          data: {
            status: any;
            adminResolvedAt: Date;
            adminResolvedById: any;
            adminDecision: string;
            adminNote: string | undefined;
          };
        }) => any;
      };
      refundEvent: {
        create: (args: {
          data: {
            refundId: string;
            type: string;
            message: string | undefined;
            meta: { adminId: any; decision: string };
          };
        }) => any;
      };
    }) => {
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
 * POST /api/admin/refunds/:id/mark-refunded
 * Marks refund as REFUNDED after you actually process Paystack/manual refund.
 *
 * body (optional):
 * - providerStatus
 * - providerReference
 * - providerPayload
 * - paidAt
 *
 * Rules:
 * - only allow mark-refunded from APPROVED (or already REFUNDED)
 * - writes RefundEvent
 * - optionally updates PurchaseOrder payoutStatus -> REFUNDED
 * - optionally updates Payment status -> REFUNDED
 */
router.post("/:id/mark-refunded", requireAuth, async (req: any, res) => {
  if (!isAdmin(req.user?.role)) return res.status(403).json({ error: "Admin only" });

  const id = norm(req.params.id);

  try {
    const updated = await prisma.$transaction(async (tx: {
      refund: {
        findUnique: (args: {
          where: { id: string };
          select: {
            id: boolean;
            status: boolean;
            orderId: boolean;
            purchaseOrderId: boolean;
            supplierId: boolean;
            requestedByUserId: boolean;
          };
        }) => any;
        update: (args: {
          where: { id: string };
          data: {
            status: any;
            processedAt: Date;
            providerStatus: string | undefined;
            providerReference: string | undefined;
            providerPayload: any;
            paidAt: Date | undefined;
          };
        }) => any;
      };
      refundEvent: {
        create: (args: {
          data: {
            refundId: string;
            type: string;
            message: string;
            meta: { adminId: any; providerStatus: any; providerReference: any };
          };
        }) => any;
      };
      purchaseOrder: {
        update: (args: {
          where: { id: any };
          data: { payoutStatus: any };
        }) => any;
      };
      payment: {
        updateMany: (args: {
          where: { orderId: any };
          data: { status: any; refundedAt: Date };
        }) => any;
      };
    }) => {
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

      const status = String(refund.status);
      if (status !== "APPROVED" && status !== "REFUNDED") {
        throw new Error(`Cannot mark refunded from status: ${refund.status}`);
      }

      const r2 = await tx.refund.update({
        where: { id },
        data: {
          status: "REFUNDED" as any,
          processedAt: new Date(),
          providerStatus: req.body?.providerStatus ? String(req.body.providerStatus) : undefined,
          providerReference: req.body?.providerReference ? String(req.body.providerReference) : undefined,
          providerPayload: req.body?.providerPayload ?? undefined,
          paidAt: req.body?.paidAt ? new Date(String(req.body.paidAt)) : undefined,
        },
      });

      await tx.refundEvent.create({
        data: {
          refundId: id,
          type: "ADMIN_MARK_REFUNDED",
          message: "Marked as refunded",
          meta: {
            adminId: req.user?.id,
            providerStatus: req.body?.providerStatus ?? null,
            providerReference: req.body?.providerReference ?? null,
          },
        },
      });

      // Reflect on PO payoutStatus
      try {
        await tx.purchaseOrder.update({
          where: { id: refund.purchaseOrderId },
          data: { payoutStatus: "REFUNDED" as any },
        });
      } catch {
        // ignore if PO missing (shouldn't happen)
      }

      // Reflect on payment (optional)
      try {
        await tx.payment.updateMany({
          where: { orderId: refund.orderId },
          data: { status: "REFUNDED" as any, refundedAt: new Date() },
        });
      } catch {
        // ignore
      }

      return { r2, refund };
    });

    // ---- Notifications ----
    const refundMeta = updated.refund;

    // Customer
    if (refundMeta.requestedByUserId) {
      await notifyUser(refundMeta.requestedByUserId, {
        type: "REFUND_STATUS_CHANGED",
        title: "Refund completed",
        body: `Your refund has been marked as refunded for order ${refundMeta.orderId}.`,
        data: { refundId: refundMeta.id, orderId: refundMeta.orderId, status: "REFUNDED" },
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
          title: "Refund completed",
          body: `A refund has been marked as refunded for order ${refundMeta.orderId}.`,
          data: { refundId: refundMeta.id, orderId: refundMeta.orderId, status: "REFUNDED" },
        });
      }
    }

    // Admins
    const adminUserIds = await getAdminUserIds();
    await notifyMany(adminUserIds, {
      type: "REFUND_STATUS_CHANGED",
      title: "Refund marked refunded",
      body: `Refund marked REFUNDED for order ${refundMeta.orderId}.`,
      data: { refundId: refundMeta.id, orderId: refundMeta.orderId, status: "REFUNDED" },
    });

    return res.json({ ok: true, data: updated.r2 });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to mark refunded" });
  }
});

export default router;
