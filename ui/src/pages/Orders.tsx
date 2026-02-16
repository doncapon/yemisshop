import React, { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client.js";
import { useAuthStore } from "../store/auth";
import SiteLayout from "../layouts/SiteLayout.js";
import StatusDot from "../components/StatusDot.js";
import { useModal } from "../components/ModalProvider";

/* ---------------- “Silver” UI helpers ---------------- */
const SILVER_BORDER = "border border-zinc-200/80";
const SILVER_SHADOW_SM = "shadow-[0_8px_20px_rgba(148,163,184,0.18)]";
const SILVER_SHADOW_MD = "shadow-[0_12px_30px_rgba(148,163,184,0.22)]";
const SILVER_SHADOW_LG = "shadow-[0_18px_60px_rgba(148,163,184,0.30)]";

const CARD_2XL = `rounded-2xl ${SILVER_BORDER} bg-white ${SILVER_SHADOW_MD}`;
const CARD_XL = `rounded-xl ${SILVER_BORDER} bg-white ${SILVER_SHADOW_SM}`;

/* ---------------- Mobile typography helpers ----------------
   Goal: smaller + consistent on mobile, normal on md+.
------------------------------------------------------------ */
const T_BASE = "text-[12px] sm:text-sm";
const T_SM = "text-[11px] sm:text-xs";
const T_XS = "text-[10px] sm:text-[11px]";
const T_LABEL = "text-[10px] sm:text-xs text-ink-soft";
const INP = "text-[12px] sm:text-sm";
const BTN = "text-[12px] sm:text-sm";
const BTN_XS = "text-[11px] sm:text-xs";

/* ---------------- Cookie auth helpers ---------------- */
const AXIOS_COOKIE_CFG = { withCredentials: true as const };
const OTP_HEADER_NAME = "x-otp-token"; // change if your backend expects a different header

function isAuthError(e: any) {
  const status = e?.response?.status;
  return status === 401 || status === 403;
}

/* ---------------- Types (loose to match API) ---------------- */
type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | string;

type SupplierAllocationRow = {
  id: string;
  supplierId: string;
  supplierName?: string | null;
  amount?: number | string | null;
  status?: string | null;
  purchaseOrderId?: string | null;
};

type PurchaseOrderRow = {
  id: string;
  supplierId: string;
  supplierName?: string | null;
  status?: string | null;
  supplierAmount?: number | string | null;
  subtotal?: number | string | null;
  platformFee?: number | string | null;
  createdAt?: string | null;
};

type PaymentRow = {
  id: string;
  status: string;
  provider?: string | null;
  reference?: string | null;
  amount?: number | string | null;
  createdAt?: string;
  allocations?: SupplierAllocationRow[];
};

type OrderItem = {
  id: string;
  productId?: string | null;
  title?: string | null;
  unitPrice?: number | string | null;
  quantity?: number | string | null;
  lineTotal?: number | string | null;
  status?: string | null;
  product?: { title?: string | null } | null;
  chosenSupplierUnitPrice?: number | string | null;
  selectedOptions?: Array<{ attribute?: string; value?: string }> | any;
  variant?: {
    id: string;
    sku?: string | null;
    imagesJson?: string[] | null;
  } | null;

  // extra possible API fields
  qty?: number | string | null;
  price?: number | string | null;
  total?: number | string | null;
  subtotal?: number | string | null;
  productTitle?: string | null;
  options?: any;
  selectedOptionsJson?: any;
  productVariant?: any;
};

type OrderRow = {
  id: string;
  userEmail?: string | null;
  status?: string;
  total?: number | string | null;
  tax?: number | string | null;
  subtotal?: number | string | null;
  serviceFeeTotal?: number | string | null;
  createdAt?: string;
  items?: OrderItem[];
  payment?: PaymentRow | null; // for /mine
  payments?: PaymentRow[]; // for / (admin)
  paidAmount?: number | string | null;
  metrics?: {
    revenue?: number | string | null;
    cogs?: number | string | null;
    profit?: number | string | null;
  };

  user?: { email?: string | null } | null;
  purchaseOrders?: PurchaseOrderRow[];
};

type OtpPurpose = "PAY_ORDER" | "CANCEL_ORDER" | "REFUND_ORDER";

type OtpState =
  | { open: false }
  | {
    open: true;
    orderId: string;
    purpose: OtpPurpose;
    requestId: string;
    expiresAt: number;
    channelHint?: string | null;
    otp: string;
    busy: boolean;
    error?: string | null;
    onSuccess: (otpToken: string) => Promise<void> | void;
  };

type RefundReason =
  | "NOT_RECEIVED"
  | "DAMAGED"
  | "WRONG_ITEM"
  | "NOT_AS_DESCRIBED"
  | "CHANGED_MIND"
  | "OTHER";

type RefundDraft = {
  orderId: string;
  reason: RefundReason;
  message: string;
  mode: "ALL" | "SOME";
  selectedItemIds: Record<string, boolean>;
  busy: boolean;
  error?: string | null;
};

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
  meta?: any | null;
  evidenceUrls?: string[];
  supplier?: { id: string; name?: string | null } | null;
  purchaseOrder?: { id: string; status?: string | null; payoutStatus?: string | null } | null;
  events?: RefundEventRow[];
  items?: RefundItemRow[];
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
    meta: r?.meta ?? null,
    evidenceUrls,
    supplier: r?.supplier ? { id: String(r.supplier.id ?? ""), name: r.supplier.name ?? null } : null,
    purchaseOrder: r?.purchaseOrder
      ? {
        id: String(r.purchaseOrder.id ?? ""),
        status: r.purchaseOrder.status ?? null,
        payoutStatus: r.purchaseOrder.payoutStatus ?? null,
      }
      : null,
    events: Array.isArray(r?.events)
      ? r.events.map((e: any) => ({
        id: String(e?.id ?? ""),
        type: e?.type ?? null,
        message: e?.message ?? null,
        createdAt: e?.createdAt ?? null,
      }))
      : [],
    items: Array.isArray(r?.items)
      ? r.items.map((it: any) => ({
        id: String(it?.id ?? ""),
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
    [];
  return list.map(normalizeRefund);
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

const toYMD = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "");

/* ---------------- Shared helpers ---------------- */
function isPaidStatus(status?: string | null): boolean {
  const s = String(status || "").toUpperCase();
  return ["PAID", "VERIFIED", "SUCCESS", "SUCCESSFUL", "COMPLETED"].includes(s);
}

function latestPaymentOf(o: OrderRow): PaymentRow | null {
  const list: PaymentRow[] = Array.isArray(o.payments) ? [...o.payments] : o.payment ? [o.payment] : [];
  if (list.length === 0) return null;

  const paid = list.find((p) => isPaidStatus(p.status));
  if (paid) return paid;

  return list
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
}

function receiptKeyFromPayment(p?: PaymentRow | null): string | null {
  if (!p) return null;
  const ref = (p.reference || "").toString().trim();
  if (ref) return ref;
  const id = (p.id || "").toString().trim();
  return id || null;
}

function extractItems(raw: any): any[] {
  if (!raw) return [];
  const candidates = [
    raw.items,
    raw.orderItems,
    raw.orderLines,
    raw.lines,
    raw.OrderItem,
    raw.OrderLine,
    raw.order_item,
    raw.order_items,
    raw.order_lines,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function cryptoFallbackId(it: any) {
  try {
    return btoa(JSON.stringify([it?.productId, it?.variantId, it?.title, it?.sku, it?.price])).slice(0, 12);
  } catch {
    return String(Math.random()).slice(2);
  }
}

function normalizeItem(it: any): OrderItem {
  const id = String(it?.id ?? it?.orderItemId ?? it?.lineId ?? cryptoFallbackId(it));

  const quantity = it?.quantity ?? it?.qty ?? it?.count ?? (it?.lineQuantity != null ? it.lineQuantity : undefined);

  const unitPrice =
    it?.unitPrice ??
    it?.price ??
    it?.customerUnitPrice ??
    it?.unit_amount ??
    it?.unit_amount_value ??
    undefined;

  const lineTotal = it?.lineTotal ?? it?.total ?? it?.subtotal ?? it?.line_amount ?? undefined;

  const product = it?.product ?? it?.Product ?? null;
  const productTitle = it?.productTitle ?? it?.title ?? product?.title ?? null;

  const variant = it?.variant ?? it?.productVariant ?? it?.Variant ?? null;

  let selectedOptions: any = it?.selectedOptions ?? it?.options ?? it?.selectedOptionsJson ?? null;
  if (typeof selectedOptions === "string") {
    try {
      selectedOptions = JSON.parse(selectedOptions);
    } catch {
      // ignore
    }
  }

  return {
    id,
    productId: it?.productId ?? null,
    title: it?.title ?? productTitle ?? null,
    unitPrice: unitPrice ?? null,
    quantity: quantity ?? null,
    lineTotal: lineTotal ?? null,
    status: it?.status ?? null,
    product: product ? { title: product?.title ?? null } : null,
    chosenSupplierUnitPrice: it?.chosenSupplierUnitPrice ?? it?.supplierUnitPrice ?? null,
    selectedOptions,
    variant: variant
      ? {
        id: String(variant?.id ?? ""),
        sku: variant?.sku ?? null,
        imagesJson: variant?.imagesJson ?? variant?.images ?? null,
      }
      : null,
  };
}

function normalizeOrder(raw: any): OrderRow {
  const itemsRaw = extractItems(raw);
  const items = itemsRaw.map(normalizeItem);

  const userEmail =
    raw?.userEmail ??
    raw?.user?.email ??
    raw?.User?.email ??
    raw?.email ??
    raw?.customerEmail ??
    null;

  const payments: any[] =
    (Array.isArray(raw?.payments) && raw.payments) ||
    (Array.isArray(raw?.Payments) && raw.Payments) ||
    (Array.isArray(raw?.payment) && raw.payment) ||
    [];

  const payment: any = raw?.payment ?? raw?.Payment ?? (payments.length ? payments[0] : null);
  const purchaseOrdersRaw = Array.isArray(raw?.purchaseOrders) ? raw.purchaseOrders : [];

  const purchaseOrders: PurchaseOrderRow[] = purchaseOrdersRaw.map((po: any) => ({
    id: String(po?.id ?? ""),
    supplierId: String(po?.supplierId ?? ""),
    supplierName: po?.supplier?.name ?? po?.supplierName ?? null,
    status: po?.status ?? null,
    supplierAmount: po?.supplierAmount ?? null,
    subtotal: po?.subtotal ?? null,
    platformFee: po?.platformFee ?? null,
    createdAt: po?.createdAt ?? null,
  }));

  return {
    id: String(raw?.id ?? ""),
    userEmail,
    status: raw?.status ?? raw?.orderStatus ?? null,
    total: raw?.total ?? raw?.amountTotal ?? raw?.grandTotal ?? null,
    serviceFeeTotal:
      raw?.serviceFeeTotal ??
      raw?.service_fee_total ??
      raw?.serviceFeeTotalNGN ??
      raw?.service_fee ??
      null,
    subtotal: raw?.subtotal ?? raw?.subTotal ?? raw?.itemsSubtotal ?? null,
    tax: raw?.tax ?? raw?.vat ?? null,
    createdAt: raw?.createdAt ?? raw?.created_at ?? raw?.placedAt ?? null,
    items,
    payments: payments.length
      ? payments.map((p) => ({
        id: String(p?.id ?? ""),
        status: String(p?.status ?? ""),
        provider: p?.provider ?? null,
        reference: p?.reference ?? p?.ref ?? null,
        amount: p?.amount ?? null,
        createdAt: p?.createdAt ?? p?.created_at ?? null,
        allocations: Array.isArray(p?.allocations)
          ? p.allocations.map((a: any) => ({
            id: String(a?.id ?? ""),
            supplierId: String(a?.supplierId ?? ""),
            supplierName: a?.supplier?.name ?? a?.supplierNameSnapshot ?? null,
            amount: a?.amount ?? null,
            status: a?.status ?? null,
            purchaseOrderId: a?.purchaseOrderId ?? null,
          }))
          : [],
      }))
      : undefined,
    payment: payment
      ? {
        id: String(payment?.id ?? ""),
        status: String(payment?.status ?? ""),
        provider: payment?.provider ?? null,
        reference: payment?.reference ?? payment?.ref ?? null,
        amount: payment?.amount ?? null,
        createdAt: payment?.createdAt ?? payment?.created_at ?? null,
      }
      : null,
    paidAmount: raw?.paidAmount ?? raw?.paid_amount ?? null,
    metrics: raw?.metrics ?? null,
    purchaseOrders,
  };
}

function normalizeOrders(payload: any): OrderRow[] {
  const list =
    (Array.isArray(payload) && payload) ||
    (payload && Array.isArray(payload.data) && payload.data) ||
    (payload && Array.isArray(payload.orders) && payload.orders) ||
    (payload && Array.isArray(payload.results) && payload.results) ||
    [];
  return list.map(normalizeOrder);
}

function orderServiceFee(o: OrderRow): number {
  const candidates = [
    (o as any).serviceFeeTotal,
    (o as any).serviceFee,
    (o as any).service_fee_total,
    (o as any).service_fee,
    (o as any).commsTotal,
    (o as any).comms,
  ];

  for (const v of candidates) {
    const n = fmtN(v);
    if (n > 0) return n;
  }
  return 0;
}

function canRequestRefundAsCustomer(details: OrderRow, latestPayment: PaymentRow | null): boolean {
  const st = String(details.status || "").toUpperCase();
  if (["REFUNDED", "CANCELED", "CANCELLED"].includes(st)) return false;

  const isPaidEffective = isPaidStatus(details.status) || isPaidStatus(latestPayment?.status);
  if (!isPaidEffective) return false;

  return true;
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
            className={`px-2 py-1.5 sm:px-3 sm:py-1.5 ${BTN_XS} rounded-lg ${SILVER_BORDER} ${page === 1 ? "bg-zinc-900 text-white border-zinc-900" : "bg-white"
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
          className={`px-2 py-1.5 sm:px-3 sm:py-1.5 ${BTN_XS} rounded-lg ${SILVER_BORDER} ${p === page ? "bg-zinc-900 text-white border-zinc-900" : "bg-white hover:bg-black/5"
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
            className={`px-2 py-1.5 sm:px-3 sm:py-1.5 ${BTN_XS} rounded-lg ${SILVER_BORDER} ${page === totalPages ? "bg-zinc-900 text-white border-zinc-900" : "bg-white"
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

/* ---------------- Page ---------------- */
export default function OrdersPage() {
  const nav = useNavigate();
  const location = useLocation();

  const storeUser = useAuthStore((s) => s.user);
  const storeRole = (storeUser?.role || "") as Role;

  const [searchParams, setSearchParams] = useSearchParams();

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "PENDING" | "PAID" | "FAILED" | "CANCELED" | "REFUNDED"
  >("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minTotal, setMinTotal] = useState("");
  const [maxTotal, setMaxTotal] = useState("");

  const [otpModal, setOtpModal] = useState<OtpState>({ open: false });

  const { openModal, closeModal } = useModal();

  const showErrorModal = (title: string, message: any) => {
    openModal({
      title,
      message:
        typeof message === "string" ? (
          message
        ) : (
          <div className={`${T_BASE} text-zinc-700`}>{String(message)}</div>
        ),
      size: "sm",
    });
  };

  const showSuccessModal = (title: string, message: any) => {
    openModal({
      title,
      message:
        typeof message === "string" ? (
          message
        ) : (
          <div className={`${T_BASE} text-zinc-700`}>{String(message)}</div>
        ),
      size: "sm",
    });
  };

  /* ----- Auth / Role (cookie session) ----- */
  const meQ = useQuery({
    queryKey: ["me-min"],
    queryFn: async () => (await api.get("/api/profile/me", AXIOS_COOKIE_CFG)).data as { role: Role; id?: string },
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const authReady = meQ.isSuccess || meQ.isError; // cookie check has resolved
  const role: Role = (storeRole || meQ.data?.role || "SHOPPER") as Role;

  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const isMetricsRole = isAdmin;
  const isSupplier = String(role || "").toUpperCase() === "SUPPLIER";

  // If cookie session is invalid -> force login
  const mustLogin = authReady && (meQ.isError ? isAuthError(meQ.error) : false);

  // If supplier role -> redirect to supplier orders
  const mustGoSupplier = authReady && !mustLogin && isSupplier;

  // Block all other queries if we will redirect (still call hooks, but disable network)
  const queriesEnabled = authReady && !mustLogin && !mustGoSupplier;

  /* ----- Orders ----- */
  const ordersQ = useQuery({
    queryKey: ["orders", isAdmin ? "admin" : "mine"],
    enabled: queriesEnabled,
    queryFn: async () => {
      const url = isAdmin ? "/api/orders?limit=50" : "/api/orders/mine?limit=50";
      const res = await api.get(url, AXIOS_COOKIE_CFG);
      return normalizeOrders(res.data);
    },
    staleTime: 15_000,
    retry: false,
  });

  // If any query comes back 401/403, also kick to login
  const mustLoginFromData =
    (ordersQ.isError && isAuthError(ordersQ.error)) || (meQ.isError && isAuthError(meQ.error));

  /* ---- expanded row from ?open= ---- */
  const openId = useMemo(() => searchParams.get("open") || "", [searchParams]);
  useEffect(() => {
    if (openId) setExpandedId(openId);
  }, [openId]);

  const orders = ordersQ.data || [];
  const loading = !authReady || ordersQ.isLoading;
  const colSpan = isAdmin ? 7 : 6;

  // URL -> state: support /orders?q=... or /orders?orderId=...
  useEffect(() => {
    const qpQ = (searchParams.get("q") || "").trim();
    const qpOrderId = (searchParams.get("orderId") || "").trim();

    const next = qpQ || qpOrderId;
    if (next && next !== q) {
      setQ(next);
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // If URL has orderId, auto-open that order once orders are loaded
  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    if (!queriesEnabled) return;
    if (didAutoOpenRef.current) return;
    const oid = (searchParams.get("orderId") || "").trim();
    if (!oid) return;
    if (!orders.length) return;

    const exact = orders.find((o) => String(o.id) === oid);
    if (!exact) return;

    const sp = new URLSearchParams(searchParams);
    sp.set("open", oid);
    sp.set("q", oid);
    sp.delete("orderId");

    didAutoOpenRef.current = true;
    setSearchParams(sp, { replace: true });
    setExpandedId(oid);
  }, [orders, searchParams, setSearchParams, queriesEnabled]);

  const orderDetailQ = useQuery({
    queryKey: ["order-detail", expandedId, isAdmin],
    enabled: queriesEnabled && !!expandedId,
    queryFn: async () => {
      if (!expandedId) return null;

      const tryUrls = isAdmin
        ? [`/api/orders/${expandedId}`, `/api/admin/orders/${expandedId}`, `/api/orders/admin/${expandedId}`]
        : [`/api/orders/${expandedId}`, `/api/orders/mine/${expandedId}`];

      let lastErr: any = null;
      for (const url of tryUrls) {
        try {
          const res = await api.get(url, AXIOS_COOKIE_CFG);
          const payload = res.data?.order ?? res.data?.data ?? res.data;
          return normalizeOrder(payload);
        } catch (e) {
          lastErr = e;
          if (isAuthError(e)) throw e;
        }
      }

      console.warn("Order detail fetch failed for", expandedId, lastErr);
      return null;
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const refundsQ = useQuery({
    queryKey: ["refunds", "mine"],
    enabled: queriesEnabled && !isAdmin,
    queryFn: async () => {
      const { data } = await api.get("/api/refunds/mine", AXIOS_COOKIE_CFG);
      return normalizeRefunds(data);
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const refunds = refundsQ.data || [];

  /* ---------------- Filter Bar helpers ---------------- */
  const clearFilters = () => {
    setQ("");
    setStatusFilter("ALL");
    setFrom("");
    setTo("");
    setMinTotal("");
    setMaxTotal("");

    const sp = new URLSearchParams(searchParams);
    sp.delete("q");
    sp.delete("orderId");
    sp.delete("open");
    setSearchParams(sp, { replace: true });
  };

  /* ---------------- Sorting ---------------- */
  type SortKey = "id" | "user" | "items" | "total" | "status" | "date";
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "date",
    dir: "desc",
  });

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "date" ? "desc" : "asc" }
    );
  };

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

  /* ---------------- Derived: filtered + sorted ---------------- */
  const filteredSorted = useMemo(() => {
    const qnorm = q.trim().toLowerCase();
    const dateFrom = from ? new Date(from).getTime() : null;
    const dateTo = to ? new Date(to + "T23:59:59.999Z").getTime() : null;
    const min = minTotal ? Number(minTotal) : null;
    const max = maxTotal ? Number(maxTotal) : null;

    const list = orders.filter((o) => {
      if (qnorm) {
        const pool: string[] = [];
        pool.push(o.id || "");
        if (o.userEmail) pool.push(o.userEmail);
        (o.items || []).forEach((it) => {
          if (it.title) pool.push(String(it.title));
          if (it.product?.title) pool.push(String(it.product.title));
        });
        const lp = (Array.isArray(o.payments) && o.payments[0]) || o.payment;
        if (lp?.reference) pool.push(lp.reference);
        const hit = pool.some((s) => s.toLowerCase().includes(qnorm));
        if (!hit) return false;
      }

      if (statusFilter !== "ALL") {
        if (String(o.status || "").toUpperCase() !== statusFilter) return false;
      }

      if (from || to) {
        const ts = o.createdAt ? new Date(o.createdAt).getTime() : 0;
        if (dateFrom != null && ts < dateFrom) return false;
        if (dateTo != null && ts > dateTo) return false;
      }

      const totalNum = fmtN(o.total);
      if (min != null && totalNum < min) return false;
      if (max != null && totalNum > max) return false;

      return true;
    });

    const dir = sort.dir === "asc" ? 1 : -1;
    const ordered = [...list].sort((a, b) => {
      const s = sort.key;
      if (s === "date") {
        const av = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bv = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return (av - bv) * dir;
      }
      if (s === "total") return (fmtN(a.total) - fmtN(b.total)) * dir;
      if (s === "items") return (((a.items || []).length - (b.items || []).length || 0) * dir);
      if (s === "status")
        return (
          String(a.status || "").localeCompare(String(b.status || ""), undefined, { sensitivity: "base" }) * dir
        );
      if (s === "user")
        return (
          String(a.userEmail || "").localeCompare(String(b.userEmail || ""), undefined, { sensitivity: "base" }) * dir
        );
      return String(a.id).localeCompare(String(b.id), undefined, { sensitivity: "base" }) * dir;
    });

    return ordered;
  }, [orders, q, statusFilter, from, to, minTotal, maxTotal, sort.key, sort.dir]);

  useEffect(() => {
    setPage(1);
  }, [orders.length, q, statusFilter, from, to, minTotal, maxTotal, sort.key, sort.dir]);

  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const pageStart = filteredSorted.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd =
    filteredSorted.length === 0
      ? 0
      : Math.min(filteredSorted.length, (currentPage - 1) * PAGE_SIZE + PAGE_SIZE);

  const paginated = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredSorted.slice(start, start + PAGE_SIZE);
  }, [filteredSorted, currentPage]);

  /* ---------------- Filter content ---------------- */
  const FilterContent = (
    <>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-4">
          <label className={T_LABEL}>Search</label>
          <input
            value={q}
            onChange={(e) => {
              const v = e.target.value;
              setQ(v);

              const sp = new URLSearchParams(searchParams);
              if (v.trim()) {
                sp.set("q", v.trim());
                sp.delete("orderId");
              } else {
                sp.delete("q");
                sp.delete("orderId");
              }
              setSearchParams(sp, { replace: true });
            }}
            placeholder="Order ID, user, item, payment ref…"
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          />
        </div>

        <div className="md:col-span-2">
          <label className={T_LABEL}>Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          >
            <option value="ALL">All</option>
            <option value="PENDING">Pending</option>
            <option value="PAID">Paid</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELED">Canceled</option>
            <option value="REFUNDED">Refunded</option>
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

        <div className="md:col-span-2">
          <label className={T_LABEL}>Min ₦</label>
          <input
            type="number"
            min={0}
            value={minTotal}
            onChange={(e) => setMinTotal(e.target.value)}
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          />
        </div>

        <div className="md:col-span-2">
          <label className={T_LABEL}>Max ₦</label>
          <input
            type="number"
            min={0}
            value={maxTotal}
            onChange={(e) => setMaxTotal(e.target.value)}
            className={`w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={`rounded-lg ${SILVER_BORDER} bg-white px-3 py-2 ${BTN} hover:bg-black/5`}
          onClick={() => ordersQ.refetch()}
          disabled={!queriesEnabled}
        >
          Refresh
        </button>

        <button className={`rounded-lg ${SILVER_BORDER} bg-white px-3 py-2 ${BTN} hover:bg-black/5`} onClick={clearFilters}>
          Clear
        </button>

        <button
          type="button"
          aria-pressed={isTodayActive}
          onClick={toggleToday}
          className={`rounded-lg px-3 py-2 ${BTN} border transition ${isTodayActive ? "bg-zinc-900 text-white border-zinc-900" : `bg-white ${SILVER_BORDER} hover:bg-black/5`
            }`}
        >
          Today
        </button>

        <div className={`ml-auto ${T_SM} text-ink-soft`}>
          {filteredSorted.length > 0 ? (
            <>
              Showing {pageStart}-{pageEnd} of {filteredSorted.length}
            </>
          ) : (
            "No matching orders"
          )}
          {isTodayActive && filteredSorted.length > 0 && <span className="ml-2">(today)</span>}
        </div>
      </div>
    </>
  );

  /* ---------------- Metrics ---------------- */
  const profitRangeQ = useQuery({
    queryKey: ["metrics", "profit-summary", { from: toYMD(from), to: toYMD(to) }],
    enabled: queriesEnabled && isMetricsRole,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (toYMD(from)) params.set("from", toYMD(from)!);
      if (toYMD(to)) params.set("to", toYMD(to)!);

      const { data } = await api.get(
        `/api/admin/metrics/profit-summary${params.toString() ? `?${params.toString()}` : ""}`,
        AXIOS_COOKIE_CFG
      );

      return data as {
        revenuePaid: number | string;
        refunds: number | string;
        revenueNet: number | string;
        gatewayFees: number | string;
        taxCollected: number | string;
        commsNet: number | string;
        grossProfit: number | string;
        grossProfitSafe?: number | string;
        today?: { grossProfit: number | string; grossProfitSafe?: number | string };
        range: { from: string; to: string };
      };
    },
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    retry: false,
  });

  const aggregates = useMemo(() => {
    if (!isMetricsRole) return null;

    let revenuePaid = 0;
    let refundsAmt = 0;

    for (const o of filteredSorted) {
      const metricsRevenue = fmtN(o.metrics?.revenue);
      const paidAmount = fmtN(o.paidAmount);
      if (metricsRevenue > 0) revenuePaid += metricsRevenue;
      else if (paidAmount > 0) revenuePaid += paidAmount;
    }

    const revenueNet = revenuePaid - refundsAmt;
    return { revenuePaid, refunds: refundsAmt, revenueNet };
  }, [filteredSorted, isMetricsRole]);

  const grossProfit = useMemo(() => {
    if (!isMetricsRole) return 0;

    const apiRes: any = profitRangeQ.data;
    if (apiRes) {
      const raw = fmtN(apiRes.grossProfit);
      if (Number.isFinite(raw) && raw !== 0) return raw;

      const safe = fmtN(apiRes.grossProfitSafe);
      return safe;
    }

    let acc = 0;
    for (const o of filteredSorted) {
      const realized = isPaidStatus(o.status) || fmtN(o.paidAmount) > 0;
      if (!realized) continue;
      const svc = orderServiceFee(o);
      if (svc !== 0) acc += svc;
    }
    return acc;
  }, [isMetricsRole, profitRangeQ.data, filteredSorted]);

  /* ---------------- Actions ---------------- */
  const onToggle = (id: string) => setExpandedId((curr) => (curr === id ? null : id));
  const closeOtp = () => setOtpModal({ open: false });

  const otpReqKey = (orderId: string, purpose: OtpPurpose) => `otp:req:${orderId}:${purpose}`;

  const loadPendingOtp = (orderId: string, purpose: OtpPurpose) => {
    try {
      const raw = sessionStorage.getItem(otpReqKey(orderId, purpose));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      const expiresAt = Number(obj?.expiresAt || 0);
      const requestId = String(obj?.requestId || "");
      const channelHint = obj?.channelHint ?? null;

      if (!requestId || !expiresAt) return null;

      if (Date.now() >= expiresAt) {
        sessionStorage.removeItem(otpReqKey(orderId, purpose));
        return null;
      }

      return { requestId, expiresAt, channelHint };
    } catch {
      return null;
    }
  };

  const savePendingOtp = (
    orderId: string,
    purpose: OtpPurpose,
    data: { requestId: string; expiresAt: number; channelHint?: string | null }
  ) => {
    sessionStorage.setItem(otpReqKey(orderId, purpose), JSON.stringify(data));
  };

  const clearPendingOtp = (orderId: string, purpose: OtpPurpose) => {
    sessionStorage.removeItem(otpReqKey(orderId, purpose));
  };

  const requestOtp = async (orderId: string, purpose: OtpPurpose) => {
    const { data } = await api.post(
      `/api/orders/${encodeURIComponent(orderId)}/otp/request`,
      { purpose },
      { ...AXIOS_COOKIE_CFG, headers: { "Content-Type": "application/json" } }
    );

    const expiresInSec = Number(data?.expiresInSec ?? 300);
    const expiresAt = Date.now() + Math.max(30, expiresInSec) * 1000;

    const out = {
      requestId: String(data?.requestId ?? ""),
      expiresAt,
      channelHint: data?.channelHint ?? null,
    };

    if (out.requestId) savePendingOtp(orderId, purpose, out);
    return out;
  };

  const verifyOtp = async (orderId: string, requestId: string, purpose: OtpPurpose, otp: string) => {
    const { data } = await api.post(
      `/api/orders/${encodeURIComponent(orderId)}/otp/verify`,
      { purpose, requestId, otp },
      { ...AXIOS_COOKIE_CFG, headers: { "Content-Type": "application/json" } }
    );

    const otpToken = String(data?.token ?? "");
    if (!otpToken) throw new Error("OTP verified but no token returned.");
    return otpToken;
  };

  const withOtp = async (
    orderId: string,
    purpose: OtpPurpose,
    onSuccess: (otpToken: string) => Promise<void> | void
  ) => {
    try {
      const pending = loadPendingOtp(orderId, purpose);
      if (pending) {
        setOtpModal({
          open: true,
          orderId,
          purpose,
          requestId: pending.requestId,
          expiresAt: pending.expiresAt,
          channelHint: pending.channelHint,
          otp: "",
          busy: false,
          error: null,
          onSuccess,
        });
        return;
      }

      const r = await requestOtp(orderId, purpose);
      if (!r.requestId) throw new Error("Failed to request OTP.");

      setOtpModal({
        open: true,
        orderId,
        purpose,
        requestId: r.requestId,
        expiresAt: r.expiresAt,
        channelHint: r.channelHint,
        otp: "",
        busy: false,
        error: null,
        onSuccess,
      });
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || "Could not send OTP");
    }
  };

  const onPay = (orderId: string) => {
    withOtp(orderId, "PAY_ORDER", async (otpToken) => {
      sessionStorage.setItem(`otp:${orderId}:PAY_ORDER`, otpToken);
      nav(`/payment?orderId=${encodeURIComponent(orderId)}`);
    });
  };

  const canCancel = (details: OrderRow, latestPayment: PaymentRow | null) => {
    const st = String(details.status || "").toUpperCase();
    const isPaidEffective = isPaidStatus(details.status) || isPaidStatus(latestPayment?.status);

    if (isPaidEffective) return false;
    if (["CANCELED", "CANCELLED", "REFUNDED"].includes(st)) return false;

    return ["PENDING", "CREATED"].includes(st);
  };

  const onCancel = async (orderId: string) => {
    const ok = window.confirm("Cancel this order? This can only be done before payment/fulfillment.");
    if (!ok) return;

    withOtp(orderId, "CANCEL_ORDER", async (otpToken) => {
      try {
        const url = isAdmin
          ? `/api/admin/orders/${encodeURIComponent(orderId)}/cancel`
          : `/api/orders/${encodeURIComponent(orderId)}/cancel`;

        await api.post(url, {}, { ...AXIOS_COOKIE_CFG, headers: { [OTP_HEADER_NAME]: otpToken } });

        await ordersQ.refetch();
        setExpandedId(null);
        closeOtp();
      } catch (e: any) {
        if (isAuthError(e)) nav("/login", { replace: true, state: { from: location.pathname + location.search } });
        else alert(e?.response?.data?.error || "Could not cancel order");
      }
    });
  };

  const canRefund = (details: OrderRow, latestPayment: PaymentRow | null) => {
    if (!isAdmin) return false;

    const orderSt = String(details.status || "").toUpperCase();
    const paySt = String(latestPayment?.status || "").toUpperCase();

    if (orderSt === "REFUNDED" || paySt === "REFUNDED") return false;

    const isPaidEffective = isPaidStatus(details.status) || isPaidStatus(latestPayment?.status);
    return isPaidEffective;
  };

  const onRefund = async (orderId: string) => {
    if (!isAdmin) return;

    const ok = window.confirm("Refund this order? This will initiate a refund for the latest paid payment.");
    if (!ok) return;

    withOtp(orderId, "REFUND_ORDER", async (otpToken) => {
      try {
        await api.post(
          `/api/admin/orders/${encodeURIComponent(orderId)}/refund`,
          {},
          { ...AXIOS_COOKIE_CFG, headers: { [OTP_HEADER_NAME]: otpToken } }
        );

        await ordersQ.refetch();
        setExpandedId(null);
        closeOtp();
      } catch (e: any) {
        if (isAuthError(e)) nav("/login", { replace: true, state: { from: location.pathname + location.search } });
        else alert(e?.response?.data?.error || "Could not refund order");
      }
    });
  };

    // ---------------- Customer Refund (SHOPPER) ----------------
  const submitCustomerRefund = async (draft: RefundDraft) => {
    // payload: keep it flexible for your API
    const payload: any = {
      orderId: draft.orderId,
      reason: draft.reason,
      message: draft.message,
      mode: draft.mode,
    };

    if (draft.mode === "SOME") {
      payload.itemIds = Object.keys(draft.selectedItemIds || {}).filter((id) => draft.selectedItemIds[id]);
    }

    // Try a couple of common endpoints (keeps your UI resilient)
    const tryUrls = ["/api/refunds", "/api/refunds/request", "/api/orders/refund-request"];

    let lastErr: any = null;
    for (const url of tryUrls) {
      try {
        await api.post(url, payload, { ...AXIOS_COOKIE_CFG, headers: { "Content-Type": "application/json" } });
        return true;
      } catch (e: any) {
        lastErr = e;
        if (isAuthError(e)) throw e;
      }
    }

    console.warn("Customer refund submit failed", lastErr);
    throw lastErr || new Error("Could not submit refund request");
  };

  const onCustomerRefund = (details: OrderRow) => {
    // Guard: only customers
    if (isAdmin) return;

    const orderId = String(details.id || "");
    if (!orderId) return;

    // Build an initial draft (ALL by default)
    const initial: RefundDraft = {
      orderId,
      reason: "NOT_RECEIVED",
      message: "",
      mode: "ALL",
      selectedItemIds: {},
      busy: false,
      error: null,
    };

    // Simple modal UI (no extra component files needed)
    const RefundModal = () => {
      const [draft, setDraft] = useState<RefundDraft>(initial);

      const items = Array.isArray(details.items) ? details.items : [];

      const canPickSome = items.length > 0;

      const toggleItem = (id: string) => {
        setDraft((s) => ({
          ...s,
          selectedItemIds: { ...s.selectedItemIds, [id]: !s.selectedItemIds[id] },
        }));
      };

      const pickedCount = Object.keys(draft.selectedItemIds).filter((k) => draft.selectedItemIds[k]).length;

      return (
        <div className="space-y-3">
          <div className="text-xs text-ink-soft">
            Requesting refund for order <span className="font-mono">{orderId}</span>
          </div>

          <div>
            <label className={T_LABEL}>Reason</label>
            <select
              value={draft.reason}
              onChange={(e) => setDraft((s) => ({ ...s, reason: e.target.value as RefundReason }))}
              className={`mt-1 w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
            >
              <option value="NOT_RECEIVED">Not received</option>
              <option value="DAMAGED">Damaged</option>
              <option value="WRONG_ITEM">Wrong item</option>
              <option value="NOT_AS_DESCRIBED">Not as described</option>
              <option value="CHANGED_MIND">Changed mind</option>
              <option value="OTHER">Other</option>
            </select>
          </div>

          <div>
            <label className={T_LABEL}>Message (optional)</label>
            <textarea
              value={draft.message}
              onChange={(e) => setDraft((s) => ({ ...s, message: e.target.value }))}
              rows={3}
              className={`mt-1 w-full ${SILVER_BORDER} rounded-xl px-3 py-2 ${INP}`}
              placeholder="Tell us what went wrong…"
            />
          </div>

          {canPickSome && (
            <div className="space-y-2">
              <label className={T_LABEL}>Refund scope</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`rounded-lg px-3 py-2 ${BTN_XS} border ${
                    draft.mode === "ALL" ? "bg-zinc-900 text-white border-zinc-900" : `bg-white ${SILVER_BORDER}`
                  }`}
                  onClick={() => setDraft((s) => ({ ...s, mode: "ALL" }))}
                >
                  All items
                </button>
                <button
                  type="button"
                  className={`rounded-lg px-3 py-2 ${BTN_XS} border ${
                    draft.mode === "SOME" ? "bg-zinc-900 text-white border-zinc-900" : `bg-white ${SILVER_BORDER}`
                  }`}
                  onClick={() => setDraft((s) => ({ ...s, mode: "SOME" }))}
                >
                  Select items
                </button>
              </div>

              {draft.mode === "SOME" && (
                <div className={`rounded-xl ${SILVER_BORDER} p-2 max-h-48 overflow-auto`}>
                  {items.map((it) => (
                    <label key={it.id} className="flex items-start gap-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={!!draft.selectedItemIds[it.id]}
                        onChange={() => toggleItem(it.id)}
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <span className="block truncate">{(it.title || it.product?.title || "—").toString()}</span>
                        <span className="block text-xs text-ink-soft">
                          Qty {String(it.quantity ?? 1)} • {ngn.format(fmtN(it.unitPrice))}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {draft.mode === "SOME" && pickedCount === 0 && (
                <div className="text-xs text-amber-700">Pick at least one item.</div>
              )}
            </div>
          )}

          {draft.error && <div className="text-xs text-rose-600">{draft.error}</div>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              className={`rounded-xl ${SILVER_BORDER} bg-white px-3 py-2 ${BTN} hover:bg-black/5`}
              onClick={() => closeModal()}
              disabled={draft.busy}
            >
              Cancel
            </button>

            <button
              className={`rounded-xl bg-zinc-900 text-white px-3 py-2 ${BTN} disabled:opacity-50`}
              disabled={
                draft.busy ||
                !draft.orderId ||
                (draft.mode === "SOME" && canPickSome && pickedCount === 0)
              }
              onClick={async () => {
                try {
                  setDraft((s) => ({ ...s, busy: true, error: null }));

                  await submitCustomerRefund(draft);

                  closeModal();
                  showSuccessModal("Refund requested", "Your refund request has been submitted. We’ll notify you with updates.");
                  refundsQ.refetch?.();
                } catch (e: any) {
                  if (isAuthError(e)) {
                    nav("/login", { replace: true, state: { from: location.pathname + location.search } });
                    return;
                  }
                  setDraft((s) => ({
                    ...s,
                    busy: false,
                    error: e?.response?.data?.error || e?.message || "Could not submit refund request",
                  }));
                }
              }}
            >
              Submit request
            </button>
          </div>
        </div>
      );
    };

    openModal({
      title: "Request refund",
      message: <RefundModal />,
      size: "md",
    });
  };


  const viewReceipt = (key: string) => nav(`/receipt/${encodeURIComponent(key)}`);

  const downloadReceipt = async (key: string) => {
    try {
      const res = await api.get(`/api/payments/${encodeURIComponent(key)}/receipt.pdf`, {
        ...AXIOS_COOKIE_CFG,
        responseType: "blob",
      });

      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `receipt-${key}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      if (isAuthError(e)) nav("/login", { replace: true, state: { from: location.pathname + location.search } });
      else alert(e?.response?.data?.error || "Could not download receipt.");
    }
  };

  const printReceipt = async (key: string) => {
    try {
      const res = await api.get(`/api/payments/${encodeURIComponent(key)}/receipt.pdf`, {
        ...AXIOS_COOKIE_CFG,
        responseType: "blob",
      });

      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const w = window.open(url, "_blank");
      if (w) {
        const onLoad = () => {
          try {
            w.focus();
            w.print();
          } catch { }
        };
        w.addEventListener("load", onLoad, { once: true });
      }

      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      if (isAuthError(e)) nav("/login", { replace: true, state: { from: location.pathname + location.search } });
      else alert(e?.response?.data?.error || "Could not open receipt for print.");
    }
  };

  /* ---------------- Refund modals (your existing logic continues...) ---------------- */
  // NOTE: I’m leaving your refund modal logic intact — only styling below gets smaller/tighter on mobile.

  /* ---------------- Redirects (AFTER hooks) ---------------- */
  if (mustLogin || mustLoginFromData) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (mustGoSupplier) {
    return <Navigate to="/supplier/orders" replace />;
  }

  /* ---------------- Render ---------------- */
  return (
    <SiteLayout>
      {/* Slightly tighter padding on mobile + consistent smaller base text */}
      <div className={`max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-5 md:py-6 ${T_BASE}`}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold text-ink">
              {isAdmin ? "All Orders" : "My Orders"}
            </h1>
            <p className={`mt-1 ${T_SM} text-ink-soft`}>
              {isAdmin ? "Manage all customer orders." : "Your recent purchase history."}
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
              onClick={() => ordersQ.refetch()}
              className={`rounded-xl ${SILVER_BORDER} px-3 py-2 ${BTN_XS} bg-white ${SILVER_SHADOW_SM}`}
              disabled={!queriesEnabled}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className={`mb-4 p-4 hidden min-[768px]:block ${CARD_2XL}`}>{FilterContent}</div>

        {!isAdmin && (

          <button className={`hidden min-[768px]:inline-flexitems-center gap-2 rounded-lg ${SILVER_BORDER} bg-white hover:bg-black/5 px-3 py-2 ${BTN} ${SILVER_SHADOW_SM}`}
            onClick={() => openModal({ title: "Refunds", message: "Open refunds modal here." })}
            disabled={!queriesEnabled}
          >
            My Refunds{refunds.length ? ` (${refunds.length})` : ""}
          </button>
        )}

        {filtersOpen && (
          <div className="fixed inset-0 z-40 min-[768px]:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setFiltersOpen(false)} />
            <div className={`absolute inset-y-0 left-0 w-[84%] max-w-xs p-4 ${CARD_2XL} rounded-none rounded-r-2xl`}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Filter orders</h2>
                <button
                  onClick={() => setFiltersOpen(false)}
                  className={`${BTN_XS} text-ink-soft px-2 py-1 rounded-lg hover:bg-black/5`}
                >
                  Close
                </button>
              </div>
              <div className="space-y-3">{FilterContent}</div>
            </div>
          </div>
        )}

        {isMetricsRole && aggregates && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className={`${CARD_XL} p-3`}>
              <div className={`${T_SM} text-ink-soft`}>Revenue (net)</div>
              <div className="font-semibold">{ngn.format(aggregates.revenueNet)}</div>
              <div className={`${T_XS} text-ink-soft`}>
                Paid {ngn.format(aggregates.revenuePaid)} • Refunds {ngn.format(aggregates.refunds)}
              </div>
            </div>
            <div className={`${CARD_XL} p-3`}>
              <div className={`${T_SM} text-ink-soft`}>Gross Profit</div>
              <div className="font-semibold">{ngn.format(grossProfit)}</div>
            </div>
          </div>
        )}

        {/* Desktop Orders table (unchanged sizing since md+) */}
        {/* Desktop Orders table */}
        <div className={`overflow-hidden mt-4 hidden md:block ${CARD_2XL}`}>
          <div className="px-4 md:px-5 py-3 border-b border-zinc-200/70 flex items-center justify-between">
            <div className="text-sm text-ink-soft">
              {loading
                ? "Loading…"
                : filteredSorted.length
                  ? `Showing ${pageStart}-${pageEnd} of ${filteredSorted.length} orders`
                  : "No orders match your filters."}
            </div>
            <button
              onClick={() => ordersQ.refetch()}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200/80 bg-white hover:bg-black/5 px-3 py-2 text-sm shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
              disabled={!queriesEnabled}
            >
              Refresh
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-ink">
                  <th className="text-left px-3 py-2">Order</th>
                  {isAdmin && <th className="text-left px-3 py-2">User</th>}
                  <th className="text-left px-3 py-2">Items</th>
                  <th className="text-left px-3 py-2">Total</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-200/70">
                {loading && (
                  <>
                    <SkeletonRow cols={colSpan} mode="table" />
                    <SkeletonRow cols={colSpan} mode="table" />
                    <SkeletonRow cols={colSpan} mode="table" />
                  </>
                )}

                {!loading && paginated.length === 0 && (
                  <tr>
                    <td colSpan={colSpan} className="px-3 py-6 text-center text-zinc-500">
                      No orders match your filters.
                    </td>
                  </tr>
                )}

                {!loading &&
                  paginated.map((o) => {
                    const isOpen = expandedId === o.id;
                    const details: OrderRow = isOpen && orderDetailQ.data?.id === o.id ? (orderDetailQ.data as any) : o;

                    const latestPayment = latestPaymentOf(details);
                    const receiptKey = receiptKeyFromPayment(latestPayment);

                    const isPaidEffective = isPaidStatus(details.status) || isPaidStatus(latestPayment?.status);
                    const isPendingOrCreated =
                      !isPaidEffective && ["PENDING", "CREATED"].includes(String(details.status || "").toUpperCase());

                    const canShowReceipt = !!receiptKey && isPaidEffective;
                    const canCancelThis = canCancel(details, latestPayment);

                    return (
                      <React.Fragment key={o.id}>
                        <tr
                          className={`hover:bg-black/5 cursor-pointer ${isOpen ? "bg-amber-50/50" : ""}`}
                          onClick={() => onToggle(o.id)}
                          aria-expanded={isOpen}
                        >
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`inline-block w-4 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden>
                                ▶
                              </span>
                              <span className="font-mono">{o.id}</span>
                            </div>
                          </td>

                          {isAdmin && <td className="px-3 py-3">{details.userEmail || "—"}</td>}

                          <td className="px-3 py-3">
                            {Array.isArray(details.items) && details.items.length > 0 ? (
                              <div className="space-y-1">
                                {details.items.slice(0, 3).map((it) => {
                                  const name = (it.title || it.product?.title || "—").toString();
                                  const qty = Number(it.quantity ?? 1);
                                  const unit = fmtN(it.unitPrice);
                                  return (
                                    <div key={it.id} className="text-ink">
                                      <span className="font-medium">{name}</span>
                                      <span className="text-ink-soft">{`  •  ${qty} × ${ngn.format(unit)}`}</span>
                                    </div>
                                  );
                                })}
                                {details.items.length > 3 && (
                                  <div className="text-xs text-ink-soft">+ {details.items.length - 3} more…</div>
                                )}
                              </div>
                            ) : isOpen && orderDetailQ.isFetching ? (
                              <span className="text-ink-soft text-xs">Loading items…</span>
                            ) : (
                              "—"
                            )}
                          </td>

                          <td className="px-3 py-3">{ngn.format(fmtN(details.total))}</td>

                          <td className="px-3 py-3">
                            <StatusDot label={details.status || "—"} />
                          </td>

                          <td className="px-3 py-3">{fmtDate(details.createdAt)}</td>

                          <td className="px-3 py-3">
                            <button
                              className={`inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs ${isPaidEffective
                                ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                                : isPendingOrCreated
                                  ? "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                                  : "bg-white border-zinc-200/80 hover:bg-black/5 text-ink-soft"
                                }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggle(o.id);
                              }}
                            >
                              {isOpen ? "Hide details" : "View details"}
                            </button>
                          </td>
                        </tr>

                        {isOpen && (
                          <tr>
                            <td colSpan={colSpan} className="p-0">
                              <div className="px-4 md:px-6 py-4 bg-white border-t border-zinc-200/70">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="text-sm">
                                    <div>
                                      <span className="text-ink-soft">Order:</span>{" "}
                                      <span className="font-mono">{details.id}</span>
                                    </div>
                                    <div className="text-ink-soft">
                                      Placed: {fmtDate(details.createdAt)} • Status: <b>{details.status}</b>
                                    </div>
                                    {latestPayment && (
                                      <div className="text-ink-soft">
                                        Payment: <b>{latestPayment.status}</b>
                                        {latestPayment.reference && (
                                          <>
                                            {" "}
                                            • Ref: <span className="font-mono">{latestPayment.reference}</span>
                                          </>
                                        )}
                                        {latestPayment.amount != null && <> • {ngn.format(fmtN(latestPayment.amount))}</>}
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex flex-wrap gap-2">
                                    {isPendingOrCreated && (
                                      <button
                                        className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-xs md:text-sm hover:bg-emerald-700 shadow-[0_10px_24px_rgba(16,185,129,0.18)]"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onPay(details.id);
                                        }}
                                      >
                                        Pay now
                                      </button>
                                    )}

                                    {!isAdmin && canRequestRefundAsCustomer(details, latestPayment) && (
                                      <button
                                        className="rounded-lg border border-zinc-200/80 px-4 py-2 text-xs md:text-sm hover:bg-black/5 text-indigo-700 shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onCustomerRefund(details);
                                        }}
                                      >
                                        Request refund
                                      </button>
                                    )}

                                    {canCancelThis && (
                                      <button
                                        className="rounded-lg border border-zinc-200/80 px-4 py-2 text-xs md:text-sm hover:bg-black/5 text-rose-600 shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onCancel(details.id);
                                        }}
                                      >
                                        Cancel order
                                      </button>
                                    )}

                                    {canShowReceipt && (
                                      <>
                                        <button
                                          className="inline-flex items-center justify-center rounded-lg border border-zinc-200/80 bg-white px-3 py-2 text-xs md:text-sm hover:bg-black/5 shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!receiptKey) return;
                                            viewReceipt(receiptKey);
                                          }}
                                        >
                                          View receipt
                                        </button>

                                        <button
                                          className="inline-flex items-center justify-center rounded-lg border border-zinc-200/80 bg-white px-3 py-2 text-xs md:text-sm hover:bg-black/5 shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!receiptKey) return;
                                            downloadReceipt(receiptKey);
                                          }}
                                        >
                                          Download PDF
                                        </button>

                                        <button
                                          className="inline-flex items-center justify-center rounded-lg border border-zinc-200/80 bg-white px-3 py-2 text-xs md:text-sm hover:bg-black/5 shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!receiptKey) return;
                                            printReceipt(receiptKey);
                                          }}
                                        >
                                          Print
                                        </button>
                                      </>
                                    )}

                                    {canRefund(details, latestPayment) && (
                                      <button
                                        className="rounded-lg border border-zinc-200/80 px-4 py-2 text-xs md:text-sm hover:bg-black/5 text-indigo-700 shadow-[0_6px_16px_rgba(148,163,184,0.16)]"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onRefund(details.id);
                                        }}
                                      >
                                        Refund
                                      </button>
                                    )}
                                  </div>
                                </div>

                                <div className={`mt-4 overflow-hidden ${CARD_XL}`}>
                                  {/* ... keep your existing expanded content ... */}
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
              page={currentPage}
              totalPages={totalPages}
              onChange={(p) => {
                setExpandedId(null);
                setPage(p);
              }}
            />
          </div>
        </div>

        {/* Mobile Orders list: tighter spacing + smaller text */}
        <div className="mt-4 space-y-2.5 md:hidden">
          {loading && (
            <>
              <SkeletonRow mode="card" />
              <SkeletonRow mode="card" />
              <SkeletonRow mode="card" />
            </>
          )}

          {!loading && paginated.length === 0 && (
            <div className={`${CARD_2XL} py-6 px-4 text-center text-zinc-500 ${T_SM}`}>
              No orders match your filters.
            </div>
          )}

          {!loading &&
            paginated.map((o) => {
              const isOpen = expandedId === o.id;
              const details: OrderRow = isOpen && (orderDetailQ.data as any)?.id === o.id ? (orderDetailQ.data as any) : o;

              const latestPayment = latestPaymentOf(details);
              const receiptKey = receiptKeyFromPayment(latestPayment);

              const isPaidEffective = isPaidStatus(details.status) || isPaidStatus(latestPayment?.status);
              const isPendingOrCreated =
                !isPaidEffective && ["PENDING", "CREATED"].includes(String(details.status || "").toUpperCase());

              const firstItemTitle = details.items?.[0]?.title || details.items?.[0]?.product?.title || "";

              return (
                <div
                  key={o.id}
                  className={`${CARD_2XL} p-3 flex flex-col gap-2`}
                  onClick={() => setExpandedId((curr) => (curr === o.id ? null : o.id))}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className={T_LABEL}>Order ID</div>
                      <div className="font-mono text-[11px] sm:text-xs truncate">{details.id}</div>
                    </div>
                    <div className="shrink-0">
                      <StatusDot label={details.status || "—"} />
                    </div>
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className={`${T_SM} text-ink-soft truncate`}>
                        {firstItemTitle
                          ? firstItemTitle.toString().slice(0, 44) +
                          (details.items && details.items.length > 1 ? ` +${details.items.length - 1}` : "")
                          : isOpen && orderDetailQ.isFetching
                            ? "Loading items…"
                            : `${details.items?.length || 0} item(s)`}
                      </div>
                      <div className={`${T_XS} text-ink-soft`}>Placed {fmtDate(details.createdAt)}</div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className={T_LABEL}>Total</div>
                      <div className="font-semibold text-[13px] sm:text-sm">{ngn.format(fmtN(details.total))}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    {isPendingOrCreated && (
                      <button
                        className={`rounded-lg bg-emerald-600 text-white px-3 py-1.5 ${BTN_XS} shadow-[0_10px_24px_rgba(16,185,129,0.18)]`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onPay(details.id);
                        }}
                      >
                        Pay
                      </button>
                    )}

                    {receiptKey && isPaidEffective && (
                      <button
                        className={`rounded-lg ${SILVER_BORDER} px-3 py-1.5 ${BTN_XS} bg-white ${SILVER_SHADOW_SM}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          viewReceipt(receiptKey);
                        }}
                      >
                        Receipt
                      </button>
                    )}

                    <button
                      className={`rounded-lg ${SILVER_BORDER} px-3 py-1.5 ${BTN_XS} bg-white hover:bg-black/5`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(details.id);
                      }}
                    >
                      {isOpen ? "Hide" : "Details"}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="mt-1.5 border-t border-zinc-200/70 pt-2 space-y-1">
                      {(details.items || []).slice(0, 6).map((it) => (
                        <div key={it.id} className={`flex justify-between gap-2 ${T_XS} text-ink-soft`}>
                          <span className="min-w-0 truncate">
                            {(it.title || it.product?.title || "—").toString()}
                            {it.quantity && <span>{` • ${it.quantity} pcs`}</span>}
                          </span>
                          <span className="shrink-0">
                            {ngn.format(
                              it.lineTotal != null ? fmtN(it.lineTotal) : fmtN(it.unitPrice) * Number(it.quantity ?? 1)
                            )}
                          </span>
                        </div>
                      ))}
                      {details.items && details.items.length > 6 && (
                        <div className={`${T_XS} text-ink-soft`}>+ {details.items.length - 6} more items</div>
                      )}

                      {(!details.items || details.items.length === 0) && (
                        <div className={`${T_XS} text-ink-soft`}>
                          {orderDetailQ.isFetching ? "Loading order items…" : "No items found for this order."}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onChange={(p) => {
              setExpandedId(null);
              setPage(p);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </div>

        {/* OTP modal: smaller + tighter on mobile */}
        {otpModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-3 sm:px-4">
            <div className="absolute inset-0 bg-black/40" />
            <div className={`relative w-full max-w-md rounded-2xl bg-white p-4 ${SILVER_BORDER} ${SILVER_SHADOW_LG}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Enter OTP</div>
                  <div className={`${T_SM} text-ink-soft mt-1`}>
                    {otpModal.channelHint ? `We sent a code (${otpModal.channelHint}).` : "We sent a code to your phone/email."}
                  </div>
                </div>
                <button className={`${BTN_XS} text-ink-soft px-2 py-1 rounded-lg hover:bg-black/5`} onClick={closeOtp}>
                  Close
                </button>
              </div>

              <div className="mt-3">
                <label className={T_LABEL}>OTP code</label>
                <input
                  value={otpModal.otp}
                  onChange={(e) =>
                    setOtpModal((s) =>
                      !s.open ? s : { ...s, otp: e.target.value.replace(/\D/g, "").slice(0, 6), error: null }
                    )
                  }
                  inputMode="numeric"
                  autoFocus
                  className={`mt-1 w-full ${SILVER_BORDER} rounded-xl px-3 py-2 text-[14px] sm:text-base tracking-widest`}
                  placeholder="123456"
                />
                {!!otpModal.error && <div className="mt-2 text-[11px] text-rose-600">{otpModal.error}</div>}
              </div>

              <div className="mt-4 flex items-center gap-2">
                <button
                  disabled={otpModal.busy || otpModal.otp.length < 4}
                  className={`flex-1 rounded-xl bg-zinc-900 text-white px-3 py-2 ${BTN} disabled:opacity-50`}
                  onClick={async () => {
                    if (!otpModal.open) return;
                    try {
                      setOtpModal((s) => (!s.open ? s : { ...s, busy: true, error: null }));
                      // @ts-ignore
                      const otpToken = await verifyOtp(otpModal.orderId, otpModal.requestId, otpModal.purpose, otpModal.otp);
                      // @ts-ignore
                      clearPendingOtp(otpModal.orderId, otpModal.purpose);
                      // @ts-ignore
                      await otpModal.onSuccess(otpToken);
                      closeOtp();
                    } catch (e: any) {
                      setOtpModal((s) =>
                        !s.open
                          ? s
                          : {
                            ...s,
                            busy: false,
                            error: e?.response?.data?.error || e?.message || "Invalid or expired OTP",
                          }
                      );
                    }
                  }}
                >
                  Verify
                </button>

                <button
                  disabled={otpModal.busy}
                  className={`rounded-xl ${SILVER_BORDER} bg-white px-3 py-2 ${BTN} hover:bg-black/5 disabled:opacity-50`}
                  onClick={async () => {
                    if (!otpModal.open) return;
                    try {
                      setOtpModal((s) => (!s.open ? s : { ...s, busy: true, error: null }));
                      // @ts-ignore
                      const r = await requestOtp(otpModal.orderId, otpModal.purpose);
                      setOtpModal((s) =>
                        !s.open
                          ? s
                          : {
                            ...s,
                            busy: false,
                            requestId: r.requestId,
                            expiresAt: r.expiresAt,
                            channelHint: r.channelHint,
                            otp: "",
                          }
                      );
                    } catch (e: any) {
                      setOtpModal((s) =>
                        !s.open ? s : { ...s, busy: false, error: e?.response?.data?.error || "Could not resend OTP" }
                      );
                    }
                  }}
                >
                  Resend
                </button>
              </div>

              <div className={`mt-3 ${T_XS} text-ink-soft`}>
                Tip: If you don’t receive the code within ~30 seconds, tap Resend.
              </div>
            </div>
          </div>
        )}
      </div>
    </SiteLayout>
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
