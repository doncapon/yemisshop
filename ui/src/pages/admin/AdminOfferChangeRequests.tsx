import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  RefreshCcw,
  Search,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import api from "../../api/client";
import SiteLayout from "../../layouts/SiteLayout";
import { useAuthStore } from "../../store/auth";

type ChangeItem = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | string;
  scope: "BASE_OFFER" | "VARIANT_OFFER" | string;
  supplierId: string;
  productId: string;
  variantId?: string | null;
  proposedPatch: any;
  currentSnapshot?: any;
  requestedAt?: string;
  supplier?: { id: string; name?: string | null };
  product?: { id: string; title?: string | null; sku?: string | null };
};

function fmtDate(s?: string) {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isFinite(+d) ? d.toLocaleString() : s;
}

/* ---------------- Cookie auth helpers ---------------- */
const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function isAuthError(e: any) {
  const status = e?.response?.status;
  return status === 401 || status === 403;
}

export default function AdminOfferChangeRequests() {
  const qc = useQueryClient();

  // Keep store reads (useful for role-based UI), but no token is used in requests
  const storeUser = useAuthStore((s) => s.user);

  const [tab, setTab] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  /**
   * ✅ Cookie-session auth gate:
   * We first check /api/profile/me using cookies. If 401/403, we show error state.
   * This matches your other cookie-mode pages.
   */
  const meQ = useQuery({
    queryKey: ["me-min"],
    queryFn: async () =>
      (await api.get("/api/profile/me", AXIOS_COOKIE_CFG)).data as {
        role?: string;
        id?: string;
      },
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const authReady = meQ.isSuccess || meQ.isError;
  const queriesEnabled = authReady && !(meQ.isError && isAuthError(meQ.error));

  const listQ = useQuery({
    queryKey: ["admin", "offer-change-requests", tab],
    enabled: queriesEnabled,
    queryFn: async () => {
      const res = await api.get(
        `/api/admin/offer-change-requests?status=${tab}`,
        AXIOS_COOKIE_CFG
      );
      const root = (res as any)?.data;
      const items = root?.data?.items ?? root?.items ?? [];
      return items as ChangeItem[];
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const filtered = useMemo(() => {
    const items = listQ.data ?? [];
    const term = q.trim().toLowerCase();
    if (!term) return items;

    return items.filter((x) => {
      const hay = [
        x?.supplier?.name,
        x?.product?.title,
        x?.product?.sku,
        x?.scope,
        x?.status,
        x?.variantId,
        JSON.stringify(x?.proposedPatch ?? {}),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
  }, [listQ.data, q]);

  const approveM = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(
        `/api/admin/offer-change-requests/${id}/approve`,
        {},
        AXIOS_COOKIE_CFG
      );
      return (res as any)?.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "offer-change-requests"] });
    },
  });

  const rejectM = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const res = await api.post(
        `/api/admin/offer-change-requests/${id}/reject`,
        { reason: reason || "Rejected by admin" },
        AXIOS_COOKIE_CFG
      );
      return (res as any)?.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "offer-change-requests"] });
    },
  });

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const authErr =
    authReady && meQ.isError && isAuthError(meQ.error)
      ? "You’re not signed in (or your session expired). Please login again."
      : null;

  return (
    <SiteLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              Offer change approvals
            </h1>
            <p className="text-sm text-zinc-600 mt-1">
              Approve or reject supplier changes (price / lead-days / active
              status). Stock changes are applied immediately.
            </p>
          </div>

          <button
            type="button"
            onClick={() => listQ.refetch()}
            disabled={!queriesEnabled}
            className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
          >
            <RefreshCcw size={16} /> Refresh
          </button>
        </div>

        {authErr && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {authErr}
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="inline-flex rounded-2xl border bg-white overflow-hidden">
            {(["PENDING", "APPROVED", "REJECTED"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-semibold ${
                  tab === t
                    ? "bg-zinc-900 text-white"
                    : "bg-white text-zinc-800 hover:bg-black/5"
                }`}
                disabled={!queriesEnabled}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex-1 relative">
            <Search
              className="absolute left-3 top-2.5 text-zinc-400"
              size={16}
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search supplier, product, SKU, patch…"
              className="w-full rounded-2xl border bg-white pl-9 pr-3 py-2 text-sm"
              disabled={!queriesEnabled}
            />
          </div>
        </div>

        {!authErr && listQ.isLoading && (
          <div className="rounded-2xl border bg-white p-4 text-sm text-zinc-600">
            Loading…
          </div>
        )}

        {!authErr && listQ.isError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            Failed to load approvals.
          </div>
        )}

        {!authErr && !listQ.isLoading && filtered.length === 0 && (
          <div className="rounded-2xl border bg-white p-4 text-sm text-zinc-600">
            No items.
          </div>
        )}

        <div className="space-y-3">
          {!authErr &&
            filtered.map((x) => {
              const isOpen = expanded.has(x.id);
              const supplierName = x?.supplier?.name ?? x.supplierId;
              const productTitle = x?.product?.title ?? x.productId;
              const sku = x?.product?.sku ?? "—";

              return (
                <div
                  key={x.id}
                  className="rounded-2xl border bg-white/90 shadow-sm overflow-hidden"
                >
                  <div className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-zinc-900">
                        {productTitle}{" "}
                        <span className="text-zinc-400 font-normal">
                          ({sku})
                        </span>
                      </div>
                      <div className="text-xs text-zinc-600 mt-1">
                        Supplier:{" "}
                        <b className="text-zinc-900">{supplierName}</b> • Scope:{" "}
                        <b className="text-zinc-900">{x.scope}</b>
                        {x.variantId ? (
                          <>
                            {" "}
                            • Variant:{" "}
                            <b className="text-zinc-900">{x.variantId}</b>
                          </>
                        ) : null}
                        {" "}
                        • Requested:{" "}
                        <b className="text-zinc-900">{fmtDate(x.requestedAt)}</b>
                      </div>

                      <div className="text-xs text-zinc-700 mt-2">
                        <span className="text-zinc-500">Proposed patch:</span>{" "}
                        <span className="font-mono">
                          {JSON.stringify(x.proposedPatch ?? {})}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(x.id)}
                        className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
                      >
                        {isOpen ? (
                          <ChevronUp size={16} />
                        ) : (
                          <ChevronDown size={16} />
                        )}
                        Details
                      </button>

                      {tab === "PENDING" && (
                        <>
                          <button
                            type="button"
                            disabled={approveM.isPending || rejectM.isPending}
                            onClick={() => approveM.mutate(x.id)}
                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-3 py-2 text-sm font-semibold disabled:opacity-60"
                          >
                            <CheckCircle2 size={16} /> Approve
                          </button>

                          <button
                            type="button"
                            disabled={approveM.isPending || rejectM.isPending}
                            onClick={() => {
                              const reason =
                                window.prompt(
                                  "Reason for rejection (optional):"
                                ) || "Rejected";
                              rejectM.mutate({ id: x.id, reason });
                            }}
                            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 text-white px-3 py-2 text-sm font-semibold disabled:opacity-60"
                          >
                            <XCircle size={16} /> Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t bg-zinc-50 p-4 text-xs text-zinc-800 space-y-2">
                      <div className="font-semibold text-zinc-900">
                        Current snapshot
                      </div>
                      <pre className="rounded-xl border bg-white p-3 overflow-auto">
                        {JSON.stringify(x.currentSnapshot ?? {}, null, 2)}
                      </pre>

                      <div className="font-semibold text-zinc-900 mt-3">
                        Proposed patch
                      </div>
                      <pre className="rounded-xl border bg-white p-3 overflow-auto">
                        {JSON.stringify(x.proposedPatch ?? {}, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </SiteLayout>
  );
}
