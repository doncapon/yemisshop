// api/src/services/notify.ts
import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client'
import { sendMail } from '../lib/email.js';
import { sendWhatsApp } from '../lib/sms.js';

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
      const cheapest =
        (await prisma.supplierOffer.findFirst({
          where: {
            productId: it.productId,
            variantId: it.variant?.id ?? null,
            isActive: true,
            inStock: true,
          },
          orderBy: { price: 'asc' },
          select: {
            price: true,
            id: true,
            supplierId: true,
            supplier: { select: { name: true, whatsappPhone: true } },
          },
        })) ||
        (await prisma.supplierOffer.findFirst({
          where: {
            productId: it.productId,
            variantId: null,
            isActive: true,
            inStock: true,
          },
          orderBy: { price: 'asc' },
          select: {
            price: true,
            id: true,
            supplierId: true,
            supplier: { select: { name: true, whatsappPhone: true } },
          },
        }));

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
    const already = new Set(existing.map((e: { supplierId: any }) => e.supplierId));
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
    const lines = items
      .map((c) => {
        const price = new Intl.NumberFormat('en-NG', {
          style: 'currency',
          currency: 'NGN',
          maximumFractionDigits: 2,
        }).format(Number(c.supplierUnit || 0));
        const sku = c.variantSku ? ` (SKU: ${c.variantSku})` : '';
        return `• ${c.title}${sku} × ${c.qty} — ${price}`;
      })
      .join('\n');

    // Sum of this supplier’s items at supplier unit
    const supplierTotal = items.reduce(
      (sum, c) => sum + Number(c.supplierUnit || 0) * Math.max(1, c.qty || 1),
      0
    );
    const supplierTotalFmt = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      maximumFractionDigits: 2,
    }).format(supplierTotal);

    // Plaintext fallback message
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
      // Prefer a template if configured; otherwise send plaintext
      const templateName =
        process.env.WABA_TEMPLATE_NAME_SUPPLIER || 'supplier_notify';

      const components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: supplierOrderRef },
            { type: 'text', text: shopper },
            { type: 'text', text: shopperPhone },
            { type: 'text', text: shopperEmail },
            { type: 'text', text: shipTo },
            { type: 'text', text: lines },
            { type: 'text', text: supplierTotalFmt },
          ],
        },
      ];

      const usedTemplate =
        process.env.WABA_PHONE_NUMBER_ID && process.env.WABA_TOKEN;

      if (usedTemplate) {
        await sendWhatsApp(supplierPhone, msg, {
          useTemplate: true,
          templateName,
          langCode: process.env.WABA_TEMPLATE_LANG || 'en',
          components,
        });
      } else {
        // fallback to plain text if WA Cloud not configured
        await sendWhatsApp(supplierPhone, msg);
      }

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
    suppliers: Object.keys(groups).map((supplierId) => ({ supplierId })),
  };
}

/**
 * Notify shopper that their order has been paid.
 * - Called from finalizePaidFlow in payments.ts
 * - Idempotency is handled in payments.ts via PAYMENT_EVENT ORDER_PAID_EMAIL_SENT
 */
export async function notifyCustomerOrderPaid(orderId: string, paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      amount: true,
      reference: true,
      paidAt: true,
      status: true,
      order: {
        select: {
          id: true,
          total: true,
          status: true,
          createdAt: true,
          user: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          shippingAddress: {
            select: {
              houseNumber: true,
              streetName: true,
              town: true,
              city: true,
              state: true,
              country: true,
            },
          },
          items: {
            select: {
              title: true,
              quantity: true,
              unitPrice: true,
              lineTotal: true,
            },
          },
        },
      },
    },
  });

  // Safety checks
  if (!payment || !payment.order) return;
  if (payment.status !== 'PAID') return;

  const order = payment.order;
  const user = order.user;
  if (!user?.email) return;

  const to ="lordshegz@gmail.com" //user.email;
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Customer';

  const paidAt = payment.paidAt || new Date();
  const total = Number(order.total || payment.amount || 0);
  const amountPaid = Number(payment.amount || total);

  const subject = `Payment received for your order ${order.id}`;
  const preview = `We’ve received your payment of ₦${amountPaid.toLocaleString()} for order ${order.id}.`;

  const shippingLines = [
    order.shippingAddress?.houseNumber,
    order.shippingAddress?.streetName,
    order.shippingAddress?.town,
    order.shippingAddress?.city,
    order.shippingAddress?.state,
    order.shippingAddress?.country,
  ]
    .filter(Boolean)
    .join(', ');

  const itemsHtml =
    (order.items || [])
      .map((it: { quantity: any; unitPrice: any; lineTotal: null; title: any }) => {
        const qty = Number(it.quantity || 1);
        const unit = Number(it.unitPrice || 0);
        const line = it.lineTotal != null ? Number(it.lineTotal) : unit * qty;

        return `
          <tr>
            <td style="padding:4px 0;">${it.title || 'Item'}</td>
            <td style="padding:4px 8px; text-align:center;">${qty}</td>
            <td style="padding:4px 8px; text-align:right;">₦${unit.toLocaleString()}</td>
            <td style="padding:4px 0; text-align:right;">₦${line.toLocaleString()}</td>
          </tr>
        `;
      })
      .join('') ||
    `
      <tr>
        <td colspan="4" style="padding:4px 0;">Order details are available in your dashboard.</td>
      </tr>
    `;

  const html = `
    <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#111827;line-height:1.6;">
      <p>Hi ${displayName},</p>
      <p>We’ve received your payment for your order <strong>${order.id}</strong>. Thank you for shopping with us.</p>

      <p>
        <strong>Amount paid:</strong> ₦${amountPaid.toLocaleString()}<br/>
        <strong>Payment ref:</strong> ${payment.reference || payment.id}<br/>
        <strong>Paid at:</strong> ${paidAt.toLocaleString()}
      </p>

      <p><strong>Order summary</strong></p>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th align="left" style="padding:4px 0;border-bottom:1px solid #e5e7eb;">Item</th>
            <th align="center" style="padding:4px 0;border-bottom:1px solid #e5e7eb;">Qty</th>
            <th align="right" style="padding:4px 0;border-bottom:1px solid #e5e7eb;">Unit</th>
            <th align="right" style="padding:4px 0;border-bottom:1px solid #e5e7eb;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <p style="margin-top:10px;">
        <strong>Order total:</strong> ₦${total.toLocaleString()}
      </p>

      ${shippingLines ? `<p><strong>Shipping to:</strong><br/>${shippingLines}</p>` : ''}

      <p>You can view your full order details and download your receipt from your dashboard at any time.</p>

      <p style="margin-top:16px;font-size:12px;color:#6b7280;">
        If you have any questions, just reply to this email.
      </p>
    </div>
  `;

  const text = [
    `Hi ${displayName},`,
    ``,
    `We’ve received your payment for order ${order.id}.`,
    `Amount paid: ₦${amountPaid.toLocaleString()}`,
    `Payment ref: ${payment.reference || payment.id}`,
    `Paid at: ${paidAt.toLocaleString()}`,
    ``,
    `You can view your order and receipt in your dashboard.`,
  ].join('\n');

  await sendMail({
    to,
    subject,
    html,
    text,
  });

  console.log('[mail] order paid email sent', {
    to,
    orderId: order.id,
    paymentId: payment.id,
    preview,
  });
}
