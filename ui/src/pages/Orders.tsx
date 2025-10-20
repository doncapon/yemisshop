// src/pages/Orders.tsx
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

/* ---------------- Types (loose to match API) ---------------- */
type Role = 'ADMIN' | 'SUPER_ADMIN' | 'SHOPPER' | string;

type OrderItem = {
  id: string;
  productId?: string | null;
  title?: string | null;          // stored on OrderItem (optional)
  unitPrice?: number | string | null;
  quantity?: number | string | null;
  lineTotal?: number | string | null;
  status?: string | null;
  product?: { title?: string | null } | null; // sometimes included by backend
};

type OrderRow = {
  id: string;
  userEmail?: string | null;
  status?: string;
  total?: number | string | null;
  createdAt?: string;
  items?: OrderItem[];
  payment?: {
    id: string;
    status: string;
    provider?: string | null;
    reference?: string | null;
    createdAt?: string;
  } | null;
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

// VERY defensive normalization: array | {data: array} | {orders: array}
function normalizeOrders(payload: any): OrderRow[] {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.orders)) return payload.orders;
  return [];
}

/* ---------------- Page ---------------- */
export default function OrdersPage() {
  const nav = useNavigate();
  const location = useLocation();

  const token = useAuthStore((s) => s.token);
  const storeUser = useAuthStore((s) => s.user);
  const storeRole = (storeUser?.role || '') as Role;

  // If role not in store, fetch profile to decide admin vs shopper list
  const meQ = useQuery({
    queryKey: ['me-min'],
    enabled: !!token && !storeRole,
    queryFn: async () => (await api.get('/api/profile/me', { headers: { Authorization: `Bearer ${token}` } })).data as { role: Role },
    staleTime: 60_000,
  });

  const role: Role = (storeRole || meQ.data?.role || 'SHOPPER') as Role;
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';

  // Fetch orders (admin vs mine)
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

  // open param support e.g. /orders?open=<orderId>
  const openId = useMemo(() => new URLSearchParams(location.search).get('open') || '', [location.search]);

  useEffect(() => {
    if (openId && ordersQ.data && Array.isArray(ordersQ.data)) {
      // no-op: we just ensure data has loaded so UI can reveal the row
    }
  }, [openId, ordersQ.data]);

  if (!token) {
    nav('/login', { replace: true, state: { from: { pathname: '/orders' } } });
    return null;
  }

  const orders = ordersQ.data || []; // normalized array
  const loading = ordersQ.isLoading;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-ink">{isAdmin ? 'All Orders' : 'My Orders'}</h1>
        <p className="text-sm text-ink-soft mt-1">
          {isAdmin ? 'Manage all customer orders.' : 'Your recent purchase history.'}
        </p>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        <div className="px-4 md:px-5 py-3 border-b flex items-center justify-between">
          <div className="text-sm text-ink-soft">
            {loading ? 'Loading…' : `${orders.length} order${orders.length === 1 ? '' : 's'}`}
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
                <th className="text-left px-3 py-2">Order</th>
                {isAdmin && <th className="text-left px-3 py-2">User</th>}
                <th className="text-left px-3 py-2">Items</th>
                <th className="text-left px-3 py-2">Total</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && (
                <>
                  <SkeletonRow cols={isAdmin ? 6 : 5} />
                  <SkeletonRow cols={isAdmin ? 6 : 5} />
                  <SkeletonRow cols={isAdmin ? 6 : 5} />
                </>
              )}

              {!loading && orders.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="px-3 py-6 text-center text-zinc-500">
                    No orders found.
                  </td>
                </tr>
              )}

              {!loading &&
                orders.map((o: OrderRow) => {
                  const isOpen = openId && o.id === openId;
                  return (
                    <tr key={o.id} className={`hover:bg-black/5 ${isOpen ? 'bg-amber-50/60' : ''}`}>
                      <td className="px-3 py-3">
                        <div className="font-mono">{o.id}</div>
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
                            {o.items.length > 3 && (
                              <div className="text-xs text-ink-soft">+ {o.items.length - 3} more…</div>
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
                    </tr>
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
