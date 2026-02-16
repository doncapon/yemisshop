// api/src/routes/disputes.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyMany } from "../services/notifications.service.js";
import { NotificationType } from "@prisma/client";

const router = Router();

const isAdmin = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";

async function getAdminUserIds() {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } as any },
    select: { id: true },
  });
  return admins.map((a: { id: any; }) => a.id);
}

router.get("/mine", requireAuth, async (req: any, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const rows = await prisma.disputeCase.findMany({
    where: { customerId: userId },
    orderBy: { createdAt: "desc" },
    include: {
      supplier: { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, status: true } },
    },
  });

  return res.json({ data: rows });
});

router.post("/", requireAuth, async (req: any, res) => {
  const userId = req.user?.id;
  const role = String(req.user?.role || "").toUpperCase();

  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (role !== "SHOPPER" && !isAdmin(role)) return res.status(403).json({ error: "Forbidden" });

  const orderId = String(req.body?.orderId || "").trim();
  const subject = String(req.body?.subject || "").trim();
  const message = String(req.body?.message || "").trim() || null;
  const evidenceUrls = req.body?.evidenceUrls ?? null;
  const purchaseOrderId = req.body?.purchaseOrderId ? String(req.body.purchaseOrderId).trim() : null;

  if (!orderId) return res.status(400).json({ error: "orderId is required" });
  if (!subject) return res.status(400).json({ error: "subject is required" });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true },
  });
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (!isAdmin(role) && order.userId !== userId) return res.status(403).json({ error: "Forbidden" });

  let supplierId: string | null = null;
  if (purchaseOrderId) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: { supplierId: true, orderId: true },
    });
    if (!po || po.orderId !== orderId) return res.status(400).json({ error: "Invalid purchaseOrderId" });
    supplierId = po.supplierId;
  }

  const d = await prisma.disputeCase.create({
    data: {
      orderId,
      purchaseOrderId: purchaseOrderId ?? undefined,
      supplierId: supplierId ?? undefined,
      customerId: isAdmin(role) ? (order.userId as string) : userId,
      subject,
      message,
      evidenceUrls: evidenceUrls ?? undefined,
      status: "OPEN" as any,
    },
  });

  // notify admins (and supplier if tied)
  const adminUserIds = await getAdminUserIds();
  await notifyMany(adminUserIds, {
    type:  NotificationType.DISPUTE_OPENED,
    title: "New dispute opened",
    body: `Dispute opened on order ${orderId}: ${subject}`,
    data: { orderId, disputeId: d.id },
  });

  if (supplierId) {
    const s = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { userId: true } });
    if (s?.userId) {
      await notifyMany([s.userId], {
        type: NotificationType.DISPUTE_OPENED,
        title: "Dispute opened",
        body: `A dispute was opened on order ${orderId}.`,
        data: { orderId, disputeId: d.id },
      });
    }
  }

  return res.json({ ok: true, data: d });
});

export default router;
