import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Package,
  Plus,
  Search,
  SlidersHorizontal,
  Pencil,
  Trash2,
  ChevronsLeft,
  ChevronsRight,
  BadgeCheck,
  ShieldCheck,
  MapPin,
  FileText,
  Lock,
  CheckCircle2,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { useCatalogMeta } from "../../hooks/useCatalogMeta";

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

type SupplierProductListItem = {
  id: string;
  title: string;
  sku: string;
  basePrice: number;
  status: string;
  inStock: boolean;
  imagesJson: string[];
  createdAt: string;
  updatedAt?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  availableQty?: number;

  offerIsActive?: boolean;
  isLowStock?: boolean;
  isDerived?: boolean;

  hasPendingChanges?: boolean;
  moderationStatus?: "PENDING" | "APPROVED" | "REJECTED" | null;
  moderationMessage?: string | null;
  moderationReviewedAt?: string | null;
};

type DeleteEligibility = {
  canDelete: boolean;
  reason?: string | null;
  ownedBySupplier?: boolean;
  hasOrders?: boolean;
  hasOtherSupplierOffers?: boolean;
};

type SupplierDocumentLite = {
  kind?: string | null;
  status?: string | null;
};

type AuthMeLite = {
  emailVerified?: boolean | null;
  phoneVerified?: boolean | null;
  emailVerifiedAt?: string | null;
  phoneVerifiedAt?: string | null;
};

type SupplierMeLite = {
  legalName?: string | null;
  registrationType?: string | null;
  registrationCountryCode?: string | null;
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

type ProductSortBy = "title" | "status" | "basePrice" | "updatedAt";
type SortDir = "asc" | "desc";

function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning" | "danger" | "success" | "info";
  className?: string;
}) {
  const cls =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "info"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : "border-zinc-200 bg-zinc-50 text-zinc-700";

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] border leading-4 ${cls} ${className}`}
    >
      {children}
    </span>
  );
}

const ADMIN_SUPPLIER_KEY = "adminSupplierId";
const PAGE_SIZE_OPTIONS = [12, 24, 48, 96];

function normStr(v: any) {
  return String(v ?? "").trim();
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

function isTruthyVerificationFlag(value: unknown) {
  if (value === true) return true;
  if (typeof value === "string" && value.trim()) return true;
  return false;
}

function isEmailVerified(authMe?: AuthMeLite | null) {
  return (
    isTruthyVerificationFlag(authMe?.emailVerified) ||
    isTruthyVerificationFlag(authMe?.emailVerifiedAt)
  );
}

function isPhoneVerified(authMe?: AuthMeLite | null) {
  return (
    isTruthyVerificationFlag(authMe?.phoneVerified) ||
    isTruthyVerificationFlag(authMe?.phoneVerifiedAt)
  );
}

function getSupplierNextPath(stage: {
  contactDone: boolean;
  businessDone: boolean;
  addressDone: boolean;
  docsDone: boolean;
}) {
  if (!stage.contactDone) return "/supplier/verify-contact";
  if (!stage.businessDone) return "/supplier/onboarding";
  if (!stage.addressDone) return "/supplier/onboarding/address";
  if (!stage.docsDone) return "/supplier/onboarding/documents";
  return "/supplier";
}

function fmtDateTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDateShort(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ModerationPanel({
  item,
  compact = false,
}: {
  item: SupplierProductListItem;
  compact?: boolean;
}) {
  const status = item.moderationStatus ?? null;
  const message = String(item.moderationMessage ?? "").trim();
  const reviewedAt = fmtDateTime(item.moderationReviewedAt);

  if (status === "REJECTED" && message) {
    return (
      <div
        className={`rounded-2xl border border-rose-200 bg-rose-50 ${
          compact ? "px-2.5 py-2" : "px-3 py-2.5"
        }`}
      >
        <div className="text-[10px] font-semibold text-rose-800">
          Product change rejected
        </div>
        <div className="mt-1 text-[10px] leading-snug text-rose-700 line-clamp-3">
          {message}
        </div>
        {reviewedAt !== "—" ? (
          <div className="mt-1 text-[10px] text-rose-600">Reviewed {reviewedAt}</div>
        ) : null}
      </div>
    );
  }

  if (status === "PENDING" || item.hasPendingChanges) {
    return (
      <div
        className={`rounded-2xl border border-amber-200 bg-amber-50 ${
          compact ? "px-2.5 py-2" : "px-3 py-2.5"
        }`}
      >
        <div className="text-[10px] font-semibold text-amber-800">
          Awaiting admin review
        </div>
        <div className="mt-1 text-[10px] leading-snug text-amber-700 line-clamp-2">
          Your latest product changes are pending approval.
        </div>
      </div>
    );
  }

  return <div className="text-[10px] text-zinc-500">—</div>;
}

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);

  return debounced;
}

function PaginationBar({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (next: number) => void;
  onPageSizeChange: (next: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-[12px] sm:text-sm text-zinc-600">
        Showing <span className="font-semibold text-zinc-900">{from}</span>–
        <span className="font-semibold text-zinc-900">{to}</span> of{" "}
        <span className="font-semibold text-zinc-900">{total}</span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <span className="text-[12px] sm:text-sm text-zinc-600">Rows</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded-xl border bg-white px-3 py-2 text-[12px] sm:text-sm"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={page <= 1}
            className="inline-flex items-center justify-center rounded-xl border bg-white px-3 py-2 text-sm disabled:opacity-40"
            aria-label="First page"
          >
            <ChevronsLeft size={16} />
          </button>

          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="inline-flex items-center justify-center rounded-xl border bg-white px-3 py-2 text-sm disabled:opacity-40"
            aria-label="Previous page"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="min-w-[84px] text-center text-[12px] sm:text-sm text-zinc-700">
            Page <span className="font-semibold">{page}</span> of{" "}
            <span className="font-semibold">{Math.max(1, pageCount)}</span>
          </div>

          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount}
            className="inline-flex items-center justify-center rounded-xl border bg-white px-3 py-2 text-sm disabled:opacity-40"
            aria-label="Next page"
          >
            <ArrowRight size={16} />
          </button>

          <button
            type="button"
            onClick={() => onPageChange(pageCount)}
            disabled={page >= pageCount}
            className="inline-flex items-center justify-center rounded-xl border bg-white px-3 py-2 text-sm disabled:opacity-40"
            aria-label="Last page"
          >
            <ChevronsRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SortButton({
  label,
  active,
  dir,
  onClick,
  className = "",
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 hover:text-zinc-900 ${className}`}
    >
      {label}
      {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
    </button>
  );
}

export default function SupplierProductsPage() {
  const hydrated = useAuthStore((s: any) => s.hydrated) as boolean;
  const roleRaw = useAuthStore((s: any) => s.user?.role);
  const role = normRole(roleRaw);
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const isSupplier = role === "SUPPLIER";

  const nav = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const urlSupplierId = useMemo(() => {
    const v = normStr(searchParams.get("supplierId"));
    return v || undefined;
  }, [searchParams]);

  const storedSupplierId = useMemo(() => {
    const v = normStr(localStorage.getItem(ADMIN_SUPPLIER_KEY));
    return v || undefined;
  }, []);

  const adminSupplierId = isAdmin ? urlSupplierId ?? storedSupplierId : undefined;

  useEffect(() => {
    if (!isAdmin) return;

    const fromUrl = normStr(searchParams.get("supplierId"));
    const fromStore = normStr(localStorage.getItem(ADMIN_SUPPLIER_KEY));

    if (fromUrl) {
      if (fromUrl !== fromStore) localStorage.setItem(ADMIN_SUPPLIER_KEY, fromUrl);
      return;
    }

    if (fromStore) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("supplierId", fromStore);
          return next;
        },
        { replace: true }
      );
    }
  }, [isAdmin, searchParams, setSearchParams]);

  const withSupplierCtx = (to: string) => {
    if (!isAdmin || !adminSupplierId) return to;
    const sep = to.includes("?") ? "&" : "?";
    return `${to}${sep}supplierId=${encodeURIComponent(adminSupplierId)}`;
  };

  const onboardingQ = useQuery({
    queryKey: ["supplier", "products", "onboarding-state"],
    enabled: hydrated && isSupplier,
    queryFn: async () => {
      const [authRes, supplierRes, docsRes] = await Promise.all([
        api.get("/api/auth/me", { withCredentials: true }),
        api.get("/api/supplier/me", { withCredentials: true }),
        api
          .get("/api/supplier/documents", { withCredentials: true })
          .catch(() => ({ data: { data: [] } })),
      ]);

      const authPayload = authRes.data as any;
      const authMe = (
        authPayload?.data?.user ??
        authPayload?.user ??
        authPayload?.data ??
        authPayload ??
        {}
      ) as AuthMeLite;

      const supplierMe = ((supplierRes.data as any)?.data ??
        supplierRes.data ??
        {}) as SupplierMeLite;

      const docsRaw = (docsRes as any)?.data?.data ?? (docsRes as any)?.data ?? [];
      const docs = Array.isArray(docsRaw) ? (docsRaw as SupplierDocumentLite[]) : [];

      const contactDone = isEmailVerified(authMe) && isPhoneVerified(authMe);

      const businessDone = Boolean(
        String(supplierMe?.legalName ?? "").trim() &&
          String(supplierMe?.registrationType ?? "").trim() &&
          String(supplierMe?.registrationCountryCode ?? "").trim()
      );

      const addressDone =
        hasAddress(supplierMe?.registeredAddress) || hasAddress(supplierMe?.pickupAddress);

      const requiredKinds = [
        ...(isRegisteredBusiness(supplierMe?.registrationType)
          ? ["BUSINESS_REGISTRATION_CERTIFICATE"]
          : []),
        "GOVERNMENT_ID",
        "PROOF_OF_ADDRESS",
      ];

      const docsDone = requiredKinds.every((kind) => docSatisfied(docs, kind));

      const nextPath = getSupplierNextPath({
        contactDone,
        businessDone,
        addressDone,
        docsDone,
      });

      return {
        contactDone,
        businessDone,
        addressDone,
        docsDone,
        onboardingDone: contactDone && businessDone && addressDone && docsDone,
        nextPath,
      };
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const onboarding = onboardingQ.data;
  const supplierLocked = isSupplier && !!onboarding && !onboarding.onboardingDone;

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<
    "ANY" | "PENDING" | "LIVE" | "APPROVED" | "REJECTED" | "PUBLISHED"
  >("ANY");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);

  const [sortBy, setSortBy] = useState<ProductSortBy>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { categories, brands } = useCatalogMeta({ enabled: hydrated && !supplierLocked });
  const debouncedQ = useDebouncedValue(q, 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, status, categoryId, brandId, adminSupplierId, sortBy, sortDir]);

  const productsQ = useQuery({
    queryKey: [
      "supplier",
      "products",
      {
        q: debouncedQ,
        status,
        categoryId,
        brandId,
        supplierId: adminSupplierId,
        page,
        pageSize,
        sortBy,
        sortDir,
      },
    ],
    enabled: hydrated && !supplierLocked && (!isAdmin || !!adminSupplierId),
    queryFn: async () => {
      const skip = (page - 1) * pageSize;
      const { data } = await api.get<{
        data: SupplierProductListItem[];
        total: number;
        meta?: { lowStockThreshold?: number };
      }>("/api/supplier/products", {
        withCredentials: true,
        params: {
          q: debouncedQ.trim() || undefined,
          status,
          categoryId: categoryId || undefined,
          brandId: brandId || undefined,
          take: pageSize,
          skip,
          sortBy,
          sortDir,
          supplierId: adminSupplierId,
        },
      });
      return data;
    },
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    retry: 1,
    placeholderData: (prev) => prev,
  });

  const lowStockThreshold = productsQ.data?.meta?.lowStockThreshold ?? 3;
  const total = Number(productsQ.data?.total ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [categories]);

  const brandNameById = useMemo(() => {
    const m = new Map<string, string>();
    brands.forEach((b) => m.set(b.id, b.name));
    return m;
  }, [brands]);

  const items = productsQ.data?.data ?? [];

  const rejectedCount = useMemo(
    () => items.filter((p) => p.moderationStatus === "REJECTED").length,
    [items]
  );

  const pendingCount = useMemo(
    () =>
      items.filter(
        (p) => p.moderationStatus === "PENDING" || p.hasPendingChanges === true
      ).length,
    [items]
  );

  const fmtPrice = (n: any) => {
    const x = Number(n);
    return Number.isFinite(x) ? x.toLocaleString("en-NG") : "—";
  };

  const eligQ = useQuery({
    queryKey: [
      "supplier",
      "products",
      "delete-eligibility",
      { ids: items.map((x) => x.id), supplierId: adminSupplierId, page, pageSize },
    ],
    enabled: hydrated && !supplierLocked && items.length > 0 && (!isAdmin || !!adminSupplierId),
    queryFn: async () => {
      const ids = items.map((x) => x.id).join(",");
      const { data } = await api.get("/api/supplier/products/delete-eligibility", {
        withCredentials: true,
        params: { ids, supplierId: adminSupplierId },
      });
      return ((data as any)?.data ?? {}) as Record<string, DeleteEligibility>;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });

  const canDeleteOf = (productId: string) => {
    const row = (eligQ.data || {})[productId] as DeleteEligibility | undefined;
    return { canDelete: !!row?.canDelete, reason: row?.reason ?? null };
  };

  const deleteM = useMutation({
    mutationFn: async (productId: string) => {
      const { data } = await api.delete(`/api/supplier/products/${productId}`, {
        withCredentials: true,
        params: { supplierId: adminSupplierId },
      });
      return (data as any)?.data ?? data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["supplier", "products"] });
      await qc.invalidateQueries({
        queryKey: ["supplier", "products", "delete-eligibility"],
      });
    },
    onError: (e: any) => {
      const msg =
        e?.response?.data?.userMessage ||
        e?.response?.data?.error ||
        e?.message ||
        "Failed to delete product.";
      window.alert(msg);
    },
  });

  const confirmAndDelete = async (p: SupplierProductListItem) => {
    const { canDelete, reason } = canDeleteOf(p.id);

    if (!canDelete) {
      window.alert(reason || "This product cannot be deleted.");
      return;
    }

    const ok = window.confirm(`Delete "${p.title}"?\n\nThis cannot be undone.`);
    if (!ok) return;

    deleteM.mutate(p.id);
  };

  const goEdit = async (productId: string) => {
    qc.invalidateQueries({ queryKey: ["supplier", "product", productId] });
    try {
      await qc.prefetchQuery({
        queryKey: ["supplier", "product", productId],
        queryFn: async () => {
          const { data } = await api.get(`/api/supplier/products/${productId}`, {
            withCredentials: true,
            params: { supplierId: adminSupplierId },
          });
          return (data as any)?.data ?? (data as any);
        },
        staleTime: 0,
      });
    } catch {
      //
    }
    nav(withSupplierCtx(`/supplier/products/${productId}/edit`));
  };

  const toggleSort = (field: ProductSortBy) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "status" || field === "title" ? "asc" : "desc");
  };

  const onboardingItems = useMemo(
    () => [
      {
        key: "contact",
        label: "Contact verification",
        done: !!onboarding?.contactDone,
        path: "/supplier/verify-contact",
        icon: <BadgeCheck size={16} />,
      },
      {
        key: "business",
        label: "Business details",
        done: !!onboarding?.businessDone,
        path: "/supplier/onboarding",
        icon: <ShieldCheck size={16} />,
      },
      {
        key: "address",
        label: "Address details",
        done: !!onboarding?.addressDone,
        path: "/supplier/onboarding/address",
        icon: <MapPin size={16} />,
      },
      {
        key: "documents",
        label: "Documents",
        done: !!onboarding?.docsDone,
        path: "/supplier/onboarding/documents",
        icon: <FileText size={16} />,
      },
    ],
    [onboarding]
  );

  return (
    <SiteLayout>
      <SupplierLayout>
        {isAdmin && !adminSupplierId && (
          <div className="mt-4 sm:mt-6 rounded-2xl border bg-amber-50 text-amber-900 border-amber-200 p-4 text-sm">
            Select a supplier on the dashboard first (Admin view) to inspect their
            products.
            <Link to="/supplier" className="ml-2 underline font-semibold">
              Go to dashboard
            </Link>
          </div>
        )}

        {supplierLocked ? (
          <>
            <div className="relative overflow-hidden rounded-3xl mt-4 sm:mt-6 border">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700" />
              <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,0,167,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,204,255,0.25),transparent_60%)]" />
              <div className="relative px-4 sm:px-6 md:px-8 py-6 sm:py-8 text-white">
                <motion.h1
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-[20px] sm:text-2xl md:text-3xl font-bold tracking-tight leading-tight"
                >
                  Products locked until onboarding is complete
                </motion.h1>

                <p className="mt-1 text-[13px] sm:text-sm text-white/80 leading-snug">
                  Finish the remaining supplier onboarding steps before you can add, edit or
                  manage products.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    to={onboarding?.nextPath || "/supplier/verify-contact"}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-white text-zinc-900 px-3 py-2 text-[12px] sm:px-4 sm:py-2 sm:text-sm font-semibold hover:opacity-95"
                  >
                    Continue onboarding <ArrowRight size={14} />
                  </Link>

                  <Link
                    to="/supplier"
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-2 text-[12px] sm:px-4 sm:py-2 sm:text-sm font-semibold hover:bg-white/15"
                  >
                    Back to overview <ArrowLeft size={14} />
                  </Link>
                </div>

                {onboardingQ.isFetching ? (
                  <div className="mt-3 text-[12px] text-white/80">Checking onboarding status…</div>
                ) : (
                  <div className="mt-3 text-[12px] text-white/90">
                    Product access unlocks after contact, business, address and documents are
                    completed.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 sm:mt-6 grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
              <Card className="lg:col-span-2">
                <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70">
                  <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">
                    Required steps before product access
                  </div>
                  <div className="text-[11px] sm:text-xs text-zinc-500">
                    Complete each step to unlock product management
                  </div>
                </div>

                <div className="p-4 sm:p-5 space-y-3">
                  {onboardingItems.map((item) => (
                    <div
                      key={item.key}
                      className="flex flex-col gap-3 rounded-2xl border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${
                            item.done
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {item.done ? <CheckCircle2 size={17} /> : item.icon}
                        </div>

                        <div>
                          <div className="text-sm font-semibold text-zinc-900">{item.label}</div>
                          <div className="text-[12px] text-zinc-500">
                            {item.done ? "Completed" : "Still required"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            item.done
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {item.done ? "Done" : "Pending"}
                        </span>

                        {!item.done && (
                          <Link
                            to={item.path}
                            className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-[12px] font-semibold hover:bg-black/5"
                          >
                            Open step <ArrowRight size={14} />
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70">
                  <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">
                    Locked on this page
                  </div>
                  <div className="text-[11px] sm:text-xs text-zinc-500">
                    These product actions are unavailable for now
                  </div>
                </div>

                <div className="p-4 sm:p-5 space-y-3">
                  {[
                    "Add products",
                    "Edit listings",
                    "Delete listings",
                    "Manage stock",
                    "Manage pricing",
                  ].map((label) => (
                    <div
                      key={label}
                      className="flex items-center gap-3 rounded-xl border bg-zinc-50 px-3 py-3 text-sm text-zinc-700"
                    >
                      <Lock size={15} className="shrink-0 text-zinc-500" />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-3xl mt-4 sm:mt-6 border">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700" />
              <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,0,167,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,204,255,0.25),transparent_60%)]" />
              <div className="relative px-4 sm:px-6 md:px-8 py-6 sm:py-8 text-white">
                <motion.h1
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-[20px] sm:text-2xl md:text-3xl font-bold tracking-tight leading-tight"
                >
                  Products
                </motion.h1>

                <p className="mt-1 text-[13px] sm:text-sm text-white/80 leading-snug">
                  Manage listings, stock, pricing and visibility.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge tone="info">{total} listing(s)</Badge>
                  {pendingCount > 0 && <Badge tone="warning">{pendingCount} pending review</Badge>}
                  {rejectedCount > 0 && <Badge tone="danger">{rejectedCount} rejected</Badge>}
                </div>

                <div className="mt-4 grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                  <Link
                    to={withSupplierCtx("/supplier/products/add")}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-white text-zinc-900 px-3 py-2 text-[12px] sm:px-4 sm:py-2 sm:text-sm font-semibold hover:opacity-95"
                  >
                    <Plus size={14} /> Add
                  </Link>
                  <Link
                    to={withSupplierCtx("/supplier")}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-2 text-[12px] sm:px-4 sm:py-2 sm:text-sm font-semibold hover:bg-white/15"
                  >
                    Dashboard <ArrowRight size={14} />
                  </Link>
                </div>

                {!hydrated ? (
                  <div className="mt-3 text-[12px] text-white/80">Loading session…</div>
                ) : productsQ.isFetching && !productsQ.data ? (
                  <div className="mt-3 text-[12px] text-white/80">Loading products…</div>
                ) : productsQ.isError ? (
                  <div className="mt-3 text-[12px] text-white/90">
                    Failed to load products.{" "}
                    <button className="underline" onClick={() => productsQ.refetch()}>
                      Retry
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-4 sm:mt-6 grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
              <Card className="lg:col-span-2">
                <div className="p-3 sm:p-5 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                  <div className="relative w-full">
                    <Search
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                      size={16}
                    />
                    <input
                      placeholder="Search name, SKU…"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      className="w-full rounded-2xl border bg-white pl-9 pr-4 py-2.5 sm:py-3 text-[13px] sm:text-sm outline-none focus:ring-4 focus:ring-fuchsia-100 focus:border-fuchsia-400 transition"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowFilters((v) => !v)}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border bg-white px-4 py-2.5 sm:py-3 text-[13px] sm:text-sm hover:bg-black/5"
                  >
                    <SlidersHorizontal size={16} /> {showFilters ? "Hide filters" : "Filters"}
                  </button>
                </div>

                <div className={`${showFilters ? "block" : "hidden"} sm:block`}>
                  <div className="px-3 sm:px-5 pb-4 sm:pb-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as any)}
                      className="w-full rounded-2xl border bg-white px-4 py-2.5 sm:py-3 text-[13px] sm:text-sm"
                    >
                      <option value="ANY">Any status</option>
                      <option value="PENDING">PENDING</option>
                      <option value="LIVE">LIVE</option>
                      <option value="APPROVED">APPROVED</option>
                      <option value="PUBLISHED">PUBLISHED</option>
                      <option value="REJECTED">REJECTED</option>
                    </select>

                    <select
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="w-full rounded-2xl border bg-white px-4 py-2.5 sm:py-3 text-[13px] sm:text-sm"
                    >
                      <option value="">All categories</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={brandId}
                      onChange={(e) => setBrandId(e.target.value)}
                      className="w-full rounded-2xl border bg-white px-4 py-2.5 sm:py-3 text-[13px] sm:text-sm"
                    >
                      <option value="">All brands</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="p-4 sm:p-5 flex items-center gap-3">
                  <div className="inline-grid place-items-center w-10 h-10 rounded-2xl bg-zinc-900/5 text-zinc-800">
                    <Package size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] sm:text-xs text-zinc-500">Review visibility</div>
                    <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">
                      Rejections now show here
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      Suppliers can see why a product or change was rejected.
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            <div className="mt-4">
              <Card>
                <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70">
                  <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">
                    Your listings
                  </div>
                  <div className="mt-2">
                    <PaginationBar
                      page={page}
                      pageCount={pageCount}
                      total={total}
                      pageSize={pageSize}
                      onPageChange={(next) => setPage(Math.max(1, Math.min(pageCount, next)))}
                      onPageSizeChange={(next) => {
                        setPageSize(next);
                        setPage(1);
                      }}
                    />
                  </div>
                </div>

                <div className="p-3 sm:hidden">
                  {productsQ.isLoading ? (
                    <div className="text-sm text-zinc-600 p-3">Loading…</div>
                  ) : productsQ.isError ? (
                    <div className="text-sm text-rose-700 p-3">
                      Failed to load products.{" "}
                      <button className="underline" onClick={() => productsQ.refetch()}>
                        Retry
                      </button>
                    </div>
                  ) : items.length === 0 ? (
                    <div className="py-10 text-center text-zinc-500 text-sm">
                      No products yet.{" "}
                      <Link className="underline" to={withSupplierCtx("/supplier/products/add")}>
                        Add one
                      </Link>
                      .
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {items.map((p) => {
                        const img = (p.imagesJson || [])[0] || "/placeholder.svg";
                        const cat = p.categoryId
                          ? categoryNameById.get(p.categoryId) ?? "—"
                          : "—";
                        const br = p.brandId ? brandNameById.get(p.brandId) ?? "—" : "—";
                        const low =
                          typeof p.availableQty === "number" &&
                          p.availableQty <= lowStockThreshold;
                        const del = canDeleteOf(p.id);
                        const modifiedAt = p.updatedAt ?? p.createdAt;

                        return (
                          <div key={p.id} className="rounded-2xl border bg-white p-3">
                            <div className="flex gap-3">
                              <div className="w-16 h-16 rounded-2xl border bg-zinc-50 overflow-hidden shrink-0">
                                <img
                                  src={img}
                                  alt={p.title}
                                  className="w-full h-full object-cover"
                                  onError={(e) => (e.currentTarget.style.opacity = "0.25")}
                                />
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="font-semibold text-[13px] text-zinc-900 line-clamp-2">
                                  {p.title}
                                </div>
                                <div className="mt-1 text-[11px] text-zinc-500 break-words">
                                  SKU: <span className="font-medium">{p.sku || "—"}</span>
                                </div>

                                <div className="mt-2 flex flex-wrap gap-2">
                                  <Badge>{p.status}</Badge>
                                  <Badge tone={p.inStock ? "neutral" : "warning"}>
                                    {p.inStock ? "In stock" : "Out"}
                                  </Badge>
                                  {low && <Badge tone="warning">Low stock</Badge>}
                                  {p.moderationStatus === "REJECTED" && (
                                    <Badge tone="danger">Rejected</Badge>
                                  )}
                                  {(p.moderationStatus === "PENDING" || p.hasPendingChanges) && (
                                    <Badge tone="warning">Pending review</Badge>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="mt-3">
                              <ModerationPanel item={p} compact />
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-600">
                              <div className="rounded-xl border bg-zinc-50 px-3 py-2">
                                <div className="opacity-70">Category</div>
                                <div className="font-medium text-zinc-900 truncate">{cat}</div>
                              </div>
                              <div className="rounded-xl border bg-zinc-50 px-3 py-2">
                                <div className="opacity-70">Brand</div>
                                <div className="font-medium text-zinc-900 truncate">{br}</div>
                              </div>
                              <div className="rounded-xl border bg-zinc-50 px-3 py-2">
                                <div className="opacity-70">Modified</div>
                                <div className="font-medium text-zinc-900">
                                  {fmtDateShort(modifiedAt)}
                                </div>
                              </div>
                              <div className="rounded-xl border bg-zinc-50 px-3 py-2">
                                <div className="opacity-70">Price</div>
                                <div className="font-medium text-zinc-900">
                                  ₦{fmtPrice(p.basePrice)}
                                </div>
                              </div>
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-3">
                              {typeof p.availableQty === "number" ? (
                                <div className="text-[11px] text-zinc-500">
                                  Qty:{" "}
                                  <span className="font-medium text-zinc-800">
                                    {p.availableQty}
                                  </span>
                                </div>
                              ) : (
                                <div />
                              )}

                              <div className="text-[11px] text-zinc-500">
                                {fmtDateTime(modifiedAt)}
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => goEdit(p.id)}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border bg-white px-3 py-2.5 text-[12px] font-semibold hover:bg-black/5"
                              >
                                <Pencil size={14} /> Edit
                              </button>

                              <button
                                type="button"
                                disabled={!del.canDelete || deleteM.isPending}
                                title={!del.canDelete ? del.reason || "Not deletable" : "Delete"}
                                onClick={() => confirmAndDelete(p)}
                                className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-[12px] font-semibold transition ${
                                  del.canDelete && !deleteM.isPending
                                    ? "bg-white hover:bg-rose-50 border-rose-200 text-rose-700"
                                    : "bg-zinc-50 border-zinc-200 text-zinc-400 cursor-not-allowed"
                                }`}
                              >
                                <Trash2 size={14} /> Delete
                              </button>
                            </div>

                            {!del.canDelete && del.reason && (
                              <div className="mt-2 text-[11px] text-zinc-500 leading-snug">
                                {del.reason}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="hidden sm:block p-4 lg:p-5">
                  <table className="w-full table-fixed text-[12px] lg:text-[13px]">
                    <colgroup>
                      <col className="w-[17%]" />
                      <col className="w-[14%]" />
                      <col className="w-[10%]" />
                      <col className="w-[10%]" />
                      <col className="w-[8%]" />
                      <col className="w-[17%]" />
                      <col className="w-[7%]" />
                      <col className="w-[7%]" />
                      <col className="w-[10%]" />
                    </colgroup>

                    <thead>
                      <tr className="text-[11px] text-zinc-500 border-b">
                        <th className="text-left font-semibold py-2 pr-3">
                          <SortButton
                            label="Product"
                            active={sortBy === "title"}
                            dir={sortDir}
                            onClick={() => toggleSort("title")}
                          />
                        </th>
                        <th className="text-left font-semibold py-2 pr-3">SKU</th>
                        <th className="text-left font-semibold py-2 pr-3">Category</th>
                        <th className="text-left font-semibold py-2 pr-3">Brand</th>
                        <th className="text-left font-semibold py-2 pr-3">
                          <SortButton
                            label="Status"
                            active={sortBy === "status"}
                            dir={sortDir}
                            onClick={() => toggleSort("status")}
                          />
                        </th>
                        <th className="text-left font-semibold py-2 pr-3">Review</th>
                        <th className="text-left font-semibold py-2 pr-3">Stock</th>
                        <th className="text-left font-semibold py-2 pr-3">
                          <SortButton
                            label="Price"
                            active={sortBy === "basePrice"}
                            dir={sortDir}
                            onClick={() => toggleSort("basePrice")}
                          />
                        </th>
                        <th className="text-left font-semibold py-2">
                          <SortButton
                            label="Modified"
                            active={sortBy === "updatedAt"}
                            dir={sortDir}
                            onClick={() => toggleSort("updatedAt")}
                          />
                        </th>
                      </tr>
                    </thead>

                    <tbody className="text-zinc-800">
                      {items.map((p) => {
                        const del = canDeleteOf(p.id);
                        const modifiedAt = p.updatedAt ?? p.createdAt;
                        const low =
                          typeof p.availableQty === "number" &&
                          p.availableQty <= lowStockThreshold;

                        return (
                          <tr key={p.id} className="border-b last:border-b-0 align-top">
                            <td className="py-3 pr-3">
                              <div className="min-w-0">
                                <div className="flex items-start gap-2 min-w-0">
                                  <div className="font-semibold text-[13px] text-zinc-900 leading-5 line-clamp-2 break-words">
                                    {p.title}
                                  </div>
                                </div>

                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  {low && <Badge tone="warning">Low stock</Badge>}
                                  {p.isDerived && <Badge tone="info">Derived</Badge>}
                                </div>
                              </div>
                            </td>

                            <td className="py-3 pr-3">
                              <div className="text-[11px] text-zinc-700 leading-5 break-words line-clamp-3">
                                {p.sku || "—"}
                              </div>
                            </td>

                            <td className="py-3 pr-3">
                              <div className="text-[12px] text-zinc-700 leading-5 line-clamp-2 break-words">
                                {p.categoryId ? categoryNameById.get(p.categoryId) ?? "—" : "—"}
                              </div>
                            </td>

                            <td className="py-3 pr-3">
                              <div className="text-[12px] text-zinc-700 leading-5 line-clamp-2 break-words">
                                {p.brandId ? brandNameById.get(p.brandId) ?? "—" : "—"}
                              </div>
                            </td>

                            <td className="py-3 pr-3">
                              <div className="flex flex-col gap-1.5">
                                <Badge className="w-fit">{p.status}</Badge>
                                {p.moderationStatus === "REJECTED" && (
                                  <Badge tone="danger" className="w-fit">
                                    Rejected
                                  </Badge>
                                )}
                                {(p.moderationStatus === "PENDING" || p.hasPendingChanges) && (
                                  <Badge tone="warning" className="w-fit">
                                    Pending
                                  </Badge>
                                )}
                              </div>
                            </td>

                            <td className="py-3 pr-3">
                              <ModerationPanel item={p} compact />
                            </td>

                            <td className="py-3 pr-3">
                              <div className="text-[12px] leading-5">
                                <div className={p.inStock ? "text-zinc-900" : "text-zinc-500"}>
                                  {p.inStock ? "In stock" : "Out"}
                                </div>
                                {typeof p.availableQty === "number" && (
                                  <div className="text-[11px] text-zinc-500">
                                    Qty: {p.availableQty}
                                  </div>
                                )}
                              </div>
                            </td>

                            <td className="py-3 pr-3">
                              <div className="text-[12px] font-semibold text-zinc-900 whitespace-nowrap">
                                ₦{fmtPrice(p.basePrice)}
                              </div>
                            </td>

                            <td className="py-3">
                              <div className="space-y-2">
                                <div className="text-[11px] text-zinc-600 leading-5">
                                  {fmtDateShort(modifiedAt)}
                                </div>

                                <div className="flex flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => goEdit(p.id)}
                                    className="inline-flex items-center gap-1 rounded-lg border bg-white px-2 py-1.5 text-[11px] hover:bg-black/5"
                                  >
                                    <Pencil size={12} /> Edit
                                  </button>

                                  <button
                                    type="button"
                                    disabled={!del.canDelete || deleteM.isPending}
                                    title={!del.canDelete ? del.reason || "Not deletable" : "Delete"}
                                    onClick={() => confirmAndDelete(p)}
                                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] transition ${
                                      del.canDelete && !deleteM.isPending
                                        ? "bg-white hover:bg-rose-50 border-rose-200 text-rose-700"
                                        : "bg-zinc-50 border-zinc-200 text-zinc-400 cursor-not-allowed"
                                    }`}
                                  >
                                    <Trash2 size={12} /> Delete
                                  </button>
                                </div>

                                {!del.canDelete && del.reason && (
                                  <div className="text-[10px] text-zinc-500 leading-snug break-words">
                                    {del.reason}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}

                      {!productsQ.isLoading && items.length === 0 && (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-zinc-500">
                            No products yet.{" "}
                            <Link className="underline" to={withSupplierCtx("/supplier/products/add")}>
                              Add one
                            </Link>
                            .
                          </td>
                        </tr>
                      )}

                      {productsQ.isError && (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-rose-700">
                            Failed to load products.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="border-t bg-white/70 px-4 sm:px-5 py-3 sm:py-4">
                  <PaginationBar
                    page={page}
                    pageCount={pageCount}
                    total={total}
                    pageSize={pageSize}
                    onPageChange={(next) => setPage(Math.max(1, Math.min(pageCount, next)))}
                    onPageSizeChange={(next) => {
                      setPageSize(next);
                      setPage(1);
                    }}
                  />
                </div>
              </Card>
            </div>
          </>
        )}
      </SupplierLayout>
    </SiteLayout>
  );
}