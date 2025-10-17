// src/lib/email.ts
import nodemailer from 'nodemailer';

/**
 * Flexible mail transport for dev/prod.
 * - STRATEGY: 'ssl' (465) or 'starttls' (587)
 * - ALLOW_SELF_SIGNED: dev-only escape hatch for corporate proxies/AV that MITM TLS
 */

const STRATEGY = (process.env.SMTP_STRATEGY || 'starttls').toLowerCase(); // 'ssl' | 'starttls'
const ALLOW_SELF_SIGNED = String(process.env.SMTP_ALLOW_SELF_SIGNED || 'false') === 'true';

const host = process.env.SMTP_HOST || 'smtp.gmail.com';
const user = process.env.SMTP_USER || '';
// Google App Password must be 16 chars, no spaces. We strip whitespace just in case.
const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');

const fromEnv = process.env.SMTP_FROM || process.env.EMAIL_FROM || user || 'no-reply@yemishop.com';
const from = fromEnv;

const base: any = {
  host,
  auth: user && pass ? { user, pass } : undefined,
};

if (STRATEGY === 'ssl') {
  base.port = Number(process.env.SMTP_PORT || 465);
  base.secure = true;
} else {
  base.port = Number(process.env.SMTP_PORT || 587);
  base.secure = false; // STARTTLS
}

base.tls = {
  servername: host,
  ...(ALLOW_SELF_SIGNED ? { rejectUnauthorized: false } : {}),
};

export const transporter = nodemailer.createTransport(base);

// Log SMTP status at startup (non-fatal if it fails; send() will still throw)
transporter
  .verify()
  .then(() => {
    console.log(
      `[mail] SMTP OK host=${host} port=${base.port} secure=${base.secure} strategy=${STRATEGY} allowSelfSigned=${ALLOW_SELF_SIGNED}`
    );
  })
  .catch((err) => {
    console.error('[mail] SMTP verify failed:', err?.message || err);
  });

/**
 * Send verification email with a link (JWT or DB token URL).
 */
export async function sendVerifyEmail(to: string, verifyUrl: string) {
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#111">
      <h2>Verify your email</h2>
      <p>Click the button below to verify your email for YemiShop:</p>
      <p><a href="${verifyUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Verify my email</a></p>
      <p>If the button doesn’t work, paste this link in your browser:</p>
      <p style="word-break:break-all"><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link expires in 60 minutes.</p>
      <p>Thanks,<br/>YemiShop</p>
    </div>
  `;

  const info = await transporter.sendMail({
    from,
    to,
    subject: 'Verify your email — YemiShop',
    html,
  });

  console.log('[mail] verify sent', {
    to,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
  });
}

/**
 * Send password reset/forgot email with a reset link.
 * Your routes call: sendResetorForgotPasswordEmail(to, resetUrl, subject?, introText?)
 * We export BOTH spellings to avoid breaking existing imports.
 */
export async function sendResetorForgotPasswordEmail(
  to: string,
  resetUrl: string,
  subject = 'Reset your YemiShop password',
  introText = 'Click the button below to reset your password:'
) {
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#111">
      <h2>Password reset</h2>
      <p>${introText}</p>
      <p><a href="${resetUrl}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Reset password</a></p>
      <p>If the button doesn’t work, paste this link in your browser:</p>
      <p style="word-break:break-all"><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in 60 minutes.</p>
      <p>If you didn’t request this, you can safely ignore this email.</p>
      <p>Thanks,<br/>YemiShop</p>
    </div>
  `;

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    html,
  });

  console.log('[mail] reset sent', {
    to,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
  });
}

// Alias with capital “Or” in case some files import the other name
export const sendResetOrForgotPasswordEmail = sendResetorForgotPasswordEmail;
