import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import { Link } from 'react-router-dom';

type Product = {
  id: string;
  title: string;
  description: string;
  price: number;            // major units
  imagesJson: string[];
  categoryId?: string | null;
  categoryName?: string | null;
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

type PriceBucket = { label: string; min: number; max?: number };
const PRICE_BUCKETS: PriceBucket[] = [
  { label: '₦1,000 – ₦4,999', min: 1000, max: 4999 },
  { label: '₦5,000 – ₦9,999', min: 5000, max: 9999 },
  { label: '₦10,000 – ₦499,999', min: 10000, max: 499999 },
  { label: '₦500,000+', min: 500000 },
];

function inBucket(price: number, b: PriceBucket) {
  return b.max == null ? price >= b.min : price >= b.min && price <= b.max;
}

export default function Catalog() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['products'],
    queryFn: async () => (await api.get('/api/products')).data as Product[],
  });

  // MULTI-SELECT STATES
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedBucketIdxs, setSelectedBucketIdxs] = useState<number[]>([]);

  const products = data ?? [];

  const {
    categories,               // [{ id, name, count }]
    visiblePriceBuckets,      // [{ bucket, idx, count }]
    filtered,
  } = useMemo(() => {
    // Build category freq map
    const catMap = new Map<string, { id: string; name: string; count: number }>();
    for (const p of products) {
      const id = p.categoryId ?? 'uncategorized';
      const name =
        p.categoryName?.trim() ||
        (p.categoryId ? `Category ${p.categoryId}` : 'Uncategorized');
      const entry = catMap.get(id) ?? { id, name, count: 0 };
      entry.count += 1;
      catMap.set(id, entry);
    }
    const categories = Array.from(catMap.values())
      .filter((c) => c.count > 0)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    // Price buckets with counts
    const priceCounts = PRICE_BUCKETS.map((b) =>
      products.filter((p) => inBucket(Number(p.price) || 0, b)).length
    );
    const visiblePriceBuckets = PRICE_BUCKETS
      .map((b, i) => ({ bucket: b, idx: i, count: priceCounts[i] || 0 }))
      .filter((x) => x.count > 0);

    // Active filters
    const activeCats = new Set(selectedCategories);
    const activeBuckets = selectedBucketIdxs.map((i) => PRICE_BUCKETS[i]);

    const filtered = products.filter((p) => {
      const price = Number(p.price) || 0;

      // Category filter: if none selected -> pass; else product cat must be in selected
      const catId = p.categoryId ?? 'uncategorized';
      const catOk =
        activeCats.size === 0 ? true : activeCats.has(catId);

      // Price multi-select: if none selected -> pass; else price must match ANY selected bucket
      const priceOk =
        activeBuckets.length === 0
          ? true
          : activeBuckets.some((b) => inBucket(price, b));

      return catOk && priceOk;
    });

    return { categories, visiblePriceBuckets, filtered };
  }, [products, selectedCategories, selectedBucketIdxs]);

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p>Error loading products</p>;

  // Handlers: toggle checkboxes
  const toggleCategory = (id: string) => {
    setSelectedCategories((curr) =>
      curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id]
    );
  };

  const toggleBucket = (idx: number) => {
    setSelectedBucketIdxs((curr) =>
      curr.includes(idx) ? curr.filter((i) => i !== idx) : [...curr, idx]
    );
  };

  const clearFilters = () => {
    setSelectedCategories([]);
    setSelectedBucketIdxs([]);
  };

  return (
    <div className="max-w-screen-2xl mx-auto px-4 md:px-6">
      <div className="md:flex md:items-start md:gap-8">
        {/* LEFT: filters */}
        <aside className="space-y-8 md:w-72 lg:w-80 md:flex-none">
          {/* Categories */}
          <section>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="font-semibold">Categories</h2>
              <button
                className="text-sm underline disabled:opacity-40"
                onClick={() => setSelectedCategories([])}
                disabled={selectedCategories.length === 0}
              >
                Clear
              </button>
            </div>
            <ul className="space-y-2">
              {categories.map((c) => {
                const checked = selectedCategories.includes(c.id);
                return (
                  <li key={c.id} className="flex items-center gap-2">
                    <input
                      id={`cat-${c.id}`}
                      type="checkbox"
                      className="size-4"
                      checked={checked}
                      onChange={() => toggleCategory(c.id)}
                    />
                    <label
                      htmlFor={`cat-${c.id}`}
                      className={`flex-1 flex items-center justify-between px-2 py-1 rounded border ${
                        checked ? 'bg-black text-white' : 'hover:bg-black/5'
                      }`}
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="ml-2 text-xs opacity-70">{c.count}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Price ranges */}
          <section>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="font-semibold">Price</h2>
              <button
                className="text-sm underline disabled:opacity-40"
                onClick={() => setSelectedBucketIdxs([])}
                disabled={selectedBucketIdxs.length === 0}
              >
                Clear
              </button>
            </div>
            <ul className="space-y-2">
              {visiblePriceBuckets.map(({ bucket, idx, count }) => {
                const checked = selectedBucketIdxs.includes(idx);
                return (
                  <li key={bucket.label} className="flex items-center gap-2">
                    <input
                      id={`price-${idx}`}
                      type="checkbox"
                      className="size-4"
                      checked={checked}
                      onChange={() => toggleBucket(idx)}
                    />
                    <label
                      htmlFor={`price-${idx}`}
                      className={`flex-1 flex items-center justify-between px-2 py-1 rounded border ${
                        checked ? 'bg-black text-white' : 'hover:bg-black/5'
                      }`}
                    >
                      <span>{bucket.label}</span>
                      <span className="ml-2 text-xs opacity-70">({count})</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          {(selectedCategories.length || selectedBucketIdxs.length) > 0 && (
            <button className="text-sm underline" onClick={clearFilters}>
              Clear all filters
            </button>
          )}
        </aside>

        {/* RIGHT: product tiles in a responsive grid */}
        <section className="mt-8 md:mt-0 flex-1">
          {filtered.length === 0 ? (
            <p>No products match your filters.</p>
          ) : (
            <div className="grid gap-5 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
              {filtered.map((p) => (
                <article
                  key={p.id}
                  className="border rounded p-4 grid gap-3 auto-rows-min"
                >
                  <Link to={`/product/${p.id}`} className="grid gap-3 auto-rows-min">
                    {p.imagesJson?.[0] && (
                      <img
                        src={p.imagesJson[0]}
                        alt={p.title}
                        className="w-full h-40 object-cover rounded border"
                      />
                    )}
                    <h3 className="font-medium">{p.title}</h3>
                    {p.categoryName && (
                      <p className="text-xs opacity-60">Category: {p.categoryName}</p>
                    )}
                    <p className="text-sm opacity-80">{p.description}</p>
                    <p className="text-sm mt-1 font-semibold">
                      {ngn.format(Number(p.price) || 0)}
                    </p>
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
