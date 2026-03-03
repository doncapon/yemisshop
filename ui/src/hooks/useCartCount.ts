// src/hooks/useCartCount.ts
import { useEffect, useMemo, useRef, useState } from "react";
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

// ✅ tolerate qty OR quantity (because different parts of app often differ)
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
 */
export function useCartCount() {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const [tick, setTick] = useState(0);
  const [server, setServer] = useState<ServerSummary | null>(null);

  const prevUserIdRef = useRef<string | null>(userId);

  // bump tick on user switch (login/logout)
  useEffect(() => {
    const prev = prevUserIdRef.current;
    const next = userId;

    if (prev !== next) setTick((t) => t + 1);
    prevUserIdRef.current = next;
  }, [userId]);

  // listen to cart updates
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);

    const onStorage = (e: StorageEvent) => {
      const k = e.key || "";
      if (k === "cart" || k === GUEST_CART_KEY || k.startsWith(USER_CART_KEY_PREFIX)) bump();
    };

    window.addEventListener("cart:updated", bump as EventListener);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", bump);

    return () => {
      window.removeEventListener("cart:updated", bump as EventListener);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", bump);
    };
  }, []);

  // ✅ try server summary IF logged in (but do not break badge if endpoint doesn't exist)
  useEffect(() => {
    let alive = true;

    async function refreshServer() {
      if (!userId) {
        if (alive) setServer(null);
        return;
      }

      try {
        const res = await api.get("/api/cart/summary", { withCredentials: true });
        const root = (res as any)?.data?.data ?? (res as any)?.data ?? {};
        const next = {
          distinct: Math.max(0, Number(root.distinct ?? 0) || 0),
          totalQty: Math.max(0, Number(root.totalQty ?? 0) || 0),
        };
        if (alive) setServer(next);
      } catch (e: any) {
        // ✅ if endpoint missing (404) or not implemented, fallback to local cart
        if (alive) setServer(null);
      }
    }

    refreshServer();
    return () => {
      alive = false;
    };
  }, [userId, tick]);

  return useMemo(() => {
    // guest
    if (!userId) {
      const items = loadRawArrayFromKey(GUEST_CART_KEY);
      return computeCounts(items);
    }

    // logged-in:
    // if server summary exists and is non-zero, trust it
    if (server && (server.totalQty > 0 || server.distinct > 0)) return server;

    // otherwise fallback to local user cart (this matches your Cart.tsx today)
    const items = loadRawArrayFromKey(userCartKey(String(userId)));
    return computeCounts(items);
  }, [userId, tick, server?.distinct, server?.totalQty]);
}