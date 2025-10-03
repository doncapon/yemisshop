import fetch from 'node-fetch';
import { env } from '../config/env.js';

const WA_BASE = 'https://graph.facebook.com/v21.0';

export async function waSendText(toE164: string, body: string) {
  if (!env.waToken || !env.waPhoneId) return undefined;
  const res = await fetch(`${WA_BASE}/${env.waPhoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.waToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toE164,
      type: 'text',
      text: { body }
    })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`WhatsApp send failed: ${res.status} ${t}`);
  }
  const json: any = await res.json().catch(() => ({}));
  return json.messages?.[0]?.id as string | undefined;
}
