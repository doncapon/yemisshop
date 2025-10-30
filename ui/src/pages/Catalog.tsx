// src/pages/Catalog.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client.js';
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
  CheckCircle2,
} from 'lucide-react';

/* ---------------- Types ---------------- */
type SupplierOfferLite = {
  id: string;
  isActive?: boolean;
  inStock?: boolean;
};

type Variant = {
  id: string;
  sku?: string | null;
  price?: number | null;
  inStock?: boolean;
  imagesJson?: string[];
  offers?: SupplierOfferLite[];
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
  supplierOffers?: SupplierOfferLite[];
  ratingAvg?: number | null;
  ratingCount?: number | null;
  attributesSummary?: { attribute: string; value: string }[];
  status?: string; // 'LIVE' | ...
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

type PriceBucket = { label: string; min: number; max?: number };
type SortKey = 'relevance' | 'price-asc' | 'price-desc';

/* ---------------- Helpers ---------------- */
const isLive = (x?: { status?: string | null }) =>
  String(x?.status ?? '').trim().toUpperCase() === 'LIVE';

const getBrandName = (p: Product) => (p.brand?.name || p.brandName || '').trim();

const readClicks = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem('productClicks:v1') || '{}') || {};
  } catch {
    return {};
  }
};

const bumpClick = (productId: string) => {
  try {
    const m = readClicks();
    m[productId] = (m[productId] || 0) + 1;
    localStorage.setItem('productClicks:v1', JSON.stringify(m));
  } catch { }
};

const safeNum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : NaN);

function getMinPrice(p: Product): number {
  const base = safeNum(p.price);
  const variantPrices = (p.variants ?? [])
    .map(v => safeNum(v.price))
    .filter(n => Number.isFinite(n) && n > 0) as number[];
  const candidates: number[] = [];
  if (Number.isFinite(base) && base! > 0) candidates.push(base as number);
  candidates.push(...variantPrices);
  return candidates.length ? Math.min(...candidates) : 0;
}

const hasVariantInStock = (p: Product) => (p.variants || []).some(v => v.inStock !== false);
const availableFlag = (p: Product) => (p.inStock !== false) || hasVariantInStock(p);
const availabilityRank = (p: Product) => (availableFlag(p) ? 1 : 0);

const formatN = (n: number) => '₦' + (Number.isFinite(n) ? n : 0).toLocaleString();

function generateDynamicPriceBuckets(maxPrice: number, baseStep = 1_000): PriceBucket[] {
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
    return [
      { label: '₦1,000 – ₦4,999', min: 1_000, max: 4_999 },
      { label: '₦5,000 – ₦9,999', min: 5_000, max: 9_999 },
      { label: '₦10,000 – ₦49,999', min: 10_000, max: 49_999 },
      { label: '₦50,000 – ₦99,999', min: 50_000, max: 99_999 },
      { label: '₦100,000+', min: 100_000 },
    ];
  }
  const thresholds: number[] = [baseStep];
  let mult = 5;
  while (thresholds[thresholds.length - 1] < maxPrice) {
    const next = thresholds[thresholds.length - 1] * mult;
    thresholds.push(next);
    mult = mult === 5 ? 2 : 5;
  }
  const buckets: PriceBucket[] = [];
  for (let i = 0; i < thresholds.length; i++) {
    const start = thresholds[i];
    const next = thresholds[i + 1];
    const end = next ? next - 1 : undefined;
    const label = end ? `${formatN(start)} – ${formatN(end)}` : `${formatN(start)}+`;
    buckets.push({ label, min: start, max: end });
  }
  return buckets;
}
const inBucket = (price: number, b: PriceBucket) =>
  b.max == null ? price >= b.min : price >= b.min && price <= b.max;

/* ---------------- Orders → purchases (for relevance) ---------------- */
type OrdersResp = {
  data?: Array<{
    id: string;
    createdAt?: string;
    items?: Array<{ product?: { id?: string } | null; productId?: string | null; qty?: number | null }>;
  }>;
  totalPages?: number;
};
function usePurchasedCounts() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['orders', 'mine', 'for-recs'],
    enabled: !!token,
    retry: 0,
    staleTime: 30_000,
    queryFn: async () => {
      const PAGE_SIZE = 100;
      let page = 1;
      let totalPages = 1;
      const map: Record<string, number> = {};
      while (page <= totalPages) {
        const { data } = await api.get<OrdersResp>(
          `/api/orders/mine?page=${page}&pageSize=${PAGE_SIZE}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
        );
        const list = Array.isArray(data?.data) ? data!.data! : [];
        for (const o of list) {
          for (const it of o.items || []) {
            const pid = it.product?.id || it.productId || '';
            if (!pid) continue;
            const qty = Number(it.qty || 1);
            map[pid] = (map[pid] || 0) + (Number.isFinite(qty) ? qty : 1);
          }
        }
        totalPages = Math.max(1, Number(data?.totalPages ?? 1));
        page += 1;
        if (page > 50) break;
      }
      return map;
    },
  });
}

/* ---------------- Component ---------------- */
export default function Catalog() {
  const { token } = useAuthStore();
  const qc = useQueryClient();
  const { openModal } = useModal();
  const nav = useNavigate();

  // Fetch LIVE products (server enforces sellable, client double-checks LIVE)
  const productsQ = useQuery<Product[]>({
    queryKey: ['products', { include: 'brand,variants,attributes,offers', status: 'LIVE' }],
    staleTime: 30_000,
    queryFn: async () => {
      // small helper: normalizes server payload -> Product[]
      const normalize = (rawData: any): Product[] => {
        const raw: any[] = Array.isArray(rawData) ? rawData : (Array.isArray(rawData?.data) ? rawData.data : []);
        return (raw || [])
          .filter((x) => x && x.id != null)
          .map((x) => {
            const variants: Variant[] = Array.isArray(x.variants)
              ? x.variants.map((v: any) => ({
                id: String(v.id),
                sku: v.sku ?? null,
                price: Number.isFinite(Number(v.price)) ? Number(v.price) : null,
                inStock: v.inStock !== false,
                imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
                offers: Array.isArray(v.offers) ? v.offers : [],
              }))
              : [];
            return {
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
              variants,
              ratingAvg: Number.isFinite(Number(x.ratingAvg)) ? Number(x.ratingAvg) : null,
              ratingCount: Number.isFinite(Number(x.ratingCount)) ? Number(x.ratingCount) : null,
              attributesSummary: Array.isArray(x.attributesSummary) ? x.attributesSummary : [],
              supplierOffers: Array.isArray(x.supplierOffers) ? x.supplierOffers : [],
              status: (x.status ?? x.state ?? '').toString(),
            } as Product;
          });
      };

      // try LIVE → PUBLISHED → ANY
      const paramsBase = { include: 'brand,variants,attributes,offers' as const };
      const attempts = ['LIVE', 'PUBLISHED', 'ANY'] as const;

      let lastErr: any = null;
      for (const status of attempts) {
        try {
          const { data } = await api.get('/api/products', { params: { ...paramsBase, status } });
          const list = normalize(data);
          // If we fell back to PUBLISHED/ANY, still prefer showing LIVE where possible
          const out = status === 'LIVE' ? list : list.filter((x) => String(x.status).toUpperCase() === 'LIVE') || list;
          return out;
        } catch (e: any) {
          lastErr = e;
          // continue to next attempt
        }
      }
      // if all attempts fail, surface the original error
      throw lastErr ?? new Error('Failed to load products');
    },
  });


  // Favorites
  const favQuery = useQuery({
    queryKey: ['favorites', 'mine'],
    enabled: !!token,
    queryFn: async () => {
      const { data } = await api.get<{ productIds: string[] }>('/api/favorites/mine', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      return new Set(data.productIds || []);
    },
    initialData: new Set<string>(),
  });
  const isFav = (id: string) => !!favQuery.data?.has(id);

  // Toggle favorite
  const toggleFav = useMutation({
    mutationFn: async ({ productId }: { productId: string }) => {
      const { data } = await api.post<{ favorited: boolean }>(
        '/api/favorites/toggle',
        { productId },
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
      );
      return { productId, favorited: !!data.favorited };
    },
    onMutate: async ({ productId }) => {
      const key = ['favorites', 'mine'] as const;
      const prev = qc.getQueryData<Set<string>>(key);
      if (prev) {
        const next = new Set(prev);
        next.has(productId) ? next.delete(productId) : next.add(productId);
        qc.setQueryData(key, next);
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['favorites', 'mine'], ctx.prev);
      openModal({ title: 'Wishlist', message: 'Could not update wishlist. Please try again.' });
    },
  });

  /* -------- Quick Add-to-Cart (only simple products here) -------- */
  const addToCart = (p: Product) => {
    try {
      const unit = getMinPrice(p);
      if (!Number.isFinite(unit) || unit <= 0) {
        openModal({ title: 'Cart', message: 'This product has no valid price yet.' });
        return;
      }
      const primaryImg =
        p.imagesJson?.[0] ||
        p.variants?.find(v => Array.isArray(v.imagesJson) && v.imagesJson[0])?.imagesJson?.[0] ||
        null;

      const raw = localStorage.getItem('cart');
      const cart: any[] = raw ? JSON.parse(raw) : [];

      const idx = cart.findIndex((x: any) => x.productId === p.id && (!x.variantId || x.variantId === null));
      if (idx >= 0) {
        const qty = Math.max(1, Number(cart[idx].qty) || 1) + 1;
        cart[idx] = {
          ...cart[idx],
          title: p.title,
          qty,
          unitPrice: unit,
          totalPrice: unit * qty,
          price: unit,
          image: primaryImg ?? cart[idx].image ?? null,
        };
      } else {
        cart.push({
          productId: p.id,
          variantId: null,
          title: p.title,
          qty: 1,
          unitPrice: unit,
          totalPrice: unit,
          price: unit,
          selectedOptions: [],
          image: primaryImg,
        });
      }

      localStorage.setItem('cart', JSON.stringify(cart));
      openModal({ title: 'Cart', message: 'Added to cart.' });
    } catch {
      openModal({ title: 'Cart', message: 'Could not add to cart.' });
    }
  };

  /* ---------------- UI state ---------------- */
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedBucketIdxs, setSelectedBucketIdxs] = useState<number[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [onlyInStock, setOnlyInStock] = useState<boolean>(false);
  const [sortKey, setSortKey] = useState<SortKey>('relevance');

  const [query, setQuery] = useState('');
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestRef = useRef<HTMLDivElement | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<6 | 9 | 12>(9);

  const products = useMemo(() => productsQ.data ?? [], [productsQ.data]);

  const maxPriceSeen = useMemo(() => {
    const prices = (products ?? []).map(getMinPrice).filter(n => Number.isFinite(n) && n > 0) as number[];
    return prices.length ? Math.max(...prices) : 0;
  }, [products]);

  const PRICE_BUCKETS = useMemo(() => generateDynamicPriceBuckets(maxPriceSeen, 1_000), [maxPriceSeen]);

  useEffect(() => {
    // If the bucket set changes (dataset changed), clear selections to avoid stale indexes
    setSelectedBucketIdxs([]);
  }, [PRICE_BUCKETS.length]);

  const norm = (s: string) =>
    s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const suggestions = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return [];
    const scored = products.map((p) => {
      const title = norm(p.title || '');
      const desc = norm(p.description || '');
      const cat = norm(p.categoryName || '');
      const brand = norm(getBrandName(p));
      let score = 0;
      if (title.startsWith(q)) score += 4;
      else if (title.includes(q)) score += 3;
      if (desc.includes(q)) score += 1;
      if (cat.includes(q)) score += 2;
      if (brand.includes(q)) score += 2;
      return { p, score };
    });
    return scored
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(x => x.p);
  }, [products, query]);

  /* -------- FACETS + FILTERING -------- */
  const { categories, brands, visiblePriceBuckets, filtered } = useMemo(() => {
    const q = norm(query.trim());
    const baseByQuery = products.filter((p) => {
      if (!q) return true;
      const title = norm(p.title || '');
      const desc = norm(p.description || '');
      const cat = norm(p.categoryName || '');
      const brand = norm(getBrandName(p));
      return title.includes(q) || desc.includes(q) || cat.includes(q) || brand.includes(q);
    });

    const activeCats = new Set(selectedCategories);
    const activeBuckets = selectedBucketIdxs.map(i => PRICE_BUCKETS[i]).filter(Boolean);
    const activeBrands = new Set(selectedBrands);

    // Category counts
    const baseForCategoryCounts = baseByQuery.filter((p) => {
      const priceOk = activeBuckets.length === 0 ? true : activeBuckets.some(b => inBucket(getMinPrice(p), b));
      const brandOk = activeBrands.size === 0 ? true : activeBrands.has(getBrandName(p));
      const stockOk = onlyInStock ? availableFlag(p) : true;
      return priceOk && brandOk && stockOk;
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
      .filter(c => c.count > 0)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    // Brand counts
    const baseForBrandCounts = baseByQuery.filter((p) => {
      const priceOk = activeBuckets.length === 0 ? true : activeBuckets.some(b => inBucket(getMinPrice(p), b));
      const catOk = activeCats.size === 0 ? true : activeCats.has(p.categoryId ?? 'uncategorized');
      const stockOk = onlyInStock ? availableFlag(p) : true;
      return priceOk && catOk && stockOk;
    });
    const brandMap = new Map<string, { name: string; count: number }>();
    for (const p of baseForBrandCounts) {
      const name = getBrandName(p);
      if (!name) continue;
      brandMap.set(name, { name, count: (brandMap.get(name)?.count || 0) + 1 });
    }
    const brands = Array.from(brandMap.values())
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    // Price bucket counts
    const baseForPriceCounts = baseByQuery.filter((p) => {
      const catOk = activeCats.size === 0 ? true : activeCats.has(p.categoryId ?? 'uncategorized');
      const brandOk = activeBrands.size === 0 ? true : activeBrands.has(getBrandName(p));
      const stockOk = onlyInStock ? availableFlag(p) : true;
      return catOk && brandOk && stockOk;
    });
    const priceCounts = PRICE_BUCKETS.map((b) =>
      baseForPriceCounts.filter(p => inBucket(getMinPrice(p), b)).length
    );
    const visiblePriceBuckets = PRICE_BUCKETS
      .map((b, i) => ({ bucket: b, idx: i, count: priceCounts[i] || 0 }))
      .filter(x => x.count > 0);

    // Final filtered list
    const filteredCore = baseByQuery.filter((p) => {
      const catOk = activeCats.size === 0 ? true : activeCats.has(p.categoryId ?? 'uncategorized');
      const priceOk = activeBuckets.length === 0 ? true : activeBuckets.some(b => inBucket(getMinPrice(p), b));
      const brandOk = activeBrands.size === 0 ? true : activeBrands.has(getBrandName(p));
      const stockOk = onlyInStock ? availableFlag(p) : true;
      return catOk && priceOk && brandOk && stockOk;
    });

    return { categories, brands, visiblePriceBuckets, filtered: filteredCore };
  }, [products, selectedCategories, selectedBucketIdxs, selectedBrands, onlyInStock, query, PRICE_BUCKETS]);

  /* -------- Sorting -------- */
  const purchasedQ = usePurchasedCounts();

  const recScored = useMemo(() => {
    if (sortKey !== 'relevance') return filtered;
    const purchased: Record<string, number> = purchasedQ.data ?? {};
    const clicks = readClicks();

    return filtered
      .map((p) => {
        const buy = Math.log1p(purchased[p.id] || 0);
        const clk = Math.log1p(clicks[p.id] || 0);
        const score = 2.5 * buy + 1.5 * clk;
        return { p, score };
      })
      .sort((a, b) => {
        // Stock first
        const av = availabilityRank(a.p), bv = availabilityRank(b.p);
        if (bv !== av) return bv - av;
        // Then score
        if (b.score !== a.score) return b.score - a.score;
        // Tie-breaker: “popularity” & lower price
        const ap = (purchasedQ.data?.[a.p.id] || 0) + (readClicks()[a.p.id] || 0);
        const bp = (purchasedQ.data?.[b.p.id] || 0) + (readClicks()[b.p.id] || 0);
        if (bp !== ap) return bp - ap;
        return getMinPrice(a.p) - getMinPrice(b.p);
      })
      .map(x => x.p);
  }, [filtered, sortKey, purchasedQ.data]);

  const sorted = useMemo(() => {
    if (sortKey === 'relevance') return recScored;
    const arr = [...filtered].sort((a, b) => {
      const av = availabilityRank(a), bv = availabilityRank(b);
      if (bv !== av) return bv - av;
      if (sortKey === 'price-asc') return getMinPrice(a) - getMinPrice(b);
      if (sortKey === 'price-desc') return getMinPrice(b) - getMinPrice(a);
      return 0;
    });
    return arr;
  }, [filtered, recScored, sortKey]);

  useEffect(() => {
    setPage(1);
  }, [selectedCategories, selectedBucketIdxs, selectedBrands, onlyInStock, pageSize, sortKey, query]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = sorted.slice(start, start + pageSize);

  // click outside to close suggestions
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        suggestRef.current && !suggestRef.current.contains(t) &&
        inputRef.current && !inputRef.current.contains(t)
      ) {
        setShowSuggest(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  if (productsQ.isLoading) return <p className="p-6">Loading…</p>;
  if (productsQ.error) return <p className="p-6 text-rose-600">Error loading products</p>;

  const toggleCategory = (id: string) =>
    setSelectedCategories(curr => (curr.includes(id) ? curr.filter(x => x !== id) : [...curr, id]));
  const toggleBucket = (idx: number) =>
    setSelectedBucketIdxs(curr => (curr.includes(idx) ? curr.filter(i => i !== idx) : [...curr, idx]));
  const toggleBrand = (name: string) =>
    setSelectedBrands(curr => (curr.includes(name) ? curr.filter(n => n !== name) : [...curr, name]));
  const clearFilters = () => {
    setSelectedCategories([]);
    setSelectedBucketIdxs([]);
    setSelectedBrands([]);
    setOnlyInStock(false);
  };
  const goTo = (p: number) => {
    const clamped = Math.min(Math.max(1, p), totalPages);
    setPage(clamped);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const Shimmer = () => <div className="h-3 w-full rounded bg-gradient-to-r from-zinc-200 via-zinc-100 to-zinc-200 animate-pulse" />;

  return (
    <div className="max-w-screen-2xl mx-auto min-h-screen">
      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700">
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,0,167,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,204,255,0.25),transparent_60%)]" />
        <div className="relative px-4 md:px-8 pt-10 pb-8">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <motion.h1 initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-2xl md:text-3xl font-bold tracking-tight text-white">
                Discover Products <Sparkles className="inline text-white ml-1" size={22} />
              </motion.h1>
              <p className="text-sm text-white/80">Fresh picks, smart sorting, and instant search—tailored for you.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="md:flex md:items-start md:gap-8 px-4 md:px-8 pb-10">
        {/* LEFT: Filters */}
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
              {(selectedCategories.length > 0 ||
                selectedBucketIdxs.length > 0 ||
                selectedBrands.length > 0 ||
                onlyInStock) && (
                  <button className="text-sm text-fuchsia-700 hover:underline" onClick={clearFilters}>
                    Clear all
                  </button>
                )}
            </div>

            {/* Availability */}
            <div className="mb-4">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} />
                <span className="text-zinc-800">In stock only</span>
              </label>
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
                        className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${checked ? 'bg-zinc-900 text-white' : 'bg-white/80 hover:bg-black/5 text-zinc-800'
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

            {/* Brands */}
            {brands.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <h4 className="text-sm font-semibold text-zinc-800">Brands</h4>
                  <button
                    className="text-xs text-zinc-600 hover:underline disabled:opacity-40"
                    onClick={() => setSelectedBrands([])}
                    disabled={selectedBrands.length === 0}
                  >
                    Reset
                  </button>
                </div>
                <ul className="space-y-2">
                  {brands.map((b) => {
                    const checked = selectedBrands.includes(b.name);
                    return (
                      <li key={b.name}>
                        <button
                          onClick={() => toggleBrand(b.name)}
                          className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${checked ? 'bg-zinc-900 text-white' : 'bg-white/80 hover:bg-black/5 text-zinc-800'
                            }`}
                        >
                          <span className="truncate">{b.name}</span>
                          <span className={`ml-2 text-xs ${checked ? 'text-white/90' : 'text-zinc-600'}`}>({b.count})</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

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
                        className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${checked ? 'bg-zinc-900 text-white' : 'bg-white/80 hover:bg-black/5 text-zinc-800'
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
            <h2 className="text-2xl font-semibold text-zinc-900">Products</h2>
          </div>

          {/* Search / Sort / Per page */}
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
                  placeholder="Search products, brands, or categories…"
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
                      const minPrice = getMinPrice(p);
                      return (
                        <li key={p.id} className="mb-3 last:mb-0">
                          <Link
                            to={`/product/${p.id}`}
                            className={`flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-black/5 ${active ? 'bg-black/5' : ''}`}
                            onClick={() => bumpClick(p.id)}
                          >
                            {p.imagesJson?.[0] ? (
                              <img src={p.imagesJson[0]} alt={p.title} className="w-[120px] h-[120px] object-cover rounded-xl border" />
                            ) : (
                              <div className="w-[120px] h-[120px] rounded-xl border grid place-items-center text-base text-gray-500">—</div>
                            )}
                            <div className="min-w-0">
                              <div className="text-lg font-semibold truncate">{p.title}</div>
                              <div className="text-sm opacity-80 truncate">
                                {ngn.format(minPrice)} {p.categoryName ? `• ${p.categoryName}` : ''} {getBrandName(p) ? `• ${getBrandName(p)}` : ''}
                              </div>
                              {p.description && <div className="text-sm opacity-70 line-clamp-2 mt-1">{p.description}</div>}
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
                onChange={(e) => setPageSize(Number(e.target.value) as 6 | 9 | 12)}
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
              <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {pageItems.map((p) => {
                  const fav = isFav(p.id);
                  const minPrice = getMinPrice(p);
                  const brand = getBrandName(p);
                  const primaryImg = p.imagesJson?.[0];
                  const hoverImg = p.imagesJson?.[1] || p.variants?.[0]?.imagesJson?.[0];
                  const available = availableFlag(p);

                  const needsOptions = Array.isArray(p.variants) && p.variants.length > 0;

                  return (
                    <motion.article
                      key={p.id}
                      whileHover={{ y: -4 }}
                      className="group rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden"
                    >
                      <Link to={`/product/${p.id}`} className="block" onClick={() => bumpClick(p.id)}>
                        <div className="relative w-full h-48 overflow-hidden">
                          {primaryImg ? (
                            <>
                              <img src={primaryImg} alt={p.title} className="w-full h-48 object-cover transition-opacity duration-300 opacity-100 group-hover:opacity-0" />
                              {hoverImg && (
                                <img src={hoverImg} alt={`${p.title} alt`} className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 opacity-0 group-hover:opacity-100" />
                              )}
                            </>
                          ) : (
                            <div className="w-full h-48 grid place-items-center text-zinc-400">No image</div>
                          )}

                          <span
                            className={`absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${available
                                ? 'bg-emerald-600/10 text-emerald-700 border border-emerald-600/20'
                                : 'bg-rose-600/10 text-rose-700 border border-rose-600/20'
                              }`}
                          >
                            <CheckCircle2 size={12} />
                            {available ? 'In stock' : 'Out of stock'}
                          </span>
                        </div>
                      </Link>

                      <div className="p-4">
                        <Link to={`/product/${p.id}`} onClick={() => bumpClick(p.id)}>
                          <h3 className="font-semibold text-zinc-900 line-clamp-1">{p.title}</h3>
                          <div className="text-xs text-zinc-500 line-clamp-1">
                            {brand ? <>{brand} • </> : null}
                            {p.categoryName || 'Uncategorized'}
                          </div>
                          <p className="text-base mt-1 font-semibold">{ngn.format(minPrice)}</p>
                          {Array.isArray(p.variants) && p.variants.length > 0 && Number.isFinite(Number(p.price)) && minPrice < Number(p.price) && (
                            <div className="text-[11px] text-zinc-500">From variants</div>
                          )}
                        </Link>

                        {Number(p.ratingCount) > 0 && (
                          <div className="mt-2 text-[12px] text-amber-700 inline-flex items-center gap-1">
                            <Star size={14} />
                            <span>{Number(p.ratingAvg).toFixed(1)} ({p.ratingCount})</span>
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between">
                          <button
                            aria-label={fav ? 'Remove from wishlist' : 'Add to wishlist'}
                            className={`inline-flex items-center gap-1 text-sm rounded-full border px-3 py-1.5 transition ${fav ? 'bg-rose-50 text-rose-600 border-rose-200' : 'bg-white hover:bg-zinc-50 text-zinc-700'
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

                          {needsOptions ? (
                            <Link
                              to={`/product/${p.id}`}
                              className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm border bg-zinc-500 text-white border-zinc-900 hover:opacity-90"
                              onClick={() => bumpClick(p.id)}
                              aria-label="Choose options"
                              title="Choose options"
                            >
                              Choose options
                            </Link>
                          ) : (
                            <button
                              disabled={!available}
                              onClick={() => addToCart(p)}
                              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm border transition ${available ? 'bg-zinc-900 text-white border-zinc-900 hover:opacity-90'
                                  : 'bg-white text-zinc-400 border-zinc-200 cursor-not-allowed'
                                }`}
                              aria-label="Add to cart"
                              title="Add to cart"
                            >
                              Add to cart
                            </button>
                          )}
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
                    type="button"
                    className="px-3 py-1.5 border rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50"
                    onClick={() => goTo(currentPage - 1)}
                    disabled={currentPage <= 1}
                    aria-label="Previous page"
                  >
                    Prev
                  </button>

                  <span className="text-sm text-zinc-700" role="status" aria-live="polite">
                    Page {currentPage} / {totalPages}
                  </span>

                  <button
                    type="button"
                    className="px-3 py-1.5 border rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50"
                    onClick={() => goTo(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    aria-label="Next page"
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
