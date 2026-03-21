// src/pages/supplier/SupplierCatalogRequests.tsx
import React, { useMemo, useState, useEffect } from "react";
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
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

  name?: string | null;
  slug?: string | null;
  notes?: string | null;

  parentId?: string | null;

  attributeType?: "TEXT" | "SELECT" | "MULTISELECT" | null;

  attributeId?: string | null;
  valueName?: string | null;
  valueCode?: string | null;

  adminNote?: string | null;
  reviewedAt?: string | null;
  createdAt?: string | null;
};

type CatalogRequestsEnvelope = {
  rows: CatalogRequestRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
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

const PAGE_SIZES = [10, 20, 50, 100] as const;

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

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

function asRequestType(v: any): RequestType {
  const u = String(v ?? "").toUpperCase();
  if (u === "BRAND" || u === "CATEGORY" || u === "ATTRIBUTE" || u === "ATTRIBUTE_VALUE") return u;
  return "BRAND";
}

function asRequestStatus(v: any): RequestStatus {
  const u = String(v ?? "").toUpperCase();
  if (u === "PENDING" || u === "APPROVED" || u === "REJECTED") return u;
  return "PENDING";
}

function prettyDate(v?: string | null) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function toInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeRequestsResponse(raw: any, fallbackPage: number, fallbackPageSize: number): CatalogRequestsEnvelope {
  const root = raw?.data ?? raw ?? {};
  const payload = root?.data ?? root ?? {};

  const rawRows = Array.isArray(payload?.rows)
    ? payload.rows
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(root?.data)
        ? root.data
        : [];

  const rows: CatalogRequestRow[] = rawRows.map((r: any) => ({
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

  const page = Math.max(1, toInt(payload?.page ?? root?.page, fallbackPage));
  const pageSize = Math.max(1, toInt(payload?.pageSize ?? root?.pageSize, fallbackPageSize));
  const total = Math.max(0, toInt(payload?.total ?? root?.total, rows.length));
  const totalPages = Math.max(1, toInt(payload?.totalPages ?? root?.totalPages, Math.ceil(total / pageSize) || 1));

  return {
    rows,
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: Boolean(payload?.hasNextPage ?? root?.hasNextPage ?? page < totalPages),
    hasPrevPage: Boolean(payload?.hasPrevPage ?? root?.hasPrevPage ?? page > 1),
  };
}

/* =========================================================
   Page
========================================================= */

export default function SupplierCatalogRequests() {
  const hydrated = useAuthStore((s: any) => s.hydrated) as boolean;
  const role = useAuthStore((s: any) => s.user?.role) as string | undefined;

  useEffect(() => {
    useAuthStore.getState().bootstrap?.().catch?.(() => null);
  }, []);

  const qc = useQueryClient();

  const [tab, setTab] = useState<"NEW" | "MINE" | "CATALOG">("NEW");

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [catSlugTouched, setCatSlugTouched] = useState(false);
  const [brandSlugTouched, setBrandSlugTouched] = useState(false);
  const [attrSlugTouched, setAttrSlugTouched] = useState(false);
  const [valCodeTouched, setValCodeTouched] = useState(false);

  const [catName, setCatName] = useState("");
  const [catSlug, setCatSlug] = useState("");
  const [catParentId, setCatParentId] = useState<string | null>(null);
  const [catNotes, setCatNotes] = useState("");

  const [brandName, setBrandName] = useState("");
  const [brandSlug, setBrandSlug] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [brandNotes, setBrandNotes] = useState("");

  const [attrName, setAttrName] = useState("");
  const [attrSlug, setAttrSlug] = useState("");
  const [attrType, setAttrType] = useState<"TEXT" | "SELECT" | "MULTISELECT">("SELECT");
  const [attrNotes, setAttrNotes] = useState("");

  const [valAttrId, setValAttrId] = useState<string>("");
  const [valName, setValName] = useState("");
  const [valCode, setValCode] = useState("");
  const [valNotes, setValNotes] = useState("");

  const [mineSearch, setMineSearch] = useState("");
  const [mineStatus, setMineStatus] = useState<"" | RequestStatus>("");
  const [mineType, setMineType] = useState<"" | RequestType>("");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);

  const location = useLocation();

  const categoryRef = React.useRef<HTMLDivElement | null>(null);
  const brandRef = React.useRef<HTMLDivElement | null>(null);
  const attributeRef = React.useRef<HTMLDivElement | null>(null);
  const valueRef = React.useRef<HTMLDivElement | null>(null);

  function scrollToRef(ref: React.RefObject<HTMLDivElement | null>) {
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const { categories, brands, attributes, categoriesQ, brandsQ, attributesQ } = useCatalogMeta({
    enabled: hydrated,
  });

  const selectableAttributes = useMemo(
    () => (attributes || []).filter((a: CatalogAttribute) => a.isActive !== false),
    [attributes]
  );

  const isSupplier = role === "SUPPLIER";

  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>();
    (categories || []).forEach((c: any) => {
      if (c?.id) m.set(String(c.id), String(c.name ?? c.id));
    });
    return m;
  }, [categories]);

  const attributeNameById = useMemo(() => {
    const m = new Map<string, string>();
    (attributes || []).forEach((a: any) => {
      if (a?.id) m.set(String(a.id), String(a.name ?? a.id));
    });
    return m;
  }, [attributes]);

  useEffect(() => {
    setPage(1);
  }, [mineSearch, mineStatus, mineType]);

  useEffect(() => {
    setPage(1);
  }, [pageSize]);

  const myRequestsQ = useQuery<CatalogRequestsEnvelope>({
    queryKey: ["supplier", "catalog-requests", "mine", { page, pageSize, mineSearch, mineStatus, mineType }],
    enabled: hydrated && isSupplier,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<CatalogRequestsEnvelope> => {
      const { data } = await api.get("/api/supplier/catalog-requests", {
        withCredentials: true,
        params: {
          page,
          pageSize,
          ...(mineSearch.trim() ? { q: mineSearch.trim() } : {}),
          ...(mineStatus ? { status: mineStatus } : {}),
          ...(mineType ? { type: mineType } : {}),
        },
      });

      return normalizeRequestsResponse(data, page, pageSize);
    },
  });

  const createReqM = useMutation({
    mutationFn: async (payload: CreateRequestPayload) => {
      setErr(null);
      setOk(null);
      if (!hydrated) throw new Error("Not authenticated");

      const { data } = await api.post("/api/supplier/catalog-requests", payload, {
        withCredentials: true,
      });
      return data?.data ?? data;
    },
    onSuccess: async () => {
      setOk("Request sent ✅ An admin will review it.");
      await qc.invalidateQueries({ queryKey: ["supplier", "catalog-requests", "mine"] });
      setTimeout(() => setOk(null), 3500);
      setTab("MINE");
      setPage(1);
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || e?.response?.data?.detail || e?.message || "Failed to create request";
      setErr(msg);
    },
  });

  function submitCategory() {
    setErr(null);
    const name = catName.trim();
    if (!name) return setErr("Category name is required.");
    const slug = (catSlug.trim() || slugifyLocal(name)).trim();

    createReqM.mutate({
      type: "CATEGORY",
      name,
      slug,
      parentId: optId(catParentId),
      notes: optStr(catNotes),
    });

    setCatName("");
    setCatSlug("");
    setCatParentId(null);
    setCatNotes("");
    setCatSlugTouched(false);
  }

  function submitBrand() {
    setErr(null);
    const name = brandName.trim();
    if (!name) return setErr("Brand name is required.");
    const slug = (brandSlug.trim() || slugifyLocal(name)).trim();

    createReqM.mutate({
      type: "BRAND",
      name,
      slug,
      logoUrl: optStr(brandLogoUrl),
      notes: optStr(brandNotes),
    });

    setBrandName("");
    setBrandSlug("");
    setBrandLogoUrl("");
    setBrandNotes("");
    setBrandSlugTouched(false);
  }

  function submitAttribute() {
    setErr(null);
    const name = attrName.trim();
    if (!name) return setErr("Attribute name is required.");
    const slug = (attrSlug.trim() || slugifyLocal(name)).trim();

    createReqM.mutate({
      type: "ATTRIBUTE",
      name,
      slug,
      attributeType: attrType,
      notes: optStr(attrNotes),
    });

    setAttrName("");
    setAttrSlug("");
    setAttrType("SELECT");
    setAttrNotes("");
    setAttrSlugTouched(false);
  }

  function submitAttrValue() {
    setErr(null);
    const attributeId = String(valAttrId || "").trim();
    const valueName = valName.trim();
    if (!attributeId) return setErr("Select an attribute first.");
    if (!valueName) return setErr("Value name is required.");

    createReqM.mutate({
      type: "ATTRIBUTE_VALUE",
      attributeId,
      valueName,
      valueCode: optStr(valCode),
      notes: optStr(valNotes),
    });

    setValName("");
    setValCode("");
    setValNotes("");
    setValCodeTouched(false);
  }

  const guardMsg = role && role !== "SUPPLIER" ? "This page is for suppliers only." : null;

  const myRequestsRows = myRequestsQ.data?.rows || [];
  const myRequestsTotal = myRequestsQ.data?.total || 0;
  const myRequestsPage = myRequestsQ.data?.page || page;
  const myRequestsPageSize = myRequestsQ.data?.pageSize || pageSize;
  const myRequestsTotalPages = myRequestsQ.data?.totalPages || 1;
  const myRequestsHasPrev = myRequestsQ.data?.hasPrevPage || false;
  const myRequestsHasNext = myRequestsQ.data?.hasNextPage || false;

  const mineStart = myRequestsTotal === 0 ? 0 : (myRequestsPage - 1) * myRequestsPageSize + 1;
  const mineEnd = myRequestsTotal === 0 ? 0 : Math.min(myRequestsPage * myRequestsPageSize, myRequestsTotal);

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const focus = (sp.get("focus") || "").toLowerCase();
    const hash = (location.hash || "").replace("#", "").toLowerCase();

    const target = focus || hash;
    if (!target) return;

    setTab("NEW");

    const t = window.setTimeout(() => {
      if (target === "category") scrollToRef(categoryRef);
      if (target === "brand") scrollToRef(brandRef);
      if (target === "attribute") scrollToRef(attributeRef);
      if (target === "value" || target === "attribute_value") scrollToRef(valueRef);
    }, 50);

    return () => window.clearTimeout(t);
  }, [location.search, location.hash]);

  return (
    <SiteLayout>
      <SupplierLayout>
        <div className="relative overflow-hidden rounded-3xl mt-4 sm:mt-6 border">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-700 via-blue-700 to-fuchsia-700" />
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,255,255,0.18),transparent_60%)]" />
          <div className="relative px-4 sm:px-6 md:px-8 py-6 sm:py-8 text-white">
            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-[20px] sm:text-2xl md:text-3xl font-bold tracking-tight leading-tight"
            >
              Catalog requests <span className="opacity-80">·</span> Brands, Categories & Attributes
            </motion.h1>
            <p className="mt-1 text-[13px] sm:text-sm text-white/80 leading-snug">
              Need a new brand, category, or attribute? Request it here — admins approve to keep the catalog clean.
            </p>

            <div className="mt-4 grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
              <Link
                to="/supplier"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-white text-zinc-900 px-3 py-2 text-[12px] sm:px-4 sm:py-2 sm:text-sm font-semibold hover:opacity-95"
              >
                Back to overview <ArrowRight size={14} />
              </Link>
              <Link
                to="/supplier/add-product"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-white/15 text-white px-3 py-2 text-[12px] sm:px-4 sm:py-2 sm:text-sm font-semibold border border-white/30 hover:bg-white/20"
              >
                Add product <ArrowRight size={14} />
              </Link>
            </div>

            {!hydrated ? <div className="mt-3 text-[12px] text-white/80">Loading session…</div> : null}
          </div>
        </div>

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

        <div className="mt-4 sm:mt-6 -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {[
              { key: "NEW", label: "New", icon: <Plus size={16} /> },
              { key: "MINE", label: "My requests", icon: <ClipboardList size={16} /> },
              { key: "CATALOG", label: "Catalog", icon: <Layers size={16} /> },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key as any)}
                className={[
                  "shrink-0 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] sm:text-sm font-semibold border",
                  tab === t.key ? "bg-zinc-900 text-white border-zinc-900" : "bg-white hover:bg-black/5",
                ].join(" ")}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="order-1 lg:order-none lg:col-span-2 space-y-4">
            {tab === "NEW" && (
              <>
                <div ref={categoryRef} />
                <Card>
                  <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70 flex items-center gap-2">
                    <Layers size={18} className="text-zinc-800" />
                    <div className="min-w-0">
                      <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">Request a Category</div>
                      <div className="text-[11px] sm:text-xs text-zinc-500">
                        Admins approve to prevent duplicates and messy taxonomy.
                      </div>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Category name *</label>
                        <input
                          value={catName}
                          onChange={(e) => {
                            const v = e.target.value;
                            setCatName(v);
                            if (!catSlugTouched) setCatSlug(slugifyLocal(v));
                          }}
                          className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white"
                          placeholder="e.g. Small Kitchen Appliances"
                        />
                        <div className="text-[11px] text-zinc-500 mt-1">
                          Suggested: <span className="font-mono">{catSlug.trim() || slugifyLocal(catName)}</span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Slug (optional)</label>
                        <input
                          value={catSlug}
                          onChange={(e) => {
                            const v = e.target.value;
                            setCatSlug(v);
                            if (!catSlugTouched) setCatSlugTouched(true);
                            if (!v.trim()) setCatSlugTouched(false);
                          }}
                          className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white"
                          placeholder="e.g. small-kitchen-appliances"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Parent category (optional)</label>
                      <select
                        value={catParentId ?? ""}
                        onChange={(e) => setCatParentId(e.target.value || null)}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white"
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
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Notes (optional)</label>
                      <textarea
                        value={catNotes}
                        onChange={(e) => setCatNotes(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white min-h-[90px]"
                        placeholder="Why is this category needed? Examples of products…"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={createReqM.isPending || !hydrated || !isSupplier}
                      onClick={submitCategory}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                    >
                      <Plus size={16} /> Send category request
                    </button>
                  </div>
                </Card>

                <div ref={brandRef} />
                <Card>
                  <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70 flex items-center gap-2">
                    <Building2 size={18} className="text-zinc-800" />
                    <div className="min-w-0">
                      <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">Request a Brand</div>
                      <div className="text-[11px] sm:text-xs text-zinc-500">
                        Brands should be consistent across the marketplace.
                      </div>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Brand name *</label>
                        <input
                          value={brandName}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBrandName(v);
                            if (!brandSlugTouched) setBrandSlug(slugifyLocal(v));
                          }}
                          className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white"
                          placeholder="e.g. Philips"
                        />
                        <div className="text-[11px] text-zinc-500 mt-1">
                          Suggested: <span className="font-mono">{brandSlug.trim() || slugifyLocal(brandName)}</span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Slug (optional)</label>
                        <input
                          value={brandSlug}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBrandSlug(v);
                            if (!brandSlugTouched) setBrandSlugTouched(true);
                            if (!v.trim()) setBrandSlugTouched(false);
                          }}
                          className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white"
                          placeholder="e.g. philips"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Logo URL (optional)</label>
                      <input
                        value={brandLogoUrl}
                        onChange={(e) => setBrandLogoUrl(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white"
                        placeholder="https://.../logo.png"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Notes (optional)</label>
                      <textarea
                        value={brandNotes}
                        onChange={(e) => setBrandNotes(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white min-h-[90px]"
                        placeholder="Provide proof/website link, authenticity notes…"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={createReqM.isPending || !hydrated || !isSupplier}
                      onClick={submitBrand}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                    >
                      <Plus size={16} /> Send brand request
                    </button>
                  </div>
                </Card>

                <div ref={attributeRef} />
                <Card>
                  <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70 flex items-center gap-2">
                    <TextCursorInput size={18} className="text-zinc-800" />
                    <div className="min-w-0">
                      <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">Request an Attribute</div>
                      <div className="text-[11px] sm:text-xs text-zinc-500">
                        Shared fields (e.g. Color, Size). Admins approve to avoid duplicates like “Colour”.
                      </div>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Attribute name *</label>
                        <input
                          value={attrName}
                          onChange={(e) => {
                            const v = e.target.value;
                            setAttrName(v);
                            if (!attrSlugTouched) setAttrSlug(slugifyLocal(v));
                          }}
                          className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white"
                          placeholder="e.g. Color"
                        />
                        <div className="text-[11px] text-zinc-500 mt-1">
                          Suggested: <span className="font-mono">{attrSlug.trim() || slugifyLocal(attrName)}</span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Type *</label>
                        <select
                          value={attrType}
                          onChange={(e) => setAttrType(e.target.value as any)}
                          className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white"
                        >
                          <option value="TEXT">TEXT (free text)</option>
                          <option value="SELECT">SELECT (one value)</option>
                          <option value="MULTISELECT">MULTISELECT (many values)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Slug (optional)</label>
                      <input
                        value={attrSlug}
                        onChange={(e) => {
                          const v = e.target.value;
                          setAttrSlug(v);
                          if (!attrSlugTouched) setAttrSlugTouched(true);
                          if (!v.trim()) setAttrSlugTouched(false);
                        }}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white"
                        placeholder="e.g. color"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Notes (optional)</label>
                      <textarea
                        value={attrNotes}
                        onChange={(e) => setAttrNotes(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white min-h-[90px]"
                        placeholder="How should shoppers use it? Example values…"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={createReqM.isPending || !hydrated || !isSupplier}
                      onClick={submitAttribute}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                    >
                      <Plus size={16} /> Send attribute request
                    </button>
                  </div>
                </Card>

                <div ref={valueRef} />
                <Card>
                  <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70 flex items-center gap-2">
                    <Tag size={18} className="text-zinc-800" />
                    <div className="min-w-0">
                      <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">Request an Attribute Value</div>
                      <div className="text-[11px] sm:text-xs text-zinc-500">
                        For SELECT/MULTISELECT attributes (e.g. add “Rose Gold” to Color).
                      </div>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 space-y-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Attribute *</label>
                      <select
                        value={valAttrId}
                        onChange={(e) => setValAttrId(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white"
                      >
                        <option value="">{attributesQ.isLoading ? "Loading…" : "— Select attribute —"}</option>
                        {selectableAttributes
                          .filter((a: any) => a.type === "SELECT" || a.type === "MULTISELECT")
                          .map((a: any) => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.type})
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Value name *</label>
                        <input
                          value={valName}
                          onChange={(e) => {
                            const v = e.target.value;
                            setValName(v);
                            if (!valCodeTouched) setValCode(slugifyLocal(v));
                          }}
                          className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white"
                          placeholder="e.g. Rose Gold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Code (optional)</label>
                        <input
                          value={valCode}
                          onChange={(e) => {
                            const v = e.target.value;
                            setValCode(v);
                            if (!valCodeTouched) setValCodeTouched(true);
                            if (!v.trim()) setValCodeTouched(false);
                          }}
                          className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white"
                          placeholder="e.g. rose-gold"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-700 mb-1">Notes (optional)</label>
                      <textarea
                        value={valNotes}
                        onChange={(e) => setValNotes(e.target.value)}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white min-h-[90px]"
                        placeholder="Explain where it’s used, sample products…"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={createReqM.isPending || !hydrated || !isSupplier}
                      onClick={submitAttrValue}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                    >
                      <Plus size={16} /> Send value request
                    </button>
                  </div>
                </Card>
              </>
            )}

            {tab === "MINE" && (
              <Card>
                <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">My requests</div>
                    <div className="text-[11px] sm:text-xs text-zinc-500">Track approval status from admins.</div>
                  </div>

                  <button
                    type="button"
                    onClick={() => myRequestsQ.refetch()}
                    className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-[12px] sm:text-sm font-semibold hover:bg-black/5"
                  >
                    <RefreshCw size={16} /> Refresh
                  </button>
                </div>

                <div className="p-4 sm:p-5 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <div className="sm:col-span-2">
                      <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                        <input
                          value={mineSearch}
                          onChange={(e) => setMineSearch(e.target.value)}
                          className="w-full rounded-xl border pl-9 pr-3 py-2.5 text-sm bg-white"
                          placeholder="Search (name, slug, notes, attribute, value)…"
                        />
                      </div>
                    </div>

                    <div className="relative">
                      <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                      <select
                        value={mineStatus}
                        onChange={(e) => setMineStatus(e.target.value as any)}
                        className="w-full rounded-xl border pl-9 pr-3 py-2.5 text-sm bg-white"
                      >
                        <option value="">All statuses</option>
                        <option value="PENDING">PENDING</option>
                        <option value="APPROVED">APPROVED</option>
                        <option value="REJECTED">REJECTED</option>
                      </select>
                    </div>

                    <div>
                      <select
                        value={mineType}
                        onChange={(e) => setMineType(e.target.value as any)}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm bg-white"
                      >
                        <option value="">All types</option>
                        <option value="BRAND">BRAND</option>
                        <option value="CATEGORY">CATEGORY</option>
                        <option value="ATTRIBUTE">ATTRIBUTE</option>
                        <option value="ATTRIBUTE_VALUE">ATTRIBUTE_VALUE</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="text-[12px] text-zinc-500">
                      {myRequestsQ.isLoading
                        ? "Loading your requests…"
                        : `${mineStart}–${mineEnd} of ${myRequestsTotal} request${myRequestsTotal === 1 ? "" : "s"}`}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={pageSize}
                        onChange={(e) => setPageSize(toInt(e.target.value, 20))}
                        className="rounded-xl border bg-white px-3 py-2 text-[12px]"
                        title="Page size"
                      >
                        {PAGE_SIZES.map((n) => (
                          <option key={n} value={n}>
                            {n}/page
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        disabled={!myRequestsHasPrev || myRequestsQ.isFetching}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-[12px] hover:bg-black/5 disabled:opacity-50"
                      >
                        <ChevronLeft size={14} /> Prev
                      </button>

                      <div className="text-[12px] text-zinc-600">
                        Page <span className="font-semibold text-zinc-900">{myRequestsPage}</span> /{" "}
                        <span className="font-semibold text-zinc-900">{myRequestsTotalPages}</span>
                      </div>

                      <button
                        type="button"
                        disabled={!myRequestsHasNext || myRequestsQ.isFetching}
                        onClick={() => setPage((p) => Math.min(myRequestsTotalPages, p + 1))}
                        className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-[12px] hover:bg-black/5 disabled:opacity-50"
                      >
                        Next <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>

                  {myRequestsQ.isLoading && <div className="text-sm text-zinc-500">Loading your requests…</div>}

                  {!myRequestsQ.isLoading && myRequestsRows.length === 0 && (
                    <div className="text-sm text-zinc-500">
                      No matching requests. Try clearing filters or create one from “New”.
                    </div>
                  )}

                  {myRequestsRows.length > 0 && (
                    <div className="space-y-3">
                      {myRequestsRows.map((r) => {
                        const created = prettyDate(r.createdAt);
                        const reviewed = prettyDate(r.reviewedAt);

                        const isAttrVal = r.type === "ATTRIBUTE_VALUE";
                        const attrName =
                          attributeNameById.get(String(r.attributeId ?? "")) || (r.attributeId ? String(r.attributeId) : "—");

                        const categoryParentName = r.parentId
                          ? categoryNameById.get(String(r.parentId)) || String(r.parentId)
                          : null;

                        return (
                          <div key={r.id} className="rounded-2xl border bg-white p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">
                                  {r.type === "BRAND"
                                    ? "Brand"
                                    : r.type === "CATEGORY"
                                      ? "Category"
                                      : r.type === "ATTRIBUTE"
                                        ? "Attribute"
                                        : "Attribute value"}{" "}
                                  request
                                </div>

                                <div className="text-[13px] sm:text-sm text-zinc-700 mt-0.5">
                                  {isAttrVal ? (
                                    <>
                                      <span className="font-medium">{r.valueName || "—"}</span>
                                      <span className="text-zinc-500"> (for </span>
                                      <span className="text-zinc-900 font-medium">{attrName}</span>
                                      <span className="text-zinc-500">)</span>
                                      {r.valueCode ? <span className="text-zinc-500"> · code: {r.valueCode}</span> : null}
                                    </>
                                  ) : (
                                    <>
                                      <span className="font-medium">{r.name || "—"}</span>
                                      {r.attributeType ? <span className="text-zinc-500"> · {r.attributeType}</span> : null}
                                      {r.type === "CATEGORY" && categoryParentName ? (
                                        <span className="text-zinc-500"> · parent: {categoryParentName}</span>
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
                                  {created ? (
                                    <>
                                      {r.slug ? " · " : ""}
                                      Created: <span className="font-mono">{created}</span>
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
                                    <div className="text-[11px] font-semibold text-zinc-700 mb-1">Your notes</div>
                                    <div className="text-sm text-zinc-700 whitespace-pre-wrap">{r.notes}</div>
                                  </div>
                                )}
                                {r.adminNote && (
                                  <div className="rounded-xl border bg-white p-3">
                                    <div className="text-[11px] font-semibold text-zinc-700 mb-1">Admin note</div>
                                    <div className="text-sm text-zinc-700 whitespace-pre-wrap">{r.adminNote}</div>
                                    {reviewed && (
                                      <div className="text-[11px] text-zinc-500 mt-1">
                                        Reviewed: <span className="font-mono">{reviewed}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Card>
            )}

            {tab === "CATALOG" && (
              <Card>
                <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70">
                  <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">Current catalog</div>
                  <div className="text-[11px] sm:text-xs text-zinc-500">
                    This is what you can select on product creation.
                  </div>
                </div>

                <div className="p-4 sm:p-5 space-y-6">
                  <div>
                    <div className="text-[11px] font-semibold text-zinc-700 mb-2">Categories</div>
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
                    <div className="text-[11px] font-semibold text-zinc-700 mb-2">Brands</div>
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
                    <div className="text-[11px] font-semibold text-zinc-700 mb-2">Attributes</div>
                    {attributesQ.isLoading ? (
                      <div className="text-sm text-zinc-500">Loading…</div>
                    ) : (
                      <div className="space-y-2">
                        {(selectableAttributes || []).slice(0, 30).map((a: any) => (
                          <div key={a.id} className="rounded-xl border bg-white p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-zinc-900">{a.name}</div>
                                <div className="text-[11px] text-zinc-500">
                                  Type: <span className="font-mono">{a.type}</span>
                                </div>
                              </div>
                              <span
                                className={`px-2 py-1 rounded-full text-[11px] border ${
                                  a.isActive !== false
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

          <div className="order-2 lg:order-none space-y-4">
            <Card>
              <div className="p-4 sm:p-5 flex items-start gap-3">
                <div className="inline-grid place-items-center w-10 h-10 rounded-2xl bg-zinc-900/5 text-zinc-800">
                  <ClipboardList size={18} />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] text-zinc-500">How it works</div>
                  <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">Request → Review → Approved</div>
                  <div className="text-[11px] text-zinc-500 mt-1">
                    Admins approve new catalog items to prevent duplicates and keep filtering consistent.
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70">
                <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">Tips</div>
              </div>
              <div className="p-4 sm:p-5 text-sm text-zinc-700 space-y-3">
                <div className="flex items-start gap-2">
                  <BadgeCheck size={16} className="mt-0.5 text-emerald-700" />
                  <div>Provide links/proof for brands (official site, product page).</div>
                </div>
                <div className="flex items-start gap-2">
                  <Layers size={16} className="mt-0.5 text-zinc-800" />
                  <div>Pick the closest parent category to keep browsing clean.</div>
                </div>
                <div className="flex items-start gap-2">
                  <Tag size={16} className="mt-0.5 text-zinc-800" />
                  <div>For SELECT attributes, request values you’ll reuse (sizes, colors, materials).</div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="p-4 sm:p-5">
                <Link
                  to="/supplier/add-product"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-white px-4 py-3 text-sm font-semibold"
                >
                  Back to Add Product <ArrowRight size={16} />
                </Link>
                <div className="text-[11px] text-zinc-500 mt-2">
                  After approval, refresh Add Product to see the new options.
                </div>
              </div>
            </Card>
          </div>
        </div>

        <div className="h-8" />
      </SupplierLayout>
    </SiteLayout>
  );
}

/* Optional: if you want to hide the scrollbar on the tabs row (Tailwind plugin not required)
   Add this somewhere global if you don't already have it:

   .no-scrollbar::-webkit-scrollbar { display: none; }
   .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
*/