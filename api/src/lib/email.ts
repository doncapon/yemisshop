// src/lib/email.ts
import nodemailer from 'nodemailer';

/**
 * Flexible mail transport for dev/prod.
 * - STRATEGY: 'ssl' (465) or 'starttls' (587)
 * - ALLOW_SELF_SIGNED: dev-only escape hatch for corporate proxies/AV that MITM TLS
 * - In production on Railway we SKIP transporter.verify() to avoid port blocks/timeouts.
 */

const NODE_ENV = process.env.NODE_ENV ?? 'production';
const IS_PROD = NODE_ENV === 'production';

const STRATEGY = (process.env.SMTP_STRATEGY || 'starttls').toLowerCase(); // 'ssl' | 'starttls'
const ALLOW_SELF_SIGNED = String(process.env.SMTP_ALLOW_SELF_SIGNED || 'false') === 'true';

const host = process.env.SMTP_HOST || 'smtp.gmail.com';
const user = process.env.SMTP_USER || '';
// Google App Password must be 16 chars, no spaces. We strip whitespace just in case.
const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');

const fromEnv = process.env.SMTP_FROM || process.env.EMAIL_FROM || user || 'no-reply@dayspring.com';
const from = fromEnv;

// If SMTP creds are missing, we’ll fall back to a dev-safe transport (stream) when not in prod
const HAS_SMTP_CREDS = Boolean(user && pass);
const DEV_FALLBACK = !IS_PROD && !HAS_SMTP_CREDS;

let transporter: nodemailer.Transporter;

if (DEV_FALLBACK) {
  // Dev-only: don’t try to reach the network; render the email to buffer/console.
  transporter = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'unix',
  });
  // eslint-disable-next-line no-console
  console.log('[mail] Using DEV fallback transport (stream). No SMTP creds set.');
} else {
  const base: any = {
    host,
    auth: HAS_SMTP_CREDS ? { user, pass } : undefined,
    // Keep connections short-lived; Railway commonly blocks SMTP ports on hobby plans.
    connectionTimeout: Number(process.env.SMTP_CONN_TIMEOUT ?? 3000),
    greetingTimeout: Number(process.env.SMTP_GREET_TIMEOUT ?? 3000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT ?? 5000),
  };

  if (STRATEGY === 'ssl') {
    base.port = Number(process.env.SMTP_PORT || 465);
    base.secure = true;
  } else {
    base.port = Number(process.env.SMTP_PORT || 587);
    base.secure = false; // STARTTLS
    base.requireTLS = true;
  }

  base.tls = {
    servername: host,
    ...(ALLOW_SELF_SIGNED ? { rejectUnauthorized: false } : {}),
  };

  transporter = nodemailer.createTransport(base);

  // In PRODUCTION: do NOT verify on boot (avoid blocking startup on Railway)
  // In DEV: verify is helpful but non-fatal.
  if (!IS_PROD) {
    transporter
      .verify()
      .then(() => {
        // eslint-disable-next-line no-console
        console.log(
          `[mail] SMTP OK host=${host} port=${base.port} secure=${base.secure} strategy=${STRATEGY} allowSelfSigned=${ALLOW_SELF_SIGNED}`
        );
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.log('[mail] SMTP verify skipped:', err?.message || err);
      });
  }
}

// Small helper so routes can check if real SMTP is available
export const canSendRealEmail = !DEV_FALLBACK && HAS_SMTP_CREDS;

async function safeSend(options: nodemailer.SendMailOptions) {
  try {
    const info = await transporter.sendMail(options);

    if (DEV_FALLBACK) {
      // Rendered email in dev (no network). Dump a short preview.
      const rendered = (info as any).message?.toString?.();
      // eslint-disable-next-line no-console
      console.log('[mail][dev] rendered message:\n', rendered?.slice(0, 800) ?? info);
    } else {
      // eslint-disable-next-line no-console
      console.log('[mail] sent', {
        to: options.to,
        subject: options.subject,
        messageId: (info as any).messageId,
        accepted: (info as any).accepted,
        rejected: (info as any).rejected,
      });
    }

    return info;
  } catch (err: any) {
    // Don’t crash the server; let callers handle failures per use-case
    // eslint-disable-next-line no-console
    console.error('[mail] send failed:', err?.message || err);
    throw err;
  }
}

/**
 * Send verification email with a link (JWT or DB token URL).
 */
export async function sendVerifyEmail(to: string, verifyUrl: string) {
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#111">
      <h2>Verify your email</h2>
      <p>Click the button below to verify your email for DaySpring:</p>
      <p><a href="${verifyUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Verify my email</a></p>
      <p>If the button doesn’t work, paste this link in your browser:</p>
      <p style="word-break:break-all"><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link expires in 60 minutes.</p>
      <p>Thanks,<br/>DaySpring</p>
    </div>
  `;

  return safeSend({
    from,
    to,
    subject: 'Verify your email — DaySpring',
    html,
  });
}

export async function sendMail(opts: import('nodemailer').SendMailOptions) {
  if (!opts.from) opts.from = from; // default sender we computed earlier
  return safeSend(opts);
}

/**
 * Send password reset/forgot email with a reset link.
 * Your routes call: sendResetorForgotPasswordEmail(to, resetUrl, subject?, introText?)
 * We export BOTH spellings to avoid breaking existing imports.
 */
export async function sendResetorForgotPasswordEmail(
  to: string,
  resetUrl: string,
  subject = 'Reset your DaySpring password',
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
      <p>Thanks,<br/>DaySpring</p>
    </div>
  `;

  return safeSend({
    from,
    to,
    subject,
    html,
  });
}

// Alias with capital “Or” in case some files import the other name
export const sendResetOrForgotPasswordEmail = sendResetorForgotPasswordEmail;
