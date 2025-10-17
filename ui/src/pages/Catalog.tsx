// src/pages/Catalog.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useModal } from '../components/ModalProvider';
import { motion } from 'framer-motion';
import {
  Sparkles,
  Search,
  SlidersHorizontal,
  Star,
  Heart,
  HeartOff,
  LayoutGrid,
  ArrowUpDown,
} from 'lucide-react';

/* ---------------- Types ---------------- */
type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  stock: boolean;
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

/* ---------------- Recommendation weights ---------------- */
const W_FAV = 2.5;
const W_PURCHASE = 3.0; // * log1p(qty)
const W_CLICK = 1.5;    // * log1p(clicks)
const W_CAT_MATCH = 1.0;
const W_PRICE_PROX = 0.15;

/* ---------------- Lightweight click tracking ---------------- */
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
  } catch {}
}

/* ---------------- Purchased counts (orders) ---------------- */
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
    // Avoid retry spam in logs if validation fails
    retry: 0,
    queryFn: async () => {
      const PAGE_SIZE = 100; // server max
      let page = 1;
      let totalPages = 1;
      const map: Record<string, number> = {};

      while (page <= totalPages) {
        const { data } = await api.get<OrdersResp>(
          `/api/orders/mine?page=${page}&pageSize=${PAGE_SIZE}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
        );

        const list = Array.isArray(data?.data) ? data.data : [];
        for (const o of list) {
          for (const it of o.items || []) {
            const pid = (it.product as any)?.id || it.productId;
            if (!pid) continue;
            const qty = Number(it.qty || 1);
            map[pid] = (map[pid] || 0) + (Number.isFinite(qty) ? qty : 1);
          }
        }

        totalPages = Math.max(1, Number(data?.totalPages ?? 1));
        page += 1;

        // hard safety cap in case the API misreports totalPages
        if (page > 50) break; // at most 5k orders scanned
      }

      return map;
    },
    staleTime: 30_000,
  });
}

/* ---------------- Component ---------------- */
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

  // My favorites (Set of product IDs)
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

  // Toggle favorite
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

  const products = useMemo(() => (data ?? []).filter((p) => p.stock === true), [data]);

  // Normalize for search
  const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

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

  /* -------- FACETS & FILTERED LIST (respects query) -------- */
  const { categories, visiblePriceBuckets, filtered } = useMemo(() => {
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

    // Final list (pre-sort)
    const filteredCore = baseByQuery.filter((p) => {
      const price = Number(p.price) || 0;
      const catId = p.categoryId ?? 'uncategorized';
      const catOk = activeCats.size === 0 ? true : activeCats.has(catId);
      const priceOk = activeBuckets.length === 0 ? true : activeBuckets.some((b) => inBucket(price, b));
      return catOk && priceOk;
    });

    return { categories, visiblePriceBuckets, filtered: filteredCore };
  }, [products, selectedCategories, selectedBucketIdxs, query]);

  /* ---------------- Recommendation score for relevance ---------------- */
  const recScored = useMemo(() => {
    if (sortKey !== 'relevance') return filtered;

    const favSet = favQuery.data ?? new Set<string>();
    const purchased = purchasedQ.data ?? {};
    const clicks = readClicks();

    const catWeight = new Map<string, number>();
    for (const p of filtered) {
      const catId = p.categoryId ?? 'uncategorized';
      let w = 0;
      if (favSet.has(p.id)) w += 2;
      if (purchased[p.id]) w += Math.log1p(purchased[p.id]);
      if (clicks[p.id]) w += 0.5 * Math.log1p(clicks[p.id]);
      if (w > 0) catWeight.set(catId, (catWeight.get(catId) || 0) + w);
    }
    const topCats = new Set(
      Array.from(catWeight.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id)
    );

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
      purchasedPrices.length === 0 ? null : purchasedPrices[Math.floor(purchasedPrices.length / 2)];

    const priceProximityScore = (price: number) => {
      if (medianPrice == null) return 0;
      const diff = Math.abs(price - medianPrice);
      const denom = Math.max(1, 0.2 * medianPrice);
      return Math.max(0, 1 - diff / denom);
    };

    const scored = filtered.map((p) => {
      const fav = favSet.has(p.id) ? 1 : 0;
      const buy = Math.log1p(purchased[p.id] || 0);
      const clk = Math.log1p(clicks[p.id] || 0);
      const catMatch = topCats.has(p.categoryId ?? 'uncategorized') ? 1 : 0;
      const prox = priceProximityScore(Number(p.price) || 0);

      const score = W_FAV * fav + W_PURCHASE * buy + W_CLICK * clk + W_CAT_MATCH * catMatch + W_PRICE_PROX * prox;
      return { p, score };
    });

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

  // Which list to show
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

  const Shimmer = () => <div className="h-3 w-full rounded bg-gradient-to-r from-zinc-200 via-zinc-100 to-zinc-200 animate-pulse" />;

  return (
    <div className="max-w-screen-2xl mx-auto min-h-screen">
      {/* Neon gradient hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700">
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,0,167,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,204,255,0.25),transparent_60%)]" />
        <div className="relative px-4 md:px-8 pt-10 pb-8">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              {/* CHANGED: make hero text white for contrast on blue bg */}
              <motion.h1
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-2xl md:text-3xl font-bold tracking-tight text-white"
              >
                Discover Products <Sparkles className="inline text-white ml-1" size={22} />
              </motion.h1>
              <p className="text-sm text-white/80">Fresh picks, smart sorting, and instant search—tailored for you.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="md:flex md:items-start md:gap-8 px-4 md:px-8 pb-10">
        {/* LEFT: Filters (glass) */}
        <aside className="space-y-6 md:w-72 lg:w-80 md:flex-none mt-6 md:mt-10">          
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-white/40 bg-white/80 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.08)] p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="inline-flex items-center gap-2">
                <span className="inline-grid place-items-center w-8 h-8 rounded-xl bg-gradient-to-br from-fuchsia-500/15 to-cyan-500/15 text-fuchsia-600">
                  <SlidersHorizontal size={18} />
                </span>
                <h3 className="font-semibold text-zinc-900">Filters</h3>
              </div>
              {(selectedCategories.length || selectedBucketIdxs.length) > 0 && (
                <button className="text-sm text-fuchsia-700 hover:underline" onClick={clearFilters}>
                  Clear all
                </button>
              )}
            </div>

            {/* Categories */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-3">
                <h4 className="text-sm font-semibold text-zinc-800">Categories</h4>
                <button
                  className="text-xs text-zinc-600 hover:underline disabled:opacity-40"
                  onClick={() => setSelectedCategories([])}
                  disabled={selectedCategories.length === 0}
                >
                  Reset
                </button>
              </div>
              <ul className="space-y-2">
                {categories.length === 0 && <Shimmer />}
                {categories.map((c) => {
                  const checked = selectedCategories.includes(c.id);
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => toggleCategory(c.id)}
                        className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${
                          checked ? 'bg-zinc-900 text-white' : 'bg-white/80 hover:bg-black/5 text-zinc-800'
                        }`}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className={`ml-2 text-xs ${checked ? 'text-white/90' : 'text-zinc-600'}`}>({c.count})</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Price */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <h4 className="text-sm font-semibold text-zinc-800">Price</h4>
                <button
                  className="text-xs text-zinc-600 hover:underline disabled:opacity-40"
                  onClick={() => setSelectedBucketIdxs([])}
                  disabled={selectedBucketIdxs.length === 0}
                >
                  Reset
                </button>
              </div>
              <ul className="space-y-2">
                {visiblePriceBuckets.length === 0 && <Shimmer />}
                {visiblePriceBuckets.map(({ bucket, idx, count }) => {
                  const checked = selectedBucketIdxs.includes(idx);
                  return (
                    <li key={bucket.label}>
                      <button
                        onClick={() => toggleBucket(idx)}
                        className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${
                          checked ? 'bg-zinc-900 text-white' : 'bg-white/80 hover:bg-black/5 text-zinc-800'
                        }`}
                      >
                        <span>{bucket.label}</span>
                        <span className={`ml-2 text-xs ${checked ? 'text-white/90' : 'text-zinc-600'}`}>({count})</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </motion.section>
        </aside>

        {/* RIGHT: Title + controls + grid */}
        <section className="mt-8 md:mt-0 flex-1">
          <div className="mb-3">
            {/* CHANGED: white text variant in case bg behind is blue */}
            <h2 className="text-2xl font-semibold text-zinc-900">Products</h2>
          </div>

          {/* Controls: Search + Sort + Per page */}
          <div className="flex flex-wrap items-center gap-4 mb-5">
            <div className="relative w-[36rem] max-w-full">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
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
                  className="border rounded-2xl pl-9 pr-4 py-3 w-full bg-white/90 backdrop-blur focus:ring-4 focus:ring-fuchsia-100 focus:border-fuchsia-400 transition"
                  aria-label="Search products"
                />
              </div>

              {showSuggest && query && suggestions.length > 0 && (
                <div
                  ref={suggestRef}
                  className="absolute left-0 right-0 mt-3 bg-white border rounded-2xl shadow-2xl z-20 overflow-hidden"
                >
                  <ul className="max-h-[80vh] overflow-auto p-3">
                    {suggestions.map((p, i) => {
                      const active = i === activeIdx;
                      return (
                        <li key={p.id} className="mb-3 last:mb-0">
                          <Link
                            to={`/product/${p.id}`}
                            className={`flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-black/5 ${active ? 'bg-black/5' : ''}`}
                            onClick={() => bumpClick(p.id)}
                          >
                            {p.imagesJson?.[0] ? (
                              <img
                                src={p.imagesJson[0]}
                                alt={p.title}
                                className="w-[120px] h-[120px] object-cover rounded-xl border"
                              />
                            ) : (
                              <div className="w-[120px] h-[120px] rounded-xl border grid place-items-center text-base text-gray-500">
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

            <div className="text-sm inline-flex items-center gap-2">
              <ArrowUpDown size={16} className="text-zinc-600" />
              <label className="opacity-70">Sort</label>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="border rounded-xl px-3 py-2 bg-white/90"
              >
                <option value="relevance">Relevance</option>
                <option value="price-asc">Price: Low → High</option>
                <option value="price-desc">Price: High → Low</option>
              </select>
            </div>

            <div className="text-sm inline-flex items-center gap-2">
              <LayoutGrid size={16} className="text-zinc-600" />
              <label className="opacity-70">Per page</label>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) as any)}
                className="border rounded-xl px-3 py-2 bg-white/90"
              >
                <option value={6}>6</option>
                <option value={9}>9</option>
                <option value={12}>12</option>
              </select>
            </div>
          </div>

          {sorted.length === 0 ? (
            <p className="text-sm text-zinc-600">No products match your filters.</p>
          ) : (
            <>
              {/* CHANGED: Force three items per row on large screens */}
              <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {pageItems.map((p) => {
                  const fav = isFav(p.id);
                  return (
                    <motion.article
                      key={p.id}
                      whileHover={{ y: -4 }}
                      className="rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden"
                    >
                      <Link
                        to={`/product/${p.id}`}
                        className="block"
                        onClick={() => bumpClick(p.id)}
                      >
                        {p.imagesJson?.[0] ? (
                          <img
                            src={p.imagesJson[0]}
                            alt={p.title}
                            className="w-full h-48 object-cover"
                          />
                        ) : (
                          <div className="w-full h-48 grid place-items-center text-zinc-400">No image</div>
                        )}
                      </Link>

                      <div className="p-4">
                        <Link to={`/product/${p.id}`} onClick={() => bumpClick(p.id)}>
                          <h3 className="font-semibold text-zinc-900 line-clamp-1">{p.title}</h3>
                          <div className="text-xs text-zinc-500">{p.categoryName || 'Uncategorized'}</div>
                          <p className="text-base mt-1 font-semibold">{ngn.format(Number(p.price) || 0)}</p>
                        </Link>

                        <div className="mt-3 flex items-center justify-between">
                          <button
                            aria-label={fav ? 'Remove from wishlist' : 'Add to wishlist'}
                            className={`inline-flex items-center gap-1 text-sm rounded-full border px-3 py-1.5 transition ${
                              fav
                                ? 'bg-rose-50 text-rose-600 border-rose-200'
                                : 'bg-white hover:bg-zinc-50 text-zinc-700'
                            }`}
                            onClick={() => {
                              if (!token) {
                                openModal({ title: 'Wishlist', message: 'Please login to use the wishlist.' });
                                return;
                              }
                              toggleFav.mutate({ productId: p.id });
                            }}
                            title={fav ? 'Remove from wishlist' : 'Add to wishlist'}
                          >
                            {fav ? <Heart size={16} /> : <HeartOff size={16} />}
                            <span>{fav ? 'Wishlisted' : 'Wishlist'}</span>
                          </button>

                          <Link to="/wishlist" className="text-sm text-fuchsia-700 hover:underline inline-flex items-center gap-1">
                            <Star size={16} /> View list
                          </Link>
                        </div>
                      </div>
                    </motion.article>
                  );
                })}
              </div>

              {/* Pagination */}
              <div className="mt-8 flex items-center justify-between">
                <div className="text-sm text-zinc-600">
                  Showing {start + 1}-{Math.min(start + pageSize, sorted.length)} of {sorted.length} products
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-1.5 border rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50"
                    onClick={() => goTo(currentPage - 1)}
                    disabled={currentPage <= 1}
                  >
                    Prev
                  </button>

                  <span className="text-sm text-zinc-700">
                    Page {currentPage} / {totalPages}
                  </span>

                  <button
                    className="px-3 py-1.5 border rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50"
                    onClick={() => goTo(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
