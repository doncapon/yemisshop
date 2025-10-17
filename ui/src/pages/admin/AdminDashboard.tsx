// src/pages/AdminDashboard.tsx
import { useEffect, useMemo, useState} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
    ShieldCheck,
    Users,
    UserCheck,
    UserX,
    PackageCheck,
    PackageX,
    CreditCard,
    RefreshCcw,
    Settings,
    BellRing,
    Percent,
    BarChart3,
    Search,
    Download,
    Check,
    X,
    Loader2,
} from 'lucide-react';

import api from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { useToast } from '../../components/ToastProvider';
import { useModal } from '../../components/ModalProvider';

/* ---------------- Types ---------------- */
type Me = {
    id: string;
    role: string; // "ADMIN" | "SUPER_ADMIN"| etc.
    email: string;
    firstName?: string | null;
    lastName?: string | null;
};

type Overview = {
    totalUsers: number;
    totalSuperUsers: number;
    totalCustomers: number;

    productsPending: number;
    productsLive: number;

    ordersToday: number;
    revenueToday: number;

    sparklineRevenue7d?: number[]; // optional tiny chart
};

type AdminUser = {
    id: string;
    email: string;
    role: string;
    status: 'PENDING' | 'PARTIAL' | 'VERIFIED' | string;
    createdAt?: string;
};

type AdminProduct = {
    id: string;
    title: string;
    price: number | string;
    status: string; // PUBLISHED | PENDING_REVIEW | REJECTED
    imagesJson?: string[];
    createdAt?: string;
};

type AdminPayment = {
    id: string;
    orderId: string;
    userEmail?: string | null;
    amount: number | string;
    status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUNDED' | string;
    provider?: string | null;
    channel?: string | null;
    createdAt?: string;
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
        month: 'short', day: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

/* ---------------- Tiny inline sparkline ---------------- */
function Sparkline({ points = [] as number[] }) {
    if (!points.length) return null;
    const max = Math.max(...points);
    const min = Math.min(...points);
    const norm = (v: number) => {
        if (max === min) return 8; // flat
        return 20 - ((v - min) / (max - min)) * 20; // invert y (SVG)
    };
    const step = 100 / Math.max(1, points.length - 1);
    const d = points
        .map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step},${norm(v)}`)
        .join(' ');

    return (
        <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-10">
            <path d={d} fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-600" />
        </svg>
    );
}

/* ---------------- Tabs ---------------- */
type TabKey = 'overview' | 'users' | 'products' | 'transactions' | 'ops' | 'marketing' | 'analytics';

/* ---------------- Component ---------------- */
export default function AdminDashboard() {
    const { token } = useAuthStore();
    const nav = useNavigate();
    const toast = useToast();
    const { openModal } = useModal();
    const qc = useQueryClient();

    // Role-gate
    const me = useQuery({
        queryKey: ['me'],
        enabled: !!token,
        queryFn: async () => (await api.get<Me>('/api/profile/me', { headers: token ? { Authorization: `Bearer ${token}` } : undefined })).data,
    });

    useEffect(() => {
        if (!token) {
            nav('/login', { replace: true, state: { from: { pathname: '/admin' } } });
            return;
        }
    }, [token, nav]);

    const role = me.data?.role ?? '';
    const canAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(role);

    useEffect(() => {
        if (me.isFetched && !canAdmin) {
            // Non-admins are bounced
            nav('/', { replace: true });
        }
    }, [me.isFetched, canAdmin, nav]);

    const [tab, setTab] = useState<TabKey>('overview');
    const [q, setQ] = useState('');

    /* -------- Overview -------- */
    const overview = useQuery({
        queryKey: ['admin', 'overview'],
        enabled: !!canAdmin,
        queryFn: async () => (await api.get<Overview>('/api/admin/overview', { headers: { Authorization: `Bearer ${token}` } })).data,
        staleTime: 30_000,
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
    });

    const approveSuperUser = useMutation({
        mutationFn: async (userId: string) =>
            (await api.post(`/api/admin/users/${userId}/approve-super`, {}, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'users'] });
            toast.push({ title: 'Users', message: 'Super User approved.', duration: 2500 });
        },
        onError: () => openModal({ title: 'Users', message: 'Could not approve Super User.' }),
    });

    const deactivateUser = useMutation({
        mutationFn: async (userId: string) =>
            (await api.post(`/api/admin/users/${userId}/deactivate`, {}, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'users'] });
            toast.push({ title: 'Users', message: 'User deactivated.', duration: 2500 });
        },
        onError: () => openModal({ title: 'Users', message: 'Could not deactivate user.' }),
    });

    /* -------- Products (moderation) -------- */
    const productsPendingQ = useQuery({
        queryKey: ['admin', 'products', 'pending', q],
        enabled: !!canAdmin && tab === 'products',
        queryFn: async () => {
            const { data } = await api.get<{ data: AdminProduct[] }>(`/api/admin/products/pending?q=${encodeURIComponent(q)}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            return data?.data ?? [];
        },
    });

    const approveProduct = useMutation({
        mutationFn: async (productId: string) =>
            (await api.post(`/api/admin/products/${productId}/approve`, {}, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'products', 'pending'] });
            qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
            toast.push({ title: 'Products', message: 'Product approved.', duration: 2500 });
        },
        onError: () => openModal({ title: 'Products', message: 'Could not approve product.' }),
    });

    const rejectProduct = useMutation({
        mutationFn: async (productId: string) =>
            (await api.post(`/api/admin/products/${productId}/reject`, {}, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'products', 'pending'] });
            toast.push({ title: 'Products', message: 'Product rejected.', duration: 2500 });
        },
        onError: () => openModal({ title: 'Products', message: 'Could not reject product.' }),
    });

    /* -------- Transactions -------- */
    const txQ = useQuery({
        queryKey: ['admin', 'payments', q],
        enabled: !!canAdmin && tab === 'transactions',
        queryFn: async () => {
            const { data } = await api.get<{ data: AdminPayment[] }>(`/api/admin/payments?q=${encodeURIComponent(q)}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            return data?.data ?? [];
        },
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

    /* -------- Ops & Security (snapshot) -------- */
    const opsQ = useQuery({
        queryKey: ['admin', 'ops'],
        enabled: !!canAdmin && tab === 'ops',
        queryFn: async () => {
            const { data } = await api.get('/api/admin/ops/snapshot', { headers: { Authorization: `Bearer ${token}` } });
            return data || {};
        },
    });

    /* -------- Marketing -------- */
    const [announcement, setAnnouncement] = useState('');
    const sendAnnouncement = useMutation({
        mutationFn: async () =>
            (await api.post('/api/admin/marketing/announce', { message: announcement }, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            setAnnouncement('');
            toast.push({ title: 'Marketing', message: 'Announcement sent.', duration: 2500 });
        },
        onError: () => openModal({ title: 'Marketing', message: 'Failed to send announcement.' }),
    });

    const [coupon, setCoupon] = useState({ code: '', pct: 10, maxUses: 100 });
    const createCoupon = useMutation({
        mutationFn: async () =>
            (await api.post('/api/admin/marketing/coupons', coupon, { headers: { Authorization: `Bearer ${token}` } })).data,
        onSuccess: () => {
            setCoupon({ code: '', pct: 10, maxUses: 100 });
            toast.push({ title: 'Marketing', message: 'Discount code created.', duration: 2500 });
        },
        onError: () => openModal({ title: 'Marketing', message: 'Failed to create coupon.' }),
    });

    /* -------- Analytics & Export -------- */
    const downloadReport = async () => {
        try {
            const res = await api.get('/api/admin/analytics/export', {
                headers: { Authorization: `Bearer ${token}` },
                responseType: 'blob',
            });
            const url = URL.createObjectURL(res.data);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'analytics-report.csv';
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            openModal({ title: 'Analytics', message: 'Failed to download report.' });
        }
    };

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

    function SectionCard({ title, subtitle, children, right }: any) {
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

    /* ---------------- Render ---------------- */
    return (
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6">
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
                                {role.toUpperCase() === "ADMIN"? "Admin Dashboard": "Super Admin Dashboard"}
                            </motion.h1>
                            <p className="text-white/80 text-sm mt-1">
                                Full control & oversight — users, products, transactions, operations, marketing, and analytics.
                            </p>
                        </div>
                        <div className="hidden md:flex items-center gap-2">
                            <Link
                                to="/"
                                className="inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 px-3 py-2 text-sm"
                            >
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
                    hint={`${overview.data?.totalSuperUsers ?? 0} Super Users • ${overview.data?.totalCustomers ?? 0} Customers`}
                    Icon={Users}
                />
                <KpiCard
                    title="Products"
                    value={`${overview.data?.productsLive ?? 0} Live`}
                    hint={`${overview.data?.productsPending ?? 0} pending review`}
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
            </div>

            {/* Tabs */}
            <div className="mt-6 flex flex-wrap items-center gap-2">
                <TabButton k="overview" label="Overview" Icon={ShieldCheck} />
                <TabButton k="users" label="Users & Roles" Icon={UserCheck} />
                <TabButton k="products" label="Product Moderation" Icon={PackageCheck} />
                <TabButton k="transactions" label="Transactions" Icon={CreditCard} />
                <TabButton k="ops" label="Ops & Security" Icon={Settings} />
                <TabButton k="marketing" label="Marketing" Icon={BellRing} />
                <TabButton k="analytics" label="Analytics" Icon={BarChart3} />
            </div>

            {/* Content */}
            <div className="mt-4 space-y-6">
                {/* -------- Overview quick panes -------- */}
                {tab === 'overview' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <SectionCard title="Quick Actions" subtitle="Common admin tasks at a glance">
                            <div className="grid sm:grid-cols-2 gap-3">
                                <QuickAction
                                    toAction={() => setTab('users')}
                                    icon={UserCheck}
                                    label="Approve Super Users"
                                    desc="Review & approve applicants"
                                />
                                <QuickAction
                                    toAction={() => setTab('products')}
                                    icon={PackageCheck}
                                    label="Moderate Products"
                                    desc="Approve or reject submissions"
                                />
                                <QuickAction
                                    toAction={() => setTab('transactions')}
                                    icon={CreditCard}
                                    label="Verify Payments"
                                    desc="Handle verifications & refunds"
                                />
                                <QuickAction
                                    toAction={() => setTab('marketing')}
                                    icon={BellRing}
                                    label="Send Announcement"
                                    desc="Notify users of updates"
                                />
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
                                    <span className="font-semibold">
                                        {/* if you surface such count in overview, show it; else placeholder */}
                                        —
                                    </span>
                                </li>
                                <li className="flex items-center justify-between border rounded-xl px-3 py-2">
                                    <span className="text-ink">Unusual activity alerts</span>
                                    <span className="font-semibold">—</span>
                                </li>
                            </ul>
                        </SectionCard>
                    </div>
                )}

                {/* -------- Users & Roles -------- */}
                {tab === 'users' && (
                    <>
                        <SectionCard
                            title="Users & Roles"
                            subtitle="Create, approve, deactivate; manage privileges"
                            right={
                                <div className="relative">
                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                                    <input
                                        value={q}
                                        onChange={(e) => setQ(e.target.value)}
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
                                    </tbody>
                                </table>
                            </div>
                        </SectionCard>
                    </>
                )}

                {/* -------- Product Moderation -------- */}
                {tab === 'products' && (
                    <SectionCard
                        title="Product Moderation"
                        subtitle="Review & approve items uploaded by Super Users"
                        right={
                            <div className="relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                                <input
                                    value={q}
                                    onChange={(e) => setQ(e.target.value)}
                                    placeholder="Search by title…"
                                    className="pl-9 pr-3 py-2 rounded-xl border bg-white"
                                />
                            </div>
                        }
                    >
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {productsPendingQ.isLoading && Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="rounded-2xl border bg-white p-4 animate-pulse">
                                    <div className="h-36 bg-zinc-200 rounded-xl" />
                                    <div className="h-4 w-2/3 bg-zinc-200 rounded mt-3" />
                                    <div className="h-3 w-1/2 bg-zinc-200 rounded mt-2" />
                                </div>
                            ))}

                            {!productsPendingQ.isLoading && (productsPendingQ.data ?? []).length === 0 && (
                                <div className="col-span-full text-center text-zinc-500 py-8">
                                    Nothing to review right now.
                                </div>
                            )}
                            
                            
                            {(productsPendingQ.data ?? []).map((p: AdminProduct) => (
                                <div key={p.id} className="rounded-2xl border bg-white overflow-hidden shadow-sm">
                                    {p.imagesJson?.[0] ? (
                                        <img src={p.imagesJson[0]} alt={p.title} className="w-full h-40 object-cover" />
                                    ) : (
                                        <div className="w-full h-40 grid place-items-center text-zinc-400">No image</div>
                                    )}
                                    <div className="p-4">
                                        <div className="font-semibold text-ink line-clamp-1">{p.title}</div>
                                        <div className="text-sm text-ink-soft mt-1">{ngn.format(fmtN(p.price))}</div>
                                        <div className="text-xs mt-1">Submitted: {fmtDate(p.createdAt)}</div>
                                        <div className="mt-3 flex items-center justify-between">
                                            <button
                                                onClick={() => approveProduct.mutate(p.id)}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                                            >
                                                <PackageCheck size={16} /> Approve
                                            </button>
                                            <button
                                                onClick={() => rejectProduct.mutate(p.id)}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                                            >
                                                <PackageX size={16} /> Reject
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </SectionCard>
                )}

                {/* -------- Transactions -------- */}
                {tab === 'transactions' && (
                    <SectionCard
                        title="Transactions"
                        subtitle="Verify payments, process refunds, view history"
                        right={
                            <div className="flex items-center gap-2">
                                <div className="relative">
                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                                    <input
                                        value={q}
                                        onChange={(e) => setQ(e.target.value)}
                                        placeholder="Search by order or email…"
                                        className="pl-9 pr-3 py-2 rounded-xl border bg-white"
                                    />
                                </div>
                                <button
                                    onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'payments'] })}
                                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-black/5"
                                >
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
                                        <th className="text-left px-3 py-2">Amount</th>
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
                                    {!txQ.isLoading && (txQ.data ?? []).length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                                                No transactions found.
                                            </td>
                                        </tr>
                                    )}
                                    {(txQ.data ?? []).map((t: AdminPayment) => (
                                        <tr key={t.id} className="hover:bg-black/5">
                                            <td className="px-3 py-3 font-mono">{t.id}</td>
                                            <td className="px-3 py-3">
                                                <Link to={`/orders?open=${t.orderId}`} className="text-primary-700 underline">
                                                    {t.orderId}
                                                </Link>
                                            </td>
                                            <td className="px-3 py-3">{t.userEmail || '—'}</td>
                                            <td className="px-3 py-3">{ngn.format(fmtN(t.amount))}</td>
                                            <td className="px-3 py-3">
                                                <StatusDot label={t.status} />
                                            </td>
                                            <td className="px-3 py-3">{fmtDate(t.createdAt)}</td>
                                            <td className="px-3 py-3 text-right">
                                                <div className="inline-flex items-center gap-2">
                                                    <button
                                                        onClick={() => verifyPayment.mutate(t.id)}
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                                                        disabled={t.status === 'PAID'}
                                                        title={t.status === 'PAID' ? 'Already verified' : 'Verify payment'}
                                                    >
                                                        <Check size={16} /> Verify
                                                    </button>
                                                    <button
                                                        onClick={() => refundPayment.mutate(t.id)}
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                                                    >
                                                        <CreditCard size={16} /> Refund
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </SectionCard>
                )}

                {/* -------- Ops & Security -------- */}
                {tab === 'ops' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <SectionCard title="Platform Configuration" subtitle="Gateways, shipping, backups">
                            {opsQ.isLoading ? (
                                <div className="text-sm text-ink-soft">Loading config…</div>
                            ) : (
                                <ul className="space-y-3 text-sm">
                                    <li className="flex items-center justify-between border rounded-xl px-3 py-2">
                                        <span>Payment Gateway</span>
                                        <span className="font-medium">{opsQ.data?.paymentProvider || 'PAYSTACK'}</span>
                                    </li>
                                    <li className="flex items-center justify-between border rounded-xl px-3 py-2">
                                        <span>Default Shipping Rate</span>
                                        <span className="font-medium">{opsQ.data?.shippingRate ?? '—'}</span>
                                    </li>
                                    <li className="flex items-center justify-between border rounded-xl px-3 py-2">
                                        <span>Backups</span>
                                        <span className="font-medium">{opsQ.data?.backupsEnabled ? 'Enabled' : 'Disabled'}</span>
                                    </li>
                                </ul>
                            )}
                            <div className="mt-4 flex items-center gap-2">
                                <button className="px-3 py-2 rounded-xl border bg-white hover:bg-black/5 inline-flex items-center gap-2">
                                    <Settings size={16} /> Edit Settings
                                </button>
                                <button className="px-3 py-2 rounded-xl border bg-white hover:bg-black/5 inline-flex items-center gap-2">
                                    <ShieldCheck size={16} /> Run Security Audit
                                </button>
                            </div>
                        </SectionCard>

                        <SectionCard title="Recent Security Events" subtitle="User activity logs & anomaly detection">
                            {opsQ.isLoading ? (
                                <div className="text-sm text-ink-soft">Loading logs…</div>
                            ) : (
                                <div className="space-y-2 text-sm">
                                    {(opsQ.data?.securityEvents ?? []).slice(0, 8).map((e: any, i: number) => (
                                        <div key={i} className="border rounded-xl px-3 py-2 flex items-center justify-between">
                                            <div className="min-w-0">
                                                <div className="font-medium truncate">{e.message || 'Event'}</div>
                                                <div className="text-xs text-ink-soft">{fmtDate(e.createdAt)}</div>
                                            </div>
                                            <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                                                {e.level || 'INFO'}
                                            </span>
                                        </div>
                                    ))}
                                    {(opsQ.data?.securityEvents ?? []).length === 0 && (
                                        <div className="text-ink-soft">No events.</div>
                                    )}
                                </div>
                            )}
                        </SectionCard>
                    </div>
                )}

                {/* -------- Marketing -------- */}
                {tab === 'marketing' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <SectionCard title="Send Announcement" subtitle="Email all users or a segment">
                            <textarea
                                value={announcement}
                                onChange={(e) => setAnnouncement(e.target.value)}
                                rows={6}
                                placeholder="Type your announcement…"
                                className="w-full border rounded-xl p-3"
                            />
                            <div className="mt-3 flex items-center gap-2">
                                <button
                                    onClick={() => sendAnnouncement.mutate()}
                                    disabled={!announcement.trim() || sendAnnouncement.isPending}
                                    className="inline-flex items-center gap-2 rounded-xl bg-primary-600 text-white px-4 py-2 hover:bg-primary-700 disabled:opacity-50"
                                >
                                    {sendAnnouncement.isPending ? <Loader2 size={16} className="animate-spin" /> : <BellRing size={16} />}
                                    Send
                                </button>
                                <span className="text-xs text-ink-soft">Sends to all users by default (adjust on backend as needed)</span>
                            </div>
                        </SectionCard>

                        <SectionCard title="Create Discount Code" subtitle="Approve and manage campaigns">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                    <label className="block text-xs text-ink-soft mb-1">Code</label>
                                    <input
                                        value={coupon.code}
                                        onChange={(e) => setCoupon((c) => ({ ...c, code: e.target.value.toUpperCase() }))}
                                        placeholder="SAVE10"
                                        className="w-full border rounded-xl px-3 py-2"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-ink-soft mb-1">Percent</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={90}
                                        value={coupon.pct}
                                        onChange={(e) => setCoupon((c) => ({ ...c, pct: Math.max(1, Math.min(90, Number(e.target.value) || 10)) }))}
                                        className="w-full border rounded-xl px-3 py-2"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-ink-soft mb-1">Max Uses</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={coupon.maxUses}
                                        onChange={(e) => setCoupon((c) => ({ ...c, maxUses: Math.max(1, Number(e.target.value) || 100) }))}
                                        className="w-full border rounded-xl px-3 py-2"
                                    />
                                </div>
                            </div>
                            <div className="mt-3">
                                <button
                                    onClick={() => createCoupon.mutate()}
                                    disabled={!coupon.code.trim() || createCoupon.isPending}
                                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-50"
                                >
                                    {createCoupon.isPending ? <Loader2 size={16} className="animate-spin" /> : <Percent size={16} />}
                                    Create Code
                                </button>
                            </div>
                        </SectionCard>
                    </div>
                )}

                {/* -------- Analytics -------- */}
                {tab === 'analytics' && (
                    <SectionCard
                        title="Analytics & Reporting"
                        subtitle="Engagement, revenue and performance"
                        right={
                            <button
                                onClick={downloadReport}
                                className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 hover:bg-black/5"
                            >
                                <Download size={16} /> Export CSV
                            </button>
                        }
                    >
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            <AnalyticTile label="DAU (7d avg)" value="—" />
                            <AnalyticTile label="Orders / User" value="—" />
                            <AnalyticTile label="AOV (₦)" value="—" />
                            <AnalyticTile label="Refund Rate" value="—" />
                            <AnalyticTile label="Conversion %" value="—" />
                            <AnalyticTile label="Churn %" value="—" />
                        </div>
                        <p className="text-xs text-ink-soft mt-3">Hook up the metrics above to your analytics endpoint.</p>
                    </SectionCard>
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
    chart?: React.ReactNode;
}) {
    return (
        <div className="rounded-2xl border bg-white shadow-sm p-4">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-xs text-ink-soft">{title}</div>
                    <div className="text-xl font-semibold text-ink mt-0.5">{value}</div>
                    {!!hint && <div className="text-xs text-ink-soft mt-1">{hint}</div>}
                </div>
                <span className="inline-grid place-items-center w-10 h-10 rounded-xl bg-primary-50 text-primary-700">
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
            : s === 'PENDING'
                ? 'bg-amber-500/10 text-amber-700 border-amber-600/20'
                : s === 'FAILED' || s === 'CANCELED' || s === 'REJECTED'
                    ? 'bg-rose-500/10 text-rose-700 border-rose-600/20'
                    : 'bg-zinc-500/10 text-zinc-700 border-zinc-600/20';
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${cls}`}>{label}</span>;
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
                <span className="inline-grid place-items-center w-10 h-10 rounded-xl bg-primary-50 text-primary-700">
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

function AnalyticTile({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border bg-white p-4">
            <div className="text-xs text-ink-soft">{label}</div>
            <div className="text-lg font-semibold text-ink mt-1">{value}</div>
        </div>
    );
}
