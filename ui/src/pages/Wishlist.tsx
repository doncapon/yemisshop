// src/pages/Wishlist.tsx
import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';
import SiteLayout from '../layouts/SiteLayout';

/* ---------------- Types (aligned with Catalog) ---------------- */
type Variant = {
  id: string;
  sku?: string;
  price?: number | null;
  inStock?: boolean;
  imagesJson?: string[];
};
type Product = {
  id: string;
  title: string;
  description?: string;
  price?: number;
  inStock?: boolean;
  imagesJson?: string[];
  categoryId?: string | null;
  categoryName?: string | null;
  brandName?: string | null;
  brand?: { id: string; name: string } | null;
  variants?: Variant[];
  ratingAvg?: number | null;
  ratingCount?: number | null;
  attributesSummary?: { attribute: string; value: string }[];
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

/* ---------------- Helpers (shared with Catalog semantics) ---------------- */
function getBrandName(p: Product) {
  return (p.brand?.name || p.brandName || '').trim();
}
function hasVariantInStock(p: Product) {
  return (p.variants || []).some(v => v.inStock !== false);
}
function getMinPrice(p: Product): number {
  const base = Number(p.price ?? 0);
  const mins = [base, ...(p.variants ?? []).map(v => Number(v?.price ?? base))].filter(Number.isFinite);
  return mins.length ? Math.min(...mins) : 0;
}
function normalizeProductsPayload(payload: any): Product[] {
  const raw: any[] = Array.isArray(payload) ? payload : (payload?.data ?? []);
  return raw
    .filter((x) => x && typeof x.id === 'string')
    .map((x) => ({
      id: String(x.id),
      title: String(x.title ?? ''),
      description: x.description ?? '',
      price: Number.isFinite(Number(x.price)) ? Number(x.price) : undefined,
      inStock: x.inStock !== false,
      imagesJson: Array.isArray(x.imagesJson) ? x.imagesJson : [],
      categoryId: x.categoryId ?? null,
      categoryName: x.categoryName ?? null,
      brandName: x.brandName ?? x.brand?.name ?? null,
      brand: x.brand ? { id: String(x.brand.id), name: String(x.brand.name) } : null,
      variants: Array.isArray(x.variants) ? x.variants : [],
      ratingAvg: x.ratingAvg ?? null,
      ratingCount: x.ratingCount ?? null,
      attributesSummary: Array.isArray(x.attributesSummary) ? x.attributesSummary : [],
    })) as Product[];
}

/* ---------------- Local cart helper ---------------- */
function addToLocalCart(p: Product) {
  try {
    const raw = localStorage.getItem('cart');
    const cart: any[] = raw ? JSON.parse(raw) : [];
    const idx = cart.findIndex((x) => x.productId === p.id);

    const unit = getMinPrice(p);
    if (idx >= 0) {
      cart[idx].qty = Math.max(1, Number(cart[idx].qty) || 1) + 1;
      cart[idx].price = unit;           // legacy
      cart[idx].totalPrice = unit * cart[idx].qty;
      cart[idx].title = p.title;
    } else {
      cart.push({
        productId: p.id,
        title: p.title,
        qty: 1,
        totalPrice: unit, // preferred
        price: unit,      // legacy
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

  // Redirect unauthenticated users
  useEffect(() => {
    if (!token) {
      nav('/login', { replace: true, state: { from: { pathname: '/wishlist' } } });
    }
  }, [token, nav]);

  /* 1) Favorite product IDs */
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

  /* 2) All products (rich) and then filter client-side by fav ids.
        If you add /api/favorites/products later, you can switch to that. */
  const productsQuery = useQuery({
    queryKey: ['products', { include: 'brand,variants,attributes' }],
    queryFn: async () => {
      const res = await api.get('/api/products?include=brand,variants,attributes');
      return normalizeProductsPayload(res.data);
    },
    staleTime: 30_000,
  });

  const loading = productsQuery.isLoading || favQuery.isLoading;
  const error = productsQuery.isError || favQuery.isError;

  const favorites: Product[] = useMemo(() => {
    const products = productsQuery.data ?? [];
    const favIds = favQuery.data ?? new Set<string>();
    return products.filter((p) => favIds.has(p.id));
  }, [productsQuery.data, favQuery.data]);

  /* Remove one (toggle off) */
  const removeOne = useMutation({
    mutationFn: async ({ productId }: { productId: string }) => {
      await api.post(
        '/api/favorites/toggle',
        { productId },
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
      );
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

  /* Clear all — bulk toggle off client-side */
  const clearAll = useMutation({
    mutationFn: async () => {
      const ids = Array.from(favQuery.data ?? []);
      await Promise.allSettled(
        ids.map((productId) =>
          api.post(
            '/api/favorites/toggle',
            { productId },
            token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
          )
        )
      );
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
    <SiteLayout>
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
                {favorites.map((p) => {
                  const minPrice = getMinPrice(p);
                  const available = p.inStock || hasVariantInStock(p);
                  const brand = getBrandName(p);
                  return (
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
                        <div className="relative">
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

                          <span
                            className={`absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium
                                      ${available ? 'bg-emerald-600/10 text-emerald-700 border border-emerald-600/20' : 'bg-rose-600/10 text-rose-700 border border-rose-600/20'}`}
                          >
                            {available ? 'In stock' : 'Out of stock'}
                          </span>
                        </div>
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

                        <div className="mt-1 text-xs text-ink-soft line-clamp-1">
                          {brand ? `${brand} • ` : ''}{available ? 'Available' : 'Unavailable'}
                        </div>

                        <div className="mt-2 text-lg font-semibold">
                          {ngn.format(minPrice)}
                          {p.variants && p.variants.length > 0 && minPrice < Number(p.price ?? Infinity) && (
                            <span className="ml-1 text-[11px] text-ink-soft">from variants</span>
                          )}
                        </div>

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
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </SiteLayout>
  );
}
