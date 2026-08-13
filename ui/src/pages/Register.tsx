// src/pages/Register.tsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import api from "../api/client";
import SiteLayout from "../layouts/SiteLayout";
import { getApiBase } from "../lib/apiBase";
import { COUNTRIES } from "../constants/countries";

type Role = "SHOPPER";
type RegisterResponse = {
  message: string;
  tempToken?: string;
  phoneOtpSent?: boolean;
  emailSent?: boolean;
};

export default function Register() {
  const [form, setForm] = useState({
    email: "",
    firstName: "",
    middleName: "",
    lastName: "",
    password: "",
    confirmPassword: "",
    role: "SHOPPER" as Role,
    dateOfBirth: "",
    phoneCountryCode: "234",
    localPhone: "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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

    const pwd = form.password ?? "";
    const hasMinLen = pwd.length >= 8;
    const hasLetter = /[A-Za-z]/.test(pwd);
    const hasNumber = /\d/.test(pwd);
    const hasSpecial = /[^A-Za-z0-9]/.test(pwd);

    if (!hasMinLen || !hasLetter || !hasNumber || !hasSpecial) {
      return "Password must be at least 8 characters and include a letter, a number, and a special character.";
    }

    if (form.password !== form.confirmPassword) {
      return "Passwords do not match";
    }

    if (!form.dateOfBirth) return "Please select your date of birth";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth)) {
      return "Please use a valid date (YYYY-MM-DD).";
    }

    const yearStr = form.dateOfBirth.slice(0, 4);
    if (!/^\d{4}$/.test(yearStr)) return "Birth year must be exactly 4 digits.";

    const dob = new Date(`${form.dateOfBirth}T00:00:00`);
    if (Number.isNaN(+dob)) return "Please select a valid date of birth";

    const today = new Date();

    const getAgeYears = (birth: Date, now: Date) => {
      let age = now.getFullYear() - birth.getFullYear();
      const m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
      return age;
    };

    const age = getAgeYears(dob, today);

    if (age < 16) return "You must be at least 16 years old to register";
    if (age > 125) return "Please enter a valid date of birth (age must be 125 or younger)";

    if (form.localPhone.trim()) {
      const digits = form.localPhone.replace(/[^\d]/g, "");
      if (digits.length < 6 || digits.length > 15) {
        return "Please enter a valid phone number";
      }
    }

    return null;
  };

  const scrollTopOnError = () => {
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      //
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

      const localPhone = form.localPhone.trim();

      const payload = {
        email: form.email.trim().toLowerCase(),
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || undefined,
        lastName: form.lastName.trim(),
        password: form.password,
        role: form.role,
        dateOfBirth: form.dateOfBirth
          ? new Date(`${form.dateOfBirth}T00:00:00`).toISOString()
          : undefined,
        dialCode: localPhone ? `+${form.phoneCountryCode}` : undefined,
        localPhone: localPhone || undefined,
      };

      const { data } = await api.post<RegisterResponse>("/api/auth/register", payload);

      try {
        localStorage.setItem("verifyEmail", payload.email);
        if (data?.tempToken) localStorage.setItem("verifyToken", data.tempToken);
        if (data?.phoneOtpSent) localStorage.setItem("verifyPhonePending", "1");
        else localStorage.removeItem("verifyPhonePending");
      } catch {
        //
      }

      const q = new URLSearchParams({
        e: payload.email,
        ...(data?.phoneOtpSent ? { phone: "1" } : {}),
      }).toString();
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

  const inputBase =
    "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[16px] text-slate-900 placeholder:text-slate-400 " +
    "outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm";

  const labelBase = "block text-sm font-semibold text-slate-800 mb-1";

  const passwordInputBase = `${inputBase} pr-12`;

  const toggleBtnBase =
    "absolute inset-y-0 right-0 w-11 flex items-center justify-center text-slate-500 hover:text-slate-700";

  return (
    <SiteLayout>
      <div className="min-h-[100dvh] relative overflow-hidden bg-gradient-to-b from-zinc-50 to-white">
        <div className="pointer-events-none absolute -top-28 -right-20 w-[26rem] h-[26rem] rounded-full blur-3xl opacity-30 bg-fuchsia-300/50" />
        <div className="pointer-events-none absolute -bottom-28 -left-16 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-25 bg-cyan-300/50" />

        <div className="relative px-3 sm:px-4 py-6 sm:py-10">
          <div className="mx-auto w-full max-w-lg">
            <div className="mb-5 text-center">
              <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-900">
                Create your account
              </h1>
              <p className="mt-1 text-sm text-zinc-600">
                Shop smarter with saved details, order tracking, and personalised picks.
              </p>
            </div>

            <div className="rounded-2xl border bg-white/95 shadow-sm p-4 sm:p-6 mb-4">
              <a
                href={`${getApiBase()}/api/auth/google`}
                className="inline-flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-zinc-200"
              >
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.14 0 5.95 1.08 8.17 2.85l6.08-6.08C34.46 3.14 29.5 1 24 1 14.72 1 6.93 6.56 3.27 14.44l7.07 5.49C12.1 13.44 17.58 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.5 24.5c0-1.64-.15-3.22-.43-4.75H24v9h12.68c-.55 2.99-2.22 5.52-4.72 7.22l7.25 5.63C43.44 37.45 46.5 31.44 46.5 24.5z" />
                  <path fill="#FBBC05" d="M10.34 28.07A14.57 14.57 0 0 1 9.5 24c0-1.41.2-2.78.56-4.07l-7.07-5.49A23.9 23.9 0 0 0 .5 24c0 3.84.92 7.47 2.55 10.69l7.29-6.62z" />
                  <path fill="#34A853" d="M24 46.5c5.94 0 10.93-1.97 14.57-5.35l-7.25-5.63c-2.01 1.35-4.59 2.15-7.32 2.15-6.42 0-11.9-3.94-13.66-9.43l-7.29 6.62C6.93 41.44 14.72 47 24 47z" />
                  <path fill="none" d="M0 0h48v48H0z" />
                </svg>
                Continue with Google
              </a>

              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-zinc-200" />
                <span className="text-xs text-zinc-400">or sign up with email</span>
                <div className="h-px flex-1 bg-zinc-200" />
              </div>

              <form onSubmit={submit} className="space-y-4">
                {err && (
                  <div className="text-sm rounded-xl border border-rose-300/60 bg-rose-50 text-rose-700 px-3 py-2">
                    {err}
                  </div>
                )}

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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label htmlFor="register-email" className={labelBase}>Email</label>
                  <input
                    id="register-email"
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
                  <p className="mt-1 text-xs text-slate-500">Must be 16+ years old.</p>
                </div>
              </div>

              <div>
                <label className={labelBase}>Phone number (optional)</label>
                <div className="grid grid-cols-[110px_1fr] gap-2">
                  <select
                    value={form.phoneCountryCode}
                    onChange={onChange("phoneCountryCode")}
                    className={inputBase}
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.phoneCode}>
                        {c.code} +{c.phoneCode}
                      </option>
                    ))}
                  </select>
                  <input
                    value={form.localPhone}
                    onChange={onChange("localPhone")}
                    className={inputBase}
                    placeholder="801 234 5678"
                    inputMode="tel"
                    autoComplete="tel-national"
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Add a phone number to also verify by WhatsApp and use it for order updates.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className={labelBase}>Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      name="password"
                      autoComplete="new-password"
                      value={form.password}
                      onChange={onChange("password")}
                      className={passwordInputBase}
                      placeholder="At least 8 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className={toggleBtnBase}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        pwdStrength <= 1
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
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      name="confirmPassword"
                      autoComplete="new-password"
                      value={form.confirmPassword}
                      onChange={onChange("confirmPassword")}
                      className={passwordInputBase}
                      placeholder="Re-enter"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      className={toggleBtnBase}
                      aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    >
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {form.confirmPassword && (
                    <div className="mt-1 text-[11px]">
                      {form.password === form.confirmPassword ? (
                        <span className="text-emerald-600 font-semibold">
                          Passwords match ✅
                        </span>
                      ) : (
                        <span className="text-rose-600 font-semibold">
                          Passwords do not match
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

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
            </div>

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