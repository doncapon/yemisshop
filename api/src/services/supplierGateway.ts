// src/services/supplierGateway.ts
import type { Supplier } from '@prisma/client';
import fetch, { type RequestInit } from 'node-fetch';

/**
 * You can tweak these if a supplier uses different paths.
 */
const ENDPOINTS = {
  placeOrder: '/orders',
  pay: '/pay',
  receipt: '/receipts', // GET /receipts/:reference
} as const;

/**
 * Raw payload shapes we send to supplier APIs.
 * Adjust these if your suppliers need different fields.
 */
type PlaceOrderPayload = {
  productId: string;
  qty: number;
  /** Price per unit (major currency units, e.g. NGN) */
  price: number;
};
type PayPayload = {
  reference: string | undefined;
  /** Total amount for this order line (major units) */
  amount: number;
};
type ReceiptPayload = {
  reference: string | undefined;
};

/**
 * A normalized response shape we return to our app.
 */
export type SupplierResponse<T = unknown> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

/**
 * Ensure we have a usable base URL and return a normalized origin path.
 */
function normalizeBaseUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    // ensure no trailing slash duplication later
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

/**
 * Compose a URL like `${base}${path}` (both may or may not have slashes).
 */
function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

/**
 * Build headers based on supplier auth type.
 * Supports: BEARER (apiKey), NONE/default.
 */
function buildAuthHeaders(supplier: Supplier): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if ((supplier.apiAuthType || '').toUpperCase() === 'BEARER' && supplier.apiKey) {
    headers.Authorization = `Bearer ${supplier.apiKey}`;
  }

  return headers;
}

/**
 * Execute a fetch with timeout and safe JSON parsing.
 */
async function doSupplierFetch<T = unknown>(
  supplier: Supplier,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<SupplierResponse<T>> {
  const timeoutMs = init.timeoutMs ?? 15000; // 15s default
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
    });

    let data: unknown = undefined;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      // not JSON
      data = text as unknown;
    }

    if (!res.ok) {
      const msg =
        (data as any)?.error ||
        (data as any)?.message ||
        `Supplier responded ${res.status} ${res.statusText}`;
      return { ok: false, status: res.status, error: String(msg), data: data as T };
    }

    return { ok: true, status: res.status, data: data as T };
  } catch (err: any) {
    const reason = err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err?.message || 'request failed';
    return { ok: false, status: 0, error: `Supplier request error: ${reason}` };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Place an order at the ONLINE supplier.
 */
export async function callSupplierPlaceOrder<T = any>(
  supplier: Supplier,
  payload: PlaceOrderPayload,
  opts?: { pathOverride?: string; timeoutMs?: number }
): Promise<SupplierResponse<T>> {
  const base = normalizeBaseUrl(supplier.apiBaseUrl);
  if (!base) return { ok: false, status: 0, error: 'Supplier API base URL is missing/invalid' };

  const url = joinUrl(base, opts?.pathOverride ?? ENDPOINTS.placeOrder);
  const headers = buildAuthHeaders(supplier);

  return doSupplierFetch<T>(supplier, url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      productId: payload.productId,
      quantity: payload.qty,
      unitPrice: payload.price,
      // You can add customer/shipping metadata here if the supplier needs it
    }),
    timeoutMs: opts?.timeoutMs,
  });
}

/**
 * Pay for the previously placed order at the ONLINE supplier.
 */
export async function callSupplierPay<T = any>(
  supplier: Supplier,
  payload: PayPayload,
  opts?: { pathOverride?: string; timeoutMs?: number }
): Promise<SupplierResponse<T>> {
  const base = normalizeBaseUrl(supplier.apiBaseUrl);
  if (!base) return { ok: false, status: 0, error: 'Supplier API base URL is missing/invalid' };

  const url = joinUrl(base, opts?.pathOverride ?? ENDPOINTS.pay);
  const headers = buildAuthHeaders(supplier);

  return doSupplierFetch<T>(supplier, url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      reference: payload.reference,
      amount: payload.amount,
      currency: 'NGN', // set to your currency; adjust if supplier requires a code
    }),
    timeoutMs: opts?.timeoutMs,
  });
}

/**
 * Retrieve a receipt for a placed/paid supplier order.
 */
export async function callSupplierReceipt<T = any>(
  supplier: Supplier,
  payload: ReceiptPayload,
  opts?: { pathOverride?: string; timeoutMs?: number }
): Promise<SupplierResponse<T>> {
  const base = normalizeBaseUrl(supplier.apiBaseUrl);
  if (!base) return { ok: false, status: 0, error: 'Supplier API base URL is missing/invalid' };
  if (!payload.reference) return { ok: false, status: 0, error: 'Missing supplier reference' };

  const path = opts?.pathOverride ?? `${ENDPOINTS.receipt}/${encodeURIComponent(payload.reference)}`;
  const url = joinUrl(base, path);
  const headers = buildAuthHeaders(supplier);

  return doSupplierFetch<T>(supplier, url, {
    method: 'GET',
    headers,
    timeoutMs: opts?.timeoutMs,
  });
}
