// src/pages/Cart.tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import SiteLayout from '../layouts/SiteLayout';

/* ---------------- Types ---------------- */

type SelectedOption = {
  attributeId: string;
  attribute: string;
  valueId?: string;
  value: string;
};

type CartItem = {
  kind?: "BASE" | "VARIANT"; // ✅ NEW
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
  genericTotal: number; // base-product pool (supplierProductOffers)
  productTotal: number; // genericTotal + sum(perVariantTotals) when both exist
  perVariantTotals: Record<string, number>; // vid -> qty
};

type AvailabilityPayload = {
  lines: Record<string, Availability>; // per (productId, variantId)
  products: Record<string, ProductPools>; // aggregated product-level pools
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

/* ---------------- Helpers: numbers ---------------- */

const asInt = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
};

const asMoney = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/* ---------------- Helpers: storage + shape ---------------- */

function toArray<T = any>(x: any): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function normalizeSelectedOptions(raw: any): SelectedOption[] {
  const arr = toArray<SelectedOption>(raw)
    .map((o: any) => ({
      attributeId: String(o.attributeId ?? ''),
      attribute: String(o.attribute ?? ''),
      valueId: o.valueId ? String(o.valueId) : undefined,
      value: String(o.value ?? ''),
    }))
    .filter((o) => o.attributeId || o.attribute || o.valueId || o.value);

  // stable order so the same combo always hashes the same
  arr.sort((a, b) => {
    const aKey = `${a.attributeId}:${a.valueId ?? a.value}`;
    const bKey = `${b.attributeId}:${b.valueId ?? b.value}`;
    return aKey.localeCompare(bKey);
  });

  return arr;
}

// Used to separate cart lines when variantId is null but options exist (or you want stronger separation)
function optionsKey(sel?: SelectedOption[]) {
  const s = (sel ?? []).filter(Boolean);
  if (!s.length) return '';
  return s
    .map((o) => `${o.attributeId}=${o.valueId ?? o.value}`)
    .join('|');
}

/**
 * ✅ New: separate cart lines by "kind"
 * - base product: productId::base
 * - variant by id: productId::v:<variantId>
 * - options-only (rare): productId::o:<optionsKey>
 */
function lineKeyFor(item: Pick<CartItem, "productId" | "variantId" | "selectedOptions" | "kind">) {
  const pid = String(item.productId);
  const vid = item.variantId == null ? null : String(item.variantId);
  const sel = normalizeSelectedOptions(item.selectedOptions);

  // ✅ force separation by kind
  const kind: "BASE" | "VARIANT" =
    item.kind === "BASE" || item.kind === "VARIANT"
      ? item.kind
      : (item.variantId ? "VARIANT" : "BASE");


  if (kind === "VARIANT") {
    if (vid) return `${pid}::v:${vid}`;
    // fallback (rare)
    return sel.length ? `${pid}::o:${optionsKey(sel)}` : `${pid}::v:unknown`;
  }

  // BASE
  return `${pid}::base`;
}


// Availability key stays per (productId, variantId) because backend returns that shape
const availKeyFor = (productId: string, variantId?: string | null) =>
  `${productId}::${variantId ?? 'null'}`;

function normalizeCartShape(parsed: any[]): CartItem[] {
  return parsed.map((it: any) => {
    const qtyNum = Math.max(1, Number(it.qty) || 1);

    const variantId = it.variantId == null ? null : String(it.variantId);
    const selectedOptions = normalizeSelectedOptions(it.selectedOptions);

    // ✅ FIX: only trust it.kind if it's explicitly valid, otherwise infer from variantId/options
 const rawKind = it.kind === "BASE" || it.kind === "VARIANT" ? it.kind : undefined;
const kind = rawKind ?? (it.variantId ? "VARIANT" : "BASE");

    const hasTotal = Number.isFinite(Number(it.totalPrice));
    const hasPrice = Number.isFinite(Number(it.price));
    const hasUnit = Number.isFinite(Number(it.unitPrice));

    const unitFromTotal = hasTotal ? Number(it.totalPrice) / qtyNum : undefined;
    const unitPrice = hasUnit
      ? Number(it.unitPrice)
      : hasPrice
        ? Number(it.price)
        : unitFromTotal ?? 0;

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
      image: typeof it.image === "string" ? it.image : undefined,
    } as CartItem;
  });
}


function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem('cart');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeCartShape(parsed);
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]) {
  localStorage.setItem('cart', JSON.stringify(items));
}

const sameLine = (a: CartItem, b: Pick<CartItem, 'productId' | 'variantId' | 'selectedOptions'>) =>
  lineKeyFor(a) === lineKeyFor(b);

const isBaseLine = (it: CartItem) => {
  if (it.variantId) return false;             // ✅ variantId always means variant selection
  if (it.kind === "VARIANT") return false;
  return true;
};


/* ---------------- Availability (batched) ---------------- */

/**
 * Availability uses sum of:
 *  - SupplierProductOffer.availableQty (generic/base pool)
 *  - SupplierVariantOffer.availableQty (variant pool)
 *
 * Rules you want (buy base + variants separately):
 *  - If variant-specific exists, variants use their pool AND base uses genericTotal (if backend returns it).
 *  - If only generic exists, all lines share genericTotal.
 */
async function fetchAvailabilityForCart(items: CartItem[]): Promise<AvailabilityPayload> {
  if (!items.length) return { lines: {}, products: {} };

  // For availability request, we only need unique (productId, variantId) pairs
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

  const itemsParam = uniqPairs.map((p) => `${p.productId}:${p.variantId ?? ''}`).join(',');

  // NOTE:
  // If you kept the earlier availability.ts that returns 0 for base when variants exist,
  // add support on the backend for includeBase=1 and remove that "0" rule.
  // We already send includeBase=1 here.
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

        const byProduct: Record<string, { generic: number; perVariant: Record<string, number> }> =
          {};

        for (const r of arr as Row[]) {
          const pid = String(r.productId);
          const vid = r.variantId == null ? null : String(r.variantId);
          const avail = Math.max(0, Number(r.totalAvailable) || 0);
          const k = availKeyFor(pid, vid);

          lines[k] = {
            totalAvailable: avail,
            cheapestSupplierUnit: Number.isFinite(Number(r.cheapestSupplierUnit))
              ? Number(r.cheapestSupplierUnit)
              : null,
          };

          if (!byProduct[pid]) byProduct[pid] = { generic: 0, perVariant: {} };

          if (vid == null) {
            byProduct[pid].generic += avail;
          } else {
            byProduct[pid].perVariant[vid] = (byProduct[pid].perVariant[vid] || 0) + avail;
          }
        }

        const products: Record<string, ProductPools> = {};
        for (const [pid, agg] of Object.entries(byProduct)) {
          const hasVariantSpecific = Object.keys(agg.perVariant).length > 0;
          const variantSum = Object.values(agg.perVariant).reduce((s, n) => s + n, 0);
          const productTotal = agg.generic + variantSum; // ✅ base + variants can co-exist

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

  // Fallback: unknown (keep cart, no pruning)
  return { lines: {}, products: {} };
}

/* ---------------- Price hydration (fix 0-price lines) ---------------- */

async function hydrateLinePrice(line: CartItem): Promise<CartItem> {
  const currentUnit = asMoney(line.unitPrice, asMoney((line as any).price, 0));
  if (currentUnit > 0) return line;

  try {
    const { data } = await api.get(`/api/products/${line.productId}`, {
      params: { include: 'variants,offers,supplierOffers' },
    });

    const p = data?.data ?? data ?? {};

    let unit = 0;

    // 1) Try product base price / variant price
    const base = asMoney(p.price, 0);
    unit = base;

    if (line.variantId && Array.isArray(p.variants)) {
      const v = p.variants.find((vv: any) => String(vv.id) === String(line.variantId));
      if (v && asMoney(v.price, NaN) > 0) {
        unit = asMoney(v.price, unit);
      }
    }

    // 2) If still 0, fall back to cheapest active supplier offer
    if (!(unit > 0)) {
      const offersSrc = [
        ...(Array.isArray(p.supplierOffers) ? p.supplierOffers : []),
        ...(Array.isArray(p.offers) ? p.offers : []),
      ];

      const fromVariants =
        Array.isArray(p.variants) &&
        p.variants.flatMap((v: any) =>
          Array.isArray(v.offers)
            ? v.offers.map((o: any) => ({
              ...o,
              variantId: v.id,
            }))
            : []
        );

      const allOffers = [...offersSrc, ...(Array.isArray(fromVariants) ? fromVariants : [])];

      const usable = allOffers
        .map((o: any) => ({
          price: asMoney(o.price, NaN),
          availableQty: asInt(o.availableQty ?? o.available ?? o.qty ?? 0, 0),
          isActive: o.isActive !== false,
          variantId: o.variantId ?? null,
        }))
        .filter((o) => o.isActive && o.availableQty > 0 && o.price > 0);

      const scoped = line.variantId
        ? usable.filter((o) => String(o.variantId) === String(line.variantId))
        : usable;

      if (scoped.length) {
        scoped.sort((a, b) => a.price - b.price);
        unit = scoped[0].price;
      }
    }

    const qty = Math.max(1, asInt(line.qty, 1));
    if (unit > 0) {
      return {
        ...line,
        unitPrice: unit,
        totalPrice: unit * qty,
      };
    }
  } catch {
    // ignore; keep original
  }

  return line;
}

/* ---------------- Component ---------------- */

export default function Cart() {
  const [cart, setCart] = useState<CartItem[]>(() => loadCart());

  // Hydrate zero-price lines once on mount
  useEffect(() => {
    (async () => {
      if (!cart.some((c) => asMoney(c.unitPrice, 0) <= 0)) return;
      const updated = await Promise.all(cart.map(hydrateLinePrice));
      setCart(updated);
      saveCart(updated);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep localStorage synced
  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  const availabilityQ = useQuery({
    queryKey: [
      'catalog',
      'availability:v3',
      cart
        .map((i) => availKeyFor(i.productId, i.variantId ?? null))
        .sort()
        .join(','),
    ],
    enabled: cart.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
    queryFn: () => fetchAvailabilityForCart(cart),
  });

  // Shared generic pool math: sum other lines of same product that ALSO use generic pool
  const sumOtherLinesQty = (
    productId: string,
    except: Pick<CartItem, 'productId' | 'variantId' | 'selectedOptions'>
  ) => {
    return cart.reduce((s, it) => {
      if (it.productId !== productId) return s;
      if (sameLine(it, except)) return s;
      return s + Math.max(0, Number(it.qty) || 0);
    }, 0);
  };

  // Prune only when we are SURE totalAvailable === 0
  useEffect(() => {
    const data = availabilityQ.data as AvailabilityPayload | undefined;
    if (!data || cart.length === 0) return;

    const next = cart.filter((it) => {
      const line = data.lines[availKeyFor(it.productId, it.variantId ?? null)];
      if (!line) return true; // unknown → keep

      // ✅ Do NOT auto-remove items while availability is loading/unknown
      if (availabilityQ.isLoading) return true;

      return !(typeof line.totalAvailable === 'number' && line.totalAvailable === 0);
    });

    if (next.length !== cart.length) setCart(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityQ.data, availabilityQ.isLoading]);

  const visibleCart = useMemo(() => {
    const data = availabilityQ.data as AvailabilityPayload | undefined;
    if (!data) return cart;

    return cart.filter((it) => {
      const line = data.lines[availKeyFor(it.productId, it.variantId ?? null)];
      return !(line && typeof line.totalAvailable === 'number' && line.totalAvailable === 0);
    });
  }, [cart, availabilityQ.data]);

  const total = useMemo(
    () => visibleCart.reduce((s, it) => s + (Number(it.totalPrice) || 0), 0),
    [visibleCart]
  );

  const computedCapForLine = (item: CartItem): number | undefined => {
    const data = availabilityQ.data as AvailabilityPayload | undefined;
    if (!data) return undefined;

    const pools = data.products[item.productId];
    const line = data.lines[availKeyFor(item.productId, item.variantId ?? null)];

    if (!line || typeof line.totalAvailable !== 'number') return undefined;

    // ✅ If product has variant-specific, each line uses its own availability
    if (pools?.hasVariantSpecific) {
      return Math.max(0, line.totalAvailable);
    }

    // ✅ Generic-only pool: shared pool, cap = pool - other lines qty
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

    // if we can't read availability safely, don't clamp
    if (!line || typeof line.totalAvailable !== 'number') return desired;

    // variant-specific: cap per line
    if (pools?.hasVariantSpecific) {
      const cap = Math.max(1, line.totalAvailable);
      return Math.min(desired, cap);
    }

    // generic-only: fixed cap based on pool - other lines
    const pool = Math.max(0, pools?.genericTotal ?? line.totalAvailable);
    const otherQty = sumOtherLinesQty(item.productId, item);
    const capForThisLine = Math.max(0, pool - otherQty);
    const cap = Math.max(1, capForThisLine);
    return Math.min(desired, cap);
  };

  const updateQty = (target: CartItem, newQtyRaw: number) => {
    setCart((prev) =>
      prev.map((it) => {
        if (!sameLine(it, target)) return it;

        const clamped = clampToMax(it, newQtyRaw);

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
  };

  const inc = (target: CartItem) => updateQty(target, (target.qty || 1) + 1);
  const dec = (target: CartItem) => updateQty(target, Math.max(1, (target.qty || 1) - 1));

  const remove = (target: CartItem) => {
    setCart((prev) => prev.filter((it) => !sameLine(it, target)));
  };

  const cartBlockingReason = useMemo(() => {
    const data = availabilityQ.data as AvailabilityPayload | undefined;
    if (!data) return null;

    for (const productId of new Set(visibleCart.map((i) => i.productId))) {
      const pools = data.products[productId];

      // If we don't have pools, only check per-line caps
      if (!pools) {
        const outOfCap = visibleCart
          .filter((i) => i.productId === productId)
          .some((i) => {
            const ln = data.lines[availKeyFor(i.productId, i.variantId ?? null)];
            return ln && typeof ln.totalAvailable === 'number' && i.qty > ln.totalAvailable;
          });
        if (outOfCap) return 'Reduce quantities: some items exceed available stock.';
        continue;
      }

      if (pools.hasVariantSpecific) {
        // per line cap
        for (const it of visibleCart.filter((i) => i.productId === productId)) {
          const ln = data.lines[availKeyFor(it.productId, it.variantId ?? null)];
          const cap =
            ln && typeof ln.totalAvailable === 'number'
              ? Math.max(0, ln.totalAvailable)
              : 0;
          if (it.qty > cap) return 'Reduce quantities: some items exceed available stock.';
        }
      } else {
        // shared pool across all lines of the product
        const sumQty = visibleCart
          .filter((i) => i.productId === productId)
          .reduce((s, i) => s + Math.max(0, Number(i.qty) || 0), 0);
        if (sumQty > pools.genericTotal) {
          return 'Reduce quantities: some items exceed available stock.';
        }
      }
    }

    return null;
  }, [visibleCart, availabilityQ.data]);

  const canCheckout = cartBlockingReason == null;

  if (visibleCart.length === 0) {
    return (
      <SiteLayout>
        <div className="min-h-[88vh] bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft relative overflow-hidden grid place-items-center px-4">
          <div className="pointer-events-none absolute -top-24 -left-24 size-80 rounded-full bg-primary-500/20 blur-3xl animate-pulse" />
          <div className="pointer-events-none absolute -bottom-28 -right-24 size-96 rounded-full bg-fuchsia-400/20 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />

          <div className="max-w-md w-full text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-3 py-1 text-[11px] font-semibold shadow-sm">
              <span className="inline-block size-1.5 rounded-full bg-white/90" />
              Your cart is empty
            </div>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-ink">
              Let’s find something you’ll love
            </h1>
            <p className="mt-1 text-ink-soft">
              Browse our catalogue and add items to your cart. They’ll show up here for checkout.
            </p>
            <Link
              to="/"
              className="mt-5 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-5 py-3 font-semibold shadow-sm hover:shadow-md active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-primary-200 transition"
            >
              Go shopping
            </Link>
          </div>
        </div>
      </SiteLayout>
    );
  }

  return (
    <div className="bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft relative overflow-hidden">
      {/* decorative blobs */}
      <div className="pointer-events-none absolute -top-28 -left-24 size-96 rounded-full bg-primary-500/20 blur-3xl animate-pulse" />
      <div className="pointer-events-none absolute -bottom-32 -right-28 size-[28rem] rounded-full bg-fuchsia-400/20 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />

      <div className="relative max-w-6xl mx-auto px-4 md:px-6 py-8">
        <div className="mb-6 text-center md:text-left">
          <span className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-3 py-1 text-[11px] font-semibold shadow-sm">
            <span className="inline-block size-1.5 rounded-full bg-white/90" />
            Review & edit
          </span>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-ink">Your cart</h1>
          <p className="text-sm text-ink-soft">
            Base items and variant selections are separated — you can buy each independently.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-6">
          {/* LEFT: Items */}
          <section className="space-y-4">
            {visibleCart.map((it) => {
              const currentQty = Math.max(1, Number(it.qty) || 1);
              const unit =
                asMoney(it.unitPrice, 0) > 0
                  ? asMoney(it.unitPrice, 0)
                  : currentQty > 0
                    ? asMoney(it.totalPrice, 0) / currentQty
                    : asMoney(it.totalPrice, 0);

              const data = availabilityQ.data as AvailabilityPayload | undefined;
              const pools = data?.products[it.productId];
              const line = data?.lines[availKeyFor(it.productId, it.variantId ?? null)];

              const cap = computedCapForLine(it);
              const capText =
                typeof cap === 'number'
                  ? cap > 0
                    ? it.qty > cap
                      ? `Only ${cap} available. Please reduce.`
                      : `Max you can buy now: ${cap}`
                    : 'Out of stock'
                  : '';

              const kindLabel = isBaseLine(it)
                ? 'Base product'
                : it.variantId
                  ? 'Variant selection'
                  : it.selectedOptions?.length
                    ? 'Configured selection'
                    : 'Item';

              // helper text
              let helperText = '';
              if (availabilityQ.isLoading) {
                helperText = 'Checking availability…';
              } else if (line && typeof line.totalAvailable === 'number') {
                helperText = capText;
              }

              return (
                <article
                  key={lineKeyFor(it)}
                  className="group rounded-2xl border border-white/60 bg-white/70 backdrop-blur shadow-[0_6px_30px_rgba(0,0,0,0.06)] p-4 md:p-5 transition hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]"
                >
                  <div className="flex items-start gap-4">
                    {/* Thumbnail */}
                    <div className="shrink-0 w-20 h-20 rounded-xl border overflow-hidden bg-white">
                      {it.image ? (
                        <img
                          src={it.image}
                          alt={it.title}
                          className="w-full h-full object-cover"
                          onError={(e) =>
                            (((e.currentTarget as HTMLImageElement).style.display = 'none'), void 0)
                          }
                        />
                      ) : (
                        <div className="w-full h-full grid place-items-center text-[11px] text-ink-soft">
                          No image
                        </div>
                      )}
                    </div>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="inline-flex items-center gap-2">
                            <h3 className="font-semibold text-ink truncate" title={it.title}>
                              {it.title}
                            </h3>
                            <span className="text-[10px] px-2 py-0.5 rounded-full border bg-white text-ink-soft">
                              {kindLabel}
                            </span>
                          </div>

                          {!!it.selectedOptions?.length && (
                            <div className="mt-1 text-xs text-ink-soft">
                              {it.selectedOptions.map((o) => `${o.attribute}: ${o.value}`).join(' • ')}
                            </div>
                          )}

                          <p className="mt-1 text-xs text-ink-soft">
                            Unit price:{' '}
                            {unit > 0 ? ngn.format(unit) : 'Pending — will be resolved at checkout'}
                          </p>

                          {!!helperText && <p className="mt-1 text-[11px] text-ink-soft">{helperText}</p>}

                          {/* Small extra hint when product has both pools */}
                          {pools?.hasVariantSpecific && isBaseLine(it) && (
                            <p className="mt-1 text-[11px] text-ink-soft">
                              This is the <span className="font-medium">base</span> item pool. Variant selections use their own pools.
                            </p>
                          )}
                        </div>

                        <button
                          className="text-xs md:text-sm text-danger hover:underline rounded px-2 py-1 hover:bg-danger/5 transition"
                          onClick={() => remove(it)}
                          aria-label={`Remove ${it.title}`}
                          title="Remove item"
                        >
                          Remove
                        </button>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        {/* Quantity controls */}
                        <div className="flex items-center gap-2">
                          <div className="flex items-center rounded-xl border border-border bg-white overflow-hidden shadow-sm">
                            <button
                              aria-label="Decrease quantity"
                              className="px-3 py-2 hover:bg-black/5 active:scale-[0.98] transition"
                              onClick={() => dec(it)}
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={it.qty}
                              onChange={(e) => updateQty(it, Number(e.target.value))}
                              onBlur={(e) => updateQty(it, Number(e.target.value))}
                              className="w-16 text-center outline-none px-2 py-2 bg-white"
                            />
                            <button
                              aria-label="Increase quantity"
                              className="px-3 py-2 hover:bg-black/5 active:scale-[0.98] transition"
                              onClick={() => inc(it)}
                              title="Increase quantity"
                            >
                              +
                            </button>
                          </div>
                          <span className="text-xs md:text-sm text-ink-soft">Qty</span>
                        </div>

                        {/* Line total */}
                        <div className="text-right">
                          <div className="text-xs md:text-sm text-ink-soft">Line total</div>
                          <div className="text-lg md:text-xl font-semibold tracking-tight">
                            {ngn.format(Number(it.totalPrice) || 0)}
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
          <aside className="lg:sticky lg:top-6 h-max">
            <div className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur p-5 shadow-[0_6px_30px_rgba(0,0,0,0.06)]">
              <h2 className="text-lg font-semibold text-ink">Order summary</h2>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft">Items</span>
                  <span className="font-medium">{visibleCart.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft">Subtotal</span>
                  <span className="font-medium">{ngn.format(total)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft">Shipping</span>
                  <span className="font-medium">Calculated at checkout</span>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between text-ink">
                <span className="font-semibold">Total</span>
                <span className="text-2xl font-extrabold tracking-tight">{ngn.format(total)}</span>
              </div>

              {!canCheckout && <p className="mt-2 text-[12px] text-rose-600">{cartBlockingReason}</p>}

              <Link
                to={canCheckout ? '/checkout' : '#'}
                onClick={(e) => {
                  if (!canCheckout) e.preventDefault();
                }}
                className={`mt-5 w-full inline-flex items-center justify-center rounded-xl px-4 py-3 font-semibold shadow-sm transition
                  ${canCheckout
                    ? 'bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white hover:shadow-md active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-primary-200'
                    : 'bg-zinc-200 text-zinc-500 cursor-not-allowed'
                  }`}
                aria-disabled={!canCheckout}
              >
                Proceed to checkout
              </Link>

              <Link
                to="/"
                className="mt-3 w-full inline-flex items-center justify-center rounded-xl border border-border bg-white px-4 py-3 text-ink hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-50 transition"
              >
                Continue shopping
              </Link>
            </div>

            <p className="mt-3 text-[11px] text-ink-soft text-center">
              Taxes & shipping are shown at checkout. You can update addresses there.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
