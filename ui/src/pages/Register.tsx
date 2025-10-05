// src/pages/Register.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

type Role = 'SHOPPER';

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
    countryDial: '234',
    localPhone: '',
    password: '',
    confirmPassword: '',
    role: 'SHOPPER' as Role,
  });
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState(''); // optional
  const [lastName, setLastName] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();

  const onChange =
    (key: keyof typeof form) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setForm((f) => ({ ...f, [key]: e.target.value }));
      };
  const validate = () => {
    if (!firstName.trim()) return 'Please enter your first name';
    if (!lastName.trim()) return 'Please enter your last name';
    if (!form.email.trim()) return 'Please enter your email';
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return 'Please enter a valid email';

    // 👇 Password complexity: 8+ chars, at least one letter, one number, one special char
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

      await api.post('/api/auth/register', {
        email: form.email.trim().toLowerCase(),
        firstName,
        middleName: middleName || undefined, // optional
        lastName,
        phone,
        password: form.password,
        role: form.role,
        dialCode: form.countryDial,
        localPhone: form.localPhone
      });

      nav('/verify', { replace: true });
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[80vh] w-full grid place-items-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-xl mx-auto space-y-5 text-center border rounded-2xl p-6 shadow-sm"
      >
        <h1 className="text-2xl font-semibold">Create your account</h1>

        {err && (
          <div className="text-sm text-red-600 border border-red-200 bg-red-50 p-2 rounded">
            {err}
          </div>
        )}

        {/* Name fields */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          <div className="space-y-1">
            <label className="block text-sm">First name</label>
            <input
              value={firstName}
              onChange={(e)=>setFirstName(e.target.value)}
              className="border p-2 w-full rounded"
              placeholder="Jane"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm">
              Middle name <span className="opacity-60">(optional)</span>
            </label>
            <input
              value={middleName}
              onChange={(e)=>setMiddleName(e.target.value)}
              className="border p-2 w-full rounded"
              placeholder="A."
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm">Last name</label>
            <input
              value={lastName}onChange={(e)=>setLastName(e.target.value)}
              className="border p-2 w-full rounded"
              placeholder="Doe"
            />
          </div>
        </div>

        {/* Email */}
        <div className="space-y-1 text-left">
          <label className="block text-sm">Email</label>
          <input
            value={form.email}
            onChange={onChange('email')}
            type="email"
            placeholder="you@example.com"
            className="border p-2 w-full rounded"
          />
        </div>

        {/* Phone */}
        <div className="space-y-1 text-left">
          <label className="block text-sm">
            Phone
          </label>
          <div className="flex gap-2">
            <select
              value={form.countryDial}
              onChange={onChange('countryDial')}
              className="border p-2 rounded bg-white w-44"
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
              className="border p-2 rounded flex-1"
            />
          </div>
          <p className="text-xs opacity-70 text-center">
            We’ll format this as +{form.countryDial}{' '}
            {form.localPhone.replace(/\D/g, '')}
          </p>
        </div>

        {/* Password + Confirm */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
          <div className="space-y-1">
            <label className="block text-sm">Password</label>
            <input
              value={form.password}
              onChange={onChange('password')}
              type="password"
              placeholder="At least 8 characters"
              className="border p-2 w-full rounded"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm">Confirm password</label>
            <input
              value={form.confirmPassword}
              onChange={onChange('confirmPassword')}
              type="password"
              placeholder="Re-enter password"
              className="border p-2 w-full rounded"
            />
          </div>
        </div>

        {/* Role (disabled) */}
        <div className="space-y-1 text-left">
          <label className="block text-sm">Role</label>
          <input
            value="SHOPPER"
            disabled
            className="border p-2 w-full rounded bg-gray-100 text-gray-700"
            title="Role is fixed for self-registration"
          />
          <p className="text-xs opacity-70 text-center">
            Supplier/Admin roles are assigned by an administrator later.
          </p>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="border px-5 py-2 rounded disabled:opacity-50"
        >
          {submitting ? 'Creating account…' : 'Register'}
        </button>
      </form>
    </div>
  );
}
