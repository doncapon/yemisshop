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

/* ===========================
   Supplier purchase order email
=========================== */

type SupplierPurchaseOrderEmailItem = {
  title?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  selectedOptions?: any;
  variantId?: string | null;
  productId?: string | null;
};

type SupplierPurchaseOrderEmailArgs = {
  to: string;
  supplierName?: string | null;
  orderId: string;
  purchaseOrderId: string;
  status?: string | null;
  subtotal?: number | null;
  supplierAmount?: number | null;
  shippingFeeChargedToCustomer?: number | null;
  shippingCurrency?: string | null;
  createdAt?: Date | string | null;
  dashboardUrl?: string | null;
  items: SupplierPurchaseOrderEmailItem[];
};

function formatMoney(amount: number | null | undefined, currency?: string | null) {
  const code = String(currency || "NGN").toUpperCase();
  const value = Number(amount ?? 0);

  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${code} ${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
  }
}

function parseSelectedOptions(value: any): Array<{ attribute?: string; value?: string }> {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function formatSelectedOptionsInline(value: any) {
  const arr = parseSelectedOptions(value);

  return arr
    .map((o: any) => {
      const a = String(o?.attribute ?? "").trim();
      const v = String(o?.value ?? "").trim();
      if (a && v) return `${a}: ${v}`;
      return v || a || "";
    })
    .filter(Boolean)
    .join(", ");
}

function escapeHtml(input: any) {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendSupplierPurchaseOrderEmail(
  args: SupplierPurchaseOrderEmailArgs
) {
  const supplierName = String(args.supplierName ?? "").trim() || "Supplier";
  const currency = String(args.shippingCurrency ?? "NGN").trim() || "NGN";
  const dashboardUrl =
    String(
      args.dashboardUrl ??
        process.env.SUPPLIER_DASHBOARD_URL ??
        process.env.APP_URL ??
        ""
    ).trim() || null;

  const items = Array.isArray(args.items) ? args.items : [];

  const itemRowsHtml = items
    .map((item) => {
      const qty = Number(item?.quantity ?? 0);
      const unitPrice = Number(item?.unitPrice ?? 0);
      const lineTotal = Number(item?.lineTotal ?? unitPrice * qty);
      const options = formatSelectedOptionsInline(item?.selectedOptions);

      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
            <div style="font-weight:600;color:#111">${escapeHtml(item?.title ?? "Item")}</div>
            ${
              options
                ? `<div style="margin-top:4px;font-size:12px;color:#6b7280">${escapeHtml(options)}</div>`
                : ""
            }
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;vertical-align:top;">${qty}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;vertical-align:top;">${escapeHtml(
            formatMoney(unitPrice, currency)
          )}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;vertical-align:top;">${escapeHtml(
            formatMoney(lineTotal, currency)
          )}</td>
        </tr>
      `;
    })
    .join("");

  const itemRowsText = items.map((item) => {
    const qty = Number(item?.quantity ?? 0);
    const unitPrice = Number(item?.unitPrice ?? 0);
    const lineTotal = Number(item?.lineTotal ?? unitPrice * qty);
    const options = formatSelectedOptionsInline(item?.selectedOptions);

    return [
      `- ${String(item?.title ?? "Item")}`,
      options ? `  Options: ${options}` : null,
      `  Qty: ${qty}`,
      `  Supplier unit price: ${formatMoney(unitPrice, currency)}`,
      `  Supplier line total: ${formatMoney(lineTotal, currency)}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const ctaHtml = dashboardUrl
    ? `
      <p style="margin:20px 0 0 0">
        <a
          href="${escapeHtml(dashboardUrl)}"
          style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none"
        >
          Open supplier dashboard
        </a>
      </p>
    `
    : "";

  const ctaText = dashboardUrl ? `Supplier dashboard: ${dashboardUrl}\n\n` : "";

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#111">
      <h2 style="margin:0 0 6px 0">New purchase order received</h2>
      <p style="margin:0 0 12px 0">Hello ${escapeHtml(supplierName)},</p>
      <p style="margin:0 0 16px 0">
        You have received a new purchase order on <strong>DaySpring</strong>.
      </p>

      <div style="margin:0 0 16px 0;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa">
        <div><strong>Order ID:</strong> <span style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace">${escapeHtml(
          args.orderId
        )}</span></div>
        <div><strong>Purchase Order ID:</strong> <span style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace">${escapeHtml(
          args.purchaseOrderId
        )}</span></div>
        <div><strong>Status:</strong> ${escapeHtml(args.status ?? "CREATED")}</div>
        <div><strong>Customer subtotal:</strong> ${escapeHtml(
          formatMoney(args.subtotal, currency)
        )}</div>
        <div><strong>Your amount:</strong> ${escapeHtml(
          formatMoney(args.supplierAmount, currency)
        )}</div>
        <div><strong>Shipping charged to customer:</strong> ${escapeHtml(
          formatMoney(args.shippingFeeChargedToCustomer, currency)
        )}</div>
      </div>

      <h3 style="margin:0 0 10px 0">Items</h3>

      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb">Item</th>
            <th style="padding:10px 12px;text-align:center;border-bottom:1px solid #e5e7eb">Qty</th>
            <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb">Supplier unit price</th>
            <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb">Supplier line total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRowsHtml || `<tr><td colspan="4" style="padding:12px">No items found.</td></tr>`}
        </tbody>
      </table>

      ${ctaHtml}

      <p style="margin:18px 0 0 0;color:#444">
        Please log in to your supplier dashboard to process this order.
      </p>

      <p style="margin:14px 0 0 0;color:#6b7280;font-size:12px">— DaySpring</p>
    </div>
  `;

  const text = [
    `Hello ${supplierName},`,
    "",
    "You have received a new purchase order on DaySpring.",
    "",
    `Order ID: ${args.orderId}`,
    `Purchase Order ID: ${args.purchaseOrderId}`,
    `Status: ${String(args.status ?? "CREATED")}`,
    `Customer subtotal: ${formatMoney(args.subtotal, currency)}`,
    `Your amount: ${formatMoney(args.supplierAmount, currency)}`,
    `Shipping charged to customer: ${formatMoney(args.shippingFeeChargedToCustomer, currency)}`,
    "",
    "Items:",
    ...(itemRowsText.length ? itemRowsText : ["- No items found."]),
    "",
    ctaText,
    "Please log in to your supplier dashboard to process this order.",
    "",
    "DaySpring",
  ].join("\n");

  return safeSend({
    to: args.to,
    subject: `New purchase order ${args.purchaseOrderId} for order ${args.orderId}`,
    html,
    text,
  });
}