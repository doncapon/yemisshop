// src/pages/Login.tsx
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../api/client";
import { mergeGuestCartIntoUserCart, useAuthStore, type Role } from "../store/auth";
import SiteLayout from "../layouts/SiteLayout";
import DaySpringLogo from "../components/brand/DayspringLogo";

/* ---------------- Cookie-mode helpers ---------------- */
const AXIOS_COOKIE_CFG = { withCredentials: true as const };

/* ---------------- Return-to helpers ---------------- */
const RETURN_TO_KEY = "auth:returnTo";

function safeReturnTo(v: unknown): string | null {
  const s = typeof v === "string" ? v : "";
  if (!s) return null;
  if (!s.startsWith("/")) return null;
  if (s.startsWith("/login") || s.startsWith("/register") || s.startsWith("/forgot-password")) {
    return null;
  }
  return s;
}

function readFromState(state: any): string | null {
  if (!state) return null;

  const direct = safeReturnTo(state.from);
  if (direct) return direct;

  const obj = state.from;
  const p = typeof obj?.pathname === "string" ? obj.pathname : "";
  const q = typeof obj?.search === "string" ? obj.search : "";
  const combined = p ? `${p}${q}` : "";

  return safeReturnTo(combined);
}

type MeResponse = {
  id: string;
  email: string;
  role: Role;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  status?: string | null;
};

type LoginOk = {
  profile: MeResponse;
  needsVerification?: boolean;
  verifyToken?: string;
};

type LoginBlocked = {
  error: string;
  needsVerification: true;
  profile: any;
  verifyToken?: string;
};

function normalizeProfile(raw: any): MeResponse | null {
  if (!raw) return null;

  const emailVerified =
    raw.emailVerified === true || !!raw.emailVerifiedAt || raw.emailVerifiedAt === 1;

  const phoneVerified =
    raw.phoneVerified === true || !!raw.phoneVerifiedAt || raw.phoneVerifiedAt === 1;

  return {
    id: String(raw.id ?? ""),
    email: String(raw.email ?? ""),
    role: (raw.role ?? "SHOPPER") as Role,
    firstName: raw.firstName ?? null,
    middleName: raw.middleName ?? null,
    lastName: raw.lastName ?? null,
    emailVerified,
    phoneVerified,
    status: raw.status ?? null,
  };
}

function normRole(r: any): Role {
  const x = String(r || "").trim().toUpperCase();
  return (
    x === "ADMIN" ||
      x === "SUPER_ADMIN" ||
      x === "SHOPPER" ||
      x === "SUPPLIER" ||
      x === "SUPPLIER_RIDER"
      ? x
      : "SHOPPER"
  ) as Role;
}

function getDefaultPathByRole(role: Role): string {
  const map: Record<Role, string> = {
    ADMIN: "/admin",
    SUPER_ADMIN: "/admin",
    SHOPPER: "/",
    SUPPLIER: "/supplier",
    SUPPLIER_RIDER: "/supplier/orders",
  };
  return map[role] || "/";
}

export default function Login() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  const setUser = useAuthStore((s) => s.setUser);
  const setNeedsVerification = useAuthStore((s) => s.setNeedsVerification);
  const clearAuth = useAuthStore((s) => s.clear);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [blockedProfile, setBlockedProfile] = useState<MeResponse | null>(null);
  const [verifyToken, setVerifyToken] = useState<string | null>(null);

  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailCooldown, setEmailCooldown] = useState(0);

  const [otpBusy, setOtpBusy] = useState(false);
  const [otpMsg, setOtpMsg] = useState<string | null>(null);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otp, setOtp] = useState("");

  const [verifyPanelOpen, setVerifyPanelOpen] = useState(true);

  // ✅ shopper choice gate
  const [pendingShopperProfile, setPendingShopperProfile] = useState<MeResponse | null>(null);
  const [shopperNoticeOpen, setShopperNoticeOpen] = useState(false);

  const nav = useNavigate();
  const loc = useLocation();

  const returnToRef = useRef<string | null>(null);
  const suppressAutoRedirectRef = useRef(false);

  const fullyVerified = useMemo(() => {
    if (!blockedProfile) return false;
    return !!blockedProfile.emailVerified && !!blockedProfile.phoneVerified;
  }, [blockedProfile]);

  useEffect(() => {
    if (!hydrated) {
      bootstrap().catch(() => null);
    }
  }, [hydrated, bootstrap]);

  const computedReturnTo = useMemo(() => {
    const stateFrom = readFromState(loc.state as any);
    const qpFrom = safeReturnTo(new URLSearchParams(loc.search).get("from"));

    let ssFrom: string | null = null;
    try {
      ssFrom = safeReturnTo(sessionStorage.getItem(RETURN_TO_KEY));
    } catch {
      //
    }

    return stateFrom || qpFrom || ssFrom || null;
  }, [loc.state, loc.search]);

  if (returnToRef.current == null && computedReturnTo) {
    returnToRef.current = computedReturnTo;
  }

  useEffect(() => {
    if (!returnToRef.current) return;
    try {
      sessionStorage.setItem(RETURN_TO_KEY, returnToRef.current);
    } catch {
      //
    }
  }, [computedReturnTo]);

  useEffect(() => {
    if (!hydrated) return;
    if (!user?.id) return;
    if (suppressAutoRedirectRef.current) return;
    if (shopperNoticeOpen) return;

    const target = returnToRef.current || getDefaultPathByRole(normRole(user.role));
    nav(target, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user?.id, shopperNoticeOpen]);


  useEffect(() => {
    if (fullyVerified) {
      setErr(null);
      setEmailMsg(null);
      setOtpMsg(null);
    }
  }, [fullyVerified]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  useEffect(() => {
    if (emailCooldown <= 0) return;
    const t = setInterval(() => setEmailCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [emailCooldown]);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const t = setInterval(() => setOtpCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [otpCooldown]);

  function commitLogin(
    profile: MeResponse,
    needsVerification = false,
    incomingVerifyToken?: string | null
  ) {
    setUser(profile);
    setNeedsVerification(needsVerification);

    try {
      mergeGuestCartIntoUserCart(String(profile.id));
    } catch {
      //
    }

    queueMicrotask(() => window.dispatchEvent(new Event("cart:updated")));

    try {
      localStorage.setItem("verifyEmail", profile.email);
      if (incomingVerifyToken) localStorage.setItem("verifyToken", incomingVerifyToken);
      else localStorage.removeItem("verifyToken");
    } catch {
      //
    }
  }


  function finalizeNavigate(path: string) {
    suppressAutoRedirectRef.current = true;

    try {
      sessionStorage.removeItem(RETURN_TO_KEY);
    } catch {
      //
    }

    returnToRef.current = null;
    setShopperNoticeOpen(false);

    // let auth store + route guards settle first
    window.setTimeout(() => {
      nav(path, { replace: true });
    }, 0);
  }


  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading || cooldown > 0) return;

    setErr(null);
    setEmailMsg(null);
    setOtpMsg(null);
    setBlockedProfile(null);
    setVerifyToken(null);
    setPendingShopperProfile(null);
    setShopperNoticeOpen(false);

    if (!email.trim() || !password.trim()) {
      setErr("Email and password are required");
      return;
    }

    setLoading(true);
    try {
      clearAuth();

      const res = await api.post<LoginOk>(
        "/api/auth/login",
        {
          email: email.trim(),
          password: password.trim(),
        },
        AXIOS_COOKIE_CFG
      );

      const data = res.data as LoginOk;
      const normalizedProfile = normalizeProfile(data?.profile);

      if (!normalizedProfile?.id) {
        throw new Error("Login response missing profile");
      }

      const roleKey = normRole(normalizedProfile.role);
      const isFullyVerified =
        !!normalizedProfile.emailVerified && !!normalizedProfile.phoneVerified;
      const needsVer = !!data?.needsVerification;
      const vt = data?.verifyToken ?? null;

      setVerifyToken(vt);

      // ✅ supplier flow: stay on login page and show inline verification tools
      if (roleKey === "SUPPLIER" && !isFullyVerified) {
        suppressAutoRedirectRef.current = true;
        commitLogin(normalizedProfile, true, vt);
        setBlockedProfile(normalizedProfile);
        setErr("Please verify your email and phone number to continue.");
        setVerifyPanelOpen(true);
        setCooldown(1);
        return;
      }


      // ✅ shopper flow: do NOT commit to store yet, show choice first
      if (roleKey === "SHOPPER" && !isFullyVerified) {
        suppressAutoRedirectRef.current = true;
        setPendingShopperProfile(normalizedProfile);
        setShopperNoticeOpen(true);
        setCooldown(1);
        return;
      }

      commitLogin(normalizedProfile, needsVer);

      const target = returnToRef.current || getDefaultPathByRole(roleKey);
      finalizeNavigate(target);
    } catch (e: any) {
      const status = e?.response?.status;

      if (status === 403 && e?.response?.data?.needsVerification) {
        const data = e.response.data as LoginBlocked;
        const p = normalizeProfile(data.profile);
        const vt = data.verifyToken || null;

        setVerifyToken(vt);
        setNeedsVerification(true);
        setErr(data.error || "Please verify your email and phone number to continue.");

        if (p?.role === "SUPPLIER") {
          suppressAutoRedirectRef.current = true;
          if (p) commitLogin(p, true, vt);
          setBlockedProfile(p);
          setVerifyPanelOpen(true);
          setCooldown(1);
          return;
        }


        if (p?.role === "SHOPPER") {
          suppressAutoRedirectRef.current = true;
          setPendingShopperProfile(p);
          setShopperNoticeOpen(true);
          setCooldown(1);
          return;
        }
      }

      const msg =
        e?.response?.data?.error ||
        (status === 401 ? "Invalid email or password" : null) ||
        "Login failed";

      setErr(msg);
      clearAuth();
      setCooldown(2);
    } finally {
      setLoading(false);
    }
  };

  const resendEmail = async () => {
    if (!blockedProfile?.email) return;
    if (emailBusy || emailCooldown > 0) return;

    setEmailMsg(null);
    setEmailBusy(true);
    try {
      const r = await api.post(
        "/api/auth/resend-verification",
        { email: blockedProfile.email },
        AXIOS_COOKIE_CFG
      );

      setEmailMsg("Verification email sent. Please check your inbox (and spam).");
      const next = Number((r as any).data?.nextResendAfterSec ?? 60);
      setEmailCooldown(Math.max(1, next));
    } catch (e: any) {
      const status = e?.response?.status;
      const retry = Number(e?.response?.data?.retryAfterSec ?? 0);

      if (status === 429 && retry > 0) {
        setEmailMsg(`Please wait ${retry}s before resending.`);
        setEmailCooldown(retry);
      } else {
        setEmailMsg(e?.response?.data?.error || "Could not resend verification email.");
      }
    } finally {
      setEmailBusy(false);
    }
  };

  const checkEmailStatus = async () => {
    if (!blockedProfile?.email) return;
    setEmailMsg(null);
    setEmailBusy(true);
    try {
      const r = await api.get("/api/auth/email-status", {
        ...AXIOS_COOKIE_CFG,
        params: { email: blockedProfile.email },
      });
      const emailVerifiedAt = (r as any).data?.emailVerifiedAt;

      setBlockedProfile((p) => (p ? { ...p, emailVerified: !!emailVerifiedAt } : p));
      setEmailMsg(
        emailVerifiedAt ? "Email verified ✅" : "Email not verified yet. Check your inbox."
      );
    } catch (e: any) {
      setEmailMsg(e?.response?.data?.error || "Could not check email status.");
    } finally {
      setEmailBusy(false);
    }
  };

  const sendOtp = async () => {
    if (otpBusy || otpCooldown > 0) return;

    setOtpMsg(null);
    setOtpBusy(true);
    try {
      const cfg = {
        ...AXIOS_COOKIE_CFG,
        headers: verifyToken ? { Authorization: `Bearer ${verifyToken}` } : undefined,
      };

      const r = await api.post("/api/auth/resend-otp", {}, cfg);

      setOtpMsg("OTP sent via WhatsApp. Enter the code to verify your phone.");
      const next = Number((r as any).data?.nextResendAfterSec ?? 60);
      setOtpCooldown(Math.max(1, next));
    } catch (e: any) {
      const status = e?.response?.status;
      const retry = Number(e?.response?.data?.retryAfterSec ?? 0);

      if (status === 401) {
        setOtpMsg("Verification session expired. Please login again to request OTP.");
      } else if (status === 429 && retry > 0) {
        setOtpMsg(`Please wait ${retry}s before resending OTP.`);
        setOtpCooldown(retry);
      } else {
        setOtpMsg(e?.response?.data?.error || "Could not send OTP.");
      }
    } finally {
      setOtpBusy(false);
    }
  };

  const verifyOtpNow = async () => {
    const code = otp.trim();
    if (!code) {
      setOtpMsg("Enter the OTP code.");
      return;
    }

    setOtpMsg(null);
    setOtpBusy(true);
    try {
      const cfg = {
        ...AXIOS_COOKIE_CFG,
        headers: verifyToken ? { Authorization: `Bearer ${verifyToken}` } : undefined,
      };

      const r = await api.post("/api/auth/verify-otp", { otp: code }, cfg);

      if ((r as any).data?.ok && (r as any).data?.profile) {
        const p = normalizeProfile((r as any).data.profile);
        if (p) setBlockedProfile(p);

        if (p?.emailVerified && p?.phoneVerified) {
          setOtp("");
          setOtpMsg("All set ✅ Please login again.");
          setErr(null);
        } else {
          setOtpMsg("Phone verified ✅");
        }
      } else {
        setOtpMsg("Could not verify OTP. Try again.");
      }
    } catch (e: any) {
      setOtpMsg(e?.response?.data?.error || "Invalid OTP. Please try again.");
    } finally {
      setOtpBusy(false);
    }
  };

  const handleShopperVerifyNow = () => {
    if (!pendingShopperProfile) return;
    commitLogin(pendingShopperProfile, true, verifyToken);
    finalizeNavigate("/verify");
  };

  const handleShopperDashboard = () => {
    if (!pendingShopperProfile) return;
    commitLogin(pendingShopperProfile, true, verifyToken);
    finalizeNavigate("/dashboard");
  };

  const handleShopperCatalogue = () => {
    if (!pendingShopperProfile) return;
    commitLogin(pendingShopperProfile, true, verifyToken);
    finalizeNavigate("/");
  };


  const showSupplierVerify = blockedProfile?.role === "SUPPLIER" && !fullyVerified;

  return (
    <SiteLayout>
      <div className="min-h-[100dvh] bg-gradient-to-b from-zinc-50 to-white">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-28 -right-24 w-[22rem] h-[22rem] sm:w-[26rem] sm:h-[26rem] rounded-full blur-3xl opacity-30 bg-fuchsia-300/50" />
          <div className="absolute -bottom-32 -left-20 w-[24rem] h-[24rem] sm:w-[28rem] sm:h-[28rem] rounded-full blur-3xl opacity-25 bg-cyan-300/50" />
        </div>

        <div className="relative grid place-items-center min-h-[100dvh] px-4 py-8 sm:py-10">
          <div className="w-full max-w-md">
            <div className="mb-4 sm:mb-6 text-center">
              <div className="flex justify-center">
                <div className="inline-flex items-center gap-2 rounded-2xl border bg-white/90 backdrop-blur px-4 py-2 shadow-sm">
                  <DaySpringLogo size={26} showText={true} />
                </div>
              </div>

              <h1 className="mt-4 text-[22px] sm:text-2xl md:text-3xl font-semibold text-zinc-900 leading-tight">
                Sign in
              </h1>
              <p className="mt-1 text-sm text-zinc-600">
                Access your cart, orders and personalised dashboard.
              </p>
            </div>

            <form
              onSubmit={submit}
              noValidate
              className="rounded-2xl border bg-white/95 backdrop-blur shadow-sm p-4 sm:p-6 space-y-4 sm:space-y-5"
            >
              {err && (
                <div className="text-sm rounded-xl border border-rose-300/60 bg-rose-50 text-rose-700 px-3 py-2">
                  {err}
                </div>
              )}

              {blockedProfile?.role === "SUPPLIER" &&
                (fullyVerified ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    <div className="font-semibold">Verification complete ✅</div>
                    <div className="mt-1 text-xs text-emerald-800">
                      Your supplier account is fully verified. Please login again to continue.
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50">
                    <button
                      type="button"
                      onClick={() => setVerifyPanelOpen((v) => !v)}
                      className="w-full px-4 py-3 flex items-center justify-between text-left"
                      aria-expanded={verifyPanelOpen}
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          Supplier verification required
                        </div>
                        <div className="text-xs text-slate-700 truncate max-w-[260px]">
                          {blockedProfile.email}
                        </div>
                      </div>
                      <div className="text-xs font-semibold text-slate-800 rounded-full border border-amber-200 bg-white px-2 py-1">
                        {verifyPanelOpen ? "Hide" : "Show"}
                      </div>
                    </button>

                    {verifyPanelOpen && (
                      <div className="px-4 pb-4 space-y-4">
                        {!blockedProfile.emailVerified && (
                          <div className="rounded-xl border border-amber-200 bg-white/80 p-3">
                            <div className="text-sm font-semibold text-slate-900">
                              Verify your email
                            </div>
                            <div className="mt-1 text-xs text-slate-600">
                              Click the link we sent to your email. You can resend it below.
                            </div>
                            <div className="mt-3 flex flex-col sm:flex-row gap-2">
                              <button
                                type="button"
                                onClick={resendEmail}
                                disabled={emailBusy || emailCooldown > 0}
                                className="inline-flex items-center justify-center rounded-xl bg-zinc-900 text-white px-3 py-2.5 text-xs font-semibold disabled:opacity-60"
                              >
                                {emailBusy
                                  ? "Sending…"
                                  : emailCooldown > 0
                                    ? `Resend in ${emailCooldown}s`
                                    : "Resend email"}
                              </button>
                              <button
                                type="button"
                                onClick={checkEmailStatus}
                                disabled={emailBusy}
                                className="inline-flex items-center justify-center rounded-xl border bg-white px-3 py-2.5 text-xs font-semibold text-slate-800 disabled:opacity-60"
                              >
                                {emailBusy ? "Checking…" : "I verified (check)"}
                              </button>
                            </div>
                            {emailMsg && <div className="mt-2 text-xs text-slate-700">{emailMsg}</div>}
                          </div>
                        )}

                        {!blockedProfile.phoneVerified && (
                          <div className="rounded-xl border border-amber-200 bg-white/80 p-3">
                            <div className="text-sm font-semibold text-slate-900">
                              Verify your phone (WhatsApp OTP)
                            </div>
                            <div className="mt-1 text-xs text-slate-600">
                              We’ll send a one-time code to your WhatsApp number on file.
                            </div>

                            <div className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-center">
                              <button
                                type="button"
                                onClick={sendOtp}
                                disabled={otpBusy || otpCooldown > 0}
                                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white px-3 py-2.5 text-xs font-semibold disabled:opacity-60"
                              >
                                {otpBusy
                                  ? "Sending…"
                                  : otpCooldown > 0
                                    ? `Send again in ${otpCooldown}s`
                                    : "Send OTP"}
                              </button>

                              <div className="flex gap-2">
                                <input
                                  value={otp}
                                  onChange={(e) => setOtp(e.target.value)}
                                  placeholder="OTP"
                                  inputMode="numeric"
                                  className="flex-1 min-w-0 rounded-xl border bg-white px-3 py-2.5 text-[16px] text-slate-900 outline-none focus:ring-4 focus:ring-fuchsia-200"
                                />
                                <button
                                  type="button"
                                  onClick={verifyOtpNow}
                                  disabled={otpBusy}
                                  className="shrink-0 inline-flex items-center justify-center rounded-xl border bg-white px-3 py-2.5 text-xs font-semibold text-slate-800 disabled:opacity-60"
                                >
                                  {otpBusy ? "Verifying…" : "Verify"}
                                </button>
                              </div>
                            </div>

                            {otpMsg && <div className="mt-2 text-xs text-slate-700">{otpMsg}</div>}
                          </div>
                        )}

                        {!showSupplierVerify && (
                          <div className="text-xs text-slate-700">
                            You can continue once email and phone are verified.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

              <div className="space-y-1">
                <label className="block text-sm font-medium text-zinc-800">Email</label>
                <div className="relative">
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="username"
                    inputMode="email"
                    className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 pr-10 text-[16px] text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200 transition shadow-sm"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">
                    ✉
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <label className="block text-sm font-medium text-zinc-800 leading-tight">
                    Password
                  </label>
                  <Link
                    className="text-xs text-fuchsia-700 hover:underline leading-tight self-start sm:self-auto"
                    to="/forgot-password"
                  >
                    Forgot password?
                  </Link>
                </div>

                <div className="relative">
                  <input
                    value={password}
                    type={showPassword ? "text" : "password"}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 pr-14 text-[16px] text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200 transition shadow-sm"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-full border border-zinc-300 bg-white/90 shadow-sm hover:bg-zinc-50 transition"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    <svg viewBox="0 0 24 24" className="w-6 h-6" aria-hidden="true">
                      <path
                        d="M2.5 12s3.2-5.5 9.5-5.5S21.5 12 21.5 12s-3.2 5.5-9.5 5.5S2.5 12 2.5 12z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle
                        cx={12}
                        cy={12}
                        r={2.8}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                      />
                      {showPassword && (
                        <path
                          d="M4 4L20 20"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.8}
                          strokeLinecap="round"
                        />
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={!hydrated || loading || cooldown > 0}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white px-4 py-3 font-semibold shadow-sm hover:shadow-md active:scale-[0.995] focus:outline-none focus:ring-4 focus:ring-fuchsia-300/40 transition disabled:opacity-50"
              >
                {!hydrated
                  ? "Preparing…"
                  : loading
                    ? "Logging in…"
                    : cooldown > 0
                      ? `Try again in ${cooldown}s`
                      : "Login"}
              </button>

              <div className="pt-1 text-center text-sm text-zinc-700">
                Don’t have an account?{" "}
                <Link className="text-fuchsia-700 hover:underline" to="/register">
                  Create one
                </Link>
              </div>
            </form>

            <p className="mt-4 sm:mt-5 text-center text-xs text-zinc-500 px-4">
              Secured by industry-standard encryption • Need help?{" "}
              <Link className="text-fuchsia-700 hover:underline" to="/support">
                Contact support
              </Link>
            </p>
          </div>
        </div>

        {shopperNoticeOpen && pendingShopperProfile && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[100] bg-black/50 px-4 py-6 grid place-items-center"
          >
            <div className="w-full max-w-md rounded-2xl border bg-white shadow-2xl overflow-hidden">
              <div className="px-5 py-4 border-b bg-amber-50">
                <h2 className="text-base sm:text-lg font-semibold text-zinc-900">
                  Your account is not fully verified
                </h2>
                <p className="mt-1 text-sm text-zinc-700">
                  You have logged in successfully, but checkout and some protected actions may be unavailable until you complete verification.
                </p>
              </div>

              <div className="px-5 py-4 space-y-3">
                <div className="rounded-xl border bg-zinc-50 px-3 py-3 text-sm">
                  <div className="font-medium text-zinc-900">{pendingShopperProfile.email}</div>
                  <div className="mt-2 space-y-1 text-zinc-700">
                    <div>
                      Email verification:{" "}
                      <span className={pendingShopperProfile.emailVerified ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"}>
                        {pendingShopperProfile.emailVerified ? "Completed" : "Pending"}
                      </span>
                    </div>
                    <div>
                      Phone verification:{" "}
                      <span className={pendingShopperProfile.phoneVerified ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"}>
                        {pendingShopperProfile.phoneVerified ? "Completed" : "Pending"}
                      </span>
                    </div>
                  </div>
                </div>

                <p className="text-sm text-zinc-600">
                  You can verify now, go to your dashboard to manage verification, or continue to the catalogue and come back later.
                </p>
              </div>

              <div className="px-5 py-4 border-t bg-zinc-50 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={handleShopperVerifyNow}
                  className="inline-flex items-center justify-center rounded-xl bg-fuchsia-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-fuchsia-700"
                >
                  Verify now
                </button>

                <button
                  type="button"
                  onClick={handleShopperDashboard}
                  className="inline-flex items-center justify-center rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                >
                  Dashboard
                </button>

                <button
                  type="button"
                  onClick={handleShopperCatalogue}
                  className="inline-flex items-center justify-center rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                >
                  Catalogue
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </SiteLayout>
  );
}