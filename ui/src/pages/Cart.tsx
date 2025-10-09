// src/pages/Cart.tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

type CartItem = {
  productId: string;
  title: string;
  qty: number;          // integer, editable
  totalPrice: number;   // total for this line (qty * unit)
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

// ---- Persistence helpers ----------------------------------------------------

function normalizeCartShape(parsed: any[]): CartItem[] {
  // Back-compat: if older entries had { price } and no totalPrice,
  // treat price as unit price and compute totalPrice = price * qty.
  return parsed.map((it: any) => {
    const qtyNum = Math.max(1, Number(it.qty) || 1);
    const hasTotal = typeof it.totalPrice === 'number' && isFinite(it.totalPrice);
    const hasPrice = typeof it.price === 'number' && isFinite(it.price);

    let totalPrice: number;
    if (hasTotal) {
      totalPrice = Number(it.totalPrice);
    } else if (hasPrice) {
      totalPrice = Number(it.price) * qtyNum;
    } else {
      totalPrice = 0;
    }

    return {
      productId: String(it.productId),
      title: String(it.title ?? ''),
      qty: qtyNum,
      totalPrice: totalPrice || 0,
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

  const updateQty = (productId: string, newQtyRaw: number) => {
    const newQty = Math.max(1, Math.floor(Number(newQtyRaw) || 1));
    setCart((prev) =>
      prev.map((it) => {
        if (it.productId !== productId) return it;
        const currentQty = Math.max(1, Number(it.qty) || 1);
        const unit = (Number(it.totalPrice) || 0) / currentQty;
        const newTotal = unit * newQty;
        return { ...it, qty: newQty, totalPrice: newTotal };
      })
    );
  };

  const inc = (productId: string) => {
    const item = cart.find((c) => c.productId === productId);
    if (!item) return;
    updateQty(productId, item.qty + 1);
  };

  const dec = (productId: string) => {
    const item = cart.find((c) => c.productId === productId);
    if (!item) return;
    updateQty(productId, Math.max(1, item.qty - 1));
  };

  const remove = (productId: string) => {
    setCart((prev) => prev.filter((it) => it.productId !== productId));
  };

  // Empty state
  if (cart.length === 0) {
    return (
      <div className="min-h-[70vh] grid place-items-center bg-bg-soft">
        <div className="max-w-md text-center space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-100 text-primary-700 px-3 py-1 text-xs font-medium border border-primary-200">
            Your cart is empty
          </div>
          <h1 className="text-2xl font-semibold text-ink">Let’s find something you’ll love</h1>
          <p className="text-ink-soft">
            Browse our catalogue and add items to your cart. They’ll show up here for checkout.
          </p>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary-600 text-white px-4 py-2 font-medium hover:bg-primary-700 active:bg-primary-800 focus:outline-none focus:ring-4 focus:ring-primary-200 transition"
          >
            Go shopping
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-soft bg-hero-radial">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">Your Cart</h1>
          <p className="text-sm text-ink-soft">Review items and update quantities before checkout.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-6">
          {/* LEFT: Items */}
          <section className="space-y-3">
            {cart.map((it) => {
              const currentQty = Math.max(1, Number(it.qty) || 1);
              const unit =
                currentQty > 0 ? (Number(it.totalPrice) || 0) / currentQty : Number(it.totalPrice) || 0;

              return (
                <article
                  key={it.productId}
                  className="rounded-xl border border-border bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-medium text-ink truncate">{it.title}</h3>
                      <p className="mt-1 text-xs text-ink-soft">Unit price: {ngn.format(unit)}</p>
                    </div>

                    <button
                      className="text-sm text-danger hover:underline"
                      onClick={() => remove(it.productId)}
                      aria-label={`Remove ${it.title}`}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    {/* Quantity controls */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-lg border border-border bg-surface overflow-hidden">
                        <button
                          aria-label="Decrease quantity"
                          className="px-3 py-2 hover:bg-black/5"
                          onClick={() => dec(it.productId)}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={it.qty}
                          onChange={(e) => updateQty(it.productId, Number(e.target.value))}
                          className="w-16 text-center outline-none px-2 py-2 bg-white"
                        />
                        <button
                          aria-label="Increase quantity"
                          className="px-3 py-2 hover:bg-black/5"
                          onClick={() => inc(it.productId)}
                        >
                          +
                        </button>
                      </div>
                      <span className="text-sm text-ink-soft">Qty</span>
                    </div>

                    {/* Line total */}
                    <div className="text-right">
                      <div className="text-sm text-ink-soft">Line total</div>
                      <div className="text-lg font-semibold">{ngn.format(Number(it.totalPrice) || 0)}</div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          {/* RIGHT: Summary */}
          <aside className="lg:sticky lg:top-6 h-max">
            <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-ink">Order Summary</h2>
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
                <span className="text-xl font-semibold">{ngn.format(total)}</span>
              </div>

              <Link
                to="/checkout"
                className="mt-5 w-full inline-flex items-center justify-center rounded-lg bg-primary-600 text-white px-4 py-2.5 font-medium hover:bg-primary-700 active:bg-primary-800 focus:outline-none focus:ring-4 focus:ring-primary-200 transition"
              >
                Proceed to Checkout
              </Link>

              <Link
                to="/"
                className="mt-3 w-full inline-flex items-center justify-center rounded-lg border border-border bg-surface px-4 py-2.5 text-ink hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-primary-50 transition"
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
