// src/pages/AdminDashboard.tsx
import React, { useEffect, useRef, useState, type ReactNode, type JSX } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Users,
  UserCheck,
  PackageCheck,
  CreditCard,
  RefreshCcw,
  Settings,
  BellRing,
  BarChart3,
  Search,
  Undo2,
  Mail,
  FileBadge2,
} from "lucide-react";

import api from "../../api/client.js";
import { useToast } from "../../components/ToastProvider.js";
import { useModal } from "../../components/ModalProvider.js";
import ActivitiesPanel from "../../components/admin/ActivitiesPanel.js";

import { ModerationGrid } from "../../components/admin/ModerationGrid.js";
import { ManageProducts } from "../../components/admin/ManageProducts.js";
import { TransactionRow } from "../../components/admin/TransactionRow.js";
import { CatalogSettingsSection } from "../../components/admin/CatalogSettingSection.js";
import SiteLayout from "../../layouts/SiteLayout.js";
import AdminPayoutsPanel from "../../components/admin/AdminPayoutsPanel.js";
import AdminLedgerPanel from "../../components/admin/AdminLedgerPanel.js";
import AdminSupplierDocuments from "./AdminSupplierDocuments";

const staleTimeMs = 300_000;

/* ---------------- Types ---------------- */
type Me = {
  id: string;
  role: "ADMIN" | "SUPER_ADMIN" | string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
};

type Overview = {
  ordersToday: number;
  profitToday: number; // platform profit = commission + serviceFeeBase
  revenueToday: number;
  sparklineProfit7d: number[]; // platform profit history
  sparklineRevenue7d: number[];
  users: {
    totalUsers: number;
    totalCustomers: number;
    totalAdmins: number;
    totalSuperAdmins: number;
    totalSuppliers: number;
    totalSupplierRiders: number;
  };
  products: {
    total: number;
    pending: number;
    rejected: number;
    published: number;
    live: number;
    availability: {
      allStatusesAvailable: number;
      publishedAvailable: number;
    };
    offers: {
      withAny: number;
      withoutAny: number;
      publishedWithAny: number;
      publishedWithoutAny: number;
      withActive: number;
      publishedWithActive: number;
    };
    variantMix: {
      withVariants: number;
      simple: number;
    };
    publishedBaseStock: {
      inStock: number;
      outOfStock: number;
    };
  };
};

type AdminUser = {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt?: string;
};

type SupplierOfferLite = {
  id: string;
  productId: string;
  variantId?: string | null;
  supplierId: string;
  supplierName?: string;
  isActive?: boolean;
  inStock?: boolean;
  available?: number;
  qty?: number;
  stock?: number;
};

type AdminProduct = {
  id: string;
  title: string;
  retailPrice: number | string;
  status: string;
  imagesJson?: string[];
  createdAt?: string;
  isDelete?: boolean;
  ownerId?: boolean;
  availableQty: number;
  supplierOffers: SupplierOfferLite[];
  ownerEmail?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  supplierId?: string | null;
  sku?: string | null;
  inStock?: boolean;
};

type AdminSupplier = {
  id: string;
  name: string;
  type: "PHYSICAL" | "ONLINE";
  status: string;
  contactEmail?: string | null;
  whatsappPhone?: string | null;

  apiBaseUrl?: string | null;
  apiAuthType?: "NONE" | "BEARER" | "BASIC" | null;
  apiKey?: string | null;

  payoutMethod?: "SPLIT" | "TRANSFER" | null;
  bankCountry?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  isPayoutEnabled?: boolean | null;
};

type AdminPaymentItem = {
  id: string;
  title: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  status?: string;
};

type AdminPayment = {
  id: string;
  orderId: string;
  userEmail?: string | null;
  amount: number | string;
  status: "PENDING" | "PAID" | "FAILED" | "CANCELED" | "REFUNDED" | string;
  provider?: string | null;
  channel?: string | null;
  reference?: string | null;
  createdAt?: string;
  orderStatus?: string;
  items?: AdminPaymentItem[];
};

type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  parentId?: string | null;
  position?: number | null;
  isActive: boolean;
};

type AdminBrand = {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  isActive: boolean;
};

type AdminAttribute = any;

type TabKey =
  | "overview"
  | "users"
  | "products"
  | "supplierDocs"
  | "transactions"
  | "refunds"
  | "catalog"
  | "ops"
  | "marketing"
  | "analytics"
  | "finance"
  | "careers";

type ProductsInnerTab = "moderation" | "manage";

type ManageFilters = {
  status: "ANY" | "LIVE" | "PUBLISHED" | "PENDING" | "REJECTED" | "ARCHIVED";
  stock: "ANY" | "AVAILABLE" | "OUT";
  offers: "ANY" | "ANY_PRESENT" | "ACTIVE_ONLY" | "NONE";
  variants: "ANY" | "WITH" | "SIMPLE";
  q?: string;
};

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

function fmtN(n?: number | string) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
function fmtDate(s?: string) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(+d)) return s;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------------- Tiny inline sparkline ---------------- */
function Sparkline({ points = [] as number[] }): JSX.Element | null {
  if (!points.length) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const norm = (v: number) => {
    if (max === min) return 8;
    return 20 - ((v - min) / (max - min)) * 20;
  };
  const step = 100 / Math.max(1, points.length - 1);
  const d = points
    .map((v, i) => `${i === 0 ? "M" : "L"} ${i * step},${norm(v)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-10">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

const stopHashNav = (evt: React.SyntheticEvent) => {
  const el = (evt.target as HTMLElement)?.closest?.('a[href="#"],a[href=""],a[href="#top"]');
  if (el) {
    evt.preventDefault();
    evt.stopPropagation();
  }
};


function SectionCard({
  title,
  subtitle,
  children,
  right,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="px-4 md:px-5 py-3 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-[180px]">
          <h3 className="text-ink font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-ink-soft">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </div>
  );
}

function TabButton({
  k,
  label,
  mobileLabel,
  Icon,
  activeTab,
  onSelect,
}: {
  k: TabKey;
  label: string;
  mobileLabel?: string;
  Icon: any;
  activeTab: TabKey;
  onSelect: (nextTab: TabKey) => void;
}) {
  const active = activeTab === k;

  return (
    <button
      type="button"
      onClick={() => onSelect(k)}
      className={[
        "group inline-flex w-full items-center gap-2 justify-center",
        "min-h-[44px] px-3 py-2 rounded-xl border transition",
        "overflow-hidden text-[13px] font-medium",
        "sm:w-auto sm:justify-start sm:text-sm sm:px-2.5 sm:py-2",
        active
          ? "bg-zinc-900 text-white border-zinc-900 shadow-sm"
          : "bg-white text-zinc-700 border-zinc-200 hover:bg-black/5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60",
      ].join(" ")}
    >
      <Icon size={16} className={`shrink-0 ${active ? "text-white" : "text-zinc-600"}`} />
      <span className="truncate max-w-full">
        <span className="sm:hidden">{mobileLabel ?? label}</span>
        <span className="hidden sm:inline">{label}</span>
      </span>
    </button>
  );
}

/* =========================================================
   AdminDashboard (COOKIE AUTH)
   ========================================================= */
export default function AdminDashboard() {
  const nav = useNavigate();
  const toast = useToast();
  const { openModal } = useModal();
  const qc = useQueryClient();
  const location = useLocation();

  // Tabs
  const [tab, setTab] = useState<TabKey>("overview");
  const [pTab, setPTab] = useState<ProductsInnerTab>("manage");

  // Products search + focus handoff from Moderation
  const [prodSearch, setProdSearch] = useState("");
  const [focusProductId, setFocusProductId] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();


  function handleTabSelect(nextTab: TabKey) {
    setTab(nextTab);

    setSearchParams((prev) => {
      const s = new URLSearchParams(prev);
      s.set("tab", nextTab);

      if (nextTab !== "products") {
        s.delete("pTab");
        s.delete("q");
        s.delete("status");
        s.delete("view");

        setProdSearch("");
        setFocusProductId(null);
      } else {
        if (!s.get("pTab")) s.set("pTab", "manage");
      }

      return s;
    });
  }

  const validTabs: TabKey[] = [
    "overview",
    "users",
    "products",
    "supplierDocs",
    "transactions",
    "refunds",
    "catalog",
    "ops",
    "marketing",
    "analytics",
    "finance",
    "careers",
  ];

  const validPTabs: ProductsInnerTab[] = ["moderation", "manage"];

  // ✅ Key fix: do NOT reset tab/pTab just because q changed or tab param is missing.
  const didInitFromUrl = useRef(false);
  const lastUrlTab = useRef<string | null>(null);
  const lastUrlPTab = useRef<string | null>(null);
  const lastUrlQ = useRef<string | null>(null);

  useEffect(() => {
    const rawTabParam = searchParams.get("tab"); // may be null
    const rawPTabParam = searchParams.get("pTab"); // may be null
    const rawQParam = searchParams.get("q"); // may be null

    const urlTabLower = (rawTabParam || "").toLowerCase();
    const urlPTabLower = (rawPTabParam || "").toLowerCase();

    const urlTab = urlTabLower as TabKey;
    const urlPTab = urlPTabLower as ProductsInnerTab;

    const hasValidTab = !!rawTabParam && validTabs.includes(urlTab);
    const hasValidPTab = !!rawPTabParam && validPTabs.includes(urlPTab);

    // --- TAB syncing ---
    if (!didInitFromUrl.current) {
      const nextTab: TabKey = hasValidTab ? urlTab : "overview";
      if (nextTab !== tab) setTab(nextTab);
      didInitFromUrl.current = true;
    } else {
      if (rawTabParam && rawTabParam !== lastUrlTab.current && hasValidTab) {
        if (urlTab !== tab) setTab(urlTab);
      }
    }

    // --- PTAB syncing ---
    const effectiveTab: TabKey = hasValidTab ? urlTab : tab;
    const isProducts = effectiveTab === "products";

    if (isProducts) {
      if (rawPTabParam && rawPTabParam !== lastUrlPTab.current && hasValidPTab) {
        if (urlPTab !== pTab) setPTab(urlPTab);
      }
      if (!rawPTabParam && !validPTabs.includes(pTab)) {
        setPTab("manage");
      }
    } else {
      if (tab === "products") setFocusProductId(null);
    }

    // --- q -> prodSearch syncing ---
    if (isProducts) {
      if (rawQParam !== lastUrlQ.current) {
        const next = rawQParam ?? "";
        if (next !== prodSearch) setProdSearch(next);
      }
    }

    lastUrlTab.current = rawTabParam;
    lastUrlPTab.current = rawPTabParam;
    lastUrlQ.current = rawQParam;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Transactions search
  const [q, setQ] = useState("");

  // Manage filters (currently only used when jumping from tiles)
  const [manageFilters, setManageFilters] = useState<ManageFilters>({
    status: "ANY",
    stock: "ANY",
    offers: "ANY",
    variants: "ANY",
    q: "",
  });

  /* -------- Auth + role (COOKIE BASED) -------- */
  const me = useQuery({
    queryKey: ["me"],
    retry: false,
    queryFn: async () =>
      (await api.get<Me>("/api/profile/me", { withCredentials: true })).data,
    staleTime: staleTimeMs,
    refetchOnWindowFocus: false,
  });

  const role = me.data?.role ?? "";
  const isSuperAdmin = role === "SUPER_ADMIN";
  const canAdmin = role === "ADMIN" || isSuperAdmin;

  // Redirect to login if unauthenticated (cookie missing/expired)
  useEffect(() => {
    if (!me.isFetched) return;
    if (!me.isError) return;

    const e: any = me.error;
    const status = e?.response?.status;
    if (status === 401 || status === 403) {
      nav("/login", { replace: true, state: { from: { pathname: "/admin" } } });
    }
  }, [me.isFetched, me.isError, me.error, nav]);

  useEffect(() => {
    if (me.isFetched && !me.isError && !canAdmin) {
      nav("/", { replace: true });
    }
  }, [me.isFetched, me.isError, canAdmin, nav]);

  /* -------- Overview -------- */
  const browserTz =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC";

  const overview = useQuery<Overview>({
    queryKey: ["admin", "overview", browserTz],
    enabled: !!canAdmin,
    queryFn: async () =>
      (
        await api.get<Overview>("/api/admin/overview", {
          withCredentials: true,
          params: { tz: browserTz },
        })
      ).data,
    staleTime: staleTimeMs,
    refetchOnWindowFocus: false,
  });

  function unwrapArray<T = any>(payload: any): T[] {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;

    // common shapes
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.items)) return payload.items;

    // nested shapes
    if (Array.isArray(payload.data?.data)) return payload.data.data;
    if (Array.isArray(payload.data?.items)) return payload.data.items;

    // sometimes backend returns { rows: [...] }
    if (Array.isArray(payload.rows)) return payload.rows;
    if (Array.isArray(payload.data?.rows)) return payload.data.rows;

    return [];
  }

  /* -------- Transactions -------- */
  const txQ = useQuery({
    queryKey: ["admin", "payments", q],
    enabled: !!canAdmin && tab === "transactions",
    queryFn: async () => {
      const qq = encodeURIComponent(q || "");

      // ✅ Use admin endpoint first
      try {
        const res = await api.get(`/api/admin/payments?includeItems=1&q=${qq}`, {
          withCredentials: true,
        });

        return unwrapArray<AdminPayment>(res.data);
      } catch (e: any) {
        // Optional fallback if your project uses the other route
        if (e?.response?.status === 404) {
          const res2 = await api.get(
            `/api/payments/admin?includeItems=1&q=${qq}`,
            { withCredentials: true }
          );
          return unwrapArray<AdminPayment>(res2.data);
        }
        throw e;
      }
    },
  });

  const verifyPayment = useMutation({
    mutationFn: async (paymentId: string) =>
      (
        await api.post(
          `/api/admin/payments/${paymentId}/verify`,
          {},
          { withCredentials: true }
        )
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "payments"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      toast.push({
        title: "Payments",
        message: "Payment verified.",
        duration: 2500,
      });
    },
    onError: () =>
      openModal({ title: "Payments", message: "Verification failed." }),
  });

  const refundPayment = useMutation({
    mutationFn: async (paymentId: string) =>
      (
        await api.post(
          `/api/admin/payments/${paymentId}/refund`,
          {},
          { withCredentials: true }
        )
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "payments"] });
      toast.push({
        title: "Payments",
        message: "Refund processed.",
        duration: 2500,
      });
    },
    onError: () =>
      openModal({ title: "Payments", message: "Refund failed." }),
  });

  /* -------- Catalog: categories, brands, attributes -------- */
  const categoriesQ = useQuery({
    queryKey: ["admin", "categories"],
    enabled: !!canAdmin && tab === "catalog",
    queryFn: async () =>
      (
        await api.get<{ data: AdminCategory[] }>("/api/admin/categories", {
          withCredentials: true,
        })
      ).data.data,
    refetchOnWindowFocus: false,
    staleTime: staleTimeMs,
  });

  const createCategory = useMutation({
    mutationFn: async (payload: Partial<AdminCategory>) =>
      (await api.post("/api/admin/categories", payload, { withCredentials: true }))
        .data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "categories"] });
    },
  });

  const updateCategory = useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: Partial<AdminCategory> & { id: string }) =>
      (
        await api.put(`/api/admin/categories/${id}`, payload, {
          withCredentials: true,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "categories"] });
    },
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) =>
      (
        await api.delete(`/api/admin/categories/${id}`, {
          withCredentials: true,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "categories"] });
    },
  });

  const brandsQ = useQuery({
    queryKey: ["admin", "brands"],
    enabled: !!canAdmin && tab === "catalog",
    queryFn: async () =>
      (
        await api.get<{ data: AdminBrand[] }>("/api/admin/brands", {
          withCredentials: true,
        })
      ).data.data,
    refetchOnWindowFocus: false,
    staleTime: staleTimeMs,
  });

  const createBrand = useMutation({
    mutationFn: async (payload: Partial<AdminBrand>) =>
      (await api.post("/api/admin/brands", payload, { withCredentials: true }))
        .data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "brands"] });
    },
  });

  const updateBrand = useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: Partial<AdminBrand> & { id: string }) =>
      (
        await api.put(`/api/admin/brands/${id}`, payload, {
          withCredentials: true,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "brands"] });
    },
  });

  const deleteBrand = useMutation({
    mutationFn: async (id: string) =>
      (
        await api.delete(`/api/admin/brands/${id}`, {
          withCredentials: true,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "brands"] });
    },
  });

  const attributesQ = useQuery({
    queryKey: ["admin", "attributes"],
    enabled: !!canAdmin && tab === "catalog",
    queryFn: async () =>
      (
        await api.get<{ data: AdminAttribute[] }>("/api/admin/attributes", {
          withCredentials: true,
        })
      ).data.data,
    refetchOnWindowFocus: false,
    staleTime: staleTimeMs,
  });

  const createAttribute = useMutation({
    mutationFn: async (payload: Partial<AdminAttribute>) =>
      (await api.post("/api/admin/attributes", payload, { withCredentials: true }))
        .data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "attributes"] });
    },
  });

  const updateAttribute = useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: Partial<AdminAttribute> & { id: string }) =>
      (
        await api.put(`/api/admin/attributes/${id}`, payload, {
          withCredentials: true,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "attributes"] });
    },
  });

  const deleteAttribute = useMutation({
    mutationFn: async (id: string) =>
      (
        await api.delete(`/api/admin/attributes/${id}`, {
          withCredentials: true,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "attributes"] });
    },
  });

  /* -------- Attribute values -------- */
  const createAttrValue = useMutation({
    mutationFn: async (payload: {
      attributeId: string;
      name: string;
      code?: string;
    }) => {
      const { data } = await api.post(
        `/api/admin/attributes/${payload.attributeId}/values`,
        payload,
        {
          withCredentials: true,
        }
      );
      return data;
    },
    onMutate: async (vars) => {
      const key = ["admin", "attributes"];
      await qc.cancelQueries({ queryKey: key });
      const prev = (qc.getQueryData<any[]>(key) || []) as any[];
      const idx = prev.findIndex((a: any) => a.id === vars.attributeId);
      if (idx >= 0) {
        const optimistic = structuredClone(prev);
        const a = optimistic[idx];
        a.values = [
          ...(a.values ?? []),
          {
            id: "tmp-" + Date.now(),
            name: vars.name,
            code: vars.code ?? "",
            isActive: true,
          },
        ];
        qc.setQueryData(key, optimistic);
      }
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["admin", "attributes"], ctx.prev);
      toast.push({
        title: "Attributes",
        message: "Failed to add value.",
        duration: 2500,
      });
    },
    onSuccess: (created, vars) => {
      qc.setQueryData(["admin", "attributes"], (prev: any[] = []) => {
        const idx = prev.findIndex((a: any) => a.id === vars.attributeId);
        if (idx < 0) return prev;
        const a = { ...prev[idx] };
        a.values = (a.values || []).map((v: any) =>
          v.id.startsWith("tmp-") && v.name === vars.name ? created : v
        );
        const next = [...prev];
        next[idx] = a;
        return next;
      });
      toast.push({
        title: "Attributes",
        message: "Value added.",
        duration: 1800,
      });
    },
  });

  const updateAttrValue = useMutation({
    mutationFn: async ({
      attributeId,
      id,
      ...payload
    }: {
      attributeId: string;
      id: string;
      name?: string;
      code?: string | null;
      position?: number | null;
      isActive?: boolean;
    }) =>
      (
        await api.put(
          `/api/admin/attributes/${attributeId}/values/${id}`,
          payload,
          { withCredentials: true }
        )
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "attributes"] });
      toast.push({
        title: "Attributes",
        message: "Value updated.",
        duration: 1600,
      });
    },
    onError: () => {
      toast.push({
        title: "Attributes",
        message: "Failed to update value.",
        duration: 2500,
      });
    },
  });

  const deleteAttrValue = useMutation({
    mutationFn: async ({
      attributeId,
      id,
    }: {
      attributeId: string;
      id: string;
    }) =>
      (
        await api.delete(
          `/api/admin/attributes/${attributeId}/values/${id}`,
          { withCredentials: true }
        )
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "attributes"] });
      toast.push({
        title: "Attributes",
        message: "Value deleted.",
        duration: 1600,
      });
    },
    onError: () => {
      toast.push({
        title: "Attributes",
        message: "Failed to delete value.",
        duration: 2500,
      });
    },
  });

  /* -------- Catalog usage (moved out of JSX) -------- */
  const catalogUsageQ = useQuery({
    queryKey: ["admin", "catalog", "usage"],
    enabled: !!canAdmin && tab === "catalog",
    queryFn: async () => {
      try {
        const { data } = await api.get("/api/admin/catalog/usage", {
          withCredentials: true,
        });
        return data || { categories: {}, attributes: {}, brands: {} };
      } catch {
        // Fallback: derive from products if usage endpoint is missing
        try {
          const { data } = await api.get("/api/products?include=attributes,variants", {
            withCredentials: true,
          });
          const arr: any[] = Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data)
              ? data
              : [];
          const categories: Record<string, number> = {};
          const attributes: Record<string, number> = {};
          const brands: Record<string, number> = {};

          for (const p of arr) {
            if (p.categoryId)
              categories[p.categoryId] = (categories[p.categoryId] || 0) + 1;
            if (p.brandId) brands[p.brandId] = (brands[p.brandId] || 0) + 1;

            const avs = p.attributeValues || [];
            for (const av of avs) {
              const attrId = av?.attributeId || av?.attribute?.id;
              if (attrId) attributes[attrId] = (attributes[attrId] || 0) + 1;
            }

            const variants = p.variants || [];
            for (const v of variants) {
              const opts = v.options || [];
              for (const opt of opts) {
                const attrId = opt?.attributeId || opt?.attribute?.id;
                if (attrId) attributes[attrId] = (attributes[attrId] || 0) + 1;
              }
            }
          }

          return { categories, attributes, brands };
        } catch {
          return { categories: {}, attributes: {}, brands: {} };
        }
      }
    },
    refetchOnWindowFocus: false,
    staleTime: staleTimeMs,
  });

  /* -------- Suppliers (moved out of JSX) -------- */
  const suppliersQ = useQuery({
    queryKey: ["admin", "suppliers"],
    enabled: !!canAdmin && tab === "catalog",
    queryFn: async () => {
      const res = await api.get("/api/admin/suppliers");
      return unwrapArray<AdminSupplier>(res.data);
    },

    refetchOnWindowFocus: false,
    staleTime: staleTimeMs,
  });

  const createSupplier = useMutation({
    mutationFn: async (payload: Partial<AdminSupplier>) =>
      (await api.post("/api/admin/suppliers", payload, { withCredentials: true }))
        .data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "suppliers"] });
    },
  });

  const updateSupplier = useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: Partial<AdminSupplier> & { id: string }) =>
      (
        await api.put(`/api/admin/suppliers/${id}`, payload, {
          withCredentials: true,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "suppliers"] });
    },
  });

  const deleteSupplier = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete(`/api/admin/suppliers/${id}`, {
        withCredentials: true,
      });
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "suppliers"] });
      openModal({
        title: "Supplier deleted",
        message: "Supplier deleted successfully.",
      });
    },
    onError: (e: any) => {
      const backendError = e?.response?.data?.error;
      const details = e?.response?.data?.details;

      let message = backendError || "Could not delete supplier.";

      if (details) {
        message += `

Product offers: ${details.productOffers ?? 0}
Variant offers: ${details.variantOffers ?? 0}
Purchase orders: ${details.purchaseOrders ?? 0}
Chosen order items: ${details.chosenOrderItems ?? 0}`;
      }

      openModal({
        title: "Delete blocked",
        message,
      });
    },
  });

  /* -------- Backfill on first open (cookie-based) -------- */
  const didBackfill = useRef(false);
  useEffect(() => {
    if (!canAdmin || tab !== "catalog" || didBackfill.current) return;
    (async () => {
      try {
        await api.post("/api/admin/catalog/backfill", {}, { withCredentials: true });
      } catch {
        // ignore
      } finally {
        didBackfill.current = true;
        qc.invalidateQueries({ queryKey: ["admin", "categories"] });
        qc.invalidateQueries({ queryKey: ["admin", "attributes"] });
        qc.invalidateQueries({ queryKey: ["admin", "brands"] });
        qc.invalidateQueries({ queryKey: ["admin", "catalog", "usage"] });
      }
    })();
  }, [tab, canAdmin, qc]);

  function SkeletonRow({ cols = 4 }: { cols?: number }) {
    return (
      <tr className="animate-pulse">
        {Array.from({ length: cols }).map((_, i) => (
          <td key={i} className="px-3 py-3">
            <div className="h-3 rounded bg-zinc-200" />
          </td>
        ))}
      </tr>
    );
  }

  function StatChip({
    label,
    value,
    onClick,
    emphasis,
  }: {
    label: string;
    value: number;
    onClick?: () => void;
    emphasis?: boolean;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${emphasis
          ? "bg-emerald-600 text-white border-emerald-600 hover:opacity-90"
          : "bg-white hover:bg-black/5"
          }`}
        title={label}
      >
        <span className="font-medium">{value.toLocaleString()}</span>
        <span className="text-ink-soft">•</span>
        <span>{label}</span>
      </button>
    );
  }

  /* -------- Users Section (responsive) -------- */
  function UsersSection({ canAdmin: canAdminProp }: { canAdmin: boolean }) {
    const qc2 = useQueryClient();
    const { openModal: openModal2 } = useModal();
    const toast2 = useToast();

    const [usersSearchInput, setUsersSearchInput] = useState("");
    const usersSearch = useDebounced(usersSearchInput, 350);

    const usersQ = useQuery<AdminUser[]>({
      queryKey: ["admin", "users", usersSearch],
      enabled: !!canAdminProp,
      queryFn: async () => {
        const { data } = await api.get<{ data: AdminUser[] }>("/api/admin/users", {
          withCredentials: true,
          params: { q: usersSearch || "" },
        });
        return Array.isArray(data?.data) ? data.data : [];
      },
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: "always",
      staleTime: staleTimeMs,
    });

    useEffect(() => {
      if (usersQ.isError) {
        const e: any = usersQ.error;
        console.error(
          "Users list failed:",
          e?.response?.status,
          e?.response?.data || e?.message
        );
      }
    }, [usersQ.isError, usersQ.error]);

    const updateUserRole = useMutation({
      mutationFn: async ({
        userId,
        role: nextRole,
      }: {
        userId: string;
        role: string;
      }) =>
        (
          await api.post(
            `/api/admin/users/${userId}/role`,
            { role: nextRole },
            { withCredentials: true }
          )
        ).data,
      onSuccess: () => {
        qc2.invalidateQueries({ queryKey: ["admin", "users"], exact: false });
        toast2.push({
          title: "Users",
          message: "Role updated.",
          duration: 2500,
        });
      },
      onError: (e: any) => {
        const msg = e?.response?.data?.error || "Could not update role.";
        openModal2({ title: "Users", message: msg });
      },
    });

    const deactivateUser = useMutation({
      mutationFn: async (userId: string) =>
        (
          await api.post(
            `/api/admin/users/${userId}/deactivate`,
            {},
            { withCredentials: true }
          )
        ).data,
      onSuccess: () => {
        qc2.invalidateQueries({ queryKey: ["admin", "users"], exact: false });
        toast2.push({
          title: "Users",
          message: "User deactivated.",
          duration: 2500,
        });
      },
      onError: () =>
        openModal2({ title: "Users", message: "Could not deactivate user." }),
    });

    const reactivateUser = useMutation({
      mutationFn: async (userId: string) =>
        (
          await api.post(
            `/api/admin/users/${userId}/reactivate`,
            {},
            { withCredentials: true }
          )
        ).data,
      onSuccess: () => {
        qc2.invalidateQueries({ queryKey: ["admin", "users"], exact: false });
        toast2.push({
          title: "Users",
          message: "User reactivated.",
          duration: 2500,
        });
      },
      onError: () =>
        openModal2({ title: "Users", message: "Could not reactivate user." }),
    });

    const rows = usersQ.data ?? [];

    return (
      <SectionCard
        title="Users & Roles"
        subtitle="Create, approve, deactivate, reactivate; manage privileges"
        right={
          <div className="relative w-full sm:w-[320px]">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              value={usersSearchInput}
              onChange={(e) => setUsersSearchInput(e.target.value)}
              placeholder="Search by email or role…"
              className="w-full pl-9 pr-3 py-2 rounded-xl border bg-white"
            />
          </div>
        }
      >
        {/* Mobile cards */}
        <div className="sm:hidden space-y-3">
          {usersQ.isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl border p-4 animate-pulse">
                <div className="h-4 w-2/3 bg-zinc-200 rounded" />
                <div className="mt-2 h-3 w-1/2 bg-zinc-200 rounded" />
                <div className="mt-4 h-9 w-full bg-zinc-200 rounded-xl" />
              </div>
            ))}

          {!usersQ.isLoading && rows.length === 0 && (
            <div className="rounded-2xl border p-4 text-sm text-zinc-600">
              No users found.
            </div>
          )}

          {rows.map((u) => {
            const statusUpper = (u.status || "").toUpperCase();
            const isSuspended = ["SUSPENDED", "DEACTIVATED", "DISABLED"].includes(
              statusUpper
            );

            return (
              <div key={u.id} className="rounded-2xl border p-4 bg-white">
                <div className="font-semibold text-ink break-all">{u.email}</div>

                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="text-xs text-ink-soft">Role</div>
                  <div className="text-right">
                    {role === "SUPER_ADMIN" ? (
                      u.role === "SUPPLIER" ? (
                        <span className="text-ink">{u.role}</span>
                      ) : (
                        <div className="inline-block">
                          <RoleSelect
                            value={u.role}
                            onChange={(newRole) =>
                              updateUserRole.mutate({
                                userId: u.id,
                                role: newRole,
                              })
                            }
                          />
                        </div>
                      )
                    ) : (
                      <span className="text-ink">{u.role}</span>
                    )}
                  </div>

                  <div className="text-xs text-ink-soft">Status</div>
                  <div className="text-right">
                    <StatusDot label={u.status} />
                  </div>

                  <div className="text-xs text-ink-soft">Created</div>
                  <div className="text-right text-ink">
                    {fmtDate(u.createdAt)}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {!isSuspended ? (
                    <button
                      onClick={() => deactivateUser.mutate(u.id)}
                      className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => reactivateUser.mutate(u.id)}
                      className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <RefreshCcw size={16} /> Reactivate
                    </button>
                  )}
                  <button
                    onClick={() =>
                      openModal2({ title: "User", message: u.email })
                    }
                    className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-black/5"
                  >
                    View
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-ink">
                <th className="text-left px-3 py-2">User</th>
                <th className="text-left px-3 py-2">Role</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Created</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {usersQ.isLoading && (
                <>
                  <SkeletonRow cols={5} />
                  <SkeletonRow cols={5} />
                  <SkeletonRow cols={5} />
                </>
              )}
              {!usersQ.isLoading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-zinc-500"
                  >
                    No users found.
                  </td>
                </tr>
              )}
              {rows.map((u) => {
                const statusUpper = (u.status || "").toUpperCase();
                const isSuspended = ["SUSPENDED", "DEACTIVATED", "DISABLED"].includes(
                  statusUpper
                );
                return (
                  <tr key={u.id} className="hover:bg-black/5">
                    <td className="px-3 py-3">{u.email}</td>
                    <td className="px-3 py-3">
                      {role === "SUPER_ADMIN" ? (
                        u.role === "SUPPLIER" ? (
                          u.role
                        ) : (
                          <RoleSelect
                            value={u.role}
                            onChange={(newRole) =>
                              updateUserRole.mutate({
                                userId: u.id,
                                role: newRole,
                              })
                            }
                          />
                        )
                      ) : (
                        u.role
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <StatusDot label={u.status} />
                    </td>
                    <td className="px-3 py-3">{fmtDate(u.createdAt)}</td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex flex-wrap items-center gap-2">
                        {!isSuspended ? (
                          <button
                            onClick={() => deactivateUser.mutate(u.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => reactivateUser.mutate(u.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <RefreshCcw size={16} /> Reactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    );
  }

  /* -------- Marketing Section: wire newsletter page -------- */
  function MarketingSection() {
    return (
      <SectionCard
        title="Marketing"
        subtitle="Keep shoppers engaged with newsletters and updates"
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <QuickAction
            toAction={() => nav("/admin/newsletter")}
            icon={Mail}
            label="Newsletter broadcast"
            desc="Send updates to all subscribers (with dry run first)"
          />
          <QuickAction
            toAction={() => setTab("analytics")}
            icon={BarChart3}
            label="Activity analytics"
            desc="Review events and signals from the activity log"
          />
          <QuickAction
            toAction={() => nav("/")}
            icon={BellRing}
            label="Customer-facing homepage"
            desc="Open main site to see how promos look"
          />
        </div>
      </SectionCard>
    );
  }

  /* -------- Helper for tiles -> Manage tab -------- */
  const toViewSlug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");

  const mapViewToStatus = (label: string): ManageFilters["status"] => {
    const v = toViewSlug(label);
    switch (v) {
      case "published":
      case "published-available":
      case "published-with-any":
      case "published-without-any":
      case "published-with-active":
      case "published-base-in":
      case "published-base-out":
        return "PUBLISHED";
      case "live":
        return "LIVE";
      case "pending":
        return "PENDING";
      case "rejected":
        return "REJECTED";
      default:
        return "ANY";
    }
  };

  function goProductsManageFromTile(label: string) {
    const status = mapViewToStatus(label);
    setTab("products");
    setPTab("manage");
    setManageFilters((f) => ({ ...f, status }));

    const s = new URLSearchParams(location.search);
    s.set("tab", "products");
    s.set("pTab", "manage");
    s.set("status", status);
    s.set("view", toViewSlug(label));
    nav(`/admin?${s.toString()}`, { replace: false });
  }

  /* -------- Products moderation wrapper -------- */
  function ModerationSection({ onInspect }: { onInspect: (p: any) => void }) {
    const qc2 = useQueryClient();
    const [searchInput, setSearchInput] = React.useState("");
    const debounced = useDebounced(searchInput, 350);

    useQuery<AdminProduct[]>({
      queryKey: ["admin", "products", "pending", { q: debounced }],
      enabled: !!canAdmin,
      queryFn: async () => {
        try {
          const { data } = await api.get("/api/admin/products/published", {
            withCredentials: true,
            params: { q: debounced },
          });
          return Array.isArray(data?.data) ? data.data : [];
        } catch {
          const { data } = await api.get("/api/products", {
            withCredentials: true,
            params: { status: "PENDING", q: debounced, take: 50, skip: 0 },
          });
          return Array.isArray(data?.data) ? data.data : [];
        }
      },
    });

    const approveM = useMutation({
      mutationFn: async (id: string) => {
        const res = await api.post(
          `/api/admin/products/${encodeURIComponent(id)}/go-live`,
          {},
          { withCredentials: true }
        );
        return res.data?.data ?? res.data ?? res;
      },
      onSuccess: async () => {
        await qc2.invalidateQueries({ queryKey: ["admin", "products"] });
        await qc2.invalidateQueries({
          queryKey: ["admin", "products", "moderation"],
        });
        await qc2.invalidateQueries({ queryKey: ["admin", "overview"] });
      },
      onError: (e: any) => {
        const msg =
          e?.response?.data?.error ||
          e?.message ||
          "Failed to approve (go live).";
        window.alert(msg);
      },
    });

    // Some legacy components may still have a prop typed in their TS signature.
    // We render them via `any` so this page stays cookie-only without threading auth props.
    const ModerationGridAny = ModerationGrid as any;

    return (
      <ModerationGridAny
        search={searchInput}
        setSearch={setSearchInput}
        onApprove={(id: string) => approveM.mutate(id)}
        onInspect={onInspect}
      />
    );
  }

  const ManageProductsAny = ManageProducts as any;
  const CatalogSettingsAny = CatalogSettingsSection as any;

  /* ---------------- Render ---------------- */
  return (
    <SiteLayout>
      <div
        className="max-w-[1400px] mx-auto px-3 sm:px-4 md:px-6 py-5 md:py-6"
        onClickCapture={stopHashNav}
        onMouseDownCapture={stopHashNav}
      >
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-sky-700 via-sky-600 to-indigo-700 text-white">
          <div className="absolute inset-0 opacity-30 bg-[radial-gradient(closest-side,rgba(255,255,255,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,0,0,0.15),transparent_60%)]" />
          <div className="relative px-4 sm:px-5 md:px-8 py-5 md:py-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <motion.h1
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight"
                >
                  {me.isLoading
                    ? "Loading…"
                    : role === "SUPER_ADMIN"
                      ? "Super Admin Dashboard"
                      : "Admin Dashboard"}
                </motion.h1>
                <p className="text-white/80 text-sm mt-1">
                  Full control & oversight — users, products, transactions,
                  operations, marketing, and analytics.
                </p>
              </div>

              {/* 👉 Hero actions: Applicants + Careers pages + Back to site */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                {/* Applicants list */}
                <Link
                  to="/admin/applicants"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white text-sky-800 px-3 py-2 text-sm font-medium shadow-sm hover:bg-sky-50 w-full sm:w-auto"
                >
                  <Users size={16} />
                  <span className="truncate">View applicants</span>
                </Link>

                {/* Job roles page */}
                <Link
                  to="/admin/careers/jobs"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 px-3 py-2 text-sm w-full sm:w-auto"
                >
                  <Users size={16} />
                  <span className="truncate">Job roles</span>
                </Link>

                {/* Careers g */}
                <Link
                  to="/admin/careers/g"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 px-3 py-2 text-sm w-full sm:w-auto"
                >
                  <Settings size={16} />
                  <span className="truncate">Careers g</span>
                </Link>

                {/* Back to main site */}
                <Link
                  to="/"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 px-3 py-2 text-sm w-full sm:w-auto"
                >
                  <ShieldCheck size={16} /> Back to site
                </Link>
              </div>
            </div>
          </div>
        </div>

                {/* Tabs */}
        <div className="mt-6">
          <div className="rounded-2xl border bg-white p-2 shadow-sm">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <TabButton
                k="overview"
                label="Overview"
                Icon={ShieldCheck}
                activeTab={tab}
                onSelect={handleTabSelect}
              />

              <TabButton
                k="users"
                label="Users & Roles"
                mobileLabel="Users"
                Icon={UserCheck}
                activeTab={tab}
                onSelect={handleTabSelect}
              />

              <TabButton
                k="careers"
                label="Careers"
                mobileLabel="Careers"
                Icon={Users}
                activeTab={tab}
                onSelect={handleTabSelect}
              />

              <TabButton
                k="products"
                label="Product Moderation"
                mobileLabel="Products"
                Icon={PackageCheck}
                activeTab={tab}
                onSelect={handleTabSelect}
              />

              <TabButton
                k="catalog"
                label="Supplier/Catalog Settings"
                mobileLabel="Catalog"
                Icon={Settings}
                activeTab={tab}
                onSelect={handleTabSelect}
              />

              <TabButton
                k="supplierDocs"
                label="Supplier Documents"
                mobileLabel="Supplier Docs"
                Icon={FileBadge2}
                activeTab={tab}
                onSelect={handleTabSelect}
              />

              <TabButton
                k="refunds"
                label="Refunds"
                Icon={Undo2}
                activeTab={tab}
                onSelect={handleTabSelect}
              />

              <TabButton
                k="transactions"
                label="Transactions"
                mobileLabel="Payments"
                Icon={CreditCard}
                activeTab={tab}
                onSelect={handleTabSelect}
              />

              <TabButton
                k="finance"
                label="Finance"
                Icon={CreditCard}
                activeTab={tab}
                onSelect={handleTabSelect}
              />

              <TabButton
                k="ops"
                label="Ops & Security"
                mobileLabel="Ops"
                Icon={Settings}
                activeTab={tab}
                onSelect={handleTabSelect}
              />

              <TabButton
                k="marketing"
                label="Marketing"
                Icon={BellRing}
                activeTab={tab}
                onSelect={handleTabSelect}
              />

              <TabButton
                k="analytics"
                label="Analytics"
                Icon={BarChart3}
                activeTab={tab}
                onSelect={handleTabSelect}
              />
            </div>
          </div>
        </div>

        {/* KPIs (Overview only) */}
        {tab === "overview" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            <KpiCard
              title="Users"
              value={(
                overview.data?.users.totalUsers ?? 0
              ).toLocaleString()}
              hint={`${overview.data?.users.totalCustomers ?? 0} Customers • ${overview.data?.users.totalSuppliers ?? 0
                } Suppliers • ${overview.data?.users.totalSupplierRiders ?? 0
                } Riders • ${overview.data?.users.totalAdmins ?? 0} Admins • ${overview.data?.users.totalSuperAdmins ?? 0
                } Super Admins`}
              Icon={Users}
            />

            <KpiCardOverview
              title="Products"
              total={`${overview.data?.products.total ?? 0} total`}
              value={`${overview.data?.products.published ?? 0} Published • ${overview.data?.products.live ?? 0
                } Live`}
              hint={`${overview.data?.products.pending ?? 0} Pending • ${overview.data?.products.rejected ?? 0
                } Rejected`}
              res={`${overview.data?.products.availability.publishedAvailable ?? 0
                } Published available`}
              Icon={PackageCheck}
            />

            <KpiCard
              title="Orders Today"
              value={(overview.data?.ordersToday ?? 0).toLocaleString()}
              hint="New orders"
              Icon={CreditCard}
            />

            <KpiCard
              title="Revenue Today"
              value={ngn.format(fmtN(overview.data?.revenueToday))}
              hint="Last 7 days"
              Icon={BarChart3}
              chart={
                <Sparkline
                  points={overview.data?.sparklineRevenue7d || []}
                />
              }
            />

            {isSuperAdmin && (
              <KpiCard
                title="Platform Profit Today"
                value={ngn.format(fmtN(overview.data?.profitToday))}
                hint="Commission + base service fee"
                Icon={BarChart3}
                chart={
                  <Sparkline points={overview.data?.sparklineProfit7d || []} />
                }
              />
            )}
          </div>
        )}

        {/* Content */}
        <div className="mt-4 space-y-6">
          {tab === "users" && <UsersSection canAdmin={canAdmin} />}

          {tab === "analytics" && <ActivitiesPanel />}

          {/* Overview */}
          {tab === "overview" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <SectionCard
                title="Quick Actions"
                subtitle="Common admin tasks at a glance"
              >
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {/* Applicants */}
                  <QuickAction
                    toAction={() => nav("/admin/applicants")}
                    icon={Users}
                    label="Job applicants"
                    desc="Review and manage CVs from the careers page"
                  />

                  {/* Job roles */}
                  <QuickAction
                    toAction={() => nav("/admin/careers/jobs")}
                    icon={Users}
                    label="Job roles"
                    desc="Define roles and hiring needs"
                  />

                  {/* Employees (HR) */}
                  <QuickAction
                    toAction={() => nav("/admin/employees")}
                    icon={UserCheck}
                    label="Employees"
                    desc="View and manage staff records"
                  />

                  {/* Careers config */}
                  <QuickAction
                    toAction={() => nav("/admin/careers/config")}
                    icon={Settings}
                    label="Careers config"
                    desc="Configure careers site & settings"
                  />

                  {/* Newsletter broadcast */}
                  <QuickAction
                    toAction={() => nav("/admin/newsletter")}
                    icon={Mail}
                    label="Newsletter broadcast"
                    desc="Send updates to newsletter subscribers"
                  />

                  {/* Existing stuff */}
                  <QuickAction
                    toAction={() => setTab("users")}
                    icon={UserCheck}
                    label="Users & roles"
                    desc="Manage admin privileges and access"
                  />
                  <QuickAction
                    toAction={() => setTab("products")}
                    icon={PackageCheck}
                    label="Moderate products"
                    desc="Approve or reject submissions"
                  />
                  <QuickAction
                    toAction={() => setTab("transactions")}
                    icon={CreditCard}
                    label="Verify payments"
                    desc="Handle verifications & refunds"
                  />
                </div>
              </SectionCard>

              <SectionCard
                title="What needs attention"
                subtitle="Pending items & alerts"
              >
                <ul className="space-y-3 text-sm">
                  <li className="flex items-center justify-between border rounded-xl px-3 py-2">
                    <span className="text-ink">Products pending review</span>
                    <span className="font-semibold">
                      {overview.data?.products.pending ?? 0}
                    </span>
                  </li>
                  <li className="flex items-center justify-between border rounded-xl px-3 py-2">
                    <span className="text-ink">
                      Unverified / flagged transactions
                    </span>
                    <span className="font-semibold">—</span>
                  </li>
                  <li className="flex items-center justify-between border rounded-xl px-3 py-2">
                    <span className="text-ink">Unusual activity alerts</span>
                    <span className="font-semibold">—</span>
                  </li>
                </ul>
              </SectionCard>

              {/* Catalog snapshot */}
              <SectionCard
                title="Catalog snapshot"
                subtitle="Availability & offers are variant-aware; Live = Published + Available + Active offer"
              >
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="rounded-xl border p-3">
                    <div className="text-xs text-ink-soft mb-2">Status</div>
                    <div className="flex flex-wrap gap-2">
                      <StatChip
                        label="Published"
                        value={overview.data?.products.published ?? 0}
                        onClick={() => goProductsManageFromTile("Published")}
                      />
                      <StatChip
                        label="Live"
                        value={overview.data?.products.live ?? 0}
                        onClick={() => goProductsManageFromTile("Live")}
                        emphasis
                      />
                      <StatChip
                        label="Pending"
                        value={overview.data?.products.pending ?? 0}
                        onClick={() => goProductsManageFromTile("Pending")}
                      />
                      <StatChip
                        label="Rejected"
                        value={overview.data?.products.rejected ?? 0}
                        onClick={() => goProductsManageFromTile("Rejected")}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border p-3">
                    <div className="text-xs text-ink-soft mb-2">
                      Availability (variant-aware)
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatChip
                        label="All statuses available"
                        value={
                          overview.data?.products.availability
                            .allStatusesAvailable ?? 0
                        }
                        onClick={() =>
                          goProductsManageFromTile("All statuses available")
                        }
                      />
                      <StatChip
                        label="Published available"
                        value={
                          overview.data?.products.availability
                            .publishedAvailable ?? 0
                        }
                        onClick={() =>
                          goProductsManageFromTile("Published available")
                        }
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border p-3">
                    <div className="text-xs text-ink-soft mb-2">
                      Supplier offers
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatChip
                        label="With any"
                        value={overview.data?.products.offers.withAny ?? 0}
                        onClick={() => goProductsManageFromTile("With any")}
                      />
                      <StatChip
                        label="Without any"
                        value={overview.data?.products.offers.withoutAny ?? 0}
                        onClick={() =>
                          goProductsManageFromTile("Without any")
                        }
                      />
                      <StatChip
                        label="Published with any"
                        value={
                          overview.data?.products.offers.publishedWithAny ?? 0
                        }
                        onClick={() =>
                          goProductsManageFromTile("Published with any")
                        }
                      />
                      <StatChip
                        label="Published without any"
                        value={
                          overview.data?.products.offers
                            .publishedWithoutAny ?? 0
                        }
                        onClick={() =>
                          goProductsManageFromTile("Published without any")
                        }
                      />
                      <StatChip
                        label="With active"
                        value={overview.data?.products.offers.withActive ?? 0}
                        onClick={() => goProductsManageFromTile("With active")}
                      />
                      <StatChip
                        label="Published with active"
                        value={
                          overview.data?.products.offers
                            .publishedWithActive ?? 0
                        }
                        onClick={() =>
                          goProductsManageFromTile("Published with active")
                        }
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border p-3">
                    <div className="text-xs text-ink-soft mb-2">Variants</div>
                    <div className="flex flex-wrap gap-2">
                      <StatChip
                        label="With variants"
                        value={
                          overview.data?.products.variantMix.withVariants ?? 0
                        }
                        onClick={() =>
                          goProductsManageFromTile("With variants")
                        }
                      />
                      <StatChip
                        label="Simple"
                        value={overview.data?.products.variantMix.simple ?? 0}
                        onClick={() => goProductsManageFromTile("Simple")}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border p-3 sm:col-span-2">
                    <div className="text-xs text-ink-soft mb-2">
                      Published base stock (non-variant-aware)
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatChip
                        label="Base in-stock"
                        value={
                          overview.data?.products.publishedBaseStock.inStock ??
                          0
                        }
                        onClick={() =>
                          goProductsManageFromTile("Base in-stock")
                        }
                      />
                      <StatChip
                        label="Base out-of-stock"
                        value={
                          overview.data?.products.publishedBaseStock
                            .outOfStock ?? 0
                        }
                        onClick={() =>
                          goProductsManageFromTile("Base out-of-stock")
                        }
                      />
                    </div>
                  </div>
                </div>
              </SectionCard>
            </div>
          )}

          {/* Products (Moderation + Manage) */}
          {tab === "products" && (
            <SectionCard
              title="Products"
              subtitle="Moderate submissions or manage the catalog"
              right={
                <div className="inline-flex rounded-xl border overflow-hidden w-full sm:w-auto">
                  <button
                    onClick={() => {
                      setPTab("moderation");
                      const s = new URLSearchParams(location.search);
                      s.set("tab", "products");
                      s.set("pTab", "moderation");
                      nav(`/admin?${s.toString()}`, { replace: false });
                    }}
                    className={`flex-1 sm:flex-none px-3 py-2 text-sm ${pTab === "moderation"
                      ? "bg-zinc-900 text-white"
                      : "bg-white hover:bg-black/5"
                      }`}
                  >
                    Moderation
                  </button>
                  <button
                    onClick={() => {
                      setPTab("manage");
                      const s = new URLSearchParams(location.search);
                      s.set("tab", "products");
                      s.set("pTab", "manage");
                      nav(`/admin?${s.toString()}`, { replace: false });
                    }}
                    className={`flex-1 sm:flex-none px-3 py-2 text-sm ${pTab === "manage"
                      ? "bg-zinc-900 text-white"
                      : "bg-white hover:bg-black/5"
                      }`}
                  >
                    Manage
                  </button>
                </div>
              }
            >
              {/* Keep both mounted; toggle visibility only */}
              <div className={pTab === "moderation" ? "block" : "hidden"}>
                <ModerationSection
                  onInspect={(p: { id: string; title?: string; sku?: string }) => {
                    setProdSearch(p.title || p.sku || "");
                    setFocusProductId(p.id);
                    setPTab("manage");
                    setTab("products");

                    const s = new URLSearchParams(location.search);
                    s.set("tab", "products");
                    s.set("pTab", "manage");

                    const nextQ = (p.title || p.sku || "").trim();
                    if (nextQ) s.set("q", nextQ);
                    else s.delete("q");

                    nav(`/admin?${s.toString()}`, { replace: false });
                  }}
                />
              </div>

              <div className={pTab === "manage" ? "block" : "hidden"}>
                <ManageProductsAny
                  role={role}
                  search={prodSearch}
                  setSearch={setProdSearch}
                  focusId={focusProductId}
                  onFocusedConsumed={() => setFocusProductId(null)}
                  // pass through if your ManageProducts consumes it
                  manageFilters={manageFilters}
                  setManageFilters={setManageFilters}
                />
              </div>
            </SectionCard>
          )}

          {/* Catalog Settings */}
          {tab === "catalog" && (
            <CatalogSettingsAny
              canEdit={role === "SUPER_ADMIN"}
              categoriesQ={categoriesQ}
              brandsQ={brandsQ}
              attributesQ={attributesQ}
              usageQ={catalogUsageQ}
              createCategory={createCategory}
              updateCategory={updateCategory}
              deleteCategory={deleteCategory}
              createBrand={createBrand}
              updateBrand={updateBrand}
              deleteBrand={deleteBrand}
              createAttribute={createAttribute}
              updateAttribute={updateAttribute}
              deleteAttribute={deleteAttribute}
              createAttrValue={createAttrValue}
              updateAttrValue={updateAttrValue}
              deleteAttrValue={deleteAttrValue}
              suppliersQ={suppliersQ}
              createSupplier={createSupplier}
              updateSupplier={updateSupplier}
              deleteSupplier={deleteSupplier}
            />
          )}
          {tab === "supplierDocs" && <AdminSupplierDocuments />}

          {tab === "careers" && (
            <SectionCard
              title="Careers"
              subtitle="Applicants, roles, and settings"
            >
              <div className="grid sm:grid-cols-2 gap-3">
                <QuickAction
                  toAction={() => nav("/admin/applicants")}
                  icon={Users}
                  label="Job applicants"
                  desc="View and manage applications"
                />
                <QuickAction
                  toAction={() => nav("/admin/careers/jobs")}
                  icon={Users}
                  label="Job roles"
                  desc="Define roles & responsibilities"
                />
                <QuickAction
                  toAction={() => nav("/admin/careers/config")}
                  icon={Settings}
                  label="Careers settings"
                  desc="Configure careers site behaviour"
                />
              </div>

              <QuickAction
                toAction={() => {
                  setTab("supplierDocs");
                  const s = new URLSearchParams(location.search);
                  s.set("tab", "supplierDocs");
                  nav(`/admin?${s.toString()}`, { replace: false });
                }}
                icon={FileBadge2}
                label="Supplier documents"
                desc="Review supplier KYC documents and approve or reject them"
              />

              <QuickAction
                toAction={() => nav("/admin/employees")}
                icon={UserCheck}
                label="Employees"
                desc="HR view of staff, payroll readiness & docs"
              />
            </SectionCard>
          )}

          {/* Marketing: newsletter wiring */}
          {tab === "marketing" && <MarketingSection />}

          {tab === "refunds" && <RefundsSection canAdmin={canAdmin} />}
          {tab === "finance" && <FinanceSection canAdmin={canAdmin} />}

          {/* Transactions */}
          {tab === "transactions" && (
            <TransactionsSection
              q={q}
              setQ={setQ}
              txQ={txQ}
              onRefresh={() =>
                qc.invalidateQueries({ queryKey: ["admin", "payments"] })
              }
              onVerify={verifyPayment.mutate}
              onRefund={refundPayment.mutate}
            />
          )}
        </div>
      </div>
    </SiteLayout>
  );
}

/* ---------------- Transactions section ---------------- */
function TransactionsSection({
  q,
  setQ,
  txQ,
  onRefresh,
  onVerify,
  onRefund,
}: {
  q: string;
  setQ: (v: string) => void;
  txQ: any;
  onRefresh: () => void;
  onVerify: (id: string) => void;
  onRefund: (id: string) => void;
}) {
  function SectionCard({
    title,
    subtitle,
    right,
    children,
  }: {
    title: string;
    subtitle?: string;
    right?: ReactNode;
    children: ReactNode;
  }) {
    return (
      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="px-4 md:px-5 py-3 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-[180px]">
            <h3 className="text-ink font-semibold">{title}</h3>
            {subtitle && <p className="text-xs text-ink-soft">{subtitle}</p>}
          </div>
          {right}
        </div>
        <div className="p-4 md:p-5">{children}</div>
      </div>
    );
  }

  function SkeletonRow({ cols = 4 }: { cols?: number }) {
    return (
      <tr className="animate-pulse">
        {Array.from({ length: cols }).map((_, i) => (
          <td key={i} className="px-3 py-3">
            <div className="h-3 rounded bg-zinc-200" />
          </td>
        ))}
      </tr>
    );
  }

  const rows: AdminPayment[] = txQ.data ?? [];

  return (
    <SectionCard
      title="Transactions"
      subtitle="Verify payments, process refunds, view history (item-level breakdowns)"
      right={
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-[340px]">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by order, reference, or email…"
              className="w-full pl-9 pr-3 py-2 rounded-xl border bg-white"
            />
          </div>
          <button
            onClick={onRefresh}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-black/5 w-full sm:w-auto"
          >
            <RefreshCcw size={16} /> Refresh
          </button>
        </div>
      }
    >
      {/* Mobile cards */}
      <div className="sm:hidden space-y-3">
        {txQ.isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border p-4 animate-pulse"
            >
              <div className="h-4 w-2/3 bg-zinc-200 rounded" />
              <div className="mt-2 h-3 w-1/2 bg-zinc-200 rounded" />
              <div className="mt-4 h-9 w-full bg-zinc-200 rounded-xl" />
            </div>
          ))}

        {txQ.isError && (
          <div className="rounded-2xl border p-4 text-sm text-rose-600">
            Failed to load transactions.{" "}
            {(txQ.error as any)?.response?.data?.error ||
              (txQ.error as any)?.message ||
              ""}
          </div>
        )}

        {!txQ.isLoading && !txQ.isError && rows.length === 0 && (
          <div className="rounded-2xl border p-4 text-sm text-zinc-600">
            No transactions found.
          </div>
        )}

        {!txQ.isLoading &&
          !txQ.isError &&
          rows.map((t) => (
            <div key={t.id} className="rounded-2xl border p-4 bg-white">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-ink break-all">
                    {t.reference || t.id}
                  </div>
                  <div className="text-xs text-ink-soft mt-0.5 break-all">
                    Order: {t.orderId}
                  </div>
                  <div className="text-xs text-ink-soft mt-0.5 break-all">
                    {t.userEmail || "—"}
                  </div>
                </div>
                <StatusDot label={t.status} />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="text-xs text-ink-soft">Total</div>
                <div className="text-right text-ink">
                  {ngn.format(fmtN(t.amount))}
                </div>

                <div className="text-xs text-ink-soft">Date</div>
                <div className="text-right text-ink">
                  {fmtDate(t.createdAt)}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => onVerify(t.id)}
                  className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-zinc-900 text-white hover:opacity-90"
                >
                  Verify
                </button>
                <button
                  onClick={() => onRefund(t.id)}
                  className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-black/5"
                >
                  Refund
                </button>
              </div>
            </div>
          ))}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="min-w-[1050px] w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 text-ink">
              <th className="text-left px-3 py-2">Payment</th>
              <th className="text-left px-3 py-2">Order</th>
              <th className="text-left px-3 py-2">User</th>
              <th className="text-left px-3 py-2">Total</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {txQ.isLoading && (
              <>
                <SkeletonRow cols={7} />
                <SkeletonRow cols={7} />
                <SkeletonRow cols={7} />
              </>
            )}
            {txQ.isError && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-rose-600"
                >
                  Failed to load transactions.{" "}
                  {(txQ.error as any)?.response?.data?.error ||
                    (txQ.error as any)?.message ||
                    ""}
                </td>
              </tr>
            )}
            {!txQ.isLoading && !txQ.isError && rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-zinc-500"
                >
                  No transactions found.
                </td>
              </tr>
            )}
            {rows.map((t) => (
              <TransactionRow
                key={t.id}
                tx={t}
                onVerify={() => onVerify(t.id)}
                onRefund={() => onRefund(t.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

/* ----------------- Refunds section (Admin) ---------------------*/
function RefundsSection({ canAdmin }: { canAdmin: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { openModal, closeModal } = useModal();

  type BankOption = {
    country: "NG";
    code: string;
    name: string;
  };

  type RefundPayoutDetailsInput = {
    accountName: string;
    accountNumber: string;
    bankCode: string;
    bankName?: string;
  };

  type RefundPayoutDetailsResponse = {
    ok: true;
    data: {
      id: string;
      refundId: string;
      userId: string;
      accountName: string;
      accountNumberMasked: string;
      bankCode: string;
      bankName?: string | null;
      recipientCode?: string | null;
      transferReference?: string | null;
      transferStatus?: string | null;
      createdAt: string;
      updatedAt: string;
    } | null;
  };

  type AdminRefundItem = {
    id: string;
    qty?: number | string | null;
    orderItemId?: string | null;
    orderItem?: {
      id: string;
      title?: string | null;
      quantity?: number | string | null;
      unitPrice?: number | string | null;
      lineTotal?: number | string | null;
    } | null;
  };

  type AdminRefund = {
    id: string;
    orderId: string;
    purchaseOrderId: string;
    supplierId?: string | null;
    status: string;
    requestedAt?: string;
    createdAt?: string;
    requestedBy?: {
      email?: string;
      firstName?: string | null;
      lastName?: string | null;
      id?: string | null;
    };
    supplier?: { name?: string };
    totalAmount?: number | string;
    itemsAmount?: number | string;
    provider?: string | null;
    providerReference?: string | null;
    adminDecision?: string | null;
    adminNote?: string | null;
    reason?: string | null;
    items?: AdminRefundItem[];
    meta?: {
      liability?: {
        supplierLiabilityAmount?: number | string | null;
        platformLiabilityAmount?: number | string | null;
      };
      shippingAmount?: number | string | null;
      customerNote?: string | null;
      requestedMode?: string | null;
      evidenceCount?: number | null;
      evidenceItemIds?: string[] | null;
      evidenceByItemId?: Record<string, string[] | undefined> | null;
    } | null;
  };

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");
  const [take, setTake] = useState<number>(20);
  const [page, setPage] = useState<number>(1);

  React.useEffect(() => {
    setPage(1);
  }, [q, status, take]);

  const skip = (page - 1) * take;

  function ordersHref(orderId?: string | null) {
    if (!orderId) return "/orders";
    const id = encodeURIComponent(orderId);
    return `/orders?orderId=${id}&q=${id}`;
  }

  function fmtDate2(s?: string | null) {
    if (!s) return "—";
    const d = new Date(s);
    if (Number.isNaN(+d)) return String(s);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const ngnLocal = React.useMemo(
    () =>
      new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 2,
      }),
    []
  );

  function fmtMoney(v: any) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function getRefundBreakdown(r: AdminRefund) {
    const total = fmtMoney(r.totalAmount);
    const itemsAmount = fmtMoney(r.itemsAmount);

    const supplierLiability = fmtMoney(
      (r.meta as any)?.liability?.supplierLiabilityAmount
    );

    const platformLiability = fmtMoney(
      (r.meta as any)?.liability?.platformLiabilityAmount
    );

    const shippingAmount = fmtMoney((r.meta as any)?.shippingAmount);
    const evidenceCount = Number((r.meta as any)?.evidenceCount ?? 0) || 0;

    return {
      total,
      itemsAmount,
      supplierLiability,
      platformLiability,
      shippingAmount,
      evidenceCount,
    };
  }

  function getLiabilityKind(r: AdminRefund) {
    const b = getRefundBreakdown(r);

    if (b.supplierLiability > 0 && b.platformLiability > 0) return "SHARED";
    if (b.supplierLiability > 0) return "SUPPLIER";
    if (b.platformLiability > 0) return "PLATFORM";
    return "UNSET";
  }

  function getLiabilityLabel(r: AdminRefund) {
    const kind = getLiabilityKind(r);
    if (kind === "SUPPLIER") return "Supplier liable";
    if (kind === "PLATFORM") return "Platform liable";
    if (kind === "SHARED") return "Shared liability";
    return "Liability not set";
  }

  function getLiabilityBadgeClass(r: AdminRefund) {
    const kind = getLiabilityKind(r);

    if (kind === "SUPPLIER") {
      return "bg-amber-50 text-amber-700 border-amber-200";
    }
    if (kind === "PLATFORM") {
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    }
    if (kind === "SHARED") {
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    }
    return "bg-zinc-50 text-zinc-700 border-zinc-200";
  }

  function getEvidenceByItemId(r: AdminRefund): Record<string, string[]> {
    const raw = (r.meta as any)?.evidenceByItemId;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(raw)) {
      const urls = Array.isArray(value)
        ? value
          .map((x) => String(x ?? "").trim())
          .filter(Boolean)
        : [];
      if (urls.length) out[String(key)] = urls;
    }
    return out;
  }

  function getRefundItems(r: AdminRefund) {
    return Array.isArray(r.items) ? r.items : [];
  }

  function getRefundItemIdentity(item: AdminRefundItem) {
    return String(item.orderItem?.id || item.orderItemId || item.id || "");
  }

  function getRefundedQty(item: AdminRefundItem) {
    const n = Number(item.qty);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function getOrderedQty(item: AdminRefundItem) {
    const n = Number(item.orderItem?.quantity);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function getRefundItemUnitPrice(item: AdminRefundItem) {
    return fmtMoney(item.orderItem?.unitPrice);
  }

  function getRefundItemAmount(item: AdminRefundItem) {
    const unit = getRefundItemUnitPrice(item);
    const qty = getRefundedQty(item);
    return unit * qty;
  }

  function isPartialRefundItem(item: AdminRefundItem) {
    const refunded = getRefundedQty(item);
    const ordered = getOrderedQty(item);
    return refunded > 0 && ordered > 0 && refunded < ordered;
  }

  function getRefundItemEvidenceUrls(r: AdminRefund, item: AdminRefundItem) {
    const evidence = getEvidenceByItemId(r);
    const id = getRefundItemIdentity(item);
    return id ? evidence[id] || [] : [];
  }

  function getRefundIntelligence(r: AdminRefund) {
    const b = getRefundBreakdown(r);
    const kind = getLiabilityKind(r);
    const statusUpper = String(r.status || "").toUpperCase();
    const reasonUpper = String(r.reason || "").toUpperCase();

    const notes: string[] = [];
    const warnings: string[] = [];
    let recommendation = "";

    if (kind === "SUPPLIER") {
      recommendation = "Approve — supplier should bear the refund impact.";
    } else if (kind === "PLATFORM") {
      recommendation = "Review carefully — platform absorbs the refund impact.";
    } else if (kind === "SHARED") {
      recommendation = "Approve with review — refund impact is shared.";
    } else {
      recommendation = "Review manually — liability breakdown is missing.";
      warnings.push("Liability split has not been set.");
    }

    if (b.shippingAmount > 0) {
      notes.push(`Shipping included: ${ngnLocal.format(b.shippingAmount)}.`);
    }

    if (b.platformLiability > 0) {
      notes.push(`Platform exposure: ${ngnLocal.format(b.platformLiability)}.`);
    }

    if (b.supplierLiability > 0) {
      notes.push(`Supplier exposure: ${ngnLocal.format(b.supplierLiability)}.`);
    }

    if (b.platformLiability >= Math.max(5000, b.total * 0.4)) {
      warnings.push("High platform exposure on this refund.");
    }

    if (
      ["DAMAGED", "WRONG_ITEM", "NOT_AS_DESCRIBED", "OTHER"].includes(reasonUpper) &&
      b.evidenceCount <= 0
    ) {
      warnings.push("Evidence-sensitive reason but no evidence count is recorded.");
    }

    const refundItems = getRefundItems(r);
    if (refundItems.some(isPartialRefundItem)) {
      notes.push("Contains a partial refund item selection.");
    }

    if (statusUpper === "APPROVED") {
      notes.push("Already approved — next step is settlement.");
    }

    if (statusUpper === "REFUNDED") {
      notes.push("Customer refund already completed.");
    }

    notes.push("VAT is inclusive in product price and is not refunded separately.");

    return {
      recommendation,
      notes,
      warnings,
    };
  }

  async function getRefundPayoutDetails(refundId: string): Promise<RefundPayoutDetailsResponse> {
    const { data } = await api.get(
      `/api/refunds/${encodeURIComponent(refundId)}/payout-details`,
      { withCredentials: true }
    );
    return data;
  }

  async function saveRefundPayoutDetails(
    refundId: string,
    payload: RefundPayoutDetailsInput
  ): Promise<RefundPayoutDetailsResponse> {
    const { data } = await api.post(
      `/api/refunds/${encodeURIComponent(refundId)}/payout-details`,
      payload,
      { withCredentials: true }
    );
    return data;
  }

  async function reconcileRefund(refundId: string) {
    await api.post(
      `/api/refunds/${encodeURIComponent(refundId)}/reconcile`,
      {},
      { withCredentials: true }
    );
  }

  const banksQ = useQuery({
    queryKey: ["banks", "ng"],
    enabled: !!canAdmin,
    queryFn: async () => {
      const { data } = await api.get("/api/banks", { withCredentials: true });
      return Array.isArray(data?.data) ? (data.data as BankOption[]) : [];
    },
    staleTime: 6 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const refundsQ = useQuery({
    queryKey: ["admin", "refunds", { q, status, take, skip }],
    enabled: !!canAdmin,
    queryFn: async () => {
      const { data } = await api.get(
        `/api/refunds?q=${encodeURIComponent(q)}&status=${encodeURIComponent(
          status
        )}&take=${take}&skip=${skip}`,
        { withCredentials: true }
      );

      const root: any = data ?? {};
      const rows: AdminRefund[] =
        (Array.isArray(root?.data) ? root.data : null) ??
        (Array.isArray(root?.data?.data) ? root.data.data : null) ??
        [];
      const total: number | undefined =
        (typeof root?.total === "number" ? root.total : undefined) ??
        (typeof root?.count === "number" ? root.count : undefined) ??
        (typeof root?.data?.total === "number" ? root.data.total : undefined) ??
        (typeof root?.data?.count === "number" ? root.data.count : undefined) ??
        undefined;

      return { rows, total };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const rows: AdminRefund[] = refundsQ.data?.rows ?? [];
  const total: number | undefined = refundsQ.data?.total;

  const totalPages =
    typeof total === "number" && total >= 0
      ? Math.max(1, Math.ceil(total / take))
      : undefined;

  const canPrev = page > 1;
  const canNext =
    typeof totalPages === "number" ? page < totalPages : rows.length === take;

  const decideRefundM = useMutation({
    mutationFn: async (vars: {
      id: string;
      decision: "APPROVE" | "REJECT";
      note?: string;
    }) =>
      (
        await api.patch(
          `/api/refunds/${encodeURIComponent(vars.id)}/decision`,
          { decision: vars.decision, note: vars.note },
          { withCredentials: true }
        )
      ).data,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "refunds"] });
      toast.push({
        title: "Refunds",
        message: "Decision saved.",
        duration: 2000,
      });
      closeModal();
    },
    onError: (e: any) =>
      openModal({
        title: "Refunds",
        message: e?.response?.data?.error || "Failed.",
      }),
  });

  const markRefundedM = useMutation({
    mutationFn: async (vars: {
      id: string;
      payload?: {
        mode?: "AUTO" | "PROVIDER_REFUND" | "BANK_TRANSFER";
        note?: string;
        payout?: RefundPayoutDetailsInput;
      };
    }) =>
      (
        await api.post(
          `/api/refunds/${encodeURIComponent(vars.id)}/mark-refunded`,
          vars.payload ?? {},
          { withCredentials: true }
        )
      ).data,
    onSuccess: async (resp: any) => {
      await qc.invalidateQueries({ queryKey: ["admin", "refunds"] });
      await qc.invalidateQueries({ queryKey: ["orders"] });
      await qc.invalidateQueries({ queryKey: ["adminOrders"] });

      const alreadyRefunded = !!resp?.meta?.alreadyRefunded;
      const repairedLinkedData = !!resp?.meta?.repairedLinkedData;
      const settlementMode = String(resp?.meta?.settlementMode || "");

      toast.push({
        title: "Refunds",
        message: alreadyRefunded
          ? repairedLinkedData
            ? "Refund already existed; linked data reconciled."
            : "Refund was already marked refunded."
          : settlementMode
            ? `Refund completed via ${settlementMode.replace(/_/g, " ").toLowerCase()}.`
            : "Marked refunded.",
        duration: 3000,
      });

      closeModal();
    },
    onError: (e: any) =>
      openModal({
        title: "Refunds",
        message:
          e?.response?.data?.error ||
          e?.response?.data?.message ||
          "Failed.",
      }),
  });

  const savePayoutDetailsM = useMutation({
    mutationFn: async (vars: {
      refundId: string;
      payload: RefundPayoutDetailsInput;
    }) => saveRefundPayoutDetails(vars.refundId, vars.payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "refunds"] });
      toast.push({
        title: "Refund payout details",
        message: "Payout details saved.",
        duration: 2200,
      });
    },
    onError: (e: any) =>
      openModal({
        title: "Refund payout details",
        message: e?.response?.data?.error || "Failed to save payout details.",
      }),
  });

  const reconcileRefundM = useMutation({
    mutationFn: async (refundId: string) => reconcileRefund(refundId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "refunds"] });
      await qc.invalidateQueries({ queryKey: ["orders"] });
      await qc.invalidateQueries({ queryKey: ["adminOrders"] });
      toast.push({
        title: "Refunds",
        message: "Refund reconciled.",
        duration: 2200,
      });
    },
    onError: (e: any) =>
      openModal({
        title: "Refunds",
        message: e?.response?.data?.error || "Failed to reconcile refund.",
      }),
  });

  const isMutating =
    decideRefundM.isPending ||
    markRefundedM.isPending ||
    savePayoutDetailsM.isPending ||
    reconcileRefundM.isPending;

  function renderRefundItemsBlock(r: AdminRefund) {
    const refundItems = getRefundItems(r);

    if (!refundItems.length) {
      return (
        <div className="rounded-lg border bg-zinc-50 p-3 text-sm text-zinc-600">
          No refund item rows were returned.
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {refundItems.map((item) => {
          const itemId = getRefundItemIdentity(item);
          const refundedQty = getRefundedQty(item);
          const orderedQty = getOrderedQty(item);
          const unitPrice = getRefundItemUnitPrice(item);
          const refundAmount = getRefundItemAmount(item);
          const evidenceUrls = getRefundItemEvidenceUrls(r, item);

          return (
            <div key={item.id} className="rounded-xl border p-3 bg-white">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-zinc-900 break-words">
                    {item.orderItem?.title || "Refund item"}
                  </div>

                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-600">
                    <span>Refunding {refundedQty || 0}</span>
                    <span>of {orderedQty || 0}</span>
                    <span>•</span>
                    <span>Unit {ngnLocal.format(unitPrice)}</span>
                    {itemId ? (
                      <>
                        <span>•</span>
                        <span className="font-mono">{itemId}</span>
                      </>
                    ) : null}
                  </div>

                  {isPartialRefundItem(item) ? (
                    <div className="mt-2">
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        Partial refund
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-xs text-zinc-500">Refund amount</div>
                  <div className="font-semibold text-zinc-900">
                    {ngnLocal.format(refundAmount)}
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <div className="text-xs font-medium text-zinc-700">
                  Evidence {evidenceUrls.length ? `(${evidenceUrls.length})` : ""}
                </div>

                {evidenceUrls.length ? (
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {evidenceUrls.map((url, idx) => (
                      <a
                        key={`${item.id}-${url}-${idx}`}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-xl border bg-zinc-50 hover:opacity-90"
                      >
                        <img
                          src={url}
                          alt={`Evidence ${idx + 1}`}
                          className="h-24 w-full object-cover"
                        />
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-zinc-500">
                    No evidence images recorded for this item.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function openRefundViewModal(r: AdminRefund) {
    const b = getRefundBreakdown(r);
    const intel = getRefundIntelligence(r);

    openModal({
      title: `Refund ${r.orderId || r.id}`,
      message: (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-white">
              {String(r.status)}
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${getLiabilityBadgeClass(
                r
              )}`}
            >
              {getLiabilityLabel(r)}
            </span>
          </div>

          <div className="text-sm">
            <b>PO:</b> {r.purchaseOrderId || "—"}
          </div>

          <div className="text-sm">
            <b>Supplier:</b> {r.supplier?.name || r.supplierId || "—"}
          </div>

          <div className="rounded-lg border bg-zinc-50 p-3 space-y-1 text-sm">
            <div>
              <b>Total refund:</b> {ngnLocal.format(b.total)}
            </div>
            <div>
              <b>Items:</b> {ngnLocal.format(b.itemsAmount)}
            </div>
            <div>Supplier liability: {ngnLocal.format(b.supplierLiability)}</div>
            <div>Platform liability: {ngnLocal.format(b.platformLiability)}</div>
            {b.shippingAmount > 0 ? (
              <div>Shipping: {ngnLocal.format(b.shippingAmount)}</div>
            ) : null}
            <div className="text-[11px] text-blue-600 pt-1">
              VAT is inclusive in product price and is not refunded separately.
            </div>
          </div>

          <div className="rounded-lg border bg-amber-50 p-3">
            <div className="text-xs font-semibold text-amber-800 mb-1">
              Refund intelligence
            </div>
            <div className="text-sm text-amber-900">{intel.recommendation}</div>

            {intel.notes.length ? (
              <ul className="mt-2 space-y-1 text-xs text-zinc-700">
                {intel.notes.map((n, i) => (
                  <li key={i}>• {n}</li>
                ))}
              </ul>
            ) : null}

            {intel.warnings.length ? (
              <ul className="mt-2 space-y-1 text-xs text-rose-700">
                {intel.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">
              Refunded items
            </div>
            {renderRefundItemsBlock(r)}
          </div>

          <div className="text-xs text-zinc-500">
            Provider: {r.provider || "—"}
          </div>
          <div className="text-xs text-zinc-500">
            Provider ref: {r.providerReference || "—"}
          </div>
          <div className="text-xs text-zinc-500">
            Admin decision: {r.adminDecision || "—"}
          </div>

          {r.reason ? (
            <div className="text-sm text-zinc-700">
              <b>Reason:</b> {String(r.reason).replace(/_/g, " ")}
            </div>
          ) : null}

          {(r.meta as any)?.customerNote ? (
            <div className="text-sm text-zinc-700">
              <b>Customer note:</b> {(r.meta as any).customerNote}
            </div>
          ) : null}

          {r.adminNote ? (
            <div className="text-sm text-zinc-700">
              <b>Admin note:</b> {r.adminNote}
            </div>
          ) : null}
        </div>
      ),
    });
  }

  function openApproveModal(r: AdminRefund) {
    const intel = getRefundIntelligence(r);

    const RefundApproveModal = () => {
      const [note, setNote] = useState("");

      return (
        <div className="space-y-4">
          <div className="text-sm text-zinc-700">
            Approve refund for order <b>{r.orderId}</b>?
          </div>

          <div className="rounded-lg border bg-emerald-50 p-3">
            <div className="text-xs font-semibold text-emerald-800 mb-1">
              Recommendation
            </div>
            <div className="text-sm text-emerald-900">{intel.recommendation}</div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">
              Refunded items
            </div>
            {renderRefundItemsBlock(r)}
          </div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="Admin note (optional)"
            className="w-full rounded-xl border px-3 py-2"
          />

          <div className="flex items-center justify-end gap-2">
            <button
              className="rounded-xl border bg-white px-3 py-2 hover:bg-black/5"
              onClick={() => closeModal()}
              disabled={decideRefundM.isPending}
            >
              Cancel
            </button>
            <button
              className="rounded-xl bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-700 disabled:opacity-50"
              disabled={decideRefundM.isPending}
              onClick={() =>
                decideRefundM.mutate({
                  id: r.id,
                  decision: "APPROVE",
                  note: note.trim() || undefined,
                })
              }
            >
              Approve
            </button>
          </div>
        </div>
      );
    };

    openModal({
      title: `Approve refund ${r.orderId || r.id}`,
      message: <RefundApproveModal />,
      size: "md",
    });
  }

  function openRejectModal(r: AdminRefund) {
    const intel = getRefundIntelligence(r);

    const RefundRejectModal = () => {
      const [note, setNote] = useState("");

      return (
        <div className="space-y-4">
          <div className="text-sm text-zinc-700">
            Reject refund for order <b>{r.orderId}</b>?
          </div>

          {intel.warnings.length ? (
            <div className="rounded-lg border bg-rose-50 p-3">
              <div className="text-xs font-semibold text-rose-800 mb-1">
                Review warnings
              </div>
              <ul className="space-y-1 text-sm text-rose-900">
                {intel.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">
              Refunded items
            </div>
            {renderRefundItemsBlock(r)}
          </div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="Reject reason / admin note"
            className="w-full rounded-xl border px-3 py-2"
          />

          <div className="flex items-center justify-end gap-2">
            <button
              className="rounded-xl border bg-white px-3 py-2 hover:bg-black/5"
              onClick={() => closeModal()}
              disabled={decideRefundM.isPending}
            >
              Cancel
            </button>
            <button
              className="rounded-xl bg-rose-600 px-3 py-2 text-white hover:bg-rose-700 disabled:opacity-50"
              disabled={decideRefundM.isPending}
              onClick={() =>
                decideRefundM.mutate({
                  id: r.id,
                  decision: "REJECT",
                  note: note.trim() || undefined,
                })
              }
            >
              Reject
            </button>
          </div>
        </div>
      );
    };

    openModal({
      title: `Reject refund ${r.orderId || r.id}`,
      message: <RefundRejectModal />,
      size: "md",
    });
  }

  function openPayoutDetailsModal(r: AdminRefund) {
    const intel = getRefundIntelligence(r);

    const RefundPayoutModal = () => {
      const [loading, setLoading] = useState(true);
      const [saving, setSaving] = useState(false);
      const [submittingRefund, setSubmittingRefund] = useState(false);
      const [error, setError] = useState<string | null>(null);

      const [accountName, setAccountName] = useState("");
      const [accountNumber, setAccountNumber] = useState("");
      const [bankCode, setBankCode] = useState("");
      const [bankName, setBankName] = useState("");
      const [note, setNote] = useState("");

      const [existingMaskedAccount, setExistingMaskedAccount] = useState<string | null>(null);
      const [existingRecipientCode, setExistingRecipientCode] = useState<string | null>(null);
      const [existingTransferReference, setExistingTransferReference] = useState<string | null>(null);
      const [existingTransferStatus, setExistingTransferStatus] = useState<string | null>(null);

      useEffect(() => {
        let mounted = true;

        (async () => {
          try {
            setLoading(true);
            setError(null);

            const resp = await getRefundPayoutDetails(r.id);
            const details = resp?.data ?? null;

            if (!mounted) return;

            if (details) {
              setAccountName(details.accountName || "");
              setBankCode(details.bankCode || "");
              setBankName(details.bankName || "");
              setExistingMaskedAccount(details.accountNumberMasked || null);
              setExistingRecipientCode(details.recipientCode || null);
              setExistingTransferReference(details.transferReference || null);
              setExistingTransferStatus(details.transferStatus || null);
            }
          } catch (e: any) {
            if (!mounted) return;
            setError(e?.response?.data?.error || e?.message || "Failed to load payout details.");
          } finally {
            if (mounted) setLoading(false);
          }
        })();

        return () => {
          mounted = false;
        };
      }, []);

      const bankOptions = banksQ.data ?? [];
      const selectedBank = bankOptions.find((b) => b.code === bankCode) ?? null;

      const canSave =
        accountName.trim().length > 1 &&
        /^\d{10}$/.test(accountNumber.trim()) &&
        bankCode.trim().length > 0;

      return (
        <div className="space-y-4">
          <div className="rounded-lg border bg-zinc-50 p-3 text-sm">
            <div>
              Refund <b>{r.id}</b> • Amount{" "}
              <b>{ngnLocal.format(fmtMoney(r.totalAmount))}</b>
            </div>
            <div className="mt-1 text-xs text-zinc-600">
              {intel.recommendation}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-900">
              Refunded items
            </div>
            {renderRefundItemsBlock(r)}
          </div>

          {loading ? (
            <div className="text-sm text-zinc-500">Loading payout details…</div>
          ) : (
            <>
              {existingMaskedAccount ? (
                <div className="rounded-xl border bg-zinc-50 p-3 text-xs text-zinc-700 space-y-1">
                  <div>
                    <b>Existing account:</b> {existingMaskedAccount}
                  </div>
                  {existingRecipientCode ? (
                    <div>
                      <b>Recipient code:</b> {existingRecipientCode}
                    </div>
                  ) : null}
                  {existingTransferReference ? (
                    <div>
                      <b>Transfer ref:</b> {existingTransferReference}
                    </div>
                  ) : null}
                  {existingTransferStatus ? (
                    <div>
                      <b>Transfer status:</b> {existingTransferStatus}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div>
                <label className="block text-xs text-zinc-500 mb-1">Account name</label>
                <input
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2"
                  placeholder="Customer account name"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1">Account number</label>
                <input
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="w-full rounded-xl border px-3 py-2"
                  placeholder="10-digit account number"
                  inputMode="numeric"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Bank</label>
                  <select
                    value={bankCode}
                    onChange={(e) => {
                      const code = e.target.value;
                      setBankCode(code);
                      const bank = bankOptions.find((b) => b.code === code);
                      setBankName(bank?.name || "");
                    }}
                    className="w-full rounded-xl border px-3 py-2 bg-white"
                  >
                    <option value="">Select bank</option>
                    {bankOptions.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Bank code</label>
                  <input
                    value={bankCode}
                    readOnly
                    className="w-full rounded-xl border px-3 py-2 bg-zinc-50 text-zinc-700"
                    placeholder="Auto-filled from selected bank"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1">Bank name</label>
                <input
                  value={selectedBank?.name || bankName}
                  readOnly
                  className="w-full rounded-xl border px-3 py-2 bg-zinc-50 text-zinc-700"
                  placeholder="Auto-filled from selected bank"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1">Note (optional)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border px-3 py-2"
                  placeholder="Optional refund note"
                />
              </div>
            </>
          )}

          {error ? <div className="text-sm text-rose-600">{error}</div> : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              className="rounded-xl border bg-white px-3 py-2 hover:bg-black/5"
              onClick={() => closeModal()}
              disabled={saving || submittingRefund}
            >
              Close
            </button>

            <button
              className="rounded-xl border bg-white px-3 py-2 hover:bg-black/5 disabled:opacity-50"
              disabled={!canSave || saving || submittingRefund}
              onClick={async () => {
                try {
                  setSaving(true);
                  setError(null);

                  await savePayoutDetailsM.mutateAsync({
                    refundId: r.id,
                    payload: {
                      accountName: accountName.trim(),
                      accountNumber: accountNumber.trim(),
                      bankCode: bankCode.trim(),
                      bankName: (selectedBank?.name || bankName || "").trim() || undefined,
                    },
                  });

                  const refreshed = await getRefundPayoutDetails(r.id);
                  const details = refreshed?.data ?? null;

                  setExistingMaskedAccount(details?.accountNumberMasked ?? null);
                  setExistingRecipientCode(details?.recipientCode ?? null);
                  setExistingTransferReference(details?.transferReference ?? null);
                  setExistingTransferStatus(details?.transferStatus ?? null);
                } catch (e: any) {
                  setError(e?.response?.data?.error || e?.message || "Failed to save payout details.");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving…" : "Save payout details"}
            </button>

            <button
              className="rounded-xl bg-zinc-900 px-3 py-2 text-white hover:opacity-90 disabled:opacity-50"
              disabled={submittingRefund || loading}
              onClick={async () => {
                try {
                  setSubmittingRefund(true);
                  setError(null);

                  const payload: {
                    mode: "AUTO";
                    note?: string;
                    payout?: RefundPayoutDetailsInput;
                  } = {
                    mode: "AUTO",
                    note: note.trim() || "Refund completed by admin",
                  };

                  if (canSave) {
                    payload.payout = {
                      accountName: accountName.trim(),
                      accountNumber: accountNumber.trim(),
                      bankCode: bankCode.trim(),
                      bankName: (selectedBank?.name || bankName || "").trim() || undefined,
                    };
                  }

                  await markRefundedM.mutateAsync({
                    id: r.id,
                    payload,
                  });
                } catch (e: any) {
                  setError(
                    e?.response?.data?.error ||
                    e?.response?.data?.message ||
                    e?.message ||
                    "Failed to mark refunded."
                  );
                } finally {
                  setSubmittingRefund(false);
                }
              }}
            >
              {submittingRefund ? "Submitting…" : "Save + mark refunded"}
            </button>
          </div>
        </div>
      );
    };

    openModal({
      title: `Refund payout details • ${r.orderId || r.id}`,
      message: <RefundPayoutModal />,
      size: "md",
    });
  }

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="px-4 md:px-5 py-3 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-[180px]">
          <h3 className="text-ink font-semibold">Refunds</h3>
          <p className="text-xs text-ink-soft">
            Review supplier/customer refund cases and settle them.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:flex sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search orderId / poId / supplierId / reference…"
            className="w-full sm:w-[340px] px-3 py-2 rounded-xl border bg-white"
          />

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 rounded-xl border bg-white text-sm w-full sm:w-auto"
          >
            <option value="">All statuses</option>
            <option value="REQUESTED">REQUESTED</option>
            <option value="SUPPLIER_REVIEW">SUPPLIER_REVIEW</option>
            <option value="SUPPLIER_ACCEPTED">SUPPLIER_ACCEPTED</option>
            <option value="SUPPLIER_REJECTED">SUPPLIER_REJECTED</option>
            <option value="ESCALATED">ESCALATED</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="REFUNDED">REFUNDED</option>
            <option value="CLOSED">CLOSED</option>
          </select>

          <select
            value={String(take)}
            onChange={(e) => setTake(Number(e.target.value) || 20)}
            className="px-3 py-2 rounded-xl border bg-white text-sm w-full sm:w-auto"
            title="Rows per page"
          >
            <option value="10">10 / page</option>
            <option value="20">20 / page</option>
            <option value="50">50 / page</option>
          </select>

          <button
            onClick={() => refundsQ.refetch()}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-black/5 text-sm w-full sm:w-auto"
            disabled={refundsQ.isFetching}
          >
            <RefreshCcw size={16} /> Refresh
          </button>
        </div>
      </div>

      <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-zinc-600">
          {refundsQ.isFetching
            ? "Loading…"
            : refundsQ.isError
              ? "Failed to load."
              : typeof total === "number"
                ? `Showing ${Math.min(skip + 1, total)}–${Math.min(skip + rows.length, total)} of ${total}`
                : `Showing ${rows.length} item(s)`}
        </div>

        <div className="inline-flex items-center gap-2">
          <button
            className="px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5 text-sm disabled:opacity-50"
            disabled={!canPrev || refundsQ.isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>

          <div className="text-sm text-zinc-700">
            Page <b>{page}</b>
            {typeof totalPages === "number" ? (
              <>
                {" "}of <b>{totalPages}</b>
              </>
            ) : null}
          </div>

          <button
            className="px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5 text-sm disabled:opacity-50"
            disabled={!canNext || refundsQ.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>

      <div className="sm:hidden p-4 space-y-3">
        {refundsQ.isLoading && (
          <>
            <div className="rounded-2xl border p-4 animate-pulse">
              <div className="h-4 w-2/3 bg-zinc-200 rounded" />
              <div className="mt-2 h-3 w-1/2 bg-zinc-200 rounded" />
              <div className="mt-4 h-9 w-full bg-zinc-200 rounded-xl" />
            </div>
            <div className="rounded-2xl border p-4 animate-pulse">
              <div className="h-4 w-2/3 bg-zinc-200 rounded" />
              <div className="mt-2 h-3 w-1/2 bg-zinc-200 rounded" />
              <div className="mt-4 h-9 w-full bg-zinc-200 rounded-xl" />
            </div>
          </>
        )}

        {refundsQ.isError && (
          <div className="rounded-2xl border p-4 text-sm text-rose-600">
            Failed to load refunds.
          </div>
        )}

        {!refundsQ.isLoading && !refundsQ.isError && rows.length === 0 && (
          <div className="rounded-2xl border p-4 text-sm text-zinc-600">
            No refunds found.
          </div>
        )}

        {!refundsQ.isLoading &&
          !refundsQ.isError &&
          rows.map((r) => {
            const statusUpper = String(r.status || "").toUpperCase();
            const disableDecision =
              statusUpper === "REFUNDED" || statusUpper === "CLOSED";

            const b = getRefundBreakdown(r);
            const intel = getRefundIntelligence(r);
            const refundItems = getRefundItems(r);

            return (
              <div key={r.id} className="rounded-2xl border p-4 bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink break-all">
                      {r.orderId || r.id}
                    </div>
                    <div className="text-xs text-ink-soft mt-0.5 break-all">
                      PO: {r.purchaseOrderId || "—"}
                    </div>
                    <div className="text-xs text-ink-soft mt-0.5 break-all">
                      Supplier: {r.supplier?.name || r.supplierId || "—"}
                    </div>
                  </div>
                  <StatusDot label={r.status} />
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${getLiabilityBadgeClass(
                      r
                    )}`}
                  >
                    {getLiabilityLabel(r)}
                  </span>
                  {refundItems.some(isPartialRefundItem) ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border border-amber-200 bg-amber-50 text-amber-700">
                      Partial items present
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 rounded-xl border bg-zinc-50 p-3 text-sm space-y-1">
                  <div className="font-semibold text-zinc-900">
                    {ngnLocal.format(b.total)}
                  </div>
                  <div className="text-xs text-zinc-600">
                    Items: {ngnLocal.format(b.itemsAmount)}
                  </div>
                  <div className="text-xs text-zinc-600">
                    Supplier: {ngnLocal.format(b.supplierLiability)}
                  </div>
                  <div className="text-xs text-zinc-600">
                    Platform: {ngnLocal.format(b.platformLiability)}
                  </div>
                  {b.shippingAmount > 0 ? (
                    <div className="text-xs text-zinc-600">
                      Shipping: {ngnLocal.format(b.shippingAmount)}
                    </div>
                  ) : null}
                  <div className="text-[11px] text-blue-600">
                    VAT included, not refunded separately
                  </div>
                </div>

                <div className="mt-3 text-xs text-zinc-700">
                  <b>Recommendation:</b> {intel.recommendation}
                </div>

                {intel.warnings.length ? (
                  <div className="mt-2 space-y-1">
                    {intel.warnings.map((w, i) => (
                      <div key={i} className="text-xs text-rose-700">
                        ⚠ {w}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Link
                    to={ordersHref(r.orderId)}
                    className="inline-flex items-center justify-center px-3 py-2 rounded-xl border bg-white hover:bg-black/5"
                  >
                    Order
                  </Link>

                  <button
                    className="inline-flex items-center justify-center px-3 py-2 rounded-xl border bg-white hover:bg-black/5"
                    disabled={isMutating}
                    onClick={() => openRefundViewModal(r)}
                  >
                    View
                  </button>

                  <button
                    className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    disabled={disableDecision || isMutating}
                    onClick={() => openApproveModal(r)}
                  >
                    Approve
                  </button>

                  <button
                    className="px-3 py-2 rounded-xl bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                    disabled={disableDecision || isMutating}
                    onClick={() => openRejectModal(r)}
                  >
                    Reject
                  </button>

                  <button
                    className="col-span-2 px-3 py-2 rounded-xl border bg-white hover:bg-black/5 disabled:opacity-50"
                    disabled={isMutating}
                    onClick={() => openPayoutDetailsModal(r)}
                  >
                    Payout details / refund
                  </button>

                  <button
                    className="col-span-2 px-3 py-2 rounded-xl border bg-white hover:bg-black/5 disabled:opacity-50"
                    disabled={isMutating}
                    onClick={() => reconcileRefundM.mutate(r.id)}
                  >
                    Fix / Reconcile
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      <div className="hidden sm:block p-4 pr-1 md:p-5 md:pr-2">
        <div className="overflow-x-auto relative">
          <table className="min-w-[1500px] w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-ink">
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[220px]">Order</th>
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[220px]">PO</th>
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[240px]">Supplier</th>
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[240px]">Requested By</th>
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[260px]">Refund breakdown</th>
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[320px]">Items / evidence</th>
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[220px]">Intelligence</th>
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[160px]">Status</th>
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[180px]">Created</th>
                <th
                  className="sticky right-0 z-40 text-right px-3 py-2 bg-zinc-50 whitespace-nowrap w-[260px] min-w-[260px] max-w-[260px] border-l"
                  style={{ boxShadow: "-10px 0 16px -14px rgba(0,0,0,0.35)" }}
                >
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {refundsQ.isLoading && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-zinc-500">
                    Loading refunds…
                  </td>
                </tr>
              )}

              {refundsQ.isError && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-rose-600">
                    Failed to load refunds.
                  </td>
                </tr>
              )}

              {!refundsQ.isLoading && !refundsQ.isError && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-zinc-500">
                    No refunds found.
                  </td>
                </tr>
              )}

              {rows.map((r) => {
                const statusUpper = String(r.status || "").toUpperCase();
                const disableDecision =
                  statusUpper === "REFUNDED" || statusUpper === "CLOSED";

                const b = getRefundBreakdown(r);
                const intel = getRefundIntelligence(r);
                const refundItems = getRefundItems(r);
                const previewItems = refundItems.slice(0, 2);

                return (
                  <tr key={r.id} className="hover:bg-black/5">
                    <td className="px-3 py-3 whitespace-nowrap">
                      {r.orderId ? (
                        <Link
                          to={ordersHref(r.orderId)}
                          className="font-semibold text-indigo-700 hover:underline"
                          title="Open Orders filtered by this orderId"
                        >
                          {r.orderId}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap">{r.purchaseOrderId || "—"}</td>

                    <td className="px-3 py-3 whitespace-nowrap">
                      <span
                        className="inline-block max-w-[240px] truncate align-bottom"
                        title={r.supplier?.name || r.supplierId || ""}
                      >
                        {r.supplier?.name || r.supplierId || "—"}
                      </span>
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap">
                      <span
                        className="inline-block max-w-[220px] truncate align-bottom"
                        title={r.requestedBy?.email || ""}
                      >
                        {r.requestedBy?.email || "—"}
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      <div className="space-y-1 min-w-[220px]">
                        <div className="font-semibold text-zinc-900">
                          {ngnLocal.format(b.total)}
                        </div>

                        <div className="text-[11px] text-zinc-600">
                          Items: {ngnLocal.format(b.itemsAmount)}
                        </div>

                        <div className="text-[11px] text-zinc-600">
                          Supplier: {ngnLocal.format(b.supplierLiability)}
                        </div>

                        <div className="text-[11px] text-zinc-600">
                          Platform: {ngnLocal.format(b.platformLiability)}
                        </div>

                        {b.shippingAmount > 0 ? (
                          <div className="text-[11px] text-zinc-600">
                            Shipping: {ngnLocal.format(b.shippingAmount)}
                          </div>
                        ) : null}

                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${getLiabilityBadgeClass(
                            r
                          )}`}
                        >
                          {getLiabilityLabel(r)}
                        </span>

                        <div className="text-[10px] text-blue-600">
                          VAT included, not refunded separately
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-3">
                      <div className="min-w-[300px] space-y-2">
                        {previewItems.length === 0 ? (
                          <div className="text-xs text-zinc-500">No item rows</div>
                        ) : (
                          previewItems.map((item) => {
                            const refundedQty = getRefundedQty(item);
                            const orderedQty = getOrderedQty(item);
                            const evidenceUrls = getRefundItemEvidenceUrls(r, item);

                            return (
                              <div key={item.id} className="rounded-lg border bg-zinc-50 p-2">
                                <div className="text-xs font-medium text-zinc-900 truncate">
                                  {item.orderItem?.title || "Refund item"}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-zinc-600">
                                  <span>
                                    {refundedQty} of {orderedQty}
                                  </span>
                                  <span>•</span>
                                  <span>{ngnLocal.format(getRefundItemAmount(item))}</span>
                                  <span>•</span>
                                  <span>{evidenceUrls.length} evidence</span>
                                </div>
                                {isPartialRefundItem(item) ? (
                                  <div className="mt-1">
                                    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                      Partial
                                    </span>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })
                        )}

                        {refundItems.length > previewItems.length ? (
                          <div className="text-[11px] text-zinc-500">
                            +{refundItems.length - previewItems.length} more item(s)
                          </div>
                        ) : null}
                      </div>
                    </td>

                    <td className="px-3 py-3">
                      <div className="min-w-[210px] space-y-1">
                        <div className="text-xs font-medium text-zinc-900">
                          {intel.recommendation}
                        </div>
                        {intel.warnings.slice(0, 2).map((w, i) => (
                          <div key={i} className="text-[11px] text-rose-700">
                            ⚠ {w}
                          </div>
                        ))}
                      </div>
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-white whitespace-nowrap">
                        {String(r.status)}
                      </span>
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap">
                      {fmtDate2(r.createdAt || r.requestedAt)}
                    </td>

                    <td
                      className="sticky right-0 z-30 px-3 py-3 text-right bg-white w-[260px] min-w-[260px] max-w-[260px] border-l"
                      style={{ boxShadow: "-10px 0 16px -14px rgba(0,0,0,0.25)" }}
                    >
                      <div className="inline-flex flex-col items-end gap-2">
                        <button
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5"
                          disabled={isMutating}
                          onClick={() => openRefundViewModal(r)}
                        >
                          View
                        </button>

                        <button
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          disabled={disableDecision || isMutating}
                          onClick={() => openApproveModal(r)}
                        >
                          Approve
                        </button>

                        <button
                          className="px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                          disabled={disableDecision || isMutating}
                          onClick={() => openRejectModal(r)}
                        >
                          Reject
                        </button>

                        <button
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5 disabled:opacity-50"
                          disabled={isMutating}
                          onClick={() => openPayoutDetailsModal(r)}
                        >
                          Payout details / refund
                        </button>

                        <button
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5 disabled:opacity-50"
                          disabled={isMutating}
                          onClick={() => reconcileRefundM.mutate(r.id)}
                        >
                          Fix / Reconcile
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {typeof totalPages !== "number" && rows.length === take ? (
            <div className="mt-3 text-xs text-zinc-500">
              Showing a full page — click <b>Next</b> to load more.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------ Finance section ----------------------*/
function FinanceSection({ canAdmin }: { canAdmin: boolean }) {
  const [subTab, setSubTab] = useState<"payouts" | "ledger">("payouts");

  const AdminPayoutsAny = AdminPayoutsPanel as any;
  const AdminLedgerAny = AdminLedgerPanel as any;

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="px-4 md:px-5 py-3 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-[180px]">
          <h3 className="text-ink font-semibold">Finance</h3>
          <p className="text-xs text-ink-soft">
            Release supplier payouts, view allocations, and post ledger
            adjustments.
          </p>
        </div>

        <div className="inline-flex rounded-xl border overflow-hidden w-full sm:w-auto">
          <button
            onClick={() => setSubTab("payouts")}
            className={`flex-1 sm:flex-none px-3 py-2 text-sm ${subTab === "payouts"
              ? "bg-zinc-900 text-white"
              : "bg-white hover:bg-black/5"
              }`}
          >
            Payouts
          </button>
          <button
            onClick={() => setSubTab("ledger")}
            className={`flex-1 sm:flex-none px-3 py-2 text-sm ${subTab === "ledger"
              ? "bg-zinc-900 text-white"
              : "bg-white hover:bg-black/5"
              }`}
          >
            Ledger
          </button>
        </div>
      </div>

      <div className="p-4 md:p-5">
        {subTab === "payouts" ? (
          <AdminPayoutsAny canAdmin={canAdmin} />
        ) : (
          <AdminLedgerAny canAdmin={canAdmin} />
        )}
      </div>
    </div>
  );
}

/* ---------------- Small presentational bits ---------------- */
function KpiCard({
  title,
  value,
  hint,
  Icon,
  chart,
}: {
  title: string;
  value: string;
  hint?: string;
  Icon: any;
  chart?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-ink-soft">{title}</div>
          <div className="text-xl font-semibold text-ink mt-0.5">{value}</div>
          {!!hint && <div className="text-xs text-ink-soft mt-1">{hint}</div>}
        </div>
        <span className="inline-grid place-items-center w-10 h-10 rounded-xl bg-primary-50">
          <Icon size={18} />
        </span>
      </div>
      {chart && <div className="mt-2">{chart}</div>}
    </div>
  );
}

function KpiCardOverview({
  title,
  total,
  value,
  hint,
  res,
  Icon,
  chart,
}: {
  title: string;
  total: string;
  value: string;
  hint?: string;
  res?: string;
  Icon: any;
  chart?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-ink-soft">{title}</div>
          <div className="text-xl font-semibold text-ink mt-0.5">{total}</div>
          <div className="text-lg font-semibold text-ink mt-0.5">
            {value}
          </div>
          {!!hint && <div className="text-xs text-ink-soft mt-1">{hint}</div>}
          {!!res && <div className="text-xs text-ink-soft mt-1">{res}</div>}
        </div>
        <span className="inline-grid place-items-center w-10 h-10 rounded-xl bg-primary-50">
          <Icon size={18} />
        </span>
      </div>
      {chart && <div className="mt-2">{chart}</div>}
    </div>
  );
}

function StatusDot({ label }: { label?: string | null }) {
  const s = (label || "").toUpperCase();
  const cls =
    s === "VERIFIED" || s === "PUBLISHED" || s === "PAID"
      ? "bg-emerald-600/10 text-emerald-700 border-emerald-600/20"
      : s === "PENDING"
        ? "bg-amber-500/10 text-amber-700 border-amber-600/20"
        : s === "FAILED" ||
          s === "CANCELED" ||
          s === "REJECTED" ||
          s === "REFUNDED"
          ? "bg-rose-500/10 text-rose-700 border-rose-600/20"
          : s === "SUSPENDED" ||
            s === "DEACTIVATED" ||
            s === "DISABLED"
            ? "bg-rose-500/10 text-rose-700 border-rose-600/20"
            : "bg-zinc-500/10 text-zinc-700 border-zinc-600/20";

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${cls}`}
    >
      {label}
    </span>
  );
}

function RoleSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (role: string) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`border rounded-lg px-2 py-1 text-sm bg-white ${disabled ? "opacity-60 cursor-not-allowed" : ""
        }`}
    >
      <option value="SHOPPER">SHOPPER</option>
      <option value="ADMIN">ADMIN</option>
      <option value="SUPER_ADMIN">SUPER_ADMIN</option>
    </select>
  );
}

function QuickAction({
  toAction,
  icon: Icon,
  label,
  desc,
}: {
  toAction: () => void;
  icon: any;
  label: string;
  desc: string;
}) {
  return (
    <button
      onClick={toAction}
      className="group rounded-2xl border bg-white p-4 text-left hover:shadow-md transition"
    >
      <div className="flex items-center gap-3">
        <span className="inline-grid place-items-center w-10 h-10 rounded-xl bg-primary-50">
          <Icon size={18} />
        </span>
        <div>
          <div className="font-semibold text-ink group-hover:underline">
            {label}
          </div>
          <div className="text-xs text-ink-soft">{desc}</div>
        </div>
      </div>
    </button>
  );
}

/* ---------------- hooks ---------------- */
function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}