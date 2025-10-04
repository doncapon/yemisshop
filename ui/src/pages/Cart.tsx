import { Link } from 'react-router-dom';

type CartItem = {
  productId: string;
  title: string;
  qty: number;    // number, not string
  price: number;  // number, not string
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem('cart');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Coerce to numbers defensively
    return parsed.map((it: any): CartItem => ({
      productId: String(it.productId),
      title: String(it.title ?? ''),
      qty: Number(it.qty) || 0,
      price: Number(it.price) || 0,
    }));
  } catch {
    return [];
  }
}

export default function Cart() {
  const cart = loadCart();
  const total = cart.reduce((s, it) => s + it.price * it.qty, 0);

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
          <ul className="space-y-2">
            {cart.map((it) => {
              const line = it.price * it.qty;
              return (
                <li key={it.productId} className="flex justify-between border p-2 rounded">
                  <span>
                    {it.title} × {it.qty}
                  </span>
                  <span>{ngn.format(line)}</span>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex justify-between font-medium">
            <span>Total</span>
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
