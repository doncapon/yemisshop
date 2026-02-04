// src/components/AuthBootstrap.tsx
import { useEffect } from "react";
import api from "../api/client";
import { useAuthStore } from "../store/auth";

function normalizeMe(raw: any) {
  if (!raw) return null;

  return {
    id: String(raw.id ?? ""),
    email: String(raw.email ?? ""),
    role: String(raw.role ?? "SHOPPER") as any,
    firstName: raw.firstName ?? null,
    lastName: raw.lastName ?? null,
    emailVerified: raw.emailVerified === true || !!raw.emailVerifiedAt,
    phoneVerified: raw.phoneVerified === true || !!raw.phoneVerifiedAt,
  };
}

export default function AuthBootstrap() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const setCookieSession = useAuthStore((s) => s.setCookieSession);
  const setBootstrapped = useAuthStore((s: any) => s.setBootstrapped); // add this in store (below)

  useEffect(() => {
    if (!hydrated) return;

    // Already have user → done
    if (user) {
      setBootstrapped?.(true);
      return;
    }

    // If we have a JWT bearer token, don’t bootstrap via cookie
    const looksJwt = !!token && token.split(".").length === 3;
    if (looksJwt) {
      setBootstrapped?.(true);
      return;
    }

    let cancelled = false;

    api
      .get("/api/auth/me")
      .then((r) => {
        if (cancelled) return;
        const u = normalizeMe(r.data);
        if (u?.id) setCookieSession(u);
      })
      .finally(() => {
        if (cancelled) return;
        setBootstrapped?.(true);
      });

    return () => {
      cancelled = true;
    };
  }, [hydrated, token, user, setCookieSession, setBootstrapped]);

  return null;
}
