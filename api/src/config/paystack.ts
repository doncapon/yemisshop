// src/config/paystack.ts
const on = (v?: string | null) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());

/** Which channels the checkout UI can present */
export const ENABLE_CARD = process.env.PAYSTACK_ENABLE_CARD === undefined ? true : on(process.env.PAYSTACK_ENABLE_CARD);
export const ENABLE_BANK_TRANSFER = on(process.env.PAYSTACK_ENABLE_BANK_TRANSFER);

/** Which webhook events you will accept (helps while developing) */
export const WEBHOOK_ACCEPT_CARD = on(process.env.PAYSTACK_WEBHOOK_ACCEPT_CARD) || ENABLE_CARD;
export const WEBHOOK_ACCEPT_BANK_TRANSFER = on(process.env.PAYSTACK_WEBHOOK_ACCEPT_BANK_TRANSFER) && ENABLE_BANK_TRANSFER;

/** Build Paystack init channels array */
export function getInitChannels(): string[] {
  const channels: string[] = [];
  if (ENABLE_CARD) channels.push('card');
  if (ENABLE_BANK_TRANSFER) channels.push('bank_transfer');
  // don't return empty — default to card to avoid Paystack init errors
  return channels.length ? channels : ['bank_transfer'];
}
