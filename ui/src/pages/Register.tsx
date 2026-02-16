// src/pages/Register.tsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import SiteLayout from "../layouts/SiteLayout";

type Role = "SHOPPER";
type RegisterResponse = {
  message: string;
  tempToken?: string;
  phoneOtpSent?: boolean;
};

type Country = { name: string; code: string; dial: string };
const COUNTRIES: Country[] = [
  { name: "Country", code: "", dial: "dial" },
  { name: "Nigeria", code: "NG", dial: "+234" },
  { name: "United States", code: "US", dial: "+1" },
  { name: "United Kingdom", code: "GB", dial: "+44" },
  { name: "Canada", code: "CA", dial: "+1" },
  { name: "Ghana", code: "GH", dial: "+233" },
  { name: "Kenya", code: "KE", dial: "+254" },
  { name: "South Africa", code: "ZA", dial: "+27" },
  { name: "India", code: "IN", dial: "+91" },
  { name: "Ireland", code: "IE", dial: "+353" },
  { name: "Germany", code: "DE", dial: "+49" },
  { name: "France", code: "FR", dial: "+33" },
  { name: "Finland", code: "FI", dial: "+358" },
  { name: "Spain", code: "ES", dial: "+34" },
  { name: "Italy", code: "IT", dial: "+39" },
  { name: "Netherlands", code: "NL", dial: "+31" },
  { name: "Sweden", code: "SE", dial: "+46" },
  { name: "Norway", code: "NO", dial: "+47" },
  { name: "Denmark", code: "DK", dial: "+45" },
  { name: "Switzerland", code: "CH", dial: "+41" },
  { name: "Brazil", code: "BR", dial: "+55" },
  { name: "Mexico", code: "MX", dial: "+52" },
  { name: "Australia", code: "AU", dial: "+61" },
  { name: "New Zealand", code: "NZ", dial: "64" },
  { name: "UAE", code: "AE", dial: "+971" },
  { name: "Saudi Arabia", code: "SA", dial: "+966" },
  { name: "Turkey", code: "TR", dial: "+90" },
  { name: "Egypt", code: "EG", dial: "+20" },
  { name: "Morocco", code: "MA", dial: "+212" },
  { name: "Côte d’Ivoire", code: "CI", dial: "+225" },
  { name: "Cameroon", code: "CM", dial: "+237" },
  { name: "Ethiopia", code: "ET", dial: "+251" },
];

export default function Register() {
  const [form, setForm] = useState({
    email: "",
    firstName: "",
    middleName: "",
    lastName: "",
    countryDial: "dial",
    localPhone: "",
    password: "",
    confirmPassword: "",
    role: "SHOPPER" as Role,
    dateOfBirth: "", // YYYY-MM-DD
  });

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();

  const onChange =
    (key: keyof typeof form) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setForm((f) => ({ ...f, [key]: e.target.value }));
      };

  const onDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value;
    if (v) {
      const parts = v.split("-");
      if (parts[0]) {
        parts[0] = parts[0].replace(/\D/g, "");
        if (parts[0].length > 4) parts[0] = parts[0].slice(0, 4);
      }
      v = parts.filter((p) => p !== undefined).join("-");
    }
    setForm((f) => ({ ...f, dateOfBirth: v }));
  };

  const validate = () => {
    if (!form.firstName.trim()) return "Please enter your first name";
    if (!form.lastName.trim()) return "Please enter your last name";
    if (!form.email.trim()) return "Please enter your email";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return "Please enter a valid email";
    if (form.countryDial === "dial") {
      return "Please select your country code";
    }

    const pwd = form.password ?? "";
    const hasMinLen = pwd.length >= 8;
    const hasLetter = /[A-Za-z]/.test(pwd);
    const hasNumber = /\d/.test(pwd);
    const hasSpecial = /[^A-Za-z0-9]/.test(pwd);
    if (!hasMinLen || !hasLetter || !hasNumber || !hasSpecial) {
      return "Password must be at least 8 characters and include a letter, a number, and a special character.";
    }

    if (form.password !== form.confirmPassword) return "Passwords do not match";

    const localDigits = form.localPhone.replace(/\D/g, "");
    if (localDigits && localDigits.length < 6) return "Please enter a valid phone number";

    if (!form.dateOfBirth) return "Please select your date of birth";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth)) {
      return "Please use a valid date (YYYY-MM-DD).";
    }
    const yearStr = form.dateOfBirth.slice(0, 4);
    if (!/^\d{4}$/.test(yearStr)) return "Birth year must be exactly 4 digits.";

    const dob = new Date(form.dateOfBirth + "T00:00:00");
    if (Number.isNaN(+dob)) return "Please select a valid date of birth";

    const today = new Date();

    // helper: exact age in years (integer)
    const getAgeYears = (birth: Date, now: Date) => {
      let age = now.getFullYear() - birth.getFullYear();
      const m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
      return age;
    };

    const age = getAgeYears(dob, today);

    if (age < 16) return "You must be at least 18 years old to register";
    if (age > 125) return "Please enter a valid date of birth (age must be 125 or younger)";

    return null;
  };

  const scrollTopOnError = () => {
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      /* noop */
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

      const phone = form.localPhone.trim()
        ? `+${form.countryDial}${form.localPhone.replace(/\D/g, "")}`
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

      const { data } = await api.post<RegisterResponse>("/api/auth/register", payload);

      try {
        localStorage.setItem("verifyEmail", payload.email);
        if (data?.tempToken) localStorage.setItem("verifyToken", data.tempToken);
      } catch { }

      const q = new URLSearchParams({ e: payload.email }).toString();
      nav(`/verify?${q}`);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Registration failed");
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

  // shared input styles (✅ smaller on mobile, not huge pills)
  const inputBase =
    "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[16px] text-slate-900 placeholder:text-slate-400 " +
    "outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm";

  const labelBase = "block text-sm font-semibold text-slate-800 mb-1";

  return (
    <SiteLayout>
      <div className="min-h-[100dvh] relative overflow-hidden bg-gradient-to-b from-zinc-50 to-white">
        {/* soft blobs (lighter than before for mobile readability) */}
        <div className="pointer-events-none absolute -top-28 -right-20 w-[26rem] h-[26rem] rounded-full blur-3xl opacity-30 bg-fuchsia-300/50" />
        <div className="pointer-events-none absolute -bottom-28 -left-16 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-25 bg-cyan-300/50" />

        <div className="relative px-3 sm:px-4 py-6 sm:py-10">
          {/* ✅ Full-width on mobile; card breathes nicely */}
          <div className="mx-auto w-full max-w-lg">
            {/* Header */}
            <div className="mb-5 text-center">
              <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-900">Create your account</h1>
              <p className="mt-1 text-sm text-zinc-600">
                Shop smarter with saved details, order tracking, and personalised picks.
              </p>
            </div>

            <form
              onSubmit={submit}
              className="rounded-2xl border bg-white/95 shadow-sm p-4 sm:p-6 space-y-4"
            >
              {err && (
                <div className="text-sm rounded-xl border border-rose-300/60 bg-rose-50 text-rose-700 px-3 py-2">
                  {err}
                </div>
              )}

              {/* Name */}
              <div>
                <label className={labelBase}>Your name</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    value={form.firstName}
                    onChange={onChange("firstName")}
                    className={inputBase}
                    placeholder="First"
                    autoComplete="given-name"
                  />
                  <input
                    value={form.middleName}
                    onChange={onChange("middleName")}
                    className={inputBase}
                    placeholder="Middle (opt.)"
                    autoComplete="additional-name"
                  />
                  <input
                    value={form.lastName}
                    onChange={onChange("lastName")}
                    className={inputBase}
                    placeholder="Last"
                    autoComplete="family-name"
                  />
                </div>
              </div>

              {/* Email + DOB */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className={labelBase}>Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={onChange("email")}
                    className={inputBase}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>

                <div>
                  <label className={labelBase}>Date of birth</label>
                  <input
                    type="date"
                    value={form.dateOfBirth}
                    onChange={onDateChange}
                    className={inputBase}
                  />
                  <p className="mt-1 text-xs text-slate-500">Must be 18+ years old.</p>
                </div>
              </div>

              {/* Phone (✅ compact 2-col on mobile) */}
              <div>
                <label className={labelBase}>Phone</label>
                <div className="grid grid-cols-[9rem,1fr] gap-2">
                  <select
                    value={form.countryDial}
                    onChange={(e) => setForm((f) => ({ ...f, countryDial: e.target.value }))}
                    className={inputBase}
                    aria-label="Country code"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={`${c.code}-${c.dial}`} value={c.dial}>
                        {c.name} {c.dial && c.dial !== "dial" ? `(${c.dial})` : ""}
                      </option>
                    ))}
                  </select>

                  <input
                    value={form.localPhone}
                    onChange={onChange("localPhone")}
                    inputMode="tel"
                    autoComplete="tel-national"
                    className={inputBase}
                    placeholder="Local number"
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Format: {form.countryDial === "dial" ? "—" : `${form.countryDial} ${form.localPhone.replace(/\D/g, "")}`}
                </p>
              </div>

              {/* Passwords */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className={labelBase}>Password</label>
                  <input
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={onChange("password")}
                    className={inputBase}
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
                    Letter + number + special character.
                  </p>
                </div>

                <div>
                  <label className={labelBase}>Confirm password</label>
                  <input
                    type="password"
                    name="confirmPassword"
                    autoComplete="new-password"
                    value={form.confirmPassword}
                    onChange={onChange("confirmPassword")}
                    className={inputBase}
                    placeholder="Re-enter"
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

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center rounded-xl bg-zinc-900 text-white px-4 py-3 font-semibold shadow-sm hover:opacity-95 transition disabled:opacity-60"
              >
                {submitting ? "Creating account…" : "Create account"}
              </button>

              <p className="text-center text-xs text-slate-600">
                By creating an account, you agree to our{" "}
                <a className="text-violet-700 hover:underline" href="/terms">
                  Terms
                </a>{" "}
                and{" "}
                <a className="text-violet-700 hover:underline" href="/privacy">
                  Privacy Policy
                </a>
                .
              </p>
            </form>

            <p className="mt-4 text-center text-sm text-zinc-700">
              Already have an account?{" "}
              <a className="text-violet-700 hover:underline" href="/login">
                Sign in
              </a>
            </p>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
