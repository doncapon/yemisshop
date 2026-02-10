import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../api/client';

type Product = {
  id: string;
  title: string;
  retailPrice: number;
  imagesJson?: string[];
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency', currency: 'NGN', maximumFractionDigits: 2,
});

export default function SimilarProducts({ productId }: { productId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['similar', productId],
    queryFn: async () => (await api.get(`/api/products/${productId}/similar`)).data as Product[],
    enabled: !!productId,
  });

  if (isLoading || error || !data || data.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-primary-800">Similar products</h3>
        <Link to="/" className="text-sm underline">See all</Link>
      </div>
      <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
        {data.map((p) => (
          <Link
            key={p.id}
            to={`/product/${p.id}`}
            className="rounded-lg border bg-white hover:shadow-sm transition overflow-hidden"
            title={p.title}
          >
            {p.imagesJson?.[0] && (
              <img src={p.imagesJson[0]} alt={p.title} className="w-full h-40 object-cover border-b" />
            )}
            <div className="p-3">
              <div className="line-clamp-2 font-medium text-ink">{p.title}</div>
              <div className="mt-1 font-semibold text-accent-700">{ngn.format(Number(p.retailPrice) || 0)}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
