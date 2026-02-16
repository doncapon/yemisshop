// src/components/PhoneOtpCard.tsx
import { useState } from 'react';
import api from '../api/client';
import { useAuthStore } from '../store/auth';
import { RefreshCcw, ShieldCheck, Smartphone, Clock } from 'lucide-react';

type Props = {
  email?: string;           // the user email to verify (required by /api/auth/verify-phone)
  onVerified?: () => void;  // callback when phone gets verified (to refresh parent state)
};

export default function PhoneOtpCard({ email, onVerified }: Props) {
  const isAuthed = useAuthStore((s) => !!s.user);
  const [otp, setOtp] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // resend throttling
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setErr(null);

    const code = otp.trim();
    if (!email) return setErr('We need your email to verify the code.');
    if (!code) return setErr('Enter the 6-digit code sent to your phone.');

    try {
      setLoading(true);
      // This endpoint in your API takes { email, otp } and is PUBLIC.
      await api.post(
        '/api/auth/verify-phone',
        { email: email.toLowerCase(), otp: code },
        { withCredentials: true }
      );
      setMsg('Phone verified!');
      setOtp('');
      onVerified?.();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Could not verify code');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (!isAuthed || resending || cooldown > 0) return;
    setResending(true);
    setErr(null);
    setMsg(null);
    try {
      // Auth-required resend endpoint (cookie session; uses req.user.id)
      const { data } = await api.post(
        '/api/auth/resend-otp',
        {},
        { withCredentials: true }
      );
      setCooldown(Math.max(0, Number(data?.nextResendAfterSec ?? 60)));
      setMsg('Code sent. Check your phone.');
    } catch (e: any) {
      const retry = e?.response?.data?.retryAfterSec;
      if (retry) setCooldown(retry);
      setErr(e?.response?.data?.error || 'Could not resend the code');
    } finally {
      setResending(false);
    }
  };

  // simple 1-second cooldown ticker
  if (cooldown > 0) {
    setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
  }

  return (
    <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
      <div className="px-4 md:px-5 py-3 border-b bg-gradient-to-b from-surface to-white flex items-center justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-[2px] text-primary-700"><Smartphone size={18} /></div>
          <div>
            <h3 className="text-ink font-semibold">Verify your phone</h3>
            <p className="text-xs text-ink-soft">
              Enter the 6-digit code we sent to your phone number.
            </p>
          </div>
        </div>
        {cooldown > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
            <Clock size={14} /> {cooldown}s
          </span>
        ) : null}
      </div>

      <form onSubmit={submit} className="p-5 space-y-3">
        {msg && (
          <div className="text-sm rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2">
            {msg}
          </div>
        )}
        {err && (
          <div className="text-sm rounded-md border border-danger/20 bg-red-50 text-danger px-3 py-2">
            {err}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            pattern="\d{6}"
            placeholder="••••••"
            className="flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-3 text-ink outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition"
          />
          <button
            type="submit"
            disabled={loading || !otp}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 text-white px-4 py-3 hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? (
              <>
                <ShieldCheck size={16} className="animate-pulse" />
                Verifying…
              </>
            ) : (
              <>
                <ShieldCheck size={16} />
                Verify code
              </>
            )}
          </button>
        </div>

        <div className="pt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={resend}
            disabled={!isAuthed || resending || cooldown > 0}
            className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-50"
            title={!isAuthed ? 'Login first to resend' : 'Resend code'}
          >
            <RefreshCcw size={16} className={resending ? 'animate-spin' : ''} />
            Resend code
          </button>
          {!isAuthed && <span className="text-xs text-ink-soft">Login to resend a new code.</span>}
        </div>
      </form>
    </div>
  );
}
