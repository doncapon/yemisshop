// src/lib/sms.ts
// DEV: console OTP; real SMS later; WhatsApp guarded by envs
import https from 'https';

// Switch to true when you wire Twilio
const USE_REAL_SMS = false;

export async function sendSmsOtp(to: string, text: string) {
  if (!USE_REAL_SMS) {
    await new Promise((r) => setTimeout(r, 200));
    console.log(`\n[SMS:DEV] To: ${to}\n[SMS:DEV] Message: ${text}\n`);
    return { ok: true as const };
  }
  // TODO: real SMS integration here
}

export async function sendWhatsappOtp(toE164: string, code: string) {
  // Only run if properly configured
  console.log("i am here: " + toE164, "code: " , code)
  if (!process.env.WABA_PHONE_NUMBER_ID || !process.env.WABA_TOKEN) {
    console.warn('[whatsapp] Missing WABA envs; skipping send.');
    return { ok: false, error: 'WABA not configured' };
  }

  // DEV-ONLY: relax TLS if behind corporate MITM with custom CA
  // Prefer NODE_EXTRA_CA_CERTS to trust your corp CA instead of this.
  const devHttpsAgent =
    process.env.NODE_ENV !== 'production'
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${process.env.WABA_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WABA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toE164,
        type: 'template',
        template: {
          name: 'hello_world',
          language: { code: 'en_US' },
          //components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }],
        },
      }),
      // @ts-ignore – Node 18 fetch (undici) doesn't accept https.Agent directly in types,
      // but it will pass it to the dispatcher; keep this DEV-only if you must.
      agent: devHttpsAgent,
    } as any
  );

  if (!res.ok) {
  const errBody = await res.text();
  console.error('[whatsapp] send failed:', res.status, errBody);
  return { ok: false, error: errBody };
}
  return { ok: res.ok, error: res.ok ? undefined : await res.text() };
}


// Required envs:
// - WABA_PHONE_NUMBER_ID   (e.g. 123456789012345)
// - WABA_TOKEN             (Graph API access token; temp or system-user permanent)
// Optional:
// - WABA_TEMPLATE_NAME     (e.g. "supplier_notify"; must be APPROVED)
// - WABA_TEMPLATE_LANG     (e.g. "en" ; defaults to "en")

const WABA_ID = process.env.WABA_PHONE_NUMBER_ID || '';
const WABA_TOKEN = process.env.WABA_TOKEN || '';
const WABA_TEMPLATE_NAME = process.env.WABA_TEMPLATE_NAME || ''; // if provided, we send as template by default
const WABA_TEMPLATE_LANG = process.env.WABA_TEMPLATE_LANG || 'en';

// DEV-ONLY: relax TLS if behind corp MITM. Prefer proper CA via NODE_EXTRA_CA_CERTS instead.
const devHttpsAgent =
  process.env.NODE_ENV !== 'production'
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

type SendWhatsAppOpts = {
  /**
   * Force template or text. If omitted:
   * - uses template when WABA_TEMPLATE_NAME is set
   * - otherwise tries free-form text (requires 24h session)
   */
  useTemplate?: boolean;
  /** Override template name for this call */
  templateName?: string;
  /** Template language (default 'en') */
  langCode?: string;
  /**
   * Custom components for template (advanced).
   * If not provided, will send a single body parameter with the `msg` content.
   */
  components?: any[];
  /** Disable URL preview for text messages */
  previewUrl?: boolean;
};

/**
 * Send a WhatsApp message via Cloud API.
 * `toE164` must be in E.164 format, e.g. "+2348XXXXXXXXX"
 */
export async function sendWhatsApp(
  toE164: string,
  msg: string,
  opts: SendWhatsAppOpts = {}
): Promise<{ ok: true; id?: string } | { ok: false; error: string; status?: number }> {
  if (!WABA_ID || !WABA_TOKEN) {
    const reason = '[whatsapp] Missing WABA_PHONE_NUMBER_ID or WABA_TOKEN';
    console.warn(reason);
    return { ok: false, error: reason };
  }

  const url = `https://graph.facebook.com/v19.0/${WABA_ID}/messages`;

  const useTemplate =
    typeof opts.useTemplate === 'boolean'
      ? opts.useTemplate
      : Boolean(WABA_TEMPLATE_NAME);

  const headers = {
    Authorization: `Bearer ${WABA_TOKEN}`,
    'Content-Type': 'application/json',
  };

  let body: any;

  if (useTemplate) {
    const templateName = (opts.templateName || WABA_TEMPLATE_NAME).trim();
    if (!templateName) {
      return { ok: false, error: 'Template mode requested but no template name provided' };
    }

    // If no custom components passed, send the whole message as a single body parameter ({{1}})
    const components =
      opts.components ??
      [{ type: 'body', parameters: [{ type: 'text', text: msg }] }];

    body = {
      messaging_product: 'whatsapp',
      to: toE164,
      type: 'template',
      template: {
        name: templateName,
        language: { code: opts.langCode || WABA_TEMPLATE_LANG },
        components,
      },
    };
  } else {
    // Free-form text — works only if user has an active 24h session (has messaged you recently)
    body = {
      messaging_product: 'whatsapp',
      to: toE164,
      type: 'text',
      text: {
        preview_url: Boolean(opts.previewUrl),
        body: msg,
      },
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    // @ts-ignore Node fetch types don’t accept https.Agent; undici will pass it through
    agent: devHttpsAgent,
  } as any);

  const text = await res.text();
  if (!res.ok) {
    // Bubble up helpful error details from Graph API
    return { ok: false, error: text || res.statusText, status: res.status };
  }

  try {
    const data = JSON.parse(text);
    const id = data?.messages?.[0]?.id;
    return { ok: true, id };
  } catch {
    return { ok: true };
  }
}
