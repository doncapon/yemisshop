// src/lib/paystack.ts
import axios from 'axios';

type Mode = 'test' | 'live';
const pick = (s?: string | null) => (s ?? '').trim();
const env = (k: string) => pick(process.env[k]);

const explicitMode = pick(process.env.PAYSTACK_MODE).toLowerCase() as Mode | '';
const fromExplicit = explicitMode === 'test' || explicitMode === 'live' ? explicitMode : '';

/**
 * Resolve secret/public keys from either explicit mode or single-key env.
 * Priority:
 *   1) PAYSTACK_MODE + MODE-SPECIFIC keys
 *   2) PAYSTACK_SECRET_KEY / PAYSTACK_PUBLIC_KEY
 */
const secretFromMode =
  fromExplicit === 'test'
    ? env('PAYSTACK_TEST_SECRET_KEY')
    : fromExplicit === 'live'
    ? env('PAYSTACK_LIVE_SECRET_KEY')
    : '';

const publicFromMode =
  fromExplicit === 'test'
    ? env('PAYSTACK_TEST_PUBLIC_KEY')
    : fromExplicit === 'live'
    ? env('PAYSTACK_LIVE_PUBLIC_KEY')
    : '';

const fallbackSecret = env('PAYSTACK_SECRET_KEY'); // works for both test/live depending on value
const fallbackPublic = env('PAYSTACK_PUBLIC_KEY');

export const PAYSTACK_SECRET_KEY =
  secretFromMode || fallbackSecret || '';

export const PAYSTACK_PUBLIC_KEY =
  publicFromMode || fallbackPublic || '';

export const PAYSTACK_MODE: Mode =
  PAYSTACK_SECRET_KEY.startsWith('sk_live_')
    ? 'live'
    : PAYSTACK_SECRET_KEY.startsWith('sk_test_')
    ? 'test'
    : (fromExplicit || 'test'); // default to test if unknown

export const ps = axios.create({
  baseURL: env('PAYSTACK_API_BASE') || 'https://api.paystack.co',
  timeout: 15000,
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
});

export const toKobo = (dec: any) => Math.round(Number(dec) * 100);
