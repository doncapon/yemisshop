// src/lib/sms.ts
// If you don't have Twilio, you can log OTP to console for now.


// src/lib/sms.ts
const USE_REAL_SMS = false; // flip to true when you add Twilio later

export async function sendSmsOtp(to: string, text: string) {
  if (!USE_REAL_SMS) {
    await new Promise((r) => setTimeout(r, 200));
    console.log(`\n[SMS:DEV] To: ${to}\n[SMS:DEV] Message: ${text}\n`);
    return { ok: true as const };
  }
}

//// Real code for later with Twillo
// export async function sendSmsOtp(toE164: string, code: string) {
//   if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
//     const twilio = require('twilio')(
//       process.env.TWILIO_ACCOUNT_SID,
//       process.env.TWILIO_AUTH_TOKEN
//     );
//     await twilio.messages.create({
//       to: toE164,
//       from: process.env.TWILIO_FROM!,
//       body: `Your YemiShop verification code is ${code}`,
//     });
//   } else {
//     console.log('[SMS MOCK]', toE164, 'OTP:', code);
//   }
// }
export async function sendWhatsappOtp(toE164: string, code: string) {
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
          name: 'otp_login', // pre-approved template
          language: { code: 'en' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] }
          ]
        }
      }),
    }
  );
  return { ok: res.ok, error: res.ok ? undefined : await res.text() };
}
