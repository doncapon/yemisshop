// src/lib/email.ts
import { Resend } from 'resend';
import nodemailer from 'nodemailer';

/**
 * Email transport using Resend with dev fallback.
 * - Primary: Resend (set RESEND_API_KEY and RESEND_FROM/EMAIL_FROM/SMTP_FROM)
 * - Dev fallback: stream transport (prints rendered message to console)
 */

const NODE_ENV = process.env.NODE_ENV ?? 'production';
const IS_PROD = NODE_ENV === 'production';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_ENV =
  process.env.RESEND_FROM ||
  process.env.EMAIL_FROM ||
  process.env.SMTP_FROM ||
  'Acme <onboarding@resend.dev>'; // safe default for quick tests

// === Transport selection =====================================================
const HAS_RESEND = Boolean(RESEND_API_KEY);
const resend = HAS_RESEND ? new Resend(RESEND_API_KEY) : null;

// Dev-only fallback (no network): render message to console
let devTransporter: nodemailer.Transporter | null = null;
if (!HAS_RESEND) {
  devTransporter = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'unix',
  });
  // eslint-disable-next-line no-console
  console.log('[mail] Using DEV fallback transport (stream). RESEND_API_KEY not set.');
}

// Expose whether we can send “for real”
export const canSendRealEmail = HAS_RESEND;

// === Low-level send helper ===================================================
type BasicMail = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  headers?: Record<string, string>;
  fromOverride?: string; // optional per-message override
};

async function safeSend(input: BasicMail) {
  const from = input.fromOverride || FROM_ENV;

  if (HAS_RESEND && resend) {
    // Resend send — supports to/cc/bcc arrays & reply_to
    const res = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      cc: input.cc,
      bcc: input.bcc,
      reply_to: input.replyTo,
      headers: input.headers,
    });

    if (res.error) {
      // eslint-disable-next-line no-console
      console.error('[mail] send failed (Resend):', res.error?.message || res.error);
      throw new Error(res.error?.message || 'Resend send failed');
    }

    // eslint-disable-next-line no-console
    console.log('[mail] sent (Resend)', {
      to: input.to,
      subject: input.subject,
      messageId: res.data?.id,
    });

    return res.data;
  }

  // Dev fallback: render the email to console
  if (devTransporter) {
    const info = await devTransporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      cc: input.cc,
      bcc: input.bcc,
      replyTo: input.replyTo,
      headers: input.headers,
    });
    const rendered = (info as any).message?.toString?.();
    // eslint-disable-next-line no-console
    console.log('[mail][dev] rendered message:\n', rendered?.slice(0, 1200) ?? info);
    return info;
  }

  throw new Error('No email transport available');
}

// === Your templates (unchanged) =============================================

/**
 * Send verification email with a link (JWT or DB token URL).
 */
export async function sendVerifyEmail(to: string, verifyUrl: string) {
  const subject = 'Verify your email — DaySpring';
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
  const text = [
    'Verify your email',
    `Open this link to verify: ${verifyUrl}`,
    'This link expires in 60 minutes.',
  ].join('\n');

  return safeSend({ to, subject, html, text });
}

/**
 * Generic “sendMail” for ad-hoc emails (keeps your previous API).
 * Example usage: await sendMail({ to, subject, html, text })
 */
export async function sendMail(opts: import('nodemailer').SendMailOptions) {
  const to = opts.to as string | string[];
  if (!to) throw new Error('sendMail: "to" is required');

  return safeSend({
    to,
    subject: String(opts.subject || ''),
    html: typeof opts.html === 'string' ? opts.html : undefined,
    text: typeof opts.text === 'string' ? opts.text : undefined,
    cc: opts.cc as any,
    bcc: opts.bcc as any,
    replyTo: opts.replyTo as any,
    headers: opts.headers as any,
    fromOverride: typeof opts.from === 'string' ? opts.from : undefined,
  });
}

/**
 * Send password reset/forgot email with a reset link.
 * Callers: sendResetorForgotPasswordEmail(to, resetUrl, subject?, introText?)
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

  const text = [
    'Password reset',
    introText,
    `Reset link: ${resetUrl}`,
    'This link expires in 60 minutes.',
  ].join('\n');

  return safeSend({ to, subject, html, text });
}

// Alias (kept for backwards compatibility)
export const sendResetOrForgotPasswordEmail = sendResetorForgotPasswordEmail;
