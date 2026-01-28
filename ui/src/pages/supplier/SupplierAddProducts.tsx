// src/pages/supplier/SupplierAddProducts.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ImagePlus, Plus, Trash2, ArrowLeft, Save, Package } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";
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
  priceBump: string; // bump for this row
  availableQty: string; // qty for this variant row
};

/* =========================
   Helpers
========================= */

function slugifySku(input: string) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, "-")   // non-alnum => dash
    .replace(/-+/g, "-")          // collapse dashes
    .replace(/^-|-$/g, "")        // trim dashes
    .slice(0, 32);                // optional length cap
}


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

// stable key for preventing duplicate combinations (includes blanks => strict match)
function comboKeyFromSelections(selections: Record<string, string>, attrOrder: string[]) {
  return attrOrder.map((aid) => `${aid}=${String(selections?.[aid] || "")}`).join("|");
}

/* =========================
   Component
========================= */

export default function SupplierAddProduct() {
  const nav = useNavigate();
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);

  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // basic form fields
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState(""); // base offer price
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [description, setDescription] = useState("");

  // ✅ baseQuantity (stock for base product, independent of variants)
  const [baseQuantity, setBaseQuantity] = useState<string>("0");

  // images
  const [imageUrls, setImageUrls] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // attributes & variants
  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string | string[]>>({});
  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);
  const skuTouchedRef = useRef(false);
  const ngn = useMemo(
    () =>
      new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 2,
      }),
    []
  );

  // quick guard (optional)
  useEffect(() => {
    if (role && role !== "SUPPLIER") {
      setErr("This page is for suppliers only.");
    }
  }, [role]);

  /* =========================
     Supplier identity (display-only)
  ========================= */

  const supplierMeQ = useQuery<SupplierMe>({
    queryKey: ["supplier", "me"],
    enabled: !!token,
    queryFn: async () => {
      const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
      const attempts = ["/api/supplier/me", "/api/supplier/profile", "/api/supplier/dashboard"];
      for (const url of attempts) {
        try {
          const { data } = await api.get(url, { headers: hdr });
          const d = data?.data ?? data ?? {};
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
    enabled: !!token,
  });

  const activeAttrs = useMemo(() => attributes, [attributes]);

  const selectableAttrs = useMemo(
    () => activeAttrs.filter((a) => a.type === "SELECT" && a.isActive !== false),
    [activeAttrs]
  );

  // stable attribute order for combo keys
  const attrOrder = useMemo(() => selectableAttrs.map((a) => a.id), [selectableAttrs]);

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
     Images upload
  ========================= */

  const UPLOAD_ENDPOINT = "/api/uploads";

  async function uploadLocalFiles(): Promise<string[]> {
    if (!files.length) return [];
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));

    try {
      setUploading(true);
      const res = await api.post(UPLOAD_ENDPOINT, fd, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

  /* =========================
     Variants helpers
  ========================= */

  function addVariantRow() {
    const selections: Record<string, string> = {};
    selectableAttrs.forEach((a) => (selections[a.id] = ""));
    setVariantRows((prev) => [...prev, { id: uid("vr"), selections, priceBump: "", availableQty: "" }]);
  }

  function updateVariantSelection(rowId: string, attributeId: string, valueId: string) {
    setErr(null);

    setVariantRows((rows) => {
      const next = rows.map((r) =>
        r.id === rowId ? { ...r, selections: { ...r.selections, [attributeId]: valueId } } : r
      );

      const changed = next.find((r) => r.id === rowId);
      if (!changed) return rows;

      // ✅ ignore duplicate checks until row has at least 1 selection
      if (!rowHasAnySelection(changed.selections)) return next;

      const changedKey = comboKeyFromSelections(changed.selections, attrOrder);

      const dup = next.find((r) => {
        if (r.id === rowId) return false;
        if (!rowHasAnySelection(r.selections)) return false;
        return comboKeyFromSelections(r.selections, attrOrder) === changedKey;
      });

      if (dup) {
        setErr("That variant combination already exists. Please choose a different combination.");
        return rows; // revert
      }

      return next;
    });
  }

  function updateVariantPriceBump(rowId: string, v: string) {
    setVariantRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, priceBump: v } : r)));
  }

  function updateVariantQty(rowId: string, v: string) {
    setVariantRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, availableQty: v } : r)));
  }

  function removeVariantRow(rowId: string) {
    setVariantRows((rows) => rows.filter((r) => r.id !== rowId));
  }

  /* =========================
     ✅ Stock model
     total = baseQuantity + sum(variant quantities)
  ========================= */

  const baseQtyPreview = useMemo(() => toIntNonNeg(baseQuantity), [baseQuantity]);

  const isRealVariantRow = (r: VariantRow) => rowHasAnySelection(r.selections);

  const variantQtyTotal = useMemo(() => {
    return variantRows.reduce((sum, r) => sum + (isRealVariantRow(r) ? toIntNonNeg(r.availableQty) : 0), 0);
  }, [variantRows]);

  const totalQty = useMemo(() => baseQtyPreview + variantQtyTotal, [baseQtyPreview, variantQtyTotal]);

  const inStockPreview = totalQty > 0;
  const variantsEnabled = useMemo(() => variantRows.some(isRealVariantRow), [variantRows]);

  // ✅ Detect duplicates (ignore empty rows)
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

  /* =========================
     Build payload
     ✅ Make baseQuantity persist by also sending
       common legacy aliases many APIs use
  ========================= */

  function buildPayload(imagesJson: string[]) {
    const baseSku = sku.trim();
    const basePrice = toMoneyNumber(price);

    const baseQty = baseQtyPreview;
    const total = totalQty;

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
      priceBump?: number | null;
      availableQty?: number | null;
      inStock?: boolean;
      imagesJson?: string[];
      options?: Array<{ attributeId: string; valueId: string }>;
    }> = [];

    if (variantRows.length && selectableAttrs.length) {
      for (const row of variantRows) {
        const picks = Object.entries(row.selections || {}).filter(([, valueId]) => !!String(valueId || "").trim());
        if (!picks.length) continue; // ignore empty rows

        const bumpNum = row.priceBump === "" || row.priceBump == null ? 0 : toMoneyNumber(row.priceBump);
        const rowQty = toIntNonNeg(row.availableQty);

        const options = picks.map(([attributeId, valueId]) => ({ attributeId, valueId }));

        // SKU suffix from selected values (optional)
        let variantSku: string | undefined;
        {
          const labelParts: string[] = [];
          for (const [attributeId, valueId] of picks) {
            const attr = selectableAttrs.find((a) => a.id === attributeId);
            const val = attr?.values?.find((v) => v.id === valueId);
            const code = (val?.code || val?.name || "").toString();
            if (code) labelParts.push(code.toUpperCase().replace(/\s+/g, ""));
          }
          const suffix = labelParts.join("-");
          variantSku = baseSku && suffix ? `${baseSku}-${suffix}` : baseSku || suffix || undefined;
        }

        variants.push({
          sku: variantSku,
          priceBump: bumpNum,
          availableQty: rowQty,
          inStock: rowQty > 0,
          imagesJson: [],
          options,
        });
      }
    }

    // ✅ NOTE: we keep existing fields unchanged, but ADD aliases so backend persists base qty
    return {
      title: title.trim(),
      description: description?.trim() || "",
      price: basePrice,
      ...(baseSku ? { sku: baseSku } : {}),

      // ✅ base qty (new + aliases)
      baseQuantity: baseQty,
      baseQty: baseQty,
      // some backends persist this as the offer qty
      availableQty: baseQty,
      // some backends use this naming
      offerAvailableQty: baseQty,

      // ✅ base price alias (some schemas use offerPrice)
      offerPrice: basePrice,

      // keep existing nested object (your UI already uses this)
      offer: {
        basePrice: basePrice,
        currency: "NGN",
        availableQty: baseQty,
        inStock: total > 0,
        isActive: true,
      },

      // cached totals (unchanged)
      availableQtyTotal: total,
      productAvailableQty: total,
      totalQty: total,
      inStock: total > 0,

      categoryId: categoryId || undefined,
      brandId: brandId || undefined,
      imagesJson,

      ...(attributeSelections.length ? { attributeSelections } : {}),
      ...(variants.length ? { variants } : {}),
    };
  }

  /* =========================
     Create mutation
  ========================= */

  const createM = useMutation({
    mutationFn: async () => {
      setErr(null);
      setOkMsg(null);

      if (!token) throw new Error("Not authenticated");
      if (!title.trim()) throw new Error("Title is required");

      const p = toMoneyNumber(price);
      if (!Number.isFinite(p) || p <= 0) throw new Error("Price must be greater than 0");

      if (duplicateRowIds.size > 0) {
        throw new Error("You have duplicate variant combinations. Please remove or change them before submitting.");
      }

      const urlList = parseUrlList(imageUrls).filter(isUrlish);
      const freshlyUploaded = files.length ? await uploadLocalFiles() : [];
      const imagesJson = [...urlList, ...uploadedUrls, ...freshlyUploaded].filter(Boolean);

      const payload = buildPayload(imagesJson);

      const { data } = await api.post("/api/supplier/products", payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      return data?.data ?? data;
    },
    onSuccess: () => {
      setOkMsg("Product submitted ✅ It will appear once reviewed.");
      setTimeout(() => nav("/supplier/products", { replace: true }), 600);
    },
    onError: (e: any) => {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.error ||
        e?.message ||
        "Could not create product";
      setErr(msg);
    },
  });

  /* =========================
     Image previews
  ========================= */

  const urlPreviews = useMemo(() => parseUrlList(imageUrls).filter(isUrlish), [imageUrls]);

  const filePreviews = useMemo(() => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })), [files]);

  useEffect(() => {
    return () => {
      filePreviews.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [filePreviews]);


  useEffect(() => {
    // Only auto-generate if user hasn't manually touched the SKU field
    if (skuTouchedRef.current) return;

    const next = slugifySku(title);

    // if title becomes empty, clear sku too (only if untouched)
    setSku(next);
  }, [title]);


  const allUrlPreviews = useMemo(() => {
    const uniq = new Set<string>();
    [...urlPreviews, ...uploadedUrls].forEach((u) => {
      if (u && isUrlish(u)) uniq.add(u);
    });
    return Array.from(uniq);
  }, [urlPreviews, uploadedUrls]);

  const variantRowsWithSelections = useMemo(
    () => variantRows.filter((r) => rowHasAnySelection(r.selections)),
    [variantRows]
  );

  return (
    <SiteLayout>
      <SupplierLayout>
        <div className="mt-6 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
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

            <div className="flex gap-2">
              <Link
                to="/supplier/products"
                className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
              >
                <ArrowLeft size={16} /> Back
              </Link>
              <button
                type="button"
                disabled={createM.isPending || uploading}
                onClick={() => createM.mutate()}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
              >
                <Save size={16} /> {createM.isPending ? "Submitting…" : "Submit product"}
              </button>
            </div>
          </div>

          {/* Alerts */}
          {err && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
              {err}
            </div>
          )}
          {okMsg && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
              {okMsg}
            </div>
          )}

          {/* Form */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left */}
            <div className="lg:col-span-2 space-y-4">
              {/* Basic info */}
              <div className="rounded-2xl border bg-white/90 shadow-sm">
                <div className="px-5 py-4 border-b bg-white/70">
                  <div className="text-sm font-semibold text-zinc-900">Basic information</div>
                  <div className="text-xs text-zinc-500">What customers will see in the catalog</div>
                </div>

                <div className="p-5 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Title *</label>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                        placeholder="e.g. Air Fryer 4L"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        SKU <span className="text-zinc-400 font-normal">(optional)</span>
                      </label>
                      <input
                        value={sku}
                        onChange={(e) => {
                          skuTouchedRef.current = true;
                          setSku(e.target.value);
                        }}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                        placeholder="e.g. AFRY-4L-BLK"
                      />
                      <button
                        type="button"
                        className="text-[11px] text-zinc-600 underline mt-1"
                        onClick={() => {
                          skuTouchedRef.current = false;
                          setSku(slugifySku(title));
                        }}
                      >
                        Reset to auto SKU
                      </button>

                      <div className="text-[11px] text-zinc-500 mt-1">
                        If left blank, the backend may auto-generate a unique SKU.
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Base offer price (NGN) *
                      </label>
                      <input
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        inputMode="decimal"
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                        placeholder="e.g. 25000"
                      />
                      {!!price && (
                        <div className="text-[11px] text-zinc-500 mt-1">
                          Preview: <b>{ngn.format(toMoneyNumber(price))}</b>
                        </div>
                      )}
                      <div className="text-[11px] text-zinc-500 mt-1">
                        Saved as <code>offer.basePrice</code> (and also <code>price</code> for compatibility).
                      </div>
                    </div>

                    {/* ✅ BaseQuantity */}
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Base quantity</label>
                      <input
                        value={baseQuantity}
                        onChange={(e) => setBaseQuantity(e.target.value)}
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
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Category</label>
                      <select
                        value={categoryId}
                        onChange={(e) => setCategoryId(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
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
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
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
                      className="w-full rounded-xl border px-3 py-2 text-sm bg-white min-h-[110px]"
                      placeholder="Write a clear, detailed description…"
                    />
                  </div>
                </div>
              </div>

              {/* Images */}
              <div className="rounded-2xl border bg-white/90 shadow-sm">
                <div className="px-5 py-4 border-b bg-white/70 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">Images</div>
                    <div className="text-xs text-zinc-500">
                      Paste URLs or upload images (saved to <code>imagesJson</code>).
                    </div>
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
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Image URLs (one per line)
                    </label>
                    <textarea
                      value={imageUrls}
                      onChange={(e) => setImageUrls(e.target.value)}
                      className="w-full rounded-xl border px-3 py-2 text-xs bg-white min-h-[90px]"
                      placeholder={"https://.../image1.jpg\nhttps://.../image2.png"}
                    />
                  </div>

                  {(allUrlPreviews.length > 0 || filePreviews.length > 0) && (
                    <div className="mt-1">
                      <div className="text-xs font-semibold text-zinc-800 mb-2">Image previews</div>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {allUrlPreviews.slice(0, 12).map((u) => (
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

                        {filePreviews.slice(0, 12).map(({ file, url }) => (
                          <div key={url} className="rounded-xl border overflow-hidden bg-white">
                            <div className="aspect-[4/3] bg-zinc-100">
                              <img src={url} alt={file.name} className="w-full h-full object-cover" />
                            </div>
                            <div className="p-2 text-[10px] text-zinc-600 truncate">{file.name}</div>
                          </div>
                        ))}
                      </div>

                      {allUrlPreviews.length + filePreviews.length > 12 && (
                        <div className="mt-2 text-[11px] text-zinc-500">Showing first 12 previews.</div>
                      )}
                    </div>
                  )}

                  {uploadedUrls.length > 0 && (
                    <div className="rounded-xl border bg-emerald-50 p-3 text-xs text-emerald-800">
                      Uploaded: <b>{uploadedUrls.length}</b> image(s)
                    </div>
                  )}

                  {files.length > 0 && (
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-xs font-semibold text-zinc-800">
                        Selected files: <span className="font-mono">{files.length}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {files.map((f, i) => (
                          <div key={`${f.name}-${i}`} className="text-[11px] rounded-full border bg-zinc-50 px-3 py-1">
                            {f.name}
                          </div>
                        ))}
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
                </div>
              </div>

              {/* Attributes */}
              <div className="rounded-2xl border bg-white/90 shadow-sm">
                <div className="px-5 py-4 border-b bg-white/70">
                  <div className="text-sm font-semibold text-zinc-900">Attributes</div>
                  <div className="text-xs text-zinc-500">Optional details used for filtering and variant setup.</div>
                </div>

                <div className="p-5 space-y-3">
                  {attributesQ.isLoading && <div className="text-sm text-zinc-500">Loading attributes…</div>}
                  {!attributesQ.isLoading && activeAttrs.length === 0 && (
                    <div className="text-sm text-zinc-500">No active attributes configured.</div>
                  )}

                  {activeAttrs.map((a: CatalogAttribute) => {
                    if (a.type === "TEXT") {
                      const v = String(selectedAttrs[a.id] ?? "");
                      return (
                        <div key={a.id}>
                          <label className="block text-xs font-semibold text-zinc-700 mb-1">{a.name}</label>
                          <input
                            value={v}
                            onChange={(e) => setSelectedAttrs((s) => ({ ...s, [a.id]: e.target.value }))}
                            className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                            placeholder={a.placeholder || `Enter ${a.name.toLowerCase()}…`}
                          />
                        </div>
                      );
                    }

                    if (a.type === "SELECT") {
                      const v = String(selectedAttrs[a.id] ?? "");
                      return (
                        <div key={a.id}>
                          <label className="block text-xs font-semibold text-zinc-700 mb-1">{a.name}</label>
                          <select
                            value={v}
                            onChange={(e) => setSelectedAttrs((s) => ({ ...s, [a.id]: e.target.value }))}
                            className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                          >
                            <option value="">— Select —</option>
                            {(a.values || []).map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    }

                    // MULTISELECT
                    const arr = Array.isArray(selectedAttrs[a.id]) ? (selectedAttrs[a.id] as string[]) : [];
                    return (
                      <div key={a.id} className="rounded-xl border bg-white p-3">
                        <div className="text-xs font-semibold text-zinc-700 mb-2">{a.name}</div>
                        <div className="flex flex-wrap gap-2">
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

              {/* Variant rows */}
              <div className="rounded-2xl border bg-white/90 shadow-sm">
                <div className="px-5 py-4 border-b bg-white/70 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">Variant combinations</div>
                    <div className="text-xs text-zinc-500">
                      Add combinations of <b>SELECT</b> attributes (e.g. Color/Size) with a price bump and qty.
                      <br />
                      <span className="text-zinc-500">
                        Total product stock = base quantity + sum of variant quantities.
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={addVariantRow}
                    disabled={!selectableAttrs.length}
                    className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-60"
                  >
                    <Plus size={16} /> Add row
                  </button>
                </div>

                <div className="p-5 space-y-2">
                  {!selectableAttrs.length && (
                    <div className="text-sm text-zinc-500">
                      No SELECT attributes are available. Create SELECT attributes (like Size/Color) to enable variants.
                    </div>
                  )}

                  {variantRows.length > 0 && (
                    <div className="rounded-xl border bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
                      Stock is <b>base + variants</b>. Variant qty contributes to total automatically.
                    </div>
                  )}

                  {variantRows.map((row) => {
                    const rowQty = toIntNonNeg(row.availableQty);
                    const rowInStock = rowQty > 0;
                    const isDup = duplicateRowIds.has(row.id);

                    return (
                      <div
                        key={row.id}
                        className={`rounded-2xl border bg-white p-3 space-y-2 ${isDup ? "border-rose-300 ring-2 ring-rose-100" : ""
                          }`}
                      >
                        <div className="flex flex-wrap gap-2 items-center">
                          {selectableAttrs.map((attr) => {
                            const valueId = row.selections[attr.id] || "";
                            const hasSelection = !!valueId;
                            return (
                              <div key={attr.id} className="flex items-center gap-2">
                                {hasSelection && <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />}
                                <select
                                  value={valueId}
                                  onChange={(e) => updateVariantSelection(row.id, attr.id, e.target.value)}
                                  className="rounded-xl border px-3 py-2 text-xs bg-white"
                                >
                                  <option value="">{attr.name}</option>
                                  {(attr.values || []).map((v) => (
                                    <option key={v.id} value={v.id}>
                                      {v.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            );
                          })}

                          <div className="flex items-center gap-2 ml-auto">
                            <span className="text-xs text-zinc-500">Qty</span>
                            <input
                              value={row.availableQty}
                              onChange={(e) => updateVariantQty(row.id, e.target.value)}
                              inputMode="numeric"
                              className="w-20 rounded-xl border px-3 py-2 text-xs bg-white"
                              placeholder="e.g. 5"
                            />

                            <span className="text-xs text-zinc-500">Bump</span>
                            <input
                              value={row.priceBump}
                              onChange={(e) => updateVariantPriceBump(row.id, e.target.value)}
                              inputMode="decimal"
                              className="w-24 rounded-xl border px-3 py-2 text-xs bg-white"
                              placeholder="e.g. 1500"
                            />

                            <span
                              className={`text-[11px] font-semibold px-2 py-1 rounded-full border ${rowInStock
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-rose-50 text-rose-700 border-rose-200"
                                }`}
                              title="This is based on the variant qty"
                            >
                              {rowInStock ? "In stock" : "Out of stock"}
                            </span>

                            <button
                              type="button"
                              onClick={() => removeVariantRow(row.id)}
                              className="inline-flex items-center gap-2 rounded-xl border bg-rose-50 text-rose-700 px-3 py-2 text-xs font-semibold hover:bg-rose-100"
                            >
                              <Trash2 size={14} /> Remove
                            </button>
                          </div>
                        </div>

                        <div className="text-[11px] text-zinc-500 flex flex-wrap gap-3">
                          <span>
                            Variant price:{" "}
                            <b>{ngn.format(toMoneyNumber(price) + toMoneyNumber(row.priceBump || 0))}</b> (base + bump)
                          </span>
                          <span>
                            Variant qty: <b>{rowQty}</b>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right: summary */}
            <div className="space-y-4">
              <div className="rounded-2xl border bg-white/90 shadow-sm">
                <div className="px-5 py-4 border-b bg-white/70">
                  <div className="text-sm font-semibold text-zinc-900">Submission summary</div>
                  <div className="text-xs text-zinc-500">What will be created</div>
                </div>

                <div className="p-5 text-sm text-zinc-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Status</span>
                    <b className="text-amber-700">PENDING</b>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Title</span>
                    <b className="text-zinc-900">{title.trim() ? title.trim() : "—"}</b>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Base price</span>
                    <b className="text-zinc-900">{price ? ngn.format(toMoneyNumber(price)) : "—"}</b>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">SKU</span>
                    <b className="text-zinc-900">{sku.trim() ? sku.trim() : "Auto-generated"}</b>
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
                    <span className="text-zinc-500">Variant rows</span>
                    <b className="text-zinc-900">{variantRows.length}</b>
                  </div>

                  {variantsEnabled && (
                    <div className="text-[11px] text-zinc-600 mt-2">
                      Rows with selections: <b>{variantRowsWithSelections.length}</b>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                disabled={createM.isPending || uploading}
                onClick={() => createM.mutate()}
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
