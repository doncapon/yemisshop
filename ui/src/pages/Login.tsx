// src/pages/Login.tsx
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

type MeResponse = {
  id: string;
  email: string;
  role: 'ADMIN' | 'SUPPLIER' | 'SHOPPER';  
  firstName?: string | null;
  lastName?: string | null;    
  emailVerified: boolean;
  phoneVerified: boolean;
};

export default function Login() {
  const [email, setEmail] = useState('shopper@example.com');
  const [password, setPassword] = useState('Shopper123!');
  const [err, setErr] = useState<string | null>(null);

  // shown only when not-verified
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [cooldown, setCooldown] = useState(0); // seconds for OTP resend

  const nav = useNavigate();
  const loc = useLocation() as any;
  const setAuth = useAuthStore((s) => s.setAuth);
  const setToken = useAuthStore((s) => s.setToken);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);


  const submit = async (e: React.FormEvent) => {
  e.preventDefault();
  setErr(null);
  setPendingToken(null);
  setMe(null);

  try {
    // 1) Login -> token + profile (role included)
    const res = await api.post('/api/auth/login', { email, password });
    const { token, profile } = res.data as {
      token: string;
      profile: {id: string;  role: 'ADMIN' | 'SUPPLIER' | 'SHOPPER'; email: string; emailVerified: boolean; phoneVerified: boolean; }
    };

    // 2) Save token+role right away (no race)
    setAuth(token, profile.role, profile.email);

    // 3) If fully verified -> go to intended page (or role-specific default)
    if (profile.emailVerified && profile.phoneVerified) {
      const wanted =
        (loc.state as any)?.from?.pathname ||
        (profile.role === 'ADMIN' ? '/admin'
         : profile.role === 'SUPPLIER' ? '/supplier'
         : '/dashboard');
      nav(wanted, { replace: true });
      return;
    }

    // 4) Not fully verified? Show the verification panel
    setPendingToken(token);
    setMe(profile);
  } catch (e: any) {
    setToken(null); // clear any partial state
    setErr(e?.response?.data?.error || 'Login failed');
  }
};


  const resendEmail = async () => {
    if (!pendingToken) return;
    try {
      await api.post(
        '/api/auth/resend-email',
        {},
        { headers: { Authorization: `Bearer ${pendingToken}` } },
      );
      setErr('Verification email sent.');
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed to resend email');
    }
  };

  const resendOtp = async () => {
    if (!pendingToken) return;
    try {
      const { data } = await api.post(
        '/api/auth/resend-otp',
        {},
        { headers: { Authorization: `Bearer ${pendingToken}` } },
      );
      setErr('OTP sent to your phone.');
      setCooldown(data?.nextResendAfterSec ?? 60);
    } catch (e: any) {
      const retryAfter = e?.response?.data?.retryAfterSec;
      if (retryAfter) setCooldown(retryAfter);
      setErr(e?.response?.data?.error || 'Failed to resend OTP');
    }
  };

  // ======= STYLED VERIFY PANEL (if not verified) =======
  if (pendingToken && me && (!me.emailVerified || !me.phoneVerified)) {
    return (
      <div className="min-h-[88vh] bg-gradient-to-b from-primary-50 to-surface-soft grid place-items-center px-4">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border p-6">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full grid place-items-center bg-primary-100 text-primary-700 font-semibold">
              ✓
            </div>
            <h1 className="text-xl font-semibold">Verify your account</h1>
          </div>

          {err && (
            <p className="mt-4 text-sm p-3 rounded-md border border-warning/20 bg-warning/10 text-warning">
              {err}
            </p>
          )}

          {!me.emailVerified && (
            <div className="mt-6 space-y-2">
              <p className="text-sm text-ink-soft">
                We sent a verification link to <b className="text-ink">{me.email}</b>. Please click that link.
              </p>
              <button
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-black/5"
                onClick={resendEmail}
              >
                Resend verification email
              </button>
            </div>
          )}

          {!me.phoneVerified && (
            <div className="mt-6 space-y-2">
              <p className="text-sm text-ink-soft">
                We also sent an OTP to your phone (if provided).
              </p>
              <button
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50"
                onClick={resendOtp}
                disabled={cooldown > 0}
                title={cooldown > 0 ? `Retry in ${cooldown}s` : 'Resend OTP'}
              >
                {cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
              </button>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between">
            <p className="text-xs text-ink-soft">
              Once both verifications are complete, please log in again.
            </p>
            <button
              className="text-sm underline"
              onClick={() => {
                setPendingToken(null);
                setMe(null);
              }}
            >
              Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ======= STYLED LOGIN CARD =======
  return (
    <div className="min-h-[88vh] bg-hero-radial bg-bg-soft grid place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-100 text-primary-700 px-3 py-1 text-xs font-medium border border-primary-200">
            Welcome back
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-ink">
            Sign in to your account
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Access your cart, orders and personalised dashboard.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border bg-white shadow-sm p-6 space-y-4"
        >
          {err && (
            <div className="text-sm rounded-md border border-danger/20 bg-danger/10 text-danger px-3 py-2">
              {err}
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-sm font-medium text-ink">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-ink placeholder:text-ink-soft
                         focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-ink">Password</label>
              <a className="text-xs text-primary-700 hover:underline" href="/forgot-password">
                Forgot password?
              </a>
            </div>
            <input
              value={password}
              type="password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-ink placeholder:text-ink-soft
                         focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition"
            />
          </div>

          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 text-white
                       px-4 py-2.5 font-medium hover:bg-primary-700 active:bg-primary-800
                       focus:outline-none focus:ring-4 focus:ring-primary-200 transition"
          >
            Login
          </button>

          <div className="pt-2 text-center text-sm text-ink-soft">
            Don’t have an account?{' '}
            <a className="text-primary-700 hover:underline" href="/register">
              Create one
            </a>
          </div>
        </form>

        {/* Subtle footer note */}
        <p className="mt-4 text-center text-xs text-ink-soft">
          Secured by industry-standard encryption • Need help?{' '}
          <a className="text-primary-700 hover:underline" href="/support">
            Contact support
          </a>
        </p>
      </div>
    </div>
  );
}
