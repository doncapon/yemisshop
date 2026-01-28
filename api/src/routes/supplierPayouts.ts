// api/src/routes/supplierPayouts.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const isAdmin = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";
const isSupplier = (role?: string) => role === "SUPPLIER";

function asNum(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function toTakeSkip(req: Request) {
  const takeRaw = asNum((req.query as any).take, 20);
  const skipRaw = asNum((req.query as any).skip, 0);
  const take = Math.min(100, Math.max(1, takeRaw));
  const skip = Math.max(0, skipRaw);
  return { take, skip };
}

async function getSupplierForUser(userId: string) {
  return prisma.supplier.findFirst({
    where: { userId },
    select: { id: true, name: true, status: true },
  });
}

function pickRef(x: {
  purchaseOrderId?: string | null;
  orderId?: string | null;
  paymentId?: string | null;
}) {
  // You can prettify later (e.g. PO number). For now, stable IDs are fine.
  if (x.purchaseOrderId) return x.purchaseOrderId;
  if (x.orderId) return x.orderId;
  if (x.paymentId) return x.paymentId;
  return "—";
}

/**
 * GET /api/supplier/payouts/summary
 * Returns totals for supplier allocations:
 * - held: sum(PENDING)
 * - paidOut: sum(PAID)
 * - availableBalance: (by default) = paidOut (until you implement withdrawals/debits)
 */
router.get("/summary", requireAuth, async (req: any, res: Response) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // supplierId resolution (admin can query any supplier via ?supplierId=)
    let supplierId: string | null = null;
    if (isAdmin(role) && req.query?.supplierId) supplierId = String(req.query.supplierId);
    else if (isSupplier(role)) supplierId = (await getSupplierForUser(String(userId)))?.id ?? null;

    if (!supplierId) return res.status(403).json({ error: "Supplier access required" });

    // group sums by status
    const grouped = await prisma.supplierPaymentAllocation.groupBy({
      by: ["status"],
      where: { supplierId },
      _sum: { amount: true },
    });

    const sumByStatus: Record<string, number> = {};
    for (const g of grouped as any[]) {
      sumByStatus[String(g.status)] = asNum(g._sum?.amount, 0);
    }

    const held = sumByStatus["PENDING"] ?? 0;
    const paidOut = sumByStatus["PAID"] ?? 0;
    const failed = sumByStatus["FAILED"] ?? 0;

    // ✅ Minimal policy:
    // Available = funds that have been marked PAID (released) and are available for withdrawal/offline payout.
    // If later you add withdrawals/debits, subtract them here.
    const availableBalance = paidOut;

    return res.json({
      data: {
        supplierId,
        currency: "NGN",
        availableBalance,
        held,
        paidOut,
        failed,
        scheduleNote:
          "Allocations move from PENDING → PAID when the PO is DELIVERED and payout is released.",
      },
    });
  } catch (e: any) {
    console.error("GET /api/supplier/payouts/summary failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to load payout summary" });
  }
});

/**
 * GET /api/supplier/payouts/history?take=20&skip=0
 * Returns allocation rows (payout history).
 */
router.get("/history", requireAuth, async (req: any, res: Response) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    let supplierId: string | null = null;
    if (isAdmin(role) && req.query?.supplierId) supplierId = String(req.query.supplierId);
    else if (isSupplier(role)) supplierId = (await getSupplierForUser(String(userId)))?.id ?? null;

    if (!supplierId) return res.status(403).json({ error: "Supplier access required" });

    const { take, skip } = toTakeSkip(req);
    const status = req.query?.status ? String(req.query.status).toUpperCase() : null;

    const where: any = {
      supplierId,
      ...(status ? { status } : {}),
    };

    const [total, rows] = await prisma.$transaction([
      prisma.supplierPaymentAllocation.count({ where }),
      prisma.supplierPaymentAllocation.findMany({
        where,
        orderBy: [{ releasedAt: "desc" }, { createdAt: "desc" }],
        take,
        skip,
        select: {
          id: true,
          paymentId: true,
          orderId: true,
          purchaseOrderId: true,
          amount: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          releasedAt: true,
          supplierNameSnapshot: true,
          meta: true,
        },
      }),
    ]);

    const out = (rows as any[]).map((r) => {
      const date = r.releasedAt ?? r.updatedAt ?? r.createdAt;
      return {
        id: String(r.id),
        date: date?.toISOString?.() ?? String(date),
        reference: pickRef({
          purchaseOrderId: r.purchaseOrderId,
          orderId: r.orderId,
          paymentId: r.paymentId,
        }),
        amount: asNum(r.amount, 0),
        status: String(r.status),
        purchaseOrderId: r.purchaseOrderId ?? null,
        orderId: String(r.orderId),
        paymentId: String(r.paymentId),
        supplierName: r.supplierNameSnapshot ?? null,
        meta: r.meta ?? null,
      };
    });

    return res.json({ data: { rows: out, total } });
  } catch (e: any) {
    console.error("GET /api/supplier/payouts/history failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to load payout history" });
  }
});

export default router;
