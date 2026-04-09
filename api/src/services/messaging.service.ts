// api/src/services/messaging.service.ts
import { sendSmsViaTermii } from "../lib/termii.js";
import {
  sendMail,
  sendCustomerOrderCreatedEmail,
  sendCustomerOrderPaidEmail,
  sendCustomerOrderShippedEmail,
  sendCustomerOrderDeliveredEmail,
} from "../lib/email.js";

type Channel = "whatsapp" | "sms" | "email";

type SendMessageArgs = {
  toPhone?: string | null;
  toWhatsapp?: string | null;
  toEmail?: string | null;

  message: string;
  subject?: string;

  purpose?:
    | "OTP"
    | "ORDER_CREATED"
    | "ORDER_PAID"
    | "ORDER_SHIPPED"
    | "ORDER_DELIVERED"
    | "GENERAL";

  // Optional rich context for HTML email templates
  emailContext?: {
    customerName?: string;
    orderId?: string;
    orderRef?: string;
    totalAmount?: number;
    currency?: string;
    orderUrl?: string;
    trackingInfo?: string;
  };

  preferChannel?: Channel;
  allowFallback?: boolean;
};

type SendMessageResult = {
  ok: boolean;
  channel: Channel | null;
  attempted: Channel[];
  provider: string | null;
  error?: string | null;
  data?: any;
};

const WHATSAPP_ENABLED = String(process.env.TERMII_WHATSAPP_ENABLED ?? "")
  .trim()
  .toLowerCase() === "true";

const SMS_ENABLED = String(process.env.TERMII_SMS_ENABLED ?? "true")
  .trim()
  .toLowerCase() !== "false";

function clean(input?: string | null) {
  return String(input ?? "").trim();
}

function normalizePhoneLoose(input?: string | null) {
  const raw = clean(input);
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");

  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^234\d{10}$/.test(digits)) return `+${digits}`;
  if (/^0\d{10}$/.test(digits)) return `+234${digits.slice(1)}`;

  return null;
}

// Placeholder until you finish Termii WhatsApp endpoint wiring
async function sendWhatsappViaTermii(args: { to: string; message: string }) {
  const to = normalizePhoneLoose(args.to);
  if (!to) throw new Error("Invalid WhatsApp phone number.");

  if (!WHATSAPP_ENABLED) {
    throw new Error("Termii WhatsApp is not enabled.");
  }

  // Replace this block with your real Termii WhatsApp endpoint call.
  // Example shape only:
  //
  // const { data } = await axios.post(`${TERMII_BASE_URL}/whatsapp/send`, {
  //   to,
  //   message: args.message,
  //   api_key: TERMII_API_KEY,
  // });
  //
  // return data;

  throw new Error("sendWhatsappViaTermii is not implemented yet.");
}

async function sendEmailFallback(args: {
  to: string;
  subject: string;
  message: string;
  purpose?: SendMessageArgs["purpose"];
  emailContext?: SendMessageArgs["emailContext"];
}) {
  const { to, subject, message, purpose, emailContext } = args;

  // For order lifecycle events with rich context, send branded HTML emails
  if (emailContext?.orderId) {
    const base = { to, ...emailContext, orderId: emailContext.orderId };
    if (purpose === "ORDER_CREATED")   return sendCustomerOrderCreatedEmail(base);
    if (purpose === "ORDER_PAID")      return sendCustomerOrderPaidEmail(base);
    if (purpose === "ORDER_SHIPPED")   return sendCustomerOrderShippedEmail(base);
    if (purpose === "ORDER_DELIVERED") return sendCustomerOrderDeliveredEmail(base);
  }

  // Generic fallback: plain message wrapped in minimal HTML
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#111;max-width:560px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#4f46e5,#a21caf);border-radius:14px 14px 0 0;padding:16px 20px">
        <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700">DaySpring</h1>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:20px">
        <p style="margin:0;white-space:pre-wrap">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
        <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb" />
        <p style="margin:0;font-size:12px;color:#9ca3af">DaySpring House — <a href="${process.env.APP_URL || "https://dayspringhouse.com"}" style="color:#4f46e5">dayspringhouse.com</a></p>
      </div>
    </div>
  `.trim();

  return sendMail({ to, subject, html, text: message });
}

function buildChannelOrder(args: SendMessageArgs): Channel[] {
  const preferred = args.preferChannel ?? "whatsapp";

  if (preferred === "sms") return ["sms", "whatsapp", "email"];
  if (preferred === "email") return ["email", "whatsapp", "sms"];
  return ["whatsapp", "sms", "email"];
}

export async function sendMessageWithFallback(
  args: SendMessageArgs
): Promise<SendMessageResult> {
  const attempted: Channel[] = [];
  const allowFallback = args.allowFallback !== false;
  const channels = buildChannelOrder(args);

  const whatsappTo = normalizePhoneLoose(args.toWhatsapp || args.toPhone);
  const smsTo = normalizePhoneLoose(args.toPhone || args.toWhatsapp);
  const emailTo = clean(args.toEmail);

  for (const channel of channels) {
    try {
      attempted.push(channel);

      if (channel === "whatsapp") {
        if (!whatsappTo) throw new Error("No WhatsApp number available.");

        const data = await sendWhatsappViaTermii({
          to: whatsappTo,
          message: args.message,
        });

        return {
          ok: true,
          channel,
          attempted,
          provider: "termii",
          data,
        };
      }

      if (channel === "sms") {
        if (!SMS_ENABLED) throw new Error("SMS is disabled.");
        if (!smsTo) throw new Error("No SMS phone number available.");

        const data = await sendSmsViaTermii({
          to: smsTo,
          message: args.message,
        });

        return {
          ok: true,
          channel,
          attempted,
          provider: "termii",
          data,
        };
      }

      if (channel === "email") {
        if (!emailTo) throw new Error("No email available.");

        const data = await sendEmailFallback({
          to: emailTo,
          subject: args.subject || "DaySpring notification",
          message: args.message,
          purpose: args.purpose,
          emailContext: args.emailContext,
        });

        return {
          ok: true,
          channel,
          attempted,
          provider: "email",
          data,
        };
      }
    } catch (err: any) {
      if (!allowFallback) {
        return {
          ok: false,
          channel,
          attempted,
          provider: channel === "email" ? "email" : "termii",
          error: err?.message || "Send failed",
        };
      }
    }
  }

  return {
    ok: false,
    channel: null,
    attempted,
    provider: null,
    error: "All delivery channels failed.",
  };
}

/* ---------------- OTP helpers ---------------- */

export async function sendOtpMessage(args: {
  code: string;
  expiresMinutes?: number;
  toPhone?: string | null;
  toWhatsapp?: string | null;
  toEmail?: string | null;
  preferChannel?: Channel;
  brand?: string;
}) {
  const brand = clean(args.brand) || "DaySpring";
  const expiresMinutes = Number(args.expiresMinutes ?? 10);

  const message = `${brand} OTP: ${args.code}. Expires in ${expiresMinutes} minutes. Do not share this code.`;

  return sendMessageWithFallback({
    toPhone: args.toPhone,
    toWhatsapp: args.toWhatsapp,
    toEmail: args.toEmail,
    subject: `${brand} OTP`,
    message,
    purpose: "OTP",
    preferChannel: args.preferChannel ?? "whatsapp",
    allowFallback: true,
  });
}

/* ---------------- Order notification helpers ---------------- */

export async function sendOrderCreatedMessage(args: {
  orderId: string;
  orderRef?: string;
  customerName?: string;
  totalAmount?: number;
  currency?: string;
  toPhone?: string | null;
  toWhatsapp?: string | null;
  toEmail?: string | null;
  preferChannel?: Channel;
}) {
  const ref = args.orderRef || args.orderId;
  const message = `Your DaySpring order ${ref} has been placed successfully. We'll notify you when it's on its way.`;
  return sendMessageWithFallback({
    toPhone: args.toPhone,
    toWhatsapp: args.toWhatsapp,
    toEmail: args.toEmail,
    preferChannel: args.preferChannel,
    subject: "Order confirmed",
    message,
    purpose: "ORDER_CREATED",
    allowFallback: true,
    emailContext: {
      customerName: args.customerName,
      orderId: args.orderId,
      orderRef: args.orderRef,
      totalAmount: args.totalAmount,
      currency: args.currency,
      orderUrl: `${process.env.APP_URL || "https://dayspringhouse.com"}/orders`,
    },
  });
}

export async function sendOrderPaidMessage(args: {
  orderId: string;
  orderRef?: string;
  customerName?: string;
  totalAmount?: number;
  currency?: string;
  toPhone?: string | null;
  toWhatsapp?: string | null;
  toEmail?: string | null;
  preferChannel?: Channel;
}) {
  const ref = args.orderRef || args.orderId;
  const message = `Payment received for your DaySpring order ${ref}.`;
  return sendMessageWithFallback({
    toPhone: args.toPhone,
    toWhatsapp: args.toWhatsapp,
    toEmail: args.toEmail,
    preferChannel: args.preferChannel,
    subject: "Payment received",
    message,
    purpose: "ORDER_PAID",
    allowFallback: true,
    emailContext: {
      customerName: args.customerName,
      orderId: args.orderId,
      orderRef: args.orderRef,
      totalAmount: args.totalAmount,
      currency: args.currency,
      orderUrl: `${process.env.APP_URL || "https://dayspringhouse.com"}/orders`,
    },
  });
}

export async function sendOrderShippedMessage(args: {
  orderId: string;
  orderRef?: string;
  customerName?: string;
  trackingInfo?: string;
  toPhone?: string | null;
  toWhatsapp?: string | null;
  toEmail?: string | null;
  preferChannel?: Channel;
}) {
  const ref = args.orderRef || args.orderId;
  const message = `Your DaySpring order ${ref} has been shipped and is on its way.${args.trackingInfo ? ` Tracking: ${args.trackingInfo}` : ""}`;
  return sendMessageWithFallback({
    toPhone: args.toPhone,
    toWhatsapp: args.toWhatsapp,
    toEmail: args.toEmail,
    preferChannel: args.preferChannel,
    subject: "Your order is on its way",
    message,
    purpose: "ORDER_SHIPPED",
    allowFallback: true,
    emailContext: {
      customerName: args.customerName,
      orderId: args.orderId,
      orderRef: args.orderRef,
      trackingInfo: args.trackingInfo,
      orderUrl: `${process.env.APP_URL || "https://dayspringhouse.com"}/orders`,
    },
  });
}

export async function sendOrderDeliveredMessage(args: {
  orderId: string;
  orderRef?: string;
  customerName?: string;
  toPhone?: string | null;
  toWhatsapp?: string | null;
  toEmail?: string | null;
  preferChannel?: Channel;
}) {
  const ref = args.orderRef || args.orderId;
  const message = `Your DaySpring order ${ref} has been delivered. We hope you love it!`;
  return sendMessageWithFallback({
    toPhone: args.toPhone,
    toWhatsapp: args.toWhatsapp,
    toEmail: args.toEmail,
    preferChannel: args.preferChannel,
    subject: "Order delivered",
    message,
    purpose: "ORDER_DELIVERED",
    allowFallback: true,
    emailContext: {
      customerName: args.customerName,
      orderId: args.orderId,
      orderRef: args.orderRef,
      orderUrl: `${process.env.APP_URL || "https://dayspringhouse.com"}/orders`,
    },
  });
}