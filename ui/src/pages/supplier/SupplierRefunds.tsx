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

type RefundEvidenceItem = {
  itemId: string;
  title?: string | null;
  qty?: number | null;
  urls: string[];
  count?: number;
};

type RefundLineItem = {
  id?: string;
  qty?: number | null;
  orderItem?: {
    id?: string | null;
    title?: string | null;
    quantity?: number | null;
    unitPrice?: any;
    lineTotal?: any;
  } | null;
  evidenceUrls?: string[];
  evidenceCount?: number;
};

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

  evidenceUrls?: string[];
  evidenceCount?: number;
  evidenceItemCount?: number;
  evidenceByItemId?: Record<string, string[]>;
  evidenceItems?: RefundEvidenceItem[];
  items?: RefundLineItem[];
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
  const v =
    r?.evidenceUrls ??
    r?.meta?.evidenceUrls ??
    r?.meta?.evidence ??
    r?.meta?.evidenceByItemId ??
    r?.evidenceByItemId ??
    null;

  const out: string[] = [];

  const pushAny = (x: any) => {
    if (!x) return;
    if (Array.isArray(x)) {
      x.forEach(pushAny);
      return;
    }

    if (typeof x === "string") {
      const s = x.trim();
      if (!s) return;

      if (s.startsWith("[") && s.endsWith("]")) {
        try {
          const arr = JSON.parse(s);
          if (Array.isArray(arr)) {
            pushAny(arr);
            return;
          }
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

      if (!Array.isArray(x) && Object.keys(x).length) {
        Object.values(x).forEach(pushAny);
      }
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

function getEvidenceItems(r: any): RefundEvidenceItem[] {
  const direct = Array.isArray(r?.evidenceItems) ? r.evidenceItems : [];
  if (direct.length) {
    return direct
      .map((it: any) => ({
        itemId: String(it?.itemId ?? "").trim(),
        title: it?.title ?? null,
        qty: Number.isFinite(Number(it?.qty)) ? Number(it.qty) : null,
        urls: Array.isArray(it?.urls)
          ? it.urls.filter((u: any) => isUrlish(String(u || "").trim())).map((u: any) => String(u).trim())
          : [],
        count: Number.isFinite(Number(it?.count)) ? Number(it.count) : undefined,
      }))
      .filter((it: RefundEvidenceItem) => it.itemId && it.urls.length > 0);
  }

  const items = Array.isArray(r?.items) ? r.items : [];
  const fromItems = items
    .map((row: any) => {
      const itemId = String(row?.orderItem?.id ?? row?.orderItemId ?? "").trim();
      const urls = Array.isArray(row?.evidenceUrls)
        ? row.evidenceUrls.filter((u: any) => isUrlish(String(u || "").trim())).map((u: any) => String(u).trim())
        : [];
      if (!itemId || !urls.length) return null;

      return {
        itemId,
        title: row?.orderItem?.title ?? "Item",
        qty: Number.isFinite(Number(row?.qty ?? row?.orderItem?.quantity))
          ? Number(row?.qty ?? row?.orderItem?.quantity)
          : null,
        urls,
        count: urls.length,
      } as RefundEvidenceItem;
    })
    .filter(Boolean) as RefundEvidenceItem[];

  return fromItems;
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

function EvidenceThumbs({ urls, max = 3, size = 9 }: { urls: string[]; max?: number; size?: number }) {
  if (!urls.length) return <span className="text-xs text-zinc-400">—</span>;

  const shown = urls.slice(0, max);
  const rest = urls.length - shown.length;

  const sizeClass =
    size === 8 ? "h-8 w-8" :
    size === 9 ? "h-9 w-9" :
    size === 10 ? "h-10 w-10" :
    size === 12 ? "h-12 w-12" :
    "h-9 w-9";

  return (
    <div className="inline-flex items-center gap-2">
      <div className="flex items-center gap-2">
        {shown.map((u, idx) => (
          <a
            key={`${u}-${idx}`}
            href={u}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center"
            title="Open evidence"
          >
            <img
              src={u}
              alt="Evidence"
              loading="lazy"
              className={`${sizeClass} rounded-lg border object-cover group-hover:opacity-90`}
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
  const { openModal, closeModal } = useModal();
  const toast = useToast();
  const navigate = useNavigate();

  const role = useAuthStore((s: any) => s.user?.role);
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

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
  }, [refundId, searchParams, setSearchParams]);

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
      withCredentials: true,
      params: {
        ...params,
        supplierId: adminSupplierId,
      },
    });
    const payload = (data as any)?.data ?? data;
    const rows = (payload as any)?.data ?? payload;
    return { data: Array.isArray(rows) ? rows : [] };
  }

  async function refundAction(id: string, body: { action: "ACCEPT" | "REJECT" | "ESCALATE"; note?: string }) {
    const { data } = await api.post(`/api/supplier/refunds/${encodeURIComponent(id)}/action`, body, {
      withCredentials: true,
      params: { supplierId: adminSupplierId },
    });
    return (data as any)?.data ?? data;
  }

  const refundsQ = useQuery({
    queryKey: ["supplier", "refunds", { q, status, supplierId: adminSupplierId }],
    enabled: !isAdmin || !!adminSupplierId,
    queryFn: async () =>
      fetchRefunds({
        q: q || undefined,
        status: status || undefined,
        take: 50,
        skip: 0,
      }),
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
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
  const evidenceUrls = getEvidenceUrls(r);
  const evidenceItems = getEvidenceItems(r);

  const title =
    action === "ACCEPT"
      ? "Accept refund?"
      : action === "REJECT"
        ? "Reject refund?"
        : "Escalate to admin?";

  const icon =
    action === "ACCEPT" ? (
      <CheckCircle2 size={18} className="text-emerald-700" />
    ) : action === "REJECT" ? (
      <XCircle size={18} className="text-rose-700" />
    ) : (
      <AlertTriangle size={18} className="text-indigo-700" />
    );

  function ActionModalBody() {
    const [noteVal, setNoteVal] = useState("");

    const handleSubmit = () => {
      closeModal();
      actM.mutate({
        id: r.id,
        action,
        note: noteVal.trim() || undefined,
      });
    };

    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5">{icon}</div>
          <div className="min-w-0">
            <div className="text-sm text-zinc-800">
              Refund <b>{r.id}</b> • Order <b>{r.orderId}</b> • PO <b>{r.purchaseOrderId}</b>
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Status: <StatusPill status={r.status} /> • Total:{" "}
              <b>{ngn.format(normMoney(r.totalAmount))}</b>
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

          {evidenceItems.length > 0 ? (
            <div className="mt-3 space-y-3">
              {evidenceItems.map((item) => (
                <div key={item.itemId} className="rounded-lg border bg-zinc-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-900 truncate">
                        {item.title || "Item"}
                      </div>
                      <div className="text-xs text-zinc-500">
                        Item ID: <span className="font-mono">{item.itemId}</span>
                        {item.qty ? <> • Qty {item.qty}</> : null}
                      </div>
                    </div>
                    <div className="text-xs text-zinc-500 shrink-0">
                      {item.urls.length} image(s)
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {item.urls.map((u, idx) => (
                      <a
                        key={`${item.itemId}-${u}-${idx}`}
                        href={u}
                        target="_blank"
                        rel="noreferrer"
                        className="block"
                      >
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
                </div>
              ))}
            </div>
          ) : evidenceUrls.length ? (
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {evidenceUrls.map((u, idx) => (
                <a key={`${u}-${idx}`} href={u} target="_blank" rel="noreferrer" className="block">
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
            value={noteVal}
            onChange={(e) => setNoteVal(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => closeModal()}
            className="px-3 py-1.5 rounded-md text-sm border bg-white hover:bg-black/5"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={actM.isPending}
            className={`px-3 py-1.5 rounded-md text-sm text-white disabled:opacity-60 ${
              action === "ACCEPT"
                ? "bg-emerald-600 hover:bg-emerald-700"
                : action === "REJECT"
                  ? "bg-rose-600 hover:bg-rose-700"
                  : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {action === "ESCALATE" ? "Escalate" : action === "ACCEPT" ? "Accept" : "Reject"}
          </button>
        </div>
      </div>
    );
  }

  openModal({
    title,
    message: <ActionModalBody />,
    disableOverlayClose: true,
  });
}

  const viewingRefundId = (refundId ?? "").trim();

  const RefundCard = ({ r }: { r: SupplierRefundRow }) => {
    const canAct = canSupplierAct((r as any).status);
    const evidenceUrls = getEvidenceUrls(r);
    const evidenceItems = getEvidenceItems(r);
    const isMatch = viewingRefundId && String((r as any).id) === viewingRefundId;

    return (
      <div className={`rounded-2xl border bg-white p-4 shadow-sm ${isMatch ? "border-indigo-300 bg-indigo-50/40" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-semibold text-zinc-900 truncate">{(r as any).id}</div>
              <StatusPill status={(r as any).status} />
            </div>
            <div className="text-xs text-zinc-500 mt-1 line-clamp-2">{(r as any).reason || "—"}</div>
          </div>

          <div className="text-right shrink-0">
            <div className="font-semibold text-zinc-900">{ngn.format(normMoney((r as any).totalAmount))}</div>
            <div className="text-[11px] text-zinc-500">{fmtDate((r as any).requestedAt || (r as any).createdAt)}</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-500">Requested by</span>
            <span className="text-xs text-zinc-900 truncate">{getRequestorName(r)}</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-500">Order</span>
            {r.orderId ? (
              <Link
                to={orderHref(r.orderId)}
                className="text-xs font-semibold text-indigo-700 hover:underline truncate"
                title="Open order"
              >
                {r.orderId}
              </Link>
            ) : (
              <span className="text-xs text-zinc-700">—</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-500">PO</span>
            <span className="text-xs text-zinc-800 truncate">{(r as any).purchaseOrderId || "—"}</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-500">Provider</span>
            <span className="text-xs text-zinc-800 truncate">
              {(r as any).provider || "—"}{" "}
              <span className="text-[11px] text-zinc-500">
                {(r as any).providerReference || (r as any).providerStatus ? `• ${(r as any).providerReference || (r as any).providerStatus}` : ""}
              </span>
            </span>
          </div>

          <div className="flex items-start justify-between gap-2">
            <span className="text-xs text-zinc-500 inline-flex items-center gap-1 pt-1">
              <ImageIcon size={14} /> Evidence
            </span>
            <div className="text-right">
              <div className="inline-flex justify-end">
                <EvidenceThumbs urls={evidenceUrls} max={3} size={9} />
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">
                {evidenceItems.length > 0
                  ? `${evidenceItems.length} item${evidenceItems.length === 1 ? "" : "s"} with evidence`
                  : evidenceUrls.length > 0
                    ? `${evidenceUrls.length} image${evidenceUrls.length === 1 ? "" : "s"}`
                    : "No evidence"}
              </div>
            </div>
          </div>

          {evidenceItems.length > 0 ? (
            <div className="rounded-xl border bg-zinc-50 p-2">
              <div className="space-y-2">
                {evidenceItems.slice(0, 2).map((item) => (
                  <div key={item.itemId} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-zinc-900 truncate">{item.title || "Item"}</div>
                      <div className="text-[11px] text-zinc-500">
                        {item.qty ? `Qty ${item.qty} • ` : ""}
                        {item.urls.length} image{item.urls.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <EvidenceThumbs urls={item.urls} max={2} size={8} />
                  </div>
                ))}
                {evidenceItems.length > 2 ? (
                  <div className="text-[11px] text-zinc-500">+{evidenceItems.length - 2} more item(s)</div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-3">
          {isAdmin ? (
            <div className="text-[11px] text-zinc-500">Admin view (read-only)</div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={!canAct || actM.isPending}
                onClick={() => openActionModal(r, "ACCEPT")}
                className="w-full px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={!canAct || actM.isPending}
                onClick={() => openActionModal(r, "REJECT")}
                className="w-full px-3 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                disabled={!canAct || actM.isPending}
                onClick={() => openActionModal(r, "ESCALATE")}
                className="w-full px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
              >
                Escalate
              </button>
            </div>
          )}
        </div>

        {(r as any).supplierNote ? (
          <div className="mt-3 rounded-xl border bg-white/60 px-3 py-2">
            <div className="text-[11px] text-zinc-500">Supplier note</div>
            <div className="text-sm text-zinc-800 mt-0.5 line-clamp-3">{(r as any).supplierNote}</div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <SiteLayout>
      <SupplierLayout>
        <div className="mt-6">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
          >
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
                <ClipboardList size={20} /> Refunds
              </h1>
              <p className="text-sm text-zinc-600 mt-1">
                Accept, reject, or escalate refunds tied to this supplier’s purchase orders.
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs text-zinc-700">
                  Pending: <b>{totals.pending}</b>
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs text-zinc-700">
                  Total requested: <b>{ngn.format(totals.total)}</b>
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs text-zinc-700">
                  Rows: <b>{refundsQ.isFetching ? "…" : rows.length}</b>
                </span>
              </div>

              {isAdmin && !adminSupplierId ? (
                <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  Select a supplier first (Supplier Dashboard) or add <b>?supplierId=...</b> to the URL.
                </div>
              ) : null}

              {viewingRefundId ? (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border bg-indigo-50 px-3 py-1 text-xs text-indigo-700">
                  Viewing refund: <b className="font-semibold">{viewingRefundId}</b>
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => navigate(withSupplierCtx("/supplier/refunds"), { replace: true })}
                  >
                    Clear
                  </button>
                </div>
              ) : null}
            </div>

            <div className="flex gap-2 sm:justify-end">
              <button
                onClick={() => refundsQ.refetch()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm hover:bg-black/5 w-full sm:w-auto"
              >
                <RefreshCcw size={16} /> Refresh
              </button>
            </div>
          </motion.div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={q}
                onChange={(e) => onChangeQ(e.target.value)}
                placeholder="Search refund / order / PO / reference…"
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

          <div className="mt-4 space-y-3 md:hidden">
            {refundsQ.isLoading ? (
              <>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-2xl border bg-white p-4 shadow-sm animate-pulse">
                    <div className="h-4 w-1/2 bg-zinc-200 rounded" />
                    <div className="mt-3 h-3 w-2/3 bg-zinc-200 rounded" />
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="h-10 bg-zinc-200 rounded-xl" />
                      <div className="h-10 bg-zinc-200 rounded-xl" />
                    </div>
                  </div>
                ))}
              </>
            ) : refundsQ.isError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
                Failed to load refunds.{" "}
                <button className="underline" onClick={() => refundsQ.refetch()}>
                  Retry
                </button>
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-2xl border bg-white px-4 py-8 text-center text-zinc-500 shadow-sm">
                No refunds found.
              </div>
            ) : (
              rows.map((r) => <RefundCard key={(r as any).id} r={r} />)
            )}
          </div>

          <div className="hidden md:block mt-4 rounded-2xl border bg-white shadow-sm overflow-x-auto">
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
                  const evidenceItems = getEvidenceItems(r);
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
                            <Link
                              to={orderHref(r.orderId)}
                              className="font-semibold text-indigo-700 hover:underline"
                              title="Open order"
                            >
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
                        <div className="text-[11px] text-zinc-500">
                          {(r as any).providerReference || (r as any).providerStatus || "—"}
                        </div>
                      </td>

                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex flex-col items-end gap-1">
                          <div className="inline-flex justify-end">
                            <EvidenceThumbs urls={evidenceUrls} />
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {evidenceItems.length > 0
                              ? `${evidenceItems.length} item${evidenceItems.length === 1 ? "" : "s"}`
                              : evidenceUrls.length > 0
                                ? `${evidenceUrls.length} image${evidenceUrls.length === 1 ? "" : "s"}`
                                : "—"}
                          </div>
                        </div>
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
            <div className="hidden md:block mt-3 text-sm text-rose-700">
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