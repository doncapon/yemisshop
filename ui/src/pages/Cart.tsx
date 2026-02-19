// src/pages/Cart.tsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import SiteLayout from "../layouts/SiteLayout";

/* ---------------- Types ---------------- */

type SelectedOption = {
  attributeId: string;
  attribute: string;
  valueId?: string;
  value: string;
};

type CartItem = {
  kind?: "BASE" | "VARIANT"; // ✅ preserved
  productId: string;
  variantId?: string | null;
  title: string;
  qty: number;

  // legacy/local cache (NOT authoritative when supplier-split pricing exists)
  unitPrice: number;
  totalPrice: number;

  selectedOptions?: SelectedOption[];
  image?: string;
};

type Availability = {
  totalAvailable: number;
  cheapestSupplierUnit?: number | null;
};

type ProductPools = {
  hasVariantSpecific: boolean;
  genericTotal: number; // base-product pool
  productTotal: number;
  perVariantTotals: Record<string, number>;
};

type AvailabilityPayload = {
  lines: Record<string, Availability>;
  products: Record<string, ProductPools>;
};

/* ---------------- Pricing Quote (supplier-split) ---------------- */

type QuoteAllocation = {
  supplierId: string;
  supplierName?: string | null;
  qty: number;
  unitPrice: number; // supplier unit (cost/offer)
  offerId?: string | null;
  lineTotal?: number;
};

type QuoteLine = {
  key: string; // should match our lineKeyFor()
  productId: string;
  variantId?: string | null;
  kind: "BASE" | "VARIANT";
  qtyRequested: number;
  qtyPriced: number;
  allocations: QuoteAllocation[];
  lineTotal: number; // supplier total = sum(allocations qty*unitPrice)
  minUnit: number;
  maxUnit: number;
  averageUnit: number;
  currency?: string | null;
  warnings?: string[];
};

type QuotePayload = {
  currency?: string | null;
  subtotal: number; // supplier subtotal
  lines: Record<string, QuoteLine>; // key -> line
  raw?: any;
};

/* ---------------- Settings (public) ---------------- */

type PublicSettings = {
  marginPercent?: number | string | null;
  commerce?: { marginPercent?: number | string | null } | null;
  pricing?: { marginPercent?: number | string | null } | null;
};

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

/* ---------------- Helpers: numbers ---------------- */

// Vite only exposes env vars prefixed with VITE_
// So set VITE_API_URL in your .env / hosting provider.
const API_ORIGIN =
  String((import.meta as any)?.env?.VITE_API_URL || (import.meta as any)?.env?.API_URL || "")
    .trim()
    .replace(/\/+$/, "") || "https://api.dayspringhouse.com";

function resolveImageUrl(input?: string | null): string | undefined {
  const s = String(input ?? "").trim();
  if (!s) return undefined;

  // already absolute or special
  if (/^(https?:\/\/|data:|blob:)/i.test(s)) return s;

  // protocol-relative
  if (s.startsWith("//")) return `${window.location.protocol}${s}`;

  // absolute paths
  if (s.startsWith("/")) {
    // If it's uploads (or api/uploads), serve from API
    if (s.startsWith("/uploads/") || s.startsWith("/api/uploads/")) return `${API_ORIGIN}${s}`;
    // otherwise assume same origin (UI)
    return `${window.location.origin}${s}`;
  }

  // relative uploads paths
  if (s.startsWith("uploads/") || s.startsWith("api/uploads/")) return `${API_ORIGIN}/${s}`;

  // fallback: same origin
  return `${window.location.origin}/${s}`;
}

const asInt = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
};

const asMoney = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const clampPct = (p: number) => {
  if (!Number.isFinite(p)) return 0;
  if (p < 0) return 0;
  if (p > 1000) return 1000;
  return p;
};

const applyMargin = (supplierUnit: number, marginPercent: number) => {
  const p = clampPct(marginPercent);
  return supplierUnit * (1 + p / 100);
};

/* ---------------- Helpers: storage + shape ---------------- */

function toArray<T = any>(x: any): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function normalizeSelectedOptions(raw: any): SelectedOption[] {
  const arr = toArray<SelectedOption>(raw)
    .map((o: any) => ({
      attributeId: String(o.attributeId ?? ""),
      attribute: String(o.attribute ?? ""),
      valueId: o.valueId ? String(o.valueId) : undefined,
      value: String(o.value ?? ""),
    }))
    .filter((o) => o.attributeId || o.attribute || o.valueId || o.value);

  arr.sort((a, b) => {
    const aKey = `${a.attributeId}:${a.valueId ?? a.value}`;
    const bKey = `${b.attributeId}:${b.valueId ?? b.value}`;
    return aKey.localeCompare(bKey);
  });

  return arr;
}

function optionsKey(sel?: SelectedOption[]) {
  const s = (sel ?? []).filter(Boolean);
  if (!s.length) return "";
  return s.map((o) => `${o.attributeId}=${o.valueId ?? o.value}`).join("|");
}

/**
 * ✅ Separate cart lines by "kind"
 * - base product: productId::base
 * - variant by id: productId::v:<variantId>
 * - options-only fallback: productId::o:<optionsKey>
 */
function lineKeyFor(item: Pick<CartItem, "productId" | "variantId" | "selectedOptions" | "kind">) {
  const pid = String(item.productId);
  const vid = item.variantId == null ? null : String(item.variantId);
  const sel = normalizeSelectedOptions(item.selectedOptions);

  const kind: "BASE" | "VARIANT" =
    item.kind === "BASE" || item.kind === "VARIANT" ? item.kind : item.variantId ? "VARIANT" : "BASE";

  if (kind === "VARIANT") {
    if (vid) return `${pid}::v:${vid}`;
    return sel.length ? `${pid}::o:${optionsKey(sel)}` : `${pid}::v:unknown`;
  }

  return `${pid}::base`;
}

// Availability key stays per (productId, variantId)
const availKeyFor = (productId: string, variantId?: string | null) => `${productId}::${variantId ?? "null"}`;

function normalizeCartShape(parsed: any[]): CartItem[] {
  return parsed.map((it: any) => {
    const qtyNum = Math.max(1, Number(it.qty) || 1);

    const variantId = it.variantId == null ? null : String(it.variantId);
    const selectedOptions = normalizeSelectedOptions(it.selectedOptions);

    const rawKind = it.kind === "BASE" || it.kind === "VARIANT" ? it.kind : undefined;
    const kind = rawKind ?? (it.variantId ? "VARIANT" : "BASE");

    const hasTotal = Number.isFinite(Number(it.totalPrice));
    const hasPrice = Number.isFinite(Number(it.price));
    const hasUnit = Number.isFinite(Number(it.unitPrice));

    const unitFromTotal = hasTotal ? Number(it.totalPrice) / qtyNum : undefined;
    const unitPrice = hasUnit ? Number(it.unitPrice) : hasPrice ? Number(it.price) : unitFromTotal ?? 0;

    const totalPrice = hasTotal ? Number(it.totalPrice) : unitPrice * qtyNum;

    return {
      kind,
      productId: String(it.productId),
      variantId,
      title: String(it.title ?? ""),
      qty: qtyNum,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      totalPrice: Number.isFinite(totalPrice) ? totalPrice : 0,
      selectedOptions,
      image: typeof it.image === "string" ? (resolveImageUrl(it.image) ?? undefined) : undefined,
    } as CartItem;
  });
}

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem("cart");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeCartShape(parsed);
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]) {
  localStorage.setItem("cart", JSON.stringify(items));
  window.dispatchEvent(new Event("cart:updated")); // ✅ tells navbar badge to refresh
}


const sameLine = (a: CartItem, b: Pick<CartItem, "productId" | "variantId" | "selectedOptions" | "kind">) =>
  lineKeyFor(a) === lineKeyFor(b);

const isBaseLine = (it: CartItem) => {
  if (it.variantId) return false;
  if (it.kind === "VARIANT") return false;
  return true;
};

/* ---------------- Availability (batched) ---------------- */

async function fetchAvailabilityForCart(items: CartItem[]): Promise<AvailabilityPayload> {
  if (!items.length) return { lines: {}, products: {} };

  const pairs = items.map((i) => ({ productId: i.productId, variantId: i.variantId ?? null }));
  const uniqPairs: { productId: string; variantId: string | null }[] = [];
  const seen = new Set<string>();

  for (const p of pairs) {
    const k = availKeyFor(p.productId, p.variantId);
    if (!seen.has(k)) {
      seen.add(k);
      uniqPairs.push(p);
    }
  }

  const itemsParam = uniqPairs.map((p) => `${p.productId}:${p.variantId ?? ""}`).join(",");

  const attempts = [
    `/api/catalog/availability?items=${encodeURIComponent(itemsParam)}&includeBase=1`,
    `/api/products/availability?items=${encodeURIComponent(itemsParam)}&includeBase=1`,
    `/api/supplier-offers/availability?items=${encodeURIComponent(itemsParam)}&includeBase=1`,
  ];

  for (const url of attempts) {
    try {
      const { data } = await api.get(url);
      const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      if (Array.isArray(arr)) {
        const lines: Record<string, Availability> = {};

        type Row = {
          productId: string;
          variantId?: string | null;
          totalAvailable?: number;
          cheapestSupplierUnit?: number | null;
        };

        const byProduct: Record<string, { generic: number; perVariant: Record<string, number> }> = {};

        for (const r of arr as Row[]) {
          const pid = String(r.productId);
          const vid = r.variantId == null ? null : String(r.variantId);
          const avail = Math.max(0, Number(r.totalAvailable) || 0);
          const k = availKeyFor(pid, vid);

          lines[k] = {
            totalAvailable: avail,
            cheapestSupplierUnit: Number.isFinite(Number(r.cheapestSupplierUnit)) ? Number(r.cheapestSupplierUnit) : null,
          };

          if (!byProduct[pid]) byProduct[pid] = { generic: 0, perVariant: {} };

          if (vid == null) byProduct[pid].generic += avail;
          else byProduct[pid].perVariant[vid] = (byProduct[pid].perVariant[vid] || 0) + avail;
        }

        const products: Record<string, ProductPools> = {};
        for (const [pid, agg] of Object.entries(byProduct)) {
          const hasVariantSpecific = Object.keys(agg.perVariant).length > 0;
          const variantSum = Object.values(agg.perVariant).reduce((s, n) => s + n, 0);
          const productTotal = agg.generic + variantSum;

          products[pid] = {
            hasVariantSpecific,
            genericTotal: agg.generic,
            productTotal,
            perVariantTotals: agg.perVariant,
          };
        }

        return { lines, products };
      }
    } catch {
      /* fall through */
    }
  }

  return { lines: {}, products: {} };
}

/* ---------------- Price hydration (only for 0-price cache; quote is authoritative) ---------------- */

async function hydrateLinePrice(line: CartItem): Promise<CartItem> {
  const currentUnit = asMoney(line.unitPrice, asMoney((line as any).price, 0));
  if (currentUnit > 0) return line;

  try {
    const { data } = await api.get(`/api/products/${line.productId}`, {
      params: { include: "variants,offers,supplierOffers" },
    });

    const p = data?.data ?? data ?? {};
    let unit = 0;

    const base = asMoney(p.price, 0);
    unit = base;

    if (line.variantId && Array.isArray(p.variants)) {
      const v = p.variants.find((vv: any) => String(vv.id) === String(line.variantId));
      if (v && asMoney(v.price, NaN) > 0) unit = asMoney(v.price, unit);
    }

    if (!(unit > 0)) {
      const offersSrc = [
        ...(Array.isArray(p.supplierOffers) ? p.supplierOffers : []),
        ...(Array.isArray(p.offers) ? p.offers : []),
      ];

      const fromVariants =
        Array.isArray(p.variants) &&
        p.variants.flatMap((v: any) =>
          Array.isArray(v.offers) ? v.offers.map((o: any) => ({ ...o, variantId: v.id })) : []
        );

      const allOffers = [...offersSrc, ...(Array.isArray(fromVariants) ? fromVariants : [])];

      const usable = allOffers
        .map((o: any) => ({
          unitPrice: asMoney(o.price, NaN),
          availableQty: asInt(o.availableQty ?? o.available ?? o.qty ?? 0, 0),
          isActive: o.isActive !== false,
          variantId: o.variantId ?? null,
        }))
        .filter((o) => o.isActive && o.availableQty > 0 && o.unitPrice > 0);

      const scoped = line.variantId ? usable.filter((o) => String(o.variantId) === String(line.variantId)) : usable;

      if (scoped.length) {
        scoped.sort((a, b) => a.unitPrice - b.unitPrice);
        unit = scoped[0].unitPrice;
      }
    }

    const qty = Math.max(1, asInt(line.qty, 1));
    if (unit > 0) {
      return { ...line, unitPrice: unit, totalPrice: unit * qty };
    }
  } catch {
    // ignore
  }

  return line;
}

/* ---------------- Supplier-split pricing quote ---------------- */

function normalizeQuoteResponse(raw: any, cart: CartItem[]): QuotePayload | null {
  const root = raw?.data?.data ?? raw?.data ?? raw ?? null;
  if (!root) return null;

  const currency = root.currency ?? root?.quote?.currency ?? null;

  const maybe = root.quote ?? root;
  const subtotal = asMoney(maybe.subtotal ?? maybe.itemsSubtotal ?? maybe.totalItems ?? maybe.total ?? 0, 0);

  const outLines: Record<string, QuoteLine> = {};

  const ensureKey = (x: any) => {
    const k = String(x?.key ?? "");
    if (k) return k;

    const pid = String(x?.productId ?? "");
    const vid = x?.variantId == null ? null : String(x.variantId);
    const kind: "BASE" | "VARIANT" = x?.kind === "VARIANT" || (!!vid && x?.kind !== "BASE") ? "VARIANT" : "BASE";

    if (!pid) return "";
    if (kind === "VARIANT") return vid ? `${pid}::v:${vid}` : `${pid}::v:unknown`;
    return `${pid}::base`;
  };

  const normalizeAlloc = (a: any): QuoteAllocation => {
    const qty = Math.max(0, asInt(a?.qty ?? a?.quantity ?? 0, 0));
    const unitPrice = asMoney(a?.unitPrice ?? a?.price ?? a?.supplierPrice ?? 0, 0);
    const lineTotal = asMoney(a?.lineTotal ?? qty * unitPrice, qty * unitPrice);

    return {
      supplierId: String(a?.supplierId ?? a?.supplier_id ?? ""),
      supplierName: a?.supplierName ?? a?.supplier?.name ?? null,
      qty,
      unitPrice,
      offerId: a?.offerId ?? a?.supplierOfferId ?? null,
      lineTotal,
    };
  };

  const normalizeLine = (x: any): QuoteLine | null => {
    const key = ensureKey(x);
    if (!key) return null;

    const productId = String(x?.productId ?? "");
    const variantId = x?.variantId == null ? null : String(x.variantId);
    const kind: "BASE" | "VARIANT" = x?.kind === "BASE" || x?.kind === "VARIANT" ? x.kind : variantId ? "VARIANT" : "BASE";

    const qtyRequested = Math.max(1, asInt(x?.qtyRequested ?? x?.qty ?? x?.requestedQty ?? 1, 1));

    const allocsRaw = toArray<any>(x?.allocations ?? x?.splits ?? x?.items ?? x?.parts);
    const allocations = allocsRaw.map(normalizeAlloc).filter((a) => a.qty > 0 && a.unitPrice >= 0);

    const lineTotal = asMoney(
      x?.lineTotal ?? x?.total ?? allocations.reduce((s, a) => s + asMoney(a.lineTotal, 0), 0),
      0
    );

    const qtyPriced = Math.max(0, asInt(x?.qtyPriced ?? allocations.reduce((s, a) => s + asInt(a.qty, 0), 0), 0));

    const units = allocations.map((a) => asMoney(a.unitPrice, NaN)).filter((n) => Number.isFinite(n));
    const minUnit = units.length ? Math.min(...(units as number[])) : 0;
    const maxUnit = units.length ? Math.max(...(units as number[])) : 0;
    const averageUnit = qtyRequested > 0 ? lineTotal / qtyRequested : 0;

    const warnings: string[] = [];
    if (qtyPriced < qtyRequested) warnings.push("Some units could not be priced/allocated.");

    return {
      key,
      productId,
      variantId,
      kind,
      qtyRequested,
      qtyPriced,
      allocations,
      lineTotal,
      minUnit,
      maxUnit,
      averageUnit,
      currency,
      warnings: warnings.length ? warnings : undefined,
    };
  };

  if (Array.isArray(maybe?.lines)) {
    for (const x of maybe.lines) {
      const ln = normalizeLine(x);
      if (ln) outLines[ln.key] = ln;
    }
  }

  if (!Object.keys(outLines).length && maybe?.lines && typeof maybe.lines === "object") {
    for (const [k, v] of Object.entries(maybe.lines)) {
      const ln = normalizeLine({ ...(v as any), key: k });
      if (ln) outLines[ln.key] = ln;
    }
  }

  const hasAny = Object.keys(outLines).length > 0;
  if (!hasAny && !(subtotal > 0)) return null;

  for (const it of cart) {
    const k = lineKeyFor(it);
    if (!outLines[k]) {
      outLines[k] = {
        key: k,
        productId: it.productId,
        variantId: it.variantId ?? null,
        kind: it.kind === "VARIANT" || it.variantId ? "VARIANT" : "BASE",
        qtyRequested: Math.max(1, asInt(it.qty, 1)),
        qtyPriced: 0,
        allocations: [],
        lineTotal: 0,
        minUnit: 0,
        maxUnit: 0,
        averageUnit: 0,
        currency,
        warnings: ["No quote returned for this line."],
      };
    }
  }

  return { currency, subtotal, lines: outLines, raw };
}

async function fetchPricingQuoteForCart(cart: CartItem[]): Promise<QuotePayload | null> {
  if (!cart.length) return null;

  const items = cart.map((it) => ({
    key: lineKeyFor(it),
    kind: it.kind === "VARIANT" || it.variantId ? "VARIANT" : "BASE",
    productId: it.productId,
    variantId: it.variantId ?? null,
    qty: Math.max(1, asInt(it.qty, 1)),
    selectedOptions: Array.isArray(it.selectedOptions) ? normalizeSelectedOptions(it.selectedOptions) : undefined,
    unitPriceCache: asMoney(it.unitPrice, 0),
  }));

  const attempts: Array<{ method: "post" | "get"; url: string; body?: any }> = [
    { method: "post", url: "/api/catalog/quote", body: { items } },
    { method: "post", url: "/api/cart/quote", body: { items } },
    { method: "post", url: "/api/checkout/quote", body: { items } },
    { method: "post", url: "/api/orders/quote", body: { items } },
    { method: "post", url: "/api/catalog/pricing", body: { items } },
    { method: "post", url: "/api/cart/pricing", body: { items } },
    { method: "post", url: "/api/checkout/pricing", body: { items } },
  ];

  for (const a of attempts) {
    try {
      const res =
        a.method === "post"
          ? await api.post(a.url, a.body)
          : await api.get(a.url, { params: { items: JSON.stringify(items) } });
      const normalized = normalizeQuoteResponse(res, cart);
      if (normalized) return normalized;
    } catch {
      /* try next */
    }
  }

  return null;
}

/* ---------------- Public settings fetch ---------------- */

async function fetchPublicSettings(): Promise<PublicSettings | null> {
  const attempts = ["/api/settings/public", "/api/settings/public?include=pricing", "/api/settings/public?scope=commerce"];

  for (const url of attempts) {
    try {
      const { data } = await api.get(url);
      const root = data?.data ?? data ?? null;
      if (root) return root as PublicSettings;
    } catch {
      /* try next */
    }
  }
  return null;
}

function extractMarginPercent(s: PublicSettings | null | undefined): number {
  if (!s) return 0;

  const direct = asMoney(s.marginPercent, NaN);
  if (Number.isFinite(direct)) return clampPct(direct);

  const commerce = asMoney(s.commerce?.marginPercent, NaN);
  if (Number.isFinite(commerce)) return clampPct(commerce);

  const pricing = asMoney(s.pricing?.marginPercent, NaN);
  if (Number.isFinite(pricing)) return clampPct(pricing);

  return 0;
}

/* ---------------- Component ---------------- */

export default function Cart() {
  const [cart, setCart] = useState<CartItem[]>(() => loadCart());
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      if (!cart.some((c) => asMoney(c.unitPrice, 0) <= 0)) return;
      const updated = await Promise.all(cart.map(hydrateLinePrice));
      setCart(updated);
      saveCart(updated);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  useEffect(() => {
    setQtyDraft((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const it of cart) {
        const k = lineKeyFor(it);
        const existing = prev[k];

        if (existing == null) {
          next[k] = String(Math.max(1, Number(it.qty) || 1));
          changed = true;
          continue;
        }

        const dNum = Number(existing);
        if (existing !== "" && Number.isFinite(dNum) && Math.trunc(dNum) !== (Number(it.qty) || 1)) {
          next[k] = String(Math.max(1, Number(it.qty) || 1));
          changed = true;
        }
      }

      for (const key of Object.keys(next)) {
        if (!cart.some((it) => lineKeyFor(it) === key)) {
          delete next[key];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [cart]);

  useEffect(() => {
    setCart((prev) => {
      const next = prev.map((it) => ({
        ...it,
        image: resolveImageUrl(it.image) ?? it.image,
      }));
      saveCart(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publicSettingsQ = useQuery({
    queryKey: ["settings", "public:v1"],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: fetchPublicSettings,
  });

  const marginPercent = useMemo(() => extractMarginPercent(publicSettingsQ.data), [publicSettingsQ.data]);

  const availabilityQ = useQuery({
    queryKey: ["catalog", "availability:v3", cart.map((i) => availKeyFor(i.productId, i.variantId ?? null)).sort().join(",")],
    enabled: cart.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
    queryFn: () => fetchAvailabilityForCart(cart),
  });

  const pricingQ = useQuery({
    queryKey: ["catalog", "pricing-quote:v1", cart.map((i) => `${lineKeyFor(i)}@${Math.max(1, asInt(i.qty, 1))}`).sort().join(",")],
    enabled: cart.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    queryFn: () => fetchPricingQuoteForCart(cart),
  });

  const sumOtherLinesQty = (productId: string, except: Pick<CartItem, "productId" | "variantId" | "selectedOptions" | "kind">) => {
    return cart.reduce((s, it) => {
      if (it.productId !== productId) return s;
      if (sameLine(it, except)) return s;
      return s + Math.max(0, Number(it.qty) || 0);
    }, 0);
  };

  useEffect(() => {
    const data = availabilityQ.data as AvailabilityPayload | undefined;
    if (!data || cart.length === 0) return;

    const next = cart.filter((it) => {
      const line = data.lines[availKeyFor(it.productId, it.variantId ?? null)];
      if (!line) return true;
      if (availabilityQ.isLoading) return true;
      return !(typeof line.totalAvailable === "number" && line.totalAvailable === 0);
    });

    if (next.length !== cart.length) setCart(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityQ.data, availabilityQ.isLoading]);

  const visibleCart = useMemo(() => {
    const data = availabilityQ.data as AvailabilityPayload | undefined;
    if (!data) return cart;

    return cart.filter((it) => {
      const line = data.lines[availKeyFor(it.productId, it.variantId ?? null)];
      return !(line && typeof line.totalAvailable === "number" && line.totalAvailable === 0);
    });
  }, [cart, availabilityQ.data]);

  const quoteLines = (pricingQ.data as QuotePayload | null)?.lines ?? {};
  const quoteSubtotalSupplier = (pricingQ.data as QuotePayload | null)?.subtotal;

  const quoteRetail = useMemo(() => {
    const q = pricingQ.data as QuotePayload | null;
    if (!q) return null;

    const linesRetail: Record<
      string,
      {
        retailLineTotal: number;
        retailMinUnit: number;
        retailMaxUnit: number;
        retailAverageUnit: number;
        allocationsRetail: Array<QuoteAllocation & { retailUnitPrice: number; retailLineTotal: number }>;
      }
    > = {};

    let subtotalRetail = 0;

    for (const [k, ln] of Object.entries(q.lines || {})) {
      const allocs = (ln.allocations || []).filter((a) => a.qty > 0);

      const allocationsRetail = allocs.map((a) => {
        const retailUnitPrice = applyMargin(asMoney(a.unitPrice, 0), marginPercent);
        const retailLineTotal = retailUnitPrice * Math.max(0, asInt(a.qty, 0));
        return {
          ...a,
          retailUnitPrice,
          retailLineTotal,
        };
      });

      const retailLineTotal = allocationsRetail.reduce((s, a) => s + asMoney(a.retailLineTotal, 0), 0);

      const units = allocationsRetail.map((a) => asMoney(a.retailUnitPrice, NaN)).filter((n) => Number.isFinite(n));
      const retailMinUnit = units.length ? Math.min(...(units as number[])) : 0;
      const retailMaxUnit = units.length ? Math.max(...(units as number[])) : 0;

      const qtyReq = Math.max(1, asInt(ln.qtyRequested, 1));
      const retailAverageUnit = qtyReq > 0 ? retailLineTotal / qtyReq : 0;

      linesRetail[k] = {
        retailLineTotal,
        retailMinUnit,
        retailMaxUnit,
        retailAverageUnit,
        allocationsRetail,
      };

      subtotalRetail += retailLineTotal;
    }

    return {
      subtotalRetail: round2(subtotalRetail),
      linesRetail,
      currency: q.currency ?? null,
    };
  }, [pricingQ.data, marginPercent]);

  const total = useMemo(() => {
    if (quoteRetail && quoteRetail.subtotalRetail > 0) return quoteRetail.subtotalRetail;
    return visibleCart.reduce((s, it) => s + (Number(it.totalPrice) || 0), 0);
  }, [visibleCart, quoteRetail]);

  const computedCapForLine = (item: CartItem): number | undefined => {
    const data = availabilityQ.data as AvailabilityPayload | undefined;
    if (!data) return undefined;

    const pools = data.products[item.productId];
    const line = data.lines[availKeyFor(item.productId, item.variantId ?? null)];
    if (!line || typeof line.totalAvailable !== "number") return undefined;

    if (pools?.hasVariantSpecific) return Math.max(0, line.totalAvailable);

    const pool = Math.max(0, pools?.genericTotal ?? line.totalAvailable);
    const otherQty = sumOtherLinesQty(item.productId, item);
    return Math.max(0, pool - otherQty);
  };

  const clampToMax = (item: CartItem, wantQty: number) => {
    const data = availabilityQ.data as AvailabilityPayload | undefined;
    const desired = Math.max(1, Math.floor(Number(wantQty) || 1));
    if (!data) return desired;

    const pools = data.products[item.productId];
    const line = data.lines[availKeyFor(item.productId, item.variantId ?? null)];
    if (!line || typeof line.totalAvailable !== "number") return desired;

    if (pools?.hasVariantSpecific) {
      const cap = Math.max(1, line.totalAvailable);
      return Math.min(desired, cap);
    }

    const pool = Math.max(0, pools?.genericTotal ?? line.totalAvailable);
    const otherQty = sumOtherLinesQty(item.productId, item);
    const capForThisLine = Math.max(0, pool - otherQty);
    const cap = Math.max(1, capForThisLine);
    return Math.min(desired, cap);
  };

  const updateQty = useCallback(
    (target: CartItem, newQtyRaw: number) => {
      const clamped = clampToMax(target, newQtyRaw);

      setCart((prev) =>
        prev.map((it) => {
          if (!sameLine(it, target)) return it;

          const unit =
            Number.isFinite(Number(it.unitPrice)) && it.unitPrice > 0
              ? Number(it.unitPrice)
              : (Number(it.totalPrice) || 0) / Math.max(1, Number(it.qty) || 1);

          return {
            ...it,
            qty: clamped,
            totalPrice: (unit > 0 ? unit : 0) * clamped,
            unitPrice: unit > 0 ? unit : it.unitPrice,
          };
        })
      );

      return clamped;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availabilityQ.data, cart]
  );

  const remove = (target: CartItem) => {
    setCart((prev) => prev.filter((it) => !sameLine(it, target)));
  };

  const cartBlockingReason = useMemo(() => {
    const data = availabilityQ.data as AvailabilityPayload | undefined;
    if (!data) return null;

    for (const productId of new Set(visibleCart.map((i) => i.productId))) {
      const pools = data.products[productId];

      if (!pools) {
        const outOfCap = visibleCart
          .filter((i) => i.productId === productId)
          .some((i) => {
            const ln = data.lines[availKeyFor(i.productId, i.variantId ?? null)];
            return ln && typeof ln.totalAvailable === "number" && i.qty > ln.totalAvailable;
          });
        if (outOfCap) return "Reduce quantities: some items exceed available stock.";
        continue;
      }

      if (pools.hasVariantSpecific) {
        for (const it of visibleCart.filter((i) => i.productId === productId)) {
          const ln = data.lines[availKeyFor(it.productId, it.variantId ?? null)];
          const cap = ln && typeof ln.totalAvailable === "number" ? Math.max(0, ln.totalAvailable) : 0;
          if (it.qty > cap) return "Reduce quantities: some items exceed available stock.";
        }
      } else {
        const sumQty = visibleCart
          .filter((i) => i.productId === productId)
          .reduce((s, i) => s + Math.max(0, Number(i.qty) || 0), 0);
        if (sumQty > pools.genericTotal) return "Reduce quantities: some items exceed available stock.";
      }
    }

    return null;
  }, [visibleCart, availabilityQ.data]);

  const canCheckout = cartBlockingReason == null;

  const pricingWarning = useMemo(() => {
    const q = pricingQ.data as QuotePayload | null;
    if (!q) return null;

    const unpriced = Object.values(q.lines || {}).filter((l) => l.qtyPriced < l.qtyRequested);
    if (!unpriced.length) return null;

    return "Some items could not be fully allocated across suppliers. Reduce quantities or try again.";
  }, [pricingQ.data]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ✅ Common “tap reliability” class for all interactive controls
  const tap =
    "touch-manipulation [-webkit-tap-highlight-color:transparent]";

  if (visibleCart.length === 0) {
    return (
      <SiteLayout>
        <div className="min-h-[88vh] bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft relative overflow-hidden grid place-items-center px-4">
          <div className="pointer-events-none -z-10 absolute -top-24 -left-24 size-80 rounded-full bg-primary-500/20 blur-3xl animate-pulse" />
          <div className="pointer-events-none -z-10 absolute -bottom-28 -right-24 size-96 rounded-full bg-fuchsia-400/20 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />

          <div className="max-w-md w-full text-center relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-3 py-1 text-[11px] font-semibold shadow-sm">
              <span className="inline-block size-1.5 rounded-full bg-white/90" />
              Your cart is empty
            </div>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-ink">Let’s find something you’ll love</h1>
            <p className="mt-1 text-ink-soft">Browse our catalogue and add items to your cart. They’ll show up here for checkout.</p>
            <Link
              to="/"
              className={`${tap} mt-5 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-5 py-3 font-semibold shadow-sm hover:shadow-md active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-primary-200 transition`}
            >
              Go shopping
            </Link>
          </div>
        </div>
      </SiteLayout>
    );
  }

  const topBannerLoading = pricingQ.isLoading || pricingQ.isFetching;
  const topBannerText = topBannerLoading ? "Calculating best supplier prices…" : pricingWarning ?? "";

  return (
    <SiteLayout>
      <div className="bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft relative overflow-hidden isolate">
        {/* ✅ Put blobs behind EVERYTHING and never intercept taps */}
        <div className="pointer-events-none -z-10 absolute -top-28 -left-24 size-96 rounded-full bg-primary-500/20 blur-3xl animate-pulse" />
        <div className="pointer-events-none -z-10 absolute -bottom-32 -right-28 size-[28rem] rounded-full bg-fuchsia-400/20 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />

        {/* ✅ tighter padding for ultra-small screens + ensure content is above blobs */}
        <div className="relative z-10 max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-5 sm:py-8 max-[360px]:px-2 max-[360px]:py-4">
          <div className="mb-4 sm:mb-6 text-center md:text-left">
            <span className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-3 py-1 text-[11px] font-semibold shadow-sm">
              <span className="inline-block size-1.5 rounded-full bg-white/90" />
              Review &amp; edit
            </span>

            {/* ✅ smaller headline on ultra-small */}
            <h1 className="mt-3 text-[26px] sm:text-3xl font-extrabold tracking-tight text-ink max-[360px]:text-[22px]">
              Your cart
            </h1>

            <p className="text-sm max-[360px]:text-[12px] text-ink-soft">
              Prices shown are <span className="font-medium">retail</span> (supplier offers + margin).
            </p>

            {(topBannerLoading || !!pricingWarning) && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border bg-white/70 px-3 py-1 text-[12px] max-[360px]:text-[11px] text-ink-soft">
                <span className={`inline-block size-2 rounded-full ${topBannerLoading ? "bg-amber-400 animate-pulse" : "bg-rose-400"}`} />
                {topBannerText}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-4 sm:gap-6">
            {/* LEFT: Items */}
            <section className="space-y-3 sm:space-y-4">
              {visibleCart.map((it) => {
                const k = lineKeyFor(it);
                const ql = quoteLines[k];
                const rl = quoteRetail?.linesRetail?.[k];

                const currentQty = Math.max(1, Number(it.qty) || 1);

                const fallbackUnit =
                  asMoney(it.unitPrice, 0) > 0
                    ? asMoney(it.unitPrice, 0)
                    : currentQty > 0
                      ? asMoney(it.totalPrice, 0) / currentQty
                      : 0;

                const hasQuote = !!ql && (ql.lineTotal > 0 || ql.allocations.length > 0);
                const hasRetailLine = !!rl && rl.retailLineTotal > 0;

                const lineTotal = hasRetailLine
                  ? rl.retailLineTotal
                  : hasQuote
                    ? applyMargin(asMoney(ql.lineTotal, 0), marginPercent)
                    : asMoney(it.totalPrice, 0);

                const unitText = (() => {
                  if (!hasRetailLine) return fallbackUnit > 0 ? ngn.format(fallbackUnit) : "Pending";
                  if (rl.retailMinUnit === rl.retailMaxUnit) return ngn.format(rl.retailMinUnit);
                  if (rl.retailMinUnit > 0 && rl.retailMaxUnit > 0) return `${ngn.format(rl.retailMinUnit)} – ${ngn.format(rl.retailMaxUnit)}`;
                  return rl.retailAverageUnit > 0 ? ngn.format(rl.retailAverageUnit) : "Pending";
                })();

                const splitBadge =
                  hasQuote && ql.allocations.filter((a) => a.qty > 0).length > 1
                    ? "Split across suppliers"
                    : hasQuote && ql.allocations.length === 1
                      ? "Single supplier"
                      : "";

                const data = availabilityQ.data as AvailabilityPayload | undefined;
                const pools = data?.products[it.productId];
                const line = data?.lines[availKeyFor(it.productId, it.variantId ?? null)];

                const cap = computedCapForLine(it);
                const capText =
                  typeof cap === "number"
                    ? cap > 0
                      ? it.qty > cap
                        ? `Only ${cap} available. Please reduce.`
                        : `Max you can buy now: ${cap}`
                      : "Out of stock"
                    : "";

                const kindLabel = isBaseLine(it) ? "Base" : it.variantId ? "Variant" : it.selectedOptions?.length ? "Configured" : "Item";

                let helperText = "";
                if (availabilityQ.isLoading) helperText = "Checking availability…";
                else if (line && typeof line.totalAvailable === "number") helperText = capText;

                const isExpanded = !!expanded[k];

                const draft = qtyDraft[k];
                const inputValue = draft == null ? String(currentQty) : draft;

                const commitDraft = () => {
                  const raw = qtyDraft[k];
                  const parsed = raw === "" || raw == null ? 1 : Math.floor(Number(raw));
                  const desired = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
                  const clamped = updateQty(it, desired);
                  setQtyDraft((p) => ({ ...p, [k]: String(clamped) }));
                };

                const effectiveQtyForButtons = () => {
                  const raw = qtyDraft[k];
                  if (raw == null || raw === "") return currentQty;
                  const n = Math.floor(Number(raw));
                  return Number.isFinite(n) && n > 0 ? n : currentQty;
                };

                const inc = () => {
                  const base = effectiveQtyForButtons();
                  const clamped = updateQty(it, base + 1);
                  setQtyDraft((p) => ({ ...p, [k]: String(clamped) }));
                };

                const dec = () => {
                  const base = effectiveQtyForButtons();
                  const clamped = updateQty(it, Math.max(1, base - 1));
                  setQtyDraft((p) => ({ ...p, [k]: String(clamped) }));
                };

                return (
                  <article
                    key={k}
                    className="group rounded-2xl border border-white/60 bg-white/75 backdrop-blur shadow-[0_6px_30px_rgba(0,0,0,0.06)]
                               p-3 sm:p-5 max-[360px]:p-3 overflow-hidden relative z-10"
                  >
                    {/* stack on mobile, row on sm+ */}
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
                      {/* Thumbnail */}
                      <div className="shrink-0 w-16 h-16 sm:w-20 sm:h-20 max-[360px]:w-14 max-[360px]:h-14 rounded-xl border overflow-hidden bg-white self-start relative">
                        <div className="absolute inset-0 grid place-items-center text-[11px] text-ink-soft">No image</div>

                        {resolveImageUrl(it.image) && (
                          <img
                            src={resolveImageUrl(it.image)}
                            alt=""
                            aria-hidden="true"
                            className="relative w-full h-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        )}
                      </div>

                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h3
                              className="font-semibold text-ink text-[14px] sm:text-base leading-snug truncate"
                              title={it.title}
                            >
                              {it.title}
                            </h3>

                            <button
                              type="button"
                              className={`${tap} shrink-0 whitespace-nowrap text-[12px] sm:text-sm text-rose-600 hover:underline rounded-lg px-2 py-1 hover:bg-rose-500/10 transition`}
                              onClick={() => remove(it)}
                              aria-label={`Remove ${it.title}`}
                              title="Remove item"
                            >
                              Remove
                            </button>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded-full border bg-white text-ink-soft">{kindLabel}</span>
                            {!!splitBadge && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full border bg-white text-ink-soft">
                                {splitBadge}
                              </span>
                            )}
                            {pricingQ.isFetching && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full border bg-white text-ink-soft">
                                Updating…
                              </span>
                            )}
                          </div>

                          {!!it.selectedOptions?.length && (
                            <div className="mt-2 text-[12px] max-[360px]:text-[11px] sm:text-xs text-ink-soft leading-snug break-words">
                              {it.selectedOptions.map((o) => `${o.attribute}: ${o.value}`).join(" • ")}
                            </div>
                          )}

                          <div className="mt-2 grid grid-cols-1 gap-1 text-[12px] max-[360px]:text-[11px] sm:text-xs text-ink-soft">
                            <div>
                              Unit: <span className="font-medium text-ink">{unitText}</span>
                              {hasRetailLine && rl.retailMinUnit !== rl.retailMaxUnit ? (
                                <span className="ml-2 text-[11px]">(varies)</span>
                              ) : null}
                            </div>

                            {!!helperText && <div className="text-[11px]">{helperText}</div>}

                            {pools?.hasVariantSpecific && isBaseLine(it) && (
                              <div className="text-[11px]">Base pool. Variants use their own pools.</div>
                            )}
                          </div>

                          {hasRetailLine && (rl.allocationsRetail?.length ?? 0) > 0 && (
                            <button
                              className={`${tap} mt-2 text-[11px] text-primary-700 hover:underline`}
                              onClick={() => setExpanded((p) => ({ ...p, [k]: !p[k] }))}
                              type="button"
                            >
                              {isExpanded ? "Hide supplier breakdown" : "Show supplier breakdown"}
                            </button>
                          )}
                        </div>

                        {hasRetailLine && isExpanded && (rl.allocationsRetail?.length ?? 0) > 0 && (
                          <div className="mt-3 rounded-xl border bg-white/70 p-3 text-xs">
                            <div className="flex items-center justify-between text-ink-soft">
                              <span>Supplier split (retail)</span>
                              <span className="font-medium text-ink">{ngn.format(asMoney(rl.retailLineTotal, 0))}</span>
                            </div>

                            <div className="mt-2 space-y-1">
                              {rl.allocationsRetail
                                .filter((a) => a.qty > 0)
                                .map((a, idx) => (
                                  <div key={`${a.supplierId}-${idx}`} className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="font-medium text-ink truncate">{a.supplierName || "Supplier"}</div>
                                      <div className="text-ink-soft">
                                        {a.qty} × {ngn.format(asMoney(a.retailUnitPrice, 0))}
                                      </div>
                                    </div>
                                    <div className="font-semibold text-ink whitespace-nowrap">
                                      {ngn.format(asMoney(a.retailLineTotal, 0))}
                                    </div>
                                  </div>
                                ))}
                            </div>

                            {ql && ql.qtyPriced < ql.qtyRequested && (
                              <div className="mt-2 text-[11px] text-rose-700">
                                Only {ql.qtyPriced} out of {ql.qtyRequested} could be allocated.
                              </div>
                            )}
                          </div>
                        )}

                        {/* quantity + total */}
                        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="flex items-center justify-between sm:justify-start gap-3">
                            <div className="flex items-center rounded-xl border border-border bg-white overflow-hidden shadow-sm">
                              <button
                                type="button"
                                aria-label="Decrease quantity"
                                className={`${tap} px-3 py-2 max-[360px]:px-2 max-[360px]:py-1.5 hover:bg-black/5 active:scale-[0.98] transition`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={dec}
                              >
                                −
                              </button>

                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={inputValue}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === "") {
                                    setQtyDraft((p) => ({ ...p, [k]: "" }));
                                    return;
                                  }
                                  if (!/^\d+$/.test(v)) return;
                                  setQtyDraft((p) => ({ ...p, [k]: v }));
                                }}
                                onBlur={() => commitDraft()}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                                }}
                                className="w-14 sm:w-16 max-[360px]:w-12 text-center outline-none px-2 py-2 max-[360px]:py-1.5 bg-white"
                                aria-label="Quantity"
                              />

                              <button
                                type="button"
                                aria-label="Increase quantity"
                                className={`${tap} px-3 py-2 max-[360px]:px-2 max-[360px]:py-1.5 hover:bg-black/5 active:scale-[0.98] transition`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={inc}
                              >
                                +
                              </button>
                            </div>

                            <span className="text-xs max-[360px]:text-[11px] text-ink-soft">Qty</span>
                          </div>

                          <div className="sm:ml-auto rounded-xl border bg-white/70 px-3 py-2 text-right min-w-[140px] max-[360px]:min-w-[0]">
                            <div className="text-[11px] text-ink-soft">Line total</div>
                            <div className="text-[18px] sm:text-lg font-semibold tracking-tight break-words">
                              {ngn.format(lineTotal)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>

            {/* RIGHT: Summary */}
            <aside className="lg:sticky lg:top-6 h-max relative z-10">
              <div className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur p-4 sm:p-5 max-[360px]:p-3 shadow-[0_6px_30px_rgba(0,0,0,0.06)] overflow-hidden">
                <h2 className="text-lg max-[360px]:text-base font-semibold text-ink">Order summary</h2>

                {/* ✅ prevent overlap on tiny screens */}
                <div className="mt-4 grid gap-3 text-[13px] max-[360px]:text-[12px] sm:text-sm">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                    <span className="text-ink-soft leading-tight">Items</span>
                    <span className="font-semibold text-ink whitespace-nowrap text-right">{visibleCart.length}</span>
                  </div>

                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                    <span className="text-ink-soft leading-tight">
                      Subtotal <span className="text-[11px]">(retail)</span>
                    </span>
                    <span className="font-semibold text-ink whitespace-nowrap text-right">{ngn.format(total)}</span>
                  </div>

                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                    <span className="text-ink-soft leading-tight">Shipping</span>
                    <span className="font-semibold text-ink text-right leading-tight">
                      Calculated
                      <br />
                      at checkout
                    </span>
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-white/50">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-semibold text-ink">Total</span>

                    {/* ✅ allow wrap on ultra-small (no more crushing/overflow) */}
                    <span className="text-[26px] sm:text-2xl max-[360px]:text-[22px] font-extrabold tracking-tight text-ink break-words">
                      {ngn.format(total)}
                    </span>
                  </div>

                  {!canCheckout && <p className="mt-2 text-[12px] text-rose-600">{cartBlockingReason}</p>}
                  {pricingWarning && <p className="mt-2 text-[12px] text-rose-600">{pricingWarning}</p>}

                  <Link
                    to={canCheckout && !pricingWarning ? "/checkout" : "#"}
                    onClick={(e) => {
                      if (!canCheckout || !!pricingWarning) e.preventDefault();
                    }}
                    className={`${tap} mt-4 w-full inline-flex items-center justify-center rounded-xl px-4 py-3 max-[360px]:py-2.5 font-semibold shadow-sm transition
                      ${canCheckout && !pricingWarning
                        ? "bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white hover:shadow-md active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-primary-200"
                        : "bg-zinc-200 text-zinc-500 cursor-not-allowed"
                      }`}
                    aria-disabled={!canCheckout || !!pricingWarning}
                  >
                    <span className="sm:hidden">Checkout</span>
                    <span className="hidden sm:inline">Proceed to checkout</span>
                  </Link>

                  <Link
                    to="/"
                    className={`${tap} mt-3 w-full inline-flex items-center justify-center rounded-xl border border-border bg-white px-4 py-3 max-[360px]:py-2.5 text-ink hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-50 transition`}
                  >
                    Continue shopping
                  </Link>

                  <p className="mt-3 text-[11px] text-ink-soft">Totals above use live supplier offers.</p>
                </div>
              </div>

              <p className="mt-3 text-[11px] text-ink-soft text-center">
                Taxes &amp; shipping are shown at checkout. You can update addresses there.
              </p>
            </aside>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
