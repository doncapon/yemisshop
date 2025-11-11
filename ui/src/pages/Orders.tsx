import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import api from '../api/client.js';
import { useAuthStore } from '../store/auth';
import SiteLayout from '../layouts/SiteLayout.js';

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
  chosenSupplierUnitPrice?: number | string | null;
  selectedOptions?: Array<{ attribute?: string; value?: string }>;
  variant?: {
    id: string;
    sku?: string | null;
    imagesJson?: string[] | null;
  } | null;
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
  payment?: PaymentRow | null; // for /mine
  payments?: PaymentRow[]; // for / (admin)
  paidAmount?: number | string | null;
  metrics?: {
    revenue?: number | string | null;
    cogs?: number | string | null;
    profit?: number | string | null;
  };
};

/* ---------------- Utils ---------------- */
const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

const fmtN = (n?: number | string | null) => {
  if (n == null) return 0;
  const v =
    typeof n === 'string'
      ? Number(n.replace(/,/g, '').trim())
      : Number(n);
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

const toYMD = (s?: string) =>
  s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';

/* ---------------- Shared helpers ---------------- */

function isPaidStatus(status?: string | null): boolean {
  const s = String(status || '').toUpperCase();
  return ['PAID', 'VERIFIED', 'SUCCESS', 'SUCCESSFUL', 'COMPLETED'].includes(s);
}

function latestPaymentOf(o: OrderRow): PaymentRow | null {
  const list: PaymentRow[] = Array.isArray(o.payments)
    ? [...o.payments]
    : o.payment
    ? [o.payment]
    : [];

  if (list.length === 0) return null;

  const paid = list.find((p) => isPaidStatus(p.status));
  if (paid) return paid;

  return list
    .slice()
    .sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime(),
    )[0];
}

function receiptKeyFromPayment(p?: PaymentRow | null): string | null {
  if (!p) return null;
  const ref = (p.reference || '').toString().trim();
  if (ref) return ref;
  const id = (p.id || '').toString().trim();
  return id || null;
}

// Sum item lines (uses lineTotal when present; else unitPrice * quantity)
function sumItemLines(o: OrderRow): number {
  return (o.items ?? []).reduce((s, it) => {
    const qty = Number(it.quantity ?? 1);
    const line =
      it.lineTotal != null
        ? fmtN(it.lineTotal)
        : fmtN(it.unitPrice) * qty;
    return s + (Number.isFinite(line) ? line : 0);
  }, 0);
}

function orderServiceFee(o: OrderRow): number {
  const base = fmtN((o as any).serviceFeeBase);
  const comms = fmtN((o as any).serviceFeeComms);
  const gateway = fmtN((o as any).serviceFeeGateway);
  const totalField = fmtN((o as any).serviceFeeTotal);
  const legacy = fmtN((o as any).serviceFee);
  const legacyCommsTotal = fmtN(
    (o as any).commsTotal ?? (o as any).comms,
  );

  if (totalField > 0) return totalField;

  const compSum = base + comms + gateway;
  if (compSum > 0) return compSum;

  if (legacy > 0) return legacy;
  if (legacyCommsTotal > 0) return legacyCommsTotal;

  let margin = 0;
  for (const it of o.items || []) {
    const qty = Number(it.quantity ?? 1);
    const customer = fmtN(it.unitPrice ?? it.lineTotal);
    const supplier = fmtN(it.chosenSupplierUnitPrice);
    if (qty > 0 && customer > 0 && supplier > 0) {
      const diff = (customer - supplier) * qty;
      if (diff > 0) margin += diff;
    }
  }
  if (margin > 0) return margin;

  const total = fmtN(o.total);
  const tax = fmtN((o as any).tax);
  const shipping = fmtN((o as any).shipping);
  const items = sumItemLines(o);
  const approx = total - items - tax - shipping;
  return approx > 0 ? approx : 0;
}

/* ---------------- Pagination UI ---------------- */

const PAGE_SIZE = 10;

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const go = (p: number) => {
    if (p < 1 || p > totalPages || p === page) return;
    onChange(p);
  };

  const pages: number[] = [];
  const maxButtons = 5;
  let start = Math.max(1, page - 2);
  let end = Math.min(totalPages, start + maxButtons - 1);
  if (end - start + 1 < maxButtons) {
    start = Math.max(1, end - maxButtons + 1);
  }
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="mt-3 flex items-center justify-center gap-1 md:gap-2">
      <button
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        className="px-2 py-1 md:px-3 md:py-1.5 text-[10px] md:text-xs rounded-lg border bg-white disabled:opacity-40"
      >
        Prev
      </button>

      {start > 1 && (
        <>
          <button
            onClick={() => go(1)}
            className={`px-2 py-1 md:px-3 md:py-1.5 text-[10px] md:text-xs rounded-lg border ${
              page === 1
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white'
            }`}
          >
            1
          </button>
          {start > 2 && (
            <span className="px-1 text-[9px] md:text-xs text-ink-soft">
              …
            </span>
          )}
        </>
      )}

      {pages.map((p) => (
        <button
          key={p}
          onClick={() => go(p)}
          className={`px-2 py-1 md:px-3 md:py-1.5 text-[10px] md:text-xs rounded-lg border ${
            p === page
              ? 'bg-zinc-900 text-white border-zinc-900'
              : 'bg-white hover:bg-black/5'
          }`}
        >
          {p}
        </button>
      ))}

      {end < totalPages && (
        <>
          {end < totalPages - 1 && (
            <span className="px-1 text-[9px] md:text-xs text-ink-soft">
              …
            </span>
          )}
          <button
            onClick={() => go(totalPages)}
            className={`px-2 py-1 md:px-3 md:py-1.5 text-[10px] md:text-xs rounded-lg border ${
              page === totalPages
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white'
            }`}
          >
            {totalPages}
          </button>
        </>
      )}

      <button
        onClick={() => go(page + 1)}
        disabled={page >= totalPages}
        className="px-2 py-1 md:px-3 md:py-1.5 text-[10px] md:text-xs rounded-lg border bg-white disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

/* ---------------- Page ---------------- */
export default function OrdersPage() {
  const nav = useNavigate();
  const location = useLocation();

  const token = useAuthStore((s) => s.token);
  const storeUser = useAuthStore((s) => s.user);
  const storeRole = (storeUser?.role || '') as Role;

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  /* ----- Role ----- */
  const meQ = useQuery({
    queryKey: ['me-min'],
    enabled: !!token && !storeRole,
    queryFn: async () =>
      (
        await api.get('/api/profile/me', {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).data as { role: Role },
    staleTime: 60_000,
  });

  const role: Role = (storeRole || meQ.data?.role || 'SHOPPER') as Role;
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const isMetricsRole = isAdmin;

  /* ----- Orders ----- */
  const ordersQ = useQuery({
    queryKey: ['orders', isAdmin ? 'admin' : 'mine'],
    enabled: !!token,
    queryFn: async () => {
      const url = isAdmin
        ? '/api/orders?limit=50'
        : '/api/orders/mine?limit=50';
      const res = await api.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return normalizeOrders(res.data);
    },
    staleTime: 15_000,
  });

  const orders = ordersQ.data || [];
  const loading = ordersQ.isLoading;
  const colSpan = isAdmin ? 7 : 6;

  // expanded row from ?open=
  const openId = useMemo(
    () => new URLSearchParams(location.search).get('open') || '',
    [location.search],
  );
  useEffect(() => {
    if (openId) setExpandedId(openId);
  }, [openId]);

  if (!token) {
    nav('/login', {
      replace: true,
      state: { from: { pathname: '/orders' } },
    });
    return null;
  }

  /* ---------------- Filter Bar State ---------------- */
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] =
    useState<'ALL' | 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUNDED'>(
      'ALL',
    );
  const [from, setFrom] = useState('');
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
  type SortKey = 'id' | 'user' | 'items' | 'total' | 'status' | 'date';

  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'date',
    dir: 'desc',
  });

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'date' ? 'desc' : 'asc' },
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
          className={`inline-flex items-center gap-1 hover:underline ${
            active ? 'font-semibold' : ''
          }`}
          title={`Sort by ${label}`}
        >
          <span>{label}</span>
          {active ? (
            <span aria-hidden>{sort.dir === 'asc' ? '▲' : '▼'}</span>
          ) : (
            <span className="opacity-40">↕</span>
          )}
        </button>
      </th>
    );
  };

  /* ---------------- Derived: filtered + sorted ---------------- */
  const filteredSorted = useMemo(() => {
    const qnorm = q.trim().toLowerCase();
    const dateFrom = from ? new Date(from).getTime() : null;
    const dateTo = to
      ? new Date(to + 'T23:59:59.999Z').getTime()
      : null;
    const min = minTotal ? Number(minTotal) : null;
    const max = maxTotal ? Number(maxTotal) : null;

    const list = orders.filter((o) => {
      if (qnorm) {
        const pool: string[] = [];
        pool.push(o.id || '');
        if (o.userEmail) pool.push(o.userEmail);
        (o.items || []).forEach((it) => {
          if (it.title) pool.push(String(it.title));
          if (it.product?.title) pool.push(String(it.product.title));
        });
        const lp =
          (Array.isArray(o.payments) && o.payments[0]) || o.payment;
        if (lp?.reference) pool.push(lp.reference);
        const hit = pool.some((s) =>
          s.toLowerCase().includes(qnorm),
        );
        if (!hit) return false;
      }

      if (statusFilter !== 'ALL') {
        if (String(o.status || '').toUpperCase() !== statusFilter)
          return false;
      }

      if (from || to) {
        const ts = o.createdAt
          ? new Date(o.createdAt).getTime()
          : 0;
        if (dateFrom != null && ts < dateFrom) return false;
        if (dateTo != null && ts > dateTo) return false;
      }

      const totalNum = fmtN(o.total);
      if (min != null && totalNum < min) return false;
      if (max != null && totalNum > max) return false;

      return true;
    });

    const dir = sort.dir === 'asc' ? 1 : -1;
    const ordered = [...list].sort((a, b) => {
      const s = sort.key;
      if (s === 'date') {
        const av = a.createdAt
          ? new Date(a.createdAt).getTime()
          : 0;
        const bv = b.createdAt
          ? new Date(b.createdAt).getTime()
          : 0;
        return (av - bv) * dir;
      }
      if (s === 'total') {
        return (fmtN(a.total) - fmtN(b.total)) * dir;
      }
      if (s === 'items') {
        return (
          ((a.items || []).length -
            (b.items || []).length || 0) * dir
        );
      }
      if (s === 'status') {
        return (
          String(a.status || '').localeCompare(
            String(b.status || ''),
            undefined,
            { sensitivity: 'base' },
          ) * dir
        );
      }
      if (s === 'user') {
        return (
          String(a.userEmail || '').localeCompare(
            String(b.userEmail || ''),
            undefined,
            { sensitivity: 'base' },
          ) * dir
        );
      }
      return (
        String(a.id).localeCompare(String(b.id), undefined, {
          sensitivity: 'base',
        }) * dir
      );
    });

    return ordered;
  }, [
    orders,
    q,
    statusFilter,
    from,
    to,
    minTotal,
    maxTotal,
    sort.key,
    sort.dir,
  ]);

  /* Reset page when filters / sort / data change */
  useEffect(() => {
    setPage(1);
  }, [
    orders.length,
    q,
    statusFilter,
    from,
    to,
    minTotal,
    maxTotal,
    sort.key,
    sort.dir,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredSorted.length / PAGE_SIZE),
  );
  const currentPage = Math.min(page, totalPages);
  const pageStart =
    filteredSorted.length === 0
      ? 0
      : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd =
    filteredSorted.length === 0
      ? 0
      : Math.min(
          filteredSorted.length,
          (currentPage - 1) * PAGE_SIZE + PAGE_SIZE,
        );

  const paginated = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredSorted.slice(start, start + PAGE_SIZE);
  }, [filteredSorted, currentPage]);

  /* ---------------- Filter content (shared desktop + drawer) ---------------- */

  const FilterContent = (
    <>
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

        <button
          type="button"
          aria-pressed={isTodayActive}
          onClick={toggleToday}
          className={`rounded-lg px-3 py-2 text-sm border transition ${
            isTodayActive
              ? 'bg-zinc-900 text-white border-zinc-900'
              : 'bg-white hover:bg-black/5'
          }`}
        >
          Today
        </button>

        <div className="ml-auto text-xs text-ink-soft">
          {filteredSorted.length > 0 ? (
            <>
              Showing {pageStart}-{pageEnd} of {filteredSorted.length}
            </>
          ) : (
            'No matching orders'
          )}
          {isTodayActive && filteredSorted.length > 0 && (
            <span className="ml-2">(today)</span>
          )}
        </div>
      </div>
    </>
  );

  /* ---------------- Metrics: revenue + gross profit ---------------- */

  const profitRangeQ = useQuery({
    queryKey: [
      'metrics',
      'profit-summary',
      { from: toYMD(from), to: toYMD(to) },
    ],
    enabled: isMetricsRole,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (toYMD(from)) params.set('from', toYMD(from)!);
      if (toYMD(to)) params.set('to', toYMD(to)!);
      const { data } = await api.get(
        `/api/admin/metrics/profit-summary${
          params.toString() ? `?${params.toString()}` : ''
        }`,
      );
      return data as {
        profitSum: number | string;
        profitToday: number | string;
        eventsCount: number;
        range: { from: string; to: string };
      };
    },
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  });

  const aggregates = useMemo(() => {
    if (!isMetricsRole) return null;

    let revenuePaid = 0;
    let refunds = 0;

    for (const o of filteredSorted) {
      const metricsRevenue = fmtN(o.metrics?.revenue);
      const paidAmount = fmtN(o.paidAmount);

      if (metricsRevenue > 0) {
        revenuePaid += metricsRevenue;
      } else if (paidAmount > 0) {
        revenuePaid += paidAmount;
      }
    }

    const revenueNet = revenuePaid - refunds;
    return { revenuePaid, refunds, revenueNet };
  }, [filteredSorted, isMetricsRole]);

  const grossProfit = useMemo(() => {
    if (!isMetricsRole) return 0;

    const apiRes: any = profitRangeQ.data;

    if (apiRes) {
      const candidates = [
        apiRes.grossProfit,
        apiRes.profitSum,
        apiRes.profitToday,
      ];
      for (const v of candidates) {
        const n = fmtN(v);
        if (n !== 0) return n;
      }
    }

    let acc = 0;
    for (const o of filteredSorted) {
      const realized =
        isPaidStatus(o.status) || fmtN(o.paidAmount) > 0;
      if (!realized) continue;
      const svc = orderServiceFee(o);
      if (svc > 0) acc += svc;
    }

    return acc;
  }, [isMetricsRole, profitRangeQ.data, filteredSorted]);

  /* ---------------- Actions ---------------- */
  const onToggle = (id: string) =>
    setExpandedId((curr) => (curr === id ? null : id));

  const onPay = (orderId: string) =>
    nav(`/payment?orderId=${orderId}`);

  const onCancel = async (orderId: string) => {
    try {
      await api.post(
        `/api/admin/orders/${orderId}/cancel`,
        {},
        {
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        },
      );
      ordersQ.refetch();
      setExpandedId(null);
    } catch (e: any) {
      alert(
        e?.response?.data?.error ||
          'Could not cancel order',
      );
    }
  };

  const viewReceipt = (key: string) => {
    nav(`/receipt/${encodeURIComponent(key)}`);
  };

  const downloadReceipt = async (key: string) => {
    try {
      const res = await api.get(
        `/api/payments/${encodeURIComponent(
          key,
        )}/receipt.pdf`,
        {
          responseType: 'blob',
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        },
      );

      const blob = new Blob([res.data], {
        type: 'application/pdf',
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${key}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(
        () => URL.revokeObjectURL(url),
        60_000,
      );
    } catch (e: any) {
      alert(
        e?.response?.data?.error ||
          'Could not download receipt.',
      );
    }
  };

  const printReceipt = async (key: string) => {
    try {
      const res = await api.get(
        `/api/payments/${encodeURIComponent(
          key,
        )}/receipt.pdf`,
        {
          responseType: 'blob',
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        },
      );

      const blob = new Blob([res.data], {
        type: 'application/pdf',
      });
      const url = URL.createObjectURL(blob);

      const w = window.open(url, '_blank');
      if (w) {
        const onLoad = () => {
          try {
            w.focus();
            w.print();
          } catch {
            // ignore
          }
        };
        w.addEventListener('load', onLoad, {
          once: true,
        });
      }

      setTimeout(
        () => URL.revokeObjectURL(url),
        60_000,
      );
    } catch (e: any) {
      alert(
        e?.response?.data?.error ||
          'Could not open receipt for print.',
      );
    }
  };

  /* ---------------- Render ---------------- */
  return (
    <SiteLayout>
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
        {/* Header + mobile actions */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold text-ink">
              {isAdmin ? 'All Orders' : 'My Orders'}
            </h1>
            <p className="text-sm text-ink-soft mt-1">
              {isAdmin
                ? 'Manage all customer orders.'
                : 'Your recent purchase history.'}
            </p>
          </div>

          {/* Mobile-only: filter toggle + refresh */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              onClick={() => setFiltersOpen(true)}
              className="rounded-xl border px-3 py-2 text-xs bg-white shadow-sm"
            >
              Filters
            </button>
            <button
              onClick={() => ordersQ.refetch()}
              className="rounded-xl border px-3 py-2 text-xs bg-white shadow-sm"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Desktop Filters */}
        <div className="mb-4 rounded-2xl border bg-white shadow-sm p-4 hidden md:block">
          {FilterContent}
        </div>

        {/* Mobile Filter Drawer */}
        {filtersOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setFiltersOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-[80%] max-w-xs bg-white shadow-2xl p-4 transform transition-transform duration-200 translate-x-0">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">
                  Filter orders
                </h2>
                <button
                  onClick={() => setFiltersOpen(false)}
                  className="text-xs text-ink-soft px-2 py-1 rounded-lg hover:bg-black/5"
                >
                  Close
                </button>
              </div>
              <div className="space-y-3 text-sm">
                {FilterContent}
              </div>
            </div>
          </div>
        )}

        {/* Metrics (admin roles) */}
        {isMetricsRole && aggregates && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl border p-3 bg-white">
              <div className="text-ink-soft">Revenue (net)</div>
              <div className="font-semibold">
                {ngn.format(aggregates.revenueNet)}
              </div>
              <div className="text-[11px] text-ink-soft">
                Paid {ngn.format(aggregates.revenuePaid)} • Refunds{' '}
                {ngn.format(aggregates.refunds)}
              </div>
            </div>
            <div className="rounded-xl border p-3 bg-white">
              <div className="text-ink-soft">Gross Profit</div>
              <div className="font-semibold">
                {ngn.format(grossProfit)}
              </div>
            </div>
          </div>
        )}

        {/* Desktop Orders table */}
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden mt-4 hidden md:block">
          <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between">
            <div className="text-sm text-ink-soft">
              {loading
                ? 'Loading…'
                : filteredSorted.length
                ? `Showing ${pageStart}-${pageEnd} of ${filteredSorted.length} orders`
                : 'No orders match your filters.'}
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
                  {isAdmin && (
                    <SortHeader label="User" col="user" />
                  )}
                  <SortHeader label="Items" col="items" />
                  <SortHeader label="Total" col="total" />
                  <SortHeader label="Status" col="status" />
                  <SortHeader label="Date" col="date" />
                  <th className="text-left px-3 py-2">
                    Actions
                  </th>
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

                {!loading &&
                  paginated.length === 0 && (
                    <tr>
                      <td
                        colSpan={colSpan}
                        className="px-3 py-6 text-center text-zinc-500"
                      >
                        No orders match your
                        filters.
                      </td>
                    </tr>
                  )}

                {!loading &&
                  paginated.map((o) => {
                    const isOpen =
                      expandedId === o.id;

                    const latestPayment =
                      latestPaymentOf(o);
                    const receiptKey =
                      receiptKeyFromPayment(
                        latestPayment,
                      );

                    const isPaidOrder =
                      isPaidStatus(
                        o.status,
                      );
                    const isPaidPayment =
                      isPaidStatus(
                        latestPayment?.status,
                      );
                    const isPaidEffective =
                      isPaidOrder ||
                      isPaidPayment;

                    const isPendingOrCreated =
                      !isPaidEffective &&
                      ['PENDING', 'CREATED'].includes(
                        String(
                          o.status ||
                            '',
                        ).toUpperCase(),
                      );

                    const canShowReceipt =
                      !!receiptKey &&
                      isPaidEffective;

                    const viewBtnClass =
                      isPaidEffective
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                        : isPendingOrCreated
                        ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                        : 'bg-white hover:bg-black/5 text-ink-soft';

                    return (
                      <React.Fragment
                        key={
                          o.id
                        }
                      >
                        <tr
                          className={`hover:bg-black/5 cursor-pointer ${
                            isOpen
                              ? 'bg-amber-50/50'
                              : ''
                          }`}
                          onClick={() =>
                            onToggle(
                              o.id,
                            )
                          }
                          aria-expanded={
                            isOpen
                          }
                        >
                          {/* Order ID */}
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-block w-4 transition-transform ${
                                  isOpen
                                    ? 'rotate-90'
                                    : ''
                                }`}
                                aria-hidden
                              >
                                ▶
                              </span>
                              <span className="font-mono">
                                {o.id}
                              </span>
                            </div>
                          </td>

                          {/* User */}
                          {isAdmin && (
                            <td className="px-3 py-3">
                              {o.userEmail ||
                                '—'}
                            </td>
                          )}

                          {/* Items summary */}
                          <td className="px-3 py-3">
                            {Array.isArray(
                              o.items,
                            ) &&
                            o.items
                              .length >
                              0 ? (
                              <div className="space-y-1">
                                {o.items
                                  .slice(
                                    0,
                                    3,
                                  )
                                  .map(
                                    (
                                      it,
                                    ) => {
                                      const name =
                                        (
                                          it.title ||
                                          it
                                            .product
                                            ?.title ||
                                          '—'
                                        ).toString();
                                      const qty =
                                        Number(
                                          it.quantity ??
                                            1,
                                        );
                                      const unit =
                                        fmtN(
                                          it.unitPrice,
                                        );
                                      return (
                                        <div
                                          key={
                                            it.id
                                          }
                                          className="text-ink"
                                        >
                                          <span className="font-medium">
                                            {
                                              name
                                            }
                                          </span>
                                          <span className="text-ink-soft">
                                            {`  •  ${qty} × ${ngn.format(
                                              unit,
                                            )}`}
                                          </span>
                                        </div>
                                      );
                                    },
                                  )}
                                {o.items
                                  .length >
                                  3 && (
                                  <div className="text-xs text-ink-soft">
                                    +{' '}
                                    {o
                                      .items!
                                      .length -
                                      3}{' '}
                                    more…
                                  </div>
                                )}
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>

                          {/* Total */}
                          <td className="px-3 py-3">
                            {ngn.format(
                              fmtN(
                                o.total,
                              ),
                            )}
                          </td>

                          {/* Status */}
                          <td className="px-3 py-3">
                            <StatusDot
                              label={
                                o.status ||
                                '—'
                              }
                            />
                          </td>

                          {/* Date */}
                          <td className="px-3 py-3">
                            {fmtDate(
                              o.createdAt,
                            )}
                          </td>

                          {/* Toggle */}
                          <td className="px-3 py-3">
                            <button
                              className={`inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs ${viewBtnClass}`}
                              onClick={(
                                e,
                              ) => {
                                e.stopPropagation();
                                onToggle(
                                  o.id,
                                );
                              }}
                            >
                              {isOpen
                                ? 'Hide details'
                                : 'View details'}
                            </button>
                          </td>
                        </tr>

                        {/* Expanded */}
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
                                      Placed: {fmtDate(o.createdAt)} • Status:{' '}
                                      <b>{o.status}</b>
                                    </div>
                                    {latestPayment && (
                                      <div className="text-ink-soft">
                                        Payment: <b>{latestPayment.status}</b>
                                        {latestPayment.reference && (
                                          <>
                                            {' '}• Ref:{' '}
                                            <span className="font-mono">
                                              {latestPayment.reference}
                                            </span>
                                          </>
                                        )}
                                        {latestPayment.amount != null && (
                                          <>
                                            {' '}•{' '}
                                            {ngn.format(fmtN(latestPayment.amount))}
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex flex-wrap gap-2">
                                    {isPendingOrCreated && (
                                      <>
                                        <button
                                          className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-xs md:text-sm hover:bg-emerald-700"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onPay(o.id);
                                          }}
                                        >
                                          Pay now
                                        </button>
                                        {isAdmin && (
                                          <button
                                            className="rounded-lg border px-4 py-2 text-xs md:text-sm hover:bg-black/5"
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

                                    {canShowReceipt && (
                                      <>
                                        <button
                                          className="inline-flex items-center justify-center rounded-lg border bg-white px-3 py-2 text-xs md:text-sm hover:bg-black/5"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!receiptKey) return;
                                            viewReceipt(receiptKey);
                                          }}
                                        >
                                          View receipt
                                        </button>

                                        <button
                                          className="inline-flex items-center justify-center rounded-lg border bg-white px-3 py-2 text-xs md:text-sm hover:bg-black/5"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!receiptKey) return;
                                            downloadReceipt(receiptKey);
                                          }}
                                        >
                                          Download PDF
                                        </button>

                                        <button
                                          className="inline-flex items-center justify-center rounded-lg border bg-white px-3 py-2 text-xs md:text-sm hover:bg-black/5"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!receiptKey) return;
                                            printReceipt(receiptKey);
                                          }}
                                        >
                                          Print
                                        </button>
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
                                        const name = (
                                          it.title ||
                                          it.product?.title ||
                                          '—'
                                        ).toString();
                                        const qty = Number(it.quantity ?? 1);
                                        const unit = fmtN(it.unitPrice);
                                        const line =
                                          it.lineTotal != null
                                            ? fmtN(it.lineTotal)
                                            : unit * qty;

                                        return (
                                          <tr key={it.id}>
                                            <td className="px-3 py-2">
                                              <table className="table-fixed">
                                                <tbody>
                                                  <tr className="align-top">
                                                    <td className="pr-2">
                                                      {name}
                                                    </td>
                                                    <td className="px-2 text-zinc-400">
                                                      |
                                                    </td>
                                                    <td className="pl-2">
                                                      {Array.isArray(it.selectedOptions) &&
                                                        it.selectedOptions.length > 0 && (
                                                          <div className="text-xs text-ink-soft mt-0.5">
                                                            {it.selectedOptions
                                                              .map((o) =>
                                                                `${o.attribute || ''}: ${o.value || ''}`,
                                                              )
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

                                            <td className="px-3 py-2">
                                              {qty}
                                            </td>

                                            <td className="px-3 py-2">
                                              {ngn.format(unit)}
                                            </td>

                                            <td className="px-3 py-2">
                                              {ngn.format(line)}
                                            </td>

                                            <td className="px-3 py-2">
                                              <span className="text-xs text-ink-soft">
                                                {it.status || '—'}
                                              </span>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>

                                    <tfoot>
                                      <tr className="bg-zinc-50">
                                        <td
                                          className="px-3 py-2 font-medium"
                                          colSpan={2}
                                        >
                                          Total
                                        </td>
                                        <td className="px-3 py-2">
                                          <div className="flex items-center justify-between text-sm">
                                            <span className="text-ink-soft">
                                              Service fee
                                            </span>
                                            <span className="font-medium">
                                              {ngn.format(orderServiceFee(o))}
                                            </span>
                                          </div>
                                        </td>
                                        <td className="px-3 py-2 font-semibold">
                                          {ngn.format(fmtN(o.total))}
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

          {/* Desktop Pagination */}
          <div className="px-4 md:px-5 pb-4">
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              onChange={(p) => {
                setExpandedId(null);
                setPage(p);
              }}
            />
          </div>
        </div>

        {/* Mobile Orders list (cards, no horizontal scroll) */}
        <div className="mt-4 space-y-3 md:hidden">
          {loading && (
            <>
              <SkeletonRow cols={1} />
              <SkeletonRow cols={1} />
              <SkeletonRow cols={1} />
            </>
          )}

          {!loading && paginated.length === 0 && (
            <div className="rounded-2xl border bg-white py-6 px-4 text-center text-zinc-500">
              No orders match your filters.
            </div>
          )}

          {!loading &&
            paginated.map((o) => {
              const latestPayment = latestPaymentOf(o);
              const receiptKey = receiptKeyFromPayment(latestPayment);

              const isPaidOrder = isPaidStatus(o.status);
              const isPaidPayment = isPaidStatus(latestPayment?.status);
              const isPaidEffective = isPaidOrder || isPaidPayment;

              const isPendingOrCreated =
                !isPaidEffective &&
                ['PENDING', 'CREATED'].includes(
                  String(o.status || '').toUpperCase(),
                );
              const canShowReceipt = !!receiptKey && isPaidEffective;

              const firstItemTitle =
                o.items?.[0]?.title ||
                o.items?.[0]?.product?.title ||
                '';

              return (
                <div
                  key={o.id}
                  className="rounded-2xl border bg-white shadow-sm p-3 flex flex-col gap-2"
                  onClick={() =>
                    setExpandedId((curr) => (curr === o.id ? null : o.id))
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] text-ink-soft">
                        Order ID
                      </div>
                      <div className="font-mono text-xs">
                        {o.id}
                      </div>
                    </div>
                    <StatusDot label={o.status || '—'} />
                  </div>

                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex-1">
                      <div className="text-xs text-ink-soft">
                        {firstItemTitle
                          ? firstItemTitle.toString().slice(0, 40) +
                            (o.items && o.items.length > 1
                              ? ` +${o.items.length - 1} more`
                              : '')
                          : `${o.items?.length || 0} item(s)`}
                      </div>
                      <div className="text-[10px] text-ink-soft">
                        Placed {fmtDate(o.createdAt)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-ink-soft">
                        Total
                      </div>
                      <div className="font-semibold text-sm">
                        {ngn.format(fmtN(o.total))}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {isPendingOrCreated && (
                      <button
                        className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-[10px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPay(o.id);
                        }}
                      >
                        Pay now
                      </button>
                    )}

                    {canShowReceipt && (
                      <button
                        className="rounded-lg border px-3 py-1.5 text-[10px] bg-white"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!receiptKey) return;
                          viewReceipt(receiptKey);
                        }}
                      >
                        View receipt
                      </button>
                    )}

                    {isAdmin && isPendingOrCreated && (
                      <button
                        className="rounded-lg border px-3 py-1.5 text-[10px] text-rose-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCancel(o.id);
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  {expandedId === o.id && (
                    <div className="mt-2 border-t pt-2 space-y-1">
                      {(o.items || []).slice(0, 5).map((it) => (
                        <div
                          key={it.id}
                          className="flex justify-between text-[10px] text-ink-soft"
                        >
                          <span>
                            {(it.title ||
                              it.product?.title ||
                              '—'
                            ).toString()}
                            {it.quantity && (
                              <span>{` • ${it.quantity} pcs`}</span>
                            )}
                          </span>
                          <span>
                            {ngn.format(
                              it.lineTotal != null
                                ? fmtN(it.lineTotal)
                                : fmtN(it.unitPrice) *
                                  Number(it.quantity ?? 1),
                            )}
                          </span>
                        </div>
                      ))}
                      {o.items && o.items.length > 5 && (
                        <div className="text-[9px] text-ink-soft">
                          + {o.items.length - 5} more items
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

          {/* Mobile Pagination (compact) */}
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onChange={(p) => {
              setExpandedId(null);
              setPage(p);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </div>
      </div>
    </SiteLayout>
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
      : s === 'FAILED' ||
        s === 'CANCELED' ||
        s === 'REJECTED' ||
        s === 'REFUNDED'
      ? 'bg-rose-500/10 text-rose-700 border-rose-600/20'
      : 'bg-zinc-500/10 text-zinc-700 border-zinc-600/20';

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${cls}`}
    >
      {label}
    </span>
  );
}
