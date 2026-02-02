// src/pages/supplier/SupplierRefunds.tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect, useRef } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { motion } from "framer-motion";
import {
  Search,
  RefreshCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ClipboardList,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";

import { useModal } from "../../components/ModalProvider";
import { useToast } from "../../components/ToastProvider";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";

const ADMIN_SUPPLIER_KEY = "adminSupplierId";

type RefundStatus = string;

export type SupplierRefundRow = {
  id: string;
  orderId?: string | null;
  purchaseOrderId?: string | null;
  status?: string | null;
  reason?: string | null;

  totalAmount?: any;

  requestedAt?: string | null;
  createdAt?: string | null;
  supplierRespondedAt?: string | null;

  provider?: string | null;
  providerReference?: string | null;
  providerStatus?: string | null;

  supplierNote?: string | null;
  meta?: any;

  requestedBy?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
};

function normMoney(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

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

function isUrlish(s?: string) {
  return !!s && /^(https?:\/\/|data:image\/|\/)/i.test(s);
}

function parseUrlList(s: string) {
  return s
    .split(/[\n,]/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function getEvidenceUrls(r: any): string[] {
  const v = r?.meta?.evidenceUrls ?? r?.meta?.evidence ?? r?.evidenceUrls ?? null;

  const out: string[] = [];

  const pushAny = (x: any) => {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(pushAny);

    if (typeof x === "string") {
      const s = x.trim();
      if (!s) return;

      if (s.startsWith("[") && s.endsWith("]")) {
        try {
          const arr = JSON.parse(s);
          if (Array.isArray(arr)) return pushAny(arr);
        } catch {}
      }

      out.push(...parseUrlList(s));
      return;
    }

    if (typeof x === "object") {
      if (typeof x.url === "string") out.push(x.url);
      if (typeof x.href === "string") out.push(x.href);
      if (typeof x.src === "string") out.push(x.src);

      if (x.urls) pushAny(x.urls);
      if (x.images) pushAny(x.images);
      if (x.files) pushAny(x.files);
      if (x.items) pushAny(x.items);
    }
  };

  pushAny(v);

  return Array.from(
    new Set(
      out
        .map((x) => String(x).trim())
        .filter((x) => isUrlish(x))
        .filter((x) => !/^javascript:/i.test(x))
    )
  );
}

function StatusPill({ status }: { status?: string | null }) {
  const s = String(status || "").toUpperCase();
  const cls =
    s === "SUPPLIER_REVIEW" || s === "REQUESTED"
      ? "bg-amber-500/10 text-amber-700 border-amber-600/20"
      : s === "SUPPLIER_ACCEPTED"
      ? "bg-emerald-600/10 text-emerald-700 border-emerald-600/20"
      : s === "SUPPLIER_REJECTED"
      ? "bg-rose-600/10 text-rose-700 border-rose-600/20"
      : s === "ESCALATED"
      ? "bg-indigo-600/10 text-indigo-700 border-indigo-600/20"
      : s === "APPROVED"
      ? "bg-emerald-600/10 text-emerald-700 border-emerald-600/20"
      : s === "REJECTED"
      ? "bg-rose-600/10 text-rose-700 border-rose-600/20"
      : s === "REFUNDED"
      ? "bg-zinc-800/10 text-zinc-800 border-zinc-700/20"
      : "bg-zinc-500/10 text-zinc-700 border-zinc-600/20";

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${cls}`}>
      {status || "—"}
    </span>
  );
}

function canSupplierAct(status?: RefundStatus | string | null) {
  const s = String(status || "").toUpperCase();
  return s === "REQUESTED" || s === "SUPPLIER_REVIEW";
}

function EvidenceThumbs({ urls, max = 3 }: { urls: string[]; max?: number }) {
  if (!urls.length) return <span className="text-xs text-zinc-400">—</span>;

  const shown = urls.slice(0, max);
  const rest = urls.length - shown.length;

  return (
    <div className="inline-flex items-center gap-2 justify-end">
      <div className="flex items-center gap-2">
        {shown.map((u) => (
          <a key={u} href={u} target="_blank" rel="noreferrer" className="group inline-flex items-center" title="Open image">
            <img
              src={u}
              alt="Evidence"
              loading="lazy"
              className="h-9 w-9 rounded-lg border object-cover group-hover:opacity-90"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </a>
        ))}
      </div>

      {rest > 0 ? <span className="text-xs text-zinc-500">+{rest}</span> : null}
    </div>
  );
}

function getRequestorName(r: any): string {
  const first = r?.requestedBy?.firstName ?? "";
  const last = r?.requestedBy?.lastName ?? "";
  const full = `${first} ${last}`.trim();
  return full || r?.requestedBy?.email || "—";
}

export default function SupplierRefunds() {
  const qc = useQueryClient();
  const { openModal } = useModal();
  const toast = useToast();
  const navigate = useNavigate();

  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s: any) => s.user?.role);
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  const hdr = token ? { Authorization: `Bearer ${token}` } : undefined;

  const { refundId } = useParams<{ refundId?: string }>();
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

  function orderHref(orderId?: string | null) {
    if (!orderId) return withSupplierCtx("/supplier/orders");
    const id = encodeURIComponent(orderId);
    return withSupplierCtx(`/supplier/orders?q=${id}`);
  }

  const [status, setStatus] = useState<string>("");

  const qFromUrl = (searchParams.get("q") ?? "").trim();
  const [q, setQ] = useState<string>(() => {
    const fromRoute = (refundId ?? "").trim();
    return fromRoute || qFromUrl || "";
  });

  const syncingRef = useRef(false);

  useEffect(() => {
    const v = (refundId ?? "").trim();
    if (!v) return;

    setQ(v);

    const cur = (searchParams.get("q") ?? "").trim();
    if (cur !== v) {
      syncingRef.current = true;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("q", v);
          return next;
        },
        { replace: true }
      );
      queueMicrotask(() => (syncingRef.current = false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refundId]);

  useEffect(() => {
    if (refundId) return;
    if (syncingRef.current) return;
    const v = (searchParams.get("q") ?? "").trim();
    setQ(v);
  }, [refundId, searchParams]);

  const onChangeQ = (val: string) => {
    setQ(val);

    if (refundId) {
      const next = val.trim();
      navigate(withSupplierCtx(next ? `/supplier/refunds?q=${encodeURIComponent(next)}` : `/supplier/refunds`), {
        replace: true,
      });
      return;
    }

    syncingRef.current = true;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (val.trim()) next.set("q", val.trim());
        else next.delete("q");
        return next;
      },
      { replace: true }
    );
    queueMicrotask(() => (syncingRef.current = false));
  };

  async function fetchRefunds(params: { q?: string; status?: string; take: number; skip: number }) {
    const { data } = await api.get("/api/supplier/refunds", {
      headers: hdr,
      params: {
        ...params,
        supplierId: adminSupplierId, // ✅ admin view-as supplier
      },
    });
    // expected shape: { data: { data: rows } } OR { data: rows }
    const payload = (data as any)?.data ?? data;
    const rows = (payload as any)?.data ?? payload;
    return { data: Array.isArray(rows) ? rows : [] };
  }

  async function refundAction(id: string, body: { action: "ACCEPT" | "REJECT" | "ESCALATE"; note?: string }) {
    const { data } = await api.post(`/api/supplier/refunds/${encodeURIComponent(id)}/action`, body, {
      headers: hdr,
      params: { supplierId: adminSupplierId }, // ✅ admin view-as supplier
    });
    return (data as any)?.data ?? data;
  }

  const refundsQ = useQuery({
    queryKey: ["supplier", "refunds", { q, status, supplierId: adminSupplierId }],
    enabled: !!token && (!isAdmin || !!adminSupplierId),
    queryFn: async () =>
      fetchRefunds({
        q: q || undefined,
        status: status || undefined,
        take: 50,
        skip: 0,
      }),
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const rows: SupplierRefundRow[] = refundsQ.data?.data ?? [];

  const actM = useMutation({
    mutationFn: async (vars: { id: string; action: "ACCEPT" | "REJECT" | "ESCALATE"; note?: string }) =>
      refundAction(vars.id, { action: vars.action, note: vars.note }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["supplier", "refunds"] });
      toast.push({
        title: "Refunds",
        message:
          vars.action === "ACCEPT"
            ? "Refund accepted."
            : vars.action === "REJECT"
            ? "Refund rejected."
            : "Refund escalated to admin.",
        duration: 2500,
      });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || e?.message || "Action failed.";
      openModal({ title: "Refunds", message: msg });
    },
  });

  const totals = useMemo(() => {
    const total = rows.reduce((acc, r) => acc + normMoney((r as any).totalAmount), 0);
    const pending = rows.filter((r) => canSupplierAct((r as any).status)).length;
    return { total, pending };
  }, [rows]);

  function openActionModal(r: SupplierRefundRow, action: "ACCEPT" | "REJECT" | "ESCALATE") {
    let noteVal = "";
    const evidenceUrls = getEvidenceUrls(r);

    const title =
      action === "ACCEPT" ? "Accept refund?" : action === "REJECT" ? "Reject refund?" : "Escalate to admin?";

    const icon =
      action === "ACCEPT" ? (
        <CheckCircle2 size={18} className="text-emerald-700" />
      ) : action === "REJECT" ? (
        <XCircle size={18} className="text-rose-700" />
      ) : (
        <AlertTriangle size={18} className="text-indigo-700" />
      );

    openModal({
      title,
      message: (
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <div className="mt-0.5">{icon}</div>
            <div className="min-w-0">
              <div className="text-sm text-zinc-800">
                Refund <b>{(r as any).id}</b> • Order <b>{(r as any).orderId}</b> • PO <b>{(r as any).purchaseOrderId}</b>
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                Status: <StatusPill status={(r as any).status} /> • Total: <b>{ngn.format(normMoney((r as any).totalAmount))}</b>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-zinc-500 flex items-center gap-2">
                <ImageIcon size={14} /> Evidence
              </div>
              {evidenceUrls.length ? (
                <a
                  href={evidenceUrls[0]}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-indigo-700 hover:underline inline-flex items-center gap-1"
                >
                  Open first <ExternalLink size={12} />
                </a>
              ) : null}
            </div>

            {evidenceUrls.length ? (
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {evidenceUrls.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="block">
                    <img
                      src={u}
                      alt="Evidence"
                      loading="lazy"
                      className="h-28 w-full rounded-lg border object-cover hover:opacity-95"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </a>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-sm text-zinc-500">No evidence attached.</div>
            )}
          </div>

          <div className="rounded-xl border bg-white p-3">
            <div className="text-xs text-zinc-500 mb-1">Optional note</div>
            <textarea
              rows={3}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="Add context for the customer/admin…"
              onChange={(e) => (noteVal = e.target.value)}
            />
          </div>
        </div>
      ),
      footer: (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => actM.mutate({ id: r.id, action, note: noteVal || undefined })}
            disabled={actM.isPending}
            className={`px-3 py-1.5 rounded-md text-sm text-white disabled:opacity-60 ${
              action === "ACCEPT"
                ? "bg-emerald-600 hover:bg-emerald-700"
                : action === "REJECT"
                ? "bg-rose-600 hover:bg-rose-700"
                : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {actM.isPending ? "Saving…" : action === "ESCALATE" ? "Escalate" : action}
          </button>
        </div>
      ),
      disableOverlayClose: true,
    });
  }

  const viewingRefundId = (refundId ?? "").trim();

  return (
    <SiteLayout>
      <SupplierLayout>
        <div className="mt-6">
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
                <ClipboardList size={20} /> Refunds
              </h1>
              <p className="text-sm text-zinc-600 mt-1">Accept, reject, or escalate refunds tied to this supplier’s purchase orders.</p>
              <div className="text-xs text-zinc-500 mt-1">
                Pending actions: <b>{totals.pending}</b> • Total requested: <b>{ngn.format(totals.total)}</b>
              </div>

              {isAdmin && !adminSupplierId ? (
                <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  Select a supplier first (Supplier Dashboard) or add <b>?supplierId=...</b> to the URL.
                </div>
              ) : null}

              {viewingRefundId ? (
                <div className="mt-2 inline-flex items-center gap-2 rounded-full border bg-indigo-50 px-3 py-1 text-xs text-indigo-700">
                  Viewing refund: <b className="font-semibold">{viewingRefundId}</b>
                  <button type="button" className="ml-2 underline" onClick={() => navigate(withSupplierCtx("/supplier/refunds"), { replace: true })}>
                    Clear
                  </button>
                </div>
              ) : null}
            </div>

            <button
              onClick={() => refundsQ.refetch()}
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm hover:bg-black/5"
            >
              <RefreshCcw size={16} /> Refresh
            </button>
          </motion.div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={q}
                onChange={(e) => onChangeQ(e.target.value)}
                placeholder="Search by refund / order / PO / reference…"
                className="w-full pl-9 pr-3 py-2 rounded-xl border bg-white"
                disabled={isAdmin && !adminSupplierId}
              />
            </div>

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
              disabled={isAdmin && !adminSupplierId}
            >
              <option value="">All statuses</option>
              <option value="REQUESTED">REQUESTED</option>
              <option value="SUPPLIER_REVIEW">SUPPLIER_REVIEW</option>
              <option value="SUPPLIER_ACCEPTED">SUPPLIER_ACCEPTED</option>
              <option value="SUPPLIER_REJECTED">SUPPLIER_REJECTED</option>
              <option value="ESCALATED">ESCALATED</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="REFUNDED">REFUNDED</option>
              <option value="CLOSED">CLOSED</option>
            </select>

            <div className="text-xs text-zinc-500 flex items-center">
              {refundsQ.isFetching ? "Loading…" : refundsQ.isError ? "Failed to load." : `${rows.length} refunds`}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border bg-white shadow-sm overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-zinc-900">
                  <th className="text-left px-3 py-2">Refund</th>
                  <th className="text-left px-3 py-2">Requested by</th>
                  <th className="text-left px-3 py-2">Order / PO</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Total</th>
                  <th className="text-left px-3 py-2">Requested</th>
                  <th className="text-left px-3 py-2">Provider</th>
                  <th className="text-right px-3 py-2">Evidence</th>
                  <th className="sticky right-0 z-20 text-right px-3 py-2 bg-zinc-50 shadow-[-8px_0_12px_-10px_rgba(0,0,0,0.25)]">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {refundsQ.isLoading && (
                  <>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        {Array.from({ length: 9 }).map((__, j) => (
                          <td key={j} className="px-3 py-3">
                            <div className="h-3 rounded bg-zinc-200" />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </>
                )}

                {!refundsQ.isLoading && !refundsQ.isError && rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-zinc-500">
                      No refunds found.
                    </td>
                  </tr>
                )}

                {rows.map((r) => {
                  const canAct = canSupplierAct((r as any).status);
                  const evidenceUrls = getEvidenceUrls(r);
                  const isMatch = viewingRefundId && String((r as any).id) === viewingRefundId;

                  return (
                    <tr key={(r as any).id} className={`hover:bg-black/5 ${isMatch ? "bg-indigo-50" : ""}`}>
                      <td className="px-3 py-3">
                        <div className="font-medium text-zinc-900">{(r as any).id}</div>
                        <div className="text-xs text-zinc-500">{(r as any).reason || "—"}</div>
                      </td>

                      <td className="px-3 py-3">
                        <div className="text-zinc-900">{getRequestorName(r)}</div>
                        {r?.requestedBy ? <div className="text-[11px] text-zinc-500">{r?.requestedBy.email}</div> : null}
                      </td>

                      <td className="px-3 py-3">
                        <div className="text-zinc-900">
                          Order:{" "}
                          {r.orderId ? (
                            <Link to={orderHref(r.orderId)} className="font-semibold text-indigo-700 hover:underline" title="Open order">
                              {r.orderId}
                            </Link>
                          ) : (
                            <b>—</b>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500">
                          PO: <b>{(r as any).purchaseOrderId}</b>
                        </div>
                      </td>

                      <td className="px-3 py-3">
                        <StatusPill status={(r as any).status} />
                        {(r as any).supplierNote ? (
                          <div className="text-[11px] text-zinc-500 mt-1 line-clamp-2">{(r as any).supplierNote}</div>
                        ) : null}
                      </td>

                      <td className="px-3 py-3">
                        <div className="font-semibold text-zinc-900">{ngn.format(normMoney((r as any).totalAmount))}</div>
                      </td>

                      <td className="px-3 py-3">
                        <div className="text-zinc-900">{fmtDate((r as any).requestedAt || (r as any).createdAt)}</div>
                        <div className="text-[11px] text-zinc-500">Responded: {fmtDate((r as any).supplierRespondedAt)}</div>
                      </td>

                      <td className="px-3 py-3">
                        <div className="text-zinc-900">{(r as any).provider || "—"}</div>
                        <div className="text-[11px] text-zinc-500">{(r as any).providerReference || (r as any).providerStatus || "—"}</div>
                      </td>

                      <td className="px-3 py-3 text-right">
                        <EvidenceThumbs urls={evidenceUrls} />
                      </td>

                      <td className="sticky right-0 z-10 px-3 py-3 text-right bg-white shadow-[-8px_0_12px_-10px_rgba(0,0,0,0.25)]">
                        {isAdmin ? (
                          <div className="text-[11px] text-zinc-500">Admin view (read-only)</div>
                        ) : (
                          <div className="inline-flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              disabled={!canAct || actM.isPending}
                              onClick={() => openActionModal(r, "ACCEPT")}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              disabled={!canAct || actM.isPending}
                              onClick={() => openActionModal(r, "REJECT")}
                              className="px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              disabled={!canAct || actM.isPending}
                              onClick={() => openActionModal(r, "ESCALATE")}
                              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                              Escalate
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {refundsQ.isError && (
            <div className="mt-3 text-sm text-rose-700">
              Failed to load refunds.{" "}
              <button className="underline" onClick={() => refundsQ.refetch()}>
                Retry
              </button>
            </div>
          )}
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}
