// api/src/routes/admin.ts
import { Router } from 'express';
import { requireAuth, requireAdmin , requireSuperAdmin} from '../middleware/auth.js';
import {
  getOverview,
  findUsers,
  promoteToSuperUser,
  suspendUser,
  
  markPaymentPaid,
  markPaymentRefunded,

  pendingProducts,
  approveProduct as approveProductSvc,
  rejectProduct as rejectProductSvc,
  listPayments as listPaymentsSvc,
  opsSnapshot as opsSnapshotSvc,
  createCoupon as createCouponSvc,
} from '../services/admin.service.js';
import { toCsv } from '../lib/csv.js';
import { startOfDay, subDays } from 'date-fns';
import { prisma } from '../lib/prisma.js';

const r = Router();
r.use(requireAuth, requireAdmin);

/* Overview */
r.get('/overview', async (_req, res) => {
  res.json(await getOverview());
});

/* Users & roles */
r.get('/users', async (req, res) => {
  const q = String(req.query.q || '');
  res.json({ data: await findUsers(q) });
});
r.post('/users/:userId/approve-super', requireSuperAdmin,  async (req, res) => {
  res.json(await promoteToSuperUser(req.params.userId));
});
r.post('/users/:userId/deactivate',  requireSuperAdmin, async (req, res) => {
  res.json(await suspendUser(req.params.userId));
});

/* Product moderation */
r.get('/products/pending', async (req, res) => {
  const q = String(req.query.q || '');
  res.json({ data: await pendingProducts(q) });
});
r.post('/products/:productId/approve', async (req, res) => {
  res.json(await approveProductSvc(req.params.productId));
});
r.post('/products/:productId/reject', async (req, res) => {
  res.json(await rejectProductSvc(req.params.productId));
});

/* Transactions */
r.get('/payments', async (req, res) => {
  const q = String(req.query.q || '');
  res.json({ data: await listPaymentsSvc(q) });
});
r.post('/payments/:paymentId/verify',  requireSuperAdmin, async (req, res) => {
  res.json(await markPaymentPaid(req.params.paymentId));
});
r.post('/payments/:paymentId/refund', requireSuperAdmin, async (req, res) => {
  res.json(await markPaymentRefunded(req.params.paymentId));
});

/* Ops */
r.get('/ops/snapshot', async (_req, res) => {
  res.json(opsSnapshotSvc());
});

/* Marketing */
r.post('/marketing/announce', async (req, res) => {
  const { message } = req.body || {};
  if (!String(message || '').trim()) return res.status(400).json({ error: 'Message required' });
  // TODO: enqueue/email broadcast; for now return ok
  res.json({ ok: true });
});
r.post('/marketing/coupons', async (req, res) => {
  const { code, pct, maxUses } = req.body || {};
  if (!code || !pct) return res.status(400).json({ error: 'code & pct required' });
  try {
    res.json(await createCouponSvc({ code, pct: Number(pct), maxUses: Number(maxUses) }));
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to create coupon' });
  }
});

/* Analytics export (CSV) */
r.get('/analytics/export', requireSuperAdmin, async (_req, res) => {
  const since = subDays(new Date(), 29);
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: startOfDay(since) } },
    select: { id: true, createdAt: true },
  });
  const payments = await prisma.payment.findMany({
    where: { createdAt: { gte: startOfDay(since) }, status: 'PAID' },
    select: { id: true, createdAt: true, amount: true },
  });

  const bucket: Record<string, { date: string; orders: number; revenue: number }> = {};
  for (let i = 0; i < 30; i++) {
    const d = startOfDay(subDays(new Date(), i));
    const key = d.toISOString().slice(0, 10);
    bucket[key] = { date: key, orders: 0, revenue: 0 };
  }
  for (const o of orders) {
    const key = startOfDay(o.createdAt).toISOString().slice(0, 10);
    if (bucket[key]) bucket[key].orders += 1;
  }
  for (const p of payments) {
    const key = startOfDay(p.createdAt).toISOString().slice(0, 10);
    if (bucket[key]) bucket[key].revenue += Number(p.amount) || 0;
  }
  const rows = Object.values(bucket).sort((a, b) => a.date.localeCompare(b.date));
  const csv = toCsv(['date', 'orders', 'revenue'], rows);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="analytics-report.csv"');
  res.send(csv);
});

export default r;
