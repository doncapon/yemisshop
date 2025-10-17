// api/src/routes/auth.ts
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import { prisma } from '../lib/prisma.js';
import { randomOtp, randomToken, hash } from '../lib/crypto.js';
import { sendVerifyEmail, sendResetorForgotPasswordEmail } from '../lib/email.js';
import { sendSmsOtp } from '../lib/sms.js';
import { signJwt, signAccessJwt, signVerifyJwt } from '../lib/jwt.js';
import { authMiddleware, requireAuth } from '../middleware/auth.js';

// ---------------- ENV / constants ----------------
const WEB_BASE_URL = process.env.WEB_BASE_URL || 'http://localhost:5173';
const API_BASE_URL = process.env.API_BASE_URL || process.env.API_URL || 'http://localhost:4000';
const EMAIL_JWT_SECRET = process.env.EMAIL_JWT_SECRET || 'CHANGE_ME_DEV_SECRET';

// ---------------- Schemas ----------------
const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  middleName: z.string().optional(),
  lastName: z.string().min(1),
  role: z.string().default('SHOPPER'),
  dialCode: z.string().optional(),
  localPhone: z.string().optional(),
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

// Small async wrapper so handlers match RequestHandler
const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler =>
    (req, res, next) => {
      fn(req, res, next).catch(next);
    };

const router = Router();

/** Issue a JWT email-verify link and send it via the central mail helper */
async function issueAndEmailEmailVerification(userId: string, email: string) {
  const token = jwt.sign({ sub: userId, email, k: 'email-verify' }, EMAIL_JWT_SECRET, { expiresIn: '60m' });
  const verifyUrl = `${API_BASE_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await sendVerifyEmail(email, verifyUrl);
}

// ============ PUBLIC helpers used by VerifyEmail page ============
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

const EMAIL_RESEND_COOLDOWN_SEC = 60;
const EMAIL_DAILY_CAP = 5;
const EMAIL_TTL_MIN = 60;

// PUBLIC resend (email in body). Uses JWT links.
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

// ============ REGISTER ============
router.post(
  '/register',
  wrap(async (req, res) => {
    const body = RegisterSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(body.password, 10);
    const phone = body.dialCode && body.localPhone ? `${body.dialCode}${body.localPhone}` : null;

    // 1) Create the user first (this must not fail silently)
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
      message: 'Registered. Verify email and (optionally) enter the SMS code.',
      tempToken: signJwt({ id: user.id, role: user.role, email: user.email }, '1h'),
      phoneOtpSent: Boolean(phone),
      emailSent: false,
      smsSent: false,
    };

    // 2) Side-effects (don’t fail signup on these)
    try {
      // Email verify (JWT link)
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

      // Phone OTP (if phone provided)
      if (phone) {
        const otp = randomOtp(6);
        const phoneOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // ✅ consume any active OTP rows for this user BEFORE creating a new one
        await prisma.otp.updateMany({
          where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
          data: { consumedAt: new Date() },
        });

        await prisma.otp.create({
          data: {
            userId: user.id,
            codeHash: await bcrypt.hash(otp, 8),
            attempts: 0,
            expiresAt: phoneOtpExpiresAt,
            consumedAt: null,
          },
        });

        await prisma.user.update({
          where: { id: user.id },
          data: {
            phoneOtpHash: await hash(otp), // legacy fallback
            phoneOtpExpiresAt: phoneOtpExpiresAt,
            phoneOtpLastSentAt: new Date(),
            phoneOtpSendCountDay: 1,
          },
        });

        try {
          await sendSmsOtp(phone, `Your YemiShop code: ${otp}. It expires in 10 minutes.`);
          result.smsSent = true;
        } catch (e) {
          console.warn('sendSmsOtp failed (continuing):', (e as any)?.message);
        }
      }
    } catch (e) {
      console.warn('post-register side-effects failed (continuing):', (e as any)?.message);
    }

    // 3) Always reply success once the user row is created
    return res.status(201).json(result);
  })
);

// ============ LOGIN ============
/**
 * Old workflow: allow unverified users to log in.
 * UI shows prompts to verify, but does not block access.
 */
router.post('/login', async (req, res) => {
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

  const baseClaims = { id: user.id, email: user.email, role: user.role };
  const token = signAccessJwt(baseClaims, '7d'); // always issue full access token

  return res.json({ token, profile, needsVerification: !(profile.emailVerified && profile.phoneVerified) });
});

// ============ VERIFY EMAIL CALLBACK (supports JWT and legacy DB tokens) ============
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

    const ui = `${WEB_BASE_URL}/verify?token=${encodeURIComponent(raw)}&e=${encodeURIComponent(email)}&ok=1`;
    return res.redirect(ui);
  } catch {
    // 2) Fallback to legacy DB tokens (older emails)
    const legacy = await prisma.user.findFirst({
      where: {
        emailVerifyToken: raw,
        emailVerifyTokenExpiresAt: { gt: now },
      },
      select: { id: true, email: true, emailVerifiedAt: true, status: true, phoneVerifiedAt: true },
    });

    if (!legacy) {
      const ui = `${WEB_BASE_URL}/verify?token=${encodeURIComponent(raw)}&e=&err=token`;
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

    const ui = `${WEB_BASE_URL}/verify?token=${encodeURIComponent(raw)}&e=${encodeURIComponent(email)}&ok=1`;
    return res.redirect(ui);
  }
});

// ============ AUTHED resend-email (issues JWT link) ============
router.post(
  '/resend-email',
  authMiddleware,
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

// ============ ME ============
router.get('/me', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, role: true,
        firstName: true, middleName: true, lastName: true,
        status: true, phone: true,
        emailVerifiedAt: true, phoneVerifiedAt: true,
        joinedAt: true,
        emailVerifyLastSentAt: true, phoneOtpLastSentAt: true,
        address: true, shippingAddress: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      phone: user.phone,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      joinedAt: user.joinedAt,
      emailVerified: !!user.emailVerifiedAt,
      phoneVerified: !!user.phoneVerifiedAt,
      emailVerifyLastSentAt: user.emailVerifyLastSentAt,
      phoneOtpLastSentAt: user.phoneOtpLastSentAt,
      address: user.address,
      shippingAddress: user.shippingAddress,
    });
  } catch (err) {
    next(err);
  }
});

// ============ Forgot / Reset password ============
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

    const resetUrl = `${WEB_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await sendResetorForgotPasswordEmail(user.email, resetUrl, 'Reset your YemiShop password', 'Click the link to reset your password:');

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

// ============ OTP Verification (phone) ============
router.post('/verify-otp', requireAuth, async (req, res) => {
  const userId = req.user?.id;
  const otpInput = String(req.body?.otp ?? '').trim();

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!otpInput) return res.status(400).json({ error: 'OTP is required' });

  try {
    const now = new Date();

    // 1) Try OTP table first
    let row = await prisma.otp.findFirst({
      where: { userId, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });

    // 2) If no active row, fallback to legacy fields on the user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        phoneOtpHash: true,
        phoneOtpExpiresAt: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // helper to finish verification (set phoneVerifiedAt + status)
    const finalizeUserVerify = async () => {
      const emailOk = !!user.emailVerifiedAt;
      const nextStatus = emailOk ? 'VERIFIED' : 'PARTIAL';
      await prisma.user.update({
        where: { id: userId },
        data: { phoneVerifiedAt: now, status: nextStatus },
      });
    };

    if (row) {
      // Compare with bcrypt codeHash (preferred)
      const hasHash = !!(row as any).codeHash;
      let match = false;

      if (hasHash) {
        match = await bcrypt.compare(otpInput, (row as any).codeHash);
      } else if (typeof row.code === 'string') {
        match = row.code === otpInput;
      }

      // Always bump attempts
      await prisma.otp.update({
        where: { id: row.id },
        data: { attempts: (row.attempts ?? 0) + 1 },
      });

      if (!match) return res.status(400).json({ error: 'Invalid OTP. Please try again.' });

      // Mark consumed + verify user
      await prisma.$transaction(async (tx: { otp: { update: (arg0: { where: { id: any; }; data: { consumedAt: Date; }; }) => any; }; }) => {
        await tx.otp.update({ where: { id: row!.id }, data: { consumedAt: now } });
        await finalizeUserVerify();
      });
    } else {
      // Fallback legacy branch
      if (!user.phoneOtpHash || !user.phoneOtpExpiresAt) {
        return res.status(400).json({ error: 'No active OTP. Please request a new one.' });
      }
      if (user.phoneOtpExpiresAt < now) {
        // expire legacy
        await prisma.user.update({
          where: { id: userId },
          data: { phoneOtpHash: null, phoneOtpExpiresAt: null },
        });
        return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
      }

      // Verify legacy hash
      const { verifyHash } = await import('../lib/crypto.js');
      const ok = await verifyHash(otpInput, user.phoneOtpHash);
      if (!ok) return res.status(400).json({ error: 'Invalid OTP. Please try again.' });

      await prisma.user.update({
        where: { id: userId },
        data: { phoneOtpHash: null, phoneOtpExpiresAt: null },
      });

      await finalizeUserVerify();
    }

    // Return fresh profile snapshot
    const profile = await prisma.user.findUnique({
      where: { id: userId },
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
    console.error('verify-otp error:', {
      message: err?.message,
      code: err?.code,
      meta: err?.meta,
      stack: err?.stack,
      userId,
    });
    return res.status(500).json({ error: 'Could not verify OTP' });
  }
});

// ============ Resend OTP (phone) ============
const RESEND_COOLDOWN_SEC = 60;
const DAILY_CAP = 50;
const OTP_TTL_MIN = 10;

router.post('/resend-otp', authMiddleware, wrap(async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.phoneVerifiedAt) return res.status(400).json({ error: 'Phone already verified' });

  const now = new Date();
  const lastSent = user.phoneOtpLastSentAt ? +user.phoneOtpLastSentAt : 0;
  const secondsSinceLast = Math.floor((+now - lastSent) / 1000);

  if (secondsSinceLast < RESEND_COOLDOWN_SEC) {
    return res.status(429).json({ error: 'Please wait before resending', retryAfterSec: RESEND_COOLDOWN_SEC - secondsSinceLast });
  }
  if ((user.phoneOtpSendCountDay ?? 0) >= DAILY_CAP) {
    return res.status(429).json({ error: 'Daily resend limit reached' });
  }

  // ✅ consume any active tokens BEFORE issuing a new one
  await prisma.otp.updateMany({
    where: { userId, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });

  const code = randomOtp(6);
  const codeHash = await bcrypt.hash(code, 8);
  const expiresAt = new Date(+now + OTP_TTL_MIN * 60 * 1000);

  await prisma.otp.create({ data: { userId, codeHash, expiresAt, attempts: 0 } });

  await prisma.user.update({
    where: { id: userId },
    data: {
      phoneOtpHash: await hash(code), // legacy fields maintained as fallback
      phoneOtpExpiresAt: expiresAt,
      phoneOtpLastSentAt: now,
      phoneOtpSendCountDay: (user.phoneOtpSendCountDay ?? 0) + 1,
    },
  });

  if (user.phone) {
    await sendSmsOtp(user.phone, `Your YemiShop code: ${code}. It expires in ${OTP_TTL_MIN} minutes.`);
  }

  res.json({ ok: true, nextResendAfterSec: RESEND_COOLDOWN_SEC, expiresInSec: OTP_TTL_MIN * 60 });
}));

export default router;
