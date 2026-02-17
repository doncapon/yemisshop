// src/components/AuthBootstrap.tsx
import { useEffect, useRef } from "react";
import api from "../api/client";
import { useAuthStore } from "../store/auth";

const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function isAuthError(e: any) {
  const s = e?.response?.status;
  return s === 401 || s === 403;
}

export default function AuthBootstrap() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const { data } = await api.get("/api/auth/me", AXIOS_COOKIE_CFG);

        if (data?.id) {
          useAuthStore.setState({ user: data, hydrated: true } as any);
        } else {
          useAuthStore.setState({ user: null, hydrated: true } as any);
        }
      } catch (e: any) {
        // ✅ only clear user on actual auth errors
        if (isAuthError(e)) {
          useAuthStore.setState({ user: null, hydrated: true } as any);
        } else {
          // ✅ network/proxy failure: don't destroy session; just mark hydrated
          // (otherwise you get kicked off checkout when API temporarily unreachable)
          useAuthStore.setState({ hydrated: true } as any);
        }
      }
    })();
  }, []);

  return null;
}
