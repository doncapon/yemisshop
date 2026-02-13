// src/pages/Login.tsx
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../api/client.js";
import { useAuthStore, type Role } from "../store/auth";
import SiteLayout from "../layouts/SiteLayout.js";
import DaySpringLogo from "../components/brand/DayspringLogo.js";

type MeResponse = {
  id: string;
  email: string;
  role: Role;
  firstName?: string | null;
  lastName?: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
};

type LoginOk = {
  token: string; // ✅ access token JWT (Option A)
  profile: MeResponse;
  needsVerification?: boolean;
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

  let phoneVerified ;
  if ((import.meta as any)?.env?.PHONE_VERIFY === 'set') {
    phoneVerified =
      raw.phoneVerified === true || !!raw.phoneVerifiedAt || raw.phoneVerifiedAt === 1;
  } else {
    phoneVerified =true;
  }
  return {
    id: String(raw.id ?? ""),
    email: String(raw.email ?? ""),
    role: (raw.role ?? "SHOPPER") as Role,
    firstName: raw.firstName ?? null,
    lastName: raw.lastName ?? null,
    emailVerified,
    phoneVerified,
  };
}

function normRole(r: any): Role {
  const x = String(r || "").trim().toUpperCase();
  return (x === "ADMIN" ||
    x === "SUPER_ADMIN" ||
    x === "SHOPPER" ||
    x === "SUPPLIER" ||
    x === "SUPPLIER_RIDER"
    ? x
    : "SHOPPER") as Role;
}

export default function Login() {
  const hydrated = useAuthStore((s) => s.hydrated);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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

  const nav = useNavigate();
  const loc = useLocation();

  const setAuth = useAuthStore((s) => s.setAuth);
  const setNeedsVerification = useAuthStore((s) => s.setNeedsVerification);
  const clear = useAuthStore((s) => s.clear);

  const fullyVerified = useMemo(() => {
    if (!blockedProfile) return false;
    return !!blockedProfile.emailVerified && !!blockedProfile.phoneVerified;
  }, [blockedProfile]);

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

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const t = setInterval(() => setOtpCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [otpCooldown]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!hydrated) return;
    if (loading || cooldown > 0) return;

    setErr(null);
    setEmailMsg(null);
    setOtpMsg(null);

    setBlockedProfile(null);
    setVerifyToken(null);

    if (!email.trim() || !password.trim()) {
      setErr("Email and password are required");
      return;
    }

    setLoading(true);
    try {
      const res = await api.post("/api/auth/login", { email, password });

      const { token, profile, needsVerification } = res.data as LoginOk;

      // ✅ Option A: store JWT and let axios attach Bearer automatically
      setAuth({ token, user: profile });
      setNeedsVerification(needsVerification ?? false);

      try {
        localStorage.setItem("verifyEmail", profile.email);
        if (needsVerification) localStorage.setItem("verifyToken", token);
      } catch { }

      const from = (loc.state as any)?.from?.pathname as string | undefined;

      const defaultByRole: Record<Role, string> = {
        ADMIN: "/admin",
        SUPER_ADMIN: "/admin",
        SHOPPER: "/",
        SUPPLIER: "/supplier",
        SUPPLIER_RIDER: "/supplier/orders",
      };

      const roleKey = normRole(profile.role);
      nav(from || defaultByRole[roleKey] || "/", { replace: true });
    } catch (e: any) {
      const status = e?.response?.status;

      if (status === 403 && e?.response?.data?.needsVerification) {
        const data = e.response.data as LoginBlocked;

        setErr(data.error || "Please verify your email and phone number to continue.");
        setNeedsVerification(true);

        const p = normalizeProfile(data.profile);
        setBlockedProfile(p);

        const vt = data.verifyToken || null;
        setVerifyToken(vt);

        try {
          if (p?.email) localStorage.setItem("verifyEmail", p.email);
          if (vt) localStorage.setItem("verify_token", vt);
        } catch { }

        setCooldown(1);
        return;
      }

      const msg =
        e?.response?.data?.error ||
        (status === 401 ? "Invalid email or password" : null) ||
        "Login failed";

      setErr(msg);
      clear();
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
      const r = await api.post("/api/auth/resend-verification", { email: blockedProfile.email });

      setEmailMsg("Verification email sent. Please check your inbox (and spam).");
      const next = Number(r.data?.nextResendAfterSec ?? 60);
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
      const r = await api.get("/api/auth/email-status", { params: { email: blockedProfile.email } });
      const emailVerifiedAt = r.data?.emailVerifiedAt;

      setBlockedProfile((p) => (p ? { ...p, emailVerified: !!emailVerifiedAt } : p));
      setEmailMsg(emailVerifiedAt ? "Email verified ✅" : "Email not verified yet. Check your inbox.");
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
      const headers = verifyToken ? { Authorization: `Bearer ${verifyToken}` } : undefined;
      const r = await api.post("/api/auth/resend-otp", {}, { headers });

      setOtpMsg("OTP sent via WhatsApp. Enter the code to verify your phone.");
      const next = Number(r.data?.nextResendAfterSec ?? 60);
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

  const verifyOtp = async () => {
    const code = otp.trim();
    if (!code) {
      setOtpMsg("Enter the OTP code.");
      return;
    }

    setOtpMsg(null);
    setOtpBusy(true);
    try {
      const headers = verifyToken ? { Authorization: `Bearer ${verifyToken}` } : undefined;
      const r = await api.post("/api/auth/verify-otp", { otp: code }, { headers });

      if (r.data?.ok && r.data?.profile) {
        const p = normalizeProfile(r.data.profile);
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

  return (
    <SiteLayout>
      <div className="min-h-[100dvh] bg-gradient-to-b from-zinc-50 to-white">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -right-20 w-[26rem] h-[26rem] rounded-full blur-3xl opacity-35 bg-fuchsia-300/50" />
          <div className="absolute -bottom-28 -left-16 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-30 bg-cyan-300/50" />
        </div>

        <div className="relative grid place-items-center min-h-[100dvh] px-4 py-10">
          <div className="w-full max-w-md">
            <div className="mb-6 text-center">
              <div className="flex justify-center">
                <div className="inline-flex items-center gap-2 rounded-2xl border bg-white/80 backdrop-blur px-4 py-2 shadow-sm">
                  <DaySpringLogo size={26} showText={true} />
                </div>
              </div>

              <h1 className="mt-4 text-2xl md:text-3xl font-semibold text-zinc-900">
                Sign in to your account
              </h1>
              <p className="mt-1 text-sm text-zinc-600">
                Access your cart, orders and personalised dashboard.
              </p>
            </div>

            <form
              onSubmit={submit}
              noValidate
              className="rounded-2xl border bg-white/90 backdrop-blur shadow-sm p-6 space-y-5"
            >
              {err && (
                <div className="text-sm rounded-xl border border-rose-300/60 bg-rose-50 text-rose-700 px-3 py-2">
                  {err}
                </div>
              )}

              {blockedProfile?.role === "SUPPLIER" &&
                (fullyVerified ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 space-y-2">
                    <div className="font-semibold text-emerald-900">Verification complete ✅</div>
                    <div className="text-xs text-emerald-800">
                      Your supplier account is fully verified. Please login again to continue.
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-slate-800 space-y-3">
                    <div className="text-xs text-slate-700">
                      Supplier account is pending verification:
                      <span className="ml-2 font-medium text-slate-900">{blockedProfile.email}</span>
                    </div>

                    {!blockedProfile.emailVerified && (
                      <div className="space-y-2">
                        <div className="text-sm font-semibold text-slate-900">Verify your email</div>
                        <div className="text-xs text-slate-600">
                          Click the link we sent to your email. You can resend it below.
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={resendEmail}
                            disabled={emailBusy || emailCooldown > 0}
                            className="inline-flex items-center justify-center rounded-xl bg-zinc-900 text-white px-3 py-2 text-xs font-semibold disabled:opacity-60"
                          >
                            {emailBusy
                              ? "Sending…"
                              : emailCooldown > 0
                                ? `Resend in ${emailCooldown}s`
                                : "Resend verification email"}
                          </button>
                          <button
                            type="button"
                            onClick={checkEmailStatus}
                            disabled={emailBusy}
                            className="inline-flex items-center justify-center rounded-xl border bg-white px-3 py-2 text-xs font-semibold text-slate-800 disabled:opacity-60"
                          >
                            {emailBusy ? "Checking…" : "I verified email (check)"}
                          </button>
                        </div>
                        {emailMsg && <div className="text-xs text-slate-700">{emailMsg}</div>}
                      </div>
                    )}

                    {!blockedProfile.phoneVerified && (
                      <div className="space-y-2">
                        <div className="text-sm font-semibold text-slate-900">
                          Verify your phone (WhatsApp OTP)
                        </div>
                        <div className="text-xs text-slate-600">
                          We’ll send a one-time code to your WhatsApp number on file.
                        </div>

                        <div className="flex flex-wrap gap-2 items-center">
                          <button
                            type="button"
                            onClick={sendOtp}
                            disabled={otpBusy || otpCooldown > 0}
                            className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white px-3 py-2 text-xs font-semibold disabled:opacity-60"
                          >
                            {otpBusy
                              ? "Sending…"
                              : otpCooldown > 0
                                ? `Send again in ${otpCooldown}s`
                                : "Send OTP"}
                          </button>

                          <input
                            value={otp}
                            onChange={(e) => setOtp(e.target.value)}
                            placeholder="Enter OTP"
                            className="w-32 rounded-xl border bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:ring-4 focus:ring-fuchsia-200"
                          />

                          <button
                            type="button"
                            onClick={verifyOtp}
                            disabled={otpBusy}
                            className="inline-flex items-center justify-center rounded-xl border bg-white px-3 py-2 text-xs font-semibold text-slate-800 disabled:opacity-60"
                          >
                            {otpBusy ? "Verifying…" : "Verify OTP"}
                          </button>
                        </div>

                        {!verifyToken && (
                          <div className="text-xs text-rose-700">
                            Missing verifyToken from server. Your login(403) should return{" "}
                            <code>verifyToken</code> so OTP endpoints can work.
                          </div>
                        )}

                        {otpMsg && <div className="text-xs text-slate-700">{otpMsg}</div>}
                      </div>
                    )}
                  </div>
                ))}

              <div className="space-y-1">
                <label className="block text-sm font-medium text-zinc-800">Email</label>
                <div className="relative group">
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="username"
                    className="peer w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200 transition shadow-sm"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-fuchsia-600 transition">
                    ✉
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-zinc-800">Password</label>
                  <Link className="text-xs text-fuchsia-700 hover:underline" to="/forgot-password">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative group">
                  <input
                    value={password}
                    type="password"
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="peer w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200 transition shadow-sm"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-fuchsia-600 transition">
                    🔒
                  </span>
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

            <p className="mt-5 text-center text-xs text-zinc-500">
              Secured by industry-standard encryption • Need help?{" "}
              <Link className="text-fuchsia-700 hover:underline" to="/support">
                Contact support
              </Link>
            </p>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
