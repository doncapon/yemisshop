// api/src/lib/otp.ts
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { sendSmsOtp, sendWhatsappOtp } from './sms.js';

const OTP_TTL_MIN = Number(process.env.OTP_TTL_MIN || 10);
const OTP_LEN = Number(process.env.OTP_LEN || 6);
const MAX_PER_15M = Number(process.env.OTP_MAX_PER_15M || 3);
const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

function genCode(len = OTP_LEN) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join('');
}

/** Rate-limit sends per identifier (email/userId/etc.) */
async function canSend(identifier: string) {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const sent = await prisma.otp.count({
    where: { identifier, createdAt: { gte: since } },
  });
  return sent < MAX_PER_15M;
}

/**
 * Issue an OTP and send via WhatsApp (default) with SMS fallback.
 * IMPORTANT: `identifier` must be the SAME value you’ll verify with later (e.g. userId).
 */
export async function issueOtp(opts: {
  identifier: string;
  userId?: string | null;
  phoneE164?: string;                 // "+2348…"
  channelPref?: 'whatsapp' | 'sms' | 'email';
}) {
  const { identifier, userId = null, phoneE164, channelPref = 'whatsapp' } = opts;

  if (!(await canSend(identifier))) {
    return { ok: false as const, error: 'Too many OTP requests. Try again later.' };
  }

  const code = genCode();
  const codeHash = await bcrypt.hash(code, 8);
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

  // 🔐 Store ONLY the hash. Do not store raw code.
  const row = await prisma.otp.create({
    data: {
      identifier,
      userId,
      codeHash,
      expiresAt,
      attempts: 0,
      channel: channelPref.toUpperCase(),
      // consumedAt left null until successfully verified
    },
    select: { id: true },
  });

  // Try WA → fallback to SMS
  let sent = false;
  let lastErr: string | undefined;

  if (channelPref === 'whatsapp' && phoneE164) {
    const wa = await sendWhatsappOtp(phoneE164, code);
    sent = wa.ok;
    if (!wa.ok) lastErr = wa.error;
  }

  if (!sent && phoneE164) {
    const sms = await sendSmsOtp(
      phoneE164,
      `Your DaySpring code is ${code} . Expires in ${OTP_TTL_MIN} minute(s).`
    );
    sent = sms?.ok === true;
    if (!sms?.ok) lastErr = 'SMS failed';
  }

  return sent
    ? { ok: true as const, id: row.id, ttlMin: OTP_TTL_MIN }
    : { ok: false as const, error: lastErr || 'Send failed' };
}

/**
 * Verify an OTP code (by the SAME identifier you used in issueOtp).
 */
export async function verifyOtp(opts: { identifier: string; code: string }) {
  const { identifier, code } = opts;

  // Latest unconsumed, unexpired OTP for this identifier
  const row = await prisma.otp.findFirst({
    where: {
      identifier,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, codeHash: true, attempts: true },
  });

  if (!row) return { ok: false as const, error: 'No active code. Please request a new one.' };
  if ((row.attempts ?? 0) >= MAX_ATTEMPTS) return { ok: false as const, error: 'Too many attempts' };

  const good = await bcrypt.compare(code, row.codeHash);

  // Always bump attempts
  await prisma.otp.update({
    where: { id: row.id },
    data: {
      attempts: (row.attempts ?? 0) + 1,
      consumedAt: good ? new Date() : null,
    },
  });

  return good ? { ok: true as const } : { ok: false as const, error: 'Invalid code' };
}
