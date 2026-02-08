// src/pages/SupplierRegister.tsx
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import SiteLayout from '../../layouts/SiteLayout';

type SupplierRole = 'SUPPLIER';

type CacCompanyType =
  | 'BUSINESS_NAME'
  | 'COMPANY'
  | 'INCORPORATED_TRUSTEES'
  | 'LIMITED_PARTNERSHIP'
  | 'LIMITED_LIABILITY_PARTNERSHIP';

type CacEntity = {
  company_name: string;
  rc_number: string;
  address?: string | null;
  state?: string | null;
  city?: string | null;
  lga?: string | null;
  email?: string | null;
  type_of_company: CacCompanyType;
  date_of_registration?: string | null;
  nature_of_business?: string | null;
  share_capital?: number | null;
  share_details?: unknown;
};

type VerifyResp =
  | { status: 'VERIFIED'; verificationTicket: string; entity: CacEntity }
  | { status: 'MISMATCH' }
  | { status: 'NOT_FOUND'; retryAt?: string }
  | { status: 'COOLDOWN'; retryAt: string }
  | { status: 'PROVIDER_ERROR'; message?: string }
  // ✅ New: backend can signal that a supplier already exists for this CAC
  | { status: 'SUPPLIER_EXISTS'; message?: string; entity?: CacEntity; supplierId?: string };

type RegisterSupplierResponse = {
  message: string;
  supplierId?: string;

  // ✅ your new backend response (recommended)
  tempToken?: string;
  emailSent?: boolean;
  phoneOtpSent?: boolean;
};

export default function SupplierRegister() {
  const nav = useNavigate();

  const [form, setForm] = useState({
    rcNumber: '',
    companyType: '' as CacCompanyType | '',
    companyName: '',
    regDate: '', // YYYY-MM-DD (input[type=date] gives this)
    contactFirstName: '',
    contactLastName: '',
    contactEmail: '',
    contactPhone: '',
    password: '',
    confirmPassword: '',
    role: 'SUPPLIER' as SupplierRole,
  });

  const [kycEntity, setKycEntity] = useState<CacEntity | null>(null);
  const [verificationTicket, setVerificationTicket] = useState<string | null>(null);

  const [kycLoading, setKycLoading] = useState(false);
  const [kycErr, setKycErr] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ✅ Track if this CAC record already has a supplier in DB
  const [supplierAlreadyRegistered, setSupplierAlreadyRegistered] = useState(false);

  const scrollTopOnError = () => {
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      /* no-op */
    }
  };

  // ---------- helpers ----------
  const norm = (s: any) => String(s ?? '').trim().toLowerCase();
  const digits = (s: any) => String(s ?? '').replace(/\D/g, '');

  function pad2(n: number) {
    return String(n).padStart(2, '0');
  }
  function ymdFromParts(y: number, m: number, d: number) {
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  function normalizeDateToYMD(raw?: string | null): string | null {
    const s = String(raw ?? '').trim();
    if (!s) return null;

    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

    const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slash) {
      const a = Number(slash[1]);
      const b = Number(slash[2]);
      const y = Number(slash[3]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(y)) return null;

      let day = b;
      let month = a;
      if (a > 12 && b <= 12) {
        day = a;
        month = b;
      }
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      return ymdFromParts(y, month, day);
    }

    try {
      const dt = new Date(s);
      if (Number.isNaN(dt.getTime())) return null;
      return ymdFromParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    } catch {
      return null;
    }
  }

  function matchesAllFour(entity: CacEntity, f: typeof form) {
    const rcOk = digits(f.rcNumber) !== '' && digits(f.rcNumber) === digits(entity.rc_number);
    const typeOk =
      !!f.companyType &&
      String(f.companyType).trim().toUpperCase() === String(entity.type_of_company).trim().toUpperCase();
    const nameOk = norm(f.companyName) !== '' && norm(f.companyName) === norm(entity.company_name);

    const entryDate = normalizeDateToYMD(entity.date_of_registration);
    const dateOk = !!f.regDate && !!entryDate && entryDate === f.regDate;

    return rcOk && typeOk && nameOk && dateOk;
  }

  const canProceed = useMemo(() => {
    // ✅ Only proceed if:
    // - CAC entity is present
    // - verificationTicket is set (from VERIFIED response)
    // - and all four fields match
    // - AND supplier is not already registered
    return (
      !!kycEntity &&
      !!verificationTicket &&
      matchesAllFour(kycEntity, form) &&
      !supplierAlreadyRegistered
    );
  }, [kycEntity, verificationTicket, form, supplierAlreadyRegistered]);

  const onChange =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const val = e.target.value;
      setForm((f) => ({ ...f, [key]: val }));

      // Any change to these fields invalidates the current verification
      if (key === 'rcNumber' || key === 'companyType' || key === 'companyName' || key === 'regDate') {
        setKycErr(null);
        setErr(null);
        setKycEntity(null);
        setVerificationTicket(null);
        setSupplierAlreadyRegistered(false);
      }
    };

  const validate = () => {
    if (!form.rcNumber.trim()) return 'Please enter your RC number';
    if (!form.companyType) return 'Please select your company type';
    if (!form.companyName.trim()) return 'Please enter the company name';
    if (!form.regDate.trim()) return 'Please enter the registration date';

    if (supplierAlreadyRegistered) {
      return 'A supplier is already registered with these CAC details. Please sign in instead.';
    }

    if (!canProceed) return 'Please verify your business with CAC before completing registration.';

    if (!form.contactFirstName.trim()) return 'Please enter the contact first name';
    if (!form.contactLastName.trim()) return 'Please enter the contact last name';

    if (!form.contactEmail.trim()) return 'Please enter the contact email';
    if (!/^\S+@\S+\.\S+$/.test(form.contactEmail)) return 'Please enter a valid contact email';

    const phoneDigits = form.contactPhone.replace(/\D/g, '');
    if (phoneDigits && phoneDigits.length < 6) return 'Please enter a valid contact phone number';

    const pwd = form.password ?? '';
    const hasMinLen = pwd.length >= 8;
    const hasLetter = /[A-Za-z]/.test(pwd);
    const hasNumber = /\d/.test(pwd);
    const hasSpecial = /[^A-Za-z0-9]/.test(pwd);
    if (!hasMinLen || !hasLetter || !hasNumber || !hasSpecial) {
      return 'Password must be at least 8 characters and include a letter, a number, and a special character.';
    }

    if (form.password !== form.confirmPassword) return 'Passwords do not match';
    return null;
  };

  const lookupCac = async () => {
    setKycErr(null);
    setErr(null);
    setSupplierAlreadyRegistered(false);

    if (!form.rcNumber.trim()) return setKycErr('Please enter your RC number before lookup.');
    if (!form.companyType) return setKycErr('Please select your company type before lookup.');
    if (!form.companyName.trim() || !form.regDate.trim()) {
      return setKycErr('Please enter company name and registration date, then verify.');
    }

    try {
      setKycLoading(true);

      const { data } = await api.post<VerifyResp>('/api/suppliers/cac-verify', {
        rc_number: form.rcNumber.trim(),
        company_type: form.companyType,
        assertedCompanyName: form.companyName.trim(),
        assertedRegistrationDate: form.regDate.trim(),
      });

      if (data.status === 'VERIFIED') {
        // ✅ Fresh verification, new supplier registration allowed
        setKycEntity(data.entity);
        setVerificationTicket(data.verificationTicket);
        setSupplierAlreadyRegistered(false);
        return;
      }

      if (data.status === 'SUPPLIER_EXISTS') {
        // ✅ CAC matches but we already have a supplier in DB
        setKycEntity(data.entity ?? null);
        setVerificationTicket(null);
        setSupplierAlreadyRegistered(true);
        setKycErr(
          data.message ||
            'A supplier with this RC number is already registered on DaySpring. Please sign in instead or contact support.'
        );
        return;
      }

      // Other non-VERIFIED statuses
      setKycEntity(null);
      setVerificationTicket(null);
      setSupplierAlreadyRegistered(false);

      if (data.status === 'COOLDOWN') {
        setKycErr('Too many attempts. Please wait a bit and check your details before trying again.');
        return;
      }
      if (data.status === 'MISMATCH') {
        setKycErr(
          'CAC record found, but your details do not match. Please re-check RC, type, name and date.'
        );
        return;
      }
      if (data.status === 'NOT_FOUND') {
        setKycErr('No CAC record found. Please double-check RC number and company type.');
        return;
      }
      if (data.status === 'PROVIDER_ERROR') {
        setKycErr(data.message || 'CAC provider is currently unavailable. Please try again later.');
        return;
      }

      setKycErr('Could not verify at this time. Please try again.');
    } catch {
      // Only truly unexpected failures land here (network down, server crash, etc.)
      setKycEntity(null);
      setVerificationTicket(null);
      setSupplierAlreadyRegistered(false);
      setKycErr('Could not verify at this time. Please try again.');
      scrollTopOnError();
    } finally {
      setKycLoading(false);
    }
  };

  // ---------- Submit ----------
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    const v = validate();
    if (v) {
      setErr(v);
      scrollTopOnError();
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        role: 'SUPPLIER',
        contactFirstName: form.contactFirstName.trim(),
        contactLastName: form.contactLastName.trim(),
        contactEmail: form.contactEmail.trim().toLowerCase(),
        contactPhone: form.contactPhone.trim() || null,
        password: form.password,
        rcNumber: form.rcNumber.trim(),
        companyType: form.companyType,
        assertedCompanyName: form.companyName.trim(),
        assertedRegistrationDate: form.regDate.trim(),
        verificationTicket: verificationTicket,
      };

      const { data } = await api.post<RegisterSupplierResponse>('/api/auth/register-supplier', payload);

      // ✅ persist for verify flow
      try {
        localStorage.setItem('supplierEmail', payload.contactEmail);
        localStorage.setItem('isSupplierReg', '1');
        if (data?.tempToken) localStorage.setItem('tempToken', data.tempToken);
      } catch {
        /* no-op */
      }

      // ✅ go to verify page (not login)
      nav(`/verify?e=${encodeURIComponent(payload.contactEmail)}&supplier=1`, { replace: true });
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        'Supplier registration failed';
      setErr(msg);
      scrollTopOnError();
    } finally {
      setSubmitting(false);
    }
  };

  const pwdStrength = (() => {
    const val = form.password ?? '';
    let s = 0;
    if (val.length >= 8) s++;
    if (/[A-Z]/.test(val)) s++;
    if (/[a-z]/.test(val)) s++;
    if (/\d/.test(val)) s++;
    if (/[^A-Za-z0-9]/.test(val)) s++;
    return Math.min(s, 4);
  })();

  const statusText = !kycEntity
    ? ''
    : supplierAlreadyRegistered
    ? 'A supplier is already registered with these CAC details'
    : canProceed
    ? 'Verified & approved'
    : 'CAC record found (confirm details)';

  return (
    <SiteLayout>
      <div className="min-h-[100dvh] relative overflow-hidden">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-[radial-gradient(1200px_500px_at_10%_-10%,#a78bfa33,transparent_50%),radial-gradient(1000px_500px_at_90%_0%,#22d3ee33,transparent_50%),linear-gradient(180deg,#111827,#0b1220_40%)]" />
        <div className="pointer-events-none absolute -top-28 -right-20 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-40 bg-violet-500/40" />
        <div className="pointer-events-none absolute -bottom-28 -left-12 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-40 bg-cyan-400/40" />

        <div className="relative grid place-items-center min-h-[100dvh] px-4">
          <div className="w-full max-w-3xl">
            {/* Header */}
            <div className="mb-6 text-center">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/15 text-white px-3 py-1 text-xs font-medium border border-white/30 backdrop-blur">
                <span className="inline-block size-2 rounded-full bg-emerald-400 animate-pulse" />
                Become a DaySpring Supplier
              </div>
              <h1 className="mt-3 text-3xl font-semibold text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.3)]">
                Register your business
              </h1>
              <p className="mt-1 text-sm text-white/80">
                We&apos;ll verify your CAC details and confirm you control the registration.
              </p>
            </div>

            <form
              onSubmit={submit}
              className="rounded-2xl border border-white/30 bg-white/80 backdrop-blur-xl shadow-[0_10px_40px_-12px_rgba(59,130,246,0.35)] p-6 md:p-8 space-y-6 transition hover:shadow-[0_20px_60px_-12px_rgba(59,130,246,0.45)]"
            >
              {(err || kycErr) && (
                <div className="text-sm rounded-md border border-rose-300/60 bg-rose-50/90 text-rose-700 px-3 py-2 space-y-1">
                  {err && <p>{err}</p>}
                  {kycErr && <p>{kycErr}</p>}
                </div>
              )}

              {/* CAC / Business section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">Business details (CAC)</h2>
                  <span className="text-[11px] text-slate-500">
                    Powered by <span className="font-semibold text-violet-600">Dojah CAC (basic)</span>
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">RC number</label>
                    <input
                      value={form.rcNumber}
                      onChange={onChange('rcNumber')}
                      placeholder="e.g. 1234567"
                      className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm
                               placeholder:text-slate-400 text-slate-900 outline-none
                               focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">Use a valid CAC RC or BN number.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Company type</label>
                    <select
                      value={form.companyType}
                      onChange={onChange('companyType')}
                      className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm
                               text-slate-900 outline-none focus:border-violet-400
                               focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                    >
                      <option value="">Select type…</option>
                      <option value="BUSINESS_NAME">Business Name</option>
                      <option value="COMPANY">Company</option>
                      <option value="INCORPORATED_TRUSTEES">Incorporated Trustees</option>
                      <option value="LIMITED_PARTNERSHIP">Limited Partnership</option>
                      <option value="LIMITED_LIABILITY_PARTNERSHIP">
                        Limited Liability Partnership
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Company name (exact)
                    </label>
                    <input
                      value={form.companyName}
                      onChange={onChange('companyName')}
                      placeholder="Exact registered name"
                      className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm
                               placeholder:text-slate-400 text-slate-900 outline-none
                               focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-3 items-end">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Registration date
                    </label>
                    <input
                      type="date"
                      value={form.regDate}
                      onChange={onChange('regDate')}
                      className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm
                               text-slate-900 outline-none focus:border-violet-400
                               focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Must match CAC registration date exactly (YYYY-MM-DD).
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={lookupCac}
                    disabled={kycLoading}
                    className="inline-flex items-center justify-center rounded-xl bg-slate-900 text-white
                             px-4 py-2.5 text-sm font-semibold shadow-sm hover:bg-slate-800
                             disabled:opacity-60 disabled:cursor-not-allowed transition"
                  >
                    {kycLoading ? (
                      <>
                        <span className="mr-2 inline-block h-4 w-4 rounded-full border-[2px] border-white/40 border-t-white animate-spin" />
                        Checking…
                      </>
                    ) : (
                      'Verify with CAC'
                    )}
                  </button>
                </div>

                {(kycEntity || statusText) && (
                  <div
                    className={`mt-2 rounded-xl px-3 py-3 text-xs ${
                      supplierAlreadyRegistered
                        ? 'border border-rose-200 bg-rose-50/90 text-slate-800'
                        : canProceed
                        ? 'border border-emerald-200 bg-emerald-50/80 text-slate-800'
                        : 'border border-amber-200 bg-amber-50/80 text-slate-800'
                    }`}
                  >
                    {statusText && (
                      <p className="mb-1.5 text-[11px] text-slate-600">
                        Status: <span className="font-medium">{statusText}</span>
                      </p>
                    )}

                    {kycEntity && (
                      <>
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-white text-[11px] ${
                              supplierAlreadyRegistered
                                ? 'bg-rose-500'
                                : canProceed
                                ? 'bg-emerald-500'
                                : 'bg-amber-500'
                            }`}
                          >
                            {supplierAlreadyRegistered ? '!' : canProceed ? '✓' : '!'}
                          </span>
                          <div>
                            <p className="font-semibold text-slate-900">
                              {kycEntity.company_name}{' '}
                              <span className="font-mono text-[11px] text-slate-600">
                                (RC {kycEntity.rc_number})
                              </span>
                            </p>
                            <p className="text-[11px] text-slate-600">
                              {kycEntity.type_of_company} • Registered{' '}
                              {kycEntity.date_of_registration
                                ? normalizeDateToYMD(kycEntity.date_of_registration) ?? '—'
                                : '—'}
                            </p>
                          </div>
                        </div>

                        {!supplierAlreadyRegistered && (
                          <div className="mt-2 text-[11px]">
                            {canProceed ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-1 border border-emerald-200">
                                ✓ RC number, company type, name & registration date match
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-700 px-2 py-1 border border-rose-200">
                                ✗ Please correct RC number, company type, registered name and date to match
                              </span>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Info strip: either "complete CAC" or "already registered" */}
              {!canProceed && !supplierAlreadyRegistered && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700">
                  Complete the CAC confirmation above. The contact & login form appears only after your RC
                  number, company type, registered name and registration date match.
                </div>
              )}

              {supplierAlreadyRegistered && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-xs text-amber-800">
                  A supplier account is already registered with these CAC details. Please{' '}
                  <a href="/login?supplier=1" className="font-semibold underline">
                    sign in
                  </a>{' '}
                  instead or contact support if you believe this is an error.
                </div>
              )}

              {/* Contact & login form only if CAC is verified and this is NOT an existing supplier */}
              {canProceed && (
                <>
                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-slate-900">
                      Primary contact & login details
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-800 mb-1">
                          Contact first name
                        </label>
                        <input
                          value={form.contactFirstName}
                          onChange={onChange('contactFirstName')}
                          placeholder="First name"
                          className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm
                               placeholder:text-slate-400 text-slate-900 outline-none
                               focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-800 mb-1">
                          Contact last name
                        </label>
                        <input
                          value={form.contactLastName}
                          onChange={onChange('contactLastName')}
                          placeholder="Last name"
                          className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm
                               placeholder:text-slate-400 text-slate-900 outline-none
                               focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-800 mb-1">
                          Contact email (login)
                        </label>
                        <input
                          type="email"
                          value={form.contactEmail}
                          onChange={onChange('contactEmail')}
                          placeholder="you@business.com"
                          className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm
                               placeholder:text-slate-400 text-slate-900 outline-none
                               focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-800 mb-1">
                          Contact WhatsApp number
                        </label>
                        <input
                          value={form.contactPhone}
                          onChange={onChange('contactPhone')}
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="+234 801 234 5678"
                          className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm
                               placeholder:text-slate-400 text-slate-900 outline-none
                               focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-800 mb-1">Password</label>
                      <input
                        type="password"
                        value={form.password}
                        onChange={onChange('password')}
                        placeholder="At least 8 characters"
                        className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm
                             text-slate-900 placeholder:text-slate-400 outline-none
                             focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                      />
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
                      <label className="block text-xs font-medium text-slate-800 mb-1">
                        Confirm password
                      </label>
                      <input
                        type="password"
                        value={form.confirmPassword}
                        onChange={onChange('confirmPassword')}
                        placeholder="Re-enter password"
                        className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm
                             text-slate-900 placeholder:text-slate-400 outline-none
                             focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 text-white
                         px-4 py-3 font-semibold shadow-[0_10px_30px_-12px_rgba(14,165,233,0.6)]
                         hover:scale-[1.01] active:scale-[0.995]
                         focus:outline-none focus:ring-4 focus:ring-cyan-300/40 transition disabled:opacity-50"
                  >
                    {submitting ? 'Creating supplier account…' : 'Create supplier account'}
                  </button>

                  <p className="text-center text-xs text-slate-600">
                    By continuing, you agree that DaySpring may verify your business using CAC data and our{' '}
                    <a className="text-violet-700 hover:underline" href="/terms">
                      Terms
                    </a>{' '}
                    and{' '}
                    <a className="text-violet-700 hover:underline" href="/privacy">
                      Privacy Policy
                    </a>
                    .
                  </p>
                </>
              )}
            </form>

            <p className="mt-5 text-center text-sm text-white/80">
              Already a supplier?{' '}
              <a className="text-cyan-200 hover:underline" href="/login?supplier=1">
                Sign in
              </a>
            </p>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
