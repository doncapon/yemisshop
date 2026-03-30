// src/pages/supplier/SupplierPayouts.tsx
import React, { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, CircleDollarSign, CreditCard, Sparkles } from "lucide-react";
import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../../store/auth";
import { useSupplierVerificationGate } from "../../hooks/useSupplierVerificationGate";

const ADMIN_SUPPLIER_KEY = "adminSupplierId";
const AXIOS_COOKIE_CFG = { withCredentials: true as const };
const PAGE_SIZE = 20;

function Card({
  children,
  className = "",
  header,
}: {
  children: React.ReactNode;
  className?: string;
  header?: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden ${className}`}>
      {header ? <div className="px-4 sm:px-5 py-3 border-b bg-white/70">{header}</div> : null}
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

type PayoutSummaryDTO = {
  supplierId?: string;
  currency: "NGN" | string;
  availableBalance: number;
  outstandingDebt?: number;
  credits?: number;
  debits?: number;
  pending?: number;
  approved?: number;
  held?: number;
  paidOut?: number;
  failed?: number;
  scheduleNote?: string | null;
};

type PayoutHistoryRowDTO = {
  id: string;
  date: string;
  reference: string;
  amount: number;
  status: "PENDING" | "PAID" | "FAILED" | "APPROVED" | "HELD" | string;
  purchaseOrderId?: string | null;
  orderId?: string | null;
  paymentId?: string | null;
};

type PayoutHistoryDTO = {
  rows: PayoutHistoryRowDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

function formatISODate(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
}

function asNum(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function statusPill(statusRaw: string) {
  const s = String(statusRaw || "").toUpperCase();
  const cls =
    s === "PAID"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : s === "FAILED"
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : s === "APPROVED"
          ? "bg-blue-50 text-blue-700 border-blue-200"
          : s === "HELD"
            ? "bg-zinc-50 text-zinc-700 border-zinc-200"
            : "bg-amber-50 text-amber-700 border-amber-200";

  return (
    <span className={`inline-flex px-2 py-1 rounded-full text-[11px] border ${cls}`}>
      {s || "—"}
    </span>
  );
}

function normalizeHistoryPayload(raw: any): PayoutHistoryDTO {
  const payload = raw?.data ?? raw ?? {};
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const total = asNum(payload?.total, rows.length);
  const pageSize = Math.max(1, asNum(payload?.pageSize, PAGE_SIZE));
  const totalPages = Math.max(1, asNum(payload?.totalPages, Math.ceil(total / pageSize) || 1));
  const page = Math.min(totalPages, Math.max(1, asNum(payload?.page, 1)));

  return {
    rows,
    total,
    page,
    pageSize,
    totalPages,
    hasNextPage:
      typeof payload?.hasNextPage === "boolean" ? payload.hasNextPage : page < totalPages,
    hasPrevPage:
      typeof payload?.hasPrevPage === "boolean" ? payload.hasPrevPage : page > 1,
  };
}

function normRole(role: unknown) {
  let r = String(role ?? "").trim().toUpperCase();
  r = r.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
  if (r === "SUPERADMIN") r = "SUPER_ADMIN";
  if (r === "SUPER_ADMINISTRATOR") r = "SUPER_ADMIN";
  return r;
}

export default function SupplierPayouts() {
  const hydrated = useAuthStore((s: any) => s.hydrated) as boolean;
  const role = useAuthStore((s: any) => s.user?.role);
  const roleNorm = normRole(role);
  const isAdmin = roleNorm === "ADMIN" || roleNorm === "SUPER_ADMIN";
  const isSupplier = roleNorm === "SUPPLIER";

  const verificationQ = useSupplierVerificationGate(hydrated && isSupplier);
  const verificationGate = verificationQ.data?.gate;

  const onboardingBlocked =
    isSupplier &&
    !verificationQ.isLoading &&
    !!verificationGate &&
    verificationGate.isLocked;

  const onboardingProgressItems = verificationGate?.progressItems ?? [];

  const onboardingPct = useMemo(() => {
    if (!onboardingProgressItems.length) return 0;
    const done = onboardingProgressItems.filter((x: any) => x.done).length;
    return Math.round((done / onboardingProgressItems.length) * 100);
  }, [onboardingProgressItems]);

  const nextStepLabel = useMemo(() => {
    const gate = verificationGate;
    if (!gate) return "Continue verification";

    if (!gate.contactDone) return "Continue contact verification";
    if (!gate.businessDone) return "Continue business onboarding";
    if (!gate.addressDone) return "Continue address setup";
    if (gate.hasPendingRequiredDoc) return "Check document re-verification";
    return "Continue document upload";
  }, [verificationGate]);

  const lockReason = onboardingBlocked
    ? verificationGate?.lockReason ||
      "Your updated documents are currently under review. Payout actions stay locked until re-verification is completed."
    : undefined;

  const [searchParams, setSearchParams] = useSearchParams();

  const urlSupplierId = useMemo(() => {
    const v = String(searchParams.get("supplierId") ?? "").trim();
    return v || undefined;
  }, [searchParams]);

  const storedSupplierId = useMemo(() => {
    const v = String(localStorage.getItem(ADMIN_SUPPLIER_KEY) ?? "").trim();
    return v || undefined;
  }, []);

  const adminSupplierId = isAdmin ? (urlSupplierId ?? storedSupplierId) : undefined;

  useEffect(() => {
    if (!isAdmin) return;

    const fromUrl = String(searchParams.get("supplierId") ?? "").trim();
    const fromStore = String(localStorage.getItem(ADMIN_SUPPLIER_KEY) ?? "").trim();

    if (fromUrl) {
      if (fromUrl !== fromStore) localStorage.setItem(ADMIN_SUPPLIER_KEY, fromUrl);
      return;
    }

    if (fromStore) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("supplierId", fromStore);
          return next;
        },
        { replace: true }
      );
    }
  }, [isAdmin, searchParams, setSearchParams]);

  const withSupplierCtx = (to: string) => {
    if (!isAdmin || !adminSupplierId) return to;
    const sep = to.includes("?") ? "&" : "?";
    return `${to}${sep}supplierId=${encodeURIComponent(adminSupplierId)}`;
  };

  const ngn = useMemo(
    () =>
      new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 0,
      }),
    []
  );

  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [adminSupplierId]);

  async function fetchSummary(): Promise<PayoutSummaryDTO> {
    const res = await api.get("/api/supplier/payouts/summary", {
      ...AXIOS_COOKIE_CFG,
      params: { supplierId: adminSupplierId },
    });
    return res.data?.data;
  }

  async function fetchHistory(params: { page: number; pageSize: number }): Promise<PayoutHistoryDTO> {
    const res = await api.get("/api/supplier/payouts/history", {
      ...AXIOS_COOKIE_CFG,
      params: {
        page: params.page,
        pageSize: params.pageSize,
        supplierId: adminSupplierId,
      },
    });

    return normalizeHistoryPayload(res.data);
  }

  const enabled = (!isAdmin || !!adminSupplierId) && (!isSupplier || !!hydrated);

  const summaryQ = useQuery({
    queryKey: ["supplier-payouts", "summary", { supplierId: adminSupplierId }],
    enabled,
    queryFn: fetchSummary,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const historyQ = useQuery({
    queryKey: ["supplier-payouts", "history", { page, pageSize: PAGE_SIZE, supplierId: adminSupplierId }],
    enabled,
    queryFn: () => fetchHistory({ page, pageSize: PAGE_SIZE }),
    staleTime: 10_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const summary = summaryQ.data;
  const history = historyQ.data;
  const rows = history?.rows ?? [];
  const total = asNum(history?.total, 0);
  const totalPages = Math.max(1, asNum(history?.totalPages, 1));
  const currentPage = Math.min(totalPages, Math.max(1, asNum(history?.page, page)));
  const canPrev = !!history?.hasPrevPage;
  const canNext = !!history?.hasNextPage;

  const startItem = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const endItem = total === 0 ? 0 : Math.min(total, (currentPage - 1) * PAGE_SIZE + rows.length);

  const availableBalance = asNum(summary?.availableBalance, 0);
  const outstandingDebt = asNum(summary?.outstandingDebt, 0);
  const credits = asNum(summary?.credits, asNum(summary?.paidOut, 0));
  const debits = asNum(summary?.debits, 0);

  const pending = asNum(summary?.pending, 0);
  const approved = asNum(summary?.approved, 0);
  const held = asNum(summary?.held, 0);
  const paidOut = asNum(summary?.paidOut, 0);
  const failed = asNum(summary?.failed, 0);

  return (
    <SiteLayout>
      <SupplierLayout>
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
            <p className="mt-1 text-sm text-white/80">Track balance and payout history.</p>

            <div className="mt-4 flex flex-col sm:flex-row flex-wrap gap-2">
              <Link
                to={withSupplierCtx("/supplier")}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15"
              >
                Back to overview <ArrowRight size={16} />
              </Link>

              {onboardingBlocked ? (
                <button
                  type="button"
                  disabled
                  title={lockReason}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white/70 cursor-not-allowed"
                >
                  Update payout details <ArrowRight size={16} />
                </button>
              ) : (
                <Link
                  to={withSupplierCtx("/supplier/settings")}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15"
                >
                  Update payout details <ArrowRight size={16} />
                </Link>
              )}
            </div>

            {isAdmin && !adminSupplierId ? (
              <div className="mt-3 text-xs text-amber-200">
                Select a supplier first (Supplier Dashboard) or add <b>?supplierId=...</b> to the URL.
              </div>
            ) : null}

            {isSupplier && verificationQ.isLoading && (
              <div className="mt-3 text-xs text-white/80">Checking verification status…</div>
            )}

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

        {onboardingBlocked && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="font-semibold">Verification in progress</div>
                <div className="mt-1 text-amber-800">
                  Your payout history remains visible, but payout-related actions are locked until supplier verification is complete.
                </div>

                {verificationGate?.hasPendingRequiredDoc && (
                  <div className="mt-3 rounded-xl border border-amber-300 bg-white/70 px-3 py-2 text-[12px] text-amber-900">
                    Your updated documents are currently under review. Payout actions stay locked until re-verification is completed.
                  </div>
                )}

                <div className="mt-3 h-2 overflow-hidden rounded-full bg-amber-100">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all"
                    style={{ width: `${onboardingPct}%` }}
                  />
                </div>

                <div className="mt-2 text-[12px] text-amber-800">
                  Progress: <b>{onboardingPct}%</b>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {onboardingProgressItems.map((item: any) => (
                    <span
                      key={item.key}
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        item.done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {item.label}: {item.done ? "Done" : "Pending"}
                    </span>
                  ))}
                </div>

                <div className="mt-3 text-[12px] text-amber-800">
                  Supplier status: <b>{String(verificationGate?.supplierStatus ?? "PENDING")}</b>
                  {" • "}
                  KYC: <b>{String(verificationGate?.kycStatus ?? "PENDING")}</b>
                </div>
              </div>

              <div className="shrink-0">
                <Link
                  to={verificationGate?.nextPath || "/supplier/verify-contact"}
                  className="inline-flex items-center justify-center rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-950"
                >
                  {nextStepLabel}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card
            className="lg:col-span-1"
            header={
              <div className="flex items-center gap-3">
                <div className="inline-grid place-items-center w-10 h-10 rounded-2xl bg-zinc-900/5 text-zinc-800">
                  <CircleDollarSign size={18} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-zinc-500">Available balance</div>
                  <div className="text-xl font-semibold text-zinc-900">
                    {summary ? ngn.format(availableBalance) : "—"}
                  </div>
                </div>
              </div>
            }
          >
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl border bg-white p-3">
                  <div className="text-[11px] text-zinc-500">Credits</div>
                  <div className="font-semibold text-zinc-900">{summary ? ngn.format(credits) : "—"}</div>
                </div>
                <div className="rounded-xl border bg-white p-3">
                  <div className="text-[11px] text-zinc-500">Debits</div>
                  <div className="font-semibold text-zinc-900">{summary ? ngn.format(debits) : "—"}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                <div className="rounded-xl border bg-zinc-50 p-3">
                  <div className="text-zinc-500">Pending</div>
                  <div className="font-semibold text-zinc-900">{ngn.format(pending)}</div>
                </div>
                <div className="rounded-xl border bg-zinc-50 p-3">
                  <div className="text-zinc-500">Approved</div>
                  <div className="font-semibold text-zinc-900">{ngn.format(approved)}</div>
                </div>
                <div className="rounded-xl border bg-zinc-50 p-3">
                  <div className="text-zinc-500">Held</div>
                  <div className="font-semibold text-zinc-900">{ngn.format(held)}</div>
                </div>
                <div className="rounded-xl border bg-zinc-50 p-3">
                  <div className="text-zinc-500">Paid</div>
                  <div className="font-semibold text-zinc-900">{ngn.format(paidOut)}</div>
                </div>
                <div className="rounded-xl border bg-zinc-50 p-3">
                  <div className="text-zinc-500">Failed</div>
                  <div className="font-semibold text-zinc-900">{ngn.format(failed)}</div>
                </div>
              </div>

              {outstandingDebt > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  Outstanding debt: <b>{ngn.format(outstandingDebt)}</b>
                </div>
              )}
            </div>
          </Card>

          <Card
            className="lg:col-span-2"
            header={
              <div className="flex items-center gap-3">
                <div className="inline-grid place-items-center w-10 h-10 rounded-2xl bg-zinc-900/5 text-zinc-800">
                  <CreditCard size={18} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900">Payout schedule</div>
                  <div className="text-xs text-zinc-500">How your credits/debits affect your balance</div>
                </div>
              </div>
            }
          >
            <div className="text-sm text-zinc-600 leading-relaxed">
              {summary?.scheduleNote?.trim()
                ? summary.scheduleNote
                : "Credits come from allocations marked PAID (released). Debits come from refunds/withdrawals recorded in SupplierLedgerEntry. availableBalance = max(0, credits - debits)."}
            </div>
          </Card>
        </div>

        <div className="mt-4">
          <div className="rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b bg-white/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-zinc-900">Payout history</div>
                <div className="text-xs text-zinc-500">
                  {historyQ.isLoading
                    ? "Loading…"
                    : total > 0
                      ? `Showing ${startItem}-${endItem} of ${total}`
                      : "Supplier allocations"}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <div className="text-[11px] text-zinc-500 px-2">
                  Page {currentPage} of {totalPages}
                </div>

                <button
                  disabled={!canPrev || historyQ.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="text-[11px] px-3 py-2 rounded-full border bg-white disabled:opacity-50"
                >
                  Prev
                </button>

                <button
                  disabled={!canNext || historyQ.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                  className="text-[11px] px-3 py-2 rounded-full border bg-white disabled:opacity-50"
                >
                  Next
                </button>

                <button
                  onClick={() => historyQ.refetch()}
                  disabled={historyQ.isFetching}
                  className="text-[11px] px-3 py-2 rounded-full border bg-white disabled:opacity-50"
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

            <div className="sm:hidden p-4 space-y-3">
              {!historyQ.isLoading && rows.length === 0 && (
                <div className="rounded-2xl border bg-zinc-50 p-4 text-sm text-zinc-600">No payout records yet.</div>
              )}

              {rows.map((x) => (
                <div key={x.id} className="rounded-2xl border bg-white p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs text-zinc-500">{formatISODate(x.date)}</div>
                      <div className="text-sm font-semibold text-zinc-900 truncate">{x.reference}</div>
                    </div>
                    {statusPill(x.status)}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-xs text-zinc-500">Amount</div>
                    <div className="text-sm font-semibold text-zinc-900">{ngn.format(asNum(x.amount, 0))}</div>
                  </div>

                  <div className="pt-1">
                    <div className="text-xs text-zinc-500 mb-1">Order</div>
                    {x.orderId ? (
                      <Link
                        to={withSupplierCtx(`/supplier/orders?q=${encodeURIComponent(x.orderId)}`)}
                        className="font-mono text-xs underline break-all"
                      >
                        {x.orderId}
                      </Link>
                    ) : (
                      <div className="font-mono text-xs text-zinc-400">—</div>
                    )}
                  </div>
                </div>
              ))}

              {historyQ.isFetching && <div className="text-xs text-zinc-500">Updating…</div>}
            </div>

            <div className="hidden sm:block p-5 overflow-auto">
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
                        {x.orderId ? (
                          <Link
                            to={withSupplierCtx(`/supplier/orders?q=${encodeURIComponent(x.orderId)}`)}
                            className="font-mono text-xs underline"
                          >
                            {x.orderId}
                          </Link>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>

                      <td className="py-3">{ngn.format(asNum(x.amount, 0))}</td>
                      <td className="py-3">{statusPill(x.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {historyQ.isFetching && <div className="mt-3 text-xs text-zinc-500">Updating…</div>}
            </div>
          </div>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}