// src/pages/ResetPassword.tsx
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';

function validPassword(pwd: string) {
  const hasMinLen = pwd.length >= 8;
  const hasLetter = /[A-Za-z]/.test(pwd);
  const hasNumber = /\d/.test(pwd);
  const hasSpecial = /[^A-Za-z0-9]/.test(pwd);
  return hasMinLen && hasLetter && hasNumber && hasSpecial;
}

export default function ResetPassword() {
  const nav = useNavigate();
  const token = new URLSearchParams(useLocation().search).get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setMsg(null);

    if (!token) return setErr('Invalid or missing token');
    if (!validPassword(password)) {
      return setErr('Password must be 8+ chars and include a letter, a number, and a special character.');
    }
    if (password !== confirm) return setErr('Passwords do not match');

    try {
      setLoading(true);
      await api.post('/api/auth/reset-password', { token, password });
      setMsg('Password updated. You can now log in.');
      setTimeout(() => nav('/login'), 1200);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-6 border rounded space-y-4">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      {msg && <div className="p-2 rounded bg-green-50 text-green-700">{msg}</div>}
      {err && <div className="p-2 rounded bg-red-50 text-red-700">{err}</div>}

      <form onSubmit={submit} className="space-y-3">
        <input
          type="password"
          placeholder="New password"
          className="border p-2 w-full rounded"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          type="password"
          placeholder="Confirm new password"
          className="border p-2 w-full rounded"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button disabled={loading} className="border px-4 py-2 rounded disabled:opacity-50">
          {loading ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
