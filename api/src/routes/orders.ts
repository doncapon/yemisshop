// api/src/routes/orders.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireAuth } from '../middleware/auth.js';
import { Prisma } from '@prisma/client';
import { logOrderActivity } from '../services/activity.service.js';

const router = Router();

const isAdmin = (role?: string) => role === 'ADMIN' || role === 'SUPER_ADMIN';

/* ------------------------ Helpers ------------------------ */
function asNumber(v: any, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

type Address = {
  houseNumber: string;
  streetName: string;
  postCode?: string | null;
  town?: string | null;
  city: string;
  state: string;
  country: string;
};

type IncomingItem = {
  productId: string;
  variantId?: string | null;
  qty: number;
  title?: string;
  unitPrice?: number; // sent by client
  selectedOptions?: any[]; // JSON
};

/** Minimal auth helper – replace with your real extraction if needed */
function getUserId(req: any): string {
  return req.user?.id || req.auth?.userId;
}

/* =========================================================
   POST /api/orders
   Body: {
     items: [{ productId, variantId?, qty, unitPrice, title?, selectedOptions? }],
     shipping?: number,
     tax?: number,
     homeAddress?: Address,
     shippingAddress?: Address
   }
========================================================= */
// ...

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const body = req.body as {
      items: IncomingItem[];
      shipping?: number;
      tax?: number;
      homeAddress?: Address;
      shippingAddress?: Address;
    };

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({ error: 'No items in order' });
    }

    // normalize items
    const items = body.items.map((it, idx) => {
      const qty = Math.max(1, Number(it.qty) || 1);
      const unit = Number(it.unitPrice ?? 0);
      if (!Number.isFinite(unit) || unit <= 0) {
        throw new Error(`Invalid unitPrice for item at index ${idx}`);
      }
      return {
        productId: String(it.productId),
        variantId: it.variantId ?? null,
        qty,
        title: it.title ?? '',
        unitPrice: unit,
        selectedOptions: Array.isArray(it.selectedOptions) ? it.selectedOptions : [],
      };
    });

    const shippingNum = Number.isFinite(Number(body.shipping)) ? Number(body.shipping) : 0;
    const taxNum = Number.isFinite(Number(body.tax)) ? Number(body.tax) : 0;

    const subtotalNum = items.reduce((s, it) => s + it.unitPrice * it.qty, 0);
    const totalNum = subtotalNum + shippingNum + taxNum;

    const shippingAddrInput: Address | undefined = body.shippingAddress ?? body.homeAddress ?? undefined;
    if (!shippingAddrInput) {
      return res.status(400).json({ error: 'shippingAddress is required' });
    }

    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1) concrete shipping address
      const shipAddr = await tx.address.create({
        data: {
          houseNumber: String(shippingAddrInput.houseNumber || ''),
          streetName: String(shippingAddrInput.streetName || ''),
          postCode: shippingAddrInput.postCode || null,
          town: shippingAddrInput.town || null,
          city: String(shippingAddrInput.city || ''),
          state: String(shippingAddrInput.state || ''),
          country: String(shippingAddrInput.country || ''),
        },
        select: { id: true },
      });

      // 2) order + nested items
      const order = await tx.order.create({
        data: {
          user: { connect: { id: userId } },
          shippingAddress: { connect: { id: shipAddr.id } },
          status: 'PENDING',
          subtotal: new Prisma.Decimal(subtotalNum),
          shipping: new Prisma.Decimal(shippingNum),
          tax: new Prisma.Decimal(taxNum),
          total: new Prisma.Decimal(totalNum),
          items: {
            create: items.map((it) => ({
              productId: it.productId,
              variantId: it.variantId,
              quantity: it.qty, // your model uses `quantity`
              title: it.title,
              unitPrice: new Prisma.Decimal(it.unitPrice),
              selectedOptions: it.selectedOptions as any, // JSON column on OrderItem
            })),
          },
        },
        select: { id: true },
      });

      // 3) activity (use items.length; order.items is not selected here)
      await tx.orderActivity.create({
        data: {
          orderId: order.id,
          type: 'ORDER_CREATED',
          message: 'Order placed',
          meta: {
            items: items.length,
            subtotal: subtotalNum,
            shipping: shippingNum,
            tax: taxNum,
            total: totalNum,
          },
        },
      });

      return order;
    });

    return res.json({ id: created.id });
  } catch (e) {
    next(e);
  }
});


/* =========================================================
   GET /api/orders
   Admin only
========================================================= */
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    if (!isAdmin(req.user?.role)) {
      return res.status(403).json({ error: 'Admins only' });
    }

    const limitRaw = Number(req.query.limit);
    const take = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50;
    const q = String(req.query.q ?? '').trim().toLowerCase();

    const where: any = q
      ? {
        OR: [{ id: { contains: q } }, { user: { email: { contains: q } } }],
      }
      : {};

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        user: { select: { id: true, email: true } },
        items: {
          include: {
            product: { select: { id: true, title: true, price: true } },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            provider: true,
            channel: true,
            reference: true,
            amount: true,
            createdAt: true,
          },
        },
      },
    });

    const data = orders.map((o: any) => ({
      id: o.id,
      userEmail: o.user?.email ?? null,
      status: o.status,
      total: Number(o.total ?? 0),
      createdAt: o.createdAt?.toISOString?.() ?? o.createdAt,
      items: o.items.map((it: any) => ({
        id: it.id,
        productId: it.productId,
        variantId: it.variantId ?? null,
        title: it.title ?? it.product?.title ?? '—',
        unitPrice: asNumber(it.unitPrice ?? it.product?.price ?? it.price, 0),
        quantity: asNumber(it.quantity ?? it.qty, 1),
        lineTotal: asNumber(
          it.lineTotal ??
          asNumber(it.unitPrice ?? it.product?.price ?? it.price, 0) *
          asNumber(it.quantity ?? it.qty, 1),
          0
        ),
        status: it.status ?? '—',
        selectedOptions:
          it.selectedOptions ?? it.selectedOptionsJson ?? it?.metaJson?.selectedOptions ?? null,
      })),
      payment: o.payments[0] || null,
    }));

    res.json({ data });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   GET /api/orders/mine
========================================================= */
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const limitRaw = Number(req.query.limit);
    const take = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50;

    const orders = await prisma.order.findMany({
      where: { userId: req.user!.id },

      orderBy: { createdAt: 'desc' },
      take,
      include: {
        items: {
          select: {
            product: { select: { id: true, title: true, price: true } },
            title: true,
            unitPrice: true,
            quantity: true,
            lineTotal: true,
            status: true,
            selectedOptions: true,
            variant: { select: { id: true, sku: true, imagesJson: true } },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            provider: true,
            channel: true,
            reference: true,
            amount: true,
            createdAt: true,
          },
        },
      },
    });

    const data = orders.map((o: any) => ({
      id: o.id,
      status: o.status,
      total: Number(o.total ?? 0),
      createdAt: o.createdAt?.toISOString?.() ?? o.createdAt,
      items: o.items.map((it: any) => ({
        id: it.id,
        productId: it.productId,
        variantId: it.variantId ?? null,
        title: it.title ?? it.product?.title ?? '—',
        unitPrice: asNumber(it.unitPrice ?? it.product?.price ?? it.price, 0),
        quantity: asNumber(it.quantity ?? it.qty, 1),
        lineTotal: asNumber(
          it.lineTotal ??
          asNumber(it.unitPrice ?? it.product?.price ?? it.price, 0) *
          asNumber(it.quantity ?? it.qty, 1),
          0
        ),
        status: it.status ?? '—',
        selectedOptions:
          it.selectedOptions ?? it.selectedOptionsJson ?? it?.metaJson?.selectedOptions ?? null,
      })),
      payment: o.payments[0] || null,
    }));

    res.json({ data });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   GET /api/orders/:id
   Admin: any; User: only own
========================================================= */
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const id = req.params.id;
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true } },
        items: {
          include: {
            product: { select: { id: true, title: true, price: true } },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            provider: true,
            channel: true,
            reference: true,
            amount: true,
            createdAt: true,
          },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (!isAdmin(req.user?.role) && String(order.userId) !== String(req.user?.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const data = {
      id: order.id,
      userEmail: (order as any).user?.email ?? null,
      status: order.status,
      total: Number(order.total ?? 0),
      createdAt: (order as any).createdAt?.toISOString?.() ?? (order as any).createdAt,
      items: (order as any).items.map((it: any) => ({
        id: it.id,
        productId: it.productId,
        variantId: it.variantId ?? null,
        title: it.title ?? it.product?.title ?? '—',
        unitPrice: asNumber(it.unitPrice ?? it.product?.price ?? it.price, 0),
        quantity: asNumber(it.quantity ?? it.qty, 1),
        lineTotal: asNumber(
          it.lineTotal ??
          asNumber(it.unitPrice ?? it.product?.price ?? it.price, 0) *
          asNumber(it.quantity ?? it.qty, 1),
          0
        ),
        status: it.status ?? '—',
        selectedOptions:
          it.selectedOptions ?? it.selectedOptionsJson ?? it?.metaJson?.selectedOptions ?? null,
      })),
      payments: order.payments,
    };

    res.json(data);
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   GET /api/orders/summary  --> router path should be '/summary'
========================================================= */
router.get('/summary', authMiddleware, async (req, res, next) => {
  try {
    const userId = getUserId(req);

    const [countAll, paidAgg, latest] = await prisma.$transaction([
      prisma.order.count({ where: { userId } }),
      prisma.order.aggregate({
        where: { userId, status: { in: ['PAID', 'COMPLETED'] } },
        _sum: { total: true },
      }),
      prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, status: true, total: true, createdAt: true },
      }),
    ]);

    res.json({
      ordersCount: countAll,
      totalSpent: paidAgg._sum.total ?? '0',
      recent: latest,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
