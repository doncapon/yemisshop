// src/routes/orderOtp.ts
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { sendOrderOtpNotifications } from "../services/otpNotify.service.js";

const router = Router();

const OtpPurpose = z.enum(["CANCEL_ORDER", "PAY_ORDER"]);

const OTP_LEN = 6;
const OTP_EXPIRES_SECS = 300; // 5 mins
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCK_MINS = 30;
const OTP_RESEND_COOLDOWN_SECS = 60;

function now() {
  return new Date();
}
function addSeconds(d: Date, secs: number) {
  return new Date(d.getTime() + secs * 1000);
}
function addMinutes(d: Date, mins: number) {
  return new Date(d.getTime() + mins * 60_000);
}
function genOtp6() {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(OTP_LEN, "0");
}
function hashOtp(code: string, salt: string) {
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}
function normalizeE164(phone?: string | null) {
  if (!phone) return null;
  const p = phone.trim();
  if (!p) return null;
  if (p.startsWith("+")) return p;
  return p;
}
function isAdminRole(role?: string) {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/**
 * POST /api/orders/:orderId/otp/request
 * body: { purpose: "CANCEL_ORDER" | "PAY_ORDER" }
 * returns: { requestId, expiresInSec, channelHint }
 */
router.post("/:orderId/otp/request", requireAuth, async (req: Request, res: Response) => {
  const orderId = String(req.params.orderId);
  const actorId = (req as any).user?.id as string | undefined;

  const parsed = OtpPurpose.safeParse(req.body?.purpose);
  if (!parsed.success) return res.status(400).json({ error: "Invalid purpose" });
  const purpose = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      status: true,
      user: { select: { email: true, phone: true } },
    },
  });
  if (!order) return res.status(404).json({ error: "Order not found" });

  // Auth rules:
  // - PAY_ORDER: only the customer who owns the order
  // - CANCEL_ORDER: admin/super admin
  if (purpose === "PAY_ORDER") {
    if (!actorId || String(order.userId) !== String(actorId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  } else {
    if (!isAdminRole((req as any).user?.role)) {
      return res.status(403).json({ error: "Admins only" });
    }
  }

  const t = now();

  // Cooldown: block spamming new OTPs for same order+purpose
  const last = await prisma.orderOtpRequest.findFirst({
    where: { orderId, purpose },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last?.createdAt) {
    const nextAllowed = addSeconds(last.createdAt, OTP_RESEND_COOLDOWN_SECS);
    if (nextAllowed > t) {
      return res.status(429).json({ error: "Please wait before requesting another OTP", retryAt: nextAllowed });
    }
  }

  const code = genOtp6();
  const salt = crypto.randomUUID();
  const codeHash = hashOtp(code, salt);
  const expiresAt = addSeconds(t, OTP_EXPIRES_SECS);

  const row = await prisma.orderOtpRequest.create({
    data: {
      orderId,
      userId: String(order.userId), // bind request to the customer (still ok for admin cancel)
      purpose,
      salt,
      codeHash,
      expiresAt,
    },
    select: { id: true, expiresAt: true },
  });

  // Notify best-effort
  const toEmail = order.user?.email ?? null;
  const toE164 = normalizeE164(order.user?.phone ?? null);

  try {
    await sendOrderOtpNotifications({
      userEmail: toEmail,
      userPhoneE164: toE164,
      code,
      expiresMins: Math.ceil(OTP_EXPIRES_SECS / 60),
      purposeLabel: purpose === "PAY_ORDER" ? "Pay order" : "Cancel order",
      orderId: order.id,
      brand: "DaySpring",
    });
  } catch (e) {
    console.error("sendOrderOtpNotifications failed:", e);
  }

  const channelHint =
    toE164 && toE164.length >= 4
      ? `sms/whatsapp to ***${toE164.slice(-4)}`
      : toEmail
        ? `email to ${String(toEmail).replace(/(^.).+(@.*$)/, "$1***$2")}`
        : null;

  return res.json({
    ok: true,
    requestId: row.id,
    expiresInSec: OTP_EXPIRES_SECS,
    channelHint,
  });
});

/**
 * POST /api/orders/:orderId/otp/verify
 * body: { purpose, requestId, otp }
 * returns: { token }
 *
 * Token == requestId (verified). Pass it later in header: x-otp-token
 */
router.post("/:orderId/otp/verify", requireAuth, async (req: Request, res: Response) => {
  const orderId = String(req.params.orderId);

  const parsed = OtpPurpose.safeParse(req.body?.purpose);
  if (!parsed.success) return res.status(400).json({ error: "Invalid purpose" });
  const purpose = parsed.data;

  const requestId = String(req.body?.requestId ?? "").trim();
  const otp = String(req.body?.otp ?? "").trim();

  if (!requestId) return res.status(400).json({ error: "Missing requestId" });
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: "Invalid otp format" });

  const row = await prisma.orderOtpRequest.findFirst({
    where: { id: requestId, orderId, purpose },
  });
  if (!row) return res.status(404).json({ error: "OTP request not found" });

  const t = now();

  if (row.verifiedAt) return res.json({ ok: true, token: row.id, alreadyVerified: true });

  if (row.lockedUntil && row.lockedUntil > t) {
    return res.status(429).json({ error: "OTP verification temporarily locked", lockedUntil: row.lockedUntil });
  }

  if (row.expiresAt <= t) return res.status(400).json({ error: "OTP expired" });

  const attemptedHash = hashOtp(otp, row.salt);
  const a = Buffer.from(attemptedHash, "hex");
  const b = Buffer.from(row.codeHash, "hex");
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    const nextAttempts = (row.attempts ?? 0) + 1;
    const lockedUntil = nextAttempts >= OTP_MAX_ATTEMPTS ? addMinutes(t, OTP_LOCK_MINS) : null;

    await prisma.orderOtpRequest.update({
      where: { id: row.id },
      data: { attempts: nextAttempts, lockedUntil },
    });

    return res.status(400).json({ error: "Incorrect OTP", attempts: nextAttempts, lockedUntil });
  }

  await prisma.orderOtpRequest.update({
    where: { id: row.id },
    data: { verifiedAt: t, attempts: 0, lockedUntil: null },
  });

  return res.json({ ok: true, token: row.id });
});

export default router;
