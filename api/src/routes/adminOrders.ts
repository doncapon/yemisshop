import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../middleware/auth.js';
import { logOrderActivity } from '../services/activity.service.js';
import { notifySuppliersForOrder } from '../services/notify.js';
import { syncProductInStockCacheTx } from '../services/inventory.service.js';

const router = Router();

/* =========================================================
   POST /api/admin/orders/:id/cancel
   - Admins can cancel any order
   - Idempotent restock (won’t restock twice)
   - After incrementing offers, set inStock=true where availableQty>0
   - Recompute product/variant inStock caches from offers
========================================================= */
router.post('/:id/cancel', requireAdmin, async (req, res, next) => {
  try {
    const orderId = String(req.params.id);

    // Minimal order + items for restock & status check
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        status: true,
        items: {
          select: {
            id: true,
            productId: true,
            variantId: true,
            quantity: true,
            supplierOfferId: true, // name may be chosenSupplierOfferId in your schema; adjust if needed
          },
        },
      },
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });

    const terminal = new Set(['CANCELED', 'COMPLETED']);
    if (terminal.has(order.status)) {
      return res.status(400).json({ error: `Order is already ${order.status}` });
    }

    // Idempotence: if we already restocked once, do not restock again
    const alreadyRestocked = await prisma.orderActivity.findFirst({
      where: { orderId, type: 'ORDER_RESTOCKED' as any },
      select: { id: true },
    });

    let restockMeta:
      | {
          increments: Array<{ offerId: string; qty: number }>;
          affectedProducts: string[];
        }
      | null = null;

    const previousStatus = order.status;

    await prisma.$transaction(async (tx: any) => {
      if (!alreadyRestocked) {
        const incByOffer = new Map<string, number>();
        const affectedProducts = new Set<string>();

        for (const it of order.items) {
          affectedProducts.add(it.productId);
          const offerId = (it as any).supplierOfferId; // or chosenSupplierOfferId if that’s your schema
          if (offerId) {
            incByOffer.set(offerId, (incByOffer.get(offerId) || 0) + Number(it.quantity || 0));
          }
        }

        // Apply increments
        const touchedOfferIds: string[] = [];
        for (const [offerId, qty] of incByOffer.entries()) {
          if (qty > 0) {
            await tx.supplierOffer.updateMany({
              where: { id: offerId },
              data: { availableQty: { increment: qty } },
            });
            touchedOfferIds.push(offerId);
          }
        }

        // Any touched offer with availableQty > 0 should be inStock=true
        if (touchedOfferIds.length > 0) {
          await tx.supplierOffer.updateMany({
            where: { id: { in: touchedOfferIds }, availableQty: { gt: 0 } },
            data: { inStock: true },
          });
        }

        // Recompute product caches based on offers (sum(active.availableQty) > 0)
        for (const pid of affectedProducts) {
          await syncProductInStockCacheTx(tx, pid);
        }

        restockMeta = {
          increments: Array.from(incByOffer.entries()).map(([offerId, qty]) => ({ offerId, qty })),
          affectedProducts: Array.from(affectedProducts),
        };
      }

      // Update status to CANCELED (idempotent)
      if (previousStatus !== 'CANCELED') {
        await tx.order.update({
          where: { id: orderId },
          data: { status: 'CANCELED' },
        });
      }
    });

    // Post-commit activities (best-effort)
    try {
      await logOrderActivity(orderId, 'ORDER_CANCELED' as any, 'Order was canceled', {
        previousStatus,
        canceledBy: 'ADMIN',
      });

      if (!alreadyRestocked && restockMeta) {
        const { increments, affectedProducts } = restockMeta;
        await logOrderActivity(
          orderId,
          'ORDER_RESTOCKED' as any,
          'Inventory returned to supplier offers',
          { increments, affectedProducts }
        );
      }
    } catch {
      /* swallow log errors */
    }

    res.json({
      id: orderId,
      status: 'CANCELED',
      restocked: !alreadyRestocked,
      restock: restockMeta ?? undefined,
    });
  } catch (e) {
    next(e);
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
