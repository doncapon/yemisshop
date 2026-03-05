// src/pages/Cart.tsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import SiteLayout from "../layouts/SiteLayout";
import { useAuthStore } from "../store/auth";

// ✅ Shared cart model (single source of truth for guest/local mirror)
import { readCartLines, writeCartLines, toCartPageItems } from "../utils/cartModel";

/* ---------------- Types ---------------- */

type SelectedOption = {
  attributeId: string;
  attribute: string;
  valueId?: string;
  value: string;
};

type CartItem = {
  id?: string; // server cart item id (when authed)
  kind?: "BASE" | "VARIANT";
  productId: string;
  variantId?: string | null;

  title: string;
  qty: number;

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
  genericTotal: number;
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
  unitPrice: number;
  offerId?: string | null;
  lineTotal?: number;
};

type QuoteLine = {
  key: string;
  productId: string;
  variantId?: string | null;
  kind: "BASE" | "VARIANT";
  qtyRequested: number;
  qtyPriced: number;
  allocations: QuoteAllocation[];
  lineTotal: number;
  minUnit: number;
  maxUnit: number;
  averageUnit: number;
  currency?: string | null;
  warnings?: string[];
};

type QuotePayload = {
  currency?: string | null;
  subtotal: number;
  lines: Record<string, QuoteLine>;
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

const API_ORIGIN =
  String((import.meta as any)?.env?.VITE_API_URL || (import.meta as any)?.env?.API_URL || "")
    .trim()
    .replace(/\/+$/, "") || "https://api.dayspringhouse.com";

function resolveImageUrl(input?: string | null): string | undefined {
  const s = String(input ?? "").trim();
  if (!s) return undefined;

  if (/^(https?:\/\/|data:|blob:)/i.test(s)) return s;
  if (s.startsWith("//")) return `${window.location.protocol}${s}`;

  if (s.startsWith("/")) {
    if (s.startsWith("/uploads/") || s.startsWith("/api/uploads/")) return `${API_ORIGIN}${s}`;
    return `${window.location.origin}${s}`;
  }

  if (s.startsWith("uploads/") || s.startsWith("api/uploads/")) return `${API_ORIGIN}/${s}`;
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

const AXIOS_COOKIE_CFG = { withCredentials: true as const };

/* ---------------- Server cart fetch ---------------- */

type ServerCartItem = {
  id: string;
  productId: string;
  variantId?: string | null;
  kind?: "BASE" | "VARIANT";
  qty: number;
  selectedOptions?: any;
  titleSnapshot?: string | null;
  imageSnapshot?: string | null;
  unitPriceCache?: any;
};

/* ---------------- Shared keys / options ---------------- */

function isCodeLike(raw: string | undefined | null): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  if (/\s/.test(s)) return false;
  if (/^cmm[0-9a-z]{5,}$/i.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  if (/^[0-9a-f]{16,}$/i.test(s)) return true;
  return false;
}

function normalizeSelectedOptions(raw: any): SelectedOption[] {
  const arr = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((o: any) => ({
      attributeId: String(o.attributeId ?? ""),
      attribute: String(o.attribute ?? ""),
      valueId: o.valueId ? String(o.valueId) : undefined,
      value: String(o.value ?? ""),
    }))
    .filter((o: any) => o.attributeId || o.attribute || o.valueId || o.value);

  arr.sort((a, b) => {
    const aKey = `${a.attributeId}:${a.valueId ?? a.value}`;
    const bKey = `${b.attributeId}:${b.valueId ?? b.value}`;
    return aKey.localeCompare(bKey);
  });

  return arr;
}

async function fetchServerCart(): Promise<CartItem[]> {
  const { data } = await api.get("/api/cart", AXIOS_COOKIE_CFG);
  const items: ServerCartItem[] = Array.isArray((data as any)?.items) ? (data as any).items : [];

  return items.map((it) => {
    const qty = Math.max(1, Number(it.qty) || 1);
    const unit = Number(it.unitPriceCache) || 0;
    const title = String(it.titleSnapshot ?? "");
    const img = it.imageSnapshot ? resolveImageUrl(it.imageSnapshot) : undefined;

    return {
      id: String(it.id),
      kind: (it.kind as any) || (it.variantId ? "VARIANT" : "BASE"),
      productId: String(it.productId),
      variantId: it.variantId == null ? null : String(it.variantId),
      title,
      qty,
      unitPrice: unit,
      totalPrice: unit * qty,
      selectedOptions: normalizeSelectedOptions(it.selectedOptions),
      image: img,
    };
  });
}

async function serverSetQty(item: CartItem, qty: number) {
  if (!item.id) return;
  const next = Math.max(0, Math.floor(Number(qty) || 0));
  if (next <= 0) {
    await api.delete(`/api/cart/items/${item.id}`, AXIOS_COOKIE_CFG);
  } else {
    await api.patch(`/api/cart/items/${item.id}`, { qty: next }, AXIOS_COOKIE_CFG);
  }
}

function optionsKey(sel?: SelectedOption[]) {
  const s = (sel ?? []).filter(Boolean);
  if (!s.length) return "";
  return s.map((o) => `${o.attributeId}=${o.valueId ?? o.value}`).join("|");
}

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

const availKeyFor = (productId: string, variantId?: string | null) => `${productId}::${variantId ?? "null"}`;

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

  const pairs = items.map((i) => ({
    productId: i.productId,
    variantId: i.variantId ?? null,
  }));

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
      const arr = Array.isArray((data as any)?.data) ? (data as any).data : Array.isArray(data) ? data : [];

      const lines: Record<string, Availability> = {};
      const byProduct: Record<string, { generic: number; perVariant: Record<string, number> }> = {};

      for (const r of arr as any[]) {
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
    } catch {
      /* try next */
    }
  }

  return { lines: {}, products: {} };
}

/* ---------------- Quote & settings fetch ---------------- */
/* (left as in your existing file – unchanged) */

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
    const kind: "BASE" | "VARIANT" =
      x?.kind === "BASE" || x?.kind === "VARIANT" ? x.kind : variantId ? "VARIANT" : "BASE";

    const qtyRequested = Math.max(1, asInt(x?.qtyRequested ?? x?.qty ?? x?.requestedQty ?? 1, 1));

    const allocsRaw = (Array.isArray(x?.allocations) ? x.allocations : x?.allocations ? [x.allocations] : []).concat(
      Array.isArray(x?.splits) ? x.splits : x?.splits ? [x.splits] : []
    );

    const allocations = allocsRaw.map(normalizeAlloc).filter((a: any) => a.qty > 0 && a.unitPrice >= 0);

    const lineTotal = asMoney(
      x?.lineTotal ?? x?.total ?? allocations.reduce((s: any, a: any) => s + asMoney(a.lineTotal, 0), 0),
      0
    );

    const qtyPriced = Math.max(0, asInt(x?.qtyPriced ?? allocations.reduce((s: any, a: any) => s + asInt(a.qty, 0), 0), 0));

    const units = allocations.map((a: any) => asMoney(a.unitPrice, NaN)).filter((n: any) => Number.isFinite(n));
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
        a.method === "post" ? await api.post(a.url, a.body) : await api.get(a.url, { params: { items: JSON.stringify(items) } });
      const normalized = normalizeQuoteResponse(res, cart);
      if (normalized) return normalized;
    } catch { }
  }

  return null;
}

async function fetchPublicSettings(): Promise<PublicSettings | null> {
  const attempts = ["/api/settings/public", "/api/settings/public?include=pricing", "/api/settings/public?scope=commerce"];
  for (const url of attempts) {
    try {
      const { data } = await api.get(url);
      const root = (data as any)?.data ?? data ?? null;
      if (root) return root as PublicSettings;
    } catch { }
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

/* =========================================================
   Component
========================================================= */

export default function Cart() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isAuthed = !!userId;

  const [cart, setCart] = useState<CartItem[]>([]);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});

  // ✅ track which qty input is being edited so we don't "sync" over it
  const focusedQtyKeyRef = useRef<string | null>(null);

  // ✅ disappearing red correction notes (per-line)
  const [qtyNote, setQtyNote] = useState<Record<string, string>>({});
  const qtyNoteTimers = useRef<Record<string, number>>({});

  const NOTE_TTL_MS = 2200;

  const clearQtyNoteTimer = (key: string) => {
    if (qtyNoteTimers.current[key]) {
      clearTimeout(qtyNoteTimers.current[key]);
      delete qtyNoteTimers.current[key];
    }
  };

  const scheduleHideQtyNote = (key: string, delayMs: number) => {
    clearQtyNoteTimer(key);

    qtyNoteTimers.current[key] = window.setTimeout(() => {
      // if user is hovering, do not hide
      if (hoveredQtyNoteKey === key) return;

      setQtyNote((p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });

      delete qtyNoteMetaRef.current[key];
      clearQtyNoteTimer(key);
    }, Math.max(0, Math.floor(delayMs)));
  };

  // ✅ hover-to-persist qty correction note
  const [hoveredQtyNoteKey, setHoveredQtyNoteKey] = useState<string | null>(null);
  const qtyNoteMetaRef = useRef<Record<string, { expiresAt: number; remainingMs: number }>>({});
  const qtyCommitTimersRef = useRef<Record<string, number>>({});
  const lastDesiredQtyRef = useRef<Record<string, number>>({});
  // Locks a line while a debounced commit is pending (prevents sync from overwriting draft mid-edit)
  const lockedQtyKeysRef = useRef<Set<string>>(new Set());


  // prevent loops when we ourselves write local mirror for authed
  const suppressNextCartEventRef = useRef(false);

  const mirrorAuthedCartToLocal = useCallback((items: CartItem[]) => {
    const lines = items.map((x) => ({
      productId: String(x.productId),
      variantId: x.variantId == null ? null : String(x.variantId),
      kind: (x.kind === "VARIANT" || x.variantId ? "VARIANT" : "BASE") as "BASE" | "VARIANT",
      optionsKey: "",
      qty: Math.max(0, Number(x.qty) || 0),
      selectedOptions: Array.isArray(x.selectedOptions) ? x.selectedOptions : [],
      titleSnapshot: x.title ?? null,
      imageSnapshot: x.image ?? null,
      unitPriceCache: Number.isFinite(Number(x.unitPrice)) ? Number(x.unitPrice) : 0,
    }));

    suppressNextCartEventRef.current = true;
    writeCartLines(lines as any);
  }, []);

  const loadCart = useCallback(async () => {
    if (isAuthed) {
      try {
        const serverItems = await fetchServerCart();
        setCart(serverItems);
        mirrorAuthedCartToLocal(serverItems);
        return;
      } catch {
        const localItems = toCartPageItems(readCartLines(), resolveImageUrl) as any as CartItem[];
        setCart(localItems);
        return;
      }
    }

    const guestItems = toCartPageItems(readCartLines(), resolveImageUrl) as any as CartItem[];
    setCart(guestItems);
  }, [isAuthed, mirrorAuthedCartToLocal]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadCart();
      } catch {
        if (!cancelled) {
          const fallback = toCartPageItems(readCartLines(), resolveImageUrl) as any as CartItem[];
          setCart(fallback);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCart, isAuthed]);

  useEffect(() => {
    const onCartUpdated = () => {
      if (suppressNextCartEventRef.current) {
        suppressNextCartEventRef.current = false;
        return;
      }

      if (isAuthed) {
        loadCart().catch(() => { });
        return;
      }

      const guestItems = toCartPageItems(readCartLines(), resolveImageUrl) as any as CartItem[];
      setCart(guestItems);
    };

    window.addEventListener("cart:updated", onCartUpdated);
    return () => window.removeEventListener("cart:updated", onCartUpdated);
  }, [isAuthed, loadCart]);

  // ✅ Sync qtyDraft from cart, but NEVER overwrite the line the user is actively typing into.
  useEffect(() => {
    setQtyDraft((prev) => {
      let changed = false;
      const next = { ...prev };
      const focusedKey = focusedQtyKeyRef.current;

      for (const it of cart) {
        const k = lineKeyFor(it);

        // if user is editing this input, don't touch their draft
        if ((focusedKey && focusedKey === k) || lockedQtyKeysRef.current.has(k)) continue;
        const cartQty = String(Math.max(1, Number(it.qty) || 1));
        const existing = prev[k];

        if (existing == null || existing === "") {
          next[k] = cartQty;
          changed = true;
          continue;
        }

        // only "sync back" if the cart qty actually changed vs the draft value
        // (and the user isn't editing that field, handled above)
        if (existing !== "" && existing !== cartQty) {
          const dNum = Number(existing);
          if (Number.isFinite(dNum) && Math.trunc(dNum) !== Math.trunc(Number(it.qty) || 1)) {
            next[k] = cartQty;
            changed = true;
          }
        }
      }

      // remove drafts for removed items (unless it's focused; safe to remove anyway, but keep it tidy)60
      for (const key of Object.keys(next)) {
        if (!cart.some((it) => lineKeyFor(it) === key)) {
          delete next[key];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [cart]);

  const publicSettingsQ = useQuery({
    queryKey: ["settings", "public:v1"],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: fetchPublicSettings,
    notifyOnChangeProps: ["data"],
  });

  const marginPercent = useMemo(() => extractMarginPercent(publicSettingsQ.data), [publicSettingsQ.data]);

  const availabilityQ = useQuery({
    queryKey: [
      "catalog",
      "availability:v3",
      cart
        .map((i) => availKeyFor(i.productId, i.variantId ?? null))
        .sort()
        .join(","),
    ],
    enabled: cart.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
    queryFn: () => fetchAvailabilityForCart(cart),
    notifyOnChangeProps: ["data"],
  });

  const pricingQ = useQuery({
    queryKey: ["catalog", "pricing-quote:v1", cart.map((i) => lineKeyFor(i)).sort().join(",")],
    enabled: cart.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    queryFn: () => fetchPricingQuoteForCart(cart),
    notifyOnChangeProps: ["data"],
  });

  const visibleCart = useMemo(() => cart, [cart]);
  const quoteLines = (pricingQ.data as QuotePayload | null)?.lines ?? {};

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
        return { ...a, retailUnitPrice, retailLineTotal };
      });

      const retailLineTotal = allocationsRetail.reduce((s, a) => s + asMoney((a as any).retailLineTotal, 0), 0);

      const units = allocationsRetail.map((a) => asMoney((a as any).retailUnitPrice, NaN)).filter((n) => Number.isFinite(n));
      const retailMinUnit = units.length ? Math.min(...(units as number[])) : 0;
      const retailMaxUnit = units.length ? Math.max(...(units as number[])) : 0;

      const qtyReq = Math.max(1, asInt(ln.qtyRequested, 1));
      const retailAverageUnit = qtyReq > 0 ? retailLineTotal / qtyReq : 0;

      linesRetail[k] = {
        retailLineTotal,
        retailMinUnit,
        retailMaxUnit,
        retailAverageUnit,
        allocationsRetail: allocationsRetail as any,
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
    return visibleCart.reduce((sum, it) => {
      const qty = Math.max(1, Number(it.qty) || 1);
      const cachedUnit = asMoney(it.unitPrice, 0) > 0 ? asMoney(it.unitPrice, 0) : qty > 0 ? asMoney(it.totalPrice, 0) / qty : 0;
      const lineTotal = round2(Math.max(0, cachedUnit) * qty);
      return sum + lineTotal;
    }, 0);
  }, [visibleCart]);

  /* =========================
     ✅ POOL-AWARE CAP LOGIC
     ========================= */

  const poolKeyForItem = useCallback((it: CartItem, data?: AvailabilityPayload) => {
    const pid = String(it.productId);
    const vid = it.variantId == null ? null : String(it.variantId);
    const pool = data?.products?.[pid];

    if (vid && pool?.perVariantTotals && Object.prototype.hasOwnProperty.call(pool.perVariantTotals, vid)) {
      return `p:${pid}:v:${vid}`;
    }

    if (!vid) {
      if (pool?.hasVariantSpecific) return `p:${pid}:generic`;
      return `p:${pid}:product`;
    }

    return `p:${pid}:generic`;
  }, []);


  const showQtyNote = useCallback(
    (key: string, msg: string) => {
      const now = Date.now();
      const expiresAt = now + NOTE_TTL_MS;

      setQtyNote((p) => ({ ...p, [key]: msg }));
      qtyNoteMetaRef.current[key] = { expiresAt, remainingMs: NOTE_TTL_MS };

      // only schedule auto-hide if not currently hovered
      if (hoveredQtyNoteKey !== key) {
        scheduleHideQtyNote(key, NOTE_TTL_MS);
      } else {
        clearQtyNoteTimer(key);
      }
    },
    [hoveredQtyNoteKey]
  );

  const poolTotalForItem = useCallback((it: CartItem, data?: AvailabilityPayload) => {
    const pid = String(it.productId);
    const vid = it.variantId == null ? null : String(it.variantId);
    const pool = data?.products?.[pid];
    if (!pool) return undefined;

    if (vid && Object.prototype.hasOwnProperty.call(pool.perVariantTotals || {}, vid)) {
      return Math.max(0, Math.floor(Number(pool.perVariantTotals[vid]) || 0));
    }

    if (!vid) {
      if (pool.hasVariantSpecific) return Math.max(0, Math.floor(Number(pool.genericTotal) || 0));
      return Math.max(0, Math.floor(Number(pool.productTotal) || 0));
    }

    return Math.max(0, Math.floor(Number(pool.genericTotal) || 0));
  }, []);

  const remainingCapForLine = useCallback(
    (target: CartItem, snapshot: CartItem[]) => {
      const data = availabilityQ.data as AvailabilityPayload | undefined;
      if (!data) return undefined;

      const totalAvail = poolTotalForItem(target, data);
      if (totalAvail == null) return undefined;

      const pk = poolKeyForItem(target, data);

      const usedByOthers = snapshot.reduce((s, it) => {
        if (sameLine(it, target)) return s;
        if (poolKeyForItem(it, data) !== pk) return s;
        return s + Math.max(0, Math.floor(Number(it.qty) || 0));
      }, 0);

      return Math.max(0, totalAvail - usedByOthers);
    },
    [availabilityQ.data, poolKeyForItem, poolTotalForItem]
  );

  const clampToMax = useCallback(
    (target: CartItem, wantQty: number, snapshot: CartItem[]) => {
      const desired = Math.max(1, Math.floor(Number(wantQty) || 1));
      const cap = remainingCapForLine(target, snapshot);

      if (cap == null || !Number.isFinite(cap)) return desired;

      if (cap <= 0) return 1;
      return Math.min(desired, cap);
    },
    [remainingCapForLine]
  );

  const persistGuestCartNow = useCallback((nextCart: CartItem[]) => {
    const lines = (nextCart || [])
      .map((it) => ({
        productId: String(it.productId),
        variantId: it.variantId == null ? null : String(it.variantId),
        kind: (it.kind === "VARIANT" || it.variantId ? "VARIANT" : "BASE") as "BASE" | "VARIANT",
        optionsKey: "",
        qty: Math.max(0, Math.floor(Number(it.qty) || 0)),
        selectedOptions: Array.isArray(it.selectedOptions) ? it.selectedOptions : [],
        titleSnapshot: it.title ?? null,
        imageSnapshot: it.image ?? null,
        unitPriceCache: Number.isFinite(Number(it.unitPrice)) ? Number(it.unitPrice) : 0,
      }))
      .filter((x) => x.qty > 0);

    writeCartLines(lines as any);

    // ✅ prevent this Cart page from reacting to its own "cart:updated" emit
    suppressNextCartEventRef.current = true;
    window.dispatchEvent(new Event("cart:updated"));
  }, []);

  const updateQty = useCallback(
    async (target: CartItem, newQtyRaw: number, sourceKeyForNote?: string) => {
      let finalClamped = 1;
      let didCorrect = false;
      let correctedTo = 1;

      setCart((prev) => {
        const desired = Math.max(1, Math.floor(Number(newQtyRaw) || 1));
        const clamped = clampToMax(target, desired, prev);

        finalClamped = clamped;
        correctedTo = clamped;
        didCorrect = clamped !== desired;

        const updated = prev.map((it) => {
          if (!sameLine(it, target)) return it;

          const unit =
            Number.isFinite(Number(it.unitPrice)) && Number(it.unitPrice) > 0
              ? Number(it.unitPrice)
              : (Number(it.totalPrice) || 0) / Math.max(1, Number(it.qty) || 1);

          const safeUnit = unit > 0 ? unit : 0;

          return {
            ...it,
            qty: clamped,
            totalPrice: safeUnit * clamped,
            unitPrice: safeUnit > 0 ? safeUnit : it.unitPrice,
          };
        });

        if (!isAuthed) persistGuestCartNow(updated);
        return updated;
      });

      if (didCorrect && sourceKeyForNote) {
        showQtyNote(sourceKeyForNote, `Qty corrected to max available (${correctedTo}).`);
      }

      if (isAuthed) {
        try {
          await serverSetQty(target, finalClamped);
        } catch {
          await loadCart().catch(() => { });
        }
      }

      return finalClamped;
    },
    [isAuthed, loadCart, persistGuestCartNow, clampToMax, showQtyNote]
  );

  const remove = useCallback(
    async (target: CartItem) => {
      setCart((prev) => {
        const next = prev.filter((it) => !sameLine(it, target));
        if (!isAuthed) persistGuestCartNow(next);
        return next;
      });

      if (isAuthed) {
        try {
          await serverSetQty(target, 0);
        } catch {
          await loadCart().catch(() => { });
        }
      }
    },
    [isAuthed, loadCart, persistGuestCartNow]
  );

  const pricingWarning = useMemo(() => {
    const q = pricingQ.data as QuotePayload | null;
    if (!q) return null;

    const unpriced = Object.values(q.lines || {}).filter((l) => l.qtyPriced < l.qtyRequested);
    if (!unpriced.length) return null;

    return "Some items could not be fully allocated across suppliers. Reduce quantities or try again.";
  }, [pricingQ.data]);

  const onQtyNoteEnter = (key: string) => {
    setHoveredQtyNoteKey(key);

    // pause timer, compute remaining
    const meta = qtyNoteMetaRef.current[key];
    if (meta) {
      meta.remainingMs = Math.max(0, meta.expiresAt - Date.now());
    }
    clearQtyNoteTimer(key);
  };

  const cancelQtyCommit = useCallback((lineKey: string) => {
    if (qtyCommitTimersRef.current[lineKey]) {
      clearTimeout(qtyCommitTimersRef.current[lineKey]);
      delete qtyCommitTimersRef.current[lineKey];
    }
    delete lastDesiredQtyRef.current[lineKey];
    lockedQtyKeysRef.current.delete(lineKey);
  }, []);

  const onQtyNoteLeave = (key: string) => {
    setHoveredQtyNoteKey((cur) => (cur === key ? null : cur));

    // resume timer with remaining time
    const meta = qtyNoteMetaRef.current[key];
    const remaining = meta?.remainingMs ?? 0;

    if (remaining > 0) {
      // give it a tiny buffer so it doesn't vanish instantly on mouseleave
      scheduleHideQtyNote(key, remaining);
    } else {
      // already expired while hovered — hide now
      setQtyNote((p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
      delete qtyNoteMetaRef.current[key];
      clearQtyNoteTimer(key);
    }
  };

  /**
   * ✅ Auto-reconcile the whole cart when availability arrives,
   * so “max added twice” gets corrected even before user edits.
   */
  const didAutoReconcileRef = useRef<string>("");
  useEffect(() => {
    const data = availabilityQ.data as AvailabilityPayload | undefined;
    if (!data) return;
    if (!visibleCart.length) return;

    const sig = `${visibleCart.map((it) => `${lineKeyFor(it)}=${it.qty}`).join(",")}|${Object.keys(data.products || {}).length}`;
    if (didAutoReconcileRef.current === sig) return;

    const remaining = new Map<string, number>();
    const corrected: Array<{ item: CartItem; newQty: number; key: string }> = [];

    for (const it of visibleCart) {
      const pk = poolKeyForItem(it, data);
      const totalAvail = poolTotalForItem(it, data);

      if (totalAvail == null || !Number.isFinite(totalAvail)) continue;

      if (!remaining.has(pk)) remaining.set(pk, Math.max(0, Math.floor(totalAvail)));
      const rem = remaining.get(pk)!;

      const want = Math.max(1, Math.floor(Number(it.qty) || 1));
      const next = Math.max(1, Math.min(want, rem));

      if (next !== want) corrected.push({ item: it, newQty: next, key: lineKeyFor(it) });

      remaining.set(pk, Math.max(0, rem - next));
    }

    if (!corrected.length) {
      didAutoReconcileRef.current = sig;
      return;
    }

    setCart((prev) => {
      const next = prev.map((it) => {
        const found = corrected.find((c) => sameLine(it, c.item));
        if (!found) return it;

        const unit =
          Number.isFinite(Number(it.unitPrice)) && Number(it.unitPrice) > 0
            ? Number(it.unitPrice)
            : (Number(it.totalPrice) || 0) / Math.max(1, Number(it.qty) || 1);

        const safeUnit = unit > 0 ? unit : 0;

        return {
          ...it,
          qty: found.newQty,
          totalPrice: safeUnit * found.newQty,
          unitPrice: safeUnit > 0 ? safeUnit : it.unitPrice,
        };
      });

      if (!isAuthed) persistGuestCartNow(next);
      return next;
    });

    for (const c of corrected) {
      showQtyNote(c.key, `Qty corrected to max available (${c.newQty}).`);
      setQtyDraft((p) => ({ ...p, [c.key]: String(c.newQty) }));
    }

    if (isAuthed) {
      (async () => {
        for (const c of corrected) {
          try {
            await serverSetQty(c.item, c.newQty);
          } catch { }
        }
        await loadCart().catch(() => { });
      })();
    }

    didAutoReconcileRef.current = sig;
  }, [availabilityQ.data, visibleCart, isAuthed, persistGuestCartNow, poolKeyForItem, poolTotalForItem, loadCart, showQtyNote]);
  const scheduleQtyCommit = useCallback(
    (lineKey: string, item: CartItem, desiredQty: number) => {
      lastDesiredQtyRef.current[lineKey] = desiredQty;

      if (qtyCommitTimersRef.current[lineKey]) {
        clearTimeout(qtyCommitTimersRef.current[lineKey]);
      }

      // ✅ lock the line so sync effect doesn't overwrite draft while timer is pending
      lockedQtyKeysRef.current.add(lineKey);

      qtyCommitTimersRef.current[lineKey] = window.setTimeout(() => {
        const finalDesired = lastDesiredQtyRef.current[lineKey] ?? desiredQty;

        Promise.resolve(updateQty(item, finalDesired, lineKey))
          .then((clamped) => {
            setQtyDraft((p) => ({ ...p, [lineKey]: String(clamped) }));
          })
          .finally(() => {
            delete qtyCommitTimersRef.current[lineKey];
            lockedQtyKeysRef.current.delete(lineKey);
          });
      }, 110);
    },
    [updateQty]
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const tap = "touch-manipulation [-webkit-tap-highlight-color:transparent]";

  if (visibleCart.length === 0) {
    return (
      <SiteLayout>
        <div className="min-h[88vh] bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft relative overflow-hidden grid place-items-center px-4">
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
              className={`${tap} mt-5 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-5 py-3 font-semibold shadow-sm hover:shadow-md focus:outline-none focus:ring-4 focus:ring-primary-200 transition`}
            >
              Go shopping
            </Link>
          </div>
        </div>
      </SiteLayout>
    );
  }

  const topBannerStatus = pricingWarning ? "warning" : "ok";
  const topBannerText = pricingWarning ?? "Prices are based on live supplier offers and your retail margin.";

  return (
    <SiteLayout>
      <div className="bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft relative overflow-hidden isolate">
        <div className="pointer-events-none -z-10 absolute -top-28 -left-24 size-96 rounded-full bg-primary-500/20 blur-3xl animate-pulse" />
        <div className="pointer-events-none -z-10 absolute -bottom-32 -right-28 size-[28rem] rounded-full bg-fuchsia-400/20 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />

        <div className="relative z-10 max-w-[980px] lg:max-w-[980px] xl:max-w-[980px] mx-auto px-3 sm:px-4 md:px-6 py-5 sm:py-8 max-[360px]:px-2 max-[360px]:py-4">
          <div className="mb-4 sm:mb-6 text-center md:text-left">
            <span className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-3 py-1 text-[11px] font-semibold shadow-sm">
              <span className="inline-block size-1.5 rounded-full bg-white/90" />
              Review &amp; edit
            </span>

            <h1 className="mt-3 text-[26px] sm:text-3xl font-extrabold tracking-tight text-ink max-[360px]:text-[22px]">
              Your cart
            </h1>

            <p className="text-sm max-[360px]:text-[12px] text-ink-soft">
              Prices shown are <span className="font-medium">retail</span> (same basis as catalogue &amp; wishlist).
            </p>

            <div className="mt-3 inline-flex items-center gap-2 rounded-full border bg-white/70 px-3 py-1 text-[12px] max-[360px]:text-[11px] text-ink-soft min-h-[26px]">
              <span className={`inline-block size-2 rounded-full ${topBannerStatus === "warning" ? "bg-rose-500" : "bg-emerald-500"}`} />
              <span>{topBannerText}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-4 sm:gap-6">
            {/* LEFT: Items */}
            <section className="space-y-3 sm:space-y-4">
              {visibleCart.map((it) => {
                const k = lineKeyFor(it);
                const ql = quoteLines[k];
                const rl = quoteRetail?.linesRetail?.[k];

                const currentQty = Math.max(1, Number(it.qty) || 1);
                const maxQty = remainingCapForLine(it, visibleCart);

                const cachedUnit =
                  asMoney(it.unitPrice, 0) > 0 ? asMoney(it.unitPrice, 0) : currentQty > 0 ? asMoney(it.totalPrice, 0) / currentQty : 0;

                const displayUnit = Math.max(0, cachedUnit);
                const displayLineTotal = round2(displayUnit * currentQty);

                const hasQuote = !!ql && (ql.lineTotal > 0 || ql.allocations.length > 0);
                const splitBadge =
                  hasQuote && ql.allocations.filter((a) => a.qty > 0).length > 1
                    ? "Split across suppliers"
                    : hasQuote && ql.allocations.length === 1
                      ? "Single supplier"
                      : "";

                const kindLabel = isBaseLine(it) ? "Base" : it.variantId ? "Variant" : it.selectedOptions?.length ? "Configured" : "Item";
                const isExpanded = !!expanded[k];

                const draft = qtyDraft[k];
                const inputValue = draft ?? String(currentQty); // keep as-is BUT we will ensure draft always exists

                const commitDraft = () => {
                  const raw = qtyDraft[k];
                  const parsed = raw === "" || raw == null ? 1 : Math.floor(Number(raw));
                  const desired = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

                  // ✅ do NOT clamp here — let updateQty() clamp once
                  scheduleQtyCommit(k, it, desired);
                };

                const effectiveQtyForButtons = () => {
                  const raw = qtyDraft[k];
                  if (raw == null || raw === "") return currentQty;
                  const n = Math.floor(Number(raw));
                  return Number.isFinite(n) && n > 0 ? n : currentQty;
                };

                const clampForButtons = (desired: number) => {
                  // maxQty is computed in this render for this line
                  if (typeof maxQty === "number" && Number.isFinite(maxQty) && maxQty > 0) {
                    const cap = Math.floor(maxQty);
                    if (desired > cap) {
                      showQtyNote(k, `Qty corrected to max available (${cap}).`);
                      return cap;
                    }
                  }
                  return desired;
                };

                const inc = () => {
                  cancelQtyCommit(k);

                  const base = effectiveQtyForButtons();
                  let desired = base + 1;

                  desired = clampForButtons(desired);

                  // ✅ don't mark as focused from button clicks
                  // focusedQtyKeyRef.current = k;

                  setQtyDraft((p) => ({ ...p, [k]: String(desired) }));
                  scheduleQtyCommit(k, it, desired);
                };

                const dec = () => {
                  cancelQtyCommit(k);

                  const base = effectiveQtyForButtons();
                  let desired = Math.max(1, base - 1);

                  // dec can't exceed max, but keep symmetrical / safe
                  desired = clampForButtons(desired);

                  // ✅ don't mark as focused from button clicks
                  // focusedQtyKeyRef.current = k;

                  setQtyDraft((p) => ({ ...p, [k]: String(desired) }));
                  scheduleQtyCommit(k, it, desired);
                };

                const unitText = displayUnit > 0 ? ngn.format(displayUnit) : "—";

                const displayOptions = normalizeSelectedOptions(it.selectedOptions);

                let optionLabel = displayOptions
                  .map((o) => {
                    const attr =
                      o.attribute && !isCodeLike(o.attribute)
                        ? o.attribute
                        : o.attributeId && !isCodeLike(o.attributeId)
                          ? o.attributeId
                          : "";

                    const val =
                      o.value && !isCodeLike(o.value)
                        ? o.value
                        : o.valueId && !isCodeLike(o.valueId)
                          ? o.valueId
                          : "";

                    if (!attr && !val) return null;
                    if (!attr) return val;
                    if (!val) return attr;
                    return `${attr}: ${val}`;
                  })
                  .filter(Boolean)
                  .join(" • ");

                if (!optionLabel && !isBaseLine(it)) optionLabel = "Variant selected";
                else if (!optionLabel && displayOptions.length) optionLabel = "Options saved";

                return (
                  <article
                    key={k}
                    className="group rounded-2xl border border-white/60 bg-white/75 backdrop-blur shadow-[0_6px_30px_rgba(0,0,0,0.06)]
                               p-3 sm:p-5 max-[360px]:p-3 overflow-hidden relative z-10"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
                      <div className="shrink-0 w-16 h-16 sm:w-20 sm:h-20 max-[360px]:w-14 max-[360px]:h-14 rounded-xl border overflow-hidden bg-white self-start relative">
                        <div className="absolute inset-0 grid place-items-center text-[11px] text-ink-soft">No image</div>

                        {resolveImageUrl(it.image) && (
                          <img
                            src={resolveImageUrl(it.image)}
                            alt=""
                            aria-hidden="true"
                            className="relative w-full h-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.opacity = "0";
                            }}
                          />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-semibold text-ink text-[14px] sm:text-base leading-snug truncate" title={it.title}>
                              {it.title || "Item"}
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
                              <span className="text-[10px] px-2 py-0.5 rounded-full border bg-white text-ink-soft">{splitBadge}</span>
                            )}
                          </div>

                          {!!optionLabel && (
                            <div className="mt-2 text-[12px] max-[360px]:text-[11px] sm:text-xs text-ink-soft leading-snug break-words">
                              {optionLabel}
                            </div>
                          )}

                          <div className="mt-2 grid grid-cols-1 gap-1 text-[12px] max-[360px]:text-[11px] sm:text-xs text-ink-soft">
                            <div>
                              Unit: <span className="font-medium text-ink">{unitText}</span>
                            </div>
                          </div>

                          {rl && (rl.allocationsRetail?.length ?? 0) > 0 && (
                            <button
                              className={`${tap} mt-2 text-[11px] text-primary-700 hover:underline`}
                              onClick={() => setExpanded((p) => ({ ...p, [k]: !p[k] }))}
                              type="button"
                            >
                              {isExpanded ? "Hide supplier breakdown" : "Show supplier breakdown"}
                            </button>
                          )}
                        </div>
                        {qtyNote[k] ? (
                          <div
                            className="mt-2 text-[12px] font-semibold text-rose-700"
                            onMouseEnter={() => onQtyNoteEnter(k)}
                            onMouseLeave={() => onQtyNoteLeave(k)}
                            title="Hover to keep this message visible"
                          >
                            {qtyNote[k]}
                          </div>
                        ) : null}

                        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="flex items-center justify-between sm:justify-start gap-3">
                            <div className="flex items-center rounded-xl border border-border bg-white overflow-hidden shadow-sm">
                              <button
                                type="button"
                                aria-label="Decrease quantity"
                                className={`${tap} px-3 py-2 max-[360px]:px-2 max-[360px]:py-1.5 hover:bg-black/5 transition`}
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
                                onFocus={() => {
                                  focusedQtyKeyRef.current = k;
                                  cancelQtyCommit(k); // ✅ stop any pending debounced commit
                                }}
                                onChange={(e) => {
                                  cancelQtyCommit(k); // ✅ if user is typing/backspacing, don't let old timer win

                                  const v = e.target.value;

                                  if (v === "") {
                                    setQtyDraft((p) => ({ ...p, [k]: "" }));
                                    return;
                                  }
                                  if (!/^\d+$/.test(v)) return;

                                  setQtyDraft((p) => ({ ...p, [k]: v }));
                                }}
                                onBlur={() => {
                                  focusedQtyKeyRef.current = null;
                                  commitDraft();
                                }} onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                                  if (e.key === "Escape") {
                                    cancelQtyCommit(k);
                                    setQtyDraft((p) => ({ ...p, [k]: String(currentQty) }));
                                    (e.currentTarget as HTMLInputElement).blur();
                                  }
                                }}
                                className="w-[64px] text-center outline-none px-2 py-2 max-[360px]:py-1.5 bg-white tabular-nums font-medium leading-[1] text-[14px]"
                                aria-label="Quantity"
                              />

                              <button
                                type="button"
                                aria-label="Increase quantity"
                                className={`${tap} px-3 py-2 max-[360px]:px-2 max-[360px]:py-1.5 hover:bg-black/5 transition`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={inc}
                              >
                                +
                              </button>
                            </div>

                            <div className="text-xs max-[360px]:text-[11px] text-ink-soft leading-tight">
                              <div>Qty</div>
                              <div className="h-[16px] text-[10px] tabular-nums">
                                {typeof maxQty === "number" && Number.isFinite(maxQty) && (
                                  <span>
                                    Max: <span className="font-medium text-ink">{Math.max(0, Math.floor(maxQty))}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="sm:ml-auto rounded-xl border bg-white/70 px-3 py-2 text-right min-w-[140px] max-[360px]:min-w-[0]">
                            <div className="text-[11px] text-ink-soft">Line total</div>
                            <div className="text-[18px] sm:text-lg font-semibold tracking-tight break-words">
                              {ngn.format(displayLineTotal)}
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
            <aside className="lg:sticky lg:top-6 cart-summary-stable">
              <div className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur p-4 sm:p-5 max-[360px]:p-3 shadow-[0_6px_30px_rgba(0,0,0,0.06)] overflow-hidden">
                <h2 className="text-lg max-[360px]:text-base font-semibold text-ink">Order summary</h2>

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
                    <span
                      style={{ opacity: pricingQ.isFetching ? 0.5 : 1 }}
                      className="text-[26px] sm:text-2xl max-[360px]:text-[22px] font-extrabold tracking-tight text-ink break-words"
                    >
                      {ngn.format(total)}
                    </span>
                  </div>

                  {pricingWarning && <p className="mt-2 text-[12px] text-rose-600">{pricingWarning}</p>}

                  <Link
                    to={!pricingWarning ? "/checkout" : "#"}
                    onClick={(e) => {
                      if (!!pricingWarning) e.preventDefault();
                    }}
                    className={`${tap} mt-4 w-full inline-flex items-center justify-center rounded-xl px-4 py-3 max-[360px]:py-2.5 font-semibold shadow-sm transition ${!pricingWarning
                      ? "bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white hover:shadow-md focus:outline-none focus:ring-4 focus:ring-primary-200"
                      : "bg-zinc-200 text-zinc-500 cursor-not-allowed"
                      }`}
                    aria-disabled={!!pricingWarning}
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

                  <p className="mt-3 text-[11px] text-ink-soft">Totals above use the same retail basis as the catalogue.</p>
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