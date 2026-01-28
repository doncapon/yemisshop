// api/src/lib/dojahClient.ts
import axios, { AxiosHeaders } from "axios";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[dojahClient] Missing ${name} in environment (.env)`);
  return v;
}

/**
 * Accept either:
 *  - https://sandbox.dojah.io
 *  - https://sandbox.dojah.io/api/v1
 * and normalize to .../api/v1
 */
function normalizeBaseUrl(url: string): string {
  const cleaned = url.replace(/\/+$/, "");
  return cleaned.endsWith("/api/v1") ? cleaned : `${cleaned}/api/v1`;
}

const DOJAH_BASE_URL = normalizeBaseUrl(required("DOJAH_BASE_URL"));
const DOJAH_APP_ID = required("DOJAH_APP_ID");
const DOJAH_SECRET_KEY = required("DOJAH_SECRET_KEY");

const dojah = axios.create({
  baseURL: DOJAH_BASE_URL,
  timeout: 15_000,
});

dojah.interceptors.request.use((config) => {
  const headers =
    config.headers instanceof AxiosHeaders
      ? config.headers
      : AxiosHeaders.from(config.headers ?? {});

  // Per Dojah docs:
  // AppId: YOUR_APP_ID
  // Authorization: YOUR_SECRET_KEY   (no "Bearer ")
  headers.set("AppId", DOJAH_APP_ID);
  headers.set("Authorization", DOJAH_SECRET_KEY); // <-- FIXED
  headers.set("Accept", "application/json");

  // Only set Content-Type when you actually send a body (POST/PATCH/PUT)
  if (config.data != null && !headers.get("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  config.headers = headers;
  return config;
});

export type CacCompanyType =
  | "BUSINESS_NAME"
  | "COMPANY"
  | "INCORPORATED_TRUSTEES"
  | "LIMITED_PARTNERSHIP"
  | "LIMITED_LIABILITY_PARTNERSHIP";

export type CacEntity = {
  company_name: string;
  rc_number: string;

  // present in sample responses
  status?: string | null;
  business_number?: string | null;
  business?: string | null;

  address?: string | null;
  state?: string | null;
  city?: string | null;
  lga?: string | null;
  email?: string | null;
  type_of_company: CacCompanyType;
  date_of_registration?: string | null;
  nature_of_business?: string | null;
  share_capital?: number | null;
  share_details?: unknown;
};

export type CacBasicResponse = { entity: CacEntity };

function formatAxiosError(err: unknown): string {
  if (!axios.isAxiosError(err)) return String(err);

  const status = err.response?.status;
  const statusText = err.response?.statusText;
  const data = err.response?.data;

  // Try to keep it readable in logs
  const dataStr =
    data == null
      ? ""
      : typeof data === "string"
        ? data
        : JSON.stringify(data);

  return [status && `HTTP ${status}`, statusText, dataStr]
    .filter(Boolean)
    .join(" - ");
}

export async function fetchCacBasic(params: {
  rc_number: string;
  company_type: CacCompanyType; // REQUIRED
}): Promise<CacBasicResponse> {
  try {
    const { data } = await dojah.get<CacBasicResponse>("/kyc/cac/basic", { params });
    return data;
  } catch (err) {
    // IMPORTANT: throw so your route/UI can see a proper error
    const details = formatAxiosError(err);
    throw new Error(`[dojahClient] GET /kyc/cac/basic failed: ${details}`);
  }
}

export default dojah;
