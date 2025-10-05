import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';

export default function Verify() {
  const loc = useLocation();
  const nav = useNavigate();

  const emailJustVerified = new URLSearchParams(loc.search).has('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [msg, setMsg] = useState<string | null>(
    emailJustVerified ? 'Email verified. Now verify your phone.' : null
  );
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    try {
      const res = await api.post('/api/auth/verify-phone', { email, otp });
      const message = res.data?.message || 'Phone verified';
      setMsg(message);

      // Redirect to login after a short success toast
      setTimeout(() => nav('/login'), 1500);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed to verify phone');
    }
  };

  return (
    <div className="max-w-md mx-auto mt-8 p-6 border rounded space-y-4">
      <h1 className="text-xl font-semibold">Verify your account</h1>

      {msg && <div className="p-2 rounded bg-green-50 text-green-700">{msg}</div>}
      {err && <div className="p-2 rounded bg-red-50 text-red-700">{err}</div>}

      <p className="text-sm opacity-80">
        We sent a verification link to your email. Please click that link.
      </p>
      <p className="text-sm opacity-80">
        We also sent an OTP to your phone (if provided). Enter it below to verify your phone.
      </p>

      <form onSubmit={submit} className="space-y-3">
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
        <button type="submit" className="border px-4 py-2 rounded">
          Verify Phone
        </button>
      </form>
    </div>
  );
}
