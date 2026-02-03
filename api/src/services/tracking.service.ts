import { prisma } from "../lib/prisma.js";

type PurchasePayload = {
  orderId: string;
  paymentId: string;
  value: number;
  currency: string;
  paidAt?: Date | null;
  items: Array<{ title: string; quantity: number; unitPrice: number; lineTotal: number }>;
  tax: number;
  serviceFeeTotal: number;

  // attribution
  utm?: Record<string, string | undefined>;
  gclid?: string | null;
  fbclid?: string | null;
};

function toNum(v: any) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * ✅ Call this ONLY after payment is confirmed PAID (Paystack verify/webhook).
 * Idempotent via Payment.purchaseEventSentAt.
 */
export async function trackPurchaseIfNeeded(paymentId: string) {
  const p = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      paidAt: true,
      amount: true,
      purchaseEventSentAt: true,
      provider: true,
      providerTxId: true,

      order: {
        select: {
          id: true,
          total: true,
          tax: true,
          serviceFeeTotal: true,

          utmSource: true,
          utmMedium: true,
          utmCampaign: true,
          utmContent: true,
          utmTerm: true,
          gclid: true,
          fbclid: true,
          referrerUrl: true,
          landingPath: true,

          items: {
            select: { title: true, quantity: true, unitPrice: true, lineTotal: true },
          },

          user: {
            select: { id: true, consentMarketingAt: true, consentAnalyticsAt: true },
          },
        },
      },
    },
  });

  if (!p?.order) return;
  if (p.status !== "PAID") return;
  if (p.purchaseEventSentAt) return; // ✅ idempotent guard

  // Optional gating: only send marketing events if user consented.
  const user = p.order.user;
  const hasMarketingConsent = !!user?.consentMarketingAt;

  const items = (p.order.items || []).map((it: any) => {
    const qty = toNum(it.quantity || 1);
    const unit = toNum(it.unitPrice);
    const line = it.lineTotal != null ? toNum(it.lineTotal) : unit * qty;
    return { title: it.title || "Item", quantity: qty, unitPrice: unit, lineTotal: line };
  });

  const payload: PurchasePayload = {
    orderId: p.order.id,
    paymentId: p.id,
    value: toNum(p.order.total || p.amount),
    currency: "NGN",
    paidAt: p.paidAt,
    items,
    tax: toNum(p.order.tax),
    serviceFeeTotal: toNum(p.order.serviceFeeTotal),

    utm: {
      utm_source: p.order.utmSource ?? undefined,
      utm_medium: p.order.utmMedium ?? undefined,
      utm_campaign: p.order.utmCampaign ?? undefined,
      utm_content: p.order.utmContent ?? undefined,
      utm_term: p.order.utmTerm ?? undefined,
    },
    gclid: p.order.gclid ?? null,
    fbclid: p.order.fbclid ?? null,
  };

  // ✅ For now: just log + mark as sent so you can test end-to-end.
  // Later: if hasMarketingConsent, call Meta CAPI / Google MP here.
  console.log("[track] PURCHASE", {
    consent: { hasMarketingConsent, hasAnalyticsConsent: !!user?.consentAnalyticsAt },
    provider: p.provider,
    providerTxId: p.providerTxId,
    payload,
  });

  await prisma.payment.update({
    where: { id: p.id },
    data: { purchaseEventSentAt: new Date() },
  });
}
