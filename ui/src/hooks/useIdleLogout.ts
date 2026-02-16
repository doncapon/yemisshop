// src/utils/useIdleLogout.ts
import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuthStore, type Role } from "../store/auth";

type Options = {
  shopperIdleMs?: number; // default 45 min
  privilegedIdleMs?: number; // default 15 min
  throttleMs?: number; // default 2000ms
};

const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function isAuthError(e: any) {
  const status = e?.response?.status;
  return status === 401 || status === 403;
}

export function useIdleLogout(opts?: Options) {
  // ✅ Cookie-mode: no token; role comes from store (if present)
  const role = useAuthStore((s) => s.user?.role);
  const clear = useAuthStore((s) => s.clear);

  const nav = useNavigate();

  const shopperIdleMs = opts?.shopperIdleMs ?? 45 * 60 * 1000;
  const privilegedIdleMs = opts?.privilegedIdleMs ?? 15 * 60 * 1000;
  const throttleMs = opts?.throttleMs ?? 2000;

  const idleMs = useMemo(() => {
    const r = String(role || "").toUpperCase() as Role;
    const privileged = r === "ADMIN" || r === "SUPER_ADMIN" || r === "SUPPLIER";
    return privileged ? privilegedIdleMs : shopperIdleMs;
  }, [role, privilegedIdleMs, shopperIdleMs]);

  const timeoutRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const lastResetRef = useRef<number>(0);
  const loggingOutRef = useRef<boolean>(false);

  // ✅ Track cookie auth state locally
  const authedRef = useRef<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    const clearTimer = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      loggingOutRef.current = false;
    };

    const serverLogoutAndRedirect = async () => {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;

      try {
        await api.post("/api/auth/logout", {}, AXIOS_COOKIE_CFG);
      } catch {
        // ignore
      }

      clear();
      try {
        localStorage.removeItem("cart");
        localStorage.removeItem("auth");
      } catch {
        //
      }

      nav("/login?reason=idle", { replace: true });
    };

    const schedule = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      // @ts-ignore
      timeoutRef.current = setTimeout(async () => {
        if (!authedRef.current) return; // safety
        await serverLogoutAndRedirect();
      }, idleMs) as any;
    };

    const markActivity = () => {
      if (!authedRef.current) return;

      const now = Date.now();
      // Throttle resets (mousemove can be noisy)
      if (now - lastResetRef.current < throttleMs) return;

      lastResetRef.current = now;
      lastActivityRef.current = now;

      if (!loggingOutRef.current) schedule();
    };

    const onVisibility = () => {
      if (!authedRef.current) return;

      if (document.visibilityState === "visible") {
        const now = Date.now();
        const idleFor = now - lastActivityRef.current;

        if (idleFor >= idleMs && !loggingOutRef.current) {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          serverLogoutAndRedirect();
        } else {
          markActivity();
        }
      }
    };

    const attachListeners = () => {
      const events: Array<keyof WindowEventMap> = [
        "mousedown",
        "mousemove",
        "keydown",
        "scroll",
        "touchstart",
        "wheel",
      ];

      for (const e of events) window.addEventListener(e, markActivity, { passive: true });
      document.addEventListener("visibilitychange", onVisibility);

      return () => {
        for (const e of events) window.removeEventListener(e, markActivity as any);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    };

    // ✅ Cookie auth check: only run idle logic when session exists
    (async () => {
      try {
        await api.get("/api/profile/me", AXIOS_COOKIE_CFG);
        if (cancelled) return;

        authedRef.current = true;

        // Initial schedule
        lastActivityRef.current = Date.now();
        lastResetRef.current = 0;
        loggingOutRef.current = false;

        schedule();
        const detach = attachListeners();

        // cleanup when effect re-runs/unmounts
        const prevCleanup = cleanupRef.current;
        cleanupRef.current = () => {
          prevCleanup?.();
          detach();
          clearTimer();
          authedRef.current = false;
        };
      } catch (e: any) {
        // Not authenticated (or server down) -> disable idle logic
        if (cancelled) return;

        authedRef.current = false;
        clearTimer();

        // If backend explicitly says unauth, clear client state too
        if (isAuthError(e)) {
          clear();
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idleMs, throttleMs, clear, nav]);

  // store cleanup between async attach
  const cleanupRef = useRef<null | (() => void)>(null);
}
