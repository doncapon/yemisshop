// src/pages/Catalog.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useModal } from '../components/ModalProvider';

type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  imagesJson: string[];
  categoryId?: string | null;
  categoryName?: string | null;
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

type PriceBucket = { label: string; min: number; max?: number };
const PRICE_BUCKETS: PriceBucket[] = [
  { label: '₦1,000 – ₦4,999', min: 1000, max: 4999 },
  { label: '₦5,000 – ₦9,999', min: 5000, max: 9999 },
  { label: '₦10,000 – ₦49,999', min: 10000, max: 49999 },
  { label: '₦50,000 – ₦99,999', min: 50000, max: 99999 },
  { label: '₦100,000+', min: 100000 },
];

function inBucket(price: number, b: PriceBucket) {
  return b.max == null ? price >= b.min : price >= b.min && price <= b.max;
}

type SortKey = 'relevance' | 'price-asc' | 'price-desc';

/* ---------------------------------------------------
   Recommendation constants (easy to tune)
--------------------------------------------------- */
const W_FAV = 2.5;
const W_PURCHASE = 3.0;  // multiplied by log1p(qty)
const W_CLICK = 1.5;     // multiplied by log1p(clicks)
const W_CAT_MATCH = 1.0;
const W_PRICE_PROX = 0.15; // tiny tie-breaker

/* ---------------------------------------------------
   Lightweight click tracking in localStorage
--------------------------------------------------- */
type ClickMap = Record<string, number>;
const CLICKS_KEY = 'productClicks:v1';

function readClicks(): ClickMap {
  try {
    return JSON.parse(localStorage.getItem(CLICKS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function bumpClick(productId: string) {
  try {
    const m = readClicks();
    m[productId] = (m[productId] || 0) + 1;
    localStorage.setItem(CLICKS_KEY, JSON.stringify(m));
  } catch {
    // swallow
  }
}

/* ---------------------------------------------------
   Fetch user's recent orders and aggregate product qty
--------------------------------------------------- */
type OrdersResp = {
  data: Array<{
    id: string;
    createdAt: string;
    items?: Array<{ product?: { id: string } | null; productId?: string | null; qty?: number | null }>;
  }>;
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function usePurchasedCounts() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['orders', 'mine', 'for-recs'],
    enabled: !!token,
    queryFn: async () => {
      // Pull a large page; server can cap safely. We just need a signal map.
      const { data } = await api.get<OrdersResp>('/api/orders/mine?page=1&pageSize=500', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const map: Record<string, number> = {};
      const list = Array.isArray(data?.data) ? data.data : [];
      for (const o of list) {
        for (const it of o.items || []) {
          const pid = (it.product as any)?.id || it.productId;
          if (!pid) continue;
          const qty = Number(it.qty || 1);
          map[pid] = (map[pid] || 0) + (Number.isFinite(qty) ? qty : 1);
        }
      }
      return map;
    },
    staleTime: 30_000,
  });
}

/* ---------------------------------------------------
   Component
--------------------------------------------------- */
export default function Catalog() {
  const { token } = useAuthStore();
  const qc = useQueryClient();
  const { openModal } = useModal();
  const nav = useNavigate();

  // All products
  const { data, isLoading, error } = useQuery({
    queryKey: ['products'],
    queryFn: async () => (await api.get('/api/products')).data as Product[],
  });

  // My favorites (as a Set of product IDs)
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
  });

  // Purchased map (productId -> totalQty)
  const purchasedQ = usePurchasedCounts();

  // Toggle favorite mutation
  const toggleFav = useMutation({
    mutationFn: async ({ productId }: { productId: string }) => {
      const { data } = await api.post<{ favorited: boolean }>(
        '/api/favorites/toggle',
        { productId },
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
      );
      return { productId, favorited: data.favorited };
    },
    onMutate: async ({ productId }) => {
      const key = ['favorites', 'mine'] as const;
      const prev = qc.getQueryData<Set<string>>(key);
      if (prev) {
        const next = new Set(prev);
        if (next.has(productId)) next.delete(productId);
        else next.add(productId);
        qc.setQueryData(key, next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['favorites', 'mine'], ctx.prev);
      openModal({ title: 'Wishlist', message: 'Could not update wishlist. Please try again.' });
    },
  });

  // Filters
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedBucketIdxs, setSelectedBucketIdxs] = useState<number[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('relevance');

  // Search (instant)
  const [query, setQuery] = useState('');
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestRef = useRef<HTMLDivElement | null>(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<6 | 9 | 12>(9);

  const products = data ?? [];

  // Normalize for search
  const norm = (s: string) =>
    s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // Suggestions (across all products)
  const suggestions = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return [];
    const scored = products.map((p) => {
      const title = norm(p.title || '');
      const desc = norm(p.description || '');
      const cat = norm(p.categoryName || '');
      let score = 0;
      if (title.startsWith(q)) score += 4;
      else if (title.includes(q)) score += 3;
      if (desc.includes(q)) score += 1;
      if (cat.includes(q)) score += 2;
      return { p, score };
    });
    return scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.p);
  }, [products, query]);

  /**
   * FACETS & FILTERED LIST (respects query).
   * Category counts respect selected price ranges; price counts respect selected categories.
   */
  const {
    categories,
    visiblePriceBuckets,
    filtered,
  } = useMemo(() => {
    const q = norm(query.trim());
    const baseByQuery = products.filter((p) => {
      if (!q) return true;
      const title = norm(p.title || '');
      const desc = norm(p.description || '');
      const cat = norm(p.categoryName || '');
      return title.includes(q) || desc.includes(q) || cat.includes(q);
    });

    const activeCats = new Set(selectedCategories);
    const activeBuckets = selectedBucketIdxs.map((i) => PRICE_BUCKETS[i]);

    // Category counts constrained by selected price ranges
    const baseForCategoryCounts = baseByQuery.filter((p) => {
      if (activeBuckets.length === 0) return true;
      const price = Number(p.price) || 0;
      return activeBuckets.some((b) => inBucket(price, b));
    });
    const catMap = new Map<string, { id: string; name: string; count: number }>();
    for (const p of baseForCategoryCounts) {
      const id = p.categoryId ?? 'uncategorized';
      const name = p.categoryName?.trim() || (p.categoryId ? `Category ${p.categoryId}` : 'Uncategorized');
      const entry = catMap.get(id) ?? { id, name, count: 0 };
      entry.count += 1;
      catMap.set(id, entry);
    }
    const categories = Array.from(catMap.values())
      .filter((c) => c.count > 0)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    // Price counts constrained by selected categories
    const baseForPriceCounts = baseByQuery.filter((p) => {
      if (activeCats.size === 0) return true;
      const catId = p.categoryId ?? 'uncategorized';
      return activeCats.has(catId);
    });
    const priceCounts = PRICE_BUCKETS.map((b) =>
      baseForPriceCounts.filter((p) => inBucket(Number(p.price) || 0, b)).length
    );
    const visiblePriceBuckets = PRICE_BUCKETS
      .map((b, i) => ({ bucket: b, idx: i, count: priceCounts[i] || 0 }))
      .filter((x) => x.count > 0);

    // Final pre-sort filtering
    const filteredCore = baseByQuery.filter((p) => {
      const price = Number(p.price) || 0;
      const catId = p.categoryId ?? 'uncategorized';
      const catOk = activeCats.size === 0 ? true : activeCats.has(catId);
      const priceOk = activeBuckets.length === 0 ? true : activeBuckets.some((b) => inBucket(price, b));
      return catOk && priceOk;
    });

    return { categories, visiblePriceBuckets, filtered: filteredCore };
  }, [products, selectedCategories, selectedBucketIdxs, query]);

  /* -------------------------------------------
     Build recommendation scores for 'relevance'
  ------------------------------------------- */
  const recScored = useMemo(() => {
    if (sortKey !== 'relevance') return filtered;

    const favSet = favQuery.data ?? new Set<string>();
    const purchased = purchasedQ.data ?? {};
    const clicks = readClicks();

    // Derive top categories from signals
    const catWeight = new Map<string, number>();
    for (const p of filtered) {
      const catId = p.categoryId ?? 'uncategorized';
      let w = 0;
      if (favSet.has(p.id)) w += 2;
      if (purchased[p.id]) w += Math.log1p(purchased[p.id]); // smaller than per-item weight
      if (clicks[p.id]) w += 0.5 * Math.log1p(clicks[p.id]);
      if (w > 0) catWeight.set(catId, (catWeight.get(catId) || 0) + w);
    }
    const topCats = new Set(
      Array.from(catWeight.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id),
    );

    // Historical median price (for a tiny tie-breaker)
    const purchasedPrices: number[] = [];
    for (const p of filtered) {
      const q = purchased[p.id];
      if (q) {
        const price = Number(p.price) || 0;
        for (let i = 0; i < Math.min(q, 3); i++) purchasedPrices.push(price);
      }
    }
    purchasedPrices.sort((a, b) => a - b);
    const medianPrice =
      purchasedPrices.length === 0
        ? null
        : purchasedPrices[Math.floor(purchasedPrices.length / 2)];

    function priceProximityScore(price: number) {
      if (medianPrice == null) return 0;
      const diff = Math.abs(price - medianPrice);
      // normalize by 20% of median
      const denom = Math.max(1, 0.2 * medianPrice);
      const v = Math.max(0, 1 - diff / denom); // 1 when identical, 0 when far
      return v;
    }

    // Score each product
    const scored = filtered.map((p) => {
      const fav = favSet.has(p.id) ? 1 : 0;
      const buy = Math.log1p(purchased[p.id] || 0);
      const clk = Math.log1p(clicks[p.id] || 0);
      const catMatch = topCats.has(p.categoryId ?? 'uncategorized') ? 1 : 0;
      const prox = priceProximityScore(Number(p.price) || 0);

      const score =
        W_FAV * fav +
        W_PURCHASE * buy +
        W_CLICK * clk +
        W_CAT_MATCH * catMatch +
        W_PRICE_PROX * prox;

      return { p, score };
    });

    // Sort by score desc, then lightly by popularity proxy (clicks + purchases + price)
    return scored
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const ap = (purchased[a.p.id] || 0) + (readClicks()[a.p.id] || 0);
        const bp = (purchased[b.p.id] || 0) + (readClicks()[b.p.id] || 0);
        if (bp !== ap) return bp - ap;
        return (Number(b.p.price) || 0) - (Number(a.p.price) || 0);
      })
      .map((x) => x.p);
  }, [filtered, sortKey, favQuery.data, purchasedQ.data]);

  // Which list do we show based on sort
  const sorted = useMemo(() => {
    if (sortKey === 'relevance') return recScored;

    const arr = [...filtered].sort((a, b) => {
      if (sortKey === 'price-asc') return (Number(a.price) || 0) - (Number(b.price) || 0);
      if (sortKey === 'price-desc') return (Number(b.price) || 0) - (Number(a.price) || 0);
      return 0;
    });
    return arr;
  }, [filtered, recScored, sortKey]);

  // Reset page when inputs change
  useEffect(() => {
    setPage(1);
  }, [selectedCategories, selectedBucketIdxs, pageSize, sortKey, query]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = sorted.slice(start, start + pageSize);

  // Close suggestions on click outside
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        suggestRef.current &&
        !suggestRef.current.contains(t) &&
        inputRef.current &&
        !inputRef.current.contains(t)
      ) {
        setShowSuggest(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p>Error loading products</p>;

  const toggleCategory = (id: string) =>
    setSelectedCategories((curr) => (curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id]));
  const toggleBucket = (idx: number) =>
    setSelectedBucketIdxs((curr) => (curr.includes(idx) ? curr.filter((i) => i !== idx) : [...curr, idx]));
  const clearFilters = () => {
    setSelectedCategories([]);
    setSelectedBucketIdxs([]);
  };

  const goTo = (p: number) => {
    const clamped = Math.min(Math.max(1, p), totalPages);
    setPage(clamped);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const isFav = (id: string) => favQuery.data?.has(id);

  return (
    <div className="max-w-screen-2xl mx-auto bg-bg-soft min-h-screen">
      <div className="md:flex md:items-start md:gap-8">
        {/* LEFT: filters */}
        <aside className="space-y-8 md:w-72 lg:w-80 md:flex-none px-4 md:px-6 bg-primary-600 min-h-screen text-white">
          <section>
            <h3 className="pt-4 text-white/90">Filters</h3>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="font-semibold">Categories</h2>
              <button
                className="text-sm underline disabled:opacity-40"
                onClick={() => setSelectedCategories([])}
                disabled={selectedCategories.length === 0}
              >
                Clear
              </button>
            </div>
            <ul className="space-y-2">
              {categories.map((c) => {
                const checked = selectedCategories.includes(c.id);
                return (
                  <li key={c.id} className="flex items-center gap-2 text-accent-200">
                    <input
                      id={`cat-${c.id}`}
                      type="checkbox"
                      className="size-4"
                      checked={checked}
                      onChange={() => toggleCategory(c.id)}
                    />
                    <label
                      htmlFor={`cat-${c.id}`}
                      className={`flex-1 flex items-center justify-between px-2 py-1 rounded border ${
                        checked ? 'bg-black text-white' : 'hover:bg-black/5'
                      }`}
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="ml-2 text-xs opacity-80">({c.count})</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="font-semibold">Price</h2>
              <button
                className="text-sm underline disabled:opacity-40"
                onClick={() => setSelectedBucketIdxs([])}
                disabled={selectedBucketIdxs.length === 0}
              >
                Clear
              </button>
            </div>
            <ul className="space-y-2">
              {visiblePriceBuckets.map(({ bucket, idx, count }) => {
                const checked = selectedBucketIdxs.includes(idx);
                return (
                  <li key={bucket.label} className="flex items-center gap-2 text-accent-200">
                    <input
                      id={`price-${idx}`}
                      type="checkbox"
                      className="size-4"
                      checked={checked}
                      onChange={() => toggleBucket(idx)}
                    />
                    <label
                      htmlFor={`price-${idx}`}
                      className={`flex-1 flex items-center justify-between px-2 py-1 rounded border ${
                        checked ? 'bg-black text-white' : 'hover:bg-black/5'
                      }`}
                    >
                      <span>{bucket.label}</span>
                      <span className="ml-2 text-xs opacity-80">({count})</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          {(selectedCategories.length || selectedBucketIdxs.length) > 0 && (
            <button className="text-sm underline" onClick={clearFilters}>
              Clear all filters
            </button>
          )}
        </aside>

        {/* RIGHT: title + controls + grid + pagination */}
        <section className="mt-8 md:mt-0 flex-1 px-4 md:px-0">
          <div className="mb-2">
            <h2 className="text-2xl font-semibold text-primary-700">Products</h2>
          </div>

          {/* Controls BELOW the title */}
          <div className="flex flex-wrap items-center gap-4 mb-4 pr-3">
            {/* Search (2× width) */}
            <div className="relative w-[36rem] max-w-full">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowSuggest(true);
                  setActiveIdx(0);
                }}
                onFocus={() => query && setShowSuggest(true)}
                onKeyDown={(e) => {
                  if (!showSuggest || suggestions.length === 0) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveIdx((i) => Math.max(i - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const pick = suggestions[activeIdx];
                    if (pick) {
                      bumpClick(pick.id);
                      nav(`/product/${pick.id}`);
                    }
                    setShowSuggest(false);
                  } else if (e.key === 'Escape') {
                    setShowSuggest(false);
                  }
                }}
                placeholder="Search products or categories…"
                className="border rounded px-4 py-3 w-full bg-white text-base"
                aria-label="Search products"
              />
              {showSuggest && query && suggestions.length > 0 && (
                <div
                  ref={suggestRef}
                  className="absolute left-0 right-0 mt-2 bg-white border rounded-xl shadow-2xl z-20 overflow-hidden"
                >
                  <ul className="max-h-[80vh] overflow-auto p-2">
                    {suggestions.map((p, i) => {
                      const active = i === activeIdx;
                      return (
                        <li key={p.id} className="mb-2 last:mb-0">
                          <Link
                            to={`/product/${p.id}`}
                            className={`flex items-center gap-4 px-3 py-3 rounded-lg hover:bg-black/5 ${
                              active ? 'bg-black/5' : ''
                            }`}
                            onClick={() => bumpClick(p.id)}
                          >
                            {p.imagesJson?.[0] ? (
                              <img
                                src={p.imagesJson[0]}
                                alt={p.title}
                                className="w-[120px] h-[120px] object-cover rounded border"
                              />
                            ) : (
                              <div className="w-[120px] h-[120px] rounded border grid place-items-center text-base text-gray-500">
                                —
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="text-lg font-semibold truncate">{p.title}</div>
                              <div className="text-sm opacity-80 truncate">
                                {ngn.format(Number(p.price) || 0)} {p.categoryName ? `• ${p.categoryName}` : ''}
                              </div>
                              {p.description && (
                                <div className="text-sm opacity-70 line-clamp-2 mt-1">
                                  {p.description}
                                </div>
                              )}
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            <div className="text-sm">
              <label className="mr-2 opacity-70">Sort:</label>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="border rounded px-2 py-2 bg-white"
              >
                <option value="relevance">Relevance</option>
                <option value="price-asc">Price: Low → High</option>
                <option value="price-desc">Price: High → Low</option>
              </select>
            </div>

            <div className="text-sm">
              <label className="mr-2 opacity-70">Per page:</label>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) as any)}
                className="border rounded px-2 py-2 bg-white"
              >
                <option value={6}>6</option>
                <option value={9}>9</option>
                <option value={12}>12</option>
              </select>
            </div>
          </div>

          {sorted.length === 0 ? (
            <p>No products match your filters.</p>
          ) : (
            <>
              <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))] pr-3">
                {pageItems.map((p) => {
                  const fav = isFav(p.id);
                  return (
                    <article key={p.id} className="border rounded p-4 grid gap-3 auto-rows-min bg-white">
                      <Link
                        to={`/product/${p.id}`}
                        className="grid gap-3 auto-rows-min"
                        onClick={() => bumpClick(p.id)}
                      >
                        {p.imagesJson?.[0] && (
                          <img
                            src={p.imagesJson[0]}
                            alt={p.title}
                            className="w-full h-40 object-cover rounded border"
                          />
                        )}
                        <h3 className="font-medium text-primary-700">{p.title}</h3>
                        <h3 className="font-small text-black-700 text-sm">{p.categoryName}</h3>
                        <p className="text-sm mt-1 font-semibold">
                          {ngn.format(Number(p.price) || 0)}
                        </p>
                      </Link>

                      <div className="flex items-center justify-between">
                        <button
                          aria-label={fav ? 'Remove from wishlist' : 'Add to wishlist'}
                          className={`text-lg ${fav ? 'text-red-600' : 'text-gray-500 hover:text-red-600'}`}
                          onClick={() => {
                            if (!token) {
                              openModal({ title: 'Wishlist', message: 'Please login to use the wishlist.' });
                              return;
                            }
                            toggleFav.mutate({ productId: p.id });
                          }}
                          title={fav ? 'Remove from wishlist' : 'Add to wishlist'}
                        >
                          {fav ? '♥' : '♡'}
                        </button>

                        <Link to="/wishlist" className="text-sm underline opacity-80">
                          View wishlist
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Pagination */}
              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  className="px-3 py-1 border rounded disabled:opacity-50"
                  onClick={() => goTo(currentPage - 1)}
                  disabled={currentPage <= 1}
                >
                  Prev
                </button>

                {Array.from({ length: totalPages }).map((_, i) => {
                  const p = i + 1;
                  const active = p === currentPage;
                  const shouldShow = p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1;
                  const isEdgeGap =
                    (p === 2 && currentPage > 3) ||
                    (p === totalPages - 1 && currentPage < totalPages - 2);

                  if (!shouldShow && !isEdgeGap) return null;
                  if (isEdgeGap) return <span key={`gap-${p}`} className="px-1">…</span>;

                  return (
                    <button
                      key={p}
                      onClick={() => goTo(p)}
                      className={`px-3 py-1 border rounded ${active ? 'bg-accent-600 text-white' : 'hover:bg-black/5'}`}
                    >
                      {p}
                    </button>
                  );
                })}

                <button
                  className="px-3 py-1 border rounded disabled:opacity-50"
                  onClick={() => goTo(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                >
                  Next
                </button>
              </div>

              <p className="mt-3 text-center text-sm opacity-70">
                Showing {start + 1}-{Math.min(start + pageSize, sorted.length)} of {sorted.length} products
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
