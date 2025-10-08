import { Router } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../lib/authMiddleware.js';
import express from 'express'

const router = Router();

const MODE = (process.env.PAYMENTS_MODE || 'trial').toLowerCase(); // 'trial' | 'paystack'
const APP_URL = process.env.APP_URL;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';

const TRIAL_BANK_NAME = process.env.TRIAL_BANK_NAME;
const TRIAL_BANK_ACCOUNT_NAME = process.env.TRIAL_BANK_ACCOUNT_NAME;
const TRIAL_BANK_ACCOUNT_NUMBER = process.env.TRIAL_BANK_ACCOUNT_NUMBER;

function makeRef(orderId: string) {
  // short, unique-enough ref for demo
  return `ys_${orderId}_${Math.random().toString(36).slice(2, 8)}`;
}

const PAYSTACK_INLINE_BANK = process.env.PAYSTACK_INLINE_BANK === '1'; // when true & channel==='bank_transfer', return bank details from Paystack

router.post('/init', authMiddleware, async (req, res, next) => {
  try {
    const { orderId, channel } = req.body as { orderId: string; channel?: 'card' | 'bank_transfer' };
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { user: true } });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

    const amountNgn = Number(order.total);
    const reference = makeRef(order.id);

    // Record the Payment attempt up-front
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

    // 1) Trial: return static bank details for UI to render
    if (MODE === 'trial') {
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
        instructions: 'Transfer the exact amount. Include the reference in narration. Click “I have paid” to verify.',
      });
    }

    // 2) Paystack: either hosted checkout (redirect) or INLINE bank details
    if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY not configured' });

    // 2a) INLINE bank details via Paystack Dedicated Virtual Account
    if (channel === 'bank_transfer' && PAYSTACK_INLINE_BANK) {
      // Ensure Paystack Customer exists
      const customerRes = await axios.post(
        'https://api.paystack.co/customer',
        { email: order.user.email || `noemail+${order.userId}@yemishop.local` },
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }, timeout: 15000 }
      ).catch(async (err) => {
        // ignore 400 "Customer already exists" by fetching customer
        if (err?.response?.status === 400) {
          return axios.get(
            `https://api.paystack.co/customer/${encodeURIComponent(order.user.email)}`,
            { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }, timeout: 15000 }
          );
        }
        throw err;
      });
      const customer = customerRes.data?.data;
      const customerCode = customer?.customer_code;
      // Request Dedicated Virtual Account for this customer
      const dvaRes = await axios.post(
        'https://api.paystack.co/dedicated_account',
        {
          customer: customerCode,
          preferred_bank: '', // or leave empty; depends on your Paystack config/KYC
        },
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }, timeout: 15000 }
      );

      const acct = dvaRes.data?.data;
      if (!acct?.account_number) {
        return res.status(502).json({ error: 'Failed to get bank account from Paystack' });
      }

      return res.json({
        mode: 'paystack_inline_bank',
        amount: amountNgn,
        currency: 'NGN',
        reference,
         bank: {
          bank_name: TRIAL_BANK_NAME,
          account_name: TRIAL_BANK_ACCOUNT_NAME,
          account_number: TRIAL_BANK_ACCOUNT_NUMBER,
        },
        instructions: 'Transfer the exact amount to the account below. Click “I have paid” to verify.',
      });
    }

    // 2b) Hosted checkout: redirect user to Paystack page (shows bank details itself if channel=bank_transfer)
    const payload: any = {
      email: order.user.email || 'noemail@yemishop.local',
      amount: Math.round(amountNgn * 100),
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


// VERIFY (manual verify, e.g. after redirect or "I have paid" click)
router.post('/verify', authMiddleware, async (req, res, next) => {
  try {
    const { reference, orderId } = req.body as { reference: string; orderId: string };

    const payment = await prisma.payment.findUnique({ where: { reference } });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    // Optional: enforce owner
    const order = await prisma.order.findUnique({ where: { id: payment.orderId } });
    if (!order || order.userId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data } = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    });

    const status = data?.data?.status; // 'success', 'failed'
    if (status !== 'success') {
      await prisma.payment.update({
        where: { reference },
        data: { status: 'FAILED', providerRef: data?.data?.reference ?? null },
      });
      return res.status(400).json({ error: 'Payment not successful yet' });
    }

    await prisma.$transaction([
      prisma.payment.update({
        where: { reference },
        data: { status: 'PAID', providerRef: data?.data?.reference ?? null },
      }),
      prisma.order.update({
        where: { id: payment.orderId },
        data: { status: 'PAID' },
      }),
    ]);

    res.json({ ok: true , status: 'PAID'});
  } catch (e) {
    next(e);
  }
});

// WEBHOOK (recommended): configure this URL in Paystack dashboard
// Verify x-paystack-signature (HMAC SHA512 of raw body with your secret)
router.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  const signature = req.headers['x-paystack-signature'] as string | undefined;
  if (!signature) return res.status(400).end('No signature');

  const computed = crypto.createHmac('sha512', PAYSTACK_SECRET).update(req.body).digest('hex');
  if (computed !== signature) return res.status(400).end('Invalid signature');

  try {
    const evt = JSON.parse(req.body.toString('utf8'));
    if (evt?.event === 'charge.success') {
      const reference = evt?.data?.reference;
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
  } catch (e) {
    // swallow – webhook must reply 200 for Paystack to stop retries if success
  }
  res.sendStatus(200);
});

// SHAREABLE PAYMENT LINK (for paying on behalf / sending to others)
import jwt from 'jsonwebtoken';

// Create a share token
router.post('/link', authMiddleware, async (req, res, next) => {
  try {
    const { orderId } = req.body as { orderId: string };
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== req.user!.id) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const token = jwt.sign({ oid: orderId }, process.env.JWT_SECRET!, { expiresIn: '2d' });
    const url = `${APP_URL}/payment?orderId=${orderId}&share=${encodeURIComponent(token)}`;
    res.json({ shareUrl: url });
  } catch (e) {
    next(e);
  }
});

export default router;
