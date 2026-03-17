// src/pages/Checkout.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router-dom";
import api from "../api/client.js";
import { useAuthStore } from "../store/auth";
import { useModal } from "../components/ModalProvider";
import SiteLayout from "../layouts/SiteLayout.js";
import { getAttribution } from "../utils/attribution.js";
import { readCartLines, writeCartLines, toCartPageItems } from "../utils/cartModel";
import { STATE_TO_LGAS, NIGERIAN_STATES } from "../constants/nigeriaLocations.js";
import { COUNTRIES } from "../constants/countries.js";
import { markPaystackExit } from "../utils/paystackReturn.js";

/* ----------------------------- Config ----------------------------- */
const VERIFY_PATH = "/verify";
const AXIOS_COOKIE_CFG = { withCredentials: true as const };
const SHIPPING_QUOTE_CACHE_TTL = 30_000;

/* ----------------------------- Types ----------------------------- */
type SelectedOption = {
  attributeId: string;
  attribute: string;
  valueId?: string;
  value: string;
};

type CartLine = {
  kind?: "BASE" | "VARIANT";
  productId: string;
  title: string;
  qty: number;
  offerId?: string;
  unitPrice?: number;
  variantId?: string | null;
  selectedOptions?: SelectedOption[];
  price?: number;
  totalPrice?: number;
  image?: string | null;
  supplierId?: string | null;
};

type Address = {
  houseNumber: string;
  streetName: string;
  postCode: string;
  town: string;
  city: string;
  state: string;
  country: string;
  lga?: string;
};

type QuoteAllocation = {
  supplierId: string;
  supplierName?: string | null;
  qty: number;
  unitPrice: number;
  offerId?: string | null;
  lineTotal?: number;
};

type QuoteLine = {
  key: string;
  productId: string;
  variantId?: string | null;
  kind: "BASE" | "VARIANT";
  qtyRequested: number;
  qtyPriced: number;
  allocations: QuoteAllocation[];
  lineTotal: number;
  minUnit: number;
  maxUnit: number;
  averageUnit: number;
  currency?: string | null;
  warnings?: string[];
};

type QuotePayload = {
  currency?: string | null;
  subtotal: number;
  lines: Record<string, QuoteLine>;
  raw?: any;
};

type ShippingQuoteLite = {
  shippingQuoteId: string;
  supplierId: string;
  supplierName?: string | null;
  totalFee: number;
  shippingFee: number;
  remoteSurcharge: number;
  fuelSurcharge: number;
  handlingFee: number;
  insuranceFee: number;
  currency: string;
  serviceLevel: string;
  zoneCode?: string | null;
  zoneName?: string | null;
  etaMinDays?: number | null;
  etaMaxDays?: number | null;
  rateSource?: string | null;
  error?: string | null;
};

type ShippingQuoteResponse = {
  currency: string;
  totalFee: number;
  quotes: ShippingQuoteLite[];
  partial: boolean;
  error: string | null;
  raw?: any;
};

type PublicSettings = {
  shippingEnabled?: boolean | string | number | null;
};

type HomeAddress = {
  id?: string;
  houseNumber?: string | null;
  streetName?: string | null;
  postCode?: string | null;
  town?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  lga?: string | null;
};

type SavedShippingAddress = {
  id: string;
  label?: string | null;
  recipientName?: string | null;
  phone: string;
  whatsappPhone?: string | null;
  houseNumber?: string | null;
  streetName?: string | null;
  postCode?: string | null;
  town?: string | null;
  city: string;
  state: string;
  country: string;
  lga?: string | null;
  landmark?: string | null;
  directionsNote?: string | null;
  isDefault?: boolean;
  isActive?: boolean;

  phoneVerifiedAt?: unknown;
  phoneVerifiedBy?: string | null;
  verificationMeta?: any;
};

type ShippingAddressForm = {
  label: string;
  recipientName: string;
  phone: string;
  whatsappPhone: string;
  houseNumber: string;
  streetName: string;
  postCode: string;
  town: string;
  city: string;
  state: string;
  country: string;
  lga: string;
  landmark: string;
  directionsNote: string;
};

type ProfileMe = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  emailVerifiedAt?: unknown;
  phoneVerifiedAt?: unknown;
  emailVerified?: boolean;
  phoneVerified?: boolean;

  address?: HomeAddress | null;
  shippingAddress?: SavedShippingAddress | null;
  shippingAddresses?: SavedShippingAddress[];
  defaultShippingAddressId?: string | null;
};

const EMPTY_ADDR: Address = {
  houseNumber: "",
  streetName: "",
  postCode: "",
  town: "",
  city: "",
  state: "",
  country: "Nigeria",
  lga: "",
};

type SameAsHomeUsage = {
  used: boolean;
};

const SAME_AS_HOME_ONCE_KEY = "checkout:sameAsHomeOnce:v1";

function readSameAsHomeUsage(): SameAsHomeUsage {
  try {
    const raw = localStorage.getItem(SAME_AS_HOME_ONCE_KEY);
    if (!raw) return { used: false };
    const parsed = JSON.parse(raw);
    return { used: !!parsed?.used };
  } catch {
    return { used: false };
  }
}

function writeSameAsHomeUsage(v: SameAsHomeUsage) {
  try {
    localStorage.setItem(SAME_AS_HOME_ONCE_KEY, JSON.stringify(v));
  } catch {
    //
  }
}

const NIGERIA_COUNTRY = "Nigeria";

function lgasForState(state: string) {
  return STATE_TO_LGAS[state] ?? [];
}

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

/* ----------------------------- Helpers ----------------------------- */
const num = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const asInt = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
};

const asMoney = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function toArray<T = any>(x: any): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function digitsOnly(s: string) {
  return String(s || "").replace(/[^\d+]/g, "");
}

function normalizePhoneForCompare(s: string) {
  return digitsOnly(s).replace(/^\+/, "");
}

function validateShippingAddressForm(a: ShippingAddressForm): string | null {
  if (!a.label.trim()) return "Enter an address label";
  if (!a.recipientName.trim()) return "Enter recipient name";
  if (!a.phone.trim()) return "Enter phone number";
  if (normalizePhoneForCompare(a.phone).length < 10) return "Enter a valid phone number";
  if (!a.whatsappPhone.trim()) return "Enter WhatsApp phone number";
  if (normalizePhoneForCompare(a.whatsappPhone).length < 10) return "Enter a valid WhatsApp phone number";
  if (!a.houseNumber.trim()) return "Enter house/plot number";
  if (!a.streetName.trim()) return "Enter street name";
  if (!a.city.trim()) return "Enter city";
  if (!a.state.trim()) return "Select a state";
  if (!a.lga.trim()) return "Select or enter an LGA";
  return null;
}

function normalizeSelectedOptions(raw: any): SelectedOption[] {
  const arr = toArray<SelectedOption>(raw)
    .map((o: any) => ({
      attributeId: String(o.attributeId ?? ""),
      attribute: String(o.attribute ?? ""),
      valueId: o.valueId ? String(o.valueId) : undefined,
      value: String(o.value ?? ""),
    }))
    .filter((o) => o.attributeId || o.attribute || o.valueId || o.value);

  arr.sort((a, b) => {
    const aKey = `${a.attributeId}:${a.valueId ?? a.value}`;
    const bKey = `${b.attributeId}:${b.valueId ?? b.value}`;
    return aKey.localeCompare(bKey);
  });

  return arr;
}

function optionsKey(sel?: SelectedOption[]) {
  const s = (sel ?? []).filter(Boolean);
  if (!s.length) return "";
  return s.map((o) => `${o.attributeId}=${o.valueId ?? o.value}`).join("|");
}

function lineKeyFor(item: Pick<CartLine, "productId" | "variantId" | "selectedOptions" | "kind">) {
  const pid = String(item.productId);
  const vid = item.variantId == null ? null : String(item.variantId);
  const sel = normalizeSelectedOptions(item.selectedOptions);

  const kind: "BASE" | "VARIANT" =
    item.kind === "BASE" || item.kind === "VARIANT"
      ? item.kind
      : item.variantId
        ? "VARIANT"
        : "BASE";

  if (kind === "VARIANT") {
    if (vid) return `${pid}::v:${vid}`;
    return sel.length ? `${pid}::o:${optionsKey(sel)}` : `${pid}::v:unknown`;
  }

  return `${pid}::base`;
}

function normalizeCartLine(x: any): CartLine | null {
  const productId = String(x?.productId ?? "").trim();
  if (!productId) return null;

  const qty = Math.max(1, num(x?.qty, 1));

  const directUnit = asMoney(x?.unitPrice, NaN);
  const directPrice = asMoney(x?.price, NaN);
  const fromTotal = qty > 0 ? asMoney(x?.totalPrice, NaN) / qty : NaN;

  const firstFinite = [directUnit, directPrice, fromTotal].find((v) => Number.isFinite(v));
  const unit = Number.isFinite(firstFinite as number) ? Number(firstFinite) : 0;

  const rawKind = x?.kind === "BASE" || x?.kind === "VARIANT" ? x.kind : undefined;
  const inferredKind: "BASE" | "VARIANT" = rawKind ?? (x?.variantId ? "VARIANT" : "BASE");

  const selectedOptions = normalizeSelectedOptions(x?.selectedOptions);

  return {
    kind: inferredKind,
    productId,
    title: String(x?.title ?? ""),
    qty,
    unitPrice: unit,
    price: unit,
    variantId: x?.variantId ?? null,
    selectedOptions,
    totalPrice: Number.isFinite(asMoney(x?.totalPrice, NaN)) ? asMoney(x?.totalPrice, 0) : unit * qty,
    image: x?.image ?? null,
    supplierId: x?.supplierId ?? null,
    offerId: x?.offerId ? String(x.offerId) : undefined,
  };
}

function readCart(): CartLine[] {
  try {
    const lines = readCartLines();
    const mapped = toCartPageItems(lines, (img?: any) => img) as any[];

    return mapped
      .map((x: any) =>
        normalizeCartLine({
          kind: x?.kind,
          productId: x?.productId,
          title: x?.title,
          qty: x?.qty,
          unitPrice: x?.unitPrice,
          price: x?.unitPrice,
          variantId: x?.variantId ?? null,
          selectedOptions: x?.selectedOptions,
          totalPrice: x?.totalPrice,
          image: x?.image ?? null,
          supplierId: x?.supplierId ?? null,
          offerId: x?.offerId ?? undefined,
        })
      )
      .filter(Boolean) as CartLine[];
  } catch {
    return [];
  }
}

function writeCart(lines: CartLine[]) {
  const normalized = lines
    .map((l) => {
      const unit = num(l.unitPrice, num(l.price, 0));
      const qty = Math.max(1, num(l.qty, 1));

      const rawKind = l.kind === "BASE" || l.kind === "VARIANT" ? l.kind : undefined;
      const inferredKind: "BASE" | "VARIANT" = rawKind ?? (l.variantId ? "VARIANT" : "BASE");

      const sel = normalizeSelectedOptions(l.selectedOptions);

      return {
        productId: String(l.productId),
        variantId: l.variantId ?? null,
        kind: inferredKind,
        optionsKey: "",
        qty,
        selectedOptions: sel,
        titleSnapshot: l.title ?? null,
        imageSnapshot: l.image ?? null,
        unitPriceCache: unit,
      };
    })
    .filter((x) => x.qty > 0);

  writeCartLines(normalized as any);
  window.dispatchEvent(new Event("cart:updated"));
}

function removeCartLineByKey(lines: CartLine[], targetKey: string): CartLine[] {
  return lines.filter((line) => lineKeyFor(line) !== targetKey);
}

function normalizeSavedShippingAddressLike(raw: any): SavedShippingAddress | null {
  const root = raw?.data?.data ?? raw?.data ?? raw ?? null;
  const item = root?.shippingAddress ?? root?.address ?? root?.item ?? root?.data ?? root;

  if (!item) return null;

  const id = String(item?.id ?? item?.shippingAddressId ?? "").trim();
  const city = String(item?.city ?? "").trim();
  const state = String(item?.state ?? "").trim();
  const phone = String(item?.phone ?? "").trim();

  if (!id || !city || !state || !phone) return null;

  return {
    id,
    label: item?.label ?? null,
    recipientName: item?.recipientName ?? null,
    phone,
    whatsappPhone: item?.whatsappPhone ?? null,
    houseNumber: item?.houseNumber ?? null,
    streetName: item?.streetName ?? null,
    postCode: item?.postCode ?? null,
    town: item?.town ?? null,
    city,
    state,
    country: String(item?.country ?? "Nigeria"),
    lga: item?.lga ?? null,
    landmark: item?.landmark ?? null,
    directionsNote: item?.directionsNote ?? null,
    isDefault: !!item?.isDefault,
    isActive: item?.isActive == null ? true : !!item?.isActive,
    phoneVerifiedAt: item?.phoneVerifiedAt ?? null,
    phoneVerifiedBy: item?.phoneVerifiedBy ?? null,
    verificationMeta: item?.verificationMeta ?? null,
  };
}

function shippingFormToSaved(form: ShippingAddressForm, id: string, isDefault = false): SavedShippingAddress {
  return {
    id,
    label: form.label.trim(),
    recipientName: form.recipientName.trim(),
    phone: form.phone.trim(),
    whatsappPhone: form.whatsappPhone.trim(),
    houseNumber: form.houseNumber.trim(),
    streetName: form.streetName.trim(),
    postCode: form.postCode.trim(),
    town: form.town.trim(),
    city: form.city.trim(),
    state: form.state.trim(),
    country: countryNameFromCodeOrName(form.country) || NIGERIA_COUNTRY,
    lga: form.lga.trim(),
    landmark: form.landmark.trim(),
    directionsNote: form.directionsNote.trim(),
    isDefault,
    isActive: true,
    phoneVerifiedAt: null,
    phoneVerifiedBy: null,
    verificationMeta: null,
  };
}

function savedShippingToQuoteAddress(a?: SavedShippingAddress | null): Address {
  return {
    houseNumber: a?.houseNumber ?? "",
    streetName: a?.streetName ?? "",
    postCode: a?.postCode ?? "",
    town: a?.town ?? "",
    city: a?.city ?? "",
    state: a?.state ?? "",
    country: countryNameFromCodeOrName(a?.country) || NIGERIA_COUNTRY,
    lga: a?.lga ?? "",
  };
}

function mergeProfileShippingAddresses(profile?: ProfileMe | null) {
  const list = toArray<SavedShippingAddress>(profile?.shippingAddresses).filter(Boolean);
  const legacy = profile?.shippingAddress ?? null;

  const map = new Map<string, SavedShippingAddress>();

  for (const item of list) {
    const id = String(item?.id ?? "").trim();
    const city = String(item?.city ?? "").trim();
    const state = String(item?.state ?? "").trim();
    const phone = String(item?.phone ?? "").trim();
    if (!id || !city || !state || !phone) continue;

    map.set(id, {
      ...item,
      country: item.country || "Nigeria",
      isActive: item.isActive == null ? true : !!item.isActive,
      phoneVerifiedAt: item.phoneVerifiedAt ?? null,
      phoneVerifiedBy: item.phoneVerifiedBy ?? null,
      verificationMeta: item.verificationMeta ?? null,
    });
  }

  if (legacy?.city && legacy?.state && legacy?.phone) {
    const legacyId = String(legacy.id ?? "legacy-shipping");
    if (!map.has(legacyId)) {
      map.set(legacyId, {
        ...legacy,
        id: legacyId,
        country: legacy.country || "Nigeria",
        isActive: legacy.isActive == null ? true : !!legacy.isActive,
        phoneVerifiedAt: (legacy as any)?.phoneVerifiedAt ?? null,
        phoneVerifiedBy: (legacy as any)?.phoneVerifiedBy ?? null,
        verificationMeta: (legacy as any)?.verificationMeta ?? null,
      });
    }
  }

  const addresses = Array.from(map.values()).filter((a) => a.isActive !== false);

  let defaultId =
    String(profile?.defaultShippingAddressId ?? "").trim() ||
    addresses.find((a) => a.isDefault)?.id ||
    addresses[0]?.id ||
    null;

  addresses.sort((a, b) => {
    const aScore = a.id === defaultId || a.isDefault ? 1 : 0;
    const bScore = b.id === defaultId || b.isDefault ? 1 : 0;
    return bScore - aScore;
  });

  return { addresses, defaultId };
}

function isSavedAddressPhoneVerified(addr?: SavedShippingAddress | null) {
  if (!addr) return false;
  return normalizeStampPresent(addr.phoneVerifiedAt);
}

async function tryRequests<T>(requests: Array<() => Promise<T>>): Promise<T> {
  let lastErr: any = null;
  for (const fn of requests) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function saveShippingAddressEntry(args: {
  form: ShippingAddressForm;
  id?: string | null;
  isDefault?: boolean;
}) {
  const { form, id, isDefault } = args;
  const payload = {
    ...form,
    country: countryNameFromCodeOrName(form.country) || NIGERIA_COUNTRY,
    phone: digitsOnly(form.phone),
    whatsappPhone: digitsOnly(form.whatsappPhone),
    isDefault: !!isDefault,
    isActive: true,
  };

  if (id) {
    return tryRequests([
      () => api.patch(`/api/profile/shipping-addresses/${encodeURIComponent(id)}`, payload, AXIOS_COOKIE_CFG),
      () => api.put(`/api/profile/shipping-addresses/${encodeURIComponent(id)}`, payload, AXIOS_COOKIE_CFG),
      () => api.patch(`/api/profile/shipping/addresses/${encodeURIComponent(id)}`, payload, AXIOS_COOKIE_CFG),
    ]);
  }

  return tryRequests([
    () => api.post("/api/profile/shipping-addresses", payload, AXIOS_COOKIE_CFG),
    () => api.post("/api/profile/shipping/addresses", payload, AXIOS_COOKIE_CFG),
  ]);
}

async function deleteShippingAddressEntry(id: string) {
  return tryRequests([
    () => api.delete(`/api/profile/shipping-addresses/${encodeURIComponent(id)}`, AXIOS_COOKIE_CFG),
    () => api.delete(`/api/profile/shipping/addresses/${encodeURIComponent(id)}`, AXIOS_COOKIE_CFG),
  ]);
}

async function setDefaultShippingAddressEntry(id: string) {
  return tryRequests([
    () => api.post(`/api/profile/shipping-addresses/${encodeURIComponent(id)}/default`, {}, AXIOS_COOKIE_CFG),
    () => api.patch(`/api/profile/shipping-addresses/${encodeURIComponent(id)}`, { isDefault: true }, AXIOS_COOKIE_CFG),
    () => api.post(`/api/profile/shipping/addresses/${encodeURIComponent(id)}/default`, {}, AXIOS_COOKIE_CFG),
  ]);
}

async function syncSelectedShippingAddressEntry(address: SavedShippingAddress) {
  return tryRequests([
    () =>
      api.post(
        "/api/profile/shipping-addresses/select",
        { shippingAddressId: address.id },
        AXIOS_COOKIE_CFG
      ),
    () =>
      api.post(
        "/api/profile/shipping/select",
        { shippingAddressId: address.id },
        AXIOS_COOKIE_CFG
      ),
    () =>
      api.patch(
        `/api/profile/shipping-addresses/${encodeURIComponent(address.id)}`,
        { selected: true },
        AXIOS_COOKIE_CFG
      ),
  ]);
}

async function sendPhoneOtpForCheckout(args: { shippingAddressId: string }) {
  return api.post(
    `/api/profile/shipping-addresses/${encodeURIComponent(args.shippingAddressId)}/request-phone-otp`,
    {},
    AXIOS_COOKIE_CFG
  );
}

async function verifyPhoneOtpForCheckout(args: { shippingAddressId: string; code: string }) {
  return api.post(
    `/api/profile/shipping-addresses/${encodeURIComponent(args.shippingAddressId)}/verify-phone`,
    {
      otp: String(args.code).trim(),
    },
    AXIOS_COOKIE_CFG
  );
}

/* ---------------- Supplier split pricing quote ---------------- */
function normalizeQuoteResponse(raw: any, cart: CartLine[]): QuotePayload | null {
  const root = raw?.data?.data ?? raw?.data ?? raw ?? null;
  if (!root) return null;

  const currency = root.currency ?? root?.quote?.currency ?? null;
  const maybe = root.quote ?? root;
  const subtotal = asMoney(
    maybe.subtotal ?? maybe.itemsSubtotal ?? maybe.totalItems ?? maybe.total ?? 0,
    0
  );

  const outLines: Record<string, QuoteLine> = {};

  const ensureKey = (x: any) => {
    const k = String(x?.key ?? "");
    if (k) return k;

    const pid = String(x?.productId ?? "");
    const vid = x?.variantId == null ? null : String(x.variantId);
    const kind: "BASE" | "VARIANT" =
      x?.kind === "VARIANT" || (!!vid && x?.kind !== "BASE") ? "VARIANT" : "BASE";

    if (!pid) return "";
    if (kind === "VARIANT") return vid ? `${pid}::v:${vid}` : `${pid}::v:unknown`;
    return `${pid}::base`;
  };

  const normalizeAlloc = (a: any): QuoteAllocation => {
    const qty = Math.max(0, asInt(a?.qty ?? a?.quantity ?? 0, 0));
    const unitPrice = asMoney(a?.unitPrice ?? a?.price ?? a?.supplierPrice ?? 0, 0);
    const lineTotal = asMoney(a?.lineTotal ?? qty * unitPrice, qty * unitPrice);

    return {
      supplierId: String(a?.supplierId ?? a?.supplier_id ?? ""),
      supplierName: a?.supplierName ?? a?.supplier?.name ?? null,
      qty,
      unitPrice,
      offerId: a?.offerId ?? a?.supplierOfferId ?? null,
      lineTotal,
    };
  };

  const normalizeLine = (x: any): QuoteLine | null => {
    const key = ensureKey(x);
    if (!key) return null;

    const productId = String(x?.productId ?? "");
    const variantId = x?.variantId == null ? null : String(x.variantId);
    const kind: "BASE" | "VARIANT" =
      x?.kind === "BASE" || x?.kind === "VARIANT"
        ? x.kind
        : variantId
          ? "VARIANT"
          : "BASE";

    const qtyRequested = Math.max(1, asInt(x?.qtyRequested ?? x?.qty ?? x?.requestedQty ?? 1, 1));

    const allocsRaw = toArray<any>(x?.allocations ?? x?.splits ?? x?.items ?? x?.parts);
    const allocations = allocsRaw
      .map(normalizeAlloc)
      .filter((a) => a.qty > 0 && a.unitPrice >= 0);

    const lineTotal = asMoney(
      x?.lineTotal ?? x?.total ?? allocations.reduce((s, a) => s + asMoney(a.lineTotal, 0), 0),
      0
    );

    const qtyPriced = Math.max(
      0,
      asInt(x?.qtyPriced ?? allocations.reduce((s, a) => s + asInt(a.qty, 0), 0), 0)
    );

    const units = allocations
      .map((a) => asMoney(a.unitPrice, NaN))
      .filter((n) => Number.isFinite(n));
    const minUnit = units.length ? Math.min(...(units as number[])) : 0;
    const maxUnit = units.length ? Math.max(...(units as number[])) : 0;
    const averageUnit = qtyRequested > 0 ? lineTotal / qtyRequested : 0;

    const warnings: string[] = [];
    if (qtyPriced < qtyRequested) warnings.push("Some units could not be priced/allocated.");

    return {
      key,
      productId,
      variantId,
      kind,
      qtyRequested,
      qtyPriced,
      allocations,
      lineTotal,
      minUnit,
      maxUnit,
      averageUnit,
      currency,
      warnings: warnings.length ? warnings : undefined,
    };
  };

  if (Array.isArray(maybe?.lines)) {
    for (const x of maybe.lines) {
      const ln = normalizeLine(x);
      if (ln) outLines[ln.key] = ln;
    }
  }

  if (!Object.keys(outLines).length && maybe?.lines && typeof maybe.lines === "object") {
    for (const [k, v] of Object.entries(maybe.lines)) {
      const ln = normalizeLine({ ...(v as any), key: k });
      if (ln) outLines[ln.key] = ln;
    }
  }

  const hasAny = Object.keys(outLines).length > 0;
  if (!hasAny && !(subtotal > 0)) return null;

  for (const it of cart) {
    const k = lineKeyFor(it);
    if (!outLines[k]) {
      outLines[k] = {
        key: k,
        productId: it.productId,
        variantId: it.variantId ?? null,
        kind: it.kind === "VARIANT" || it.variantId ? "VARIANT" : "BASE",
        qtyRequested: Math.max(1, asInt(it.qty, 1)),
        qtyPriced: 0,
        allocations: [],
        lineTotal: 0,
        minUnit: 0,
        maxUnit: 0,
        averageUnit: 0,
        currency,
        warnings: ["No quote returned for this line."],
      };
    }
  }

  return { currency, subtotal, lines: outLines, raw };
}

async function fetchPricingQuoteForCart(cart: CartLine[]): Promise<QuotePayload | null> {
  if (!cart.length) return null;

  const items = cart.map((it) => ({
    key: lineKeyFor(it),
    kind: it.kind === "VARIANT" || it.variantId ? "VARIANT" : "BASE",
    productId: it.productId,
    variantId: it.variantId ?? null,
    qty: Math.max(1, asInt(it.qty, 1)),
    selectedOptions: Array.isArray(it.selectedOptions)
      ? normalizeSelectedOptions(it.selectedOptions)
      : undefined,
    offerId: it.offerId || undefined,
    supplierId: it.supplierId || undefined,
    unitPriceCache: asMoney(it.unitPrice, asMoney(it.price, 0)),
  }));

  const attempts: Array<{ method: "post" | "get"; url: string; body?: any }> = [
    { method: "post", url: "/api/catalog/quote", body: { items } },
    { method: "post", url: "/api/cart/quote", body: { items } },
    { method: "post", url: "/api/checkout/quote", body: { items } },
    { method: "post", url: "/api/orders/quote", body: { items } },
    { method: "post", url: "/api/catalog/pricing", body: { items } },
    { method: "post", url: "/api/cart/pricing", body: { items } },
    { method: "post", url: "/api/checkout/pricing", body: { items } },
  ];

  for (const a of attempts) {
    try {
      const res =
        a.method === "post"
          ? await api.post(a.url, a.body, AXIOS_COOKIE_CFG)
          : await api.get(a.url, {
            ...AXIOS_COOKIE_CFG,
            params: { items: JSON.stringify(items) },
          });

      const normalized = normalizeQuoteResponse(res, cart);
      if (normalized) return normalized;
    } catch {
      //
    }
  }

  return null;
}

/* ---------------- Shipping quote helpers ---------------- */
function normalizeShippingQuoteResponse(raw: any): ShippingQuoteResponse | null {
  const root = raw?.data?.data ?? raw?.data ?? raw ?? null;
  if (!root) return null;

  const pickMoney = (...vals: any[]) => {
    for (const v of vals) {
      const n = Number(v);
      if (Number.isFinite(n)) return round2(n);
    }
    return 0;
  };

  const quotesRaw = toArray<any>(
    root.quotes ?? root.shippingQuotes ?? root.data?.quotes ?? root.data?.shippingQuotes
  );

  if (quotesRaw.length) {
    const quotes = quotesRaw
      .map((q) => {
        const shippingQuoteId = String(q.shippingQuoteId ?? q.id ?? q.quoteId ?? "").trim();
        const supplierId = String(q.supplierId ?? q.supplier?.id ?? q.vendorId ?? "").trim();

        if (!supplierId) return null;

        const breakdown = q.breakdown ?? {};
        const components = q.components ?? breakdown.components ?? {};

        const shippingFee = pickMoney(q.shippingFee, breakdown.shippingFee, components.shippingFee);
        const remoteSurcharge = pickMoney(q.remoteSurcharge, breakdown.remoteSurcharge, components.remoteSurcharge);
        const fuelSurcharge = pickMoney(q.fuelSurcharge, breakdown.fuelSurcharge, components.fuelSurcharge);
        const handlingFee = pickMoney(q.handlingFee, breakdown.handlingFee, components.handlingFee);
        const insuranceFee = pickMoney(q.insuranceFee, breakdown.insuranceFee, components.insuranceFee);
        const totalFee = pickMoney(
          q.totalFee,
          breakdown.totalFee,
          q.amount,
          shippingFee + remoteSurcharge + fuelSurcharge + handlingFee + insuranceFee
        );

        return {
          shippingQuoteId,
          supplierId,
          supplierName: q.supplierName ?? q.supplier?.name ?? q.vendorName ?? breakdown.supplierName ?? null,
          totalFee,
          shippingFee,
          remoteSurcharge,
          fuelSurcharge,
          handlingFee,
          insuranceFee,
          currency: String(q.currency ?? root.currency ?? "NGN"),
          serviceLevel: String(q.serviceLevel ?? breakdown.serviceLevel ?? "STANDARD"),
          zoneCode: q.zoneCode ?? breakdown.zoneCode ?? null,
          zoneName: q.zoneName ?? breakdown.zoneName ?? null,
          etaMinDays:
            q.etaMinDays == null
              ? breakdown.etaMinDays == null
                ? null
                : Number(breakdown.etaMinDays)
              : Number(q.etaMinDays),
          etaMaxDays:
            q.etaMaxDays == null
              ? breakdown.etaMaxDays == null
                ? null
                : Number(breakdown.etaMaxDays)
              : Number(q.etaMaxDays),
          rateSource: q.rateSource ?? breakdown.rateSource ?? null,
          error: q.error ? String(q.error) : null,
        } as ShippingQuoteLite;
      })
      .filter(Boolean) as ShippingQuoteLite[];

    return {
      currency: String(root.currency ?? quotes[0]?.currency ?? "NGN"),
      totalFee: round2(quotes.reduce((s, q) => s + asMoney(q.totalFee, 0), 0)),
      quotes,
      partial: !!root.partial || quotes.some((q) => !!q.error),
      error: root.error ? String(root.error) : null,
      raw,
    };
  }

  if ("shippingFee" in root || "suppliers" in root) {
    const suppliers = toArray<any>(root.suppliers);
    const quotes = suppliers
      .map((s) => {
        const supplierId = String(s?.supplierId ?? s?.supplier?.id ?? "").trim();
        if (!supplierId) return null;

        const breakdown = s?.breakdown ?? {};
        const components = s?.components ?? breakdown.components ?? {};
        const totals = s?.totals ?? breakdown.totals ?? {};

        const shippingFee = pickMoney(s?.shippingFee, totals.shippingFee, breakdown.shippingFee, components.shippingFee);
        const remoteSurcharge = pickMoney(s?.remoteSurcharge, totals.remoteSurcharge, breakdown.remoteSurcharge, components.remoteSurcharge);
        const fuelSurcharge = pickMoney(s?.fuelSurcharge, totals.fuelSurcharge, breakdown.fuelSurcharge, components.fuelSurcharge);
        const handlingFee = pickMoney(s?.handlingFee, totals.handlingFee, breakdown.handlingFee, components.handlingFee);
        const insuranceFee = pickMoney(s?.insuranceFee, totals.insuranceFee, breakdown.insuranceFee, components.insuranceFee);
        const totalFee = pickMoney(
          s?.totalFee,
          totals.totalFee,
          breakdown.totalFee,
          shippingFee + remoteSurcharge + fuelSurcharge + handlingFee + insuranceFee
        );

        return {
          shippingQuoteId: String(s?.shippingQuoteId ?? s?.quoteId ?? "").trim(),
          supplierId,
          supplierName: s?.supplierName ?? s?.supplier?.name ?? null,
          totalFee,
          shippingFee,
          remoteSurcharge,
          fuelSurcharge,
          handlingFee,
          insuranceFee,
          currency: String(s?.currency ?? root.currency ?? "NGN"),
          serviceLevel: String(s?.serviceLevel ?? breakdown.serviceLevel ?? "STANDARD"),
          zoneCode: s?.zoneCode ?? breakdown.zoneCode ?? null,
          zoneName: s?.zoneName ?? breakdown.zoneName ?? null,
          etaMinDays:
            s?.etaMinDays != null
              ? Number(s.etaMinDays)
              : s?.eta?.minDays != null
                ? Number(s.eta.minDays)
                : null,
          etaMaxDays:
            s?.etaMaxDays != null
              ? Number(s.etaMaxDays)
              : s?.eta?.maxDays != null
                ? Number(s.eta.maxDays)
                : null,
          rateSource: s?.rateSource ?? breakdown.rateSource ?? "FALLBACK_ZONE",
          error: s?.error ? String(s.error) : null,
        } as ShippingQuoteLite;
      })
      .filter(Boolean) as ShippingQuoteLite[];

    return {
      currency: String(root.currency ?? "NGN"),
      totalFee: round2(
        quotes.length
          ? quotes.reduce((sum, q) => sum + asMoney(q.totalFee, 0), 0)
          : asMoney(root.shippingFee ?? 0, 0)
      ),
      quotes,
      partial: !!root.partial || quotes.some((q) => !!q.error),
      error: root.error ? String(root.error) : null,
      raw,
    };
  }

  return null;
}

function getShippingQuoteCacheKey(args: {
  cart: CartLine[];
  address: Address;
  selectedUserShippingAddressId?: string | null;
}) {
  const { cart, address, selectedUserShippingAddressId } = args;
  return JSON.stringify({
    items: cart.map((i) => ({
      productId: i.productId,
      variantId: i.variantId ?? null,
      qty: i.qty,
    })),
    selectedUserShippingAddressId: selectedUserShippingAddressId ?? null,
    city: address.city,
    state: address.state,
    lga: address.lga ?? "",
  });
}

async function fetchShippingQuotesForCart(args: {
  cart: CartLine[];
  address: Address;
  selectedUserShippingAddressId?: string | null;
}): Promise<ShippingQuoteResponse | null> {
  const { cart, address, selectedUserShippingAddressId } = args;
  if (!cart.length) return null;

  const cacheKey = getShippingQuoteCacheKey({
    cart,
    address,
    selectedUserShippingAddressId,
  });

  try {
    const cached = sessionStorage.getItem("shippingQuote:" + cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.ts < SHIPPING_QUOTE_CACHE_TTL) {
        return parsed.data as ShippingQuoteResponse;
      }
    }
  } catch {
    //
  }

  const items = cart.map((it) => ({
    productId: it.productId,
    variantId: it.variantId ?? null,
    qty: Math.max(1, asInt(it.qty, 1)),
    kind: it.kind === "VARIANT" || it.variantId ? "VARIANT" : "BASE",
    selectedOptions: Array.isArray(it.selectedOptions)
      ? normalizeSelectedOptions(it.selectedOptions)
      : undefined,
    offerId: it.offerId || undefined,
  }));

  const shippingAddress = {
    ...address,
    lga: address.lga ?? address.town ?? "",
  };

  const quoteBodyBase = {
    items,
    selectedUserShippingAddressId: selectedUserShippingAddressId || undefined,
    serviceLevel: "STANDARD",
  };

  const quoteBodyWithFallbackAddress = {
    ...quoteBodyBase,
    shippingAddress,
  };

  console.log("[checkout/shipping request payload]", {
    selectedUserShippingAddressId: selectedUserShippingAddressId || null,
    shippingAddress: shippingAddress,
  });

  const attempts: Array<{ url: string; body: any }> = [
    { url: "/api/checkout/shipping-quotes", body: quoteBodyWithFallbackAddress },
    { url: "/api/shipping/quotes/cart", body: quoteBodyWithFallbackAddress },
    { url: "/api/shipping/quote-cart", body: quoteBodyWithFallbackAddress },
    { url: "/api/checkout/shipping-fee-local", body: quoteBodyWithFallbackAddress },
  ];

  for (const attempt of attempts) {
    try {
      const res = await api.post(attempt.url, attempt.body, AXIOS_COOKIE_CFG);
      const normalized = normalizeShippingQuoteResponse(res);
      if (normalized) {
        try {
          sessionStorage.setItem(
            "shippingQuote:" + cacheKey,
            JSON.stringify({ ts: Date.now(), data: normalized })
          );
        } catch {
          //
        }
        return normalized;
      }
    } catch {
      //
    }
  }

  return null;
}

/* ---------------- Public settings ---------------- */
const coerceBool = (v: any): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (!s) return false;
    return ["true", "1", "yes", "y", "on"].includes(s);
  }
  if (typeof v === "number") return v !== 0;
  return false;
};

function extractShippingEnabled(s: PublicSettings | null | undefined): boolean {
  if (!s) return false;
  return coerceBool((s as any).shippingEnabled);
}

async function fetchPublicSettings(): Promise<PublicSettings | null> {
  const attempts = [
    "/api/settings/public",
    "/api/settings/public?include=pricing",
    "/api/settings/public?scope=commerce",
  ];

  for (const url of attempts) {
    try {
      const { data } = await api.get(url, AXIOS_COOKIE_CFG);
      const root = data?.data ?? data ?? null;
      if (root) return root as PublicSettings;
    } catch {
      //
    }
  }
  return null;
}

/* -------- Verification helpers -------- */
const normalizeStampPresent = (v: unknown) => {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (!s || s === "null" || s === "undefined") return false;
  return true;
};

function computeVerificationFlags(p?: ProfileMe) {
  const emailOk =
    p?.emailVerified === true ? true : normalizeStampPresent(p?.emailVerifiedAt);

  const phoneOk =
    p?.phoneVerified === true ? true : normalizeStampPresent(p?.phoneVerifiedAt);

  return { emailOk, phoneOk };
}

async function fetchProfileMe(): Promise<ProfileMe> {
  const attempts = ["/api/profile/me", "/api/auth/me"];
  let lastErr: any = null;

  for (const url of attempts) {
    try {
      const res = await api.get(url, AXIOS_COOKIE_CFG);
      return (res.data?.data ?? res.data ?? {}) as ProfileMe;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr;
}

/* ----------------------------- Small UI bits ----------------------------- */
const IconHome = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${props.className || ""}`} {...props}>
    <path
      d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

const IconTruck = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${props.className || ""}`} {...props}>
    <path
      d="M14 17H6a1 1 0 0 1-1-1V5h9v12ZM14 8h4l3 3v5a1 1 0 0 1-1 1h-1"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <circle cx="7.5" cy="18.5" r="1.5" fill="currentColor" />
    <circle cx="17.5" cy="18.5" r="1.5" fill="currentColor" />
  </svg>
);

const IconShield = (props: any) => (
  <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${props.className || ""}`} {...props}>
    <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3Z" stroke="currentColor" strokeWidth="1.5" />
    <path d="m9.5 12 1.7 1.7L14.8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Card({
  children,
  className = "",
  tone = "neutral",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "primary" | "emerald" | "amber" | "neutral";
}) {
  const toneBorder =
    tone === "primary"
      ? "border-primary-200"
      : tone === "emerald"
        ? "border-emerald-200"
        : tone === "amber"
          ? "border-amber-200"
          : "border-border";

  return (
    <div
      className={`rounded-2xl border ${toneBorder} bg-white/90 backdrop-blur shadow-sm overflow-hidden hover:shadow-md transition ${className}`}
    >
      {children}
    </div>
  );
}

function CardHeader({
  title,
  subtitle,
  icon,
  action,
  tone = "neutral",
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "primary" | "emerald" | "amber" | "neutral";
}) {
  const toneBg =
    tone === "primary"
      ? "from-primary-50 to-white"
      : tone === "emerald"
        ? "from-emerald-50 to-white"
        : tone === "amber"
          ? "from-amber-50 to-white"
          : "from-surface to-white";

  const toneIcon =
    tone === "primary"
      ? "text-primary-600"
      : tone === "emerald"
        ? "text-emerald-600"
        : tone === "amber"
          ? "text-amber-600"
          : "text-ink-soft";

  return (
    <div className={`flex items-center justify-between px-4 py-3 md:p-4 border-b border-border bg-gradient-to-b ${toneBg}`}>
      <div className="flex items-start gap-2.5 md:gap-3">
        {icon && <div className={`mt-[2px] ${toneIcon}`}>{icon}</div>}
        <div className="min-w-0">
          <h3 className="font-semibold text-ink text-sm md:text-base leading-5 md:leading-6">
            {title}
          </h3>
          {subtitle && (
            <p className="text-[11px] md:text-xs text-ink-soft leading-4 md:leading-5">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  (props, ref) => {
    return (
      <input
        ref={ref}
        {...props}
        className={`border border-border rounded-xl px-3 py-2.5 bg-white text-ink placeholder:text-ink-soft focus:outline-none focus:ring-4 focus:ring-primary-100 text-sm md:text-base ${props.className || ""}`}
      />
    );
  }
);

Input.displayName = "Input";

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`border border-border rounded-xl px-3 py-2.5 bg-white text-ink placeholder:text-ink-soft focus:outline-none focus:ring-4 focus:ring-primary-100 text-sm md:text-base ${props.className || ""}`}
    />
  );
}

function SelectBox(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`border border-border rounded-xl px-3 py-2.5 bg-white text-ink focus:outline-none focus:ring-4 focus:ring-primary-100 text-sm md:text-base ${props.className || ""}`}
    />
  );
}

function AddressPreview({ a }: { a: Address }) {
  return (
    <div className="px-4 py-3 md:p-4 text-xs md:text-sm leading-5 md:leading-6 text-ink">
      <div>{a.houseNumber} {a.streetName}</div>
      <div>{a.town || ""} {a.city || ""} {a.postCode || ""}</div>
      {!!a.lga && <div>LGA: {a.lga}</div>}
      <div>{a.state}, {a.country}</div>
    </div>
  );
}

function buildSupplierNameMap(quote: QuotePayload | null, shipping: ShippingQuoteResponse | null) {
  const map = new Map<string, string>();

  const pricingLines = Object.values(quote?.lines ?? {});
  for (const line of pricingLines) {
    for (const alloc of line.allocations ?? []) {
      const sid = String(alloc?.supplierId ?? "").trim();
      const sname = String(alloc?.supplierName ?? "").trim();
      if (sid && sname && !map.has(sid)) map.set(sid, sname);
    }
  }

  for (const q of shipping?.quotes ?? []) {
    const sid = String(q?.supplierId ?? "").trim();
    const sname = String(q?.supplierName ?? "").trim();
    if (sid && sname && !map.has(sid)) map.set(sid, sname);
  }

  return map;
}

function displaySupplierName(
  supplierId: string,
  supplierNameMap: Map<string, string>,
  explicitName?: string | null
) {
  const direct = String(explicitName ?? "").trim();
  if (direct) return direct;

  const mapped = supplierNameMap.get(String(supplierId).trim());
  if (mapped) return mapped;

  return `Supplier ${String(supplierId).slice(0, 8)}`;
}

function formatDeliveryAddressLine(a: SavedShippingAddress | null | undefined) {
  if (!a) return "";
  return [
    [a.houseNumber, a.streetName].filter(Boolean).join(" "),
    [a.town, a.city, a.postCode].filter(Boolean).join(" "),
    [a.lga ? `LGA: ${a.lga}` : "", a.state, a.country].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" • ");
}

function countryNameFromCodeOrName(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const byCode = COUNTRIES.find((c) => c.code.toLowerCase() === raw.toLowerCase());
  if (byCode) return byCode.name;

  const byName = COUNTRIES.find((c) => c.name.toLowerCase() === raw.toLowerCase());
  if (byName) return byName.name;

  return raw;
}

function makeEmptyShippingForm(defaultCountry = NIGERIA_COUNTRY): ShippingAddressForm {
  return {
    label: "",
    recipientName: "",
    phone: "",
    whatsappPhone: "",
    houseNumber: "",
    streetName: "",
    postCode: "",
    town: "",
    city: "",
    state: "",
    country: defaultCountry,
    lga: "",
    landmark: "",
    directionsNote: "",
  };
}

/* ----------------------------- Component ----------------------------- */
export default function Checkout() {
  const nav = useNavigate();
  const { openModal } = useModal();

  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);
  const meQ = useQuery({
    queryKey: ["auth", "me"],
    enabled: hydrated,
    queryFn: async () => {
      const res = await api.get("/api/auth/me", AXIOS_COOKIE_CFG);
      return (res.data?.data ?? res.data ?? null) as any;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    if (!hydrated) return;
    if (meQ.isLoading) return;

    const status = (meQ.error as any)?.response?.status;
    if (!meQ.data && status === 401) {
      nav("/login", { state: { from: { pathname: "/checkout" } }, replace: true });
    }
  }, [hydrated, meQ.isLoading, meQ.data, meQ.error, nav]);

  const [checkingVerification, setCheckingVerification] = useState(true);
  const [emailOk, setEmailOk] = useState(false);
  const [phoneOk, setPhoneOk] = useState(false);
  const [showNotVerified, setShowNotVerified] = useState(false);

  const [cart, setCart] = useState<CartLine[]>(() => readCart());

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  const [homeAddr, setHomeAddr] = useState<Address>(EMPTY_ADDR);
  const [showHomeForm, setShowHomeForm] = useState(false);
  const [savingHome, setSavingHome] = useState(false);

  const [profilePhone, setProfilePhone] = useState("");
  const [shippingAddresses, setShippingAddresses] = useState<SavedShippingAddress[]>([]);
  const [selectedShippingId, setSelectedShippingId] = useState<string | null>(null);
  const [showShippingEditor, setShowShippingEditor] = useState(false);
  const [editingShippingId, setEditingShippingId] = useState<string | null>(null);

  const [shippingForm, setShippingForm] = useState<ShippingAddressForm>(
    makeEmptyShippingForm(homeAddr.country || NIGERIA_COUNTRY)
  );

  const [makeDefaultShipping, setMakeDefaultShipping] = useState(false);
  const [savingShippingEntry, setSavingShippingEntry] = useState(false);
  const [deletingShippingId, setDeletingShippingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [syncingSelectedShippingId, setSyncingSelectedShippingId] = useState<string | null>(null);

  const [otpCode, setOtpCode] = useState("");
  const [otpSentToPhone, setOtpSentToPhone] = useState<string | null>(null);
  const [verifiedPhoneForCheckout, setVerifiedPhoneForCheckout] = useState<string | null>(null);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpMessage, setOtpMessage] = useState<string | null>(null);
  const shippingEditorRef = useRef<HTMLDivElement | null>(null);
  const firstShippingFieldRef = useRef<HTMLInputElement | null>(null);

  function shippingFormFromSaved(a?: SavedShippingAddress | null): ShippingAddressForm {
    if (!a) {
      return makeEmptyShippingForm(homeAddr.country || NIGERIA_COUNTRY);
    }

    return {
      label: a.label ?? "",
      recipientName: a.recipientName ?? "",
      phone: a.phone ?? "",
      whatsappPhone: a.whatsappPhone ?? "",
      houseNumber: a.houseNumber ?? "",
      streetName: a.streetName ?? "",
      postCode: a.postCode ?? "",
      town: a.town ?? "",
      city: a.city ?? "",
      state: a.state ?? "",
      country: countryNameFromCodeOrName(a.country) || NIGERIA_COUNTRY,
      lga: a.lga ?? "",
      landmark: a.landmark ?? "",
      directionsNote: a.directionsNote ?? "",
    };
  }

  const [redirectingOrderId, setRedirectingOrderId] = useState<string | null>(null);

  const publicSettingsQ = useQuery({
    queryKey: ["settings", "public:v1"],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: fetchPublicSettings,
  });

  const shippingEnabledFromSettings = useMemo(
    () => extractShippingEnabled(publicSettingsQ.data as PublicSettings | null),
    [publicSettingsQ.data]
  );

  const pricingQ = useQuery({
    queryKey: [
      "checkout",
      "pricing-quote:v1",
      cart.map((i) => `${lineKeyFor(i)}@${Math.max(1, asInt(i.qty, 1))}`).sort().join(","),
    ],
    enabled: cart.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    queryFn: () => fetchPricingQuoteForCart(cart),
  });

  const quoteSubtotalSupplier = (pricingQ.data as QuotePayload | null)?.subtotal ?? 0;

  function countryCodeFromCodeOrName(value?: string | null) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    const byCode = COUNTRIES.find((c) => c.code.toLowerCase() === raw.toLowerCase());
    if (byCode) return byCode.code;

    const byName = COUNTRIES.find((c) => c.name.toLowerCase() === raw.toLowerCase());
    if (byName) return byName.code;

    return "";
  }

  const cartSubtotal = useMemo(() => {
    return round2(
      cart.reduce((sum, line) => {
        const qty = Math.max(1, num(line.qty, 1));
        const unit =
          asMoney(line.unitPrice, 0) > 0
            ? asMoney(line.unitPrice, 0)
            : qty > 0
              ? asMoney(line.totalPrice, 0) / qty
              : 0;

        return sum + round2(Math.max(0, unit) * qty);
      }, 0)
    );
  }, [cart]);

  const itemsSubtotal = useMemo(() => {
    if (cartSubtotal > 0) return cartSubtotal;
    if (quoteSubtotalSupplier > 0) return round2(quoteSubtotalSupplier);
    return 0;
  }, [cartSubtotal, quoteSubtotalSupplier]);

  const pricingWarning = useMemo(() => {
    const q = pricingQ.data as QuotePayload | null;
    if (!q) return null;

    const unpriced = Object.values(q.lines || {}).filter((l) => l.qtyPriced < l.qtyRequested);
    if (!unpriced.length) return null;

    return "Some items could not be fully allocated across suppliers. Reduce quantities or try again.";
  }, [pricingQ.data]);

  const selectedShippingAddress = useMemo(
    () => shippingAddresses.find((a) => a.id === selectedShippingId) ?? null,
    [shippingAddresses, selectedShippingId]
  );

  const [sameAsHomeUsage, setSameAsHomeUsage] = useState<SameAsHomeUsage>(() => readSameAsHomeUsage());
  const sameAsHomeAvailable = !sameAsHomeUsage.used && !editingShippingId;

  const selectedShippingQuoteAddress = useMemo(
    () => savedShippingToQuoteAddress(selectedShippingAddress),
    [selectedShippingAddress]
  );

  const shippingEnabled = useMemo(() => shippingEnabledFromSettings, [shippingEnabledFromSettings]);
  const shippingMode: "DELIVERY" | "PICKUP_ONLY" = shippingEnabled ? "DELIVERY" : "PICKUP_ONLY";

  const isSelectedShippingAddressValid = useMemo(() => {
    if (!selectedShippingAddress) return false;
    return !validateShippingAddressForm(shippingFormFromSaved(selectedShippingAddress));
  }, [selectedShippingAddress]);

  const selectedPhoneVerified = useMemo(() => {
    if (!selectedShippingAddress) return false;

    if (isSavedAddressPhoneVerified(selectedShippingAddress)) return true;

    const selectedPhone = normalizePhoneForCompare(selectedShippingAddress.phone ?? "");
    if (!selectedPhone) return false;

    const verifiedInline = normalizePhoneForCompare(verifiedPhoneForCheckout ?? "");
    if (verifiedInline && verifiedInline === selectedPhone) return true;

    const verifiedProfilePhone = phoneOk ? normalizePhoneForCompare(profilePhone) : "";
    if (verifiedProfilePhone && verifiedProfilePhone === selectedPhone) return true;

    return false;
  }, [selectedShippingAddress, verifiedPhoneForCheckout, phoneOk, profilePhone]);

  const shippingQ = useQuery({
    queryKey: [
      "checkout",
      "shipping-quotes:v4",
      user?.id,
      selectedShippingId,
      JSON.stringify({
        ...selectedShippingQuoteAddress,
        lga: selectedShippingQuoteAddress.lga ?? selectedShippingQuoteAddress.town ?? "",
      }),
      cart.map((i) => `${lineKeyFor(i)}@${Math.max(1, asInt(i.qty, 1))}`).sort().join(","),
    ],
    enabled:
      shippingEnabled &&
      hydrated &&
      !!user?.id &&
      cart.length > 0 &&
      !loadingProfile &&
      !!selectedShippingAddress &&
      isSelectedShippingAddressValid,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
    retry: false,
    queryFn: async () =>
      fetchShippingQuotesForCart({
        cart,
        selectedUserShippingAddressId: selectedShippingAddress?.id ?? null,
        address: {
          ...selectedShippingQuoteAddress,
          lga: selectedShippingQuoteAddress.lga ?? selectedShippingQuoteAddress.town ?? "",
        },
      }),
  });

  const shippingFee = shippingEnabled ? round2(shippingQ.data?.totalFee ?? 0) : 0;
  const shippingQuoteIds = useMemo(
    () =>
      shippingEnabled
        ? (shippingQ.data?.quotes ?? [])
          .map((q) => q.shippingQuoteId)
          .filter((id) => !!String(id || "").trim())
        : [],
    [shippingEnabled, shippingQ.data]
  );

  const payableTotal = round2(itemsSubtotal + shippingFee);

  const supplierNameMap = useMemo(
    () =>
      buildSupplierNameMap(
        (pricingQ.data as QuotePayload | null) ?? null,
        (shippingQ.data as ShippingQuoteResponse | null) ?? null
      ),
    [pricingQ.data, shippingQ.data]
  );

  const shippingFormLgas = useMemo(() => lgasForState(shippingForm.state), [shippingForm.state]);

  const homeAddressCanPrefillShipping = useMemo(() => {
    return !validateAddress(homeAddr, false);
  }, [homeAddr]);

  const loadProfileState = useCallback(async () => {
    if (!hydrated || !user?.id) return;

    setCheckingVerification(true);
    setLoadingProfile(true);
    setProfileErr(null);

    try {
      const data = await fetchProfileMe();

      const flags = computeVerificationFlags(data);
      setEmailOk(flags.emailOk);
      setPhoneOk(flags.phoneOk);
      setShowNotVerified(!flags.emailOk);
      setProfilePhone(String(data?.phone ?? ""));

      const h = data?.address ?? null;
      if (h) {
        setHomeAddr({
          ...EMPTY_ADDR,
          houseNumber: h.houseNumber ?? "",
          streetName: h.streetName ?? "",
          postCode: h.postCode ?? "",
          town: h.town ?? "",
          city: h.city ?? "",
          state: h.state ?? "",
          country: countryNameFromCodeOrName(h.country) || NIGERIA_COUNTRY,
          lga: h.lga ?? "",
        });
      }

      setShowHomeForm(!h);

      const merged = mergeProfileShippingAddresses(data);
      setShippingAddresses(merged.addresses);
      setSelectedShippingId((prev) => prev ?? merged.defaultId ?? null);

      if (flags.phoneOk && data?.phone) {
        setVerifiedPhoneForCheckout((prev) => prev ?? String(data.phone));
      }
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 401) {
        nav("/login", { state: { from: { pathname: "/checkout" } }, replace: true });
        return;
      }

      setEmailOk(false);
      setPhoneOk(false);
      setShowNotVerified(true);
      setProfileErr("Failed to load your profile. Please refresh and try again.");
    } finally {
      setCheckingVerification(false);
      setLoadingProfile(false);
    }
  }, [hydrated, user?.id, nav]);

  useEffect(() => {
    void loadProfileState();
  }, [loadProfileState]);

  const isNigeriaShipping = useMemo(() => {
    const v = String(shippingForm.country || "").trim().toLowerCase();
    return v === "nigeria" || v === "ng";
  }, [shippingForm.country]);

  const isNigeriaHome = useMemo(() => {
    const v = String(homeAddr.country || "").trim().toLowerCase();
    return v === "nigeria" || v === "ng";
  }, [homeAddr.country]);

  const didHydrateCartRef = useRef(false);

  useEffect(() => {
    if (!didHydrateCartRef.current) {
      didHydrateCartRef.current = true;
      return;
    }
    writeCart(cart);
  }, [cart]);

  useEffect(() => {
    if (!showShippingEditor) return;

    const id = window.requestAnimationFrame(() => {
      shippingEditorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      window.setTimeout(() => {
        firstShippingFieldRef.current?.focus();
      }, 120);
    });

    return () => window.cancelAnimationFrame(id);
  }, [showShippingEditor, editingShippingId]);

  useEffect(() => {
    const syncFromCart = () => setCart(readCart());
    window.addEventListener("cart:updated", syncFromCart);
    return () => window.removeEventListener("cart:updated", syncFromCart);
  }, []);

  useEffect(() => {
    const selectedPhone = normalizePhoneForCompare(selectedShippingAddress?.phone ?? "");

    if (!selectedPhone) {
      setOtpCode("");
      setOtpSentToPhone(null);
      setOtpMessage(null);
      return;
    }

    const alreadyVerified =
      isSavedAddressPhoneVerified(selectedShippingAddress) ||
      (normalizePhoneForCompare(verifiedPhoneForCheckout ?? "") === selectedPhone) ||
      (phoneOk && normalizePhoneForCompare(profilePhone) === selectedPhone);

    if (alreadyVerified) {
      setOtpCode("");
      setOtpSentToPhone(null);
      setOtpMessage("This delivery phone is already verified.");
      return;
    }

    setOtpCode("");
    setOtpMessage(null);
  }, [selectedShippingAddress, verifiedPhoneForCheckout, phoneOk, profilePhone]);

  const applySameAsHomeToShippingFormOnce = () => {
    if (!sameAsHomeAvailable) return;

    if (!homeAddressCanPrefillShipping) {
      openModal({
        title: "Use home address",
        message: "Please save a valid home address first before using Same as home.",
      });
      return;
    }

    setShippingForm((prev) => ({
      ...prev,
      houseNumber: homeAddr.houseNumber || "",
      streetName: homeAddr.streetName || "",
      postCode: homeAddr.postCode || "",
      town: homeAddr.town || "",
      city: homeAddr.city || "",
      state: homeAddr.state || "",
      country: homeAddr.country || NIGERIA_COUNTRY,
      lga: homeAddr.lga || "",
    }));

    const next = { used: true };
    setSameAsHomeUsage(next);
    writeSameAsHomeUsage(next);
  };

  const onChangeHome =
    (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setHomeAddr((a) => ({ ...a, [k]: e.target.value }));

  const onChangeShippingForm =
    (k: keyof ShippingAddressForm) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setShippingForm((a) => ({ ...a, [k]: e.target.value }));

  function validateAddress(a: Address, isShipping = false): string | null {
    const label = isShipping ? "Shipping" : "Home";

    if (!a.houseNumber.trim()) return `Enter ${label} address: house/plot number`;
    if (!a.streetName.trim()) return `Enter ${label} address: street name`;
    if (!a.city.trim()) return `Enter ${label} address: city`;
    if (!a.state.trim()) return `Enter ${label} address: state`;
    if (!a.country.trim()) return `Enter ${label} address: country`;

    return null;
  }

  const safeServerMessage = (e: any, fallback: string) => {
    const status = e?.response?.status;
    const raw = String(e?.response?.data?.error || e?.message || "").trim();
    const lowered = raw.toLowerCase();

    if (lowered.includes("no active supplier offers")) {
      return "One of your items is no longer available at the selected price. Please refresh your cart or remove and re-add that item.";
    }

    if ((status === 400 || status === 422) && raw && !/internal server error/i.test(raw)) {
      return raw;
    }
    if (status >= 500 || /internal server error/i.test(raw)) return fallback;

    return raw || fallback;
  };

  const saveHome = async () => {
    const v = validateAddress(homeAddr, false);
    if (v) {
      openModal({ title: "Checkout", message: v });
      return;
    }
    try {
      setSavingHome(true);
      await api.post("/api/profile/address", homeAddr, AXIOS_COOKIE_CFG);
      setShowHomeForm(false);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 401) {
        nav("/login", { state: { from: { pathname: "/checkout" } }, replace: true });
        return;
      }
      openModal({
        title: "Checkout",
        message: safeServerMessage(
          e,
          "Could not save your home address. Please check the fields and try again."
        ),
      });
    } finally {
      setSavingHome(false);
    }
  };

  const startAddShipping = () => {
    const profileName = [meQ.data?.firstName, meQ.data?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    setEditingShippingId(null);
    setMakeDefaultShipping(shippingAddresses.length === 0);
    setSameAsHomeUsage(readSameAsHomeUsage());

    setShippingForm({
      ...makeEmptyShippingForm(homeAddr.country || NIGERIA_COUNTRY),
      recipientName: profileName || "",
      phone: profilePhone || "",
      whatsappPhone: profilePhone || "",
    });

    setShowShippingEditor(true);
  };

  const startEditShipping = (addr: SavedShippingAddress) => {
    setEditingShippingId(addr.id);
    setMakeDefaultShipping(!!addr.isDefault);
    setShippingForm({
      ...shippingFormFromSaved(addr),
      country: addr.country || NIGERIA_COUNTRY,
    });
    setShowShippingEditor(true);
  };

  const saveShippingEntry = async () => {
    const validation = validateShippingAddressForm(shippingForm);
    if (validation) {
      openModal({ title: "Delivery details", message: validation });
      return;
    }

    const isEditing = !!editingShippingId;
    const currentEditingId = editingShippingId;

    try {
      setSavingShippingEntry(true);

      const res = await saveShippingAddressEntry({
        form: shippingForm,
        id: currentEditingId,
        isDefault: makeDefaultShipping,
      });

      const normalizedFromServer = normalizeSavedShippingAddressLike(res);

      const saved: SavedShippingAddress = {
        ...(normalizedFromServer ??
          shippingFormToSaved(
            shippingForm,
            currentEditingId || `temp-${Date.now()}`,
            makeDefaultShipping
          )),
        id: currentEditingId || normalizedFromServer?.id || `temp-${Date.now()}`,
        isDefault: makeDefaultShipping,
        isActive: true,
        country: normalizedFromServer?.country || shippingForm.country || NIGERIA_COUNTRY,
      };

      let nextList: SavedShippingAddress[];

      if (isEditing && currentEditingId) {
        nextList = shippingAddresses.map((a) =>
          a.id === currentEditingId
            ? {
              ...a,
              ...saved,
              id: currentEditingId,
            }
            : a
        );
      } else {
        nextList = [saved, ...shippingAddresses.filter((a) => a.id !== saved.id)];
      }

      if (makeDefaultShipping) {
        nextList = nextList.map((a) => ({
          ...a,
          isDefault: a.id === saved.id,
        }));
      }

      setShippingAddresses(nextList);
      setSelectedShippingId(saved.id);
      setShowShippingEditor(false);
      setEditingShippingId(null);
      setOtpSentToPhone(null);
      setOtpCode("");
      setOtpMessage(null);

      try {
        await syncSelectedShippingAddressEntry(saved);
      } catch {
        //
      }

      await loadProfileState();
    } catch (e: any) {
      openModal({
        title: "Delivery details",
        message: safeServerMessage(
          e,
          "Could not save this delivery detail right now. Please try again."
        ),
      });
    } finally {
      setSavingShippingEntry(false);
    }
  };

  const handleDeleteShipping = async (id: string) => {
    const target = shippingAddresses.find((a) => a.id === id);
    if (!target) return;

    try {
      setDeletingShippingId(id);
      await deleteShippingAddressEntry(id);

      const next = shippingAddresses.filter((a) => a.id !== id);
      setShippingAddresses(next);

      if (selectedShippingId === id) {
        const replacement = next.find((a) => a.isDefault) ?? next[0] ?? null;
        setSelectedShippingId(replacement?.id ?? null);
      }

      await loadProfileState();
    } catch (e: any) {
      openModal({
        title: "Delete address",
        message: safeServerMessage(
          e,
          "Could not delete this delivery detail right now."
        ),
      });
    } finally {
      setDeletingShippingId(null);
    }
  };

  const handleSetDefaultShipping = async (id: string) => {
    try {
      setSettingDefaultId(id);
      await setDefaultShippingAddressEntry(id);
      setShippingAddresses((prev) => prev.map((a) => ({ ...a, isDefault: a.id === id })));
      setSelectedShippingId(id);
      await loadProfileState();
    } catch (e: any) {
      openModal({
        title: "Default delivery detail",
        message: safeServerMessage(
          e,
          "Could not make this your default delivery detail."
        ),
      });
    } finally {
      setSettingDefaultId(null);
    }
  };

  const handleSelectShipping = async (id: string) => {
    const chosen = shippingAddresses.find((a) => a.id === id);
    if (!chosen) return;

    setSelectedShippingId(id);
    setOtpMessage(null);

    try {
      setSyncingSelectedShippingId(id);
      await syncSelectedShippingAddressEntry(chosen);
    } catch {
      //
    } finally {
      setSyncingSelectedShippingId(null);
    }
  };

  const homeFormLgas = useMemo(() => lgasForState(homeAddr.state), [homeAddr.state]);

  const sendOtp = async () => {
    if (!selectedShippingAddress) {
      openModal({ title: "Phone verification", message: "Select a delivery detail first." });
      return;
    }

    const phone = selectedShippingAddress.phone?.trim() || "";

    if (!phone) {
      openModal({ title: "Phone verification", message: "Selected delivery detail has no phone number." });
      return;
    }

    try {
      setSendingOtp(true);
      setOtpMessage(null);
      await sendPhoneOtpForCheckout({
        shippingAddressId: selectedShippingAddress.id,
      });
      setOtpSentToPhone(phone);
      setOtpMessage("OTP sent. Enter the code below to confirm this delivery phone.");
    } catch (e: any) {
      openModal({
        title: "Send OTP",
        message: safeServerMessage(
          e,
          "We could not send an OTP right now. Please check the number and try again."
        ),
      });
    } finally {
      setSendingOtp(false);
    }
  };

  const verifyOtp = async () => {
    if (!selectedShippingAddress) {
      openModal({ title: "Verify phone", message: "Select a delivery detail first." });
      return;
    }

    const code = otpCode.trim();
    if (!code) {
      openModal({ title: "Verify phone", message: "Enter the OTP code." });
      return;
    }

    try {
      setVerifyingOtp(true);

      const res = await verifyPhoneOtpForCheckout({
        shippingAddressId: selectedShippingAddress.id,
        code,
      });

      const updated = normalizeSavedShippingAddressLike(res);
      if (updated) {
        setShippingAddresses((prev) =>
          prev.map((addr) => (addr.id === updated.id ? { ...addr, ...updated } : addr))
        );
      }

      setVerifiedPhoneForCheckout(selectedShippingAddress.phone);
      setOtpSentToPhone(null);
      setOtpCode("");
      setOtpMessage("Phone verified for this delivery detail.");

      await loadProfileState();
    } finally {
      setVerifyingOtp(false);
    }
  };

  const createOrder = useMutation({
    mutationFn: async () => {
      if (checkingVerification) throw new Error("Checking your account verification…");
      if (!emailOk) throw new Error("Your email is not verified.");
      if (cart.length === 0) throw new Error("Your cart is empty");

      if (pricingQ.isLoading) {
        throw new Error("Calculating best supplier prices… Please try again in a moment.");
      }
      if (pricingWarning) throw new Error(pricingWarning);

      if (!selectedShippingAddress) {
        throw new Error("Please select a delivery detail.");
      }

      const deliveryValidation = validateShippingAddressForm(
        shippingFormFromSaved(selectedShippingAddress)
      );
      if (deliveryValidation) throw new Error(deliveryValidation);

      if (!selectedPhoneVerified) {
        throw new Error("Please verify the selected delivery phone with OTP before placing your order.");
      }

      if (shippingEnabled) {
        if (shippingQ.isLoading) {
          throw new Error("Calculating shipping… Please try again in a moment.");
        }

        if (shippingQ.isError || !shippingQ.data) {
          throw new Error("Could not calculate shipping yet. Please check the selected delivery detail and try again.");
        }

        if (shippingQ.data.error) {
          throw new Error(shippingQ.data.error);
        }
      }

      const quote = pricingQ.data as QuotePayload | null;

      const invalidLine = cart.find((it) => {
        const key = lineKeyFor(it);
        const qLine = quote?.lines?.[key];
        const firstAlloc = qLine?.allocations?.[0];
        return !qLine || !firstAlloc || !firstAlloc.offerId;
      });

      if (invalidLine) {
        const invalidKey = lineKeyFor(invalidLine);
        const repaired = removeCartLineByKey(cart, invalidKey);
        setCart(repaired);
        writeCart(repaired);

        throw new Error(
          `"${invalidLine.title || "An item"}" is no longer available at checkout and has been removed from your cart. Please review your cart and try again.`
        );
      }

      const bad = cart.find((l) => {
        const key = lineKeyFor(l);
        const supplierLine = quote?.lines?.[key];
        const hasQuotedSupplierPrice = !!supplierLine && asMoney(supplierLine.lineTotal, 0) > 0;
        const cachedUnit = num(l.unitPrice, num(l.price, 0));
        const explicitTotal = asMoney(l.totalPrice, 0);
        return cachedUnit <= 0 && explicitTotal <= 0 && !hasQuotedSupplierPrice;
      });
      if (bad) {
        throw new Error("One or more items have no price. Please remove and re-add them to cart.");
      }

      const vaHome = validateAddress(homeAddr, false);
      if (vaHome) throw new Error(vaHome);

      const finalShip = savedShippingToQuoteAddress(selectedShippingAddress);

      const items = cart.map((it) => {
        const key = lineKeyFor(it);
        const qLine = quote?.lines?.[key];
        const firstAlloc = qLine?.allocations?.[0];

        const kind: "BASE" | "VARIANT" =
          qLine?.kind ||
          (it.kind === "BASE" || it.kind === "VARIANT"
            ? it.kind
            : it.variantId
              ? "VARIANT"
              : "BASE");

        const variantId =
          qLine?.variantId != null
            ? qLine.variantId
            : it.variantId != null
              ? it.variantId
              : undefined;

        const retailUnit = asMoney(
          it.unitPrice,
          asMoney(
            it.price,
            Math.max(0, asMoney(it.totalPrice, 0) / Math.max(1, num(it.qty, 1)))
          )
        );

        return {
          key,
          productId: it.productId,
          variantId: variantId || undefined,
          qty: Math.max(1, num(it.qty, 1)),
          kind,
          selectedOptions: Array.isArray(it.selectedOptions)
            ? normalizeSelectedOptions(it.selectedOptions)
            : undefined,
          supplierId: firstAlloc?.supplierId || it.supplierId || undefined,
          offerId: firstAlloc?.offerId || undefined,
          unitPrice: retailUnit,
          unitPriceCache: retailUnit,
        };
      });

      const at = getAttribution();
      const selectedUserShippingAddressId = selectedShippingAddress.id;

      const payload: any = {
        items,

        // Canonical selected saved address id for backend resolution
        selectedUserShippingAddressId,

        // Keep snapshot data too for order record / compatibility
        shippingAddress: {
          ...finalShip,
          recipientName: selectedShippingAddress.recipientName ?? "",
          phone: selectedShippingAddress.phone ?? "",
          whatsappPhone: selectedShippingAddress.whatsappPhone ?? "",
          landmark: selectedShippingAddress.landmark ?? "",
          directionsNote: selectedShippingAddress.directionsNote ?? "",
          label: selectedShippingAddress.label ?? "",
        },

        // Legacy compatibility only
        shippingAddressId: selectedShippingAddress.id,

        shippingContact: {
          recipientName: selectedShippingAddress.recipientName ?? "",
          phone: selectedShippingAddress.phone ?? "",
          whatsappPhone: selectedShippingAddress.whatsappPhone ?? "",
          otpVerified: true,
        },
        attribution: at,

        shippingQuoteIds: shippingEnabled ? shippingQuoteIds : [],
        shippingFee: shippingEnabled ? shippingFee : 0,
        shippingCurrency: shippingEnabled ? (shippingQ.data?.currency ?? "NGN") : "NGN",
        shippingRateSource:
          shippingEnabled
            ? shippingQuoteIds.length
              ? shippingQ.data?.quotes?.length === 1
                ? shippingQ.data?.quotes?.[0]?.rateSource ?? "FALLBACK_ZONE"
                : "MANUAL"
              : "FALLBACK_ZONE"
            : "DISABLED",
        shippingBreakdownJson:
          shippingEnabled && shippingQ.data
            ? {
              currency: shippingQ.data.currency,
              totalFee: shippingQ.data.totalFee,
              quoteIds: shippingQuoteIds,
              suppliers: shippingQ.data.quotes.map((q) => ({
                supplierId: q.supplierId,
                quoteId: q.shippingQuoteId || null,
                serviceLevel: q.serviceLevel,
                zoneCode: q.zoneCode ?? null,
                zoneName: q.zoneName ?? null,
                rateSource: q.rateSource ?? null,
                components: {
                  shippingFee: q.shippingFee,
                  remoteSurcharge: q.remoteSurcharge,
                  fuelSurcharge: q.fuelSurcharge,
                  handlingFee: q.handlingFee,
                  insuranceFee: q.insuranceFee,
                },
                totalFee: q.totalFee,
                etaMinDays: q.etaMinDays ?? null,
                etaMaxDays: q.etaMaxDays ?? null,
                error: q.error ?? null,
              })),
              partial: shippingQ.data.partial,
            }
            : null,
        shippingMode,

        itemsSubtotal,
        total: payableTotal,

        marginPercent: 0,
        quoteSubtotalSupplier: asMoney(quoteSubtotalSupplier, 0),
        quoteCurrency: (pricingQ.data as QuotePayload | null)?.currency ?? null,
      };

      console.log("[checkout/create-order payload]", {
        selectedUserShippingAddressId,
        shippingAddress: payload.shippingAddress,
      });

      try {
        const res = await api.post("/api/orders", payload, AXIOS_COOKIE_CFG);
        return res.data as { data: { id: string } };
      } catch (e: any) {
        const status = e?.response?.status;
        if (status === 401) {
          nav("/login", { state: { from: { pathname: "/checkout" } }, replace: true });
          throw new Error("Please login again.");
        }

        throw new Error(
          safeServerMessage(
            e,
            "We couldn’t place your order. Please review your delivery details and try again."
          )
        );
      }
    },
    onSuccess: async (resp) => {
      const orderId = (resp as any)?.data?.id;

      if (!orderId) {
        openModal({
          title: "Checkout",
          message: "Order was created, but we could not open payment. Please check your orders.",
        });
        nav("/orders", { replace: true });
        return;
      }

      setRedirectingOrderId(orderId);

      try {
        sessionStorage.setItem(
          "payment:init",
          JSON.stringify({
            orderId,
            total: payableTotal,
            homeAddress: homeAddr,
            shippingAddress: selectedShippingAddress,
            selectedUserShippingAddressId: selectedShippingAddress?.id ?? null,
            at: Date.now(),
          })
        );
      } catch {
        //
      }

      try {
        const initResp = await api.post(
          "/api/payments/init",
          {
            orderId,
            channel: "paystack",
            expectedTotal: payableTotal,
          },
          AXIOS_COOKIE_CFG
        );

        const initData = initResp?.data;

        if (
          initData?.mode === "paystack" &&
          initData?.authorization_url &&
          String(initData.authorization_url).trim()
        ) {
          try {
            sessionStorage.setItem(
              "payment:init",
              JSON.stringify({
                orderId,
                total: typeof initData.amount === "number" ? initData.amount : payableTotal,
                serviceFeeTotal: shippingEnabled ? shippingFee : 0,
                reference: initData.reference ?? null,
                homeAddress: homeAddr,
                shippingAddress: selectedShippingAddress,
                selectedUserShippingAddressId: selectedShippingAddress?.id ?? null,
                at: Date.now(),
              })
            );
          } catch {
            //
          }

          writeCart([]);
          markPaystackExit();
          window.location.assign(initData.authorization_url);
          return;
        }

        // non-hosted fallback
        writeCart([]);
        window.location.assign(`/payment?orderId=${encodeURIComponent(orderId)}`);
      } catch {
        // payment init fallback page
        writeCart([]);
        window.location.assign(`/payment?orderId=${encodeURIComponent(orderId)}`);
      }
    },
  });

  if (redirectingOrderId) {
    return (
      <SiteLayout>
        <div className="min-h-[70vh] grid place-items-center bg-bg-soft px-4">
          <div className="text-center space-y-3">
            <h1 className="text-xl md:text-2xl font-semibold text-ink">Redirecting to payment…</h1>
            <p className="text-sm text-ink-soft">Please wait while we open your payment page.</p>
          </div>
        </div>
      </SiteLayout>
    );
  }

  if (meQ.isLoading) {
    return (
      <SiteLayout>
        <div className="min-h-[70vh] grid place-items-center bg-bg-soft px-4">
          <div className="text-sm text-ink-soft">Checking session…</div>
        </div>
      </SiteLayout>
    );
  }

  if (hydrated && !user?.id) {
    return <Navigate to="/login" replace state={{ from: { pathname: "/checkout" } }} />;
  }

  if (cart.length === 0) {
    return <Navigate to="/cart" replace state={{ from: "/checkout" }} />;
  }

  const NotVerifiedModal = () => {
    const title =
      !emailOk && !phoneOk
        ? "Email and phone not verified"
        : !emailOk
          ? "Email not verified"
          : "Phone is not verified";

    const lines: string[] = [];
    if (!emailOk) lines.push("• Your email is not verified.");
    if ((import.meta as any)?.env?.PHONE_VERIFY === "set" && !phoneOk) {
      lines.push("• Your profile phone number is not verified.");
    }
    lines.push("Please fix this, then return to your cart/checkout.");

    const next = encodeURIComponent("/checkout");
    const verifyHref = `${VERIFY_PATH}?next=${next}`;

    return (
      <div
        role="dialog"
        aria-modal="true"
        onClick={() => {
          setShowNotVerified(false);
          nav("/cart");
        }}
        className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4"
      >
        <div
          className="w-full max-w-md rounded-2xl bg-white shadow-2xl border"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-3 md:px-5 md:py-4 border-b">
            <h2 className="text-base md:text-lg font-semibold">{title}</h2>
          </div>

          <div className="p-4 md:p-5 space-y-2 text-xs md:text-sm">
            {lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}

            <div className="mt-2 space-y-2">
              {(!emailOk || !phoneOk) && (
                <button
                  className="w-full inline-flex items-center justify-center rounded-lg bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200"
                  onClick={() => nav(verifyHref)}
                  type="button"
                >
                  Verify now
                </button>
              )}
            </div>
          </div>

          <div className="px-4 py-3 md:px-5 md:py-4 border-t flex items-center justify-between gap-2">
            <button
              onClick={() => {
                const latest = readCart();
                setCart(latest);
                window.dispatchEvent(new Event("cart:updated"));
                nav("/cart");
              }}
              className="mt-3 w-full inline-flex items-center justify-center rounded-lg border border-border bg-surface px-4 py-2.5 text-ink hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-50 transition text-sm"
              type="button"
            >
              Back to cart
            </button>
          </div>
        </div>
      </div>
    );
  };

  const showShippingIncludedRibbon = !publicSettingsQ.isLoading && !shippingEnabled;

  const placeOrderDisabled =
    createOrder.isPending ||
    pricingQ.isLoading ||
    !!pricingWarning ||
    !selectedShippingAddress ||
    !selectedPhoneVerified ||
    (shippingEnabled && (shippingQ.isLoading || shippingQ.isError || !shippingQ.data));

  return (
    <SiteLayout>
      <div className="bg-bg-soft bg-hero-radial">
        {!checkingVerification && showNotVerified && <NotVerifiedModal />}

        <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-5 sm:py-6 md:py-8">
          <div className="mb-4 md:mb-6">
            <nav className="flex items-center gap-2 text-xs sm:text-sm">
              <span className="text-ink font-medium">Items</span>
              <span className="opacity-40">›</span>
              <span className="text-ink-soft">Delivery</span>
              <span className="opacity-40">›</span>
              <span className="text-ink-soft">Payment</span>
            </nav>

            <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="text-xl sm:text-2xl font-semibold text-ink leading-tight">
                  Checkout
                </h1>
                <p className="mt-1 text-sm text-ink-soft">
                  Choose a delivery detail, verify the phone with OTP, then place your order.
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs sm:text-sm text-emerald-800">
                {selectedPhoneVerified
                  ? "Delivery phone verified"
                  : "Phone verification required before payment"}
              </div>
            </div>

            {profileErr && (
              <p className="mt-3 text-xs sm:text-sm text-danger border border-danger/20 bg-red-50 px-3 py-2 rounded">
                {profileErr}
              </p>
            )}

            {(pricingQ.isLoading || pricingWarning) && (
              <div className="mt-3 text-xs sm:text-sm rounded-xl border bg-white/80 p-3 text-ink">
                {pricingQ.isLoading ? "Calculating best supplier prices…" : pricingWarning}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr,380px] gap-4 sm:gap-5 md:gap-6">
            <section className="space-y-4 sm:space-y-5 md:space-y-6">
              <Card tone="emerald" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <CardHeader
                  tone="emerald"
                  title="Home address"
                  subtitle="Saved to your profile."
                  icon={<IconHome />}
                  action={
                    !showHomeForm && (
                      <button
                        className="text-[11px] sm:text-sm text-emerald-700 hover:underline"
                        onClick={() => setShowHomeForm(true)}
                        type="button"
                      >
                        Change
                      </button>
                    )
                  }
                />
                {loadingProfile ? (
                  <div className="px-4 py-3 md:p-4 text-xs sm:text-sm text-ink-soft">
                    Loading…
                  </div>
                ) : showHomeForm ? (
                  <div className="p-4 grid grid-cols-1 gap-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input value={homeAddr.houseNumber} onChange={onChangeHome("houseNumber")} placeholder="House No. *" />
                    </div>

                    <Input value={homeAddr.streetName} onChange={onChangeHome("streetName")} placeholder="Street name *" />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        value={homeAddr.town}
                        onChange={onChangeHome("town")}
                        placeholder="Town (optional)"
                      />

                      <SelectBox
                        value={countryNameFromCodeOrName(homeAddr.country) || NIGERIA_COUNTRY}
                        onChange={(e) =>
                          setHomeAddr((prev) => ({
                            ...prev,
                            country: e.target.value,
                            state: "",
                            lga: "",
                          }))
                        }
                      >
                        {COUNTRIES.map((c) => (
                          <option key={c.code} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </SelectBox>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        value={homeAddr.city}
                        onChange={onChangeHome("city")}
                        placeholder="City *"
                      />

                      {isNigeriaHome ? (
                        <SelectBox
                          value={homeAddr.state}
                          onChange={(e) =>
                            setHomeAddr((prev) => ({
                              ...prev,
                              state: e.target.value,
                              lga: "",
                            }))
                          }
                        >
                          <option value="">Select state *</option>
                          {NIGERIAN_STATES.map((s) => (
                            <option value={s} key={s}>
                              {s}
                            </option>
                          ))}
                        </SelectBox>
                      ) : (
                        <Input
                          value={homeAddr.state}
                          onChange={onChangeHome("state")}
                          placeholder="State / Region / Province *"
                        />
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {isNigeriaHome ? (
                        <SelectBox
                          value={homeAddr.lga || ""}
                          onChange={onChangeHome("lga")}
                          disabled={!homeAddr.state}
                        >
                          <option value="">
                            {homeAddr.state ? "Select LGA (optional)" : "Select state first"}
                          </option>
                          {homeFormLgas.map((lga) => (
                            <option value={lga} key={lga}>
                              {lga}
                            </option>
                          ))}
                        </SelectBox>
                      ) : (
                        <Input
                          value={homeAddr.lga || ""}
                          onChange={onChangeHome("lga")}
                          placeholder="District / County / LGA"
                        />
                      )}

                      <Input
                        value={homeAddr.postCode}
                        onChange={onChangeHome("postCode")}
                        placeholder="Post code (optional)"
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pt-1">
                      <button
                        type="button"
                        className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-white font-medium hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-200 transition disabled:opacity-50 text-sm"
                        onClick={saveHome}
                        disabled={savingHome}
                      >
                        {savingHome ? "Saving…" : "Save home address"}
                      </button>

                      <button
                        type="button"
                        className="w-full sm:w-auto text-sm text-ink-soft hover:underline"
                        onClick={() => setHomeAddr(EMPTY_ADDR)}
                        disabled={savingHome}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                ) : (
                  <AddressPreview a={homeAddr} />
                )}
              </Card>

              <Card tone="amber" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <CardHeader
                  tone="amber"
                  title="Delivery details"
                  subtitle="Save multiple delivery addresses, choose one for this checkout, and verify its phone with OTP."
                  icon={<IconTruck />}
                  action={
                    <button
                      className="inline-flex items-center justify-center rounded-xl bg-amber-600 px-3 py-2 text-white text-xs sm:text-sm font-medium hover:bg-amber-700 focus:outline-none focus:ring-4 focus:ring-amber-200"
                      onClick={startAddShipping}
                      type="button"
                    >
                      Add new
                    </button>
                  }
                />

                <div className="p-4 space-y-4">
                  {loadingProfile ? (
                    <div className="text-sm text-ink-soft">Loading delivery details…</div>
                  ) : shippingAddresses.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-5 text-center">
                      <div className="text-sm font-medium text-ink">No delivery details saved yet</div>
                      <p className="mt-1 text-xs text-ink-soft">
                        Add at least one delivery detail to continue checkout.
                      </p>
                      <button
                        type="button"
                        className="mt-4 inline-flex items-center justify-center rounded-xl bg-amber-600 px-4 py-2.5 text-white text-sm font-medium hover:bg-amber-700 focus:outline-none focus:ring-4 focus:ring-amber-200"
                        onClick={startAddShipping}
                      >
                        Add delivery detail
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      {shippingAddresses.map((addr) => {
                        const isSelected = selectedShippingId === addr.id;
                        const isDefault = !!addr.isDefault;
                        const isVerifiedNow =
                          isSavedAddressPhoneVerified(addr) ||
                          normalizePhoneForCompare(addr.phone) === normalizePhoneForCompare(verifiedPhoneForCheckout ?? "") ||
                          (phoneOk && normalizePhoneForCompare(addr.phone) === normalizePhoneForCompare(profilePhone));
                        return (
                          <div
                            key={addr.id}
                            className={`rounded-2xl border p-4 transition ${isSelected
                                ? "border-amber-400 bg-amber-50/60 shadow-sm"
                                : "border-border bg-white"
                              }`}
                          >
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="font-semibold text-ink">
                                    {addr.label || "Delivery detail"}
                                  </div>
                                  {isDefault && (
                                    <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-medium text-primary-700">
                                      Default
                                    </span>
                                  )}
                                  {isSelected && (
                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                      Selected
                                    </span>
                                  )}
                                  {isVerifiedNow && (
                                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                      Phone verified
                                    </span>
                                  )}
                                </div>

                                <div className="mt-2 text-sm font-medium text-ink">
                                  {addr.recipientName || "Recipient"}
                                </div>

                                <div className="mt-1 text-xs sm:text-sm text-ink-soft leading-6">
                                  <div>Phone: {addr.phone}</div>
                                  <div>WhatsApp: {addr.whatsappPhone || "—"}</div>
                                  <div className="mt-1">{formatDeliveryAddressLine(addr)}</div>
                                  {addr.landmark ? <div>Landmark: {addr.landmark}</div> : null}
                                  {addr.directionsNote ? <div>Note: {addr.directionsNote}</div> : null}
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-2 md:justify-end">
                                <button
                                  type="button"
                                  className={`rounded-xl px-3 py-2 text-xs sm:text-sm font-medium border transition ${isSelected
                                      ? "border-amber-300 bg-amber-100 text-amber-800"
                                      : "border-border bg-surface text-ink hover:bg-black/5"
                                    }`}
                                  onClick={() => handleSelectShipping(addr.id)}
                                  disabled={syncingSelectedShippingId === addr.id}
                                >
                                  {syncingSelectedShippingId === addr.id
                                    ? "Selecting…"
                                    : isSelected
                                      ? "Selected"
                                      : "Use this"}
                                </button>

                                {!isDefault && (
                                  <button
                                    type="button"
                                    className="rounded-xl px-3 py-2 text-xs sm:text-sm font-medium border border-border bg-surface text-ink hover:bg-black/5"
                                    onClick={() => handleSetDefaultShipping(addr.id)}
                                    disabled={settingDefaultId === addr.id}
                                  >
                                    {settingDefaultId === addr.id ? "Saving…" : "Make default"}
                                  </button>
                                )}

                                <button
                                  type="button"
                                  className="rounded-xl px-3 py-2 text-xs sm:text-sm font-medium border border-border bg-surface text-ink hover:bg-black/5"
                                  onClick={() => startEditShipping(addr)}
                                >
                                  Edit
                                </button>

                                {shippingAddresses.length > 1 && (
                                  <button
                                    type="button"
                                    className="rounded-xl px-3 py-2 text-xs sm:text-sm font-medium border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                                    onClick={() => handleDeleteShipping(addr.id)}
                                    disabled={deletingShippingId === addr.id}
                                  >
                                    {deletingShippingId === addr.id ? "Deleting…" : "Delete"}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {showShippingEditor && (
                    <div
                      ref={shippingEditorRef}
                      className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 sm:p-5"
                      tabIndex={-1}
                    >
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h4 className="font-semibold text-ink">
                            {editingShippingId ? "Edit delivery detail" : "Add delivery detail"}
                          </h4>
                          {sameAsHomeAvailable && (
                            <label className="mb-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                              <input
                                type="checkbox"
                                className="mt-1"
                                onChange={(e) => {
                                  if (e.target.checked) applySameAsHomeToShippingFormOnce();
                                }}
                              />
                              <span>
                                <span className="block font-medium">Same as home</span>
                                <span className="block text-xs text-emerald-800">
                                  This can be used once for a new delivery entry. It copies your saved home address into this form.
                                </span>
                              </span>
                            </label>
                          )}
                          <p className="text-xs text-ink-soft">
                            This includes recipient details, delivery phone, WhatsApp contact, and address.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="text-xs sm:text-sm text-ink-soft hover:underline"
                          onClick={() => {
                            setShowShippingEditor(false);
                            setEditingShippingId(null);
                          }}
                        >
                          Close
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            ref={firstShippingFieldRef}
                            value={shippingForm.label}
                            onChange={onChangeShippingForm("label")}
                            placeholder="Address label * e.g. Home, Office"
                          />
                          <Input value={shippingForm.recipientName} onChange={onChangeShippingForm("recipientName")} placeholder="Recipient full name *" />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input value={shippingForm.phone} onChange={onChangeShippingForm("phone")} placeholder="Phone number *" />
                          <Input value={shippingForm.whatsappPhone} onChange={onChangeShippingForm("whatsappPhone")} placeholder="WhatsApp phone *" />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input value={shippingForm.houseNumber} onChange={onChangeShippingForm("houseNumber")} placeholder="House / Plot No. *" />
                          <Input
                            value={shippingForm.postCode}
                            onChange={onChangeShippingForm("postCode")}
                            placeholder="Post code (optional)"
                          />
                        </div>

                        <Input value={shippingForm.streetName} onChange={onChangeShippingForm("streetName")} placeholder="Street name *" />

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            value={shippingForm.town}
                            onChange={onChangeShippingForm("town")}
                            placeholder="Town (optional)"
                          />

                          {isNigeriaShipping ? (
                            <SelectBox
                              value={shippingForm.state}
                              onChange={(e) => {
                                const nextState = e.target.value;
                                setShippingForm((prev) => ({
                                  ...prev,
                                  state: nextState,
                                  lga: "",
                                }));
                              }}
                            >
                              <option value="">Select state *</option>
                              {NIGERIAN_STATES.map((s) => (
                                <option value={s} key={s}>
                                  {s}
                                </option>
                              ))}
                            </SelectBox>
                          ) : (
                            <Input
                              value={shippingForm.state}
                              onChange={onChangeShippingForm("state")}
                              placeholder="State / Region / Province *"
                            />
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            value={shippingForm.city}
                            onChange={onChangeShippingForm("city")}
                            placeholder="City *"
                          />

                          {isNigeriaShipping ? (
                            <SelectBox
                              value={shippingForm.lga}
                              onChange={onChangeShippingForm("lga")}
                              disabled={!shippingForm.state}
                            >
                              <option value="">
                                {shippingForm.state ? "Select LGA *" : "Select state first"}
                              </option>
                              {shippingFormLgas.map((lga) => (
                                <option key={lga} value={lga}>
                                  {lga}
                                </option>
                              ))}
                            </SelectBox>
                          ) : (
                            <Input
                              value={shippingForm.lga}
                              onChange={onChangeShippingForm("lga")}
                              placeholder="District / County / LGA"
                            />
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <SelectBox
                            value={countryNameFromCodeOrName(shippingForm.country) || NIGERIA_COUNTRY}
                            onChange={(e) =>
                              setShippingForm((prev) => ({
                                ...prev,
                                country: e.target.value,
                                state: "",
                                lga: "",
                              }))
                            }
                          >
                            {COUNTRIES.map((c) => (
                              <option key={c.code} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </SelectBox>
                          <Input
                            value={shippingForm.landmark}
                            onChange={onChangeShippingForm("landmark")}
                            placeholder="Landmark (optional)"
                          />
                        </div>

                        {isNigeriaShipping && (
                          <div className="grid grid-cols-1 gap-3">
                            <Input
                              value={shippingForm.lga}
                              onChange={onChangeShippingForm("lga")}
                              placeholder="LGA not listed? Type it here"
                            />
                            <p className="text-[11px] text-ink-soft">
                              Choose from the official state list where available. If a government update is newer than our data,
                              you can type the LGA manually for now.
                            </p>
                          </div>
                        )}

                        <TextArea
                          rows={3}
                          value={shippingForm.directionsNote}
                          onChange={onChangeShippingForm("directionsNote")}
                          placeholder="Extra delivery note (gate code, closest landmark, instructions, etc.)"
                        />

                        <label className="inline-flex items-center gap-2 text-sm text-ink">
                          <input
                            type="checkbox"
                            checked={makeDefaultShipping}
                            onChange={(e) => setMakeDefaultShipping(e.target.checked)}
                          />
                          <span>Make this my default delivery detail</span>
                        </label>

                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                          <button
                            type="button"
                            className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-amber-600 px-4 py-2.5 text-white font-medium hover:bg-amber-700 focus:outline-none focus:ring-4 focus:ring-amber-200 transition disabled:opacity-50 text-sm"
                            onClick={saveShippingEntry}
                            disabled={savingShippingEntry}
                          >
                            {savingShippingEntry ? "Saving…" : editingShippingId ? "Update delivery detail" : "Save delivery detail"}
                          </button>

                          <button
                            type="button"
                            className="w-full sm:w-auto text-sm text-ink-soft hover:underline"
                            onClick={() => {
                              setShippingForm(makeEmptyShippingForm(homeAddr.country || NIGERIA_COUNTRY));
                              setMakeDefaultShipping(false);
                            }}
                            disabled={savingShippingEntry}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-primary-200 bg-primary-50/60 p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 text-primary-700">
                        <IconShield />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-ink">Delivery phone verification</div>

                        {!selectedShippingAddress ? (
                          <p className="mt-1 text-xs sm:text-sm text-ink-soft">
                            Select a delivery detail before sending an OTP.
                          </p>
                        ) : selectedPhoneVerified ? (
                          <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs sm:text-sm text-emerald-800">
                            {isSavedAddressPhoneVerified(selectedShippingAddress)
                              ? "This delivery phone was already verified for this saved delivery detail."
                              : normalizePhoneForCompare(selectedShippingAddress.phone) === normalizePhoneForCompare(profilePhone) && phoneOk
                                ? "This delivery phone matches your verified profile phone."
                                : "This delivery phone has been verified for the current checkout."}
                          </div>
                        ) : (
                          <>
                            <p className="mt-1 text-xs sm:text-sm text-ink-soft">
                              Send an OTP to whatsapp number: <span className="font-medium text-ink">{selectedShippingAddress.whatsappPhone}</span> and verify it here.
                            </p>

                            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                              <button
                                type="button"
                                className="inline-flex items-center justify-center rounded-xl bg-primary-600 px-4 py-2.5 text-white font-medium hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary-200 transition disabled:opacity-50 text-sm"
                                onClick={sendOtp}
                                disabled={sendingOtp}
                              >
                                {sendingOtp ? "Sending OTP…" : otpSentToPhone ? "Resend OTP" : "Send OTP"}
                              </button>

                              <Input
                                value={otpCode}
                                onChange={(e) => setOtpCode(e.target.value)}
                                placeholder="Enter OTP"
                                className="sm:max-w-[180px]"
                              />

                              <button
                                type="button"
                                className="inline-flex items-center justify-center rounded-xl border border-border bg-white px-4 py-2.5 text-ink font-medium hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-100 transition disabled:opacity-50 text-sm"
                                onClick={verifyOtp}
                                disabled={verifyingOtp || !otpCode.trim()}
                              >
                                {verifyingOtp ? "Verifying…" : "Verify OTP"}
                              </button>
                            </div>

                            {otpMessage && (
                              <p className="mt-2 text-xs sm:text-sm text-primary-700">{otpMessage}</p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </section>

            <aside className="lg:sticky lg:top-6 h-max">
              <Card className="p-4 sm:p-5">
                <h2 className="text-base sm:text-lg font-semibold text-ink">Order Summary</h2>

                <div className="mt-4 rounded-2xl border border-border bg-surface px-3 py-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-ink-soft">Selected delivery detail</div>
                  {selectedShippingAddress ? (
                    <div className="mt-2 space-y-1 text-xs sm:text-sm text-ink">
                      <div className="font-medium">{selectedShippingAddress.label || "Delivery detail"}</div>
                      <div>{selectedShippingAddress.recipientName || "Recipient not set"}</div>
                      <div>{selectedShippingAddress.phone}</div>
                      <div>{selectedShippingAddress.whatsappPhone || "No WhatsApp phone"}</div>
                      <div className="text-ink-soft">{formatDeliveryAddressLine(selectedShippingAddress)}</div>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs sm:text-sm text-danger">
                      Select a delivery detail to continue.
                    </div>
                  )}
                </div>

                <div className="mt-4 space-y-2 text-xs sm:text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-soft">Items Subtotal</span>
                    <span className="font-medium">{ngn.format(itemsSubtotal)}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-ink-soft">Shipping</span>
                    <span className="font-medium">
                      {!shippingEnabled
                        ? "Included in price"
                        : shippingQ.isLoading
                          ? "Calculating…"
                          : shippingFee > 0
                            ? ngn.format(shippingFee)
                            : ngn.format(0)}
                    </span>
                  </div>

                  {showShippingIncludedRibbon && (
                    <div className="mt-1 text-[11px] sm:text-xs rounded-lg border border-dashed border-zinc-200 bg-zinc-50/90 px-3 py-2 text-ink-soft">
                      No extra shipping fee: delivery cost is already included in item prices.
                    </div>
                  )}

                  {shippingEnabled && shippingQ.isError && (
                    <div className="mt-1 text-[11px] sm:text-xs text-danger">
                      Could not compute shipping yet
                    </div>
                  )}

                  {shippingEnabled && shippingQ.data?.quotes?.length ? (
                    <div className="mt-2 space-y-2">
                      {shippingQ.data.quotes.map((q) => (
                        <div
                          key={`${q.supplierId}:${q.shippingQuoteId || "legacy"}`}
                          className="rounded-lg border border-border bg-surface px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[11px] sm:text-xs font-medium text-ink">
                                {displaySupplierName(q.supplierId, supplierNameMap, q.supplierName)}
                              </div>

                              <div className="text-[10px] sm:text-[11px] text-ink-soft">
                                {q.zoneName || q.zoneCode || "Zone pending"}
                                {q.serviceLevel ? ` • ${q.serviceLevel}` : ""}
                                {q.shippingQuoteId ? " • quote saved" : " • fallback"}
                              </div>

                              {(q.etaMinDays != null || q.etaMaxDays != null) && (
                                <div className="text-[10px] sm:text-[11px] text-ink-soft">
                                  ETA: {q.etaMinDays ?? "?"}–{q.etaMaxDays ?? "?"} days
                                </div>
                              )}

                              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] sm:text-[11px] text-ink-soft">
                                <div>Base: {ngn.format(q.shippingFee)}</div>
                                <div>Remote: {ngn.format(q.remoteSurcharge)}</div>
                                <div>Fuel: {ngn.format(q.fuelSurcharge)}</div>
                                <div>Handling: {ngn.format(q.handlingFee)}</div>
                                <div>Insurance: {ngn.format(q.insuranceFee)}</div>
                              </div>

                              {q.error && (
                                <div className="text-[10px] sm:text-[11px] text-danger mt-1">{q.error}</div>
                              )}
                            </div>

                            <div className="shrink-0 text-[11px] sm:text-xs font-medium text-ink">
                              {ngn.format(q.totalFee)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {shippingEnabled && shippingQ.data?.partial && (
                    <div className="mt-2 text-[11px] sm:text-xs text-amber-700 border border-amber-200 bg-amber-50 px-2 py-1 rounded">
                      Shipping was quoted for some suppliers only. Total may change after remaining supplier zones/rates are configured.
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-baseline justify-between text-ink">
                  <span className="font-semibold text-sm sm:text-base">Total</span>
                  <span className="text-lg sm:text-xl font-semibold">
                    {ngn.format(payableTotal)}
                  </span>
                </div>

                {!selectedPhoneVerified && (
                  <p className="mt-3 text-xs sm:text-sm text-amber-800 border border-amber-200 bg-amber-50 px-3 py-2 rounded">
                    Verify the selected delivery phone with OTP to enable Place order.
                  </p>
                )}

                {pricingWarning && (
                  <p className="mt-3 text-xs sm:text-sm text-danger border border-danger/20 bg-red-50 px-3 py-2 rounded">
                    {pricingWarning}
                  </p>
                )}

                <button
                  disabled={placeOrderDisabled}
                  onClick={() => createOrder.mutate()}
                  className="mt-4 sm:mt-5 w-full inline-flex items-center justify-center rounded-xl bg-accent-500 text-white px-4 py-3 font-medium hover:bg-accent-600 active:bg-accent-700 focus:outline-none focus:ring-4 focus:ring-accent-200 transition disabled:opacity-50 text-sm"
                  type="button"
                >
                  {createOrder.isPending
                    ? "Processing…"
                    : pricingQ.isLoading
                      ? "Calculating prices…"
                      : !selectedShippingAddress
                        ? "Select delivery detail"
                        : !selectedPhoneVerified
                          ? "Verify delivery phone"
                          : "Place order & Pay"}
                </button>

                {createOrder.isError && (
                  <p className="mt-3 text-xs sm:text-sm text-danger border border-danger/20 bg-red-50 px-3 py-2 rounded">
                    {(createOrder.error as Error)?.message || "Failed to create order"}
                  </p>
                )}

                <button
                  onClick={() => {
                    const latest = readCart();
                    setCart(latest);
                    window.dispatchEvent(new Event("cart:updated"));
                    nav("/cart");
                  }}
                  className="mt-3 w-full inline-flex items-center justify-center rounded-xl border border-border bg-surface px-4 py-2.5 text-ink hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-50 transition text-sm"
                  type="button"
                >
                  Back to cart
                </button>

                <p className="mt-3 text-[10px] sm:text-[11px] text-ink-soft text-center leading-4">
                  Totals use live supplier offers and supplier shipping quotes. If an offer or quote expires, your pricing may update.
                </p>
              </Card>
            </aside>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}