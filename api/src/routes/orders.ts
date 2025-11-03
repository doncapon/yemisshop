// api/src/routes/orders.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { logOrderActivityTx } from '../services/activity.service.js';
import { syncProductInStockCacheTx } from '../services/inventory.service.js';

const router = Router();

const isAdmin = (role?: string) => role === 'ADMIN' || role === 'SUPER_ADMIN';

/* ------------------------ Helpers & Types ------------------------ */
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

type CartItem = {
  productId: string;
  variantId?: string | null;
  offerId?: string | null;
  qty: number;
  price: number; // retail unit price from client (aliases accepted)
  selectedOptions?: Array<{ attributeId: string; attribute: string; valueId?: string; value: string }>;
};

type CreateOrderBody = {
  items: CartItem[];
  shippingAddressId?: string;
  shippingAddress?: Address;
  billingAddressId?: string;
  billingAddress?: Address;
  notes?: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function getUserId(req: any): string | undefined {
  return req.user?.id || req.auth?.userId || undefined;
}

const ACT = {
  ORDER_CREATED: 'ORDER_CREATED',
  NOTE: 'NOTE',
  STATUS_CHANGE: 'STATUS_CHANGE',
} as const;

/** Compute current availableQty / inStock for pairs */
async function computeInStockForPairs(
  pairs: Array<{ productId: string; variantId: string | null }>
): Promise<Record<string, { availableQty: number; inStock: boolean }>> {
  const key = (p: string, v: string | null) => `${p}::${v ?? 'NULL'}`;
  const out: Record<string, { availableQty: number; inStock: boolean }> = {};
  if (pairs.length === 0) return out;

  const uniq = Array.from(new Map(pairs.map(p => [key(p.productId, p.variantId), p])).values());

  try {
    const grouped = await prisma.supplierOffer.groupBy({
      by: ['productId', 'variantId', 'isActive'],
      where: {
        OR: uniq.map(p => ({ productId: p.productId, variantId: p.variantId })),
        isActive: true,
      },
      _sum: { availableQty: true },
    });

    for (const g of grouped as any[]) {
      const k = key(g.productId, g.variantId ?? null);
      const sum = asNumber(g._sum?.availableQty, 0);
      const prev = out[k]?.availableQty ?? 0;
      const total = prev + Math.max(0, sum);
      out[k] = { availableQty: total, inStock: total > 0 };
    }
  } catch {
    const offers = await prisma.supplierOffer.findMany({
      where: {
        OR: uniq.map(p => ({ productId: p.productId, variantId: p.variantId, isActive: true })),
      },
      select: { productId: true, variantId: true, availableQty: true },
    });
    const acc = new Map<string, number>();
    for (const o of offers) {
      const k = key(o.productId, o.variantId ?? null);
      acc.set(k, (acc.get(k) || 0) + Math.max(0, asNumber(o.availableQty, 0)));
    }
    for (const [k, sum] of acc.entries()) {
      out[k] = { availableQty: sum, inStock: sum > 0 };
    }
  }

  for (const p of uniq) {
    const k = key(p.productId, p.variantId);
    if (!out[k]) out[k] = { availableQty: 0, inStock: false };
  }

  return out;
}

// helper: fetch active offers with price, then sort cheap → more stock
async function fetchActiveOffersTx(
  tx: any,
  where: any
): Promise<Array<{ id: string; supplierId: string | null; availableQty: number; price: number }>> {
  const list = await tx.supplierOffer.findMany({
    where: { ...where, isActive: true },
    select: { id: true, supplierId: true, availableQty: true, price: true, productId: true, variantId: true, isActive: true },
  });

  const usable = list
    .map((o: any) => ({
      id: o.id,
      supplierId: o.supplierId ?? null,
      availableQty: Math.max(0, Number(o.availableQty ?? 0)),
      price: Number(o.price ?? 0),
    }))
    .filter((o: any) => o.availableQty > 0 && Number.isFinite(o.price) && o.price > 0);

  usable.sort((a: { price: number; availableQty: number; }, b: { price: number; availableQty: number; }) => (a.price !== b.price ? a.price - b.price : b.availableQty - a.availableQty));
  return usable;
}

/* =========================================================
   POST /api/orders — create + allocate across offers
========================================================= */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const body = req.body as CreateOrderBody;
  const items = Array.isArray(body.items) ? body.items : [];

  if (items.length === 0) return res.status(400).json({ error: 'No items.' });
  if (!body.shippingAddressId && !body.shippingAddress) {
    return res.status(400).json({ error: 'shippingAddress or shippingAddressId is required.' });
  }

  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const created = await prisma.$transaction(async (tx: any) => {
      // 1) Create order shell
      const data: any = {
        subtotal: 0,
        tax: 0,
        total: 0,
        status: 'CREATED',
        user: { connect: { id: userId } },
      };

      if (body.shippingAddressId) {
        data.shippingAddress = { connect: { id: body.shippingAddressId } };
      } else {
        const a = body.shippingAddress!;
        data.shippingAddress = {
          create: {
            houseNumber: a.houseNumber,
            streetName: a.streetName,
            postCode: a.postCode ?? null,
            town: a.town ?? null,
            city: a.city,
            state: a.state,
            country: a.country,
          },
        };
      }

      if (body.billingAddressId) {
        data.billingAddress = { connect: { id: body.billingAddressId } };
      } else if (body.billingAddress) {
        const b = body.billingAddress;
        data.billingAddress = {
          create: {
            houseNumber: b.houseNumber,
            streetName: b.streetName,
            postCode: b.postCode ?? null,
            town: b.town ?? null,
            city: b.city,
            state: b.state,
            country: b.country,
          },
        };
      }

      const order = await tx.order.create({ data });

      await logOrderActivityTx(tx, order.id, ACT.ORDER_CREATED as any, 'Order created');
      if (body.notes && String(body.notes).trim()) {
        await logOrderActivityTx(tx, order.id, ACT.NOTE as any, String(body.notes).trim());
      }

      // 2) Allocate from supplier offers (cheapest-first + merged)
      let runningSubtotal = 0;

      for (const line of items) {
        const productId = String((line as any).productId || '');
        const variantId = (line as any).variantId != null ? String((line as any).variantId) : null;

        const qtyNeeded = Number((line as any).qty ?? (line as any).quantity ?? 0);
        let retailUnit = asNumber(
          (line as any).price ?? (line as any).unitPrice ?? (line as any).unit_amount,
          0
        );
        const explicitOfferId = (line as any).offerId ?? (line as any).supplierOfferId ?? null;
        const selectedOptionsRaw =
          (line as any).selectedOptions ?? (line as any).selectedOptionsJson ?? null;

        if (!productId || !Number.isFinite(qtyNeeded) || qtyNeeded <= 0) {
          throw new Error('Invalid line item.');
        }

        if (!(retailUnit > 0)) {
          try {
            const prod = await tx.product.findUnique({
              where: { id: productId },
              select: {
                title: true,
                price: true,
                variants: variantId ? { where: { id: variantId }, select: { price: true } } : false,
              },
            });
            retailUnit = asNumber(variantId ? (prod?.variants as any)?.[0]?.price : prod?.price, 0);
          } catch {}
        }
        if (!(retailUnit > 0)) throw new Error('Invalid line item.');

        // candidate offers
        let candidates: Array<{ id: string; supplierId: string | null; availableQty: number; price: number }> = [];
        if (explicitOfferId) {
          const one = await tx.supplierOffer.findFirst({
            where: { id: explicitOfferId, isActive: true },
            select: { id: true, availableQty: true, price: true, supplierId: true, isActive: true },
          });
          if (!one || !Number(one.availableQty) || Number(one.availableQty) <= 0) {
            throw new Error(`Offer unavailable for product ${productId}.`);
          }
          candidates = [{
            id: one.id,
            supplierId: one.supplierId ?? null,
            availableQty: Math.max(0, Number(one.availableQty || 0)),
            price: Number(one.price || 0),
          }];
        } else {
          const variantOffers = variantId ? await fetchActiveOffersTx(tx, { productId, variantId }) : [];
          const baseOffers = await fetchActiveOffersTx(tx, { productId, variantId: null });
          const seen = new Set<string>();
          const merged: typeof variantOffers = [];
          for (const o of [...variantOffers, ...baseOffers]) {
            if (seen.has(o.id)) continue;
            seen.add(o.id);
            merged.push(o);
          }
          merged.sort((a, b) => (a.price !== b.price ? a.price - b.price : b.availableQty - a.availableQty));
          candidates = merged;
        }

        const totalAvailable = candidates.reduce((s, o) => s + o.availableQty, 0);
        if (totalAvailable < qtyNeeded) {
          throw new Error(`Insufficient stock for product ${productId}. Need ${qtyNeeded}, available ${totalAvailable}.`);
        }

        // allocate cheapest-first
        let need = qtyNeeded;
        const allocations: Array<{ offerId: string; supplierId: string | null; qty: number; price: number }> = [];
        for (const o of candidates) {
          if (need <= 0) break;
          if (o.availableQty <= 0) continue;
          const take = Math.min(need, o.availableQty);

          const updated = await tx.supplierOffer.update({
            where: { id: o.id },
            data: { availableQty: { decrement: take } },
            select: { id: true, availableQty: true },
          });
          if (Number(updated.availableQty) < 0) throw new Error('Concurrent stock update detected.');
          if (Number(updated.availableQty) === 0) {
            await tx.supplierOffer.update({ where: { id: o.id }, data: { inStock: false } });
          }

          allocations.push({ offerId: o.id, supplierId: o.supplierId ?? null, qty: take, price: o.price });
          need -= take;
        }

        // create order items (retail fields + supplier metadata)
        const productRow = await tx.product.findUnique({ where: { id: productId }, select: { title: true } });
        const productTitle = productRow?.title || productId;

        for (const alloc of allocations) {
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId,
              variantId: variantId ?? null,

              // supplier metadata
              chosenSupplierOfferId: alloc.offerId,
              chosenSupplierId: alloc.supplierId,
              chosenSupplierUnitPrice: alloc.price,

              // shopper-facing (retail)
              title: productTitle,
              unitPrice: retailUnit,
              quantity: alloc.qty,
              lineTotal: retailUnit * alloc.qty,

              // options stored as JSON string
              selectedOptions:
                typeof selectedOptionsRaw === 'string'
                  ? selectedOptionsRaw
                  : JSON.stringify(selectedOptionsRaw ?? []),
            },
          });

          runningSubtotal += retailUnit * alloc.qty;
        }

        await syncProductInStockCacheTx(tx, productId);
      }

      // 3) totals
      const subtotal = round2(runningSubtotal);
      const tax = 0;
      const total = round2(subtotal + tax);

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: { subtotal, tax, total },
        select: { id: true, subtotal: true, tax: true, total: true, status: true, createdAt: true },
      });

      return updatedOrder;
    }, { isolationLevel: 'Serializable' });

    return res.status(201).json({ data: created });
  } catch (e: any) {
    console.error('create order failed:', e);
    return res.status(400).json({ error: e?.message || 'Could not create order' });
  }
});

/* ---------------- Shared enrichment for views ---------------- */
async function enrichItemsWithCurrentStock(items: Array<{ productId: string; variantId: string | null }>) {
  const pairs = items.map(i => ({ productId: i.productId, variantId: i.variantId ?? null }));
  const map = await computeInStockForPairs(pairs);
  const key = (p: string, v: string | null) => `${p}::${v ?? 'NULL'}`;
  return (productId: string, variantId: string | null) => map[key(productId, variantId)] || { availableQty: 0, inStock: false };
}

/* =========================================================
   GET /api/orders (admins only) — matches POST schema
========================================================= */
router.get('/', requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ error: 'Admins only' });

    const limitRaw = Number(req.query.limit);
    const take = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50;
    const q = String(req.query.q ?? '').trim();

    const asNum = (v: any, d = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };

    const whereWithUser = q
      ? { OR: [{ id: { contains: q } }, { user: { email: { contains: q, mode: 'insensitive' as const } } }] }
      : {};
    const whereSimple = q ? { id: { contains: q } } : {};

    let baseOrders: Array<{ id: string; status: string; subtotal?: any; tax?: any; total: any; createdAt: any }> = [];
    try {
      baseOrders = await prisma.order.findMany({
        where: whereWithUser as any,
        orderBy: { createdAt: 'desc' },
        take,
        select: { id: true, status: true, subtotal: true as any, tax: true as any, total: true, createdAt: true },
      });
    } catch {
      baseOrders = await prisma.order.findMany({
        where: whereSimple as any,
        orderBy: { createdAt: 'desc' },
        take,
        select: { id: true, status: true, subtotal: true as any, tax: true as any, total: true, createdAt: true },
      });
    }

    const orderIds = baseOrders.map(o => o.id);

    const userByOrder: Record<string, { email: string | null }> = {};
    try {
      const withUsers = await prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, user: { select: { email: true } } },
      });
      for (const o of withUsers) {
        userByOrder[o.id] = { email: (o as any).user?.email ?? null };
      }
    } catch {}

    const paidAmountByOrder: Record<string, number> = {};
    try {
      const paid = await prisma.payment.findMany({
        where: { orderId: { in: orderIds }, status: 'PAID' as any },
        select: { orderId: true, amount: true },
      });
      for (const p of paid) {
        const id = (p as any).orderId;
        paidAmountByOrder[id] = (paidAmountByOrder[id] || 0) + asNum(p.amount, 0);
      }
    } catch {
      try {
        const anyPayments = await prisma.payment.findMany({
          where: { orderId: { in: orderIds } },
          select: { orderId: true, amount: true },
        });
        for (const p of anyPayments) {
          const id = (p as any).orderId;
          paidAmountByOrder[id] = (paidAmountByOrder[id] || 0) + asNum(p.amount, 0);
        }
      } catch {}
    }

    // Items — select ONLY fields we actually write in POST
    const itemsByOrder: Record<string, Array<{
      id: string;
      productId: string;
      variantId: string | null;
      title: string;
      unitPrice: number;
      quantity: number;
      lineTotal: number;
      chosenSupplierOfferId: string | null;
      chosenSupplierId: string | null;
      chosenSupplierUnitPrice: number | null;
      selectedOptions: any;
      currentAvailableQty?: number;
      currentInStock?: boolean;
    }>> = {};

    let allItems: any[] = [];
    try {
      allItems = await prisma.orderItem.findMany({
        where: { orderId: { in: orderIds } },
        select: {
          id: true,
          orderId: true,
          productId: true,
          variantId: true,
          title: true,
          unitPrice: true,
          quantity: true,
          lineTotal: true,
          chosenSupplierOfferId: true,
          chosenSupplierId: true,
          chosenSupplierUnitPrice: true,
          selectedOptions: true, // stored as JSON string
        },
        orderBy: [{ orderId: 'asc' }, { id: 'asc' }],
      });

      const getter = await enrichItemsWithCurrentStock(
        allItems.map(it => ({ productId: it.productId, variantId: it.variantId ?? null }))
      );

      for (const it of allItems) {
        const oid = it.orderId as string;
        const unitPrice = asNum(it.unitPrice, 0);
        const quantity = asNum(it.quantity, 1);
        const lineTotal = asNum(it.lineTotal ?? it.lineTotal, unitPrice * quantity);

        let selectedOptions: any = null;
        try {
          if (typeof it.selectedOptions === 'string') {
            selectedOptions = JSON.parse(it.selectedOptions);
          } else if (it.selectedOptions) {
            selectedOptions = it.selectedOptions;
          }
        } catch { selectedOptions = null; }

        const { availableQty, inStock } = getter(it.productId, it.variantId ?? null);

        (itemsByOrder[oid] ||= []).push({
          id: it.id,
          productId: it.productId,
          variantId: it.variantId ?? null,
          title: it.title ?? '—',
          unitPrice,
          quantity,
          lineTotal,
          chosenSupplierOfferId: it.chosenSupplierOfferId ?? null,
          chosenSupplierId: it.chosenSupplierId ?? null,
          chosenSupplierUnitPrice: it.chosenSupplierUnitPrice != null ? asNumber(it.chosenSupplierUnitPrice, null as any) : null,
          selectedOptions,
          currentAvailableQty: availableQty,
          currentInStock: inStock,
        });
      }
    } catch {}

    const metricsByOrder: Record<string, { revenue: number; cogs: number; profit: number }> = {};
    try {
      const grouped = await prisma.orderItemProfit.groupBy({
        by: ['orderId'],
        where: { orderId: { in: orderIds } },
        _sum: { revenue: true, cogs: true, profit: true },
      });
      for (const g of grouped as any[]) {
        metricsByOrder[g.orderId] = {
          revenue: asNum(g._sum?.revenue, 0),
          cogs: asNum(g._sum?.cogs, 0),
          profit: asNum(g._sum?.profit, 0),
        };
      }
    } catch {}

    const data = baseOrders.map(o => {
      const email = userByOrder[o.id]?.email ?? null;
      const paidAmount = paidAmountByOrder[o.id] || 0;
      const metrics = metricsByOrder[o.id] || { revenue: 0, cogs: 0, profit: 0 };

      return {
        id: o.id,
        userEmail: email,
        status: o.status,
        subtotal: asNum((o as any).subtotal, 0),
        tax: asNum((o as any).tax, 0),
        total: asNum(o.total, 0),
        paidAmount,
        metrics,
        createdAt: (o as any).createdAt?.toISOString?.() ?? (o as any).createdAt,
        items: itemsByOrder[o.id] || [],
      };
    });

    res.json({ data });
  } catch (e: any) {
    console.error('GET /api/orders failed hard:', e?.message, e?.stack);
    res.status(500).json({ error: e?.message || 'Failed to fetch orders' });
  }
});

/* =========================================================
   GET /api/orders/mine — matches POST schema
========================================================= */
router.get('/mine', requireAuth, async (req, res) => {
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
        subtotal: true,
        tax: true,
        total: true,
        createdAt: true,
        items: {
          select: {
            id: true,
            productId: true,
            variantId: true,
            title: true,
            unitPrice: true,
            quantity: true,
            lineTotal: true,
            chosenSupplierOfferId: true,
            chosenSupplierId: true,
            chosenSupplierUnitPrice: true,
            selectedOptions: true,
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, amount: true, reference: true, feeAmount: true, createdAt: true },
        },
      },
    });

    const asNum = (x: any, d = 0) => {
      const n = Number(x);
      return Number.isFinite(n) ? n : d;
    };

    const allPairs = orders.flatMap((o: any) =>
      (Array.isArray(o.items) ? o.items : []).map((it: any) => ({ productId: it?.productId ?? null, variantId: it?.variantId ?? null }))
    );
    const getter = await enrichItemsWithCurrentStock(allPairs as any);

    const data = orders.map((o: any) => ({
      id: o.id,
      status: o.status,
      subtotal: asNum(o.subtotal, 0),
      tax: asNum(o.tax, 0),
      total: asNum(o.total, 0),
      createdAt: (o as any).createdAt?.toISOString?.() ?? (o as any).createdAt,
      items: (Array.isArray(o.items) ? o.items : []).map((it: any) => {
        const qty = asNum(it?.quantity, 1);
        const unitPrice = asNum(it?.unitPrice, 0);
        const rawLine = it?.lineTotal?? unitPrice * qty;
        const lineTotal = asNum(rawLine, unitPrice * qty);

        let selectedOptions: any = null;
        try {
          if (typeof it?.selectedOptions === 'string') {
            selectedOptions = JSON.parse(it.selectedOptions);
          } else if (it?.selectedOptions) {
            selectedOptions = it.selectedOptions;
          }
        } catch { selectedOptions = null; }

        const { availableQty, inStock } = getter(it?.productId, it?.variantId ?? null);

        return {
          id: it?.id,
          productId: it?.productId,
          variantId: it?.variantId ?? null,
          title: it?.title ?? '—',
          unitPrice,
          quantity: qty,
          lineTotal,
          chosenSupplierOfferId: it?.chosenSupplierOfferId ?? null,
          chosenSupplierId: it?.chosenSupplierId ?? null,
          chosenSupplierUnitPrice: it?.chosenSupplierUnitPrice != null ? asNum(it.chosenSupplierUnitPrice, 0) : null,
          currentAvailableQty: availableQty,
          currentInStock: inStock,
          selectedOptions,
        };
      }),
      payment: (Array.isArray(o.payments) ? o.payments : [])[0] ?? null,
    }));

    res.json({ data });
  } catch (e: any) {
    console.error('list my orders failed:', e);
    res.status(500).json({ error: e?.message || 'Failed to fetch your orders' });
  }
});

/* =========================================================
   GET /api/orders/:id — matches POST schema
========================================================= */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true } },
        items: {
          select: {
            id: true,
            productId: true,
            variantId: true,
            title: true,
            unitPrice: true,
            quantity: true,
            lineTotal: true,
            chosenSupplierOfferId: true,
            chosenSupplierId: true,
            chosenSupplierUnitPrice: true,
            selectedOptions: true,
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, provider: true, channel: true, reference: true, amount: true, feeAmount: true, createdAt: true },
        },
      },
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!isAdmin(req.user?.role) && String(order.user?.id) !== String(req.user?.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const getter = await enrichItemsWithCurrentStock(order.items.map((it: any) => ({ productId: it.productId, variantId: it.variantId })) as any);

    const asNum = (v: any, d = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };

    const data = {
      id: order.id,
      userEmail: order.user?.email ?? null,
      status: order.status,
      subtotal: Number(order.subtotal ?? 0),
      tax: Number(order.tax ?? 0),
      total: Number(order.total ?? 0),
      createdAt: (order as any).createdAt?.toISOString?.() ?? (order as any).createdAt,
      items: order.items.map((it: any) => {
        const { availableQty, inStock } = getter(it.productId, it.variantId ?? null);

        let selectedOptions: any = null;
        try {
          if (typeof it?.selectedOptions === 'string') {
            selectedOptions = JSON.parse(it.selectedOptions);
          } else if (it?.selectedOptions) {
            selectedOptions = it.selectedOptions;
          }
        } catch { selectedOptions = null; }

        return {
          id: it.id,
          productId: it.productId,
          variantId: it.variantId ?? null,
          title: it.title ?? '—',
          unitPrice: asNum(it.unitPrice, 0),
          quantity: asNum(it.quantity, 1),
          lineTotal: asNum(it.lineTotal ?? it.totalPrice, asNum(it.unitPrice, 0) * asNum(it.quantity, 1)),
          chosenSupplierOfferId: it.chosenSupplierOfferId ?? null,
          chosenSupplierId: it.chosenSupplierId ?? null,
          chosenSupplierUnitPrice: it.chosenSupplierUnitPrice != null ? asNum(it.chosenSupplierUnitPrice, 0) : null,
          currentAvailableQty: availableQty,
          currentInStock: inStock,
          selectedOptions,
        };
      }),
      payments: order.payments,
    };

    res.json({ data });
  } catch (e: any) {
    console.error('get order failed:', e);
    res.status(500).json({ error: e?.message || 'Failed to fetch order' });
  }
});

/* =========================================================
   GET /api/orders/summary (end user)
========================================================= */
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req)!;

    const [countAll, paidAgg, latest] = await prisma.$transaction([
      prisma.order.count({ where: { userId } }),
      prisma.order.aggregate({
        where: { userId, status: { in: ['PAID', 'COMPLETED'] } },
        _sum: { total: true },
      }),
      prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        take: 5,
        select: { id: true, status: true, total: true, createdAt: true },
      }),
    ]);

    res.json({
      ordersCount: countAll,
      totalSpent: Number(paidAgg._sum.total ?? 0),
      recent: latest.map((o: any) => ({
        id: o.id,
        status: o.status,
        total: Number(o.total ?? 0),
        createdAt: (o as any).createdAt?.toISOString?.() ?? (o as any).createdAt,
      })),
    });
  } catch (err: any) {
    console.error('orders summary failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to fetch summary' });
  }
});

/* =========================================================
   GET /api/orders/:orderId/profit (super admin)
========================================================= */
router.get('/:orderId/profit', requireSuperAdmin, async (req, res) => {
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

    const summary = itemMetrics.reduce(
      (s: any, x: any) => {
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
        paidAmount: payments.reduce((a: number, p: any) => a + Number(p.amount || 0), 0),
        gatewayFeeActual: payments.reduce((a: number, p: any) => a + Number(p.feeAmount || 0), 0),
      },
      summary,
      items: itemMetrics,
    });
  } catch (e: any) {
    console.error('profit endpoint failed:', e);
    res.status(500).json({ error: e?.message || 'Failed to fetch profit' });
  }
});

export default router;
