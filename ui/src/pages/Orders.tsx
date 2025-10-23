// src/pages/Orders.tsx
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import { useAuthStore } from '../store/auth';
import React from 'react';

/* ---------------- Types (loose to match API) ---------------- */
type Role = 'ADMIN' | 'SUPER_ADMIN' | 'SHOPPER' | string;

type OrderItem = {
  id: string;
  productId?: string | null;
  title?: string | null;
  unitPrice?: number | string | null;
  quantity?: number | string | null;
  lineTotal?: number | string | null;
  status?: string | null;
  product?: { title?: string | null } | null;

  // NEW:
  selectedOptions?: Array<{ attribute?: string; value?: string }>;
  variant?: { id: string; sku?: string | null; imagesJson?: string[] | null } | null;
};


type PaymentRow = {
  id: string;
  status: string;
  provider?: string | null;
  reference?: string | null;
  amount?: number | string | null;
  createdAt?: string;
};

type OrderRow = {
  id: string;
  userEmail?: string | null;
  status?: string;
  total?: number | string | null;
  createdAt?: string;
  items?: OrderItem[];
  payment?: PaymentRow | null;
  payments?: PaymentRow[];
};

/* ---------------- Utils ---------------- */
const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});
const fmtN = (n?: number | string | null) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
};
const fmtDate = (s?: string) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(+d)
    ? s
    : d.toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
};

// normalize shapes
function normalizeOrders(payload: any): OrderRow[] {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.orders)) return payload.orders;
  return [];
}

const todayYMD = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

/* ---------------- Page ---------------- */
export default function OrdersPage() {
  const nav = useNavigate();
  const location = useLocation();

  const token = useAuthStore((s) => s.token);
  const storeUser = useAuthStore((s) => s.user);
  const storeRole = (storeUser?.role || '') as Role;

  // role (admin vs shopper)
  const meQ = useQuery({
    queryKey: ['me-min'],
    enabled: !!token && !storeRole,
    queryFn: async () =>
      (await api.get('/api/profile/me', { headers: { Authorization: `Bearer ${token}` } }))
        .data as { role: Role },
    staleTime: 60_000,
  });

  const role: Role = (storeRole || meQ.data?.role || 'SHOPPER') as Role;
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';

  // orders
  const ordersQ = useQuery({
    queryKey: ['orders', isAdmin ? 'admin' : 'mine'],
    enabled: !!token,
    queryFn: async () => {
      const url = isAdmin ? '/api/orders?limit=50' : '/api/orders/mine?limit=50';
      const res = await api.get(url, { headers: { Authorization: `Bearer ${token}` } });
      return normalizeOrders(res.data);
    },
    staleTime: 15_000,
  });

  // open param
  const openId = useMemo(() => new URLSearchParams(location.search).get('open') || '', [location.search]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  useEffect(() => {
    if (openId) setExpandedId(openId);
  }, [openId]);

  if (!token) {
    nav('/login', { replace: true, state: { from: { pathname: '/orders' } } });
    return null;
  }

  const orders = ordersQ.data || [];
  const loading = ordersQ.isLoading;
  const colSpan = isAdmin ? 7 : 8;

  /* ---------------- Filter Bar State ---------------- */
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUNDED'>('ALL');
  const [from, setFrom] = useState(''); // yyyy-mm-dd
  const [to, setTo] = useState('');
  const [minTotal, setMinTotal] = useState('');
  const [maxTotal, setMaxTotal] = useState('');

  const clearFilters = () => {
    setQ('');
    setStatusFilter('ALL');
    setFrom('');
    setTo('');
    setMinTotal('');
    setMaxTotal('');
  };

  /* ---------------- Sorting ---------------- */
  // Put this near the top where SortKey is declared
  type SortKey = 'id' | 'user' | 'items' | 'total' | 'status' | 'date';

  // ⬇️ replace your sort state with a single object
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'date',
    dir: 'desc', // newest first by default
  });

  // single handler that always flips when clicking the same header
  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'date' ? 'desc' : 'asc' }
    );
  };
  const tdy = todayYMD();
  const isTodayActive = from === tdy && to === tdy;

  const toggleToday = () => {
    if (isTodayActive) {
      setFrom('');
      setTo('');
    } else {
      setFrom(tdy);
      setTo(tdy);
    }
  };


  const SortHeader = ({
    label,
    col,
    hidden = false,
  }: {
    label: string;
    col: SortKey;
    hidden?: boolean;
  }) => {
    if (hidden) return <th className="text-left px-3 py-2">{label}</th>;
    const active = sort.key === col;
    return (
      <th className="text-left px-3 py-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleSort(col);
          }}
          className={`inline-flex items-center gap-1 hover:underline ${active ? 'font-semibold' : ''}`}
          title={`Sort by ${label}`}
        >
          <span>{label}</span>
          {active ? <span aria-hidden>{sort.dir === 'asc' ? '▲' : '▼'}</span> : <span className="opacity-40">↕</span>}
        </button>
      </th>
    );
  };

  /* ---------------- Derived: filtered + sorted ---------------- */
  const filteredSorted = useMemo(() => {
    // filter
    const qnorm = q.trim().toLowerCase();
    const dateFrom = from ? new Date(from).getTime() : null;
    // to: include full day
    const dateTo = to ? new Date(to + 'T23:59:59.999Z').getTime() : null;
    const min = minTotal ? Number(minTotal) : null;
    const max = maxTotal ? Number(maxTotal) : null;

    const list = orders.filter((o) => {
      // search in id, userEmail, any item title, or payment reference
      if (qnorm) {
        const pool: string[] = [];
        pool.push(o.id || '');
        if (o.userEmail) pool.push(o.userEmail);
        (o.items || []).forEach((it) => {
          if (it.title) pool.push(String(it.title));
          if (it.product?.title) pool.push(String(it.product.title));
        });
        const latestPayment = (Array.isArray(o.payments) && o.payments[0]) || o.payment;
        if (latestPayment?.reference) pool.push(latestPayment.reference);
        const hit = pool.some((s) => s.toLowerCase().includes(qnorm));
        if (!hit) return false;
      }

      // status
      if (statusFilter !== 'ALL') {
        if (String(o.status || '').toUpperCase() !== statusFilter) return false;
      }

      // date range
      if (from || to) {
        const ts = o.createdAt ? new Date(o.createdAt).getTime() : 0;
        if (dateFrom != null && ts < dateFrom) return false;
        if (dateTo != null && ts > dateTo) return false;
      }

      // total range
      const totalNum = fmtN(o.total);
      if (min != null && totalNum < min) return false;
      if (max != null && totalNum > max) return false;

      return true;
    });

    // sort
    const dir = sort.dir === 'asc' ? 1 : -1;
    const ordered = [...list].sort((a, b) => {
      const s = sort.key;
      if (s === 'date') {
        const av = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bv = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return (av - bv) * dir;
      }
      if (s === 'total') {
        return (fmtN(a.total) - fmtN(b.total)) * dir;
      }
      if (s === 'items') {
        return (((a.items || []).length - (b.items || []).length) || 0) * dir;
      }
      if (s === 'status') {
        return String(a.status || '').localeCompare(String(b.status || ''), undefined, { sensitivity: 'base' }) * dir;
      }
      if (s === 'user') {
        return String(a.userEmail || '').localeCompare(String(b.userEmail || ''), undefined, { sensitivity: 'base' }) * dir;
      }
      // id
      return String(a.id).localeCompare(String(b.id), undefined, { sensitivity: 'base' }) * dir;
    });


    return ordered;
  }, [orders, q, statusFilter, from, to, minTotal, maxTotal, sort.key, sort.dir]);

  // actions
  const onToggle = (id: string) => setExpandedId((curr) => (curr === id ? null : id));
  const onPay = (orderId: string) => nav(`/payment?orderId=${orderId}`);
  const onCancel = async (orderId: string) => {
    try {
      await api.post(
        `/api/admin/orders/${orderId}/cancel`,
        {},
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
      );
      ordersQ.refetch();
      setExpandedId(null);
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Could not cancel order');
    }
  };

  function latestPaymentOf(o: OrderRow): PaymentRow | null {
    const list: PaymentRow[] = Array.isArray(o.payments)
      ? [...o.payments]
      : o.payment
        ? [o.payment]
        : [];

    if (list.length === 0) return null;

    // prefer a PAID payment
    const paid = list.find(p => String(p.status).toUpperCase() === 'PAID');
    if (paid) return paid;

    // else latest by createdAt (desc)
    return list
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
  }

  // inside Orders.tsx (component scope)
  const downloadReceipt = async (reference: string) => {
    try {
      const res = await api.get(`/api/payments/${reference}/receipt.pdf`, {
        responseType: 'blob',
        // api client already sets Authorization, but this is fine too:
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      // open in a new tab:
      const w = window.open(url, '_blank');
      if (!w) {
        // fallback to download if a popup blocker intervenes
        const a = document.createElement('a');
        a.href = url;
        a.download = `receipt-${reference}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      // cleanup later
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Could not download receipt.');
    }
  };


  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-ink">{isAdmin ? 'All Orders' : 'My Orders'}</h1>
        <p className="text-sm text-ink-soft mt-1">
          {isAdmin ? 'Manage all customer orders.' : 'Your recent purchase history.'}
        </p>
      </div>

      {/* ---------------- Filter Bar ---------------- */}
      <div className="mb-4 rounded-2xl border bg-white shadow-sm p-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4">
            <label className="text-xs text-ink-soft">Search</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Order ID, user, item, payment ref…"
              className="w-full border rounded-xl px-3 py-2"
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs text-ink-soft">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full border rounded-xl px-3 py-2"
            >
              <option value="ALL">All</option>
              <option value="PENDING">Pending</option>
              <option value="PAID">Paid</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELED">Canceled</option>
              <option value="REFUNDED">Refunded</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="text-xs text-ink-soft">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full border rounded-xl px-3 py-2"
            />
          </div>

          <div className="md:col-span-3">
            <label className="text-xs text-ink-soft">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full border rounded-xl px-3 py-2"
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs text-ink-soft">Min ₦</label>
            <input
              type="number"
              min={0}
              value={minTotal}
              onChange={(e) => setMinTotal(e.target.value)}
              className="w-full border rounded-xl px-3 py-2"
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs text-ink-soft">Max ₦</label>
            <input
              type="number"
              min={0}
              value={maxTotal}
              onChange={(e) => setMaxTotal(e.target.value)}
              className="w-full border rounded-xl px-3 py-2"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-black/5"
            onClick={() => ordersQ.refetch()}
          >
            Refresh data
          </button>

          <button
            className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-black/5"
            onClick={clearFilters}
          >
            Clear filters
          </button>

          {/* NEW: Today toggle */}
          <button
            type="button"
            aria-pressed={isTodayActive}
            onClick={toggleToday}
            className={`rounded-lg px-3 py-2 text-sm border transition
      ${isTodayActive
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white hover:bg-black/5'}`}
            title="Show only today’s orders"
          >
            Today
          </button>

          <div className="ml-auto text-xs text-ink-soft">
            Showing {filteredSorted.length} of {orders.length}
            {isTodayActive && <span className="ml-2">(today)</span>}
          </div>
        </div>

      </div>

      {/* ---------------- Table ---------------- */}
      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between">
          <div className="text-sm text-ink-soft">
            {loading ? 'Loading…' : `${filteredSorted.length} order${filteredSorted.length === 1 ? '' : 's'}`}
          </div>
          <button
            onClick={() => ordersQ.refetch()}
            className="inline-flex items-center gap-2 rounded-lg border bg-white hover:bg-black/5 px-3 py-2 text-sm"
          >
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-ink">
                <SortHeader label="Order" col="id" />
                {isAdmin && <SortHeader label="User" col="user" />}
                <SortHeader label="Items" col="items" />
                <SortHeader label="Total" col="total" />
                <SortHeader label="Status" col="status" />
                <SortHeader label="Date" col="date" />
                <th className="text-left px-3 py-2">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {loading && (
                <>
                  <SkeletonRow cols={colSpan} />
                  <SkeletonRow cols={colSpan} />
                  <SkeletonRow cols={colSpan} />
                </>
              )}

              {!loading && filteredSorted.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="px-3 py-6 text-center text-zinc-500">
                    No orders match your filters.
                  </td>
                </tr>
              )}

              {!loading &&
                filteredSorted.map((o: OrderRow) => {
                  const isOpen = expandedId === o.id;

                  const latestPayment = latestPaymentOf(o);
                  const paymentId = latestPayment?.id;
                  const canShowReceipt =
                    !!latestPayment?.reference && String(latestPayment.status).toUpperCase() === 'PAID';

                  return (
                    <React.Fragment key={o.id}>
                      <tr

                        className={`hover:bg-black/5 cursor-pointer ${isOpen ? 'bg-amber-50/50' : ''}`}
                        onClick={() => onToggle(o.id)}
                        aria-expanded={isOpen}
                      >
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                              aria-hidden
                            >
                              ▶
                            </span>
                            <span className="font-mono">{o.id}</span>
                          </div>
                        </td>
                        {isAdmin && <td className="px-3 py-3">{o.userEmail || '—'}</td>}
                        <td className="px-3 py-3">
                          {Array.isArray(o.items) && o.items.length > 0 ? (
                            <div className="space-y-1">
                              {o.items.slice(0, 3).map((it) => {
                                const name = (it.title || it.product?.title || '—').toString();
                                const qty = Number(it.quantity ?? 1);
                                const unit = fmtN(it.unitPrice);
                                return (
                                  <div key={it.id} className="text-ink">
                                    <span className="font-medium">{name}</span>
                                    <span className="text-ink-soft">{`  •  ${qty} × ${ngn.format(unit)}`}</span>
                                  </div>
                                );
                              })}
                              {o.items!.length > 3 && (
                                <div className="text-xs text-ink-soft">+ {o.items!.length - 3} more…</div>
                              )}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-3">{ngn.format(fmtN(o.total))}</td>
                        <td className="px-3 py-3">
                          <StatusDot label={o.status || '—'} />
                        </td>
                        <td className="px-3 py-3">{fmtDate(o.createdAt)}</td>
                        <td className="px-3 py-3">
                          {canShowReceipt ? (
                            <div className="flex items-center gap-2">
                              <button
                                className="inline-flex items-center justify-center rounded-xl border bg-white px-3 py-1.5 hover:bg-black/5"
                                onClick={(e) => {
                                  e.stopPropagation(); // don't toggle row
                                  nav(`/receipt/${paymentId}`);
                                }}
                              >
                                View receipt
                              </button>

                              {/* Optional: direct PDF download link */}
                              {<button
                                className="inline-flex items-center justify-center rounded-xl border bg-white px-3 py-1.5 hover:bg-black/5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadReceipt(paymentId!!);
                                }}
                              >
                                Download PDF
                              </button>}
                              {isAdmin && String(o.status).toUpperCase() !== 'PENDING' && (
                                <button
                                  className="inline-flex items-center justify-center rounded-xl border bg-white px-3 py-1.5 hover:bg-black/5"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      await api.post(`/api/admin/orders/${o.id}/notify-suppliers`, {}, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
                                      alert('Notifications (re)triggered.');
                                    } catch (e: any) {
                                      alert(e?.response?.data?.error || 'Could not notify suppliers.');
                                    }
                                  }}
                                >
                                  Notify suppliers
                                </button>
                              )}

                            </div>
                          ) : (
                            <span className="text-xs text-ink-soft">—</span>
                          )}
                        </td>

                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={colSpan} className="p-0">
                            <div className="px-4 md:px-6 py-4 bg-white border-t">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="text-sm">
                                  <div>
                                    <span className="text-ink-soft">Order:</span>{' '}
                                    <span className="font-mono">{o.id}</span>
                                  </div>
                                  <div className="text-ink-soft">
                                    Placed: {fmtDate(o.createdAt)} • Status: <b>{o.status}</b>
                                  </div>
                                  {latestPayment && (
                                    <div className="text-ink-soft">
                                      Payment: <b>{latestPayment.status}</b>
                                      {latestPayment.reference ? (
                                        <>
                                          {' '}
                                          • Ref:{' '}
                                          <span className="font-mono">{latestPayment.reference}</span>
                                        </>
                                      ) : null}
                                      {latestPayment.amount != null ? (
                                        <> • {ngn.format(fmtN(latestPayment.amount))}</>
                                      ) : null}
                                    </div>
                                  )}
                                </div>

                                <div className="flex gap-2">
                                  {String(o.status).toUpperCase() === 'PENDING' && (
                                    <>
                                      <button
                                        className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onPay(o.id);
                                        }}
                                      >
                                        Pay now
                                      </button>
                                      {isAdmin && (
                                        <button
                                          className="rounded-lg border px-4 py-2 hover:bg-black/5"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onCancel(o.id);
                                          }}
                                        >
                                          Cancel order
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>

                              <div className="mt-4 rounded-xl border bg-white overflow-hidden">
                                <table className="w-full text-sm">
                                  <thead className="bg-zinc-50">
                                    <tr>
                                      <th className="text-left px-3 py-2">Item</th>
                                      <th className="text-left px-3 py-2">Qty</th>
                                      <th className="text-left px-3 py-2">Unit</th>
                                      <th className="text-left px-3 py-2">Line total</th>
                                      <th className="text-left px-3 py-2">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                    {(o.items || []).map((it) => {
                                      const name = (it.title || it.product?.title || '—').toString();
                                      const qty = Number(it.quantity ?? 1);
                                      const unit = fmtN(it.unitPrice);
                                      const line = it.lineTotal != null ? fmtN(it.lineTotal) : unit * qty;

                                      return (
                                        <tr key={it.id}>
                                          <td className="px-3 py-2">
                                            <table className="table-fixed">
                                              <tbody>
                                                <tr className="align-top">
                                                  <td className="pr-2">{name}</td>
                                                  {/* either remove the separator or put it in its own cell */}
                                                  <td className="px-2 text-zinc-400">|</td>
                                                  <td className="pl-2">
                                                    {Array.isArray(it.selectedOptions) && it.selectedOptions.length > 0 && (
                                                      <div className="text-xs text-ink-soft mt-0.5">
                                                        {it.selectedOptions
                                                          .map(o => `${o.attribute || ''}: ${o.value || ''}`)
                                                          .filter(Boolean)
                                                          .join(' *** ')}
                                                      </div>
                                                    )}

                                                    {it.variant?.sku && (
                                                      <div className="text-[11px] text-ink-soft mt-0.5">
                                                        SKU: {it.variant.sku}
                                                        {it.variant?.imagesJson?.[0] && (
                                                          <img
                                                            src={it.variant.imagesJson[0]}
                                                            alt=""
                                                            className="mt-2 w-12 h-12 object-cover rounded border"
                                                          />
                                                        )}
                                                      </div>
                                                    )}
                                                  </td>
                                                </tr>
                                              </tbody>
                                            </table>
                                          </td>

                                          <td className="px-3 py-2">{qty}</td>

                                          {/* If you ever see hydration warnings due to Intl spacing, you can wrap with suppressHydrationWarning */}
                                          <td className="px-3 py-2">
                                            <span /* suppressHydrationWarning */>{ngn.format(unit)}</span>
                                          </td>
                                          <td className="px-3 py-2">
                                            <span /* suppressHydrationWarning */>{ngn.format(line)}</span>
                                          </td>

                                          <td className="px-3 py-2">
                                            <span className="text-xs text-ink-soft">{it.status || '—'}</span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>

                                  <tfoot>
                                    <tr className="bg-zinc-50">
                                      <td className="px-3 py-2 font-medium" colSpan={3}>Total</td>
                                      <td className="px-3 py-2 font-semibold">
                                        <span /* suppressHydrationWarning */>{ngn.format(fmtN(o.total))}</span>
                                      </td>
                                      <td />
                                    </tr>
                                  </tfoot>

                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Small bits ---------------- */
function SkeletonRow({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-3 rounded bg-zinc-200" />
        </td>
      ))}
    </tr>
  );
}

function StatusDot({ label }: { label: string }) {
  const s = (label || '').toUpperCase();
  const cls =
    s === 'PAID' || s === 'VERIFIED'
      ? 'bg-emerald-600/10 text-emerald-700 border-emerald-600/20'
      : s === 'PENDING'
        ? 'bg-amber-500/10 text-amber-700 border-amber-600/20'
        : s === 'FAILED' || s === 'CANCELED' || s === 'REJECTED' || s === 'REFUNDED'
          ? 'bg-rose-500/10 text-rose-700 border-rose-600/20'
          : 'bg-zinc-500/10 text-zinc-700 border-zinc-600/20';

  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${cls}`}>{label}</span>;
}
