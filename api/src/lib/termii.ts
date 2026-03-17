import axios from "axios";

const NODE_ENV = process.env.NODE_ENV ?? "development";
const IS_DEV = NODE_ENV !== "production";

const TERMII_API_KEY = (process.env.TERMII_API_KEY || "").trim();
const TERMII_SENDER_ID = (process.env.TERMII_SENDER_ID || "DaySpring").trim();
const TERMII_BASE_URL = (
  process.env.TERMII_BASE_URL || "https://api.ng.termii.com/api"
).replace(/\/+$/, "");

// SMS channel: generic / dnd / whatsapp / etc.
// For OTP, dnd is usually safer for SMS.
const TERMII_SMS_CHANNEL = (process.env.TERMII_SMS_CHANNEL || "dnd").trim();

// If you want Termii WhatsApp
const TERMII_WHATSAPP_FROM = (process.env.TERMII_WHATSAPP_FROM || "").trim();

/**
 * LOG-ONLY controls
 *
 * TERMII_LOG_ONLY=true
 *   -> all Termii sends become logs only (works in any env, including production)
 *
 * TERMII_SMS_LOG_ONLY=true
 *   -> only SMS becomes log only
 *
 * TERMII_WHATSAPP_LOG_ONLY=true
 *   -> only WhatsApp becomes log only
 *
 * TERMII_FORCE_LIVE_IN_DEV=true
 *   -> allows actual sending in development if API key is present
 */
function envBool(name: string, defaultValue = false): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw);
}

const TERMII_LOG_ONLY = envBool("TERMII_LOG_ONLY", false);
const TERMII_SMS_LOG_ONLY = envBool("TERMII_SMS_LOG_ONLY", false);
const TERMII_WHATSAPP_LOG_ONLY = envBool("TERMII_WHATSAPP_LOG_ONLY", false);
const TERMII_FORCE_LIVE_IN_DEV = envBool("TERMII_FORCE_LIVE_IN_DEV", false);

function cleanString(input?: string | null): string {
  return String(input ?? "").trim();
}

export function normalizeToTermiiPhone(input?: string | null): string | null {
  const raw = cleanString(input);
  if (!raw) return null;

  const digits = raw.replace(/[^\d+]/g, "");

  // +2348012345678
  if (/^\+\d{8,15}$/.test(digits)) return digits;

  // 2348012345678
  if (/^234\d{7,14}$/.test(digits)) return `+${digits}`;

  // 08012345678
  if (/^0\d{10}$/.test(digits)) return `+234${digits.slice(1)}`;

  // 8012345678 -> assume NG local without leading zero
  if (/^[789]\d{9}$/.test(digits)) return `+234${digits}`;

  return null;
}

function assertTermiiConfigured() {
  if (!TERMII_API_KEY) {
    throw new Error("TERMII_API_KEY is not configured.");
  }
}

function devLog(label: string, payload: unknown) {
  console.log(`[termii][${label}][${NODE_ENV}]`, payload);
}

function shouldLogOnly(kind: "sms" | "whatsapp"): boolean {
  // Explicit global switch always wins
  if (TERMII_LOG_ONLY) return true;

  // Per-channel switches
  if (kind === "sms" && TERMII_SMS_LOG_ONLY) return true;
  if (kind === "whatsapp" && TERMII_WHATSAPP_LOG_ONLY) return true;

  // In development, default to log-only unless explicitly forcing live
  if (IS_DEV && !TERMII_FORCE_LIVE_IN_DEV) return true;

  // If no API key, we can only log
  if (!TERMII_API_KEY) return true;

  return false;
}

type SendSmsArgs = {
  to: string;
  message: string;
  channel?: string;
  from?: string;
};

export async function sendSmsViaTermii(args: SendSmsArgs) {
  const to = normalizeToTermiiPhone(args.to);
  if (!to) {
    throw new Error("Invalid phone number for Termii SMS.");
  }

  const payload = {
    to,
    from: args.from || TERMII_SENDER_ID,
    sms: args.message,
    type: "plain",
    channel: args.channel || TERMII_SMS_CHANNEL,
    api_key: TERMII_API_KEY,
  };

  if (shouldLogOnly("sms")) {
    devLog("sms-log-only", {
      ...payload,
      api_key: TERMII_API_KEY ? "***masked***" : "",
    });

    return {
      ok: true as const,
      provider: "termii",
      mode: "log-only" as const,
      to,
    };
  }

  assertTermiiConfigured();

  const { data } = await axios.post(`${TERMII_BASE_URL}/sms/send`, payload, {
    timeout: 15000,
    headers: { "Content-Type": "application/json" },
  });

  return {
    ok: true as const,
    provider: "termii",
    mode: "live" as const,
    to,
    data,
  };
}

type SendWhatsappArgs = {
  to: string;
  message: string;
  from?: string;
};

export async function sendWhatsappViaTermii(args: SendWhatsappArgs) {
  const to = normalizeToTermiiPhone(args.to);
  if (!to) {
    throw new Error("Invalid phone number for Termii WhatsApp.");
  }

  const from = cleanString(args.from || TERMII_WHATSAPP_FROM);

  if (!from && !shouldLogOnly("whatsapp")) {
    throw new Error("TERMII_WHATSAPP_FROM is not configured.");
  }

  // Termii WhatsApp payload can vary depending on account setup.
  const payload = {
    to,
    from,
    message: args.message,
    channel: "whatsapp",
    type: "plain",
    api_key: TERMII_API_KEY,
  };

  if (shouldLogOnly("whatsapp")) {
    devLog("whatsapp-log-only", {
      ...payload,
      api_key: TERMII_API_KEY ? "***masked***" : "",
    });

    return {
      ok: true as const,
      provider: "termii",
      mode: "log-only" as const,
      to,
    };
  }

  assertTermiiConfigured();

  const { data } = await axios.post(`${TERMII_BASE_URL}/sms/send`, payload, {
    timeout: 15000,
    headers: { "Content-Type": "application/json" },
  });

  return {
    ok: true as const,
    provider: "termii",
    mode: "live" as const,
    to,
    data,
  };
}

type OtpMeta = {
  brand?: string;
  expiresMins?: number;
  purposeLabel?: string;
};

function buildOtpMessage(code: string, meta: OtpMeta = {}) {
  const brand = meta.brand || "DaySpring";
  const expiresMins = Math.max(1, Number(meta.expiresMins ?? 10));
  const purpose = cleanString(meta.purposeLabel || "Verification");

  return `${brand} OTP for ${purpose}: ${code}. Expires in ${expiresMins} minutes. Do not share this code.`;
}

export async function sendOtpSmsViaTermii(args: {
  to: string;
  code: string;
  expiresMinutes?: number;
  brand?: string;
  purposeLabel?: string;
}) {
  const message = buildOtpMessage(args.code, {
    brand: args.brand,
    expiresMins: args.expiresMinutes,
    purposeLabel: args.purposeLabel,
  });

  return sendSmsViaTermii({
    to: args.to,
    message,
    channel: TERMII_SMS_CHANNEL || "dnd",
  });
}

export async function sendOtpWhatsappViaTermii(args: {
  to: string;
  code: string;
  expiresMinutes?: number;
  brand?: string;
  purposeLabel?: string;
}) {
  const message = buildOtpMessage(args.code, {
    brand: args.brand,
    expiresMins: args.expiresMinutes,
    purposeLabel: args.purposeLabel,
  });

  return sendWhatsappViaTermii({
    to: args.to,
    message,
  });
}