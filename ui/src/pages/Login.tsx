// src/pages/Login.tsx
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

type Role = 'ADMIN' | 'SUPER_ADMIN' | 'SHOPPER';

type MeResponse = {
  id: string;
  email: string;
  role: Role;
  firstName?: string | null;
  lastName?: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
};

function nukeAuthStorage() {
  try { useAuthStore.getState().clear?.(); } catch {}
  try {
    const persist = useAuthStore.persist;
    const name = persist?.getOptions?.().name || 'auth';
    if (name) localStorage.removeItem(name);
  } catch {}
  try {
    localStorage.removeItem('verifyToken');
    localStorage.removeItem('verifyEmail');
  } catch {}
}

export default function Login() {
  const [email, setEmail] = useState('superadmin@example.com');           // put your seeded email here temporarily to test
  const [password, setPassword] = useState('SuperAdmin123!');     // put your seeded password here temporarily to test
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const nav = useNavigate();
  const loc = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);
  const clear = useAuthStore((s) => s.clear);

  // Optional: remove if unused
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    if (!email.trim() || !password.trim()) {
      setErr('Email and password are required');
      return;
    }

    setLoading(true);

    try {
      // Do NOT clear storage before we know login succeeds.
      // Only clear if you really need a fresh session on success.
      const res = await api.post('/api/auth/login', { email, password });

      const { token, profile, needsVerification } = res.data as {
        token: string;
        profile: MeResponse;
        needsVerification?: boolean;
      };

      // Store auth
      setAuth({ token, user: profile });
      useAuthStore.getState().setNeedsVerification?.(!!needsVerification);

      // Useful for VerifyEmail page (non-blocking)
      try {
        localStorage.setItem('verifyEmail', profile.email);
        if (needsVerification) localStorage.setItem('verifyToken', token);
      } catch {}

      const from = (loc.state as any)?.from?.pathname as string | undefined;
      const defaultByRole: Record<Role, string> = {
        ADMIN: '/admin',
        SUPER_ADMIN: '/admin',
        SHOPPER: '/dashboard',
      };

      nav(from || defaultByRole[profile.role] || '/', { replace: true });
    } catch (e: any) {
      // Show server-provided message if present; fallback to a generic one.
      const msg =
        e?.response?.data?.error ||
        (e?.response?.status === 401 ? 'Invalid email or password' : null) ||
        'Login failed';
      setErr(msg);

      // Be sure we don't keep a half-broken session around:
      clear();
      try {
        // If you insist on nuking any persisted auth on failed login:
        const persist = useAuthStore.persist;
        const name = persist?.getOptions?.().name || 'auth';
        if (name) localStorage.removeItem(name);
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] relative overflow-hidden">
      {/* backdrop */}
      <div className="absolute inset-0 bg-[radial-gradient(1600px_1600px_at_50%_-10%,#a78bfa33,transparent_50%),radial-gradient(5000px_500px_at_90%_0%,#22d3ee33,transparent_50%),linear-gradient(180deg,#111827,#0b1220_40%)]" />
      <div className="pointer-events-none absolute -top-28 -right-20 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-40 bg-violet-300/40" />
      <div className="pointer-events-none absolute -bottom-28 -left-12 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-40 bg-cyan-300/40" />

      <div className="relative grid place-items-center min-h-[100dvh] px-4">
        <div className="w-full max-w-md">
          {/* header */}
          <div className="mb-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 text-white px-3 py-1 text-xs font-medium border border-white/30 backdrop-blur">
              <span className="inline-block size-2 rounded-full bg-emerald-400 animate-pulse" />
              Welcome back
            </div>
            <h1 className="mt-3 text-3xl font-semibold text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.3)]">
              Sign in to your account
            </h1>
            <p className="mt-1 text-sm text-white/80">
              Access your cart, orders and personalised dashboard.
            </p>
          </div>

          {/* card */}
          <form
            onSubmit={submit}
            className="rounded-2xl border border-white/30 bg-white/80 backdrop-blur-xl shadow-[0_10px_40px_-12px_rgba(59,130,246,0.35)] p-6 space-y-5"
          >
            {err && (
              <div className="text-sm rounded-md border border-rose-300/60 bg-rose-50/90 text-rose-700 px-3 py-2">
                {err}
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-sm font-medium text-slate-800">Email</label>
              <div className="relative group">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="username"
                  className="peer w-full rounded-xl border border-slate-300/80 bg-white px-3 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-violet-500 transition">
                  ✉
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-slate-800">Password</label>
                <a className="text-xs text-violet-700 hover:underline" href="/forgot-password">
                  Forgot password?
                </a>
              </div>
              <div className="relative group">
                <input
                  value={password}
                  type="password"
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="peer w-full rounded-xl border border-slate-300/80 bg-white px-3 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-violet-500 transition">
                  🔒
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 text-white px-4 py-3 font-semibold shadow-[0_10px_30px_-12px_rgba(14,165,233,0.6)] hover:scale-[1.01] active:scale-[0.995] focus:outline-none focus:ring-4 focus:ring-cyan-300/40 transition disabled:opacity-50"
            >
              {loading ? 'Logging in…' : 'Login'}
              {!loading && (
                <svg className="w-4 h-4 opacity-90" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M3 10a1 1 0 011-1h9.586L11.293 6.707a1 1 0 111.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 11-1.414-1.414L13.586 11H4a1 1 0 01-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>

            <div className="pt-1 text-center text-sm text-slate-700">
              Don’t have an account?{' '}
              <a className="text-violet-700 hover:underline" href="/register">
                Create one
              </a>
            </div>
          </form>

          <p className="mt-5 text-center text-xs text-white/80">
            Secured by industry-standard encryption • Need help?{' '}
            <a className="text-cyan-200 hover:underline" href="/support">
              Contact support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
