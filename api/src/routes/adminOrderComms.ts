// api/src/routes/admin.orderComms.ts
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../middleware/auth.js';
import { getGlobalCommsFee } from '../lib/comms.js';

const router = Router();

/**
 * POST /api/admin/orders/:orderId/comms
 * body: { amount?: number, reason?: string }
 * - If amount omitted, uses global comms fee
 * - Creates an OrderComms row
 * - Returns current total comms logged for the order
 */
router.post('/:orderId/comms', requireAdmin, async (req, res) => {
  const { orderId } = req.params;
  const amountRaw = req.body?.amount;
  const reason = (req.body?.reason ?? '').toString().slice(0, 200);

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const globalFee = await getGlobalCommsFee();
  const amount = Number.isFinite(Number(amountRaw)) ? Number(amountRaw) : globalFee;

  const row = await prisma.orderComms.create({
    data: {
      orderId,
      amount: new Prisma.Decimal(amount),
      reason: reason || null,
    },
  });

  const sum = await prisma.orderComms.aggregate({
    where: { orderId },
    _sum: { amount: true },
  });

  res.status(201).json({
    data: {
      id: row.id,
      amount: Number(row.amount),
      reason: row.reason,
      createdAt: row.createdAt,
      orderId,
      orderCommsTotal: Number(sum._sum.amount ?? 0),
    },
  });
});

/**
 * GET /api/admin/orders/:orderId/comms
 * Returns list + total
 */
router.get('/:orderId/comms', requireAdmin, async (req, res) => {
  const { orderId } = req.params;
  const list = await prisma.orderComms.findMany({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
  });
  const total = list.reduce((s: number, r: { amount: any; }) => s + Number(r.amount), 0);
  res.json({ data: { items: list, total } });
});

export default router;
