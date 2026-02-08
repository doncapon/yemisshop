// src/hooks/useCartCount.ts
import { useEffect, useMemo, useState } from "react";

type CartLine = {
  productId: string;
  variantId?: string | null;
  qty?: number;
};

function readCartSafe(): CartLine[] {
  try {
    const raw = localStorage.getItem("cart");
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function computeCounts(lines: CartLine[]) {
  let totalQty = 0;
  let distinct = 0;

  for (const l of lines) {
    const q = Math.max(0, Math.floor(Number(l?.qty) || 0));
    if (q > 0) {
      distinct += 1; // each cart line = distinct item
      totalQty += q;
    }
  }

  return { distinct, totalQty };
}

/**
 * Reactive cart counter:
 * - same-tab updates: listens to "cart:updated" custom event
 * - other-tab updates: listens to "storage" event
 * - optional resync on focus/visibility
 */
export function useCartCount() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);

    const onStorage = (e: StorageEvent) => {
      if (e.key === "cart") bump();
    };

    const onFocus = () => bump();
    const onVis = () => {
      if (document.visibilityState === "visible") bump();
    };

    window.addEventListener("cart:updated", bump as EventListener);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("cart:updated", bump as EventListener);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return useMemo(() => {
    const cart = readCartSafe();
    return computeCounts(cart);
  }, [tick]);
}
