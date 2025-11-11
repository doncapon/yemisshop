// src/pages/Profile.tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';
import SiteLayout from '../layouts/SiteLayout';

type Address = {
  id?: string;
  houseNumber?: string | null;
  streetName?: string | null;
  postCode?: string | null;
  town?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

type MeResponse = {
  id: string;
  email: string;
  role: 'ADMIN' | 'SUPER_ADMIN' | 'SUPER_USER' | 'SHOPPER';
  status: 'PENDING' | 'PARTIAL' | 'VERIFIED';
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  address?: Address | null;
  shippingAddress?: Address | null;
  bank?: {
    bankName?: string | null;
    accountName?: string | null;
    accountNumber?: string | null;
  } | null;
};

const emptyAddr: Address = {
  houseNumber: '',
  streetName: '',
  postCode: '',
  town: '',
  city: '',
  state: '',
  country: '',
};

export default function Profile() {
  const token = useAuthStore((s) => s.token);
  const nav = useNavigate();

  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Address forms
  const [home, setHome] = useState<Address>(emptyAddr);
  const [ship, setShip] = useState<Address>(emptyAddr);
  const [sameAsHome, setSameAsHome] = useState<boolean>(false);
  const [savingAddr, setSavingAddr] = useState<boolean>(false);

  // NEW: Verification helpers
  const [emailBusy, setEmailBusy] = useState(false);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);

  // Cooldown timer
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const t = setInterval(() => setOtpCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [otpCooldown]);

  // -------- Load profile (requires token) --------
  useEffect(() => {
    let cancelled = false;

    if (!token) {
      nav('/login', { state: { from: { pathname: '/profile' } } });
      return;
    }

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data } = await api.get<MeResponse>('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;

        setMe(data);

        const a = data.address || {};
        const s = data.shippingAddress || {};
        setHome({
          houseNumber: a.houseNumber ?? '',
          streetName: a.streetName ?? '',
          postCode: a.postCode ?? '',
          town: a.town ?? '',
          city: a.city ?? '',
          state: a.state ?? '',
          country: a.country ?? '',
        });

        setShip({
          houseNumber: s.houseNumber ?? '',
          streetName: s.streetName ?? '',
          postCode: s.postCode ?? '',
          town: s.town ?? '',
          city: s.city ?? '',
          state: s.state ?? '',
          country: s.country ?? '',
        });

        setSameAsHome(isAddrEqual(a, s));
      } catch (e: any) {
        if (cancelled) return;
        if (e?.response?.status === 401) {
          nav('/login', { state: { from: { pathname: '/profile' } } });
          return;
        }
        setErr(e?.response?.data?.error || 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, nav]);

  // -------- Helpers --------
  function isAddrEqual(a?: Address | null, b?: Address | null) {
    const ax = a || {};
    const bx = b || {};
    const norm = (v: unknown) => (typeof v === 'string' ? v.trim() : '') || '';
    return (
      norm(ax.houseNumber) === norm(bx.houseNumber) &&
      norm(ax.streetName) === norm(bx.streetName) &&
      norm(ax.postCode) === norm(bx.postCode) &&
      norm(ax.town) === norm(bx.town) &&
      norm(ax.city) === norm(bx.city) &&
      norm(ax.state) === norm(bx.state) &&
      norm(ax.country) === norm(bx.country)
    );
  }

  const displayName = useMemo(() => {
    if (!me) return '';
    const f = me.firstName?.trim();
    const m = me.middleName?.trim();
    const l = me.lastName?.trim();
    if (!f && !l) return '';
    const mid = m ? ` ${m[0].toUpperCase()}.` : '';
    return `${f || ''}${mid} ${l || ''}`.trim();
  }, [me]);

  // -------- Address change handlers --------
  const onHome =
    (k: keyof Address) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setHome((h) => ({ ...h, [k]: v }));
        if (sameAsHome) {
          setShip((s) => ({ ...s, [k]: v }));
        }
      };

  const onShip =
    (k: keyof Address) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setShip((s) => ({ ...s, [k]: v }));
      };

  // -------- Email / Phone verification handlers --------
  const resendEmail = async () => {
    if (!token) return nav('/login', { state: { from: { pathname: '/profile' } } });
    setErr(null);
    setMsg(null);
    setEmailBusy(true);
    try {
      await api.post('/api/auth/resend-email', {}, { headers: { Authorization: `Bearer ${token}` } });
      setMsg('Verification email sent.');
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed to resend verification email');
    } finally {
      setEmailBusy(false);
    }
  };

  const requestOtp = async () => {
    if (!token) return nav('/login', { state: { from: { pathname: '/profile' } } });
    setErr(null);
    setMsg(null);
    setPhoneBusy(true);
    try {
      const { data } = await api.post('/api/auth/resend-otp', {}, { headers: { Authorization: `Bearer ${token}` } });
      setMsg('OTP sent to your phone.');
      setOtpCooldown(Number(data?.nextResendAfterSec ?? 60));
    } catch (e: any) {
      const retryAfter = Number(e?.response?.data?.retryAfterSec || 0);
      if (retryAfter) setOtpCooldown(retryAfter);
      setErr(e?.response?.data?.error || 'Failed to send OTP');
    } finally {
      setPhoneBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (!token) return nav('/login', { state: { from: { pathname: '/profile' } } });
    if (!otp.trim()) {
      setErr('Enter the OTP sent to your phone.');
      return;
    }
    setErr(null);
    setMsg(null);
    setOtpBusy(true);
    try {
      await api.post('/api/auth/verify-otp', { user: me, otp: otp.trim() }, { headers: { Authorization: `Bearer ${token}` } });
      setMsg('Phone verified successfully.');
      setMe((prev) => (prev ? { ...prev, phoneVerified: true } : prev));
      setOtp('');
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Invalid OTP');
    } finally {
      setOtpBusy(false);
    }
  };

  // -------- Save addresses only --------
  const saveAddresses = async () => {
    if (!token) {
      nav('/login', { state: { from: { pathname: '/profile' } } });
      return;
    }

    setErr(null);
    setMsg(null);

    const req = ['houseNumber', 'streetName', 'city', 'state', 'country'] as const;
    for (const key of req) {
      const val = (home as any)[key];
      if (!val || !String(val).trim()) {
        setErr('Please complete the required Home Address fields.');
        return;
      }
    }
    if (!sameAsHome) {
      for (const key of req) {
        const val = (ship as any)[key];
        if (!val || !String(val).trim()) {
          setErr('Please complete the required Shipping Address fields or check “Same as home”.');
          return;
        }
      }
    }

    setSavingAddr(true);
    try {
      // Save home
      await api.post(
        '/api/profile/address',
        {
          houseNumber: home.houseNumber,
          streetName: home.streetName,
          postCode: home.postCode || '',
          town: home.town || '',
          city: home.city,
          state: home.state,
          country: home.country,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Save shipping
      const payload = sameAsHome
        ? {
          houseNumber: home.houseNumber,
          streetName: home.streetName,
          postCode: home.postCode || '',
          town: home.town || '',
          city: home.city,
          state: home.state,
          country: home.country,
        }
        : {
          houseNumber: ship.houseNumber,
          streetName: ship.streetName,
          postCode: ship.postCode || '',
          town: ship.town || '',
          city: ship.city,
          state: ship.state,
          country: ship.country,
        };

      await api.post('/api/profile/shipping', payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setMsg('Addresses saved successfully.');
    } catch (e: any) {
      if (e?.response?.status === 401) {
        nav('/login', { state: { from: { pathname: '/profile' } } });
        return;
      }
      setErr(e?.response?.data?.error || 'Failed to save addresses');
    } finally {
      setSavingAddr(false);
    }
  };

  // -------- UI --------
  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <div className="rounded-xl border bg-white p-6">
          <div className="animate-pulse text-sm text-ink-soft">Loading your profile…</div>
        </div>
      </div>
    );
  }

  if (err && !me) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <div className="rounded-xl border bg-white p-6 text-red-700">{err}</div>
      </div>
    );
  }

  return (
    <SiteLayout>
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-primary-700">My Account</h1>
            <p className="text-sm opacity-70">Manage your addresses and view verification status.</p>
          </div>
        </div>

        {/* Alerts */}
        {msg && <div className="rounded-lg border border-green-200 bg-green-50 text-green-800 px-3 py-2">{msg}</div>}
        {err && <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2">{err}</div>}

        {/* Identity & Verification */}
        {me && (
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs text-ink-soft">Signed in as</div>
              <div className="font-medium break-all">{displayName || me.email}</div>
              <div className="mt-1 text-xs opacity-70 break-all">{me.email}</div>
              <div className="mt-3 text-xs">
                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] mr-2
                bg-primary-50 text-primary-700 border-primary-200">
                  Role: {me.role}
                </span>
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]
                ${me.status === 'VERIFIED'
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : me.status === 'PARTIAL'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-zinc-50 text-zinc-700 border-zinc-200'}`}>
                  Status: {me.status}
                </span>
              </div>
            </div>

            {/* EMAIL CARD (enhanced) */}
            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs text-ink-soft">Email</div>
              <div className="font-medium break-all">{me.email}</div>
              <div className={`mt-2 text-sm ${me.emailVerified ? 'text-green-700' : 'text-amber-700'}`}>
                {me.emailVerified ? 'Verified' : 'Not verified'}
              </div>
              {!me.emailVerified && (
                <div className="mt-3">
                  <button
                    onClick={resendEmail}
                    disabled={emailBusy}
                    className="text-sm underline text-primary-700 disabled:opacity-50"
                    title="Resend verification email"
                  >
                    {emailBusy ? 'Sending…' : 'Resend verification email'}
                  </button>
                </div>
              )}
            </div>

            {/* PHONE CARD (enhanced) */}
            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs text-ink-soft">Phone</div>
              <div className="font-medium break-words">{me.phone || '—'}</div>
              <div className={`mt-2 text-sm ${me.phoneVerified ? 'text-green-700' : 'text-amber-700'}`}>
                {me.phoneVerified ? 'Verified' : 'Not verified'}
              </div>

              {!me.phoneVerified && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={requestOtp}
                      disabled={phoneBusy || otpCooldown > 0}
                      className="text-sm underline text-primary-700 disabled:opacity-50"
                      title={otpCooldown > 0 ? `Retry in ${otpCooldown}s` : 'Send OTP'}
                    >
                      {phoneBusy ? 'Sending…' : otpCooldown > 0 ? `Send OTP in ${otpCooldown}s` : 'Send OTP'}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      placeholder="Enter OTP"
                      className="w-full rounded-lg border border-border px-3 py-2 bg-surface placeholder:text-ink-soft focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition"
                    />
                    <button
                      onClick={verifyOtp}
                      disabled={otpBusy || !otp.trim()}
                      className="rounded-md border bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-700 transition disabled:opacity-50"
                    >
                      {otpBusy ? 'Verifying…' : 'Verify'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Admin-managed (read-only) */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Phone</h2>
              <span className="text-[11px] rounded-full px-2 py-0.5 border bg-zinc-100 text-zinc-600 border-zinc-200">
                Admin-managed
              </span>
            </div>
            <input
              className="mt-2 w-full rounded-lg border border-border bg-zinc-100 text-ink-soft px-3 py-2.5"
              value={me?.phone || ''}
              disabled
            />
          </div>

          <div className="rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Date of birth</h2>
              <span className="text-[11px] rounded-full px-2 py-0.5 border bg-zinc-100 text-zinc-600 border-zinc-200">
                Admin-managed
              </span>
            </div>
            <input
              type="date"
              className="mt-2 w-full rounded-lg border border-border bg-zinc-100 text-ink-soft px-3 py-2.5"
              value={me?.dateOfBirth ? me.dateOfBirth.substring(0, 10) : ''}
              disabled
            />
          </div>
        </section>

        {/* Addresses (editable) */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-ink">Home address</h2>
              <span className="text-[11px] rounded-full px-2 py-0.5 border bg-primary-50 text-primary-700 border-primary-200">
                Required
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="House number" value={home.houseNumber || ''} onChange={onHome('houseNumber')} required />
              <Input label="Street name" value={home.streetName || ''} onChange={onHome('streetName')} required />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="City" value={home.city || ''} onChange={onHome('city')} required />
              <Input label="State" value={home.state || ''} onChange={onHome('state')} required />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Post code" value={home.postCode || ''} onChange={onHome('postCode')} />
              <Input label="Country" value={home.country || ''} onChange={onHome('country')} required />
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-ink">Shipping address</h2>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sameAsHome}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSameAsHome(checked);
                    if (checked) setShip({ ...home });
                  }}
                  className="h-4 w-4 rounded border-border"
                />
                <span>Same as home</span>
              </label>
            </div>

            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${sameAsHome ? 'opacity-60 pointer-events-none select-none' : ''}`}>
              <Input label="House number" value={ship.houseNumber || ''} onChange={onShip('houseNumber')} required disabled={sameAsHome} />
              <Input label="Street name" value={ship.streetName || ''} onChange={onShip('streetName')} required disabled={sameAsHome} />
            </div>

            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${sameAsHome ? 'opacity-60 pointer-events-none select-none' : ''}`}>
              <Input label="City" value={ship.city || ''} onChange={onShip('city')} required disabled={sameAsHome} />
              <Input label="State" value={ship.state || ''} onChange={onShip('state')} required disabled={sameAsHome} />
            </div>

            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${sameAsHome ? 'opacity-60 pointer-events-none select-none' : ''}`}>
              <Input label="Post code" value={ship.postCode || ''} onChange={onShip('postCode')} disabled={sameAsHome} />
              <Input label="Country" value={ship.country || ''} onChange={onShip('country')} required disabled={sameAsHome} />
            </div>
          </div>
        </section>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={saveAddresses}
            disabled={savingAddr}
            className="rounded-md border bg-accent-500 px-4 py-2 text-white hover:bg-accent-600 transition disabled:opacity-50"
          >
            {savingAddr ? 'Saving…' : 'Save addresses'}
          </button>
        </div>
      </div>
    </SiteLayout>
  );
}

/* ---------------- Small input helper ---------------- */
function Input({
  label,
  value,
  onChange,
  disabled,
  required,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink">
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={`mt-1 w-full rounded-lg border border-border px-3 py-2.5 bg-surface placeholder:text-ink-soft
          focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition
          ${disabled ? 'bg-zinc-100 text-ink-soft cursor-not-allowed' : ''}`}
        placeholder={label}
      />
    </label>
  );
}
