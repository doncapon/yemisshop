// src/pages/Catalog.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client.js";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { useModal } from "../components/ModalProvider";
import { motion } from "framer-motion";
import {
  Search,
  SlidersHorizontal,
  Star,
  Heart,
  HeartOff,
  LayoutGrid,
  ArrowUpDown,
  X,
} from "lucide-react";

import SiteLayout from "../layouts/SiteLayout.js";
import { showMiniCartToast } from "../components/cart/MiniCartToast";

// ✅ single source of truth for guest/local mirror
import { readCartLines, upsertCartLine, qtyInCart, toMiniCartRows } from "../utils/cartModel";

/* =========================================================
   Types — STRICTLY aligned to your Prisma schema names
========================================================= */

type CartItemKind = "BASE" | "VARIANT";

type SupplierOfferLite = {
  id: string;
  supplierId?: string | null;

  isActive?: boolean;
  inStock?: boolean;
  availableQty?: number | null;

  // schema-accurate:
  basePrice?: number | null; // SupplierProductOffer.basePrice
  unitPrice?: number | null; // SupplierVariantOffer.unitPrice

  supplierRatingAvg?: number | null;
  supplierRatingCount?: number | null;
};

type Variant = {
  id: string;
  sku?: string | null;

  retailPrice?: number | null; // ProductVariant.retailPrice
  inStock?: boolean | null;
  imagesJson?: string[];

  offers?: SupplierOfferLite[]; // SupplierVariantOffer rows
};

type Product = {
  id: string;
  title: string;
  description?: string;

  retailPrice?: number | null; // Product.retailPrice
  commissionPctInt?: number | null;

  inStock?: boolean | null;
  imagesJson?: string[];

  categoryId?: string | null;
  categoryName?: string | null;

  brand?: { id: string; name: string } | null;

  variants?: Variant[];
  supplierProductOffers?: SupplierOfferLite[];

  ratingAvg?: number | null;
  ratingCount?: number | null;

  status?: string;
};

type PublicSettings = {
  marginPercent?: number;
};

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

/* =========================================================
   Small utilities
========================================================= */

function nnum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function decToNumber(v: any): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeImages(val: any): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof val === "string") {
    const s = val.trim();
    if (!s) return [];
    try {
      if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith('"') && s.endsWith('"'))) {
        const parsed = JSON.parse(s);
        return normalizeImages(parsed);
      }
    } catch {
      // ignore
    }
    return s.split(/[\n,]/g).map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

const isLive = (x?: { status?: string | null }) =>
  String(x?.status ?? "").trim().toUpperCase() === "LIVE";

/* =========================================================
   Pricing — STRICT schema fields only:
   - Product.retailPrice / ProductVariant.retailPrice
   - Supplier offers + Settings.marginPercent
========================================================= */

function productRetailPrice(p: any): number {
  return decToNumber(p?.retailPrice);
}

function variantRetailPrice(v: any): number {
  return decToNumber(v?.retailPrice);
}

function displayRetailPrice(p: any): number {
  const vars = Array.isArray(p?.variants) ? p.variants : [];
  const variantPrices = vars.map(variantRetailPrice).filter((x: number) => x > 0);
  if (variantPrices.length) return Math.min(...variantPrices);

  const base = productRetailPrice(p);
  return base > 0 ? base : 0;
}

function applyMargin(supplierPrice: number, marginPct: number): number {
  if (!(supplierPrice > 0)) return 0;
  return supplierPrice * (1 + marginPct / 100);
}

function offerSupplierPrice(o?: SupplierOfferLite): number {
  if (!o) return 0;
  const v = nnum(o.unitPrice) || nnum(o.basePrice) || 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function offerStockOk(o?: SupplierOfferLite): boolean {
  if (!o || o.isActive === false) return false;

  const qty = o.availableQty;
  const hasQty = qty != null && Number.isFinite(Number(qty));
  const qtyOk = !hasQty ? true : Number(qty) > 0;

  return o.inStock === true || qtyOk;
}

function collectAllOffers(p: Product): SupplierOfferLite[] {
  const out: SupplierOfferLite[] = [];
  if (Array.isArray(p.supplierProductOffers)) out.push(...p.supplierProductOffers);
  if (Array.isArray(p.variants)) {
    for (const v of p.variants) if (Array.isArray(v.offers)) out.push(...v.offers);
  }
  return out;
}

function pickCheapestInStockOffer(p: Product): number | null {
  const offers = collectAllOffers(p);
  const prices: number[] = [];
  for (const o of offers) {
    if (!o || o.isActive === false) continue;
    if (!offerStockOk(o)) continue;
    const sp = offerSupplierPrice(o);
    if (sp > 0) prices.push(sp);
  }
  return prices.length ? Math.min(...prices) : null;
}

function getDisplayRetailPrice(p: Product, settingsMarginPct: number): number {
  const cheapestSupplier = pickCheapestInStockOffer(p);
  if (cheapestSupplier != null) {
    const retail = applyMargin(cheapestSupplier, settingsMarginPct);
    if (retail > 0) return retail;
  }

  const base = nnum(p.retailPrice);
  if (Number.isFinite(base) && base > 0) return base;

  const variantPrices: number[] = [];
  if (Array.isArray(p.variants)) {
    for (const v of p.variants) {
      const vp = nnum(v.retailPrice);
      if (Number.isFinite(vp) && vp > 0) variantPrices.push(vp);
    }
  }
  return variantPrices.length ? Math.min(...variantPrices) : 0;
}

/* =========================================================
   Stock — schema accurate fields only
========================================================= */

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

function availableNow(p: Product): boolean {
  const offers = collectAllOffers(p);

  if (offers.some((o) => o?.isActive === true && o?.inStock === true)) return true;

  for (const o of offers) {
    if (!o || o.isActive === false) continue;
    const q = Number(o.availableQty);
    if (Number.isFinite(q) && q > 0) return true;
  }

  if (p.inStock === true) return true;
  if (Array.isArray(p.variants) && p.variants.some((v) => v.inStock === true)) return true;

  return false;
}

function productSellable(p: Product, marginPct: number): boolean {
  if (!isLive(p)) return false;
  if (!availableNow(p)) return false;
  const price = getDisplayRetailPrice(p, marginPct);
  return Number.isFinite(price) && price > 0;
}

/* =========================================================
   API origin for images (safe)
========================================================= */

function getApiOrigin(): string {
  const base = String((api as any)?.defaults?.baseURL || "").trim();
  if (/^https?:\/\//i.test(base)) {
    try {
      return new URL(base).origin;
    } catch {
      return window.location.origin;
    }
  }
  const env = (import.meta as any)?.env;
  const fromEnv = String(env?.VITE_API_URL || env?.VITE_API_ORIGIN || "").trim();
  if (fromEnv && /^https?:\/\//i.test(fromEnv)) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      // ignore
    }
  }
  return window.location.origin;
}

const API_ORIGIN = getApiOrigin();

function resolveImageUrl(input?: string | null): string | undefined {
  const s = String(input ?? "").trim();
  if (!s) return undefined;

  if (/^(https?:\/\/|data:|blob:)/i.test(s)) return s;
  if (s.startsWith("//")) return `${window.location.protocol}${s}`;

  if (s.startsWith("/")) {
    if (s.startsWith("/uploads/")) return `${API_ORIGIN}${s}`;
    if (s.startsWith("/api/uploads/")) return `${API_ORIGIN}${s}`;
    return `${window.location.origin}${s}`;
  }

  if (s.startsWith("uploads/") || s.startsWith("api/uploads/")) return `${API_ORIGIN}/${s}`;
  return `${window.location.origin}/${s}`;
}

/* =========================================================
   Purchased counts
========================================================= */

function usePurchasedCounts(enabledOverride = true) {
  const user = useAuthStore((s) => s.user);

  return useQuery<Record<string, number>>({
    queryKey: ["orders", "mine", "purchased-counts"],
    enabled: !!user && enabledOverride,
    retry: 0,
    staleTime: 30_000,
    queryFn: async () => {
      const LIMIT = 200;
      try {
        const { data } = await api.get("/api/orders/mine", {
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
            const pid = it?.productId || it?.product?.id || "";
            if (!pid) continue;
            const qtyRaw = it?.quantity ?? it?.qty ?? 1;
            const qty = Number(qtyRaw);
            map[pid] = (map[pid] || 0) + (Number.isFinite(qty) ? qty : 1);
          }
        }

        return map;
      } catch (e: any) {
        console.error("usePurchasedCounts /api/orders/mine failed:", e?.response?.status, e?.response?.data || e?.message);
        return {};
      }
    },
  });
}

/* =========================================================
   Price bucket UI
========================================================= */

const formatN = (n: number) => "₦" + (Number.isFinite(n) ? n : 0).toLocaleString();
type PriceBucket = { label: string; min: number; max?: number };
type SortKey = "relevance" | "price-asc" | "price-desc";

function generateDynamicPriceBuckets(maxPrice: number, baseStep = 1_000): PriceBucket[] {
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
    return [
      { label: "₦0 – ₦999", min: 0, max: 999 },
      { label: "₦1,000 – ₦4,999", min: 1_000, max: 4_999 },
      { label: "₦5,000 – ₦9,999", min: 5_000, max: 9_999 },
      { label: "₦10,000 – ₦49,999", min: 10_000, max: 49_999 },
      { label: "₦50,000 – ₦99,999", min: 50_000, max: 99_999 },
      { label: "₦100,000+", min: 100_000 },
    ];
  }

  const buckets: PriceBucket[] = [];
  const firstMax = Math.min(baseStep - 1, Math.floor(maxPrice));
  buckets.push({ label: `${formatN(0)} – ${formatN(firstMax)}`, min: 0, max: firstMax });
  if (maxPrice < baseStep) return buckets;

  const thresholds: number[] = [baseStep];
  let mult = 5;
  while (thresholds[thresholds.length - 1] < maxPrice) {
    thresholds.push(thresholds[thresholds.length - 1] * mult);
    mult = mult === 5 ? 2 : 5;
  }

  for (let i = 0; i < thresholds.length; i++) {
    const start = thresholds[i];
    const next = thresholds[i + 1];
    const end = next ? next - 1 : undefined;
    buckets.push({
      label: end ? `${formatN(start)} – ${formatN(end)}` : `${formatN(start)}+`,
      min: start,
      max: end,
    });
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

    const weight = Number.isFinite(cnt) && cnt > 0 ? Math.min(1, Math.log10(cnt + 1) / 3) : 0;
    const score = avg + 0.15 * weight;
    if (score > best) best = score;
  }

  return best;
}

/* =========================================================
   Loader
========================================================= */

function MotionCircleLoader({ label = "Loading…" }: { label?: string }) {
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
          transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
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
          transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
        />
      </div>

      <div className="text-sm text-zinc-600">{label}</div>
    </div>
  );
}

/* =========================================================
   CART (server) helpers — authed uses API, then local mirror
========================================================= */

const AXIOS_COOKIE_CFG = { withCredentials: true as const };

async function setServerCartQty(input: {
  productId: string;
  variantId?: string | null;
  kind?: CartItemKind;
  qty: number;
  titleSnapshot?: string | null;
  imageSnapshot?: string | null;
  unitPriceCache?: number | null;
}) {
  const { data } = await api.get("/api/cart", AXIOS_COOKIE_CFG);
  const items: any[] = Array.isArray((data as any)?.items) ? (data as any).items : [];

  const vid = input.variantId ?? null;
  const kind: CartItemKind = input.kind ?? (vid ? "VARIANT" : "BASE");
  const optionsKey = ""; // quick add

  const found = items.find(
    (x) =>
      String(x.productId) === String(input.productId) &&
      String(x.variantId ?? null) === String(vid) &&
      String(x.kind || "").toUpperCase() === kind &&
      String(x.optionsKey || "") === optionsKey
  );

  if (input.qty <= 0) {
    if (found?.id) await api.delete(`/api/cart/items/${found.id}`, AXIOS_COOKIE_CFG);
    return;
  }

  if (!found?.id) {
    await api.post(
      "/api/cart/items",
      {
        productId: input.productId,
        variantId: vid,
        kind,
        qty: input.qty,
        selectedOptions: [],
        optionsKey,
        titleSnapshot: input.titleSnapshot ?? null,
        imageSnapshot: input.imageSnapshot ?? null,
        unitPriceCache: input.unitPriceCache ?? null,
      },
      AXIOS_COOKIE_CFG
    );
    return;
  }

  await api.patch(`/api/cart/items/${found.id}`, { qty: input.qty }, AXIOS_COOKIE_CFG);
}

/* =========================================================
   Component
========================================================= */

export default function Catalog() {
  const user = useAuthStore((s) => s.user);
  const isSupplier = user?.role === "SUPPLIER";
  const isAuthed = !!user;

  const { openModal } = useModal();
  const nav = useNavigate();
  const qc = useQueryClient();

  const HIDE_OOS = false;
  const includeStr = "brand,category,variants,attributes,offers" as const;

  /* ---------------- Settings (marginPercent) ---------------- */

  const settingsQ = useQuery<number>({
    queryKey: ["settings", "public", "marginPercent"],
    staleTime: 10_000,
    retry: 0,
    queryFn: async () => {
      const { data } = await api.get<PublicSettings>("/api/settings/public");
      const v = Number((data as any)?.marginPercent);
      return Math.max(0, Number.isFinite(v) ? v : 0);
    },
  });

  const settingsMarginPct = Number.isFinite(settingsQ.data as any) ? (settingsQ.data as number) : 0;

  /* ---------------- UI state ---------------- */

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedBucketIdxs, setSelectedBucketIdxs] = useState<number[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("relevance");

  const [query, setQuery] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestRef = useRef<HTMLDivElement | null>(null);

  const [refineOpen, setRefineOpen] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [inStockOnly, setInStockOnly] = useState(true);

  const closeRefine = () => {
    setRefineOpen(false);
    setShowSuggest(false);
  };

  useEffect(() => {
    const prev = document.body.style.overflow;
    if (refineOpen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [refineOpen]);

  /* ---------------- Cart snapshot + syncing ---------------- */

  const [cartVersion, setCartVersion] = useState(0);
  const cartSnapshot = useMemo(() => readCartLines(), [cartVersion]);

  useEffect(() => {
    const onCartUpdated = () => setCartVersion((v) => v + 1);
    window.addEventListener("cart:updated", onCartUpdated);
    return () => window.removeEventListener("cart:updated", onCartUpdated);
  }, []);

  /* ---------------- Products query ---------------- */

  const productsQ = useQuery<Product[]>({
    queryKey: ["products", { include: includeStr, status: "LIVE" }],
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await api.get("/api/products", { params: { include: includeStr, status: "LIVE" } });

      const raw: any[] = Array.isArray(data)
        ? data
        : Array.isArray((data as any)?.data)
          ? (data as any).data
          : [];

      const list: Product[] = (raw || [])
        .filter((x) => x && x.id != null)
        .map((x) => {
          const retailPrice = x.retailPrice != null ? decToNumber(x.retailPrice) : null;

          const variants: Variant[] = Array.isArray(x.variants)
            ? x.variants.map((v: any) => {
                const vRetail = v.retailPrice != null ? decToNumber(v.retailPrice) : null;

                const vOffers: SupplierOfferLite[] = Array.isArray(v.offers)
                  ? v.offers.map((o: any) => ({
                      id: String(o.id),
                      supplierId: o.supplierId ?? o.supplier?.id ?? null,
                      isActive: o.isActive === true,
                      inStock: o.inStock === true,
                      availableQty: Number.isFinite(Number(o.availableQty)) ? Number(o.availableQty) : null,
                      unitPrice: o.unitPrice != null ? decToNumber(o.unitPrice) : null,
                      supplierRatingAvg:
                        o.supplierRatingAvg != null
                          ? decToNumber(o.supplierRatingAvg)
                          : o.supplier?.ratingAvg != null
                            ? decToNumber(o.supplier.ratingAvg)
                            : null,
                      supplierRatingCount:
                        o.supplierRatingCount != null
                          ? Number(o.supplierRatingCount)
                          : o.supplier?.ratingCount != null
                            ? Number(o.supplier.ratingCount)
                            : null,
                    }))
                  : [];

                return {
                  id: String(v.id),
                  sku: v.sku ?? null,
                  retailPrice: vRetail,
                  inStock: v.inStock === true,
                  imagesJson: normalizeImages(v.imagesJson),
                  offers: vOffers,
                };
              })
            : [];

          const baseOffers: SupplierOfferLite[] = Array.isArray(x.supplierProductOffers)
            ? x.supplierProductOffers.map((o: any) => ({
                id: String(o.id),
                supplierId: o.supplierId ?? o.supplier?.id ?? null,
                isActive: o.isActive === true,
                inStock: o.inStock === true,
                availableQty: Number.isFinite(Number(o.availableQty)) ? Number(o.availableQty) : null,
                basePrice: o.basePrice != null ? decToNumber(o.basePrice) : null,
                supplierRatingAvg:
                  o.supplierRatingAvg != null
                    ? decToNumber(o.supplierRatingAvg)
                    : o.supplier?.ratingAvg != null
                      ? decToNumber(o.supplier.ratingAvg)
                      : null,
                supplierRatingCount:
                  o.supplierRatingCount != null
                    ? Number(o.supplierRatingCount)
                    : o.supplier?.ratingCount != null
                      ? Number(o.supplier.ratingCount)
                      : null,
              }))
            : [];

          const catNameRaw = String(x.categoryName ?? x.category?.name ?? "").trim();
          const categoryName = catNameRaw || null;

          return {
            id: String(x.id),
            title: String(x.title ?? ""),
            description: x.description ?? "",
            retailPrice,
            commissionPctInt: Number.isFinite(Number(x.commissionPctInt)) ? Number(x.commissionPctInt) : null,
            inStock: x.inStock === true,
            imagesJson: normalizeImages(x.imagesJson),
            categoryId: x.categoryId ?? x.category?.id ?? null,
            categoryName,
            brand: x.brand ? { id: String(x.brand.id), name: String(x.brand.name) } : null,
            variants,
            supplierProductOffers: baseOffers,
            ratingAvg: x.ratingAvg != null ? decToNumber(x.ratingAvg) : null,
            ratingCount: x.ratingCount != null ? Number(x.ratingCount) : null,
            status: String(x.status ?? ""),
          };
        });

      return list;
    },
  });

  const products = useMemo(() => {
    const list = productsQ.data ?? [];
    return list.filter((p) => isLive(p));
  }, [productsQ.data]);

  /* ---------------- Favorites ---------------- */

  const favQuery = useQuery({
    queryKey: ["favorites", "mine"],
    enabled: !isSupplier && isAuthed,
    retry: (count, e: any) => (Number(e?.response?.status) === 401 ? false : count < 2),
    queryFn: async () => {
      const { data } = await api.get("/api/favorites/mine", { withCredentials: true });
      return new Set((data as any)?.productIds || []);
    },
    initialData: new Set<string>(),
  });

  const isFav = (id: string) => !!favQuery.data?.has(id);

  const toggleFav = useMutation({
    mutationFn: async ({ productId }: { productId: string }) => {
      const { data } = await api.post<{ favorited: boolean }>(
        "/api/favorites/toggle",
        { productId },
        { withCredentials: true }
      );
      return { productId, favorited: !!data.favorited };
    },
    onMutate: async ({ productId }) => {
      const key = ["favorites", "mine"] as const;
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
      if (ctx?.prev) qc.setQueryData(["favorites", "mine"], ctx.prev);
      openModal({ title: "Wishlist", message: "Could not update wishlist. Please try again." });
    },
  });

  /* ---------------- Filters/sort ---------------- */

  const stockRank = (p: Product) => (availableNow(p) ? 0 : 1);
  const priceForFiltering = (p: Product) => getDisplayRetailPrice(p, settingsMarginPct);

  const maxPriceSeen = useMemo(() => {
    const prices = (products ?? [])
      .map((p) => priceForFiltering(p))
      .filter((n) => Number.isFinite(n) && n > 0) as number[];
    return prices.length ? Math.max(...prices) : 0;
  }, [products, settingsMarginPct]);

  const PRICE_BUCKETS = useMemo(() => generateDynamicPriceBuckets(maxPriceSeen, 1_000), [maxPriceSeen]);

  useEffect(() => {
    setSelectedBucketIdxs([]);
  }, [PRICE_BUCKETS.length]);

  const norm = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const suggestions = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return [];
    const scored = products.map((p) => {
      const title = norm(p.title || "");
      const desc = norm(p.description || "");
      const cat = norm(p.categoryName || "");
      const brand = norm(p.brand?.name || "");
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

  const { categories, brands, visiblePriceBuckets, filtered } = useMemo(() => {
    const q = norm(query.trim());

    const baseByQuery = products.filter((p) => {
      if (inStockOnly && !availableNow(p)) return false;
      if (!q) return true;

      const title = norm(p.title || "");
      const desc = norm(p.description || "");
      const cat = norm(p.categoryName || "");
      const brand = norm(p.brand?.name || "");
      return title.includes(q) || desc.includes(q) || cat.includes(q) || brand.includes(q);
    });

    const activeCats = new Set(selectedCategories);
    const activeBuckets = selectedBucketIdxs.map((i) => PRICE_BUCKETS[i]).filter(Boolean);
    const activeBrands = new Set(selectedBrands);

    const baseForCategoryCounts = baseByQuery.filter((p) => {
      const price = priceForFiltering(p);
      const priceOk = activeBuckets.length === 0 ? true : activeBuckets.some((b) => inBucket(price, b));
      const brandOk = activeBrands.size === 0 ? true : activeBrands.has((p.brand?.name || "").trim());
      return priceOk && brandOk;
    });

    const catMap = new Map<string, { id: string; name: string; count: number }>();
    for (const p of baseForCategoryCounts) {
      const id = p.categoryId ?? "uncategorized";
      const name = p.categoryName?.trim() || "Uncategorized";
      const prev = catMap.get(id) ?? { id, name, count: 0 };
      prev.count += 1;
      catMap.set(id, prev);
    }

    const categories = Array.from(catMap.values())
      .filter((c) => c.count > 0)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    const baseForBrandCounts = baseByQuery.filter((p) => {
      const price = priceForFiltering(p);
      const priceOk = activeBuckets.length === 0 ? true : activeBuckets.some((b) => inBucket(price, b));
      const catOk = activeCats.size === 0 ? true : activeCats.has(p.categoryId ?? "uncategorized");
      return priceOk && catOk;
    });

    const brandMap = new Map<string, { name: string; count: number }>();
    for (const p of baseForBrandCounts) {
      const name = (p.brand?.name || "").trim();
      if (!name) continue;
      const prev = brandMap.get(name) ?? { name, count: 0 };
      prev.count += 1;
      brandMap.set(name, prev);
    }

    const brands = Array.from(brandMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );

    const baseForPriceCounts = baseByQuery.filter((p) => {
      const catOk = activeCats.size === 0 ? true : activeCats.has(p.categoryId ?? "uncategorized");
      const brandOk = activeBrands.size === 0 ? true : activeBrands.has((p.brand?.name || "").trim());
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

    let filteredCore = baseByQuery.filter((p) => {
      const price = priceForFiltering(p);
      const catOk = activeCats.size === 0 ? true : activeCats.has(p.categoryId ?? "uncategorized");
      const priceOk = activeBuckets.length === 0 ? true : activeBuckets.some((b) => inBucket(price, b));
      const brandOk = activeBrands.size === 0 ? true : activeBrands.has((p.brand?.name || "").trim());
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

  const purchasedQ = usePurchasedCounts(!isSupplier);

  const recScored = useMemo(() => {
    if (sortKey !== "relevance") return filtered;

    const purchased = purchasedQ.data ?? {};
    const clicks = (() => {
      try {
        const raw = localStorage.getItem("productClicks:v1");
        return raw ? JSON.parse(raw) || {} : {};
      } catch {
        return {};
      }
    })();

    return filtered
      .map((p) => {
        const buy = Math.log1p(purchased[p.id] || 0);
        const clk = Math.log1p(clicks[p.id] || 0);
        const score = 2.5 * buy + 1.5 * clk;
        return { p, score };
      })
      .sort((a, b) => {
        const sr = stockRank(a.p) - stockRank(b.p);
        if (!inStockOnly && sr !== 0) return sr;

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
    if (sortKey === "relevance") return recScored;

    return [...filtered].sort((a, b) => {
      const sr = stockRank(a) - stockRank(b);
      if (!inStockOnly && sr !== 0) return sr;

      const av = productSellable(a, settingsMarginPct) ? 1 : 0;
      const bv = productSellable(b, settingsMarginPct) ? 1 : 0;
      if (bv !== av) return bv - av;

      if (sortKey === "price-asc") return priceForFiltering(a) - priceForFiltering(b);
      if (sortKey === "price-desc") return priceForFiltering(b) - priceForFiltering(a);
      return 0;
    });
  }, [filtered, recScored, sortKey, inStockOnly, settingsMarginPct]);

  /* ---------------- Pagination ---------------- */

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
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const goTo = (p: number) => {
    const clamped = Math.min(Math.max(1, p), totalPages);
    setPage(clamped);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
  const [jumpVal, setJumpVal] = useState<string>("");
  useEffect(() => setJumpVal(""), [totalPages]);

  /* ---------------- Broken images guard ---------------- */

  const [brokenImg, setBrokenImg] = useState<Record<string, boolean>>({});
  const markBroken = (key: string) => setBrokenImg((m) => (m[key] ? m : { ...m, [key]: true }));

  /* =========================================================
     Add to cart — FIXED for guest + authed
     ✅ Guest: ONLY cartModel storage
     ✅ Authed: server update + local mirror via cartModel
========================================================= */

  const setCartQty = async (p: Product, nextQty: number) => {
    try {
      const qty = Math.max(0, Math.floor(Number(nextQty) || 0));
      const unitPriceCache = getDisplayRetailPrice(p, settingsMarginPct) || 0;

      const primaryImg =
        p.imagesJson?.[0] ||
        p.variants?.find((v) => Array.isArray(v.imagesJson) && v.imagesJson[0])?.imagesJson?.[0] ||
        null;

      const optionsKey = ""; // quick add

      if (isAuthed) {
        await setServerCartQty({
          productId: p.id,
          variantId: null,
          kind: "BASE",
          qty,
          titleSnapshot: p.title,
          imageSnapshot: primaryImg,
          unitPriceCache,
        });

        // ✅ local mirror so navbar updates instantly (same as guest)
        upsertCartLine({
          productId: String(p.id),
          variantId: null,
          kind: "BASE",
          optionsKey,
          qty,
          selectedOptions: [],
          titleSnapshot: p.title ?? null,
          imageSnapshot: primaryImg ?? null,
          unitPriceCache: Number.isFinite(unitPriceCache) ? unitPriceCache : 0,
        });

        window.dispatchEvent(new Event("cart:updated"));

        const linesNow = readCartLines();
        showMiniCartToast(
          toMiniCartRows(linesNow),
          { productId: p.id, variantId: null },
          { mode: qty > 0 ? "add" : "remove" }
        );
        return;
      }

      // ✅ guest: cartModel ONLY
      const nextLines = upsertCartLine({
        productId: String(p.id),
        variantId: null,
        kind: "BASE",
        optionsKey,
        qty, // cartModel should remove if qty <= 0
        selectedOptions: [],
        titleSnapshot: p.title ?? null,
        imageSnapshot: primaryImg ?? null,
        unitPriceCache: Number.isFinite(unitPriceCache) ? unitPriceCache : 0,
      });

      window.dispatchEvent(new Event("cart:updated"));

      showMiniCartToast(
        toMiniCartRows(nextLines),
        { productId: p.id, variantId: null },
        { mode: qty > 0 ? "add" : "remove" }
      );
    } catch (err: any) {
      console.error(err);
      openModal({ title: "Cart", message: err?.message || "Could not update cart." });
    }
  };

  /* ---------------- Render guards ---------------- */

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

  /* ---------------- UI small helpers ---------------- */

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
  const tap = "touch-manipulation select-none [-webkit-tap-highlight-color:transparent]";

  const stopTap = (e: any) => {
    e.stopPropagation?.();
  };

  return (
    <SiteLayout>
      <div
        className="mx-auto max-w-7xl px-1 sm:px-4 md:px-8 pt-0 pb-4 md:py-8 -mt-6 md:mt-0"
        onTouchStart={(e) => {
          if (refineOpen) return;
          const x = e.touches[0]?.clientX ?? 0;
          const w = window.innerWidth || 0;
          if (w > 0 && x > w - 24) setTouchStartX(x);
        }}
        onTouchMove={(e) => {
          if (touchStartX == null || refineOpen) return;
          const x = e.touches[0]?.clientX ?? 0;
          const dx = x - touchStartX;
          if (dx < -40) {
            setRefineOpen(true);
            setTouchStartX(null);
          }
        }}
        onTouchEnd={() => setTouchStartX(null)}
      >
        {/* Desktop hero */}
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

        {/* Mobile compact title */}
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

        {/* Context chips */}
        {(hasSearch || anyActiveFilter || sortKey !== "relevance" || pageSize !== 9) && (
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
            {sortKey !== "relevance" && (
              <span className="rounded-full border bg-white/80 px-2.5 py-1 silver-border">
                Sort:{" "}
                <span className="font-semibold">
                  {sortKey === "price-asc" ? "Low → High" : sortKey === "price-desc" ? "High → Low" : "Relevance"}
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

        {/* Body */}
        <div className="mt-2">
          <section className="mt-0 min-w-0">
            {sorted.length === 0 ? (
              <p className="text-sm text-zinc-600">No products match your filters.</p>
            ) : (
              <>
                <div className="-mx-2 sm:mx-0 grid gap-1.5 sm:gap-3 md:gap-4 grid-cols-2 md:grid-cols-3">
                  {pageItems.map((p) => {
                    const fav = isFav(p.id);
                    const bestPrice = priceForFiltering(p);

                    const primaryImgRaw =
                      p.imagesJson?.[0] ||
                      p.variants?.find((v) => Array.isArray(v.imagesJson) && v.imagesJson[0])?.imagesJson?.[0] ||
                      undefined;

                    const hoverImgRaw =
                      p.imagesJson?.[1] ||
                      p.variants?.find((v) => Array.isArray(v.imagesJson) && v.imagesJson[1])?.imagesJson?.[1] ||
                      undefined;

                    const primaryImg = resolveImageUrl(primaryImgRaw);
                    const hoverImg = resolveImageUrl(hoverImgRaw);
                    const hasDifferentHover = !!hoverImg && hoverImg !== primaryImg;

                    const needsOptions = Array.isArray(p.variants) && p.variants.length > 0;

                    const allOffers = collectAllOffers(p);
                    const totalAvail = sumActivePositiveQty(allOffers) || null;

                    const inCart = qtyInCart(cartSnapshot as any, p.id, null);
                    const remaining = totalAvail == null ? null : Math.max(0, totalAvail - inCart);

                    const allowQuickAdd = productSellable(p, settingsMarginPct) && !needsOptions;
                    const currentQty = inCart;
                    const canIncrement = remaining == null ? allowQuickAdd : remaining > 0;

                    const available = availableNow(p);
                    const live = isLive(p);

                    const badge = !live
                      ? { text: "Pending approval", cls: "bg-amber-600/10 text-amber-700 border border-amber-600/20" }
                      : available
                        ? { text: "In stock", cls: "bg-emerald-600/10 text-emerald-700 border border-emerald-600/20" }
                        : { text: "Out of stock", cls: "bg-rose-600/10 text-rose-700 border border-rose-600/20" };

                    return (
                      <motion.article
                        key={p.id}
                        whileHover={{ y: -3 }}
                        className="group w-full rounded-2xl bg-white/90 backdrop-blur overflow-hidden silver-border-grad silver-hover"
                      >
                        <Link to={`/product/${p.id}`} className="block">
                          <div className="relative w-full h-28 sm:h-36 md:h-48 overflow-hidden">
                            <div className="absolute inset-0 grid place-items-center text-zinc-400 text-xs">No image</div>

                            {primaryImg && !brokenImg[`p:${p.id}:${primaryImg}`] ? (
                              <>
                                <img
                                  key={`primary-${p.id}-${primaryImg}`}
                                  src={primaryImg}
                                  alt=""
                                  loading="lazy"
                                  onError={() => markBroken(`p:${p.id}:${primaryImg}`)}
                                  className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                                    hasDifferentHover ? "opacity-100 group-hover:opacity-0" : "opacity-100"
                                  }`}
                                />

                                {hasDifferentHover && hoverImg && !brokenImg[`h:${p.id}:${hoverImg}`] && (
                                  <img
                                    key={`hover-${p.id}-${hoverImg}`}
                                    src={hoverImg}
                                    alt=""
                                    loading="lazy"
                                    onError={() => markBroken(`h:${p.id}:${hoverImg}`)}
                                    className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 opacity-0 group-hover:opacity-100"
                                  />
                                )}
                              </>
                            ) : null}

                            <div className="absolute left-2 top-2">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${badge.cls}`}>
                                {badge.text}
                              </span>
                            </div>
                          </div>
                        </Link>

                        <div className="p-2.5 md:p-4">
                          <Link to={`/product/${p.id}`} className="block">
                            <h3 className="font-semibold text-[12px] md:text-sm leading-tight text-zinc-900 line-clamp-1">
                              {p.title}
                            </h3>
                            <div className="text-[10px] md:text-xs leading-tight text-zinc-500 line-clamp-1">
                              {p.brand?.name ? `${p.brand.name} • ` : ""}
                              {p.categoryName?.trim() || "Uncategorized"}
                            </div>

                            <div className="mt-0.5 flex items-center gap-1.5">
                              <p className="text-sm md:text-base font-semibold">{ngn.format(bestPrice || 0)}</p>
                            </div>
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
                            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 relative z-20 pointer-events-auto">
                              {/* wishlist */}
                              <button
                                type="button"
                                aria-label={fav ? "Remove from wishlist" : "Add to wishlist"}
                                className={`inline-flex items-center gap-1 text-[10px] md:text-xs rounded-full px-2 py-1 transition ${
                                  fav
                                    ? "bg-rose-50 text-rose-600 border border-rose-200"
                                    : "bg-white text-zinc-700 silver-border hover:bg-zinc-50 hover:silver-hover"
                                }`}
                                onClick={(e) => {
                                  stopTap(e);
                                  if (!isAuthed) {
                                    openModal({ title: "Wishlist", message: "Please login to use the wishlist." });
                                    return;
                                  }
                                  toggleFav.mutate({ productId: p.id });
                                }}
                                title={fav ? "Remove from wishlist" : "Add to wishlist"}
                              >
                                {fav ? <Heart size={14} /> : <HeartOff size={14} />}
                                <span>{fav ? "Wishlisted" : "Wishlist"}</span>
                              </button>

                              {needsOptions ? (
                                <Link
                                  to={`/product/${p.id}`}
                                  className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-[10px] md:text-xs border bg-zinc-500 text-white border-zinc-900 hover:opacity-90"
                                  onClick={(e) => e.stopPropagation?.()}
                                  aria-label="Choose options"
                                  title="Choose options"
                                >
                                  Choose opts.
                                </Link>
                              ) : currentQty > 0 ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onPointerDown={stopTap}
                                    onTouchStart={stopTap}
                                    onClick={(e) => {
                                      stopTap(e);
                                      setCartQty(p, currentQty - 1);
                                    }}
                                    className={`${tap} w-9 h-9 md:w-7 md:h-7 rounded-full bg-white text-[14px] flex items-center justify-center text-zinc-700 active:scale-95 transition silver-border hover:silver-hover`}
                                    aria-label="Decrease quantity"
                                  >
                                    −
                                  </button>

                                  <span className="min-w-[18px] text-center text-[11px] font-semibold text-zinc-800">
                                    {currentQty}
                                  </span>

                                  <button
                                    type="button"
                                    onPointerDown={stopTap}
                                    onTouchStart={stopTap}
                                    onClick={(e) => {
                                      stopTap(e);
                                      if (canIncrement) setCartQty(p, currentQty + 1);
                                    }}
                                    disabled={!allowQuickAdd || !canIncrement}
                                    className={`${tap} w-9 h-9 md:w-7 md:h-7 rounded-full border border-zinc-900 bg-zinc-900 text-white text-[14px] flex items-center justify-center disabled:opacity-40 active:scale-95 transition`}
                                    aria-label="Increase quantity"
                                  >
                                    +
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  disabled={!allowQuickAdd}
                                  onPointerDown={stopTap}
                                  onTouchStart={stopTap}
                                  onClick={(e) => {
                                    stopTap(e);
                                    setCartQty(p, 1);
                                  }}
                                  className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] md:text-xs border transition ${
                                    allowQuickAdd
                                      ? "bg-zinc-900 text-white border-zinc-900 hover:opacity-90"
                                      : "bg-white text-zinc-400 border-zinc-200 cursor-not-allowed"
                                  }`}
                                  aria-label="Add to cart"
                                  title={allowQuickAdd ? "Add to cart" : "Not available"}
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

                {/* Pagination (kept same as your draft) */}
                <div className="mt-5 md:mt-8">
                  {/* Mobile */}
                  <div className="md:hidden rounded-2xl bg-white/85 backdrop-blur p-3 shadow-sm silver-border">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold tracking-tight text-zinc-800">
                          Showing {start + 1}-{Math.min(start + pageSize, sorted.length)} of {sorted.length}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          Page {currentPage} / {totalPages}
                        </div>
                      </div>
                    </div>

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

                    <form
                      className="mt-3 flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const n = Number(jumpVal);
                        if (Number.isFinite(n)) goTo(n);
                      }}
                    >
                      <label className="text-[11px] font-semibold tracking-tight text-zinc-700 shrink-0">Go to</label>
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

                  {/* Desktop */}
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

      {/* Refine Drawer */}
      {refineOpen && (
        <motion.div
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/40" onClick={closeRefine} />

          <motion.div
            className="absolute inset-y-0 right-0 w-[88%] max-w-sm bg-white rounded-tl-3xl rounded-bl-3xl shadow-2xl overflow-y-auto p-4 flex flex-col gap-4 silver-border-grad"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
          >
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
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActiveIdx((i) => Math.max(i - 1, 0));
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      const pick = suggestions[activeIdx];
                      if (pick) {
                        closeRefine();
                        nav(`/product/${pick.id}`);
                      }
                      setShowSuggest(false);
                    } else if (e.key === "Escape") {
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

                      return (
                        <li key={p.id} className="mb-2 last:mb-0">
                          <button
                            type="button"
                            className={`w-full text-left flex items-center gap-3 px-2.5 py-2.5 rounded-xl hover:bg-black/5 ${active ? "bg-black/5" : ""
                              }`}
                            onClick={() => {
                              closeRefine();
                              nav(`/product/${p.id}`);
                            }}
                          >
                            {p.imagesJson?.[0] ? (
                              <img
                                src={resolveImageUrl(p.imagesJson?.[0])}
                                alt=""
                                aria-hidden="true"
                                onError={(e) => e.currentTarget.remove()}
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
                                {ngn.format(minPrice || 0)}
                                {p.categoryName ? ` • ${p.categoryName}` : ""}
                                {p.brand?.name ? ` • ${p.brand.name}` : ""}
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
                    setQuery("");
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
                          ? "bg-zinc-900 text-white"
                          : "bg-white hover:bg-black/5 text-zinc-800 silver-border hover:silver-hover"
                          }`}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className={`ml-2 text-[11px] ${checked ? "text-white/90" : "text-zinc-600"}`}>
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
                            ? "bg-zinc-900 text-white"
                            : "bg-white hover:bg-black/5 text-zinc-800 silver-border hover:silver-hover"
                            }`}
                        >
                          <span className="truncate">{b.name}</span>
                          <span className={`ml-2 text-[11px] ${checked ? "text-white/90" : "text-zinc-600"}`}>
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
                          ? "bg-zinc-900 text-white"
                          : "bg-white hover:bg-black/5 text-zinc-800 silver-border hover:silver-hover"
                          }`}
                      >
                        <span>{bucket.label}</span>
                        <span className={`ml-2 text-[11px] ${checked ? "text-white/90" : "text-zinc-600"}`}>
                          ({count})
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

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