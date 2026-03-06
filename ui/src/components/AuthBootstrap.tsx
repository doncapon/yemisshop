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
  const cancelled = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const run = async () => {
      try {
        const { data } = await api.get("/api/auth/me", AXIOS_COOKIE_CFG);

        if (cancelled.current) return;

        if (data?.id) {
          useAuthStore.setState({
            user: data,
            hydrated: true,
          } as any);
        } else {
          useAuthStore.setState({
            user: null,
            hydrated: true,
          } as any);
        }
      } catch (e: any) {
        if (cancelled.current) return;

        if (isAuthError(e)) {
          // normal case when logged out
          useAuthStore.setState({
            user: null,
            hydrated: true,
          } as any);
        } else {
          // network issue — don't destroy existing session
          useAuthStore.setState({
            hydrated: true,
          } as any);
        }
      }
    };

    run();

    return () => {
      cancelled.current = true;
    };
  }, []);

  return null;
}