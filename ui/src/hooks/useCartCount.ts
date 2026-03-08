// src/hooks/useCartCount.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthStore } from "../store/auth";
import api from "../api/client";

/* =========================================================
   Cart storage v2 keys (must match Cart.tsx)
========================================================= */
const GUEST_CART_KEY = "cart:guest:v2";
const USER_CART_KEY_PREFIX = "cart:user:";
const CART_KEY_SUFFIX = ":v2";

function userCartKey(userId: string) {
  return `${USER_CART_KEY_PREFIX}${userId}${CART_KEY_SUFFIX}`;
}

type CartStorageV2 = {
  v: 2;
  items: any[];
  updatedAt: number;
  expiresAt: number;
};

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadRawArrayFromKey(key: string): any[] {
  const v2 = safeParse<CartStorageV2>(localStorage.getItem(key));
  if (v2?.v === 2 && Array.isArray(v2.items)) return v2.items;

  // legacy fallback: only for guest key
  if (key === GUEST_CART_KEY) {
    const legacy = safeParse<any[]>(localStorage.getItem("cart"));
    if (Array.isArray(legacy)) return legacy;
  }

  return [];
}

// ✅ tolerate qty OR quantity
function readQty(line: any) {
  const q = line?.qty ?? line?.quantity ?? 0;
  return Math.max(0, Math.floor(Number(q) || 0));
}

function computeCounts(lines: any[]) {
  let totalQty = 0;
  let distinct = 0;

  for (const l of lines || []) {
    const q = readQty(l);
    if (q > 0) {
      distinct += 1;
      totalQty += q;
    }
  }
  return { distinct, totalQty };
}

type ServerSummary = { distinct: number; totalQty: number };

/**
 * ✅ Cart count logic:
 * - Guest: localStorage guest cart
 * - Logged-in:
 *    - Try server summary if available
 *    - If endpoint missing / errors => FALL BACK to localStorage user cart
 *
 * This version prevents "Maximum update depth exceeded" by:
 * - NOT tying server fetches to a state "tick" dependency loop
 * - Refetching server summary only on userId change + cart events
 * - Rate limiting + in-flight guard
 */
export function useCartCount() {
  const userIdRaw = useAuthStore((s) => s.user?.id ?? null);
  const userId = userIdRaw == null ? null : String(userIdRaw);

  // Local-only tick (drives localStorage recount)
  const [localTick, setLocalTick] = useState(0);

  // Server summary state (drives badge when logged in)
  const [server, setServer] = useState<ServerSummary | null>(null);

  const userIdRef = useRef<string | null>(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  // ---- Server fetch controls (prevents storms/loops) ----
  const inFlightRef = useRef(false);
  const lastFetchAtRef = useRef(0);
  const RATE_LIMIT_MS = 600;

  const refreshServerSummary = useCallback(async () => {
    const uid = userIdRef.current;

    // not logged in
    if (!uid) {
      setServer(null);
      return;
    }

    // rate-limit to avoid rapid re-triggers
    const now = Date.now();
    if (now - lastFetchAtRef.current < RATE_LIMIT_MS) return;
    lastFetchAtRef.current = now;

    // in-flight guard
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const res = await api.get("/api/cart/summary", { withCredentials: true });
      const root = (res as any)?.data?.data ?? (res as any)?.data ?? {};

      const next: ServerSummary = {
        distinct: Math.max(0, Number(root.distinct ?? 0) || 0),
        totalQty: Math.max(0, Number(root.totalQty ?? 0) || 0),
      };

      // ✅ only update state if changed (prevents pointless re-renders)
      setServer((prev) => {
        if (!prev) return next;
        if (prev.distinct === next.distinct && prev.totalQty === next.totalQty) return prev;
        return next;
      });
    } catch (_e) {
      // endpoint missing/errored => fallback to local user cart
      setServer(null);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  // bump local tick (recount localStorage)
  const bumpLocal = useCallback(() => {
    setLocalTick((t) => t + 1);
  }, []);

  // On login/logout: reset + refresh server once
  useEffect(() => {
    // reset server summary on user switch
    setServer(null);

    // recount local cart immediately too (guest->user key changes)
    bumpLocal();

    // fetch server summary once after auth switch
    void refreshServerSummary();
  }, [userId, bumpLocal, refreshServerSummary]);

  // Listen to cart updates + storage changes
  useEffect(() => {
    const onCartUpdated = () => {
      bumpLocal();
      // also refresh server summary (if logged in)
      void refreshServerSummary();
    };

    const onStorage = (e: StorageEvent) => {
      const k = e.key || "";
      if (k === "cart" || k === GUEST_CART_KEY || k.startsWith(USER_CART_KEY_PREFIX)) {
        bumpLocal();
        void refreshServerSummary();
      }
    };

    // NOTE: focus-based bumping can be too aggressive in some apps.
    // Keep it, but only recount local; server refresh is rate-limited anyway.
    const onFocus = () => {
      bumpLocal();
      void refreshServerSummary();
    };

    window.addEventListener("cart:updated", onCartUpdated as EventListener);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("cart:updated", onCartUpdated as EventListener);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [bumpLocal, refreshServerSummary]);

  // Return counts
  return useMemo(() => {
    // guest
    if (!userId) {
      const items = loadRawArrayFromKey(GUEST_CART_KEY);
      return computeCounts(items);
    }

    // logged-in: prefer server if it has anything non-zero
    if (server && (server.totalQty > 0 || server.distinct > 0)) return server;

    // fallback: local user cart
    const items = loadRawArrayFromKey(userCartKey(userId));
    // depend on localTick so badge updates instantly on cart:updated
    void localTick; // explicit usage for clarity
    return computeCounts(items);
  }, [userId, server, localTick]);
}