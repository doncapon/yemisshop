// src/hooks/useIdleLogout.ts
import { useEffect, useRef, useState } from "react";
import { markJustLoggedOut } from "../utils/logout";
import api from "../api/client";
import { useAuthStore } from "../store/auth";

export function useIdleLogout(timeoutMs = 20 * 60 * 1000) {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);

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

    // Mark logged out so bootstrap doesn't re-trigger session-expired on reload.
    markJustLoggedOut();

    // Show the session-expired modal (keeps user on current page).
    useAuthStore.getState().markSessionExpired();

    // Invalidate the server session in the background — no redirect needed.
    api.post("/api/auth/logout", {}, { withCredentials: true }).catch(() => {});
  }, [shouldKick, hydrated]);
}
