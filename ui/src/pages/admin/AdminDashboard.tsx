// src/pages/AdminDashboard.tsx
import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
    ShieldCheck,
    Users,
    UserCheck,
    PackageCheck,
    PackageX,
    CreditCard,
    RefreshCcw,
    Settings,
    BellRing,
    BarChart3,
    Search,
    Check,
    ChevronDown,
    ChevronRight,
    Image as ImageIcon,
} from 'lucide-react';
import React from 'react';

import api from '../../api/client';
import { useAuthStore } from '../../store/auth.js';
import { useToast } from '../../components/ToastProvider.js';
import { useModal } from '../../components/ModalProvider.js';


/** ===== tweak this if your backend upload route differs ===== */
const UPLOAD_ENDPOINT = '/api/uploads';
/** =========================================================== */

/* ---------------- Types ---------------- */
type Me = {
    id: string;
    role: 'ADMIN' | 'SUPER_ADMIN' | string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
};

type Overview = {
    totalUsers: number;
    totalSuperAdmins: number;
    totalAdmins: number;
    totalCustomers: number;
    productsPending: number;
    productsPublished: number;
    productsInStock: number;
    productsOutOfStock: number;
    productsTotal: number;
    ordersToday: number;
    revenueToday: number;
    sparklineRevenue7d?: number[];
};

type AdminUser = {
    id: string;
    email: string;
    role: string;
    status: string;
    createdAt?: string;
};

type AdminProduct = {
    id: string;
    title: string;
    price: number | string;
    status: string;
    imagesJson?: string[];
    createdAt?: string;
    ownerEmail?: string | null;
    categoryId?: string | null;
    brandId?: string | null;
    supplierId?: string | null;
    sku?: string | null;
    inStock?: boolean;
    vatFlag?: boolean;
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

type AdminAttribute = {
    id: string;
    name: string;
    type: 'TEXT' | 'SELECT' | 'MULTISELECT';
    isActive: boolean;
    values?: AdminAttributeValue[];
};
type AdminAttributeValue = {
    id: string;
    name: string;
    code?: string | null;
    attributeId: string;
    position?: number | null;
    isActive: boolean;
};

type AdminSupplier = {
    id: string;
    name: string;
    type: 'PHYSICAL' | 'ONLINE' | string;
    status: string; // 'ACTIVE' | 'INACTIVE'
    contactEmail?: string | null;
    whatsappPhone?: string | null;
    payoutPctInt?: number | null;
};

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
function Sparkline({ points = [] as number[] }) {
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

/* ---------------- Tabs ---------------- */
type TabKey = 'overview' | 'users' | 'products' | 'transactions' | 'catalog' | 'ops' | 'marketing' | 'analytics';

/* =========================================================
   AdminDashboard
   ========================================================= */
export default function AdminDashboard() {
    const { token } = useAuthStore();
    const nav = useNavigate();
    const toast = useToast();
    const { openModal } = useModal();
    const qc = useQueryClient();

    // inner products tab state
    type ProductsInnerTab = 'moderation' | 'manage';
    const [pTab, setPTab] = useState<ProductsInnerTab>('moderation');

    // NEW state at the top alongside other useStates
    const [prodSearch, setProdSearch] = useState('');
    const [focusProductId, setFocusProductId] = useState<string | null>(null);
    // Role-gate
    const me = useQuery({
        queryKey: ['me'],
        enabled: !!token,
        queryFn: async () =>
            (await api.get<Me>('/api/profile/me', { headers: token ? { Authorization: `Bearer ${token}` } : undefined })).data,
        staleTime: 60_000,
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

    const [tab, setTab] = useState<TabKey>('overview');
    const [q, setQ] = useState('');

    /* -------- Overview -------- */
    const overview = useQuery({
        queryKey: ['admin', 'overview'],
        enabled: !!canAdmin,
        queryFn: async () => (await api.get<Overview>('/api/admin/overview', { headers: { Authorization: `Bearer ${token}` } })).data,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    });

    /* -------- Users & Roles -------- */
    const usersQ = useQuery({
        queryKey: ['admin', 'users', q],
        enabled: !!canAdmin && tab === 'users',
        queryFn: async () => {
            const { data } = await api.get<{ data: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            return data?.data ?? [];
        },
        refetchOnWindowFocus: false,
    });

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
        staleTime: 15_000,
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
        staleTime: 60_000,
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
            (await api.put(`/api/admin/categories/${id}`, payload, { headers: { Authorization: `Bearer ${token}` } })).data,
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
        staleTime: 60_000,
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
        staleTime: 60_000,
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

    const createAttrValue = useMutation({
        mutationFn: async ({
            attributeId,
            ...payload
        }: {
            attributeId: string;
            name: string;
            code?: string | null;
            position?: number | null;
            isActive?: boolean;
        }) => (await api.post(`/api/admin/attributes/${attributeId}/values`, payload, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'attributes'] });
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
        }) => (await api.put(`/api/admin/attributes/${attributeId}/values/${id}`, payload, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'attributes'] });
        },
    });
    const deleteAttrValue = useMutation({
        mutationFn: async ({ attributeId, id }: { attributeId: string; id: string }) =>
            (await api.delete(`/api/admin/attributes/${attributeId}/values/${id}`, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'attributes'] });
        },
    });

    /* -------- Usage (for disable delete) -------- */
    const usageQ = useQuery({
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
        staleTime: 60_000,
    });

    /* -------- Suppliers (Catalog) -------- */
    const suppliersQ = useQuery({
        queryKey: ['admin', 'suppliers'],
        enabled: !!canAdmin && tab === 'catalog',
        queryFn: async () =>
            (await api.get<{ data: AdminSupplier[] }>('/api/admin/suppliers', { headers: { Authorization: `Bearer ${token}` } })).data.data,
        refetchOnWindowFocus: false,
        staleTime: 60_000,
    });

    const createSupplier = useMutation({
        mutationFn: async (payload: Partial<AdminSupplier>) =>
            (await api.post('/api/admin/suppliers', payload, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'suppliers'] });
        },
    });
    const updateSupplier = useMutation({
        mutationFn: async ({ id, ...payload }: Partial<AdminSupplier> & { id: string }) =>
            (await api.put(`/api/admin/suppliers/${id}`, payload, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'suppliers'] });
        },
    });
    const deleteSupplier = useMutation({
        mutationFn: async (id: string) =>
            (await api.delete(`/api/admin/suppliers/${id}`, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'suppliers'] });
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

    /* ---------------- UI helpers ---------------- */
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

    return (
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6">
            {/* Hero */}
            <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-sky-700 via-sky-600 to-indigo-700 text-white">
                <div className="absolute inset-0 opacity-30 bg-[radial-gradient(closest-side,rgba(255,255,255,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,0,0,0.15),transparent_60%)]" />
                <div className="relative px-5 md:px-8 py-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <motion.h1 initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-2xl md:text-3xl font-bold tracking-tight">
                                {me.isLoading ? 'Loading…' : (role === 'SUPER_ADMIN' ? 'Super Admin Dashboard' : 'Admin Dashboard')}                            </motion.h1>
                            <p className="text-white/80 text-sm mt-1">Full control & oversight — users, products, transactions, operations, marketing, and analytics.</p>
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
                    value={(overview.data?.totalUsers ?? 0).toLocaleString()}
                    hint={`${overview.data?.totalCustomers ?? 0} Customers   • ${overview.data?.totalSuperAdmins ?? 0} Super Admins Users  • ${overview.data?.totalAdmins ?? 0} Admin Users`}
                    Icon={Users}
                />
                <KpiCard
                    title="Products"
                    value={`${overview.data?.productsPublished ?? 0} Published, ${overview.data?.productsTotal ?? 0} total`}
                    hint={`${overview.data?.productsInStock ?? 0} In Stock, ${overview.data?.productsOutOfStock ?? 0} Out of Stock, ${overview.data?.productsPending ?? 0} pending review`}
                    Icon={PackageCheck}
                />
                <KpiCard title="Orders Today" value={(overview.data?.ordersToday ?? 0).toLocaleString()} hint="New orders" Icon={CreditCard} />
                <KpiCard title="Revenue Today" value={ngn.format(fmtN(overview.data?.revenueToday))} hint="Last 7 days" Icon={BarChart3} chart={<Sparkline points={overview.data?.sparklineRevenue7d || []} />} />
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
                {/* -------- Users -------- */}
                {tab === 'users' && (
                    <SectionCard
                        title="Users & Roles"
                        subtitle="Create, approve, deactivate, reactivate; manage privileges"
                        right={
                            <div className="relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email or role…" className="pl-9 pr-3 py-2 rounded-xl border bg-white" />
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
                                                <td className="px-3 py-3">{role === 'SUPER_ADMIN' ? <RoleSelect value={u.role} onChange={(newRole) => updateUserRole.mutate({ userId: u.id, role: newRole })} /> : u.role}</td>
                                                <td className="px-3 py-3">
                                                    <StatusDot label={u.status} />
                                                </td>
                                                <td className="px-3 py-3">{fmtDate(u.createdAt)}</td>
                                                <td className="px-3 py-3 text-right">
                                                    <div className="inline-flex flex-wrap items-center gap-2">
                                                        {!isSuspended ? (
                                                            <button onClick={() => deactivateUser.mutate(u.id)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
                                                                Deactivate
                                                            </button>
                                                        ) : (
                                                            <button onClick={() => reactivateUser.mutate(u.id)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
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
                )}

                {/* -------- Overview -------- */}
                {tab === 'overview' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <SectionCard title="Quick Actions" subtitle="Common admin tasks at a glance">
                            <div className="grid sm:grid-cols-2 gap-3">
                                <QuickAction toAction={() => setTab('users')} icon={UserCheck} label="Approve Super Users" desc="Review & approve applicants" />
                                <QuickAction toAction={() => setTab('products')} icon={PackageCheck} label="Moderate Products" desc="Approve or reject submissions" />
                                <QuickAction toAction={() => setTab('transactions')} icon={CreditCard} label="Verify Payments" desc="Handle verifications & refunds" />
                                <QuickAction toAction={() => setTab('marketing')} icon={BellRing} label="Send Announcement" desc="Notify users of updates" />
                            </div>
                        </SectionCard>

                        <SectionCard title="What needs attention" subtitle="Pending items & alerts">
                            <ul className="space-y-3 text-sm">
                                <li className="flex items-center justify-between border rounded-xl px-3 py-2">
                                    <span className="text-ink">Products pending review</span>
                                    <span className="font-semibold">{overview.data?.productsPending ?? 0}</span>
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
                    </div>
                )}

                {/* -------- Products (Moderation + Manage) -------- */}
                {tab === 'products' && (
                    <SectionCard
                        title="Products"
                        subtitle="Moderate submissions or manage the catalog"
                        right={
                            <div className="inline-flex rounded-xl border overflow-hidden">
                                <button
                                    onClick={() => setPTab('moderation')}
                                    className={`px-3 py-1.5 text-sm ${pTab === 'moderation' ? 'bg-zinc-900 text-white' : 'bg-white hover:bg-black/5'}`}
                                >
                                    Moderation
                                </button>
                                <button
                                    onClick={() => setPTab('manage')}
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
                            />
                        )}

                    </SectionCard>
                )}


                {/* -------- Catalog Settings -------- */}
                {tab === 'catalog' && (
                    <CatalogSettingsSection
                        token={token}
                        canEdit={role === 'SUPER_ADMIN'}
                        categoriesQ={categoriesQ}
                        brandsQ={brandsQ}
                        attributesQ={attributesQ}
                        usageQ={usageQ}
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
                        suppliersQ={suppliersQ}
                        createSupplier={createSupplier}
                        updateSupplier={updateSupplier}
                        deleteSupplier={deleteSupplier}
                    />
                )}

                {/* -------- Transactions -------- */}
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

function TransactionRow({ tx, onVerify, onRefund }: { tx: AdminPayment; onVerify: () => void; onRefund: () => void }) {
    const [open, setOpen] = useState(false);
    const hasItems = Array.isArray(tx.items) && tx.items.length > 0;
    return (
        <>
            <tr className="hover:bg-black/5">
                <td className="px-3 py-3 font-mono">
                    <div className="flex items-center gap-2">
                        {hasItems ? (
                            <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center justify-center w-6 h-6 rounded-md border hover:bg-black/5">
                                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                        ) : (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md border text-zinc-300">•</span>
                        )}
                        <span>{tx.id}</span>
                    </div>
                    {tx.reference && <div className="text-[11px] text-zinc-500 mt-0.5">Ref: {tx.reference}</div>}
                </td>
                <td className="px-3 py-3">
                    <Link to={`/orders?open=${tx.orderId}`} className="text-primary-700 underline">
                        {tx.orderId}
                    </Link>
                </td>
                <td className="px-3 py-3">{tx.userEmail || '—'}</td>
                <td className="px-3 py-3">{ngn.format(fmtN(tx.amount))}</td>
                <td className="px-3 py-3">
                    <StatusDot label={tx.status} />
                </td>
                <td className="px-3 py-3">{fmtDate(tx.createdAt)}</td>
                <td className="px-3 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                        <button
                            onClick={onVerify}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                            disabled={['PAID', 'VERIFIED', 'CANCELED', 'REFUNDED'].includes((tx.status || '').toUpperCase())}
                            title={tx.status === 'PAID' ? 'Already verified' : 'Verify payment'}
                        >
                            <Check size={16} /> Verify
                        </button>
                        <button onClick={onRefund} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5" title="Refund">
                            <CreditCard size={16} /> Refund
                        </button>
                    </div>
                </td>
            </tr>

            {open && hasItems && (
                <tr className="bg-zinc-50/60">
                    <td colSpan={7} className="px-3 py-3">
                        <div className="rounded-xl border bg-white">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="bg-zinc-50">
                                        <th className="text-left px-3 py-2">Item</th>
                                        <th className="text-left px-3 py-2">Qty</th>
                                        <th className="text-left px-3 py-2">Unit Price</th>
                                        <th className="text-left px-3 py-2">Line Total</th>
                                        <th className="text-left px-3 py-2">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {tx.items!.map((it) => (
                                        <tr key={it.id}>
                                            <td className="px-3 py-2">{it.title}</td>
                                            <td className="px-3 py-2">{it.quantity}</td>
                                            <td className="px-3 py-2">{ngn.format(fmtN(it.unitPrice))}</td>
                                            <td className="px-3 py-2">{ngn.format(fmtN(it.lineTotal))}</td>
                                            <td className="px-3 py-2">
                                                <StatusDot label={it.status || '—'} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-zinc-50">
                                        <td colSpan={3} className="px-3 py-2 text-right font-medium">
                                            Order total:
                                        </td>
                                        <td className="px-3 py-2 font-semibold">{ngn.format(fmtN(tx.amount))}</td>
                                        <td />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </td>
                </tr>
            )}
        </>
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

function StatusDot({ label }: { label: string }) {
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

/* =========================================================
   Catalog Settings Section
   ========================================================= */
function CatalogSettingsSection(props: {
    token?: string | null;
    canEdit: boolean;
    categoriesQ: any;
    brandsQ: any;
    attributesQ: any;
    usageQ: any;
    createCategory: any;
    updateCategory: any;
    deleteCategory: any;
    createBrand: any;
    updateBrand: any;
    deleteBrand: any;
    createAttribute: any;
    updateAttribute: any;
    deleteAttribute: any;
    createAttrValue: any;
    updateAttrValue: any;
    deleteAttrValue: any;
    /* Suppliers */
    suppliersQ: any;
    createSupplier: any;
    updateSupplier: any;
    deleteSupplier: any;
}) {
    const {
        canEdit,
        categoriesQ,
        brandsQ,
        attributesQ,
        usageQ,
        createCategory,
        updateCategory,
        deleteCategory,
        createBrand,
        updateBrand,
        deleteBrand,
        createAttribute,
        updateAttribute,
        deleteAttribute,
        createAttrValue,
        updateAttrValue,
        deleteAttrValue,
        suppliersQ,
        createSupplier,
        updateSupplier,
        deleteSupplier,
    } = props;

    const categoryUsage: Record<string, number> = usageQ.data?.categories || {};
    const attributeUsage: Record<string, number> = usageQ.data?.attributes || {};
    const brandUsage: Record<string, number> = usageQ.data?.brands || {};

    const [valuePendings, setValuePendings] = useState<Record<string, { name: string; code?: string }>>({});

    const qc = useQueryClient();
    const { openModal } = useModal();
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

    return (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Categories */}
            <SectionCard
                title="Categories"
                subtitle="Organize your catalog hierarchy"
                right={
                    <button
                        onClick={async () => {
                            try {
                                await api.post('/api/admin/catalog/backfill');
                                qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
                                qc.invalidateQueries({ queryKey: ['admin', 'brands'] });
                                qc.invalidateQueries({ queryKey: ['admin', 'attributes'] });
                                qc.invalidateQueries({ queryKey: ['admin', 'catalog', 'usage'] });
                            } catch (e: any) {
                                openModal({ title: 'Backfill', message: e?.response?.data?.error || 'Failed to backfill' });
                            }
                        }}
                        className="px-3 py-2 rounded-lg bg-emerald-600 text-white"
                    >
                        Backfill & Relink
                    </button>
                }
            >
                {canEdit && <CategoryForm categories={categoriesQ.data ?? []} onCreate={(payload) => createCategory.mutate(payload)} />}

                <div className="border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-zinc-50">
                            <tr>
                                <th className="text-left px-3 py-2">Name</th>
                                <th className="text-left px-3 py-2">Slug</th>
                                <th className="text-left px-3 py-2">Parent</th>
                                <th className="text-left px-3 py-2">In use</th>
                                <th className="text-right px-3 py-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {(categoriesQ.data ?? []).map((c: AdminCategory) => {
                                const used = categoryUsage[c.id] || 0;
                                return (
                                    <tr key={c.id}>
                                        <td className="px-3 py-2">{c.name}</td>
                                        <td className="px-3 py-2">{c.slug}</td>
                                        <td className="px-3 py-2">{(categoriesQ.data ?? []).find((x: AdminCategory) => x.id === c.parentId)?.name || '—'}</td>
                                        <td className="px-3 py-2">{used}</td>
                                        <td className="px-3 py-2 text-right">
                                            {canEdit && (
                                                <div className="inline-flex gap-2">
                                                    <button onClick={() => updateCategory.mutate({ id: c.id, isActive: !c.isActive })} className="px-2 py-1 rounded border">
                                                        {c.isActive ? 'Disable' : 'Enable'}
                                                    </button>
                                                    <button
                                                        onClick={() => used === 0 && deleteCategory.mutate(c.id)}
                                                        className={`px-2 py-1 rounded ${used === 0 ? 'bg-rose-600 text-white' : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'}`}
                                                        disabled={used > 0}
                                                        title={used > 0 ? 'Cannot delete: category is in use' : 'Delete category'}
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {(categoriesQ.data ?? []).length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-3 py-4 text-center text-zinc-500">
                                        No categories
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </SectionCard>

            {/* Brands */}
            <SectionCard title="Brands" subtitle="Manage brand metadata">
                {canEdit && <BrandForm onCreate={(payload) => createBrand.mutate(payload)} />}
                <div className="border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-zinc-50">
                            <tr>
                                <th className="text-left px-3 py-2">Name</th>
                                <th className="text-left px-3 py-2">Slug</th>
                                <th className="text-left px-3 py-2">Active</th>
                                <th className="text-left px-3 py-2">In use</th>
                                <th className="text-right px-3 py-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {(brandsQ.data ?? []).map((b: AdminBrand) => {
                                const used = brandUsage[b.id] || 0;
                                return (
                                    <tr key={b.id}>
                                        <td className="px-3 py-2">{b.name}</td>
                                        <td className="px-3 py-2">{b.slug}</td>
                                        <td className="px-3 py-2">
                                            <StatusDot label={b.isActive ? 'ACTIVE' : 'INACTIVE'} />
                                        </td>
                                        <td className="px-3 py-2">{used}</td>
                                        <td className="px-3 py-2 text-right">
                                            {canEdit && (
                                                <div className="inline-flex gap-2">
                                                    <button onClick={() => updateBrand.mutate({ id: b.id, isActive: !b.isActive })} className="px-2 py-1 rounded border">
                                                        {b.isActive ? 'Disable' : 'Enable'}
                                                    </button>
                                                    <button
                                                        onClick={() => used === 0 && deleteBrand.mutate(b.id)}
                                                        className={`px-2 py-1 rounded ${used === 0 ? 'bg-rose-600 text-white' : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'}`}
                                                        disabled={used > 0}
                                                        title={used > 0 ? 'Cannot delete: brand is in use' : 'Delete brand'}
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {(brandsQ.data ?? []).length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-3 py-4 text-center text-zinc-500">
                                        No brands
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </SectionCard>

            {/* Suppliers */}
            <SectionCard title="Suppliers" subtitle="Manage suppliers available to assign to products">
                {canEdit && <SupplierForm onCreate={(payload) => createSupplier.mutate(payload)} />}
                <div className="border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-zinc-50">
                            <tr>
                                <th className="text-left px-3 py-2">Name</th>
                                <th className="text-left px-3 py-2">Type</th>
                                <th className="text-left px-3 py-2">Status</th>
                                <th className="text-left px-3 py-2">Payout %</th>
                                <th className="text-right px-3 py-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {(suppliersQ.data ?? []).map((s: AdminSupplier) => (
                                <tr key={s.id}>
                                    <td className="px-3 py-2">{s.name}</td>
                                    <td className="px-3 py-2">{s.type}</td>
                                    <td className="px-3 py-2">
                                        <StatusDot label={s.status || 'INACTIVE'} />
                                    </td>
                                    <td className="px-3 py-2">{s.payoutPctInt ?? ''}</td>
                                    <td className="px-3 py-2 text-right">
                                        {canEdit && (
                                            <div className="inline-flex gap-2">
                                                <button onClick={() => updateSupplier.mutate({ id: s.id, status: s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })} className="px-2 py-1 rounded border">
                                                    {s.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                                                </button>
                                                <button onClick={() => deleteSupplier.mutate(s.id)} className="px-2 py-1 rounded bg-rose-600 text-white">
                                                    Delete
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {(suppliersQ.data ?? []).length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-3 py-4 text-center text-zinc-500">
                                        No suppliers
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </SectionCard>

            {/* Attributes & Values */}
            <SectionCard title="Attributes" subtitle="Define attribute schema & options">
                {canEdit && <AttributeForm onCreate={(payload) => createAttribute.mutate(payload)} />}

                <div className="grid gap-3">
                    {(attributesQ.data ?? []).map((a: AdminAttribute) => {
                        const used = attributeUsage[a.id] || 0;
                        const pending = valuePendings[a.id] ?? { name: '', code: '' };

                        return (
                            <div key={a.id} className="border rounded-xl">
                                <div className="flex items-center justify-between px-3 py-2">
                                    <div className="min-w-0">
                                        <div className="font-medium">
                                            {a.name} <span className="text-xs text-zinc-500">({a.type})</span>
                                        </div>
                                        <div className="text-xs flex items-center gap-2">
                                            <StatusDot label={a.isActive ? 'ACTIVE' : 'INACTIVE'} />
                                            <span className="text-zinc-500">In use: {used}</span>
                                        </div>
                                    </div>
                                    {canEdit && (
                                        <div className="inline-flex gap-2">
                                            <button onClick={() => updateAttribute.mutate({ id: a.id, isActive: !a.isActive })} className="px-2 py-1 rounded border">
                                                {a.isActive ? 'Disable' : 'Enable'}
                                            </button>
                                            <button
                                                onClick={() => used === 0 && deleteAttribute.mutate(a.id)}
                                                className={`px-2 py-1 rounded ${used === 0 ? 'bg-rose-600 text-white' : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'}`}
                                                disabled={used > 0}
                                                title={used > 0 ? 'Cannot delete: attribute is in use' : 'Delete attribute'}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Values */}
                                <div className="border-t p-3">
                                    <div className="text-xs text-ink-soft mb-2">Values</div>
                                    {(a.values ?? []).length === 0 && <div className="text-xs text-zinc-500 mb-2">No values</div>}
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {(a.values ?? []).map((v) => (
                                            <div key={v.id} className="px-2 py-1 rounded border bg-white inline-flex items-center gap-2">
                                                <span className="text-sm">{v.name}</span>
                                                {canEdit && (
                                                    <>
                                                        <button className="text-xs underline" onClick={() => updateAttrValue.mutate({ attributeId: a.id, id: v.id, isActive: !v.isActive })}>
                                                            {v.isActive ? 'Disable' : 'Enable'}
                                                        </button>
                                                        <button className="text-xs text-rose-600 underline" onClick={() => deleteAttrValue.mutate({ attributeId: a.id, id: v.id })}>
                                                            Delete
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {canEdit && (
                                        <div className="grid grid-cols-3 gap-2">
                                            <input
                                                placeholder="Value name"
                                                className="border rounded-lg px-3 py-2 col-span-2"
                                                value={pending.name}
                                                onChange={(e) => setValuePendings((d) => ({ ...d, [a.id]: { ...(d[a.id] || {}), name: e.target.value } }))}
                                            />
                                            <input
                                                placeholder="Code (optional)"
                                                className="border rounded-lg px-3 py-2"
                                                value={pending.code ?? ''}
                                                onChange={(e) => setValuePendings((d) => ({ ...d, [a.id]: { ...(d[a.id] || {}), code: e.target.value } }))}
                                            />
                                            <button
                                                className="col-span-3 justify-self-end px-3 py-2 rounded-lg bg-emerald-600 text-white"
                                                onClick={() => {
                                                    const n = (valuePendings[a.id]?.name || '').trim();
                                                    if (!n) return;
                                                    createAttrValue.mutate(
                                                        { attributeId: a.id, name: n, code: valuePendings[a.id]?.code },
                                                        { onSuccess: () => setValuePendings((d) => ({ ...d, [a.id]: { name: '', code: '' } })) }
                                                    );
                                                }}
                                            >
                                                Add value
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {(attributesQ.data ?? []).length === 0 && <div className="text-center text-zinc-500 text-sm py-4">No attributes</div>}
                </div>
            </SectionCard>
        </div>
    );
}

/* ---------------- Small, typing-safe form components ---------------- */
function CategoryForm({
    onCreate,
    categories,
}: {
    onCreate: (payload: { name: string; slug: string; parentId: string | null; isActive: boolean }) => void;
    categories: Array<{ id: string; name: string }>;
}) {
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [parentId, setParentId] = useState<string | null>(null);
    const [isActive, setIsActive] = useState(true);

    const submit = useCallback(() => {
        if (!name.trim() || !slug.trim()) return;
        onCreate({ name: name.trim(), slug: slug.trim(), parentId, isActive });
        setName('');
        setSlug('');
        setParentId(null);
        setIsActive(true);
    }, [name, slug, parentId, isActive, onCreate]);

    return (
        <div className="mb-3 grid grid-cols-2 gap-2">
            <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="border rounded-lg px-3 py-2" />
            <input placeholder="Slug" value={slug} onChange={(e) => setSlug(e.target.value)} className="border rounded-lg px-3 py-2" />
            <select value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)} className="border rounded-lg px-3 py-2 col-span-2">
                <option value="">No parent</option>
                {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                        {c.name}
                    </option>
                ))}
            </select>
            <label className="flex items-center gap-2">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span className="text-sm">Active</span>
            </label>
            <button onClick={submit} className="justify-self-end px-3 py-2 rounded-lg bg-emerald-600 text-white">
                Add
            </button>
        </div>
    );
}

function BrandForm({ onCreate }: { onCreate: (payload: { name: string; slug: string; logoUrl?: string; isActive: boolean }) => void }) {
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [logoUrl, setLogoUrl] = useState('');
    const [isActive, setIsActive] = useState(true);

    const submit = useCallback(() => {
        if (!name.trim() || !slug.trim()) return;
        onCreate({ name: name.trim(), slug: slug.trim(), logoUrl: logoUrl.trim() || undefined, isActive });
        setName('');
        setSlug('');
        setLogoUrl('');
        setIsActive(true);
    }, [name, slug, logoUrl, isActive, onCreate]);

    return (
        <div className="mb-3 grid grid-cols-2 gap-2">
            <input placeholder="Name" className="border rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
            <input placeholder="Slug" className="border rounded-lg px-3 py-2" value={slug} onChange={(e) => setSlug(e.target.value)} />
            <input placeholder="Logo URL (optional)" className="border rounded-lg px-3 py-2 col-span-2" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
            <label className="flex items-center gap-2">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span className="text-sm">Active</span>
            </label>
            <button onClick={submit} className="justify-self-end px-3 py-2 rounded-lg bg-emerald-600 text-white">
                Add
            </button>
        </div>
    );
}

function AttributeForm({ onCreate }: { onCreate: (payload: { name: string; type: 'TEXT' | 'SELECT' | 'MULTISELECT'; isActive: boolean }) => void }) {
    const [name, setName] = useState('');
    const [type, setType] = useState<'TEXT' | 'SELECT' | 'MULTISELECT'>('SELECT');
    const [isActive, setIsActive] = useState(true);

    const submit = useCallback(() => {
        if (!name.trim()) return;
        onCreate({ name: name.trim(), type, isActive });
        setName('');
        setType('SELECT');
        setIsActive(true);
    }, [name, type, isActive, onCreate]);

    return (
        <div className="mb-3 grid grid-cols-2 gap-2">
            <input placeholder="Name" className="border rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="border rounded-lg px-3 py-2" value={type} onChange={(e) => setType(e.target.value as any)}>
                <option value="TEXT">TEXT</option>
                <option value="SELECT">SELECT</option>
                <option value="MULTISELECT">MULTISELECT</option>
            </select>
            <label className="flex items-center gap-2">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span className="text-sm">Active</span>
            </label>
            <button onClick={submit} className="justify-self-end px-3 py-2 rounded-lg bg-emerald-600 text-white">
                Add
            </button>
        </div>
    );
}

function SupplierForm({
    onCreate,
}: {
    onCreate: (payload: {
        name: string;
        type: 'PHYSICAL' | 'ONLINE';
        status: 'ACTIVE' | 'INACTIVE';
        contactEmail?: string;
        whatsappPhone?: string;
        payoutPctInt?: number;
    }) => void;
}) {
    const [name, setName] = useState('');
    const [type, setType] = useState<'PHYSICAL' | 'ONLINE'>('PHYSICAL');
    const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
    const [contactEmail, setContactEmail] = useState('');
    const [whatsappPhone, setWhatsappPhone] = useState('');
    const [payoutPctInt, setPayoutPctInt] = useState<string>('70');

    const submit = useCallback(() => {
        const n = name.trim();
        if (!n) return;
        onCreate({
            name: n,
            type,
            status,
            contactEmail: contactEmail.trim() || undefined,
            whatsappPhone: whatsappPhone.trim() || undefined,
            payoutPctInt: Number(payoutPctInt) || undefined,
        });
        setName('');
        setType('PHYSICAL');
        setStatus('ACTIVE');
        setContactEmail('');
        setWhatsappPhone('');
        setPayoutPctInt('70');
    }, [name, type, status, contactEmail, whatsappPhone, payoutPctInt, onCreate]);

    return (
        <div className="mb-3 grid grid-cols-2 gap-2">
            <input placeholder="Supplier name" className="border rounded-lg px-3 py-2 col-span-2" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="border rounded-lg px-3 py-2" value={type} onChange={(e) => setType(e.target.value as any)}>
                <option value="PHYSICAL">PHYSICAL</option>
                <option value="ONLINE">ONLINE</option>
            </select>
            <select className="border rounded-lg px-3 py-2" value={status} onChange={(e) => setStatus(e.target.value as any)}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
            </select>
            <input placeholder="Contact email (optional)" className="border rounded-lg px-3 py-2" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            <input placeholder="WhatsApp phone (optional)" className="border rounded-lg px-3 py-2" value={whatsappPhone} onChange={(e) => setWhatsappPhone(e.target.value)} />
            <input placeholder="Payout % (e.g., 70)" className="border rounded-lg px-3 py-2" inputMode="numeric" value={payoutPctInt} onChange={(e) => setPayoutPctInt(e.target.value)} />
            <button onClick={submit} className="justify-self-end px-3 py-2 rounded-lg bg-emerald-600 text-white">
                Add
            </button>
        </div>
    );
}
/* ---------------- Image helpers ---------------- */
function isUrlish(s?: string) {
    return !!s && /^(https?:\/\/|data:image\/|\/)/i.test(s);
}
function toArray(x: any): any[] {
    return Array.isArray(x) ? x : x == null ? [] : [x];
}
function extractImageUrls(p: any): string[] {
    // 1) straight array
    if (Array.isArray(p?.imagesJson)) {
        return p.imagesJson.filter(isUrlish);
    }
    // 2) JSON/string/CSV variants commonly seen
    if (typeof p?.imagesJson === 'string') {
        try {
            const parsed = JSON.parse(p.imagesJson);
            if (Array.isArray(parsed)) return parsed.filter(isUrlish);
        } catch { }
        return p.imagesJson
            .split(/[\n,]/g)
            .map((t: string) => t.trim())
            .filter(isUrlish);
    }
    // 3) other common fields one might get back
    const candidates = [
        ...(toArray(p?.imageUrls) as string[]),
        ...(toArray(p?.images) as string[]),
        p?.image,
        p?.primaryImage,
        p?.coverUrl,
    ].filter(Boolean);
    return candidates.filter(isUrlish);
}

function useDebounced<T>(value: T, delay = 350) {
    const [d, setD] = React.useState(value);
    React.useEffect(() => { const t = setTimeout(() => setD(value), delay); return () => clearTimeout(t); }, [value, delay]);
    return d;
}

function ModerationSection({ token, onInspect }: { token?: string | null; onInspect: (p: any) => void }) {
    const qc = useQueryClient();
    const [searchInput, setSearchInput] = React.useState('');
    const debounced = useDebounced(searchInput, 350);
    const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

    // fetch PENDING items (unified endpoint; falls back to /pending)
    const productsQ = useQuery<AdminProduct[]>({
        queryKey: ['admin', 'products', 'pending', { q: debounced }],
        enabled: !!token,
        queryFn: async () => {
            try {
                const { data } = await api.get('/api/admin/products', {
                    headers: hdr,
                    params: { status: 'PENDING', q: debounced, take: 50, skip: 0 },
                });
                return Array.isArray(data?.data) ? data.data : [];
            } catch {
                // fallback to the dedicated /pending route
                const { data } = await api.get('/api/admin/products/pending', {
                    headers: hdr, params: { q: debounced },
                });
                return Array.isArray(data?.data) ? data.data : [];
            }
        },
        staleTime: 10_000,
        refetchOnWindowFocus: false,
    });

    // approve / reject
    const approveM = useMutation({
        mutationFn: async (id: string) => (await api.post(`/api/admin/products/${id}/approve`, {}, { headers: hdr })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'products', 'pending'] });
            qc.invalidateQueries({ queryKey: ['admin', 'overview'] }); // refresh KPIs
        },
    });
    const rejectM = useMutation({
        mutationFn: async (id: string) => (await api.post(`/api/admin/products/${id}/reject`, {}, { headers: hdr })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'products', 'pending'] });
            qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
        },
    });

    return (
        <ModerationGrid
            search={searchInput}
            setSearch={setSearchInput}
            productsQ={productsQ}
            onApprove={(id: string) => approveM.mutate(id)}
            onReject={(id: string) => rejectM.mutate(id)}
            onInspect={onInspect}
        />
    );
}


/* =========================================================
   Moderation / Manage
   ========================================================= */
function ModerationGrid({ search, setSearch, productsQ, onApprove, onReject, onInspect }: any) {
    return (
        <>
            <div className="relative mb-3">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by title…"
                    className="pl-9 pr-3 py-2 rounded-xl border bg-white"
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {(productsQ.data ?? []).map((p: any) => (
                    <div key={p.id} className="rounded-2xl border bg-white overflow-hidden shadow-sm">
                        {/* Thumbnails */}
                        <div className="p-3">
                            {(() => {
                                const urls = extractImageUrls(p);
                                return urls.length ? (
                                    <div className="grid grid-cols-5 sm:grid-cols-6 gap-1">
                                        {urls.map((src: string, idx: number) => (
                                            <div
                                                key={`${p.id}-img-${idx}`}
                                                className="relative w-full pt-[100%] bg-zinc-100 overflow-hidden rounded"
                                            >
                                                <img
                                                    src={src}
                                                    alt={`${p.title || 'Product'} image ${idx + 1}`}
                                                    className="absolute inset-0 w-full h-full object-cover"
                                                    loading="lazy"
                                                    onError={(e) => {
                                                        (e.currentTarget.parentElement as HTMLElement).style.display = 'none';
                                                    }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-28 rounded bg-zinc-100 grid place-items-center text-xs text-zinc-500">
                                        No images
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Actions (restored) */}
                        <div className="px-3 pb-3">
                            <div className="mt-1 flex items-center justify-between">
                                <div className="inline-flex gap-2">
                                    <button
                                        onClick={() => onApprove(p.id)}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                                        title="Approve product"
                                    >
                                        <PackageCheck size={16} /> Approve
                                    </button>

                                    <button
                                        onClick={() => onInspect(p)}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5"
                                        title="Go to Manage and open this item"
                                    >
                                        <Search size={16} /> Inspect
                                    </button>
                                </div>

                                <button
                                    onClick={() => onReject(p.id)}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                                    title="Reject product"
                                >
                                    <PackageX size={16} /> Reject
                                </button>
                            </div>
                        </div>

                        {/* Basic details */}
                        <div className="px-3 pb-3">
                            <div className="font-medium truncate">{p.title || 'Untitled product'}</div>
                            <div className="text-xs text-zinc-500">
                                {p.sku ? `SKU: ${p.sku}` : ''}
                                {p.sku && p.price != null ? ' • ' : ''}
                                {p.price != null ? `₦${Number(p.price || 0).toLocaleString()}` : ''}
                            </div>
                        </div>
                    </div>
                ))}

                {!productsQ.isLoading && (productsQ.data ?? []).length === 0 && (
                    <div className="col-span-full text-center text-zinc-500 py-8">
                        Nothing to review right now.
                    </div>
                )}
            </div>
        </>
    );
}


/* ---------------- ManageProducts with full attribute support + images + suppliers ---------------- */
function ManageProducts({
    role,
    token,
    search,
    setSearch,
    focusId,
    onFocusedConsumed,
}: {
    role: string;
    token?: string | null;
    search: string;
    setSearch: (s: string) => void;
    focusId: string | null;
    onFocusedConsumed: () => void;
}) {

    const { openModal } = useModal();
    const isSuper = role === 'SUPER_ADMIN';
    const isAdmin = role === 'ADMIN';
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const qc = useQueryClient();

    // local input for smooth typing
    const [searchInput, setSearchInput] = React.useState(search);
    React.useEffect(() => setSearchInput(search), [search]);


    const debouncedSearch = useDebounced(searchInput, 350);

    // only notify parent when debounced value changes
    React.useEffect(() => {
        if (debouncedSearch !== search) setSearch(debouncedSearch);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch]);


    const listQ = useQuery<AdminProduct[]>({
        queryKey: ['admin', 'products', 'manage', { q: debouncedSearch }],
        enabled: !!token,
        queryFn: async () => {
            const { data } = await api.get('/api/admin/products', {
                headers: { Authorization: `Bearer ${token}` },
                params: { status: 'ANY', q: debouncedSearch, take: 50, skip: 0 },
            });
            const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
            return arr ?? [];
        },
        staleTime: 30_000,
        gcTime: 300_000,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData, // v5 way to keep previous rows
    });

    // v5: handle errors via state
    useEffect(() => {
        if (listQ.isError) {
            const e: any = listQ.error;
            console.error(
                'Products list failed:',
                e?.response?.status,
                e?.response?.data || e?.message
            );
        }
    }, [listQ.isError, listQ.error]);


    const rows = listQ.data ?? [];

    // add this near your other mutations
    const updateStatusM = useMutation({
        mutationFn: async ({ id, status }: { id: string; status: 'PUBLISHED' | 'PENDING' }) => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            const attempts: Array<{ method: 'put' | 'patch'; url: string; body: any }> = [
                { method: 'put', url: `/api/admin/products/${id}`, body: { status } },
                { method: 'patch', url: `/api/admin/products/${id}`, body: { status } },
                { method: 'put', url: `/api/products/${id}?admin=1`, body: { status } },
                { method: 'patch', url: `/api/products/${id}?admin=1`, body: { status } },
            ];
            let lastErr: any;
            for (const a of attempts) {
                try {
                    return a.method === 'put'
                        ? (await api.put(a.url, a.body, { headers: hdr })).data
                        : (await api.patch(a.url, a.body, { headers: hdr })).data;
                } catch (e) { lastErr = e; }
            }
            throw lastErr;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'products', 'manage'] });
            qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
        },
        onError: (e: any) => {
            openModal({ title: 'Products', message: e?.response?.data?.error || e?.message || 'Status update failed' });
        },
    });

    /* ---------- lookups for creation & editing ---------- */
    /* ---------- lookups for creation & editing (resilient) ---------- */
    const catsQ = useQuery<AdminCategory[]>({
        queryKey: ['admin', 'products', 'cats'],
        enabled: !!token, // only fetch when we have a token
        refetchOnWindowFocus: false,
        staleTime: 60_000,
        queryFn: async () => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            // Try admin route first, then public fallbacks; normalize shapes
            const tryAll = async (): Promise<AdminCategory[]> => {
                const attempts = [
                    '/api/admin/categories',
                    '/api/categories',
                    '/api/catalog/categories',
                ];
                for (const url of attempts) {
                    try {
                        const { data } = await api.get(url, { headers: hdr });
                        const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
                        if (Array.isArray(arr)) return arr;
                    } catch { }
                }
                return [];
            };
            return await tryAll();
        },
    });

    const brandsQ = useQuery<AdminBrand[]>({
        queryKey: ['admin', 'products', 'brands'],
        enabled: !!token,
        refetchOnWindowFocus: false,
        staleTime: 60_000,
        queryFn: async () => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            const attempts = ['/api/admin/brands', '/api/brands'];
            for (const url of attempts) {
                try {
                    const { data } = await api.get(url, { headers: hdr });
                    const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
                    if (Array.isArray(arr)) return arr;
                } catch { }
            }
            return [];
        },
    });

    const suppliersQ = useQuery<AdminSupplier[]>({
        queryKey: ['admin', 'products', 'suppliers'],
        enabled: !!token,
        refetchOnWindowFocus: false,
        staleTime: 60_000,
        queryFn: async () => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            const attempts = ['/api/admin/suppliers', '/api/suppliers'];
            for (const url of attempts) {
                try {
                    const { data } = await api.get(url, { headers: hdr });
                    const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
                    if (Array.isArray(arr)) return arr;
                } catch { }
            }
            return [];
        },
    });

    const attrsQ = useQuery<AdminAttribute[]>({
        queryKey: ['admin', 'products', 'attributes'],
        enabled: !!token,
        refetchOnWindowFocus: false,
        staleTime: 60_000,
        queryFn: async () => {
            const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;
            const attempts = ['/api/admin/attributes', '/api/attributes'];
            for (const url of attempts) {
                try {
                    const { data } = await api.get(url, { headers: hdr });
                    const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
                    if (Array.isArray(arr)) return arr;
                } catch { }
            }
            return [];
        },
    });

    /* ---------- mutations ---------- */
    const createM = useMutation({
        mutationFn: async (payload: any) =>
            (await api.post('/api/admin/products', payload, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })).data,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'products', 'manage'] }),
    });

    const updateM = useMutation({
        mutationFn: async ({ id, ...payload }: any) =>
            (await api.put(`/api/admin/products/${id}`, payload, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })).data,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'products', 'manage'] }),
    });

    const deleteM = useMutation({
        mutationFn: async (id: string) =>
            (await api.delete(`/api/admin/products/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })).data,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'products', 'manage'] }),
    });

    /* ---------- creation form state ---------- */
    const [pending, setPending] = useState({
        title: '',
        price: '',
        status: 'PENDING',
        categoryId: '',
        brandId: '',
        supplierId: '',
        sku: '',
        inStock: true,
        vatFlag: true,
        imageUrls: '',
    });

    const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string | string[]>>({});
    const [files, setFiles] = useState<File[]>([]);


    function parseUrlList(s: string) {
        return s.split(/[\n,]/g).map(t => t.trim()).filter(Boolean);
    }
    function isUrlish(s?: string) {
        return !!s && /^(https?:\/\/|data:image\/|\/)/i.test(s);
    }
    function toArray(x: any): any[] { return Array.isArray(x) ? x : x == null ? [] : [x]; }
    function extractImageUrls(p: any): string[] {
        if (Array.isArray(p?.imagesJson)) return p.imagesJson.filter(isUrlish);
        if (typeof p?.imagesJson === 'string') {
            try { const arr = JSON.parse(p.imagesJson); if (Array.isArray(arr)) return arr.filter(isUrlish); } catch { }
            return p.imagesJson.split(/[\n,]/g).map((t: string) => t.trim()).filter(isUrlish);
        }
        const cands = [
            ...(toArray(p?.imageUrls) as string[]),
            ...(toArray(p?.images) as string[]),
            p?.image, p?.primaryImage, p?.coverUrl,
        ].filter(Boolean);
        return cands.filter(isUrlish);
    }



    async function uploadLocalFiles(): Promise<string[]> {
        if (!files.length) return [];
        const fd = new FormData();
        files.forEach((f) => fd.append('files', f));
        try {
            setUploading(true);
            const res = await api.post(UPLOAD_ENDPOINT, fd, {
                headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    'Content-Type': 'multipart/form-data',
                },
            });
            const urls: string[] = (res as any)?.data?.urls || (Array.isArray((res as any)?.data) ? (res as any).data : []);
            return Array.isArray(urls) ? urls : [];
        } finally {
            setUploading(false);
        }
    }

    // attribute helpers (creation)
    function setAttrSelect(attributeId: string, valueId: string) {
        setSelectedAttrs((prev) => ({ ...prev, [attributeId]: valueId }));
    }
    function setAttrMulti(attributeId: string, e: React.ChangeEvent<HTMLSelectElement>) {
        const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
        setSelectedAttrs((prev) => ({ ...prev, [attributeId]: opts }));
    }
    function setAttrText(attributeId: string, text: string) {
        setSelectedAttrs((prev) => ({ ...prev, [attributeId]: text }));
    }

    /* ---------- variant builder (two selectable select-type attributes) ---------- */
    const selectableAttrs = (attrsQ.data || []).filter((a) => a.type === 'SELECT' && a.isActive);
    const [variantAttrIds, setVariantAttrIds] = useState<string[]>([]);
    const [variantValueIds, setVariantValueIds] = useState<Record<string, string[]>>({});
    type VariantRow = {
        key: string;
        combo: Array<{ attributeId: string; valueId: string }>;
        skuSuffix: string;
        priceBump: string;
        inStock: boolean;
    };
    const [variantRows, setVariantRows] = useState<VariantRow[]>([]);

    function toggleVariantAttr(attrId: string) {
        setVariantAttrIds((prev) => {
            const has = prev.includes(attrId);
            let next = has ? prev.filter((id) => id !== attrId) : [...prev, attrId];
            if (next.length > 2) next = next.slice(-2);
            const keep = new Set(next);
            setVariantValueIds((curr) => {
                const copy: Record<string, string[]> = {};
                Object.entries(curr).forEach(([k, v]) => {
                    if (keep.has(k)) copy[k] = v;
                });
                return copy;
            });
            return next;
        });
    }
    function setVariantValues(attrId: string, vals: string[]) {
        setVariantValueIds((prev) => ({ ...prev, [attrId]: vals }));
    }

    useEffect(() => {
        function cartesian<T>(arrays: T[][]): T[][] {
            if (arrays.length === 0) return [];
            return arrays.reduce<T[][]>((acc, curr) => {
                if (acc.length === 0) return curr.map((x) => [x]);
                const out: T[][] = [];
                for (const a of acc) for (const c of curr) out.push([...a, c]);
                return out;
            }, []);
        }

        const chosen = variantAttrIds
            .map((attrId) => {
                const a = selectableAttrs.find((x) => x.id === attrId);
                const values = (a?.values || []).filter((v) => (variantValueIds[attrId] || []).includes(v.id));
                return { attrId, values };
            })
            .filter((x) => x.values.length > 0);

        if (chosen.length === 0) {
            setVariantRows([]);
            return;
        }

        const valueSets = chosen.map((c) => c.values.map((v) => ({ attributeId: c.attrId, valueId: v.id, label: v.name })));
        const combos = cartesian(valueSets);

        setVariantRows((prevRows) =>
            combos.map((combo) => {
                const suffix = combo
                    .map((c) => {
                        const a = selectableAttrs.find((x) => x.id === c.attributeId);
                        const v = a?.values?.find((vv) => vv.id === c.valueId);
                        const code = v?.code || v?.name || '';
                        return code.toString().toUpperCase().replace(/\s+/g, '');
                    })
                    .join('-');

                const key = combo.map((c) => `${c.attributeId}:${c.valueId}`).join('|');
                const prev = prevRows.find((r) => r.key === key);

                return {
                    key,
                    combo: combo.map(({ attributeId, valueId }) => ({ attributeId, valueId })),
                    skuSuffix: prev?.skuSuffix || suffix,
                    priceBump: prev?.priceBump || '',
                    inStock: prev?.inStock ?? true,
                };
            })
        );
    }, [variantAttrIds, variantValueIds, attrsQ.data]);

    const defaultPending = { title: '', price: '', status: 'PENDING', categoryId: '', brandId: '', supplierId: '', sku: '', inStock: true, vatFlag: true, imageUrls: '' };


    const [editingId, setEditingId] = useState<string | null>(null);

    function populateCreateFormFromProduct(p: any) {
        setEditingId(p.id);
        setPending({
            title: p.title || '',
            price: String(p.price ?? ''),
            // accept LIVE from older records, but display PUBLISHED
            status: /^(LIVE|PUBLISHED)$/i.test(p.status) ? 'PUBLISHED' : 'PENDING',
            categoryId: p.categoryId || '',
            brandId: p.brandId || '',
            supplierId: p.supplierId || '',
            sku: p.sku || '',
            inStock: !!p.inStock,
            vatFlag: p.vatFlag !== false,
            imageUrls: (extractImageUrls(p) || []).join('\n'),
        });
        setFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }




    /* ---------- creation submit ---------- */

    const saveOrCreate = async () => {
        const payload: any = {
            title: pending.title.trim(),
            price: Number(pending.price) || 0,
            status: pending.status,
            sku: pending.sku.trim() || undefined,
            inStock: !!pending.inStock,
            vatFlag: !!pending.vatFlag,
        };

        // Make sure required fields are set
        if (!payload.title) return;
        if (pending.categoryId) payload.categoryId = pending.categoryId;
        if (pending.brandId) payload.brandId = pending.brandId;
        if (pending.supplierId) payload.supplierId = pending.supplierId;

        // Images: combine URLs from textarea and newly uploaded local files
        const urlList = parseUrlList(pending.imageUrls);
        const uploaded = await uploadLocalFiles();
        const imagesJson = [...urlList, ...uploaded];
        if (imagesJson.length) payload.imagesJson = imagesJson;

        // Handle attributes, variants, etc.
        const attributeSelections: any[] = [];
        (attrsQ.data || []).forEach((a) => {
            if (variantAttrIds.includes(a.id)) return;
            const sel = selectedAttrs[a.id];
            if (sel == null || (Array.isArray(sel) && sel.length === 0) || (typeof sel === 'string' && sel.trim() === '')) return;
            if (a.type === 'SELECT') attributeSelections.push({ attributeId: a.id, valueId: sel as string });
            else if (a.type === 'MULTISELECT') attributeSelections.push({ attributeId: a.id, valueIds: sel as string[] });
            else if (a.type === 'TEXT') attributeSelections.push({ attributeId: a.id, text: sel as string });
        });

        if (attributeSelections.length) payload.attributeSelections = attributeSelections;

        // Handle variants
        if (variantRows.length > 0) {
            const base = Number(pending.price) || 0;
            payload.variants = variantRows.map((r) => {
                const bump = Number(r.priceBump);
                const v: any = {
                    sku: [pending.sku?.trim(), r.skuSuffix].filter(Boolean).join('-'),
                    inStock: r.inStock,
                    options: r.combo.map((c) => ({ attributeId: c.attributeId, valueId: c.valueId })),
                };
                if (Number.isFinite(bump) && bump !== 0) v.price = Math.max(0, base + bump);
                return v;
            });
        }

        // Reset form function
        const resetForm = () => {
            setEditingId(null);
            setPending(defaultPending);
            setSelectedAttrs({});
            setFiles([]);
            if (fileInputRef.current) fileInputRef.current.value = '';
            setVariantAttrIds([]);
            setVariantValueIds({});
            setVariantRows([]);
        };

        // Submit either create or update
        if (editingId) {
            updateM.mutate(
                { id: editingId, ...payload },
                {
                    onSuccess: () => {
                        qc.invalidateQueries({ queryKey: ['admin', 'products', 'manage'] });
                        qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
                        resetForm();
                    },
                    onError: (error) => {
                        console.error("Error saving product", error);
                    }
                }
            );
        } else {
            createM.mutate(payload, {
                onSuccess: () => {
                    qc.invalidateQueries({ queryKey: ['admin', 'products', 'manage'] });
                    qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
                    resetForm();
                },
                onError: (error) => {
                    console.error("Error creating product", error);
                }
            });
        }
    };


    /* ---------- EDITING EXISTING (inline row editor) ---------- */
    type EditPending = {
        id: string;
        title: string;
        price: string;
        categoryId: string;
        brandId: string;
        supplierId?: string;
        sku?: string;
        inStock: boolean;
        vatFlag?: boolean;
        status?: string;
    };
    const [openEditorId, setOpenEditorId] = useState<string | null>(null);
    const [editPendings, setEditPendings] = useState<Record<string, EditPending>>({});
    const [editImages, setEditImages] = useState<Record<string, string[]>>({});


    function startEdit(p: any) {
        populateCreateFormFromProduct(p);
    }

    function changeEdit(pId: string, patch: Partial<EditPending>) {
        setEditPendings((prev) => ({ ...prev, [pId]: { ...(prev[pId] || { id: pId } as any), ...patch } as EditPending }));
    }

    function cancelEdit() {
        setOpenEditorId(null);
    }

    function submitEdit(pId: string, intent: 'save' | 'submitForReview' | 'approvePublished' | 'movePending') {
        const d = editPendings[pId];
        if (!d) return;
        const base: any = {
            title: d.title.trim(),
            price: Number(d.price) || 0,
            categoryId: d.categoryId || null,
            brandId: d.brandId || null,
            supplierId: d.supplierId || null,
            sku: (d.sku || '').trim() || undefined,
            inStock: !!d.inStock,
            vatFlag: d.vatFlag !== false,
        };
        if (editImages[pId]) {
            base.imagesJson = editImages[pId];
        }
        if (intent === 'submitForReview') {
            base.status = 'PENDING';
        } else if (intent === 'approvePublished') {
            base.status = 'PUBLISHED';
        } else if (intent === 'movePending') {
            base.status = 'PENDING';
        } else if (isSuper && d.status) {
            base.status = d.status;
        }

        updateM.mutate(
            { id: pId, ...base },
            {
                onSuccess: () => {
                    setOpenEditorId(null);
                },
            }
        );
    }

    /* ---------- LIST: all products (any status) ---------- */
    // v5: import keepPreviousData
    // import { useQuery, keepPreviousData } from '@tanstack/react-query';

    // v4: remove the placeholderData line and instead use: keepPreviousData: true

    useEffect(() => {
        if (!focusId || !rows?.length) return;
        const target = rows.find((r: any) => r.id === focusId);
        if (!target) return;

        populateCreateFormFromProduct(target);
        onFocusedConsumed();

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusId, rows]);

    const filePreviews = React.useMemo(() => {
        const urls = files.map((f) => ({ f, url: URL.createObjectURL(f) }));
        return urls;


        // (React will clean up on unmount, but you can also revoke on image load)
    }, [files]);
    const urlPreviews = React.useMemo(() => parseUrlList(pending.imageUrls), [pending.imageUrls]);

    return (
        <div className="space-y-3">

            {editingId && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
                    Editing: <span className="font-semibold">{(pending.title || '').trim() || 'Untitled product'}</span>
                    <span className="ml-2 text-xs text-amber-700/80">(ID: <span className="font-mono">{editingId}</span>)</span>
                </div>
            )}

            {/* quick add form */}
            <div id="create-form" className="grid gap-2">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input className="border rounded-lg px-3 py-2" placeholder="Title" value={pending.title} onChange={(e) => setPending((d) => ({ ...d, title: e.target.value }))} />
                    <input className="border rounded-lg px-3 py-2" placeholder="Price" inputMode="decimal" value={pending.price} onChange={(e) => setPending((d) => ({ ...d, price: e.target.value }))} />
                    <input className="border rounded-lg px-3 py-2" placeholder="Base SKU (optional)" value={pending.sku} onChange={(e) => setPending((d) => ({ ...d, sku: e.target.value }))} />
                    <select className="border rounded-lg px-3 py-2" value={pending.status} onChange={(e) => setPending((d) => ({ ...d, status: e.target.value }))}>
                        <option value="PUBLISHED">PUBLISHED</option>
                        <option value="PENDING">PENDING</option>
                    </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <select className="border rounded-lg px-3 py-2" value={pending.categoryId} onChange={(e) => setPending((d) => ({ ...d, categoryId: e.target.value }))}>
                        <option value="">{catsQ.isLoading ? 'Loading…' : '— Category —'}</option>
                        {catsQ.data?.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>

                    <select className="border rounded-lg px-3 py-2" value={pending.brandId} onChange={(e) => setPending((d) => ({ ...d, brandId: e.target.value }))}>
                        <option value="">— Brand —</option>
                        {brandsQ.data?.map((b) => (
                            <option key={b.id} value={b.id}>
                                {b.name}
                            </option>
                        ))}
                    </select>
                    <select className="border rounded-lg px-3 py-2" value={pending.supplierId} onChange={(e) => setPending((d) => ({ ...d, supplierId: e.target.value }))}>
                        <option value="">— Supplier —</option>
                        {suppliersQ.data?.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.name}
                            </option>
                        ))}
                    </select>
                    <label className="flex items-center gap-2 border rounded-lg px-3 py-2">
                        <input type="checkbox" checked={pending.inStock} onChange={(e) => setPending((d) => ({ ...d, inStock: e.target.checked }))} />
                        <span className="text-sm">In Stock</span>
                    </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 border rounded-lg px-3 py-2">
                        <input type="checkbox" checked={pending.vatFlag} onChange={(e) => setPending((d) => ({ ...d, vatFlag: e.target.checked }))} />
                        <span className="text-sm">Charge VAT</span>
                    </label>
                </div>

                {/* images for create */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="border rounded-lg p-3 bg-white">
                        <div className="text-xs text-zinc-500 mb-1">Image URLs (comma or new line)</div>
                        <textarea className="border rounded-lg px-3 py-2 w-full h-[74px]" placeholder="https://example.com/1.jpg, https://example.com/2.png" value={pending.imageUrls} onChange={(e) => setPending((d) => ({ ...d, imageUrls: e.target.value }))} />
                    </div>

                    {/* under the URL textarea */}
                    {urlPreviews.length > 0 && (
                        <div className="mt-2">
                            <div className="text-xs text-zinc-500 mb-1">Preview of URL images</div>
                            <div className="grid grid-cols-6 gap-1">
                                {urlPreviews.map((src, i) => (
                                    <div key={`urlprev-${i}`} className="relative w-full pt-[100%] bg-zinc-100 overflow-hidden rounded">
                                        <img
                                            src={src}
                                            alt={`url ${i + 1}`}
                                            className="absolute inset-0 w-full h-full object-cover"
                                            loading="lazy"
                                            onError={(e) => ((e.currentTarget.parentElement as HTMLElement).style.display = 'none')}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="border rounded-lg p-3 bg-white">
                        <div className="text-xs text-zinc-500 mb-2">Upload images from your computer</div>
                        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer bg-zinc-50 hover:bg-zinc-100">
                            <ImageIcon size={16} />
                            <span className="text-sm">Add images…</span>
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                    const picked = Array.from(e.target.files || []);
                                    if (picked.length === 0) return;

                                    // append + de-dupe
                                    setFiles((prev) => {
                                        const next = [...prev, ...picked];
                                        const seen = new Set<string>();
                                        const deduped: File[] = [];
                                        for (const f of next) {
                                            const key = `${f.name}-${f.size}-${(f as any).lastModified || ''}`;
                                            if (!seen.has(key)) {
                                                seen.add(key);
                                                deduped.push(f);
                                            }
                                        }
                                        return deduped;
                                    });

                                    // allow selecting the same file name again later
                                    if (fileInputRef.current) fileInputRef.current.value = '';
                                }}
                            />
                        </label>

                        {/* small list of chosen files with remove buttons */}
                        {files.length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs">
                                {files.map((f, idx) => (
                                    <li key={`${f.name}-${f.size}-${(f as any).lastModified || idx}`} className="flex items-center justify-between">
                                        <span className="truncate">{f.name} — {(f.size / 1024).toFixed(1)} KB</span>
                                        <button
                                            type="button"
                                            className="ml-3 px-2 py-0.5 rounded border"
                                            onClick={() =>
                                                setFiles((prev) => prev.filter((_, i) => i !== idx))
                                            }
                                            aria-label="Remove file"
                                            title="Remove"
                                        >
                                            ×
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {filePreviews.length > 0 && (
                            <div className="mt-2">
                                <div className="text-xs text-zinc-500 mb-1">Selected file previews</div>
                                <div className="grid grid-cols-6 gap-1">
                                    {filePreviews.map(({ url, f }, idx) => (
                                        <div key={`${f.name}-${f.size}-${(f as any).lastModified || idx}`} className="relative w-full pt-[100%] bg-zinc-100 overflow-hidden rounded">
                                            <img
                                                src={url}
                                                alt={f.name}
                                                className="absolute inset-0 w-full h-full object-cover"
                                                onLoad={() => URL.revokeObjectURL(url)}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}


                    </div>
                </div>

                {/* non-variant attributes for create */}

                {attrsQ.data != null && (
                    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
                        {attrsQ.data?.map((a) => {
                            if (variantAttrIds.includes(a.id)) return null;
                            if (a.type === 'SELECT')
                                return (
                                    <div key={a.id} className="border rounded-lg p-2 bg-white">
                                        <div className="text-xs text-zinc-500 mb-1">{a.name} (select)</div>
                                        <select className="w-full border rounded-md px-2 py-2" value={(selectedAttrs[a.id] as string) || ''} onChange={(e) => setAttrSelect(a.id, e.target.value)}>
                                            <option value="">— Select {a.name} —</option>
                                            {(a.values || []).map((v) => (
                                                <option key={v.id} value={v.id}>
                                                    {v.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                );
                            if (a.type === 'MULTISELECT') {
                                const current = (selectedAttrs[a.id] as string[]) || [];
                                return (
                                    <div key={a.id} className="border rounded-lg p-2 bg-white">
                                        <div className="text-xs text-zinc-500 mb-1">{a.name} (multi)</div>
                                        <select multiple className="w-full border rounded-md px-2 py-2 h-[96px]" value={current} onChange={(e) => setAttrMulti(a.id, e)}>
                                            {(a.values || []).map((v) => (
                                                <option key={v.id} value={v.id}>
                                                    {v.name}
                                                </option>
                                            ))}
                                        </select>
                                        <div className="text-[11px] text-zinc-500 mt-1">Tip: Hold Ctrl/Cmd to multi-select</div>
                                    </div>
                                );
                            }
                            return (
                                <div key={a.id} className="border rounded-lg p-2 bg-white">
                                    <div className="text-xs text-zinc-500 mb-1">{a.name} (text)</div>
                                    <input className="w-full border rounded-md px-2 py-2" placeholder={`Enter ${a.name}`} value={(selectedAttrs[a.id] as string) || ''} onChange={(e) => setAttrText(a.id, e.target.value)} />
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Variant builder toggles */}
                {selectableAttrs.length > 0 && (
                    <div className="border rounded-lg p-3 bg-white">
                        <div className="font-medium mb-2">Variants (choose up to 2 attributes)</div>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {selectableAttrs.map((a) => {
                                const active = variantAttrIds.includes(a.id);
                                return (
                                    <button key={a.id} type="button" onClick={() => toggleVariantAttr(a.id)} className={`px-2 py-1 rounded border ${active ? 'bg-zinc-900 text-white' : 'bg-white'}`}>
                                        {a.name}
                                    </button>
                                );
                            })}
                        </div>
                        {variantAttrIds.map((attrId) => {
                            const a = selectableAttrs.find((x) => x.id === attrId);
                            if (!a) return null;
                            const vals = a.values || [];
                            const chosen = variantValueIds[attrId] || [];
                            return (
                                <div key={attrId} className="mb-2">
                                    <div className="text-xs text-zinc-500 mb-1">Values for {a.name}</div>
                                    <select multiple className="w-full border rounded-md px-2 py-2 h-[96px]" value={chosen} onChange={(e) => setVariantValues(attrId, Array.from(e.target.selectedOptions).map((o) => o.value))}>
                                        {vals.map((v) => (
                                            <option key={v.id} value={v.id}>
                                                {v.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            );
                        })}
                        {variantRows.length > 0 && (
                            <div className="mt-3">
                                <div className="text-xs text-zinc-500 mb-2">Generated combinations</div>
                                <div className="border rounded-lg overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="bg-zinc-50">
                                            <tr>
                                                <th className="text-left px-3 py-2">SKU Suffix</th>
                                                <th className="text-left px-3 py-2">Price bump</th>
                                                <th className="text-left px-3 py-2">In Stock</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {variantRows.map((r) => (
                                                <tr key={r.key}>
                                                    <td className="px-3 py-2">{r.skuSuffix}</td>
                                                    <td className="px-3 py-2">
                                                        <input className="border rounded px-2 py-1 w-28" placeholder="+0" value={r.priceBump} onChange={(e) => setVariantRows((rows) => rows.map((x) => (x.key === r.key ? { ...x, priceBump: e.target.value } : x)))} />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <label className="inline-flex items-center gap-2">
                                                            <input type="checkbox" checked={r.inStock} onChange={(e) => setVariantRows((rows) => rows.map((x) => (x.key === r.key ? { ...x, inStock: e.target.checked } : x)))} />
                                                            <span className="text-xs">In Stock</span>
                                                        </label>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
            {/* create button */}
            <div className="flex gap-2 items-center">
                <button
                    onClick={saveOrCreate}
                    className="px-3 py-2 rounded-xl bg-emerald-600 text-white disabled:opacity-60"
                    disabled={uploading}
                    title={uploading ? 'Uploading images…' : (editingId ? 'Save changes' : 'Create product')}
                >
                    {uploading ? 'Uploading…' : (editingId ? 'Save Changes' : 'Add Product')}
                </button>

                {editingId && (
                    <button
                        onClick={() => {
                            setEditingId(null);
                            setPending(defaultPending);
                            setSelectedAttrs({});
                            setFiles([]);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                            setVariantAttrIds([]);
                            setVariantValueIds({});
                            setVariantRows([]);
                        }}
                        className="px-3 py-2 rounded-xl border"
                        title="Cancel edit"
                    >
                        Cancel Edit
                    </button>
                )}

                <button
                    onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'products'] })}
                    className="px-3 py-2 rounded-xl bg-blue-500 text-white disabled:opacity-60"
                >
                    Reload Data
                </button>
            </div>
            {/* search */}
            <div className="flex gap-2 items-center">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search title, sku…" className="pl-9 pr-3 py-2 rounded-xl border bg-white w-full" />

                </div>
            </div>

            {/* product list with inline editors */}
            <div className="border rounded-xl overflow-auto">
                <table className="w-full text-sm">
                    <thead className="bg-zinc-50">
                        <tr>
                            <th className="text-left px-3 py-2">Title</th>
                            <th className="text-left px-3 py-2">Price</th>
                            <th className="text-left px-3 py-2">Status</th>
                            {isSuper && <th className="text-left px-3 py-2">Owner</th>}
                            <th className="text-right px-3 py-2">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {listQ.isLoading && (
                            <tr>
                                <td className="px-3 py-3" colSpan={isSuper ? 5 : 4}>
                                    Loading products…
                                </td>
                            </tr>
                        )}

                        {!listQ.isLoading &&
                            rows.map((p: any) => {
                                const open = openEditorId === p.id;
                                const d = editPendings[p.id];

                                return (
                                    <React.Fragment key={p.id}>
                                        <tr>
                                            <td className="px-3 py-2">{p.title}</td>
                                            <td className="px-3 py-2">{ngn.format(fmtN(p.price))}</td>
                                            <td className="px-3 py-2">
                                                <StatusDot label={p.status} />
                                            </td>
                                            {isSuper && <td className="px-3 py-2">{p.ownerEmail || '—'}</td>}
                                            <td className="px-3 py-2 text-right">
                                                <div className="inline-flex gap-2">
                                                    <button onClick={() => startEdit(p)} className="px-2 py-1 rounded border">
                                                        Edit in form
                                                    </button>

                                                    {/* Admin flow */}
                                                    {isAdmin && (
                                                        <button onClick={() => updateStatusM.mutate({ id: p.id, status: 'PENDING' })} className="px-2 py-1 rounded bg-amber-600 text-white">
                                                            Submit for Review
                                                        </button>
                                                    )}

                                                    {/* Super Admin controls */}
                                                    {isSuper && (
                                                        <>
                                                            {p.status === 'PENDING' ? (
                                                                <button onClick={() => updateStatusM.mutate({ id: p.id, status: 'PUBLISHED' })} className="px-2 py-1 rounded bg-emerald-600 text-white">
                                                                    Approve PUBLISHED
                                                                </button>
                                                            )
                                                                :
                                                                (
                                                                    <button onClick={() => updateStatusM.mutate({ id: p.id, status: 'PENDING' })} className="px-2 py-1 rounded border">
                                                                        Move to PENDING
                                                                    </button>
                                                                )
                                                            }
                                                        </>
                                                    )}

                                                    <button onClick={() => deleteM.mutate(p.id)} className="px-2 py-1 rounded bg-rose-600 text-white">
                                                        Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>

                                        {open && (
                                            <tr id={`prod-editor-${p.id}`} className="bg-zinc-50/50">
                                                <td colSpan={isSuper ? 5 : 4} className="px-3 py-3">
                                                    <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                                                        <input className="border rounded-lg px-3 py-2 md:col-span-2" placeholder="Title" value={d?.title || ''} onChange={(e) => changeEdit(p.id, { title: e.target.value })} />
                                                        <input className="border rounded-lg px-3 py-2" placeholder="Price" inputMode="decimal" value={d?.price || ''} onChange={(e) => changeEdit(p.id, { price: e.target.value })} />
                                                        <input className="border rounded-lg px-3 py-2" placeholder="SKU" value={d?.sku || ''} onChange={(e) => changeEdit(p.id, { sku: e.target.value })} />


                                                        <select className="border rounded-lg px-3 py-2" value={d?.categoryId || ''} onChange={(e) => changeEdit(p.id, { categoryId: e.target.value })}>
                                                            <option value="">— Category —</option>
                                                            {catsQ.data?.map((c) => (
                                                                <option key={c.id} value={c.id}>
                                                                    {c.name}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <select className="border rounded-lg px-3 py-2" value={d?.brandId || ''} onChange={(e) => changeEdit(p.id, { brandId: e.target.value })}>
                                                            <option value="">— Brand —</option>
                                                            {brandsQ.data?.map((b) => (
                                                                <option key={b.id} value={b.id}>
                                                                    {b.name}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <select className="border rounded-lg px-3 py-2" value={d?.supplierId || ''} onChange={(e) => changeEdit(p.id, { supplierId: e.target.value })}>
                                                            <option value="">— Supplier —</option>
                                                            {suppliersQ.data?.map((s) => (
                                                                <option key={s.id} value={s.id}>
                                                                    {s.name}
                                                                </option>
                                                            ))}
                                                        </select>

                                                        <label className="flex items-center gap-2 border rounded-lg px-3 py-2">
                                                            <input type="checkbox" checked={!!d?.inStock} onChange={(e) => changeEdit(p.id, { inStock: e.target.checked })} />
                                                            <span className="text-sm">In Stock</span>
                                                        </label>

                                                        {isSuper && (
                                                            <select className="border rounded-lg px-3 py-2" value={d?.status || 'PENDING'} onChange={(e) => changeEdit(p.id, { status: e.target.value })}>
                                                                <option value="PENDING">PENDING</option>
                                                                <option value="PUBLISHED">PUBLISHED</option>
                                                            </select>
                                                        )}

                                                        {/* Images: preview + editable URLs */}
                                                        <div className="md:col-span-6 border rounded-lg p-3 bg-white">
                                                            <div className="text-sm font-medium mb-2">Images</div>
                                                            <div className="grid grid-cols-6 gap-1 mb-2">
                                                                {(editImages[p.id] || []).map((src, i) => (
                                                                    <div key={`${p.id}-img-${i}`} className="relative w-full pt-[100%] bg-zinc-100 overflow-hidden rounded">
                                                                        <img src={src}
                                                                            alt={`image ${i + 1}`}
                                                                            className="absolute inset-0 w-full h-full object-cover"
                                                                            onError={(e) => ((e.currentTarget.parentElement as HTMLElement).style.display = 'none')} />
                                                                    </div>
                                                                ))}
                                                                {(editImages[p.id] || []).length === 0 && (
                                                                    <div className="col-span-6 h-20 grid place-items-center text-xs text-zinc-500 bg-zinc-50 rounded">
                                                                        No images
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <textarea className="w-full border rounded-lg px-3 py-2 text-xs"
                                                                placeholder="Paste image URLs separated by comma or newline"
                                                                value={(editImages[p.id] || []).join('\n')}
                                                                onChange={(e) => {
                                                                    const list = e.target.value
                                                                        .split(/[\n,]/g)
                                                                        .map((t) => t.trim())
                                                                        .filter(isUrlish);
                                                                    setEditImages((prev) => ({ ...prev, [p.id]: list }));
                                                                }}
                                                            />
                                                            <div className="text-[11px] text-zinc-500 mt-1">Tip: broken links are hidden automatically.</div>
                                                        </div>
                                                        <div className="md:col-span-6 flex items-center justify-end gap-2">
                                                            <button onClick={cancelEdit} className="px-3 py-2 rounded-lg border">
                                                                Cancel
                                                            </button>
                                                            <button onClick={() => submitEdit(p.id, 'save')} className="px-3 py-2 rounded-lg bg-zinc-900 text-white">
                                                                Save Changes
                                                            </button>
                                                            {isAdmin && (
                                                                <button onClick={() => submitEdit(p.id, 'submitForReview')} className="px-3 py-2 rounded-lg bg-amber-600 text-white" title="Set status to PENDING for approval">
                                                                    Submit for Review
                                                                </button>
                                                            )}
                                                            {isSuper && (
                                                                <>
                                                                    <button onClick={() => submitEdit(p.id, 'approvePublished')} className="px-3 py-2 rounded-lg bg-emerald-600 text-white">
                                                                        Approve PUBLISHED
                                                                    </button>
                                                                    <button onClick={() => submitEdit(p.id, 'movePending')} className="px-3 py-2 rounded-lg border">
                                                                        Move to PENDING
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}

                        {!listQ.isLoading && rows.length === 0 && (
                            <tr>
                                <td colSpan={isSuper ? 5 : 4} className="px-3 py-4 text-center text-zinc-500">
                                    No products
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
