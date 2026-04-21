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
  if (
    s.startsWith("/login") ||
    s.startsWith("/register") ||
    s.startsWith("/forgot-password")
  ) {
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
  phoneVerified?: boolean;
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

  return {
    id: String(raw.id ?? ""),
    email: String(raw.email ?? ""),
    role: normRole(raw.role ?? "SHOPPER"),
    firstName: raw.firstName ?? null,
    middleName: raw.middleName ?? null,
    lastName: raw.lastName ?? null,
    emailVerified,
    phoneVerified: raw.phoneVerified === true || !!raw.phoneVerifiedAt || raw.phoneVerifiedAt === 1,
    status: raw.status ?? null,
  };
}

function normRole(r: any): Role {
  let x = String(r || "").trim().toUpperCase();
  x = x.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
  if (x === "SUPERADMIN") x = "SUPER_ADMIN";
  if (x === "SUPER_ADMINISTRATOR") x = "SUPER_ADMIN";

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

function pickMePayload(payload: any): any {
  return payload?.data?.user ?? payload?.data?.data ?? payload?.data ?? payload?.user ?? payload ?? null;
}

function getAuthUserKey(user: any) {
  const id = String(user?.id ?? "").trim();
  const email = String(user?.email ?? "").trim().toLowerCase();
  return id || email || "";
}

export default function Login() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);

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

  const [verifyPanelOpen, setVerifyPanelOpen] = useState(true);

  // shopper choice gate
  const [pendingShopperProfile, setPendingShopperProfile] = useState<MeResponse | null>(null);
  const [shopperNoticeOpen, setShopperNoticeOpen] = useState(false);
  const preLoginTimedOutUserKeyRef = useRef<string>("");

  const nav = useNavigate();
  const loc = useLocation();

  const returnToRef = useRef<string | null>(null);
  const suppressAutoRedirectRef = useRef(false);

  const fullyVerified = useMemo(() => {
    if (!blockedProfile) return false;
    return !!blockedProfile.emailVerified;
  }, [blockedProfile]);

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

  useEffect(() => {
    if (!returnToRef.current && computedReturnTo) {
      returnToRef.current = computedReturnTo;
    }
  }, [computedReturnTo]);

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

    const profile = normalizeProfile(user);
    const target = profile
      ? resolvePostLoginTarget(profile)
      : getDefaultPathByRole(normRole(user?.role));

    nav(target, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user?.id, shopperNoticeOpen]);

  useEffect(() => {
    if (fullyVerified) {
      setErr(null);
      setEmailMsg(null);
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

  async function fetchCanonicalMe(): Promise<MeResponse | null> {
    const res = await api.get("/api/auth/me", AXIOS_COOKIE_CFG);
    return normalizeProfile(pickMePayload(res));
  }

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

  function resolvePostLoginTarget(profile: MeResponse) {
    const currentUserKey = getAuthUserKey(profile);

    let timedOutUserKey = preLoginTimedOutUserKeyRef.current;
    let genericReturnTo = "";

    try {
      if (!timedOutUserKey) {
        timedOutUserKey = sessionStorage.getItem("auth:timedOutUserKey") || "";
      }
      genericReturnTo = sessionStorage.getItem(RETURN_TO_KEY) || "";
    } catch {
      //
    }

    const safeGenericReturnTo = safeReturnTo(genericReturnTo);
    const sameTimedOutUser =
      !!currentUserKey &&
      !!timedOutUserKey &&
      currentUserKey === timedOutUserKey;

    if (sameTimedOutUser) {
      return returnToRef.current || safeGenericReturnTo || getDefaultPathByRole(normRole(profile.role));
    }

    if (!timedOutUserKey) {
      return returnToRef.current || safeGenericReturnTo || getDefaultPathByRole(normRole(profile.role));
    }

    return getDefaultPathByRole(normRole(profile.role));
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

    window.setTimeout(() => {
      nav(path, { replace: true });
    }, 0);
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading || cooldown > 0) return;

    setErr(null);
    setEmailMsg(null);
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
      try {
        preLoginTimedOutUserKeyRef.current =
          sessionStorage.getItem("auth:timedOutUserKey") || "";
      } catch {
        preLoginTimedOutUserKeyRef.current = "";
      }

      const res = await api.post<LoginOk>(
        "/api/auth/login",
        {
          email: email.trim(),
          password: password.trim(),
        },
        AXIOS_COOKIE_CFG
      );

      const data = res.data as LoginOk;
      const responseProfile = normalizeProfile(data?.profile);

      if (!responseProfile?.id) {
        throw new Error("Login response missing profile");
      }

      const roleKey = normRole(responseProfile.role);
      const isFullyVerified = !!responseProfile.emailVerified;
      const needsVer = !!data?.needsVerification;
      const vt = data?.verifyToken ?? null;

      setVerifyToken(vt);

      if (roleKey === "SUPPLIER" && !isFullyVerified) {
        suppressAutoRedirectRef.current = true;
        commitLogin(responseProfile, true, vt);
        setBlockedProfile(responseProfile);
        setErr("Please verify your email address to continue.");
        setVerifyPanelOpen(true);
        setCooldown(1);
        return;
      }

      if (roleKey === "SHOPPER" && !isFullyVerified) {
        suppressAutoRedirectRef.current = true;
        setPendingShopperProfile(responseProfile);
        setShopperNoticeOpen(true);
        setCooldown(1);
        return;
      }

      const canonicalProfile = (await fetchCanonicalMe()) || responseProfile;

      commitLogin(canonicalProfile, needsVer, vt);

      const target = resolvePostLoginTarget(canonicalProfile);
      finalizeNavigate(target);
    } catch (e: any) {
      const status = e?.response?.status;

      if (status === 403 && e?.response?.data?.needsVerification) {
        const data = e.response.data as LoginBlocked;
        const p = normalizeProfile(data.profile);
        const vt = data.verifyToken || null;

        setVerifyToken(vt);
        setNeedsVerification(true);
        setErr(data.error || "Please verify your email address to continue.");

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

  const handleShopperVerifyNow = async () => {
    if (!pendingShopperProfile) return;

    const canonicalProfile = (await fetchCanonicalMe().catch(() => null)) || pendingShopperProfile;
    commitLogin(canonicalProfile, true, verifyToken);
    finalizeNavigate("/verify");
  };

  const handleShopperDashboard = async () => {
    if (!pendingShopperProfile) return;

    const canonicalProfile = (await fetchCanonicalMe().catch(() => null)) || pendingShopperProfile;
    commitLogin(canonicalProfile, true, verifyToken);
    finalizeNavigate("/dashboard");
  };

  const handleShopperCatalogue = async () => {
    if (!pendingShopperProfile) return;

    const canonicalProfile = (await fetchCanonicalMe().catch(() => null)) || pendingShopperProfile;
    commitLogin(canonicalProfile, true, verifyToken);
    finalizeNavigate("/");
  };

  const showSupplierVerify = blockedProfile?.role === "SUPPLIER" && !fullyVerified;

  return (
    <SiteLayout>
      <div className="bg-gradient-to-b from-zinc-50 to-white">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-28 -right-24 h-[22rem] w-[22rem] rounded-full bg-fuchsia-300/50 blur-3xl opacity-30 sm:h-[26rem] sm:w-[26rem]" />
          <div className="absolute -bottom-32 -left-20 h-[24rem] w-[24rem] rounded-full bg-cyan-300/50 blur-3xl opacity-25 sm:h-[28rem] sm:w-[28rem]" />
        </div>

        <div className="relative flex flex-col items-center px-3 pt-3 pb-6 sm:px-4 sm:pt-4 sm:pb-8">
          <div className="w-full max-w-md">
            <div className="mb-3 text-center sm:mb-6">
              <div className="flex justify-center">
                <div className="inline-flex items-center gap-2 rounded-2xl border bg-white/90 px-3 py-1.5 shadow-sm backdrop-blur sm:px-4 sm:py-2">
                  <DaySpringLogo size={26} showText={true} />
                </div>
              </div>

              <h1 className="mt-3 text-[22px] font-semibold leading-tight text-zinc-900 sm:mt-4 sm:text-2xl md:text-3xl">
                Sign in
              </h1>
              <p className="mt-1 text-sm text-zinc-600">
                Access your cart, orders and personalised dashboard.
              </p>
            </div>

            <form
              onSubmit={submit}
              noValidate
              className="space-y-3 rounded-2xl border bg-white/95 p-3 shadow-sm backdrop-blur sm:space-y-5 sm:p-6"
            >
              {err && (
                <div className="rounded-xl border border-rose-300/60 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {err}
                </div>
              )}

              {blockedProfile?.role === "SUPPLIER" &&
                (fullyVerified ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    <div className="font-semibold">Verification complete ✅</div>
                    <div className="mt-1 text-xs text-emerald-800">
                      Your supplier account email is verified. Please login again to continue.
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50">
                    <button
                      type="button"
                      onClick={() => setVerifyPanelOpen((v) => !v)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                      aria-expanded={verifyPanelOpen}
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          Supplier verification required
                        </div>
                        <div className="max-w-[260px] truncate text-xs text-slate-700">
                          {blockedProfile.email}
                        </div>
                      </div>
                      <div className="rounded-full border border-amber-200 bg-white px-2 py-1 text-xs font-semibold text-slate-800">
                        {verifyPanelOpen ? "Hide" : "Show"}
                      </div>
                    </button>

                    {verifyPanelOpen && (
                      <div className="space-y-4 px-4 pb-4">
                        {!blockedProfile.emailVerified && (
                          <div className="rounded-xl border border-amber-200 bg-white/80 p-3">
                            <div className="text-sm font-semibold text-slate-900">
                              Verify your email
                            </div>
                            <div className="mt-1 text-xs text-slate-600">
                              Click the link we sent to your email. You can resend it below.
                            </div>
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                              <button
                                type="button"
                                onClick={resendEmail}
                                disabled={emailBusy || emailCooldown > 0}
                                className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-60"
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

                        {!showSupplierVerify && (
                          <div className="text-xs text-slate-700">
                            You can continue once your email is verified.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

              {/* Google sign-in */}
              <a
                href={`${import.meta.env.VITE_API_URL ?? ""}/api/auth/google${returnToRef.current ? `?returnTo=${encodeURIComponent(returnToRef.current)}` : ""}`}
                className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-zinc-200"
              >
                <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.14 0 5.95 1.08 8.17 2.85l6.08-6.08C34.46 3.14 29.5 1 24 1 14.72 1 6.93 6.56 3.27 14.44l7.07 5.49C12.1 13.44 17.58 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.5 24.5c0-1.64-.15-3.22-.43-4.75H24v9h12.68c-.55 2.99-2.22 5.52-4.72 7.22l7.25 5.63C43.44 37.45 46.5 31.44 46.5 24.5z" />
                  <path fill="#FBBC05" d="M10.34 28.07A14.57 14.57 0 0 1 9.5 24c0-1.41.2-2.78.56-4.07l-7.07-5.49A23.9 23.9 0 0 0 .5 24c0 3.84.92 7.47 2.55 10.69l7.29-6.62z" />
                  <path fill="#34A853" d="M24 46.5c5.94 0 10.93-1.97 14.57-5.35l-7.25-5.63c-2.01 1.35-4.59 2.15-7.32 2.15-6.42 0-11.9-3.94-13.66-9.43l-7.29 6.62C6.93 41.44 14.72 47 24 47z" />
                  <path fill="none" d="M0 0h48v48H0z" />
                </svg>
                Continue with Google
              </a>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-zinc-200" />
                <span className="text-xs text-zinc-400">or</span>
                <div className="h-px flex-1 bg-zinc-200" />
              </div>

              <div className="space-y-1">
                <label htmlFor="login-email" className="block text-sm font-medium text-zinc-800">Email</label>
                <div className="relative">
                  <input
                    id="login-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="username"
                    inputMode="email"
                    className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 pr-10 text-[16px] text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">
                    ✉
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <label htmlFor="login-password" className="block text-sm font-medium leading-tight text-zinc-800">
                    Password
                  </label>
                  <Link
                    className="self-start text-xs leading-tight text-fuchsia-700 hover:underline sm:self-auto"
                    to="/forgot-password"
                  >
                    Forgot password?
                  </Link>
                </div>

                <div className="relative">
                  <input
                    id="login-password"
                    value={password}
                    type={showPassword ? "text" : "password"}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 pr-14 text-[16px] text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-300 bg-white/90 shadow-sm transition hover:bg-zinc-50"
                    aria-label={showPassword ? "Hide" : "Show"}
                    aria-pressed={showPassword}
                  >
                    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
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
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-600 to-pink-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:shadow-md focus:outline-none focus:ring-4 focus:ring-fuchsia-300/40 active:scale-[0.995] disabled:opacity-50"
              >
                {!hydrated
                  ? "Preparing…"
                  : loading
                    ? "Logging in…"
                    : cooldown > 0
                      ? `Try again in ${cooldown}s`
                      : "Log in"}
              </button>

              <div className="pt-0.5 text-center text-sm text-zinc-700">
                Don’t have an account?{" "}
                <Link className="text-fuchsia-700 hover:underline" to="/register">
                  Create one
                </Link>
              </div>
            </form>

            <p className="mt-3 px-2 text-center text-xs text-zinc-500 sm:mt-5 sm:px-4">
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
            className="fixed inset-0 z-[100] grid place-items-center bg-black/50 px-4 py-4 sm:py-6"
          >
            <div className="w-full max-w-md overflow-hidden rounded-2xl border bg-white shadow-2xl">
              <div className="border-b bg-amber-50 px-4 py-3 sm:px-5 sm:py-4">
                <h2 className="text-base font-semibold text-zinc-900 sm:text-lg">
                  Your account email is not yet verified
                </h2>
                <p className="mt-1 text-sm text-zinc-700">
                  You have logged in successfully, but checkout and some protected actions may be unavailable until you verify your email.
                </p>
              </div>

              <div className="space-y-3 px-4 py-3 sm:px-5 sm:py-4">
                <div className="rounded-xl border bg-zinc-50 px-3 py-3 text-sm">
                  <div className="font-medium text-zinc-900">{pendingShopperProfile.email}</div>
                  <div className="mt-2 text-zinc-700">
                    Email verification:{" "}
                    <span
                      className={
                        pendingShopperProfile.emailVerified
                          ? "font-semibold text-emerald-700"
                          : "font-semibold text-amber-700"
                      }
                    >
                      {pendingShopperProfile.emailVerified ? "Completed" : "Pending"}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-zinc-600">
                  You can verify now, go to your dashboard to manage verification, or continue to the catalogue and come back later.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2 border-t bg-zinc-50 px-4 py-3 sm:px-5 sm:py-4 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={handleShopperVerifyNow}
                  className="inline-flex items-center justify-center rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-700"
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