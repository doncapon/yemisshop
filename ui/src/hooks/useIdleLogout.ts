// src/hooks/useIdleLogout.ts
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuthStore } from "../store/auth";

const AXIOS_COOKIE_CFG = { withCredentials: true as const };
const RETURN_TO_KEY = "auth:returnTo";

function isProtectedPath(p: string) {
  return (
    p === "/checkout" ||
    p === "/orders" ||
    p === "/wishlist" ||
    p === "/profile" ||
    p === "/dashboard" ||
    p === "/customer-dashboard" ||
    p === "/account/sessions" ||
    p === "/admin" ||
    p.startsWith("/admin/") ||
    p === "/supplier" ||
    p.startsWith("/supplier/") ||
    p === "/rider" ||
    p.startsWith("/u/")
  );
}

export function useIdleLogout(timeoutMs = 20 * 60 * 1000) {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);

  const nav = useNavigate();
  const loc = useLocation();

  const timerRef = useRef<number | null>(null);
  const [shouldKick, setShouldKick] = useState(false);

  // Arm / re-arm the timer based on activity
  useEffect(() => {
    if (!hydrated) return;
    if (!user?.id) return;

    const reset = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setShouldKick(true), timeoutMs) as any;
    };

    reset();

    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      events.forEach((ev) => window.removeEventListener(ev, reset as any));
    };
  }, [hydrated, user?.id, timeoutMs]);

  // ✅ IMPORTANT: navigation happens ONLY here (effect), never during render
  useEffect(() => {
    if (!shouldKick) return;
    if (!hydrated) return;

    (async () => {
      try {
        await api.post("/api/auth/logout", {}, AXIOS_COOKIE_CFG);
      } catch {
        // ignore
      }

      clear();

      const path = `${loc.pathname}${loc.search}`;

      // only save "from" if it’s protected; else just go login
      if (isProtectedPath(loc.pathname)) {
        try {
          sessionStorage.setItem(RETURN_TO_KEY, path);
        } catch {}
        nav("/login", { replace: true, state: { from: path } });
      } else {
        nav("/login", { replace: true });
      }
    })();
  }, [shouldKick, hydrated, clear, nav, loc.pathname, loc.search]);
}
