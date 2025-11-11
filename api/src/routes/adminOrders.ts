import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../middleware/auth.js';
import { logOrderActivityTx } from '../services/activity.service.js';
import { notifySuppliersForOrder } from '../services/notify.js';
import { syncProductInStockCacheTx } from '../services/inventory.service.js';

const router = Router();


const ACT = {
  STATUS_CHANGE: 'STATUS_CHANGE',
} as const;

// POST /api/admin/orders/:orderId/cancel
router.post('/:orderId/cancel', requireAdmin, async (req, res) => {
  const { orderId } = req.params;

  try {
    const updated = await prisma.$transaction(async (tx: any) => {
      // 1) Load order with items + payments
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            select: {
              id: true,
              productId: true,
              variantId: true,
              quantity: true,
              chosenSupplierOfferId: true,
            },
          },
          payments: {
            select: { status: true },
          },
        },
      });

      if (!order) {
        throw new Error('Order not found');
      }

      // Do not cancel if already canceled
      if (order.status === 'CANCELED') {
        return order;
      }

      // Block cancel if any successful payment exists
      const hasPaid = (order.payments || []).some((p: { status: any; }) => {
        const s = String(p.status || '').toUpperCase();
        return ['PAID', 'SUCCESS', 'SUCCESSFUL', 'VERIFIED', 'COMPLETED'].includes(s);
      });
      if (hasPaid || ['PAID', 'COMPLETED'].includes(order.status)) {
        throw new Error('Cannot cancel an order that has been paid/completed.');
      }

      // 2) Restock allocated supplier offers (if any)
      for (const it of order.items) {
        const qty = Number(it.quantity || 0);
        if (!it.chosenSupplierOfferId || !qty || qty <= 0) continue;

        // increment stock back
        const updatedOffer = await tx.supplierOffer.update({
          where: { id: it.chosenSupplierOfferId },
          data: { availableQty: { increment: qty } },
          select: { id: true, availableQty: true },
        });

        // ensure inStock flag is correct
        if (Number(updatedOffer.availableQty) > 0) {
          await tx.supplierOffer.update({
            where: { id: updatedOffer.id },
            data: { inStock: true },
          });
        }

        // sync product cache
        await syncProductInStockCacheTx(tx, it.productId);
      }

      // 3) Mark order canceled
      const canceled = await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELED' },
      });

      // 4) Log activity
      await logOrderActivityTx(
        tx,
        orderId,
        ACT.STATUS_CHANGE as any,
        'Order canceled by admin',
      );

      return canceled;
    });

    return res.json({ ok: true, data: updated });
  } catch (e: any) {
    console.error('Admin cancel order failed:', e);
    const msg = e?.message || 'Failed to cancel order';
    // If we intentionally threw a user-facing error, send 400
    if (
      msg.includes('Cannot cancel an order') ||
      msg.includes('Order not found')
    ) {
      return res.status(400).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
});


/* =========================================================
   GET /api/admin/orders/:orderId/activities
========================================================= */
router.get('/:orderId/activities', requireAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const items = await prisma.orderActivity.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: items });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   POST /api/admin/orders/:orderId/notify-suppliers
========================================================= */
router.post('/:orderId/notify-suppliers', requireAdmin, async (req, res) => {
  const { orderId } = req.params as { orderId: string };
  try {
    const result = await notifySuppliersForOrder(orderId);
    return res.json(result);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || 'Notify failed' });
  }
});

/* =========================================================
   GET /api/admin/orders/:orderId/notify-status
========================================================= */
router.get('/:orderId/notify-status', requireAdmin, async (req, res) => {
  const { orderId } = req.params as { orderId: string };
  const pos = await prisma.purchaseOrder.findMany({
    where: { orderId },
    select: { id: true, supplierId: true, whatsappMsgId: true, status: true },
  });
  return res.json({ data: pos });
});

export default router;
