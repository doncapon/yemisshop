// api/src/routes/orders.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { Prisma } from '@prisma/client';
import { logOrderActivity } from '../services/activity.service.js';
import { readNumberSetting } from '../lib/settings.js';

// 🔽 Derive + cache inStock from SupplierOffer.availableQty sums
// (See prior message where we defined these helpers.)
import { syncProductInStockCacheTx } from '../services/inventory.service.js';

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
  unitPrice?: number; // client-side shown price (retail)
  selectedOptions?: any[]; // JSON
  supplierId?: string | null; // OPTIONAL: if you already pre-picked
};

/** Minimal auth helper – replace with your real extraction if needed */
function getUserId(req: any): string {
  return req.user?.id || req.auth?.userId;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Safe equality for variant matching (null === null counts as equal) */
function eqVar(a?: string | null, b?: string | null) {
  return (a ?? null) === (b ?? null);
}

/* =========================================================
   POST /api/orders
   Body: {
     items: [{ productId, variantId?, qty, unitPrice, title?, selectedOptions? }],
     homeAddress?: Address,
     shippingAddress?: Address
   }
========================================================= */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const body = req.body as {
      items: IncomingItem[];
      homeAddress?: Address;
      shippingAddress?: Address;
    };

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({ error: 'No items in order' });
    }

    // Normalize + validate items
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
        unitPrice: unit, // retail unit
        selectedOptions: Array.isArray(it.selectedOptions) ? it.selectedOptions : [],
      };
    });

    // Require shipping address (you can relax if you use home)
    const shippingAddrInput: Address | undefined =
      body.shippingAddress ?? body.homeAddress ?? undefined;
    if (!shippingAddrInput) {
      return res.status(400).json({ error: 'shippingAddress is required' });
    }

    // Global settings
    const unitServiceFee = await readNumberSetting('commsServiceFeeNGN', 0);
    const taxRatePct = await readNumberSetting('taxRatePct', 0);

    // Compute customer-facing amounts (independent of allocation)
    const shippingNum = 0; // included by suppliers
    const subtotalRaw = items.reduce((s, it) => s + it.unitPrice * it.qty, 0);
    const subtotalNum = round2(subtotalRaw);
    const taxNum = round2(subtotalNum * (taxRatePct / 100));

    // ---- Place everything atomically ----
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 0) Load all usable SupplierOffers for all products in this order
      const productIds = [...new Set(items.map(i => i.productId))];

      const offers = await tx.supplierOffer.findMany({
        where: {
          productId: { in: productIds },
          isActive: true,
          availableQty: { gt: 0 },
        },
        select: {
          id: true,
          productId: true,
          variantId: true,
          supplierId: true,
          price: true,         // supplier's unit cost (Decimal)
          availableQty: true,
          createdAt: true,
        },
        orderBy: [
          { price: 'asc' },    // prefer cheaper supplier first
          { createdAt: 'asc' } // stable tie-break
        ],
      });

      // Index offers by (productId, variantId?) for quick allocation
      const keyOf = (pid: string, vid: string | null) => `${pid}::${vid ?? 'null'}`;
      const offersMap = new Map<string, typeof offers>();

      for (const pid of productIds) {
        const related = offers.filter(o => o.productId === pid);
        // Build 2 buckets: exact variantId and null variant
        // We'll reuse during allocation
        const byVariant = new Map<string, typeof offers>();
        related.forEach(o => {
          const k = keyOf(o.productId, o.variantId ?? null);
          const curr = byVariant.get(k) || [];
          curr.push(o);
          byVariant.set(k, curr);
        });
        // Flatten into offersMap
        for (const [k, arr] of byVariant) offersMap.set(k, arr);
      }

      // 1) Allocation plan per cart line (may split into several allocations)
      type Allocation = {
        itemIdx: number;
        productId: string;
        variantId: string | null;
        qty: number;                   // chunk allocated from a single offer
        orderUnitPrice: number;        // retail unit (what customer pays)
        title: string;
        selectedOptions: any[];

        offerId: string;
        supplierId: string;
        supplierUnitPrice: number;     // supplier’s unit (COGS)
      };

      const allocations: Allocation[] = [];
      const decrementsByOffer = new Map<string, number>(); // offerId -> total allocated

      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        let remaining = it.qty;

        // Prefer exact variant offers; if none, allow product-level (variantId null) offers
        const exactKey = keyOf(it.productId, it.variantId ?? null);
        const nullKey  = keyOf(it.productId, null);

        const exact = (offersMap.get(exactKey) || []).slice(); // copy
        const generic = (offersMap.get(nullKey) || []).slice();

        // Merge lists but keep sort order (price asc already)
        const pool = [...exact, ...generic];

        for (const off of pool) {
          if (remaining <= 0) break;
          if (off.availableQty <= 0) continue;

          const take = Math.min(remaining, off.availableQty);
          if (take <= 0) continue;

          allocations.push({
            itemIdx: idx,
            productId: it.productId,
            variantId: it.variantId ?? null,
            qty: take,
            orderUnitPrice: it.unitPrice,
            title: it.title,
            selectedOptions: it.selectedOptions,

            offerId: off.id,
            supplierId: off.supplierId,
            supplierUnitPrice: Number(off.price || 0),
          });

          remaining -= take;

          // Reduce in the working pool as well
          off.availableQty -= take;

          // Track decrement per offer
          decrementsByOffer.set(off.id, (decrementsByOffer.get(off.id) || 0) + take);
        }

        if (remaining > 0) {
          // Not enough stock across all suppliers for this item
          throw Object.assign(new Error('Insufficient stock for one or more items'), { status: 409 });
        }
      }

      // Distinct suppliers actually used for this order (for service fee)
      const suppliersUsed = new Set<string>(allocations.map(a => a.supplierId));
      const serviceFeeNum = round2(unitServiceFee * suppliersUsed.size);

      // Final total
      const totalNum = round2(subtotalNum + taxNum + serviceFeeNum + shippingNum);

      // 2) Persist concrete shipping address
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

      // 3) Create order (without items first to get order.id)
      const order = await tx.order.create({
        data: {
          user: { connect: { id: userId } },
          shippingAddress: { connect: { id: shipAddr.id } },
          status: 'PENDING',

          subtotal: new Prisma.Decimal(subtotalNum),
          tax: new Prisma.Decimal(taxNum),
          serviceFee: new Prisma.Decimal(serviceFeeNum),
          total: new Prisma.Decimal(totalNum),
        },
        select: { id: true },
      });

      // 4) Create one OrderItem per allocation chunk (captures chosen supplier)
      //    Note: lineTotal is optional in schema; if you compute it elsewhere, you can omit.
      for (const a of allocations) {
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: a.productId,
            variantId: a.variantId,
            quantity: a.qty,
            title: a.title,
            unitPrice: new Prisma.Decimal(a.orderUnitPrice),         // retail unit (what buyer pays)
            selectedOptions: a.selectedOptions as any,

            chosenSupplierId: a.supplierId,
            chosenSupplierOfferId: a.offerId,
            chosenSupplierUnitPrice: new Prisma.Decimal(a.supplierUnitPrice), // COGS
          },
        });
      }

      // 5) Atomically decrement SupplierOffer.availableQty for all offers used
      //    Use conditional updateMany to prevent going negative.
      for (const [offerId, dec] of decrementsByOffer.entries()) {
        const updated = await tx.supplierOffer.updateMany({
          where: { id: offerId, availableQty: { gte: dec } },
          data: { availableQty: { decrement: dec } },
        });
        if (updated.count !== 1) {
          // Rollback by throwing: a race condition likely consumed the stock
          throw Object.assign(new Error('Inventory changed, please retry checkout'), { status: 409 });
        }
      }

      // 6) Sync product inStock cache for all affected products
      const affectedProductIds = [...new Set(allocations.map(a => a.productId))];
      for (const pid of affectedProductIds) {
        await syncProductInStockCacheTx(tx, pid);
      }

      // 7) Activity log (including allocation summary)
      await tx.orderActivity.create({
        data: {
          orderId: order.id,
          type: 'ORDER_CREATED',
          message: 'Order placed',
          meta: {
            itemsRequested: items.map((it) => ({ productId: it.productId, variantId: it.variantId, qty: it.qty })),
            allocations: allocations.map(a => ({
              productId: a.productId,
              variantId: a.variantId,
              offerId: a.offerId,
              supplierId: a.supplierId,
              qty: a.qty,
              supplierUnitPrice: a.supplierUnitPrice,
            })),
            pricing: {
              subtotal: subtotalNum,
              tax: taxNum,
              serviceFee: serviceFeeNum,
              total: totalNum,
            },
            suppliersUsed: suppliersUsed.size,
          },
        },
      });

      return order;
    });

    return res.json({ id: created.id });
  } catch (e: any) {
    if (e?.status) {
      return res.status(e.status).json({ error: e.message || 'Error' });
    }
    next(e);
  }
});

/* =========================================================
   GET /api/orders  (Admin only)
========================================================= */
router.get('/', requireAuth, async (req, res, next) => {
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
      select: {
        id: true,
        status: true,
        total: true,
        createdAt: true,
        user: { select: { email: true } },
        items: {
          select: {
            id: true,
            title: true,
            quantity: true,
            unitPrice: true,
            chosenSupplierUnitPrice: true,
            productId: true,
            variantId: true,
            product: {
              select: {
                title: true,
                communicationCost: true,
                supplierOffers: {
                  orderBy: { price: 'asc' },
                  take: 1,
                  select: { price: true },
                },
              },
            },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            amount: true,
            reference: true,
            feeAmount: true,
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
      select: {
        id: true,
        status: true,
        total: true,
        createdAt: true,
        user: { select: { email: true } },
        items: {
          select: {
            id: true,
            title: true,
            quantity: true,
            unitPrice: true,
            chosenSupplierUnitPrice: true,
            productId: true,
            variantId: true,
            product: {
              select: {
                title: true,
                communicationCost: true,
                supplierOffers: {
                  orderBy: { price: 'asc' },
                  take: 1,
                  select: { price: true },
                },
              },
            },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            amount: true,
            reference: true,
            feeAmount: true,
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
router.get('/:id', requireAuth, async (req, res, next) => {
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
   GET /api/orders/summary
========================================================= */
router.get('/summary', requireAuth, async (req, res, next) => {
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

/**
 * GET /api/admin/orders/:orderId/profit
 * Returns order-level and per-item metrics.
 */
router.get('/:orderId/profit', requireSuperAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, total: true, serviceFee: true, status: true, createdAt: true },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const payments = await prisma.payment.findMany({
      where: { orderId, status: 'PAID' },
      select: { id: true, amount: true, feeAmount: true },
    });

    const itemMetrics = await prisma.orderItemProfit.findMany({
      where: { orderId },
      orderBy: { computedAt: 'desc' },
      select: {
        orderItemId: true,
        qty: true,
        unitPrice: true,
        chosenSupplierUnitPrice: true,
        revenue: true,
        cogs: true,
        allocatedGatewayFee: true,
        allocatedCommsFee: true,
        allocatedBaseServiceFee: true,
        profit: true,
        computedAt: true,
      },
    });

    const sum = itemMetrics.reduce(
      (s: { revenue: number; cogs: number; gateway: number; comms: number; base: number; profit: number; }, x: { revenue: any; cogs: any; allocatedGatewayFee: any; allocatedCommsFee: any; allocatedBaseServiceFee: any; profit: any; }) => {
        s.revenue += Number(x.revenue || 0);
        s.cogs += Number(x.cogs || 0);
        s.gateway += Number(x.allocatedGatewayFee || 0);
        s.comms += Number(x.allocatedCommsFee || 0);
        s.base += Number(x.allocatedBaseServiceFee || 0);
        s.profit += Number(x.profit || 0);
        return s;
      },
      { revenue: 0, cogs: 0, gateway: 0, comms: 0, base: 0, profit: 0 }
    );

    res.json({
      order: {
        id: order.id,
        status: order.status,
        total: Number(order.total || 0),
        serviceFeeRecorded: Number(order.serviceFee || 0),
        paidAmount: payments.reduce((a: number, p: { amount: any; }) => a + Number(p.amount || 0), 0),
        gatewayFeeActual: payments.reduce((a: number, p: { feeAmount: any; }) => a + Number(p.feeAmount || 0), 0),
      },
      summary: sum,
      items: itemMetrics,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
