// src/pages/Login.tsx
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

export default function Login() {
  const [email, setEmail] = useState('shopper@example.com');
  const [password, setPassword] = useState('Shopper123!');
  const [err, setErr] = useState<string | null>(null);

  const nav = useNavigate();
  const loc = useLocation() as any;
  const setAuth = useAuthStore((s) => s.setAuth);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const res = await api.post('/api/auth/login', { email, password });
      const { token } = res.data as { token: string };

      // TODO: replace heuristic with real role from /api/auth/me if available
      const role =
        email.startsWith('admin')
          ? 'ADMIN'
          : email.startsWith('supplier')
          ? 'SUPPLIER'
          : 'SHOPPER';

      setAuth(token, role as any, email);
      const to = loc.state?.from?.pathname || '/';
      nav(to);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Login failed');
    }
  };

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
