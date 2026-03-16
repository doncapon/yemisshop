// src/pages/Checkout.tsx

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router-dom";
import api from "../api/client.js";
import { useAuthStore } from "../store/auth";
import { useModal } from "../components/ModalProvider";
import SiteLayout from "../layouts/SiteLayout.js";
import { getAttribution } from "../utils/attribution.js";
import { readCartLines, writeCartLines, toCartPageItems } from "../utils/cartModel";

/* ----------------------------- Config ----------------------------- */
const VERIFY_PATH = "/verify";
const AXIOS_COOKIE_CFG = { withCredentials: true as const };

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

  // legacy mirror
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

type ProfileMe = {
  emailVerifiedAt?: unknown;
  phoneVerifiedAt?: unknown;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  address?: Partial<Address> | null;
  shippingAddress?: Partial<Address> | null;
  shipping_address?: Partial<Address> | null;
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

/**
 * ✅ Stable cart line key
 * - base product: productId::base
 * - variant by id: productId::v:<variantId>
 * - options-only fallback: productId::o:<optionsKey>
 */
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
      const inferredKind: "BASE" | "VARIANT" =
        rawKind ?? (l.variantId ? "VARIANT" : "BASE");

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
    root.quotes ??
    root.shippingQuotes ??
    root.data?.quotes ??
    root.data?.shippingQuotes
  );

  if (quotesRaw.length) {
    const quotes = quotesRaw
      .map((q) => {
        const shippingQuoteId = String(
          q.shippingQuoteId ?? q.id ?? q.quoteId ?? ""
        ).trim();
        const supplierId = String(
          q.supplierId ?? q.supplier?.id ?? q.vendorId ?? ""
        ).trim();

        if (!supplierId) return null;

        const breakdown = q.breakdown ?? {};
        const components =
          q.components ??
          breakdown.components ??
          {};

        const shippingFee = pickMoney(
          q.shippingFee,
          breakdown.shippingFee,
          components.shippingFee
        );

        const remoteSurcharge = pickMoney(
          q.remoteSurcharge,
          breakdown.remoteSurcharge,
          components.remoteSurcharge
        );

        const fuelSurcharge = pickMoney(
          q.fuelSurcharge,
          breakdown.fuelSurcharge,
          components.fuelSurcharge
        );

        const handlingFee = pickMoney(
          q.handlingFee,
          breakdown.handlingFee,
          components.handlingFee
        );

        const insuranceFee = pickMoney(
          q.insuranceFee,
          breakdown.insuranceFee,
          components.insuranceFee
        );

        const totalFee = pickMoney(
          q.totalFee,
          breakdown.totalFee,
          q.amount,
          shippingFee + remoteSurcharge + fuelSurcharge + handlingFee + insuranceFee
        );

        return {
          shippingQuoteId,
          supplierId,
          supplierName:
            q.supplierName ??
            q.supplier?.name ??
            q.vendorName ??
            breakdown.supplierName ??
            null,
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

    const totalFee = round2(
      quotes.reduce((s, q) => s + asMoney(q.totalFee, 0), 0)
    );

    return {
      currency: String(root.currency ?? quotes[0]?.currency ?? "NGN"),
      totalFee,
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

      const shippingFee = pickMoney(
        s?.shippingFee,
        totals.shippingFee,
        breakdown.shippingFee,
        components.shippingFee
      );

      const remoteSurcharge = pickMoney(
        s?.remoteSurcharge,
        totals.remoteSurcharge,
        breakdown.remoteSurcharge,
        components.remoteSurcharge
      );

      const fuelSurcharge = pickMoney(
        s?.fuelSurcharge,
        totals.fuelSurcharge,
        breakdown.fuelSurcharge,
        components.fuelSurcharge
      );

      const handlingFee = pickMoney(
        s?.handlingFee,
        totals.handlingFee,
        breakdown.handlingFee,
        components.handlingFee
      );

      const insuranceFee = pickMoney(
        s?.insuranceFee,
        totals.insuranceFee,
        breakdown.insuranceFee,
        components.insuranceFee
      );

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

async function fetchShippingQuotesForCart(args: {
  cart: CartLine[];
  address: Address;
}): Promise<ShippingQuoteResponse | null> {
  const { cart, address } = args;
  if (!cart.length) return null;

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

  const attempts: Array<{ url: string; body: any }> = [
    {
      url: "/api/checkout/shipping-quotes",
      body: { items, shippingAddress, serviceLevel: "STANDARD" },
    },
    {
      url: "/api/shipping/quotes/cart",
      body: { items, shippingAddress, serviceLevel: "STANDARD" },
    },
    {
      url: "/api/shipping/quote-cart",
      body: { items, shippingAddress, serviceLevel: "STANDARD" },
    },
    // legacy fallback
    {
      url: "/api/checkout/shipping-fee-local",
      body: { items, shippingAddress, serviceLevel: "STANDARD" },
    },
  ];

  for (const attempt of attempts) {
    try {
      const res = await api.post(attempt.url, attempt.body, AXIOS_COOKIE_CFG);
      const normalized = normalizeShippingQuoteResponse(res);
      if (normalized) return normalized;
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

  if (typeof v === "number") {
    return v !== 0;
  }

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
    <div
      className={`flex items-center justify-between px-4 py-3 md:p-4 border-b border-border bg-gradient-to-b ${toneBg}`}
    >
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

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`border border-border rounded-md px-3 py-2 bg-white text-ink placeholder:text-ink-soft focus:outline-none focus:ring-4 focus:ring-primary-100 text-sm md:text-base ${props.className || ""}`}
    />
  );
}

function AddressPreview({ a }: { a: Address }) {
  return (
    <div className="px-4 py-3 md:p-4 text-xs md:text-sm leading-5 md:leading-6 text-ink">
      <div>
        {a.houseNumber} {a.streetName}
      </div>
      <div>
        {a.town || ""} {a.city || ""} {a.postCode || ""}
      </div>
      {!!a.lga && <div>LGA: {a.lga}</div>}
      <div>
        {a.state}, {a.country}
      </div>
    </div>
  );
} function buildSupplierNameMap(quote: QuotePayload | null, shipping: ShippingQuoteResponse | null) {
  const map = new Map<string, string>();

  const pricingLines = Object.values(quote?.lines ?? {});
  for (const line of pricingLines) {
    for (const alloc of line.allocations ?? []) {
      const sid = String(alloc?.supplierId ?? "").trim();
      const sname = String(alloc?.supplierName ?? "").trim();
      if (sid && sname && !map.has(sid)) {
        map.set(sid, sname);
      }
    }
  }

  for (const q of shipping?.quotes ?? []) {
    const sid = String(q?.supplierId ?? "").trim();
    const sname = String(q?.supplierName ?? "").trim();
    if (sid && sname && !map.has(sid)) {
      map.set(sid, sname);
    }
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

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  const [homeAddr, setHomeAddr] = useState<Address>(EMPTY_ADDR);
  const [shipAddr, setShipAddr] = useState<Address>(EMPTY_ADDR);

  const [showHomeForm, setShowHomeForm] = useState(false);
  const [showShipForm, setShowShipForm] = useState(false);
  const [sameAsHome, setSameAsHome] = useState(true);

  const [savingHome, setSavingHome] = useState(false);
  const [savingShip, setSavingShip] = useState(false);
  const [redirectingOrderId, setRedirectingOrderId] = useState<string | null>(null);

  const shippingEnabled = useMemo(() => shippingEnabledFromSettings, [shippingEnabledFromSettings]);
  const shippingMode: "DELIVERY" | "PICKUP_ONLY" = shippingEnabled ? "DELIVERY" : "PICKUP_ONLY";

  const shippingAddressForQuote = sameAsHome ? homeAddr : shipAddr;

  const shippingQ = useQuery({
    queryKey: [
      "checkout",
      "shipping-quotes:v2",
      user?.id,
      sameAsHome ? "home" : "ship",
      JSON.stringify({
        ...shippingAddressForQuote,
        lga: (shippingAddressForQuote as any).lga ?? shippingAddressForQuote.town ?? "",
      }),
      cart.map((i) => `${lineKeyFor(i)}@${Math.max(1, asInt(i.qty, 1))}`).sort().join(","),
    ],
    enabled:
      shippingEnabled &&
      hydrated &&
      !!user?.id &&
      cart.length > 0 &&
      !loadingProfile &&
      !showHomeForm &&
      (sameAsHome || !showShipForm),
    refetchOnWindowFocus: false,
    staleTime: 15_000,
    retry: false,
    queryFn: async () =>
      fetchShippingQuotesForCart({
        cart,
        address: {
          ...shippingAddressForQuote,
          lga: (shippingAddressForQuote as any).lga ?? shippingAddressForQuote.town ?? "",
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


  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!hydrated) return;
      if (!user?.id) return;

      setCheckingVerification(true);
      setLoadingProfile(true);
      setProfileErr(null);

      try {
        const data = await fetchProfileMe();
        if (!mounted) return;

        const flags = computeVerificationFlags(data);
        setEmailOk(flags.emailOk);
        setPhoneOk(flags.phoneOk);

        if (!flags.emailOk) setShowNotVerified(true);
        else setShowNotVerified(false);

        const h = data?.address ?? null;
        const saddr = data?.shippingAddress ?? (data as any)?.shipping_address ?? null;

        if (h) setHomeAddr({ ...EMPTY_ADDR, ...h });
        if (saddr) setShipAddr({ ...EMPTY_ADDR, ...saddr });

        setShowHomeForm(!h);
        setShowShipForm(!saddr);
        setSameAsHome(!!h && !saddr);
      } catch (e: any) {
        if (!mounted) return;

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
        if (mounted) {
          setCheckingVerification(false);
          setLoadingProfile(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [hydrated, user?.id, nav]);

  const didHydrateCartRef = React.useRef(false);

  useEffect(() => {
    if (!didHydrateCartRef.current) {
      didHydrateCartRef.current = true;
      return;
    }
    writeCart(cart);
  }, [cart]);

  useEffect(() => {
    const syncFromCart = () => setCart(readCart());
    window.addEventListener("cart:updated", syncFromCart);
    return () => window.removeEventListener("cart:updated", syncFromCart);
  }, []);

  useEffect(() => {
    if (sameAsHome) setShipAddr((prev) => ({ ...prev, ...homeAddr }));
  }, [sameAsHome, homeAddr]);

  const onChangeHome =
    (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setHomeAddr((a) => ({ ...a, [k]: e.target.value }));

  const onChangeShip =
    (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setShipAddr((a) => ({ ...a, [k]: e.target.value }));

  function validateAddress(a: Address, isShipping = false): string | null {
    const label = isShipping ? "Shipping" : "Home";

    if (!a.houseNumber.trim()) return `Enter ${label} address: house/plot number`;
    if (!a.streetName.trim()) return `Enter ${label} address: street name`;
    if (!a.city.trim()) return `Enter ${label} address: city`;
    if (!a.state.trim()) return `Enter ${label} address: state`;
    if (!a.country.trim()) return `Enter ${label} address: country`;
    if (!a.postCode.trim()) return `Enter ${label} address: post code`;

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

      if (sameAsHome) {
        await api.post("/api/profile/shipping", homeAddr, AXIOS_COOKIE_CFG);
        setShipAddr(homeAddr);
        setShowShipForm(false);
      }
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

  const saveShip = async () => {
    const v = validateAddress(shipAddr, true);
    if (v) {
      openModal({ title: "Checkout", message: v });
      return;
    }
    try {
      setSavingShip(true);
      await api.post("/api/profile/shipping", shipAddr, AXIOS_COOKIE_CFG);
      setShowShipForm(false);
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
          "Could not save your shipping address. Please check the fields and try again."
        ),
      });
    } finally {
      setSavingShip(false);
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

      if (shippingEnabled) {
        if (shippingQ.isLoading) {
          throw new Error("Calculating shipping… Please try again in a moment.");
        }

        if (shippingQ.isError || !shippingQ.data) {
          throw new Error("Could not calculate shipping yet. Please check your address and try again.");
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

      const finalShip = sameAsHome ? homeAddr : shipAddr;

      if (!sameAsHome) {
        const vaShip = validateAddress(finalShip, true);
        if (vaShip) throw new Error(vaShip);
      }

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
      const payload: any = {
        items,
        shippingAddress: finalShip,
        attribution: at,

        // ✅ new flow
        shippingQuoteIds: shippingEnabled ? shippingQuoteIds : [],

        // legacy-safe fallbacks
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
            "We couldn’t place your order. Please review your address details and try again."
          )
        );
      }
    },
    onSuccess: (resp) => {
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
            shippingAddress: sameAsHome ? homeAddr : shipAddr,
            at: Date.now(),
          })
        );
      } catch {
        //
      }

      writeCart([]);
      window.location.assign(`/payment?orderId=${encodeURIComponent(orderId)}`);
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
      lines.push("• Your phone number is not verified.");
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
              <div className="text-[11px] md:text-xs text-ink-soft text-center">
                {!emailOk && (
                  <>
                    Or{" "}
                    <a
                      className="underline"
                      href={verifyHref}
                      onClick={(e) => {
                        e.preventDefault();
                        nav(verifyHref);
                      }}
                    >
                      open verification page
                    </a>
                    .
                  </>
                )}
              </div>
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
            <button
              className="px-4 py-2 rounded-lg bg-zinc-900 text-white hover:opacity-90 text-sm"
              onClick={() => { }}
              disabled
              title="Complete the steps above"
              type="button"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  };

  const showShippingIncludedRibbon = !publicSettingsQ.isLoading && !shippingEnabled;

  return (
    <SiteLayout>
      <div className="bg-bg-soft bg-hero-radial">
        {!checkingVerification && showNotVerified && <NotVerifiedModal />}

        <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-5 sm:py-6 md:py-8">
          <div className="mb-4 md:mb-6">
            <nav className="flex items-center gap-2 text-xs sm:text-sm">
              <span className="text-ink font-medium">Items</span>
              <span className="opacity-40">›</span>
              <span className="text-ink-soft">Address</span>
              <span className="opacity-40">›</span>
              <span className="text-ink-soft">Payment</span>
            </nav>
            <h1 className="mt-2 text-xl sm:text-2xl font-semibold text-ink leading-tight">
              Checkout
            </h1>

            {profileErr && (
              <p className="mt-2 text-xs sm:text-sm text-danger border border-danger/20 bg-red-50 px-3 py-2 rounded">
                {profileErr}
              </p>
            )}

            {(pricingQ.isLoading || pricingWarning) && (
              <div className="mt-3 text-xs sm:text-sm rounded-xl border bg-white/80 p-3 text-ink">
                {pricingQ.isLoading ? "Calculating best supplier prices…" : pricingWarning}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-4 sm:gap-5 md:gap-6">
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
                      <Input
                        value={homeAddr.houseNumber}
                        onChange={onChangeHome("houseNumber")}
                        placeholder="House No. *"
                      />
                      <Input
                        value={homeAddr.postCode}
                        onChange={onChangeHome("postCode")}
                        placeholder="Post code *"
                      />
                    </div>

                    <Input
                      value={homeAddr.streetName}
                      onChange={onChangeHome("streetName")}
                      placeholder="Street name *"
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        value={homeAddr.town}
                        onChange={onChangeHome("town")}
                        placeholder="Town (optional)"
                      />
                      <Input
                        value={homeAddr.lga || ""}
                        onChange={onChangeHome("lga")}
                        placeholder="LGA (optional)"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        value={homeAddr.city}
                        onChange={onChangeHome("city")}
                        placeholder="City *"
                      />
                      <Input
                        value={homeAddr.state}
                        onChange={onChangeHome("state")}
                        placeholder="State *"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        value={homeAddr.country}
                        onChange={onChangeHome("country")}
                        placeholder="Country *"
                      />
                      <div />
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pt-1">
                      <button
                        type="button"
                        className="w-full sm:w-auto inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-white font-medium hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-200 transition disabled:opacity-50 text-sm"
                        onClick={saveHome}
                        disabled={savingHome}
                      >
                        {savingHome ? "Saving…" : "Done"}
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
                  title="Shipping address"
                  subtitle={
                    shippingEnabled
                      ? "Where we’ll deliver your items."
                      : "We’ll deliver to this address. Shipping cost is already included in prices."
                  }
                  icon={<IconTruck />}
                  action={
                    <label className="flex items-center gap-2 text-[11px] sm:text-sm">
                      <input
                        type="checkbox"
                        checked={sameAsHome}
                        onChange={async (e) => {
                          const checked = e.target.checked;

                          if (checked) {
                            const v = validateAddress(homeAddr, false);
                            if (v) {
                              openModal({ title: "Checkout", message: v });
                              setSameAsHome(false);
                              return;
                            }
                          }

                          setSameAsHome(checked);

                          if (checked) {
                            try {
                              setSavingShip(true);
                              await api.post("/api/profile/shipping", homeAddr, AXIOS_COOKIE_CFG);
                              setShipAddr(homeAddr);
                              setShowShipForm(false);
                            } catch (err: any) {
                              const status = err?.response?.status;
                              if (status === 401) {
                                nav("/login", {
                                  state: { from: { pathname: "/checkout" } },
                                  replace: true,
                                });
                                return;
                              }
                              openModal({
                                title: "Checkout",
                                message: safeServerMessage(
                                  err,
                                  "Failed to set shipping as home. Please check your address and try again."
                                ),
                              });
                              setSameAsHome(false);
                            } finally {
                              setSavingShip(false);
                            }
                          }
                        }}
                      />
                      <span className="text-ink-soft">Same as home</span>
                    </label>
                  }
                />
                {sameAsHome ? (
                  <div className="px-4 py-3 md:p-4 text-[11px] sm:text-sm text-ink-soft">
                    Using your Home address for shipping.
                  </div>
                ) : loadingProfile ? (
                  <div className="px-4 py-3 md:p-4 text-[11px] sm:text-sm text-ink-soft">
                    Loading…
                  </div>
                ) : showShipForm ? (
                  <div className="p-4 grid grid-cols-1 gap-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        value={shipAddr.houseNumber}
                        onChange={onChangeShip("houseNumber")}
                        placeholder="House No. *"
                      />
                      <Input
                        value={shipAddr.postCode}
                        onChange={onChangeShip("postCode")}
                        placeholder="Post code *"
                      />
                    </div>

                    <Input
                      value={shipAddr.streetName}
                      onChange={onChangeShip("streetName")}
                      placeholder="Street name *"
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        value={shipAddr.town}
                        onChange={onChangeShip("town")}
                        placeholder="Town (optional)"
                      />
                      <Input
                        value={shipAddr.lga || ""}
                        onChange={onChangeShip("lga")}
                        placeholder="LGA (optional)"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        value={shipAddr.city}
                        onChange={onChangeShip("city")}
                        placeholder="City *"
                      />
                      <Input
                        value={shipAddr.state}
                        onChange={onChangeShip("state")}
                        placeholder="State *"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        value={shipAddr.country}
                        onChange={onChangeShip("country")}
                        placeholder="Country *"
                      />
                      <div />
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pt-1">
                      <button
                        type="button"
                        className="w-full sm:w-auto inline-flex items-center justify-center rounded-md bg-amber-600 px-4 py-2 text-white font-medium hover:bg-amber-700 focus:outline-none focus:ring-4 focus:ring-amber-200 transition disabled:opacity-50 text-sm"
                        onClick={saveShip}
                        disabled={savingShip}
                      >
                        {savingShip ? "Saving…" : "Done"}
                      </button>

                      <button
                        type="button"
                        className="w-full sm:w-auto text-sm text-ink-soft hover:underline"
                        onClick={() => setShipAddr(EMPTY_ADDR)}
                        disabled={savingShip}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-3 md:p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs sm:text-sm leading-5 sm:leading-6 text-ink">
                        <div>
                          {shipAddr.houseNumber} {shipAddr.streetName}
                        </div>
                        <div>
                          {shipAddr.town || ""} {shipAddr.city || ""} {shipAddr.postCode || ""}
                        </div>
                        {!!shipAddr.lga && <div>LGA: {shipAddr.lga}</div>}
                        <div>
                          {shipAddr.state}, {shipAddr.country}
                        </div>
                      </div>
                      <button
                        className="text-[11px] sm:text-sm text-amber-700 hover:underline"
                        onClick={() => setShowShipForm(true)}
                        type="button"
                      >
                        Change
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            </section>

            <aside className="lg:sticky lg:top-6 h-max">
              <Card className="p-4 sm:p-5">
                <h2 className="text-base sm:text-lg font-semibold text-ink">Order Summary</h2>

                <div className="mt-3 space-y-2 text-xs sm:text-sm">
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
                      No extra shipping fee: delivery cost is already included in item prices. We’ll
                      still deliver to the shipping address you provide.
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
                      Shipping was quoted for some suppliers only. Total may change after remaining
                      supplier zones/rates are configured.
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-baseline justify-between text-ink">
                  <span className="font-semibold text-sm sm:text-base">Total</span>
                  <span className="text-lg sm:text-xl font-semibold">
                    {ngn.format(payableTotal)}
                  </span>
                </div>

                {pricingWarning && (
                  <p className="mt-3 text-xs sm:text-sm text-danger border border-danger/20 bg-red-50 px-3 py-2 rounded">
                    {pricingWarning}
                  </p>
                )}

                <button
                  disabled={createOrder.isPending || pricingQ.isLoading || !!pricingWarning}
                  onClick={() => createOrder.mutate()}
                  className="mt-4 sm:mt-5 w-full inline-flex items-center justify-center rounded-lg bg-accent-500 text-white px-4 py-2.5 font-medium hover:bg-accent-600 active:bg-accent-700 focus:outline-none focus:ring-4 focus:ring-accent-200 transition disabled:opacity-50 text-sm"
                  type="button"
                >
                  {createOrder.isPending
                    ? "Processing…"
                    : pricingQ.isLoading
                      ? "Calculating prices…"
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
                  className="mt-3 w-full inline-flex items-center justify-center rounded-lg border border-border bg-surface px-4 py-2.5 text-ink hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-50 transition text-sm"
                  type="button"
                >
                  Back to cart
                </button>

                <p className="mt-3 text-[10px] sm:text-[11px] text-ink-soft text-center leading-4">
                  Totals use live supplier offers and supplier shipping quotes. If an offer or quote
                  expires, your pricing may update.
                </p>
              </Card>
            </aside>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}