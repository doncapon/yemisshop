// config/paystack.ts
export const PAYSTACK_ENABLE_CARD =
  (process.env.PAYSTACK_ENABLE_CARD ?? 'true').toLowerCase() !== 'false';

export const PAYSTACK_ENABLE_BANK_TRANSFER =
  (process.env.PAYSTACK_ENABLE_BANK_TRANSFER ?? 'true').toLowerCase() !== 'false';

// Which channels to request on initialize:
export function getInitChannels(): Array<'card' | 'bank_transfer'> {
  if (PAYSTACK_ENABLE_CARD && PAYSTACK_ENABLE_BANK_TRANSFER) return ['card', 'bank_transfer'];
  if (PAYSTACK_ENABLE_CARD) return ['card'];
  if (PAYSTACK_ENABLE_BANK_TRANSFER) return ['bank_transfer'];
  // fallback: card (or throw)
  return ['card'];
}

// For webhook filtering (you can turn off handling for a channel if you want)
export const WEBHOOK_ACCEPT_CARD =
  (process.env.PAYSTACK_WEBHOOK_ACCEPT_CARD ?? 'true').toLowerCase() !== 'false';
export const WEBHOOK_ACCEPT_BANK_TRANSFER =
  (process.env.PAYSTACK_WEBHOOK_ACCEPT_BANK_TRANSFER ?? 'true').toLowerCase() !== 'false';
