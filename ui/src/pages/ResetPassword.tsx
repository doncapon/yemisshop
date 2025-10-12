// src/pages/ResetPassword.tsx
import { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import api from '../api/client';

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
  useEffect(() => {
    if (!token) nav('/forgot-password', { replace: true });
  }, [token, nav]);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const checks = useMemo(() => validPassword(password), [password]);
  const passwordsMatch = confirm.length > 0 ? password === confirm : true;

  const disabled =
    loading ||
    !token ||
    !password ||
    !confirm ||
    !checks.ok ||
    !passwordsMatch;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    if (!token) return setErr('Invalid or missing token.');
    if (!checks.ok) {
      return setErr('Password must be at least 8 characters and include a letter, a number, and a special character.');
    }
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

  const row = (
    ok: boolean,
    label: string
  ) => (
    <li className={`flex items-center gap-2 text-xs ${ok ? 'text-emerald-700' : 'text-ink-soft'}`}>
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-600' : 'bg-zinc-300'}`}
        aria-hidden
      />
      {label}
    </li>
  );

  return (
    <div className="min-h-[88vh] bg-hero-radial bg-bg-soft grid place-items-center px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-100 text-primary-700 px-3 py-1 text-xs font-medium border border-primary-200">
            Secure reset
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-ink">Reset your password</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Choose a strong password you haven’t used before.
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={submit}
          className="rounded-2xl border bg-white shadow-sm p-6 md:p-8 space-y-5"
          noValidate
        >
          {/* Alerts */}
          {!token && (
            <div
              role="alert"
              className="text-sm rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2"
            >
              The reset link is missing or invalid. Please request a new one from{' '}
              <Link to="/forgot-password" className="underline">
                Forgot Password
              </Link>
              .
            </div>
          )}

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

          {/* New password */}
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-ink mb-1">
              New password
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={showPwd ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className={`w-full rounded-lg border bg-surface px-3 py-2.5 text-ink placeholder:text-ink-soft transition
                            focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400
                            ${password && !checks.ok ? 'border-danger' : 'border-border'}`}
                aria-invalid={!!password && !checks.ok}
                aria-describedby="pwd-help"
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded border bg-white hover:bg-black/5 transition"
                aria-label={showPwd ? 'Hide password' : 'Show password'}
              >
                {showPwd ? 'Hide' : 'Show'}
              </button>
            </div>
            <ul id="pwd-help" className="mt-2 space-y-1">
              {row(checks.hasMinLen, 'At least 8 characters')}
              {row(checks.hasLetter, 'Contains a letter')}
              {row(checks.hasNumber, 'Contains a number')}
              {row(checks.hasSpecial, 'Contains a special character')}
            </ul>
          </div>

          {/* Confirm password */}
          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-ink mb-1">
              Confirm new password
            </label>
            <div className="relative">
              <input
                id="confirm-password"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter new password"
                className={`w-full rounded-lg border bg-surface px-3 py-2.5 text-ink placeholder:text-ink-soft transition
                            focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400
                            ${confirm && !passwordsMatch ? 'border-danger' : 'border-border'}`}
                aria-invalid={!!confirm && !passwordsMatch}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded border bg-white hover:bg-black/5 transition"
                aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
              >
                {showConfirm ? 'Hide' : 'Show'}
              </button>
            </div>
            {!!confirm && !passwordsMatch && (
              <p className="mt-1 text-xs text-danger">Passwords do not match.</p>
            )}
          </div>

          {/* Action */}
          <button
            type="submit"
            disabled={disabled}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 text-white
                       px-4 py-2.5 font-medium hover:bg-primary-700 active:bg-primary-800
                       focus:outline-none focus:ring-4 focus:ring-primary-200 transition disabled:opacity-50"
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>

          <div className="pt-1 text-center text-sm text-ink-soft">
            Don’t have a reset link?{' '}
            <Link to="/forgot-password" className="text-primary-700 hover:underline">
              Request a new one
            </Link>
            .
          </div>
        </form>

        {/* Bottom hint */}
        <p className="mt-4 text-center text-xs text-ink-soft">
          By resetting your password, you agree to our{' '}
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
