// src/pages/VerifyEmail.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
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
  UserCog,
  Smartphone,
  CheckCircle2,
} from 'lucide-react';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

type ResendResp = { ok: boolean; nextResendAfterSec: number; expiresInSec: number };

type MeResponse = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  emailVerifiedAt?: string | null;
  phoneVerifiedAt?: string | null;
};

function StatChip({
  tone = 'amber',
  children,
}: {
  tone?: 'amber' | 'green' | 'zinc';
  children: React.ReactNode;
}) {
  const tones = {
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    zinc: 'bg-zinc-50 text-zinc-700 border-zinc-200',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 border rounded-full ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-white shadow-sm overflow-hidden ${className}`}>{children}</div>;
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
    <div className="px-4 md:px-5 py-3 border-b bg-gradient-to-b from-surface to-white flex items-center justify-between">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-[2px] text-primary-700">{icon}</div>}
        <div>
          <h3 className="text-ink font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-ink-soft">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

export default function VerifyEmail() {
  const location = useLocation();
  const { token } = useAuthStore();
  const setAuthUser = useAuthStore((s) => s.setAuth); // if your store has a helper to update user snapshot (optional)
  const storeUser = useAuthStore((s) => s.user);

  const qs = new URLSearchParams(location.search);
  const eParam = (qs.get('e') || '').toLowerCase();
  const okParam = qs.get('ok'); // "1" if server confirmed success
  const errParam = qs.get('err'); // e.g., "token" when invalid/expired

  // ---------- State ----------
  const [me, setMe] = useState<MeResponse | null>(storeUser ?? null);
  const [targetEmail, setTargetEmail] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const [banner, setBanner] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailCooldown, setEmailCooldown] = useState(0);
  const emailTimerRef = useRef<number | null>(null);

  // OTP
  const [otp, setOtp] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpMsg, setOtpMsg] = useState<string | null>(null);
  const [otpErr, setOtpErr] = useState<string | null>(null);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const otpTimerRef = useRef<number | null>(null);
  const phoneVerified = !!me?.phoneVerifiedAt;

  // ---------- Derivations ----------
  const headerTitle = useMemo(() => (me?.emailVerifiedAt ? 'Email verified' : 'Verify your email'), [me?.emailVerifiedAt]);
  const showOtpBlock = !!token && !phoneVerified; // Only show OTP when logged-in and phone not yet verified

  // ---------- Prime targetEmail (param -> localStorage -> profile) ----------
  useEffect(() => {
    const stored = (localStorage.getItem('verifyEmail') || '').toLowerCase();
    const fromParam = eParam || stored;
    setTargetEmail(fromParam);
  }, [eParam]);

  // ---------- Banner from redirect params ----------
  useEffect(() => {
    if (okParam === '1') {
      setBanner('Your email is now verified. You can continue.');
      setErr(null);
      setMe((m) => ({ ...(m || ({} as any)), email: (m?.email || targetEmail), emailVerifiedAt: new Date().toISOString() }));
    } else if (errParam) {
      setErr('That verification link could not be validated. Please resend a new one below.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [okParam, errParam]);

  // ---------- Load profile when auth token exists ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const { data } = await api.get<MeResponse>('/api/profile/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!alive) return;
        setMe(data);
        if (!targetEmail) setTargetEmail((data?.email || '').toLowerCase());
      } catch {
        // ignore
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ---------- One-time public email status check ----------
  const [statusChecked, setStatusChecked] = useState(false);
  useEffect(() => {
    if (!targetEmail || statusChecked) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get('/api/auth/email-status', { params: { email: targetEmail } });
        if (!alive) return;
        if (data?.emailVerifiedAt) {
          setMe((m) => ({ ...(m || ({} as any)), email: targetEmail, emailVerifiedAt: data.emailVerifiedAt }));
        }
      } catch {
        // not fatal (user may not exist if not logged in)
      } finally {
        if (alive) setStatusChecked(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [targetEmail, statusChecked]);

  // ---------- Cooldown tickers ----------
  useEffect(() => {
    if (emailCooldown <= 0) return;
    emailTimerRef.current = window.setTimeout(
      () => setEmailCooldown((s) => Math.max(0, s - 1)),
      1000,
    ) as unknown as number;
    return () => {
      if (emailTimerRef.current) window.clearTimeout(emailTimerRef.current);
      emailTimerRef.current = null;
    };
  }, [emailCooldown]);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    otpTimerRef.current = window.setTimeout(
      () => setOtpCooldown((s) => Math.max(0, s - 1)),
      1000,
    ) as unknown as number;
    return () => {
      if (otpTimerRef.current) window.clearTimeout(otpTimerRef.current);
      otpTimerRef.current = null;
    };
  }, [otpCooldown]);

  // ---------- Actions ----------
  const refreshStatus = async () => {
    setErr(null);
    setBanner(null);
    try {
      if (targetEmail) {
        const { data } = await api.get('/api/auth/email-status', { params: { email: targetEmail } });
        if (data?.emailVerifiedAt) {
          setMe((m) => ({ ...(m || ({} as any)), email: targetEmail, emailVerifiedAt: data.emailVerifiedAt }));
          setBanner('Your email is verified. You can continue.');
        } else {
          setBanner('Still waiting for confirmation. Check your inbox or resend below.');
        }
      }
      if (token) {
        const { data } = await api.get<MeResponse>('/api/profile/me', { headers: { Authorization: `Bearer ${token}` } });
        setMe(data);
        if (data?.emailVerifiedAt && !banner) setBanner('Your email is verified. You can continue.');
        // Optionally update the central store user snapshot if you keep one
        try {
          setAuthUser?.(data as any);
        } catch {}
      }
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed to refresh status');
    }
  };

  // Email resend (public)
  const resendPublic = async () => {
    if (!targetEmail || sendingEmail || emailCooldown > 0) return;
    setSendingEmail(true);
    setErr(null);
    setBanner(null);
    try {
      const { data } = await api.post<ResendResp>('/api/auth/resend-verification', { email: targetEmail });
      setEmailCooldown(Math.max(0, Number(data?.nextResendAfterSec ?? 60)));
      setBanner('Verification email sent. Please check your inbox.');
    } catch (e: any) {
      const retryAfter = e?.response?.data?.retryAfterSec;
      if (retryAfter) setEmailCooldown(retryAfter);
      setErr(e?.response?.data?.error || 'Could not resend verification email');
    } finally {
      setSendingEmail(false);
    }
  };

  // Email resend (authed)
  const resendAuthed = async () => {
    if (!token || sendingEmail || emailCooldown > 0) return;
    setSendingEmail(true);
    setErr(null);
    setBanner(null);
    try {
      const { data } = await api.post<ResendResp>(
        '/api/auth/resend-email',
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setEmailCooldown(Math.max(0, Number(data?.nextResendAfterSec ?? 60)));
      setBanner('Verification email sent. Please check your inbox.');
    } catch (e: any) {
      const retryAfter = e?.response?.data?.retryAfterSec;
      if (retryAfter) setEmailCooldown(retryAfter);
      setErr(e?.response?.data?.error || 'Could not resend verification email');
    } finally {
      setSendingEmail(false);
    }
  };

  // OTP: verify
  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setOtpErr(null);
    setOtpMsg(null);
    if (!token) {
      setOtpErr('Please sign in first.');
      return;
    }
    if (!otp.trim()) {
      setOtpErr('Enter the code we sent to your phone.');
      return;
    }
    try {
      setVerifyingOtp(true);
      const { data } = await api.post(
        '/api/auth/verify-otp',
        { otp: otp.trim() },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      // Success UI
      setOtp('');
      setOtpMsg('Phone verified!');
      setOtpErr(null);

      // Replace local/me flags
      await refreshStatus();
    } catch (e: any) {
      setOtpErr(e?.response?.data?.error || 'Could not verify the code');
      setOtpMsg(null);
    } finally {
      setVerifyingOtp(false);
    }
  };

  // OTP: resend (authed)
  const resendOtp = async () => {
    setOtpErr(null);
    setOtpMsg(null);
    if (!token) {
      setOtpErr('Please sign in first.');
      return;
    }
    if (otpCooldown > 0) return;
    try {
      const { data } = await api.post(
        '/api/auth/resend-otp',
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setOtpCooldown(Math.max(0, Number(data?.nextResendAfterSec ?? 60)));
      setOtpMsg('A new verification code was sent to your phone.');
    } catch (e: any) {
      const retry = e?.response?.data?.retryAfterSec;
      if (retry) setOtpCooldown(retry);
      setOtpErr(e?.response?.data?.error || 'Could not resend the code');
    }
  };

  const nextStepPath = '/dashboard';

  return (
    <div className="min-h-[80vh]">
      {/* Hero */}
      <div className="relative overflow-hidden border-b">
        <div className="bg-gradient-to-br from-primary-700 via-primary-600 to-indigo-700 text-white">
          <div className="max-w-5xl mx-auto px-4 md:px-8 py-8">
            <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-2xl md:text-3xl font-bold tracking-tight">
              {headerTitle}
            </motion.h1>
            <p className="mt-1 text-white/85 text-sm">
              We sent a confirmation link to your email. Please click it to continue.
            </p>
            {!me?.emailVerifiedAt && (
              <div className="mt-3">
                <StatChip tone="amber">
                  <Clock size={14} />
                  <span>Link expires soon</span>
                </StatChip>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 space-y-6">
        <Card>
          <CardHeader
            title="Verification status"
            subtitle={me?.emailVerifiedAt ? 'Your email is verified—nice!' : 'Awaiting verification'}
            icon={me?.emailVerifiedAt ? <MailCheck size={18} /> : <MailWarning size={18} />}
            right={
              <div className="hidden sm:flex items-center gap-2">
                <button
                  onClick={refreshStatus}
                  className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm hover:bg-black/5"
                >
                  <RefreshCcw size={16} /> Check status
                </button>
                {me?.emailVerifiedAt ? (
                  <Link
                    to={nextStepPath}
                    className="inline-flex items-center gap-2 rounded-xl bg-white/10 text-white px-3 py-2 text-sm hover:bg-white/20"
                  >
                    Continue <ChevronRight size={16} />
                  </Link>
                ) : null}
              </div>
            }
          />
          <div className="p-5">
            {loading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 w-2/3 bg-zinc-200 rounded" />
                <div className="h-3 w-1/2 bg-zinc-200 rounded" />
              </div>
            ) : (
              <>
                {banner && (
                  <div className="mb-3 text-sm text-emerald-700 border border-emerald-200 bg-emerald-50 px-3 py-2 rounded">
                    {banner}
                  </div>
                )}
                {err && (
                  <div className="mb-3 text-sm text-danger border border-danger/20 bg-red-50 px-3 py-2 rounded">
                    {err}
                  </div>
                )}

                {/* Email chip + status */}
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl border bg-surface">
                    <Mail size={16} className="text-primary-700" />
                    <span className="font-medium text-ink">{targetEmail || me?.email || '—'}</span>
                  </span>

                  {me?.emailVerifiedAt ? (
                    <StatChip tone="green">
                      <ShieldCheck size={14} />
                      Verified at {new Date(me.emailVerifiedAt).toLocaleString()}
                    </StatChip>
                  ) : (
                    <StatChip tone="zinc">
                      <Inbox size={14} />
                      Waiting for confirmation
                    </StatChip>
                  )}
                </div>

                {/* Email actions */}
                {!me?.emailVerifiedAt && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      onClick={resendPublic}
                      disabled={sendingEmail || emailCooldown > 0 || !targetEmail}
                      className="inline-flex items-center gap-2 rounded-xl bg-accent-500 text-white px-4 py-2 hover:bg-accent-600 disabled:opacity-50"
                    >
                      {sendingEmail ? (
                        <>
                          <RefreshCcw size={16} className="animate-spin" />
                          Sending…
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
                    </button>

                    {token && (
                      <button
                        onClick={resendAuthed}
                        disabled={sendingEmail || emailCooldown > 0}
                        className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 hover:bg-black/5"
                      >
                        <RefreshCcw size={16} />
                        Resend (logged in)
                      </button>
                    )}

                    <button
                      onClick={refreshStatus}
                      className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 hover:bg-black/5"
                    >
                      <RefreshCcw size={16} />
                      I’ve verified — Check again
                    </button>

                    <Link
                      to="/profile"
                      className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 hover:bg-black/5"
                      title="Change or correct your email address"
                    >
                      <UserCog size={16} />
                      Update email
                    </Link>
                  </div>
                )}

                {/* Phone OTP block (auth only, when not verified) */}
                {showOtpBlock && (
                  <div className="mt-6 rounded-xl border bg-white p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Smartphone size={18} className="text-primary-700" />
                      <div className="text-sm font-medium text-ink">Phone verification</div>
                      {me?.phoneVerifiedAt && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-emerald-700">
                          <CheckCircle2 size={14} /> Verified
                        </span>
                      )}
                    </div>

                    {otpMsg && (
                      <div className="mb-2 text-xs rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2">
                        {otpMsg}
                      </div>
                    )}
                    {otpErr && (
                      <div className="mb-2 text-xs rounded-md border border-rose-300/60 bg-rose-50/90 text-rose-700 px-3 py-2">
                        {otpErr}
                      </div>
                    )}

                    <form onSubmit={submitOtp} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <input
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                        inputMode="numeric"
                        pattern="\d*"
                        placeholder="Enter the 6-digit code"
                        className="flex-1 rounded-xl border border-slate-300/80 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                      />
                      <button
                        type="submit"
                        disabled={verifyingOtp || !otp.trim()}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 text-white px-4 py-2 hover:bg-primary-700 disabled:opacity-50"
                      >
                        {verifyingOtp ? 'Verifying…' : 'Verify code'}
                      </button>
                      <button
                        type="button"
                        onClick={resendOtp}
                        disabled={otpCooldown > 0}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-4 py-2 hover:bg-black/5 disabled:opacity-50"
                        title="Resend verification code"
                      >
                        <RefreshCcw size={16} className={otpCooldown > 0 ? 'opacity-70' : ''} />
                        {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : 'Resend code'}
                      </button>
                    </form>
                    <p className="mt-1 text-[11px] text-ink-soft">
                      Codes expire quickly. If it doesn’t arrive, try resending after the cooldown.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>

        {/* Help / links while email is unverified */}
        {!me?.emailVerifiedAt && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader title="Open your inbox" subtitle="Jump straight to your provider" icon={<Mail size={18} />} />
              <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { name: 'Gmail', href: 'https://mail.google.com/', color: 'text-rose-600' },
                  { name: 'Outlook', href: 'https://outlook.live.com/mail/', color: 'text-sky-700' },
                  { name: 'Yahoo Mail', href: 'https://mail.yahoo.com/', color: 'text-violet-700' },
                ].map((x) => (
                  <a
                    key={x.name}
                    href={x.href}
                    target="_blank"
                    rel="noreferrer"
                    className="group rounded-xl border bg-white px-4 py-3 flex items-center justify-between hover:bg-black/5"
                  >
                    <span className={`font-medium ${x.color}`}>{x.name}</span>
                    <ExternalLink size={16} className="text-zinc-500 group-hover:translate-x-0.5 transition" />
                  </a>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="Troubleshooting tips" subtitle="Didn’t get the email?" icon={<MailWarning size={18} />} />
              <div className="p-5 text-sm text-ink">
                <ul className="list-disc pl-5 space-y-2">
                  <li>
                    Check your <b>Spam</b> or <b>Promotions</b> folder.
                  </li>
                  <li>Wait a minute — some providers can be a bit slow.</li>
                  <li>
                    Add <code className="px-1 rounded bg-zinc-100">no-reply@dayspring.com</code> to your contacts.
                  </li>
                  <li>
                    Use the <b>Resend email</b> button above (cooldown applies).
                  </li>
                  <li>
                    Still stuck? <Link to="/contact" className="text-primary-700 underline">Contact support</Link>.
                  </li>
                </ul>
              </div>
            </Card>
          </div>
        )}

        {/* Footer CTA when fully verified */}
        {me?.emailVerifiedAt && (
          <div className="flex flex-wrap items-center gap-3">
            <Link to={nextStepPath} className="inline-flex items-center gap-2 rounded-xl bg-primary-600 text-white px-4 py-2 hover:bg-primary-700">
              Continue <ChevronRight size={16} />
            </Link>
            <Link to="/" className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 hover:bg-black/5">
              Back to home
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
