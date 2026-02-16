// api/src/routes/refunds.ts
import { Router } from "express";
import { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyMany } from "../services/notifications.service.js";

const router = Router();

const isAdmin = (role?: string) =>
    ["ADMIN", "SUPER_ADMIN"].includes(String(role || "").toUpperCase());

function normRole(r?: string) {
    return String(r || "").toUpperCase();
}

function normStr(v: any) {
    return String(v ?? "").trim();
}

function toDecimal(v: any) {
    const n = Number(v);
    if (!Number.isFinite(n)) return new Prisma.Decimal(0);
    return new Prisma.Decimal(n);
}

function sumOrderItems(orderItems: Array<{ unitPrice: any; quantity: number }>) {
    let itemsAmount = new Prisma.Decimal(0);
    for (const it of orderItems) {
        const price = toDecimal(it.unitPrice);
        const qty = new Prisma.Decimal(Number(it.quantity || 0));
        itemsAmount = itemsAmount.plus(price.mul(qty));
    }
    return itemsAmount;
}

async function getAdminUserIds() {
    const admins = await prisma.user.findMany({
        where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } as any },
        select: { id: true },
    });
    return admins.map((a: { id: string }) => a.id);
}

/** PO status helpers (safe string-based to avoid enum mismatch at runtime) */
function poStatusUpper(v: any) {
    return String(v ?? "").toUpperCase();
}

function canMovePoToRefundRequested(current: any) {
    const s = poStatusUpper(current);

    // Don’t stomp final states
    if (["DELIVERED", "COMPLETED", "CANCELED", "CANCELLED", "REFUNDED"].includes(s)) return false;

    // Already set
    if (s === "REFUND_REQUESTED") return false;

    // Otherwise ok
    return true;
}

/**
 * GET /api/refunds/mine
 * Customer sees all refund cases they requested
 */
router.get("/mine", requireAuth, async (req: any, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const rows = await prisma.refund.findMany({
        where: { requestedByUserId: userId },
        orderBy: { createdAt: "desc" },
        include: {
            supplier: { select: { id: true, name: true } },
            purchaseOrder: { select: { id: true, status: true, payoutStatus: true } },
            events: { orderBy: { createdAt: "desc" }, take: 10 },
            items: {
                include: {
                    orderItem: { select: { id: true, title: true, quantity: true, unitPrice: true } },
                },
            },
        },
    });

    return res.json({ data: rows });
});

/**
 * POST /api/refunds
 * body: { orderId, reason, message?, evidenceUrls?, purchaseOrderId?, orderItemIds?, faultParty? }
 *
 * Notes:
 * - Refund requires purchaseOrderId (schema: String + @@unique([purchaseOrderId])).
 * - If purchaseOrderId omitted, create one Refund per PurchaseOrder in the order.
 */
router.post("/", requireAuth, async (req: any, res) => {
    const actorId = req.user?.id;
    const role = normRole(req.user?.role);

    if (!actorId) return res.status(401).json({ error: "Unauthorized" });
    if (role !== "SHOPPER" && !isAdmin(role)) {
        return res.status(403).json({ error: "Only customers/admin can request refunds" });
    }

    const orderId = normStr(req.body?.orderId);
    const reason = normStr(req.body?.reason);
    const message = normStr(req.body?.message) || null;
    const purchaseOrderId = req.body?.purchaseOrderId ? normStr(req.body.purchaseOrderId) : null;
    const evidenceUrls = Array.isArray(req.body?.evidenceUrls) ? req.body.evidenceUrls : null;
    const faultParty = req.body?.faultParty ? normStr(req.body.faultParty) : null;

    const orderItemIdsFromArray: string[] | null = Array.isArray(req.body?.orderItemIds)
        ? req.body.orderItemIds.map((x: any) => String(x)).filter(Boolean)
        : null;

    const orderItemIdsFromItems: string[] | null = Array.isArray(req.body?.items)
        ? req.body.items
            .map((x: any) => String(x?.orderItemId ?? "").trim())
            .filter(Boolean)
        : null;

    const orderItemIds: string[] | null =
        (orderItemIdsFromArray && orderItemIdsFromArray.length ? orderItemIdsFromArray : null) ||
        (orderItemIdsFromItems && orderItemIdsFromItems.length ? orderItemIdsFromItems : null);

    if (!orderId) return res.status(400).json({ error: "orderId is required" });
    if (!reason) return res.status(400).json({ error: "reason is required" });

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            userId: true,
            status: true,
            total: true,
            tax: true,
            serviceFeeBase: true,
            serviceFeeComms: true,
            serviceFeeGateway: true,
            serviceFeeTotal: true,
        },
    });

    if (!order) return res.status(404).json({ error: "Order not found" });

    // Shopper can only request refund for their own order
    if (!isAdmin(role) && order.userId !== actorId) {
        return res.status(403).json({ error: "Forbidden" });
    }

    // ✅ who should “requestedByUserId” represent?
    // - If admin raises on behalf of customer: store customer id so it shows in /mine
    // - Otherwise store actor id
    const requestedByUserId = isAdmin(role) ? order.userId : actorId;

    try {
        const created = await prisma.$transaction(async (tx) => {
            let pos: Array<{ id: string; supplierId: string; orderId: string }> = [];

            if (purchaseOrderId) {
                const po = await tx.purchaseOrder.findUnique({
                    where: { id: purchaseOrderId },
                    select: { id: true, supplierId: true, orderId: true },
                });
                if (!po || po.orderId !== orderId) throw new Error("Invalid purchaseOrderId");
                pos = [po];
            } else {
                pos = await tx.purchaseOrder.findMany({
                    where: { orderId },
                    select: { id: true, supplierId: true, orderId: true },
                });
            }

            if (!pos.length) {
                throw new Error("No purchase orders found for this order yet.");
            }

            const out: any[] = [];

            for (const po of pos) {
                // unique purchaseOrderId
                const existing = await tx.refund.findUnique({
                    where: { purchaseOrderId: po.id },
                    select: { id: true },
                });
                if (existing) {
                    throw new Error(`Refund already exists for purchase order ${po.id}`);
                }

                // PO items -> orderItemIds
                const poItems = await tx.purchaseOrderItem.findMany({
                    where: { purchaseOrderId: po.id },
                    select: { orderItemId: true },
                });

                const poOrderItemIds = poItems.map((x) => x.orderItemId).filter(Boolean) as string[];

                const targetItemIds =
                    orderItemIds && orderItemIds.length
                        ? poOrderItemIds.filter((id) => orderItemIds.includes(id))
                        : poOrderItemIds;

                if (!targetItemIds.length) {
                    throw new Error(
                        orderItemIds && orderItemIds.length
                            ? "Selected items are not part of this purchase order."
                            : "No items found for this purchase order."
                    );
                }

                const items = await tx.orderItem.findMany({
                    where: { id: { in: targetItemIds } },
                    select: { id: true, unitPrice: true, quantity: true, title: true },
                });

                const itemsAmount = sumOrderItems(items);

                // Policy: default these to 0 (admin can later adjust if you add UI)
                const taxAmount = new Prisma.Decimal(0);
                const serviceFeeBaseAmount = new Prisma.Decimal(0);
                const serviceFeeCommsAmount = new Prisma.Decimal(0);
                const serviceFeeGatewayAmount = new Prisma.Decimal(0);

                const totalAmount = itemsAmount
                    .plus(taxAmount)
                    .plus(serviceFeeBaseAmount)
                    .plus(serviceFeeCommsAmount)
                    .plus(serviceFeeGatewayAmount);

                const refund = await tx.refund.create({
                    data: {
                        orderId,
                        purchaseOrderId: po.id,
                        supplierId: po.supplierId,

                        status: "SUPPLIER_REVIEW" as any,

                        requestedByUserId,
                        requestedAt: new Date(),

                        reason,
                        meta: {
                            message,
                            evidenceUrls,
                        },
                        faultParty: faultParty || undefined,

                        itemsAmount,
                        taxAmount,
                        serviceFeeBaseAmount,
                        serviceFeeCommsAmount,
                        serviceFeeGatewayAmount,
                        totalAmount,

                        provider: null,
                        providerReference: null,
                        providerStatus: null,
                        providerPayload: Prisma.JsonNull,
                    },
                });

                // ✅ Update PurchaseOrder to show supplier “refund requested” (safe)
                const poRow = await tx.purchaseOrder.findUnique({
                    where: { id: po.id },
                    select: { id: true, status: true },
                });

                if (poRow && canMovePoToRefundRequested(poRow.status)) {
                    await tx.purchaseOrder.update({
                        where: { id: po.id },
                        data: { status: "REFUND_REQUESTED" as any },
                    });
                }

                // RefundItems
                for (const it of items) {
                    await tx.refundItem.create({
                        data: {
                            refundId: refund.id,
                            orderItemId: it.id,
                            qty: Number(it.quantity || 0),
                        },
                    });
                }

                // Event trail
                await tx.refundEvent.create({
                    data: {
                        refundId: refund.id,
                        type: "REQUESTED",
                        message: message ?? undefined,
                        meta: {
                            reason,
                            evidenceUrls,
                            purchaseOrderId: po.id,
                            supplierId: po.supplierId,
                            orderItemIds: items.map((i) => i.id),
                        },
                    },
                });

                out.push(refund);
            }

            return out;
        });

        // Notify suppliers + admins
        const supplierIds = Array.from(new Set(created.map((r: any) => r.supplierId).filter(Boolean))) as string[];

        if (supplierIds.length) {
            const supplierUsers = await prisma.supplier.findMany({
                where: { id: { in: supplierIds } },
                select: { userId: true, id: true, name: true },
            });

            await notifyMany(
                supplierUsers.map((s: any) => s.userId).filter(Boolean),
                {
                    type:  NotificationType.REFUND_REQUESTED,
                    title: "New refund request",
                    body: `A customer requested a refund on order ${orderId}.`,
                    data: { orderId, supplierIds, refundIds: created.map((r: any) => r.id) },
                }
            );
        }

        const adminUserIds = await getAdminUserIds();
        await notifyMany(adminUserIds, {
            type:  NotificationType.REFUND_REQUESTED,
            title: "Refund requested",
            body: `Refund requested on order ${orderId}.`,
            data: { orderId, refundIds: created.map((r: any) => r.id) },
        });

        return res.json({ ok: true, data: created });
    } catch (e: any) {
        return res.status(400).json({ error: e?.message || "Refund request failed" });
    }
});

export default router;
