// src/pages/Register.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

type Role = 'SHOPPER';
type RegisterResponse = {
  message: string;
  tempToken?: string;
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
    middleName: '', // optional
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

  // Specialized handler: enforce birth-year max 4 digits as user types
  const onDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value; // expect YYYY-MM-DD or ''
    if (v) {
      const parts = v.split('-');
      if (parts[0]) {
        parts[0] = parts[0].replace(/\D/g, ''); // digits only in year
        if (parts[0].length > 4) parts[0] = parts[0].slice(0, 4); // clamp to 4
      }
      // Recompose only the parts provided to avoid inserting "undefined"
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

    // DOB required + must be valid yyyy-mm-dd + birth year exactly 4 digits + >=18
    if (!form.dateOfBirth) return 'Please select your date of birth';

    // Must match exact "YYYY-MM-DD"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth)) {
      return 'Please use a valid date (YYYY-MM-DD).';
    }

    const yearStr = form.dateOfBirth.slice(0, 4);
    if (!/^\d{4}$/.test(yearStr)) {
      return 'Birth year must be exactly 4 digits.';
    }

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
        firstName: form.firstName,
        middleName: form.middleName || undefined,
        lastName: form.lastName,
        phone,
        password: form.password,
        role: form.role,
        dialCode: form.countryDial,
        localPhone: form.localPhone,
        dateOfBirth: form.dateOfBirth
          ? new Date(form.dateOfBirth).toISOString()
          : undefined,
      };

      const { data } = await api.post<RegisterResponse>('/api/auth/register', payload);

      if (data?.tempToken) {
        localStorage.setItem('verifyToken', data.tempToken);
      }

      const q = new URLSearchParams({ e: payload.email }).toString();
      nav(`/verify?${q}`);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[88vh] bg-hero-radial bg-bg-soft grid place-items-center px-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-100 text-primary-700 px-3 py-1 text-xs font-medium border border-primary-200">
            Join YemiShop
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-ink">Create your account</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Shop smarter with saved addresses, order tracking, and personalised picks.
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={submit}
          className="rounded-2xl border bg-white shadow-sm p-6 md:p-8 space-y-6"
        >
          {err && (
            <div className="text-sm rounded-md border border-danger/20 bg-danger/10 text-danger px-3 py-2">
              {err}
            </div>
          )}

          {/* Name grid */}
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Your name</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                value={form.firstName}
                onChange={onChange('firstName')}
                className="rounded-lg border border-border bg-surface px-3 py-2.5 placeholder:text-ink-soft
                           focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition"
                placeholder="First name"
              />
              <input
                value={form.middleName}
                onChange={onChange('middleName')}
                className="rounded-lg border border-border bg-surface px-3 py-2.5 placeholder:text-ink-soft
                           focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition"
                placeholder="Middle (optional)"
              />
              <input
                value={form.lastName}
                onChange={onChange('lastName')}
                className="rounded-lg border border-border bg-surface px-3 py-2.5 placeholder:text-ink-soft
                           focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition"
                placeholder="Last name"
              />
            </div>
          </div>

          {/* Email & DOB */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={onChange('email')}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-ink placeholder:text-ink-soft
                           focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Date of birth</label>
              <input
                type="date"
                value={form.dateOfBirth}
                onChange={onDateChange}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-ink
                           focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition"
              />
              <p className="mt-1 text-xs text-ink-soft">Must be 18+ years old.</p>
            </div>
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Phone</label>
            <div className="flex gap-2">
              <select
                value={form.countryDial}
                onChange={onChange('countryDial')}
                className="rounded-lg border border-border bg-white px-3 py-2.5 w-44
                           focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition"
                aria-label="Country code"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.dial}>
                    {c.name} (+{c.dial})
                  </option>
                ))}
              </select>
              <input
                value={form.localPhone}
                onChange={onChange('localPhone')}
                inputMode="tel"
                placeholder="Local number"
                className="flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 placeholder:text-ink-soft
                           focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition"
              />
            </div>
            <p className="mt-1 text-xs text-ink-soft text-center">
              Will format as +{form.countryDial} {form.localPhone.replace(/\D/g, '')}
            </p>
          </div>

          {/* Passwords */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={onChange('password')}
                placeholder="At least 8 characters"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-ink placeholder:text-ink-soft
                           focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition"
              />
              <p className="mt-1 text-[11px] text-ink-soft">
                Include a letter, number, and special character.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Confirm password</label>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={onChange('confirmPassword')}
                placeholder="Re-enter password"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-ink placeholder:text-ink-soft
                           focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-400 transition"
              />
            </div>
          </div>

          {/* Role (fixed) */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Role</label>
            <input
              value="SHOPPER"
              disabled
              className="w-full rounded-lg border border-border bg-zinc-100 text-ink-soft px-3 py-2.5"
              title="Role is fixed for self-registration"
            />
            <p className="mt-1 text-xs text-ink-soft">
              Supplier/Admin roles are assigned by an administrator later.
            </p>
          </div>

          {/* Actions */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 text-white
                       px-4 py-2.5 font-medium hover:bg-primary-700 active:bg-primary-800
                       focus:outline-none focus:ring-4 focus:ring-primary-200 transition disabled:opacity-50"
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>

          <p className="text-center text-xs text-ink-soft">
            By creating an account, you agree to our{' '}
            <a className="text-primary-700 hover:underline" href="/terms">Terms</a> and{' '}
            <a className="text-primary-700 hover:underline" href="/privacy">Privacy Policy</a>.
          </p>
        </form>

        {/* Bottom hint */}
        <p className="mt-4 text-center text-sm text-ink-soft">
          Already have an account?{' '}
          <a className="text-primary-700 hover:underline" href="/login">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
