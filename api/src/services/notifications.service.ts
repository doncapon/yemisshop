// api/src/services/notifications.service.ts
import { safeSend } from "../lib/email.js";
import { prisma } from "../lib/prisma.js";
import { Prisma, NotificationType } from "@prisma/client";
import { sendWhatsApp } from "../lib/sms.js";

type NotificationPayload = {
  type: NotificationType;   // 👈 strongly typed
  title: string;
  body: string;
  data?: any;
};

export async function notifyUser(
  userId: string | null | undefined,
  payload: NotificationPayload,
  tx?: Prisma.TransactionClient       // 👈 optional, but very handy
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
  tx?: Prisma.TransactionClient
) {
  const db = tx ?? prisma;

  const ids = Array.from(
    new Set(
      (userIds || [])
        .map((id) => (id ? String(id) : ""))
        .filter(Boolean)
    )
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


/**
 * Convenience: notify all admins + super admins.
 */
export async function notifyAdmins(
  payload: NotificationPayload,
  tx?: Prisma.TransactionClient
) {
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

/**
 * Convenience: notify the user account linked to a supplier.
 */
export async function notifySupplierBySupplierId(
  supplierId: string,
  payload: NotificationPayload,
  tx?: Prisma.TransactionClient
) {
  const db = tx ?? prisma;

  const supplier = await db.supplier.findUnique({
    where: { id: supplierId },
    select: { userId: true },
  });

  if (!supplier?.userId) return;

  await notifyUser(supplier.userId, payload, db);
}


/**
 * Helper: format a short human-friendly order ref
 */
function formatOrderLabel(order: any, payment?: any) {
  // If you store a nice ref somewhere, use that instead
  if (payment?.reference) return `Payment ref ${payment.reference}`;
  return `Order ${order.id}`;
}

/**
 * Notify the customer that their order has been fully refunded.
 * Called from adminOrders refund endpoint after DB state is already updated.
 */
export async function notifyCustomerOrderRefunded(orderId:any, paymentId:any) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
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

    if (!order || !order.user?.email) {
      console.warn("[notifyCustomerOrderRefunded] no order/user email", { orderId });
      return;
    }

    const payment =
      paymentId &&
      order.payments?.find((p:any) => String(p.id) === String(paymentId)) ||
      order.payments?.[0] ||
      null;

    const label = formatOrderLabel(order, payment);
    const amount = Number(payment?.amount ?? order.total ?? 0);

    const fullName =
      (order.user.firstName || order.user.lastName)
        ? `${order.user.firstName || ""} ${order.user.lastName || ""}`.trim()
        : null;

    const subject = `Your ${label} has been refunded`;
    const plainText = [
      fullName ? `Hi ${fullName},` : "Hi,",
      "",
      "Your refund has been processed successfully.",
      "",
      label ? `• ${label}` : null,
      amount ? `• Amount: ₦${amount.toLocaleString("en-NG", { maximumFractionDigits: 2 })}` : null,
      payment?.paidAt ? `• Original payment date: ${new Date(payment.paidAt).toLocaleString()}` : null,
      "",
      "Depending on your bank, it may take a few working days for the refund to appear in your account.",
      "",
      "If you have any questions, simply reply to this email.",
      "",
      "Best regards,",
      "Customer Support",
    ]
      .filter(Boolean)
      .join("\n");

    const html = plainText
      .split("\n")
      .map((line) => (line === "" ? "<br/>" : `<p>${line}</p>`))
      .join("");

    await safeSend({
      to: order.user.email,
      subject,
      text: plainText,
      html,
    });

    // Optional: WhatsApp notification if you store phone numbers and have integration wired
    if (order.user.phone) {
      try {
        await sendWhatsApp(order.user.phone, 
          `Your ${label} has been refunded. Amount: ₦${amount.toLocaleString("en-NG", {
            maximumFractionDigits: 2,
          })}.`
        );
      } catch (e) {
        console.error("[notifyCustomerOrderRefunded] WhatsApp failed", e);
      }
    }

    // Optional: log an activity item (if you want)
    try {
      await prisma.orderActivity.create({
        data: {
          orderId,
          type: "CUSTOMER_NOTIFIED" as any,
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

/**
 * Notify the customer that their order has been cancelled by admin
 */
export async function notifyCustomerOrderCancelled(orderId: any) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } },
      },
    });

    if (!order || !order.user?.email) {
      console.warn("[notifyCustomerOrderCancelled] no order/user email", { orderId });
      return;
    }

    const fullName =
      (order.user.firstName || order.user.lastName)
        ? `${order.user.firstName || ""} ${order.user.lastName || ""}`.trim()
        : null;

    const subject = `Your order ${order.id} has been cancelled`;
    const plainText = [
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
    ].join("\n");

    const html = plainText
      .split("\n")
      .map((line) => (line === "" ? "<br/>" : `<p>${line}</p>`))
      .join("");

    await safeSend({
      to: order.user.email,
      subject,
      text: plainText,
      html,
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

    try {
      await prisma.orderActivity.create({
        data: {
          orderId,
          type: "CUSTOMER_NOTIFIED" as any,
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
