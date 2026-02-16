// src/pages/Catalog.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client.js';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useModal } from '../components/ModalProvider';
import { motion } from 'framer-motion';

import {
  Search,
  SlidersHorizontal,
  Star,
  Heart,
  HeartOff,
  LayoutGrid,
  ArrowUpDown,
  CheckCircle2,
  X,
} from 'lucide-react';
import SiteLayout from '../layouts/SiteLayout.js';
import { showMiniCartToast } from '../components/cart/MiniCartToast';

/* ---------------- Types ---------------- */
type SupplierOfferLite = {
  id: string;

  supplierId?: string | null;

  isActive?: boolean;
  inStock?: boolean;
  availableQty?: number | null;

  // ✅ supplier-side price inputs
  basePrice?: number | null; // SupplierProductOffer
  unitPrice?: number | null; // SupplierVariantOffer
  price?: number | null; // fallback if backend uses generic

  supplierRatingAvg?: number | null;
  supplierRatingCount?: number | null;
};

type Variant = {
  id: string;
  sku?: string | null;

  // retail fields (still supported)
  price?: number | null;

  inStock?: boolean | null;
  imagesJson?: string[];

  offers?: SupplierOfferLite[]; // ✅ variant-level offers
};

type Product = {
  id: string;
  title: string;
  description?: string;

  // retail fields (still supported)
  price?: number | null;

  // ✅ product-local margin (optional legacy)
  commissionPctInt?: number | null;

  // backend computed cheapest supplier price (optional legacy)
  offersFrom?: number | null;

  inStock?: boolean | null;
  imagesJson?: string[];

  categoryId?: string | null;
  categoryName?: string | null;

  brandName?: string | null;
  brand?: { id: string; name: string } | null;

  variants?: Variant[];

  supplierOffers?: SupplierOfferLite[]; // ✅ product-level offers

  ratingAvg?: number | null;
  ratingCount?: number | null;
  attributesSummary?: { attribute: string; value: string }[];

  status?: string;
};

type PublicSettings = {
  baseServiceFeeNGN?: number;
  commsUnitCostNGN?: number;
  taxMode?: 'INCLUDED' | 'ADDED' | 'NONE';
  taxRatePct?: number;

  // ✅ this is the one you use in your backend
  marginPercent?: number;
  // ✅ included for compatibility in settings.ts
  pricingMarkupPercent?: number;
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

type CartLine = { productId: string; variantId?: string | null; qty: number };

function qtyInCartFrom(cart: CartLine[], productId: string, variantId: string | null): number {
  return (cart || [])
    .filter((x) => x.productId === productId && (variantId ? x.variantId === variantId : !x.variantId))
    .reduce((s, x) => s + Math.max(0, Number(x.qty) || 0), 0);
}

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

/** Any active + inStock offer */
const hasActiveInStockOffer = (offers?: SupplierOfferLite[]) =>
  Array.isArray(offers) && offers.some((o) => trueOnly(o.isActive) && trueOnly(o.inStock));

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

function availableNow(p: Product): boolean {
  return computeAvailableNowFromOffers(p.inStock === true, p.supplierOffers, p.variants ?? []);
}

/* ---------------- Helpers: pricing model ---------------- */

/**
 * Extract supplier price from an offer (base or variant).
 * IMPORTANT: unitPrice (variant) and basePrice (product) are both valid.
 */
function offerSupplierPrice(o?: SupplierOfferLite): number {
  if (!o) return 0;
  const v = nnum(o.unitPrice) || nnum(o.basePrice) || nnum(o.price) || 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function applyMargin(supplierPrice: number, marginPct: number): number {
  if (!(supplierPrice > 0)) return 0;
  return supplierPrice * (1 + marginPct / 100);
}

/**
 * Effective margin:
 * - primary: settings.marginPercent (from GET /api/settings/public)
 * - fallback: product.commissionPctInt (legacy)
 */
function getEffectiveMarginPct(p: Product, settingsMarginPct: number): number {
  if (Number.isFinite(settingsMarginPct) && settingsMarginPct >= 0) return settingsMarginPct;

  const m = Number(p.commissionPctInt);
  if (!Number.isFinite(m) || m < 0) return 0;
  return m;
}

/**
 * Decide if an offer is usable for "in-stock only" pricing:
 * - must be active
 * - must be inStock OR have positive qty
 */
function offerStockOk(o: SupplierOfferLite): boolean {
  if (!o || o.isActive === false) return false;

  const qty = o.availableQty;
  const hasQty = qty != null && Number.isFinite(Number(qty));
  const qtyOk = !hasQty ? true : Number(qty) > 0;

  return o.inStock === true || qtyOk;
}

// --- Selection policy (match orders.ts approach) ---
const SUPPLIER_BAND_PCT = 2; // +2% band around cheapest
const BAYES_M = 5; // confidence strength
const MIN_BAYES_RATING = 3.8; // gate; fallback if it eliminates everyone
const FALLBACK_GLOBAL_RATING_C = 4.2; // used if we can't infer a global C

function bayesRating(avg: number, count: number, C: number, m: number) {
  const n = Math.max(0, Number.isFinite(count) ? count : 0);
  const a = Number.isFinite(avg) ? avg : 0;
  const mm = Math.max(1, Number.isFinite(m) ? m : 5);
  return (n / (n + mm)) * a + (mm / (n + mm)) * C;
}

type OfferPick = {
  offer: SupplierOfferLite;
  supplierPrice: number;
  bayes: number;
};

function pickBestAndCheapestOffer(
  p: Product,
  opts: { inStockOnlyPricing: boolean }
): {
  cheapest?: OfferPick;
  best?: OfferPick;
  cheapestSupplierPrice: number | null;
  bestSupplierPrice: number | null;
} {
  const offers = collectAllOffers(p);

  // Build candidates: active + priced (+ stock ok if requested)
  const candidates: OfferPick[] = [];
  const ratingAvgs: number[] = [];

  for (const o of offers) {
    if (!o || o.isActive === false) continue;
    if (opts.inStockOnlyPricing && !offerStockOk(o)) continue;

    const sp = offerSupplierPrice(o);
    if (!(sp > 0)) continue;

    const avg = Number(o.supplierRatingAvg);
    if (Number.isFinite(avg) && avg > 0) ratingAvgs.push(avg);

    candidates.push({ offer: o, supplierPrice: sp, bayes: 0 });
  }

  if (!candidates.length) {
    return { cheapestSupplierPrice: null, bestSupplierPrice: null };
  }

  // Cheapest
  candidates.sort((a, b) => a.supplierPrice - b.supplierPrice);
  const cheapest = candidates[0];
  const bandMax = cheapest.supplierPrice * (1 + SUPPLIER_BAND_PCT / 100);

  // Infer a "global" C (fallback if no ratings)
  const C =
    ratingAvgs.length > 0
      ? ratingAvgs.reduce((s, x) => s + x, 0) / ratingAvgs.length
      : FALLBACK_GLOBAL_RATING_C;

  // Score candidates
  for (const c of candidates) {
    const avg = Number(c.offer.supplierRatingAvg);
    const cnt = Number(c.offer.supplierRatingCount);
    c.bayes = bayesRating(
      Number.isFinite(avg) ? avg : 0,
      Number.isFinite(cnt) ? cnt : 0,
      C,
      BAYES_M
    );
  }

  // In-band set
  const inBand = candidates.filter((c) => c.supplierPrice <= bandMax);

  // Gate by min bayes; if empty, fallback to ungated in-band
  const gated = inBand.filter((c) => c.bayes >= MIN_BAYES_RATING);
  const pool = gated.length ? gated : inBand;

  // Pick best: highest bayes, then cheaper, then higher qty
  const best = pool
    .slice()
    .sort((a, b) => {
      if (b.bayes !== a.bayes) return b.bayes - a.bayes;
      if (a.supplierPrice !== b.supplierPrice) return a.supplierPrice - b.supplierPrice;

      const aq = Number(a.offer.availableQty);
      const bq = Number(b.offer.availableQty);
      const aqv = Number.isFinite(aq) ? aq : 0;
      const bqv = Number.isFinite(bq) ? bq : 0;
      return bqv - aqv;
    })[0];

  return {
    cheapest,
    best,
    cheapestSupplierPrice: cheapest?.supplierPrice ?? null,
    bestSupplierPrice: best?.supplierPrice ?? null,
  };
}

/**
 * Main: display retail price
 * ✅ Now follows orders.ts logic: choose "best" within +2% band (fallback to cheapest)
 */
function getDisplayRetailPrice(p: Product, settingsMarginPct: number): number {
  const marginPct = getEffectiveMarginPct(p, settingsMarginPct);

  const picked = pickBestAndCheapestOffer(p, { inStockOnlyPricing: true });
  const selectedSupplier = picked.bestSupplierPrice ?? picked.cheapestSupplierPrice;

  if (selectedSupplier != null) {
    const retail = applyMargin(selectedSupplier, marginPct);
    if (retail > 0) return retail;
  }

  const fallback = getFallbackRetailPrice(p);
  if (fallback != null) return fallback;

  const variantPrices: number[] = [];
  if (Array.isArray(p.variants)) {
    for (const v of p.variants) {
      const vp = nnum(v.price);
      if (Number.isFinite(vp) && vp > 0) variantPrices.push(vp);
    }
  }
  return variantPrices.length ? Math.min(...variantPrices) : 0;
}

/** For bucketting/filtering when not inStockOnly */
function getDisplayRetailPriceAny(p: Product, settingsMarginPct: number): number {
  const marginPct = getEffectiveMarginPct(p, settingsMarginPct);

  const picked = pickBestAndCheapestOffer(p, { inStockOnlyPricing: false });
  const selectedSupplier = picked.bestSupplierPrice ?? picked.cheapestSupplierPrice;

  if (selectedSupplier != null) {
    const retail = applyMargin(selectedSupplier, marginPct);
    if (retail > 0) return retail;
  }

  const fb = getFallbackRetailPrice(p);
  if (fb != null) return fb;

  const variantPrices: number[] = [];
  if (Array.isArray(p.variants)) {
    for (const v of p.variants) {
      const vp = nnum(v.price);
      if (Number.isFinite(vp) && vp > 0) variantPrices.push(vp);
    }
  }
  return variantPrices.length ? Math.min(...variantPrices) : 0;
}

// ✅ helper for UI: return BOTH prices (best + cheapest) as retail
function getRetailPricePair(
  p: Product,
  settingsMarginPct: number,
  opts: { inStockOnlyPricing: boolean }
): { bestRetail: number; cheapestRetail: number; marginPct: number } {
  const marginPct = getEffectiveMarginPct(p, settingsMarginPct);

  const picked = pickBestAndCheapestOffer(p, { inStockOnlyPricing: opts.inStockOnlyPricing });
  const bestSupplier = picked.bestSupplierPrice ?? null;
  const cheapestSupplier = picked.cheapestSupplierPrice ?? null;

  const bestRetail = bestSupplier != null ? applyMargin(bestSupplier, marginPct) : 0;
  const cheapestRetail = cheapestSupplier != null ? applyMargin(cheapestSupplier, marginPct) : 0;

  return {
    bestRetail: Number.isFinite(bestRetail) ? bestRetail : 0,
    cheapestRetail: Number.isFinite(cheapestRetail) ? cheapestRetail : 0,
    marginPct,
  };
}

/**
 * Fallback retail price coming directly from Product.price / Variant.price
 * (keeps your system working if offers don’t return price yet).
 */
function getFallbackRetailPrice(p: Product): number | null {
  const base = nnum(p.price);
  return Number.isFinite(base) && base > 0 ? base : null;
}

function productSellable(p: Product, settingsMarginPct: number): boolean {
  if (!isLive(p)) return false;
  if (!availableNow(p)) return false;

  const display = getDisplayRetailPrice(p, settingsMarginPct);
  return Number.isFinite(display) && display > 0;
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

/* ---------------- Purchased counts (for relevance sort) ---------------- */

function usePurchasedCounts(enabledOverride = true) {
  const user = useAuthStore((s) => s.user);

  // ✅ IMPORTANT: must RETURN the useQuery result (fixes "void" / .data error)
  return useQuery<Record<string, number>>({
    queryKey: ['orders', 'mine', 'purchased-counts'],
    enabled: !!user && enabledOverride,
    retry: 0,
    staleTime: 30_000,
    queryFn: async () => {
      const LIMIT = 200;

      try {
        // ✅ cookie auth
        const { data } = await api.get('/api/orders/mine', {
          withCredentials: true,
          params: { limit: LIMIT },
        });

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

function bestSupplierRatingScore(p: Product): number {
  const offers = collectAllOffers(p);

  let best = 0;

  for (const o of offers) {
    if (!o || o.isActive === false) continue;

    const avg = Number(o.supplierRatingAvg);
    const cnt = Number(o.supplierRatingCount);

    if (!Number.isFinite(avg) || avg <= 0) continue;

    // confidence boost
    const weight = Number.isFinite(cnt) && cnt > 0 ? Math.min(1, Math.log10(cnt + 1) / 3) : 0;
    const score = avg + 0.15 * weight;

    if (score > best) best = score;
  }

  return best;
}

/* ---------------- Motion circle (loader) ---------------- */

function MotionCircleLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3" role="status" aria-label={label}>
      <div className="relative w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32">
        <svg className="absolute inset-0" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(226,232,240,0.9)" strokeWidth="8" />
        </svg>

        <motion.svg
          className="absolute inset-0"
          viewBox="0 0 100 100"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
        >
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="rgba(59,130,246,0.95)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray="160 120"
          />
        </motion.svg>

        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{ scale: [1, 1.03, 1] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
        />
      </div>

      <div className="text-sm text-zinc-600">{label}</div>
    </div>
  );
}

/* ---------------- Component ---------------- */

export default function Catalog() {
  const user = useAuthStore((s) => s.user);
  const isSupplier = user?.role === 'SUPPLIER';
  const isAuthed = !!user;

  const { openModal } = useModal();
  const nav = useNavigate();
  const qc = useQueryClient();

  // Keep your behavior: hide non-sellable products in catalogue.
  const HIDE_OOS = false;

  // include category in both queryKey and request
  const includeStr = 'brand,category,variants,attributes,offers' as const;

  /* ---------------- ✅ Settings query (CORRECT key: marginPercent) ---------------- */

  const settingsQ = useQuery<number>({
    queryKey: ['settings', 'public', 'marginPercent'],
    staleTime: 10_000,
    retry: 0,
    queryFn: async () => {
      // Your backend exposes GET /api/settings/public (no auth)
      const { data } = await api.get<PublicSettings>('/api/settings/public');

      // be defensive: allow strings too
      const v =
        Number.isFinite(Number((data as any)?.marginPercent))
          ? Number((data as any)?.marginPercent)
          : Number.isFinite(Number((data as any)?.pricingMarkupPercent))
            ? Number((data as any)?.pricingMarkupPercent)
            : NaN;

      return Math.max(0, Number.isFinite(v) ? v : 0);
    },
  });

  // Effective global margin (default 0 if endpoint fails)
  const settingsMarginPct = Number.isFinite(settingsQ.data as any) ? (settingsQ.data as number) : 0;

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

  // ✅ one drawer for ALL: search + sort + per-page + filters
  const [refineOpen, setRefineOpen] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  // default checked (in-stock only)
  const [inStockOnly, setInStockOnly] = useState(true);

  const closeRefine = () => {
    setRefineOpen(false);
    setShowSuggest(false);
  };

  // lock body scroll when drawer open
  useEffect(() => {
    const prev = document.body.style.overflow;
    if (refineOpen) document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [refineOpen]);

  // Pin OOS to bottom when we are not filtering them out
  const stockRank = (p: Product) => (availableNow(p) ? 0 : 1);

  const priceForFiltering = (p: Product) => {
    if (inStockOnly) return getDisplayRetailPrice(p, settingsMarginPct);
    return availableNow(p)
      ? getDisplayRetailPrice(p, settingsMarginPct)
      : getDisplayRetailPriceAny(p, settingsMarginPct);
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
                  // keeping your original shape; if you want strict typing, change to `price: variantRetail`
                  unitPrice: variantRetail as any,
                  inStock: v.inStock === true,
                  imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
                  offers: Array.isArray(v.offers)
                    ? v.offers.map((o: any) => ({
                      id: String(o.id),
                      supplierId: o.supplierId ?? o.supplier?.id ?? null,

                      isActive: o.isActive === true,
                      inStock: o.inStock === true,
                      availableQty: Number.isFinite(Number(o.availableQty)) ? Number(o.availableQty) : null,
                      basePrice: Number.isFinite(Number(o.basePrice)) ? Number(o.basePrice) : null,

                      supplierRatingAvg: Number.isFinite(Number(o.supplierRatingAvg))
                        ? Number(o.supplierRatingAvg)
                        : Number.isFinite(Number(o.supplier?.ratingAvg))
                          ? Number(o.supplier.ratingAvg)
                          : null,

                      supplierRatingCount: Number.isFinite(Number(o.supplierRatingCount))
                        ? Number(o.supplierRatingCount)
                        : Number.isFinite(Number(o.supplier?.ratingCount))
                          ? Number(o.supplier.ratingCount)
                          : null,
                    }))
                    : [],
                } as any;
              })
              : [];

            const supplierOffers: SupplierOfferLite[] = Array.isArray(x.supplierOffers)
              ? x.supplierOffers.map((o: any) => ({
                id: String(o.id),
                supplierId: o.supplierId ?? o.supplier?.id ?? null,

                isActive: o.isActive === true,
                inStock: o.inStock === true,
                availableQty: Number.isFinite(Number(o.availableQty)) ? Number(o.availableQty) : null,

                basePrice: Number.isFinite(Number(o.basePrice)) ? Number(o.basePrice) : null,

                supplierRatingAvg: Number.isFinite(Number(o.supplierRatingAvg))
                  ? Number(o.supplierRatingAvg)
                  : Number.isFinite(Number(o.supplier?.ratingAvg))
                    ? Number(o.supplier.ratingAvg)
                    : null,

                supplierRatingCount: Number.isFinite(Number(o.supplierRatingCount))
                  ? Number(o.supplierRatingCount)
                  : Number.isFinite(Number(o.supplier?.ratingCount))
                    ? Number(o.supplier.ratingCount)
                    : null,
              }))
              : [];

            const catNameRaw = (x.categoryName ?? x.category?.name ?? x.category?.title ?? '').toString().trim();
            const categoryName = catNameRaw || null;

            return {
              id: String(x.id),
              title: String(x.title ?? ''),
              description: x.description ?? '',
              // keeping your original shape; if you want strict typing, change to `price: productRetail`
              retailPrice: productRetail as any,
              offersFrom: Number.isFinite(Number(x.offersFrom)) ? Number(x.offersFrom) : null,
              inStock: x.inStock === true,
              imagesJson: Array.isArray(x.imagesJson) ? x.imagesJson : [],
              categoryId: x.categoryId ?? x.category?.id ?? null,
              categoryName,
              commissionPctInt: Number.isFinite(Number(x.commissionPctInt)) ? Number(x.commissionPctInt) : null,
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
    enabled: !isSupplier && isAuthed,
    retry: (count, e: any) => (Number(e?.response?.status) === 401 ? false : count < 2),
    queryFn: async () => {
      const { data } = await api.get('/api/favorites/mine', { withCredentials: true });
      return new Set((data as any)?.productIds || []);
    },
    initialData: new Set<string>(),
  });


  const isFav = (id: string) => !!favQuery.data?.has(id);

  const toggleFav = useMutation({
    mutationFn: async ({ productId }: { productId: string }) => {
      // ✅ cookie auth (no Authorization header)
      const { data } = await api.post<{ favorited: boolean }>(
        '/api/favorites/toggle',
        { productId },
        { withCredentials: true }
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
  const cartSnapshot = useMemo(() => readCart(), [cartVersion]);

  const setCartQty = (p: Product, nextQty: number) => {
    try {
      const unit = getDisplayRetailPrice(p, settingsMarginPct) || 0;
      if (!(unit > 0) && nextQty > 0) {
        openModal({ title: 'Cart', message: 'This product has no retail price yet.' });
        return;
      }

      // block purchase unless LIVE + available + has retail price
      if (!productSellable(p, settingsMarginPct) && nextQty > 0) {
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
            selectedOptions: [],
            image: primaryImg,
          });
        }
      }

      localStorage.setItem('cart', JSON.stringify(cart));
      window.dispatchEvent(new Event('cart:updated'));

      setCartVersion((v) => v + 1);

      // ✅ show mini-cart toast for both add and remove (but not when qty unchanged)
      if (nextQty !== prevQty) {
        const mode = nextQty > prevQty ? 'add' : 'remove';

        showMiniCartToast(
          cart,
          { productId: p.id, variantId: null },
          {
            mode,
            title: mode === 'remove' ? 'Updated cart' : 'Added to cart',
            duration: mode === 'remove' ? 2200 : 3200,
            maxItems: 4,
          }
        );
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
  }, [products, inStockOnly, settingsMarginPct]);

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

    const priceCounts = PRICE_BUCKETS.map((b) =>
      baseForPriceCounts.filter((p) => inBucket(priceForFiltering(p), b)).length
    );

    const visiblePriceBuckets = PRICE_BUCKETS.map((b, i) => ({
      bucket: b,
      idx: i,
      count: priceCounts[i] || 0,
    })).filter((x) => x.count > 0);

    // ✅ FIXED: define price before using it
    let filteredCore = baseByQuery.filter((p) => {
      const price = priceForFiltering(p);
      const catOk = activeCats.size === 0 ? true : activeCats.has(p.categoryId ?? 'uncategorized');
      const priceOk = activeBuckets.length === 0 ? true : activeBuckets.some((b) => inBucket(price, b));
      const brandOk = activeBrands.size === 0 ? true : activeBrands.has(getBrandName(p));
      return catOk && priceOk && brandOk;
    });

    if (HIDE_OOS) filteredCore = filteredCore.filter((p) => productSellable(p, settingsMarginPct));

    return { categories, brands, visiblePriceBuckets, filtered: filteredCore };
  }, [
    products,
    selectedCategories,
    selectedBucketIdxs,
    selectedBrands,
    query,
    PRICE_BUCKETS,
    inStockOnly,
    settingsMarginPct,
  ]);

  /* -------- Sorting -------- */

  const purchasedQ = usePurchasedCounts(!isSupplier); // ✅ now returns query result (not void)

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
        if (!inStockOnly) {
          const sr = stockRank(a.p) - stockRank(b.p);
          if (sr !== 0) return sr;
        }

        const av = productSellable(a.p, settingsMarginPct) ? 1 : 0;
        const bv = productSellable(b.p, settingsMarginPct) ? 1 : 0;
        if (bv !== av) return bv - av;
        if (b.score !== a.score) return b.score - a.score;

        const ar = bestSupplierRatingScore(a.p);
        const br = bestSupplierRatingScore(b.p);
        if (br !== ar) return br - ar;

        return priceForFiltering(a.p) - priceForFiltering(b.p);
      })
      .map((x) => x.p);
  }, [filtered, sortKey, purchasedQ.data, inStockOnly, settingsMarginPct]);

  const sorted = useMemo(() => {
    if (sortKey === 'relevance') return recScored;

    const arr = [...filtered].sort((a, b) => {
      if (!inStockOnly) {
        const sr = stockRank(a) - stockRank(b);
        if (sr !== 0) return sr;
      }

      const av = productSellable(a, settingsMarginPct) ? 1 : 0;
      const bv = productSellable(b, settingsMarginPct) ? 1 : 0;
      if (bv !== av) return bv - av;

      if (sortKey === 'price-asc') return priceForFiltering(a) - priceForFiltering(b);
      if (sortKey === 'price-desc') return priceForFiltering(b) - priceForFiltering(a);
      return 0;
    });

    return arr;
  }, [filtered, recScored, sortKey, inStockOnly, settingsMarginPct]);

  /* -------- Pagination -------- */

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<6 | 9 | 12>(9);

  useEffect(() => {
    setPage(1);
  }, [selectedCategories, selectedBucketIdxs, selectedBrands, pageSize, sortKey, query, inStockOnly, settingsMarginPct]);

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
    qc.removeQueries({ queryKey: ['products'], exact: false });
  }, [qc]);

  if (productsQ.isLoading)
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <MotionCircleLoader label="Loading products…" />
      </div>
    );

  if (productsQ.error)
    return (
      <>
        <div className="flex min-h-[60vh] items-center justify-center">
          <MotionCircleLoader label="Loading products…" />
        </div>
        <p className="p-6 text-center text-rose-600">We are sorry, we are having technical issues</p>
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
    setInStockOnly(true);
  };

  const Shimmer = () => (
    <div className="h-3 w-full rounded bg-gradient-to-r from-zinc-200 via-zinc-100 to-zinc-200 animate-pulse" />
  );

  const anyActiveFilter =
    selectedCategories.length > 0 || selectedBucketIdxs.length > 0 || selectedBrands.length > 0 || !inStockOnly;
  const hasSearch = !!query.trim();

  return (
    <SiteLayout>
      <div
        className="mx-auto max-w-7xl px-1 sm:px-4 md:px-8 pt-0 pb-4 md:py-8 -mt-6 md:mt-0"
        // ✅ swipe from RIGHT edge to open drawer (mobile/tablet)
        onTouchStart={(e) => {
          if (refineOpen) return;
          const x = e.touches[0]?.clientX ?? 0;
          const w = window.innerWidth || 0;
          if (w > 0 && x > w - 24) setTouchStartX(x);
        }}
        onTouchMove={(e) => {
          if (touchStartX == null || refineOpen) return;
          const x = e.touches[0]?.clientX ?? 0;
          const dx = x - touchStartX; // moving left => negative
          if (dx < -40) {
            setRefineOpen(true);
            setTouchStartX(null);
          }
        }}
        onTouchEnd={() => setTouchStartX(null)}
      >
        {/* ✅ Desktop hero only */}
        <div className="hidden md:block border-b bg-white">
          <div className="mx-auto max-w-7xl px-4 md:px-8 pt-3 pb-4 md:py-10">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-zinc-900">Discover Products</h1>
                <p className="mt-2 text-sm md:text-base text-zinc-600">
                  Fresh picks, smart sorting, and instant search—tailored for you.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setRefineOpen(true)}
                className="hidden md:inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium bg-white/90 text-zinc-800 shadow-sm active:scale-[0.98] transition silver-border silver-hover"
              >
                <SlidersHorizontal size={18} />
                Refine
              </button>
            </div>
          </div>
        </div>

        {/* ✅ Mobile compact title */}
        <div className="md:hidden mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-zinc-900">Products</h1>
            <p className="text-xs text-zinc-600">Search and filter quickly.</p>
          </div>

          <button
            type="button"
            onClick={() => setRefineOpen(true)}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-medium bg-white/90 text-zinc-800 shadow-sm active:scale-[0.97] transition silver-border silver-hover"
          >
            <SlidersHorizontal size={14} />
            Refine
          </button>
        </div>

        {/* ✅ Context chips (so users see their current settings without the controls in-page) */}
        {(hasSearch || anyActiveFilter || sortKey !== 'relevance' || pageSize !== 9) && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-700">
            {hasSearch && (
              <span className="rounded-full border bg-white/80 px-2.5 py-1 silver-border">
                Search: <span className="font-semibold">{query.trim()}</span>
              </span>
            )}
            {anyActiveFilter && (
              <span className="rounded-full border bg-white/80 px-2.5 py-1 silver-border">
                Filters: <span className="font-semibold">active</span>
              </span>
            )}
            {sortKey !== 'relevance' && (
              <span className="rounded-full border bg-white/80 px-2.5 py-1 silver-border">
                Sort:{' '}
                <span className="font-semibold">
                  {sortKey === 'price-asc' ? 'Low → High' : sortKey === 'price-desc' ? 'High → Low' : 'Relevance'}
                </span>
              </span>
            )}
            {pageSize !== 9 && (
              <span className="rounded-full border bg-white/80 px-2.5 py-1 silver-border">
                Per page: <span className="font-semibold">{pageSize}</span>
              </span>
            )}
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1.5 bg-white/90 shadow-sm silver-border silver-hover"
              onClick={() => setRefineOpen(true)}
            >
              <SlidersHorizontal size={14} />
              Edit
            </button>
          </div>
        )}

        {/* Body (no left sidebar now) */}
        <div className="mt-2">
          {/* Products */}
          <section className="mt-0 min-w-0">
            {/* Grid */}
            {sorted.length === 0 ? (
              <p className="text-sm text-zinc-600">No products match your filters.</p>
            ) : (
              <>
                <div className="-mx-2 sm:mx-0 grid gap-1.5 sm:gap-3 md:gap-4 grid-cols-2 md:grid-cols-3">
                  {pageItems.map((p) => {
                    const fav = isFav(p.id);
                    const pricingInStockOnly = inStockOnly ? true : availableNow(p);
                    const pricePair = getRetailPricePair(p, settingsMarginPct, {
                      inStockOnlyPricing: pricingInStockOnly,
                    });
                    const bestPrice = priceForFiltering(p);
                    const cheapestPrice = pricePair.cheapestRetail;

                    const isBestValue =
                      Number.isFinite(bestPrice) &&
                      bestPrice > 0 &&
                      Number.isFinite(cheapestPrice) &&
                      cheapestPrice > 0 &&
                      Math.abs(bestPrice - cheapestPrice) > 0.01;

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
                    const inCart = qtyInCartFrom(cartSnapshot, p.id, null);
                    const remaining = totalAvail == null ? null : Math.max(0, totalAvail - inCart);

                    const allowQuickAdd = productSellable(p, settingsMarginPct) && (!needsOptions || false);
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
                        whileHover={{ y: -3 }}
                        className="group w-full rounded-2xl bg-white/90 backdrop-blur overflow-hidden silver-border-grad silver-hover"
                      >
                        <Link to={`/product/${p.id}`} className="block" onClick={() => bumpClick(p.id)}>
                          <div className="relative w-full h-28 sm:h-36 md:h-48 overflow-hidden">
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
                              className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium ${badge.cls}`}
                            >
                              <CheckCircle2 size={12} />
                              {badge.text}
                            </span>
                          </div>
                        </Link>

                        <div className="p-2.5 md:p-4">
                          <Link to={`/product/${p.id}`} onClick={() => bumpClick(p.id)}>
                            <h3 className="font-semibold text-[12px] md:text-sm leading-tight text-zinc-900 line-clamp-1">
                              {p.title}
                            </h3>
                            <div className="text-[10px] md:text-xs leading-tight text-zinc-500 line-clamp-1">
                              {brand ? `${brand} • ` : ''}
                              {p.categoryName?.trim() || 'Uncategorized'}
                            </div>

                            <div className="mt-0.5 flex items-center gap-1.5">
                              <p className="text-sm md:text-base font-semibold">{ngn.format(bestPrice)}</p>

                              {isBestValue && (
                                <span
                                  className="inline-flex items-center rounded-full border border-emerald-600/20 bg-emerald-600/10 px-2 py-0.5 text-[10px] md:text-[11px] font-medium text-emerald-700"
                                  title="Selected supplier is the best-rated within ~2% of the cheapest price"
                                >
                                  Best value
                                </span>
                              )}
                            </div>

                            {Number.isFinite(cheapestPrice) &&
                              cheapestPrice > 0 &&
                              Math.abs(cheapestPrice - bestPrice) > 0.01 && (
                                <div className="text-[10px] md:text-[11px] leading-tight text-zinc-500">
                                  Cheapest: {ngn.format(cheapestPrice)}
                                </div>
                              )}
                          </Link>

                          {Number(p.ratingCount) > 0 && (
                            <div className="mt-1 text-[10px] md:text-[12px] leading-tight text-amber-700 inline-flex items-center gap-1">
                              <Star size={14} />
                              <span>
                                {Number(p.ratingAvg).toFixed(1)} ({p.ratingCount})
                              </span>
                            </div>
                          )}

                          {!isSupplier && (
                            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1">
                              <button
                                aria-label={fav ? 'Remove from wishlist' : 'Add to wishlist'}
                                className={`inline-flex items-center gap-1 text-[10px] md:text-xs rounded-full px-2 py-1 transition ${fav
                                  ? 'bg-rose-50 text-rose-600 border border-rose-200'
                                  : 'bg-white text-zinc-700 silver-border hover:bg-zinc-50 hover:silver-hover'
                                  }`}
                                onClick={() => {
                                  if (!isAuthed) {
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
                                  className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-[10px] md:text-xs border bg-zinc-500 text-white border-zinc-900 hover:opacity-90"
                                  onClick={() => bumpClick(p.id)}
                                  aria-label="Choose options"
                                  title="Choose options"
                                >
                                  Choose opts.
                                </Link>
                              ) : currentQty > 0 ? (
                                <div className="inline-flex items-center gap-0.5">
                                  <button
                                    onClick={() => setCartQty(p, currentQty - 1)}
                                    className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-white text-[13px] flex items-center justify-center text-zinc-700 active:scale-95 transition silver-border hover:silver-hover"
                                    aria-label="Decrease quantity"
                                  >
                                    -
                                  </button>
                                  <span className="min-w-[16px] text-center text-[10px] font-semibold text-zinc-800">
                                    {currentQty}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      canIncrement && setCartQty(p, currentQty + 1);
                                    }}
                                    disabled={!allowQuickAdd || !canIncrement}
                                    className="w-6 h-6 md:w-7 md:h-7 rounded-full border border-zinc-900 bg-zinc-900 text-white text-[13px] flex items-center justify-center disabled:opacity-40 active:scale-95 transition"
                                    aria-label="Increase quantity"
                                  >
                                    +
                                  </button>
                                </div>
                              ) : (
                                <button
                                  disabled={!allowQuickAdd}
                                  onClick={() => setCartQty(p, 1)}
                                  className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] md:text-xs border transition ${allowQuickAdd
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
                <div className="mt-5 md:mt-8">
                  {/* ✅ Mobile: compact, neat card */}
                  <div className="md:hidden rounded-2xl bg-white/85 backdrop-blur p-3 shadow-sm silver-border">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold tracking-tight text-zinc-800">
                          Showing {start + 1}-{Math.min(start + pageSize, sorted.length)} of {sorted.length}
                        </div>
                        <div className="text-[11px] text-zinc-500">Page {currentPage} / {totalPages}</div>
                      </div>
                    </div>

                    {/* Nav buttons (small + balanced) */}
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      <button
                        type="button"
                        onClick={() => goTo(1)}
                        disabled={currentPage <= 1}
                        className="h-9 rounded-xl bg-white text-[11px] font-semibold text-zinc-700 disabled:opacity-40 silver-border hover:silver-hover active:scale-[0.99] transition"
                      >
                        First
                      </button>
                      <button
                        type="button"
                        onClick={() => goTo(currentPage - 1)}
                        disabled={currentPage <= 1}
                        className="h-9 rounded-xl bg-white text-[11px] font-semibold text-zinc-700 disabled:opacity-40 silver-border hover:silver-hover active:scale-[0.99] transition"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={() => goTo(currentPage + 1)}
                        disabled={currentPage >= totalPages}
                        className="h-9 rounded-xl bg-white text-[11px] font-semibold text-zinc-700 disabled:opacity-40 silver-border hover:silver-hover active:scale-[0.99] transition"
                      >
                        Next
                      </button>
                      <button
                        type="button"
                        onClick={() => goTo(totalPages)}
                        disabled={currentPage >= totalPages}
                        className="h-9 rounded-xl bg-white text-[11px] font-semibold text-zinc-700 disabled:opacity-40 silver-border hover:silver-hover active:scale-[0.99] transition"
                      >
                        Last
                      </button>
                    </div>

                    {/* Jump to page (compact) */}
                    <form
                      className="mt-3 flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const n = Number(jumpVal);
                        if (Number.isFinite(n)) goTo(n);
                      }}
                    >
                      <label className="text-[11px] font-semibold tracking-tight text-zinc-700 shrink-0">
                        Go to
                      </label>

                      <input
                        type="number"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        min={1}
                        max={totalPages}
                        value={jumpVal}
                        onChange={(e) => setJumpVal(e.target.value)}
                        placeholder={`${currentPage}`}
                        className="h-9 w-full min-w-0 rounded-xl px-3 text-[12px] font-semibold bg-white silver-border focus:ring-4 focus:ring-fuchsia-100 focus:border-fuchsia-400"
                        aria-label="Jump to page"
                      />

                      <button
                        type="submit"
                        disabled={!jumpVal || Number(jumpVal) < 1 || Number(jumpVal) > totalPages}
                        className="h-9 shrink-0 rounded-xl px-4 text-[12px] font-semibold bg-zinc-900 text-white disabled:opacity-40 active:scale-[0.99] transition"
                      >
                        Go
                      </button>
                    </form>
                  </div>

                  {/* ✅ Desktop/tablet: keep your existing layout */}
                  <div className="hidden md:flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                          className="w-20 rounded-xl px-3 py-1.5 bg-white silver-border"
                          aria-label="Jump to page"
                        />
                        <button
                          type="submit"
                          className="px-3 py-1.5 rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50 silver-border hover:silver-hover"
                          disabled={!jumpVal || Number(jumpVal) < 1 || Number(jumpVal) > totalPages}
                        >
                          Go
                        </button>
                      </form>

                      <div className="flex items-center gap-1 sm:gap-2">
                        <button
                          type="button"
                          className="px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50 silver-border hover:silver-hover"
                          onClick={() => goTo(1)}
                          disabled={currentPage <= 1}
                        >
                          First
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50 silver-border hover:silver-hover"
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
                                  className={`px-3 py-1.5 text-xs rounded-xl ${n === currentPage
                                      ? "bg-zinc-900 text-white border border-zinc-900"
                                      : "bg-white hover:bg-zinc-50 silver-border hover:silver-hover"
                                    }`}
                                  aria-current={n === currentPage ? "page" : undefined}
                                >
                                  {n}
                                </button>
                              </span>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          className="px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50 silver-border hover:silver-hover"
                          onClick={() => goTo(currentPage + 1)}
                          disabled={currentPage >= totalPages}
                        >
                          Next
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50 silver-border hover:silver-hover"
                          onClick={() => goTo(totalPages)}
                          disabled={currentPage >= totalPages}
                        >
                          Last
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

              </>
            )}
          </section>
        </div>
      </div>

      {/* ✅ Refine Drawer (Search + Sort + Per-page + Filters) */}
      {refineOpen && (
        <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/40" onClick={closeRefine} />

          <motion.div
            className="absolute inset-y-0 right-0 w-[88%] max-w-sm bg-white rounded-tl-3xl rounded-bl-3xl shadow-2xl overflow-y-auto p-4 flex flex-col gap-4 silver-border-grad"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-zinc-900">Refine</h3>
                <p className="text-[11px] text-zinc-600">Search, sort, page size, and filters.</p>
              </div>

              <button
                type="button"
                onClick={closeRefine}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-zinc-100 text-zinc-700 active:scale-95 transition"
                aria-label="Close refine panel"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search */}
            <div className="relative">
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
                        closeRefine();
                        nav(`/product/${pick.id}`);
                      }
                      setShowSuggest(false);
                    } else if (e.key === 'Escape') {
                      setShowSuggest(false);
                    }
                  }}
                  placeholder="Search products, brands, or categories…"
                  className="rounded-2xl pl-9 pr-4 py-2.5 w-full bg-white/90 backdrop-blur transition silver-border focus:ring-4 focus:ring-fuchsia-100 focus:border-fuchsia-400"
                  aria-label="Search products"
                />
              </div>

              {showSuggest && query && suggestions.length > 0 && (
                <div
                  ref={suggestRef}
                  className="mt-2 bg-white rounded-2xl shadow-2xl z-20 overflow-hidden silver-border-grad"
                >
                  <ul className="max-h-[45vh] overflow-auto p-2">
                    {suggestions.map((p, i) => {
                      const active = i === activeIdx;
                      const minPrice = priceForFiltering(p);
                      const pricingInStockOnly = inStockOnly ? true : availableNow(p);
                      const cheapest = getRetailPricePair(p, settingsMarginPct, {
                        inStockOnlyPricing: pricingInStockOnly,
                      }).cheapestRetail;

                      return (
                        <li key={p.id} className="mb-2 last:mb-0">
                          <button
                            type="button"
                            className={`w-full text-left flex items-center gap-3 px-2.5 py-2.5 rounded-xl hover:bg-black/5 ${active ? 'bg-black/5' : ''
                              }`}
                            onClick={() => {
                              bumpClick(p.id);
                              closeRefine();
                              nav(`/product/${p.id}`);
                            }}
                          >
                            {p.imagesJson?.[0] ? (
                              <img
                                src={p.imagesJson[0]}
                                alt={p.title}
                                className="w-16 h-16 object-cover rounded-xl silver-border"
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-xl silver-border grid place-items-center text-base text-gray-500">
                                —
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="text-sm font-semibold truncate">{p.title}</div>
                              <div className="text-xs opacity-80 truncate">
                                {ngn.format(minPrice)}
                                {Number.isFinite(cheapest) &&
                                  cheapest > 0 &&
                                  Math.abs(cheapest - minPrice) > 0.01 && (
                                    <span className="ml-2 text-zinc-500">• Cheapest: {ngn.format(cheapest)}</span>
                                  )}
                                {p.categoryName ? ` • ${p.categoryName}` : ''}
                                {getBrandName(p) ? ` • ${getBrandName(p)}` : ''}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            {/* Sort + Per page */}
            <div className="grid grid-cols-1 gap-3">
              <div className="text-sm inline-flex items-center gap-2">
                <ArrowUpDown size={16} className="text-zinc-600" />
                <label className="opacity-70 min-w-[44px]">Sort</label>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as any)}
                  className="ml-auto w-full rounded-xl px-3 py-2 bg-white/90 silver-border"
                >
                  <option value="relevance">Relevance</option>
                  <option value="price-asc">Price: Low → High</option>
                  <option value="price-desc">Price: High → Low</option>
                </select>
              </div>

              <div className="text-sm inline-flex items-center gap-2">
                <LayoutGrid size={16} className="text-zinc-600" />
                <label className="opacity-70 min-w-[72px]">Per page</label>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as 6 | 9 | 12)}
                  className="ml-auto w-full rounded-xl px-3 py-2 bg-white/90 silver-border"
                >
                  <option value={6}>6</option>
                  <option value={9}>9</option>
                  <option value={12}>12</option>
                </select>
              </div>
            </div>

            {/* In-stock + clear */}
            <div className="flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-[12px] font-medium text-zinc-800 select-none">
                <input
                  type="checkbox"
                  checked={inStockOnly}
                  onChange={(e) => setInStockOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                In stock
              </label>

              {(anyActiveFilter || hasSearch) && (
                <button
                  type="button"
                  className="text-[12px] font-medium text-fuchsia-700 hover:underline"
                  onClick={() => {
                    setQuery('');
                    setShowSuggest(false);
                    clearFilters();
                  }}
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Categories */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[12px] font-semibold text-zinc-800">Categories</h4>
                <button
                  className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
                  onClick={() => setSelectedCategories([])}
                  disabled={selectedCategories.length === 0}
                >
                  Reset
                </button>
              </div>
              <ul className="space-y-1.5">
                {categories.length === 0 && <Shimmer />}
                {categories.map((c) => {
                  const checked = selectedCategories.includes(c.id);
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => toggleCategory(c.id)}
                        className={`w-full flex items-center justify-between rounded-xl border px-3 py-1.5 text-[12px] transition ${checked
                          ? 'bg-zinc-900 text-white'
                          : 'bg-white hover:bg-black/5 text-zinc-800 silver-border hover:silver-hover'
                          }`}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className={`ml-2 text-[11px] ${checked ? 'text-white/90' : 'text-zinc-600'}`}>
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
                  <h4 className="text-[12px] font-semibold text-zinc-800">Brands</h4>
                  <button
                    className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
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
                          className={`w-full flex items-center justify-between rounded-xl border px-3 py-1.5 text-[12px] transition ${checked
                            ? 'bg-zinc-900 text-white'
                            : 'bg-white hover:bg-black/5 text-zinc-800 silver-border hover:silver-hover'
                            }`}
                        >
                          <span className="truncate">{b.name}</span>
                          <span className={`ml-2 text-[11px] ${checked ? 'text-white/90' : 'text-zinc-600'}`}>
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
                <h4 className="text-[12px] font-semibold text-zinc-800">Price</h4>
                <button
                  className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
                  onClick={() => setSelectedBucketIdxs([])}
                  disabled={selectedBucketIdxs.length === 0}
                >
                  Reset
                </button>
              </div>
              <ul className="space-y-1.5">
                {visiblePriceBuckets.length === 0 && <Shimmer />}
                {visiblePriceBuckets.map(({ bucket, idx, count }) => {
                  const checked = selectedBucketIdxs.includes(idx);
                  return (
                    <li key={bucket.label}>
                      <button
                        onClick={() => toggleBucket(idx)}
                        className={`w-full flex items-center justify-between rounded-xl border px-3 py-1.5 text-[12px] transition ${checked
                          ? 'bg-zinc-900 text-white'
                          : 'bg-white hover:bg-black/5 text-zinc-800 silver-border hover:silver-hover'
                          }`}
                      >
                        <span>{bucket.label}</span>
                        <span className={`ml-2 text-[11px] ${checked ? 'text-white/90' : 'text-zinc-600'}`}>
                          ({count})
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Footer actions */}
            <div className="pt-2 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={closeRefine}
                className="w-full rounded-2xl px-4 py-2.5 bg-zinc-900 text-white font-semibold active:scale-[0.98] transition"
              >
                Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </SiteLayout>
  );
}
