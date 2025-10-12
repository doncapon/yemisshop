// src/routes/payments.ts
import express, { Router, type Request, type Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../lib/authMiddleware.js';

const router = Router();

/* ----------------------------- Config ----------------------------- */

const MODE = (process.env.PAYMENTS_MODE || 'trial').toLowerCase() as 'trial' | 'paystack';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';

const TRIAL_BANK_NAME = process.env.TRIAL_BANK_NAME || '';
const TRIAL_BANK_ACCOUNT_NAME = process.env.TRIAL_BANK_ACCOUNT_NAME || '';
const TRIAL_BANK_ACCOUNT_NUMBER = process.env.TRIAL_BANK_ACCOUNT_NUMBER || '';

const PAYSTACK_INLINE_BANK = process.env.PAYSTACK_INLINE_BANK === '1'; // when true & channel==='bank_transfer', get DVA from Paystack

function makeRef(orderId: string) {
  return `ys_${orderId}_${Math.random().toString(36).slice(2, 8)}`;
}

/* --------------------------- Helpers ------------------------------ */

/** Ensure Paystack customer exists, returning customer_code */
async function ensurePaystackCustomer(email: string, fallbackEmail: string): Promise<string> {
  // try create
  try {
    const r = await axios.post(
      'https://api.paystack.co/customer',
      { email: email || fallbackEmail },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }, timeout: 15000 }
    );
    const code = r.data?.data?.customer_code;
    if (code) return code;
  } catch (err: any) {
    // If already exists, search by email
    if (err?.response?.status === 400) {
      const sr = await axios.get('https://api.paystack.co/customer', {
        params: { email },
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
        timeout: 15000,
      });
        const code = sr.data?.data?.[0]?.customer_code;
        if (code) return code;
    }
    throw err;
  }
  throw new Error('Unable to resolve Paystack customer');
}

/* ----------------------------- Routes ----------------------------- */

/**
 * GET /api/payments/summary
 * Returns total amount successfully paid by the current user (major units, NGN).
 * Response: { totalPaid: number, currency: 'NGN' }
 */
router.get('/summary', authMiddleware, async (req, res, next) => {
  try {
    // Sum all PAID payments for orders owned by this user (no limit)
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
 * INITIATE PAYMENT
 * POST /api/payments/init
 * Body: { orderId: string, channel?: 'card' | 'bank_transfer' }
 */
router.post('/init', authMiddleware, async (req, res, next) => {
  try {
    const { orderId, channel } = req.body as { orderId: string; channel?: 'card' | 'bank_transfer' };
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

    const amountNgn = Number(order.total);
    if (!Number.isFinite(amountNgn)) return res.status(400).json({ error: 'Invalid order total' });

    const reference = makeRef(order.id);

    // record payment attempt
    await prisma.payment.create({
      data: {
        orderId: order.id,
        amount: order.total,
        currency: 'NGN',
        status: 'PENDING',
        provider: MODE === 'paystack' ? 'PAYSTACK' : 'TRIAL',
        channel: channel || (MODE === 'trial' ? 'bank_transfer' : 'card'),
        reference,
      },
    });

    // Trial mode: return static bank details
    if (MODE === 'trial') {
      if (!TRIAL_BANK_NAME || !TRIAL_BANK_ACCOUNT_NAME || !TRIAL_BANK_ACCOUNT_NUMBER) {
        return res.status(500).json({ error: 'Trial bank details not configured' });
      }
      return res.json({
        mode: 'trial',
        amount: amountNgn,
        currency: 'NGN',
        reference,
        bank: {
          bank_name: TRIAL_BANK_NAME,
          account_name: TRIAL_BANK_ACCOUNT_NAME,
          account_number: TRIAL_BANK_ACCOUNT_NUMBER,
        },
        instructions:
          'Transfer the exact amount. Include the reference in narration. Click “I have paid” to verify.',
      });
    }

    // Paystack mode sanity
    if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY not configured' });

    // Inline bank: create DVA (Dedicated Virtual Account)
    if (channel === 'bank_transfer' && PAYSTACK_INLINE_BANK) {
      const customerCode = await ensurePaystackCustomer(
        order.user.email || '',
        `noemail+${order.userId}@yemishop.local`
      );

      const dvaRes = await axios.post(
        'https://api.paystack.co/dedicated_account',
        { customer: customerCode },
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }, timeout: 15000 }
      );

      const acct = dvaRes.data?.data;
      // Different accounts of Paystack sometimes differ in shape — support both.
      const bank_name = acct?.bank?.name ?? acct?.bank_name;
      const account_name = acct?.account_name;
      const account_number = acct?.account_number;

      if (!account_number || !account_name || !bank_name) {
        return res.status(502).json({ error: 'Failed to get bank account from Paystack' });
      }

      return res.json({
        mode: 'paystack_inline_bank',
        amount: amountNgn,
        currency: 'NGN',
        reference,
        bank: { bank_name, account_name, account_number },
        instructions: 'Transfer the exact amount to the account below. Click “I have paid” to verify.',
      });
    }

    // Hosted checkout
    const amountKobo = Math.round(amountNgn * 100);
    const payload: Record<string, unknown> = {
      email: order.user.email || 'noemail@yemishop.local',
      amount: amountKobo,
      currency: 'NGN',
      reference,
      callback_url: `${APP_URL}/payment-callback?orderId=${order.id}&reference=${encodeURIComponent(reference)}`,
    };
    if (channel) payload.channels = [channel];

    const initRes = await axios.post('https://api.paystack.co/transaction/initialize', payload, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      timeout: 15000,
    });
    const authUrl = initRes.data?.data?.authorization_url;
    if (!authUrl) return res.status(502).json({ error: 'Failed to get authorization URL from Paystack' });

    return res.json({ mode: 'paystack', authorization_url: authUrl, reference });
  } catch (e) {
    next(e);
  }
});

/**
 * VERIFY PAYMENT (manual verify or after redirect)
 * POST /api/payments/verify
 * Body: { orderId: string, reference: string }
 */
router.post('/verify', authMiddleware, async (req, res, next) => {
  try {
    const { reference, orderId } = req.body as { reference: string; orderId: string };
    if (!reference || !orderId) return res.status(400).json({ error: 'reference and orderId are required' });

    const payment = await prisma.payment.findUnique({ where: { reference } });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const order = await prisma.order.findUnique({ where: { id: payment.orderId } });
    if (!order || order.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

    if (MODE === 'trial') {
      // In trial we can't truly verify with provider; treat as pending unless you want to auto-approve here.
      return res.status(400).json({ error: 'Trial mode does not verify with provider' });
    }

    const { data } = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      timeout: 15000,
    });

    const status = data?.data?.status; // 'success' | 'failed' | etc.
    const providerRef = data?.data?.reference ?? null;

    if (status !== 'success') {
      await prisma.payment.update({
        where: { reference },
        data: { status: 'FAILED', providerRef },
      });
      return res.status(400).json({ error: 'Payment not successful yet' });
    }

    // Idempotent: if already paid, just return ok
    if (payment.status === 'PAID' || order.status === 'PAID') {
      return res.json({ ok: true, status: 'PAID' });
    }

    await prisma.$transaction([
      prisma.payment.update({ where: { reference }, data: { status: 'PAID', providerRef } }),
      prisma.order.update({ where: { id: payment.orderId }, data: { status: 'PAID' } }),
    ]);

    res.json({ ok: true, status: 'PAID' });
  } catch (e) {
    next(e);
  }
});

/**
 * WEBHOOK HANDLER (exported)
 * Mount with express.raw at app level before express.json()
 */
export async function paystackWebhookHandler(req: Request, res: Response) {
  const signature = req.headers['x-paystack-signature'] as string | undefined;
  if (!signature) return res.status(400).end('No signature');
  if (!PAYSTACK_SECRET) return res.status(500).end('Missing secret');

  const computed = crypto.createHmac('sha512', PAYSTACK_SECRET).update(req.body).digest('hex');
  if (computed !== signature) return res.status(400).end('Invalid signature');

  try {
    const evt = JSON.parse(req.body.toString('utf8'));
    if (evt?.event === 'charge.success') {
      const reference = evt?.data?.reference as string | undefined;
      if (reference) {
        const payment = await prisma.payment.findUnique({ where: { reference } });
        if (payment && payment.status !== 'PAID') {
          await prisma.$transaction([
            prisma.payment.update({
              where: { reference },
              data: { status: 'PAID', providerRef: reference },
            }),
            prisma.order.update({
              where: { id: payment.orderId },
              data: { status: 'PAID' },
            }),
          ]);
        }
      }
    }
  } catch (_) {
    // Intentionally swallow: webhook must return 200 to stop retries when appropriate.
  }
  res.sendStatus(200);
}

/**
 * SHAREABLE PAYMENT LINK
 * POST /api/payments/link
 * Body: { orderId: string }
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
 * Returns latest N payment rows for the authenticated user (via order.userId).
 * (Kept for compatibility; your UI can switch to /payments/recent for order-level view.)
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
 * Admin/system list of latest payment rows (optional filters: userId, orderId, status, limit)
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    // Uncomment to lock to admins only:
    // if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });

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

/* --------------- NEW: Order-level "recent transactions" --------------- */
/**
 * GET /api/payments/recent?limit=5
 * Returns the user's most recent ORDERS as "transactions" — one row per order —
 * with the order total and a representative payment (prefer PAID else latest).
 *
 * Response: Array<{
 *   orderId: string;
 *   createdAt: string;
 *   total: number;            // order total (major unit)
 *   orderStatus: string;
 *   payment?: {
 *     id: string;
 *     reference: string | null;
 *     status: string;
 *     channel: string | null;
 *     provider: string | null;
 *     createdAt: string;
 *   }
 * }>
 */
router.get('/recent', authMiddleware, async (req, res, next) => {
  try {
    const limitRaw = Number(req.query.limit);
    const take = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 5;

    // Pull recent orders for the user
    const orders = await prisma.order.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            reference: true,
            status: true,
            channel: true,
            provider: true,
            createdAt: true,
          },
          take: 5, // small window; we’ll choose best representative below
        },
      },
    });

    const rows = orders.map((o: { payments: any[]; id: any; createdAt: { toISOString: () => any; }; total: any; status: any; }) => {
      // Prefer a PAID payment if any, else the latest attempt
      const paid = o.payments.find((p: { status: string; }) => p.status === 'PAID');
      const representative = paid ?? o.payments[0] ?? null;

      return {
        orderId: o.id,
        createdAt: o.createdAt.toISOString?.() ?? (o as any).createdAt,
        total: Number(o.total),
        orderStatus: o.status,
        payment: representative
          ? {
              id: representative.id,
              reference: representative.reference,
              status: representative.status,
              channel: representative.channel,
              provider: representative.provider,
              createdAt:
                (representative as any).createdAt?.toISOString?.() ??
                (representative as any).createdAt,
            }
          : undefined,
      };
    });

    res.json(rows);
  } catch (e) {
    next(e);
  }
});

export default router;
