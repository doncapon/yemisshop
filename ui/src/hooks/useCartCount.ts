// src/hooks/useCartCount.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthStore } from "../store/auth";
import api from "../api/client";
import { readCartLines } from "../utils/cartModel";

/* =========================================================
   Cart storage v2 keys (legacy fallback support)
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

type CartCountSummary = {
  distinct: number;
  totalQty: number;
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
  try {
    const v2 = safeParse<CartStorageV2>(localStorage.getItem(key));
    if (v2?.v === 2 && Array.isArray(v2.items)) return v2.items;

    // legacy fallback: only for guest key
    if (key === GUEST_CART_KEY) {
      const legacy = safeParse<any[]>(localStorage.getItem("cart"));
      if (Array.isArray(legacy)) return legacy;
    }
  } catch {
    // ignore
  }

  return [];
}

// tolerate qty OR quantity
function readQty(line: any) {
  const q = line?.qty ?? line?.quantity ?? 0;
  return Math.max(0, Math.floor(Number(q) || 0));
}

function computeCounts(lines: any[]): CartCountSummary {
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

function sameCounts(a: CartCountSummary | null | undefined, b: CartCountSummary | null | undefined) {
  return (a?.distinct ?? 0) === (b?.distinct ?? 0) && (a?.totalQty ?? 0) === (b?.totalQty ?? 0);
}

function zeroCounts(): CartCountSummary {
  return { distinct: 0, totalQty: 0 };
}

/**
 * Canonical local read:
 * Prefer cartModel.readCartLines() because it is the normalized cart source.
 * Fall back to legacy keyed storage only if needed.
 */
function getLocalCartCounts(userId: string | null): CartCountSummary {
  try {
    const normalized = readCartLines();
    if (Array.isArray(normalized)) {
      return computeCounts(normalized);
    }
  } catch {
    // ignore and fall back
  }

  if (!userId) {
    return computeCounts(loadRawArrayFromKey(GUEST_CART_KEY));
  }

  return computeCounts(loadRawArrayFromKey(userCartKey(userId)));
}

type ServerSummary = { distinct: number; totalQty: number };

export function useCartCount(): CartCountSummary {
  const userIdRaw = useAuthStore((s) => s.user?.id ?? null);
  const userId = userIdRaw == null ? null : String(userIdRaw);

  const [localCounts, setLocalCounts] = useState<CartCountSummary>(() => getLocalCartCounts(userId));
  const [server, setServer] = useState<ServerSummary | null>(null);

  const userIdRef = useRef<string | null>(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const inFlightRef = useRef(false);
  const lastFetchAtRef = useRef(0);
  const RATE_LIMIT_MS = 600;

  const syncLocalCounts = useCallback(() => {
    const next = getLocalCartCounts(userIdRef.current);
    setLocalCounts((prev) => (sameCounts(prev, next) ? prev : next));
  }, []);

  const refreshServerSummary = useCallback(async () => {
    const uid = userIdRef.current;

    if (!uid) {
      setServer((prev) => (prev == null ? prev : null));
      return;
    }

    const now = Date.now();
    if (now - lastFetchAtRef.current < RATE_LIMIT_MS) return;
    if (inFlightRef.current) return;

    lastFetchAtRef.current = now;
    inFlightRef.current = true;

    try {
      const res = await api.get("/api/cart/summary", { withCredentials: true });
      const root = (res as any)?.data?.data ?? (res as any)?.data ?? {};

      const next: ServerSummary = {
        distinct: Math.max(0, Number(root.distinct ?? 0) || 0),
        totalQty: Math.max(0, Number(root.totalQty ?? 0) || 0),
      };

      setServer((prev) => (sameCounts(prev, next) ? prev : next));
    } catch {
      setServer((prev) => (prev == null ? prev : null));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  // On auth switch, resync local immediately and clear stale server state
  useEffect(() => {
    setServer(null);
    syncLocalCounts();
    void refreshServerSummary();
  }, [userId, syncLocalCounts, refreshServerSummary]);

  // Listen to all cart-changing signals
  useEffect(() => {
    const onCartUpdated = () => {
      syncLocalCounts();
      void refreshServerSummary();
    };

    const onStorage = (e: StorageEvent) => {
      const k = e.key || "";
      if (!k || k === "cart" || k === GUEST_CART_KEY || k.startsWith(USER_CART_KEY_PREFIX)) {
        syncLocalCounts();
        void refreshServerSummary();
      }
    };

    const onFocus = () => {
      syncLocalCounts();
      void refreshServerSummary();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        syncLocalCounts();
        void refreshServerSummary();
      }
    };

    window.addEventListener("cart:updated", onCartUpdated as EventListener);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("cart:updated", onCartUpdated as EventListener);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [syncLocalCounts, refreshServerSummary]);

  return useMemo(() => {
    const local = localCounts ?? zeroCounts();

    // Most important rule:
    // if local cart is empty, do not keep showing an old non-zero server badge.
    if (local.totalQty === 0 && local.distinct === 0) {
      return local;
    }

    // If server matches or is available, you can use it.
    // But never let a stale server non-zero override a newly emptied local cart.
    if (server) {
      return {
        distinct: Math.max(local.distinct, server.distinct),
        totalQty: Math.max(local.totalQty, server.totalQty),
      };
    }

    return local;
  }, [localCounts, server]);
}