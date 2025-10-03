import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { handlePaidOrder } from '../services/fulfilment.js';

const router = Router();

/** This is called by your PSP webhook handler after *successful* payment. */
router.post('/confirm', async (req, res, next) => {
  try {
    const { orderId, paymentRef } = req.body;
    const order = await prisma.order.update({ where: { id: orderId }, data: { status: 'PAID', paymentRef } });
    const poIds = await handlePaidOrder(order.id);
    res.json({ ok: true, orderId: order.id, poIds });
  } catch (e) { next(e); }
});

export default router;
