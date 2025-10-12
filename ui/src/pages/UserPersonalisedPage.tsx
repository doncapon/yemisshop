// src/pages/UserPersonalisedPage.tsx
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { useAuthStore } from '../store/auth';
import { useModal } from "../components/ModalProvider";

/* ---------------------- Types ---------------------- */
type Role = 'ADMIN' | 'SUPPLIER' | 'SHOPPER';

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

  // Address snapshots (optional)
  address?: Address | null;
  shippingAddress?: Address | null;

  // Preferences
  language?: string | null;
  theme?: 'light' | 'dark' | 'system';
  currency?: string | null;
  productInterests?: string[]; // tags
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
  status: 'PENDING' | 'PAID' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'FAILED' | 'PROCESSING';
  total: number; // major units
  items: Array<{
    product: any;       // should include at least { id, imagesJson? }
    id: string;         // item id (fallback)
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
  } catch {
    /* best-effort */
  }
}

/* ---------------------- Utils ---------------------- */
const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

const dateFmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : '—';

function dateTimeFmt(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '—';
  return d.toLocaleString();
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
    queryFn: async () => {
      const res = await api.get<MeResponse>('/api/auth/me', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      return res.data;
    },
    enabled: !!token,
  });
}

function useRecentOrders(limit = 5) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['orders', 'recent', limit],
    queryFn: async () => {
      const res = await api.get<OrderLite[]>(`/api/orders/mine?limit=${limit}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      return res.data;
    },
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
        const res = await api.get<OrdersSummary>('/api/orders/summary', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (res?.data?.total != null) return res.data;
      } catch { /* fall through */ }
      try {
        const res = await api.get<OrderLite[]>('/api/orders/mine?limit=1000', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
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

/** NEW: order-centric recent transactions */
function useRecentTransactions(limit = 5) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['payments', 'recent-orders', limit],
    queryFn: async () => {
      const res = await api.get<RecentTransaction[]>(`/api/payments/recent?limit=${limit}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      return res.data;
    },
    enabled: !!token,
    retry: 1,
  });
}

/** NEW: total spent (sum of successful payments). Tries /api/payments/summary, falls back to orders. */
function useTotalSpent() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['payments', 'totalSpent'],
    queryFn: async () => {
      // Try a tiny payments summary endpoint first
      try {
        const r = await api.get<{ totalPaid?: number; totalPaidNgn?: number }>('/api/payments/summary', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const v = r.data?.totalPaid ?? r.data?.totalPaidNgn;
        if (typeof v === 'number' && Number.isFinite(v)) return v;
      } catch {
        /* fall back */
      }
      // Fallback: sum PAID orders
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
    mutationFn: async () => {
      const res = await api.post(
        '/api/auth/resend-email',
        {},
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
      );
      return res.data;
    },
  });
}

function useResendOtp() {
  const token = useAuthStore((s) => s.token);
  return useMutation({
    mutationFn: async () => {
      const res = await api.post(
        '/api/auth/resend-otp',
        {},
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
      );
      return res.data as { nextResendAfterSec?: number };
    },
  });
}

/* ---------------------- UI primitives ---------------------- */
function Section(props: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="bg-white border rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{props.title}</h2>
        {props.right}
      </div>
      {props.children}
    </section>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className="p-3 border rounded-lg text-center">
      <div className="text-xs opacity-70">{props.label}</div>
      <div className="text-base font-semibold">{props.value}</div>
    </div>
  );
}

function StatusPill({ label, count }: { label: string; count: number }) {
  const tone =
    label === 'PAID'
      ? 'bg-green-50 text-green-700 border-green-200'
      : label === 'PENDING'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : label === 'SHIPPED' || label === 'DELIVERED' || label === 'PROCESSING'
          ? 'bg-blue-50 text-blue-700 border-blue-200'
          : label === 'FAILED' || label === 'CANCELLED'
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : 'bg-zinc-50 text-zinc-700 border-zinc-200';
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
      ? 'bg-green-600/10 text-green-700 border-green-600/20'
      : s === 'FAILED' || s === 'CANCELLED'
        ? 'bg-red-500/10 text-red-700 border-red-600/20'
        : 'bg-yellow-500/10 text-yellow-700 border-yellow-600/20';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${tone}`}>
      {s}
    </span>
  );
}

/* ---------------------- Page ---------------------- */
export default function UserPersonalisedPage() {
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
  }, [otpCooldown]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = meQ.data;
  const initials = initialsFrom(me?.firstName, me?.lastName, me?.email);

  const verifiedBadge = (
    <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-green-50 text-green-700">
      <span className="w-1.5 h-1.5 rounded-full bg-green-600" />
      Verified
    </span>
  );

  const notVerifiedBadge = (
    <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
      Not verified
    </span>
  );

  // derive ordered status counts for display
  const statusOrder = ['PENDING', 'PROCESSING', 'PAID', 'SHIPPED', 'DELIVERED', 'FAILED', 'CANCELLED'];
  const byStatusEntries = useMemo(() => {
    const map = ordersSummaryQ.data?.byStatus || {};
    const known = statusOrder
      .filter((k) => map[k] > 0)
      .map((k) => [k, map[k]] as const);
    const unknown = Object.entries(map)
      .filter(([k]) => !statusOrder.includes(k))
      .sort((a, b) => a[0].localeCompare(b[0])) as Array<[string, number]>;
    return [...known, ...unknown];
  }, [ordersSummaryQ.data, statusOrder]);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-6 grid gap-6 lg:grid-cols-[290px_1fr]">
      {/* Left rail */}
      <div className="space-y-6">
        <Section
          title="Your profile"
          right={
            <button
              className="text-sm underline"
              onClick={() => nav('/profile')}
              aria-label="Edit profile"
            >
              Edit
            </button>
          }
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full grid place-items-center border bg-black text-white font-semibold">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="font-semibold truncate">
                {me ? `${me.firstName ?? ''} ${me?.lastName ?? ''}`.trim() || me.email : '—'}
              </div>
              <div className="text-sm opacity-70 truncate">{me?.email || '—'}</div>
              <div className="text-xs opacity-70">
                Joined {dateFmt(me?.joinedAt)} {me?.status === 'VERIFIED' ? verifiedBadge : notVerifiedBadge}
              </div>
            </div>
          </div>

          {/* Quick toggles */}
          <div className="mt-4 flex items-center gap-2 text-sm">
            <Link className="underline" to="/profile">Manage details</Link>
            <span className="opacity-20">•</span>
            <Link className="underline" to="/orders">Order history</Link>
            <span className="opacity-20">•</span>
            <Link className="underline" to="/settings">Preferences</Link>
          </div>
        </Section>

        <Section title="Verification">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span>Email {me?.emailVerified ? verifiedBadge : notVerifiedBadge}</span>
              {!me?.emailVerified && (
                <button
                  className="underline"
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
                </button>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span>Phone {me?.phoneVerified ? verifiedBadge : notVerifiedBadge}</span>
              {!me?.phoneVerified && (
                <button
                  className="underline disabled:opacity-50"
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
                </button>
              )}
            </div>
          </div>
        </Section>

        <Section title="Security">
          <div className="grid gap-2 text-sm">
            <Link to="/security" className="underline">Change password & 2FA</Link>
            <Link to="/security/sessions" className="underline">Login devices & sessions</Link>
            <Link to="/privacy" className="underline">Data & privacy</Link>
          </div>
        </Section>

        <button
          className="w-full text-sm border rounded p-2"
          onClick={() => {
            clear();
            nav('/login');
          }}
        >
          Logout
        </button>
      </div>

      {/* Right content */}
      <div className="space-y-6">
        {/* Orders summary */}
        <Section
          title="Your orders at a glance"
          right={<Link className="text-sm underline" to="/orders">View all</Link>}
        >
          {ordersSummaryQ.isLoading ? (
            <div className="text-sm opacity-70">Loading summary…</div>
          ) : ordersSummaryQ.isError ? (
            <div className="text-sm opacity-70">Couldn’t load order summary.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <Stat label="Total orders" value={String(ordersSummaryQ.data?.total ?? 0)} />
                {byStatusEntries.slice(0, 5).map(([k, v]) => (
                  <div key={k} className="p-3 border rounded-lg text-center">
                    <div className="text-xs opacity-70">{k}</div>
                    <div className="text-base font-semibold">{v}</div>
                  </div>
                ))}
              </div>
              {byStatusEntries.length > 5 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {byStatusEntries.slice(5).map(([k, v]) => (
                    <StatusPill key={k} label={k} count={v} />
                  ))}
                </div>
              )}
            </>
          )}
        </Section>

        {/* Recent orders */}
        <Section
          title="Recent orders"
          right={<Link className="text-sm underline" to="/orders">View all</Link>}
        >
          {ordersQ.isLoading ? (
            <div className="text-sm opacity-70">Loading…</div>
          ) : ordersQ.isError ? (
            <div className="text-sm opacity-70">Couldn’t load orders.</div>
          ) : ordersQ.data && ordersQ.data.length > 0 ? (
            <div className="grid gap-3">
              {ordersQ.data.map((o) => (
                <div key={o.id} className="border rounded p-3 flex items-center gap-3">
                  <div className="text-xs w-28">
                    <div className="opacity-70">{dateFmt(o.createdAt)}</div>
                    <div className="font-medium">{o.status}</div>
                  </div>
                  <div className="flex-1 grid gap-2 sm:grid-cols-2">
                    <div className="flex items-center gap-2">
                      {o.items.slice(0, 3).map((it) => {
                        const productId = it.product?.id ?? it.id;
                        const src =
                          it.image ||
                          it.product?.imagesJson?.[0] ||
                          '/placeholder.svg';
                        return (
                          <Link
                            key={it.id}
                            to={`/product/${productId}`}
                            title={it.title}
                            aria-label={`View ${it.title}`}
                          >
                            <img
                              src={src}
                              alt={it.title}
                              className="w-10 h-10 rounded object-cover border"
                            />
                          </Link>
                        );
                      })}
                      {o.items.length > 3 && (
                        <span className="text-xs opacity-70">+{o.items.length - 3} more</span>
                      )}
                    </div>
                    <div className="text-sm">
                      <div className="font-medium">{ngn.format(o.total)}</div>
                      <div className="opacity-70">{o.items[0]?.title ?? ''}</div>
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {o.trackingUrl && (
                      <a href={o.trackingUrl} target="_blank" rel="noreferrer" className="text-sm underline">
                        Track
                      </a>
                    )}
                    <Link to={`/orders?open=${o.id}`} className="text-sm underline">
                      Details
                    </Link>
                    <button
                      className="text-sm border rounded px-2 py-1 disabled:opacity-50"
                      onClick={() => buyAgain(o.id)}
                      disabled={rebuyingId === o.id}
                      title="Re-add all items from this order to your cart"
                    >
                      {rebuyingId === o.id ? 'Adding…' : 'Buy again'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm opacity-70">No recent orders yet.</div>
          )}
        </Section>

        {/* Recent transactions – order-centric */}
        <Section title="Recent transactions" right={<Link className="text-sm underline" to="/orders">All orders</Link>}>
          {transactionsQ.isLoading ? (
            <div className="text-sm opacity-70">Loading transactions…</div>
          ) : transactionsQ.isError ? (
            <div className="text-sm opacity-70">Couldn’t load transactions.</div>
          ) : transactionsQ.data && transactionsQ.data.length > 0 ? (
            <div className="grid gap-3">
              {transactionsQ.data.map((t) => (
                <div key={t.orderId} className="border rounded p-3 flex items-center gap-3">
                  <div className="text-xs w-36">
                    <div className="opacity-70">{dateTimeFmt(t.createdAt)}</div>
                    <div className="font-medium">{t.orderStatus}</div>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{ngn.format(t.total)}</div>
                    <div className="text-xs opacity-70">
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
                    <Link to={`/orders?open=${t.orderId}`} className="text-sm underline">Details</Link>
                    {t.orderStatus !== 'PAID' && (
                      <Link
                        to={`/payment?orderId=${t.orderId}`}
                        className="text-sm border rounded px-2 py-1"
                      >
                        Pay now
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm opacity-70">No recent transactions.</div>
          )}
        </Section>

        {/* Insights */}
        <Section title="Your insights">
          <div className="grid grid-cols-3 gap-2">
            <Stat
              label="Total spent"
              value={
                totalSpentQ.isLoading
                  ? '…'
                  : ngn.format(totalSpentQ.data ?? 0)
              }
            />
            <Stat label="Orders" value={String(ordersSummaryQ.data?.total ?? 0)} />
            <Stat label="Member since" value={dateFmt(me?.joinedAt)} />
          </div>
          <p className="text-xs opacity-70 mt-2">
            Tip: turn on personalised recommendations in Preferences to see smarter picks here.
          </p>
        </Section>
      </div>
    </div>
  );
}
