// src/lib/email.ts
import { continueOnNewPage } from 'pdfkit';
import { Resend } from 'resend';

const NODE_ENV = process.env.NODE_ENV ?? 'production';
const IS_PROD = NODE_ENV === 'production';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.RESEND_FROM || process.env.EMAIL_FROM || 'DaySpring <no-reply@dayspring.com>';
const DEFAULT_REPLY_TO = process.env.EMAIL_REPLY_TO; // optional

export const canSendRealEmail = Boolean(RESEND_API_KEY);

const resend = new Resend(RESEND_API_KEY);

type BasicMail = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string | string[];
};
async function safeSend({ to, subject, html, text, replyTo }: BasicMail) {
  console.log("ia m")
  if (!canSendRealEmail) {
    console.log("here: ")
    console.log('[mail][dev] would send', { from: FROM, to, subject, html: html?.slice(0, 200) ?? text });
    return { id: 'dev-preview' };
  }

  const base = {
    from: FROM,
    to: 'lordshegz@gmail.com',
    // Array.isArray(to) ? to : [to],
    subject,
    // ✅ correct key for the Node SDK:
    replyTo: replyTo ?? DEFAULT_REPLY_TO,
  } as const;

  if (html && html.trim().length > 0) {
    // send with HTML branch
    const { data, error } = await resend.emails.send({
      ...base,
      html,                      // present → picks the { html } overload
    });
    if (error) throw error;
    console.log('[mail] sent', { to, subject, id: data?.id });
    return data;
  }

  if (text && text.trim().length > 0) {
    // send with TEXT branch
    const { data, error } = await resend.emails.send({
      ...base,
      text,                      // present → picks the { text } overload
    });
    if (error) throw error;
    console.log('[mail] sent', { to, subject, id: data?.id });
    return data;
  }

  throw new Error('safeSend: either html or text must be provided');
}


/** Verify-email message */
export async function sendVerifyEmail(to: string, verifyUrl: string) {
  console.log("hello world")
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
  return safeSend({ to, subject: 'Verify your email — DaySpring', html });
}

/** Generic helper so routes can send adhoc emails */
export async function sendMail(opts: BasicMail) {
  return safeSend(opts);
}

/** Password reset email (same template text you used) */
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
  return safeSend({ to, subject, html });
}

// Alias to match any existing imports
export const sendResetOrForgotPasswordEmail = sendResetorForgotPasswordEmail;
