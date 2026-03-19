import { Resend } from "resend";

const NODE_ENV = process.env.NODE_ENV ?? "development";
const IS_PROD = NODE_ENV === "production";

const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const FROM =
  process.env.RESEND_FROM ||
  process.env.EMAIL_FROM ||
  "DaySpring <no-reply@dayspring.com>";
const DEFAULT_REPLY_TO = process.env.EMAIL_REPLY_TO || undefined;

// Optional sandbox override for dev/testing
const EMAIL_SANDBOX_TO = (process.env.EMAIL_SANDBOX_TO || "").trim();

export const canSendRealEmail = Boolean(RESEND_API_KEY);

let resendClient: Resend | null = null;

const MAIL_FORCE_TO = String(process.env.MAIL_FORCE_TO || "").trim();

function getResend(): Resend {
  if (!RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY. Set RESEND_API_KEY in your environment.");
  }
  if (!resendClient) {
    resendClient = new Resend(RESEND_API_KEY);
  }
  return resendClient;
}

type MailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};

type BasicMail = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string | string[];
  attachments?: MailAttachment[];
};

function resolveRecipients(to: string | string[]) {
  const originalTo = Array.isArray(to) ? to : [to];

  if (MAIL_FORCE_TO) {
    const forced = [MAIL_FORCE_TO];
    console.log("[mail] recipient override active", {
      originalTo,
      forcedTo: forced,
      env: NODE_ENV,
    });
    return {
      originalTo,
      effectiveTo: forced,
      mode: "forced" as const,
    };
  }

  if (EMAIL_SANDBOX_TO) {
    const sandboxed = [EMAIL_SANDBOX_TO];
    console.log("[mail] sandbox recipient override active", {
      originalTo,
      sandboxTo: sandboxed,
      env: NODE_ENV,
    });
    return {
      originalTo,
      effectiveTo: sandboxed,
      mode: "sandbox" as const,
    };
  }

  return {
    originalTo,
    effectiveTo: originalTo,
    mode: "normal" as const,
  };
}

export async function safeSend({
  to,
  subject,
  html,
  text,
  replyTo,
  attachments,
}: BasicMail) {
  const { originalTo, effectiveTo, mode } = resolveRecipients(to);
  const shouldDecorate = mode === "forced" || mode === "sandbox";

  const overrideBannerHtml = shouldDecorate
    ? `
      <div style="margin:0 0 12px 0;padding:10px 12px;border:1px solid #f59e0b;border-radius:10px;background:#fffbeb;color:#92400e;font-size:12px;line-height:1.5;">
        <div><strong>TEST OVERRIDE ACTIVE</strong></div>
        <div><strong>Original recipient(s):</strong> ${originalTo.join(", ")}</div>
        <div><strong>Actual recipient:</strong> ${effectiveTo.join(", ")}</div>
        <div><strong>Environment:</strong> ${NODE_ENV}</div>
        <div><strong>Original subject:</strong> ${subject}</div>
        <div><strong>Mode:</strong> ${mode}</div>
      </div>
    `
    : "";

  const overrideBannerText = shouldDecorate
    ? [
        "TEST OVERRIDE ACTIVE",
        `Original recipient(s): ${originalTo.join(", ")}`,
        `Actual recipient: ${effectiveTo.join(", ")}`,
        `Environment: ${NODE_ENV}`,
        `Original subject: ${subject}`,
        `Mode: ${mode}`,
        "",
      ].join("\n")
    : "";

  const decoratedHtml =
    shouldDecorate && html ? `${overrideBannerHtml}${html}` : html;

  const decoratedText =
    shouldDecorate && text ? `${overrideBannerText}${text}` : text;

  const effectiveSubject = shouldDecorate
    ? `[TEST→${originalTo.join(", ")}] ${subject}`
    : subject;

  if (!canSendRealEmail) {
    console.log("[mail][dev] would send", {
      from: FROM,
      to: effectiveTo,
      originalTo,
      subject: effectiveSubject,
      replyTo: replyTo ?? DEFAULT_REPLY_TO ?? undefined,
      htmlPreview: decoratedHtml?.slice(0, 200),
      textPreview: decoratedText?.slice(0, 200),
      attachments: attachments?.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        size: typeof a.content === "string" ? a.content.length : a.content.byteLength,
      })),
      env: NODE_ENV,
      mode,
    });

    return { id: "dev-preview" };
  }

  const resend = getResend();

  const base = {
    from: FROM,
    to: effectiveTo,
    subject: effectiveSubject,
    replyTo: replyTo ?? DEFAULT_REPLY_TO ?? undefined,
  } as const;

  if (decoratedHtml && decoratedHtml.trim()) {
    const { data, error } = await resend.emails.send({
      ...base,
      html: decoratedHtml,
      // @ts-ignore
      attachments,
    });
    if (error) throw error;
    console.log("[mail] sent", {
      to: effectiveTo,
      originalTo,
      subject: effectiveSubject,
      id: data?.id,
      mode,
    });
    return data;
  }

  if (decoratedText && decoratedText.trim()) {
    const { data, error } = await resend.emails.send({
      ...base,
      text: decoratedText,
      // @ts-ignore
      attachments,
    });
    if (error) throw error;
    console.log("[mail] sent", {
      to: effectiveTo,
      originalTo,
      subject: effectiveSubject,
      id: data?.id,
      mode,
    });
    return data;
  }

  throw new Error("safeSend: either html or text must be provided");
}

export async function sendMail(opts: BasicMail) {
  return safeSend(opts);
}

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

export const sendResetOrForgotPasswordEmail = sendResetorForgotPasswordEmail;

type OtpEmailMeta = {
  brand?: string;
  expiresMins?: number;
  purposeLabel?: string;
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
      <h2 style="margin:0 0 6px 0">${purpose}</h2>
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
  brand?: string;
  supplierName?: string;
  invitedName?: string;
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

  return safeSend({
    to,
    subject: `Rider invite — ${brand}`,
    html,
    replyTo: meta.replyTo ?? DEFAULT_REPLY_TO,
  });
}