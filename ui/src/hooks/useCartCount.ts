// src/hooks/useCartCount.ts
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";

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
 * ✅ Reactive cart counter (server-first with LS fallback)
 *
 * Updates from:
 * - same-tab LS updates: "cart:updated" event
 * - other-tab LS updates: "storage" event
 * - server updates: React Query ["cart"] invalidation/refetch
 * - optional resync on focus/visibility
 */
export function useCartCount() {
  const queryClient = useQueryClient();
  const [tick, setTick] = useState(0);

  // ✅ Fetch server cart (works with your current "/api/cart/items" mutations + invalidateQueries(["cart"]))
  const cartQ = useQuery({
    queryKey: ["cart"],
    staleTime: 10_000,
    retry: 0,
    queryFn: async () => {
      // Expecting your backend cart endpoint; normalize response shapes.
      const { data } = await api.get("/api/cart");
      const payload = (data as any)?.data ?? data ?? {};

      // Common shapes:
      // - { items: [...] }
      // - { cart: { items: [...] } }
      // - [...]
      const items =
        Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.cart?.items)
          ? payload.cart.items
          : Array.isArray(payload)
          ? payload
          : [];

      return { items };
    },
  });

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);

    const resync = () => {
      // bump LS-derived badge
      bump();
      // and refresh server cart badge
      queryClient.invalidateQueries({ queryKey: ["cart"] });
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === "cart") resync();
    };

    const onFocus = () => resync();
    const onVis = () => {
      if (document.visibilityState === "visible") resync();
    };

    // LS update (same-tab)
    window.addEventListener("cart:updated", resync as EventListener);

    // LS update (other tabs)
    window.addEventListener("storage", onStorage);

    // optional “come back to tab” refresh
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("cart:updated", resync as EventListener);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [queryClient]);

  return useMemo(() => {
    // ✅ 1) Prefer server counts if available (covers add/remove/qty when server is source of truth)
    const serverItems = (cartQ.data as any)?.items;

    if (Array.isArray(serverItems)) {
      // normalize: quantity or qty
      let totalQty = 0;
      let distinct = 0;

      for (const it of serverItems) {
        const q = Math.max(0, Math.floor(Number((it as any)?.quantity ?? (it as any)?.qty) || 0));
        if (q > 0) {
          distinct += 1;
          totalQty += q;
        }
      }

      // If server cart is empty, we still allow LS fallback (useful for guests / offline LS cart)
      if (distinct > 0 || totalQty > 0) return { distinct, totalQty };
    }

    // ✅ 2) Fallback to LS (covers guest cart / local-only flows)
    const cart = readCartSafe();
    return computeCounts(cart);
  }, [tick, cartQ.data]);
}
