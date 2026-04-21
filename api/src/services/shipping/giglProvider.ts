/**
 * GIG Logistics (GIGL) shipping provider
 *
 * Test base URL:  http://test.giglogisticsse.com/api/thirdparty  (confirmed from WordPress plugin docs)
 * Prod base URL:  https://giglogisticsse.com/api/thirdparty       (confirm with GIGL on sign-up)
 * Developer portal: https://giglogistics.com/developer/
 * Merchant login:   https://gigagilitysystems.com/Login/
 *
 * Auth: bearer token OR username/password — set whichever GIGL gives you.
 *   • If you receive an API key   → set GIGL_API_KEY
 *   • If you receive user/pass    → set GIGL_USERNAME + GIGL_PASSWORD
 *
 * ⚠️  PLACEHOLDER NOTICE
 * Endpoint paths and request/response field names below are based on the
 * Agility Systems API pattern common to GIGL integrations. Verify every
 * TODO comment against the actual API docs you receive after sign-up.
 */

import axios, { AxiosError } from "axios";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GIGL_BASE_URL =
  process.env.GIGL_API_URL || "http://test.giglogisticsse.com/api/thirdparty";
const GIGL_API_KEY = (process.env.GIGL_API_KEY || "").trim();
const GIGL_USERNAME = (process.env.GIGL_USERNAME || "").trim();
const GIGL_PASSWORD = (process.env.GIGL_PASSWORD || "").trim();
const GIGL_TIMEOUT_MS = Number(process.env.GIGL_TIMEOUT_MS || 8000);

export function isGiglConfigured(): boolean {
  return !!(GIGL_API_KEY || (GIGL_USERNAME && GIGL_PASSWORD));
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function buildAuthHeaders(): Record<string, string> {
  if (GIGL_API_KEY) {
    // TODO: Confirm header name with GIGL — may be "X-Api-Key" or "x-gigl-key"
    return { Authorization: `Bearer ${GIGL_API_KEY}` };
  }
  if (GIGL_USERNAME && GIGL_PASSWORD) {
    // TODO: Some Agility Systems integrations pass credentials in the request body
    //       instead of headers. Adjust if GIGL docs specify that.
    const b64 = Buffer.from(`${GIGL_USERNAME}:${GIGL_PASSWORD}`).toString("base64");
    return { Authorization: `Basic ${b64}` };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GiglParcelClass = "STANDARD" | "FRAGILE" | "BULKY";

export type GiglPriceInput = {
  /** Supplier origin state name, e.g. "Lagos" */
  originState: string;
  /** Supplier origin LGA/city, e.g. "Ikeja" */
  originLga?: string | null;
  /** Customer destination state name, e.g. "Abuja" */
  destinationState: string;
  /** Customer destination LGA/city, e.g. "Garki" */
  destinationLga?: string | null;
  /** Chargeable weight in KG */
  weightKg: number;
  /** Parcel classification */
  parcelClass: GiglParcelClass;
};

export type GiglPriceResult = {
  /** Total shipping fee in NGN (including VAT + insurance if bundled) */
  totalFee: number;
  /** Base rate before VAT/insurance */
  baseRate: number;
  /** VAT portion in NGN */
  vatAmount: number;
  /** Insurance fee in NGN */
  insuranceFee: number;
  /** Estimated minimum delivery days */
  etaMinDays: number | null;
  /** Estimated maximum delivery days */
  etaMaxDays: number | null;
  /** GIGL's own reference/quote ID for this price check */
  carrierRef: string | null;
  /** Full raw response from GIGL — stored in providerResponseJson for audit */
  rawResponse: unknown;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps our internal parcel class to GIGL's item type string.
 * TODO: Confirm the exact string values GIGL accepts (may be numeric codes).
 */
function toGiglItemType(parcelClass: GiglParcelClass): string {
  const map: Record<GiglParcelClass, string> = {
    STANDARD: "Normal",    // TODO: confirm — may be "Document", "Regular", or a numeric code
    FRAGILE: "Fragile",    // TODO: confirm
    BULKY: "Oversized",    // TODO: confirm — may be "Bulk" or "Large"
  };
  return map[parcelClass] ?? "Normal";
}

/**
 * Extracts a numeric fee from a GIGL response object, trying multiple
 * possible field names since the exact schema is unconfirmed.
 * Remove fallback keys once you have the real API docs.
 */
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
// Price quote
// ---------------------------------------------------------------------------

/**
 * Calls GIGL to get a live shipping price quote.
 *
 * TODO: Once you have your GIGL API credentials and docs:
 *   1. Confirm the endpoint path (currently /PriceOption — common Agility pattern)
 *   2. Confirm request body field names (all marked with TODO below)
 *   3. Confirm response field names (extractFee fallback keys below)
 *   4. Decide whether GIGL needs service-centre codes instead of state names
 *      (if so, you'll need a state→centre-code lookup table)
 */
export async function getGiglShippingPrice(
  input: GiglPriceInput
): Promise<GiglPriceResult> {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...buildAuthHeaders(),
  };

  // TODO: Confirm exact endpoint path — alternatives seen in the wild:
  //   /PriceOption  /PriceForShipment  /shipment/price  /rate
  const endpoint = `${GIGL_BASE_URL}/PriceOption`;

  const body = {
    // TODO: Confirm these field names against GIGL API docs.
    //       GIGL may require service-centre codes (e.g. "LOS", "ABJ") rather than state names.
    //       If so, add a lookup map: state name → GIGL centre code.
    DepartureCentreCode: input.originState,       // TODO: confirm field name + value format
    DestinationCentreCode: input.destinationState, // TODO: confirm field name + value format

    // TODO: confirm weight unit — may be "Weight" in kg or grams
    Weight: Math.max(0.1, input.weightKg),

    // TODO: confirm item type field name and accepted string values
    ShipmentType: toGiglItemType(input.parcelClass),

    // TODO: GIGL may require these — uncomment and fill if needed
    // CustomerCode: GIGL_USERNAME,
    // CompanyType: "Corporate",
    // CountryCode: "NG",
  };

  let data: any;
  try {
    const res = await axios.post<any>(endpoint, body, {
      headers,
      timeout: GIGL_TIMEOUT_MS,
    });
    data = res.data;
  } catch (err) {
    const ae = err as AxiosError;
    const detail = ae.response?.data ?? ae.message;
    throw new Error(`GIGL API request failed: ${JSON.stringify(detail)}`);
  }

  // TODO: GIGL may wrap the actual result under a key like "Object", "Result", or "Data"
  const payload = data?.Object ?? data?.Result ?? data?.Data ?? data;

  // TODO: Replace the fallback keys below with the confirmed field names from GIGL docs.
  const totalFee = extractFee(
    payload,
    "GrandTotal", "TotalPrice", "TotalAmount", "Price", "Amount"
  );

  if (totalFee <= 0) {
    throw new Error(
      `GIGL returned no usable price. Raw response: ${JSON.stringify(data)}`
    );
  }

  return {
    totalFee,
    baseRate: extractFee(payload, "FreightPrice", "BaseRate", "SubTotal") || totalFee,
    vatAmount: extractFee(payload, "VatAmount", "Vat", "Tax"),
    insuranceFee: extractFee(payload, "InsuranceFee", "Insurance"),
    etaMinDays: extractNullableInt(payload, "MinDeliveryDays", "EtaMin", "MinDays"),
    etaMaxDays: extractNullableInt(payload, "MaxDeliveryDays", "EtaMax", "MaxDays"),
    // TODO: Confirm reference/quote ID field name
    carrierRef:
      String(payload?.ShipmentRef ?? payload?.Reference ?? payload?.QuoteId ?? "") ||
      null,
    rawResponse: data,
  };
}

// ---------------------------------------------------------------------------
// Create shipment (waybill booking)
// Uncomment and fill in when you're ready to implement booking
// ---------------------------------------------------------------------------

// export type GiglCreateShipmentInput = {
//   originState: string;
//   destinationState: string;
//   weightKg: number;
//   parcelClass: GiglParcelClass;
//   senderName: string;
//   senderPhone: string;
//   receiverName: string;
//   receiverPhone: string;
//   receiverAddress: string;
//   declaredValue?: number;
//   description?: string;
// };

// export type GiglCreateShipmentResult = {
//   waybillNumber: string;
//   trackingUrl: string | null;
//   totalFee: number;
//   rawResponse: unknown;
// };

// export async function createGiglShipment(
//   input: GiglCreateShipmentInput
// ): Promise<GiglCreateShipmentResult> {
//   // TODO: Implement once GIGL API docs are available
//   // Endpoint likely: POST /CreateShipment or /Shipment
//   throw new Error("GIGL shipment booking not yet implemented — awaiting API docs");
// }
