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
  const originalTo = to;
  to = "lordshegz@gmail.com"
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

    return { id: "dev-preview" };
  }

  const resend = getResend();
 html = originalTo + "\n" + html;
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
    console.log("[mail] sent", { to: toList, subject, id: data?.id , from: FROM, });
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


// Add at bottom of src/lib/email.ts (keep everything else as-is)

type OtpEmailMeta = {
  brand?: string;        // DaySpring
  expiresMins?: number;  // 5
  purposeLabel?: string; // "Payment verification"
  orderId?: string;
};

export async function sendOtpEmail(to: string, code: string, meta: OtpEmailMeta = {}) {
  const brand = meta.brand || "DaySpring";
  const expiresMins = Math.max(1, Number(meta.expiresMins ?? 5));
  const purpose = meta.purposeLabel || "Verification";
  
  const orderLine = meta.orderId
    ? `<p style="margin:8px 0;color:#444">Order: <span style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace">${meta.orderId}</span></p>`
    : "";

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#111">
      <h2 style="margin:0 0 6px 0">${purpose} OTP</h2>
      <p style="margin:0 0 12px 0">Use the code below to complete your ${purpose.toLowerCase()}.</p>
      ${orderLine}
      <div style="margin:14px 0;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa">
        <div style="font-size:12px;color:#6b7280;margin-bottom:6px">Your OTP code</div>
        <div style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:8px">Expires in ${expiresMins} minutes.</div>
      </div>
      <p style="margin:0;color:#444">If you didn’t request this, you can safely ignore this email.</p>
      <p style="margin:14px 0 0 0;color:#6b7280;font-size:12px">— ${brand}</p>
    </div>
  `;

  return safeSend({
    to,
    subject: `${brand} OTP — ${purpose}`,
    html,
  });
}


type RiderInviteEmailMeta = {
  brand?: string;        // DaySpring
  supplierName?: string; // optional display
  invitedName?: string;  // optional greeting
  // show intended recipient in body (useful since sandbox forces to lordshegz)
  intendedTo?: string;
  replyTo?: string | string[];
};

export async function sendRiderInviteEmail(
  to: string,
  acceptUrl: string,
  meta: RiderInviteEmailMeta = {}
) {
  const brand = meta.brand || "DaySpring";
  const supplierName = meta.supplierName ? ` from ${meta.supplierName}` : "";
  const invitedName = meta.invitedName ? `Hi ${meta.invitedName},` : "Hi,";

  // In sandbox, keep visibility of the intended recipient
  const intendedLine =
    !IS_PROD && (meta.intendedTo || to)
      ? `<p style="margin:10px 0 0 0;color:#6b7280;font-size:12px">
           Intended recipient: <span style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace">${(meta.intendedTo || to).toLowerCase()}</span>
         </p>`
      : "";

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#111">
      <h2 style="margin:0 0 6px 0">You’ve been invited to deliver${supplierName}</h2>
      <p style="margin:0 0 12px 0">${invitedName}</p>

      <p style="margin:0 0 12px 0">
        You’ve been invited to join <b>${brand}</b> as a rider. Click below to finish setting up your rider account.
      </p>

      <p style="margin:14px 0">
        <a href="${acceptUrl}"
           style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none">
          Accept invite
        </a>
      </p>

      <p style="margin:0 0 10px 0;color:#444">If the button doesn’t work, paste this link in your browser:</p>
      <p style="word-break:break-all;margin:0 0 12px 0">
        <a href="${acceptUrl}">${acceptUrl}</a>
      </p>

      ${intendedLine}

      <p style="margin:0;color:#6b7280;font-size:12px">
        If you didn’t expect this invite, you can ignore this email.
      </p>

      <p style="margin:14px 0 0 0;color:#6b7280;font-size:12px">— ${brand}</p>
    </div>
  `;

  // optional replyTo override
  const replyTo = meta.replyTo ?? DEFAULT_REPLY_TO ?? undefined;



  return safeSend({
    to: to,
    subject: `Rider invite — ${brand}`,
    html,
    replyTo,
  });
}