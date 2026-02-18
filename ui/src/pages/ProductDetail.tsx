// src/pages/ProductDetail.tsx
import * as React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient, useQueries } from "@tanstack/react-query";
import api from "../api/client";
import SiteLayout from "../layouts/SiteLayout";
import { createPortal } from "react-dom";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/Select";

import { showMiniCartToast } from "../components/cart/MiniCartToast";
import { setSeo } from "../seo/head";

/* ---------------- Types ---------------- */
type Brand = { id: string; name: string } | null;

/**
 * ✅ Conform to Prisma:
 * - ProductVariantOption has unitPrice (optional), NOT priceBump
 */
type VariantOptionWire = {
  attributeId: string;
  valueId: string;
  unitPrice?: number | null;
  attribute?: { id: string; name: string; type?: string };
  value?: { id: string; name: string; code?: string | null };
};

/**
 * Offers wire: normalize from any backend shape.
 * We’ll use:
 * - model BASE|VARIANT
 * - variantId nullable
 * - availableQty
 * - price (supplier price) from basePrice/unitPrice/price/etc
 */
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

  /**
   * ✅ ProductVariant.retailPrice (public retail) — may exist, but we do NOT rely on it
   * for live retail if marginPercent is used to compute retail.
   */
  retailPrice?: number | null;

  inStock?: boolean;
  imagesJson?: string[];
  options?: VariantOptionWire[];
};

type ProductWire = {
  id: string;
  title: string;
  description?: string;

  /**
   * ✅ Product.retailPrice (public display base) — may exist, but we do NOT rely on it
   * for live retail if marginPercent is used to compute retail.
   */
  retailPrice: number | null;

  inStock?: boolean;
  imagesJson?: string[];
  brand?: Brand;
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
};

type ValueState = {
  exists: boolean;
  stock: number;
  disabled: boolean;
  reason?: string; // "Not available" | "Out of stock"
};

type SimilarProductWire = {
  id: string;
  title: string;
  retailPrice: number | null; // from endpoint fallback
  imagesJson?: string[];
  inStock?: boolean;
};

function selectionPairsOf(sel: Record<string, string>) {
  return Object.entries(sel)
    .filter(([, v]) => !!String(v || "").trim())
    .map(([aid, vid]) => `${aid}:${vid}`);
}

/* ---------------- Helpers ---------------- */
const NGN = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const toNum = (n: any, d = 0) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const toBool = (v: any, fallback = false) => {
  if (v === true) return true;
  if (v === false) return false;

  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(s)) return true;
    if (["false", "0", "no", "n", "off", ""].includes(s)) return false;
  }
  return fallback;
};

function idOfOption(o: VariantOptionWire) {
  const a = o.attributeId ?? o.attribute?.id ?? "";
  const v = o.valueId ?? o.value?.id ?? "";
  return { a: String(a), v: String(v) };
}

/**
 * ✅ Normalize variants using schema-friendly names:
 * - v.retailPrice (primary)
 * - fallback to v.price if backend still returns it temporarily
 */
function normalizeVariants(p: any): VariantWire[] {
  const src: any[] = Array.isArray(p?.variants) ? p.variants : [];

  const readVariantRetail = (x: any) => {
    const raw = x?.retailPrice ?? null;
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
            ? {
              id: String(o.attribute.id),
              name: String(o.attribute.name),
              type: o.attribute.type,
            }
            : undefined,
          value: o.value
            ? {
              id: String(o.value.id),
              name: String(o.value.name),
              code: o.value.code ?? null,
            }
            : undefined,
        }))
        .filter((o: any) => o.attributeId && o.valueId)
      : [],
  }));
}

function offersFromSchema(p: any): OfferWire[] {
  const base: any[] = Array.isArray(p?.supplierProductOffers) ? p.supplierProductOffers : [];
  const vars: any[] = Array.isArray(p?.supplierVariantOffers) ? p.supplierVariantOffers : [];

  const out: OfferWire[] = [];

  for (const o of base) {
    out.push({
      id: String(o.id),
      supplierId: String(o.supplierId),
      supplierName: o?.supplier?.name ? String(o.supplier.name) : null,
      productId: String(o.productId),
      variantId: null,
      currency: o?.currency ?? "NGN",
      inStock: Boolean(o?.inStock),
      isActive: Boolean(o?.isActive),
      availableQty: Number(o?.availableQty ?? 0) || 0,
      leadDays: o?.leadDays ?? null,
      unitPrice: o?.basePrice != null ? Number(o.basePrice) : null, // ✅ basePrice only
      model: "BASE",
    });
  }

  for (const o of vars) {
    out.push({
      id: String(o.id),
      supplierId: String(o.supplierId),
      supplierName: o?.supplier?.name ? String(o.supplier.name) : null,
      productId: String(o.productId),
      variantId: String(o.variantId),
      currency: o?.currency ?? "NGN",
      inStock: Boolean(o?.inStock),
      isActive: Boolean(o?.isActive),
      availableQty: Number(o?.availableQty ?? 0) || 0,
      leadDays: o?.leadDays ?? null,
      unitPrice: o?.unitPrice != null ? Number(o.unitPrice) : null, // ✅ unitPrice only
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

  const attrsArr: any[] = Array.isArray(p?.attributes) ? p.attributes : [];
  const textsArr: any[] = Array.isArray(p?.attributeTexts) ? p.attributeTexts : [];

  const options = attrsArr
    .map((row: any) => {
      const attributeId = String(row?.attributeId ?? "").trim();
      const valueId = String(row?.valueId ?? "").trim();
      if (!attributeId || !valueId) return null;

      const attributeName = row?.attributeName;
      const valueName = row?.valueName;

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
      const attributeId = String(t?.attributeId ?? "").trim();
      const value = String(t?.value ?? "").trim();
      if (!attributeId || !value) return null;

      const attributeName = t?.attributeName;

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

  const explicit =
    (Array.isArray(p?.attributeSelections) && p.attributeSelections) ||
    (Array.isArray(p?.baseAttributeSelections) && p.baseAttributeSelections) ||
    (Array.isArray(p?.defaultAttributes) && p.defaultAttributes) ||
    (Array.isArray(p?.productAttributeSelections) && p.productAttributeSelections) ||
    null;

  if (explicit) {
    for (const row of explicit) {
      const a = String(row?.attributeId ?? row?.attribute?.id ?? "").trim();
      const v = String(row?.valueId ?? row?.value?.id ?? "").trim();
      if (a && v && !out[a]) out[a] = v;
    }
    if (Object.keys(out).length) return out;
  }

  const opts: any[] = Array.isArray(p?.attributes?.options) ? p.attributes.options : [];
  for (const row of opts) {
    const a = String(row?.attributeId ?? row?.attribute?.id ?? "").trim();
    const v = String(row?.valueId ?? row?.value?.id ?? "").trim();
    if (a && v && !out[a]) out[a] = v;
  }

  return out;
}

/* ---------------- Local cart helpers ---------------- */

type CartRowLS = {
  productId: string;
  variantId?: string | null;
  title?: string;
  qty: number;

  unitPrice?: number;
  totalPrice?: number;

  image?: string | null;

  selectedOptions?: any[];
};

const CART_KEY = "cart";

function readCartLS(): any[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function setCartQty(cart: any[]) {
  // keep localStorage as source of truth (already written), but this guarantees the badge updates NOW
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {
    // ignore
  }

  // ✅ notify same-tab listeners (Navbar / useCartCount)
  window.dispatchEvent(new Event("cart:updated"));
}

function upsertCartLineLS(input: {
  productId: string;
  variantId: string | null;
  title: string;
  unitPrice: number;
  image?: string | null;
  selectedOptions?: any[];
}) {
  const cart = readCartLS();

  const pid = input.productId;
  const vid = input.variantId ?? null;

  const idx = cart.findIndex(
    (x: any) => String(x?.productId ?? "") === pid && (x?.variantId ?? null) === vid
  );

  const safeIdx =
    idx >= 0
      ? idx
      : cart.findIndex(
        (x: any) => String(x?.productId ?? "") === pid && (x?.variantId ?? null) === vid
      );

  if (safeIdx >= 0) {
    const prevQty = Math.max(0, Number(cart[safeIdx]?.qty) || 0);
    const nextQty = Math.max(1, prevQty + 1);

    cart[safeIdx] = {
      ...cart[safeIdx],
      productId: pid,
      variantId: vid,
      title: input.title,
      qty: nextQty,
      unitPrice: input.unitPrice,
      totalPrice: input.unitPrice * nextQty,
      image: input.image ?? cart[safeIdx]?.image ?? null,
      selectedOptions: input.selectedOptions ?? cart[safeIdx]?.selectedOptions ?? [],
    };
  } else {
    cart.push({
      productId: pid,
      variantId: vid,
      title: input.title,
      qty: 1,
      unitPrice: input.unitPrice,
      totalPrice: input.unitPrice,
      image: input.image ?? null,
      selectedOptions: input.selectedOptions ?? [],
    });
  }
  setCartQty(cart);
  return cart as CartRowLS[];
}

/* ---------------- UI helpers ---------------- */

const buildLabelMaps = (
  axes: Array<{
    id: string;
    name: string;
    values: Array<{ id: string; name: string }>;
  }>
) => {
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

function buildEmptySelection(axes: Array<{ id: string }>) {
  const out: Record<string, string> = {};
  for (const ax of axes) out[ax.id] = "";
  return out;
}

function buildSelectionFromVariant(
  axes: Array<{ id: string }>,
  v: VariantWire | null
): Record<string, string> | null {
  if (!axes.length || !v) return null;

  const out: Record<string, string> = {};
  for (const ax of axes) out[ax.id] = "";

  for (const o of v.options || []) {
    const aId = String(o.attributeId ?? "").trim();
    const vId = String(o.valueId ?? "").trim();
    if (!aId || !vId) continue;
    if (!(aId in out)) continue;
    out[aId] = vId;
  }

  const anyPicked = Object.values(out).some((x) => !!String(x || "").trim());
  return anyPicked ? out : null;
}

type ProductAvailabilityMode = "NONE" | "BASE_ONLY" | "VARIANT_ONLY" | "BASE_AND_VARIANT";

/**
 * ✅ Best + Cheapest offer picker
 * Ranking:
 * 1) lowest price
 * 2) lowest leadDays (null treated as large)
 * 3) highest availableQty
 */
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

function pickBestOffer(params: {
  offers: OfferWire[];
  kind: "BASE" | "VARIANT" | "ANY";
  variantId?: string | null;
  sellableVariantIds?: Set<string>;
}) {
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
    return a.offerId < b.offerId; // deterministic tie-break
  };

  for (const o of offers || []) {
    if (!o) continue;
    if (!o.isActive || !o.inStock) continue;

    const qty = Number(o.availableQty ?? 0) || 0;
    if (qty <= 0) continue;

    const price =
      o.unitPrice != null && Number.isFinite(Number(o.unitPrice)) ? Number(o.unitPrice) : null;
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
      if (sellableVariantIds && o.variantId && !sellableVariantIds.has(String(o.variantId))) {
        continue;
      }
    }

    const candidate: BestOfferPick = {
      offerId: String(o.id),
      supplierId: String(o.supplierId),
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

function applyMargin(supplierPrice: number, marginPercent: number) {
  const m = Math.max(0, Number(marginPercent) || 0);
  return round2(supplierPrice * (1 + m / 100));
}

function shortId(id: string) {
  if (!id) return "";
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/* ---------------- Component ---------------- */
export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /* ---------------- Silver-ish UI  ---------------- */
  // A subtle “silver” border + shadow look (same vibe across cards).
  const cardCls =
    "rounded-2xl border border-zinc-200/80 bg-white shadow-[0_1px_0_rgba(255,255,255,0.85),0_10px_30px_rgba(15,23,42,0.06)]";
  const softInsetCls =
    "border border-zinc-200/80 bg-white/70 backdrop-blur shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_10px_28px_rgba(15,23,42,0.05)]";
  const silverBorder = "border border-zinc-200/80";
  const silverShadow =
    "shadow-[0_1px_0_rgba(255,255,255,0.85),0_10px_30px_rgba(15,23,42,0.06)]";
  const silverShadowSm =
    "shadow-[0_1px_0_rgba(255,255,255,0.8),0_8px_22px_rgba(15,23,42,0.06)]";

  /**
   * ✅ Load marginPercent from settings/public
   * Use SAME queryKey + parsing as Catalog to avoid cache collisions (5 vs 10).
   */
  const settingsQ = useQuery<number>({
    queryKey: ["settings", "public", "marginPercent"],
    staleTime: 10_000,
    retry: 0,
    queryFn: async () => {
      const { data } = await api.get("/api/settings/public");
      const s = (data as any) ?? {};

      const v = Number.isFinite(Number(s?.marginPercent))
        ? Number(s.marginPercent)
        : Number.isFinite(Number(s?.pricingMarkupPercent))
          ? Number(s.pricingMarkupPercent)
          : NaN;

      return Math.max(0, Number.isFinite(v) ? v : 0);
    },
  });

  const marginPercent = Number.isFinite(settingsQ.data as any) ? (settingsQ.data as number) : 0;

  const productQ = useQuery({
    queryKey: ["product", id],
    queryFn: async () => {
      const { data } = await api.get(`/api/products/${id}`, {
        params: { include: "brand,variants,attributes,supplierProductOffers,supplierVariantOffers" },
      });

      const payload = (data as any)?.data ?? data ?? {};
      const p = (payload as any)?.data ?? payload;

      const variants = normalizeVariants(p);
      const offers = offersFromSchema(p);

      // ---------------- Stock computation (your existing logic) ----------------
      const baseOffers = offers.filter((o) => o.model === "BASE" && !o.variantId);
      const baseStockQty = baseOffers
        .filter((o) => o.isActive && o.inStock && (o.availableQty ?? 0) > 0)
        .reduce((acc, o) => acc + (o.availableQty ?? 0), 0);

      const baseQtyBySupplier: Record<string, number> = {};
      const stockByVariantId: Record<string, number> = {};

      for (const o of offers) {
        if (o.model !== "BASE") continue;
        if (!o.isActive || !o.inStock) continue;

        const qty = Number(o.availableQty ?? 0) || 0;
        if (qty <= 0) continue;

        baseQtyBySupplier[o.supplierId] = (baseQtyBySupplier[o.supplierId] ?? 0) + qty;
      }

      for (const o of offers) {
        if (o.model !== "VARIANT") continue;
        if (!o.variantId) continue;
        if (!o.isActive || !o.inStock) continue;

        const baseQty = baseQtyBySupplier[o.supplierId] ?? 0;
        const vQtyRaw = Number(o.availableQty ?? 0) || 0;

        let effective = 0;
        if (vQtyRaw > 0 && baseQty > 0) effective = Math.min(baseQty, vQtyRaw);
        else if (vQtyRaw > 0) effective = vQtyRaw;
        else if (baseQty > 0) effective = baseQty;

        if (effective <= 0) continue;
        stockByVariantId[o.variantId] = (stockByVariantId[o.variantId] ?? 0) + effective;
      }

      const variantStockQty = Object.values(stockByVariantId).reduce((acc, n) => acc + (n ?? 0), 0);
      const totalStockQty = baseStockQty + variantStockQty;

      const sellableVariantIds = new Set(Object.keys(stockByVariantId));

      const readProductRetail = (x: any) => {
        const raw = x?.retailPrice ?? null;
        return raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
      };

      const product: ProductWire = {
        id: String(p.id),
        title: String(p.title ?? ""),
        description: p.description ?? "",
        retailPrice: readProductRetail(p),
        inStock: p.inStock !== false,
        imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
        brand: p.brand ? { id: String(p.brand.id), name: String(p.brand.name) } : null,
        variants,
        offers,
        attributes: normalizeAttributesIntoProductWire(p),
      };


      // ✅ Best + Cheapest offers
      const cheapestBaseOffer = pickBestOffer({ offers, kind: "BASE" });
      const cheapestOverallOffer = pickBestOffer({
        offers,
        kind: "ANY",
        sellableVariantIds,
      });

      const baseDefaultsFromAttributes = normalizeBaseDefaultsFromAttributes(p);

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
    enabled: !!id,
    staleTime: 60_000,
  });

  const similarQ = useQuery({
    queryKey: ["product-similar", id],
    queryFn: async () => {
      const { data } = await api.get(`/api/products/${id}/similar`);
      const arr = (data as any)?.data ?? data ?? [];
      const list: any[] = Array.isArray(arr) ? arr : [];
      return list.map((x) => ({
        id: String(x?.id ?? ""),
        title: String(x?.title ?? ""),
        retailPrice:
          x?.retailPrice != null && Number.isFinite(Number(x.retailPrice)) ? Number(x.retailPrice) : null,
        imagesJson: Array.isArray(x?.imagesJson) ? x.imagesJson : [],
        inStock: x?.inStock !== false,
      })) as SimilarProductWire[];
    },
    enabled: !!id,
    staleTime: 60_000,
  });

  const product = productQ.data?.product;
  React.useEffect(() => {
    if (!product?.id) return;

    const site = "https://dayspringhouse.com";
    const url = `${site}/product/${product.id}`;

    const title = `${product.title} | DaySpring`;
    const desc =
      (product.description ? String(product.description) : "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 155) || `Buy ${product.title} on DaySpring.`;

    const img =
      Array.isArray(product.imagesJson) && product.imagesJson.length > 0
        ? String(product.imagesJson[0])
        : "";

    const price = typeof product.retailPrice === "number" ? product.retailPrice : null;

    setSeo({
      title,
      description: desc,
      canonical: url,
      og: [
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:url", content: url },
        { property: "og:type", content: "product" },
        ...(img ? [{ property: "og:image", content: img }] : []),
      ],
      jsonLd: {
        id: `product-${product.id}`,
        data: {
          "@context": "https://schema.org",
          "@type": "Product",
          name: product.title,
          description: desc,
          url,
          ...(img ? { image: [img] } : {}),
          offers: price
            ? {
              "@type": "Offer",
              priceCurrency: "NGN",
              price: String(price),
              availability: product.inStock
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock",
              url,
            }
            : undefined,
        },
      },
    });
  }, [
    product?.id,
    product?.title,
    product?.description,
    product?.inStock,
    product?.retailPrice,
    // keep stable: stringify is fine for small arrays
    JSON.stringify(product?.imagesJson ?? []),
  ]);

  const stockByVariantId = productQ.data?.stockByVariantId ?? {};
  const totalStockQty = productQ.data?.totalStockQty ?? 0;

  const baseStockQty = productQ.data?.baseStockQty ?? 0;
  const variantStockQty = productQ.data?.variantStockQty ?? 0;

  const hasBaseOffer = productQ.data?.hasBaseOffer ?? false;
  const sellableVariantIds = productQ.data?.sellableVariantIds ?? new Set<string>();
  const baseDefaultsFromAttributes = productQ.data?.baseDefaultsFromAttributes ?? {};

  const cheapestBaseOffer = productQ.data?.cheapestBaseOffer ?? null;
  const cheapestOverallOffer = productQ.data?.cheapestOverallOffer ?? null;

  const canBuyBase = hasBaseOffer && baseStockQty > 0;

  const productAvailabilityMode: ProductAvailabilityMode = React.useMemo(() => {
    const hasBase = baseStockQty > 0;
    const hasVariant = variantStockQty > 0;

    if (hasBase && hasVariant) return "BASE_AND_VARIANT";
    if (hasVariant) return "VARIANT_ONLY";
    if (hasBase) return "BASE_ONLY";
    return "NONE";
  }, [baseStockQty, variantStockQty]);

  const allVariants = product?.variants ?? [];

  const sellableVariants = React.useMemo(() => {
    if (!allVariants.length) return [];
    return allVariants.filter((v) => sellableVariantIds.has(v.id));
  }, [allVariants, sellableVariantIds]);

  const variantsForOptions = allVariants;

  // ✅ axes are derived ONLY from product/variants
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

    for (const v of variantsForOptions || []) {
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
  }, [product, variantsForOptions]);

  const axisIds = React.useMemo(() => axes.map((a) => a.id), [axes]);
  const axisIdSet = React.useMemo(() => new Set(axisIds), [axisIds]);

  const variantPairSetsScoped = React.useMemo(() => {
    const arr: { v: VariantWire; set: Set<string> }[] = [];

    for (const v of variantsForOptions || []) {
      const s = new Set<string>();

      for (const o of v.options || []) {
        const { a, v: val } = idOfOption(o);
        if (!a || !val) continue;
        if (!axisIdSet.has(a)) continue;
        s.add(`${a}:${val}`);
      }

      if (s.size) arr.push({ v, set: s });
    }

    return arr;
  }, [variantsForOptions, axisIdSet]);

  // base defaults from attributes (same as your intent)
  const bestVariantForDefault = React.useMemo(() => {
    if (!variantPairSetsScoped.length) return null;

    let best = variantPairSetsScoped[0].v;
    let bestScore = -1;

    for (const { v } of variantPairSetsScoped) {
      const score = stockByVariantId[v.id] ?? 0;
      if (score > bestScore) {
        best = v;
        bestScore = score;
      }
    }

    return best;
  }, [variantPairSetsScoped, stockByVariantId]);

  const baseDefaults = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const ax of axes) out[ax.id] = "";

    for (const ax of axes) {
      const v = baseDefaultsFromAttributes?.[ax.id];
      if (v) out[ax.id] = String(v);
    }

    if (bestVariantForDefault?.options?.length) {
      for (const o of bestVariantForDefault.options) {
        const aId = String(o.attributeId ?? "").trim();
        const vId = String(o.valueId ?? "").trim();
        if (aId && vId && out[aId] === "") out[aId] = vId;
      }
    }

    return out;
  }, [axes, baseDefaultsFromAttributes, bestVariantForDefault]);

  const isAllEmptySelection = React.useCallback(
    (sel: Record<string, string>) => axisIds.every((aid) => !String(sel?.[aid] ?? "").trim()),
    [axisIds]
  );

  const isAtBaseDefaults = React.useCallback(
    (sel: Record<string, string>) => {
      if (!axisIds.length) return true;
      return shallowEqualSelected(sel, baseDefaults, axisIds);
    },
    [axisIds, baseDefaults]
  );

  /**
   * ✅ Determine cheapest overall VARIANT selection (only if cheapest overall offer is VARIANT)
   */
  const cheapestOverallVariant = React.useMemo(() => {
    if (!cheapestOverallOffer?.unitPrice) return null;
    if (cheapestOverallOffer.model !== "VARIANT") return null;
    const vid = cheapestOverallOffer.variantId;
    if (!vid) return null;
    const v = (product?.variants || []).find((x) => x.id === vid) ?? null;
    return v;
  }, [cheapestOverallOffer, product?.variants]);

  const cheapestOverallVariantSelection = React.useMemo(() => {
    return buildSelectionFromVariant(axes, cheapestOverallVariant);
  }, [axes, cheapestOverallVariant]);

  const [selected, setSelected] = React.useState<Record<string, string>>({});

  /**
   * Find cheapest offer price with standard “sellable” checks.
   * NOTE:
   * - `sellableVariantIds` helps prevent choosing variant offers that can’t actually be sold.
   */
  function cheapestOfferPrice(params: {
    offers: OfferWire[];
    kind: "BASE" | "VARIANT" | "ANY";
    variantId?: string | null;
    sellableVariantIds?: Set<string>;
  }) {
    const { offers, kind, variantId, sellableVariantIds } = params;

    let best: number | null = null;

    for (const o of offers || []) {
      if (!o) continue;
      if (!o.isActive || !o.inStock) continue;

      const qty = Number(o.availableQty ?? 0) || 0;
      if (qty <= 0) continue;

      const price =
        o.unitPrice != null && Number.isFinite(Number(o.unitPrice)) ? Number(o.unitPrice) : null;
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
        if (sellableVariantIds && o.variantId && !sellableVariantIds.has(String(o.variantId))) {
          continue;
        }
      }

      if (best == null || price < best) best = price;
    }

    return best;
  }

  function pickCheapestPositive(a: number | null, b: number | null) {
    const av = a != null && a > 0 ? a : null;
    const bv = b != null && b > 0 ? b : null;
    if (av == null) return bv;
    if (bv == null) return av;
    return Math.min(av, bv);
  }

  /**
   * ✅ Default to BEST + CHEAPEST on load:
   * - if cheapest overall is a VARIANT => select that variant
   * - else => base defaults
   */
  React.useEffect(() => {
    if (!product || !axes.length) {
      setSelected({});
      return;
    }

    setSelected(() => {
      if (cheapestOverallVariantSelection) return { ...cheapestOverallVariantSelection };
      return { ...baseDefaults };
    });
  }, [product?.id, axes, baseDefaults, cheapestOverallVariantSelection]);

  const isSelectionCompatible = React.useCallback(
    (draft: Record<string, string>) => {
      const entries = Object.entries(draft).filter(([, v]) => !!String(v || "").trim());
      if (!entries.length) return true;

      if (!variantPairSetsScoped.length) return true;

      return variantPairSetsScoped.some(({ set }) =>
        entries.every(([aid, vid]) => set.has(`${aid}:${vid}`))
      );
    },
    [variantPairSetsScoped]
  );

  const getFilteredValuesForAttribute = React.useCallback(
    (attrId: string) => {
      const axis = axes.find((a) => a.id === attrId);
      if (!axis) return [];

      if (!variantPairSetsScoped.length) return axis.values;

      const otherPairs = Object.entries(selected)
        .filter(([aid, vid]) => aid !== attrId && !!String(vid || "").trim())
        .map(([aid, vid]) => `${aid}:${vid}`);

      if (!otherPairs.length) return axis.values;

      const possible = new Set<string>();

      for (const { set } of variantPairSetsScoped) {
        let ok = true;
        for (const p of otherPairs) {
          if (!set.has(p)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        for (const pair of set) {
          const [aid, vid] = pair.split(":");
          if (aid === attrId && vid) possible.add(vid);
        }
      }

      if (!possible.size) return axis.values;
      return axis.values.filter((v) => possible.has(v.id));
    },
    [axes, selected, variantPairSetsScoped]
  );

  const selectionInfo = React.useMemo(() => {
    if (!product || !variantPairSetsScoped.length) {
      return {
        picked: [] as Array<[string, string]>,
        exact: [] as VariantWire[],
        supers: [] as { v: VariantWire; missingAttrIds: Set<string> }[],
        totalStockExact: 0,
        missingAxisIds: new Set<string>(),
      };
    }

    const picked = Object.entries(selected).filter(([, v]) => !!String(v || "").trim());
    const pickedAttrIds = new Set(picked.map(([aid]) => aid));
    const selPairs = new Set(picked.map(([aid, vid]) => `${aid}:${vid}`));

    const exact: VariantWire[] = [];
    const supers: { v: VariantWire; missingAttrIds: Set<string> }[] = [];

    for (const { v, set } of variantPairSetsScoped) {
      let isSuperset = true;
      for (const p of selPairs) {
        if (!set.has(p)) {
          isSuperset = false;
          break;
        }
      }
      if (!isSuperset) continue;

      if (set.size === selPairs.size) exact.push(v);
      else {
        const missing = new Set<string>();
        for (const pair of set) {
          const [aid] = pair.split(":");
          if (!pickedAttrIds.has(aid)) missing.add(aid);
        }
        supers.push({ v, missingAttrIds: missing });
      }
    }

    let totalStockExact = 0;
    for (const v of exact) totalStockExact += stockByVariantId[v.id] ?? 0;

    const missingAxisIds = new Set<string>();
    for (const s of supers) s.missingAttrIds.forEach((x) => missingAxisIds.add(x));

    return { picked, exact, supers, totalStockExact, missingAxisIds };
  }, [product, selected, variantPairSetsScoped, stockByVariantId]);

  /**
   * ✅ Pricing (BEST + CHEAPEST + LOCKABLE):
   * - We return chosenOffer (offerId + supplierId) so you can lock the supplier/offer in cart/checkout.
   */
  const computed = React.useMemo(() => {
    const offers = product?.offers ?? [];

    const retailFallbackProduct = toNum(product?.retailPrice, 0);

    // BASE mode if selection is base defaults
    if (axes.length > 0 && isAtBaseDefaults(selected)) {
      const baseSupplier = cheapestOfferPrice({ offers, kind: "BASE" });

      // ✅ Option A:
      // - If base is buyable, show BASE offer only (avoid showing variant price while in BASE mode).
      // - If base is NOT buyable, allow ANY (variant) to show "best+cheapest" retail.
      let chosenSupplier: number | null = null;
      let source: "BASE_OFFER" | "CHEAPEST_OFFER" | "PRODUCT_RETAIL" = "PRODUCT_RETAIL";

      if (baseStockQty > 0) {
        // base-buyable => strict base pricing
        chosenSupplier = baseSupplier;
        source = baseSupplier != null ? "BASE_OFFER" : "PRODUCT_RETAIL";
      } else {
        // base not buyable => allow variant offers as the "cheapest"
        const anySupplier = cheapestOfferPrice({
          offers,
          kind: "ANY",
          sellableVariantIds,
        });

        chosenSupplier = pickCheapestPositive(baseSupplier, anySupplier);

        source =
          chosenSupplier != null
            ? baseSupplier != null && chosenSupplier === baseSupplier
              ? "BASE_OFFER"
              : "CHEAPEST_OFFER"
            : "PRODUCT_RETAIL";
      }

      const retailFromSupplier =
        chosenSupplier != null ? applyMargin(chosenSupplier, marginPercent) : null;

      const fallbackRetail = toNum(product?.retailPrice, 0);

      return {
        mode: "BASE" as const,
        supplierPrice: chosenSupplier,
        final: retailFromSupplier != null && retailFromSupplier > 0 ? retailFromSupplier : fallbackRetail,
        supplierId: null as string | null, // base mode: optional to lock; we keep null
        supplierName: null as string | null,
        offerId: null as string | null,
        matchedVariant: null as VariantWire | null,
        exactMatch: false,
        exactSellable: false,
        source,
      };
    }

    const pickedPairs = selectionPairsOf(selected);
    if (!pickedPairs.length) {
      const bestAny = pickBestOffer({ offers, kind: "ANY", sellableVariantIds });
      const retailFromSupplier =
        bestAny?.unitPrice != null ? applyMargin(bestAny.unitPrice, marginPercent) : null;

      return {
        mode: "VARIANT" as const,
        supplierPrice: bestAny?.unitPrice ?? null,
        supplierId: bestAny?.supplierId ?? null,
        supplierName: bestAny?.supplierName ?? null,
        offerId: bestAny?.offerId ?? null,
        final: retailFromSupplier != null && retailFromSupplier > 0 ? retailFromSupplier : retailFallbackProduct,
        matchedVariant: null as VariantWire | null,
        exactMatch: false,
        exactSellable: false,
        source: bestAny != null ? "CHEAPEST_OFFER" : "PRODUCT_RETAIL",
      };
    }

    // Find exact variant match
    let matched: VariantWire | null = null;
    const selPairs = new Set(pickedPairs);

    for (const { v, set } of variantPairSetsScoped) {
      let ok = true;
      for (const p of selPairs) {
        if (!set.has(p)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (set.size !== selPairs.size) continue;
      matched = v;
      break;
    }

    if (!matched) {
      const bestAny = pickBestOffer({ offers, kind: "ANY", sellableVariantIds });
      const retailFromSupplier =
        bestAny?.unitPrice != null ? applyMargin(bestAny.unitPrice, marginPercent) : null;

      return {
        mode: "VARIANT" as const,
        supplierPrice: bestAny?.unitPrice ?? null,
        supplierId: bestAny?.supplierId ?? null,
        supplierName: bestAny?.supplierName ?? null,
        offerId: bestAny?.offerId ?? null,
        final: retailFromSupplier != null && retailFromSupplier > 0 ? retailFromSupplier : retailFallbackProduct,
        matchedVariant: null as VariantWire | null,
        exactMatch: false,
        exactSellable: false,
        source: bestAny != null ? "CHEAPEST_OFFER" : "PRODUCT_RETAIL",
      };
    }

    const sellable = (stockByVariantId[matched.id] ?? 0) > 0;

    // Best offer for this specific variant
    const bestVariant = pickBestOffer({
      offers,
      kind: "VARIANT",
      variantId: matched.id,
      sellableVariantIds,
    });

    // fallback: base offer if variant offer missing
    const bestBase = pickBestOffer({ offers, kind: "BASE" });

    const chosen = bestVariant ?? bestBase;
    const retailFromSupplier =
      chosen?.unitPrice != null ? applyMargin(chosen.unitPrice, marginPercent) : null;

    const fallbackVariantRetail = toNum(matched.retailPrice, 0);
    const fallbackRetail = fallbackVariantRetail > 0 ? fallbackVariantRetail : retailFallbackProduct;

    return {
      mode: "VARIANT" as const,
      supplierPrice: chosen?.unitPrice ?? null,
      supplierId: chosen?.supplierId ?? null,
      supplierName: chosen?.supplierName ?? null,
      offerId: chosen?.offerId ?? null,
      final: retailFromSupplier != null && retailFromSupplier > 0 ? retailFromSupplier : fallbackRetail,
      matchedVariant: matched,
      exactMatch: true,
      exactSellable: sellable,
      source:
        bestVariant != null
          ? "VARIANT_OFFER"
          : bestBase != null
            ? "BASE_OFFER_FALLBACK"
            : "RETAIL_FALLBACK",
    };
  }, [
    product?.offers,
    product?.retailPrice,
    axes.length,
    selected,
    isAtBaseDefaults,
    variantPairSetsScoped,
    stockByVariantId,
    sellableVariantIds,
    marginPercent,
    baseStockQty,
  ]);

  const purchaseMeta = React.useMemo(() => {
    const hasVariantAxes = axes.length > 0;
    const { picked, exact, supers, totalStockExact, missingAxisIds } = selectionInfo;

    if (!hasVariantAxes) {
      if (canBuyBase)
        return {
          disableAddToCart: false,
          helperNote: null,
          mode: "BASE" as const,
          variantId: null as string | null,
        };
      return {
        disableAddToCart: true,
        helperNote: "Out of stock.",
        mode: "BASE" as const,
        variantId: null as string | null,
      };
    }

    if (isAllEmptySelection(selected)) {
      return {
        disableAddToCart: true,
        helperNote: "Choose base option, or select a valid variant combination.",
        mode: "VARIANT" as const,
        variantId: null as string | null,
      };
    }

    if (isAtBaseDefaults(selected)) {
      if (canBuyBase) {
        return {
          disableAddToCart: false,
          helperNote: "Base product selected. Choose options to buy a specific variant.",
          mode: "BASE" as const,
          variantId: null as string | null,
        };
      }

      if (variantStockQty > 0) {
        return {
          disableAddToCart: true,
          helperNote:
            "Base offer is not available. This product is available as variants only — please select options.",
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

    if (picked.length && exact.length > 0) {
      if (totalStockExact <= 0) {
        return {
          disableAddToCart: true,
          helperNote:
            "This variant combo is out of stock (no active supplier offer). Try another combination.",
          mode: "VARIANT" as const,
          variantId: null as string | null,
        };
      }

      const vid = computed.matchedVariant?.id ?? exact[0]?.id ?? null;
      return {
        disableAddToCart: !vid,
        helperNote: null,
        mode: "VARIANT" as const,
        variantId: vid,
      };
    }

    if (supers.length > 0) {
      const missingNames = axes.filter((a) => missingAxisIds.has(a.id)).map((a) => a.name);
      return {
        disableAddToCart: true,
        helperNote: missingNames.length
          ? `Please also select: ${missingNames.join(", ")}.`
          : "This choice is incomplete. Please select the remaining options.",
        mode: "VARIANT" as const,
        variantId: null as string | null,
      };
    }

    return {
      disableAddToCart: true,
      helperNote:
        sellableVariants.length > 0
          ? "This combination is not available (no supplier offer). Try a different set of options."
          : canBuyBase
            ? "Only base is available right now."
            : "No available offers for this product right now.",
      mode: "VARIANT" as const,
      variantId: null as string | null,
    };
  }, [
    axes,
    canBuyBase,
    isAtBaseDefaults,
    isAllEmptySelection,
    selected,
    selectionInfo,
    computed.matchedVariant?.id,
    sellableVariants.length,
    variantStockQty,
  ]);

  /* ---------------- Images / Zoom ---------------- */
  function isUrlish(s?: string) {
    return !!s && /^(https?:\/\/|data:image\/|\/)/i.test(s);
  }

  const images = React.useMemo(() => {
    const arr = Array.isArray(product?.imagesJson) ? product!.imagesJson! : [];
    // keep only valid-ish urls
    return arr.map(String).filter((u) => isUrlish(u));
  }, [product?.imagesJson]);

  const currentSelectionQty = React.useMemo(() => {
    if (purchaseMeta.mode === "BASE") return baseStockQty;
    const vid = purchaseMeta.variantId;
    if (!vid) return 0;
    return stockByVariantId[vid] ?? 0;
  }, [purchaseMeta.mode, purchaseMeta.variantId, baseStockQty, stockByVariantId]);

  const availabilityBadge = React.useMemo(() => {
    const qty = currentSelectionQty;

    if (!purchaseMeta.disableAddToCart && qty > 0) {
      return {
        text: `In stock${Number.isFinite(qty) ? ` • ${qty}` : ""}`,
        cls: "bg-emerald-600/10 text-emerald-700 border-emerald-600/20",
      };
    }

    if (productAvailabilityMode === "NONE") {
      return {
        text: "Out of stock",
        cls: "bg-rose-600/10 text-rose-700 border-rose-600/20",
      };
    }

    if (purchaseMeta.mode === "VARIANT" && selectionInfo.exact.length > 0) {
      return {
        text: "Out of stock (selection)",
        cls: "bg-rose-600/10 text-rose-700 border-rose-600/20",
      };
    }

    if (isAtBaseDefaults(selected) && productAvailabilityMode === "VARIANT_ONLY") {
      return {
        text: "Variant only",
        cls: "bg-indigo-600/10 text-indigo-700 border-indigo-600/20",
      };
    }

    if (!isAtBaseDefaults(selected) && productAvailabilityMode === "BASE_ONLY") {
      return {
        text: "Base only",
        cls: "bg-indigo-600/10 text-indigo-700 border-indigo-600/20",
      };
    }

    if (productAvailabilityMode === "VARIANT_ONLY") {
      return {
        text: "Select variant options",
        cls: "bg-amber-600/10 text-amber-700 border-amber-600/20",
      };
    }

    return {
      text: "Select options",
      cls: "bg-amber-600/10 text-amber-700 border-amber-600/20",
    };
  }, [
    currentSelectionQty,
    purchaseMeta.disableAddToCart,
    purchaseMeta.mode,
    selectionInfo.exact.length,
    productAvailabilityMode,
    selected,
    isAtBaseDefaults,
  ]);

  const availabilityByAxis = React.useMemo(() => {
    const byAxis: Record<string, Record<string, ValueState>> = {};

    for (const ax of axes) {
      const map: Record<string, ValueState> = {};

      const otherSel = { ...selected };
      delete otherSel[ax.id];

      const otherAxesAtBase = axes.every((a) => {
        if (a.id === ax.id) return true;
        const cur = String(otherSel[a.id] ?? "");
        const base = String(baseDefaults[a.id] ?? "");
        return !cur || cur === base;
      });

      for (const val of ax.values) {
        const draft: Record<string, string> = { ...otherSel, [ax.id]: val.id };
        const draftPairs = selectionPairsOf(draft);

        let exists = false;
        let stock = 0;

        if (variantPairSetsScoped.length) {
          for (const { v, set } of variantPairSetsScoped) {
            let ok = true;
            for (const p of draftPairs) {
              if (!set.has(p)) {
                ok = false;
                break;
              }
            }
            if (!ok) continue;

            exists = true;
            stock += stockByVariantId[v.id] ?? 0;
          }
        } else {
          exists = true;
        }

        const isBaseValue = String(val.id) === String(baseDefaults[ax.id] ?? "");
        if (isBaseValue && otherAxesAtBase) {
          exists = true;
          stock += baseStockQty;
        }

        let disabled = false;
        let reason: string | undefined;

        if (!exists) {
          disabled = true;
          reason = "Not available";
        } else if (stock <= 0) {
          disabled = true;
          reason = "Out of stock";
        }

        map[val.id] = { exists, stock, disabled, reason };
      }

      byAxis[ax.id] = map;
    }

    return byAxis;
  }, [axes, selected, baseDefaults, variantPairSetsScoped, stockByVariantId, baseStockQty]);

  const [mainIndex, setMainIndex] = React.useState(0);

  React.useEffect(() => {
    setMainIndex(0);
  }, [product?.id]);

  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    if (paused || images.length < 2) return;
    const idInt = setInterval(() => setMainIndex((i) => (i + 1) % images.length), 4000);
    return () => clearInterval(idInt);
  }, [paused, images.length]);

  const [thumbStart, setThumbStart] = React.useState(0);
  const maxThumbStart = Math.max(images.length - 3, 0);

  React.useEffect(() => {
    if (mainIndex < thumbStart) setThumbStart(mainIndex);
    else if (mainIndex > thumbStart + 2) setThumbStart(Math.min(mainIndex - 2, maxThumbStart));
  }, [mainIndex, thumbStart, maxThumbStart]);

  const visibleThumbs = images.slice(thumbStart, thumbStart + 3);

  const mainImgRef = React.useRef<HTMLImageElement | null>(null);
  const [imgBox, setImgBox] = React.useState({ w: 0, h: 0 });
  const [brokenByIndex, setBrokenByIndex] = React.useState<Record<number, boolean>>({});

  const [naturalSize, setNaturalSize] = React.useState({ w: 0, h: 0 });
  const [hoverPx, setHoverPx] = React.useState({ x: 0, y: 0 });
  const [showZoom, setShowZoom] = React.useState(false);

  const ZOOM_REQUEST = 2.2;
  const ZOOM_PANE = { w: 360, h: 360 };
  const [zoomAnchor, setZoomAnchor] = React.useState<{ top: number; left: number } | null>(null);

  const updateZoomAnchor = React.useCallback(() => {
    const img = mainImgRef.current;
    if (!img) return;
    const r = img.getBoundingClientRect();

    let left = r.right + 12;
    let top = r.top;

    const pad = 12;
    const paneW = ZOOM_PANE.w;
    const paneH = ZOOM_PANE.h;

    if (left + paneW + pad > window.innerWidth) {
      left = Math.max(pad, r.left - paneW - 12);
    }

    if (top + paneH + pad > window.innerHeight) {
      top = Math.max(pad, window.innerHeight - paneH - pad);
    }
    if (top < pad) top = pad;

    setZoomAnchor({ top, left });
  }, [ZOOM_PANE.w, ZOOM_PANE.h]);

  React.useLayoutEffect(() => {
    const img = mainImgRef.current;
    if (!img) return;
    const update = () => setImgBox({ w: img.clientWidth, h: img.clientHeight });
    update();
    const obs = new ResizeObserver(update);
    obs.observe(img);
    return () => obs.disconnect();
  }, [mainIndex]);

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setImgBox({ w: img.clientWidth, h: img.clientHeight });

    setBrokenByIndex((prev) => ({ ...prev, [mainIndex]: false }));
  }


  function onMouseMove(e: React.MouseEvent) {
    const img = mainImgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    setHoverPx({ x, y });
  }

  const hasBox = imgBox.w > 0 && imgBox.h > 0;

  const EFFECTIVE_ZOOM = hasBox ? ZOOM_REQUEST : 1;
  const relX = hasBox ? hoverPx.x / imgBox.w : 0.5;
  const relY = hasBox ? hoverPx.y / imgBox.h : 0.5;
  const bgPosX = `${relX * 100}%`;
  const bgPosY = `${relY * 100}%`;
  const bgSize = `${EFFECTIVE_ZOOM * 100}%`;

  /* ---------------- Add to cart ---------------- */
  const handleAddToCart = React.useCallback(async () => {
    if (!product) return;
    if (purchaseMeta.disableAddToCart) return;

    const variantId = purchaseMeta.mode === "VARIANT" ? purchaseMeta.variantId : null;

    const selectedOptionsWire = Object.entries(selected)
      .filter(([, v]) => !!String(v || "").trim())
      .map(([attributeId, valueId]) => ({ attributeId, valueId }));

    // ✅ unit price sent to client/cart is the computed retail (supplier + margin)
    const unitPriceClient = toNum(computed.final, 0);
    const unit = Number(unitPriceClient) || 0;

    const variantImg = variantId
      ? (product.variants || []).find((v) => v.id === variantId)?.imagesJson?.[0]
      : undefined;

    const primaryImg = variantImg || (product.imagesJson || [])[0] || null;

    try {
      await api.post("/api/cart/items", {
        productId: product.id,
        variantId,
        quantity: 1,
        selectedOptions: selectedOptionsWire,
        unitPriceClient,

        // ✅ NEW (backend can ignore if not implemented yet)
        supplierId: computed.supplierId,
        supplierOfferId: computed.offerId,
      });
    } catch {
      // ignore
    } finally {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      window.dispatchEvent(new Event("cart:updated"));
    }

    React.useEffect(() => {
      setMainIndex(0);
      setBrokenByIndex({});
    }, [product?.id]);


    const { attrNameById, valueNameByAttrId } = buildLabelMaps(axes);
    const selectedOptionsLabeled = selectedOptionsWire.map(({ attributeId, valueId }) => ({
      attributeId,
      attribute: attrNameById.get(attributeId) ?? "",
      valueId,
      value: valueId ? valueNameByAttrId.get(attributeId)?.get(valueId) ?? "" : "",
    }));

    const cart = upsertCartLineLS({
      productId: product.id,
      variantId,
      title: product.title ?? "",
      unitPrice: unit,
      image: primaryImg,
      selectedOptions: selectedOptionsLabeled,
    });

    showMiniCartToast(cart, { productId: product.id, variantId }, { title: "Added to cart", duration: 3500, maxItems: 4 });
  }, [product, purchaseMeta, selected, computed.final, computed.supplierId, computed.offerId, axes, queryClient]);

  React.useEffect(() => {
    if (!showZoom) return;

    const on = () => updateZoomAnchor();
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
    };
  }, [showZoom, updateZoomAnchor]);

  /* ---------------- Similar products carousel helpers ---------------- */
  const similarRef = React.useRef<HTMLDivElement | null>(null);

  const scrollSimilarBy = React.useCallback((dir: -1 | 1) => {
    const el = similarRef.current;
    if (!el) return;
    const step = Math.max(260, Math.floor(el.clientWidth * 0.85));
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  }, []);

  /**
   * ✅ Fetch offers for each similar product (so we can compute supplier+margin retail, same as detail page).
   */
  const similarOfferQs = useQueries({
    queries: (similarQ.data || [])
      .filter((sp) => !!sp.id)
      .map((sp) => ({
        queryKey: ["product-offers-min", sp.id],
        enabled: !!sp.id,
        staleTime: 60_000,
        queryFn: async () => {
          const { data } = await api.get(`/api/products/${sp.id}`, {
            params: { include: "offers" },
          });
          const payload = (data as any)?.data ?? data ?? {};
          const p = (payload as any)?.data ?? payload;

          const offers = offersFromSchema(p);

          // best-effort sellableVariantIds from VARIANT offers
          const sellableVariantIds = new Set<string>();
          for (const o of offers) {
            if ((o.model === "VARIANT" || o.variantId) && o.variantId) {
              if (!o.isActive || !o.inStock) continue;
              const qty = Number(o.availableQty ?? 0) || 0;
              if (qty <= 0) continue;
              sellableVariantIds.add(String(o.variantId));
            }
          }

          const bestAny = pickBestOffer({
            offers,
            kind: "ANY",
            sellableVariantIds,
          });

          return {
            supplierPrice: bestAny?.unitPrice ?? null,
          };
        },
      })),
  });

  const isCoarsePointer = React.useMemo(() => {
    if (typeof window === "undefined") return false;
    return !!window.matchMedia?.("(pointer: coarse)").matches;
  }, []);

  /* ---------------- Render ---------------- */
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
  const CHIP_THRESHOLD = 8;

  function VariantAxisPicker({
    axis,
    value,
    onChange,
  }: {
    axis: { id: string; name: string; values: { id: string; name: string }[] };
    value: string;
    onChange: (next: string) => void;
  }) {
    const states = availabilityByAxis[axis.id] || {};
    const useChips = axis.values.length <= CHIP_THRESHOLD;

    if (useChips) {
      return (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange("")}
            className={`px-2.5 py-1.5 rounded-xl border text-sm md:text-base ${silverBorder}
            ${!value ? "ring-2 ring-fuchsia-500 border-fuchsia-500" : "bg-white hover:bg-zinc-50"} ${silverShadowSm}`}
          >
            No {axis.name.toLowerCase()}
          </button>

          {axis.values.map((opt) => {
            const st = states[opt.id] ?? { exists: true, stock: 0, disabled: false };
            const active = value === opt.id;

            return (
              <button
                key={opt.id}
                type="button"
                disabled={st.disabled}
                onClick={() => onChange(opt.id)}
                className={`px-2.5 py-1.5 rounded-xl border text-sm md:text-base transition flex items-center gap-2 ${silverBorder} ${silverShadowSm}
                ${active ? "ring-2 ring-fuchsia-500 border-fuchsia-500" : "bg-white hover:bg-zinc-50"}
                ${st.disabled ? "opacity-60 cursor-not-allowed hover:bg-white" : ""}`}
              >
                <span className={st.disabled ? "line-through" : ""}>{opt.name}</span>

                {st.disabled && st.reason ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
                    {st.reason}
                  </span>
                ) : st.stock > 0 ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                    {st.stock}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      );
    }

    const filtered = getFilteredValuesForAttribute(axis.id);

    return (
      <Select value={value} onValueChange={(v) => onChange(v === "__NONE__" ? "" : v)}>
        <SelectTrigger className={`h-11 rounded-xl text-sm md:text-base ${silverBorder} ${silverShadowSm}`}>
          <SelectValue placeholder={`No ${axis.name.toLowerCase()}`} />
        </SelectTrigger>

        <SelectContent className="text-sm md:text-base">
          <SelectItem value="__NONE__">{`No ${axis.name.toLowerCase()}`}</SelectItem>
          {filtered.map((opt) => {
            const st = states[opt.id] ?? { exists: true, stock: 0, disabled: false };

            const labelText =
              st.disabled && st.reason ? `${opt.name} — ${st.reason}` : st.stock > 0 ? `${opt.name} (${st.stock})` : opt.name;

            return (
              <SelectItem key={opt.id} value={opt.id} disabled={st.disabled}>
                {labelText}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    );
  }


  function NoImageBox({ className = "" }: { className?: string }) {
    return (
      <div
        className={`w-full h-full flex items-center justify-center text-center ${className}`}
        aria-label="No image"
      >
        <div className="px-6 py-8">
          <div className="text-sm font-medium text-zinc-700">No image</div>
          <div className="mt-1 text-xs text-zinc-500">This product has no photos yet.</div>
        </div>
      </div>
    );
  }

  const currentSrc = images[mainIndex];
  const mainIsBroken = !!brokenByIndex[mainIndex];
  const showMainImg = !!currentSrc && !mainIsBroken;
  return (
    <SiteLayout>
      <div className="bg-gradient-to-b from-zinc-50 to-white">
        <div className="max-w-6xl mx-auto px-4 md:px-6 pt-4 md:pt-6">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className={`touch-manipulation text-sm px-3 py-2 rounded-xl bg-white hover:bg-zinc-50 ${silverBorder} ${silverShadowSm}`}
            >
              ← Back
            </button>

            <div className="text-xs text-zinc-500">
              {product.brand?.name ? (
                <span className="truncate max-w-[60vw] inline-block">
                  {product.brand.name} / {product.title}
                </span>
              ) : (
                <span className="truncate max-w-[60vw] inline-block">{product.title}</span>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-4 md:py-6 grid grid-cols-1 md:grid-cols-2 gap-6 max-[360px]:gap-5">
          <div className="space-y-3 md:space-y-5">
            <div className="relative mx-auto w-full sm:max-w-[92%]">
              <div
                className={`rounded-2xl overflow-hidden bg-white ${silverBorder} ${silverShadow}`}
                style={{ aspectRatio: "1 / 1" }}
                onMouseEnter={
                  isCoarsePointer
                    ? undefined
                    : () => {
                      setShowZoom(true);
                      setPaused(true);
                      updateZoomAnchor();
                    }
                }
                onMouseLeave={isCoarsePointer ? undefined : () => { setShowZoom(false); setPaused(false); }}
                onMouseMove={isCoarsePointer ? undefined : onMouseMove}

              >
                <div
                  className={`rounded-2xl overflow-hidden bg-white ${silverBorder} ${silverShadow}`}
                  style={{ aspectRatio: "1 / 1" }}
                  onMouseEnter={
                    isCoarsePointer
                      ? undefined
                      : () => {
                        setShowZoom(true);
                        setPaused(true);
                        updateZoomAnchor();
                      }
                  }
                  onMouseLeave={isCoarsePointer ? undefined : () => { setShowZoom(false); setPaused(false); }}
                  onMouseMove={isCoarsePointer ? undefined : onMouseMove}
                >
                  {showMainImg ? (
                    <img
                      ref={mainImgRef}
                      src={currentSrc}
                      alt=""              // ✅ removed alt text like Catalog
                      className="w-full h-full object-cover cursor-zoom-in"
                      onLoad={handleImageLoad}
                      onError={() => setBrokenByIndex((prev) => ({ ...prev, [mainIndex]: true }))}
                    />
                  ) : (
                    <NoImageBox className="bg-zinc-50" />
                  )}
                </div>

              </div>

              <span
                className={`absolute left-3 top-3 pointer-events-none inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border ${availabilityBadge.cls} ${silverShadowSm}`}
              >
                {availabilityBadge.text}
              </span>


              {showZoom && hasBox && zoomAnchor && showMainImg &&
                createPortal(
                  <div
                    className={`hidden md:block rounded-xl overflow-hidden pointer-events-none z-[9999] bg-white ${silverBorder} ${silverShadow}`}
                    style={{
                      position: "fixed",
                      top: zoomAnchor.top,
                      left: zoomAnchor.left,
                      width: ZOOM_PANE.w,
                      height: ZOOM_PANE.h,
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        backgroundImage: `url(${images[mainIndex]})`,
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: `${bgPosX} ${bgPosY}`,
                        backgroundSize: bgSize,
                      }}
                    />
                  </div>,
                  document.body
                )}

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
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                    {images.map((_, i) => (
                      <span
                        key={i}
                        onClick={() => setMainIndex(i)}
                        className={`h-1.5 w-1.5 rounded-full cursor-pointer ${i === mainIndex ? "bg-fuchsia-600" : "bg-white/80 border border-zinc-200/70"
                          }`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
            {images.length > 0 && (
              <div
                className="flex items-center justify-center gap-2"
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
              >
                <button
                  type="button"
                  onClick={() => setMainIndex((i) => (i - 1 + images.length) % images.length)}
                  className={`rounded-full px-2.5 py-1.5 text-sm bg-white hover:bg-zinc-50 ${silverBorder} ${silverShadowSm}`}
                  aria-label="Previous thumbnails"
                >
                  ‹
                </button>

                <div className="flex gap-2">
                  {visibleThumbs.map((u, i) => {
                    const absoluteIndex = thumbStart + i;
                    const isActive = absoluteIndex === mainIndex;
                    return (
                      <img
                        key={`${u}:${absoluteIndex}`}
                        src={u}
                        alt="" // ✅ blank alt
                        onClick={() => setMainIndex(absoluteIndex)}
                        className={`w-20 h-16 sm:w-24 sm:h-20 max-[360px]:w-[68px] max-[360px]:h-[54px] rounded-xl object-cover select-none cursor-pointer ${silverBorder} ${silverShadowSm} ${isActive ? "ring-2 ring-fuchsia-500 border-fuchsia-500" : "hover:opacity-90 bg-white"
                          }`}
                        onLoad={() => setBrokenByIndex((prev) => ({ ...prev, [absoluteIndex]: false }))}
                        onError={() => setBrokenByIndex((prev) => ({ ...prev, [absoluteIndex]: true }))}
                      />
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setMainIndex((i) => (i + 1) % images.length)}
                  className={`rounded-full px-2 py-1 text-sm max-[360px]:px-1.5 max-[360px]:py-0.5 bg-white hover:bg-zinc-50 ${silverBorder} ${silverShadowSm}`}
                  aria-label="Next thumbnails"
                >
                  ›
                </button>
              </div>
            )}

            <div className={`hidden md:block ${cardCls} p-4 md:p-5`}>
              <h2 className="text-base font-semibold mb-1">Description</h2>
              <p className="text-sm text-zinc-700 whitespace-pre-line">{product.description || "No description yet."}</p>
            </div>
          </div>

          <div className="space-y-5">
            <div className={`${cardCls} p-4 md:p-5`}>
              <h1 className="text-2xl font-semibold leading-tight">{product.title}</h1>
              {product.brand?.name && <div className="text-sm text-zinc-600 mt-1">{product.brand.name}</div>}

              <div className={`mt-4 rounded-2xl p-4 ${softInsetCls}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-[12px] sm:text-sm text-zinc-500">Current price (retail)</div>

                    <div className="font-bold tracking-tight leading-none text-[28px] sm:text-3xl max-[360px]:text-[24px] break-words">
                      {priceLabel}
                    </div>
                  </div>

                  <span
                    className={`self-start sm:self-auto inline-flex items-center rounded-full border
      px-2.5 py-1 text-[11px] sm:text-xs font-medium
      max-[360px]:px-2 max-[360px]:py-0.5 max-[360px]:text-[10px]
      ${availabilityBadge.cls} ${silverShadowSm}`}
                  >
                    {availabilityBadge.text}
                  </span>
                </div>


                <div className="text-[11px] text-zinc-600 mt-1">
                  {computed.source === "BASE_OFFER"
                    ? "Using best base offer."
                    : computed.source === "VARIANT_OFFER"
                      ? "Using best variant offer for your selection."
                      : computed.source === "CHEAPEST_OFFER"
                        ? "Using best + cheapest available offer."
                        : "Using stored retail fallback."}
                </div>
              </div>

              {axes.length > 0 && (
                <div className="space-y-3 mt-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-zinc-700">Choose options</div>

                    <div
                      className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pr-1
  [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelected({ ...baseDefaults });
                        }}
                        className={`touch-manipulation px-2 py-1 text-[10px] rounded-lg bg-white hover:bg-zinc-50 ${silverBorder} ${silverShadowSm}`}
                        title="Select the base product default options"
                      >
                        <span className="sm:hidden">Base</span>
                        <span className="hidden sm:inline">Choose base option</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (cheapestOverallVariantSelection) {
                            setSelected({ ...cheapestOverallVariantSelection });
                            return;
                          }
                          setSelected({ ...baseDefaults });
                        }}
                        className={`touch-manipulation px-2 py-1 text-[10px] rounded-lg bg-white hover:bg-zinc-50 ${silverBorder} ${silverShadowSm}`}
                        title="Choose best+cheapest sellable offer (base or variant)"
                      >
                        <span className="sm:hidden">Cheapest</span>
                        <span className="hidden sm:inline">Choose cheapest</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelected(buildEmptySelection(axes))}
                        className={`touch-manipulation px-2 py-1 text-[10px] rounded-lg bg-white hover:bg-zinc-50 ${silverBorder} ${silverShadowSm}`}
                        title="Clear selections (No variant)"
                      >
                        <span className="sm:hidden">Reset</span>
                        <span className="hidden sm:inline">Reset all variants(None)</span>
                      </button>
                    </div>
                  </div>

                  {axes.map((a) => (
                    <div key={a.id} className="grid gap-2">
                      <label className="text-sm md:text-base font-medium text-zinc-700">{a.name}</label>

                      <VariantAxisPicker
                        axis={a}
                        value={selected[a.id] ?? ""}
                        onChange={(val) => {
                          setSelected((prev) => {
                            const draft = { ...prev, [a.id]: val };
                            if (!val) return draft;
                            if (isSelectionCompatible(draft)) return draft;

                            const resetOthers: Record<string, string> = { ...draft };
                            for (const ax of axes) if (ax.id !== a.id) resetOthers[ax.id] = "";
                            return resetOthers;
                          });
                        }}
                      />
                    </div>
                  ))}

                  {purchaseMeta.helperNote && (
                    <div className={`text-[11px] mt-2 px-3 py-2 rounded-xl text-zinc-700 ${softInsetCls}`}>
                      {purchaseMeta.helperNote}
                    </div>
                  )}

                  <div className="text-[11px] text-zinc-600">
                    {selectionInfo.exact.length > 0 && selectionInfo.totalStockExact > 0
                      ? `Available for this selection: ${selectionInfo.totalStockExact}`
                      : "Select a sellable combination to see availability"}
                  </div>
                </div>
              )}

              <div className="pt-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={purchaseMeta.disableAddToCart}
                  className={`touch-manipulation w-full sm:w-auto justify-center inline-flex items-center gap-2 rounded-2xl px-5 py-3 active:scale-[0.99] transition focus:outline-none focus:ring-4 ${silverBorder} ${silverShadow}
                ${purchaseMeta.disableAddToCart
                      ? "bg-zinc-200 text-zinc-600 cursor-not-allowed focus:ring-zinc-200"
                      : "bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white hover:shadow-md focus:ring-fuchsia-300/40"
                    }`}
                >
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="sm:hidden">Add • {NGN.format(toNum(computed.final, 0))}</span>
                  <span className="hidden sm:inline">Add to cart — {NGN.format(toNum(computed.final, 0))}</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate("/cart")}
                  className={`touch-manipulation w-full sm:w-auto justify-center inline-flex items-center gap-2 rounded-2xl px-5 py-3 bg-white text-zinc-900 hover:bg-zinc-50 active:scale-[0.99] transition focus:outline-none focus:ring-4 focus:ring-zinc-300/40 ${silverBorder} ${silverShadow}`}
                >
                  Go to Cart
                </button>
              </div>
            </div>

            <div className={`block md:hidden ${cardCls} p-4 md:p-5`}>
              <h2 className="text-base font-semibold mb-1">Description</h2>
              <p className="text-sm text-zinc-700 whitespace-pre-line">{product.description || "No description yet."}</p>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 md:px-6 pb-10">
          <div className={`${cardCls} p-4 md:p-5`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Similar products</h2>
                <div className="text-xs text-zinc-500">You might also like these</div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => scrollSimilarBy(-1)}
                  className={`rounded-full bg-white hover:bg-zinc-50 px-3 py-2 ${silverBorder} ${silverShadowSm}`}
                  aria-label="Scroll similar products left"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => scrollSimilarBy(1)}
                  className={`rounded-full bg-white hover:bg-zinc-50 px-3 py-2 ${silverBorder} ${silverShadowSm}`}
                  aria-label="Scroll similar products right"
                >
                  ›
                </button>
              </div>
            </div>

            <div className="mt-4">
              {similarQ.isLoading ? (
                <div className="flex gap-3 overflow-hidden">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className={`w-[220px] shrink-0 rounded-2xl p-3 animate-pulse bg-white ${silverBorder} ${silverShadowSm}`}>
                      <div className="rounded-xl bg-zinc-200 h-[170px]" />
                      <div className="mt-3 h-3 bg-zinc-200 rounded w-3/4" />
                      <div className="mt-2 h-3 bg-zinc-200 rounded w-1/2" />
                    </div>
                  ))}
                </div>
              ) : (similarQ.data?.length ?? 0) === 0 ? (
                <div className="text-sm text-zinc-600">No similar products found.</div>
              ) : (
                <div
                  ref={similarRef}
                  className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scroll-smooth"
                  style={{ scrollSnapType: "x mandatory" as any }}
                >
                  {(similarQ.data || []).map((sp, idx) => {
                    const img = (sp.imagesJson || []).map(String).find((u) => isUrlish(u)) || "";
                    const hasImg = !!img;

                    const supplierMin = similarOfferQs[idx]?.data?.supplierPrice ?? null;
                    const computedRetail =
                      supplierMin != null && supplierMin > 0
                        ? applyMargin(supplierMin, marginPercent)
                        : sp.retailPrice != null
                          ? sp.retailPrice
                          : null;

                    const price = computedRetail != null ? NGN.format(computedRetail) : "—";

                    return (
                      <Link
                        key={sp.id}
                        to={`/product/${sp.id}`}
                        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                        className={`w-[220px] md:w-[240px] shrink-0 rounded-2xl bg-white transition overflow-hidden hover:shadow-md ${silverBorder} ${silverShadowSm}`}
                        style={{ scrollSnapAlign: "start" as any }}
                      >
                        <div className="relative bg-zinc-100" style={{ aspectRatio: "4 / 3" }}>
                          {hasImg ? (
                            <img
                              src={img}
                              alt=""  // ✅ blank alt like Catalog
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={(e) => {
                                // if it breaks, hide img and let background + NoImage show
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="absolute inset-0">
                              <NoImageBox className="bg-zinc-50" />
                            </div>
                          )}
                          <span
                            className={`absolute left-2 top-2 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium border ${silverShadowSm} ${sp.inStock !== false
                              ? "bg-emerald-600/10 text-emerald-700 border-emerald-600/20"
                              : "bg-rose-600/10 text-rose-700 border-rose-600/20"
                              }`}
                          >
                            {sp.inStock !== false ? "In stock" : "Out of stock"}
                          </span>
                        </div>

                        <div className="p-3">
                          <div className="text-sm font-semibold line-clamp-2">{sp.title}</div>
                          <div className="mt-1 text-sm text-zinc-800">{price}</div>
                          <div className="mt-2 text-xs text-fuchsia-700">View product →</div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}

              {!similarQ.isLoading && (similarQ.data?.length ?? 0) > 0 ? (
                <div className="mt-2 text-[11px] text-zinc-500">Tip: swipe to scroll the list.</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
