// routes/adminOrders.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../middleware/auth.js';
import { logOrderActivity } from '../services/activity.service.js';

const router = Router();

/** POST /api/admin/orders/:id/cancel  (ADMIN only) */
router.post('/:id/cancel', requireAdmin, async (req, res) => {
  const id = req.params.id;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!order) return res.status(404).json({ error: 'Not found' });

  // Only allow cancel from pending-like states
  const cancellable = new Set(['PENDING', 'CREATED']);
  if (!cancellable.has(String(order.status).toUpperCase())) {
    return res.status(409).json({ error: 'Only pending orders can be cancelled' });
  }

  const updated = await prisma.order.update({
    where: { id },
    data: { status: 'CANCELED' },
    select: { id: true, status: true },
  });

  await logOrderActivity(id, 'STATUS_CHANGE', 'Order cancelled by admin', {
    from: order.status, to: updated.status,
  });

  res.json(updated);
});



router.get('/:orderId/activities', requireAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const items = await prisma.orderActivity.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: items });
  } catch (e) { next(e); }
});

export default router;
