// src/pages/Cart.tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client'; // <-- your axios instance (same you use elsewhere)

type SelectedOption = {
  attributeId: string;
  attribute: string;
  valueId?: string;
  value: string;
};

type CartItem = {
  productId: string;
  variantId?: string | null;
  title: string;
  qty: number;
  unitPrice: number;
  totalPrice: number;
  selectedOptions?: SelectedOption[];
  image?: string;
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

/* ---------------- Persistence helpers ---------------- */

function toArray<T = any>(x: any): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function normalizeCartShape(parsed: any[]): CartItem[] {
  return parsed.map((it: any) => {
    const qtyNum = Math.max(1, Number(it.qty) || 1);

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

    const rawSel = toArray<SelectedOption>(it.selectedOptions);
    const selectedOptions: SelectedOption[] = rawSel
      .map((o: any) => ({
        attributeId: String(o.attributeId ?? ''),
        attribute: String(o.attribute ?? ''),
        valueId: o.valueId ? String(o.valueId) : undefined,
        value: String(o.value ?? ''),
      }))
      .filter((o) => o.attribute || o.value);

    return {
      productId: String(it.productId),
      variantId: it.variantId == null ? null : String(it.variantId),
      title: String(it.title ?? ''),
      qty: qtyNum,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      totalPrice: Number.isFinite(totalPrice) ? totalPrice : 0,
      selectedOptions,
      image: typeof it.image === 'string' ? it.image : undefined,
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

/* ---------------- Utilities ---------------- */

const keyFor = (productId: string, variantId?: string | null) =>
  `${productId}::${variantId ?? 'null'}`;

const sameLine = (a: CartItem, productId: string, variantId?: string | null) =>
  a.productId === productId && (a.variantId ?? null) === (variantId ?? null);

/** Availability result per (productId, variantId) */
type Availability = {
  totalAvailable: number;          // sum of SupplierOffer.availableQty for that product/variant
  cheapestSupplierUnit?: number | null; // optional, cheapest supplier unit cost (for UI hints)
};

/* ---------------- Availability fetcher (batched) ---------------- */

async function fetchAvailabilityForCart(items: CartItem[]): Promise<Record<string, Availability>> {
  if (!items.length) return {};
  const pairs = items.map(i => ({ productId: i.productId, variantId: i.variantId ?? null }));
  const uniqPairs: { productId: string; variantId: string | null }[] = [];
  const seen = new Set<string>();
  for (const p of pairs) {
    const k = keyFor(p.productId, p.variantId);
    if (!seen.has(k)) { seen.add(k); uniqPairs.push(p); }
  }

  // Build a simple signature for queryKey and for query params
  const itemsParam = uniqPairs.map(p => `${p.productId}:${p.variantId ?? ''}`).join(',');

  // 1) Try a bulk availability endpoint (recommended to add server-side)
  const attempts = [
    `/api/catalog/availability?items=${encodeURIComponent(itemsParam)}`,
    `/api/products/availability?items=${encodeURIComponent(itemsParam)}`,
    `/api/supplier-offers/availability?items=${encodeURIComponent(itemsParam)}`,
  ];

  for (const url of attempts) {
    try {
      const { data } = await api.get(url);
      // Expect shape: { data: Array<{ productId, variantId?, totalAvailable, cheapestSupplierUnit? }> } OR plain array
      const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
      if (Array.isArray(arr)) {
        const out: Record<string, Availability> = {};
        for (const row of arr) {
          const k = keyFor(String(row.productId), row.variantId == null ? null : String(row.variantId));
          out[k] = {
            totalAvailable: Math.max(0, Number(row.totalAvailable) || 0),
            cheapestSupplierUnit: Number.isFinite(Number(row.cheapestSupplierUnit))
              ? Number(row.cheapestSupplierUnit)
              : null,
          };
        }
        return out;
      }
    } catch { /* try fallback */ }
  }

  // 2) Fallback: fetch supplier offers per product and sum on the client.
  const out: Record<string, Availability> = {};
  for (const pair of uniqPairs) {
    const perAttempts = [
      `/api/products/${pair.productId}/supplier-offers`,
      `/api/admin/products/${pair.productId}/supplier-offers`,
      `/api/admin/products/${pair.productId}/offers`,
    ];
    let list: any[] | null = null;
    for (const url of perAttempts) {
      try {
        const { data } = await api.get(url);
        const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
        if (Array.isArray(arr)) { list = arr; break; }
      } catch { /* next */ }
    }
    if (!list) {
      // We couldn’t fetch any offers for this product — leave it unknown (no cap).
      continue;
    }

    const filtered = list.filter((o: any) => {
      const offerVid = o.variantId ?? null;
      const wantVid = pair.variantId ?? null;
      return offerVid === wantVid || (wantVid !== null && offerVid === null);
    });

    // If we fetched OK but there are truly no offers, then the cap is 0.
    let totalAvailable = 0;
    let cheapest: number | null = null;

    for (const o of filtered) {
      const qty = Math.max(0, Number(o.availableQty ?? o.available ?? 0) || 0);
      totalAvailable += qty;
      const c = Number(o.price);
      if (Number.isFinite(c)) cheapest = cheapest == null ? c : Math.min(cheapest, c);
    }

    out[keyFor(pair.productId, pair.variantId)] = {
      totalAvailable,
      cheapestSupplierUnit: cheapest,
    };
  }

  return out;
}

/* ---------------- Component ---------------- */

export default function Cart() {
  const [cart, setCart] = useState<CartItem[]>(() => loadCart());

  // Keep localStorage synced
  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  // Batch availability for current cart lines
  const availabilityQ = useQuery({
    queryKey: ['catalog', 'availability', cart.map(i => keyFor(i.productId, i.variantId)).sort().join(',')],
    enabled: cart.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
    queryFn: () => fetchAvailabilityForCart(cart),
  });

  // Hide lines with known 0 availability from the cart (auto-prune storage)
  useEffect(() => {
    if (!availabilityQ.data || cart.length === 0) return;
    const next = cart.filter((it) => {
      const k = keyFor(it.productId, it.variantId ?? null);
      const avail = availabilityQ.data?.[k]?.totalAvailable;
      // remove only when known to be exactly 0
      return !(typeof avail === 'number' && avail === 0);
    });
    if (next.length !== cart.length) setCart(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityQ.data]);

  // Visible cart (after pruning)
  const visibleCart = useMemo(() => {
    if (!availabilityQ.data) return cart; // until we know, show everything we have
    return cart.filter((it) => {
      const k = keyFor(it.productId, it.variantId ?? null);
      const avail = availabilityQ.data?.[k]?.totalAvailable;
      return !(typeof avail === 'number' && avail === 0);
    });
  }, [cart, availabilityQ.data]);

  const total = useMemo(
    () => visibleCart.reduce((s, it) => s + (Number(it.totalPrice) || 0), 0),
    [visibleCart]
  );

  const clampToMax = (productId: string, variantId: string | null | undefined, wantQty: number) => {
    const k = keyFor(productId, variantId ?? null);
    const max = availabilityQ.data?.[k]?.totalAvailable;
    if (typeof max === 'number' && max >= 0) return Math.min(wantQty, Math.max(1, max));
    return Math.max(1, wantQty); // unknown → no cap
  };

  const updateQty = (productId: string, variantId: string | null | undefined, newQtyRaw: number) => {
    const clamped = clampToMax(productId, variantId, Math.floor(Number(newQtyRaw) || 1));
    setCart((prev) =>
      prev.map((it) => {
        if (!sameLine(it, productId, variantId)) return it;
        const unit = Number.isFinite(Number(it.unitPrice))
          ? Number(it.unitPrice)
          : (Number(it.totalPrice) || 0) / Math.max(1, Number(it.qty) || 1);
        return {
          ...it,
          qty: clamped,
          totalPrice: unit * clamped,
          unitPrice: unit,
        };
      })
    );
  };

  const inc = (productId: string, variantId?: string | null) => {
    const item = cart.find((c) => sameLine(c, productId, variantId));
    if (!item) return;
    const k = keyFor(productId, variantId ?? null);
    const max = availabilityQ.data?.[k]?.totalAvailable ?? Infinity;
    if (item.qty >= max) return; // hit the cap; optionally show a toast
    updateQty(productId, variantId ?? null, item.qty + 1);
  };

  const dec = (productId: string, variantId?: string | null) => {
    const item = cart.find((c) => sameLine(c, productId, variantId));
    if (!item) return;
    updateQty(productId, variantId ?? null, Math.max(1, item.qty - 1));
  };

  const remove = (productId: string, variantId?: string | null) => {
    setCart((prev) => prev.filter((it) => !sameLine(it, productId, variantId)));
  };

  // Block checkout if any known rule fails
  const cartBlockingReason = useMemo(() => {
    if (!availabilityQ.data) return null; // unknown yet – allow, or return a message if you prefer strict
    // any line whose qty > known available?
    const over = visibleCart.find((it) => {
      const k = keyFor(it.productId, it.variantId ?? null);
      const avail = availabilityQ.data?.[k]?.totalAvailable;
      return typeof avail === 'number' && avail >= 0 && it.qty > avail;
    });
    if (over) return 'Reduce quantities: some items exceed available stock.';
    return null;
  }, [visibleCart, availabilityQ.data]);

  const canCheckout = cartBlockingReason == null;

  // Empty state
  if (visibleCart.length === 0) {
    return (
      <div className="min-h-[88vh] bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft relative overflow-hidden grid place-items-center px-4">
        <div className="pointer-events-none absolute -top-24 -left-24 size-80 rounded-full bg-primary-500/20 blur-3xl animate-pulse" />
        <div className="pointer-events-none absolute -bottom-28 -right-24 size-96 rounded-full bg-fuchsia-400/20 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />

        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-3 py-1 text-[11px] font-semibold shadow-sm">
            <span className="inline-block size-1.5 rounded-full bg-white/90" />
            Your cart is empty
          </div>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-ink">Let’s find something you’ll love</h1>
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
          <p className="text-sm text-ink-soft">Update quantities, remove items, and proceed when you’re ready.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-6">
          {/* LEFT: Items */}
          <section className="space-y-4">
            {visibleCart.map((it) => {
              const currentQty = Math.max(1, Number(it.qty) || 1);
              const unit = Number.isFinite(Number(it.unitPrice))
                ? Number(it.unitPrice)
                : currentQty > 0
                  ? (Number(it.totalPrice) || 0) / currentQty
                  : Number(it.totalPrice) || 0;

              const k = keyFor(it.productId, it.variantId ?? null);
              const maxAvail = availabilityQ.data?.[k]?.totalAvailable;
              const capKnown = typeof maxAvail === 'number';
              const cap = capKnown ? Math.max(1, maxAvail!) : undefined;

              return (
                <article
                  key={k}
                  className="group rounded-2xl border border-white/60 bg-white/70 backdrop-blur shadow-[0_6px_30px_rgba(0,0,0,0.06)] p-4 md:p-5
                             transition hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]"
                >
                  <div className="flex items-start gap-4">
                    {/* Thumbnail */}
                    <div className="shrink-0 w-20 h-20 rounded-xl border overflow-hidden bg-white">
                      {it.image ? (
                        <img
                          src={it.image}
                          alt={it.title}
                          className="w-full h-full object-cover"
                          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                        />
                      ) : (
                        <div className="w-full h-full grid place-items-center text-[11px] text-ink-soft">No image</div>
                      )}
                    </div>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-ink truncate" title={it.title}>
                            {it.title}
                          </h3>

                          {!!it.selectedOptions?.length && (
                            <div className="mt-1 text-xs text-ink-soft">
                              {it.selectedOptions.map((o) => `${o.attribute}: ${o.value}`).join(' • ')}
                            </div>
                          )}

                          <p className="mt-1 text-xs text-ink-soft">Unit price: {ngn.format(unit)}</p>

                          {/* Availability helper text */}
                          <p className="mt-1 text-[11px] text-ink-soft">
                            {availabilityQ.isLoading
                              ? 'Checking availability…'
                              : capKnown
                                ? cap! > 0
                                  ? (it.qty > (cap ?? 0) ? `Only ${cap} available. Please reduce.` : `Max you can buy now: ${cap}`)
                                  : 'Out of stock'
                                : ''}
                          </p>
                        </div>

                        <button
                          className="text-xs md:text-sm text-danger hover:underline rounded px-2 py-1 hover:bg-danger/5 transition"
                          onClick={() => remove(it.productId, it.variantId ?? null)}
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
                              onClick={() => dec(it.productId, it.variantId ?? null)}
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={1}
                              {...(capKnown ? { max: cap } : {})}
                              step={1}
                              value={it.qty}
                              onChange={(e) =>
                                updateQty(it.productId, it.variantId ?? null, Number(e.target.value))
                              }
                              onBlur={(e) => {
                                // Ensure it doesn't exceed after manual typing
                                updateQty(it.productId, it.variantId ?? null, Number(e.target.value));
                              }}
                              className="w-16 text-center outline-none px-2 py-2 bg-white"
                            />
                            <button
                              aria-label="Increase quantity"
                              className="px-3 py-2 hover:bg-black/5 active:scale-[0.98] transition disabled:opacity-40"
                              onClick={() => inc(it.productId, it.variantId ?? null)}
                              disabled={capKnown ? it.qty >= (cap ?? Infinity) : false}
                              title={capKnown && it.qty >= (cap ?? Infinity) ? 'No more stock' : 'Increase quantity'}
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

              {!canCheckout && (
                <p className="mt-2 text-[12px] text-rose-600">
                  {cartBlockingReason}
                </p>
              )}

              <Link
                to={canCheckout ? "/checkout" : "#"}
                onClick={(e) => { if (!canCheckout) e.preventDefault(); }}
                className={`mt-5 w-full inline-flex items-center justify-center rounded-xl px-4 py-3 font-semibold shadow-sm transition
                  ${canCheckout
                    ? 'bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white hover:shadow-md active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-primary-200'
                    : 'bg-zinc-200 text-zinc-500 cursor-not-allowed'}`}
                aria-disabled={!canCheckout}
              >
                Proceed to checkout
              </Link>

              <Link
                to="/"
                className="mt-3 w-full inline-flex items-center justify-center rounded-xl border border-border bg-white px-4 py-3 text-ink
                           hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-50 transition"
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
