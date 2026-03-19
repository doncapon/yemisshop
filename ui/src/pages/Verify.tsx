// src/pages/Verify.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Mail,
  MailCheck,
  MailWarning,
  RefreshCcw,
  Clock,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
  Inbox,
  CheckCircle2,
} from "lucide-react";
import api from "../api/client";
import SiteLayout from "../layouts/SiteLayout";

/* ---------------------- Cookie auth helpers ---------------------- */
const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function isAuthError(e: any) {
  const s = e?.response?.status;
  return s === 401 || s === 403;
}

/* ---------------------- Types ---------------------- */
type ResendResp = { ok: boolean; nextResendAfterSec: number; expiresInSec: number };

type MeResponse = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  emailVerifiedAt?: string | null;
  emailVerified?: boolean;
  status?: string | null;
};

type NormalizedMe = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  emailVerifiedAt?: string | null;
  emailVerified: boolean;
  status?: string | null;
};

function unwrapUserPayload(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;

  if (raw.data && typeof raw.data === "object") return raw.data;
  if (raw.profile && typeof raw.profile === "object") return raw.profile;
  if (raw.user && typeof raw.user === "object") return raw.user;

  return raw;
}

function normalizeMe(raw: any): NormalizedMe | null {
  const src = unwrapUserPayload(raw);
  if (!src || typeof src !== "object") return null;

  const id = String(src.id ?? "").trim();
  const email = String(src.email ?? "").trim();

  if (!id && !email) return null;

  const emailVerified = src.emailVerified === true || !!src.emailVerifiedAt;

  return {
    id,
    email,
    firstName: src.firstName ?? null,
    lastName: src.lastName ?? null,
    emailVerifiedAt: src.emailVerifiedAt ?? null,
    emailVerified,
    status: src.status ?? null,
  };
}

function mergeVerifiedState(
  prev: NormalizedMe | null,
  next: NormalizedMe | null
): NormalizedMe | null {
  if (!prev) return next;
  if (!next) return prev;

  const keepVerified = prev.emailVerified || next.emailVerified;
  const keepVerifiedAt = prev.emailVerifiedAt || next.emailVerifiedAt || null;

  return {
    ...prev,
    ...next,
    email: next.email || prev.email,
    id: next.id || prev.id,
    emailVerified: keepVerified,
    emailVerifiedAt: keepVerifiedAt,
  };
}

function StatChip({
  tone = "amber",
  children,
}: {
  tone?: "amber" | "green" | "zinc";
  children: React.ReactNode;
}) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    zinc: "border-zinc-200 bg-zinc-50 text-zinc-700",
  } as const;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] sm:text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({
  title,
  subtitle,
  icon,
  right,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b bg-gradient-to-b from-zinc-50 to-white px-4 py-4 sm:px-5 sm:py-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        {icon ? (
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
            {icon}
          </div>
        ) : null}

        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 sm:text-base">{title}</h3>
          {subtitle ? <p className="mt-1 text-xs text-zinc-500 sm:text-sm">{subtitle}</p> : null}
        </div>
      </div>

      {right ? <div className="w-full md:w-auto">{right}</div> : null}
    </div>
  );
}

function ActionButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export default function VerifyEmail() {
  const location = useLocation();
  const nav = useNavigate();

  const qs = new URLSearchParams(location.search);
  const eParam = (qs.get("e") || "").toLowerCase();
  const okParam = qs.get("ok");
  const errParam = qs.get("err");

  const [me, setMe] = useState<NormalizedMe | null>(null);
  const [targetEmail, setTargetEmail] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [banner, setBanner] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailCooldown, setEmailCooldown] = useState(0);
  const emailTimerRef = useRef<number | null>(null);

  const [statusChecked, setStatusChecked] = useState(false);

  const emailVerified = !!me?.emailVerified;
  const isLoggedIn = !!me?.id;

  const headerTitle = useMemo(() => {
    return emailVerified ? "Email verified" : "Verify your email";
  }, [emailVerified]);

  useEffect(() => {
    const stored = (localStorage.getItem("verifyEmail") || "").toLowerCase();
    const fromParam = eParam || stored;
    setTargetEmail(fromParam);
  }, [eParam]);

  useEffect(() => {
    setStatusChecked(false);
  }, [targetEmail]);

  useEffect(() => {
    if (okParam === "1") {
      setBanner("Your email has been verified successfully. You can continue.");
      setErr(null);

      setMe((prev) =>
        mergeVerifiedState(
          prev,
          normalizeMe({
            ...(prev || {}),
            email: prev?.email || targetEmail,
            emailVerifiedAt: new Date().toISOString(),
            emailVerified: true,
          })
        )
      );
    } else if (errParam) {
      setErr("That verification link could not be validated. Please request a new email below.");
    }
  }, [okParam, errParam, targetEmail]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);

        try {
          const profileRes = await api.get("/api/profile/me", AXIOS_COOKIE_CFG);
          if (!alive) return;

          const normalized = normalizeMe(profileRes.data);
          setMe((prev) => mergeVerifiedState(prev, normalized));

          if (!targetEmail && normalized?.email) {
            setTargetEmail(normalized.email.toLowerCase());
          }

          return;
        } catch (e: any) {
          if (!isAuthError(e)) {
            // continue to auth/me fallback
          }
        }

        const authRes = await api.get("/api/auth/me", AXIOS_COOKIE_CFG);
        if (!alive) return;

        const normalized = normalizeMe(authRes.data);
        setMe((prev) => mergeVerifiedState(prev, normalized));

        if (!targetEmail && normalized?.email) {
          setTargetEmail(normalized.email.toLowerCase());
        }
      } catch {
        if (alive) {
          setMe((prev) => prev ?? null);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [location.key]);

  useEffect(() => {
    if (!targetEmail || statusChecked) return;

    let alive = true;

    (async () => {
      try {
        const { data } = await api.get("/api/auth/email-status", {
          params: { email: targetEmail },
        });

        if (!alive) return;

        if (data?.emailVerifiedAt) {
          setMe((prev) =>
            mergeVerifiedState(
              prev,
              normalizeMe({
                ...(prev || {}),
                email: targetEmail,
                emailVerifiedAt: data.emailVerifiedAt,
                emailVerified: true,
              })
            )
          );
        }
      } catch {
        //
      } finally {
        if (alive) setStatusChecked(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [targetEmail, statusChecked]);

  useEffect(() => {
    if (emailCooldown <= 0) return;

    emailTimerRef.current = window.setTimeout(() => {
      setEmailCooldown((s) => Math.max(0, s - 1));
    }, 1000) as unknown as number;

    return () => {
      if (emailTimerRef.current) window.clearTimeout(emailTimerRef.current);
      emailTimerRef.current = null;
    };
  }, [emailCooldown]);

  const refreshStatus = async () => {
    setErr(null);
    setBanner(null);

    try {
      let foundVerified = false;

      if (targetEmail) {
        const { data } = await api.get("/api/auth/email-status", {
          params: { email: targetEmail },
        });

        if (data?.emailVerifiedAt) {
          foundVerified = true;
          setMe((prev) =>
            mergeVerifiedState(
              prev,
              normalizeMe({
                ...(prev || {}),
                email: targetEmail,
                emailVerifiedAt: data.emailVerifiedAt,
                emailVerified: true,
              })
            )
          );
        }
      }

      try {
        const r = await api.get("/api/profile/me", AXIOS_COOKIE_CFG);
        const normalized = normalizeMe(r.data);
        setMe((prev) => mergeVerifiedState(prev, normalized));

        const finalVerified = foundVerified || !!normalized?.emailVerified;
        setBanner(
          finalVerified
            ? "Your email is verified. You can continue."
            : "Still waiting for confirmation. Check your inbox or resend the email below."
        );
        return;
      } catch (e: any) {
        if (!isAuthError(e)) {
          try {
            const r2 = await api.get("/api/auth/me", AXIOS_COOKIE_CFG);
            const normalized = normalizeMe(r2.data);
            setMe((prev) => mergeVerifiedState(prev, normalized));

            const finalVerified = foundVerified || !!normalized?.emailVerified;
            setBanner(
              finalVerified
                ? "Your email is verified. You can continue."
                : "Still waiting for confirmation. Check your inbox or resend the email below."
            );
            return;
          } catch {
            //
          }
        }
      }

      setBanner(
        foundVerified
          ? "Your email is verified. You can continue."
          : "Still waiting for confirmation. Check your inbox or resend the email below."
      );
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to refresh status");
    }
  };

  const resendPublic = async () => {
    if (!targetEmail || sendingEmail || emailCooldown > 0) return;

    setSendingEmail(true);
    setErr(null);
    setBanner(null);

    try {
      const { data } = await api.post<ResendResp>("/api/auth/resend-verification", {
        email: targetEmail,
      });

      setEmailCooldown(Math.max(0, Number(data?.nextResendAfterSec ?? 60)));
      setBanner("Verification email sent. Please check your inbox.");
    } catch (e: any) {
      const retryAfter = e?.response?.data?.retryAfterSec;
      if (retryAfter) setEmailCooldown(retryAfter);
      setErr(e?.response?.data?.error || "Could not resend verification email");
    } finally {
      setSendingEmail(false);
    }
  };

  const resendAuthed = async () => {
    if (!isLoggedIn || sendingEmail || emailCooldown > 0) return;

    setSendingEmail(true);
    setErr(null);
    setBanner(null);

    try {
      const { data } = await api.post<ResendResp>("/api/auth/resend-email", {}, AXIOS_COOKIE_CFG);
      setEmailCooldown(Math.max(0, Number(data?.nextResendAfterSec ?? 60)));
      setBanner("Verification email sent. Please check your inbox.");
    } catch (e: any) {
      if (isAuthError(e)) {
        setErr("Your session expired. Please sign in again.");
        nav("/login", { state: { from: location.pathname + location.search } });
        return;
      }

      const retryAfter = e?.response?.data?.retryAfterSec;
      if (retryAfter) setEmailCooldown(retryAfter);
      setErr(e?.response?.data?.error || "Could not resend verification email");
    } finally {
      setSendingEmail(false);
    }
  };

  const nextStepPath = "/dashboard";
  const shownEmail = targetEmail || me?.email || "—";

  return (
    <SiteLayout>
      <div className="min-h-[80vh] bg-zinc-50/60">
        <div className="relative overflow-hidden border-b border-zinc-200 bg-gradient-to-br from-primary-300 via-primary-600 to-indigo-400 text-white">
          <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium backdrop-blur">
                {emailVerified ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                <span>{emailVerified ? "Verified" : "Action needed"}</span>
              </div>

              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{headerTitle}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/90 sm:text-base">
                {emailVerified
                  ? "Your account email is confirmed."
                  : "Please verify your email address to continue using your account."}
              </p>

              {!emailVerified ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <StatChip tone="amber">
                    <Clock size={14} />
                    <span>Email pending</span>
                  </StatChip>
                </div>
              ) : null}
            </motion.div>
          </div>
        </div>

        <div className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:px-6 sm:py-8">
          <Card>
            <CardHeader
              title="Verification status"
              subtitle={
                emailVerified
                  ? "Your email has been verified successfully."
                  : "Follow the steps below to verify your email."
              }
              icon={emailVerified ? <MailCheck size={18} /> : <MailWarning size={18} />}
              right={
                <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
                  <ActionButton
                    onClick={refreshStatus}
                    className="border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
                  >
                    <RefreshCcw size={16} />
                    Check status
                  </ActionButton>

                  {emailVerified ? (
                    <Link
                      to={nextStepPath}
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary-700"
                    >
                      Continue
                      <ChevronRight size={16} />
                    </Link>
                  ) : null}
                </div>
              }
            />

            <div className="p-4 sm:p-5">
              {loading ? (
                <div className="animate-pulse space-y-3">
                  <div className="h-4 w-2/3 rounded bg-zinc-200" />
                  <div className="h-3 w-1/2 rounded bg-zinc-200" />
                  <div className="h-20 w-full rounded-2xl bg-zinc-100" />
                </div>
              ) : (
                <>
                  {banner ? (
                    <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                      {banner}
                    </div>
                  ) : null}

                  {err ? (
                    <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {err}
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                          <Mail size={18} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                            Email address
                          </p>
                          <p className="mt-1 break-all text-sm font-semibold text-zinc-900 sm:text-base">
                            {shownEmail}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {emailVerified ? (
                          <StatChip tone="green">
                            <ShieldCheck size={14} />
                            <span>
                              Verified
                              {me?.emailVerifiedAt
                                ? ` on ${new Date(me.emailVerifiedAt).toLocaleString()}`
                                : ""}
                            </span>
                          </StatChip>
                        ) : (
                          <StatChip tone="zinc">
                            <Inbox size={14} />
                            <span>Waiting for confirmation</span>
                          </StatChip>
                        )}
                      </div>
                    </div>
                  </div>

                  {!emailVerified ? (
                    <div className="mt-5 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                          <Mail size={18} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-semibold text-zinc-900 sm:text-base">
                            Check your email
                          </h4>
                          <p className="mt-1 text-sm leading-6 text-zinc-600">
                            We sent a verification link to your email address. Open it, click the
                            link, then return here and tap <b>Check status</b>.
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <ActionButton
                          onClick={resendPublic}
                          disabled={sendingEmail || emailCooldown > 0 || !targetEmail}
                          className="bg-primary-600 text-white hover:bg-primary-700"
                        >
                          {sendingEmail ? (
                            <>
                              <RefreshCcw size={16} className="animate-spin" />
                              Sending...
                            </>
                          ) : emailCooldown > 0 ? (
                            <>
                              <Clock size={16} />
                              Resend in {emailCooldown}s
                            </>
                          ) : (
                            <>
                              <Mail size={16} />
                              Resend email
                            </>
                          )}
                        </ActionButton>

                        {isLoggedIn ? (
                          <ActionButton
                            onClick={resendAuthed}
                            disabled={sendingEmail || emailCooldown > 0}
                            className="border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
                          >
                            <RefreshCcw size={16} />
                            Resend (logged in)
                          </ActionButton>
                        ) : null}

                        <ActionButton
                          onClick={refreshStatus}
                          className="border border-zinc-200 bg-purple-300 text-zinc-800 hover:bg-purple-200"
                        >
                          <RefreshCcw size={16} />
                          I’ve verified - Refresh status
                        </ActionButton>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </Card>

          {!emailVerified ? (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader
                  title="Open your inbox"
                  subtitle="Go directly to your email provider"
                  icon={<Mail size={18} />}
                />
                <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 sm:p-5">
                  {[
                    { name: "Gmail", href: "https://mail.google.com/", color: "text-rose-600" },
                    { name: "Outlook", href: "https://outlook.live.com/mail/", color: "text-sky-700" },
                    { name: "Yahoo Mail", href: "https://mail.yahoo.com/", color: "text-violet-700" },
                  ].map((x) => (
                    <a
                      key={x.name}
                      href={x.href}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex min-h-[52px] items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 transition hover:bg-zinc-50"
                    >
                      <span className={`text-sm font-semibold ${x.color}`}>{x.name}</span>
                      <ExternalLink
                        size={16}
                        className="text-zinc-500 transition group-hover:translate-x-0.5"
                      />
                    </a>
                  ))}
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Troubleshooting tips"
                  subtitle="If you still can’t find the email"
                  icon={<MailWarning size={18} />}
                />
                <div className="p-4 sm:p-5">
                  <ul className="space-y-3 text-sm leading-6 text-zinc-700">
                    <li className="rounded-xl bg-zinc-50 px-3 py-2">
                      Check your <b>Spam</b> or <b>Promotions</b> folder.
                    </li>
                    <li className="rounded-xl bg-zinc-50 px-3 py-2">
                      Wait a minute and try again — some providers can be slow.
                    </li>
                    <li className="rounded-xl bg-zinc-50 px-3 py-2">
                      Add <code className="rounded bg-zinc-200 px-1.5 py-0.5">no-reply@dayspring.com</code>{" "}
                      to your contacts.
                    </li>
                    <li className="rounded-xl bg-zinc-50 px-3 py-2">
                      Use the <b>Resend email</b> button above.
                    </li>
                    <li className="rounded-xl bg-zinc-50 px-3 py-2">
                      Still stuck?{" "}
                      <Link to="/contact" className="font-medium text-primary-700 underline">
                        Contact support
                      </Link>
                      .
                    </li>
                  </ul>
                </div>
              </Card>
            </div>
          ) : null}

          {emailVerified ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                to={nextStepPath}
                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary-700"
              >
                Continue
                <ChevronRight size={16} />
              </Link>

              <Link
                to="/"
                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
              >
                Back to home
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </SiteLayout>
  );
}