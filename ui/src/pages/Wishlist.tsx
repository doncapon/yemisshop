// src/pages/Wishlist.tsx
import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  imagesJson?: string[];
  categoryId?: string | null;
  categoryName?: string | null;
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

/* -------------------- Local cart helper -------------------- */
function addToLocalCart(p: Product) {
  try {
    const raw = localStorage.getItem('cart');
    const cart: any[] = raw ? JSON.parse(raw) : [];
    const idx = cart.findIndex((x) => x.productId === p.id);
    if (idx >= 0) {
      cart[idx].qty = Math.max(1, Number(cart[idx].qty) || 1) + 1;
      const unit = Number(cart[idx].price ?? p.price) || 0;
      cart[idx].totalPrice = unit * cart[idx].qty;
    } else {
      const unit = Number(p.price) || 0;
      cart.push({
        productId: p.id,
        title: p.title,
        qty: 1,
        totalPrice: unit, // new shape
        price: unit,      // back-compat if needed elsewhere
      });
    }
    localStorage.setItem('cart', JSON.stringify(cart));
  } catch {
    // no-op
  }
}

export default function Wishlist() {
  const { token } = useAuthStore();
  const nav = useNavigate();
  const qc = useQueryClient();

  // Proper redirect outside of render
  useEffect(() => {
    if (!token) {
      nav('/login', { replace: true, state: { from: { pathname: '/wishlist' } } });
    }
  }, [token, nav]);

  // 1) My favorite product IDs
  const favQuery = useQuery({
    queryKey: ['favorites', 'mine'],
    enabled: !!token,
    queryFn: async () => {
      const { data } = await api.get<{ productIds: string[] }>('/api/favorites/mine', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      return new Set(data.productIds);
    },
    initialData: new Set<string>(),
    staleTime: 30_000,
  });

  // 2) All products (could be replaced with a /favorites/products endpoint if you have it)
  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: async () => (await api.get('/api/products')).data as Product[],
    staleTime: 30_000,
  });

  const loading = productsQuery.isLoading || favQuery.isLoading;
  const error = productsQuery.isError || favQuery.isError;

  const favorites = useMemo(() => {
    if (!productsQuery.data) return [];
    return productsQuery.data.filter((p) => favQuery.data.has(p.id));
  }, [productsQuery.data, favQuery.data]);

  // Remove one
  const removeOne = useMutation({
    mutationFn: async ({ productId }: { productId: string }) => {
      await api.delete(`/api/favorites/${productId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      return { productId };
    },
    onMutate: async ({ productId }) => {
      const key = ['favorites', 'mine'] as const;
      const prev = qc.getQueryData<Set<string>>(key);
      if (prev) {
        const next = new Set(prev);
        next.delete(productId);
        qc.setQueryData(key, next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['favorites', 'mine'], ctx.prev);
      alert('Failed to remove from wishlist.');
    },
  });

  // Clear all
  const clearAll = useMutation({
    mutationFn: async () => {
      await api.delete('/api/favorites', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    },
    onSuccess: () => {
      qc.setQueryData(['favorites', 'mine'], new Set<string>());
    },
  });

  /* ================= UI ================= */

  if (error) {
    return (
      <div className="min-h-[80vh] grid place-items-center bg-hero-radial bg-bg-soft px-4">
        <div className="max-w-md text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-rose-100 text-rose-700 px-3 py-1 text-xs font-medium border border-rose-200">
            Error
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-ink">Couldn’t load your wishlist</h1>
          <p className="mt-1 text-sm text-ink-soft">Please refresh the page or try again later.</p>
          <Link
            to="/"
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-primary-600 text-white px-4 py-2.5 font-medium hover:bg-primary-700 active:bg-primary-800 focus:outline-none focus:ring-4 focus:ring-primary-200 transition"
          >
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-hero-radial bg-bg-soft">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-primary-100 text-primary-700 px-3 py-1 text-xs font-medium border border-primary-200">
              Wishlist
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-ink">Your saved items</h1>
            <p className="text-sm text-ink-soft">
              Keep favourites in one place and add them to cart when you’re ready.
            </p>
          </div>

          {favorites.length > 0 && (
            <button
              className="h-10 rounded-xl border border-border bg-white px-4 text-sm font-medium hover:bg-black/5 active:scale-[.98] transition disabled:opacity-50"
              disabled={clearAll.isPending}
              onClick={() => clearAll.mutate()}
            >
              {clearAll.isPending ? 'Clearing…' : 'Clear all'}
            </button>
          )}
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-white p-3">
                <div className="h-48 w-full rounded-xl bg-zinc-100 animate-pulse" />
                <div className="mt-3 h-4 w-3/4 rounded bg-zinc-100 animate-pulse" />
                <div className="mt-2 h-4 w-1/3 rounded bg-zinc-100 animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && favorites.length === 0 && (
          <div className="grid place-items-center">
            <div className="max-w-lg w-full text-center rounded-3xl border border-border bg-white/70 backdrop-blur p-8 shadow-sm">
              <div className="mx-auto mb-3 size-12 rounded-full grid place-items-center bg-primary-50 text-primary-700 border border-primary-200">
                ♥
              </div>
              <h2 className="text-xl font-semibold text-ink">No items in your wishlist yet</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Tap the heart on products to save them here. We’ll keep them safe for later.
              </p>
              <Link
                to="/"
                className="mt-5 inline-flex items-center justify-center rounded-xl bg-primary-600 text-white px-5 py-2.5 font-medium hover:bg-primary-700 active:bg-primary-800 focus:outline-none focus:ring-4 focus:ring-primary-200 transition"
              >
                Discover products
              </Link>
            </div>
          </div>
        )}

        {/* Grid */}
        {!loading && favorites.length > 0 && (
          <>
            <div className="mb-3 text-sm text-ink-soft">
              {favorites.length} saved {favorites.length === 1 ? 'item' : 'items'}
            </div>

            <div className="grid gap-5 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
              {favorites.map((p) => (
                <article
                  key={p.id}
                  className="group relative rounded-2xl border border-border bg-white overflow-hidden shadow-sm transition
                             hover:shadow-lg hover:-translate-y-0.5"
                >
                  <Link
                    to={`/product/${p.id}`}
                    className="block"
                    aria-label={`View ${p.title}`}
                    title={p.title}
                  >
                    {p.imagesJson?.[0] ? (
                      <img
                        src={p.imagesJson[0]}
                        alt={p.title}
                        className="h-56 w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-56 w-full grid place-items-center text-sm text-ink-soft bg-zinc-50">
                        No image
                      </div>
                    )}
                  </Link>

                  {/* Top-right action (remove) */}
                  <button
                    onClick={() => removeOne.mutate({ productId: p.id })}
                    className="absolute right-3 top-3 rounded-full bg-white/90 backdrop-blur border px-3 py-1 text-xs
                               hover:bg-white active:scale-95 transition"
                    aria-label="Remove from wishlist"
                    title="Remove"
                  >
                    Remove
                  </button>

                  {/* Body */}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold text-ink line-clamp-2">{p.title}</h3>
                      {p.categoryName && (
                        <span className="ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-ink-soft bg-surface">
                          {p.categoryName}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 text-lg font-semibold">{ngn.format(Number(p.price) || 0)}</div>

                    <div className="mt-3 flex items-center gap-2">
                      <Link
                        to={`/product/${p.id}`}
                        className="inline-flex items-center justify-center rounded-xl border border-border bg-white px-3 py-2 text-sm
                                   hover:bg-black/5 active:scale-[.98] transition"
                      >
                        View
                      </Link>
                      <button
                        onClick={() => addToLocalCart(p)}
                        className="inline-flex items-center justify-center rounded-xl bg-primary-600 text-white px-3 py-2 text-sm font-medium
                                   hover:bg-primary-700 active:bg-primary-800 focus:outline-none focus:ring-4 focus:ring-primary-200 transition"
                      >
                        Add to cart
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
