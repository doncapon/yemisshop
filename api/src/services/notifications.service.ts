// api/src/services/notifications.service.ts
import { safeSend } from "../lib/email.js";
import { prisma } from "../lib/prisma.js";
import { Prisma, NotificationType } from "@prisma/client";
import { sendWhatsApp } from "../lib/sms.js";

type NotificationPayload = {
  type: NotificationType; // strongly typed
  title: string;
  body: string;
  data?: any;
};

type Tx = Prisma.TransactionClient;

/* ----------------------------- Core notifiers ----------------------------- */

export async function notifyUser(
  userId: string | null | undefined,
  payload: NotificationPayload,
  tx?: Tx
) {
  const db = tx ?? prisma;
  const uid = userId ? String(userId) : "";
  if (!uid) return;

  await db.notification.create({
    data: {
      userId: uid,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? undefined,
    },
  });
}

export async function notifyMany(
  userIds: Array<string | null | undefined>,
  payload: NotificationPayload,
  tx?: Tx
) {
  const db = tx ?? prisma;

  const ids = Array.from(
    new Set((userIds || []).map((id) => (id ? String(id) : "")).filter(Boolean))
  );

  if (!ids.length) return;

  await db.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? undefined,
    })),
  });
}

/** Convenience: notify all admins + super admins. */
export async function notifyAdmins(payload: NotificationPayload, tx?: Tx) {
  const db = tx ?? prisma;

  const admins = await db.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } },
    select: { id: true },
  });

  if (!admins.length) return;

  await notifyMany(
    admins.map((a: any) => a.id),
    payload,
    db
  );
}

// services/notifications.service.ts
type Db = typeof prisma; // or PrismaClient
// allow tx or prisma
function dbClient(tx?: any) {
  return tx ?? prisma;
}

export async function notifySupplierBySupplierId(
  supplierId: string,
  payload: { type: string; title: string; body: string; data?: any },
  tx?: any
) {
  const db = dbClient(tx);

  // IMPORTANT: supplier must have userId (or your supplier notification routing must map differently)
  const supplier = await db.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, userId: true, name: true },
  });

  if (!supplier?.userId) {
    // Don't silently succeed
    throw Object.assign(new Error(`Supplier ${supplierId} has no userId to notify.`), {
      code: "SUPPLIER_NO_USER",
      supplierId,
    });
  }

  // create in-app notification
  await db.notification.create({
    data: {
      userId: supplier.userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      readAt: null,
    } as any,
  });

  return { ok: true };
}


/* ------------------------------ Small helpers ----------------------------- */

function escapeHtml(input: unknown) {
  const s = String(input ?? "");
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toNaira(amount: unknown) {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;

  // Keep your current style but make it stable
  return `₦${n.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatWhen(dt?: Date | string | null) {
  if (!dt) return null;
  const d = typeof dt === "string" ? new Date(dt) : dt;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(); // server locale; if you want NG/London consistently, set locale here.
}

/** Helper: format a short human-friendly order ref */
function formatOrderLabel(order: { id: string }, payment?: { reference?: string | null }) {
  if (payment?.reference) return `Payment ref ${payment.reference}`;
  return `Order ${order.id}`;
}

function linesToEmailHtml(lines: string[]) {
  // Turn lines into <p> blocks; blank lines become spacing via <div style="height:12px"></div>
  return lines
    .map((line) => {
      if (!line.trim()) return `<div style="height:12px"></div>`;
      return `<p style="margin:0 0 8px 0">${escapeHtml(line)}</p>`;
    })
    .join("");
}

/* ------------------------- Customer comms: refund ------------------------- */

/**
 * Notify the customer that their order has been fully refunded.
 * Called from adminOrders refund endpoint after DB state is already updated.
 */
export async function notifyCustomerOrderRefunded(
  orderId: string,
  paymentId?: string | null,
  tx?: Tx
) {
  const db = tx ?? prisma;

  try {
    const order = await db.order.findUnique({
      where: { id: String(orderId) },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } },
        payments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            reference: true,
            amount: true,
            status: true,
            paidAt: true,
          },
        },
      },
    });

    if (!order?.user?.email) {
      console.warn("[notifyCustomerOrderRefunded] no order/user email", { orderId });
      return;
    }

    const payment =
      (paymentId
        ? order.payments?.find((p: any) => String(p.id) === String(paymentId))
        : null) ??
      order.payments?.[0] ??
      null;

    const label = formatOrderLabel(order, payment ?? undefined);
    const amountText = toNaira(payment?.amount ?? (order as any).total ?? 0);
    const paidAtText = formatWhen(payment?.paidAt ?? null);

    const fullName =
      order.user.firstName || order.user.lastName
        ? `${order.user.firstName || ""} ${order.user.lastName || ""}`.trim()
        : null;

    const subject = `Your ${label} has been refunded`;

    const lines: string[] = [
      fullName ? `Hi ${fullName},` : "Hi,",
      "",
      "Your refund has been processed successfully.",
      "",
      `• ${label}`,
      amountText ? `• Amount: ${amountText}` : "",
      paidAtText ? `• Original payment date: ${paidAtText}` : "",
      "",
      "Depending on your bank, it may take a few working days for the refund to appear in your account.",
      "",
      "If you have any questions, simply reply to this email.",
      "",
      "Best regards,",
      "Customer Support",
    ].filter((x) => x !== "");

    await safeSend({
      to: order.user.email,
      subject,
      text: lines.join("\n"),
      html: linesToEmailHtml(lines),
    });

    // Optional: WhatsApp notification
    if (order.user.phone) {
      try {
        await sendWhatsApp(
          order.user.phone,
          `Your ${label} has been refunded.${amountText ? ` Amount: ${amountText}.` : ""
          }`
        );
      } catch (e) {
        console.error("[notifyCustomerOrderRefunded] WhatsApp failed", e);
      }
    }

    // Optional: In-app notification record (since you already have notifications table)
    try {
      await notifyUser(
        order.user.id,
        {
          type: NotificationType.REFUND_STATUS_CHANGED,
          title: "Refund processed",
          body: `${label} has been refunded${amountText ? ` (${amountText})` : ""}.`,
          data: { orderId: order.id, paymentId: payment?.id ?? null },
        },
        db
      );
    } catch (e) {
      console.error("[notifyCustomerOrderRefunded] in-app notify failed", e);
    }


    // Optional: log activity item (if your schema supports it)
    try {
      await (db as any).orderActivity.create({
        data: {
          orderId: order.id,
          type: "CUSTOMER_NOTIFIED",
          message: "Customer notified about refund",
          meta: {
            channel: ["email", order.user.phone ? "whatsapp" : null].filter(Boolean),
            paymentId: payment?.id ?? null,
          },
        },
      });
    } catch {
      // non-fatal
    }
  } catch (e) {
    console.error("[notifyCustomerOrderRefunded] failed", e);
  }
}

/* ------------------------ Customer comms: cancel -------------------------- */

/** Notify the customer that their order has been cancelled by admin */
export async function notifyCustomerOrderCancelled(orderId: string, tx?: Tx) {
  const db = tx ?? prisma;

  try {
    const order = await db.order.findUnique({
      where: { id: String(orderId) },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } },
      },
    });

    if (!order?.user?.email) {
      console.warn("[notifyCustomerOrderCancelled] no order/user email", { orderId });
      return;
    }

    const fullName =
      order.user.firstName || order.user.lastName
        ? `${order.user.firstName || ""} ${order.user.lastName || ""}`.trim()
        : null;

    const subject = `Your order ${order.id} has been cancelled`;

    const lines: string[] = [
      fullName ? `Hi ${fullName},` : "Hi,",
      "",
      "We wanted to let you know that your order has been cancelled by our team.",
      "",
      `Order ID: ${order.id}`,
      "",
      "If you weren't expecting this or you have any questions, please reply to this email and we'll be happy to help.",
      "",
      "Best regards,",
      "Customer Support",
    ];

    await safeSend({
      to: order.user.email,
      subject,
      text: lines.join("\n"),
      html: linesToEmailHtml(lines),
    });

    if (order.user.phone) {
      try {
        await sendWhatsApp(
          order.user.phone,
          `Your order ${order.id} has been cancelled. If you have any questions, please contact support.`
        );
      } catch (e) {
        console.error("[notifyCustomerOrderCancelled] WhatsApp failed", e);
      }
    }

    // Optional: In-app notification
    try {
      await notifyUser(
        order.user.id,
        {
          type: NotificationType.ORDER_CANCELED, // adjust if your enum differs
          title: "Order cancelled",
          body: `Order ${order.id} was cancelled by our team.`,
          data: { orderId: order.id },
        },
        db
      );
    } catch (e) {
      console.error("[notifyCustomerOrderCancelled] in-app notify failed", e);
    }

    // Optional: log activity item (if your schema supports it)
    try {
      await (db as any).orderActivity.create({
        data: {
          orderId: order.id,
          type: "CUSTOMER_NOTIFIED",
          message: "Customer notified about cancellation",
          meta: {
            channel: ["email", order.user.phone ? "whatsapp" : null].filter(Boolean),
          },
        },
      });
    } catch {
      // non-fatal
    }
  } catch (e) {
    console.error("[notifyCustomerOrderCancelled] failed", e);
  }
}
