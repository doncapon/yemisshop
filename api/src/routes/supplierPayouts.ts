// src/routes/supplierPayouts.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { SupplierPaymentStatus } from "@prisma/client";
import { paySupplierForPurchaseOrder } from "../services/payout.service.js";
import { sendMail } from "../lib/email.js";
import { sendOtpWhatsappViaTermii } from "../lib/termii.js";

const router = Router();

const PAYOUT_EXECUTION_MODE = String(
  process.env.PAYOUT_EXECUTION_MODE ??
  (String(process.env.NODE_ENV || "").toLowerCase() === "production"
    ? "provider"
    : "mock")
).toLowerCase();

const isAdmin = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";
const isSupplier = (role?: string) => role === "SUPPLIER";

const PAYOUT_HOLD_DAYS = Number(process.env.PAYOUT_HOLD_DAYS ?? 14);
const COMPLAINT_WINDOW_DAYS = Number(process.env.COMPLAINT_WINDOW_DAYS ?? 5);

function asNum(v: unknown, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round2(n: number) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function grossPayoutAmountFromPO(
  po?:
    | {
      supplierAmount?: number | string | null | { toString(): string };
      shippingFeeChargedToCustomer?: number | string | null | { toString(): string };
    }
    | null
) {
  return round2(
    asNum(po?.supplierAmount, 0) + asNum(po?.shippingFeeChargedToCustomer, 0)
  );
}

function toPagination(req: Request) {
  const q = req.query as Record<string, unknown>;

  const rawPage = asNum(q.page, 0);
  const rawPageSize = asNum(q.pageSize, 0);

  const hasPageStyle = rawPage > 0 || rawPageSize > 0;

  if (hasPageStyle) {
    const pageSize = Math.min(100, Math.max(1, rawPageSize || 20));
    const page = Math.max(1, rawPage || 1);
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    return {
      page,
      pageSize,
      take,
      skip,
      mode: "page" as const,
    };
  }

  const takeRaw = asNum(q.take, 20);
  const skipRaw = asNum(q.skip, 0);
  const take = Math.min(100, Math.max(1, takeRaw));
  const skip = Math.max(0, skipRaw);
  const pageSize = take;
  const page = Math.floor(skip / take) + 1;

  return {
    page,
    pageSize,
    take,
    skip,
    mode: "offset" as const,
  };
}

function buildPaginatedResult<T>(params: {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const { rows, total, page, pageSize } = params;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  return {
    rows,
    total,
    page: safePage,
    pageSize,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPrevPage: safePage > 1,
  };
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
  if (x.purchaseOrderId) return x.purchaseOrderId;
  if (x.orderId) return x.orderId;
  if (x.paymentId) return x.paymentId;
  return "—";
}

function hasScalarField(modelName: string, fieldName: string): boolean {
  try {
    const dmmf =
      (prisma as any)?._dmmf?.datamodel ??
      (prisma as any)?._baseDmmf?.datamodel ??
      (prisma as any)?._engine?.dmmf?.datamodel ??
      null;

    const model = dmmf?.models?.find((m: any) => m.name === modelName);
    if (!model) return false;

    return Boolean(
      model.fields?.some(
        (f: any) => f.name === fieldName && f.kind === "scalar"
      )
    );
  } catch {
    return false;
  }
}

function formatMoney(amount: number | null | undefined, currency = "NGN") {
  const value = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${currency} ${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
  }
}

function toE164Maybe(raw?: string | null) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.startsWith("+")) return s;
  if (s.startsWith("0") && s.length >= 10) return `+234${s.slice(1)}`;
  return s;
}

async function sendSupplierPayoutEmail(args: {
  to: string;
  supplierName?: string | null;
  purchaseOrderId: string;
  orderId: string;
  amount?: number | null;
  currency?: string | null;
  status: "HELD" | "RELEASED";
  holdUntil?: Date | string | null;
}) {
  const supplierName = String(args.supplierName ?? "").trim() || "Supplier";
  const currency = String(args.currency ?? "NGN").trim() || "NGN";
  const amountText = formatMoney(args.amount ?? 0, currency);

  const holdLineHtml =
    args.status === "HELD"
      ? `<p><strong>Payout hold until:</strong> ${args.holdUntil ? new Date(args.holdUntil).toLocaleString() : "—"
      }</p>`
      : "";

  const holdLineText =
    args.status === "HELD"
      ? `Payout hold until: ${args.holdUntil ? new Date(args.holdUntil).toLocaleString() : "—"
      }`
      : null;

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#111">
      <h2 style="margin:0 0 8px 0">
        ${args.status === "HELD" ? "Supplier payout placed on hold" : "Supplier payout released"}
      </h2>
      <p>Hello ${supplierName},</p>
      <p>
        ${args.status === "HELD"
      ? "Your payout has been placed on hold after delivery verification."
      : "Your payout has been released successfully."
    }
      </p>

      <div style="margin:16px 0;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa">
        <p style="margin:0 0 6px 0"><strong>Order ID:</strong> ${args.orderId}</p>
        <p style="margin:0 0 6px 0"><strong>Purchase Order ID:</strong> ${args.purchaseOrderId}</p>
        <p style="margin:0 0 6px 0"><strong>Amount:</strong> ${amountText}</p>
        <p style="margin:0 0 6px 0"><strong>Status:</strong> ${args.status}</p>
        ${holdLineHtml}
      </div>

      <p>Thank you,<br/>DaySpring</p>
    </div>
  `;

  const text = [
    args.status === "HELD"
      ? "Supplier payout placed on hold"
      : "Supplier payout released",
    "",
    `Hello ${supplierName},`,
    "",
    args.status === "HELD"
      ? "Your payout has been placed on hold after delivery verification."
      : "Your payout has been released successfully.",
    "",
    `Order ID: ${args.orderId}`,
    `Purchase Order ID: ${args.purchaseOrderId}`,
    `Amount: ${amountText}`,
    `Status: ${args.status}`,
    holdLineText,
    "",
    "Thank you,",
    "DaySpring",
  ]
    .filter(Boolean)
    .join("\n");

  return sendMail({
    to: args.to,
    subject:
      args.status === "HELD"
        ? `Payout on hold for PO ${args.purchaseOrderId}`
        : `Payout released for PO ${args.purchaseOrderId}`,
    html,
    text,
  });
}

async function sendSupplierPayoutWhatsapp(args: {
  to: string;
  purchaseOrderId: string;
  amount?: number | null;
  currency?: string | null;
  status: "HELD" | "RELEASED";
}) {
  const phone = toE164Maybe(args.to);
  if (!phone) return;

  const currency = String(args.currency ?? "NGN").trim() || "NGN";
  const amountText = formatMoney(args.amount ?? 0, currency);

  await sendOtpWhatsappViaTermii({
    to: phone,
    code: "",
    brand: "DaySpring",
    expiresMinutes: 10,
    purposeLabel:
      args.status === "HELD"
        ? `Payout on hold for ${args.purchaseOrderId} (${amountText})`
        : `Payout released for ${args.purchaseOrderId} (${amountText})`,
  });
}

async function getSupplierNotificationContactsTx(tx: any, supplierId: string) {
  const supplier = await tx.supplier.findUnique({
    where: { id: String(supplierId) },
    select: {
      id: true,
      name: true,
      userId: true,
      contactEmail: true,
      whatsappPhone: true,
    },
  });

  if (!supplier) return null;

  let userEmail: string | null = null;
  let userPhone: string | null = null;

  if (supplier.userId) {
    const user = await tx.user.findUnique({
      where: { id: String(supplier.userId) },
      select: {
        email: true,
        phone: true,
      },
    });

    userEmail = user?.email ?? null;
    userPhone = user?.phone ?? null;
  }

  const email =
    String(supplier.contactEmail ?? "").trim() ||
    String(userEmail ?? "").trim() ||
    null;

  const phone =
    String(supplier.whatsappPhone ?? "").trim() ||
    String(userPhone ?? "").trim() ||
    null;

  return {
    supplierId: String(supplier.id),
    supplierName: String(supplier.name ?? "").trim() || "Supplier",
    email,
    phone,
    contactEmail: String(supplier.contactEmail ?? "").trim() || null,
    whatsappPhone: String(supplier.whatsappPhone ?? "").trim() || null,
    userEmail: String(userEmail ?? "").trim() || null,
    userPhone: String(userPhone ?? "").trim() || null,
  };
}

async function notifySupplierPayoutStatusBestEffort(args: {
  purchaseOrderId: string;
  status: "HELD" | "RELEASED";
}) {
  console.log("[supplier-payout-notify] start", {
    purchaseOrderId: args.purchaseOrderId,
    status: args.status,
  });

  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: String(args.purchaseOrderId) },
      select: {
        id: true,
        orderId: true,
        supplierId: true,
        supplierAmount: true,
        shippingFeeChargedToCustomer: true,
        payoutHoldUntil: true,
      },
    });

    if (!po) {
      console.warn("[supplier-payout-notify] purchase order not found", {
        purchaseOrderId: args.purchaseOrderId,
      });
      return;
    }

    const contacts = await prisma.$transaction(async (tx) => {
      return getSupplierNotificationContactsTx(tx, String(po.supplierId));
    });

    if (!contacts) {
      console.warn("[supplier-payout-notify] supplier contacts not found", {
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
      });
      return;
    }

    const payoutAmount = grossPayoutAmountFromPO(po);

    console.log("[supplier-payout-notify] resolved-contacts", {
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      contactEmail: contacts.contactEmail,
      whatsappPhone: contacts.whatsappPhone,
      fallbackUserEmail: contacts.userEmail,
      fallbackUserPhone: contacts.userPhone,
      chosenEmail: contacts.email,
      chosenPhone: contacts.phone,
      payoutAmount,
    });

    if (contacts.email) {
      try {
        await sendSupplierPayoutEmail({
          to: contacts.email,
          supplierName: contacts.supplierName,
          purchaseOrderId: String(po.id),
          orderId: String(po.orderId),
          amount: payoutAmount,
          currency: "NGN",
          status: args.status,
          holdUntil: po.payoutHoldUntil ?? null,
        });

        console.log("[supplier-payout-notify] email sent", {
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          email: contacts.email,
          status: args.status,
          payoutAmount,
        });
      } catch (e: any) {
        console.error("[supplier-payout-notify] email failed", {
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          email: contacts.email,
          status: args.status,
          payoutAmount,
          message: e?.message,
          stack: e?.stack,
        });
      }
    } else {
      console.warn("[supplier-payout-notify] no email resolved", {
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        contactEmail: contacts.contactEmail,
        fallbackUserEmail: contacts.userEmail,
      });
    }

    if (contacts.phone) {
      try {
        await sendSupplierPayoutWhatsapp({
          to: contacts.phone,
          purchaseOrderId: String(po.id),
          amount: payoutAmount,
          currency: "NGN",
          status: args.status,
        });

        console.log("[supplier-payout-notify] whatsapp sent", {
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          phone: contacts.phone,
          status: args.status,
          payoutAmount,
        });
      } catch (e: any) {
        console.error("[supplier-payout-notify] whatsapp failed", {
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          phone: contacts.phone,
          status: args.status,
          payoutAmount,
          message: e?.message,
          stack: e?.stack,
        });
      }
    } else {
      console.warn("[supplier-payout-notify] no phone resolved", {
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        whatsappPhone: contacts.whatsappPhone,
        fallbackUserPhone: contacts.userPhone,
      });
    }
  } catch (e: any) {
    console.error("[supplier-payout-notify] unexpected failure", {
      purchaseOrderId: args.purchaseOrderId,
      status: args.status,
      message: e?.message,
      stack: e?.stack,
    });
  }
}

/**
 * Core balance calculator:
 * - credits come from allocations that are PAID (released)
 * - debits come from SupplierLedgerEntry rows (refunds / adjustments / withdrawals)
 */
export async function computeSupplierBalance(supplierId: string) {
  const allocations = await prisma.supplierPaymentAllocation.findMany({
    where: { supplierId },
    select: {
      id: true,
      status: true,
      amount: true,
      purchaseOrderId: true,
      purchaseOrder: {
        select: {
          supplierAmount: true,
          shippingFeeChargedToCustomer: true,
        },
      },
    },
  });

  const sumByStatus: Record<string, number> = {};

  for (const row of allocations as any[]) {
    const status = String(row.status || "").toUpperCase();

    const amount =
      row.purchaseOrderId && row.purchaseOrder
        ? grossPayoutAmountFromPO(row.purchaseOrder)
        : asNum(row.amount, 0);

    sumByStatus[status] = round2((sumByStatus[status] || 0) + amount);
  }

  const pending = sumByStatus["PENDING"] ?? 0;
  const approved = sumByStatus["APPROVED"] ?? 0;
  const held = sumByStatus["HELD"] ?? 0;
  const paidOut = sumByStatus["PAID"] ?? 0;
  const failed = sumByStatus["FAILED"] ?? 0;

  const ledgerGrouped = await prisma.supplierLedgerEntry.groupBy({
    by: ["type"],
    where: { supplierId },
    _sum: { amount: true },
  });

  const debitTypes = new Set([
    "DEBIT",
    "WITHDRAWAL",
    "REFUND_DEBIT",
    "CHARGEBACK_DEBIT",
    "ADJUSTMENT_DEBIT",
    "PENALTY_DEBIT",
  ]);

  const creditTypes = new Set([
    "CREDIT",
    "REVERSAL_CREDIT",
    "ADJUSTMENT_CREDIT",
  ]);

  let ledgerCredits = 0;
  let ledgerDebits = 0;

  for (const g of ledgerGrouped as any[]) {
    const t = String(g.type || "").toUpperCase().trim();
    const amt = asNum(g._sum?.amount, 0);

    if (!amt) continue;

    const isDebit =
      debitTypes.has(t) ||
      t.endsWith("_DEBIT") ||
      t.includes("WITHDRAW") ||
      t.includes("REFUND");
    const isCredit =
      creditTypes.has(t) ||
      t.endsWith("_CREDIT") ||
      t.includes("CREDIT") ||
      t.includes("REVERSAL");

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

    if (amt > 0) ledgerCredits += amt;
    else ledgerDebits += Math.abs(amt);
  }

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
    pending,
    approved,
    held,
    paidOut,
    failed,
    ledgerCredits,
    ledgerDebits,
  };
}

async function mockFinalizePayoutForPOTx(
  tx: any,
  purchaseOrderId: string,
  actor?: { id?: string; role?: string }
) {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      orderId: true,
      supplierId: true,
      supplierAmount: true,
      shippingFeeChargedToCustomer: true,
      status: true,
      payoutStatus: true,
      paidOutAt: true,
      payoutHoldUntil: true,
    },
  });

  if (!po) {
    const err: any = new Error("PurchaseOrder not found");
    err.status = 404;
    throw err;
  }

  const poStatus = String(po.status || "").toUpperCase();
  if (poStatus !== "DELIVERED") {
    const err: any = new Error("Cannot payout unless PO is DELIVERED");
    err.status = 409;
    throw err;
  }

  const verifiedAt = await getDeliveryOtpVerifiedAtForPO(tx, po.id);
  if (!verifiedAt) {
    const err: any = new Error("Payout not allowed until delivery OTP is verified");
    err.status = 409;
    throw err;
  }

  if (await hasOpenComplaintsForPO(tx, po.id)) {
    const err: any = new Error(
      "Order has an open customer complaint/refund or dispute; payout cannot be released yet."
    );
    err.status = 409;
    throw err;
  }

  await assertSupplierPayoutReadyTx(tx, po.supplierId);

  const payoutStatus = String(po.payoutStatus || "").toUpperCase();
  const payoutAmount = grossPayoutAmountFromPO(po);

  if (po.paidOutAt || payoutStatus === "RELEASED") {
    return {
      ok: true,
      mode: "mock",
      alreadyReleased: true,
      releasedAt: po.paidOutAt ?? null,
      amount: payoutAmount,
    };
  }

  const payment = await tx.payment.findFirst({
    where: { orderId: po.orderId, status: "PAID" as any },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!payment) {
    const err: any = new Error("No PAID payment found for this order");
    err.status = 409;
    throw err;
  }

  const alloc = await tx.supplierPaymentAllocation.findFirst({
    where: {
      paymentId: payment.id,
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      status: { in: ["HELD", "APPROVED", "PENDING"] as any },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      amount: true,
      meta: true,
      releasedAt: true,
      holdUntil: true,
    },
  });

  if (!alloc) {
    const paidAlloc = await tx.supplierPaymentAllocation.findFirst({
      where: {
        paymentId: payment.id,
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        status: "PAID" as any,
      },
      select: { id: true, releasedAt: true },
    });

    if (paidAlloc) {
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          payoutStatus: "RELEASED" as any,
          ...(po.paidOutAt ? {} : { paidOutAt: paidAlloc.releasedAt ?? new Date() }),
          payoutHoldUntil: null,
        },
      });

      await tx.supplierPaymentAllocation.updateMany({
        where: {
          paymentId: payment.id,
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
        },
        data: {
          amount: payoutAmount,
          status: "PAID" as any,
          releasedAt: paidAlloc.releasedAt ?? new Date(),
        },
      });

      return {
        ok: true,
        mode: "mock",
        alreadyReleased: true,
        releasedAt: paidAlloc.releasedAt ?? null,
        amount: payoutAmount,
      };
    }

    const err: any = new Error("No eligible allocation found for payout");
    err.status = 409;
    throw err;
  }

  const releasedAt = new Date();

  await tx.supplierPaymentAllocation.update({
    where: { id: alloc.id },
    data: {
      amount: payoutAmount,
      status: "PAID" as any,
      releasedAt,
      holdUntil: null,
      meta: {
        ...(alloc.meta ?? {}),
        payoutMode: "mock",
        payoutExecutionMode: PAYOUT_EXECUTION_MODE,
        releasedByUserId: actor?.id ?? null,
        releasedByRole: actor?.role ?? null,
        releasedAt: releasedAt.toISOString(),
      },
    } as any,
  });

  await tx.purchaseOrder.update({
    where: { id: po.id },
    data: {
      payoutStatus: "RELEASED" as any,
      paidOutAt: releasedAt,
      payoutHoldUntil: null,
    },
  });

  return {
    ok: true,
    mode: "mock",
    allocationId: alloc.id,
    amount: payoutAmount,
    releasedAt,
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
    if (isAdmin(role) && req.query?.supplierId) {
      supplierId = String(req.query.supplierId);
    } else if (isSupplier(role)) {
      supplierId = (await getSupplierForUser(String(userId)))?.id ?? null;
    }

    if (!supplierId) {
      return res.status(403).json({ error: "Supplier access required" });
    }

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
 * GET /api/supplier/payouts/history
 */
router.get("/history", requireAuth, async (req: any, res: Response) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    let supplierId: string | null = null;
    if (isAdmin(role) && req.query?.supplierId) {
      supplierId = String(req.query.supplierId);
    } else if (isSupplier(role)) {
      supplierId = (await getSupplierForUser(String(userId)))?.id ?? null;
    }

    if (!supplierId) {
      return res.status(403).json({ error: "Supplier access required" });
    }

    const { take, skip, page, pageSize } = toPagination(req);
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
          purchaseOrder: {
            select: {
              supplierAmount: true,
              shippingFeeChargedToCustomer: true,
            },
          },
        },
      }),
    ]);

    const mappedRows = (rows as any[]).map((r) => {
      const date = r.releasedAt ?? r.updatedAt ?? r.createdAt;

      const payoutAmount =
        r.purchaseOrderId && r.purchaseOrder
          ? grossPayoutAmountFromPO(r.purchaseOrder)
          : asNum(r.amount, 0);

      return {
        id: String(r.id),
        date: date?.toISOString?.() ?? String(date),
        reference: pickRef({
          purchaseOrderId: r.purchaseOrderId,
          orderId: r.orderId,
          paymentId: r.paymentId,
        }),
        amount: payoutAmount,
        status: String(r.status),
        purchaseOrderId: r.purchaseOrderId ?? null,
        orderId: r.orderId ? String(r.orderId) : null,
        paymentId: r.paymentId ? String(r.paymentId) : null,
        supplierName: r.supplierNameSnapshot ?? null,
        meta: r.meta ?? null,
      };
    });

    return res.json({
      data: buildPaginatedResult({
        rows: mappedRows,
        total,
        page,
        pageSize,
      }),
    });
  } catch (e: any) {
    console.error("GET /api/supplier/payouts/history failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to load payout history" });
  }
});

/**
 * GET /api/supplier/payouts/ledger
 */
router.get("/ledger", requireAuth, async (req: any, res: Response) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    let supplierId: string | null = null;
    if (isAdmin(role) && req.query?.supplierId) {
      supplierId = String(req.query.supplierId);
    } else if (isSupplier(role)) {
      supplierId = (await getSupplierForUser(String(userId)))?.id ?? null;
    }

    if (!supplierId) {
      return res.status(403).json({ error: "Supplier access required" });
    }

    const { take, skip, page, pageSize } = toPagination(req);
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

    const mappedRows = (rows as any[]).map((r) => ({
      id: String(r.id),
      type: String(r.type),
      amount: asNum(r.amount, 0),
      currency: r.currency ?? "NGN",
      referenceType: r.referenceType ?? null,
      referenceId: r.referenceId ?? null,
      createdAt: r.createdAt?.toISOString?.() ?? String(r.createdAt),
      meta: r.meta ?? null,
    }));

    return res.json({
      data: buildPaginatedResult({
        rows: mappedRows,
        total,
        page,
        pageSize,
      }),
    });
  } catch (e: any) {
    console.error("GET /api/supplier/payouts/ledger failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to load ledger" });
  }
});

function allocEligibleStatuses(): SupplierPaymentStatus[] {
  return [SupplierPaymentStatus.APPROVED, SupplierPaymentStatus.PENDING];
}

async function getDeliveryOtpVerifiedAtForPO(
  tx: any,
  purchaseOrderId: string
): Promise<Date | null> {
  const row = await tx.purchaseOrderDeliveryOtp.findFirst({
    where: { purchaseOrderId, verifiedAt: { not: null } },
    orderBy: { verifiedAt: "desc" },
    select: { verifiedAt: true },
  });
  return row?.verifiedAt ?? null;
}

async function hasOpenComplaintsForPO(
  tx: any,
  purchaseOrderId: string
): Promise<boolean> {
  const openRefundRequests = await tx.refundRequest.count({
    where: {
      purchaseOrderId,
      status: {
        notIn: ["APPROVED", "REJECTED", "REFUNDED", "CLOSED"] as any,
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
        notIn: ["APPROVED", "REJECTED", "REFUNDED", "CLOSED"] as any,
      },
    },
  });

  return openRefundRequests > 0 || openDisputes > 0 || openRefunds > 0;
}

async function releasePayoutForPOTx(tx: any, purchaseOrderId: string) {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      orderId: true,
      supplierId: true,
      supplierAmount: true,
      shippingFeeChargedToCustomer: true,
      status: true,
      payoutStatus: true,
      paidOutAt: true,
      payoutHoldUntil: true,
    },
  });

  if (!po) throw new Error("PurchaseOrder not found");

  const poStatus = String(po.status || "").toUpperCase();
  if (poStatus !== "DELIVERED") {
    throw new Error("Cannot request payout unless PO is DELIVERED");
  }

  const verifiedAt = await getDeliveryOtpVerifiedAtForPO(tx, po.id);
  if (!verifiedAt) {
    const err: any = new Error("Payout not allowed until delivery OTP is verified");
    err.status = 409;
    throw err;
  }

  if (await hasOpenComplaintsForPO(tx, po.id)) {
    const err: any = new Error(
      "Order has an open customer complaint/refund or dispute; payout cannot be requested yet."
    );
    err.status = 409;
    throw err;
  }

  await assertSupplierPayoutReadyTx(tx, po.supplierId);

  const payoutStatus = String(po.payoutStatus || "").toUpperCase();
  const payoutAmount = grossPayoutAmountFromPO(po);

  if (po.paidOutAt || payoutStatus === "RELEASED") {
    return {
      ok: true,
      alreadyReleased: true,
      mode: "released",
      amount: payoutAmount,
    };
  }

  if (payoutStatus === "HELD" && po.payoutHoldUntil) {
    await tx.supplierPaymentAllocation.updateMany({
      where: {
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        status: "HELD" as any,
      },
      data: {
        amount: payoutAmount,
        holdUntil: po.payoutHoldUntil,
      } as any,
    });

    return {
      ok: true,
      alreadyHeld: true,
      mode: "held",
      holdUntil: po.payoutHoldUntil,
      amount: payoutAmount,
    };
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
    select: {
      id: true,
      amount: true,
      status: true,
      releasedAt: true,
      holdUntil: true,
    },
  });

  if (!alloc) {
    const heldAlloc = await tx.supplierPaymentAllocation.findFirst({
      where: {
        paymentId: payment.id,
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        status: "HELD" as any,
      },
      select: { id: true, holdUntil: true },
    });

    if (heldAlloc) {
      await tx.supplierPaymentAllocation.update({
        where: { id: heldAlloc.id },
        data: {
          amount: payoutAmount,
        } as any,
      });

      return {
        ok: true,
        alreadyHeld: true,
        mode: "held",
        holdUntil: heldAlloc.holdUntil ?? null,
        amount: payoutAmount,
      };
    }

    const paidAlloc = await tx.supplierPaymentAllocation.findFirst({
      where: {
        paymentId: payment.id,
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        status: "PAID" as any,
      },
      select: { id: true, releasedAt: true },
    });

    if (paidAlloc) {
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          payoutStatus: "RELEASED" as any,
          ...(po.paidOutAt ? {} : { paidOutAt: paidAlloc.releasedAt ?? new Date() }),
        } as any,
      });

      await tx.supplierPaymentAllocation.updateMany({
        where: {
          paymentId: payment.id,
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
        },
        data: {
          amount: payoutAmount,
          status: "PAID" as any,
          releasedAt: paidAlloc.releasedAt ?? new Date(),
        },
      });

      return {
        ok: true,
        alreadyReleased: true,
        mode: "released",
        releasedAt: paidAlloc.releasedAt ?? null,
        amount: payoutAmount,
      };
    }

    const err: any = new Error("No eligible allocation found to hold for this PO");
    err.status = 409;
    throw err;
  }

  const holdUntil = new Date(verifiedAt);
  holdUntil.setDate(holdUntil.getDate() + PAYOUT_HOLD_DAYS);

  await tx.supplierPaymentAllocation.update({
    where: { id: alloc.id },
    data: {
      amount: payoutAmount,
      status: "HELD" as any,
      holdUntil,
    } as any,
  });

  await tx.purchaseOrder.update({
    where: { id: po.id },
    data: {
      payoutStatus: "HELD" as any,
      payoutHoldUntil: holdUntil,
    },
  });

  return {
    ok: true,
    mode: "held",
    holdUntil,
    complaintWindowDays: COMPLAINT_WINDOW_DAYS,
    amount: payoutAmount,
  };
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
    throw new Error(
      "Supplier is not payout-ready (missing bank details or payouts disabled)."
    );
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

    if (isAdmin(req.user?.role)) {
      return res.status(403).json({
        error: "Read-only supplier view. Admin payout actions must use admin routes.",
      });
    }

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!isSupplier(role) && !isAdmin(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    let supplierId: string | null = null;
    if (isAdmin(role) && req.query.supplierId) {
      supplierId = String(req.query.supplierId);
    } else {
      const s = await getSupplierForUser(userId);
      supplierId = s?.id ?? null;
    }

    if (!supplierId) {
      return res.status(403).json({ error: "Supplier access required" });
    }

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { id: true, supplierId: true, orderId: true },
    });

    if (!po) {
      return res.status(404).json({ error: "PurchaseOrder not found" });
    }

    if (isSupplier(role) && String(po.supplierId) !== String(supplierId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (PAYOUT_HOLD_DAYS > 0) {
      const out = await prisma.$transaction(async (tx) => {
        return releasePayoutForPOTx(tx, poId);
      });

      if (String(out?.mode || "").toLowerCase() === "held") {
        await notifySupplierPayoutStatusBestEffort({
          purchaseOrderId: poId,
          status: "HELD",
        });
      } else if (String(out?.mode || "").toLowerCase() === "released") {
        await notifySupplierPayoutStatusBestEffort({
          purchaseOrderId: poId,
          status: "RELEASED",
        });
      }

      return res.json({
        ok: true,
        data: out,
        executionMode: PAYOUT_EXECUTION_MODE,
      });
    }

    if (PAYOUT_EXECUTION_MODE !== "provider") {
      const out = await prisma.$transaction(async (tx) => {
        return mockFinalizePayoutForPOTx(tx, poId, {
          id: req.user?.id,
          role: req.user?.role,
        });
      });

      await notifySupplierPayoutStatusBestEffort({
        purchaseOrderId: poId,
        status: "RELEASED",
      });

      return res.json({
        ok: true,
        data: out,
        executionMode: PAYOUT_EXECUTION_MODE,
      });
    }

    const out = await paySupplierForPurchaseOrder(poId, {
      id: req.user?.id,
      role: req.user?.role,
    });

    await notifySupplierPayoutStatusBestEffort({
      purchaseOrderId: poId,
      status: "RELEASED",
    });

    return res.json({
      ok: true,
      data: out,
      executionMode: "provider",
    });
  } catch (e: any) {
    const status = e?.status ? Number(e.status) : 500;
    const msg = e?.message || "Failed to release payout";
    return res.status(status).json({ error: msg });
  }
});

export default router;