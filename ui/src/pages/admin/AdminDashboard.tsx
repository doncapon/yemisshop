// src/pages/AdminDashboard.tsx
import { useEffect, useRef, useState, type ReactNode, type JSX } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { motion } from 'framer-motion';
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
  // add any other icons you actually use
} from 'lucide-react';
import React from 'react';

import api from '../../api/client.js';
import { useAuthStore } from '../../store/auth.js';
import { useToast } from '../../components/ToastProvider.js';
import { useModal } from '../../components/ModalProvider.js';
import ActivitiesPanel from '../../components/admin/ActivitiesPanel.js';

import { ModerationGrid } from '../../components/admin/ModerationGrid.js';
import { ManageProducts } from '../../components/admin/ManageProducts.js';
import { TransactionRow } from '../../components/admin/TransactionRow.js';
import { CatalogSettingsSection } from '../../components/admin/CatalogSettingSection.js';

/* ---------------- constants ---------------- */
const staleTImeInSecs = 300_000;

/* ---------------- Types ---------------- */
type Me = {
  id: string;
  role: 'ADMIN' | 'SUPER_ADMIN' | string;
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
  // any of these may exist depending on backend:
  available?: number;
  qty?: number;
  stock?: number;
};

type AdminProduct = {
  id: string;
  title: string;
  price: number | string;
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
  type: 'PHYSICAL' | 'ONLINE';
  status: string;
  contactEmail?: string | null;
  whatsappPhone?: string | null;

  apiBaseUrl?: string | null;
  apiAuthType?: 'NONE' | 'BEARER' | 'BASIC' | null;
  apiKey?: string | null;

  payoutMethod?: 'SPLIT' | 'TRANSFER' | null;
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
  status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUNDED' | string;
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

type TabKey = 'overview' | 'users' | 'products' | 'transactions' | 'catalog' | 'ops' | 'marketing' | 'analytics';
type ProductsInnerTab = 'moderation' | 'manage';

/** Filters that your Manage tab can use (central place) */
type ManageFilters = {
  status: 'ANY' | 'LIVE' | 'PUBLISHED' | 'PENDING' | 'REJECTED' | 'ARCHIVED';
  stock: 'ANY' | 'AVAILABLE' | 'OUT';
  offers: 'ANY' | 'ANY_PRESENT' | 'ACTIVE_ONLY' | 'NONE';
  variants: 'ANY' | 'WITH' | 'SIMPLE';
  q?: string;
};

type FilterPreset =
  | 'all'
  | 'no-offer'
  | 'live'
  | 'published-with-offer'
  | 'published-no-offer'
  | 'published-with-active'
  | 'published-base-in'
  | 'published-base-out'
  | 'with-variants'
  | 'simple'
  | 'published-with-availability'
  | 'published'
  | 'pending'
  | 'rejected';

/* ---------------- Utils ---------------- */
const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});
function fmtN(n?: number | string) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
function fmtDate(s?: string) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(+d)) return s;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step},${norm(v)}`).join(' ');
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
  const [tab, setTab] = useState<TabKey>('overview');
  const [pTab, setPTab] = useState<ProductsInnerTab>('manage');

  // Products search + focus handoff from Moderation
  const [prodSearch, setProdSearch] = useState('');
  const [focusProductId, setFocusProductId] = useState<string | null>(null);

  // Transactions search
  const [q, setQ] = useState('');

  // Manage filters (source of truth for Manage tab)
  const [manageFilters, setManageFilters] = useState<ManageFilters>({
    status: 'ANY',
    stock: 'ANY',
    offers: 'ANY',
    variants: 'ANY',
    q: '',
  });

  // Role-gate
  const me = useQuery({
    queryKey: ['me'],
    enabled: !!token,
    queryFn: async () =>
      (await api.get<Me>('/api/profile/me', { headers: token ? { Authorization: `Bearer ${token}` } : undefined })).data,
    staleTime: staleTImeInSecs,
  });

  useEffect(() => {
    if (!token) {
      nav('/login', { replace: true, state: { from: { pathname: '/admin' } } });
      return;
    }
  }, [token, nav]);

  const role = me.data?.role ?? '';
  const canAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';

  useEffect(() => {
    if (me.isFetched && !canAdmin) nav('/', { replace: true });
  }, [me.isFetched, canAdmin, nav]);

  /* -------- Overview -------- */
  const overview = useQuery<Overview>({
    queryKey: ['admin', 'overview'],
    enabled: !!canAdmin,
    queryFn: async () =>
      (await api.get<Overview>('/api/admin/overview', { headers: { Authorization: `Bearer ${token}` } })).data,
    staleTime: staleTImeInSecs,
    refetchOnWindowFocus: false,
  });

  /* -------- Transactions -------- */
  const txQ = useQuery({
    queryKey: ['admin', 'payments', q],
    enabled: !!canAdmin && tab === 'transactions',
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
    staleTime: staleTImeInSecs,
    refetchOnWindowFocus: false,
  });

  const verifyPayment = useMutation({
    mutationFn: async (paymentId: string) =>
      (await api.post(`/api/admin/payments/${paymentId}/verify`, {}, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'payments'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      toast.push({ title: 'Payments', message: 'Payment verified.', duration: 2500 });
    },
    onError: () => openModal({ title: 'Payments', message: 'Verification failed.' }),
  });

  const refundPayment = useMutation({
    mutationFn: async (paymentId: string) =>
      (await api.post(`/api/admin/payments/${paymentId}/refund`, {}, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'payments'] });
      toast.push({ title: 'Payments', message: 'Refund processed.', duration: 2500 });
    },
    onError: () => openModal({ title: 'Payments', message: 'Refund failed.' }),
  });

  /* -------- Catalog: lists (only when on catalog) -------- */
  const categoriesQ = useQuery({
    queryKey: ['admin', 'categories'],
    enabled: !!canAdmin && tab === 'catalog',
    queryFn: async () =>
      (await api.get<{ data: AdminCategory[] }>('/api/admin/categories', { headers: { Authorization: `Bearer ${token}` } })).data.data,
    refetchOnWindowFocus: false,
    staleTime: staleTImeInSecs,
  });

  const createCategory = useMutation({
    mutationFn: async (payload: Partial<AdminCategory>) =>
      (await api.post('/api/admin/categories', payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
    },
  });

  const updateCategory = useMutation({
    mutationFn: async ({ id, ...payload }: Partial<AdminCategory> & { id: string }) =>
      (await api.put(`/api/admin/categories/${id}`, payload, { headers: { Authorization: { Authorization: `Bearer ${token}` } } as any })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
    },
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/api/admin/categories/${id}`, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
    },
  });

  const brandsQ = useQuery({
    queryKey: ['admin', 'brands'],
    enabled: !!canAdmin && tab === 'catalog',
    queryFn: async () =>
      (await api.get<{ data: AdminBrand[] }>('/api/admin/brands', { headers: { Authorization: `Bearer ${token}` } })).data.data,
    refetchOnWindowFocus: false,
    staleTime: staleTImeInSecs,
  });

  const createBrand = useMutation({
    mutationFn: async (payload: Partial<AdminBrand>) =>
      (await api.post('/api/admin/brands', payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'brands'] });
    },
  });
  const updateBrand = useMutation({
    mutationFn: async ({ id, ...payload }: Partial<AdminBrand> & { id: string }) =>
      (await api.put(`/api/admin/brands/${id}`, payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'brands'] });
    },
  });
  const deleteBrand = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/api/admin/brands/${id}`, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'brands'] });
    },
  });

  const attributesQ = useQuery({
    queryKey: ['admin', 'attributes'],
    enabled: !!canAdmin && tab === 'catalog',
    queryFn: async () =>
      (await api.get<{ data: AdminAttribute[] }>('/api/admin/attributes', { headers: { Authorization: `Bearer ${token}` } })).data.data,
    refetchOnWindowFocus: false,
    staleTime: staleTImeInSecs,
  });

  const createAttribute = useMutation({
    mutationFn: async (payload: Partial<AdminAttribute>) =>
      (await api.post('/api/admin/attributes', payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'attributes'] });
    },
  });
  const updateAttribute = useMutation({
    mutationFn: async ({ id, ...payload }: Partial<AdminAttribute> & { id: string }) =>
      (await api.put(`/api/admin/attributes/${id}`, payload, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'attributes'] });
    },
  });
  const deleteAttribute = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/api/admin/attributes/${id}`, { headers: { Authorization: `Bearer ${token}` } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'attributes'] });
    },
  });

  // Attribute values
  const createAttrValue = useMutation({
    mutationFn: async (payload: { attributeId: string; name: string; code?: string }) => {
      const { data } = await api.post(`/api/admin/attributes/${payload.attributeId}/values`, payload, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      return data;
    },
    onMutate: async (vars) => {
      const key = ['admin', 'attributes'];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any[]>(key) || [];
      const idx = prev.findIndex((a: any) => a.id === vars.attributeId);
      if (idx >= 0) {
        const optimistic = structuredClone(prev);
        const a = optimistic[idx];
        a.values = [...(a.values ?? []), { id: 'tmp-' + Date.now(), name: vars.name, code: vars.code ?? '', isActive: true }];
        qc.setQueryData(key, optimistic);
      }
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['admin', 'attributes'], ctx.prev);
      toast.push({ title: 'Attributes', message: 'Failed to add value.', duration: 2500 });
    },
    onSuccess: (created, vars) => {
      qc.setQueryData(['admin', 'attributes'], (prev: any[] = []) => {
        const idx = prev.findIndex((a: any) => a.id === vars.attributeId);
        if (idx < 0) return prev;
        const a = { ...prev[idx] };
        a.values = (a.values || []).map((v: any) => (v.id.startsWith('tmp-') && v.name === vars.name ? created : v));
        const next = [...prev];
        next[idx] = a;
        return next;
      });
      toast.push({ title: 'Attributes', message: 'Value added.', duration: 1800 });
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
      (await api.put(`/api/admin/attributes/${attributeId}/values/${id}`, payload, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'attributes'] });
      toast.push({ title: 'Attributes', message: 'Value updated.', duration: 1600 });
    },
    onError: () => {
      toast.push({ title: 'Attributes', message: 'Failed to update value.', duration: 2500 });
    },
  });

  const deleteAttrValue = useMutation({
    mutationFn: async ({ attributeId, id }: { attributeId: string; id: string }) =>
      (await api.delete(`/api/admin/attributes/${attributeId}/values/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'attributes'] });
      toast.push({ title: 'Attributes', message: 'Value deleted.', duration: 1600 });
    },
    onError: () => {
      toast.push({ title: 'Attributes', message: 'Failed to delete value.', duration: 2500 });
    },
  });

  /* -------- Backfill on first open -------- */
  const didBackfill = useRef(false);
  useEffect(() => {
    if (!canAdmin || tab !== 'catalog' || didBackfill.current) return;
    (async () => {
      try {
        await api.post('/api/admin/catalog/backfill', {}, { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        // ignore missing route
      } finally {
        didBackfill.current = true;
        qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
        qc.invalidateQueries({ queryKey: ['admin', 'attributes'] });
        qc.invalidateQueries({ queryKey: ['admin', 'brands'] });
        qc.invalidateQueries({ queryKey: ['admin', 'catalog', 'usage'] });
      }
    })();
  }, [tab, canAdmin, token, qc]);

  /* ---------------- UI bits ---------------- */
  function TabButton({ k, label, Icon }: { k: TabKey; label: string; Icon: any }) {
    const active = tab === k;
    return (
      <button
        onClick={() => setTab(k)}
        className={`group inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm border transition
          ${active ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white hover:bg-black/5 border-border text-ink'}`}
      >
        <Icon size={16} className={`${active ? 'text-white' : 'text-zinc-600'} group-hover:opacity-100`} />
        {label}
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
          emphasis ? 'bg-emerald-600 text-white border-emerald-600 hover:opacity-90' : 'bg-white hover:bg-black/5'
        }`}
        title={label}
      >
        <span className="font-medium">{value.toLocaleString()}</span>
        <span className="text-ink-soft">•</span>
        <span>{label}</span>
      </button>
    );
  }

  /* -------- Users (localized) -------- */
  function UsersSection({ token, canAdmin }: { token?: string | null; canAdmin: boolean }) {
    const qc = useQueryClient();
    const { openModal } = useModal();
    const toast = useToast();

    const [usersSearchInput, setUsersSearchInput] = useState('');
    const usersSearch = useDebounced(usersSearchInput, 350);

    const usersQ = useQuery<AdminUser[]>({
      queryKey: ['admin', 'users', usersSearch],
      enabled: !!canAdmin,
      queryFn: async () => {
        const { data } = await api.get<{ data: AdminUser[] }>(
          '/api/admin/users',
          {
            headers: { Authorization: `Bearer ${token}` },
            params: { q: usersSearch || '' },
          }
        );
        return Array.isArray(data?.data) ? data.data : [];
      },
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: 'always',
      staleTime: staleTImeInSecs,
    });

    useEffect(() => {
      if (usersQ.isError) {
        const e: any = usersQ.error;
        console.error('Users list failed:', e?.response?.status, e?.response?.data || e?.message);
      }
    }, [usersQ.isError, usersQ.error]);

    const updateUserRole = useMutation({
      mutationFn: async ({ userId, role }: { userId: string; role: string }) =>
        (await api.post(`/api/admin/users/${userId}/role`, { role }, { headers: { Authorization: `Bearer ${token}` } })).data,
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['admin', 'users'], exact: false });
        toast.push({ title: 'Users', message: 'Role updated.', duration: 2500 });
      },
      onError: (e: any) => {
        const msg = e?.response?.data?.error || 'Could not update role.';
        openModal({ title: 'Users', message: msg });
      },
    });

    const deactivateUser = useMutation({
      mutationFn: async (userId: string) =>
        (await api.post(`/api/admin/users/${userId}/deactivate`, {}, { headers: { Authorization: `Bearer ${token}` } })).data,
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['admin', 'users'], exact: false });
        toast.push({ title: 'Users', message: 'User deactivated.', duration: 2500 });
      },
      onError: () => openModal({ title: 'Users', message: 'Could not deactivate user.' }),
    });

    const reactivateUser = useMutation({
      mutationFn: async (userId: string) =>
        (await api.post(`/api/admin/users/${userId}/reactivate`, {}, { headers: { Authorization: `Bearer ${token}` } })).data,
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['admin', 'users'], exact: false });
        toast.push({ title: 'Users', message: 'User reactivated.', duration: 2500 });
      },
      onError: () => openModal({ title: 'Users', message: 'Could not reactivate user.' }),
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
                const statusUpper = (u.status || '').toUpperCase();
                const isSuspended = ['SUSPENDED', 'DEACTIVATED', 'DISABLED'].includes(statusUpper);
                return (
                  <tr key={u.id} className="hover:bg-black/5">
                    <td className="px-3 py-3">{u.email}</td>
                    <td className="px-3 py-3">
                      {role === 'SUPER_ADMIN' ? (
                        <RoleSelect value={u.role} onChange={(newRole) => updateUserRole.mutate({ userId: u.id, role: newRole })} />
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

  const explain = (title: string, message: string) => openModal({ title, message });

  const goProductsModeration = () => {
    setTab('products');
    setPTab('moderation');
    // reflect in URL (optional)
    const s = new URLSearchParams(location.search);
    s.set('tab', 'products');
    s.set('pTab', 'moderation');
    nav(`/admin?${s.toString()}`, { replace: false });
  };

  // helper to map snapshot "view" to a Manage status (you can expand this later)
  const mapViewToStatus = (view: string): ManageFilters['status'] => {
    switch ((view || '').toLowerCase()) {
      case 'published':
      case 'published-with-offer':
      case 'published-no-offer':
      case 'published-with-active':
      case 'published-base-in':
      case 'published-base-out':
      case 'published-with-availability':
        return 'PUBLISHED';
      case 'pending':
        return 'PENDING';
      case 'rejected':
        return 'REJECTED';
      case 'live':
        return 'LIVE';
      default:
        return 'ANY';
    }
  };

  /** Navigate to Products → Manage and set filters; also sync URL */
  function goProductsManage(viewStatus: string, view: string= '') {
    setTab('products');
    setPTab('manage');
    // apply local filter immediately (UI responsive)
    const status = mapViewToStatus(viewStatus);
    setManageFilters((f) => ({ ...f, status }));

    // sync URL for deep-linking
    const s = new URLSearchParams(location.search);
    s.set('tab', 'products');
    s.set('pTab', 'manage');
    s.set('status', status);  // explicit status for your ManageProducts to read if needed
    if(view !== '')
        s.set('view', view)
    nav(`/admin?${s.toString()}`, { replace: false });
  }

  return (
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
              <motion.h1
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-2xl md:text-3xl font-bold tracking-tight"
              >
                {me.isLoading ? 'Loading…' : role === 'SUPER_ADMIN' ? 'Super Admin Dashboard' : 'Admin Dashboard'}
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
          hint={`${overview.data?.users.totalCustomers ?? 0} Customers • ${overview.data?.users.totalAdmins ?? 0} Admins • ${overview.data?.users.totalSuperAdmins ?? 0} Super Admins`}
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
          chart={<Sparkline points={overview.data?.sparklineRevenue7d || []} />}
        />

        {role === 'SUPER_ADMIN' && (
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
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <TabButton k="overview" label="Overview" Icon={ShieldCheck} />
        <TabButton k="users" label="Users & Roles" Icon={UserCheck} />
        <TabButton k="products" label="Product Moderation" Icon={PackageCheck} />
        <TabButton k="catalog" label="Catalog Settings" Icon={Settings} />
        <TabButton k="transactions" label="Transactions" Icon={CreditCard} />
        <TabButton k="ops" label="Ops & Security" Icon={Settings} />
        <TabButton k="marketing" label="Marketing" Icon={BellRing} />
        <TabButton k="analytics" label="Analytics" Icon={BarChart3} />
      </div>

      {/* Content */}
      <div className="mt-4 space-y-6">
        {/* Users */}
        {tab === 'users' && <UsersSection token={token} canAdmin={canAdmin} />}

        {tab === 'analytics' && <ActivitiesPanel />}

        {/* Overview */}
        {tab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Quick Actions */}
            <SectionCard title="Quick Actions" subtitle="Common admin tasks at a glance">
              <div className="grid sm:grid-cols-2 gap-3">
                <QuickAction toAction={() => setTab('users')} icon={UserCheck} label="Approve Super Users" desc="Review & approve applicants" />
                <QuickAction toAction={() => setTab('products')} icon={PackageCheck} label="Moderate Products" desc="Approve or reject submissions" />
                <QuickAction toAction={() => setTab('transactions')} icon={CreditCard} label="Verify Payments" desc="Handle verifications & refunds" />
                <QuickAction toAction={() => setTab('marketing')} icon={BellRing} label="Send Announcement" desc="Notify users of updates" />
              </div>
            </SectionCard>

            {/* Attention */}
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
            <SectionCard
              title="Catalog snapshot"
              subtitle="Availability & offers are variant-aware; Live = Published + Available + Active offer"
            >
              <div className="grid sm:grid-cols-2 gap-4">
                {/* Status */}
                <div className="rounded-xl border p-3">
                  <div className="text-xs text-ink-soft mb-2">Status</div>
                  <div className="flex flex-wrap gap-2">
                    <StatChip
                      label="Published"
                      value={overview.data?.products.published ?? 0}
                      onClick={() => goProductsManage('published')}
                    />
                    <StatChip
                      label="Live"
                      value={overview.data?.products.live ?? 0}
                      onClick={() =>
                        goProductsManage('live')
                      }
                      emphasis
                    />
                    <StatChip
                      label="Pending"
                      value={overview.data?.products.pending ?? 0}
                      onClick={() => goProductsManage('pending')}
                    />
                    <StatChip
                      label="Rejected"
                      value={overview.data?.products.rejected ?? 0}
                      onClick={() => goProductsManage('rejected')}
                    />
                  </div>
                </div>

                {/* Availability */}
                <div className="rounded-xl border p-3">
                  <div className="text-xs text-ink-soft mb-2">Availability (variant-aware)</div>
                  <div className="flex flex-wrap gap-2">
                    <StatChip
                      label="All statuses available"
                      value={overview.data?.products.availability.allStatusesAvailable ?? 0}
                      onClick={() =>
                        goProductsManage("all")
                      }
                    />
                    <StatChip
                      label="Published available"
                      value={overview.data?.products.availability.publishedAvailable ?? 0}
                      onClick={() =>
                        goProductsManage('published', 'published-with-active')
                    }
                    />
                  </div>
                </div>

                {/* Offers coverage */}
                <div className="rounded-xl border p-3">
                  <div className="text-xs text-ink-soft mb-2">Supplier offers</div>
                  <div className="flex flex-wrap gap-2">
                    <StatChip
                      label="With any"
                      value={overview.data?.products.offers.withAny ?? 0}
                      onClick={() => goProductsManage('published' , 'published-with-any')}
                    />
                    <StatChip
                      label="Without any"
                      value={overview.data?.products.offers.withoutAny ?? 0}
                      onClick={() => goProductsManage('published' , 'no-offer')}
                    />
                    <StatChip
                      label="Published with any"
                      value={overview.data?.products.offers.publishedWithAny ?? 0}
                      onClick={() => goProductsManage('published-with-offer')}
                    />
                    <StatChip
                      label="Published without any"
                      value={overview.data?.products.offers.publishedWithoutAny ?? 0}
                      onClick={() => goProductsManage('published-no-offer')}
                    />
                    <StatChip
                      label="With active"
                      value={overview.data?.products.offers.withActive ?? 0}
                      onClick={() =>goProductsManage('published' , 'simple')}
                    />
                    <StatChip
                      label="Published with active"
                      value={overview.data?.products.offers.publishedWithActive ?? 0}
                      onClick={() => goProductsManage('published-with-active')}
                    />
                  </div>
                </div>

                {/* Variant mix */}
                <div className="rounded-xl border p-3">
                  <div className="text-xs text-ink-soft mb-2">Variants</div>
                  <div className="flex flex-wrap gap-2">
                    <StatChip
                      label="With variants"
                      value={overview.data?.products.variantMix.withVariants ?? 0}
                      onClick={() => goProductsManage('with-variants')}
                    />
                    <StatChip
                      label="Simple"
                      value={overview.data?.products.variantMix.simple ?? 0}
                      onClick={() => goProductsManage('simple')}
                    />
                  </div>
                </div>

                {/* Published base stock */}
                <div className="rounded-xl border p-3 sm:col-span-2">
                  <div className="text-xs text-ink-soft mb-2">Published base stock (non-variant-aware)</div>
                  <div className="flex flex-wrap gap-2">
                    <StatChip
                      label="Base in-stock"
                      value={overview.data?.products.publishedBaseStock.inStock ?? 0}
                      onClick={() => goProductsManage('published-base-in')}
                    />
                    <StatChip
                      label="Base out-of-stock"
                      value={overview.data?.products.publishedBaseStock.outOfStock ?? 0}
                      onClick={() => goProductsManage('published-base-out')}
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>
        )}

        {/* Products (Moderation + Manage) */}
        {tab === 'products' && (
          <SectionCard
            title="Products"
            subtitle="Moderate submissions or manage the catalog"
            right={
              <div className="inline-flex rounded-xl border overflow-hidden">
                <button
                  onClick={() => {
                    setPTab('moderation');
                    const s = new URLSearchParams(location.search);
                    s.set('tab', 'products');
                    s.set('pTab', 'moderation');
                    nav(`/admin?${s.toString()}`, { replace: false });
                  }}
                  className={`px-3 py-1.5 text-sm ${pTab === 'moderation' ? 'bg-zinc-900 text-white' : 'bg-white hover:bg-black/5'}`}
                >
                  Moderation
                </button>
                <button
                  onClick={() => {
                    setPTab('manage');
                    const s = new URLSearchParams(location.search);
                    s.set('tab', 'products');
                    s.set('pTab', 'manage');
                    nav(`/admin?${s.toString()}`, { replace: false });
                  }}
                  className={`px-3 py-1.5 text-sm ${pTab === 'manage' ? 'bg-zinc-900 text-white' : 'bg-white hover:bg-black/5'}`}
                >
                  Manage
                </button>
              </div>
            }
          >
            {pTab === 'moderation' ? (
              <ModerationSection
                token={token}
                onInspect={(p: { id: string; title?: string; sku?: string }) => {
                  setProdSearch(p.title || p.sku || '');
                  setFocusProductId(p.id);
                  setPTab('manage');
                  setTab('products');

                  const s = new URLSearchParams(location.search);
                  s.set('tab', 'products');
                  s.set('pTab', 'manage');
                  if (p.title || p.sku) s.set('q', p.title || p.sku || '');
                  nav(`/admin?${s.toString()}`, { replace: false });
                }}
              />
            ) : (
              <ManageProducts
                role={role}
                token={token}
                search={prodSearch}
                setSearch={setProdSearch}
                focusId={focusProductId}
                onFocusedConsumed={() => setFocusProductId(null)}
                // If your ManageProducts can consume filters or URL, you can pass them:
                // filters={manageFilters}
              />
            )}
          </SectionCard>
        )}

        {/* Catalog Settings */}
        {tab === 'catalog' && (
          <CatalogSettingsSection
            token={token}
            canEdit={role === 'SUPER_ADMIN'}
            categoriesQ={categoriesQ}
            brandsQ={brandsQ}
            attributesQ={attributesQ}
            usageQ={
              useQuery({
                queryKey: ['admin', 'catalog', 'usage'],
                enabled: !!canAdmin && tab === 'catalog',
                queryFn: async () => {
                  try {
                    const { data } = await api.get('/api/admin/catalog/usage', { headers: { Authorization: `Bearer ${token}` } });
                    return data || { categories: {}, attributes: {}, brands: {} };
                  } catch {
                    try {
                      const { data } = await api.get('/api/products?include=attributes,variants', {
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
                staleTime: staleTImeInSecs,
              })
            }
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
            /* Suppliers */
            suppliersQ={useQuery({
              queryKey: ['admin', 'suppliers'],
              enabled: !!canAdmin && tab === 'catalog',
              queryFn: async () =>
                (await api.get<{ data: AdminSupplier[] }>('/api/admin/suppliers', { headers: { Authorization: `Bearer ${token}` } }))
                  .data.data,
              refetchOnWindowFocus: false,
              staleTime: staleTImeInSecs,
            })}
            createSupplier={useMutation({
              mutationFn: async (payload: Partial<AdminSupplier>) =>
                (await api.post('/api/admin/suppliers', payload, { headers: { Authorization: `Bearer ${token}` } })).data,
              onSuccess: () => {
                qc.invalidateQueries({ queryKey: ['admin', 'suppliers'] });
              },
            })}
            updateSupplier={useMutation({
              mutationFn: async ({ id, ...payload }: Partial<AdminSupplier> & { id: string }) =>
                (await api.put(`/api/admin/suppliers/${id}`, payload, { headers: { Authorization: `Bearer ${token}` } })).data,
              onSuccess: () => {
                qc.invalidateQueries({ queryKey: ['admin', 'suppliers'] });
              },
            })}
            deleteSupplier={useMutation({
              mutationFn: async (id: string) =>
                (await api.delete(`/api/admin/suppliers/${id}`, { headers: { Authorization: `Bearer ${token}` } })).data,
              onSuccess: () => {
                qc.invalidateQueries({ queryKey: ['admin', 'suppliers'] });
              },
            })}
          />
        )}

        {/* Transactions */}
        {tab === 'transactions' && (
          <TransactionsSection
            q={q}
            setQ={setQ}
            txQ={txQ}
            onRefresh={() => qc.invalidateQueries({ queryKey: ['admin', 'payments'] })}
            onVerify={verifyPayment.mutate}
            onRefund={refundPayment.mutate}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------- Transactions section & row ---------------- */
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
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by order, reference, or email…" className="pl-9 pr-3 py-2 rounded-xl border bg-white" />
          </div>
          <button onClick={onRefresh} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-black/5">
            <RefreshCcw size={16} /> Refresh
          </button>
        </div>
      }
    >
      <div className="overflow-x-auto">
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
                  Failed to load transactions. {(txQ.error as any)?.response?.data?.error || (txQ.error as any)?.message || ''}
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
    </SectionCard>
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

function KpiCardOverview({ title, total, value, hint, res, Icon, chart }: { title: string; total: string; value: string; hint?: string; res?: string; Icon: any; chart?: ReactNode }) {
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
  const s = (label || '').toUpperCase();
  const cls =
    s === 'VERIFIED'
      ? 'bg-emerald-600/10 text-emerald-700 border-emerald-600/20'
      : s === 'PUBLISHED'
      ? 'bg-emerald-600/10 text-emerald-700 border-emerald-600/20'
      : s === 'PENDING'
      ? 'bg-amber-500/10 text-amber-700 border-amber-600/20'
      : s === 'FAILED' || s === 'CANCELED' || s === 'REJECTED' || s === 'REFUNDED'
      ? 'bg-rose-500/10 text-rose-700 border-rose-600/20'
      : s === 'PAID'
      ? 'bg-emerald-600/10 text-emerald-700 border-emerald-600/20'
      : s === 'SUSPENDED' || s === 'DEACTIVATED' || s === 'DISABLED'
      ? 'bg-rose-500/10 text-rose-700 border-rose-600/20'
      : 'bg-zinc-500/10 text-zinc-700 border-zinc-600/20';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${cls}`}>{label}</span>;
}

function RoleSelect({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (role: string) => void }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`border rounded-lg px-2 py-1 text-sm bg-white ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
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

/* ---------------- Moderation section wrapper ---------------- */
function ModerationSection({ token, onInspect }: { token?: string | null; onInspect: (p: any) => void }) {
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = React.useState('');
  const debounced = useDebounced(searchInput, 350);
  const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

  // (Optional) example query you can keep for counts; the grid does its own fetching
  const productsQ = useQuery<AdminProduct[]>({
    queryKey: ['admin', 'products', 'pending', { q: debounced }],
    enabled: !!token,
    queryFn: async () => {
      try {
        const { data } = await api.get('/api/admin/products/published', {
          headers: hdr, params: { q: debounced },
        });
        return Array.isArray(data?.data) ? data.data : [];
      } catch {
        const { data } = await api.get('/api/products', {
          headers: hdr, params: { status: 'PENDING', q: debounced, take: 50, skip: 0 },
        });
        return Array.isArray(data?.data) ? data.data : [];
      }
    },
  });

  const approveM = useMutation({
    mutationFn: async (id: string) => (await api.post(`/api/admin/products/${id}/approve`, {}, { headers: hdr })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products', 'pending'] });
      qc.invalidateQueries({ queryKey: ['admin', 'products', 'published'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
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
