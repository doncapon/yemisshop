// api/src/services/messaging.service.ts
import { sendSmsViaTermii } from "../lib/termii.js";

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

// Optional placeholder for later
async function sendEmailFallback(_args: {
  to: string;
  subject: string;
  message: string;
}) {
  throw new Error("Email fallback is not implemented yet.");
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
  toPhone?: string | null;
  toWhatsapp?: string | null;
  toEmail?: string | null;
  preferChannel?: Channel;
}) {
  const message = `Your DaySpring order ${args.orderId} has been created successfully.`;
  return sendMessageWithFallback({
    ...args,
    subject: "Order created",
    message,
    purpose: "ORDER_CREATED",
    allowFallback: true,
  });
}

export async function sendOrderPaidMessage(args: {
  orderId: string;
  toPhone?: string | null;
  toWhatsapp?: string | null;
  toEmail?: string | null;
  preferChannel?: Channel;
}) {
  const message = `Payment received for your DaySpring order ${args.orderId}.`;
  return sendMessageWithFallback({
    ...args,
    subject: "Payment received",
    message,
    purpose: "ORDER_PAID",
    allowFallback: true,
  });
}

export async function sendOrderShippedMessage(args: {
  orderId: string;
  toPhone?: string | null;
  toWhatsapp?: string | null;
  toEmail?: string | null;
  preferChannel?: Channel;
}) {
  const message = `Your DaySpring order ${args.orderId} has been shipped.`;
  return sendMessageWithFallback({
    ...args,
    subject: "Order shipped",
    message,
    purpose: "ORDER_SHIPPED",
    allowFallback: true,
  });
}

export async function sendOrderDeliveredMessage(args: {
  orderId: string;
  toPhone?: string | null;
  toWhatsapp?: string | null;
  toEmail?: string | null;
  preferChannel?: Channel;
}) {
  const message = `Your DaySpring order ${args.orderId} has been delivered.`;
  return sendMessageWithFallback({
    ...args,
    subject: "Order delivered",
    message,
    purpose: "ORDER_DELIVERED",
    allowFallback: true,
  });
}