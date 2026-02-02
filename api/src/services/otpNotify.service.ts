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

  const report: {
    hasEmail: boolean;
    hasPhone: boolean;
    attempted: string[];
    channels: string[]; // succeeded
    errors: string[];
    results: { whatsapp: any; email: any };
  } = {
    hasEmail: !!p.userEmail,
    hasPhone: !!p.userPhoneE164,
    attempted: [],
    channels: [],
    errors: [],
    results: { whatsapp: null, email: null },
  };

  const recordErr = (label: string, e: any) => {
    report.errors.push(`${label}: ${String(e?.message || e || "unknown error")}`);
  };

  const tasks: Array<Promise<any>> = [];

  // WhatsApp
  if (p.userPhoneE164) {
    report.attempted.push("WHATSAPP");
    tasks.push(
      (async () => {
        return sendWhatsAppOtp(p.userPhoneE164!, p.code, {
          brand,
          expiresMins: p.expiresMins,
          purposeLabel: p.purposeLabel,
        });
      })()
    );
  } else {
    tasks.push(Promise.resolve(null));
  }

  // Email
  if (p.userEmail) {
    report.attempted.push("EMAIL");
    tasks.push(
      (async () => {
        return sendOtpEmail(p.userEmail!, p.code, {
          brand,
          expiresMins: p.expiresMins,
          purposeLabel: p.purposeLabel,
          orderId: p.orderId,
        });
      })()
    );
  } else {
    tasks.push(Promise.resolve(null));
  }

  // Run without throwing if one fails
  const settled = await Promise.allSettled(tasks);

  // indexes: 0 => whatsapp, 1 => email
  const w = settled[0];
  const e = settled[1];

  if (w.status === "fulfilled" && w.value != null) {
    report.results.whatsapp = w.value;
    report.channels.push("WHATSAPP");
  } else if (w.status === "rejected") {
    recordErr("WHATSAPP", w.reason);
  }

  if (e.status === "fulfilled" && e.value != null) {
    report.results.email = e.value;
    report.channels.push("EMAIL");
  } else if (e.status === "rejected") {
    recordErr("EMAIL", e.reason);
  }

  return report;
}

