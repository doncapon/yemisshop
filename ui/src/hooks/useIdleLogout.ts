// src/hooks/useIdleLogout.ts
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { performLogout } from "../utils/logout";
import { useAuthStore } from "../store/auth";

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

  const loc = useLocation();

  const timerRef = useRef<number | null>(null);
  const kickingRef = useRef(false);
  const [shouldKick, setShouldKick] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!user?.id) return;

    const reset = () => {
      if (kickingRef.current) return;
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

  useEffect(() => {
    if (!shouldKick) return;
    if (!hydrated) return;
    if (kickingRef.current) return;

    kickingRef.current = true;

    const path = `${loc.pathname}${loc.search}`;

    if (isProtectedPath(loc.pathname)) {
      try {
        sessionStorage.setItem(RETURN_TO_KEY, path);
      } catch {
        //
      }
    }

    const target = isProtectedPath(loc.pathname)
      ? `/login?reason=idle&from=${encodeURIComponent(path)}`
      : "/login?reason=idle";

    void performLogout(target);
  }, [shouldKick, hydrated, loc.pathname, loc.search]);
}