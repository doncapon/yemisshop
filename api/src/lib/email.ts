// src/lib/email.ts
import { Resend } from "resend";

const NODE_ENV = process.env.NODE_ENV ?? "development";
const IS_PROD = NODE_ENV === "production";

const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const FROM =
  process.env.RESEND_FROM ||
  process.env.EMAIL_FROM ||
  "DaySpring <no-reply@dayspring.com>";
const DEFAULT_REPLY_TO = process.env.EMAIL_REPLY_TO; // optional

export const canSendRealEmail = Boolean(RESEND_API_KEY);

// IMPORTANT: do NOT instantiate Resend when the key is missing
let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!RESEND_API_KEY) {
    // In prod, treat as a config error; in dev, we won't call this anyway
    throw new Error(
      "Missing RESEND_API_KEY. Set RESEND_API_KEY=re_... in your environment."
    );
  }
  if (!resendClient) {
    resendClient = new Resend(RESEND_API_KEY);
  }
  return resendClient;
}

type BasicMail = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string | string[];
};

async function safeSend({ to, subject, html, text, replyTo }: BasicMail) {
  // Normalize recipients
  const toList = Array.isArray(to) ? to : [to];

  // If no key, do a dev-preview and don't crash the API
  if (!canSendRealEmail) {
    const preview = {
      from: FROM,
      to: toList,
      subject,
      replyTo: replyTo ?? DEFAULT_REPLY_TO ?? undefined,
      htmlPreview: html?.slice(0, 200),
      textPreview: text?.slice(0, 200),
      env: NODE_ENV,
    };
    console.log("[mail][dev] would send", preview);

    // In production you might prefer to throw instead:
    if (IS_PROD) {
      // If you *want* production to hard-fail when misconfigured, uncomment:
      // throw new Error("Email is not configured (RESEND_API_KEY missing).");
    }

    return { id: "dev-preview" };
  }

  const resend = getResend();

  const base = {
    from: FROM,
    to: toList,
    subject,
    replyTo: replyTo ?? DEFAULT_REPLY_TO ?? undefined,
  } as const;

  // Send HTML if present, else TEXT
  if (html && html.trim().length > 0) {
    const { data, error } = await resend.emails.send({
      ...base,
      html,
    });
    if (error) throw error;
    console.log("[mail] sent", { to: toList, subject, id: data?.id });
    return data;
  }

  if (text && text.trim().length > 0) {
    const { data, error } = await resend.emails.send({
      ...base,
      text,
    });
    if (error) throw error;
    console.log("[mail] sent", { to: toList, subject, id: data?.id });
    return data;
  }

  throw new Error("safeSend: either html or text must be provided");
}

/** Verify-email message */
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
  return safeSend({ to, subject: "Verify your email — DaySpring", html });
}

/** Generic helper so routes can send adhoc emails */
export async function sendMail(opts: BasicMail) {
  return safeSend(opts);
}

/** Password reset email */
export async function sendResetorForgotPasswordEmail(
  to: string,
  resetUrl: string,
  subject = "Reset your DaySpring password",
  introText = "Click the button below to reset your password:"
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
