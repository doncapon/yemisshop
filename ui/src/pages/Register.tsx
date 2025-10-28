import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

type Role = 'SHOPPER';
type RegisterResponse = {
  message: string;
  tempToken?: string;    // optional short-lived token for verify flows
  phoneOtpSent?: boolean;
};

type Country = { name: string; code: string; dial: string };
const COUNTRIES: Country[] = [
  { name: 'Nigeria', code: 'NG', dial: '234' },
  { name: 'United States', code: 'US', dial: '1' },
  { name: 'United Kingdom', code: 'GB', dial: '44' },
  { name: 'Canada', code: 'CA', dial: '1' },
  { name: 'Ghana', code: 'GH', dial: '233' },
  { name: 'Kenya', code: 'KE', dial: '254' },
  { name: 'South Africa', code: 'ZA', dial: '27' },
  { name: 'India', code: 'IN', dial: '91' },
  { name: 'Ireland', code: 'IE', dial: '353' },
  { name: 'Germany', code: 'DE', dial: '49' },
  { name: 'France', code: 'FR', dial: '33' },
  { name: 'Finland', code: 'FI', dial: '358' },
  { name: 'Spain', code: 'ES', dial: '34' },
  { name: 'Italy', code: 'IT', dial: '39' },
  { name: 'Netherlands', code: 'NL', dial: '31' },
  { name: 'Sweden', code: 'SE', dial: '46' },
  { name: 'Norway', code: 'NO', dial: '47' },
  { name: 'Denmark', code: 'DK', dial: '45' },
  { name: 'Switzerland', code: 'CH', dial: '41' },
  { name: 'Brazil', code: 'BR', dial: '55' },
  { name: 'Mexico', code: 'MX', dial: '52' },
  { name: 'Australia', code: 'AU', dial: '61' },
  { name: 'New Zealand', code: 'NZ', dial: '64' },
  { name: 'UAE', code: 'AE', dial: '971' },
  { name: 'Saudi Arabia', code: 'SA', dial: '966' },
  { name: 'Turkey', code: 'TR', dial: '90' },
  { name: 'Egypt', code: 'EG', dial: '20' },
  { name: 'Morocco', code: 'MA', dial: '212' },
  { name: 'Côte d’Ivoire', code: 'CI', dial: '225' },
  { name: 'Cameroon', code: 'CM', dial: '237' },
  { name: 'Ethiopia', code: 'ET', dial: '251' },
];

export default function Register() {
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    middleName: '',
    lastName: '',
    countryDial: '234',
    localPhone: '',
    password: '',
    confirmPassword: '',
    role: 'SHOPPER' as Role,
    dateOfBirth: '', // YYYY-MM-DD
  });

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();

  const onChange =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
    };

  // Enforce YYYY length on the fly
  const onDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value;
    if (v) {
      const parts = v.split('-');
      if (parts[0]) {
        parts[0] = parts[0].replace(/\D/g, '');
        if (parts[0].length > 4) parts[0] = parts[0].slice(0, 4);
      }
      v = parts.filter((p) => p !== undefined).join('-');
    }
    setForm((f) => ({ ...f, dateOfBirth: v }));
  };

  const validate = () => {
    if (!form.firstName.trim()) return 'Please enter your first name';
    if (!form.lastName.trim()) return 'Please enter your last name';
    if (!form.email.trim()) return 'Please enter your email';
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return 'Please enter a valid email';

    const pwd = form.password ?? '';
    const hasMinLen = pwd.length >= 8;
    const hasLetter = /[A-Za-z]/.test(pwd);
    const hasNumber = /\d/.test(pwd);
    const hasSpecial = /[^A-Za-z0-9]/.test(pwd);
    if (!hasMinLen || !hasLetter || !hasNumber || !hasSpecial) {
      return 'Password must be at least 8 characters and include a letter, a number, and a special character.';
    }

    if (form.password !== form.confirmPassword) return 'Passwords do not match';

    const localDigits = form.localPhone.replace(/\D/g, '');
    if (localDigits && localDigits.length < 6) return 'Please enter a valid phone number';
    if (!COUNTRIES.some((c) => c.dial === form.countryDial)) return 'Please select a valid country code';

    if (!form.dateOfBirth) return 'Please select your date of birth';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth)) {
      return 'Please use a valid date (YYYY-MM-DD).';
    }
    const yearStr = form.dateOfBirth.slice(0, 4);
    if (!/^\d{4}$/.test(yearStr)) return 'Birth year must be exactly 4 digits.';

    const dob = new Date(form.dateOfBirth + 'T00:00:00');
    if (Number.isNaN(+dob)) return 'Please select a valid date of birth';

    const today = new Date();
    const years = (today.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years < 18) return 'You must be at least 18 years old to register';

    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    const v = validate();
    if (v) return setErr(v);

    try {
      setSubmitting(true);

      const phone =
        form.localPhone.trim()
          ? `+${form.countryDial}${form.localPhone.replace(/\D/g, '')}`
          : null;

      const payload = {
        email: form.email.trim().toLowerCase(),
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || undefined,
        lastName: form.lastName.trim(),
        phone,
        password: form.password,
        role: form.role,
        dialCode: form.countryDial,
        localPhone: form.localPhone,
        dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth).toISOString() : undefined,
      };

      const { data } = await api.post<RegisterResponse>('/api/auth/register', payload);

      // Stash things the verify page can use regardless of auth
      try {
        localStorage.setItem('verifyEmail', payload.email);
        if (data?.tempToken) localStorage.setItem('verifyToken', data.tempToken);
      } catch {}

      // Move them to the verify page. No need to pass the token; the page can use email-status.
      const q = new URLSearchParams({ e: payload.email }).toString();
      nav(`/verify?${q}`);
    } catch (e: any) {
      // Surface API error (409 Email already registered, etc.)
      setErr(e?.response?.data?.error || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Simple local strength hint (visual only; validation still enforced above)
  const pwdStrength = (() => {
    const val = form.password ?? '';
    let s = 0;
    if (val.length >= 8) s++;
    if (/[A-Z]/.test(val)) s++;
    if (/[a-z]/.test(val)) s++;
    if (/\d/.test(val)) s++;
    if (/[^A-Za-z0-9]/.test(val)) s++;
    return Math.min(s, 4); // 0..4
  })();

  return (
    <div className="min-h-[100dvh] relative overflow-hidden">
      {/* Neon gradient / grid backdrop to match Login */}
      <div className="absolute inset-0 bg-[radial-gradient(1200px_500px_at_10%_-10%,#a78bfa33,transparent_50%),radial-gradient(1000px_500px_at_90%_0%,#22d3ee33,transparent_50%),linear-gradient(180deg,#111827,#0b1220_40%)]" />
      <div className="pointer-events-none absolute -top-28 -right-20 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-40 bg-violet-500/40" />
      <div className="pointer-events-none absolute -bottom-28 -left-12 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-40 bg-cyan-400/40" />
      <div className="absolute inset-0 opacity-[0.06] [mask-image:radial-gradient(60%_60%_at_50%_40%,black,transparent)]">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="miniGridReg" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#miniGridReg)" />
        </svg>
      </div>

      {/* Content */}
      <div className="relative grid place-items-center min-h-[100dvh] px-4">
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="mb-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 text-white px-3 py-1 text-xs font-medium border border-white/30 backdrop-blur">
              <span className="inline-block size-2 rounded-full bg-emerald-400 animate-pulse" />
              Join DaySpring
            </div>
            <h1 className="mt-3 text-3xl font-semibold text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.3)]">
              Create your account
            </h1>
            <p className="mt-1 text-sm text-white/80">
              Shop smarter with saved addresses, order tracking, and personalised picks.
            </p>
          </div>

          {/* Card */}
          <form
            onSubmit={submit}
            className="rounded-2xl border border-white/30 bg-white/80 backdrop-blur-xl shadow-[0_10px_40px_-12px_rgba(59,130,246,0.35)] p-6 md:p-8 space-y-6 transition hover:shadow-[0_20px_60px_-12px_rgba(59,130,246,0.45)]"
          >
            {err && (
              <div className="text-sm rounded-md border border-rose-300/60 bg-rose-50/90 text-rose-700 px-3 py-2">
                {err}
              </div>
            )}

            {/* Name grid */}
            <div>
              <label className="block text-sm font-medium text-slate-800 mb-2">Your name</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="relative group">
                  <input
                    value={form.firstName}
                    onChange={onChange('firstName')}
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-3 placeholder:text-slate-400 text-slate-900
                               outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                    placeholder="First name"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-violet-500 transition">👤</span>
                </div>
                <div className="relative group">
                  <input
                    value={form.middleName}
                    onChange={onChange('middleName')}
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-3 placeholder:text-slate-400 text-slate-900
                               outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                    placeholder="Middle (optional)"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-violet-500 transition">👤</span>
                </div>
                <div className="relative group">
                  <input
                    value={form.lastName}
                    onChange={onChange('lastName')}
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-3 placeholder:text-slate-400 text-slate-900
                               outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                    placeholder="Last name"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-violet-500 transition">👤</span>
                </div>
              </div>
            </div>

            {/* Email & DOB */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="relative group">
                <label className="block text-sm font-medium text-slate-800 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={onChange('email')}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-3 text-slate-900 placeholder:text-slate-400
                             outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                />
                <span className="pointer-events-none absolute right-3 bottom-3 text-slate-400 group-focus-within:text-violet-500 transition">✉</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-800 mb-1">Date of birth</label>
                <input
                  type="date"
                  value={form.dateOfBirth}
                  onChange={onDateChange}
                  className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-3 text-slate-900
                             outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                />
                <p className="mt-1 text-xs text-slate-500">Must be 18+ years old.</p>
              </div>
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">Phone</label>
              <div className="flex gap-2">
                <div className="relative group">
                  <select
                    value={form.countryDial}
                    onChange={onChange('countryDial')}
                    className="rounded-xl border border-slate-300/80 bg-white px-3 py-3 w-44
                               outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                    aria-label="Country code"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.dial}>
                        {c.name} (+{c.dial})
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-violet-500 transition">🌍</span>
                </div>
                <div className="relative group flex-1">
                  <input
                    value={form.localPhone}
                    onChange={onChange('localPhone')}
                    inputMode="tel"
                    placeholder="Local number"
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-3 placeholder:text-slate-400 text-slate-900
                               outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-violet-500 transition">📱</span>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500 text-center">
                Will format as +{form.countryDial} {form.localPhone.replace(/\D/g, '')}
              </p>
            </div>

            {/* Passwords */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-800 mb-1">Password</label>
                <div className="relative group">
                  <input
                    type="password"
                    value={form.password}
                    onChange={onChange('password')}
                    placeholder="At least 8 characters"
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-3 text-slate-900 placeholder:text-slate-400
                               outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-violet-500 transition">🔒</span>
                </div>
                {/* Strength bar (visual hint) */}
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      pwdStrength <= 1
                        ? 'w-1/4 bg-rose-400'
                        : pwdStrength === 2
                        ? 'w-2/4 bg-amber-400'
                        : pwdStrength === 3
                        ? 'w-3/4 bg-lime-400'
                        : 'w-full bg-emerald-400'
                    }`}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Include a letter, number, and special character.
                </p>
              </div>
              <div>
                <label className="block text sm font-medium text-slate-800 mb-1">Confirm password</label>
                <div className="relative group">
                  <input
                    type="password"
                    value={form.confirmPassword}
                    onChange={onChange('confirmPassword')}
                    placeholder="Re-enter password"
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-3 text-slate-900 placeholder:text-slate-400
                               outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                  />
                  {(form.password === form.confirmPassword) && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-violet-500 transition">✅</span>}
                </div>
              </div>
            </div>

            {/* Actions */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 text-white
                         px-4 py-3 font-semibold shadow-[0_10px_30px_-12px_rgba(14,165,233,0.6)]
                         hover:scale-[1.01] active:scale-[0.995]
                         focus:outline-none focus:ring-4 focus:ring-cyan-300/40 transition disabled:opacity-50"
            >
              {submitting ? 'Creating account…' : 'Create account'}
              {!submitting && (
                <svg className="w-4 h-4 opacity-90" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M3 10a1 1 0 011-1h9.586L11.293 6.707a1 1 0 111.414-1.414l4.0 4a1 1 0 010 1.414l-4.0 4a1 1 0 11-1.414-1.414L13.586 11H4a1 1 0 01-1-1z" clipRule="evenodd" />
                </svg>
              )}
            </button>

            <p className="text-center text-xs text-slate-600">
              By creating an account, you agree to our{' '}
              <a className="text-violet-700 hover:underline" href="/terms">Terms</a> and{' '}
              <a className="text-violet-700 hover:underline" href="/privacy">Privacy Policy</a>.
            </p>
          </form>

          {/* Bottom hint */}
          <p className="mt-5 text-center text-sm text-white/80">
            Already have an account?{' '}
            <a className="text-cyan-200 hover:underline" href="/login">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
