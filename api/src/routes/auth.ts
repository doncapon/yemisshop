// api/src/routes/auth.ts
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import { prisma } from '../lib/prisma.js';
import { sendVerifyEmail, sendResetorForgotPasswordEmail } from '../lib/email.js';
import { signJwt, signAccessJwt } from '../lib/jwt.js';
import { requireAuth, requireVerifySession } from '../middleware/auth.js';
import { issueOtp, verifyOtp } from '../lib/otp.js';
import { Prisma, SupplierType } from '@prisma/client'

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

function signVerifyJwt(payload: { id: string; email: string; role: string }, expiresIn = '15m') {
  // IMPORTANT: include a "kind" / "k" claim so middleware can restrict permissions
  return signAccessJwt({ ...payload, k: 'verify' } as any, expiresIn);
}

async function createUserSession(req: Request, userId: string) {
  const ua = String(req.headers["user-agent"] ?? "").slice(0, 500) || null;

  // best-effort IP (works behind proxies too if you trust x-forwarded-for)
  const xff = String(req.headers["x-forwarded-for"] ?? "");
  const ip =
    (xff.split(",")[0]?.trim() || "").slice(0, 80) ||
    (String((req as any).ip ?? "").slice(0, 80) || null);

  const deviceName = String(req.headers["x-device-name"] ?? "").slice(0, 120) || null;

  // Create a DB-backed session
  const ABSOLUTE_DAYS = 7; // shoppers; use shorter for admins if you want
  const expiresAt = new Date(Date.now() + ABSOLUTE_DAYS * 24 * 60 * 60 * 1000);

  const session = await prisma.userSession.create({
    data: {
      userId,
      ip,
      userAgent: ua,
      deviceName,
      lastSeenAt: new Date(),
      expiresAt,
    } as any,
    select: { id: true },
  });


  return session.id;
}


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

  // ✅ BLOCK suppliers until fully verified (server-side)
  if (user.role === 'SUPPLIER' && !(profile.emailVerified && profile.phoneVerified)) {
    const verifyToken = signVerifyJwt({ id: user.id, email: user.email, role: user.role });

    return res.status(403).json({
      error: 'Please verify your email and phone number to continue.',
      needsVerification: true,
      profile,
      verifyToken, // ✅ this is what UI uses to call verify endpoints
    });
  }

  const sid = await createUserSession(req, user.id);

  const token = signAccessJwt(
    { id: user.id, email: user.email, role: user.role, k: "access", sid } as any,
    "7d"
  );

  return res.json({
    token,
    sid,
    profile,
    needsVerification: !(profile.emailVerified && profile.phoneVerified),
  });
}));


async function activateSupplierIfFullyVerified(user: {
  id: string;
  role: any;
  emailVerifiedAt?: Date | string | null;
  phoneVerifiedAt?: Date | string | null;
}) {
  const isSupplier = String(user.role) === 'SUPPLIER';
  const fullyVerified = !!user.emailVerifiedAt && !!user.phoneVerifiedAt;

  if (!isSupplier || !fullyVerified) return;

  // Activate supplier record (if exists) once fully verified
  await prisma.supplier.updateMany({
    where: { userId: user.id },
    data: { status: 'ACTIVE' as any },
  });
}



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
// put this near the top of the file
const fmtErr = (e: any) => {
  if (!e) return 'Unknown error';
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
};

// ============ PUBLIC resend (email in body). Uses JWT links. ============
router.post('/resend-verification', wrap(async (req, res) => {
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

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifyLastSentAt: now,
        emailVerifySendCountDay: (user.emailVerifySendCountDay ?? 0) + 1,
      },
    });

    await issueAndEmailEmailVerification(user.id, email);
    return res.json({ ok: true, nextResendAfterSec: EMAIL_RESEND_COOLDOWN_SEC, expiresInSec: EMAIL_TTL_MIN * 60 });
  } catch (e) {
    console.error('[resend-verification] send failed:', fmtErr(e));
    return res.status(502).json({ error: 'Mail send failed', detail: fmtErr(e) });
  }
}));


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

  const redirectUi = (params: Record<string, string>) => {
    const qp = new URLSearchParams(params);
    const ui = `${APP_URL}/verify?${qp.toString()}`;
    return res.redirect(ui);
  };

  // 1) Try JWT
  try {
    const decoded = jwt.verify(raw, EMAIL_JWT_SECRET) as { sub: string; email: string; k: string };
    if (decoded.k !== 'email-verify') throw new Error('invalid-kind');

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        email: true,
        role: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        status: true,
      },
    });
    if (!user) return res.status(404).send('Account not found');

    const email = (decoded.email || user.email || '').toLowerCase();

    // mark email verified if not already
    let nextUser = user;
    if (!user.emailVerifiedAt) {
      const phoneOk = !!user.phoneVerifiedAt;
      const newStatus = phoneOk ? 'VERIFIED' : 'PARTIAL';

      nextUser = await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: now, status: newStatus as any },
        select: {
          id: true,
          email: true,
          role: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
        },
      });
    }

    // ✅ activate supplier if now fully verified
    await activateSupplierIfFullyVerified(nextUser);

    return redirectUi({
      token: raw,
      e: email,
      ok: '1',
      role: String(user.role || ''),
      phoneOk: nextUser.phoneVerifiedAt ? '1' : '0',
    });
  } catch {
    // 2) Fallback to legacy DB tokens
    const legacy = await prisma.user.findFirst({
      where: {
        emailVerifyToken: raw,
        emailVerifyTokenExpiresAt: { gt: now },
      },
      select: {
        id: true,
        email: true,
        role: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        status: true,
      },
    });

    if (!legacy) {
      return redirectUi({ token: raw, e: '', err: 'token' });
    }

    const email = (legacy.email || '').toLowerCase();

    let nextUser = legacy;

    if (!legacy.emailVerifiedAt) {
      const phoneOk = !!legacy.phoneVerifiedAt;
      const newStatus = phoneOk ? 'VERIFIED' : 'PARTIAL';

      nextUser = await prisma.user.update({
        where: { id: legacy.id },
        data: {
          emailVerifiedAt: now,
          status: newStatus as any,
          emailVerifyToken: null,
          emailVerifyTokenExpiresAt: null,
        },
        select: {
          id: true,
          email: true,
          role: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
        },
      });
    } else {
      // clear any lingering legacy token
      nextUser = await prisma.user.update({
        where: { id: legacy.id },
        data: {
          emailVerifyToken: null,
          emailVerifyTokenExpiresAt: null,
        },
        select: {
          id: true,
          email: true,
          role: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
        },
      });
    }

    // ✅ activate supplier if now fully verified
    await activateSupplierIfFullyVerified(nextUser);

    return redirectUi({
      token: raw,
      e: email,
      ok: '1',
      role: String(legacy.role || ''),
      phoneOk: nextUser.phoneVerifiedAt ? '1' : '0',
    });
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
router.post('/verify-otp', requireVerifySession, async (req, res) => {
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
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true, role: true },
    });

    const now = new Date();

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        phoneVerifiedAt: now,
        status: existing?.emailVerifiedAt ? 'VERIFIED' : 'PARTIAL',
      },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        status: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
      },
    });

    // ✅ activate supplier if now fully verified
    await activateSupplierIfFullyVerified(updated);

    return res.json({
      ok: true,
      profile: {
        id: updated.id,
        email: updated.email,
        role: updated.role as any,
        firstName: updated.firstName,
        lastName: updated.lastName,
        emailVerified: !!updated.emailVerifiedAt,
        phoneVerified: !!updated.phoneVerifiedAt,
        status: updated.status,
      },
    });
  } catch (err: any) {
    console.error('verify-otp error:', { message: err?.message, stack: err?.stack, userId });
    return res.status(500).json({ error: 'Could not verify OTP' });
  }
});


// ---------------- Resend OTP (phone) — WhatsApp by default ----------------
router.post('/resend-otp', requireVerifySession, wrap(async (req, res) => {
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

const KYC_TICKET_SECRET = process.env.KYC_TICKET_SECRET || 'CHANGE_ME_KYC_TICKET_SECRET';

// Company type validator for suppliers
const CacCompanyTypeEnum = z.enum([
  'BUSINESS_NAME',
  'COMPANY',
  'INCORPORATED_TRUSTEES',
  'LIMITED_PARTNERSHIP',
  'LIMITED_LIABILITY_PARTNERSHIP',
]);

const registerSupplierSchema = z.object({
  role: z.literal('SUPPLIER').optional(),

  contactFirstName: z.string().min(1),
  contactLastName: z.string().min(1),
  contactEmail: z.string().email(),
  contactPhone: z.string().nullable().optional(),
  password: z.string().min(8),

  rcNumber: z.string().min(3),
  companyType: CacCompanyTypeEnum,

  assertedCompanyName: z.string().min(1),
  assertedRegistrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),

  verificationTicket: z.string().min(20),
});

// small helpers
const norm = (s: any) => String(s ?? '').trim().toLowerCase();
const digits = (s: any) => String(s ?? '').replace(/\D/g, '');

function normalizeDateToYMD(raw?: string | null): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = Number(slash[3]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(y)) return null;

    let day = b;
    let month = a;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    }
    const pad2 = (n: number) => String(n).padStart(2, '0');
    return `${y}-${pad2(month)}-${pad2(day)}`;
  }

  try {
    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) return null;
    const pad2 = (n: number) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  } catch {
    return null;
  }
}

function matchesAllFour(entity: any, input: {
  rcNumber: string;
  companyType: string;
  companyName: string;
  regDate: string;
}) {
  const rcOk = digits(input.rcNumber) !== '' && digits(input.rcNumber) === digits(entity.rc_number);
  const typeOk =
    String(input.companyType).trim().toUpperCase() === String(entity.type_of_company).trim().toUpperCase();
  const nameOk = norm(input.companyName) !== '' && norm(input.companyName) === norm(entity.company_name);

  const entryDate = normalizeDateToYMD(entity.date_of_registration);
  const uiDate = String(input.regDate || '').trim();
  const dateOk = !!uiDate && !!entryDate && entryDate === uiDate;

  return rcOk && typeOk && nameOk && dateOk;
}

async function pickUniqueSupplierName(desired: string, rc: string) {
  const base = desired.trim();
  const existing = await prisma.supplier.findUnique({ where: { name: base } });
  if (!existing) return base;

  let candidate = `${base} (RC ${rc})`;
  const clash1 = await prisma.supplier.findUnique({ where: { name: candidate } });
  if (!clash1) return candidate;

  for (let i = 2; i <= 50; i++) {
    candidate = `${base} (RC ${rc}) #${i}`;
    const clash = await prisma.supplier.findUnique({ where: { name: candidate } });
    if (!clash) return candidate;
  }
  return `${base} (RC ${rc}) #${Date.now()}`;
}

// ---------------- REGISTER SUPPLIER ----------------
router.post('/register-supplier', async (req, res) => {
  try {
    const parsed = registerSupplierSchema.parse(req.body);

    const {
      contactFirstName,
      contactLastName,
      contactEmail,
      contactPhone,
      password,
      rcNumber,
      companyType,
      assertedCompanyName,
      assertedRegistrationDate,
      verificationTicket,
    } = parsed;

    // 1) Verify ticket
    let ticket: any;
    try {
      ticket = jwt.verify(verificationTicket, KYC_TICKET_SECRET) as any;
    } catch {
      return res
        .status(400)
        .json({ error: 'CAC verification expired or invalid. Please verify again.' });
    }

    if (ticket?.k !== 'cac-verify') {
      return res
        .status(400)
        .json({ error: 'CAC verification expired or invalid. Please verify again.' });
    }

    // Ticket must match request
    if (String(ticket.rcNumber) !== String(rcNumber)) {
      return res
        .status(400)
        .json({ error: 'CAC verification expired or invalid. Please verify again.' });
    }
    if (String(ticket.companyType) !== String(companyType)) {
      return res
        .status(400)
        .json({ error: 'CAC verification expired or invalid. Please verify again.' });
    }

    // 2) Fetch entity from cache (server-side truth)
    const lookup = await prisma.cacLookup.findUnique({
      where: { CacLookup_rc_companyType_key: { rcNumber, companyType } },
      select: { entity: true, outcome: true },
    });

    if (!lookup?.entity) {
      return res
        .status(400)
        .json({ error: 'CAC verification expired or invalid. Please verify again.' });
    }

    const entity = lookup.entity as any;

    // 3) Re-check correlation again on server (prevents client tampering)
    const ok = matchesAllFour(entity, {
      rcNumber,
      companyType,
      companyName: assertedCompanyName,
      regDate: assertedRegistrationDate,
    });

    if (!ok) {
      return res
        .status(400)
        .json({ error: 'CAC verification expired or invalid. Please verify again.' });
    }

    // 4) Conflicts
    const emailLower = contactEmail.toLowerCase();

    const existingUser = await prisma.user.findUnique({ where: { email: emailLower } });
    if (existingUser) return res.status(409).json({ error: 'A user with this email already exists.' });

    const existingSupplierByRc = await prisma.supplier.findFirst({ where: { rcNumber } });
    if (existingSupplierByRc) {
      return res.status(409).json({ error: 'A supplier with this RC number already exists.' });
    }

    // 5) Create user (NOT verified yet)
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: emailLower,
        firstName: contactFirstName,
        lastName: contactLastName,
        phone: contactPhone || undefined,
        role: 'SUPPLIER',
        status: 'PENDING', // ✅ wait for email + phone verification
        password: passwordHash, // ✅ your login checks user.password
      } as any,
    });

    // 6) Optional registered address
    let registeredAddressId: string | undefined = undefined;
    if (entity.address || entity.city || entity.state || entity.lga) {
      const addr = await prisma.address.create({
        data: {
          streetName: entity.address || undefined,
          town: entity.lga || undefined,
          city: entity.city || undefined,
          state: entity.state || undefined,
          country: 'Nigeria',
        },
      });
      registeredAddressId = addr.id;
    }

    const dateOfReg = entity.date_of_registration ? new Date(entity.date_of_registration) : null;
    const shareCapitalDecimal =
      typeof entity.share_capital === 'number' ? new Prisma.Decimal(entity.share_capital) : null;

    const supplierName = await pickUniqueSupplierName(entity.company_name, rcNumber);

    // 7) Create supplier (CAC is approved, but account is not active until contact verification)
    const supplier = await prisma.supplier.create({
      data: {
        name: supplierName,
        contactEmail: emailLower,
        whatsappPhone: contactPhone || null,
        type: SupplierType.ONLINE,
        status: 'PENDING_CONTACT_VERIFY', // ✅ not ACTIVE yet

        userId: user.id,

        legalName: entity.company_name,
        rcNumber: rcNumber,
        companyType: companyType as any,
        dateOfRegistration: dateOfReg || undefined,
        natureOfBusiness: entity.nature_of_business || undefined,
        shareCapital: shareCapitalDecimal || undefined,
        shareDetails: (entity.share_details as any) ?? undefined,
        kycRawPayload: entity as any,

        ownerVerified: true,
        kycStatus: 'APPROVED',
        kycCheckedAt: new Date(),
        kycApprovedAt: new Date(),
        kycProvider: 'DOJAH',

        registeredAddressId,
      } as any,
    });

    // 8) Send email verification + WhatsApp OTP (best-effort)
    const result = {
      message: 'Supplier registered. Please verify email and WhatsApp number to activate your account.',
      supplierId: supplier.id,
      tempToken: signJwt({ id: user.id, role: user.role, email: user.email }, '1h'),
      emailSent: false,
      phoneOtpSent: false,
    };

    try {
      await issueAndEmailEmailVerification(user.id, user.email);
      result.emailSent = true;

      // track resend counters if your User model has these fields (you do)
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifyLastSentAt: new Date(), emailVerifySendCountDay: 1 },
      });
    } catch {
      // ignore (don’t fail signup)
    }

    try {
      const phoneE164 = String(user.phone || '').trim();
      if (phoneE164 && phoneE164.startsWith('+')) {
        const r = await issueOtp({
          identifier: user.id, // must match verify-otp identifier
          userId: user.id,
          phoneE164,
          channelPref: 'whatsapp',
        });
        result.phoneOtpSent = !!r.ok;

        if (r.ok) {
          await prisma.user.update({
            where: { id: user.id },
            data: { phoneOtpLastSentAt: new Date(), phoneOtpSendCountDay: 1 },
          });
        }
      }
    } catch {
      // ignore
    }

    return res.status(201).json(result);
  } catch (err: any) {
    console.error('[register-supplier] error', err);

    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid payload', details: err.errors });
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({
        error: 'A supplier or user already exists with these details.',
        meta: err.meta,
      });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});



export default router;
