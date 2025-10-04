// src/pages/Checkout.tsx
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

export default function Checkout() {
  const nav = useNavigate();

  const raw = localStorage.getItem('cart');
  const cart: Array<{ productId: string; title: string; price: number; qty: number; totalPrice: number }> =
    raw ? JSON.parse(raw) : [];

  const createOrder = useMutation({
    mutationFn: async () => {
      const items = cart.map((it) => ({ productId: it.productId, qty: it.qty }));
      // shipping/tax are zero for demo; wire real inputs later
      const res = await api.post('/api/orders', { items, shipping: 0, tax: 0 });
      return res.data;
    },
    onSuccess: () => {
      localStorage.removeItem('cart');
      alert('Order placed!');
      nav('/');
    },
  });

  if (cart.length === 0) {
    return <p>Your cart is empty.</p>;
  }

  const ngn = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 2,
  });

  const total = cart.reduce((sum, it) => sum + it.totalPrice, 0);

  return (
    <div>
      <h1 className="text-xl mb-4">Checkout</h1>

      <ul className="space-y-2">
        {cart.map((it) => (
          <li key={it.productId} className="flex justify-between border p-2 rounded">
            <span>
              {it.title} × {it.qty}
            </span>
            <span>{ngn.format(it.totalPrice)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex justify-between font-medium">
        <span>Total</span>
        <span>{ngn.format(total)}</span>
      </div>

      <button
        disabled={createOrder.isPending}
        onClick={() => createOrder.mutate()}
        className="border px-4 py-2 mt-4"
      >
        {createOrder.isPending ? 'Placing…' : 'Place Order'}
      </button>

      {createOrder.isError && (
        <p className="text-red-600 mt-2">
          {(createOrder.error as any)?.response?.data?.error || 'Failed to place order'}
        </p>
      )}
    </div>
  );
}
