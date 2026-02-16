// src/routes/ResetGuard.tsx
import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/client";

type Props = { children: ReactNode; validateWithApi?: boolean };

export default function ResetGuard({ children, validateWithApi = true }: Props) {
  const nav = useNavigate();
  const loc = useLocation();
  const token = new URLSearchParams(loc.search).get("token");

  const [ok, setOk] = useState(!validateWithApi);
  const [checking, setChecking] = useState(validateWithApi);

  useEffect(() => {
    if (!validateWithApi) return;

    (async () => {
      try {
        setChecking(true);

        // 1) Cookie session present? (optional convenience)
        // If you don't want logged-in users to reset without email token, remove this block.
        try {
          const me = await api.get("/api/auth/me");
          if (me?.data?.id || me?.data?.user?.id) {
            setOk(true);
            return;
          }
        } catch {
          // not logged in -> continue to token validation
        }

        // 2) No session cookie -> require reset token in URL
        if (!token) {
          nav("/forgot-password", { replace: true });
          return;
        }

        // 3) Validate reset token with API (token still required for logged-out resets)
        const { data } = await api.get("/api/auth/reset-token/validate", { params: { token } });
        if (data?.ok) setOk(true);
        else nav("/forgot-password", { replace: true, state: { reason: "invalid" } });
      } catch {
        nav("/forgot-password", { replace: true, state: { reason: "error" } });
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
