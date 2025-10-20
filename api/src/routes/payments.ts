// src/routes/payments.ts
import { Router, type Request, type Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireAuth } from '../middleware/auth.js';
import { requireVerified } from '../middleware/requireVerify.js';

const router = Router();

/* ----------------------------- Config ----------------------------- */

const MODE = (process.env.PAYMENTS_MODE || 'trial').toLowerCase() as 'trial' | 'paystack';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';

const TRIAL_BANK_NAME = process.env.TRIAL_BANK_NAME || '';
const TRIAL_BANK_ACCOUNT_NAME = process.env.TRIAL_BANK_ACCOUNT_NAME || '';
const TRIAL_BANK_ACCOUNT_NUMBER = process.env.TRIAL_BANK_ACCOUNT_NUMBER || '';

function makeRef(orderId: string) {
  return `ys_${orderId}_${Math.random().toString(36).slice(2, 8)}`;
}

/* --------------------------- Helpers ------------------------------ */

/** Ensure Paystack customer exists, returning customer_code */
async function ensurePaystackCustomer(email: string, fallbackEmail: string): Promise<string> {
  try {
    const r = await axios.post(
      'https://api.paystack.co/customer',
      { email: email || fallbackEmail },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }, timeout: 15000 }
    );
    const code = r.data?.data?.customer_code;
    if (code) return code;
  } catch (err: any) {
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

const isAdmin = (role?: string) => role === 'ADMIN' || role === 'SUPER_ADMIN';

/**
 * POST /api/payments/init
 * Body: { orderId: string, channel?: string }
 * Requires: logged in + email & phone verified
 */
router.post('/init', requireAuth, requireVerified(), async (req, res) => {
  try {
    const { orderId, channel } = req.body as { orderId: string; channel?: string };
    if (!orderId?.trim()) return res.status(400).json({ error: 'orderId is required' });

    // Load order + user’s email (Paystack needs an email)
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        user: { select: { id: true, email: true } },
      },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Non-admins must own the order
    if (!isAdmin(req.user?.role) && String(order.userId) !== String(req.user!.id)) {
      return res.status(403).json({ error: 'This order does not belong to your account.' });
    }
    if (order.status === 'PAID') return res.status(400).json({ error: 'Order already paid' });
    if (!order.items?.length) return res.status(400).json({ error: 'Order has no items' });

    // Compute amount (replace with order.total if you persist it)
    const amount = order.items.reduce(
      (sum: number, it: any) => sum + Number(it.unitPrice) * Number(it.quantity ?? it.qty ?? 0),
      0
    );

    // Close any open attempts for this order
    await prisma.payment.updateMany({
      where: { orderId, status: { in: ['PENDING', 'REQUIRES_ACTION'] } },
      data: { status: 'CANCELED' },
    });

    // Create a new PENDING attempt
    const reference = `PSK_${orderId}_${Date.now()}`;
    await prisma.payment.create({
      data: {
        orderId,
        amount,
        status: 'PENDING',
        provider: 'PAYSTACK',
        channel,
        reference,
        initPayload: { startedBy: req.user?.email, at: new Date().toISOString() },
      },
    });

    // Initialize with Paystack
    const initResp = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: order.user.email,
        amount: Math.round(amount * 100), // KOBO
        reference,
        callback_url: `${APP_URL}/payment-callback?orderId=${orderId}`,
        metadata: { orderId, userId: order.userId },
      },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );

    const { authorization_url } = initResp.data?.data || {};
    if (!authorization_url) {
      return res.status(502).json({ error: 'Could not get authorization URL from Paystack' });
    }

    return res.json({
      mode: MODE,
      reference,
      authorization_url,
    });
  } catch (err: any) {
    console.error('init error:', err?.response?.data || err);
    return res.status(500).json({ error: 'Could not initialize payment' });
  }
});

/**
 * POST /api/payments/verify
 * Body: { orderId: string, reference: string }
 * Requires: logged in + email & phone verified
 */
router.post('/verify', requireAuth, requireVerified(), async (req, res) => {
  const { orderId, reference } = req.body as { orderId: string; reference: string };

  if (!orderId?.trim() || !reference?.trim()) {
    return res.status(400).json({ error: 'orderId and reference are required' });
  }

  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment) return res.status(404).json({ error: 'Payment not initialized' });
  if (payment.reference !== reference) {
    return res.status(400).json({ error: 'Reference mismatch' });
  }

  // TODO: Call provider verify here (Paystack /transaction/verify/:reference)
  const verified = true; // demo placeholder

  if (!verified) {
    await prisma.payment.update({ where: { orderId }, data: { status: 'FAILED' } });
    return res.json({ status: 'FAILED', message: 'Verification failed' });
  }

  // Mark payment + order once
  await prisma.$transaction(async (tx: { payment: { update: (arg0: { where: { reference: string; }; data: { status: string; paidAt: Date; }; }) => any; }; order: { update: (arg0: { where: { id: any; }; data: { status: string; }; }) => any; }; }) => {
    await tx.payment.update({
      where: { reference },
      data: { status: 'PAID', paidAt: new Date() },
    });
    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: 'PAID' },
    });
  });

  return res.json({ ok: true, status: 'PAID', message: 'Payment verified' });
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
    // swallow parse errors; respond 200 to stop retries when appropriate.
  }
  res.sendStatus(200);
}

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
