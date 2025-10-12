// src/pages/UserPersonalisedPage.tsx
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { useAuthStore } from '../store/auth';
import { useModal } from "../components/ModalProvider";

// ---------------------- Types ----------------------
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
  status: 'PENDING' | 'PAID' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'FAILED' | 'PROCESSING';
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

type PaymentTx = {
  id: string;
  reference?: string | null;
  amount: number;                    // in major units
  status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | string;
  channel?: string | null;           // e.g., card, bank_transfer
  provider?: string | null;          // e.g., PAYSTACK, STRIPE
  createdAt: string;
  orderId?: string | null;
};

// Cart merge types/helpers (unchanged except shown for completeness)
type LocalCartItem = { productId: string; qty: number; unitPrice?: number; price?: number; title?: string; image?: string | null; };

function mergeIntoLocalCart(incoming: LocalCartItem[]) {
  try {
    const key = 'cart';
    const current: any[] = JSON.parse(localStorage.getItem(key) || '[]');

    const byId = new Map<string, any>();
    for (const it of current) {
      if (!it || !it.productId) continue;
      byId.set(it.productId, { ...it });
    }

    for (const inc of incoming) {
      if (!inc || !inc.productId) continue;
      const existing = byId.get(inc.productId);

      if (existing) {
        existing.qty = (Number(existing.qty) || 0) + (Number(inc.qty) || 0);

        if ((existing.unitPrice == null || isNaN(existing.unitPrice)) && inc.unitPrice != null) {
          existing.unitPrice = inc.unitPrice;
        }
        if ((existing.price == null || isNaN(existing.price)) && inc.price != null) {
          existing.price = inc.price;
        }
        if (!existing.title && inc.title) existing.title = inc.title;
        if (!existing.image && inc.image) existing.image = inc.image;

        byId.set(inc.productId, existing);
      } else {
        byId.set(inc.productId, {
          productId: inc.productId,
          qty: Number(inc.qty) || 1,
          unitPrice: inc.unitPrice ?? inc.price,
          price: inc.price ?? inc.unitPrice,
          title: inc.title,
          image: inc.image ?? null,
        });
      }
    }

    const merged = Array.from(byId.values());
    localStorage.setItem(key, JSON.stringify(merged));
  } catch { /* noop */ }
}

// ---------------------- Utils ----------------------
const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

const dateFmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : '—';

function initialsFrom(first?: string | null, last?: string | null, fallback?: string) {
  const a = (first || '').trim();
  const b = (last || '').trim();
  if (a || b) return `${a?.[0] ?? ''}${b?.[0] ?? ''}`.toUpperCase() || 'U';
  return (fallback?.[0] || 'U').toUpperCase();
}

function toNumber(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------- Data hooks ----------------------
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
      } catch { }
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

// ✅ NEW: recent payments
function useRecentPayments(limit = 5) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['payments', 'recent', limit],
    queryFn: async (): Promise<PaymentTx[]> => {
      // Prefer a scoped “mine” endpoint; fall back to generic if needed.
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

      const tryPaths = [
        `/api/payments/mine?limit=${limit}`,
        `/api/payments?limit=${limit}`
      ];

      for (const path of tryPaths) {
        try {
          const res = await api.get<any>(path, { headers });
          const data = Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data) ? res.data : []);
          if (data.length) return data as PaymentTx[];
        } catch {
          // try next path
        }
      }
      return [];
    },
    enabled: !!token,
    retry: 1,
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

// ---------------------- UI Primitives ----------------------
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

// ✅ NEW: payment status badge
function PaymentStatusBadge({ status }: { status: string }) {
  const s = status?.toUpperCase();
  const tone =
    s === 'PAID'
      ? 'bg-green-50 text-green-700 border-green-200'
      : s === 'FAILED' || s === 'CANCELED'
        ? 'bg-rose-50 text-rose-700 border-rose-200'
        : 'bg-amber-50 text-amber-700 border-amber-200'; // pending, others
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full border ${tone}`}>
      {s || '—'}
    </span>
  );
}

// ---------------------- Page ----------------------
export default function UserPersonalisedPage() {
  const nav = useNavigate();
  const { token, clear } = useAuthStore();
  const qc = useQueryClient();

  const meQ = useMe();
  const ordersQ = useRecentOrders(5);
  const ordersSummaryQ = useOrdersSummary();
  const paymentsQ = useRecentPayments(5); // ✅ use payments

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
      const toCart = items.map((it: any) => {
        const productId = it.product?.id ?? it.productId ?? it.id;
        const unitPrice = toNumber(it.unitPrice);
        return {
          productId,
          qty: it.qty ?? it.quantity ?? 1,
          unitPrice,
          price: unitPrice,
          title: it.product?.title ?? it.title,
          image: it.product?.imagesJson?.[0] ?? it.image ?? null,
        } as LocalCartItem;
      });

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
                  disabled={useResendEmail().isPending}
                  onClick={async () => {
                    try {
                      await useResendEmail().mutateAsync();
                      useQueryClient().invalidateQueries({ queryKey: ['me'] });
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

        {/* ✅ Recent Payments / Transactions */}
        <Section title="Payments">
          {paymentsQ.isLoading ? (
            <div className="text-sm opacity-70">Loading transactions…</div>
          ) : paymentsQ.isError ? (
            <div className="text-sm opacity-70">Couldn’t load transactions.</div>
          ) : paymentsQ.data && paymentsQ.data.length > 0 ? (
            <>
              <h3 className="text-sm font-medium mb-2">Recent transactions</h3>
              <ul className="text-sm space-y-2">
                {paymentsQ.data.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 justify-between border rounded p-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="text-xs opacity-70 w-28">{dateFmt(p.createdAt)}</div>
                      <PaymentStatusBadge status={p.status} />
                      <div className="font-medium">{ngn.format(p.amount ?? 0)}</div>
                      <div className="text-xs opacity-70 truncate max-w-[180px]">
                        Ref: <span className="font-mono">{p.reference || '—'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-xs opacity-70">
                        {(p.provider || 'PAYMENT')}{p.channel ? ` • ${p.channel}` : ''}
                      </div>
                      {p.orderId && (
                        <Link to={`/orders?open=${p.orderId}`} className="text-xs underline">
                          View order
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-center gap-3 text-sm">
                <Link to="/wallet" className="underline">Manage payment methods</Link>
                <span className="opacity-20">•</span>
                <Link to="/invoices" className="underline">Download invoices</Link>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm opacity-70">No recent transactions.</div>
              <div className="mt-4 flex items-center gap-3 text-sm">
                <Link to="/wallet" className="underline">Manage payment methods</Link>
                <span className="opacity-20">•</span>
                <Link to="/invoices" className="underline">Download invoices</Link>
              </div>
            </>
          )}
        </Section>

        {/* Personalisation */}
        <Section title="Personalisation & Preferences" right={<Link to="/settings" className="text-sm underline">Edit</Link>}>
          <div className="grid gap-2 text-sm">
            <div>Interests: {me?.productInterests?.length ? me.productInterests.join(', ') : '—'}</div>
            <div>Language: {me?.language ?? '—'}</div>
            <div>Currency: {me?.currency ?? 'NGN'}</div>
            <div>
              Notifications{' '}(
              {me?.notificationPrefs
                ? [
                    me.notificationPrefs.email ? 'Email' : null,
                    me.notificationPrefs.sms ? 'SMS' : null,
                    me.notificationPrefs.push ? 'Push' : null,
                  ]
                    .filter(Boolean)
                    .join(', ') || 'None'
                : '—'}
              )
            </div>
          </div>
        </Section>

        {/* Support */}
        <Section title="Support">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <a href="https://wa.me/2340000000000" className="border rounded p-3 hover:bg-black/5" target="_blank" rel="noreferrer">WhatsApp</a>
            <Link to="/faq" className="border rounded p-3 hover:bg-black/5">FAQs & Returns</Link>
          </div>
        </Section>

        {/* Insights */}
        <Section title="Your insights">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Total spent" value={ngn.format(0)} />
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
