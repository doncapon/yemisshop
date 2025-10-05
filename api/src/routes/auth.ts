// src/routes/auth.ts
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

import { prisma } from '../lib/prisma.js';
import { randomOtp, randomToken, hash } from '../lib/crypto.js';
import { sendVerifyEmail } from '../lib/email.js';
import { sendSmsOtp } from '../lib/sms.js';
import { signJwt } from '../lib/jwt.js';
import { authMiddleware } from '../lib/authMiddleware.js';

// If you’ve augmented Express’ Request in global.d.ts, you can read req.user
// Otherwise do: const userId = (req as any).user?.id;

// ---------------- Schemas ----------------

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  middleName: z.string().optional(),
  lastName: z.string().min(1),
  role: z.string().default('SHOPPER'),
  dialCode: z.string().optional(),   // e.g. +234
  localPhone: z.string().optional(), // national number w/out +234
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const VerifyPhoneSchema = z.object({
  email: z.string().email(),
  otp: z.string().min(4).max(8),
});

// Small helper so async handlers match Express’ RequestHandler type
const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

// ---------------- Router ----------------

const router = Router();

/**
 * POST /api/auth/register
 */
router.post(
  '/register',
  wrap(async (req, res) => {
    const body = RegisterSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(body.password, 10);

    // Compose display name & phone
    const name = [body.firstName, body.middleName, body.lastName].filter(Boolean).join(' ');
    const phone = body.dialCode && body.localPhone ? `${body.dialCode}${body.localPhone}` : null;

    const user = await prisma.user.create({
      data: {
        email: body.email,
        password: passwordHash,
        role: 'SHOPPER',
        name,
        phone,
        status: 'PENDING',
      },
    });

    // Create verification artifacts
    const emailToken = randomToken(24);
    const emailVerifyTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h
    const otp = randomOtp(6);
    const otpHash = await hash(otp);
    const phoneOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifyToken: emailToken,
        emailVerifyTokenExpiresAt,
        phoneOtpHash: otpHash,
        phoneOtpExpiresAt,
      },
    });

    // Send email verification link
    const apiUrl = process.env.API_URL || 'http://localhost:4000';
    const verifyUrl = `${apiUrl}/api/auth/verify-email?token=${emailToken}`;
    await sendVerifyEmail(user.email, verifyUrl);

    // Send SMS OTP (or console log via your adapter)
    if (phone) {
      await sendSmsOtp(phone, otp);
    }

    // Optional: temp token for UI flows
    const tempToken = signJwt({ id: user.id, role: user.role, email: user.email }, '1h');

    res.status(201).json({
      message: 'Registered. Verify email and enter the SMS code.',
      tempToken,
      phoneOtpSent: Boolean(phone),
    });
  })
);

/**
 * POST /api/auth/login
 */
router.post(
  '/login',
  wrap(async (req, res) => {
    const { email, password } = LoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    // Block login if not fully verified (adjust to your policy)
    const fullyVerified = Boolean(user.emailVerifiedAt) && Boolean(user.phoneVerifiedAt);
    if (!fullyVerified) {
      return res.status(403).json({
        error: 'Account not fully verified',
        emailVerified: Boolean(user.emailVerifiedAt),
        phoneVerified: Boolean(user.phoneVerifiedAt),
      });
    }

    const token = signJwt({ id: user.id, role: user.role, email: user.email });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  })
);

/**
 * GET /api/auth/verify-email?token=...
 */
router.get(
  '/verify-email',
  wrap(async (req, res) => {
    const token = String(req.query.token || '');
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const user = await prisma.user.findFirst({
      where: {
        emailVerifyToken: token,
        emailVerifyTokenExpiresAt: { gt: new Date() },
      },
    });
    if (!user) return res.status(400).json({ error: 'Invalid or expired token' });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerifyToken: null,
        emailVerifyTokenExpiresAt: null,
      },
    });

    // Bump status
    const bothVerified = Boolean(updated.emailVerifiedAt) && Boolean(updated.phoneVerifiedAt);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: bothVerified ? 'VERIFIED' : 'PARTIAL' },
    });

    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    return res.redirect(`${appUrl}/verify?email=1`);
  })
);

/**
 * POST /api/auth/verify-phone
 */
router.post(
  '/verify-phone',
  wrap(async (req, res) => {
    const { email, otp } = VerifyPhoneSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.phoneOtpHash || !user.phoneOtpExpiresAt) {
      return res.status(400).json({ error: 'No OTP pending for this user' });
    }
    if (user.phoneOtpExpiresAt < new Date()) {
      return res.status(400).json({ error: 'OTP expired' });
    }

    const { verifyHash } = await import('../lib/crypto.js');
    const ok = await verifyHash(otp, user.phoneOtpHash);
    if (!ok) return res.status(400).json({ error: 'Invalid OTP' });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        phoneVerifiedAt: new Date(),
        phoneOtpHash: null,
        phoneOtpExpiresAt: null,
      },
    });

    const bothVerified = Boolean(updated.emailVerifiedAt) && Boolean(updated.phoneVerifiedAt);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: bothVerified ? 'VERIFIED' : 'PARTIAL' },
    });

    res.json({ message: 'Phone verified' });
  })
);

// ---------------- Resend flows ----------------

const RESEND_COOLDOWN_SEC = 60;
const DAILY_CAP = 5;
const OTP_TTL_MIN = 10;

/**
 * POST /api/auth/resend-otp
 * Requires auth; uses req.user.id
 */
router.post(
  '/resend-otp',
  authMiddleware,
  wrap(async (req, res) => {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.phoneVerifiedAt) {
      return res.status(400).json({ error: 'Phone already verified' });
    }

    const now = new Date();
    const lastSent = user.phoneOtpLastSentAt ? +user.phoneOtpLastSentAt : 0;
    const secondsSinceLast = Math.floor((+now - lastSent) / 1000);

    if (secondsSinceLast < RESEND_COOLDOWN_SEC) {
      return res.status(429).json({
        error: 'Please wait before resending',
        retryAfterSec: RESEND_COOLDOWN_SEC - secondsSinceLast,
      });
    }

    if ((user.phoneOtpSendCountDay ?? 0) >= DAILY_CAP) {
      return res.status(429).json({ error: 'Daily resend limit reached' });
    }

    const code = randomOtp(6);
    const expiresAt = new Date(+now + OTP_TTL_MIN * 60 * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: {
        phoneOtpHash: await hash(code),
        phoneOtpExpiresAt: expiresAt,
        phoneOtpLastSentAt: now,
        phoneOtpSendCountDay: (user.phoneOtpSendCountDay ?? 0) + 1,
      },
    });

    if (user.phone) {
      await sendSmsOtp(user.phone, `Your YemiShop code: ${code}. It expires in ${OTP_TTL_MIN} min.`);
    }

    res.json({
      ok: true,
      nextResendAfterSec: RESEND_COOLDOWN_SEC,
      expiresInSec: OTP_TTL_MIN * 60,
    });
  })
);

// Email resend
const EMAIL_RESEND_COOLDOWN_SEC = 60;
const EMAIL_DAILY_CAP = 5;
const EMAIL_TTL_MIN = 60;

/**
 * POST /api/auth/resend-email
 * Requires auth; uses req.user.id
 */
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
    const lastSent = user.emailVerifyLastSentAt ? +user.emailVerifyLastSentAt : 0;
    const secondsSinceLast = Math.floor((+now - lastSent) / 1000);

    if (secondsSinceLast < EMAIL_RESEND_COOLDOWN_SEC) {
      return res.status(429).json({
        error: 'Please wait before resending',
        retryAfterSec: EMAIL_RESEND_COOLDOWN_SEC - secondsSinceLast,
      });
    }
    if ((user.emailVerifySendCountDay ?? 0) >= EMAIL_DAILY_CAP) {
      return res.status(429).json({ error: 'Daily resend limit reached' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(+now + EMAIL_TTL_MIN * 60 * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: {
        emailVerifyToken: token,
        emailVerifyTokenExpiresAt: expiresAt,
        emailVerifyLastSentAt: now,
        emailVerifySendCountDay: (user.emailVerifySendCountDay ?? 0) + 1,
      },
    });

    const apiUrl = process.env.API_URL || 'http://localhost:4000';
    const verifyUrl = `${apiUrl}/api/auth/verify-email?token=${token}`;
    await sendVerifyEmail(user.email, verifyUrl);

    res.json({
      ok: true,
      nextResendAfterSec: EMAIL_RESEND_COOLDOWN_SEC,
      expiresInSec: EMAIL_TTL_MIN * 60,
    });
  })
);

export default router;
