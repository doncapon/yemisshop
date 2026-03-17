// src/services/notify.ts
import { prisma } from "../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { sendMail } from "../lib/email.js";
import { sendWhatsappViaTermii } from "../lib/termii.js";

/* ----------------------------- Helpers ----------------------------- */

const personName = (u?: { firstName?: string | null; lastName?: string | null }) =>
  [u?.firstName, u?.lastName].filter(Boolean).join(" ") || "Customer";

const normalizePhone = (p?: string | null) => (p || "").trim();

const formatAddress = (a?: any) => {
  if (!a) return "—";
  const parts = [a.houseNumber, a.streetName, a.town, a.city, a.state, a.country].filter(Boolean);
  return parts.join(", ");
};

function pickOrderShippingAddress(order: any) {
  return (
    order?.shippingAddressJson ??
    order?.shippingAddressSnapshotJson ??
    order?.deliveryAddressJson ??
    null
  );
}

async function getCommsUnitCostNGN(): Promise<number> {
  const keys = ["commsUnitCostNGN", "commsServiceFeeNGN", "commsUnitCost"];
  for (const key of keys) {
    const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
    const n = Number((row as any)?.value);
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
  const existingPO = await tx.purchaseOrder.findFirst({
    where: { orderId, supplierId },
    orderBy: { createdAt: "asc" },
    select: { supplierOrderRef: true },
  });
  if (existingPO?.supplierOrderRef) return existingPO.supplierOrderRef;

  const act = await tx.orderActivity.findFirst({
    where: { orderId, supplierId, type: "SUPPLIER_REF_CREATED" },
    orderBy: { createdAt: "asc" },
    select: { meta: true },
  });
  const fromAct = (act?.meta as any)?.supplierOrderRef || (act?.meta as any)?.supplierRef;
  if (fromAct && typeof fromAct === "string" && fromAct.trim()) {
    return fromAct.trim();
  }

  const ref = generateSupplierOrderRef();
  try {
    await tx.orderActivity.create({
      data: {
        orderId,
        supplierId,
        type: "SUPPLIER_REF_CREATED",
        message: `Supplier reference created for supplier ${supplierId}`,
        meta: { supplierOrderRef: ref },
      },
    });
  } catch {
    //
  }
  return ref;
}

/* ----------------------------- Main notify ----------------------------- */

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
    },
  });

  if (!order) throw new Error("Order not found");
  if (!order.items.length) return { ok: true, suppliers: [] };

  type Chosen = {
    orderItemId: string;
    title: string;
    variantSku?: string | null;
    qty: number;
    supplierId: string;
    supplierName?: string | null;
    supplierPhone?: string | null;
    supplierOfferId?: string | null;
    supplierUnit: number;
  };

  const chosen: Chosen[] = [];

  for (const it of order.items as any[]) {
    const supplierId = it.chosenSupplierId as string | null;
    if (!supplierId) continue;

    let supplierUnit = Number(it.chosenSupplierUnitPrice ?? 0);

    if (!(supplierUnit > 0)) {
      const cheapestBase = await prisma.supplierProductOffer.findFirst({
        where: { productId: it.productId ?? it.product?.id, isActive: true },
        orderBy: [{ basePrice: "asc" as any }],
      });

      let cheapestVariant: any = null;
      const variantId = it.variantId ?? it.variant?.id ?? null;
      if (variantId) {
        cheapestVariant = await prisma.supplierVariantOffer.findFirst({
          where: { variantId, isActive: true },
          orderBy: [{ unitPrice: "asc" as any }],
        });
      }

      const cheapest = cheapestVariant || cheapestBase;
      if (cheapest) supplierUnit = Number(cheapest.unitPrice || 0);
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, whatsappPhone: true },
    });

    chosen.push({
      orderItemId: it.id,
      title: it.product?.title || it.title || "Item",
      variantSku: it.variant?.sku || null,
      qty: Math.max(1, Number(it.quantity || 1)),
      supplierId,
      supplierName: supplier?.name ?? null,
      supplierPhone: normalizePhone(supplier?.whatsappPhone),
      supplierOfferId: it.chosenSupplierOfferId ?? null,
      supplierUnit,
    });
  }

  const groups = chosen.reduce((m, c) => {
    (m[c.supplierId] ||= []).push(c);
    return m;
  }, {} as Record<string, Chosen[]>);

  const unitCost = await getCommsUnitCostNGN();
  if (unitCost > 0) {
    const supplierIds = Object.keys(groups);
    const existing = await prisma.orderComms.findMany({
      where: { orderId, supplierId: { in: supplierIds }, reason: "SUPPLIER_NOTIFY" },
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
          reason: "SUPPLIER_NOTIFY",
          channel: "WHATSAPP",
          recipient: groups[supplierId]?.[0]?.supplierPhone || null,
        },
      });
    }
  }

  const shopper = personName(order.user);
  const shopperPhone = order.user?.phone || "—";
  const shopperEmail = order.user?.email || "—";
  const shipTo = formatAddress(pickOrderShippingAddress(order));

  for (const [supplierId, items] of Object.entries(groups)) {
    const supplierOrderRef = await prisma.$transaction(async (tx) =>
      ensureSupplierOrderRef(tx, order.id, supplierId)
    );

    const supplierPhone = items[0]?.supplierPhone || null;
    const supplierName = items[0]?.supplierName || "Supplier";

    const lines = items
      .map((c) => {
        const price = new Intl.NumberFormat("en-NG", {
          style: "currency",
          currency: "NGN",
          maximumFractionDigits: 2,
        }).format(Number(c.supplierUnit || 0));
        const sku = c.variantSku ? ` (SKU: ${c.variantSku})` : "";
        return `• ${c.title}${sku} × ${c.qty} — ${price}`;
      })
      .join("\n");

    const supplierTotal = items.reduce(
      (sum, c) => sum + Number(c.supplierUnit || 0) * Math.max(1, c.qty || 1),
      0
    );

    const supplierTotalFmt = new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 2,
    }).format(supplierTotal);

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
          type: "SUPPLIER_NOTIFY_SKIPPED",
          message: `Missing WhatsApp for ${supplierName}`,
          meta: { supplierId },
        },
      });
      continue;
    }

    try {
      await sendWhatsappViaTermii({
        to: supplierPhone,
        message: msg,
      });

      await prisma.orderActivity.create({
        data: {
          orderId: order.id,
          type: "SUPPLIER_NOTIFIED",
          message: `Sent to ${supplierName}`,
          meta: { supplierId, supplierPhone, supplierOrderRef },
        },
      });
    } catch (err: any) {
      await prisma.orderActivity.create({
        data: {
          orderId: order.id,
          type: "SUPPLIER_NOTIFY_ERROR",
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

/* ------------------------ Customer paid email ------------------------ */

export async function notifyCustomerOrderPaid(orderId: string, paymentId: string) {
  const paymentSelect = {
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
        serviceFeeTotal: true,
        serviceFeeBase: true,
        serviceFeeComms: true,
        serviceFeeGateway: true,
        tax: true,
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
        user: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
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
  } satisfies Prisma.PaymentSelect;

  type PaymentWithOrder = Prisma.PaymentGetPayload<{
    select: typeof paymentSelect;
  }>;

  const payment: PaymentWithOrder | null = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: paymentSelect,
  });

  if (!payment || !payment.order) return;
  if (payment.status !== "PAID") return;

  const order = payment.order;
  const user = order.user;
  if (!user?.email) return;

  const to = user.email;
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || "Customer";
  const paidAt = payment.paidAt || new Date();
  const amountPaid = Number(payment.amount ?? 0);

  const itemsSubtotal = Number(
    (order.items || []).reduce((sum: number, it) => {
      const qty = Number(it.quantity || 1);
      const unit = Number(it.unitPrice || 0);
      const line = it.lineTotal != null ? Number(it.lineTotal) : unit * qty;
      return sum + (Number.isFinite(line) ? line : 0);
    }, 0)
  );

  const serviceFeeTotal = Number(order.serviceFeeTotal ?? 0);
  const safeServiceFeeTotal = Number.isFinite(serviceFeeTotal) ? serviceFeeTotal : 0;

  const tax = Number(order.tax ?? 0);
  const safeTax = Number.isFinite(tax) ? tax : 0;

  const orderTotal =
    Number.isFinite(Number(order.total)) && Number(order.total) > 0
      ? Number(order.total)
      : itemsSubtotal + safeServiceFeeTotal + safeTax;

  const safeAmountPaid = Number.isFinite(amountPaid) && amountPaid > 0 ? amountPaid : orderTotal;

  const subject = `Payment received for your order ${order.id}`;
  const preview = `We’ve received your payment of ₦${safeAmountPaid.toLocaleString()} for order ${order.id}.`;

  const shippingLines = [
    order.shippingAddress?.houseNumber,
    order.shippingAddress?.streetName,
    order.shippingAddress?.town,
    order.shippingAddress?.city,
    order.shippingAddress?.state,
    order.shippingAddress?.country,
  ]
    .filter(Boolean)
    .join(", ");

  const itemsHtml =
    (order.items || [])
      .map((it) => {
        const qty = Number(it.quantity || 1);
        const unit = Number(it.unitPrice || 0);
        const line = it.lineTotal != null ? Number(it.lineTotal) : unit * qty;

        return `
          <tr>
            <td style="padding:4px 0;">${it.title || "Item"}</td>
            <td style="padding:4px 8px; text-align:center;">${qty}</td>
            <td style="padding:4px 8px; text-align:right;">₦${unit.toLocaleString()}</td>
            <td style="padding:4px 0; text-align:right;">₦${Number(line || 0).toLocaleString()}</td>
          </tr>
        `;
      })
      .join("") ||
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
        <strong>Amount paid:</strong> ₦${safeAmountPaid.toLocaleString()}<br/>
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

      <table style="width:100%;border-collapse:collapse;margin-top:10px;">
        <tbody>
          <tr>
            <td style="padding:4px 0;color:#374151;">Items subtotal</td>
            <td style="padding:4px 0;text-align:right;color:#111827;">₦${itemsSubtotal.toLocaleString()}</td>
          </tr>

          <tr>
            <td style="padding:4px 0;color:#374151;">Tax (included)</td>
            <td style="padding:4px 0;text-align:right;color:#111827;">₦${safeTax.toLocaleString()}</td>
          </tr>

          <tr>
            <td style="padding:4px 0;color:#374151;">Service fee</td>
            <td style="padding:4px 0;text-align:right;color:#111827;">₦${safeServiceFeeTotal.toLocaleString()}</td>
          </tr>

          <tr>
            <td style="padding:8px 0;border-top:1px solid #e5e7eb;font-weight:600;">Order total</td>
            <td style="padding:8px 0;border-top:1px solid #e5e7eb;text-align:right;font-weight:600;">₦${orderTotal.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      ${shippingLines ? `<p style="margin-top:10px;"><strong>Shipping to:</strong><br/>${shippingLines}</p>` : ""}

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
    `Amount paid: ₦${safeAmountPaid.toLocaleString()}`,
    `Payment ref: ${payment.reference || payment.id}`,
    `Paid at: ${paidAt.toLocaleString()}`,
    ``,
    `Items subtotal: ₦${itemsSubtotal.toLocaleString()}`,
    `Service fee: ₦${safeServiceFeeTotal.toLocaleString()}`,
    `Order total: ₦${orderTotal.toLocaleString()}`,
    ``,
    `You can view your order and receipt in your dashboard.`,
  ].join("\n");

  await sendMail({ to, subject, html, text });

  console.log("[mail] order paid email sent", {
    to,
    orderId: order.id,
    paymentId: payment.id,
    preview,
    itemsSubtotal,
    serviceFeeTotal: safeServiceFeeTotal,
    orderTotal,
  });
}