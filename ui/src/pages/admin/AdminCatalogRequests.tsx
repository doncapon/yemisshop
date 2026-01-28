// src/pages/admin/AdminCatalogRequests.tsx
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, RefreshCw } from "lucide-react";
import SiteLayout from "../../layouts/SiteLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";

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

export default function AdminCatalogRequests() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();

  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [type, setType] = useState<string>("");

  const q = useQuery<CatalogRequest[]>({
    queryKey: ["admin", "catalog-requests", status, type],
    enabled: !!token,
    queryFn: async () => {
      const { data } = await api.get("/api/admin/catalog-requests", {
        headers: { Authorization: `Bearer ${token}` },
        params: { status, ...(type ? { type } : {}) },
      });
      return (data?.data ?? []) as CatalogRequest[];
    },
  });

  const approveM = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(
        `/api/admin/catalog-requests/${id}/approve`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
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
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return data?.data ?? data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "catalog-requests"] });
    },
  });

  const rows = q.data ?? [];

  const prettyPayload = (p: any) => {
    try {
      return JSON.stringify(p, null, 2);
    } catch {
      return String(p);
    }
  };

  const title = useMemo(() => `Catalog requests (${status})`, [status]);

  return (
    <SiteLayout>
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">{title}</h1>
            <p className="text-sm text-zinc-600">Approve will create the real catalog entity.</p>
          </div>

          <button
            type="button"
            onClick={() => q.refetch()}
            className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            className="rounded-xl border bg-white px-3 py-2 text-sm"
          >
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
          </select>

          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-xl border bg-white px-3 py-2 text-sm"
          >
            <option value="">All types</option>
            <option value="BRAND">BRAND</option>
            <option value="CATEGORY">CATEGORY</option>
            <option value="ATTRIBUTE">ATTRIBUTE</option>
            <option value="ATTRIBUTE_VALUE">ATTRIBUTE_VALUE</option>
          </select>
        </div>

        <div className="mt-4 rounded-2xl border bg-white overflow-hidden">
          <div className="px-4 py-3 border-b bg-zinc-50 text-sm font-semibold text-zinc-900">
            Requests ({rows.length})
          </div>

          <div className="divide-y">
            {q.isLoading && <div className="p-4 text-sm text-zinc-600">Loading…</div>}
            {!q.isLoading && rows.length === 0 && (
              <div className="p-4 text-sm text-zinc-600">No requests.</div>
            )}

            {rows.map((r) => (
              <div key={r.id} className="p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-900">
                      {r.type} • <span className="text-zinc-500">{r.status}</span>
                    </div>
                    <div className="text-xs text-zinc-600 mt-1">
                      Supplier: <b>{r.supplier?.name || r.supplier?.id || "—"}</b> • {new Date(r.createdAt).toLocaleString()}
                    </div>
                    {r.reason && <div className="text-xs text-zinc-600 mt-1">Reason: {r.reason}</div>}
                  </div>

                  {r.status === "PENDING" && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => approveM.mutate(r.id)}
                        disabled={approveM.isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 text-white px-3 py-2 text-xs font-semibold disabled:opacity-60"
                      >
                        <Check size={14} /> Approve (Create)
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectM.mutate(r.id)}
                        disabled={rejectM.isPending}
                        className="inline-flex items-center gap-2 rounded-xl border bg-rose-50 text-rose-700 px-3 py-2 text-xs font-semibold hover:bg-rose-100 disabled:opacity-60"
                      >
                        <X size={14} /> Reject
                      </button>
                    </div>
                  )}
                </div>

                <pre className="mt-3 text-[11px] rounded-xl border bg-zinc-50 p-3 overflow-auto">
                  {prettyPayload(r.payload)}
                </pre>

                {r.adminNote && (
                  <div className="mt-2 text-xs text-zinc-700">
                    Admin note: <b>{r.adminNote}</b>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
