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
import SiteLayout from '../layouts/SiteLayout.js';
import { showMiniCartToast } from '../components/cart/MiniCartToast';

/* ---------------- Types ---------------- */

type SupplierOfferLite = {
  id: string;
  isActive?: boolean;
  inStock?: boolean;
  availableQty?: number | null;
  price?: number | null; // not used for retail display (kept for compatibility)
};

type Variant = {
  id: string;
  sku?: string | null;
  price?: number | null; // ✅ retail price (variant retailPrice/retailBasePrice)
  inStock?: boolean | null;
  imagesJson?: string[];
  offers?: SupplierOfferLite[]; // availability only
};

type Product = {
  id: string;
  title: string;
  description?: string;

  price?: number | null; // ✅ retail price (product retailPrice/retailBasePrice)
  offersFrom?: number | null; // kept for compatibility, NOT shown in UI

  inStock?: boolean | null;
  imagesJson?: string[];

  categoryId?: string | null;
  categoryName?: string | null;

  brandName?: string | null;
  brand?: { id: string; name: string } | null;

  variants?: Variant[];
  supplierOffers?: SupplierOfferLite[]; // availability only

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

/* ---------------- Helpers: generic ---------------- */

const isLive = (x?: { status?: string | null }) =>
  String(x?.status ?? '').trim().toUpperCase() === 'LIVE';

const getBrandName = (p: Product) => (p.brand?.name || p.brandName || '').trim();

/** Safe bool: only true if explicitly true */
const trueOnly = (v: any) => v === true;

/** Safe number → NaN if invalid */
const nnum = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** Any active + inStock offer */
const hasActiveInStockOffer = (offers?: SupplierOfferLite[]) =>
  Array.isArray(offers) && offers.some((o) => trueOnly(o.isActive) && trueOnly(o.inStock));

/* ---------------- Helpers: stock model ---------------- */

function sumActivePositiveQty(offers?: SupplierOfferLite[]): number {
  let sum = 0;
  if (!Array.isArray(offers)) return sum;

  for (const o of offers) {
    if (!o || o.isActive === false) continue;
    const q = Number(o.availableQty);
    if (Number.isFinite(q) && q > 0) sum += q;
  }
  return sum;
}

function collectAllOffers(p: Product): SupplierOfferLite[] {
  const out: SupplierOfferLite[] = [];
  if (Array.isArray(p.supplierOffers)) out.push(...p.supplierOffers);
  if (Array.isArray(p.variants)) {
    for (const v of p.variants) if (Array.isArray(v.offers)) out.push(...v.offers);
  }
  return out;
}

function computeAvailableNowFromOffers(
  directInStock: boolean,
  directOffers?: SupplierOfferLite[],
  variantLike?: { inStock?: boolean | null; offers?: SupplierOfferLite[] }[]
): boolean {
  const allOffers: SupplierOfferLite[] = [];
  if (Array.isArray(directOffers)) allOffers.push(...directOffers);
  if (Array.isArray(variantLike)) {
    for (const v of variantLike) if (Array.isArray(v.offers)) allOffers.push(...v.offers);
  }

  let hasAnyQtySignal = false;
  let hasPositive = false;
  let hasUnknown = false;

  for (const o of allOffers) {
    if (!o || o.isActive === false) continue;
    const q = o.availableQty;
    if (q == null || !Number.isFinite(Number(q))) {
      hasUnknown = true;
      continue;
    }
    hasAnyQtySignal = true;
    const qNum = Number(q);
    if (qNum > 0) hasPositive = true;
  }

  if (hasPositive) return true;

  if (hasAnyQtySignal && !hasUnknown) return false;

  // fallback to inStock flags
  if (directInStock) return true;
  if (Array.isArray(directOffers) && hasActiveInStockOffer(directOffers)) return true;

  if (Array.isArray(variantLike)) {
    for (const v of variantLike) {
      if (v.inStock === true || hasActiveInStockOffer(v.offers)) return true;
    }
  }

  return false;
}

function variantAvailableNow(v?: Variant): boolean {
  if (!v) return false;
  return computeAvailableNowFromOffers(v.inStock === true, v.offers, []);
}

function availableNow(p: Product): boolean {
  return computeAvailableNowFromOffers(p.inStock === true, p.supplierOffers, p.variants ?? []);
}

/* ---------------- Helpers: pricing model (retail only) ---------------- */

/**
 * Display price is retail only:
 * - product.price (retail)
 * - variant.price (retail) if variant available
 * Offers do NOT drive display price.
 */
function getBasePrice(p: Product): number | null {
  const base = nnum(p.price);
  return Number.isFinite(base) && base > 0 ? base : null;
}

function getMinPrice(p: Product): number {
  const basePrice = getBasePrice(p);
  const prices: number[] = [];

  if (basePrice !== null) prices.push(basePrice);

  if (Array.isArray(p.variants)) {
    for (const v of p.variants) {
      if (!variantAvailableNow(v)) continue;
      const vp = nnum(v.price);
      if (Number.isFinite(vp) && vp > 0) prices.push(vp);
    }
  }

  return prices.length ? Math.min(...prices) : 0;
}

/** Min retail price ignoring availability (so OOS can still be priced & bucketed) */
function getMinPriceAny(p: Product): number {
  const prices: number[] = [];

  const basePrice = getBasePrice(p);
  if (basePrice !== null) prices.push(basePrice);

  if (Array.isArray(p.variants)) {
    for (const v of p.variants) {
      const vp = nnum(v.price);
      if (Number.isFinite(vp) && vp > 0) prices.push(vp);
    }
  }

  return prices.length ? Math.min(...prices) : 0;
}

function productSellable(p: Product): boolean {
  if (!isLive(p)) return false;
  if (!availableNow(p)) return false;
  const minPrice = getMinPrice(p);
  return Number.isFinite(minPrice) && minPrice > 0;
}

/* ---------------- Analytics clicks ---------------- */

const readClicks = (): Record<string, number> => {
  try {
    const raw = localStorage.getItem('productClicks:v1');
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch {
    return {};
  }
};

const bumpClick = (productId: string) => {
  try {
    const m = readClicks();
    m[productId] = (m[productId] || 0) + 1;
    localStorage.setItem('productClicks:v1', JSON.stringify(m));
  } catch {
    // ignore
  }
};

/* ---------------- Cart helpers ---------------- */

function readCart(): Array<{ productId: string; variantId?: string | null; qty: number }> {
  try {
    const raw = localStorage.getItem('cart');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function qtyInCart(productId: string, variantId: string | null): number {
  const cart = readCart();
  return cart
    .filter((x) => x.productId === productId && (variantId ? x.variantId === variantId : !x.variantId))
    .reduce((s, x) => s + Math.max(0, Number(x.qty) || 0), 0);
}

/* ---------------- Purchased counts (for relevance sort) ---------------- */

function usePurchasedCounts(enabledOverride = true) {
  const token = useAuthStore((s) => s.token);

  return useQuery<Record<string, number>>({
    queryKey: ['orders', 'mine', 'purchased-counts'],
    enabled: !!token && enabledOverride,
    retry: 0,
    staleTime: 30_000,
    queryFn: async () => {
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const LIMIT = 200;

      try {
        const { data } = await api.get('/api/orders/mine', { headers, params: { limit: LIMIT } });

        const orders: any[] = Array.isArray((data as any)?.data)
          ? (data as any).data
          : Array.isArray(data)
            ? (data as any)
            : [];

        const map: Record<string, number> = {};

        for (const o of orders) {
          const items: any[] = Array.isArray(o?.items) ? o.items : [];
          for (const it of items) {
            const pid = it?.productId || it?.product?.id || '';
            if (!pid) continue;
            const qtyRaw = it?.quantity ?? it?.qty ?? 1;
            const qty = Number(qtyRaw);
            map[pid] = (map[pid] || 0) + (Number.isFinite(qty) ? qty : 1);
          }
        }

        return map;
      } catch (e: any) {
        const status = e?.response?.status;
        const msg = e?.response?.data || e?.message;
        console.error('usePurchasedCounts /api/orders/mine failed:', status, msg);
        return {};
      }
    },
  });
}

/* ---------------- Price filters ---------------- */

const formatN = (n: number) => '₦' + (Number.isFinite(n) ? n : 0).toLocaleString();

type PriceBucket = { label: string; min: number; max?: number };
type SortKey = 'relevance' | 'price-asc' | 'price-desc';

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

/* ---------------- Component ---------------- */

export default function Catalog() {
  const { token } = useAuthStore();
  const user = useAuthStore((s) => s.user);
  const isSupplier = user?.role === 'SUPPLIER';

  const { openModal } = useModal();
  const nav = useNavigate();
  const qc = useQueryClient(); // ✅ must exist before mutations using it

  // Keep your behavior: hide non-sellable products in catalogue.
  // If you later want to SHOW pending/out-of-stock but disable purchase, set this to false.
  const HIDE_OOS = false;

  // ✅ include category in both queryKey and request
  const includeStr = 'brand,category,variants,attributes,offers' as const;

  /* ---------------- UI state ---------------- */

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedBucketIdxs, setSelectedBucketIdxs] = useState<number[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('relevance');

  const [query, setQuery] = useState('');
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestRef = useRef<HTMLDivElement | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  // ✅ default checked (in-stock only)
  const [inStockOnly, setInStockOnly] = useState(true);

  // Pin OOS to bottom when we are not filtering them out
  const stockRank = (p: Product) => (availableNow(p) ? 0 : 1); // 0=in stock, 1=OOS

  // ✅ price used for buckets/filtering
  const priceForFiltering = (p: Product) => {
    if (inStockOnly) return getMinPrice(p);
    return availableNow(p) ? getMinPrice(p) : getMinPriceAny(p);
  };

  // Fetch products (prefer LIVE, fallback if needed)
  const productsQ = useQuery<Product[]>({
    queryKey: ['products', { include: includeStr, status: 'LIVE' }],
    staleTime: 30_000,
    queryFn: async () => {
      const normalize = (rawData: any): Product[] => {
        const raw: any[] = Array.isArray(rawData)
          ? rawData
          : Array.isArray(rawData?.data)
            ? rawData.data
            : [];

        return (raw || [])
          .filter((x) => x && x.id != null)
          .map((x) => {
            // ✅ retail-only mapping (prefer retailPrice/retailBasePrice)
            const productRetail =
              Number.isFinite(Number((x as any).retailPrice))
                ? Number((x as any).retailPrice)
                : Number.isFinite(Number((x as any).retailBasePrice))
                  ? Number((x as any).retailBasePrice)
                  : Number.isFinite(Number((x as any).price))
                    ? Number((x as any).price)
                    : null;

            const variants: Variant[] = Array.isArray(x.variants)
              ? x.variants.map((v: any) => {
                const variantRetail =
                  Number.isFinite(Number(v.retailPrice))
                    ? Number(v.retailPrice)
                    : Number.isFinite(Number(v.retailBasePrice))
                      ? Number(v.retailBasePrice)
                      : Number.isFinite(Number(v.price))
                        ? Number(v.price)
                        : null;

                return {
                  id: String(v.id),
                  sku: v.sku ?? null,
                  price: variantRetail,
                  inStock: v.inStock === true,
                  imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
                  offers: Array.isArray(v.offers)
                    ? v.offers.map((o: any) => ({
                      id: String(o.id),
                      isActive: o.isActive === true,
                      inStock: o.inStock === true,
                      availableQty: Number.isFinite(Number(o.availableQty))
                        ? Number(o.availableQty)
                        : null,
                      price: null,
                    }))
                    : [],
                };
              })
              : [];

            const supplierOffers: SupplierOfferLite[] = Array.isArray(x.supplierOffers)
              ? x.supplierOffers.map((o: any) => ({
                id: String(o.id),
                isActive: o.isActive === true,
                inStock: o.inStock === true,
                availableQty: Number.isFinite(Number(o.availableQty)) ? Number(o.availableQty) : null,
                price: null,
              }))
              : [];

            // ✅ category name
            const catNameRaw = (x.categoryName ?? x.category?.name ?? x.category?.title ?? '')
              .toString()
              .trim();
            const categoryName = catNameRaw || null;

            return {
              id: String(x.id),
              title: String(x.title ?? ''),
              description: x.description ?? '',
              price: productRetail,
              offersFrom: Number.isFinite(Number(x.offersFrom)) ? Number(x.offersFrom) : null,
              inStock: x.inStock === true,
              imagesJson: Array.isArray(x.imagesJson) ? x.imagesJson : [],
              categoryId: x.categoryId ?? x.category?.id ?? null,
              categoryName,
              brandName: x.brandName ?? x.brand?.name ?? null,
              brand: x.brand ? { id: String(x.brand.id), name: String(x.brand.name) } : null,
              variants,
              ratingAvg: Number.isFinite(Number(x.ratingAvg)) ? Number(x.ratingAvg) : null,
              ratingCount: Number.isFinite(Number(x.ratingCount)) ? Number(x.ratingCount) : null,
              attributesSummary: Array.isArray(x.attributesSummary) ? x.attributesSummary : [],
              supplierOffers,
              status: (x.status ?? x.state ?? '').toString(),
            } as Product;
          });
      };

      const paramsBase = { include: includeStr };
      const attempts = ['LIVE', 'PUBLISHED', 'ANY'] as const;

      let lastErr: any = null;
      for (const status of attempts) {
        try {
          const { data } = await api.get('/api/products', { params: { ...paramsBase, status } });
          const list = normalize(data);

          // If backend doesn't support LIVE filter, keep only LIVE when possible
          const out = status === 'LIVE' ? list : list.filter((x) => isLive({ status: x.status }));
          return out.length ? out : list;
        } catch (e: any) {
          lastErr = e;
        }
      }
      throw lastErr ?? new Error('Failed to load products');
    },
  });

  const products = useMemo(() => {
    const list = productsQ.data ?? [];
    return list.filter((p) => isLive(p));
  }, [productsQ.data]);

  // Favorites (disable for suppliers)
  const favQuery = useQuery({
    queryKey: ['favorites', 'mine'],
    enabled: !!token && !isSupplier,
    queryFn: async () => {
      const { data } = await api.get<{ productIds: string[] }>('/api/favorites/mine', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      return new Set(data.productIds || []);
    },
    initialData: new Set<string>(),
  });

  const isFav = (id: string) => !!favQuery.data?.has(id);

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
        if (next.has(productId)) next.delete(productId);
        else next.add(productId);
        qc.setQueryData(key, next);
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['favorites', 'mine'], ctx.prev);
      openModal({ title: 'Wishlist', message: 'Could not update wishlist. Please try again.' });
    },
  });

  /* -------- Quick Add-to-Cart (simple products only) -------- */

  const [cartVersion, setCartVersion] = useState(0);

  const setCartQty = (p: Product, nextQty: number) => {
    try {
      const unit = getBasePrice(p) ?? 0;
      if (!(unit > 0) && nextQty > 0) {
        openModal({ title: 'Cart', message: 'This product has no retail price yet.' });
        return;
      }

      // ✅ block purchase unless LIVE + available + has retail price
      if (!productSellable(p) && nextQty > 0) {
        openModal({ title: 'Cart', message: 'This product is not currently available.' });
        return;
      }

      nextQty = Math.max(0, Math.floor(Number(nextQty) || 0));

      const allOffers = collectAllOffers(p);
      const totalAvailable = sumActivePositiveQty(allOffers) || null;

      if (totalAvailable != null && nextQty > totalAvailable) {
        openModal({
          title: 'Stock limit',
          message: `Only ${totalAvailable} unit${totalAvailable === 1 ? '' : 's'} available for this product.`,
        });
        nextQty = totalAvailable;
      }

      const raw = localStorage.getItem('cart');
      const cart: any[] = raw ? JSON.parse(raw) : [];

      const primaryImg =
        p.imagesJson?.[0] ||
        p.variants?.find((v) => Array.isArray(v.imagesJson) && v.imagesJson[0])?.imagesJson?.[0] ||
        null;

      const idx = cart.findIndex((x: any) => x.productId === p.id && (!x.variantId || x.variantId === null));
      const prevQty = idx >= 0 ? Math.max(0, Number(cart[idx]?.qty) || 0) : 0;

      if (nextQty === 0) {
        if (idx >= 0) cart.splice(idx, 1);
      } else {
        if (idx >= 0) {
          cart[idx] = {
            ...cart[idx],
            title: p.title,
            qty: nextQty,
            unitPrice: unit,
            totalPrice: unit * nextQty,
            price: unit,
            image: primaryImg ?? cart[idx].image ?? null,
          };
        } else {
          cart.push({
            productId: p.id,
            variantId: null,
            title: p.title,
            qty: nextQty,
            unitPrice: unit,
            totalPrice: unit * nextQty,
            price: unit,
            selectedOptions: [],
            image: primaryImg,
          });
        }
      }

      localStorage.setItem('cart', JSON.stringify(cart));
      setCartVersion((v) => v + 1);

      // ✅ show mini-cart toast only when quantity increased (Add / +)
      if (nextQty > prevQty) {
        showMiniCartToast(cart, { productId: p.id, variantId: null }, { title: 'Added to cart' });
      }
    } catch (err) {
      console.error(err);
      openModal({ title: 'Cart', message: 'Could not update cart.' });
    }
  };

  /* ---------------- Buckets ---------------- */

  const maxPriceSeen = useMemo(() => {
    const prices = (products ?? [])
      .map((p) => priceForFiltering(p))
      .filter((n) => Number.isFinite(n) && n > 0) as number[];
    return prices.length ? Math.max(...prices) : 0;
  }, [products, inStockOnly]);

  const PRICE_BUCKETS = useMemo(() => generateDynamicPriceBuckets(maxPriceSeen, 1_000), [maxPriceSeen]);

  useEffect(() => {
    setSelectedBucketIdxs([]);
  }, [PRICE_BUCKETS.length]);

  const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

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
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.p);
  }, [products, query]);

  /* -------- FACETS + FILTERING -------- */

  const { categories, brands, visiblePriceBuckets, filtered } = useMemo(() => {
    const q = norm(query.trim());

    const baseByQuery = products.filter((p) => {
      if (inStockOnly && !availableNow(p)) return false;

      if (!q) return true;
      const title = norm(p.title || '');
      const desc = norm(p.description || '');
      const cat = norm(p.categoryName || '');
      const brand = norm(getBrandName(p));
      return title.includes(q) || desc.includes(q) || cat.includes(q) || brand.includes(q);
    });

    const activeCats = new Set(selectedCategories);
    const activeBuckets = selectedBucketIdxs.map((i) => PRICE_BUCKETS[i]).filter(Boolean);
    const activeBrands = new Set(selectedBrands);

    const baseForCategoryCounts = baseByQuery.filter((p) => {
      const price = priceForFiltering(p);
      const priceOk = activeBuckets.length === 0 ? true : activeBuckets.some((b) => inBucket(price, b));
      const brandOk = activeBrands.size === 0 ? true : activeBrands.has(getBrandName(p));
      return priceOk && brandOk;
    });

    const catMap = new Map<string, { id: string; name: string; count: number }>();
    for (const p of baseForCategoryCounts) {
      const id = p.categoryId ?? 'uncategorized';
      const name = p.categoryName?.trim() || 'Uncategorized';
      const prev = catMap.get(id) ?? { id, name, count: 0 };
      prev.count += 1;
      catMap.set(id, prev);
    }

    const categories = Array.from(catMap.values())
      .filter((c) => c.count > 0)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const baseForBrandCounts = baseByQuery.filter((p) => {
      const price = priceForFiltering(p);
      const priceOk = activeBuckets.length === 0 ? true : activeBuckets.some((b) => inBucket(price, b));
      const catOk = activeCats.size === 0 ? true : activeCats.has(p.categoryId ?? 'uncategorized');
      return priceOk && catOk;
    });

    const brandMap = new Map<string, { name: string; count: number }>();
    for (const p of baseForBrandCounts) {
      const name = getBrandName(p);
      if (!name) continue;
      const prev = brandMap.get(name) ?? { name, count: 0 };
      prev.count += 1;
      brandMap.set(name, prev);
    }

    const brands = Array.from(brandMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    const baseForPriceCounts = baseByQuery.filter((p) => {
      const catOk = activeCats.size === 0 ? true : activeCats.has(p.categoryId ?? 'uncategorized');
      const brandOk = activeBrands.size === 0 ? true : activeBrands.has(getBrandName(p));
      return catOk && brandOk;
    });

    const priceCounts = PRICE_BUCKETS.map(
      (b) => baseForPriceCounts.filter((p) => inBucket(priceForFiltering(p), b)).length
    );

    const visiblePriceBuckets = PRICE_BUCKETS.map((b, i) => ({
      bucket: b,
      idx: i,
      count: priceCounts[i] || 0,
    })).filter((x) => x.count > 0);

    let filteredCore = baseByQuery.filter((p) => {
      const catOk = activeCats.size === 0 ? true : activeCats.has(p.categoryId ?? 'uncategorized');
      const priceOk =
        activeBuckets.length === 0 ? true : activeBuckets.some((b) => inBucket(priceForFiltering(p), b));
      const brandOk = activeBrands.size === 0 ? true : activeBrands.has(getBrandName(p));
      return catOk && priceOk && brandOk;
    });

    if (HIDE_OOS) filteredCore = filteredCore.filter((p) => productSellable(p));

    return { categories, brands, visiblePriceBuckets, filtered: filteredCore };
  }, [products, selectedCategories, selectedBucketIdxs, selectedBrands, query, PRICE_BUCKETS, inStockOnly]);

  /* -------- Sorting -------- */

  const purchasedQ = usePurchasedCounts(!isSupplier);

  const recScored = useMemo(() => {
    if (sortKey !== 'relevance') return filtered;
    const purchased = purchasedQ.data ?? {};
    const clicks = readClicks();

    return filtered
      .map((p) => {
        const buy = Math.log1p(purchased[p.id] || 0);
        const clk = Math.log1p(clicks[p.id] || 0);
        const score = 2.5 * buy + 1.5 * clk;
        return { p, score };
      })
      .sort((a, b) => {
        // ✅ when showing all, keep OOS at bottom
        if (!inStockOnly) {
          const sr = stockRank(a.p) - stockRank(b.p);
          if (sr !== 0) return sr;
        }

        const av = productSellable(a.p) ? 1 : 0;
        const bv = productSellable(b.p) ? 1 : 0;
        if (bv !== av) return bv - av;

        if (b.score !== a.score) return b.score - a.score;

        return priceForFiltering(a.p) - priceForFiltering(b.p);
      })
      .map((x) => x.p);
  }, [filtered, sortKey, purchasedQ.data, inStockOnly]);

  const sorted = useMemo(() => {
    if (sortKey === 'relevance') return recScored;

    const arr = [...filtered].sort((a, b) => {
      // ✅ when showing all, keep OOS at bottom
      if (!inStockOnly) {
        const sr = stockRank(a) - stockRank(b);
        if (sr !== 0) return sr;
      }

      const av = productSellable(a) ? 1 : 0;
      const bv = productSellable(b) ? 1 : 0;
      if (bv !== av) return bv - av;

      if (sortKey === 'price-asc') return priceForFiltering(a) - priceForFiltering(b);
      if (sortKey === 'price-desc') return priceForFiltering(b) - priceForFiltering(a);
      return 0;
    });

    return arr;
  }, [filtered, recScored, sortKey, inStockOnly]);

  /* -------- Pagination -------- */

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<6 | 9 | 12>(9);

  useEffect(() => {
    setPage(1);
  }, [selectedCategories, selectedBucketIdxs, selectedBrands, pageSize, sortKey, query, inStockOnly]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = sorted.slice(start, start + pageSize);

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

  const goTo = (p: number) => {
    const clamped = Math.min(Math.max(1, p), totalPages);
    setPage(clamped);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const windowedPages = (current: number, total: number, radius = 2) => {
    const pages: number[] = [];
    const s = Math.max(1, current - radius);
    const e = Math.min(total, current + radius);
    for (let i = s; i <= e; i++) pages.push(i);
    if (pages[0] !== 1) pages.unshift(1);
    if (pages[pages.length - 1] !== total) pages.push(total);
    return [...new Set(pages)].sort((a, b) => a - b);
  };

  const pagesDesktop = windowedPages(currentPage, totalPages, 2);

  const [jumpVal, setJumpVal] = useState<string>('');
  useEffect(() => setJumpVal(''), [totalPages]);

  useEffect(() => {
    // wipe any previously cached product lists (ANY/PUBLISHED)
    qc.removeQueries({ queryKey: ['products'], exact: false });
  }, [qc]);

  if (productsQ.isLoading)
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div
          className="relative w-[10rem] aspect-square sm:w-[13rem] md:w-[16rem]"
          role="status"
          aria-label="Loading products"
        >
          <div className="absolute inset-0 rounded-full border-2 border-slate-200/70" />
          <div className="absolute inset-[18%] rounded-full border border-slate-200/40" />
          <div className="absolute inset-[8%] rounded-full bg-[conic-gradient(from_0deg,rgba(59,130,246,0.9),rgba(59,130,246,0.05)_40%,transparent_65%)] animate-[spin_1.8s_linear_infinite]" />
          <div className="absolute top-1/2 left-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500" />
        </div>
      </div>
    );

  if (productsQ.error)
    return (
      <>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div
            className="relative w-[10rem] aspect-square sm:w-[13rem] md:w-[16rem]"
            role="status"
            aria-label="Error loading products"
          >
            <div className="absolute inset-0 rounded-full border-2 border-slate-200/70" />
            <div className="absolute inset-[18%] rounded-full border border-slate-200/40" />
            <div className="absolute inset-[8%] rounded-full bg-[conic-gradient(from_0deg,rgba(59,130,246,0.9),rgba(59,130,246,0.05)_40%,transparent_65%)] animate-[spin_1.8s_linear_infinite]" />
            <div className="absolute top-1/2 left-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500" />
          </div>
        </div>
        <p className="p-6 text-center text-rose-600">Error loading products</p>
      </>
    );

  const toggleCategory = (id: string) =>
    setSelectedCategories((curr) => (curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id]));
  const toggleBucket = (idx: number) =>
    setSelectedBucketIdxs((curr) => (curr.includes(idx) ? curr.filter((i) => i !== idx) : [...curr, idx]));
  const toggleBrand = (name: string) =>
    setSelectedBrands((curr) => (curr.includes(name) ? curr.filter((n) => n !== name) : [...curr, name]));
  const clearFilters = () => {
    setSelectedCategories([]);
    setSelectedBucketIdxs([]);
    setSelectedBrands([]);
    setInStockOnly(true); // ✅ default back to checked
  };

  const Shimmer = () => (
    <div className="h-3 w-full rounded bg-gradient-to-r from-zinc-200 via-zinc-100 to-zinc-200 animate-pulse" />
  );

  return (
    <SiteLayout>
      <div className="max-w-screen-2xl mx-auto min-h-screen">
        {/* Hero */}
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700">
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,0,167,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,204,255,0.25),transparent_60%)]" />
          <div className="relative px-4 md:px-8 pt-10 pb-8">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <motion.h1
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-2xl md:text-3xl font-bold tracking-tight text-white"
                >
                  Discover Products <Sparkles className="inline text-white ml-1" size={22} />
                </motion.h1>
                <p className="text-sm text-white/80">
                  Fresh picks, smart sorting, and instant search—tailored for you.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div
          className="md:flex md:items-start md:gap-8 px-2 md:px-8 pb-10"
          onTouchStart={(e) => {
            const x = e.touches[0]?.clientX ?? 0;
            if (x < 24 && !mobileFiltersOpen) setTouchStartX(x);
          }}
          onTouchMove={(e) => {
            if (touchStartX == null || mobileFiltersOpen) return;
            const x = e.touches[0]?.clientX ?? 0;
            const dx = x - touchStartX;
            if (dx > 40) {
              setMobileFiltersOpen(true);
              setTouchStartX(null);
            }
          }}
          onTouchEnd={() => setTouchStartX(null)}
        >
          {/* LEFT: Filters */}
          <aside className="hidden md:block space-y-6 md:w-72 lg:w-80 md:flex-none mt-6 md:mt-10">
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

                <div className="flex items-center gap-3">
                  {/* ✅ In stock toggle */}
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-800 select-none">
                    <input
                      type="checkbox"
                      checked={inStockOnly}
                      onChange={(e) => setInStockOnly(e.target.checked)}
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    In stock
                  </label>

                  {(selectedCategories.length > 0 ||
                    selectedBucketIdxs.length > 0 ||
                    selectedBrands.length > 0 ||
                    !inStockOnly) && (
                      <button className="text-sm text-fuchsia-700 hover:underline" onClick={clearFilters}>
                        Clear all
                      </button>
                    )}
                </div>
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
                          className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${checked
                            ? 'bg-zinc-900 text-white'
                            : 'bg-white/80 hover:bg-black/5 text-zinc-800'
                            }`}
                        >
                          <span className="truncate">{c.name}</span>
                          <span className={`ml-2 text-xs ${checked ? 'text-white/90' : 'text-zinc-600'}`}>
                            ({c.count})
                          </span>
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
                            className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${checked
                              ? 'bg-zinc-900 text-white'
                              : 'bg-white/80 hover:bg-black/5 text-zinc-800'
                              }`}
                          >
                            <span className="truncate">{b.name}</span>
                            <span className={`ml-2 text-xs ${checked ? 'text-white/90' : 'text-zinc-600'}`}>
                              ({b.count})
                            </span>
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
                          className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${checked
                            ? 'bg-zinc-900 text-white'
                            : 'bg-white/80 hover:bg-black/5 text-zinc-800'
                            }`}
                        >
                          <span>{bucket.label}</span>
                          <span className={`ml-2 text-xs ${checked ? 'text-white/90' : 'text-zinc-600'}`}>
                            ({count})
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </motion.section>
          </aside>

          {/* RIGHT: Products */}
          <section className="mt-8 md:mt-0 flex-1">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xl md:text-2xl font-semibold text-zinc-900">Products</h2>

              <button
                type="button"
                onClick={() => setMobileFiltersOpen(true)}
                className="md:hidden inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-medium border border-zinc-300 bg-white/90 text-zinc-800 shadow-sm active:scale-[0.97] transition"
              >
                <SlidersHorizontal size={14} />
                Filters
              </button>
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
                        const minPrice = priceForFiltering(p);
                        return (
                          <li key={p.id} className="mb-3 last:mb-0">
                            <Link
                              to={`/product/${p.id}`}
                              className={`flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-black/5 ${active ? 'bg-black/5' : ''
                                }`}
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
                                  {ngn.format(minPrice)}
                                  {p.categoryName ? ` • ${p.categoryName}` : ''}
                                  {getBrandName(p) ? ` • ${getBrandName(p)}` : ''}
                                </div>
                                {p.description && (
                                  <div className="text-sm opacity-70 line-clamp-2 mt-1">{p.description}</div>
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
                  onChange={(e) => setSortKey(e.target.value as any)}
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

            {/* Grid */}
            {sorted.length === 0 ? (
              <p className="text-sm text-zinc-600">No products match your filters.</p>
            ) : (
              <>
                <div className="grid gap-3 md:gap-4 grid-cols-2 md:grid-cols-3">
                  {pageItems.map((p) => {
                    const fav = isFav(p.id);
                    const minPrice = priceForFiltering(p);
                    const brand = getBrandName(p);

                    const primaryImg =
                      p.imagesJson?.[0] ||
                      p.variants?.find((v) => Array.isArray(v.imagesJson) && v.imagesJson[0])?.imagesJson?.[0] ||
                      undefined;

                    const hoverImg =
                      p.imagesJson?.[1] ||
                      p.variants?.find((v) => Array.isArray(v.imagesJson) && v.imagesJson[1])?.imagesJson?.[1] ||
                      undefined;

                    const hasDifferentHover = !!hoverImg && hoverImg !== primaryImg;

                    const available = availableNow(p);
                    const live = isLive(p);
                    const needsOptions = Array.isArray(p.variants) && p.variants.length > 0;

                    const allOffers = collectAllOffers(p);
                    const totalAvail = sumActivePositiveQty(allOffers) || null;
                    const inCart = qtyInCart(p.id, null);
                    const remaining = totalAvail == null ? null : Math.max(0, totalAvail - inCart);

                    const allowQuickAdd = productSellable(p) && (!needsOptions || false);
                    const currentQty = inCart;
                    const canIncrement = remaining == null ? allowQuickAdd : remaining > 0;

                    const badge = !live
                      ? {
                        text: 'Pending approval',
                        cls: 'bg-amber-600/10 text-amber-700 border border-amber-600/20',
                      }
                      : available
                        ? {
                          text: 'In stock',
                          cls: 'bg-emerald-600/10 text-emerald-700 border border-emerald-600/20',
                        }
                        : {
                          text: 'Out of stock',
                          cls: 'bg-rose-600/10 text-rose-700 border border-rose-600/20',
                        };

                    return (
                      <motion.article
                        key={p.id}
                        whileHover={{ y: -4 }}
                        className="group rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden"
                      >
                        <Link to={`/product/${p.id}`} className="block" onClick={() => bumpClick(p.id)}>
                          <div className="relative w-full h-40 sm:h-44 md:h-48 overflow-hidden">
                            {primaryImg ? (
                              <>
                                <img
                                  src={primaryImg}
                                  alt={p.title}
                                  className={`w-full h-full object-cover transition-opacity duration-300 ${hasDifferentHover ? 'opacity-100 group-hover:opacity-0' : 'opacity-100'
                                    }`}
                                />
                                {hasDifferentHover && (
                                  <img
                                    src={hoverImg}
                                    alt={`${p.title} alt`}
                                    className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 opacity-0 group-hover:opacity-100"
                                  />
                                )}
                              </>
                            ) : (
                              <div className="w-full h-full grid place-items-center text-zinc-400">No image</div>
                            )}

                            <span
                              className={`absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${badge.cls}`}
                            >
                              <CheckCircle2 size={12} />
                              {badge.text}
                            </span>
                          </div>
                        </Link>

                        <div className="p-4">
                          <Link to={`/product/${p.id}`} onClick={() => bumpClick(p.id)}>
                            <h3 className="font-semibold text-[13px] md:text-sm text-zinc-900 line-clamp-1">
                              {p.title}
                            </h3>
                            <div className="text-[10px] md:text-xs text-zinc-500 line-clamp-1">
                              {brand ? `${brand} • ` : ''}
                              {p.categoryName?.trim() || 'Uncategorized'}
                            </div>

                            <p className="mt-1 text-sm md:text-base font-semibold">{ngn.format(minPrice)}</p>
                          </Link>

                          {Number(p.ratingCount) > 0 && (
                            <div className="mt-2 text-[10px] md:text-[12px] text-amber-700 inline-flex items-center gap-1">
                              <Star size={14} />
                              <span>
                                {Number(p.ratingAvg).toFixed(1)} ({p.ratingCount})
                              </span>
                            </div>
                          )}

                          {!isSupplier && (
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5">
                              <button
                                aria-label={fav ? 'Remove from wishlist' : 'Add to wishlist'}
                                className={`inline-flex items-center gap-1 text-[10px] md:text-xs rounded-full border px-2.5 py-1.5 transition ${fav
                                  ? 'bg-rose-50 text-rose-600 border-rose-200'
                                  : 'bg-white hover:bg-zinc-50 text-zinc-700'
                                  }`}
                                onClick={() => {
                                  if (!token) {
                                    openModal({
                                      title: 'Wishlist',
                                      message: 'Please login to use the wishlist.',
                                    });
                                    return;
                                  }
                                  toggleFav.mutate({ productId: p.id });
                                }}
                                title={fav ? 'Remove from wishlist' : 'Add to wishlist'}
                              >
                                {fav ? <Heart size={14} /> : <HeartOff size={14} />}
                                <span>{fav ? 'Wishlisted' : 'Wishlist'}</span>
                              </button>

                              {needsOptions ? (
                                <Link
                                  to={`/product/${p.id}`}
                                  className="inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[10px] md:text-xs border bg-zinc-500 text-white border-zinc-900 hover:opacity-90"
                                  onClick={() => bumpClick(p.id)}
                                  aria-label="Choose options"
                                  title="Choose options"
                                >
                                  Choose opts.
                                </Link>
                              ) : currentQty > 0 ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    onClick={() => setCartQty(p, currentQty - 1)}
                                    className="w-7 h-7 rounded-full border border-zinc-300 bg-white text-[14px] flex items-center justify-center text-zinc-700 active:scale-95 transition"
                                    aria-label="Decrease quantity"
                                  >
                                    -
                                  </button>
                                  <span className="min-w-[20px] text-center text-[11px] font-semibold text-zinc-800">
                                    {currentQty}
                                  </span>
                                  <button
                                    onClick={() => canIncrement && setCartQty(p, currentQty + 1)}
                                    disabled={!allowQuickAdd || !canIncrement}
                                    className="w-7 h-7 rounded-full border border-zinc-900 bg-zinc-900 text-white text-[14px] flex items-center justify-center disabled:opacity-40 active:scale-95 transition"
                                    aria-label="Increase quantity"
                                  >
                                    +
                                  </button>
                                </div>
                              ) : (
                                <button
                                  disabled={!allowQuickAdd}
                                  onClick={() => setCartQty(p, 1)}
                                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] md:text-xs border transition ${allowQuickAdd
                                    ? 'bg-zinc-900 text-white border-zinc-900 hover:opacity-90'
                                    : 'bg-white text-zinc-400 border-zinc-200 cursor-not-allowed'
                                    }`}
                                  aria-label="Add to cart"
                                  title={allowQuickAdd ? 'Add to cart' : 'Not available'}
                                >
                                  Add to cart
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </motion.article>
                    );
                  })}
                </div>

                {/* Pagination */}
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-zinc-600">
                    Showing {start + 1}-{Math.min(start + pageSize, sorted.length)} of {sorted.length} products
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const n = Number(jumpVal);
                        if (Number.isFinite(n)) goTo(n);
                      }}
                    >
                      <label className="text-sm text-zinc-700">Go to</label>
                      <input
                        type="number"
                        min={1}
                        max={totalPages}
                        value={jumpVal}
                        onChange={(e) => setJumpVal(e.target.value)}
                        className="w-20 border rounded-xl px-3 py-1.5 bg-white"
                        aria-label="Jump to page"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 border rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50"
                        disabled={!jumpVal || Number(jumpVal) < 1 || Number(jumpVal) > totalPages}
                      >
                        Go
                      </button>
                    </form>

                    <div className="flex items-center gap-1 sm:gap-2">
                      <button
                        type="button"
                        className="px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs border rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50"
                        onClick={() => goTo(1)}
                        disabled={currentPage <= 1}
                      >
                        First
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs border rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50"
                        onClick={() => goTo(currentPage - 1)}
                        disabled={currentPage <= 1}
                      >
                        Prev
                      </button>

                      <div className="hidden sm:flex items-center gap-1">
                        {pagesDesktop.map((n, idx) => {
                          const prev = pagesDesktop[idx - 1];
                          const showEllipsis = prev != null && n - prev > 1;
                          return (
                            <span key={`d-${n}`} className="inline-flex items-center">
                              {showEllipsis && <span className="px-1 text-sm text-zinc-500">…</span>}
                              <button
                                type="button"
                                onClick={() => goTo(n)}
                                className={`px-3 py-1.5 text-xs border rounded-xl ${n === currentPage
                                  ? 'bg-zinc-900 text-white border-zinc-900'
                                  : 'bg-white hover:bg-zinc-50'
                                  }`}
                                aria-current={n === currentPage ? 'page' : undefined}
                              >
                                {n}
                              </button>
                            </span>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        className="px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs border rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50"
                        onClick={() => goTo(currentPage + 1)}
                        disabled={currentPage >= totalPages}
                      >
                        Next
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs border rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50"
                        onClick={() => goTo(totalPages)}
                        disabled={currentPage >= totalPages}
                      >
                        Last
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {/* Mobile Filters Drawer */}
      {mobileFiltersOpen && (
        <motion.div
          className="fixed inset-0 z-40 md:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileFiltersOpen(false)} />

          <motion.div
            className="absolute inset-y-0 left-0 w-[82%] max-w-xs bg-white rounded-tr-3xl rounded-br-3xl shadow-2xl overflow-y-auto p-4 flex flex-col gap-4"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-zinc-900">Filters</h3>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="text-[10px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-600"
              >
                Close
              </button>
            </div>

            {/* ✅ In stock toggle (mobile) */}
            <label className="inline-flex items-center gap-2 text-[11px] font-medium text-zinc-800 select-none">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              In stock
            </label>

            {/* Categories */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[11px] font-semibold text-zinc-800">Categories</h4>
                <button
                  className="text-[10px] text-zinc-600 hover:underline disabled:opacity-40"
                  onClick={() => setSelectedCategories([])}
                  disabled={selectedCategories.length === 0}
                >
                  Reset
                </button>
              </div>
              <ul className="space-y-1.5">
                {categories.map((c) => {
                  const checked = selectedCategories.includes(c.id);
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => toggleCategory(c.id)}
                        className={`w-full flex items-center justify-between rounded-xl border px-3 py-1.5 text-[11px] transition ${checked ? 'bg-zinc-900 text-white' : 'bg-white hover:bg-black/5 text-zinc-800'
                          }`}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className={`ml-2 text-[10px] ${checked ? 'text-white/90' : 'text-zinc-600'}`}>
                          ({c.count})
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Brands */}
            {brands.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[11px] font-semibold text-zinc-800">Brands</h4>
                  <button
                    className="text-[10px] text-zinc-600 hover:underline disabled:opacity-40"
                    onClick={() => setSelectedBrands([])}
                    disabled={selectedBrands.length === 0}
                  >
                    Reset
                  </button>
                </div>
                <ul className="space-y-1.5">
                  {brands.map((b) => {
                    const checked = selectedBrands.includes(b.name);
                    return (
                      <li key={b.name}>
                        <button
                          onClick={() => toggleBrand(b.name)}
                          className={`w-full flex items-center justify-between rounded-xl border px-3 py-1.5 text-[11px] transition ${checked ? 'bg-zinc-900 text-white' : 'bg-white hover:bg-black/5 text-zinc-800'
                            }`}
                        >
                          <span className="truncate">{b.name}</span>
                          <span className={`ml-2 text-[10px] ${checked ? 'text-white/90' : 'text-zinc-600'}`}>
                            ({b.count})
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Price */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[11px] font-semibold text-zinc-800">Price</h4>
                <button
                  className="text-[10px] text-zinc-600 hover:underline disabled:opacity-40"
                  onClick={() => setSelectedBucketIdxs([])}
                  disabled={selectedBucketIdxs.length === 0}
                >
                  Reset
                </button>
              </div>
              <ul className="space-y-1.5">
                {visiblePriceBuckets.map(({ bucket, idx, count }) => {
                  const checked = selectedBucketIdxs.includes(idx);
                  return (
                    <li key={bucket.label}>
                      <button
                        onClick={() => toggleBucket(idx)}
                        className={`w-full flex items-center justify-between rounded-xl border px-3 py-1.5 text-[11px] transition ${checked ? 'bg-zinc-900 text-white' : 'bg-white hover:bg-black/5 text-zinc-800'
                          }`}
                      >
                        <span>{bucket.label}</span>
                        <span className={`ml-2 text-[10px] ${checked ? 'text-white/90' : 'text-zinc-600'}`}>
                          ({count})
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Clear all (mobile) */}
            {(selectedCategories.length > 0 ||
              selectedBucketIdxs.length > 0 ||
              selectedBrands.length > 0 ||
              !inStockOnly) && (
                <button
                  className="mt-2 text-xs font-medium text-fuchsia-700 hover:underline self-start"
                  onClick={clearFilters}
                >
                  Clear all
                </button>
              )}
          </motion.div>
        </motion.div>
      )}
    </SiteLayout>
  );
}
