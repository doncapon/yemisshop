// src/pages/ForgotPassword.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import SiteLayout from '../layouts/SiteLayout';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isValidEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setErr(null);

    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return setErr('Please enter your email');
    if (!isValidEmail(trimmed)) return setErr('Please enter a valid email address');

    try {
      setLoading(true);
      await api.post('/api/auth/forgot-password', { email: trimmed });
      setMsg('If this email exists, we’ve sent a reset link. Please check your inbox (and spam).');
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Could not send reset email');
    } finally {
      setLoading(false);
    }
  };

  const disabled = loading || !email.trim() || !isValidEmail(email);

  return (
    <SiteLayout>
      <div className="min-h-[88vh] bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -left-24 size-64 rounded-full bg-primary-400/20 blur-3xl animate-pulse" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 size-72 rounded-full bg-accent-400/20 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />

        <div className="max-w-screen-sm mx-auto px-4 md:px-6 py-10">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-600 to-accent-600 text-white px-3 py-1 text-[11px] font-semibold shadow-sm">
              <span className="inline-block size-1.5 rounded-full bg-white/90" />
              Account recovery
            </span>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-ink">Forgot your password?</h1>
            <p className="mt-1 text-sm text-ink-soft">Enter the email linked to your account and we’ll send a secure reset link.</p>
          </div>

          <form onSubmit={submit} noValidate className="mt-6 rounded-2xl border border-white/60 bg-white/70 backdrop-blur shadow-[0_6px_30px_rgba(0,0,0,0.06)] p-6 md:p-8 space-y-5 transition hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
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
              <label htmlFor="email" className="block text-sm font-medium text-ink mb-1">Email address</label>
              <div className="relative group">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 6h16a1 1 0 0 1 1 1v.2l-9 6-9-6V7a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M21 8.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5l9 6 9-6Z" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </span>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={`w-full rounded-xl border bg-surface pl-10 pr-3 py-3 text-ink placeholder:text-ink-soft transition
                            focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400
                            ${email && !isValidEmail(email) ? 'border-danger' : 'border-border'} group-hover:shadow-sm`}
                  aria-invalid={!!email && !isValidEmail(email)}
                  aria-describedby="email-help"
                />
              </div>
              <p id="email-help" className="mt-1 text-xs text-ink-soft">We’ll email you a reset link if the address is registered.</p>
            </div>

            <button
              type="submit"
              disabled={disabled}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary-600 to-accent-600 text-white px-4 py-3 font-semibold shadow-sm hover:shadow-md hover:from-primary-600/95 hover:to-accent-600/95 active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-primary-200 transition disabled:opacity-50"
            >
              {loading ? (
                <>
                  <span className="inline-block size-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Sending reset link…
                </>
              ) : (
                <>Send reset link</>
              )}
            </button>

            <div className="pt-1 text-center text-sm text-ink-soft">
              Remembered your password? <Link to="/login" className="font-medium text-primary-700 hover:underline">Sign in</Link>. New here?{' '}
              <Link to="/register" className="font-medium text-primary-700 hover:underline">Create an account</Link>.
            </div>
          </form>

          <p className="mt-4 text-center text-xs text-ink-soft">
            By requesting a reset, you agree to our <a className="text-primary-700 hover:underline" href="/terms">Terms</a> and <a className="text-primary-700 hover:underline" href="/privacy">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </SiteLayout>
  );
}
