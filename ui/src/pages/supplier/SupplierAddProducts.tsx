// src/pages/supplier/SupplierAddProducts.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ImagePlus,
  Plus,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Save,
  Package,
  ChevronDown,
  X,
  Copy,
  BadgeCheck,
  ShieldCheck,
  MapPin,
  FileText,
} from "lucide-react";
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
  selections: Record<string, string>;
  availableQty: string;
  unitPrice: string;
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
  retailPrice?: number;
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
  attributeValues?: Array<{
    attributeId: string;
    valueId: string;
    attribute?: { id: string; name: string; type?: string | null; code?: string | null };
    value?: { id: string; name: string; code?: string | null };
  }>;
  attributeTexts?: Array<{
    attributeId: string;
    value: string;
    attribute?: { id: string; name: string; type?: string | null; code?: string | null };
  }>;
  variants?: Array<{
    id: string;
    sku?: string | null;
    unitPrice?: number;
    retailPrice?: number;
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

type SupplierDocumentLite = {
  kind?: string | null;
  status?: string | null;
};

type AuthMeLite = {
  id?: string;
  role?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

type SupplierMeLite = {
  id?: string;
  supplierId?: string;
  name?: string | null;
  businessName?: string | null;
  legalName?: string | null;
  registrationType?: string | null;
  registrationCountryCode?: string | null;
  status?: string | null;
  kycStatus?: string | null;
  registeredAddress?: {
    houseNumber?: string | null;
    streetName?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postCode?: string | null;
  } | null;
  pickupAddress?: {
    houseNumber?: string | null;
    streetName?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postCode?: string | null;
  } | null;
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

function pickSourceBasePrice(p: ExistingProductDetail | null | undefined) {
  if (!p) return 0;
  const raw = p.offer?.basePrice ?? p.basePrice ?? p.retailPrice ?? 0;
  return toMoneyNumber(raw);
}

function normRole(role: unknown) {
  let r = String(role ?? "").trim().toUpperCase();
  r = r.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
  if (r === "SUPERADMIN") r = "SUPER_ADMIN";
  if (r === "SUPER_ADMINISTRATOR") r = "SUPER_ADMIN";
  return r;
}

function hasAddress(addr: any) {
  if (!addr) return false;
  return Boolean(
    String(addr.houseNumber ?? "").trim() ||
      String(addr.streetName ?? "").trim() ||
      String(addr.city ?? "").trim() ||
      String(addr.state ?? "").trim() ||
      String(addr.country ?? "").trim() ||
      String(addr.postCode ?? "").trim()
  );
}

function isRegisteredBusiness(registrationType?: string | null) {
  return String(registrationType ?? "").trim().toUpperCase() === "REGISTERED_BUSINESS";
}

function docSatisfied(docs: SupplierDocumentLite[], kind: string) {
  return docs.some((d) => {
    const k = String(d.kind ?? "").trim().toUpperCase();
    const s = String(d.status ?? "").trim().toUpperCase();
    return k === kind && (s === "PENDING" || s === "APPROVED");
  });
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
        "w-full rounded-xl border px-3 py-2.5 text-sm bg-white outline-none disabled:bg-zinc-100 disabled:text-zinc-500 disabled:cursor-not-allowed",
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
        "w-full rounded-xl border px-3 py-2.5 text-sm bg-white outline-none disabled:bg-zinc-100 disabled:text-zinc-500 disabled:cursor-not-allowed",
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
        "w-full rounded-xl border px-3 py-2.5 text-sm bg-white outline-none disabled:bg-zinc-100 disabled:text-zinc-500 disabled:cursor-not-allowed",
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
  const [searchParams, setSearchParams] = useSearchParams();

  const hydrated = useAuthStore((s: any) => s.hydrated) as boolean;
  const role = useAuthStore((s: any) => s.user?.role) as string | undefined;
  const roleNorm = normRole(role);
  const isSupplier = roleNorm === "SUPPLIER";

  const copyFromProductId = String(searchParams.get("copyFromProductId") || "").trim();

  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

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

  const [summaryOpen, setSummaryOpen] = useState(false);

  const [flashBaseCombo, setFlashBaseCombo] = useState(false);
  const [flashVariantRowId, setFlashVariantRowId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const [attrsSaved, setAttrsSaved] = useState(false);
  const [editingAttrs, setEditingAttrs] = useState(false);
  const [editingVariantRowId, setEditingVariantRowId] = useState<string | null>(null);

  const copiedTemplateAppliedRef = useRef<string>("");

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

  const onboardingQ = useQuery({
    queryKey: ["supplier", "add-product", "onboarding-state"],
    enabled: hydrated && isSupplier,
    queryFn: async () => {
      const [authRes, supplierRes, docsRes] = await Promise.all([
        api.get("/api/auth/me", { withCredentials: true }),
        api.get("/api/supplier/me", { withCredentials: true }),
        api
          .get("/api/supplier/documents", { withCredentials: true })
          .catch(() => ({ data: { data: [] } })),
      ]);

      const authMe = ((authRes.data as any)?.data ??
        (authRes.data as any)?.user ??
        authRes.data ??
        {}) as AuthMeLite;

      const supplierMe = ((supplierRes.data as any)?.data ??
        supplierRes.data ??
        {}) as SupplierMeLite;

      const rawDocs = (docsRes as any)?.data?.data ?? (docsRes as any)?.data ?? [];
      const docs = Array.isArray(rawDocs) ? (rawDocs as SupplierDocumentLite[]) : [];

      const contactDone = !!authMe?.emailVerified && !!authMe?.phoneVerified;

      const businessDone = Boolean(
        String(supplierMe?.legalName ?? "").trim() &&
          String(supplierMe?.registrationType ?? "").trim() &&
          String(supplierMe?.registrationCountryCode ?? "").trim()
      );

      const addressDone = hasAddress(supplierMe?.registeredAddress) || hasAddress(supplierMe?.pickupAddress);

      const requiredKinds = [
        ...(isRegisteredBusiness(supplierMe?.registrationType)
          ? ["BUSINESS_REGISTRATION_CERTIFICATE"]
          : []),
        "GOVERNMENT_ID",
        "PROOF_OF_ADDRESS",
      ];

      const docsDone = requiredKinds.every((kind) => docSatisfied(docs, kind));

      const nextPath = !contactDone
        ? "/supplier/verify-contact"
        : !businessDone
          ? "/supplier/onboarding"
          : !addressDone
            ? "/supplier/onboarding/address"
            : !docsDone
              ? "/supplier/onboarding/documents"
              : "/supplier";

      const progressItems = [
        { key: "contact", label: "Contact verified", done: contactDone },
        { key: "business", label: "Business details", done: businessDone },
        { key: "address", label: "Address details", done: addressDone },
        { key: "documents", label: "Documents uploaded", done: docsDone },
      ];

      return {
        authMe,
        supplierMe,
        docs,
        contactDone,
        businessDone,
        addressDone,
        docsDone,
        onboardingDone: contactDone && businessDone && addressDone && docsDone,
        nextPath,
        progressItems,
        supplierStatus: supplierMe?.status ?? "PENDING",
        kycStatus: supplierMe?.kycStatus ?? "PENDING",
      };
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const onboardingBlocked = isSupplier && !!onboardingQ.data && !onboardingQ.data.onboardingDone;
  const onboardingProgressItems = onboardingQ.data?.progressItems ?? [];
  const onboardingPct = useMemo(() => {
    if (!onboardingProgressItems.length) return 0;
    const done = onboardingProgressItems.filter((x: any) => x.done).length;
    return Math.round((done / onboardingProgressItems.length) * 100);
  }, [onboardingProgressItems]);

  const nextStepLabel = useMemo(() => {
    const p = onboardingQ.data?.nextPath;
    if (p === "/supplier/verify-contact") return "Continue contact verification";
    if (p === "/supplier/onboarding") return "Continue business onboarding";
    if (p === "/supplier/onboarding/address") return "Continue address setup";
    if (p === "/supplier/onboarding/documents") return "Continue document upload";
    return "Continue onboarding";
  }, [onboardingQ.data?.nextPath]);

  const lockReason = onboardingBlocked ? "Complete onboarding first" : undefined;

  function generateVariantMatrix() {
    if (onboardingBlocked) return;
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

  const { categories, brands, attributes, attributesQ, categoriesQ, brandsQ } = useCatalogMeta({
    enabled: true,
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

  const copySourceProductQ = useQuery<{ data: ExistingProductDetail } | ExistingProductDetail | null>({
    queryKey: ["supplier", "copy-source-product", copyFromProductId],
    enabled: !!copyFromProductId,
    queryFn: async () => {
      const attempts = [`/api/supplier/products/${copyFromProductId}`];

      let lastErr: any = null;

      for (const url of attempts) {
        try {
          const { data } = await api.get(url, AXIOS_COOKIE_CFG);
          return data as any;
        } catch (e) {
          lastErr = e;
        }
      }

      throw lastErr || new Error("Could not load source product");
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const copySourceProduct: ExistingProductDetail | null = useMemo(() => {
    const raw = copySourceProductQ.data as any;
    if (!raw) return null;
    return (raw?.data ?? raw) as ExistingProductDetail;
  }, [copySourceProductQ.data]);

  useEffect(() => {
    if (!copyFromProductId) return;
    if (!copySourceProduct) return;
    if (attributesQ.isLoading) return;
    if (copiedTemplateAppliedRef.current === copyFromProductId) return;

    const p = copySourceProduct;

    setErr(null);
    setOkMsg(null);

    setTitle(String(p.title || ""));
    setDescription(String(p.description || ""));
    setRetailPrice(String(pickSourceBasePrice(p) || ""));
    setCategoryId(String(p.categoryId || ""));
    setBrandId(String(p.brandId || ""));
    setBaseQuantity(String(toIntNonNeg(p.offer?.availableQty ?? p.availableQty ?? 0)));

    const sourceImages = limitImages(Array.isArray(p.imagesJson) ? p.imagesJson : [], MAX_IMAGES);
    setImageUrls(sourceImages.join("\n"));
    setUploadedUrls([]);
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (!skuTouchedRef.current) {
      setSku(slugifySku(String(p.title || "")));
    }

    const sourceVariants = Array.isArray(p.variants) ? p.variants : [];
    const hasSourceVariants = sourceVariants.length > 0;

    const nextSelectedAttrs: Record<string, string | string[]> = {};

    for (const a of activeAttrs) {
      if (a.type === "TEXT") {
        const hit = (p.attributeTexts || []).find((t) => String(t.attributeId) === String(a.id));
        if (hit?.value != null && String(hit.value).trim()) {
          nextSelectedAttrs[a.id] = String(hit.value).trim();
        }
        continue;
      }

      if (hasSourceVariants) continue;

      if (a.type === "SELECT") {
        const hit = (p.attributeValues || []).find((v) => String(v.attributeId) === String(a.id));
        if (hit?.valueId) {
          nextSelectedAttrs[a.id] = String(hit.valueId);
        }
        continue;
      }

      if (a.type === "MULTISELECT") {
        const ids = (p.attributeValues || [])
          .filter((v) => String(v.attributeId) === String(a.id))
          .map((v) => String(v.valueId))
          .filter(Boolean);

        if (ids.length) {
          nextSelectedAttrs[a.id] = Array.from(new Set(ids));
        }
      }
    }

    setSelectedAttrs(nextSelectedAttrs);
    const nextVariantRows: VariantRow[] = sourceVariants.map((v) => {
      const selections: Record<string, string> = {};
      selectableAttrs.forEach((attr) => {
        selections[attr.id] = "";
      });
      (v.options || []).forEach((o) => {
        selections[String(o.attributeId)] = String(o.valueId);
      });

      const sourceQty = toIntNonNeg(v.supplierVariantOffer?.availableQty ?? v.availableQty ?? 0);
      const sourcePrice = toMoneyNumber(
        v.supplierVariantOffer?.unitPrice ?? v.unitPrice ?? v.retailPrice ?? pickSourceBasePrice(p)
      );

      return {
        id: uid("vr"),
        selections,
        availableQty: String(sourceQty),
        unitPrice: sourcePrice > 0 ? String(sourcePrice) : "",
      };
    });

    setVariantRows(nextVariantRows);
    setEditingVariantRowId(nextVariantRows[0]?.id || null);
    setAttrsSaved(false);
    setEditingAttrs(false);

    copiedTemplateAppliedRef.current = copyFromProductId;
  }, [copyFromProductId, copySourceProduct, activeAttrs, selectableAttrs, attributesQ.isLoading]);

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
    if (onboardingBlocked) return;
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
    if (onboardingBlocked) return [];
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
    if (onboardingBlocked) return;
    setUploadedUrls((prev) => prev.filter((x) => x !== u));
  }

  function removeTextUrl(u: string) {
    if (onboardingBlocked) return;
    const raw = parseUrlList(imageUrls);
    const next = raw.filter((x) => normalizeImageUrl(x) !== normalizeImageUrl(u));
    setImageUrls(next.join("\n"));
  }

  function removeSelectedFile(file: File) {
    if (onboardingBlocked) return;
    setFiles((prev) => prev.filter((f) => f !== file));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const allUrlPreviews = useMemo(() => {
    return limitImages([...urlPreviews, ...uploadedUrls], MAX_IMAGES);
  }, [urlPreviews, uploadedUrls]);

  function addVariantRow() {
    if (onboardingBlocked) return;
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
    if (onboardingBlocked) return;
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
    if (onboardingBlocked) return;
    setVariantRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, availableQty: v } : r)));
  }

  function updateVariantPrice(rowId: string, v: string) {
    if (onboardingBlocked) return;
    setVariantRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, unitPrice: v } : r)));
  }

  function removeVariantRow(rowId: string) {
    if (onboardingBlocked) return;
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
    if (onboardingBlocked) return;
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
    if (onboardingBlocked) return;
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

    return {
      title: title.trim(),
      description: description?.trim() || "",
      basePrice: basePriceNum,
      sku: baseSku,
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
  }

  const createM = useMutation({
    mutationFn: async () => {
      setErr(null);
      setOkMsg(null);

      if (onboardingBlocked) {
        throw new Error("Complete supplier onboarding before adding products.");
      }

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

    if (onboardingBlocked) {
      setErr("Complete supplier onboarding before adding products.");
      return;
    }

    if (hasComboError) {
      setErr(comboErrorMsg);
      triggerConflictFlash(firstComboErrorRowId || undefined);
      return;
    }

    createM.mutate();
  };

  const isSubmitting = createM.isPending;
  const submitDisabled = isSubmitting || uploading || hasComboError || onboardingBlocked;

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

  const canGenerateVariants = useMemo(() => {
    return selectableAttrs.some((a) => {
      const v = selectedAttrs[a.id];
      return typeof v === "string" && String(v).trim() !== "";
    });
  }, [selectableAttrs, selectedAttrs]);

  const copySourceCard = copyFromProductId ? (
    <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 px-4 py-3 text-sm text-fuchsia-900">
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          <Copy size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {copySourceProductQ.isLoading
              ? "Loading template product…"
              : copySourceProduct
                ? `Creating from template: ${copySourceProduct.title}`
                : "Create from template"}
          </div>
          <div className="text-[12px] mt-1 text-fuchsia-800/90">
            Core fields, images, attributes, and variant combos are being used as a starting point. You can edit anything before submitting.
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.delete("copyFromProductId");
            setSearchParams(next, { replace: true });
          }}
          className="shrink-0 inline-flex items-center justify-center rounded-full border border-fuchsia-200 bg-white px-2.5 py-1 text-[11px] font-semibold hover:bg-fuchsia-100"
        >
          Clear
        </button>
      </div>
    </div>
  ) : null;


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
              {onboardingBlocked ? "Onboarding required" : isSubmitting ? "Submitting…" : "Submit product"}
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
                  <span className="text-zinc-500">Flow</span>
                  <b className="text-zinc-900">Create new product</b>
                </div>
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
                Create a new product for your catalogue.
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
                title={lockReason}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
              >
                <Save size={16} /> {onboardingBlocked ? "Onboarding required" : isSubmitting ? "Submitting…" : "Submit product"}
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

          {copySourceCard}

          {isSupplier && onboardingQ.isLoading && (
            <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
              Checking onboarding status…
            </div>
          )}

          {onboardingBlocked && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="font-semibold">Onboarding in progress</div>
                  <div className="mt-1 text-amber-800">
                    You need to complete supplier onboarding before adding products.
                    The form is visible for guidance, but editing and submission are locked until onboarding is complete.
                  </div>

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-amber-100">
                    <div
                      className="h-full rounded-full bg-amber-500 transition-all"
                      style={{ width: `${onboardingPct}%` }}
                    />
                  </div>

                  <div className="mt-2 text-[12px] text-amber-800">
                    Progress: <b>{onboardingPct}%</b>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {onboardingProgressItems.map((item: any) => (
                      <span
                        key={item.key}
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          item.done
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {item.label}: {item.done ? "Done" : "Pending"}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 text-[12px] text-amber-800">
                    Supplier status: <b>{String(onboardingQ.data?.supplierStatus ?? "PENDING")}</b>
                    {" • "}
                    KYC: <b>{String(onboardingQ.data?.kycStatus ?? "PENDING")}</b>
                  </div>
                </div>

                <div className="shrink-0">
                  <Link
                    to={onboardingQ.data?.nextPath || "/supplier/verify-contact"}
                    className="inline-flex items-center justify-center rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-950"
                  >
                    {nextStepLabel}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>
          )}

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
              <Card
                title="Basic information"
                subtitle="What customers will see in the catalog"
                className={onboardingBlocked ? "border-amber-200 bg-amber-50/30" : ""}
              >
                {onboardingBlocked && (
                  <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                    Product details are locked until onboarding is complete.
                  </div>
                )}

                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Title *</Label>
                      <Input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Air Fryer 4L"
                        disabled={onboardingBlocked}
                      />
                    </div>

                    <div>
                      <Label>
                        SKU preview <span className="text-zinc-400 font-normal">(backend recomputes final SKU)</span>
                      </Label>
                      <Input
                        value={sku}
                        onChange={(e) => {
                          if (onboardingBlocked) return;
                          skuTouchedRef.current = true;
                          setSku(e.target.value);
                        }}
                        placeholder="e.g. AFRY-4L-BLK"
                        disabled={onboardingBlocked}
                      />
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className="text-[11px] text-zinc-600 underline disabled:opacity-50"
                          disabled={onboardingBlocked}
                          onClick={() => {
                            if (onboardingBlocked) return;
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
                        disabled={onboardingBlocked}
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
                        disabled={onboardingBlocked}
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
                          disabled={onboardingBlocked}
                        />
                      </div>
                      <Select
                        value={categoryId}
                        onChange={(e) => setCategoryId(e.target.value)}
                        disabled={onboardingBlocked}
                      >
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
                          disabled={onboardingBlocked}
                        />
                      </div>
                      <Select
                        value={brandId}
                        onChange={(e) => setBrandId(e.target.value)}
                        disabled={onboardingBlocked}
                      >
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
                      disabled={onboardingBlocked}
                    />
                  </div>
                </div>
              </Card>

              <Card
                title="Images"
                subtitle={`Paste URLs or upload images (max ${MAX_IMAGES}).`}
                className={onboardingBlocked ? "border-amber-200 bg-amber-50/30" : ""}
                right={
                  <label
                    className={`inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 cursor-pointer ${
                      onboardingBlocked ? "opacity-60 pointer-events-none" : ""
                    }`}
                  >
                    <ImagePlus size={16} /> Add files
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => onPickFiles(Array.from(e.target.files || []))}
                      disabled={onboardingBlocked}
                    />
                  </label>
                }
              >
                {onboardingBlocked && (
                  <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                    Image changes are locked until onboarding is complete.
                  </div>
                )}

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
                        if (onboardingBlocked) return;
                        setErr(null);
                        const raw = parseUrlList(e.target.value);
                        const capped = limitImages(raw, MAX_IMAGES);
                        setImageUrls(capped.join("\n"));
                      }}
                      className="min-h-[90px] text-xs"
                      placeholder={"https://.../image1.jpg\nhttps://.../image2.png"}
                      disabled={onboardingBlocked}
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
                              {!onboardingBlocked && (
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
                              )}
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
                                {!onboardingBlocked && (
                                  <button
                                    type="button"
                                    onClick={() => removeSelectedFile(file)}
                                    className="absolute top-2 right-2 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/95 border border-zinc-300 shadow-md hover:bg-zinc-50 active:scale-95"
                                    aria-label="Remove selected file"
                                    title="Remove"
                                  >
                                    <X size={18} className="text-rose-700" />
                                  </button>
                                )}
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

                  {files.length > 0 && !onboardingBlocked && (
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
                className={[
                  baseComboBorder,
                  onboardingBlocked ? "border-amber-200 bg-amber-50/30" : "",
                ].join(" ")}
                right={
                  <div className="flex items-center gap-2 flex-wrap">
                    {!attrsSaved ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (onboardingBlocked) return;
                          if (!canSaveAttrs) {
                            setErr("Choose at least one attribute value before saving.");
                            return;
                          }
                          setAttrsSaved(true);
                          setEditingAttrs(false);
                        }}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border bg-zinc-900 text-white disabled:opacity-50"
                        disabled={!canSaveAttrs || onboardingBlocked}
                        title={lockReason}
                      >
                        Save
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (onboardingBlocked) return;
                          setEditingAttrs(true);
                          setAttrsSaved(false);
                        }}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border bg-white hover:bg-zinc-50 disabled:opacity-50"
                        disabled={onboardingBlocked}
                        title={lockReason}
                      >
                        Edit
                      </button>
                    )}

                    <AddNewLink
                      label="Add new attribute"
                      onClick={() => nav(goToCatalogRequests("attributes", "attribute"))}
                      disabled={onboardingBlocked}
                    />
                  </div>
                }
              >
                {onboardingBlocked && (
                  <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                    Attribute editing is locked until onboarding is complete.
                  </div>
                )}

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
                                onChange={(e) =>
                                  !onboardingBlocked && setSelectedAttrs((s) => ({ ...s, [a.id]: e.target.value }))
                                }
                                placeholder={a.placeholder || `Enter ${a.name.toLowerCase()}…`}
                                disabled={onboardingBlocked}
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
                                  disabled={onboardingBlocked}
                                />
                              </div>
                              <Select
                                value={v}
                                onChange={(e) => setBaseSelectAttr(a.id, e.target.value)}
                                className={hasBaseComboConflict || flashBaseCombo ? "border-rose-300" : ""}
                                disabled={onboardingBlocked}
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
                                disabled={onboardingBlocked}
                              />
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(a.values || []).map((x) => {
                                const checked = arr.includes(x.id);
                                return (
                                  <label
                                    key={x.id}
                                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs cursor-pointer ${
                                      checked ? "bg-zinc-900 text-white border-zinc-900" : "bg-white hover:bg-black/5"
                                    } ${onboardingBlocked ? "opacity-60 cursor-not-allowed" : ""}`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={checked}
                                      onChange={() => {
                                        if (onboardingBlocked) return;
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
                className={onboardingBlocked ? "border-amber-200 bg-amber-50/30" : ""}
                right={
                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={generateVariantMatrix}
                      disabled={!canGenerateVariants || onboardingBlocked}
                      title={lockReason}
                      className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
                    >
                      Generate combo
                    </button>

                    <button
                      type="button"
                      onClick={addVariantRow}
                      disabled={onboardingBlocked}
                      title={lockReason}
                      className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
                    >
                      <Plus size={16} /> Add row
                    </button>
                  </div>
                }
              >
                {onboardingBlocked && (
                  <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                    Variant quantity and pricing updates are locked until onboarding is complete.
                  </div>
                )}

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
                                  if (onboardingBlocked) return;
                                  setErr(null);
                                  setEditingVariantRowId(row.id);
                                }}
                                disabled={onboardingBlocked}
                                title={lockReason}
                                className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-50"
                              >
                                Edit combo
                              </button>

                              <button
                                type="button"
                                onClick={() => removeVariantRow(row.id)}
                                disabled={onboardingBlocked}
                                title={lockReason}
                                className="inline-flex items-center gap-2 rounded-xl border bg-rose-50 text-rose-700 px-3 py-2 text-sm font-semibold hover:bg-rose-100 disabled:opacity-50"
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
                              disabled={onboardingBlocked}
                              title={lockReason}
                              className="inline-flex items-center gap-2 rounded-xl border bg-zinc-900 text-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
                            >
                              Save combo
                            </button>

                            <button
                              type="button"
                              onClick={() => !onboardingBlocked && setEditingVariantRowId(null)}
                              disabled={onboardingBlocked}
                              title={lockReason}
                              className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-50"
                            >
                              Done
                            </button>

                            <button
                              type="button"
                              onClick={() => removeVariantRow(row.id)}
                              disabled={onboardingBlocked}
                              title={lockReason}
                              className="inline-flex items-center gap-2 rounded-xl border bg-rose-50 text-rose-700 px-3 py-2 text-sm font-semibold hover:bg-rose-100 disabled:opacity-50"
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
                                      disabled={onboardingBlocked}
                                    />
                                  </div>
                                  <Select
                                    value={valueId}
                                    onChange={(e) => updateVariantSelection(row.id, attr.id, e.target.value)}
                                    className={isBaseConflict || isFlashing ? "border-rose-300" : ""}
                                    disabled={onboardingBlocked}
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
                                disabled={onboardingBlocked}
                              />
                            </div>

                            <div>
                              <div className="text-[11px] font-semibold text-zinc-600 mb-1">Variant price (NGN)</div>
                              <Input
                                value={row.unitPrice}
                                onChange={(e) => updateVariantPrice(row.id, e.target.value)}
                                inputMode="decimal"
                                placeholder={retailPrice ? `e.g. ${retailPrice}` : "e.g. 25000"}
                                disabled={onboardingBlocked}
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

              <div className="hidden sm:block">
                <button
                  type="button"
                  disabled={submitDisabled}
                  onClick={handleSubmit}
                  title={lockReason}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-white px-4 py-3 text-sm font-semibold disabled:opacity-60"
                >
                  <Save size={16} /> {onboardingBlocked ? "Onboarding required" : isSubmitting ? "Submitting…" : "Submit product"}
                </button>
              </div>
            </div>

            <div className="hidden lg:block space-y-4">
              <Card title="Submission summary" subtitle="What will be sent to the backend">
                <div className="text-sm text-zinc-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Flow</span>
                    <b className="text-zinc-900">Create new product</b>
                  </div>

                  {copyFromProductId && (
                    <div className="rounded-xl border bg-fuchsia-50 px-3 py-2 text-[11px] text-fuchsia-800">
                      Template mode is active.
                    </div>
                  )}

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

                  {onboardingBlocked && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-[11px]">
                      Onboarding must be completed before this product can be submitted.
                    </div>
                  )}
                </div>
              </Card>

              <button
                type="button"
                disabled={submitDisabled}
                onClick={handleSubmit}
                title={lockReason}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-white px-4 py-3 text-sm font-semibold disabled:opacity-60"
              >
                <Save size={16} />
                {onboardingBlocked ? "Onboarding required" : isSubmitting ? "Submitting…" : "Submit product"}
              </button>

              {copyFromProductId && (
                <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-4 text-sm text-fuchsia-900">
                  <div className="flex items-center gap-2 font-semibold">
                    <Copy size={16} />
                    Template copy mode
                  </div>
                  <div className="mt-2 text-xs">
                    This page was opened from the catalogue template picker. The source product is only a starting point — you can change anything before you submit.
                  </div>
                </div>
              )}

              {onboardingBlocked && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <div className="flex items-center gap-2 font-semibold">
                    <BadgeCheck size={16} />
                    Onboarding incomplete
                  </div>
                  <div className="mt-2 text-xs">
                    Finish contact verification, business setup, address details, and required documents to unlock product creation.
                  </div>

                  <div className="mt-3 space-y-2 text-[12px]">
                    <div className="flex items-center gap-2">
                      <BadgeCheck size={14} className={onboardingQ.data?.contactDone ? "text-emerald-700" : "text-amber-700"} />
                      <span>Contact verified</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={14} className={onboardingQ.data?.businessDone ? "text-emerald-700" : "text-amber-700"} />
                      <span>Business details</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin size={14} className={onboardingQ.data?.addressDone ? "text-emerald-700" : "text-amber-700"} />
                      <span>Address details</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <FileText size={14} className={onboardingQ.data?.docsDone ? "text-emerald-700" : "text-amber-700"} />
                      <span>Documents uploaded</span>
                    </div>
                  </div>

                  <Link
                    to={onboardingQ.data?.nextPath || "/supplier/verify-contact"}
                    className="mt-4 inline-flex items-center justify-center rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-950"
                  >
                    {nextStepLabel}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}