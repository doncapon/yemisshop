// src/pages/supplier/SupplierEditProduct.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ImagePlus, Save, Trash2, Plus, Package } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { useCatalogMeta } from "../../hooks/useCatalogMeta";

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
  availableQty?: number;

  offer?: {
    id?: string;
    basePrice: number;
    currency?: string;
    inStock?: boolean;
    isActive?: boolean;
    leadDays?: number | null;
    availableQty?: number;
  } | null;

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
  id: string; // UI row id
  variantId?: string; // ProductVariant.id for existing variants
  selections: Record<string, string>;
  priceBump: string;
  availableQty: string;
  isExisting?: boolean;
  comboLabel?: string;
  rawOptions?: Array<{ attributeId: string; valueId: string }>;
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

/* =========================
   Component
========================= */

export default function SupplierEditProduct() {
  const nav = useNavigate();
  const { id } = useParams();
  const token = useAuthStore((s) => s.token);

  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [dupWarn, setDupWarn] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
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

  // ---------- Price-change review tracking ----------
  const initialBasePriceRef = useRef<number>(0);
  const initialBumpByVariantIdRef = useRef<Map<string, number>>(new Map());

  // ✅ NEW: initial snapshot for review/change detection & "no-delete" guards (LIVE only)
  const initialSnapshotRef = useRef<{
    id: string;
    title: string;
    sku: string;
    categoryId: string | null;
    brandId: string | null;
    description: string;
    images: string[]; // normalized
    attr: Record<string, string | string[]>; // normalized
    multiAttrValues: Record<string, Set<string>>; // for multi-select "cannot remove"
    existingVariantIds: Set<string>;
  } | null>(null);

  const onChangeBasePrice = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isLive) {
      setErr("This product is LIVE. Base price is locked. You can update stock/qty only.");
      // revert immediately to the locked value
      setPrice(String(Number(initialBasePriceRef.current ?? 0)));
      return;
    }
    setPrice(e.target.value);
  };


  // hydration guards
  const hydratedBaseForIdRef = useRef<string | null>(null);
  const hydratedAttrsForIdRef = useRef<string | null>(null);

  const ngn = useMemo(
    () =>
      new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 2,
      }),
    []
  );

  const { categories, brands, attributes, categoriesQ, brandsQ } = useCatalogMeta({
    enabled: !!token,
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

  // Ensure selection object has all SELECT attrs as keys
  // ✅ also apply rawOptions when they exist
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

  const detailQ = useQuery<SupplierProductDetail>({
    queryKey: ["supplier", "product", id],
    enabled: !!token && !!id,
    queryFn: async () => {
      const headers = { Authorization: `Bearer ${token}` };

      const attempts = [
        `/api/supplier/products/${id}?include=offer,variants,images,attributes`,
        `/api/supplier/products/${id}?include=offer,variants`,
        `/api/supplier/products/${id}`,
      ];

      let lastErr: any = null;

      for (const url of attempts) {
        try {
          const res = await api.get(url, { headers });
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

  const productStatusUpper = useMemo(
    () => String(detailQ.data?.status ?? "").toUpperCase(),
    [detailQ.data?.status]
  );

  // "LIVE mode" = anything other than PENDING/REJECTED
  const isLive = useMemo(() => !["PENDING", "REJECTED"].includes(productStatusUpper), [productStatusUpper]);

  // ✅ Industry standard: price fields are locked once LIVE (stock remains editable)
  const canEditPrices = useMemo(() => !isLive, [isLive]);
  const canEditExistingVariantBumps = useMemo(() => !isLive, [isLive]);

  // For consistent previews/payloads while LIVE (defense-in-depth)
  const basePriceForPreview = useMemo(
    () => (isLive ? Number(initialBasePriceRef.current ?? 0) : toMoneyNumber(price)),
    [isLive, price]
  );

  // A "real variant" = at least one option picked
  const isRealVariantRow = (r: VariantRow) => rowHasAnySelection(r.selections);

  const variantQtyTotal = useMemo(() => {
    return variantRows.reduce((sum, r) => {
      return sum + (isRealVariantRow(r) ? toIntNonNeg(r.availableQty) : 0);
    }, 0);
  }, [variantRows]);

  const emptyRowQtyTotal = useMemo(() => {
    return variantRows.reduce((sum, r) => {
      return sum + (!isRealVariantRow(r) ? toIntNonNeg(r.availableQty) : 0);
    }, 0);
  }, [variantRows]);

  const baseQtyPreview = useMemo(() => toIntNonNeg(availableQty), [availableQty]);
  const defaultStockQty = useMemo(() => baseQtyPreview + emptyRowQtyTotal, [baseQtyPreview, emptyRowQtyTotal]);

  const totalQty = useMemo(() => defaultStockQty + variantQtyTotal, [defaultStockQty, variantQtyTotal]);

  const inStockPreview = totalQty > 0;

  const variantsEnabled = useMemo(() => variantRows.some(isRealVariantRow), [variantRows]);

  const effectiveQty = useMemo(() => totalQty, [totalQty]);

  /**
   * ✅ One function used everywhere for "instant" duplicate checking.
   */
  const computeDupInfo = (rows: VariantRow[]): DupInfo => {
    const seen = new Map<string, string>(); // key -> firstRowId
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
    if (hasDuplicates) setDupWarn(liveDup.explain);
    else setDupWarn(null);
  }, [hasDuplicates, liveDup.explain]);

  // ---------- Attributes UI helpers ----------
  const activeAttrs = useMemo(() => (attributes ?? []).filter((a) => a?.isActive !== false), [attributes]);

  // STOCK is always editable. Everything else is editable too, but LIVE changes will be reviewed.
  const canEditCore = true;
  const canAddNewCombos = true;
  const canEditAttributes = true;

  const setAttr = (attributeId: string, value: string | string[]) => {
    // LIVE "no-delete" guard for MULTISELECT: cannot remove existing values (can only add)
    if (isLive) {
      const snap = initialSnapshotRef.current;
      const attrMeta = (attributes ?? []).find((a) => a.id === attributeId);
      if (snap && attrMeta?.type === "MULTISELECT") {
        const prevSet = snap.multiAttrValues[attributeId] ?? new Set<string>();
        const nextArr = Array.isArray(value) ? value.map(String) : [];
        const nextSet = new Set(nextArr);

        // if any previously selected value is missing => forbidden removal
        for (const v of prevSet) {
          if (!nextSet.has(v)) {
            setErr(
              "This product is LIVE. You can’t remove existing attribute values (they may be in use). You can only add more values."
            );
            return;
          }
        }
      }

      // LIVE "no-delete" guard for SELECT/TEXT: cannot clear existing value to empty
      if (snap && (attrMeta?.type === "SELECT" || attrMeta?.type === "TEXT")) {
        const prev = snap.attr[attributeId];
        const prevStr = Array.isArray(prev) ? "" : String(prev ?? "").trim();
        const nextStr = Array.isArray(value) ? "" : String(value ?? "").trim();

        if (prevStr && !nextStr) {
          setErr(
            "This product is LIVE. You can’t clear an existing attribute value. Change it to another value (or ask admin)."
          );
          return;
        }
      }
    }

    setSelectedAttrs((prev) => ({ ...prev, [attributeId]: value }));
  };

  const getAttrVal = (attributeId: string) => {
    const v = selectedAttrs?.[attributeId];
    if (Array.isArray(v)) return v;
    return String(v ?? "");
  };

  // ---------- Review detection ----------
  const priceChangeRequiresReview = useMemo(() => {
    // Price changes are locked while LIVE, so treat as not applicable in LIVE
    if (isLive) return false;

    const currentBase = toMoneyNumber(price);
    const baseChanged = currentBase !== (initialBasePriceRef.current ?? 0);

    let bumpChanged = false;
    for (const r of variantRows) {
      if (!r.variantId) continue;
      const now = toMoneyNumber(r.priceBump || 0);
      const was = initialBumpByVariantIdRef.current.get(r.variantId) ?? 0;
      if (now !== was) {
        bumpChanged = true;
        break;
      }
    }

    return baseChanged || bumpChanged;
  }, [isLive, price, variantRows]);

  // non-stock changes (LIVE => review)
  const nonStockChangesRequireReview = useMemo(() => {
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

    // attributes changed (any difference)
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

    // new variant combos added (rows without variantId but have any selection)
    const newCombosAdded = variantRows.some((r) => !r.variantId && rowHasAnySelection(r.selections));

    return titleChanged || skuChanged || catChanged || brandChanged || descChanged || imagesChanged || attrChanged || newCombosAdded;
  }, [isLive, detailQ.data, title, sku, categoryId, brandId, description, imageUrls, uploadedUrls, selectedAttrs, variantRows]);

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

    const baseP = Number(p.offer?.basePrice ?? p.basePrice ?? p.price ?? 0) || 0;
    setPrice(String(baseP));
    initialBasePriceRef.current = baseP;

    const urls = normalizeImages(p).filter(isUrlish);
    setImageUrls(urls.join("\n"));

    const baseQty = p.offer?.availableQty ?? p.availableQty ?? 0;
    setAvailableQty(String(Number(baseQty) || 0));

    const vList = normalizeVariants(p);

    initialBumpByVariantIdRef.current = new Map();

    const vr: VariantRow[] = (vList ?? []).map((v: any) => {
      const rawOptions = extractVariantOptions(v);

      const selections: Record<string, string> = {};
      selectableAttrs.forEach((a) => (selections[a.id] = ""));

      for (const o of rawOptions) {
        if (selections[o.attributeId] != null) selections[o.attributeId] = o.valueId;
      }

      const comboLabel = formatComboLabel(selections, attrOrder, attrNameById, valueNameById);

      const bump =
        v?.supplierVariantOffer?.priceBump ??
        v?.supplierOffer?.priceBump ??
        v?.priceBump ??
        v?.offerPriceBump ??
        0;

      const qty =
        v?.supplierVariantOffer?.availableQty ??
        v?.supplierOffer?.availableQty ??
        v?.availableQty ??
        v?.qty ??
        0;

      const variantId = String(v?.id ?? v?.variantId ?? "").trim();
      const bumpNum = bump ? Number(bump) : 0;

      if (variantId) {
        initialBumpByVariantIdRef.current.set(variantId, bumpNum);
      }

      return {
        id: uid("vr"),
        variantId,
        isExisting: true,
        selections,
        comboLabel,
        priceBump: bumpNum ? String(bumpNum) : "",
        availableQty: String(Number(qty) || 0),
        rawOptions,
      };
    });

    setVariantRows(vr);

    // set initial snapshot partially (attrs will be filled when attrs hydrate)
    initialSnapshotRef.current = {
      id: p.id,
      title: p.title || "",
      sku: p.sku || "",
      categoryId: p.categoryId ?? null,
      brandId: p.brandId ?? null,
      description: p.description ?? "",
      images: urls,
      attr: {}, // fill later
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

    for (const t of texts) {
      nextSel[t.attributeId] = t.value;
    }

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

    // fill snapshot attr + "no-remove" sets
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
  async function uploadLocalFiles(): Promise<string[]> {
    if (!files.length) return [];
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));

    try {
      setUploading(true);
      const res = await api.post(UPLOAD_ENDPOINT, fd, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
      });

      const urls: string[] =
        (res as any)?.data?.urls || (Array.isArray((res as any)?.data) ? (res as any).data : []);

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
    if (!selectableAttrs.length) return;

    const selections: Record<string, string> = {};
    selectableAttrs.forEach((a) => (selections[a.id] = ""));
    const next = [...variantRows, { id: uid("vr"), selections, priceBump: "", availableQty: "" }];
    setVariantRowsAndCheck(next);
  }

  function updateVariantSelection(rowId: string, attributeId: string, valueId: string) {
    setErr(null);
    const next = variantRows.map((r) =>
      r.id === rowId ? { ...r, selections: { ...r.selections, [attributeId]: valueId } } : r
    );
    setVariantRowsAndCheck(next);
  }

  function updateVariantPriceBump(rowId: string, v: string) {
    // ✅ guard even if someone re-enables the input via devtools
    const row = variantRows.find((r) => r.id === rowId);
    if (row?.variantId && isLive) {
      setErr("This product is LIVE. Existing variant price bumps are locked. You can change qty only.");
      return;
    }

    const next = variantRows.map((r) => (r.id === rowId ? { ...r, priceBump: v } : r));
    setVariantRowsAndCheck(next);
  }

  function updateVariantQty(rowId: string, v: string) {
    const next = variantRows.map((r) => (r.id === rowId ? { ...r, availableQty: v } : r));
    setVariantRowsAndCheck(next);
  }

  function removeVariantRow(rowId: string) {
    const row = variantRows.find((r) => r.id === rowId);
    if (!row) return;

    // LIVE guard: cannot delete existing variants (set qty 0 instead)
    if (isLive && row.isExisting) {
      setErr("This product is LIVE. You can’t delete an existing variant. Set its qty to 0 instead.");
      return;
    }

    const next = variantRows.filter((r) => r.id !== rowId);
    setVariantRowsAndCheck(next);
  }

  // Build payload: keep your original behaviour, but add LIVE “no-delete” safety + price-lock safety
  function buildPayload(imagesJson: string[]) {
    // ✅ defense-in-depth: even if state is tampered, payload uses locked values while LIVE
    const basePrice = isLive ? Number(initialBasePriceRef.current ?? 0) : toMoneyNumber(price);
    const baseSku = sku.trim();

    const attributeSelections: Array<{
      attributeId: string;
      valueId?: string;
      valueIds?: string[];
      text?: string;
    }> = [];

    for (const a of attributes ?? []) {
      const sel = selectedAttrs[a.id];
      if (sel == null) continue;

      if (a.type === "TEXT") {
        const txt = String(sel ?? "").trim();
        // LIVE: prevent clearing existing text
        if (isLive) {
          const prev = initialSnapshotRef.current?.attr?.[a.id];
          const prevTxt = Array.isArray(prev) ? "" : String(prev ?? "").trim();
          if (prevTxt && !txt) {
            throw new Error("This product is LIVE. You can’t clear an existing text attribute.");
          }
        }
        if (!txt) continue;
        attributeSelections.push({ attributeId: a.id, text: txt });
      } else if (a.type === "SELECT") {
        const v = String(sel ?? "").trim();
        // LIVE: prevent clearing select to empty
        if (isLive) {
          const prev = initialSnapshotRef.current?.attr?.[a.id];
          const prevVal = Array.isArray(prev) ? "" : String(prev ?? "").trim();
          if (prevVal && !v) {
            throw new Error("This product is LIVE. You can’t clear an existing SELECT attribute.");
          }
        }
        if (!v) continue;
        attributeSelections.push({ attributeId: a.id, valueId: v });
      } else if (a.type === "MULTISELECT") {
        const ids = Array.isArray(sel) ? sel.map(String).filter(Boolean) : [];

        if (isLive) {
          const prevSet = initialSnapshotRef.current?.multiAttrValues?.[a.id] ?? new Set<string>();
          const nextSet = new Set(ids);
          for (const pv of prevSet) {
            if (!nextSet.has(pv)) {
              throw new Error(
                "This product is LIVE. You can’t remove existing MULTISELECT values. You can only add more."
              );
            }
          }
        }

        if (!ids.length) continue;
        attributeSelections.push({ attributeId: a.id, valueIds: ids });
      }
    }

    const variants = variantRows
      .map((row) => {
        const rowQty = toIntNonNeg(row.availableQty);
        const anySel = rowHasAnySelection(row.selections);

        const isExisting = !!row.variantId;
        const bumpNum =
          isLive && isExisting
            ? Number(initialBumpByVariantIdRef.current.get(String(row.variantId)) ?? 0)
            : row.priceBump === "" || row.priceBump == null
              ? 0
              : toMoneyNumber(row.priceBump);

        // keep rule: keep if meaningful
        const shouldKeep = rowQty > 0 || bumpNum !== 0 || !!row.variantId || anySel;
        if (!shouldKeep) return null;

        const opts = Object.entries(row.selections || {})
          .filter(([, valueId]) => !!String(valueId || "").trim())
          .map(([attributeId, valueId]) => ({ attributeId, valueId }));

        const base: any = {
          priceBump: bumpNum,
          availableQty: rowQty,
          inStock: rowQty > 0,
          isActive: true,
        };

        if (row.variantId) {
          base.variantId = row.variantId;
          return base;
        }

        // new combo rows
        base.options = opts;
        return base;
      })
      .filter(Boolean) as any[];

    // LIVE guard: never allow “removing” existing variants from payload set
    if (isLive) {
      const snap = initialSnapshotRef.current;
      if (snap) {
        const sentExisting = new Set<string>(variants.filter((v) => v.variantId).map((v) => String(v.variantId)));
        for (const mustKeep of snap.existingVariantIds) {
          if (!sentExisting.has(mustKeep)) {
            throw new Error("This product is LIVE. You can’t delete an existing variant. Re-add it (or set qty=0).");
          }
        }
      }
    }

    const variantsOn = variants.length > 0;

    const baseOfferQty = baseQtyPreview;

    const variantsSumQty = variants.reduce((s, v) => s + (v.availableQty ?? 0), 0);
    const productQty = baseQtyPreview + (variantsOn ? variantsSumQty : 0);

    const inStock = productQty > 0;

    return {
      title: isLive ? undefined : (title.trim() || undefined),
      description: description?.trim() || "",
      price: basePrice,
      sku: isLive ? (initialSnapshotRef.current?.sku ?? baseSku) : baseSku,
      categoryId: categoryId || null,
      brandId: brandId || null,
      imagesJson,

      offer: {
        basePrice,
        currency: "NGN",
        availableQty: baseOfferQty,
        inStock,
        isActive: true,
      },

      availableQty: productQty,
      inStock,

      ...(attributeSelections.length ? { attributeSelections } : {}),
      variants,
    };
  }

  function buildStockOnlyPayload(params: {
    baseQty: number;
    variantRows: VariantRow[];
  }) {
    const { baseQty, variantRows } = params;

    // Only existing variants can be stock-updated without review
    const variants = variantRows
      .filter((r) => !!r.variantId)
      .map((r) => {
        const qty = toIntNonNeg(r.availableQty);
        return {
          variantId: String(r.variantId),
          availableQty: qty,
          inStock: qty > 0,
          isActive: true,
        };
      });

    const variantsSumQty = variants.reduce((s, v) => s + (v.availableQty ?? 0), 0);
    const productQty = baseQty + variantsSumQty;
    const inStock = productQty > 0;

    return {
      // product-level stock
      availableQty: productQty,
      inStock,

      // offer-level stock
      offer: {
        availableQty: baseQty,
        inStock,
        isActive: true,
      },

      // variant-level stock
      variants,

      // tell backend explicitly (optional but helpful)
      stockOnly: true,
    };
  }


  const updateM = useMutation({
    mutationFn: async () => {
      setErr(null);
      setOkMsg(null);

      if (!token) throw new Error("Not authenticated");
      if (!id) throw new Error("Missing product id");
      if (!title.trim()) throw new Error("Title is required");
      if (!sku.trim()) throw new Error("SKU is required");

      // ✅ LIVE: base price is locked
      if (isLive) {
        const attemptedBase = toMoneyNumber(price);
        const lockedBase = Number(initialBasePriceRef.current ?? 0);
        if (attemptedBase !== lockedBase) {
          throw new Error("This product is LIVE. Base price is locked. Only stock/qty updates are allowed.");
        }

        for (const r of variantRows) {
          if (!r.variantId) continue; // lock existing only
          const now = toMoneyNumber(r.priceBump || 0);
          const was = initialBumpByVariantIdRef.current.get(String(r.variantId)) ?? 0;
          if (now !== was) {
            throw new Error(
              "This product is LIVE. Existing variant price bumps are locked. Only stock/qty updates are allowed."
            );
          }
        }
      }

      // ✅ LIVE: title & SKU are locked
      const snap = initialSnapshotRef.current;
      if (snap) {
        if ((title ?? "").trim() !== (snap.title ?? "").trim()) {
          throw new Error("This product is LIVE. Title is locked. Only stock/qty updates are allowed.");
        }
        if ((sku ?? "").trim() !== (snap.sku ?? "").trim()) {
          throw new Error("This product is LIVE. SKU is locked. Only stock/qty updates are allowed.");
        }
      }


      const p = isLive ? Number(initialBasePriceRef.current ?? 0) : toMoneyNumber(price);
      if (!Number.isFinite(p) || p <= 0) throw new Error("Price must be greater than 0");

      if (hasDuplicates) {
        throw new Error(dupWarn || "You can’t save because there are duplicate variant combinations.");
      }

      const stockOnlyUpdate = isLive && !nonStockChangesRequireReview;

      const urlList = parseUrlList(imageUrls).filter(isUrlish);
      const freshlyUploaded = files.length ? await uploadLocalFiles() : [];
      const imagesJson = [...urlList, ...uploadedUrls, ...freshlyUploaded].filter(Boolean);

      const payload = stockOnlyUpdate
        ? buildStockOnlyPayload({
          baseQty: baseQtyPreview,
          variantRows,
        })
        : {
          ...buildPayload(imagesJson),
          // optional: helps backend decide review without diffing fields
          submitForReview: isLive && nonStockChangesRequireReview,
          stockOnly: false,
        };

      const { data } = await api.patch(`/api/supplier/products/${id}`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      return data;
    },
    onSuccess: () => {
      const stockOnlyUpdate = isLive && !nonStockChangesRequireReview;

      if (isLive && !stockOnlyUpdate && nonStockChangesRequireReview) {
        setOkMsg(
          "Saved ✅ Changes submitted for review. Listing may become PENDING until approved, depending on marketplace rules."
        );
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

  const saveDisabled = updateM.isPending || uploading || detailQ.isLoading || hasDuplicates;

  return (
    <SiteLayout>
      <SupplierLayout>
        <div className="mt-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-2xl font-bold tracking-tight text-zinc-900"
              >
                Edit product
              </motion.h1>

              {isLive ? (
                <p className="text-sm text-zinc-600 mt-1">
                  This product is <b>{productStatusUpper || "LIVE"}</b>. <b>Stock updates</b> are immediate. Other
                  changes may be <b>submitted for review</b>.
                </p>
              ) : (
                <p className="text-sm text-zinc-600 mt-1">
                  You can edit this product freely while it is <b>{productStatusUpper || "PENDING"}</b>.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Link
                to="/supplier/products"
                className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
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
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
                title={hasDuplicates ? "Fix duplicate combinations to save." : undefined}
              >
                <Save size={16} /> {updateM.isPending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>

          {isLive && nonStockChangesRequireReview && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
              <b>Review notice:</b> You’ve made changes beyond stock. Saving will submit changes for <b>admin review</b>.
              The listing may become <b>PENDING</b> until approved.
            </div>
          )}

          {dupWarn && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
              <b>Duplicates detected:</b> {dupWarn}
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              {/* Basic info */}
              <div className="rounded-2xl border bg-white/90 shadow-sm">
                <div className="px-5 py-4 border-b bg-white/70">
                  <div className="text-sm font-semibold text-zinc-900">Basic information</div>
                  {isLive && (
                    <div className="text-xs text-amber-700 mt-1">
                      LIVE listing: price & existing variant bumps are locked. You can always update stock.
                    </div>
                  )}
                </div>

                <div className="p-5 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Title *</label>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        disabled={isLive || !canEditCore}
                        readOnly={isLive}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white disabled:opacity-60"
                        title={isLive ? "LIVE listing: title is locked." : undefined}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">SKU *</label>
                      {/* SKU */}
                      <input
                        value={sku}
                        onChange={(e) => setSku(e.target.value)}
                        disabled={isLive || !canEditCore}
                        readOnly={isLive}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white disabled:opacity-60"
                        title={isLive ? "LIVE listing: SKU is locked." : undefined}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Base offer price (NGN) *</label>
                      <input
                        value={price}
                        onChange={onChangeBasePrice}
                        inputMode="decimal"
                        disabled={isLive || !canEditPrices}
                        readOnly={isLive}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white disabled:opacity-60"
                        title={
                          isLive
                            ? "LIVE listing: base price is locked. Ask admin or submit a price change request."
                            : undefined
                        }
                      />


                      {!!price && (
                        <div className="text-[11px] text-zinc-500 mt-1">
                          Preview: <b>{ngn.format(basePriceForPreview)}</b>
                        </div>
                      )}

                      {isLive && (
                        <div className="text-[11px] text-amber-700 mt-1">
                          LIVE listing: base price is <b>locked</b>.
                        </div>
                      )}
                    </div>

                    {/* base qty */}
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Base quantity</label>
                      <input
                        value={availableQty}
                        onChange={(e) => setAvailableQty(e.target.value)}
                        inputMode="numeric"
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                        placeholder="e.g. 20"
                      />

                      <div className="text-[11px] text-zinc-500 mt-1">
                        Total stock = <b>{baseQtyPreview}</b> (base) + <b>{variantQtyTotal}</b> (variants) ={" "}
                        <b>{totalQty}</b>
                      </div>

                      <div className="text-[11px] text-zinc-500 mt-1">
                        In-stock:{" "}
                        <b className={inStockPreview ? "text-emerald-700" : "text-rose-700"}>
                          {inStockPreview ? "YES" : "NO"}
                        </b>
                      </div>

                      {variantsEnabled && (
                        <div className="text-[11px] text-zinc-500 mt-1">
                          You have variant rows, so total stock includes base quantity + variant quantities.
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Category</label>
                      <select
                        value={categoryId}
                        onChange={(e) => setCategoryId(e.target.value)}
                        disabled={!canEditCore}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white disabled:opacity-60"
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
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Brand</label>
                      <select
                        value={brandId}
                        onChange={(e) => setBrandId(e.target.value)}
                        disabled={!canEditCore}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white disabled:opacity-60"
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
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      disabled={!canEditCore}
                      className="w-full rounded-xl border px-3 py-2 text-sm bg-white min-h-[110px] disabled:opacity-60"
                    />
                  </div>

                  {/* Attributes */}
                  <div className="rounded-2xl border bg-white">
                    <div className="px-5 py-4 border-b bg-white/70">
                      <div className="text-sm font-semibold text-zinc-900">Attributes</div>
                      {isLive ? (
                        <div className="text-xs text-zinc-500">
                          LIVE listing: you can edit, but <b>you can’t remove existing values</b>. Additions/changes will
                          be reviewed.
                        </div>
                      ) : (
                        <div className="text-xs text-zinc-500">You can edit attributes freely while not LIVE.</div>
                      )}
                    </div>

                    <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                      {activeAttrs.length === 0 && (
                        <div className="text-sm text-zinc-500">No active attributes configured.</div>
                      )}

                      {activeAttrs.map((a) => {
                        if (a.type === "TEXT") {
                          const val = String(getAttrVal(a.id) ?? "");
                          return (
                            <div key={a.id}>
                              <label className="block text-xs font-semibold text-zinc-700 mb-1">{a.name}</label>
                              <input
                                value={val}
                                onChange={(e) => setAttr(a.id, e.target.value)}
                                disabled={!canEditAttributes}
                                className="w-full rounded-xl border px-3 py-2 text-sm bg-white disabled:opacity-60"
                                placeholder={a.placeholder || "Enter value..."}
                              />
                            </div>
                          );
                        }

                        if (a.type === "SELECT") {
                          const val = String(getAttrVal(a.id) ?? "");
                          return (
                            <div key={a.id}>
                              <label className="block text-xs font-semibold text-zinc-700 mb-1">{a.name}</label>
                              <select
                                value={val}
                                onChange={(e) => setAttr(a.id, e.target.value)}
                                disabled={!canEditAttributes}
                                className="w-full rounded-xl border px-3 py-2 text-sm bg-white disabled:opacity-60"
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
                              <label className="block text-xs font-semibold text-zinc-700 mb-1">{a.name}</label>
                              <select
                                multiple
                                value={vals}
                                onChange={(e) => {
                                  const ids = Array.from(e.target.selectedOptions).map((o) => o.value);
                                  setAttr(a.id, ids);
                                }}
                                disabled={!canEditAttributes}
                                className="w-full rounded-xl border px-3 py-2 text-sm bg-white disabled:opacity-60 min-h-[42px]"
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
              </div>

              {/* Images */}
              <div className="rounded-2xl border bg-white/90 shadow-sm">
                <div className="px-5 py-4 border-b bg-white/70 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">Images</div>
                    <div className="text-xs text-zinc-500">Paste URLs or upload images.</div>
                    {isLive && <div className="text-xs text-amber-700 mt-1">LIVE listing: image changes will be reviewed.</div>}
                  </div>

                  <label className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 cursor-pointer">
                    <ImagePlus size={16} /> Add files
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => setFiles(Array.from(e.target.files || []))}
                    />
                  </label>
                </div>

                <div className="p-5 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">Image URLs (one per line)</label>
                    <textarea
                      value={imageUrls}
                      onChange={(e) => setImageUrls(e.target.value)}
                      className="w-full rounded-xl border px-3 py-2 text-xs bg-white min-h-[90px]"
                    />
                  </div>

                  {files.length > 0 && (
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-xs font-semibold text-zinc-800">
                        Selected files: <span className="font-mono">{files.length}</span>
                      </div>

                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={uploadLocalFiles}
                          disabled={uploading || !files.length}
                          className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white px-3 py-2 text-sm font-semibold disabled:opacity-60"
                        >
                          {uploading ? "Uploading…" : "Upload now"}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setFiles([]);
                            if (fileInputRef.current) fileInputRef.current.value = "";
                          }}
                          className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
                        >
                          <Trash2 size={16} /> Clear files
                        </button>
                      </div>
                    </div>
                  )}

                  {allUrlPreviews.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
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
              </div>

              {/* Variants */}
              <div className="rounded-2xl border bg-white/90 shadow-sm">
                <div className="px-5 py-4 border-b bg-white/70 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">Variant combinations</div>
                    {isLive ? (
                      <div className="text-xs text-zinc-500">
                        LIVE listing: you can add new combos (review) and update qty. <b>Existing price bumps are locked</b>.{" "}
                        <b>You can’t delete existing variants</b> (set qty to 0).
                      </div>
                    ) : (
                      <div className="text-xs text-zinc-500">You can add/remove combos while not LIVE.</div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={addVariantRow}
                    disabled={!selectableAttrs.length || !canAddNewCombos}
                    className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-60"
                  >
                    <Plus size={16} /> Add row
                  </button>
                </div>

                <div className="p-5 space-y-2">
                  {!selectableAttrs.length && <div className="text-sm text-zinc-500">No SELECT attributes available.</div>}

                  {variantRows.length === 0 ? (
                    <div className="text-sm text-zinc-500">No variants returned for this product.</div>
                  ) : (

                    variantRows.map((row) => {
                      const comboText =
                        row.comboLabel ||
                        formatComboLabel(row.selections, attrOrder, attrNameById, valueNameById);

                      const isDup = duplicateRowIds.has(row.id);

                      const rowQty = toIntNonNeg(row.availableQty);
                      const rowInStock = rowQty > 0;

                      const disableRemove = isLive && row.isExisting;

                      const bumpLocked = isLive && !!row.variantId; // lock existing bumps on LIVE
                      const bumpPreview = bumpLocked
                        ? Number(initialBumpByVariantIdRef.current.get(String(row.variantId)) ?? 0)
                        : toMoneyNumber(row.priceBump || 0);

                      const finalPrice = basePriceForPreview + bumpPreview;

                      return (
                        <div
                          key={row.id}
                          className={`rounded-2xl border bg-white p-3 space-y-2 ${isDup ? "border-rose-400 ring-2 ring-rose-200" : ""
                            }`}
                        >
                          <div className="flex flex-wrap gap-2 items-center">
                            {selectableAttrs.map((attr) => {
                              const valueId = row.selections[attr.id] || "";
                              return (
                                <select
                                  key={attr.id}
                                  value={valueId}
                                  onChange={(e) => updateVariantSelection(row.id, attr.id, e.target.value)}
                                  className={`rounded-xl border px-3 py-2 text-xs bg-white ${isDup ? "border-rose-300" : ""
                                    }`}
                                  // existing variant options are fixed; new rows editable
                                  disabled={row.isExisting}
                                  title={row.isExisting ? "Variant options are fixed; edit qty only." : undefined}
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

                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="text-xs text-zinc-700">
                                <span className="text-zinc-500">Combo:</span>{" "}
                                <b className={isDup ? "text-rose-700" : "text-zinc-900"}>{comboText}</b>
                              </div>

                              <div className="text-xs text-zinc-700">
                                <span className="text-zinc-500">Variant price:</span>{" "}
                                <b className="text-zinc-900">{ngn.format(finalPrice)}</b>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 ml-auto">
                              <span className="text-xs text-zinc-500">Qty</span>
                              <input
                                value={row.availableQty}
                                onChange={(e) => updateVariantQty(row.id, e.target.value)}
                                inputMode="numeric"
                                className={`w-20 rounded-xl border px-3 py-2 text-xs bg-white ${isDup ? "border-rose-300" : ""
                                  }`}
                                placeholder="e.g. 5"
                              />

                              <span className="text-xs text-zinc-500">Price bump</span>
                              <input
                                value={row.priceBump}
                                onChange={(e) => {
                                  if (bumpLocked) {
                                    setErr("This product is LIVE. Existing variant price bumps are locked. You can change qty only.");
                                    return;
                                  }
                                  updateVariantPriceBump(row.id, e.target.value);
                                }}
                                inputMode="decimal"
                                disabled={bumpLocked}
                                readOnly={bumpLocked}
                                className={`w-28 rounded-xl border px-3 py-2 text-xs bg-white ${isDup ? "border-rose-300" : ""
                                  } disabled:opacity-60`}
                                placeholder="e.g. 1500"
                                title={bumpLocked ? "LIVE listing: price bumps are locked. You can change qty only." : undefined}
                              />


                              <span
                                className={`text-[11px] font-semibold px-2 py-1 rounded-full border ${rowInStock
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-rose-50 text-rose-700 border-rose-200"
                                  }`}
                              >
                                {rowInStock ? "In stock" : "Out of stock"}
                              </span>

                              <button
                                type="button"
                                onClick={() => removeVariantRow(row.id)}
                                disabled={disableRemove}
                                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${disableRemove
                                  ? "bg-zinc-50 text-zinc-400 border-zinc-200 cursor-not-allowed"
                                  : "bg-rose-50 text-rose-700 hover:bg-rose-100 border-rose-200"
                                  }`}
                                title={
                                  disableRemove
                                    ? "LIVE listing: you can’t delete existing variants. Set qty to 0 instead."
                                    : undefined
                                }
                              >
                                <Trash2 size={14} /> Remove
                              </button>
                            </div>
                          </div>

                          {isDup && (
                            <div className="text-[11px] text-rose-700">
                              Duplicate combination. Change options or remove one of the matching rows.
                            </div>
                          )}

                          <div className="text-[11px] text-zinc-500 flex flex-wrap gap-3">
                            <span>
                              Variant price: <b>{ngn.format(finalPrice)}</b> (base + bump)
                            </span>
                            <span>
                              Variant qty: <b>{rowQty}</b>
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Right summary */}
            <div className="space-y-4">
              <div className="rounded-2xl border bg-white/90 shadow-sm">
                <div className="px-5 py-4 border-b bg-white/70">
                  <div className="text-sm font-semibold text-zinc-900">Update summary</div>
                  <div className="text-xs text-zinc-500">What will be saved</div>
                </div>

                <div className="p-5 text-sm text-zinc-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Current status</span>
                    <b className="text-zinc-900">{productStatusUpper || "—"}</b>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Title</span>
                    <b className="text-zinc-900">{title.trim() ? title.trim() : "—"}</b>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Base price</span>
                    <b className="text-zinc-900">
                      {ngn.format(basePriceForPreview)}
                      {isLive ? <span className="text-[11px] text-zinc-500"> (locked)</span> : null}
                    </b>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">SKU</span>
                    <b className="text-zinc-900">{sku.trim() ? sku.trim() : "—"}</b>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 inline-flex items-center gap-2">
                      <Package size={14} /> Stock
                    </span>
                    <b className={inStockPreview ? "text-emerald-700" : "text-rose-700"}>
                      {effectiveQty} ({inStockPreview ? "In stock" : "Out of stock"})
                    </b>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Variant rows</span>
                    <b className="text-zinc-900">{variantRows.length}</b>
                  </div>

                  {isLive && nonStockChangesRequireReview && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-xs">
                      Non-stock changes → <b>admin review</b> (listing may become <b>PENDING</b>).
                    </div>
                  )}

                  {hasDuplicates && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-xs">
                      Saving is blocked until you fix duplicate combinations.
                    </div>
                  )}
                </div>
              </div>

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
                <Save size={16} /> {updateM.isPending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}
