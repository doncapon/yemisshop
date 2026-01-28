import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client'

function shortDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`; // e.g. 20250321
}

function compactReceiptNo(payId: string, reference: string, paidAt?: Date | null) {
  const datePart = shortDate(paidAt ?? new Date());
  // last 6 from payment reference (usually unique enough) + last 4 of payment id
  const tail = `${reference.replace(/[^A-Z0-9]/gi, '').slice(-6)}${payId.slice(-4)}`.toUpperCase();
  return `RCT-${datePart}-${tail}`;
}

export async function issueReceiptIfNeeded(paymentId: string) {
  // load everything needed to render a receipt
  const pay = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      order: {
        include: {
          user: { select: { email: true, firstName: true, lastName: true, phone: true } },
          shippingAddress: true,
          items: {
            include: {
              product: { select: { title: true, sku: true } },
              variant: { select: { sku: true, imagesJson: true } }, // you added this relation
            },
          },
        },
      },
    },
  });
  if (!pay) throw new Error('Payment not found');
  if (pay.status !== 'PAID') return null;              // only issue on successful payments

  // If already issued, return the snapshot (idempotent)
  if (pay.receiptNo && pay.receiptData) return pay;

  const o = pay.order;
  if (!o) throw new Error('Payment missing order');

  // Build a render-ready snapshot (keeps your receipts consistent in time)
  const snapshot = {
    receiptNo: pay.receiptNo ?? null,
    reference: pay.reference,
    paidAt: pay.paidAt ?? new Date(),
    provider: pay.provider,
    channel: pay.channel,
    amount: pay.amount,  // Decimal kept; format on the frontend
    currency: 'NGN',

    order: {
      id: o.id,
      status: o.status,
      subtotal: o.subtotal,
      tax: o.tax,
      shipping: o.shipping,
      total: o.total,
      createdAt: o.createdAt,
      shippingAddress: o.shippingAddress, // raw; render selectively
      items: o.items.map((it: { id: any; title: any; product: { title: any; sku: any; }; variant: { sku: any; }; unitPrice: Prisma.Decimal.Value; quantity: Prisma.Decimal.Value; lineTotal: any; selectedOptions: any; }) => ({
        id: it.id,
        title: it.title || it.product?.title || 'Item',
        variantSku: it.variant?.sku || null,
        productSku: it.product?.sku || null,
        unitPrice: it.unitPrice,
        quantity: it.quantity,
        lineTotal: it.lineTotal ?? new Prisma.Decimal(it.quantity).times(it.unitPrice),
        selectedOptions: it.selectedOptions ?? [],
      })),
    },

    customer: {
      email: o.user?.email || '',
      name: [o.user?.firstName, o.user?.lastName].filter(Boolean).join(' ') || '',
      phone: o.user?.phone || '',
    },

    // Your brand info — hardcode or read from env/config
    merchant: {
      name: process.env.APP_NAME || 'DaySpring',
      addressLine1: process.env.MERCHANT_ADDR1 || '',
      addressLine2: process.env.MERCHANT_ADDR2 || '',
      supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
    },
  };

  // Propose a compact, unique receiptNo
  const proposed = compactReceiptNo(pay.id, pay.reference, pay.paidAt);

  // Try to save. If collision (extremely rare), add a quick suffix and retry.
  try {
    const updated = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        receiptNo: proposed,
        receiptIssuedAt: new Date(),
        receiptData: snapshot as Prisma.JsonObject,
      },
    });
    return updated;
  } catch (e: any) {
    if (String(e?.code) !== 'P2002') throw e; // not unique conflict
    const alt = `${proposed}-${(Math.random() * 36 ** 2 | 0).toString(36).toUpperCase().padStart(2, '0')}`;
    const updated = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        receiptNo: alt,
        receiptIssuedAt: new Date(),
        receiptData: snapshot as Prisma.JsonObject,
      },
    });
    return updated;
  }
}
