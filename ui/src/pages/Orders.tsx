import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

type OrderItem = {
  id: string;
  qty: number;
  unitPrice: string | number;
  product?: { id: string; title: string } | null;
};

type Payment = {
  id: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | string;
  provider?: string | null;
  channel?: string | null;
  reference?: string | null;
  createdAt?: string;
};

type Order = {
  id: string;
  createdAt: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | string;
  total: number | string;
  tax?: number | string;
  shipping?: number | string;
  items?: OrderItem[];
  payments?: Payment[];
  shippingAddress?: {
    city?: string | null;
    state?: string | null;
    country?: string | null;
  } | null;
};

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

// --- tiny helpers -----------------------------------------------------------
function toNumber(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function shortId(id: string) {
  return id.length > 10 ? `#${id.slice(0, 6)}…${id.slice(-4)}` : `#${id}`;
}
function formatDate(s: string) {
  const d = new Date(s);
  if (Number.isNaN(+d)) return s;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type SortKey = 'createdAt' | 'id' | 'status' | 'items' | 'total';
type SortDir = 'asc' | 'desc';

export default function Orders() {
  const nav = useNavigate();
  const token = useAuthStore((s) => s.token);

  // redirect to login if needed
  useEffect(() => {
    if (!token) nav('/login', { state: { from: { pathname: '/orders' } } });
  }, [token, nav]);

  // raw data
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // controls
  const [q, setQ] = useState(''); // text filter
  const [statusFilter, setStatusFilter] = useState<string>(''); // "" = all
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(10);

  // load orders
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!token) return;
      setLoading(true);
      setErr(null);
      try {
        // this endpoint should include items + payments for a nice table
        const {data} = await api.get('/api/orders/mine', {
          headers: { Authorization: `Bearer ${token}` },
        });
        console.log(mounted)
        if (mounted) setOrders(data.data ?? []);
      } catch (e: any) {
        if (mounted) setErr(e?.response?.data?.error || 'Failed to load orders');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [token]);

  // derived
  const uniqueStatuses = useMemo(() => {
    const s = new Set<string>();
    for (const o of orders) s.add(o.status);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [orders]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();

    return orders.filter((o) => {
      const matchStatus = !statusFilter || o.status === statusFilter;
      if (!query) return matchStatus;

      const idStr = o.id.toLowerCase();
      const statusStr = o.status.toLowerCase();
      const itemsTxt = (o.items || [])
        .map((it) => (it.product?.title || '').toLowerCase())
        .join(' ');

      const hit =
        idStr.includes(query) ||
        statusStr.includes(query) ||
        itemsTxt.includes(query);

      return matchStatus && hit;
    });
  }, [orders, q, statusFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;

    const arr = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'createdAt': {
          const aa = new Date(a.createdAt).getTime();
          const bb = new Date(b.createdAt).getTime();
          return (aa - bb) * dir;
        }
        case 'id': {
          return a.id.localeCompare(b.id) * dir;
        }
        case 'status': {
          return a.status.localeCompare(b.status) * dir;
        }
        case 'items': {
          const aa = (a.items?.reduce((s, x) => s + (x.qty || 0), 0) ?? 0);
          const bb = (b.items?.reduce((s, x) => s + (x.qty || 0), 0) ?? 0);
          return (aa - bb) * dir;
        }
        case 'total': {
          const aa = toNumber(a.total);
          const bb = toNumber(b.total);
          return (aa - bb) * dir;
        }
        default:
          return 0;
      }
    });

    return arr;
  }, [filtered, sortKey, sortDir]);

  // clamp page when filters change
  useEffect(() => setPage(1), [q, statusFilter, sortKey, sortDir, pageSize]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = sorted.slice(start, start + pageSize);

  function toggleSort(col: SortKey) {
    setSortKey((prevKey) => {
      if (prevKey !== col) {
        setSortDir('asc'); // new column -> start asc
        return col;
      }
      // same column -> flip
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return prevKey;
    });
  }

  function sortIcon(col: SortKey) {
    if (col !== sortKey) return '↕';
    return sortDir === 'asc' ? '▲' : '▼';
  }

  // UI helpers
  const StatusBadge = ({ status }: { status: string }) => {
    const s = status.toUpperCase();
    const style =
      s === 'PAID'
        ? 'bg-green-600/10 text-green-700 border-green-600/20'
        : s === 'PENDING'
          ? 'bg-yellow-500/10 text-yellow-700 border-yellow-600/20'
          : s === 'FAILED' || s === 'CANCELED'
            ? 'bg-red-500/10 text-red-700 border-red-600/20'
            : s === 'DELIVERED' || s === 'SHIPPED' || s === 'PROCESSING'
              ? 'bg-blue-600/10 text-blue-700 border-blue-600/20'
              : 'bg-zinc-500/10 text-zinc-700 border-zinc-600/20';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${style}`}>
        {status}
      </span>
    );
  };

  const PaymentBadge = ({ payments }: { payments?: Payment[] }) => {
    if (!payments || !payments.length) return <span className="text-xs opacity-60">—</span>;
    // show the latest payment status (or any PAID)
    const paid = payments.find((p) => p.status === 'PAID');
    const last = payments[payments.length - 1];
    const status = paid ? 'PAID' : (last?.status || 'PENDING');
    const style =
      status === 'PAID'
        ? 'bg-green-600/10 text-green-700 border-green-600/20'
        : status === 'FAILED' || status === 'CANCELED'
          ? 'bg-red-500/10 text-red-700 border-red-600/20'
          : 'bg-yellow-500/10 text-yellow-700 border-yellow-600/20';

    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${style}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary-700">Your Orders</h1>
          <p className="text-sm opacity-70">
            Track purchases, payment status and totals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-md border bg-accent-500 px-3 py-2 text-white hover:bg-accent-600 transition"
            onClick={() => window.location.reload()}
            title="Refresh"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search orders (id, status, product)…"
            className="border rounded px-3 py-2 w-full"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded px-3 py-2 w-full bg-white"
          >
            <option value="">All statuses</option>
            {uniqueStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm opacity-70">Per page</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) as any)}
            className="border rounded px-2 py-2 bg-white"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border rounded-lg bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-primary-600/90 text-white">
            <tr>
              <th
                className="text-left px-3 py-3 cursor-pointer select-none"
                onClick={() => toggleSort('createdAt')}
                title="Sort by date"
              >
                <span className="inline-flex items-center gap-2">
                  Date {sortIcon('createdAt')}
                </span>
              </th>
              <th
                className="text-left px-3 py-3 cursor-pointer select-none"
                onClick={() => toggleSort('id')}
                title="Sort by ID"
              >
                <span className="inline-flex items-center gap-2">
                  Order {sortIcon('id')}
                </span>
              </th>
              <th
                className="text-left px-3 py-3 cursor-pointer select-none"
                onClick={() => toggleSort('status')}
                title="Sort by status"
              >
                <span className="inline-flex items-center gap-2">
                  Status {sortIcon('status')}
                </span>
              </th>
              <th className="text-left px-3 py-3">
                Payment
              </th>
              <th
                className="text-left px-3 py-3 cursor-pointer select-none"
                onClick={() => toggleSort('items')}
                title="Sort by item count"
              >
                <span className="inline-flex items-center gap-2">
                  Items {sortIcon('items')}
                </span>
              </th>
              <th
                className="text-left px-3 py-3 cursor-pointer select-none"
                onClick={() => toggleSort('total')}
                title="Sort by total"
              >
                <span className="inline-flex items-center gap-2">
                  Total {sortIcon('total')}
                </span>
              </th>
              <th className="text-right px-3 py-3">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm opacity-70">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && err && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-red-600">
                  {err}
                </td>
              </tr>
            )}
            {!loading && !err && pageItems.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm opacity-70">
                  No orders found.
                </td>
              </tr>
            )}

            {pageItems.map((o) => {
              const itemCount = o.items?.reduce((s, it) => s + (it.qty || 0), 0) ?? 0;
              const total = ngn.format(toNumber(o.total));
              const city = o.shippingAddress?.city || '';
              const state = o.shippingAddress?.state || '';
              const country = o.shippingAddress?.country || '';

              return (
                <tr key={o.id} className="border-t hover:bg-black/5">
                  <td className="px-3 py-3 align-top">{formatDate(o.createdAt)}</td>
                  <td className="px-3 py-3 align-top">
                    <div className="font-medium">{shortId(o.id)}</div>
                    <div className="text-xs opacity-70">
                      {city || state || country ? [city, state, country].filter(Boolean).join(', ') : '—'}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <PaymentBadge payments={o.payments} />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="font-medium">{itemCount}</div>
                    {!!o.items?.length && (
                      <div className="text-xs opacity-70 line-clamp-2">
                        {o.items
                          .slice(0, 3)
                          .map((it) => it.product?.title)
                          .filter(Boolean)
                          .join(', ')}
                        {o.items.length > 3 ? '…' : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 align-top">{total}</td>
                  <td className="px-3 py-3 align-top text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        className="rounded-md border bg-accent-500 px-3 py-1.5 text-white hover:bg-accent-600 transition"
                        onClick={() => nav(`/orders/${o.id}`)}
                      >
                        View
                      </button>
                      {/* Example extra actions (wire up if your API supports) */}
                      {/* <button className="rounded-md border px-3 py-1.5" onClick={() => cancel(o.id)}>Cancel</button> */}
                      {/* <button className="rounded-md border px-3 py-1.5" onClick={() => nav(`/payment?orderId=${o.id}`)}>Pay</button> */}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {sorted.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm opacity-70">
            Showing {start + 1}-{Math.min(start + pageSize, sorted.length)} of {sorted.length}
          </div>

          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 border rounded disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            >
              Prev
            </button>
            <span className="text-sm">
              Page {currentPage} / {totalPages}
            </span>
            <button
              className="px-3 py-1 border rounded disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
