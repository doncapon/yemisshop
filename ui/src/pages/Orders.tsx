// src/pages/Orders.tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
  status:
    | 'PENDING'
    | 'PAID'
    | 'FAILED'
    | 'CANCELED'
    | 'PROCESSING'
    | 'SHIPPED'
    | 'DELIVERED'
    | string;
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

type SortKey = 'createdAt' | 'id' | 'items' | 'total';
type SortDir = 'asc' | 'desc';

export default function Orders() {
  const nav = useNavigate();
  const token = useAuthStore((s) => s.token);
  const isOrderFullyPaid = (o: Order) => (o.status || '').toUpperCase() === 'PAID';

  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const openId = params.get('open');

  // redirect to login if needed
  useEffect(() => {
    if (!token) nav('/login', { state: { from: { pathname: '/orders' } } });
  }, [token, nav]);

  // raw data
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // table/filters
  const [q, setQ] = useState(''); // text filter
  const [statusFilter, setStatusFilter] = useState<string>(''); // "" = all
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(10);

  // date range filter
  const [fromDate, setFromDate] = useState<string>(''); // yyyy-mm-dd
  const [toDate, setToDate] = useState<string>(''); // yyyy-mm-dd

  // expansion (only one open at a time)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // sorting: keep per-column dir; only one active sort key
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDirs, setSortDirs] = useState<Record<SortKey, SortDir>>({
    createdAt: 'desc', // default newest first
    id: 'asc',
    items: 'asc',
    total: 'asc',
  });

  // load orders (unchanged)
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!token) return;
      setLoading(true);
      setErr(null);
      try {
        const { data } = await api.get('/api/orders/mine', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        if (mounted) setOrders(list);
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
      // status filter
      const matchStatus = !statusFilter || o.status === statusFilter;
      if (!matchStatus) return false;

      // date range filter
      const ts = +new Date(o.createdAt);
      if (fromDate) {
        const fromTs = +new Date(fromDate + 'T00:00:00');
        if (ts < fromTs) return false;
      }
      if (toDate) {
        // include whole "to" day
        const toTs = +new Date(toDate + 'T23:59:59.999');
        if (ts > toTs) return false;
      }

      if (!query) return true;

      const idStr = o.id.toLowerCase();
      const statusStr = o.status.toLowerCase();
      const itemsTxt = (o.items || [])
        .map((it) => (it.product?.title || '').toLowerCase())
        .join(' ');

      const hit =
        idStr.includes(query) ||
        statusStr.includes(query) ||
        itemsTxt.includes(query);

      return hit;
    });
  }, [orders, q, statusFilter, fromDate, toDate]);

  const sorted = useMemo(() => {
    const dir = sortDirs[sortKey] === 'asc' ? 1 : -1;

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
        case 'items': {
          const aa = a.items?.reduce((s, x) => s + (x.qty || 0), 0) ?? 0;
          const bb = b.items?.reduce((s, x) => s + (x.qty || 0), 0) ?? 0;
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
  }, [filtered, sortKey, sortDirs]);

  // clamp page when inputs change
  useEffect(
    () => setPage(1),
    [q, statusFilter, fromDate, toDate, pageSize, sortKey, sortDirs],
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = sorted.slice(start, start + pageSize);

  // sorting UI helpers
  function toggleSort(col: SortKey) {
    // collapse any open detail row when sorting
    setExpandedId(null);

    setSortKey(col);
    setSortDirs((prev) => {
      const next: Record<SortKey, SortDir> = {
        createdAt: 'asc',
        id: 'asc',
        items: 'asc',
        total: 'asc',
      };
      // clicked column toggles; others reset to asc
      next[col] = prev[col] === 'asc' ? 'desc' : 'asc';
      return next;
    });
  }

  function sortIcon(col: SortKey) {
    const dir = sortDirs[col];
    return dir === 'asc' ? '▲' : '▼';
  }

  // expansion toggle (single open)
  function toggleExpand(id: string) {
    setExpandedId((curr) => (curr === id ? null : id));
  }

  // ---- NEW: auto-open an order when coming from ?open=<id> ----
  const [autoOpenDone, setAutoOpenDone] = useState(false);
  useEffect(() => {
    if (!openId || autoOpenDone || !orders.length) return;

    // If current filters would hide it, relax filters; effect will re-run.
    const presentInFiltered = filtered.some((o) => o.id === openId);
    if (!presentInFiltered && (q || statusFilter || fromDate || toDate)) {
      setQ('');
      setStatusFilter('');
      setFromDate('');
      setToDate('');
      return; // wait for next render
    }

    // Find its position in the sorted list and jump to that page
    const idx = sorted.findIndex((o) => o.id === openId);
    if (idx >= 0) {
      const newPage = Math.floor(idx / pageSize) + 1;
      setPage(newPage);
      setExpandedId(openId);
      setAutoOpenDone(true);

      // Scroll into view after paint
      setTimeout(() => {
        const el = document.getElementById(`order-${openId}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
    }
  }, [
    openId,
    autoOpenDone,
    orders.length,
    filtered,
    sorted,
    pageSize,
    q,
    statusFilter,
    fromDate,
    toDate,
  ]);

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
          <p className="text-sm opacity-70">Track purchases, payment status and totals.</p>
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
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
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

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="border rounded px-3 py-2 w-full bg-white"
            aria-label="From date"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="border rounded px-3 py-2 w-full bg-white"
            aria-label="To date"
          />
        </div>

        <div className="flex lg:col-span-4 justify-end">
          <div className="flex items-center gap-2">
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
      </div>

      {/* Table */}
      <div className="overflow-x-auto border rounded-lg bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-primary-600/90 text-white">
            <tr>
              {/* DATE (sortable) */}
              <th
                className="text-left px-3 py-3 cursor-pointer select-none"
                onClick={() => toggleSort('createdAt')}
                title="Sort by date"
              >
                <span className="inline-flex items-center gap-2">
                  Date {sortIcon('createdAt')}
                </span>
              </th>

              {/* ORDER ID (sortable) */}
              <th
                className="text-left px-3 py-3 cursor-pointer select-none"
                onClick={() => toggleSort('id')}
                title="Sort by ID"
              >
                <span className="inline-flex items-center gap-2">
                  Order {sortIcon('id')}
                </span>
              </th>

              {/* STATUS (not sortable) */}
              <th className="text-left px-3 py-3">Status</th>

              {/* PAYMENT (not sortable) */}
              <th className="text-left px-3 py-3">Payment</th>

              {/* ITEMS (sortable) */}
              <th
                className="text-left px-3 py-3 cursor-pointer select-none"
                onClick={() => toggleSort('items')}
                title="Sort by item count"
              >
                <span className="inline-flex items-center gap-2">
                  Items {sortIcon('items')}
                </span>
              </th>

              {/* TOTAL (sortable) */}
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
              const isOpen = expandedId === o.id;
              const itemCount =
                o.items?.reduce((s, it) => s + (it.qty || 0), 0) ?? 0;
              const total = ngn.format(toNumber(o.total));
              const city = o.shippingAddress?.city || '';
              const state = o.shippingAddress?.state || '';
              const country = o.shippingAddress?.country || '';

              return (
                <>
                  <tr
                    key={o.id}
                    id={`order-${o.id}`}
                    className={`border-t hover:bg-black/5 ${isOpen ? 'bg-black/5' : ''}`}
                    onClick={() => toggleExpand(o.id)}
                  >
                    <td className="px-3 py-3 align-top">{formatDate(o.createdAt)}</td>
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium">{shortId(o.id)}</div>
                      <div className="text-xs opacity-70">
                        {city || state || country
                          ? [city, state, country].filter(Boolean).join(', ')
                          : '—'}
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
                        {!isOrderFullyPaid(o) && (
                          <button
                            className="rounded-md border bg-primary-600 px-3 py-1.5 text-white hover:bg-primary-700 transition"
                            onClick={(e) => {
                              e.stopPropagation();
                              nav(`/payment?orderId=${o.id}`);
                            }}
                            title="Pay for this order"
                          >
                            Pay
                          </button>
                        )}
                        <button
                          className="rounded-md border bg-accent-500 px-3 py-1.5 text-white hover:bg-accent-600 transition"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(o.id);
                          }}
                        >
                          {isOpen ? 'Hide' : 'View'}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded area */}
                  {isOpen && (
                    <tr className="bg-black/[0.03]">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="rounded-lg border bg-white">
                          {/* Header row with Close button */}
                          <div className="p-4 border-b flex items-start justify-between gap-4">
                            <div className="grid md:grid-cols-3 gap-4 w-full">
                              <div>
                                <div className="text-xs opacity-70">Order ID</div>
                                <div className="font-mono text-sm">{o.id}</div>
                              </div>
                              <div>
                                <div className="text-xs opacity-70">Created</div>
                                <div className="text-sm">{formatDate(o.createdAt)}</div>
                              </div>
                              <div>
                                <div className="text-xs opacity-70">Status</div>
                                <StatusBadge status={o.status} />
                              </div>
                            </div>
                            <button
                              className="h-9 shrink-0 rounded-md border px-3 text-sm hover:bg-black/5 transition"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedId(null);
                              }}
                              aria-label="Close view"
                              title="Close view"
                            >
                              Close view
                            </button>
                          </div>

                          <div className="grid md:grid-cols-2 gap-4 p-4 border-b">
                            <div>
                              <div className="text-sm font-semibold mb-2">Items</div>
                              <div className="divide-y">
                                {(o.items ?? []).map((it) => (
                                  <div key={it.id} className="py-2 flex items-center justify-between">
                                    <div className="min-w-0">
                                      <div className="text-sm font-medium truncate">
                                        {it.product?.title || 'Untitled'}
                                      </div>
                                      <div className="text-xs opacity-70">Qty: {it.qty}</div>
                                    </div>
                                    <div className="text-sm font-medium">
                                      {ngn.format(toNumber(it.unitPrice) * (it.qty || 0))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div>
                              <div className="text-sm font-semibold mb-2">Summary</div>
                              <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                  <span>Subtotal</span>
                                  <span>
                                    {ngn.format(
                                      toNumber(o.total) - toNumber(o.tax) - toNumber(o.shipping),
                                    )}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Tax</span>
                                  <span>{ngn.format(toNumber(o.tax))}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Shipping</span>
                                  <span>{ngn.format(toNumber(o.shipping))}</span>
                                </div>
                                <div className="border-t pt-2 flex justify-between font-semibold">
                                  <span>Total</span>
                                  <span>{ngn.format(toNumber(o.total))}</span>
                                </div>
                              </div>

                              {/* Only show Pay button if NOT fully paid */}
                              {!isOrderFullyPaid(o) && (
                                <div className="mt-4">
                                  <button
                                    className="rounded-md border bg-primary-600 px-3 py-2 text-white hover:bg-primary-700 transition"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      nav(`/payment?orderId=${o.id}`);
                                    }}
                                  >
                                    Pay for this order
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="p-4">
                            <div className="text-sm font-semibold mb-2">Payments</div>
                            {(() => {
                              const payments = o.payments ?? [];
                              if (payments.length === 0) {
                                return <div className="text-sm opacity-70">No payments yet.</div>;
                              }
                              // pick exactly ONE to show: prefer any PAID, else show latest
                              const paid = payments.find((p) => p.status === 'PAID');
                              const display = paid ?? payments[payments.length - 1];

                              return (
                                <div className="grid md:grid-cols-2 gap-3">
                                  <div key={display.id} className="rounded-md border p-3 bg-white/70">
                                    <div className="flex items-center justify-between">
                                      <div className="text-sm font-medium">
                                        Ref: <span className="font-mono">{display.reference || '—'}</span>
                                      </div>
                                      <PaymentBadge payments={[display]} />
                                    </div>
                                    <div className="mt-1 text-xs opacity-70">
                                      {display.provider || 'PAYSTACK'} • {display.channel || '—'}
                                    </div>
                                    <div className="mt-1 text-xs opacity-70">
                                      {display.createdAt ? formatDate(display.createdAt) : '—'}
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
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
