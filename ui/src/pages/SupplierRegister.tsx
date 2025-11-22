// src/pages/SupplierRegister.tsx
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import dojahApi from '../api/dojahClient';
import api from '../api/client';
import SiteLayout from '../layouts/SiteLayout';

type SupplierRole = 'SUPPLIER';

type CacCompanyType =
  | 'BUSINESS_NAME'
  | 'COMPANY'
  | 'INCORPORATED_TRUSTEES'
  | 'LIMITED_PARTNERSHIP'
  | 'LIMITED_LIABILITY_PARTNERSHIP';

type CacAffiliate = {
  first_name: string;
  last_name: string;
  email?: string | null;
  address?: string | null;
  state?: string | null;
  city?: string | null;
  lga?: string | null;
  occupation?: string | null;
  phone_number?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  nationality?: string | null;
  affiliate_type?: string | null;
  affiliate_category_type?: string | null;
  country?: string | null;
  id_number?: string | null;
  id_type?: string | null;
};

type CacAdvanceEntity = {
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
  affiliates?: CacAffiliate[];
};

type CacAdvanceResponse = {
  entity: CacAdvanceEntity;
};

type OwnerVerifyResponse = {
  // You can shape this according to your backend
  match: boolean;
  score?: number;
  message?: string;
};

type RegisterSupplierResponse = {
  message: string;
};

export default function SupplierRegister() {
  const nav = useNavigate();

  const [form, setForm] = useState({
    rcNumber: '',
    companyType: '' as CacCompanyType | '',
    contactFirstName: '',
    contactLastName: '',
    contactEmail: '',
    contactPhone: '',
    password: '',
    confirmPassword: '',
    role: 'SUPPLIER' as SupplierRole,
  });

  const [kycEntity, setKycEntity] = useState<CacAdvanceEntity | null>(null);
  const [kycLoading, setKycLoading] = useState(false);
  const [kycErr, setKycErr] = useState<string | null>(null);

  const [ownerBvn, setOwnerBvn] = useState('');
  const [selectedAffiliateIndex, setSelectedAffiliateIndex] = useState<number | null>(null);
  const [ownerVerifying, setOwnerVerifying] = useState(false);
  const [ownerVerified, setOwnerVerified] = useState(false);
  const [ownerVerifyErr, setOwnerVerifyErr] = useState<string | null>(null);
  const [ownerVerifyResult, setOwnerVerifyResult] = useState<OwnerVerifyResponse | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onChange =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      if (key === 'rcNumber' || key === 'companyType') {
        // Clear KYC + owner verification if identifiers change
        setKycEntity(null);
        setKycErr(null);
        setOwnerBvn('');
        setSelectedAffiliateIndex(null);
        setOwnerVerified(false);
        setOwnerVerifyErr(null);
        setOwnerVerifyResult(null);
      }
    };

  const scrollTopOnError = () => {
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      /* no-op */
    }
  };

  const validate = () => {
    if (!form.rcNumber.trim()) return 'Please enter your RC number';
    if (!form.companyType) return 'Please select your company type';

    if (!form.contactFirstName.trim()) return 'Please enter the contact first name';
    if (!form.contactLastName.trim()) return 'Please enter the contact last name';

    if (!form.contactEmail.trim()) return 'Please enter the contact email';
    if (!/^\S+@\S+\.\S+$/.test(form.contactEmail)) {
      return 'Please enter a valid contact email';
    }

    const phoneDigits = form.contactPhone.replace(/\D/g, '');
    if (phoneDigits && phoneDigits.length < 6) {
      return 'Please enter a valid contact phone number';
    }

    const pwd = form.password ?? '';
    const hasMinLen = pwd.length >= 8;
    const hasLetter = /[A-Za-z]/.test(pwd);
    const hasNumber = /\d/.test(pwd);
    const hasSpecial = /[^A-Za-z0-9]/.test(pwd);

    if (!hasMinLen || !hasLetter || !hasNumber || !hasSpecial) {
      return 'Password must be at least 8 characters and include a letter, a number, and a special character.';
    }

    if (form.password !== form.confirmPassword) return 'Passwords do not match';

    if (!kycEntity) {
      return 'Please verify your business with CAC (Dojah) before completing registration.';
    }

    if (!ownerVerified) {
      return 'Please complete proprietor verification before creating your supplier account.';
    }

    return null;
  };

  const lookupCac = async () => {
    setKycErr(null);
    setKycEntity(null);
    setOwnerBvn('');
    setSelectedAffiliateIndex(null);
    setOwnerVerified(false);
    setOwnerVerifyErr(null);
    setOwnerVerifyResult(null);

    if (!form.rcNumber.trim()) {
      setKycErr('Please enter your RC number before lookup.');
      scrollTopOnError();
      return;
    }
    if (!form.companyType) {
      setKycErr('Please select your company type before lookup.');
      scrollTopOnError();
      return;
    }

    try {
      setKycLoading(true);

      // Backend proxy to Dojah CAC Advance
      const { data } = await dojahApi.get<CacAdvanceResponse>('/api/kyc/cac-advance', {
        params: {
          rc_number: form.rcNumber.trim(),
          company_type: form.companyType,
        },
      });

      if (!data?.entity) {
        setKycErr('Could not fetch CAC details. Please double-check your RC number or try again.');
        setKycEntity(null);
        return;
      }

      setKycEntity(data.entity);
    } catch (e: any) {
      setKycErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          'Failed to verify business with CAC. Please try again.'
      );
      setKycEntity(null);
    } finally {
      setKycLoading(false);
    }
  };

  const proprietorOptions = useMemo(() => {
    if (!kycEntity?.affiliates) return [];

    // You can broaden this filter to include directors if needed
    return kycEntity.affiliates.filter((a) => {
      const t = (a.affiliate_type || '').toUpperCase();
      const cat = (a.affiliate_category_type || '').toUpperCase();
      return t === 'PROPRIETOR' || cat.includes('PROPRIETOR');
    });
  }, [kycEntity]);

  const selectedAffiliate =
    selectedAffiliateIndex != null && proprietorOptions[selectedAffiliateIndex]
      ? proprietorOptions[selectedAffiliateIndex]
      : null;

  const verifyOwner = async () => {
    setOwnerVerifyErr(null);
    setOwnerVerifyResult(null);
    setOwnerVerified(false);

    if (!kycEntity) {
      setOwnerVerifyErr('Please complete CAC lookup first.');
      scrollTopOnError();
      return;
    }
    if (!selectedAffiliate) {
      setOwnerVerifyErr('Please select which proprietor you are.');
      scrollTopOnError();
      return;
    }
    const bvnDigits = ownerBvn.replace(/\D/g, '');
    if (!bvnDigits || bvnDigits.length !== 11) {
      setOwnerVerifyErr('Please enter a valid 11-digit BVN.');
      scrollTopOnError();
      return;
    }

    try {
      setOwnerVerifying(true);

      // Backend route that calls Dojah BVN / Age Identity and compares
      const { data } = await dojahApi.post<OwnerVerifyResponse>('/api/kyc/proprietor-verify', {
        bvn: bvnDigits,
        affiliate: selectedAffiliate,
        company: {
          company_name: kycEntity.company_name,
          rc_number: kycEntity.rc_number,
        },
      });

      setOwnerVerifyResult(data);
      if (data.match) {
        setOwnerVerified(true);
      } else {
        setOwnerVerified(false);
        setOwnerVerifyErr(
          data.message || 'We could not verify that this BVN belongs to the selected proprietor.'
        );
      }
    } catch (e: any) {
      setOwnerVerified(false);
      setOwnerVerifyErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          'Failed to verify proprietor. Please try again.'
      );
    } finally {
      setOwnerVerifying(false);
    }
  };

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
        role: form.role,
        contactFirstName: form.contactFirstName.trim(),
        contactLastName: form.contactLastName.trim(),
        contactEmail: form.contactEmail.trim().toLowerCase(),
        contactPhone: form.contactPhone.trim() || null,
        password: form.password,
        rcNumber: form.rcNumber.trim(),
        companyType: form.companyType,
        kycEntity,
        ownerVerified: true,
        proprietorAffiliate: selectedAffiliate,
        proprietorBvnMasked: ownerBvn.replace(/\d(?=\d{4})/g, '*'), // store masked if you like
      };

      await api.post<RegisterSupplierResponse>('/api/auth/register-supplier', payload);

      try {
        localStorage.setItem('supplierEmail', payload.contactEmail);
      } catch {
        /* no-op */
      }

      nav('/login?supplier=1', { replace: true });
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Supplier registration failed');
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

  return (
    <SiteLayout>
      <div className="min-h-[100dvh] relative overflow-hidden">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-[radial-gradient(1200px_500px_at_10%_-10%,#a78bfa33,transparent_50%),radial-gradient(1000px_500px_at_90%_0%,#22d3ee33,transparent_50%),linear-gradient(180deg,#111827,#0b1220_40%)]" />
        <div className="pointer-events-none absolute -top-28 -right-20 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-40 bg-violet-500/40" />
        <div className="pointer-events-none absolute -bottom-28 -left-12 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-40 bg-cyan-400/40" />
        <div className="absolute inset-0 opacity-[0.06] [mask-image:radial-gradient(60%_60%_at_50%_40%,black,transparent)]">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="miniGridSupReg2" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="white" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#miniGridSupReg2)" />
          </svg>
        </div>

        {/* Content */}
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
                We&apos;ll verify your CAC details and confirm you are the legitimate proprietor.
              </p>
            </div>

            {/* Card */}
            <form
              onSubmit={submit}
              className="rounded-2xl border border-white/30 bg-white/80 backdrop-blur-xl shadow-[0_10px_40px_-12px_rgba(59,130,246,0.35)] p-6 md:p-8 space-y-6 transition hover:shadow-[0_20px_60px_-12px_rgba(59,130,246,0.45)]"
            >
              {(err || kycErr || ownerVerifyErr) && (
                <div className="text-sm rounded-md border border-rose-300/60 bg-rose-50/90 text-rose-700 px-3 py-2 space-y-1">
                  {err && <p>{err}</p>}
                  {kycErr && <p>{kycErr}</p>}
                  {ownerVerifyErr && <p>{ownerVerifyErr}</p>}
                </div>
              )}

              {/* CAC / Business section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">Business details (CAC)</h2>
                  <span className="text-[11px] text-slate-500">
                    Powered by <span className="font-semibold text-violet-600">Dojah CAC Advance</span>
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1.2fr,1fr,auto] gap-3 items-end">
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
                    <p className="mt-1 text-[11px] text-slate-500">
                      Use a valid CAC RC or BN number (sandbox: 1261103 / 14320749 etc.).
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Company type
                    </label>
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

                {kycEntity && (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-3 text-xs text-slate-800 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white text-[11px]">
                        ✓
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
                            ? new Date(kycEntity.date_of_registration).toLocaleDateString()
                            : '—'}
                        </p>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-700">
                      {kycEntity.address || 'No registered address returned.'}
                    </p>
                    <p className="text-[11px] text-slate-600">
                      {kycEntity.city || '—'},{' '}
                      {kycEntity.lga ? `${kycEntity.lga}, ` : ''}
                      {kycEntity.state || '—'}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                      <span className="text-[11px] text-slate-600">
                        Nature of business:{' '}
                        <span className="font-medium">
                          {kycEntity.nature_of_business || 'Not specified'}
                        </span>
                      </span>
                      <span className="text-[11px] text-slate-600">
                        Affiliates:{' '}
                        <span className="font-medium">
                          {kycEntity.affiliates?.length ?? 0}
                        </span>
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Proprietor verification */}
              {kycEntity && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-slate-900">
                      Proprietor verification
                    </h2>
                    {ownerVerified && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2.5 py-1 text-[11px] font-medium">
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                        Owner verified
                      </span>
                    )}
                  </div>

                  {proprietorOptions.length === 0 ? (
                    <p className="text-xs text-slate-600">
                      We could not find any proprietor record in CAC affiliates. You can still
                      continue registration, but manual review may be required.
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr),minmax(0,1.6fr),auto] gap-3 items-end">
                        <div>
                          <label className="block text-xs font-medium text-slate-800 mb-1">
                            Which proprietor are you?
                          </label>
                          <select
                            value={
                              selectedAffiliateIndex != null
                                ? String(selectedAffiliateIndex)
                                : ''
                            }
                            onChange={(e) => {
                              const idx =
                                e.target.value === ''
                                  ? null
                                  : Number.parseInt(e.target.value, 10);
                              setSelectedAffiliateIndex(
                                Number.isNaN(idx as number) ? null : (idx as number)
                              );
                              setOwnerVerified(false);
                              setOwnerVerifyErr(null);
                              setOwnerVerifyResult(null);
                            }}
                            className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm
                                     text-slate-900 outline-none focus:border-violet-400
                                     focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                          >
                            <option value="">Select proprietor…</option>
                            {proprietorOptions.map((a, idx) => (
                              <option key={`${a.first_name}-${a.last_name}-${idx}`} value={idx}>
                                {a.first_name} {a.last_name}
                                {a.date_of_birth
                                  ? ` • DOB: ${new Date(
                                      a.date_of_birth
                                    ).toLocaleDateString()}`
                                  : ''}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-[11px] text-slate-500">
                            This list comes directly from CAC via Dojah.
                          </p>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-800 mb-1">
                            Your BVN (for KYC)
                          </label>
                          <input
                            value={ownerBvn}
                            onChange={(e) => {
                              setOwnerBvn(e.target.value);
                              setOwnerVerified(false);
                              setOwnerVerifyErr(null);
                              setOwnerVerifyResult(null);
                            }}
                            placeholder="11-digit BVN"
                            inputMode="numeric"
                            maxLength={20}
                            className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm
                                     placeholder:text-slate-400 text-slate-900 outline-none
                                     focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                          />
                          <p className="mt-1 text-[11px] text-slate-500">
                            We only use this to verify that the BVN belongs to the selected
                            proprietor.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={verifyOwner}
                          disabled={ownerVerifying}
                          className="inline-flex items-center justify-center rounded-xl bg-slate-900 text-white
                                   px-4 py-2.5 text-sm font-semibold shadow-sm hover:bg-slate-800
                                   disabled:opacity-60 disabled:cursor-not-allowed transition"
                        >
                          {ownerVerifying ? (
                            <>
                              <span className="mr-2 inline-block h-4 w-4 rounded-full border-[2px] border-white/40 border-t-white animate-spin" />
                              Verifying…
                            </>
                          ) : (
                            'Verify proprietor'
                          )}
                        </button>
                      </div>

                      {ownerVerifyResult && (
                        <p className="mt-1 text-[11px] text-slate-600">
                          {ownerVerified
                            ? ownerVerifyResult.message ||
                              'BVN details match the selected proprietor.'
                            : ownerVerifyResult.message ||
                              'We could not confidently match this BVN to the proprietor.'}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Contact person & login */}
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
                      Contact phone (optional)
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

              {/* Passwords */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-800 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    inputMode="text"
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
                    name="confirmPassword"
                    autoComplete="new-password"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    inputMode="text"
                    value={form.confirmPassword}
                    onChange={onChange('confirmPassword')}
                    placeholder="Re-enter password"
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm
                             text-slate-900 placeholder:text-slate-400 outline-none
                             focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                  />
                </div>
              </div>

              {/* Submit */}
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
                By continuing, you agree that DaySpring may verify your business using CAC data
                and BVN (via Dojah) and our{' '}
                <a className="text-violet-700 hover:underline" href="/terms">
                  Terms
                </a>{' '}
                and{' '}
                <a className="text-violet-700 hover:underline" href="/privacy">
                  Privacy Policy
                </a>
                .
              </p>
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
    