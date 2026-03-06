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
  Search,
  Link2,
  CheckCircle2,
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

type Mode = "create" | "attach";

type VariantRow = {
  id: string;
  selections: Record<string, string>;
  availableQty: string;
  unitPrice: string;
};

type ExistingCatalogProductLite = {
  id: string;
  title: string;
  sku: string;
  status?: string | null;
  imagesJson?: string[];
  brandId?: string | null;
  categoryId?: string | null;
  alreadyAttached?: boolean;
  isOwnedByMe?: boolean;
  myOffer?: {
    id: string;
    basePrice?: number;
    currency?: string;
    availableQty?: number;
    isActive?: boolean;
    inStock?: boolean;
  } | null;
};

type ExistingProductDetail = {
  id: string;
  title: string;
  description?: string;
  sku?: string;
  status?: string | null;
  imagesJson?: string[];
  categoryId?: string | null;
  brandId?: string | null;
  brand?: { id: string; name: string } | null;
  basePrice?: number;
  currency?: string;
  availableQty?: number;
  offer?: {
    id: string;
    basePrice?: number;
    currency?: string;
    inStock?: boolean;
    isActive?: boolean;
    leadDays?: number | null;
    availableQty?: number;
  } | null;
  attributeGuide?: Array<{
    attributeId: string;
    attributeName: string;
    attributeType?: string | null;
    values: Array<{ id: string; name: string; code?: string | null }>;
  }>;
  variants?: Array<{
    id: string;
    sku?: string | null;
    unitPrice?: number;
    availableQty?: number;
    inStock?: boolean;
    isActive?: boolean;
    options?: Array<{ attributeId: string; valueId: string }>;
    supplierVariantOffer?: {
      id: string;
      unitPrice?: number;
      availableQty?: number;
      inStock?: boolean;
      isActive?: boolean;
      leadDays?: number | null;
      currency?: string;
    } | null;
  }>;
};

type AttachVariantRow = {
  variantId: string;
  label: string;
  unitPrice: string;
  availableQty: string;
  isActive: boolean;
  inStock: boolean;
};

type CatalogSearchResponse = {
  data: ExistingCatalogProductLite[];
};

/* =========================
   Helpers
========================= */

const MAX_IMAGES = 5;
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
  if (v === "" || v == null) return 0;
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

function comboKeyFromSelections(selections: Record<string, string>, attrOrder: string[]) {
  return attrOrder.map((aid) => `${aid}=${String(selections?.[aid] || "")}`).join("|");
}

function parseUrlList(s: string) {
  return String(s || "")
    .split(/[\n,]/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function normalizeImageUrl(input: any): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  if (/^data:image\//i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return raw;
  if (raw.startsWith("uploads/")) return `/${raw}`;
  if (raw.startsWith("public/uploads/")) return `/${raw.replace(/^public\//, "")}`;
  if (/\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(raw) && raw.includes("/")) return `/${raw}`;
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
  const normalized = urls.map(normalizeImageUrl).filter(Boolean) as string[];
  return uniqStrings(normalized).slice(0, limit);
}

function formatVariantLabel(
  variant: ExistingProductDetail["variants"] extends infer T
    ? T extends Array<infer U>
    ? U
    : never
    : never,
  attributeGuide: ExistingProductDetail["attributeGuide"] = []
) {
  const guideByAttr = new Map(
    (attributeGuide || []).map((a) => [String(a.attributeId), a])
  );

  const parts = (variant?.options || []).map((o) => {
    const g = guideByAttr.get(String(o.attributeId));
    const value = g?.values?.find((v) => String(v.id) === String(o.valueId));
    return `${g?.attributeName ?? o.attributeId}: ${value?.name ?? o.valueId}`;
  });

  return parts.length ? parts.join(" • ") : variant?.sku || variant?.id || "Variant";
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

function AddNewLink({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        "text-[11px] font-semibold underline underline-offset-2",
        "text-violet-700 hover:text-violet-800",
        disabled ? "opacity-50 cursor-not-allowed" : "",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/* =========================
   Component
========================= */

export default function SupplierAddProduct() {
  const nav = useNavigate();

  const [mode, setMode] = useState<Mode>("create");

  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // create mode
  const [title, setTitle] = useState("");
  const [retailPrice, setRetailPrice] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [description, setDescription] = useState("");
  const [baseQuantity, setBaseQuantity] = useState<string>("0");

  const [imageUrls, setImageUrls] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fileKey = (f: File) => `${f.name}-${f.size}-${f.lastModified}`;
  const filePreviewMapRef = useRef<Record<string, string>>({});
  const [, bumpPreview] = useState(0);

  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string | string[]>>({});
  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);
  const skuTouchedRef = useRef(false);

  // attach mode
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSearchTerm, setCatalogSearchTerm] = useState("");
  const [selectedExistingProductId, setSelectedExistingProductId] = useState<string>("");

  const [attachBasePrice, setAttachBasePrice] = useState("");
  const [attachBaseQty, setAttachBaseQty] = useState("0");
  const [attachLeadDays, setAttachLeadDays] = useState("");
  const [attachBaseActive, setAttachBaseActive] = useState(true);
  const [attachVariantRows, setAttachVariantRows] = useState<AttachVariantRow[]>([]);

  const [summaryOpen, setSummaryOpen] = useState(false);

  const [flashBaseCombo, setFlashBaseCombo] = useState(false);
  const [flashVariantRowId, setFlashVariantRowId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const [attrsSaved, setAttrsSaved] = useState(false);
  const [editingAttrs, setEditingAttrs] = useState(false);
  const [editingVariantRowId, setEditingVariantRowId] = useState<string | null>(null);


  const ngn = useMemo(
    () =>
      new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 2,
      }),
    []
  );

  const CATALOG_REQUESTS_PATH = "/supplier/catalog-requests";
  type CatalogReqSection = "categories" | "brands" | "attributes" | "attribute-values";

  function goToCatalogRequests(section: CatalogReqSection, focus?: string, extra?: Record<string, string>) {
    const sp = new URLSearchParams();
    sp.set("section", section);
    if (focus) sp.set("focus", focus);
    for (const [k, v] of Object.entries(extra || {})) {
      if (v != null && String(v).trim() !== "") sp.set(k, String(v));
    }
    return { pathname: CATALOG_REQUESTS_PATH, search: `?${sp.toString()}` };
  }

  function generateVariantMatrix() {
    setErr(null);

    const pickedAttrs = selectableAttrs
      .map((attr) => {
        const selectedValueId = String(selectedAttrs[attr.id] ?? "").trim();
        if (!selectedValueId) return null;

        return {
          attributeId: attr.id,
          valueId: selectedValueId,
        };
      })
      .filter(Boolean) as Array<{ attributeId: string; valueId: string }>;

    if (!pickedAttrs.length) {
      setErr("Select at least one attribute value before generating combo.");
      return;
    }

    const selections: Record<string, string> = {};
    pickedAttrs.forEach((x) => {
      selections[x.attributeId] = x.valueId;
    });

    let nextSelections = { ...selections };
    let nextKey = comboKeyFromSelections(nextSelections, attrOrder);

    const rowExists = (key: string) =>
      variantRows.some((row) => {
        if (!rowHasAnySelection(row.selections)) return false;
        return comboKeyFromSelections(row.selections, attrOrder) === key;
      });

    // If generated combo matches base combo, try to auto-switch one attribute
    if (baseComboHasAny && nextKey === baseComboKey) {
      let adjusted = false;

      for (const attr of selectableAttrs) {
        const currentValueId = String(nextSelections[attr.id] || "").trim();
        if (!currentValueId) continue;

        const alternative = (attr.values || []).find((v) => {
          if (String(v.id) === currentValueId) return false;

          const candidate = { ...nextSelections, [attr.id]: String(v.id) };
          const candidateKey = comboKeyFromSelections(candidate, attrOrder);

          if (baseComboHasAny && candidateKey === baseComboKey) return false;
          if (rowExists(candidateKey)) return false;

          return true;
        });

        if (alternative) {
          nextSelections = { ...nextSelections, [attr.id]: String(alternative.id) };
          nextKey = comboKeyFromSelections(nextSelections, attrOrder);
          adjusted = true;
          break;
        }
      }

      // If no alternative exists, still open a row and clear one field so user sees it
      if (!adjusted) {
        const firstSelectedAttr = selectableAttrs.find((a) => String(nextSelections[a.id] || "").trim());
        if (firstSelectedAttr) {
          nextSelections = { ...nextSelections, [firstSelectedAttr.id]: "" };
          setErr(
            "The generated combo matched your BaseCombo, so one selection was cleared. Choose a different value and save combo."
          );
        }
      }
    }

    const finalKey = comboKeyFromSelections(nextSelections, attrOrder);

    if (rowHasAnySelection(nextSelections) && rowExists(finalKey)) {
      setErr("That variant combination already exists.");
      return;
    }

    const nextRow: VariantRow = {
      id: uid("vr"),
      selections: nextSelections,
      availableQty: "",
      unitPrice: retailPrice || "",
    };

    setVariantRows((prev) => [...prev, nextRow]);
    setEditingVariantRowId(nextRow.id);
  }

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
     Supplier identity
  ========================= */

  const supplierMeQ = useQuery<SupplierMe>({
    queryKey: ["supplier", "me"],
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
     Catalog meta for create mode
  ========================= */

  const { categories, brands, attributes, attributesQ, categoriesQ, brandsQ } = useCatalogMeta({
    enabled: mode === "create",
  });

  const activeAttrs = useMemo(() => attributes, [attributes]);
  const selectableAttrs = useMemo(
    () => activeAttrs.filter((a) => a.type === "SELECT" && a.isActive !== false),
    [activeAttrs]
  );
  const attrOrder = useMemo(() => selectableAttrs.map((a) => a.id), [selectableAttrs]);

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
     Images for create mode
  ========================= */

  const UPLOAD_ENDPOINT = "/api/uploads";

  const urlPreviews = useMemo(() => limitImages(parseUrlList(imageUrls), MAX_IMAGES), [imageUrls]);

  useEffect(() => {
    const wanted = new Set(files.map(fileKey));
    const map = filePreviewMapRef.current;

    for (const f of files) {
      const k = fileKey(f);
      if (!map[k]) map[k] = URL.createObjectURL(f);
    }

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
        setErr(`Only ${MAX_IMAGES} images max. Added ${toAdd.length}; ignored ${nextPicked.length - toAdd.length}.`);
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

    return limitImages(out, MAX_IMAGES);
  }

  async function uploadLocalFiles(): Promise<string[]> {
    if (!files.length) return [];

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

      const spaceNow = Math.max(0, MAX_IMAGES - limitImages([...urlPreviews, ...uploadedUrls], MAX_IMAGES).length);
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
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const allUrlPreviews = useMemo(() => {
    return limitImages([...urlPreviews, ...uploadedUrls], MAX_IMAGES);
  }, [urlPreviews, uploadedUrls]);

  /* =========================
     Variant helpers for create mode
  ========================= */
  function addVariantRow() {
    const selections: Record<string, string> = {};
    selectableAttrs.forEach((a) => (selections[a.id] = ""));

    const newRow: VariantRow = {
      id: uid("vr"),
      selections,
      availableQty: "",
      unitPrice: retailPrice || "",
    };

    setVariantRows((prev) => [...prev, newRow]);
    setEditingVariantRowId(newRow.id);
    setErr(null);
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
        setErr("That VariantCombo matches your BaseCombo selection in Attributes. Change either the base selection or the variant row.");
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

  function getVariantRowLabel(row: VariantRow) {
    const labels = attrOrder
      .map((aid) => {
        const attr = selectableAttrs.find((a) => a.id === aid);
        const valueId = String(row.selections?.[aid] || "").trim();
        if (!attr || !valueId) return null;
        const val = attr.values?.find((v) => String(v.id) === valueId);
        return `${attr.name}: ${val?.name || valueId}`;
      })
      .filter(Boolean)
      .join(" • ");

    return labels || "Variant combo";
  }

  function validateVariantRow(row: VariantRow) {
    const picks = attrOrder.filter((aid) => String(row.selections?.[aid] || "").trim());

    if (!picks.length) return "Choose at least one attribute value for this combo.";

    for (const aid of picks) {
      const valueId = String(row.selections?.[aid] || "").trim();
      if (!valueId) return "Complete the combo selection before saving.";
    }

    const rowKey = comboKeyFromSelections(row.selections, attrOrder);

    if (baseComboHasAny && rowKey === baseComboKey) {
      return "This VariantCombo matches your BaseCombo. Change one of the selections before saving.";
    }

    const dup = variantRows.find((r) => {
      if (r.id === row.id) return false;
      if (!rowHasAnySelection(r.selections)) return false;
      return comboKeyFromSelections(r.selections, attrOrder) === rowKey;
    });

    if (dup) {
      return "That variant combination already exists.";
    }

    const price = toMoneyNumber(row.unitPrice);
    if (price <= 0) {
      return "Variant price must be greater than 0.";
    }

    return null;
  }

  function saveVariantRow(rowId: string) {
    const row = variantRows.find((r) => r.id === rowId);
    if (!row) return;

    const validationError = validateVariantRow(row);
    if (validationError) {
      setErr(validationError);
      triggerConflictFlash(rowId);
      return;
    }

    setErr(null);
    setEditingVariantRowId(null);
  }

  /* =========================
     Create mode stock model
  ========================= */

  const baseQtyPreview = useMemo(() => toIntNonNeg(baseQuantity), [baseQuantity]);
  const isRealVariantRow = (r: VariantRow) => rowHasAnySelection(r.selections);

  const variantQtyTotal = useMemo(() => {
    return variantRows.reduce((sum, r) => sum + (isRealVariantRow(r) ? toIntNonNeg(r.availableQty) : 0), 0);
  }, [variantRows]);

  const totalQty = useMemo(() => baseQtyPreview + variantQtyTotal, [baseQtyPreview, variantQtyTotal]);
  const inStockPreview = totalQty > 0;

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
          setErr("That BaseCombo matches an existing VariantCombo row. Change the base selection or update/remove the variant row.");
          triggerConflictFlash(hit.id);
          return next;
        }
      }

      return next;
    });
  };

  /* =========================
     Existing catalog search / attach mode
  ========================= */

  const catalogSearchQ = useQuery<CatalogSearchResponse>({
    queryKey: ["supplier", "catalog", "search", catalogSearchTerm],
    enabled: mode === "attach",
    queryFn: async () => {
      const { data } = await api.get("/api/supplier/products/catalog/search", {
        ...AXIOS_COOKIE_CFG,
        params: { q: catalogSearchTerm || "", take: 20 },
      });
      return (data as any) ?? { data: [] };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const selectedExistingProductQ = useQuery<{ data: ExistingProductDetail }>({
    queryKey: ["supplier", "product", selectedExistingProductId],
    enabled: mode === "attach" && !!selectedExistingProductId,
    queryFn: async () => {
      const { data } = await api.get(`/api/supplier/products/${selectedExistingProductId}`, AXIOS_COOKIE_CFG);
      return data as any;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const selectedExistingProduct = selectedExistingProductQ.data?.data ?? null;

  useEffect(() => {
    if (!selectedExistingProduct) return;

    const existingOffer = selectedExistingProduct.offer;
    setAttachBasePrice(
      existingOffer?.basePrice != null && Number(existingOffer.basePrice) > 0
        ? String(existingOffer.basePrice)
        : selectedExistingProduct.basePrice != null && Number(selectedExistingProduct.basePrice) > 0
          ? String(selectedExistingProduct.basePrice)
          : ""
    );

    setAttachBaseQty(
      existingOffer?.availableQty != null ? String(existingOffer.availableQty) : "0"
    );
    setAttachLeadDays(
      existingOffer?.leadDays != null ? String(existingOffer.leadDays) : ""
    );
    setAttachBaseActive(existingOffer?.isActive ?? true);

    const rows: AttachVariantRow[] = (selectedExistingProduct.variants || []).map((v) => ({
      variantId: String(v.id),
      label: formatVariantLabel(v, selectedExistingProduct.attributeGuide || []),
      unitPrice:
        v.supplierVariantOffer?.unitPrice != null
          ? String(v.supplierVariantOffer.unitPrice)
          : v.unitPrice != null
            ? String(v.unitPrice)
            : "",
      availableQty:
        v.supplierVariantOffer?.availableQty != null
          ? String(v.supplierVariantOffer.availableQty)
          : "0",
      isActive: v.supplierVariantOffer?.isActive ?? true,
      inStock: v.supplierVariantOffer?.inStock ?? ((v.supplierVariantOffer?.availableQty ?? 0) > 0),
    }));

    setAttachVariantRows(rows);
  }, [selectedExistingProduct]);

  const attachVariantQtyTotal = useMemo(
    () => attachVariantRows.reduce((sum, r) => sum + toIntNonNeg(r.availableQty), 0),
    [attachVariantRows]
  );

  const attachTotalQty = useMemo(
    () => toIntNonNeg(attachBaseQty) + attachVariantQtyTotal,
    [attachBaseQty, attachVariantQtyTotal]
  );

  function updateAttachVariantRow(variantId: string, patch: Partial<AttachVariantRow>) {
    setAttachVariantRows((rows) =>
      rows.map((r) => (r.variantId === variantId ? { ...r, ...patch } : r))
    );
  }

  /* =========================
     Payload builders
  ========================= */

  function buildCreatePayload(imagesJson: string[]) {
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

    const payload = {
      title: title.trim(),
      description: description?.trim() || "",
      basePrice: basePriceNum,
      sku: baseSku, // backend ignores and recomputes; kept harmlessly for compatibility
      categoryId: categoryId || undefined,
      brandId: brandId || undefined,
      imagesJson,
      availableQty: baseQtyPreview,
      qty: baseQtyPreview,
      quantity: baseQtyPreview,
      inStock: totalQty > 0,
      offer: {
        basePrice: basePriceNum,
        currency: "NGN",
        availableQty: baseQtyPreview,
        qty: baseQtyPreview,
        quantity: baseQtyPreview,
        inStock: baseQtyPreview > 0,
        isActive: true,
      },
      ...(attributeSelections.length ? { attributeSelections } : {}),
      ...(variants.length ? { variants } : {}),
    };

    return payload;
  }

  function buildAttachPayload() {
    if (!selectedExistingProductId) throw new Error("Select a product first.");

    const baseQty = toIntNonNeg(attachBaseQty);
    const leadDaysNum = attachLeadDays === "" ? null : toIntNonNeg(attachLeadDays);
    const basePriceNum = toMoneyNumber(attachBasePrice);

    return {
      productId: selectedExistingProductId,
      offer: {
        basePrice: basePriceNum,
        currency: "NGN",
        availableQty: baseQty,
        qty: baseQty,
        quantity: baseQty,
        inStock: baseQty > 0,
        isActive: attachBaseActive,
        leadDays: leadDaysNum,
      },
      variants: attachVariantRows.map((r) => {
        const qty = toIntNonNeg(r.availableQty);
        return {
          variantId: r.variantId,
          unitPrice: toMoneyNumber(r.unitPrice),
          availableQty: qty,
          qty,
          quantity: qty,
          inStock: qty > 0,
          isActive: r.isActive,
        };
      }),
    };
  }

  /* =========================
     Mutations
  ========================= */

  const createM = useMutation({
    mutationFn: async () => {
      setErr(null);
      setOkMsg(null);

      if (!title.trim()) throw new Error("Title is required");
      if (!brandId) throw new Error("Brand is required");
      const p = toMoneyNumber(retailPrice);
      if (!Number.isFinite(p) || p <= 0) throw new Error("Base price must be greater than 0");
      if (!String(description || "").trim()) throw new Error("Description is required");

      if (duplicateRowIds.size > 0) {
        throw new Error("You have duplicate variant combinations. Please remove or change them before submitting.");
      }
      if (baseComboConflictRowIds.size > 0) {
        throw new Error("One or more variant rows match your base attributes selection (BaseCombo). Change those rows or change the base selection.");
      }

      for (const r of variantRows) {
        if (!rowHasAnySelection(r.selections)) continue;
        const up = toMoneyNumber(r.unitPrice);
        if (up <= 0) throw new Error("Each variant row must have a Variant price greater than 0.");
      }

      const urlListRaw = parseUrlList(imageUrls);
      const urlList = limitImages(urlListRaw, MAX_IMAGES);

      if (urlListRaw.length !== urlList.length) {
        setImageUrls(urlList.join("\n"));
      }

      const already = limitImages([...urlList, ...uploadedUrls], MAX_IMAGES);
      const room = Math.max(0, MAX_IMAGES - already.length);

      if (files.length > room) {
        throw new Error(`You can only add ${MAX_IMAGES} images total. Remove some images before uploading more.`);
      }

      const freshlyUploaded = files.length ? await uploadLocalFiles() : [];
      const imagesJson = limitImages([...urlList, ...uploadedUrls, ...freshlyUploaded], MAX_IMAGES);

      const payload = buildCreatePayload(imagesJson);
      const { data } = await api.post("/api/supplier/products", payload, AXIOS_COOKIE_CFG);
      return (data as any)?.data ?? data;
    },
    onSuccess: () => {
      setOkMsg("Product submitted ✅ It will appear once reviewed.");
      setTimeout(() => nav("/supplier/products", { replace: true }), 700);
    },
    onError: (e: any) => {
      const msg =
        e?.response?.data?.userMessage ||
        e?.response?.data?.detail ||
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        "Could not create product";
      setErr(String(msg));
    },
  });

  const attachM = useMutation({
    mutationFn: async () => {
      setErr(null);
      setOkMsg(null);

      if (!selectedExistingProductId) throw new Error("Please choose a product to attach.");
      const p = toMoneyNumber(attachBasePrice);
      if (!Number.isFinite(p) || p <= 0) throw new Error("Base offer price must be greater than 0");

      for (const row of attachVariantRows) {
        const up = toMoneyNumber(row.unitPrice);
        if (up < 0) throw new Error("Variant price cannot be negative.");
      }

      const payload = buildAttachPayload();
      const { data } = await api.post("/api/supplier/products/attach", payload, AXIOS_COOKIE_CFG);
      return (data as any)?.data ?? data;
    },
    onSuccess: () => {
      setOkMsg("Offer attached ✅ Your offer has been added to the selected product.");
      setTimeout(() => nav("/supplier/products", { replace: true }), 700);
    },
    onError: (e: any) => {
      const msg =
        e?.response?.data?.userMessage ||
        e?.response?.data?.detail ||
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        "Could not attach offer";
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

    if (mode === "create") {
      if (hasComboError) {
        setErr(comboErrorMsg);
        triggerConflictFlash(firstComboErrorRowId || undefined);
        return;
      }
      createM.mutate();
      return;
    }

    attachM.mutate();
  };

  const isSubmitting = createM.isPending || attachM.isPending;
  const submitDisabled =
    isSubmitting ||
    uploading ||
    (mode === "create" && hasComboError) ||
    (mode === "attach" && !selectedExistingProductId);

  const imagesCount = allUrlPreviews.length;
  const fileCount = files.length;

  const baseComboBorder =
    hasBaseComboConflict || flashBaseCombo ? "border-rose-300 ring-2 ring-rose-100" : "";


  const savedAttributeSummary = useMemo(() => {
    return activeAttrs
      .map((attr) => {
        const raw = selectedAttrs[attr.id];
        if (raw == null) return null;

        if (attr.type === "TEXT") {
          const value = String(raw || "").trim();
          if (!value) return null;
          return {
            id: attr.id,
            name: attr.name,
            valueText: value,
          };
        }

        if (attr.type === "SELECT") {
          const valueId = String(raw || "").trim();
          if (!valueId) return null;
          const found = attr.values?.find((v) => String(v.id) === valueId);
          return {
            id: attr.id,
            name: attr.name,
            valueText: found?.name || valueId,
          };
        }

        if (attr.type === "MULTISELECT") {
          const ids = Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
          if (!ids.length) return null;
          const labels = ids.map((id) => attr.values?.find((v) => String(v.id) === id)?.name || id);
          return {
            id: attr.id,
            name: attr.name,
            valueText: labels.join(", "),
          };
        }

        return null;
      })
      .filter(Boolean) as Array<{ id: string; name: string; valueText: string }>;
  }, [activeAttrs, selectedAttrs]);

  const canSaveAttrs = useMemo(() => {
    return savedAttributeSummary.length > 0;
  }, [savedAttributeSummary]);

  const canSaveVariants = useMemo(() => {
    return variantRows.some((row) => rowHasAnySelection(row.selections));
  }, [variantRows]);

  const canGenerateVariants = useMemo(() => {
    return selectableAttrs.some((a) => {
      const v = selectedAttrs[a.id];
      return typeof v === "string" && String(v).trim() !== "";
    });
  }, [selectableAttrs, selectedAttrs]);
  /* =========================
     Render helpers
  ========================= */

  const attachSelectedCard = selectedExistingProduct ? (
    <div className="rounded-2xl border bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="w-20 h-20 rounded-xl overflow-hidden border bg-zinc-100 shrink-0">
          {selectedExistingProduct.imagesJson?.[0] ? (
            <img
              src={normalizeImageUrl(selectedExistingProduct.imagesJson[0]) || ""}
              alt={selectedExistingProduct.title}
              className="w-full h-full object-cover"
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm font-semibold text-zinc-900">{selectedExistingProduct.title}</div>
            <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold">
              Selected
            </span>
          </div>
          <div className="text-xs text-zinc-500 mt-1">SKU: {selectedExistingProduct.sku || "—"}</div>
          <div className="text-xs text-zinc-500 mt-1">Status: {selectedExistingProduct.status || "—"}</div>
          {selectedExistingProduct.brand?.name ? (
            <div className="text-xs text-zinc-500 mt-1">Brand: {selectedExistingProduct.brand.name}</div>
          ) : null}
          {selectedExistingProduct.description ? (
            <div className="text-xs text-zinc-600 mt-2 line-clamp-3">{selectedExistingProduct.description}</div>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  /* =========================
     Render
  ========================= */

  return (
    <SiteLayout>
      <SupplierLayout>
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 border-t bg-white/90 backdrop-blur">
          <div className="px-4 py-3 flex items-center gap-3">
            <button
              type="button"
              disabled={submitDisabled}
              onClick={handleSubmit}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-zinc-900 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
            >
              <Save size={16} />
              {isSubmitting ? "Submitting…" : mode === "create" ? "Submit product" : "Attach offer"}
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
                  <span className="text-zinc-500">Mode</span>
                  <b className="text-zinc-900">{mode === "create" ? "Create new" : "Attach existing"}</b>
                </div>

                {mode === "create" ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Base price</span>
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
                      <b className="text-zinc-900">{imagesCount}/{MAX_IMAGES}</b>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Selected product</span>
                      <b className="text-zinc-900 truncate max-w-[180px]">
                        {selectedExistingProduct?.title || "—"}
                      </b>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Base offer</span>
                      <b className="text-zinc-900">
                        {attachBasePrice ? ngn.format(toMoneyNumber(attachBasePrice)) : "—"}
                      </b>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Total qty</span>
                      <b className={attachTotalQty > 0 ? "text-emerald-700" : "text-rose-700"}>
                        {attachTotalQty}
                      </b>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 space-y-4 pb-28 sm:pb-10">
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
                Create a new product or add your offer to an existing catalog product.
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
                <Save size={16} /> {isSubmitting ? "Submitting…" : mode === "create" ? "Submit product" : "Attach offer"}
              </button>
            </div>

            <div className="sm:hidden">
              <Link
                to="/supplier/products"
                className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
              >
                <ArrowLeft size={16} /> Back to products
              </Link>
            </div>
          </div>

          <Card title="Choose flow" subtitle="Create a brand new product or attach your own offer to an existing one">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setMode("create");
                  setErr(null);
                  setOkMsg(null);
                }}
                className={[
                  "rounded-2xl border p-4 text-left transition",
                  mode === "create"
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white hover:bg-zinc-50",
                ].join(" ")}
              >
                <div className="font-semibold">Create new product</div>
                <div className={mode === "create" ? "text-zinc-200 text-sm mt-1" : "text-zinc-500 text-sm mt-1"}>
                  You own the product core details. Backend computes SKU and saves a base offer.
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode("attach");
                  setErr(null);
                  setOkMsg(null);
                }}
                className={[
                  "rounded-2xl border p-4 text-left transition",
                  mode === "attach"
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white hover:bg-zinc-50",
                ].join(" ")}
              >
                <div className="font-semibold">Add offer to existing product</div>
                <div className={mode === "attach" ? "text-zinc-200 text-sm mt-1" : "text-zinc-500 text-sm mt-1"}>
                  Choose an existing catalog product, then add your base and variant offers.
                </div>
              </button>
            </div>
          </Card>

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
            <div className="lg:col-span-2 space-y-4">
              {mode === "create" && (
                <>
                  <Card title="Basic information" subtitle="What customers will see in the catalog">
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label>Title *</Label>
                          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Air Fryer 4L" />
                        </div>

                        <div>
                          <Label>
                            SKU preview <span className="text-zinc-400 font-normal">(backend recomputes final SKU)</span>
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
                              Reset preview
                            </button>
                            <div className="text-[11px] text-zinc-500">Server uses supplier + brand + title</div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div>
                          <Label>Base price (NGN) *</Label>
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
                            Sent as top-level <code>basePrice</code> and <code>offer.basePrice</code>.
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
                          <div className="flex items-center justify-between mb-1">
                            <Label>Category</Label>
                            <AddNewLink
                              label="Add new category"
                              onClick={() => nav(goToCatalogRequests("categories", "category"))}
                              title="Request a new category"
                            />
                          </div>
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
                          <div className="flex items-center justify-between mb-1">
                            <Label>Brand *</Label>
                            <AddNewLink
                              label="Add new brand"
                              onClick={() => nav(goToCatalogRequests("brands", "brand"))}
                              title="Request a new brand"
                            />
                          </div>
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

                  <Card
                    title="Images"
                    subtitle={`Paste URLs or upload images (max ${MAX_IMAGES}). Only used for new product creation.`}
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
                                    className="absolute top-2 right-2 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/95 border border-zinc-300 shadow-md hover:bg-zinc-50 active:scale-95"
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
                                      className="absolute top-2 right-2 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/95 border border-zinc-300 shadow-md hover:bg-zinc-50 active:scale-95"
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

                  <Card
                    title="Attributes"
                    subtitle="Optional details used for filtering and variant setup."
                    className={baseComboBorder}
                    right={
                      <div className="flex items-center gap-2 flex-wrap">
                        {!attrsSaved ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (!canSaveAttrs) {
                                setErr("Choose at least one attribute value before saving.");
                                return;
                              }
                              setAttrsSaved(true);
                              setEditingAttrs(false);
                            }}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg border bg-zinc-900 text-white disabled:opacity-50"
                            disabled={!canSaveAttrs}
                          >
                            Save
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingAttrs(true);
                              setAttrsSaved(false);
                            }}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg border bg-white hover:bg-zinc-50"
                          >
                            Edit
                          </button>
                        )}

                        <AddNewLink
                          label="Add new attribute"
                          onClick={() => nav(goToCatalogRequests("attributes", "attribute"))}
                        />
                      </div>
                    }
                  >
                    {attrsSaved && !editingAttrs ? (
                      <div className="rounded-xl border bg-zinc-50 p-3 space-y-2 text-sm">
                        {savedAttributeSummary.length ? (
                          savedAttributeSummary.map((item) => (
                            <div key={item.id} className="flex items-start justify-between gap-3">
                              <span className="font-medium text-zinc-700">{item.name}</span>
                              <span className="text-zinc-900 text-right">{item.valueText}</span>
                            </div>
                          ))
                        ) : (
                          <div className="text-zinc-500">No saved attributes yet.</div>
                        )}
                      </div>
                    ) : (
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
                            The selected <b>SELECT</b> attributes here form your <b>BaseCombo</b>. Variant combos below must be different.
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
                              const label = "add new " + a.name.toLowerCase();

                              return (
                                <div key={a.id}>
                                  <div className="flex items-center justify-between mb-1">
                                    <Label>{a.name}</Label>
                                    <AddNewLink
                                      label={label}
                                      onClick={() =>
                                        nav(goToCatalogRequests("attribute-values", "value", { attributeId: String(a.id || "") }))
                                      }
                                      title={`Request new values for ${a.name}`}
                                    />
                                  </div>
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

                            const arr = Array.isArray(selectedAttrs[a.id]) ? (selectedAttrs[a.id] as string[]) : [];
                            const label = "add new " + a.name.toLowerCase();

                            return (
                              <div key={a.id} className="sm:col-span-2 rounded-2xl border bg-white p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-xs font-semibold text-zinc-700">{a.name}</div>
                                  <AddNewLink
                                    label={label}
                                    onClick={() =>
                                      nav(goToCatalogRequests("attribute-values", "value", { attributeId: String(a.id || "") }))
                                    }
                                    title={`Request new values for ${a.name}`}
                                  />
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {(a.values || []).map((x) => {
                                    const checked = arr.includes(x.id);
                                    return (
                                      <label
                                        key={x.id}
                                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs cursor-pointer ${checked ? "bg-zinc-900 text-white border-zinc-900" : "bg-white hover:bg-black/5"
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
                    )}
                  </Card>

                  <Card
                    title="Variant combinations"
                    subtitle="Add combinations of SELECT attributes with qty and price."
                    right={
                      <div className="flex gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={generateVariantMatrix}
                          disabled={!canGenerateVariants}
                          className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
                        >
                          Generate combo
                        </button>

                        <button
                          type="button"
                          onClick={addVariantRow}
                          className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
                        >
                          <Plus size={16} /> Add row
                        </button>
                      </div>
                    }
                  >
                    <div className="space-y-2">
                      {!selectableAttrs.length && (
                        <div className="text-sm text-zinc-500">
                          No SELECT attributes available. Create SELECT attributes to enable variants.
                        </div>
                      )}

                      {variantRows.map((row) => {
                        const isDup = duplicateRowIds.has(row.id);
                        const isBaseConflict = baseComboConflictRowIds.has(row.id);
                        const isFlashing = flashVariantRowId === row.id;
                        const isEditing = editingVariantRowId === row.id;

                        const variantPriceNum = toMoneyNumber(row.unitPrice);
                        const effectiveVariantPrice = variantPriceNum > 0 ? variantPriceNum : toMoneyNumber(retailPrice);
                        const label = getVariantRowLabel(row);

                        if (!isEditing) {
                          return (
                            <div
                              key={row.id}
                              className={[
                                "rounded-2xl border bg-zinc-50 p-3",
                                isDup || isBaseConflict || isFlashing ? "border-rose-300 ring-2 ring-rose-100" : "",
                              ].join(" ")}
                            >
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-zinc-900">{label}</div>
                                  <div className="text-xs text-zinc-600 mt-1">
                                    Qty: <b>{row.availableQty || 0}</b> · Price:{" "}
                                    <b>{row.unitPrice ? ngn.format(toMoneyNumber(row.unitPrice)) : "—"}</b>
                                  </div>

                                  {(isDup || isBaseConflict) && (
                                    <div className="text-[12px] text-rose-700 mt-2">
                                      {isDup ? "Duplicate variant combination." : null}
                                      {isDup && isBaseConflict ? " " : null}
                                      {isBaseConflict ? "This VariantCombo matches your BaseCombo." : null}
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setErr(null);
                                      setEditingVariantRowId(row.id);
                                    }}
                                    className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                                  >
                                    Edit combo
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => removeVariantRow(row.id)}
                                    className="inline-flex items-center gap-2 rounded-xl border bg-rose-50 text-rose-700 px-3 py-2 text-sm font-semibold hover:bg-rose-100"
                                  >
                                    <Trash2 size={14} /> Remove
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={row.id}
                            className={[
                              "rounded-2xl border bg-white p-3 space-y-3",
                              isDup || isBaseConflict || isFlashing ? "border-rose-300 ring-2 ring-rose-100" : "",
                            ].join(" ")}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                              <div className="text-sm font-semibold text-zinc-900">Editing combo</div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => saveVariantRow(row.id)}
                                  className="inline-flex items-center gap-2 rounded-xl border bg-zinc-900 text-white px-3 py-2 text-sm font-semibold"
                                >
                                  Save combo
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setEditingVariantRowId(null)}
                                  className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                                >
                                  Done
                                </button>

                                <button
                                  type="button"
                                  onClick={() => removeVariantRow(row.id)}
                                  className="inline-flex items-center gap-2 rounded-xl border bg-rose-50 text-rose-700 px-3 py-2 text-sm font-semibold hover:bg-rose-100"
                                >
                                  <Trash2 size={14} /> Remove
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 gap-3 items-start">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {selectableAttrs.map((attr) => {
                                  const valueId = row.selections[attr.id] || "";
                                  const label = "add new " + attr.name.toLowerCase();

                                  return (
                                    <div key={attr.id}>
                                      <div className="flex items-center justify-between mb-1">
                                        <div className="text-[11px] font-semibold text-zinc-600">{attr.name}</div>
                                        <AddNewLink
                                          label={label}
                                          onClick={() =>
                                            nav(goToCatalogRequests("attribute-values", "value", { attributeId: String(attr.id || "") }))
                                          }
                                          title={`Request new values for ${attr.name}`}
                                        />
                                      </div>
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
                          No variant rows yet. Click “Generate combo” or “Add row” to create one.
                        </div>
                      )}
                    </div>
                  </Card>
                </>
              )}

              {mode === "attach" && (
                <>
                  <Card title="Find existing product" subtitle="Search catalog products and attach your own supplier offer">
                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex-1">
                          <Label>Search product</Label>
                          <div className="relative">
                            <Input
                              value={catalogSearch}
                              onChange={(e) => setCatalogSearch(e.target.value)}
                              placeholder="Search by title, SKU, or description"
                              className="pl-10"
                            />
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                          </div>
                        </div>

                        <div className="sm:self-end">
                          <button
                            type="button"
                            onClick={() => setCatalogSearchTerm(catalogSearch.trim())}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2.5 text-sm font-semibold"
                          >
                            <Search size={16} /> Search
                          </button>
                        </div>
                      </div>

                      <div className="rounded-xl border bg-zinc-50 p-3 text-xs text-zinc-600">
                        Tip: select a live product, then add your own base price, stock, and variant offers without editing the core product details.
                      </div>

                      <div className="space-y-2">
                        {catalogSearchQ.isLoading ? (
                          <div className="text-sm text-zinc-500">Searching…</div>
                        ) : (catalogSearchQ.data?.data || []).length === 0 ? (
                          <div className="text-sm text-zinc-500">No products found.</div>
                        ) : (
                          (catalogSearchQ.data?.data || []).map((p) => {
                            const isSelected = String(selectedExistingProductId) === String(p.id);
                            return (
                              <button
                                type="button"
                                key={p.id}
                                onClick={() => {
                                  setSelectedExistingProductId(String(p.id));
                                  setErr(null);
                                  setOkMsg(null);
                                }}
                                className={[
                                  "w-full text-left rounded-2xl border p-3 transition",
                                  isSelected ? "border-zinc-900 ring-2 ring-zinc-200 bg-zinc-50" : "bg-white hover:bg-zinc-50",
                                ].join(" ")}
                              >
                                <div className="flex items-start gap-3">
                                  <div className="w-16 h-16 rounded-xl overflow-hidden border bg-zinc-100 shrink-0">
                                    {p.imagesJson?.[0] ? (
                                      <img
                                        src={normalizeImageUrl(p.imagesJson[0]) || ""}
                                        alt={p.title}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : null}
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <div className="text-sm font-semibold text-zinc-900">{p.title}</div>
                                      {p.alreadyAttached ? (
                                        <span className="rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold">
                                          Already attached
                                        </span>
                                      ) : null}
                                      {isSelected ? (
                                        <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold">
                                          Selected
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="text-xs text-zinc-500 mt-1">SKU: {p.sku || "—"}</div>
                                    <div className="text-xs text-zinc-500 mt-1">Status: {p.status || "—"}</div>
                                    {p.myOffer?.basePrice != null ? (
                                      <div className="text-xs text-zinc-600 mt-1">
                                        Current my offer: <b>{ngn.format(Number(p.myOffer.basePrice || 0))}</b>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </Card>

                  {selectedExistingProductQ.isLoading && (
                    <Card title="Loading product details">
                      <div className="text-sm text-zinc-500">Loading selected product…</div>
                    </Card>
                  )}

                  {attachSelectedCard}

                  {selectedExistingProduct && (
                    <>
                      <Card title="Base offer" subtitle="Your supplier-specific offer for this existing product">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <div>
                            <Label>Base offer price (NGN) *</Label>
                            <Input
                              value={attachBasePrice}
                              onChange={(e) => setAttachBasePrice(e.target.value)}
                              inputMode="decimal"
                              placeholder="e.g. 25000"
                            />
                            {!!attachBasePrice && (
                              <div className="text-[11px] text-zinc-500 mt-1">
                                Preview: <b>{ngn.format(toMoneyNumber(attachBasePrice))}</b>
                              </div>
                            )}
                          </div>

                          <div>
                            <Label>Base quantity</Label>
                            <Input
                              value={attachBaseQty}
                              onChange={(e) => setAttachBaseQty(e.target.value)}
                              inputMode="numeric"
                              placeholder="e.g. 10"
                            />
                          </div>

                          <div>
                            <Label>Lead days</Label>
                            <Input
                              value={attachLeadDays}
                              onChange={(e) => setAttachLeadDays(e.target.value)}
                              inputMode="numeric"
                              placeholder="e.g. 2"
                            />
                          </div>

                          <div className="flex items-end">
                            <label className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2.5 text-sm font-semibold">
                              <input
                                type="checkbox"
                                checked={attachBaseActive}
                                onChange={(e) => setAttachBaseActive(e.target.checked)}
                              />
                              Active offer
                            </label>
                          </div>
                        </div>

                        <div className="mt-3 rounded-xl border bg-zinc-50 p-3 text-xs text-zinc-600">
                          This calls <code>POST /api/supplier/products/attach</code> with your supplier base offer.
                        </div>
                      </Card>

                      <Card
                        title="Variant offers"
                        subtitle="Set supplier-specific stock and price for each existing variant"
                        right={
                          <div className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700">
                            {attachVariantRows.length} variant(s)
                          </div>
                        }
                      >
                        <div className="space-y-2">
                          {attachVariantRows.length === 0 ? (
                            <div className="text-sm text-zinc-500">This product has no variants. Only the base offer will be attached.</div>
                          ) : (
                            attachVariantRows.map((row) => {
                              const pricePreview = toMoneyNumber(row.unitPrice);

                              return (
                                <div key={row.variantId} className="rounded-2xl border bg-white p-3 space-y-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold text-zinc-900">{row.label}</div>
                                      <div className="text-[11px] text-zinc-500 mt-1">Variant ID: {row.variantId}</div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                      <label className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs font-semibold">
                                        <input
                                          type="checkbox"
                                          checked={row.isActive}
                                          onChange={(e) =>
                                            updateAttachVariantRow(row.variantId, { isActive: e.target.checked })
                                          }
                                        />
                                        Active
                                      </label>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <div>
                                      <div className="text-[11px] font-semibold text-zinc-600 mb-1">Variant price (NGN)</div>
                                      <Input
                                        value={row.unitPrice}
                                        onChange={(e) =>
                                          updateAttachVariantRow(row.variantId, { unitPrice: e.target.value })
                                        }
                                        inputMode="decimal"
                                        placeholder="e.g. 25000"
                                      />
                                      <div className="text-[11px] text-zinc-500 mt-1">
                                        Preview: <b>{pricePreview ? ngn.format(pricePreview) : "—"}</b>
                                      </div>
                                    </div>

                                    <div>
                                      <div className="text-[11px] font-semibold text-zinc-600 mb-1">Qty</div>
                                      <Input
                                        value={row.availableQty}
                                        onChange={(e) =>
                                          updateAttachVariantRow(row.variantId, {
                                            availableQty: e.target.value,
                                            inStock: toIntNonNeg(e.target.value) > 0,
                                          })
                                        }
                                        inputMode="numeric"
                                        placeholder="e.g. 4"
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </Card>
                    </>
                  )}
                </>
              )}

              <div className="hidden sm:block">
                <button
                  type="button"
                  disabled={submitDisabled}
                  onClick={handleSubmit}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-white px-4 py-3 text-sm font-semibold disabled:opacity-60"
                >
                  <Save size={16} /> {isSubmitting ? "Submitting…" : mode === "create" ? "Submit product" : "Attach offer"}
                </button>
              </div>
            </div>

            <div className="hidden lg:block space-y-4">
              <Card title="Submission summary" subtitle="What will be sent to the backend">
                <div className="text-sm text-zinc-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Flow</span>
                    <b className="text-zinc-900">{mode === "create" ? "Create new product" : "Attach existing product"}</b>
                  </div>

                  {mode === "create" ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Title</span>
                        <b className="text-zinc-900 truncate max-w-[180px]">{title.trim() ? title.trim() : "—"}</b>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Base price</span>
                        <b className="text-zinc-900">{retailPrice ? ngn.format(toMoneyNumber(retailPrice)) : "—"}</b>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">SKU preview</span>
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
                        <b className="text-zinc-900">{imagesCount}/{MAX_IMAGES}</b>
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
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Selected product</span>
                        <b className="text-zinc-900 truncate max-w-[180px]">{selectedExistingProduct?.title || "—"}</b>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Existing SKU</span>
                        <b className="text-zinc-900 truncate max-w-[180px]">{selectedExistingProduct?.sku || "—"}</b>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Base offer</span>
                        <b className="text-zinc-900">{attachBasePrice ? ngn.format(toMoneyNumber(attachBasePrice)) : "—"}</b>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Lead days</span>
                        <b className="text-zinc-900">{attachLeadDays || "—"}</b>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Total qty</span>
                        <b className={attachTotalQty > 0 ? "text-emerald-700" : "text-rose-700"}>
                          {attachTotalQty}
                        </b>
                      </div>

                      <div className="text-[11px] text-zinc-600">
                        Base: <b>{toIntNonNeg(attachBaseQty)}</b> • Variants total: <b>{attachVariantQtyTotal}</b>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Variant offers</span>
                        <b className="text-zinc-900">{attachVariantRows.length}</b>
                      </div>

                      <div className="rounded-xl border bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600 mt-2">
                        Backend action: <b>POST /api/supplier/products/attach</b>
                      </div>
                    </>
                  )}
                </div>
              </Card>

              <button
                type="button"
                disabled={submitDisabled}
                onClick={handleSubmit}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-white px-4 py-3 text-sm font-semibold disabled:opacity-60"
              >
                {mode === "create" ? <Save size={16} /> : <Link2 size={16} />}
                {isSubmitting ? "Submitting…" : mode === "create" ? "Submit product" : "Attach offer"}
              </button>

              {mode === "attach" && selectedExistingProduct && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 size={16} />
                    Existing product mode
                  </div>
                  <div className="mt-2 text-xs">
                    Core product details stay read-only here. You are only adding supplier-specific offers and stock.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}