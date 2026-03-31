// src/pages/supplier/SupplierRegister.tsx
import React, { useEffect, useMemo, useState } from "react";
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
  emailSent?: boolean | string | number | null;
  phoneOtpSent?: boolean | string | number | null;
};

type CountryOption = {
  code: string;
  name: string;
  phoneCode: string;
  allowSupplierRegistration: boolean;
};

type FormState = {
  businessName: string;
  legalName: string;
  registeredBusinessName: string;
  registrationType: RegistrationType;
  registrationCountryCode: string;

  contactFirstName: string;
  contactLastName: string;

  contactEmail: string;
  contactPhone: string;
  contactDialCode: string;

  password: string;
  confirmPassword: string;

  role: SupplierRole;
};

type FieldName =
  | "businessName"
  | "legalName"
  | "registeredBusinessName"
  | "registrationType"
  | "registrationCountryCode"
  | "contactFirstName"
  | "contactLastName"
  | "contactEmail"
  | "contactPhone"
  | "contactDialCode"
  | "password"
  | "confirmPassword";

type FieldErrors = Partial<Record<FieldName, string>>;

const VERIFY_ROUTE = "/supplier/verify-contact";

function asSentFlag(v: unknown) {
  if (v === true) return true;
  if (v === 1) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "sent";
}

function normalizeDialCode(raw: unknown): string {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
}

function extractCountryDialCode(country: CountryOption | undefined): string {
  if (!country) return "";
  return normalizeDialCode(country.phoneCode);
}

function buildInputClass(base: string, hasError: boolean) {
  return hasError
    ? `${base} border-rose-400 focus:border-rose-500 focus:ring-rose-200 bg-rose-50/40`
    : base;
}

export default function SupplierRegister() {
  const nav = useNavigate();

  const [form, setForm] = useState<FormState>({
    businessName: "",
    legalName: "",
    registeredBusinessName: "",
    registrationType: "" as RegistrationType,
    registrationCountryCode: "NG",

    contactFirstName: "",
    contactLastName: "",

    contactEmail: "",
    contactPhone: "",
    contactDialCode: "",

    password: "",
    confirmPassword: "",

    role: "SUPPLIER" as SupplierRole,
  });

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [countries, setCountries] = useState<CountryOption[]>([]);

  const scrollTopOnError = () => {
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
  };

  useEffect(() => {
    api
      .get("/api/public/supplier-registration-countries")
      .then((res) => {
        const rows = Array.isArray(res.data?.data) ? res.data.data : [];
        setCountries(rows);

        setForm((prev) => {
          const selected =
            rows.find((c: CountryOption) => c.code === prev.registrationCountryCode) ||
            rows.find((c: CountryOption) => c.code === "NG") ||
            rows[0];

          const dialCode = prev.contactDialCode || extractCountryDialCode(selected);

          return {
            ...prev,
            registrationCountryCode: prev.registrationCountryCode || selected?.code || "NG",
            contactDialCode: dialCode,
          };
        });
      })
      .catch(() => {
        setCountries([]);
      });
  }, []);

  const selectedCountry = useMemo(
    () =>
      countries.find((c) => c.code === form.registrationCountryCode) ||
      countries.find((c) => c.code === "NG") ||
      countries[0],
    [countries, form.registrationCountryCode]
  );

  const selectedCountryDialCode = useMemo(
    () => extractCountryDialCode(selectedCountry),
    [selectedCountry]
  );

  const dialCodeOptions = useMemo(() => {
    const seen = new Set<string>();

    return countries
      .map((c) => {
        const dial = extractCountryDialCode(c);
        if (!dial) return null;

        const key = `${c.code}-${dial}`;
        const label = `${c.name} (${dial})`;

        return {
          key,
          value: dial,
          label,
        };
      })
      .filter((item): item is { key: string; value: string; label: string } => !!item)
      .filter((item) => {
        const uniqueKey = `${item.value}::${item.label}`;
        if (seen.has(uniqueKey)) return false;
        seen.add(uniqueKey);
        return true;
      });
  }, [countries]);

  useEffect(() => {
    if (!form.contactDialCode && selectedCountryDialCode) {
      setForm((prev) => ({
        ...prev,
        contactDialCode: selectedCountryDialCode,
      }));
    }
  }, [form.contactDialCode, selectedCountryDialCode]);

  const clearFieldError = (key: FieldName) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const onChange =
    (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const val = e.target.value;

      setForm((f) => {
        const next = {
          ...f,
          [key]: val,
        };

        if (key === "registrationCountryCode") {
          const nextCountry =
            countries.find((c) => c.code === val) ||
            countries.find((c) => c.code === "NG") ||
            countries[0];
          const nextDialCode = extractCountryDialCode(nextCountry);

          if (nextDialCode) {
            next.contactDialCode = nextDialCode;
          }
        }

        if (key === "contactDialCode") {
          next.contactDialCode = normalizeDialCode(val);
        }

        return next;
      });

      setErr(null);
      if (key in fieldErrors) {
        clearFieldError(key as FieldName);
      }
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
    const errors: FieldErrors = {};

    if (!form.businessName.trim()) {
      errors.businessName = "Please enter your store name";
    }

    if (!form.registrationType) {
      errors.registrationType = "Please select registration type";
    }

    if (!form.legalName.trim()) {
      errors.legalName = `Please enter ${legalEntityLabel.toLowerCase()}`;
    }

    if (
      form.registrationType === "REGISTERED_BUSINESS" &&
      !form.registeredBusinessName.trim()
    ) {
      errors.registeredBusinessName = "Please enter your registered business name";
    }

    if (!form.registrationCountryCode.trim()) {
      errors.registrationCountryCode = "Please select registration country";
    }

    if (!form.contactFirstName.trim()) {
      errors.contactFirstName = "Please enter first name";
    }

    if (!form.contactLastName.trim()) {
      errors.contactLastName = "Please enter last name";
    }

    if (!form.contactEmail.trim()) {
      errors.contactEmail = "Please enter email";
    } else if (!/^\S+@\S+\.\S+$/.test(form.contactEmail)) {
      errors.contactEmail = "Please enter a valid email";
    }

    if (!normalizeDialCode(form.contactDialCode)) {
      errors.contactDialCode = "Please select a valid country dial code";
    }

    const phoneRaw = String(form.contactPhone ?? "").trim();
    const phoneDigits = phoneRaw.replace(/\D/g, "");
    if (!phoneRaw) {
      errors.contactPhone = "Please enter phone number";
    } else if (phoneDigits.length < 6) {
      errors.contactPhone = "Please enter a valid phone number";
    }

    const pwd = form.password ?? "";
    const hasMinLen = pwd.length >= 8;
    const hasLetter = /[A-Za-z]/.test(pwd);
    const hasNumber = /\d/.test(pwd);
    const hasSpecial = /[^A-Za-z0-9]/.test(pwd);

    if (!hasMinLen || !hasLetter || !hasNumber || !hasSpecial) {
      errors.password =
        "Password must be at least 8 characters and include a letter, number and special character.";
    }

    if (!form.confirmPassword) {
      errors.confirmPassword = "Please confirm your password";
    } else if (form.password !== form.confirmPassword) {
      errors.confirmPassword = "Passwords do not match";
    }

    return errors;
  };

  const applyBackendFieldErrors = (data: any) => {
    const nextErrors: FieldErrors = {};

    const backendField = String(data?.field ?? "").trim();
    const backendError = String(data?.error ?? data?.message ?? "").trim();

    if (
      data?.code === "PHONE_ALREADY_IN_USE" ||
      backendField === "phone" ||
      backendField === "contactPhone"
    ) {
      nextErrors.contactPhone = backendError || "Phone number already in use.";
    }

    if (backendField === "email" || backendField === "contactEmail") {
      nextErrors.contactEmail = backendError || "Email already in use.";
    }

    if (backendField === "contactDialCode" || backendField === "dialCode") {
      nextErrors.contactDialCode =
        backendError || "Please select a valid country dial code.";
    }

    const details = Array.isArray(data?.details) ? data.details : [];
    for (const item of details) {
      const path = Array.isArray(item?.path) ? item.path[0] : item?.path;
      const msg = String(item?.message ?? "").trim();
      if (!msg) continue;

      switch (path) {
        case "businessName":
          nextErrors.businessName = msg;
          break;
        case "legalName":
          nextErrors.legalName = msg;
          break;
        case "registeredBusinessName":
          nextErrors.registeredBusinessName = msg;
          break;
        case "registrationType":
          nextErrors.registrationType = msg;
          break;
        case "registrationCountryCode":
          nextErrors.registrationCountryCode = msg;
          break;
        case "contactFirstName":
          nextErrors.contactFirstName = msg;
          break;
        case "contactLastName":
          nextErrors.contactLastName = msg;
          break;
        case "contactEmail":
        case "email":
          nextErrors.contactEmail = msg;
          break;
        case "contactPhone":
        case "phone":
          nextErrors.contactPhone = msg;
          break;
        case "contactDialCode":
        case "dialCode":
          nextErrors.contactDialCode = msg;
          break;
        case "password":
          nextErrors.password = msg;
          break;
        default:
          break;
      }
    }

    setFieldErrors(nextErrors);
    return nextErrors;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setFieldErrors({});

    const clientErrors = validate();
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      setErr(
        Object.values(clientErrors)[0] ||
          "Please correct the highlighted fields."
      );
      scrollTopOnError();
      return;
    }

    try {
      setSubmitting(true);

      const email = form.contactEmail.trim().toLowerCase();
      const phone = form.contactPhone.trim();
      const dialCode = normalizeDialCode(form.contactDialCode);
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

        contactDialCode: dialCode,

        contactPhone: phone,
        phone,
        whatsappPhone: phone,

        password: form.password,
      };

      const { data } = await api.post<RegisterSupplierResponse>(
        "/api/auth/register-supplier",
        payload
      );

      const tempToken = String(data?.tempToken || "").trim();

      try {
        if (tempToken) {
          localStorage.setItem("tempToken", tempToken);
        }
      } catch {}

      let emailSent = asSentFlag(data?.emailSent);
      let phoneOtpSent = asSentFlag(data?.phoneOtpSent);

      const verifyCfg = {
        withCredentials: true,
        headers: tempToken ? { Authorization: `Bearer ${tempToken}` } : {},
      };

      if (!emailSent) {
        try {
          await api.post(
            "/api/auth/resend-verification",
            { email },
            verifyCfg
          );
          emailSent = true;
        } catch {}
      }

      if (!phoneOtpSent) {
        try {
          await api.post(
            "/api/auth/resend-otp",
            {
              phone,
              contactPhone: phone,
              dialCode,
              contactDialCode: dialCode,
            },
            verifyCfg
          );
          phoneOtpSent = true;
        } catch {}
      }

      if (!tempToken) {
        throw new Error(
          "Account was created, but the temporary verification session could not be started."
        );
      }

      if (!emailSent && !phoneOtpSent) {
        throw new Error(
          data?.message ||
            "Account was created, but email verification and phone OTP could not be sent."
        );
      }

      nav(VERIFY_ROUTE, {
        replace: true,
        state: {
          supplierId: data?.supplierId ?? null,
          email,
          phone,
          dialCode,
          emailSent,
          phoneOtpSent,
          nextAfterVerify: "/supplier/onboarding",
          flow: "supplier-register",
        },
      });
    } catch (e: any) {
      const responseData = e?.response?.data ?? null;
      const backendFieldErrors = applyBackendFieldErrors(responseData);

      const msg =
        Object.values(backendFieldErrors)[0] ||
        responseData?.error ||
        responseData?.message ||
        e?.message ||
        "Supplier registration failed";

      setErr(msg);
      scrollTopOnError();
    } finally {
      setSubmitting(false);
    }
  };

  const label = "block text-sm font-semibold text-slate-800 mb-1.5";
  const helpText = "mt-1 text-xs text-zinc-500";
  const fieldErrorText = "mt-1 text-xs text-rose-600";

  const inputBase =
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

            <form onSubmit={submit} className={card} noValidate>
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
                      className={buildInputClass(inputBase, !!fieldErrors.businessName)}
                      placeholder="Store name"
                      autoComplete="organization"
                    />
                    {fieldErrors.businessName && (
                      <p className={fieldErrorText}>{fieldErrors.businessName}</p>
                    )}
                  </div>

                  <div>
                    <label className={label}>{legalEntityLabel}</label>
                    <p className={helpText}>{legalEntityHelp}</p>
                    <input
                      value={form.legalName}
                      onChange={onChange("legalName")}
                      className={buildInputClass(inputBase, !!fieldErrors.legalName)}
                      placeholder={legalEntityLabel}
                    />
                    {fieldErrors.legalName && (
                      <p className={fieldErrorText}>{fieldErrors.legalName}</p>
                    )}
                  </div>

                  <div>
                    <label className={label}>Registration type</label>
                    <p className={helpText}>
                      Tell us whether you are registering as an individual or a formally registered business.
                    </p>
                    <select
                      value={form.registrationType}
                      onChange={onChange("registrationType")}
                      className={buildInputClass(inputBase, !!fieldErrors.registrationType)}
                    >
                      <option value="">Select</option>
                      <option value="INDIVIDUAL">Individual</option>
                      <option value="REGISTERED_BUSINESS">Registered business</option>
                    </select>
                    {fieldErrors.registrationType && (
                      <p className={fieldErrorText}>{fieldErrors.registrationType}</p>
                    )}
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
                        className={buildInputClass(
                          inputBase,
                          !!fieldErrors.registeredBusinessName
                        )}
                        placeholder="Registered business name"
                      />
                      {fieldErrors.registeredBusinessName && (
                        <p className={fieldErrorText}>
                          {fieldErrors.registeredBusinessName}
                        </p>
                      )}
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
                      className={buildInputClass(
                        inputBase,
                        !!fieldErrors.registrationCountryCode
                      )}
                    >
                      {countries.length === 0 && <option>Loading countries...</option>}
                      {countries.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {fieldErrors.registrationCountryCode && (
                      <p className={fieldErrorText}>
                        {fieldErrors.registrationCountryCode}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              <div className="h-px bg-zinc-100" />

              <section className="space-y-4">
                <h2 className="text-sm font-semibold text-zinc-900">
                  Primary contact
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <input
                      value={form.contactFirstName}
                      onChange={onChange("contactFirstName")}
                      className={buildInputClass(inputBase, !!fieldErrors.contactFirstName)}
                      placeholder="First name"
                      autoComplete="given-name"
                    />
                    {fieldErrors.contactFirstName && (
                      <p className={fieldErrorText}>{fieldErrors.contactFirstName}</p>
                    )}
                  </div>

                  <div>
                    <input
                      value={form.contactLastName}
                      onChange={onChange("contactLastName")}
                      className={buildInputClass(inputBase, !!fieldErrors.contactLastName)}
                      placeholder="Last name"
                      autoComplete="family-name"
                    />
                    {fieldErrors.contactLastName && (
                      <p className={fieldErrorText}>{fieldErrors.contactLastName}</p>
                    )}
                  </div>

                  <div>
                    <input
                      type="email"
                      value={form.contactEmail}
                      onChange={onChange("contactEmail")}
                      className={buildInputClass(inputBase, !!fieldErrors.contactEmail)}
                      placeholder="Email"
                      autoComplete="email"
                    />
                    {fieldErrors.contactEmail && (
                      <p className={fieldErrorText}>{fieldErrors.contactEmail}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-2">
                      <select
                        value={form.contactDialCode}
                        onChange={onChange("contactDialCode")}
                        className={buildInputClass(inputBase, !!fieldErrors.contactDialCode)}
                      >
                        <option value="">Select code</option>
                        {dialCodeOptions.map((item) => (
                          <option key={item.key} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>

                      <input
                        value={form.contactPhone}
                        onChange={onChange("contactPhone")}
                        className={buildInputClass(inputBase, !!fieldErrors.contactPhone)}
                        placeholder="Phone / WhatsApp"
                        autoComplete="tel"
                      />
                    </div>

                    {fieldErrors.contactDialCode && (
                      <p className={fieldErrorText}>{fieldErrors.contactDialCode}</p>
                    )}
                    {fieldErrors.contactPhone && (
                      <p className={fieldErrorText}>{fieldErrors.contactPhone}</p>
                    )}
                  </div>
                </div>
              </section>

              <div className="h-px bg-zinc-100" />

              <section className="space-y-4">
                <h2 className="text-sm font-semibold text-zinc-900">
                  Password
                </h2>

                <div>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={onChange("password")}
                      className={buildInputClass(
                        `${inputBase} pr-12`,
                        !!fieldErrors.password
                      )}
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
                  {fieldErrors.password && (
                    <p className={fieldErrorText}>{fieldErrors.password}</p>
                  )}
                </div>

                <div>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={form.confirmPassword}
                      onChange={onChange("confirmPassword")}
                      className={buildInputClass(
                        `${inputBase} pr-12`,
                        !!fieldErrors.confirmPassword
                      )}
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
                  {fieldErrors.confirmPassword && (
                    <p className={fieldErrorText}>{fieldErrors.confirmPassword}</p>
                  )}
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