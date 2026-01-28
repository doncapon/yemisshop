import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

/* ---------------- Types ---------------- */
type Brand = { id: string; name: string } | null;

type VariantOptionWire = {
  attributeId: string;
  valueId: string;
  priceBump?: number | null;
  attribute?: { id: string; name: string; type?: string };
  value?: { id: string; name: string; code?: string | null };
};

type OfferWire = {
  id: string;
  supplierId: string;
  productId: string;
  variantId: string | null;
  currency?: string;
  inStock: boolean;
  isActive: boolean;
  availableQty: number;
  leadDays?: number | null;
  price: number | null; // supplier effective price (base+bumps) - NOT used for display
  model: "BASE" | "VARIANT";
};

type ProductWire = {
  id: string;
  title: string;
  description?: string;
  price: number | null; // base retail price (public display)
  inStock?: boolean;
  imagesJson?: string[];
  brand?: Brand;
  variants?: VariantWire[];
  offers?: OfferWire[];
  // public endpoint may return attributes as:
  // (A) { options: [...], texts: [...] }  OR
  // (B) attributes: [{attributeId,attributeName,valueId,valueName}], attributeTexts: [...]
  attributes?: {
    options?: Array<{
      attributeId: string;
      valueId: string;
      attribute?: { id: string; name: string };
      value?: { id: string; name: string };
      // allow backend shapes too:
      attributeName?: string;
      valueName?: string;
    }>;
    texts?: Array<{
      attributeId: string;
      value: string;
      attribute?: { id: string; name: string };
      attributeName?: string;
    }>;
  } | null;
};

type ValueState = {
  exists: boolean;
  stock: number;
  disabled: boolean;
  reason?: string; // "Not available" | "Out of stock"
};

type VariantWire = {
  id: string;
  sku?: string | null;
  price?: number | null;
  priceBump?: number | null; // ✅ add
  inStock?: boolean;
  imagesJson?: string[];
  options?: VariantOptionWire[];
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

function idOfOption(o: VariantOptionWire) {
  const a = o.attributeId ?? o.attribute?.id ?? "";
  const v = o.valueId ?? o.value?.id ?? "";
  return { a: String(a), v: String(v) };
}

/**
 * ✅ FIX #1 (THE REAL BUG):
 * Number(null) === 0, so your old code treated "no variant priceBump provided"
 * as "bump is 0" and NEVER fell back to summing option bumps.
 */
function variantBump(v?: VariantWire | null) {
  if (!v) return 0;

  // if variant bump exists explicitly, use it
  if (v.priceBump !== null && v.priceBump !== undefined) {
    return toNum(v.priceBump, 0);
  }

  const opts = Array.isArray(v.options) ? v.options : [];
  const bumps = opts
    .map((o) => toNum(o?.priceBump, 0))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!bumps.length) return 0;

  // ✅ If all option bumps are the same (typical when total bump is duplicated per row),
  // treat it as a single total bump.
  const allSame = bumps.every((b) => b === bumps[0]);
  if (allSame) return bumps[0];

  // otherwise, treat them as incremental bumps and sum
  return bumps.reduce((acc, n) => acc + n, 0);
}

function normalizeVariants(p: any): VariantWire[] {
  const src: any[] = Array.isArray(p?.variants) ? p.variants : [];

  const readBump = (x: any) => {
    // accept multiple backend field names
    const raw =
      x?.priceBump ??
      x?.retailPriceBump ??
      x?.retailBump ??
      x?.bump ??
      null;
    return raw != null ? Number(raw) : null;
  };

  return src.map((v: any) => ({
    id: String(v.id),
    sku: v.sku ?? null,
    price: v.price != null ? Number(v.price) : null,

    // ✅ IMPORTANT: capture admin “retail bump” even if backend names differ
    priceBump: readBump(v),

    inStock: v.inStock !== false,
    imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
    options: Array.isArray(v.options)
      ? v.options
        .map((o: any) => ({
          attributeId: String(o.attributeId ?? o.attribute?.id ?? ""),
          valueId: String(o.valueId ?? o.value?.id ?? ""),

          // ✅ capture option bump (admin-set)
          priceBump: readBump(o),

          attribute: o.attribute
            ? {
              id: String(o.attribute.id),
              name: String(o.attribute.name),
              type: o.attribute.type,
            }
            : undefined,
          value: o.value
            ? { id: String(o.value.id), name: String(o.value.name), code: o.value.code ?? null }
            : undefined,
        }))
        .filter((o: any) => o.attributeId && o.valueId)
      : [],
  }));
}

function normalizeOffers(p: any): OfferWire[] {
  const src: any[] = Array.isArray(p?.offers) ? p.offers : [];
  return src.map((o: any) => ({
    id: String(o.id),
    supplierId: String(o.supplierId),
    productId: String(o.productId),
    variantId: o.variantId ? String(o.variantId) : null,
    currency: o.currency ?? "NGN",
    inStock: o.inStock === true,
    isActive: o.isActive === true,
    availableQty: Number(o.availableQty ?? 0) || 0,
    leadDays: o.leadDays ?? null,
    price: o.price != null ? Number(o.price) : null,
    model: (o.model === "VARIANT" ? "VARIANT" : "BASE") as "BASE" | "VARIANT",
  }));
}

/**
 * ✅ Normalize attributes coming from backend.
 * Accepts:
 *  - { attributes: { options, texts } }
 *  - { attributes: [..], attributeTexts: [..] }  (your current public route shape)
 */
function normalizeAttributesIntoProductWire(p: any): ProductWire["attributes"] {
  // Case A: already has { options, texts }
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

  // Case B: public route returns attributes as array + attributeTexts separately
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

  // ✅ Prefer explicit saved defaults from backend if present
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

  // ✅ Fallback: use product.attributes.options
  const opts: any[] = Array.isArray(p?.attributes?.options) ? p.attributes.options : [];
  for (const row of opts) {
    const a = String(row?.attributeId ?? row?.attribute?.id ?? "").trim();
    const v = String(row?.valueId ?? row?.value?.id ?? "").trim();
    if (a && v && !out[a]) out[a] = v;
  }

  return out;
}

/* Cart helpers */
type CartItemLite = {
  kind?: "BASE" | "VARIANT"; // ✅ NEW
  productId: string;
  variantId: string | null;
  title: string;
  qty: number;
  unitPrice: number;
  totalPrice: number;
  selectedOptions?: {
    attributeId: string;
    attribute: string;
    valueId?: string;
    value: string;
  }[];
  image?: string;
};

const CART_KEY = "cart";

const loadCartLS = (): CartItemLite[] => {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveCartLS = (items: CartItemLite[]) => localStorage.setItem(CART_KEY, JSON.stringify(items));

const sameLine = (a: CartItemLite, productId: string, variantId: string | null) =>
  a.productId === productId && (a.variantId ?? null) === (variantId ?? null);

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

/* ---------------- Component ---------------- */
export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const productQ = useQuery({
    queryKey: ["product", id],
    queryFn: async () => {
      const { data } = await api.get(`/api/products/${id}`, {
        params: { include: "brand,variants,attributes,offers" },
      });

      const payload = (data as any)?.data ?? data ?? {};
      const p = (payload as any)?.data ?? payload;

      const variants = normalizeVariants(p);
      const offers = normalizeOffers(p);

      // base offer availability
      const baseOffers = offers.filter((o) => o.model === "BASE");
      const baseStockQty = baseOffers
        .filter((o) => o.isActive && o.inStock && o.availableQty > 0)
        .reduce((acc, o) => acc + (o.availableQty ?? 0), 0);

      // ---------------------- STOCK (FIXED) ----------------------
      // Treat BASE offer qty as the primary stock pool.
      // Variant offer qty (if >0) acts as an extra constraint (min).
      const baseQtyBySupplier: Record<string, number> = {};
      const stockByVariantId: Record<string, number> = {};

      // 1) Base pool by supplier
      for (const o of offers) {
        if (o.model !== "BASE") continue;
        if (!o.isActive || !o.inStock) continue;

        const qty = Number(o.availableQty ?? 0) || 0;
        if (qty <= 0) continue;

        baseQtyBySupplier[o.supplierId] = (baseQtyBySupplier[o.supplierId] ?? 0) + qty;
      }

      // 2) Variant pool per variantId (per supplier)
      // Effective qty per supplier is:
      // - if variant.availableQty > 0: min(baseQty, variantQty) when base exists, else variantQty
      // - else: baseQty (when base exists), else 0
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

      const product: ProductWire = {
        id: String(p.id),
        title: String(p.title ?? ""),
        description: p.description ?? "",
        price: p.price != null ? Number(p.price) : null, // base retail
        inStock: p.inStock !== false,
        imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
        brand: p.brand ? { id: String(p.brand.id), name: String(p.brand.name) } : null,
        variants,
        offers,
        attributes: normalizeAttributesIntoProductWire(p),
      };

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
      };
    },
    staleTime: 60_000,
  });

  const product = productQ.data?.product;
  const stockByVariantId = productQ.data?.stockByVariantId ?? {};
  const totalStockQty = productQ.data?.totalStockQty ?? 0;

  const baseStockQty = productQ.data?.baseStockQty ?? 0;
  const hasBaseOffer = productQ.data?.hasBaseOffer ?? false;
  const sellableVariantIds = productQ.data?.sellableVariantIds ?? new Set<string>();
  const baseDefaultsFromAttributes = productQ.data?.baseDefaultsFromAttributes ?? {};

  const canBuyBase = hasBaseOffer && baseStockQty > 0;

  const allVariants = product?.variants ?? [];

  // variants that actually have ACTIVE+inStock supplier offers
  const sellableVariants = React.useMemo(() => {
    if (!allVariants.length) return [];
    return allVariants.filter((v) => sellableVariantIds.has(v.id));
  }, [allVariants, sellableVariantIds]);

  /**
   * ✅ IMPORTANT CHANGE:
   * Build dropdown axes & combinations from ALL variants (not only sellable ones),
   * so options don't "disappear" just because there isn't a variant offer for them.
   *
   * Availability is still gated using stockByVariantId when choosing a purchasable variant.
   */
  const variantsForOptions = allVariants;

  /**
   * ✅ Axes:
   * 1) Prefer building from variant.options (best for permutations)
   * 2) Fallback to product.attributes.options if variant.options are missing
   */
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

    // 1) variants (all combos)
    for (const v of variantsForOptions || []) {
      for (const o of v.options || []) {
        const aId = String(o.attributeId ?? o.attribute?.id ?? "").trim();
        const vId = String(o.valueId ?? o.value?.id ?? "").trim();
        const aName = String(o.attribute?.name ?? "Attribute");
        const vName = String(o.value?.name ?? "Value");
        add(aId, aName, vId, vName);
      }
    }

    // 2) ✅ merge in base attributeOptions (your “Attributes” section in admin)
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

  /**
   * ✅ Scoped pair sets (only compare option pairs for visible axes)
   */
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

  /* ---------------- Base defaults ---------------- */
  const baseDefaults = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const ax of axes) out[ax.id] = "";

    // 1) Apply saved defaults (from backend attributeSelections) FIRST
    for (const ax of axes) {
      const v = baseDefaultsFromAttributes?.[ax.id];
      if (v) out[ax.id] = String(v);
    }

    // 2) If still empty, default to the best real variant (valid combo)
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

  /* ---------------- Selection state ---------------- */
  const [selected, setSelected] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!product || !axes.length) {
      setSelected({});
      return;
    }
    setSelected(() => {
      const next: Record<string, string> = {};
      for (const ax of axes) next[ax.id] = baseDefaults[ax.id] ?? "";
      return next;
    });
  }, [product?.id, axes, baseDefaults]);

  const isSelectionCompatible = React.useCallback(
    (draft: Record<string, string>) => {
      const entries = Object.entries(draft).filter(([, v]) => !!String(v || "").trim());
      if (!entries.length) return true;

      if (!variantPairSetsScoped.length) return true;

      return variantPairSetsScoped.some(({ set }) =>
        entries.every(([aid, vid]) => set.has(`${aid}:${vid}`))
      );
    },
    // ✅ FIX #2: correct dependency (was variantPairSets)
    [variantPairSetsScoped]
  );

  /* ---------------- Dropdown filtering ---------------- */
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

  /* ---------------- Selection resolution ---------------- */
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

  /* ---------------- Pricing (RETAIL display) ---------------- */
  const computed = React.useMemo(() => {
    const baseRetail = toNum(product?.price, 0);

    // BASE view: exactly base defaults
    if (axes.length > 0 && isAtBaseDefaults(selected)) {
      return {
        base: baseRetail,
        final: baseRetail,
        matchedVariant: null as VariantWire | null,
        exactMatch: false,
        exactSellable: false,
        mode: "BASE" as const,
      };
    }

    // ✅ NEW: "complete" means "selection identifies a real variant",
    // not "all axes have a value".
    const pickedPairs = selectionPairsOf(selected); // only non-empty
    if (!pickedPairs.length) {
      return {
        base: baseRetail,
        final: baseRetail,
        matchedVariant: null as VariantWire | null,
        exactMatch: false,
        exactSellable: false,
        mode: "VARIANT" as const,
      };
    }

    // Find an EXACT variant match for the picked pairs:
    // (variant must contain all picked pairs AND have no extra pairs)
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

      if (set.size !== selPairs.size) continue; // exact identity for this selection
      matched = v;
      break;
    }

    if (!matched) {
      // Not enough info (or invalid combo) to identify a variant uniquely
      return {
        base: baseRetail,
        final: baseRetail,
        matchedVariant: null as VariantWire | null,
        exactMatch: false,
        exactSellable: false,
        mode: "VARIANT" as const,
      };
    }

    const bump = variantBump(matched);
    const final = baseRetail + bump;
    const sellable = (stockByVariantId[matched.id] ?? 0) > 0;

    return {
      base: baseRetail,
      final,
      matchedVariant: matched,
      exactMatch: true,
      exactSellable: sellable,
      mode: "VARIANT" as const,
    };
  }, [product?.price, axes, selected, isAtBaseDefaults, variantPairSetsScoped, stockByVariantId]);

  /* ---------------- Purchase gating ---------------- */
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
      return {
        disableAddToCart: true,
        helperNote:
          "Base offer is not available. Please select a variant combo that has an active supplier offer.",
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
  ]);

  /* ---------------- Toast ---------------- */
  const [toast, setToast] = React.useState<{ show: boolean; title: string; img?: string } | null>(
    null
  );
  const hideToastRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------------- Images / Zoom ---------------- */
  const images = React.useMemo(
    () => (product?.imagesJson?.length ? product.imagesJson! : ["/placeholder.svg"]),
    [product]
  );

  const currentSelectionQty = React.useMemo(() => {
    if (purchaseMeta.mode === "BASE") return baseStockQty;
    const vid = purchaseMeta.variantId;
    if (!vid) return 0;
    return stockByVariantId[vid] ?? 0;
  }, [purchaseMeta.mode, purchaseMeta.variantId, baseStockQty, stockByVariantId]);

  /* ---------------- Availability badge (PDP standard) ---------------- */
  const availabilityBadge = React.useMemo(() => {
    const qty = currentSelectionQty;

    // ready to buy
    if (!purchaseMeta.disableAddToCart && qty > 0) {
      return {
        text: `In stock${Number.isFinite(qty) ? ` • ${qty}` : ""}`,
        cls: "bg-emerald-600/10 text-emerald-700 border-emerald-600/20",
      };
    }

    // user chose base defaults but base offer missing
    if (purchaseMeta.mode === "BASE" && !canBuyBase) {
      return {
        text: "Out of stock",
        cls: "bg-rose-600/10 text-rose-700 border-rose-600/20",
      };
    }

    // user has an exact variant selected but it’s not sellable
    if (purchaseMeta.mode === "VARIANT" && selectionInfo.exact.length > 0) {
      return {
        text: "Out of stock",
        cls: "bg-rose-600/10 text-rose-700 border-rose-600/20",
      };
    }

    // otherwise selection isn’t complete enough to guarantee availability
    return {
      text: "Select options",
      cls: "bg-amber-600/10 text-amber-700 border-amber-600/20",
    };
  }, [
    currentSelectionQty,
    purchaseMeta.disableAddToCart,
    purchaseMeta.mode,
    canBuyBase,
    selectionInfo.exact.length,
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
  }, [
    axes,
    selected,
    baseDefaults,
    variantPairSetsScoped, // ✅ FIX #4: dependency + source
    stockByVariantId,
    baseStockQty,
  ]);

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
  const [naturalSize, setNaturalSize] = React.useState({ w: 0, h: 0 });
  const [hoverPx, setHoverPx] = React.useState({ x: 0, y: 0 });
  const [showZoom, setShowZoom] = React.useState(false);

  const ZOOM_REQUEST = 2.5;
  const ZOOM_PANE = { w: 360, h: 360 };
  const [zoomAnchor, setZoomAnchor] = React.useState<{ top: number; left: number } | null>(null);

  const updateZoomAnchor = React.useCallback(() => {
    const img = mainImgRef.current;
    if (!img) return;
    const r = img.getBoundingClientRect();

    // Default: to the right of the image
    let left = r.right + 12;
    let top = r.top;

    // Keep inside viewport horizontally
    const pad = 12;
    const paneW = ZOOM_PANE.w;
    const paneH = ZOOM_PANE.h;

    if (left + paneW + pad > window.innerWidth) {
      // put it on the left if it would overflow
      left = Math.max(pad, r.left - paneW - 12);
    }

    // Keep inside viewport vertically
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
  const maxScaleW = naturalSize.w > 0 && imgBox.w > 0 ? naturalSize.w / imgBox.w : Infinity;
  const maxScaleH = naturalSize.h > 0 && imgBox.h > 0 ? naturalSize.h / imgBox.h : Infinity;
  const MAX_NATIVE_SCALE = Math.max(1, Math.min(maxScaleW, maxScaleH));

  let EFFECTIVE_ZOOM = Math.max(1, Math.min(ZOOM_REQUEST, MAX_NATIVE_SCALE));
  if (hasBox) {
    const cover = Math.max(ZOOM_PANE.w / imgBox.w, ZOOM_PANE.h / imgBox.h);
    if (EFFECTIVE_ZOOM < cover) EFFECTIVE_ZOOM = cover;
  }

  const zoomImgWidth = (hasBox ? imgBox.w : 0) * EFFECTIVE_ZOOM;
  const zoomImgHeight = (hasBox ? imgBox.h : 0) * EFFECTIVE_ZOOM;

  const relX = hasBox ? hoverPx.x / imgBox.w : 0.5;
  const relY = hasBox ? hoverPx.y / imgBox.h : 0.5;

  const maxOffsetX = Math.max(zoomImgWidth - ZOOM_PANE.w, 0);
  const maxOffsetY = Math.max(zoomImgHeight - ZOOM_PANE.h, 0);

  let offsetX = relX * zoomImgWidth - ZOOM_PANE.w / 2;
  let offsetY = relY * zoomImgHeight - ZOOM_PANE.h / 2;

  offsetX = Math.max(0, Math.min(offsetX, maxOffsetX));
  offsetY = Math.max(0, Math.min(offsetY, maxOffsetY));

  /* ---------------- Add to cart ---------------- */
  const handleAddToCart = React.useCallback(async () => {
    if (!product) return;
    if (purchaseMeta.disableAddToCart) return;

    const variantId = purchaseMeta.mode === "VARIANT" ? purchaseMeta.variantId : null;

    // ✅ store attributes for BOTH base and variant lines
    const selectedOptionsWire = Object.entries(selected)
      .filter(([, v]) => !!String(v || "").trim())
      .map(([attributeId, valueId]) => ({ attributeId, valueId }));

    const unitPriceClient = purchaseMeta.mode === "VARIANT" ? computed.final : computed.base;

    try {
      await api.post("/api/cart/items", {
        productId: product.id,
        variantId,
        quantity: 1,
        selectedOptions: selectedOptionsWire,
        unitPriceClient,
      });
    } catch {
      // ignore; still update local
    } finally {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
    }

    const { attrNameById, valueNameByAttrId } = buildLabelMaps(axes);
    const selectedOptionsLabeled = selectedOptionsWire.map(({ attributeId, valueId }) => ({
      attributeId,
      attribute: attrNameById.get(attributeId) ?? "",
      valueId,
      value: valueId ? valueNameByAttrId.get(attributeId)?.get(valueId) ?? "" : "",
    }));

    const newLine: CartItemLite = {
      kind: purchaseMeta.mode, // ✅ NEW
      productId: product.id,
      variantId,
      title: product.title ?? "",
      qty: 1,
      unitPrice: Number(unitPriceClient) || 0,
      totalPrice: Number(unitPriceClient) || 0,
      selectedOptions: selectedOptionsLabeled, // ✅ now base lines will have it too
      image: (product.imagesJson || [])[0],
    };

    const cart = loadCartLS();
    const idx = cart.findIndex((c) => sameLine(c, newLine.productId, newLine.variantId));
    if (idx >= 0) {
      const unit = Number.isFinite(cart[idx].unitPrice) ? cart[idx].unitPrice : newLine.unitPrice;
      const nextQty = cart[idx].qty + 1;
      cart[idx] = { ...cart[idx], qty: nextQty, unitPrice: unit, totalPrice: unit * nextQty };
    } else {
      cart.push(newLine);
    }
    saveCartLS(cart);

    setToast({ show: true, title: "Added to cart", img: (product.imagesJson || [])[0] });

    if (hideToastRef.current) window.clearTimeout(hideToastRef.current);
    hideToastRef.current = window.setTimeout(
      () => setToast((t) => (t ? { ...t, show: false } : t)),
      3000
    );
  }, [product, purchaseMeta, selected, computed.final, computed.base, axes, queryClient]);

  React.useEffect(
    () => () => {
      if (hideToastRef.current) {
        clearTimeout(hideToastRef.current);
        hideToastRef.current = null;
      }
    },
    []
  );

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

  /* ---------------- Render ---------------- */
  if (productQ.isLoading) {
    return (
      <SiteLayout>
        <div className="p-6">Loading product…</div>
      </SiteLayout>
    );
  }

  if (productQ.isError || !product) {
    return (
      <SiteLayout>
        <div className="p-6 text-rose-600">
          Could not load product.
          <div className="text-xs opacity-70 mt-1">
            {String((productQ.error as any)?.message || "Unknown error")}
          </div>
        </div>
      </SiteLayout>
    );
  }

  const priceLabel = NGN.format(computed.final);
  const CHIP_THRESHOLD = 8; // <= 8 values => chips, else dropdown

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
            className={`px-3 py-2 rounded-xl border text-base md:text-lg
            ${!value ? "ring-2 ring-fuchsia-500 border-fuchsia-500" : "bg-white hover:bg-zinc-50"}`}
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
                className={`px-3 py-2 rounded-xl border text-base md:text-lg transition flex items-center gap-2
                ${active ? "ring-2 ring-fuchsia-500 border-fuchsia-500" : "bg-white hover:bg-zinc-50"}
                ${st.disabled ? "opacity-60 cursor-not-allowed hover:bg-white" : ""}`}
              >
                <span className={st.disabled ? "line-through" : ""}>{opt.name}</span>

                {st.disabled && st.reason ? (
                  <span className="text-xs px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
                    {st.reason}
                  </span>
                ) : st.stock > 0 ? (
                  <span className="text-xs px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                    {st.stock}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      );
    }

    // dropdown path unchanged…
    return (
      <Select value={value} onValueChange={(v) => onChange(v === "__NONE__" ? "" : v)}>
        <SelectTrigger className="h-12 rounded-xl text-base md:text-lg">
          <SelectValue placeholder={`No ${axis.name.toLowerCase()}`} />
        </SelectTrigger>

        <SelectContent className="text-base md:text-lg">
          <SelectItem value="__NONE__">{`No ${axis.name.toLowerCase()}`}</SelectItem>
          {axis.values.map((opt) => {
            const st = states[opt.id] ?? { exists: true, stock: 0, disabled: false };
            const label =
              st.disabled && st.reason
                ? `${opt.name} — ${st.reason}`
                : st.stock > 0
                  ? `${opt.name} (${st.stock})`
                  : opt.name;

            return (
              <SelectItem key={opt.id} value={opt.id} disabled={st.disabled} textValue={label}>
                {label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    );
  }

  return (
    <SiteLayout>
      <>
        {/* Toast */}
        {toast?.show &&
          createPortal(
            <div
              className="fixed top-4 right-4 z-[99999] w-[320px] rounded-2xl border shadow-lg bg-white p-3"
              onMouseEnter={() => {
                if (hideToastRef.current) window.clearTimeout(hideToastRef.current);
              }}
              onMouseLeave={() => {
                hideToastRef.current = window.setTimeout(
                  () => setToast((t) => (t ? { ...t, show: false } : t)),
                  1500
                );
              }}
              role="status"
              aria-live="polite"
            >
              <div className="flex gap-3">
                <img
                  src={toast.img || "/placeholder.svg"}
                  alt="item"
                  className="w-14 h-14 rounded-xl border object-cover"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{toast.title}</div>
                  <div className="text-xs text-zinc-600 truncate">{product.title}</div>
                  <div className="mt-1 text-sm font-medium">{priceLabel}</div>

                  <div className="mt-2 flex gap-2">
                    <button
                      className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white text-xs"
                      onClick={() => navigate("/cart")}
                      type="button"
                    >
                      View cart
                    </button>
                    <button
                      className="px-3 py-1.5 rounded-lg border text-xs hover:bg-zinc-50"
                      onClick={() => setToast((t) => (t ? { ...t, show: false } : t))}
                      type="button"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}

        <div className="max-w-6xl mx-auto p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Images */}
          <div className="space-y-3">
            <div
              className="relative mx-auto"
              style={{ maxWidth: "90%" }}
              onMouseEnter={() => {
                setShowZoom(true);
                setPaused(true);
                updateZoomAnchor();
              }}
              onMouseLeave={() => {
                setShowZoom(false);
                setPaused(false);
              }}
              onMouseMove={onMouseMove}
            >
              <div
                className="rounded-2xl overflow-hidden bg-zinc-100 border"
                style={{ aspectRatio: "1 / 1" }}
              >
                <img
                  ref={mainImgRef}
                  src={images[mainIndex]}
                  alt={product.title}
                  className="w-full h-full object-cover cursor-zoom-in"
                  onLoad={handleImageLoad}
                  onError={(e) => (e.currentTarget.style.opacity = "0.25")}
                />
              </div>

              {/* ✅ Availability badge on image (PDP standard) */}
              <span
                className={`absolute left-3 top-3 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border ${availabilityBadge.cls}`}
              >
                {availabilityBadge.text}
              </span>

              {showZoom &&
                hasBox &&
                zoomAnchor &&
                createPortal(
                  <div
                    className="hidden md:block rounded-xl border shadow bg-white overflow-hidden pointer-events-none z-[9999]"
                    style={{
                      position: "fixed",
                      top: zoomAnchor.top,
                      left: zoomAnchor.left,
                      width: ZOOM_PANE.w,
                      height: ZOOM_PANE.h,
                    }}
                  >
                    <img
                      src={images[mainIndex]}
                      alt="zoom"
                      draggable={false}
                      style={{
                        position: "absolute",
                        width: `${zoomImgWidth}px`,
                        height: `${zoomImgHeight}px`,
                        transform: `translate(${-offsetX}px, ${-offsetY}px)`,
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
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 hover:bg-white border shadow px-2 py-1"
                    aria-label="Previous image"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => setMainIndex((i) => (i + 1) % images.length)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 hover:bg-white border shadow px-2 py-1"
                    aria-label="Next image"
                  >
                    ›
                  </button>
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                    {images.map((_, i) => (
                      <span
                        key={i}
                        onClick={() => setMainIndex(i)}
                        className={`h-1.5 w-1.5 rounded-full cursor-pointer ${i === mainIndex ? "bg-fuchsia-600" : "bg-white/70 border"
                          }`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Thumbnails */}
            <div
              className="flex items-center justify-center gap-2"
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
            >
              <button
                type="button"
                onClick={() => setMainIndex((i) => (i - 1 + images.length) % images.length)}
                className="rounded-full border px-2 py-1 text-sm bg-white hover:bg-zinc-50"
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
                      alt={`thumb-${absoluteIndex}`}
                      onClick={() => setMainIndex(absoluteIndex)}
                      className={`w-24 h-20 rounded-lg border object-cover select-none cursor-pointer ${isActive
                          ? "ring-2 ring-fuchsia-500 border-fuchsia-500"
                          : "hover:opacity-90"
                        }`}
                      onError={(e) => (e.currentTarget.style.opacity = "0.25")}
                    />
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setMainIndex((i) => (i + 1) % images.length)}
                className="rounded-full border px-2 py-1 text-sm bg-white hover:bg-zinc-50"
                aria-label="Next thumbnails"
              >
                ›
              </button>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-semibold">{product.title}</h1>
              {product.brand?.name && <div className="text-sm text-zinc-600">{product.brand.name}</div>}
            </div>

            <div className="rounded-2xl bg-zinc-50 border p-4">
              {/* ✅ Availability badge near price (PDP standard) */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-zinc-500">Current price (retail)</div>
                  <div className="text-3xl font-bold">{priceLabel}</div>
                </div>

                <span
                  className={`shrink-0 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border ${availabilityBadge.cls}`}
                >
                  {availabilityBadge.text}
                </span>
              </div>

              <div className="text-xs text-zinc-500 mt-1">
                Base: {NGN.format(toNum(product.price, 0))}
                {purchaseMeta.mode === "VARIANT" && purchaseMeta.variantId && (
                  <> • Variant price = base + option bumps</>
                )}
              </div>

              {canBuyBase ? (
                <div className="mt-2 text-[11px] text-emerald-700">
                  <div className="text-[11px] text-zinc-600">
                    {purchaseMeta.mode === "BASE" ? (
                      canBuyBase ? (
                        <>Available (base): {currentSelectionQty}</>
                      ) : (
                        <>Base offer not available</>
                      )
                    ) : purchaseMeta.variantId ? (
                      <>Available (this variant): {currentSelectionQty}</>
                    ) : (
                      <>Select a complete sellable combination to see availability</>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-amber-700">
                  Base offer is not available. Select a variant combo with an active supplier offer.
                </div>
              )}
            </div>

            {/* Variant selects */}
            {axes.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-zinc-700">Choose options</div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelected({ ...baseDefaults })}
                        className="px-2 py-1 text-[10px] rounded-lg border bg-white hover:bg-zinc-50"
                        title="Select the base product default options"
                      >
                        Choose base option
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelected(buildEmptySelection(axes))}
                        className="px-2 py-1 text-[10px] rounded-lg border bg-white hover:bg-zinc-50"
                        title="Clear selections (No variant)"
                      >
                        Reset all variants(None)
                      </button>
                    </div>
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
                  <div className="text-[11px] mt-2 px-2 py-2 rounded-md border bg-zinc-50 text-zinc-700">
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

            {/* CTAs */}
            <div className="pt-2 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={purchaseMeta.disableAddToCart}
                className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 shadow-sm active:scale-[0.99] transition focus:outline-none focus:ring-4
                  ${purchaseMeta.disableAddToCart
                    ? "bg-zinc-300 text-zinc-600 cursor-not-allowed focus:ring-zinc-200"
                    : "bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white hover:shadow-md focus:ring-fuchsia-300/40"
                  }`}
              >
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                Add to cart — {NGN.format(computed.final)}
              </button>

              <button
                type="button"
                onClick={() => navigate("/cart")}
                className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 border bg-white text-zinc-900 hover:bg-zinc-50 active:scale-[0.99] transition focus:outline-none focus:ring-4 focus:ring-zinc-300/40"
              >
                Go to Cart
              </button>
            </div>

            {/* Description */}
            <div className="pt-2">
              <h2 className="text-base font-semibold mb-1">Description</h2>
              <p className="text-sm text-zinc-700 whitespace-pre-line">{product.description}</p>
            </div>

            {import.meta.env.DEV && (
              <div className="text-[10px] text-zinc-500">
                totalStockQty: {totalStockQty}
              </div>
            )}
          </div>
        </div>
      </>
    </SiteLayout>
  );
}
