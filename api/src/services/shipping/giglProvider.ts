/**
 * GIG Logistics (GIGL) shipping provider
 *
 * Docs:     https://gig-logistics.readme.io/reference/post_login
 * Dev URL:  https://dev-thirdpartynode.theagilitysystems.com
 *
 * Auth flow: POST /login with { email, password } → bearer token
 * Price flow:
 *   1. GET /localstations → cache station list
 *   2. Match origin/destination state names to StationId values
 *   3. POST /price with SenderStationId + ReceiverStationId + ShipmentItems
 */

import axios, { AxiosError } from "axios";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GIGL_BASE_URL = (
  process.env.GIGL_API_URL || "https://dev-thirdpartynode.theagilitysystems.com"
).replace(/\/$/, "");

const GIGL_USER_EMAIL = (process.env.GIGL_USER_EMAIL || "").trim();
const GIGL_PASSWORD   = (process.env.GIGL_PASSWORD   || "").trim();
const GIGL_TIMEOUT_MS = Number(process.env.GIGL_TIMEOUT_MS || 10000);

export function isGiglConfigured(): boolean {
  return !!(GIGL_USER_EMAIL && GIGL_PASSWORD);
}

// ---------------------------------------------------------------------------
// Auth — POST /login, cache token for 50 min
// ---------------------------------------------------------------------------

let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;
let _customerCode: string | null = null; // UserChannelCode from login response

async function authenticate(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiresAt) return _cachedToken;

  const loginUrl = `${GIGL_BASE_URL}/login`;
  console.log("[GIGL] login →", loginUrl);

  let res: any;
  try {
    res = await axios.post(
      loginUrl,
      { email: GIGL_USER_EMAIL, password: GIGL_PASSWORD },
      {
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        timeout: GIGL_TIMEOUT_MS,
      }
    );
  } catch (err) {
    const ae = err as AxiosError;
    const detail = ae.response?.data ?? ae.message;
    throw new Error(`GIGL login failed (${ae.response?.status ?? "network"}): ${JSON.stringify(detail)}`);
  }

  const d = res.data?.data ?? res.data;

  // Token is at data["access-token"] (confirmed from live response)
  const token =
    d?.["access-token"] ??
    d?.accessToken ??
    d?.AccessToken ??
    d?.access_token ??
    d?.token ??
    d?.Token ??
    res.data?.Object;

  if (!token || typeof token !== "string") {
    throw new Error(
      `GIGL auth: no token in response — raw: ${JSON.stringify(res.data)}`
    );
  }

  // Cache the channel code returned by login for use as CustomerCode in price requests
  _customerCode = d?.UserChannelCode ?? null;
  console.log("[GIGL] login success — CustomerCode:", _customerCode);

  _cachedToken = token;
  _tokenExpiresAt = now + 50 * 60 * 1000; // 50-min cache
  return token;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GiglParcelClass = "STANDARD" | "FRAGILE" | "BULKY";

export type GiglPriceInput = {
  originState: string;
  originLga?: string | null;
  destinationState: string;
  destinationLga?: string | null;
  weightKg: number;
  parcelClass: GiglParcelClass;
  itemDescription?: string | null;
};

export type GiglPriceResult = {
  totalFee: number;
  baseRate: number;
  vatAmount: number;
  insuranceFee: number;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  carrierRef: string | null;
  rawResponse: unknown;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toGiglNature(parcelClass: GiglParcelClass): string {
  const map: Record<GiglParcelClass, string> = {
    STANDARD: "Normal",
    FRAGILE:  "Fragile",
    BULKY:    "Oversized",
  };
  return map[parcelClass] ?? "Normal";
}

// ShipmentType: 0 = Normal, 1 = Fragile/Priority (confirmed from GIGL validation error)
function toGiglShipmentType(parcelClass: GiglParcelClass): number {
  return parcelClass === "FRAGILE" ? 1 : 0;
}

function extractFee(data: any, ...keys: string[]): number {
  for (const key of keys) {
    const v = Number(data?.[key]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

function extractNullableInt(data: any, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = Number(data?.[key]);
    if (Number.isFinite(v) && v >= 0) return Math.round(v);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Price quote — POST /price
// ---------------------------------------------------------------------------

function buildPriceBody(input: GiglPriceInput) {
  return {
    SenderStationId:   1,
    ReceiverStationId: 1,
    VehicleType: 2,
    PickUpOptions: 0,
    CustomerCode: _customerCode ?? GIGL_USER_EMAIL,
    CustomerType: 0,
    IsFromAgility: true,
    SenderLocation:   { Latitude: 0, Longitude: 0 },
    ReceiverLocation: { Latitude: 0, Longitude: 0 },
    ShipmentItems: [
      {
        ItemName:     input.itemDescription || toGiglNature(input.parcelClass),
        Description:  toGiglNature(input.parcelClass),
        Weight:       Math.max(0.1, input.weightKg),
        ShipmentType: toGiglShipmentType(input.parcelClass),
        Quantity:     1,
        IsVolumetric: false,
      },
    ],
  };
}

async function callPrice(token: string, body: object): Promise<any> {
  const res = await axios.post(`${GIGL_BASE_URL}/price`, body, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      // GIGL uses their own "access-token" header (field name from login response)
      "access-token": token,
      // Also send as Bearer in case endpoint accepts either
      Authorization: `Bearer ${token}`,
    },
    timeout: GIGL_TIMEOUT_MS,
  });
  return res.data;
}

export async function getGiglShippingPrice(
  input: GiglPriceInput
): Promise<GiglPriceResult> {
  let data: any;
  try {
    // authenticate first so _customerCode is populated before building the body
    const token = await authenticate();
    const body = buildPriceBody(input);
    console.log("[GIGL] POST /price body:", JSON.stringify(body));

    try {
      data = await callPrice(token, body);
    } catch (err) {
      const ae = err as AxiosError;
      const status = ae.response?.status;
      const respData = ae.response?.data as any;
      // 440 = GIGL "Invalid Token" / session expired — clear cache and retry once
      if (status === 440 || respData?.status === 440) {
        console.warn("[GIGL] 440 Invalid Token — clearing cache and retrying login");
        _cachedToken = null;
        _tokenExpiresAt = 0;
        const freshToken = await authenticate();
        // Rebuild body so CustomerCode picks up freshly cached _customerCode
        const freshBody = buildPriceBody(input);
        data = await callPrice(freshToken, freshBody);
      } else {
        throw err;
      }
    }
    console.log("[GIGL] /price raw response:", JSON.stringify(data));
  } catch (err) {
    const ae = err as AxiosError;
    const detail = ae.response?.data ?? ae.message;
    console.error("[GIGL] /price error response:", JSON.stringify(ae.response?.data));
    throw new Error(`GIGL /price failed (${ae.response?.status ?? "network"}): ${JSON.stringify(detail)}`);
  }

  // Unwrap envelope if present
  const payload = data?.Object ?? data?.Result ?? data?.data ?? data;

  const totalFee = extractFee(
    payload,
    "GrandTotal", "TotalPrice", "TotalAmount", "Price", "Amount", "Total"
  );

  if (totalFee <= 0) {
    throw new Error(`GIGL /price: no usable price in response — ${JSON.stringify(data)}`);
  }

  return {
    totalFee,
    baseRate:     extractFee(payload, "FreightPrice", "BaseRate", "SubTotal") || totalFee,
    vatAmount:    extractFee(payload, "VatAmount", "Vat", "Tax"),
    insuranceFee: extractFee(payload, "InsuranceFee", "Insurance"),
    etaMinDays:   extractNullableInt(payload, "MinDeliveryDays", "EtaMin", "MinDays"),
    etaMaxDays:   extractNullableInt(payload, "MaxDeliveryDays", "EtaMax", "MaxDays"),
    carrierRef:
      String(payload?.ShipmentRef ?? payload?.Reference ?? payload?.QuoteId ?? "") || null,
    rawResponse: data,
  };
}
