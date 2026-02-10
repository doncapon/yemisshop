// src/pages/AdminDashboard.tsx
import { useEffect, useRef, useState, type ReactNode, type JSX } from "react";
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
} from "lucide-react";
import React from "react";

import api from "../../api/client.js";
import { useAuthStore } from "../../store/auth.js";
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
  profitToday: number;
  revenueToday: number;
  sparklineProfit7d: number[];
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
  | "transactions"
  | "refunds"
  | "catalog"
  | "ops"
  | "marketing"
  | "analytics"
  | "finance";

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
  const el = (evt.target as HTMLElement)?.closest?.('a[href="#"],a[href=""]');
  if (el) {
    evt.preventDefault();
    evt.stopPropagation();
  }
};

/* =========================================================
   AdminDashboard
   ========================================================= */
export default function AdminDashboard() {
  const { token } = useAuthStore();
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

  const validTabs: TabKey[] = [
    "overview",
    "users",
    "products",
    "transactions",
    "refunds",
    "catalog",
    "ops",
    "marketing",
    "analytics",
    "finance",
  ];

  const validPTabs: ProductsInnerTab[] = ["moderation", "manage"];

  // ✅ Key fix: do NOT reset tab/pTab just because q changed or tab param is missing.
  // This prevents ManageProducts from unmounting (and losing input focus) when typing.
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
    // First load: if tab missing, default to overview.
    // Subsequent changes: only change tab if URL explicitly provides a valid tab.
    if (!didInitFromUrl.current) {
      const nextTab: TabKey = hasValidTab ? urlTab : "overview";
      if (nextTab !== tab) setTab(nextTab);
      didInitFromUrl.current = true;
    } else {
      // Only update tab if the tab param exists and changed.
      if (rawTabParam && rawTabParam !== lastUrlTab.current && hasValidTab) {
        if (urlTab !== tab) setTab(urlTab);
      }
    }

    // --- PTAB syncing ---
    // Only meaningful when tab is (or will be) products.
    const effectiveTab: TabKey = hasValidTab ? urlTab : tab;
    const isProducts = effectiveTab === "products";

    if (isProducts) {
      // If URL provides pTab explicitly, adopt it when it changes.
      if (rawPTabParam && rawPTabParam !== lastUrlPTab.current && hasValidPTab) {
        if (urlPTab !== pTab) setPTab(urlPTab);
      }
      // If pTab param is missing, do NOT force reset on every URL change.
      // Just keep current pTab (or if we somehow got here with an invalid state, keep 'manage').
      if (!rawPTabParam && !validPTabs.includes(pTab)) {
        setPTab("manage");
      }
    } else {
      // Leaving products: drop focus id
      if (tab === "products") setFocusProductId(null);
    }

    // --- q -> prodSearch syncing ---
    // Only set prodSearch when URL q actually changes (and only while on products).
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

  /* -------- Auth + role -------- */
  const me = useQuery({
    queryKey: ["me"],
    enabled: !!token,
    queryFn: async () =>
      (
        await api.get<Me>("/api/profile/me", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
      ).data,
    staleTime: staleTimeMs,
  });

  useEffect(() => {
    if (!token) {
      nav("/login", {
        replace: true,
        state: { from: { pathname: "/admin" } },
      });
    }
  }, [token, nav]);

  const role = me.data?.role ?? "";
  const canAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  useEffect(() => {
    if (me.isFetched && !canAdmin) {
      nav("/", { replace: true });
    }
  }, [me.isFetched, canAdmin, nav]);

  /* -------- Overview -------- */
  const overview = useQuery<Overview>({
    queryKey: ["admin", "overview"],
    enabled: !!canAdmin,
    queryFn: async () =>
      (
        await api.get<Overview>("/api/admin/overview", {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).data,
    staleTime: staleTimeMs,
    refetchOnWindowFocus: false,
  });

  /* -------- Transactions -------- */
  const txQ = useQuery({
    queryKey: ["admin", "payments", q],
    enabled: !!canAdmin && tab === "transactions",
    queryFn: async () => {
      try {
        const { data } = await api.get<{ data: AdminPayment[] }>(
          `/api/payments/admin?includeItems=1&q=${encodeURIComponent(q)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        return data?.data ?? [];
      } catch {
        const { data } = await api.get<{ data: AdminPayment[] }>(
          `/api/admin/payments?includeItems=1&q=${encodeURIComponent(q)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        return data?.data ?? [];
      }
    },
    staleTime: staleTimeMs,
    refetchOnWindowFocus: false,
  });

  type AdminRefund = {
    id: string;
    orderId: string;
    purchaseOrderId: string;
    supplierId?: string | null;
    status: string;
    requestedAt?: string;
    createdAt?: string;
    requestedBy?: { email?: string };
    supplier?: { name?: string };
    totalAmount?: number | string;
    provider?: string | null;
    providerReference?: string | null;
    adminDecision?: string | null;
    adminNote?: string | null;
  };

  const [refundQ, setRefundQ] = useState("");
  const [refundStatus, setRefundStatus] = useState<string>("");

  const refundsQ = useQuery({
    queryKey: ["admin", "refunds", { refundQ, refundStatus }],
    enabled: !!canAdmin && tab === "refunds",
    queryFn: async () => {
      const { data } = await api.get<{ data: AdminRefund[] }>(
        `/api/admin/refunds?q=${encodeURIComponent(refundQ)}&status=${encodeURIComponent(refundStatus)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return data?.data ?? [];
    },
    staleTime: staleTimeMs,
    refetchOnWindowFocus: false,
  });

  const decideRefundM = useMutation({
    mutationFn: async (vars: { id: string; decision: "APPROVE" | "REJECT"; note?: string }) =>
      (
        await api.patch(
          `/api/admin/refunds/${vars.id}/decision`,
          { decision: vars.decision, note: vars.note },
          { headers: { Authorization: `Bearer ${token}` } }
        )
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "refunds"] });
      toast.push({ title: "Refunds", message: "Decision saved.", duration: 2000 });
    },
    onError: (e: any) => openModal({ title: "Refunds", message: e?.response?.data?.error || "Failed." }),
  });

  const markRefundedM = useMutation({
    mutationFn: async (id: string) =>
      (
        await api.post(`/api/admin/refunds/${id}/mark-refunded`, {}, { headers: { Authorization: `Bearer ${token}` } })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "refunds"] });
      toast.push({ title: "Refunds", message: "Marked refunded.", duration: 2000 });
    },
    onError: (e: any) => openModal({ title: "Refunds", message: e?.response?.data?.error || "Failed." }),
  });

  const verifyPayment = useMutation({
    mutationFn: async (paymentId: string) =>
      (await api.post(`/api/admin/payments/${paymentId}/verify`, {}, { headers: { Authorization: `Bearer ${token}` } }))
        .data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "payments"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      toast.push({ title: "Payments", message: "Payment verified.", duration: 2500 });
    },
    onError: () => openModal({ title: "Payments", message: "Verification failed." }),
  });

  const refundPayment = useMutation({
    mutationFn: async (paymentId: string) =>
      (await api.post(`/api/admin/payments/${paymentId}/refund`, {}, { headers: { Authorization: `Bearer ${token}` } }))
        .data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "payments"] });
      toast.push({ title: "Payments", message: "Refund processed.", duration: 2500 });
    },
    onError: () => openModal({ title: "Payments", message: "Refund failed." }),
  });

  /* -------- Catalog: categories, brands, attributes -------- */
  const categoriesQ = useQuery({
    queryKey: ["admin", "categories"],
    enabled: !!canAdmin && tab === "catalog",
    queryFn: async () =>
      (
        await api.get<{ data: AdminCategory[] }>("/api/admin/categories", {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).data.data,
    refetchOnWindowFocus: false,
    staleTime: staleTimeMs,
  });

  const createCategory = useMutation({
    mutationFn: async (payload: Partial<AdminCategory>) =>
      (await api.post("/api/admin/categories", payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "categories"] });
    },
  });

  const updateCategory = useMutation({
    mutationFn: async ({ id, ...payload }: Partial<AdminCategory> & { id: string }) =>
      (await api.put(`/api/admin/categories/${id}`, payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "categories"] });
    },
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/api/admin/categories/${id}`, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "categories"] });
    },
  });

  const brandsQ = useQuery({
    queryKey: ["admin", "brands"],
    enabled: !!canAdmin && tab === "catalog",
    queryFn: async () =>
      (await api.get<{ data: AdminBrand[] }>("/api/admin/brands", { headers: { Authorization: `Bearer ${token}` } }))
        .data.data,
    refetchOnWindowFocus: false,
    staleTime: staleTimeMs,
  });

  const createBrand = useMutation({
    mutationFn: async (payload: Partial<AdminBrand>) =>
      (await api.post("/api/admin/brands", payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "brands"] });
    },
  });

  const updateBrand = useMutation({
    mutationFn: async ({ id, ...payload }: Partial<AdminBrand> & { id: string }) =>
      (await api.put(`/api/admin/brands/${id}`, payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "brands"] });
    },
  });

  const deleteBrand = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/api/admin/brands/${id}`, { headers: { Authorization: `Bearer ${token}` } })).data,
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
          headers: { Authorization: `Bearer ${token}` },
        })
      ).data.data,
    refetchOnWindowFocus: false,
    staleTime: staleTimeMs,
  });

  const createAttribute = useMutation({
    mutationFn: async (payload: Partial<AdminAttribute>) =>
      (await api.post("/api/admin/attributes", payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "attributes"] });
    },
  });

  const updateAttribute = useMutation({
    mutationFn: async ({ id, ...payload }: Partial<AdminAttribute> & { id: string }) =>
      (await api.put(`/api/admin/attributes/${id}`, payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "attributes"] });
    },
  });

  const deleteAttribute = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/api/admin/attributes/${id}`, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "attributes"] });
    },
  });

  /* -------- Attribute values -------- */
  const createAttrValue = useMutation({
    mutationFn: async (payload: { attributeId: string; name: string; code?: string }) => {
      const { data } = await api.post(`/api/admin/attributes/${payload.attributeId}/values`, payload, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
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
      toast.push({ title: "Attributes", message: "Failed to add value.", duration: 2500 });
    },
    onSuccess: (created, vars) => {
      qc.setQueryData(["admin", "attributes"], (prev: any[] = []) => {
        const idx = prev.findIndex((a: any) => a.id === vars.attributeId);
        if (idx < 0) return prev;
        const a = { ...prev[idx] };
        a.values = (a.values || []).map((v: any) => (v.id.startsWith("tmp-") && v.name === vars.name ? created : v));
        const next = [...prev];
        next[idx] = a;
        return next;
      });
      toast.push({ title: "Attributes", message: "Value added.", duration: 1800 });
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
        await api.put(`/api/admin/attributes/${attributeId}/values/${id}`, payload, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "attributes"] });
      toast.push({ title: "Attributes", message: "Value updated.", duration: 1600 });
    },
    onError: () => {
      toast.push({ title: "Attributes", message: "Failed to update value.", duration: 2500 });
    },
  });

  const deleteAttrValue = useMutation({
    mutationFn: async ({ attributeId, id }: { attributeId: string; id: string }) =>
      (
        await api.delete(`/api/admin/attributes/${attributeId}/values/${id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "attributes"] });
      toast.push({ title: "Attributes", message: "Value deleted.", duration: 1600 });
    },
    onError: () => {
      toast.push({ title: "Attributes", message: "Failed to delete value.", duration: 2500 });
    },
  });

  /* -------- Catalog usage (moved out of JSX) -------- */
  const catalogUsageQ = useQuery({
    queryKey: ["admin", "catalog", "usage"],
    enabled: !!canAdmin && tab === "catalog",
    queryFn: async () => {
      try {
        const { data } = await api.get("/api/admin/catalog/usage", { headers: { Authorization: `Bearer ${token}` } });
        return data || { categories: {}, attributes: {}, brands: {} };
      } catch {
        // Fallback: derive from products if usage endpoint is missing
        try {
          const { data } = await api.get("/api/products?include=attributes,variants", {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          const arr: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          const categories: Record<string, number> = {};
          const attributes: Record<string, number> = {};
          const brands: Record<string, number> = {};

          for (const p of arr) {
            if (p.categoryId) categories[p.categoryId] = (categories[p.categoryId] || 0) + 1;
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
    queryFn: async () =>
      (
        await api.get<{ data: AdminSupplier[] }>("/api/admin/suppliers", {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).data.data,
    refetchOnWindowFocus: false,
    staleTime: staleTimeMs,
  });

  const createSupplier = useMutation({
    mutationFn: async (payload: Partial<AdminSupplier>) =>
      (await api.post("/api/admin/suppliers", payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "suppliers"] });
    },
  });

  const updateSupplier = useMutation({
    mutationFn: async ({ id, ...payload }: Partial<AdminSupplier> & { id: string }) =>
      (await api.put(`/api/admin/suppliers/${id}`, payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "suppliers"] });
    },
  });

  const deleteSupplier = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/api/admin/suppliers/${id}`, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "suppliers"] });
    },
  });

  /* -------- Backfill on first open (unchanged) -------- */
  const didBackfill = useRef(false);
  useEffect(() => {
    if (!canAdmin || tab !== "catalog" || didBackfill.current) return;
    (async () => {
      try {
        await api.post("/api/admin/catalog/backfill", {}, { headers: { Authorization: `Bearer ${token}` } });
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
  }, [tab, canAdmin, token, qc]);

  /* ---------------- UI bits ---------------- */
  function TabButton({ k, label, Icon }: { k: TabKey; label: string; Icon: any }) {
    const active = tab === k;

    return (
      <button
        type="button"
        onClick={() => {
          setTab(k);

          setSearchParams((prev) => {
            const s = new URLSearchParams(prev);
            s.set("tab", k);

            if (k !== "products") {
              s.delete("pTab");
              s.delete("q");
              s.delete("status");
              s.delete("view");

              setProdSearch("");
              setFocusProductId(null);
            } else {
              // ensure pTab always exists when going to products
              if (!s.get("pTab")) s.set("pTab", "manage");
            }

            return s;
          });
        }}
        className={[
          "group inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition",
          "border",
          active ? "bg-zinc-900 text-white border-zinc-900 shadow-sm" : "bg-white text-zinc-700 border-zinc-200 hover:bg-black/5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60",
        ].join(" ")}
      >
        <Icon size={16} className={active ? "text-white" : "text-zinc-600"} />
        <span className="whitespace-nowrap">{label}</span>
      </button>
    );
  }

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
        <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between">
          <div>
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
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
          emphasis ? "bg-emerald-600 text-white border-emerald-600 hover:opacity-90" : "bg-white hover:bg-black/5"
        }`}
        title={label}
      >
        <span className="font-medium">{value.toLocaleString()}</span>
        <span className="text-ink-soft">•</span>
        <span>{label}</span>
      </button>
    );
  }

  /* -------- Users Section (component) -------- */
  function UsersSection({ token, canAdmin }: { token?: string | null; canAdmin: boolean }) {
    const qc = useQueryClient();
    const { openModal } = useModal();
    const toast = useToast();

    const [usersSearchInput, setUsersSearchInput] = useState("");
    const usersSearch = useDebounced(usersSearchInput, 350);

    const usersQ = useQuery<AdminUser[]>({
      queryKey: ["admin", "users", usersSearch],
      enabled: !!canAdmin,
      queryFn: async () => {
        const { data } = await api.get<{ data: AdminUser[] }>("/api/admin/users", {
          headers: { Authorization: `Bearer ${token}` },
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
        console.error("Users list failed:", e?.response?.status, e?.response?.data || e?.message);
      }
    }, [usersQ.isError, usersQ.error]);

    const updateUserRole = useMutation({
      mutationFn: async ({ userId, role }: { userId: string; role: string }) =>
        (await api.post(`/api/admin/users/${userId}/role`, { role }, { headers: { Authorization: `Bearer ${token}` } })).data,
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["admin", "users"], exact: false });
        toast.push({ title: "Users", message: "Role updated.", duration: 2500 });
      },
      onError: (e: any) => {
        const msg = e?.response?.data?.error || "Could not update role.";
        openModal({ title: "Users", message: msg });
      },
    });

    const deactivateUser = useMutation({
      mutationFn: async (userId: string) =>
        (await api.post(`/api/admin/users/${userId}/deactivate`, {}, { headers: { Authorization: `Bearer ${token}` } })).data,
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["admin", "users"], exact: false });
        toast.push({ title: "Users", message: "User deactivated.", duration: 2500 });
      },
      onError: () => openModal({ title: "Users", message: "Could not deactivate user." }),
    });

    const reactivateUser = useMutation({
      mutationFn: async (userId: string) =>
        (await api.post(`/api/admin/users/${userId}/reactivate`, {}, { headers: { Authorization: `Bearer ${token}` } })).data,
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["admin", "users"], exact: false });
        toast.push({ title: "Users", message: "User reactivated.", duration: 2500 });
      },
      onError: () => openModal({ title: "Users", message: "Could not reactivate user." }),
    });

    return (
      <SectionCard
        title="Users & Roles"
        subtitle="Create, approve, deactivate, reactivate; manage privileges"
        right={
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={usersSearchInput}
              onChange={(e) => setUsersSearchInput(e.target.value)}
              placeholder="Search by email or role…"
              className="pl-9 pr-3 py-2 rounded-xl border bg-white"
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
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
              {!usersQ.isLoading && (usersQ.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                    No users found.
                  </td>
                </tr>
              )}
              {(usersQ.data ?? []).map((u) => {
                const statusUpper = (u.status || "").toUpperCase();
                const isSuspended = ["SUSPENDED", "DEACTIVATED", "DISABLED"].includes(statusUpper);
                return (
                  <tr key={u.id} className="hover:bg-black/5">
                    <td className="px-3 py-3">{u.email}</td>
                    <td className="px-3 py-3">
                      {role === "SUPER_ADMIN" ? (
                       u.role === 'SUPPLIER' ? u.role: <RoleSelect value={u.role} onChange={(newRole) => updateUserRole.mutate({ userId: u.id, role: newRole })}  />
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
  function ModerationSection({ token, onInspect }: { token?: string | null; onInspect: (p: any) => void }) {
    const qc = useQueryClient();
    const [searchInput, setSearchInput] = React.useState("");
    const debounced = useDebounced(searchInput, 350);
    const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

    useQuery<AdminProduct[]>({
      queryKey: ["admin", "products", "pending", { q: debounced }],
      enabled: !!token,
      queryFn: async () => {
        try {
          const { data } = await api.get("/api/admin/products/published", {
            headers: hdr,
            params: { q: debounced },
          });
          return Array.isArray(data?.data) ? data.data : [];
        } catch {
          const { data } = await api.get("/api/products", {
            headers: hdr,
            params: { status: "PENDING", q: debounced, take: 50, skip: 0 },
          });
          return Array.isArray(data?.data) ? data.data : [];
        }
      },
    });

    const approveM = useMutation({
      mutationFn: async (id: string) => {
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        const res = await api.post(`/api/admin/products/${encodeURIComponent(id)}/go-live`, {}, { headers });
        return res.data?.data ?? res.data ?? res;
      },
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: ["admin", "products"] });
        await qc.invalidateQueries({ queryKey: ["admin", "products", "moderation"] });
        await qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      },
      onError: (e: any) => {
        const msg = e?.response?.data?.error || e?.message || "Failed to approve (go live).";
        window.alert(msg);
      },
    });

    return (
      <ModerationGrid
        search={searchInput}
        token={token!}
        setSearch={setSearchInput}
        onApprove={(id: string) => approveM.mutate(id)}
        onInspect={onInspect}
      />
    );
  }

  /* ---------------- Render ---------------- */
  return (
    <SiteLayout>
      <div
        className="max-w-[1400px] mx-auto px-4 md:px-6 py-6"
        onClickCapture={stopHashNav}
        onMouseDownCapture={stopHashNav}
      >
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-sky-700 via-sky-600 to-indigo-700 text-white">
          <div className="absolute inset-0 opacity-30 bg-[radial-gradient(closest-side,rgba(255,255,255,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,0,0,0.15),transparent_60%)]" />
          <div className="relative px-5 md:px-8 py-6">
            <div className="flex items-center justify-between">
              <div>
                <motion.h1 initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-2xl md:text-3xl font-bold tracking-tight">
                  {me.isLoading ? "Loading…" : role === "SUPER_ADMIN" ? "Super Admin Dashboard" : "Admin Dashboard"}
                </motion.h1>
                <p className="text-white/80 text-sm mt-1">
                  Full control & oversight — users, products, transactions, operations, marketing, and analytics.
                </p>
              </div>
              <div className="hidden md:flex items-center gap-2">
                <Link to="/" className="inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 px-3 py-2 text-sm">
                  <ShieldCheck size={16} /> Back to site
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <KpiCard
            title="Users"
            value={(overview.data?.users.totalUsers ?? 0).toLocaleString()}
            hint={`${overview.data?.users.totalCustomers ?? 0} Customers • ${overview.data?.users.totalSuppliers ?? 0} Suppliers • ${overview.data?.users.totalSupplierRiders ?? 0} Customers • ${overview.data?.users.totalAdmins ?? 0} Admins • ${
              overview.data?.users.totalSuperAdmins ?? 0
            } Super Admins`}
            Icon={Users}
          />

          <KpiCardOverview
            title="Products"
            total={`${overview.data?.products.total ?? 0} total`}
            value={`${overview.data?.products.published ?? 0} Published • ${overview.data?.products.live ?? 0} Live`}
            hint={`${overview.data?.products.pending ?? 0} Pending • ${overview.data?.products.rejected ?? 0} Rejected`}
            res={`${overview.data?.products.availability.publishedAvailable ?? 0} Published available`}
            Icon={PackageCheck}
          />

          <KpiCard title="Orders Today" value={(overview.data?.ordersToday ?? 0).toLocaleString()} hint="New orders" Icon={CreditCard} />
          <KpiCard
            title="Revenue Today"
            value={ngn.format(fmtN(overview.data?.revenueToday))}
            hint="Last 7 days"
            Icon={BarChart3}
            chart={<Sparkline points={overview.data?.sparklineRevenue7d || []} />}
          />

          {role === "SUPER_ADMIN" && (
            <KpiCard
              title="Profit Today"
              value={ngn.format(fmtN(overview.data?.profitToday))}
              hint="Last 7 days"
              Icon={BarChart3}
              chart={<Sparkline points={overview.data?.sparklineProfit7d || []} />}
            />
          )}
        </div>

        {/* Tabs */}
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-white p-2 shadow-sm">
            <TabButton k="overview" label="Overview" Icon={ShieldCheck} />
            <TabButton k="users" label="Users & Roles" Icon={UserCheck} />
            <TabButton k="products" label="Product Moderation" Icon={PackageCheck} />
            <TabButton k="catalog" label="Catalog Settings" Icon={Settings} />
            <TabButton k="refunds" label="Refunds" Icon={Undo2} />
            <TabButton k="transactions" label="Transactions" Icon={CreditCard} />
            <TabButton k="finance" label="Finance" Icon={CreditCard} />
            <TabButton k="ops" label="Ops & Security" Icon={Settings} />
            <TabButton k="marketing" label="Marketing" Icon={BellRing} />
            <TabButton k="analytics" label="Analytics" Icon={BarChart3} />
          </div>
        </div>

        {/* Content */}
        <div className="mt-4 space-y-6">
          {tab === "users" && <UsersSection token={token} canAdmin={canAdmin} />}

          {tab === "analytics" && <ActivitiesPanel />}

          {/* Overview */}
          {tab === "overview" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <SectionCard title="Quick Actions" subtitle="Common admin tasks at a glance">
                <div className="grid sm:grid-cols-2 gap-3">
                  <QuickAction toAction={() => setTab("users")} icon={UserCheck} label="Approve Super Users" desc="Review & approve applicants" />
                  <QuickAction toAction={() => setTab("products")} icon={PackageCheck} label="Moderate Products" desc="Approve or reject submissions" />
                  <QuickAction toAction={() => setTab("transactions")} icon={CreditCard} label="Verify Payments" desc="Handle verifications & refunds" />
                  <QuickAction toAction={() => setTab("marketing")} icon={BellRing} label="Send Announcement" desc="Notify users of updates" />
                </div>
              </SectionCard>

              <SectionCard title="What needs attention" subtitle="Pending items & alerts">
                <ul className="space-y-3 text-sm">
                  <li className="flex items-center justify-between border rounded-xl px-3 py-2">
                    <span className="text-ink">Products pending review</span>
                    <span className="font-semibold">{overview.data?.products.pending ?? 0}</span>
                  </li>
                  <li className="flex items-center justify-between border rounded-xl px-3 py-2">
                    <span className="text-ink">Unverified / flagged transactions</span>
                    <span className="font-semibold">—</span>
                  </li>
                  <li className="flex items-center justify-between border rounded-xl px-3 py-2">
                    <span className="text-ink">Unusual activity alerts</span>
                    <span className="font-semibold">—</span>
                  </li>
                </ul>
              </SectionCard>

              {/* Catalog snapshot */}
              <SectionCard title="Catalog snapshot" subtitle="Availability & offers are variant-aware; Live = Published + Available + Active offer">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="rounded-xl border p-3">
                    <div className="text-xs text-ink-soft mb-2">Status</div>
                    <div className="flex flex-wrap gap-2">
                      <StatChip label="Published" value={overview.data?.products.published ?? 0} onClick={() => goProductsManageFromTile("Published")} />
                      <StatChip label="Live" value={overview.data?.products.live ?? 0} onClick={() => goProductsManageFromTile("Live")} emphasis />
                      <StatChip label="Pending" value={overview.data?.products.pending ?? 0} onClick={() => goProductsManageFromTile("Pending")} />
                      <StatChip label="Rejected" value={overview.data?.products.rejected ?? 0} onClick={() => goProductsManageFromTile("Rejected")} />
                    </div>
                  </div>

                  <div className="rounded-xl border p-3">
                    <div className="text-xs text-ink-soft mb-2">Availability (variant-aware)</div>
                    <div className="flex flex-wrap gap-2">
                      <StatChip
                        label="All statuses available"
                        value={overview.data?.products.availability.allStatusesAvailable ?? 0}
                        onClick={() => goProductsManageFromTile("All statuses available")}
                      />
                      <StatChip
                        label="Published available"
                        value={overview.data?.products.availability.publishedAvailable ?? 0}
                        onClick={() => goProductsManageFromTile("Published available")}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border p-3">
                    <div className="text-xs text-ink-soft mb-2">Supplier offers</div>
                    <div className="flex flex-wrap gap-2">
                      <StatChip label="With any" value={overview.data?.products.offers.withAny ?? 0} onClick={() => goProductsManageFromTile("With any")} />
                      <StatChip label="Without any" value={overview.data?.products.offers.withoutAny ?? 0} onClick={() => goProductsManageFromTile("Without any")} />
                      <StatChip
                        label="Published with any"
                        value={overview.data?.products.offers.publishedWithAny ?? 0}
                        onClick={() => goProductsManageFromTile("Published with any")}
                      />
                      <StatChip
                        label="Published without any"
                        value={overview.data?.products.offers.publishedWithoutAny ?? 0}
                        onClick={() => goProductsManageFromTile("Published without any")}
                      />
                      <StatChip label="With active" value={overview.data?.products.offers.withActive ?? 0} onClick={() => goProductsManageFromTile("With active")} />
                      <StatChip
                        label="Published with active"
                        value={overview.data?.products.offers.publishedWithActive ?? 0}
                        onClick={() => goProductsManageFromTile("Published with active")}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border p-3">
                    <div className="text-xs text-ink-soft mb-2">Variants</div>
                    <div className="flex flex-wrap gap-2">
                      <StatChip label="With variants" value={overview.data?.products.variantMix.withVariants ?? 0} onClick={() => goProductsManageFromTile("With variants")} />
                      <StatChip label="Simple" value={overview.data?.products.variantMix.simple ?? 0} onClick={() => goProductsManageFromTile("Simple")} />
                    </div>
                  </div>

                  <div className="rounded-xl border p-3 sm:col-span-2">
                    <div className="text-xs text-ink-soft mb-2">Published base stock (non-variant-aware)</div>
                    <div className="flex flex-wrap gap-2">
                      <StatChip
                        label="Base in-stock"
                        value={overview.data?.products.publishedBaseStock.inStock ?? 0}
                        onClick={() => goProductsManageFromTile("Base in-stock")}
                      />
                      <StatChip
                        label="Base out-of-stock"
                        value={overview.data?.products.publishedBaseStock.outOfStock ?? 0}
                        onClick={() => goProductsManageFromTile("Base out-of-stock")}
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
                <div className="inline-flex rounded-xl border overflow-hidden">
                  <button
                    onClick={() => {
                      setPTab("moderation");
                      const s = new URLSearchParams(location.search);
                      s.set("tab", "products");
                      s.set("pTab", "moderation");
                      nav(`/admin?${s.toString()}`, { replace: false });
                    }}
                    className={`px-3 py-1.5 text-sm ${pTab === "moderation" ? "bg-zinc-900 text-white" : "bg-white hover:bg-black/5"}`}
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
                    className={`px-3 py-1.5 text-sm ${pTab === "manage" ? "bg-zinc-900 text-white" : "bg-white hover:bg-black/5"}`}
                  >
                    Manage
                  </button>
                </div>
              }
            >
              {/* Keep both mounted; toggle visibility only */}
              <div className={pTab === "moderation" ? "block" : "hidden"}>
                <ModerationSection
                  token={token}
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
                <ManageProducts
                  role={role}
                  token={token}
                  search={prodSearch}
                  setSearch={setProdSearch}
                  focusId={focusProductId}
                  onFocusedConsumed={() => setFocusProductId(null)}
                />
              </div>
            </SectionCard>
          )}

          {/* Catalog Settings */}
          {tab === "catalog" && (
            <CatalogSettingsSection
              token={token}
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

          {tab === "refunds" && <RefundsSection token={token} canAdmin={canAdmin} />}
          {tab === "finance" && <FinanceSection token={token} canAdmin={canAdmin} />}

          {/* Transactions */}
          {tab === "transactions" && (
            <TransactionsSection
              q={q}
              setQ={setQ}
              txQ={txQ}
              onRefresh={() => qc.invalidateQueries({ queryKey: ["admin", "payments"] })}
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
        <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between">
          <div>
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

  return (
    <SectionCard
      title="Transactions"
      subtitle="Verify payments, process refunds, view history (item-level breakdowns)"
      right={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by order, reference, or email…"
              className="pl-9 pr-3 py-2 rounded-xl border bg-white"
            />
          </div>
          <button onClick={onRefresh} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-black/5">
            <RefreshCcw size={16} /> Refresh
          </button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <div className="p-4 md:p-5 overflow-x-auto relative pr-[220px]">
          <table className="min-w-full text-sm">
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
                  <td colSpan={7} className="px-3 py-6 text-center text-rose-600">
                    Failed to load transactions. {(txQ.error as any)?.response?.data?.error || (txQ.error as any)?.message || ""}
                  </td>
                </tr>
              )}
              {!txQ.isLoading && !txQ.isError && (txQ.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                    No transactions found.
                  </td>
                </tr>
              )}
              {(txQ.data ?? []).map((t: AdminPayment) => (
                <TransactionRow key={t.id} tx={t} onVerify={() => onVerify(t.id)} onRefund={() => onRefund(t.id)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  );
}

/* ----------------- Refunds section (Admin) ---------------------*/
function RefundsSection({ token, canAdmin }: { token?: string | null; canAdmin: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { openModal, closeModal } = useModal();

  type AdminRefund = {
    id: string;
    orderId: string;
    purchaseOrderId: string;
    supplierId?: string | null;
    status: string;
    requestedAt?: string;
    createdAt?: string;
    requestedBy?: { email?: string; firstName?: string | null; lastName?: string | null };
    supplier?: { name?: string };
    totalAmount?: number | string;
    provider?: string | null;
    providerReference?: string | null;
    adminDecision?: string | null;
    adminNote?: string | null;
  };

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");

  // Pagination
  const [take, setTake] = useState<number>(20);
  const [page, setPage] = useState<number>(1); // 1-based

  React.useEffect(() => {
    setPage(1);
  }, [q, status, take]);

  const skip = (page - 1) * take;

  function ordersHref(orderId?: string | null) {
    if (!orderId) return "/orders";
    const id = encodeURIComponent(orderId);
    return `/orders?orderId=${id}&q=${id}`;
  }

  function fmtDate(s?: string | null) {
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

  const ngn = React.useMemo(
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

  const refundsQ = useQuery({
    queryKey: ["admin", "refunds", { q, status, take, skip }],
    enabled: !!canAdmin && !!token,
    queryFn: async () => {
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

      const { data } = await api.get(
        `/api/admin/refunds?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&take=${take}&skip=${skip}`,
        { headers }
      );

      const root: any = data ?? {};
      const rows: AdminRefund[] =
        (Array.isArray(root?.data) ? root.data : null) ?? (Array.isArray(root?.data?.data) ? root.data.data : null) ?? [];
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

  const totalPages = typeof total === "number" && total >= 0 ? Math.max(1, Math.ceil(total / take)) : undefined;

  const canPrev = page > 1;
  const canNext = typeof totalPages === "number" ? page < totalPages : rows.length === take;

  const decideRefundM = useMutation({
    mutationFn: async (vars: { id: string; decision: "APPROVE" | "REJECT"; note?: string }) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      return (
        await api.patch(
          `/api/admin/refunds/${encodeURIComponent(vars.id)}/decision`,
          { decision: vars.decision, note: vars.note },
          { headers }
        )
      ).data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "refunds"] });
      toast.push({ title: "Refunds", message: "Decision saved.", duration: 2000 });
      closeModal();
    },
    onError: (e: any) => openModal({ title: "Refunds", message: e?.response?.data?.error || "Failed." }),
  });

  const markRefundedM = useMutation({
    mutationFn: async (id: string) => {
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      return (await api.post(`/api/admin/refunds/${encodeURIComponent(id)}/mark-refunded`, {}, { headers })).data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "refunds"] });
      toast.push({ title: "Refunds", message: "Marked refunded.", duration: 2000 });
      closeModal();
    },
    onError: (e: any) => openModal({ title: "Refunds", message: e?.response?.data?.error || "Failed." }),
  });

  const isMutating = decideRefundM.isPending || markRefundedM.isPending;

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-ink font-semibold">Refunds</h3>
          <p className="text-xs text-ink-soft">Review supplier/customer refund cases and settle them.</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search orderId / poId / supplierId / reference…"
            className="px-3 py-2 rounded-xl border bg-white"
          />

          <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 rounded-xl border bg-white text-sm">
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
            className="px-3 py-2 rounded-xl border bg-white text-sm"
            title="Rows per page"
          >
            <option value="10">10 / page</option>
            <option value="20">20 / page</option>
            <option value="50">50 / page</option>
          </select>

          <button
            onClick={() => refundsQ.refetch()}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-black/5 text-sm"
            disabled={refundsQ.isFetching}
          >
            <RefreshCcw size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Pagination bar */}
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
                {" "}
                of <b>{totalPages}</b>
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

      {/* ✅ Padding OUTSIDE the horizontal scroller */}
      <div className="p-4 pr-1 md:p-5 md:pr-2">
        {/* ✅ Scroll container WITHOUT padding so sticky right=0 is flush */}
        <div className="overflow-x-auto relative">
          <table className="min-w-[1100px] w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-ink">
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[220px]">Order</th>
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[220px]">PO</th>
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[240px]">Supplier</th>
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[220px]">Requested By</th>
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[140px]">Amount</th>
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[160px]">Status</th>
                <th className="text-left px-3 py-2 whitespace-nowrap min-w-[180px]">Created</th>

                <th
                  className="sticky right-0 z-40 text-right px-3 py-2 bg-zinc-50 whitespace-nowrap w-[220px] min-w-[220px] max-w-[220px] border-l"
                  style={{ boxShadow: "-10px 0 16px -14px rgba(0,0,0,0.35)" }}
                >
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {refundsQ.isLoading && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">
                    Loading refunds…
                  </td>
                </tr>
              )}

              {refundsQ.isError && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-rose-600">
                    Failed to load refunds.
                  </td>
                </tr>
              )}

              {!refundsQ.isLoading && !refundsQ.isError && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">
                    No refunds found.
                  </td>
                </tr>
              )}

              {rows.map((r) => {
                const statusUpper = String(r.status || "").toUpperCase();
                const disableDecision = statusUpper === "REFUNDED" || statusUpper === "CLOSED";

                return (
                  <tr key={r.id} className="hover:bg-black/5">
                    <td className="px-3 py-3 whitespace-nowrap">
                      {r.orderId ? (
                        <Link to={ordersHref(r.orderId)} className="font-semibold text-indigo-700 hover:underline" title="Open Orders filtered by this orderId">
                          {r.orderId}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap">{r.purchaseOrderId || "—"}</td>

                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="inline-block max-w-[240px] truncate align-bottom" title={r.supplier?.name || r.supplierId || ""}>
                        {r.supplier?.name || r.supplierId || "—"}
                      </span>
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="inline-block max-w-[220px] truncate align-bottom" title={r.requestedBy?.email || ""}>
                        {r.requestedBy?.email || "—"}
                      </span>
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap">{ngn.format(fmtMoney(r.totalAmount))}</td>

                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-white whitespace-nowrap">{String(r.status)}</span>
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap">{fmtDate(r.createdAt || r.requestedAt)}</td>

                    <td
                      className="sticky right-0 z-30 px-3 py-3 text-right bg-white w-[220px] min-w-[220px] max-w-[220px] border-l"
                      style={{ boxShadow: "-10px 0 16px -14px rgba(0,0,0,0.25)" }}
                    >
                      <div className="inline-flex flex-col items-end gap-2">
                        <button
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5"
                          disabled={isMutating}
                          onClick={() =>
                            openModal({
                              title: `Refund ${r.orderId || r.id}`,
                              message: (
                                <div className="space-y-2">
                                  <div className="text-sm">
                                    <b>Status:</b> {String(r.status)}
                                  </div>
                                  <div className="text-sm">
                                    <b>PO:</b> {r.purchaseOrderId || "—"}
                                  </div>
                                  <div className="text-sm">
                                    <b>Supplier:</b> {r.supplier?.name || r.supplierId || "—"}
                                  </div>
                                  <div className="text-sm">
                                    <b>Amount:</b> {ngn.format(fmtMoney(r.totalAmount))}
                                  </div>
                                  <div className="text-xs text-zinc-500">Provider ref: {r.providerReference || "—"}</div>
                                  <div className="text-xs text-zinc-500">Admin decision: {r.adminDecision || "—"}</div>
                                  {r.adminNote ? <div className="text-sm text-zinc-700">{r.adminNote}</div> : null}
                                </div>
                              ),
                            })
                          }
                        >
                          View
                        </button>

                        <button
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          disabled={disableDecision || isMutating}
                          onClick={() => {
                            const note = window.prompt("Admin note (optional)");
                            if (note === null) return;
                            const ok = window.confirm("Approve this refund?");
                            if (!ok) return;

                            decideRefundM.mutate({
                              id: r.id,
                              decision: "APPROVE",
                              note: note.trim() ? note.trim() : undefined,
                            });
                          }}
                        >
                          Approve
                        </button>

                        <button
                          className="px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                          disabled={disableDecision || isMutating}
                          onClick={() => {
                            const note = window.prompt("Reject reason (optional)") || "";
                            decideRefundM.mutate({ id: r.id, decision: "REJECT", note: note || undefined });
                          }}
                        >
                          Reject
                        </button>

                        <button
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5 disabled:opacity-50"
                          disabled={isMutating}
                          onClick={() => markRefundedM.mutate(r.id)}
                        >
                          Mark refunded
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
function FinanceSection({ token, canAdmin }: { token?: string | null; canAdmin: boolean }) {
  const [subTab, setSubTab] = useState<"payouts" | "ledger">("payouts");

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-ink font-semibold">Finance</h3>
          <p className="text-xs text-ink-soft">Release supplier payouts, view allocations, and post ledger adjustments.</p>
        </div>

        <div className="inline-flex rounded-xl border overflow-hidden">
          <button
            onClick={() => setSubTab("payouts")}
            className={`px-3 py-1.5 text-sm ${subTab === "payouts" ? "bg-zinc-900 text-white" : "bg-white hover:bg-black/5"}`}
          >
            Payouts
          </button>
          <button
            onClick={() => setSubTab("ledger")}
            className={`px-3 py-1.5 text-sm ${subTab === "ledger" ? "bg-zinc-900 text-white" : "bg-white hover:bg-black/5"}`}
          >
            Ledger
          </button>
        </div>
      </div>

      <div className="p-4 md:p-5">{subTab === "payouts" ? <AdminPayoutsPanel token={token} canAdmin={canAdmin} /> : <AdminLedgerPanel token={token} canAdmin={canAdmin} />}</div>
    </div>
  );
}

/* ---------------- Small presentational bits ---------------- */
function KpiCard({ title, value, hint, Icon, chart }: { title: string; value: string; hint?: string; Icon: any; chart?: ReactNode }) {
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
          <div className="text-lg font-semibold text-ink mt-0.5">{value}</div>
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
      : s === "FAILED" || s === "CANCELED" || s === "REJECTED" || s === "REFUNDED"
      ? "bg-rose-500/10 text-rose-700 border-rose-600/20"
      : s === "SUSPENDED" || s === "DEACTIVATED" || s === "DISABLED"
      ? "bg-rose-500/10 text-rose-700 border-rose-600/20"
      : "bg-zinc-500/10 text-zinc-700 border-zinc-600/20";

  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${cls}`}>{label}</span>;
}

function RoleSelect({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (role: string) => void }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`border rounded-lg px-2 py-1 text-sm bg-white ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <option value="SHOPPER">SHOPPER</option>
      <option value="ADMIN">ADMIN</option>
      <option value="SUPER_ADMIN">SUPER_ADMIN</option>
    </select>
  );
}

function QuickAction({ toAction, icon: Icon, label, desc }: { toAction: () => void; icon: any; label: string; desc: string }) {
  return (
    <button onClick={toAction} className="group rounded-2xl border bg-white p-4 text-left hover:shadow-md transition">
      <div className="flex items-center gap-3">
        <span className="inline-grid place-items-center w-10 h-10 rounded-xl bg-primary-50">
          <Icon size={18} />
        </span>
        <div>
          <div className="font-semibold text-ink group-hover:underline">{label}</div>
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
