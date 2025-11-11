// src/pages/ResetPassword.tsx
import { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import SiteLayout from '../layouts/SiteLayout';

function validPassword(pwd: string) {
  const hasMinLen = pwd.length >= 8;
  const hasLetter = /[A-Za-z]/.test(pwd);
  const hasNumber = /\d/.test(pwd);
  const hasSpecial = /[^A-Za-z0-9]/.test(pwd);
  return { hasMinLen, hasLetter, hasNumber, hasSpecial, ok: hasMinLen && hasLetter && hasNumber && hasSpecial };
}

export default function ResetPassword() {
  const nav = useNavigate();
  const token = new URLSearchParams(useLocation().search).get('token') || '';
  useEffect(() => { if (!token) nav('/forgot-password', { replace: true }); }, [token, nav]);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const checks = useMemo(() => validPassword(password), [password]);
  const passwordsMatch = confirm.length > 0 ? password === confirm : true;

  const strength = (checks.hasMinLen ? 1 : 0) + (checks.hasLetter ? 1 : 0) + (checks.hasNumber ? 1 : 0) + (checks.hasSpecial ? 1 : 0);
  const strengthLabel = ['Too weak', 'Weak', 'Okay', 'Strong', 'Very strong'][strength] || 'Too weak';

  const disabled = loading || !token || !password || !confirm || !checks.ok || !passwordsMatch;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    if (!token) return setErr('Invalid or missing token.');
    if (!checks.ok) return setErr('Password must be at least 8 characters and include a letter, a number, and a special character.');
    if (password !== confirm) return setErr('Passwords do not match');

    try {
      setLoading(true);
      await api.post('/api/auth/reset-password', { token, password });
      setMsg('Password updated. Redirecting to sign in…');
      setTimeout(() => nav('/login'), 1200);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  const row = (ok: boolean, label: string) => (
    <li className={`flex items-center gap-2 text-xs ${ok ? 'text-emerald-700' : 'text-ink-soft'}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-600' : 'bg-zinc-300'}`} aria-hidden />
      {label}
    </li>
  );

  return (
    <SiteLayout>
      <div className="min-h-[88vh] bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft relative overflow-hidden">
        <div className="pointer-events-none absolute -top-28 -left-20 size-72 rounded-full bg-primary-500/20 blur-3xl animate-pulse" />
        <div className="pointer-events-none absolute -bottom-28 -right-24 size-80 rounded-full bg-fuchsia-400/20 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />

        <div className="w-full max-w-md mx-auto px-4 md:px-6 py-10">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-3 py-1 text-[11px] font-semibold shadow-sm">
              <span className="inline-block size-1.5 rounded-full bg-white/90" />
              Secure reset
            </span>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-ink">Reset your password</h1>
            <p className="mt-1 text-sm text-ink-soft">Choose a strong password you haven’t used before.</p>
          </div>

          <form onSubmit={submit} noValidate className="mt-6 rounded-2xl border border-white/60 bg-white/70 backdrop-blur shadow-[0_6px_30px_rgba(0,0,0,0.06)] p-6 md:p-8 space-y-5 transition hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
            {!token && (
              <div role="alert" className="text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">
                The reset link is missing or invalid. Please request a new one from <Link to="/forgot-password" className="underline">Forgot Password</Link>.
              </div>
            )}
            {msg && (
              <div role="status" className="text-sm rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-2 animate-[fadeIn_.3s_ease]">
                {msg}
              </div>
            )}
            {err && (
              <div role="alert" className="text-sm rounded-lg border border-danger/20 bg-danger/10 text-danger px-3 py-2 animate-[fadeIn_.3s_ease]">
                {err}
              </div>
            )}

            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-ink mb-1">New password</label>
              <div className="relative group">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M7 10V8a5 5 0 0 1 10 0v2" stroke="currentColor" strokeWidth="1.5" />
                    <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </span>
                <input
                  id="new-password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className={`w-full rounded-xl border bg-surface pl-10 pr-10 py-3 text-ink placeholder:text-ink-soft transition
                            focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400
                            ${password && !checks.ok ? 'border-danger' : 'border-border'} group-hover:shadow-sm`}
                  aria-invalid={!!password && !checks.ok}
                  aria-describedby="pwd-help"
                />
                <button type="button" onClick={() => setShowPwd((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border bg-white px-2 py-1 text-xs hover:bg-black/5 transition">
                  {showPwd ? 'Hide' : 'Show'}
                </button>
              </div>

              <div className="mt-2">
                <div className="h-2 rounded-full bg-zinc-200 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-300 ${strength <= 1 ? 'bg-rose-500' : strength === 2 ? 'bg-amber-500' : strength === 3 ? 'bg-emerald-500' : 'bg-primary-600'}`} style={{ width: `${(strength / 4) * 100}%` }} />
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="text-ink-soft">Strength:</span>
                  <span className={`font-medium ${strength <= 1 ? 'text-rose-600' : strength === 2 ? 'text-amber-600' : strength === 3 ? 'text-emerald-600' : 'text-primary-700'}`}>{strengthLabel}</span>
                </div>
              </div>

              <ul id="pwd-help" className="mt-2 space-y-1">
                {row(checks.hasMinLen, 'At least 8 characters')}
                {row(checks.hasLetter, 'Contains a letter')}
                {row(checks.hasNumber, 'Contains a number')}
                {row(checks.hasSpecial, 'Contains a special character')}
              </ul>
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-ink mb-1">Confirm new password</label>
              <div className="relative group">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter new password"
                  className={`w-full rounded-xl border bg-surface pl-10 pr-10 py-3 text-ink placeholder:text-ink-soft transition
                            focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400
                            ${confirm && !passwordsMatch ? 'border-danger' : 'border-border'} group-hover:shadow-sm`}
                  aria-invalid={!!confirm && !passwordsMatch}
                />
                <button type="button" onClick={() => setShowConfirm((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border bg-white px-2 py-1 text-xs hover:bg-black/5 transition">
                  {showConfirm ? 'Hide' : 'Show'}
                </button>
              </div>
              {!!confirm && !passwordsMatch && <p className="mt-1 text-xs text-danger">Passwords do not match.</p>}
            </div>

            <button
              type="submit"
              disabled={disabled}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-4 py-3 font-semibold shadow-sm hover:shadow-md hover:from-primary-600/95 hover:to-fuchsia-600/95 active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-primary-200 transition disabled:opacity-50"
            >
              {loading ? (
                <>
                  <span className="inline-block size-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Updating…
                </>
              ) : (
                <>Update password</>
              )}
            </button>

            <div className="pt-1 text-center text-sm text-ink-soft">
              Don’t have a reset link? <Link to="/forgot-password" className="font-medium text-primary-700 hover:underline">Request a new one</Link>.
            </div>
          </form>

          <p className="mt-4 text-center text-xs text-ink-soft">
            By resetting your password, you agree to our <a className="text-primary-700 hover:underline" href="/terms">Terms</a> and <a className="text-primary-700 hover:underline" href="/privacy">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </SiteLayout>
  );
}
