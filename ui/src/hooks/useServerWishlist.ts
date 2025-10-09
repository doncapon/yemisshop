import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

const LS_KEY = 'wishlist_product_ids';

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
  const token = useAuthStore((s) => s.token);
  const [ready, setReady] = useState(false);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // No product? nothing to do
      if (!productId) {
        setReady(true);
        return;
      }

      // Unauthed → localStorage
      if (!token) {
        const ids = readLocal();
        if (!cancelled) {
          setLiked(ids.includes(productId));
          setReady(true);
        }
        return;
      }

      // Authed → try server (fallback to local if route not ready)
      try {
        const { data } = await api.get<{ productIds: string[] }>('/api/wishlist', {
          headers: { Authorization: `Bearer ${token}` },
        });
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
    return () => { cancelled = true; };
  }, [token, productId]);

  const toggle = useCallback(async () => {
    if (!productId) return;

    // Unauthed → localStorage toggle
    if (!token) {
      const ids = readLocal();
      const exists = ids.includes(productId);
      const next = exists ? ids.filter((x) => x !== productId) : [...ids, productId];
      writeLocal(next);
      setLiked(!exists);
      return;
    }

    // Authed → call server (fallback to local)
    try {
      const { data } = await api.post<{ liked: boolean }>(
        '/api/wishlist/toggle',
        { productId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setLiked(Boolean(data?.liked));
    } catch {
      // fallback local
      const ids = readLocal();
      const exists = ids.includes(productId);
      const next = exists ? ids.filter((x) => x !== productId) : [...ids, productId];
      writeLocal(next);
      setLiked(!exists);
    }
  }, [token, productId]);

  return { ready, liked, toggle };
}

/**
 * Variant B: for the Wishlist page (retrieve whole list)
 */
export function useWishlistList() {
  const token = useAuthStore((s) => s.token);
  const [loading, setLoading] = useState(true);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!token) {
        setProductIds(readLocal());
      } else {
        const { data } = await api.get<{ productIds: string[] }>('/api/wishlist', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setProductIds(data?.productIds || []);
      }
    } catch (e: any) {
      // fallback local
      setProductIds(readLocal());
      setError(e?.response?.data?.error || null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  const removeOne = useCallback(async (pid: string) => {
    // optimistic
    setProductIds((prev) => prev.filter((x) => x !== pid));

    try {
      if (!token) {
        const ids = readLocal().filter((x) => x !== pid);
        writeLocal(ids);
      } else {
        await api.post(
          '/api/wishlist/toggle',
          { productId: pid },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }
    } catch {
      // revert by reloading
      refresh();
    }
  }, [token, refresh]);

  return { loading, error, productIds, refresh, removeOne };
}
