// src/pages/UserDashboard.tsx
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { useAuthStore } from '../store/auth';
import { useModal } from "../components/ModalProvider";
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  LogOut,
  ChevronRight,
  Truck,
  ShoppingBag,
  CreditCard,
  Clock3,
  Info,
  RefreshCcw,
  MailCheck,
  Phone,
} from 'lucide-react';
import { motion } from 'framer-motion';

/* ---------------------- Types ---------------------- */
type Role = 'ADMIN' | 'SUPER_ADMIN' | 'SUPER_USER' | 'SHOPPER';

type MeResponse = {
  id: string;
  email: string;
  role: Role;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  phone?: string | null;
  joinedAt?: string | null;
  status?: 'PENDING' | 'PARTIAL' | 'VERIFIED';
  emailVerified?: boolean;
  phoneVerified?: boolean;
  dob?: string | null;

  address?: Address | null;
  shippingAddress?: Address | null;

  language?: string | null;
  theme?: 'light' | 'dark' | 'system';
  currency?: string | null;
  productInterests?: string[];
  notificationPrefs?: {
    email?: boolean;
    sms?: boolean;
    push?: boolean;
  } | null;
};

type Address = {
  houseNumber?: string | null;
  streetName?: string | null;
  postCode?: string | null;
  town?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

type OrderLite = {
  id: string;
  createdAt: string;
  status:
  | 'PENDING'
  | 'PAID'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'
  | 'PROCESSING';
  total: number;
  items: Array<{
    product: any;
    id: string;
    title: string;
    quantity: number;
    image?: string | null;
  }>;
  trackingUrl?: string | null;
};

type OrdersSummary = {
  total: number;
  byStatus: Record<string, number>;
};

type RecentTransaction = {
  orderId: string;
  createdAt: string;
  total: number;
  orderStatus: string;
  payment?: {
    id: string;
    reference: string | null;
    status: string;
    channel: string | null;
    provider: string | null;
    createdAt: string;
  };
};

type LocalCartItem = { productId: string; qty: number };

/* ---------------------- Local cart merge ---------------------- */
function mergeIntoLocalCart(items: LocalCartItem[]) {
  try {
    const key = 'cart';
    const curr: LocalCartItem[] = JSON.parse(localStorage.getItem(key) || '[]');
    const byId = new Map<string, number>();
    for (const it of curr) byId.set(it.productId, (byId.get(it.productId) || 0) + (it.qty || 0));
    for (const it of items) byId.set(it.productId, (byId.get(it.productId) || 0) + (it.qty || 0));
    const merged: LocalCartItem[] = Array.from(byId.entries()).map(([productId, qty]) => ({ productId, qty }));
    localStorage.setItem(key, JSON.stringify(merged));
  } catch {/* noop */ }
}

/* ---------------------- Utils ---------------------- */
const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});
const dateFmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');
function dateTimeFmt(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '—';
  return d.toLocaleString();
}



function sinceJoined(iso?: string | null) {
  if (!iso) return '';
  const start = new Date(iso);
  if (Number.isNaN(+start)) return '';
  const now = new Date();

  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();

  if (days < 0) {
    months -= 1;
    const prevMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    days += prevMonthDays;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (months > 0) parts.push(`${months}m`);
  if (parts.length === 0) {
    const diffDays = Math.max(1, Math.floor((now.getTime() - start.getTime()) / (24 * 3600 * 1000)));
    parts.push(`${diffDays}d`);
  }
  return parts.join(' ');
}

function initialsFrom(first?: string | null, last?: string | null, fallback?: string) {
  const a = (first || '').trim();
  const b = (last || '').trim();
  if (a || b) return `${a?.[0] ?? ''}${b?.[0] ?? ''}`.toUpperCase() || 'U';
  return (fallback?.[0] || 'U').toUpperCase();
}

/* ---------------------- Data hooks ---------------------- */
function useMe() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['me'],
    queryFn: async () =>
      (await api.get<MeResponse>('/api/auth/me', { headers: token ? { Authorization: `Bearer ${token}` } : undefined })).data,
    enabled: !!token,
  });
}

function useRecentOrders(limit = 5) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['orders', 'recent', limit],
    queryFn: async () =>
      (await api.get<OrderLite[]>(`/api/orders/mine?limit=${limit}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })).data,
    enabled: !!token,
    retry: 1,
  });
}

function useOrdersSummary() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['orders', 'summary'],
    queryFn: async (): Promise<OrdersSummary> => {
      try {
        const res = await api.get<OrdersSummary>('/api/orders/summary', { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
        if (res?.data?.total != null) return res.data;
      } catch { }
      try {
        const res = await api.get<OrderLite[]>('/api/orders/mine?limit=1000', { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
        const list = Array.isArray(res.data) ? res.data : [];
        const byStatus: Record<string, number> = {};
        for (const o of list) {
          const s = (o.status || 'UNKNOWN').toUpperCase();
          byStatus[s] = (byStatus[s] || 0) + 1;
        }
        return { total: list.length, byStatus };
      } catch {
        return { total: 0, byStatus: {} };
      }
    },
    enabled: !!token,
    staleTime: 30_000,
  });
}

function useRecentTransactions(limit = 5) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['payments', 'recent-orders', limit],
    queryFn: async () =>
      (await api.get<RecentTransaction[]>(`/api/payments/recent?limit=${limit}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })).data,
    enabled: !!token,
    retry: 1,
  });
}

/** Sum of successful payments; tries /api/payments/summary then falls back */
function useTotalSpent() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['payments', 'totalSpent'],
    queryFn: async () => {
      try {
        const r = await api.get<{ totalPaid?: number; totalPaidNgn?: number }>('/api/payments/summary', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const v = r.data?.totalPaid ?? r.data?.totalPaidNgn;
        if (typeof v === 'number' && Number.isFinite(v)) return v;
      } catch { }
      try {
        const res = await api.get<OrderLite[]>('/api/orders/mine?limit=1000', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const list = Array.isArray(res.data) ? res.data : [];
        const total = list
          .filter((o) => (o.status || '').toUpperCase() === 'PAID')
          .reduce((s, o) => s + (Number.isFinite(o.total as any) ? Number(o.total) : 0), 0);
        return total;
      } catch {
        return 0;
      }
    },
    enabled: !!token,
    staleTime: 30_000,
  });
}

function useResendEmail() {
  const token = useAuthStore((s) => s.token);
  return useMutation({
    mutationFn: async () => (await api.post('/api/auth/resend-email', {}, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })).data,
  });
}
function useResendOtp() {
  const token = useAuthStore((s) => s.token);
  return useMutation({
    mutationFn: async () => (await api.post('/api/auth/resend-otp', {}, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })).data as { nextResendAfterSec?: number },
  });
}

/* ---------------------- UI primitives ---------------------- */
function GlassCard(props: { title: string; icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`rounded-2xl border border-white/40 bg-white/70 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.08)] p-5 ${props.className || ''}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-fuchsia-500/15 to-cyan-500/15 text-fuchsia-600">
            {props.icon ?? <Sparkles size={18} />}
          </span>
          <h2 className="text-lg font-semibold tracking-tight">{props.title}</h2>
        </div>
        {props.right}
      </div>
      {props.children}
    </motion.section>
  );
}

function Stat(props: { label: string; value: string; icon?: React.ReactNode; accent?: 'emerald' | 'cyan' | 'violet' }) {
  const ring =
    props.accent === 'emerald'
      ? 'ring-emerald-400/25 text-emerald-700'
      : props.accent === 'cyan'
        ? 'ring-cyan-400/25 text-cyan-700'
        : 'ring-violet-400/25 text-violet-700';
  const iconBg =
    props.accent === 'emerald'
      ? 'from-emerald-400/20 to-emerald-500/20 text-emerald-600'
      : props.accent === 'cyan'
        ? 'from-cyan-400/20 to-cyan-500/20 text-cyan-600'
        : 'from-violet-400/20 to-violet-500/20 text-violet-600';

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className={`p-4 rounded-2xl border bg-white ring-1 ${ring} shadow-sm`}
    >
      <div className="flex items-center gap-3">
        <span className={`inline-grid place-items-center w-10 h-10 rounded-xl bg-gradient-to-br ${iconBg}`}>
          {props.icon}
        </span>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">{props.label}</div>
          <div className="mt-0.5 text-xl font-semibold">{props.value}</div>
        </div>
      </div>
    </motion.div>
  );
}

function StatusPill({ label, count }: { label: string; count: number }) {
  const tone =
    label === 'PAID'
      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
      : label === 'PENDING'
        ? 'bg-amber-100 text-amber-700 border-amber-200'
        : label === 'SHIPPED' || label === 'DELIVERED' || label === 'PROCESSING'
          ? 'bg-cyan-100 text-cyan-700 border-cyan-200'
          : label === 'FAILED' || label === 'CANCELLED'
            ? 'bg-rose-100 text-rose-700 border-rose-200'
            : 'bg-zinc-100 text-zinc-700 border-zinc-200';
  return (
    <span className={`inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full border ${tone}`}>
      <b className="font-semibold">{label}</b>
      <span className="text-[11px] opacity-70">({count})</span>
    </span>
  );
}

function PaymentBadgeInline({ status }: { status: string | undefined }) {
  const s = (status || 'PENDING').toUpperCase();
  const tone =
    s === 'PAID'
      ? 'bg-emerald-600/10 text-emerald-700 border-emerald-600/20'
      : s === 'FAILED' || s === 'CANCELLED'
        ? 'bg-rose-500/10 text-rose-700 border-rose-600/20'
        : 'bg-amber-500/10 text-amber-700 border-amber-600/20';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${tone}`}>{s}</span>;
}

/* ---------------------- Page ---------------------- */
export default function UserDashboard() {
  const nav = useNavigate();
  const { token, clear } = useAuthStore();
  const qc = useQueryClient();

  const meQ = useMe();
  const ordersQ = useRecentOrders(5);
  const ordersSummaryQ = useOrdersSummary();
  const transactionsQ = useRecentTransactions(5);
  const totalSpentQ = useTotalSpent();

  const resendEmail = useResendEmail();
  const resendOtp = useResendOtp();
  const { openModal } = useModal();

  const [otpCooldown, setOtpCooldown] = useState(0);
  const [rebuyingId, setRebuyingId] = useState<string | null>(null);

  async function buyAgain(orderId: string) {
    try {
      setRebuyingId(orderId);
      const res = await api.get(`/api/orders/${orderId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const items = Array.isArray(res.data?.items) ? res.data.items : [];
      const toCart = items.map((it: any) => ({
        productId: it.product?.id ?? it.productId ?? it.id,
        qty: it.qty ?? it.quantity ?? 1,
      }));
      if (toCart.length > 0) mergeIntoLocalCart(toCart);
      nav('/cart');
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Could not add items to cart');
    } finally {
      setRebuyingId(null);
    }
  }

  useMemo(() => {
    if (otpCooldown <= 0) return;
    const t = setInterval(() => setOtpCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [otpCooldown]);

  const me = meQ.data;
  const initials = initialsFrom(me?.firstName, me?.lastName, me?.email);

  const verifiedBadge = (
    <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
      Verified
    </span>
  );
  const notVerifiedBadge = (
    <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
      Not verified
    </span>
  );

  const statusOrder = ['PENDING', 'PROCESSING', 'PAID', 'SHIPPED', 'DELIVERED', 'FAILED', 'CANCELLED'];
  const byStatusEntries = useMemo(() => {
    const map = ordersSummaryQ.data?.byStatus || {};
    const known = statusOrder.filter((k) => map[k] > 0).map((k) => [k, map[k]] as const);
    const unknown = Object.entries(map).filter(([k]) => !statusOrder.includes(k)).sort((a, b) => a[0].localeCompare(b[0])) as Array<[string, number]>;
    return [...known, ...unknown];
  }, [ordersSummaryQ.data, statusOrder]);

  /* ---------------------- Skeletons ---------------------- */
  const Shimmer = () => <div className="h-3 w-full rounded bg-gradient-to-r from-zinc-200 via-zinc-100 to-zinc-200 animate-pulse" />;

  return (
    <div className="max-w-screen-2xl mx-auto">
      {/* Neon gradient hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(closest-side,rgba(255,0,167,0.08),transparent_70%),radial-gradient(closest-side,rgba(0,204,255,0.10),transparent_70%)]" />
        <div className="relative px-4 md:px-8 pt-8 pb-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <motion.h1
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-2xl md:text-3xl font-bold tracking-tight text-zinc-900"
              >
                {me ? `Hey ${me.firstName || me.displayName || me.email.split('@')[0]}!` : 'Welcome!'} <span className="inline-block align-middle"><Sparkles className="inline text-fuchsia-600" size={22} /></span>
              </motion.h1>
              <p className="text-sm text-zinc-600">
                Your vibe, your orders, your payments—everything in one electric dashboard ⚡
              </p>
            </div>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.98 }}
              className="hidden sm:inline-flex items-center gap-2 rounded-full border px-4 py-2 bg-white/80 backdrop-blur hover:bg-white transition"
              onClick={() => nav('/settings')}
            >
              <ShieldCheck size={16} /> <span>Preferences</span> <ChevronRight size={16} />
            </motion.button>
          </div>
        </div>
      </div>

      {/* Content grid */}
      <div className="px-4 md:px-8 pb-10 grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Left rail (sticky) */}
        <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <GlassCard
            title="Profile"
            icon={<ShoppingBag size={18} />}
            right={
              <button className="text-sm text-fuchsia-600 hover:underline" onClick={() => nav('/profile')} aria-label="Edit profile">
                Edit
              </button>
            }
          >
            <div className="flex items-center gap-4">
              {me ? (
                <motion.div whileHover={{ rotate: -2 }}>
                  <div className="w-14 h-14 rounded-2xl grid place-items-center border bg-gradient-to-br from-zinc-900 to-zinc-700 text-white font-semibold shadow">
                    {initials}
                  </div>
                </motion.div>
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-zinc-200 animate-pulse" />
              )}

              <div className="min-w-0">
                <div className="font-semibold truncate">
                  {me ? `${me.firstName ?? ''} ${me?.lastName ?? ''}`.trim() || me.email : <Shimmer />}
                </div>
                <div className="text-sm text-zinc-600 truncate">{me?.email || (meQ.isLoading ? <Shimmer /> : '—')}</div>
                <div className="text-xs text-zinc-600 mt-1 flex items-center gap-2">
                  <Clock3 size={14} className="text-cyan-600" />
                  Joined {dateFmt(me?.joinedAt)} {me ? (me?.status === 'VERIFIED' ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700">
                      <CheckCircle2 size={14} /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700">
                      <AlertCircle size={14} /> Not verified
                    </span>
                  )) : null}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
              <Link className="group inline-flex items-center gap-1.5 text-cyan-700 hover:underline" to="/profile">
                Manage <ChevronRight className="group-hover:translate-x-0.5 transition" size={14} />
              </Link>
              <Link className="group inline-flex items-center gap-1.5 text-cyan-700 hover:underline" to="/orders">
                Orders <ChevronRight className="group-hover:translate-x-0.5 transition" size={14} />
              </Link>
              <Link className="group inline-flex items-center gap-1.5 text-cyan-700 hover:underline" to="/settings">
                Preferences <ChevronRight className="group-hover:translate-x-0.5 transition" size={14} />
              </Link>
            </div>
          </GlassCard>

          <GlassCard title="Verification" icon={<ShieldCheck size={18} />}>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2"><MailCheck size={16} className="text-emerald-600" /> Email {me?.emailVerified ? 'verified' : 'pending'}</span>
                {!me?.emailVerified && (
                  <motion.button
                    whileHover={{ y: -1 }}
                    className="rounded-full border px-3 py-1 bg-white hover:bg-zinc-50 transition"
                    disabled={resendEmail.isPending}
                    onClick={async () => {
                      try {
                        await resendEmail.mutateAsync();
                        qc.invalidateQueries({ queryKey: ['me'] });
                        openModal({ title: 'Verification', message: 'Verification email sent.' });
                      } catch (e: any) {
                        alert(e?.response?.data?.error || 'Failed to resend email');
                      }
                    }}
                  >
                    Resend link
                  </motion.button>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2"><Phone size={16} className="text-cyan-600" /> Phone {me?.phoneVerified ? 'verified' : 'pending'}</span>
                {!me?.phoneVerified && (
                  <motion.button
                    whileHover={{ y: -1 }}
                    className="rounded-full border px-3 py-1 bg-white hover:bg-zinc-50 transition disabled:opacity-50"
                    disabled={resendOtp.isPending || otpCooldown > 0}
                    title={otpCooldown > 0 ? `Retry in ${otpCooldown}s` : 'Resend OTP'}
                    onClick={async () => {
                      try {
                        const resp = await resendOtp.mutateAsync();
                        setOtpCooldown(resp?.nextResendAfterSec ?? 60);
                        alert('OTP sent to your phone.');
                      } catch (e: any) {
                        const retryAfter = e?.response?.data?.retryAfterSec;
                        if (retryAfter) setOtpCooldown(retryAfter);
                        alert(e?.response?.data?.error || 'Failed to resend OTP');
                      }
                    }}
                  >
                    {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : 'Resend OTP'}
                  </motion.button>
                )}
              </div>
            </div>
          </GlassCard>

          <GlassCard title="Security & Privacy" icon={<ShieldCheck size={18} />}>
            <div className="grid gap-2 text-sm">
              <Link to="/forgot-password" className="group inline-flex items-center gap-1.5 text-fuchsia-700 hover:underline">
                Change password <ChevronRight className="group-hover:translate-x-0.5 transition" size={14} />
              </Link>
              <Link to="/security/sessions" className="group inline-flex items-center gap-1.5 text-fuchsia-700 hover:underline">
                Sessions & devices <ChevronRight className="group-hover:translate-x-0.5 transition" size={14} />
              </Link>
              <Link to="/privacy" className="group inline-flex items-center gap-1.5 text-fuchsia-700 hover:underline">
                Data & privacy <ChevronRight className="group-hover:translate-x-0.5 transition" size={14} />
              </Link>
            </div>
          </GlassCard>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full text-sm rounded-full border px-4 py-2 bg-white hover:bg-zinc-50 transition inline-flex items-center justify-center gap-2"
            onClick={() => {
              clear();
              nav('/login');
            }}
          >
            <LogOut size={16} /> Logout
          </motion.button>
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          {/* Orders summary */}
          <GlassCard
            title="Your orders at a glance"
            icon={<ShoppingBag size={18} />}
            right={<Link className="text-sm text-fuchsia-700 hover:underline inline-flex items-center gap-1" to="/orders">View all <ChevronRight size={14} /></Link>}
          >
            {ordersSummaryQ.isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="p-4 rounded-2xl border bg-white"><Shimmer /><div className="mt-2"><Shimmer /></div></div>
                ))}
              </div>
            ) : ordersSummaryQ.isError ? (
              <div className="text-sm text-rose-600 inline-flex items-center gap-2"><Info size={16} /> Couldn’t load order summary.</div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <Stat label="Total orders" value={String(ordersSummaryQ.data?.total ?? 0)} icon={<RefreshCcw size={18} />} accent="violet" />
                  {byStatusEntries.slice(0, 5).map(([k, v]) => (
                    <Stat
                      key={k}
                      label={k}
                      value={String(v)}
                      icon={k === 'PAID' ? <CheckCircle2 size={18} /> : k === 'SHIPPED' || k === 'DELIVERED' || k === 'PROCESSING' ? <Truck size={18} /> : <Clock3 size={18} />}
                      accent={k === 'PAID' ? 'emerald' : k === 'PENDING' ? 'cyan' : 'violet'}
                    />
                  ))}
                </div>
                {byStatusEntries.length > 5 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {byStatusEntries.slice(5).map(([k, v]) => (
                      <StatusPill key={k} label={k} count={v} />
                    ))}
                  </div>
                )}
              </>
            )}
          </GlassCard>

          {/* Recent orders */}
          <GlassCard
            title="Recent orders"
            icon={<Truck size={18} />}
            right={<Link className="text-sm text-fuchsia-700 hover:underline inline-flex items-center gap-1" to="/orders">View all <ChevronRight size={14} /></Link>}
          >
            {ordersQ.isLoading ? (
              <div className="grid gap-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="border rounded-2xl p-4 bg-white grid gap-2"><Shimmer /><Shimmer /></div>)}</div>
            ) : ordersQ.isError ? (
              <div className="text-sm text-rose-600 inline-flex items-center gap-2"><Info size={16} /> Couldn’t load orders.</div>
            ) : ordersQ.data && ordersQ.data.length > 0 ? (
              <div className="grid gap-3">
                {ordersQ.data.map((o) => (
                  <motion.div
                    key={o.id}
                    whileHover={{ scale: 1.005 }}
                    className="border rounded-2xl p-4 bg-white flex items-center gap-4"
                  >
                    <div className="text-xs w-28">
                      <div className="text-zinc-500">{dateFmt(o.createdAt)}</div>
                      <div className="font-medium mt-1">{o.status}</div>
                    </div>
                    <div className="flex-1 grid gap-2 sm:grid-cols-2">
                      <div className="flex items-center gap-2">
                        {o.items.slice(0, 3).map((it) => {
                          const productId = it.product?.id ?? it.id;
                          const src = it.image || it.product?.imagesJson?.[0] || '/placeholder.svg';
                          return (
                            <Link key={it.id} to={`/product/${productId}`} title={it.title} aria-label={`View ${it.title}`}>
                              <img src={src} alt={it.title} className="w-12 h-12 rounded-xl object-cover border" />
                            </Link>
                          );
                        })}
                        {o.items.length > 3 && (
                          <span className="text-xs text-zinc-500">+{o.items.length - 3} more</span>
                        )}
                      </div>
                      <div className="text-sm">
                        <div className="font-semibold">{ngn.format(o.total)}</div>
                        <div className="text-zinc-500">{o.items[0]?.title ?? ''}</div>
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      {o.trackingUrl && (
                        <a href={o.trackingUrl} target="_blank" rel="noreferrer" className="text-sm text-cyan-700 hover:underline">
                          Track
                        </a>
                      )}
                      <Link to={`/orders?open=${o.id}`} className="text-sm text-fuchsia-700 hover:underline">
                        Details
                      </Link>
                      <motion.button
                        whileHover={{ y: -1 }}
                        className="text-sm rounded-full border px-3 py-1.5 bg-white hover:bg-zinc-50 transition disabled:opacity-50"
                        onClick={() => buyAgain(o.id)}
                        disabled={rebuyingId === o.id}
                        title="Re-add all items from this order to your cart"
                      >
                        {rebuyingId === o.id ? 'Adding…' : 'Buy again'}
                      </motion.button>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-zinc-600">No recent orders yet.</div>
            )}
          </GlassCard>

          {/* Recent transactions */}
          <GlassCard
            title="Recent transactions"
            icon={<CreditCard size={18} />}
            right={<Link className="text-sm text-fuchsia-700 hover:underline inline-flex items-center gap-1" to="/orders">All orders <ChevronRight size={14} /></Link>}
          >
            {transactionsQ.isLoading ? (
              <div className="grid gap-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="border rounded-2xl p-4 bg-white grid gap-2"><Shimmer /><Shimmer /></div>)}</div>
            ) : transactionsQ.isError ? (
              <div className="text-sm text-rose-600 inline-flex items-center gap-2"><Info size={16} /> Couldn’t load transactions.</div>
            ) : transactionsQ.data && transactionsQ.data.length > 0 ? (
              <div className="grid gap-3">
                {transactionsQ.data.map((t) => (
                  <motion.div key={t.orderId} whileHover={{ scale: 1.005 }} className="border rounded-2xl p-4 bg-white flex items-center gap-4">
                    <div className="text-xs w-44">
                      <div className="text-zinc-500">{dateTimeFmt(t.createdAt)}</div>
                      <div className="font-medium mt-1">{t.orderStatus}</div>
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold">{ngn.format(t.total)}</div>
                      <div className="text-xs text-zinc-600 mt-1">
                        {t.payment ? (
                          <>
                            <PaymentBadgeInline status={t.payment.status} />{' '}
                            {t.payment.provider || '—'} • {t.payment.channel || '—'} • Ref:{' '}
                            <span className="font-mono">{t.payment.reference || '—'}</span>
                          </>
                        ) : (
                          'No payment attempts yet'
                        )}
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <Link to={`/orders?open=${t.orderId}`} className="text-sm text-fuchsia-700 hover:underline">
                        Details
                      </Link>
                      {t.orderStatus !== 'PAID' && (
                        <motion.div whileHover={{ y: -1 }}>
                          <Link to={`/payment?orderId=${t.orderId}`} className="text-sm rounded-full border px-3 py-1.5 bg-white hover:bg-zinc-50 transition">
                            Pay now
                          </Link>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-zinc-600">No recent transactions.</div>
            )}
          </GlassCard>

          {/* Insights */}
          <GlassCard title="Your insights" icon={<Sparkles size={18} />}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Stat
                label="Total spent"
                value={totalSpentQ.isLoading ? '…' : ngn.format(totalSpentQ.data ?? 0)}
                icon={<CreditCard size={18} />}
                accent="emerald"
              />
              <Stat
                label="Orders"
                value={String(ordersSummaryQ.data?.total ?? 0)}
                icon={<ShoppingBag size={18} />}
                accent="cyan"
              />
              <Stat
                label="Member since"
                value={
                  me?.joinedAt
                    ? `${dateFmt(me.joinedAt)} • ${sinceJoined(me.joinedAt)} ago`
                    : '—'
                }
              />

            </div>
            <p className="text-xs text-zinc-600 mt-3">
              Tip: Turn on personalised recommendations in Preferences to see smarter picks here.
            </p>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
