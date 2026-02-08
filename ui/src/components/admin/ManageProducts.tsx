// src/components/admin/ManageProducts.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useModal } from "../ModalProvider";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounced } from "../../utils/useDebounced";
import { useSearchParams } from "react-router-dom";
import api from "../../api/client";
import { getHttpErrorMessage } from "../../utils/httpError";
import SuppliersOfferManager from "./SuppliersOfferManager";

/* ============================
   Types
============================ */

type SupplierOfferLite = {
  id: string;
  productId: string;
  variantId?: string | null;
  supplierId: string;
  supplierName?: string;
  isActive?: boolean;
  inStock?: boolean;
  availableQty?: number;
  available?: number;
  qty?: number;
  stock?: number;

  // pricing variants
  unitCost?: number | string | null;
  unitPrice?: number | string | null;
  cost?: number | string | null;
  supplierPrice?: number | string | null;
  basePrice?: number | string | null;
  price?: number | string | null;
  amount?: number | string | null;
};

type AdminProduct = {
  id: string;
  title: string;
  price: number | string;
  status: string;
  imagesJson?: string[] | string;
  createdAt?: string;
  retailPrice?: number | string | null;
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
  sku?: string | null;
  inStock?: boolean;

  variants?: any[];
  variantCount?: number;

  createdByEmail?: string | null;
  createdBy?: { email?: string | null };
  owner?: { email?: string | null };
  description?: string | null;

  // derived debug (optional)
  __baseQty?: number;
  __offerQty?: number;
  __offerCount?: number;

  // derived pricing (optional)
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
  selections: Record<string, string>; // attributeId -> valueId

  // ✅ schema-aligned: ProductVariant.retailPrice (mapped to "price" in DB)
  retailPrice: string;

  inStock?: boolean;
  availableQty?: number;
  imagesJson?: string[];
};

type AttrDef = { id: string; name?: string };

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

/**
 * ✅ NEW: detect whether an offer row *explicitly* provides any quantity field.
 * If qty isn't provided, we still consider the price for "best/cheapest" selection.
 */
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

/**
 * ✅ NEW: pick the cheapest positive number from candidates.
 */
function minPositive(...nums: Array<number | null | undefined>) {
  const arr = nums.map((n) => Number(n ?? 0)).filter((n) => Number.isFinite(n) && n > 0);
  if (!arr.length) return 0;
  return arr.reduce((m, v) => (v < m ? v : m), Number.POSITIVE_INFINITY);
}

/**
 * Extracts supplier-side "cost/price" from a supplier offer row across DTO variants.
 */
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

/**
 * ✅ Retail price calculation logic:
 * retail = supplierCost + supplierCost * (markupPercent/100)
 * Rounded to integer NGN.
 */
function applyMarkup(cost: number, pct: number) {
  const c = Number(cost);
  const p = Number(pct);
  if (!Number.isFinite(c) || c <= 0) return 0;
  const pp = Number.isFinite(p) ? p : 0;
  return Math.round(c * (1 + pp / 100));
}

async function fetchSupplierOffersForProduct(productId: string, token?: string | null) {
  const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

  const attempts = [
    `/api/admin/products/${encodeURIComponent(productId)}/supplier-offers`,
    `/api/admin/supplier-offers?productId=${encodeURIComponent(productId)}`,
  ];

  for (const url of attempts) {
    try {
      const { data } = await api.get(url, { headers: hdr });
      const root = data?.data?.data ?? data?.data ?? data;
      const arr = Array.isArray(root) ? root : Array.isArray(root?.data) ? root.data : [];
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

function buildComboKey(row: VariantRow, attrs: AttrDef[]): string {
  const parts = attrs.map((a) => `${a.id}:${String(row?.selections?.[a.id] ?? "").trim()}`);
  const allEmpty = parts.every((p) => p.endsWith(":"));
  return allEmpty ? "" : parts.join("|");
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

/* ============================
   Variants persistence (tries multiple endpoints)
============================ */

async function persistVariantsStrict(productId: string, variants: any[], token?: string | null, opts?: { replace?: boolean }) {
  const replace = opts?.replace ?? true;
  const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

  const clean = (variants || []).map((v) => {
    const id = normalizeId(v?.id);
    const sku = String(v?.sku ?? "").trim();

    const retailPriceNum = toNumberLoose(v?.retailPrice ?? v?.price);

    return {
      ...(id ? { id } : {}),
      ...(!id && sku ? { sku } : {}),
      ...(retailPriceNum != null ? { retailPrice: retailPriceNum } : {}),

      // ✅ schema: options are just attributeId/valueId (+ optional unitPrice if you ever use it)
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
      const req = a.method === "put" ? api.put(a.url, a.body, { headers: hdr }) : api.post(a.url, a.body, { headers: hdr });
      const { data } = await req;
      return data;
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 404 || status === 405) {
        lastErr = e;
        continue;
      }
      const msg = e?.response?.data?.detail || e?.response?.data?.error || e?.message || "Failed to persist variants";
      // eslint-disable-next-line no-console
      console.error("persistVariantsStrict error:", status, e?.response?.data || e);
      throw new Error(msg);
    }
  }

  // eslint-disable-next-line no-console
  console.error("No variants bulk endpoint found. Last error:", lastErr?.response?.status, lastErr?.response?.data);
  throw new Error("Your API does not expose a variants bulk endpoint. Add one server-side or update the frontend to match your backend route.");
}

/* ============================
   Component
============================ */

export function ManageProducts({
  role,
  token,
  search,
  setSearch,
  focusId,
  onFocusedConsumed,
}: {
  role: string;
  token?: string | null;
  search: string;
  setSearch: (s: string) => void;
  focusId: string | null;
  onFocusedConsumed: () => void;
}) {
  const { openModal } = useModal();
  const isSuper = role === "SUPER_ADMIN";
  const isAdmin = role === "ADMIN";
  const qc = useQueryClient();
  const staleTimeInMs = 300_000;

  // stop spamming /has-orders when route doesn't exist (404)
  const hasOrdersSupportRef = useRef<"unknown" | "supported" | "unsupported">("unknown");
  const hasOrdersProbeDoneRef = useRef(false);

  /**
   * ✅ FIX:
   * Keep search fully local; only sync to parent onBlur to avoid tab remounts.
   */
  const [qInput, setQInput] = useState(search || "");
  useEffect(() => {
    setQInput(search || "");
  }, [search]);

  const debouncedQ = useDebounced(qInput, 350);

  /* ---------------- Pricing Markup Setting ---------------- */

  // ✅ CHANGED: default to 10% if setting missing/invalid
  const DEFAULT_MARKUP_PERCENT = 10;

  const markupQ = useQuery<number>({
    queryKey: ["admin", "settings", "pricingMarkupPercent"],

    // ✅ CHANGED: allow ADMIN too (was SUPER_ADMIN-only)
    enabled: !!token && (role === "SUPER_ADMIN" || role === "ADMIN"),

    queryFn: async () => {
      const { data } = await api.get("/api/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });

      // backend returns a plain array of rows
      const arr = Array.isArray(data) ? data : Array.isArray((data as any)?.data) ? (data as any).data : [];

      const row = arr.find((r: any) => {
        const k = String(r?.key || "").trim();
        return k === "pricingMarkupPercent" || k === "marginPercent";
      });

      // ✅ CHANGED: fallback to 10 if missing/0/invalid
      const n = toNumberLoose(row?.value);
      return n != null && Number.isFinite(n) && n > 0 ? n : DEFAULT_MARKUP_PERCENT;
    },

    // ✅ make it always recalc when you come back to the tab/window
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

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

  function buildSkuFromTitle(title: string) {
    const out = skuSafePart(title);
    return out || `PRODUCT-${Date.now()}`;
  }

  // ✅ CHANGED: ensure we never regress to old fallback; use DEFAULT_MARKUP_PERCENT
  const pricingMarkupPercent =
    Number.isFinite(Number(markupQ.data)) && Number(markupQ.data) > 0 ? Number(markupQ.data) : DEFAULT_MARKUP_PERCENT;

  /* ---------------- Tabs / Filters ---------------- */
  const [searchParams, setSearchParams] = useSearchParams();

  const urlPreset = (searchParams.get("view") as FilterPreset) || "all";
  const [preset, setPreset] = useState<FilterPreset>(urlPreset);

  useEffect(() => {
    setPreset((searchParams.get("view") as FilterPreset) || "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  function setPresetAndUrl(next: FilterPreset) {
    setPreset(next);
    const sp = new URLSearchParams(searchParams);
    if (next && next !== "all") sp.set("view", next);
    else sp.delete("view");
    setSearchParams(sp, { replace: true });
  }

  type SortKey = "title" | "price" | "avail" | "stock" | "status" | "owner";
  type SortDir = "asc" | "desc";
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "title", dir: "asc" });

  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const SortIndicator = ({ k }: { k: SortKey }) => {
    if (sort.key !== k) return <span className="opacity-50">↕</span>;
    return <span>{sort.dir === "asc" ? "↑" : "↓"}</span>;
  };

  function extractOfferProductId(o: any): string | null {
    return normalizeNullableId(o?.productId?.id ?? o?.product?.id ?? o?.productId);
  }

  function extractOfferSupplierId(o: any): string | null {
    return normalizeNullableId(o?.supplierId?.id ?? o?.supplier?.id ?? o?.supplierId);
  }

  /**
   * ✅ Robust variantId extraction:
   * - supports variantId as string/object
   * - supports compat IDs like: "variant:<id>" (and ignores "base:<...>")
   */
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

  /* ---------------- Queries ---------------- */

  const listQ = useQuery<AdminProduct[]>({
    queryKey: ["admin", "products", "manage", { q: debouncedQ, statusParam }],
    enabled: !!token,
    queryFn: async () => {
      const { data } = await api.get("/api/admin/products", {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          status: statusParam,
          q: debouncedQ,
          take: 50,
          skip: 0,
          include: "owner,variants,supplierOffers",
        },
      });
      const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      return (arr ?? []) as AdminProduct[];
    },
    staleTime: staleTimeInMs,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (listQ.isError) {
      const e: any = listQ.error;
      // eslint-disable-next-line no-console
      console.error("Products list failed:", e?.response?.status, e?.response?.data || e?.message);
    }
  }, [listQ.isError, listQ.error]);

  const rows = listQ.data ?? [];

  // productId -> Set(variantIds)
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

  /**
   * ✅ Bulk offers summary:
   * - availability summary
   * - best base supplier price per product
   * - best variant supplier price per product (for "From" pricing)
   */
  const offersSummaryQ = useQuery({
    queryKey: ["admin", "products", "offers-summary", { ids: rows.map((r) => r.id), variantIdsHash }],
    enabled: !!token && rows.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async () => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      const productIds = rows.map((r) => r.id);
      if (!productIds.length) return {};

      const qs = new URLSearchParams();
      qs.set("productIds", productIds.join(","));

      const { data } = await api.get(`/api/admin/supplier-offers?${qs}`, { headers: hdr });

      const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const offers = (arr as SupplierOfferLite[]).filter((o) => !!(o as any));

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

          minBaseSupplierPrice: number; // base rows only (variantId null)
          minVariantSupplierPrice: number; // variant rows only (variantId present)
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

        // ✅ CHANGED: if qty isn't explicitly provided, still allow price to be considered
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

            minBaseSupplierPrice: Number.POSITIVE_INFINITY,
            minVariantSupplierPrice: Number.POSITIVE_INFINITY,
          };
        }

        byProduct[pid].offerCountTotal += 1;
        if (isActive) byProduct[pid].activeOfferCount += 1;

        // base min
        if (!vid) {
          const cost = offerUnitCost(o);
          const ok =
            isActive &&
            isInStock &&
            cost != null &&
            Number.isFinite(cost) &&
            cost > 0 &&
            (availableQty > 0 || !qtyKnown); // ✅ CHANGED
          if (ok && cost < byProduct[pid].minBaseSupplierPrice) {
            byProduct[pid].minBaseSupplierPrice = cost;
          }
        }

        // variant min
        if (vid) {
          const cost = offerUnitCost(o);
          const ok =
            isActive &&
            isInStock &&
            cost != null &&
            Number.isFinite(cost) &&
            cost > 0 &&
            (availableQty > 0 || !qtyKnown); // ✅ CHANGED
          if (ok && cost < byProduct[pid].minVariantSupplierPrice) {
            byProduct[pid].minVariantSupplierPrice = cost;
          }
        }

        // availability totals still require known qty > 0
        if (isActive && isInStock && availableQty > 0) {
          byProduct[pid].totalAvailable += availableQty;
          if (vid) byProduct[pid].variantAvailable += availableQty;
          else byProduct[pid].baseAvailable += availableQty;

          byProduct[pid].perSupplier.push({ supplierId, supplierName: (o as any).supplierName, availableQty });
        }
      }

      Object.values(byProduct).forEach((s) => {
        s.inStock = s.totalAvailable > 0;
      });

      for (const pid of Object.keys(byProduct)) {
        const s = byProduct[pid];
        if (!Number.isFinite(s.minBaseSupplierPrice)) s.minBaseSupplierPrice = 0;
        if (!Number.isFinite(s.minVariantSupplierPrice)) s.minVariantSupplierPrice = 0;
      }

      return byProduct;
    },
  });

  // Derive availability, offer count, and computed pricing into rows
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

      const bestBaseSupplier = Number(s?.minBaseSupplierPrice ?? 0) || 0;
      const bestVariantSupplier = Number(s?.minVariantSupplierPrice ?? 0) || 0;

      /**
       * ✅ FIX:
       * Product "FROM" price should be computed from the CHEAPEST purchasable offer overall,
       * across BOTH base + variant offers.
       */
      const fromSupplierCost = minPositive(bestBaseSupplier, bestVariantSupplier);

      const computedRetailFrom = fromSupplierCost > 0 ? applyMarkup(fromSupplierCost, pricingMarkupPercent) : 0;

      return {
        ...p,
        availableQty: finalAvail,
        inStock,
        __baseQty: baseQty,
        __offerQty: offerQty,
        __offerCount: offerCount,

        __bestBaseSupplierPrice: bestBaseSupplier > 0 ? bestBaseSupplier : undefined,
        __bestVariantSupplierPrice: bestVariantSupplier > 0 ? bestVariantSupplier : undefined,
        __computedRetailFrom: computedRetailFrom > 0 ? computedRetailFrom : undefined,
      } as any;
    });
  }, [rows, offersSummaryQ.data, pricingMarkupPercent]);

  /* ---------------- Status helpers ---------------- */

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
      (await api.post(`/api/admin/products/${id}/status`, { status }, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
    onError: (e) =>
      openModal({
        title: "Products",
        message: getHttpErrorMessage(e, "Status update failed"),
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

  /* ---------------- Lookups ---------------- */

  const catsQ = useQuery<AdminCategory[]>({
    queryKey: ["admin", "products", "cats"],
    enabled: !!token,
    queryFn: async () => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      const attempts = ["/api/admin/categories", "/api/categories", "/api/catalog/categories"];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, { headers: hdr });
          const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          if (Array.isArray(arr)) return arr;
        } catch {}
      }
      return [];
    },
    staleTime: staleTimeInMs,
    refetchOnWindowFocus: false,
  });

  const brandsQ = useQuery<AdminBrand[]>({
    queryKey: ["admin", "products", "brands"],
    enabled: !!token,
    queryFn: async () => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      const attempts = ["/api/admin/brands", "/api/brands"];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, { headers: hdr });
          const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          if (Array.isArray(arr)) return arr;
        } catch {}
      }
      return [];
    },
    staleTime: staleTimeInMs,
    refetchOnWindowFocus: false,
  });

  const suppliersQ = useQuery<AdminSupplier[]>({
    queryKey: ["admin", "products", "suppliers"],
    enabled: !!token,
    refetchOnWindowFocus: false,
    staleTime: staleTimeInMs,
    queryFn: async () => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      const attempts = ["/api/admin/suppliers"];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, { headers: hdr });
          const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          if (Array.isArray(arr)) return arr;
        } catch {}
      }
      return [];
    },
  });

  const attrsQ = useQuery<AdminAttribute[]>({
    queryKey: ["admin", "products", "attributes"],
    enabled: !!token,
    queryFn: async () => {
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const attempts = ["/api/admin/attributes", "/api/attributes"];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, { headers });
          const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          if (Array.isArray(arr)) return arr;
        } catch {}
      }
      return [];
    },
    staleTime: staleTimeInMs,
    refetchOnWindowFocus: false,
  });

  /* ---------------- Mutations ---------------- */

  const createM = useMutation({
    mutationFn: async (payload: any) =>
      (await api.post("/api/admin/products", payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onError: (e) =>
      openModal({
        title: "Products",
        message: getHttpErrorMessage(e, "Create failed"),
      }),
  });

  const updateM = useMutation({
    mutationFn: async ({ id, ...payload }: any) =>
      (await api.patch(`/api/admin/products/${id}`, payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onError: (e) =>
      openModal({
        title: "Products",
        message: getHttpErrorMessage(e, "Update failed"),
      }),
  });

  const restoreM = useMutation({
    mutationFn: async (id: string) => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      const res = await api.post(`/api/admin/products/${encodeURIComponent(id)}/restore`, {}, { headers: hdr });
      return (res as any).data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] });
    },
    onError: (e) =>
      openModal({
        title: "Products",
        message: getHttpErrorMessage(e, "Restore failed"),
      }),
  });

  async function ensureHasOrdersSupport(sampleId: string) {
    if (!token) return "unsupported" as const;
    if (hasOrdersSupportRef.current !== "unknown") return hasOrdersSupportRef.current;
    if (hasOrdersProbeDoneRef.current) return hasOrdersSupportRef.current;

    hasOrdersProbeDoneRef.current = true;

    try {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      await api.get(`/api/admin/products/${encodeURIComponent(sampleId)}/has-orders`, { headers: hdr });
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
    enabled: !!token && rowsWithDerived.length > 0 && hasOrdersSupportRef.current !== "unsupported",
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async () => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      const ids = rowsWithDerived.map((r) => r.id);

      if (!ids.length) return {};

      const support = await ensureHasOrdersSupport(ids[0]);
      if (support === "unsupported") return Object.fromEntries(ids.map((id) => [id, false] as const));

      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const { data } = await api.get(`/api/admin/products/${encodeURIComponent(id)}/has-orders`, { headers: hdr });
            const has =
              typeof data === "boolean"
                ? data
                : typeof data?.hasOrders === "boolean"
                ? data.hasOrders
                : typeof data?.data?.hasOrders === "boolean"
                ? data.data.hasOrders
                : typeof data?.has === "boolean"
                ? data.has
                : typeof data?.data?.has === "boolean"
                ? data.data.has
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
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

      let has = hasOrder(id);

      if (hasOrdersSupportRef.current === "unsupported") {
        has = false;
      } else if (hasOrdersQ.isLoading || hasOrdersQ.data == null) {
        const support = await ensureHasOrdersSupport(id);
        if (support === "unsupported") {
          has = false;
        } else {
          try {
            const { data } = await api.get(`/api/admin/products/${encodeURIComponent(id)}/has-orders`, { headers: hdr });
            has = !!(data?.data?.has ?? data?.has ?? data);
          } catch (e: any) {
            const status = e?.response?.status;
            if (status === 404) hasOrdersSupportRef.current = "unsupported";
            has = false;
          }
        }
      }

      const url = has ? `/api/admin/products/${id}/soft-delete` : `/api/admin/products/${id}`;
      const res = await api.delete(url, { headers: hdr });
      return (res as any).data?.data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] });
    },
  });

  /* ---------------- Editor state ---------------- */

  const defaultPending = {
    title: "",
    price: "",
    status: "PENDING",
    categoryId: "",
    brandId: "",
    supplierId: "",
    supplierAvailableQty: "",
    sku: "",
    imageUrls: "",
    description: "",
  };

  const [offersProductId, setOffersProductId] = useState<string | null>(null);
  const [pending, setPending] = useState(defaultPending);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const selectableAttrs = useMemo(() => (attrsQ.data || []).filter((a) => a.type === "SELECT" && a.isActive), [attrsQ.data]);

  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);
  const [offerVariants, setOfferVariants] = useState<any[]>([]);
  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string | string[]>>({});
  const [variantsDirty, setVariantsDirty] = useState(false);
  const [clearAllVariantsIntent, setClearAllVariantsIntent] = useState(false);
  const initialVariantIdsRef = useRef<Set<string>>(new Set());

  function isRealVariantId(id?: string) {
    return !!id && !id.startsWith("vr-") && !id.startsWith("new-") && !id.startsWith("temp-") && !id.startsWith("tmp:") && !id.startsWith("tmp-");
  }

  useEffect(() => {
    if (!selectableAttrs.length) return;
    const ids = selectableAttrs.map((a) => a.id);
    setVariantRows((rows) =>
      rows.map((row) => {
        const next: Record<string, string> = {};
        ids.forEach((id) => {
          next[id] = row.selections[id] || "";
        });
        return { ...row, selections: next };
      })
    );
  }, [selectableAttrs]);

  const DRAFT_KEY = useMemo(() => `adminProductDraft:${editingId ?? "new"}`, [editingId]);
  const skipDraftLoadRef = useRef(false);

  useEffect(() => {
    if (skipDraftLoadRef.current) return;

    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;

    try {
      const d = JSON.parse(raw);
      if (d?.pending) setPending(d.pending);
      if (Array.isArray(d?.variantRows)) setVariantRows(d.variantRows);
      if (d?.selectedAttrs) setSelectedAttrs(d.selectedAttrs);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [DRAFT_KEY]);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ pending, variantRows, selectedAttrs }));
  }, [DRAFT_KEY, pending, variantRows, selectedAttrs]);

  const lockedVariantIdsQ = useQuery<string[]>({
    queryKey: ["admin", "products", "locked-variant-ids", { productId: editingId }],
    enabled: !!token && !!editingId,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async () => {
      const offers = await fetchSupplierOffersForProduct(editingId!, token);
      const locked = new Set<string>();
      for (const o of offers) {
        const vid = extractOfferVariantId(o);
        if (vid) locked.add(vid);
      }
      return Array.from(locked);
    },
  });

  const lockedVariantIds = useMemo(() => new Set<string>(lockedVariantIdsQ.data ?? []), [lockedVariantIdsQ.data]);

  /**
   * Extracts the VARIANT TOTAL PRICE from a supplier variant offer row.
   * (No more bump concept.)
   */
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

  /**
   * Offer price caps (CHEAPEST):
   * - minBase: cheapest supplier base price (variantId null)
   * - minVariantByVariant: cheapest supplier VARIANT TOTAL PRICE per variantId
   * - minVariantOverall: cheapest variant offer overall
   */
  const offerPriceCapsQ = useQuery<{
    minBase: number;
    minVariantByVariant: Record<string, number>;
    minVariantOverall: number;
  }>({
    queryKey: ["admin", "products", "offer-price-caps", { productId: editingId }],
    enabled: !!token && !!editingId,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async () => {
      const offers = await fetchSupplierOffersForProduct(editingId!, token);

      // supplierId -> cheapest base price for that supplier
      const baseBySupplier: Record<string, number> = {};

      // 1) capture BASE per supplier (variantId null)
      for (const o of offers ?? []) {
        const vid = extractOfferVariantId(o);
        if (vid) continue;

        const sid = extractOfferSupplierId(o);
        if (!sid) continue;

        const isActive = coerceBool((o as any).isActive, true);
        const isInStock = coerceBool((o as any).inStock, true);
        const availableQty = availOf(o) || 0;

        // ✅ CHANGED: accept price when qty isn't explicitly provided
        const qtyKnown = hasExplicitQty(o);

        if (!isActive || !isInStock) continue;
        if (!(availableQty > 0 || !qtyKnown)) continue;

        const base = offerUnitCost(o);
        if (base == null || !Number.isFinite(base) || base <= 0) continue;

        const prev = baseBySupplier[sid];
        if (!prev || base < prev) baseBySupplier[sid] = base;
      }

      // 2) cheapest STANDALONE variant price per variantId across suppliers
      const minVariantByVariant: Record<string, number> = {};

      for (const o of offers ?? []) {
        const variantId = extractOfferVariantId(o);
        if (!variantId) continue;

        const rawSid = (o as any)?.supplierId?.id ?? (o as any)?.supplier?.id ?? (o as any)?.supplierId;
        const sid = normalizeNullableId(rawSid);
        if (!sid) continue;

        const isActive = coerceBool((o as any).isActive, true);
        const isInStock = coerceBool((o as any).inStock, true);
        const availableQty = availOf(o) || 0;

        // ✅ CHANGED: accept price when qty isn't explicitly provided
        const qtyKnown = hasExplicitQty(o);

        if (!isActive || !isInStock) continue;
        if (!(availableQty > 0 || !qtyKnown)) continue;

        const variantPriceRaw = offerVariantPrice(o);
        if (variantPriceRaw == null || !Number.isFinite(variantPriceRaw) || variantPriceRaw <= 0) continue;

        const prev = minVariantByVariant[variantId];
        if (!prev || variantPriceRaw < prev) minVariantByVariant[variantId] = variantPriceRaw;
      }

      // 3) cheapest base across suppliers
      const minBaseRaw = Object.values(baseBySupplier).reduce((m, v) => (v > 0 && v < m ? v : m), Number.POSITIVE_INFINITY);

      const minVariantOverall = Object.values(minVariantByVariant).reduce((m, v) => (v > 0 && v < m ? v : m), Number.POSITIVE_INFINITY);

      const minBase = Number.isFinite(minBaseRaw) && minBaseRaw > 0 ? minBaseRaw : 0;
      const minVariantOverallFinal = Number.isFinite(minVariantOverall) && minVariantOverall > 0 ? minVariantOverall : 0;

      return {
        minBase,
        minVariantByVariant,
        minVariantOverall: minVariantOverallFinal,
      };
    },
  });

  const offerPriceCaps =
    offerPriceCapsQ.data ?? {
      minBase: 0,
      minVariantByVariant: {} as Record<string, number>,
      minVariantOverall: 0,
    };

  /**
   * ✅ IMPORTANT CHANGE:
   * Do NOT hide variants that don't yet have supplier offers.
   * Only variants that ADMIN has manually added to the combos list should exist/appear.
   */
  const visibleVariantRows = useMemo(() => {
    return Array.isArray(variantRows) ? variantRows : [];
  }, [variantRows]);

  const comboErrors = useMemo(() => findDuplicateCombos(visibleVariantRows ?? [], selectableAttrs ?? []), [visibleVariantRows, selectableAttrs]);
  const hasDuplicateCombos = Object.keys(comboErrors).length > 0;

  const emptyRowErrors = useMemo(() => findEmptyRowErrors(visibleVariantRows ?? []), [visibleVariantRows]);

  // ✅ computed product retail (editing): "FROM" price
  const computedRetailFromEditing = useMemo(() => {
    if (!editingId) return null;

    const baseCost = Number(offerPriceCaps?.minBase ?? 0) || 0;
    const variantCost = Number(offerPriceCaps?.minVariantOverall ?? 0) || 0;

    /**
     * ✅ FIX:
     * Editor "FROM" price should use the CHEAPEST purchasable offer overall (base or variant).
     */
    const fromCost = minPositive(baseCost, variantCost);

    if (fromCost <= 0) return null;
    return applyMarkup(fromCost, pricingMarkupPercent);
  }, [editingId, offerPriceCaps?.minBase, offerPriceCaps?.minVariantOverall, pricingMarkupPercent]);

  // When editing + caps load, force the displayed price to computed retail (NOT editable)
  useEffect(() => {
    if (!editingId) return;
    if (computedRetailFromEditing == null) return;
    setPending((p) => ({ ...p, price: String(computedRetailFromEditing) }));
  }, [editingId, computedRetailFromEditing]);

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

  /* ============================
     ✅ Image upload (file picker)
  ============================ */

  const filePickRef = useRef<HTMLInputElement | null>(null);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [uploadInfo, setUploadInfo] = useState<string>("");
  const [isRefreshingProduct, setIsRefreshingProduct] = useState(false);

  async function refreshEditingProduct() {
    const pid = editingId;
    if (!pid) return;

    setIsRefreshingProduct(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin", "settings", "pricingMarkupPercent"] }),
        qc.invalidateQueries({ queryKey: ["admin", "products", "locked-variant-ids", { productId: pid }] }),
        qc.invalidateQueries({ queryKey: ["admin", "products", "offers-summary"] }),
        qc.invalidateQueries({ queryKey: ["admin", "products", "offer-price-caps", { productId: pid }] }),
        qc.invalidateQueries({ queryKey: ["admin", "products", "manage"] }),
        qc.invalidateQueries({ queryKey: ["admin", "product", pid, "variants"] }),
        qc.invalidateQueries({ queryKey: ["admin", "products", pid, "supplier-offers"] }),
      ]);

      const refreshed = await fetchProductFull(pid);

      const nextRowsRaw = buildVariantRowsFromServerVariants(refreshed.variants || []);
      const nextRows = dedupeVariantRowsByCombo(nextRowsRaw, selectableAttrs);

      setVariantRows(nextRows);
      initialVariantIdsRef.current = new Set(nextRows.map((r) => r.id).filter((id) => isRealVariantId(id)));

      setOfferVariants(refreshed.variants || []);
      setOffersProductId(refreshed.id);

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
      }));
    } catch (e: any) {
      openModal({ title: "Refresh product", message: getHttpErrorMessage(e, "Failed to refresh product") });
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
    if (!token) {
      openModal({ title: "Images", message: "You must be logged in to upload images." });
      return;
    }

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
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
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
      openModal({ title: "Images", message: getHttpErrorMessage(e, "Image upload failed") });
      setUploadInfo("");
    } finally {
      setIsUploadingImages(false);
      if (filePickRef.current) filePickRef.current.value = "";
    }
  }

  /* ---------------- Variant row helpers ---------------- */

  function makeTempRowId() {
    return `tmp:${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function touchVariants() {
    setVariantsDirty(true);
  }

  function makeEmptySelections() {
    const selections: Record<string, string> = {};
    (selectableAttrs || []).forEach((a) => (selections[a.id] = ""));
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
      retailPrice: "",
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

  function setVariantRowRetailPrice(rowId: string, retail: string) {
    const rid = String(rowId || "").trim();
    if (!rid) return;

    setVariantRows((prev) => {
      const rows = Array.isArray(prev) ? prev : [];
      return rows.map((r) => (String(r?.id) === rid ? { ...r, retailPrice: retail } : r));
    });

    touchVariants();
  }

  /**
   * ✅ Variant retail (schema-aligned)
   * - editing mode: computed from cheapest supplier VARIANT offer + markup
   * - if a variant has no variant offer, we show "—" (unchanged behaviour)
   */
  function computedVariantRetail(row: VariantRow) {
    const baseSupplier = offerPriceCaps.minBase || 0;
    const baseRetailComputed = baseSupplier > 0 ? applyMarkup(baseSupplier, pricingMarkupPercent) : 0;

    const vid = String(row?.id ?? "").trim();
    const supplierVariant = vid && isRealVariantId(vid) ? Number(offerPriceCaps.minVariantByVariant?.[vid] ?? 0) || 0 : 0;

    if (editingId) {
      if (supplierVariant > 0) {
        const variantRetailComputed = applyMarkup(supplierVariant, pricingMarkupPercent);
        return { baseRetail: baseRetailComputed, variantRetail: variantRetailComputed, hasComputed: true };
      }
      return { baseRetail: baseRetailComputed || 0, variantRetail: -1, hasComputed: false };
    }

    const fromInput = toNumberLoose(row?.retailPrice);
    const baseFallback = Number(pending.price) || 0;

    return {
      baseRetail: baseFallback,
      variantRetail: fromInput != null ? fromInput : baseFallback,
      hasComputed: false,
    };
  }

  /* ---------------- Full product loader ---------------- */

  async function fetchProductFull(id: string) {
    const { data } = await api.get(`/api/admin/products/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { include: "variants,attributes,brand,supplier,owner" },
    });

    const prod = data?.data?.data ?? data?.data ?? data ?? {};

    const rawVariants =
      (Array.isArray(prod?.variants) && prod.variants) ||
      (Array.isArray(prod?.ProductVariant) && prod.ProductVariant) ||
      (Array.isArray(prod?.productVariants) && prod.productVariants) ||
      [];

    const pickFirstNonEmptyArray = (...cands: any[]): any[] => {
      for (const c of cands) if (Array.isArray(c) && c.length > 0) return c;
      return [];
    };

    const variantsNormalized = (rawVariants || []).map((v: any) => {
      const vid = normalizeNullableId(v?.id) || normalizeNullableId(v?.variantId) || normalizeNullableId(v?.variant?.id);

      const pickedOptions = pickFirstNonEmptyArray(
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
      (Array.isArray(prod?.attributes?.options) && prod.attributes.options) ||
      (Array.isArray(prod?.attributeValues) && prod.attributeValues) ||
      (Array.isArray(prod?.attributeOptions) && prod.attributeOptions) ||
      [];

    const attributeTexts =
      (Array.isArray(prod?.attributes?.texts) && prod.attributes.texts) ||
      (Array.isArray(prod?.attributeTexts) && prod.attributeTexts) ||
      (Array.isArray(prod?.ProductAttributeText) && prod.ProductAttributeText) ||
      [];

    const supplierId = normalizeNullableId(prod?.supplierId) || normalizeNullableId(prod?.supplier?.id) || null;

    return {
      ...prod,
      variants: variantsNormalized,
      variantsNormalized,
      supplierId,
      imagesJson: Array.isArray(prod?.imagesJson) ? prod.imagesJson : [],
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

      const retail = toNumberLoose(v?.retailPrice ?? v?.price ?? v?.retailPrice?.amount ?? v?.price?.amount) ?? null;

      const hasAnyPick = Object.values(selections).some((x) => !!String(x || "").trim());
      if (!hasAnyPick) continue;

      const id = normalizeNullableId(v?.id) || normalizeNullableId(v?.variantId) || normalizeNullableId(v?.variant?.id);
      if (!id) continue;

      vr.push({
        id: String(id),
        selections,
        retailPrice: retail != null ? String(retail) : "",
        inStock: coerceBool(v?.inStock, true),
        availableQty: toInt(v?.availableQty ?? v?.available ?? v?.qty ?? v?.stock, 0),
        imagesJson: Array.isArray(v?.imagesJson) ? v.imagesJson : [],
      });
    }

    return vr;
  }

  const imagePreviewUrls = useMemo(() => {
    return parseUrlList(pending.imageUrls || "").filter(isUrlish);
  }, [pending.imageUrls]);

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
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Could not load product variants for offers.");
    }
  }

  function validateRetailAboveSupplierPrices(args: {
    baseRetail: number;
    variantRows: VariantRow[];
    caps: { minBase: number; minVariantByVariant: Record<string, number>; minVariantOverall: number };
  }) {
    const { baseRetail, variantRows, caps } = args;
    const errors: string[] = [];

    /**
     * ✅ FIX:
     * Validate product FROM retail against the CHEAPEST purchasable cost overall (base or variant).
     */
    const fromCost = minPositive(caps.minBase, caps.minVariantOverall);

    if (fromCost > 0) {
      const neededFromRetail = applyMarkup(fromCost, pricingMarkupPercent);
      if (baseRetail < neededFromRetail) {
        errors.push(
          `Retail price must be >= computed FROM price (cheapest supplier cost ₦${fromCost.toLocaleString()} + markup ${pricingMarkupPercent}%).`
        );
      }
    }

    // validate each variant retail (computed) when we have supplier offers for that variant
    for (const r of variantRows ?? []) {
      const vid = String(r?.id ?? "").trim();
      if (!vid || !isRealVariantId(vid)) continue;

      const supplierVariant = Number(caps.minVariantByVariant?.[vid] ?? 0) || 0;
      if (supplierVariant <= 0) continue;

      const neededVariantRetail = applyMarkup(supplierVariant, pricingMarkupPercent);
      const shownVariantRetail = neededVariantRetail;

      if (shownVariantRetail < neededVariantRetail) {
        errors.push(`Variant (${vid}) retail must be >= ₦${neededVariantRetail.toLocaleString()} (cheapest supplier variant price + markup).`);
      }
    }

    return { ok: errors.length === 0, errors };
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

  /* ---------------- Payload builder (variants) ---------------- */
  function buildProductPayload({
    base,
    selectedAttrs,
    variantRows,
    attrsAll,
  }: {
    base: {
      title: string;
      price: number;
      status: string;
      sku?: string;
      categoryId?: string;
      brandId?: string;
      supplierId?: string;
      imagesJson?: string[];
      description?: string | null;
      ownerId?: string | null;
      availableQty?: number;
      inStock?: boolean;
      retailPrice?: number;
    };
    selectedAttrs: Record<string, string | string[]>;
    variantRows: VariantRow[];
    attrsAll: AdminAttribute[];
  }) {
    const payload: any = { ...base };
    if (payload.sku) payload.sku = skuSafePart(payload.sku);

    const attributeSelections: any[] = [];
    const attributeValues: Array<{ attributeId: string; valueId?: string; valueIds?: string[] }> = [];
    const attributeTexts: Array<{ attributeId: string; value: string }> = [];

    for (const a of attrsAll) {
      const sel = selectedAttrs[a.id];
      if (sel == null || (Array.isArray(sel) && sel.length === 0) || (typeof sel === "string" && sel.trim() === "")) continue;

      if (a.type === "TEXT") {
        attributeSelections.push({ attributeId: a.id, text: String(sel) });
        attributeTexts.push({ attributeId: a.id, value: String(sel) });
      } else if (a.type === "SELECT") {
        const valueId = String(sel);
        attributeSelections.push({ attributeId: a.id, valueId });
        attributeValues.push({ attributeId: a.id, valueId });
      } else if (a.type === "MULTISELECT") {
        const valueIds = (sel as string[]).map(String);
        attributeSelections.push({ attributeId: a.id, valueIds });
        attributeValues.push({ attributeId: a.id, valueIds });
      }
    }

    if (attributeSelections.length) payload.attributeSelections = attributeSelections;
    if (attributeValues.length) payload.attributeValues = attributeValues;
    if (attributeTexts.length) payload.attributeTexts = attributeTexts;

    const selectable = (attrsAll || []).filter((a) => a.type === "SELECT" && a.isActive);
    const selectableById = new Map(selectable.map((a) => [String(a.id), a]));

    if (variantRows.length > 0) {
      const variants: any[] = [];

      const isRealVariantIdLocal = (id?: string) =>
        !!id && !id.startsWith("vr-") && !id.startsWith("new-") && !id.startsWith("temp-") && !id.startsWith("tmp:") && !id.startsWith("tmp-");

      for (const row of variantRows) {
        const picks = Object.entries(row.selections || {}).filter(([, valueId]) => !!valueId);
        if (picks.length === 0) continue;

        // ✅ Variant retail price is NOT admin-editable while editing.
        // Send retailPrice only when editing AND supplier pricing exists (computed).
        let retailPriceToSend: number | null = null;

        if (editingId) {
          const computed = computedVariantRetail(row);
          if (computed.hasComputed && computed.variantRetail > 0) {
            retailPriceToSend = computed.variantRetail;
          } else {
            retailPriceToSend = null; // omit if unknown
          }
        } else {
          retailPriceToSend = null; // create: always omit (backend will default)
        }

        const options = picks.map(([attributeId, valueId]) => {
          return { attributeId, valueId, attributeValueId: valueId };
        });

        // ✅ Build variant SKU using VALUE NAMES
        const labelParts: string[] = [];

        for (const [attributeId, valueId] of picks) {
          const attr = selectableById.get(String(attributeId));
          const val = attr?.values?.find((v) => String(v.id) === String(valueId));
          const name = String(val?.name ?? "").trim();
          if (name) labelParts.push(skuSafePart(name));
        }

        const comboLabel = labelParts.filter(Boolean).join("-");
        const productSku = skuSafePart(base.sku || "");

        const sku = productSku && comboLabel ? `${productSku}-${comboLabel}` : productSku || comboLabel || undefined;

        variants.push({
          ...(isRealVariantIdLocal(row.id) ? { id: row.id } : {}),
          sku,
          ...(retailPriceToSend != null ? { retailPrice: retailPriceToSend } : {}),
          options,
          optionSelections: options,
          attributes: options.map((o: any) => ({ attributeId: o.attributeId, valueId: o.valueId })),
        });
      }

      payload.variants = variants.length ? variants : [];
      payload.variantOptions = variants.length ? variants.map((v: any) => v.options) : [];
    }

    return payload;
  }

  /* ---------------- Editor actions ---------------- */

  function startNewProduct() {
    setEditingId(null);
    setOffersProductId(null);
    setPending(defaultPending);
    setShowEditor(true);

    setSelectedAttrs({});
    setVariantRows([]);
    initialVariantIdsRef.current = new Set();
    setClearAllVariantsIntent(false);
    setVariantsDirty(false);

    setOfferVariants([]);
  }

  /* ---------------- Save / Create ---------------- */

  async function saveOrCreate() {
    const title = pending.title.trim();
    const ensuredProductSku = (pending.sku || "").trim() ? skuSafePart(pending.sku) : buildSkuFromTitle(title);

    if ((pending.sku || "").trim() !== ensuredProductSku) {
      setPending((p) => ({ ...p, sku: ensuredProductSku }));
    }

    if (!title) {
      openModal({ title: "Products", message: "Title is required." });
      return;
    }

    if (!editingId && !pending.supplierId) {
      openModal({ title: "Products", message: "Supplier is required." });
      return;
    }

    if (hasDuplicateCombos) {
      openModal({ title: "Variants", message: "Fix duplicate variant combinations before saving." });
      return;
    }

    const emptyRowErrorsNow = findEmptyRowErrors(variantRows ?? []);
    if (Object.keys(emptyRowErrorsNow).length > 0) {
      openModal({
        title: "Variants",
        message: "You have a variant row with no option selected. Pick at least 1 option or remove the row.",
      });
      return;
    }

    const priceNumCreate = Number(pending.price) || 0;
    const priceNumEdit = computedRetailFromEditing != null ? computedRetailFromEditing : Number(pending.price) || 0;
    const retailBase = editingId ? priceNumEdit : priceNumCreate;

    const check = validateRetailAboveSupplierPrices({
      baseRetail: retailBase,
      variantRows,
      caps: offerPriceCaps,
    });

    if (!check.ok) {
      openModal({
        title: "Retail price too low",
        message: check.errors.join("\n"),
      });
      return;
    }

    const supplierQty = toInt((pending as any).supplierAvailableQty, 0);
    const urlList = parseUrlList(pending.imageUrls);

    const base: any = {
      title,
      retailPrice: retailBase,
      price: retailBase,
      status: pending.status,
      sku: ensuredProductSku || undefined,
      description: pending.description != null ? pending.description : undefined,
      categoryId: pending.categoryId || undefined,
      brandId: pending.brandId || undefined,
      ...(pending.supplierId ? { supplierId: pending.supplierId } : {}),
    };

    if (!editingId && supplierQty > 0) {
      base.availableQty = supplierQty;
      base.inStock = true;
    }

    if (urlList.length) base.imagesJson = urlList;

    const fullPayload = buildProductPayload({
      base,
      selectedAttrs,
      variantRows,
      attrsAll: attrsQ.data || [],
    });

    if (fullPayload && typeof fullPayload === "object") {
      delete (fullPayload as any).ownerId;
      delete (fullPayload as any).userId;
    }

    const variants = Array.isArray((fullPayload as any).variants) ? (fullPayload as any).variants : [];

    if (editingId) {
      const hadVariantsBefore = initialVariantIdsRef.current.size > 0;
      const isNowNoVariants = variants.length === 0;

      if (hadVariantsBefore && isNowNoVariants && !clearAllVariantsIntent) {
        openModal({
          title: "Variants",
          message: "This save would remove ALL existing variants. If you really want to make this a simple product, click “Remove all variants” first, then Save.",
        });
        return;
      }
    }

    // EDIT FLOW
    if (editingId) {
      const { variantOptions, ...payloadForPatch } = fullPayload as any;
      const userTouchedVariants = variantsDirty || clearAllVariantsIntent;

      if (userTouchedVariants) {
        const submittedIds = new Set((variants || []).map((v: any) => normalizeNullableId(v?.id)).filter(Boolean) as string[]);
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

                await persistVariantsStrict(pid, variants || [], token, { replace: replaceFlag });

                setVariantsDirty(false);
                setClearAllVariantsIntent(false);

                qc.invalidateQueries({
                  queryKey: ["admin", "products", "locked-variant-ids", { productId: pid }],
                });
              } catch (e) {
                // eslint-disable-next-line no-console
                console.error("Failed to persist variants on update", e);
                openModal({ title: "Products", message: getHttpErrorMessage(e, "Failed to save variants") });
                return;
              }
            }

            try {
              if (pid) {
                const refreshed = await fetchProductFull(pid);
                const nextRowsRaw = buildVariantRowsFromServerVariants(refreshed.variants || []);
                const nextRows = dedupeVariantRowsByCombo(nextRowsRaw, selectableAttrs);

                setVariantRows(nextRows);
                initialVariantIdsRef.current = new Set(nextRows.map((r) => r.id).filter((id) => isRealVariantId(id)));
                setOfferVariants(refreshed.variants || []);

                qc.invalidateQueries({
                  queryKey: ["admin", "products", "locked-variant-ids", { productId: pid }],
                });
              }
            } catch (e) {
              // eslint-disable-next-line no-console
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

    // CREATE FLOW
    createM.mutate(fullPayload, {
      onSuccess: async (res) => {
        const created = (res?.data ?? res) as any;
        const pid = created?.id || created?.product?.id || created?.data?.id;

        const vars = extractProductVariants(fullPayload);
        if (pid && vars.length > 0) {
          try {
            await persistVariantsStrict(pid, vars, token, { replace: true });

            const refreshed = await fetchProductFull(pid);
            const nextRowsRaw = buildVariantRowsFromServerVariants(refreshed.variants || []);
            const nextRows = dedupeVariantRowsByCombo(nextRowsRaw, selectableAttrs);

            setVariantRows(nextRows);
            initialVariantIdsRef.current = new Set(nextRows.map((r) => r.id).filter((id) => isRealVariantId(id)));
            setOfferVariants(refreshed.variants || []);

            qc.invalidateQueries({ queryKey: ["admin", "products", "locked-variant-ids", { productId: pid }] });
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error("Failed to persist variants on create", e);
            openModal({ title: "Products", message: getHttpErrorMessage(e, "Failed to save variants") });
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
  }

  /* ---------------- Focus handoff ---------------- */

  useEffect(() => {
    if (!focusId || !rowsWithDerived?.length) return;
    const target = rowsWithDerived.find((r: any) => r.id === focusId);
    if (!target) return;
    startEdit(target);
    onFocusedConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, rowsWithDerived]);

  /* ---------------- Filters / sorting ---------------- */

  const getOwner = (p: any) => (p.owner?.email || p.ownerEmail || p.createdByEmail || p.createdBy?.email || "") as string;

  const filteredRows = useMemo(() => {
    const offers = (offersSummaryQ.data || {}) as any;

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

    return rowsWithDerived.filter((p) => {
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
  }, [rowsWithDerived, preset, offersSummaryQ.data]);

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
      }
      return sort.dir === "asc" ? res : -res;
    });

    return arr;
  }, [filteredRows, sort, statusRank]);

  /**
   * ✅ Build OFFERABLE variant list from ADMIN combos (variantRows),
   * not from supplier offers/caps.
   */
  const supplierVariants = useMemo(() => {
    const skuByVariantId = new Map<string, string>();

    const norm = (x: any) => {
      if (x == null) return null;
      const s = String(x).trim();
      if (!s || s === "null" || s === "undefined") return null;
      return s;
    };

    for (const v of offerVariants || []) {
      const vid = norm(v?.id) || norm(v?.variantId) || norm(v?.variant?.id) || norm(v?.id?.id) || norm(v?.variantId?.id);
      const sku = String(v?.sku || "").trim();
      if (vid && sku) skuByVariantId.set(vid, sku);
    }

    const rows = (variantRows || []).filter((r) => isRealVariantId(String(r?.id ?? "")));

    const toLabelFromSelections = (r: VariantRow) => {
      const parts: string[] = [];
      for (const a of selectableAttrs || []) {
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
  }, [variantRows, selectableAttrs, offerVariants]);

  /* ---------------- Primary actions ---------------- */

  function submitStatusEdit(pId: string, intent: "approvePublished" | "movePending") {
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
        onClick: () => {},
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

  /* ---------------- Attribute helpers ---------------- */

  const activeAttrs = useMemo(() => (attrsQ.data ?? []).filter((a) => a?.isActive), [attrsQ.data]);

  function setAttr(attrId: string, value: string | string[]) {
    setSelectedAttrs((prev) => ({ ...prev, [attrId]: value }));
  }

  /* ============================
     ✅ Restored UI blocks:
     - images upload + preview
     - description
     - attributes section
     - variants editor section
     - save buttons
  ============================ */

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

  // startEdit is defined here (after helper defs) to avoid scroll confusion
  async function startEdit(p: any) {
    try {
      setShowEditor(true);

      const full = await fetchProductFull(p.id);
      skipDraftLoadRef.current = true;

      setOffersProductId(full.id);
      setEditingId(full.id);

      const resolvedSupplierId = normalizeNullableId(full.supplierId) || "";

      const nextPending = {
        title: full.title || "",
        price: String(full.retailPrice ?? full.price ?? ""),
        status: full.status === "PUBLISHED" || full.status === "LIVE" ? full.status : "PENDING",
        categoryId: full.categoryId || "",
        brandId: full.brandId || "",
        supplierId: resolvedSupplierId || "",
        supplierAvailableQty: "",
        sku: full.sku || "",
        imageUrls: (extractImageUrls(full) || []).join("\n"),
        description: full.description ?? "",
      };

      const nextSel: Record<string, string | string[]> = {};
      (full.attributeValues || full.attributeSelections || []).forEach((av: any) => {
        if (Array.isArray(av.valueIds)) nextSel[av.attributeId] = av.valueIds;
        else if (av.valueId) nextSel[av.attributeId] = av.valueId;
      });
      (full.attributeTexts || []).forEach((at: any) => {
        nextSel[at.attributeId] = at.value;
      });

      const serverVariants = (full as any).variants || (full as any).variantsNormalized || [];
      const vr = buildVariantRowsFromServerVariants(serverVariants);

      setPending(nextPending);
      setSelectedAttrs(nextSel);

      initialVariantIdsRef.current = new Set(vr.map((r) => r.id).filter((id) => isRealVariantId(id)));
      setClearAllVariantsIntent(false);
      setVariantRows(vr);
      setVariantsDirty(false);

      await loadOfferVariants(full.id);

      localStorage.setItem(`adminProductDraft:${full.id}`, JSON.stringify({ pending: nextPending, variantRows: vr, selectedAttrs: nextSel }));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      openModal({ title: "Products", message: "Could not load product for editing." });
    } finally {
      queueMicrotask(() => {
        skipDraftLoadRef.current = false;
      });
    }
  }

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
      {/* ================= Toolbar ================= */}
      <div className="rounded-2xl border bg-white shadow-sm p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {presetButtons.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => setPresetAndUrl(b.key)}
                className={b.key === preset ? "px-3 py-2 rounded-xl bg-slate-900 text-white text-sm" : "px-3 py-2 rounded-xl border text-sm hover:bg-slate-50"}
              >
                {b.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[220px]" onMouseDown={(e) => e.stopPropagation()}>
              <input
                value={qInput}
                onChange={(e) => {
                  setQInput(e.target.value);
                }}
                onBlur={() => {
                  try {
                    setSearch(qInput);
                  } catch {}
                }}
                placeholder="Search by title / SKU / owner / etc…"
                className="w-full rounded-xl border px-3 py-2 text-sm"
              />
            </div>

            <button
              type="button"
              onClick={startNewProduct}
              className="ml-auto shrink-0 whitespace-nowrap rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              + New product
            </button>
          </div>
        </div>
      </div>

      {/* ================= Editor ================= */}
      {(showEditor || !!editingId) && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              setShowEditor(false);
              setEditingId(null);
              setOffersProductId(null);
              setPending(defaultPending);
              setVariantRows([]);
              setSelectedAttrs({});
              setOfferVariants([]);
              setVariantsDirty(false);
              setClearAllVariantsIntent(false);
              setUploadInfo("");
              setIsUploadingImages(false);
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
              Pricing markup: <span className="font-semibold">{pricingMarkupPercent}%</span> • set in <span className="font-mono">pricingMarkupPercent</span>
            </div>
          )}

          {editingId && offersProductId && (
            <div className="rounded-2xl border bg-white shadow-sm">
              <SuppliersOfferManager
                productId={offersProductId}
                variants={supplierVariants}
                suppliers={suppliersQ.data}
                token={token}
                readOnly={!(isSuper || isAdmin)}
                defaultUnitCost={Number(pending.price) || 0}
                onSaved={() => {
                  refreshEditingProduct();
                }}
              />
            </div>
          )}

          {/* Product Add/Edit Form */}
          <div className="rounded-2xl border bg-white shadow-sm p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{editingId ? "Edit product" : "Create product (Admin)"}</div>
                <div className="text-sm text-slate-500">
                  {editingId ? "Retail prices are computed from the cheapest purchasable supplier prices + markup." : "Admin can create and edit products on behalf of any supplier."}
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

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Title</label>
                    <input value={pending.title} onChange={(e) => setPending((p) => ({ ...p, title: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="Product title" />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700">{editingId ? "Retail Price (NGN) (computed FROM)" : "Price (NGN)"}</label>
                    <input
                      value={pending.price}
                      onChange={(e) => setPending((p) => ({ ...p, price: e.target.value }))}
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      placeholder="0"
                      inputMode="decimal"
                      disabled={!!editingId}
                      title={editingId ? "Computed as the cheapest purchasable price (base OR variant) + markup" : ""}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700">Status</label>
                    <select value={pending.status} onChange={(e) => setPending((p) => ({ ...p, status: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2">
                      <option value="PENDING">PENDING</option>
                      <option value="PUBLISHED">PUBLISHED</option>
                      <option value="LIVE">LIVE</option>
                      <option value="REJECTED">REJECTED</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700">Supplier</label>
                    <select value={pending.supplierId} onChange={(e) => setPending((p) => ({ ...p, supplierId: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2">
                      <option value="">Select supplier…</option>
                      {(suppliersQ.data ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700">Category</label>
                    <select value={pending.categoryId} onChange={(e) => setPending((p) => ({ ...p, categoryId: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2">
                      <option value="">Select category…</option>
                      {(catsQ.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700">Brand</label>
                    <select value={pending.brandId} onChange={(e) => setPending((p) => ({ ...p, brandId: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2">
                      <option value="">Select brand…</option>
                      {(brandsQ.data ?? []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700">SKU</label>
                    <input value={pending.sku} onChange={(e) => setPending((p) => ({ ...p, sku: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="SKU" />
                  </div>

                  {!editingId && (
                    <div>
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
                      const cheapest = minPositive(offerPriceCaps.minBase, offerPriceCaps.minVariantOverall);
                      if (cheapest > 0) {
                        return (
                          <span>
                            Supplier cheapest purchasable cost: ₦{cheapest.toLocaleString()} → retail ₦{applyMarkup(cheapest, pricingMarkupPercent).toLocaleString()} (markup {pricingMarkupPercent}%)
                          </span>
                        );
                      }
                      return <span>Supplier cheapest prices → —</span>;
                    })()}
                    {Object.keys(offerPriceCaps.minVariantByVariant || {}).length > 0 && <span className="ml-2">• variants tracked: {Object.keys(offerPriceCaps.minVariantByVariant || {}).length}</span>}
                  </div>
                )}

                {/* ✅ RESTORED: Images */}
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
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                      {imagePreviewUrls.map((u) => (
                        <div key={u} className="relative rounded-xl border overflow-hidden bg-slate-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt="preview" className="h-28 w-full object-cover" />
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

                {/* ✅ RESTORED: Description */}
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

              {/* Right: Attributes + Variants */}
              <div className="space-y-3">
                {/* ✅ RESTORED: Attributes */}
                <div className="rounded-xl border p-3">
                  <div className="text-sm font-semibold text-slate-800">Attributes</div>
                  <div className="text-xs text-slate-500">These are product-level attributes (not variant combos).</div>

                  <div className="mt-3 space-y-3">
                    {(activeAttrs || []).map((a) => {
                      const val = selectedAttrs[a.id];

                      if (a.type === "TEXT") {
                        return (
                          <div key={a.id}>
                            <label className="text-sm font-medium text-slate-700">{a.name}</label>
                            <input
                              value={typeof val === "string" ? val : ""}
                              onChange={(e) => setAttr(a.id, e.target.value)}
                              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                              placeholder={a.placeholder || "Enter text…"}
                            />
                          </div>
                        );
                      }

                      if (a.type === "SELECT") {
                        return (
                          <div key={a.id}>
                            <label className="text-sm font-medium text-slate-700">{a.name}</label>
                            <select
                              value={typeof val === "string" ? val : ""}
                              onChange={(e) => setAttr(a.id, e.target.value)}
                              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                            >
                              <option value="">Select…</option>
                              {(a.values || []).filter((v) => v.isActive).map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      }

                      // MULTISELECT
                      const selected = Array.isArray(val) ? val : [];
                      return (
                        <div key={a.id}>
                          <label className="text-sm font-medium text-slate-700">{a.name}</label>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(a.values || []).filter((v) => v.isActive).map((v) => {
                              const on = selected.includes(v.id);
                              return (
                                <button
                                  key={v.id}
                                  type="button"
                                  onClick={() => {
                                    const next = on ? selected.filter((x) => x !== v.id) : [...selected, v.id];
                                    setAttr(a.id, next);
                                  }}
                                  className={on ? "px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs" : "px-3 py-1.5 rounded-full border text-xs hover:bg-slate-50"}
                                >
                                  {v.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {activeAttrs.length === 0 && <div className="text-sm text-slate-500">No attributes configured.</div>}
                  </div>
                </div>

                {/* ✅ RESTORED: Variants editor */}
                <div className="rounded-xl border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Variants</div>
                      <div className="text-xs text-slate-500">Add option combinations (Color / Size etc).</div>
                    </div>

                    <div className="flex gap-2">
                      <button type="button" onClick={addVariantCombo} className="rounded-lg bg-slate-900 text-white px-3 py-2 text-sm hover:bg-slate-800">
                        + Add variant
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          // Intentional clear (forces replace)
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

                  {selectableAttrs.length === 0 ? (
                    <div className="mt-3 text-sm text-slate-500">No SELECT attributes found. Create SELECT attributes to build variant combinations.</div>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-[720px] w-full text-sm">
                        <thead className="bg-slate-50 text-slate-700">
                          <tr className="text-left">
                            {selectableAttrs.map((a) => (
                              <th key={a.id} className="p-2">
                                {a.name}
                              </th>
                            ))}
                            <th className="p-2">Retail</th>
                            <th className="p-2">Lock</th>
                            <th className="p-2">Action</th>
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
                              editingId && computed.variantRetail === -1
                                ? "—"
                                : `₦${Number((editingId ? computed.variantRetail : toNumberLoose(r.retailPrice) ?? 0) || 0).toLocaleString()}`;

                            return (
                              <tr key={rk} className="border-t">
                                {selectableAttrs.map((a) => {
                                  const cur = String(r?.selections?.[a.id] ?? "");
                                  return (
                                    <td key={a.id} className="p-2 align-top">
                                      <select
                                        value={cur}
                                        onChange={(e) => setVariantRowSelection(r.id, a.id, e.target.value || "")}
                                        className="w-full rounded-lg border px-2 py-1.5 text-sm"
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

                                <td className="p-2 align-top">
                                  {editingId ? (
                                    <div className="text-sm">{retailLabel}</div>
                                  ) : (
                                    <input
                                      value={r.retailPrice}
                                      onChange={(e) => setVariantRowRetailPrice(r.id, e.target.value)}
                                      className="w-full rounded-lg border px-2 py-1.5 text-sm"
                                      placeholder="(optional)"
                                      inputMode="decimal"
                                    />
                                  )}
                                  {(dupErr || emptyErr) && <div className="mt-1 text-[11px] text-rose-600">{dupErr || emptyErr}</div>}
                                </td>

                                <td className="p-2 align-top">
                                  <span className={isLocked ? "text-xs rounded-full bg-slate-900 text-white px-2 py-1" : "text-xs rounded-full bg-slate-100 text-slate-700 px-2 py-1"}>
                                    {isLocked ? "LOCKED" : "—"}
                                  </span>
                                </td>

                                <td className="p-2 align-top">
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
                              <td colSpan={selectableAttrs.length + 3} className="p-3 text-slate-500">
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
              </div>
            </div>

            {/* ✅ RESTORED: Save buttons */}
            <div className="mt-4 flex flex-wrap gap-2 justify-end">
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

      {/* ================= Products Table ================= */}
      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
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
                <th className="p-3 cursor-pointer" onClick={() => toggleSort("owner")}>
                  Owner <SortIndicator k="owner" />
                </th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>

            <tbody>
              {displayRows.map((p) => {
                const action = primaryActionForRow(p);
                const price = displayRetailForRow(p);

                return (
                  <tr key={p.id} className="border-t">
                    <td className="p-3">
                      <div className="font-medium">{p.title}</div>
                      <div className="text-xs text-slate-500 font-mono">{p.sku || p.id}</div>

                      {p.__bestVariantSupplierPrice ? <div className="text-[11px] text-slate-500 mt-1">best supplier variant: ₦{Number(p.__bestVariantSupplierPrice).toLocaleString()}</div> : null}

                      {p.__bestBaseSupplierPrice ? <div className="text-[11px] text-slate-500 mt-1">best supplier base: ₦{Number(p.__bestBaseSupplierPrice).toLocaleString()}</div> : null}

                      {(p.__bestBaseSupplierPrice || p.__bestVariantSupplierPrice) && (
                        <div className="text-[11px] text-slate-500 mt-1">computed FROM uses cheapest purchasable + {pricingMarkupPercent}% markup</div>
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
                    <td className="p-3">{getOwner(p) || "—"}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => startEdit(p)} className="rounded-lg border px-3 py-2 hover:bg-slate-50">
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
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!listQ.isLoading && displayRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-slate-500">
                    No products found.
                  </td>
                </tr>
              )}

              {listQ.isLoading && (
                <tr>
                  <td colSpan={7} className="p-6 text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
