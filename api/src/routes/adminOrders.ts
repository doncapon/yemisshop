import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import { logOrderActivityTx } from '../services/activity.service.js';
import { notifySuppliersForOrder } from '../services/notify.js';
import { syncProductInStockCacheTx } from '../services/inventory.service.js';
import { recomputeProductStockTx } from '../services/stockRecalc.service.js';

const router = Router();


const ACT = {
  STATUS_CHANGE: 'STATUS_CHANGE',
} as const;


async function assertVerifiedOrderOtp(
  orderId: string,
  purpose: "CANCEL_ORDER" | "PAY_ORDER",
  token: string
) {
  if (!token) throw new Error("Missing OTP token");

  const row = await prisma.orderOtpRequest.findFirst({
    where: {
      id: token,
      orderId,
      purpose,
      verifiedAt: { not: null },
    },
    select: { id: true, expiresAt: true, consumedAt: true },
  });

  if (!row) throw new Error("Invalid or unverified OTP token");
  if (row.expiresAt <= new Date()) throw new Error("OTP token expired");
  if (row.consumedAt) throw new Error("OTP token already used");

  // ✅ consume (one-time)
  await prisma.orderOtpRequest.update({
    where: { id: row.id },
    data: { consumedAt: new Date() },
  });
}





// GET /api/admin/orders/:orderId
router.get('/:orderId', requireAdmin, async (req, res) => {
  const { orderId } = req.params as { orderId: string };

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { email: true } },
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            product: { select: { title: true } },
            variant: { select: { id: true, sku: true, imagesJson: true } },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            provider: true,
            reference: true,
            amount: true,
            createdAt: true,
          },
        },
      },
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });

    // compute paidAmount for UI (string/decimal is fine; your fmtN handles it)
    const paidStatuses = new Set(['PAID', 'VERIFIED', 'SUCCESS', 'SUCCESSFUL', 'COMPLETED']);
    const paidAmount = (order.payments || []).reduce((acc: number, p: any) => {
      const s = String(p?.status || '').toUpperCase();
      if (!paidStatuses.has(s)) return acc;
      const n = Number(String(p.amount ?? 0));
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);

    // Shape the response to match what Orders.tsx expects
    const dto = {
      id: order.id,
      status: order.status,
      total: order.total,
      tax: order.tax,
      subtotal: order.subtotal,
      serviceFeeTotal: order.serviceFeeTotal, // ✅ this is the exact field you want
      serviceFee: order.serviceFee, // optional (fallback)
      serviceFeeBase: order.serviceFeeBase,
      serviceFeeComms: order.serviceFeeComms,
      serviceFeeGateway: order.serviceFeeGateway,
      createdAt: order.createdAt,

      userEmail: order.user?.email ?? null,

      paidAmount,

      items: (order.items || []).map((it: any) => ({
        id: it.id,
        productId: it.productId ?? null,
        title: it.title ?? it.product?.title ?? null,

        unitPrice: it.unitPrice,
        quantity: it.quantity,
        lineTotal: it.lineTotal,

        status: it.status ?? null,

        selectedOptions: it.selectedOptions ?? null,

        chosenSupplierUnitPrice: it.chosenSupplierUnitPrice ?? null,

        // keep these in case your UI starts using them
        chosenSupplierId: it.chosenSupplierId ?? null,
        chosenSupplierProductOfferId: it.chosenSupplierProductOfferId ?? null,
        chosenSupplierVariantOfferId: it.chosenSupplierVariantOfferId ?? null,

        product: it.product ? { title: it.product.title ?? null } : null,
        variant: it.variant
          ? {
            id: it.variant.id,
            sku: it.variant.sku ?? null,
            imagesJson: it.variant.imagesJson ?? [],
          }
          : null,
      })),

      payments: order.payments || [],
    };

    return res.json({ ok: true, order: dto });
  } catch (e: any) {
    console.error('Admin get order failed:', e);
    return res.status(500).json({ error: e?.message || 'Failed to load order' });
  }
});

// GET /api/admin/orders/:id/suppliers
router.get("/:id/suppliers", requireSuperAdmin, async (req, res) => {
  const orderId = String(req.params.id);

  const pos = await prisma.purchaseOrder.findMany({
    where: { orderId },
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        include: {
          orderItem: {
            select: { id: true, title: true, quantity: true, chosenSupplierUnitPrice: true, unitPrice: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  res.json({
    data: pos.map((po: any) => ({
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      supplierName: po.supplier?.name ?? null,
      supplierAmount: Number(po.supplierAmount ?? 0),
      status: po.status,
      items: (po.items || []).map((x: any) => ({
        orderItemId: x.orderItem?.id,
        title: x.orderItem?.title,
        qty: x.orderItem?.quantity,
        supplierUnit: Number(x.orderItem?.chosenSupplierUnitPrice ?? 0),
        customerUnit: Number(x.orderItem?.unitPrice ?? 0),
      })),
    })),
  });
});



// POST /api/admin/orders/:orderId/cancel
router.post('/:orderId/cancel', requireAdmin, async (req, res) => {
  const { orderId } = req.params;

  // ✅ OTP REQUIRED HERE (not on GET)
  try {
    const otpToken = String(req.headers['x-otp-token'] ?? req.body?.otpToken ?? '');
    await assertVerifiedOrderOtp(orderId, "CANCEL_ORDER", otpToken);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "OTP verification required" });
  }

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
              chosenSupplierProductOfferId: true,
              chosenSupplierVariantOfferId: true,
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
        if (!qty || qty <= 0) continue;

        // Prefer variant offer if present
        if (it.chosenSupplierVariantOfferId) {
          const updatedOffer = await tx.supplierVariantOffer.update({
            where: { id: it.chosenSupplierVariantOfferId },
            data: { availableQty: { increment: qty } },
            select: { id: true, availableQty: true },
          });

          if (Number(updatedOffer.availableQty) > 0) {
            await tx.supplierVariantOffer.update({
              where: { id: updatedOffer.id },
              data: { inStock: true },
            });
          }
        } else if (it.chosenSupplierProductOfferId) {
          const updatedOffer = await tx.supplierProductOffer.update({
            where: { id: it.chosenSupplierProductOfferId },
            data: { availableQty: { increment: qty } },
            select: { id: true, availableQty: true },
          });

          if (Number(updatedOffer.availableQty) > 0) {
            await tx.supplierProductOffer.update({
              where: { id: updatedOffer.id },
              data: { inStock: true },
            });
            await recomputeProductStockTx(tx, it);
          }
        }

        // sync product cache (guard productId)
        if (it.productId) {
          await syncProductInStockCacheTx(tx, it.productId);
        }
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
      msg.includes('Order not found') ||
      msg.includes('OTP')
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
