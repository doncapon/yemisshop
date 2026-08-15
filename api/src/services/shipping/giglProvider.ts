/**
 * GIG Logistics (GIGL) shipping provider
 *
 * Docs:      https://gig-logistics.readme.io/reference/post_login
 *            (full endpoint index: https://gig-logistics.readme.io/llms.txt)
 * Dev URL:   https://dev-thirdpartynode.theagilitysystems.com
 * Prod URL:  https://thirdpartynode.theagilitysystems.com
 *
 * Auth flow:   POST /login with { email, password } → bearer token
 * Price flow:
 *   1. GET /localstations/get → cache station list (StationId + StateName)
 *   2. Match origin/destination state names to StationId values
 *   3. POST /price with SenderStationId + ReceiverStationId + ShipmentItems
 * Booking flow (actually notifies GIGL to collect from the sender):
 *   1. Same station resolution as above
 *   2. POST /capture/preshipment with sender/receiver/items → returns a Waybill,
 *      which is GIGL's tracking reference for the pickup + delivery.
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

/**
 * True when GIGL is the active shipping provider.
 * Switch by setting SHIPPING_PROVIDER=gigl in your .env.
 * Defaults to "internal" (zone-based rates) so nothing breaks until ready.
 */
export function isGiglEnabled(): boolean {
  return (
    String(process.env.SHIPPING_PROVIDER || "internal").toLowerCase() === "gigl" &&
    isGiglConfigured()
  );
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
// Local stations — GET /localstations/get, cache for 24h
// ---------------------------------------------------------------------------

export type GiglStation = {
  stationId: number;
  stationName: string;
  stationCode: string;
  stateName: string;
};

let _stationsCache: GiglStation[] | null = null;
let _stationsCachedAt = 0;
const STATIONS_CACHE_MS = 24 * 60 * 60 * 1000; // 24h — station list rarely changes

async function fetchLocalStations(): Promise<GiglStation[]> {
  const now = Date.now();
  if (_stationsCache && now - _stationsCachedAt < STATIONS_CACHE_MS) {
    return _stationsCache;
  }

  const token = await authenticate();

  let res: any;
  try {
    res = await axios.get(`${GIGL_BASE_URL}/localstations/get`, {
      headers: { Accept: "application/json", "access-token": token },
      timeout: GIGL_TIMEOUT_MS,
    });
  } catch (err) {
    const ae = err as AxiosError;
    const detail = ae.response?.data ?? ae.message;
    throw new Error(
      `GIGL /localstations/get failed (${ae.response?.status ?? "network"}): ${JSON.stringify(detail)}`
    );
  }

  const payload = res.data?.data ?? res.data?.Object ?? res.data;
  const list: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  const stations: GiglStation[] = list
    .map((s) => ({
      stationId: Number(s?.StationId),
      stationName: String(s?.StationName ?? "").trim(),
      stationCode: String(s?.StationCode ?? "").trim(),
      stateName: String(s?.StateName ?? "").trim(),
    }))
    .filter((s) => Number.isFinite(s.stationId) && s.stationId > 0);

  if (!stations.length) {
    throw new Error(`GIGL /localstations/get returned no usable stations — raw: ${JSON.stringify(res.data)}`);
  }

  _stationsCache = stations;
  _stationsCachedAt = now;
  return stations;
}

// Nigerian state-name variants that show up in our address data but need to
// match GIGL's canonical StateName exactly (after case/whitespace folding).
function normalizeStateForGigl(state?: string | null): string {
  const s = String(state ?? "").trim().toLowerCase();
  if (["abuja", "fct", "federal capital territory", "abuja fct"].includes(s)) return "fct";
  return s;
}

/**
 * Resolves a Nigerian state (+ optional city/LGA) to a GIGL StationId.
 * Falls back to the state's first known station if no city/LGA match is
 * found. Returns null if the state isn't recognized at all (caller should
 * treat that as "can't fulfil via GIGL for this address").
 */
export async function findGiglStationId(
  state?: string | null,
  cityOrLga?: string | null
): Promise<number | null> {
  const stations = await fetchLocalStations();
  const wantState = normalizeStateForGigl(state);
  if (!wantState) return null;

  const inState = stations.filter((s) => normalizeStateForGigl(s.stateName) === wantState);
  if (!inState.length) return null;

  const wantCity = String(cityOrLga ?? "").trim().toLowerCase();
  if (wantCity) {
    const cityMatch = inState.find(
      (s) => s.stationName.toLowerCase() === wantCity || s.stationCode.toLowerCase() === wantCity
    );
    if (cityMatch) return cityMatch.stationId;
  }

  return inState[0].stationId;
}

// Human-readable hub city name for a resolved station — used to tell the
// customer roughly where their pickup hub is (GIGL's station data has no
// street address, only a city/town-level name).
async function getStationName(stationId: number | null): Promise<string | null> {
  if (!stationId) return null;
  const stations = await fetchLocalStations();
  const match = stations.find((s) => s.stationId === stationId);
  return match?.stationName || null;
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
  /** City/town-level name of the resolved destination hub — GIGL has no street address. */
  receiverStationName: string | null;
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

function buildPriceBody(
  input: GiglPriceInput,
  stationIds: { sender: number; receiver: number }
) {
  return {
    SenderStationId:   stationIds.sender,
    ReceiverStationId: stationIds.receiver,
    VehicleType: 2,
    PickUpOptions: 0,
    CustomerCode: _customerCode ?? GIGL_USER_EMAIL,
    CustomerType: 0,
    IsFromAgility: true,
    SenderLocation:   { Latitude: 0, Longitude: 0 },
    ReceiverLocation: { Latitude: 0, Longitude: 0 },
    ShipmentItems: [
      {
        ItemName:        input.itemDescription || toGiglNature(input.parcelClass),
        Description:     toGiglNature(input.parcelClass),
        Weight:          Math.max(0.1, input.weightKg),
        ShipmentType:    toGiglShipmentType(input.parcelClass),
        Quantity:        1,
        IsVolumetric:    false,
        SpecialPackageId: 1, // sandbox rejects the request without this; docs list it as
                              // optional/numeric with no enum — 1 is GIGL's default "general
                              // parcel" category based on live testing against their sandbox.
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
  let receiverStationName: string | null = null;
  try {
    // authenticate first so _customerCode is populated before building the body
    const token = await authenticate();

    const [senderStationId, receiverStationId] = await Promise.all([
      findGiglStationId(input.originState, input.originLga),
      findGiglStationId(input.destinationState, input.destinationLga),
    ]);

    if (!senderStationId || !receiverStationId) {
      throw new Error(
        `GIGL: could not resolve a station for ${
          !senderStationId ? `origin state "${input.originState}"` : `destination state "${input.destinationState}"`
        }`
      );
    }

    receiverStationName = await getStationName(receiverStationId);

    const stationIds = { sender: senderStationId, receiver: receiverStationId };
    const body = buildPriceBody(input, stationIds);
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
        const freshBody = buildPriceBody(input, stationIds);
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
    receiverStationName,
    rawResponse: data,
  };
}

// ---------------------------------------------------------------------------
// Shipment booking — POST /capture/preshipment
// This is the call that actually tells GIGL "come collect this from the
// sender." The /price endpoint above only ever asks "what would this cost?"
// ---------------------------------------------------------------------------

export type GiglShipmentParty = {
  name: string;
  phone: string;
  address: string;
  state: string;
  lga?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type GiglShipmentItemInput = {
  itemName: string;
  description?: string | null;
  weightKg: number;
  quantity: number;
  parcelClass: GiglParcelClass;
  value?: number | null;
};

export type GiglShipmentInput = {
  sender: GiglShipmentParty;
  receiver: GiglShipmentParty;
  items: GiglShipmentItemInput[];
  isPriorityShipment?: boolean;
};

export type GiglShipmentResult = {
  waybill: string;
  rawResponse: unknown;
};

function buildShipmentBody(
  input: GiglShipmentInput,
  stationIds: { sender: number; receiver: number }
) {
  return {
    // Per GIGL's live schema, sender/receiver fields must be nested under
    // SenderDetails/ReceiverDetails — a flat body (like /price uses) gets
    // rejected with '"SenderName" is not allowed' (confirmed against sandbox).
    SenderDetails: {
      SenderName: input.sender.name,
      SenderPhoneNumber: input.sender.phone,
      SenderAddress: input.sender.address,
      InputtedSenderAddress: input.sender.address,
      SenderStationId: stationIds.sender,
      SenderLocality: input.sender.lga || input.sender.state,
      SenderLocation: {
        Latitude: input.sender.latitude ?? 0,
        Longitude: input.sender.longitude ?? 0,
      },
    },

    ReceiverDetails: {
      // Unlike SenderDetails, ReceiverDetails has no "Locality" field —
      // confirmed against the sandbox ('"ReceiverDetails.ReceiverLocality"
      // is not allowed'). The schema is asymmetric between the two.
      ReceiverName: input.receiver.name,
      ReceiverPhoneNumber: input.receiver.phone,
      ReceiverAddress: input.receiver.address,
      InputtedReceiverAddress: input.receiver.address,
      ReceiverStationId: stationIds.receiver,
      ReceiverLocation: {
        Latitude: input.receiver.latitude ?? 0,
        Longitude: input.receiver.longitude ?? 0,
      },
    },

    ShipmentDetails: {
      VehicleType: 2,
      IsPriorityShipment: !!input.isPriorityShipment,
      IsCashOnDelivery: false,
    },

    // Unlike /price, /capture/preshipment rejects a top-level CustomerCode
    // ('"CustomerCode" is not allowed') — the account is derived from the
    // access-token header instead.

    ShipmentItems: input.items.map((it) => ({
      ItemName: it.itemName,
      Description: it.description || toGiglNature(it.parcelClass),
      Weight: Math.max(0.1, it.weightKg),
      Quantity: Math.max(1, Math.round(it.quantity)),
      ShipmentType: toGiglShipmentType(it.parcelClass),
      IsVolumetric: false,
      SpecialPackageId: 1, // see note in buildPriceBody — sandbox requires this
      ...(typeof it.value === "number" && it.value > 0 ? { Value: it.value } : {}),
    })),
  };
}

async function callCapturePreshipment(token: string, body: object): Promise<any> {
  const res = await axios.post(`${GIGL_BASE_URL}/capture/preshipment`, body, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "access-token": token,
      Authorization: `Bearer ${token}`,
    },
    timeout: GIGL_TIMEOUT_MS,
  });
  return res.data;
}

/**
 * Books a real GIGL shipment — this is what actually notifies GIGL to send
 * someone to collect from the sender's address and deliver to the receiver.
 * Returns the Waybill (GIGL's tracking reference) on success.
 */
export async function createGiglShipment(
  input: GiglShipmentInput
): Promise<GiglShipmentResult> {
  const token = await authenticate();

  const [senderStationId, receiverStationId] = await Promise.all([
    findGiglStationId(input.sender.state, input.sender.lga),
    findGiglStationId(input.receiver.state, input.receiver.lga),
  ]);

  if (!senderStationId || !receiverStationId) {
    throw new Error(
      `GIGL: could not resolve a station for ${
        !senderStationId ? `sender state "${input.sender.state}"` : `receiver state "${input.receiver.state}"`
      }`
    );
  }

  const stationIds = { sender: senderStationId, receiver: receiverStationId };
  const body = buildShipmentBody(input, stationIds);
  console.log("[GIGL] POST /capture/preshipment body:", JSON.stringify(body));

  let data: any;
  try {
    data = await callCapturePreshipment(token, body);
  } catch (err) {
    const ae = err as AxiosError;
    const status = ae.response?.status;
    const respData = ae.response?.data as any;
    if (status === 440 || respData?.status === 440) {
      console.warn("[GIGL] 440 Invalid Token — clearing cache and retrying login");
      _cachedToken = null;
      _tokenExpiresAt = 0;
      const freshToken = await authenticate();
      const freshBody = buildShipmentBody(input, stationIds);
      try {
        data = await callCapturePreshipment(freshToken, freshBody);
      } catch (err2) {
        const ae2 = err2 as AxiosError;
        const detail2 = ae2.response?.data ?? ae2.message;
        throw new Error(
          `GIGL /capture/preshipment failed (${ae2.response?.status ?? "network"}): ${JSON.stringify(detail2)}`
        );
      }
    } else {
      const detail = ae.response?.data ?? ae.message;
      console.error("[GIGL] /capture/preshipment error response:", JSON.stringify(ae.response?.data));
      throw new Error(
        `GIGL /capture/preshipment failed (${ae.response?.status ?? "network"}): ${JSON.stringify(detail)}`
      );
    }
  }

  console.log("[GIGL] /capture/preshipment raw response:", JSON.stringify(data));

  const payload = data?.data ?? data;
  const waybill = String(payload?.data?.Waybill ?? payload?.Waybill ?? "").trim();

  if (!waybill) {
    throw new Error(`GIGL /capture/preshipment: no waybill in response — ${JSON.stringify(data)}`);
  }

  return { waybill, rawResponse: data };
}
