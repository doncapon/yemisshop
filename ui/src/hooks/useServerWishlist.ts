import { useEffect, useState, useCallback } from "react";
import api from "../api/client";

const LS_KEY = "wishlist_product_ids";

/* ✅ Cookie calls helper (always send cookies) */
const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function readLocal(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeLocal(ids: string[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(Array.from(new Set(ids))));
}

/**
 * Variant A: for a single product (toggle on detail card)
 */
export function useServerWishlist(productId?: string | null) {
  const [ready, setReady] = useState(false);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!productId) {
        setReady(true);
        return;
      }

      /**
       * ✅ Cookie session:
       * Try server first. If unauth (401/403) or route missing, fall back to localStorage.
       */
      try {
        const { data } = await api.get<{ productIds: string[] }>(
          "/api/wishlist",
          AXIOS_COOKIE_CFG
        );

        if (!cancelled) {
          setLiked((data?.productIds || []).includes(productId));
          setReady(true);
        }
      } catch {
        const ids = readLocal();
        if (!cancelled) {
          setLiked(ids.includes(productId));
          setReady(true);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const toggle = useCallback(async () => {
    if (!productId) return;

    /**
     * ✅ Cookie session:
     * Try server toggle. If unauth/failure, toggle localStorage.
     */
    try {
      const { data } = await api.post<{ liked: boolean }>(
        "/api/wishlist/toggle",
        { productId },
        AXIOS_COOKIE_CFG
      );
      setLiked(Boolean(data?.liked));
    } catch {
      const ids = readLocal();
      const exists = ids.includes(productId);
      const next = exists ? ids.filter((x) => x !== productId) : [...ids, productId];
      writeLocal(next);
      setLiked(!exists);
    }
  }, [productId]);

  return { ready, liked, toggle };
}

/**
 * Variant B: for the Wishlist page (retrieve whole list)
 */
export function useWishlistList() {
  const [loading, setLoading] = useState(true);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    /**
     * ✅ Cookie session:
     * Try server list; if unauth/failure, fall back to localStorage.
     */
    try {
      const { data } = await api.get<{ productIds: string[] }>(
        "/api/wishlist",
        AXIOS_COOKIE_CFG
      );
      setProductIds(data?.productIds || []);
    } catch (e: any) {
      setProductIds(readLocal());
      setError(e?.response?.data?.error || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const removeOne = useCallback(
    async (pid: string) => {
      // optimistic
      setProductIds((prev) => prev.filter((x) => x !== pid));

      /**
       * ✅ Cookie session:
       * Try server toggle; if unauth/failure, update localStorage and reconcile.
       */
      try {
        await api.post("/api/wishlist/toggle", { productId: pid }, AXIOS_COOKIE_CFG);
      } catch {
        // local fallback
        const ids = readLocal().filter((x) => x !== pid);
        writeLocal(ids);

        // reconcile (in case server actually worked but response failed, etc.)
        refresh();
      }
    },
    [refresh]
  );

  return { loading, error, productIds, refresh, removeOne };
}
