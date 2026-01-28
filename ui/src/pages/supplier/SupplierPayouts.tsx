// src/pages/supplier/SupplierPayouts.tsx
import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowRight, CircleDollarSign, CreditCard, Sparkles } from "lucide-react";
import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

type PayoutSummaryDTO = {
  availableBalance: number;
  held: number;
  paidOut: number;
  currency: "NGN" | string;
  scheduleNote?: string | null;
};

type PayoutHistoryRowDTO = {
  id: string;
  date: string; // ISO
  reference: string;
  amount: number;
  status: "PENDING" | "PAID" | "FAILED";
  purchaseOrderId?: string | null;
  orderId: string;
  paymentId: string;
};

type PayoutHistoryDTO = {
  rows: PayoutHistoryRowDTO[];
  total?: number;
};

async function fetchSummary(): Promise<PayoutSummaryDTO> {
  const res = await api.get("/api/supplier/payouts/summary");
  return res.data?.data;
}

async function fetchHistory(params: { take: number; skip: number }): Promise<PayoutHistoryDTO> {
  const res = await api.get("/api/supplier/payouts/history", { params });
  return res.data?.data;
}

function formatISODate(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return iso;
  }
}

export default function SupplierPayouts() {
  const ngn = useMemo(
    () =>
      new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 0,
      }),
    []
  );

  const [page, setPage] = useState(0);
  const take = 20;
  const skip = page * take;

  const summaryQ = useQuery({
    queryKey: ["supplier-payouts", "summary"],
    queryFn: fetchSummary,
    staleTime: 15_000,
  });

  const historyQ = useQuery({
    queryKey: ["supplier-payouts", "history", { take, skip }],
    queryFn: () => fetchHistory({ take, skip }),
    staleTime: 10_000,
    placeholderData: keepPreviousData,

  });

  const summary = summaryQ.data;
  const rows = historyQ.data?.rows ?? [];

  const canPrev = page > 0;
  const canNext = rows.length === take; // naive paging; if you return total, use that instead

  return (
    <SiteLayout>
      <SupplierLayout>
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl mt-6 border">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700" />
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,0,167,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,204,255,0.25),transparent_60%)]" />
          <div className="relative px-5 md:px-8 py-8 text-white">
            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-2xl md:text-3xl font-bold tracking-tight"
            >
              Payouts <Sparkles className="inline ml-1" size={22} />
            </motion.h1>
            <p className="mt-1 text-sm text-white/80">Track your balance and payout history.</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 rounded-full bg-white text-zinc-900 px-4 py-2 text-sm font-semibold hover:opacity-95"
              >
                Back to overview <ArrowRight size={16} />
              </Link>
              <Link
                to="/supplier/settings"
                className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
              >
                Update payout details <ArrowRight size={16} />
              </Link>
            </div>

            {(summaryQ.isLoading || summaryQ.isFetching) && (
              <div className="mt-3 text-xs text-white/80">Loading payout summary…</div>
            )}
            {summaryQ.isError && (
              <div className="mt-3 text-xs text-white/90">
                Failed to load summary.{" "}
                <button className="underline" onClick={() => summaryQ.refetch()}>
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Summary */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <div className="p-5 flex items-start gap-3">
              <div className="inline-grid place-items-center w-10 h-10 rounded-2xl bg-zinc-900/5 text-zinc-800">
                <CircleDollarSign size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-zinc-500">Available balance</div>
                <div className="text-xl font-semibold text-zinc-900">
                  {summary ? ngn.format(summary.availableBalance ?? 0) : "—"}
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  {summary ? `Held: ${ngn.format(summary.held ?? 0)} • Paid: ${ngn.format(summary.paidOut ?? 0)}` : "—"}
                </div>
              </div>
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <div className="p-5 flex items-start gap-3">
              <div className="inline-grid place-items-center w-10 h-10 rounded-2xl bg-zinc-900/5 text-zinc-800">
                <CreditCard size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900">Payout schedule</div>
                <div className="text-sm text-zinc-600">
                  {summary?.scheduleNote?.trim()
                    ? summary.scheduleNote
                    : "Funds move from PENDING → PAID when the supplier marks the PO as DELIVERED (and the system releases payout)."}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* History */}
        <div className="mt-4">
          <Card>
            <div className="px-5 py-4 border-b bg-white/70 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-zinc-900">Payout history</div>
                <div className="text-xs text-zinc-500">
                  {historyQ.isLoading ? "Loading…" : "Supplier payment allocations"}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  disabled={!canPrev || historyQ.isFetching}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="text-xs px-3 py-2 rounded-xl border bg-white disabled:opacity-50"
                >
                  Prev
                </button>
                <button
                  disabled={!canNext || historyQ.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                  className="text-xs px-3 py-2 rounded-xl border bg-white disabled:opacity-50"
                >
                  Next
                </button>
                <button
                  onClick={() => historyQ.refetch()}
                  disabled={historyQ.isFetching}
                  className="text-xs px-3 py-2 rounded-xl border bg-white disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>
            </div>

            {historyQ.isError && (
              <div className="p-5 text-sm text-red-700">
                Failed to load payout history.{" "}
                <button className="underline" onClick={() => historyQ.refetch()}>
                  Retry
                </button>
              </div>
            )}

            <div className="p-5 overflow-auto">
              <table className="min-w-[720px] w-full text-sm">
                <thead>
                  <tr className="text-xs text-zinc-500">
                    <th className="text-left font-semibold py-2">Date</th>
                    <th className="text-left font-semibold py-2">Reference</th>
                    <th className="text-left font-semibold py-2">Order ID</th>
                    <th className="text-left font-semibold py-2">Amount</th>
                    <th className="text-left font-semibold py-2">Status</th>
                  </tr>
                </thead>

                <tbody className="text-zinc-800">
                  {!historyQ.isLoading && rows.length === 0 && (
                    <tr>
                      <td className="py-6 text-zinc-500" colSpan={5}>
                        No payout records yet.
                      </td>
                    </tr>
                  )}

                  {rows.map((x) => (
                    <tr key={x.id} className="border-t">
                      <td className="py-3">{formatISODate(x.date)}</td>
                      <td className="py-3 font-semibold">{x.reference}</td>

                      <td className="py-3">
                        <Link to={`/supplier/orders/${x.orderId}`} className="font-mono text-xs underline">
                          {x.orderId}
                        </Link>
                      </td>


                      <td className="py-3">{ngn.format(x.amount)}</td>
                      <td className="py-3">
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-[11px] border ${x.status === "PAID"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : x.status === "FAILED"
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                            }`}
                        >
                          {x.status}
                        </span>
                      </td>
                    </tr>
                  ))}

                </tbody>
              </table>

              {historyQ.isFetching && (
                <div className="mt-3 text-xs text-zinc-500">Updating…</div>
              )}
            </div>
          </Card>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}
