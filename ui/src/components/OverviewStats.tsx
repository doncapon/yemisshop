import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Layers, Package, AlertTriangle, Tag, Boxes, ShoppingCart } from 'lucide-react';
import api from '../api/client';

type Overview = {
  products: {
    total: number;
    pending: number;
    rejected: number;
    published: number;
    live: number;
    availability: {
      allStatusesAvailable: number;
      publishedAvailable: number;
    };
    offers: {
      withAny: number;
      withoutAny: number;
      publishedWithAny: number;
      publishedWithoutAny: number;
      withActive: number;
      publishedWithActive: number;
    };
    variantMix: {
      withVariants: number;
      simple: number;
    };
    publishedBaseStock: {
      inStock: number;
      outOfStock: number;
    };
  };
};

type ProductRow = {
  id: string;
  title: string;
  status?: string;
  inStock?: boolean;
  variantCount?: number;
  offerCount?: number;
  activeOfferCount?: number;
};

const tone = {
  primary: 'bg-zinc-900 text-white border-zinc-900',
  green:   'bg-emerald-600 text-white border-emerald-600',
  blue:    'bg-blue-600 text-white border-blue-600',
  amber:   'bg-amber-500 text-white border-amber-500',
  rose:    'bg-rose-600 text-white border-rose-600',
  slate:   'bg-white text-zinc-900 border-zinc-200',
};

function Card({
  title,
  value,
  hint,
  icon,
  color = 'slate',
  onClick,
}: {
  title: string;
  value: number | string;
  hint?: string;
  icon?: React.ReactNode;
  color?: keyof typeof tone;
  onClick?: () => void;
}) {
  const clickable = typeof onClick === 'function';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-2xl border p-4 transition shadow-sm ${tone[color]} ${clickable ? 'hover:opacity-95' : 'cursor-default'}`}
      aria-label={clickable ? `Open ${title} list` : title}
    >
      <div className="flex items-center justify-between">
        <div className="text-xs opacity-70">{title}</div>
        {icon}
      </div>
      <div className="text-2xl font-bold mt-1 leading-none">{value}</div>
      {hint && <div className="text-xs opacity-80 mt-1">{hint}</div>}
    </button>
  );
}

/** Generic list modal (fetches a list by bucket) */
function DataListModal({
  open,
  onClose,
  bucket,
  title,
  token,
}: {
  open: boolean;
  onClose: () => void;
  bucket:
    | 'live'
    | 'published'
    | 'published-available'
    | 'published-no-offer'
    | 'published-with-offer'
    | 'published-with-active-offer'
    | 'with-variants'
    | 'simple';
  title: string;
  token?: string | null;
}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const nav = useNavigate();

  const listQ = useQuery<ProductRow[]>({
    queryKey: ['admin', 'reports', 'products', bucket],
    enabled: open,
    // Expect a backend helper: GET /api/admin/reports/products?bucket=...
    // If you haven't added it yet, do that on the API; it's trivial to map each bucket to the Prisma where.
    queryFn: async () => {
      const { data } = await api.get(`/api/admin/reports/products`, {
        params: { bucket },
        headers,
      });
      // normalize
      const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      return arr.map((x: any) => ({
        id: String(x.id),
        title: String(x.title ?? 'Untitled'),
        status: x.status,
        inStock: x.inStock,
        variantCount: Number(x.variantCount ?? x._variantCount ?? 0),
        offerCount: Number(x.offerCount ?? x._offerCount ?? 0),
        activeOfferCount: Number(x.activeOfferCount ?? x._activeOfferCount ?? 0),
      })) as ProductRow[];
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl border shadow-xl w-[min(960px,95vw)] max-h-[85vh] overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">{title}</div>
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border hover:bg-black/5">Close</button>
        </div>
        <div className="p-4">
          {listQ.isLoading && <div className="p-6 text-sm text-zinc-600">Loading…</div>}
          {listQ.isError && (
            <div className="p-6 text-sm text-rose-600">
              Could not load list. Ensure <code>/api/admin/reports/products?bucket={bucket}</code> exists.
            </div>
          )}
          {!listQ.isLoading && !listQ.isError && (
            <>
              {listQ.data?.length ? (
                <div className="border rounded-xl overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 w-16">Open</th>
                        <th className="text-left px-3 py-2">Title</th>
                        <th className="text-left px-3 py-2">Status</th>
                        <th className="text-left px-3 py-2">In stock</th>
                        <th className="text-left px-3 py-2">Variants</th>
                        <th className="text-left px-3 py-2">Offers</th>
                        <th className="text-left px-3 py-2">Active offers</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {listQ.data.map((p) => (
                        <tr key={p.id} className="hover:bg-black/5">
                          <td className="px-3 py-2">
                            <button
                              className="px-2 py-1 text-xs rounded border"
                              onClick={() => nav(`/admin?focusId=${p.id}`)}
                              title="Open in editor"
                            >
                              Edit
                            </button>
                          </td>
                          <td className="px-3 py-2">{p.title}</td>
                          <td className="px-3 py-2">{p.status ?? '—'}</td>
                          <td className="px-3 py-2">{p.inStock ? 'Yes' : 'No'}</td>
                          <td className="px-3 py-2">{p.variantCount ?? 0}</td>
                          <td className="px-3 py-2">{p.offerCount ?? 0}</td>
                          <td className="px-3 py-2">{p.activeOfferCount ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-sm text-zinc-500">No products in this bucket.</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OverviewStats({ token }: { token?: string | null }) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  const overviewQ = useQuery<Overview>({
    queryKey: ['admin', 'overview'],
    queryFn: async () => {
      const { data } = await api.get('/api/admin/overview', { headers });
      return data;
    },
    staleTime: 30_000,
  });

  // modal state
  const [modal, setModal] = React.useState<null | {
    bucket: Parameters<typeof DataListModal>[0]['bucket'];
    title: string;
  }>(null);

  if (overviewQ.isLoading) {
    return <div className="grid md:grid-cols-4 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-2xl border p-4 bg-white">
          <div className="h-3 w-20 bg-zinc-200 rounded mb-2" />
          <div className="h-7 w-16 bg-zinc-200 rounded" />
        </div>
      ))}
    </div>;
  }

  if (overviewQ.error || !overviewQ.data) {
    return <div className="p-4 rounded-2xl border bg-rose-50 text-rose-700">Could not load overview.</div>;
  }

  const o = overviewQ.data.products;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        {/* Headline pair */}
        <Card
          title="Published"
          value={o.published}
          hint="Approved & visible"
          icon={<Layers size={18} className="opacity-80" />}
          color="blue"
          onClick={() => setModal({ bucket: 'published', title: 'Published products' })}
        />
        <Card
          title="Live"
          value={o.live}
          hint="Published + in stock + active offer"
          icon={<CheckCircle2 size={18} className="opacity-80" />}
          color="green"
          onClick={() => setModal({ bucket: 'live', title: 'Live products' })}
        />

        {/* Offers coverage */}
        <Card
          title="Published with offers"
          value={o.offers.publishedWithAny}
          hint="Any offer attached"
          icon={<Tag size={18} className="opacity-80" />}
          color="slate"
          onClick={() => setModal({ bucket: 'published-with-offer', title: 'Published with any offer' })}
        />
        <Card
          title="Published w/o offers"
          value={o.offers.publishedWithoutAny}
          hint="Needs supplier pricing"
          icon={<AlertTriangle size={18} className="opacity-80" />}
          color="amber"
          onClick={() => setModal({ bucket: 'published-no-offer', title: 'Published without any offer' })}
        />
        <Card
          title="Published with active offer"
          value={o.offers.publishedWithActive}
          hint="isActive & inStock"
          icon={<ShoppingCart size={18} className="opacity-80" />}
          color="slate"
          onClick={() => setModal({ bucket: 'published-with-active-offer', title: 'Published with active (sellable) offer' })}
        />

        {/* Availability & mix */}
        <Card
          title="Published available"
          value={o.availability.publishedAvailable}
          hint="Base or any variant in stock"
          icon={<Package size={18} className="opacity-80" />}
          color="slate"
          onClick={() => setModal({ bucket: 'published-available', title: 'Published & available' })}
        />
        <Card
          title="With variants"
          value={o.variantMix.withVariants}
          hint="Any variant rows"
          icon={<Boxes size={18} className="opacity-80" />}
          color="slate"
          onClick={() => setModal({ bucket: 'with-variants', title: 'Products with variants' })}
        />
        <Card
          title="Simple products"
          value={o.variantMix.simple}
          hint="No variants"
          icon={<Boxes size={18} className="opacity-80" />}
          color="slate"
          onClick={() => setModal({ bucket: 'simple', title: 'Simple products (no variants)' })}
        />
      </div>

      {/* Modal */}
      <DataListModal
        open={!!modal}
        onClose={() => setModal(null)}
        bucket={modal?.bucket || 'live'}
        title={modal?.title || ''}
        token={token}
      />
    </>
  );
}
