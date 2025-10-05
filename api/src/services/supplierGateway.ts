// src/services/supplierGateway.ts
import fetch, { type RequestInit } from 'node-fetch';

/**
 * Default endpoint paths for suppliers that expose simple REST APIs.
 * You can override any of these per call via the `opts.pathOverride` param.
 */
const ENDPOINTS = {
  placeOrder: '/orders',
  pay: '/pay',
  receipt: '/receipts', // GET /receipts/:reference
} as const;

type SupplierLike = {
  id: string;
  name: string;
  type: 'PHYSICAL' | 'ONLINE';
  apiBaseUrl: string | null;
  apiAuthType: string | null; // e.g. "BEARER"
  apiKey: string | null;
  whatsappPhone: string | null;
};

/** Outbound payloads to supplier APIs (adjust if a supplier needs a different shape). */
type PlaceOrderPayload = {
  productId: string;
  qty: number;
  /** Unit price in major units (e.g., NGN). */
  price: number;
};
type PayPayload = {
  reference: string | undefined;
  /** Total amount for the order line (major units). */
  amount: number;
};
type ReceiptPayload = {
  reference: string | undefined;
};

/** Normalized response returned to our app from any supplier call. */
export type SupplierResponse<T = unknown> = {
  ok: boolean;
  status: number;      // 0 if network/timeout error
  data?: T;
  error?: string;
};

/** Ensure a usable base URL (drops trailing slash, keeps origin+pathname). */
function normalizeBaseUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

/** Join base and path safely (handles leading/trailing slashes). */
function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

/** Build auth headers from supplier config. Supports BEARER api key. */
function buildAuthHeaders(supplier: SupplierLike): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if ((supplier.apiAuthType || '').toUpperCase() === 'BEARER' && supplier.apiKey) {
    headers.Authorization = `Bearer ${supplier.apiKey}`;
  }
  return headers;
}

/** Fetch wrapper with timeout + robust JSON parsing. */
async function doSupplierFetch<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<SupplierResponse<T>> {
  const timeoutMs = init.timeoutMs ?? 15_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });

    const raw = await res.text();
    let data: unknown = undefined;
    try {
      data = raw ? JSON.parse(raw) : undefined;
    } catch {
      // non-JSON response; keep raw text
      data = raw;
    }

    if (!res.ok) {
      const msg =
        (data as any)?.error ??
        (data as any)?.message ??
        `Supplier responded ${res.status} ${res.statusText}`;
      return { ok: false, status: res.status, error: String(msg), data: data as T };
    }

    return { ok: true, status: res.status, data: data as T };
  } catch (err: any) {
    const reason =
      err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err?.message || 'request failed';
    return { ok: false, status: 0, error: `Supplier request error: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Place an order with an ONLINE supplier. */
export async function callSupplierPlaceOrder<T = any>(
  supplier: SupplierLike,
  payload: PlaceOrderPayload,
  opts?: { pathOverride?: string; timeoutMs?: number }
): Promise<SupplierResponse<T>> {
  const base = normalizeBaseUrl(supplier.apiBaseUrl);
  if (!base) return { ok: false, status: 0, error: 'Supplier API base URL is missing/invalid' };

  const url = joinUrl(base, opts?.pathOverride ?? ENDPOINTS.placeOrder);
  const headers = buildAuthHeaders(supplier);

  return doSupplierFetch<T>(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      productId: payload.productId,
      quantity: payload.qty,
      unitPrice: payload.price,
    }),
    timeoutMs: opts?.timeoutMs,
  });
}

/** Pay for a previously placed supplier order. */
export async function callSupplierPay<T = any>(
  supplier: SupplierLike,
  payload: PayPayload,
  opts?: { pathOverride?: string; timeoutMs?: number }
): Promise<SupplierResponse<T>> {
  const base = normalizeBaseUrl(supplier.apiBaseUrl);
  if (!base) return { ok: false, status: 0, error: 'Supplier API base URL is missing/invalid' };

  const url = joinUrl(base, opts?.pathOverride ?? ENDPOINTS.pay);
  const headers = buildAuthHeaders(supplier);

  return doSupplierFetch<T>(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      reference: payload.reference,
      amount: payload.amount,
      currency: 'NGN',
    }),
    timeoutMs: opts?.timeoutMs,
  });
}

/** Retrieve a receipt for a placed/paid supplier order. */
export async function callSupplierReceipt<T = any>(
  supplier: SupplierLike,
  payload: ReceiptPayload,
  opts?: { pathOverride?: string; timeoutMs?: number }
): Promise<SupplierResponse<T>> {
  const base = normalizeBaseUrl(supplier.apiBaseUrl);
  if (!base) return { ok: false, status: 0, error: 'Supplier API base URL is missing/invalid' };
  if (!payload.reference) return { ok: false, status: 0, error: 'Missing supplier reference' };

  const path = opts?.pathOverride ?? `${ENDPOINTS.receipt}/${encodeURIComponent(payload.reference)}`;
  const url = joinUrl(base, path);
  const headers = buildAuthHeaders(supplier);

  return doSupplierFetch<T>(url, {
    method: 'GET',
    headers,
    timeoutMs: opts?.timeoutMs,
  });
}
