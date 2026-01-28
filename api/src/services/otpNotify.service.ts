// src/services/otpNotify.service.ts
import { sendWhatsAppOtp } from "../lib/sms.js";
import { sendOtpEmail } from "../lib/email.js";

type OtpNotifyParams = {
  userEmail?: string | null;
  userPhoneE164?: string | null; // "+2348xxxx"
  code: string;
  expiresMins: number;
  purposeLabel: string; // "Payment verification"
  orderId?: string;
  brand?: string;
};

export async function sendOrderOtpNotifications(p: OtpNotifyParams) {
  const brand = p.brand || "DaySpring";

  const results: any = { whatsapp: null as any, email: null as any };

  // Fire in parallel; do not throw if one fails.
  await Promise.all([
    (async () => {
      if (!p.userPhoneE164) return;
      results.whatsapp = await sendWhatsAppOtp(p.userPhoneE164, p.code, {
        brand,
        expiresMins: p.expiresMins,
        purposeLabel: p.purposeLabel,
      });
    })(),
    (async () => {
      if (!p.userEmail) return;
      results.email = await sendOtpEmail(p.userEmail, p.code, {
        brand,
        expiresMins: p.expiresMins,
        purposeLabel: p.purposeLabel,
        orderId: p.orderId,
      });
    })(),
  ]);

  return results;
}
