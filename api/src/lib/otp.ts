import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { sendOtpEmail } from "./email.js";
import {
  normalizeToTermiiPhone,
  sendOtpSmsViaTermii,
  sendOtpWhatsappViaTermii,
} from "./termii.js";

const OTP_TTL_MIN = Number(process.env.OTP_TTL_MIN || 10);
const OTP_LEN = Number(process.env.OTP_LEN || 6);
const MAX_PER_15M = Number(process.env.OTP_MAX_PER_15M || 3);
const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

const OTP_CONSOLE_ONLY =
  String(process.env.OTP_CONSOLE_ONLY || "").toLowerCase() === "true";

const NODE_ENV = String(process.env.NODE_ENV || "").toLowerCase();
const IS_DEV = NODE_ENV === "development" || !NODE_ENV;

type OtpChannel = "whatsapp" | "sms" | "email" | "console";

function genCode(len = OTP_LEN) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join("");
}

async function canSend(identifier: string) {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const sent = await prisma.otp.count({
    where: { identifier, createdAt: { gte: since } },
  });
  return sent < MAX_PER_15M;
}

type IssueOtpOpts = {
  identifier: string;
  userId?: string | null;
  phone?: string | null;
  whatsappPhone?: string | null;
  email?: string | null;
  channelPref?: OtpChannel;
  brand?: string;
  purposeLabel?: string;
  expiresMins?: number;
  orderId?: string;
};

function maskValue(v?: string | null) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (s.length <= 4) return s;
  return `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

function shouldConsoleOnly() {
  // Explicit kill switch wins
  if (OTP_CONSOLE_ONLY) return true;

  // In dev / pre-live, default to console mode unless explicitly forcing live
  const forceLiveInDev =
    String(process.env.TERMII_FORCE_LIVE_IN_DEV || "").toLowerCase() === "true";

  if (IS_DEV && !forceLiveInDev) return true;

  // Respect existing Termii log-only kill switches too
  const globalLogOnly =
    String(process.env.TERMII_LOG_ONLY || "").toLowerCase() === "true";
  const smsLogOnly =
    String(process.env.TERMII_SMS_LOG_ONLY || "").toLowerCase() === "true";
  const whatsappLogOnly =
    String(process.env.TERMII_WHATSAPP_LOG_ONLY || "").toLowerCase() === "true";

  return globalLogOnly || smsLogOnly || whatsappLogOnly;
}

export async function issueOtp(opts: IssueOtpOpts) {
  const {
    identifier,
    userId = null,
    phone,
    whatsappPhone,
    email,
    channelPref = "whatsapp",
    brand = "DaySpring",
    purposeLabel = "Verification",
    expiresMins = OTP_TTL_MIN,
    orderId,
  } = opts;
  console.log("[OTP LIB LOADED FROM FILE]", import.meta.url);

  console.log("[issueOtp ENTER]", {
    identifier: opts?.identifier,
    userId: opts?.userId,
    phone: opts?.phone,
    whatsappPhone: opts?.whatsappPhone,
    email: opts?.email,
    channelPref: opts?.channelPref,
    at: new Date().toISOString(),
  });

  if (!(await canSend(identifier))) {
    return { ok: false as const, error: "Too many OTP requests. Try again later." };
  }

  const code = genCode();
  const codeHash = await bcrypt.hash(code, 8);
  const expiresAt = new Date(Date.now() + expiresMins * 60 * 1000);

  const normalizedPhone = normalizeToTermiiPhone(phone);
  const normalizedWhatsappPhone = normalizeToTermiiPhone(whatsappPhone);

  const row = await prisma.otp.create({
    data: {
      identifier,
      userId,
      codeHash,
      expiresAt,
      attempts: 0,
      channel: channelPref.toUpperCase(),
    },
    select: { id: true },
  });

  const consoleOnly = shouldConsoleOnly();

  // Always log helpful debug info before delivery attempt
  console.log("[OTP/issueOtp] generated", {
    otpId: row.id,
    identifier,
    userId,
    purposeLabel,
    preferredChannel: channelPref,
    normalizedPhone: maskValue(normalizedPhone),
    normalizedWhatsappPhone: maskValue(normalizedWhatsappPhone),
    email: email ? maskValue(email) : null,
    expiresMins,
    consoleOnly,
    code, // keep visible pre-live
  });

  if (consoleOnly) {
    await prisma.otp.update({
      where: { id: row.id },
      data: { channel: "CONSOLE" },
    });

    console.log(
      `[OTP:CONSOLE_ONLY] ${purposeLabel} code for ${identifier}: ${code}`
    );

    return {
      ok: true as const,
      id: row.id,
      ttlMin: expiresMins,
      channel: "console" as const,
      code,
    };
  }

  const attempts: Array<{
    channel: OtpChannel;
    run: () => Promise<any>;
  }> = [];

  if (channelPref === "whatsapp") {
    if (normalizedWhatsappPhone) {
      attempts.push({
        channel: "whatsapp",
        run: () =>
          sendOtpWhatsappViaTermii({
            to: normalizedWhatsappPhone,
            code,
            expiresMinutes: expiresMins,
            brand,
            purposeLabel,
          }),
      });
    }

    if (normalizedPhone) {
      attempts.push({
        channel: "sms",
        run: () =>
          sendOtpSmsViaTermii({
            to: normalizedPhone,
            code,
            expiresMinutes: expiresMins,
            brand,
            purposeLabel,
          }),
      });
    }

    if (email) {
      attempts.push({
        channel: "email",
        run: () =>
          sendOtpEmail(email, code, {
            brand,
            expiresMins,
            purposeLabel,
            orderId,
          }),
      });
    }
  } else if (channelPref === "sms") {
    if (normalizedPhone) {
      attempts.push({
        channel: "sms",
        run: () =>
          sendOtpSmsViaTermii({
            to: normalizedPhone,
            code,
            expiresMinutes: expiresMins,
            brand,
            purposeLabel,
          }),
      });
    }

    if (normalizedWhatsappPhone) {
      attempts.push({
        channel: "whatsapp",
        run: () =>
          sendOtpWhatsappViaTermii({
            to: normalizedWhatsappPhone,
            code,
            expiresMinutes: expiresMins,
            brand,
            purposeLabel,
          }),
      });
    }

    if (email) {
      attempts.push({
        channel: "email",
        run: () =>
          sendOtpEmail(email, code, {
            brand,
            expiresMins,
            purposeLabel,
            orderId,
          }),
      });
    }
  } else {
    if (email) {
      attempts.push({
        channel: "email",
        run: () =>
          sendOtpEmail(email, code, {
            brand,
            expiresMins,
            purposeLabel,
            orderId,
          }),
      });
    }

    if (normalizedWhatsappPhone) {
      attempts.push({
        channel: "whatsapp",
        run: () =>
          sendOtpWhatsappViaTermii({
            to: normalizedWhatsappPhone,
            code,
            expiresMinutes: expiresMins,
            brand,
            purposeLabel,
          }),
      });
    }

    if (normalizedPhone) {
      attempts.push({
        channel: "sms",
        run: () =>
          sendOtpSmsViaTermii({
            to: normalizedPhone,
            code,
            expiresMinutes: expiresMins,
            brand,
            purposeLabel,
          }),
      });
    }
  }

  if (!attempts.length) {
    console.warn("[OTP/issueOtp] no valid delivery channel", {
      otpId: row.id,
      identifier,
      phone,
      whatsappPhone,
      email,
      normalizedPhone,
      normalizedWhatsappPhone,
    });

    return { ok: false as const, error: "No valid delivery channel found for OTP." };
  }

  let lastErr: string | undefined;

  for (const attempt of attempts) {
    try {
      console.log("[OTP/issueOtp] attempting delivery", {
        otpId: row.id,
        identifier,
        channel: attempt.channel,
      });

      await attempt.run();

      await prisma.otp.update({
        where: { id: row.id },
        data: { channel: attempt.channel.toUpperCase() },
      });

      console.log("[OTP/issueOtp] delivered", {
        otpId: row.id,
        identifier,
        channel: attempt.channel,
        code, // still log pre-live
      });

      return {
        ok: true as const,
        id: row.id,
        ttlMin: expiresMins,
        channel: attempt.channel,
        code,
      };
    } catch (err: any) {
      lastErr = String(err?.message || err || `Failed via ${attempt.channel}`);

      console.error("[OTP/issueOtp] delivery failed", {
        otpId: row.id,
        identifier,
        channel: attempt.channel,
        error: lastErr,
      });
    }
  }

  return {
    ok: false as const,
    error: lastErr || "Send failed",
  };
}

export async function verifyOtp(opts: { identifier: string; code: string }) {
  const { identifier, code } = opts;

  const row = await prisma.otp.findFirst({
    where: {
      identifier,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      codeHash: true,
      attempts: true,
    },
  });

  if (!row) {
    return { ok: false as const, error: "No active code. Please request a new one." };
  }

  if ((row.attempts ?? 0) >= MAX_ATTEMPTS) {
    return { ok: false as const, error: "Too many attempts" };
  }

  const good = await bcrypt.compare(code, row.codeHash);

  await prisma.otp.update({
    where: { id: row.id },
    data: {
      attempts: (row.attempts ?? 0) + 1,
      consumedAt: good ? new Date() : null,
    },
  });

  console.log("[OTP/verifyOtp]", {
    identifier,
    otpId: row.id,
    ok: good,
  });

  return good
    ? { ok: true as const }
    : { ok: false as const, error: "Invalid code" };
}