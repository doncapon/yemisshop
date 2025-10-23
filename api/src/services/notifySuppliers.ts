// api/src/services/notify.ts
import { sendWhatsApp } from './whatsapp.js';
import { prisma } from '../lib/prisma.js'

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

function normalizePhone(p?: string | null) {
  if (!p) return null;
  const x = p.trim();
  if (/^\+?\d{8,15}$/.test(x)) return x.startsWith('+') ? x : `+${x}`;
  return null; // keep it simple for now
}

function personName(u?: { firstName?: string | null; lastName?: string | null; email?: string | null }) {
  const parts = [u?.firstName?.trim(), u?.lastName?.trim()].filter(Boolean);
  return parts.length ? parts.join(' ') : (u?.email || 'Customer');
}

function formatAddress(a?: any) {
  if (!a) return '—';
  const bits = [
    a.houseNumber, a.streetName, a.town, a.city, a.state, a.postCode, a.country,
  ].filter(Boolean);
  return bits.join(', ');
}



export async function notifySuppliersForOrder(orderId: string) {
  // services/notifySuppliers.ts
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, phone: true } }, // ← add this
      items: {
        include: {
          product: { select: { id: true, title: true } },
          variant: { select: { id: true, sku: true } },
        },
      },
      shippingAddress: true,
    },
  });


  const shopperName = personName(order.user);
  const shopperPhone = order.user?.phone || '';
  const shipTo = formatAddress(order.shippingAddress);

  if (!order) throw new Error('Order not found');
  if (!order.items.length) return { ok: true, suppliers: [] };

  const chosen: Array<{
    orderItemId: string;
    title: string;
    quantity: number;
    unitPrice: any;
    supplierId: string;
    supplierName?: string | null;
    supplierPhone?: string | null;
    variantSku?: string | null;
    offerId: string;
    offerPrice: any;
  }> = [];

  for (const it of order.items) {
    if (!it.productId) {
      console.warn('notify: item has no productId', it.id);
      continue;
    }

    let offer = null as any;

    // 1) try variant-specific
    if (it.variant?.id) {
      offer = await prisma.supplierOffer.findFirst({
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
      });
    }

    // 2) fallback to product-wide (variantId = null)
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

    // console.log('notify: item', {
    //   orderItemId: it.id,
    //   productId: it.productId,
    //   variantId: it.variant?.id ?? null,
    //   offerFound: !!offer,
    //   offerVariantId: offer?.variantId ?? null,
    //   offerPrice: offer?.price,
    //   supplier: offer?.supplier?.name,
    // });

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


  // Group by supplier
  const map = new Map<string, typeof chosen>();
  for (const c of chosen) {
    if (!map.has(c.supplierId)) map.set(c.supplierId, []);
    map.get(c.supplierId)!.push(c);
  }


  const results: Array<{ supplierId: string; sent: boolean; error?: string }> = [];

  // For each supplier group, upsert PurchaseOrder + PO items and send WhatsApp
  for (const [supplierId, items] of map) {
    // compute supplierAmount (sum of supplier unitPrice * qty)
    let supplierAmount = items.reduce((sum, it) => sum + Number(it.unitPrice) * it.quantity, 0);

    // Either find existing PO for this order+supplier or create one
    let po = await prisma.purchaseOrder.findFirst({
      where: { orderId, supplierId },
    });

    if (!po) {
      po = await prisma.purchaseOrder.create({
        data: {
          orderId,
          supplierId,
          subtotal: supplierAmount,        // you can split subtotal/platformFee however you like
          platformFee: 0,
          supplierAmount,
          status: 'CREATED',
        },
      });
    } else {
      // keep it idempotent: update amounts if changed
      po = await prisma.purchaseOrder.update({
        where: { id: po.id },
        data: {
          supplierAmount,
          subtotal: supplierAmount,
        },
      });
    }

    // Link each orderItem to the PO (avoid duplicates)
    for (const it of items) {
      const existing = await prisma.purchaseOrderItem.findFirst({
        where: { purchaseOrderId: po.id, orderItemId: it.orderItemId },
      });
      if (!existing) {
        await prisma.purchaseOrderItem.create({
          data: {
            purchaseOrderId: po.id,
            orderItemId: it.orderItemId,
          },
        });
      }
    }


    // Compose text
    const text = renderSupplierText(
      po,
      items.map((it) => ({
        title: it.title,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        variantSku: it.variantSku,
      })),
      order
    );

    // group by supplier
    const groups = chosen.reduce((m, c) => {
      (m[c.supplierId] ||= []).push(c);
      return m;
    }, {} as Record<string, typeof chosen>);

    for (const [supplierId, items] of Object.entries(groups)) {
      const supplierPhone = items[0]?.supplierPhone || null;
      const supplierName = items[0]?.supplierName || 'Supplier';

      // item lines
      const lines = items.map((c) => {
        const n = Number(c.offerPrice || c.unitPrice || 0);
        const price = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 }).format(n);
        const sku = c.variantSku ? ` (SKU: ${c.variantSku})` : '';
        return `• ${c.title}${sku} × ${c.quantity} — ${price}`;
      }).join('\n');

      const msg =
        `New order from Yemisshop

          Order: ${order.id}
          Customer: ${shopperName}
          Customer phone: ${shopperPhone || '—'}
          Ship to: ${shipTo}

          Items:
          ${lines}

          Please confirm availability and delivery timeline. Thank you!`;

      // send WhatsApp only if we have a phone
      if (supplierPhone) {
        try {
          await sendWhatsApp(supplierPhone, msg);  // ← your existing sender (Twilio/Meta/etc.)
          await prisma.orderActivity.create({
            data: { orderId: order.id, type: 'SUPPLIER_NOTIFIED', message: `Sent to ${supplierName}`, meta: { supplierId, supplierPhone } },
          });
        } catch (err: any) {
          console.error('whatsapp send failed', supplierId, err?.message || err);
          await prisma.orderActivity.create({
            data: { orderId: order.id, type: 'SUPPLIER_NOTIFY_ERROR', message: `Failed to send to ${supplierName}`, meta: { supplierId, err: String(err?.message || err) } },
          });
        }
      } else {
        await prisma.orderActivity.create({
          data: { orderId: order.id, type: 'SUPPLIER_NOTIFY_SKIPPED', message: `Missing WhatsApp for ${supplierName}`, meta: { supplierId } },
        });
      }
    }
  }
  return { ok: true, suppliers: chosen.map(c => ({ supplierId: c.supplierId, offerId: c.offerId })) };
}
