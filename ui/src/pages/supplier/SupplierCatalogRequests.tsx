// src/pages/supplier/SupplierCatalogRequests.tsx
import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  ClipboardList,
  Layers,
  Plus,
  RefreshCw,
  Tag,
  TextCursorInput,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { useCatalogMeta, type CatalogAttribute } from "../../hooks/useCatalogMeta";

/* =========================================================
   Types
========================================================= */

type RequestType = "BRAND" | "CATEGORY" | "ATTRIBUTE" | "ATTRIBUTE_VALUE";
type RequestStatus = "PENDING" | "APPROVED" | "REJECTED";

type CatalogRequestRow = {
  id: string;
  type: RequestType;
  status: RequestStatus;

  // common
  name?: string | null;
  slug?: string | null;
  notes?: string | null;

  // category
  parentId?: string | null;

  // attribute
  attributeType?: "TEXT" | "SELECT" | "MULTISELECT" | null;

  // attribute value request
  attributeId?: string | null;
  valueName?: string | null;
  valueCode?: string | null;

  // review info
  adminNote?: string | null;
  reviewedAt?: string | null;

  createdAt?: string | null;
};

type CreateRequestPayload =
  | {
    type: "BRAND";
    name: string;
    slug?: string;
    logoUrl?: string | null;
    notes?: string | null;
  }
  | {
    type: "CATEGORY";
    name: string;
    slug?: string;
    parentId?: string | null;
    notes?: string | null;
  }
  | {
    type: "ATTRIBUTE";
    name: string;
    slug?: string;
    attributeType: "TEXT" | "SELECT" | "MULTISELECT";
    notes?: string | null;
  }
  | {
    type: "ATTRIBUTE_VALUE";
    attributeId: string;
    valueName: string;
    valueCode?: string | null;
    notes?: string | null;
  };

/* =========================================================
   Small helpers
========================================================= */

function slugifyLocal(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function StatusPill({ status }: { status: RequestStatus }) {
  const cls =
    status === "APPROVED"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "REJECTED"
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : "bg-amber-50 text-amber-700 border-amber-200";

  const icon =
    status === "APPROVED" ? (
      <BadgeCheck size={14} />
    ) : status === "REJECTED" ? (
      <XCircle size={14} />
    ) : (
      <ClipboardList size={14} />
    );

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] border ${cls}`}>
      {icon} {status}
    </span>
  );
}

const optStr = (s: string) => {
  const t = String(s ?? "").trim();
  return t.length ? t : undefined;
};

const optId = (s: string | null) => {
  const t = String(s ?? "").trim();
  return t.length ? t : undefined;
};


function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

/* =========================================================
   Page
========================================================= */

export default function SupplierCatalogRequests() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);

  const qc = useQueryClient();

  const [tab, setTab] = useState<"NEW" | "MINE" | "CATALOG">("NEW");

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // auto-suggest tracking (stop overriding once user edits the slug/code manually)
  const [catSlugTouched, setCatSlugTouched] = useState(false);
  const [brandSlugTouched, setBrandSlugTouched] = useState(false);
  const [attrSlugTouched, setAttrSlugTouched] = useState(false);
  const [valCodeTouched, setValCodeTouched] = useState(false);


  // ----- forms state -----
  // Category request
  const [catName, setCatName] = useState("");
  const [catSlug, setCatSlug] = useState("");
  const [catParentId, setCatParentId] = useState<string | null>(null);
  const [catNotes, setCatNotes] = useState("");

  // Brand request
  const [brandName, setBrandName] = useState("");
  const [brandSlug, setBrandSlug] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [brandNotes, setBrandNotes] = useState("");

  // Attribute request
  const [attrName, setAttrName] = useState("");
  const [attrSlug, setAttrSlug] = useState("");
  const [attrType, setAttrType] = useState<"TEXT" | "SELECT" | "MULTISELECT">("SELECT");
  const [attrNotes, setAttrNotes] = useState("");

  // Attribute value request
  const [valAttrId, setValAttrId] = useState<string>("");
  const [valName, setValName] = useState("");
  const [valCode, setValCode] = useState("");
  const [valNotes, setValNotes] = useState("");

  // Existing catalog data
  const { categories, brands, attributes, categoriesQ, brandsQ, attributesQ } = useCatalogMeta({
    enabled: !!token,
  });

  // Restrict to non-sensitive request types suppliers should see
  const selectableAttributes = useMemo(
    () => (attributes || []).filter((a: CatalogAttribute) => a.isActive !== false),
    [attributes]
  );

  function asRequestType(v: any): RequestType {
    const u = String(v ?? "").toUpperCase();
    if (u === "BRAND" || u === "CATEGORY" || u === "ATTRIBUTE" || u === "ATTRIBUTE_VALUE") return u;
    return "BRAND"; // safe default
  }

  function asRequestStatus(v: any): RequestStatus {
    const u = String(v ?? "").toUpperCase();
    if (u === "PENDING" || u === "APPROVED" || u === "REJECTED") return u;
    return "PENDING"; // safe default
  }


  // ----- My requests list -----
  const myRequestsQ = useQuery<CatalogRequestRow[]>({
    queryKey: ["supplier", "catalog-requests", "mine"],
    enabled: !!token && role === "SUPPLIER",
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<CatalogRequestRow[]> => {
      const { data } = await api.get("/api/supplier/catalog-requests", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

      return (arr as any[]).map((r): CatalogRequestRow => ({
        id: String(r.id),
        type: asRequestType(r.type),
        status: asRequestStatus(r.status),

        name: r.name ?? null,
        slug: r.slug ?? null,
        notes: r.notes ?? null,

        parentId: r.parentId ?? null,

        attributeType: r.attributeType ?? null,
        attributeId: r.attributeId ?? null,
        valueName: r.valueName ?? null,
        valueCode: r.valueCode ?? null,

        adminNote: r.adminNote ?? r.reviewNote ?? null,
        reviewedAt: r.reviewedAt ?? null,
        createdAt: r.createdAt ?? null,
      }));
    },
  });


  // ----- Create request mutation -----
  const createReqM = useMutation({
    mutationFn: async (payload: CreateRequestPayload) => {
      setErr(null);
      setOk(null);
      if (!token) throw new Error("Not authenticated");
      const { data } = await api.post("/api/supplier/catalog-requests", payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return data?.data ?? data;
    },
    onSuccess: () => {
      setOk("Request sent ✅ An admin will review it.");
      qc.invalidateQueries({ queryKey: ["supplier", "catalog-requests", "mine"] });
      // optional: refresh catalog meta later, but usually admin action updates it
      setTimeout(() => setOk(null), 3500);
      setTab("MINE");
    },
    onError: (e: any) => {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.detail ||
        e?.message ||
        "Failed to create request";
      setErr(msg);
    },
  });


  function submitCategory() {
    const name = catName.trim();
    if (!name) return setErr("Category name is required.");
    const slug = (catSlug.trim() || slugifyLocal(name)).trim();

    createReqM.mutate({
      type: "CATEGORY",
      name,
      slug,
      parentId: optId(catParentId),   // ✅ undefined when none
      notes: optStr(catNotes),        // ✅ undefined when empty
    });

    setCatName("");
    setCatSlug("");
    setCatParentId(null);
    setCatNotes("");
    setCatSlugTouched(false);
  }

  function submitBrand() {
    const name = brandName.trim();
    if (!name) return setErr("Brand name is required.");
    const slug = (brandSlug.trim() || slugifyLocal(name)).trim();

    createReqM.mutate({
      type: "BRAND",
      name,
      slug,
      logoUrl: optStr(brandLogoUrl),  // ✅ undefined when empty
      notes: optStr(brandNotes),      // ✅ undefined when empty
    });

    setBrandName("");
    setBrandSlug("");
    setBrandLogoUrl("");
    setBrandNotes("");
    setBrandSlugTouched(false);
  }

  function submitAttribute() {
    const name = attrName.trim();
    if (!name) return setErr("Attribute name is required.");
    const slug = (attrSlug.trim() || slugifyLocal(name)).trim();

    createReqM.mutate({
      type: "ATTRIBUTE",
      name,
      slug,
      attributeType: attrType,
      notes: optStr(attrNotes),       // ✅ undefined when empty
    });

    setAttrName("");
    setAttrSlug("");
    setAttrType("SELECT");
    setAttrNotes("");
    setAttrSlugTouched(false);
  }

  function submitAttrValue() {
    const attributeId = String(valAttrId || "").trim();
    const valueName = valName.trim();
    if (!attributeId) return setErr("Select an attribute first.");
    if (!valueName) return setErr("Value name is required.");

    createReqM.mutate({
      type: "ATTRIBUTE_VALUE",
      attributeId,
      valueName,
      valueCode: optStr(valCode),     // ✅ undefined when empty
      notes: optStr(valNotes),        // ✅ undefined when empty
    });

    setValName("");
    setValCode("");
    setValNotes("");
    setValCodeTouched(false);
  }

  const guardMsg =
    role && role !== "SUPPLIER"
      ? "This page is for suppliers only."
      : null;

  return (
    <SiteLayout>
      <SupplierLayout>
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl mt-6 border">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-700 via-blue-700 to-fuchsia-700" />
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,255,255,0.18),transparent_60%)]" />
          <div className="relative px-5 md:px-8 py-8 text-white">
            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-2xl md:text-3xl font-bold tracking-tight"
            >
              Catalog requests <span className="opacity-80">·</span>{" "}
              Brands, Categories & Attributes
            </motion.h1>
            <p className="mt-1 text-sm text-white/80">
              Need a new brand, category, or attribute? Request it here — admins approve to keep the catalog clean.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 rounded-full bg-white text-zinc-900 px-4 py-2 text-sm font-semibold hover:opacity-95"
              >
                Back to overview <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>

        {/* Alerts */}
        {guardMsg && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
            {guardMsg}
          </div>
        )}
        {err && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
            {err}
          </div>
        )}
        {ok && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
            {ok}
          </div>
        )}

        {/* Tabs */}
        <div className="mt-6 flex flex-wrap gap-2">
          {[
            { key: "NEW", label: "New request", icon: <Plus size={16} /> },
            { key: "MINE", label: "My requests", icon: <ClipboardList size={16} /> },
            { key: "CATALOG", label: "Current catalog", icon: <Layers size={16} /> },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key as any)}
              className={[
                "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border",
                tab === t.key
                  ? "bg-zinc-900 text-white border-zinc-900"
                  : "bg-white hover:bg-black/5",
              ].join(" ")}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* LEFT / MAIN */}
          <div className="lg:col-span-2 space-y-4">
            {tab === "NEW" && (
              <>
                {/* Category request */}
                <Card>
                  <div className="px-5 py-4 border-b bg-white/70 flex items-center gap-2">
                    <Layers size={18} className="text-zinc-800" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-900">Request a Category</div>
                      <div className="text-xs text-zinc-500">Admins approve to prevent duplicates and messy taxonomy.</div>
                    </div>
                  </div>

                  <div className="p-5 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-zinc-700 mb-1">Category name *</label>
                        <input
                          value={catName}
                          onChange={(e) => {
                            const v = e.target.value;
                            setCatName(v);

                            if (!catSlugTouched) {
                              setCatSlug(slugifyLocal(v)); // ✅ auto suggest
                            }
                          }}
                          className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                          placeholder="e.g. Small Kitchen Appliances"
                        />

                        <div className="text-[11px] text-zinc-500 mt-1">
                          Suggested slug:{" "}
                          <span className="font-mono">
                            {catSlug.trim() || slugifyLocal(catName)}
                          </span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-zinc-700 mb-1">Slug (optional)</label>
                        <input
                          value={catSlug}
                          onChange={(e) => {
                            const v = e.target.value;
                            setCatSlug(v);

                            // if user starts typing, stop auto mode
                            if (!catSlugTouched) setCatSlugTouched(true);

                            // if user clears it, re-enable auto mode
                            if (!v.trim()) setCatSlugTouched(false);
                          }}
                          className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                          placeholder="e.g. small-kitchen-appliances"
                        />

                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Parent category (optional)</label>
                      <select
                        value={catParentId ?? ""}
                        onChange={(e) => setCatParentId(e.target.value || null)}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                      >
                        <option value="">{categoriesQ.isLoading ? "Loading…" : "— No parent —"}</option>
                        {(categories || []).map((c: any) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Notes (optional)</label>
                      <textarea
                        value={catNotes}
                        onChange={(e) => setCatNotes(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white min-h-[90px]"
                        placeholder="Explain why this category is needed, examples of products, etc."
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={createReqM.isPending || !token || role !== "SUPPLIER"}
                        onClick={submitCategory}
                        className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
                      >
                        <Plus size={16} /> Send category request
                      </button>
                    </div>
                  </div>
                </Card>

                {/* Brand request */}
                <Card>
                  <div className="px-5 py-4 border-b bg-white/70 flex items-center gap-2">
                    <Building2 size={18} className="text-zinc-800" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-900">Request a Brand</div>
                      <div className="text-xs text-zinc-500">Brands should be consistent across the marketplace.</div>
                    </div>
                  </div>

                  <div className="p-5 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-zinc-700 mb-1">Brand name *</label>
                        <input
                          value={brandName}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBrandName(v);

                            if (!brandSlugTouched) {
                              setBrandSlug(slugifyLocal(v));
                            }
                          }}
                          className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                          placeholder="e.g. Philips"
                        />

                        <div className="text-[11px] text-zinc-500 mt-1">
                          Suggested slug:{" "}
                          <span className="font-mono">
                            {brandSlug.trim() || slugifyLocal(brandName)}
                          </span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-zinc-700 mb-1">Slug (optional)</label>
                        <input
                          value={brandSlug}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBrandSlug(v);

                            if (!brandSlugTouched) setBrandSlugTouched(true);
                            if (!v.trim()) setBrandSlugTouched(false);
                          }}
                          className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                          placeholder="e.g. philips"
                        />

                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Logo URL (optional)</label>
                      <input
                        value={brandLogoUrl}
                        onChange={(e) => setBrandLogoUrl(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                        placeholder="https://.../logo.png"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Notes (optional)</label>
                      <textarea
                        value={brandNotes}
                        onChange={(e) => setBrandNotes(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white min-h-[90px]"
                        placeholder="Provide proof/website link, model lines, authenticity notes, etc."
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={createReqM.isPending || !token || role !== "SUPPLIER"}
                        onClick={submitBrand}
                        className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
                      >
                        <Plus size={16} /> Send brand request
                      </button>
                    </div>
                  </div>
                </Card>

                {/* Attribute request */}
                <Card>
                  <div className="px-5 py-4 border-b bg-white/70 flex items-center gap-2">
                    <TextCursorInput size={18} className="text-zinc-800" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-900">Request an Attribute</div>
                      <div className="text-xs text-zinc-500">
                        Attributes are shared (e.g. Color, Size, Material). Admins approve to avoid duplicates like “Colour”.
                      </div>
                    </div>
                  </div>

                  <div className="p-5 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-zinc-700 mb-1">Attribute name *</label>
                        <input
                          value={attrName}
                          onChange={(e) => {
                            const v = e.target.value;
                            setAttrName(v);

                            if (!attrSlugTouched) {
                              setAttrSlug(slugifyLocal(v));
                            }
                          }}
                          className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                          placeholder="e.g. Color"
                        />

                        <div className="text-[11px] text-zinc-500 mt-1">
                          Suggested slug:{" "}
                          <span className="font-mono">
                            {attrSlug.trim() || slugifyLocal(attrName)}
                          </span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-zinc-700 mb-1">Type *</label>
                        <select
                          value={attrType}
                          onChange={(e) => setAttrType(e.target.value as any)}
                          className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                        >
                          <option value="TEXT">TEXT (free text)</option>
                          <option value="SELECT">SELECT (one value)</option>
                          <option value="MULTISELECT">MULTISELECT (many values)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Slug (optional)</label>
                      <input
                        value={attrSlug}
                        onChange={(e) => {
                          const v = e.target.value;
                          setAttrSlug(v);

                          if (!attrSlugTouched) setAttrSlugTouched(true);
                          if (!v.trim()) setAttrSlugTouched(false);
                        }}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                        placeholder="e.g. color"
                      />

                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Notes (optional)</label>
                      <textarea
                        value={attrNotes}
                        onChange={(e) => setAttrNotes(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white min-h-[90px]"
                        placeholder="How should shoppers use it? Examples of values if SELECT/MULTISELECT."
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={createReqM.isPending || !token || role !== "SUPPLIER"}
                        onClick={submitAttribute}
                        className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
                      >
                        <Plus size={16} /> Send attribute request
                      </button>
                    </div>
                  </div>
                </Card>

                {/* Attribute value request */}
                <Card>
                  <div className="px-5 py-4 border-b bg-white/70 flex items-center gap-2">
                    <Tag size={18} className="text-zinc-800" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-900">Request an Attribute Value</div>
                      <div className="text-xs text-zinc-500">
                        For existing SELECT/MULTISELECT attributes (e.g. add “Rose Gold” to Color).
                      </div>
                    </div>
                  </div>

                  <div className="p-5 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Attribute *</label>
                      <select
                        value={valAttrId}
                        onChange={(e) => setValAttrId(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                      >
                        <option value="">
                          {attributesQ.isLoading ? "Loading…" : "— Select attribute —"}
                        </option>
                        {selectableAttributes
                          .filter((a: any) => a.type === "SELECT" || a.type === "MULTISELECT")
                          .map((a: any) => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.type})
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-zinc-700 mb-1">Value name *</label>
                        <input
                          value={valName}
                          onChange={(e) => {
                            const v = e.target.value;
                            setValName(v);

                            if (!valCodeTouched) {
                              setValCode(slugifyLocal(v)); // ✅ auto suggest "code" from valueName
                            }
                          }}
                          className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                          placeholder="e.g. Rose Gold"
                        />

                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-zinc-700 mb-1">Code (optional)</label>
                        <input
                          value={valCode}
                          onChange={(e) => {
                            const v = e.target.value;
                            setValCode(v);

                            if (!valCodeTouched) setValCodeTouched(true);
                            if (!v.trim()) setValCodeTouched(false);
                          }}
                          className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                          placeholder="e.g. rose-gold"
                        />

                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">Notes (optional)</label>
                      <textarea
                        value={valNotes}
                        onChange={(e) => setValNotes(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2 text-sm bg-white min-h-[90px]"
                        placeholder="Explain where it’s used, sample products, etc."
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={createReqM.isPending || !token || role !== "SUPPLIER"}
                        onClick={submitAttrValue}
                        className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
                      >
                        <Plus size={16} /> Send value request
                      </button>
                    </div>
                  </div>
                </Card>
              </>
            )}

            {tab === "MINE" && (
              <Card>
                <div className="px-5 py-4 border-b bg-white/70 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-900">My requests</div>
                    <div className="text-xs text-zinc-500">Track approval status from admins.</div>
                  </div>

                  <button
                    type="button"
                    onClick={() => myRequestsQ.refetch()}
                    className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
                  >
                    <RefreshCw size={16} /> Refresh
                  </button>
                </div>

                <div className="p-5">
                  {myRequestsQ.isLoading && (
                    <div className="text-sm text-zinc-500">Loading your requests…</div>
                  )}

                  {!myRequestsQ.isLoading && (myRequestsQ.data?.length || 0) === 0 && (
                    <div className="text-sm text-zinc-500">
                      No requests yet. Create one from <b>New request</b>.
                    </div>
                  )}

                  {(myRequestsQ.data || []).length > 0 && (
                    <div className="space-y-3">
                      {(myRequestsQ.data || []).map((r) => (
                        <div key={r.id} className="rounded-2xl border bg-white p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-zinc-900">
                                {r.type === "BRAND"
                                  ? "Brand"
                                  : r.type === "CATEGORY"
                                    ? "Category"
                                    : r.type === "ATTRIBUTE"
                                      ? "Attribute"
                                      : "Attribute value"}{" "}
                                request
                              </div>

                              <div className="text-sm text-zinc-700 mt-0.5">
                                {r.type === "ATTRIBUTE_VALUE" ? (
                                  <>
                                    <span className="font-medium">{r.valueName || "—"}</span>
                                    <span className="text-zinc-500">
                                      {" "}
                                      (for attribute {r.attributeId || "—"})
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="font-medium">{r.name || "—"}</span>
                                    {r.attributeType ? (
                                      <span className="text-zinc-500"> · {r.attributeType}</span>
                                    ) : null}
                                  </>
                                )}
                              </div>

                              <div className="text-[11px] text-zinc-500 mt-1">
                                {r.slug ? (
                                  <>
                                    Slug: <span className="font-mono">{r.slug}</span>
                                  </>
                                ) : null}
                                {r.createdAt ? (
                                  <>
                                    {r.slug ? " · " : ""}
                                    Created:{" "}
                                    <span className="font-mono">
                                      {new Date(r.createdAt).toLocaleString()}
                                    </span>
                                  </>
                                ) : null}
                              </div>
                            </div>

                            <StatusPill status={r.status} />
                          </div>

                          {(r.notes || r.adminNote) && (
                            <div className="mt-3 grid gap-2">
                              {r.notes && (
                                <div className="rounded-xl border bg-zinc-50 p-3">
                                  <div className="text-[11px] font-semibold text-zinc-700 mb-1">
                                    Your notes
                                  </div>
                                  <div className="text-sm text-zinc-700 whitespace-pre-wrap">
                                    {r.notes}
                                  </div>
                                </div>
                              )}
                              {r.adminNote && (
                                <div className="rounded-xl border bg-white p-3">
                                  <div className="text-[11px] font-semibold text-zinc-700 mb-1">
                                    Admin note
                                  </div>
                                  <div className="text-sm text-zinc-700 whitespace-pre-wrap">
                                    {r.adminNote}
                                  </div>
                                  {r.reviewedAt && (
                                    <div className="text-[11px] text-zinc-500 mt-1">
                                      Reviewed:{" "}
                                      <span className="font-mono">
                                        {new Date(r.reviewedAt).toLocaleString()}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            )}

            {tab === "CATALOG" && (
              <Card>
                <div className="px-5 py-4 border-b bg-white/70">
                  <div className="text-sm font-semibold text-zinc-900">Current catalog</div>
                  <div className="text-xs text-zinc-500">
                    This is what you can currently select on product creation.
                  </div>
                </div>

                <div className="p-5 space-y-6">
                  <div>
                    <div className="text-xs font-semibold text-zinc-700 mb-2">Categories</div>
                    {categoriesQ.isLoading ? (
                      <div className="text-sm text-zinc-500">Loading…</div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {(categories || []).slice(0, 60).map((c: any) => (
                          <span key={c.id} className="px-3 py-1 rounded-full border bg-white text-xs">
                            {c.name}
                          </span>
                        ))}
                        {(categories || []).length > 60 && (
                          <span className="px-3 py-1 rounded-full border bg-zinc-50 text-xs text-zinc-600">
                            +{(categories || []).length - 60} more…
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-zinc-700 mb-2">Brands</div>
                    {brandsQ.isLoading ? (
                      <div className="text-sm text-zinc-500">Loading…</div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {(brands || []).slice(0, 60).map((b: any) => (
                          <span key={b.id} className="px-3 py-1 rounded-full border bg-white text-xs">
                            {b.name}
                          </span>
                        ))}
                        {(brands || []).length > 60 && (
                          <span className="px-3 py-1 rounded-full border bg-zinc-50 text-xs text-zinc-600">
                            +{(brands || []).length - 60} more…
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-zinc-700 mb-2">Attributes</div>
                    {attributesQ.isLoading ? (
                      <div className="text-sm text-zinc-500">Loading…</div>
                    ) : (
                      <div className="space-y-2">
                        {(selectableAttributes || []).slice(0, 30).map((a: any) => (
                          <div key={a.id} className="rounded-xl border bg-white p-3">
                            <div className="flex items-center justify-between">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-zinc-900">{a.name}</div>
                                <div className="text-[11px] text-zinc-500">
                                  Type: <span className="font-mono">{a.type}</span>
                                </div>
                              </div>
                              <span
                                className={`px-2 py-1 rounded-full text-[11px] border ${a.isActive !== false
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-zinc-50 text-zinc-600 border-zinc-200"
                                  }`}
                              >
                                {a.isActive !== false ? "ACTIVE" : "INACTIVE"}
                              </span>
                            </div>

                            {Array.isArray(a.values) && a.values.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {a.values.slice(0, 18).map((v: any) => (
                                  <span key={v.id} className="px-2 py-1 rounded-full border bg-zinc-50 text-xs">
                                    {v.name}
                                  </span>
                                ))}
                                {a.values.length > 18 && (
                                  <span className="px-2 py-1 rounded-full border bg-zinc-50 text-xs text-zinc-600">
                                    +{a.values.length - 18} more…
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                        {(selectableAttributes || []).length > 30 && (
                          <div className="text-xs text-zinc-500">
                            Showing 30 of {(selectableAttributes || []).length} attributes.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* RIGHT / SIDEBAR */}
          <div className="space-y-4">
            <Card>
              <div className="p-5 flex items-start gap-3">
                <div className="inline-grid place-items-center w-10 h-10 rounded-2xl bg-zinc-900/5 text-zinc-800">
                  <ClipboardList size={18} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-zinc-500">How it works</div>
                  <div className="text-sm font-semibold text-zinc-900">Request → Review → Approved</div>
                  <div className="text-[11px] text-zinc-500 mt-1">
                    To avoid duplicates and keep filtering consistent, admins approve new catalog items.
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="px-5 py-4 border-b bg-white/70">
                <div className="text-sm font-semibold text-zinc-900">Tips</div>
              </div>
              <div className="p-5 text-sm text-zinc-700 space-y-3">
                <div className="flex items-start gap-2">
                  <BadgeCheck size={16} className="mt-0.5 text-emerald-700" />
                  <div>
                    Provide links/proof for brands (official site, product page).
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Layers size={16} className="mt-0.5 text-zinc-800" />
                  <div>
                    Pick the closest parent category to keep browsing clean.
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Tag size={16} className="mt-0.5 text-zinc-800" />
                  <div>
                    For SELECT attributes, request values you’ll reuse (e.g. sizes, colors).
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="p-5">
                <Link
                  to="/supplier/add-product"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-white px-4 py-3 text-sm font-semibold"
                >
                  Back to Add Product <ArrowRight size={16} />
                </Link>
                <div className="text-[11px] text-zinc-500 mt-2">
                  After approval, refresh the Add Product page to see the new options.
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* little spacing */}
        <div className="h-8" />
      </SupplierLayout>
    </SiteLayout>
  );
}
