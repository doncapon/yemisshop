// src/routes/supplierPayouts.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { SupplierPaymentStatus } from "@prisma/client";

const router = Router();

const isAdmin = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";
const isSupplier = (role?: string) => role === "SUPPLIER";

function asNum(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

type SupplierCtx =
  | {
      ok: true;
      supplierId: string;
      supplier: { id: string; name?: string | null; status?: any; userId?: string | null };
      impersonating: boolean;
    }
  | { ok: false; status: number; error: string };

async function resolveSupplierContext(req: any): Promise<SupplierCtx> {
  const role = req.user?.role;
  const userId = req.user?.id;
  if (!userId) return { ok: false, status: 401, error: "Unauthorized" };

  // ADMIN/SUPER_ADMIN view-as supplier
  if (isAdmin(role)) {
    const supplierId = String(req.query?.supplierId ?? "").trim();
    if (!supplierId) {
      return { ok: false, status: 400, error: "Missing supplierId query param for admin view" };
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, status: true, userId: true },
    });

    if (!supplier) return { ok: false, status: 404, error: "Supplier not found" };

    return { ok: true, supplierId: supplier.id, supplier, impersonating: true };
  }

  // Supplier normal mode
  if (isSupplier(role)) {
    const supplier = await prisma.supplier.findFirst({
      where: { userId },
      select: { id: true, name: true, status: true, userId: true },
    });
    if (!supplier) return { ok: false, status: 403, error: "Supplier profile not found for this user" };

    return { ok: true, supplierId: supplier.id, supplier, impersonating: false };
  }

  return { ok: false, status: 403, error: "Forbidden" };
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

function pickRef(x: { purchaseOrderId?: string | null; orderId?: string | null; paymentId?: string | null }) {
  if (x.purchaseOrderId) return x.purchaseOrderId;
  if (x.orderId) return x.orderId;
  if (x.paymentId) return x.paymentId;
  return "—";
}

/**
 * Core balance calculator:
 * - credits come from allocations that are PAID (released)
 * - debits come from SupplierLedgerEntry rows (refunds / adjustments / withdrawals)
 *
 * IMPORTANT:
 * If you create ledger CREDIT rows on payout release, you MUST NOT also add PAID allocations
 * into credits (or you double-count). This implementation treats ledger credits as manual
 * adjustments ONLY; payout credits come from allocations PAID.
 */
export async function computeSupplierBalance(supplierId: string) {
  // ----------------------------
  // 1) Allocation credits (earned)
  // ----------------------------
  const allocGrouped = await prisma.supplierPaymentAllocation.groupBy({
    by: ["status"],
    where: { supplierId },
    _sum: { amount: true },
  });

  const sumByStatus: Record<string, number> = {};
  for (const g of allocGrouped as any[]) {
    sumByStatus[String(g.status).toUpperCase()] = asNum(g._sum?.amount, 0);
  }

  const pending = sumByStatus["PENDING"] ?? 0;
  const approved = sumByStatus["APPROVED"] ?? 0;
  const held = sumByStatus["HELD"] ?? 0;
  const paidOut = sumByStatus["PAID"] ?? 0;
  const failed = sumByStatus["FAILED"] ?? 0;

  // ----------------------------
  // 2) Ledger adjustments
  // ----------------------------
  const ledgerGrouped = await prisma.supplierLedgerEntry.groupBy({
    by: ["type"],
    where: { supplierId },
    _sum: { amount: true },
  });

  // Explicit known types (you can expand later)
  const debitTypes = new Set([
    "DEBIT",
    "WITHDRAWAL",
    "REFUND_DEBIT",
    "CHARGEBACK_DEBIT",
    "ADJUSTMENT_DEBIT",
    "PENALTY_DEBIT",
  ]);

  // Treat these as "manual credits/adjustments", NOT payout credits (payout credits are allocations PAID)
  const creditTypes = new Set(["CREDIT", "REVERSAL_CREDIT", "ADJUSTMENT_CREDIT"]);

  let ledgerCredits = 0;
  let ledgerDebits = 0;

  for (const g of ledgerGrouped as any[]) {
    const t = String(g.type || "").toUpperCase().trim();
    const amt = asNum(g._sum?.amount, 0);

    if (!amt) continue;

    const isDebit = debitTypes.has(t) || t.endsWith("_DEBIT") || t.includes("WITHDRAW") || t.includes("REFUND");
    const isCredit = creditTypes.has(t) || t.endsWith("_CREDIT") || t.includes("CREDIT") || t.includes("REVERSAL");

    if (isDebit && !isCredit) {
      if (amt > 0) ledgerDebits += amt;
      else ledgerDebits -= Math.abs(amt);
      continue;
    }

    if (isCredit && !isDebit) {
      if (amt > 0) ledgerCredits += amt;
      else ledgerCredits -= Math.abs(amt);
      continue;
    }

    // Fallback for unknown types:
    if (amt > 0) ledgerCredits += amt;
    else ledgerDebits += Math.abs(amt);
  }

  // ----------------------------
  // 3) Net computation
  // ----------------------------
  // Intent:
  // - "earned credits" = allocations released (paidOut)
  // - plus any explicit ledger credits (manual adjustments/reversals)
  // - minus ledger debits (refunds/withdrawals/etc)
  const credits = paidOut + ledgerCredits;
  const debits = ledgerDebits;

  const net = credits - debits;
  const availableBalance = Math.max(0, net);
  const outstandingDebt = Math.max(0, -net);

  return {
    currency: "NGN",
    credits,
    debits,
    net,
    availableBalance,
    outstandingDebt,

    // allocation breakdown
    pending,
    approved,
    held,
    paidOut,
    failed,

    // ledger breakdown
    ledgerCredits,
    ledgerDebits,
  };
}

/**
 * GET /api/supplier/payouts/summary
 */
router.get("/summary", requireAuth, async (req: any, res: Response) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    let supplierId: string | null = null;
    if (isAdmin(role) && req.query?.supplierId) supplierId = String(req.query.supplierId);
    else if (isSupplier(role)) supplierId = (await getSupplierForUser(String(userId)))?.id ?? null;

    if (!supplierId) return res.status(403).json({ error: "Supplier access required" });

    const bal = await computeSupplierBalance(supplierId);

    return res.json({
      data: {
        supplierId,
        currency: bal.currency,

        availableBalance: bal.availableBalance,
        outstandingDebt: bal.outstandingDebt,

        credits: bal.credits,
        debits: bal.debits,

        pending: bal.pending,
        approved: bal.approved,
        held: bal.held,
        paidOut: bal.paidOut,
        failed: bal.failed,

        scheduleNote:
          "Credits come from allocations marked PAID. Debits come from refunds/adjustments in SupplierLedgerEntry. availableBalance = max(0, credits - debits).",
      },
    });
  } catch (e: any) {
    console.error("GET /api/supplier/payouts/summary failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to load payout summary" });
  }
});

/**
 * GET /api/supplier/payouts/history?take=20&skip=0
 * Returns allocation rows (credits source).
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

/**
 * GET /api/supplier/payouts/ledger?take=20&skip=0
 * Returns ledger debits/credits (refunds & adjustments).
 */
router.get("/ledger", requireAuth, async (req: any, res: Response) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    let supplierId: string | null = null;
    if (isAdmin(role) && req.query?.supplierId) supplierId = String(req.query.supplierId);
    else if (isSupplier(role)) supplierId = (await getSupplierForUser(String(userId)))?.id ?? null;

    if (!supplierId) return res.status(403).json({ error: "Supplier access required" });

    const { take, skip } = toTakeSkip(req);
    const type = req.query?.type ? String(req.query.type).toUpperCase() : null;

    const where: any = {
      supplierId,
      ...(type ? { type } : {}),
    };

    const [total, rows] = await prisma.$transaction([
      prisma.supplierLedgerEntry.count({ where }),
      prisma.supplierLedgerEntry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        select: {
          id: true,
          type: true,
          amount: true,
          currency: true,
          referenceType: true,
          referenceId: true,
          meta: true,
          createdAt: true,
        },
      }),
    ]);

    return res.json({
      data: {
        total,
        rows: (rows as any[]).map((r) => ({
          id: String(r.id),
          type: String(r.type),
          amount: asNum(r.amount, 0),
          currency: r.currency ?? "NGN",
          referenceType: r.referenceType ?? null,
          referenceId: r.referenceId ?? null,
          createdAt: r.createdAt?.toISOString?.() ?? String(r.createdAt),
          meta: r.meta ?? null,
        })),
      },
    });
  } catch (e: any) {
    console.error("GET /api/supplier/payouts/ledger failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to load ledger" });
  }
});

/**
 * Allocation eligibility for release:
 * After delivery OTP verify, you set allocations -> APPROVED.
 * Keep PENDING for backward compatibility.
 */
function allocEligibleStatuses(): SupplierPaymentStatus[] {
  return [SupplierPaymentStatus.APPROVED, SupplierPaymentStatus.PENDING];
}

function allocReleasedStatus(): SupplierPaymentStatus {
  return SupplierPaymentStatus.PAID;
}

/**
 * ✅ IMPORTANT:
 * The system truth for "delivery OTP verified" is now PurchaseOrderDeliveryOtp.verifiedAt,
 * NOT PurchaseOrder.deliveryOtpVerifiedAt (legacy).
 */
async function getDeliveryOtpVerifiedAtForPO(tx: any, purchaseOrderId: string): Promise<Date | null> {
  const row = await tx.purchaseOrderDeliveryOtp.findFirst({
    where: { purchaseOrderId, verifiedAt: { not: null } },
    orderBy: { verifiedAt: "desc" },
    select: { verifiedAt: true },
  });
  return row?.verifiedAt ?? null;
}

async function releasePayoutForPOTx(tx: any, purchaseOrderId: string) {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      orderId: true,
      supplierId: true,
      supplierAmount: true,
      status: true,
      payoutStatus: true,
      paidOutAt: true,
    },
  });
  if (!po) throw new Error("PurchaseOrder not found");

  const poStatus = String(po.status || "").toUpperCase();
  if (poStatus !== "DELIVERED") {
    throw new Error("Cannot release payout unless PO is DELIVERED");
  }

  // ✅ must have verified OTP (from normalized table)
  const verifiedAt = await getDeliveryOtpVerifiedAtForPO(tx, po.id);
  if (!verifiedAt) {
    const err: any = new Error("Payout not allowed until delivery OTP is verified");
    err.status = 409;
    throw err;
  }

  // ✅ block payout unless supplier is payout-ready
  await assertSupplierPayoutReadyTx(tx, po.supplierId);

  // ✅ idempotent: if already marked as released/paid, return ok
  const payoutStatus = String(po.payoutStatus || "").toUpperCase();
  if (po.paidOutAt || ["RELEASED", "PAID"].includes(payoutStatus)) {
    return { ok: true, alreadyReleased: true };
  }

  const payment = await tx.payment.findFirst({
    where: { orderId: po.orderId, status: "PAID" as any },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!payment) throw new Error("No PAID payment found for this order");

  const alloc = await tx.supplierPaymentAllocation.findFirst({
    where: {
      paymentId: payment.id,
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      status: { in: allocEligibleStatuses() },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, amount: true, status: true, releasedAt: true },
  });

  /**
   * 🔒 Do NOT "pretend released" if there is no allocation to pay.
   * This was the main bug causing "payout released" in UI but balance never changing.
   */
  if (!alloc) {
    const alreadyPaid = await tx.supplierPaymentAllocation.findFirst({
      where: {
        paymentId: payment.id,
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        status: SupplierPaymentStatus.PAID,
      },
      select: { id: true, releasedAt: true },
    });

    if (alreadyPaid?.id) {
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          payoutStatus: "RELEASED",
          ...(po.paidOutAt ? {} : { paidOutAt: alreadyPaid.releasedAt ?? new Date() }),
        } as any,
      });
      return { ok: true, alreadyReleased: true };
    }

    const err: any = new Error("No eligible allocation found to release for this PO");
    err.status = 409;
    throw err;
  }

  await tx.supplierPaymentAllocation.update({
    where: { id: alloc.id },
    data: {
      status: allocReleasedStatus(), // PAID
      releasedAt: new Date(),
    } as any,
  });

  /**
   * ✅ IMPORTANT:
   * We intentionally do NOT create a ledger CREDIT here to avoid double counting:
   * - computeSupplierBalance already counts allocations with status PAID as credits.
   * - If you also create a ledger CREDIT for the same amount, credits will be doubled.
   *
   * If you want an audit trail, keep it in allocation.meta or paymentEvent, not ledger credits.
   */

  await tx.purchaseOrder.update({
    where: { id: po.id },
    data: { payoutStatus: "RELEASED", paidOutAt: new Date() } as any,
  });

  return { ok: true };
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
    throw new Error("Supplier is not payout-ready (missing bank details or payouts disabled).");
  }
}

/**
 * POST /api/supplier/payouts/purchase-orders/:poId/release
 */
router.post("/purchase-orders/:poId/release", requireAuth, async (req: any, res) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    const poId = String(req.params.poId);

    // suppliers only here; admin has separate admin routes
    if (isAdmin(req.user?.role)) {
      return res.status(403).json({ error: "Read-only supplier view. Admin payout actions must use admin routes." });
    }

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!isSupplier(role) && !isAdmin(role)) return res.status(403).json({ error: "Forbidden" });

    let supplierId: string | null = null;
    if (isAdmin(role) && req.query.supplierId) supplierId = String(req.query.supplierId);
    else {
      const s = await getSupplierForUser(userId);
      supplierId = s?.id ?? null;
    }
    if (!supplierId) return res.status(403).json({ error: "Supplier access required" });

    const out = await prisma.$transaction(async (tx: any) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: poId },
        select: { id: true, supplierId: true, orderId: true },
      });
      if (!po) {
        const err: any = new Error("PurchaseOrder not found");
        err.status = 404;
        throw err;
      }

      // Suppliers can only release their own PO
      if (isSupplier(role) && String(po.supplierId) !== String(supplierId)) {
        const err: any = new Error("Forbidden");
        err.status = 403;
        throw err;
      }

      return releasePayoutForPOTx(tx, poId);
    });

    return res.json({ ok: true, data: out });
  } catch (e: any) {
    const status = e?.status ? Number(e.status) : 500;
    const msg = e?.message || "Failed to release payout";
    return res.status(status).json({ error: msg });
  }
});

export default router;
