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

  // Address snapshots (optional)
  address?: Address | null;
  shippingAddress?: Address | null;

  // Loyalty
  loyaltyTier?: 'Bronze' | 'Silver' | 'Gold' | 'VIP';
  points?: number;
  pointsExpireAt?: string | null;

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

  // Wallet / payments
  walletBalance?: number; // NGN major units
  voucherBalance?: number;
  preferredPayment?: 'card' | 'transfer' | 'wallet' | 'pay_on_delivery';
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
  status: 'PENDING' | 'PAID' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  total: number; // major units
  items: Array<{
    id: string;
    title: string;
    quantity: number;
    image?: string | null;
  }>;
  trackingUrl?: string | null;
};

type WalletTx = {
  id: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  createdAt: string;
  note?: string | null;
};

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

function useRecentOrders() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['orders', 'recent'],
    queryFn: async () => {
      // Implement this on API: GET /api/orders?limit=5
      const res = await api.get<OrderLite[]>('/api/orders?limit=5', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      return res.data;
    },
    enabled: !!token,
    retry: 1,
  });
}

function useWallet() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['wallet'],
    queryFn: async () => {
      // Implement this on API: GET /api/wallet/summary
      const res = await api.get<{ balance: number; vouchers: number; tx: WalletTx[] }>(
        '/api/wallet/summary',
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
      );
      return res.data;
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

// ---------------------- Page ----------------------
export default function UserPersonalisedPage() {
  const nav = useNavigate();
  const { token, clear } = useAuthStore();
  const qc = useQueryClient();

  const meQ = useMe();
  const ordersQ = useRecentOrders();
  const walletQ = useWallet();

  const resendEmail = useResendEmail();
  const resendOtp = useResendOtp();
  const {openModal} = useModal();

  const [otpCooldown, setOtpCooldown] = useState(0);

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

  return (
    <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-6 grid gap-6 lg:grid-cols-[290px_1fr]">
      {/* Left rail: identity + quick settings */}
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

          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat label="Tier" value={me?.loyaltyTier ?? '—'} />
            <Stat label="Points" value={String(me?.points ?? 0)} />
            <Stat label="Wallet" value={ngn.format(walletQ.data?.balance ?? me?.walletBalance ?? 0)} />
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
                        openModal({title: 'Verification', message:  'Verification email sent.'});

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

        <Section title="Quick settings">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Link to="/settings" className="border rounded p-3 hover:bg-black/5">Theme & Language</Link>
            <Link to="/settings" className="border rounded p-3 hover:bg-black/5">Notifications</Link>
            <Link to="/profile" className="border rounded p-3 hover:bg-black/5">Addresses</Link>
            <Link to="/wallet" className="border rounded p-3 hover:bg-black/5">Payment methods</Link>
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

      {/* Right content: orders, wallet, preferences, support, analytics */}
      <div className="space-y-6">
        {/* Orders & activity */}
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
                  <div className="text-xs w-24">
                    <div className="opacity-70">{dateFmt(o.createdAt)}</div>
                    <div className="font-medium">{o.status}</div>
                  </div>
                  <div className="flex-1 grid gap-2 sm:grid-cols-2">
                    <div className="flex items-center gap-2">
                      {o.items.slice(0, 3).map((it) => (
                        <img
                          key={it.id}
                          src={it.image || '/placeholder.svg'}
                          alt={it.title}
                          className="w-10 h-10 rounded object-cover border"
                        />
                      ))}
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
                    <Link to={`/orders/${o.id}`} className="text-sm underline">
                      Details
                    </Link>
                    <button className="text-sm border rounded px-2 py-1">Buy again</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm opacity-70">No recent orders yet.</div>
          )}
        </Section>

        {/* Payments & Wallet */}
        <Section title="Payments & Wallet">
          {walletQ.isLoading ? (
            <div className="text-sm opacity-70">Loading…</div>
          ) : walletQ.isError ? (
            <div className="text-sm opacity-70">Couldn’t load wallet.</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Wallet balance" value={ngn.format(walletQ.data?.balance ?? 0)} />
                <Stat label="Vouchers" value={ngn.format(walletQ.data?.vouchers ?? 0)} />
                <Stat label="Preferred" value={me?.preferredPayment ? me.preferredPayment : '—'} />
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-medium mb-2">Recent transactions</h3>
                {walletQ.data?.tx?.length ? (
                  <ul className="text-sm space-y-2">
                    {walletQ.data.tx.slice(0, 5).map((t) => (
                      <li key={t.id} className="flex items-center justify-between border rounded p-2">
                        <span className="opacity-80">{dateFmt(t.createdAt)}</span>
                        <span className={t.type === 'CREDIT' ? 'text-green-600' : 'text-red-600'}>
                          {t.type === 'CREDIT' ? '+' : '−'} {ngn.format(Math.abs(t.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm opacity-70">No recent transactions.</div>
                )}
              </div>
              <div className="mt-4 flex items-center gap-3 text-sm">
                <Link to="/wallet" className="underline">Manage payment methods</Link>
                <span className="opacity-20">•</span>
                <Link to="/invoices" className="underline">Download invoices</Link>
              </div>
            </>
          )}
        </Section>

        {/* Rewards & Loyalty */}
        <Section title="Rewards & Loyalty">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Tier" value={me?.loyaltyTier ?? '—'} />
            <Stat label="Points" value={String(me?.points ?? 0)} />
            <Stat label="Expiry" value={dateFmt(me?.pointsExpireAt)} />
          </div>
          <div className="mt-4 text-sm flex items-center gap-3">
            <Link to="/rewards" className="underline">Claim rewards</Link>
            <span className="opacity-20">•</span>
            <Link to="/referrals" className="underline">Refer friends</Link>
          </div>
        </Section>

        {/* Personalisation */}
        <Section title="Personalisation & Preferences" right={<Link to="/settings" className="text-sm underline">Edit</Link>}>
          <div className="grid gap-2 text-sm">
            <div>Interests: {me?.productInterests?.length ? me.productInterests.join(', ') : '—'}</div>
            <div>Language: {me?.language ?? '—'}</div>
            <div>Currency: {me?.currency ?? 'NGN'}</div>
            <div>
              Notifications:{' '}
              {me?.notificationPrefs
                ? [
                    me.notificationPrefs.email ? 'Email' : null,
                    me.notificationPrefs.sms ? 'SMS' : null,
                    me.notificationPrefs.push ? 'Push' : null,
                  ]
                    .filter(Boolean)
                    .join(', ') || 'None'
                : '—'}
            </div>
          </div>
        </Section>

        {/* Support & Engagement */}
        <Section title="Support">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Link to="/support" className="border rounded p-3 hover:bg-black/5">Open a ticket</Link>
            <a href="https://wa.me/2340000000000" className="border rounded p-3 hover:bg-black/5" target="_blank" rel="noreferrer">WhatsApp</a>
            <Link to="/faq" className="border rounded p-3 hover:bg-black/5">FAQs & Returns</Link>
            <Link to="/support/chat" className="border rounded p-3 hover:bg-black/5">Live chat</Link>
          </div>
        </Section>

        {/* Analytics & Insights (optional) */}
        <Section title="Your insights">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Total spent" value={ngn.format(0)} />
            <Stat label="Orders" value={String(ordersQ.data?.length ?? 0)} />
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
