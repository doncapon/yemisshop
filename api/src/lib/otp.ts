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

type OtpChannel = "whatsapp" | "sms" | "email";

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
    return { ok: false as const, error: "No valid delivery channel found for OTP." };
  }

  let lastErr: string | undefined;

  for (const attempt of attempts) {
    try {
      await attempt.run();

      await prisma.otp.update({
        where: { id: row.id },
        data: { channel: attempt.channel.toUpperCase() },
      });

      return {
        ok: true as const,
        id: row.id,
        ttlMin: expiresMins,
        channel: attempt.channel,
      };
    } catch (err: any) {
      lastErr = String(err?.message || err || `Failed via ${attempt.channel}`);
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

  return good
    ? { ok: true as const }
    : { ok: false as const, error: "Invalid code" };
}