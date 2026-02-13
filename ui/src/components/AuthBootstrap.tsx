// src/components/AuthBootstrap.tsx
import { useEffect } from "react";
import api from "../api/client";
import { useAuthStore } from "../store/auth";

function normalizeMe(raw: any) {
  if (!raw) return null;
  if ((import.meta as any)?.env?.PHONE_VERIFY === 'set') {
    raw.phoneVerified =
      raw.phoneVerified === true || !!raw.phoneVerifiedAt || raw.phoneVerifiedAt === 1;
  } else {
    raw.phoneVerified =true;
  }
  return {
    id: String(raw.id ?? ""),
    email: String(raw.email ?? ""),
    role: String(raw.role ?? "SHOPPER") as any,
    firstName: raw.firstName ?? null,
    lastName: raw.lastName ?? null,

    // backend may return either booleans or timestamps depending on route/version
    emailVerified:
      raw.emailVerified === true || !!raw.emailVerifiedAt || raw.emailVerifiedAt === 1,
    phoneVerified:
      raw.phoneVerified
  };
}

function looksLikeJwt(t: string | null) {
  return !!t && t.split(".").length === 3;
}

/**
 * Option A (token-based):
 * - If we have a JWT but `user` is missing (e.g. after refresh), call /api/auth/me
 *   to hydrate the user using Bearer auth.
 * - If no JWT, do nothing (anonymous).
 * - If /me returns 401, api client will resolve with data=null (per your interceptor),
 *   so we clear auth and move on.
 */
export default function AuthBootstrap() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const setAuth = useAuthStore((s) => s.setAuth);
  const clear = useAuthStore((s) => s.clear);

  // optional flag you mentioned
  const setBootstrapped = useAuthStore((s: any) => s.setBootstrapped);

  useEffect(() => {
    if (!hydrated) return;

    // Already have user → done
    if (user?.id) {
      setBootstrapped?.(true);
      return;
    }

    // No JWT → anonymous session, don't call /me
    if (!looksLikeJwt(token)) {
      setBootstrapped?.(true);
      return;
    }

    let cancelled = false;

    api
      .get("/api/auth/me")
      .then((r) => {
        if (cancelled) return;

        // With your interceptor: 401 => data=null (not throw)
        const u = normalizeMe(r.data);

        if (u?.id) {
          // keep same token, just hydrate user
          setAuth({ token: token as string, user: u });
        } else {
          // token invalid/expired (or /me says no) → clear
          clear();
        }
      })
      .catch(() => {
        // If anything unexpected throws, fail-safe clear
        if (!cancelled) clear();
      })
      .finally(() => {
        if (!cancelled) setBootstrapped?.(true);
      });

    return () => {
      cancelled = true;
    };
  }, [hydrated, token, user, setAuth, clear, setBootstrapped]);

  return null;
}
