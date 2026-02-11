// api/src/routes/payments.ts
import express, { Router } from "express";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";

import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { logOrderActivity } from "../services/activity.service.js";
import { ps, toKobo, PAYSTACK_SECRET_KEY } from "../lib/paystack.js";

import { generateRef8, isFresh, toNumber } from "../lib/payments.js";
import { issueReceiptIfNeeded } from "../lib/receipts.js";
import { getInitChannels } from "../config/paystack.js";
import { notifySuppliersForOrder, notifyCustomerOrderPaid } from "../services/notify.js";
import PDFDocument from "pdfkit";

// dynamic split computation
import { computePaystackSplitForOrder } from "../lib/splits.js";

// enums
import { SupplierPaymentStatus, PurchaseOrderStatus } from "@prisma/client";
import { trackPurchaseIfNeeded } from "../services/tracking.service.js";

const router = Router();

/* ----------------------------- Types ----------------------------- */

type AuthedRequest = Request & { user?: any };

type JwtUser = { id: string; role?: string | null };

/* ----------------------------- Config ----------------------------- */

const isTrue = (v?: string | null) =>
  ["1", "true", "yes", "on"].includes(String(v ?? "").toLowerCase());

const TRIAL_MODE = isTrue(process.env.PAYMENTS_TRIAL_MODE);
const APP_URL = process.env.APP_URL || "http://localhost:5173";

const ACTIVE_PENDING_TTL_MIN = Number(process.env.PAYMENT_PENDING_TTL_MIN ?? 60);

const INLINE_APPROVAL = (process.env.INLINE_APPROVAL || "auto").toLowerCase() as
  | "auto"
  | "manual";

const BANK_NAME = process.env.BANK_NAME || "";
const BANK_ACCOUNT_NAME = process.env.BANK_ACCOUNT_NAME || "";
const BANK_ACCOUNT_NUMBER = process.env.BANK_ACCOUNT_NUMBER || "";

// ✅ Optional: actually apply split_code to Paystack init
const APPLY_SPLIT_CODE = isTrue(process.env.PAYSTACK_APPLY_SPLIT_CODE);

/* ----------------------------- Helpers ----------------------------- */

function httpErr(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function isValidSignature(rawBody: Buffer, signature: string | undefined, secret: string) {
  if (!signature) return false;
  const hash = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  return hash === signature;
}

function calcPaystackFee(amountNaira: number, opts?: { international?: boolean }) {
  const isIntl = !!opts?.international;
  if (isIntl) return amountNaira * 0.039 + 100;
  const percent = amountNaira * 0.015;
  const extra = amountNaira > 2500 ? 100 : 0;
  return Math.min(percent + extra, 2000);
}

async function readSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

// Normalize query values: Express query can be string | string[] | undefined
function q1(v: unknown): string {
  if (Array.isArray(v)) return String(v[0] ?? "");
  if (v == null) return "";
  return String(v);
}

/**
 * Payments-side OTP consumer for PAY_ORDER.
 * We only call this IF a token is actually provided.
 */
async function consumePayOrderOtpOrThrow(args: {
  orderId: string;
  actorId: string;
  token: string;
}) {
  const { orderId, actorId, token } = args;
  if (!token) throw httpErr(400, "Missing x-otp-token");

  const row = await prisma.orderOtpRequest.findFirst({
    where: {
      id: token,
      orderId,
      purpose: "PAY_ORDER",
      verifiedAt: { not: null },
    },
    select: { id: true, userId: true, expiresAt: true, consumedAt: true },
  });

  if (!row) throw httpErr(400, "Invalid or unverified OTP token");
  if (row.expiresAt <= new Date()) throw httpErr(400, "OTP token expired");
  if (row.consumedAt) throw httpErr(400, "OTP token already used");
  if (String(row.userId) !== String(actorId))
    throw httpErr(403, "OTP token not valid for this user");

  await prisma.orderOtpRequest.update({
    where: { id: row.id },
    data: { consumedAt: new Date() },
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * ✅ "Held" allocation status across enum variants:
 * - some schemas use HELD
 * - some use PENDING
 */
function allocHeldStatus(): SupplierPaymentStatus {
  const SPS: any = SupplierPaymentStatus as any;
  return (SPS.HELD ?? SPS.PENDING ?? "PENDING") as SupplierPaymentStatus;
}

/* ----------------------------- PO helpers (idempotent + allocations) ----------------------------- */

function generateSupplierOrderRef() {
  const chunk = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SPO-${chunk()}-${chunk()}`;
}

async function ensureSupplierOrderRef(tx: any, orderId: string, supplierId: string) {
  // 1) Existing PO
  const existingPO = await tx.purchaseOrder.findFirst({
    where: { orderId, supplierId },
    orderBy: { createdAt: "asc" },
    select: { supplierOrderRef: true },
  });
  if (existingPO?.supplierOrderRef) return existingPO.supplierOrderRef;

  // 2) From activity log
  const refAct = await tx.orderActivity.findFirst({
    where: { orderId, supplierId, type: "SUPPLIER_REF_CREATED" },
    orderBy: { createdAt: "asc" },
    select: { meta: true },
  });
  const fromAct =
    (refAct?.meta as any)?.supplierOrderRef || (refAct?.meta as any)?.supplierRef;
  if (fromAct && typeof fromAct === "string" && fromAct.trim()) return fromAct.trim();

  // 3) Generate + log
  const ref = generateSupplierOrderRef();
  try {
    await tx.orderActivity.create({
      data: {
        orderId,
        supplierId,
        type: "SUPPLIER_REF_CREATED",
        message: `Supplier reference created for supplier ${supplierId}`,
        meta: { supplierOrderRef: ref },
      },
    });
  } catch {
    // non-fatal
  }
  return ref;
}

async function ensurePurchaseOrdersForOrderTx(tx: any, orderId: string) {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      chosenSupplierId: true,
      chosenSupplierUnitPrice: true,
    },
  });

  const bySupplier = new Map<
    string,
    {
      supplierId: string;
      supplierAmount: number;
      customerSubtotal: number;
      itemIds: string[];
    }
  >();

  for (const it of items) {
    const sid = it.chosenSupplierId ? String(it.chosenSupplierId) : "";
    if (!sid) continue;

    const qty = Math.max(0, Number(it.quantity ?? 0));
    const supplierUnit = Number(it.chosenSupplierUnitPrice ?? 0) || 0;
    const supplierLine = supplierUnit * qty;

    const customerLine =
      it.lineTotal != null
        ? Number(it.lineTotal ?? 0)
        : (Number(it.unitPrice ?? 0) || 0) * qty;

    const cur =
      bySupplier.get(sid) ?? {
        supplierId: sid,
        supplierAmount: 0,
        customerSubtotal: 0,
        itemIds: [],
      };

    cur.supplierAmount += supplierLine;
    cur.customerSubtotal += customerLine;
    cur.itemIds.push(String(it.id));
    bySupplier.set(sid, cur);
  }

  const supplierIds = Array.from(bySupplier.keys());
  if (!supplierIds.length) return [];

  const createdOrUpdated: any[] = [];

  for (const sid of supplierIds) {
    const g = bySupplier.get(sid)!;

    const supplierAmount = round2(g.supplierAmount);
    const customerSubtotal = round2(g.customerSubtotal);
    const platformFee = round2(Math.max(0, customerSubtotal - supplierAmount));

    const supplierOrderRef = await ensureSupplierOrderRef(tx, orderId, sid);

    let po = await tx.purchaseOrder.findFirst({
      where: { orderId, supplierId: sid },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (!po) {
      // ✅ Create idempotently (safe on webhook retries)
      try {
        po = await tx.purchaseOrder.create({
          data: {
            orderId,
            supplierId: sid,
            subtotal: customerSubtotal,
            platformFee,
            supplierAmount,
            status: PurchaseOrderStatus.CREATED as any,
            supplierOrderRef,
          },
          select: { id: true },
        });
      } catch (e: any) {
        po = await tx.purchaseOrder.findFirst({
          where: { orderId, supplierId: sid },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (!po) throw e;
      }
    }

    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        subtotal: customerSubtotal,
        platformFee,
        supplierAmount,
        supplierOrderRef,
      },
    });

    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: po.id } });
    for (const orderItemId of g.itemIds) {
      await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId: po.id,
          orderItemId,
          externalRef: null,
          externalStatus: null,
        },
      });
    }

    createdOrUpdated.push({ id: po.id, supplierId: sid });
  }

  return createdOrUpdated;
}

/**
 * ✅ Record supplier allocations when payment is PAID.
 * IMPORTANT: Do NOT delete existing allocations (webhook retries can arrive after some payouts were released).
 */
async function recordSupplierAllocationsOnPaidTx(tx: any, paymentId: string, orderId: string) {
  const pos = await tx.purchaseOrder.findMany({
    method: undefined,
    where: { orderId },
    include: { supplier: { select: { id: true, name: true } } },
  });

  if (!pos.length) return [];

  const existing = await tx.supplierPaymentAllocation.findMany({
    where: { paymentId },
    select: { id: true, purchaseOrderId: true, status: true },
  });

  const existingByPo = new Map<string, any>();
  for (const a of existing) existingByPo.set(String(a.purchaseOrderId), a);

  const rows: any[] = [];

  for (const po of pos) {
    const poId = String(po.id);

    const already = existingByPo.get(poId);
    if (already) {
      // keep status as-is (do not reset PAID → PENDING)
      rows.push(already);
    } else {
      rows.push(
        await tx.supplierPaymentAllocation.create({
          data: {
            paymentId,
            orderId,
            supplierId: po.supplierId,
            purchaseOrderId: po.id,
            amount: po.supplierAmount,
            status: allocHeldStatus(),
            supplierNameSnapshot: po.supplier?.name ?? null,
            meta: { purchaseOrderStatus: po.status },
          },
        })
      );
    }

    // mark PO funded (safe)
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: PurchaseOrderStatus.FUNDED as any },
    });
  }

  await tx.payment.update({
    where: { id: paymentId },
    data: {
      supplierBreakdownJson: pos.map((po: any) => ({
        supplierId: po.supplierId,
        supplierName: po.supplier?.name ?? null,
        purchaseOrderId: po.id,
        supplierAmount: Number(po.supplierAmount ?? 0),
      })),
    },
  });

  return rows;
}

/* ----------------------------- Profit recompute ----------------------------- */

async function getCheapestUnitCost(
  productId: string,
  variantId?: string | null,
  supplierId?: string | null
) {
  const sid = supplierId ? String(supplierId) : null;

  if (variantId) {
    const offers = await prisma.supplierVariantOffer.findMany({
      where: {
        variantId,
        variant: { productId },
        isActive: true,
        inStock: true,
        availableQty: { gt: 0 },
        ...(sid ? { supplierId: sid } : {}),
      } as any,
      select: { unitPrice: true } as any,
    });

    let best = Infinity;
    for (const o of offers) {
      const unit = Number((o as any).unitPrice ?? 0);
      if (unit > 0) best = Math.min(best, unit);
    }
    if (Number.isFinite(best) && best !== Infinity) return best;
  }

  const base = await prisma.supplierProductOffer.findFirst({
    where: {
      productId,
      isActive: true,
      inStock: true,
      availableQty: { gt: 0 },
      ...(sid ? { supplierId: sid } : {}),
    },
    orderBy: { basePrice: "asc" },
    select: { basePrice: true },
  });

  return Number(base?.basePrice ?? 0);
}

async function recomputeProfitForPayment(paymentId: string) {
  const p = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      orderId: true,
      amount: true,
      feeAmount: true,
      reference: true,
      paidAt: true,
      status: true,
    },
  });
  if (!p?.orderId) return;

  const order = await prisma.order.findUnique({
    where: { id: p.orderId },
    include: {
      items: {
        select: {
          id: true,
          productId: true,
          variantId: true,
          chosenSupplierId: true,
          chosenSupplierUnitPrice: true,
          quantity: true,
          unitPrice: true,
          title: true,
        },
      },
    },
  });
  if (!order) return;

  let cogs = 0;
  const offerCache = new Map<string, number>();

  for (const it of order.items) {
    const qty = Math.max(1, Number(it.quantity || 1));
    let unitCost = Number(it.chosenSupplierUnitPrice ?? 0);

    if (!(unitCost > 0)) {
      const supplierId = it.chosenSupplierId ? String(it.chosenSupplierId) : null;

      const key = `${it.productId}|${it.variantId ?? "NULL"}|${supplierId ?? "ANY_SUPPLIER"}`;

      if (!offerCache.has(key)) {
        const cheapest = await getCheapestUnitCost(
          String(it.productId),
          it.variantId ?? null,
          supplierId
        );
        offerCache.set(key, Number(cheapest ?? 0));
      }
      unitCost = offerCache.get(key)!;
    }

    cogs += unitCost * qty;
  }

  const gateway = Number(p.feeAmount || 0);

  const commsAgg = await prisma.orderComms.aggregate({
    _sum: { amount: true },
    where: { orderId: p.orderId, reason: "SUPPLIER_NOTIFY" },
  });
  const comms = Number(commsAgg._sum?.amount ?? 0);

  const baseServiceFee =
    Number(
      (await readSetting("serviceFeeBaseNGN")) ??
        (await readSetting("platformBaseFeeNGN")) ??
        0
    ) || 0;

  const amountPaid = Number(p.amount || 0);

  const profitMode = ((await readSetting("profitMode")) ?? "accurate").toLowerCase();

  const profit =
    profitMode === "simple"
      ? amountPaid - cogs
      : amountPaid - (cogs + gateway + comms + baseServiceFee);

  const breakdown = {
    reference: p.reference,
    orderId: p.orderId,
    paymentId,
    paidAt: p.paidAt,
    amountPaid,
    cogs,
    gateway,
    comms,
    baseServiceFee,
    profit,
    profitMode,
  };

  await prisma.paymentEvent.create({
    data: {
      paymentId,
      type: "PROFIT_COMPUTED",
      data: breakdown,
    },
  });

  await prisma.orderActivity.create({
    data: {
      orderId: p.orderId,
      type: "PROFIT_COMPUTED",
      message: `Profit computed: ₦${profit.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      meta: breakdown,
    },
  });
}

/* ----------------------------- Core finalize ----------------------------- */

async function finalizePaidFlow(paymentId: string) {
  console.log("[finalizePaidFlow] start", { paymentId });

  // ✅ Do NOT call prisma (global) inside the transaction callback indirectly.
  // We'll track later after commit.
  let trackPaymentId: string | null = null;

  const result = await prisma.$transaction(async (tx: any) => {
    const p = await tx.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        orderId: true,
        status: true,
        amount: true,
        feeAmount: true,
        reference: true,
        channel: true,
        order: {
          select: {
            id: true,
            total: true,
            serviceFeeTotal: true,
          },
        },
      },
    });

    if (!p || p.status !== "PAID" || !p.orderId) return null;

    // Cancel other pending attempts for same order
    await tx.payment.updateMany({
      where: {
        orderId: p.orderId,
        status: "PENDING",
        NOT: { id: p.id },
      },
      data: { status: "CANCELED" },
    });

    const next =
      process.env.TURN_OFF_AWAIT_CONF === "true" ? "PAID" : "AWAITING_FULFILLMENT";

    await tx.order.update({
      where: { id: p.orderId },
      data: { status: next as any },
    });

    const total = Number(p.order?.total) || 0;
    const svc = Number(p.order?.serviceFeeTotal) || 0;
    const amt = Number(p.amount) || 0;

    // NOTE: This upsert uses paymentId as unique; ensure you have @@unique([paymentId]) or paymentId @unique on OrderComms
    if (total > 0 && svc > 0 && amt > 0) {
      const slice = svc * Math.max(0, Math.min(1, amt / total));
      await tx.orderComms.upsert({
        where: { paymentId: p.id },
        create: {
          orderId: p.orderId,
          paymentId: p.id,
          amount: slice,
          channel: p.channel ?? null,
          reason: "SUPPLIER_NOTIFY",
        },
        update: {
          amount: slice,
          channel: p.channel ?? null,
          reason: "SUPPLIER_NOTIFY",
        },
      });
    }

    await tx.paymentEvent.create({
      data: {
        paymentId: p.id,
        type: "FINALIZE_PAID",
        data: { reference: p.reference },
      },
    });

    await ensurePurchaseOrdersForOrderTx(tx, p.orderId);
    await recordSupplierAllocationsOnPaidTx(tx, p.id, p.orderId);

    trackPaymentId = p.id;

    return { orderId: p.orderId, paymentId: p.id };
  });

  if (!result) return;

  // ✅ after commit
  if (trackPaymentId) {
    try {
      await trackPurchaseIfNeeded(trackPaymentId);
    } catch (e) {
      console.error("trackPurchaseIfNeeded failed", e);
    }
  }

  const { orderId } = result;

  // Supplier notifications (idempotent)
  const alreadyNotified = await prisma.paymentEvent.findFirst({
    where: {
      paymentId: result.paymentId,
      type: "SUPPLIER_NOTIFIED",
    },
  });

  if (!alreadyNotified) {
    try {
      await notifySuppliersForOrder(orderId);
      await prisma.paymentEvent.create({
        data: {
          paymentId: result.paymentId,
          type: "SUPPLIER_NOTIFIED",
        },
      });
    } catch (e) {
      console.error("notifySuppliersForOrder failed", e);
    }
  }

  await prisma.paymentEvent.create({
    data: {
      paymentId: result.paymentId,
      type: "SUPPLIER_PAYOUTS_HELD",
      data: { orderId, reason: "awaiting_delivery_otp" },
    },
  });

  try {
    await issueReceiptIfNeeded(result.paymentId);
  } catch (e) {
    console.error("issueReceiptIfNeeded failed", e);
  }

  try {
    await recomputeProfitForPayment(result.paymentId);
  } catch (e) {
    console.error("recomputeProfitForPayment failed", e);
  }

  // Customer email (idempotent)
  const alreadyEmailed = await prisma.paymentEvent.findFirst({
    where: {
      paymentId: result.paymentId,
      type: "ORDER_PAID_EMAIL_SENT",
    },
  });

  if (!alreadyEmailed) {
    try {
      await notifyCustomerOrderPaid(orderId, result.paymentId);
      await prisma.paymentEvent.create({
        data: {
          paymentId: result.paymentId,
          type: "ORDER_PAID_EMAIL_SENT",
          data: { orderId },
        },
      });
    } catch (e) {
      console.error("notifyCustomerOrderPaid failed", e);
    }
  }

  console.log("[finalizePaidFlow] done", result);
}

/* ----------------------------- Public endpoints ----------------------------- */

/**
 * GET /api/payments/summary
 */
router.get("/summary", requireAuth, async (req: any, res: any, next: any) => {
  try {
    const agg = await prisma.payment.aggregate({
      _sum: { amount: true },
      where: {
        status: "PAID",
        order: { userId: req.user!.id },
      },
    });
    const totalPaid = Number(agg._sum?.amount ?? 0);
    res.json({ totalPaid, currency: "NGN" });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/payments/init  { orderId, channel?, otpToken? }
 */
router.post("/init", requireAuth, async (req: AuthedRequest, res: Response, next) => {
  try {
    const orderId = String(req.body?.orderId ?? "").trim();
    let channel = String(req.body?.channel ?? "").trim();
    const userId = String(req.user!.id);
    const userEmail = String(req.user!.email || "").trim();

    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    // OTP is OPTIONAL
    const otpToken = String(req.get("x-otp-token") ?? req.body?.otpToken ?? "").trim();
    if (otpToken) {
      await consumePayOrderOtpOrThrow({
        orderId,
        actorId: userId,
        token: otpToken,
      });
    }

    channel = (channel || "paystack").toLowerCase();

    const order = await prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true, total: true, createdAt: true },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });

    const paid = await prisma.payment.findFirst({
      where: { orderId, status: "PAID" },
      select: { id: true },
    });
    if (paid) return res.status(409).json({ error: "Order already paid" });

    let pay = await prisma.payment.findFirst({
      where: { orderId, status: "PENDING", channel },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        reference: true,
        createdAt: true,
        channel: true,
        providerPayload: true,
        status: true,
      },
    });

    if (pay && isFresh(pay.createdAt, ACTIVE_PENDING_TTL_MIN) && channel === "paystack") {
      const authUrl = (pay.providerPayload as any)?.authorization_url;
      if (authUrl) {
        await logOrderActivity(orderId, "PAYMENT_RESUME", "Resumed existing Paystack attempt", {
          reference: pay.reference,
        });
        return res.json({
          mode: "paystack",
          reference: pay.reference,
          authorization_url: authUrl,
        });
      }
    }

    if (pay && !isFresh(pay.createdAt, ACTIVE_PENDING_TTL_MIN)) {
      await prisma.payment.update({
        where: { id: pay.id },
        data: { status: "CANCELED" },
      });
      pay = null as any;
    }

    if (!pay) {
      const created = await prisma.payment.create({
        data: {
          orderId,
          reference: generateRef8(),
          channel: TRIAL_MODE ? "trial" : channel,
          provider: TRIAL_MODE ? "TRIAL" : channel === "paystack" ? "PAYSTACK" : null,
          providerEnv: TRIAL_MODE || process.env.PAYSTACK_LIVE_MODE !== "true" ? "test" : "live",
          amount: order.total,
          status: "PENDING",
        },
      });

      pay = {
        id: created.id,
        reference: created.reference,
        createdAt: created.createdAt,
        channel: created.channel,
        providerPayload: created.providerPayload,
        status: created.status,
      } as any;
    }

    if (TRIAL_MODE) {
      await logOrderActivity(orderId, "PAYMENT_INIT", `Trial init (${channel})`, {
        reference: pay!.reference,
        channel,
        amount: toNumber(order.total),
      });

      return res.json({
        mode: "trial",
        reference: pay!.reference,
        amount: toNumber(order.total),
        currency: "NGN",
        autoPaid: INLINE_APPROVAL === "auto",
        bank: {
          bank_name: "Demo Bank",
          account_name: "DaySpring",
          account_number: "0123456789",
        },
      });
    }

    if (channel === "paystack") {
      const channels = getInitChannels();
      const callback_url = `${APP_URL}/payment-callback?orderId=${encodeURIComponent(
        orderId
      )}&reference=${encodeURIComponent(pay!.reference)}&gateway=paystack`;

      let split_code: string | undefined;

      try {
        const out: any = await computePaystackSplitForOrder(orderId);
        const code =
          typeof out === "string"
            ? out
            : out?.split_code ?? out?.splitCode ?? out?.code ?? undefined;

        if (APPLY_SPLIT_CODE && code) split_code = String(code);

        await prisma.paymentEvent.create({
          data: {
            paymentId: pay!.id,
            type: split_code ? "SPLIT_APPLIED" : "SPLIT_CREATED_NOT_APPLIED",
            data: { split_code: code ?? null, apply: APPLY_SPLIT_CODE },
          },
        });
      } catch (e: any) {
        console.error("paystack split create failed", e?.response?.data || e?.message);
      }

      const initPayload: any = {
        email: userEmail,
        amount: toKobo(order.total),
        reference: pay!.reference,
        currency: "NGN",
        callback_url,
        channels,
        metadata: {
          orderId,
          userId: req.user!.id,
          splitApplied: !!split_code,
          custom_fields: [
            {
              display_name: "Order Ref",
              variable_name: "order_ref",
              value: pay!.reference,
            },
          ],
        },
        customizations: {
          title: "DaySpring",
          description: `Order ${order.id} • Use Payment Ref: ${pay!.reference}`,
          logo: process.env.PAYSTACK_LOGO_URL || undefined,
        },
      };

      if (split_code) initPayload.split_code = split_code;

      const resp = await ps.post("/transaction/initialize", initPayload);
      const data = resp.data?.data;

      await prisma.payment.update({
        where: { id: pay!.id },
        data: {
          providerPayload: data,
          initPayload,
          provider: "PAYSTACK",
          channel: "paystack",
        } as any,
      });

      await logOrderActivity(orderId, "PAYMENT_INIT", "Paystack init", {
        reference: pay!.reference,
        amount: toNumber(order.total),
      });

      return res.json({
        mode: "paystack",
        reference: pay!.reference,
        authorization_url: data?.authorization_url,
        data,
      });
    }

    await logOrderActivity(orderId, "PAYMENT_INIT", "Inline bank init", {
      reference: pay!.reference,
      amount: toNumber(order.total),
    });

    return res.json({
      mode: "paystack_inline_bank",
      reference: pay!.reference,
      amount: toNumber(order.total),
      currency: "NGN",
      bank: {
        bank_name: BANK_NAME || "GTB Banks Virtual",
        account_name: BANK_ACCOUNT_NAME || "DaySpring",
        account_number: BANK_ACCOUNT_NUMBER || "0123456789",
      },
    });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------- Verification ----------------------------- */

async function verifyPaystack(reference: string) {
  const vr = await ps.get(`/transaction/verify/${encodeURIComponent(reference)}`);
  const tx = vr.data?.data;

  if (!tx || String(tx.status).toLowerCase() !== "success") {
    throw new Error("Verification failed");
  }

  const amountNaira = Math.round(Number(tx.amount || 0)) / 100;

  let feeNaira = 0;
  if (typeof tx.fees === "number") {
    feeNaira = Math.round(Number(tx.fees)) / 100;
  } else {
    const isIntl =
      (tx.authorization?.country_code && tx.authorization.country_code !== "NG") ||
      tx.currency !== "NGN";
    feeNaira = calcPaystackFee(amountNaira, { international: !!isIntl });
  }

  await prisma.payment.update({
    where: { reference },
    data: {
      status: "PAID",
      paidAt: new Date(tx.paid_at || Date.now()),
      amount: amountNaira,
      feeAmount: feeNaira,
      providerPayload: tx,
      provider: "PAYSTACK",
      channel: String(tx.channel || tx.authorization?.channel || "paystack").toLowerCase(),
      providerTxId: tx?.id != null ? String(tx.id) : null,
      providerEnv: process.env.PAYSTACK_LIVE_MODE === "true" ? "live" : "test",
    },
  });

  return { amountNaira, feeNaira, tx };
}

// POST /api/payments/verify  { orderId, reference }
router.post("/verify", requireAuth, async (req: AuthedRequest, res: Response) => {
  const orderId = String(req.body?.orderId ?? "").trim();
  const reference = String(req.body?.reference ?? "").trim();

  if (!orderId || !reference) {
    return res.status(400).json({ error: "orderId and reference required" });
  }

  const pay = await prisma.payment.findUnique({
    where: { reference },
    select: {
      id: true,
      orderId: true,
      status: true,
      channel: true,
      amount: true,
    },
  });
  if (!pay || pay.orderId !== orderId) {
    return res.status(404).json({ error: "Payment not found" });
  }

  if (pay.status === "PAID") {
    return res.json({ ok: true, status: "PAID", message: "Already verified" });
  }

  if (["FAILED", "CANCELED", "REFUNDED"].includes(pay.status)) {
    await logOrderActivity(
      orderId,
      "PAYMENT_FAILED",
      "Verification attempted on non-pending payment",
      { reference }
    );
    return res.json({ ok: true, status: pay.status, message: "Payment is not successful" });
  }

  if (TRIAL_MODE || pay.channel !== "paystack") {
    if (INLINE_APPROVAL === "manual") {
      await prisma.paymentEvent.create({
        data: {
          paymentId: pay.id,
          type: "VERIFY_PENDING",
          data: { reference, note: "Manual approval required" },
        },
      });
      await logOrderActivity(orderId, "PAYMENT_PENDING", "Awaiting manual confirmation", {
        reference,
      });
      return res.json({ ok: true, status: "PENDING", message: "Awaiting confirmation" });
    }

    const updated = await prisma.payment.update({
      where: { id: pay.id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        provider: "TRIAL",
        channel: "trial",
        providerEnv: "trial",
        providerPayload: {
          ...(pay as any)?.providerPayload,
          trial: true,
          note: "Marked paid via PAYMENTS_TRIAL_MODE",
        },
      } as any,
      select: { id: true },
    });

    await finalizePaidFlow(updated.id);
    return res.json({ ok: true, status: "PAID", message: "Payment verified (trial/virtual)" });
  }

  try {
    const { tx } = await verifyPaystack(reference);

    await prisma.paymentEvent.create({
      data: {
        paymentId: pay.id,
        type: "VERIFY_SUCCESS",
        data: { reference, paystackId: tx?.id, status: tx?.status },
      },
    });

    const p2 = await prisma.payment.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (p2?.id) await finalizePaidFlow(p2.id);

    return res.json({ ok: true, status: "PAID", message: "Payment verified" });
  } catch (e: any) {
    await prisma.paymentEvent.create({
      data: {
        paymentId: pay.id,
        type: "VERIFY_ERROR",
        data: { reference, err: e?.message },
      },
    });
    return res.json({
      ok: true,
      status: "PENDING",
      message: "Could not verify yet; try again shortly",
    });
  }
});

// Optional helper: POST /api/payments/:reference/verify
router.post("/:reference/verify", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const reference = String(req.params.reference ?? "").trim();
    if (!reference) return res.status(400).json({ error: "Missing reference" });

    const result = await verifyPaystack(reference);

    const p = await prisma.payment.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (p?.id) await finalizePaidFlow(p.id);

    return res.json({ data: result });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Verification failed" });
  }
});

/* ----------------------------- Webhook ----------------------------- */

router.post("/webhook/paystack", express.raw({ type: "*/*" }), async (req: any, res: any) => {
  try {
    const sig = req.headers["x-paystack-signature"] as string | undefined;
    const secret = PAYSTACK_SECRET_KEY || "";

    if (!isValidSignature(req.body as Buffer, sig, secret)) {
      return res.status(401).send("bad sig");
    }

    const evt = JSON.parse((req.body as Buffer).toString("utf8"));
    const eventType = String(evt?.event || "");
    const data = evt?.data || {};
    const reference: string | undefined = data?.reference;

    if (eventType === "charge.success" && reference) {
      await verifyPaystack(reference);
      const p = await prisma.payment.findUnique({
        where: { reference },
        select: { id: true },
      });
      if (p?.id) await finalizePaidFlow(p.id);
    }

    return res.status(200).send("ok");
  } catch {
    return res.status(200).send("ok");
  }
});

/* ----------------------------- Status & receipts ----------------------------- */

router.get("/status", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const orderId = q1(req.query.orderId).trim();
    const reference = q1(req.query.reference).trim();

    if (!orderId || !reference) {
      return res.status(400).json({ error: "orderId and reference are required" });
    }

    const pay = await prisma.payment.findFirst({
      where: {
        reference,
        orderId,
        order: { userId: req.user!.id },
      },
      select: { status: true },
    });

    if (!pay) throw new Error("Payment not found/created");
    return res.json({ status: pay.status });
  } catch (e: any) {
    console.error("payments/status error", e);
    return res.status(500).json({ error: "Failed to fetch payment status" });
  }
});

export async function assertCanViewReceipt(paymentKey: string, user: JwtUser) {
  const key = String(paymentKey || "").trim();

  const row = await prisma.payment.findFirst({
    where: { OR: [{ id: key }, { reference: key }] },
    select: {
      id: true,
      orderId: true,
      status: true,
      order: { select: { userId: true } },
    },
  });

  if (!row || row.status !== "PAID") throw httpErr(404, "Not found");

  const role = (user?.role || "").toUpperCase();
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const isOwner = !!row.order?.userId && !!user?.id && row.order.userId === user.id;

  if (!isOwner && !isAdmin) throw httpErr(403, "Forbidden");
  return row;
}

router.get("/:paymentKey/receipt", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const paymentKey = String(req.params.paymentKey ?? "").trim();
    if (!paymentKey) return res.status(400).json({ error: "Missing paymentKey" });

    const row = await assertCanViewReceipt(paymentKey, req.user!);

    const pay = await issueReceiptIfNeeded(row.id);
    if (!pay) return res.status(404).json({ error: "Receipt not available" });

    const r = (pay.receiptData || {}) as any;

    let serviceFee =
      Number(r.order?.serviceFeeTotal ?? r.order?.commsTotal ?? r.order?.comms ?? 0) || 0;

    if (!serviceFee && row.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: row.orderId },
        select: { serviceFeeTotal: true },
      });
      if (order?.serviceFeeTotal != null) serviceFee = Number(order.serviceFeeTotal) || 0;
    }

    const data = {
      ...r,
      order: {
        ...(r.order || {}),
        serviceFee,
      },
    };

    return res.json({
      ok: true,
      receiptNo: pay.receiptNo,
      issuedAt: pay.receiptIssuedAt,
      data,
    });
  } catch (e: any) {
    const status = e?.status || 500;
    return res.status(status).json({ error: e?.message || "Failed to fetch receipt" });
  }
});

router.get("/:paymentKey/receipt.pdf", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const paymentKey = String(req.params.paymentKey ?? "").trim();
    if (!paymentKey) return res.status(400).json({ error: "Missing paymentKey" });

    const row = await assertCanViewReceipt(paymentKey, req.user!);

    const pay = await issueReceiptIfNeeded(row.id);
    if (!pay?.receiptData) return res.status(404).json({ error: "Receipt not available" });

    const r = pay.receiptData as any;

    let serviceFee =
      Number(r.order?.serviceFeeTotal ?? r.order?.commsTotal ?? r.order?.comms ?? 0) || 0;

    if (!serviceFee && row.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: row.orderId },
        select: { serviceFeeTotal: true },
      });
      if (order?.serviceFeeTotal != null) serviceFee = Number(order.serviceFeeTotal) || 0;
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${pay.receiptNo || "receipt"}.pdf"`
    );

    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.pipe(res);

    // Header
    doc.font("Helvetica-Bold").fontSize(18).text(r.merchant?.name || "Receipt");
    doc.moveDown(0.5);

    doc.font("Helvetica").fontSize(10).fillColor("#555");
    doc.text(r.merchant?.addressLine1 || "");
    if (r.merchant?.addressLine2) doc.text(r.merchant.addressLine2);
    if (r.merchant?.supportEmail) doc.text(`Support: ${r.merchant.supportEmail}`);
    doc.moveDown();
    doc.fillColor("#000");

    // Meta
    doc.font("Helvetica").fontSize(12);
    doc.text(`Receipt No: ${pay.receiptNo || ""}`);
    doc.text(`Reference: ${r.reference || ""}`);
    if (r.paidAt) doc.text(`Paid At: ${new Date(r.paidAt).toLocaleString()}`);
    doc.moveDown();

    // Customer
    doc.font("Helvetica-Bold").fontSize(11).text("Customer", { underline: true });
    doc.font("Helvetica");
    doc.text(`${r.customer?.name || "—"}`);
    doc.text(`${r.customer?.email || "—"}`);
    if (r.customer?.phone) doc.text(r.customer.phone);
    doc.moveDown();

    // Ship To
    doc.font("Helvetica-Bold").fontSize(11).text("Ship To", { underline: true });
    const addr = r.order?.shippingAddress || {};
    [addr.houseNumber, addr.streetName, addr.town, addr.city, addr.state, addr.country]
      .filter(Boolean)
      .forEach((line: string) => doc.text(line));
    doc.moveDown();

    // Items
    doc.font("Helvetica-Bold").fontSize(11).text("Items", { underline: true });
    doc.moveDown(0.25);

    (r.order?.items || []).forEach((it: any) => {
      const title = it.title || "Item";
      const qty = Number(it.quantity || 1);
      const unit = Number(it.unitPrice || 0);
      const line = Number(it.lineTotal || unit * qty);

      doc
        .font("Helvetica")
        .fontSize(10)
        .text(
          `${title}  •  ${qty} × NGN ${unit.toLocaleString()}  =  NGN ${line.toLocaleString()}`
        );

      if (Array.isArray(it.selectedOptions) && it.selectedOptions.length > 0) {
        doc
          .fillColor("#555")
          .fontSize(9)
          .text(it.selectedOptions.map((o: any) => `${o.attribute}: ${o.value}`).join(" • "))
          .fillColor("#000");
      }
      doc.moveDown(0.25);
    });

    doc.moveDown();

    const subtotal = Number(r.order?.subtotal || 0);
    const tax = Number(r.order?.tax || 0);

    // IMPORTANT: your receipt snapshot stores shipping as object { total, breakdown }
    const shippingTotal = Number(r.order?.shipping?.total ?? r.order?.shippingTotal ?? 0);

    const total = Number(r.order?.total || 0);

    doc.font("Helvetica").fontSize(11);
    doc.text(`Subtotal: NGN ${subtotal.toLocaleString()}`);
    doc.text(`Tax: NGN ${tax.toLocaleString()}`);
    doc.text(`Shipping: NGN ${shippingTotal.toLocaleString()}`);
    if (serviceFee) doc.text(`Service fee: NGN ${serviceFee.toLocaleString()}`);

    doc.font("Helvetica-Bold").fontSize(12).text(`Total: NGN ${total.toLocaleString()}`);
    doc.moveDown(1);

    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#666")
      .text("Thank you for your purchase. This document serves as a receipt.", {
        align: "left",
      });

    doc.end();
  } catch (e: any) {
    const status = e?.status || 500;
    if (!res.headersSent) {
      res.status(status).json({ error: e?.message || "Failed to render receipt PDF" });
    }
  }
});

/* ----------------------------- Listings ----------------------------- */

router.post("/link", requireAuth, async (req: AuthedRequest, res: Response, next) => {
  try {
    const orderId = String(req.body?.orderId ?? "").trim();
    if (!orderId) return res.status(400).json({ error: "orderId is required" });

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true },
    });
    if (!order || order.userId !== req.user!.id) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: "JWT_SECRET not configured" });
    }

    const token = jwt.sign({ oid: orderId }, process.env.JWT_SECRET, { expiresIn: "2d" });
    const url = `${APP_URL}/payment?orderId=${encodeURIComponent(orderId)}&share=${encodeURIComponent(token)}`;
    res.json({ shareUrl: url });
  } catch (e) {
    next(e);
  }
});

router.get("/mine", requireAuth, async (req: AuthedRequest, res: Response, next) => {
  try {
    const limitRaw = Number(q1(req.query.limit));
    const take = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 5;

    const rows = await prisma.payment.findMany({
      where: { order: { userId: req.user!.id } },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        reference: true,
        amount: true,
        status: true,
        channel: true,
        provider: true,
        createdAt: true,
        orderId: true,
      },
    });

    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get("/", requireAuth, async (req: AuthedRequest, res: Response, next) => {
  try {
    const limitRaw = Number(q1(req.query.limit));
    const take = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 20;

    const userId = q1((req.query as any).userId).trim();
    const orderId = q1((req.query as any).orderId).trim();
    const status = q1((req.query as any).status).trim();

    const where: any = {};
    if (orderId) where.orderId = orderId;
    if (status) where.status = status.toUpperCase();

    const payments = await prisma.payment.findMany({
      where: userId ? { ...where, order: { userId } } : where,
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        reference: true,
        amount: true,
        status: true,
        channel: true,
        provider: true,
        createdAt: true,
        orderId: true,
      },
    });

    res.json(payments);
  } catch (e) {
    next(e);
  }
});

router.get("/recent", requireAuth, async (req: AuthedRequest, res: Response, next) => {
  try {
    const limitRaw = Number(q1(req.query.limit));
    const take = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 5;

    const orders = await prisma.order.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take,
      include: {
        payments: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            reference: true,
            amount: true,
            status: true,
            channel: true,
            provider: true,
            createdAt: true,
            paidAt: true,
          },
        },
        items: {
          select: {
            id: true,
            productId: true,
            variantId: true,
            title: true,
            unitPrice: true,
            quantity: true,
            lineTotal: true,
          },
        },
      },
    });

    const data = orders.map((o: any) => ({
      id: o.id,
      createdAt: o.createdAt,
      total: o.total,
      latestPayment: o.payments[0] || null,
      items: (o.items || []).map((it: any) => ({
        id: it.id,
        productId: it.productId,
        variantId: it.variantId,
        title: it.title ?? "—",
        unitPrice: it.unitPrice,
        quantity: it.quantity,
        lineTotal: it.lineTotal,
      })),
    }));

    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.get("/admin/compat-alias", requireAuth, async (req: AuthedRequest, res: Response, next) => {
  try {
    const isAdmin = (r?: string) => r === "ADMIN" || r === "SUPER_ADMIN";
    if (!isAdmin(req.user?.role)) return res.status(403).json({ error: "Forbidden" });

    (req as any).query.includeItems = (req as any).query.includeItems ?? "1";
    (req as any).query.limit = (req as any).query.limit ?? "20";

    const includeItems = q1(req.query.includeItems).trim() === "1";
    const q = q1(req.query.q).trim();
    const limitRaw = Number(q1(req.query.limit));
    const take = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 20;

    const where: any = {};
    if (q) {
      where.OR = [
        { reference: { contains: q, mode: "insensitive" } },
        { orderId: { contains: q, mode: "insensitive" } },
        { order: { user: { email: { contains: q, mode: "insensitive" } } } },
      ];
    }

    const rows = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      include: {
        order: {
          select: {
            id: true,
            total: true,
            status: true,
            user: { select: { email: true } },
            items: includeItems
              ? {
                  select: {
                    id: true,
                    title: true,
                    unitPrice: true,
                    quantity: true,
                    status: true,
                  },
                }
              : false,
          },
        },
      },
    });

    const data = rows.map((p: any) => ({
      id: p.id,
      orderId: p.orderId,
      userEmail: p.order?.user?.email || null,
      amount: Number(p.amount),
      status: p.status,
      provider: p.provider,
      channel: p.channel,
      reference: p.reference,
      createdAt: p.createdAt?.toISOString?.() ?? (p as any).createdAt,
      orderStatus: p.order?.status,
      items: Array.isArray((p.order as any)?.items)
        ? (p.order as any).items.map((it: any) => ({
            id: it.id,
            title: it.title,
            unitPrice: Number(it.unitPrice),
            quantity: Number(it.quantity || 0),
            lineTotal: Number(it.unitPrice) * Number(it.quantity || 0),
            status: it.status,
          }))
        : undefined,
    }));

    res.json({ data });
  } catch (e) {
    next(e);
  }
});

export default router;
