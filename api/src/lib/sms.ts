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
          name: 'otp_login',
          language: { code: 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }],
        },
      }),
      // @ts-ignore – Node 18 fetch (undici) doesn't accept https.Agent directly in types,
      // but it will pass it to the dispatcher; keep this DEV-only if you must.
      agent: devHttpsAgent,
    } as any
  );

  return { ok: res.ok, error: res.ok ? undefined : await res.text() };
}
