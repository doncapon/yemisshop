import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ImagePlus,
  Save,
  Trash2,
  Plus,
  Package,
  X,
  ChevronDown,
  Link2,
  CheckCircle2,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { useCatalogMeta, type CatalogAttribute } from "../../hooks/useCatalogMeta";

/* =========================================================
   Config
========================================================= */
const MAX_IMAGES = 5;
const AXIOS_COOKIE_CFG = { withCredentials: true as const };

/* =========================================================
   Helpers
========================================================= */

function imageSrcCandidates(input: any): string[] {
  const raw = String(input ?? "").trim();
  if (!raw) return [];

  if (/^data:image\//i.test(raw)) return [raw];

  if (/^https?:\/\//i.test(raw)) {
    const u = raw;
    const apiToUi = u.replace("://api.", "://");
    return uniqStrings([u, apiToUi]);
  }

  if (raw.startsWith("/")) return [raw];
  if (raw.startsWith("uploads/")) return [`/${raw}`];
  if (raw.startsWith("public/uploads/")) return [`/${raw.replace(/^public\//, "")}`];
  if (/\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(raw)) return [`/${raw}`];

  return [];
}

function toPublicImageSrc(input: any): string | null {
  const c = imageSrcCandidates(input);
  return c.length ? c[0] : null;
}

function parseUrlList(s: string) {
  return String(s || "")
    .split(/[\n,]/g)
    .map((t) => t.trim())
    .filter(Boolean);
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

function getTempToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("tempToken") || "";
}

function getVerifyConfig() {
  const tempToken = getTempToken();

  return {
    withCredentials: true,
    headers: tempToken ? { Authorization: `Bearer ${tempToken}` } : {},
  };
}

function hasDateValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function isTruthyVerificationFlag(value: unknown) {
  if (value === true) return true;
  if (typeof value === "string" && value.trim()) return true;
  return false;
}

function isEmailVerified(authMe?: AuthMeLite | null) {
  return (
    isTruthyVerificationFlag((authMe as any)?.emailVerified) ||
    hasDateValue(authMe?.emailVerifiedAt)
  );
}

function isPhoneVerified(authMe?: AuthMeLite | null) {
  return (
    isTruthyVerificationFlag((authMe as any)?.phoneVerified) ||
    hasDateValue(authMe?.phoneVerifiedAt)
  );
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

function comboKeyFromSelections(selections: Record<string, string>, attrOrder: string[]) {
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
    pairs.push(`${an}: ${vn}`);
  }
  return pairs.length ? pairs.join(" • ") : "Variant combo";
}

function autoSkuFromTitle(input: string) {
  return String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
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

      const list = parseUrlList(c);
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
      const maybeUrls = c?.urls || c?.items || c?.data;
      if (Array.isArray(maybeUrls)) {
        const arr = maybeUrls
          .map((x) => (typeof x === "string" ? x : x?.url || x?.path || x?.src))
          .filter(Boolean);
        if (arr.length) return arr;
      }
    }
  }

  return [];
}

function normalizeVariantOptions(raw: any): Array<{ attributeId: string; valueId: string }> {
  const arr = Array.isArray(raw) ? raw : [];

  const pickAttributeId = (o: any) =>
    String(o?.attributeId ?? o?.attribute?.id ?? o?.attributeValue?.attributeId ?? o?.value?.attributeId ?? "").trim();

  const pickValueId = (o: any) =>
    String(o?.valueId ?? o?.attributeValueId ?? o?.value?.id ?? o?.attributeValue?.id ?? "").trim();

  const m = new Map<string, string>();
  for (const o of arr) {
    const aid = pickAttributeId(o);
    const vid = pickValueId(o);
    if (!aid || !vid) continue;
    m.set(aid, vid);
  }

  return Array.from(m.entries()).map(([attributeId, valueId]) => ({ attributeId, valueId }));
}

function extractVariantOptions(v: any): Array<{ attributeId: string; valueId: string }> {
  const candidates = [
    v?.options,
    v?.variantOptions,
    v?.VariantOption,
    v?.ProductVariantOption,
    v?.attributeValues,
    v?.AttributeValues,
  ];

  for (const c of candidates) {
    if (!Array.isArray(c)) continue;
    const out = normalizeVariantOptions(c);
    if (out.length) return out;
  }

  return [];
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

    if (typeof c === "object" && Array.isArray(c?.items)) return c.items;
  }

  return [];
}

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

function getPendingOfferMaps(p: any) {
  const pending: any[] =
    (Array.isArray(p?.pendingOfferChanges) && p.pendingOfferChanges) ||
    (Array.isArray(p?.offerChangeRequests) && p.offerChangeRequests) ||
    [];

  const onlyPending = pending.filter(
    (x) => String(x?.status || "PENDING").toUpperCase() === "PENDING"
  );

  const base =
    onlyPending.find((x) => String(x?.scope || "").toUpperCase() === "BASE_OFFER") || null;

  const variantMap = new Map<string, any>();
  for (const x of onlyPending) {
    if (String(x?.scope || "").toUpperCase() !== "VARIANT_OFFER") continue;
    const vid = String(
      x?.variantId ??
      x?.supplierVariantOffer?.variantId ??
      x?.supplierVariantOfferId ??
      ""
    ).trim();
    if (!vid) continue;
    variantMap.set(vid, x);
  }

  return { base, variantMap };
}

function getPendingProductChange(p: any) {
  const pending: any[] =
    (Array.isArray(p?.pendingProductChanges) && p.pendingProductChanges) ||
    (Array.isArray(p?.productChangeRequests) && p.productChangeRequests) ||
    [];

  const onlyPending = pending.filter(
    (x) => String(x?.status || "PENDING").toUpperCase() === "PENDING"
  );

  if (!onlyPending.length) return null;

  return onlyPending.sort((a, b) => {
    const da = new Date(a?.requestedAt || a?.createdAt || 0).getTime();
    const db = new Date(b?.requestedAt || b?.createdAt || 0).getTime();
    return db - da;
  })[0];
}

function buildPendingVariantPatchMapFromProductPatch(productPatch: any) {
  const m = new Map<string, any>();
  const rows = Array.isArray(productPatch?.variants) ? productPatch.variants : [];

  for (const r of rows) {
    const vid = String(r?.variantId ?? "").trim();
    if (!vid) continue;
    m.set(vid, r);
  }

  return m;
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
  hasPendingChanges?: boolean;
  availableQty?: number | null;
  freeShipping?: boolean;
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  isFragile?: boolean;
  isBulky?: boolean;
  shippingClass?: string | null;

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

  pendingOfferChanges?: Array<any>;
  offerChangeRequests?: Array<any>;

  pendingProductChanges?: Array<any>;
  productChangeRequests?: Array<any>;

  variants?: Array<any>;
  ProductVariant?: Array<any>;
  productVariants?: Array<any>;

  attributeValues?: Array<{ attributeId: string; valueId: string }>;
  attributeTexts?: Array<{ attributeId: string; value: string }>;
  attributeSelections?: Array<any>;
  attributeOptions?: Array<any>;
  ProductAttributeText?: Array<any>;

  images?: any;
  imageUrls?: any;
};

type VariantRow = {
  id: string;
  variantId?: string;
  selections: Record<string, string>;
  availableQty: string;
  unitPrice: string;
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
};

type SupplierDocumentLite = {
  kind?: string | null;
  status?: string | null;
};

type AuthMeLite = {
  id?: string;
  role?: string;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  emailVerifiedAt?: string | null;
  phoneVerifiedAt?: string | null;
  status?: string | null;
};

type SupplierMeLite = {
  id?: string;
  supplierId?: string;
  name?: string | null;
  businessName?: string | null;
  legalName?: string | null;
  registeredBusinessName?: string | null;
  registrationType?: string | null;
  registrationCountryCode?: string | null;
  contactEmail?: string | null;
  whatsappPhone?: string | null;
  pickupContactPhone?: string | null;
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

function getPendingBasePatchFromDetail(p: any) {
  const pending: any[] =
    (Array.isArray(p?.pendingOfferChanges) && p.pendingOfferChanges) ||
    (Array.isArray(p?.offerChangeRequests) && p.offerChangeRequests) ||
    [];

  const onlyPending = pending.filter(
    (x) => String(x?.status || "PENDING").toUpperCase() === "PENDING"
  );

  const baseRow =
    onlyPending.find((x) => String(x?.scope || "").toUpperCase() === "BASE_OFFER") || null;

  return baseRow?.proposedPatch ?? baseRow?.patchJson ?? null;
}

/* =========================================================
   Component
========================================================= */

export default function SupplierEditProduct() {
  const nav = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const hydrated = useAuthStore((s: any) => s.hydrated) as boolean;
  const role = useAuthStore((s: any) => s.user?.role) as string | undefined;

  function normRole(role: unknown) {
    let r = String(role ?? "").trim().toUpperCase();
    r = r.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
    if (r === "SUPERADMIN") r = "SUPER_ADMIN";
    if (r === "SUPER_ADMINISTRATOR") r = "SUPER_ADMIN";
    return r;
  }

  const roleNorm = normRole(role);
  const isSupplier = roleNorm === "SUPPLIER";

  useEffect(() => {
    if (!hydrated) {
      useAuthStore.getState().bootstrap?.().catch?.(() => null);
    }
  }, [hydrated]);

  const offersOnly = String(searchParams.get("scope") ?? "") === "offers_mine";

  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [dupWarn, setDupWarn] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [retailPrice, setRetailPrice] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [description, setDescription] = useState("");
  const [availableQty, setAvailableQty] = useState<string>("0");



  const [freeShipping, setFreeShipping] = useState(false);
  const [weightGrams, setWeightGrams] = useState("");
  const [lengthCm, setLengthCm] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [isFragile, setIsFragile] = useState(false);
  const [isBulky, setIsBulky] = useState(false);
  const [shippingClass, setShippingClass] = useState<
    "" | "STANDARD" | "FRAGILE" | "BULKY"
  >("");

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
  const [editingVariantRowId, setEditingVariantRowId] = useState<string | null>(null);

  const initialBasePriceRef = useRef<number>(0);

  const [activeBasePrice, setActiveBasePrice] = useState<number>(0);
  const [pendingBasePatch, setPendingBasePatch] = useState<any | null>(null);
  const [pendingVariantPatchByVariantId, setPendingVariantPatchByVariantId] = useState<Map<string, any>>(
    () => new Map()
  );

  const [skuTouched, setSkuTouched] = useState(false);
  const [flashBaseCombo, setFlashBaseCombo] = useState(false);
  const [flashVariantRowId, setFlashVariantRowId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const [pendingProductPatch, setPendingProductPatch] = useState<any | null>(null);
  const [pendingProductVariantPatchByVariantId, setPendingProductVariantPatchByVariantId] =
    useState<Map<string, any>>(() => new Map());

  const initialSnapshotRef = useRef<{
    id: string;
    title: string;
    sku: string;
    categoryId: string | null;
    brandId: string | null;
    description: string;
    images: string[];
    attr: Record<string, string | string[]>;
    existingVariantIds: Set<string>;
    basePrice: number;
    variantPriceByVariantId: Record<string, number>;

    freeShipping: boolean;
    weightGrams: number | null;
    lengthCm: number | null;
    widthCm: number | null;
    heightCm: number | null;
    isFragile: boolean;
    isBulky: boolean;
    shippingClass: string | null;
  } | null>(null);
  const hydratedBaseForIdRef = useRef<string | null>(null);
  const hydratedAttrsForIdRef = useRef<string | null>(null);

  const [onboardingState, setOnboardingState] = useState({
    contactDone: true,
    businessDone: true,
    addressDone: true,
    docsDone: true,
    onboardingDone: true,
    nextPath: "/supplier",
    supplierStatus: null as string | null,
    kycStatus: null as string | null,
    loading: false,
    failed: false,
  });

  const onboardingBlocked =
    isSupplier && !onboardingState.failed && !onboardingState.loading && !onboardingState.onboardingDone;

  const nextStepLabel = useMemo(() => {
    const p = onboardingState.nextPath;
    if (p === "/supplier/verify-contact") return "Continue contact verification";
    if (p === "/supplier/onboarding") return "Continue business onboarding";
    if (p === "/supplier/onboarding/address") return "Continue address setup";
    if (p === "/supplier/onboarding/documents") return "Continue document upload";
    return "Continue onboarding";
  }, [onboardingState.nextPath]);

  const onboardingProgressItems = useMemo(() => {
    return [
      { key: "contact", label: "Contact verified", done: onboardingState.contactDone },
      { key: "business", label: "Business details", done: onboardingState.businessDone },
      { key: "address", label: "Address details", done: onboardingState.addressDone },
      { key: "documents", label: "Documents uploaded", done: onboardingState.docsDone },
    ];
  }, [
    onboardingState.contactDone,
    onboardingState.businessDone,
    onboardingState.addressDone,
    onboardingState.docsDone,
  ]);

  const onboardingPct = useMemo(() => {
    if (!onboardingProgressItems.length) return 0;
    const done = onboardingProgressItems.filter((x) => x.done).length;
    return Math.round((done / onboardingProgressItems.length) * 100);
  }, [onboardingProgressItems]);

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

  const {
    categories = [],
    brands = [],
    attributes = [],
    categoriesQ,
    brandsQ,
    attributesQ,
  } = useCatalogMeta({
    enabled: hydrated,
  }) as any;

  function getInitialVariantPriceMap(rows: VariantRow[]) {
    const out: Record<string, number> = {};
    for (const r of rows) {
      if (!r.variantId) continue;
      out[String(r.variantId)] = toMoneyNumber(r.unitPrice);
    }
    return out;
  }

  function toOptionalMoneyNumber(v: any): number | null {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function toOptionalInt(v: any): number | null {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.trunc(n));
  }

  const activeAttrs = useMemo(
    () => (Array.isArray(attributes) ? attributes : []).filter((a: any) => a?.isActive !== false),
    [attributes]
  );

  const selectableAttrs = useMemo(
    () => activeAttrs.filter((a: any) => a.type === "SELECT" && a.isActive !== false),
    [activeAttrs]
  );

  const attrOrder = useMemo(() => selectableAttrs.map((a: any) => a.id), [selectableAttrs]);

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

  useEffect(() => {
    if (!selectableAttrs.length) return;
    const ids = selectableAttrs.map((a: any) => a.id);

    setVariantRows((rows) =>
      rows.map((row) => {
        const next: Record<string, string> = {};
        ids.forEach((aid: string) => {
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
    queryKey: ["supplier", offersOnly ? "catalog-product" : "product", id, offersOnly ? "offersOnly" : "full"],
    enabled: hydrated && !!id && isSupplier,
    queryFn: async () => {
      const attempts = offersOnly
        ? [`/api/supplier/products/${id}`, `/api/supplier/products/${id}?include=offer,variants,images,attributes`]
        : [
          `/api/supplier/products/${id}?include=offer,variants,images,attributes`,
          `/api/supplier/products/${id}?include=offer,variants`,
          `/api/supplier/products/${id}`,
        ];

      let lastErr: any = null;
      for (const url of attempts) {
        try {
          const res = await api.get(url, AXIOS_COOKIE_CFG);
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

  const isLive = useMemo(() => {
    if (offersOnly) return false;
    return productStatusUpper === "LIVE" || productStatusUpper === "ACTIVE";
  }, [offersOnly, productStatusUpper]);

  const isPendingReview = useMemo(() => {
    if (offersOnly) return false;
    return productStatusUpper === "PENDING";
  }, [offersOnly, productStatusUpper]);

  const isRejected = useMemo(() => {
    if (offersOnly) return false;
    return productStatusUpper === "REJECTED";
  }, [offersOnly, productStatusUpper]);

  const isPublishedLike = useMemo(() => {
    if (offersOnly) return false;
    return (
      productStatusUpper === "LIVE" ||
      productStatusUpper === "ACTIVE" ||
      productStatusUpper === "PUBLISHED"
    );
  }, [offersOnly, productStatusUpper]);

  const isReviewManaged = useMemo(() => {
    if (offersOnly) return false;
    return isPublishedLike || isPendingReview || isRejected;
  }, [offersOnly, isPublishedLike, isPendingReview, isRejected]);

  const titleSkuLocked = isReviewManaged;

  const pendingSubmissionNotice = useMemo(() => {
    if (offersOnly) return null;
    if (isPendingReview) {
      return "A change is already under review. Your latest save will update the pending submission.";
    }
    if (isRejected) {
      return "This product was rejected previously. Edit the fields below and save to resubmit for approval.";
    }
    if (isLive) {
      return "Price/content changes will be sent for admin approval. Stock changes still apply immediately.";
    }
    return null;
  }, [offersOnly, isPendingReview, isRejected, isLive]);

  const activeBasePriceForDisplay = useMemo(() => {
    if (offersOnly) return Number(activeBasePrice ?? 0);
    return Number(initialBasePriceRef.current ?? 0);
  }, [offersOnly, activeBasePrice]);

  const requestedBasePriceForDisplay = useMemo(() => toMoneyNumber(retailPrice), [retailPrice]);

  const basePriceForPreview = useMemo(() => {
    if (isLive) return Number(initialBasePriceRef.current ?? 0);
    return toMoneyNumber(retailPrice);
  }, [isLive, retailPrice]);

  const isRealVariantRow = (r: VariantRow) => !!r.variantId || rowHasAnySelection(r.selections);

  const variantQtyTotal = useMemo(() => {
    return variantRows.reduce((sum, r) => sum + (isRealVariantRow(r) ? toIntNonNeg(r.availableQty) : 0), 0);
  }, [variantRows]);

  const baseQtyPreview = useMemo(() => toIntNonNeg(availableQty), [availableQty]);
  const totalQty = useMemo(() => baseQtyPreview + variantQtyTotal, [baseQtyPreview, variantQtyTotal]);
  const inStockPreview = totalQty > 0;

  const computeDupInfo = (rows: VariantRow[]): DupInfo => {
    const seen = new Map<string, string>();
    const dups = new Set<string>();
    const dupKeys = new Set<string>();

    const realRows = rows.filter((r) => isRealVariantRow(r) && rowHasAnySelection(r.selections));

    for (const row of realRows) {
      const key = comboKeyFromSelections(row.selections, attrOrder);
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
      const sample = realRows.find((r) => comboKeyFromSelections(r.selections, attrOrder) === k);
      return sample ? formatComboLabel(sample.selections, attrOrder, attrNameById, valueNameById) : k;
    });

    const explain =
      dups.size > 0
        ? `Duplicate variant combinations found: ${labels.join(" • ")}. Please change options or remove one of the duplicate rows.`
        : null;

    return {
      duplicateRowIds: dups,
      duplicateLabels: labels,
      explain,
    };
  };

  const liveDup = useMemo(() => computeDupInfo(variantRows), [variantRows, attrOrder, attrNameById, valueNameById]);
  const duplicateRowIds = liveDup.duplicateRowIds;
  const hasDuplicates = duplicateRowIds.size > 0;

  useEffect(() => {
    setDupWarn(liveDup.explain);
  }, [liveDup.explain]);

  const baseComboSelections = useMemo(() => {
    const sel: Record<string, string> = {};
    for (const aid of attrOrder) {
      const v = selectedAttrs?.[aid];
      sel[aid] = typeof v === "string" ? String(v || "").trim() : "";
    }
    return sel;
  }, [selectedAttrs, attrOrder]);

  const baseComboHasAny = useMemo(() => rowHasAnySelection(baseComboSelections), [baseComboSelections]);
  const baseComboKey = useMemo(() => comboKeyFromSelections(baseComboSelections, attrOrder), [baseComboSelections, attrOrder]);

  const baseComboConflictRowIds = useMemo(() => {
    if (!baseComboHasAny) return new Set<string>();
    const out = new Set<string>();
    for (const row of variantRows) {
      if (!isRealVariantRow(row)) continue;
      if (!rowHasAnySelection(row.selections)) continue;
      const key = comboKeyFromSelections(row.selections, attrOrder);
      if (key === baseComboKey) out.add(row.id);
    }
    return out;
  }, [variantRows, attrOrder, baseComboHasAny, baseComboKey]);

  const hasBaseComboConflict = baseComboConflictRowIds.size > 0;

  const baseComboWarn = useMemo(() => {
    if (!hasBaseComboConflict) return null;
    return "Your BaseCombo (Attributes) matches one or more VariantCombo rows. Change the base selection or update/remove the variant row(s).";
  }, [hasBaseComboConflict]);

  const canEditCore = !offersOnly && !onboardingBlocked;
  const canEditAttributes = !offersOnly && !onboardingBlocked;
  const canEditTitleSku = !offersOnly && !titleSkuLocked && !onboardingBlocked;
  const canAddNewCombos = !offersOnly && !isReviewManaged && !onboardingBlocked;

  useEffect(() => {
    let cancelled = false;

    async function loadOnboardingState() {
      if (!hydrated || !isSupplier) return;

      setOnboardingState((prev) => ({
        ...prev,
        loading: true,
        failed: false,
      }));

      const verifyCfg = getVerifyConfig();

      try {
        let profileMe: AuthMeLite = {};
        let supplierMe: SupplierMeLite = {};
        let docs: SupplierDocumentLite[] = [];

        try {
          const profileRes = await api.get("/api/profile/me", verifyCfg);
          const profilePayload = profileRes.data as any;
          profileMe = (profilePayload?.data ?? profilePayload ?? {}) as AuthMeLite;
        } catch {
          profileMe = {};
        }

        try {
          const supplierRes = await api.get("/api/supplier/me", verifyCfg);
          const supplierPayload = supplierRes.data as any;
          supplierMe = (
            supplierPayload?.data ??
            supplierPayload?.user ??
            supplierPayload ??
            {}
          ) as SupplierMeLite;
        } catch {
          supplierMe = {};
        }

        try {
          const docsRes = await api.get("/api/supplier/documents", verifyCfg);
          const rawDocs = (docsRes as any)?.data?.data ?? (docsRes as any)?.data ?? [];
          docs = Array.isArray(rawDocs) ? rawDocs : [];
        } catch {
          docs = [];
        }

        const emailDone = isEmailVerified(profileMe);
        const phoneDone = isPhoneVerified(profileMe);
        const contactDone = emailDone && phoneDone;

        const businessDone = Boolean(
          String(supplierMe?.legalName ?? "").trim() &&
          String(supplierMe?.registrationType ?? "").trim() &&
          String(supplierMe?.registrationCountryCode ?? "").trim()
        );

        const addressDone =
          hasAddress(supplierMe?.registeredAddress) ||
          hasAddress(supplierMe?.pickupAddress);

        const requiredKinds = [
          ...(isRegisteredBusiness(supplierMe?.registrationType)
            ? ["BUSINESS_REGISTRATION_CERTIFICATE"]
            : []),
          "GOVERNMENT_ID",
          "PROOF_OF_ADDRESS",
        ];

        const docsDone = requiredKinds.every((kind) => docSatisfied(docs, kind));
        const onboardingDone = contactDone && businessDone && addressDone && docsDone;

        const nextPath = !contactDone
          ? "/supplier/verify-contact"
          : !businessDone
            ? "/supplier/onboarding"
            : !addressDone
              ? "/supplier/onboarding/address"
              : !docsDone
                ? "/supplier/onboarding/documents"
                : "/supplier";

        if (cancelled) return;

        setOnboardingState({
          contactDone,
          businessDone,
          addressDone,
          docsDone,
          onboardingDone,
          nextPath,
          supplierStatus: supplierMe?.status ?? null,
          kycStatus: supplierMe?.kycStatus ?? null,
          loading: false,
          failed: false,
        });
      } catch {
        if (cancelled) return;

        setOnboardingState({
          contactDone: true,
          businessDone: true,
          addressDone: true,
          docsDone: true,
          onboardingDone: true,
          nextPath: "/supplier",
          supplierStatus: null,
          kycStatus: null,
          loading: false,
          failed: true,
        });
      }
    }

    loadOnboardingState();

    return () => {
      cancelled = true;
    };
  }, [hydrated, isSupplier]);

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
    setErr(null);
    setOkMsg(null);
    setEditingVariantRowId(null);
    setFreeShipping(!!p.freeShipping);
    setWeightGrams(
      p.weightGrams == null || Number(p.weightGrams) <= 0 ? "" : String(Number(p.weightGrams))
    );
    setLengthCm(
      p.lengthCm == null || Number(p.lengthCm) <= 0 ? "" : String(Number(p.lengthCm))
    );
    setWidthCm(
      p.widthCm == null || Number(p.widthCm) <= 0 ? "" : String(Number(p.widthCm))
    );
    setHeightCm(
      p.heightCm == null || Number(p.heightCm) <= 0 ? "" : String(Number(p.heightCm))
    );
    setIsFragile(!!p.isFragile);
    setIsBulky(!!p.isBulky);
    setShippingClass(
      p.shippingClass === "FRAGILE" || p.shippingClass === "BULKY" || p.shippingClass === "STANDARD"
        ? p.shippingClass
        : ""
    );

    const productFallback = Number(p.retailPrice ?? 0) || Number(p.autoPrice ?? 0) || 0;
    const approvedBasePrice = Number(p.offer?.basePrice ?? productFallback ?? 0) || 0;

    initialBasePriceRef.current = approvedBasePrice;
    setActiveBasePrice(approvedBasePrice);

    let displayedBasePrice = approvedBasePrice;

    const { base } = getPendingOfferMaps(p);
    const basePatch = base?.proposedPatch ?? base?.patchJson ?? null;
    const requestedBasePrice = Number(basePatch?.basePrice ?? NaN);

    if (Number.isFinite(requestedBasePrice) && requestedBasePrice > 0) {
      displayedBasePrice = requestedBasePrice;
    }

    setRetailPrice(String(displayedBasePrice));

    const urls = limitImages(normalizeImages(p), MAX_IMAGES);
    setImageUrls(urls.join("\n"));
    setUploadedUrls([]);
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";

    const baseQty = p.offer ? (p.offer.availableQty ?? 0) : (p.availableQty ?? 0);
    setAvailableQty(String(Number(baseQty) || 0));

    const myVarOffers: Array<any> = Array.isArray(p?.supplierVariantOffers)
      ? p.supplierVariantOffers
      : [];

    const offerByVariantId = new Map<string, any>();
    for (const o of myVarOffers) {
      const vid = String(o?.variantId ?? "").trim();
      if (vid) offerByVariantId.set(vid, o);
    }

    const pendingProductReq = !offersOnly ? getPendingProductChange(p) : null;
    const productPatch =
      pendingProductReq?.proposedPatch ??
      pendingProductReq?.patchJson ??
      null;
    const pendingProductVariantMap = buildPendingVariantPatchMapFromProductPatch(productPatch);

    const vList = normalizeVariants(p);

    const vr: VariantRow[] = (vList ?? []).map((v: any) => {
      const rawOptions = extractVariantOptions(v);

      const selections: Record<string, string> = {};
      selectableAttrs.forEach((a: any) => {
        selections[a.id] = "";
      });

      for (const o of rawOptions) {
        if (selections[o.attributeId] != null) {
          selections[o.attributeId] = o.valueId;
        }
      }

      const comboLabel = formatComboLabel(
        selections,
        attrOrder,
        attrNameById,
        valueNameById
      );

      const variantId = String(v?.id ?? v?.variantId ?? "").trim();

      const myOffer =
        offerByVariantId.get(variantId) ??
        v?.supplierVariantOffer ??
        (Array.isArray(v?.supplierVariantOffers) ? v.supplierVariantOffers?.[0] : null);

      const qty = myOffer?.availableQty ?? v?.availableQty ?? 0;

      const approvedOfferUnit = Number(myOffer?.unitPrice ?? NaN);
      const variantRetail =
        Number(v?.retailPrice ?? NaN) ||
        Number(v?.unitPrice ?? NaN) ||
        Number(v?.price ?? NaN);

      const approvedUnitPrice =
        Number.isFinite(approvedOfferUnit) && approvedOfferUnit > 0
          ? approvedOfferUnit
          : Number.isFinite(variantRetail) && variantRetail > 0
            ? variantRetail
            : approvedBasePrice;

      const pendingVariantPatch = pendingProductVariantMap.get(variantId);
      const pendingUnitPrice = Number(pendingVariantPatch?.unitPrice ?? NaN);

      const displayedUnitPrice =
        !offersOnly && Number.isFinite(pendingUnitPrice) && pendingUnitPrice > 0
          ? pendingUnitPrice
          : approvedUnitPrice;

      return {
        id: uid("vr"),
        variantId,
        isExisting: true,
        selections,
        comboLabel,
        availableQty: String(Number(qty) || 0),
        unitPrice: String(Number(displayedUnitPrice) || 0),
        activeUnitPrice: approvedUnitPrice,
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
      freeShipping: !!p.freeShipping,
      weightGrams:
        p.weightGrams == null || !Number.isFinite(Number(p.weightGrams))
          ? null
          : Number(p.weightGrams),
      lengthCm:
        p.lengthCm == null || !Number.isFinite(Number(p.lengthCm))
          ? null
          : Number(p.lengthCm),
      widthCm:
        p.widthCm == null || !Number.isFinite(Number(p.widthCm))
          ? null
          : Number(p.widthCm),
      heightCm:
        p.heightCm == null || !Number.isFinite(Number(p.heightCm))
          ? null
          : Number(p.heightCm),
      isFragile: !!p.isFragile,
      isBulky: !!p.isBulky,
      shippingClass: p.shippingClass ? String(p.shippingClass) : null,
      existingVariantIds: new Set(
        vr.filter((x) => x.variantId).map((x) => String(x.variantId))
      ),
      basePrice: approvedBasePrice,
      variantPriceByVariantId: getInitialVariantPriceMap(vr),
    };
  }, [detailQ.data?.id, offersOnly, selectableAttrs, attrOrder, attrNameById, valueNameById]);

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
      if (a.type === "SELECT") nextSel[a.id] = grouped[a.id]?.[0] ?? "";
      if (a.type === "TEXT" && nextSel[a.id] == null) nextSel[a.id] = "";
    }

    setSelectedAttrs(nextSel);

    const snap = initialSnapshotRef.current;
    if (snap && snap.id === p.id) {
      snap.attr = { ...nextSel };
    }
  }, [detailQ.data?.id, detailQ.data, attributes]);

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
        } catch { }
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
        } catch { }
        delete map[k];
      }
    };
  }, []);

  const UPLOAD_ENDPOINT = "/api/uploads";

  const urlPreviews = useMemo(() => limitImages(parseUrlList(imageUrls), MAX_IMAGES), [imageUrls]);

  const allUrlPreviews = useMemo(() => {
    return limitImages([...urlPreviews, ...uploadedUrls], MAX_IMAGES);
  }, [urlPreviews, uploadedUrls]);

  const filePreviews = useMemo<Array<{ file: File; url: string }>>(() => {
    const map = filePreviewMapRef.current;
    const out: Array<{ file: File; url: string }> = [];

    for (const f of files) {
      const k = fileKey(f);
      const url = map[k];
      if (typeof url === "string" && url) {
        out.push({ file: f, url });
      }
    }

    return out;
  }, [files]);

  const imagesCount = allUrlPreviews.length;
  const fileCount = files.length;
  const imageOverLimit = imagesCount > MAX_IMAGES;

  const claimedByTextAndUploaded = useMemo(() => {
    return limitImages([...urlPreviews, ...uploadedUrls], MAX_IMAGES).length;
  }, [urlPreviews, uploadedUrls]);

  const remainingSlotsExcludingSelectedFiles = useMemo(
    () => Math.max(0, MAX_IMAGES - claimedByTextAndUploaded),
    [claimedByTextAndUploaded]
  );

  const remainingSlots = useMemo(() => {
    return Math.max(0, remainingSlotsExcludingSelectedFiles - files.length);
  }, [remainingSlotsExcludingSelectedFiles, files.length]);

  function getAllImagesFromUi(): string[] {
    return limitImages([...parseUrlList(imageUrls), ...uploadedUrls], MAX_IMAGES);
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

  function onPickFiles(nextPicked: File[]) {
    if (offersOnly || onboardingBlocked) return;
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
    if (offersOnly || onboardingBlocked) return [];
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

      const clean = extractUploadUrls((res as any)?.data);
      if (!clean.length) {
        throw new Error("Upload succeeded but no image URLs were returned. Check /api/uploads response shape.");
      }

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

  function getVariantRowLabel(row: VariantRow) {
    return formatComboLabel(row.selections, attrOrder, attrNameById, valueNameById);
  }

  function findVariantMatchingKey(key: string, exceptRowId?: string) {
    for (const row of variantRows) {
      if (exceptRowId && row.id === exceptRowId) continue;
      if (!isRealVariantRow(row)) continue;
      if (!rowHasAnySelection(row.selections)) continue;
      const k = comboKeyFromSelections(row.selections, attrOrder);
      if (k === key) return row;
    }
    return null;
  }

  function setVariantRowsAndCheck(next: VariantRow[]) {
    setVariantRows(next);
    const info = computeDupInfo(next);
    setDupWarn(info.explain);
    if (!info.explain) setDupWarn(null);
  }

  function addVariantRow() {
    setErr(null);
    if (offersOnly) {
      setErr("You can’t create new variant combinations for a catalog product. You can only offer existing variants.");
      return;
    }
    if (isReviewManaged) {
      setErr("This product is in review-managed flow. You can’t create new variant combinations here.");
      return;
    }
    if (onboardingBlocked) return;
    if (!selectableAttrs.length) return;

    const selections: Record<string, string> = {};
    selectableAttrs.forEach((a: any) => (selections[a.id] = ""));

    const newRow: VariantRow = {
      id: uid("vr"),
      selections,
      availableQty: "",
      unitPrice: retailPrice || "",
      isExisting: false,
    };

    setVariantRows((prev) => [...prev, newRow]);
    setEditingVariantRowId(newRow.id);
  }

  function generateVariantMatrix() {
    setErr(null);

    if (offersOnly) {
      setErr("You can’t generate new combos for a catalog product.");
      return;
    }
    if (isReviewManaged) {
      setErr("This product is in review-managed flow. You can’t generate new variant combinations here.");
      return;
    }
    if (onboardingBlocked) return;

    const pickedAttrs = selectableAttrs
      .map((attr: any) => {
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
        if (!isRealVariantRow(row)) return false;
        if (!rowHasAnySelection(row.selections)) return false;
        return comboKeyFromSelections(row.selections, attrOrder) === key;
      });

    if (baseComboHasAny && nextKey === baseComboKey) {
      let adjusted = false;

      for (const attr of selectableAttrs) {
        const currentValueId = String(nextSelections[attr.id] || "").trim();
        if (!currentValueId) continue;

        const alternative = (attr.values || []).find((v: any) => {
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
        const firstSelectedAttr = selectableAttrs.find((a: any) => String(nextSelections[a.id] || "").trim());
        if (firstSelectedAttr) {
          nextSelections = { ...nextSelections, [firstSelectedAttr.id]: "" };
          setErr("The generated combo matched your BaseCombo, so one selection was cleared. Choose a different value and save combo.");
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
      isExisting: false,
    };

    setVariantRows((prev) => [...prev, nextRow]);
    setEditingVariantRowId(nextRow.id);
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

  function updateVariantSelection(rowId: string, attributeId: string, valueId: string) {
    setErr(null);
    if (offersOnly || isReviewManaged || onboardingBlocked) return;

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
        if (!isRealVariantRow(r)) return false;
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
    const next = variantRows.map((r) => (r.id === rowId ? { ...r, availableQty: v } : r));
    setVariantRowsAndCheck(next);
  }

  function updateVariantPrice(rowId: string, v: string) {
    const next = variantRows.map((r) => (r.id === rowId ? { ...r, unitPrice: v } : r));
    setVariantRowsAndCheck(next);
  }

  async function removeOfferForVariant(row: VariantRow) {
    if (!row.variantOfferId) return;

    await api.delete(`/api/supplier/catalog/offers/variant/${row.variantOfferId}`, AXIOS_COOKIE_CFG);

    setVariantRows((rows) =>
      rows.map((r) =>
        r.id === row.id ? { ...r, variantOfferId: undefined, availableQty: "0" } : r
      )
    );
  }

  function removeVariantRow(rowId: string) {
    const row = variantRows.find((r) => r.id === rowId);
    if (!row) return;
    if (onboardingBlocked) return;

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

    if (isReviewManaged && row.isExisting) {
      setErr("This product is in review-managed flow. You can’t delete an existing variant. Set its qty to 0 instead.");
      return;
    }

    const next = variantRows.filter((r) => r.id !== rowId);
    setVariantRowsAndCheck(next);

    if (editingVariantRowId === rowId) {
      setEditingVariantRowId(null);
    }
  }

  function validateVariantRow(row: VariantRow) {
    if (!rowHasAnySelection(row.selections)) {
      return "Choose at least one attribute value for this combo.";
    }

    const rowKey = comboKeyFromSelections(row.selections, attrOrder);

    if (baseComboHasAny && rowKey === baseComboKey) {
      return "This VariantCombo matches your BaseCombo. Change one of the selections before saving.";
    }

    const dup = variantRows.find((r) => {
      if (r.id === row.id) return false;
      if (!isRealVariantRow(r)) return false;
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
    if (onboardingBlocked) return;

    const validationError = validateVariantRow(row);
    if (validationError) {
      setErr(validationError);
      triggerConflictFlash(rowId);
      return;
    }

    setErr(null);
    setEditingVariantRowId(null);
  }

  const setBaseSelectAttr = (attributeId: string, valueId: string) => {
    if (!canEditAttributes) return;

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
        }
      }

      return next;
    });
  };

  const setAttr = (attributeId: string, value: string | string[]) => {
    if (!canEditAttributes) return;

    const attr = activeAttrs.find((a: any) => a.id === attributeId);
    if (attr?.type === "SELECT" && typeof value === "string") {
      setBaseSelectAttr(attributeId, value);
      return;
    }

    setSelectedAttrs((prev) => ({ ...prev, [attributeId]: value }));
  };

  const onChangeBasePrice = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErr(null);
    setRetailPrice(e.target.value);
  };

  function getAttrVal(attributeId: string) {
    return selectedAttrs?.[attributeId];
  }

  const nonStockChangesRequireReview = useMemo(() => {
    if (offersOnly) return false;
    if (!isReviewManaged) return false;

    const snap = initialSnapshotRef.current;
    if (!snap || snap.id !== (detailQ.data as any)?.id) return false;

    const titleChanged = (title ?? "").trim() !== (snap.title ?? "").trim();
    const skuChanged = (sku ?? "").trim() !== (snap.sku ?? "").trim();
    const catChanged = String(categoryId ?? "") !== String(snap.categoryId ?? "");
    const brandChanged = String(brandId ?? "") !== String(snap.brandId ?? "");
    const descChanged = String(description ?? "").trim() !== String(snap.description ?? "").trim();

    const currentBasePrice = toMoneyNumber(retailPrice);
    const basePriceChanged = currentBasePrice !== Number(snap.basePrice ?? 0);

    const currentImgs = getAllImagesFromUi().slice(0, MAX_IMAGES);
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

    const currentWeightGrams = toOptionalInt(weightGrams);
    const currentLengthCm = toOptionalMoneyNumber(lengthCm);
    const currentWidthCm = toOptionalMoneyNumber(widthCm);
    const currentHeightCm = toOptionalMoneyNumber(heightCm);

    const shippingChanged =
      Boolean(freeShipping) !== Boolean(snap.freeShipping) ||
      currentWeightGrams !== snap.weightGrams ||
      currentLengthCm !== snap.lengthCm ||
      currentWidthCm !== snap.widthCm ||
      currentHeightCm !== snap.heightCm ||
      Boolean(isFragile) !== Boolean(snap.isFragile) ||
      Boolean(isBulky) !== Boolean(snap.isBulky) ||
      String(shippingClass || "") !== String(snap.shippingClass || "");

    const variantPriceChanged = variantRows.some((r) => {
      if (!r.variantId) return false;
      const prev = Number(snap.variantPriceByVariantId?.[String(r.variantId)] ?? 0);
      const cur = toMoneyNumber(r.unitPrice);
      return prev !== cur;
    });

    const newCombosAdded = variantRows.some((r) => !r.variantId && rowHasAnySelection(r.selections));

    return (
      titleChanged ||
      skuChanged ||
      catChanged ||
      brandChanged ||
      descChanged ||
      imagesChanged ||
      attrChanged ||
      basePriceChanged ||
      variantPriceChanged ||
      newCombosAdded ||
      shippingChanged
    );
  }, [
    offersOnly,
    isReviewManaged,
    detailQ.data,
    title,
    sku,
    categoryId,
    brandId,
    description,
    retailPrice,
    imageUrls,
    uploadedUrls,
    selectedAttrs,
    variantRows,
    freeShipping,
    weightGrams,
    lengthCm,
    widthCm,
    heightCm,
    isFragile,
    isBulky,
    shippingClass,
  ]);

  function buildAttributeSelectionsPayload() {
    const out: Array<{ attributeId: string; text?: string; valueId?: string; valueIds?: string[] }> = [];

    for (const a of (attributes ?? []) as CatalogAttribute[]) {
      if (!a?.id) continue;
      const aid = String(a.id);
      const raw = getAttrVal(aid);

      if (a.type === "TEXT") {
        const v = String(raw ?? "").trim();
        if (v) out.push({ attributeId: aid, text: v });
        continue;
      }

      if (a.type === "SELECT") {
        const v = String(raw ?? "").trim();
        if (v) out.push({ attributeId: aid, valueId: v });
        continue;
      }

      if (a.type === "MULTISELECT") {
        const vals = Array.isArray(raw) ? raw : [];
        const clean = vals.map(String).map((x) => x.trim()).filter(Boolean);
        if (clean.length) out.push({ attributeId: aid, valueIds: clean });
      }
    }

    return out;
  }

  function buildOwnedVariantsPayload() {
    const rows = variantRows.filter((r) => isRealVariantRow(r) && rowHasAnySelection(r.selections));
    const basePrice = toMoneyNumber(retailPrice);

    return rows.map((r) => {
      const options = attrOrder
        .map((aid) => {
          const vid = String(r.selections?.[aid] ?? "").trim();
          if (!vid) return null;
          return { attributeId: aid, valueId: vid };
        })
        .filter(Boolean) as Array<{ attributeId: string; valueId: string }>;

      const rowUnit = toMoneyNumber(r.unitPrice);
      const finalUnit = rowUnit > 0 ? rowUnit : basePrice;

      return {
        ...(r.variantId ? { variantId: String(r.variantId) } : {}),
        sku: undefined,
        unitPrice: finalUnit,
        availableQty: toIntNonNeg(r.availableQty),
        qty: toIntNonNeg(r.availableQty),
        quantity: toIntNonNeg(r.availableQty),
        inStock: toIntNonNeg(r.availableQty) > 0,
        isActive: true,
        imagesJson: [],
        options,
      };
    });
  }

  function buildStockOnlyPayload(args: { baseQty: number; variantRows: VariantRow[] }) {
    const baseQty = toIntNonNeg(args.baseQty);

    const existingRows = args.variantRows.filter((r) => !!r.variantId);

    const variants = existingRows.map((r) => ({
      variantId: String(r.variantId),
      availableQty: toIntNonNeg(r.availableQty),
      qty: toIntNonNeg(r.availableQty),
      quantity: toIntNonNeg(r.availableQty),
      inStock: toIntNonNeg(r.availableQty) > 0,
    }));

    const sumVariants = existingRows.reduce((s, r) => s + toIntNonNeg(r.availableQty), 0);
    const total = baseQty + sumVariants;

    return {
      availableQty: baseQty,
      qty: baseQty,
      quantity: baseQty,
      inStock: total > 0,
      variants,
      stockOnly: true,
    };
  }

  function buildOwnedPayload(imagesJson: string[]) {
    const price = toMoneyNumber(retailPrice);
    const baseQty = baseQtyPreview;
    const weightGramsNum = toOptionalInt(weightGrams);
    const lengthCmNum = toOptionalMoneyNumber(lengthCm);
    const widthCmNum = toOptionalMoneyNumber(widthCm);
    const heightCmNum = toOptionalMoneyNumber(heightCm);

    const core: any = {
      description: (description ?? "").trim(),
      freeShipping,
      weightGrams: freeShipping ? null : weightGramsNum,
      lengthCm: freeShipping ? null : lengthCmNum,
      widthCm: freeShipping ? null : widthCmNum,
      heightCm: freeShipping ? null : heightCmNum,
      isFragile: freeShipping ? false : isFragile,
      isBulky: freeShipping ? false : isBulky,
      shippingClass: freeShipping ? null : shippingClass || null,

      basePrice: price,
      offer: {
        basePrice: price,
        availableQty: baseQty,
        qty: baseQty,
        quantity: baseQty,
        inStock: totalQty > 0,
        isActive: true,
        currency: "NGN",
        leadDays: null,
      },

      categoryId: categoryId || null,
      brandId: brandId || null,
      imagesJson,

      availableQty: baseQty,
      qty: baseQty,
      quantity: baseQty,
      inStock: totalQty > 0,

      attributeSelections: buildAttributeSelectionsPayload(),
      variants: buildOwnedVariantsPayload(),
      stockOnly: false,
    };

    if (!titleSkuLocked) {
      core.title = title.trim();
      core.sku = sku.trim();
    }

    return core;
  }

  const updateM = useMutation({
    mutationFn: async () => {
      setErr(null);
      setOkMsg(null);

      if (onboardingBlocked) {
        throw new Error("Complete supplier onboarding first before editing products.");
      }

      if (imageOverLimit || hasBaseComboConflict || hasDuplicates) {
        throw new Error(
          imageOverLimit
            ? `Max ${MAX_IMAGES} images allowed. Remove extra images to continue.`
            : baseComboWarn
              ? baseComboWarn
              : dupWarn || "Fix the errors above to save."
        );
      }

      if (!id) throw new Error("Missing product id");

      const imagesFromUi = getAllImagesFromUi();
      if (imagesFromUi.length > MAX_IMAGES) {
        throw new Error(`Max ${MAX_IMAGES} images allowed. Please remove ${imagesFromUi.length - MAX_IMAGES} image(s).`);
      }

      const basePrice = toMoneyNumber(retailPrice);
      if (!Number.isFinite(basePrice) || basePrice <= 0) throw new Error("Price must be greater than 0");

      if (hasBaseComboConflict) {
        throw new Error(baseComboWarn || "Base combo matches a variant combo. Please change one of them.");
      }

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
            qty: baseQty,
            quantity: baseQty,
            leadDays: null,
            isActive: true,
            inStock: baseInStock,
            currency: "NGN",
          },
          AXIOS_COOKIE_CFG
        );

        const tasks: Promise<any>[] = [];

        for (const r of variantRows) {
          if (!r.variantId) continue;
          const qty = toIntNonNeg(r.availableQty);

          if (qty <= 0) {
            if (r.variantOfferId) {
              tasks.push(api.delete(`/api/supplier/catalog/offers/variant/${r.variantOfferId}`, AXIOS_COOKIE_CFG));
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
                qty,
                quantity: qty,
                leadDays: null,
                isActive: true,
                inStock: qty > 0,
                currency: "NGN",
              },
              AXIOS_COOKIE_CFG
            )
          );
        }

        await Promise.all(tasks);
        return { ok: true };
      }

      if (!title.trim()) throw new Error("Title is required");
      if (!sku.trim()) throw new Error("SKU is required");
      if (!String(description ?? "").trim()) throw new Error("Description is required");
      if (!brandId) throw new Error("Brand is required");

      const snap = initialSnapshotRef.current;
      if (isReviewManaged && snap) {
        if ((title ?? "").trim() !== (snap.title ?? "").trim()) {
          throw new Error("This product is under review-managed flow. Title is locked.");
        }
        if ((sku ?? "").trim() !== (snap.sku ?? "").trim()) {
          throw new Error("This product is under review-managed flow. SKU is locked.");
        }
      }

      if (hasDuplicates) {
        throw new Error(dupWarn || "You can’t save because there are duplicate variant combinations.");
      }

      const stockOnlyUpdate = isReviewManaged && !nonStockChangesRequireReview;

      const rawList = parseUrlList(imageUrls);
      const urlList = limitImages(rawList, MAX_IMAGES);
      if (rawList.length !== urlList.length) {
        setImageUrls(urlList.join("\n"));
      }

      const current = limitImages([...urlList, ...uploadedUrls], MAX_IMAGES);
      const freshlyUploaded = files.length ? await uploadLocalFiles() : [];
      const merged = limitImages([...current, ...freshlyUploaded], MAX_IMAGES);

      const payload = stockOnlyUpdate
        ? buildStockOnlyPayload({ baseQty: baseQtyPreview, variantRows })
        : {
          ...buildOwnedPayload(merged),
          submitForReview: isReviewManaged && nonStockChangesRequireReview,
          stockOnly: false,
        };

      const { data } = await api.patch(`/api/supplier/products/${id}`, payload, AXIOS_COOKIE_CFG);
      return data;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["supplier"] });

      if (offersOnly) {
        setOkMsg("Saved ✅ Stock updates apply immediately. Price changes may be pending admin approval.");
        detailQ.refetch?.();
        setTimeout(() => nav("/supplier/catalog-offers", { replace: true }), 700);
        return;
      }

      const stockOnlyUpdate = isReviewManaged && !nonStockChangesRequireReview;

      if (isLive && !stockOnlyUpdate) {
        setOkMsg("Saved ✅ Price/content changes were submitted for admin approval. Stock-only values still update immediately.");
      } else {
        setOkMsg(stockOnlyUpdate ? "Stock updated ✅" : "Saved ✅");
      }

      setTimeout(() => nav("/supplier/products", { replace: true }), 700);
    },
    onError: (e: any) => {
      setErr(e?.response?.data?.userMessage || e?.response?.data?.error || e?.message || "Failed to update");
    },
  });

  const hasBlockingError = imageOverLimit || hasBaseComboConflict || hasDuplicates;
  const isSubmitting = updateM.isPending;

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
  const hasPendingNonStockBlock = false;

  const saveButtonLabel = useMemo(() => {
    if (isSubmitting) return "Submitting…";
    if (offersOnly) return "Save offer";
    if (isPendingReview) return "Update pending submission";
    if (isRejected) return "Resubmit changes";
    return "Save changes";
  }, [isSubmitting, offersOnly, isPendingReview, isRejected]);

  const submitDisabled =
    isSubmitting ||
    uploading ||
    detailQ.isLoading ||
    onboardingState.loading ||
    !hydrated ||
    !isSupplier ||
    onboardingBlocked ||
    hasBlockingError;

  const doSave = () => {
    if (onboardingBlocked) {
      setErr("Complete supplier onboarding first before editing products.");
      return;
    }

    if (hasBlockingError) {
      setErr(
        imageOverLimit
          ? `Max ${MAX_IMAGES} images allowed. Remove extra images to continue.`
          : baseComboWarn
            ? baseComboWarn
            : dupWarn || "Fix the errors above to save."
      );
      return;
    }

    updateM.mutate();
  };

  useEffect(() => {
    const p = detailQ.data as any;
    if (!p?.id) return;

    const { base, variantMap } = getPendingOfferMaps(p);
    const basePatch = base?.proposedPatch ?? base?.patchJson ?? null;

    setPendingBasePatch(basePatch);
    setPendingVariantPatchByVariantId(variantMap);

    if (offersOnly) {
      setPendingProductPatch(null);
      setPendingProductVariantPatchByVariantId(new Map());
      return;
    }

    const pendingProductReq = getPendingProductChange(p);
    const productPatch =
      pendingProductReq?.proposedPatch ??
      pendingProductReq?.patchJson ??
      null;

    setPendingProductPatch(productPatch);
    setPendingProductVariantPatchByVariantId(
      buildPendingVariantPatchMapFromProductPatch(productPatch)
    );
  }, [detailQ.data, offersOnly]);

  const latestPendingBasePatch = useMemo(
    () => getPendingBasePatchFromDetail(detailQ.data),
    [detailQ.data]
  );

  const pendingBaseValue = useMemo(() => {
    const raw =
      latestPendingBasePatch?.basePrice ??
      latestPendingBasePatch?.offer?.basePrice ??
      latestPendingBasePatch?.price ??
      null;

    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [latestPendingBasePatch]);

  const hasPendingBaseForUi = useMemo(() => {
    return !offersOnly && pendingBaseValue != null;
  }, [offersOnly, pendingBaseValue]);

  const pendingBaseMatchesForm = useMemo(() => {
    if (!hasPendingBaseForUi) return false;

    const current = toMoneyNumber(retailPrice);
    return current > 0 && current === pendingBaseValue;
  }, [hasPendingBaseForUi, pendingBaseValue, retailPrice]);


  return (
    <SiteLayout>
      <SupplierLayout>
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 border-t bg-white/90 backdrop-blur">
          <div className="px-4 py-3 flex items-center gap-3">
            <button
              type="button"
              disabled={submitDisabled}
              onClick={doSave}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-zinc-900 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
            >
              {offersOnly ? <Link2 size={16} /> : <Save size={16} />}
              {onboardingBlocked ? "Onboarding required" : saveButtonLabel}
            </button>

            <button
              type="button"
              onClick={() => setSummaryOpen((v) => !v)}
              className="shrink-0 inline-flex items-center gap-2 rounded-full border bg-white px-3 py-2 text-sm font-semibold"
              aria-expanded={summaryOpen}
            >
              <Package size={16} />
              <ChevronDown
                size={16}
                className={summaryOpen ? "rotate-180 transition" : "transition"}
              />
            </button>
          </div>

          {hasPendingNonStockBlock && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
              <b>Pending approval:</b> You already have a change request under review for this product.
              You can still update stock/qty, but other changes must wait until admin approves or rejects the pending request.
            </div>
          )}

          {summaryOpen && (
            <div className="px-4 pb-4">
              <div className="rounded-2xl border bg-white p-4 text-sm text-zinc-700 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Mode</span>
                  <b className="text-zinc-900">
                    {offersOnly
                      ? "Attach existing"
                      : isPendingReview
                        ? "Update pending submission"
                        : isRejected
                          ? "Resubmit for approval"
                          : isReviewManaged
                            ? "Review-managed product"
                            : "Edit product"}
                  </b>
                </div>
                {!offersOnly && (
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Shipping</span>
                    <b className="text-zinc-900">
                      {freeShipping
                        ? "Free shipping"
                        : shippingClass || weightGrams || lengthCm || widthCm || heightCm
                          ? "Parcel configured"
                          : "Default / blank"}
                    </b>
                  </div>
                )}

                {!offersOnly ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Base price</span>
                      <b className="text-zinc-900">
                        {retailPrice ? ngn.format(toMoneyNumber(retailPrice)) : "—"}
                      </b>
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
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Selected product</span>
                      <b className="text-zinc-900 truncate max-w-[180px]">{title || "—"}</b>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Base offer</span>
                      <b className="text-zinc-900">
                        {retailPrice ? ngn.format(toMoneyNumber(retailPrice)) : "—"}
                      </b>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Total qty</span>
                      <b className={totalQty > 0 ? "text-emerald-700" : "text-rose-700"}>{totalQty}</b>
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
                {offersOnly ? "Edit offer" : "Edit product"}
              </motion.h1>

              <p className="text-sm text-zinc-600 mt-1">
                {offersOnly
                  ? "Update your supplier offer on an existing catalog product."
                  : isPendingReview
                    ? "A submission is already pending. You can keep editing eligible fields and your next save will update that pending submission."
                    : isRejected
                      ? "This product was previously rejected. Update the eligible fields below and save to resubmit for approval."
                      : isLive
                        ? "Edit your product. Stock updates are immediate; some other changes may need review."
                        : "Edit your product details, attributes, images and variant combinations."}
              </p>

              <div className="mt-2 text-xs text-zinc-500">
                Status: <span className="font-medium text-zinc-800">{productStatusUpper || "—"}</span>
              </div>
            </div>

            <div className="hidden sm:flex gap-2">
              <Link
                to={offersOnly ? "/supplier/catalog-offers" : "/supplier/products"}
                className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
              >
                <ArrowLeft size={16} /> Back
              </Link>

              <button
                type="button"
                disabled={submitDisabled}
                onClick={doSave}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
                title={onboardingBlocked ? "Complete onboarding first" : undefined}
              >
                {offersOnly ? <Link2 size={16} /> : <Save size={16} />}
                {onboardingBlocked ? "Onboarding required" : saveButtonLabel}
              </button>
            </div>

            <div className="sm:hidden">
              <Link
                to={offersOnly ? "/supplier/catalog-offers" : "/supplier/products"}
                className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
              >
                <ArrowLeft size={16} /> Back
              </Link>
            </div>
          </div>

          {guardMsg && (
            <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
              {guardMsg}
            </div>
          )}

          {isSupplier && onboardingState.loading && (
            <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
              Checking onboarding status…
            </div>
          )}

          {isSupplier && onboardingState.failed && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Could not check onboarding status right now. The page is still available, but onboarding lock detection may be incomplete.
            </div>
          )}

          {onboardingBlocked && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="font-semibold">Onboarding in progress</div>
                  <div className="mt-1 text-amber-800">
                    You need to complete supplier onboarding before editing products.
                    Your product form is visible for context, but editing and saving are locked until onboarding is complete.
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
                    {onboardingProgressItems.map((item) => (
                      <span
                        key={item.key}
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"
                          }`}
                      >
                        {item.label}: {item.done ? "Done" : "Pending"}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 text-[12px] text-amber-800">
                    Supplier status: <b>{String(onboardingState.supplierStatus ?? "PENDING")}</b>
                    {" • "}
                    KYC: <b>{String(onboardingState.kycStatus ?? "PENDING")}</b>
                  </div>
                </div>

                <div className="shrink-0">
                  <Link
                    to={onboardingState.nextPath || "/supplier/verify-contact"}
                    className="inline-flex items-center justify-center rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-950"
                  >
                    {nextStepLabel}
                    <ArrowLeft className="ml-2 h-4 w-4 rotate-180" />
                  </Link>
                </div>
              </div>
            </div>
          )}

          {!offersOnly && pendingSubmissionNotice && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
              <b>
                {isPendingReview
                  ? "Pending approval:"
                  : isRejected
                    ? "Rejected previously:"
                    : "Review notice:"}
              </b>{" "}
              {pendingSubmissionNotice}
            </div>
          )}

          {!offersOnly && titleSkuLocked && (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 text-zinc-800 px-4 py-3 text-sm">
              <b>Locked fields:</b> Title and SKU can’t be changed while this product is in the review-managed flow.
            </div>
          )}

          {offersOnly && hasPendingBase && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
              <b>Pending approval:</b> Active price remains <b>{ngn.format(activeBasePriceForDisplay)}</b>.
            </div>
          )}

          {imageOverLimit && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
              Max {MAX_IMAGES} images allowed. Remove extra images before saving.
            </div>
          )}

          {baseComboWarn && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
              {baseComboWarn}
            </div>
          )}

          {dupWarn && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
              {dupWarn}
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

          {detailQ.isError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
              Could not load product.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <Card
                title="Basic information"
                className={onboardingBlocked ? "border-amber-200 bg-amber-50/30" : ""}
                subtitle={
                  offersOnly
                    ? "Catalog product details are read-only. Update your supplier offer values below."
                    : "What customers will see in the catalog"
                }
              >
                <div className="space-y-3">
                  {onboardingBlocked && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                      Editing is temporarily locked until supplier onboarding is complete.
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>
                        Title *{" "}
                        {titleSkuLocked ? (
                          <span className="text-zinc-400 font-normal">(locked during review flow)</span>
                        ) : null}
                      </Label>
                      <Input
                        value={title}
                        onChange={(e) => {
                          if (!canEditTitleSku) return;
                          const nextTitle = e.target.value;
                          setTitle(nextTitle);
                          if (!offersOnly && !isReviewManaged && !skuTouched) {
                            setSku(autoSkuFromTitle(nextTitle));
                          }
                        }}
                        disabled={!canEditTitleSku}
                        readOnly={!canEditTitleSku}
                        className={!canEditTitleSku ? "bg-zinc-100 text-zinc-500 cursor-not-allowed" : ""}
                        placeholder="e.g. Air Fryer 4L"
                      />
                      {titleSkuLocked && (
                        <div className="text-[11px] text-zinc-500 mt-1">
                          Title is locked while this product is LIVE, PENDING, or under review.
                        </div>
                      )}
                    </div>

                    <div>
                      <Label>
                        SKU{" "}
                        <span className="text-zinc-400 font-normal">
                          {titleSkuLocked ? "(locked during review flow)" : ""}
                        </span>
                      </Label>
                      <Input
                        value={sku}
                        onChange={(e) => {
                          if (!canEditTitleSku) return;
                          const v = e.target.value;
                          setSku(v);
                          setSkuTouched(!!v.trim());
                        }}
                        disabled={!canEditTitleSku}
                        readOnly={!canEditTitleSku}
                        className={!canEditTitleSku ? "bg-zinc-100 text-zinc-500 cursor-not-allowed" : ""}
                        placeholder="e.g. AFRY-4L-BLK"
                      />
                      {titleSkuLocked && (
                        <div className="text-[11px] text-zinc-500 mt-1">
                          SKU is locked while this product is LIVE, PENDING, or under review.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <Label>{offersOnly ? "Base offer price (NGN) *" : "Base price (NGN) *"}</Label>
                      <Input
                        value={retailPrice}
                        onChange={onChangeBasePrice}
                        inputMode="decimal"
                        placeholder="e.g. 25000"
                        disabled={onboardingBlocked}
                      />

                      {!offersOnly && isReviewManaged && (
                        <div className="text-[11px] text-zinc-600 mt-1">
                          Approved: <b>{ngn.format(Number(activeBasePriceForDisplay ?? 0))}</b>
                        </div>
                      )}

                      {hasPendingBaseForUi && pendingBaseValue != null && (
                        <div className="text-[11px] text-amber-700 mt-1">
                          Pending approval price: <b>{ngn.format(pendingBaseValue)}</b>
                          {pendingBaseMatchesForm
                            ? " — this matches your current input."
                            : " — change the amount if you want to replace the pending request."}
                        </div>
                      )}

                      {pendingBaseMatchesForm && (
                        <div className="text-[11px] text-amber-700 mt-1">
                          This price is already pending approval. Saving again will not change the pending price unless you enter a different amount.
                        </div>
                      )}

                      {!offersOnly &&
                        isReviewManaged &&
                        pendingBasePatch?.basePrice != null &&
                        Number(pendingBasePatch.basePrice) !== Number(activeBasePriceForDisplay) && (
                          <div className="text-[11px] text-amber-700 mt-1">
                            Pending: <b>{ngn.format(Number(pendingBasePatch.basePrice ?? 0))}</b>
                          </div>
                        )}

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
                    </div>

                    <div>
                      <Label>Base quantity</Label>
                      <Input
                        value={availableQty}
                        onChange={(e) => setAvailableQty(e.target.value)}
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
                        />
                      </div>
                      <Select
                        value={categoryId}
                        onChange={(e) => setCategoryId(e.target.value)}
                        disabled={!canEditCore}
                        className={!canEditCore ? "bg-zinc-100 text-zinc-500" : ""}
                      >
                        <option value="">{categoriesQ.isLoading ? "Loading…" : "— Select category —"}</option>
                        {(categories as any[]).map((c: any) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>

                      {!offersOnly && isReviewManaged && (
                        <div className="text-[11px] text-amber-700 mt-1">
                          Category changes will update the pending submission, not the live product immediately.
                        </div>
                      )}
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
                      <Select
                        value={brandId}
                        onChange={(e) => setBrandId(e.target.value)}
                        disabled={!canEditCore}
                        className={!canEditCore ? "bg-zinc-100 text-zinc-500" : ""}
                      >
                        <option value="">{brandsQ.isLoading ? "Loading…" : "— Select brand —"}</option>
                        {(brands as any[]).map((b: any) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </Select>

                      {!offersOnly && isReviewManaged && (
                        <div className="text-[11px] text-amber-700 mt-1">
                          Brand changes will update the pending submission, not the live product immediately.
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <Label>Description *</Label>
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className={`min-h-[110px] ${!canEditCore ? "bg-zinc-100 text-zinc-500" : ""}`}
                      disabled={!canEditCore}
                      placeholder="Write a clear, detailed description…"
                    />
                  </div>

                  {!offersOnly && isReviewManaged && (
                    <div className="text-[11px] text-amber-700 mt-1">
                      Description edits are allowed, but they will go through approval before appearing live.
                    </div>
                  )}
                </div>
              </Card>

              <Card
                title="Shipping"
                subtitle={
                  offersOnly
                    ? "Shipping settings are read-only in offer mode."
                    : isReviewManaged
                      ? "Parcel details used with supplier shipping profile and rate cards. Shipping changes will update the pending submission."
                      : "Parcel details used with supplier shipping profile and rate cards."
                }
                className={onboardingBlocked ? "border-amber-200 bg-amber-50/30" : ""}
              >
                <div className="space-y-4">
                  {onboardingBlocked && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                      Shipping changes are locked until onboarding is complete.
                    </div>
                  )}

                  <div className="rounded-xl border bg-zinc-50 px-3 py-2 text-[12px] text-zinc-700">
                    This section does <b>not</b> directly set the shipping fee. It sets parcel characteristics
                    that work with your supplier shipping profile and rate cards.
                  </div>

                  <label
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm ${offersOnly || onboardingBlocked ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={freeShipping}
                      onChange={(e) => {
                        if (offersOnly || onboardingBlocked) return;
                        setFreeShipping(e.target.checked);
                      }}
                      disabled={offersOnly || onboardingBlocked}
                    />
                    Free shipping for this product
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <div>
                      <Label>Weight (grams)</Label>
                      <Input
                        value={weightGrams}
                        onChange={(e) => setWeightGrams(e.target.value)}
                        inputMode="numeric"
                        placeholder="e.g. 1200"
                        disabled={offersOnly || onboardingBlocked || freeShipping}
                      />
                    </div>

                    <div>
                      <Label>Length (cm)</Label>
                      <Input
                        value={lengthCm}
                        onChange={(e) => setLengthCm(e.target.value)}
                        inputMode="decimal"
                        placeholder="e.g. 25"
                        disabled={offersOnly || onboardingBlocked || freeShipping}
                      />
                    </div>

                    <div>
                      <Label>Width (cm)</Label>
                      <Input
                        value={widthCm}
                        onChange={(e) => setWidthCm(e.target.value)}
                        inputMode="decimal"
                        placeholder="e.g. 18"
                        disabled={offersOnly || onboardingBlocked || freeShipping}
                      />
                    </div>

                    <div>
                      <Label>Height (cm)</Label>
                      <Input
                        value={heightCm}
                        onChange={(e) => setHeightCm(e.target.value)}
                        inputMode="decimal"
                        placeholder="e.g. 12"
                        disabled={offersOnly || onboardingBlocked || freeShipping}
                      />
                    </div>

                    <div>
                      <Label>Shipping class</Label>
                      <Select
                        value={shippingClass}
                        onChange={(e) => {
                          if (offersOnly || onboardingBlocked) return;
                          setShippingClass(
                            (e.target.value || "") as "" | "STANDARD" | "FRAGILE" | "BULKY"
                          );
                        }}
                        disabled={offersOnly || onboardingBlocked || freeShipping}
                      >
                        <option value="">— Auto / standard —</option>
                        <option value="STANDARD">STANDARD</option>
                        <option value="FRAGILE">FRAGILE</option>
                        <option value="BULKY">BULKY</option>
                      </Select>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <label
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm ${offersOnly || onboardingBlocked || freeShipping
                        ? "opacity-60 cursor-not-allowed"
                        : "cursor-pointer"
                        }`}
                    >
                      <input
                        type="checkbox"
                        checked={isFragile}
                        onChange={(e) => {
                          if (offersOnly || onboardingBlocked || freeShipping) return;
                          setIsFragile(e.target.checked);
                        }}
                        disabled={offersOnly || onboardingBlocked || freeShipping}
                      />
                      Fragile
                    </label>

                    <label
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm ${offersOnly || onboardingBlocked || freeShipping
                        ? "opacity-60 cursor-not-allowed"
                        : "cursor-pointer"
                        }`}
                    >
                      <input
                        type="checkbox"
                        checked={isBulky}
                        onChange={(e) => {
                          if (offersOnly || onboardingBlocked || freeShipping) return;
                          setIsBulky(e.target.checked);
                        }}
                        disabled={offersOnly || onboardingBlocked || freeShipping}
                      />
                      Bulky
                    </label>
                  </div>

                  {!offersOnly && isReviewManaged && (
                    <div className="text-[11px] text-amber-700">
                      Shipping detail changes are review-managed and will update the pending submission.
                    </div>
                  )}
                </div>
              </Card>

              <Card
                title="Images"
                className={onboardingBlocked ? "border-amber-200 bg-amber-50/30" : ""}
                subtitle={
                  offersOnly
                    ? "Catalog images are read-only here."
                    : isReviewManaged
                      ? `Paste URLs or upload images (max ${MAX_IMAGES}). Image changes will update the pending submission.`
                      : `Paste URLs or upload images (max ${MAX_IMAGES}).`
                }
                right={
                  <label
                    className={`inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 cursor-pointer ${offersOnly || onboardingBlocked ? "opacity-60 pointer-events-none" : ""
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
                      disabled={offersOnly || onboardingBlocked}
                    />
                  </label>
                }
              >
                <div className="space-y-3">
                  {onboardingBlocked && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                      Image changes are locked until onboarding is complete.
                    </div>
                  )}

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

                    {!offersOnly && (
                      <div className="text-zinc-500">
                        Remaining slots: <b>{remainingSlots}</b>
                      </div>
                    )}
                  </div>

                  <div>
                    <Label>Image URLs (one per line)</Label>
                    <Textarea
                      value={imageUrls}
                      onChange={(e) => {
                        if (offersOnly || onboardingBlocked) return;
                        setErr(null);
                        const raw = parseUrlList(e.target.value);
                        const capped = limitImages(raw, MAX_IMAGES);
                        setImageUrls(capped.join("\n"));
                      }}
                      className="min-h-[90px] text-xs"
                      disabled={offersOnly || onboardingBlocked}
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
                                src={toPublicImageSrc(u) ?? ""}
                                alt=""
                                className="w-full h-full object-cover"
                                loading="lazy"
                                onError={(e) => {
                                  const img = e.currentTarget as HTMLImageElement;
                                  const current = img.getAttribute("data-try") ?? "";
                                  const list = imageSrcCandidates(u);
                                  const idx = current ? list.indexOf(current) : 0;
                                  const next = list[idx + 1];

                                  if (next) {
                                    img.src = next;
                                    img.setAttribute("data-try", next);
                                    img.style.display = "block";
                                    return;
                                  }

                                  img.style.display = "none";
                                }}
                              />

                              {!offersOnly && !onboardingBlocked && (
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

                        {!offersOnly &&
                          !onboardingBlocked &&
                          filePreviews
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

                  {!offersOnly && !onboardingBlocked && files.length > 0 && (
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
                subtitle={
                  offersOnly
                    ? "Catalog product attributes are read-only."
                    : isReviewManaged
                      ? "Optional details used for filtering and variant setup. Attribute changes will update the pending submission."
                      : "Optional details used for filtering and variant setup."
                }
                className={[
                  hasBaseComboConflict || flashBaseCombo ? "border-rose-300 ring-2 ring-rose-100" : "",
                  onboardingBlocked ? "border-amber-200 bg-amber-50/30" : "",
                ].join(" ")}
                right={
                  <div className="flex items-center gap-2 flex-wrap">
                    <AddNewLink
                      label="Add new attribute"
                      onClick={() => nav(goToCatalogRequests("attributes", "attribute"))}
                    />
                  </div>
                }
              >
                <div className="space-y-3">
                  {onboardingBlocked && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                      Attribute editing is locked until onboarding is complete.
                    </div>
                  )}

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
                        const v = String(getAttrVal(a.id) ?? "");
                        return (
                          <div key={a.id}>
                            <Label>{a.name}</Label>
                            <Input
                              value={v}
                              onChange={(e) => setAttr(a.id, e.target.value)}
                              disabled={!canEditAttributes}
                              placeholder={a.placeholder || `Enter ${a.name.toLowerCase()}…`}
                            />
                          </div>
                        );
                      }

                      if (a.type === "SELECT") {
                        const v = String(getAttrVal(a.id) ?? "");
                        const label = "add new " + a.name.toLowerCase();

                        return (
                          <div key={a.id}>
                            <div className="flex items-center justify-between mb-1">
                              <Label>{a.name}</Label>
                              <AddNewLink
                                label={label}
                                onClick={() =>
                                  nav(
                                    goToCatalogRequests("attribute-values", "value", {
                                      attributeId: String(a.id || ""),
                                    })
                                  )
                                }
                                title={`Request new values for ${a.name}`}
                              />
                            </div>

                            <Select
                              value={v}
                              onChange={(e) => setAttr(a.id, e.target.value)}
                              disabled={!canEditAttributes}
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

                      const arr = Array.isArray(getAttrVal(a.id)) ? (getAttrVal(a.id) as string[]) : [];
                      const label = "add new " + a.name.toLowerCase();

                      return (
                        <div key={a.id} className="sm:col-span-2 rounded-2xl border bg-white p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold text-zinc-700">{a.name}</div>
                            <AddNewLink
                              label={label}
                              onClick={() =>
                                nav(
                                  goToCatalogRequests("attribute-values", "value", {
                                    attributeId: String(a.id || ""),
                                  })
                                )
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
                                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs cursor-pointer ${checked
                                    ? "bg-zinc-900 text-white border-zinc-900"
                                    : "bg-white hover:bg-black/5"
                                    }`}
                                >
                                  <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={checked}
                                    onChange={() => {
                                      if (!canEditAttributes) return;
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

              <Card
                title="Variant combinations"
                className={onboardingBlocked ? "border-amber-200 bg-amber-50/30" : ""}
                subtitle={
                  offersOnly
                    ? "Set supplier-specific stock and price for each existing variant."
                    : isReviewManaged
                      ? "Review-managed listing: existing combos stay fixed here; qty updates are immediate, and price edits update the pending submission."
                      : "Add combinations of SELECT attributes with qty and price."
                }
                right={
                  <div className="flex gap-2 flex-wrap">
                    {!offersOnly && canAddNewCombos && (
                      <>
                        <button
                          type="button"
                          onClick={generateVariantMatrix}
                          disabled={
                            onboardingBlocked ||
                            !selectableAttrs.some((a: any) => String(selectedAttrs[a.id] ?? "").trim() !== "")
                          }
                          className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
                        >
                          Generate combo
                        </button>

                        <button
                          type="button"
                          onClick={addVariantRow}
                          disabled={onboardingBlocked || !selectableAttrs.length || !canAddNewCombos}
                          className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-60"
                        >
                          <Plus size={16} /> Add row
                        </button>
                      </>
                    )}

                    {offersOnly && (
                      <div className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700">
                        {variantRows.length} variant(s)
                      </div>
                    )}
                  </div>
                }
              >
                <div className="space-y-2">
                  {onboardingBlocked && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                      Variant quantity and pricing updates are locked until onboarding is complete.
                    </div>
                  )}

                  {!selectableAttrs.length && (
                    <div className="text-sm text-zinc-500">
                      No SELECT attributes available. Create SELECT attributes to enable variants.
                    </div>
                  )}

                  {!offersOnly && isReviewManaged && (
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12px] text-zinc-700">
                      Existing variant rows can still have stock updated immediately. Any review-managed price changes will be submitted through the approval flow.
                    </div>
                  )}

                  {variantRows.map((row) => {
                    const isDup = duplicateRowIds.has(row.id);
                    const isBaseConflict = baseComboConflictRowIds.has(row.id);
                    const isFlashing = flashVariantRowId === row.id;
                    const isEditing =
                      editingVariantRowId === row.id &&
                      !offersOnly &&
                      !isReviewManaged &&
                      !row.isExisting &&
                      !onboardingBlocked;

                    const variantPriceNum = toMoneyNumber(row.unitPrice);
                    const effectiveVariantPrice = offersOnly
                      ? Number(row.activeUnitPrice ?? activeBasePriceForDisplay)
                      : variantPriceNum > 0
                        ? variantPriceNum
                        : toMoneyNumber(retailPrice);

                    const label = row.comboLabel || getVariantRowLabel(row);
                    const rowQty = toIntNonNeg(row.availableQty);

                    const pendingVar = row.variantId
                      ? pendingVariantPatchByVariantId.get(String(row.variantId))
                      : null;

                    const pendingPatch = pendingVar?.proposedPatch ?? pendingVar?.patchJson ?? null;
                    const pendingVarUnitPrice = Number(pendingPatch?.unitPrice ?? NaN);

                    const hasPendingVarPrice =
                      offersOnly &&
                      Number.isFinite(pendingVarUnitPrice) &&
                      pendingVarUnitPrice > 0 &&
                      pendingVarUnitPrice !== Number(row.activeUnitPrice ?? activeBasePriceForDisplay);

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
                                Qty: <b>{rowQty || 0}</b> · Price:{" "}
                                <b>{row.unitPrice ? ngn.format(effectiveVariantPrice) : "—"}</b>
                              </div>

                              {!offersOnly &&
                                isLive &&
                                row.variantId &&
                                pendingProductVariantPatchByVariantId.get(String(row.variantId))?.unitPrice != null &&
                                Number(
                                  pendingProductVariantPatchByVariantId.get(String(row.variantId))?.unitPrice
                                ) !== Number(row.activeUnitPrice ?? effectiveVariantPrice) && (
                                  <div className="text-[11px] text-amber-700 mt-1">
                                    Pending variant:{" "}
                                    <b>
                                      {ngn.format(
                                        Number(
                                          pendingProductVariantPatchByVariantId.get(String(row.variantId))
                                            ?.unitPrice ?? 0
                                        )
                                      )}
                                    </b>
                                  </div>
                                )}

                              {offersOnly && hasPendingVarPrice && (
                                <div className="text-[11px] text-amber-700 mt-1">
                                  Requested variant: <b>{ngn.format(pendingVarUnitPrice)}</b> (pending)
                                </div>
                              )}

                              {(isDup || isBaseConflict) && (
                                <div className="text-[12px] text-rose-700 mt-2">
                                  {isDup ? "Duplicate variant combination." : null}
                                  {isDup && isBaseConflict ? " " : null}
                                  {isBaseConflict ? "This VariantCombo matches your BaseCombo." : null}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                              {offersOnly || isReviewManaged || row.isExisting ? (
                                <>
                                  <span className="text-xs text-zinc-500">Price</span>
                                  <Input
                                    value={row.unitPrice}
                                    onChange={(e) => updateVariantPrice(row.id, e.target.value)}
                                    inputMode="decimal"
                                    className="w-28 text-xs"
                                    placeholder="e.g. 25000"
                                    disabled={onboardingBlocked}
                                  />

                                  <span className="text-xs text-zinc-500">Qty</span>
                                  <Input
                                    value={row.availableQty}
                                    onChange={(e) => updateVariantQty(row.id, e.target.value)}
                                    inputMode="numeric"
                                    className="w-24 text-xs"
                                    placeholder="e.g. 5"
                                    disabled={onboardingBlocked}
                                  />
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setErr(null);
                                    setEditingVariantRowId(row.id);
                                  }}
                                  disabled={onboardingBlocked}
                                  className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-60"
                                >
                                  Edit combo
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => removeVariantRow(row.id)}
                                disabled={onboardingBlocked}
                                className="inline-flex items-center gap-2 rounded-xl border bg-rose-50 text-rose-700 px-3 py-2 text-sm font-semibold hover:bg-rose-100 disabled:opacity-60"
                              >
                                <Trash2 size={14} /> {offersOnly ? "Remove offer" : "Remove"}
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
                              className="inline-flex items-center gap-2 rounded-xl border bg-zinc-900 text-white px-3 py-2 text-sm font-semibold disabled:opacity-60"
                            >
                              Save combo
                            </button>

                            <button
                              type="button"
                              onClick={() => setEditingVariantRowId(null)}
                              disabled={onboardingBlocked}
                              className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-60"
                            >
                              Done
                            </button>

                            <button
                              type="button"
                              onClick={() => removeVariantRow(row.id)}
                              disabled={onboardingBlocked}
                              className="inline-flex items-center gap-2 rounded-xl border bg-rose-50 text-rose-700 px-3 py-2 text-sm font-semibold hover:bg-rose-100 disabled:opacity-60"
                            >
                              <Trash2 size={14} /> Remove
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 items-start">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {selectableAttrs.map((attr: any) => {
                              const valueId = row.selections[attr.id] || "";
                              const label = "add new " + attr.name.toLowerCase();

                              return (
                                <div key={attr.id}>
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="text-[11px] font-semibold text-zinc-600">{attr.name}</div>
                                    <AddNewLink
                                      label={label}
                                      onClick={() =>
                                        nav(
                                          goToCatalogRequests("attribute-values", "value", {
                                            attributeId: String(attr.id || ""),
                                          })
                                        )
                                      }
                                      title={`Request new values for ${attr.name}`}
                                    />
                                  </div>

                                  <Select
                                    value={valueId}
                                    onChange={(e) => updateVariantSelection(row.id, attr.id, e.target.value)}
                                    disabled={onboardingBlocked}
                                    className={isBaseConflict || isFlashing ? "border-rose-300" : ""}
                                  >
                                    <option value="">Select…</option>
                                    {(attr.values || []).map((v: any) => (
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
                              <div className="text-[11px] font-semibold text-zinc-600 mb-1">
                                Variant price (NGN)
                              </div>
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
                    <div className="text-sm text-zinc-500">No variant rows found for this product.</div>
                  )}
                </div>
              </Card>

              <div className="hidden sm:block">
                <button
                  type="button"
                  disabled={submitDisabled}
                  onClick={doSave}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-white px-4 py-3 text-sm font-semibold disabled:opacity-60"
                >
                  {offersOnly ? <Link2 size={16} /> : <Save size={16} />}
                  {onboardingBlocked ? "Onboarding required" : saveButtonLabel}
                </button>
              </div>
            </div>

            <div className="hidden lg:block space-y-4">
              <Card title="Submission summary" subtitle="What will be sent to the backend">
                <div className="text-sm text-zinc-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Flow</span>
                    <b className="text-zinc-900">
                      {offersOnly
                        ? "Attach existing product"
                        : isPendingReview
                          ? "Update pending submission"
                          : isRejected
                            ? "Resubmit for approval"
                            : isReviewManaged
                              ? "Review-managed product"
                              : "Edit product"}
                    </b>
                  </div>

                  {!offersOnly ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Title</span>
                        <b className="text-zinc-900 truncate max-w-[180px]">{title.trim() ? title.trim() : "—"}</b>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Base price</span>
                        <b className="text-zinc-900">
                          {retailPrice ? ngn.format(toMoneyNumber(retailPrice)) : "—"}
                        </b>
                      </div>

                      {!offersOnly && isLive && (
                        <div className="text-[11px] text-zinc-600 mt-1">
                          Active (approved): <b>{ngn.format(Number(activeBasePriceForDisplay ?? 0))}</b>
                        </div>
                      )}

                      {!offersOnly &&
                        isLive &&
                        pendingProductPatch?.basePrice != null &&
                        Number(pendingProductPatch.basePrice) !== Number(activeBasePriceForDisplay) && (
                          <div className="text-[11px] text-amber-700 mt-1">
                            Pending: <b>{ngn.format(Number(pendingProductPatch.basePrice ?? 0))}</b>
                          </div>
                        )}

                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">SKU</span>
                        <b className="text-zinc-900 truncate max-w-[180px]">{sku.trim() ? sku.trim() : "—"}</b>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500 inline-flex items-center gap-2">
                          <Package size={14} /> Stock
                        </span>
                        <b className={inStockPreview ? "text-emerald-700" : "text-rose-700"}>
                          {totalQty} ({inStockPreview ? "In stock" : "Out of stock"})
                        </b>
                      </div>



                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Shipping</span>
                        <b className="text-zinc-900">
                          {freeShipping
                            ? "Free shipping"
                            : shippingClass || weightGrams || lengthCm || widthCm || heightCm
                              ? "Parcel configured"
                              : "Default / blank"}
                        </b>
                      </div>

                      {!freeShipping && !offersOnly && (
                        <div className="text-[11px] text-zinc-600">
                          Weight: <b>{weightGrams || "—"}</b>g • Class: <b>{shippingClass || "AUTO"}</b>
                        </div>
                      )}


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
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Selected product</span>
                        <b className="text-zinc-900 truncate max-w-[180px]">{title || "—"}</b>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Existing SKU</span>
                        <b className="text-zinc-900 truncate max-w-[180px]">{sku || "—"}</b>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Base offer</span>
                        <b className="text-zinc-900">
                          {retailPrice ? ngn.format(toMoneyNumber(retailPrice)) : "—"}
                        </b>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Total qty</span>
                        <b className={totalQty > 0 ? "text-emerald-700" : "text-rose-700"}>{totalQty}</b>
                      </div>

                      <div className="text-[11px] text-zinc-600">
                        Base: <b>{baseQtyPreview}</b> • Variants total: <b>{variantQtyTotal}</b>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Variant offers</span>
                        <b className="text-zinc-900">{variantRows.length}</b>
                      </div>

                      {offersOnly && hasPendingBase && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-[11px]">
                          Pending approval: <b>{ngn.format(Number(pendingBasePatch?.basePrice ?? 0))}</b>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </Card>

              <button
                type="button"
                disabled={submitDisabled}
                onClick={doSave}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-white px-4 py-3 text-sm font-semibold disabled:opacity-60"
              >
                {offersOnly ? <Link2 size={16} /> : <Save size={16} />}
                {onboardingBlocked ? "Onboarding required" : saveButtonLabel}
              </button>

              {offersOnly && detailQ.data && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 size={16} />
                    Existing product mode
                  </div>
                  <div className="mt-2 text-xs">
                    Core product details stay read-only here. You are only updating supplier-specific offer and stock.
                  </div>
                </div>
              )}

              {onboardingBlocked && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Complete onboarding first to unlock editing on this page.
                </div>
              )}
            </div>
          </div>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );

}
