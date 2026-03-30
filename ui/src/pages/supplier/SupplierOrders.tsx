// src/pages/supplier/SupplierOrders.tsx
import React, { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  PackageCheck,
  Search,
  Sparkles,
  Truck,
  ChevronDown,
  ChevronUp,
  Save,
  Banknote,
  RefreshCcw,
  ChevronLeft,
  ChevronRight,
  Users,
} from "lucide-react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { AxiosError } from "axios";

import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { AssignRiderControl } from "../../components/supplier/AssignRiderControl";
import { useSupplierVerificationGate } from "../../hooks/useSupplierVerificationGate";

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

type AddressLike = {
  houseNumber?: string | null;
  streetName?: string | null;
  postCode?: string | null;
  town?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  lga?: string | null;
  landmark?: string | null;
  directionsNote?: string | null;
};

type OrderItem = {
  id: string;
  title?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  chosenSupplierProductOfferId?: string | null;
  chosenSupplierVariantOfferId?: string | null;
  chosenSupplierUnitPrice?: number | null;
  selectedOptions?: any;
};

type SupplierOrder = {
  id: string;
  status?: string | null;
  createdAt?: string | null;
  customerEmail?: string | null;
  shippingAddress?: AddressLike | null;

  purchaseOrderId?: string | null;
  supplierStatus?: string | null;

  items?: OrderItem[] | null;

  supplierAmount?: number | null;
  poSubtotal?: number | null;
  payoutStatus?: string | null;
  paidOutAt?: string | null;
  refundId?: string | null;
  riderId?: string | null;
  refundStatus?: string | null;

  deliveryOtpVerifiedAt?: string | null;
};

type SupplierOrdersEnvelope = {
  data: SupplierOrder[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const ADMIN_SUPPLIER_KEY = "adminSupplierId";

function normRole(role: unknown) {
  let r = String(role ?? "").trim().toUpperCase();
  r = r.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
  if (r === "SUPERADMIN") r = "SUPER_ADMIN";
  if (r === "SUPER_ADMINISTRATOR") r = "SUPER_ADMIN";
  return r;
}

function safeGetStoredAdminSupplierId() {
  if (typeof window === "undefined") return undefined;
  const v = String(window.localStorage.getItem(ADMIN_SUPPLIER_KEY) ?? "").trim();
  return v || undefined;
}

function safeSetStoredAdminSupplierId(value: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ADMIN_SUPPLIER_KEY, value);
}

function formatDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function moneyNgn(n?: number | null) {
  if (n == null) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const hasDecimals = Math.abs(v % 1) > 0;
  return `₦${v.toLocaleString("en-NG", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function badgeClass(status: string) {
  const s = String(status || "").toUpperCase();
  if (["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"].includes(s)) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (
    ["CONFIRMED", "PACKED", "FUNDED", "CREATED", "PENDING", "PROCESSING"].includes(
      s
    )
  ) {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  if (["CANCELED", "CANCELLED", "FAILED", "REFUND_REQUESTED"].includes(s)) {
    return "bg-rose-50 text-rose-700 border-rose-200";
  }
  return "bg-zinc-50 text-zinc-700 border-zinc-200";
}

function payoutBadgeClass(status?: string | null) {
  const s = String(status || "").toUpperCase();
  if (["RELEASED", "PAID"].includes(s))
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (["HELD", "PENDING"].includes(s))
    return "bg-amber-50 text-amber-700 border-amber-200";
  if (["FAILED", "REFUNDED"].includes(s))
    return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-zinc-50 text-zinc-700 border-zinc-200";
}

function formatAddress(a?: AddressLike | null) {
  if (!a) return "—";
  const line1 = [a.houseNumber || "", a.streetName || ""]
    .filter(Boolean)
    .join(" ")
    .trim();
  const parts = [
    line1,
    a.landmark || "",
    a.town || "",
    a.city || "",
    a.state || "",
    a.postCode || "",
    a.country || "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

function supplierOptionsLabel(selectedOptions: any) {
  if (!Array.isArray(selectedOptions) || !selectedOptions.length) return "";
  return selectedOptions
    .map((o) => {
      const a = o?.attribute || "Attribute";
      const v = o?.value || o?.name || "Value";
      return `${a}: ${v}`;
    })
    .join(", ");
}

function orderItems(items?: OrderItem[] | null) {
  return Array.isArray(items) ? items : [];
}

const FLOW = ["PENDING", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED"] as const;
type FlowStatus = (typeof FLOW)[number];

function normStatus(s?: string | null) {
  return String(s || "").toUpperCase().trim();
}

function toFlowBaseStatus(raw?: string | null) {
  const s = normStatus(raw);
  if (s === "CANCELLED") return "CANCELED";
  if (["CREATED", "FUNDED", "PROCESSING"].includes(s)) return "PENDING";
  if (s === "OUT_FOR_DELIVERY") return "SHIPPED";
  return s || "PENDING";
}

function suggestedNextStatus(curRaw?: string | null) {
  const cur = toFlowBaseStatus(curRaw);
  const idx = FLOW.indexOf(cur as FlowStatus);
  if (idx >= 0 && idx < FLOW.length - 1) return FLOW[idx + 1];
  return cur;
}

function allowedStatusOptions(curRaw?: string | null) {
  const cur = toFlowBaseStatus(curRaw);

  if (cur === "DELIVERED" || cur === "CANCELED") return new Set([cur]);

  const idx = FLOW.indexOf(cur as FlowStatus);
  if (idx < 0) return new Set(["CONFIRMED", "CANCELED"]);

  const allowed = new Set<string>();
  if (idx + 1 < FLOW.length) allowed.add(FLOW[idx + 1]);
  if (["PENDING", "CONFIRMED", "PACKED"].includes(cur)) allowed.add("CANCELED");
  return allowed;
}

function normStr(v: any) {
  return String(v ?? "").trim();
}

export default function SupplierOrders() {
  const { orderId } = useParams<{ orderId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const hydrated = useAuthStore((s: any) => s.hydrated) as boolean;
  const rawRole = useAuthStore((s: any) => s.user?.role);
  const role = normRole(rawRole);

  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const isRider = role === "SUPPLIER_RIDER";
  const isSupplierUser = role === "SUPPLIER";

  const verificationQ = useSupplierVerificationGate(hydrated && isSupplierUser);
  const verificationGate = verificationQ.data?.gate;

  const onboardingBlocked =
    isSupplierUser &&
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

  const lockReason =
    onboardingBlocked
      ? verificationGate?.lockReason ||
        "Your updated documents are currently under review. Payout and payout-related actions stay locked until re-verification is completed."
      : undefined;

  const urlSupplierId = useMemo(() => {
    const v = normStr(searchParams.get("supplierId"));
    return v || undefined;
  }, [searchParams]);

  const storedSupplierId = useMemo(() => safeGetStoredAdminSupplierId(), []);
  const adminSupplierId = isAdmin ? urlSupplierId ?? storedSupplierId : undefined;

  useEffect(() => {
    if (!isAdmin) return;

    const fromUrl = normStr(searchParams.get("supplierId"));
    const fromStore = safeGetStoredAdminSupplierId();

    if (fromUrl) {
      if (fromUrl !== fromStore) safeSetStoredAdminSupplierId(fromUrl);
      return;
    }

    if (fromStore) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (next.get("supplierId") === fromStore) return next;
          next.set("supplierId", fromStore);
          return next;
        },
        { replace: true }
      );
    }
  }, [isAdmin, setSearchParams, searchParams]);

  const withSupplierCtx = (to: string) => {
    if (!isAdmin || !adminSupplierId) return to;
    const sep = to.includes("?") ? "&" : "?";
    return `${to}${sep}supplierId=${encodeURIComponent(adminSupplierId)}`;
  };

  const [q, setQ] = useState(() => (orderId ?? searchParams.get("q") ?? "").trim());

  useEffect(() => {
    const v = (orderId ?? "").trim();
    if (!v) return;

    setQ(v);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("q", v);
        return next;
      },
      { replace: true }
    );
  }, [orderId, setSearchParams]);

  useEffect(() => {
    const v = (q ?? "").trim();
    const cur = (searchParams.get("q") ?? "").trim();
    if (v === cur) return;

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set("q", v);
        else next.delete("q");
        return next;
      },
      { replace: true }
    );
  }, [q, searchParams, setSearchParams]);

  const [deliveryOtpToken, setDeliveryOtpToken] = useState<Record<string, string>>({});
  const [deliveryOtpAutoRequested, setDeliveryOtpAutoRequested] = useState<Record<string, boolean>>({});

  const [riderView, setRiderView] = useState<"active" | "delivered">("active");

  const [deliveryOtpCode, setDeliveryOtpCode] = useState<Record<string, string>>({});
  const [deliveryOtpMsg, setDeliveryOtpMsg] = useState<
    Record<string, { type: "info" | "warn" | "error"; text: string | React.ReactNode }>
  >({});

  const [status, setStatus] = useState<string>("ANY");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<string>("CONFIRMED");

  const [cancelReason, setCancelReason] = useState<Record<string, string>>({});
  const [cancelOtpCode, setCancelOtpCode] = useState<Record<string, string>>({});
  const [cancelOtpToken, setCancelOtpToken] = useState<Record<string, string>>({});
  const [cancelOtpMsg, setCancelOtpMsg] = useState<
    Record<string, { type: "info" | "warn" | "error"; text: string }>
  >({});
  const [cancelOtpErr, setCancelOtpErr] = useState<Record<string, string>>({});
  const [cancelOtpMeta, setCancelOtpMeta] = useState<
    Record<
      string,
      {
        requestId?: string;
        channelHint?: string | null;
        expiresAt?: string | null;
        retryAt?: string | null;
      }
    >
  >({});

  const editorStatuses = ["CONFIRMED", "PACKED", "SHIPPED", "CANCELED"] as const;
  const filterStatuses = [
    "CREATED",
    "FUNDED",
    "CONFIRMED",
    "PACKED",
    "SHIPPED",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "CANCELED",
    "REFUND_REQUESTED",
  ] as const;

  const [payoutMsg, setPayoutMsg] = useState<
    Record<string, { type: "info" | "error"; text?: React.ReactNode }>
  >({});
  const [payoutPendingByPo, setPayoutPendingByPo] = useState<Record<string, boolean>>({});

  const payoutBankDetailsLink = onboardingBlocked
    ? (verificationGate?.nextPath || "/supplier/verify-contact")
    : withSupplierCtx("/supplier/settings?focus=payout-bank-details#payout-bank-details");

  const PAGE_SIZES = [10, 20, 50, 100] as const;
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState<number>(1);

  useEffect(() => {
    setPage(1);
  }, [q, status, riderView, adminSupplierId]);

  useEffect(() => {
    const timers: number[] = [];

    for (const [oid, tokenVal] of Object.entries(cancelOtpToken)) {
      const t = String(tokenVal ?? "").trim();
      if (!t) continue;

      const expiresAt = cancelOtpMeta[oid]?.expiresAt;
      if (!expiresAt) continue;

      const ms = new Date(expiresAt).getTime() - Date.now();

      if (Number.isFinite(ms) && ms <= 0) {
        setCancelOtpToken((s) => ({ ...s, [oid]: "" }));
        setCancelOtpMsg((s) => ({
          ...s,
          [oid]: { type: "warn", text: "OTP expired. Please request a new one." },
        }));
        continue;
      }

      if (!Number.isFinite(ms)) continue;

      const id = window.setTimeout(() => {
        setCancelOtpToken((s) => ({ ...s, [oid]: "" }));
        setCancelOtpCode((s) => ({ ...s, [oid]: "" }));
        setCancelOtpMsg((s) => ({
          ...s,
          [oid]: { type: "warn", text: "OTP expired. Please request a new one." },
        }));
      }, ms);

      timers.push(id);
    }

    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [cancelOtpToken, cancelOtpMeta]);

  const queryEnabled = hydrated && (!isAdmin || !!adminSupplierId);

  const ordersQ = useQuery({
    queryKey: [
      "supplier",
      "orders",
      { role, supplierId: adminSupplierId ?? null, riderView, page, pageSize },
    ],
    enabled: queryEnabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SupplierOrdersEnvelope> => {
      try {
        const params: Record<string, any> = {
          page,
          pageSize,
        };

        if (isAdmin && adminSupplierId) params.supplierId = adminSupplierId;
        if (isRider) params.view = riderView;

        const { data } = await api.get<SupplierOrdersEnvelope>("/api/supplier/orders", {
          withCredentials: true,
          params,
        });

        return {
          data: Array.isArray(data?.data) ? data.data : [],
          page: Number(data?.page ?? page) || page,
          pageSize: Number(data?.pageSize ?? pageSize) || pageSize,
          total: Number(data?.total ?? 0) || 0,
          totalPages: Number(data?.totalPages ?? 0) || 0,
        };
      } catch (err) {
        const e = err as AxiosError<any>;
        const st = e?.response?.status;
        if (st === 404 || st === 204) {
          return {
            data: [],
            page,
            pageSize,
            total: 0,
            totalPages: 0,
          };
        }
        throw err;
      }
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    retry: 1,
  });

  const serverRows = Array.isArray(ordersQ.data?.data) ? ordersQ.data!.data : [];
  const serverTotal = Number(ordersQ.data?.total ?? 0);
  const serverPage = Number(ordersQ.data?.page ?? page);
  const serverPageSize = Number(ordersQ.data?.pageSize ?? pageSize);
  const serverPageCount = Math.max(
    1,
    Number(ordersQ.data?.totalPages || Math.ceil(serverTotal / Math.max(1, serverPageSize)) || 1)
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();

    return serverRows.filter((o) => {
      const items = orderItems(o.items);
      const supplierStatusRaw = normStatus(o.supplierStatus || "PENDING");
      const supplierStatusBase = toFlowBaseStatus(supplierStatusRaw);

      if (status !== "ANY" && supplierStatusRaw !== status && supplierStatusBase !== status) {
        return false;
      }
      if (!needle) return true;

      const hitOrderId = String(o.id || "").toLowerCase().includes(needle);
      const hitEmail = String(o.customerEmail || "").toLowerCase().includes(needle);
      const hitItem = items.some((it) =>
        String(it.title || "").toLowerCase().includes(needle)
      );
      const hitRefundId = String(o.refundId || "").toLowerCase().includes(needle);

      return hitOrderId || hitRefundId || hitEmail || hitItem;
    });
  }, [serverRows, q, status]);

  const visibleRows = filtered;
  const visibleCount = visibleRows.length;

  const pageStart = serverTotal === 0 ? 0 : (serverPage - 1) * serverPageSize + 1;
  const pageEnd = serverTotal === 0 ? 0 : Math.min(serverPage * serverPageSize, serverTotal);

  const qc = useQueryClient();

  const requestDeliveryOtpM = useMutation({
    mutationFn: async (vars: { poId: string }) => {
      const { data } = await api.post(
        `/api/supplier/orders/purchase-orders/${vars.poId}/delivery-otp/request`,
        {},
        {
          withCredentials: true,
          params: isAdmin && adminSupplierId ? { supplierId: adminSupplierId } : undefined,
        }
      );
      return data as any;
    },
    onSuccess: (resp, vars) => {
      const payload = resp?.data ?? {};
      const otpToken = String(payload?.otpToken ?? "").trim();
      if (otpToken) setDeliveryOtpToken((s) => ({ ...s, [vars.poId]: otpToken }));

      const alreadyActive = !!payload?.alreadyActive;
      setDeliveryOtpMsg((s) => ({
        ...s,
        [vars.poId]: {
          type: "info",
          text: alreadyActive
            ? String(payload?.message || "OTP already sent and still active.")
            : "OTP sent to customer.",
        },
      }));
      setDeliveryOtpAutoRequested((s) => ({ ...s, [vars.poId]: true }));
    },
    onError: (err: any, vars) => {
      const poId = String(vars.poId || "").trim();
      const e = err as AxiosError<any>;
      const msg =
        (e as any)?.response?.data?.error ||
        (e as any)?.response?.data?.message ||
        e?.message ||
        "Failed to request delivery OTP";

      if (poId) {
        setDeliveryOtpMsg((s) => ({
          ...s,
          [poId]: { type: "error", text: msg },
        }));
      }
    },
  });

  const updateStatusM = useMutation({
    mutationFn: async (vars: {
      orderId: string;
      status: string;
      otpToken?: string;
      reason?: string;
    }) => {
      const otpToken = String(vars.otpToken ?? "").trim();
      const { data } = await api.patch(
        `/api/supplier/orders/${vars.orderId}/status`,
        { status: vars.status, reason: vars.reason, otpToken },
        {
          withCredentials: true,
          headers: otpToken ? { "x-otp-token": otpToken } : undefined,
          params: isAdmin && adminSupplierId ? { supplierId: adminSupplierId } : undefined,
        }
      );
      return (data as any)?.data ?? data;
    },
    onSuccess: () => {
      setEditingId(null);
      ordersQ.refetch().catch(() => null);
      qc.invalidateQueries({ queryKey: ["supplier", "dashboard", "summary"] });
      qc.invalidateQueries({ queryKey: ["supplier", "dashboard", "insights"] });
    },
  });

  const verifyDeliveryOtpM = useMutation({
    mutationFn: async (vars: { poId: string; code: string }) => {
      const otpToken = String(deliveryOtpToken[vars.poId] ?? "").trim();

      const { data } = await api.post(
        `/api/supplier/orders/purchase-orders/${vars.poId}/delivery-otp/verify`,
        { code: vars.code, otpToken },
        {
          withCredentials: true,
          headers: otpToken ? { "x-otp-token": otpToken } : undefined,
          params: isAdmin && adminSupplierId ? { supplierId: adminSupplierId } : undefined,
        }
      );

      return data as any;
    },
    onSuccess: (_data, vars) => {
      setDeliveryOtpMsg((s) => ({
        ...s,
        [vars.poId]: { type: "info", text: "Delivery confirmed." },
      }));
      setDeliveryOtpCode((s) => ({ ...s, [vars.poId]: "" }));
      setDeliveryOtpToken((s) => ({ ...s, [vars.poId]: "" }));
      setDeliveryOtpAutoRequested((s) => ({ ...s, [vars.poId]: false }));
      ordersQ.refetch().catch(() => null);
      qc.invalidateQueries({ queryKey: ["supplier", "dashboard", "summary"] });
      qc.invalidateQueries({ queryKey: ["supplier", "dashboard", "insights"] });
    },
    onError: (err: any, vars) => {
      const e = err as AxiosError<any>;
      const raw =
        (e as any)?.response?.data?.error ||
        (e as any)?.response?.data?.message ||
        e?.message ||
        "Failed to verify delivery OTP";

      const msg = String(raw);

      const isPayoutNotReady =
        msg.toLowerCase().includes("not payout-ready") ||
        msg.toLowerCase().includes("missing bank") ||
        msg.toLowerCase().includes("payouts disabled");

      setDeliveryOtpMsg((s: any) => ({
        ...s,
        [vars.poId]: {
          type: "error",
          text: isPayoutNotReady ? (
            <span>
              {onboardingBlocked
                ? "Payout actions are locked while your updated documents are under review. "
                : "Supplier is not payout-ready. "}
              <Link
                to={payoutBankDetailsLink}
                className="underline font-semibold text-rose-700 hover:text-rose-800"
              >
                {onboardingBlocked ? "Continue verification" : "Add payout bank details"}
              </Link>
            </span>
          ) : (
            msg
          ),
        },
      }));
    },
  });

  const releasePayoutM = useMutation({
    mutationFn: async (vars: { poId: string; orderId: string }) => {
      const { data } = await api.post(
        `/api/supplier/payouts/purchase-orders/${vars.poId}/release`,
        {},
        {
          withCredentials: true,
          params: isAdmin && adminSupplierId ? { supplierId: adminSupplierId } : undefined,
        }
      );
      return data as any;
    },
    onMutate: (vars) => {
      const poId = String(vars.poId || "").trim();
      if (poId) setPayoutPendingByPo((s) => ({ ...s, [poId]: true }));
      if (poId) setPayoutMsg((s) => ({ ...s, [poId]: { type: "info", text: "" } }));
    },
    onSuccess: (_data, vars) => {
      const poId = String(vars.poId || "").trim();
      if (poId) {
        setPayoutMsg((s) => ({
          ...s,
          [poId]: { type: "info", text: "Payout released (or already released)." },
        }));
        setPayoutPendingByPo((s) => ({ ...s, [poId]: false }));
      }
      ordersQ.refetch().catch(() => null);
      qc.invalidateQueries({ queryKey: ["supplier", "dashboard", "summary"] });
      qc.invalidateQueries({ queryKey: ["supplier", "dashboard", "insights"] });
    },
    onError: (err: any, vars) => {
      const poId = String(vars.poId || "").trim();
      const e = err as AxiosError<any>;

      const rawMsg =
        (e as any)?.response?.data?.error ||
        (e as any)?.response?.data?.message ||
        e?.message ||
        "Failed to release payout";

      const msg = String(rawMsg);

      const isPayoutNotReady =
        msg.toLowerCase().includes("not payout-ready") ||
        msg.toLowerCase().includes("not payout ready") ||
        msg.toLowerCase().includes("missing bank") ||
        msg.toLowerCase().includes("bank details") ||
        msg.toLowerCase().includes("payouts disabled");

      if (poId) {
        setPayoutMsg((s) => ({
          ...s,
          [poId]: {
            type: "error",
            text: isPayoutNotReady ? (
              <span>
                {onboardingBlocked
                  ? "Payout actions are locked while your updated documents are under review. "
                  : "Supplier is not payout-ready (missing bank details or payouts disabled). "}
                <Link
                  to={payoutBankDetailsLink}
                  className="underline font-semibold text-rose-700 hover:text-rose-800"
                >
                  {onboardingBlocked ? "Continue verification" : "Add payout bank details"}
                </Link>
              </span>
            ) : (
              msg
            ),
          },
        }));

        setPayoutPendingByPo((s) => ({ ...s, [poId]: false }));
      }
    },
    onSettled: (_d, _e, vars) => {
      const poId = String(vars?.poId || "").trim();
      if (poId) setPayoutPendingByPo((s) => ({ ...s, [poId]: false }));
    },
  });

  const requestCancelOtpM = useMutation({
    mutationFn: async (vars: { orderId: string }) => {
      const { data } = await api.post(
        `/api/orders/${vars.orderId}/cancel-otp/request`,
        {},
        {
          withCredentials: true,
          params: isAdmin && adminSupplierId ? { supplierId: adminSupplierId } : undefined,
        }
      );
      return data as any;
    },
    onSuccess: (data, vars) => {
      setCancelOtpErr((s) => ({ ...s, [vars.orderId]: "" }));
      setCancelOtpMeta((s) => ({
        ...s,
        [vars.orderId]: {
          requestId: String(data?.requestId ?? data?.data?.requestId ?? ""),
          retryAt: data?.retryAt ?? data?.data?.retryAt ?? undefined,
          expiresAt: data?.expiresAt ?? data?.data?.expiresAt ?? undefined,
          channelHint: data?.channelHint ?? data?.data?.channelHint ?? undefined,
        },
      }));
    },
    onError: (err: any, vars) => {
      const e = err as AxiosError<any>;
      const msg =
        (e as any)?.response?.data?.error ||
        (e as any)?.response?.data?.message ||
        e?.message ||
        "Failed to request OTP";
      setCancelOtpErr((s) => ({ ...s, [vars.orderId]: msg }));

      const retryAt = (e as any)?.response?.data?.retryAt;
      if (retryAt) {
        setCancelOtpMeta((s) => ({
          ...s,
          [vars.orderId]: { ...(s[vars.orderId] || {}), retryAt },
        }));
      }
    },
  });

  const verifyCancelOtpM = useMutation({
    mutationFn: async (vars: { orderId: string; code: string }) => {
      const requestId = cancelOtpMeta[vars.orderId]?.requestId;
      const { data } = await api.post(
        `/api/orders/${vars.orderId}/cancel-otp/verify`,
        { code: vars.code, requestId },
        {
          withCredentials: true,
          params: isAdmin && adminSupplierId ? { supplierId: adminSupplierId } : undefined,
        }
      );
      return data as any;
    },
    onSuccess: (data, vars) => {
      if (!data?.ok) {
        const code = String(data?.code || "");
        const msg = String(data?.message || "OTP failed");
        const expiresAt =
          data?.expiresAt ??
          data?.data?.expiresAt ??
          cancelOtpMeta[vars.orderId]?.expiresAt;

        setCancelOtpMeta((s) => ({
          ...s,
          [vars.orderId]: {
            ...(s[vars.orderId] || {}),
            expiresAt: expiresAt ?? s[vars.orderId]?.expiresAt,
          },
        }));

        setCancelOtpMsg((s) => ({
          ...s,
          [vars.orderId]: { type: code === "OTP_EXPIRED" ? "warn" : "error", text: msg },
        }));

        setCancelOtpToken((s) => ({ ...s, [vars.orderId]: "" }));
        setCancelOtpCode((s) => ({ ...s, [vars.orderId]: "" }));
        return;
      }

      const token = String(data?.otpToken ?? "");
      setCancelOtpToken((s) => ({ ...s, [vars.orderId]: token }));
      setCancelOtpMsg((s) => ({
        ...s,
        [vars.orderId]: { type: "info", text: "OTP verified. You can now Save." },
      }));
    },
    onError: (err: any, vars) => {
      const data = (err as any)?.response?.data;
      const code = String(data?.code || "OTP_FAILED");
      const msg = String(data?.message || data?.error || "OTP verification failed");

      setCancelOtpMsg((s) => ({
        ...s,
        [vars.orderId]: { type: code === "OTP_EXPIRED" ? "warn" : "error", text: msg },
      }));
      setCancelOtpToken((s) => ({ ...s, [vars.orderId]: "" }));
    },
  });

  function canAttemptReleasePayout(o: SupplierOrder) {
    if (onboardingBlocked) return false;

    const poId = String(o.purchaseOrderId || "").trim();
    if (!poId) return false;

    const supplierStatus = normStatus(o.supplierStatus || "");
    const payout = normStatus(o.payoutStatus || "");
    const alreadyPaid = !!o.paidOutAt || payout === "RELEASED" || payout === "PAID";
    const otpVerified = !!String(o.deliveryOtpVerifiedAt || "").trim();

    return supplierStatus === "DELIVERED" && otpVerified && !alreadyPaid;
  }

  function shouldShowReleasePayout(o: SupplierOrder) {
    if (isRider) return false;
    if (onboardingBlocked) return false;

    const poId = String(o.purchaseOrderId || "").trim();
    if (!poId) return false;

    const orderStatus = normStatus(o.status || "");
    const supplierStatus = normStatus(o.supplierStatus || "");
    const payout = normStatus(o.payoutStatus || "");

    if (orderStatus === "CANCELED" || orderStatus === "CANCELLED") return false;
    if (supplierStatus === "CANCELED" || supplierStatus === "CANCELLED") return false;

    if (o.paidOutAt) return false;
    if (payout === "RELEASED" || payout === "PAID") return false;

    return true;
  }

  function toggleExpand(orderId: string) {
    setExpanded((prev) => ({
      ...prev,
      [orderId]: !prev[orderId],
    }));
  }

  useEffect(() => {
    if (!queryEnabled || requestDeliveryOtpM.isPending) return;

    for (const o of visibleRows) {
      const poId = String(o.purchaseOrderId || "").trim();
      const supplierStatusRaw = normStatus(o.supplierStatus || "");
      const otpVerified = !!String(o.deliveryOtpVerifiedAt || "").trim();

      const canConfirmDelivery =
        !!poId &&
        ["SHIPPED", "OUT_FOR_DELIVERY"].includes(supplierStatusRaw) &&
        !otpVerified &&
        (isSupplierUser || isRider);

      if (!canConfirmDelivery) continue;
      if (deliveryOtpAutoRequested[poId]) continue;

      setExpanded((s) => ({ ...s, [o.id]: true }));
      requestDeliveryOtpM.mutate({ poId });
      break;
    }
  }, [
    visibleRows,
    queryEnabled,
    requestDeliveryOtpM,
    deliveryOtpAutoRequested,
    isSupplierUser,
    isRider,
  ]);

  return (
    <SiteLayout>
      <SupplierLayout>
        {isAdmin && !adminSupplierId && (
          <div className="mt-4 sm:mt-6 rounded-2xl border bg-amber-50 text-amber-900 border-amber-200 p-4 text-sm">
            Select a supplier on the dashboard first (Admin view) to inspect their orders.
            <Link to="/supplier" className="ml-2 underline font-semibold">
              Go to dashboard
            </Link>
          </div>
        )}

        <div className="relative overflow-hidden rounded-3xl mt-4 sm:mt-6 border">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700" />
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,0,167,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,204,255,0.25),transparent_60%)]" />
          <div className="relative px-4 sm:px-6 md:px-8 py-6 sm:py-8 text-white">
            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-[20px] sm:text-2xl md:text-3xl font-bold tracking-tight leading-tight"
            >
              Orders <Sparkles className="inline ml-1" size={20} />
            </motion.h1>

            <p className="mt-1 text-[13px] sm:text-sm text-white/80 leading-snug">
              Orders allocated to you (based on{" "}
              <code className="px-1 rounded bg-white/10">chosenSupplierId</code>).
            </p>

            <div className="mt-4 grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
              <Link
                to={withSupplierCtx("/supplier")}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-white text-zinc-900 px-3 py-2 text-[12px] sm:px-4 sm:py-2 sm:text-sm font-semibold hover:opacity-95"
              >
                Overview <ArrowRight size={14} />
              </Link>

              {(isSupplierUser || isAdmin) && (
                <Link
                  to={withSupplierCtx("/supplier/riders")}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-white/15 text-white px-3 py-2 text-[12px] sm:px-4 sm:py-2 sm:text-sm font-semibold border border-white/30 hover:bg-white/20"
                  title="Invite and manage riders"
                >
                  <Users size={14} /> Riders
                </Link>
              )}
            </div>

            {!hydrated ? (
              <div className="mt-3 text-[12px] text-white/80">Loading session…</div>
            ) : !queryEnabled ? (
              <div className="mt-3 text-[12px] text-white/80">
                Waiting for supplier context…
              </div>
            ) : ordersQ.isFetching ? (
              <div className="mt-3 text-[12px] text-white/80">Loading orders…</div>
            ) : ordersQ.isError ? (
              <div className="mt-3 text-[12px] text-white/90">
                Failed to load orders.{" "}
                <button className="underline" onClick={() => ordersQ.refetch()}>
                  Retry
                </button>
              </div>
            ) : null}

            {isRider && (
              <div className="mt-3 text-[12px] text-white/80">
                Rider account: view assigned orders and confirm delivery (OTP).
              </div>
            )}
          </div>
        </div>

        {onboardingBlocked && (
          <div className="mt-4 sm:mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="font-semibold">Verification in progress</div>
                <div className="mt-1 text-amber-800">
                  Your updated documents are currently under review. Order visibility remains available,
                  but payout-related actions and further payout bank-detail changes stay locked until re-verification is completed.
                </div>

                {verificationGate?.hasPendingRequiredDoc && (
                  <div className="mt-3 rounded-xl border border-amber-300 bg-white/70 px-3 py-2 text-[12px] text-amber-900">
                    Product, payout, withdrawal, and payout-release actions stay locked until all required documents are approved.
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

        <div className="mt-4 sm:mt-6 grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
          <Card className="lg:col-span-2">
            <div className="p-3 sm:p-5 flex flex-col gap-3">
              <div className="relative w-full">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                  size={16}
                />
                <input
                  placeholder="Search order ID, email, product…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="w-full rounded-2xl border bg-white pl-9 pr-4 py-2.5 sm:py-3 text-[13px] sm:text-sm outline-none focus:ring-4 focus:ring-fuchsia-100 focus:border-fuchsia-400 transition"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-2xl border bg-white px-4 py-2.5 sm:py-3 text-[13px] sm:text-sm"
                >
                  <option value="ANY">Any supplier status</option>
                  {filterStatuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                {isRider && (
                  <select
                    value={riderView}
                    onChange={(e) => setRiderView(e.target.value as "active" | "delivered")}
                    className="w-full rounded-2xl border bg-white px-4 py-2.5 sm:py-3 text-[13px] sm:text-sm"
                  >
                    <option value="active">Active deliveries</option>
                    <option value="delivered">Delivered by me</option>
                  </select>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-4 sm:p-5 flex items-center gap-3">
              <div className="inline-grid place-items-center w-10 h-10 rounded-2xl bg-zinc-900/5 text-zinc-800">
                <PackageCheck size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] sm:text-xs text-zinc-500">Fulfillment</div>
                <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">
                  Confirm → Pack → Ship → Deliver
                </div>
                <div className="text-[11px] text-zinc-500">No skipping steps.</div>
              </div>
            </div>
          </Card>
        </div>

        <div className="mt-4">
          <Card>
            <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bg-white/70">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <div className="text-[13px] sm:text-sm font-semibold text-zinc-900">
                    Order queue
                  </div>
                  <div className="text-[11px] sm:text-xs text-zinc-500">
                    {!queryEnabled
                      ? "Select supplier to load orders"
                      : ordersQ.isLoading
                        ? "Loading…"
                        : ordersQ.isError
                          ? "Temporarily unavailable"
                          : q.trim() || status !== "ANY"
                            ? `${visibleCount} shown on this page • ${serverTotal} total`
                            : `${serverTotal} order(s)`}
                  </div>
                </div>

                {!ordersQ.isLoading && !ordersQ.isError && serverTotal > 0 && (
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <div className="text-[11px] text-zinc-600">
                      <span className="font-semibold text-zinc-900">{pageStart}</span>–
                      <span className="font-semibold text-zinc-900">{pageEnd}</span> of{" "}
                      <span className="font-semibold text-zinc-900">{serverTotal}</span>
                    </div>

                    <select
                      value={pageSize}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        const next = Number.isFinite(n) && n > 0 ? n : 20;
                        setPageSize(next);
                        setPage(1);
                      }}
                      className="rounded-xl border bg-white px-3 py-2 text-[12px]"
                      title="Page size"
                    >
                      {PAGE_SIZES.map((n) => (
                        <option key={n} value={n}>
                          {n}/page
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      disabled={serverPage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-[12px] hover:bg-black/5 disabled:opacity-50"
                    >
                      <ChevronLeft size={14} /> Prev
                    </button>

                    <div className="text-[12px] text-zinc-600">
                      <span className="font-semibold text-zinc-900">{serverPage}</span>/
                      {serverPageCount}
                    </div>

                    <button
                      type="button"
                      disabled={serverPage >= serverPageCount}
                      onClick={() => setPage((p) => Math.min(serverPageCount, p + 1))}
                      className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-[12px] hover:bg-black/5 disabled:opacity-50"
                    >
                      Next <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 sm:p-5 space-y-3">
              {!queryEnabled && isAdmin && !adminSupplierId && (
                <div className="rounded-2xl border bg-white p-6 text-sm text-zinc-600">
                  Admin view requires a selected supplier before orders can load.
                </div>
              )}

              {ordersQ.isError && queryEnabled && (
                <div className="rounded-2xl border bg-white p-6 text-sm text-zinc-600">
                  We couldn’t load your orders right now. Please refresh and try again.
                </div>
              )}

              {!ordersQ.isLoading && !ordersQ.isError && queryEnabled && serverTotal === 0 && (
                <div className="rounded-2xl border bg-white p-6 text-sm text-zinc-600">
                  You have no orders yet.
                </div>
              )}

              {!ordersQ.isLoading &&
                !ordersQ.isError &&
                queryEnabled &&
                serverTotal > 0 &&
                visibleCount === 0 && (
                  <div className="rounded-2xl border bg-white p-6 text-sm text-zinc-600">
                    No orders on this page match your current search/filter.
                  </div>
                )}

              {visibleRows.map((o) => {
                const items = orderItems(o.items);
                const itemCount = items.length;
                const isOpen = !!expanded[o.id];
                const cancelOtpVerified = !!String(cancelOtpToken[o.id] ?? "").trim();

                const supplierStatusRaw = normStatus(o.supplierStatus || "PENDING");
                const supplierFlowBase = toFlowBaseStatus(supplierStatusRaw);

                const supplierTotal = items.reduce((sum, it) => {
                  const unit = Number(it.chosenSupplierUnitPrice ?? 0);
                  const qty = Number(it.quantity ?? 0);
                  return sum + unit * qty;
                }, 0);

                const allowed = allowedStatusOptions(supplierStatusRaw);
                const isTerminal = ["DELIVERED", "CANCELED"].includes(supplierFlowBase);
                const isCancel = normStatus(nextStatus) === "CANCELED";
                const base = toFlowBaseStatus(supplierStatusRaw);
                const cancelNeedsOtp = isCancel && ["CONFIRMED", "PACKED"].includes(base);

                const canSave =
                  allowed.has(nextStatus) &&
                  (!cancelNeedsOtp ||
                    (String(cancelReason[o.id] ?? "").trim() &&
                      String(cancelOtpToken[o.id] ?? "").trim()));

                const cmeta = cancelOtpMeta[o.id] || {};
                const retryUntilMs = cmeta.retryAt ? new Date(cmeta.retryAt).getTime() : null;
                const retryLocked = retryUntilMs != null && Date.now() < retryUntilMs;

                const poId = String(o.purchaseOrderId || "").trim();
                const payoutStatus = normStatus(o.payoutStatus || "PENDING");
                const isPayoutPending = !!(poId && payoutPendingByPo[poId]);

                const otpVerified = !!String(o.deliveryOtpVerifiedAt || "").trim();
                const canAttemptPayout = canAttemptReleasePayout(o);

                const canShowUpdateButton =
                  !isAdmin &&
                  !isRider &&
                  !isTerminal &&
                  ["PENDING", "CONFIRMED", "PACKED"].includes(supplierFlowBase);

                const canConfirmDelivery =
                  !!poId &&
                  ["SHIPPED", "OUT_FOR_DELIVERY"].includes(supplierStatusRaw) &&
                  !otpVerified;

                return (
                  <div key={o.id} className="rounded-2xl border bg-white p-3 sm:p-4">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-zinc-900 text-[13px] sm:text-sm truncate">
                            {o.id}
                          </div>
                          <div className="text-[11px] sm:text-xs text-zinc-600">
                            {o.customerEmail ? `${o.customerEmail} • ` : ""}
                            {itemCount} item{itemCount === 1 ? "" : "s"} • {formatDate(o.createdAt)}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleExpand(o.id)}
                          className="shrink-0 inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1.5 text-[12px] hover:bg-black/5"
                        >
                          {isOpen ? (
                            <>
                              Hide <ChevronUp size={14} />
                            </>
                          ) : (
                            <>
                              Details <ChevronDown size={14} />
                            </>
                          )}
                        </button>
                      </div>

                      <div className="text-[11px] text-zinc-500">
                        Ship to:{" "}
                        <span className="text-zinc-700">{formatAddress(o.shippingAddress)}</span>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-[11px] border ${badgeClass(
                            normStatus(o.status)
                          )}`}
                        >
                          ORDER: {normStatus(o.status)}
                        </span>
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-[11px] border ${badgeClass(
                            supplierStatusRaw
                          )}`}
                        >
                          YOU: {supplierStatusRaw}
                        </span>

                        {poId && (isSupplierUser || isAdmin) && (
                          <span
                            className={`inline-flex px-2 py-1 rounded-full text-[11px] border ${payoutBadgeClass(
                              o.payoutStatus
                            )}`}
                          >
                            PAYOUT: {payoutStatus || "PENDING"}
                          </span>
                        )}

                        {poId && (
                          <span
                            className={`inline-flex px-2 py-1 rounded-full text-[11px] border ${
                              otpVerified
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                            }`}
                          >
                            OTP: {otpVerified ? "VERIFIED" : "NOT VERIFIED"}
                          </span>
                        )}
                      </div>

                      {(isSupplierUser || isAdmin) && (
                        <div className="text-[12px] font-semibold text-zinc-900">
                          Supplier total:{" "}
                          <span className="text-zinc-900">{moneyNgn(supplierTotal)}</span>
                        </div>
                      )}

                      <div className="mt-1 grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                        {canShowUpdateButton && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(o.id);
                              const next = suggestedNextStatus(supplierStatusRaw);
                              setNextStatus(next === "PENDING" ? "CONFIRMED" : next);
                              setExpanded((s) => ({ ...s, [o.id]: true }));
                            }}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-3 py-2 text-[12px] hover:bg-black/5"
                            title={
                              isTerminal
                                ? "This order is already completed/canceled."
                                : "Update fulfillment status"
                            }
                          >
                            <Truck size={14} /> Update
                          </button>
                        )}

                        {canConfirmDelivery && (isSupplierUser || isRider) && (
                          <button
                            type="button"
                            onClick={() => {
                              setExpanded((s) => ({ ...s, [o.id]: true }));
                            }}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-3 py-2 text-[12px] hover:bg-black/5"
                            title="Confirm delivery with customer OTP"
                          >
                            <PackageCheck size={14} /> Deliver
                          </button>
                        )}

                        {shouldShowReleasePayout(o) && (
                          <button
                            type="button"
                            disabled={!canAttemptPayout || isPayoutPending}
                            onClick={() => {
                              const id = String(o.purchaseOrderId || "").trim();
                              if (!id) return;
                              setPayoutMsg((s) => ({ ...s, [id]: { type: "info", text: "" } }));
                              releasePayoutM.mutate({ poId: id, orderId: o.id });
                            }}
                            className="inline-flex col-span-2 sm:col-span-1 items-center justify-center gap-2 rounded-xl border bg-white px-3 py-2 text-[12px] hover:bg-black/5 disabled:opacity-50"
                            title={
                              !canAttemptPayout
                                ? onboardingBlocked
                                  ? lockReason
                                  : "Available when DELIVERED + OTP verified"
                                : "Release payout"
                            }
                          >
                            <Banknote size={14} />{" "}
                            {isPayoutPending ? "Releasing…" : "Release payout"}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => ordersQ.refetch()}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-3 py-2 text-[12px] hover:bg-black/5"
                        >
                          <RefreshCcw size={14} /> Refresh
                        </button>
                      </div>

                      {poId && payoutMsg[String(o.purchaseOrderId)]?.text ? (
                        <div
                          className={`text-[12px] ${
                            payoutMsg[String(o.purchaseOrderId)]?.type === "error"
                              ? "text-rose-700"
                              : "text-emerald-700"
                          }`}
                        >
                          {payoutMsg[String(o.purchaseOrderId)]?.text}
                        </div>
                      ) : null}
                    </div>

                    {isOpen && (
                      <div className="mt-3 rounded-2xl border bg-white p-3">
                        {poId && (isSupplierUser || isAdmin) ? (
                          <div className="mb-3 text-[11px] text-zinc-500 flex flex-wrap gap-x-3 gap-y-1 items-center">
                            <span>
                              PO:{" "}
                              <span className="text-zinc-700 font-semibold">
                                {o.purchaseOrderId}
                              </span>
                            </span>
                            <span>
                              Supplier amount:{" "}
                              <span className="text-zinc-700 font-semibold">
                                {moneyNgn(o.supplierAmount ?? o.poSubtotal ?? null)}
                              </span>
                            </span>
                            {o.paidOutAt ? (
                              <span>
                                Paid out:{" "}
                                <span className="text-zinc-700">{formatDate(o.paidOutAt)}</span>
                              </span>
                            ) : null}
                          </div>
                        ) : null}

                        {(isSupplierUser || isAdmin) &&
                          normStatus(o.supplierStatus) === "SHIPPED" &&
                          o.purchaseOrderId && (
                            <div className="mb-3">
                              <AssignRiderControl
                                purchaseOrderId={o.purchaseOrderId}
                                currentRiderId={o.riderId ?? null}
                                disabled={
                                  normStatus(o.supplierStatus) === "DELIVERED" ||
                                  normStatus(o.supplierStatus) === "CANCELED"
                                }
                              />
                            </div>
                          )}

                        {editingId === o.id && (
                          <div className="rounded-xl border bg-zinc-50 p-3 flex flex-col gap-2">
                            <div className="text-[12px] font-semibold text-zinc-700">
                              Set supplier status
                            </div>

                            <select
                              value={nextStatus}
                              onChange={(e) => setNextStatus(e.target.value)}
                              className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
                            >
                              {editorStatuses.map((s) => {
                                const disabled = !allowed.has(s);
                                const label = disabled ? `${s} (complete previous step)` : s;
                                return (
                                  <option key={s} value={s} disabled={disabled}>
                                    {label}
                                  </option>
                                );
                              })}
                            </select>

                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                disabled={!canSave || updateStatusM.isPending}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white px-3 py-2 text-[12px] font-semibold disabled:opacity-60"
                                onClick={() => {
                                  if (
                                    normStatus(nextStatus) === "CANCELED" &&
                                    cancelNeedsOtp
                                  ) {
                                    const reason = String(cancelReason[o.id] ?? "").trim();
                                    const otpToken = String(cancelOtpToken[o.id] ?? "").trim();
                                    if (!reason || !otpToken) return;
                                    updateStatusM.mutate({
                                      orderId: o.id,
                                      status: "CANCELED",
                                      otpToken,
                                      reason,
                                    });
                                    return;
                                  }
                                  updateStatusM.mutate({ orderId: o.id, status: nextStatus });
                                }}
                              >
                                <Save size={14} />{" "}
                                {updateStatusM.isPending ? "Saving…" : "Save"}
                              </button>

                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-3 py-2 text-[12px] hover:bg-black/5"
                              >
                                Cancel
                              </button>
                            </div>

                            {updateStatusM.isError && (
                              <div className="text-[12px] text-rose-700">
                                Failed to update. Please try again.
                              </div>
                            )}
                          </div>
                        )}

                        {editingId === o.id &&
                          normStatus(nextStatus) === "CANCELED" &&
                          ["CONFIRMED", "PACKED"].includes(supplierFlowBase) && (
                            <div className="mt-2 rounded-xl border bg-white p-3">
                              <div className="text-[12px] font-semibold text-zinc-800">
                                Cancel requires customer OTP + reason
                              </div>

                              <textarea
                                value={cancelReason[o.id] ?? ""}
                                onChange={(e) =>
                                  setCancelReason((s) => ({ ...s, [o.id]: e.target.value }))
                                }
                                placeholder="Reason for cancellation…"
                                className="mt-2 w-full rounded-xl border p-2 text-sm"
                                rows={2}
                              />

                              {!cancelOtpVerified ? (
                                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <button
                                    type="button"
                                    disabled={requestCancelOtpM.isPending || retryLocked}
                                    onClick={() => requestCancelOtpM.mutate({ orderId: o.id })}
                                    className="rounded-xl bg-zinc-900 text-white px-3 py-2 text-[12px] font-semibold disabled:opacity-60"
                                  >
                                    {retryLocked
                                      ? "Please wait…"
                                      : requestCancelOtpM.isPending
                                        ? "Requesting…"
                                        : "Request OTP"}
                                  </button>

                                  <div className="flex gap-2">
                                    <input
                                      value={cancelOtpCode[o.id] ?? ""}
                                      onChange={(e) => {
                                        const v = String(e.target.value || "")
                                          .replace(/\D/g, "")
                                          .slice(0, 6);
                                        setCancelOtpCode((s) => ({ ...s, [o.id]: v }));
                                      }}
                                      placeholder="123456"
                                      className="flex-1 rounded-xl border px-3 py-2 text-sm"
                                      inputMode="numeric"
                                    />

                                    <button
                                      type="button"
                                      disabled={
                                        verifyCancelOtpM.isPending ||
                                        !/^\d{6}$/.test(cancelOtpCode[o.id] ?? "")
                                      }
                                      onClick={() =>
                                        verifyCancelOtpM.mutate({
                                          orderId: o.id,
                                          code: cancelOtpCode[o.id] ?? "",
                                        })
                                      }
                                      className="rounded-xl bg-emerald-600 text-white px-3 py-2 text-[12px] font-semibold disabled:opacity-60"
                                    >
                                      Verify
                                    </button>
                                  </div>

                                  {cancelOtpErr[o.id] ? (
                                    <div className="text-[12px] text-rose-700 sm:col-span-2">
                                      {cancelOtpErr[o.id]}
                                    </div>
                                  ) : cmeta.channelHint ? (
                                    <div className="text-[11px] text-zinc-600 sm:col-span-2">
                                      Sent via:{" "}
                                      <span className="font-semibold text-zinc-800">
                                        {cmeta.channelHint}
                                      </span>
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="mt-2 text-[12px] text-emerald-700">
                                  OTP verified. You can now Save.
                                </div>
                              )}

                              <div className="mt-2 text-[11px] text-zinc-500">
                                After OTP is verified, Save will work.
                              </div>
                            </div>
                          )}

                        {cancelOtpMsg[o.id]?.text ? (
                          <div
                            className={`mt-2 text-[12px] ${
                              cancelOtpMsg[o.id].type === "warn"
                                ? "text-amber-700"
                                : cancelOtpMsg[o.id].type === "error"
                                  ? "text-rose-700"
                                  : "text-emerald-700"
                            }`}
                          >
                            {cancelOtpMsg[o.id].text}
                            {cancelOtpMsg[o.id].type === "warn" ? (
                              <button
                                type="button"
                                onClick={() => requestCancelOtpM.mutate({ orderId: o.id })}
                                className="ml-2 underline font-semibold"
                              >
                                Request new OTP
                              </button>
                            ) : null}
                          </div>
                        ) : null}

                        {poId &&
                          ["SHIPPED", "OUT_FOR_DELIVERY"].includes(supplierStatusRaw) &&
                          !otpVerified &&
                          (isSupplierUser || isRider) && (
                            <div className="rounded-2xl border bg-white/90 p-4 space-y-3">
                              <div className="text-sm font-semibold text-zinc-800">
                                Confirm delivery (customer OTP)
                              </div>

                              <div className="flex flex-col gap-2 sm:flex-row">
                                <input
                                  value={deliveryOtpCode[poId] ?? ""}
                                  onChange={(e) => {
                                    const v = String(e.target.value || "")
                                      .replace(/\D/g, "")
                                      .slice(0, 6);
                                    setDeliveryOtpCode((s) => ({ ...s, [poId]: v }));
                                  }}
                                  placeholder="123456"
                                  inputMode="numeric"
                                  className="w-full min-w-0 flex-1 rounded-xl border border-zinc-300 px-4 py-3 text-[16px] outline-none focus:ring-2 focus:ring-fuchsia-300"
                                />

                                <button
                                  type="button"
                                  disabled={
                                    verifyDeliveryOtpM.isPending ||
                                    !/^\d{6}$/.test(deliveryOtpCode[poId] ?? "")
                                  }
                                  onClick={() =>
                                    verifyDeliveryOtpM.mutate({
                                      poId,
                                      code: deliveryOtpCode[poId] ?? "",
                                    })
                                  }
                                  className="w-full sm:w-auto shrink-0 rounded-xl bg-zinc-900 px-4 py-3 text-white font-semibold disabled:opacity-60"
                                >
                                  {verifyDeliveryOtpM.isPending ? "Verifying…" : "Verify OTP"}
                                </button>
                              </div>

                              <button
                                type="button"
                                disabled={requestDeliveryOtpM.isPending}
                                onClick={() => {
                                  setDeliveryOtpAutoRequested((s) => ({ ...s, [poId]: true }));
                                  requestDeliveryOtpM.mutate({ poId });
                                }}
                                className="w-full rounded-xl bg-black px-4 py-3 text-white font-semibold disabled:opacity-60"
                              >
                                {requestDeliveryOtpM.isPending ? "Requesting…" : "Request OTP"}
                              </button>

                              {deliveryOtpMsg[poId]?.text ? (
                                <div
                                  className={`text-xs ${
                                    deliveryOtpMsg[poId]?.type === "error"
                                      ? "text-rose-700"
                                      : deliveryOtpMsg[poId]?.type === "warn"
                                        ? "text-amber-700"
                                        : "text-emerald-700"
                                  }`}
                                >
                                  {deliveryOtpMsg[poId]?.text}
                                </div>
                              ) : null}

                              <p className="text-xs text-zinc-500">
                                OTP is sent automatically as soon as delivery confirmation becomes available.
                              </p>
                            </div>
                          )}

                        <div className="mt-3 space-y-2">
                          <div className="text-[12px] font-semibold text-zinc-700">
                            Items allocated to you
                          </div>

                          {items.map((it) => {
                            const qty = Number(it.quantity ?? 0);
                            const optLabel = supplierOptionsLabel(it.selectedOptions);
                            const supplierCost =
                              it.chosenSupplierUnitPrice != null
                                ? Number(it.chosenSupplierUnitPrice) * qty
                                : null;

                            return (
                              <div key={it.id} className="rounded-xl border bg-zinc-50 p-3">
                                <div className="text-[13px] font-semibold text-zinc-900">
                                  {it.title || "Untitled item"}
                                </div>
                                <div className="text-[12px] text-zinc-600 mt-1">
                                  Qty: <b>{qty}</b>
                                  {optLabel ? <span> • {optLabel}</span> : null}
                                </div>

                                {!isRider && (
                                  <div className="text-[11px] text-zinc-500 mt-2">
                                    Retail: <b>{moneyNgn(Number(it.unitPrice ?? 0))}</b> • Line:{" "}
                                    <b>{moneyNgn(Number(it.lineTotal ?? 0))}</b>
                                    {supplierCost != null ? (
                                      <>
                                        {" "}
                                        • Your cost: <b>{moneyNgn(supplierCost)}</b>
                                      </>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {!ordersQ.isLoading &&
                !ordersQ.isError &&
                serverTotal > 0 &&
                serverPageCount > 1 && (
                  <div className="pt-2 flex items-center justify-end gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={serverPage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-[12px] hover:bg-black/5 disabled:opacity-50"
                    >
                      <ChevronLeft size={14} /> Prev
                    </button>

                    <div className="text-[12px] text-zinc-600">
                      Page <span className="font-semibold text-zinc-900">{serverPage}</span> /{" "}
                      <span className="font-semibold text-zinc-900">{serverPageCount}</span>
                    </div>

                    <button
                      type="button"
                      disabled={serverPage >= serverPageCount}
                      onClick={() => setPage((p) => Math.min(serverPageCount, p + 1))}
                      className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-[12px] hover:bg-black/5 disabled:opacity-50"
                    >
                      Next <ChevronRight size={14} />
                    </button>
                  </div>
                )}
            </div>
          </Card>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}