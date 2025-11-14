// api/src/routes/auth.ts
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import { prisma } from '../lib/prisma.js';
import { sendVerifyEmail, sendResetorForgotPasswordEmail } from '../lib/email.js';
import { signJwt, signAccessJwt } from '../lib/jwt.js';
import { requireAuth } from '../middleware/auth.js';
import { issueOtp, verifyOtp } from '../lib/otp.js';

// ---------------- ENV / constants ----------------
const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const API_BASE_URL = process.env.API_URL || 'http://localhost:4000';
const EMAIL_JWT_SECRET = process.env.EMAIL_JWT_SECRET || 'CHANGE_ME_DEV_SECRET';

const EMAIL_RESEND_COOLDOWN_SEC = 60;
const EMAIL_DAILY_CAP = 5;
const EMAIL_TTL_MIN = 60;

const RESEND_COOLDOWN_SEC = 60;
const DAILY_CAP = 50;

// ---------------- Schemas ----------------
const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  middleName: z.string().optional(),
  lastName: z.string().min(1),
  role: z.string().default('SHOPPER'),
  dialCode: z.string().optional(),   // e.g. "+234" or "234"
  localPhone: z.string().optional(), // e.g. "8012345678"
  dateOfBirth: z
    .string()
    .transform((s) => new Date(s))
    .refine((d) => !Number.isNaN(+d), { message: 'Invalid date of birth' })
    .refine((d) => {
      const today = new Date();
      const years = (today.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
      return years >= 18;
    }, { message: 'You must be at least 18 years old' }),
});

const VerifyPhoneSchema = z.object({
  email: z.string().email(),
  otp: z.string().min(4).max(8),
});

const ForgotSchema = z.object({ email: z.string().email() });
const ResetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8),
});

const router = Router();

/** Issue a JWT email-verify link and send it via the central mail helper */
async function issueAndEmailEmailVerification(userId: string, email: string) {
  const token = jwt.sign({ sub: userId, email, k: 'email-verify' }, EMAIL_JWT_SECRET, { expiresIn: '60m' });
  const verifyUrl = `${API_BASE_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await sendVerifyEmail(email, verifyUrl);
}

// ---------------- helpers ----------------
const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler =>
    (req, res, next) => { fn(req, res, next).catch(next); };

function toE164(dialCode?: string, local?: string): string | null {
  if (!dialCode || !local) return null;
  const dc = dialCode.startsWith('+') ? dialCode : `+${dialCode}`;
  return `${dc}${local}`.replace(/\s+/g, '');
}

// ---------------- LOGIN ----------------
/** Allow login regardless of verify state; client can prompt to verify after */
router.post('/login', wrap(async (req, res) => {
  const { email, password } = (req.body || {}) as { email?: string; password?: string };
  if (!email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.password || '');
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const profile = {
    id: user.id,
    email: user.email,
    role: user.role as any,
    firstName: user.firstName,
    lastName: user.lastName,
    emailVerified: !!user.emailVerifiedAt,
    phoneVerified: !!user.phoneVerifiedAt,
  };

  const token = signAccessJwt({ id: user.id, email: user.email, role: user.role }, '7d');

  return res.json({
    token,
    profile,
    needsVerification: !(profile.emailVerified && profile.phoneVerified),
  });
}));

// ---------------- ME ----------------
router.get('/me', requireAuth, wrap(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, role: true,
      firstName: true, middleName: true, lastName: true,
      status: true, phone: true,
      emailVerifiedAt: true, phoneVerifiedAt: true,
      joinedAt: true,
      address: true, shippingAddress: true,
    },
  });

  if (!u) return res.status(404).json({ error: 'User not found' });

  res.json({
    id: u.id,
    email: u.email,
    role: u.role,
    status: u.status ?? 'PENDING',
    firstName: u.firstName,
    middleName: u.middleName,
    lastName: u.lastName,
    phone: u.phone,
    joinedAt: u.joinedAt,
    emailVerified: Boolean(u.emailVerifiedAt),
    phoneVerified: Boolean(u.phoneVerifiedAt),
    address: u.address,
    shippingAddress: (u as any).shippingAddress ?? null,
  });
}));

// ---------------- PUBLIC helpers for VerifyEmail page ----------------
router.get('/email-status', async (req, res) => {
  const email = String(req.query.email ?? '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email is required' });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true, firstName: true, lastName: true },
  });

  if (!user) return res.status(404).json({ error: 'No account for this email' });

  return res.json({
    id: user.id,
    email,
    emailVerifiedAt: user.emailVerifiedAt,
    firstName: user.firstName,
    lastName: user.lastName,
  });
});

// ---------------- PUBLIC resend verification email (JWT link) ----------------
router.post('/resend-verification', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email is required' });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true, emailVerifyLastSentAt: true, emailVerifySendCountDay: true },
  });
  if (!user) return res.status(404).json({ error: 'No account for this email' });
  if (user.emailVerifiedAt) {
    return res.json({ ok: true, nextResendAfterSec: EMAIL_RESEND_COOLDOWN_SEC, expiresInSec: 0 });
  }

  const now = new Date();
  const last = user.emailVerifyLastSentAt ? +user.emailVerifyLastSentAt : 0;
  const since = Math.floor((+now - last) / 1000);
  if (since < EMAIL_RESEND_COOLDOWN_SEC) {
    return res.status(429).json({ error: 'Please wait before resending', retryAfterSec: EMAIL_RESEND_COOLDOWN_SEC - since });
  }
  if ((user.emailVerifySendCountDay ?? 0) >= EMAIL_DAILY_CAP) {
    return res.status(429).json({ error: 'Daily resend limit reached' });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifyLastSentAt: now,
      emailVerifySendCountDay: (user.emailVerifySendCountDay ?? 0) + 1,
    },
  });

  await issueAndEmailEmailVerification(user.id, email);
  return res.json({ ok: true, nextResendAfterSec: EMAIL_RESEND_COOLDOWN_SEC, expiresInSec: EMAIL_TTL_MIN * 60 });
});

// ---------------- REGISTER ----------------
router.post(
  '/register',
  wrap(async (req, res) => {
    const body = RegisterSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(body.password, 10);
    const phone = toE164(body.dialCode, body.localPhone);

    // 1) Create the user first
    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        password: passwordHash,
        role: 'SHOPPER',
        firstName: body.firstName,
        middleName: body.middleName,
        lastName: body.lastName,
        phone,
        status: 'PENDING',
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
      },
    });

    const result = {
      message: 'Registered. Verify email and (optionally) enter the WhatsApp code.',
      tempToken: signJwt({ id: user.id, role: user.role, email: user.email }, '1h'),
      phoneOtpSent: Boolean(phone),
      emailSent: false,
      smsSent: false,
    };

    // 2) Side-effects (don’t fail signup on these)
    try {
      // Email verification (JWT link)
      try {
        await issueAndEmailEmailVerification(user.id, user.email);
        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerifyLastSentAt: new Date(), emailVerifySendCountDay: 1 },
        });
        result.emailSent = true;
      } catch (e) {
        console.warn('send email verification failed:', (e as any)?.message);
      }

      // Phone OTP via WhatsApp (if we have a valid E.164)
      if (phone && phone.startsWith('+')) {
        const r = await issueOtp({
          identifier: user.id,  // ⭐ keep consistent with /verify-otp
          userId: user.id,
          phoneE164: phone,
          channelPref: 'whatsapp',
        });
        result.phoneOtpSent = r.ok;
      }
    } catch (e) {
      console.warn('post-register side-effects failed (continuing):', (e as any)?.message);
    }

    // 3) Success response
    return res.status(201).json(result);
  })
);

// ---------------- VERIFY EMAIL CALLBACK (JWT + legacy DB tokens) ----------------
router.get('/verify-email', async (req, res) => {
  const raw = String(req.query.token ?? '');
  if (!raw) return res.status(400).send('Missing token');

  const now = new Date();
  let email = '';
  try {
    // 1) Try JWT
    const decoded = jwt.verify(raw, EMAIL_JWT_SECRET) as { sub: string; email: string; k: string };
    if (decoded.k !== 'email-verify') throw new Error('invalid-kind');

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, emailVerifiedAt: true, status: true, phoneVerifiedAt: true },
    });
    if (!user) return res.status(404).send('Account not found');

    email = decoded.email || user.email;

    if (!user.emailVerifiedAt) {
      const phoneOk = !!user.phoneVerifiedAt;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerifiedAt: now,
          status: phoneOk ? 'VERIFIED' : 'PARTIAL',
        },
      });
    }

    const ui = `${APP_URL}/verify?token=${encodeURIComponent(raw)}&e=${encodeURIComponent(email)}&ok=1`;
    return res.redirect(ui);
  } catch {
    // 2) Fallback to legacy DB tokens
    const legacy = await prisma.user.findFirst({
      where: {
        emailVerifyToken: raw,
        emailVerifyTokenExpiresAt: { gt: now },
      },
      select: { id: true, email: true, emailVerifiedAt: true, status: true, phoneVerifiedAt: true },
    });

    if (!legacy) {
      const ui = `${APP_URL}/verify?token=${encodeURIComponent(raw)}&e=&err=token`;
      return res.redirect(ui);
    }

    email = legacy.email;

    if (!legacy.emailVerifiedAt) {
      const phoneOk = !!legacy.phoneVerifiedAt;
      await prisma.user.update({
        where: { id: legacy.id },
        data: {
          emailVerifiedAt: now,
          status: phoneOk ? 'VERIFIED' : 'PARTIAL',
          emailVerifyToken: null,
          emailVerifyTokenExpiresAt: null,
        },
      });
    } else {
      // clear any lingering legacy token
      await prisma.user.update({
        where: { id: legacy.id },
        data: {
          emailVerifyToken: null,
          emailVerifyTokenExpiresAt: null,
        },
      });
    }

    const ui = `${APP_URL}/verify?token=${encodeURIComponent(raw)}&e=${encodeURIComponent(email)}&ok=1`;
    return res.redirect(ui);
  }
});

// ---------------- AUTHED resend-email (issues JWT link) ----------------
router.post(
  '/resend-email',
  requireAuth,
  wrap(async (req, res) => {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.emailVerifiedAt) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    const now = new Date();
    const last = user.emailVerifyLastSentAt ? +user.emailVerifyLastSentAt : 0;
    const since = Math.floor((+now - last) / 1000);
    if (since < EMAIL_RESEND_COOLDOWN_SEC) {
      return res.status(429).json({ error: 'Please wait before resending', retryAfterSec: EMAIL_RESEND_COOLDOWN_SEC - since });
    }
    if ((user.emailVerifySendCountDay ?? 0) >= EMAIL_DAILY_CAP) {
      return res.status(429).json({ error: 'Daily resend limit reached' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        emailVerifyLastSentAt: now,
        emailVerifySendCountDay: (user.emailVerifySendCountDay ?? 0) + 1,
      },
    });

    await issueAndEmailEmailVerification(user.id, user.email);

    res.json({
      ok: true,
      nextResendAfterSec: EMAIL_RESEND_COOLDOWN_SEC,
      expiresInSec: EMAIL_TTL_MIN * 60,
    });
  })
);

// ---------------- Forgot / Reset password ----------------
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = ForgotSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.json({ ok: true }); // do not leak

    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { resetPasswordToken: token, resetPasswordExpiresAt: expires },
    });

    const resetUrl = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await sendResetorForgotPasswordEmail(user.email, resetUrl, 'Reset your DaySpring password', 'Click the link to reset your password:');

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = ResetSchema.parse(req.body);
    const user = await prisma.user.findFirst({
      where: { resetPasswordToken: token, resetPasswordExpiresAt: { gt: new Date() } },
    });
    if (!user) return res.status(400).json({ error: 'Invalid or expired token' });

    const hashed = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        resetPasswordToken: null,
        resetPasswordExpiresAt: null,
      },
    });

    res.json({ ok: true, message: 'Password updated' });
  } catch (e) {
    next(e);
  }
});

router.get('/reset-token/validate', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    if (!token) return res.json({ ok: false });

    const user = await prisma.user.findFirst({
      where: { resetPasswordToken: token, resetPasswordExpiresAt: { gt: new Date() } },
      select: { id: true },
    });

    return res.json({ ok: !!user });
  } catch (e) {
    next(e);
  }
});

// ---------------- OTP Verification (phone) ----------------
router.post('/verify-otp', requireAuth, async (req, res) => {
  const userId = req.user?.id;
  const code = String(req.body?.otp ?? '').trim();
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!code) return res.status(400).json({ error: 'OTP is required' });

  try {
    // Verify against OTP table by SAME identifier used at send time (userId)
    const out = await verifyOtp({ identifier: userId, code });
    if (!out.ok) {
      return res.status(400).json({ error: out.error || 'Invalid OTP. Please try again.' });
    }

    // Mark user phone verified (status upgrade)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    const now = new Date();
    await prisma.user.update({
      where: { id: userId },
      data: {
        phoneVerifiedAt: now,
        status: user?.emailVerifiedAt ? 'VERIFIED' : 'PARTIAL',
      },
    });

    // Return fresh profile snapshot
    const profile = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, role: true, firstName: true, lastName: true,
        status: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true,
      },
    });

    return res.json({
      ok: true,
      profile: profile && {
        id: profile.id,
        email: profile.email,
        role: profile.role as any,
        firstName: profile.firstName,
        lastName: profile.lastName,
        emailVerified: !!profile.emailVerifiedAt,
        phoneVerified: !!profile.phoneVerifiedAt,
        status: profile.status,
      },
    });
  } catch (err: any) {
    console.error('verify-otp error:', { message: err?.message, stack: err?.stack, userId });
    return res.status(500).json({ error: 'Could not verify OTP' });
  }
});

// ---------------- Resend OTP (phone) — WhatsApp by default ----------------
router.post('/resend-otp', requireAuth, wrap(async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        phone: true,
        phoneVerifiedAt: true,
        phoneOtpLastSentAt: true,
        phoneOtpSendCountDay: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.phoneVerifiedAt) return res.status(400).json({ error: 'Phone already verified' });

    const phoneE164 = String(user.phone || '').trim();
    if (!phoneE164.startsWith('+')) {
      return res.status(400).json({ error: 'No phone on file for WhatsApp (e.g., +2348…)' });
    }

    const now = new Date();
    const last = user.phoneOtpLastSentAt ? +user.phoneOtpLastSentAt : 0;
    const since = Math.floor((+now - last) / 1000);
    if (since < RESEND_COOLDOWN_SEC) {
      return res.status(429).json({ error: 'Please wait before resending', retryAfterSec: RESEND_COOLDOWN_SEC - since });
    }
    if ((user.phoneOtpSendCountDay ?? 0) >= DAILY_CAP) {
      return res.status(429).json({ error: 'Daily resend limit reached' });
    }

    // Invalidate any active OTPs before issuing a new one
    await prisma.otp.updateMany({
      where: { identifier: userId, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });

    // Send via WhatsApp using SAME identifier (userId)
    const r = await issueOtp({
      identifier: userId,
      userId,
      phoneE164,
      channelPref: 'whatsapp',
    });

    if (!r.ok) {
      return res.status(500).json({ error: r.error || 'Could not send OTP' });
    }

    // Track rate-limit counters on the user row
    await prisma.user.update({
      where: { id: userId },
      data: {
        phoneOtpLastSentAt: now,
        phoneOtpSendCountDay: (user.phoneOtpSendCountDay ?? 0) + 1,
      },
    });

    return res.json({
      ok: true,
      nextResendAfterSec: RESEND_COOLDOWN_SEC,
      expiresInSec: r.ttlMin * 60,
    });
  } catch (e: any) {
    console.error('issueOtp error:', e?.message, e?.stack);
    res.status(500).json({ error: 'Internal error' });
  }
}));

export default router;
