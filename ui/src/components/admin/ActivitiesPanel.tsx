// src/components/admin/ActivitiesPanel.tsx
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchActivities } from '../../api/adminActivities';
import { useAuthStore } from '../../store/auth';
import { useNavigate } from 'react-router-dom';

const fmt = (d: string) => new Date(d).toLocaleString();

export default function ActivitiesPanel() {
    const token = useAuthStore((s) => s.token);
    const [q, setQ] = useState('');
    const [type, setType] = useState('');
    const [page, setPage] = useState(1);

    const { data, isLoading, error } = useQuery({
        queryKey: ['admin', 'order-activities', { q, type, page }],
        queryFn: () => fetchActivities({ q: q || undefined, type: type || undefined, page, pageSize: 50 }, token),
        enabled: !!token,
        staleTime: 10_000,
    });

    const items = data?.data ?? [];
    const totalPages = data?.totalPages ?? 1;
    const nav = useNavigate();

    return (
        <section className="rounded-2xl border bg-white p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
                <input
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setPage(1); }}
                    placeholder="Search (order id, type, message)"
                    className="border rounded px-3 py-2 w-64"
                />
                <select
                    value={type}
                    onChange={(e) => { setType(e.target.value); setPage(1); }}
                    className="border rounded px-3 py-2"
                >
                    <option value="">All types</option>
                    <option value="ORDER_CREATED">ORDER_CREATED</option>
                    <option value="STATUS_CHANGE">STATUS_CHANGE</option>
                    <option value="PAYMENT_INIT">PAYMENT_INIT</option>
                    <option value="PAYMENT_PAID">PAYMENT_PAID</option>
                    <option value="PAYMENT_FAILED">PAYMENT_FAILED</option>
                    <option value="PAYMENT_REFUNDED">PAYMENT_REFUNDED</option>
                    <option value="NOTE">NOTE</option>
                </select>
                <div className="ml-auto text-sm text-zinc-600">
                    Page {page} / {totalPages}
                </div>
            </div>

            {isLoading && <div className="text-sm opacity-70">Loading…</div>}
            {error && <div className="text-sm text-rose-600">Could not load activities</div>}

            {!isLoading && items.length === 0 && <div className="text-sm text-zinc-600">No activity yet.</div>}

            {items.length > 0 && (
                <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="text-left border-b">
                                <th className="px-3 py-2">Time</th>
                                <th className="px-3 py-2">Order</th>
                                <th className="px-3 py-2">Type</th>
                                <th className="px-3 py-2">Message</th>
                                <th className="px-3 py-2">Meta</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((a) => (
                                <tr key={a.id} className="border-b last:border-b-0">
                                    <td className="px-3 py-2 whitespace-nowrap">{fmt(a.createdAt)}</td>
                                    <td className="px-3 py-2">
                                        <code
                                            role="button"
                                            tabIndex={0}
                                            className="font-mono underline cursor-pointer"
                                            onClick={(e) => {
                                                e.stopPropagation?.();             // optional, if inside a clickable row
                                                nav(`/orders?open=${a.orderId}`);  // or just nav('/orders') if you don't want auto-open
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    nav(`/orders?open=${a.orderId}`);
                                                }
                                            }}
                                        >
                                            {a.orderId}
                                        </code>
                                        {a.order?.status ? <div className="text-xs opacity-70">({a.order.status})</div> : null}
                                    </td>
                                    <td className="px-3 py-2">
                                        <span className="inline-block text-xs px-2 py-1 rounded bg-black/5">{a.type}</span>
                                    </td>
                                    <td className="px-3 py-2">{a.message || '—'}</td>
                                    <td className="px-3 py-2 max-w-[28ch] truncate">
                                        {a.meta ? <code className="text-xs">{JSON.stringify(a.meta)}</code> : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <div className="flex items-center justify-between mt-3">
                        <button
                            className="px-3 py-1.5 border rounded disabled:opacity-50"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => p - 1)}
                        >
                            Prev
                        </button>
                        <button
                            className="px-3 py-1.5 border rounded disabled:opacity-50"
                            disabled={page >= totalPages}
                            onClick={() => setPage((p) => p + 1)}
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
}
