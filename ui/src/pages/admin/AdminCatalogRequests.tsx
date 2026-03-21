// src/pages/admin/AdminCatalogRequests.tsx
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import SiteLayout from "../../layouts/SiteLayout";
import api from "../../api/client";

type CatalogRequest = {
  id: string;
  type: "BRAND" | "CATEGORY" | "ATTRIBUTE" | "ATTRIBUTE_VALUE";
  status: "PENDING" | "APPROVED" | "REJECTED";
  payload: any;
  reason?: string | null;
  adminNote?: string | null;
  createdAt: string;
  supplier?: { id: string; name: string };
  reviewedBy?: { id: string; email: string } | null;
};

type CatalogRequestsResponse = {
  data: CatalogRequest[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const STATUS_OPTS: Array<CatalogRequest["status"]> = ["PENDING", "APPROVED", "REJECTED"];
const TYPE_OPTS: Array<"" | CatalogRequest["type"]> = ["", "BRAND", "CATEGORY", "ATTRIBUTE", "ATTRIBUTE_VALUE"];

const PAGE_SIZE = 20;

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function AdminCatalogRequests() {
  const qc = useQueryClient();

  const [status, setStatus] = useState<CatalogRequest["status"]>("PENDING");
  const [type, setType] = useState<string>("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const q = useQuery<CatalogRequestsResponse>({
    queryKey: ["admin", "catalog-requests", status, type, page, PAGE_SIZE],
    queryFn: async () => {
      const { data } = await api.get("/api/admin/catalog-requests", {
        withCredentials: true,
        params: {
          status,
          ...(type ? { type } : {}),
          page,
          pageSize: PAGE_SIZE,
        },
      });

      return {
        data: Array.isArray(data?.data) ? data.data : [],
        total: Number(data?.total ?? 0),
        page: Number(data?.page ?? page),
        pageSize: Number(data?.pageSize ?? PAGE_SIZE),
        totalPages: Math.max(1, Number(data?.totalPages ?? 1)),
      };
    },
    placeholderData: (prev) => prev,
  });

  const approveM = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(
        `/api/admin/catalog-requests/${id}/approve`,
        {},
        {
          withCredentials: true,
        }
      );
      return data?.data ?? data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "catalog-requests"] });
      qc.invalidateQueries({ queryKey: ["admin", "categories"] });
      qc.invalidateQueries({ queryKey: ["admin", "brands"] });
      qc.invalidateQueries({ queryKey: ["admin", "attributes"] });
      qc.invalidateQueries({ queryKey: ["catalog", "categories"] });
      qc.invalidateQueries({ queryKey: ["catalog", "brands"] });
      qc.invalidateQueries({ queryKey: ["catalog", "attributes"] });
    },
  });

  const rejectM = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(
        `/api/admin/catalog-requests/${id}/reject`,
        {},
        {
          withCredentials: true,
        }
      );
      return data?.data ?? data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "catalog-requests"] });
    },
  });

  const rows = q.data?.data ?? [];
  const total = q.data?.total ?? 0;
  const currentPage = q.data?.page ?? page;
  const pageSize = q.data?.pageSize ?? PAGE_SIZE;
  const totalPages = Math.max(1, q.data?.totalPages ?? 1);

  const prettyPayload = (p: any) => {
    try {
      return JSON.stringify(p, null, 2);
    } catch {
      return String(p);
    }
  };

  const title = useMemo(() => `Catalog requests`, []);
  const subtitle = useMemo(
    () => `Showing ${status}${type ? ` • ${type}` : ""}`,
    [status, type]
  );

  const anyPending = approveM.isPending || rejectM.isPending;

  const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = total === 0 ? 0 : Math.min(currentPage * pageSize, total);

  return (
    <SiteLayout>
      <div className="mx-auto w-full max-w-6xl px-3 sm:px-4 py-5 sm:py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-zinc-900">{title}</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Approve will create the real catalog entity.
            </p>
            <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
          </div>

          <button
            type="button"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            className={clsx(
              "inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold",
              "hover:bg-black/5 disabled:opacity-60",
              "w-full sm:w-auto"
            )}
          >
            <RefreshCw size={16} className={q.isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block">
            <span className="sr-only">Status</span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as CatalogRequest["status"]);
                setPage(1);
                setExpanded({});
              }}
              className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
            >
              {STATUS_OPTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="sr-only">Type</span>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
                setExpanded({});
              }}
              className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
            >
              {TYPE_OPTS.map((t) => (
                <option key={t || "ALL"} value={t}>
                  {t ? t : "All types"}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 rounded-2xl border bg-white overflow-hidden">
          <div className="px-4 py-3 border-b bg-zinc-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-sm font-semibold text-zinc-900">Requests</div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="text-xs text-zinc-600">
                {q.isLoading ? "…" : `Showing ${from}-${to} of ${total}`}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={currentPage <= 1 || q.isFetching}
                  className="inline-flex items-center justify-center rounded-xl border bg-white px-2.5 py-2 text-xs font-semibold hover:bg-black/5 disabled:opacity-50"
                  aria-label="First page"
                >
                  <ChevronsLeft size={15} />
                </button>

                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1 || q.isFetching}
                  className="inline-flex items-center rounded-xl border bg-white px-3 py-2 text-xs font-semibold hover:bg-black/5 disabled:opacity-50"
                >
                  Prev
                </button>

                <div className="text-xs text-zinc-600 min-w-[84px] text-center">
                  Page {currentPage} / {totalPages}
                </div>

                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages || q.isFetching}
                  className="inline-flex items-center rounded-xl border bg-white px-3 py-2 text-xs font-semibold hover:bg-black/5 disabled:opacity-50"
                >
                  Next
                </button>

                <button
                  type="button"
                  onClick={() => setPage(totalPages)}
                  disabled={currentPage >= totalPages || q.isFetching}
                  className="inline-flex items-center justify-center rounded-xl border bg-white px-2.5 py-2 text-xs font-semibold hover:bg-black/5 disabled:opacity-50"
                  aria-label="Last page"
                >
                  <ChevronsRight size={15} />
                </button>
              </div>
            </div>
          </div>

          {q.isLoading && !q.data && (
            <div className="p-4 text-sm text-zinc-600">Loading…</div>
          )}

          {!q.isLoading && q.isError && (
            <div className="p-4 text-sm text-rose-700 bg-rose-50">
              Failed to load requests. Try refresh.
            </div>
          )}

          {!q.isLoading && !q.isError && rows.length === 0 && (
            <div className="p-4 text-sm text-zinc-600">No requests.</div>
          )}

          <div className="divide-y">
            {rows.map((r) => {
              const supplierLabel = r.supplier?.name || r.supplier?.id || "—";
              const createdLabel = new Date(r.createdAt).toLocaleString();
              const isExpanded = !!expanded[r.id];
              const isPending = r.status === "PENDING";

              return (
                <div key={r.id} className="p-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-zinc-900">{r.type}</span>
                          <span
                            className={clsx(
                              "text-[11px] px-2 py-0.5 rounded-full border font-semibold",
                              r.status === "PENDING" && "bg-amber-50 text-amber-800 border-amber-200",
                              r.status === "APPROVED" && "bg-emerald-50 text-emerald-800 border-emerald-200",
                              r.status === "REJECTED" && "bg-rose-50 text-rose-800 border-rose-200"
                            )}
                          >
                            {r.status}
                          </span>
                        </div>

                        <div className="mt-1 text-xs text-zinc-600 leading-relaxed">
                          <span className="font-semibold text-zinc-800">Supplier:</span>{" "}
                          <span className="break-words">{supplierLabel}</span>
                          <span className="mx-2 text-zinc-300">•</span>
                          <span className="text-zinc-500">{createdLabel}</span>
                        </div>

                        {r.reason && (
                          <div className="mt-2 text-xs text-zinc-700 bg-zinc-50 border rounded-xl px-3 py-2">
                            <span className="font-semibold">Reason:</span> {r.reason}
                          </div>
                        )}

                        {r.adminNote && (
                          <div className="mt-2 text-xs text-zinc-700 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">
                            <span className="font-semibold">Admin note:</span> {r.adminNote}
                          </div>
                        )}
                      </div>

                      {isPending && (
                        <div className="hidden sm:flex gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => approveM.mutate(r.id)}
                            disabled={anyPending}
                            className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white px-3 py-2 text-xs font-semibold disabled:opacity-60"
                          >
                            <Check size={14} /> Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => rejectM.mutate(r.id)}
                            disabled={anyPending}
                            className="inline-flex items-center gap-2 rounded-xl border bg-rose-50 text-rose-700 px-3 py-2 text-xs font-semibold hover:bg-rose-100 disabled:opacity-60"
                          >
                            <X size={14} /> Reject
                          </button>
                        </div>
                      )}
                    </div>

                    {isPending && (
                      <div className="grid grid-cols-2 gap-2 sm:hidden">
                        <button
                          type="button"
                          onClick={() => approveM.mutate(r.id)}
                          disabled={anyPending}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white px-3 py-2 text-xs font-semibold disabled:opacity-60"
                        >
                          <Check size={14} /> Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectM.mutate(r.id)}
                          disabled={anyPending}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border bg-rose-50 text-rose-700 px-3 py-2 text-xs font-semibold hover:bg-rose-100 disabled:opacity-60"
                        >
                          <X size={14} /> Reject
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setExpanded((s) => ({ ...s, [r.id]: !s[r.id] }))}
                        className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-700 hover:text-zinc-900"
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        {isExpanded ? "Hide payload" : "Show payload"}
                      </button>

                      {r.reviewedBy?.email && (
                        <div className="text-[11px] text-zinc-500">
                          Reviewed by: <span className="font-semibold">{r.reviewedBy.email}</span>
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <pre className="text-[11px] rounded-xl border bg-zinc-50 p-3 overflow-auto max-h-[280px]">
                        {prettyPayload(r.payload)}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-zinc-500">
              Showing {from}-{to} of {total} request(s)
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage(1)}
                disabled={currentPage <= 1 || q.isFetching}
                className="inline-flex items-center justify-center rounded-xl border bg-white px-2.5 py-2 text-xs font-semibold hover:bg-black/5 disabled:opacity-50"
                aria-label="First page"
              >
                <ChevronsLeft size={15} />
              </button>

              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || q.isFetching}
                className="inline-flex items-center rounded-xl border bg-white px-3 py-2 text-xs font-semibold hover:bg-black/5 disabled:opacity-50"
              >
                Prev
              </button>

              <div className="text-xs text-zinc-600 min-w-[84px] text-center">
                Page {currentPage} / {totalPages}
              </div>

              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || q.isFetching}
                className="inline-flex items-center rounded-xl border bg-white px-3 py-2 text-xs font-semibold hover:bg-black/5 disabled:opacity-50"
              >
                Next
              </button>

              <button
                type="button"
                onClick={() => setPage(totalPages)}
                disabled={currentPage >= totalPages || q.isFetching}
                className="inline-flex items-center justify-center rounded-xl border bg-white px-2.5 py-2 text-xs font-semibold hover:bg-black/5 disabled:opacity-50"
                aria-label="Last page"
              >
                <ChevronsRight size={15} />
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 text-[11px] text-zinc-500">
          Tip: On mobile, expand payload only when needed to keep the list readable.
        </div>
      </div>
    </SiteLayout>
  );
}