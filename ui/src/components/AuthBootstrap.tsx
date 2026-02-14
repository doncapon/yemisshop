// src/components/AuthBootstrap.tsx
import { useEffect } from "react";
import api from "../api/client";
import { useAuthStore } from "../store/auth";

function normalizeMe(raw: any) {
  if (!raw) return null;

  if ((import.meta as any)?.env?.PHONE_VERIFY === "set") {
    raw.phoneVerified =
      raw.phoneVerified === true || !!raw.phoneVerifiedAt || raw.phoneVerifiedAt === 1;
  } else {
    raw.phoneVerified = true;
  }

  return {
    id: String(raw.id ?? ""),
    email: String(raw.email ?? ""),
    role: String(raw.role ?? "SHOPPER") as any,
    firstName: raw.firstName ?? null,
    lastName: raw.lastName ?? null,

    emailVerified:
      raw.emailVerified === true || !!raw.emailVerifiedAt || raw.emailVerifiedAt === 1,
    phoneVerified: raw.phoneVerified,
  };
}

/**
 * Cookie-based bootstrap:
 * - Once the store is hydrated, if user is missing, call /api/auth/me using cookies
 *   (withCredentials) to hydrate the session user.
 * - If /me returns 401/403 (or null user), clear auth and move on as anonymous.
 *
 * ✅ No token usage
 * ✅ No setAuth usage
 */
export default function AuthBootstrap() {
  const hydrated = useAuthStore((s) => (s as any).hydrated);
  const user = useAuthStore((s) => (s as any).user);

  const clear = useAuthStore((s) => (s as any).clear);

  // optional flag you mentioned (safe if missing)
  const setBootstrapped = useAuthStore((s: any) => s.setBootstrapped);

  useEffect(() => {
    if (!hydrated) return;

    // Already have user → done
    if (user?.id) {
      setBootstrapped?.(true);
      return;
    }

    let cancelled = false;

    api
      .get("/api/auth/me", { withCredentials: true })
      .then((r) => {
        if (cancelled) return;

        const u = normalizeMe(r.data);

        if (u?.id) {
          // ✅ Hydrate store directly (cookie session => no token needed)
          try {
            (useAuthStore as any).setState?.((prev: any) => ({
              ...prev,
              user: u,
              token: null, // harmless even if your store ignores it
            }));
          } catch {
            // if setState isn't exposed for some reason, fail-safe clear
            clear?.();
          }
        } else {
          clear?.();
        }
      })
      .catch(() => {
        if (!cancelled) clear?.();
      })
      .finally(() => {
        if (!cancelled) setBootstrapped?.(true);
      });

    return () => {
      cancelled = true;
    };
  }, [hydrated, user, clear, setBootstrapped]);

  return null;
}
