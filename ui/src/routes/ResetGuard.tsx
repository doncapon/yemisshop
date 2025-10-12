// src/routes/ResetGuard.tsx
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';

type Props = { children: ReactNode; validateWithApi?: boolean };

export default function ResetGuard({ children, validateWithApi = true }: Props) {
  const nav = useNavigate();
  const loc = useLocation();
  const token = new URLSearchParams(loc.search).get('token');

  const [ok, setOk] = useState(!validateWithApi); // if not validating, allow immediately
  const [checking, setChecking] = useState(validateWithApi);

  useEffect(() => {
    // No token at all → bounce
    if (!token) {
      nav('/forgot-password', { replace: true });
      return;
    }
    if (!validateWithApi) return;

    // Optional: ping API to verify token isn't expired/invalid
    (async () => {
      try {
        setChecking(true);
        const { data } = await api.get('/api/auth/reset-token/validate', { params: { token } });
        if (data?.ok) setOk(true);
        else nav('/forgot-password', { replace: true, state: { reason: 'invalid' } });
      } catch {
        nav('/forgot-password', { replace: true, state: { reason: 'error' } });
      } finally {
        setChecking(false);
      }
    })();
  }, [token, nav, validateWithApi]);

  if (checking) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-sm text-ink-soft">
        Checking your reset link…
      </div>
    );
  }

  return ok ? <>{children}</> : null;
}
