// src/pages/supplier/SupplierEditProduct.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ImagePlus, Save, Trash2, Plus, Package } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { useCatalogMeta } from "../../hooks/useCatalogMeta";

/* =========================================================
   Helpers
========================================================= */

function isUrlish(s?: string) {
  return !!s && /^(https?:\/\/|data:image\/|\/)/i.test(s);
}
function parseUrlList(s: string) {
  return s
    .split(/[\n,]/g)
    .map((t) => t.trim())
    .filter(Boolean);
}
function toMoneyNumber(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function toIntNonNeg(v: any) {
  if (v === "" || v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}
function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function rowHasAnySelection(selections: Record<string, string>) {
  return Object.values(selections || {}).some((v) => !!String(v || "").trim());
}

/**
 * ✅ Partial selections are allowed.
 * Duplicate key is based on whatever is selected.
 * - none selected => DEFAULT
 * - partial => includes only selected pairs
 */
function sparseComboKey(selections: Record<string, string>, attrOrder: string[]) {
  const parts: string[] = [];
  for (const aid of attrOrder) {
    const vid = String(selections?.[aid] || "").trim();
    if (vid) parts.push(`${aid}=${vid}`);
  }
  return parts.length ? parts.join("|") : "DEFAULT";
}

function formatComboLabel(
  selections: Record<string, string>,
  attrOrder: string[],
  attrNameById: Map<string, string>,
  valueNameById: Map<string, string>
) {
  const pairs: string[] = [];
  for (const aid of attrOrder) {
    const vid = String(selections?.[aid] || "").trim();
    if (!vid) continue;
    const an = attrNameById.get(aid) ?? aid;
    const vn = valueNameById.get(vid) ?? vid;
    pairs.push(`${an}=${vn}`);
  }
  return pairs.length ? pairs.join(", ") : "DEFAULT (no options selected)";
}

function Card({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border bg-white/90 shadow-sm overflow-hidden ${className}`}>
      <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">{title}</div>
          {subtitle ? <div className="text-[11px] sm:text-xs text-zinc-500 mt-0.5">{subtitle}</div> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

/* =========================================================
   Types
========================================================= */

type SupplierProductDetail = {
  id: string;
  title: string;
  description?: string | null;
  sku: string;
  status: string;

  imagesJson: any;

  categoryId?: string | null;
  brandId?: string | null;
  inStock: boolean;

  retailPrice?: number | null;
  autoPrice?: any;

  offer?: {
    id?: string;
    basePrice: number;
    currency?: string;
    inStock?: boolean;
    isActive?: boolean;
    leadDays?: number | null;
    availableQty?: number;
  } | null;

  supplierVariantOffers?: Array<{
    id: string;
    variantId: string;
    unitPrice: number;
    availableQty: number;
    inStock?: boolean;
    isActive?: boolean;
    currency?: string;
    leadDays?: number | null;
  }>;

  pendingOfferChanges?: Array<{
    id: string;
    scope: "BASE_OFFER" | "VARIANT_OFFER" | string;
    supplierProductOfferId?: string | null;
    supplierVariantOfferId?: string | null;
    variantId?: string | null;
    proposedPatch?: any;
    requestedAt?: string;
  }>;

  variants?: Array<any>;
  attributeValues?: Array<{ attributeId: string; valueId: string }>;
  attributeTexts?: Array<{ attributeId: string; value: string }>;
  attributeSelections?: Array<any>;

  attributeOptions?: Array<any>;
  ProductAttributeText?: Array<any>;

  ProductVariant?: Array<any>;
  productVariants?: Array<any>;
  images?: any;
  imageUrls?: any;
};

type VariantRow = {
  id: string;
  variantId?: string;
  selections: Record<string, string>;
  availableQty: string;
  isExisting?: boolean;
  comboLabel?: string;
  rawOptions?: Array<{ attributeId: string; valueId: string }>;
  variantOfferId?: string;
};

type DupInfo = {
  duplicateRowIds: Set<string>;
  duplicateLabels: string[];
  explain: string | null;
};

/* =========================
   ✅ Normalizers
========================= */

type AttrSelection =
  | { attributeId: string; text?: string; valueId?: string; valueIds?: string[] }
  | any;

function normalizeAttributeSelections(p: any) {
  const selections: AttrSelection[] =
    (Array.isArray(p?.attributeSelections) && p.attributeSelections) ||
    (Array.isArray(p?.AttributeSelections) && p.AttributeSelections) ||
    [];

  const texts: Array<{ attributeId: string; value: string }> = [];
  const values: Array<{ attributeId: string; valueId: string }> = [];

  for (const s of selections) {
    const attributeId = String(s?.attributeId ?? s?.attribute?.id ?? "").trim();
    if (!attributeId) continue;

    if (s?.text != null && String(s.text).trim() !== "") {
      texts.push({ attributeId, value: String(s.text) });
      continue;
    }

    if (s?.valueId != null && String(s.valueId).trim() !== "") {
      values.push({ attributeId, valueId: String(s.valueId) });
      continue;
    }

    if (Array.isArray(s?.valueIds) && s.valueIds.length) {
      for (const vid of s.valueIds) {
        if (vid == null) continue;
        const v = String(vid).trim();
        if (v) values.push({ attributeId, valueId: v });
      }
    }
  }

  const legacyTexts = Array.isArray(p?.attributeTexts) ? p.attributeTexts : [];
  for (const t of legacyTexts) {
    const attributeId = String(t?.attributeId ?? "").trim();
    const value = String(t?.value ?? "").trim();
    if (attributeId && value) texts.push({ attributeId, value });
  }

  const legacyVals = Array.isArray(p?.attributeValues) ? p.attributeValues : [];
  for (const av of legacyVals) {
    const attributeId = String(av?.attributeId ?? "").trim();
    const valueId = String(av?.valueId ?? "").trim();
    if (attributeId && valueId) values.push({ attributeId, valueId });
  }

  const relTexts =
    (Array.isArray(p?.ProductAttributeText) && p.ProductAttributeText) ||
    (Array.isArray(p?.productAttributeText) && p.productAttributeText) ||
    [];

  for (const t of relTexts) {
    const attributeId = String(t?.attributeId ?? t?.attribute?.id ?? "").trim();
    const value = String(t?.value ?? "").trim();
    if (attributeId && value) texts.push({ attributeId, value });
  }

  const relOptions =
    (Array.isArray(p?.attributeOptions) && p.attributeOptions) ||
    (Array.isArray(p?.ProductAttributeOption) && p.ProductAttributeOption) ||
    (Array.isArray(p?.productAttributeOptions) && p.productAttributeOptions) ||
    [];

  for (const o of relOptions) {
    const attributeId = String(o?.attributeId ?? o?.attribute?.id ?? "").trim();
    const valueId = String(o?.valueId ?? o?.value?.id ?? o?.attributeValueId ?? "").trim();
    if (attributeId && valueId) values.push({ attributeId, valueId });
  }

  return { texts, values };
}

function tryParseJson(v: any) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeImages(raw: any): string[] {
  const candidates = [raw?.imagesJson, raw?.images, raw?.imageUrls, raw?.productImages, raw?.Images];

  for (const c of candidates) {
    if (!c) continue;

    if (typeof c === "string") {
      const parsed = tryParseJson(c);
      if (Array.isArray(parsed)) {
        const arr = parsed
          .map((x) => (typeof x === "string" ? x : x?.url || x?.path || x?.src))
          .filter(Boolean);
        if (arr.length) return arr;
      }

      const list = parseUrlList(c).filter(isUrlish);
      if (list.length) return list;
      continue;
    }

    if (Array.isArray(c)) {
      const arr = c
        .map((x) => (typeof x === "string" ? x : x?.url || x?.path || x?.src))
        .filter(Boolean);
      if (arr.length) return arr;
      continue;
    }

    if (typeof c === "object") {
      const maybeUrls = (c as any)?.urls || (c as any)?.items || (c as any)?.data;
      if (Array.isArray(maybeUrls)) {
        const arr = maybeUrls
          .map((x) => (typeof x === "string" ? x : (x as any)?.url || (x as any)?.path || (x as any)?.src))
          .filter(Boolean);
        if (arr.length) return arr;
      }
    }
  }

  return [];
}

function extractVariantOptions(v: any): Array<{ attributeId: string; valueId: string }> {
  const out: Array<{ attributeId: string; valueId: string }> = [];

  const candidates = [
    v?.options,
    v?.variantOptions,
    v?.VariantOption,
    v?.ProductVariantOption,
    v?.attributeValues,
    v?.AttributeValues,
  ];

  for (const c of candidates) {
    if (!c) continue;
    if (!Array.isArray(c)) continue;

    for (const o of c) {
      const aid =
        (o as any)?.attributeId ??
        (o as any)?.attribute?.id ??
        (o as any)?.attributeValue?.attributeId ??
        (o as any)?.Attribute?.id;
      const vid =
        (o as any)?.valueId ??
        (o as any)?.value?.id ??
        (o as any)?.attributeValueId ??
        (o as any)?.AttributeValue?.id ??
        (o as any)?.attributeValue?.valueId ??
        (o as any)?.attributeValue?.id;

      if (aid && vid) out.push({ attributeId: String(aid), valueId: String(vid) });
    }

    if (out.length) return out;
  }

  return out;
}

function normalizeVariants(raw: any): any[] {
  const candidates = [
    raw?.variants,
    raw?.ProductVariant,
    raw?.productVariants,
    raw?.ProductVariants,
    raw?.ProductVariant?.items,
    raw?.productVariants?.items,
  ];

  for (const c of candidates) {
    if (!c) continue;

    if (typeof c === "string") {
      const parsed = tryParseJson(c);
      if (Array.isArray(parsed)) return parsed;
      continue;
    }

    if (Array.isArray(c)) return c;

    if (typeof c === "object" && Array.isArray((c as any)?.items)) return (c as any).items;
  }

  return [];
}

function buildPendingMaps(p: any) {
  const pending: any[] = Array.isArray(p?.pendingOfferChanges) ? p.pendingOfferChanges : [];
  const base = pending.find((x) => String(x?.scope || "").toUpperCase() === "BASE_OFFER") || null;

  const variantMap = new Map<string, any>();
  for (const x of pending) {
    if (String(x?.scope || "").toUpperCase() !== "VARIANT_OFFER") continue;
    const vid = String(x?.variantId ?? "").trim();
    if (!vid) continue;
    variantMap.set(vid, x);
  }

  return { base, variantMap };
}

/* =========================================================
   Component
========================================================= */

export default function SupplierEditProduct() {
  const nav = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();

  // ✅ cookie-auth session
  const hydrated = useAuthStore((s: any) => s.hydrated) as boolean;
  const role = useAuthStore((s: any) => s.user?.role) as string | undefined;

  useEffect(() => {
    useAuthStore.getState().bootstrap?.().catch?.(() => null);
  }, []);

  // ✅ if opened from catalog: offers-only mode
  const offersOnly = String(searchParams.get("scope") ?? "") === "offers_mine";

  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [dupWarn, setDupWarn] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [retailPrice, setRetailPrice] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [description, setDescription] = useState("");
  const [availableQty, setAvailableQty] = useState<string>("0");

  const [imageUrls, setImageUrls] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string | string[]>>({});
  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);

  const initialBasePriceRef = useRef<number>(0);

  const [activeBasePrice, setActiveBasePrice] = useState<number>(0);
  const [pendingBasePatch, setPendingBasePatch] = useState<any | null>(null);
  const [pendingVariantPatchByVariantId, setPendingVariantPatchByVariantId] = useState<Map<string, any>>(
    () => new Map()
  );

  const initialSnapshotRef = useRef<{
    id: string;
    title: string;
    sku: string;
    categoryId: string | null;
    brandId: string | null;
    description: string;
    images: string[];
    attr: Record<string, string | string[]>;
    multiAttrValues: Record<string, Set<string>>;
    existingVariantIds: Set<string>;
  } | null>(null);

  const hydratedBaseForIdRef = useRef<string | null>(null);
  const hydratedAttrsForIdRef = useRef<string | null>(null);

  const isSupplier = role === "SUPPLIER";

  const ngn = useMemo(
    () =>
      new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 2,
      }),
    []
  );

  // ✅ cookie-auth: meta loads once session is hydrated
  const { categories, brands, attributes, categoriesQ, brandsQ } = useCatalogMeta({
    enabled: hydrated,
  });

  const selectableAttrs = useMemo(
    () => (attributes ?? []).filter((a) => a.type === "SELECT" && a.isActive !== false),
    [attributes]
  );

  const attrOrder = useMemo(() => selectableAttrs.map((a) => a.id), [selectableAttrs]);

  const attrNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of selectableAttrs) m.set(a.id, a.name);
    return m;
  }, [selectableAttrs]);

  const valueNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of selectableAttrs) {
      for (const v of a.values || []) m.set(v.id, v.name);
    }
    return m;
  }, [selectableAttrs]);

  useEffect(() => {
    if (!selectableAttrs.length) return;
    const ids = selectableAttrs.map((a) => a.id);

    setVariantRows((rows) =>
      rows.map((row) => {
        const next: Record<string, string> = {};
        ids.forEach((aid) => {
          next[aid] = row.selections?.[aid] || "";
        });

        if (Array.isArray(row.rawOptions) && row.rawOptions.length) {
          for (const o of row.rawOptions) {
            if (next[o.attributeId] != null) next[o.attributeId] = o.valueId;
          }
        }

        return { ...row, selections: next };
      })
    );
  }, [selectableAttrs]);

  // ✅ cookie-auth detail load
  const detailQ = useQuery<SupplierProductDetail>({
    queryKey: ["supplier", offersOnly ? "catalog-product" : "product", id, offersOnly ? "offersOnly" : "full"],
    enabled: hydrated && !!id && isSupplier,
    queryFn: async () => {
      const attempts = offersOnly
        ? [
            `/api/supplier/products/${id}`,
            `/api/supplier/products/${id}?include=offer,variants,images,attributes`,
            `/api/supplier/products/${id}`,
          ]
        : [
            `/api/supplier/products/${id}?include=offer,variants,images,attributes`,
            `/api/supplier/products/${id}?include=offer,variants`,
            `/api/supplier/products/${id}`,
          ];

      let lastErr: any = null;

      for (const url of attempts) {
        try {
          const res = await api.get(url, { withCredentials: true });
          const root = (res as any)?.data;
          const d = root?.data ?? root?.data?.data ?? root;
          if (d && d.id) return d as SupplierProductDetail;
          if (d?.data && d.data.id) return d.data as SupplierProductDetail;
          if (root?.id) return root as SupplierProductDetail;
        } catch (e) {
          lastErr = e;
        }
      }

      throw lastErr || new Error("Failed to load product");
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const productStatusUpper = useMemo(() => String(detailQ.data?.status ?? "").toUpperCase(), [detailQ.data?.status]);

  // ✅ LIVE lock rules apply ONLY to owned product edits, not offers-only
  const isLive = useMemo(() => {
    if (offersOnly) return false;
    return !["PENDING", "REJECTED"].includes(productStatusUpper);
  }, [offersOnly, productStatusUpper]);

  const activeBasePriceForDisplay = useMemo(() => {
    if (offersOnly) return Number(activeBasePrice ?? 0);
    return Number(initialBasePriceRef.current ?? 0);
  }, [offersOnly, activeBasePrice]);

  const requestedBasePriceForDisplay = useMemo(() => toMoneyNumber(retailPrice), [retailPrice]);

  const basePriceForPreview = useMemo(() => {
    if (isLive) return Number(initialBasePriceRef.current ?? 0);
    return toMoneyNumber(retailPrice);
  }, [isLive, retailPrice]);

  const isRealVariantRow = (r: VariantRow) => rowHasAnySelection(r.selections);

  const variantQtyTotal = useMemo(() => {
    return variantRows.reduce((sum, r) => sum + (isRealVariantRow(r) ? toIntNonNeg(r.availableQty) : 0), 0);
  }, [variantRows]);

  const baseQtyPreview = useMemo(() => toIntNonNeg(availableQty), [availableQty]);

  const totalQty = useMemo(() => baseQtyPreview + variantQtyTotal, [baseQtyPreview, variantQtyTotal]);
  const inStockPreview = totalQty > 0;

  const variantsEnabled = useMemo(() => variantRows.some(isRealVariantRow), [variantRows]);
  const effectiveQty = totalQty;

  const computeDupInfo = (rows: VariantRow[]): DupInfo => {
    const seen = new Map<string, string>();
    const dups = new Set<string>();
    const dupKeys = new Set<string>();

    for (const row of rows) {
      const key = sparseComboKey(row.selections, attrOrder);
      const first = seen.get(key);
      if (first) {
        dups.add(first);
        dups.add(row.id);
        dupKeys.add(key);
      } else {
        seen.set(key, row.id);
      }
    }

    const labels = Array.from(dupKeys).map((k) => {
      if (k === "DEFAULT") return "DEFAULT (no options selected)";
      const sample = rows.find((r) => sparseComboKey(r.selections, attrOrder) === k);
      return sample ? formatComboLabel(sample.selections, attrOrder, attrNameById, valueNameById) : k;
    });

    const explain =
      dups.size > 0
        ? `Duplicate variant combinations found: ${labels.join(
            " • "
          )}. Please change options or remove one of the duplicate rows.`
        : null;

    return { duplicateRowIds: dups, duplicateLabels: labels, explain };
  };

  const liveDup = useMemo(() => computeDupInfo(variantRows), [variantRows, attrOrder, attrNameById, valueNameById]);
  const duplicateRowIds = liveDup.duplicateRowIds;
  const hasDuplicates = duplicateRowIds.size > 0;

  useEffect(() => {
    setDupWarn(hasDuplicates ? liveDup.explain : null);
  }, [hasDuplicates, liveDup.explain]);

  const activeAttrs = useMemo(() => (attributes ?? []).filter((a) => a?.isActive !== false), [attributes]);

  const canEditCore = !offersOnly;
  const canAddNewCombos = !offersOnly;
  const canEditAttributes = !offersOnly;

  const setAttr = (attributeId: string, value: string | string[]) => {
    if (offersOnly) return;
    setSelectedAttrs((prev) => ({ ...prev, [attributeId]: value }));
  };

  const getAttrVal = (attributeId: string) => {
    const v = selectedAttrs?.[attributeId];
    if (Array.isArray(v)) return v;
    return String(v ?? "");
  };

  // REVIEW logic is only relevant for owned products
  const nonStockChangesRequireReview = useMemo(() => {
    if (offersOnly) return false;
    if (!isLive) return false;
    const snap = initialSnapshotRef.current;
    if (!snap || snap.id !== (detailQ.data as any)?.id) return false;

    const titleChanged = (title ?? "").trim() !== (snap.title ?? "").trim();
    const skuChanged = (sku ?? "").trim() !== (snap.sku ?? "").trim();
    const catChanged = String(categoryId ?? "") !== String(snap.categoryId ?? "");
    const brandChanged = String(brandId ?? "") !== String(snap.brandId ?? "");
    const descChanged = String(description ?? "").trim() !== String(snap.description ?? "").trim();

    const currentImgs = [...parseUrlList(imageUrls).filter(isUrlish), ...uploadedUrls.filter(isUrlish)];
    const norm = (arr: string[]) => Array.from(new Set(arr.map(String))).sort();
    const imagesChanged = JSON.stringify(norm(currentImgs)) !== JSON.stringify(norm(snap.images));

    const attrChanged = (() => {
      const allIds = new Set<string>([...Object.keys(snap.attr || {}), ...Object.keys(selectedAttrs || {})]);
      for (const aid of allIds) {
        const prev = snap.attr[aid];
        const cur = selectedAttrs[aid];

        if (Array.isArray(prev) || Array.isArray(cur)) {
          const p = Array.isArray(prev) ? prev.map(String).sort() : [];
          const c = Array.isArray(cur) ? cur.map(String).sort() : [];
          if (JSON.stringify(p) !== JSON.stringify(c)) return true;
        } else {
          if (String(prev ?? "").trim() !== String(cur ?? "").trim()) return true;
        }
      }
      return false;
    })();

    const newCombosAdded = variantRows.some((r) => !r.variantId && rowHasAnySelection(r.selections));

    return titleChanged || skuChanged || catChanged || brandChanged || descChanged || imagesChanged || attrChanged || newCombosAdded;
  }, [
    offersOnly,
    isLive,
    detailQ.data,
    title,
    sku,
    categoryId,
    brandId,
    description,
    imageUrls,
    uploadedUrls,
    selectedAttrs,
    variantRows,
  ]);

  // ---------- HYDRATE (BASE FIELDS + VARIANTS) ----------
  useEffect(() => {
    const p = detailQ.data as any;
    if (!p?.id) return;

    if (hydratedBaseForIdRef.current === p.id) return;
    hydratedBaseForIdRef.current = p.id;

    hydratedAttrsForIdRef.current = null;

    setTitle(p.title || "");
    setSku(p.sku || "");
    setCategoryId(p.categoryId ?? "");
    setBrandId(p.brandId ?? "");
    setDescription(p.description ?? "");

    const productFallback = Number(p.retailPrice ?? 0) || Number((p as any).autoPrice ?? 0) || 0;
    const baseP = Number(p.offer?.basePrice ?? productFallback ?? 0) || 0;

    initialBasePriceRef.current = baseP;

    if (offersOnly) {
      setActiveBasePrice(baseP);

      const { base, variantMap } = buildPendingMaps(p);
      const basePatch = base?.proposedPatch ?? null;

      setPendingBasePatch(basePatch);
      setPendingVariantPatchByVariantId(variantMap);

      const requested = Number(basePatch?.basePrice ?? NaN);
      if (Number.isFinite(requested) && requested > 0) setRetailPrice(String(requested));
      else setRetailPrice(String(baseP));
    } else {
      setActiveBasePrice(0);
      setPendingBasePatch(null);
      setPendingVariantPatchByVariantId(new Map());
      setRetailPrice(String(baseP));
    }

    const urls = normalizeImages(p).filter(isUrlish);
    setImageUrls(urls.join("\n"));

    const baseQty = p.offer ? (p.offer.availableQty ?? 0) : 0;
    setAvailableQty(String(Number(baseQty) || 0));

    const myVarOffers: Array<any> = Array.isArray(p?.supplierVariantOffers) ? p.supplierVariantOffers : [];
    const offerByVariantId = new Map<string, any>();
    for (const o of myVarOffers) {
      const vid = String(o?.variantId ?? "").trim();
      if (vid) offerByVariantId.set(vid, o);
    }

    const vList = normalizeVariants(p);

    const vr: VariantRow[] = (vList ?? []).map((v: any) => {
      const rawOptions = extractVariantOptions(v);

      const selections: Record<string, string> = {};
      selectableAttrs.forEach((a) => (selections[a.id] = ""));

      for (const o of rawOptions) {
        if (selections[o.attributeId] != null) selections[o.attributeId] = o.valueId;
      }

      const comboLabel = formatComboLabel(selections, attrOrder, attrNameById, valueNameById);
      const variantId = String(v?.id ?? v?.variantId ?? "").trim();

      const myOffer =
        offerByVariantId.get(variantId) ??
        v?.supplierVariantOffer ??
        (Array.isArray(v?.supplierVariantOffers) ? v.supplierVariantOffers?.[0] : null);

      const qty = myOffer?.availableQty ?? 0;

      return {
        id: uid("vr"),
        variantId,
        isExisting: true,
        selections,
        comboLabel,
        availableQty: String(Number(qty) || 0),
        rawOptions,
        variantOfferId: myOffer?.id ? String(myOffer.id) : undefined,
      };
    });

    setVariantRows(vr);

    initialSnapshotRef.current = {
      id: p.id,
      title: p.title || "",
      sku: p.sku || "",
      categoryId: p.categoryId ?? null,
      brandId: p.brandId ?? null,
      description: p.description ?? "",
      images: urls,
      attr: {},
      multiAttrValues: {},
      existingVariantIds: new Set(vr.filter((x) => x.variantId).map((x) => String(x.variantId))),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailQ.data?.id]);

  // ---------- HYDRATE (ATTRIBUTES ONLY) ----------
  useEffect(() => {
    const p = detailQ.data as any;
    if (!p?.id) return;
    if (!(attributes ?? []).length) return;

    const hasAttrPayload =
      (Array.isArray(p?.attributeSelections) && p.attributeSelections.length > 0) ||
      (Array.isArray(p?.attributeValues) && p.attributeValues.length > 0) ||
      (Array.isArray(p?.attributeTexts) && p.attributeTexts.length > 0) ||
      (Array.isArray(p?.attributeOptions) && p.attributeOptions.length > 0) ||
      (Array.isArray(p?.ProductAttributeText) && p.ProductAttributeText.length > 0);

    if (!hasAttrPayload) return;

    if (hydratedAttrsForIdRef.current === p.id) return;
    hydratedAttrsForIdRef.current = p.id;

    const nextSel: Record<string, string | string[]> = {};
    const { texts, values } = normalizeAttributeSelections(p);

    for (const t of texts) nextSel[t.attributeId] = t.value;

    const grouped: Record<string, string[]> = {};
    for (const av of values) {
      grouped[av.attributeId] = grouped[av.attributeId] || [];
      grouped[av.attributeId].push(av.valueId);
    }

    for (const a of attributes ?? []) {
      if (a.type === "MULTISELECT") nextSel[a.id] = grouped[a.id] || [];
      if (a.type === "SELECT") nextSel[a.id] = (grouped[a.id]?.[0] ?? "") as any;
      if (a.type === "TEXT" && nextSel[a.id] == null) nextSel[a.id] = "";
    }

    setSelectedAttrs(nextSel);

    const snap = initialSnapshotRef.current;
    if (snap && snap.id === p.id) {
      snap.attr = { ...nextSel };

      const multiSets: Record<string, Set<string>> = {};
      for (const a of attributes ?? []) {
        if (a.type !== "MULTISELECT") continue;
        const arr = Array.isArray(nextSel[a.id]) ? (nextSel[a.id] as string[]).map(String) : [];
        multiSets[a.id] = new Set(arr);
      }
      snap.multiAttrValues = multiSets;
    }
  }, [detailQ.data?.id, detailQ.data, (attributes ?? []).length]);

  const UPLOAD_ENDPOINT = "/api/uploads";

  // ✅ cookie-auth upload
  async function uploadLocalFiles(): Promise<string[]> {
    if (!files.length) return [];
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));

    try {
      setUploading(true);
      const res = await api.post(UPLOAD_ENDPOINT, fd, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" },
      });

      const urls: string[] = (res as any)?.data?.urls || (Array.isArray((res as any)?.data) ? (res as any).data : []);
      const clean = Array.isArray(urls) ? urls.filter(Boolean) : [];

      setUploadedUrls((prev) => [...prev, ...clean]);
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";

      return clean;
    } finally {
      setUploading(false);
    }
  }

  const setVariantRowsAndCheck = (next: VariantRow[]) => {
    setVariantRows(next);
    const info = computeDupInfo(next);
    setDupWarn(info.explain);
    if (!info.explain) setDupWarn(null);
  };

  function addVariantRow() {
    setErr(null);
    if (offersOnly) {
      setErr("You can’t create new variant combinations for a catalog product. You can only offer existing variants.");
      return;
    }
    if (!selectableAttrs.length) return;

    const selections: Record<string, string> = {};
    selectableAttrs.forEach((a) => (selections[a.id] = ""));
    const next = [...variantRows, { id: uid("vr"), selections, availableQty: "" }];
    setVariantRowsAndCheck(next);
  }

  function updateVariantSelection(rowId: string, attributeId: string, valueId: string) {
    setErr(null);
    if (offersOnly) return;
    const next = variantRows.map((r) => (r.id === rowId ? { ...r, selections: { ...r.selections, [attributeId]: valueId } } : r));
    setVariantRowsAndCheck(next);
  }

  function updateVariantQty(rowId: string, v: string) {
    const next = variantRows.map((r) => (r.id === rowId ? { ...r, availableQty: v } : r));
    setVariantRowsAndCheck(next);
  }

  async function removeOfferForVariant(row: VariantRow) {
    if (!row.variantOfferId) return;

    await api.delete(`/api/supplier/catalog/offers/variant/${row.variantOfferId}`, {
      withCredentials: true,
    });

    setVariantRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, variantOfferId: undefined, availableQty: "0" } : r)));
  }

  function removeVariantRow(rowId: string) {
    const row = variantRows.find((r) => r.id === rowId);
    if (!row) return;

    if (offersOnly) {
      if (row.variantOfferId) {
        removeOfferForVariant(row).catch((e: any) => {
          setErr(e?.response?.data?.error || e?.message || "Failed to remove variant offer");
        });
      } else {
        updateVariantQty(rowId, "0");
      }
      return;
    }

    if (isLive && row.isExisting) {
      setErr("This product is LIVE. You can’t delete an existing variant. Set its qty to 0 instead.");
      return;
    }

    const next = variantRows.filter((r) => r.id !== rowId);
    setVariantRowsAndCheck(next);
  }

  const onChangeBasePrice = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isLive) {
      setErr("This product is LIVE. Base price is locked. You can update stock/qty only.");
      setRetailPrice(String(Number(initialBasePriceRef.current ?? 0)));
      return;
    }
    setRetailPrice(e.target.value);
  };

  const updateM = useMutation({
    mutationFn: async () => {
      setErr(null);
      setOkMsg(null);

      if (!id) throw new Error("Missing product id");

      const basePrice = toMoneyNumber(retailPrice);
      if (!Number.isFinite(basePrice) || basePrice <= 0) throw new Error("Price must be greater than 0");

      if (offersOnly) {
        const baseQty = baseQtyPreview;
        const baseInStock = baseQty > 0;

        await api.put(
          `/api/supplier/catalog/offers/base`,
          {
            productId: id,
            basePrice,
            availableQty: baseQty,
            leadDays: null,
            isActive: true,
            inStock: baseInStock,
            currency: "NGN",
          },
          { withCredentials: true }
        );

        const tasks: Promise<any>[] = [];

        for (const r of variantRows) {
          if (!r.variantId) continue;
          const qty = toIntNonNeg(r.availableQty);

          if (qty <= 0) {
            if (r.variantOfferId) {
              tasks.push(api.delete(`/api/supplier/catalog/offers/variant/${r.variantOfferId}`, { withCredentials: true }));
            }
            continue;
          }

          tasks.push(
            api.put(
              `/api/supplier/catalog/offers/variant`,
              {
                productId: id,
                variantId: r.variantId,
                unitPrice: basePrice,
                availableQty: qty,
                leadDays: null,
                isActive: true,
                inStock: qty > 0,
                currency: "NGN",
              },
              { withCredentials: true }
            )
          );
        }

        await Promise.all(tasks);
        return { ok: true };
      }

      // ---------- owned-product path (keep your existing logic below as-is) ----------
      if (!title.trim()) throw new Error("Title is required");
      if (!sku.trim()) throw new Error("SKU is required");

      const snap = initialSnapshotRef.current;
      if (isLive && snap) {
        if ((title ?? "").trim() !== (snap.title ?? "").trim()) {
          throw new Error("This product is LIVE. Title is locked. Only stock/qty updates are allowed.");
        }
        if ((sku ?? "").trim() !== (snap.sku ?? "").trim()) {
          throw new Error("This product is LIVE. SKU is locked. Only stock/qty updates are allowed.");
        }
      }

      if (isLive) {
        const attemptedBase = toMoneyNumber(retailPrice);
        const lockedBase = Number(initialBasePriceRef.current ?? 0);
        if (attemptedBase !== lockedBase) {
          throw new Error("This product is LIVE. Base price is locked. Only stock/qty updates are allowed.");
        }
      }

      if (hasDuplicates) {
        throw new Error(dupWarn || "You can’t save because there are duplicate variant combinations.");
      }

      const stockOnlyUpdate = isLive && !nonStockChangesRequireReview;

      const urlList = parseUrlList(imageUrls).filter(isUrlish);
      const freshlyUploaded = files.length ? await uploadLocalFiles() : [];
      const imagesJson = [...urlList, ...uploadedUrls, ...freshlyUploaded].filter(Boolean);

      // NOTE:
      // Keep your existing payload builders (buildPayload / buildStockOnlyPayload) from your project file.
      // This snippet assumes they already exist below in your actual file.
      // @ts-ignore
      const payload = stockOnlyUpdate
        ? // @ts-ignore
          buildStockOnlyPayload({ baseQty: baseQtyPreview, variantRows })
        : {
            // @ts-ignore
            ...buildPayload(imagesJson),
            submitForReview: isLive && nonStockChangesRequireReview,
            stockOnly: false,
          };

      const { data } = await api.patch(`/api/supplier/products/${id}`, payload, {
        withCredentials: true,
      });

      return data;
    },
    onSuccess: () => {
      if (offersOnly) {
        setOkMsg("Saved ✅ Stock updates apply immediately. Price changes may be pending admin approval.");
        (detailQ as any)?.refetch?.();
        setTimeout(() => nav("/supplier/catalog-offers", { replace: true }), 700);
        return;
      }

      const stockOnlyUpdate = isLive && !nonStockChangesRequireReview;

      if (isLive && !stockOnlyUpdate && nonStockChangesRequireReview) {
        setOkMsg("Saved ✅ Changes submitted for review. Listing may become PENDING until approved.");
      } else {
        setOkMsg(stockOnlyUpdate ? "Stock updated ✅" : "Saved ✅");
      }

      setTimeout(() => nav("/supplier/products", { replace: true }), 700);
    },
    onError: (e: any) => {
      setErr(e?.response?.data?.error || e?.message || "Failed to update");
    },
  });

  const urlPreviews = useMemo(() => parseUrlList(imageUrls).filter(isUrlish), [imageUrls]);

  const allUrlPreviews = useMemo(() => {
    const uniq = new Set<string>();
    [...urlPreviews, ...uploadedUrls].forEach((u) => {
      if (u && isUrlish(u)) uniq.add(u);
    });
    return Array.from(uniq);
  }, [urlPreviews, uploadedUrls]);

  const saveDisabled = updateM.isPending || uploading || detailQ.isLoading || hasDuplicates || !hydrated || !isSupplier;

  const hasPendingBase =
    offersOnly &&
    pendingBasePatch != null &&
    pendingBasePatch?.basePrice != null &&
    Number(pendingBasePatch.basePrice) !== Number(activeBasePriceForDisplay);

  const showRequestedButNotPending =
    offersOnly &&
    !hasPendingBase &&
    requestedBasePriceForDisplay > 0 &&
    requestedBasePriceForDisplay !== activeBasePriceForDisplay;

  const guardMsg =
    !hydrated ? "Loading session…" : !isSupplier ? "This page is for suppliers only." : null;

  return (
    <SiteLayout>
      <SupplierLayout>
        <div className="mt-4 sm:mt-6 space-y-4">
          {/* Header (mobile: stacked + full width actions) */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0">
              <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-[20px] sm:text-2xl font-bold tracking-tight text-zinc-900 leading-tight"
              >
                {offersOnly ? "Offer this product" : "Edit product"}
              </motion.h1>

              {offersOnly ? (
                <p className="text-[13px] sm:text-sm text-zinc-600 mt-1 leading-snug">
                  Catalog product: you can only edit <b>your offer</b> (price/stock per variant).
                </p>
              ) : isLive ? (
                <p className="text-[13px] sm:text-sm text-zinc-600 mt-1 leading-snug">
                  This product is <b>{productStatusUpper || "LIVE"}</b>. <b>Stock updates</b> are immediate. Other
                  changes may be <b>submitted for review</b>.
                </p>
              ) : (
                <p className="text-[13px] sm:text-sm text-zinc-600 mt-1 leading-snug">
                  You can edit this product freely while it is <b>{productStatusUpper || "PENDING"}</b>.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 sm:flex gap-2">
              <Link
                to={offersOnly ? "/supplier/catalog-offers" : "/supplier/products"}
                className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-3 py-2 text-[13px] sm:text-sm font-semibold hover:bg-black/5"
              >
                <ArrowLeft size={16} /> Back
              </Link>

              <button
                type="button"
                disabled={saveDisabled}
                onClick={() => {
                  if (hasDuplicates) {
                    setErr(dupWarn);
                    return;
                  }
                  updateM.mutate();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2 text-[13px] sm:text-sm font-semibold disabled:opacity-60"
                title={hasDuplicates ? "Fix duplicate combinations to save." : undefined}
              >
                <Save size={16} /> {updateM.isPending ? "Saving…" : offersOnly ? "Save offer" : "Save changes"}
              </button>
            </div>
          </div>

          {/* Alerts */}
          {guardMsg && (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
              {guardMsg}
            </div>
          )}

          {!offersOnly && isLive && nonStockChangesRequireReview && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
              <b>Review notice:</b> You’ve made changes beyond stock. Saving will submit changes for <b>admin review</b>.
            </div>
          )}

          {offersOnly && hasPendingBase && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
              <b>Pending approval:</b> Active price remains <b>{ngn.format(activeBasePriceForDisplay)}</b>.
            </div>
          )}

          {dupWarn && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
              <b>Duplicates detected:</b> {dupWarn}
            </div>
          )}

          {err && <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{err}</div>}
          {okMsg && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
              {okMsg}
            </div>
          )}

          {detailQ.isError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
              Could not load product.
            </div>
          )}

          {/* Layout (mobile: single column; desktop: sidebar) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              {/* Basic info */}
              <Card
                title="Basic information"
                subtitle={
                  offersOnly
                    ? "Catalog product details are read-only. Set your offer price and stock."
                    : isLive
                    ? "LIVE listing: base price is locked. Stock updates are always allowed."
                    : undefined
                }
              >
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Title *</label>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        disabled={!canEditCore || isLive}
                        readOnly={!canEditCore || isLive}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">SKU *</label>
                      <input
                        value={sku}
                        onChange={(e) => setSku(e.target.value)}
                        disabled={!canEditCore || isLive}
                        readOnly={!canEditCore || isLive}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white disabled:opacity-60"
                      />
                    </div>
                  </div>

                  {/* Mobile-friendly: break 4-col row into 2 cols on small */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="sm:col-span-2 lg:col-span-1">
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">
                        {offersOnly ? "Your base offer price (NGN) *" : "Retail price (NGN) *"}
                      </label>
                      <input
                        value={retailPrice}
                        onChange={onChangeBasePrice}
                        inputMode="decimal"
                        disabled={isLive}
                        readOnly={isLive}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white disabled:opacity-60"
                      />

                      {!!retailPrice && (
                        <div className="text-[11px] text-zinc-500 mt-1">
                          Preview: <b>{ngn.format(basePriceForPreview)}</b>
                        </div>
                      )}

                      {offersOnly && (
                        <div className="text-[11px] text-zinc-600 mt-1">
                          Active (approved): <b>{ngn.format(activeBasePriceForDisplay)}</b>
                        </div>
                      )}

                      {offersOnly && hasPendingBase && (
                        <div className="text-[11px] text-amber-700 mt-1">
                          Pending: <b>{ngn.format(Number(pendingBasePatch?.basePrice ?? 0))}</b>
                        </div>
                      )}

                      {offersOnly && showRequestedButNotPending && (
                        <div className="text-[11px] text-zinc-500 mt-1">
                          Will submit for approval: <b>{ngn.format(requestedBasePriceForDisplay)}</b>
                        </div>
                      )}

                      {!offersOnly && isLive && (
                        <div className="text-[11px] text-amber-700 mt-1">
                          LIVE listing: price is <b>locked</b>.
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">
                        {offersOnly ? "Your base offer quantity" : "Base quantity"}
                      </label>
                      <input
                        value={availableQty}
                        onChange={(e) => setAvailableQty(e.target.value)}
                        inputMode="numeric"
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white"
                        placeholder="e.g. 20"
                      />
                      <div className="text-[11px] text-zinc-500 mt-1">
                        Total = <b>{baseQtyPreview}</b> (base) + <b>{variantQtyTotal}</b> (variants) = <b>{totalQty}</b>
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-1">
                        In-stock:{" "}
                        <b className={inStockPreview ? "text-emerald-700" : "text-rose-700"}>
                          {inStockPreview ? "YES" : "NO"}
                        </b>
                      </div>
                      {variantsEnabled && (
                        <div className="text-[11px] text-zinc-500 mt-1">Variant quantities add on top.</div>
                      )}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Category</label>
                      <select
                        value={categoryId}
                        onChange={(e) => setCategoryId(e.target.value)}
                        disabled={!canEditCore}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white disabled:opacity-60"
                      >
                        <option value="">{categoriesQ.isLoading ? "Loading…" : "— Select category —"}</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Brand</label>
                      <select
                        value={brandId}
                        onChange={(e) => setBrandId(e.target.value)}
                        disabled={!canEditCore}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white disabled:opacity-60"
                      >
                        <option value="">{brandsQ.isLoading ? "Loading…" : "— Select brand —"}</option>
                        {brands.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      disabled={!canEditCore}
                      className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white min-h-[110px] disabled:opacity-60"
                    />
                  </div>

                  {/* Attributes */}
                  <div className="rounded-2xl border bg-white overflow-hidden">
                    <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70">
                      <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">Attributes</div>
                      <div className="text-[11px] sm:text-xs text-zinc-500 mt-0.5">
                        {offersOnly
                          ? "Catalog product attributes are read-only."
                          : isLive
                          ? "LIVE listing: edits may require review."
                          : "You can edit attributes freely while not LIVE."}
                      </div>
                    </div>

                    <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {activeAttrs.length === 0 && (
                        <div className="text-sm text-zinc-500">No active attributes configured.</div>
                      )}

                      {activeAttrs.map((a) => {
                        if (a.type === "TEXT") {
                          const val = String(getAttrVal(a.id) ?? "");
                          return (
                            <div key={a.id}>
                              <label className="block text-[11px] font-semibold text-zinc-700 mb-1">{a.name}</label>
                              <input
                                value={val}
                                onChange={(e) => setAttr(a.id, e.target.value)}
                                disabled={!canEditAttributes}
                                className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white disabled:opacity-60"
                                placeholder={a.placeholder || "Enter value..."}
                              />
                            </div>
                          );
                        }

                        if (a.type === "SELECT") {
                          const val = String(getAttrVal(a.id) ?? "");
                          return (
                            <div key={a.id}>
                              <label className="block text-[11px] font-semibold text-zinc-700 mb-1">{a.name}</label>
                              <select
                                value={val}
                                onChange={(e) => setAttr(a.id, e.target.value)}
                                disabled={!canEditAttributes}
                                className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white disabled:opacity-60"
                              >
                                <option value="">— Select —</option>
                                {(a.values || []).map((v: any) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        }

                        if (a.type === "MULTISELECT") {
                          const vals = Array.isArray(getAttrVal(a.id)) ? (getAttrVal(a.id) as string[]) : [];
                          return (
                            <div key={a.id}>
                              <label className="block text-[11px] font-semibold text-zinc-700 mb-1">{a.name}</label>
                              <select
                                multiple
                                value={vals}
                                onChange={(e) => {
                                  const ids = Array.from(e.target.selectedOptions).map((o) => o.value);
                                  setAttr(a.id, ids);
                                }}
                                disabled={!canEditAttributes}
                                className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white disabled:opacity-60 min-h-[42px]"
                              >
                                {(a.values || []).map((v: any) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        }

                        return null;
                      })}
                    </div>
                  </div>
                </div>
              </Card>

              {/* Images */}
              <Card
                title="Images"
                subtitle={offersOnly ? "Catalog images are read-only." : "Paste URLs or upload images."}
                right={
                  <label className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-[13px] sm:text-sm font-semibold hover:bg-black/5 cursor-pointer">
                    <ImagePlus size={16} /> Add files
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => setFiles(Array.from(e.target.files || []))}
                      disabled={offersOnly}
                    />
                  </label>
                }
              >
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Image URLs (one per line)</label>
                    <textarea
                      value={imageUrls}
                      onChange={(e) => setImageUrls(e.target.value)}
                      disabled={offersOnly}
                      className="w-full rounded-xl border px-3 py-2.5 text-xs bg-white min-h-[90px] disabled:opacity-60"
                    />
                  </div>

                  {!offersOnly && files.length > 0 && (
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-xs font-semibold text-zinc-800">
                        Selected files: <span className="font-mono">{files.length}</span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 sm:flex gap-2">
                        <button
                          type="button"
                          onClick={uploadLocalFiles}
                          disabled={uploading || !files.length}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white px-3 py-2 text-[13px] sm:text-sm font-semibold disabled:opacity-60"
                        >
                          {uploading ? "Uploading…" : "Upload now"}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setFiles([]);
                            if (fileInputRef.current) fileInputRef.current.value = "";
                          }}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-3 py-2 text-[13px] sm:text-sm font-semibold hover:bg-black/5"
                        >
                          <Trash2 size={16} /> Clear
                        </button>
                      </div>
                    </div>
                  )}

                  {allUrlPreviews.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {allUrlPreviews.slice(0, 9).map((u) => (
                        <div key={u} className="rounded-xl border overflow-hidden bg-white">
                          <div className="aspect-[4/3] bg-zinc-100">
                            <img
                              src={u}
                              alt=""
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                            />
                          </div>
                          <div className="p-2 text-[10px] text-zinc-600 truncate">{u}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500">No images found on this product yet.</div>
                  )}
                </div>
              </Card>

              {/* Variants */}
              <Card
                title="Variant combinations"
                subtitle={
                  offersOnly
                    ? "Catalog product: set qty for existing variants. You can’t create new combos."
                    : isLive
                    ? "LIVE listing: update qty. You can’t delete existing variants (set qty to 0)."
                    : "Add/remove combos while not LIVE."
                }
                right={
                  <button
                    type="button"
                    onClick={addVariantRow}
                    disabled={!selectableAttrs.length || !canAddNewCombos}
                    className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-[13px] sm:text-sm font-semibold hover:bg-black/5 disabled:opacity-60"
                  >
                    <Plus size={16} /> Add row
                  </button>
                }
              >
                <div className="space-y-2">
                  {!selectableAttrs.length && <div className="text-sm text-zinc-500">No SELECT attributes available.</div>}

                  {variantRows.length === 0 ? (
                    <div className="text-sm text-zinc-500">No variants returned for this product.</div>
                  ) : (
                    variantRows.map((row) => {
                      const comboText =
                        row.comboLabel || formatComboLabel(row.selections, attrOrder, attrNameById, valueNameById);

                      const isDup = duplicateRowIds.has(row.id);
                      const rowQty = toIntNonNeg(row.availableQty);
                      const rowInStock = rowQty > 0;

                      const disableRemove = offersOnly ? !row.variantOfferId && rowQty <= 0 : isLive && row.isExisting;

                      const activeUnitPrice = offersOnly ? activeBasePriceForDisplay : basePriceForPreview;

                      const pendingVar = row.variantId ? pendingVariantPatchByVariantId.get(String(row.variantId)) : null;
                      const pendingVarUnitPrice = Number(pendingVar?.proposedPatch?.unitPrice ?? NaN);
                      const hasPendingVarPrice =
                        offersOnly && Number.isFinite(pendingVarUnitPrice) && pendingVarUnitPrice > 0 && pendingVarUnitPrice !== activeUnitPrice;

                      return (
                        <div
                          key={row.id}
                          className={`rounded-2xl border bg-white p-3 space-y-2 ${isDup ? "border-rose-400 ring-2 ring-rose-200" : ""}`}
                        >
                          {/* option selects (wrap nicely on mobile) */}
                          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                            {selectableAttrs.map((attr) => {
                              const valueId = row.selections[attr.id] || "";
                              return (
                                <select
                                  key={attr.id}
                                  value={valueId}
                                  onChange={(e) => updateVariantSelection(row.id, attr.id, e.target.value)}
                                  className={`rounded-xl border px-3 py-2 text-xs bg-white ${isDup ? "border-rose-300" : ""}`}
                                  disabled={true}
                                  title="Variant options are fixed; edit qty only."
                                >
                                  <option value="">{attr.name}</option>
                                  {(attr.values || []).map((v) => (
                                    <option key={v.id} value={v.id}>
                                      {v.name}
                                    </option>
                                  ))}
                                </select>
                              );
                            })}
                          </div>

                          {/* info + actions */}
                          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                            <div className="min-w-0">
                              <div className="text-xs text-zinc-700">
                                <span className="text-zinc-500">Combo:</span>{" "}
                                <b className={isDup ? "text-rose-700" : "text-zinc-900"}>{comboText}</b>
                              </div>

                              <div className="text-[11px] text-zinc-500 mt-1 flex flex-wrap gap-3">
                                <span>
                                  Unit (active): <b className="text-zinc-900">{ngn.format(activeUnitPrice)}</b>
                                </span>
                                <span>
                                  Qty: <b className="text-zinc-900">{rowQty}</b>
                                </span>
                                <span
                                  className={`font-semibold px-2 py-0.5 rounded-full border ${
                                    rowInStock
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : "bg-rose-50 text-rose-700 border-rose-200"
                                  }`}
                                >
                                  {rowInStock ? "In stock" : "Out of stock"}
                                </span>
                              </div>

                              {offersOnly && hasPendingBase && (
                                <div className="text-[11px] text-amber-700 mt-1">
                                  Requested base: <b>{ngn.format(Number(pendingBasePatch?.basePrice ?? 0))}</b> (pending)
                                </div>
                              )}
                              {offersOnly && hasPendingVarPrice && (
                                <div className="text-[11px] text-amber-700 mt-1">
                                  Requested variant: <b>{ngn.format(pendingVarUnitPrice)}</b> (pending)
                                </div>
                              )}
                            </div>

                            <div className="sm:ml-auto flex items-center gap-2">
                              <span className="text-xs text-zinc-500">Qty</span>
                              <input
                                value={row.availableQty}
                                onChange={(e) => updateVariantQty(row.id, e.target.value)}
                                inputMode="numeric"
                                className={`w-24 rounded-xl border px-3 py-2 text-xs bg-white ${isDup ? "border-rose-300" : ""}`}
                                placeholder="e.g. 5"
                              />

                              <button
                                type="button"
                                onClick={() => removeVariantRow(row.id)}
                                disabled={disableRemove}
                                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
                                  disableRemove
                                    ? "bg-zinc-50 text-zinc-400 border-zinc-200 cursor-not-allowed"
                                    : "bg-rose-50 text-rose-700 hover:bg-rose-100 border-rose-200"
                                }`}
                                title={
                                  offersOnly
                                    ? row.variantOfferId
                                      ? "Remove your variant offer for this variant."
                                      : "Nothing to remove."
                                    : isLive && row.isExisting
                                    ? "LIVE listing: you can’t delete existing variants. Set qty to 0 instead."
                                    : undefined
                                }
                              >
                                <Trash2 size={14} /> {offersOnly ? "Remove offer" : "Remove"}
                              </button>
                            </div>
                          </div>

                          {isDup && (
                            <div className="text-[11px] text-rose-700">
                              Duplicate combination. Change options or remove one of the matching rows.
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </Card>
            </div>

            {/* Right summary */}
            <div className="space-y-4">
              <div className="rounded-2xl border bg-white/90 shadow-sm overflow-hidden">
                <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70">
                  <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">Update summary</div>
                  <div className="text-[11px] sm:text-xs text-zinc-500">What will be saved</div>
                </div>

                <div className="p-4 sm:p-5 text-sm text-zinc-700 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500">Status</span>
                    <b className="text-zinc-900">{productStatusUpper || "—"}</b>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500">Title</span>
                    <b className="text-zinc-900 truncate max-w-[60%]">{title.trim() ? title.trim() : "—"}</b>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-zinc-500">{offersOnly ? "Active offer price" : "Retail price"}</span>
                      <b className="text-zinc-900">{ngn.format(offersOnly ? activeBasePriceForDisplay : basePriceForPreview)}</b>
                    </div>

                    {offersOnly && (
                      <div className="flex items-center justify-between text-[11px] text-zinc-600">
                        <span className="text-zinc-500">Requested (input)</span>
                        <b className="text-zinc-900">{ngn.format(requestedBasePriceForDisplay)}</b>
                      </div>
                    )}

                    {offersOnly && hasPendingBase && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-xs">
                        Pending approval: <b>{ngn.format(Number(pendingBasePatch?.basePrice ?? 0))}</b>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 inline-flex items-center gap-2">
                      <Package size={14} /> Offer stock
                    </span>
                    <b className={inStockPreview ? "text-emerald-700" : "text-rose-700"}>
                      {effectiveQty} ({inStockPreview ? "In stock" : "Out of stock"})
                    </b>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500">Variant rows</span>
                    <b className="text-zinc-900">{variantRows.length}</b>
                  </div>

                  {!offersOnly && isLive && nonStockChangesRequireReview && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-xs">
                      Non-stock changes → <b>admin review</b>.
                    </div>
                  )}

                  {hasDuplicates && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-xs">
                      Saving is blocked until duplicates are fixed.
                    </div>
                  )}
                </div>
              </div>

              {/* Sticky-ish save on mobile (nice big CTA) */}
              <button
                type="button"
                disabled={saveDisabled}
                onClick={() => {
                  if (hasDuplicates) {
                    setErr(dupWarn);
                    return;
                  }
                  updateM.mutate();
                }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-white px-4 py-3 text-sm font-semibold disabled:opacity-60"
                title={hasDuplicates ? "Fix duplicate combinations to save." : undefined}
              >
                <Save size={16} /> {updateM.isPending ? "Saving…" : offersOnly ? "Save offer" : "Save changes"}
              </button>
            </div>
          </div>

          <div className="h-6" />
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}
