// src/pages/AdminDashboard.tsx
import { useEffect, useRef, useState, useCallback, type ReactNode, type JSX } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
    Check,
    ChevronDown,
    ChevronRight,
} from 'lucide-react';

import React from 'react';

import api from '../../api/client.js';
import { useAuthStore } from '../../store/auth.js';
import { useToast } from '../../components/ToastProvider.js';
import { useModal } from '../../components/ModalProvider.js';
import ActivitiesPanel from '../../components/admin/ActivitiesPanel.js';

import { useMemo } from 'react';
import { VariantsSection } from '../../components/admin/VariantSection.js';
import { AttributeForm } from '../../components/admin/AttributeForm.js';
import AdminProductAttributes from '../../components/admin/AdminProductAttributes.js';
import { ModerationGrid } from '../../components/admin/ModerationGrid.js';
import { ManageProducts } from '../../components/admin/ManageProducts.js';


/** ===== tweak this if your backend upload route differs ===== */
/** =========================================================== */
const staleTImeInSecs = 300_000;

/* ---------------- Types ---------------- */
type Me = {
    id: string;
    role: 'ADMIN' | 'SUPER_ADMIN' | string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
};
/* ---- Overview payload types (match your getOverview) ---- */
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
        published: number;         // approval state
        live: number;              // published & available (variant-aware) & active offers
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
    supplierOffers: SupplierOfferLite[],
    ownerEmail?: string | null;
    categoryId?: string | null;
    brandId?: string | null;
    supplierId?: string | null;
    sku?: string | null;
    inStock?: boolean;
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
    const [pTab, setPTab] = useState<ProductsInnerTab>('manage');

    // NEW state at the top alongside other useStates
    const [prodSearch, setProdSearch] = useState('');
    const [focusProductId, setFocusProductId] = useState<string | null>(null);

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

    const [tab, setTab] = useState<TabKey>('overview');
    const [q, setQ] = useState('');

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
            (await api.get<{ data: AdminCategory[] }>('/api/admin/categories', { headers: { Authorization: `Bearer ${token}` } })).data
                .data,
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
            (await api.get<{ data: AdminAttribute[] }>('/api/admin/attributes', { headers: { Authorization: `Bearer ${token}` } }))
                .data.data,
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

    // CREATE value (already optimistic — keep your onMutate)
    // CREATE value (optimistic)
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
                a.values = (a.values || []).map((v: any) =>
                    v.id.startsWith('tmp-') && v.name === vars.name ? created : v
                );
                const next = [...prev];
                next[idx] = a;
                return next;
            });
            toast.push({ title: 'Attributes', message: 'Value added.', duration: 1800 });
        },
    });

    // UPDATE value
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

    // DELETE value
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
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${emphasis ? 'bg-emerald-600 text-white border-emerald-600 hover:opacity-90' : 'bg-white hover:bg-black/5'
                    }`}
                title={label}
            >
                <span className="font-medium">{value.toLocaleString()}</span>
                <span className="text-ink-soft">•</span>
                <span>{label}</span>
            </button>
        );
    }


    /** --------- LOCALIZED Users section (Fix B) --------- */
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

    // Navigate to Products → Manage. If you later add real filters there

    const navigate = useNavigate();
    function normalizePreset(view?: string) {
        if (!view) return undefined;
        // accept both wordings
        if (view === 'published-with-any') return 'published-with-offer';
        return view;
    }

    function goProductsManage(view?: string) {
        setTab('products');
        setPTab('manage');
        const v = normalizePreset(view);
        navigate({
            pathname: '/admin/products',                 // 👈 ABSOLUTE, not relative
            search: v ? `?view=${encodeURIComponent(v)}` : ''
        });
    }

    const goProductsModeration = () => {
        setTab('products');
        setPTab('moderation');
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
        | 'published'         // general status-only
        | 'pending'
        | 'rejected';

    // preset <-> URL sync
    const [searchParams, setSearchParams] = useSearchParams();
    const urlPreset = (searchParams.get('view') as FilterPreset) || 'all';
    const [preset, setPreset] = useState<FilterPreset>(urlPreset);

    useEffect(() => {
        setPreset((searchParams.get('view') as FilterPreset) || 'all');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams.toString()]);

    function setPresetAndUrl(next: FilterPreset) {
        setPreset(next);
        const sp = new URLSearchParams(searchParams);
        if (next && next !== 'all') sp.set('view', next);
        else sp.delete('view');
        setSearchParams(sp, { replace: true });
    }

     function statusFromPreset(p: FilterPreset): 'ANY' | 'PUBLISHED' | 'PENDING' | 'REJECTED' {
        if (p.startsWith('published')) return 'PUBLISHED';
        if (p === 'published') return 'PUBLISHED';
        if (p === 'pending') return 'PENDING';
        if (p === 'rejected') return 'REJECTED';
        return 'ANY';
    }

    type SortKey = 'title' | 'price' | 'avail' | 'stock' | 'status' | 'owner';
    type SortDir = 'asc' | 'desc';
    // ✅ single source of truth for sorting
    const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'title', dir: 'asc' });
    const toggleSort = (key: SortKey) =>
        setSort(prev => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

    const SortIndicator = ({ k }: { k: SortKey }) => {
        if (sort.key !== k) return <span className="opacity-50">↕</span>;
        return <span>{sort.dir === 'asc' ? '↑' : '↓'}</span>;
    };

    const statusParam = statusFromPreset(preset);

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
        staleTime: staleTImeInSecs,
    });

    /* -------- Suppliers (Catalog) -------- */
    const suppliersQ = useQuery({
        queryKey: ['admin', 'suppliers'],
        enabled: !!canAdmin && tab === 'catalog',
        queryFn: async () =>
            (await api.get<{ data: AdminSupplier[] }>('/api/admin/suppliers', { headers: { Authorization: `Bearer ${token}` } })).data
                .data,
        refetchOnWindowFocus: false,
        staleTime: staleTImeInSecs,
    });

    //local input for smooth typing
    const [searchInput, setSearchInput] = React.useState(prodSearch);
    React.useEffect(() => setSearchInput(prodSearch), [prodSearch]);
    const debouncedSearch = useDebounced(searchInput, 350);

    const listQ = useQuery<AdminProduct[]>({
        queryKey: ['admin', 'products', 'manage', { q: debouncedSearch, statusParam }],
        enabled: !!token,
        queryFn: async () => {
            const { data } = await api.get('/api/admin/products', {
                headers: { Authorization: `Bearer ${token}` },
                params: { status: statusParam, q: debouncedSearch, take: 50, skip: 0, include: 'owner' },
            });
            const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
            return arr ?? [];
        },
        staleTime: staleTImeInSecs,
        gcTime: 300_000,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData,
    });



    useEffect(() => {
        if (listQ.isError) {
            const e: any = listQ.error;
            console.error('Products list failed:', e?.response?.status, e?.response?.data || e?.message);
        }
    }, [listQ.isError, listQ.error]);


    useEffect(() => {
        if (listQ.isError) {
            const e: any = listQ.error;
            console.error('Products list failed:', e?.response?.status, e?.response?.data || e?.message);
        }
    }, [listQ.isError, listQ.error]);

    const rows = listQ.data ?? [];



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
                    // show Published + Live prominently (your chosen meaning)
                    value={`${overview.data?.products.published ?? 0} Published • ${overview.data?.products.live ?? 0} Live`}
                    hint={`${overview.data?.products.pending ?? 0} Pending • ${overview.data?.products.rejected ?? 0} Rejected`}
                    // extra line: quick availability snapshot (variant-aware published)
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

                {/* NEW: Profit (only for SUPER_ADMIN) */}
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
                {/* -------- Users (localized Fix B) -------- */}
                {tab === 'users' && <UsersSection token={token} canAdmin={canAdmin} />}

                {tab === 'analytics' && <ActivitiesPanel />}

                {tab === 'overview' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Left column: Quick Actions, etc. Keep your existing left cards */}
                        <SectionCard title="Quick Actions" subtitle="Common admin tasks at a glance">
                            <div className="grid sm:grid-cols-2 gap-3">
                                <QuickAction toAction={() => setTab('users')} icon={UserCheck} label="Approve Super Users" desc="Review & approve applicants" />
                                <QuickAction toAction={() => setTab('products')} icon={PackageCheck} label="Moderate Products" desc="Approve or reject submissions" />
                                <QuickAction toAction={() => setTab('transactions')} icon={CreditCard} label="Verify Payments" desc="Handle verifications & refunds" />
                                <QuickAction toAction={() => setTab('marketing')} icon={BellRing} label="Send Announcement" desc="Notify users of updates" />
                            </div>
                        </SectionCard>

                        {/* Right column: Attention */}
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

                        {/* NEW: Products snapshot (full breakdown, clickable chips) */}
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
                                            onClick={() => goProductsManage("published")}
                                        />
                                        <StatChip
                                            label="Live"
                                            value={overview.data?.products.live ?? 0}
                                            onClick={() => explain(
                                                'Live products',
                                                'Published AND (base inStock OR any variant inStock) AND has at least one active, in-stock supplier offer.'
                                            )}
                                            emphasis
                                        />
                                        <StatChip
                                            label="Pending"
                                            value={overview.data?.products.pending ?? 0}
                                            onClick={() => goProductsModeration()}
                                        />
                                        <StatChip
                                            label="Rejected"
                                            value={overview.data?.products.rejected ?? 0}
                                            onClick={() => explain('Rejected', 'Products that failed moderation. You can re-enable after fixes.')}
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
                                            onClick={() => explain(
                                                'Available (all statuses)',
                                                'Products (any status) where base inStock=true OR at least one variant is inStock.'
                                            )}
                                        />
                                        <StatChip
                                            label="Published available"
                                            value={overview.data?.products.availability.publishedAvailable ?? 0}
                                            onClick={() => explain(
                                                'Published available',
                                                'Published products that are available (base or variant).'
                                            )}
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
                                            onClick={() => explain('Any offer', 'Products with at least one product-wide or variant-level offer.')}
                                        />
                                        <StatChip
                                            label="Without any"
                                            value={overview.data?.products.offers.withoutAny ?? 0}
                                            onClick={() => goProductsManage('no-offer')}
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
                                            onClick={() => explain('Active offer', 'At least one active & in-stock offer (product-wide or variant).')}
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

                                {/* Published base stock (quick split) */}
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

    const [editingSupplier, setEditingSupplier] = useState<AdminSupplier | null>(null);

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
            <div className="rounded-2xl border bg-white shadow-sm overflow-visible">
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

    // --- focus/anchor guards (stop global hotkeys + # anchors) ---
    const stopHashNav = (evt: React.SyntheticEvent) => {
        const el = (evt.target as HTMLElement)?.closest?.('a[href="#"],a[href=""]');
        if (el) {
            evt.preventDefault();
            evt.stopPropagation();
        }
    };
    const stopKeyBubblingFromInputs = (e: React.KeyboardEvent) => {
        const t = e.target as HTMLElement;
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            e.stopPropagation(); // don’t let globals grab it
        }
    };

    // --- isolated, memoized mini-adder: prevents remount/focus loss ---
    const AttributeValueAdder = React.memo(function AttributeValueAdder({
        attributeId,
        onCreate,
    }: {
        attributeId: string;
        onCreate: (vars: { attributeId: string; name: string; code?: string }) => void;
    }) {
        const [name, setName] = useState('');
        const [code, setCode] = useState('');

        const submit = () => {
            const n = name.trim();
            if (!n) return;
            onCreate({ attributeId, name: n, code: code.trim() || undefined });
            setName('');
            setCode('');
        };

        return (
            <div
                role="form"
                className="grid grid-cols-3 gap-2"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    // let typing flow; only capture Enter and stop bubbling of all keys
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        submit();
                    }
                }}
            >
                <input
                    type="text"
                    autoComplete="off"
                    placeholder="Value name"
                    className="border rounded-lg px-3 py-2 col-span-2"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
                <input
                    type="text"
                    autoComplete="off"
                    placeholder="Code (optional)"
                    className="border rounded-lg px-3 py-2"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                />
                <div className="col-span-3 justify-self-end">
                    <button type="button" onClick={submit} className="px-3 py-2 rounded-lg bg-emerald-600 text-white">
                        Add value
                    </button>
                </div>
            </div>
        );
    });

    return (
        <div
            className="grid grid-cols-1 xl:grid-cols-3 gap-6"
            onClickCapture={stopHashNav}
            onMouseDownCapture={stopHashNav}
            onKeyDownCapture={stopKeyBubblingFromInputs}
        >
            {/* Categories */}
            <SectionCard
                title="Categories"
                subtitle="Organize your catalog hierarchy"
                right={
                    <button
                        type="button"
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
                {canEdit && (
                    <CategoryForm categories={categoriesQ.data ?? []} onCreate={(payload) => createCategory.mutate(payload)} />
                )}

                <div className="border rounded-xl overflow-x-auto">
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
                                        <td className="px-3 py-2">
                                            {(categoriesQ.data ?? []).find((x: AdminCategory) => x.id === c.parentId)?.name || '—'}
                                        </td>
                                        <td className="px-3 py-2">{used}</td>
                                        <td className="px-3 py-2 text-right">
                                            {canEdit && (
                                                <div className="inline-flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => updateCategory.mutate({ id: c.id, isActive: !c.isActive })}
                                                        className="px-2 py-1 rounded border"
                                                    >
                                                        {c.isActive ? 'Disable' : 'Enable'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => used === 0 && deleteCategory.mutate(c.id)}
                                                        className={`px-2 py-1 rounded ${used === 0 ? 'bg-rose-600 text-white' : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                                                            }`}
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
                <div className="border rounded-xl overflow-x-auto">
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
                                                    <button
                                                        type="button"
                                                        onClick={() => updateBrand.mutate({ id: b.id, isActive: !b.isActive })}
                                                        className="px-2 py-1 rounded border"
                                                    >
                                                        {b.isActive ? 'Disable' : 'Enable'}
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() => used === 0 && deleteBrand.mutate(b.id)}
                                                        className={`px-2 py-1 rounded ${used === 0 ? 'bg-rose-600 text-white' : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                                                            }`}
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
                {canEdit && (
                    <SupplierForm
                        editing={editingSupplier}
                        onCancelEdit={() => setEditingSupplier(null)}
                        onCreate={(payload) =>
                            createSupplier.mutate(payload, {
                                onSuccess: () => setEditingSupplier(null),
                            })
                        }
                        onUpdate={(payload: any) =>
                            updateSupplier.mutate(payload, {
                                onSuccess: () => setEditingSupplier(null),
                            })
                        }
                    />
                )}
                <div className="border rounded-xl overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-zinc-50">
                            <tr>
                                <th className="text-left px-3 py-2">Name</th>
                                <th className="text-left px-3 py-2">Type</th>
                                <th className="text-left px-3 py-2">Status</th>
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
                                    <td className="px-3 py-2 text-right">
                                        {canEdit && (
                                            <div className="inline-flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        updateSupplier.mutate({ id: s.id, status: s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })
                                                    }
                                                    className="px-2 py-1 rounded border"
                                                >
                                                    {s.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingSupplier(s)}
                                                    className="px-2 py-1 rounded border"
                                                    title="Edit supplier"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => deleteSupplier.mutate(s.id)}
                                                    className="px-2 py-1 rounded bg-rose-600 text-white"
                                                >
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
                                            <button
                                                type="button"
                                                onClick={() => updateAttribute.mutate({ id: a.id, isActive: !a.isActive })}
                                                className="px-2 py-1 rounded border"
                                            >
                                                {a.isActive ? 'Disable' : 'Enable'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => used === 0 && deleteAttribute.mutate(a.id)}
                                                className={`px-2 py-1 rounded ${used === 0 ? 'bg-rose-600 text-white' : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                                                    }`}
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

                                    {(a.values ?? []).length === 0 && (
                                        <div className="text-xs text-zinc-500 mb-2">No values</div>
                                    )}

                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {(a.values ?? []).map((v: { id: React.Key | null | undefined; name: string | number | bigint | boolean | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<ReactNode> | React.ReactPortal | Promise<string | number | bigint | boolean | React.ReactPortal | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<ReactNode> | null | undefined> | null | undefined; isActive: any; }) => (
                                            <div key={v.id} className="px-2 py-1 rounded border bg-white inline-flex items-center gap-2">
                                                <span className="text-sm">{v.name}</span>
                                                {canEdit && (
                                                    <>
                                                        <button
                                                            type="button"
                                                            className="text-xs underline"
                                                            onClick={() =>
                                                                updateAttrValue.mutate({ attributeId: a.id, id: v.id, isActive: !v.isActive })
                                                            }
                                                        >
                                                            {v.isActive ? 'Disable' : 'Enable'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="text-xs text-rose-600 underline"
                                                            onClick={() => deleteAttrValue.mutate({ attributeId: a.id, id: v.id })}
                                                        >
                                                            Delete
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {canEdit && (
                                        <AttributeValueAdder
                                            attributeId={a.id}
                                            onCreate={(vars) =>
                                                createAttrValue.mutate(vars, {
                                                    onSuccess: () =>
                                                        qc.invalidateQueries({ queryKey: ['admin', 'attributes'] }),
                                                })
                                            }
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {(attributesQ.data ?? []).length === 0 && (
                        <div className="text-center text-zinc-500 text-sm py-4">No attributes</div>
                    )}
                </div>

                {/* Product ↔ attributes linking UI + Variants manager row */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-6">
                    <div className="xl:col-span-3">
                        <AdminProductAttributes />
                    </div>
                </div>
            </SectionCard>

            {/* Variants Section */}
            <VariantsSection />
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

type SupplierFormValues = {
    name: string;
    type: 'PHYSICAL' | 'ONLINE';
    status?: string;
    contactEmail?: string | null;
    whatsappPhone?: string | null;

    apiBaseUrl?: string | null;
    apiAuthType?: 'NONE' | 'BEARER' | 'BASIC' | '' | null;
    apiKey?: string | null;

    payoutMethod?: 'SPLIT' | 'TRANSFER' | '' | null;
    bankCountry?: string | null;   // e.g. "NG"
    bankCode?: string | null;      // bank sort code
    bankName?: string | null;      // bank display name
    accountNumber?: string | null; // long field
    accountName?: string | null;   // long field
    isPayoutEnabled?: boolean | null;
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

type BankOption = { country: string; code: string; name: string };

const FALLBACK_BANKS: BankOption[] = [
    { country: 'NG', code: '044', name: 'Access Bank' },
    { country: 'NG', code: '011', name: 'First Bank of Nigeria' },
    { country: 'NG', code: '058', name: 'Guaranty Trust Bank' },
    { country: 'NG', code: '221', name: 'Stanbic IBTC Bank' },
    { country: 'NG', code: '232', name: 'Sterling Bank' },
    { country: 'NG', code: '033', name: 'United Bank for Africa' },
    { country: 'NG', code: '035', name: 'Wema Bank' },
];

function SupplierForm({
    editing,
    onCancelEdit,
    onCreate,
    onUpdate,
}: {
    editing: AdminSupplier | null;
    onCancelEdit: () => void;
    onCreate: (payload: SupplierFormValues) => void;
    onUpdate: (payload: SupplierFormValues & { id: string }) => void;
}) {
    const { token } = useAuthStore();

    // One source of truth for banks (uses admin list, falls back locally)
    const banksQ = useQuery({
        queryKey: ['admin', 'banks'],
        queryFn: async () => {
            const { data } = await api.get<{ data: BankOption[] }>('/api/admin/banks', {
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            });
            return Array.isArray(data?.data) && data.data.length > 0 ? data.data : FALLBACK_BANKS;
        },
        staleTime: 10 * 60 * 1000,
        retry: 1,
    });
    const banks = banksQ.data ?? FALLBACK_BANKS;

    const [values, setValues] = useState<SupplierFormValues>({
        name: '',
        type: 'PHYSICAL',
        status: 'ACTIVE',
        contactEmail: '',
        whatsappPhone: '',
        apiBaseUrl: '',
        apiAuthType: 'NONE',
        apiKey: '',

        payoutMethod: '',
        bankCountry: 'NG',
        bankCode: '',
        bankName: '',
        accountNumber: '',
        accountName: '',
        isPayoutEnabled: false,
    });

    // Hydrate when editing
    useEffect(() => {
        if (!editing) return;
        setValues({
            name: editing.name ?? '',
            type: editing.type ?? 'PHYSICAL',
            status: editing.status ?? 'ACTIVE',
            contactEmail: editing.contactEmail ?? '',
            whatsappPhone: editing.whatsappPhone ?? '',
            apiBaseUrl: editing.apiBaseUrl ?? '',
            apiAuthType: editing.apiAuthType ?? 'NONE',
            apiKey: editing.apiKey ?? '',

            payoutMethod: editing.payoutMethod ?? '',
            bankCountry: editing.bankCountry ?? 'NG',
            bankCode: editing.bankCode ?? '',
            bankName: editing.bankName ?? '',
            accountNumber: editing.accountNumber ?? '',
            accountName: editing.accountName ?? '',
            isPayoutEnabled: !!editing.isPayoutEnabled,
        });
    }, [editing]);

    // Filter banks by selected country
    const countryBanks = useMemo(
        () => banks.filter((b) => (values.bankCountry || 'NG') === b.country),
        [banks, values.bankCountry]
    );

    // Keep Bank Name <-> Bank Code in sync
    function setBankByName(name: string) {
        const match = countryBanks.find((b) => b.name === name);
        setValues((v) => ({
            ...v,
            bankName: name || '',
            bankCode: match?.code || '',
        }));
    }
    function setBankByCode(code: string) {
        const match = countryBanks.find((b) => b.code === code);
        setValues((v) => ({
            ...v,
            bankCode: code || '',
            bankName: match?.name || '',
        }));
    }

    function submit() {
        if (!values.name.trim()) {
            alert('Supplier name is required');
            return;
        }
        if (editing) onUpdate({ id: editing.id, ...values });
        else onCreate(values);
    }

    return (
        <div className="rounded-2xl border bg-white/95 p-4 md:p-6 mb-4 w-full">
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-ink font-semibold">{editing ? 'Edit Supplier' : 'Add Supplier'}</h4>
                {editing && (
                    <button className="text-sm text-zinc-600 hover:underline" onClick={onCancelEdit}>
                        Cancel edit
                    </button>
                )}
            </div>

            {/* 12-col grid; long fields span 8 on md+ */}
            <div className="grid grid-cols-12 gap-3">
                <div className="col-span-12 md:col-span-6">
                    <label className="block text-xs text-ink-soft mb-1">Name</label>
                    <input
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.name}
                        onChange={(e) => setValues({ ...values, name: e.target.value })}
                        placeholder="Supplier name"
                    />
                </div>

                <div className="col-span-6 md:col-span-3">
                    <label className="block text-xs text-ink-soft mb-1">Type</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.type}
                        onChange={(e) => setValues({ ...values, type: e.target.value as any })}
                    >
                        <option value="PHYSICAL">PHYSICAL</option>
                        <option value="ONLINE">ONLINE</option>
                    </select>
                </div>

                <div className="col-span-6 md:col-span-3">
                    <label className="block text-xs text-ink-soft mb-1">Status</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.status || 'ACTIVE'}
                        onChange={(e) => setValues({ ...values, status: e.target.value })}
                    >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="INACTIVE">INACTIVE</option>
                    </select>
                </div>

                <div className="col-span-12 md:col-span-6">
                    <label className="block text-xs text-ink-soft mb-1">Contact Email</label>
                    <input
                        type="email"
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.contactEmail ?? ''}
                        onChange={(e) => setValues({ ...values, contactEmail: e.target.value })}
                        placeholder="e.g. vendors@company.com"
                    />
                </div>

                <div className="col-span-12 md:col-span-6">
                    <label className="block text-xs text-ink-soft mb-1">WhatsApp Phone</label>
                    <input
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.whatsappPhone ?? ''}
                        onChange={(e) => setValues({ ...values, whatsappPhone: e.target.value })}
                        placeholder="+2348xxxxxxxxx"
                    />
                </div>
                {/* API credentials */}
                {values.type === 'ONLINE' &&
                    (<>
                        <div className="col-span-12 md:col-span-4">
                            <label className="block text-xs text-ink-soft mb-1">API Base URL</label>
                            <input
                                className="w-full border rounded-lg px-3 py-2"
                                value={values.apiBaseUrl ?? ''}
                                onChange={(e) => setValues({ ...values, apiBaseUrl: e.target.value })}
                                placeholder="https://api.supplier.com"
                            />
                        </div>
                        <div className="col-span-6 md:col-span-4">
                            <label className="block text-xs text-ink-soft mb-1">API Auth Type</label>
                            <select
                                className="w-full border rounded-lg px-3 py-2"
                                value={values.apiAuthType ?? 'NONE'}
                                onChange={(e) => setValues({ ...values, apiAuthType: e.target.value as any })}
                            >
                                <option value="NONE">NONE</option>
                                <option value="BEARER">BEARER</option>
                                <option value="BASIC">BASIC</option>
                            </select>
                        </div>
                        <div className="col-span-6 md:col-span-4">
                            <label className="block text-xs text-ink-soft mb-1">API Key / Token</label>
                            <input
                                className="w-full border rounded-lg px-3 py-2"
                                value={values.apiKey ?? ''}
                                onChange={(e) => setValues({ ...values, apiKey: e.target.value })}
                                placeholder="••••••••••••"
                            />
                        </div>
                    </>)
                }
                {/* Payout & Bank info */}
                <div className="col-span-6 md:col-span-4">
                    <label className="block text-xs text-ink-soft mb-1">Payout Method</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.payoutMethod ?? ''}
                        onChange={(e) => setValues({ ...values, payoutMethod: (e.target.value || '') as any })}
                    >
                        <option value="">—</option>
                        <option value="TRANSFER">TRANSFER</option>
                        <option value="SPLIT">SPLIT</option>
                    </select>
                </div>

                <div className="col-span-6 md:col-span-4">
                    <label className="block text-xs text-ink-soft mb-1">Bank Country</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.bankCountry ?? 'NG'}
                        onChange={(e) =>
                            setValues((v) => ({
                                ...v,
                                bankCountry: e.target.value || 'NG',
                                bankCode: '',
                                bankName: '',
                            }))
                        }
                    >
                        <option value="NG">Nigeria (NG)</option>
                    </select>
                </div>

                <div className="col-span-12 md:col-span-4 flex items-end">
                    <div className="text-xs text-zinc-500">
                        {banksQ.isFetching ? 'Loading banks…' : ''}
                    </div>
                </div>

                {/* Bank Name dropdown */}
                <div className="col-span-12 md:col-span-6">
                    <label className="block text-xs text-ink-soft mb-1">Bank Name</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.bankName ?? ''}
                        onChange={(e) => setBankByName(e.target.value)}
                    >
                        <option value="">Select bank…</option>
                        {countryBanks.map((b) => (
                            <option key={`${b.country}-${b.code}`} value={b.name}>
                                {b.name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Bank Code dropdown (kept in sync with name) */}
                <div className="col-span-12 md:col-span-6">
                    <label className="block text-xs text-ink-soft mb-1">Bank Code</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.bankCode ?? ''}
                        onChange={(e) => setBankByCode(e.target.value)}
                    >
                        <option value="">Select bank…</option>
                        {countryBanks.map((b) => (
                            <option key={`${b.country}-${b.code}`} value={b.code}>
                                {b.code} — {b.name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Long fields (twice wider) */}
                <div className="col-span-12 md:col-span-8">
                    <label className="block text-xs text-ink-soft mb-1">Account Number</label>
                    <input
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.accountNumber ?? ''}
                        onChange={(e) => setValues({ ...values, accountNumber: e.target.value })}
                        placeholder="0123456789"
                        inputMode="numeric"
                    />
                </div>

                <div className="col-span-12 md:col-span-8">
                    <label className="block text-xs text-ink-soft mb-1">Account Name</label>
                    <input
                        className="w-full border rounded-lg px-3 py-2"
                        value={values.accountName ?? ''}
                        onChange={(e) => setValues({ ...values, accountName: e.target.value })}
                        placeholder="e.g. ACME DISTRIBUTION LTD"
                    />
                </div>

                <div className="col-span-12 md:col-span-4 flex items-end">
                    <label className="inline-flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={!!values.isPayoutEnabled}
                            onChange={(e) => setValues({ ...values, isPayoutEnabled: e.target.checked })}
                        />
                        Enable payouts for this supplier
                    </label>
                </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 justify-end">
                {editing && (
                    <button className="px-3 py-2 rounded-lg border bg-white hover:bg-black/5" onClick={onCancelEdit}>
                        Cancel
                    </button>
                )}
                <button
                    className="px-3 py-2 rounded-lg bg-zinc-900 text-white hover:opacity-90"
                    onClick={submit}
                >
                    {editing ? 'Update Supplier' : 'Add Supplier'}
                </button>
            </div>
        </div>
    );
}


/* ---------------- Image helpers ---------------- */
function useDebounced<T>(value: T, delay = 300) {
    const [v, setV] = useState(value);
    useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
    return v;
}

function ModerationSection({ token, onInspect }: { token?: string | null; onInspect: (p: any) => void }) {
    const qc = useQueryClient();
    const [searchInput, setSearchInput] = React.useState('');
    const debounced = useDebounced(searchInput, 350);
    const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

    // fetch PUBLISHED items (unified endpoint)
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

    // approve / reject
    const approveM = useMutation({
        mutationFn: async (id: string) =>
            (await api.post(`/api/admin/products/${id}/approve`, {}, { headers: hdr })).data,
        onSuccess: () => {
            // you were missing this 👇
            qc.invalidateQueries({ queryKey: ['admin', 'products', 'pending'] });
            // keep these:
            qc.invalidateQueries({ queryKey: ['admin', 'products', 'published'] });
            qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
        },
        onError: (e) => {
            const msg =
                (e as any)?.response?.data?.error || (e as any)?.message || 'Approve failed';
            console.error('Approve failed:', msg);
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