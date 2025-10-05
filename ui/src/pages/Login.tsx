// src/pages/Login.tsx
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

type MeResponse = {
  id: string;
  email: string;
  role: 'ADMIN' | 'SUPPLIER' | 'SHOPPER';
  emailVerified: boolean;
  phoneVerified: boolean;
};

export default function Login() {
  const [email, setEmail] = useState('shopper@example.com');
  const [password, setPassword] = useState('Shopper123!');
  const [err, setErr] = useState<string | null>(null);

  // shown only when not-verified
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [cooldown, setCooldown] = useState(0); // seconds for OTP resend

  const nav = useNavigate();
  const loc = useLocation() as any;
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setPendingToken(null);
    setMe(null);

    try {
      // 1) Login to get a token
      const res = await api.post('/api/auth/login', { email, password });
      const { token } = res.data as { token: string };

      // 2) Ask backend who I am / verification flags
      const meRes = await api.get<MeResponse>('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const profile = meRes.data;

      // 3) If fully verified, persist auth + go on
      if (profile.emailVerified && profile.phoneVerified) {
        setAuth(token, profile.role, profile.email);
        const to = loc.state?.from?.pathname || '/';
        nav(to);
        return;
      }

      // 4) Otherwise, show verification UI with resend actions
      setPendingToken(token);
      setMe(profile);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Login failed');
    }
  };

  const resendEmail = async () => {
    if (!pendingToken) return;
    try {
      await api.post(
        '/api/auth/resend-email',
        {},
        { headers: { Authorization: `Bearer ${pendingToken}` } },
      );
      setErr('Verification email sent.');
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed to resend email');
    }
  };

  const resendOtp = async () => {
    if (!pendingToken) return;
    try {
      const { data } = await api.post(
        '/api/auth/resend-otp',
        {},
        { headers: { Authorization: `Bearer ${pendingToken}` } },
      );
      setErr('OTP sent to your phone.');
      setCooldown(data?.nextResendAfterSec ?? 60);
    } catch (e: any) {
      const retryAfter = e?.response?.data?.retryAfterSec;
      if (retryAfter) setCooldown(retryAfter);
      setErr(e?.response?.data?.error || 'Failed to resend OTP');
    }
  };

  // UI: If not verified, render the verification panel instead of the login form
  if (pendingToken && me && (!me.emailVerified || !me.phoneVerified)) {
    return (
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-xl font-semibold">Verify your account</h1>
        {err && <p className="text-sm p-2 border rounded">{err}</p>}

        {!me.emailVerified && (
          <div className="space-y-2">
            <p>
              We sent a verification link to <b>{me.email}</b>. Please click that link.
            </p>
            <button className="underline" onClick={resendEmail}>
              Resend verification email
            </button>
          </div>
        )}

        {!me.phoneVerified && (
          <div className="space-y-2">
            <p>We also sent an OTP to your phone (if provided).</p>
            <button
              className="underline disabled:opacity-50"
              onClick={resendOtp}
              disabled={cooldown > 0}
              title={cooldown > 0 ? `Retry in ${cooldown}s` : 'Resend OTP'}
            >
              {cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
            </button>
          </div>
        )}

        <p className="text-sm opacity-70">
          Once both verifications are complete, please log in again.
        </p>
        <button className="border px-4 py-2" onClick={() => { setPendingToken(null); setMe(null); }}>
          Back to login
        </button>
      </div>
    );
  }

  // Default login form
  return (
    <form onSubmit={submit} className="max-w-sm space-y-3">
      <h1 className="text-xl font-semibold">Login</h1>
      {err && <p className="text-red-600">{err}</p>}
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        className="border p-2 w-full"
      />
      <input
        value={password}
        type="password"
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="border p-2 w-full"
      />
      <button type="submit" className="border px-4 py-2">
        Login
      </button>
    </form>
  );
}
