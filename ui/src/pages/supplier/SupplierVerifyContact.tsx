import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Mail,
  Phone,
  RefreshCw,
  Building2,
  User,
  Globe,
} from "lucide-react";
import api from "../../api/client";
import SiteLayout from "../../layouts/SiteLayout";

type VerifyLocationState = {
  supplierId?: string | null;
  email?: string | null;
  phone?: string | null;
  emailSent?: boolean;
  phoneOtpSent?: boolean;
  nextAfterVerify?: string;
  flow?: string;
};

type VerifySummary = {
  businessName: string;
  legalName: string;
  registeredBusinessName: string;
  registrationType: string;
  registrationCountryCode: string;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
};

type SupplierMeLite = {
  id?: string;
  supplierId?: string;
  businessName?: string | null;
  legalName?: string | null;
  registeredBusinessName?: string | null;
  registrationType?: string | null;
  registrationCountryCode?: string | null;
  contactFirstName?: string | null;
  contactLastName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  name?: string | null;
};

type AuthMeLite = {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

function maskEmail(v: string) {
  const [name, domain] = String(v || "").split("@");
  if (!name || !domain) return v;
  if (name.length <= 2) return `${name[0] ?? ""}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

function maskPhone(v: string) {
  const raw = String(v || "").trim();
  if (raw.length < 6) return raw;
  return `${raw.slice(0, 4)}***${raw.slice(-3)}`;
}

function getTempToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("tempToken") || "";
}

function getVerifyConfig() {
  const tempToken = getTempToken();

  return {
    withCredentials: true,
    headers: tempToken ? { Authorization: `Bearer ${tempToken}` } : {},
  };
}

function pickString(v: unknown) {
  return String(v ?? "").trim();
}

function countryLabel(code?: string | null) {
  const c = String(code || "").toUpperCase();
  if (c === "NG") return "Nigeria";
  if (c === "KE") return "Kenya";
  if (c === "RW") return "Rwanda";
  if (c === "BJ") return "Benin Republic";
  if (c === "GH") return "Ghana";
  if (c === "CD") return "Congo";
  if (c === "CM") return "Cameroon";
  if (c === "TG") return "Togo";
  if (c === "BF") return "Burkina Faso";
  return c || "—";
}

function registrationTypeLabel(v?: string | null) {
  const value = String(v || "").toUpperCase();
  if (value === "INDIVIDUAL") return "Individual";
  if (value === "REGISTERED_BUSINESS") return "Registered business";
  return "—";
}

export default function SupplierVerifyContact() {
  const nav = useNavigate();
  const location = useLocation();

  const state = (location.state ?? {}) as VerifyLocationState;

  const [summary, setSummary] = useState<VerifySummary | null>(
    state.email || state.phone
      ? {
          businessName: "",
          legalName: "",
          registrationType: "",
          registrationCountryCode: "",
          contactFirstName: "",
          contactLastName: "",
          registeredBusinessName: "",
          contactEmail: state.email || "",
          contactPhone: state.phone || "",
        }
      : null
  );

  const [email, setEmail] = useState(state.email || "");
  const [phone, setPhone] = useState(state.phone || "");

  const [emailSent, setEmailSent] = useState(!!state.emailSent);
  const [phoneOtpSent, setPhoneOtpSent] = useState(!!state.phoneOtpSent);

  const [emailVerified, setEmailVerified] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);

  const [otp, setOtp] = useState("");
  const [busyEmail, setBusyEmail] = useState(false);
  const [busyPhone, setBusyPhone] = useState(false);
  const [busyVerifyOtp, setBusyVerifyOtp] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const nextAfterVerify = state.nextAfterVerify || "/supplier/onboarding";

  const loadSummary = async () => {
    try {
      setLoadingSummary(true);
      setErr(null);

      const cfg = getVerifyConfig();

      let supplierData: SupplierMeLite | null = null;
      let authData: AuthMeLite | null = null;

      try {
        const supplierRes = await api.get("/api/supplier/me", cfg);
        supplierData = ((supplierRes.data as any)?.data ??
          supplierRes.data ??
          {}) as SupplierMeLite;
      } catch {}

      try {
        const authRes = await api.get("/api/auth/me", cfg);
        authData = ((authRes.data as any)?.data ??
          (authRes.data as any)?.user ??
          authRes.data ??
          {}) as AuthMeLite;
      } catch {}

      const resolvedEmail =
        state.email ||
        pickString(supplierData?.contactEmail) ||
        pickString(authData?.email);

      const resolvedPhone =
        state.phone ||
        pickString(supplierData?.contactPhone) ||
        pickString(authData?.phone);

      setEmail(resolvedEmail);
      setPhone(resolvedPhone);

      if (supplierData || authData) {
        setSummary({
          businessName:
            pickString(supplierData?.businessName) ||
            pickString(supplierData?.name),
          legalName: pickString(supplierData?.legalName),
          registeredBusinessName: pickString(supplierData?.registeredBusinessName),
          registrationType: pickString(supplierData?.registrationType),
          registrationCountryCode: pickString(
            supplierData?.registrationCountryCode
          ),
          contactFirstName:
            pickString(supplierData?.contactFirstName) ||
            pickString(authData?.firstName),
          contactLastName:
            pickString(supplierData?.contactLastName) ||
            pickString(authData?.lastName),
          contactEmail: resolvedEmail,
          contactPhone: resolvedPhone,
        });

        if (typeof authData?.emailVerified === "boolean") {
          setEmailVerified(!!authData.emailVerified);
        }
        if (typeof authData?.phoneVerified === "boolean") {
          setPhoneVerified(!!authData.phoneVerified);
        }
      }
    } catch (e: any) {
      setErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          "Could not load supplier registration details."
      );
    } finally {
      setLoadingSummary(false);
    }
  };

  const legalEntityLabel =
    summary?.registrationType === "REGISTERED_BUSINESS"
      ? "Company legal name"
      : "Full legal name";

  const loadStatus = async () => {
    try {
      setErr(null);
      setChecking(true);

      const cfg = getVerifyConfig();
      const activeEmail = email || summary?.contactEmail || "";

      if (!activeEmail) {
        setErr("No supplier email found for verification.");
        return;
      }

      const emailRes = await api.get("/api/auth/email-status", {
        params: { email: activeEmail },
        withCredentials: true,
      });

      setEmailVerified(!!emailRes?.data?.emailVerifiedAt);

      try {
        const meRes = await api.get("/api/auth/me", cfg);
        const me = ((meRes.data as any)?.data ??
          (meRes.data as any)?.user ??
          meRes.data ??
          {}) as AuthMeLite;

        setPhoneVerified(!!me?.phoneVerified);
      } catch {
        // ignore
      }
    } catch (e: any) {
      setErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          "Could not load verification status."
      );
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loadingSummary) {
      loadStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingSummary, email]);

  const canContinue = useMemo(
    () => emailVerified && phoneVerified,
    [emailVerified, phoneVerified]
  );

  const resendEmail = async () => {
    try {
      setErr(null);
      setBusyEmail(true);

      const activeEmail = email || summary?.contactEmail || "";
      if (!activeEmail) {
        setErr("No email found for verification.");
        return;
      }

      await api.post(
        "/api/auth/resend-verification",
        { email: activeEmail },
        { withCredentials: true }
      );

      setEmailSent(true);
    } catch (e: any) {
      setErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          "Could not resend email verification."
      );
    } finally {
      setBusyEmail(false);
    }
  };

  const resendPhoneOtp = async () => {
    try {
      setErr(null);
      setBusyPhone(true);

      await api.post("/api/auth/resend-otp", {}, getVerifyConfig());

      setPhoneOtpSent(true);
    } catch (e: any) {
      setErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          "Could not send phone verification code."
      );
    } finally {
      setBusyPhone(false);
    }
  };

  const verifyPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!otp.trim()) {
      setErr("Please enter the verification code sent to your phone.");
      return;
    }

    try {
      setErr(null);
      setBusyVerifyOtp(true);

      await api.post(
        "/api/auth/verify-otp",
        {
          otp: otp.trim(),
        },
        getVerifyConfig()
      );

      setPhoneVerified(true);
      setOtp("");
      await loadStatus();
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        "Invalid or expired phone verification code.";

      if (/phone already verified/i.test(msg)) {
        setPhoneVerified(true);
        setErr(null);
        setOtp("");
        return;
      }

      setErr(msg);
    } finally {
      setBusyVerifyOtp(false);
    }
  };

  const continueToOnboarding = () => {
    nav(nextAfterVerify, { replace: true });
  };

  const stepBase =
    "flex items-center gap-2 rounded-full border px-3 py-2 text-xs sm:text-sm transition";
  const stepDone = "border-emerald-200 bg-emerald-50 text-emerald-700";
  const stepActive = "border-zinc-900 bg-zinc-900 text-white shadow-sm";
  const stepLocked = "border-zinc-100 bg-zinc-50 text-zinc-400";

  const card =
    "rounded-[28px] border border-white/70 bg-white/95 backdrop-blur shadow-[0_16px_50px_rgba(15,23,42,0.08)] p-4 sm:p-6 md:p-8";
  const panel =
    "rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm";
  const button =
    "inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 disabled:cursor-not-allowed";
  const primaryBtn = `${button} bg-zinc-900 text-white hover:bg-black`;
  const secondaryBtn = `${button} border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50`;
  const input =
    "w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] md:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm";

  return (
    <SiteLayout>
      <div className="min-h-[100dvh] bg-gradient-to-b from-zinc-50 to-white">
        <div className="px-3 sm:px-4 py-6 sm:py-10">
          <div className="mx-auto w-full max-w-5xl space-y-6">
            <div className="space-y-4">
              <div className="text-center">
                <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-900">
                  Verify your contact details
                </h1>
                <p className="mt-2 text-sm text-zinc-600">
                  Complete email and phone verification before continuing to business details.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                <div className={`${stepBase} ${stepDone}`}>
                  <CheckCircle2 size={16} />
                  <span>Register</span>
                </div>

                <div className={`${stepBase} ${stepActive}`}>
                  <BadgeCheck size={16} />
                  <span>Verify email / phone</span>
                </div>

                <div className={`${stepBase} ${stepLocked}`}>
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    3
                  </span>
                  <span>Business details</span>
                </div>

                <div className={`${stepBase} ${stepLocked}`}>
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    4
                  </span>
                  <span>Address details</span>
                </div>

                <div className={`${stepBase} ${stepLocked}`}>
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    5
                  </span>
                  <span>Documents</span>
                </div>

                <div className={`${stepBase} ${stepLocked}`}>
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold">
                    6
                  </span>
                  <span>Dashboard access</span>
                </div>
              </div>
            </div>

            {err && (
              <div className="rounded-xl border border-rose-300 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
                {err}
              </div>
            )}

            <div className={`${card} space-y-5`}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className={panel}>
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-zinc-100 p-3">
                      <Mail className="h-5 w-5 text-zinc-700" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-base font-semibold text-zinc-900">
                            Email verification
                          </h2>
                          <p className="mt-1 text-sm text-zinc-600 break-all">
                            {email ? maskEmail(email) : "No email found"}
                          </p>
                        </div>

                        <div
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            emailVerified
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {emailVerified ? "Verified" : "Pending"}
                        </div>
                      </div>

                      {!emailVerified && (
                        <p className="mt-4 text-sm text-zinc-600">
                          Open the verification link sent to your inbox, then
                          return here and refresh your status.
                        </p>
                      )}

                      {!emailVerified && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={resendEmail}
                            disabled={busyEmail}
                            className={secondaryBtn}
                          >
                            {busyEmail
                              ? "Sending…"
                              : emailSent
                              ? "Resend email"
                              : "Send email"}
                          </button>

                          <button
                            type="button"
                            onClick={loadStatus}
                            disabled={checking}
                            className={secondaryBtn}
                          >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            {checking ? "Checking…" : "Refresh status"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className={panel}>
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-zinc-100 p-3">
                      <Phone className="h-5 w-5 text-zinc-700" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-base font-semibold text-zinc-900">
                            Phone verification
                          </h2>
                          <p className="mt-1 text-sm text-zinc-600">
                            {phone ? maskPhone(phone) : "No phone found"}
                          </p>
                        </div>

                        <div
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            phoneVerified
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {phoneVerified ? "Verified" : "Pending"}
                        </div>
                      </div>

                      {!phoneVerified && (
                        <p className="mt-4 text-sm text-zinc-600">
                          Enter the OTP sent to your phone or WhatsApp number.
                        </p>
                      )}

                      <form onSubmit={verifyPhoneOtp} className="mt-4 space-y-3">
                        {!phoneVerified && (
                          <input
                            value={otp}
                            onChange={(e) => {
                              setOtp(e.target.value);
                              setErr(null);
                            }}
                            className={input}
                            placeholder="Enter verification code"
                            inputMode="numeric"
                          />
                        )}

                        {!phoneVerified && (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="submit"
                              disabled={busyVerifyOtp}
                              className={primaryBtn}
                            >
                              {busyVerifyOtp ? "Verifying…" : "Verify phone"}
                            </button>

                            <button
                              type="button"
                              onClick={resendPhoneOtp}
                              disabled={busyPhone}
                              className={secondaryBtn}
                            >
                              {busyPhone
                                ? "Sending…"
                                : phoneOtpSent
                                ? "Resend code"
                                : "Send code"}
                            </button>
                          </div>
                        )}
                      </form>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900">
                      Continue to business details
                    </h3>
                    <p className="mt-1 text-sm text-zinc-600">
                      You’ll unlock the next step once both email and phone are
                      verified.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={continueToOnboarding}
                    disabled={!canContinue}
                    className={`${primaryBtn} min-w-[240px]`}
                  >
                    Continue to business details
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className={card}>
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-xl bg-zinc-100 p-3">
                  <Building2 className="h-5 w-5 text-zinc-700" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">
                    Registration details
                  </h2>
                  <p className="text-sm text-zinc-600">
                    Reloaded from your supplier account details.
                  </p>
                </div>
              </div>

              {loadingSummary ? (
                <div className="text-sm text-zinc-500">
                  Loading registration details…
                </div>
              ) : summary ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="text-zinc-500">Store name</div>
                    <div className="mt-1 font-medium text-zinc-900">
                      {summary.businessName || "—"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="text-zinc-500">{legalEntityLabel}</div>
                    <div className="mt-1 font-medium text-zinc-900">
                      {summary.legalName || "—"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-zinc-500">
                      <User className="h-4 w-4" />
                      Primary contact
                    </div>
                    <div className="mt-1 font-medium text-zinc-900">
                      {[summary.contactFirstName, summary.contactLastName]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="text-zinc-500">Registration type</div>
                    <div className="mt-1 font-medium text-zinc-900">
                      {registrationTypeLabel(summary.registrationType)}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="text-zinc-500">Contact email</div>
                    <div className="mt-1 font-medium text-zinc-900 break-all">
                      {summary.contactEmail || "—"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="text-zinc-500">Contact phone</div>
                    <div className="mt-1 font-medium text-zinc-900">
                      {summary.contactPhone || "—"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 md:col-span-2">
                    <div className="flex items-center gap-2 text-zinc-500">
                      <Globe className="h-4 w-4" />
                      Registration country
                    </div>
                    <div className="mt-1 font-medium text-zinc-900">
                      {countryLabel(summary.registrationCountryCode)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-zinc-500">
                  Registration details are not available yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}