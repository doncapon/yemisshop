// src/pages/ForgotPassword.tsx
import { useState } from 'react';
import api from '../api/client';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null); setErr(null);
    if (!email.trim()) return setErr('Enter your email');

    try {
      setLoading(true);
      await api.post('/api/auth/forgot-password', { email: email.trim().toLowerCase() });
      setMsg('If this email exists, we sent a reset link. Please check your inbox (and spam).');
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Could not send reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-6 border rounded space-y-4">
      <h1 className="text-xl font-semibold">Forgot your password?</h1>
      {msg && <div className="p-2 rounded bg-green-50 text-green-700">{msg}</div>}
      {err && <div className="p-2 rounded bg-red-50 text-red-700">{err}</div>}
      <form onSubmit={submit} className="space-y-3">
        <input
          type="email"
          placeholder="you@example.com"
          className="border p-2 w-full rounded"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button disabled={loading} className="border px-4 py-2 rounded disabled:opacity-50">
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </div>
  );
}
