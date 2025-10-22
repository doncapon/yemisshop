// src/pages/Cart.tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

type SelectedOption = {
  attributeId: string;
  attribute: string;
  valueId?: string;
  value: string;
};

type CartItem = {
  productId: string;
  variantId?: string | null; // ← NEW
  title: string;
  qty: number;               // integer, editable
  unitPrice: number;         // ← NEW: single unit price (variant or base)
  totalPrice: number;        // total for this line (qty * unit)
  selectedOptions?: SelectedOption[]; // ← NEW
  image?: string;            // ← NEW
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

// ---- Persistence helpers ----------------------------------------------------

function toArray<T = any>(x: any): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function normalizeCartShape(parsed: any[]): CartItem[] {
  // Back-compat and normalization of mixed shapes.
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

// ---- Utilities --------------------------------------------------------------

const keyFor = (productId: string, variantId?: string | null) =>
  `${productId}::${variantId ?? ''}`;

const sameLine = (a: CartItem, productId: string, variantId?: string | null) =>
  a.productId === productId && (a.variantId ?? null) === (variantId ?? null);

// ---- Component --------------------------------------------------------------

export default function Cart() {
  const [cart, setCart] = useState<CartItem[]>(() => loadCart());

  // Keep localStorage synced
  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  const total = useMemo(
    () => cart.reduce((s, it) => s + (Number(it.totalPrice) || 0), 0),
    [cart]
  );

  const updateQty = (productId: string, variantId: string | null | undefined, newQtyRaw: number) => {
    const newQty = Math.max(1, Math.floor(Number(newQtyRaw) || 1));
    setCart((prev) =>
      prev.map((it) => {
        if (!sameLine(it, productId, variantId)) return it;
        const unit = Number.isFinite(Number(it.unitPrice))
          ? Number(it.unitPrice)
          : (Number(it.totalPrice) || 0) / Math.max(1, Number(it.qty) || 1);
        return {
          ...it,
          qty: newQty,
          totalPrice: unit * newQty,
          unitPrice: unit, // keep unitPrice stable
        };
      })
    );
  };

  const inc = (productId: string, variantId?: string | null) => {
    const item = cart.find((c) => sameLine(c, productId, variantId));
    if (!item) return;
    updateQty(productId, variantId, item.qty + 1);
  };

  const dec = (productId: string, variantId?: string | null) => {
    const item = cart.find((c) => sameLine(c, productId, variantId));
    if (!item) return;
    updateQty(productId, variantId, Math.max(1, item.qty - 1));
  };

  const remove = (productId: string, variantId?: string | null) => {
    setCart((prev) => prev.filter((it) => !sameLine(it, productId, variantId)));
  };

  // Empty state (glassy card + gradient CTA)
  if (cart.length === 0) {
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
            {cart.map((it) => {
              const currentQty = Math.max(1, Number(it.qty) || 1);
              const unit = Number.isFinite(Number(it.unitPrice))
                ? Number(it.unitPrice)
                : currentQty > 0
                ? (Number(it.totalPrice) || 0) / currentQty
                : Number(it.totalPrice) || 0;

              const key = keyFor(it.productId, it.variantId);

              return (
                <article
                  key={key}
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

                          {/* Selected variant options */}
                          {!!it.selectedOptions?.length && (
                            <div className="mt-1 text-xs text-ink-soft">
                              {it.selectedOptions
                                .map((o) => `${o.attribute}: ${o.value}`)
                                .join(' • ')}
                            </div>
                          )}

                          <p className="mt-1 text-xs text-ink-soft">Unit price: {ngn.format(unit)}</p>
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
                              step={1}
                              value={it.qty}
                              onChange={(e) =>
                                updateQty(it.productId, it.variantId ?? null, Number(e.target.value))
                              }
                              className="w-16 text-center outline-none px-2 py-2 bg-white"
                            />
                            <button
                              aria-label="Increase quantity"
                              className="px-3 py-2 hover:bg-black/5 active:scale-[0.98] transition"
                              onClick={() => inc(it.productId, it.variantId ?? null)}
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
                  <span className="font-medium">{cart.length}</span>
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

              <Link
                to="/checkout"
                className="mt-5 w-full inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white
                           px-4 py-3 font-semibold shadow-sm hover:shadow-md active:scale-[0.99]
                           focus:outline-none focus:ring-4 focus:ring-primary-200 transition"
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
