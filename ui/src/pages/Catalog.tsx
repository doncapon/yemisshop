// src/pages/Catalog.tsx
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client.js";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { useModal } from "../components/ModalProvider";
import {
  Search,
  SlidersHorizontal,
  LayoutGrid,
  ArrowUpDown,
  X,
  ChevronRight,
  ChevronDown,
  Heart,
} from "lucide-react";

import SiteLayout from "../layouts/SiteLayout.js";
import { showMiniCartToast } from "../components/cart/MiniCartToast";
import { readCartLines, upsertCartLine, qtyInCart, toMiniCartRows } from "../utils/cartModel";

import { AnimatePresence, motion } from "framer-motion";

/* =========================================================
   Types — aligned to public products route
========================================================= */

type CartItemKind = "BASE" | "VARIANT";

type SupplierOfferLite = {
  id: string;
  supplierId?: string | null;

  isActive?: boolean;
  inStock?: boolean;
  availableQty?: number | null;

  basePrice?: number | null;
  unitPrice?: number | null;

  currency?: string | null;
  leadDays?: number | null;

  supplierRatingAvg?: number | null;
  supplierRatingCount?: number | null;
};

type Variant = {
  id: string;
  sku?: string | null;
  retailPrice?: number | null;
  inStock?: boolean | null;
  imagesJson?: string[];
  availableQty?: number | null;
  offers?: SupplierOfferLite[];
};

type Product = {
  id: string;
  title: string;
  description?: string;

  sku?: string | null;

  retailPrice?: number | null;
  computedRetailPrice?: number | null;
  autoPrice?: number | null;
  displayBasePrice?: number | null;
  offersFrom?: number | null;
  commissionPctInt?: number | null;

  inStock?: boolean | null;
  availableQty?: number | null;
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

type CategoryNode = {
  id: string;
  name: string;
  slug?: string;
  parentId?: string | null;
  position?: number;
  children: CategoryNode[];
};

type CategoryFlat = {
  id: string;
  name: string;
  parentId?: string | null;
  position?: number | null;
  isActive?: boolean | null;
  children?: CategoryFlat[];
};

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

/* =========================================================
   Small utilities
========================================================= */

function decToNumber(v: any): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeImages(val: any): string[] {
  if (!val) return [];

  const out: string[] = [];

  const pushOne = (input: any) => {
    if (input == null) return;

    if (Array.isArray(input)) {
      for (const item of input) pushOne(item);
      return;
    }

    if (typeof input === "object") {
      const candidate =
        input.url ??
        input.src ??
        input.image ??
        input.imageUrl ??
        input.absoluteUrl ??
        null;

      if (candidate != null) pushOne(candidate);
      return;
    }

    if (typeof input === "string") {
      const s = input.trim();
      if (!s) return;

      if (
        (s.startsWith("[") && s.endsWith("]")) ||
        (s.startsWith("{") && s.endsWith("}"))
      ) {
        try {
          pushOne(JSON.parse(s));
          return;
        } catch {
          //
        }
      }

      const parts = s.split(/[\n,]/g).map((t) => t.trim()).filter(Boolean);
      if (parts.length > 1) {
        for (const p of parts) pushOne(p);
        return;
      }

      out.push(s);
    }
  };

  pushOne(val);

  return out.filter(Boolean);
}

const isLive = (x?: { status?: string | null }) => String(x?.status ?? "").trim().toUpperCase() === "LIVE";

/* =========================================================
   Stock + offers helpers
========================================================= */

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
    for (const v of p.variants) {
      if (Array.isArray(v.offers)) out.push(...v.offers);
    }
  }
  return out;
}

function availableNow(p: Product): boolean {
  const directQty = Number(p.availableQty);
  if (Number.isFinite(directQty) && directQty > 0) return true;

  const offers = collectAllOffers(p);

  if (offers.some((o) => o?.isActive === true && o?.inStock === true)) return true;

  for (const o of offers) {
    if (!o || o.isActive === false) continue;
    const q = Number(o.availableQty);
    if (Number.isFinite(q) && q > 0) return true;
  }

  if (p.inStock === true) return true;
  if (Array.isArray(p.variants) && p.variants.some((v) => v.inStock === true || (Number(v.availableQty) || 0) > 0)) {
    return true;
  }

  return false;
}

/* =========================================================
   Pricing
========================================================= */

const round2 = (n: number) => Math.round(n * 100) / 100;

function applyMargin(raw: number | null | undefined, marginPercent: number): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const m = Math.max(0, Number(marginPercent) || 0);
  const out = round2(n * (1 + m / 100));
  return Number.isFinite(out) && out > 0 ? out : null;
}

function cheapestActiveBaseOfferPrice(p: Product): number | null {
  const offers = Array.isArray(p.supplierProductOffers) ? p.supplierProductOffers : [];
  let best: number | null = null;

  for (const o of offers) {
    if (!o || o.isActive === false || !offerStockOk(o)) continue;
    const raw = o.basePrice ?? o.unitPrice ?? null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (best == null || n < best) best = n;
  }

  return best;
}

function cheapestActiveVariantOfferPrice(p: Product): number | null {
  let best: number | null = null;

  const variants = Array.isArray(p.variants) ? p.variants : [];
  for (const v of variants) {
    const offers = Array.isArray(v.offers) ? v.offers : [];
    for (const o of offers) {
      if (!o || o.isActive === false || !offerStockOk(o)) continue;
      const raw = o.unitPrice ?? o.basePrice ?? null;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (best == null || n < best) best = n;
    }
  }

  return best;
}

function cheapestActiveAnyOfferPrice(p: Product): number | null {
  const offers = collectAllOffers(p);
  let best: number | null = null;

  for (const o of offers) {
    if (!o || o.isActive === false || !offerStockOk(o)) continue;
    const raw = o.unitPrice ?? o.basePrice ?? null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (best == null || n < best) best = n;
  }

  return best;
}

function getDisplayRetailPrice(p: Product, marginPercent: number): number {
  const apiComputed = Number(p.computedRetailPrice);
  if (Number.isFinite(apiComputed) && apiComputed > 0) return apiComputed;

  const hasOptions = Array.isArray(p.variants) && p.variants.length > 0;

  if (hasOptions) {
    const baseRaw = cheapestActiveBaseOfferPrice(p);
    const baseRetail = applyMargin(baseRaw, marginPercent);
    if (baseRetail != null) return baseRetail;

    const varRaw = cheapestActiveVariantOfferPrice(p);
    const varRetail = applyMargin(varRaw, marginPercent);
    if (varRetail != null) return varRetail;
  } else {
    const anyRaw = cheapestActiveAnyOfferPrice(p);
    const anyRetail = applyMargin(anyRaw, marginPercent);
    if (anyRetail != null) return anyRetail;
  }

  const offersFromRetail = applyMargin(p.offersFrom, marginPercent);
  if (offersFromRetail != null) return offersFromRetail;

  const raw =
    Number(p.retailPrice) > 0
      ? Number(p.retailPrice)
      : Number(p.autoPrice) > 0
        ? Number(p.autoPrice)
        : Number(p.displayBasePrice) > 0
          ? Number(p.displayBasePrice)
          : 0;

  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function priceForFiltering(p: Product, marginPercent: number): number {
  return getDisplayRetailPrice(p, marginPercent);
}

/* =========================================================
   Sellable flag
========================================================= */

function productSellable(p: Product, marginPercent: number): boolean {
  if (!isLive(p)) return false;
  if (!availableNow(p)) return false;
  const price = getDisplayRetailPrice(p, marginPercent);
  return Number.isFinite(price) && price > 0;
}

/* =========================================================
   API origin for images
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
      //
    }
  }

  return window.location.origin;
}

const API_ORIGIN = getApiOrigin();

function resolveImageUrl(input?: any): string | undefined {
  if (input == null) return undefined;

  if (Array.isArray(input)) {
    for (const item of input) {
      const resolved = resolveImageUrl(item);
      if (resolved) return resolved;
    }
    return undefined;
  }

  if (typeof input === "object") {
    const candidate =
      input.url ??
      input.src ??
      input.image ??
      input.imageUrl ??
      input.absoluteUrl ??
      null;

    return candidate ? resolveImageUrl(candidate) : undefined;
  }

  const s = String(input ?? "").trim();
  if (!s) return undefined;

  if (
    (s.startsWith("[") && s.endsWith("]")) ||
    (s.startsWith("{") && s.endsWith("}"))
  ) {
    try {
      return resolveImageUrl(JSON.parse(s));
    } catch {
      //
    }
  }

  if (/^(https?:\/\/|data:|blob:)/i.test(s)) return s;
  if (s.startsWith("//")) return `${window.location.protocol}${s}`;

  if (s.startsWith("/")) {
    if (s.startsWith("/uploads/") || s.startsWith("/api/uploads/")) return `${API_ORIGIN}${s}`;
    return `${window.location.origin}${s}`;
  }

  if (s.startsWith("uploads/") || s.startsWith("api/uploads/")) {
    return `${API_ORIGIN}/${s.replace(/^\/+/, "")}`;
  }

  return `${window.location.origin}/${s.replace(/^\/+/, "")}`;
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
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      try {
        const { data } = await api.get("/api/orders/mine", {
          withCredentials: true,
          params: { limit: 200 },
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
      } catch {
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
   Category tree helpers
========================================================= */

function flattenCategoryTree(input: any): CategoryFlat[] {
  const out: CategoryFlat[] = [];

  const walk = (n: any, parentId: string | null) => {
    if (!n) return;

    const id = String(n.id ?? "");
    const name = String(n.name ?? "");
    if (!id || !name) return;

    const node: CategoryFlat = {
      id,
      name,
      parentId: n.parentId != null ? String(n.parentId) : parentId,
      position: Number.isFinite(Number(n.position)) ? Number(n.position) : 0,
      isActive: n.isActive != null ? !!n.isActive : true,
    };

    out.push(node);

    const kids: any[] = Array.isArray(n.children) ? n.children : Array.isArray(n.items) ? n.items : [];
    for (const c of kids) walk(c, id);
  };

  const arr: any[] = Array.isArray(input) ? input : Array.isArray(input?.data) ? input.data : [];
  for (const n of arr) walk(n, null);

  return out;
}

function buildCategoryForest(list: CategoryFlat[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();

  for (const c of list) {
    const id = String(c.id);
    const name = String(c.name);
    const parentId = c.parentId != null ? String(c.parentId) : null;
    const position = Number.isFinite(Number(c.position)) ? Number(c.position) : 0;
    byId.set(id, { id, name, parentId, position, children: [] });
  }

  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (nodes: CategoryNode[]) => {
    nodes.sort((a, b) => {
      const pa = Number.isFinite(a.position) ? a.position : 0;
      const pb = Number.isFinite(b.position) ? b.position : 0;
      if (pa !== pb) return (pa as number) - (pb as number);
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    for (const n of nodes) sortRec(n.children);
  };

  sortRec(roots);
  return roots;
}

function buildDescendantMap(roots: CategoryNode[]) {
  const byId = new Map<string, CategoryNode>();
  const childrenById = new Map<string, string[]>();

  const walk = (n: CategoryNode) => {
    byId.set(n.id, n);
    childrenById.set(n.id, n.children.map((c) => c.id));
    for (const c of n.children) walk(c);
  };

  for (const r of roots) walk(r);

  const allDescCache = new Map<string, Set<string>>();
  const getAllDesc = (id: string): Set<string> => {
    if (allDescCache.has(id)) return allDescCache.get(id)!;

    const out = new Set<string>();
    const stack = [...(childrenById.get(id) || [])];

    while (stack.length) {
      const x = stack.pop()!;
      if (out.has(x)) continue;
      out.add(x);
      const kids = childrenById.get(x) || [];
      for (const k of kids) stack.push(k);
    }

    allDescCache.set(id, out);
    return out;
  };

  return { byId, childrenById, getAllDesc };
}

function computeCategoryCountsFromProducts(products: Product[]) {
  const map = new Map<string, { id: string; name: string; count: number }>();

  for (const p of products) {
    const id = p.categoryId ?? "uncategorized";
    const name = p.categoryName?.trim() || "Uncategorized";
    const prev = map.get(id) ?? { id, name, count: 0 };
    prev.count += 1;
    map.set(id, prev);
  }

  return map;
}

function aggregateCountsToParents(roots: CategoryNode[], directCounts: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();

  const dfs = (n: CategoryNode): number => {
    let sum = directCounts.get(n.id) || 0;
    for (const c of n.children) sum += dfs(c);
    out.set(n.id, sum);
    return sum;
  };

  for (const r of roots) dfs(r);

  return out;
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
   CART helpers
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
  const optionsKey = "";

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

  await api.patch(
    `/api/cart/items/${found.id}`,
    {
      qty: input.qty,
      titleSnapshot: input.titleSnapshot ?? null,
      imageSnapshot: input.imageSnapshot ?? null,
      unitPriceCache: input.unitPriceCache ?? null,
    },
    AXIOS_COOKIE_CFG
  );
}

function TruncatedTitle({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const ref = React.useRef<HTMLHeadingElement | null>(null);
  const [isTruncated, setIsTruncated] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const check = () => {
      const truncated = el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
      setIsTruncated(truncated);
    };

    check();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(check);
      ro.observe(el);
      return () => ro.disconnect();
    }

    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [text]);

  return (
    <h3
      ref={ref}
      className={className}
      title={isTruncated ? text : undefined}
    >
      {text}
    </h3>
  );
}

/* =========================================================
   Component
========================================================= */

export default function Catalog() {
  const user = useAuthStore((s) => s.user);
  const role = String(user?.role ?? "");
  const isSupplier = role === "SUPPLIER";
  const isAuthed = !!user?.id;

  const { openModal } = useModal();
  const nav = useNavigate();
  const qc = useQueryClient();
  const location = useLocation();

  const HIDE_OOS = false;
  const includeStr = "brand,category,variants,attributes,offers" as const;

  /* ---------------- Settings ---------------- */
  const settingsQ = useQuery<number>({
    queryKey: ["settings", "public", "marginPercent"],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
    queryFn: async () => {
      const { data } = await api.get<PublicSettings>("/api/settings/public");
      const v = Number((data as any)?.marginPercent);
      return Math.max(0, Number.isFinite(v) ? v : 0);
    },
  });

  const marginPercent = Number.isFinite(settingsQ.data as any) ? (settingsQ.data as number) : 0;

  /* ---------------- UI state ---------------- */

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedBucketIdxs, setSelectedBucketIdxs] = useState<number[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("relevance");

  const [query, setQuery] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const [refineOpen, setRefineOpen] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [inStockOnly, setInStockOnly] = useState(true);
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});

  const desktopInputRef = useRef<HTMLInputElement | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);
  const desktopSuggestRef = useRef<HTMLDivElement | null>(null);
  const mobileSuggestRef = useRef<HTMLDivElement | null>(null);
  const restoredScrollKeyRef = useRef<string | null>(null);

  const navigatingRef = useRef(false);
  const productClicksRef = useRef<Record<string, number>>({});
  const deferredQuery = useDeferredValue(query);

  function isFromCardAction(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    return !!el?.closest('[data-stop-card-nav="true"]');
  }

  const goToProduct = useCallback((productId: string) => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;

    setRefineOpen(false);
    setShowSuggest(false);
    setTouchStartX(null);

    window.requestAnimationFrame(() => {
      nav(`/products/${productId}`, {
        state: {
          from: location.pathname + location.search,
          restoreScrollY: window.scrollY,
        },
      });

      window.setTimeout(() => {
        navigatingRef.current = false;
      }, 250);
    });
  }, [location.pathname, location.search, nav]);

  const closeRefine = () => {
    setRefineOpen(false);
    setShowSuggest(false);
    setTouchStartX(null);
  };

  /* ---------------- Navigation / overlay stability ---------------- */

  useEffect(() => {
    try {
      const raw = localStorage.getItem("productClicks:v1");
      productClicksRef.current = raw ? JSON.parse(raw) || {} : {};
    } catch {
      productClicksRef.current = {};
    }
  }, []);

  useEffect(() => {
    navigatingRef.current = false;
    setRefineOpen(false);
    setShowSuggest(false);
    setTouchStartX(null);
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, [location.key]);

  useEffect(() => {
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;

    if (refineOpen) {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [refineOpen]);

  useEffect(() => {
    const resetUi = () => {
      setRefineOpen(false);
      setShowSuggest(false);
      setTouchStartX(null);
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };

    const onPageShow = (ev: PageTransitionEvent) => {
      if (ev.persisted) resetUi();
    };

    const onPageHide = () => resetUi();

    window.addEventListener("pageshow", onPageShow as any);
    window.addEventListener("pagehide", onPageHide as any);

    return () => {
      window.removeEventListener("pageshow", onPageShow as any);
      window.removeEventListener("pagehide", onPageHide as any);
    };
  }, []);

  /* ---------------- Cart snapshot + syncing ---------------- */

  const [cartVersion, setCartVersion] = useState(0);
  const cartSnapshot = useMemo(() => readCartLines(), [cartVersion]);

  useEffect(() => {
    const onCartUpdated = () => setCartVersion((v) => v + 1);
    window.addEventListener("cart:updated", onCartUpdated);
    return () => window.removeEventListener("cart:updated", onCartUpdated);
  }, []);

  /* ---------------- Server cart sync ---------------- */

  const serverSyncPendingRef = useRef<Record<string, boolean>>({});
  const serverSyncQueuedQtyRef = useRef<Record<string, number | null>>({});

  const syncServerQtyCoalesced = (p: Product, qty: number, unitPriceCache: number, primaryImg: string | null) => {
    if (!isAuthed) return;

    const key = `BASE:${p.id}`;
    const pending = !!serverSyncPendingRef.current[key];
    serverSyncQueuedQtyRef.current[key] = qty;
    if (pending) return;

    const run = async () => {
      const desired = serverSyncQueuedQtyRef.current[key];
      serverSyncQueuedQtyRef.current[key] = null;
      if (desired == null) return;

      serverSyncPendingRef.current[key] = true;
      try {
        await setServerCartQty({
          productId: p.id,
          variantId: null,
          kind: "BASE",
          qty: desired,
          titleSnapshot: p.title,
          imageSnapshot: primaryImg,
          unitPriceCache,
        });
      } catch (e: any) {
        console.error("Cart sync failed:", e?.response?.status, e?.response?.data || e?.message);
      } finally {
        serverSyncPendingRef.current[key] = false;
        if (serverSyncQueuedQtyRef.current[key] != null) void run();
      }
    };

    void run();
  };

  /* ---------------- Products query ---------------- */

  const productsQ = useQuery<Product[]>({
    queryKey: ["products", { include: includeStr, status: "LIVE" }],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const { data } = await api.get("/api/products", {
        params: { include: includeStr, status: "LIVE" },
      });

      const raw: any[] = Array.isArray(data)
        ? data
        : Array.isArray((data as any)?.data)
          ? (data as any).data
          : [];

      return (raw || [])
        .filter((x) => x && x.id != null)
        .map((x) => {
          const variants: Variant[] = Array.isArray(x.variants)
            ? x.variants.map((v: any) => ({
              id: String(v.id),
              sku: v.sku ?? null,
              retailPrice: v.retailPrice != null ? decToNumber(v.retailPrice) : null,
              inStock: v.inStock === true,
              imagesJson: normalizeImages(v.imagesJson),
              availableQty: Number.isFinite(Number(v.availableQty)) ? Number(v.availableQty) : null,
              offers: Array.isArray(v.offers)
                ? v.offers.map((o: any) => ({
                  id: String(o.id),
                  supplierId: o.supplierId ?? o.supplier?.id ?? null,
                  isActive: o.isActive === true,
                  inStock: o.inStock === true,
                  availableQty: Number.isFinite(Number(o.availableQty)) ? Number(o.availableQty) : null,
                  unitPrice: o.unitPrice != null ? decToNumber(o.unitPrice) : null,
                  basePrice: o.basePrice != null ? decToNumber(o.basePrice) : null,
                  currency: o.currency ?? "NGN",
                  leadDays: Number.isFinite(Number(o.leadDays)) ? Number(o.leadDays) : null,
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
                : [],
            }))
            : [];

          const baseSource =
            (Array.isArray((x as any).supplierProductOffers) && x.supplierProductOffers) ||
            (Array.isArray((x as any).supplierOffers) && (x as any).supplierOffers) ||
            [];

          const baseOffers: SupplierOfferLite[] = baseSource.map((o: any) => ({
            id: String(o.id),
            supplierId: o.supplierId ?? o.supplier?.id ?? null,
            isActive: o.isActive === true,
            inStock: o.inStock === true,
            availableQty: Number.isFinite(Number(o.availableQty)) ? Number(o.availableQty) : null,
            basePrice: o.basePrice != null ? decToNumber(o.basePrice) : null,
            unitPrice: o.unitPrice != null ? decToNumber(o.unitPrice) : null,
            currency: o.currency ?? "NGN",
            leadDays: Number.isFinite(Number(o.leadDays)) ? Number(o.leadDays) : null,
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
          }));

          const catNameRaw = String(x.categoryName ?? x.category?.name ?? "").trim();

          return {
            id: String(x.id),
            title: String(x.title ?? ""),
            description: x.description ?? "",
            sku: x.sku ?? null,
            retailPrice: x.retailPrice != null ? decToNumber(x.retailPrice) : null,
            computedRetailPrice: x.computedRetailPrice != null ? decToNumber(x.computedRetailPrice) : null,
            autoPrice: x.autoPrice != null ? decToNumber(x.autoPrice) : null,
            displayBasePrice: x.displayBasePrice != null ? decToNumber(x.displayBasePrice) : null,
            offersFrom: x.offersFrom != null ? decToNumber(x.offersFrom) : null,
            commissionPctInt: Number.isFinite(Number(x.commissionPctInt)) ? Number(x.commissionPctInt) : null,
            inStock: x.inStock === true,
            availableQty: Number.isFinite(Number(x.availableQty)) ? Number(x.availableQty) : null,
            imagesJson: normalizeImages(x.imagesJson),
            categoryId: x.categoryId ?? x.category?.id ?? null,
            categoryName: catNameRaw || null,
            brand: x.brand ? { id: String(x.brand.id), name: String(x.brand.name) } : null,
            variants,
            supplierProductOffers: baseOffers,
            ratingAvg: x.ratingAvg != null ? decToNumber(x.ratingAvg) : null,
            ratingCount: x.ratingCount != null ? Number(x.ratingCount) : null,
            status: String(x.status ?? ""),
          } satisfies Product;
        });
    },
  });

  const products = useMemo(() => {
    const list = productsQ.data ?? [];
    return list.filter((p) => isLive(p));
  }, [productsQ.data]);

  useEffect(() => {
    const state = location.state as any;
    const y = state?.restoreScrollY;

    if (typeof y !== "number") return;
    if (restoredScrollKeyRef.current === location.key) return;

    restoredScrollKeyRef.current = location.key;

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: "auto" });
    });
  }, [location.key, location.state]);

  /* ---------------- Categories ---------------- */

  const categoriesTreeQ = useQuery<CategoryNode[]>({
    queryKey: ["categories", "tree"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
    queryFn: async () => {
      const attempts = [
        () => api.get("/api/categories", { params: { include: "children" } }),
        () => api.get("/api/categories/tree"),
        () => api.get("/api/categories", { params: { tree: 1 } }),
        () => api.get("/api/categories"),
      ];

      for (const fn of attempts) {
        try {
          const res = await fn();
          const payload = (res as any)?.data?.data ?? (res as any)?.data ?? [];
          const flat = flattenCategoryTree(payload);
          if (!flat.length) continue;
          return buildCategoryForest(flat.filter((c) => c.isActive !== false));
        } catch {
          //
        }
      }

      return [];
    },
  });

  const categoryForest = categoriesTreeQ.data ?? [];
  const catTreeHelpers = useMemo(() => {
    if (!categoryForest.length) return null;
    return buildDescendantMap(categoryForest);
  }, [categoryForest]);

  /* ---------------- Favorites ---------------- */

  const favQuery = useQuery({
    queryKey: ["favorites", "mine"],
    enabled: !isSupplier && isAuthed,
    retry: (count, e: any) => (Number(e?.response?.status) === 401 ? false : count < 2),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await api.get("/api/favorites/mine", { withCredentials: true });

      const payload: any = data ?? {};
      let ids: string[] = [];

      if (Array.isArray(payload.productIds)) ids = payload.productIds;
      else if (Array.isArray(payload.data?.productIds)) ids = payload.data.productIds;
      else if (Array.isArray(payload.data)) {
        ids = payload.data.map((x: any) => x?.productId ?? x?.id ?? null).filter(Boolean);
      }

      return new Set(ids.map(String));
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["favorites"] });
      window.dispatchEvent(new Event("wishlist:updated"));
    },
  });

  /* ---------------- Filters/sort ---------------- */

  const stockRank = (p: Product) => (availableNow(p) ? 0 : 1);

  const maxPriceSeen = useMemo(() => {
    const prices = (products ?? [])
      .map((p) => priceForFiltering(p, marginPercent))
      .filter((n) => Number.isFinite(n) && n > 0) as number[];
    return prices.length ? Math.max(...prices) : 0;
  }, [products, marginPercent]);

  const PRICE_BUCKETS = useMemo(() => generateDynamicPriceBuckets(maxPriceSeen, 1_000), [maxPriceSeen]);

  useEffect(() => {
    setSelectedBucketIdxs([]);
  }, [PRICE_BUCKETS.length]);

  const norm = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const suggestions = useMemo(() => {
    const q = norm(deferredQuery.trim());
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
  }, [products, deferredQuery]);

  const selectedCategoryEffective = useMemo(() => {
    const base = new Set(selectedCategories);
    if (!catTreeHelpers) return base;
    for (const id of selectedCategories) {
      const desc = catTreeHelpers.getAllDesc(id);
      for (const d of desc) base.add(d);
    }
    return base;
  }, [selectedCategories, catTreeHelpers]);

  const { categories, brands, visiblePriceBuckets, filtered, categoryTreeUi } = useMemo(() => {
    const q = norm(deferredQuery.trim());

    const categoryQueryMatch =
      catTreeHelpers && deferredQuery
        ? [...catTreeHelpers.byId.values()].filter((c) => norm(c.name).includes(norm(query)))
        : [];

    const baseByQuery = products.filter((p) => {
      if (inStockOnly && !availableNow(p)) return false;
      if (!q) return true;

      const title = norm(p.title || "");
      const desc = norm(p.description || "");
      const cat = norm(p.categoryName || "");
      const brand = norm(p.brand?.name || "");

      const categoryHit =
        categoryQueryMatch.length &&
        categoryQueryMatch.some((c) => p.categoryId === c.id || catTreeHelpers?.getAllDesc(c.id)?.has(p.categoryId ?? ""));

      return title.includes(q) || desc.includes(q) || cat.includes(q) || brand.includes(q) || categoryHit;
    });

    const activeCatsEffective = selectedCategoryEffective;
    const activeBuckets = selectedBucketIdxs.map((i) => PRICE_BUCKETS[i]).filter(Boolean);
    const activeBrands = new Set(selectedBrands);

    const baseForCategoryCounts = baseByQuery.filter((p) => {
      const price = priceForFiltering(p, marginPercent);
      const priceOk = activeBuckets.length === 0 ? true : activeBuckets.some((b) => inBucket(price, b));
      const brandOk = activeBrands.size === 0 ? true : activeBrands.has((p.brand?.name || "").trim());
      return priceOk && brandOk;
    });

    const catCountsMap = computeCategoryCountsFromProducts(baseForCategoryCounts);
    const categories = Array.from(catCountsMap.values())
      .filter((c) => c.count > 0)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    let categoryTreeUi:
      | Array<{ node: CategoryNode; count: number; depth: number; hasChildren: boolean }>
      | null = null;

    if (categoryForest.length && catTreeHelpers) {
      const directCounts = new Map<string, number>();
      for (const [id, v] of catCountsMap.entries()) {
        if (id === "uncategorized") continue;
        directCounts.set(id, v.count);
      }

      const aggregated = aggregateCountsToParents(categoryForest, directCounts);

      const rows: Array<{ node: CategoryNode; count: number; depth: number; hasChildren: boolean }> = [];

      const walk = (n: CategoryNode, depth: number) => {
        const count = aggregated.get(n.id) || 0;
        if (count <= 0) return;

        rows.push({ node: n, count, depth, hasChildren: n.children.length > 0 });

        const isExpanded = !!expandedCats[n.id];
        if (n.children.length > 0 && isExpanded) {
          for (const c of n.children) walk(c, depth + 1);
        }
      };

      for (const r of categoryForest) walk(r, 0);
      categoryTreeUi = rows.length ? rows : null;
    }

    const baseForBrandCounts = baseByQuery.filter((p) => {
      const price = priceForFiltering(p, marginPercent);
      const priceOk = activeBuckets.length === 0 ? true : activeBuckets.some((b) => inBucket(price, b));
      const catOk = activeCatsEffective.size === 0 ? true : activeCatsEffective.has(p.categoryId ?? "uncategorized");
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
      const catOk = activeCatsEffective.size === 0 ? true : activeCatsEffective.has(p.categoryId ?? "uncategorized");
      const brandOk = activeBrands.size === 0 ? true : activeBrands.has((p.brand?.name || "").trim());
      return catOk && brandOk;
    });

    const priceCounts = PRICE_BUCKETS.map(
      (b) => baseForPriceCounts.filter((p) => inBucket(priceForFiltering(p, marginPercent), b)).length
    );

    const visiblePriceBuckets = PRICE_BUCKETS.map((b, i) => ({ bucket: b, idx: i, count: priceCounts[i] || 0 })).filter(
      (x) => x.count > 0
    );

    let filteredCore = baseByQuery.filter((p) => {
      const price = priceForFiltering(p, marginPercent);
      const catOk = activeCatsEffective.size === 0 ? true : activeCatsEffective.has(p.categoryId ?? "uncategorized");
      const priceOk = activeBuckets.length === 0 ? true : activeBuckets.some((b) => inBucket(price, b));
      const brandOk = activeBrands.size === 0 ? true : activeBrands.has((p.brand?.name || "").trim());
      return catOk && priceOk && brandOk;
    });

    if (HIDE_OOS) filteredCore = filteredCore.filter((p) => productSellable(p, marginPercent));

    return { categories, brands, visiblePriceBuckets, filtered: filteredCore, categoryTreeUi };
  }, [
    products,
    selectedCategories,
    selectedCategoryEffective,
    selectedBucketIdxs,
    selectedBrands,
    deferredQuery,
    query,
    PRICE_BUCKETS,
    inStockOnly,
    marginPercent,
    categoryForest,
    catTreeHelpers,
    expandedCats,
  ]);

  const purchasedQ = usePurchasedCounts(!isSupplier);

  const recScored = useMemo(() => {
    if (sortKey !== "relevance") return filtered;

    const purchased = purchasedQ.data ?? {};
    const clicks = productClicksRef.current;

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

        const av = productSellable(a.p, marginPercent) ? 1 : 0;
        const bv = productSellable(b.p, marginPercent) ? 1 : 0;
        if (bv !== av) return bv - av;

        if (b.score !== a.score) return b.score - a.score;

        const ar = bestSupplierRatingScore(a.p);
        const br = bestSupplierRatingScore(b.p);
        if (br !== ar) return br - ar;

        return priceForFiltering(a.p, marginPercent) - priceForFiltering(b.p, marginPercent);
      })
      .map((x) => x.p);
  }, [filtered, sortKey, purchasedQ.data, inStockOnly, marginPercent]);

  const sorted = useMemo(() => {
    if (sortKey === "relevance") return recScored;

    return [...filtered].sort((a, b) => {
      const sr = stockRank(a) - stockRank(b);
      if (!inStockOnly && sr !== 0) return sr;

      const av = productSellable(a, marginPercent) ? 1 : 0;
      const bv = productSellable(b, marginPercent) ? 1 : 0;
      if (bv !== av) return bv - av;

      if (sortKey === "price-asc") return priceForFiltering(a, marginPercent) - priceForFiltering(b, marginPercent);
      if (sortKey === "price-desc") return priceForFiltering(b, marginPercent) - priceForFiltering(a, marginPercent);
      return 0;
    });
  }, [filtered, recScored, sortKey, inStockOnly, marginPercent]);

  /* ---------------- Pagination ---------------- */

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<8 | 12 | 16>(12);

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
      const clickedDesktopInput = !!desktopInputRef.current?.contains(t);
      const clickedMobileInput = !!mobileInputRef.current?.contains(t);
      const clickedDesktopSuggest = !!desktopSuggestRef.current?.contains(t);
      const clickedMobileSuggest = !!mobileSuggestRef.current?.contains(t);

      if (
        !clickedDesktopInput &&
        !clickedMobileInput &&
        !clickedDesktopSuggest &&
        !clickedMobileSuggest
      ) {
        setShowSuggest(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const goTo = (p: number) => {
    const clamped = Math.min(Math.max(1, p), totalPages);
    if (clamped === currentPage) return;
    setPage(clamped);
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

  /* =========================================================
     Add to cart
========================================================= */

  const setCartQty = async (p: Product, nextQty: number) => {
    try {
      const qty = Math.max(0, Math.floor(Number(nextQty) || 0));
      const unitPriceCache = getDisplayRetailPrice(p, marginPercent) || 0;

      const primaryImgRaw =
        p.imagesJson?.[0] ||
        p.variants?.find((v) => Array.isArray(v.imagesJson) && v.imagesJson[0])?.imagesJson?.[0] ||
        null;

      const primaryImg = resolveImageUrl(primaryImgRaw) ?? null;

      const optionsKey = "";

      const nextLines = upsertCartLine({
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

      window.setTimeout(() => {
        showMiniCartToast(
          toMiniCartRows(nextLines),
          { productId: p.id, variantId: null },
          { mode: qty > 0 ? "add" : "remove" }
        );
      }, 0);

      syncServerQtyCoalesced(p, qty, unitPriceCache, primaryImg);
    } catch (err: any) {
      console.error(err);
      openModal({ title: "Cart", message: err?.message || "Could not update cart." });
    }
  };

  /* ---------------- UI helpers ---------------- */

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

  const Shimmer = () => <div className="h-3 w-full rounded bg-gradient-to-r from-zinc-200 via-zinc-100 to-zinc-200 animate-pulse" />;

  const anyActiveFilter =
    selectedCategories.length > 0 || selectedBucketIdxs.length > 0 || selectedBrands.length > 0 || !inStockOnly;

  const hasSearch = !!deferredQuery.trim();
  const toggleExpand = (id: string) => setExpandedCats((m) => ({ ...m, [id]: !m[id] }));

  /* ---------------- Render guards ---------------- */

  if (productsQ.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <MotionCircleLoader label="Loading products…" />
      </div>
    );
  }

  if (productsQ.error) {
    return (
      <>
        <div className="flex min-h-[60vh] items-center justify-center">
          <MotionCircleLoader label="Loading products…" />
        </div>
        <p className="p-6 text-center text-rose-600">We are sorry, we are having technical issues</p>
      </>
    );
  }

  /* =========================================================
     Main render
========================================================= */

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
                className="hidden md:inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium bg-white/90 text-zinc-800 shadow-sm active:scale-[0.98] transition border border-zinc-200 hover:border-zinc-300"
              >
                <SlidersHorizontal size={18} />
                Filter categories & brands
              </button>
            </div>
          </div>
        </div>

        <div className="md:hidden mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-zinc-900">Products</h1>
            <p className="text-xs text-zinc-600">Search and filter quickly.</p>
          </div>

          <button
            type="button"
            onClick={() => setRefineOpen(true)}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-medium bg-white/90 text-zinc-800 shadow-sm active:scale-[0.97] transition border border-zinc-200 hover:border-zinc-300"
          >
            <SlidersHorizontal size={14} />
            Filter categories & brands
          </button>
        </div>

        {(hasSearch || anyActiveFilter || sortKey !== "relevance" || pageSize !== 12) && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-700">
            {hasSearch && (
              <span className="rounded-full border bg-white/80 px-2.5 py-1 border-zinc-200">
                Search: <span className="font-semibold">{query.trim()}</span>
              </span>
            )}
            {anyActiveFilter && (
              <span className="rounded-full border bg-white/80 px-2.5 py-1 border-zinc-200">
                Filters: <span className="font-semibold">active</span>
              </span>
            )}
            {sortKey !== "relevance" && (
              <span className="rounded-full border bg-white/80 px-2.5 py-1 border-zinc-200">
                Sort:{" "}
                <span className="font-semibold">
                  {sortKey === "price-asc" ? "Low → High" : sortKey === "price-desc" ? "High → Low" : "Relevance"}
                </span>
              </span>
            )}
            {pageSize !== 12 && (
              <span className="rounded-full border bg-white/80 px-2.5 py-1 border-zinc-200">
                Per page: <span className="font-semibold">{pageSize}</span>
              </span>
            )}
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1.5 bg-white/90 shadow-sm border border-zinc-200 hover:border-zinc-300"
              onClick={() => setRefineOpen(true)}
            >
              <SlidersHorizontal size={14} />
              Edit filters
            </button>
          </div>
        )}

        <div className="hidden md:block mt-3 mb-4">
          <div className="relative max-w-2xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input
              ref={desktopInputRef}
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
                  if (pick) goToProduct(pick.id);
                  setShowSuggest(false);
                } else if (e.key === "Escape") {
                  setShowSuggest(false);
                }
              }}
              placeholder="Search products, brands, or categories…"
              className="w-full rounded-2xl pl-10 pr-4 py-2.5 bg-white/90 backdrop-blur border border-zinc-200 focus:ring-4 focus:ring-fuchsia-100 focus:border-fuchsia-400"
              aria-label="Search products"
            />

            {showSuggest && query && suggestions.length > 0 && (
              <div
                ref={desktopSuggestRef}
                className="absolute left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl z-30 overflow-hidden border border-zinc-200"
              >
                <ul className="max-h-[45vh] overflow-auto p-2">
                  {suggestions.map((p, i) => {
                    const active = i === activeIdx;
                    const minPrice = priceForFiltering(p, marginPercent);

                    return (
                      <li key={p.id} className="mb-2 last:mb-0">
                        <button
                          type="button"
                          className={`w-full text-left flex items-center gap-3 px-2.5 py-2.5 rounded-xl hover:bg-black/5 ${active ? "bg-black/5" : ""}`}
                          onClick={() => {
                            setShowSuggest(false);
                            goToProduct(p.id);
                          }}
                        >
                          {p.imagesJson?.[0] ? (
                            <img
                              src={resolveImageUrl(p.imagesJson?.[0])}
                              alt=""
                              aria-hidden="true"
                              onError={(e) => e.currentTarget.remove()}
                              className="w-14 h-14 object-cover rounded-xl border border-zinc-200"
                            />
                          ) : (
                            <div className="w-14 h-14 rounded-xl border border-zinc-200 grid place-items-center text-base text-gray-500">
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
        </div>

        {/* Mobile-only controls moved above product tiles */}
        <div className="md:hidden mb-3 rounded-2xl border border-zinc-200 bg-white/90 p-3 shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input
              ref={mobileInputRef}
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
                  if (pick) goToProduct(pick.id);
                  setShowSuggest(false);
                } else if (e.key === "Escape") {
                  setShowSuggest(false);
                }
              }}
              placeholder="Search products, brands, or categories…"
              className="w-full rounded-2xl pl-10 pr-4 py-2.5 bg-white border border-zinc-200 focus:ring-4 focus:ring-fuchsia-100 focus:border-fuchsia-400"
              aria-label="Search products"
            />

            {showSuggest && query && suggestions.length > 0 && (
              <div
                ref={mobileSuggestRef}
                className="absolute left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl z-30 overflow-hidden border border-zinc-200"
              >
                <ul className="max-h-[45vh] overflow-auto p-2">
                  {suggestions.map((p, i) => {
                    const active = i === activeIdx;
                    const minPrice = priceForFiltering(p, marginPercent);

                    return (
                      <li key={p.id} className="mb-2 last:mb-0">
                        <button
                          type="button"
                          className={`w-full text-left flex items-center gap-3 px-2.5 py-2.5 rounded-xl hover:bg-black/5 ${active ? "bg-black/5" : ""}`}
                          onClick={() => {
                            setShowSuggest(false);
                            goToProduct(p.id);
                          }}
                        >
                          {p.imagesJson?.[0] ? (
                            <img
                              src={resolveImageUrl(p.imagesJson?.[0])}
                              alt=""
                              aria-hidden="true"
                              onError={(e) => (e.currentTarget as HTMLImageElement).remove()}
                              className="w-16 h-16 object-cover rounded-xl border border-zinc-200"
                            />
                          ) : (
                            <div className="w-16 h-16 rounded-xl border border-zinc-200 grid place-items-center text-base text-gray-500">
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

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <label className="mb-1 block text-[11px] font-medium text-zinc-700">Sort</label>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="w-full rounded-xl px-3 py-2 text-[12px] bg-white border border-zinc-200"
              >
                <option value="relevance">Relevance</option>
                <option value="price-asc">Price: Low → High</option>
                <option value="price-desc">Price: High → Low</option>
              </select>
            </div>

            <div className="min-w-0">
              <label className="mb-1 block text-[11px] font-medium text-zinc-700">Per page</label>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) as 8 | 12 | 16)}
                className="w-full rounded-xl px-3 py-2 text-[12px] bg-white border border-zinc-200"
              >
                <option value={8}>8</option>
                <option value={12}>12</option>
                <option value={16}>16</option>
              </select>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-[12px] font-medium text-zinc-800 select-none">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              In stock
            </label>

            <button
              type="button"
              onClick={() => setRefineOpen(true)}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-medium bg-white text-zinc-800 shadow-sm border border-zinc-200 hover:border-zinc-300"
            >
              <SlidersHorizontal size={14} />
              Filter categories & brands
            </button>
          </div>
        </div>

        <div className="mt-2 md:grid md:grid-cols-[280px_minmax(0,1fr)] md:gap-6">
          <aside className="hidden md:block">
            <div className="sticky top-24 rounded-2xl bg-white/90 p-4 border border-zinc-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-zinc-900">Filter categories & brands</h3>
                {(anyActiveFilter || hasSearch) && (
                  <button
                    type="button"
                    className="text-xs font-medium text-fuchsia-700 hover:underline"
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

              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-zinc-700">Sort</label>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="w-full rounded-xl px-3 py-2 bg-white border border-zinc-200"
                >
                  <option value="relevance">Relevance</option>
                  <option value="price-asc">Price: Low → High</option>
                  <option value="price-desc">Price: High → Low</option>
                </select>
              </div>

              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-zinc-700">Per page</label>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as 8 | 12 | 16)}
                  className="w-full rounded-xl px-3 py-2 bg-white border border-zinc-200"
                >
                  <option value={8}>8</option>
                  <option value={12}>12</option>
                  <option value={16}>16</option>
                </select>
              </div>

              <div className="mb-4">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-800">
                  <input
                    type="checkbox"
                    checked={inStockOnly}
                    onChange={(e) => setInStockOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  In stock
                </label>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-zinc-800">Categories</h4>
                  <button
                    className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
                    onClick={() => setSelectedCategories([])}
                    disabled={selectedCategories.length === 0}
                  >
                    Reset
                  </button>
                </div>

                {categoryTreeUi ? (
                  <ul className="space-y-1.5 max-h-60 overflow-auto pr-1">
                    {categoryTreeUi.map(({ node, count, depth, hasChildren }) => {
                      const checked = selectedCategories.includes(node.id);
                      const expanded = !!expandedCats[node.id];
                      const pad = Math.min(24, depth * 10);

                      return (
                        <li key={node.id}>
                          <div
                            className={`w-full flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-xs transition ${checked
                              ? "bg-zinc-900 text-white border-zinc-900"
                              : "bg-white hover:bg-black/5 text-zinc-800 border-zinc-200 hover:border-zinc-300"
                              }`}
                            style={{ paddingLeft: 8 + pad }}
                          >
                            {hasChildren ? (
                              <button
                                type="button"
                                onClick={() => toggleExpand(node.id)}
                                className={`inline-flex items-center justify-center w-6 h-6 rounded-lg ${checked ? "text-white/90 hover:bg-white/10" : "text-zinc-600 hover:bg-black/5"
                                  }`}
                                aria-label={expanded ? "Collapse category" : "Expand category"}
                              >
                                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </button>
                            ) : (
                              <span className="inline-flex w-6 h-6" />
                            )}

                            <button
                              type="button"
                              onClick={() => toggleCategory(node.id)}
                              className="min-w-0 flex-1 text-left"
                              title={node.name}
                            >
                              <span className="truncate">{node.name}</span>
                            </button>

                            <span className={`ml-2 text-[11px] ${checked ? "text-white/90" : "text-zinc-600"}`}>
                              ({count})
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <ul className="space-y-1.5 max-h-52 overflow-auto pr-1">
                    {categories.length === 0 && <Shimmer />}
                    {categories.map((c) => {
                      const checked = selectedCategories.includes(c.id);
                      return (
                        <li key={c.id}>
                          <button
                            onClick={() => toggleCategory(c.id)}
                            className={`w-full flex items-center justify-between rounded-xl border px-3 py-1.5 text-xs transition ${checked
                              ? "bg-zinc-900 text-white"
                              : "bg-white hover:bg-black/5 text-zinc-800 border-zinc-200 hover:border-zinc-300"
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
                )}
              </div>

              {brands.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-zinc-800">Brands</h4>
                    <button
                      className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
                      onClick={() => setSelectedBrands([])}
                      disabled={selectedBrands.length === 0}
                    >
                      Reset
                    </button>
                  </div>
                  <ul className="space-y-1.5 max-h-44 overflow-auto pr-1">
                    {brands.map((b) => {
                      const checked = selectedBrands.includes(b.name);
                      return (
                        <li key={b.name}>
                          <button
                            onClick={() => toggleBrand(b.name)}
                            className={`w-full flex items-center justify-between rounded-xl border px-3 py-1.5 text-xs transition ${checked
                              ? "bg-zinc-900 text-white"
                              : "bg-white hover:bg-black/5 text-zinc-800 border border-zinc-200 hover:border-zinc-300"
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

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-zinc-800">Price</h4>
                  <button
                    className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
                    onClick={() => setSelectedBucketIdxs([])}
                    disabled={selectedBucketIdxs.length === 0}
                  >
                    Reset
                  </button>
                </div>

                <ul className="space-y-1.5 max-h-56 overflow-auto pr-1">
                  {visiblePriceBuckets.length === 0 && <Shimmer />}
                  {visiblePriceBuckets.map(({ bucket, idx, count }) => {
                    const checked = selectedBucketIdxs.includes(idx);
                    return (
                      <li key={bucket.label}>
                        <button
                          onClick={() => toggleBucket(idx)}
                          className={`w-full flex items-center justify-between rounded-xl border px-3 py-1.5 text-xs transition ${checked
                            ? "bg-zinc-900 text-white"
                            : "bg-white hover:bg-black/5 text-zinc-800 border border-zinc-200 hover:border-zinc-300"
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
            </div>
          </aside>

          <section className="mt-0 min-w-0">
            {sorted.length === 0 ? (
              <p className="text-sm text-zinc-600">No products match your filters.</p>
            ) : (
              <>
                <div className="-mx-2 sm:mx-0 grid gap-1.5 sm:gap-3 md:gap-4 grid-cols-2 md:grid-cols-4">
                  {pageItems.map((p) => {
                    const fav = isFav(p.id);
                    const bestPrice = priceForFiltering(p, marginPercent);
                    const inStock = availableNow(p);

                    const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;
                    const baseQtyInCart = qtyInCart(cartSnapshot, String(p.id), null);

                    const primaryImgRaw =
                      p.imagesJson?.[0] ||
                      p.variants?.find((v) => Array.isArray(v.imagesJson) && v.imagesJson[0])?.imagesJson?.[0] ||
                      null;

                    const primaryImg = resolveImageUrl(primaryImgRaw);

                    return (
                      <div
                        key={p.id}
                        role="link"
                        tabIndex={0}
                        onClick={(e) => {
                          if (isFromCardAction(e.target)) return;
                          goToProduct(p.id);
                        }}
                        onKeyDown={(e) => {
                          if (isFromCardAction(e.target)) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            goToProduct(p.id);
                          }
                        }}
                        onDragStart={(e) => e.preventDefault()}
                        className="block rounded-2xl bg-white border border-zinc-200 hover:border-zinc-300 shadow-sm overflow-hidden active:scale-[0.99] transition cursor-pointer"
                      >
                        <div className="relative w-full h-28 sm:h-36 md:h-40 overflow-hidden bg-zinc-100">
                          {primaryImg ? (
                            <img
                              src={primaryImg}
                              alt={p.title}
                              loading="lazy"
                              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                              draggable={false}
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="absolute inset-0 grid place-items-center text-zinc-400 text-sm pointer-events-none">
                              No image
                            </div>
                          )}

                          {inStock && (
                            <span className="absolute left-2 top-2 z-10 inline-flex items-center rounded-full bg-purple-800 px-2.5 py-1 text-[10px] md:text-[11px] font-semibold text-white shadow-sm">
                              In stock
                            </span>
                          )}

                          {!isSupplier && (
                            <button
                              type="button"
                              data-stop-card-nav="true"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();

                                if (!isAuthed) {
                                  openModal({
                                    title: "Sign in required",
                                    message: "Please sign in to save items to your wishlist.",
                                  });
                                  return;
                                }

                                toggleFav.mutate({ productId: p.id });
                              }}
                              className={`absolute right-2 top-2 z-10 inline-flex items-center justify-center w-8 h-8 rounded-full border shadow-sm transition ${fav
                                ? "bg-rose-50 border-rose-200 text-rose-600"
                                : "bg-white/95 border-zinc-200 text-zinc-400 hover:text-rose-600 hover:border-rose-200"
                                }`}
                              aria-label={fav ? "Remove from wishlist" : "Add to wishlist"}
                              title={fav ? "Remove from wishlist" : "Add to wishlist"}
                            >
                              <Heart size={16} className={fav ? "fill-current" : ""} />
                            </button>
                          )}
                        </div>

                        <div className="p-2.5 md:p-4">
                          <TruncatedTitle
                            text={p.title}
                            className="font-semibold text-[12px] md:text-sm text-zinc-900 line-clamp-1"
                          />
                          <div className="text-[10px] md:text-xs text-zinc-500 line-clamp-1">
                            {p.brand?.name ? `${p.brand.name} • ` : ""}
                            {p.categoryName?.trim() || "Uncategorized"}
                          </div>

                          <div className="mt-1">
                            <p className="text-sm md:text-base font-semibold">{ngn.format(bestPrice || 0)}</p>
                          </div>

                          <div className="mt-2">
                            {hasVariants ? (
                              <button
                                type="button"
                                data-stop-card-nav="true"
                                className="inline-flex items-center rounded-full bg-black/40 px-3 py-1.5 text-[11px] md:text-xs font-medium text-white hover:bg-black/55 transition"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  goToProduct(p.id);
                                }}
                              >
                                Choose options
                              </button>
                            ) : (
                              <div data-stop-card-nav="true">
                                {baseQtyInCart > 0 ? (
                                  <div className="inline-flex items-center gap-2 rounded-full bg-black/75 px-2 py-1.5 text-white shadow-sm">
                                    <button
                                      type="button"
                                      data-stop-card-nav="true"
                                      aria-label="Decrease quantity"
                                      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/15 hover:bg-white/25 text-sm font-semibold"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        void setCartQty(p, baseQtyInCart - 1);
                                      }}
                                    >
                                      −
                                    </button>

                                    <span className="min-w-[18px] text-center text-[11px] md:text-xs font-semibold">
                                      {baseQtyInCart}
                                    </span>

                                    <button
                                      type="button"
                                      data-stop-card-nav="true"
                                      aria-label="Increase quantity"
                                      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/15 hover:bg-white/25 text-sm font-semibold"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        void setCartQty(p, baseQtyInCart + 1);
                                      }}
                                    >
                                      +
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    data-stop-card-nav="true"
                                    disabled={!inStock}
                                    className={`inline-flex items-center rounded-full px-3 py-1.5 text-[11px] md:text-xs font-medium shadow-sm transition ${inStock
                                      ? "bg-black text-white hover:bg-black/90"
                                      : "bg-zinc-200 text-zinc-500 cursor-not-allowed"
                                      }`}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (!inStock) return;
                                      void setCartQty(p, 1);
                                    }}
                                  >
                                    Add to cart
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 md:mt-8">
                  <div className="md:hidden rounded-2xl bg-white/85 backdrop-blur p-3 shadow-sm border border-zinc-200">
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
                        className="h-9 rounded-xl bg-white text-[11px] font-semibold text-zinc-700 border border-zinc-200 hover:border-zinc-300 active:scale-[0.99] transition"
                      >
                        First
                      </button>
                      <button
                        type="button"
                        onClick={() => goTo(currentPage - 1)}
                        className="h-9 rounded-xl bg-white text-[11px] font-semibold text-zinc-700 border border-zinc-200 hover:border-zinc-300 active:scale-[0.99] transition"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={() => goTo(currentPage + 1)}
                        className="h-9 rounded-xl bg-white text-[11px] font-semibold text-zinc-700 border border-zinc-200 hover:border-zinc-300 active:scale-[0.99] transition"
                      >
                        Next
                      </button>
                      <button
                        type="button"
                        onClick={() => goTo(totalPages)}
                        className="h-9 rounded-xl bg-white text-[11px] font-semibold text-zinc-700 border border-zinc-200 hover:border-zinc-300 active:scale-[0.99] transition"
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
                        className="h-9 w-full min-w-0 rounded-xl px-3 text-[12px] font-semibold bg-white border border-zinc-200 focus:ring-4 focus:ring-fuchsia-100 focus:border-fuchsia-400"
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
                          className="w-20 rounded-xl px-3 py-1.5 bg-white border border-zinc-200"
                          aria-label="Jump to page"
                        />
                        <button
                          type="submit"
                          className="px-3 py-1.5 rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-50 border border-zinc-200 hover:border-zinc-300"
                          disabled={!jumpVal || Number(jumpVal) < 1 || Number(jumpVal) > totalPages}
                        >
                          Go
                        </button>
                      </form>

                      <div className="flex items-center gap-1 sm:gap-2">
                        <button
                          type="button"
                          className="px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200 hover:border-zinc-300"
                          onClick={() => goTo(1)}
                        >
                          First
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200 hover:border-zinc-300"
                          onClick={() => goTo(currentPage - 1)}
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
                                    : "bg-white hover:bg-zinc-50 border border-zinc-200 hover:border-zinc-300"
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
                          className="px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200 hover:border-zinc-300"
                          onClick={() => goTo(currentPage + 1)}
                        >
                          Next
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200 hover:border-zinc-300"
                          onClick={() => goTo(totalPages)}
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

      <AnimatePresence>
        {refineOpen && (
          <motion.div
            className="fixed inset-0 z-50 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            aria-modal="true"
            role="dialog"
          >
            <div className="absolute inset-0 bg-black/40 pointer-events-auto" onClick={closeRefine} />

            <motion.div
              className="absolute inset-y-0 right-0 w-[88%] max-w-sm bg-white rounded-tl-3xl rounded-bl-3xl shadow-2xl overflow-y-auto p-4 flex flex-col gap-4 border border-zinc-200 pointer-events-auto"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-zinc-900">Filter categories & brands</h3>
                  <p className="text-[11px] text-zinc-600">Choose categories, brands, and price ranges.</p>
                </div>

                <button
                  type="button"
                  onClick={closeRefine}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-zinc-100 text-zinc-700 active:scale-95 transition"
                  aria-label="Close filters panel"
                >
                  <X size={18} />
                </button>
              </div>

              {(anyActiveFilter || hasSearch) && (
                <div className="flex items-center justify-end">
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
                </div>
              )}

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[12px] font-semibold text-zinc-900">Categories</h4>
                  <button
                    className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
                    onClick={() => setSelectedCategories([])}
                    disabled={selectedCategories.length === 0}
                  >
                    Reset
                  </button>
                </div>

                {categoryTreeUi ? (
                  <ul className="space-y-1.5 max-h-56 overflow-auto pr-1">
                    {categoryTreeUi.map(({ node, count, depth, hasChildren }) => {
                      const checked = selectedCategories.includes(node.id);
                      const expanded = !!expandedCats[node.id];
                      const pad = Math.min(20, depth * 10);

                      return (
                        <li key={node.id}>
                          <div
                            className={`w-full flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-[12px] transition ${checked
                              ? "bg-zinc-900 text-white border-zinc-900"
                              : "bg-white hover:bg-black/5 text-zinc-800 border-zinc-200 hover:border-zinc-300"
                              }`}
                            style={{ paddingLeft: 8 + pad }}
                          >
                            {hasChildren ? (
                              <button
                                type="button"
                                onClick={() => toggleExpand(node.id)}
                                className={`inline-flex items-center justify-center w-6 h-6 rounded-lg ${checked ? "text-white/90 hover:bg-white/10" : "text-zinc-600 hover:bg-black/5"
                                  }`}
                                aria-label={expanded ? "Collapse category" : "Expand category"}
                              >
                                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </button>
                            ) : (
                              <span className="inline-flex w-6 h-6" />
                            )}

                            <button
                              type="button"
                              onClick={() => toggleCategory(node.id)}
                              className="min-w-0 flex-1 text-left"
                              title={node.name}
                            >
                              <span className="truncate">{node.name}</span>
                            </button>

                            <span className={`ml-2 text-[11px] ${checked ? "text-white/90" : "text-zinc-600"}`}>
                              ({count})
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <ul className="space-y-1.5 max-h-56 overflow-auto pr-1">
                    {categories.length === 0 && <Shimmer />}
                    {categories.map((c) => {
                      const checked = selectedCategories.includes(c.id);
                      return (
                        <li key={c.id}>
                          <button
                            onClick={() => toggleCategory(c.id)}
                            className={`w-full flex items-center justify-between rounded-xl border px-3 py-1.5 text-[12px] transition ${checked
                              ? "bg-zinc-900 text-white"
                              : "bg-white hover:bg-black/5 text-zinc-800 border-zinc-200 hover:border-zinc-300"
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
                )}
              </div>

              {brands.length > 0 && (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[12px] font-semibold text-zinc-900">Brands</h4>
                    <button
                      className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
                      onClick={() => setSelectedBrands([])}
                      disabled={selectedBrands.length === 0}
                    >
                      Reset
                    </button>
                  </div>

                  <ul className="space-y-1.5 max-h-44 overflow-auto pr-1">
                    {brands.map((b) => {
                      const checked = selectedBrands.includes(b.name);
                      return (
                        <li key={b.name}>
                          <button
                            onClick={() => toggleBrand(b.name)}
                            className={`w-full flex items-center justify-between rounded-xl border px-3 py-1.5 text-[12px] transition ${checked
                              ? "bg-zinc-900 text-white"
                              : "bg-white hover:bg-black/5 text-zinc-800 border-zinc-200 hover:border-zinc-300"
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

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[12px] font-semibold text-zinc-900">Price</h4>
                  <button
                    className="text-[11px] text-zinc-600 hover:underline disabled:opacity-40"
                    onClick={() => setSelectedBucketIdxs([])}
                    disabled={selectedBucketIdxs.length === 0}
                  >
                    Reset
                  </button>
                </div>

                <ul className="space-y-1.5 max-h-52 overflow-auto pr-1">
                  {visiblePriceBuckets.length === 0 && <Shimmer />}
                  {visiblePriceBuckets.map(({ bucket, idx, count }) => {
                    const checked = selectedBucketIdxs.includes(idx);
                    return (
                      <li key={bucket.label}>
                        <button
                          onClick={() => toggleBucket(idx)}
                          className={`w-full flex items-center justify-between rounded-xl border px-3 py-1.5 text-[12px] transition ${checked
                            ? "bg-zinc-900 text-white"
                            : "bg-white hover:bg-black/5 text-zinc-800 border-zinc-200 hover:border-zinc-300"
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
      </AnimatePresence>
    </SiteLayout>
  );
}