// src/pages/ForgotPassword.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

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
    <div className="min-h-[88vh] bg-hero-radial bg-bg-soft grid place-items-center px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-100 text-primary-700 px-3 py-1 text-xs font-medium border border-primary-200">
            Account recovery
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-ink">Forgot your password?</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Enter the email linked to your account. We’ll send you a secure link to reset it.
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={submit}
          className="rounded-2xl border bg-white shadow-sm p-6 md:p-8 space-y-5"
          noValidate
        >
          {/* Alerts */}
          {msg && (
            <div
              role="status"
              className="text-sm rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-2"
            >
              {msg}
            </div>
          )}
          {err && (
            <div
              role="alert"
              className="text-sm rounded-md border border-danger/20 bg-danger/10 text-danger px-3 py-2"
            >
              {err}
            </div>
          )}

          {/* Email */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-ink mb-1">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={`w-full rounded-lg border bg-surface px-3 py-2.5 text-ink placeholder:text-ink-soft transition
                          focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400
                          ${email && !isValidEmail(email) ? 'border-danger' : 'border-border'}`}
              aria-invalid={!!email && !isValidEmail(email)}
              aria-describedby="email-help"
            />
            <p id="email-help" className="mt-1 text-xs text-ink-soft">
              We’ll send a reset link if this email is registered.
            </p>
          </div>

          {/* Actions */}
          <button
            type="submit"
            disabled={disabled}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 text-white
                       px-4 py-2.5 font-medium hover:bg-primary-700 active:bg-primary-800
                       focus:outline-none focus:ring-4 focus:ring-primary-200 transition disabled:opacity-50"
          >
            {loading ? 'Sending reset link…' : 'Send reset link'}
          </button>

          {/* Secondary links */}
          <div className="pt-1 text-center text-sm text-ink-soft">
            Remembered your password?{' '}
            <Link to="/login" className="text-primary-700 hover:underline">
              Sign in
            </Link>
            . New here?{' '}
            <Link to="/register" className="text-primary-700 hover:underline">
              Create an account
            </Link>
            .
          </div>
        </form>

        {/* Bottom hint */}
        <p className="mt-4 text-center text-xs text-ink-soft">
          By requesting a reset, you agree to our{' '}
          <a className="text-primary-700 hover:underline" href="/terms">
            Terms
          </a>{' '}
          and{' '}
          <a className="text-primary-700 hover:underline" href="/privacy">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}
