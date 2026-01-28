// src/utils/useIdleLogout.ts
import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuthStore, type Role } from "../store/auth";

type Options = {
  shopperIdleMs?: number;      // default 45 min
  privilegedIdleMs?: number;   // default 15 min
  throttleMs?: number;         // default 2000ms
};

export function useIdleLogout(opts?: Options) {
  const token = useAuthStore((s) => s.token);
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

  useEffect(() => {
    // Only run idle logic when authenticated
    if (!token) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      loggingOutRef.current = false;
      return;
    }

    const schedule = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      // @ts-ignore
      timeoutRef.current = setTimeout(async () => {
        if (loggingOutRef.current) return;
        loggingOutRef.current = true;

        // Best practice: revoke server session too (DB-backed sessions)
        try {
          await api.post("/api/auth/logout");
        } catch {
          // ignore (network/server down shouldn't block logout)
        }

        clear();
        try {
          // optional hard cleanup
          localStorage.removeItem("cart");
          localStorage.removeItem("auth");
        } catch {
          //
        }

        nav("/login?reason=idle", { replace: true });
      }, idleMs) as any;
    };

    const markActivity = () => {
      const now = Date.now();

      // Throttle resets (mousemove can be very noisy)
      if (now - lastResetRef.current < throttleMs) return;

      lastResetRef.current = now;
      lastActivityRef.current = now;

      if (!loggingOutRef.current) schedule();
    };

    const onVisibility = () => {
      // When returning to tab, check if user was idle too long.
      if (document.visibilityState === "visible") {
        const now = Date.now();
        const idleFor = now - lastActivityRef.current;
        if (idleFor >= idleMs && !loggingOutRef.current) {
          // trigger the timeout immediately
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          // @ts-ignore
          timeoutRef.current = setTimeout(() => markActivity(), 0) as any;
          // markActivity schedules, but we want immediate logout:
          // easiest is to call the scheduled function directly by simulating timeout:
          // So just force schedule to 0:
          // (we’ll do it cleanly)
          (async () => {
            if (loggingOutRef.current) return;
            loggingOutRef.current = true;
            try {
              await api.post("/api/auth/logout");
            } catch {}
            clear();
            nav("/login?reason=idle", { replace: true });
          })();
        } else {
          markActivity();
        }
      }
    };

    // Initial schedule
    lastActivityRef.current = Date.now();
    lastResetRef.current = 0;
    loggingOutRef.current = false;
    schedule();

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
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;

      for (const e of events) window.removeEventListener(e, markActivity as any);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token, idleMs, throttleMs, clear, nav]);
}
