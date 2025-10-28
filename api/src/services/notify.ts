// api/src/services/notify.ts
import { prisma } from '../lib/prisma.js'
import { Prisma } from '@prisma/client';

// Build per-supplier WhatsApp text
function renderSupplierText(po: any, items: any[], order: any) {
  const lines = items.map((it: any) =>
    `• ${it.title} x${it.quantity} — ${it.variantSku ? `SKU ${it.variantSku} — ` : ''}₦${Number(it.unitPrice).toLocaleString()}`
  ).join('\n');

  const addr = order.shippingAddress
    ? `${order.shippingAddress.houseNumber || ''} ${order.shippingAddress.streetName || ''}, ${order.shippingAddress.city || ''}, ${order.shippingAddress.state || ''}`
    : '—';

  return [
    `New order #${order.id}`,
    '',
    lines,
    '',
    `Deliver to: ${addr}`,
    `Total from you: ₦${Number(po.supplierAmount).toLocaleString()}`,
  ].join('\n');
}

function coerceNullishVariantId(v?: string | null) {
  const t = typeof v === 'string' ? v.trim() : v;
  return t ? t : null; // "" → null
}

async function findBestOffer(productId: string, variantId?: string | null) {
  const base = { productId, isActive: true, inStock: true } as const;
  const vi = coerceNullishVariantId(variantId);

  // 1) try variant-specific
  if (vi) {
    const exact = await prisma.supplierOffer.findFirst({
      where: { ...base, variantId: vi },
      include: {
        supplier: { select: { id: true, name: true, whatsappPhone: true } },
        variant: { select: { id: true, sku: true } },
      },
      orderBy: { price: 'asc' },
    });
    if (exact) return exact;
  }

  // 2) fallback to product-wide (variantId NULL or "")
  const productWide = await prisma.supplierOffer.findFirst({
    where: {
      ...base,
      OR: [{ variantId: null }, { variantId: '' }],
    },
    include: {
      supplier: { select: { id: true, name: true, whatsappPhone: true } },
      variant: { select: { id: true, sku: true } },
    },
    orderBy: { price: 'asc' },
  });
  if (productWide) return productWide;

  // 3) debug dump so you can see what's stored
  const dump = await prisma.supplierOffer.findMany({
    where: { productId },
    select: { id: true, variantId: true, price: true, isActive: true, inStock: true },
    orderBy: { price: 'asc' },
  });
  console.warn('No supplier offer matched', { productId, variantId: vi, dump });
  return null;
}

// If you already have helpers, keep using them
const personName = (u?: { firstName?: string | null; lastName?: string | null }) =>
  [u?.firstName, u?.lastName].filter(Boolean).join(' ') || 'Customer';
const formatAddress = (a?: any) =>
  a ? `${a.houseNumber || ''} ${a.streetName || ''}, ${a.city || ''}, ${a.state || ''}, ${a.country || ''}`.trim() : '—';
const normalizePhone = (p?: string | null) => (p || '').trim();
async function sendWhatsApp(to: string, msg: string) {
  console.log(`[whatsapp][DEV] => ${to}\n${msg}\n---`);
}
async function getCommsUnitCostNGN(): Promise<number> {
  // Try a couple keys you've used in this project
  const keys = ['commsUnitCostNGN', 'commsServiceFeeNGN', 'commsUnitCost'];
  for (const key of keys) {
    const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
    const n = Number(row?.value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}
export async function notifySuppliersForOrder(orderId: string) {
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

  // Build chosen offers per item
  const chosen: Array<{
    orderItemId: string;
    title: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
    supplierId: string;
    supplierName?: string | null;
    supplierPhone?: string | null;
    variantSku?: string | null;
    offerId: string;
    offerPrice: Prisma.Decimal;
  }> = [];

  for (const it of order.items) {
    if (!it.productId) continue;

    // 1) variant-specific offer
    let offer = it.variant?.id
      ? await prisma.supplierOffer.findFirst({
          where: {
            productId: it.productId,
            variantId: it.variant.id,
            isActive: true,
            inStock: true,
          },
          include: {
            supplier: { select: { id: true, name: true, whatsappPhone: true } },
            variant: { select: { id: true, sku: true } },
          },
          orderBy: { price: 'asc' },
        })
      : null;

    // 2) fallback to product-wide
    if (!offer) {
      offer = await prisma.supplierOffer.findFirst({
        where: {
          productId: it.productId,
          variantId: null,
          isActive: true,
          inStock: true,
        },
        include: {
          supplier: { select: { id: true, name: true, whatsappPhone: true } },
          variant: { select: { id: true, sku: true } },
        },
        orderBy: { price: 'asc' },
      });
    }

    if (!offer || !offer.supplier) continue;

    chosen.push({
      orderItemId: it.id,
      title: it.product?.title || 'Item',
      quantity: Number(it.quantity || 1),
      unitPrice: it.unitPrice,
      supplierId: offer.supplier.id,
      supplierName: offer.supplier.name,
      supplierPhone: normalizePhone(offer.supplier.whatsappPhone),
      variantSku: it.variant?.sku || null,
      offerId: offer.id,
      offerPrice: offer.price,
    });
  }

  // Group by supplier (distinct suppliers)
  const groups = chosen.reduce((m, c) => {
    (m[c.supplierId] ||= []).push(c);
    return m;
  }, {} as Record<string, typeof chosen>);

  // Charge one comms row per distinct supplier (idempotent)
  const unitCost = await getCommsUnitCostNGN(); // ₦ per supplier notification
  if (unitCost > 0) {
    const supplierIds = Object.keys(groups);

    // find already-charged suppliers for this order
    const existing = await prisma.orderComms.findMany({
      where: {
        orderId,
        supplierId: { in: supplierIds },
        reason: 'SUPPLIER_NOTIFY', // use a stable reason to dedupe
      },
      select: { supplierId: true },
    });
    const already = new Set(existing.map((e: { supplierId: any; }) => e.supplierId));

    for (const supplierId of supplierIds) {
      if (already.has(supplierId)) continue;

      // One row per supplier, amount = unitCost * 1 (units = 1)
      await prisma.orderComms.create({
        data: {
          orderId,
          supplierId,
          units: 1,
          amount: new Prisma.Decimal(unitCost), // store full charge for transparency
          reason: 'SUPPLIER_NOTIFY',
          channel: 'WHATSAPP',
          recipient: groups[supplierId]?.[0]?.supplierPhone || null,
        },
      });
    }
  }

  // (Optional) send messages + activity logs
  const shopper = personName(order.user);
  const shopperPhone = order.user?.phone || '';
  const shipTo = formatAddress(order.shippingAddress);

  for (const [supplierId, items] of Object.entries(groups)) {
    const supplierPhone = items[0]?.supplierPhone || null;
    const supplierName = items[0]?.supplierName || 'Supplier';

    const lines = items.map((c) => {
      const n = Number(c.offerPrice || c.unitPrice || 0);
      const price = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 }).format(n);
      const sku = c.variantSku ? ` (SKU: ${c.variantSku})` : '';
      return `• ${c.title}${sku} × ${c.quantity} — ${price}`;
    }).join('\n');

    const msg = `New order from DaySpring

Order: ${order.id}
Customer: ${shopper}
Customer phone: ${shopperPhone || '—'}
Ship to: ${shipTo}

Items:
${lines}

Please confirm availability and delivery timeline. Thank you!`;

    if (!supplierPhone) {
      await prisma.orderActivity.create({
        data: { orderId: order.id, type: 'SUPPLIER_NOTIFY_SKIPPED', message: `Missing WhatsApp for ${supplierName}`, meta: { supplierId } },
      });
      continue;
    }

    try {
      await sendWhatsApp(supplierPhone, msg);
      await prisma.orderActivity.create({
        data: { orderId: order.id, type: 'SUPPLIER_NOTIFIED', message: `Sent to ${supplierName}`, meta: { supplierId, supplierPhone } },
      });
    } catch (err: any) {
      await prisma.orderActivity.create({
        data: { orderId: order.id, type: 'SUPPLIER_NOTIFY_ERROR', message: `Failed to send to ${supplierName}`, meta: { supplierId, err: String(err?.message || err) } },
      });
    }
  }

  return { ok: true, suppliers: Object.keys(groups).map(supplierId => ({ supplierId })) };
}

