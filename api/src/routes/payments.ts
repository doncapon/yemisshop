// src/routes/payments.ts
import express, { Router } from 'express';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireAuth } from '../middleware/auth.js';
import { logOrderActivity } from '../services/activity.service.js';
import { ps, toKobo } from '../lib/paystack.js';
import { generateRef8, isFresh, toNumber } from '../lib/payments.js';
import { issueReceiptIfNeeded } from '../lib/receipts.js';
import PDFDocument from 'pdfkit';
import { getInitChannels } from '../config/paystack.js';
import crypto from 'crypto';
import {
  WEBHOOK_ACCEPT_CARD,
  WEBHOOK_ACCEPT_BANK_TRANSFER,
} from '../config/paystack.js';

const router = Router();

/* ----------------------------- Config ----------------------------- */

const isTrue = (v?: string | null) =>
  ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());

const TRIAL_MODE = isTrue(process.env.PAYMENTS_TRIAL_MODE);
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

const ACTIVE_PENDING_TTL_MIN = Number(process.env.PAYMENT_PENDING_TTL_MIN ?? 60); // how long a pending Paystack init is reusable
// const PAYSTACK_CHANNELS: Array<'bank_transfer'> = ['bank_transfer']; // restrict to card only (change if you want)

// Single source of truth for modes
const INLINE_APPROVAL = (process.env.INLINE_APPROVAL || 'auto').toLowerCase() as 'auto' | 'manual';

const BANK_NAME = process.env.BANK_NAME || '';
const BANK_ACCOUNT_NAME = process.env.BANK_ACCOUNT_NAME || '';
const BANK_ACCOUNT_NUMBER = process.env.BANK_ACCOUNT_NUMBER || '';

/* ----------------------------- Routes ----------------------------- */

/**
 * GET /api/payments/summary
 * Returns total amount successfully paid by the current user (major units, NGN).
 * Response: { totalPaid: number, currency: 'NGN' }
 */
router.get('/summary', authMiddleware, async (req, res, next) => {
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
 * POST /api/payments/init
 * Body: { orderId: string, channel?: string }
 * Requires: logged in + email & phone verified
 */
// routes/payments.ts


// Safe creator: retries on unique constraint for `reference`
async function createPendingAttempt(args: {
  orderId: string;
  channel: string;
  amountDecimal: any; // Prisma.Decimal or compatible
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
      // Prisma unique violation
      if (e?.code === 'P2002' && Array.isArray(e?.meta?.target) && e.meta.target.includes('reference')) {
        continue; // try a new reference
      }
      throw e;
    }
  }
  // last resort — extremely unlikely
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

// POST /api/payments/init  { orderId, channel? }
router.post('/init', requireAuth, async (req: Request, res: Response) => {
  const { orderId } = req.body ?? {};
  let { channel } = req.body ?? {};
  const userId = req.user!.id;
  const userEmail = req.user!.email;

  channel = channel.toLowerCase();

  // 1) Load order
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: { id: true, total: true, createdAt: true },
  });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // 2) Stop if already paid
  const paid = await prisma.payment.findFirst({
    where: { orderId, status: 'PAID' },
    select: { id: true },
  });
  if (paid) return res.status(409).json({ error: 'Order already paid' });

  // 3) Find latest PENDING attempt for this order+channel
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

  // 4) If it exists and is still "fresh", resume (avoid duplicate Paystack init)
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
    // if no authorization_url stored, treat as stale below -> rotate
  }

  // 5) If a pending exists but is stale or unusable, close it and create a new attempt
  if (pay && !isFresh(pay.createdAt, ACTIVE_PENDING_TTL_MIN)) {
    await prisma.payment.update({
      where: { id: pay.id },
      data: { status: 'CANCELED' }, // or add a reason column/status if you like
    });
    pay = null as any;
  }

  // 6) Create a brand-new PENDING attempt with a fresh, unique reference
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

  // 7) Trial mode? Return stub without calling Paystack
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
      autoPaid: INLINE_APPROVAL == 'auto' ? true : 'manual',
      bank: {
        bank_name: 'Demo Bank',
        account_name: 'Yemis Shop',
        account_number: '0123456789',
      },
    });
  }

  // 8) Hosted Paystack checkout (card-only)
  if (channel === 'paystack') {
    const channels = getInitChannels(); // ['card'], ['bank_transfer'], or both

    const callback_url = `${process.env.APP_URL}/payment-callback?orderId=${orderId}&reference=${pay.reference}&gateway=paystack`;

    // Initialize with a NEW reference (or reuse if we resumed above)
    const initPayload = {
      email: userEmail,
      amount: toKobo(order.total),       // integer kobo
      reference: pay.reference,          // must be unique per attempt
      currency: 'NGN',
      callback_url,
      channels,       // ['card'] to force card-only
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
        title: 'Yemis Shop',
        description: `Order ${order.id} • Use Payment Ref: ${pay.reference}`, // <- visible on checkout
        // optional logo
        logo: process.env.PAYSTACK_LOGO_URL || undefined,
      },
    };

    const resp = await ps.post('/transaction/initialize', initPayload);
    const data = resp.data?.data;

    // Save provider payload
    await prisma.payment.update({
      where: { id: pay.id },
      data: {
        providerPayload: data,
        initPayload,           // store what you asked Paystack for
        provider: 'paystack',
        channel: 'paystack',   // hosted flow; user can still pick card/bank on the page
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
      data
    });
  }

  // 9) Inline/Bank flow (if you support it)
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
      account_name: BANK_ACCOUNT_NAME || 'Yemis Shop',
      account_number: BANK_ACCOUNT_NUMBER || '0123456789',
    },
  });
});


router.post('/verify', requireAuth, async (req: Request, res: Response) => {
  const { orderId, reference, data } = req.body ?? {};

  if (!orderId || !reference) {
    return res.status(400).json({ error: 'orderId and reference required' });
  }

  // 1) Load the payment by reference and sanity-check it belongs to this order
  const pay = await prisma.payment.findUnique({
    where: { reference },
    select: { id: true, orderId: true, status: true, channel: true, amount: true },
  });
  if (!pay || pay.orderId !== orderId) {
    return res.status(404).json({ error: 'Payment not found' });
  }

  // 2) Idempotency: return immediately if already terminal
  if (pay.status === 'PAID') {
    return res.json({ ok: true, status: 'PAID', message: 'Already verified' });
  }
  if (pay.status === 'FAILED' || pay.status === 'CANCELED' || pay.status === 'REFUNDED') {
    await logOrderActivity(orderId, 'PAYMENT_FAILED', 'Verification attempted on non-pending payment', { reference });
    return res.json({ ok: true, status: pay.status, message: 'Payment is not successful' });
  }

  // Helper to finalize success in a single txn and cancel siblings
  async function markPaidAndFinalize() {
    const result = await prisma.$transaction(async (tx: { payment: { update: (arg0: { where: { reference: any; }; data: { status: string; paidAt: Date; }; }) => any; updateMany: (arg0: { where: { orderId: any; status: string; NOT: { reference: any; }; }; data: { status: string; }; }) => any; }; order: { update: (arg0: { where: { id: any; }; data: { status: string; }; }) => any; }; paymentEvent: { create: (arg0: { data: { paymentId: any; type: string; data: { reference: any; }; }; }) => any; }; }) => {
      // 2a) Mark THIS payment as PAID
      const updated = await tx.payment.update({
        where: { reference },
        data: { status: 'PAID', paidAt: new Date() },
      });

      // 2b) Cancel any other PENDING attempts for the same order
      await tx.payment.updateMany({
        where: { orderId, status: 'PENDING', NOT: { reference } },
        data: { status: 'CANCELED' },
      });

      // 2c) Update order workflow status (adapt to your terms)
      const sta = (process.env.TURN_OFF_AWAIT_CONF === "true")? 'PAID': 'AWAITING_FULFILLMENT'
      await tx.order.update({
        where: { id: orderId },
        data: { status: sta },
      });

      // 2d) Record event + activity
      await tx.paymentEvent.create({
        data: { paymentId: updated.id, type: 'VERIFY_PAID', data: { reference } },
      });
      // after marking PAID successfully:
      await issueReceiptIfNeeded(updated.id);

      await logOrderActivity(orderId, 'PAYMENT_PAID', 'Payment verified', { reference });

      return updated;
    });

    return result;
  }

  // 3) Trial or inline-bank flow
  // Mode A (default): auto-approve when user clicks "I’ve transferred"
  // Mode B (INLINE_APPROVAL=manual): keep it PENDING and let admin approve in dashboard
  if (TRIAL_MODE || pay.channel !== 'paystack') {
    if (INLINE_APPROVAL === 'manual') {
      // keep pending, just acknowledge
      await prisma.paymentEvent.create({
        data: { paymentId: pay.id, type: 'VERIFY_PENDING', data: { reference, note: 'Manual approval required' } },
      });
      await logOrderActivity(orderId, 'PAYMENT_PENDING', 'Awaiting manual confirmation', { reference });
      return res.json({ ok: true, status: 'PENDING', message: 'Awaiting confirmation' });
    }

    // auto-approve trial/inline for your current UI flow
    await markPaidAndFinalize();
    return res.json({ ok: true, status: 'PAID', message: 'Payment verified (trial/virtual)' });
  }

  // 4) Paystack (card) — verify via API
  try {
    const vr = await ps.get(`/transaction/verify/${reference}`);
    const pData = vr.data?.data;
    const status: string | undefined = pData?.status; // "success" | "failed" | "abandoned" | ...
    const gatewayRef = pData?.reference;

    // A tiny sanity-check: the reference must match
    if (gatewayRef && gatewayRef !== reference) {
      await prisma.paymentEvent.create({
        data: { paymentId: pay.id, type: 'VERIFY_MISMATCH', data: { reference, gatewayRef, status } },
      });
      return res.status(400).json({ error: 'Reference mismatch from gateway' });
    }

    if (status === 'success') {
      // Good — mark this payment as paid and finalize order
      await prisma.payment.update({
        where: { id: pay.id },
        data: { providerPayload: pData },
      });
      await markPaidAndFinalize();
      return res.json({ ok: true, status: 'PAID', message: 'Payment verified' });
    }

    if (status === 'failed') {
      await prisma.$transaction(async (tx: { payment: { update: (arg0: { where: { id: any; }; data: { status: string; providerPayload: any; }; }) => any; }; paymentEvent: { create: (arg0: { data: { paymentId: any; type: string; data: { reference: any; status: string; }; }; }) => any; }; }) => {
        await tx.payment.update({
          where: { id: pay.id },
          data: { status: 'FAILED', providerPayload: pData },
        });
        await tx.paymentEvent.create({
          data: { paymentId: pay.id, type: 'VERIFY_FAILED', data: { reference, status } },
        });
      });
      await logOrderActivity(orderId, 'PAYMENT_FAILED', 'Gateway reported failure', { reference });
      return res.json({ ok: true, status: 'FAILED', message: 'Payment failed' });
    }

    // abandoned / pending / unknown — keep it pending
    await prisma.paymentEvent.create({
      data: { paymentId: pay.id, type: 'VERIFY_PENDING', data: { reference, status: status ?? 'unknown' } },
    });
    await logOrderActivity(orderId, 'PAYMENT_PENDING', 'Awaiting confirmation', { reference });
    return res.json({ ok: true, status: 'PENDING', message: 'Awaiting confirmation' });
  } catch (e: any) {
    // Network / API error: do not flip status; just report pending
    await prisma.paymentEvent.create({
      data: { paymentId: pay.id, type: 'VERIFY_ERROR', data: { reference, err: e?.message } },
    });
    return res.json({ ok: true, status: 'PENDING', message: 'Could not verify yet; try again shortly' });
  }
});


router.post('/webhook/paystack', express.raw({ type: '*/*' }), async (req, res) => {
  const sig = req.headers['x-paystack-signature'] as string | undefined;
  if (!isValidSignature(req.body.toString('utf8'), sig, process.env.PAYSTACK_SECRET_KEY!)) {
    return res.status(401).send('bad sig');
  }

  // Once verified, parse JSON
  const evt = JSON.parse(req.body.toString('utf8'));
  const ref: string | undefined = evt?.data?.reference;
  const status: string | undefined = evt?.data?.status; // 'success' | 'failed' | 'abandoned' | ...
  const evtChannel: string | undefined =
    evt?.data?.channel || evt?.data?.authorization?.channel; // 'card' | 'bank' | 'bank_transfer'

  // Filter by allowed webhook channels (optional)
  if (evtChannel === 'card' && !WEBHOOK_ACCEPT_CARD) return res.status(200).send('ignored: card off');
  if ((evtChannel === 'bank' || evtChannel === 'bank_transfer') && !WEBHOOK_ACCEPT_BANK_TRANSFER) {
    return res.status(200).send('ignored: bank_transfer off');
  }

  if (!ref) return res.status(200).send('ok'); // nothing to do

  const pay = await prisma.payment.findUnique({ where: { reference: ref } });
  if (!pay) return res.status(200).send('ok'); // unknown ref -> ignore (do NOT 4xx)

  // Already processed? great — ack & exit
  if (pay.status === 'PAID') return res.status(200).send('already paid');
  if (['FAILED', 'CANCELED', 'REFUNDED'].includes(pay.status)) return res.status(200).send('terminal');

  // Optional: if you want to only accept events matching what you initialized with
  const allowed = (pay.initPayload as any)?.channels as Array<'card' | 'bank_transfer'> | undefined;
  if (allowed && evtChannel) {
    const normalized = evtChannel === 'bank' ? 'bank_transfer' : evtChannel;
    if (!allowed.includes(normalized as any)) {
      // Ignore mismatch without error
      await prisma.paymentEvent.create({
        data: { paymentId: pay.id, type: 'WEBHOOK_IGNORED_CHANNEL', data: { evtChannel, allowed } },
      });
      return res.status(200).send('ignored channel');
    }
  }

  // Persist the raw event
  await prisma.paymentEvent.create({
    data: { paymentId: pay.id, type: evt?.event || 'webhook', data: evt },
  });

  if (status === 'success') {
    // Mark PAID + cancel siblings (idempotent)
    await prisma.$transaction(async (tx: { payment: { update: (arg0: { where: { id: any; }; data: { status: string; paidAt: Date; providerPayload: any; }; }) => any; updateMany: (arg0: { where: { orderId: any; status: string; NOT: { id: any; }; }; data: { status: string; }; }) => any; }; order: { update: (arg0: { where: { id: any; }; data: { status: string; }; }) => any; }; paymentEvent: { create: (arg0: { data: { paymentId: any; type: string; data: { reference: string; }; }; }) => any; }; }) => {
      await tx.payment.update({
        where: { id: pay.id },
        data: { status: 'PAID', paidAt: new Date(), providerPayload: evt?.data },
      });
      await tx.payment.updateMany({
        where: { orderId: pay.orderId, status: 'PENDING', NOT: { id: pay.id } },
        data: { status: 'CANCELED' },
      });
      await tx.order.update({
        where: { id: pay.orderId },
        data: { status: 'AWAITING_FULFILLMENT' },
      });
      await tx.paymentEvent.create({
        data: { paymentId: pay.id, type: 'WEBHOOK_MARK_PAID', data: { reference: ref } },
      });
    });
    return res.status(200).send('paid');
  }

  if (status === 'failed') {
    // Mark failed only if still pending
    if (pay.status === 'PENDING') {
      await prisma.payment.update({
        where: { id: pay.id },
        data: { status: 'FAILED', providerPayload: evt?.data },
      });
      await prisma.paymentEvent.create({
        data: { paymentId: pay.id, type: 'WEBHOOK_MARK_FAILED', data: { reference: ref } },
      });
    }
    return res.status(200).send('failed');
  }

  // Abandoned / pending / unknown
  return res.status(200).send('pending');
});

// GET /api/payments/status?orderId=...&reference=...
router.get('/status', requireAuth, async (req, res) => {
  try {
    const orderId = String(req.query.orderId || '');
    const reference = String(req.query.reference || '');

    if (!orderId || !reference) {
      return res.status(400).json({ error: 'orderId and reference are required' });
    }

    // Ensure the payment belongs to this order AND this user
    const pay = await prisma.payment.findFirst({
      where: {
        reference,          // unique globally
        orderId,            // belts & suspenders check
        order: { userId: req.user!.id },
      },
      select: { status: true },
    });

    if (!pay) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Client expects { status: 'PAID' | 'PENDING' | ... }
    return res.json({ status: pay.status });
  } catch (e: any) {
    console.error('payments/status error', e);
    return res.status(500).json({ error: 'Failed to fetch payment status' });
  }
});


// Verify signature first
function isValidSignature(rawBody: string, headerSig: string | undefined, secret: string) {
  if (!headerSig) return false;
  const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  return hash === headerSig;
}

// Helper: gate owner/admin
async function assertCanViewReceipt(userId: string, paymentId: string) {
  const row = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { status: true, order: { select: { userId: true } } },
  });
  console.log("row: ", row);
  if (!row || row.status !== 'PAID') throw new Error('Not found');
  const isOwner = row.order?.userId === userId;
  // you can add admin check here from req.user.role
  if (!isOwner) throw new Error('Forbidden');
}

router.get('/:paymentId/receipt', requireAuth, async (req, res) => {
  const { paymentId } = req.params;
  await assertCanViewReceipt(req.user!.id, paymentId);

  const pay = await issueReceiptIfNeeded(paymentId);
  if (!pay) return res.status(404).json({ error: 'Receipt not available' });

  return res.json({
    ok: true,
    receiptNo: pay.receiptNo,
    issuedAt: pay.receiptIssuedAt,
    data: pay.receiptData, // snapshot used by UI
  });
});

router.get('/:paymentId/receipt.pdf', requireAuth, async (req, res) => {
  const { paymentId } = req.params;
  await assertCanViewReceipt(req.user!.id, paymentId);
  const pay = await issueReceiptIfNeeded(paymentId);
  if (!pay?.receiptData) return res.status(404).json({ error: 'Receipt not available' });

  const r = pay.receiptData as any;

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
  doc.fillColor('#000'); // reset


  // Receipt meta
  doc.fillColor('#000').fontSize(12);
  doc.text(`Receipt No: ${pay.receiptNo || ''}`);
  doc.text(`Reference: ${r.reference}`);
  doc.text(`Paid At: ${new Date(r.paidAt).toLocaleString()}`);
  doc.moveDown();

  // Customer + Shipping
  doc.font('Helvetica-Bold').fontSize(11).text('Customer', { underline: true });
  doc.font('Helvetica'); // back to regular for the lines that follow
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

  // Items table (simple)
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

  // Totals
  const subtotal = Number(r.order?.subtotal || 0);
  const tax = Number(r.order?.tax || 0);
  const shipping = Number(r.order?.shipping || 0);
  const total = Number(r.order?.total || 0);
  doc.fontSize(11);
  doc.text(`Subtotal: NGN ${subtotal.toLocaleString()}`);
  doc.text(`Tax: NGN ${tax.toLocaleString()}`);
  doc.text(`Shipping: NGN ${shipping.toLocaleString()}`);
  doc.fontSize(12).text(`Total: NGN ${total.toLocaleString()}`, { continued: false });
  doc.moveDown(1);

  doc.fontSize(9).fillColor('#666')
    .text('Thank you for your purchase. This document serves as a receipt.', { align: 'left' });

  doc.end();
});


/**
 * POST /api/payments/link
 * Body: { orderId: string }
 * Returns a signed shareable payment URL
 */
router.post('/link', authMiddleware, async (req, res, next) => {
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

/* -------------------- Existing list endpoints (payment rows) -------------------- */

/**
 * GET /api/payments/mine?limit=5
 */
router.get('/mine', authMiddleware, async (req, res, next) => {
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

/**
 * GET /api/payments
 * Admin/system list of latest payment rows.
 */
router.get('/', authMiddleware, async (req, res, next) => {
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

/* --------------- Order-level "recent transactions" --------------- */
/**
 * GET /api/payments/recent?limit=5
 */
router.get('/recent', authMiddleware, async (req, res, next) => {
  try {
    const limitRaw = Number(req.query.limit);
    const take = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 5;

    const orders = await prisma.order.findMany({
      where: {
        // use current user rather than a hard-coded id
        userId: req.user!.id,
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        // if you want to show last few payments per order
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            reference: true,
            amount: true,       // <— valid on Payment
            status: true,
            channel: true,
            provider: true,
            createdAt: true,
            paidAt: true,
            // (do NOT select title/unitPrice here; they don't exist on Payment)
          },
        },

        // OPTIONAL: include items if you want product/line details in this response
        items: {
          select: {
            id: true,
            productId: true,
            variantId: true,
            // below assume your new order-item fields; fall back if you still have old ones
            title: true,
            unitPrice: true,
            quantity: true,
            lineTotal: true,
          },
        },
      },
    });

    // (optional) shape the response
    const data = orders.map((o: { id: any; createdAt: any; total: any; payments: any[]; items: any; }) => ({
      id: o.id,
      createdAt: o.createdAt,
      total: o.total,
      // include a compact summary of the most recent payment (if any)
      latestPayment: o.payments[0] || null,
      // include items if you included them above
      items: (o.items || []).map((it: { id: any; productId: any; variantId: any; title: any; unitPrice: any; quantity: any; lineTotal: any; }) => ({
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

// Compat alias so existing UIs that call /api/admin/payments keep working.
// Returns the SAME { data: [...] } shape as /api/payments/admin.
router.get('/admin/compat-alias', authMiddleware, async (req, res, next) => {
  try {
    // Require admin:
    const isAdmin = (r?: string) => r === 'ADMIN' || r === 'SUPER_ADMIN';
    if (!isAdmin(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });

    // Reuse the same logic by faking the path:
    (req as any).query.includeItems = (req.query.includeItems ?? '1');
    (req as any).query.limit = (req.query.limit ?? '20');

    // Call the same code as /api/payments/admin:
    // easiest is to duplicate handler; but we can also 302 to /api/payments/admin
    // Here we duplicate minimal logic to avoid surprises:

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

    const data = rows.map((p: { id: any; orderId: any; order: { user: { email: any; }; status: any; }; amount: any; status: any; provider: any; channel: any; reference: any; createdAt: { toISOString: () => any; }; }) => ({
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
