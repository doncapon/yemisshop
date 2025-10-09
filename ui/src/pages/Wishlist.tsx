// src/pages/Wishlist.tsx
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  imagesJson?: string[];
  categoryId?: string | null;
  categoryName?: string | null;
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

export default function Wishlist() {
  const { token } = useAuthStore();
  const nav = useNavigate();
  const qc = useQueryClient();

  // Redirect if not logged in
  if (!token) nav('/login', { replace: true, state: { from: { pathname: '/wishlist' } } });

  // 1) Load just my favorite product IDs
  const favQuery = useQuery({
    queryKey: ['favorites', 'mine'],
    enabled: !!token,
    queryFn: async () => {
      const { data } = await api.get<{ productIds: string[] }>('/api/favorites/mine', {
        headers: { Authorization: `Bearer ${token}` },
      });
      return new Set(data.productIds);
    },
    initialData: new Set<string>(),
  });

  // 2) Load all products once (could be swapped for /favorites/mine products if you prefer)
  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: async () => (await api.get('/api/products')).data as Product[],
  });

  const favorites = useMemo(() => {
    if (!productsQuery.data) return [];
    return productsQuery.data.filter((p) => favQuery.data.has(p.id));
  }, [productsQuery.data, favQuery.data]);

  // Remove one favorite
  const removeOne = useMutation({
    mutationFn: async ({ productId }: { productId: string }) => {
      await api.delete(`/api/favorites/${productId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { productId };
    },
    onMutate: async ({ productId }) => {
      const key = ['favorites', 'mine'] as const;
      const prev = qc.getQueryData<Set<string>>(key);
      if (prev) {
        const next = new Set(prev);
        next.delete(productId);
        qc.setQueryData(key, next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['favorites', 'mine'], ctx.prev);
      alert('Failed to remove from wishlist.');
    },
  });

  // Clear all favorites (optional — remove if you don’t want)
  const clearAll = useMutation({
    mutationFn: async () => {
      await api.delete('/api/favorites', {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    onSuccess: () => {
      qc.setQueryData(['favorites', 'mine'], new Set<string>());
    },
  });

  return (
    <div className="max-w-screen-2xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold text-primary-700">Your Wishlist</h1>
        {favorites.length > 0 && (
          <button
            className="text-sm underline"
            disabled={clearAll.isPending}
            onClick={() => clearAll.mutate()}
          >
            {clearAll.isPending ? 'Clearing…' : 'Clear all'}
          </button>
        )}
      </div>

      {favorites.length === 0 ? (
        <div className="border rounded-lg p-6 bg-white">
          <p className="mb-3">No items in your wishlist yet.</p>
          <Link to="/" className="inline-block bg-accent-500 px-4 py-2 text-white rounded hover:bg-accent-600">
            Browse products
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
          {favorites.map((p) => (
            <article key={p.id} className="border rounded-lg p-4 grid gap-3 bg-white">
              <Link to={`/product/${p.id}`} className="grid gap-3">
                {p.imagesJson?.[0] && (
                  <img
                    src={p.imagesJson[0]}
                    alt={p.title}
                    className="w-full h-40 object-cover rounded border"
                  />
                )}
                <h3 className="font-medium text-primary-700">{p.title}</h3>
                <p className="text-sm font-semibold">{ngn.format(Number(p.price) || 0)}</p>
              </Link>
              <div className="flex items-center justify-between pt-1">
                <button
                  className="text-sm underline text-red-600"
                  onClick={() => removeOne.mutate({ productId: p.id })}
                >
                  Remove
                </button>
                <Link to={`/product/${p.id}`} className="text-sm underline">
                  View
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
