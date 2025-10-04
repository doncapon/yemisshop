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
        // Derive unit price from current state safely:
        // unit = totalPrice / qty (guard divide-by-zero)
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

  return (
    <div>
      <h1 className="text-xl mb-4">Your Cart</h1>

      {cart.length === 0 ? (
        <p>
          Cart is empty.{' '}
          <Link className="underline" to="/">
            Go shopping
          </Link>
        </p>
      ) : (
        <>
          <ul className="space-y-3">
            {cart.map((it) => (
              <li
                key={it.productId}
                className="border rounded p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{it.title}</div>
                </div>

                {/* Quantity controls + total */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <button
                      aria-label="Decrease quantity"
                      className="px-2 py-1 border rounded"
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
                      className="w-16 text-center border rounded py-1"
                    />
                    <button
                      aria-label="Increase quantity"
                      className="px-2 py-1 border rounded"
                      onClick={() => inc(it.productId)}
                    >
                      +
                    </button>
                  </div>

                  <div className="w-28 text-right font-medium">
                    {ngn.format(Number(it.totalPrice) || 0)}
                  </div>

                  <button
                    className="text-red-600 underline"
                    onClick={() => remove(it.productId)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex gap-x-12 font-semibold text-lg">
            <span>Total : </span>
            <span>{ngn.format(total)}</span>
          </div>


          <Link to="/checkout" className="inline-block mt-4 underline">
            Proceed to Checkout
          </Link>
        </>
      )}
    </div>
  );
}
