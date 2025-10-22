// src/lib/paystack.ts
import axios from 'axios';

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
if (!PAYSTACK_SECRET) {
  // Fail fast at boot to avoid silent 401s later
  console.warn('⚠️  PAYSTACK_SECRET_KEY is not set');
}

export const ps = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET}`,
    'Content-Type': 'application/json',
  },
});

// Amount helper (Naira -> kobo integer)
export const toKobo = (naira: number | string) =>
  Math.round(Number(naira) * 100);
