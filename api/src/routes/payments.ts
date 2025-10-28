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
import { notifySuppliersForOrder } from '../services/notify.js';
import PDFDocument from 'pdfkit';

const router = Router();

/* ----------------------------- Config ----------------------------- */

const isTrue = (v?: string | null) =>
  ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());

const TRIAL_MODE = isTrue(process.env.PAYMENTS_TRIAL_MODE);
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

const ACTIVE_PENDING_TTL_MIN = Number(process.env.PAYMENT_PENDING_TTL_MIN ?? 60);

// Single source of truth for modes
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

function isValidSignature(rawBody: Buffer, signature: string | undefined, secret: string) {
  if (!signature) return false;
  const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  return hash === signature;
}

function calcPaystackFee(amountNaira: number, opts?: { international?: boolean }) {
  // Local: 1.5% + ₦100 (> ₦2,500), cap ₦2,000
  // Intl: 3.9% + ₦100 (fallback heuristic)
  const isIntl = !!opts?.international;
  if (isIntl) return amountNaira * 0.039 + 100;
  const percent = amountNaira * 0.015;
  const extra = amountNaira > 2500 ? 100 : 0;
  return Math.min(percent + extra, 2000);
}

// Setting helpers (super admin can set these keys in Setting table)
async function getSettingNumber(key: string, defaultVal = 0): Promise<number> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    const n = Number(row?.value);
    return Number.isFinite(n) ? n : defaultVal;
  } catch {
    return defaultVal;
  }
}
async function getBaseServiceFeeNGN(): Promise<number> {
  // Check a few common keys (first positive wins)
  const keys = ['serviceFeeBaseNGN', 'service_fee_base', 'platformBaseFeeNGN'];
  for (const k of keys) {
    const v = await getSettingNumber(k, 0);
    if (v > 0) return v;
  }
  return 0;
}

async function readSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch { return null; }
}

/* ----------------------------- Core finalize ----------------------------- */

/**
 * Single source of truth for post-paid side effects:
 * - cancel sibling pendings
 * - set order status
 * - record OrderComms pro-rated slice (svc * amount/total)  ← keeps your older behavior
 * - notify suppliers
 * - create POs
 * - issue receipt
 * - recompute profit (independent of serviceFee)
 */
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
        order: { select: { id: true, total: true, serviceFee: true } },
      },
    });

    if (!p || p.status !== 'PAID' || !p.orderId) return null;

    // cancel sibling pending attempts
    await tx.payment.updateMany({
      where: { orderId: p.orderId, status: 'PENDING', NOT: { id: p.id } },
      data: { status: 'CANCELED' },
    });

    // bump order workflow
    const next = process.env.TURN_OFF_AWAIT_CONF === 'true' ? 'PAID' : 'AWAITING_FULFILLMENT';
    await tx.order.update({ where: { id: p.orderId }, data: { status: next } });

    // (Legacy) commission slice by service fee proportion – keep for continuity
    const total = Number(p.order?.total) || 0;
    const svc = Number(p.order?.serviceFee) || 0;
    const amt = Number(p.amount) || 0;

    if (total > 0 && svc > 0 && amt > 0) {
      const slice = svc * Math.max(0, Math.min(1, amt / total));
      await tx.orderComms.upsert({
        where: { paymentId: p.id }, // paymentId is @unique on OrderComms
        create: {
          orderId: p.orderId,
          paymentId: p.id,
          amount: slice,
          channel: p.channel ?? null,
          reason: 'SERVICE_FEE_SLICE',
        },
        update: {
          amount: slice,
          channel: p.channel ?? null,
          reason: 'SERVICE_FEE_SLICE',
        },
      });
    }

    await tx.paymentEvent.create({
      data: { paymentId: p.id, type: 'FINALIZE_PAID', data: { reference: p.reference } },
    });

    return { orderId: p.orderId, paymentId: p.id };
  });

  if (!result) return;

  // ---- side effects (outside txn) ----
  const alreadyNotified = await prisma.paymentEvent.findFirst({
    where: { paymentId: result.paymentId, type: 'SUPPLIER_NOTIFIED' },
  });

  if (!alreadyNotified) {
    try {
      await notifySuppliersForOrder(result.orderId);
      await prisma.paymentEvent.create({ data: { paymentId: result.paymentId, type: 'SUPPLIER_NOTIFIED' } });
    } catch (e) {
      console.error('notifySuppliersForOrder failed', e);
    }
  }

  // Create POs after supplier notification
  setImmediate(() => createPurchaseOrdersForOrder(result.orderId).catch(console.error));

  // Receipt
  try { await issueReceiptIfNeeded(result.paymentId); } catch (e) { console.error('issueReceiptIfNeeded failed', e); }

  // Profit recomputation (now that comms rows exist from notifySuppliersForOrder)
  try { await recomputeProfitForPayment(result.paymentId); } catch (e) { console.error('recomputeProfitForPayment failed', e); }

  console.log('[finalizePaidFlow] done', result);
}

// Create POs grouped by supplier; uses chosenSupplierUnitPrice × quantity
async function createPurchaseOrdersForOrder(orderId: string) {
  await prisma.$transaction(async (tx: any) => {
    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: {
        id: true,
        quantity: true,
        chosenSupplierId: true,
        chosenSupplierUnitPrice: true,
      },
    });

    const bySupplier = new Map<string, typeof items>();
    for (const it of items) {
      if (!it.chosenSupplierId) continue;
      const arr = bySupplier.get(it.chosenSupplierId) ?? [];
      arr.push(it);
      bySupplier.set(it.chosenSupplierId, arr);
    }

    for (const [supplierId, group] of bySupplier) {
      const subtotal = group.reduce(
        (sum: number, it: { chosenSupplierUnitPrice: any; quantity: any; }) =>
          sum +
          (Number(it.chosenSupplierUnitPrice ?? 0) * Math.max(1, Number(it.quantity ?? 1))),
        0
      );

      const po = await tx.purchaseOrder.create({
        data: {
          orderId,
          supplierId,
          subtotal,
          platformFee: 0,
          supplierAmount: subtotal,
          status: 'CREATED',
        },
      });

      for (const it of group) {
        await tx.purchaseOrderItem.create({
          data: {
            purchaseOrderId: po.id,
            orderItemId: it.id,
            externalRef: null,
            externalStatus: null,
          },
        });
      }
    }
  });
}

/* ----------------------------- Profit recompute ----------------------------- */

/**
 * Profit = amountPaid - (COGS + gateway + comms + baseServiceFee)
 * - amountPaid: this payment.amount
 * - COGS: sum of chosenSupplierUnitPrice*qty; fallback to cheapest active SupplierOffer
 * - gateway: payment.feeAmount
 * - comms: sum(OrderComms.amount where reason='SUPPLIER_NOTIFY' for the order)
 * - baseServiceFee: from settings (serviceFeeBaseNGN | service_fee_base | platformBaseFeeNGN)
 * Writes a PaymentEvent(PROFIT_COMPUTED) + OrderActivity for visibility.
 */
async function recomputeProfitForPayment(paymentId: string) {
  const p = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, orderId: true, amount: true, feeAmount: true, reference: true, paidAt: true, status: true },
  });
  if (!p?.orderId) return;

  // --- build COGS from chosen supplier unit price (with cheapest-offer fallback) ---
  const order = await prisma.order.findUnique({
    where: { id: p.orderId },
    include: {
      items: {
        select: {
          id: true, productId: true, variantId: true,
          chosenSupplierUnitPrice: true, quantity: true, unitPrice: true, title: true,
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
        let cheapest = await prisma.supplierOffer.findFirst({
          where: { productId: it.productId, variantId: it.variantId ?? undefined, isActive: true, inStock: true },
          orderBy: { price: 'asc' },
          select: { price: true },
        });
        if (!cheapest) {
          cheapest = await prisma.supplierOffer.findFirst({
            where: { productId: it.productId, variantId: null, isActive: true, inStock: true },
            orderBy: { price: 'asc' },
            select: { price: true },
          });
        }
        offerCache.set(key, Number(cheapest?.price ?? 0));
      }
      unitCost = offerCache.get(key)!;
    }
    cogs += unitCost * qty;
  }

  const gateway = Number(p.feeAmount || 0);

  // Comms actually incurred so far (notifications etc.)
  const commsAgg = await prisma.orderComms.aggregate({
    _sum: { amount: true },
    where: { orderId: p.orderId, reason: 'SUPPLIER_NOTIFY' },
  });
  const comms = Number(commsAgg._sum.amount || 0);

  // Base overhead (if you model it)
  const baseServiceFee =
    Number((await readSetting('serviceFeeBaseNGN')) ?? (await readSetting('platformBaseFeeNGN')) ?? 0) || 0;

  const amountPaid = Number(p.amount || 0);

  // ---- profit mode toggle ----
  const profitMode = ((await readSetting('profitMode')) ?? 'accurate').toLowerCase(); // "accurate" | "simple"
  const profit = profitMode === 'simple'
    ? amountPaid - cogs
    : amountPaid - (cogs + gateway + comms + baseServiceFee);

  const breakdown = {
    reference: p.reference,
    orderId: p.orderId,
    paymentId,
    paidAt: p.paidAt,
    amountPaid, cogs, gateway, comms, baseServiceFee, profit,
    profitMode,
  };

  await prisma.paymentEvent.create({
    data: { paymentId, type: 'PROFIT_COMPUTED', data: breakdown },
  });

  await prisma.orderActivity.create({
    data: {
      orderId: p.orderId,
      type: 'PROFIT_COMPUTED',
      message: `Profit computed: ₦${profit.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      meta: breakdown,
    },
  });

  // console.log('[profit] breakdown', breakdown);
}

/* ----------------------------- Public endpoints ----------------------------- */

/**
 * GET /api/payments/summary
 */
router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const agg = await prisma.payment.aggregate({
      _sum: { amount: true },
      where: { status: 'PAID', order: { userId: req.user!.id } },
    });
    const totalPaid = Number(agg._sum.amount || 0);
    res.json({ totalPaid, currency: 'NGN' });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/payments/init  { orderId, channel? }
 */
async function createPendingAttempt(args: {
  orderId: string;
  channel: string;
  amountDecimal: any;
  provider?: string | null;
}) {
  const { orderId, channel, amountDecimal, provider } = args;
  for (let i = 0; i < 5; i++) {
    const reference = generateRef8();
    try {
      return await prisma.payment.create({
        data: {
          orderId,
          reference,
          channel,
          amount: amountDecimal,
          status: 'PENDING',
          provider: provider ?? (channel === 'paystack' ? 'PAYSTACK' : null),
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002' && Array.isArray(e?.meta?.target) && e.meta.target.includes('reference')) {
        continue;
      }
      throw e;
    }
  }
  return await prisma.payment.create({
    data: {
      orderId,
      reference: `${generateRef8().slice(0, 6) + generateRef8().slice(0, 2)}`,
      channel,
      amount: amountDecimal,
      status: 'PENDING',
      provider: provider ?? (channel === 'paystack' ? 'PAYSTACK' : null),
    },
  });
}

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
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const paid = await prisma.payment.findFirst({
    where: { orderId, status: 'PAID' },
    select: { id: true },
  });
  if (paid) return res.status(409).json({ error: 'Order already paid' });

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

  if (pay && isFresh(pay.createdAt, ACTIVE_PENDING_TTL_MIN) && channel === 'paystack') {
    const authUrl = (pay.providerPayload as any)?.authorization_url;
    if (authUrl) {
      await logOrderActivity(orderId, 'PAYMENT_RESUME', 'Resumed existing Paystack attempt', {
        reference: pay.reference,
      });
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
    const created = await createPendingAttempt({
      orderId,
      channel,
      amountDecimal: order.total,
      provider: channel === 'paystack' ? 'PAYSTACK' : null,
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

    const initPayload = {
      email: userEmail,
      amount: toKobo(order.total),
      reference: pay.reference,
      currency: 'NGN',
      callback_url,
      channels,
      metadata: {
        orderId,
        userId: req.user!.id,
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
    { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
  );

  const tx = data?.data;
  if (!tx || tx.status !== 'success') throw new Error('Verification failed');

  // Paystack amounts are in kobo
  const amountNaira = Math.round(Number(tx.amount || 0)) / 100;

  // Prefer provider-reported fee if present; fallback to formula
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
    select: { id: true, orderId: true, status: true, channel: true, amount: true },
  });
  if (!pay || pay.orderId !== orderId) {
    return res.status(404).json({ error: 'Payment not found' });
  }

  if (pay.status === 'PAID') {
    return res.json({ ok: true, status: 'PAID', message: 'Already verified' });
  }
  if (['FAILED', 'CANCELED', 'REFUNDED'].includes(pay.status)) {
    await logOrderActivity(orderId, 'PAYMENT_FAILED', 'Verification attempted on non-pending payment', { reference });
    return res.json({ ok: true, status: pay.status, message: 'Payment is not successful' });
  }

  // Trial/inline flow (non-paystack) -> auto-approve (unless manual)
  if (TRIAL_MODE || pay.channel !== 'paystack') {
    if (INLINE_APPROVAL === 'manual') {
      await prisma.paymentEvent.create({
        data: { paymentId: pay.id, type: 'VERIFY_PENDING', data: { reference, note: 'Manual approval required' } },
      });
      await logOrderActivity(orderId, 'PAYMENT_PENDING', 'Awaiting manual confirmation', { reference });
      return res.json({ ok: true, status: 'PENDING', message: 'Awaiting confirmation' });
    }
    const updated = await prisma.payment.update({
      where: { id: pay.id },
      data: { status: 'PAID', paidAt: new Date() },
      select: { id: true },
    });
    await finalizePaidFlow(updated.id);
    return res.json({ ok: true, status: 'PAID', message: 'Payment verified (trial/virtual)' });
  }

  // Paystack card verify -> set amount/fee, mark PAID, finalize
  try {
    const vr = await ps.get(`/transaction/verify/${reference}`);
    const pData = vr.data?.data;
    const status: string | undefined = pData?.status;
    const gatewayRef = pData?.reference;

    if (gatewayRef && gatewayRef !== reference) {
      await prisma.paymentEvent.create({
        data: { paymentId: pay.id, type: 'VERIFY_MISMATCH', data: { reference, gatewayRef, status } },
      });
      return res.status(400).json({ error: 'Reference mismatch from gateway' });
    }

    if (status === 'success') {
      await prisma.payment.update({ where: { id: pay.id }, data: { providerPayload: pData } });
      await verifyPaystack(reference); // sets PAID + amount/fee
      const p = await prisma.payment.findUnique({ where: { reference }, select: { id: true } });
      if (p?.id) await finalizePaidFlow(p.id);
      return res.json({ ok: true, status: 'PAID', message: 'Payment verified' });
    }

    if (status === 'failed') {
      await prisma.$transaction(async (tx: any) => {
        await tx.payment.update({ where: { id: pay.id }, data: { status: 'FAILED', providerPayload: pData } });
        await tx.paymentEvent.create({
          data: { paymentId: pay.id, type: 'VERIFY_FAILED', data: { reference, status } },
        });
      });
      await logOrderActivity(orderId, 'PAYMENT_FAILED', 'Gateway reported failure', { reference });
      return res.json({ ok: true, status: 'FAILED', message: 'Payment failed' });
    }

    await prisma.paymentEvent.create({
      data: { paymentId: pay.id, type: 'VERIFY_PENDING', data: { reference, status: status ?? 'unknown' } },
    });
    await logOrderActivity(orderId, 'PAYMENT_PENDING', 'Awaiting confirmation', { reference });
    return res.json({ ok: true, status: 'PENDING', message: 'Awaiting confirmation' });
  } catch (e: any) {
    await prisma.paymentEvent.create({
      data: { paymentId: pay.id, type: 'VERIFY_ERROR', data: { reference, err: e?.message } },
    });
    return res.json({ ok: true, status: 'PENDING', message: 'Could not verify yet; try again shortly' });
  }
});

// Optional admin helper: POST /api/payments/:reference/verify
router.post('/:reference/verify', requireAuth, async (req, res) => {
  try {
    const { reference } = req.params;
    const result = await verifyPaystack(reference); // sets payment -> PAID + amount/fee

    // also run finalize (same as webhook or user /verify)
    const p = await prisma.payment.findUnique({ where: { reference }, select: { id: true } });
    if (p?.id) await finalizePaidFlow(p.id);

    return res.json({ data: result });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || 'Verification failed' });
  }
});

/* ----------------------------- Webhook ----------------------------- */

// NOTE: place this route before any JSON body parser in your app,
// or keep this per-route raw parser to override it.
router.post('/webhook/paystack', express.raw({ type: '*/*' }), async (req, res) => {
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

    if (channel === 'card' && !WEBHOOK_ACCEPT_CARD) return res.status(200).send('ignored: card off');
    if ((channel === 'bank' || channel === 'bank_transfer') && !WEBHOOK_ACCEPT_BANK_TRANSFER) {
      return res.status(200).send('ignored: bank_transfer off');
    }

    if (reference) {
      try {
        const pay = await prisma.payment.findUnique({ where: { reference } });
        if (pay) {
          await prisma.paymentEvent.create({
            data: { paymentId: pay.id, type: eventType || 'webhook', data: evt },
          });
        }
      } catch {
        // ignore logging issues
      }
    }

    if (eventType === 'charge.success') {
      if (reference) {
        await verifyPaystack(reference); // sets Payment to PAID + amount/fee
        const p = await prisma.payment.findUnique({ where: { reference }, select: { id: true } });
        if (p?.id) await finalizePaidFlow(p.id);
      }
      return res.status(200).send('ok'); // <-- return to avoid double send
    }

    if (eventType === 'transfer.success' || eventType === 'transfer.failed') {
      return res.status(200).send('ok');
    }

    return res.status(200).send('ok');
  } catch (e: any) {
    // Always ack to stop retries
    return res.status(200).send('ok');
  }
});

/* ----------------------------- Status & receipts ----------------------------- */

// GET /api/payments/status?orderId=...&reference=...
router.get('/status', requireAuth, async (req, res) => {
  try {
    const orderId = String(req.query.orderId || '');
    const reference = String(req.query.reference || '');
    if (!orderId || !reference) {
      return res.status(400).json({ error: 'orderId and reference are required' });
    }

    const pay = await prisma.payment.findFirst({
      where: {
        reference,
        orderId,
        order: { userId: req.user!.id },
      },
      select: { status: true },
    });

    if (!pay) return res.status(404).json({ error: 'Payment not found' });
    return res.json({ status: pay.status });
  } catch (e: any) {
    console.error('payments/status error', e);
    return res.status(500).json({ error: 'Failed to fetch payment status' });
  }
});

export async function assertCanViewReceipt(paymentKey: string, user: JwtUser) {
  const row = await prisma.payment.findFirst({
    where: { OR: [{ id: paymentKey }, { reference: paymentKey }] },
    select: {
      id: true,
      orderId: true,
      status: true,
      order: { select: { userId: true } },
    },
  });

  if (!row || row.status !== 'PAID') throw httpErr(404, 'Not found');

  const role = (user?.role || '').toUpperCase();
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const isOwner = row.order?.userId && user?.id && row.order.userId === user.id;
  if (!isOwner && !isAdmin) throw httpErr(403, 'Forbidden');

  return row;
}

router.get('/:paymentId/receipt', requireAuth, async (req, res) => {
  const { paymentId } = req.params;
  await assertCanViewReceipt(paymentId, req.user!);

  const pay = await issueReceiptIfNeeded(paymentId);
  if (!pay) return res.status(404).json({ error: 'Receipt not available' });

  return res.json({
    ok: true,
    receiptNo: pay.receiptNo,
    issuedAt: pay.receiptIssuedAt,
    data: pay.receiptData,
  });
});

router.get('/:paymentId/receipt.pdf', requireAuth, async (req, res) => {
  const { paymentId } = req.params;
  await assertCanViewReceipt(paymentId, req.user!);
  const pay = await issueReceiptIfNeeded(paymentId);
  if (!pay?.receiptData) return res.status(404).json({ error: 'Receipt not available' });

  const r = pay.receiptData as any;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${pay.receiptNo || 'receipt'}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(18).text(r.merchant?.name || 'Receipt');
  doc.moveDown(0.5);

  doc.font('Helvetica').fontSize(10).fillColor('#555');
  doc.text(r.merchant?.addressLine1 || '');
  if (r.merchant?.addressLine2) doc.text(r.merchant.addressLine2);
  if (r.merchant?.supportEmail) doc.text(`Support: ${r.merchant.supportEmail}`);
  doc.moveDown();
  doc.fillColor('#000');

  doc.fillColor('#000').fontSize(12);
  doc.text(`Receipt No: ${pay.receiptNo || ''}`);
  doc.text(`Reference: ${r.reference}`);
  doc.text(`Paid At: ${new Date(r.paidAt).toLocaleString()}`);
  doc.moveDown();

  doc.font('Helvetica-Bold').fontSize(11).text('Customer', { underline: true });
  doc.font('Helvetica');
  doc.text(`${r.customer?.name || '—'}`);
  doc.text(`${r.customer?.email || '—'}`);
  if (r.customer?.phone) doc.text(r.customer.phone);
  doc.moveDown();

  doc.fontSize(11).text('Ship To', { underline: true });
  const addr = r.order?.shippingAddress || {};
  [addr.houseNumber, addr.streetName, addr.town, addr.city, addr.state, addr.country]
    .filter(Boolean)
    .forEach((line: string) => doc.text(line));
  doc.moveDown();

  doc.fontSize(11).text('Items', { underline: true });
  doc.moveDown(0.25);
  r.order?.items?.forEach((it: any) => {
    const title = it.title || 'Item';
    const qty = Number(it.quantity || 1);
    const unit = Number(it.unitPrice || 0);
    const line = Number(it.lineTotal || unit * qty);
    doc.fontSize(10).text(`${title}  •  ${qty} × NGN ${unit.toLocaleString()}  =  NGN ${line.toLocaleString()}`);
    if (Array.isArray(it.selectedOptions) && it.selectedOptions.length > 0) {
      doc.fillColor('#555').fontSize(9).text(
        it.selectedOptions.map((o: any) => `${o.attribute}: ${o.value}`).join(' • ')
      );
      doc.fillColor('#000');
    }
    doc.moveDown(0.25);
  });
  doc.moveDown();

  const subtotal = Number(r.order?.subtotal || 0);
  const tax = Number(r.order?.tax || 0);
  const shipping = Number(r.order?.shipping || 0);
  const total = Number(r.order?.total || 0);
  doc.fontSize(11);
  doc.text(`Subtotal: NGN ${subtotal.toLocaleString()}`);
  doc.text(`Tax: NGN ${tax.toLocaleString()}`);
  doc.text(`Shipping: NGN ${shipping.toLocaleString()}`);
  doc.fontSize(12).text(`Total: NGN ${total.toLocaleString()}`);
  doc.moveDown(1);

  doc.fontSize(9).fillColor('#666')
    .text('Thank you for your purchase. This document serves as a receipt.', { align: 'left' });

  doc.end();
});

/* ----------------------------- Listings ----------------------------- */

router.post('/link', requireAuth, async (req, res, next) => {
  try {
    const { orderId } = req.body as { orderId: string };
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

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
    if (!isAdmin(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });

    (req as any).query.includeItems = (req.query.includeItems ?? '1');
    (req as any).query.limit = (req.query.limit ?? '20');

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
              ? { select: { id: true, title: true, unitPrice: true, quantity: true, status: true } }
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
