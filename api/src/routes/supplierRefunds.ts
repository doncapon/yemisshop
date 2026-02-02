// api/src/routes/supplierRefunds.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyMany, notifyUser } from "../services/notifications.service.js";

const router = Router();

const isSupplier = (role?: string) => String(role || "").toUpperCase() === "SUPPLIER";
const isAdmin = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";

function norm(s?: any) {
  return String(s ?? "").trim();
}
function upper(s?: any) {
  return norm(s).toUpperCase();
}

async function getSupplierForUser(userId: string) {
  return prisma.supplier.findFirst({
    where: { userId },
    select: { id: true, name: true, userId: true },
  });
}

async function getAdminUserIds() {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } as any },
    select: { id: true },
  });
  return admins.map((a: { id: string }) => a.id);
}

function getRefundDelegate(db: any) {
  // try common Prisma model delegate names
  return db.refund || db.refundRequest || db.orderRefund || db.refunds || null;
}

/**
 * Resolve supplierId for this request:
 * - Admin can pass ?supplierId=...
 * - Supplier uses their own supplierId
 */
async function resolveSupplierId(req: any) {
  const role = req.user?.role;
  const userId = req.user?.id;

  if (!userId) return null;

  if (isAdmin(role)) {
    const sid = norm(req.query?.supplierId);
    return sid || null;
  }

  if (isSupplier(role)) {
    const s = await getSupplierForUser(userId);
    return s?.id ?? null;
  }

  return null;
}

/**
 * GET /api/supplier/refunds
 * Supplier sees refunds tied to their supplierId.
 * Admin can view any supplier's refunds via ?supplierId=...
 *
 * Query:
 * - q: search by refundId, orderId, purchaseOrderId, providerReference, reason, supplierNote
 * - status: RefundStatus (optional)
 * - take, skip
 */
router.get("/", requireAuth, async (req: any, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const supplierId = await resolveSupplierId(req);
  if (!supplierId) return res.status(403).json({ error: "Supplier access required" });

  const qRaw = norm(req.query.q);
  const statusRaw = norm(req.query.status);
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 50) || 50));
  const skip = Math.max(0, Number(req.query.skip ?? 0) || 0);

  const Refund = getRefundDelegate(prisma);
  if (!Refund) {
    return res.status(500).json({ error: "Refund model delegate not found on Prisma client." });
  }

  const where: any = { supplierId };

  if (statusRaw) {
    where.status = upper(statusRaw);
  }

  if (qRaw) {
    const q = qRaw;

    // NOTE:
    // - Only some string fields can support `mode: "insensitive"` depending on Prisma/DB.
    // - `contains` without mode is safest cross-DB.
    where.OR = [
      { id: { contains: q } },
      { orderId: { contains: q } },
      { purchaseOrderId: { contains: q } },
      { providerReference: { contains: q } },
      { reason: { contains: q } },
      { supplierNote: { contains: q } },
    ];
  }

  const rows = await Refund.findMany({
    where,
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    take,
    skip,
    include: {
      order: true,
      purchaseOrder: true,
      requestedBy: true,
      items: { include: { orderItem: true } },
      events: true,
    },
  });

  return res.json({
    data: rows,
    meta: { take, skip, q: qRaw || null, status: statusRaw || null, supplierId },
  });
});

/**
 * PATCH /api/supplier/refunds/:id
 * body: { action: "ACCEPT"|"REJECT"|"ESCALATE", note? }
 *
 * Supplier updates workflow fields on Refund:
 * - supplierRespondedAt
 * - supplierResponse (ACCEPT | REJECT | DISPUTE)
 * - supplierNote
 * - status -> SUPPLIER_ACCEPTED | SUPPLIER_REJECTED | ESCALATED
 *
 * Writes RefundEvent + notifies customer + admins.
 */
router.patch("/:id", requireAuth, async (req: any, res) => {
  const userId = req.user?.id;
  const role = req.user?.role;
  const id = norm(req.params.id);

  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!isSupplier(role)) return res.status(403).json({ error: "Supplier only" });

  const s = await getSupplierForUser(userId);
  if (!s?.id) return res.status(403).json({ error: "Supplier not found" });

  const Refund = getRefundDelegate(prisma);
  if (!Refund) {
    return res.status(500).json({ error: "Refund model delegate not found on Prisma client." });
  }

  // refundEvent delegate may not exist in all schemas
  const RefundEvent = (prisma as any).refundEvent || (prisma as any).refundEvents || null;

  const action = upper(req.body?.action);
  const note = norm(req.body?.note) || null;

  if (!["ACCEPT", "REJECT", "ESCALATE"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  try {
    const out = await prisma.$transaction(async (tx: any) => {
      const RefundTx = getRefundDelegate(tx);
      if (!RefundTx) throw new Error("Refund model delegate not found on Prisma tx client.");

      const refund = await RefundTx.findUnique({
        where: { id },
        select: {
          id: true,
          supplierId: true,
          status: true,
          orderId: true,
          purchaseOrderId: true,
          requestedByUserId: true,
          requestedBy: true,
        },
      });

      if (!refund) throw new Error("Refund not found");
      if (refund.supplierId !== s.id) throw new Error("Forbidden");

      const cur = String(refund.status || "");
      if (!["REQUESTED", "SUPPLIER_REVIEW"].includes(cur)) {
        throw new Error(`Cannot act on refund in status ${cur}`);
      }

      let nextStatus: any;
      let supplierResponse: string;

      if (action === "ACCEPT") {
        nextStatus = "SUPPLIER_ACCEPTED";
        supplierResponse = "ACCEPT";
      } else if (action === "REJECT") {
        nextStatus = "SUPPLIER_REJECTED";
        supplierResponse = "REJECT";
      } else {
        nextStatus = "ESCALATED";
        supplierResponse = "DISPUTE";
      }

      const updated = await RefundTx.update({
        where: { id },
        data: {
          status: nextStatus,
          supplierRespondedAt: new Date(),
          supplierResponse,
          supplierNote: note ?? undefined,
        },
      });

      // write event if model exists
      const RefundEventTx = (tx as any).refundEvent || (tx as any).refundEvents || null;
      if (RefundEventTx?.create) {
        await RefundEventTx.create({
          data: {
            refundId: id,
            type:
              action === "ACCEPT"
                ? "SUPPLIER_ACCEPTED"
                : action === "REJECT"
                ? "SUPPLIER_REJECTED"
                : "SUPPLIER_ESCALATED",
            message: note ?? undefined,
            meta: { supplierId: s.id, supplierUserId: userId, action, nextStatus },
          },
        });
      }

      return { updated, refundMeta: refund, nextStatus };
    });

    // Notify admins + customer
    const adminIds = await getAdminUserIds();

    await notifyMany(adminIds, {
      type: "REFUND_UPDATED",
      title: "Supplier responded to refund",
      body: `Supplier ${s.name} marked refund as ${out.nextStatus} for order ${out.refundMeta.orderId}.`,
      data: {
        refundId: out.refundMeta.id,
        orderId: out.refundMeta.orderId,
        purchaseOrderId: out.refundMeta.purchaseOrderId,
        supplierId: s.id,
        status: out.nextStatus,
      },
    });

    if (out.refundMeta.requestedByUserId) {
      await notifyUser(out.refundMeta.requestedByUserId, {
        type: "REFUND_UPDATED",
        title: "Refund update",
        body: `Your refund request for order ${out.refundMeta.orderId} is now ${out.nextStatus}.`,
        data: {
          refundId: out.refundMeta.id,
          orderId: out.refundMeta.orderId,
          purchaseOrderId: out.refundMeta.purchaseOrderId,
          status: out.nextStatus,
          requestedBy: out.refundMeta.requestedBy, // ✅ fix: was out.requestedBy (not in out)
        },
      });
    }

    return res.json({ ok: true, data: out.updated });
  } catch (e: any) {
    const msg = e?.message || "Failed to update refund";
    if (msg === "Forbidden") return res.status(403).json({ error: msg });
    if (msg === "Refund not found") return res.status(404).json({ error: msg });
    if (String(msg).includes("delegate not found")) return res.status(500).json({ error: msg });
    return res.status(400).json({ error: msg });
  }
});

export default router;
