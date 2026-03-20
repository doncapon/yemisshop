// src/pages/Catalog.tsx
import React, {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client.js";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { useModal } from "../components/ModalProvider";
import {
  Search,
  SlidersHorizontal,
  X,
  ChevronRight,
  ChevronDown,
  Heart,
} from "lucide-react";

import SiteLayout from "../layouts/SiteLayout.js";
import { showMiniCartToast } from "../components/cart/MiniCartToast";
import { readCartLines, upsertCartLine, toMiniCartRows } from "../utils/cartModel";

import { AnimatePresence, motion } from "framer-motion";

/* =========================================================
   Types — aligned to public products route
========================================================= */

type CartItemKind = "BASE" | "VARIANT";

type SupplierOfferLite = {
  id: string;
  supplierId?: string | null;

  isActive?: boolean;
  inStock?: boolean;
  availableQty?: number | null;

  basePrice?: number | null;
  unitPrice?: number | null;

  currency?: string | null;
  leadDays?: number | null;

  supplierRatingAvg?: number | null;
  supplierRatingCount?: number | null;
};

type Variant = {
  id: string;
  sku?: string | null;
  retailPrice?: number | null;
  inStock?: boolean | null;
  imagesJson?: string[];
  availableQty?: number | null;
  offers?: SupplierOfferLite[];
};

type Product = {
  id: string;
  title: string;
  description?: string;

  sku?: string | null;

  retailPrice?: number | null;
  computedRetailPrice?: number | null;
  autoPrice?: number | null;
  displayBasePrice?: number | null;
  offersFrom?: number | null;
  commissionPctInt?: number | null;

  inStock?: boolean | null;
  availableQty?: number | null;
  imagesJson?: string[];

  categoryId?: string | null;
  categoryName?: string | null;

  brand?: { id: string; name: string } | null;

  variants?: Variant[];
  supplierProductOffers?: SupplierOfferLite[];

  ratingAvg?: number | null;
  ratingCount?: number | null;

  status?: string;
};

type ProductView = Product & {
  _displayPrice: number;
  _availableNow: boolean;
  _sellable: boolean;
  _primaryImg?: string;
  _secondaryImg?: string;
  _brandName: string;
  _categoryLabel: string;
  _searchTitle: string;
  _searchDesc: string;
  _searchCat: string;
  _searchBrand: string;
};

type PublicSettings = {
  baseServiceFeeNGN?: number;
  commsUnitCostNGN?: number;
  gatewayFeePercent?: number;
  gatewayFixedFeeNGN?: number;
  gatewayFeeCapNGN?: number;
  marginPercent?: number; // keep optional only for backward compatibility
};

type CategoryNode = {
  id: string;
  name: string;
  slug?: string;
  parentId?: string | null;
  position?: number;
  children: CategoryNode[];
};

type CategoryFlat = {
  id: string;
  name: string;
  parentId?: string | null;
  position?: number | null;
  isActive?: boolean | null;
  children?: CategoryFlat[];
};

type PriceBucket = { label: string; min: number; max?: number };
type SortKey = "relevance" | "price-asc" | "price-desc";

type CatalogPersistedState = {
  selectedCategories: string[];
  selectedBucketIdxs: number[];
  selectedBrands: string[];
  sortKey: SortKey;
  query: string;
  inStockOnly: boolean;
  expandedCats: Record<string, boolean>;
  page: number;
  pageSize: 8 | 12 | 16;
};

type CatalogProductsMeta = {
  page: number;
  take: number;
  skip: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

type CatalogProductsResponse = {
  data: Product[];
  total: number;
  meta: CatalogProductsMeta;
};

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const CATALOG_STATE_KEY = "catalog:ui-state:v4";
const CATALOG_SCROLL_KEY = "catalog:scroll:v4";
const CATALOG_RETURN_KEY = "catalog:return:v4";

/* =========================================================
   Persistence helpers
========================================================= */

function readCatalogState(): CatalogPersistedState | null {
  try {
    const raw = sessionStorage.getItem(CATALOG_STATE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    const sortKey: SortKey =
      parsed?.sortKey === "price-asc" ||
        parsed?.sortKey === "price-desc" ||
        parsed?.sortKey === "relevance"
        ? parsed.sortKey
        : "relevance";

    const pageSizeRaw = Number(parsed?.pageSize);
    const pageSize: 8 | 12 | 16 =
      pageSizeRaw === 8 || pageSizeRaw === 12 || pageSizeRaw === 16 ? pageSizeRaw : 12;

    return {
      selectedCategories: Array.isArray(parsed?.selectedCategories)
        ? parsed.selectedCategories.map(String)
        : [],
      selectedBucketIdxs: Array.isArray(parsed?.selectedBucketIdxs)
        ? parsed.selectedBucketIdxs
          .map((n: any) => Number(n))
          .filter((n: number) => Number.isFinite(n) && n >= 0)
        : [],
      selectedBrands: Array.isArray(parsed?.selectedBrands)
        ? parsed.selectedBrands.map(String)
        : [],
      sortKey,
      query: typeof parsed?.query === "string" ? parsed.query : "",
      inStockOnly: parsed?.inStockOnly !== false,
      expandedCats:
        parsed?.expandedCats &&
          typeof parsed.expandedCats === "object" &&
          !Array.isArray(parsed.expandedCats)
          ? parsed.expandedCats
          : {},
      page: Number.isFinite(Number(parsed?.page)) ? Math.max(1, Number(parsed.page)) : 1,
      pageSize,
    };
  } catch {
    return null;
  }
}

function writeCatalogState(state: CatalogPersistedState) {
  try {
    sessionStorage.setItem(CATALOG_STATE_KEY, JSON.stringify(state));
  } catch {
    //
  }
}

function readCatalogScroll(): number | null {
  try {
    const raw = sessionStorage.getItem(CATALOG_SCROLL_KEY);
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function writeCatalogScroll(y: number) {
  try {
    sessionStorage.setItem(CATALOG_SCROLL_KEY, String(Math.max(0, Math.floor(y))));
  } catch {
    //
  }
}

function setCatalogReturning(v: boolean) {
  try {
    if (v) sessionStorage.setItem(CATALOG_RETURN_KEY, "1");
    else sessionStorage.removeItem(CATALOG_RETURN_KEY);
  } catch {
    //
  }
}

function isCatalogReturning() {
  try {
    return sessionStorage.getItem(CATALOG_RETURN_KEY) === "1";
  } catch {
    return false;
  }
}

/* =========================================================
   Small utilities
========================================================= */

function decToNumber(v: any): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeImages(val: any): string[] {
  if (!val) return [];

  const out: string[] = [];

  const pushOne = (input: any) => {
    if (input == null) return;

    if (Array.isArray(input)) {
      for (const item of input) pushOne(item);
      return;
    }

    if (typeof input === "object") {
      const candidate =
        input.url ??
        input.src ??
        input.image ??
        input.imageUrl ??
        input.absoluteUrl ??
        null;

      if (candidate != null) pushOne(candidate);
      return;
    }

    if (typeof input === "string") {
      const s = input.trim();
      if (!s) return;

      if (
        (s.startsWith("[") && s.endsWith("]")) ||
        (s.startsWith("{") && s.endsWith("}"))
      ) {
        try {
          pushOne(JSON.parse(s));
          return;
        } catch {
          //
        }
      }

      const parts = s
        .split(/[\n,]/g)
        .map((t) => t.trim())
        .filter(Boolean);

      if (parts.length > 1) {
        for (const p of parts) pushOne(p);
        return;
      }

      out.push(s);
    }
  };

  pushOne(val);
  return out.filter(Boolean);
}

const isLive = (x?: { status?: string | null }) =>
  String(x?.status ?? "").trim().toUpperCase() === "LIVE";

const norm = (s: string) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const cleanText = (v: any) => String(v ?? "").replace(/\s+/g, " ").trim();

const toCategoryKey = (v: any): string => {
  const s = cleanText(v);
  return s || "uncategorized";
};

const toBrandKey = (v: any): string => norm(cleanText(v));

/* =========================================================
   Stock + offers helpers
========================================================= */

function offerStockOk(o?: SupplierOfferLite): boolean {
  if (!o || o.isActive === false) return false;

  const qty = o.availableQty;
  const hasQty = qty != null && Number.isFinite(Number(qty));
  const qtyOk = !hasQty ? true : Number(qty) > 0;

  return o.inStock === true || qtyOk;
}

function getActiveBaseOffer(p: Product): SupplierOfferLite | null {
  const offers = Array.isArray(p.supplierProductOffers) ? p.supplierProductOffers : [];

  for (const o of offers) {
    if (!o) continue;
    if (o.isActive !== true) continue;
    if (!offerStockOk(o)) continue;

    const price = Number(o.basePrice ?? o.unitPrice ?? 0);
    if (!Number.isFinite(price) || price <= 0) continue;

    return o;
  }

  return null;
}

function collectAllOffers(p: Product): SupplierOfferLite[] {
  const out: SupplierOfferLite[] = [];
  if (Array.isArray(p.supplierProductOffers)) out.push(...p.supplierProductOffers);
  if (Array.isArray(p.variants)) {
    for (const v of p.variants) {
      if (Array.isArray(v.offers)) out.push(...v.offers);
    }
  }
  return out;
}

function availableNow(p: Product): boolean {
  const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;

  if (!hasVariants) {
    return !!getActiveBaseOffer(p);
  }

  const offers = collectAllOffers(p);

  if (offers.some((o) => o?.isActive === true && o?.inStock === true)) return true;

  for (const o of offers) {
    if (!o || o.isActive === false) continue;
    const q = Number(o.availableQty);
    if (Number.isFinite(q) && q > 0) return true;
  }

  if (
    Array.isArray(p.variants) &&
    p.variants.some((v) => v.inStock === true || (Number(v.availableQty) || 0) > 0)
  ) {
    return true;
  }

  return false;
}

/* =========================================================
   Pricing — aligned with admin
   retail = supplierPrice + baseServiceFeeNGN + commsUnitCostNGN + gatewayFee
========================================================= */

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

function getOfferSupplierPrice(o?: SupplierOfferLite | null): number | null {
  if (!o || o.isActive === false || !offerStockOk(o)) return null;

  const n = Number(o.unitPrice ?? o.basePrice ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;

  return n;
}

function firstActiveBaseOfferSupplierPrice(p: Product): number | null {
  const offers = Array.isArray(p.supplierProductOffers) ? p.supplierProductOffers : [];

  for (const o of offers) {
    const price = getOfferSupplierPrice(o);
    if (price != null) return price;
  }

  return null;
}

function firstActiveVariantOfferSupplierPrice(p: Product): number | null {
  const variants = Array.isArray(p.variants) ? p.variants : [];

  for (const v of variants) {
    const offers = Array.isArray(v.offers) ? v.offers : [];
    for (const o of offers) {
      const price = getOfferSupplierPrice(o);
      if (price != null) return price;
    }
  }

  return null;
}

function firstActiveAnyOfferSupplierPrice(p: Product): number | null {
  const offers = collectAllOffers(p);

  for (const o of offers) {
    const price = getOfferSupplierPrice(o);
    if (price != null) return price;
  }

  return null;
}

function getDisplayRetailPrice(
  p: Product,
  pricing: {
    baseServiceFeeNGN: number;
    commsUnitCostNGN: number;
    gatewayFeePercent: number;
    gatewayFixedFeeNGN: number;
    gatewayFeeCapNGN: number;
  }
): number {
  // 1) Prefer raw supplier-side price sources, then compute retail locally
  const offersFromPrice =
    Number.isFinite(Number(p.offersFrom)) && Number(p.offersFrom) > 0
      ? Number(p.offersFrom)
      : null;

  const displayBaseSupplierPrice =
    Number.isFinite(Number(p.displayBasePrice)) && Number(p.displayBasePrice) > 0
      ? Number(p.displayBasePrice)
      : null;

  const hasOptions = Array.isArray(p.variants) && p.variants.length > 0;

  let sourceSupplierPrice: number | null = null;

  if (offersFromPrice != null) {
    sourceSupplierPrice = offersFromPrice;
  } else if (hasOptions) {
    const baseSupplierPrice = firstActiveBaseOfferSupplierPrice(p);
    const variantSupplierPrice = firstActiveVariantOfferSupplierPrice(p);

    if (baseSupplierPrice != null && variantSupplierPrice != null) {
      sourceSupplierPrice = Math.min(baseSupplierPrice, variantSupplierPrice);
    } else if (baseSupplierPrice != null) {
      sourceSupplierPrice = baseSupplierPrice;
    } else if (variantSupplierPrice != null) {
      sourceSupplierPrice = variantSupplierPrice;
    } else if (displayBaseSupplierPrice != null) {
      sourceSupplierPrice = displayBaseSupplierPrice;
    }
  } else {
    sourceSupplierPrice =
      firstActiveAnyOfferSupplierPrice(p) ??
      displayBaseSupplierPrice ??
      null;
  }

  if (sourceSupplierPrice != null && sourceSupplierPrice > 0) {
    return computeRetailPriceFromSupplierPrice({
      supplierPrice: sourceSupplierPrice,
      baseServiceFeeNGN: pricing.baseServiceFeeNGN,
      commsUnitCostNGN: pricing.commsUnitCostNGN,
      gatewayFeePercent: pricing.gatewayFeePercent,
      gatewayFixedFeeNGN: pricing.gatewayFixedFeeNGN,
      gatewayFeeCapNGN: pricing.gatewayFeeCapNGN,
    });
  }

  // 2) Only fallback to already-computed retail from API when we do NOT have supplier price
  const apiComputed = Number(p.computedRetailPrice);
  if (Number.isFinite(apiComputed) && apiComputed > 0) return apiComputed;

  const raw =
    Number(p.retailPrice) > 0
      ? Number(p.retailPrice)
      : Number(p.autoPrice) > 0
        ? Number(p.autoPrice)
        : 0;

  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function priceForFiltering(
  p: Product,
  pricing: {
    baseServiceFeeNGN: number;
    commsUnitCostNGN: number;
    gatewayFeePercent: number;
    gatewayFixedFeeNGN: number;
    gatewayFeeCapNGN: number;
  }
): number {
  return getDisplayRetailPrice(p, pricing);
}

/* =========================================================
   Sellable flag
========================================================= */

function productSellable(
  p: Product,
  pricing: {
    baseServiceFeeNGN: number;
    commsUnitCostNGN: number;
    gatewayFeePercent: number;
    gatewayFixedFeeNGN: number;
    gatewayFeeCapNGN: number;
  }
): boolean {
  if (!isLive(p)) return false;

  const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;

  if (!hasVariants && !getActiveBaseOffer(p)) return false;
  if (!availableNow(p)) return false;

  const price = getDisplayRetailPrice(p, pricing);
  return Number.isFinite(price) && price > 0;
}

/* =========================================================
   API origin for images
========================================================= */

function getApiOrigin(): string {
  const base = String((api as any)?.defaults?.baseURL || "").trim();

  if (/^https?:\/\//i.test(base)) {
    try {
      return new URL(base).origin;
    } catch {
      return window.location.origin;
    }
  }

  const env = (import.meta as any)?.env;
  const fromEnv = String(env?.VITE_API_URL || env?.VITE_API_ORIGIN || "").trim();

  if (fromEnv && /^https?:\/\//i.test(fromEnv)) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      //
    }
  }

  return window.location.origin;
}

const API_ORIGIN = getApiOrigin();

function resolveImageUrl(input?: any): string | undefined {
  if (input == null) return undefined;

  if (Array.isArray(input)) {
    for (const item of input) {
      const resolved = resolveImageUrl(item);
      if (resolved) return resolved;
    }
    return undefined;
  }

  if (typeof input === "object") {
    const candidate =
      input.url ??
      input.src ??
      input.image ??
      input.imageUrl ??
      input.absoluteUrl ??
      null;

    return candidate ? resolveImageUrl(candidate) : undefined;
  }

  const s = String(input ?? "").trim();
  if (!s) return undefined;

  if (
    (s.startsWith("[") && s.endsWith("]")) ||
    (s.startsWith("{") && s.endsWith("}"))
  ) {
    try {
      return resolveImageUrl(JSON.parse(s));
    } catch {
      //
    }
  }

  if (/^(https?:\/\/|data:|blob:)/i.test(s)) return s;
  if (s.startsWith("//")) return `${window.location.protocol}${s}`;

  if (s.startsWith("/")) {
    if (s.startsWith("/uploads/") || s.startsWith("/api/uploads/")) return `${API_ORIGIN}${s}`;
    return `${window.location.origin}${s}`;
  }

  if (s.startsWith("uploads/") || s.startsWith("api/uploads/")) {
    return `${API_ORIGIN}/${s.replace(/^\/+/, "")}`;
  }

  return `${window.location.origin}/${s.replace(/^\/+/, "")}`;
}

/* =========================================================
   Purchased counts
========================================================= */

function usePurchasedCounts(enabledOverride = true) {
  const user = useAuthStore((s) => s.user);

  return useQuery<Record<string, number>>({
    queryKey: ["orders", "mine", "purchased-counts"],
    enabled: !!user && enabledOverride,
    retry: 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      try {
        const { data } = await api.get("/api/orders/mine", {
          withCredentials: true,
          params: { limit: 200 },
        });

        const orders: any[] = Array.isArray((data as any)?.data)
          ? (data as any).data
          : Array.isArray(data)
            ? (data as any)
            : [];

        const map: Record<string, number> = {};
        for (const o of orders) {
          const items: any[] = Array.isArray(o?.items) ? o.items : [];
          for (const it of items) {
            const pid = it?.productId || it?.product?.id || "";
            if (!pid) continue;
            const qtyRaw = it?.quantity ?? it?.qty ?? 1;
            const qty = Number(qtyRaw);
            map[pid] = (map[pid] || 0) + (Number.isFinite(qty) ? qty : 1);
          }
        }

        return map;
      } catch {
        return {};
      }
    },
  });
}

/* =========================================================
   Price bucket UI
========================================================= */

const formatN = (n: number) => "₦" + (Number.isFinite(n) ? n : 0).toLocaleString();

function generateDynamicPriceBuckets(maxPrice: number, baseStep = 1_000): PriceBucket[] {
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
    return [
      { label: "₦0 – ₦999", min: 0, max: 999 },
      { label: "₦1,000 – ₦4,999", min: 1_000, max: 4_999 },
      { label: "₦5,000 – ₦9,999", min: 5_000, max: 9_999 },
      { label: "₦10,000 – ₦49,999", min: 10_000, max: 49_999 },
      { label: "₦50,000 – ₦99,999", min: 50_000, max: 99_999 },
      { label: "₦100,000+", min: 100_000 },
    ];
  }

  const buckets: PriceBucket[] = [];
  const firstMax = Math.min(baseStep - 1, Math.floor(maxPrice));
  buckets.push({ label: `${formatN(0)} – ${formatN(firstMax)}`, min: 0, max: firstMax });
  if (maxPrice < baseStep) return buckets;

  const thresholds: number[] = [baseStep];
  let mult = 5;

  while (thresholds[thresholds.length - 1] < maxPrice) {
    thresholds.push(thresholds[thresholds.length - 1] * mult);
    mult = mult === 5 ? 2 : 5;
  }

  for (let i = 0; i < thresholds.length; i++) {
    const start = thresholds[i];
    const next = thresholds[i + 1];
    const end = next ? next - 1 : undefined;
    buckets.push({
      label: end ? `${formatN(start)} – ${formatN(end)}` : `${formatN(start)}+`,
      min: start,
      max: end,
    });
  }

  return buckets;
}

const inBucket = (price: number, b: PriceBucket) =>
  b.max == null ? price >= b.min : price >= b.min && price <= b.max;

function bestSupplierRatingScore(p: Product): number {
  const offers = collectAllOffers(p);
  let best = 0;

  for (const o of offers) {
    if (!o || o.isActive === false) continue;

    const avg = Number(o.supplierRatingAvg);
    const cnt = Number(o.supplierRatingCount);

    if (!Number.isFinite(avg) || avg <= 0) continue;

    const weight = Number.isFinite(cnt) && cnt > 0 ? Math.min(1, Math.log10(cnt + 1) / 3) : 0;
    const score = avg + 0.15 * weight;
    if (score > best) best = score;
  }

  return best;
}

/* =========================================================
   Category tree helpers
========================================================= */

function flattenCategoryTree(input: any): CategoryFlat[] {
  const out: CategoryFlat[] = [];

  const walk = (n: any, parentId: string | null) => {
    if (!n) return;

    const id = String(n.id ?? "");
    const name = String(n.name ?? "");
    if (!id || !name) return;

    const node: CategoryFlat = {
      id,
      name,
      parentId: n.parentId != null ? String(n.parentId) : parentId,
      position: Number.isFinite(Number(n.position)) ? Number(n.position) : 0,
      isActive: n.isActive != null ? !!n.isActive : true,
    };

    out.push(node);

    const kids: any[] = Array.isArray(n.children)
      ? n.children
      : Array.isArray(n.items)
        ? n.items
        : [];
    for (const c of kids) walk(c, id);
  };

  const arr: any[] = Array.isArray(input) ? input : Array.isArray(input?.data) ? input.data : [];
  for (const n of arr) walk(n, null);

  return out;
}

function buildCategoryForest(list: CategoryFlat[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();

  for (const c of list) {
    const id = String(c.id);
    const name = String(c.name);
    const parentId = c.parentId != null ? String(c.parentId) : null;
    const position = Number.isFinite(Number(c.position)) ? Number(c.position) : 0;
    byId.set(id, { id, name, parentId, position, children: [] });
  }

  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (nodes: CategoryNode[]) => {
    nodes.sort((a, b) => {
      const pa = Number.isFinite(a.position) ? a.position : 0;
      const pb = Number.isFinite(b.position) ? b.position : 0;
      if (pa !== pb) return (pa as number) - (pb as number);
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    for (const n of nodes) sortRec(n.children);
  };

  sortRec(roots);
  return roots;
}

function buildDescendantMap(roots: CategoryNode[]) {
  const byId = new Map<string, CategoryNode>();
  const childrenById = new Map<string, string[]>();

  const walk = (n: CategoryNode) => {
    byId.set(n.id, n);
    childrenById.set(n.id, n.children.map((c) => c.id));
    for (const c of n.children) walk(c);
  };

  for (const r of roots) walk(r);

  const allDescCache = new Map<string, Set<string>>();
  const getAllDesc = (id: string): Set<string> => {
    if (allDescCache.has(id)) return allDescCache.get(id)!;

    const out = new Set<string>();
    const stack = [...(childrenById.get(id) || [])];

    while (stack.length) {
      const x = stack.pop()!;
      if (out.has(x)) continue;
      out.add(x);
      const kids = childrenById.get(x) || [];
      for (const k of kids) stack.push(k);
    }

    allDescCache.set(id, out);
    return out;
  };

  return { byId, childrenById, getAllDesc };
}

function aggregateCountsToParents(
  roots: CategoryNode[],
  directCounts: Map<string, number>
): Map<string, number> {
  const out = new Map<string, number>();

  const dfs = (n: CategoryNode): number => {
    let sum = directCounts.get(n.id) || 0;
    for (const c of n.children) sum += dfs(c);
    out.set(n.id, sum);
    return sum;
  };

  for (const r of roots) dfs(r);

  return out;
}

/* =========================================================
   Loader
========================================================= */

function MotionCircleLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3" role="status" aria-label={label}>
      <div className="relative h-24 w-24 sm:h-28 sm:w-28 md:h-32 md:w-32">
        <svg className="absolute inset-0" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="rgba(226,232,240,0.9)"
            strokeWidth="8"
          />
        </svg>

        <motion.svg
          className="absolute inset-0"
          viewBox="0 0 100 100"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
        >
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="rgba(59,130,246,0.95)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray="160 120"
          />
        </motion.svg>

        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{ scale: [1, 1.03, 1] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
        />
      </div>

      <div className="text-sm text-zinc-600">{label}</div>
    </div>
  );
}

/* =========================================================
   CART helpers
========================================================= */

const AXIOS_COOKIE_CFG = { withCredentials: true as const };

async function setServerCartQty(input: {
  productId: string;
  variantId?: string | null;
  kind?: CartItemKind;
  qty: number;
  titleSnapshot?: string | null;
  imageSnapshot?: string | null;
  unitPriceCache?: number | null;
  supplierId?: string | null;
  offerId?: string;
}) {
  const { data } = await api.get("/api/cart", AXIOS_COOKIE_CFG);
  const items: any[] = Array.isArray((data as any)?.items) ? (data as any).items : [];

  const vid = input.variantId ?? null;
  const kind: CartItemKind = input.kind ?? (vid ? "VARIANT" : "BASE");
  const optionsKey = "";

  const found = items.find(
    (x) =>
      String(x.productId) === String(input.productId) &&
      String(x.variantId ?? null) === String(vid) &&
      String(x.kind || "").toUpperCase() === kind &&
      String(x.optionsKey || "") === optionsKey
  );

  if (input.qty <= 0) {
    if (found?.id) await api.delete(`/api/cart/items/${found.id}`, AXIOS_COOKIE_CFG);
    return;
  }

  if (!found?.id) {
    await api.post(
      "/api/cart/items",
      {
        productId: input.productId,
        variantId: vid,
        kind,
        qty: input.qty,
        selectedOptions: [],
        optionsKey,
        titleSnapshot: input.titleSnapshot ?? null,
        imageSnapshot: input.imageSnapshot ?? null,
        unitPriceCache: input.unitPriceCache ?? null,
        supplierId: input.supplierId ?? null,
        offerId: input.offerId ?? undefined,
      },
      AXIOS_COOKIE_CFG
    );
    return;
  }

  await api.patch(
    `/api/cart/items/${found.id}`,
    {
      qty: input.qty,
      titleSnapshot: input.titleSnapshot ?? null,
      imageSnapshot: input.imageSnapshot ?? null,
      unitPriceCache: input.unitPriceCache ?? null,
      supplierId: input.supplierId ?? null,
      offerId: input.offerId ?? undefined,
    },
    AXIOS_COOKIE_CFG
  );
}

function TruncatedTitle({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <h3 className={className} title={text}>
      {text}
    </h3>
  );
}

/* =========================================================
   Small UI primitives
========================================================= */

const Shimmer = memo(function Shimmer() {
  return (
    <div className="h-3 w-full animate-pulse rounded bg-gradient-to-r from-zinc-200 via-zinc-100 to-zinc-200" />
  );
});

const SafeImg = memo(function SafeImg({
  src,
  alt,
  className,
  draggable,
  loading,
  fallback,
  ariaHidden = false,
}: {
  src?: string;
  alt: string;
  className?: string;
  draggable?: boolean;
  loading?: "eager" | "lazy";
  fallback?: React.ReactNode;
  ariaHidden?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return <>{fallback ?? null}</>;

  return (
    <img
      src={src}
      alt={alt}
      aria-hidden={ariaHidden || undefined}
      loading={loading}
      className={className}
      draggable={draggable}
      onError={() => setFailed(true)}
    />
  );
});

type SuggestionItemProps = {
  p: ProductView;
  active: boolean;
  onClick: (title: string) => void;
};

const SuggestionItem = memo(function SuggestionItem({
  p,
  active,
  onClick,
}: SuggestionItemProps) {
  return (
    <li className="mb-2 last:mb-0">
      <button
        type="button"
        className={`w-full rounded-xl px-2.5 py-2.5 text-left hover:bg-black/5 ${active ? "bg-black/5" : ""
          }`}
        onClick={() => onClick(p.title)}
      >
        <div className="flex items-center gap-3">
          <SafeImg
            src={p._primaryImg}
            alt=""
            ariaHidden
            className="h-16 w-16 rounded-xl border border-zinc-200 object-cover"
            fallback={
              <div className="grid h-16 w-16 place-items-center rounded-xl border border-zinc-200 text-base text-gray-500">
                —
              </div>
            }
          />

          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold md:text-sm">{p.title}</div>
            <div className="truncate text-[10px] opacity-80 md:text-xs">

              {ngn.format(p._displayPrice || 0)}
              {p.categoryName ? ` • ${p.categoryName}` : ""}
              {p.brand?.name ? ` • ${p.brand.name}` : ""}
            </div>
          </div>
        </div>
      </button>
    </li>
  );
});

type ProductCardProps = {
  p: ProductView;
  fav: boolean;
  bestPrice: number;
  inStock: boolean;
  hasVariants: boolean;
  baseQtyInCart: number;
  isSupplier: boolean;
  isAuthed: boolean;
  locationStateFrom: string;
  canAdjustBaseQty: boolean;
  isFromCardAction: (target: EventTarget | null) => boolean;
  persistSnapshot: () => void;
  setRefineOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSearchFocused: React.Dispatch<React.SetStateAction<boolean>>;
  setTouchStartX: React.Dispatch<React.SetStateAction<number | null>>;
  openModal: (opts: { title: string; message: string }) => void;
  onToggleFav: (productId: string) => void;
  onGoToProduct: (productId: string) => void;
  onSetCartQty: (p: ProductView, nextQty: number) => void | Promise<void>;
};

const ProductCard = memo(
  function ProductCard({
    p,
    fav,
    bestPrice,
    inStock,
    hasVariants,
    baseQtyInCart,
    isSupplier,
    isAuthed,
    locationStateFrom,
    canAdjustBaseQty,
    isFromCardAction,
    persistSnapshot,
    setRefineOpen,
    setSearchFocused,
    setTouchStartX,
    openModal,
    onToggleFav,
    onGoToProduct,
    onSetCartQty,
  }: ProductCardProps) {
    return (
      <Link
        to={`/products/${p.id}`}
        state={{ from: location.pathname }}
        onClick={(e) => {
          if (isFromCardAction(e.target)) {
            e.preventDefault();
            return;
          }

          persistSnapshot();
          setCatalogReturning(true);
          setRefineOpen(false);
          setSearchFocused(false);
          setTouchStartX(null);
        }}
        onDragStart={(e) => e.preventDefault()}
        className="group block cursor-pointer overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition hover:border-zinc-300 active:scale-[0.99]"
      >
        <div className="relative h-28 w-full overflow-hidden bg-zinc-100 sm:h-36 md:h-40">
          <SafeImg
            src={p._primaryImg}
            alt={p.title}
            loading="lazy"
            draggable={false}
            className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${p._secondaryImg ? "opacity-100 group-hover:opacity-0" : "opacity-100"
              }`}
            fallback={
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-zinc-400">
                No image
              </div>
            }
          />

          {p._secondaryImg && (
            <SafeImg
              src={p._secondaryImg}
              alt={p.title}
              loading="lazy"
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            />
          )}

          {inStock && (
            <span className="absolute left-2 top-2 z-10 inline-flex items-center rounded-full bg-purple-500 px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm md:text-[11px]">
              In stock
            </span>
          )}

          {!isSupplier && (
            <button
              type="button"
              data-stop-card-nav="true"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();

                if (!isAuthed) {
                  openModal({
                    title: "Sign in required",
                    message: "Please sign in to save items to your wishlist.",
                  });
                  return;
                }

                onToggleFav(p.id);
              }}
              className={`absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-sm transition ${fav
                ? "border-rose-200 bg-rose-50 text-rose-600"
                : "border-zinc-200 bg-white/95 text-zinc-400 hover:border-rose-200 hover:text-rose-600"
                }`}
              aria-label={fav ? "Remove from wishlist" : "Add to wishlist"}
              title={fav ? "Remove from wishlist" : "Add to wishlist"}
            >
              <Heart size={16} className={fav ? "fill-current" : ""} />
            </button>
          )}
        </div>

        <div className="p-2.5 md:p-4">
          <TruncatedTitle
            text={p.title}
            className="line-clamp-1 text-[12px] font-semibold text-zinc-900 md:text-sm"
          />
          <div className="line-clamp-1 text-[10px] text-zinc-500 md:text-xs">
            {p._brandName ? `${p._brandName} • ` : ""}
            {p._categoryLabel}
          </div>

          <div className="mt-1">
            <p className="text-sm font-semibold md:text-base">{ngn.format(bestPrice || 0)}</p>
          </div>

          <div className="mt-2">
            {hasVariants ? (
              <button
                type="button"
                data-stop-card-nav="true"
                className="inline-flex items-center rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-medium text-white transition hover:bg-black/55 md:px-3 md:py-1.5 md:text-xs"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onGoToProduct(p.id);
                }}
              >
                Preview
              </button>

            ) : (
              <div data-stop-card-nav="true">
                {baseQtyInCart > 0 ? (
                  <div className="inline-flex items-center gap-2 rounded-full bg-black/75 px-2 py-1.5 text-white shadow-sm">
                    <button
                      type="button"
                      data-stop-card-nav="true"
                      aria-label="Decrease quantity"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-sm font-semibold hover:bg-white/25"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void onSetCartQty(p, baseQtyInCart - 1);
                      }}
                    >
                      −
                    </button>

                    <span className="min-w-[18px] text-center text-[11px] font-semibold md:text-xs">
                      {baseQtyInCart}
                    </span>

                    <button
                      type="button"
                      data-stop-card-nav="true"
                      aria-label="Increase quantity"
                      disabled={!canAdjustBaseQty}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold ${canAdjustBaseQty
                        ? "bg-white/15 hover:bg-white/25"
                        : "cursor-not-allowed bg-white/10 text-white/40"
                        }`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!canAdjustBaseQty) return;
                        void onSetCartQty(p, baseQtyInCart + 1);
                      }}
                    >
                      +
                    </button>
                    {baseQtyInCart > 0 && !canAdjustBaseQty && (
                      <div className="mt-2 text-[10px] text-amber-600 md:text-[11px]">
                        This item is no longer available. You can remove it, but not increase quantity.
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    data-stop-card-nav="true"
                    disabled={!inStock}
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium shadow-sm transition md:px-3 md:py-1.5 md:text-xs ${inStock
                      ? "bg-zinc-700 text-white hover:bg-black/90"
                      : "cursor-not-allowed bg-zinc-200 text-zinc-500"
                      }`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!inStock) return;
                      void onSetCartQty(p, 1);
                    }}
                  >
                    Add to cart
                  </button>

                )}
              </div>
            )}
          </div>
        </div>
      </Link>
    );
  },
  (prev, next) =>
    prev.p.id === next.p.id &&
    prev.fav === next.fav &&
    prev.bestPrice === next.bestPrice &&
    prev.inStock === next.inStock &&
    prev.hasVariants === next.hasVariants &&
    prev.baseQtyInCart === next.baseQtyInCart &&
    prev.isSupplier === next.isSupplier &&
    prev.isAuthed === next.isAuthed &&
    prev.canAdjustBaseQty === next.canAdjustBaseQty &&
    prev.locationStateFrom === next.locationStateFrom
);

/* =========================================================
   Derived helpers
========================================================= */

function getProductImageCandidates(p: Product): string[] {
  const out: string[] = [];

  const push = (val: any) => {
    const imgs = normalizeImages(val);
    for (const img of imgs) {
      const resolved = resolveImageUrl(img);
      if (resolved && !out.includes(resolved)) out.push(resolved);
    }
  };

  push(p.imagesJson);

  if (Array.isArray(p.variants)) {
    for (const v of p.variants) push(v.imagesJson);
  }

  return out;
}

/* =========================================================
   Component
========================================================= */
export default function Catalog() {
  const initialPersisted = useMemo(() => readCatalogState(), []);

  const user = useAuthStore((s) => s.user);
  const role = String(user?.role ?? "");
  const isSupplier = role === "SUPPLIER";
  const isAuthed = !!user?.id;

  const { openModal } = useModal();
  const nav = useNavigate();
  const qc = useQueryClient();
  const location = useLocation();

  const HIDE_OOS = false;
  const includeStr = "brand,category,variants,attributes,offers" as const;

  const resultsTopRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const scrollRafInnerRef = useRef<number | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const didHydrateRef = useRef(false);
  const didRestoreScrollRef = useRef(false);
  const shouldRestoreScrollRef = useRef(isCatalogReturning());
  const initialScrollRef = useRef<number | null>(readCatalogScroll());

  const scrollResultsToTop = useCallback(() => {
    if (scrollRafRef.current != null) {
      window.cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    if (scrollRafInnerRef.current != null) {
      window.cancelAnimationFrame(scrollRafInnerRef.current);
      scrollRafInnerRef.current = null;
    }

    scrollRafRef.current = window.requestAnimationFrame(() => {
      resultsTopRef.current?.scrollIntoView({
        block: "start",
        inline: "nearest",
        behavior: "auto",
      });
      scrollRafRef.current = null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      if (scrollRafInnerRef.current != null) {
        window.cancelAnimationFrame(scrollRafInnerRef.current);
        scrollRafInnerRef.current = null;
      }
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, []);

  /* ---------------- Settings ---------------- */

  const settingsQ = useQuery<{
    baseServiceFeeNGN: number;
    commsUnitCostNGN: number;
    gatewayFeePercent: number;
    gatewayFixedFeeNGN: number;
    gatewayFeeCapNGN: number;
  }>({
    queryKey: ["settings", "public", "pricing"],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
    queryFn: async () => {
      const { data } = await api.get<PublicSettings>("/api/settings/public");
      const root = (data as any)?.data ?? data ?? {};

      return {
        baseServiceFeeNGN: Number(root?.baseServiceFeeNGN ?? 0) || 0,
        commsUnitCostNGN: Number(root?.commsUnitCostNGN ?? 0) || 0,
        gatewayFeePercent: Number(root?.gatewayFeePercent ?? 1.5) || 1.5,
        gatewayFixedFeeNGN: Number(root?.gatewayFixedFeeNGN ?? 100) || 100,
        gatewayFeeCapNGN: Number(root?.gatewayFeeCapNGN ?? 2000) || 2000,
      };
    },
  });

  const baseServiceFeeNGN = Number(settingsQ.data?.baseServiceFeeNGN ?? 0) || 0;
  const commsUnitCostNGN = Number(settingsQ.data?.commsUnitCostNGN ?? 0) || 0;
  const gatewayFeePercent = Number(settingsQ.data?.gatewayFeePercent ?? 1.5) || 1.5;
  const gatewayFixedFeeNGN = Number(settingsQ.data?.gatewayFixedFeeNGN ?? 100) || 100;
  const gatewayFeeCapNGN = Number(settingsQ.data?.gatewayFeeCapNGN ?? 2000) || 2000;

  /* ---------------- UI state ---------------- */

  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    initialPersisted?.selectedCategories ?? []
  );
  const [selectedBucketIdxs, setSelectedBucketIdxs] = useState<number[]>(
    initialPersisted?.selectedBucketIdxs ?? []
  );
  const [selectedBrands, setSelectedBrands] = useState<string[]>(
    initialPersisted?.selectedBrands ?? []
  );
  const [sortKey, setSortKey] = useState<SortKey>(initialPersisted?.sortKey ?? "relevance");

  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const [refineOpen, setRefineOpen] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [inStockOnly, setInStockOnly] = useState(initialPersisted?.inStockOnly ?? true);
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>(
    initialPersisted?.expandedCats ?? {}
  );

  const desktopInputRef = useRef<HTMLInputElement | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);
  const desktopSuggestRef = useRef<HTMLDivElement | null>(null);
  const mobileSuggestRef = useRef<HTMLDivElement | null>(null);
  const productClicksRef = useRef<Record<string, number>>({});

  const deferredQuery = useDeferredValue(query);
  const deferredSelectedCategories = useDeferredValue(selectedCategories);
  const deferredSelectedBucketIdxs = useDeferredValue(selectedBucketIdxs);
  const deferredSelectedBrands = useDeferredValue(selectedBrands);
  const deferredInStockOnly = useDeferredValue(inStockOnly);

  const normalizedDeferredQuery = useMemo(() => norm(deferredQuery.trim()), [deferredQuery]);
  const normalizedQuery = useMemo(() => norm(query.trim()), [query]);

  const [page, setPage] = useState(initialPersisted?.page ?? 1);
  const [pageSize, setPageSize] = useState<8 | 12 | 16>(initialPersisted?.pageSize ?? 12);
  const [jumpVal, setJumpVal] = useState<string>("");

  const locationStateFrom = `${location.pathname}${location.search}`;

  const isFromCardAction = useCallback((target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    return !!el?.closest('[data-stop-card-nav="true"]');
  }, []);

  const persistSnapshot = useCallback(() => {
    writeCatalogState({
      selectedCategories,
      selectedBucketIdxs,
      selectedBrands,
      sortKey,
      query: "",
      inStockOnly,
      expandedCats,
      page,
      pageSize,
    });
    writeCatalogScroll(window.scrollY || window.pageYOffset || 0);
  }, [
    selectedCategories,
    selectedBucketIdxs,
    selectedBrands,
    sortKey,
    inStockOnly,
    expandedCats,
    page,
    pageSize,
  ]);

  const goToProduct = useCallback(
    (productId: string) => {
      setQuery("");
      persistSnapshot();
      setCatalogReturning(true);
      setRefineOpen(false);
      setSearchFocused(false);
      setActiveIdx(0);
      setTouchStartX(null);

      nav(`/products/${productId}`, {
        state: { from: locationStateFrom },
      });
    },
    [persistSnapshot, nav, locationStateFrom]
  );

  const closeRefine = useCallback(() => {
    setRefineOpen(false);
    setSearchFocused(false);
    setTouchStartX(null);
  }, []);

  /* ---------------- Navigation / overlay stability ---------------- */

  useEffect(() => {
    try {
      const raw = localStorage.getItem("productClicks:v1");
      productClicksRef.current = raw ? JSON.parse(raw) || {} : {};
    } catch {
      productClicksRef.current = {};
    }
  }, []);

  useEffect(() => {
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;

    if (refineOpen) {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [refineOpen]);

  useEffect(() => {
    const clearSearchUi = () => {
      setQuery("");
      setSearchFocused(false);
      setActiveIdx(0);
    };

    clearSearchUi();

    const onPageShow = () => clearSearchUi();
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    const resetUiOnly = () => {
      setRefineOpen(false);
      setSearchFocused(false);
      setActiveIdx(0);
      setQuery("");
      setTouchStartX(null);
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };

    const onPageShow = (ev: PageTransitionEvent) => {
      if (ev.persisted) resetUiOnly();
    };

    const onPageHide = () => resetUiOnly();

    window.addEventListener("pageshow", onPageShow as any);
    window.addEventListener("pagehide", onPageHide as any);

    return () => {
      window.removeEventListener("pageshow", onPageShow as any);
      window.removeEventListener("pagehide", onPageHide as any);
    };
  }, []);

  useEffect(() => {
    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }

    persistTimerRef.current = window.setTimeout(() => {
      writeCatalogState({
        selectedCategories,
        selectedBucketIdxs,
        selectedBrands,
        sortKey,
        query: "",
        inStockOnly,
        expandedCats,
        page,
        pageSize,
      });
      persistTimerRef.current = null;
    }, 120);

    return () => {
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [
    selectedCategories,
    selectedBucketIdxs,
    selectedBrands,
    sortKey,
    inStockOnly,
    expandedCats,
    page,
    pageSize,
  ]);

  /* ---------------- Cart snapshot + syncing ---------------- */

  const [cartVersion, setCartVersion] = useState(0);
  const cartSnapshot = useMemo(() => readCartLines(), [cartVersion]);

  useEffect(() => {
    const onCartUpdated = () => setCartVersion((v) => v + 1);
    window.addEventListener("cart:updated", onCartUpdated);
    return () => window.removeEventListener("cart:updated", onCartUpdated);
  }, []);

  /* ---------------- Server cart sync ---------------- */

  const serverSyncPendingRef = useRef<Record<string, boolean>>({});
  const serverSyncQueuedQtyRef = useRef<Record<string, number | null>>({});

  const syncServerQtyCoalesced = useCallback(
    (
      p: Product,
      qty: number,
      unitPriceCache: number,
      primaryImg: string | null,
      supplierId?: string | null,
      offerId?: string
    ) => {
      if (!isAuthed) return;

      const key = `BASE:${p.id}`;
      const pending = !!serverSyncPendingRef.current[key];
      serverSyncQueuedQtyRef.current[key] = qty;
      if (pending) return;

      const run = async () => {
        const desired = serverSyncQueuedQtyRef.current[key];
        serverSyncQueuedQtyRef.current[key] = null;
        if (desired == null) return;

        serverSyncPendingRef.current[key] = true;
        try {
          await setServerCartQty({
            productId: p.id,
            variantId: null,
            kind: "BASE",
            qty: desired,
            titleSnapshot: p.title,
            imageSnapshot: primaryImg,
            unitPriceCache,
            supplierId: supplierId ?? null,
            offerId: offerId ?? undefined,
          });
        } catch (e: any) {
          console.error("Cart sync failed:", e?.response?.status, e?.response?.data || e?.message);
        } finally {
          serverSyncPendingRef.current[key] = false;
          if (serverSyncQueuedQtyRef.current[key] != null) void run();
        }
      };

      void run();
    },
    [isAuthed]
  );

  /* ---------------- Products query ---------------- */

  const productsQ = useQuery<CatalogProductsResponse>({
    queryKey: ["products", { include: includeStr, status: "LIVE", page, take: pageSize }],
    staleTime: 30_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const { data } = await api.get("/api/products", {
        params: {
          include: includeStr,
          status: "LIVE",
          take: pageSize,
          page,
        },
      });

      const raw: any[] = Array.isArray((data as any)?.data) ? (data as any).data : [];

      const mapped = raw
        .filter((x) => x && x.id != null)
        .map((x) => {
          const variants: Variant[] = Array.isArray(x.variants)
            ? x.variants.map((v: any) => ({
              id: String(v.id),
              sku: v.sku ?? null,
              retailPrice: v.retailPrice != null ? decToNumber(v.retailPrice) : null,
              inStock: v.inStock === true,
              imagesJson: normalizeImages(v.imagesJson),
              availableQty: Number.isFinite(Number(v.availableQty)) ? Number(v.availableQty) : null,
              offers: Array.isArray(v.offers)
                ? v.offers.map((o: any) => ({
                  id: String(o.id),
                  supplierId: o.supplierId ?? o.supplier?.id ?? null,
                  isActive: o.isActive === true,
                  inStock: o.inStock === true,
                  availableQty: Number.isFinite(Number(o.availableQty))
                    ? Number(o.availableQty)
                    : null,
                  unitPrice: o.unitPrice != null ? decToNumber(o.unitPrice) : null,
                  basePrice: o.basePrice != null ? decToNumber(o.basePrice) : null,
                  currency: o.currency ?? "NGN",
                  leadDays: Number.isFinite(Number(o.leadDays)) ? Number(o.leadDays) : null,
                  supplierRatingAvg:
                    o.supplierRatingAvg != null
                      ? decToNumber(o.supplierRatingAvg)
                      : o.supplier?.ratingAvg != null
                        ? decToNumber(o.supplier.ratingAvg)
                        : null,
                  supplierRatingCount:
                    o.supplierRatingCount != null
                      ? Number(o.supplierRatingCount)
                      : o.supplier?.ratingCount != null
                        ? Number(o.supplier.ratingCount)
                        : null,
                }))
                : [],
            }))
            : [];

          const baseSource =
            (Array.isArray((x as any).supplierProductOffers) && x.supplierProductOffers) ||
            (Array.isArray((x as any).supplierOffers) && (x as any).supplierOffers) ||
            [];

          const baseOffers: SupplierOfferLite[] = baseSource.map((o: any) => ({
            id: String(o.id),
            supplierId: o.supplierId ?? o.supplier?.id ?? null,
            isActive: o.isActive === true,
            inStock: o.inStock === true,
            availableQty: Number.isFinite(Number(o.availableQty)) ? Number(o.availableQty) : null,
            basePrice: o.basePrice != null ? decToNumber(o.basePrice) : null,
            unitPrice: o.unitPrice != null ? decToNumber(o.unitPrice) : null,
            currency: o.currency ?? "NGN",
            leadDays: Number.isFinite(Number(o.leadDays)) ? Number(o.leadDays) : null,
            supplierRatingAvg:
              o.supplierRatingAvg != null
                ? decToNumber(o.supplierRatingAvg)
                : o.supplier?.ratingAvg != null
                  ? decToNumber(o.supplier.ratingAvg)
                  : null,
            supplierRatingCount:
              o.supplierRatingCount != null
                ? Number(o.supplierRatingCount)
                : o.supplier?.ratingCount != null
                  ? Number(o.supplier.ratingCount)
                  : null,
          }));

          const catNameRaw = cleanText(x.categoryName ?? x.category?.name ?? "");

          return {
            id: String(x.id),
            title: cleanText(x.title),
            description: x.description ?? "",
            sku: x.sku ?? null,
            retailPrice: x.retailPrice != null ? decToNumber(x.retailPrice) : null,
            computedRetailPrice:
              x.computedRetailPrice != null ? decToNumber(x.computedRetailPrice) : null,
            autoPrice: x.autoPrice != null ? decToNumber(x.autoPrice) : null,
            displayBasePrice: x.displayBasePrice != null ? decToNumber(x.displayBasePrice) : null,
            offersFrom: x.offersFrom != null ? decToNumber(x.offersFrom) : null,
            commissionPctInt: Number.isFinite(Number(x.commissionPctInt))
              ? Number(x.commissionPctInt)
              : null,
            inStock: x.inStock === true,
            availableQty: Number.isFinite(Number(x.availableQty)) ? Number(x.availableQty) : null,
            imagesJson: normalizeImages(x.imagesJson),
            categoryId:
              x.categoryId != null
                ? String(x.categoryId)
                : x.category?.id != null
                  ? String(x.category.id)
                  : null,
            categoryName: catNameRaw || null,
            brand:
              x.brand && (x.brand.id != null || x.brand.name != null)
                ? {
                  id: String(x.brand.id ?? ""),
                  name: cleanText(x.brand.name),
                }
                : null,
            variants,
            supplierProductOffers: baseOffers,
            ratingAvg: x.ratingAvg != null ? decToNumber(x.ratingAvg) : null,
            ratingCount: x.ratingCount != null ? Number(x.ratingCount) : null,
            status: String(x.status ?? ""),
          } satisfies Product;
        });

      const total = Number((data as any)?.meta?.total ?? (data as any)?.total ?? 0) || 0;
      const take = Number((data as any)?.meta?.take ?? pageSize) || pageSize;
      const serverPage = Number((data as any)?.meta?.page ?? page) || page;
      const totalPages =
        Number((data as any)?.meta?.totalPages ?? 0) || Math.max(1, Math.ceil(total / take));
      const skip =
        Number((data as any)?.meta?.skip ?? NaN) >= 0
          ? Number((data as any)?.meta?.skip)
          : Math.max(0, (serverPage - 1) * take);

      return {
        data: mapped,
        total,
        meta: {
          page: serverPage,
          take,
          skip,
          total,
          totalPages,
          hasNextPage:
            typeof (data as any)?.meta?.hasNextPage === "boolean"
              ? Boolean((data as any)?.meta?.hasNextPage)
              : serverPage < totalPages,
          hasPrevPage:
            typeof (data as any)?.meta?.hasPrevPage === "boolean"
              ? Boolean((data as any)?.meta?.hasPrevPage)
              : serverPage > 1,
        },
      };
    },
  });

  const products = useMemo(() => {
    const list = Array.isArray(productsQ.data?.data) ? productsQ.data.data : [];
    return list.filter((p) => isLive(p));
  }, [productsQ.data]);

  const productsMeta = useMemo<CatalogProductsMeta>(() => {
    return (
      productsQ.data?.meta ?? {
        page,
        take: pageSize,
        skip: Math.max(0, (page - 1) * pageSize),
        total: products.length,
        totalPages: Math.max(1, Math.ceil(products.length / pageSize)),
        hasNextPage: false,
        hasPrevPage: page > 1,
      }
    );
  }, [productsQ.data, page, pageSize, products.length]);

  const totalProducts = Number(productsMeta.total ?? productsQ.data?.total ?? 0) || 0;
  const totalPages = Math.max(
    1,
    Number(productsMeta.totalPages || Math.ceil(totalProducts / pageSize) || 1)
  );
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageTake = Number(productsMeta.take ?? pageSize) || pageSize;
  const start = totalProducts > 0 ? Number(productsMeta.skip ?? (currentPage - 1) * pageTake) : 0;

  const productViews = useMemo<ProductView[]>(() => {
    const out: ProductView[] = new Array(products.length);

    const pricing = {
      baseServiceFeeNGN,
      commsUnitCostNGN,
      gatewayFeePercent,
      gatewayFixedFeeNGN,
      gatewayFeeCapNGN,
    };

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const imageCandidates = getProductImageCandidates(p);

      const brandName = cleanText(p.brand?.name);
      const categoryLabel = cleanText(p.categoryName) || "Uncategorized";
      const displayPrice = priceForFiltering(p, pricing);
      const available = availableNow(p);
      const sellable = productSellable(p, pricing);

      out[i] = {
        ...p,
        _displayPrice: displayPrice,
        _availableNow: available,
        _sellable: sellable,
        _primaryImg: imageCandidates[0],
        _secondaryImg: imageCandidates[1],
        _brandName: brandName,
        _categoryLabel: categoryLabel,
        _searchTitle: norm(cleanText(p.title)),
        _searchDesc: norm(cleanText(p.description)),
        _searchCat: norm(categoryLabel),
        _searchBrand: norm(brandName),
      };
    }

    return out;
  }, [
    products,
    baseServiceFeeNGN,
    commsUnitCostNGN,
    gatewayFeePercent,
    gatewayFixedFeeNGN,
    gatewayFeeCapNGN,
  ]);

  /* ---------------- Categories ---------------- */

  const categoriesTreeQ = useQuery<CategoryNode[]>({
    queryKey: ["categories", "tree"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
    queryFn: async () => {
      const attempts = [
        () => api.get("/api/categories", { params: { include: "children" } }),
        () => api.get("/api/categories/tree"),
        () => api.get("/api/categories", { params: { tree: 1 } }),
        () => api.get("/api/categories"),
      ];

      for (const fn of attempts) {
        try {
          const res = await fn();
          const payload = (res as any)?.data?.data ?? (res as any)?.data ?? [];
          const flat = flattenCategoryTree(payload);
          if (!flat.length) continue;
          return buildCategoryForest(flat.filter((c) => c.isActive !== false));
        } catch {
          //
        }
      }

      return [];
    },
  });

  const categoryForest = Array.isArray(categoriesTreeQ.data) ? categoriesTreeQ.data : [];
  const catTreeHelpers = useMemo(() => {
    if (!categoryForest.length) return null;
    return buildDescendantMap(categoryForest);
  }, [categoryForest]);

  /* ---------------- Favorites ---------------- */

  const hydrated = useAuthStore((s) => s.hydrated);

  const normalizeFavoriteIds = useCallback((payload: any): string[] => {
    const root = payload ?? {};

    const candidates = Array.isArray(root?.productIds)
      ? root.productIds
      : Array.isArray(root?.data?.productIds)
        ? root.data.productIds
        : Array.isArray(root?.items)
          ? root.items
          : Array.isArray(root?.data)
            ? root.data
            : Array.isArray(root)
              ? root
              : [];

    const ids = candidates
      .map((x: any) => {
        if (typeof x === "string" || typeof x === "number") return String(x);
        return x?.productId ?? x?.product?.id ?? x?.favoriteProductId ?? x?.id ?? null;
      })
      .filter(Boolean)
      .map(String);

    return Array.from(new Set(ids));
  }, []);

  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  const favQuery = useQuery<string[]>({
    queryKey: ["favorites", "mine", user?.id ?? "anon"],
    enabled: hydrated && !isSupplier && isAuthed,
    retry: (count, e: any) => (Number(e?.response?.status) === 401 ? false : count < 2),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 30_000,
    initialData: [],
    queryFn: async () => {
      const { data } = await api.get("/api/favorites/mine", { withCredentials: true });
      return normalizeFavoriteIds(data);
    },
  });

  useEffect(() => {
    if (!hydrated || !isAuthed || isSupplier) {
      setFavIds(new Set());
      return;
    }
    setFavIds(new Set((favQuery.data ?? []).map(String)));
  }, [favQuery.data, hydrated, isAuthed, isSupplier]);

  useEffect(() => {
    if (!hydrated || !isAuthed || isSupplier) return;
    void favQuery.refetch();
  }, [hydrated, isAuthed, isSupplier]);

  const isFav = useCallback((id: string) => favIds.has(String(id)), [favIds]);

  const toggleFav = useMutation({
    mutationFn: async ({ productId }: { productId: string }) => {
      const { data } = await api.post<{ favorited: boolean }>(
        "/api/favorites/toggle",
        { productId },
        { withCredentials: true }
      );
      return { productId: String(productId), favorited: !!data?.favorited };
    },

    onMutate: async ({ productId }) => {
      const pid = String(productId);

      setFavIds((prev) => {
        const next = new Set(prev);
        if (next.has(pid)) next.delete(pid);
        else next.add(pid);
        return next;
      });

      const key = ["favorites", "mine", user?.id ?? "anon"] as const;
      const prev = qc.getQueryData<string[]>(key) ?? [];
      const next = prev.includes(pid) ? prev.filter((id) => id !== pid) : [...prev, pid];
      qc.setQueryData(key, next);

      return { prev, pid };
    },

    onError: (_e, _vars, ctx) => {
      const restored = ctx?.prev ?? [];
      setFavIds(new Set(restored.map(String)));
      qc.setQueryData(["favorites", "mine", user?.id ?? "anon"], restored);

      openModal({
        title: "Wishlist",
        message: "Could not update wishlist. Please try again.",
      });
    },

    onSuccess: ({ productId, favorited }) => {
      setFavIds((prev) => {
        const next = new Set(prev);
        if (favorited) next.add(String(productId));
        else next.delete(String(productId));
        return next;
      });
    },

    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ["favorites", "mine"] });
      window.dispatchEvent(new Event("wishlist:updated"));
    },
  });

  const handleToggleFav = useCallback(
    (productId: string) => {
      toggleFav.mutate({ productId });
    },
    [toggleFav]
  );

  /* ---------------- Filters/sort ---------------- */

  const stockRank = useCallback((p: ProductView) => (p._availableNow ? 0 : 1), []);

  const maxPriceSeen = useMemo(() => {
    const prices = productViews
      .map((p) => p._displayPrice)
      .filter((n) => Number.isFinite(n) && n > 0) as number[];
    return prices.length ? Math.max(...prices) : 0;
  }, [productViews]);

  const PRICE_BUCKETS = useMemo(
    () => generateDynamicPriceBuckets(maxPriceSeen, 1_000),
    [maxPriceSeen]
  );

  useEffect(() => {
    setSelectedBucketIdxs((curr) => {
      const next = curr.filter((idx) => idx >= 0 && idx < PRICE_BUCKETS.length);
      if (next.length === curr.length && next.every((v, i) => v === curr[i])) return curr;
      return next;
    });
  }, [PRICE_BUCKETS.length]);

  const suggestions = useMemo(() => {
    const q = normalizedQuery;
    if (!q || q.length < 2) return [];

    return productViews
      .map((p) => {
        let score = 0;
        if (p._searchTitle.startsWith(q)) score += 4;
        else if (p._searchTitle.includes(q)) score += 3;
        if (p._searchDesc.includes(q)) score += 1;
        if (p._searchCat.includes(q)) score += 2;
        if (p._searchBrand.includes(q)) score += 2;
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.p);
  }, [productViews, normalizedQuery]);

  const selectedCategoryEffective = useMemo(() => {
    const base = new Set(deferredSelectedCategories.map(String));
    if (!catTreeHelpers) return base;

    for (const id of deferredSelectedCategories) {
      const desc = catTreeHelpers.getAllDesc(String(id));
      for (const d of desc) base.add(String(d));
    }

    return base;
  }, [deferredSelectedCategories, catTreeHelpers]);

  const activeBrandSet = useMemo(
    () => new Set(deferredSelectedBrands.map((b) => toBrandKey(b)).filter(Boolean)),
    [deferredSelectedBrands]
  );

  const activeBuckets = useMemo(
    () => deferredSelectedBucketIdxs.map((i) => PRICE_BUCKETS[i]).filter(Boolean),
    [deferredSelectedBucketIdxs, PRICE_BUCKETS]
  );

  const queryMatchedCategoryIds = useMemo(() => {
    const q = normalizedDeferredQuery;
    const out = new Set<string>();

    if (!catTreeHelpers || !q) return out;

    for (const c of catTreeHelpers.byId.values()) {
      if (!norm(c.name).includes(q)) continue;
      out.add(c.id);
      for (const d of catTreeHelpers.getAllDesc(c.id)) out.add(d);
    }

    return out;
  }, [catTreeHelpers, normalizedDeferredQuery]);

  const queryMatchedProducts = useMemo(() => {
    const q = normalizedDeferredQuery;

    return productViews.filter((p) => {
      if (deferredInStockOnly && !p._availableNow) return false;
      if (!q) return true;

      const productCategoryKey = toCategoryKey(p.categoryId);
      const categoryHit = queryMatchedCategoryIds.has(productCategoryKey);

      return (
        p._searchTitle.includes(q) ||
        p._searchDesc.includes(q) ||
        p._searchCat.includes(q) ||
        p._searchBrand.includes(q) ||
        categoryHit
      );
    });
  }, [productViews, normalizedDeferredQuery, deferredInStockOnly, queryMatchedCategoryIds]);

  const catalogAnalysis = useMemo(() => {
    const filteredRows: ProductView[] = [];
    const categoryCountMap = new Map<string, { id: string; name: string; count: number }>();
    const brandCountMap = new Map<string, { name: string; count: number }>();
    const bucketCounts = PRICE_BUCKETS.map(() => 0);

    for (const p of queryMatchedProducts) {
      const productCategoryKey = toCategoryKey(p.categoryId);
      const productBrandKey = toBrandKey(p._brandName);

      const catMatch =
        selectedCategoryEffective.size === 0
          ? true
          : selectedCategoryEffective.has(productCategoryKey);

      const brandMatch =
        activeBrandSet.size === 0 ? true : activeBrandSet.has(productBrandKey);

      const priceMatch =
        activeBuckets.length === 0
          ? true
          : activeBuckets.some((b) => inBucket(p._displayPrice, b));

      let bucketIndex = -1;
      for (let i = 0; i < PRICE_BUCKETS.length; i++) {
        if (inBucket(p._displayPrice, PRICE_BUCKETS[i])) {
          bucketIndex = i;
          break;
        }
      }

      if (
        (activeBuckets.length === 0 || priceMatch) &&
        (activeBrandSet.size === 0 || brandMatch)
      ) {
        const catName = cleanText(p.categoryName) || "Uncategorized";
        const prev = categoryCountMap.get(productCategoryKey) ?? {
          id: productCategoryKey,
          name: catName,
          count: 0,
        };
        prev.count += 1;
        categoryCountMap.set(productCategoryKey, prev);
      }

      if (
        (activeBuckets.length === 0 || priceMatch) &&
        (selectedCategoryEffective.size === 0 || catMatch)
      ) {
        if (productBrandKey) {
          const prev = brandCountMap.get(productBrandKey) ?? {
            name: cleanText(p._brandName),
            count: 0,
          };
          prev.count += 1;
          brandCountMap.set(productBrandKey, prev);
        }
      }

      if (
        (selectedCategoryEffective.size === 0 || catMatch) &&
        (activeBrandSet.size === 0 || brandMatch)
      ) {
        if (bucketIndex >= 0) bucketCounts[bucketIndex] += 1;
      }

      if (catMatch && brandMatch && priceMatch) {
        if (!HIDE_OOS || p._sellable) filteredRows.push(p);
      }
    }

    return {
      filtered: filteredRows,
      categoryCountsMap: categoryCountMap,
      categories: Array.from(categoryCountMap.values())
        .filter((c) => c.count > 0)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
      brands: Array.from(brandCountMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      ),
      visiblePriceBuckets: PRICE_BUCKETS
        .map((bucket, idx) => ({ bucket, idx, count: bucketCounts[idx] || 0 }))
        .filter((x) => x.count > 0),
    };
  }, [
    queryMatchedProducts,
    selectedCategoryEffective,
    activeBrandSet,
    activeBuckets,
    PRICE_BUCKETS,
    HIDE_OOS,
  ]);

  const categoryCountsMap = catalogAnalysis.categoryCountsMap;
  const categories = catalogAnalysis.categories;
  const brands = catalogAnalysis.brands;
  const visiblePriceBuckets = catalogAnalysis.visiblePriceBuckets;
  const filtered = catalogAnalysis.filtered;

  const categoryTreeUi = useMemo(() => {
    if (!categoryForest.length || !catTreeHelpers) return null;

    const directCounts = new Map<string, number>();
    for (const [id, v] of categoryCountsMap.entries()) {
      if (id === "uncategorized") continue;
      directCounts.set(id, v.count);
    }

    const aggregated = aggregateCountsToParents(categoryForest, directCounts);

    const rows: Array<{ node: CategoryNode; count: number; depth: number; hasChildren: boolean }> =
      [];

    const walk = (n: CategoryNode, depth: number) => {
      const count = aggregated.get(n.id) || 0;
      if (count <= 0) return;

      rows.push({ node: n, count, depth, hasChildren: n.children.length > 0 });

      const isExpanded = !!expandedCats[n.id];
      if (n.children.length > 0 && isExpanded) {
        for (const c of n.children) walk(c, depth + 1);
      }
    };

    for (const r of categoryForest) walk(r, 0);

    return rows.length ? rows : null;
  }, [categoryForest, catTreeHelpers, categoryCountsMap, expandedCats]);

  const purchasedQ = usePurchasedCounts(!isSupplier);

  const recScored = useMemo(() => {
    if (sortKey !== "relevance") return filtered;

    const purchased = purchasedQ.data ?? {};
    const clicks = productClicksRef.current;

    return filtered
      .map((p) => {
        const buy = Math.log1p(purchased[p.id] || 0);
        const clk = Math.log1p(clicks[p.id] || 0);
        const score = 2.5 * buy + 1.5 * clk;
        return { p, score };
      })
      .sort((a, b) => {
        const sr = stockRank(a.p) - stockRank(b.p);
        if (!deferredInStockOnly && sr !== 0) return sr;

        const av = a.p._sellable ? 1 : 0;
        const bv = b.p._sellable ? 1 : 0;
        if (bv !== av) return bv - av;

        if (b.score !== a.score) return b.score - a.score;

        const ar = bestSupplierRatingScore(a.p);
        const br = bestSupplierRatingScore(b.p);
        if (br !== ar) return br - ar;

        return a.p._displayPrice - b.p._displayPrice;
      })
      .map((x) => x.p);
  }, [filtered, sortKey, purchasedQ.data, deferredInStockOnly, stockRank]);

  const sorted = useMemo(() => {
    if (sortKey === "relevance") return recScored;

    return [...filtered].sort((a, b) => {
      const sr = stockRank(a) - stockRank(b);
      if (!deferredInStockOnly && sr !== 0) return sr;

      const av = a._sellable ? 1 : 0;
      const bv = b._sellable ? 1 : 0;
      if (bv !== av) return bv - av;

      if (sortKey === "price-asc") return a._displayPrice - b._displayPrice;
      if (sortKey === "price-desc") return b._displayPrice - a._displayPrice;
      return 0;
    });
  }, [filtered, recScored, sortKey, deferredInStockOnly, stockRank]);

  /* ---------------- Pagination ---------------- */

  useEffect(() => {
    if (!didHydrateRef.current) {
      didHydrateRef.current = true;
      return;
    }
    setPage(1);
  }, [selectedCategories, selectedBucketIdxs, selectedBrands, pageSize, sortKey, query, inStockOnly]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    setJumpVal("");
  }, [currentPage]);

  useEffect(() => {
    if (didRestoreScrollRef.current) return;
    if (!shouldRestoreScrollRef.current) return;
    if (productsQ.isLoading) return;

    didRestoreScrollRef.current = true;
    shouldRestoreScrollRef.current = false;
    setCatalogReturning(false);

    const y = initialScrollRef.current ?? 0;

    if (scrollRafRef.current != null) {
      window.cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    if (scrollRafInnerRef.current != null) {
      window.cancelAnimationFrame(scrollRafInnerRef.current);
      scrollRafInnerRef.current = null;
    }

    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafInnerRef.current = window.requestAnimationFrame(() => {
        window.scrollTo(0, y);
        scrollRafRef.current = null;
        scrollRafInnerRef.current = null;
      });
    });
  }, [productsQ.isLoading]);

  const isPageFetching = productsQ.isFetching && !productsQ.isLoading;
  const canGoPrev = currentPage > 1 && !isPageFetching;
  const canGoNext = currentPage < totalPages && !isPageFetching;

  const goTo = useCallback(
    (nextPage: number) => {
      if (isPageFetching) return;

      const clamped = Math.min(Math.max(1, Math.trunc(Number(nextPage) || 1)), totalPages);
      if (clamped === currentPage) return;

      writeCatalogScroll(window.scrollY || window.pageYOffset || 0);
      setPage(clamped);
    },
    [currentPage, totalPages, isPageFetching]
  );

  const windowedPages = useCallback((current: number, total: number, radius = 2) => {
    const pages: number[] = [];
    const s = Math.max(1, current - radius);
    const e = Math.min(total, current + radius);

    for (let i = s; i <= e; i++) pages.push(i);
    if (pages[0] !== 1) pages.unshift(1);
    if (pages[pages.length - 1] !== total) pages.push(total);

    return [...new Set(pages)].sort((a, b) => a - b);
  }, []);

  const pagesDesktop = useMemo(
    () => windowedPages(currentPage, totalPages, 2),
    [currentPage, totalPages, windowedPages]
  );

  const pageItems = useMemo(() => sorted, [sorted]);
  const pageCount = pageItems.length;
  const displayFrom = totalProducts === 0 || pageCount === 0 ? 0 : start + 1;
  const displayTo = totalProducts === 0 || pageCount === 0 ? 0 : Math.min(start + pageCount, totalProducts);

  /* =========================================================
     Add to cart
  ========================================================= */

  const setCartQty = useCallback(
    async (p: ProductView, nextQty: number) => {
      try {
        const qty = Math.max(0, Math.floor(Number(nextQty) || 0));
        const primaryImg = p._primaryImg ?? null;
        const optionsKey = "";

        const activeBaseOffer = getActiveBaseOffer(p);

        if (qty > 0 && !activeBaseOffer) {
          openModal({
            title: "Unavailable",
            message: "This item is no longer available to add to cart. Please refresh and try again.",
          });
          return;
        }

        const unitPriceCache =
          Number(activeBaseOffer?.basePrice ?? activeBaseOffer?.unitPrice ?? 0) > 0
            ? Number(activeBaseOffer?.basePrice ?? activeBaseOffer?.unitPrice ?? 0)
            : p._displayPrice || 0;

        const nextLines = upsertCartLine({
          productId: String(p.id),
          variantId: null,
          kind: "BASE",
          optionsKey,
          qty,
          selectedOptions: [],
          titleSnapshot: p.title ?? null,
          imageSnapshot: primaryImg ?? null,
          unitPriceCache: Number.isFinite(unitPriceCache) ? unitPriceCache : 0,
          supplierId: activeBaseOffer?.supplierId ?? null,
          offerId: activeBaseOffer?.id ?? undefined,
        });

        window.dispatchEvent(new Event("cart:updated"));

        window.setTimeout(() => {
          showMiniCartToast(
            toMiniCartRows(nextLines),
            { productId: p.id, variantId: null },
            { mode: qty > 0 ? "add" : "remove" }
          );
        }, 0);

        syncServerQtyCoalesced(
          p,
          qty,
          unitPriceCache,
          primaryImg,
          activeBaseOffer?.supplierId ?? null,
          activeBaseOffer?.id
        );
      } catch (err: any) {
        console.error(err);
        openModal({ title: "Cart", message: err?.message || "Could not update cart." });
      }
    },
    [openModal, syncServerQtyCoalesced]
  );

  const cartQtyMap = useMemo(() => {
    const map = new Map<string, number>();

    for (const line of cartSnapshot) {
      const productId = String((line as any)?.productId ?? "");
      const variantId = (line as any)?.variantId ?? null;
      const qty = Number((line as any)?.qty ?? 0);

      if (!productId || variantId != null) continue;
      map.set(productId, (map.get(productId) || 0) + (Number.isFinite(qty) ? qty : 0));
    }

    return map;
  }, [cartSnapshot]);

  /* ---------------- UI helpers ---------------- */

  const submitSearch = useCallback(() => {
    setSearchFocused(false);
    setActiveIdx(0);
    writeCatalogScroll(window.scrollY || window.pageYOffset || 0);
    setPage(1);
  }, []);

  const applySuggestionToFilter = useCallback((title: string) => {
    setQuery(title);
    setSearchFocused(false);
    setActiveIdx(0);
    writeCatalogScroll(window.scrollY || window.pageYOffset || 0);
    setPage(1);
  }, []);

  const toggleCategory = useCallback((id: string) => {
    setSelectedCategories((curr) =>
      curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id]
    );
  }, []);

  const toggleBucket = useCallback((idx: number) => {
    setSelectedBucketIdxs((curr) =>
      curr.includes(idx) ? curr.filter((i) => i !== idx) : [...curr, idx]
    );
  }, []);

  const toggleBrand = useCallback((name: string) => {
    setSelectedBrands((curr) =>
      curr.includes(name) ? curr.filter((n) => n !== name) : [...curr, name]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedCategories([]);
    setSelectedBucketIdxs([]);
    setSelectedBrands([]);
    setInStockOnly(true);
    setExpandedCats({});
    setPage(1);
    writeCatalogScroll(0);
  }, []);

  const anyActiveFilter =
    selectedCategories.length > 0 ||
    selectedBucketIdxs.length > 0 ||
    selectedBrands.length > 0 ||
    !inStockOnly;

  const hasSearch = !!normalizedDeferredQuery;
  const hasTypedQuery = !!normalizedQuery;
  const shouldShowSuggest = searchFocused && hasTypedQuery;
  const hasSuggestionResults = suggestions.length > 0;

  const toggleExpand = useCallback((id: string) => {
    setExpandedCats((m) => ({ ...m, [id]: !m[id] }));
  }, []);
  /* ---------------- Render guards ---------------- */

  if (productsQ.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <MotionCircleLoader label="Loading products…" />
      </div>
    );
  }

  if (productsQ.error) {
    return (
      <>
        <div className="flex min-h-[60vh] items-center justify-center">
          <MotionCircleLoader label="Loading products…" />
        </div>
        <p className="p-6 text-center text-rose-600">We are sorry, we are having technical issues</p>
      </>
    );
  }

  /* =========================================================
     Main render
========================================================= */
  return (
    <SiteLayout>
      <div
        ref={resultsTopRef}
        className="mx-auto -mt-6 max-w-7xl px-1 pb-4 pt-0 sm:px-4 md:mt-0 md:px-8 md:py-8"
        onTouchStart={(e) => {
          if (refineOpen) return;
          const x = e.touches[0]?.clientX ?? 0;
          const w = window.innerWidth || 0;
          if (w > 0 && x > w - 24) setTouchStartX(x);
        }}
        onTouchMove={(e) => {
          if (touchStartX == null || refineOpen) return;
          const x = e.touches[0]?.clientX ?? 0;
          const dx = x - touchStartX;
          if (dx < -40) {
            setRefineOpen(true);
            setTouchStartX(null);
          }
        }}
        onTouchEnd={() => setTouchStartX(null)}
      >
        <div className="hidden border-b bg-white md:block">
          <div className="mx-auto max-w-7xl px-4 pb-4 pt-3 md:px-8 md:py-10">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 md:text-4xl">
                  Discover Products
                </h1>
                <p className="mt-2 text-sm text-zinc-600 md:text-base">
                  Fresh picks, smart sorting, and instant search—tailored for you.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setRefineOpen(true)}
                className="hidden items-center gap-2 rounded-full border border-zinc-200 bg-white/90 px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm transition hover:border-zinc-300 active:scale-[0.98] md:inline-flex"
              >
                <SlidersHorizontal size={18} />
                Filter categories & brands
              </button>
            </div>
          </div>
        </div>

        <div className="mb-2 md:hidden">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-zinc-900">Products</h1>
            <p className="text-xs text-zinc-600">Search and filter quickly.</p>
          </div>
        </div>

        {(hasSearch || anyActiveFilter || sortKey !== "relevance" || pageSize !== 12) && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-700 md:hidden">
            {hasSearch && (
              <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1">
                Search: <span className="font-semibold">{query.trim()}</span>
              </span>
            )}
            {anyActiveFilter && (
              <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1">
                Filters: <span className="font-semibold">active</span>
              </span>
            )}
            {sortKey !== "relevance" && (
              <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1">
                Sort:{" "}
                <span className="font-semibold">
                  {sortKey === "price-asc"
                    ? "Low → High"
                    : sortKey === "price-desc"
                      ? "High → Low"
                      : "Relevance"}
                </span>
              </span>
            )}
            {pageSize !== 12 && (
              <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1">
                Per page: <span className="font-semibold">{pageSize}</span>
              </span>
            )}
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white/90 px-3 py-1.5 shadow-sm hover:border-zinc-300"
              onClick={() => setRefineOpen(true)}
            >
              <SlidersHorizontal size={14} />
              Edit filters
            </button>
          </div>
        )}

        <div className="mb-1 rounded-lg border border-zinc-200 bg-white/95 p-2 shadow-sm md:hidden">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch();
            }}
          >
            <Search
              className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400"
              size={11}
            />

            <input
              ref={mobileInputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchFocused(true);
                setActiveIdx(0);
              }}
              onFocus={() => setSearchFocused(true)}
              placeholder="Search products..."
              className="h-8 w-full rounded-lg border border-zinc-200 bg-white pl-7 pr-[4.5rem] text-[11px] placeholder:text-[10px] placeholder:text-zinc-400 focus:border-fuchsia-400 focus:ring-1 focus:ring-fuchsia-100"
              aria-label="Search products"
            />

            <button
              type="submit"
              className="absolute right-1 top-1/2 inline-flex h-6 -translate-y-1/2 items-center rounded-full bg-zinc-900 px-2.5 text-[10px] font-medium text-white transition hover:bg-zinc-800"
            >
              Search
            </button>
          </form>

          <div className="mt-1 flex items-center gap-2">
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="h-7 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-[11px] text-zinc-700"
            >
              <option value="relevance">Relevance</option>
              <option value="price-asc">Low → High</option>
              <option value="price-desc">High → Low</option>
            </select>

            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) as 8 | 12 | 16)}
              className="h-7 w-[64px] rounded-md border border-zinc-200 bg-white px-1 text-[11px] text-zinc-700"
            >
              <option value={8}>8</option>
              <option value={12}>12</option>
              <option value={16}>16</option>
            </select>

            <button
              type="button"
              onClick={() => setRefineOpen(true)}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 text-[11px] font-medium text-zinc-700 shadow-sm"
            >
              <SlidersHorizontal size={11} />
              Filters
            </button>
          </div>

          <div className="mt-1 flex items-center">
            <label className="inline-flex items-center gap-1 text-[11px] text-zinc-700">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
                className="h-3 w-3 accent-purple-600"
              />
              In stock
            </label>
          </div>
        </div>

        <div className="mt-2 md:grid md:grid-cols-[280px_minmax(0,1fr)] md:gap-6">
          <aside className="hidden md:block">
            <div className="sticky top-24 rounded-2xl border border-zinc-200 bg-white/90 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-900">Filter categories & brands</h3>
                {(anyActiveFilter || hasSearch) && (
                  <button
                    type="button"
                    className="text-xs font-medium text-fuchsia-700 hover:underline"
                    onClick={() => {
                      setQuery("");
                      setSearchFocused(false);
                      setActiveIdx(0);
                      clearFilters();
                    }}
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-zinc-700">Sort</label>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2"
                >
                  <option value="relevance">Relevance</option>
                  <option value="price-asc">Price: Low → High</option>
                  <option value="price-desc">Price: High → Low</option>
                </select>
              </div>

              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-zinc-700">Per page</label>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as 8 | 12 | 16)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2"
                >
                  <option value={8}>8</option>
                  <option value={12}>12</option>
                  <option value={16}>16</option>
                </select>
              </div>

              <div className="mb-4">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-800">
                  <input
                    type="checkbox"
                    checked={inStockOnly}
                    onChange={(e) => setInStockOnly(e.target.checked)}
                    className="h-3 w-3 rounded border-zinc-300 accent-purple-600 focus:ring-purple-500"
                  />
                  In stock
                </label>
              </div>

              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-zinc-800">Categories</h4>
                  <button
                    className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
                    onClick={() => setSelectedCategories([])}
                    disabled={selectedCategories.length === 0}
                  >
                    Reset
                  </button>
                </div>

                {categoryTreeUi ? (
                  <ul className="max-h-60 space-y-1.5 overflow-auto pr-1">
                    {categoryTreeUi.map(({ node, count, depth, hasChildren }) => {
                      const checked = selectedCategories.includes(node.id);
                      const expanded = !!expandedCats[node.id];
                      const pad = Math.min(24, depth * 10);

                      return (
                        <li key={node.id}>
                          <div
                            className={`flex w-full items-center gap-1.5 rounded-xl border px-2 py-1.5 text-xs transition ${checked
                              ? "border-zinc-900 bg-zinc-900 text-white"
                              : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-black/5"
                              }`}
                            style={{ paddingLeft: 8 + pad }}
                          >
                            {hasChildren ? (
                              <button
                                type="button"
                                onClick={() => toggleExpand(node.id)}
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-lg ${checked
                                  ? "text-white/90 hover:bg-white/10"
                                  : "text-zinc-600 hover:bg-black/5"
                                  }`}
                                aria-label={expanded ? "Collapse category" : "Expand category"}
                              >
                                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </button>
                            ) : (
                              <span className="inline-flex h-6 w-6" />
                            )}

                            <button
                              type="button"
                              onClick={() => toggleCategory(node.id)}
                              className="min-w-0 flex-1 text-left"
                              title={node.name}
                            >
                              <span className="truncate">{node.name}</span>
                            </button>

                            <span
                              className={`ml-2 text-[11px] ${checked ? "text-white/90" : "text-zinc-600"
                                }`}
                            >
                              ({count})
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <ul className="max-h-52 space-y-1.5 overflow-auto pr-1">
                    {categories.length === 0 && <Shimmer />}
                    {categories.map((c) => {
                      const checked = selectedCategories.includes(c.id);
                      return (
                        <li key={c.id}>
                          <button
                            onClick={() => toggleCategory(c.id)}
                            className={`flex w-full items-center justify-between rounded-xl border px-3 py-1.5 text-xs transition ${checked
                              ? "bg-zinc-900 text-white"
                              : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-black/5"
                              }`}
                          >
                            <span className="truncate">{c.name}</span>
                            <span
                              className={`ml-2 text-[11px] ${checked ? "text-white/90" : "text-zinc-600"
                                }`}
                            >
                              ({c.count})
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {brands.length > 0 && (
                <div className="mb-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-zinc-800">Brands</h4>
                    <button
                      className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
                      onClick={() => setSelectedBrands([])}
                      disabled={selectedBrands.length === 0}
                    >
                      Reset
                    </button>
                  </div>
                  <ul className="max-h-44 space-y-1.5 overflow-auto pr-1">
                    {brands.map((b) => {
                      const checked = selectedBrands.includes(b.name);
                      return (
                        <li key={b.name}>
                          <button
                            onClick={() => toggleBrand(b.name)}
                            className={`flex w-full items-center justify-between rounded-xl border px-3 py-1.5 text-xs transition ${checked
                              ? "bg-zinc-900 text-white"
                              : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-black/5"
                              }`}
                          >
                            <span className="truncate">{b.name}</span>
                            <span
                              className={`ml-2 text-[11px] ${checked ? "text-white/90" : "text-zinc-600"
                                }`}
                            >
                              ({b.count})
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-zinc-800">Price</h4>
                  <button
                    className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
                    onClick={() => setSelectedBucketIdxs([])}
                    disabled={selectedBucketIdxs.length === 0}
                  >
                    Reset
                  </button>
                </div>

                <ul className="max-h-56 space-y-1.5 overflow-auto pr-1">
                  {visiblePriceBuckets.length === 0 && <Shimmer />}
                  {visiblePriceBuckets.map(({ bucket, idx, count }) => {
                    const checked = selectedBucketIdxs.includes(idx);
                    return (
                      <li key={bucket.label}>
                        <button
                          onClick={() => toggleBucket(idx)}
                          className={`flex w-full items-center justify-between rounded-xl border px-3 py-1.5 text-xs transition ${checked
                            ? "bg-zinc-900 text-white"
                            : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-black/5"
                            }`}
                        >
                          <span>{bucket.label}</span>
                          <span
                            className={`ml-2 text-[11px] ${checked ? "text-white/90" : "text-zinc-600"
                              }`}
                          >
                            ({count})
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </aside>

          <section className="mt-0 min-w-0">
            <div className="mb-4 hidden items-start justify-end md:flex">
              <form
                className="relative ml-auto w-full max-w-2xl"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitSearch();
                }}
              >
                {shouldShowSuggest && (
                  <div
                    ref={desktopSuggestRef}
                    className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-30 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
                  >
                    {hasSuggestionResults ? (
                      <ul className="max-h-[45vh] overflow-auto p-2">
                        {suggestions.map((p, i) => (
                          <SuggestionItem
                            key={p.id}
                            p={p}
                            active={i === activeIdx}
                            onClick={applySuggestionToFilter}
                          />
                        ))}
                      </ul>
                    ) : (
                      <div className="p-3 text-sm text-zinc-500">No matching products found.</div>
                    )}
                  </div>
                )}

                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                  size={18}
                />
                <input
                  ref={desktopInputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSearchFocused(true);
                    setActiveIdx(0);
                  }}
                  onFocus={() => setSearchFocused(true)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown" && shouldShowSuggest && hasSuggestionResults) {
                      e.preventDefault();
                      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
                      return;
                    }

                    if (e.key === "ArrowUp" && shouldShowSuggest && hasSuggestionResults) {
                      e.preventDefault();
                      setActiveIdx((i) => Math.max(i - 1, 0));
                      return;
                    }

                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitSearch();
                      return;
                    }

                    if (e.key === "Escape") {
                      setSearchFocused(false);
                      return;
                    }
                  }}
                  placeholder="Search products, brands, or categories…"
                  className="w-full rounded-2xl border border-zinc-200 bg-white/90 py-2.5 pl-10 pr-28 backdrop-blur focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-100"
                  aria-label="Search products"
                />

                <button
                  type="submit"
                  className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center rounded-full bg-zinc-400 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
                >
                  Search
                </button>
              </form>
            </div>

            {sorted.length === 0 ? (
              <p className="text-sm text-zinc-600">No products match your filters.</p>
            ) : (
              <>
                <div className="-mx-2 grid grid-cols-2 gap-1.5 sm:mx-0 sm:gap-3 md:grid-cols-4 md:gap-4">
                  {pageItems.map((p) => {
                    const fav = isFav(p.id);
                    const bestPrice = p._displayPrice;
                    const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;
                    const activeBaseOffer = hasVariants ? null : getActiveBaseOffer(p);
                    const inStock = hasVariants ? p._availableNow : !!activeBaseOffer;
                    const baseQtyInCart = cartQtyMap.get(String(p.id)) ?? 0;
                    const canAdjustBaseQty = hasVariants ? false : !!activeBaseOffer;

                    return (
                      <ProductCard
                        key={p.id}
                        p={p}
                        fav={fav}
                        bestPrice={bestPrice}
                        inStock={inStock}
                        hasVariants={hasVariants}
                        baseQtyInCart={baseQtyInCart}
                        isSupplier={isSupplier}
                        isAuthed={isAuthed}
                        locationStateFrom={locationStateFrom}
                        canAdjustBaseQty={canAdjustBaseQty}
                        isFromCardAction={isFromCardAction}
                        persistSnapshot={persistSnapshot}
                        setRefineOpen={setRefineOpen}
                        setSearchFocused={setSearchFocused}
                        setTouchStartX={setTouchStartX}
                        openModal={openModal}
                        onToggleFav={handleToggleFav}
                        onGoToProduct={goToProduct}
                        onSetCartQty={setCartQty}
                      />
                    );
                  })}
                </div>

                <div className="mt-5 md:mt-8">
                  <div className="rounded-xl border border-zinc-200 bg-white/85 p-2 shadow-sm backdrop-blur md:hidden">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 text-[10px] font-semibold tracking-tight text-zinc-800">
                        Showing {displayFrom}-{displayTo} of {totalProducts} products
                      </div>
                      <div className="shrink-0 text-[9px] text-zinc-500">
                        Page {currentPage} / {totalPages}
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-4 gap-1.5">
                      <button
                        type="button"
                        onClick={() => goTo(1)}
                        disabled={!canGoPrev}
                        aria-label="First page"
                        title="First page"
                        className="h-7 rounded-md border border-zinc-200 bg-white text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        «
                      </button>
                      <button
                        type="button"
                        onClick={() => goTo(currentPage - 1)}
                        disabled={!canGoPrev}
                        aria-label="Previous page"
                        title="Previous page"
                        className="h-7 rounded-md border border-zinc-200 bg-white text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={() => goTo(currentPage + 1)}
                        disabled={!canGoNext}
                        aria-label="Next page"
                        title="Next page"
                        className="h-7 rounded-md border border-zinc-200 bg-white text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        ›
                      </button>
                      <button
                        type="button"
                        onClick={() => goTo(totalPages)}
                        disabled={!canGoNext}
                        aria-label="Last page"
                        title="Last page"
                        className="h-7 rounded-md border border-zinc-200 bg-white text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        »
                      </button>
                    </div>

                    <form
                      className="mt-2 flex items-center gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const n = Number(jumpVal);
                        if (Number.isFinite(n)) goTo(n);
                      }}
                    >
                      <label className="shrink-0 text-[9px] font-semibold tracking-tight text-zinc-700">
                        Go to
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        min={1}
                        max={totalPages}
                        value={jumpVal}
                        onChange={(e) => setJumpVal(e.target.value)}
                        placeholder={`${currentPage}`}
                        className="h-7 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-2 text-[10px] font-semibold focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-100"
                        aria-label="Jump to page"
                      />
                      <button
                        type="submit"
                        disabled={
                          isPageFetching ||
                          !jumpVal ||
                          Number(jumpVal) < 1 ||
                          Number(jumpVal) > totalPages
                        }
                        className="h-7 shrink-0 rounded-md bg-zinc-900 px-2.5 text-[10px] font-semibold text-white transition disabled:opacity-40 active:scale-[0.99]"
                      >
                        Go
                      </button>
                    </form>

                    {isPageFetching && (
                      <div className="mt-2 text-center text-[10px] text-zinc-500">
                        Loading page…
                      </div>
                    )}
                  </div>

                  <div className="hidden flex-col gap-3 sm:flex-row sm:items-center sm:justify-between md:flex">
                    <div className="text-sm text-zinc-600">
                      Showing {displayFrom}-{displayTo} of {totalProducts} products
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const n = Number(jumpVal);
                          if (Number.isFinite(n)) goTo(n);
                        }}
                      >
                        <label className="text-sm text-zinc-700">Go to</label>
                        <input
                          type="number"
                          min={1}
                          max={totalPages}
                          value={jumpVal}
                          onChange={(e) => setJumpVal(e.target.value)}
                          className="w-20 rounded-xl border border-zinc-200 bg-white px-3 py-1.5"
                          aria-label="Jump to page"
                        />
                        <button
                          type="submit"
                          className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
                          disabled={
                            isPageFetching ||
                            !jumpVal ||
                            Number(jumpVal) < 1 ||
                            Number(jumpVal) > totalPages
                          }
                        >
                          Go
                        </button>
                      </form>

                      <div className="flex items-center gap-1 sm:gap-2">
                        <button
                          type="button"
                          className="rounded-xl border border-zinc-200 bg-white px-2 py-1 text-[10px] hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3 sm:py-1.5 sm:text-xs"
                          onClick={() => goTo(1)}
                          disabled={!canGoPrev}
                        >
                          First
                        </button>

                        <button
                          type="button"
                          className="rounded-xl border border-zinc-200 bg-white px-2 py-1 text-[10px] hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3 sm:py-1.5 sm:text-xs"
                          onClick={() => goTo(currentPage - 1)}
                          disabled={!canGoPrev}
                        >
                          Prev
                        </button>

                        <div className="hidden items-center gap-1 sm:flex">
                          {pagesDesktop.map((n, idx) => {
                            const prev = pagesDesktop[idx - 1];
                            const showEllipsis = prev != null && n - prev > 1;

                            return (
                              <span key={`d-${n}`} className="inline-flex items-center">
                                {showEllipsis && (
                                  <span className="px-1 text-sm text-zinc-500">…</span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => goTo(n)}
                                  disabled={isPageFetching || n === currentPage}
                                  className={`rounded-xl px-3 py-1.5 text-xs disabled:cursor-not-allowed ${n === currentPage
                                    ? "border border-zinc-900 bg-zinc-900 text-white"
                                    : "border border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-40"
                                    }`}
                                  aria-current={n === currentPage ? "page" : undefined}
                                >
                                  {n}
                                </button>
                              </span>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          className="rounded-xl border border-zinc-200 bg-white px-2 py-1 text-[10px] hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3 sm:py-1.5 sm:text-xs"
                          onClick={() => goTo(currentPage + 1)}
                          disabled={!canGoNext}
                        >
                          Next
                        </button>

                        <button
                          type="button"
                          className="rounded-xl border border-zinc-200 bg-white px-2 py-1 text-[10px] hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3 sm:py-1.5 sm:text-xs"
                          onClick={() => goTo(totalPages)}
                          disabled={!canGoNext}
                        >
                          Last
                        </button>
                      </div>
                    </div>
                  </div>

                  {isPageFetching && (
                    <div className="mt-3 hidden text-center text-sm text-zinc-500 md:block">
                      Loading page…
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      <AnimatePresence>
        {refineOpen && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            aria-modal="true"
            role="dialog"
          >
            <div className="pointer-events-auto absolute inset-0 bg-black/40" onClick={closeRefine} />

            <motion.div
              className="pointer-events-auto absolute inset-y-0 right-0 flex w-[88%] max-w-sm flex-col gap-4 overflow-y-auto rounded-bl-3xl rounded-tl-3xl border border-zinc-200 bg-white p-4 shadow-2xl"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-zinc-900">Filter categories & brands</h3>
                  <p className="text-[11px] text-zinc-600">
                    Choose categories, brands, and price ranges.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeRefine}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-700 transition active:scale-95"
                  aria-label="Close filters panel"
                >
                  <X size={18} />
                </button>
              </div>

              {(anyActiveFilter || hasSearch) && (
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    className="text-[12px] font-medium text-fuchsia-700 hover:underline"
                    onClick={() => {
                      setQuery("");
                      setSearchFocused(false);
                      setActiveIdx(0);
                      clearFilters();
                    }}
                  >
                    Clear all
                  </button>
                </div>
              )}

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-[12px] font-semibold text-zinc-900">Categories</h4>
                  <button
                    className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
                    onClick={() => setSelectedCategories([])}
                    disabled={selectedCategories.length === 0}
                  >
                    Reset
                  </button>
                </div>

                {categoryTreeUi ? (
                  <ul className="max-h-56 space-y-1.5 overflow-auto pr-1">
                    {categoryTreeUi.map(({ node, count, depth, hasChildren }) => {
                      const checked = selectedCategories.includes(node.id);
                      const expanded = !!expandedCats[node.id];
                      const pad = Math.min(20, depth * 10);

                      return (
                        <li key={node.id}>
                          <div
                            className={`flex w-full items-center gap-1.5 rounded-xl border px-2 py-1.5 text-[12px] transition ${checked
                              ? "border-zinc-900 bg-zinc-900 text-white"
                              : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-black/5"
                              }`}
                            style={{ paddingLeft: 8 + pad }}
                          >
                            {hasChildren ? (
                              <button
                                type="button"
                                onClick={() => toggleExpand(node.id)}
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-lg ${checked
                                  ? "text-white/90 hover:bg-white/10"
                                  : "text-zinc-600 hover:bg-black/5"
                                  }`}
                                aria-label={expanded ? "Collapse category" : "Expand category"}
                              >
                                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </button>
                            ) : (
                              <span className="inline-flex h-6 w-6" />
                            )}

                            <button
                              type="button"
                              onClick={() => toggleCategory(node.id)}
                              className="min-w-0 flex-1 text-left"
                              title={node.name}
                            >
                              <span className="truncate">{node.name}</span>
                            </button>

                            <span
                              className={`ml-2 text-[11px] ${checked ? "text-white/90" : "text-zinc-600"
                                }`}
                            >
                              ({count})
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <ul className="max-h-56 space-y-1.5 overflow-auto pr-1">
                    {categories.length === 0 && <Shimmer />}
                    {categories.map((c) => {
                      const checked = selectedCategories.includes(c.id);
                      return (
                        <li key={c.id}>
                          <button
                            onClick={() => toggleCategory(c.id)}
                            className={`flex w-full items-center justify-between rounded-xl border px-3 py-1.5 text-[12px] transition ${checked
                              ? "bg-zinc-900 text-white"
                              : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-black/5"
                              }`}
                          >
                            <span className="truncate">{c.name}</span>
                            <span
                              className={`ml-2 text-[11px] ${checked ? "text-white/90" : "text-zinc-600"
                                }`}
                            >
                              ({c.count})
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {brands.length > 0 && (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-[12px] font-semibold text-zinc-900">Brands</h4>
                    <button
                      className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
                      onClick={() => setSelectedBrands([])}
                      disabled={selectedBrands.length === 0}
                    >
                      Reset
                    </button>
                  </div>

                  <ul className="max-h-44 space-y-1.5 overflow-auto pr-1">
                    {brands.map((b) => {
                      const checked = selectedBrands.includes(b.name);
                      return (
                        <li key={b.name}>
                          <button
                            onClick={() => toggleBrand(b.name)}
                            className={`flex w-full items-center justify-between rounded-xl border px-3 py-1.5 text-[12px] transition ${checked
                              ? "bg-zinc-900 text-white"
                              : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-black/5"
                              }`}
                          >
                            <span className="truncate">{b.name}</span>
                            <span
                              className={`ml-2 text-[11px] ${checked ? "text-white/90" : "text-zinc-600"
                                }`}
                            >
                              ({b.count})
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-[12px] font-semibold text-zinc-900">Price</h4>
                  <button
                    className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
                    onClick={() => setSelectedBucketIdxs([])}
                    disabled={selectedBucketIdxs.length === 0}
                  >
                    Reset
                  </button>
                </div>

                <ul className="max-h-52 space-y-1.5 overflow-auto pr-1">
                  {visiblePriceBuckets.length === 0 && <Shimmer />}
                  {visiblePriceBuckets.map(({ bucket, idx, count }) => {
                    const checked = selectedBucketIdxs.includes(idx);
                    return (
                      <li key={bucket.label}>
                        <button
                          onClick={() => toggleBucket(idx)}
                          className={`flex w-full items-center justify-between rounded-xl border px-3 py-1.5 text-[12px] transition ${checked
                            ? "bg-zinc-900 text-white"
                            : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-black/5"
                            }`}
                        >
                          <span>{bucket.label}</span>
                          <span
                            className={`ml-2 text-[11px] ${checked ? "text-white/90" : "text-zinc-600"
                              }`}
                          >
                            ({count})
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeRefine}
                  className="w-full rounded-2xl bg-zinc-900 px-4 py-2.5 font-semibold text-white transition active:scale-[0.98]"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SiteLayout>
  );
}