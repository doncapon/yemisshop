// src/components/admin/AdminLedgerPanel.tsx
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw, Plus } from "lucide-react";
import api from "../../api/client.js";

type SupplierLite = { id: string; name: string };

type LedgerRow = {
  id: string;
  supplierId: string;
  type: "CREDIT" | "DEBIT" | string;
  amount: number | string;
  currency?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  meta?: any;
  createdAt?: string;

  supplier?: { id: string; name: string };
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

function pillClass(type?: string | null) {
  const t = String(type || "").toUpperCase();
  if (t === "CREDIT") return "bg-emerald-600/10 text-emerald-700 border-emerald-600/20";
  if (t === "DEBIT") return "bg-rose-500/10 text-rose-700 border-rose-600/20";
  return "bg-zinc-500/10 text-zinc-700 border-zinc-600/20";
}

/**
 * Cookie auth version:
 * - remove token/headers
 * - use withCredentials: true
 */
export default function AdminLedgerPanel({ canAdmin }: { canAdmin: boolean }) {
  const qc = useQueryClient();

  const [supplierId, setSupplierId] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [type, setType] = useState<string>("");

  const [take, setTake] = useState<number>(20);
  const [page, setPage] = useState<number>(1);
  const skip = (page - 1) * take;

  React.useEffect(() => setPage(1), [supplierId, q, type, take]);

  // Supplier dropdown (re-uses GET /api/admin/suppliers)
  const suppliersQ = useQuery({
    queryKey: ["admin", "suppliers", "lite"],
    enabled: !!canAdmin,
    queryFn: async () => {
      const { data } = await api.get<{ data: SupplierLite[] }>(`/api/admin/suppliers`, {
        withCredentials: true,
      });

      // tolerate different shapes
      const root: any = data ?? {};
      const rows: SupplierLite[] =
        (Array.isArray(root?.data) ? root.data : null) ??
        (Array.isArray(root?.items) ? root.items : null) ??
        (Array.isArray(root) ? root : null) ??
        [];

      return rows;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const ledgerQ = useQuery({
    queryKey: ["admin", "suppliers", "ledger", { supplierId, q, type, take, skip }],
    enabled: !!canAdmin,
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (supplierId) qs.set("supplierId", supplierId);
      if (q) qs.set("q", q);
      if (type) qs.set("type", type);
      qs.set("take", String(take));
      qs.set("skip", String(skip));

      const { data } = await api.get(`/api/admin/suppliers/ledger?${qs.toString()}`, {
        withCredentials: true,
      });

      const root: any = data ?? {};
      const rows: LedgerRow[] =
        (Array.isArray(root?.data) ? root.data : null) ??
        (Array.isArray(root?.data?.data) ? root.data.data : null) ??
        (Array.isArray(root?.items) ? root.items : null) ??
        (Array.isArray(root?.data?.items) ? root.data.items : null) ??
        [];
      const total: number | undefined =
        (typeof root?.meta?.total === "number" ? root.meta.total : undefined) ??
        (typeof root?.total === "number" ? root.total : undefined) ??
        (typeof root?.count === "number" ? root.count : undefined) ??
        (typeof root?.meta?.count === "number" ? root.meta.count : undefined) ??
        undefined;

      return { rows, total };
    },
    staleTime: 20_000,
    refetchOnWindowFocus: false,
  });

  const rows: LedgerRow[] = ledgerQ.data?.rows ?? [];
  const total: number | undefined = ledgerQ.data?.total;

  const totalPages =
    typeof total === "number" && total >= 0 ? Math.max(1, Math.ceil(total / take)) : undefined;

  const canPrev = page > 1;
  const canNext = typeof totalPages === "number" ? page < totalPages : rows.length === take;

  // Modal state
  const [open, setOpen] = useState(false);
  const [mSupplierId, setMSupplierId] = useState("");
  const [mType, setMType] = useState<"CREDIT" | "DEBIT">("CREDIT");
  const [mAmount, setMAmount] = useState("");
  const [mCurrency, setMCurrency] = useState("NGN");
  const [mNote, setMNote] = useState("");
  const [mRefType, setMRefType] = useState("MANUAL");
  const [mRefId, setMRefId] = useState("");

  const adjustM = useMutation({
    mutationFn: async () => {
      if (!mSupplierId) throw new Error("Pick a supplier");
      const amt = Number(mAmount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Amount must be > 0");

      return (
        await api.post(
          `/api/admin/suppliers/${encodeURIComponent(mSupplierId)}/ledger-adjust`,
          {
            type: mType,
            amount: amt,
            currency: mCurrency || "NGN",
            note: mNote || undefined,
            referenceType: mRefType || undefined,
            referenceId: mRefId ? mRefId : null,
          },
          { withCredentials: true }
        )
      ).data;
    },
    onSuccess: async () => {
      setOpen(false);
      setMAmount("");
      setMNote("");
      setMRefId("");
      await qc.invalidateQueries({ queryKey: ["admin", "suppliers", "ledger"] });
    },
  });

  const isMutating = adjustM.isPending;
  const errMsg =
    (ledgerQ.error as any)?.response?.data?.error ||
    (ledgerQ.error as any)?.response?.data?.message ||
    (ledgerQ.error as any)?.message ||
    "Failed to load ledger.";

  const suppliers = suppliersQ.data ?? [];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-zinc-700">Supplier ledger entries (credits, debits, adjustments).</div>

        <div className="grid grid-cols-1 sm:flex sm:items-center gap-2 w-full sm:w-auto">
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 rounded-xl border bg-white text-sm"
            title="Filter by supplier"
          >
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search id / reference…"
            className="w-full sm:w-[260px] px-3 py-2 rounded-xl border bg-white"
          />

          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 rounded-xl border bg-white text-sm"
          >
            <option value="">All types</option>
            <option value="CREDIT">CREDIT</option>
            <option value="DEBIT">DEBIT</option>
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
            onClick={() => ledgerQ.refetch()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-black/5 text-sm disabled:opacity-50"
            disabled={ledgerQ.isFetching}
          >
            <RefreshCcw size={16} /> {ledgerQ.isFetching ? "Refreshing…" : "Refresh"}
          </button>

          <button
            onClick={() => {
              setMSupplierId(supplierId || "");
              setOpen(true);
            }}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-zinc-900 text-white hover:opacity-90 text-sm"
          >
            <Plus size={16} /> Manual adjustment
          </button>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-3 flex-wrap border rounded-xl px-3 py-2">
        <div className="text-xs text-zinc-600">
          {ledgerQ.isFetching
            ? "Loading…"
            : ledgerQ.isError
              ? "Failed to load."
              : typeof total === "number"
                ? `Showing ${Math.min(skip + 1, total)}–${Math.min(skip + rows.length, total)} of ${total}`
                : `Showing ${rows.length} item(s)`}
        </div>

        <div className="inline-flex items-center gap-2">
          <button
            className="px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5 text-sm disabled:opacity-50"
            disabled={!canPrev || ledgerQ.isFetching}
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
            disabled={!canNext || ledgerQ.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {/* Error banner */}
      {ledgerQ.isError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {errMsg}
        </div>
      )}

      {/* ✅ Mobile cards */}
      <div className="sm:hidden space-y-3">
        {ledgerQ.isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border p-4 animate-pulse bg-white">
              <div className="h-4 w-2/3 bg-zinc-200 rounded" />
              <div className="mt-2 h-3 w-1/2 bg-zinc-200 rounded" />
              <div className="mt-4 h-10 w-full bg-zinc-200 rounded-xl" />
            </div>
          ))}

        {!ledgerQ.isLoading && !ledgerQ.isError && rows.length === 0 && (
          <div className="rounded-2xl border p-4 text-sm text-zinc-600 bg-white">No ledger entries found.</div>
        )}

        {!ledgerQ.isLoading &&
          !ledgerQ.isError &&
          rows.map((r) => (
            <div key={r.id} className="rounded-2xl border p-4 bg-white">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-zinc-500">Supplier</div>
                  <div className="font-semibold text-ink break-all">{r.supplier?.name || r.supplierId}</div>
                </div>

                <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${pillClass(r.type)}`}>
                  {String(r.type)}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="text-xs text-zinc-500">Amount</div>
                <div className="text-right font-semibold">{ngn.format(fmtMoney(r.amount))}</div>

                <div className="text-xs text-zinc-500">Ref Type</div>
                <div className="text-right">{r.referenceType || "—"}</div>

                <div className="text-xs text-zinc-500">Ref ID</div>
                <div className="text-right break-all">{r.referenceId || "—"}</div>

                <div className="text-xs text-zinc-500">Created</div>
                <div className="text-right">{fmtDate(r.createdAt)}</div>
              </div>

              <div className="mt-3 pt-3 border-t">
                <div className="text-xs text-zinc-500">Entry ID</div>
                <div className="font-mono text-xs break-all">{r.id}</div>
              </div>
            </div>
          ))}
      </div>

      {/* ✅ Desktop table */}
      <div className="hidden sm:block overflow-x-auto rounded-2xl border">
        <table className="min-w-[1100px] w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 text-ink">
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[260px]">Supplier</th>
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[120px]">Type</th>
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[160px]">Amount</th>
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[160px]">Ref Type</th>
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[260px]">Ref ID</th>
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[200px]">Created</th>
              <th className="text-left px-3 py-2 whitespace-nowrap min-w-[260px]">Entry ID</th>
            </tr>
          </thead>

          <tbody className="divide-y">
            {ledgerQ.isLoading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-zinc-500">
                  Loading ledger…
                </td>
              </tr>
            )}

            {!ledgerQ.isLoading && !ledgerQ.isError && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-zinc-500">
                  No ledger entries found.
                </td>
              </tr>
            )}

            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-black/5">
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className="inline-block max-w-[260px] truncate" title={r.supplier?.name || r.supplierId}>
                    {r.supplier?.name || r.supplierId}
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${pillClass(r.type)}`}>
                    {String(r.type)}
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">{ngn.format(fmtMoney(r.amount))}</td>
                <td className="px-3 py-3 whitespace-nowrap">{r.referenceType || "—"}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className="inline-block max-w-[260px] truncate" title={r.referenceId || ""}>
                    {r.referenceId || "—"}
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className="font-mono text-xs">{r.id}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Manual Adjustment Modal (mobile-friendly) */}
      {open && (
        <div className="fixed inset-0 z-[1000] bg-black/40 flex items-end sm:items-center justify-center">
          <div className="w-full sm:max-w-[560px] rounded-t-2xl sm:rounded-2xl bg-white border shadow-lg overflow-hidden max-h-[92vh] sm:max-h-[85vh]">
            <div className="px-4 py-3 border-b flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-ink">Manual ledger adjustment</div>
                <div className="text-xs text-ink-soft">Creates a CREDIT or DEBIT entry.</div>
              </div>
              <button
                className="shrink-0 px-3 py-1.5 rounded-lg border bg-white hover:bg-black/5 disabled:opacity-50"
                onClick={() => setOpen(false)}
                disabled={isMutating}
              >
                Close
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-600">Supplier</label>
                  <select
                    value={mSupplierId}
                    onChange={(e) => setMSupplierId(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-xl border bg-white text-sm"
                  >
                    <option value="">Select supplier…</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-zinc-600">Type</label>
                  <select
                    value={mType}
                    onChange={(e) => setMType(e.target.value as any)}
                    className="w-full mt-1 px-3 py-2 rounded-xl border bg-white text-sm"
                  >
                    <option value="CREDIT">CREDIT</option>
                    <option value="DEBIT">DEBIT</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-zinc-600">Amount</label>
                  <input
                    value={mAmount}
                    onChange={(e) => setMAmount(e.target.value)}
                    placeholder="e.g. 1500"
                    inputMode="decimal"
                    className="w-full mt-1 px-3 py-2 rounded-xl border bg-white text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-zinc-600">Currency</label>
                  <input
                    value={mCurrency}
                    onChange={(e) => setMCurrency(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-xl border bg-white text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-zinc-600">Reference Type</label>
                  <input
                    value={mRefType}
                    onChange={(e) => setMRefType(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-xl border bg-white text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-zinc-600">Reference ID (optional)</label>
                  <input
                    value={mRefId}
                    onChange={(e) => setMRefId(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-xl border bg-white text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-600">Note (optional)</label>
                <textarea
                  value={mNote}
                  onChange={(e) => setMNote(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl border bg-white text-sm"
                  rows={3}
                />
              </div>

              {adjustM.isError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {(adjustM.error as any)?.response?.data?.error || (adjustM.error as any)?.message || "Failed."}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
              <button
                className="px-3 py-2 rounded-xl border bg-white hover:bg-black/5 disabled:opacity-50"
                onClick={() => setOpen(false)}
                disabled={isMutating}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 rounded-xl bg-zinc-900 text-white hover:opacity-90 disabled:opacity-50"
                onClick={() => adjustM.mutate()}
                disabled={isMutating}
              >
                {isMutating ? "Saving…" : "Create entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
