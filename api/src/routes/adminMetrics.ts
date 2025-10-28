// src/routes/adminMetrics.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/admin/metrics/profit-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 * - Returns profitSum (range), profitToday, and count of events.
 * - Uses PaymentEvent(type='PROFIT_COMPUTED') data.profit
 */
router.get('/profit-summary', requireAuth, requireSuperAdmin, async (req, res) => {
  const tzNow = new Date(); // server local; if you want Lagos, adjust with luxon/dayjs
  const yyyy = tzNow.getFullYear();
  const mm = String(tzNow.getMonth() + 1).padStart(2, '0');
  const dd = String(tzNow.getDate()).padStart(2, '0');

  const qFrom = String(req.query.from || `${yyyy}-${mm}-${dd}`);
  const qTo   = String(req.query.to   || `${yyyy}-${mm}-${dd}`);

  const fromStart = new Date(`${qFrom}T00:00:00.000Z`);
  const toEnd     = new Date(`${qTo}T23:59:59.999Z`);

  // fetch only the events we need and sum in app (JSON column)
  const events = await prisma.paymentEvent.findMany({
    where: {
      type: 'PROFIT_COMPUTED',
      createdAt: { gte: fromStart, lte: toEnd },
    },
    select: { data: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 5000, // safety cap; increase if needed
  });

  const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  // sum in range
  const profitSum = events.reduce((s: number, ev: { data: any; }) => s + n((ev.data as any)?.profit), 0);

  // sum today only (guard in case from/to are larger)
  const todayStart = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
  const todayEnd   = new Date(`${yyyy}-${mm}-${dd}T23:59:59.999Z`);
  const profitToday = events
    .filter((ev: { createdAt: Date; }) => ev.createdAt >= todayStart && ev.createdAt <= todayEnd)
    .reduce((s: number, ev: { data: any; }) => s + n((ev.data as any)?.profit), 0);

  res.json({
    range: { from: qFrom, to: qTo },
    eventsCount: events.length,
    profitSum,
    profitToday,
  });
});

export default router;
