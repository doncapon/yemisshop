// src/components/admin/ActivitiesPanel.tsx
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../../api/client.js";

type ActivityRow = {
    id: string;
    createdAt: string;
    orderId?: string | null;
    type?: string | null;
    message?: string | null;
    meta?: any;
    order?: { status?: string | null } | null;
};

type ActivitiesResp = {
    data: ActivityRow[];
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
};

const fmt = (d: string) => {
    const dt = new Date(d);
    return Number.isNaN(+dt) ? d : dt.toLocaleString();
};

// ✅ Change this if your backend path differs
const ACTIVITIES_URL = "/api/admin/activities";

function unwrapActivities(payload: any): ActivitiesResp {
    // Supports: {data:[...], totalPages}, {data:{data:[...], totalPages}}, {items:[...]} etc.
    const root = payload ?? {};

    const direct = Array.isArray(root?.data) ? root.data : null;
    const nested = Array.isArray(root?.data?.data) ? root.data.data : null;
    const items = Array.isArray(root?.items) ? root.items : null;
    const nestedItems = Array.isArray(root?.data?.items) ? root.data.items : null;

    const rows: ActivityRow[] = direct ?? nested ?? items ?? nestedItems ?? [];

    const totalPages =
        (typeof root?.totalPages === "number" ? root.totalPages : undefined) ??
        (typeof root?.data?.totalPages === "number" ? root.data.totalPages : undefined) ??
        1;

    const total =
        (typeof root?.total === "number" ? root.total : undefined) ??
        (typeof root?.data?.total === "number" ? root.data.total : undefined) ??
        undefined;

    const page =
        (typeof root?.page === "number" ? root.page : undefined) ??
        (typeof root?.data?.page === "number" ? root.data.page : undefined) ??
        undefined;

    const pageSize =
        (typeof root?.pageSize === "number" ? root.pageSize : undefined) ??
        (typeof root?.data?.pageSize === "number" ? root.data.pageSize : undefined) ??
        undefined;

    return { data: rows, totalPages, total, page, pageSize };
}

export default function ActivitiesPanel({ canAdmin = true }: { canAdmin?: boolean }) {
    const nav = useNavigate();

    const [q, setQ] = useState("");
    const [type, setType] = useState("");
    const [page, setPage] = useState(1);

    const pageSize = 50;

    // ✅ Change/add candidates here (most likely first)
    const ACTIVITY_ENDPOINTS = [
        "/api/admin/order-activities",      // common name
        "/api/admin/activities",            // what we tried
        "/api/admin/activities/orders",     // another common pattern
        "/api/admin/audit",                 // if you used audit log naming
        "/api/admin/audit-log",
    ];

    async function getActivities(params: any) {
        let lastErr: any = null;

        for (const url of ACTIVITY_ENDPOINTS) {
            try {
                const res = await api.get(url, { withCredentials: true, params });
                return res.data;
            } catch (e: any) {
                // If route doesn't exist, try the next one.
                if (e?.response?.status === 404) {
                    lastErr = e;
                    continue;
                }
                // Any other error (401/403/500) is real -> stop.
                throw e;
            }
        }

        // If all were 404, throw the last 404 so you see it in UI.
        throw lastErr ?? new Error("Activities endpoint not found");
    }

    const params = useMemo(() => {
        const p: Record<string, any> = { page, pageSize };
        if (q.trim()) p.q = q.trim();
        if (type) p.type = type;
        return p;
    }, [q, type, page]);

    const { data, isLoading, error, isFetching, refetch } = useQuery({
        queryKey: ["admin", "order-activities", params],
        enabled: !!canAdmin,
        queryFn: async () => {
            const raw = await getActivities(params);
            return unwrapActivities(raw); // keep your unwrap
        },
        staleTime: 10_000,
        refetchOnWindowFocus: false,
    });


    const items = data?.data ?? [];
    const totalPages = Math.max(1, data?.totalPages ?? 1);

    const errMsg =
        (error as any)?.response?.data?.error ||
        (error as any)?.response?.data?.message ||
        (error as any)?.message ||
        "Could not load activities.";

    return (
        <section className="rounded-2xl border bg-white shadow-sm">
            {/* Header + filters */}
            <div className="p-4 border-b">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-ink font-semibold">Activity</div>
                        <div className="text-xs text-ink-soft">Recent order/payment events and notes</div>
                    </div>

                    <div className="text-xs text-zinc-600 sm:text-sm">
                        Page <b>{page}</b> / <b>{totalPages}</b>
                    </div>
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
                    <input
                        value={q}
                        onChange={(e) => {
                            setQ(e.target.value);
                            setPage(1);
                        }}
                        placeholder="Search (order id, type, message)…"
                        className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
                    />

                    <select
                        value={type}
                        onChange={(e) => {
                            setType(e.target.value);
                            setPage(1);
                        }}
                        className="w-full sm:w-[220px] rounded-xl border bg-white px-3 py-2 text-sm"
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

                    <button
                        type="button"
                        onClick={() => refetch()}
                        className="w-full sm:w-auto rounded-xl border bg-white px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-50"
                        disabled={isFetching}
                    >
                        {isFetching ? "Refreshing…" : "Refresh"}
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="p-4">
                {isLoading && <div className="text-sm text-zinc-600">Loading…</div>}

                {!isLoading && error && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                        {errMsg}
                    </div>
                )}

                {!isLoading && !error && items.length === 0 && (
                    <div className="text-sm text-zinc-600">No activity yet.</div>
                )}

                {!isLoading && !error && items.length > 0 && (
                    <>
                        {/* ✅ Mobile cards */}
                        <div className="sm:hidden space-y-3">
                            {items.map((a) => (
                                <div key={a.id} className="rounded-2xl border p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-xs text-zinc-500">{fmt(a.createdAt)}</div>

                                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                                <span className="inline-flex items-center rounded-full border bg-white px-2 py-0.5 text-xs">
                                                    {a.type || "—"}
                                                </span>
                                                {a.order?.status ? (
                                                    <span className="inline-flex items-center rounded-full border bg-white px-2 py-0.5 text-xs text-zinc-600">
                                                        {a.order.status}
                                                    </span>
                                                ) : null}
                                            </div>

                                            <div className="mt-2 text-sm text-ink">{a.message || "—"}</div>

                                            <div className="mt-2">
                                                {a.orderId ? (
                                                    <button
                                                        type="button"
                                                        className="text-xs font-mono underline text-indigo-700"
                                                        onClick={() => nav(`/orders?open=${encodeURIComponent(String(a.orderId))}`)}
                                                    >
                                                        {a.orderId}
                                                    </button>
                                                ) : (
                                                    <span className="text-xs text-zinc-500">No order</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {a.meta ? (
                                        <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-zinc-50 p-2 text-[11px] text-zinc-700">
                                            {JSON.stringify(a.meta, null, 2)}
                                        </pre>
                                    ) : null}
                                </div>
                            ))}
                        </div>

                        {/* ✅ Desktop table */}
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="w-max min-w-full text-sm">
                                <thead>
                                    <tr className="text-left border-b bg-zinc-50">
                                        <th className="px-3 py-2 whitespace-nowrap">Time</th>
                                        <th className="px-3 py-2 whitespace-nowrap">Order</th>
                                        <th className="px-3 py-2 whitespace-nowrap">Type</th>
                                        <th className="px-3 py-2">Message</th>
                                        <th className="px-3 py-2 whitespace-nowrap">Meta</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {items.map((a) => (
                                        <tr key={a.id} className="hover:bg-black/5">
                                            <td className="px-3 py-2 whitespace-nowrap">{fmt(a.createdAt)}</td>
                                            <td className="px-3 py-2 whitespace-nowrap">
                                                {a.orderId ? (
                                                    <code
                                                        role="button"
                                                        tabIndex={0}
                                                        className="font-mono underline cursor-pointer text-indigo-700"
                                                        onClick={(e) => {
                                                            e.stopPropagation?.();
                                                            nav(`/orders?open=${encodeURIComponent(String(a.orderId))}`);
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter" || e.key === " ") {
                                                                e.preventDefault();
                                                                nav(`/orders?open=${encodeURIComponent(String(a.orderId))}`);
                                                            }
                                                        }}
                                                    >
                                                        {a.orderId}
                                                    </code>
                                                ) : (
                                                    "—"
                                                )}
                                                {a.order?.status ? (
                                                    <div className="text-xs text-zinc-500">({a.order.status})</div>
                                                ) : null}
                                            </td>
                                            <td className="px-3 py-2 whitespace-nowrap">
                                                <span className="inline-block text-xs px-2 py-1 rounded-full border bg-white">
                                                    {a.type || "—"}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2">{a.message || "—"}</td>
                                            <td className="px-3 py-2 whitespace-nowrap">
                                                {a.meta ? (
                                                    <code className="text-xs font-mono">
                                                        {JSON.stringify(a.meta)} {/* compact single-line JSON */}
                                                    </code>
                                                ) : (
                                                    "—"
                                                )}
                                            </td>

                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-xs text-zinc-600">
                                {isFetching ? "Updating…" : " "}
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-2">
                                <button
                                    className="px-3 py-1.5 border rounded-lg bg-white hover:bg-black/5 disabled:opacity-50"
                                    disabled={page <= 1 || isFetching}
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                >
                                    Prev
                                </button>
                                <button
                                    className="px-3 py-1.5 border rounded-lg bg-white hover:bg-black/5 disabled:opacity-50"
                                    disabled={page >= totalPages || isFetching}
                                    onClick={() => setPage((p) => p + 1)}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </section>
    );
}
