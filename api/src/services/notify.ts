// api/src/services/notify.ts
import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';

/* ----------------------------- Helpers ----------------------------- */

const personName = (u?: { firstName?: string | null; lastName?: string | null }) =>
  [u?.firstName, u?.lastName].filter(Boolean).join(' ') || 'Customer';

const normalizePhone = (p?: string | null) => (p || '').trim();

const formatAddress = (a?: any) => {
  if (!a) return '—';
  const parts = [
    a.houseNumber,
    a.streetName,
    a.town,
    a.city,
    a.state,
    a.country,
  ].filter(Boolean);
  return parts.join(', ');
};

async function sendWhatsApp(to: string, msg: string) {
  // Plug your provider here. Current dev logger:
  console.log(`[whatsapp][DEV] => ${to}\n${msg}\n---`);
}

async function getCommsUnitCostNGN(): Promise<number> {
  const keys = ['commsUnitCostNGN', 'commsServiceFeeNGN', 'commsUnitCost'];
  for (const key of keys) {
    const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
    const n = Number(row?.value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

// e.g. "DS-AB12CD34"
function generateSupplierOrderRef() {
  const base = () => Math.random().toString(36).slice(2, 10).toUpperCase();
  return `DS-${base()}`;
}

/**
 * Ensure we have a stable supplierOrderRef per (orderId, supplierId).
 * Reuse from earliest PO, or from an activity, otherwise generate + log once.
 */
async function ensureSupplierOrderRef(tx: any, orderId: string, supplierId: string): Promise<string> {
  // 1) Reuse the oldest PO reference if it exists
  const existingPO = await tx.purchaseOrder.findFirst({
    where: { orderId, supplierId },
    orderBy: { createdAt: 'asc' },
    select: { supplierOrderRef: true },
  });
  if (existingPO?.supplierOrderRef) return existingPO.supplierOrderRef;

  // 2) Or reuse from activities
  const act = await tx.orderActivity.findFirst({
    where: { orderId, supplierId, type: 'SUPPLIER_REF_CREATED' },
    orderBy: { createdAt: 'asc' },
    select: { meta: true },
  });
  const fromAct =
    (act?.meta as any)?.supplierOrderRef ||
    (act?.meta as any)?.supplierRef; // legacy key
  if (fromAct && typeof fromAct === 'string' && fromAct.trim()) {
    return fromAct.trim();
  }

  // 3) Generate and store once
  const ref = generateSupplierOrderRef();
  try {
    await tx.orderActivity.create({
      data: {
        orderId,
        supplierId,
        type: 'SUPPLIER_REF_CREATED',
        message: `Supplier reference created for supplier ${supplierId}`,
        meta: { supplierOrderRef: ref },
      },
    });
  } catch {
    // ignore logging errors; still return ref
  }
  return ref;
}

/* ----------------------------- Main notify ----------------------------- */

export async function notifySuppliersForOrder(orderId: string) {
  // Pull order with all data we need to build per-supplier lines
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, phone: true } },
      items: {
        include: {
          product: { select: { id: true, title: true } },
          variant: { select: { id: true, sku: true } },
        },
      },
      shippingAddress: true,
    },
  });
  if (!order) throw new Error('Order not found');
  if (!order.items.length) return { ok: true, suppliers: [] };

  // Build lines with chosen supplier data (set during /orders POST)
  type Chosen = {
    orderItemId: string;
    title: string;
    variantSku?: string | null;
    qty: number;
    supplierId: string;
    supplierName?: string | null;
    supplierPhone?: string | null;
    supplierOfferId?: string | null;
    supplierUnit: number;   // chosenSupplierUnitPrice
  };

  const chosen: Chosen[] = [];
  for (const it of order.items) {
    const supplierId = (it as any).chosenSupplierId as string | null;
    if (!supplierId) continue;

    // Use the saved supplier unit (COGS); fall back (rare) to cheapest active offer
    let supplierUnit = Number((it as any).chosenSupplierUnitPrice ?? 0);
    if (!(supplierUnit > 0)) {
      const cheapest = await prisma.supplierOffer.findFirst({
        where: {
          productId: it.productId,
          variantId: it.variant?.id ?? null,
          isActive: true,
          inStock: true,
        },
        orderBy: { price: 'asc' },
        select: { price: true, id: true, supplierId: true, supplier: { select: { name: true, whatsappPhone: true } } },
      }) || await prisma.supplierOffer.findFirst({
        where: {
          productId: it.productId,
          variantId: null,
          isActive: true,
          inStock: true,
        },
        orderBy: { price: 'asc' },
        select: { price: true, id: true, supplierId: true, supplier: { select: { name: true, whatsappPhone: true } } },
      });

      if (cheapest) {
        supplierUnit = Number(cheapest.price || 0);
      }
    }

    // get supplier profile
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, whatsappPhone: true },
    });

    chosen.push({
      orderItemId: it.id,
      title: it.product?.title || 'Item',
      variantSku: it.variant?.sku || null,
      qty: Math.max(1, Number(it.quantity || 1)),
      supplierId,
      supplierName: supplier?.name ?? null,
      supplierPhone: normalizePhone(supplier?.whatsappPhone),
      supplierOfferId: (it as any).chosenSupplierOfferId ?? null,
      supplierUnit,
    });
  }

  // Group by supplier (one WhatsApp per supplier)
  const groups = chosen.reduce((m, c) => {
    (m[c.supplierId] ||= []).push(c);
    return m;
  }, {} as Record<string, Chosen[]>);

  // Charge one comms row per supplier (idempotent)
  const unitCost = await getCommsUnitCostNGN();
  if (unitCost > 0) {
    const supplierIds = Object.keys(groups);
    const existing = await prisma.orderComms.findMany({
      where: { orderId, supplierId: { in: supplierIds }, reason: 'SUPPLIER_NOTIFY' },
      select: { supplierId: true },
    });
    const already = new Set(existing.map((e: { supplierId: any; }) => e.supplierId));
    for (const supplierId of supplierIds) {
      if (already.has(supplierId)) continue;
      await prisma.orderComms.create({
        data: {
          orderId,
          supplierId,
          units: 1,
          amount: new Prisma.Decimal(unitCost),
          reason: 'SUPPLIER_NOTIFY',
          channel: 'WHATSAPP',
          recipient: groups[supplierId]?.[0]?.supplierPhone || null,
        },
      });
    }
  }

  // Shopper/contact block (ALWAYS present in every message)
  const shopper = personName(order.user);
  const shopperPhone = order.user?.phone || '—';
  const shopperEmail = order.user?.email || '—';
  const shipTo = formatAddress(order.shippingAddress);

  // For each supplier, ensure a stable supplierOrderRef, build lines, and send
  for (const [supplierId, items] of Object.entries(groups)) {
    // supplier ref for this supplier
    const supplierOrderRef = await prisma.$transaction(async (tx: any) =>
      ensureSupplierOrderRef(tx, order.id, supplierId)
    );

    const supplierPhone = items[0]?.supplierPhone || null;
    const supplierName = items[0]?.supplierName || 'Supplier';

    // Item lines (unit = supplier cost)
    const lines = items.map((c) => {
      const price = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 })
        .format(Number(c.supplierUnit || 0));
      const sku = c.variantSku ? ` (SKU: ${c.variantSku})` : '';
      return `• ${c.title}${sku} × ${c.qty} — ${price}`;
    }).join('\n');

    // Sum of this supplier’s items at supplier unit
    const supplierTotal = items.reduce((sum, c) => sum + Number(c.supplierUnit || 0) * Math.max(1, c.qty || 1), 0);
    const supplierTotalFmt = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 })
      .format(supplierTotal);

    // The message — includes customer phone + email + address for every supplier
    const msg = `New order from DaySpring

Your ref: ${supplierOrderRef}

Customer: ${shopper}
Customer phone: ${shopperPhone}
Customer email: ${shopperEmail}
Ship to: ${shipTo}

Items:
${lines}

Total to supply: ${supplierTotalFmt}

Please confirm availability and delivery timeline. Thank you!`;

    if (!supplierPhone) {
      await prisma.orderActivity.create({
        data: {
          orderId: order.id,
          type: 'SUPPLIER_NOTIFY_SKIPPED',
          message: `Missing WhatsApp for ${supplierName}`,
          meta: { supplierId },
        },
      });
      continue;
    }

    try {
      await sendWhatsApp(supplierPhone, msg);
      await prisma.orderActivity.create({
        data: {
          orderId: order.id,
          type: 'SUPPLIER_NOTIFIED',
          message: `Sent to ${supplierName}`,
          meta: { supplierId, supplierPhone, supplierOrderRef },
        },
      });
    } catch (err: any) {
      await prisma.orderActivity.create({
        data: {
          orderId: order.id,
          type: 'SUPPLIER_NOTIFY_ERROR',
          message: `Failed to send to ${supplierName}`,
          meta: { supplierId, err: String(err?.message || err), supplierOrderRef },
        },
      });
    }
  }

  return {
    ok: true,
    suppliers: Object.keys(groups).map(supplierId => ({ supplierId })),
  };
}
