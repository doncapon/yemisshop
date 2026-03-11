import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import api from "../../api/client";
import SiteLayout from "../../layouts/SiteLayout";

type SupplierRole = "SUPPLIER";
type RegistrationType = "INDIVIDUAL" | "REGISTERED_BUSINESS" | "";

type RegisterSupplierResponse = {
  message: string;
  supplierId?: string;
  tempToken?: string;
  emailSent?: boolean;
  phoneOtpSent?: boolean;
};

const VERIFY_ROUTE = "/supplier/verify-contact";

export default function SupplierRegister() {
  const nav = useNavigate();

  const [form, setForm] = useState({
    businessName: "",
    legalName: "",
    registeredBusinessName: "",
    registrationType: "" as RegistrationType,
    registrationCountryCode: "NG",

    contactFirstName: "",
    contactLastName: "",

    contactEmail: "",
    contactPhone: "",

    password: "",
    confirmPassword: "",

    role: "SUPPLIER" as SupplierRole,
  });

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [countries, setCountries] = useState<any[]>([]);

  const scrollTopOnError = () => {
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
  };

  useEffect(() => {
    api
      .get("/api/public/supplier-registration-countries")
      .then((res) => {
        setCountries(res.data?.data || []);
      })
      .catch(() => {
        setCountries([]);
      });
  }, []);

  const onChange =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const val = e.target.value;

      setForm((f) => ({
        ...f,
        [key]: val,
      }));

      setErr(null);
    };

  const legalEntityLabel =
    form.registrationType === "REGISTERED_BUSINESS"
      ? "Company legal name"
      : "Full legal name";

  const legalEntityHelp =
    form.registrationType === "REGISTERED_BUSINESS"
      ? "Official legal name of the company responsible for this account."
      : "Your full legal name as the person responsible for this account.";

  const validate = () => {
    if (!form.businessName.trim()) return "Please enter your store name";
    if (!form.registrationType) return "Please select registration type";
    if (!form.legalName.trim()) {
      return `Please enter ${legalEntityLabel.toLowerCase()}`;
    }

    if (
      form.registrationType === "REGISTERED_BUSINESS" &&
      !form.registeredBusinessName.trim()
    ) {
      return "Please enter your registered business name";
    }

    if (!form.contactFirstName.trim()) return "Please enter first name";
    if (!form.contactLastName.trim()) return "Please enter last name";

    if (!form.contactEmail.trim()) return "Please enter email";
    if (!/^\S+@\S+\.\S+$/.test(form.contactEmail)) {
      return "Please enter a valid email";
    }

    const phoneDigits = form.contactPhone.replace(/\D/g, "");
    if (!phoneDigits) return "Please enter phone number";
    if (phoneDigits.length < 6) return "Please enter a valid phone number";

    const pwd = form.password ?? "";
    const hasMinLen = pwd.length >= 8;
    const hasLetter = /[A-Za-z]/.test(pwd);
    const hasNumber = /\d/.test(pwd);
    const hasSpecial = /[^A-Za-z0-9]/.test(pwd);

    if (!hasMinLen || !hasLetter || !hasNumber || !hasSpecial) {
      return "Password must be at least 8 characters and include a letter, number and special character.";
    }

    if (form.password !== form.confirmPassword) {
      return "Passwords do not match";
    }

    return null;
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

      const email = form.contactEmail.trim().toLowerCase();
      const phone = form.contactPhone.trim();
      const businessName = form.businessName.trim();
      const legalName = form.legalName.trim();
      const registeredBusinessName =
        form.registrationType === "REGISTERED_BUSINESS"
          ? form.registeredBusinessName.trim() || legalName || businessName
          : null;

      const payload = {
        role: "SUPPLIER" as const,

        businessName,
        name: businessName,

        legalName,
        registeredBusinessName,

        registrationType: form.registrationType,
        registrationCountryCode: form.registrationCountryCode,

        supplierType: "PHYSICAL" as const,
        type: "PHYSICAL" as const,

        contactFirstName: form.contactFirstName.trim(),
        contactLastName: form.contactLastName.trim(),

        firstName: form.contactFirstName.trim(),
        lastName: form.contactLastName.trim(),

        contactEmail: email,
        email,

        contactPhone: phone,
        phone,
        whatsappPhone: phone,

        password: form.password,
      };

      const { data } = await api.post<RegisterSupplierResponse>(
        "/api/auth/register-supplier",
        payload
      );

      try {
        if (data?.tempToken) {
          localStorage.setItem("tempToken", data.tempToken);
        }
      } catch {}

      nav(VERIFY_ROUTE, {
        replace: true,
        state: {
          supplierId: data?.supplierId ?? null,
          email,
          phone,
          emailSent: !!data?.emailSent,
          phoneOtpSent: !!data?.phoneOtpSent,
          nextAfterVerify: "/supplier/onboarding",
          flow: "supplier-register",
        },
      });
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        "Supplier registration failed";

      setErr(msg);
      scrollTopOnError();
    } finally {
      setSubmitting(false);
    }
  };

  const label = "block text-sm font-semibold text-slate-800 mb-1.5";
  const helpText = "mt-1 text-xs text-zinc-500";

  const input =
    "w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] md:text-sm text-slate-900 " +
    "placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm";

  const card =
    "rounded-[28px] border border-white/70 bg-white/95 backdrop-blur shadow-[0_16px_50px_rgba(15,23,42,0.08)] p-4 sm:p-6 md:p-8 space-y-6";

  const stepBase =
    "flex items-center gap-2 rounded-full border px-3 py-2 text-xs sm:text-sm";
  const stepActive = "border-zinc-900 bg-zinc-900 text-white shadow-sm";
  const stepPending = "border-zinc-200 bg-white text-zinc-600";

  return (
    <SiteLayout>
      <div className="min-h-[100dvh] bg-gradient-to-b from-zinc-50 to-white">
        <div className="px-3 sm:px-4 py-6 sm:py-10">
          <div className="mx-auto w-full max-w-4xl">
            <div className="mb-6 space-y-4">
              <div className="text-center">
                <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-900">
                  Create your supplier account
                </h1>
                <p className="mt-2 text-sm text-zinc-600">
                  Start with a few details. After this, you’ll verify your email and phone before completing the rest of onboarding.
                </p>
              </div>

              <div className="mx-auto grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                <div className={`${stepBase} ${stepActive}`}>
                  <CheckCircle2 size={16} />
                  <span>Create account</span>
                </div>

                <div className={`${stepBase} ${stepPending}`}>
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    2
                  </span>
                  <span>Verify email / phone</span>
                </div>
              </div>

              <div className="text-center text-xs text-zinc-500">
                More setup steps like business details, address details and documents will appear after verification.
              </div>
            </div>

            <form onSubmit={submit} className={card}>
              {err && (
                <div className="rounded-xl border border-rose-300 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
                  {err}
                </div>
              )}

              <section className="space-y-4">
                <h2 className="text-sm font-semibold text-zinc-900">
                  Business information
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className={label}>Store name</label>
                    <p className={helpText}>
                      This is the name customers will see on your storefront.
                    </p>
                    <input
                      value={form.businessName}
                      onChange={onChange("businessName")}
                      className={input}
                      placeholder="Store name"
                      autoComplete="organization"
                    />
                  </div>

                  <div>
                    <label className={label}>{legalEntityLabel}</label>
                    <p className={helpText}>{legalEntityHelp}</p>
                    <input
                      value={form.legalName}
                      onChange={onChange("legalName")}
                      className={input}
                      placeholder={legalEntityLabel}
                    />
                  </div>

                  <div>
                    <label className={label}>Registration type</label>
                    <p className={helpText}>
                      Tell us whether you are registering as an individual or a formally registered business.
                    </p>
                    <select
                      value={form.registrationType}
                      onChange={onChange("registrationType")}
                      className={input}
                    >
                      <option value="">Select</option>
                      <option value="INDIVIDUAL">Individual</option>
                      <option value="REGISTERED_BUSINESS">Registered business</option>
                    </select>
                  </div>

                  {form.registrationType === "REGISTERED_BUSINESS" && (
                    <div className="md:col-span-2">
                      <label className={label}>Registered business name</label>
                      <p className={helpText}>
                        Enter the name exactly as it appears on your business registration document.
                      </p>
                      <input
                        value={form.registeredBusinessName}
                        onChange={onChange("registeredBusinessName")}
                        className={input}
                        placeholder="Registered business name"
                      />
                    </div>
                  )}

                  <div>
                    <label className={label}>Registration country</label>
                    <p className={helpText}>
                      Country where the person or business is legally registered.
                    </p>
                    <select
                      value={form.registrationCountryCode}
                      onChange={onChange("registrationCountryCode")}
                      className={input}
                    >
                      {countries.length === 0 && <option>Loading countries...</option>}
                      {countries.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <div className="h-px bg-zinc-100" />

              <section className="space-y-4">
                <h2 className="text-sm font-semibold text-zinc-900">
                  Primary contact
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    value={form.contactFirstName}
                    onChange={onChange("contactFirstName")}
                    className={input}
                    placeholder="First name"
                    autoComplete="given-name"
                  />

                  <input
                    value={form.contactLastName}
                    onChange={onChange("contactLastName")}
                    className={input}
                    placeholder="Last name"
                    autoComplete="family-name"
                  />

                  <input
                    type="email"
                    value={form.contactEmail}
                    onChange={onChange("contactEmail")}
                    className={input}
                    placeholder="Email"
                    autoComplete="email"
                  />

                  <input
                    value={form.contactPhone}
                    onChange={onChange("contactPhone")}
                    className={input}
                    placeholder="Phone / WhatsApp"
                    autoComplete="tel"
                  />
                </div>
              </section>

              <div className="h-px bg-zinc-100" />

              <section className="space-y-4">
                <h2 className="text-sm font-semibold text-zinc-900">
                  Password
                </h2>

                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={onChange("password")}
                    className={`${input} pr-12`}
                    placeholder="Password"
                    autoComplete="new-password"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={form.confirmPassword}
                    onChange={onChange("confirmPassword")}
                    className={`${input} pr-12`}
                    placeholder="Confirm password"
                    autoComplete="new-password"
                  />

                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                    aria-label={
                      showConfirmPassword
                        ? "Hide confirm password"
                        : "Show confirm password"
                    }
                  >
                    {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </section>

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                Next, you’ll verify your email and phone. After that, we’ll guide you through the remaining onboarding steps one stage at a time.
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-2xl bg-zinc-900 text-white px-4 py-3 font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting
                  ? "Creating supplier account…"
                  : "Create supplier account"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}