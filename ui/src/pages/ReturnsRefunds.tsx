import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Info,
  RefreshCcw,
  PackageOpen,
  FileText,
  Image as ImageIcon,
  ArrowRight,
} from "lucide-react";

import api from "../api/client.js";
import { useAuthStore } from "../store/auth";
import SiteLayout from "../layouts/SiteLayout.js";
import StatusDot from "../components/StatusDot.js";
import { useModal } from "../components/ModalProvider";

/* ---------------- “Silver” UI helpers ---------------- */
const SILVER_BORDER = "border border-zinc-200/80";
const SILVER_SHADOW_SM = "shadow-[0_8px_20px_rgba(148,163,184,0.18)]";
const SILVER_SHADOW_MD = "shadow-[0_12px_30px_rgba(148,163,184,0.22)]";

const CARD_2XL = `rounded-2xl ${SILVER_BORDER} bg-white ${SILVER_SHADOW_MD}`;
const CARD_XL = `rounded-xl ${SILVER_BORDER} bg-white ${SILVER_SHADOW_SM}`;

/* ---------------- Mobile typography helpers ---------------- */
const T_BASE = "text-[12px] sm:text-sm";
const T_SM = "text-[11px] sm:text-xs";
const T_XS = "text-[10px] sm:text-[11px]";
const T_LABEL = "text-[10px] sm:text-xs text-ink-soft";
const INP = "text-[12px] sm:text-sm";
const BTN = "text-[12px] sm:text-sm";
const BTN_XS = "text-[11px] sm:text-xs";

/* ---------------- Cookie auth helpers ---------------- */
const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function isAuthError(e: any) {
  const status = e?.response?.status;
  return status === 401 || status === 403;
}

/* ---------------- Types ---------------- */
type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | string;

type RefundEventRow = {
  id: string;
  type?: string | null;
  message?: string | null;
  createdAt?: string | null;
};

type RefundItemRow = {
  id: string;
  orderItem?: {
    id: string;
    title?: string | null;
    quantity?: number | string | null;
    unitPrice?: number | string | null;
  } | null;
};

type RefundRow = {
  id: string;
  orderId?: string | null;
  status?: string | null;
  reason?: string | null;
  message?: string | null;
  createdAt?: string | null;
  amount?: number | string | null;
  meta?: any | null;
  evidenceUrls?: string[];
  supplier?: { id: string; name?: string | null } | null;
  purchaseOrder?: { id: string; status?: string | null; payoutStatus?: string | null } | null;
  events?: RefundEventRow[];
  items?: RefundItemRow[];
};

type CustomerRow = {
  id: string;
  email?: string | null;
  name?: string | null;
};

type CustomerOption = CustomerRow & {
  label: string;
  _search: string;
};

type RefundsMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  take?: number;
  skip?: number;
  role?: string;
};

type RefundsQueryResult = {
  rows: RefundRow[];
  meta: RefundsMeta;
};

/* ---------------- Refund normalization ---------------- */
function normalizeRefund(r: any): RefundRow {
  const evidenceUrls =
    (Array.isArray(r?.meta?.evidenceUrls) && r.meta.evidenceUrls) ||
    (Array.isArray(r?.meta?.images) && r.meta.images) ||
    [];

  return {
    id: String(r?.id ?? ""),
    orderId: r?.orderId ? String(r.orderId) : null,
    status: r?.status ?? null,
    reason: r?.reason ?? null,
    message: r?.message ?? null,
    createdAt: r?.createdAt ?? null,
    amount: r?.amount ?? r?.total ?? r?.refundAmount ?? null,
    meta: r?.meta ?? null,
    evidenceUrls,
    supplier: r?.supplier
      ? { id: String(r.supplier.id ?? ""), name: r.supplier.name ?? null }
      : null,
    purchaseOrder: r?.purchaseOrder
      ? {
          id: String(r.purchaseOrder.id ?? ""),
          status: r.purchaseOrder.status ?? null,
          payoutStatus: r.purchaseOrder.payoutStatus ?? null,
        }
      : null,
    events: Array.isArray(r?.events)
      ? r.events.map((e: any): RefundEventRow => ({
          id: String(e?.id ?? ""),
          type: e?.type ?? null,
          message: e?.message ?? null,
          createdAt: e?.createdAt ?? null,
        }))
      : [],
    items: Array.isArray(r?.items)
      ? r.items.map((it: any): RefundItemRow => ({
          id: String(it?.id ?? it?.orderItemId ?? ""),
          orderItem: it?.orderItem
            ? {
                id: String(it.orderItem.id ?? ""),
                title: it.orderItem.title ?? null,
                quantity: it.orderItem.quantity ?? null,
                unitPrice: it.orderItem.unitPrice ?? null,
              }
            : null,
        }))
      : [],
  };
}

function normalizeRefunds(payload: any): RefundRow[] {
  const list =
    (payload && Array.isArray(payload.data) && payload.data) ||
    (Array.isArray(payload) && payload) ||
    (payload && Array.isArray(payload.results) && payload.results) ||
    [];
  return list.map(normalizeRefund);
}

function normalizeRefundsResponse(payload: any, fallbackPage: number, fallbackPageSize: number): RefundsQueryResult {
  const rows = normalizeRefunds(payload);

  const rawMeta = payload?.meta ?? {};
  const total = Number(rawMeta.total ?? rows.length ?? 0);
  const page = Math.max(1, Number(rawMeta.page ?? fallbackPage ?? 1) || 1);
  const pageSize = Math.max(1, Number(rawMeta.pageSize ?? rawMeta.take ?? fallbackPageSize ?? PAGE_SIZE) || PAGE_SIZE);
  const totalPages = Math.max(
    1,
    Number(rawMeta.totalPages ?? Math.ceil(total / Math.max(1, pageSize)) ?? 1) || 1
  );

  return {
    rows,
    meta: {
      total,
      page,
      pageSize,
      totalPages,
      take: Number(rawMeta.take ?? pageSize),
      skip: Number(rawMeta.skip ?? (page - 1) * pageSize),
      role: rawMeta.role ? String(rawMeta.role) : undefined,
    },
  };
}

/* ---------------- Customers normalization ---------------- */
function normalizeCustomers(payload: any): CustomerRow[] {
  const list =
    (payload && Array.isArray(payload.data) && payload.data) ||
    (Array.isArray(payload) && payload) ||
    (payload && Array.isArray(payload.results) && payload.results) ||
    [];

  return list.map((u: any): CustomerRow => {
    const id = String(u?.id ?? "");
    const email = u?.email ?? null;

    let name: string | null = null;

    if (u?.name && typeof u.name === "string" && u.name.trim()) {
      name = u.name.trim();
    } else {
      const parts: string[] = [];
      if (u?.firstName) parts.push(String(u.firstName));
      if (u?.lastName) parts.push(String(u.lastName));
      if (parts.length) name = parts.join(" ");
    }

    return { id, email, name };
  });
}

/* ---------------- Utils ---------------- */
const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const fmtN = (n?: number | string | null) => {
  if (n == null) return 0;
  if (typeof n === "number") return Number.isFinite(n) ? n : 0;
  const cleaned = String(n).replace(/[^\d.-]/g, "");
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : 0;
};

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(+d)
    ? String(s)
    : d.toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

const todayYMD = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);

  return debounced;
}

/* ---------------- Pagination UI ---------------- */
const PAGE_SIZE = 10;

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const go = (p: number) => {
    if (p < 1 || p > totalPages || p === page) return;
    onChange(p);
  };

  const pages: number[] = [];
  const maxButtons = 5;
  let start = Math.max(1, page - 2);
  let end = Math.min(totalPages, start + maxButtons - 1);
  if (end - start + 1 < maxButtons) start = Math.max(1, end - maxButtons + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="mt-3 flex items-center justify-center gap-1.5 sm:gap-2">
      <button
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        className={`px-2 py-1.5 sm:px-3 sm:py-1.5 ${BTN_XS} rounded-lg ${SILVER_BORDER} bg-white disabled:opacity-40`}
      >
        Prev
      </button>

      {start > 1 && (
        <>
          <button
            onClick={() => go(1)}
            className={`px-2 py-1.5 sm:px-3 sm:py-1.5 ${BTN_XS} rounded-lg ${SILVER_BORDER} ${
              page === 1 ? "bg-zinc-900 text-white border-zinc-900" : "bg-white"
            }`}
          >
            1
          </button>
          {start > 2 && <span className={`px-1 ${T_XS} text-ink-soft`}>…</span>}
        </>
      )}

      {pages.map((p) => (
        <button
          key={p}
          onClick={() => go(p)}
          className={`px-2 py-1.5 sm:px-3 sm:py-1.5 ${BTN_XS} rounded-lg ${SILVER_BORDER} ${
            p === page ? "bg-zinc-900 text-white border-zinc-900" : "bg-white hover:bg-black/5"
          }`}
        >
          {p}
        </button>
      ))}

      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className={`px-1 ${T_XS} text-ink-soft`}>…</span>}
          <button
            onClick={() => go(totalPages)}
            className={`px-2 py-1.5 sm:px-3 sm:py-1.5 ${BTN_XS} rounded-lg ${SILVER_BORDER} ${
              page === totalPages ? "bg-zinc-900 text-white border-zinc-900" : "bg-white"
            }`}
          >
            {totalPages}
          </button>
        </>
      )}

      <button
        onClick={() => go(page + 1)}
        disabled={page >= totalPages}
        className={`px-2 py-1.5 sm:px-3 sm:py-1.5 ${BTN_XS} rounded-lg ${SILVER_BORDER} bg-white disabled:opacity-40`}
      >
        Next
      </button>
    </div>
  );
}

/* ---------------- Small bits ---------------- */
function SkeletonRow({
  cols = 5,
  mode = "table",
}: {
  cols?: number;
  mode?: "table" | "card";
}) {
  if (mode === "card") {
    return (
      <div className={`${CARD_2XL} p-3 animate-pulse`}>
        <div className="h-3 w-1/2 bg-zinc-200 rounded" />
        <div className="mt-3 h-3 w-3/4 bg-zinc-200 rounded" />
        <div className="mt-2 h-3 w-2/3 bg-zinc-200 rounded" />
        <div className="mt-4 h-8 w-24 bg-zinc-200 rounded" />
      </div>
    );
  }

  return (
    <tr className="animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-3 rounded bg-zinc-200" />
        </td>
      ))}
    </tr>
  );
}

const RefundFilters = React.memo(function RefundFilters({
  isAdmin,
  customersLoading,
  customers,
  customerKeyInput,
  setCustomerKeyInput,
  activeCustomerKey,
  setActiveCustomerKey,
  setExpandedId,
  setPage,
  q,
  setQ,
  searchParams,
  setSearchParams,
  statusFilter,
  setStatusFilter,
  statusOptions,
  reasonFilter,
  setReasonFilter,
  reasonOptions,
  from,
  setFrom,
  to,
  setTo,
  isTodayActive,
  toggleToday,
  clearFilters,
  refundsRefetch,
  queriesEnabled,
  filteredCount,
  loading,
  pageStart,
  pageEnd,
  serverTotal,
}: {
  isAdmin: boolean;
  customersLoading: boolean;
  customers: CustomerRow[];
  customerKeyInput: string;
  setCustomerKeyInput: React.Dispatch<React.SetStateAction<string>>;
  activeCustomerKey: string | null;
  setActiveCustomerKey: React.Dispatch<React.SetStateAction<string | null>>;
  setExpandedId: React.Dispatch<React.SetStateAction<string | null>>;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  q: string;
  setQ: React.Dispatch<React.SetStateAction<string>>;
  searchParams: URLSearchParams;
  setSearchParams: (
    nextInit: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams),
    navigateOpts?: { replace?: boolean }
  ) => void;
  statusFilter: string;
  setStatusFilter: React.Dispatch<React.SetStateAction<string>>;
  statusOptions: string[];
  reasonFilter: string;
  setReasonFilter: React.Dispatch<React.SetStateAction<string>>;
  reasonOptions: string[];
  from: string;
  setFrom: React.Dispatch<React.SetStateAction<string>>;
  to: string;
  setTo: React.Dispatch<React.SetStateAction<string>>;
  isTodayActive: boolean;
  toggleToday: () => void;
  clearFilters: () => void;
  refundsRefetch: () => void;
  queriesEnabled: boolean;
  filteredCount: number;
  loading: boolean;
  pageStart: number;
  pageEnd: number;
  serverTotal: number;
}) {
  const [localCustomerInput, setLocalCustomerInput] = useState(customerKeyInput);
  const [localQ, setLocalQ] = useState(q);
  const debouncedQ = useDebouncedValue(localQ, 350);

  useEffect(() => {
    setLocalCustomerInput(customerKeyInput);
  }, [customerKeyInput]);

  useEffect(() => {
    setLocalQ(q);
  }, [q]);

  useEffect(() => {
    if (debouncedQ === q) return;
    setQ(debouncedQ);
  }, [debouncedQ, q, setQ]);

  const customerSearchBase = useMemo<CustomerOption[]>(() => {
    if (!isAdmin || !customers.length) return [];

    return customers.map((c) => {
      const name = (c.name || "").trim();
      const email = (c.email || "").trim();
      const labelParts = [name || null, email || null, c.id].filter(Boolean);
      const label = labelParts.join(" • ");

      return {
        ...c,
        label,
        _search: [name, email, c.id].join(" ").toLowerCase(),
      };
    });
  }, [customers, isAdmin]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearchBase.length) return [];
    const needle = localCustomerInput.trim().toLowerCase();

    if (!needle) return customerSearchBase.slice(0, 20);
    return customerSearchBase.filter((c) => c._search.includes(needle)).slice(0, 20);
  }, [customerSearchBase, localCustomerInput]);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        {isAdmin && (
          <div className="md:col-span-4">
            <label className={T_LABEL}>View as customer (ID or email)</label>
            <input
              value={localCustomerInput}
              onChange={(e) => setLocalCustomerInput(e.target.value)}
              placeholder={
                customersLoading ? "Loading customers…" : "Type name, email or ID to search"
              }
              autoComplete="off"
              spellCheck={false}
              className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`rounded-lg ${SILVER_BORDER} bg-white px-3 py-1.5 ${BTN_XS} hover:bg-black/5`}
                onClick={() => {
                  const v = localCustomerInput.trim();
                  setCustomerKeyInput(v);
                  setActiveCustomerKey(v || null);
                  setExpandedId(null);
                  setPage(1);
                }}
                disabled={!localCustomerInput.trim()}
              >
                Apply
              </button>

              <button
                type="button"
                className={`rounded-lg ${SILVER_BORDER} bg-white px-3 py-1.5 ${BTN_XS} hover:bg-black/5`}
                onClick={() => {
                  setLocalCustomerInput("");
                  setCustomerKeyInput("");
                  setActiveCustomerKey(null);
                  setExpandedId(null);
                  setPage(1);
                }}
                disabled={!activeCustomerKey && !localCustomerInput}
              >
                Clear view-as
              </button>

              {activeCustomerKey && (
                <span className={`${T_XS} text-ink-soft`}>
                  Viewing refunds for <span className="font-mono text-ink">{activeCustomerKey}</span>
                </span>
              )}
            </div>

            <div className="mt-2">
              {customersLoading && (
                <div className={`${T_XS} text-ink-soft`}>Loading customers…</div>
              )}

              {!customersLoading && customers.length === 0 && (
                <div className={`${T_XS} text-ink-soft`}>No customers found.</div>
              )}

              {!customersLoading && customers.length > 0 && (
                <div className="mt-1 max-h-52 overflow-auto rounded-xl border border-zinc-200 bg-white">
                  {filteredCustomers.length === 0 ? (
                    <div className={`${T_XS} px-3 py-2 text-ink-soft`}>
                      No customers match “{localCustomerInput.trim()}”.
                    </div>
                  ) : (
                    filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left px-3 py-1.5 hover:bg-black/5 flex flex-col gap-0.5"
                        onClick={() => {
                          const display = c.email || c.id;
                          setLocalCustomerInput(display);
                          setCustomerKeyInput(display);
                          setActiveCustomerKey(c.id);
                          setExpandedId(null);
                          setPage(1);
                        }}
                      >
                        <span className={`${T_XS} text-ink`}>{c.label}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className={isAdmin ? "md:col-span-3" : "md:col-span-4"}>
          <label className={T_LABEL}>Search</label>
          <input
            value={localQ}
            onChange={(e) => setLocalQ(e.target.value)}
            onBlur={() => {
              const sp = new URLSearchParams(searchParams);
              if (localQ.trim()) sp.set("q", localQ.trim());
              else sp.delete("q");
              setSearchParams(sp, { replace: true });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const sp = new URLSearchParams(searchParams);
                if (localQ.trim()) sp.set("q", localQ.trim());
                else sp.delete("q");
                setSearchParams(sp, { replace: true });
              }
            }}
            placeholder="Refund ID, order ID, supplier, reason…"
            autoComplete="off"
            spellCheck={false}
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          />
        </div>

        <div className="md:col-span-3">
          <label className={T_LABEL}>Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          >
            <option value="ALL">All</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-3">
          <label className={T_LABEL}>Reason</label>
          <select
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value)}
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          >
            <option value="ALL">All</option>
            {reasonOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-3">
          <label className={T_LABEL}>From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          />
        </div>

        <div className="md:col-span-3">
          <label className={T_LABEL}>To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={`rounded-lg ${SILVER_BORDER} bg-white px-3 py-2 ${BTN} hover:bg-black/5 inline-flex items-center gap-1.5`}
          onClick={refundsRefetch}
          disabled={!queriesEnabled}
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>

        <button
          className={`rounded-lg ${SILVER_BORDER} bg-white px-3 py-2 ${BTN} hover:bg-black/5`}
          onClick={clearFilters}
        >
          Clear filters
        </button>

        <button
          type="button"
          aria-pressed={isTodayActive}
          onClick={toggleToday}
          className={`rounded-lg px-3 py-2 ${BTN} border transition ${
            isTodayActive
              ? "bg-zinc-900 text-white border-zinc-900"
              : `bg-white ${SILVER_BORDER} hover:bg-black/5`
          }`}
        >
          Today
        </button>

        <div className={`ml-auto ${T_SM} text-ink-soft`}>
          {loading ? (
            "Loading refunds…"
          ) : filteredCount > 0 ? (
            <>
              Showing {pageStart}-{pageEnd} of {filteredCount} on this page
              <span className="ml-2">• {serverTotal} total from server</span>
            </>
          ) : (
            <>No matching refunds on this page{serverTotal > 0 ? ` • ${serverTotal} total from server` : ""}</>
          )}
          {isTodayActive && filteredCount > 0 && <span className="ml-2">(today)</span>}
        </div>
      </div>
    </>
  );
});

/* ---------------- Page ---------------- */
export default function ReturnsRefundsPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { openModal } = useModal();

  const storeUser = useAuthStore((s) => s.user);
  const storeRole = (storeUser?.role || "") as Role;

  const [searchParams, setSearchParams] = useSearchParams();

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [reasonFilter, setReasonFilter] = useState<string>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [customerKeyInput, setCustomerKeyInput] = useState("");
  const [activeCustomerKey, setActiveCustomerKey] = useState<string | null>(null);

  const meQ = useQuery({
    queryKey: ["me-min"],
    queryFn: async () =>
      (await api.get("/api/profile/me", AXIOS_COOKIE_CFG)).data as { role: Role; id?: string },
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const authReady = meQ.isSuccess || meQ.isError;
  const role: Role = (storeRole || meQ.data?.role || "SHOPPER") as Role;

  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const isSupplier = String(role || "").toUpperCase() === "SUPPLIER";

  const mustLogin = authReady && (meQ.isError ? isAuthError(meQ.error) : false);
  const mustGoSupplier = authReady && !mustLogin && isSupplier;

  const queriesEnabled = authReady && !mustLogin && !mustGoSupplier;

  const customersQ = useQuery({
    queryKey: ["refunds-customers"],
    enabled: queriesEnabled && isAdmin,
    queryFn: async () => {
      const urls = [
        "/api/admin/customers",
        "/api/admin/users?role=SHOPPER",
        "/api/admin/customers/all",
      ];
      let lastErr: any = null;
      for (const url of urls) {
        try {
          const { data } = await api.get(url, AXIOS_COOKIE_CFG);
          return normalizeCustomers(data);
        } catch (e: any) {
          lastErr = e;
          if (isAuthError(e)) throw e;
        }
      }
      console.warn("Customer list fetch failed", lastErr);
      return [] as CustomerRow[];
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const customers = (customersQ.data || []) as CustomerRow[];

  const refundsQ = useQuery({
    queryKey: [
      "refunds",
      isAdmin ? "admin" : "mine",
      isAdmin ? activeCustomerKey || "all" : "self",
      page,
      PAGE_SIZE,
      deferredQ.trim(),
      statusFilter,
    ],
    enabled: queriesEnabled,
    queryFn: async () => {
      const urls = isAdmin
        ? ["/api/refunds", "/api/refunds/all"]
        : ["/api/refunds", "/api/orders/refunds/mine"];

      let lastErr: any = null;

      const params: Record<string, any> = {
        page,
        pageSize: PAGE_SIZE,
      };

      if (deferredQ.trim()) {
        params.q = deferredQ.trim();
      }

      if (statusFilter !== "ALL") {
        params.status = statusFilter;
      }

      if (isAdmin && activeCustomerKey) {
        params.customer = activeCustomerKey;
      }

      for (const url of urls) {
        try {
          const { data } = await api.get(url, {
            ...AXIOS_COOKIE_CFG,
            params,
          });
          return normalizeRefundsResponse(data, page, PAGE_SIZE);
        } catch (e: any) {
          lastErr = e;
          if (isAuthError(e)) throw e;
        }
      }

      console.warn("Refund list fetch failed", lastErr);
      return {
        rows: [] as RefundRow[],
        meta: {
          total: 0,
          page,
          pageSize: PAGE_SIZE,
          totalPages: 1,
        },
      } satisfies RefundsQueryResult;
    },
    staleTime: 15_000,
    retry: false,
    placeholderData: (prev) => prev,
  });

  const refunds = refundsQ.data?.rows || [];
  const refundsMeta = refundsQ.data?.meta ?? {
    total: 0,
    page,
    pageSize: PAGE_SIZE,
    totalPages: 1,
  };

  const loading = !authReady || (refundsQ.isLoading && !refundsQ.data);
  const mustLoginFromData = refundsQ.isError && isAuthError(refundsQ.error);

  useEffect(() => {
    const qpQ = (searchParams.get("q") || "").trim();
    if (qpQ !== q) {
      setQ(qpQ);
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    setPage(1);
    setExpandedId(null);
  }, [statusFilter, activeCustomerKey]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    refunds.forEach((r) => {
      if (r.status) set.add(String(r.status));
    });
    return Array.from(set).sort();
  }, [refunds]);

  const reasonOptions = useMemo(() => {
    const set = new Set<string>();
    refunds.forEach((r) => {
      if (r.reason) set.add(String(r.reason));
    });
    return Array.from(set).sort();
  }, [refunds]);

  const tdy = todayYMD();
  const isTodayActive = from === tdy && to === tdy;
  const toggleToday = () => {
    if (isTodayActive) {
      setFrom("");
      setTo("");
    } else {
      setFrom(tdy);
      setTo(tdy);
    }
  };

  const visibleRefunds = useMemo(() => {
    const dateFrom = from ? new Date(from).getTime() : null;
    const dateTo = to ? new Date(`${to}T23:59:59.999`).getTime() : null;

    return refunds.filter((r) => {
      if (reasonFilter !== "ALL") {
        if (String(r.reason || "") !== reasonFilter) return false;
      }

      if (from || to) {
        const ts = r.createdAt ? new Date(r.createdAt).getTime() : 0;
        if (dateFrom != null && ts < dateFrom) return false;
        if (dateTo != null && ts > dateTo) return false;
      }

      return true;
    });
  }, [refunds, reasonFilter, from, to]);

  const serverPage = Math.max(1, Number(refundsMeta.page || page));
  const totalPages = Math.max(1, Number(refundsMeta.totalPages || 1));
  const serverTotal = Math.max(0, Number(refundsMeta.total || 0));

  const pageStart = visibleRefunds.length === 0 ? 0 : (serverPage - 1) * PAGE_SIZE + 1;
  const pageEnd = visibleRefunds.length === 0 ? 0 : pageStart + visibleRefunds.length - 1;

  const summary = useMemo(() => {
    let open = 0;
    let resolved = 0;
    let refundedTotal = 0;

    visibleRefunds.forEach((r) => {
      const st = String(r.status || "").toUpperCase();
      const amt = fmtN(r.amount);

      if (["PENDING", "REQUESTED", "OPEN", "IN_REVIEW", "SUPPLIER_REVIEW", "ESCALATED"].includes(st)) {
        open += 1;
      } else {
        resolved += 1;
      }

      if (["REFUNDED", "COMPLETED", "PAID_OUT", "APPROVED"].includes(st) && amt > 0) {
        refundedTotal += amt;
      }
    });

    return { total: serverTotal, open, resolved, refundedTotal };
  }, [visibleRefunds, serverTotal]);

  const clearFilters = () => {
    setQ("");
    setStatusFilter("ALL");
    setReasonFilter("ALL");
    setFrom("");
    setTo("");
    setPage(1);
    setExpandedId(null);

    const sp = new URLSearchParams(searchParams);
    sp.delete("q");
    setSearchParams(sp, { replace: true });
  };

  if (mustLogin || mustLoginFromData) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (mustGoSupplier) {
    return <Navigate to="/supplier/orders" replace />;
  }

  return (
    <SiteLayout>
      <div className={`max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-5 md:py-6 ${T_BASE}`}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold text-ink">Returns & refunds</h1>
            <p className={`mt-1 ${T_SM} text-ink-soft`}>
              {isAdmin
                ? activeCustomerKey
                  ? "You are viewing refunds for a specific customer. Clear view-as to see all customers."
                  : "Track and manage refund requests across all customers."
                : "See the status of your return and refund requests."}
            </p>
          </div>

          <div className="flex items-center gap-2 min-[768px]:hidden">
            <button
              onClick={() => setFiltersOpen(true)}
              className={`rounded-xl ${SILVER_BORDER} px-3 py-2 ${BTN_XS} bg-white ${SILVER_SHADOW_SM}`}
            >
              Filters
            </button>
            <button
              onClick={() => refundsQ.refetch()}
              className={`rounded-xl ${SILVER_BORDER} px-3 py-2 ${BTN_XS} bg-white ${SILVER_SHADOW_SM}`}
              disabled={!queriesEnabled}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className={`mb-4 p-3 sm:p-4 ${CARD_XL} flex flex-col sm:flex-row gap-3 sm:items-center`}>
          <div className="flex items-start gap-2">
            <div className="mt-0.5 rounded-full bg-indigo-50 text-indigo-700 p-1.5">
              <Info className="h-3.5 w-3.5" />
            </div>
            <div className="space-y-1">
              <div className={`${T_SM} font-medium text-ink`}>How returns work</div>
              <p className={`${T_XS} text-ink-soft`}>
                We review each request individually. You’ll receive updates by email and in this
                dashboard as your return moves from <span className="font-medium">requested</span> to{" "}
                <span className="font-medium">approved, refunded, or closed</span>.
              </p>
            </div>
          </div>
          {!isAdmin && (
            <button
              type="button"
              onClick={() =>
                openModal({
                  title: "Return policy (summary)",
                  message: (
                    <div className={`${T_SM} text-ink-soft space-y-2`}>
                      <p>
                        • Most items can be returned within{" "}
                        <span className="font-medium">7 days of delivery</span>, as long as they are
                        unused and in original packaging.
                      </p>
                      <p>
                        • For damaged or incorrect items, take clear photos of the product and
                        packaging and attach them when requesting a refund.
                      </p>
                      <p>• Some categories may have special rules (e.g. perishables, hygiene items).</p>
                    </div>
                  ),
                  size: "md",
                })
              }
              className={`inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 ${BTN_XS} text-indigo-700 hover:bg-indigo-100 ml-auto`}
            >
              View policy summary
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className={`${CARD_XL} p-3`}>
            <div className={`${T_SM} text-ink-soft`}>Total requests</div>
            <div className="text-lg font-semibold">{summary.total}</div>
            <div className={`${T_XS} text-ink-soft`}>
              {isAdmin && activeCustomerKey ? "For this customer" : "Across all server pages"}
            </div>
          </div>
          <div className={`${CARD_XL} p-3`}>
            <div className={`${T_SM} text-ink-soft`}>Open cases</div>
            <div className="text-lg font-semibold">{summary.open}</div>
            <div className={`${T_XS} text-ink-soft`}>On this page after local filters</div>
          </div>
          <div className={`${CARD_XL} p-3`}>
            <div className={`${T_SM} text-ink-soft`}>Refunded amount</div>
            <div className="text-lg font-semibold">{ngn.format(summary.refundedTotal)}</div>
            <div className={`${T_XS} text-ink-soft`}>On this page after local filters</div>
          </div>
        </div>

        <div className={`mb-4 p-4 hidden min-[768px]:block ${CARD_2XL}`}>
          <RefundFilters
            isAdmin={isAdmin}
            customersLoading={customersQ.isLoading}
            customers={customers}
            customerKeyInput={customerKeyInput}
            setCustomerKeyInput={setCustomerKeyInput}
            activeCustomerKey={activeCustomerKey}
            setActiveCustomerKey={setActiveCustomerKey}
            setExpandedId={setExpandedId}
            setPage={setPage}
            q={q}
            setQ={setQ}
            searchParams={searchParams}
            setSearchParams={setSearchParams}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            statusOptions={statusOptions}
            reasonFilter={reasonFilter}
            setReasonFilter={setReasonFilter}
            reasonOptions={reasonOptions}
            from={from}
            setFrom={setFrom}
            to={to}
            setTo={setTo}
            isTodayActive={isTodayActive}
            toggleToday={toggleToday}
            clearFilters={clearFilters}
            refundsRefetch={() => void refundsQ.refetch()}
            queriesEnabled={queriesEnabled}
            filteredCount={visibleRefunds.length}
            loading={loading}
            pageStart={pageStart}
            pageEnd={pageEnd}
            serverTotal={serverTotal}
          />
        </div>

        {filtersOpen && (
          <div className="fixed inset-0 z-40 min-[768px]:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setFiltersOpen(false)} />
            <div className={`absolute inset-y-0 left-0 w-[84%] max-w-xs p-4 ${CARD_2XL} rounded-none rounded-r-2xl`}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Filter refunds</h2>
                <button
                  onClick={() => setFiltersOpen(false)}
                  className={`${BTN_XS} text-ink-soft px-2 py-1 rounded-lg hover:bg-black/5`}
                >
                  Close
                </button>
              </div>
              <div className="space-y-3">
                <RefundFilters
                  isAdmin={isAdmin}
                  customersLoading={customersQ.isLoading}
                  customers={customers}
                  customerKeyInput={customerKeyInput}
                  setCustomerKeyInput={setCustomerKeyInput}
                  activeCustomerKey={activeCustomerKey}
                  setActiveCustomerKey={setActiveCustomerKey}
                  setExpandedId={setExpandedId}
                  setPage={setPage}
                  q={q}
                  setQ={setQ}
                  searchParams={searchParams}
                  setSearchParams={setSearchParams}
                  statusFilter={statusFilter}
                  setStatusFilter={setStatusFilter}
                  statusOptions={statusOptions}
                  reasonFilter={reasonFilter}
                  setReasonFilter={setReasonFilter}
                  reasonOptions={reasonOptions}
                  from={from}
                  setFrom={setFrom}
                  to={to}
                  setTo={setTo}
                  isTodayActive={isTodayActive}
                  toggleToday={toggleToday}
                  clearFilters={clearFilters}
                  refundsRefetch={() => void refundsQ.refetch()}
                  queriesEnabled={queriesEnabled}
                  filteredCount={visibleRefunds.length}
                  loading={loading}
                  pageStart={pageStart}
                  pageEnd={pageEnd}
                  serverTotal={serverTotal}
                />
              </div>
            </div>
          </div>
        )}

        <div className={`overflow-hidden mt-4 hidden md:block ${CARD_2XL}`}>
          <div className="px-4 md:px-5 py-3 border-b border-zinc-200/70 flex items-center justify-between">
            <div className="text-sm text-ink-soft">
              {loading
                ? "Loading refunds…"
                : visibleRefunds.length
                ? `Showing ${pageStart}-${pageEnd} of ${serverTotal} refunds`
                : serverTotal > 0
                  ? "No refunds on this page match your local filters."
                  : "No refunds match your filters."}
            </div>
            <button
              onClick={() => refundsQ.refetch()}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200/80 bg-white hover:bg-black/5 px-3 py-2 text-sm shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
              disabled={!queriesEnabled}
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-ink">
                  <th className="text-left px-3 py-2">Refund</th>
                  <th className="text-left px-3 py-2">Order</th>
                  {isAdmin && <th className="text-left px-3 py-2">Supplier</th>}
                  <th className="text-left px-3 py-2">Reason</th>
                  <th className="text-left px-3 py-2">Amount</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Requested</th>
                  <th className="text-left px-3 py-2">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-200/70">
                {loading && (
                  <>
                    <SkeletonRow cols={isAdmin ? 8 : 7} mode="table" />
                    <SkeletonRow cols={isAdmin ? 8 : 7} mode="table" />
                  </>
                )}

                {!loading && visibleRefunds.length === 0 && (
                  <tr>
                    <td colSpan={isAdmin ? 8 : 7} className="px-3 py-6 text-center text-zinc-500">
                      {serverTotal > 0 ? "No refunds on this page match your local filters." : "No refunds match your filters."}
                    </td>
                  </tr>
                )}

                {!loading &&
                  visibleRefunds.map((r) => {
                    const isOpen = expandedId === r.id;
                    const firstEvent = r.events?.[0];
                    const lastEvent =
                      r.events && r.events.length > 0
                        ? r.events[r.events.length - 1]
                        : undefined;

                    return (
                      <React.Fragment key={r.id}>
                        <tr
                          className={`hover:bg-black/5 cursor-pointer ${isOpen ? "bg-amber-50/40" : ""}`}
                          onClick={() => setExpandedId((curr) => (curr === r.id ? null : r.id))}
                          aria-expanded={isOpen}
                        >
                          <td className="px-3 py-3 font-mono">{r.id}</td>
                          <td className="px-3 py-3">
                            {r.orderId ? (
                              <button
                                className="text-indigo-700 hover:underline inline-flex items-center gap-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  nav(`/orders?orderId=${encodeURIComponent(r.orderId!)}`);
                                }}
                              >
                                {r.orderId}
                                <ArrowRight className="h-3 w-3" />
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                          {isAdmin && (
                            <td className="px-3 py-3">
                              {r.supplier?.name || "—"}
                              {r.purchaseOrder?.id && (
                                <div className={T_XS + " text-ink-soft"}>PO {r.purchaseOrder.id}</div>
                              )}
                            </td>
                          )}
                          <td className="px-3 py-3">
                            <div className="flex flex-col gap-0.5">
                              <span>{r.reason || "—"}</span>
                              {r.message && (
                                <span className={`${T_XS} text-ink-soft line-clamp-1`}>
                                  {r.message}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            {r.amount != null && fmtN(r.amount) > 0
                              ? ngn.format(fmtN(r.amount))
                              : "—"}
                          </td>
                          <td className="px-3 py-3">
                            <StatusDot label={r.status || "—"} />
                          </td>
                          <td className="px-3 py-3">
                            <div>{fmtDate(r.createdAt)}</div>
                            {lastEvent?.createdAt && (
                              <div className={`${T_XS} text-ink-soft`}>
                                Updated {fmtDate(lastEvent.createdAt)}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <button
                              className={`inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs ${
                                isOpen
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                                  : "bg-white border-zinc-200/80 hover:bg-black/5 text-ink-soft"
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedId((curr) => (curr === r.id ? null : r.id));
                              }}
                            >
                              {isOpen ? "Hide details" : "View details"}
                            </button>
                          </td>
                        </tr>

                        {isOpen && (
                          <tr>
                            <td colSpan={isAdmin ? 8 : 7} className="p-0">
                              <div className="px-4 md:px-6 py-4 bg-white border-t border-zinc-200/70">
                                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-4">
                                  <div className="space-y-3">
                                    <div className={`${CARD_XL} p-3`}>
                                      <div className="flex items-center justify-between gap-2 mb-1.5">
                                        <div className={`${T_SM} font-semibold text-ink`}>Timeline</div>
                                        {firstEvent?.createdAt && (
                                          <div className={`${T_XS} text-ink-soft`}>
                                            Started {fmtDate(firstEvent.createdAt)}
                                          </div>
                                        )}
                                      </div>
                                      {r.events && r.events.length > 0 ? (
                                        <ol className="space-y-2">
                                          {r.events.map((ev) => (
                                            <li key={ev.id} className="flex items-start gap-2">
                                              <div className="mt-0.5 h-2 w-2 rounded-full bg-emerald-500" />
                                              <div className="min-w-0">
                                                <div className={`${T_SM} text-ink`}>
                                                  {ev.type || "Update"}
                                                </div>
                                                {ev.message && (
                                                  <div className={`${T_XS} text-ink-soft`}>
                                                    {ev.message}
                                                  </div>
                                                )}
                                                <div className={`${T_XS} text-ink-soft mt-0.5`}>
                                                  {fmtDate(ev.createdAt)}
                                                </div>
                                              </div>
                                            </li>
                                          ))}
                                        </ol>
                                      ) : (
                                        <div className={`${T_SM} text-ink-soft`}>
                                          No timeline events yet.
                                        </div>
                                      )}
                                    </div>

                                    <div className={`${CARD_XL} p-3`}>
                                      <div className={`${T_SM} font-semibold text-ink`}>Notes</div>
                                      <div className={`${T_XS} text-ink-soft mt-1.5 space-y-1.5`}>
                                        <p>
                                          <span className="font-medium">Reason:</span> {r.reason || "—"}
                                        </p>
                                        {r.message && (
                                          <p>
                                            <span className="font-medium">Customer message:</span>{" "}
                                            {r.message}
                                          </p>
                                        )}
                                        {r.purchaseOrder && (
                                          <p>
                                            <span className="font-medium">Purchase order:</span>{" "}
                                            {r.purchaseOrder.id} • Status{" "}
                                            {r.purchaseOrder.status || "—"}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="space-y-3">
                                    <div className={`${CARD_XL} p-3`}>
                                      <div className="flex items-center gap-2 mb-2">
                                        <PackageOpen className="h-4 w-4 text-ink-soft" />
                                        <div className={`${T_SM} font-semibold text-ink`}>
                                          Items in this refund
                                        </div>
                                      </div>
                                      {r.items && r.items.length > 0 ? (
                                        <ul className="space-y-1.5">
                                          {r.items.map((it) => {
                                            const oi = it.orderItem;
                                            if (!oi) return null;
                                            return (
                                              <li
                                                key={it.id}
                                                className={`flex justify-between gap-2 ${T_XS} text-ink-soft`}
                                              >
                                                <span className="min-w-0 truncate">
                                                  {(oi.title || "—").toString()}
                                                  {oi.quantity && <span> • {String(oi.quantity)} pcs</span>}
                                                </span>
                                                <span className="shrink-0">
                                                  {oi.unitPrice != null && fmtN(oi.unitPrice) > 0
                                                    ? ngn.format(fmtN(oi.unitPrice))
                                                    : "—"}
                                                </span>
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      ) : (
                                        <div className={`${T_XS} text-ink-soft`}>
                                          No linked items found.
                                        </div>
                                      )}
                                    </div>

                                    <div className={`${CARD_XL} p-3`}>
                                      <div className="flex items-center gap-2 mb-2">
                                        <ImageIcon className="h-4 w-4 text-ink-soft" />
                                        <div className={`${T_SM} font-semibold text-ink`}>
                                          Evidence
                                        </div>
                                      </div>
                                      {r.evidenceUrls && r.evidenceUrls.length > 0 ? (
                                        <div className="grid grid-cols-3 gap-2">
                                          {r.evidenceUrls.slice(0, 6).map((url) => (
                                            <button
                                              key={url}
                                              type="button"
                                              className="relative aspect-[4/3] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                window.open(url, "_blank", "noopener,noreferrer");
                                              }}
                                            >
                                              <img src={url} className="h-full w-full object-cover" alt="" />
                                            </button>
                                          ))}
                                          {r.evidenceUrls.length > 6 && (
                                            <div className="flex items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-center px-2">
                                              <span className={`${T_XS} text-ink-soft`}>
                                                + {r.evidenceUrls.length - 6} more
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        <div className={`${T_XS} text-ink-soft`}>
                                          No photos or documents attached.
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <div className="px-4 md:px-5 pb-4">
            <Pagination
              page={serverPage}
              totalPages={totalPages}
              onChange={(p) => {
                setExpandedId(null);
                setPage(p);
              }}
            />
          </div>
        </div>

        <div className="mt-4 space-y-2.5 md:hidden">
          {loading && (
            <>
              <SkeletonRow mode="card" />
              <SkeletonRow mode="card" />
            </>
          )}

          {!loading && visibleRefunds.length === 0 && (
            <div className={`${CARD_2XL} py-6 px-4 text-center text-zinc-500 ${T_SM}`}>
              {serverTotal > 0 ? "No refunds on this page match your local filters." : "No refunds match your filters."}
            </div>
          )}

          {!loading &&
            visibleRefunds.map((r) => {
              const isOpen = expandedId === r.id;
              const st = r.status || "—";

              return (
                <div
                  key={r.id}
                  className={`${CARD_2XL} p-3 flex flex-col gap-2`}
                  onClick={() => setExpandedId((curr) => (curr === r.id ? null : r.id))}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className={T_LABEL}>Refund ID</div>
                      <div className="font-mono text-[11px] sm:text-xs truncate">{r.id}</div>
                    </div>
                    <div className="shrink-0">
                      <StatusDot label={st} />
                    </div>
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className={`${T_SM} text-ink-soft truncate`}>
                        {r.reason || "No reason provided"}
                      </div>
                      <div className={`${T_XS} text-ink-soft`}>
                        Order {r.orderId || "—"} • {fmtDate(r.createdAt)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={T_LABEL}>Amount</div>
                      <div className="font-semibold text-[13px] sm:text-sm">
                        {r.amount != null && fmtN(r.amount) > 0
                          ? ngn.format(fmtN(r.amount))
                          : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    {r.orderId && (
                      <button
                        className={`rounded-lg ${SILVER_BORDER} px-3 py-1.5 ${BTN_XS} bg-white hover:bg-black/5 inline-flex items-center gap-1.5`}
                        onClick={(e) => {
                          e.stopPropagation();
                          nav(`/orders?orderId=${encodeURIComponent(r.orderId!)}`);
                        }}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        View order
                      </button>
                    )}

                    {r.evidenceUrls && r.evidenceUrls.length > 0 && (
                      <button
                        className={`rounded-lg ${SILVER_BORDER} px-3 py-1.5 ${BTN_XS} bg-white hover:bg-black/5 inline-flex items-center gap-1.5`}
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(r.evidenceUrls![0], "_blank", "noopener,noreferrer");
                        }}
                      >
                        <ImageIcon className="h-3.5 w-3.5" />
                        View photo
                      </button>
                    )}

                    <button
                      className={`rounded-lg ${SILVER_BORDER} px-3 py-1.5 ${BTN_XS} bg-white hover:bg-black/5 ml-auto`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedId((curr) => (curr === r.id ? null : r.id));
                      }}
                    >
                      {isOpen ? "Hide details" : "Details"}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="mt-1.5 border-t border-zinc-200/70 pt-2 space-y-2">
                      <div className={`${T_XS} text-ink-soft`}>
                        <span className="font-medium text-ink">Status:</span> {st}
                      </div>

                      {r.message && (
                        <div className={`${T_XS} text-ink-soft`}>
                          <span className="font-medium text-ink">Message:</span> {r.message}
                        </div>
                      )}

                      {r.items && r.items.length > 0 && (
                        <div className="space-y-1">
                          <div className={`${T_XS} font-medium text-ink`}>Items</div>
                          {r.items.slice(0, 4).map((it) => {
                            const oi = it.orderItem;
                            if (!oi) return null;
                            return (
                              <div
                                key={it.id}
                                className={`flex justify-between gap-2 ${T_XS} text-ink-soft`}
                              >
                                <span className="min-w-0 truncate">{(oi.title || "—").toString()}</span>
                                <span className="shrink-0">
                                  {oi.quantity && <>× {String(oi.quantity)}</>}
                                </span>
                              </div>
                            );
                          })}
                          {r.items.length > 4 && (
                            <div className={`${T_XS} text-ink-soft`}>
                              + {r.items.length - 4} more item(s)
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

          <Pagination
            page={serverPage}
            totalPages={totalPages}
            onChange={(p) => {
              setExpandedId(null);
              setPage(p);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </div>
      </div>
    </SiteLayout>
  );
}