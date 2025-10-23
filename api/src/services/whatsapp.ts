// api/src/services/whatsapp.ts
import axios from 'axios';

type Provider = 'twilio' | 'meta' | 'log';

const {
  WHATSAPP_PROVIDER = 'log',
  // Twilio
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  // Meta (Cloud API)
  META_WHATSAPP_TOKEN,
  META_PHONE_NUMBER_ID,
} = process.env;

export type WhatsAppSendResult = { ok: boolean; id?: string; error?: string };

export async function sendWhatsApp(toE164: string, text: string): Promise<WhatsAppSendResult> {
  const provider = (WHATSAPP_PROVIDER as Provider) || 'log';
  console.log("in the whatsapp methoe")
  // Guard: require leading "whatsapp:" for Twilio, or ensure E.164 +234... format
  const toTwilio = TWILIO_WHATSAPP_FROM ? `whatsapp:${toE164}` : toE164;

  try {
    if (provider === 'twilio') {
      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
        return { ok: false, error: 'Twilio env not configured' };
      }

      const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      const auth = {
        username: TWILIO_ACCOUNT_SID,
        password: TWILIO_AUTH_TOKEN,
      };
      const form = new URLSearchParams();
      form.append('From', `whatsapp:${TWILIO_WHATSAPP_FROM}`);
      form.append('To', toTwilio); // whatsapp:+234...
      form.append('Body', text);

      const { data } = await axios.post(url, form, { auth });
      return { ok: true, id: data?.sid };
    }

    if (provider === 'meta') {
      if (!META_WHATSAPP_TOKEN || !META_PHONE_NUMBER_ID) {
        return { ok: false, error: 'Meta env not configured' };
      }

      const url = `https://graph.facebook.com/v18.0/${META_PHONE_NUMBER_ID}/messages`;
      const { data } = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to: toE164.replace(/^\+?/, ''), // meta expects digits
          type: 'text',
          text: { body: text },
        },
        { headers: { Authorization: `Bearer ${META_WHATSAPP_TOKEN}` } }
      );
      return { ok: true, id: data?.messages?.[0]?.id };
    }

    // Default: log only (for dev)
    console.log('[WhatsApp LOG]', toE164, text);
    return { ok: true, id: 'LOG' };
  } catch (e: any) {
    return { ok: false, error: e?.response?.data?.error?.message || e?.message || 'send failed' };
  }
}
