// src/components/admin/ManageProducts.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useModal } from "../ModalProvider";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounced } from "../../utils/useDebounced";
import { useSearchParams } from "react-router-dom";
import api from "../../api/client";
import SuppliersOfferManager from "./SuppliersOfferManager";

/* ============================
   Types
============================ */

type SupplierOfferLite = {
  id: string;
  productId: string;
  variantId?: string | null;
  supplierId?: string;
  supplierName?: string;
  isActive?: boolean;
  inStock?: boolean;
  availableQty?: number;
  available?: number;
  qty?: number;
  stock?: number;

  unitCost?: number | string | null;
  unitPrice?: number | string | null;
  cost?: number | string | null;
  supplierPrice?: number | string | null;
  basePrice?: number | string | null;
  amount?: number | string | null;
};

type AdminProduct = {
  id: string;
  title: string;
  retailPrice: number | string;
  status: string;
  sku?: string;
  imagesJson?: string[] | string;
  createdAt?: string;
  isDeleted?: boolean;
  isDelete?: boolean;

  ownerId?: string | null;
  userId?: string | null;

  supplierId?: string | null;

  availableQty?: number;
  supplierOffers?: SupplierOfferLite[];
  ownerEmail?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  inStock?: boolean;

  supplierName?: string | null;

  variants?: any[];
  variantCount?: number;

  createdByEmail?: string | null;
  createdBy?: { email?: string | null };
  owner?: { email?: string | null };
  description?: string | null;

  freeShipping?: boolean | null;
  shippingCost?: number | string | null;
  shippingClass?: string | null;

  isFragile?: boolean | null;
  isBulky?: boolean | null;

  weightGrams?: number | string | null;
  lengthCm?: number | string | null;
  widthCm?: number | string | null;
  heightCm?: number | string | null;

  fragile?: boolean | null;
  oversized?: boolean | null;
  weightKg?: number | string | null;

  __baseQty?: number;
  __offerQty?: number;
  __offerCount?: number;

  __bestBaseSupplierPrice?: number;
  __bestVariantSupplierPrice?: number;
  __computedRetailFrom?: number;
};

type AdminSupplier = {
  id: string;
  name: string;
  type: "PHYSICAL" | "ONLINE";
  status: string;
  userId?: string | null;
  contactEmail?: string | null;
  whatsappPhone?: string | null;
  apiBaseUrl?: string | null;
  apiAuthType?: "NONE" | "BEARER" | "BASIC" | null;
  apiKey?: string | null;
  payoutMethod?: "SPLIT" | "TRANSFER" | null;
  bankCountry?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  isPayoutEnabled?: boolean | null;
};

type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  parentId?: string | null;
  position?: number | null;
  isActive: boolean;
};

type AdminBrand = {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  isActive: boolean;
};

type AdminAttributeValue = {
  id: string;
  name: string;
  code?: string | null;
  attributeId: string;
  position?: number | null;
  isActive: boolean;
};

type AdminAttribute = {
  id: string;
  name: string;
  type: "TEXT" | "SELECT" | "MULTISELECT";
  placeholder?: string | null;
  isActive: boolean;
  values?: AdminAttributeValue[];
};

type FilterPreset =
  | "all"
  | "no-offer"
  | "live"
  | "published-with-offer"
  | "published-no-offer"
  | "published-with-active"
  | "published-base-in"
  | "published-base-out"
  | "with-variants"
  | "simple"
  | "published-with-availability"
  | "published"
  | "pending"
  | "rejected";

type VariantRow = {
  id: string;
  selections: Record<string, string>;
  inStock?: boolean;
  availableQty?: number;
  imagesJson?: string[];
};

type AttrDef = { id: string; name?: string };

const cookieOpts = { withCredentials: true as const };

const SHIPPING_UI_NUMBER_KEYS = [
  "weightKg",
  "weightGrams",
  "lengthCm",
  "widthCm",
  "heightCm",
] as const;

const SHIPPING_UI_STRING_KEYS = [
  "shippingClass",
] as const;

const SHIPPING_UI_BOOLEAN_KEYS = [
  "freeShipping",
  "fragile",
  "oversized",
] as const;

const SHIPPING_CLASS_OPTIONS = ["STANDARD", "FRAGILE", "BULKY"] as const;
type ShippingParcelClass = (typeof SHIPPING_CLASS_OPTIONS)[number];

type PendingState = {
  title: string;
  supplierPrice: string;
  retailPrice: string;
  status: string;
  categoryId: string;
  brandId: string;
  supplierId: string;
  supplierAvailableQty: string;
  sku: string;
  imageUrls: string;
  description: string;

  freeShipping: boolean;
  fragile: boolean;
  oversized: boolean;

  shippingClass: ShippingParcelClass | "";

  weightKg: string;
  weightGrams: string;

  lengthCm: string;
  widthCm: string;
  heightCm: string;
};

/* ============================
   Helpers
============================ */

function statusFromPreset(p: FilterPreset): "ANY" | "PUBLISHED" | "PENDING" | "REJECTED" | "LIVE" {
  if (p.startsWith("published")) return "PUBLISHED";
  if (p === "published") return "PUBLISHED";
  if (p === "pending") return "PENDING";
  if (p === "live") return "LIVE";
  if (p === "rejected") return "REJECTED";
  return "ANY";
}

function coerceBool(v: any, def = true) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return /^(true|1|yes|y)$/i.test(v.trim());
  if (v == null) return def;
  return Boolean(v);
}

function toInt(x: any, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : d;
}

function availOf(o: any): number {
  const candidates = [o?.availableQty, o?.available, o?.qty, o?.stock];

  const parseNum = (v: any) => {
    if (typeof v === "number") return v;
    if (typeof v === "string") return Number(v);
    if (v && typeof v === "object" && typeof v.toString === "function") {
      const s = String(v.toString());
      return Number(s);
    }
    return NaN;
  };

  for (const v of candidates) {
    const n = parseNum(v);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return 0;
}

type ProductAttributeEnabledRow = {
  attributeId?: string;
  attribute?: {
    id: string;
    name?: string;
    type?: string;
    isActive?: boolean;
  };
};

function hasExplicitQty(o: any): boolean {
  const keys = ["availableQty", "available", "qty", "stock"];
  for (const k of keys) {
    const v = o?.[k];
    if (v == null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return true;
  }
  return false;
}

function normalizeNullableId(raw: any): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s === "null" || s === "undefined") return null;
  return s;
}

function normalizeId(x: any): string | null {
  if (x == null) return null;
  const s = String(x).trim();
  if (!s || s === "null" || s === "undefined") return null;
  return s;
}

function toNumberLoose(v: any): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "object" && typeof v.toString === "function") {
    const n = Number(String(v.toString()));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function shippingInputNumber(v: any): string {
  if (v == null) return "";
  const n = toNumberLoose(v);
  return n == null ? "" : String(n);
}

function shippingInputString(v: any): string {
  return v == null ? "" : String(v);
}

function shippingInputBool(v: any, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return /^(true|1|yes|y|on)$/i.test(v.trim());
  if (typeof v === "number") return v !== 0;
  return fallback;
}

function normalizeShippingClass(v: any): ShippingParcelClass | "" {
  const s = String(v ?? "").trim().toUpperCase();
  return SHIPPING_CLASS_OPTIONS.includes(s as ShippingParcelClass) ? (s as ShippingParcelClass) : "";
}

function pickShippingStateFromProduct(p: any) {
  const toNum = (v: any): number | null => {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof v === "object" && typeof v.toString === "function") {
      const n = Number(String(v.toString()));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const grams = toNum(p?.weightGrams);
  const kg = grams != null ? grams / 1000 : toNum(p?.weightKg);

  return {
    shippingClass: normalizeShippingClass(p?.shippingClass),

    freeShipping:
      typeof p?.freeShipping === "boolean"
        ? p.freeShipping
        : false,

    fragile:
      typeof p?.isFragile === "boolean"
        ? p.isFragile
        : typeof p?.fragile === "boolean"
          ? p.fragile
          : false,

    oversized:
      typeof p?.isBulky === "boolean"
        ? p.isBulky
        : typeof p?.oversized === "boolean"
          ? p.oversized
          : false,

    weightGrams: grams != null ? String(Math.round(grams)) : "",
    weightKg: kg != null ? String(kg) : "",

    lengthCm: toNum(p?.lengthCm) != null ? String(toNum(p?.lengthCm)) : "",
    widthCm: toNum(p?.widthCm) != null ? String(toNum(p?.widthCm)) : "",
    heightCm: toNum(p?.heightCm) != null ? String(toNum(p?.heightCm)) : "",
  };
}

function buildShippingPayloadFromPending(pending: PendingState) {
  const out: Record<string, any> = {};

  const lengthCm = Number(pending?.lengthCm);
  if (Number.isFinite(lengthCm)) {
    out.lengthCm = lengthCm;
  }

  const widthCm = Number(pending?.widthCm);
  if (Number.isFinite(widthCm)) {
    out.widthCm = widthCm;
  }

  const heightCm = Number(pending?.heightCm);
  if (Number.isFinite(heightCm)) {
    out.heightCm = heightCm;
  }

  const weightGramsDirect = Number(pending?.weightGrams);
  const weightKg = Number(pending?.weightKg);

  if (Number.isFinite(weightGramsDirect)) {
    out.weightGrams = Math.round(weightGramsDirect);
  } else if (Number.isFinite(weightKg)) {
    out.weightGrams = Math.round(weightKg * 1000);
  }

  const shippingClass = normalizeShippingClass(pending?.shippingClass);
  if (shippingClass) {
    out.shippingClass = shippingClass;
  }

  if (typeof pending?.freeShipping === "boolean") {
    out.freeShipping = pending.freeShipping;
  }

  if (typeof pending?.fragile === "boolean") {
    out.isFragile = pending.fragile;
  }

  if (typeof pending?.oversized === "boolean") {
    out.isBulky = pending.oversized;
  }

  return out;
}

function friendlyErrorMessage(e: any, fallback: string) {
  const status = e?.response?.status;
  const detail =
    e?.response?.data?.detail ||
    e?.response?.data?.error ||
    e?.response?.data?.message ||
    e?.message;

  if (status >= 500) {
    return "Something went wrong while saving. Please try again in a moment.";
  }

  if (status === 413) return "Upload too large. Please use smaller images.";
  if (status === 401 || status === 403) return "You’re not authorized to do that. Please log in again.";

  return detail || fallback;
}

function offerUnitCost(o: any): number | null {
  if (!o) return null;

  const directKeys = ["unitCost", "unitPrice", "cost", "supplierPrice", "basePrice", "price", "amount"];
  for (const k of directKeys) {
    const n = toNumberLoose(o?.[k]);
    if (n != null) return n;
  }

  const nested = [
    o?.pricing?.unitCost,
    o?.pricing?.cost,
    o?.pricing?.price,
    o?.unitCost?.amount,
    o?.price?.amount,
    o?.amount?.amount,
  ];
  for (const v of nested) {
    const n = toNumberLoose(v);
    if (n != null) return n;
  }

  return null;
}

function computeRetailPriceFromSupplierPrice(args: {
  supplierPrice: number;
  baseServiceFeeNGN: number;
  commsUnitCostNGN: number;
  gatewayFeePercent: number;
  gatewayFixedFeeNGN: number;
  gatewayFeeCapNGN: number;
}) {
  const supplierPrice = Number(args.supplierPrice);
  if (!Number.isFinite(supplierPrice) || supplierPrice <= 0) return 0;

  const gatewayFeeNGN = estimateGatewayFeeFromSettings({
    amountNaira: supplierPrice,
    gatewayFeePercent: args.gatewayFeePercent,
    gatewayFixedFeeNGN: args.gatewayFixedFeeNGN,
    gatewayFeeCapNGN: args.gatewayFeeCapNGN,
  });

  const extras =
    Number(args.baseServiceFeeNGN || 0) +
    Number(args.commsUnitCostNGN || 0) +
    Number(gatewayFeeNGN || 0);

  return Math.round(supplierPrice + extras);
}

function estimateGatewayFeeFromSettings(args: {
  amountNaira: number;
  gatewayFeePercent: number;
  gatewayFixedFeeNGN: number;
  gatewayFeeCapNGN: number;
}) {
  const amount = Number(args.amountNaira);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  const percentFee = amount * (Number(args.gatewayFeePercent || 0) / 100);
  const gross = percentFee + Number(args.gatewayFixedFeeNGN || 0);
  const cap = Number(args.gatewayFeeCapNGN || 0);

  if (cap > 0) return Math.min(gross, cap);
  return gross;
}

async function fetchSupplierOffersForProduct(productId: string) {
  const attempts = [
    `/api/admin/products/${encodeURIComponent(productId)}/supplier-offers`,
    `/api/admin/supplier-offers?productId=${encodeURIComponent(productId)}`,
  ];

  for (const url of attempts) {
    try {
      const { data } = await api.get(url, cookieOpts);
      const root = (data as any)?.data?.data ?? (data as any)?.data ?? data;
      const arr = Array.isArray(root) ? root : Array.isArray((root as any)?.data) ? (root as any).data : [];
      return arr as any[];
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 404) continue;
      throw e;
    }
  }

  return [];
}

function extractProductVariants(p: any): any[] {
  if (Array.isArray(p?.variants)) return p.variants;
  if (Array.isArray(p?.ProductVariant)) return p.ProductVariant;
  if (Array.isArray(p?.productVariants)) return p.productVariants;
  return [];
}

const rowKey = (row: VariantRow, index: number) => String(row?.id ?? index);

function serializeComboSelections(selections: Record<string, string>, attrs: AttrDef[]): string {
  const parts = attrs.map((a) => `${a.id}:${String(selections?.[a.id] ?? "").trim()}`);
  const allEmpty = parts.every((p) => p.endsWith(":"));
  return allEmpty ? "" : parts.join("|");
}

function buildComboKey(row: VariantRow, attrs: AttrDef[]): string {
  return serializeComboSelections(row?.selections || {}, attrs);
}

function findDuplicateCombos(rows: VariantRow[], attrs: AttrDef[]): Record<string, string> {
  const keyToRows = new Map<string, string[]>();

  rows.forEach((r, idx) => {
    const ck = buildComboKey(r, attrs);
    if (!ck) return;
    const rk = rowKey(r, idx);
    const list = keyToRows.get(ck) ?? [];
    list.push(rk);
    keyToRows.set(ck, list);
  });

  const errors: Record<string, string> = {};
  for (const [, list] of keyToRows.entries()) {
    if (list.length <= 1) continue;
    list.forEach((rk) => {
      errors[rk] = "Duplicate variant combination. Each row’s combo must be unique.";
    });
  }
  return errors;
}

async function persistVariantsStrict(productId: string, variants: any[], opts?: { replace?: boolean }) {
  const replace = opts?.replace ?? true;

  const clean = (variants || []).map((v) => {
    const id = normalizeId(v?.id);
    const sku = String(v?.sku ?? "").trim();
    const retailPriceNum = toNumberLoose(v?.retailPrice ?? v?.price);

    return {
      ...(id ? { id } : {}),
      ...(!id && sku ? { sku } : {}),
      ...(retailPriceNum != null ? { retailPrice: retailPriceNum } : {}),
      options: (v?.options || v?.optionSelections || []).map((o: any) => {
        const unitPriceNum = toNumberLoose(o?.unitPrice);

        return {
          attributeId: o.attributeId || o.attribute?.id,
          valueId: o.valueId || o.attributeValueId || o.value?.id,
          ...(unitPriceNum != null ? { unitPrice: unitPriceNum } : {}),
        };
      }),
    };
  });

  const attempts: Array<{ method: "post" | "put"; url: string; body: any }> = [
    { method: "post", url: `/api/admin/products/${encodeURIComponent(productId)}/variants/bulk`, body: { variants: clean, replace } },
    { method: "post", url: `/api/admin/products/${encodeURIComponent(productId)}/variants/bulk-replace`, body: { variants: clean, replace } },
    { method: "put", url: `/api/admin/products/${encodeURIComponent(productId)}/variants`, body: { variants: clean, replace } },
    { method: "post", url: `/api/admin/products/${encodeURIComponent(productId)}/variants`, body: { variants: clean, replace } },
    { method: "post", url: `/api/admin/variants/bulk?productId=${encodeURIComponent(productId)}`, body: { variants: clean, replace } },
  ];

  let lastErr: any = null;

  for (const a of attempts) {
    try {
      const req =
        a.method === "put"
          ? api.put(a.url, a.body, cookieOpts)
          : api.post(a.url, a.body, cookieOpts);

      const { data } = await req;
      return data;
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 404 || status === 405) {
        lastErr = e;
        continue;
      }
      const msg = e?.response?.data?.detail || e?.response?.data?.error || e?.message || "Failed to persist variants";
      console.error("persistVariantsStrict error:", status, e?.response?.data || e);
      throw new Error(msg);
    }
  }

  console.error("No variants bulk endpoint found. Last error:", lastErr?.response?.status, lastErr?.response?.data);
  throw new Error("Your API does not expose a variants bulk endpoint. Add one server-side or update the frontend to match your backend route.");
}

/* ============================
   Component
============================ */

export function ManageProducts({
  role,
  search,
  setSearch,
  focusId,
  onFocusedConsumed,
}: {
  role: string;
  search: string;
  setSearch: (s: string) => void;
  focusId: string | null;
  onFocusedConsumed: () => void;
}) {

  const isSuper = role === "SUPER_ADMIN";
  const isAdmin = role === "ADMIN";

  const { openModal } = useModal();
  const qc = useQueryClient();
  const staleTimeInMs = 300_000;

  const hasOrdersSupportRef = useRef<"unknown" | "supported" | "unsupported">("unknown");
  const hasOrdersProbeDoneRef = useRef(false);

  const [refreshKey, setRefreshKey] = useState(0);

  const [searchParams, setSearchParams] = useSearchParams();

  const initialSearchRef = useRef(search || "");
  const [qInput, setQInput] = useState(initialSearchRef.current);

  const [supplierFilterText, setSupplierFilterText] = useState("");
  const [supplierFilterId, setSupplierFilterId] = useState(() => searchParams.get("supplierId") || "");

  const debouncedQ = useDebounced(qInput, 350);
  const debouncedSupplierFilterText = useDebounced(supplierFilterText, 250);

  const urlPreset = (searchParams.get("view") as FilterPreset) || "all";
  const [preset, setPreset] = useState<FilterPreset>(urlPreset);

  const lastSentSearchRef = useRef(initialSearchRef.current);

  useEffect(() => {
    console.log("ManageProducts mounted");
  }, []);

  useEffect(() => {
    const nextPreset = (searchParams.get("view") as FilterPreset) || "all";
    setPreset((prev) => (prev === nextPreset ? prev : nextPreset));

    const nextSupplierId = searchParams.get("supplierId") || "";
    setSupplierFilterId((prev) => (prev === nextSupplierId ? prev : nextSupplierId));
  }, [searchParams]);

  useEffect(() => {
    try {
      if (lastSentSearchRef.current === debouncedQ) return;
      lastSentSearchRef.current = debouncedQ;
      setSearch(debouncedQ);
    } catch { }
  }, [debouncedQ, setSearch]);

  function setPresetAndUrl(next: FilterPreset) {
    setPreset(next);
    const sp = new URLSearchParams(searchParams);
    if (next && next !== "all") sp.set("view", next);
    else sp.delete("view");
    setSearchParams(sp, { replace: true });
  }

  function setSupplierIdAndUrl(nextId: string) {
    setSupplierFilterId(nextId);

    const sp = new URLSearchParams(searchParams);
    if (nextId) sp.set("supplierId", nextId);
    else sp.delete("supplierId");
    setSearchParams(sp, { replace: true });
  }

  type PricingSettings = {
    baseServiceFeeNGN: number;
    commsUnitCostNGN: number;
    gatewayFeePercent: number;
    gatewayFixedFeeNGN: number;
    gatewayFeeCapNGN: number;
  };

  const pricingSettingsQ = useQuery<PricingSettings>({
    queryKey: ["admin", "settings", "pricing-public"],
    enabled: role === "SUPER_ADMIN" || role === "ADMIN",
    queryFn: async () => {
      const { data } = await api.get("/api/settings/public", cookieOpts);

      return {
        baseServiceFeeNGN: Number(data?.baseServiceFeeNGN ?? 0) || 0,
        commsUnitCostNGN: Number(data?.commsUnitCostNGN ?? 0) || 0,
        gatewayFeePercent: Number(data?.gatewayFeePercent ?? 1.5) || 1.5,
        gatewayFixedFeeNGN: Number(data?.gatewayFixedFeeNGN ?? 100) || 100,
        gatewayFeeCapNGN: Number(data?.gatewayFeeCapNGN ?? 2000) || 2000,
      };
    },
    staleTime: 300_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const baseServiceFeeNGN = Number(pricingSettingsQ.data?.baseServiceFeeNGN ?? 0) || 0;
  const commsUnitCostNGN = Number(pricingSettingsQ.data?.commsUnitCostNGN ?? 0) || 0;
  const gatewayFeePercent = Number(pricingSettingsQ.data?.gatewayFeePercent ?? 1.5) || 1.5;
  const gatewayFixedFeeNGN = Number(pricingSettingsQ.data?.gatewayFixedFeeNGN ?? 100) || 100;
  const gatewayFeeCapNGN = Number(pricingSettingsQ.data?.gatewayFeeCapNGN ?? 2000) || 2000;

  type SortKey = "title" | "price" | "avail" | "stock" | "status" | "owner" | "supplier";
  type SortDir = "asc" | "desc";
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "title", dir: "asc" });

  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const SortIndicator = ({ k }: { k: SortKey }) => {
    if (sort.key !== k) return <span className="opacity-50">↕</span>;
    return <span>{sort.dir === "asc" ? "↑" : "↓"}</span>;
  };

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 20 | 30 | 50>(10);

  function extractOfferProductId(o: any): string | null {
    return normalizeNullableId(o?.productId?.id ?? o?.product?.id ?? o?.productId);
  }

  function extractOfferSupplierId(o: any): string | null {
    return normalizeNullableId(o?.supplierId?.id ?? o?.supplier?.id ?? o?.supplierId);
  }

  function extractOfferVariantId(o: any): string | null {
    const direct = normalizeNullableId(o?.variantId?.id ?? o?.variant?.id ?? o?.variantId);
    if (direct) return direct;

    const id = normalizeNullableId(o?.id);
    if (!id) return null;

    if (id.startsWith("variant:")) {
      const rest = id.slice("variant:".length);
      const cleaned = rest.split("|")[0].split(",")[0].trim();
      return normalizeNullableId(cleaned);
    }

    const m = id.match(/variant:([A-Za-z0-9_-]+)/);
    if (m?.[1]) return normalizeNullableId(m[1]);

    return null;
  }

  const statusParam = statusFromPreset(preset);

  const suppliersQ = useQuery<AdminSupplier[]>({
    queryKey: ["admin", "products", "suppliers"],
    enabled: !!role,
    refetchOnWindowFocus: false,
    staleTime: staleTimeInMs,
    queryFn: async () => {
      const attempts = ["/api/admin/suppliers"];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, cookieOpts);
          const arr = Array.isArray((data as any)?.data) ? (data as any).data : Array.isArray(data) ? data : [];
          if (Array.isArray(arr)) return arr;
        } catch { }
      }
      return [];
    },
  });

  const getSupplierName = (p: any) => {
    const direct = p?.supplierName || p?.supplier?.name || p?.supplier?.supplierName || "";
    if (direct) return String(direct);

    const sid = String(p?.supplierId ?? "").trim();
    if (!sid) return "";

    const found = (suppliersQ.data ?? []).find((s) => String(s.id) === sid);
    return found?.name || "";
  };

  const qIsNumericSearch = /^\d+$/.test(debouncedQ.trim());
  const serverQ = qIsNumericSearch ? "" : debouncedQ;

  const listQ = useQuery<AdminProduct[]>({
    queryKey: [
      "admin",
      "products",
      "manage",
      {
        q: serverQ,
        statusParam,
        refreshKey,
      },
    ],
    enabled: !!role,
    queryFn: async () => {
      const { data } = await api.get(
        "/api/admin/products",
        {
          ...cookieOpts,
          params: {
            status: statusParam,
            q: serverQ,
            take: 200,
            skip: 0,
            include: "owner,variants,supplierOffers,supplier",
          },
        } as any
      );
      const arr = Array.isArray((data as any)?.data) ? (data as any).data : Array.isArray(data) ? data : [];
      return (arr ?? []) as AdminProduct[];
    },
    staleTime: staleTimeInMs,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    try {
      if (lastSentSearchRef.current === debouncedQ) return;
      lastSentSearchRef.current = debouncedQ;
      setSearch(debouncedQ);
    } catch { }
  }, [debouncedQ, setSearch]);

  useEffect(() => {
    if (listQ.isError) {
      const e: any = listQ.error;
      console.error("Products list failed:", e?.response?.status, e?.response?.data || e?.message);
    }
  }, [listQ.isError, listQ.error]);

  const rows = listQ.data ?? [];

  const validVariantIdsByProduct = useMemo(() => {
    const by: Record<string, Set<string>> = {};
    for (const p of rows) {
      const set = new Set<string>();
      const vars = extractProductVariants(p);
      for (const v of vars) {
        const id = v?.id ?? v?.variantId;
        if (id != null && String(id).trim() !== "") set.add(String(id));
      }
      by[p.id] = set;
    }
    return by;
  }, [rows]);

  const variantIdsHash = useMemo(() => {
    return rows
      .map((p) => {
        const set = validVariantIdsByProduct[p.id];
        const ids = set ? Array.from(set).sort().join(",") : "";
        return `${p.id}:${ids}`;
      })
      .join("|");
  }, [rows, validVariantIdsByProduct]);

  const offersSummaryQ = useQuery({
    queryKey: ["admin", "products", "offers-summary", { ids: rows.map((r) => r.id), variantIdsHash }],
    enabled: !!role && rows.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async () => {
      const productIds = rows.map((r) => r.id);
      if (!productIds.length) return {};

      const qs = new URLSearchParams();
      qs.set("productIds", productIds.join(","));

      const { data } = await api.get(`/api/admin/supplier-offers?${qs}`, cookieOpts);

      const arr = Array.isArray((data as any)?.data) ? (data as any).data : Array.isArray(data) ? data : [];
      const offers = (arr as SupplierOfferLite[]).filter((o) => !!o);

      const byProduct: Record<
        string,
        {
          totalAvailable: number;
          baseAvailable: number;
          variantAvailable: number;
          offerCountTotal: number;
          activeOfferCount: number;
          inStock: boolean;
          perSupplier: Array<{ supplierId: string; supplierName?: string; availableQty: number }>;
          baseSupplierPrice: number;
          variantSupplierPrices: Record<string, number>;
          firstVariantSupplierPrice: number;
        }
      > = {};

      for (const o of offers) {
        const pid = extractOfferProductId(o);
        if (!pid) continue;

        const supplierId = extractOfferSupplierId(o) ?? "";
        const vid = extractOfferVariantId(o);

        const isActive = coerceBool((o as any).isActive, true);
        const isInStock = coerceBool((o as any).inStock, true);
        const availableQty = availOf(o) || toInt((o as any).availableQty, 0) || 0;
        const qtyKnown = hasExplicitQty(o);

        if (!byProduct[pid]) {
          byProduct[pid] = {
            totalAvailable: 0,
            baseAvailable: 0,
            variantAvailable: 0,
            offerCountTotal: 0,
            activeOfferCount: 0,
            perSupplier: [],
            inStock: false,
            baseSupplierPrice: 0,
            variantSupplierPrices: {},
            firstVariantSupplierPrice: 0,
          };
        }

        const s = byProduct[pid];
        s.offerCountTotal += 1;
        if (isActive) s.activeOfferCount += 1;

        const purchasable = isActive && isInStock && (availableQty > 0 || !qtyKnown);

        if (purchasable) {
          s.totalAvailable += availableQty;
          if (vid) s.variantAvailable += availableQty;
          else s.baseAvailable += availableQty;

          s.perSupplier.push({
            supplierId,
            supplierName: (o as any).supplierName,
            availableQty,
          });
        }

        const cost = offerUnitCost(o);
        if (cost == null || !Number.isFinite(cost) || cost <= 0) continue;
        if (!purchasable) continue;

        if (!vid) {
          if (!(s.baseSupplierPrice > 0)) {
            s.baseSupplierPrice = cost;
          }
        } else {
          if (!(s.variantSupplierPrices[vid] > 0)) {
            s.variantSupplierPrices[vid] = cost;
          }
          if (!(s.firstVariantSupplierPrice > 0)) {
            s.firstVariantSupplierPrice = cost;
          }
        }
      }

      Object.values(byProduct).forEach((s) => {
        s.inStock = s.totalAvailable > 0;
      });

      return byProduct;
    },
  });

  function PaginationBar() {
    if (totalRows === 0) return null;

    const from = totalRows === 0 ? 0 : startIndex + 1;
    const to = Math.min(endIndex, totalRows);

    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border bg-white shadow-sm p-3">
        <div className="text-sm text-slate-600">
          Showing <span className="font-medium">{from}</span>–<span className="font-medium">{to}</span> of{" "}
          <span className="font-medium">{totalRows}</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">Rows</label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value) as 10 | 20 | 30 | 50);
                setPage(1);
              }}
              className="rounded-xl border px-3 py-2 text-sm bg-white"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToPage(1)}
              disabled={currentPage === 1}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              First
            </button>

            <button
              type="button"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Prev
            </button>

            <div className="text-sm text-slate-600 px-2">
              Page <span className="font-medium">{currentPage}</span> / <span className="font-medium">{totalPages}</span>
            </div>

            <button
              type="button"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>

            <button
              type="button"
              onClick={() => goToPage(totalPages)}
              disabled={currentPage === totalPages}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Last
            </button>
          </div>
        </div>
      </div>
    );
  }

  const rowsWithDerived: AdminProduct[] = useMemo(() => {
    const summary = (offersSummaryQ.data || {}) as any;

    const pickQty = (p: any, keys: string[]) => {
      for (const k of keys) {
        const v = p?.[k];
        const n = Number(v);
        if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
      }
      return 0;
    };

    return (rows || []).map((p) => {
      const s = summary[p.id];

      const baseQty = pickQty(p as any, ["availableQty", "baseQty", "baseQuantity", "baseAvailableQty"]);
      const offerQty = toInt(s?.totalAvailable ?? 0, 0);
      const finalAvail = baseQty + offerQty;

      const offerCount =
        s != null
          ? toInt(s?.offerCountTotal ?? 0, 0)
          : Array.isArray((p as any)?.supplierOffers)
            ? (p as any).supplierOffers.length
            : 0;

      const inStock = finalAvail > 0;

      const baseSupplierPrice = Number(s?.baseSupplierPrice ?? 0) || 0;
      const firstVariantSupplierPrice = Number(s?.firstVariantSupplierPrice ?? 0) || 0;

      const sourceSupplierPrice =
        baseSupplierPrice > 0 ? baseSupplierPrice : firstVariantSupplierPrice > 0 ? firstVariantSupplierPrice : 0;

      const computedRetailFrom =
        sourceSupplierPrice > 0
          ? computeRetailPriceFromSupplierPrice({
            supplierPrice: sourceSupplierPrice,
            baseServiceFeeNGN,
            commsUnitCostNGN,
            gatewayFeePercent,
            gatewayFixedFeeNGN,
            gatewayFeeCapNGN,
          })
          : 0;

      return {
        ...p,
        supplierName: getSupplierName(p),
        availableQty: finalAvail,
        inStock,
        __baseQty: baseQty,
        __offerQty: offerQty,
        __offerCount: offerCount,
        __bestBaseSupplierPrice: baseSupplierPrice > 0 ? baseSupplierPrice : undefined,
        __bestVariantSupplierPrice: firstVariantSupplierPrice > 0 ? firstVariantSupplierPrice : undefined,
        __computedRetailFrom: computedRetailFrom > 0 ? computedRetailFrom : undefined,
      } as any;
    });
  }, [
    rows,
    offersSummaryQ.data,
    baseServiceFeeNGN,
    commsUnitCostNGN,
    gatewayFeePercent,
    gatewayFixedFeeNGN,
    gatewayFeeCapNGN,
    suppliersQ.data,
  ]);

  type EffectiveStatus = "PUBLISHED" | "PENDING" | "REJECTED" | "ARCHIVED" | "LIVE";
  const getStatus = (p: any): EffectiveStatus => (p?.isDelete || p?.isDeleted ? "ARCHIVED" : (p?.status ?? "PENDING"));

  const statusRank: Record<EffectiveStatus, number> = {
    LIVE: 0,
    PUBLISHED: 1,
    PENDING: 2,
    REJECTED: 3,
    ARCHIVED: 4,
  };

  const updateStatusM = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "PUBLISHED" | "PENDING" | "REJECTED" | "LIVE" }) =>
      (await api.post(`/api/admin/products/${id}/status`, { status }, cookieOpts)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
    onError: (e) =>
      openModal({
        title: "Products",
        message: friendlyErrorMessage(e, "Status update failed"),
      }),
  });

  function isRowEmpty(row: VariantRow) {
    const vals = Object.values(row?.selections || {});
    return vals.length === 0 || vals.every((v) => !String(v || "").trim());
  }

  function findEmptyRowErrors(rows: VariantRow[]): Record<string, string> {
    const errors: Record<string, string> = {};
    rows.forEach((r, idx) => {
      if (isRowEmpty(r)) errors[rowKey(r, idx)] = "Pick at least 1 option (or remove this row).";
    });
    return errors;
  }

  const catsQ = useQuery<AdminCategory[]>({
    queryKey: ["admin", "products", "cats"],
    enabled: !!role,
    queryFn: async () => {
      const attempts = ["/api/admin/categories", "/api/categories", "/api/catalog/categories"];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, cookieOpts);
          const arr = Array.isArray((data as any)?.data) ? (data as any).data : Array.isArray(data) ? data : [];
          if (Array.isArray(arr)) return arr;
        } catch { }
      }
      return [];
    },
    staleTime: staleTimeInMs,
    refetchOnWindowFocus: false,
  });

  const brandsQ = useQuery<AdminBrand[]>({
    queryKey: ["admin", "products", "brands"],
    enabled: !!role,
    queryFn: async () => {
      const attempts = ["/api/admin/brands", "/api/brands"];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, cookieOpts);
          const arr = Array.isArray((data as any)?.data) ? (data as any).data : Array.isArray(data) ? data : [];
          if (Array.isArray(arr)) return arr;
        } catch { }
      }
      return [];
    },
    staleTime: staleTimeInMs,
    refetchOnWindowFocus: false,
  });

  const attrsQ = useQuery<AdminAttribute[]>({
    queryKey: ["admin", "products", "attributes"],
    enabled: !!role,
    queryFn: async () => {
      const attempts = ["/api/admin/attributes", "/api/attributes"];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, cookieOpts);
          const arr = Array.isArray((data as any)?.data) ? (data as any).data : Array.isArray(data) ? data : [];
          if (Array.isArray(arr)) return arr;
        } catch { }
      }
      return [];
    },
    staleTime: staleTimeInMs,
    refetchOnWindowFocus: false,
  });

  const createM = useMutation({
    mutationFn: async (payload: any) => (await api.post("/api/admin/products", payload, cookieOpts)).data,
    onError: (e) => {
      setSaveBanner(friendlyErrorMessage(e, "Create failed"));
      restoreSnapshot();
      openModal({ title: "Products", message: friendlyErrorMessage(e, "Create failed") });
    },
  });

  const updateM = useMutation({
    mutationFn: async ({ id, ...payload }: any) => (await api.patch(`/api/admin/products/${id}`, payload, cookieOpts)).data,
    onError: (e) => {
      setSaveBanner(friendlyErrorMessage(e, "Update failed"));
      restoreSnapshot();
      openModal({ title: "Products", message: friendlyErrorMessage(e, "Update failed") });
    },
  });

  const restoreM = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/api/admin/products/${encodeURIComponent(id)}/restore`, {}, cookieOpts);
      return (res as any).data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] });
    },
    onError: (e) =>
      openModal({
        title: "Products",
        message: friendlyErrorMessage(e, "Restore failed"),
      }),
  });

  async function ensureHasOrdersSupport(sampleId: string) {
    if (hasOrdersSupportRef.current !== "unknown") return hasOrdersSupportRef.current;
    if (hasOrdersProbeDoneRef.current) return hasOrdersSupportRef.current;

    hasOrdersProbeDoneRef.current = true;

    try {
      await api.get(`/api/admin/products/${encodeURIComponent(sampleId)}/has-orders`, cookieOpts);
      hasOrdersSupportRef.current = "supported";
      return "supported" as const;
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 404) {
        hasOrdersSupportRef.current = "unsupported";
        return "unsupported" as const;
      }
      hasOrdersSupportRef.current = "supported";
      return "supported" as const;
    }
  }

  const hasOrdersQ = useQuery<Record<string, boolean>>({
    queryKey: ["admin", "products", "has-orders", { ids: (rowsWithDerived ?? []).map((r) => r.id) }],
    enabled: !!role && rowsWithDerived.length > 0 && hasOrdersSupportRef.current !== "unsupported",
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async () => {
      const ids = rowsWithDerived.map((r) => r.id);
      if (!ids.length) return {};

      const support = await ensureHasOrdersSupport(ids[0]);
      if (support === "unsupported") return Object.fromEntries(ids.map((id) => [id, false] as const));

      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const { data } = await api.get(`/api/admin/products/${encodeURIComponent(id)}/has-orders`, cookieOpts);
            const has =
              typeof data === "boolean"
                ? data
                : typeof (data as any)?.hasOrders === "boolean"
                  ? (data as any)?.hasOrders
                  : typeof (data as any)?.data?.hasOrders === "boolean"
                    ? (data as any).data.hasOrders
                    : typeof (data as any)?.has === "boolean"
                      ? (data as any).has
                      : typeof (data as any)?.data?.has === "boolean"
                        ? (data as any).data.has
                        : false;

            return [id, has] as const;
          } catch (e: any) {
            const status = e?.response?.status;
            if (status === 404) {
              hasOrdersSupportRef.current = "unsupported";
              return [id, false] as const;
            }
            return [id, false] as const;
          }
        })
      );

      return Object.fromEntries(results);
    },
  });

  const hasOrder = (productId: string) => !!hasOrdersQ.data?.[productId];

  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      let has = hasOrder(id);

      if (hasOrdersSupportRef.current === "unsupported") {
        has = false;
      } else if (hasOrdersQ.isLoading || hasOrdersQ.data == null) {
        const support = await ensureHasOrdersSupport(id);
        if (support === "unsupported") {
          has = false;
        } else {
          try {
            const { data } = await api.get(`/api/admin/products/${encodeURIComponent(id)}/has-orders`, cookieOpts);
            has = !!((data as any)?.data?.has ?? (data as any)?.has ?? data);
          } catch (e: any) {
            const status = e?.response?.status;
            if (status === 404) hasOrdersSupportRef.current = "unsupported";
            has = false;
          }
        }
      }

      const url = has ? `/api/admin/products/${id}/soft-delete` : `/api/admin/products/${id}`;
      const res = await api.delete(url, cookieOpts);
      return (res as any).data?.data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] });
    },
  });

  const defaultPending: PendingState = {
    title: "",
    supplierPrice: "",
    retailPrice: "",
    status: "PENDING",
    categoryId: "",
    brandId: "",
    supplierId: "",
    supplierAvailableQty: "",
    sku: "",
    imageUrls: "",
    description: "",

    freeShipping: false,
    fragile: false,
    oversized: false,

    shippingClass: "",

    weightKg: "",
    weightGrams: "",

    lengthCm: "",
    widthCm: "",
    heightCm: "",
  };

  const [offersProductId, setOffersProductId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const allSelectableAttrs = useMemo(
    () => (attrsQ.data || []).filter((a) => a.type === "SELECT" && a.isActive),
    [attrsQ.data]
  );

  const [pending, setPending] = useState<PendingState>(defaultPending);

  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);
  const [offerVariants, setOfferVariants] = useState<any[]>([]);
  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string | string[]>>({});
  const [variantsDirty, setVariantsDirty] = useState(false);
  const [clearAllVariantsIntent, setClearAllVariantsIntent] = useState(false);
  const initialVariantIdsRef = useRef<Set<string>>(new Set());

  function isRealVariantId(id?: string) {
    return (
      !!id &&
      !id.startsWith("vr-") &&
      !id.startsWith("new-") &&
      !id.startsWith("temp-") &&
      !id.startsWith("tmp:") &&
      !id.startsWith("tmp-")
    );
  }

  const enabledSelectableAttrs = useMemo(() => {
    const enabledIds = new Set(Object.keys(selectedAttrs || {}));
    return allSelectableAttrs.filter((a) => enabledIds.has(String(a.id)));
  }, [allSelectableAttrs, selectedAttrs]);

  useEffect(() => {
    const ids = enabledSelectableAttrs.map((a) => a.id);

    setVariantRows((rows) => {
      let changed = false;

      const nextRows = rows.map((row) => {
        const nextSelections: Record<string, string> = {};
        ids.forEach((id) => {
          nextSelections[id] = row.selections[id] || "";
        });

        const prevKeys = Object.keys(row.selections || {}).sort().join("|");
        const nextKeys = Object.keys(nextSelections).sort().join("|");

        const sameValues =
          prevKeys === nextKeys &&
          ids.every((id) => String(row.selections?.[id] || "") === String(nextSelections[id] || ""));

        if (sameValues) return row;

        changed = true;
        return { ...row, selections: nextSelections };
      });

      return changed ? nextRows : rows;
    });
  }, [enabledSelectableAttrs]);

  const DRAFT_KEY = useMemo(() => `adminProductDraft:${editingId ?? "new"}`, [editingId]);
  const skipDraftLoadRef = useRef(false);

  useEffect(() => {
    if (skipDraftLoadRef.current) return;
    if (showEditor && editingId) return;

    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;

    try {
      const d = JSON.parse(raw);
      if (d?.pending) setPending({ ...defaultPending, ...d.pending });
      if (Array.isArray(d?.variantRows)) setVariantRows(d.variantRows);
      if (d?.selectedAttrs) setSelectedAttrs(d.selectedAttrs);
    } catch { }
  }, [DRAFT_KEY, showEditor, editingId]);

  useEffect(() => {
    if (!showEditor) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ pending, variantRows, selectedAttrs }));
  }, [DRAFT_KEY, pending, variantRows, selectedAttrs, showEditor]);

  const lockedVariantIdsQ = useQuery<string[]>({
    queryKey: ["admin", "products", "locked-variant-ids", { productId: editingId, supplierId: pending.supplierId }],
    enabled: !!role && !!editingId,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async () => {
      const offers = await fetchSupplierOffersForProduct(editingId!);
      const supplierId = (pending.supplierId || "").trim();

      const locked = new Set<string>();
      for (const o of offers) {
        const sid = extractOfferSupplierId(o);
        if (!supplierId || !sid || String(sid) !== String(supplierId)) continue;

        const vid = extractOfferVariantId(o);
        if (vid) locked.add(vid);
      }
      return Array.from(locked);
    },
  });

  const lockedVariantIds = useMemo(() => new Set<string>(lockedVariantIdsQ.data ?? []), [lockedVariantIdsQ.data]);

  function offerVariantPrice(o: any): number | null {
    if (!o) return null;

    const directKeys = [
      "offerPrice",
      "variantPrice",
      "variantUnitPrice",
      "variantCost",
      "variantAmount",
      "price",
      "unitPrice",
      "unitCost",
      "cost",
      "amount",
      "supplierPrice",
      "basePrice",
    ];

    for (const k of directKeys) {
      const n = toNumberLoose((o as any)?.[k]);
      if (n != null) return n;
    }

    const nested = [
      (o as any)?.pricing?.variantPrice,
      (o as any)?.pricing?.price,
      (o as any)?.pricing?.unitPrice,
      (o as any)?.pricing?.unitCost,
      (o as any)?.variant?.price,
      (o as any)?.variant?.unitPrice,
      (o as any)?.amount?.amount,
      (o as any)?.price?.amount,
      (o as any)?.unitCost?.amount,
    ];

    for (const v of nested) {
      const n = toNumberLoose(v);
      if (n != null) return n;
    }

    return offerUnitCost(o);
  }

  function skuSafePart(input: any) {
    const s = String(input ?? "")
      .trim()
      .toUpperCase()
      .replace(/&/g, " AND ")
      .replace(/['"]/g, "")
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return s;
  }

  const offerPriceCapsQ = useQuery<{
    basePrice: number;
    variantPriceByVariant: Record<string, number>;
    firstVariantPrice: number;
  }>({
    queryKey: ["admin", "products", "offer-price-caps", { productId: editingId, supplierId: pending.supplierId }],
    enabled: !!role && !!editingId,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async () => {
      const supplierId = (pending.supplierId || "").trim();
      if (!editingId || !supplierId) {
        return { basePrice: 0, variantPriceByVariant: {}, firstVariantPrice: 0 };
      }

      const offers = await fetchSupplierOffersForProduct(editingId);

      let basePrice = 0;
      const variantPriceByVariant: Record<string, number> = {};
      let firstVariantPrice = 0;

      for (const o of offers ?? []) {
        const pid = extractOfferProductId(o);
        if (pid && String(pid) !== String(editingId)) continue;

        const sid = extractOfferSupplierId(o);
        if (!sid || String(sid) !== String(supplierId)) continue;

        const isActive = coerceBool((o as any).isActive, true);
        const isInStock = coerceBool((o as any).inStock, true);
        const qty = availOf(o) || 0;
        const qtyKnown = hasExplicitQty(o);
        const purchasable = isActive && isInStock && (qty > 0 || !qtyKnown);
        if (!purchasable) continue;

        const variantId = extractOfferVariantId(o);
        const cost = offerVariantPrice(o);
        if (cost == null || !Number.isFinite(cost) || cost <= 0) continue;

        if (!variantId) {
          if (!(basePrice > 0)) {
            basePrice = cost;
          }
          continue;
        }

        if (!(variantPriceByVariant[variantId] > 0)) {
          variantPriceByVariant[variantId] = cost;
        }

        if (!(firstVariantPrice > 0)) {
          firstVariantPrice = cost;
        }
      }

      return {
        basePrice,
        variantPriceByVariant,
        firstVariantPrice,
      };
    },
  });

  const offerPriceCaps =
    offerPriceCapsQ.data ?? {
      basePrice: 0,
      variantPriceByVariant: {} as Record<string, number>,
      firstVariantPrice: 0,
    };

  const baseComboKey = useMemo(() => {
    const attrs = (enabledSelectableAttrs || []).map((a) => ({ id: a.id, name: a.name }));
    return buildBaseComboKeyFromSelectedAttrs(selectedAttrs, attrs);
  }, [enabledSelectableAttrs, selectedAttrs]);

  const visibleVariantRows = useMemo(() => {
    const rows = Array.isArray(variantRows) ? variantRows : [];
    return rows.filter((r) => {
      const id = String(r?.id ?? "").trim();
      return !!id;
    });
  }, [variantRows]);

  const comboErrors = useMemo(() => {
    const dup = findDuplicateCombos(visibleVariantRows ?? [], enabledSelectableAttrs ?? []);
    const baseConf = findBaseVsVariantConflicts(visibleVariantRows ?? [], enabledSelectableAttrs ?? [], baseComboKey);

    return { ...dup, ...baseConf };
  }, [visibleVariantRows, enabledSelectableAttrs, baseComboKey]);

  const baseComboConflictMessage = useMemo(() => {
    if (!baseComboKey) return "";

    const attrs = enabledSelectableAttrs ?? [];
    const hasConflict = (visibleVariantRows ?? []).some((r) => {
      const ck = buildComboKey(r, attrs);
      return !!ck && ck === baseComboKey;
    });

    return hasConflict
      ? "A variant already uses this same base attribute combination. Change the base defaults or change the duplicate variant."
      : "";
  }, [baseComboKey, visibleVariantRows, enabledSelectableAttrs]);

  const hasDuplicateCombos = Object.keys(comboErrors).length > 0;
  const emptyRowErrors = useMemo(() => findEmptyRowErrors(visibleVariantRows ?? []), [visibleVariantRows]);

  const computedRetailFromCreateInput = useMemo(() => {
    if (editingId) return null;

    const supplierPrice = Number(pending.supplierPrice) || 0;
    if (supplierPrice <= 0) return null;

    return computeRetailPriceFromSupplierPrice({
      supplierPrice,
      baseServiceFeeNGN,
      commsUnitCostNGN,
      gatewayFeePercent,
      gatewayFixedFeeNGN,
      gatewayFeeCapNGN,
    });
  }, [
    editingId,
    pending.supplierPrice,
    baseServiceFeeNGN,
    commsUnitCostNGN,
    gatewayFeePercent,
    gatewayFixedFeeNGN,
    gatewayFeeCapNGN,
  ]);

  const computedRetailFromEditing = useMemo(() => {
    if (!editingId) return null;

    const basePrice = Number(offerPriceCaps?.basePrice ?? 0) || 0;
    const firstVariantPrice = Number(offerPriceCaps?.firstVariantPrice ?? 0) || 0;

    const sourceSupplierPrice =
      basePrice > 0 ? basePrice : firstVariantPrice > 0 ? firstVariantPrice : 0;

    if (sourceSupplierPrice <= 0) return null;

    return computeRetailPriceFromSupplierPrice({
      supplierPrice: sourceSupplierPrice,
      baseServiceFeeNGN,
      commsUnitCostNGN,
      gatewayFeePercent,
      gatewayFixedFeeNGN,
      gatewayFeeCapNGN,
    });
  }, [
    editingId,
    offerPriceCaps?.basePrice,
    offerPriceCaps?.firstVariantPrice,
    baseServiceFeeNGN,
    commsUnitCostNGN,
    gatewayFeePercent,
    gatewayFixedFeeNGN,
    gatewayFeeCapNGN,
  ]);

  useEffect(() => {
    if (editingId) {
      if (computedRetailFromEditing == null) return;

      const next = String(computedRetailFromEditing);
      setPending((p) => (p.retailPrice === next ? p : { ...p, retailPrice: next }));
      return;
    }

    if (computedRetailFromCreateInput == null) {
      setPending((p) => (p.retailPrice === "" ? p : { ...p, retailPrice: "" }));
      return;
    }

    const next = String(computedRetailFromCreateInput);
    setPending((p) => (p.retailPrice === next ? p : { ...p, retailPrice: next }));
  }, [editingId, computedRetailFromEditing, computedRetailFromCreateInput]);

  const parseUrlList = (s: string) =>
    s
      .split(/[\n,]/g)
      .map((t) => t.trim())
      .filter(Boolean);

  const isUrlish = (s?: string) => !!s && /^(https?:\/\/|data:image\/|\/)/i.test(s);

  const toArray = (x: any): any[] => (Array.isArray(x) ? x : x == null ? [] : [x]);

  function extractImageUrls(p: any): string[] {
    if (Array.isArray(p?.imagesJson)) return p.imagesJson.filter(isUrlish);
    if (typeof p?.imagesJson === "string") {
      try {
        const arr = JSON.parse(p.imagesJson);
        if (Array.isArray(arr)) return arr.filter(isUrlish);
      } catch {
        return p.imagesJson
          .split(/[\n,]/g)
          .map((t: string) => t.trim())
          .filter(isUrlish);
      }
    }
    const cands = [...(toArray(p?.imageUrls) as string[]), ...(toArray(p?.images) as string[]), p?.image, p?.primaryImage, p?.coverUrl].filter(Boolean);
    return cands.filter(isUrlish);
  }

  const filePickRef = useRef<HTMLInputElement | null>(null);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [uploadInfo, setUploadInfo] = useState<string>("");
  const [isRefreshingProduct, setIsRefreshingProduct] = useState(false);
  const [saveBanner, setSaveBanner] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const lastSaveSnapshotRef = useRef<{
    pending: typeof defaultPending;
    selectedAttrs: Record<string, string | string[]>;
    variantRows: VariantRow[];
  } | null>(null);

  function snapshotBeforeSave() {
    lastSaveSnapshotRef.current = {
      pending: { ...pending },
      selectedAttrs: JSON.parse(JSON.stringify(selectedAttrs || {})),
      variantRows: JSON.parse(JSON.stringify(variantRows || [])),
    };
  }

  function restoreSnapshot() {
    const snap = lastSaveSnapshotRef.current;
    if (!snap) return;
    setPending(snap.pending);
    setSelectedAttrs(snap.selectedAttrs);
    setVariantRows(snap.variantRows);
  }

  function clearSaveUiErrors() {
    setSaveBanner(null);
    setFieldErrors({});
  }

  async function refreshEditingProduct() {
    const pid = editingId;
    if (!pid) return;

    setIsRefreshingProduct(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin", "settings", "pricing-public"] }),
        qc.invalidateQueries({ queryKey: ["admin", "products", "locked-variant-ids", { productId: pid }] }),
        qc.invalidateQueries({ queryKey: ["admin", "products", "offers-summary"] }),
        qc.invalidateQueries({ queryKey: ["admin", "products", "offer-price-caps", { productId: pid }] }),
        qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] }),
        qc.invalidateQueries({ queryKey: ["admin", "product", pid, "variants"] }),
        qc.invalidateQueries({ queryKey: ["admin", "products", pid, "supplier-offers"] }),
      ]);

      const refreshed = await fetchProductFull(pid);

      const nextRowsRaw = buildVariantRowsFromServerVariants(refreshed.variants || []);
      const nextRows = dedupeVariantRowsByCombo(nextRowsRaw, enabledSelectableAttrs);

      setVariantRows(nextRows);
      initialVariantIdsRef.current = new Set(
        nextRows.map((r) => r.id).filter((id) => isRealVariantId(id))
      );

      setOfferVariants(refreshed.variants || []);
      setOffersProductId(refreshed.id);

      const attrTypeById = new Map<string, AdminAttribute["type"]>();
      for (const a of attrsQ.data || []) {
        attrTypeById.set(String(a.id), a.type);
      }

      const rebuiltSel: Record<string, string | string[]> = {};

      (refreshed.enabledAttributeRows || []).forEach((row: any) => {
        const aid = String(row?.attributeId ?? row?.attribute?.id ?? "").trim();
        if (!aid) return;

        const attrType = row?.attribute?.type ?? attrTypeById.get(aid);
        if (!(aid in rebuiltSel)) {
          rebuiltSel[aid] = attrType === "MULTISELECT" ? [] : "";
        }
      });

      (refreshed.attributeValues || []).forEach((av: any) => {
        const aid = String(av?.attributeId ?? av?.attribute?.id ?? "").trim();
        const vid = String(av?.valueId ?? av?.value?.id ?? "").trim();
        if (!aid) return;

        const attrType = av?.attribute?.type ?? attrTypeById.get(aid);

        if (!(aid in rebuiltSel)) {
          rebuiltSel[aid] = attrType === "MULTISELECT" ? [] : "";
        }

        if (!vid) return;

        if (attrType === "MULTISELECT") {
          const prev = Array.isArray(rebuiltSel[aid]) ? rebuiltSel[aid] : [];
          const list = prev.map((x) => String(x).trim()).filter(Boolean);
          if (!list.includes(vid)) list.push(vid);
          rebuiltSel[aid] = list;
        } else if (!String(rebuiltSel[aid] ?? "").trim()) {
          rebuiltSel[aid] = vid;
        }
      });

      (refreshed.attributeTexts || []).forEach((at: any) => {
        const aid = String(at?.attributeId ?? at?.attribute?.id ?? "").trim();
        if (!aid) return;
        rebuiltSel[aid] = String(at?.value ?? "");
      });

      setSelectedAttrs(rebuiltSel);

      setPending((p) => ({
        ...p,
        title: refreshed.title ?? p.title,
        status: refreshed.status ?? p.status,
        sku: refreshed.sku ?? p.sku,
        categoryId: refreshed.categoryId ?? p.categoryId,
        brandId: refreshed.brandId ?? p.brandId,
        supplierId: normalizeNullableId(refreshed.supplierId) ?? p.supplierId,
        description: refreshed.description ?? p.description,
        imageUrls: (extractImageUrls(refreshed) || []).join("\n"),
        ...pickShippingStateFromProduct(refreshed),
      }));
    } catch (e: any) {
      openModal({ title: "Refresh product", message: friendlyErrorMessage(e, "Failed to refresh product") });
    } finally {
      setIsRefreshingProduct(false);
    }
  }

  function extractUploadUrls(payload: any): string[] {
    const root = payload?.data?.data ?? payload?.data ?? payload;

    if (typeof root === "string") return isUrlish(root) ? [root] : [];
    if (Array.isArray(root)) {
      const strings = root.filter((x) => typeof x === "string" && isUrlish(x)) as string[];
      if (strings.length) return strings;

      const objs = root.filter((x) => x && typeof x === "object") as any[];
      const fromObjs = objs
        .map((o) => o?.url || o?.secure_url || o?.location || o?.path)
        .filter((u) => typeof u === "string" && isUrlish(u)) as string[];
      return fromObjs;
    }

    const one = root?.url || root?.secure_url || root?.location || root?.path;
    if (typeof one === "string" && isUrlish(one)) return [one];

    const many = root?.urls || root?.files || root?.items;
    if (Array.isArray(many)) {
      const fromMany = many
        .map((o: any) => (typeof o === "string" ? o : o?.url || o?.secure_url || o?.location || o?.path))
        .filter((u: any) => typeof u === "string" && isUrlish(u)) as string[];
      return fromMany;
    }

    return [];
  }

  async function uploadImages(files: FileList | File[]) {
    const arr = Array.from(files || []).filter(Boolean);
    if (!arr.length) return;

    setIsUploadingImages(true);
    setUploadInfo(`Uploading 0/${arr.length}…`);

    const uploaded: string[] = [];

    try {
      const fieldName = arr.length === 1 ? "file" : "files";

      const fd = new FormData();
      for (const f of arr) fd.append(fieldName, f);

      const res = await api.post("/api/uploads", fd, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" },
      });

      const urls = extractUploadUrls(res?.data ?? res);
      if (!urls.length) throw new Error("Upload succeeded but API did not return image URL(s).");

      uploaded.push(...urls);

      setPending((p) => {
        const existing = parseUrlList(p.imageUrls || "");
        const next = [...existing, ...uploaded].filter(isUrlish);
        return { ...p, imageUrls: next.join("\n") };
      });

      setUploadInfo(`Uploaded ${uploaded.length} image(s).`);
    } catch (e: any) {
      openModal({ title: "Images", message: friendlyErrorMessage(e, "Image upload failed") });
      setUploadInfo("");
    } finally {
      setIsUploadingImages(false);
      if (filePickRef.current) filePickRef.current.value = "";
    }
  }

  function makeTempRowId() {
    return `tmp:${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function touchVariants() {
    setVariantsDirty(true);
  }

  function makeEmptySelections() {
    const selections: Record<string, string> = {};
    (enabledSelectableAttrs || []).forEach((a) => (selections[a.id] = ""));
    return selections;
  }

  function addVariantCombo() {
    if (hasDuplicateCombos) {
      openModal({ title: "Variants", message: "Fix duplicate variant combinations before saving." });
      return;
    }
    const row: VariantRow = {
      id: makeTempRowId(),
      selections: makeEmptySelections(),
      inStock: true,
      availableQty: 0,
      imagesJson: [],
    };

    setVariantRows((prev) => [...(Array.isArray(prev) ? prev : []), row]);
    touchVariants();
  }

  function removeVariantRow(rowId: string) {
    const rid = String(rowId || "").trim();
    if (!rid) return;

    if (isRealVariantId(rid) && lockedVariantIds.has(rid)) {
      openModal({
        title: "Cannot remove variant in use",
        message: "This variant is linked to supplier offers. Remove/disable the supplier offers first, or keep this variant.",
      });
      return;
    }

    setVariantRows((prev) => {
      const rows = Array.isArray(prev) ? prev : [];
      return rows.filter((r) => String(r?.id) !== rid);
    });

    touchVariants();
  }

  function setVariantRowSelection(rowId: string, attributeId: string, valueId: string | null) {
    const rid = String(rowId || "").trim();
    const aid = String(attributeId || "").trim();
    const vid = valueId == null ? "" : String(valueId).trim();

    if (!rid || !aid) return;

    setVariantRows((prev) => {
      const rows = Array.isArray(prev) ? prev : [];
      return rows.map((r) =>
        String(r?.id) !== rid
          ? r
          : {
            ...r,
            selections: { ...(r.selections || {}), [aid]: vid },
          }
      );
    });

    touchVariants();
  }

  function computedVariantRetail(row: VariantRow) {
    const vid = String(row?.id ?? "").trim();

    const supplierVariantPrice =
      vid && isRealVariantId(vid)
        ? Number(offerPriceCaps.variantPriceByVariant?.[vid] ?? 0) || 0
        : 0;

    if (editingId) {
      if (supplierVariantPrice > 0) {
        const retail = computeRetailPriceFromSupplierPrice({
          supplierPrice: supplierVariantPrice,
          baseServiceFeeNGN,
          commsUnitCostNGN,
          gatewayFeePercent,
          gatewayFixedFeeNGN,
          gatewayFeeCapNGN,
        });

        return {
          variantRetail: retail,
          supplierVariantCost: supplierVariantPrice,
          hasComputed: true,
        };
      }

      return {
        variantRetail: -1,
        supplierVariantCost: 0,
        hasComputed: false,
      };
    }

    return {
      variantRetail: -1,
      supplierVariantCost: 0,
      hasComputed: false,
    };
  }

  function buildBaseComboKeyFromSelectedAttrs(
    selectedAttrs: Record<string, string | string[]>,
    attrs: AttrDef[]
  ): string {
    const parts: string[] = [];

    for (const a of attrs || []) {
      const raw = selectedAttrs?.[a.id];
      const valueId = Array.isArray(raw)
        ? String(raw[0] ?? "").trim()
        : String(raw ?? "").trim();

      if (!valueId) continue;
      parts.push(`${a.id}:${valueId}`);
    }

    if (!parts.length) return "";
    return parts.join("|");
  }

  function findBaseVsVariantConflicts(
    rows: VariantRow[],
    attrs: AttrDef[],
    baseComboKey: string
  ): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!baseComboKey) return errors;

    rows.forEach((r, idx) => {
      const ck = buildComboKey(r, attrs);
      if (!ck) return;
      if (ck === baseComboKey) {
        errors[rowKey(r, idx)] = "This variant combo duplicates the BASE combo. Change the selections.";
      }
    });

    return errors;
  }

  async function fetchProductFull(id: string) {
    const { data } = await api.get(
      `/api/admin/products/${id}`,
      {
        ...cookieOpts,
        params: { include: "variants,attributes,brand,supplier,owner" },
      } as any
    );

    const prod = (data as any)?.data?.data ?? (data as any)?.data ?? data ?? {};

    const rawVariants =
      (Array.isArray(prod?.variants) && prod.variants) ||
      (Array.isArray(prod?.ProductVariant) && prod.ProductVariant) ||
      (Array.isArray(prod?.productVariants) && prod.productVariants) ||
      [];

    const pickFirstArray = (...cands: any[]): any[] => {
      for (const c of cands) {
        if (Array.isArray(c) && c.length) return c;
      }
      for (const c of cands) {
        if (Array.isArray(c)) return c;
      }
      return [];
    };

    const variantsNormalized = (rawVariants || []).map((v: any) => {
      const vid =
        normalizeNullableId(v?.id) ||
        normalizeNullableId(v?.variantId) ||
        normalizeNullableId(v?.variant?.id);

      const pickedOptions = pickFirstArray(
        v?.options,
        v?.optionSelections,
        v?.attributes,
        v?.attributeSelections,
        v?.ProductVariantOption,
        v?.ProductVariantOptions,
        v?.productVariantOptions,
        v?.variantOptions,
        v?.VariantOption,
        v?.VariantOptions
      );

      const next: any = { ...v, id: vid || v?.id };
      if (pickedOptions.length > 0) next.options = pickedOptions;
      return next;
    });

    const attributeValues =
      pickFirstArray(
        prod?.attributes?.options,
        prod?.attributeValues,
        prod?.attributeOptions,
        prod?.ProductAttributeOption,
        prod?.productAttributeOptions
      ) || [];

    const attributeTexts =
      pickFirstArray(
        prod?.attributes?.texts,
        prod?.attributeTexts,
        prod?.ProductAttributeText,
        prod?.productAttributeTexts
      ) || [];

    let enabledAttributeRows: ProductAttributeEnabledRow[] =
      pickFirstArray(
        prod?.attributes?.enabled,
        prod?.enabledAttributes,
        prod?.productAttributes,
        prod?.ProductAttribute
      ) || [];

    if (!enabledAttributeRows.length) {
      const byId = new Map<string, ProductAttributeEnabledRow>();

      const addEnabled = (row: any) => {
        const attributeId = String(
          row?.attributeId ??
          row?.attribute?.id ??
          ""
        ).trim();

        if (!attributeId || byId.has(attributeId)) return;

        const fallbackAttr = (attrsQ.data || []).find((a) => String(a.id) === attributeId);

        byId.set(attributeId, {
          attributeId,
          attribute: {
            id: attributeId,
            name:
              row?.attribute?.name ??
              fallbackAttr?.name ??
              undefined,
            type:
              row?.attribute?.type ??
              fallbackAttr?.type ??
              undefined,
            isActive:
              row?.attribute?.isActive ??
              fallbackAttr?.isActive ??
              true,
          },
        });
      };

      (attributeValues || []).forEach(addEnabled);
      (attributeTexts || []).forEach(addEnabled);

      enabledAttributeRows = Array.from(byId.values());
    }

    const supplierId =
      normalizeNullableId(prod?.supplierId) ||
      normalizeNullableId(prod?.supplier?.id) ||
      null;

    const imagesJson =
      Array.isArray(prod?.imagesJson)
        ? prod.imagesJson
        : typeof prod?.imagesJson === "string"
          ? (() => {
            try {
              const parsed = JSON.parse(prod.imagesJson);
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          })()
          : [];

    return {
      ...prod,
      variants: variantsNormalized,
      variantsNormalized,
      supplierId,
      imagesJson,
      enabledAttributeRows,
      attributeValues,
      attributeTexts,
    };
  }

  function buildVariantRowsFromServerVariants(fullVariants: any[]): VariantRow[] {
    const vr: VariantRow[] = [];

    const pickFirstArray = (...cands: any[]): any[] => {
      for (const c of cands) if (Array.isArray(c) && c.length) return c;
      for (const c of cands) if (Array.isArray(c)) return c;
      return [];
    };

    for (const v of fullVariants || []) {
      const selections: Record<string, string> = makeEmptySelections();

      const opts = pickFirstArray(
        v?.options,
        v?.optionSelections,
        v?.attributes,
        v?.attributeSelections,
        v?.ProductVariantOption,
        v?.ProductVariantOptions,
        v?.productVariantOptions,
        v?.variantOptions,
        v?.VariantOption,
        v?.VariantOptions
      );

      for (const o of opts || []) {
        const attrId = o?.attributeId ?? o?.attribute?.id;
        const valueId = o?.valueId ?? o?.value?.id;
        if (attrId && valueId) selections[String(attrId)] = String(valueId);
      }

      const hasAnyPick = Object.values(selections).some((x) => !!String(x || "").trim());
      if (!hasAnyPick) continue;

      const id = normalizeNullableId(v?.id) || normalizeNullableId(v?.variantId) || normalizeNullableId(v?.variant?.id);
      if (!id) continue;

      vr.push({
        id: String(id),
        selections,
        inStock: coerceBool(v?.inStock, true),
        availableQty: toInt(v?.availableQty ?? v?.available ?? v?.qty ?? v?.stock, 0),
        imagesJson: Array.isArray(v?.imagesJson) ? v.imagesJson : [],
      });
    }

    return vr;
  }

  const imagePreviewUrls = useMemo(() => parseUrlList(pending.imageUrls || "").filter(isUrlish), [pending.imageUrls]);

  function removeImageUrl(url: string) {
    const u = String(url || "").trim();
    if (!u) return;

    const next = imagePreviewUrls.filter((x) => x !== u);
    setPending((p) => ({ ...p, imageUrls: next.join("\n") }));
  }

  async function loadOfferVariants(productId: string) {
    try {
      const full = await fetchProductFull(productId);
      setOfferVariants((full as any).variants || (full as any).variantsNormalized || []);
    } catch (e) {
      console.error(e);
      alert("Could not load product variants for offers.");
    }
  }

  function validateRetailAboveSupplierPrices(args: {
    baseRetail: number;
    variantRows: VariantRow[];
    caps: {
      basePrice: number;
      variantPriceByVariant: Record<string, number>;
      firstVariantPrice: number;
    };
  }) {
    const errors: string[] = [];

    const computedBaseRetail =
      args.caps.basePrice > 0
        ? computeRetailPriceFromSupplierPrice({
          supplierPrice: args.caps.basePrice,
          baseServiceFeeNGN,
          commsUnitCostNGN,
          gatewayFeePercent,
          gatewayFixedFeeNGN,
          gatewayFeeCapNGN,
        })
        : 0;

    if (
      args.caps.basePrice > 0 &&
      Number(args.baseRetail || 0) > 0 &&
      Number(args.baseRetail) < computedBaseRetail
    ) {
      errors.push(
        `Base retail (₦${Number(args.baseRetail).toLocaleString()}) cannot be below computed retail from supplier base price (₦${computedBaseRetail.toLocaleString()}).`
      );
    }

    return {
      ok: errors.length === 0,
      errors,
    };
  }

  function dedupeVariantRowsByCombo(rows: VariantRow[], attrs: AttrDef[]) {
    const byKey = new Map<string, VariantRow>();

    for (const r of rows) {
      const k = buildComboKey(r, attrs) || `__id:${r.id}`;
      const prev = byKey.get(k);

      if (!prev) byKey.set(k, r);
      else if (!isRealVariantId(prev.id) && isRealVariantId(r.id)) byKey.set(k, r);
    }

    return Array.from(byKey.values());
  }

  function shouldReplaceVariants(args: { variantRows: any[] | undefined; initialVariantIds: Set<string>; clearAllVariantsIntent: boolean }) {
    const { variantRows, initialVariantIds, clearAllVariantsIntent } = args;

    if (clearAllVariantsIntent) return true;

    const currentIds = new Set(
      (variantRows ?? [])
        .map((r: any) => String(r?.id ?? "").trim())
        .filter((id: string) => !!id && id !== "NEW" && id !== "TEMP")
    );

    for (const id of initialVariantIds) {
      if (!currentIds.has(id)) return true;
    }

    return false;
  }

  function summarizeBaseProductDefaults(
    selectedAttrs: Record<string, string | string[]>,
    attrs: AdminAttribute[]
  ) {
    const lines: Array<{ attributeId: string; label: string; value: string }> = [];

    const toIds = (raw: string | string[] | undefined | null) => {
      if (Array.isArray(raw)) {
        return raw.map((v) => String(v ?? "").trim()).filter(Boolean);
      }

      const s = String(raw ?? "").trim();
      if (!s) return [];

      return s
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    };

    for (const a of attrs || []) {
      if (!(a.id in selectedAttrs)) continue;

      const raw = selectedAttrs[a.id];

      if (a.type === "TEXT") {
        const text = String(raw ?? "").trim();
        if (text) {
          lines.push({
            attributeId: a.id,
            label: a.name,
            value: text,
          });
        }
        continue;
      }

      const ids = toIds(raw);
      if (!ids.length) continue;

      const names = ids.map((id) => {
        const match = a.values?.find((v) => String(v.id) === id);
        return String(match?.name ?? match?.code ?? id);
      });

      if (!names.length) continue;

      lines.push({
        attributeId: a.id,
        label: a.name,
        value: a.type === "SELECT" ? names[0] : names.join(", "),
      });
    }

    return lines;
  }

  function buildProductPayload({
    base,
    selectedAttrs,
    variantRows,
    attrsAll,
  }: {
    base: {
      title: string;
      status: string;
      categoryId?: string;
      brandId?: string;
      supplierId?: string;
      imagesJson?: string[];
      description?: string | null;
      ownerId?: string | null;
      availableQty?: number;
      inStock?: boolean;
      retailPrice?: number;
      [key: string]: any;
    };
    selectedAttrs: Record<string, string | string[]>;
    variantRows: VariantRow[];
    attrsAll: AdminAttribute[];
  }) {
    const payload: any = { ...base };

    const enabledAttributeIds: string[] = [];
    const attributeSelections: any[] = [];

    for (const a of attrsAll) {
      if (!(a.id in selectedAttrs)) continue;

      enabledAttributeIds.push(String(a.id));

      const sel = selectedAttrs[a.id];

      if (
        sel == null ||
        (typeof sel === "string" && sel.trim() === "") ||
        (Array.isArray(sel) && sel.length === 0)
      ) {
        continue;
      }

      if (a.type === "TEXT") {
        const text = String(sel).trim();
        if (text) {
          attributeSelections.push({
            attributeId: a.id,
            text,
          });
        }
        continue;
      }

      if (a.type === "SELECT") {
        const valueId = String(sel).trim();
        if (valueId) {
          attributeSelections.push({
            attributeId: a.id,
            valueId,
          });
        }
        continue;
      }

      if (a.type === "MULTISELECT") {
        const valueIds = (Array.isArray(sel) ? sel : [sel])
          .map((v) => String(v).trim())
          .filter(Boolean);

        if (valueIds.length) {
          attributeSelections.push({
            attributeId: a.id,
            valueIds,
          });
        }
      }
    }

    payload.enabledAttributeIds = Array.from(new Set(enabledAttributeIds));
    payload.attributeSelections = attributeSelections;

    const selectable = (attrsAll || []).filter((a) => a.type === "SELECT" && a.isActive);
    const selectableById = new Map(selectable.map((a) => [String(a.id), a]));

    const variants: any[] = [];

    const isRealVariantIdLocal = (id?: string) =>
      !!id &&
      !id.startsWith("vr-") &&
      !id.startsWith("new-") &&
      !id.startsWith("temp-") &&
      !id.startsWith("tmp:") &&
      !id.startsWith("tmp-");

    for (const row of variantRows || []) {
      const picks = Object.entries(row.selections || {})
        .map(([attributeId, valueId]) => ({
          attributeId: String(attributeId),
          valueId: String(valueId || "").trim(),
        }))
        .filter((x) => !!x.valueId);

      if (!picks.length) continue;

      let retailPriceToSend: number | null = null;

      if (editingId) {
        const computed = computedVariantRetail(row);
        retailPriceToSend =
          computed.hasComputed && computed.variantRetail > 0
            ? computed.variantRetail
            : null;
      } else {
        retailPriceToSend = null;
      }

      const options = picks.map((o) => ({
        attributeId: o.attributeId,
        valueId: o.valueId,
        attributeValueId: o.valueId,
      }));

      const labelParts: string[] = [];
      for (const o of picks) {
        const attr = selectableById.get(String(o.attributeId));
        const val = attr?.values?.find((v) => String(v.id) === String(o.valueId));
        const name = String(val?.name ?? "").trim();
        if (name) labelParts.push(skuSafePart(name));
      }

      const comboLabel = labelParts.filter(Boolean).join("-");
      const canSendVariantSku = !!editingId && !!pending.sku;
      const productSku = canSendVariantSku ? skuSafePart(pending.sku) : "";

      const sku =
        canSendVariantSku && productSku && comboLabel
          ? `${productSku}-${comboLabel}`
          : canSendVariantSku && productSku
            ? productSku
            : undefined;

      variants.push({
        ...(isRealVariantIdLocal(row.id) ? { id: row.id } : {}),
        ...(sku ? { sku } : {}),
        ...(retailPriceToSend != null ? { retailPrice: retailPriceToSend } : {}),
        options,
        optionSelections: options,
        attributes: options.map((o: any) => ({
          attributeId: o.attributeId,
          valueId: o.valueId,
        })),
      });
    }

    payload.variants = variants;
    payload.variantOptions = variants.map((v: any) => v.options);

    return payload;
  }

  function startNewProduct() {
    setEditingId(null);
    setOffersProductId(null);
    setPending({ ...defaultPending });
    setShowEditor(true);

    setSelectedAttrs({});
    setVariantRows([]);
    initialVariantIdsRef.current = new Set();
    setClearAllVariantsIntent(false);
    setVariantsDirty(false);

    setOfferVariants([]);
    clearSaveUiErrors();
  }

  const variantsForSave = useMemo(() => {
    return editingId ? (visibleVariantRows ?? []) : (variantRows ?? []);
  }, [editingId, visibleVariantRows, variantRows]);

  async function saveOrCreate() {
    clearSaveUiErrors();
    snapshotBeforeSave();

    const nextFieldErrors: Record<string, string> = {};
    const title = pending.title.trim();

    if (!title) nextFieldErrors.title = "Title is required.";
    if (!pending.supplierId) nextFieldErrors.supplierId = "Supplier is required.";
    if (!pending.brandId) nextFieldErrors.brandId = "Brand is required.";
    if (!pending.categoryId) nextFieldErrors.categoryId = "Category is required.";

    const normalizedShippingClass = normalizeShippingClass(pending.shippingClass);
    if (pending.shippingClass && !normalizedShippingClass) {
      nextFieldErrors.shippingClass = "Shipping class must be STANDARD, FRAGILE, or BULKY.";
    }

    if (!editingId) {
      const supplierPriceNum = Number((pending as any).supplierPrice) || 0;
      if (supplierPriceNum <= 0) nextFieldErrors.supplierPrice = "Supplier price is required.";
    }

    if (Object.keys(nextFieldErrors).length) {
      setFieldErrors(nextFieldErrors);
      setSaveBanner("Please fix the highlighted fields.");
      restoreSnapshot();
      return;
    }

    if (hasDuplicateCombos) {
      setSaveBanner("You have duplicate variant combinations (or a variant matches the BASE combo). Fix them before saving.");
      restoreSnapshot();
      return;
    }

    if (baseComboConflictMessage) {
      setSaveBanner("Base product defaults cannot match an existing variant combination.");
      restoreSnapshot();
      return;
    }

    const emptyRowErrorsNow = findEmptyRowErrors(variantsForSave ?? []);
    if (Object.keys(emptyRowErrorsNow).length > 0) {
      setSaveBanner("One or more variant rows have no selections. Pick at least 1 option or remove the row.");
      restoreSnapshot();
      return;
    }

    const supplierQty = toInt((pending as any).supplierAvailableQty, 0);
    const urlList = parseUrlList(pending.imageUrls);

    let retailBase = 0;

    if (editingId) {
      const computedBase =
        computedRetailFromEditing != null
          ? Number(computedRetailFromEditing) || 0
          : 0;

      const manualFallback = Number(pending.retailPrice) || 0;
      retailBase = computedBase > 0 ? computedBase : manualFallback;

      if (retailBase <= 0) {
        openModal({
          title: "Missing supplier price",
          message: "This product needs a valid supplier base or variant price before retail can be computed.",
        });
        return;
      }
    } else {
      const supplierPriceNum = Number((pending as any).supplierPrice) || 0;

      retailBase =
        supplierPriceNum > 0
          ? computeRetailPriceFromSupplierPrice({
            supplierPrice: supplierPriceNum,
            baseServiceFeeNGN,
            commsUnitCostNGN,
            gatewayFeePercent,
            gatewayFixedFeeNGN,
            gatewayFeeCapNGN,
          })
          : 0;

      if (retailBase <= 0) {
        setFieldErrors((prev) => ({
          ...prev,
          supplierPrice: "Supplier price is required.",
        }));
        setSaveBanner("Enter a valid supplier price before creating the product.");
        restoreSnapshot();
        return;
      }
    }

    const check = validateRetailAboveSupplierPrices({
      baseRetail: retailBase,
      variantRows: variantsForSave,
      caps: offerPriceCaps,
    });

    if (!check.ok) {
      openModal({
        title: "Retail price too low",
        message: check.errors.join("\n"),
      });
      return;
    }

    const shippingPayload = buildShippingPayloadFromPending({
      ...pending,
      shippingClass: normalizedShippingClass,
    });

    const base: any = {
      title,
      retailPrice: retailBase,
      status: pending.status,
      description: pending.description != null ? pending.description : undefined,
      categoryId: pending.categoryId,
      brandId: pending.brandId,
      supplierId: pending.supplierId,
      ...shippingPayload,
    };

    if (!editingId && supplierQty > 0) {
      base.availableQty = supplierQty;
      base.inStock = true;
    }

    if (urlList.length) base.imagesJson = urlList;

    const fullPayload = buildProductPayload({
      base,
      selectedAttrs,
      variantRows: variantsForSave,
      attrsAll: attrsQ.data || [],
    });

    if (fullPayload && typeof fullPayload === "object") {
      delete (fullPayload as any).ownerId;
      delete (fullPayload as any).userId;
    }

    const variants = Array.isArray((fullPayload as any).variants)
      ? (fullPayload as any).variants
      : [];

    if (editingId) {
      const {
        variants: _variants,
        variantOptions: _variantOptions,
        ...payloadForPatch
      } = fullPayload as any;

      const userTouchedVariants = variantsDirty || clearAllVariantsIntent;

      if (userTouchedVariants) {
        const submittedIds = new Set(
          (variants || [])
            .map((v: any) => normalizeNullableId(v?.id))
            .filter(Boolean) as string[]
        );

        const missingLocked = Array.from(lockedVariantIds).filter((id) => !submittedIds.has(id));

        if (missingLocked.length > 0) {
          openModal({
            title: "Cannot remove variants in use",
            message: `You tried to remove ${missingLocked.length} variant(s) that are linked to supplier offers. Remove/disable the supplier offers first, or keep those variants.`,
          });
          return;
        }
      }

      updateM.mutate(
        { id: editingId, ...payloadForPatch },
        {
          onSuccess: async () => {
            const pid = editingId;
            const touched = variantsDirty || clearAllVariantsIntent;

            if (pid && touched) {
              try {
                const replaceFlag = shouldReplaceVariants({
                  variantRows: variants || [],
                  initialVariantIds: initialVariantIdsRef.current,
                  clearAllVariantsIntent,
                });

                await persistVariantsStrict(pid, variants || [], { replace: replaceFlag });

                setVariantsDirty(false);
                setClearAllVariantsIntent(false);

                qc.invalidateQueries({
                  queryKey: ["admin", "products", "locked-variant-ids", { productId: pid }],
                });
              } catch (e) {
                console.error("Failed to persist variants on update", e);
                setSaveBanner(friendlyErrorMessage(e, "Failed to save variants"));
                restoreSnapshot();
                openModal({
                  title: "Products",
                  message: friendlyErrorMessage(e, "Failed to save variants"),
                });
                return;
              }
            }

            try {
              if (pid) {
                const refreshed = await fetchProductFull(pid);
                const nextRowsRaw = buildVariantRowsFromServerVariants(refreshed.variants || []);
                const nextRows = dedupeVariantRowsByCombo(nextRowsRaw, enabledSelectableAttrs);

                setVariantRows(nextRows);
                initialVariantIdsRef.current = new Set(
                  nextRows.map((r) => r.id).filter((id) => isRealVariantId(id))
                );
                setOfferVariants(refreshed.variants || []);

                qc.invalidateQueries({
                  queryKey: ["admin", "products", "locked-variant-ids", { productId: pid }],
                });
              }
            } catch (e) {
              console.warn("Product saved but refresh failed", e);
            }

            await Promise.all([
              qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] }),
              qc.invalidateQueries({ queryKey: ["admin", "overview"] }),
              qc.invalidateQueries({ queryKey: ["admin", "products", "offers-summary"] }),
              qc.invalidateQueries({ queryKey: ["admin", "products", "offer-price-caps"] }),
              pid ? qc.invalidateQueries({ queryKey: ["admin", "product", pid, "variants"] }) : Promise.resolve(),
              pid ? qc.invalidateQueries({ queryKey: ["admin", "products", pid, "supplier-offers"] }) : Promise.resolve(),
            ]);

            alert("Product changes saved.");
          },
        }
      );

      return;
    }

    const {
      variants: _variants,
      variantOptions: _variantOptions,
      ...payloadForCreate
    } = fullPayload as any;

    createM.mutate(payloadForCreate, {
      onSuccess: async (res) => {
        const created = (res?.data ?? res) as any;
        const pid = created?.id || created?.product?.id || created?.data?.id;

        const vars = extractProductVariants(fullPayload);
        if (pid && vars.length > 0) {
          try {
            await persistVariantsStrict(pid, vars, { replace: true });

            const refreshed = await fetchProductFull(pid);
            const nextRowsRaw = buildVariantRowsFromServerVariants(refreshed.variants || []);
            const nextRows = dedupeVariantRowsByCombo(nextRowsRaw, enabledSelectableAttrs);

            setVariantRows(nextRows);
            initialVariantIdsRef.current = new Set(
              nextRows.map((r) => r.id).filter((id) => isRealVariantId(id))
            );
            setOfferVariants(refreshed.variants || []);

            qc.invalidateQueries({
              queryKey: ["admin", "products", "locked-variant-ids", { productId: pid }],
            });
          } catch (e) {
            console.error("Failed to persist variants on create", e);
            setSaveBanner(friendlyErrorMessage(e, "Failed to save variants"));
            restoreSnapshot();
            openModal({
              title: "Products",
              message: friendlyErrorMessage(e, "Failed to save variants"),
            });
            return;
          }
        }

        if (pid) {
          setOffersProductId(pid);
          setEditingId(pid);
          setShowEditor(true);
          await loadOfferVariants(pid);
        }

        await Promise.all([
          qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] }),
          qc.invalidateQueries({ queryKey: ["admin", "overview"] }),
          qc.invalidateQueries({ queryKey: ["admin", "products", "offers-summary"] }),
          qc.invalidateQueries({ queryKey: ["admin", "products", "offer-price-caps"] }),
          pid ? qc.invalidateQueries({ queryKey: ["admin", "product", pid, "variants"] }) : Promise.resolve(),
          pid ? qc.invalidateQueries({ queryKey: ["admin", "products", pid, "supplier-offers"] }) : Promise.resolve(),
        ]);
      },
    });

    setRefreshKey((prev) => prev + 1);
  }

  useEffect(() => {
    if (!focusId || !rowsWithDerived?.length) return;
    const target = rowsWithDerived.find((r: any) => r.id === focusId);
    if (!target) return;
    startEdit(target);
    onFocusedConsumed();
  }, [focusId, rowsWithDerived]);

  const getOwner = (p: any) => (p.owner?.email || p.ownerEmail || p.createdByEmail || p.createdBy?.email || "") as string;

  const filteredRows = useMemo(() => {
    const offers = (offersSummaryQ.data || {}) as any;
    const supplierText = debouncedSupplierFilterText.trim().toLowerCase();
    const supplierId = supplierFilterId.trim();

    const hasAnyOffer = (pId: string, p: any) => {
      const offerCount = toInt((p as any).__offerCount ?? 0, 0);
      const s = offers[pId];
      return offerCount > 0 || (!!s && ((s.activeOfferCount ?? 0) > 0 || s.perSupplier?.length > 0));
    };

    const hasActiveOffer = (pId: string, p: any) => {
      const s = offers[pId];
      const offerCount = toInt((p as any).__offerCount ?? 0, 0);
      return (offerCount > 0 && (p.availableQty ?? 0) > 0) || (!!s && (s.activeOfferCount ?? 0) > 0 && (s.totalAvailable ?? 0) > 0);
    };

    const isAvailableVariantAware = (pId: string, p: any) => {
      const s = offers[pId];
      if (s?.inStock) return true;
      return (p.availableQty ?? 0) > 0 || p.inStock === true;
    };

    const hasVariants = (p: any) => extractProductVariants(p).length > 0 || (p.variantCount ?? 0) > 0;
    const baseInStock = (p: any) => p.inStock === true;

    const matchesSupplier = (p: any) => {
      const rowSupplierId = String(p?.supplierId ?? "").trim();
      const rowSupplierName = String(getSupplierName(p) || "").trim().toLowerCase();
      const typed = supplierText;

      if (supplierId && rowSupplierId !== supplierId) return false;
      if (typed && !rowSupplierName.includes(typed)) return false;

      return true;
    };

    const priceTokens = (p: any): string[] => {
      const tokens = new Set<string>();
      const add = (v: any) => { const n = Math.round(Number(v)); if (n > 0) tokens.add(String(n)); };
      add(p.__computedRetailFrom);
      add(p.retailPrice);
      add(p.computedRetailPrice);
      add(p.autoPrice);
      for (const v of (p.variants ?? [])) add(v?.retailPrice);
      return Array.from(tokens);
    };

    const matchesPrice = (p: any) => {
      if (!qIsNumericSearch) return true;
      const q = debouncedQ.trim();
      return priceTokens(p).some((t) => t.startsWith(q));
    };

    return rowsWithDerived.filter((p) => {
      if (!matchesSupplier(p)) return false;
      if (!matchesPrice(p)) return false;

      switch (preset) {
        case "no-offer":
          return !hasAnyOffer(p.id, p);
        case "live":
          return p.status === "LIVE";
        case "published-with-offer":
          return p.status === "PUBLISHED" && hasAnyOffer(p.id, p);
        case "published-no-offer":
          return p.status === "PUBLISHED" && !hasAnyOffer(p.id, p);
        case "published-with-active":
          return p.status === "PUBLISHED" && hasActiveOffer(p.id, p);
        case "published-base-in":
          return p.status === "PUBLISHED" && baseInStock(p);
        case "published-base-out":
          return p.status === "PUBLISHED" && !baseInStock(p);
        case "with-variants":
          return hasVariants(p);
        case "simple":
          return !hasVariants(p);
        case "published-with-availability":
          return p.status === "PUBLISHED" && isAvailableVariantAware(p.id, p);
        case "published":
          return p.status === "PUBLISHED";
        case "pending":
          return p.status === "PENDING";
        case "rejected":
          return p.status === "REJECTED";
        case "all":
        default:
          return true;
      }
    });
  }, [rowsWithDerived, preset, offersSummaryQ.data, supplierFilterId, debouncedSupplierFilterText, suppliersQ.data, qIsNumericSearch, debouncedQ]);

  const displayRows = useMemo(() => {
    const arr = [...filteredRows];

    const cmpNum = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);
    const cmpStr = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

    const priceOf = (p: any) => {
      const computed = Number(p?.__computedRetailFrom ?? 0) || 0;
      if (computed > 0) return computed;
      const fallback = Number(p?.retailPrice ?? p?.price ?? 0) || 0;
      return fallback;
    };

    arr.sort((a, b) => {
      let res = 0;
      switch (sort.key) {
        case "title":
          res = cmpStr(a?.title ?? "", b?.title ?? "");
          break;
        case "price":
          res = cmpNum(priceOf(a), priceOf(b));
          break;
        case "avail":
          res = cmpNum(Number(a?.availableQty ?? 0), Number(b?.availableQty ?? 0));
          break;
        case "stock":
          res = cmpNum(a?.inStock ? 1 : 0, b?.inStock ? 1 : 0);
          break;
        case "status":
          res = cmpNum(statusRank[getStatus(a)] ?? 99, statusRank[getStatus(b)] ?? 99);
          break;
        case "owner":
          res = cmpStr(getOwner(a), getOwner(b));
          break;
        case "supplier":
          res = cmpStr(getSupplierName(a), getSupplierName(b));
          break;
      }
      return sort.dir === "asc" ? res : -res;
    });

    return arr;
  }, [filteredRows, sort]);

  useEffect(() => {
    setPage(1);
  }, [preset, debouncedQ, sort.key, sort.dir, supplierFilterId, debouncedSupplierFilterText]);

  const totalRows = displayRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;

  const paginatedRows = useMemo(() => {
    return displayRows.slice(startIndex, endIndex);
  }, [displayRows, startIndex, endIndex]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function goToPage(next: number) {
    setPage(Math.min(Math.max(1, next), totalPages));
  }

  const supplierVariants = useMemo(() => {
    const skuByVariantId = new Map<string, string>();

    const norm = (x: any) => {
      if (x == null) return null;
      const s = String(x).trim();
      if (!s || s === "null" || s === "undefined") return null;
      return s;
    };

    for (const v of offerVariants || []) {
      const vid =
        norm(v?.id) ||
        norm(v?.variantId) ||
        norm(v?.variant?.id) ||
        norm(v?.id?.id) ||
        norm(v?.variantId?.id);
      const sku = String(v?.sku || "").trim();
      if (vid && sku) skuByVariantId.set(vid, sku);
    }

    const rows = (variantRows || []).filter((r) => isRealVariantId(String(r?.id ?? "")));

    const toLabelFromSelections = (r: VariantRow) => {
      const parts: string[] = [];
      for (const a of enabledSelectableAttrs || []) {
        const valId = String(r?.selections?.[a.id] ?? "").trim();
        if (!valId) continue;
        const valName = a?.values?.find((vv) => String(vv.id) === valId)?.name;
        parts.push(String(valName || "").trim() || valId);
      }
      return parts.filter(Boolean).join(" / ");
    };

    return rows
      .map((r, index) => {
        const vid = norm(r?.id);
        if (!vid) return null;

        const serverSku = skuByVariantId.get(vid);
        const labelFromSelections = toLabelFromSelections(r);
        const label = serverSku || labelFromSelections || `Variant ${index + 1}`;

        return { id: vid, sku: serverSku || label, label };
      })
      .filter(Boolean) as Array<{ id: string; sku: string; label: string }>;
  }, [variantRows, enabledSelectableAttrs, offerVariants]);

  function submitStatusEdit(pId: string, intent: "approvePublished" | "movePending" | "reject") {
    const source = rowsWithDerived.find((r: any) => r.id === pId);
    if (!source) return;

    const patch: any = {};

    if (intent === "approvePublished") {
      const avail = (source.availableQty ?? 0) > 0 || source.inStock !== false;
      if (!avail) {
        openModal({ title: "Cannot publish", message: "This product is not in stock. Please add stock or active supplier offers first." });
        return;
      }
      patch.status = "PUBLISHED";
    } else if (intent === "movePending") {
      patch.status = "PENDING";
    } else if (intent === "reject") {
      patch.status = "REJECTED";
    }

    updateStatusM.mutate({ id: pId, ...patch });
  }

  function primaryActionForRow(p: any): any {
    const eff = getStatus(p);
    const hasActiveOffer = (Number(p.availableQty ?? 0) || 0) > 0;

    const ordersKnown = !!hasOrdersQ.data || hasOrdersSupportRef.current === "unsupported";
    const ordered = hasOrder(p.id);

    if (!ordersKnown || offersSummaryQ.isLoading) {
      return {
        label: "…",
        title: "Checking…",
        disabled: true,
        onClick: () => { },
        className: "px-2 py-1 rounded bg-zinc-400 text-white",
      };
    }

    if (eff === "PENDING" && hasActiveOffer) {
      return {
        label: "Approve PUBLISHED",
        title: "Publish product",
        onClick: () => submitStatusEdit(p.id, "approvePublished"),
        className: "px-3 py-2 rounded-lg bg-emerald-600 text-white",
      };
    }

    if (eff === "PENDING" && !hasActiveOffer) {
      return ordered
        ? { label: "Archive", title: "Archive (soft delete)", onClick: () => deleteM.mutate(p.id), className: "px-2 py-1 rounded bg-rose-600 text-white" }
        : { label: "Delete", title: "Delete permanently", onClick: () => deleteM.mutate(p.id), className: "px-2 py-1 rounded bg-rose-600 text-white" };
    }

    if (eff === "PUBLISHED" || eff === "LIVE") {
      return {
        label: "Move to PENDING",
        title: "Unpublish product",
        onClick: () => submitStatusEdit(p.id, "movePending"),
        className: "px-3 py-2 rounded-lg border bg-amber-400 text-white",
      };
    }

    if (eff === "ARCHIVED") {
      return { label: "Revive", title: "Restore archived product", onClick: () => restoreM.mutate(p.id), className: "px-3 py-2 rounded-lg bg-sky-600 text-white" };
    }

    return ordered
      ? { label: "Archive", title: "Archive (soft delete)", onClick: () => deleteM.mutate(p.id), className: "px-2 py-1 rounded bg-rose-600 text-white" }
      : { label: "Delete", title: "Delete permanently", onClick: () => deleteM.mutate(p.id), className: "px-2 py-1 rounded bg-rose-600 text-white" };
  }

  const activeAttrs = useMemo(() => (attrsQ.data ?? []).filter((a) => a?.isActive), [attrsQ.data]);

  function setAttr(attrId: string, value: string | string[]) {
    setSelectedAttrs((prev) => ({ ...prev, [attrId]: value }));
  }

  function toggleAttributeEnabled(attrId: string, enabled: boolean) {
    setSelectedAttrs((prev) => {
      const next = { ...prev };

      if (enabled) {
        if (!(attrId in next)) next[attrId] = "";
        return next;
      }

      delete next[attrId];
      return next;
    });

    setVariantRows((prev) => {
      const rows = Array.isArray(prev) ? prev : [];
      return rows.map((row) => {
        const nextSelections = { ...(row.selections || {}) };
        delete nextSelections[attrId];
        return { ...row, selections: nextSelections };
      });
    });

    touchVariants();
  }

  const presetButtons: Array<{ key: FilterPreset; label: string }> = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "published", label: "Published" },
    { key: "live", label: "Live" },
    { key: "no-offer", label: "No offer" },
    { key: "with-variants", label: "With variants" },
    { key: "simple", label: "Simple" },
    { key: "rejected", label: "Rejected" },
  ];

  const displayRetailForRow = (p: any) => {
    const computed = Number(p?.__computedRetailFrom ?? 0) || 0;
    if (computed > 0) return computed;
    const fallback = Number(p?.retailPrice ?? p?.price ?? 0) || 0;
    return fallback;
  };

  async function startEdit(p: any) {
    try {
      setShowEditor(true);

      const full = await fetchProductFull(p.id);
      skipDraftLoadRef.current = true;

      setOffersProductId(full.id);
      setEditingId(full.id);

      const resolvedSupplierId = normalizeNullableId(full.supplierId) || "";

      const shippingState = pickShippingStateFromProduct(full);

      const nextPending = {
        ...defaultPending,
        ...shippingState,

        title: full.title || "",
        supplierPrice: "",
        retailPrice: String(full.retailPrice ?? ""),
        status:
          full.status === "PUBLISHED" || full.status === "LIVE"
            ? full.status
            : "PENDING",
        categoryId: full.categoryId || "",
        brandId: full.brandId || "",
        supplierId: resolvedSupplierId,
        supplierAvailableQty: "",
        sku: full.sku || "",
        imageUrls: (extractImageUrls(full) || []).join("\n"),
        description: full.description ?? "",
      };

      const attrTypeById = new Map<string, AdminAttribute["type"]>();
      for (const a of attrsQ.data || []) {
        attrTypeById.set(String(a.id), a.type);
      }

      const nextSel: Record<string, string | string[]> = {};

      (full.enabledAttributeRows || []).forEach((row: any) => {
        const aid = String(
          row?.attributeId ??
          row?.attribute?.id ??
          ""
        ).trim();

        if (!aid) return;

        const attrType =
          row?.attribute?.type ??
          attrTypeById.get(aid);

        if (!(aid in nextSel)) {
          nextSel[aid] = attrType === "MULTISELECT" ? [] : "";
        }
      });

      (full.attributeValues || []).forEach((av: any) => {
        const aid = String(
          av?.attributeId ??
          av?.attribute?.id ??
          ""
        ).trim();

        const vid = String(
          av?.valueId ??
          av?.value?.id ??
          ""
        ).trim();

        if (!aid) return;

        const attrType =
          av?.attribute?.type ??
          attrTypeById.get(aid);

        if (!(aid in nextSel)) {
          nextSel[aid] = attrType === "MULTISELECT" ? [] : "";
        }

        if (!vid) return;

        if (attrType === "MULTISELECT") {
          const prev = Array.isArray(nextSel[aid]) ? nextSel[aid] : [];
          const list = prev.map((x) => String(x).trim()).filter(Boolean);
          if (!list.includes(vid)) list.push(vid);
          nextSel[aid] = list;
          return;
        }

        if (!String(nextSel[aid] ?? "").trim()) {
          nextSel[aid] = vid;
        }
      });

      (full.attributeTexts || []).forEach((at: any) => {
        const aid = String(
          at?.attributeId ??
          at?.attribute?.id ??
          ""
        ).trim();

        if (!aid) return;

        if (!(aid in nextSel)) {
          nextSel[aid] = "";
        }

        nextSel[aid] = String(at?.value ?? "");
      });

      const serverVariants =
        (full as any).variants ||
        (full as any).variantsNormalized ||
        [];

      const vr = buildVariantRowsFromServerVariants(serverVariants);

      setPending(nextPending);
      setSelectedAttrs(nextSel);

      initialVariantIdsRef.current = new Set(
        vr.map((r) => r.id).filter((id) => isRealVariantId(id))
      );

      setClearAllVariantsIntent(false);
      setVariantRows(vr);
      setVariantsDirty(false);

      await loadOfferVariants(full.id);

      localStorage.setItem(
        `adminProductDraft:${full.id}`,
        JSON.stringify({
          pending: nextPending,
          variantRows: vr,
          selectedAttrs: nextSel,
        })
      );
    } catch (e) {
      console.error(e);
      openModal({ title: "Products", message: "Could not load product for editing." });
    } finally {
      queueMicrotask(() => {
        skipDraftLoadRef.current = false;
      });
    }
  }

  const baseDefaultsSummary = useMemo(() => {
    return summarizeBaseProductDefaults(selectedAttrs, activeAttrs || []);
  }, [selectedAttrs, activeAttrs]);

  //Render


  return (
    <div
      className="space-y-4"
      onKeyDownCapture={(e) => {
        if (e.key === "Enter") {
          const target = e.target as HTMLElement;
          const tag = target.tagName;
          const isTextArea = tag === "TEXTAREA";
          const isButton = tag === "BUTTON";
          if (!isTextArea && !isButton) e.preventDefault();
        }
      }}
      onSubmitCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {(showEditor || !!editingId) && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              setShowEditor(false);
              setEditingId(null);
              setOffersProductId(null);
              setPending({ ...defaultPending });
              setVariantRows([]);
              setSelectedAttrs({});
              setOfferVariants([]);
              setVariantsDirty(false);
              setClearAllVariantsIntent(false);
              setUploadInfo("");
              setIsUploadingImages(false);
              clearSaveUiErrors();
            }}
            className="rounded-xl border border-slate-300 bg-rose-600 text-white px-3 py-2 text-sm hover:bg-rose-700 ml-auto"
          >
            Close Form
          </button>

          {editingId && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
              Editing: <span className="font-semibold">{(pending.title || "").trim() || "Untitled product"}</span>
              <span className="ml-2 text-xs text-amber-700/80">
                (ID: <span className="font-mono">{editingId}</span>)
              </span>
            </div>
          )}

          {editingId && (
            <div className="rounded-xl border bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Retail price = supplier price + base service fee + comms fee + gateway fee.
            </div>
          )}

          {editingId && offersProductId && (
            <div className="rounded-2xl border bg-white shadow-sm">
              <SuppliersOfferManager
                refreshKey={refreshKey}
                productId={offersProductId}
                variants={supplierVariants}
                suppliers={suppliersQ.data}
                readOnly={!(isSuper || isAdmin)}
                defaultUnitCost={Number(pending.retailPrice) || 0}
                onSaved={() => {
                  refreshEditingProduct();
                }}
              />
            </div>
          )}

          <div className="rounded-2xl border bg-white shadow-sm p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{editingId ? "Edit product" : "Create product (Admin)"}</div>
                <div className="text-sm text-slate-500">
                  {editingId
                    ? "Retail prices are computed as supplier price + service fees + gateway fee."
                    : "Enter the supplier price and the retail price will be auto-calculated."}
                </div>
              </div>

              {editingId && (
                <button
                  type="button"
                  onClick={refreshEditingProduct}
                  disabled={isRefreshingProduct}
                  className="rounded-xl border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                  title="Reload product + prices"
                >
                  {isRefreshingProduct ? "Refreshing…" : "Refresh"}
                </button>
              )}
            </div>

            {saveBanner && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {saveBanner}
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-sm font-medium text-slate-700">
                      Title <span className="text-rose-600">*</span>
                    </label>
                    <input
                      value={pending.title}
                      onChange={(e) => setPending((p) => ({ ...p, title: e.target.value }))}
                      className={`mt-1 w-full rounded-xl border px-3 py-2 ${fieldErrors.title ? "border-rose-300" : ""}`}
                      placeholder="Product title"
                    />
                    {fieldErrors.title && <div className="mt-1 text-[11px] text-rose-600">{fieldErrors.title}</div>}
                  </div>

                  {!editingId ? (
                    <>
                      <div>
                        <label className="text-sm font-medium text-slate-700">
                          Supplier Price (NGN) <span className="text-rose-600">*</span>
                        </label>
                        <input
                          value={(pending as any).supplierPrice}
                          onChange={(e) => setPending((p) => ({ ...p, supplierPrice: e.target.value }))}
                          className={`mt-1 w-full rounded-xl border px-3 py-2 ${fieldErrors.supplierPrice ? "border-rose-300" : ""}`}
                          placeholder="0"
                          inputMode="decimal"
                        />
                        {fieldErrors.supplierPrice && (
                          <div className="mt-1 text-[11px] text-rose-600">{fieldErrors.supplierPrice}</div>
                        )}
                        <div className="mt-1 text-[11px] text-slate-500">
                          This is the supplier/base cost for the new product.
                        </div>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-slate-700">Retail Price (NGN) (auto)</label>
                        <input
                          value={pending.retailPrice}
                          readOnly
                          className="mt-1 w-full rounded-xl border px-3 py-2 bg-slate-50 text-slate-700"
                          placeholder="0"
                          inputMode="decimal"
                          title="Computed as supplier price + base service fee + comms fee + gateway fee"
                        />
                        <div className="mt-1 text-[11px] text-slate-500">
                          Auto-calculated from supplier price + service fee + comms fee + gateway fee.
                        </div>
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="text-sm font-medium text-slate-700">
                        Retail Price (NGN) (computed FROM)
                      </label>
                      <input
                        value={pending.retailPrice}
                        readOnly
                        className="mt-1 w-full rounded-xl border px-3 py-2 bg-slate-50 text-slate-700"
                        placeholder="0"
                        inputMode="decimal"
                        title="Computed as supplier/base or variant supplier price + base service fee + comms fee + gateway fee"
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-sm font-medium text-slate-700">Status</label>
                    <select
                      value={pending.status}
                      onChange={(e) => setPending((p) => ({ ...p, status: e.target.value }))}
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                    >
                      <option value="PENDING">PENDING</option>
                      <option value="PUBLISHED">PUBLISHED</option>
                      <option value="LIVE">LIVE</option>
                      <option value="REJECTED">REJECTED</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700">
                      Supplier <span className="text-rose-600">*</span>
                    </label>
                    <select
                      value={pending.supplierId}
                      onChange={(e) => setPending((p) => ({ ...p, supplierId: e.target.value }))}
                      className={`mt-1 w-full rounded-xl border px-3 py-2 ${fieldErrors.supplierId ? "border-rose-300" : ""}`}
                    >
                      <option value="">Select supplier…</option>
                      {(suppliersQ.data ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    {fieldErrors.supplierId && <div className="mt-1 text-[11px] text-rose-600">{fieldErrors.supplierId}</div>}
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700">
                      Category <span className="text-rose-600">*</span>
                    </label>
                    <select
                      value={pending.categoryId}
                      onChange={(e) => setPending((p) => ({ ...p, categoryId: e.target.value }))}
                      className={`mt-1 w-full rounded-xl border px-3 py-2 ${fieldErrors.categoryId ? "border-rose-300" : ""}`}
                    >
                      <option value="">Select category…</option>
                      {(catsQ.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {fieldErrors.categoryId && <div className="mt-1 text-[11px] text-rose-600">{fieldErrors.categoryId}</div>}
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700">
                      Brand <span className="text-rose-600">*</span>
                    </label>

                    <select
                      value={pending.brandId}
                      onChange={(e) => setPending((p) => ({ ...p, brandId: e.target.value }))}
                      className={`mt-1 w-full rounded-xl border px-3 py-2 ${(!pending.brandId || fieldErrors.brandId) ? "border-rose-300" : ""}`}
                    >
                      <option value="">Select brand…</option>
                      {(brandsQ.data ?? [])
                        .filter((b) => b.isActive)
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                    </select>
                    {fieldErrors.brandId && <div className="mt-1 text-[11px] text-rose-600">{fieldErrors.brandId}</div>}

                    {!pending.brandId && (
                      <div className="mt-1 text-[11px] text-rose-600">Brand is required.</div>
                    )}
                  </div>

                  {editingId && (
                    <div className="sm:col-span-2">
                      <label className="text-sm font-medium text-slate-700">SKU (auto)</label>
                      <div className="mt-1 w-full rounded-xl border px-3 py-2 bg-slate-50 text-slate-700 font-mono text-sm">
                        {pending.sku || "—"}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        SKU is generated automatically from Supplier + Brand + Title.
                      </div>
                    </div>
                  )}

                  {!editingId && (
                    <div className="sm:col-span-2">
                      <label className="text-sm font-medium text-slate-700">Supplier Qty (for NEW product)</label>
                      <input
                        value={(pending as any).supplierAvailableQty}
                        onChange={(e) => setPending((p) => ({ ...p, supplierAvailableQty: e.target.value }))}
                        className="mt-1 w-full rounded-xl border px-3 py-2"
                        placeholder="0"
                        inputMode="numeric"
                      />
                      <div className="text-xs text-slate-500 mt-1">Only used on create (base product stock).</div>
                    </div>
                  )}
                </div>

                {editingId && (
                  <div className="text-xs text-slate-500">
                    {(() => {
                      const basePrice = Number(offerPriceCaps.basePrice ?? 0) || 0;
                      const firstVariantPrice = Number(offerPriceCaps.firstVariantPrice ?? 0) || 0;

                      const sourceSupplierPrice =
                        basePrice > 0 ? basePrice : firstVariantPrice > 0 ? firstVariantPrice : 0;

                      if (sourceSupplierPrice > 0) {
                        const computedRetail = computeRetailPriceFromSupplierPrice({
                          supplierPrice: sourceSupplierPrice,
                          baseServiceFeeNGN,
                          commsUnitCostNGN,
                          gatewayFeePercent,
                          gatewayFixedFeeNGN,
                          gatewayFeeCapNGN,
                        });

                        return (
                          <span>
                            Supplier price: ₦{sourceSupplierPrice.toLocaleString()} → retail ₦
                            {computedRetail.toLocaleString()}
                          </span>
                        );
                      }

                      return <span>Supplier price → —</span>;
                    })()}
                    {Object.keys(offerPriceCaps.variantPriceByVariant || {}).length > 0 && (
                      <span className="ml-2">• variants tracked: {Object.keys(offerPriceCaps.variantPriceByVariant || {}).length}</span>
                    )}
                  </div>
                )}

                {/* Shipping */}
                <div className="rounded-xl border p-3">
                  <div className="text-sm font-semibold text-slate-800">Shipping</div>
                  <div className="text-xs text-slate-500">
                    Product shipping fields that are actually backed by your current Product schema.
                  </div>

                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={!!pending.freeShipping}
                        onChange={(e) => setPending((p) => ({ ...p, freeShipping: e.target.checked }))}
                      />
                      Free shipping
                    </label>

                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={!!pending.fragile}
                        onChange={(e) => setPending((p) => ({ ...p, fragile: e.target.checked }))}
                      />
                      Fragile
                    </label>

                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={!!pending.oversized}
                        onChange={(e) => setPending((p) => ({ ...p, oversized: e.target.checked }))}
                      />
                      Oversized / bulky
                    </label>
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-slate-700">
                        Shipping Class <span className="text-rose-600">*</span>
                      </label>
                      <select
                        value={pending.shippingClass}
                        onChange={(e) => {
                          const next = e.target.value as ShippingParcelClass | "";
                          setPending((p) => ({ ...p, shippingClass: next }));
                        }}
                        className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm ${fieldErrors.shippingClass ? "border-rose-300" : ""
                          }`}
                      >
                        <option value="">Select shipping class…</option>
                        <option value="STANDARD">STANDARD</option>
                        <option value="FRAGILE">FRAGILE</option>
                        <option value="BULKY">BULKY</option>
                      </select>
                      {fieldErrors.shippingClass && (
                        <div className="mt-1 text-[11px] text-rose-600">{fieldErrors.shippingClass}</div>
                      )}
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-700">Weight (kg)</label>
                      <input
                        value={pending.weightKg}
                        onChange={(e) => {
                          const nextKg = e.target.value;
                          const kgNum = Number(nextKg);

                          setPending((p) => ({
                            ...p,
                            weightKg: nextKg,
                            weightGrams:
                              nextKg.trim() === "" || !Number.isFinite(kgNum)
                                ? ""
                                : String(Math.round(kgNum * 1000)),
                          }));
                        }}
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        placeholder="e.g. 1.25"
                        inputMode="decimal"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-700">Weight (grams)</label>
                      <input
                        value={pending.weightGrams}
                        onChange={(e) => {
                          const nextGrams = e.target.value;
                          const gramsNum = Number(nextGrams);

                          setPending((p) => ({
                            ...p,
                            weightGrams: nextGrams,
                            weightKg:
                              nextGrams.trim() === "" || !Number.isFinite(gramsNum)
                                ? ""
                                : String(gramsNum / 1000),
                          }));
                        }}
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        placeholder="e.g. 1250"
                        inputMode="decimal"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-700">Length (cm)</label>
                      <input
                        value={pending.lengthCm}
                        onChange={(e) => setPending((p) => ({ ...p, lengthCm: e.target.value }))}
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        placeholder="e.g. 30"
                        inputMode="decimal"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-700">Width (cm)</label>
                      <input
                        value={pending.widthCm}
                        onChange={(e) => setPending((p) => ({ ...p, widthCm: e.target.value }))}
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        placeholder="e.g. 20"
                        inputMode="decimal"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-700">Height (cm)</label>
                      <input
                        value={pending.heightCm}
                        onChange={(e) => setPending((p) => ({ ...p, heightCm: e.target.value }))}
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        placeholder="e.g. 15"
                        inputMode="decimal"
                      />
                    </div>
                  </div>
                </div>

                {/* Images */}
                <div className="rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Images</div>
                      <div className="text-xs text-slate-500">Upload images or paste URLs (one per line).</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        ref={filePickRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = e.target.files;
                          if (files && files.length) uploadImages(files);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => filePickRef.current?.click()}
                        disabled={isUploadingImages}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                      >
                        {isUploadingImages ? "Uploading…" : "Upload"}
                      </button>
                    </div>
                  </div>

                  {!!uploadInfo && <div className="mt-2 text-xs text-slate-600">{uploadInfo}</div>}

                  {imagePreviewUrls.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {imagePreviewUrls.map((u) => (
                        <div key={u} className="relative rounded-xl border overflow-hidden bg-slate-50">
                          <img
                            src={u}
                            alt="preview"
                            className="h-28 w-full object-cover"
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                          />

                          <button
                            type="button"
                            onClick={() => removeImageUrl(u)}
                            className="absolute top-2 right-2 rounded-lg bg-black/60 text-white text-xs px-2 py-1 hover:bg-black/70"
                            title="Remove image"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <textarea
                    value={pending.imageUrls}
                    onChange={(e) => setPending((p) => ({ ...p, imageUrls: e.target.value }))}
                    className="mt-3 w-full rounded-xl border px-3 py-2 text-sm min-h-[110px]"
                    placeholder="https://...\nhttps://..."
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-sm font-medium text-slate-700">Description</label>
                  <textarea
                    value={pending.description}
                    onChange={(e) => setPending((p) => ({ ...p, description: e.target.value }))}
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm min-h-[120px]"
                    placeholder="Describe the product…"
                  />
                </div>
              </div>

              {/* Right */}
              <div className="space-y-3">
                {/* Attributes */}
                <div className="rounded-xl border p-3">
                  <div className="text-sm font-semibold text-slate-800">Attributes</div>
                  <div className="text-xs text-slate-500">These are product-level attributes (not variant combos).</div>

                  <div className="mt-3 space-y-3">
                    {(activeAttrs || []).map((a) => {
                      const enabled = a.id in selectedAttrs;
                      const val = selectedAttrs[a.id];

                      return (
                        <div key={a.id} className="rounded-xl border border-slate-200 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-slate-800">{a.name}</div>
                              <div className="text-[11px] text-slate-500">
                                {enabled ? "Enabled for this product" : "Disabled for this product"}
                              </div>
                            </div>

                            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(e) => toggleAttributeEnabled(a.id, e.target.checked)}
                              />
                              Enable
                            </label>
                          </div>

                          {enabled && (
                            <div className="mt-3">
                              {a.type === "TEXT" && (
                                <div>
                                  <label className="text-xs font-medium text-slate-700">
                                    Default/base text value (optional)
                                  </label>
                                  <input
                                    value={typeof val === "string" ? val : ""}
                                    onChange={(e) => setAttr(a.id, e.target.value)}
                                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                                    placeholder={a.placeholder || "Leave empty if no base value"}
                                  />
                                </div>
                              )}

                              {a.type === "SELECT" && (
                                <div>
                                  <label className="text-xs font-medium text-slate-700">
                                    Default/base option (optional)
                                  </label>
                                  <select
                                    value={typeof val === "string" ? val : ""}
                                    onChange={(e) => setAttr(a.id, e.target.value)}
                                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                                  >
                                    <option value="">No base value</option>
                                    {(a.values || [])
                                      .filter((v) => v.isActive)
                                      .map((v) => (
                                        <option key={v.id} value={v.id}>
                                          {v.name}
                                        </option>
                                      ))}
                                  </select>
                                </div>
                              )}

                              {a.type === "MULTISELECT" && (
                                <div>
                                  <div className="text-xs font-medium text-slate-700">
                                    Default/base values (optional)
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {(a.values || [])
                                      .filter((v) => v.isActive)
                                      .map((v) => {
                                        const selected = Array.isArray(val) ? val : [];
                                        const on = selected.includes(v.id);

                                        return (
                                          <button
                                            key={v.id}
                                            type="button"
                                            onClick={() => {
                                              const next = on
                                                ? selected.filter((x) => x !== v.id)
                                                : [...selected, v.id];
                                              setAttr(a.id, next);
                                            }}
                                            className={
                                              on
                                                ? "px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs"
                                                : "px-3 py-1.5 rounded-full border text-xs hover:bg-slate-50"
                                            }
                                          >
                                            {v.name}
                                          </button>
                                        );
                                      })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {activeAttrs.length === 0 && (
                      <div className="text-sm text-slate-500">No attributes configured.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div
              className={`mt-4 rounded-xl border p-3 ${baseComboConflictMessage ? "border-rose-300 bg-rose-50" : "bg-slate-50"}`}
            >
              <div className="text-sm font-semibold text-slate-800">Base product defaults</div>
              <div className="text-xs text-slate-500">
                These default attribute values represent the base product. They are not a variant row.
              </div>

              {baseDefaultsSummary.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {baseDefaultsSummary.map((item) => (
                    <div
                      key={item.attributeId}
                      className={`rounded-full border px-3 py-1.5 text-xs ${baseComboConflictMessage
                        ? "border-rose-200 bg-white text-rose-700"
                        : "border-slate-200 bg-white text-slate-700"
                        }`}
                    >
                      <span className="font-medium">{item.label}:</span> {item.value}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-500">
                  No base/default attribute values selected yet.
                </div>
              )}

              {baseComboConflictMessage && (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {baseComboConflictMessage}
                </div>
              )}
            </div>

            {/* Variants editor */}
            <div className="mt-4 rounded-xl border p-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-800">Variants</div>
                  <div className="text-xs text-slate-500">Add option combinations (Color / Size etc).</div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={addVariantCombo}
                    className="rounded-lg bg-slate-900 text-white px-3 py-2 text-sm hover:bg-slate-800"
                  >
                    + Add variant
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setVariantRows([]);
                      setClearAllVariantsIntent(true);
                      touchVariants();
                    }}
                    className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
                    title="This will remove all variants on save (editing only)."
                  >
                    Remove all
                  </button>
                </div>
              </div>

              {hasDuplicateCombos && (
                <div className="mt-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 text-xs">
                  You have duplicate variant combinations. Fix them before saving.
                </div>
              )}

              {Object.keys(emptyRowErrors).length > 0 && (
                <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 text-xs">
                  One or more rows have no selections. Pick at least 1 option or remove the row.
                </div>
              )}

              {enabledSelectableAttrs.length === 0 ? (
                <div className="mt-3 text-sm text-slate-500">
                  No SELECT attributes found. Create SELECT attributes to build variant combinations.
                </div>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-[1100px] w-full text-sm table-fixed">
                    <thead className="bg-slate-50 text-slate-700">
                      <tr className="text-left">
                        {enabledSelectableAttrs.map((a) => (
                          <th key={a.id} className="p-2 min-w-[180px] w-[180px]">
                            {a.name}
                          </th>
                        ))}
                        <th className="p-2 min-w-[130px] w-[130px]">Retail</th>
                        <th className="p-2 min-w-[100px] w-[100px]">Lock</th>
                        <th className="p-2 min-w-[120px] w-[120px]">Action</th>
                      </tr>
                    </thead>

                    <tbody>
                      {(visibleVariantRows || []).map((r, idx) => {
                        const rk = rowKey(r, idx);
                        const dupErr = comboErrors[rk];
                        const emptyErr = emptyRowErrors[rk];

                        const isLocked = isRealVariantId(String(r.id)) && lockedVariantIds.has(String(r.id));
                        const computed = computedVariantRetail(r);

                        const retailLabel =
                          computed.variantRetail === -1
                            ? "—"
                            : `₦${Number(computed.variantRetail || 0).toLocaleString()}`;

                        return (
                          <tr key={rk} className="border-t">
                            {enabledSelectableAttrs.map((a) => {
                              const cur = String(r?.selections?.[a.id] ?? "");
                              return (
                                <td key={a.id} className="p-2 align-top min-w-[180px] w-[180px]">
                                  <select
                                    value={cur}
                                    onChange={(e) => setVariantRowSelection(r.id, a.id, e.target.value || "")}
                                    className="w-full min-w-[170px] rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm"
                                    disabled={isLocked}
                                    title={isLocked ? "Locked (variant has supplier offers)" : ""}
                                  >
                                    <option value="">—</option>
                                    {(a.values || []).filter((v) => v.isActive).map((v) => (
                                      <option key={v.id} value={v.id}>
                                        {v.name}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              );
                            })}

                            <td className="p-2 align-top min-w-[130px] w-[130px]">
                              <div className="text-sm">{retailLabel}</div>

                              {!editingId && (
                                <div className="mt-1 text-[11px] text-slate-500">
                                  Variant retail comes from Supplier Offers after product creation.
                                </div>
                              )}

                              {(dupErr || emptyErr) && (
                                <div className="mt-1 text-[11px] text-rose-600">{dupErr || emptyErr}</div>
                              )}
                            </td>

                            <td className="p-2 align-top min-w-[130px] w-[130px]">
                              <span
                                className={
                                  isLocked
                                    ? "text-xs rounded-full bg-slate-900 text-white px-2 py-1"
                                    : "text-xs rounded-full bg-slate-100 text-slate-700 px-2 py-1"
                                }
                              >
                                {isLocked ? "LOCKED" : "—"}
                              </span>
                            </td>

                            <td className="p-2 align-top min-w-[130px] w-[130px]">
                              <button
                                type="button"
                                onClick={() => removeVariantRow(r.id)}
                                className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                                disabled={isLocked}
                                title={isLocked ? "Cannot remove locked variant" : "Remove row"}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      {visibleVariantRows.length === 0 && (
                        <tr>
                          <td colSpan={enabledSelectableAttrs.length + 3} className="p-3 text-slate-500">
                            No variants yet. Click “Add variant” to create option combinations.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {editingId && clearAllVariantsIntent && (
                <div className="mt-2 text-xs text-amber-700">
                  “Remove all variants” is armed. Saving will replace server variants with none.
                </div>
              )}
            </div>

            {/* Save buttons */}
            <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem(DRAFT_KEY);
                    openModal({ title: "Draft", message: "Draft cleared for this product." });
                  } catch {
                    openModal({ title: "Draft", message: "Could not clear draft." });
                  }
                }}
                className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
              >
                Clear draft
              </button>

              <button
                type="button"
                onClick={saveOrCreate}
                disabled={createM.isPending || updateM.isPending}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {createM.isPending || updateM.isPending ? "Saving…" : editingId ? "Save changes" : "Create product"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= Toolbar ================= */}
      <div className="rounded-2xl border bg-white shadow-sm p-3">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-2">
            {presetButtons.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => setPresetAndUrl(b.key)}
                className={
                  b.key === preset
                    ? "w-full sm:w-auto px-3 py-2 rounded-xl bg-slate-900 text-white text-sm"
                    : "w-full sm:w-auto px-3 py-2 rounded-xl border text-sm hover:bg-slate-50"
                }
              >
                <span className="truncate block">{b.label}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px_220px_auto] gap-2">
            <div className="min-w-0" onMouseDown={(e) => e.stopPropagation()}>
              <input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Search by title, SKU, owner, or price…"
                className="w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>

            <div className="min-w-0">
              <input
                value={supplierFilterText}
                onChange={(e) => setSupplierFilterText(e.target.value)}
                placeholder="Search supplier name…"
                className="w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>

            <div className="min-w-0">
              <select
                value={supplierFilterId}
                onChange={(e) => setSupplierIdAndUrl(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm"
              >
                <option value="">All suppliers</option>
                {(suppliersQ.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              {(supplierFilterId || supplierFilterText) && (
                <button
                  type="button"
                  onClick={() => {
                    setSupplierFilterText("");
                    setSupplierIdAndUrl("");
                  }}
                  className="shrink-0 rounded-xl border px-3 py-2 text-sm hover:bg-slate-50"
                >
                  Clear
                </button>
              )}

              <button
                type="button"
                onClick={startNewProduct}
                className="w-full sm:w-auto shrink-0 whitespace-nowrap rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                + New product
              </button>
            </div>
          </div>
        </div>
      </div>

      <PaginationBar />

      {/* ================= Mobile Cards ================= */}
      <div className="md:hidden space-y-3">
        {paginatedRows.map((p) => {
          const action = primaryActionForRow(p);
          const price = displayRetailForRow(p);
          const status = getStatus(p);
          const owner = getOwner(p) || "—";
          const supplierName = getSupplierName(p) || "—";

          const mobileLabel = (label: string) => {
            if (label === "Approve PUBLISHED") return "Approve";
            if (label === "Move to PENDING") return "Unpublish";
            if (label === "Delete") return "Delete";
            if (label === "Archive") return "Archive";
            if (label === "Revive") return "Restore";
            return label;
          };

          const statusPill =
            status === "PUBLISHED" || status === "LIVE"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : status === "PENDING"
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : status === "REJECTED"
                  ? "bg-rose-50 text-rose-700 border-rose-200"
                  : "bg-slate-50 text-slate-700 border-slate-200";

          const primaryIntent =
            action.label === "Approve PUBLISHED"
              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
              : action.label === "Move to PENDING"
                ? "bg-amber-400 hover:bg-amber-500 text-white"
                : action.label === "Revive"
                  ? "bg-sky-600 hover:bg-sky-700 text-white"
                  : action.label === "…"
                    ? "bg-zinc-400 text-white"
                    : "bg-rose-600 hover:bg-rose-700 text-white";

          return (
            <div key={p.id} className="rounded-2xl border bg-white shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{(p.title || "").trim() || "Untitled product"}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500 font-mono truncate">{p.sku || p.id}</div>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-semibold tabular-nums">₦{Number(price || 0).toLocaleString()}</div>
                  <div className="mt-1">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusPill}`}>
                      {status}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-xl bg-slate-50 border px-2.5 py-2">
                  <div className="text-[11px] text-slate-500">Offers</div>
                  <div className="mt-0.5 font-semibold text-slate-800 tabular-nums">
                    {Number((p as any).__offerCount ?? 0).toLocaleString()}
                  </div>
                </div>

                <div className="rounded-xl bg-slate-50 border px-2.5 py-2">
                  <div className="text-[11px] text-slate-500">Avail</div>
                  <div className="mt-0.5 font-semibold text-slate-800 tabular-nums">
                    {Number(p.availableQty ?? 0).toLocaleString()}
                  </div>
                </div>

                <div className="rounded-xl bg-slate-50 border px-2.5 py-2">
                  <div className="text-[11px] text-slate-500">Stock</div>
                  <div className="mt-0.5 font-semibold text-slate-800">{p.inStock ? "Yes" : "No"}</div>
                </div>
              </div>

              <div className="mt-2 text-[12px] text-slate-500 truncate">Owner: {owner}</div>
              <div className="mt-1 text-[12px] text-slate-500 truncate">Supplier: {supplierName}</div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(p)}
                  className="w-full rounded-xl border px-3 py-3 text-sm font-medium hover:bg-slate-50"
                >
                  Edit
                </button>

                <button
                  type="button"
                  title={action.title}
                  onClick={action.onClick}
                  disabled={action.disabled || deleteM.isPending || restoreM.isPending}
                  className={`w-full rounded-xl px-3 py-3 text-sm font-semibold ${primaryIntent} disabled:opacity-50`}
                >
                  <span className="block truncate">{mobileLabel(action.label)}</span>
                </button>

                {isSuper && status === "PENDING" && action.label === "Approve PUBLISHED" && (
                  <button
                    type="button"
                    onClick={() => submitStatusEdit(p.id, "reject")}
                    className="col-span-2 w-full rounded-xl bg-rose-600 text-white px-3 py-3 text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
                    disabled={updateStatusM.isPending}
                    title="Reject product"
                  >
                    Reject
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {!listQ.isLoading && displayRows.length === 0 && (
          <div className="rounded-2xl border bg-white shadow-sm p-6 text-slate-500">No products found.</div>
        )}

        {listQ.isLoading && (
          <div className="rounded-2xl border bg-white shadow-sm p-6 text-slate-500">Loading…</div>
        )}
      </div>

      <div className="md:hidden">
        <PaginationBar />
      </div>

      {/* ================= Desktop Table ================= */}
      <div className="hidden md:block rounded-2xl border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr className="text-left">
                <th className="p-3 cursor-pointer" onClick={() => toggleSort("title")}>
                  Title <SortIndicator k="title" />
                </th>
                <th className="p-3 cursor-pointer" onClick={() => toggleSort("price")}>
                  Price <SortIndicator k="price" />
                </th>
                <th className="p-3 cursor-pointer" onClick={() => toggleSort("avail")}>
                  Offers (Avail) <SortIndicator k="avail" />
                </th>
                <th className="p-3 cursor-pointer" onClick={() => toggleSort("stock")}>
                  In stock <SortIndicator k="stock" />
                </th>
                <th className="p-3 cursor-pointer" onClick={() => toggleSort("status")}>
                  Status <SortIndicator k="status" />
                </th>
                <th className="p-3 cursor-pointer" onClick={() => toggleSort("supplier")}>
                  Supplier <SortIndicator k="supplier" />
                </th>
                <th className="p-3 cursor-pointer" onClick={() => toggleSort("owner")}>
                  Owner <SortIndicator k="owner" />
                </th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>

            <tbody>
              {paginatedRows.map((p) => {
                const action = primaryActionForRow(p);
                const price = displayRetailForRow(p);

                return (
                  <tr key={p.id} className="border-t">
                    <td className="p-3">
                      <div className="font-medium">{p.title}</div>
                      <div className="text-xs text-slate-500 font-mono">{p.sku || p.id}</div>

                      {p.__bestVariantSupplierPrice ? (
                        <div className="text-[11px] text-slate-500 mt-1">
                          variant supplier price: ₦{Number(p.__bestVariantSupplierPrice).toLocaleString()}
                        </div>
                      ) : null}

                      {p.__bestBaseSupplierPrice ? (
                        <div className="text-[11px] text-slate-500 mt-1">
                          base supplier price: ₦{Number(p.__bestBaseSupplierPrice).toLocaleString()}
                        </div>
                      ) : null}

                      {(p.__bestBaseSupplierPrice || p.__bestVariantSupplierPrice) && (
                        <div className="text-[11px] text-slate-500 mt-1">
                          computed retail uses this product’s supplier price + service fee + comms fee + gateway fee
                        </div>
                      )}
                    </td>

                    <td className="p-3">₦{Number(price || 0).toLocaleString()}</td>

                    <td className="p-3">
                      {(() => {
                        const offers = Number((p as any).__offerCount ?? 0) || 0;
                        const avail = Number(p.availableQty ?? 0) || 0;
                        return `${offers.toLocaleString()} (${avail.toLocaleString()})`;
                      })()}
                    </td>

                    <td className="p-3">{p.inStock ? "Yes" : "No"}</td>
                    <td className="p-3">{getStatus(p)}</td>
                    <td className="p-3">{getSupplierName(p) || "—"}</td>
                    <td className="p-3">{getOwner(p) || "—"}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(p)}
                            className="rounded-lg border px-3 py-2 hover:bg-slate-50"
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            title={action.title}
                            onClick={action.onClick}
                            className={action.className}
                            disabled={action.disabled || deleteM.isPending || restoreM.isPending}
                          >
                            {action.label}
                          </button>

                          {isSuper && getStatus(p) === "PENDING" && action.label === "Approve PUBLISHED" && (
                            <button
                              type="button"
                              onClick={() => submitStatusEdit(p.id, "reject")}
                              className="px-3 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                              disabled={updateStatusM.isPending}
                              title="Reject product"
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!listQ.isLoading && displayRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-slate-500">
                    No products found.
                  </td>
                </tr>
              )}

              {listQ.isLoading && (
                <tr>
                  <td colSpan={8} className="p-6 text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationBar />
    </div>
  );
}