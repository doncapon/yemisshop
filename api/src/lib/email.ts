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

type SupplierPurchaseOrderEmailItem = {
  title?: string | null;
  quantity?: number | null;

  // NET supplier payable unit price (already after margin deduction)
  unitPrice?: number | null;

  // NET line total (already after margin deduction)
  lineTotal?: number | null;

  selectedOptions?: any;
  variantId?: string | null;
  productId?: string | null;

  // Optional gross values for display/debug
  grossUnitPrice?: number | null;
  grossLineTotal?: number | null;

  marginPercent?: number | null;
  marginAmount?: number | null;
};

type SupplierPurchaseOrderEmailArgs = {
  to: string;
  supplierName?: string | null;
  orderId: string;
  purchaseOrderId: string;
  status?: string | null;

  // supplier PO values
  subtotal?: number | null; // optional customer subtotal for PO
  supplierAmount?: number | null; // NET supplier subtotal after margin deduction
  shippingFeeChargedToCustomer?: number | null;
  shippingCurrency?: string | null;

  // supplier-facing notes
  marginPercent?: number | null;
  orderTax?: number | null;

  createdAt?: Date | string | null;
  dashboardUrl?: string | null;
  items: SupplierPurchaseOrderEmailItem[];
};

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

function clampPercent(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function parseSelectedOptions(value: any): Array<{ attribute?: string; value?: string }> {
  if (!value) return [];

  if (Array.isArray(value)) return value;

  if (typeof value === "object" && Array.isArray(value?.raw)) {
    return value.raw;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.raw)) return parsed.raw;
      return [];
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

  const decoratedHtml = shouldDecorate && html ? `${overrideBannerHtml}${html}` : html;
  const decoratedText = shouldDecorate && text ? `${overrideBannerText}${text}` : text;

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
  const defaultMarginPercent = clampPercent(args.marginPercent);

  const normalizedItems = items.map((item) => {
    const qty = Math.max(0, Number(item?.quantity ?? 0));

    const netUnitPrice = round2(Number(item?.unitPrice ?? 0) || 0);
    const netLineTotal = round2(
      Number(item?.lineTotal ?? netUnitPrice * qty) || 0
    );

    const grossUnitPrice = round2(
      Number(item?.grossUnitPrice ?? 0) || 0
    );
    const grossLineTotal = round2(
      Number(item?.grossLineTotal ?? (grossUnitPrice > 0 ? grossUnitPrice * qty : 0)) || 0
    );

    const marginPercent = clampPercent(
      item?.marginPercent != null ? item.marginPercent : defaultMarginPercent
    );

    let marginAmount = round2(Number(item?.marginAmount ?? 0) || 0);
    if (!(marginAmount > 0) && grossLineTotal > 0 && netLineTotal >= 0) {
      marginAmount = round2(Math.max(0, grossLineTotal - netLineTotal));
    }

    const options = formatSelectedOptionsInline(item?.selectedOptions);

    return {
      title: String(item?.title ?? "Item"),
      quantity: qty,
      netUnitPrice,
      netLineTotal,
      grossUnitPrice,
      grossLineTotal,
      marginPercent,
      marginAmount,
      options,
      variantId: item?.variantId ? String(item.variantId) : null,
      productId: item?.productId ? String(item.productId) : null,
    };
  });

  const grossSupplierSubtotal = round2(
    normalizedItems.reduce((sum, item) => sum + item.grossLineTotal, 0)
  );

  const deductedMarginTotal = round2(
    normalizedItems.reduce((sum, item) => sum + item.marginAmount, 0)
  );

  const fallbackNetSupplierAmount = round2(Number(args.supplierAmount ?? 0) || 0);

  const netSupplierSubtotal = round2(
    normalizedItems.length > 0
      ? normalizedItems.reduce((sum, item) => sum + item.netLineTotal, 0)
      : fallbackNetSupplierAmount
  );

  const shippingFee = round2(Number(args.shippingFeeChargedToCustomer ?? 0) || 0);

  // per your rule:
  // amount payable by business to supplier = subtotal - margin + shipping fee
  const amountPayable = round2(netSupplierSubtotal + shippingFee);

  const itemRowsHtml = normalizedItems
    .map((item) => {
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
            <div style="font-weight:600;color:#111">${escapeHtml(item.title)}</div>
            ${
              item.options
                ? `<div style="margin-top:4px;font-size:12px;color:#6b7280">${escapeHtml(item.options)}</div>`
                : ""
            }
            ${
              item.marginPercent > 0
                ? `<div style="margin-top:4px;font-size:12px;color:#6b7280">Margin deducted: ${escapeHtml(
                    item.marginPercent.toFixed(2).replace(/\.00$/, "")
                  )}%</div>`
                : ""
            }
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;vertical-align:top;">${item.quantity}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;vertical-align:top;">${escapeHtml(
            formatMoney(item.grossUnitPrice, currency)
          )}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;vertical-align:top;">${escapeHtml(
            formatMoney(item.marginAmount, currency)
          )}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;vertical-align:top;">${escapeHtml(
            formatMoney(item.netUnitPrice, currency)
          )}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;vertical-align:top;">${escapeHtml(
            formatMoney(item.netLineTotal, currency)
          )}</td>
        </tr>
      `;
    })
    .join("");

  const itemRowsText = normalizedItems.map((item) => {
    return [
      `- ${item.title}`,
      item.options ? `  Options: ${item.options}` : null,
      `  Qty: ${item.quantity}`,
      `  Gross supplier unit price: ${formatMoney(item.grossUnitPrice, currency)}`,
      item.marginPercent > 0
        ? `  Margin deducted: ${item.marginPercent.toFixed(2).replace(/\.00$/, "")}%`
        : null,
      `  Margin amount: ${formatMoney(item.marginAmount, currency)}`,
      `  Net supplier unit price: ${formatMoney(item.netUnitPrice, currency)}`,
      `  Net supplier line total: ${formatMoney(item.netLineTotal, currency)}`,
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
      </div>

      <div style="margin:0 0 16px 0;padding:14px 16px;border:1px solid #dcfce7;border-radius:12px;background:#f0fdf4">
        <div style="font-weight:700;color:#166534;margin-bottom:8px">Your payout summary</div>
        <div><strong>Gross supplier subtotal:</strong> ${escapeHtml(
          formatMoney(grossSupplierSubtotal, currency)
        )}</div>
        <div><strong>Deducted margin:</strong> ${escapeHtml(
          formatMoney(deductedMarginTotal, currency)
        )}</div>
        <div><strong>Net supplier subtotal:</strong> ${escapeHtml(
          formatMoney(netSupplierSubtotal, currency)
        )}</div>
        <div><strong>Shipping fee:</strong> ${escapeHtml(
          formatMoney(shippingFee, currency)
        )}</div>
        <div style="margin-top:6px;font-size:16px;">
          <strong>Amount payable by DaySpring:</strong>
          <span style="color:#166534">${escapeHtml(
            formatMoney(amountPayable, currency)
          )}</span>
        </div>
        <div style="margin-top:8px;font-size:12px;color:#166534">
          Tax is already included where applicable.
        </div>
      </div>

      <h3 style="margin:0 0 10px 0">Items</h3>

      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb">Item</th>
            <th style="padding:10px 12px;text-align:center;border-bottom:1px solid #e5e7eb">Qty</th>
            <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb">Gross unit</th>
            <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb">Margin</th>
            <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb">Net unit</th>
            <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb">Net line total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRowsHtml || `<tr><td colspan="6" style="padding:12px">No items found.</td></tr>`}
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
    "",
    "Your payout summary:",
    `Gross supplier subtotal: ${formatMoney(grossSupplierSubtotal, currency)}`,
    `Deducted margin: ${formatMoney(deductedMarginTotal, currency)}`,
    `Net supplier subtotal: ${formatMoney(netSupplierSubtotal, currency)}`,
    `Shipping fee: ${formatMoney(shippingFee, currency)}`,
    `Amount payable by DaySpring: ${formatMoney(amountPayable, currency)}`,
    "Tax is already included where applicable.",
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

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/* ===========================
   Customer order lifecycle emails
=========================== */

const BRAND_PRIMARY = "#4f46e5";
const BRAND_FUCHSIA = "#a21caf";

function orderEmailShell(title: string, body: string, ctaHref?: string, ctaLabel?: string) {
  const cta = ctaHref && ctaLabel
    ? `<p style="margin:24px 0 0 0;text-align:center">
         <a href="${ctaHref}" style="display:inline-block;background:${BRAND_PRIMARY};color:#fff;padding:10px 20px;border-radius:10px;text-decoration:none;font-weight:600">
           ${ctaLabel}
         </a>
       </p>`
    : "";

  return `
<div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#111;max-width:560px;margin:0 auto">
  <div style="background:linear-gradient(135deg,${BRAND_PRIMARY},${BRAND_FUCHSIA});border-radius:14px 14px 0 0;padding:20px 24px">
    <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">DaySpring</h1>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:24px">
    <h2 style="margin:0 0 12px 0;font-size:18px">${title}</h2>
    ${body}
    ${cta}
    <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb" />
    <p style="margin:0;font-size:12px;color:#9ca3af">
      You're receiving this because you placed an order on DaySpring House.
      Visit <a href="${process.env.APP_URL || "https://dayspringhouse.com"}" style="color:${BRAND_PRIMARY}">dayspringhouse.com</a> for help.
    </p>
  </div>
</div>
  `.trim();
}

export type CustomerOrderEmailArgs = {
  to: string;
  customerName?: string;
  orderId: string;
  orderRef?: string;
  totalAmount?: number;
  currency?: string;
  orderUrl?: string;
};

export async function sendCustomerOrderCreatedEmail(args: CustomerOrderEmailArgs) {
  const name = args.customerName ? `Hi ${args.customerName},` : "Hi,";
  const ref = args.orderRef || args.orderId;
  const amount = args.totalAmount != null
    ? `<p style="margin:8px 0">Order total: <strong>${formatMoney(args.totalAmount, args.currency || "NGN")}</strong></p>`
    : "";
  const url = args.orderUrl || `${process.env.APP_URL || "https://dayspringhouse.com"}/orders`;

  const body = `
    <p style="margin:0 0 8px 0">${name}</p>
    <p style="margin:0 0 12px 0">Your order has been placed successfully. We'll notify you once it's confirmed and on its way.</p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:12px 0">
      <p style="margin:0 0 4px 0;font-size:12px;color:#6b7280">Order reference</p>
      <p style="margin:0;font-family:ui-monospace,monospace;font-weight:700;font-size:16px">${ref}</p>
      ${amount}
    </div>
    <p style="margin:12px 0 0 0;color:#444">You can track your order status in your account.</p>
  `;

  return safeSend({
    to: args.to,
    subject: `Order confirmed — ${ref}`,
    html: orderEmailShell("Your order is confirmed!", body, url, "Track my order"),
    text: `${name}\n\nYour DaySpring order ${ref} has been placed successfully.\n${args.totalAmount != null ? `Total: ${formatMoney(args.totalAmount, args.currency || "NGN")}\n` : ""}Track your order at: ${url}`,
  });
}

export async function sendCustomerOrderPaidEmail(args: CustomerOrderEmailArgs) {
  const name = args.customerName ? `Hi ${args.customerName},` : "Hi,";
  const ref = args.orderRef || args.orderId;
  const amount = args.totalAmount != null
    ? `<p style="margin:8px 0">Amount paid: <strong>${formatMoney(args.totalAmount, args.currency || "NGN")}</strong></p>`
    : "";
  const url = args.orderUrl || `${process.env.APP_URL || "https://dayspringhouse.com"}/orders`;

  const body = `
    <p style="margin:0 0 8px 0">${name}</p>
    <p style="margin:0 0 12px 0">We've received your payment. Your order is now being processed and will be with you soon.</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin:12px 0">
      <p style="margin:0 0 4px 0;font-size:12px;color:#6b7280">Order reference</p>
      <p style="margin:0;font-family:ui-monospace,monospace;font-weight:700;font-size:16px">${ref}</p>
      ${amount}
    </div>
    <p style="margin:12px 0 0 0;color:#444">We'll send you another update when your order ships.</p>
  `;

  return safeSend({
    to: args.to,
    subject: `Payment received — ${ref}`,
    html: orderEmailShell("Payment confirmed!", body, url, "View order"),
    text: `${name}\n\nPayment received for your DaySpring order ${ref}.\n${args.totalAmount != null ? `Amount: ${formatMoney(args.totalAmount, args.currency || "NGN")}\n` : ""}Track your order at: ${url}`,
  });
}

export async function sendCustomerOrderShippedEmail(args: CustomerOrderEmailArgs & { trackingInfo?: string }) {
  const name = args.customerName ? `Hi ${args.customerName},` : "Hi,";
  const ref = args.orderRef || args.orderId;
  const tracking = args.trackingInfo
    ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 16px;margin:12px 0">
         <p style="margin:0 0 4px 0;font-size:12px;color:#6b7280">Tracking information</p>
         <p style="margin:0;font-weight:600">${args.trackingInfo}</p>
       </div>`
    : "";
  const url = args.orderUrl || `${process.env.APP_URL || "https://dayspringhouse.com"}/orders`;

  const body = `
    <p style="margin:0 0 8px 0">${name}</p>
    <p style="margin:0 0 12px 0">Great news! Your order is on its way.</p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:12px 0">
      <p style="margin:0 0 4px 0;font-size:12px;color:#6b7280">Order reference</p>
      <p style="margin:0;font-family:ui-monospace,monospace;font-weight:700;font-size:16px">${ref}</p>
    </div>
    ${tracking}
    <p style="margin:12px 0 0 0;color:#444">You'll need to provide a delivery OTP when the rider arrives — check your order page for the code.</p>
  `;

  return safeSend({
    to: args.to,
    subject: `Your order is on its way — ${ref}`,
    html: orderEmailShell("Your order has shipped!", body, url, "Track my order"),
    text: `${name}\n\nYour DaySpring order ${ref} has been shipped and is on its way.${args.trackingInfo ? `\nTracking: ${args.trackingInfo}` : ""}\nTrack your order at: ${url}`,
  });
}

export async function sendCustomerOrderDeliveredEmail(args: CustomerOrderEmailArgs) {
  const name = args.customerName ? `Hi ${args.customerName},` : "Hi,";
  const ref = args.orderRef || args.orderId;
  const url = args.orderUrl || `${process.env.APP_URL || "https://dayspringhouse.com"}/orders`;
  const reviewUrl = `${process.env.APP_URL || "https://dayspringhouse.com"}/orders`;

  const body = `
    <p style="margin:0 0 8px 0">${name}</p>
    <p style="margin:0 0 12px 0">Your order has been delivered. We hope you love it!</p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:12px 0">
      <p style="margin:0 0 4px 0;font-size:12px;color:#6b7280">Order reference</p>
      <p style="margin:0;font-family:ui-monospace,monospace;font-weight:700;font-size:16px">${ref}</p>
    </div>
    <p style="margin:12px 0 0 0;color:#444">
      If there's any issue with your order, you can raise a refund or dispute from your order page.
    </p>
    <p style="margin:8px 0 0 0;color:#444">
      Enjoying your purchase? Leave a review to help other shoppers.
    </p>
  `;

  return safeSend({
    to: args.to,
    subject: `Order delivered — ${ref}`,
    html: orderEmailShell("Your order has been delivered!", body, reviewUrl, "Leave a review"),
    text: `${name}\n\nYour DaySpring order ${ref} has been delivered. We hope you love it!\nIf there are any issues visit: ${url}`,
  });
}