import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { PurchaseOrderStatus } from "@prisma/client";

const router = Router();

const isAdmin = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";
const isSupplier = (role?: string) => role === "SUPPLIER";

async function getSupplierForUser(userId: string) {
    return prisma.supplier.findFirst({
        where: { userId },
        select: { id: true },
    });
}

function num(v: any) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function startOfTodayLocal() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function startOfNDaysAgoLocal(days: number) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(0, 0, 0, 0);
    return d;
}

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

/**
 * Resolve supplierId for:
 * - SUPPLIER users (from userId)
 * - ADMIN/SUPER_ADMIN (from query ?supplierId=...)
 */
async function resolveSupplierId(req: any): Promise<string | null> {
    const role = req.user?.role;
    const userId = req.user?.id;
    if (!userId) return null;

    if (isAdmin(role) && req.query?.supplierId) {
        return String(req.query.supplierId);
    }

    if (isSupplier(role)) {
        const s = await getSupplierForUser(userId);
        return s?.id ?? null;
    }

    return null;
}

const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD ?? 3);

/**
 * Compute lifetime store rating without SLA (yet).
 * Uses only data you already have:
 * - delivery rate (DELIVERED / total POs)
 * - cancel rate (CANCELED / total POs)  [treated as supplier-caused for now]
 * - refund rate (Refunds / total POs)
 * With Bayesian smoothing to avoid “1 order = 5 stars”.
 */
async function computeSupplierRatingLifetime(supplierId: string) {
    const [totalPO, deliveredPO, canceledPO, refunds] = await Promise.all([
        prisma.purchaseOrder.count({ where: { supplierId } }),
        prisma.purchaseOrder.count({ where: { supplierId, status: PurchaseOrderStatus.DELIVERED } }),
        prisma.purchaseOrder.count({ where: { supplierId, status: PurchaseOrderStatus.CANCELED } }),
        prisma.refund.count({ where: { supplierId } }),
    ]);

    const n = totalPO;

    const deliveredRate = n > 0 ? deliveredPO / n : 0;
    const cancelRate = n > 0 ? canceledPO / n : 0;
    const refundRate = n > 0 ? refunds / n : 0;

    // component scores (0..5)
    const scoreFulfillment = clamp(deliveredRate * 5, 0, 5);
    const scoreCancels = clamp((1 - cancelRate) * 5, 0, 5);
    const scoreRefunds = clamp((1 - refundRate) * 5, 0, 5);

    // weighted raw rating
    const rawRating =
        0.55 * scoreFulfillment +
        0.25 * scoreCancels +
        0.20 * scoreRefunds;

    // smoothing
    const prior = 4.2;
    const priorWeight = 10;

    const rating =
        n === 0 ? prior : (priorWeight * prior + n * rawRating) / (priorWeight + n);

    return {
        rating: Math.round(rating * 10) / 10,
        meta: {
            totalPO,
            deliveredPO,
            canceledPO,
            refunds,
            rawRating: Math.round(rawRating * 100) / 100,
        },
    };
}

/**
 * GET /api/supplier/dashboard/summary
 * KPIs + balance + rating
 */
router.get("/summary", requireAuth, async (req: any, res) => {
    try {
        const supplierId = await resolveSupplierId(req);
        if (!supplierId) return res.status(403).json({ error: "Supplier access required" });

        // ---------- Live products (distinct productIds with any active offer) ----------
        const [baseOfferProducts, variantOfferProducts] = await Promise.all([
            prisma.supplierProductOffer.findMany({
                where: { supplierId, isActive: true, inStock: true },
                select: { productId: true },
            }),
            prisma.supplierVariantOffer.findMany({
                where: { supplierId, isActive: true, inStock: true },
                select: { productId: true },
            }),
        ]);

        const liveProductIds = new Set<string>();
        for (const r of baseOfferProducts) liveProductIds.add(String(r.productId));
        for (const r of variantOfferProducts) liveProductIds.add(String(r.productId));

        const liveProducts = liveProductIds.size;

        // ---------- Low stock: sum availableQty across offers per productId ----------
        const [baseAgg, variantAgg] = await Promise.all([
            prisma.supplierProductOffer.groupBy({
                by: ["productId"],
                where: { supplierId, isActive: true, inStock: true },
                _sum: { availableQty: true },
            }),
            prisma.supplierVariantOffer.groupBy({
                by: ["productId"],
                where: { supplierId, isActive: true, inStock: true },
                _sum: { availableQty: true },
            }),
        ]);

        const totalsByProduct: Record<string, number> = {};
        for (const r of baseAgg) {
            const pid = String(r.productId);
            totalsByProduct[pid] = (totalsByProduct[pid] ?? 0) + Number(r._sum.availableQty ?? 0);
        }
        for (const r of variantAgg) {
            const pid = String(r.productId);
            totalsByProduct[pid] = (totalsByProduct[pid] ?? 0) + Number(r._sum.availableQty ?? 0);
        }

        let lowStock = 0;
        for (const pid of liveProductIds) {
            const totalAvail = totalsByProduct[pid] ?? 0;
            if (totalAvail <= LOW_STOCK_THRESHOLD) lowStock++;
        }

        // ---------- Pending orders ----------
        const pendingOrders = await prisma.purchaseOrder.count({
            where: {
                supplierId,
                status: { in: ["CREATED", "FUNDED", "CONFIRMED", "PACKED", "SHIPPED"] as any },
            },
        });

        // ---------- Shipped today ----------
        // Use updatedAt because status flips will update updatedAt
        const shippedToday = await prisma.purchaseOrder.count({
            where: {
                supplierId,
                status: "SHIPPED" as any,
                shippedAt: { gte: startOfTodayLocal() },
            },
        });


        // ---------- Balance (ledger credits - debits) ----------
        const ledger = await prisma.supplierLedgerEntry.findMany({
            where: { supplierId },
            select: { type: true, amount: true },
        });

        let balance = 0;
        for (const e of ledger) {
            const amt = Number(e.amount ?? 0);
            if (String(e.type).toUpperCase() === "DEBIT") balance -= amt;
            else balance += amt;
        }

        // ---------- Rating (lifetime) ----------
        const { rating, meta: ratingMeta } = await computeSupplierRatingLifetime(supplierId);

        return res.json({
            data: {
                liveProducts,
                lowStock,
                pendingOrders,
                shippedToday,
                balance,
                rating,
                currency: "NGN",
                ratingMeta, // optional: remove if you don’t want it exposed
            },
        });
    } catch (e: any) {
        console.error("GET /api/supplier/dashboard/summary failed:", e);
        return res.status(500).json({ error: e?.message || "Failed to load supplier dashboard" });
    }
});

/**
 * GET /api/supplier/dashboard/insights
 * Quick insights for supplier portal (last 30 days)
 */
router.get("/insights", requireAuth, async (req: any, res) => {
    try {
        const supplierId = await resolveSupplierId(req);
        if (!supplierId) return res.status(403).json({ error: "Supplier access required" });

        const since = startOfNDaysAgoLocal(30);

        // Pull items and compute revenue in JS (supplier revenue)
        const items = await prisma.orderItem.findMany({
            where: {
                chosenSupplierId: supplierId,
                createdAt: { gte: since },
            },
            select: {
                productId: true,
                title: true,
                quantity: true,
                chosenSupplierUnitPrice: true,
            },
        });

        const byKey = new Map<string, { title: string; revenue: number; units: number }>();

        for (const it of items) {
            const key = String(it.productId ?? it.title ?? "UNKNOWN");
            const title = String(it.title ?? "—");
            const units = num(it.quantity);
            const unit = num(it.chosenSupplierUnitPrice);
            const revenue = unit * units;

            const prev = byKey.get(key) ?? { title, revenue: 0, units: 0 };
            prev.revenue += revenue;
            prev.units += units;
            if (!prev.title || prev.title === "—") prev.title = title;
            byKey.set(key, prev);
        }

        let topProduct: { title: string; revenue: number; units: number } | null = null;
        let mostOrdered: { title: string; units: number } | null = null;

        for (const v of byKey.values()) {
            if (!topProduct || v.revenue > topProduct.revenue) topProduct = { ...v };
            if (!mostOrdered || v.units > mostOrdered.units) mostOrdered = { title: v.title, units: v.units };
        }

        const [poCount, refundCount] = await Promise.all([
            prisma.purchaseOrder.count({
                where: { supplierId, createdAt: { gte: since } },
            }),
            prisma.refund.count({
                where: { supplierId, createdAt: { gte: since } },
            }),
        ]);

        const refundRatePct = poCount > 0 ? (refundCount / poCount) * 100 : 0;

        const pendingPayouts = await prisma.purchaseOrder.count({
            where: {
                supplierId,
                payoutStatus: { in: ["PENDING", "HELD"] as any },
                status: { in: [PurchaseOrderStatus.DELIVERED] }, // delivered but not released/paid out yet
            },
        });

        return res.json({
            data: {
                windowDays: 30,
                topProduct: topProduct
                    ? {
                        title: topProduct.title,
                        revenue: Math.round(topProduct.revenue * 100) / 100,
                        units: topProduct.units,
                    }
                    : null,
                mostOrdered: mostOrdered,
                refundRatePct: Math.round(refundRatePct * 10) / 10,
                refunds: refundCount,
                purchaseOrders: poCount,
                pendingPayouts,
            },
        });
    } catch (e: any) {
        console.error("GET /api/supplier/dashboard/insights failed:", e);
        return res.status(500).json({ error: e?.message || "Failed to load dashboard insights" });
    }
});

export default router;
