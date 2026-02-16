// src/pages/supplier/SupplierEditProduct.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ImagePlus, Save, Trash2, Plus, Package } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { useCatalogMeta } from "../../hooks/useCatalogMeta";

/* =========================================================
   Config
========================================================= */
const MAX_IMAGES_PER_PRODUCT = 5;

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

/**
 * ✅ STRICT key that includes blanks.
 * Used to compare BASE combo (attributes section) against VARIANT combos.
 * If all SELECT attrs match (including blanks), it’s considered the same combo.
 */
function strictComboKey(selections: Record<string, string>, attrOrder: string[]) {
  return attrOrder.map((aid) => `${aid}=${String(selections?.[aid] || "")}`).join("|");
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

function autoSkuFromTitle(input: string) {
  const s = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return s.slice(0, 48);
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

  /** ✅ per-variant price (unitPrice / retailPrice) */
  unitPrice: string;

  /** display-only: approved/active unit price for this variant (offersOnly mode) */
  activeUnitPrice?: number;

  isExisting?: boolean;
  comboLabel?: string;
  rawOptions?: Array<{ attributeId: string; valueId: string }>;
  variantOfferId?: string;
};

type DupInfo = {
  duplicateRowIds: Set<string>;
  duplicateLabels: string[];
  explain: string | null;

  /** if any existing/real variant row is DEFAULT, that conflicts with base combo */
  invalidDefaultRowIds: Set<string>;
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
  const queryClient = useQueryClient();

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

  const [skuTouched, setSkuTouched] = useState(false);

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

  // keep rows aligned to current selectable attributes
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

  // ✅ LOCK ONLY when actually LIVE/ACTIVE
  const isLive = useMemo(() => {
    if (offersOnly) return false;
    const s = String(productStatusUpper || "").toUpperCase();
    return s === "LIVE" || s === "ACTIVE";
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

  // ✅ draft row = no variantId and no option selection
  const isRealVariantRow = (r: VariantRow) => !!r.variantId || rowHasAnySelection(r.selections);

  const variantQtyTotal = useMemo(() => {
    return variantRows.reduce((sum, r) => sum + (isRealVariantRow(r) ? toIntNonNeg(r.availableQty) : 0), 0);
  }, [variantRows]);

  const baseQtyPreview = useMemo(() => toIntNonNeg(availableQty), [availableQty]);
  const totalQty = useMemo(() => baseQtyPreview + variantQtyTotal, [baseQtyPreview, variantQtyTotal]);
  const inStockPreview = totalQty > 0;

  const variantsEnabled = useMemo(
    () => variantRows.some((r) => isRealVariantRow(r) && rowHasAnySelection(r.selections)),
    [variantRows]
  );
  const effectiveQty = totalQty;

  const computeDupInfo = (rows: VariantRow[]): DupInfo => {
    const seen = new Map<string, string>();
    const dups = new Set<string>();
    const dupKeys = new Set<string>();

    // ✅ Also block any *real* variant that resolves to DEFAULT (base combo)
    const invalidDefaultRowIds = new Set<string>();

    const realRows = rows.filter(isRealVariantRow);

    for (const row of realRows) {
      const key = sparseComboKey(row.selections, attrOrder);

      // DEFAULT reserved for base only.
      if (key === "DEFAULT" && !!row.variantId) {
        invalidDefaultRowIds.add(row.id);
      }

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
      const sample = realRows.find((r) => sparseComboKey(r.selections, attrOrder) === k);
      return sample ? formatComboLabel(sample.selections, attrOrder, attrNameById, valueNameById) : k;
    });

    const dupExplain =
      dups.size > 0
        ? `Duplicate variant combinations found: ${labels.join(
          " • "
        )}. Please change options or remove one of the duplicate rows.`
        : null;

    const defaultExplain =
      invalidDefaultRowIds.size > 0
        ? "A variant row cannot be DEFAULT (no options selected). DEFAULT is reserved for the base product combo."
        : null;

    const explain = [dupExplain, defaultExplain].filter(Boolean).join(" ");

    return {
      duplicateRowIds: dups,
      duplicateLabels: labels,
      explain: explain || null,
      invalidDefaultRowIds,
    };
  };

  const liveDup = useMemo(() => computeDupInfo(variantRows), [variantRows, attrOrder, attrNameById, valueNameById]);
  const duplicateRowIds = liveDup.duplicateRowIds;
  const invalidDefaultRowIds = liveDup.invalidDefaultRowIds;

  const hasDuplicates = duplicateRowIds.size > 0;
  const hasInvalidDefaultVariant = invalidDefaultRowIds.size > 0;

  useEffect(() => {
    setDupWarn(liveDup.explain);
  }, [liveDup.explain]);

  const activeAttrs = useMemo(() => (attributes ?? []).filter((a) => a?.isActive !== false), [attributes]);

  const canEditCore = !offersOnly;
  const canAddNewCombos = !offersOnly;
  const canEditAttributes = !offersOnly;

  /* =========================================================
     ✅ BaseCombo vs VariantCombo guard (STRICT)
  ========================================================= */

  const baseComboSelections = useMemo(() => {
    const sel: Record<string, string> = {};
    for (const aid of attrOrder) {
      const v = selectedAttrs?.[aid];
      sel[aid] = typeof v === "string" ? String(v || "").trim() : "";
    }
    return sel;
  }, [selectedAttrs, attrOrder]);

  const baseComboHasAny = useMemo(() => rowHasAnySelection(baseComboSelections), [baseComboSelections]);
  const baseComboKey = useMemo(() => strictComboKey(baseComboSelections, attrOrder), [baseComboSelections, attrOrder]);

  const baseComboConflict = useMemo(() => {
    if (!attrOrder.length) return { rowIds: new Set<string>(), labels: [] as string[] };
    if (!baseComboHasAny) return { rowIds: new Set<string>(), labels: [] as string[] };

    const ids = new Set<string>();
    const labels: string[] = [];

    for (const row of variantRows) {
      if (!isRealVariantRow(row)) continue;
      if (!rowHasAnySelection(row.selections)) continue;

      const key = strictComboKey(row.selections, attrOrder);
      if (key === baseComboKey) {
        ids.add(row.id);
        const lbl = row.comboLabel || formatComboLabel(row.selections, attrOrder, attrNameById, valueNameById);
        labels.push(lbl);
      }
    }

    return { rowIds: ids, labels: Array.from(new Set(labels)) };
  }, [variantRows, attrOrder, baseComboHasAny, baseComboKey, attrNameById, valueNameById]);

  const hasBaseComboConflict = baseComboConflict.rowIds.size > 0;

  const baseComboWarn = useMemo(() => {
    if (!hasBaseComboConflict) return null;
    const list = baseComboConflict.labels.length ? baseComboConflict.labels.join(" • ") : "a variant row";
    return `Base attributes selection matches ${list}. Base combo must be different from all variant combos.`;
  }, [hasBaseComboConflict, baseComboConflict.labels]);

  const setAttr = (attributeId: string, value: string | string[]) => {
    if (offersOnly) return;

    // ✅ Prevent changing BASE SELECT attributes to match an existing variant combo
    const isSelectAttr = attrOrder.includes(String(attributeId));
    if (isSelectAttr && typeof value === "string") {
      const nextSelected = { ...selectedAttrs, [attributeId]: value };

      const nextBase: Record<string, string> = {};
      for (const aid of attrOrder) {
        const v = nextSelected?.[aid];
        nextBase[aid] = typeof v === "string" ? String(v || "").trim() : "";
      }

      const nextHasAny = rowHasAnySelection(nextBase);
      if (nextHasAny) {
        const nextKey = strictComboKey(nextBase, attrOrder);
        const conflicts = variantRows.some((r) => {
          if (!isRealVariantRow(r)) return false;
          if (!rowHasAnySelection(r.selections)) return false;
          return strictComboKey(r.selections, attrOrder) === nextKey;
        });

        if (conflicts) {
          setErr(
            "That base attribute combination matches an existing variant combo. Change base attributes or the variant."
          );
          // ✅ do NOT block — let user rectify
        }

      }
    }

    setSelectedAttrs((prev) => ({ ...prev, [attributeId]: value }));
  };

  useEffect(() => {
    setSkuTouched(false);
  }, [detailQ.data?.id]);

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

    const currentImgs = getAllImagesFromUi().slice(0, MAX_IMAGES_PER_PRODUCT);
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

    return (
      titleChanged ||
      skuChanged ||
      catChanged ||
      brandChanged ||
      descChanged ||
      imagesChanged ||
      attrChanged ||
      newCombosAdded
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // Images: hydrate but respect max=5
    const urls = normalizeImages(p).filter(isUrlish);
    const uniq = Array.from(new Set(urls)).slice(0, MAX_IMAGES_PER_PRODUCT);
    setImageUrls(uniq.join("\n"));
    setUploadedUrls([]);

    const baseQty = p.offer ? (p.offer.availableQty ?? 0) : (p.availableQty ?? 0);
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

      const qty = myOffer?.availableQty ?? v?.availableQty ?? 0;

      // ✅ hydrate per-variant price
      const offerUnit = Number(myOffer?.unitPrice ?? NaN);
      const variantRetail =
        Number(v?.retailPrice ?? NaN) || Number(v?.unitPrice ?? NaN) || Number(v?.price ?? NaN);

      const activeUnitPrice = Number.isFinite(offerUnit) && offerUnit > 0 ? offerUnit : baseP;

      const unitForInput = offersOnly
        ? activeUnitPrice
        : Number.isFinite(variantRetail) && variantRetail > 0
          ? variantRetail
          : baseP;

      return {
        id: uid("vr"),
        variantId,
        isExisting: true,
        selections,
        comboLabel,
        availableQty: String(Number(qty) || 0),
        unitPrice: String(Number(unitForInput) || 0),
        activeUnitPrice: offersOnly ? activeUnitPrice : undefined,
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
      images: uniq,
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

  // ---------- Images (max 5) ----------
  const urlPreviews = useMemo(() => parseUrlList(imageUrls).filter(isUrlish), [imageUrls]);

  const allUrlPreviews = useMemo(() => {
    const uniq = new Set<string>();
    [...urlPreviews, ...uploadedUrls].forEach((u) => {
      if (u && isUrlish(u)) uniq.add(u);
    });
    return Array.from(uniq);
  }, [urlPreviews, uploadedUrls]);

  const imageCount = allUrlPreviews.length;
  const imageOverLimit = imageCount > MAX_IMAGES_PER_PRODUCT;
  const imageSlotsLeft = Math.max(0, MAX_IMAGES_PER_PRODUCT - imageCount);

  function getAllImagesFromUi(): string[] {
    const uniq = new Set<string>();
    for (const u of [...parseUrlList(imageUrls), ...uploadedUrls]) {
      if (u && isUrlish(u)) uniq.add(u);
    }
    return Array.from(uniq);
  }

  // ✅ cookie-auth upload (enforces max images)
  async function uploadLocalFiles(): Promise<string[]> {
    if (!files.length) return [];

    const current = getAllImagesFromUi();
    if (current.length >= MAX_IMAGES_PER_PRODUCT) {
      setErr(`Max ${MAX_IMAGES_PER_PRODUCT} images allowed. Remove an image URL before uploading more.`);
      return [];
    }
    if (current.length + files.length > MAX_IMAGES_PER_PRODUCT) {
      setErr(`You can only upload ${MAX_IMAGES_PER_PRODUCT - current.length} more image(s). Remove extras or upload fewer.`);
      return [];
    }

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

      const next = new Set<string>(current);
      for (const u of clean) {
        if (next.size >= MAX_IMAGES_PER_PRODUCT) break;
        if (u && isUrlish(u)) next.add(String(u));
      }

      setUploadedUrls((prev) => {
        const prevSet = new Set<string>(prev.filter(isUrlish));
        for (const u of Array.from(next)) prevSet.add(u);
        const merged = Array.from(new Set([...parseUrlList(imageUrls).filter(isUrlish), ...Array.from(prevSet)]));
        return merged.slice(0, MAX_IMAGES_PER_PRODUCT);
      });

      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";

      const finalArr = Array.from(next);
      if (current.length + clean.length > MAX_IMAGES_PER_PRODUCT) {
        setErr(`Only the first ${MAX_IMAGES_PER_PRODUCT} images are kept. Remove images to add different ones.`);
      }

      return finalArr.slice(0, MAX_IMAGES_PER_PRODUCT);
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

    // ✅ start variant price from current base input
    const baseNow = toMoneyNumber(retailPrice);
    const next = [...variantRows, { id: uid("vr"), selections, availableQty: "", unitPrice: String(baseNow || 0) }];
    setVariantRowsAndCheck(next);
  }

  function updateVariantSelection(rowId: string, attributeId: string, valueId: string) {
    setErr(null);
    if (offersOnly) return;

    const next = variantRows.map((r) =>
      r.id === rowId ? { ...r, selections: { ...r.selections, [attributeId]: valueId } } : r
    );

    // ✅ Prevent a variant combo from matching base combo (STRICT)
    if (attrOrder.length && baseComboHasAny) {
      const changed = next.find((r) => r.id === rowId);
      if (changed && rowHasAnySelection(changed.selections)) {
        const changedKey = strictComboKey(changed.selections, attrOrder);
        if (changedKey === baseComboKey) {
          setErr(
            "That variant combination matches your base attributes selection (base combo). Change the variant options or base attributes."
          );
          // ✅ do NOT block — let user rectify
        }

      }
    }

    setVariantRowsAndCheck(next);
  }

  function updateVariantQty(rowId: string, v: string) {
    const next = variantRows.map((r) => (r.id === rowId ? { ...r, availableQty: v } : r));
    setVariantRowsAndCheck(next);
  }

  function updateVariantPrice(rowId: string, v: string) {
    const next = variantRows.map((r) => (r.id === rowId ? { ...r, unitPrice: v } : r));
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

  // ---------- Payload builders (aligned with schema) ----------
  function buildAttributeSelectionsPayload() {
    const out: Array<{ attributeId: string; text?: string; valueId?: string; valueIds?: string[] }> = [];
    for (const a of (attributes ?? []) as any[]) {
      if (!a?.id) continue;
      const aid = String(a.id);

      if (a.type === "TEXT") {
        const v = String(getAttrVal(aid) ?? "").trim();
        if (v) out.push({ attributeId: aid, text: v });
        continue;
      }

      if (a.type === "SELECT") {
        const v = String(getAttrVal(aid) ?? "").trim();
        if (v) out.push({ attributeId: aid, valueId: v });
        continue;
      }

      if (a.type === "MULTISELECT") {
        const vals = Array.isArray(getAttrVal(aid)) ? (getAttrVal(aid) as string[]) : [];
        const clean = vals.map(String).map((x) => x.trim()).filter(Boolean);
        if (clean.length) out.push({ attributeId: aid, valueIds: clean });
        continue;
      }
    }
    return out;
  }

  function buildVariantsPayload() {
    // ✅ variants must have at least one option selected (prevents DEFAULT/base-only)
    const rows = variantRows.filter((r) => isRealVariantRow(r) && rowHasAnySelection(r.selections));

    const basePrice = toMoneyNumber(retailPrice);

    return rows.map((r) => {
      const opts = attrOrder
        .map((aid) => {
          const vid = String(r.selections?.[aid] ?? "").trim();
          if (!vid) return null;
          return { attributeId: aid, valueId: vid };
        })
        .filter(Boolean) as Array<{ attributeId: string; valueId: string }>;

      const rowUnit = toMoneyNumber(r.unitPrice);
      const finalUnit = rowUnit > 0 ? rowUnit : basePrice;

      return {
        ...(r.variantId ? { id: String(r.variantId) } : {}),
        retailPrice: finalUnit,
        availableQty: toIntNonNeg(r.availableQty),
        inStock: toIntNonNeg(r.availableQty) > 0,
        isActive: true,
        imagesJson: [],
        options: opts,
      };
    });
  }

  function buildStockOnlyPayload(args: { baseQty: number; variantRows: VariantRow[] }) {
    const baseQty = toIntNonNeg(args.baseQty);

    const existingRows = args.variantRows.filter((r) => !!r.variantId);

    const variants = existingRows.map((r) => ({
      id: String(r.variantId),
      availableQty: toIntNonNeg(r.availableQty),
      inStock: toIntNonNeg(r.availableQty) > 0,
    }));

    const sumVariants = existingRows.reduce((s, r) => s + toIntNonNeg(r.availableQty), 0);
    const total = baseQty + sumVariants;

    return {
      availableQty: baseQty,
      inStock: total > 0,
      variants,
      stockOnly: true,
    };
  }

  function buildPayload(imagesJson: string[]) {
    const price = toMoneyNumber(retailPrice);
    const baseQty = baseQtyPreview;

    const core: any = {
      description: (description ?? "").trim(),

      basePrice: price,
      offer: {
        basePrice: price,
        availableQty: baseQty,
        inStock: totalQty > 0,
        isActive: true,
        currency: "NGN",
        leadDays: null,
      },

      categoryId: categoryId || null,
      brandId: brandId || null,
      imagesJson,

      availableQty: baseQty,
      inStock: totalQty > 0,

      attributeSelections: buildAttributeSelectionsPayload(),
      variants: buildVariantsPayload(),
      stockOnly: false,
    };

    if (!isLive) {
      core.title = title.trim();
      core.sku = sku.trim();
    }

    return core;
  }

  const updateM = useMutation({

    mutationFn: async () => {
      setErr(null);
      setOkMsg(null);
      if (
        imageOverLimit ||
        hasBaseComboConflict ||
        hasDuplicates ||
        hasInvalidDefaultVariant
      ) {
        throw new Error(
          imageOverLimit
            ? `Max ${MAX_IMAGES_PER_PRODUCT} images allowed. Remove extra images to continue.`
            : baseComboWarn
              ? baseComboWarn
              : dupWarn || "Fix the errors above to save."
        );
      }


      if (!id) throw new Error("Missing product id");

      const imagesFromUi = getAllImagesFromUi();
      if (imagesFromUi.length > MAX_IMAGES_PER_PRODUCT) {
        throw new Error(
          `Max ${MAX_IMAGES_PER_PRODUCT} images allowed. Please remove ${imagesFromUi.length - MAX_IMAGES_PER_PRODUCT} image(s).`
        );
      }

      const basePrice = toMoneyNumber(retailPrice);
      if (!Number.isFinite(basePrice) || basePrice <= 0) throw new Error("Price must be greater than 0");

      // ✅ block base combo matching a variant combo
      if (hasBaseComboConflict) {
        throw new Error(baseComboWarn || "Base combo matches a variant combo. Please change one of them.");
      }

      // ✅ block invalid DEFAULT variant
      if (hasInvalidDefaultVariant) {
        throw new Error("A variant row cannot be DEFAULT (no options selected). DEFAULT is reserved for the base combo.");
      }

      // ✅ validate per-variant price when the row is a real variant combo
      const realVariantRows = variantRows.filter((r) => isRealVariantRow(r) && rowHasAnySelection(r.selections));
      for (const r of realVariantRows) {
        const rowUnit = toMoneyNumber(r.unitPrice);
        if (!Number.isFinite(rowUnit) || rowUnit <= 0) {
          throw new Error("Each variant must have a valid price greater than 0.");
        }
      }

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

          const unitPrice = toMoneyNumber(r.unitPrice);
          if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
            throw new Error("Each variant offer must have a valid unit price greater than 0.");
          }

          tasks.push(
            api.put(
              `/api/supplier/catalog/offers/variant`,
              {
                productId: id,
                variantId: r.variantId,
                unitPrice,
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

      // ---------- owned-product path ----------
      if (!title.trim()) throw new Error("Title is required");
      if (!sku.trim()) throw new Error("SKU is required");
      if (!String(description ?? "").trim()) throw new Error("Description is required");

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

      // Build final images list (clamped and validated)
      const urlList = parseUrlList(imageUrls).filter(isUrlish);
      const current = Array.from(new Set([...urlList, ...uploadedUrls].filter(Boolean))).slice(0, MAX_IMAGES_PER_PRODUCT);

      const freshlyUploaded = files.length ? await uploadLocalFiles() : [];
      const merged = Array.from(new Set([...current, ...freshlyUploaded].filter(isUrlish))).slice(0, MAX_IMAGES_PER_PRODUCT);

      if (merged.length > MAX_IMAGES_PER_PRODUCT) {
        throw new Error(`Max ${MAX_IMAGES_PER_PRODUCT} images allowed. Please remove extras.`);
      }

      const payload = stockOnlyUpdate
        ? buildStockOnlyPayload({ baseQty: baseQtyPreview, variantRows })
        : {
          ...buildPayload(merged),
          submitForReview: isLive && nonStockChangesRequireReview,
          stockOnly: false,
        };

      const { data } = await api.patch(`/api/supplier/products/${id}`, payload, {
        withCredentials: true,
      });

      return data;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["supplier"] });

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

  const hasBlockingError =
    imageOverLimit ||
    hasBaseComboConflict ||
    hasDuplicates ||
    hasInvalidDefaultVariant;

  const saveDisabled =
    updateM.isPending ||
    uploading ||
    detailQ.isLoading ||
    !hydrated ||
    !isSupplier ||
    hasBlockingError;


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

  const guardMsg = !hydrated ? "Loading session…" : !isSupplier ? "This page is for suppliers only." : null;

  return (
    <SiteLayout>
      <SupplierLayout>
        <div className="mt-4 sm:mt-6 space-y-4">
          {/* Header */}
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
                  This product is <b>{productStatusUpper || "LIVE"}</b>. <b>Stock updates</b> are immediate. Other changes
                  may be <b>submitted for review</b>.
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
                  if (hasBlockingError) {
                    setErr(
                      imageOverLimit
                        ? `Max ${MAX_IMAGES_PER_PRODUCT} images allowed. Remove extra images to continue.`
                        : baseComboWarn
                          ? baseComboWarn
                          : dupWarn || "Fix the errors above to save."
                    );
                    return;
                  }
                  updateM.mutate();
                }}

                className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2 text-[13px] sm:text-sm font-semibold disabled:opacity-60"
                title={
                  imageOverLimit
                    ? `Remove extra images (max ${MAX_IMAGES_PER_PRODUCT}).`
                    : hasBaseComboConflict
                      ? "Fix base combo vs variant combo conflict to save."
                      : hasDuplicates || hasInvalidDefaultVariant
                        ? "Fix duplicate/invalid combinations to save."
                        : undefined
                }
              >
                <Save size={16} /> {updateM.isPending ? "Saving…" : offersOnly ? "Save offer" : "Save changes"}
              </button>
            </div>
          </div>

          {/* Alerts */}
          {guardMsg && (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">{guardMsg}</div>
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

          {imageOverLimit && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
              <b>Images limit:</b> You have <b>{imageCount}</b> images. Max is <b>{MAX_IMAGES_PER_PRODUCT}</b>. Remove{" "}
              <b>{imageCount - MAX_IMAGES_PER_PRODUCT}</b>.
            </div>
          )}

          {baseComboWarn && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
              <b>Base/Variant conflict:</b> {baseComboWarn}
            </div>
          )}

          {dupWarn && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
              <b>Variant issue:</b> {dupWarn}
            </div>
          )}

          {err && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{err}</div>
          )}
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

          {/* Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              {/* Basic info */}
              <Card
                title="Basic information"
                subtitle={
                  offersOnly
                    ? "Catalog product details are read-only. Set your offer price and stock."
                    : isLive
                      ? "LIVE listing: Title/SKU/base price are locked. Stock updates are always allowed."
                      : undefined
                }
              >
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Title *</label>
                      <input
                        value={title}
                        onChange={(e) => {
                          const nextTitle = e.target.value;
                          setTitle(nextTitle);

                          if (!offersOnly && !isLive && !skuTouched) {
                            setSku(autoSkuFromTitle(nextTitle));
                          }
                        }}
                        disabled={!canEditCore || isLive}
                        readOnly={!canEditCore || isLive}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">SKU *</label>
                      <input
                        value={sku}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSku(v);
                          if (v.trim() === "") setSkuTouched(false);
                          else setSkuTouched(true);
                        }}
                        disabled={!canEditCore || isLive}
                        readOnly={!canEditCore || isLive}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white disabled:opacity-60"
                      />
                    </div>
                  </div>

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
                      {variantsEnabled && <div className="text-[11px] text-zinc-500 mt-1">Variant quantities add on top.</div>}
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
                    <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Description *</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      disabled={!canEditCore}
                      className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white min-h-[110px] disabled:opacity-60"
                    />
                  </div>

                  {/* Attributes */}
                  <div
                    className={`rounded-2xl border bg-white overflow-hidden ${hasBaseComboConflict ? "border-rose-300 ring-2 ring-rose-200" : ""
                      }`}
                  >
                    <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70">
                      <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">Attributes</div>
                      <div className="text-[11px] sm:text-xs text-zinc-500 mt-0.5">
                        {offersOnly
                          ? "Catalog product attributes are read-only."
                          : isLive
                            ? "LIVE listing: edits may require review."
                            : "You can edit attributes freely while not LIVE."}
                      </div>

                      {hasBaseComboConflict && (
                        <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
                          <b>Conflict:</b> This base combo matches a variant combo. Change the base SELECT attributes (or the variant).
                        </div>
                      )}
                    </div>

                    <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {activeAttrs.length === 0 && <div className="text-sm text-zinc-500">No active attributes configured.</div>}

                      {activeAttrs.map((a: any) => {
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
                          const highlight = hasBaseComboConflict && attrOrder.includes(String(a.id));
                          return (
                            <div key={a.id}>
                              <label className="block text-[11px] font-semibold text-zinc-700 mb-1">{a.name}</label>
                              <select
                                value={val}
                                onChange={(e) => setAttr(a.id, e.target.value)}
                                disabled={!canEditAttributes}
                                className={`w-full rounded-xl border px-3 py-2.5 text-sm bg-white disabled:opacity-60 ${highlight ? "border-rose-300 ring-2 ring-rose-100" : ""
                                  }`}
                              >
                                <option value="">— Select —</option>
                                {(a.values || []).map((v: any) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name}
                                  </option>
                                ))}
                              </select>
                              {highlight && (
                                <div className="text-[11px] text-rose-700 mt-1">
                                  This base selection is conflicting with a variant combo.
                                </div>
                              )}
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
                subtitle={offersOnly ? "Catalog images are read-only." : `Paste URLs or upload images. Max ${MAX_IMAGES_PER_PRODUCT} images per product.`}
                right={
                  <label
                    className={`inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-[13px] sm:text-sm font-semibold hover:bg-black/5 cursor-pointer ${offersOnly || imageSlotsLeft <= 0 ? "opacity-60 pointer-events-none" : ""
                      }`}
                    title={imageSlotsLeft <= 0 ? `Max ${MAX_IMAGES_PER_PRODUCT} images reached.` : undefined}
                  >
                    <ImagePlus size={16} /> Add files
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const picked = Array.from(e.target.files || []);
                        if (!picked.length) return;

                        if (imageSlotsLeft <= 0) {
                          setErr(`Max ${MAX_IMAGES_PER_PRODUCT} images allowed. Remove an image before adding more.`);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                          return;
                        }

                        if (picked.length > imageSlotsLeft) {
                          setErr(`You can only add ${imageSlotsLeft} more file(s). Extra files were ignored.`);
                        }

                        setFiles(picked.slice(0, imageSlotsLeft));
                      }}
                      disabled={offersOnly || imageSlotsLeft <= 0}
                    />
                  </label>
                }
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-zinc-600">
                      Images used: <b className={imageOverLimit ? "text-rose-700" : "text-zinc-900"}>{imageCount}</b> /{" "}
                      <b>{MAX_IMAGES_PER_PRODUCT}</b>
                    </div>
                    {!offersOnly && (
                      <div className="text-[11px] text-zinc-500">{imageSlotsLeft > 0 ? `${imageSlotsLeft} slot(s) left` : "No slots left"}</div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Image URLs (one per line)</label>
                    <textarea
                      value={imageUrls}
                      onChange={(e) => setImageUrls(e.target.value)}
                      disabled={offersOnly}
                      className={`w-full rounded-xl border px-3 py-2.5 text-xs bg-white min-h-[90px] disabled:opacity-60 ${imageOverLimit ? "border-rose-300" : ""
                        }`}
                    />
                    {!offersOnly && imageOverLimit && (
                      <div className="text-[11px] text-rose-700 mt-1">
                        Remove extra URLs. Saving is blocked until you have {MAX_IMAGES_PER_PRODUCT} or fewer.
                      </div>
                    )}
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
                      {allUrlPreviews.slice(0, MAX_IMAGES_PER_PRODUCT).map((u) => (
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
                      {allUrlPreviews.length > MAX_IMAGES_PER_PRODUCT && (
                        <div className="rounded-xl border bg-zinc-50 p-3 text-xs text-zinc-600 flex items-center justify-center">
                          +{allUrlPreviews.length - MAX_IMAGES_PER_PRODUCT} more (remove extras to save)
                        </div>
                      )}
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
                    ? "Catalog product: set price + qty for existing variants. You can’t create new combos."
                    : isLive
                      ? "LIVE listing: update qty only. Prices/options are locked."
                      : "Add/remove combos while not LIVE. Variants must have at least one option selected (DEFAULT is base-only)."
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
                      const isInvalidDefault = invalidDefaultRowIds.has(row.id);
                      const isBaseConflict = baseComboConflict.rowIds.has(row.id);

                      const rowQty = toIntNonNeg(row.availableQty);
                      const rowInStock = rowQty > 0;

                      const disableRemove = offersOnly ? !row.variantOfferId && rowQty <= 0 : isLive && row.isExisting;

                      const activeUnitPrice = offersOnly
                        ? Number(row.activeUnitPrice ?? activeBasePriceForDisplay)
                        : toMoneyNumber(row.unitPrice) || basePriceForPreview;

                      const pendingVar = row.variantId ? pendingVariantPatchByVariantId.get(String(row.variantId)) : null;
                      const pendingVarUnitPrice = Number(pendingVar?.proposedPatch?.unitPrice ?? NaN);
                      const hasPendingVarPrice =
                        offersOnly &&
                        Number.isFinite(pendingVarUnitPrice) &&
                        pendingVarUnitPrice > 0 &&
                        pendingVarUnitPrice !== Number(row.activeUnitPrice ?? activeBasePriceForDisplay);

                      const selectionLocked = offersOnly || row.isExisting || isLive;
                      const priceLocked = (!offersOnly && isLive) || false;

                      const isDraftNoSelection = !row.variantId && !rowHasAnySelection(row.selections);
                      const draftHasEdits =
                        isDraftNoSelection &&
                        (String(row.availableQty || "").trim() !== "" || String(row.unitPrice || "").trim() !== "");

                      const hasAnyIssue = isDup || isInvalidDefault || isBaseConflict;

                      return (
                        <div
                          key={row.id}
                          className={`rounded-2xl border bg-white p-3 space-y-2 ${hasAnyIssue ? "border-rose-400 ring-2 ring-rose-200" : ""
                            }`}
                        >
                          {/* option selects */}
                          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                            {selectableAttrs.map((attr: any) => {
                              const valueId = row.selections[attr.id] || "";
                              return (
                                <select
                                  key={attr.id}
                                  value={valueId}
                                  onChange={(e) => updateVariantSelection(row.id, attr.id, e.target.value)}
                                  className={`rounded-xl border px-3 py-2 text-xs bg-white ${hasAnyIssue ? "border-rose-300" : ""
                                    }`}
                                  disabled={selectionLocked}
                                  title={
                                    selectionLocked
                                      ? "Variant options are fixed; edit price/qty only."
                                      : "Select variant option value."
                                  }
                                >
                                  <option value="">{attr.name}</option>
                                  {(attr.values || []).map((v: any) => (
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
                                <b className={hasAnyIssue ? "text-rose-700" : "text-zinc-900"}>{comboText}</b>
                              </div>

                              <div className="text-[11px] text-zinc-500 mt-1 flex flex-wrap gap-3">
                                <span>
                                  {offersOnly ? "Unit (approved):" : "Unit:"}{" "}
                                  <b className="text-zinc-900">{ngn.format(activeUnitPrice)}</b>
                                </span>
                                <span>
                                  Qty: <b className="text-zinc-900">{rowQty}</b>
                                </span>
                                <span
                                  className={`font-semibold px-2 py-0.5 rounded-full border ${rowInStock
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

                              {draftHasEdits && (
                                <div className="text-[11px] text-amber-700 mt-1">
                                  Select at least one option to create a variant. Otherwise this row is ignored.
                                </div>
                              )}
                            </div>

                            <div className="sm:ml-auto flex flex-wrap items-center gap-2">
                              <span className="text-xs text-zinc-500">Price</span>
                              <input
                                value={row.unitPrice}
                                onChange={(e) => updateVariantPrice(row.id, e.target.value)}
                                inputMode="decimal"
                                disabled={priceLocked}
                                readOnly={priceLocked}
                                className={`w-28 rounded-xl border px-3 py-2 text-xs bg-white ${hasAnyIssue ? "border-rose-300" : ""
                                  } ${priceLocked ? "opacity-60" : ""}`}
                                placeholder="e.g. 25000"
                                title={priceLocked ? "LIVE listing: variant price is locked." : "Set this variant unit price."}
                              />

                              <span className="text-xs text-zinc-500">Qty</span>
                              <input
                                value={row.availableQty}
                                onChange={(e) => updateVariantQty(row.id, e.target.value)}
                                inputMode="numeric"
                                className={`w-24 rounded-xl border px-3 py-2 text-xs bg-white ${hasAnyIssue ? "border-rose-300" : ""
                                  }`}
                                placeholder="e.g. 5"
                              />

                              <button
                                type="button"
                                onClick={() => removeVariantRow(row.id)}
                                disabled={disableRemove}
                                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${disableRemove
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

                          {hasAnyIssue && (
                            <div className="text-[11px] text-rose-700">
                              {isBaseConflict ? "Invalid: this variant combo matches your base attributes selection (base combo)." : null}
                              {isBaseConflict && (isInvalidDefault || isDup) ? " " : null}
                              {isInvalidDefault
                                ? "Invalid: a variant cannot be DEFAULT (no options selected). DEFAULT is reserved for base."
                                : null}
                              {(isBaseConflict || isInvalidDefault) && isDup ? " " : null}
                              {isDup ? "Duplicate combination. Change options or remove one of the matching rows." : null}
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

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500">Images</span>
                    <b className={imageOverLimit ? "text-rose-700" : "text-zinc-900"}>
                      {imageCount}/{MAX_IMAGES_PER_PRODUCT}
                    </b>
                  </div>

                  {!offersOnly && isLive && nonStockChangesRequireReview && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-xs">
                      Non-stock changes → <b>admin review</b>.
                    </div>
                  )}

                  {(hasBaseComboConflict || hasDuplicates || hasInvalidDefaultVariant) && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-xs">
                      Saving is blocked until base/variant conflicts and variant issues are fixed.
                    </div>
                  )}

                  {imageOverLimit && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-xs">
                      Saving is blocked until images are ≤ {MAX_IMAGES_PER_PRODUCT}.
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                disabled={saveDisabled}
                onClick={() => {
                  if (hasBlockingError) {
                    setErr(
                      imageOverLimit
                        ? `Max ${MAX_IMAGES_PER_PRODUCT} images allowed. Remove extra images to continue.`
                        : baseComboWarn
                          ? baseComboWarn
                          : dupWarn || "Fix the errors above to save."
                    );
                    return;
                  }
                  updateM.mutate();
                }}

                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-white px-4 py-3 text-sm font-semibold disabled:opacity-60"
                title={
                  imageOverLimit
                    ? `Remove extra images (max ${MAX_IMAGES_PER_PRODUCT}).`
                    : hasBaseComboConflict
                      ? "Fix base combo vs variant combo conflict to save."
                      : hasDuplicates || hasInvalidDefaultVariant
                        ? "Fix duplicate/invalid combinations to save."
                        : undefined
                }
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
