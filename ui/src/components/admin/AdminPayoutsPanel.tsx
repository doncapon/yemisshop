// src/components/admin/AdminPayoutsPanel.tsx
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw } from "lucide-react";
import api from "../../api/client.js";

type AllocationRow = {
  id: string;
  status: string;
  amount: number | string;
  createdAt?: string;
  releasedAt?: string | null;

  supplierId: string;
  purchaseOrderId: string;
  paymentId: string;

  supplier?: { id: string; name: string };
  purchaseOrder?: {
    id: string;
    orderId: string;
    status?: string;
    payoutStatus?: string | null;
    paidOutAt?: string | null;
    supplierAmount?: number | string | null;
    subtotal?: number | string | null;
  };
  payment?: {
    id: string;
    status?: string;
    reference?: string | null;
    createdAt?: string;
  };
};

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

function fmtMoney(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(+d)) return String(s);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 3-way choice helper:
 * - true  => Yes
 * - false => No
 * - null  => Cancel (abort)
 */
function confirmYesNoCancel(message: string): boolean | null {
  const yes = window.confirm(`${message}\n\nOK = Yes\nCancel = No`);
  if (yes) return true;

  const abort = window.confirm(`You chose "No".\n\nOK = Continue with "No"\nCancel = Abort`);
  if (abort) return false;

  return null;
}

function statusPillClass(status?: string | null) {
  const s = String(status || "").toUpperCase();
  if (["PAID", "RELEASED", "COMPLETED"].includes(s))
    return "bg-emerald-600/10 text-emerald-700 border-emerald-600/20";
  if (["PENDING", "HELD", "ON_HOLD"].includes(s))
    return "bg-amber-500/10 text-amber-700 border-amber-600/20";
  if (["FAILED", "CANCELED", "CANCELLED", "REJECTED"].includes(s))
    return "bg-rose-500/10 text-rose-700 border-rose-600/20";
  return "bg-zinc-500/10 text-zinc-700 border-zinc-600/20";
}

/** Extract rows from many possible API shapes */
function pickRows(root: any): AllocationRow[] {
  const candidates = [
    root?.rows,
    root?.data?.rows,
    root?.data?.data?.rows,

    root?.items,
    root?.data?.items,
    root?.data?.data?.items,

    root?.allocations,
    root?.data?.allocations,
    root?.data?.data?.allocations,

    root?.data,
    root?.data?.data,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

/** Extract total count from many possible API shapes */
function pickTotal(root: any): number | undefined {
  const candidates = [
    root?.meta?.total,
    root?.data?.meta?.total,
    root?.data?.data?.meta?.total,

    root?.total,
    root?.data?.total,
    root?.data?.data?.total,

    root?.count,
    root?.meta?.count,
    root?.data?.count,
    root?.data?.meta?.count,
  ];
  for (const c of candidates) {
    if (typeof c === "number") return c;
  }
  return undefined;
}

/**
 * Cookie auth version:
 * - remove token/headers
 * - use withCredentials: true
 */
export default function AdminPayoutsPanel({ canAdmin }: { canAdmin: boolean }) {
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  // IMPORTANT: many backends store this as HELD not PENDING
  const [status, setStatus] = useState<string>("HELD");

  const [take, setTake] = useState<number>(20);
  const [page, setPage] = useState<number>(1);
  const skip = (page - 1) * take;

  React.useEffect(() => setPage(1), [q, status, take]);

  // ✅ status mapping fallback: if UI ever sends "PENDING", convert to "HELD"
  const statusParam = useMemo(() => {
    const s = String(status || "").toUpperCase().trim();
    if (!s) return "";
    if (s === "PENDING") return "HELD";
    return s;
  }, [status]);

  const allocationsQ = useQuery({
    queryKey: ["admin", "payouts", "allocations", { q, status: statusParam, take, skip }],
    enabled: !!canAdmin,
    queryFn: async () => {
      const { data } = await api.get(`/api/admin/payouts/allocations`, {
        withCredentials: true,
        params: {
          q: q || undefined,
          status: statusParam || undefined,
          take,
          skip,
        },
      });

      const root: any = data ?? {};
      const rows = pickRows(root);
      const total = pickTotal(root);

      return { rows, total };
    },
    staleTime: 20_000,
    refetchOnWindowFocus: false,
  });

  const rows: AllocationRow[] = allocationsQ.data?.rows ?? [];
  const total: number | undefined = allocationsQ.data?.total;

  const totalPages =
    typeof total === "number" && total >= 0 ? Math.max(1, Math.ceil(total / take)) : undefined;

  const canPrev = page > 1;
  const canNext = typeof totalPages === "number" ? page < totalPages : rows.length === take;

  const releaseM = useMutation({
    mutationFn: async (purchaseOrderId: string) => {
      return (
        await api.post(
          `/api/admin/payouts/purchase-orders/${encodeURIComponent(purchaseOrderId)}/release`,
          {},
          { withCredentials: true }
        )
      ).data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "payouts", "allocations"] });
    },
  });

  const markPaidM = useMutation({
    mutationFn: async (vars: { allocationId: string; createLedger: boolean; note?: string }) => {
      return (
        await api.post(
          `/api/admin/payouts/allocations/${encodeURIComponent(vars.allocationId)}/mark-paid`,
          { createLedger: vars.createLedger, note: vars.note },
          { withCredentials: true }
        )
      ).data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "payouts", "allocations"] });
      await qc.invalidateQueries({ queryKey: ["admin", "suppliers", "ledger"] });
    },
  });

  const isMutating = releaseM.isPending || markPaidM.isPending;

  const errMsg =
    (allocationsQ.error as any)?.response?.data?.error ||
    (allocationsQ.error as any)?.response?.data?.message ||
    (allocationsQ.error as any)?.message ||
    "Failed to load allocations.";

  const ACTIONS_W = 240;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-zinc-700">
          Supplier allocations (held → paid). Use <b>Release</b> for normal flow.
        </div>

        <div className="grid grid-cols-1 sm:flex sm:items-center gap-2 w-full sm:w-auto">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search allocationId / orderId / poId / supplierId…"
            className="w-full sm:w-[300px] px-3 py-2 rounded-xl border bg-white"
          />

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 rounded-xl border bg-white text-sm"
          >
            <option value="">All</option>
            <option value="HELD">HELD (pending)</option>
            <option value="PENDING">PENDING (alias)</option>
            <option value="PAID">PAID</option>
            <option value="RELEASED">RELEASED</option>
            <option value="FAILED">FAILED</option>
            <option value="CANCELED">CANCELED</option>
          </select>

          <select
            value={String(take)}
            onChange={(e) => setTake(Number(e.target.value) || 20)}
            className="w-full sm:w-auto px-3 py-2 rounded-xl border bg-white text-sm"
            title="Rows per page"
          >
            <option value="10">10 / page</option>
            <option value="20">20 / page</option>
            <option value="50">50 / page</option>
          </select>

          <button
            onClick={() => allocationsQ.refetch()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-black/5 text-sm disabled:opacity-50"
            disabled={allocationsQ.isFetching}
          >
            <RefreshCcw size={16} /> {allocationsQ.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-3 flex-wrap border rounded-xl px-3 py-2">
        <div className="text-xs text-zinc-600">
          {allocationsQ.isFetching
            ? "Loading…"
            : allocationsQ.isError
              ? "Failed to load."
              : typeof total === "number"
                ? `Showing ${Math.min(skip + 1, total)}–${Math.min(skip + rows.length, total)} of ${total}`
                : `Showing ${rows.length} item(s)`}
        </div>

        <div className="inline-flex items-center gap-2">
          <button
            className="px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5 text-sm disabled:opacity-50"
            disabled={!canPrev || allocationsQ.isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>

          <div className="text-sm text-zinc-700">
            Page <b>{page}</b>
            {typeof totalPages === "number" ? (
              <>
                {" "}
                of <b>{totalPages}</b>
              </>
            ) : null}
          </div>

          <button
            className="px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5 text-sm disabled:opacity-50"
            disabled={!canNext || allocationsQ.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {allocationsQ.isError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {errMsg}
        </div>
      )}

      {/* Mobile cards */}
      <div className="sm:hidden space-y-3">
        {allocationsQ.isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border p-4 animate-pulse bg-white">
              <div className="h-4 w-2/3 bg-zinc-200 rounded" />
              <div className="mt-2 h-3 w-1/2 bg-zinc-200 rounded" />
              <div className="mt-4 h-10 w-full bg-zinc-200 rounded-xl" />
            </div>
          ))}

        {!allocationsQ.isLoading && !allocationsQ.isError && rows.length === 0 && (
          <div className="rounded-2xl border p-4 text-sm text-zinc-600 bg-white">
            No allocations found.
          </div>
        )}

        {!allocationsQ.isLoading &&
          !allocationsQ.isError &&
          rows.map((r) => {
            const s = String(r.status || "").toUpperCase();
            const canRelease = (s === "PENDING" || s === "HELD" || s === "ON_HOLD") && !!r.purchaseOrderId;
            const canMarkPaid = s !== "PAID";

            return (
              <div key={r.id} className="rounded-2xl border p-4 bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-zinc-500">Allocation</div>
                    <div className="font-mono text-xs break-all">{r.id}</div>
                  </div>

                  <span
                    className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${statusPillClass(
                      r.status
                    )}`}
                  >
                    {String(r.status)}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="text-xs text-zinc-500">Order</div>
                  <div className="text-right text-ink break-all">{r.purchaseOrder?.orderId || "—"}</div>

                  <div className="text-xs text-zinc-500">PO</div>
                  <div className="text-right text-ink break-all">{r.purchaseOrderId || "—"}</div>

                  <div className="text-xs text-zinc-500">Supplier</div>
                  <div className="text-right text-ink break-all">{r.supplier?.name || r.supplierId || "—"}</div>

                  <div className="text-xs text-zinc-500">Amount</div>
                  <div className="text-right font-semibold">{ngn.format(fmtMoney(r.amount))}</div>

                  <div className="text-xs text-zinc-500">Created</div>
                  <div className="text-right">{fmtDate(r.createdAt)}</div>

                  <div className="text-xs text-zinc-500">Released</div>
                  <div className="text-right">{fmtDate(r.releasedAt || null)}</div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    disabled={!canRelease || isMutating}
                    onClick={() => {
                      const ok = window.confirm(`Release payout for PO ${r.purchaseOrderId}?`);
                      if (!ok) return;
                      releaseM.mutate(r.purchaseOrderId);
                    }}
                  >
                    Release
                  </button>

                  <button
                    className="px-3 py-2 rounded-xl border bg-white hover:bg-black/5 disabled:opacity-50"
                    disabled={!canMarkPaid || isMutating}
                    onClick={() => {
                      const noteRaw = window.prompt(
                        "Manual mark PAID note (optional).\n\nClick Cancel to abort."
                      );
                      if (noteRaw === null) return;
                      const note = noteRaw.trim();

                      const ledgerChoice = confirmYesNoCancel(
                        "Also create a ledger CREDIT for this allocation?"
                      );
                      if (ledgerChoice === null) return;

                      const ok = window.confirm(
                        `Proceed to MARK PAID?\n\nAllocation: ${r.id}\nAmount: ${ngn.format(
                          fmtMoney(r.amount)
                        )}\nLedger: ${ledgerChoice ? "YES (credit)" : "NO"}`
                      );
                      if (!ok) return;

                      markPaidM.mutate({
                        allocationId: r.id,
                        createLedger: ledgerChoice,
                        note: note ? note : undefined,
                      });
                    }}
                  >
                    Mark PAID
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto relative rounded-2xl border">
        <table className="min-w-[1100px] w-full text-sm table-auto">
          <thead>
            <tr className="bg-zinc-50 text-ink">
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[220px]">Allocation</th>
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[200px]">Order</th>
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[220px]">PO</th>
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[220px]">Supplier</th>
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[140px]">Amount</th>
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[140px]">Status</th>
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[180px]">Created</th>
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[180px]">Released</th>

              <th
                className="sticky right-0 z-40 text-right px-3 py-2 bg-zinc-50 whitespace-nowrap border-l"
                style={{
                  width: ACTIONS_W,
                  minWidth: ACTIONS_W,
                  maxWidth: ACTIONS_W,
                  boxShadow: "-10px 0 16px -14px rgba(0,0,0,0.35)",
                }}
              >
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="divide-y">
            {allocationsQ.isLoading && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-zinc-500">
                  Loading allocations…
                </td>
              </tr>
            )}

            {!allocationsQ.isLoading && !allocationsQ.isError && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-zinc-500">
                  No allocations found.
                </td>
              </tr>
            )}

            {rows.map((r) => {
              const s = String(r.status || "").toUpperCase();
              const canRelease = (s === "PENDING" || s === "HELD" || s === "ON_HOLD") && !!r.purchaseOrderId;
              const canMarkPaid = s !== "PAID";

              return (
                <tr key={r.id} className="hover:bg-black/5">
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="max-w-[260px] truncate" title={r.id}>
                      {r.id}
                    </div>
                  </td>

                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="max-w-[220px] truncate" title={r.purchaseOrder?.orderId || "—"}>
                      {r.purchaseOrder?.orderId || "—"}
                    </div>
                  </td>

                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="max-w-[240px] truncate" title={r.purchaseOrderId || "—"}>
                      {r.purchaseOrderId || "—"}
                    </div>
                  </td>

                  <td className="px-3 py-3 whitespace-nowrap">
                    <div
                      className="max-w-[320px] truncate"
                      title={r.supplier?.name || r.supplierId || "—"}
                    >
                      {r.supplier?.name || r.supplierId || "—"}
                    </div>
                  </td>

                  <td className="px-3 py-3 whitespace-nowrap">{ngn.format(fmtMoney(r.amount))}</td>

                  <td className="px-3 py-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${statusPillClass(
                        r.status
                      )}`}
                    >
                      {String(r.status)}
                    </span>
                  </td>

                  <td className="px-3 py-3 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{fmtDate(r.releasedAt || null)}</td>

                  <td
                    className="sticky right-0 z-30 px-3 py-3 bg-white border-l"
                    style={{
                      width: ACTIONS_W,
                      minWidth: ACTIONS_W,
                      maxWidth: ACTIONS_W,
                      boxShadow: "-10px 0 16px -14px rgba(0,0,0,0.25)",
                    }}
                  >
                    <div className="inline-flex items-center gap-2 justify-end w-full">
                      <button
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                        disabled={!canRelease || isMutating}
                        onClick={() => {
                          const ok = window.confirm(`Release payout for PO ${r.purchaseOrderId}?`);
                          if (!ok) return;
                          releaseM.mutate(r.purchaseOrderId);
                        }}
                        title="Normal flow"
                      >
                        Release
                      </button>

                      <button
                        className="px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5 disabled:opacity-50"
                        disabled={!canMarkPaid || isMutating}
                        onClick={() => {
                          const noteRaw = window.prompt(
                            "Manual mark PAID note (optional).\n\nClick Cancel to abort."
                          );
                          if (noteRaw === null) return;
                          const note = noteRaw.trim();

                          const ledgerChoice = confirmYesNoCancel(
                            "Also create a ledger CREDIT for this allocation?"
                          );
                          if (ledgerChoice === null) return;

                          const ok = window.confirm(
                            `Proceed to MARK PAID?\n\nAllocation: ${r.id}\nAmount: ${ngn.format(
                              fmtMoney(r.amount)
                            )}\nLedger: ${ledgerChoice ? "YES (credit)" : "NO"}`
                          );
                          if (!ok) return;

                          markPaidM.mutate({
                            allocationId: r.id,
                            createLedger: ledgerChoice,
                            note: note ? note : undefined,
                          });
                        }}
                        title="Manual override"
                      >
                        Mark PAID
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
