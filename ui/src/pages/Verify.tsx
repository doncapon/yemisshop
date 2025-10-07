import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';

type ResendResp = {
  ok: boolean;
  nextResendAfterSec: number;
  expiresInSec: number;
};

type MeResponse = {
  id: string;
  email: string;
  role: 'ADMIN' | 'SUPPLIER' | 'SHOPPER';
  status: 'PENDING' | 'PARTIAL' | 'VERIFIED';
  emailVerified: boolean;
  phoneVerified: boolean;
};

function useCountdown(initial: number) {
  const [secs, setSecs] = useState(initial);
  useEffect(() => {
    if (secs <= 0) return;
    const id = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secs]);
  return { secs, start: (n: number) => setSecs(n) };
}

export default function Verify() {
  const loc = useLocation();
  const nav = useNavigate();

  // Query params
  const qs = new URLSearchParams(loc.search);
  const emailJustVerified = qs.has('email');
  const emailFromQuery = qs.get('e') ?? '';

  // Token persisted after register/login when not verified
  const bearer = useMemo(() => localStorage.getItem('verifyToken') || '', []);

  // UI state
  const [email, setEmail] = useState(emailFromQuery);
  const [otp, setOtp] = useState('');
  const [msg, setMsg] = useState<string | null>(
    emailJustVerified ? 'Email verified. Now verify your phone.' : null
  );
  const [err, setErr] = useState<string | null>(null);

  // Verification flags
  const [isEmailVerified, setIsEmailVerified] = useState<boolean>(emailJustVerified); // assume true if redirected with ?email
  const [isPhoneVerified, setIsPhoneVerified] = useState<boolean>(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Cooldowns
  const emailCd = useCountdown(0);
  const otpCd = useCountdown(0);

  // Prefill from /api/auth/me if we have a bearer token
  useEffect(() => {
    let cancelled = false;
    async function fetchProfile() {
      if (!bearer) {
        setProfileLoaded(true);
        return;
      }
      try {
        const { data } = await api.get<MeResponse>('/api/auth/me', {
          headers: { Authorization: `Bearer ${bearer}` },
        });

        if (cancelled) return;
        setEmail((prev) => (prev || data.email));
        setIsEmailVerified(emailJustVerified ? true : data.emailVerified);
        setIsPhoneVerified(data.phoneVerified);
      } catch (e: any) {
        // If token is invalid/expired, just continue without it
      } finally {
        if (!cancelled) setProfileLoaded(true);
      }
    }
    fetchProfile();
    return () => { cancelled = true; };
  }, [bearer, emailJustVerified]);

  const authHeader = bearer ? { Authorization: `Bearer ${bearer}` } : undefined;

  const verifyPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      const res = await api.post('/api/auth/verify-phone', { email, otp });
      setMsg(res.data?.message || 'Phone verified');
      setIsPhoneVerified(true);

      // If both verified now, redirect shortly
      setTimeout(() => nav('/login'), 1200);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed to verify phone');
    }
  };

  const resendEmail = async () => {
    setErr(null);
    setMsg(null);
    try {
      const res = await api.post<ResendResp>('/api/auth/resend-email', {}, { headers: authHeader });
      emailCd.start(res.data?.nextResendAfterSec ?? 60);
      const mins = Math.round((res.data?.expiresInSec ?? 3600) / 60);
      setMsg(`Verification email sent. Link expires in about ${mins} min.`);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed to resend email');
    }
  };

  const resendOtp = async () => {
    setErr(null);
    setMsg(null);
    try {
      const res = await api.post<ResendResp>('/api/auth/resend-otp', {}, { headers: authHeader });
      otpCd.start(res.data?.nextResendAfterSec ?? 60);
      const mins = Math.round((res.data?.expiresInSec ?? 600) / 60);
      setMsg(`OTP sent to your phone. Code expires in about ${mins} min.`);
    } catch (e: any) {
      const retry = e?.response?.data?.retryAfterSec;
      if (retry) otpCd.start(retry);
      setErr(e?.response?.data?.error || 'Failed to resend OTP');
    }
  };

  // Don’t flash incomplete UI while we’re loading profile flags
  if (!profileLoaded && bearer) {
    return <div className="max-w-lg mx-auto mt-10 p-6">Loading…</div>;
  }

  const bothDone = isEmailVerified && isPhoneVerified;

  return (
    <div className="max-w-lg mx-auto mt-10 p-6 border rounded space-y-5 bg-white">
      <h1 className="text-2xl font-semibold">Verify your account</h1>

      {msg && <div className="p-2 rounded bg-green-50 text-green-700">{msg}</div>}
      {err && <div className="p-2 rounded bg-red-50 text-red-700">{err}</div>}

      {/* EMAIL SECTION — shown only when NOT verified */}
      {!isEmailVerified && (
        <section className="space-y-2">
          <p className="text-sm opacity-80">
            We sent a verification link to your email. Please click that link.
          </p>
          <div className="flex items-center gap-3">
            <button
              className="border px-3 py-1 rounded disabled:opacity-50"
              onClick={resendEmail}
              disabled={!authHeader || emailCd.secs > 0}
              title={!authHeader ? 'Login or use the temp token from Register' : undefined}
            >
              {emailCd.secs > 0 ? `Resend email in ${emailCd.secs}s` : 'Resend email'}
            </button>
          </div>
        </section>
      )}

      {/* Divider only if both sections can be shown */}
      {!isEmailVerified && !isPhoneVerified && <hr />}

      {/* PHONE SECTION — shown only when NOT verified */}
      {!isPhoneVerified && (
        <section className="space-y-3">
          <p className="text-sm opacity-80">
            We also sent an OTP to your phone (if provided). Enter it below to verify your phone.
          </p>

          <form onSubmit={verifyPhone} className="space-y-3">
            <input
              placeholder="Your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border p-2 w-full rounded"
            />
            <input
              placeholder="6-digit OTP"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className="border p-2 w-full rounded"
            />
            <div className="flex items-center gap-3">
              <button type="submit" className="border px-4 py-2 rounded">
                Verify Phone
              </button>
              <button
                type="button"
                className="border px-3 py-1 rounded disabled:opacity-50"
                onClick={resendOtp}
                disabled={!authHeader || otpCd.secs > 0}
                title={!authHeader ? 'Login or use the temp token from Register' : undefined}
              >
                {otpCd.secs > 0 ? `Resend OTP in ${otpCd.secs}s` : 'Resend OTP'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* If both are verified already, nudge to login */}
      {bothDone && (
        <div className="text-sm">
          Your account is verified. <button className="underline" onClick={() => nav('/login')}>Go to login</button>
        </div>
      )}

      <p className="text-xs opacity-70">
        Tip: Check spam/promotions if you don’t see our email. OTP delivery can be delayed by mobile networks.
      </p>
    </div>
  );
}
