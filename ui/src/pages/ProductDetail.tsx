import * as React from "react";
import { useParams, useNavigate, Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import api from "../api/client";
import SiteLayout from "../layouts/SiteLayout";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";

import { showMiniCartToast } from "../components/cart/MiniCartToast";
import { setSeo } from "../seo/head";
import { useAuthStore } from "../store/auth";
import { useModal } from "../components/ModalProvider";

// ✅ single source of truth (navbar/cart reads this)
import { upsertCartLine, toMiniCartRows, readCartLines, writeCartLines } from "../utils/cartModel";

/* ---------------- Config ---------------- */
const AXIOS_COOKIE_CFG = { withCredentials: true as const };

/* ---------------- Types ---------------- */
type Brand = { id: string; name: string } | null;
type SupplierLite = { id: string; name?: string | null } | null;

type VariantOptionWire = {
  attributeId: string;
  valueId: string;
  unitPrice?: number | null;
  attribute?: { id: string; name: string; type?: string };
  value?: { id: string; name: string; code?: string | null };
};

type OfferWire = {
  id: string;
  supplierId: string;
  supplierName?: string | null;
  productId: string;
  variantId: string | null;
  currency?: string;
  inStock: boolean;
  isActive: boolean;
  availableQty: number;
  leadDays?: number | null;
  unitPrice?: number | null;
  model: "BASE" | "VARIANT";
};

type VariantWire = {
  id: string;
  sku?: string | null;
  retailPrice?: number | null;
  inStock?: boolean;
  imagesJson?: string[];
  options?: VariantOptionWire[];
};

type ProductWire = {
  id: string;
  title: string;
  description?: string;
  retailPrice: number | null;
  inStock?: boolean;
  imagesJson?: string[];
  brand?: Brand;
  supplier?: SupplierLite;
  variants?: VariantWire[];
  offers?: OfferWire[];
  attributes?:
  | {
    options?: Array<{
      attributeId: string;
      valueId: string;
      attribute?: { id: string; name: string };
      value?: { id: string; name: string };
      attributeName?: string;
      valueName?: string;
    }>;
    texts?: Array<{
      attributeId: string;
      value: string;
      attribute?: { id: string; name: string };
      attributeName?: string;
    }>;
  }
  | null;

  ratingAvg?: number | null;
  ratingCount?: number | null;
  bestSupplierRating?: { ratingAvg: number | null; ratingCount: number | null } | null;
};

type SimilarProductWire = {
  id: string;
  title: string;
  retailPrice: number | null;
  imagesJson?: string[];
  inStock?: boolean;
};

type BestOfferPick = {
  offerId: string;
  supplierId: string;
  supplierName?: string | null;
  model: "BASE" | "VARIANT";
  variantId: string | null;
  unitPrice: number;
  leadDays: number | null;
  availableQty: number;
};

type ProductQueryData = {
  product: ProductWire;
  stockByVariantId: Record<string, number>;
  baseStockQty: number;
  variantStockQty: number;
  totalStockQty: number;
  hasBaseOffer: boolean;
  sellableVariantIds: Set<string>;
  baseDefaultsFromAttributes: Record<string, string>;
  cheapestBaseOffer: BestOfferPick | null;
  cheapestOverallOffer: BestOfferPick | null;
};

/* ---------------- Helpers ---------------- */
const NGN = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const toNum = (n: unknown, d = 0) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
};

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

  if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
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

function selectionPairsOf(sel: Record<string, string>) {
  return Object.entries(sel)
    .filter(([, v]) => !!String(v || "").trim())
    .map(([aid, vid]) => `${aid}:${vid}`);
}

function selectionKeyFromSelected(sel: Record<string, string>) {
  const pairs = selectionPairsOf(sel);
  if (!pairs.length) return "";
  pairs.sort();
  return pairs.join("|");
}

function normalizeSelectionMap(input?: Record<string, string> | null) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input || {})) {
    const kk = String(k ?? "").trim();
    const vv = String(v ?? "").trim();
    if (kk && vv) out[kk] = vv;
  }
  return out;
}

function buildEffectiveVariantSelectionMap(args: {
  variant?: VariantWire | null;
  baseDefaults?: Record<string, string>;
}) {
  const out: Record<string, string> = normalizeSelectionMap(args.baseDefaults);

  for (const o of args.variant?.options || []) {
    const a = String(o.attributeId ?? "").trim();
    const v = String(o.valueId ?? "").trim();
    if (a && v) out[a] = v;
  }

  return out;
}

function normalizeVariants(p: any): VariantWire[] {
  const src: any[] = Array.isArray(p?.variants)
    ? p.variants
    : Array.isArray(p?.ProductVariant)
      ? p.ProductVariant
      : [];

  const readVariantRetail = (x: any) => {
    const raw = x?.retailPrice ?? x?.price ?? null;
    return raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
  };

  const readOptionUnit = (x: any) => {
    const raw = x?.unitPrice ?? null;
    return raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
  };

  return src.map((v: any) => ({
    id: String(v.id),
    sku: v.sku ?? null,
    retailPrice: readVariantRetail(v),
    inStock: v.inStock !== false,
    imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
    options: Array.isArray(v.options)
      ? v.options
        .map((o: any) => ({
          attributeId: String(o.attributeId ?? o.attribute?.id ?? ""),
          valueId: String(o.valueId ?? o.value?.id ?? ""),
          unitPrice: readOptionUnit(o),
          attribute: o.attribute
            ? { id: String(o.attribute.id), name: String(o.attribute.name), type: o.attribute.type }
            : undefined,
          value: o.value
            ? { id: String(o.value.id), name: String(o.value.name), code: o.value.code ?? null }
            : undefined,
        }))
        .filter((o: any) => o.attributeId && o.valueId)
      : [],
  }));
}

function offersFromSchema(p: any): OfferWire[] {
  const base: any[] = Array.isArray(p?.supplierProductOffers) ? p.supplierProductOffers : [];
  const vars: any[] = Array.isArray(p?.supplierVariantOffers) ? p.supplierVariantOffers : [];

  const fallbackSupplierId = String(p?.supplierId ?? p?.supplier?.id ?? "PRODUCT_SUPPLIER");
  const fallbackSupplierName = p?.supplier?.name ? String(p.supplier.name) : null;

  const out: OfferWire[] = [];

  for (const o of base) {
    out.push({
      id: String(o.id),
      supplierId: fallbackSupplierId,
      supplierName: fallbackSupplierName,
      productId: String(o.productId),
      variantId: null,
      currency: o?.currency ?? "NGN",
      inStock: Boolean(o?.inStock),
      isActive: Boolean(o?.isActive),
      availableQty: Number(o?.availableQty ?? 0) || 0,
      leadDays: o?.leadDays ?? null,
      unitPrice: o?.basePrice != null ? Number(o.basePrice) : null,
      model: "BASE",
    });
  }

  for (const o of vars) {
    out.push({
      id: String(o.id),
      supplierId: fallbackSupplierId,
      supplierName: fallbackSupplierName,
      productId: String(o.productId),
      variantId: String(o.variantId),
      currency: o?.currency ?? "NGN",
      inStock: Boolean(o?.inStock),
      isActive: Boolean(o?.isActive),
      availableQty: Number(o?.availableQty ?? 0) || 0,
      leadDays: o?.leadDays ?? null,
      unitPrice: o?.unitPrice != null ? Number(o.unitPrice) : null,
      model: "VARIANT",
    });
  }

  return out;
}

function normalizeAttributesIntoProductWire(p: any): ProductWire["attributes"] {
  if (p?.attributes && typeof p.attributes === "object" && !Array.isArray(p.attributes)) {
    const opts = Array.isArray(p.attributes.options) ? p.attributes.options : [];
    const texts = Array.isArray(p.attributes.texts) ? p.attributes.texts : [];

    return {
      options: opts
        .map((row: any) => {
          const attributeId = String(row?.attributeId ?? row?.attribute?.id ?? "").trim();
          const valueId = String(row?.valueId ?? row?.value?.id ?? "").trim();
          if (!attributeId || !valueId) return null;

          const attributeName = row?.attribute?.name ?? row?.attributeName;
          const valueName = row?.value?.name ?? row?.valueName;

          return {
            attributeId,
            valueId,
            attribute: attributeName ? { id: attributeId, name: String(attributeName) } : undefined,
            value: valueName ? { id: valueId, name: String(valueName) } : undefined,
            attributeName: attributeName ? String(attributeName) : undefined,
            valueName: valueName ? String(valueName) : undefined,
          };
        })
        .filter(Boolean) as any[],
      texts: texts
        .map((t: any) => {
          const attributeId = String(t?.attributeId ?? t?.attribute?.id ?? "").trim();
          const value = String(t?.value ?? "").trim();
          if (!attributeId || !value) return null;

          const attributeName = t?.attribute?.name ?? t?.attributeName;

          return {
            attributeId,
            value,
            attribute: attributeName ? { id: attributeId, name: String(attributeName) } : undefined,
            attributeName: attributeName ? String(attributeName) : undefined,
          };
        })
        .filter(Boolean) as any[],
    };
  }

  const attrsArr: any[] =
    (Array.isArray(p?.attributes) && p.attributes) ||
    (Array.isArray(p?.attributeOptions) && p.attributeOptions) ||
    (Array.isArray(p?.ProductAttributeOption) && p.ProductAttributeOption) ||
    [];
  const textsArr: any[] =
    (Array.isArray(p?.attributeTexts) && p.attributeTexts) ||
    (Array.isArray(p?.ProductAttributeText) && p.ProductAttributeText) ||
    [];

  const options = attrsArr
    .map((row: any) => {
      const attributeId = String(row?.attributeId ?? row?.attribute?.id ?? "").trim();
      const valueId = String(row?.valueId ?? row?.value?.id ?? "").trim();
      if (!attributeId || !valueId) return null;

      const attributeName = row?.attribute?.name ?? row?.attributeName;
      const valueName = row?.value?.name ?? row?.valueName;

      return {
        attributeId,
        valueId,
        attribute: attributeName ? { id: attributeId, name: String(attributeName) } : undefined,
        value: valueName ? { id: valueId, name: String(valueName) } : undefined,
        attributeName: attributeName ? String(attributeName) : undefined,
        valueName: valueName ? String(valueName) : undefined,
      };
    })
    .filter(Boolean) as any[];

  const texts = textsArr
    .map((t: any) => {
      const attributeId = String(t?.attributeId ?? t?.attribute?.id ?? "").trim();
      const value = String(t?.value ?? "").trim();
      if (!attributeId || !value) return null;

      const attributeName = t?.attribute?.name ?? t?.attributeName;

      return {
        attributeId,
        value,
        attribute: attributeName ? { id: attributeId, name: String(attributeName) } : undefined,
        attributeName: attributeName ? String(attributeName) : undefined,
      };
    })
    .filter(Boolean) as any[];

  if (!options.length && !texts.length) return null;
  return { options, texts };
}

function normalizeBaseDefaultsFromAttributes(p: any): Record<string, string> {
  const out: Record<string, string> = {};

  const explicitSources = [
    Array.isArray(p?.baseAttributeSelections) ? p.baseAttributeSelections : null,
    Array.isArray(p?.defaultAttributes) ? p.defaultAttributes : null,
    Array.isArray(p?.productAttributeSelections) ? p.productAttributeSelections : null,
    Array.isArray(p?.attributeSelections) ? p.attributeSelections : null,
  ].filter(Boolean) as any[][];

  for (const rows of explicitSources) {
    for (const row of rows) {
      const a = String(row?.attributeId ?? row?.attribute?.id ?? "").trim();
      const v = String(row?.valueId ?? row?.value?.id ?? "").trim();
      if (a && v) out[a] = v;
    }
  }

  // Fallback to product-level attribute options when no explicit base/default source exists.
  if (!Object.keys(out).length) {
    const fallbackRows: any[] =
      (p?.attributes &&
        !Array.isArray(p.attributes) &&
        Array.isArray(p.attributes.options) &&
        p.attributes.options) ||
      (Array.isArray(p?.attributeOptions) && p.attributeOptions) ||
      (Array.isArray(p?.ProductAttributeOption) && p.ProductAttributeOption) ||
      [];

    for (const row of fallbackRows) {
      const a = String(row?.attributeId ?? row?.attribute?.id ?? "").trim();
      const v = String(row?.valueId ?? row?.value?.id ?? "").trim();
      if (a && v) out[a] = v;
    }
  }

  return out;
}

const buildLabelMaps = (axes: Array<{ id: string; name: string; values: Array<{ id: string; name: string }> }>) => {
  const attrNameById = new Map<string, string>();
  const valueNameByAttrId = new Map<string, Map<string, string>>();
  for (const a of axes) {
    attrNameById.set(a.id, a.name);
    const map = new Map<string, string>();
    for (const v of a.values) map.set(v.id, v.name);
    valueNameByAttrId.set(a.id, map);
  }
  return { attrNameById, valueNameByAttrId };
};

function shallowEqualSelected(a: Record<string, string>, b: Record<string, string>, keys: string[]) {
  for (const k of keys) {
    if (String(a?.[k] ?? "") !== String(b?.[k] ?? "")) return false;
  }
  return true;
}

function pickBestOffer(params: {
  offers: OfferWire[];
  kind: "BASE" | "VARIANT" | "ANY";
  variantId?: string | null;
  sellableVariantIds?: Set<string>;
}): BestOfferPick | null {
  const { offers, kind, variantId, sellableVariantIds } = params;

  let best: BestOfferPick | null = null;

  const leadScore = (n: number | null | undefined) => {
    const v = n == null ? Number.POSITIVE_INFINITY : Number(n);
    return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
  };

  const betterThan = (a: BestOfferPick, b: BestOfferPick) => {
    if (a.unitPrice !== b.unitPrice) return a.unitPrice < b.unitPrice;
    const la = leadScore(a.leadDays);
    const lb = leadScore(b.leadDays);
    if (la !== lb) return la < lb;
    if (a.availableQty !== b.availableQty) return a.availableQty > b.availableQty;
    return a.offerId < b.offerId;
  };

  for (const o of offers || []) {
    if (!o) continue;
    if (!o.isActive || !o.inStock) continue;

    const qty = Number(o.availableQty ?? 0) || 0;
    if (qty <= 0) continue;

    const price = o.unitPrice != null && Number.isFinite(Number(o.unitPrice)) ? Number(o.unitPrice) : null;
    if (price == null || price <= 0) continue;

    const isVariant = o.model === "VARIANT" || !!o.variantId;
    const isBase = !isVariant;

    if (kind === "BASE" && !isBase) continue;
    if (kind === "VARIANT" && !isVariant) continue;

    if (kind === "VARIANT") {
      if (!variantId) continue;
      if (String(o.variantId ?? "") !== String(variantId)) continue;
      if (sellableVariantIds && !sellableVariantIds.has(String(variantId))) continue;
    }

    if (kind === "ANY" && isVariant) {
      if (sellableVariantIds && o.variantId && !sellableVariantIds.has(String(o.variantId))) continue;
    }

    const candidate: BestOfferPick = {
      offerId: String(o.id),
      supplierId: String(o.supplierId ?? "PRODUCT_SUPPLIER"),
      supplierName: o.supplierName ?? null,
      model: isVariant ? "VARIANT" : "BASE",
      variantId: o.variantId ? String(o.variantId) : null,
      unitPrice: Number(price),
      leadDays: o.leadDays ?? null,
      availableQty: qty,
    };

    if (best == null || betterThan(candidate, best)) best = candidate;
  }

  return best;
}

async function setServerCartLine(input: {
  productId: string;
  variantId?: string | null;
  kind: "BASE" | "VARIANT";
  qty: number;
  selectedOptions: Array<{ attributeId: string; valueId: string }>;
  optionsKey: string;
  titleSnapshot?: string | null;
  imageSnapshot?: string | null;
  unitPriceCache?: number | null;
}) {
  const { data } = await api.get("/api/cart", AXIOS_COOKIE_CFG);
  const items: any[] = Array.isArray((data as any)?.items) ? (data as any).items : [];

  const found = items.find((x) => {
    return (
      String(x.productId) === String(input.productId) &&
      String(x.variantId ?? null) === String(input.variantId ?? null) &&
      String(x.kind ?? "").toUpperCase() === String(input.kind).toUpperCase() &&
      String(x.optionsKey ?? "") === String(input.optionsKey ?? "")
    );
  });

  if (!found?.id) {
    await api.post(
      "/api/cart/items",
      {
        productId: input.productId,
        variantId: input.variantId ?? null,
        kind: input.kind,
        qty: input.qty,
        selectedOptions: input.selectedOptions,
        optionsKey: input.optionsKey,
        titleSnapshot: input.titleSnapshot ?? null,
        imageSnapshot: input.imageSnapshot ?? null,
        unitPriceCache: input.unitPriceCache ?? null,
      },
      AXIOS_COOKIE_CFG
    );
    return;
  }

  await api.patch(
    `/api/cart/items/${found.id}`,
    {
      qty: Math.max(1, Number(found.qty || 0) + Number(input.qty || 0)),
      selectedOptions: input.selectedOptions,
      optionsKey: input.optionsKey,
      titleSnapshot: input.titleSnapshot ?? null,
      imageSnapshot: input.imageSnapshot ?? null,
      unitPriceCache: input.unitPriceCache ?? null,
    },
    AXIOS_COOKIE_CFG
  );
}

/* ---------------- Component ---------------- */
export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const editCartLine = (location.state as any)?.editCartLine as {
    variantId: string | null;
    kind: "BASE" | "VARIANT";
    selectedOptions: any[];
    needsOptions?: boolean;
    qty?: number;
    id?: string;
    sourceIds?: string[];
  } | undefined;

  const goBack = React.useCallback(() => {
    const state = (location.state as any) || {};
    if (state.from) navigate(state.from);
    else navigate(-1);
  }, [navigate, location.state]);

  const queryClient = useQueryClient();
  const { openModal } = useModal();
  const user = useAuthStore((s) => s.user);

  const cardCls =
    "rounded-2xl border border-zinc-200/80 bg-white shadow-[0_1px_0_rgba(255,255,255,0.85),0_10px_30px_rgba(15,23,42,0.06)]";
  const silverBorder = "border border-zinc-200/80";
  const silverShadowSm = "shadow-[0_1px_0_rgba(255,255,255,0.8),0_8px_22px_rgba(15,23,42,0.06)]";

  const SITE_ORIGIN =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://dayspringhouse.com";

  const absUrl = React.useCallback(
    (maybeUrl: string) => {
      const s = String(maybeUrl || "").trim();
      if (!s) return "";
      if (/^https?:\/\//i.test(s)) return s;
      if (s.startsWith("/")) return `${SITE_ORIGIN}${s}`;
      return `${SITE_ORIGIN}/${s}`;
    },
    [SITE_ORIGIN]
  );

  const [isZooming, setIsZooming] = React.useState(false);
  const [zoomPos, setZoomPos] = React.useState({ x: 0.5, y: 0.5 });

  const handleZoomMove = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;
    const x = (xPx / rect.width) * 100;
    const y = (yPx / rect.height) * 100;

    setZoomPos({
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
    });
  }, []);

  const handleTouchZoomMove = React.useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    if (!t) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = t.clientX - rect.left;
    const yPx = t.clientY - rect.top;
    const x = (xPx / rect.width) * 100;
    const y = (yPx / rect.height) * 100;

    setZoomPos({
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
    });
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
    staleTime: 60_000,
    retry: 0,
    queryFn: async () => {
      const { data } = await api.get("/api/settings/public");
      const s = (data as any)?.data ?? data ?? {};
      return {
        baseServiceFeeNGN: Number(s?.baseServiceFeeNGN ?? 0) || 0,
        commsUnitCostNGN: Number(s?.commsUnitCostNGN ?? 0) || 0,
        gatewayFeePercent: Number(s?.gatewayFeePercent ?? 1.5) || 1.5,
        gatewayFixedFeeNGN: Number(s?.gatewayFixedFeeNGN ?? 100) || 100,
        gatewayFeeCapNGN: Number(s?.gatewayFeeCapNGN ?? 2000) || 2000,
      };
    },
  });

  const baseServiceFeeNGN = Number(settingsQ.data?.baseServiceFeeNGN ?? 0) || 0;
  const commsUnitCostNGN = Number(settingsQ.data?.commsUnitCostNGN ?? 0) || 0;
  const gatewayFeePercent = Number(settingsQ.data?.gatewayFeePercent ?? 1.5) || 1.5;
  const gatewayFixedFeeNGN = Number(settingsQ.data?.gatewayFixedFeeNGN ?? 100) || 100;
  const gatewayFeeCapNGN = Number(settingsQ.data?.gatewayFeeCapNGN ?? 2000) || 2000;

  /* ---------------- Product ---------------- */
  const productQ = useQuery<ProductQueryData>({
    queryKey: ["product", id],
    enabled: !!id,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data } = await api.get(`/api/products/${id}`, {
        params: { include: "brand,supplier,variants,attributes,offers" },
      });

      const payload = (data as any)?.data ?? data ?? {};
      const p = (payload as any)?.data ?? payload;

      const variants = normalizeVariants(p);
      const offers = offersFromSchema(p);

      const baseOffers = offers.filter((o) => o.model === "BASE" && !o.variantId);
      const baseStockQty = baseOffers
        .filter((o) => o.isActive && o.inStock && (o.availableQty ?? 0) > 0)
        .reduce((acc, o) => acc + (o.availableQty ?? 0), 0);

      const stockByVariantId: Record<string, number> = {};

      for (const v of variants) {
        const vid = String(v.id);
        const variantOffers = offers.filter(
          (o) =>
            o.model === "VARIANT" &&
            String(o.variantId ?? "") === vid &&
            o.isActive &&
            o.inStock &&
            (o.availableQty ?? 0) > 0
        );

        if (variantOffers.length) {
          stockByVariantId[vid] = variantOffers.reduce((acc, o) => acc + (o.availableQty ?? 0), 0);
        }
      }

      const variantStockQty = Object.values(stockByVariantId).reduce((acc, n) => acc + (n ?? 0), 0);
      const totalStockQty = baseStockQty + variantStockQty;
      const sellableVariantIds = new Set(Object.keys(stockByVariantId));
      const baseDefaultsFromAttributes = normalizeBaseDefaultsFromAttributes(p);

      const readProductRetail = (x: any) => {
        const raw = x?.retailPrice ?? x?.price ?? null;
        return raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
      };

      const rawBestSupplierRating = (p as any).bestSupplierRating ?? null;

      const product: ProductWire = {
        id: String(p.id),
        title: String(p.title ?? ""),
        description: p.description ?? "",
        retailPrice: readProductRetail(p),
        inStock: p.inStock !== false,
        imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
        brand: p.brand ? { id: String(p.brand.id), name: String(p.brand.name) } : null,
        supplier: p.supplier
          ? { id: String(p.supplier.id), name: p.supplier.name ? String(p.supplier.name) : null }
          : null,
        variants,
        offers,
        attributes: normalizeAttributesIntoProductWire(p),
        ratingAvg:
          typeof (p as any).ratingAvg === "number"
            ? Number((p as any).ratingAvg)
            : typeof rawBestSupplierRating?.ratingAvg === "number"
              ? Number(rawBestSupplierRating.ratingAvg)
              : null,
        ratingCount:
          typeof (p as any).ratingCount === "number"
            ? Number((p as any).ratingCount)
            : typeof rawBestSupplierRating?.ratingCount === "number"
              ? Number(rawBestSupplierRating.ratingCount)
              : null,
        bestSupplierRating:
          rawBestSupplierRating && typeof rawBestSupplierRating === "object"
            ? {
              ratingAvg:
                typeof rawBestSupplierRating.ratingAvg === "number" ? Number(rawBestSupplierRating.ratingAvg) : null,
              ratingCount:
                typeof rawBestSupplierRating.ratingCount === "number"
                  ? Number(rawBestSupplierRating.ratingCount)
                  : null,
            }
            : null,
      };

      const cheapestBaseOffer = pickBestOffer({ offers, kind: "BASE" });
      const cheapestOverallOffer = pickBestOffer({ offers, kind: "ANY", sellableVariantIds });

      return {
        product,
        stockByVariantId,
        baseStockQty,
        variantStockQty,
        totalStockQty,
        hasBaseOffer: baseStockQty > 0,
        sellableVariantIds,
        baseDefaultsFromAttributes,
        cheapestBaseOffer,
        cheapestOverallOffer,
      };
    },
  });

  const product = productQ.data?.product;

  /* ---------------- Similar products ---------------- */
  const similarQ = useQuery<SimilarProductWire[]>({
    queryKey: ["product-similar", id],
    enabled: !!id,
    staleTime: 120_000,
    queryFn: async () => {
      const { data } = await api.get(`/api/products/${id}/similar`);
      const arr = (data as any)?.data ?? data ?? [];
      const list: any[] = Array.isArray(arr) ? arr : [];
      return list.map((x) => ({
        id: String(x?.id ?? ""),
        title: String(x?.title ?? ""),
        retailPrice:
          x?.retailPrice != null && Number.isFinite(Number(x.retailPrice))
            ? Number(x.retailPrice)
            : x?.price != null && Number.isFinite(Number(x.price))
              ? Number(x.price)
              : null,
        imagesJson: Array.isArray(x?.imagesJson) ? x.imagesJson : [],
        inStock: x?.inStock !== false,
      })) as SimilarProductWire[];
    },
  });

  /* ---------------- Reviews ---------------- */
  const [ratingInput, setRatingInput] = React.useState<number>(0);
  const [commentInput, setCommentInput] = React.useState<string>("");
  const [isAdding, setIsAdding] = React.useState(false);

  const reviewSummaryQ = useQuery<{ ratingAvg: number | null; ratingCount: number | null }>({
    queryKey: ["product-reviews-summary", id],
    enabled: !!id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get(`/api/products/${id}/reviews/summary`);
      const payload = (data as any)?.data ?? data ?? {};
      return {
        ratingAvg:
          payload.ratingAvg != null && Number.isFinite(Number(payload.ratingAvg)) ? Number(payload.ratingAvg) : null,
        ratingCount:
          payload.ratingCount != null && Number.isFinite(Number(payload.ratingCount))
            ? Number(payload.ratingCount)
            : null,
      };
    },
  });

  const toastTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const myReviewQ = useQuery<{ rating: number; comment: string } | null>({
    queryKey: ["product-my-review", id],
    enabled: !!id && !!user?.id,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await api.get(`/api/products/${id}/reviews/my`, AXIOS_COOKIE_CFG);
      const payload = (data as any)?.data ?? data ?? null;
      if (!payload) return null;
      return {
        rating: payload.rating != null && Number.isFinite(Number(payload.rating)) ? Number(payload.rating) : 0,
        comment: payload.comment != null ? String(payload.comment) : "",
      };
    },
  });

  React.useEffect(() => {
    if (!myReviewQ.data) {
      setRatingInput(0);
      setCommentInput("");
      return;
    }
    setRatingInput(myReviewQ.data.rating ?? 0);
    setCommentInput(myReviewQ.data.comment ?? "");
  }, [myReviewQ.data]);

  const saveReviewMutation = useMutation({
    mutationFn: async ({ rating, comment }: { rating: number; comment: string }) => {
      const body = {
        rating: Math.max(1, Math.min(5, Math.round(Number(rating) || 0))),
        comment: String(comment ?? "").trim(),
      };

      const { data } = await api.post(`/api/products/${id}/reviews`, body, AXIOS_COOKIE_CFG);
      return (data as any)?.data ?? data ?? {};
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-my-review", id] });
      queryClient.invalidateQueries({ queryKey: ["product-reviews-summary", id] });
      queryClient.invalidateQueries({ queryKey: ["product", id] });
    },
    onError: (err: any) => {
      console.error("save review failed", err?.response?.status, err?.response?.data || err);
    },
  });

  const deleteReviewMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/api/products/${id}/reviews/my`, AXIOS_COOKIE_CFG);
    },
    onSuccess: () => {
      setRatingInput(0);
      setCommentInput("");
      queryClient.invalidateQueries({ queryKey: ["product-my-review", id] });
      queryClient.invalidateQueries({ queryKey: ["product-reviews-summary", id] });
      queryClient.invalidateQueries({ queryKey: ["product", id] });
    },
  });

  const ratingSummary = React.useMemo(() => {
    const avgFromSummary = reviewSummaryQ.data?.ratingAvg ?? null;
    const countFromSummary = reviewSummaryQ.data?.ratingCount ?? null;

    const avgFromProduct =
      typeof product?.ratingAvg === "number"
        ? product.ratingAvg
        : typeof product?.bestSupplierRating?.ratingAvg === "number"
          ? product.bestSupplierRating.ratingAvg
          : null;

    const countFromProduct =
      typeof product?.ratingCount === "number"
        ? product.ratingCount
        : typeof product?.bestSupplierRating?.ratingCount === "number"
          ? product.bestSupplierRating.ratingCount
          : null;

    const avgRaw = avgFromSummary ?? avgFromProduct ?? null;
    const countRaw = countFromSummary ?? countFromProduct ?? null;

    const avg = avgRaw != null && Number.isFinite(Number(avgRaw)) ? Math.round(Number(avgRaw) * 10) / 10 : null;
    const count = countRaw != null && Number.isFinite(Number(countRaw)) ? Number(countRaw) : null;

    return { avg, count };
  }, [
    reviewSummaryQ.data?.ratingAvg,
    reviewSummaryQ.data?.ratingCount,
    product?.ratingAvg,
    product?.ratingCount,
    product?.bestSupplierRating?.ratingAvg,
    product?.bestSupplierRating?.ratingCount,
  ]);

  function mapContainsSelection(candidateMap: Record<string, string>, probe: Record<string, string>) {
    for (const [aid, vid] of Object.entries(probe || {})) {
      const a = String(aid ?? "").trim();
      const v = String(vid ?? "").trim();
      if (!a || !v) continue;
      if (String(candidateMap?.[a] ?? "") !== v) return false;
    }
    return true;
  }

  const reviewBlockedMessage = React.useMemo(() => {
    const err: any = saveReviewMutation.error;
    const status = Number(err?.response?.status ?? 0);
    if (status !== 403) return "";
    return (
      err?.response?.data?.error ||
      "You’ll be able to review this product after you buy it and your order is delivered."
    );
  }, [saveReviewMutation.error]);

  /* ---------------- Variants / Axes ---------------- */
  const allVariants = product?.variants ?? [];
  const stockByVariantId = productQ.data?.stockByVariantId ?? {};
  const totalStockQty = productQ.data?.totalStockQty ?? 0;
  const baseStockQty = productQ.data?.baseStockQty ?? 0;
  const variantStockQty = productQ.data?.variantStockQty ?? 0;
  const hasBaseOffer = productQ.data?.hasBaseOffer ?? false;
  const sellableVariantIds = productQ.data?.sellableVariantIds ?? new Set<string>();
  const baseDefaultsFromAttributes = productQ.data?.baseDefaultsFromAttributes ?? {};
  const cheapestOverallOffer = productQ.data?.cheapestOverallOffer ?? null;

  const canBuyBase = hasBaseOffer && baseStockQty > 0;

  const axes = React.useMemo(() => {
    if (!product) return [];

    const names = new Map<string, string>();
    const valuesByAttr = new Map<string, Map<string, string>>();

    const add = (aId: string, aName: string, vId: string, vName: string) => {
      if (!aId || !vId) return;
      if (!names.has(aId)) names.set(aId, aName || "Attribute");
      if (!valuesByAttr.has(aId)) valuesByAttr.set(aId, new Map());
      const m = valuesByAttr.get(aId)!;
      if (!m.has(vId)) m.set(vId, vName || "Value");
    };

    for (const v of product.variants || []) {
      for (const o of v.options || []) {
        const aId = String(o.attributeId ?? o.attribute?.id ?? "").trim();
        const vId = String(o.valueId ?? o.value?.id ?? "").trim();
        const aName = String(o.attribute?.name ?? "Attribute");
        const vName = String(o.value?.name ?? "Value");
        add(aId, aName, vId, vName);
      }
    }

    const baseOpts = Array.isArray(product?.attributes?.options) ? product.attributes!.options! : [];
    for (const row of baseOpts) {
      const aId = String(row?.attributeId ?? row?.attribute?.id ?? "").trim();
      const vId = String(row?.valueId ?? row?.value?.id ?? "").trim();
      const aName = String(row?.attribute?.name ?? row?.attributeName ?? "Attribute");
      const vName = String(row?.value?.name ?? row?.valueName ?? "Value");
      add(aId, aName, vId, vName);
    }

    const out: { id: string; name: string; values: { id: string; name: string }[] }[] = [];
    for (const [attrId, vmap] of valuesByAttr.entries()) {
      out.push({
        id: attrId,
        name: names.get(attrId) || "Attribute",
        values: Array.from(vmap.entries()).map(([id, name]) => ({ id, name })),
      });
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [product]);

  const baseDefaults = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const ax of axes) out[ax.id] = "";
    for (const ax of axes) {
      const v = baseDefaultsFromAttributes?.[ax.id];
      if (v) out[ax.id] = String(v);
    }
    return out;
  }, [axes, baseDefaultsFromAttributes]);

  const hasExplicitBaseDefaults = React.useMemo(() => {
    return Object.keys(baseDefaults).length > 0 && Object.values(baseDefaults).some((v) => !!String(v ?? "").trim());
  }, [baseDefaults]);

  const visibleAxes = React.useMemo(() => {
    if (!axes.length) return [];

    if (canBuyBase && variantStockQty <= 0) {
      if (!hasExplicitBaseDefaults) return [];

      return axes
        .map((axis) => {
          const onlyValueId = String(baseDefaults?.[axis.id] ?? "").trim();
          if (!onlyValueId) return null;

          const onlyValue = axis.values.find((v) => String(v.id) === onlyValueId);
          if (!onlyValue) return null;

          return {
            ...axis,
            values: [onlyValue],
          };
        })
        .filter(Boolean) as typeof axes;
    }

    return axes;
  }, [axes, canBuyBase, variantStockQty, hasExplicitBaseDefaults, baseDefaults]);

  const computeBaseSelection = React.useCallback(() => {
    if (!visibleAxes.length) return {};

    if (hasExplicitBaseDefaults) {
      const out: Record<string, string> = {};
      for (const ax of visibleAxes) {
        const v = String(baseDefaults?.[ax.id] ?? "").trim();
        if (v) out[ax.id] = v;
      }
      return out;
    }

    return {};
  }, [visibleAxes, hasExplicitBaseDefaults, baseDefaults]);

  const axisIds = React.useMemo(() => visibleAxes.map((a) => a.id), [visibleAxes]);

  const isAtBaseDefaults = React.useCallback(
    (sel: Record<string, string>) => {
      if (!axisIds.length) return true;

      const allEmptyBase = axisIds.every((aid) => !String(baseDefaults?.[aid] ?? "").trim());
      if (allEmptyBase) return axisIds.every((aid) => !String(sel?.[aid] ?? "").trim());

      return shallowEqualSelected(sel, baseDefaults, axisIds);
    },
    [axisIds, baseDefaults]
  );

  const sellableVariantOptionMaps = React.useMemo(() => {
    const out: Array<{
      variantId: string;
      map: Record<string, string>;
      variantOnlyMap: Record<string, string>;
    }> = [];

    for (const v of allVariants) {
      const vid = String(v.id);
      if (!sellableVariantIds.has(vid)) continue;

      const variantOnlyMap: Record<string, string> = {};
      for (const o of v.options || []) {
        const a = String(o.attributeId ?? "").trim();
        const val = String(o.valueId ?? "").trim();
        if (a && val) variantOnlyMap[a] = val;
      }

      out.push({
        variantId: vid,
        map: buildEffectiveVariantSelectionMap({
          variant: v,
          baseDefaults,
        }),
        variantOnlyMap,
      });
    }

    return out;
  }, [allVariants, sellableVariantIds, baseDefaults]);

  const [selected, setSelected] = React.useState<Record<string, string>>({});
  const [qty, setQty] = React.useState<number>(
    editCartLine?.qty && editCartLine.qty > 1 ? editCartLine.qty : 1
  );

  const computeInitialSelection = React.useCallback(() => {
    if (!visibleAxes.length) return {};

    // When arriving from cart "Choose options / different option", skip base defaults
    // and immediately land on the first fully purchasable variant so no out-of-stock
    // option is pre-selected.
    if (editCartLine && sellableVariantOptionMaps.length > 0) {
      return sellableVariantOptionMaps[0].map;
    }

    if (hasExplicitBaseDefaults) {
      const out: Record<string, string> = {};
      for (const ax of visibleAxes) {
        const v = String(baseDefaults?.[ax.id] ?? "").trim();
        if (v) out[ax.id] = v;
      }
      return out;
    }

    if (hasBaseOffer) return {};

    if (cheapestOverallOffer?.model === "VARIANT" && cheapestOverallOffer.variantId) {
      const v = allVariants.find((x) => x.id === cheapestOverallOffer.variantId);
      if (v) {
        return buildEffectiveVariantSelectionMap({
          variant: v,
          baseDefaults,
        });
      }
    }

    return {};
  }, [editCartLine, sellableVariantOptionMaps, visibleAxes, hasExplicitBaseDefaults, hasBaseOffer, baseDefaults, cheapestOverallOffer, allVariants]);

  React.useEffect(() => {
    if (!product || !visibleAxes.length) {
      setSelected({});
      if (!editCartLine) setQty(1);
      return;
    }

    const initial = computeInitialSelection();
    setSelected(initial);
    // Preserve cart qty when the user arrived from "Choose options"
    if (!editCartLine) setQty(1);
  }, [product?.id, visibleAxes.length, computeInitialSelection, product]);

  const buyableBaseSelectionMap = React.useMemo(() => {
    if (!canBuyBase) return null;
    if (!hasExplicitBaseDefaults) return null;
    return normalizeSelectionMap(baseDefaults);
  }, [canBuyBase, hasExplicitBaseDefaults, baseDefaults]);

  const hasCompatibleSelectionPath = React.useCallback(
    (candidateMap: Record<string, string>, nextSelected: Record<string, string>) => {
      for (const [aid, vid] of Object.entries(nextSelected || {})) {
        const a = String(aid ?? "").trim();
        const v = String(vid ?? "").trim();
        if (!a || !v) continue;
        if (String(candidateMap?.[a] ?? "") !== v) return false;
      }
      return true;
    },
    []
  );



  const removeAxisFromSelection = React.useCallback(
    (sel: Record<string, string>, axisId: string) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(sel || {})) {
        const kk = String(k ?? "").trim();
        const vv = String(v ?? "").trim();
        if (!kk || !vv) continue;
        if (kk === String(axisId ?? "").trim()) continue;
        out[kk] = vv;
      }
      return out;
    },
    []
  );

  const selectionHasAnyCompatibleBuyablePath = React.useCallback(
    (sel: Record<string, string>) => {
      const normalized = normalizeSelectionMap(sel);

      if (buyableBaseSelectionMap && mapContainsSelection(buyableBaseSelectionMap, normalized)) {
        return true;
      }

      for (const row of sellableVariantOptionMaps) {
        if (mapContainsSelection(row.map, normalized)) {
          return true;
        }
      }

      return false;
    },
    [buyableBaseSelectionMap, sellableVariantOptionMaps]
  );


  const optionHasCompatibleBuyablePath = React.useCallback(
    (axisId: string, valueId: string, currentSelected: Record<string, string>) => {
      const a = String(axisId ?? "").trim();
      const v = String(valueId ?? "").trim();
      if (!a || !v) return false;

      const normalizedSelected = normalizeSelectionMap(currentSelected);
      const isActive = String(normalizedSelected?.[a] ?? "") === v;

      // For the currently selected value on an axis, reflect whether the CURRENT
      // overall selection still has any compatible buyable path.
      if (isActive) {
        return selectionHasAnyCompatibleBuyablePath(normalizedSelected);
      }

      // For non-selected options, be more permissive:
      // show green if this option participates in ANY buyable base/variant path,
      // even if the user's current other selections are conflicting right now.
      const probe = { [a]: v };

      if (buyableBaseSelectionMap && mapContainsSelection(buyableBaseSelectionMap, probe)) {
        return true;
      }

      for (const row of sellableVariantOptionMaps) {
        if (mapContainsSelection(row.map, probe)) {
          return true;
        }
      }

      return false;
    },
    [buyableBaseSelectionMap, sellableVariantOptionMaps, selectionHasAnyCompatibleBuyablePath]
  );

  const variantIdByKey = React.useMemo(() => {
    const m = new Map<string, string>();

    for (const v of allVariants) {
      const variantOnlyMap: Record<string, string> = {};
      for (const o of v.options || []) {
        const a = String(o.attributeId ?? "").trim();
        const val = String(o.valueId ?? "").trim();
        if (a && val) variantOnlyMap[a] = val;
      }

      const key = selectionKeyFromSelected(variantOnlyMap);
      if (!key) continue;

      m.set(key, v.id);
    }

    return m;
  }, [allVariants]);

  const matchedVariantId = React.useMemo(() => {
    const normalizedSelected = normalizeSelectionMap(selected);

    // If the current full selection is exactly base defaults, do not force a variant match.
    if (
      axisIds.length > 0 &&
      axisIds.every((aid) => !!String(normalizedSelected?.[aid] ?? "").trim()) &&
      isAtBaseDefaults(normalizedSelected)
    ) {
      return null;
    }

    const variantOnlySelected: Record<string, string> = {};
    for (const v of allVariants) {
      for (const o of v.options || []) {
        const a = String(o.attributeId ?? "").trim();
        if (!a) continue;
        const picked = String(normalizedSelected?.[a] ?? "").trim();
        if (picked) variantOnlySelected[a] = picked;
      }
    }

    const key = selectionKeyFromSelected(variantOnlySelected);
    if (!key) return null;
    return variantIdByKey.get(key) ?? null;
  }, [selected, variantIdByKey, axisIds, isAtBaseDefaults, allVariants]);


  const matchedVariant = React.useMemo(() => {
    if (!matchedVariantId) return null;
    return allVariants.find((v) => v.id === matchedVariantId) ?? null;
  }, [matchedVariantId, allVariants]);

  const exactSellable = React.useMemo(() => {
    if (!matchedVariantId) return false;
    return (stockByVariantId[matchedVariantId] ?? 0) > 0;
  }, [matchedVariantId, stockByVariantId]);

  const computed = React.useMemo(() => {
    const offers = product?.offers ?? [];
    const retailFallbackProduct = toNum(product?.retailPrice, 0);

    const hasFullSelection =
      axes.length > 0 &&
      axisIds.length > 0 &&
      axisIds.every((aid) => !!String(selected?.[aid] ?? "").trim());

    const baseBest = pickBestOffer({ offers, kind: "BASE" });
    const bestAny = pickBestOffer({ offers, kind: "ANY", sellableVariantIds });

    // IMPORTANT:
    // If the user's full selection is exactly the base/default combo,
    // treat it as BASE first, not VARIANT.
    if (hasFullSelection && isAtBaseDefaults(selected)) {
      if (baseBest) {
        const retailFromSupplier = computeRetailPriceFromSupplierPrice({
          supplierPrice: Number(baseBest.unitPrice ?? 0),
          baseServiceFeeNGN,
          commsUnitCostNGN,
          gatewayFeePercent,
          gatewayFixedFeeNGN,
          gatewayFeeCapNGN,
        });

        return {
          mode: "BASE" as const,
          supplierPrice: baseBest.unitPrice ?? null,
          supplierId: baseBest.supplierId ?? product?.supplier?.id ?? null,
          supplierName: baseBest.supplierName ?? product?.supplier?.name ?? null,
          offerId: baseBest.offerId ?? null,
          final: retailFromSupplier > 0 ? retailFromSupplier : retailFallbackProduct,
          matchedVariant: null as VariantWire | null,
          exactMatch: false,
          exactSellable: canBuyBase,
          source: "BASE_OFFER",
        };
      }

      const retailFromSupplier =
        bestAny?.unitPrice != null
          ? computeRetailPriceFromSupplierPrice({
            supplierPrice: bestAny.unitPrice,
            baseServiceFeeNGN,
            commsUnitCostNGN,
            gatewayFeePercent,
            gatewayFixedFeeNGN,
            gatewayFeeCapNGN,
          })
          : null;

      return {
        mode: "BASE" as const,
        supplierPrice: bestAny?.unitPrice ?? null,
        supplierId: bestAny?.supplierId ?? product?.supplier?.id ?? null,
        supplierName: bestAny?.supplierName ?? product?.supplier?.name ?? null,
        offerId: bestAny?.offerId ?? null,
        final:
          retailFromSupplier != null && retailFromSupplier > 0
            ? retailFromSupplier
            : retailFallbackProduct,
        matchedVariant: null as VariantWire | null,
        exactMatch: false,
        exactSellable: canBuyBase,
        source: bestAny != null ? "CHEAPEST_OFFER" : "PRODUCT_RETAIL",
      };
    }

    if (matchedVariant && hasFullSelection) {
      const bestVariant = pickBestOffer({
        offers,
        kind: "VARIANT",
        variantId: matchedVariant.id,
        sellableVariantIds,
      });

      const supplierVariantPrice =
        bestVariant?.unitPrice != null && Number(bestVariant.unitPrice) > 0
          ? Number(bestVariant.unitPrice)
          : null;

      if (supplierVariantPrice != null) {
        const retailFromSupplier = computeRetailPriceFromSupplierPrice({
          supplierPrice: supplierVariantPrice,
          baseServiceFeeNGN,
          commsUnitCostNGN,
          gatewayFeePercent,
          gatewayFixedFeeNGN,
          gatewayFeeCapNGN,
        });

        return {
          mode: "VARIANT" as const,
          supplierPrice: supplierVariantPrice,
          supplierId: bestVariant?.supplierId ?? null,
          supplierName: bestVariant?.supplierName ?? null,
          offerId: bestVariant?.offerId ?? null,
          final: retailFromSupplier > 0 ? retailFromSupplier : retailFallbackProduct,
          matchedVariant,
          exactMatch: true,
          exactSellable,
          source: "VARIANT_OFFER",
        };
      }

      if (baseBest) {
        const retailFromSupplier = computeRetailPriceFromSupplierPrice({
          supplierPrice: Number(baseBest.unitPrice ?? 0),
          baseServiceFeeNGN,
          commsUnitCostNGN,
          gatewayFeePercent,
          gatewayFixedFeeNGN,
          gatewayFeeCapNGN,
        });

        return {
          mode: "BASE" as const,
          supplierPrice: baseBest.unitPrice ?? null,
          supplierId: baseBest.supplierId ?? product?.supplier?.id ?? null,
          supplierName: baseBest.supplierName ?? product?.supplier?.name ?? null,
          offerId: baseBest.offerId ?? null,
          final: retailFromSupplier > 0 ? retailFromSupplier : retailFallbackProduct,
          matchedVariant: null as VariantWire | null,
          exactMatch: false,
          exactSellable: false,
          source: "BASE_OFFER",
        };
      }

      const retailFromSupplier =
        bestAny?.unitPrice != null
          ? computeRetailPriceFromSupplierPrice({
            supplierPrice: bestAny.unitPrice,
            baseServiceFeeNGN,
            commsUnitCostNGN,
            gatewayFeePercent,
            gatewayFixedFeeNGN,
            gatewayFeeCapNGN,
          })
          : null;

      return {
        mode: "VARIANT" as const,
        supplierPrice: bestAny?.unitPrice ?? null,
        supplierId: bestAny?.supplierId ?? null,
        supplierName: bestAny?.supplierName ?? null,
        offerId: bestAny?.offerId ?? null,
        final:
          retailFromSupplier != null && retailFromSupplier > 0
            ? retailFromSupplier
            : retailFallbackProduct,
        matchedVariant: null as VariantWire | null,
        exactMatch: !!matchedVariant,
        exactSellable,
        source: bestAny != null ? "CHEAPEST_OFFER" : "PRODUCT_RETAIL",
      };
    }

    if (axes.length > 0 && isAtBaseDefaults(selected)) {
      if (!hasExplicitBaseDefaults) {
        if (baseBest) {
          const retailFromSupplier = computeRetailPriceFromSupplierPrice({
            supplierPrice: Number(baseBest.unitPrice ?? 0),
            baseServiceFeeNGN,
            commsUnitCostNGN,
            gatewayFeePercent,
            gatewayFixedFeeNGN,
            gatewayFeeCapNGN,
          });

          return {
            mode: "BASE" as const,
            supplierPrice: baseBest.unitPrice ?? null,
            supplierId: baseBest.supplierId ?? product?.supplier?.id ?? null,
            supplierName: baseBest.supplierName ?? product?.supplier?.name ?? null,
            offerId: baseBest.offerId ?? null,
            final: retailFromSupplier > 0 ? retailFromSupplier : retailFallbackProduct,
            matchedVariant: null as VariantWire | null,
            exactMatch: false,
            exactSellable: false,
            source: "BASE_OFFER",
          };
        }

        if (bestAny) {
          const retailFromSupplier = computeRetailPriceFromSupplierPrice({
            supplierPrice: Number(bestAny.unitPrice),
            baseServiceFeeNGN,
            commsUnitCostNGN,
            gatewayFeePercent,
            gatewayFixedFeeNGN,
            gatewayFeeCapNGN,
          });

          return {
            mode: "VARIANT" as const,
            supplierPrice: bestAny.unitPrice,
            supplierId: bestAny.supplierId ?? null,
            supplierName: bestAny.supplierName ?? null,
            offerId: bestAny.offerId ?? null,
            final: retailFromSupplier,
            matchedVariant: null as VariantWire | null,
            exactMatch: false,
            exactSellable: false,
            source: "CHEAPEST_OFFER",
          };
        }

        return {
          mode: "BASE" as const,
          supplierPrice: null,
          supplierId: product?.supplier?.id ?? null,
          supplierName: product?.supplier?.name ?? null,
          offerId: null,
          final: retailFallbackProduct,
          matchedVariant: null as VariantWire | null,
          exactMatch: false,
          exactSellable: false,
          source: "PRODUCT_RETAIL",
        };
      }

      if (baseBest) {
        const retailFromSupplier = computeRetailPriceFromSupplierPrice({
          supplierPrice: Number(baseBest.unitPrice ?? 0),
          baseServiceFeeNGN,
          commsUnitCostNGN,
          gatewayFeePercent,
          gatewayFixedFeeNGN,
          gatewayFeeCapNGN,
        });

        return {
          mode: "BASE" as const,
          supplierPrice: baseBest.unitPrice ?? null,
          final: retailFromSupplier > 0 ? retailFromSupplier : retailFallbackProduct,
          supplierId: baseBest.supplierId ?? product?.supplier?.id ?? null,
          supplierName: baseBest.supplierName ?? product?.supplier?.name ?? null,
          offerId: baseBest.offerId ?? null,
          matchedVariant: null as VariantWire | null,
          exactMatch: false,
          exactSellable: false,
          source: "BASE_OFFER",
        };
      }

      if (bestAny) {
        const retailFromSupplier = computeRetailPriceFromSupplierPrice({
          supplierPrice: Number(bestAny.unitPrice),
          baseServiceFeeNGN,
          commsUnitCostNGN,
          gatewayFeePercent,
          gatewayFixedFeeNGN,
          gatewayFeeCapNGN,
        });

        return {
          mode: "VARIANT" as const,
          supplierPrice: bestAny.unitPrice,
          supplierId: bestAny.supplierId ?? null,
          supplierName: bestAny.supplierName ?? null,
          offerId: bestAny.offerId ?? null,
          final: retailFromSupplier,
          exactMatch: false,
          exactSellable: false,
          matchedVariant: null as VariantWire | null,
          source: "CHEAPEST_OFFER",
        };
      }

      return {
        mode: "BASE" as const,
        supplierPrice: null,
        final: retailFallbackProduct,
        supplierId: product?.supplier?.id ?? null,
        supplierName: product?.supplier?.name ?? null,
        offerId: null,
        matchedVariant: null as VariantWire | null,
        exactMatch: false,
        exactSellable: false,
        source: "PRODUCT_RETAIL",
      };
    }

    const retailFromSupplier =
      bestAny?.unitPrice != null
        ? computeRetailPriceFromSupplierPrice({
          supplierPrice: bestAny.unitPrice,
          baseServiceFeeNGN,
          commsUnitCostNGN,
          gatewayFeePercent,
          gatewayFixedFeeNGN,
          gatewayFeeCapNGN,
        })
        : null;

    return {
      mode: "VARIANT" as const,
      supplierPrice: bestAny?.unitPrice ?? null,
      supplierId: bestAny?.supplierId ?? null,
      supplierName: bestAny?.supplierName ?? null,
      offerId: bestAny?.offerId ?? null,
      final:
        retailFromSupplier != null && retailFromSupplier > 0
          ? retailFromSupplier
          : retailFallbackProduct,
      matchedVariant: null as VariantWire | null,
      exactMatch: !!matchedVariant,
      exactSellable,
      source: bestAny != null ? "CHEAPEST_OFFER" : "PRODUCT_RETAIL",
    };
  }, [
    product?.offers,
    product?.retailPrice,
    product?.supplier?.id,
    product?.supplier?.name,
    axes.length,
    axisIds,
    selected,
    isAtBaseDefaults,
    matchedVariant,
    exactSellable,
    sellableVariantIds,
    hasExplicitBaseDefaults,
    canBuyBase,
    baseServiceFeeNGN,
    commsUnitCostNGN,
    gatewayFeePercent,
    gatewayFixedFeeNGN,
    gatewayFeeCapNGN,
  ]);

  const selectedCount = React.useMemo(() => {
    return axisIds.filter((aid) => !!String(selected?.[aid] ?? "").trim()).length;
  }, [axisIds, selected]);

  const hasAnySelection = React.useMemo(() => {
    return axisIds.some((aid) => !!String(selected?.[aid] ?? "").trim());
  }, [axisIds, selected]);

  const currentSelectionHasCompatiblePath = React.useMemo(() => {
    if (!hasAnySelection) return true;
    return selectionHasAnyCompatibleBuyablePath(selected);
  }, [hasAnySelection, selected, selectionHasAnyCompatibleBuyablePath]);

  const allAxesSelected = axes.length > 0 && selectedCount === axisIds.length;

  const shouldWarnInvalidCombo =
    !!axes.length &&
    hasAnySelection &&
    allAxesSelected &&
    !isAtBaseDefaults(selected) &&
    !currentSelectionHasCompatiblePath;


  /* ---------------- Images ---------------- */
  const images = React.useMemo(() => {
    const variantImgs = matchedVariant?.imagesJson?.map((u) => resolveImageUrl(u)).filter(Boolean as any) ?? [];
    const baseImgs =
      (Array.isArray(product?.imagesJson) ? product.imagesJson : [])
        .map((u) => resolveImageUrl(u))
        .filter(Boolean as any) ?? [];

    const merged = [...variantImgs, ...baseImgs].filter(Boolean) as string[];
    return Array.from(new Set(merged));
  }, [product?.imagesJson, matchedVariant?.imagesJson]);


  const shouldShowOptions = React.useMemo(() => {
    return visibleAxes.length > 0;
  }, [visibleAxes]);

  const purchaseMeta = React.useMemo(() => {
    const hasVariantAxes = axes.length > 0;
    const hasAnySelection = axisIds.some((aid) => !!String(selected?.[aid] ?? "").trim());
    const hasFullSelection =
      hasVariantAxes &&
      axisIds.length > 0 &&
      axisIds.every((aid) => !!String(selected?.[aid] ?? "").trim());

    if (!hasVariantAxes) {
      if (canBuyBase) {
        return {
          disableAddToCart: false,
          helperNote: null,
          mode: "BASE" as const,
          variantId: null as string | null,
        };
      }

      return {
        disableAddToCart: true,
        helperNote: "Out of stock.",
        mode: "BASE" as const,
        variantId: null as string | null,
      };
    }

    // IMPORTANT:
    // A full selection equal to the base/default combo should remain BASE.
    if (hasFullSelection && isAtBaseDefaults(selected)) {
      if (canBuyBase) {
        return {
          disableAddToCart: false,
          helperNote: shouldShowOptions ? "Base product selected." : null,
          mode: "BASE" as const,
          variantId: null as string | null,
        };
      }

      if (variantStockQty > 0) {
        return {
          disableAddToCart: true,
          helperNote:
            "Base offer is not available. Please select an available variant combination.",
          mode: "BASE" as const,
          variantId: null as string | null,
        };
      }

      return {
        disableAddToCart: true,
        helperNote: "Out of stock.",
        mode: "BASE" as const,
        variantId: null as string | null,
      };
    }

    if (matchedVariantId && hasFullSelection) {
      const stock = stockByVariantId[matchedVariantId] ?? 0;

      if (stock > 0) {
        return {
          disableAddToCart: false,
          helperNote: null,
          mode: "VARIANT" as const,
          variantId: matchedVariantId,
        };
      }

      return {
        disableAddToCart: true,
        helperNote:
          "This variant combination is not available. Please choose another available option set.",
        mode: "VARIANT" as const,
        variantId: matchedVariantId,
      };
    }

    if (!hasAnySelection) {
      if (canBuyBase && !shouldShowOptions) {
        return {
          disableAddToCart: false,
          helperNote: null,
          mode: "BASE" as const,
          variantId: null as string | null,
        };
      }

      if (canBuyBase && shouldShowOptions) {
        return {
          disableAddToCart: false,
          helperNote: "This product also has selectable variant options.",
          mode: "BASE" as const,
          variantId: null as string | null,
        };
      }

      if (variantStockQty > 0) {
        return {
          disableAddToCart: true,
          helperNote: "Please select options to choose an available variant.",
          mode: "BASE" as const,
          variantId: null as string | null,
        };
      }

      return {
        disableAddToCart: true,
        helperNote: "Out of stock.",
        mode: "BASE" as const,
        variantId: null as string | null,
      };
    }

    if (isAtBaseDefaults(selected)) {
      if (canBuyBase && !shouldShowOptions) {
        return {
          disableAddToCart: false,
          helperNote: null,
          mode: "BASE" as const,
          variantId: null as string | null,
        };
      }

      if (canBuyBase && shouldShowOptions) {
        return {
          disableAddToCart: false,
          helperNote: "Base product selected.",
          mode: "BASE" as const,
          variantId: null as string | null,
        };
      }

      if (variantStockQty > 0) {
        return {
          disableAddToCart: true,
          helperNote:
            "Base offer is not available. Please select an available variant combination.",
          mode: "BASE" as const,
          variantId: null as string | null,
        };
      }

      return {
        disableAddToCart: true,
        helperNote: "Out of stock.",
        mode: "BASE" as const,
        variantId: null as string | null,
      };
    }

    if (hasFullSelection && !matchedVariantId) {
      return {
        disableAddToCart: true,
        helperNote: "This combination is not available. Try a different set of options.",
        mode: "VARIANT" as const,
        variantId: null as string | null,
      };
    }

    if (!currentSelectionHasCompatiblePath) {
      return {
        disableAddToCart: true,
        helperNote: "This combination is not available. Try a different set of options.",
        mode: "VARIANT" as const,
        variantId: null as string | null,
      };
    }

    return {
      disableAddToCart: true,
      helperNote: allAxesSelected ? null : null,
      mode: "VARIANT" as const,
      variantId: null as string | null,
    };
  }, [
    axes.length,
    axisIds,
    canBuyBase,
    selected,
    isAtBaseDefaults,
    variantStockQty,
    matchedVariantId,
    stockByVariantId,
    shouldShowOptions,
    currentSelectionHasCompatiblePath,
    allAxesSelected,
  ]);


  const [mainIndex, setMainIndex] = React.useState(0);
  const [brokenByIndex, setBrokenByIndex] = React.useState<Record<number, boolean>>({});

  React.useEffect(() => {
    setMainIndex(0);
    setBrokenByIndex({});
    setIsZooming(false);
    setZoomPos({ x: 50, y: 50 });
  }, [product?.id, matchedVariant?.id]);

  function NoImageBox({ className = "" }: { className?: string }) {
    return (
      <div className={`w-full h-full flex items-center justify-center text-center ${className}`} aria-label="No image">
        <div className="px-6 py-8">
          <div className="text-sm font-medium text-zinc-700">No image</div>
          <div className="mt-1 text-xs text-zinc-500">This product has no photos yet.</div>
        </div>
      </div>
    );
  }

  const currentSelectionQty = React.useMemo(() => {
    if (isAtBaseDefaults(selected) || purchaseMeta.mode === "BASE") return baseStockQty;
    const vid = purchaseMeta.variantId;
    if (!vid) return 0;
    return stockByVariantId[vid] ?? 0;
  }, [isAtBaseDefaults, selected, purchaseMeta.mode, purchaseMeta.variantId, baseStockQty, stockByVariantId]);

  const productAvailabilityMode = React.useMemo(() => {
    const hasBase = baseStockQty > 0;
    const hasVariant = variantStockQty > 0;
    if (hasBase && hasVariant) return "BASE_AND_VARIANT";
    if (hasVariant) return "VARIANT_ONLY";
    if (hasBase) return "BASE_ONLY";
    return "NONE";
  }, [baseStockQty, variantStockQty]);

  const availabilityBadge = React.useMemo(() => {
    const qtyNow = currentSelectionQty;

    if (!purchaseMeta.disableAddToCart && qtyNow > 0) {
      return {
        text: `In stock • ${qtyNow}`,
        cls: "bg-purple-600 text-white border-purple-700 shadow-md",
      };
    }

    if (productAvailabilityMode === "NONE") {
      return { text: "Out of stock", cls: "bg-rose-600/10 text-rose-700 border-rose-600/20" };
    }

    if (isAtBaseDefaults(selected) && productAvailabilityMode === "VARIANT_ONLY") {
      return { text: "Variant only", cls: "bg-indigo-600/10 text-indigo-700 border-indigo-600/20" };
    }

    if (!isAtBaseDefaults(selected) && productAvailabilityMode === "BASE_ONLY") {
      return { text: "Base only", cls: "bg-indigo-600/10 text-indigo-700 border-indigo-600/20" };
    }

    return { text: "Select options", cls: "bg-amber-600/10 text-amber-700 border-amber-600/20" };
  }, [currentSelectionQty, purchaseMeta.disableAddToCart, productAvailabilityMode, selected, isAtBaseDefaults]);

  /* ---------------- Add to cart ---------------- */
  const handleAddToCart = React.useCallback(async () => {
    if (isAdding) return;
    if (!product) return;

    setIsAdding(true);
    try {
      if (purchaseMeta.disableAddToCart) {
        const msg =
          purchaseMeta.helperNote ||
          "Please select an available option (variant or base) before adding this item to your cart.";

        try {
          openModal({ title: "Select options", message: msg });
        } catch {
          alert(msg);
        }
        return;
      }

      const variantId = purchaseMeta.mode === "VARIANT" ? purchaseMeta.variantId : null;

      const selectedOptionsWire = Object.entries(selected)
        .filter(([, v]) => !!String(v || "").trim())
        .map(([attributeId, valueId]) => ({
          attributeId: String(attributeId),
          valueId: String(valueId),
        }));

      const optionsKey =
        variantId && selectedOptionsWire.length
          ? selectedOptionsWire
            .map((x) => `${x.attributeId}:${x.valueId}`)
            .sort()
            .join("|")
          : "";

      const unitPriceClient = toNum(computed.final, 0);

      const matchedVariantRow = variantId
        ? (product.variants || []).find((v) => String(v.id) === String(variantId))
        : null;

      const variantImgRaw = matchedVariantRow?.imagesJson?.[0] ?? null;
      const productImgRaw = (product.imagesJson || [])[0] ?? null;

      const primaryImg = resolveImageUrl(variantImgRaw) || resolveImageUrl(productImgRaw) || null;

      const { attrNameById, valueNameByAttrId } = buildLabelMaps(axes);

      // Enrich maps from raw variant option data as fallback
      for (const v of product.variants ?? []) {
        for (const o of v.options ?? []) {
          const aId = String(o.attributeId ?? "").trim();
          const vId = String(o.valueId ?? "").trim();
          const aName = o.attribute?.name;
          const vName = o.value?.name;
          if (aId && aName && !attrNameById.has(aId)) attrNameById.set(aId, aName);
          if (aId && vId && vName) {
            if (!valueNameByAttrId.has(aId)) valueNameByAttrId.set(aId, new Map());
            if (!valueNameByAttrId.get(aId)!.has(vId)) valueNameByAttrId.get(aId)!.set(vId, vName);
          }
        }
      }

      const selectedOptionsLabeled = selectedOptionsWire.map(({ attributeId, valueId }) => ({
        attributeId,
        attribute: attrNameById.get(attributeId) ?? attributeId,
        valueId,
        value: valueNameByAttrId.get(attributeId)?.get(valueId) ?? valueId,
      }));

      const isLoggedIn = !!useAuthStore.getState().user?.id;
      const existingLines = (readCartLines() as any[]) || [];
      const lineKind: "BASE" | "VARIANT" = variantId ? "VARIANT" : "BASE";

      const existingForCombo = existingLines.find((ln) => {
        return (
          String(ln.productId) === String(product.id) &&
          String(ln.variantId ?? null) === String(variantId ?? null) &&
          String(ln.optionsKey ?? "") === String(optionsKey) &&
          String(ln.kind ?? lineKind).toUpperCase() === String(lineKind).toUpperCase()
        );
      });

      const addQty = Math.max(1, Number(qty) || 1);

      if (isLoggedIn) {
        await setServerCartLine({
          productId: String(product.id),
          variantId: variantId ?? null,
          kind: lineKind,
          qty: addQty,
          selectedOptions: selectedOptionsWire,
          optionsKey,
          titleSnapshot: product.title ?? "",
          imageSnapshot: primaryImg ?? null,
          unitPriceCache: unitPriceClient,
        });
      }

      await new Promise<void>((r) => setTimeout(r, 0));

      upsertCartLine({
        productId: String(product.id),
        variantId: variantId ?? null,
        kind: lineKind,
        optionsKey,
        qty: editCartLine ? addQty : (existingForCombo?.qty ?? 0) + addQty,
        selectedOptions: selectedOptionsLabeled,
        titleSnapshot: product.title ?? null,
        imageSnapshot: primaryImg ?? null,
        unitPriceCache: Number.isFinite(unitPriceClient) ? unitPriceClient : 0,
      });

      const pid = String(product.id);
      const linesAfterAdd = readCartLines();
      let cleanedLines = linesAfterAdd;

      const oldServerIds = editCartLine
        ? [
          ...new Set(
            [
              ...(editCartLine.sourceIds ?? []),
              ...(editCartLine.id ? [editCartLine.id] : []),
            ]
              .map(String)
              .filter(Boolean)
          ),
        ]
        : [];

      if (editCartLine?.needsOptions) {
        // Path A — user was editing a needsOptions BASE placeholder.
        // Local: remove the placeholder line.
        cleanedLines = cleanedLines.filter(
          (l) => !(l.productId === pid && l.kind === "BASE" && l.needsOptions === true)
        );
        // Server: delete the placeholder row by its id.
        if (isLoggedIn && oldServerIds.length) {
          await Promise.all(
            oldServerIds.map((sid) =>
              api.delete(`/api/cart/items/${sid}`, AXIOS_COOKIE_CFG).catch(() => { })
            )
          );
        }
      } else if (editCartLine) {
        // Path B — user is replacing an existing configured VARIANT line.
        // Only act if they actually picked something different.
        const oldVid = editCartLine.variantId;
        const oldKind = editCartLine.kind;
        const isReplacing =
          String(oldVid ?? null) !== String(variantId ?? null) || oldKind !== lineKind;

        if (isReplacing) {
          // Local: remove the specific old line identified by variantId + kind.
          cleanedLines = cleanedLines.filter(
            (l) =>
              !(
                l.productId === pid &&
                String(l.variantId ?? null) === String(oldVid ?? null) &&
                l.kind === oldKind
              )
          );
          // Server: delete the specific old row by its id.
          if (isLoggedIn && oldServerIds.length) {
            await Promise.all(
              oldServerIds.map((sid) =>
                api.delete(`/api/cart/items/${sid}`, AXIOS_COOKIE_CFG).catch(() => { })
              )
            );
          }
        }
      } else {
        // Path C — normal add (no edit context). Remove any stale needsOptions placeholder.
        cleanedLines = cleanedLines.filter(
          (l) => !(l.productId === pid && l.kind === "BASE" && l.needsOptions === true)
        );
      }

      if (cleanedLines.length !== linesAfterAdd.length) {
        writeCartLines(cleanedLines);
      }

      window.dispatchEvent(new Event("cart:updated"));

      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => {
        const linesAfter = readCartLines();
        showMiniCartToast(
          toMiniCartRows(linesAfter),
          { productId: product.id, variantId: variantId ?? null },
          { title: "Added to cart", duration: 3500, maxItems: 4, mode: "add" }
        );
      }, 0);
    } catch (err: any) {
      console.error(err);
      const msg = err?.response?.data?.message || err?.message || "Could not update cart.";
      try {
        openModal({ title: "Cart", message: msg });
      } catch {
        alert(msg);
      }
    } finally {
      setIsAdding(false);
    }
  }, [isAdding, product, purchaseMeta, selected, computed.final, axes, openModal, qty]);

  /* ---------------- Review handlers ---------------- */
  const handleSubmitReview = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!user) {
        navigate("/login");
        return;
      }
      if (!product) return;

      if (!ratingInput || ratingInput < 1 || ratingInput > 5) {
        const msg = "Please select a rating from 1 to 5 stars.";
        try {
          openModal({ title: "Rating required", message: msg });
        } catch {
          alert(msg);
        }
        return;
      }

      await saveReviewMutation.mutateAsync({ rating: ratingInput, comment: commentInput });
    },
    [user, product, ratingInput, commentInput, saveReviewMutation, navigate, openModal]
  );

  const handleResetReview = React.useCallback(async () => {
    if (!user || !id) return;

    try {
      await deleteReviewMutation.mutateAsync();
    } catch (err) {
      const msg = (err as any)?.response?.data?.message || "Could not reset your review. Please try again later.";
      try {
        openModal({ title: "Reset review failed", message: msg });
      } catch {
        alert(msg);
      }
    }
  }, [deleteReviewMutation, openModal, user, id]);

  /* ---------------- SEO ---------------- */
  const seo = React.useMemo(() => {
    const fallbackTitle = "DaySpring House — Shop";

    if (!product?.id) {
      return {
        title: fallbackTitle,
        description: "Shop on DaySpring House.",
        canonical: `${SITE_ORIGIN}/`,
        ogImage: "",
        jsonLd: null as any,
        ogType: "website" as const,
      };
    }

    const canonical = `${SITE_ORIGIN}/products/${product.id}`;
    const title = `${product.title} | DaySpring House`;

    const desc =
      (product.description ? String(product.description) : "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 155) || `Buy ${product.title} on DaySpring House.`;

    const ogSrcRaw =
      matchedVariant?.imagesJson?.[0] ||
      (Array.isArray(product.imagesJson) && product.imagesJson.length > 0 ? product.imagesJson[0] : "") ||
      "";
    const ogSrc = resolveImageUrl(ogSrcRaw) || "";
    const img = ogSrc ? absUrl(ogSrc) : "";

    const price = Number.isFinite(Number(computed?.final)) && Number(computed.final) > 0 ? Number(computed.final) : null;

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.title,
      description: desc,
      url: canonical,
      ...(img ? { image: [img] } : {}),
      ...(product.brand?.name ? { brand: { "@type": "Brand", name: product.brand.name } } : {}),
      ...(price != null
        ? {
          offers: {
            "@type": "Offer",
            priceCurrency: "NGN",
            price: String(price),
            availability: (totalStockQty ?? 0) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            url: canonical,
          },
        }
        : {}),
    };

    return { title, description: desc, canonical, ogImage: img, jsonLd, ogType: "product" as const };
  }, [
    product?.id,
    product?.title,
    product?.description,
    product?.brand?.name,
    product?.imagesJson,
    matchedVariant?.imagesJson,
    SITE_ORIGIN,
    absUrl,
    computed?.final,
    totalStockQty,
  ]);

  React.useEffect(() => {
    const shouldReset = !axes.length || isAtBaseDefaults(selected) || !!matchedVariantId;
    if (!shouldReset) return;
    setQty((prev) => (prev === 1 ? prev : 1));
  }, [selected, matchedVariantId, axes.length, isAtBaseDefaults]);

  React.useEffect(() => {
    const dispose = setSeo({
      title: seo.title,
      description: seo.description,
      canonical: seo.canonical,
      og: [
        { property: "og:title", content: seo.title },
        { property: "og:description", content: seo.description },
        { property: "og:url", content: seo.canonical },
        { property: "og:type", content: seo.ogType },
        ...(seo.ogImage ? [{ property: "og:image", content: seo.ogImage }] : []),
        { property: "twitter:card", content: "summary_large_image" },
        { property: "twitter:title", content: seo.title },
        { property: "twitter:description", content: seo.description },
        ...(seo.ogImage ? [{ property: "twitter:image", content: seo.ogImage }] : []),
      ],
      jsonLd: seo.jsonLd ? { id: product?.id ? `product-${product.id}` : "page", data: seo.jsonLd } : undefined,
    });

    return dispose;
  }, [seo.title, seo.description, seo.canonical, seo.ogImage, seo.jsonLd, product?.id]);

  /* ---------------- UI small helpers ---------------- */
  const CHIP_THRESHOLD = 8;

  function VariantAxisPicker({
    axis,
    value,
    selectedMap,
    onChange,
  }: {
    axis: { id: string; name: string; values: { id: string; name: string }[] };
    value: string;
    selectedMap: Record<string, string>;
    onChange: (next: string) => void;
  }) {
    const useChips = axis.values.length <= CHIP_THRESHOLD;

    const getOptionState = (optId: string) => {
      const active = value === optId;
      const hasAnyPath = optionHasCompatibleBuyablePath(axis.id, optId, selectedMap);

      return {
        active,
        hasAnyPath,
      };
    };

    if (useChips) {
      return (
        <div className="flex flex-wrap gap-2">
          {axis.values.map((opt) => {
            const { active, hasAnyPath } = getOptionState(opt.id);

            const baseCls =
              "px-2.5 py-1.5 rounded-xl text-sm md:text-base transition flex items-center gap-2 border bg-white";

            const idleAvailableCls = "border-zinc-200 text-zinc-900 hover:bg-zinc-50";
            const idleUnavailableCls = "border-zinc-200 bg-zinc-50 text-zinc-400 hover:bg-zinc-100";
            const selectedOkCls = "border-fuchsia-500 ring-2 ring-fuchsia-500 text-zinc-900 bg-white";
            const selectedWarnCls = "border-amber-500 ring-2 ring-amber-400 bg-amber-50 text-amber-900";

            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChange(active ? "" : opt.id)}
                className={[
                  baseCls,
                  active
                    ? hasAnyPath
                      ? selectedOkCls
                      : selectedWarnCls
                    : hasAnyPath
                      ? idleAvailableCls
                      : idleUnavailableCls,
                ].join(" ")}
                title={
                  active
                    ? hasAnyPath
                      ? "Selected"
                      : "Selected option has no real compatible stock path"
                    : hasAnyPath
                      ? "This option has an available compatible path"
                      : "This option has no available compatible path"
                }
              >
                {!active && hasAnyPath && <span className="inline-block size-2 rounded-full bg-emerald-500" />}
                {!active && !hasAnyPath && <span className="inline-block size-2 rounded-full bg-zinc-300" />}
                <span>{opt.name}</span>
              </button>
            );
          })}
        </div>
      );
    }

    return (
      <Select value={value} onValueChange={(v) => onChange(v === "__NONE__" ? "" : v)}>
        <SelectTrigger className={`h-11 rounded-xl text-sm md:text-base ${silverBorder} ${silverShadowSm}`}>
          <SelectValue placeholder={`No ${axis.name.toLowerCase()}`} />
        </SelectTrigger>

        <SelectContent className="text-sm md:text-base">
          <SelectItem value="__NONE__">{`No ${axis.name.toLowerCase()}`}</SelectItem>

          {axis.values.map((opt) => {
            const { active, hasAnyPath } = getOptionState(opt.id);

            const baseCls =
              "w-full text-left px-2.5 py-1.5 rounded-xl text-sm md:text-base transition flex items-center gap-2 border bg-white";

            const idleAvailableCls = "border-zinc-200 text-zinc-900 hover:bg-zinc-50";
            const idleUnavailableCls = "border-zinc-200 bg-zinc-50 text-zinc-400 hover:bg-zinc-100";
            const selectedOkCls = "border-fuchsia-500 ring-2 ring-fuchsia-500 text-zinc-900 bg-white";
            const selectedWarnCls = "border-amber-500 ring-2 ring-amber-400 bg-amber-50 text-amber-900";

            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChange(active ? "" : opt.id)}
                className={[
                  baseCls,
                  active
                    ? hasAnyPath
                      ? selectedOkCls
                      : selectedWarnCls
                    : hasAnyPath
                      ? idleAvailableCls
                      : idleUnavailableCls,
                ].join(" ")}
                title={
                  active
                    ? hasAnyPath
                      ? "Selected"
                      : "Selected option has no real compatible stock path"
                    : hasAnyPath
                      ? "This option has an available compatible path"
                      : "This option has no available compatible path"
                }
              >
                {!active && hasAnyPath && <span className="inline-block size-2 rounded-full bg-emerald-500" />}
                {!active && !hasAnyPath && <span className="inline-block size-2 rounded-full bg-zinc-300" />}
                <span>{opt.name}</span>
              </button>
            );
          })}
        </SelectContent>
      </Select>
    );
  }

  function VariantWarning({
    message,
    innerRef,
    compact = false,
  }: {
    message: string;
    innerRef?: React.RefObject<HTMLDivElement | null>;
    compact?: boolean;
  }) {
    return (
      <div
        ref={innerRef}
        className={`rounded-2xl border border-amber-400 bg-amber-50 text-amber-900 ${silverShadowSm} ${compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"}`}
        role="alert"
        aria-live="polite"
      >
        <div className="flex items-start gap-2">
          <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 text-amber-900 text-xs font-bold">
            !
          </span>
          <div className="leading-snug">
            <div className="font-semibold">Not available</div>
            <div className="opacity-90">{message}</div>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- MUST-BE-BEFORE-RETURN hooks ---------------- */
  const maxQty = React.useMemo(() => {
    if (purchaseMeta.disableAddToCart) return 1;

    if (purchaseMeta.mode === "BASE") {
      const q = Number(baseStockQty ?? 0);
      return Number.isFinite(q) && q > 0 ? q : 1;
    }

    const vid = purchaseMeta.variantId;
    if (!vid) return 1;

    const q = Number(stockByVariantId?.[vid] ?? 0);
    return Number.isFinite(q) && q > 0 ? q : 1;
  }, [purchaseMeta.disableAddToCart, purchaseMeta.mode, purchaseMeta.variantId, baseStockQty, stockByVariantId]);

  const currentSrc = images[mainIndex];
  const mainIsBroken = !!brokenByIndex[mainIndex];
  const showMainImg = !!currentSrc && !mainIsBroken;

  const similarRef = React.useRef<HTMLDivElement | null>(null);
  const similarDragRef = React.useRef({ isDown: false, startX: 0, scrollLeft: 0 });

  const scrollSimilarBy = React.useCallback((dir: -1 | 1) => {
    const el = similarRef.current;
    if (!el) return;
    const step = Math.max(260, Math.floor(el.clientWidth * 0.85));
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  }, []);

  const onSimilarMouseDown = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = similarRef.current;
    if (!el) return;
    similarDragRef.current = { isDown: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft };
    el.style.cursor = "grabbing";
    el.style.userSelect = "none";
  }, []);

  const onSimilarMouseLeaveOrUp = React.useCallback(() => {
    const el = similarRef.current;
    if (!el) return;
    similarDragRef.current.isDown = false;
    el.style.cursor = "grab";
    el.style.userSelect = "";
  }, []);

  const onSimilarMouseMove = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = similarRef.current;
    if (!el || !similarDragRef.current.isDown) return;
    e.preventDefault();
    const x = e.pageX - el.offsetLeft;
    const walk = (x - similarDragRef.current.startX) * 1.2;
    el.scrollLeft = similarDragRef.current.scrollLeft - walk;
  }, []);

  /* ---------------- Render guards ---------------- */
  if (productQ.isLoading) {
    return (
      <SiteLayout>
        <div className="max-w-6xl mx-auto p-6">
          <div className={`${cardCls} p-5`}>Loading product…</div>
        </div>
      </SiteLayout>
    );
  }

  if (productQ.isError || !product) {
    return (
      <SiteLayout>
        <div className="max-w-6xl mx-auto p-6">
          <div className={`${cardCls} p-5 text-rose-600`}>
            Could not load product.
            <div className="text-xs opacity-70 mt-1">{String((productQ.error as any)?.message || "Unknown error")}</div>
          </div>
        </div>
      </SiteLayout>
    );
  }

  const displayPrice = toNum(computed.final, 0);
  const priceLabel = NGN.format(displayPrice > 0 ? displayPrice : 0);

  return (
    <SiteLayout>
      <div className="bg-gradient-to-b from-white-50 to-white -mt-4 md:-mt-6">
        <div>
          <div className="max-w-6xl mx-auto px-2 sm:px-4 md:px-6 pt-0">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={goBack}
                className={`touch-manipulation text-sm px-3 py-2 rounded-full bg-white hover:bg-zinc-50 ${silverBorder} ${silverShadowSm}`}
              >
                ←
              </button>

              <div className="text-xs text-zinc-500">
                {product.brand?.name ? (
                  <span className="truncate max-w-[68vw] inline-block">
                    {product.brand.name} / {product.title}
                  </span>
                ) : (
                  <span className="truncate max-w-[68vw] inline-block">{product.title}</span>
                )}
              </div>
            </div>
          </div>

          <div className="max-w-6xl mx-auto px-2 sm:px-4 md:px-6 py-3 md:py-6 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 max-[360px]:gap-4">
            {/* LEFT */}
            {/* LEFT */}
            <div className="space-y-3 md:space-y-5">
              <div className="w-full max-w-[420px] sm:max-w-[480px] md:max-w-[540px] lg:max-w-[580px] mx-auto">
                <div className="relative w-full">
                  <div
                    className={`relative h-[250px] sm:h-[300px] md:h-[340px] lg:h-[380px] aspect-square w-full rounded-2xl overflow-hidden bg-white ${silverBorder} ${silverShadowSm}`}
                    onMouseEnter={() => showMainImg && setIsZooming(true)}
                    onMouseLeave={() => setIsZooming(false)}
                    onMouseMove={handleZoomMove}
                    onTouchStart={() => showMainImg && setIsZooming(true)}
                    onTouchMove={handleTouchZoomMove}
                    onTouchEnd={() => setIsZooming(false)}
                  >
                    {showMainImg ? (
                      <>
                        <img
                          src={currentSrc}
                          alt={product.title || "Product image"}
                          className="w-full h-full object-cover object-top"
                          loading="eager"
                          onError={() => setBrokenByIndex((prev) => ({ ...prev, [mainIndex]: true }))}
                        />

                        {isZooming && (
                          <div
                            className="pointer-events-none absolute hidden md:block h-20 w-20 rounded-full border border-white/90 bg-white/10 shadow-lg backdrop-blur-[1px]"
                            style={{
                              left: `${zoomPos.x}%`,
                              top: `${zoomPos.y}%`,
                              transform: "translate(-50%, -50%)",
                            }}
                          />
                        )}

                        {isZooming && (
                          <div className="pointer-events-none absolute right-3 bottom-3 hidden md:block">
                            <div className="h-40 w-40 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl">
                              <div
                                className="h-full w-full"
                                style={{
                                  backgroundImage: `url(${currentSrc})`,
                                  backgroundRepeat: "no-repeat",
                                  backgroundSize: "416%",
                                  backgroundPosition: `${zoomPos.x}% ${zoomPos.y}%`,
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <NoImageBox className="bg-zinc-50" />
                    )}
                  </div>

                  <span
                    className={`absolute left-3 top-3 pointer-events-none inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border ${availabilityBadge.cls} ${silverShadowSm}`}
                  >
                    {availabilityBadge.text}
                  </span>

                  {images.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setMainIndex((i) => (i - 1 + images.length) % images.length)}
                        className={`absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/95 hover:bg-white px-3 py-2 ${silverBorder} ${silverShadowSm}`}
                        aria-label="Previous image"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={() => setMainIndex((i) => (i + 1) % images.length)}
                        className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/95 hover:bg-white px-3 py-2 ${silverBorder} ${silverShadowSm}`}
                        aria-label="Next image"
                      >
                        ›
                      </button>
                    </>
                  )}
                </div>

                {images.length > 1 && (
                  <div className="mt-3 grid grid-cols-5 gap-2 sm:gap-2.5">
                    {images.map((src, idx) => {
                      const broken = !!brokenByIndex[idx];
                      if (!src || broken) return null;

                      const active = idx === mainIndex;
                      return (
                        <button
                          key={`${src}-${idx}`}
                          type="button"
                          onClick={() => setMainIndex(idx)}
                          className={`relative overflow-hidden rounded-xl bg-white ${active ? "ring-2 ring-fuchsia-500 border-fuchsia-500" : silverBorder} ${silverShadowSm}`}
                          style={{ aspectRatio: "1 / 1" }}
                          aria-label={`Show image ${idx + 1}`}
                        >
                          <img
                            src={src}
                            alt=""
                            aria-hidden="true"
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={() => setBrokenByIndex((prev) => ({ ...prev, [idx]: true }))}
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className={`hidden md:block ${cardCls} p-4 md:p-5`}>
                <h2 className="text-base font-semibold mb-1">Description</h2>
                <p className="text-sm text-zinc-700 whitespace-pre-line">{product.description || "No description yet."}</p>
              </div>
            </div>

            {/* RIGHT */}
            <div className="space-y-3 md:space-y-5">
              <div className={`${cardCls} p-3 sm:p-4 md:p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-zinc-900">{product.title}</h1>

                    {product.brand?.name ? (
                      <div className="mt-1 text-sm text-zinc-600">
                        Brand: <span className="font-medium">{product.brand.name}</span>
                      </div>
                    ) : null}

                    <div className="mt-2 text-2xl md:text-3xl font-bold text-zinc-900">{priceLabel}</div>

                    <div className="mt-1 text-xs text-zinc-500">
                      {computed.source === "VARIANT_OFFER"
                        ? "Price from variant offer"
                        : computed.source === "BASE_OFFER"
                          ? "Price from base offer"
                          : computed.source === "CHEAPEST_OFFER"
                            ? "Price from cheapest available offer"
                            : "Retail price"}
                    </div>

                    {ratingSummary.avg != null && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-zinc-700">
                        <div className="flex items-center gap-0.5 text-amber-500 text-base">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <span key={i}>{i < Math.round(ratingSummary.avg ?? 0) ? "★" : "☆"}</span>
                          ))}
                        </div>
                        <span className="font-semibold">{ratingSummary.avg.toFixed(1)}</span>
                        {ratingSummary.count != null && (
                          <span className="text-xs text-zinc-500">
                            ({ratingSummary.count} review{ratingSummary.count === 1 ? "" : "s"})
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-zinc-500">
                      {purchaseMeta.mode === "VARIANT" && purchaseMeta.variantId
                        ? "Selected variant stock"
                        : isAtBaseDefaults(selected)
                          ? "Base stock"
                          : "Stock"}
                    </div>

                    <div className="text-sm font-semibold">
                      {purchaseMeta.mode === "VARIANT" && purchaseMeta.variantId
                        ? Math.max(0, currentSelectionQty)
                        : isAtBaseDefaults(selected)
                          ? Math.max(0, baseStockQty)
                          : selectedCount > 0
                            ? "—"
                            : Math.max(0, baseStockQty)}
                    </div>

                    {!isAtBaseDefaults(selected) &&
                      !(purchaseMeta.mode === "VARIANT" && purchaseMeta.variantId) &&
                      selectedCount > 0 && (
                        <div className="mt-1 text-[11px] text-zinc-500">Select all options to see exact stock</div>
                      )}
                  </div>
                </div>

                {purchaseMeta.helperNote ? (
                  <div className="mt-3 text-sm">
                    <span
                      className={`inline-flex rounded-xl px-3 py-2 border ${purchaseMeta.disableAddToCart
                        ? "border-amber-400 bg-amber-50 text-amber-900"
                        : "border-zinc-200 bg-zinc-50 text-zinc-700"
                        }`}
                    >
                      {purchaseMeta.helperNote}
                    </span>
                  </div>
                ) : null}

                {shouldShowOptions && (
                  <div className="mt-4 space-y-4">
                    {visibleAxes.map((axis) => (
                      <div key={axis.id} className="space-y-2">
                        <div className="text-sm font-semibold text-zinc-800">{axis.name}</div>
                        <VariantAxisPicker
                          axis={axis}
                          value={String(selected?.[axis.id] ?? "")}
                          selectedMap={selected}
                          onChange={(next) => setSelected((prev) => ({ ...prev, [axis.id]: next }))}
                        />
                      </div>
                    ))}

                    <div className="text-xs text-zinc-600">
                      Tip: <span className="font-medium">green dot</span> means the option can still lead to
                      an available combination.                    </div>

                    {shouldWarnInvalidCombo && (
                      <VariantWarning message="This combination is not available. Try a different set of options." />
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelected(computeBaseSelection())}
                        className={`text-sm px-3 py-2 rounded-full bg-white hover:bg-zinc-50 ${silverBorder} ${silverShadowSm}`}
                      >
                        Reset to base
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelected({})}
                        className={`text-sm px-3 py-2 rounded-full bg-white hover:bg-zinc-50 ${silverBorder} ${silverShadowSm}`}
                      >
                        Clear selections
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-4 space-y-2">
                  <span className="block text-sm text-zinc-700">Qty</span>

                  <div className="grid grid-cols-[44px_minmax(0,1fr)_44px_64px] gap-2 sm:flex sm:items-center">
                    <button
                      type="button"
                      onClick={() => setQty((q) => Math.max(1, q - 1))}
                      className={`h-11 sm:h-10 rounded-full bg-white hover:bg-zinc-50 px-3 text-base sm:text-sm ${silverBorder} ${silverShadowSm}`}
                    >
                      −
                    </button>

                    <input
                      type="number"
                      min={1}
                      max={maxQty}
                      value={qty === 0 ? "" : qty}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") {
                          setQty(0);
                          return;
                        }
                        const num = Number(v);
                        if (!Number.isFinite(num)) return;
                        const clamped = Math.min(maxQty, Math.max(1, num));
                        setQty(clamped);
                      }}
                      onBlur={() => {
                        if (!qty || qty < 1) setQty(1);
                      }}
                      className={`h-11 sm:h-10 min-w-0 text-center rounded-xl border px-2 text-sm ${silverBorder}`}
                    />

                    <button
                      type="button"
                      onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                      className={`h-11 sm:h-10 rounded-full bg-white hover:bg-zinc-50 px-3 text-base sm:text-sm ${silverBorder} ${silverShadowSm}`}
                    >
                      +
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (isAdding) return;
                        setQty((prev) => {
                          const next = Math.max(1, maxQty);
                          return prev === next ? prev : next;
                        });
                      }}
                      className={`h-11 sm:h-10 rounded-full bg-white hover:bg-zinc-50 px-3 text-sm font-medium ${silverBorder} ${silverShadowSm} ${purchaseMeta.disableAddToCart || maxQty <= 1 ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      Max
                    </button>
                  </div>
                </div>

                {editCartLine && (
                  <div className="mt-4 flex items-start gap-2 rounded-xl border border-fuchsia-200 bg-fuchsia-50 px-3 py-2.5 text-[12px] text-fuchsia-800">
                    <span>✏️</span>
                    <span>
                      You're editing a cart item. Choose your options below and click{" "}
                      <strong>Add to cart</strong> — your previous selection will be replaced.
                    </span>
                  </div>
                )}

                <div className="mt-5 flex flex-col sm:flex-row items-center gap-3">
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    disabled={purchaseMeta.disableAddToCart || isAdding}
                    className={`w-full sm:w-auto px-4 py-3 rounded-full font-semibold text-white touch-manipulation ${purchaseMeta.disableAddToCart
                      ? "bg-zinc-300 cursor-not-allowed"
                      : "bg-fuchsia-600 hover:bg-fuchsia-700 active:bg-fuchsia-800"
                      }`}
                  >
                    {isAdding ? "Updating cart…" : editCartLine ? "Update cart" : "Add to cart"}
                  </button>

                  <Link
                    to="/cart"
                    className={`w-full sm:w-auto px-4 py-3 rounded-full font-semibold text-center bg-white hover:bg-zinc-50 ${silverBorder} ${silverShadowSm}`}
                  >
                    View cart
                  </Link>
                </div>

                {/* Review form */}
                <div className="mt-6 border-t border-zinc-200 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-sm font-semibold text-zinc-900">Rate this product</h2>

                    <div className="flex flex-col items-end text-right">
                      {ratingSummary.avg != null && (
                        <div className="flex items-center gap-1 text-xs text-zinc-500">
                          <span>{ratingSummary.avg.toFixed(1)}★</span>
                          {ratingSummary.count != null && (
                            <span>
                              ({ratingSummary.count} review{ratingSummary.count === 1 ? "" : "s"})
                            </span>
                          )}
                        </div>
                      )}

                      <Link
                        to={`/products/${product.id}/reviews`}
                        className="mt-1 text-xs sm:text-sm font-medium text-fuchsia-600 hover:underline"
                      >
                        See all reviews →
                      </Link>
                    </div>
                  </div>

                  {!user && (
                    <p className="mt-2 text-xs text-zinc-600">
                      <Link to="/login" className="font-medium text-fuchsia-600 hover:text-fuchsia-700">
                        Sign in
                      </Link>{" "}
                      to write a review.
                    </p>
                  )}

                  {user && (
                    <form className="mt-3 space-y-3" onSubmit={handleSubmitReview}>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((star) => {
                          const active = ratingInput >= star;
                          return (
                            <button
                              key={star}
                              type="button"
                              onClick={() => setRatingInput(star)}
                              className="p-0.5"
                              aria-label={`${star} star${star === 1 ? "" : "s"}`}
                            >
                              <span className={`text-xl ${active ? "text-amber-500" : "text-zinc-300"}`}>
                                {active ? "★" : "☆"}
                              </span>
                            </button>
                          );
                        })}
                        <span className="ml-2 text-xs text-zinc-500">
                          {ratingInput ? `${ratingInput} / 5` : "Tap a star to rate"}
                        </span>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-zinc-700 mb-1">Comment (optional)</label>
                        <textarea
                          rows={3}
                          value={commentInput}
                          onChange={(e) => setCommentInput(e.target.value)}
                          className={`w-full rounded-xl border text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-fuchsia-500 ${silverBorder}`}
                          placeholder="Share your experience with this product…"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={saveReviewMutation.isPending}
                          className={`px-3 py-2 rounded-full text-sm font-semibold text-white ${saveReviewMutation.isPending
                            ? "bg-zinc-400 cursor-not-allowed"
                            : "bg-fuchsia-600 hover:bg-fuchsia-700"
                            }`}
                        >
                          {saveReviewMutation.isPending ? "Saving…" : myReviewQ.data ? "Update review" : "Submit review"}
                        </button>

                        {myReviewQ.data && (
                          <button
                            type="button"
                            onClick={handleResetReview}
                            disabled={deleteReviewMutation.isPending}
                            className={`px-3 py-2 rounded-full text-sm bg-white hover:bg-zinc-50 ${silverBorder} ${silverShadowSm}`}
                          >
                            {deleteReviewMutation.isPending ? "Resetting…" : "Reset review"}
                          </button>
                        )}
                      </div>

                      {saveReviewMutation.isError && !reviewBlockedMessage && (
                        <div className="text-xs text-rose-600">
                          {(saveReviewMutation.error as any)?.message || "Could not save review. Please try again."}
                        </div>
                      )}
                      {deleteReviewMutation.isError && (
                        <div className="text-xs text-rose-600">
                          {(deleteReviewMutation.error as any)?.message || "Could not reset review. Please try again."}
                        </div>
                      )}

                      {reviewBlockedMessage && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          {reviewBlockedMessage}
                        </div>
                      )}
                    </form>
                  )}
                </div>
              </div>

              <div className={`md:hidden ${cardCls} p-3 sm:p-4`}>
                <h2 className="text-base font-semibold mb-1">Description</h2>
                <p className="text-sm text-zinc-700 whitespace-pre-line">{product.description || "No description yet."}</p>
              </div>
            </div>
          </div>

          {/* Similar products */}
          {Array.isArray(similarQ.data) && similarQ.data.length > 0 && (
            <div className="max-w-6xl mx-auto px-2 sm:px-4 md:px-6 pb-5 md:pb-6">
              <div className={`${cardCls} p-3 sm:p-4 md:p-5`}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">Similar products</h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => scrollSimilarBy(-1)}
                      className={`rounded-full px-3 py-2 text-sm bg-white hover:bg-zinc-50 ${silverBorder} ${silverShadowSm}`}
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollSimilarBy(1)}
                      className={`rounded-full px-3 py-2 text-sm bg-white hover:bg-zinc-50 ${silverBorder} ${silverShadowSm}`}
                    >
                      ›
                    </button>
                  </div>
                </div>

                <div
                  ref={similarRef}
                  className="mt-3 flex gap-3 overflow-x-auto scroll-smooth pb-2"
                  style={{ scrollbarWidth: "thin" as any, cursor: "grab" }}
                  onMouseDown={onSimilarMouseDown}
                  onMouseLeave={onSimilarMouseLeaveOrUp}
                  onMouseUp={onSimilarMouseLeaveOrUp}
                  onMouseMove={onSimilarMouseMove}
                >
                  {similarQ.data.map((sp) => {
                    const basePrice =
                      sp.retailPrice != null && Number.isFinite(Number(sp.retailPrice)) ? Number(sp.retailPrice) : null;
                    const showPrice =
                      basePrice != null
                        ? NGN.format(
                          computeRetailPriceFromSupplierPrice({
                            supplierPrice: basePrice,
                            baseServiceFeeNGN,
                            commsUnitCostNGN,
                            gatewayFeePercent,
                            gatewayFixedFeeNGN,
                            gatewayFeeCapNGN,
                          })
                        )
                        : "—";
                    const imgRaw = Array.isArray(sp.imagesJson) && sp.imagesJson.length ? sp.imagesJson[0] : "";
                    const img = resolveImageUrl(imgRaw) || "";

                    return (
                      <Link
                        key={sp.id}
                        to={`/products/${sp.id}`}
                        className={`min-w-[220px] max-w-[220px] rounded-2xl overflow-hidden bg-white ${silverBorder} ${silverShadowSm} hover:opacity-95`}
                      >
                        <div className="bg-zinc-50" style={{ aspectRatio: "4 / 3" }}>
                          {img ? (
                            <img src={img} alt={sp.title} className="w-full h-full object-cover pointer-events-none" loading="lazy" draggable={false} />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs text-zinc-500">No image</div>
                          )}
                        </div>
                        <div className="p-3">
                          <div className="text-sm font-semibold line-clamp-2">{sp.title}</div>
                          <div className="mt-1 text-sm font-bold">{showPrice}</div>
                          <div className="mt-1 text-xs text-zinc-500">{sp.inStock === false ? "Out of stock" : "Available"}</div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </SiteLayout>
  );
}