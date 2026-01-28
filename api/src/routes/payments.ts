// src/routes/payments.ts
import express, { Router } from 'express';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import crypto from 'crypto';

import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { logOrderActivity } from '../services/activity.service.js';
import { ps, toKobo } from '../lib/paystack.js';
import { generateRef8, isFresh, toNumber } from '../lib/payments.js';
import { issueReceiptIfNeeded } from '../lib/receipts.js';
import { getInitChannels } from '../config/paystack.js';
import {
  WEBHOOK_ACCEPT_CARD,
  WEBHOOK_ACCEPT_BANK_TRANSFER,
} from '../config/paystack.js';
import {
  notifySuppliersForOrder,
  notifyCustomerOrderPaid, // <-- NEW: send order-paid email
} from '../services/notify.js';
import PDFDocument from 'pdfkit';

// NEW: dynamic split computation
import { computePaystackSplitForOrder } from '../lib/splits.js';

// ✅ FIX: import enum directly (instead of Prisma.SupplierPaymentStatus)
import { SupplierPaymentStatus } from '@prisma/client'

const router = Router();

/* ----------------------------- Config ----------------------------- */

const isTrue = (v?: string | null) =>
  ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());

const TRIAL_MODE = isTrue(process.env.PAYMENTS_TRIAL_MODE);
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

const ACTIVE_PENDING_TTL_MIN = Number(process.env.PAYMENT_PENDING_TTL_MIN ?? 60);

const INLINE_APPROVAL = (process.env.INLINE_APPROVAL || 'auto').toLowerCase() as
  | 'auto'
  | 'manual';

const BANK_NAME = process.env.BANK_NAME || '';
const BANK_ACCOUNT_NAME = process.env.BANK_ACCOUNT_NAME || '';
const BANK_ACCOUNT_NUMBER = process.env.BANK_ACCOUNT_NUMBER || '';

/* ----------------------------- Helpers ----------------------------- */

function httpErr(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

type JwtUser = { id: string; role?: string | null };

function isValidSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
) {
  if (!signature) return false;
  const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  return hash === signature;
}

function calcPaystackFee(
  amountNaira: number,
  opts?: { international?: boolean },
) {
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

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ----------------------------- Split & Transfers ----------------------------- */

async function lookupBankCode(bankName?: string | null) {
  // TODO: Map "GTBank"->"058" etc. If you already store the numeric code, return it as-is.
  return (bankName || '').trim();
}

async function paySuppliersByTransfer(orderId: string, paymentId: string) {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: {
      chosenSupplierId: true,
      chosenSupplierUnitPrice: true,
      quantity: true,
    },
  });

  const bySupplier = new Map<string, number>();
  for (const it of items) {
    if (!it.chosenSupplierId) continue;
    const qty = Math.max(1, Number(it.quantity || 0));
    const cost = Number(it.chosenSupplierUnitPrice || 0) * qty;
    bySupplier.set(
      it.chosenSupplierId,
      (bySupplier.get(it.chosenSupplierId) || 0) + cost,
    );
  }
  if (bySupplier.size === 0) return;

  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: Array.from(bySupplier.keys()) } },
    select: {
      id: true,
      name: true,
      paystackRecipientCode: true,
      bankName: true,
      bankCode: true,
      bankCountry: true,
      accountNumber: true,
      accountName: true,
      isPayoutEnabled: true,
      bankVerificationStatus: true,
    },
  });

  for (const s of suppliers) {
    const amount = bySupplier.get(s.id) || 0;
    if (!(amount > 0)) continue;

    const payoutOk =
      s.isPayoutEnabled === true &&
      s.bankVerificationStatus === "VERIFIED" &&
      !!s.bankCode &&
      !!s.bankCountry &&
      !!s.accountNumber &&
      !!s.accountName;

    if (!payoutOk) {
      await prisma.paymentEvent.create({
        data: {
          paymentId,
          type: "TRANSFER_SKIPPED",
          data: { supplierId: s.id, reason: "supplier_not_payout_ready_or_verified" },
        },
      });
      continue;
    }

    if (!(amount > 0)) continue;

    try {
      let recipientCode = s.paystackRecipientCode || null;

      if (!recipientCode) {
        const bank_code = await lookupBankCode(s.bankCode ?? s.bankName); // ideally s.bankCode

        const r = await ps.post("/transferrecipient", {
          type: "nuban",
          name: s.accountName || s.name || "Supplier",
          account_number: s.accountNumber,
          bank_code,
          currency: "NGN",
        });
        recipientCode = r.data?.data?.recipient_code || null;
        if (recipientCode) {
          await prisma.supplier.update({
            where: { id: s.id },
            data: { paystackRecipientCode: recipientCode },
          });
        }
      }

      if (!recipientCode) {
        await prisma.paymentEvent.create({
          data: {
            paymentId,
            type: 'TRANSFER_SKIPPED',
            data: { supplierId: s.id, reason: 'no recipient' },
          },
        });
        continue;
      }

      const tr = await ps.post('/transfer', {
        source: 'balance',
        amount: Math.round(amount * 100),
        recipient: recipientCode,
        reason: `Order ${orderId} supplier payout`,
      });

      await prisma.paymentEvent.create({
        data: {
          paymentId,
          type: 'TRANSFER_INIT',
          data: { supplierId: s.id, amount, transfer: tr.data?.data },
        },
      });
    } catch (e: any) {
      console.error('transfer failed', e?.response?.data || e?.message);
      await prisma.paymentEvent.create({
        data: {
          paymentId,
          type: 'TRANSFER_ERROR',
          data: { supplierId: s.id, amount, error: e?.message },
        },
      });
    }
  }
}

/* ----------------------------- PO helpers (idempotent + allocations) ----------------------------- */

function generateSupplierOrderRef() {
  // e.g. "SPO-7G5Q-2K9M"
  const chunk = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SPO-${chunk()}-${chunk()}`;
}

async function ensureSupplierOrderRef(
  tx: any,
  orderId: string,
  supplierId: string,
): Promise<string> {
  // 1) Existing PO
  const existingPO = await tx.purchaseOrder.findFirst({
    where: { orderId, supplierId },
    orderBy: { createdAt: 'asc' },
    select: { supplierOrderRef: true },
  });
  if (existingPO?.supplierOrderRef) return existingPO.supplierOrderRef;

  // 2) From activity log
  const refAct = await tx.orderActivity.findFirst({
    where: { orderId, supplierId, type: 'SUPPLIER_REF_CREATED' },
    orderBy: { createdAt: 'asc' },
    select: { meta: true },
  });
  const fromAct =
    (refAct?.meta as any)?.supplierOrderRef || (refAct?.meta as any)?.supplierRef;
  if (fromAct && typeof fromAct === 'string' && fromAct.trim()) {
    return fromAct.trim();
  }

  // 3) Generate + log
  const ref = generateSupplierOrderRef();
  try {
    await tx.orderActivity.create({
      data: {
        orderId,
        supplierId,
        type: 'SUPPLIER_REF_CREATED',
        message: `Supplier reference created for supplier ${supplierId}`,
        meta: { supplierOrderRef: ref },
      },
    });
  } catch {
    // non-fatal
  }
  return ref;
}

/**
 * ✅ Idempotent PO builder:
 * - groups OrderItems by chosenSupplierId
 * - upserts/updates one PurchaseOrder per supplier
 * - recreates PurchaseOrderItems links
 *
 * IMPORTANT: This runs inside the PAID finalize tx, so UI can show POs immediately.
 */
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
    { supplierId: string; supplierAmount: number; customerSubtotal: number; itemIds: string[] }
  >();

  for (const it of items) {
    const sid = it.chosenSupplierId ? String(it.chosenSupplierId) : '';
    if (!sid) continue;

    const qty = Math.max(0, Number(it.quantity ?? 0));
    const supplierUnit = Number(it.chosenSupplierUnitPrice ?? 0) || 0;
    const supplierLine = supplierUnit * qty;

    const customerLine =
      it.lineTotal != null
        ? Number(it.lineTotal ?? 0)
        : (Number(it.unitPrice ?? 0) || 0) * qty;

    const cur =
      bySupplier.get(sid) ?? { supplierId: sid, supplierAmount: 0, customerSubtotal: 0, itemIds: [] };

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

    // Keep a stable supplierOrderRef per (order,supplier)
    const supplierOrderRef = await ensureSupplierOrderRef(tx, orderId, sid);

    // Upsert without requiring @@unique([orderId,supplierId]) (works even if you don't have it)
    let po = await tx.purchaseOrder.findFirst({
      where: { orderId, supplierId: sid },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (!po) {
      // create (handle possible race)
      try {
        po = await tx.purchaseOrder.create({
          data: {
            orderId,
            supplierId: sid,
            subtotal: customerSubtotal,
            platformFee,
            supplierAmount,
            status: 'CREATED',
            supplierOrderRef,
          },
          select: { id: true },
        });
      } catch (e: any) {
        // if concurrent create happened, re-read then update
        po = await tx.purchaseOrder.findFirst({
          where: { orderId, supplierId: sid },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!po) throw e;
      }
    }

    // update amounts (idempotent)
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        subtotal: customerSubtotal,
        platformFee,
        supplierAmount,
        supplierOrderRef,
      },
    });

    // recreate PO items
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
 * ✅ Allocations must be written when a payment becomes PAID.
 * Your Orders UI reads: order.payments[].allocations[].
 */
async function recordSupplierAllocationsOnPaidTx(tx: any, paymentId: string, orderId: string) {
  const pos = await tx.purchaseOrder.findMany({
    where: { orderId },
    include: { supplier: { select: { id: true, name: true } } },
  });

  if (!pos.length) return [];

  // idempotency
  await tx.supplierPaymentAllocation.deleteMany({ where: { paymentId } });

  const rows = [];
  for (const po of pos) {
    rows.push(
      await tx.supplierPaymentAllocation.create({
        data: {
          paymentId,
          orderId,
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          amount: po.supplierAmount,
          status: SupplierPaymentStatus.HELD, // ✅ HELD concept maps to PENDING in your schema
          supplierNameSnapshot: po.supplier?.name ?? null,
          meta: { purchaseOrderStatus: po.status },
        },
      }),
    );

    // optional: mark PO funded
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: 'FUNDED' },
    });
  }

  // optional snapshot on payment
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

async function paySupplierForPurchaseOrder(purchaseOrderId: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      orderId: true,
      supplierId: true,
      supplierAmount: true,
      status: true,
    },
  });
  if (!po) throw new Error("PO not found");

  // Find latest PAID payment for order (so paymentId exists for logging)
  const pay = await prisma.payment.findFirst({
    where: { orderId: po.orderId, status: "PAID" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const paymentId = pay?.id;
  if (!paymentId) throw new Error("No PAID payment found for order");

  // Idempotency: don’t pay twice
  const already = await prisma.paymentEvent.findFirst({
    where: { paymentId, type: "TRANSFER_INIT", data: { path: ["purchaseOrderId"], equals: purchaseOrderId } },
  });
  if (already) return;

  const s = await prisma.supplier.findUnique({
    where: { id: po.supplierId },
    select: {
      id: true,
      name: true,
      paystackRecipientCode: true,
      bankName: true,
      bankCode: true,
      bankCountry: true,
      accountNumber: true,
      accountName: true,
      isPayoutEnabled: true,
      bankVerificationStatus: true,
    },
  });
  if (!s) throw new Error("Supplier not found");

  const amount = Number(po.supplierAmount ?? 0);
  if (!(amount > 0)) return;

  const payoutOk =
    s.isPayoutEnabled === true &&
    s.bankVerificationStatus === "VERIFIED" &&
    !!s.bankCode &&
    !!s.bankCountry &&
    !!s.accountNumber &&
    !!s.accountName;

  if (!payoutOk) {
    await prisma.paymentEvent.create({
      data: {
        paymentId,
        type: "TRANSFER_SKIPPED",
        data: { supplierId: s.id, purchaseOrderId, reason: "supplier_not_payout_ready_or_verified" },
      },
    });
    return;
  }

  if (TRIAL_MODE) {
    await prisma.paymentEvent.create({
      data: {
        paymentId,
        type: "TRANSFER_SKIPPED",
        data: { supplierId: s.id, purchaseOrderId, reason: "TRIAL_MODE", amount },
      },
    });
    return;
  }

  // Create recipient code if missing (re-use your existing code)
  let recipientCode = s.paystackRecipientCode || null;
  if (!recipientCode) {
    const bank_code = await lookupBankCode(s.bankCode ?? s.bankName);
    const r = await ps.post("/transferrecipient", {
      type: "nuban",
      name: s.accountName || s.name || "Supplier",
      account_number: s.accountNumber,
      bank_code,
      currency: "NGN",
    });
    recipientCode = r.data?.data?.recipient_code || null;
    if (recipientCode) {
      await prisma.supplier.update({ where: { id: s.id }, data: { paystackRecipientCode: recipientCode } });
    }
  }

  if (!recipientCode) {
    await prisma.paymentEvent.create({
      data: {
        paymentId,
        type: "TRANSFER_SKIPPED",
        data: { supplierId: s.id, purchaseOrderId, reason: "no recipient" },
      },
    });
    return;
  }

  const tr = await ps.post("/transfer", {
    source: "balance",
    amount: Math.round(amount * 100),
    recipient: recipientCode,
    reason: `PO ${purchaseOrderId} payout for order ${po.orderId}`,
  });

  await prisma.paymentEvent.create({
    data: {
      paymentId,
      type: "TRANSFER_INIT",
      data: { supplierId: s.id, purchaseOrderId, amount, transfer: tr.data?.data },
    },
  });

  // update allocation status to PAID_OUT
  await prisma.supplierPaymentAllocation.updateMany({
    where: { purchaseOrderId, paymentId },
    data: { status: SupplierPaymentStatus.PAID }, // adjust to your enum
  });
}


/* ----------------------------- Core finalize ----------------------------- */

async function finalizePaidFlow(paymentId: string) {
  console.log('[finalizePaidFlow] start', { paymentId });

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

    if (!p || p.status !== 'PAID' || !p.orderId) return null;

    // Cancel other pending attempts for same order
    await tx.payment.updateMany({
      where: {
        orderId: p.orderId,
        status: 'PENDING',
        NOT: { id: p.id },
      },
      data: { status: 'CANCELED' },
    });

    // Move order to next status
    const next =
      process.env.TURN_OFF_AWAIT_CONF === 'true' ? 'PAID' : 'AWAITING_FULFILLMENT';

    await tx.order.update({
      where: { id: p.orderId },
      data: { status: next },
    });

    // Record service fee slice (if applicable)
    const total = Number(p.order?.total) || 0;
    const svc = Number(p.order?.serviceFeeTotal) || 0;
    const amt = Number(p.amount) || 0;

    if (total > 0 && svc > 0 && amt > 0) {
      const slice = svc * Math.max(0, Math.min(1, amt / total));
      await tx.orderComms.upsert({
        where: { paymentId: p.id },
        create: {
          orderId: p.orderId,
          paymentId: p.id,
          amount: slice,
          channel: p.channel ?? null,
          reason: 'SUPPLIER_NOTIFY',
        },
        update: {
          amount: slice,
          channel: p.channel ?? null,
          reason: 'SUPPLIER_NOTIFY',
        },
      });
    }

    await tx.paymentEvent.create({
      data: {
        paymentId: p.id,
        type: 'FINALIZE_PAID',
        data: { reference: p.reference },
      },
    });

    // ✅ FIX BUG #2 HERE:
    // Create/refresh Purchase Orders + write SupplierPaymentAllocations in the SAME PAID finalize TX.
    await ensurePurchaseOrdersForOrderTx(tx, p.orderId);
    await recordSupplierAllocationsOnPaidTx(tx, p.id, p.orderId);

    return { orderId: p.orderId, paymentId: p.id };
  });

  if (!result) return;

  const { orderId } = result;

  // Supplier notifications (idempotent via SUPPLIER_NOTIFIED)
  const alreadyNotified = await prisma.paymentEvent.findFirst({
    where: {
      paymentId: result.paymentId,
      type: 'SUPPLIER_NOTIFIED',
    },
  });

  if (!alreadyNotified) {
    try {
      await notifySuppliersForOrder(orderId);
      await prisma.paymentEvent.create({
        data: {
          paymentId: result.paymentId,
          type: 'SUPPLIER_NOTIFIED',
        },
      });
    } catch (e) {
      console.error('notifySuppliersForOrder failed', e);
    }
  }

  // Payouts: if no split used at init, do transfers
  const usedSplit = await prisma.paymentEvent.findFirst({
    where: {
      paymentId: result.paymentId,
      type: 'SPLIT_USED',
    },
  });

  // ✅ Option A: HOLD supplier funds until delivery OTP per PurchaseOrder is verified.
  await prisma.paymentEvent.create({
    data: {
      paymentId: result.paymentId,
      type: "SUPPLIER_PAYOUTS_HELD",
      data: { orderId, reason: "awaiting_delivery_otp" },
    },
  });

  // ❌ REMOVE the old async PO creation (it causes “PO/allocations not showing” timing bugs)
  // setImmediate(() => createPurchaseOrdersForOrder(orderId).catch(console.error));

  // Receipt
  try {
    await issueReceiptIfNeeded(result.paymentId);
  } catch (e) {
    console.error('issueReceiptIfNeeded failed', e);
  }

  // Profit recomputation
  try {
    await recomputeProfitForPayment(result.paymentId);
  } catch (e) {
    console.error('recomputeProfitForPayment failed', e);
  }

  // Customer email: Order Paid (idempotent via ORDER_PAID_EMAIL_SENT)
  const alreadyEmailed = await prisma.paymentEvent.findFirst({
    where: {
      paymentId: result.paymentId,
      type: 'ORDER_PAID_EMAIL_SENT',
    },
  });

  if (!alreadyEmailed) {
    try {
      await notifyCustomerOrderPaid(orderId, result.paymentId);
      await prisma.paymentEvent.create({
        data: {
          paymentId: result.paymentId,
          type: 'ORDER_PAID_EMAIL_SENT',
          data: { orderId },
        },
      });
    } catch (e) {
      console.error('notifyCustomerOrderPaid failed', e);
    }
  }

  console.log('[finalizePaidFlow] done', result);
}

/* ----------------------------- Config helpers ----------------------------- */

async function getSettingNumber(
  key: string,
  defaultVal = 0,
): Promise<number> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    const n = Number(row?.value);
    return Number.isFinite(n) ? n : defaultVal;
  } catch {
    return defaultVal;
  }
}

/* ----------------------------- Legacy PO builder (kept, but no longer used by finalize) ----------------------------- */
/**
 * NOTE:
 * This method is now redundant for the paid flow because finalizePaidFlow
 * creates idempotent POs + allocations immediately.
 * Kept only if you call it elsewhere manually.
 */
export async function createPurchaseOrdersForOrder(orderId: string) {
  await prisma.$transaction(async (tx: any) => {
    await ensurePurchaseOrdersForOrderTx(tx, orderId);
  });
}

/* ----------------------------- Profit recompute ----------------------------- */

async function getCheapestUnitCost(productId: string, variantId?: string | null) {
  // Variant offer cost = basePrice + priceBump (if linked to a base offer)
  if (variantId) {
    const offers = await prisma.supplierVariantOffer.findMany({
      where: {
        productId,
        variantId,
        isActive: true,
        inStock: true,
        availableQty: { gt: 0 },
      },
      select: {
        priceBump: true,
        supplierProductOffer: { select: { basePrice: true } },
      },
    });

    let best = Infinity;
    for (const o of offers) {
      const base = Number(o.supplierProductOffer?.basePrice ?? 0);
      const bump = Number(o.priceBump ?? 0);
      best = Math.min(best, base + bump);
    }
    if (Number.isFinite(best)) return best;
    // fall through to base offers if none
  }

  // Base offer cost = basePrice
  const base = await prisma.supplierProductOffer.findFirst({
    where: {
      productId,
      isActive: true,
      inStock: true,
      availableQty: { gt: 0 },
    },
    orderBy: { basePrice: 'asc' },
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
      const key = `${it.productId}|${it.variantId ?? 'NULL'}`;
      if (!offerCache.has(key)) {
        const cheapest = await getCheapestUnitCost(String(it.productId), it.variantId ?? null);
        offerCache.set(key, Number(cheapest ?? 0));
      }
      unitCost = offerCache.get(key)!;
    }

    cogs += unitCost * qty;
  }

  const gateway = Number(p.feeAmount || 0);

  const commsAgg = await prisma.orderComms.aggregate({
    _sum: { amount: true },
    where: { orderId: p.orderId, reason: 'SUPPLIER_NOTIFY' },
  });
  const comms = Number(commsAgg._sum.amount || 0);

  const baseServiceFee =
    Number(
      (await readSetting('serviceFeeBaseNGN')) ??
      (await readSetting('platformBaseFeeNGN')) ??
      0,
    ) || 0;

  const amountPaid = Number(p.amount || 0);

  const profitMode = (
    (await readSetting('profitMode')) ?? 'accurate'
  ).toLowerCase(); // "accurate" | "simple"

  const profit =
    profitMode === 'simple'
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
      type: 'PROFIT_COMPUTED',
      data: breakdown,
    },
  });

  await prisma.orderActivity.create({
    data: {
      orderId: p.orderId,
      type: 'PROFIT_COMPUTED',
      message: `Profit computed: ₦${profit.toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })}`,
      meta: breakdown,
    },
  });
}

/* ----------------------------- Public endpoints ----------------------------- */

/**
 * GET /api/payments/summary
 */
router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const agg = await prisma.payment.aggregate({
      _sum: { amount: true },
      where: {
        status: 'PAID',
        order: { userId: req.user!.id },
      },
    });
    const totalPaid = Number(agg._sum.amount || 0);
    res.json({ totalPaid, currency: 'NGN' });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/payments/init  { orderId, channel? }
 * (with dynamic split & logging)
 */
router.post('/init', requireAuth, async (req: Request, res: Response) => {
  const { orderId } = req.body ?? {};
  let { channel } = req.body ?? {};
  const userId = req.user!.id;
  const userEmail = req.user!.email;

  channel = String(channel || 'paystack').toLowerCase();

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: { id: true, total: true, createdAt: true },
  });
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const paid = await prisma.payment.findFirst({
    where: { orderId, status: 'PAID' },
    select: { id: true },
  });
  if (paid) {
    return res.status(409).json({ error: 'Order already paid' });
  }

  let pay = await prisma.payment.findFirst({
    where: { orderId, status: 'PENDING', channel },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      reference: true,
      createdAt: true,
      channel: true,
      providerPayload: true,
      status: true,
    },
  });

  if (
    pay &&
    isFresh(pay.createdAt, ACTIVE_PENDING_TTL_MIN) &&
    channel === 'paystack'
  ) {
    const authUrl = (pay.providerPayload as any)?.authorization_url;
    if (authUrl) {
      await logOrderActivity(
        orderId,
        'PAYMENT_RESUME',
        'Resumed existing Paystack attempt',
        { reference: pay.reference },
      );
      return res.json({
        mode: 'paystack',
        reference: pay.reference,
        authorization_url: authUrl,
      });
    }
  }

  if (pay && !isFresh(pay.createdAt, ACTIVE_PENDING_TTL_MIN)) {
    await prisma.payment.update({
      where: { id: pay.id },
      data: { status: 'CANCELED' },
    });
    pay = null as any;
  }

  if (!pay) {
    const created = await prisma.payment.create({
      data: {
        orderId,
        reference: generateRef8(),
        channel,
        amount: order.total,
        status: 'PENDING',
        provider: channel === 'paystack' ? 'PAYSTACK' : null,
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
    await logOrderActivity(orderId, 'PAYMENT_INIT', `Trial init (${channel})`, {
      reference: pay.reference,
      channel,
      amount: toNumber(order.total),
    });
    return res.json({
      mode: 'trial',
      reference: pay.reference,
      amount: toNumber(order.total),
      currency: 'NGN',
      autoPaid: INLINE_APPROVAL === 'auto',
      bank: {
        bank_name: 'Demo Bank',
        account_name: 'DaySpring',
        account_number: '0123456789',
      },
    });
  }

  if (channel === 'paystack') {
    const channels = getInitChannels();
    const callback_url = `${APP_URL}/payment-callback?orderId=${orderId}&reference=${pay.reference}&gateway=paystack`;

    let split_code: string | undefined;
    try {
      const split = await computePaystackSplitForOrder(orderId);
      // ✅ Option A: NO split codes. Platform receives full amount.
      // Keep a trace event so we know we’re in “HOLD THEN TRANSFER” mode.
      await prisma.paymentEvent.create({
        data: { paymentId: pay.id, type: "SPLIT_DISABLED_OPTION_A" },
      });

    } catch (e: any) {
      console.error('paystack split create failed', e?.response?.data || e?.message);
    }

    const initPayload: any = {
      email: userEmail,
      amount: toKobo(order.total),
      reference: pay.reference,
      currency: 'NGN',
      callback_url,
      channels,
      metadata: {
        orderId,
        userId: req.user!.id,
        splitApplied: !!split_code,
        custom_fields: [
          {
            display_name: 'Order Ref',
            variable_name: 'order_ref',
            value: pay.reference,
          },
        ],
      },
      customizations: {
        title: 'DaySpring',
        description: `Order ${order.id} • Use Payment Ref: ${pay.reference}`,
        logo: process.env.PAYSTACK_LOGO_URL || undefined,
      },
    };
    if (split_code) initPayload.split_code = split_code;

    const resp = await ps.post('/transaction/initialize', initPayload);
    const data = resp.data?.data;

    await prisma.payment.update({
      where: { id: pay.id },
      data: {
        providerPayload: data,
        initPayload,
        provider: 'PAYSTACK',
        channel: 'paystack',
      },
    });

    await logOrderActivity(orderId, 'PAYMENT_INIT', 'Paystack init', {
      reference: pay.reference,
      amount: toNumber(order.total),
    });

    return res.json({
      mode: 'paystack',
      reference: pay.reference,
      authorization_url: data?.authorization_url,
      data,
    });
  }

  await logOrderActivity(orderId, 'PAYMENT_INIT', 'Inline bank init', {
    reference: pay.reference,
    amount: toNumber(order.total),
  });

  return res.json({
    mode: 'paystack_inline_bank',
    reference: pay.reference,
    amount: toNumber(order.total),
    currency: 'NGN',
    bank: {
      bank_name: BANK_NAME || 'GTB Banks Virtual',
      account_name: BANK_ACCOUNT_NAME || 'DaySpring',
      account_number: BANK_ACCOUNT_NUMBER || '0123456789',
    },
  });
});

/* ----------------------------- Verification ----------------------------- */

async function verifyPaystack(reference: string) {
  const { data } = await axios.get(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    },
  );

  const tx = data?.data;
  if (!tx || tx.status !== 'success') {
    throw new Error('Verification failed');
  }

  const amountNaira = Math.round(Number(tx.amount || 0)) / 100;

  let feeNaira = 0;
  if (typeof tx.fees === 'number') {
    feeNaira = Math.round(Number(tx.fees)) / 100;
  } else {
    const isIntl =
      (tx.authorization?.country_code && tx.authorization.country_code !== 'NG') ||
      tx.currency !== 'NGN';
    feeNaira = calcPaystackFee(amountNaira, { international: !!isIntl });
  }

  await prisma.payment.update({
    where: { reference },
    data: {
      status: 'PAID',
      paidAt: new Date(tx.paid_at || Date.now()),
      amount: amountNaira,
      feeAmount: feeNaira,
      providerPayload: tx,
      provider: 'PAYSTACK',
      channel: String(tx.channel || tx.authorization?.channel || 'paystack').toLowerCase(),
    },
  });

  return { amountNaira, feeNaira, tx };
}

// POST /api/payments/verify  { orderId, reference }
router.post('/verify', requireAuth, async (req: Request, res: Response) => {
  const { orderId, reference } = req.body ?? {};
  if (!orderId || !reference) {
    return res.status(400).json({ error: 'orderId and reference required' });
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
    return res.status(404).json({ error: 'Payment not found' });
  }

  if (pay.status === 'PAID') {
    return res.json({
      ok: true,
      status: 'PAID',
      message: 'Already verified',
    });
  }
  if (['FAILED', 'CANCELED', 'REFUNDED'].includes(pay.status)) {
    await logOrderActivity(orderId, 'PAYMENT_FAILED', 'Verification attempted on non-pending payment', {
      reference,
    });
    return res.json({
      ok: true,
      status: pay.status,
      message: 'Payment is not successful',
    });
  }

  if (TRIAL_MODE || pay.channel !== 'paystack') {
    if (INLINE_APPROVAL === 'manual') {
      await prisma.paymentEvent.create({
        data: {
          paymentId: pay.id,
          type: 'VERIFY_PENDING',
          data: { reference, note: 'Manual approval required' },
        },
      });
      await logOrderActivity(orderId, 'PAYMENT_PENDING', 'Awaiting manual confirmation', { reference });
      return res.json({
        ok: true,
        status: 'PENDING',
        message: 'Awaiting confirmation',
      });
    }

    const updated = await prisma.payment.update({
      where: { id: pay.id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
      },
      select: { id: true },
    });

    await finalizePaidFlow(updated.id);
    return res.json({
      ok: true,
      status: 'PAID',
      message: 'Payment verified (trial/virtual)',
    });
  }

  try {
    const vr = await ps.get(`/transaction/verify/${reference}`);
    const pData = vr.data?.data;
    const status: string | undefined = pData?.status;
    const gatewayRef = pData?.reference;

    if (gatewayRef && gatewayRef !== reference) {
      await prisma.paymentEvent.create({
        data: {
          paymentId: pay.id,
          type: 'VERIFY_MISMATCH',
          data: { reference, gatewayRef, status },
        },
      });
      return res.status(400).json({ error: 'Reference mismatch from gateway' });
    }

    if (status === 'success') {
      await prisma.payment.update({
        where: { id: pay.id },
        data: { providerPayload: pData },
      });
      await verifyPaystack(reference);
      const p = await prisma.payment.findUnique({
        where: { reference },
        select: { id: true },
      });
      if (p?.id) {
        await finalizePaidFlow(p.id);
      }
      return res.json({
        ok: true,
        status: 'PAID',
        message: 'Payment verified',
      });
    }

    if (status === 'failed') {
      await prisma.$transaction(async (tx: any) => {
        await tx.payment.update({
          where: { id: pay.id },
          data: {
            status: 'FAILED',
            providerPayload: pData,
          },
        });
        await tx.paymentEvent.create({
          data: {
            paymentId: pay.id,
            type: 'VERIFY_FAILED',
            data: { reference, status },
          },
        });
      });
      await logOrderActivity(orderId, 'PAYMENT_FAILED', 'Gateway reported failure', { reference });
      return res.json({
        ok: true,
        status: 'FAILED',
        message: 'Payment failed',
      });
    }

    await prisma.paymentEvent.create({
      data: {
        paymentId: pay.id,
        type: 'VERIFY_PENDING',
        data: { reference, status: status ?? 'unknown' },
      },
    });
    await logOrderActivity(orderId, 'PAYMENT_PENDING', 'Awaiting confirmation', { reference });
    return res.json({
      ok: true,
      status: 'PENDING',
      message: 'Awaiting confirmation',
    });
  } catch (e: any) {
    await prisma.paymentEvent.create({
      data: {
        paymentId: pay.id,
        type: 'VERIFY_ERROR',
        data: { reference, err: e?.message },
      },
    });
    return res.json({
      ok: true,
      status: 'PENDING',
      message: 'Could not verify yet; try again shortly',
    });
  }
});

// Optional admin helper: POST /api/payments/:reference/verify
router.post('/:reference/verify', requireAuth, async (req, res) => {
  try {
    const { reference } = req.params;
    const result = await verifyPaystack(reference);
    const p = await prisma.payment.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (p?.id) {
      await finalizePaidFlow(p.id);
    }
    return res.json({ data: result });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || 'Verification failed' });
  }
});

/* ----------------------------- Webhook ----------------------------- */

router.post(
  '/webhook/paystack',
  express.raw({ type: '*/*' }),
  async (req, res) => {
    try {
      const sig = req.headers['x-paystack-signature'] as string | undefined;
      const secret = process.env.PAYSTACK_SECRET_KEY || '';
      if (!isValidSignature(req.body as Buffer, sig, secret)) {
        return res.status(401).send('bad sig');
      }

      const evt = JSON.parse((req.body as Buffer).toString('utf8'));
      const eventType = String(evt?.event || '');
      const data = evt?.data || {};
      const reference: string | undefined = data?.reference;
      const channel: string | undefined = data?.channel || data?.authorization?.channel;

      if (channel === 'card' && !WEBHOOK_ACCEPT_CARD) {
        return res.status(200).send('ignored: card off');
      }
      if (
        (channel === 'bank' || channel === 'bank_transfer') &&
        !WEBHOOK_ACCEPT_BANK_TRANSFER
      ) {
        return res.status(200).send('ignored: bank_transfer off');
      }

      if (reference) {
        try {
          const pay = await prisma.payment.findUnique({ where: { reference } });
          if (pay) {
            await prisma.paymentEvent.create({
              data: {
                paymentId: pay.id,
                type: eventType || 'webhook',
                data: evt,
              },
            });
          }
        } catch {
          // ignore logging issues
        }
      }

      if (eventType === 'charge.success') {
        if (reference) {
          await verifyPaystack(reference);
          const p = await prisma.payment.findUnique({
            where: { reference },
            select: { id: true },
          });
          if (p?.id) {
            await finalizePaidFlow(p.id);
          }
        }
        return res.status(200).send('ok');
      }

      if (eventType === 'transfer.success' || eventType === 'transfer.failed') {
        return res.status(200).send('ok');
      }

      return res.status(200).send('ok');
    } catch (e: any) {
      // Always ack to stop retries
      return res.status(200).send('ok');
    }
  },
);

/* ----------------------------- Status & receipts ----------------------------- */

router.get('/status', requireAuth, async (req, res) => {
  try {
    const orderId = String(req.query.orderId || '');
    const reference = String(req.query.reference || '');
    if (!orderId || !reference) {
      return res.status(400).json({
        error: 'orderId and reference are required',
      });
    }

    const pay = await prisma.payment.findFirst({
      where: {
        reference,
        orderId,
        order: { userId: req.user!.id },
      },
      select: { status: true },
    });

    if (!pay) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    return res.json({ status: pay.status });
  } catch (e: any) {
    console.error('payments/status error', e);
    return res.status(500).json({ error: 'Failed to fetch payment status' });
  }
});

export async function assertCanViewReceipt(paymentKey: string, user: JwtUser) {
  const row = await prisma.payment.findFirst({
    where: {
      OR: [{ id: paymentKey }, { reference: paymentKey }],
    },
    select: {
      id: true,
      orderId: true,
      status: true,
      order: { select: { userId: true } },
    },
  });

  if (!row || row.status !== 'PAID') {
    throw httpErr(404, 'Not found');
  }

  const role = (user?.role || '').toUpperCase();
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const isOwner = row.order?.userId && user?.id && row.order.userId === user.id;

  if (!isOwner && !isAdmin) {
    throw httpErr(403, 'Forbidden');
  }

  return row;
}

router.get('/:paymentKey/receipt', requireAuth, async (req, res) => {
  try {
    const { paymentKey } = req.params;
    const row = await assertCanViewReceipt(paymentKey, req.user!);

    const pay = await issueReceiptIfNeeded(row.id);
    if (!pay) {
      return res.status(404).json({ error: 'Receipt not available' });
    }

    const r = (pay.receiptData || {}) as any;

    let serviceFee =
      Number(r.order?.serviceFeeTotal ?? r.order?.commsTotal ?? r.order?.comms ?? 0) || 0;

    if (!serviceFee && row.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: row.orderId },
        select: { serviceFeeTotal: true },
      });
      if (order?.serviceFeeTotal != null) {
        serviceFee = Number(order.serviceFeeTotal) || 0;
      }
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
    return res.status(status).json({
      error: e?.message || 'Failed to fetch receipt',
    });
  }
});

router.get('/:paymentKey/receipt.pdf', requireAuth, async (req, res) => {
  try {
    const { paymentKey } = req.params;

    const row = await assertCanViewReceipt(paymentKey, req.user!);

    const pay = await issueReceiptIfNeeded(row.id);
    if (!pay?.receiptData) {
      return res.status(404).json({ error: 'Receipt not available' });
    }

    const r = pay.receiptData as any;

    let serviceFee =
      Number(r.order?.serviceFeeTotal ?? r.order?.commsTotal ?? r.order?.comms ?? 0) || 0;

    if (!serviceFee && row.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: row.orderId },
        select: { serviceFeeTotal: true },
      });
      if (order?.serviceFeeTotal != null) {
        serviceFee = Number(order.serviceFeeTotal) || 0;
      }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pay.receiptNo || 'receipt'}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    doc.pipe(res);

    // Header
    doc.font('Helvetica-Bold').fontSize(18).text(r.merchant?.name || 'Receipt');
    doc.moveDown(0.5);

    doc.font('Helvetica').fontSize(10).fillColor('#555');
    doc.text(r.merchant?.addressLine1 || '');
    if (r.merchant?.addressLine2) doc.text(r.merchant.addressLine2);
    if (r.merchant?.supportEmail) doc.text(`Support: ${r.merchant.supportEmail}`);
    doc.moveDown();
    doc.fillColor('#000');

    // Meta
    doc.font('Helvetica').fontSize(12);
    doc.text(`Receipt No: ${pay.receiptNo || ''}`);
    doc.text(`Reference: ${r.reference}`);
    if (r.paidAt) {
      doc.text(`Paid At: ${new Date(r.paidAt).toLocaleString()}`);
    }
    doc.moveDown();

    // Customer
    doc.font('Helvetica-Bold').fontSize(11).text('Customer', { underline: true });
    doc.font('Helvetica');
    doc.text(`${r.customer?.name || '—'}`);
    doc.text(`${r.customer?.email || '—'}`);
    if (r.customer?.phone) doc.text(r.customer.phone);
    doc.moveDown();

    // Ship To
    doc.font('Helvetica-Bold').fontSize(11).text('Ship To', { underline: true });
    const addr = r.order?.shippingAddress || {};
    [
      addr.houseNumber,
      addr.streetName,
      addr.town,
      addr.city,
      addr.state,
      addr.country,
    ]
      .filter(Boolean)
      .forEach((line: string) => doc.text(line));
    doc.moveDown();

    // Items
    doc.font('Helvetica-Bold').fontSize(11).text('Items', { underline: true });
    doc.moveDown(0.25);

    r.order?.items?.forEach((it: any) => {
      const title = it.title || 'Item';
      const qty = Number(it.quantity || 1);
      const unit = Number(it.unitPrice || 0);
      const line = Number(it.lineTotal || unit * qty);

      doc
        .font('Helvetica')
        .fontSize(10)
        .text(
          `${title}  •  ${qty} × NGN ${unit.toLocaleString()}  =  NGN ${line.toLocaleString()}`,
        );

      if (Array.isArray(it.selectedOptions) && it.selectedOptions.length > 0) {
        doc
          .fillColor('#555')
          .fontSize(9)
          .text(
            it.selectedOptions.map((o: any) => `${o.attribute}: ${o.value}`).join(' • '),
          )
          .fillColor('#000');
      }
      doc.moveDown(0.25);
    });

    doc.moveDown();

    const subtotal = Number(r.order?.subtotal || 0);
    const tax = Number(r.order?.tax || 0);
    const shipping = Number(r.order?.shipping || 0);
    const total = Number(r.order?.total || 0);

    doc.font('Helvetica').fontSize(11);
    doc.text(`Subtotal: NGN ${subtotal.toLocaleString()}`);
    doc.text(`Tax: NGN ${tax.toLocaleString()}`);
    doc.text(`Shipping: NGN ${shipping.toLocaleString()}`);
    if (serviceFee) {
      doc.text(`Service fee: NGN ${serviceFee.toLocaleString()}`);
    }

    doc.font('Helvetica-Bold').fontSize(12).text(`Total: NGN ${total.toLocaleString()}`);
    doc.moveDown(1);

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#666')
      .text('Thank you for your purchase. This document serves as a receipt.', {
        align: 'left',
      });

    doc.end();
  } catch (e: any) {
    const status = e?.status || 500;
    if (!res.headersSent) {
      res.status(status).json({
        error: e?.message || 'Failed to render receipt PDF',
      });
    }
  }
});

/* ----------------------------- Listings ----------------------------- */

router.post('/link', requireAuth, async (req, res, next) => {
  try {
    const { orderId } = req.body as { orderId: string };
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== req.user!.id) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'JWT_SECRET not configured' });
    }

    const token = jwt.sign({ oid: orderId }, process.env.JWT_SECRET, { expiresIn: '2d' });
    const url = `${APP_URL}/payment?orderId=${orderId}&share=${encodeURIComponent(token)}`;
    res.json({ shareUrl: url });
  } catch (e) {
    next(e);
  }
});

router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const limitRaw = Number(req.query.limit);
    const take = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 5;

    const rows = await prisma.payment.findMany({
      where: { order: { userId: req.user!.id } },
      orderBy: { createdAt: 'desc' },
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

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const limitRaw = Number(req.query.limit);
    const take = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 20;

    const { userId, orderId, status } = req.query as {
      userId?: string;
      orderId?: string;
      status?: string;
    };

    const where: any = {};
    if (orderId) where.orderId = orderId;
    if (status) where.status = status.toString().toUpperCase();

    const payments = await prisma.payment.findMany({
      where: userId ? { ...where, order: { userId } } : where,
      orderBy: { createdAt: 'desc' },
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

router.get('/recent', requireAuth, async (req, res, next) => {
  try {
    const limitRaw = Number(req.query.limit);
    const take = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 5;

    const orders = await prisma.order.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        payments: {
          orderBy: { createdAt: 'desc' },
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
        title: it.title ?? '—',
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

router.get('/admin/compat-alias', requireAuth, async (req, res, next) => {
  try {
    const isAdmin = (r?: string) => r === 'ADMIN' || r === 'SUPER_ADMIN';
    if (!isAdmin(req.user?.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    (req as any).query.includeItems = req.query.includeItems ?? '1';
    (req as any).query.limit = req.query.limit ?? '20';

    const includeItems = String(req.query.includeItems || '') === '1';
    const q = String(req.query.q || '').trim();
    const limitRaw = Number(req.query.limit);
    const take = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 20;

    const where: any = {};
    if (q) {
      where.OR = [
        { reference: { contains: q, mode: 'insensitive' } },
        { orderId: { contains: q, mode: 'insensitive' } },
        { order: { user: { email: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const rows = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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
