// src/pages/SupplierRegister.tsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api/client";
import SiteLayout from "../../layouts/SiteLayout";

type SupplierRole = "SUPPLIER";

type CacCompanyType =
  | "BUSINESS_NAME"
  | "COMPANY"
  | "INCORPORATED_TRUSTEES"
  | "LIMITED_PARTNERSHIP"
  | "LIMITED_LIABILITY_PARTNERSHIP";

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
  | { status: "VERIFIED"; verificationTicket: string; entity: CacEntity }
  | { status: "MISMATCH" }
  | { status: "NOT_FOUND"; retryAt?: string }
  | { status: "COOLDOWN"; retryAt: string }
  | { status: "PROVIDER_ERROR"; message?: string }
  | { status: "SUPPLIER_EXISTS"; message?: string; entity?: CacEntity; supplierId?: string };

type RegisterSupplierResponse = {
  message: string;
  supplierId?: string;
  tempToken?: string;
  emailSent?: boolean;
  phoneOtpSent?: boolean;
};

export default function SupplierRegister() {
  const nav = useNavigate();

  const [form, setForm] = useState({
    rcNumber: "",
    companyType: "" as CacCompanyType | "",
    companyName: "",
    regDate: "", // YYYY-MM-DD
    contactFirstName: "",
    contactLastName: "",
    contactEmail: "",
    contactPhone: "",
    password: "",
    confirmPassword: "",
    role: "SUPPLIER" as SupplierRole,
  });

  const [kycEntity, setKycEntity] = useState<CacEntity | null>(null);
  const [verificationTicket, setVerificationTicket] = useState<string | null>(null);

  const [kycLoading, setKycLoading] = useState(false);
  const [kycErr, setKycErr] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [supplierAlreadyRegistered, setSupplierAlreadyRegistered] = useState(false);

  const scrollTopOnError = () => {
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      /* noop */
    }
  };

  // ---------- helpers ----------
  const norm = (s: any) => String(s ?? "").trim().toLowerCase();
  const digits = (s: any) => String(s ?? "").replace(/\D/g, "");

  function pad2(n: number) {
    return String(n).padStart(2, "0");
  }
  function ymdFromParts(y: number, m: number, d: number) {
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  function normalizeDateToYMD(raw?: string | null): string | null {
    const s = String(raw ?? "").trim();
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
    const rcOk = digits(f.rcNumber) !== "" && digits(f.rcNumber) === digits(entity.rc_number);
    const typeOk =
      !!f.companyType &&
      String(f.companyType).trim().toUpperCase() ===
      String(entity.type_of_company).trim().toUpperCase();
    const nameOk = norm(f.companyName) !== "" && norm(f.companyName) === norm(entity.company_name);

    const entryDate = normalizeDateToYMD(entity.date_of_registration);
    const dateOk = !!f.regDate && !!entryDate && entryDate === f.regDate;

    return rcOk && typeOk && nameOk && dateOk;
  }

  const canProceed = useMemo(() => {
    return (
      !!kycEntity &&
      !!verificationTicket &&
      matchesAllFour(kycEntity, form) &&
      !supplierAlreadyRegistered
    );
  }, [kycEntity, verificationTicket, form, supplierAlreadyRegistered]);

  const stage = useMemo<"CAC" | "CONTACT">(() => (canProceed ? "CONTACT" : "CAC"), [canProceed]);

  const onChange =
    (key: keyof typeof form) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const val = e.target.value;
        setForm((f) => ({ ...f, [key]: val }));

        if (key === "rcNumber" || key === "companyType" || key === "companyName" || key === "regDate") {
          setKycErr(null);
          setErr(null);
          setKycEntity(null);
          setVerificationTicket(null);
          setSupplierAlreadyRegistered(false);
        }
      };

  const validate = () => {
    if (!form.rcNumber.trim()) return "Please enter your RC number";
    if (!form.companyType) return "Please select your company type";
    if (!form.companyName.trim()) return "Please enter the company name";
    if (!form.regDate.trim()) return "Please enter the registration date";

    if (supplierAlreadyRegistered) {
      return "A supplier is already registered with these CAC details. Please sign in instead.";
    }

    if (!canProceed) return "Please verify your business with CAC before completing registration.";

    if (!form.contactFirstName.trim()) return "Please enter the contact first name";
    if (!form.contactLastName.trim()) return "Please enter the contact last name";

    if (!form.contactEmail.trim()) return "Please enter the contact email";
    if (!/^\S+@\S+\.\S+$/.test(form.contactEmail)) return "Please enter a valid contact email";

    const phoneDigits = form.contactPhone.replace(/\D/g, "");
    if (phoneDigits && phoneDigits.length < 6) return "Please enter a valid contact phone number";

    const pwd = form.password ?? "";
    const hasMinLen = pwd.length >= 8;
    const hasLetter = /[A-Za-z]/.test(pwd);
    const hasNumber = /\d/.test(pwd);
    const hasSpecial = /[^A-Za-z0-9]/.test(pwd);
    if (!hasMinLen || !hasLetter || !hasNumber || !hasSpecial) {
      return "Password must be at least 8 characters and include a letter, a number, and a special character.";
    }

    if (form.password !== form.confirmPassword) return "Passwords do not match";
    return null;
  };

  const lookupCac = async () => {
    setKycErr(null);
    setErr(null);
    setSupplierAlreadyRegistered(false);

    if (!form.rcNumber.trim()) return setKycErr("Please enter your RC number before lookup.");
    if (!form.companyType) return setKycErr("Please select your company type before lookup.");
    if (!form.companyName.trim() || !form.regDate.trim()) {
      return setKycErr("Please enter company name and registration date, then verify.");
    }

    try {
      setKycLoading(true);

      const { data } = await api.post<VerifyResp>("/api/suppliers/cac-verify", {
        rc_number: form.rcNumber.trim(),
        company_type: form.companyType,
        assertedCompanyName: form.companyName.trim(),
        assertedRegistrationDate: form.regDate.trim(),
      });

      if (data.status === "VERIFIED") {
        setKycEntity(data.entity);
        setVerificationTicket(data.verificationTicket);
        setSupplierAlreadyRegistered(false);
        return;
      }

      if (data.status === "SUPPLIER_EXISTS") {
        setKycEntity(data.entity ?? null);
        setVerificationTicket(null);
        setSupplierAlreadyRegistered(true);
        setKycErr(
          data.message ||
          "A supplier with this RC number is already registered on DaySpring. Please sign in instead or contact support."
        );
        return;
      }

      setKycEntity(null);
      setVerificationTicket(null);
      setSupplierAlreadyRegistered(false);

      if (data.status === "COOLDOWN") {
        setKycErr("Too many attempts. Please wait a bit and check your details before trying again.");
        return;
      }
      if (data.status === "MISMATCH") {
        setKycErr("CAC record found, but your details do not match. Please re-check RC, type, name and date.");
        return;
      }
      if (data.status === "NOT_FOUND") {
        setKycErr("No CAC record found. Please double-check RC number and company type.");
        return;
      }
      if (data.status === "PROVIDER_ERROR") {
        setKycErr(data.message || "CAC provider is currently unavailable. Please try again later.");
        return;
      }

      setKycErr("Could not verify at this time. Please try again.");
    } catch {
      setKycEntity(null);
      setVerificationTicket(null);
      setSupplierAlreadyRegistered(false);
      setKycErr("Could not verify at this time. Please try again.");
      scrollTopOnError();
    } finally {
      setKycLoading(false);
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
        role: "SUPPLIER" as const,
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

      const { data } = await api.post<RegisterSupplierResponse>("/api/auth/register-supplier", payload);

      try {
        localStorage.setItem("supplierEmail", payload.contactEmail);
        localStorage.setItem("isSupplierReg", "1");
        if (data?.tempToken) localStorage.setItem("tempToken", data.tempToken);
      } catch {
        /* noop */
      }

      nav(`/verify?e=${encodeURIComponent(payload.contactEmail)}&supplier=1`, { replace: true });
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || "Supplier registration failed";
      setErr(msg);
      scrollTopOnError();
    } finally {
      setSubmitting(false);
    }
  };

  const pwdStrength = useMemo(() => {
    const val = form.password ?? "";
    let s = 0;
    if (val.length >= 8) s++;
    if (/[A-Z]/.test(val)) s++;
    if (/[a-z]/.test(val)) s++;
    if (/\d/.test(val)) s++;
    if (/[^A-Za-z0-9]/.test(val)) s++;
    return Math.min(s, 4);
  }, [form.password]);

  const statusText = !kycEntity
    ? ""
    : supplierAlreadyRegistered
      ? "A supplier is already registered with these CAC details"
      : canProceed
        ? "Verified & approved"
        : "CAC record found (confirm details)";

  // ✅ compact + consistent styles (mobile + desktop)
  const label = "block text-sm font-semibold text-slate-800 mb-1";
  const help = "mt-1 text-xs text-slate-500";
  const input =
    "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[16px] md:text-sm text-slate-900 " +
    "placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm";
  const card =
    "rounded-2xl border bg-white/95 backdrop-blur shadow-sm p-4 sm:p-6 md:p-8 space-y-5";

  return (
    <SiteLayout>
      <div className="min-h-[100dvh] relative overflow-hidden bg-gradient-to-b from-zinc-50 to-white">
        {/* softer background (less “dark glass”, more readable) */}
        <div className="pointer-events-none absolute -top-24 -right-20 w-[26rem] h-[26rem] rounded-full blur-3xl opacity-30 bg-fuchsia-300/50" />
        <div className="pointer-events-none absolute -bottom-28 -left-16 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-25 bg-cyan-300/50" />

        <div className="relative px-3 sm:px-4 py-6 sm:py-10">
          <div className="mx-auto w-full max-w-3xl">
            {/* Header */}
            <div className="mb-5 text-center">
              <div className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs font-semibold text-zinc-800 shadow-sm">
                <span className="inline-block size-2 rounded-full bg-emerald-500 animate-pulse" />
                Become a DaySpring Supplier
              </div>

              <h1 className="mt-3 text-2xl sm:text-3xl font-semibold text-zinc-900">
                Register your business
              </h1>
              <p className="mt-1 text-sm text-zinc-600">
                Verify your CAC details, then create your supplier login.
              </p>
            </div>

            {/* Progress (mobile-friendly) */}
            <div className="mb-4">
              {/* Mobile: stacked chips */}
              <div className="sm:hidden flex items-center justify-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border ${stage === "CAC"
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-700 border-zinc-200"
                    }`}
                >
                  1) CAC
                </span>
                <span className="text-zinc-400 text-xs">→</span>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border ${stage === "CONTACT"
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-700 border-zinc-200"
                    }`}
                >
                  2) Contact
                </span>
              </div>

              {/* Desktop: single pill */}
              <div className="hidden sm:flex items-center justify-center">
                <div className="inline-flex items-center gap-2 rounded-full border bg-white px-2 py-1 text-xs text-zinc-700 shadow-sm">
                  <span
                    className={`px-3 py-1 rounded-full font-semibold ${stage === "CAC"
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-700"
                      }`}
                  >
                    1) CAC verification
                  </span>

                  <span className="opacity-40">→</span>

                  <span
                    className={`px-3 py-1 rounded-full font-semibold ${stage === "CONTACT"
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-700"
                      }`}
                  >
                    2) Contact & password
                  </span>
                </div>
              </div>
            </div>

            <form onSubmit={submit} className={card}>
              {(err || kycErr) && (
                <div className="text-sm rounded-xl border border-rose-300/60 bg-rose-50 text-rose-700 px-3 py-2 space-y-1">
                  {err && <div>{err}</div>}
                  {kycErr && <div>{kycErr}</div>}
                </div>
              )}

              {/* CAC Section */}
              <section className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-zinc-900">Business details (CAC)</h2>
                    <p className="mt-1 text-xs text-zinc-500">
                      Your RC, type, name and registration date must match CAC.
                    </p>
                  </div>

                </div>


                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className={label}>RC number</label>
                    <input value={form.rcNumber} onChange={onChange("rcNumber")} className={input} placeholder="e.g. 1234567" />
                    <p className={help}>Use a valid CAC RC or BN number.</p>
                  </div>

                  <div>
                    <label className={label}>Company type</label>
                    <select value={form.companyType} onChange={onChange("companyType")} className={input}>
                      <option value="">Select type…</option>
                      <option value="BUSINESS_NAME">Business Name</option>
                      <option value="COMPANY">Company</option>
                      <option value="INCORPORATED_TRUSTEES">Incorporated Trustees</option>
                      <option value="LIMITED_PARTNERSHIP">Limited Partnership</option>
                      <option value="LIMITED_LIABILITY_PARTNERSHIP">Limited Liability Partnership</option>
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className={label}>Company name (exact)</label>
                    <input
                      value={form.companyName}
                      onChange={onChange("companyName")}
                      className={input}
                      placeholder="Exact registered name"
                    />
                  </div>

                  <div>
                    <label className={label}>Registration date</label>
                    <input type="date" value={form.regDate} onChange={onChange("regDate")} className={input} />
                    <p className={help}>Must match CAC registration date (YYYY-MM-DD).</p>
                  </div>

                  <div className="flex items-end">
                    <div className="w-full rounded-xl border bg-zinc-50 px-3 py-2.5 text-sm text-zinc-700">
                      <div className="w-full rounded-xl border bg-zinc-50 px-3 py-2.5 text-sm text-zinc-700">
                        {statusText ? (
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">Status</span>
                            <span
                              className={`text-xs px-2 py-1 rounded-full border ${supplierAlreadyRegistered
                                ? "bg-rose-50 text-rose-700 border-rose-200"
                                : canProceed
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-amber-50 text-amber-800 border-amber-200"
                                }`}
                            >
                              {statusText}
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-zinc-500">
                              Verify CAC to unlock supplier registration.
                            </span>

                            <button
                              type="button"
                              onClick={lookupCac}
                              disabled={kycLoading}
                              className="
          shrink-0
          w-full sm:w-auto
          inline-flex items-center justify-center
          rounded-xl bg-zinc-900 text-white
          px-4 py-2.5 text-sm font-semibold
          hover:opacity-95 disabled:opacity-60 transition
        "
                            >
                              {kycLoading ? (
                                <>
                                  <span className="mr-2 inline-block h-4 w-4 rounded-full border-[2px] border-white/40 border-t-white animate-spin" />
                                  Checking…
                                </>
                              ) : (
                                "Verify CAC"
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {kycEntity && (
                  <div
                    className={`rounded-xl border px-3 py-3 text-xs ${supplierAlreadyRegistered
                      ? "border-rose-200 bg-rose-50 text-zinc-800"
                      : canProceed
                        ? "border-emerald-200 bg-emerald-50 text-zinc-800"
                        : "border-amber-200 bg-amber-50 text-zinc-800"
                      }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-zinc-900 truncate">
                          {kycEntity.company_name}{" "}
                          <span className="font-mono text-[11px] text-zinc-600">(RC {kycEntity.rc_number})</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-zinc-600">
                          {kycEntity.type_of_company} • Registered{" "}
                          {kycEntity.date_of_registration
                            ? normalizeDateToYMD(kycEntity.date_of_registration) ?? "—"
                            : "—"}
                        </div>
                      </div>

                      {!supplierAlreadyRegistered && (
                        <span
                          className={`shrink-0 text-[11px] px-2 py-1 rounded-full border ${canProceed
                            ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                            : "bg-rose-100 text-rose-700 border-rose-200"
                            }`}
                        >
                          {canProceed ? "✓ Matches" : "✗ Mismatch"}
                        </span>
                      )}
                    </div>

                    {supplierAlreadyRegistered && (
                      <div className="mt-2 text-[11px]">
                        Please{" "}
                        <a href="/login?supplier=1" className="font-semibold underline">
                          sign in
                        </a>{" "}
                        or contact support if you believe this is an error.
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Contact stage (only if verified) */}
              {canProceed ? (
                <>
                  <div className="h-px bg-zinc-100" />

                  <section className="space-y-3">
                    <h2 className="text-sm font-semibold text-zinc-900">Primary contact & password</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className={label}>Contact first name</label>
                        <input
                          value={form.contactFirstName}
                          onChange={onChange("contactFirstName")}
                          className={input}
                          placeholder="First name"
                        />
                      </div>

                      <div>
                        <label className={label}>Contact last name</label>
                        <input
                          value={form.contactLastName}
                          onChange={onChange("contactLastName")}
                          className={input}
                          placeholder="Last name"
                        />
                      </div>

                      <div>
                        <label className={label}>Contact email (login)</label>
                        <input
                          type="email"
                          value={form.contactEmail}
                          onChange={onChange("contactEmail")}
                          className={input}
                          placeholder="you@business.com"
                        />
                      </div>

                      <div>
                        <label className={label}>Contact WhatsApp number</label>
                        <input
                          value={form.contactPhone}
                          onChange={onChange("contactPhone")}
                          className={input}
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="+234 801 234 5678"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className={label}>Password</label>
                        <input
                          type="password"
                          value={form.password}
                          onChange={onChange("password")}
                          className={input}
                          placeholder="At least 8 characters"
                        />
                        <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className={`h-full transition-all ${pwdStrength <= 1
                              ? "w-1/4 bg-rose-400"
                              : pwdStrength === 2
                                ? "w-2/4 bg-amber-400"
                                : pwdStrength === 3
                                  ? "w-3/4 bg-lime-400"
                                  : "w-full bg-emerald-400"
                              }`}
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Include a letter, number, and special character.
                        </p>
                      </div>

                      <div>
                        <label className={label}>Confirm password</label>
                        <input
                          type="password"
                          value={form.confirmPassword}
                          onChange={onChange("confirmPassword")}
                          className={input}
                          placeholder="Re-enter password"
                        />
                        {form.confirmPassword && (
                          <div className="mt-1 text-[11px]">
                            {form.password === form.confirmPassword ? (
                              <span className="text-emerald-600 font-semibold">Passwords match ✅</span>
                            ) : (
                              <span className="text-rose-600 font-semibold">Passwords do not match</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full inline-flex items-center justify-center rounded-xl bg-zinc-900 text-white px-4 py-3 font-semibold shadow-sm hover:opacity-95 transition disabled:opacity-60"
                  >
                    {submitting ? "Creating supplier account…" : "Create supplier account"}
                  </button>

                  <p className="text-center text-xs text-slate-600">
                    By continuing, you agree to our{" "}
                    <a className="text-violet-700 hover:underline" href="/terms">
                      Terms
                    </a>{" "}
                    and{" "}
                    <a className="text-violet-700 hover:underline" href="/privacy">
                      Privacy Policy
                    </a>
                    .
                  </p>
                </>
              ) : (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-xs text-zinc-700">
                  Complete CAC verification above to unlock the contact & password section.
                </div>
              )}
            </form>

            <p className="mt-4 text-center text-sm text-zinc-700">
              Already a supplier?{" "}
              <a className="text-violet-700 hover:underline" href="/login?supplier=1">
                Sign in
              </a>
            </p>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
