// src/pages/supplier/SupplierAddProducts.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ImagePlus,
  Plus,
  Trash2,
  ArrowLeft,
  Save,
  Package,
  ChevronDown,
  X,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { useCatalogMeta, type CatalogAttribute } from "../../hooks/useCatalogMeta";

/* =========================
   Types
========================= */

type SupplierMe = {
  supplierId: string;
  supplierName?: string | null;
  status?: string | null;
};

type VariantRow = {
  id: string;
  selections: Record<string, string>; // attributeId -> valueId | ""
  availableQty: string; // qty for this variant row
  unitPrice: string; // per-variant price
};

/* =========================
   Helpers
========================= */

const MAX_IMAGES = 5;

// ✅ Cookie calls helper (always send cookies)
const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function slugifySku(input: string) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
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

// stable key for preventing duplicate combinations (includes blanks => strict match)
function comboKeyFromSelections(selections: Record<string, string>, attrOrder: string[]) {
  return attrOrder.map((aid) => `${aid}=${String(selections?.[aid] || "")}`).join("|");
}

function parseUrlList(s: string) {
  return String(s || "")
    .split(/[\n,]/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * ✅ Normalize image URLs coming from server (common patterns):
 * - "uploads/abc.jpg"      => "/uploads/abc.jpg"
 * - "public/uploads/..."   => "/uploads/..."
 * - already "/uploads/.."  => keep
 * - absolute http(s)       => keep
 * - data:image/...         => keep
 */
function normalizeImageUrl(input: any): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  // data URLs
  if (/^data:image\//i.test(raw)) return raw;

  // absolute
  if (/^https?:\/\//i.test(raw)) return raw;

  // already rooted
  if (raw.startsWith("/")) return raw;

  // common upload paths without leading slash
  if (raw.startsWith("uploads/")) return `/${raw}`;
  if (raw.startsWith("public/uploads/")) return `/${raw.replace(/^public\//, "")}`;

  // accept other relative-ish image paths if they look like files
  if (/\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(raw) && raw.includes("/")) {
    return `/${raw}`;
  }

  return null;
}

function uniqStrings(arr: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const v = String(x || "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function limitImages(urls: any[], limit = MAX_IMAGES) {
  const normalized = urls
    .map(normalizeImageUrl)
    .filter(Boolean) as string[];
  const clean = uniqStrings(normalized);
  return clean.slice(0, limit);
}

/* =========================
   Small UI building blocks
========================= */

function Card({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={["rounded-2xl border bg-white/90 shadow-sm overflow-hidden", className].join(" ")}>
      <div className="px-4 sm:px-5 py-3 border-b bg-white/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-900 truncate">{title}</div>
          {subtitle ? <div className="text-xs text-zinc-500 mt-0.5">{subtitle}</div> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-zinc-700 mb-1">{children}</label>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "w-full rounded-xl border px-3 py-2.5 text-sm bg-white outline-none",
        "focus:border-violet-400 focus:ring-4 focus:ring-violet-200",
        props.className || "",
      ].join(" ")}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[
        "w-full rounded-xl border px-3 py-2.5 text-sm bg-white outline-none",
        "focus:border-violet-400 focus:ring-4 focus:ring-violet-200",
        props.className || "",
      ].join(" ")}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={[
        "w-full rounded-xl border px-3 py-2.5 text-sm bg-white outline-none",
        "focus:border-violet-400 focus:ring-4 focus:ring-violet-200",
        props.className || "",
      ].join(" ")}
    />
  );
}

/* =========================
   Component
========================= */

export default function SupplierAddProduct() {
  const nav = useNavigate();

  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // basic form fields
  const [title, setTitle] = useState("");
  const [retailPrice, setRetailPrice] = useState(""); // UI input
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [description, setDescription] = useState("");

  // stock
  const [baseQuantity, setBaseQuantity] = useState<string>("0");

  // images
  const [imageUrls, setImageUrls] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ Stable object URLs for local previews (fixes “no preview until upload” in StrictMode)
  const fileKey = (f: File) => `${f.name}-${f.size}-${f.lastModified}`;
  const filePreviewMapRef = useRef<Record<string, string>>({});
  const [, bumpPreview] = useState(0); // force rerender when preview map changes

  // variants
  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string | string[]>>({});
  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);
  const skuTouchedRef = useRef(false);

  const [summaryOpen, setSummaryOpen] = useState(false);

  // conflict flash
  const [flashBaseCombo, setFlashBaseCombo] = useState(false);
  const [flashVariantRowId, setFlashVariantRowId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const ngn = useMemo(
    () =>
      new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 2,
      }),
    []
  );

  const triggerConflictFlash = (rowId?: string) => {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);

    setFlashBaseCombo(true);
    setFlashVariantRowId(rowId || null);

    flashTimerRef.current = window.setTimeout(() => {
      setFlashBaseCombo(false);
      setFlashVariantRowId(null);
      flashTimerRef.current = null;
    }, 1200);
  };

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  /* =========================
     Supplier identity (display-only)
  ========================= */

  const supplierMeQ = useQuery<SupplierMe>({
    queryKey: ["supplier", "me"],
    enabled: true,
    queryFn: async () => {
      const attempts = ["/api/supplier/me", "/api/supplier/profile", "/api/supplier/dashboard"];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, AXIOS_COOKIE_CFG);
          const d = (data as any)?.data ?? data ?? {};
          const supplierId = d.supplierId || d.supplier?.id || d.id || null;
          if (supplierId) {
            return {
              supplierId: String(supplierId),
              supplierName: d.supplierName || d.name || d.supplier?.name || null,
              status: d.status || d.supplier?.status || null,
            };
          }
        } catch {
          //
        }
      }
      return { supplierId: "", supplierName: null, status: null };
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  /* =========================
     Lookups: categories, brands, attributes
  ========================= */

  const { categories, brands, attributes, attributesQ, categoriesQ, brandsQ } = useCatalogMeta({
    enabled: true,
  });

  const activeAttrs = useMemo(() => attributes, [attributes]);

  const selectableAttrs = useMemo(
    () => activeAttrs.filter((a) => a.type === "SELECT" && a.isActive !== false),
    [activeAttrs]
  );

  // stable attribute order for combo keys
  const attrOrder = useMemo(() => selectableAttrs.map((a) => a.id), [selectableAttrs]);

  // baseCombo selections from SELECT attributes
  const baseComboSelections = useMemo(() => {
    const sel: Record<string, string> = {};
    for (const aid of attrOrder) {
      const v = selectedAttrs[aid];
      sel[aid] = typeof v === "string" ? String(v || "").trim() : "";
    }
    return sel;
  }, [selectedAttrs, attrOrder]);

  const baseComboKey = useMemo(
    () => comboKeyFromSelections(baseComboSelections, attrOrder),
    [baseComboSelections, attrOrder]
  );

  const baseComboHasAny = useMemo(() => rowHasAnySelection(baseComboSelections), [baseComboSelections]);

  // keep variant row keys aligned to selectable attributes
  useEffect(() => {
    if (!selectableAttrs.length) return;
    const ids = selectableAttrs.map((a) => a.id);
    setVariantRows((rows) =>
      rows.map((row) => {
        const next: Record<string, string> = {};
        ids.forEach((id) => (next[id] = row.selections[id] || ""));
        return { ...row, selections: next };
      })
    );
  }, [selectableAttrs]);

  /* =========================
     Images (max 5)
  ========================= */

  const UPLOAD_ENDPOINT = "/api/uploads";

  const urlPreviews = useMemo(() => limitImages(parseUrlList(imageUrls), MAX_IMAGES), [imageUrls]);

  // ✅ maintain stable object URLs for selected files
  useEffect(() => {
    const wanted = new Set(files.map(fileKey));
    const map = filePreviewMapRef.current;

    // add missing
    for (const f of files) {
      const k = fileKey(f);
      if (!map[k]) map[k] = URL.createObjectURL(f);
    }

    // remove stale
    for (const k of Object.keys(map)) {
      if (!wanted.has(k)) {
        try {
          URL.revokeObjectURL(map[k]);
        } catch {
          //
        }
        delete map[k];
      }
    }

    bumpPreview((x) => x + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      const map = filePreviewMapRef.current;
      for (const k of Object.keys(map)) {
        try {
          URL.revokeObjectURL(map[k]);
        } catch {
          //
        }
        delete map[k];
      }
    };
  }, []);

  const filePreviews = useMemo(() => {
    const map = filePreviewMapRef.current;
    return files
      .map((f) => {
        const k = fileKey(f);
        return { file: f, url: map[k] };
      })
      .filter((x) => !!x.url);
  }, [files]);

  // claimed by URL + already uploaded (not counting pending files)
  const claimedByTextAndUploaded = useMemo(() => {
    const merged = limitImages([...urlPreviews, ...uploadedUrls], MAX_IMAGES);
    return merged.length;
  }, [urlPreviews, uploadedUrls]);

  const remainingSlotsExcludingSelectedFiles = useMemo(
    () => Math.max(0, MAX_IMAGES - claimedByTextAndUploaded),
    [claimedByTextAndUploaded]
  );

  function onPickFiles(nextPicked: File[]) {
    setErr(null);
    if (!nextPicked.length) return;

    setFiles((prev) => {
      const room = Math.max(0, remainingSlotsExcludingSelectedFiles - prev.length);
      if (room <= 0) {
        setErr(`You can only add up to ${MAX_IMAGES} images. Remove one to add another.`);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return prev;
      }

      const toAdd = nextPicked.slice(0, room);
      if (toAdd.length < nextPicked.length) {
        setErr(
          `Only ${MAX_IMAGES} images max. Added ${toAdd.length}; ignored ${nextPicked.length - toAdd.length}.`
        );
      }
      return [...prev, ...toAdd];
    });
  }

  function extractUploadUrls(respData: any): string[] {
    const d = respData;

    const candidates: any[] =
      (Array.isArray(d) ? d : null) ??
      (Array.isArray(d?.urls) ? d.urls : null) ??
      (Array.isArray(d?.data) ? d.data : null) ??
      (Array.isArray(d?.data?.urls) ? d.data.urls : null) ??
      (Array.isArray(d?.data?.items) ? d.data.items : null) ??
      [];

    const out: string[] = [];
    for (const x of candidates) {
      if (typeof x === "string") out.push(x);
      else if (x && typeof x === "object") {
        if (typeof x.url === "string") out.push(x.url);
        if (typeof x.path === "string") out.push(x.path);
        if (typeof x.location === "string") out.push(x.location);
      }
    }

    // ✅ normalize to /uploads/... and dedupe
    return limitImages(out, MAX_IMAGES);
  }

  async function uploadLocalFiles(): Promise<string[]> {
    if (!files.length) return [];

    // enforce max before uploading
    const already = limitImages([...urlPreviews, ...uploadedUrls], MAX_IMAGES);
    const room = Math.max(0, MAX_IMAGES - already.length);
    if (files.length > room) {
      throw new Error(`You can only upload ${room} more image(s). Max is ${MAX_IMAGES}.`);
    }

    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));

    try {
      setUploading(true);

      const res = await api.post(UPLOAD_ENDPOINT, fd, {
        ...AXIOS_COOKIE_CFG,
        headers: { "Content-Type": "multipart/form-data" },
      });

      const rawUrls = extractUploadUrls((res as any)?.data);
      const clean = limitImages(rawUrls, MAX_IMAGES);

      if (!clean.length) {
        throw new Error("Upload succeeded but no image URLs were returned. Check /api/uploads response shape.");
      }

      // Only take what fits
      const spaceNow = Math.max(
        0,
        MAX_IMAGES - limitImages([...urlPreviews, ...uploadedUrls], MAX_IMAGES).length
      );
      const take = clean.slice(0, spaceNow);

      setUploadedUrls((prev) => limitImages([...prev, ...take], MAX_IMAGES));
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";

      return take;
    } finally {
      setUploading(false);
    }
  }

  function removeUploadedUrl(u: string) {
    setUploadedUrls((prev) => prev.filter((x) => x !== u));
  }

  function removeTextUrl(u: string) {
    const raw = parseUrlList(imageUrls);
    const next = raw.filter((x) => normalizeImageUrl(x) !== normalizeImageUrl(u));
    setImageUrls(next.join("\n"));
  }

  function removeSelectedFile(file: File) {
    setFiles((prev) => prev.filter((f) => f !== file));
    // preview map cleanup happens in effect
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const allUrlPreviews = useMemo(() => {
    return limitImages([...urlPreviews, ...uploadedUrls], MAX_IMAGES);
  }, [urlPreviews, uploadedUrls]);

  /* =========================
     Variants helpers
  ========================= */

  function addVariantRow() {
    const selections: Record<string, string> = {};
    selectableAttrs.forEach((a) => (selections[a.id] = ""));
    setVariantRows((prev) => [
      ...prev,
      {
        id: uid("vr"),
        selections,
        availableQty: "",
        unitPrice: retailPrice || "",
      },
    ]);
  }

  function updateVariantSelection(rowId: string, attributeId: string, valueId: string) {
    setErr(null);

    setVariantRows((rows) => {
      const next = rows.map((r) =>
        r.id === rowId ? { ...r, selections: { ...r.selections, [attributeId]: valueId } } : r
      );

      const changed = next.find((r) => r.id === rowId);
      if (!changed) return rows;

      if (!rowHasAnySelection(changed.selections)) return next;

      const changedKey = comboKeyFromSelections(changed.selections, attrOrder);

      if (baseComboHasAny && changedKey === baseComboKey) {
        setErr(
          "That VariantCombo matches your BaseCombo selection in Attributes. Change either the base selection or the variant row."
        );
        triggerConflictFlash(rowId);
        return next;
      }

      const dup = next.find((r) => {
        if (r.id === rowId) return false;
        if (!rowHasAnySelection(r.selections)) return false;
        return comboKeyFromSelections(r.selections, attrOrder) === changedKey;
      });

      if (dup) {
        setErr("That variant combination already exists. Please choose a different combination.");
        triggerConflictFlash(rowId);
        return next;
      }
      return next;
    });
  }

  function updateVariantQty(rowId: string, v: string) {
    setVariantRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, availableQty: v } : r)));
  }

  function updateVariantPrice(rowId: string, v: string) {
    setVariantRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, unitPrice: v } : r)));
  }

  function removeVariantRow(rowId: string) {
    setVariantRows((rows) => rows.filter((r) => r.id !== rowId));
  }

  /* =========================
     Stock model
  ========================= */

  const baseQtyPreview = useMemo(() => toIntNonNeg(baseQuantity), [baseQuantity]);
  const isRealVariantRow = (r: VariantRow) => rowHasAnySelection(r.selections);

  const variantQtyTotal = useMemo(() => {
    return variantRows.reduce((sum, r) => sum + (isRealVariantRow(r) ? toIntNonNeg(r.availableQty) : 0), 0);
  }, [variantRows]);

  const totalQty = useMemo(() => baseQtyPreview + variantQtyTotal, [baseQtyPreview, variantQtyTotal]);
  const inStockPreview = totalQty > 0;

  // Detect duplicates (ignore empty rows)
  const duplicateRowIds = useMemo(() => {
    const seen = new Map<string, string>();
    const dups = new Set<string>();

    for (const row of variantRows) {
      if (!rowHasAnySelection(row.selections)) continue;
      const key = comboKeyFromSelections(row.selections, attrOrder);
      const first = seen.get(key);
      if (first) {
        dups.add(first);
        dups.add(row.id);
      } else {
        seen.set(key, row.id);
      }
    }

    return dups;
  }, [variantRows, attrOrder]);

  // baseCombo conflicts (variant == base combo)
  const baseComboConflictRowIds = useMemo(() => {
    if (!baseComboHasAny) return new Set<string>();
    const out = new Set<string>();
    for (const row of variantRows) {
      if (!rowHasAnySelection(row.selections)) continue;
      const key = comboKeyFromSelections(row.selections, attrOrder);
      if (key === baseComboKey) out.add(row.id);
    }
    return out;
  }, [variantRows, attrOrder, baseComboKey, baseComboHasAny]);

  const hasBaseComboConflict = baseComboConflictRowIds.size > 0;
  const hasDuplicateCombos = duplicateRowIds.size > 0;

  const comboErrorMsg = useMemo(() => {
    if (hasDuplicateCombos) {
      return "You have duplicate variant combinations. Remove or change the duplicates before submitting.";
    }
    if (hasBaseComboConflict) {
      return "Your BaseCombo (Attributes) matches one or more VariantCombo rows. Change the base selection or update/remove the variant row(s).";
    }
    return null;
  }, [hasDuplicateCombos, hasBaseComboConflict]);

  const hasComboError = !!comboErrorMsg;

  const firstComboErrorRowId = useMemo(() => {
    if (hasBaseComboConflict) return Array.from(baseComboConflictRowIds)[0] || null;
    if (hasDuplicateCombos) return Array.from(duplicateRowIds)[0] || null;
    return null;
  }, [hasBaseComboConflict, baseComboConflictRowIds, hasDuplicateCombos, duplicateRowIds]);

  /* =========================
     Prevent BaseCombo from matching existing VariantCombo
  ========================= */

  const findVariantMatchingKey = (key: string) => {
    for (const row of variantRows) {
      if (!rowHasAnySelection(row.selections)) continue;
      const k = comboKeyFromSelections(row.selections, attrOrder);
      if (k === key) return row;
    }
    return null;
  };

  const setBaseSelectAttr = (attributeId: string, valueId: string) => {
    setErr(null);

    setSelectedAttrs((prev) => {
      const next = { ...prev, [attributeId]: valueId };

      const nextBaseSel: Record<string, string> = {};
      for (const aid of attrOrder) {
        const v = next[aid];
        nextBaseSel[aid] = typeof v === "string" ? String(v || "").trim() : "";
      }

      const nextHasAny = rowHasAnySelection(nextBaseSel);
      const nextKey = comboKeyFromSelections(nextBaseSel, attrOrder);

      if (nextHasAny) {
        const hit = findVariantMatchingKey(nextKey);
        if (hit) {
          setErr(
            "That BaseCombo matches an existing VariantCombo row. Change the base selection or update/remove the variant row."
          );
          triggerConflictFlash(hit.id);
          return next;
        }
      }

      return next;
    });
  };

  /* =========================
     Build payload (schema-conformant)
     backend requires top-level `basePrice`
  ========================= */

  function buildPayload(imagesJson: string[]) {
    const baseSku = sku.trim() || slugifySku(title);
    const basePriceNum = toMoneyNumber(retailPrice);

    const attributeSelections: Array<{
      attributeId: string;
      valueId?: string;
      valueIds?: string[];
      text?: string;
    }> = [];

    for (const a of activeAttrs) {
      const sel = selectedAttrs[a.id];
      if (sel == null) continue;

      if (a.type === "TEXT") {
        const txt = String(sel ?? "").trim();
        if (!txt) continue;
        attributeSelections.push({ attributeId: a.id, text: txt });
        continue;
      }

      if (a.type === "SELECT") {
        const v = String(sel ?? "").trim();
        if (!v) continue;
        attributeSelections.push({ attributeId: a.id, valueId: v });
        continue;
      }

      if (a.type === "MULTISELECT") {
        const ids = Array.isArray(sel) ? sel.map(String).filter(Boolean) : [];
        if (!ids.length) continue;
        attributeSelections.push({ attributeId: a.id, valueIds: ids });
        continue;
      }
    }

    const variants: Array<{
      sku?: string | null;
      unitPrice?: number | null;
      availableQty: number;
      inStock: boolean;
      imagesJson?: string[];
      options: Array<{ attributeId: string; valueId: string }>;
    }> = [];

    if (variantRows.length && selectableAttrs.length) {
      for (const row of variantRows) {
        const picks = Object.entries(row.selections || {}).filter(([, valueId]) => !!String(valueId || "").trim());
        if (!picks.length) continue;

        const key = comboKeyFromSelections(row.selections, attrOrder);
        if (baseComboHasAny && key === baseComboKey) continue;

        const rowQty = toIntNonNeg(row.availableQty);
        const options = picks.map(([attributeId, valueId]) => ({ attributeId, valueId }));

        let variantSku: string | undefined;
        {
          const labelParts: string[] = [];
          for (const [aid, vid] of picks) {
            const attr = selectableAttrs.find((a) => a.id === aid);
            const val = attr?.values?.find((v) => v.id === vid);
            const code = (val?.code || val?.name || "").toString();
            if (code) labelParts.push(code.toUpperCase().replace(/\s+/g, ""));
          }
          const suffix = labelParts.join("-");
          variantSku = baseSku && suffix ? `${baseSku}-${suffix}` : baseSku || suffix || undefined;
        }

        const unitPriceNum = toMoneyNumber(row.unitPrice);
        variants.push({
          sku: variantSku,
          unitPrice: unitPriceNum > 0 ? unitPriceNum : basePriceNum || null,
          availableQty: rowQty,
          inStock: rowQty > 0,
          imagesJson: [],
          options,
        });
      }
    }

    return {
      basePrice: basePriceNum,

      title: title.trim(),
      description: description?.trim() || "",
      sku: baseSku,
      retailPrice: basePriceNum,

      availableQty: baseQtyPreview,
      inStock: totalQty > 0,

      categoryId: categoryId || null,
      brandId: brandId || null,
      imagesJson,

      ...(attributeSelections.length ? { attributeSelections } : {}),
      ...(variants.length ? { variants } : {}),
    };
  }

  /* =========================
     Create mutation (cookie auth)
  ========================= */

  const createM = useMutation({
    mutationFn: async () => {
      setErr(null);
      setOkMsg(null);

      if (!title.trim()) throw new Error("Title is required");
      const p = toMoneyNumber(retailPrice);
      if (!Number.isFinite(p) || p <= 0) throw new Error("Price must be greater than 0");
      if (!String(description || "").trim()) throw new Error("Description is required");

      if (duplicateRowIds.size > 0) {
        throw new Error("You have duplicate variant combinations. Please remove or change them before submitting.");
      }
      if (baseComboConflictRowIds.size > 0) {
        throw new Error(
          "One or more variant rows match your base attributes selection (BaseCombo). Change those rows or change the base selection."
        );
      }

      // Validate variant prices (only rows with selections)
      for (const r of variantRows) {
        if (!rowHasAnySelection(r.selections)) continue;
        const up = toMoneyNumber(r.unitPrice);
        if (up <= 0) throw new Error("Each variant row must have a Variant price greater than 0.");
      }

      // Build images (max 5)
      const urlListRaw = parseUrlList(imageUrls);
      const urlList = limitImages(urlListRaw, MAX_IMAGES);

      if (urlListRaw.length !== urlList.length) {
        setImageUrls(urlList.join("\n"));
      }

      // upload any local files (if present)
      const already = limitImages([...urlList, ...uploadedUrls], MAX_IMAGES);
      const room = Math.max(0, MAX_IMAGES - already.length);

      if (files.length > room) {
        throw new Error(`You can only add ${MAX_IMAGES} images total. Remove some images before uploading more.`);
      }

      const freshlyUploaded = files.length ? await uploadLocalFiles() : [];
      const imagesJson = limitImages([...urlList, ...uploadedUrls, ...freshlyUploaded], MAX_IMAGES);

      if (imagesJson.length > MAX_IMAGES) {
        throw new Error(`You can only submit ${MAX_IMAGES} images max.`);
      }

      const payload = buildPayload(imagesJson);

      const { data } = await api.post("/api/supplier/products", payload, AXIOS_COOKIE_CFG);
      return (data as any)?.data ?? data;
    },
    onSuccess: () => {
      setOkMsg("Product submitted ✅ It will appear once reviewed.");
      setTimeout(() => nav("/supplier/products", { replace: true }), 600);
    },
    onError: (e: any) => {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        "Could not create product";
      setErr(String(msg));
    },
  });

  useEffect(() => {
    if (skuTouchedRef.current) return;
    setSku(slugifySku(title));
  }, [title]);

  const variantRowsWithSelections = useMemo(
    () => variantRows.filter((r) => rowHasAnySelection(r.selections)),
    [variantRows]
  );

  const handleSubmit = () => {
    setErr(null);
    setOkMsg(null);

    if (hasComboError) {
      setErr(comboErrorMsg);
      triggerConflictFlash(firstComboErrorRowId || undefined);
      return;
    }

    createM.mutate();
  };

  const submitDisabled = createM.isPending || uploading || hasComboError;

  const imagesCount = allUrlPreviews.length;
  const fileCount = files.length;

  const baseComboBorder =
    hasBaseComboConflict || flashBaseCombo ? "border-rose-300 ring-2 ring-rose-100" : "";

  /* =========================
     Render
  ========================= */

  return (
    <SiteLayout>
      <SupplierLayout>
        {/* Sticky mobile submit bar */}
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 border-t bg-white/90 backdrop-blur">
          <div className="px-4 py-3 flex items-center gap-3">
            <button
              type="button"
              disabled={submitDisabled}
              onClick={handleSubmit}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-zinc-900 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
            >
              <Save size={16} />
              {createM.isPending ? "Submitting…" : "Submit product"}
            </button>
            <button
              type="button"
              onClick={() => setSummaryOpen((v) => !v)}
              className="shrink-0 inline-flex items-center gap-2 rounded-full border bg-white px-3 py-2 text-sm font-semibold"
              aria-expanded={summaryOpen}
            >
              <Package size={16} />
              <ChevronDown size={16} className={summaryOpen ? "rotate-180 transition" : "transition"} />
            </button>
          </div>

          {summaryOpen && (
            <div className="px-4 pb-4">
              <div className="rounded-2xl border bg-white p-4 text-sm text-zinc-700 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Status</span>
                  <b className="text-amber-700">PENDING</b>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Price</span>
                  <b className="text-zinc-900">{retailPrice ? ngn.format(toMoneyNumber(retailPrice)) : "—"}</b>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Stock</span>
                  <b className={inStockPreview ? "text-emerald-700" : "text-rose-700"}>
                    {totalQty} ({inStockPreview ? "In stock" : "Out of stock"})
                  </b>
                </div>
                <div className="text-[11px] text-zinc-600">
                  Base: <b>{baseQtyPreview}</b> • Variants total: <b>{variantQtyTotal}</b>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Images</span>
                  <b className="text-zinc-900">
                    {imagesCount}/{MAX_IMAGES}
                  </b>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Variant rows</span>
                  <b className="text-zinc-900">{variantRows.length}</b>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 space-y-4 pb-28 sm:pb-10">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-2xl font-bold tracking-tight text-zinc-900"
              >
                Add product
              </motion.h1>
              <p className="text-sm text-zinc-600 mt-1">
                Create a new product for your store. New products are submitted as <b>PENDING</b> for review.
              </p>

              <div className="mt-2 text-xs text-zinc-500">
                Supplier:{" "}
                <span className="font-medium text-zinc-800">
                  {supplierMeQ.isLoading
                    ? "Loading…"
                    : supplierMeQ.data?.supplierName || supplierMeQ.data?.supplierId || "—"}
                </span>
              </div>
            </div>

            {/* Desktop actions */}
            <div className="hidden sm:flex gap-2">
              <Link
                to="/supplier/products"
                className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
              >
                <ArrowLeft size={16} /> Back
              </Link>
              <button
                type="button"
                disabled={submitDisabled}
                onClick={handleSubmit}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
              >
                <Save size={16} /> {createM.isPending ? "Submitting…" : "Submit product"}
              </button>
            </div>

            {/* Mobile back */}
            <div className="sm:hidden">
              <Link
                to="/supplier/products"
                className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
              >
                <ArrowLeft size={16} /> Back to products
              </Link>
            </div>
          </div>

          {/* Alerts */}
          {err && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
              {err}
            </div>
          )}
          {okMsg && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
              {okMsg}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Main */}
            <div className="lg:col-span-2 space-y-4">
              {/* Basic info */}
              <Card title="Basic information" subtitle="What customers will see in the catalog">
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Title *</Label>
                      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Air Fryer 4L" />
                    </div>

                    <div>
                      <Label>
                        SKU <span className="text-zinc-400 font-normal">(required)</span>
                      </Label>
                      <Input
                        value={sku}
                        onChange={(e) => {
                          skuTouchedRef.current = true;
                          setSku(e.target.value);
                        }}
                        placeholder="e.g. AFRY-4L-BLK"
                      />
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className="text-[11px] text-zinc-600 underline"
                          onClick={() => {
                            skuTouchedRef.current = false;
                            setSku(slugifySku(title));
                          }}
                        >
                          Reset to auto SKU
                        </button>
                        <div className="text-[11px] text-zinc-500">Auto from title if untouched</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <Label>Retail price (NGN) *</Label>
                      <Input
                        value={retailPrice}
                        onChange={(e) => setRetailPrice(e.target.value)}
                        inputMode="decimal"
                        placeholder="e.g. 25000"
                      />
                      {!!retailPrice && (
                        <div className="text-[11px] text-zinc-500 mt-1">
                          Preview: <b>{ngn.format(toMoneyNumber(retailPrice))}</b>
                        </div>
                      )}
                      <div className="text-[11px] text-zinc-500 mt-1">
                        Sent as <code>basePrice</code> + saved as <code>Product.retailPrice</code>.
                      </div>
                    </div>

                    <div>
                      <Label>Base quantity</Label>
                      <Input
                        value={baseQuantity}
                        onChange={(e) => setBaseQuantity(e.target.value)}
                        inputMode="numeric"
                        placeholder="e.g. 20"
                      />
                      <div className="text-[11px] text-zinc-500 mt-1">
                        Total: <b>{baseQtyPreview}</b> + <b>{variantQtyTotal}</b> = <b>{totalQty}</b>
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-1">
                        In-stock:{" "}
                        <b className={inStockPreview ? "text-emerald-700" : "text-rose-700"}>
                          {inStockPreview ? "YES" : "NO"}
                        </b>
                      </div>
                    </div>

                    <div>
                      <Label>Category</Label>
                      <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                        <option value="">{categoriesQ.isLoading ? "Loading…" : "— Select category —"}</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <Label>Brand</Label>
                      <Select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                        <option value="">{brandsQ.isLoading ? "Loading…" : "— Select brand —"}</option>
                        {brands.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>Description *</Label>
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="min-h-[110px]"
                      placeholder="Write a clear, detailed description…"
                    />
                  </div>
                </div>
              </Card>

              {/* Images */}
              <Card
                title="Images"
                subtitle={`Paste URLs or upload images (max ${MAX_IMAGES}). Saved to imagesJson.`}
                right={
                  <label className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 cursor-pointer">
                    <ImagePlus size={16} /> Add files
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => onPickFiles(Array.from(e.target.files || []))}
                    />
                  </label>
                }
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <div className="text-zinc-600">
                      Images used: <b>{imagesCount}</b> / {MAX_IMAGES}
                      {fileCount > 0 && (
                        <>
                          {" "}
                          • Selected files: <b>{fileCount}</b>
                        </>
                      )}
                    </div>
                    <div className="text-zinc-500">
                      Remaining slots:{" "}
                      <b>{Math.max(0, MAX_IMAGES - limitImages([...urlPreviews, ...uploadedUrls, ...files], MAX_IMAGES).length)}</b>
                    </div>
                  </div>

                  <div>
                    <Label>Image URLs (one per line)</Label>
                    <Textarea
                      value={imageUrls}
                      onChange={(e) => {
                        setErr(null);
                        const raw = parseUrlList(e.target.value);
                        const capped = limitImages(raw, MAX_IMAGES);
                        setImageUrls(capped.join("\n"));
                      }}
                      className="min-h-[90px] text-xs"
                      placeholder={"https://.../image1.jpg\nhttps://.../image2.png"}
                    />
                  </div>

                  {(allUrlPreviews.length > 0 || filePreviews.length > 0) && (
                    <div>
                      <div className="text-xs font-semibold text-zinc-800 mb-2">Image previews</div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {allUrlPreviews.slice(0, MAX_IMAGES).map((u) => (
                          <div key={u} className="rounded-xl border overflow-hidden bg-white">
                            <div className="aspect-[4/3] bg-zinc-100 relative">
                              <img
                                src={u}
                                alt=""
                                className="w-full h-full object-cover"
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const inText = parseUrlList(imageUrls).some(
                                    (x) => normalizeImageUrl(x) === normalizeImageUrl(u)
                                  );
                                  if (inText) removeTextUrl(u);
                                  else removeUploadedUrl(u);
                                }}
                                className="absolute top-2 right-2 inline-flex items-center justify-center w-9 h-9 rounded-full
                                  bg-white/95 border border-zinc-300 shadow-md hover:bg-zinc-50 active:scale-95"
                                aria-label="Remove image"
                                title="Remove"
                              >
                                <X size={18} className="text-rose-700" />
                              </button>
                            </div>
                            <div className="p-2 text-[10px] text-zinc-600 truncate">{u}</div>
                          </div>
                        ))}

                        {filePreviews
                          .slice(0, Math.max(0, MAX_IMAGES - allUrlPreviews.length))
                          .map(({ file, url }) => (
                            <div key={url} className="rounded-xl border overflow-hidden bg-white">
                              <div className="aspect-[4/3] bg-zinc-100 relative">
                                <img src={url} alt={file.name} className="w-full h-full object-cover" />
                                <button
                                  type="button"
                                  onClick={() => removeSelectedFile(file)}
                                  className="absolute top-2 right-2 inline-flex items-center justify-center w-9 h-9 rounded-full
                                    bg-white/95 border border-zinc-300 shadow-md hover:bg-zinc-50 active:scale-95"
                                  aria-label="Remove selected file"
                                  title="Remove"
                                >
                                  <X size={18} className="text-rose-700" />
                                </button>
                              </div>
                              <div className="p-2 text-[10px] text-zinc-600 truncate">{file.name}</div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {uploadedUrls.length > 0 && (
                    <div className="rounded-xl border bg-emerald-50 p-3 text-xs text-emerald-800">
                      Uploaded: <b>{uploadedUrls.length}</b> image(s)
                    </div>
                  )}

                  {files.length > 0 && (
                    <div className="rounded-2xl border bg-white p-3">
                      <div className="text-xs font-semibold text-zinc-800">
                        Selected files: <span className="font-mono">{files.length}</span>
                      </div>

                      <div className="mt-3 flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              setErr(null);
                              await uploadLocalFiles();
                            } catch (e: any) {
                              setErr(e?.message || "Upload failed");
                            }
                          }}
                          disabled={uploading || !files.length}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white px-3 py-2 text-sm font-semibold disabled:opacity-60"
                        >
                          {uploading ? "Uploading…" : "Upload now"}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setFiles([]);
                            if (fileInputRef.current) fileInputRef.current.value = "";
                          }}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
                        >
                          <Trash2 size={16} /> Clear files
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              {/* Attributes */}
              <Card
                title="Attributes"
                subtitle="Optional details used for filtering and variant setup."
                className={baseComboBorder}
              >
                <div className="space-y-3">
                  {attributesQ.isLoading && <div className="text-sm text-zinc-500">Loading attributes…</div>}
                  {!attributesQ.isLoading && activeAttrs.length === 0 && (
                    <div className="text-sm text-zinc-500">No active attributes configured.</div>
                  )}

                  {selectableAttrs.length > 0 && (
                    <div
                      className={[
                        "rounded-xl border px-3 py-2 text-[12px]",
                        hasBaseComboConflict || flashBaseCombo
                          ? "bg-rose-50 border-rose-200 text-rose-800"
                          : "bg-amber-50 border-amber-200 text-amber-800",
                      ].join(" ")}
                    >
                      The selected <b>SELECT</b> attributes here form your <b>BaseCombo</b>. Variant combos below must be
                      different.
                      {(hasBaseComboConflict || flashBaseCombo) && (
                        <>
                          {" "}
                          <b>Fix:</b> change either the base selection or the highlighted variant row(s).
                        </>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {activeAttrs.map((a: CatalogAttribute) => {
                      if (a.type === "TEXT") {
                        const v = String(selectedAttrs[a.id] ?? "");
                        return (
                          <div key={a.id}>
                            <Label>{a.name}</Label>
                            <Input
                              value={v}
                              onChange={(e) => setSelectedAttrs((s) => ({ ...s, [a.id]: e.target.value }))}
                              placeholder={a.placeholder || `Enter ${a.name.toLowerCase()}…`}
                            />
                          </div>
                        );
                      }

                      if (a.type === "SELECT") {
                        const v = String(selectedAttrs[a.id] ?? "");
                        return (
                          <div key={a.id}>
                            <Label>{a.name}</Label>
                            <Select
                              value={v}
                              onChange={(e) => setBaseSelectAttr(a.id, e.target.value)}
                              className={hasBaseComboConflict || flashBaseCombo ? "border-rose-300" : ""}
                            >
                              <option value="">— Select —</option>
                              {(a.values || []).map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                </option>
                              ))}
                            </Select>
                          </div>
                        );
                      }

                      // MULTISELECT
                      const arr = Array.isArray(selectedAttrs[a.id]) ? (selectedAttrs[a.id] as string[]) : [];
                      return (
                        <div key={a.id} className="sm:col-span-2 rounded-2xl border bg-white p-3">
                          <div className="text-xs font-semibold text-zinc-700 mb-2">{a.name}</div>
                          <div className="flex flex-wrap gap-2">
                            {(a.values || []).map((x) => {
                              const checked = arr.includes(x.id);
                              return (
                                <label
                                  key={x.id}
                                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs cursor-pointer ${
                                    checked
                                      ? "bg-zinc-900 text-white border-zinc-900"
                                      : "bg-white hover:bg-black/5"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={checked}
                                    onChange={() => {
                                      setSelectedAttrs((s) => {
                                        const prev = Array.isArray(s[a.id]) ? (s[a.id] as string[]) : [];
                                        const next = checked ? prev.filter((id) => id !== x.id) : [...prev, x.id];
                                        return { ...s, [a.id]: next };
                                      });
                                    }}
                                  />
                                  {x.name}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>

              {/* Variant rows */}
              <Card
                title="Variant combinations"
                subtitle="Add combinations of SELECT attributes with qty and price. Total stock = base + variants."
                right={
                  <button
                    type="button"
                    onClick={addVariantRow}
                    disabled={!selectableAttrs.length}
                    className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-60"
                  >
                    <Plus size={16} /> Add row
                  </button>
                }
              >
                <div className="space-y-2">
                  {!selectableAttrs.length && (
                    <div className="text-sm text-zinc-500">
                      No SELECT attributes available. Create SELECT attributes (like Size/Color) to enable variants.
                    </div>
                  )}

                  {variantRows.map((row) => {
                    const isDup = duplicateRowIds.has(row.id);
                    const isBaseConflict = baseComboConflictRowIds.has(row.id);
                    const isFlashing = flashVariantRowId === row.id;

                    const variantPriceNum = toMoneyNumber(row.unitPrice);
                    const effectiveVariantPrice = variantPriceNum > 0 ? variantPriceNum : toMoneyNumber(retailPrice);

                    return (
                      <div
                        key={row.id}
                        className={[
                          "rounded-2xl border bg-white p-3 space-y-3",
                          isDup || isBaseConflict || isFlashing ? "border-rose-300 ring-2 ring-rose-100" : "",
                        ].join(" ")}
                      >
                        <div className="grid grid-cols-1 gap-3 items-start">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {selectableAttrs.map((attr) => {
                              const valueId = row.selections[attr.id] || "";
                              return (
                                <div key={attr.id}>
                                  <div className="text-[11px] font-semibold text-zinc-600 mb-1">{attr.name}</div>
                                  <Select
                                    value={valueId}
                                    onChange={(e) => updateVariantSelection(row.id, attr.id, e.target.value)}
                                    className={isBaseConflict || isFlashing ? "border-rose-300" : ""}
                                  >
                                    <option value="">Select…</option>
                                    {(attr.values || []).map((v) => (
                                      <option key={v.id} value={v.id}>
                                        {v.name}
                                      </option>
                                    ))}
                                  </Select>
                                </div>
                              );
                            })}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div>
                              <div className="text-[11px] font-semibold text-zinc-600 mb-1">Qty</div>
                              <Input
                                value={row.availableQty}
                                onChange={(e) => updateVariantQty(row.id, e.target.value)}
                                inputMode="numeric"
                                placeholder="e.g. 5"
                              />
                            </div>

                            <div>
                              <div className="text-[11px] font-semibold text-zinc-600 mb-1">Variant price (NGN)</div>
                              <Input
                                value={row.unitPrice}
                                onChange={(e) => updateVariantPrice(row.id, e.target.value)}
                                inputMode="decimal"
                                placeholder={retailPrice ? `e.g. ${retailPrice}` : "e.g. 25000"}
                              />
                              <div className="text-[11px] text-zinc-500 mt-1">
                                Preview: <b>{effectiveVariantPrice ? ngn.format(effectiveVariantPrice) : "—"}</b>
                              </div>
                            </div>

                            <div className="flex sm:justify-end">
                              <button
                                type="button"
                                onClick={() => removeVariantRow(row.id)}
                                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border bg-rose-50 text-rose-700 px-3 py-2.5 text-sm font-semibold hover:bg-rose-100"
                              >
                                <Trash2 size={14} /> Remove
                              </button>
                            </div>
                          </div>
                        </div>

                        {(isDup || isBaseConflict) && (
                          <div className="text-[12px] text-rose-700">
                            {isDup ? "Duplicate variant combination." : null}
                            {isDup && isBaseConflict ? " " : null}
                            {isBaseConflict ? "This VariantCombo matches your BaseCombo (Attributes section)." : null}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {variantRows.length === 0 && (
                    <div className="text-sm text-zinc-500">
                      No variant rows yet. Click “Add row” to create combinations.
                    </div>
                  )}
                </div>
              </Card>

              <div className="hidden sm:block">
                <button
                  type="button"
                  disabled={submitDisabled}
                  onClick={handleSubmit}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-white px-4 py-3 text-sm font-semibold disabled:opacity-60"
                >
                  <Save size={16} /> {createM.isPending ? "Submitting…" : "Submit product"}
                </button>
              </div>
            </div>

            {/* Sidebar summary (lg only) */}
            <div className="hidden lg:block space-y-4">
              <Card title="Submission summary" subtitle="What will be created">
                <div className="text-sm text-zinc-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Status</span>
                    <b className="text-amber-700">PENDING</b>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Title</span>
                    <b className="text-zinc-900 truncate max-w-[180px]">{title.trim() ? title.trim() : "—"}</b>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Retail price</span>
                    <b className="text-zinc-900">{retailPrice ? ngn.format(toMoneyNumber(retailPrice)) : "—"}</b>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">SKU</span>
                    <b className="text-zinc-900 truncate max-w-[180px]">{sku.trim() ? sku.trim() : "Auto-generated"}</b>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 inline-flex items-center gap-2">
                      <Package size={14} /> Stock
                    </span>
                    <b className={inStockPreview ? "text-emerald-700" : "text-rose-700"}>
                      {totalQty} ({inStockPreview ? "In stock" : "Out of stock"})
                    </b>
                  </div>

                  <div className="text-[11px] text-zinc-600">
                    Base: <b>{baseQtyPreview}</b> • Variants total: <b>{variantQtyTotal}</b>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Images</span>
                    <b className="text-zinc-900">
                      {imagesCount}/{MAX_IMAGES}
                    </b>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Variant rows</span>
                    <b className="text-zinc-900">{variantRows.length}</b>
                  </div>

                  {variantRowsWithSelections.length > 0 && (
                    <div className="text-[11px] text-zinc-600 mt-2">
                      Rows with selections: <b>{variantRowsWithSelections.length}</b>
                    </div>
                  )}
                </div>
              </Card>

              <button
                type="button"
                disabled={submitDisabled}
                onClick={handleSubmit}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-white px-4 py-3 text-sm font-semibold disabled:opacity-60"
              >
                <Save size={16} /> {createM.isPending ? "Submitting…" : "Submit product"}
              </button>
            </div>
          </div>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}
