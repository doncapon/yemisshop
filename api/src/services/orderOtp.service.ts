// api/src/services/orderOtp.service.ts
import crypto from "crypto";
import { sendOrderOtpNotifications } from "./otpNotify.service.js";

const OTP_EXPIRES_MINS = Number(process.env.ORDER_OTP_EXPIRES_MINS ?? 10);
const OTP_MAX_ATTEMPTS = Number(process.env.ORDER_OTP_MAX_ATTEMPTS ?? 5);
const OTP_LOCK_MINS = Number(process.env.ORDER_OTP_LOCK_MINS ?? 30);
const OTP_RESEND_COOLDOWN_SECS = Number(process.env.ORDER_OTP_RESEND_COOLDOWN_SECS ?? 60);

function now() {
  return new Date();
}
function addMinutes(d: Date, mins: number) {
  return new Date(d.getTime() + mins * 60_000);
}
function addSeconds(d: Date, secs: number) {
  return new Date(d.getTime() + secs * 1000);
}
function genOtp6() {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}
function hashOtp(code: string, salt: string) {
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

function normalizeE164(phone?: string | null) {
  if (!phone) return null;
  const p = String(phone).trim();
  if (!p) return null;
  if (p.startsWith("+")) return p;
  return p; // don't guess country here
}

function maskEmail(email: string) {
  return String(email).replace(/(^.).+(@.*$)/, "$1***$2");
}

function httpErr(message: string, status: number, extra?: any) {
  return Object.assign(new Error(message), { status, ...extra });
}

// ✅ your preferred error helper: includes code + status
function otpErr(code: string, message: string, status = 400, extra?: any) {
  return Object.assign(new Error(message), { code, status, ...extra });
}

export type OrderOtpPurpose = "PAY_ORDER" | "CANCEL_ORDER" | "REFUND_ORDER";

/**
 * Request OTP (creates a request row + sends notification best-effort)
 */
export async function requestOrderOtpForPurposeTx(
  tx: any,
  args: {
    orderId: string;
    purpose: OrderOtpPurpose;
    actorUserId: string;

    /**
     * Who should receive the OTP message?
     * - For supplier cancel OTP: ORDER_OWNER (customer)
     * - For pay-order OTP: ORDER_OWNER (customer)
     * - For admin ops: you can set ACTOR
     */
    notifyTo?: "ORDER_OWNER" | "ACTOR";
    brand?: string;
  }
) {
  const orderId = String(args.orderId);
  const purpose = args.purpose;
  const actorUserId = String(args.actorUserId);
  const notifyTo = args.notifyTo ?? "ORDER_OWNER";
  const brand = args.brand ?? "DaySpring";

  // Load order + user contact (customer)
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      user: { select: { email: true, phone: true } },
    },
  });

  if (!order) throw httpErr("Order not found", 404);

  // Cooldown: prevent spam if clicked twice
  const last = await tx.orderOtpRequest.findFirst({
    where: { orderId, purpose, userId: actorUserId },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, expiresAt: true },
  });

  if (last?.createdAt) {
    const nextAllowed = addSeconds(last.createdAt, OTP_RESEND_COOLDOWN_SECS);
    if (nextAllowed > now()) {
      throw httpErr("Please wait before requesting another OTP", 429, {
        code: "OTP_COOLDOWN",
        retryAt: nextAllowed.toISOString(),
        requestId: last.id,
        expiresAt: last.expiresAt?.toISOString?.() ?? null,
      });
    }
  }

  const code = genOtp6();
  const salt = crypto.randomUUID();
  const codeHash = hashOtp(code, salt);
  const issuedAt = now();
  const expiresAt = addMinutes(issuedAt, OTP_EXPIRES_MINS);

  // ✅ bind token to ACTOR (supplier/admin)
  const row = await tx.orderOtpRequest.create({
    data: {
      orderId,
      userId: actorUserId,
      purpose,
      salt,
      codeHash,
      expiresAt,
      attempts: 0,
      lockedUntil: null,
      verifiedAt: null,
      consumedAt: null,
    } as any,
    select: { id: true },
  });

  // Decide who receives the OTP notification
  const notifyEmail = notifyTo === "ORDER_OWNER" ? (order.user?.email ?? null) : null;
  const notifyPhone = notifyTo === "ORDER_OWNER" ? normalizeE164(order.user?.phone ?? null) : null;

  // Notify (best-effort)
  try {
    await sendOrderOtpNotifications({
      userEmail: notifyEmail,
      userPhoneE164: notifyPhone,
      code,
      expiresMins: OTP_EXPIRES_MINS,
      purposeLabel:
        purpose === "PAY_ORDER"
          ? "Pay order"
          : purpose === "CANCEL_ORDER"
          ? "Cancel order"
          : "Order verification",
      orderId,
      brand,
    });
  } catch (e) {
    console.error("sendOrderOtpNotifications failed:", e);
  }

  const channelHint =
    notifyPhone && notifyPhone.length >= 4
      ? `sms/whatsapp to ***${notifyPhone.slice(-4)}`
      : notifyEmail
      ? `email to ${maskEmail(notifyEmail)}`
      : "delivery channel unknown";

  return {
    requestId: row.id,
    expiresAt: expiresAt.toISOString(),
    expiresInSec: OTP_EXPIRES_MINS * 60,
    channelHint,
  };
}

/**
 * Verify OTP (returns otpToken when verified)
 *
 * NOTE:
 * You chose to treat common user errors as "soft" responses (status=200):
 * - expired, incorrect, locked
 * That’s fine as long as your route returns { ok:false, ... } for those.
 */
export async function verifyOrderOtpForPurposeTx(
  tx: any,
  args: {
    orderId: string;
    purpose: "PAY_ORDER" | "CANCEL_ORDER";
    code: string;
    actorUserId: string;
    requestId?: string;
  }
) {
  const orderId = String(args.orderId);
  const purpose = args.purpose;
  const actorUserId = String(args.actorUserId);
  const code = String(args.code).trim();
  const requestId = args.requestId ? String(args.requestId).trim() : null;

  if (!/^\d{6}$/.test(code)) {
    throw otpErr("OTP_FORMAT", "OTP must be a 6-digit code", 400);
  }

  const t = now();

  const row = await tx.orderOtpRequest.findFirst({
    where: {
      orderId,
      purpose,
      userId: actorUserId,
      ...(requestId ? { id: requestId } : {}),
      consumedAt: null,
    },
    orderBy: requestId ? undefined : { createdAt: "desc" },
    select: {
      id: true,
      salt: true,
      codeHash: true,
      expiresAt: true,
      verifiedAt: true,
      attempts: true,
      lockedUntil: true,
      consumedAt: true,
      createdAt: true,
    },
  });

  if (!row) {
    throw otpErr(
      "OTP_NOT_FOUND",
      requestId ? "OTP request not found" : "No active OTP found. Please request a new OTP.",
      404
    );
  }

  if (row.consumedAt) {
    throw otpErr("OTP_USED", "This OTP token has already been used. Please request a new OTP.", 400, {
      requestId: row.id,
    });
  }

  // ✅ locked -> soft fail (status 200)
  if (row.lockedUntil && row.lockedUntil > t) {
    throw otpErr("OTP_LOCKED", "Too many attempts. Please wait and try again.", 200, {
      requestId: row.id,
      attempts: Number(row.attempts ?? 0),
      remainingAttempts: 0,
      lockedUntil: row.lockedUntil.toISOString(),
    });
  }

  // Already verified -> return token (id)
  if (row.verifiedAt) {
    return { otpToken: row.id, requestId: row.id };
  }

  // ✅ Verify hash FIRST
  const attemptedHash = hashOtp(code, row.salt);

  let ok = false;
  try {
    const a = Buffer.from(attemptedHash, "hex");
    const b = Buffer.from(row.codeHash, "hex");
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    ok = false;
  }

  // Wrong OTP -> increment attempts, maybe lock, soft fail (status 200)
  if (!ok) {
    const nextAttempts = Number(row.attempts ?? 0) + 1;
    const remainingAttempts = Math.max(0, OTP_MAX_ATTEMPTS - nextAttempts);
    const lockedUntil = nextAttempts >= OTP_MAX_ATTEMPTS ? addMinutes(t, OTP_LOCK_MINS) : null;

    await tx.orderOtpRequest.update({
      where: { id: row.id },
      data: { attempts: nextAttempts, lockedUntil },
    });

    throw otpErr("OTP_INCORRECT", "Incorrect OTP. Please try again.", 200, {
      requestId: row.id,
      attempts: nextAttempts,
      remainingAttempts,
      lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
      expiresAt: row.expiresAt?.toISOString?.() ?? null,
    });
  }

  // ✅ NOW check expiry (only after code matches)
  if (row.expiresAt && row.expiresAt <= t) {
    throw otpErr("OTP_EXPIRED", "This OTP has expired. Please request a new one.", 200, {
      requestId: row.id,
      expiresAt: row.expiresAt.toISOString(),
    });
  }

  // Correct -> mark verified
  await tx.orderOtpRequest.update({
    where: { id: row.id },
    data: { verifiedAt: t, attempts: 0, lockedUntil: null },
  });

  return { otpToken: row.id, requestId: row.id };
}
