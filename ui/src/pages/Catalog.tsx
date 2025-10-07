import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import { Link } from 'react-router-dom';

type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
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

  // MULTI-SELECT FILTERS
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedBucketIdxs, setSelectedBucketIdxs] = useState<number[]>([]);

  // PAGINATION
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<6 | 9 | 12>(9);

  const products = data ?? [];

  const { categories, visiblePriceBuckets, filtered } = useMemo(() => {
    // Category map
    const catMap = new Map<string, { id: string; name: string; count: number }>();
    for (const p of products) {
      const id = p.categoryId ?? 'uncategorized';
      const name = p.categoryName?.trim() || (p.categoryId ? `Category ${p.categoryId}` : 'Uncategorized');
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

    // Apply filters
    const activeCats = new Set(selectedCategories);
    const activeBuckets = selectedBucketIdxs.map((i) => PRICE_BUCKETS[i]);

    const filtered = products.filter((p) => {
      const price = Number(p.price) || 0;
      const catId = p.categoryId ?? 'uncategorized';

      const catOk = activeCats.size === 0 ? true : activeCats.has(catId);
      const priceOk =
        activeBuckets.length === 0 ? true : activeBuckets.some((b) => inBucket(price, b));

      return catOk && priceOk;
    });

    return { categories, visiblePriceBuckets, filtered };
  }, [products, selectedCategories, selectedBucketIdxs]);

  // If filters/pageSize change, reset/clamp page
  useEffect(() => {
    setPage(1);
  }, [selectedCategories, selectedBucketIdxs, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p>Error loading products</p>;

  // Handlers
  const toggleCategory = (id: string) =>
    setSelectedCategories((curr) => (curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id]));
  const toggleBucket = (idx: number) =>
    setSelectedBucketIdxs((curr) => (curr.includes(idx) ? curr.filter((i) => i !== idx) : [...curr, idx]));
  const clearFilters = () => {
    setSelectedCategories([]);
    setSelectedBucketIdxs([]);
  };

  const goTo = (p: number) => {
    const clamped = Math.min(Math.max(1, p), totalPages);
    setPage(clamped);
    // Optional: scroll to top of grid on page change
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="max-w-screen-2xl mx-auto bg-bg-soft min-h-screen">
      <div className="md:flex md:items-start md:gap-8">
        {/* LEFT: filters */}
        <aside className="space-y-8 md:w-72 lg:w-80 md:flex-none px-4 md:px-6 bg-primary-600 min-h-screen text-white">
          <section>
            <h3 className="pt-4 text-white/90">Filters</h3>
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
                  <li key={c.id} className="flex items-center gap-2 text-accent-200">
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
                      <span className="ml-2 text-xs opacity-80">({c.count})</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

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
                  <li key={bucket.label} className="flex items-center gap-2 text-accent-200">
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
                      <span className="ml-2 text-xs opacity-80">({count})</span>
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

        {/* RIGHT: product tiles + pagination */}
        <section className="mt-8 md:mt-0 flex-1 px-4 md:px-0">
          {filtered.length === 0 ? (
            <p>No products match your filters.</p>
          ) : (
            <>
              {/* page size selector (optional) */}
               <div className="flex items-center justify-start pt-3"><span className="font-40 text-accent-600">Products</span></div> 

              <div className="mb-3 flex items-center justify-end gap-2 text-sm pr-3">
                <span className="opacity-70">Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as any)}
                  className="border rounded px-2 py-1 bg-white"
                >
                  <option value={6}>6</option>
                  <option value={9}>9</option>
                  <option value={12}>12</option>
                </select>
              </div>

              <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))] pr-3">
                {pageItems.map((p) => (
                  <article key={p.id} className="border rounded p-4 grid gap-3 auto-rows-min bg-zinc-100">
                    <Link to={`/product/${p.id}`} className="grid gap-3 auto-rows-min">
                      {p.imagesJson?.[0] && (
                        <img
                          src={p.imagesJson[0]}
                          alt={p.title}
                          className="w-full h-40 object-cover rounded border"
                        />
                      )}
                      <h3 className="font-medium text-accent-600">{p.title}</h3>
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

              {/* Pagination controls */}
              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  className="px-3 py-1 border rounded disabled:opacity-50 text-accent-500"
                  onClick={() => goTo(currentPage - 1)}
                  disabled={currentPage <= 1}
                >
                  Prev
                </button>

                {/* Page numbers (compact) */}
                {Array.from({ length: totalPages }).map((_, i) => {
                  const p = i + 1;
                  const active = p === currentPage;
                  // Show first, last, current ±1 (simple ellipsis logic)
                  const shouldShow =
                    p === 1 ||
                    p === totalPages ||
                    Math.abs(p - currentPage) <= 1;
                  const isEdgeGap =
                    (p === 2 && currentPage > 3) ||
                    (p === totalPages - 1 && currentPage < totalPages - 2);

                  if (!shouldShow && !isEdgeGap) return null;
                  if (isEdgeGap) return <span key={`gap-${p}`} className="px-1">…</span>;

                  return (
                    <button
                      key={p}
                      onClick={() => goTo(p)}
                      className={`px-3 py-1 border rounded ${
                        active ? 'bg-accent-600 text-white' : 'hover:bg-black/5'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}

                <button
                  className="px-3 py-1 border rounded disabled:opacity-50 text-accent-500"
                  onClick={() => goTo(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                >
                  Next
                </button>
              </div>

              {/* Small results summary */}
              <p className="mt-3 text-center text-sm opacity-70">
                Showing {start + 1}-{Math.min(start + pageSize, filtered.length)} of {filtered.length} products
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
