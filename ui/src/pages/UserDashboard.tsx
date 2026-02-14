// src/pages/UserDashboard.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { useModal } from "../components/ModalProvider";
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  LogOut,
  ChevronRight,
  Truck,
  ShoppingBag,
  CreditCard,
  Clock3,
  Info,
  RefreshCcw,
  MailCheck,
  Phone,
} from "lucide-react";
import { motion } from "framer-motion";
import SiteLayout from "../layouts/SiteLayout";

/* ---------------------- Types ---------------------- */
type Role = "ADMIN" | "SUPER_ADMIN" | "SUPER_USER" | "SHOPPER" | "SUPPLIER_RIDER";

type Address = {
  houseNumber?: string | null;
  streetName?: string | null;
  postCode?: string | null;
  town?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

type MeResponse = {
  id: string;
  email: string;
  role: Role;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  phone?: string | null;
  joinedAt?: string | null;
  status?: "PENDING" | "PARTIAL" | "VERIFIED";
  emailVerified?: boolean;
  phoneVerified?: boolean;
  dob?: string | null;

  address?: Address | null;
  shippingAddress?: Address | null;

  language?: string | null;
  theme?: "light" | "dark" | "system";
  currency?: string | null;
  productInterests?: string[];
  notificationPrefs?: {
    email?: boolean;
    sms?: boolean;
    push?: boolean;
  } | null;
};

type OrderLiteItem = {
  id: string;
  productId: string;
  title: string;
  quantity: number;
};

type OrderLite = {
  id: string;
  createdAt: string;
  status:
  | "PENDING"
  | "PAID"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "FAILED"
  | "PROCESSING"
  | string;
  total: number;
  items: OrderLiteItem[];
  trackingUrl?: string | null;
};

// Matches /api/orders/summary + an extra byStatus we compute on the client
type OrdersSummary = {
  ordersCount: number;
  totalSpent: number;
  recent: Array<{
    id: string;
    status: string;
    total: number;
    createdAt: string;
  }>;
  byStatus: Record<string, number>;
};

type RecentTransaction = {
  orderId: string;
  createdAt: string;
  total: number;
  orderStatus: string;
  payment?: {
    id: string;
    reference: string | null;
    status: string;
    channel: string | null;
    provider: string | null;
    createdAt: string;
  };
};

type LocalCartItem = { productId: string; qty: number };

/* ---------------------- Cookie auth helpers ---------------------- */
const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function isAuthError(e: any) {
  const s = e?.response?.status;
  return s === 401 || s === 403;
}

/* ---------------------- Local cart merge ---------------------- */
function mergeIntoLocalCart(items: LocalCartItem[]) {
  try {
    const key = "cart";
    const curr: LocalCartItem[] = JSON.parse(localStorage.getItem(key) || "[]");
    const byId = new Map<string, number>();
    for (const it of curr) byId.set(it.productId, (byId.get(it.productId) || 0) + (it.qty || 0));
    for (const it of items) byId.set(it.productId, (byId.get(it.productId) || 0) + (it.qty || 0));
    const merged: LocalCartItem[] = Array.from(byId.entries()).map(([productId, qty]) => ({ productId, qty }));
    localStorage.setItem(key, JSON.stringify(merged));
  } catch {
    /* noop */
  }
}

/* ---------------------- Utils ---------------------- */
const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});
const dateFmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

function dateTimeFmt(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleString();
}

function sinceJoined(iso?: string | null) {
  if (!iso) return "";
  const start = new Date(iso);
  if (Number.isNaN(+start)) return "";
  const now = new Date();

  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();

  if (days < 0) {
    months -= 1;
    const prevMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    days += prevMonthDays;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (months > 0) parts.push(`${months}m`);
  if (parts.length === 0) {
    const diffDays = Math.max(1, Math.floor((now.getTime() - start.getTime()) / (24 * 3600 * 1000)));
    parts.push(`${diffDays}d`);
  }
  return parts.join(" ");
}

function initialsFrom(first?: string | null, last?: string | null, fallback?: string) {
  const a = (first || "").trim();
  const b = (last || "").trim();
  if (a || b) return `${a?.[0] ?? ""}${b?.[0] ?? ""}`.toUpperCase() || "U";
  return (fallback?.[0] || "U").toUpperCase();
}

/* ---------------------- Data hooks (cookie session) ---------------------- */
function useMe(onAuthError?: () => void) {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api.get<MeResponse>("/api/auth/me", AXIOS_COOKIE_CFG)).data;
      } catch (e: any) {
        if (isAuthError(e)) onAuthError?.();
        throw e;
      }
    },
    staleTime: 30_000,
    retry: (count, e: any) => (isAuthError(e) ? false : count < 1),
  });
}

function useRecentOrders(limit = 5, onAuthError?: () => void) {
  return useQuery({
    queryKey: ["orders", "recent", limit],
    queryFn: async (): Promise<OrderLite[]> => {
      try {
        const res = await api.get<{ data: any[] }>(`/api/orders/mine?limit=${limit}`, AXIOS_COOKIE_CFG);
        const raw = Array.isArray(res.data?.data) ? res.data.data : [];
        return raw.map((o) => ({
          id: o.id,
          createdAt: o.createdAt,
          status: o.status,
          total: Number(o.total ?? 0),
          items: (Array.isArray(o.items) ? o.items : []).map((it: any) => ({
            id: it.id,
            productId: it.productId,
            title: it.title ?? "—",
            quantity: Number(it.quantity ?? 1),
          })),
          trackingUrl: null,
        }));
      } catch (e: any) {
        if (isAuthError(e)) onAuthError?.();
        throw e;
      }
    },
    staleTime: 20_000,
    retry: (count, e: any) => (isAuthError(e) ? false : count < 1),
  });
}

function useOrdersSummary(onAuthError?: () => void) {
  return useQuery({
    queryKey: ["orders", "summary"],
    queryFn: async (): Promise<OrdersSummary> => {
      try {
        try {
          const [summaryRes, mineRes] = await Promise.all([
            api.get<{
              ordersCount: number;
              totalSpent: number;
              recent: Array<{ id: string; status: string; total: number; createdAt: string }>;
            }>("/api/orders/summary", AXIOS_COOKIE_CFG),
            api.get<{ data: any[] }>("/api/orders/mine?limit=1000", AXIOS_COOKIE_CFG),
          ]);

          const list = Array.isArray(mineRes.data?.data) ? mineRes.data.data : [];
          const byStatus: Record<string, number> = {};
          for (const o of list) {
            const s = String(o.status || "UNKNOWN").toUpperCase();
            byStatus[s] = (byStatus[s] || 0) + 1;
          }

          return {
            ordersCount: summaryRes.data.ordersCount ?? list.length,
            totalSpent: Number(summaryRes.data.totalSpent ?? 0),
            recent: (summaryRes.data.recent || []).map((o) => ({
              id: o.id,
              status: o.status,
              total: Number(o.total ?? 0),
              createdAt: o.createdAt,
            })),
            byStatus,
          };
        } catch {
          // Fallback: derive everything from /mine
          const mineRes = await api.get<{ data: any[] }>("/api/orders/mine?limit=1000", AXIOS_COOKIE_CFG);
          const list = Array.isArray(mineRes.data?.data) ? mineRes.data.data : [];
          const byStatus: Record<string, number> = {};
          let totalSpent = 0;
          for (const o of list) {
            const s = String(o.status || "UNKNOWN").toUpperCase();
            byStatus[s] = (byStatus[s] || 0) + 1;
            if (s === "PAID" || s === "COMPLETED") totalSpent += Number(o.total ?? 0);
          }
          return {
            ordersCount: list.length,
            totalSpent,
            recent: list.slice(0, 5).map((o) => ({
              id: o.id,
              status: o.status,
              total: Number(o.total ?? 0),
              createdAt: o.createdAt,
            })),
            byStatus,
          };
        }
      } catch (e: any) {
        if (isAuthError(e)) onAuthError?.();
        // keep the dashboard stable even if endpoints fail
        return { ordersCount: 0, totalSpent: 0, recent: [], byStatus: {} };
      }
    },
    staleTime: 30_000,
  });
}

function useRecentTransactions(limit = 5, onAuthError?: () => void) {
  return useQuery({
    queryKey: ["payments", "recent-orders", limit],
    queryFn: async (): Promise<RecentTransaction[]> => {
      try {
        const res = await api.get<{ data: any[] }>(`/api/payments/recent?limit=${limit}`, AXIOS_COOKIE_CFG);
        const orders = Array.isArray(res.data?.data) ? res.data.data : [];

        const txs: RecentTransaction[] = orders.map((o: any) => {
          const p = o.latestPayment || null;
          const createdAt = p?.paidAt || p?.createdAt || o.createdAt || new Date().toISOString();
          const total = Number(o.total ?? p?.amount ?? 0);
          const orderStatus = String(p?.status || "PENDING");

          const payment = p
            ? {
              id: String(p.id),
              reference: p.reference ?? null,
              status: String(p.status),
              channel: p.channel ?? null,
              provider: p.provider ?? null,
              createdAt: String(p.createdAt || createdAt),
            }
            : undefined;

          return {
            orderId: String(o.id),
            createdAt: String(createdAt),
            total,
            orderStatus,
            payment,
          };
        });

        return txs;
      } catch (e: any) {
        if (isAuthError(e)) onAuthError?.();
        throw e;
      }
    },
    staleTime: 20_000,
    retry: (count, e: any) => (isAuthError(e) ? false : count < 1),
  });
}

/** Sum of successful payments; tries /api/payments/summary then falls back to orders summary, then /orders/mine */
function useTotalSpent(onAuthError?: () => void) {
  return useQuery({
    queryKey: ["payments", "totalSpent"],
    queryFn: async () => {
      // 1) payments summary (if you have it)
      try {
        const r = await api.get<{ totalPaid?: number; totalPaidNgn?: number }>("/api/payments/summary", AXIOS_COOKIE_CFG);
        const v = r.data?.totalPaid ?? r.data?.totalPaidNgn;
        if (typeof v === "number" && Number.isFinite(v)) return v;
      } catch (e: any) {
        if (isAuthError(e)) {
          onAuthError?.();
          return 0;
        }
      }

      // 2) orders summary
      try {
        const s = await api.get<{ ordersCount: number; totalSpent: number }>("/api/orders/summary", AXIOS_COOKIE_CFG);
        if (typeof s.data?.totalSpent === "number") return s.data.totalSpent;
      } catch (e: any) {
        if (isAuthError(e)) {
          onAuthError?.();
          return 0;
        }
      }

      // 3) derive from /orders/mine
      try {
        const res = await api.get<{ data: any[] }>("/api/orders/mine?limit=1000", AXIOS_COOKIE_CFG);
        const list = Array.isArray(res.data?.data) ? res.data.data : [];
        const total = list
          .filter((o) => ["PAID", "COMPLETED"].includes(String(o.status || "").toUpperCase()))
          .reduce((s, o) => s + (Number(o.total ?? 0) || 0), 0);
        return total;
      } catch (e: any) {
        if (isAuthError(e)) onAuthError?.();
        return 0;
      }
    },
    staleTime: 30_000,
  });
}

function useResendEmail(onAuthError?: () => void) {
  return useMutation({
    mutationFn: async () => {
      try {
        return (await api.post("/api/auth/resend-email", {}, AXIOS_COOKIE_CFG)).data;
      } catch (e: any) {
        if (isAuthError(e)) onAuthError?.();
        throw e;
      }
    },
  });
}

function useResendOtp(onAuthError?: () => void) {
  return useMutation({
    mutationFn: async () => {
      try {
        return (await api.post("/api/auth/resend-otp", {}, AXIOS_COOKIE_CFG)).data as { nextResendAfterSec?: number };
      } catch (e: any) {
        if (isAuthError(e)) onAuthError?.();
        throw e;
      }
    },
  });
}

/**
 * Verify phone OTP
 * - tries a few common endpoints (your backend may name it differently)
 */
function useVerifyOtp(onAuthError?: () => void) {
  return useMutation({
    mutationFn: async (code: string) => {
      const payload = { otp: code };
      const endpoints = ["/api/auth/verify-otp", "/api/auth/otp/verify", "/api/auth/phone/verify", "/api/auth/verify-phone"];

      let lastErr: any = null;

      for (const url of endpoints) {
        try {
          const r = await api.post(url, payload, AXIOS_COOKIE_CFG);

          // If your API returns { ok: false, ... } on 200
          if (r?.data && typeof r.data === "object" && (r.data as any).ok === false) {
            const msg = ((r.data as any).message || (r.data as any).error || "Invalid OTP") as string;
            throw new Error(msg);
          }

          return r.data;
        } catch (e: any) {
          if (isAuthError(e)) onAuthError?.();
          lastErr = e;
        }
      }

      const msg =
        lastErr?.response?.data?.error ||
        lastErr?.response?.data?.message ||
        lastErr?.message ||
        "Could not verify OTP";
      throw new Error(msg);
    },
  });
}

function useLogout(onAuthError?: () => void) {
  return useMutation({
    mutationFn: async () => {
      // Try common logout endpoints; ignore if one fails and try next.
      const endpoints = ["/api/auth/logout", "/api/auth/signout", "/api/logout"];
      let lastErr: any = null;
      for (const url of endpoints) {
        try {
          const r = await api.post(url, {}, AXIOS_COOKIE_CFG);
          return r.data;
        } catch (e: any) {
          lastErr = e;
        }
      }
      // If logout endpoint doesn't exist, still "log out" client-side.
      if (lastErr && isAuthError(lastErr)) onAuthError?.();
      return { ok: true };
    },
  });
}

/* ---------------------- UI primitives ---------------------- */
function GlassCard(props: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      // ✅ FIX: overflow-visible + more neutral border so card edges are real on white backgrounds
      className={`overflow-visible rounded-2xl border border-zinc-200/60 bg-white/70 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.08)] p-4 sm:p-5 ${props.className || ""
        }`}
    >
      {/* ✅ mobile-friendly header: stacks & prevents "E" clipping */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-br from-fuchsia-500/15 to-cyan-500/15 text-fuchsia-600 shrink-0">
            {props.icon ?? <Sparkles size={16} />}
          </span>
          <h2 className="text-sm sm:text-base font-semibold tracking-tight min-w-0 truncate">{props.title}</h2>
        </div>

        {props.right ? <div className="self-start sm:self-auto shrink-0">{props.right}</div> : null}
      </div>

      {props.children}
    </motion.section>
  );
}

function Stat(props: { label: string; value: string; icon?: React.ReactNode; accent?: "emerald" | "cyan" | "violet" }) {
  const ring =
    props.accent === "emerald"
      ? "ring-emerald-400/25 text-emerald-700"
      : props.accent === "cyan"
        ? "ring-cyan-400/25 text-cyan-700"
        : "ring-violet-400/25 text-violet-700";
  const iconBg =
    props.accent === "emerald"
      ? "from-emerald-400/20 to-emerald-500/20 text-emerald-600"
      : props.accent === "cyan"
        ? "from-cyan-400/20 to-cyan-500/20 text-cyan-600"
        : "from-violet-400/20 to-violet-500/20 text-violet-600";

  return (
    <motion.div whileHover={{ y: -2 }} className={`p-3 sm:p-4 rounded-2xl border bg-white ring-1 ${ring} shadow-sm`}>
      <div className="flex items-center gap-3">
        <span className={`inline-grid place-items-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br ${iconBg}`}>
          {props.icon}
        </span>

        <div className="min-w-0">
          <div className="text-[10px] sm:text-[11px] uppercase tracking-wide text-zinc-500 truncate">{props.label}</div>
          <div className="mt-0.5 text-lg sm:text-xl font-semibold">{props.value}</div>
        </div>
      </div>
    </motion.div>
  );
}

function StatusPill({ label, count }: { label: string; count: number }) {
  const tone =
    label === "PAID"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : label === "PENDING"
        ? "bg-amber-100 text-amber-700 border-amber-200"
        : label === "SHIPPED" || label === "DELIVERED" || label === "PROCESSING"
          ? "bg-cyan-100 text-cyan-700 border-cyan-200"
          : label === "FAILED" || label === "CANCELLED"
            ? "bg-rose-100 text-rose-700 border-rose-200"
            : "bg-zinc-100 text-zinc-700 border-zinc-200";
  return (
    <span className={`inline-flex items-center gap-2 text-[11px] sm:text-xs px-2.5 py-1 rounded-full border ${tone}`}>
      <b className="font-semibold">{label}</b>
      <span className="text-[10px] opacity-70">({count})</span>
    </span>
  );
}

function PaymentBadgeInline({ status }: { status: string | undefined }) {
  const s = (status || "PENDING").toUpperCase();
  const tone =
    s === "PAID"
      ? "bg-emerald-600/10 text-emerald-700 border-emerald-600/20"
      : s === "FAILED" || s === "CANCELLED"
        ? "bg-rose-500/10 text-rose-700 border-rose-600/20"
        : "bg-amber-500/10 text-amber-700 border-amber-600/20";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] sm:text-xs border ${tone}`}>{s}</span>;
}

/* ---------------------- Page ---------------------- */
export default function UserDashboard() {
  const nav = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { openModal } = useModal();

  const redirectToLogin = () => {
    nav("/login", { replace: true, state: { from: location.pathname + location.search } });
  };

  const meQ = useMe(redirectToLogin);
  const ordersQ = useRecentOrders(5, redirectToLogin);
  const ordersSummaryQ = useOrdersSummary(redirectToLogin);
  const transactionsQ = useRecentTransactions(5, redirectToLogin);
  const totalSpentQ = useTotalSpent(redirectToLogin);

  const resendEmail = useResendEmail(redirectToLogin);
  const resendOtp = useResendOtp(redirectToLogin);
  const verifyOtp = useVerifyOtp(redirectToLogin);
  const logoutM = useLogout();

  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpCode, setOtpCode] = useState("");
  const [rebuyingId, setRebuyingId] = useState<string | null>(null);

  async function buyAgain(orderId: string) {
    try {
      setRebuyingId(orderId);

      const res = await api.get(`/api/orders/${orderId}`, AXIOS_COOKIE_CFG);

      const items = Array.isArray(res.data?.data?.items)
        ? res.data.data.items
        : Array.isArray(res.data?.items)
          ? res.data.items
          : [];

      const toCart = items.map((it: any) => ({
        productId: it.productId ?? it.product?.id ?? it.id,
        qty: it.qty ?? it.quantity ?? 1,
      }));

      if (toCart.length > 0) mergeIntoLocalCart(toCart);
      nav("/cart");
    } catch (e: any) {
      if (isAuthError(e)) return redirectToLogin();
      alert(e?.response?.data?.error || "Could not add items to cart");
    } finally {
      setRebuyingId(null);
    }
  }

  // properly tick down OTP cooldown
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const t = setInterval(() => setOtpCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [otpCooldown]);

  const me = meQ.data;
  const initials = initialsFrom(me?.firstName, me?.lastName, me?.email);

  const statusOrder = ["PENDING", "PROCESSING", "PAID", "SHIPPED", "DELIVERED", "FAILED", "CANCELLED"];
  const byStatusEntries = useMemo(() => {
    const map = ordersSummaryQ.data?.byStatus || {};
    const known = statusOrder.filter((k) => map[k] > 0).map((k) => [k, map[k]] as const);
    const unknown = Object.entries(map)
      .filter(([k]) => !statusOrder.includes(k))
      .sort((a, b) => a[0].localeCompare(b[0])) as Array<[string, number]>;
    return [...known, ...unknown];
  }, [ordersSummaryQ.data, statusOrder]);

  /* ---------------------- Skeletons ---------------------- */
  const Shimmer = () => (
    <div className="h-3 w-full rounded bg-gradient-to-r from-zinc-200 via-zinc-100 to-zinc-200 animate-pulse" />
  );

  // ✅ slightly denser on mobile
  const statsGridClass =
    "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))] sm:[grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]";

  async function handleVerifyOtp() {
    const code = String(otpCode || "").trim();
    if (!/^\d{6}$/.test(code)) {
      openModal({ title: "Invalid code", message: "OTP must be 6 digits." });
      return;
    }

    try {
      await verifyOtp.mutateAsync(code);
      setOtpCode("");
      setOtpCooldown(0);
      await qc.invalidateQueries({ queryKey: ["me"] });
      openModal({ title: "Verified", message: "Your phone number has been verified." });
    } catch (e: any) {
      openModal({ title: "Could not verify", message: e?.message || "Please try again." });
    }
  }

  return (
    <SiteLayout>
      {/* ✅ subtle overall font scale on mobile */}
      <div className="max-w-screen-2xl mx-auto text-[13px] sm:text-[14px]">
        {/* Neon gradient hero */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(closest-side,rgba(255,0,167,0.08),transparent_70%),radial-gradient(closest-side,rgba(0,204,255,0.10),transparent_70%)]" />
          <div className="relative px-4 md:px-8 pt-5 sm:pt-7 pb-3 sm:pb-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <motion.h1
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-zinc-900"
                >
                  {me ? `Hey ${me.firstName || me.displayName || me.email.split("@")[0]}!` : "Welcome!"}{" "}
                  <span className="inline-block align-middle">
                    <Sparkles className="inline text-fuchsia-600" size={20} />
                  </span>
                </motion.h1>
                <p className="text-[12px] sm:text-sm text-zinc-600 leading-5 sm:leading-6">
                  Your vibe, your orders, your payments—everything in one electric dashboard ⚡
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Content grid */}
        {/* ✅ FIX: items-start prevents the “left column stretches to match right column” blank space */}
        {/* ✅ FIX: min-[1024px] ensures true desktop breakpoint even if Tailwind breakpoints were customized */}
        <div className="px-4 md:px-8 pb-10 grid items-start gap-5 sm:gap-6 min-[1024px]:grid-cols-[320px_1fr]">
          {/* Left rail (sticky on desktop only) */}
          {/* ✅ FIX: apply sticky only at true desktop width */}
          <div className="min-w-0 space-y-5 sm:space-y-6 min-[1024px]:sticky min-[1024px]:top-6 min-[1024px]:self-start">
            <GlassCard
              title="Profile"
              icon={<ShoppingBag size={16} />}
              right={
                <button
                  className="text-[12px] sm:text-sm text-fuchsia-600 hover:underline"
                  onClick={() => nav("/profile")}
                  aria-label="Edit profile"
                >
                  Edit
                </button>
              }
            >
              <div className="flex items-start gap-3 sm:gap-4">
                {me ? (
                  <motion.div whileHover={{ rotate: -2 }}>
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl grid place-items-center border bg-gradient-to-br from-zinc-900 to-zinc-700 text-white font-semibold shadow text-sm sm:text-base">
                      {initials}
                    </div>
                  </motion.div>
                ) : (
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-zinc-200 animate-pulse" />
                )}

                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate text-sm sm:text-base">
                    {me ? `${me.firstName ?? ""} ${me?.lastName ?? ""}`.trim() || me.email : <Shimmer />}
                  </div>

                  <div className="text-[12px] sm:text-sm text-zinc-600 truncate">
                    {me?.email || (meQ.isLoading ? <Shimmer /> : "—")}
                  </div>

                  <div className="text-[11px] sm:text-xs text-zinc-600 mt-1 flex flex-wrap items-center gap-2">
                    <Clock3 size={13} className="text-cyan-600" />
                    <span className="truncate">Joined {dateFmt(me?.joinedAt)}</span>{" "}
                    {me ? (
                      me?.status === "VERIFIED" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700">
                          <CheckCircle2 size={13} /> Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700">
                          <AlertCircle size={13} /> Not verified
                        </span>
                      )
                    ) : null}
                  </div>
                </div>
              </div>

              {/* ✅ 2 columns (not 3) */}
              <div className="mt-4 grid grid-cols-2 gap-3 text-[12px] sm:text-sm">
                <Link className="group inline-flex items-center gap-1.5 text-cyan-700 hover:underline" to="/profile">
                  Manage <ChevronRight className="group-hover:translate-x-0.5 transition" size={14} />
                </Link>
                <Link className="group inline-flex items-center gap-1.5 text-cyan-700 hover:underline justify-self-end" to="/orders">
                  Orders <ChevronRight className="group-hover:translate-x-0.5 transition" size={14} />
                </Link>
              </div>
            </GlassCard>

            <GlassCard title="Verification" icon={<ShieldCheck size={16} />}>
              <div className="space-y-3 text-[12px] sm:text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <MailCheck size={15} className="text-emerald-600" />{" "}
                    <span className="truncate">Email {me?.emailVerified ? "verified" : "pending"}</span>
                  </span>

                  {!me?.emailVerified && (
                    <motion.button
                      whileHover={{ y: -1 }}
                      className="rounded-full border px-3 py-1 bg-white hover:bg-zinc-50 transition text-[12px] sm:text-sm"
                      disabled={resendEmail.isPending}
                      onClick={async () => {
                        try {
                          await resendEmail.mutateAsync();
                          qc.invalidateQueries({ queryKey: ["me"] });
                          openModal({ title: "Verification", message: "Verification email sent." });
                        } catch (e: any) {
                          if (isAuthError(e)) return redirectToLogin();
                          alert(e?.response?.data?.error || "Failed to resend email");
                        }
                      }}
                    >
                      Resend link
                    </motion.button>
                  )}
                </div>

                {/* PHONE VERIFICATION (send + verify) */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <Phone size={15} className="text-cyan-600 shrink-0" />
                    <span className="truncate">Phone {me?.phoneVerified ? "verified" : "pending"}</span>
                  </span>

                  {!me?.phoneVerified && (
                    <motion.button
                      whileHover={{ y: -1 }}
                      className="rounded-full border px-3 py-2 sm:py-1 bg-white hover:bg-zinc-50 transition disabled:opacity-50 text-[12px] sm:text-sm w-full sm:w-auto"
                      disabled={resendOtp.isPending || otpCooldown > 0}
                      title={otpCooldown > 0 ? `Retry in ${otpCooldown}s` : "Resend OTP"}
                      onClick={async () => {
                        try {
                          const resp = await resendOtp.mutateAsync();
                          setOtpCooldown(resp?.nextResendAfterSec ?? 60);
                          openModal({ title: "OTP sent", message: "OTP sent to your phone." });
                        } catch (e: any) {
                          if (isAuthError(e)) return redirectToLogin();
                          const retryAfter = e?.response?.data?.retryAfterSec;
                          if (retryAfter) setOtpCooldown(retryAfter);
                          openModal({ title: "Failed", message: e?.response?.data?.error || "Failed to resend OTP" });
                        }
                      }}
                    >
                      {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : "Resend OTP"}
                    </motion.button>
                  )}
                </div>


                {!me?.phoneVerified && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleVerifyOtp();
                      }}
                      inputMode="numeric"
                      placeholder="Enter 6-digit OTP"
                      className="w-full sm:flex-1 rounded-full border bg-white px-3 py-2 text-[12px] sm:text-sm outline-none focus:ring-2 focus:ring-fuchsia-200"
                    />

                    <motion.button
                      whileHover={{ y: -1 }}
                      className="w-full sm:w-auto rounded-full border px-4 py-2 bg-white hover:bg-zinc-50 transition disabled:opacity-50 text-[12px] sm:text-sm font-semibold"
                      disabled={verifyOtp.isPending || otpCode.trim().length !== 6}
                      onClick={handleVerifyOtp}
                      title="Verify phone OTP"
                    >
                      {verifyOtp.isPending ? "Verifying…" : "Verify"}
                    </motion.button>
                  </div>
                )}

              </div>
            </GlassCard>

            <GlassCard title="Security & Privacy" icon={<ShieldCheck size={16} />}>
              <div className="grid gap-2 text-[12px] sm:text-sm">
                <Link to="/forgot-password" className="group inline-flex items-center gap-1.5 text-fuchsia-700 hover:underline">
                  Change password <ChevronRight className="group-hover:translate-x-0.5 transition" size={14} />
                </Link>
                <Link to="/account/sessions" className="group inline-flex items-center gap-1.5 text-fuchsia-700 hover:underline">
                  Sessions & devices <ChevronRight className="group-hover:translate-x-0.5 transition" size={14} />
                </Link>
                <Link to="/privacy" className="group inline-flex items-center gap-1.5 text-fuchsia-700 hover:underline">
                  Data & privacy <ChevronRight className="group-hover:translate-x-0.5 transition" size={14} />
                </Link>
              </div>
            </GlassCard>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full text-[12px] sm:text-sm rounded-full border px-4 py-2 bg-white hover:bg-zinc-50 transition inline-flex items-center justify-center gap-2"
              onClick={async () => {
                try {
                  await logoutM.mutateAsync();
                } catch {
                  /* ignore */
                } finally {
                  qc.clear();
                  nav("/login");
                }
              }}
            >
              <LogOut size={15} /> Logout
            </motion.button>
          </div>

          {/* Right rail */}
          <div className="min-w-0 space-y-5 sm:space-y-6">
            {/* Orders summary */}
            <GlassCard
              title="Your orders at a glance"
              icon={<ShoppingBag size={16} />}
              right={
                <Link className="text-[12px] sm:text-sm text-fuchsia-700 hover:underline inline-flex items-center gap-1" to="/orders">
                  View all <ChevronRight size={14} />
                </Link>
              }
            >
              {ordersSummaryQ.isLoading ? (
                <div className={statsGridClass}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="p-3 sm:p-4 rounded-2xl border bg-white">
                      <Shimmer />
                      <div className="mt-2">
                        <Shimmer />
                      </div>
                    </div>
                  ))}
                </div>
              ) : ordersSummaryQ.isError ? (
                <div className="text-[12px] sm:text-sm text-rose-600 inline-flex items-center gap-2">
                  <Info size={16} /> Couldn’t load order summary.
                </div>
              ) : (
                <>
                  <div className={statsGridClass}>
                    <Stat
                      label="Total orders"
                      value={String(ordersSummaryQ.data?.ordersCount ?? 0)}
                      icon={<RefreshCcw size={16} />}
                      accent="violet"
                    />
                    {byStatusEntries.slice(0, 5).map(([k, v]) => (
                      <Stat
                        key={k}
                        label={k}
                        value={String(v)}
                        icon={
                          k === "PAID" ? (
                            <CheckCircle2 size={16} />
                          ) : k === "SHIPPED" || k === "DELIVERED" || k === "PROCESSING" ? (
                            <Truck size={16} />
                          ) : (
                            <Clock3 size={16} />
                          )
                        }
                        accent={k === "PAID" ? "emerald" : k === "PENDING" ? "cyan" : "violet"}
                      />
                    ))}
                  </div>

                  {byStatusEntries.length > 5 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {byStatusEntries.slice(5).map(([k, v]) => (
                        <StatusPill key={k} label={k} count={v} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </GlassCard>

            {/* Recent orders */}
            <GlassCard
              title="Recent orders"
              icon={<Truck size={16} />}
              right={
                <Link className="text-[12px] sm:text-sm text-fuchsia-700 hover:underline inline-flex items-center gap-1" to="/orders">
                  View all <ChevronRight size={14} />
                </Link>
              }
            >
              {ordersQ.isLoading ? (
                <div className="grid gap-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="border rounded-2xl p-3 sm:p-4 bg-white grid gap-2">
                      <Shimmer />
                      <Shimmer />
                    </div>
                  ))}
                </div>
              ) : ordersQ.isError ? (
                <div className="text-[12px] sm:text-sm text-rose-600 inline-flex items-center gap-2">
                  <Info size={16} /> Couldn’t load orders.
                </div>
              ) : ordersQ.data && ordersQ.data.length > 0 ? (
                <div className="grid gap-3">
                  {ordersQ.data.map((o) => (
                    <motion.div
                      key={o.id}
                      whileHover={{ scale: 1.005 }}
                      className="border rounded-2xl p-3 sm:p-4 bg-white flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4"
                    >
                      <div className="text-[11px] sm:text-xs sm:w-28 shrink-0 flex items-center justify-between sm:block">
                        <div className="text-zinc-500">{dateFmt(o.createdAt)}</div>
                        <div className="font-medium sm:mt-1">{o.status}</div>
                      </div>

                      <div className="flex-1 text-[12px] sm:text-sm min-w-0">
                        <div className="font-semibold">{ngn.format(o.total)}</div>
                        <div className="text-zinc-500 mt-1 truncate">
                          {o.items.length === 0
                            ? "No items"
                            : o.items.length === 1
                              ? o.items[0].title
                              : `${o.items[0].title} + ${o.items.length - 1} more`}
                        </div>
                      </div>

                      <div className="sm:ml-auto flex items-center justify-between sm:justify-end gap-3">
                        <Link to={`/orders?open=${o.id}`} className="text-[12px] sm:text-sm text-fuchsia-700 hover:underline">
                          Details
                        </Link>

                        <motion.button
                          whileHover={{ y: -1 }}
                          className="text-[12px] sm:text-sm rounded-full border px-3 py-1.5 bg-white hover:bg-zinc-50 transition disabled:opacity-50"
                          onClick={() => buyAgain(o.id)}
                          disabled={rebuyingId === o.id}
                          title="Re-add all items from this order to your cart"
                        >
                          {rebuyingId === o.id ? "Adding…" : "Buy again"}
                        </motion.button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] sm:text-sm text-zinc-600">No recent orders yet.</div>
              )}
            </GlassCard>

            {/* Recent transactions */}
            <GlassCard
              title="Recent transactions"
              icon={<CreditCard size={16} />}
              right={
                <Link className="text-[12px] sm:text-sm text-fuchsia-700 hover:underline inline-flex items-center gap-1" to="/orders">
                  All orders <ChevronRight size={14} />
                </Link>
              }
            >
              {transactionsQ.isLoading ? (
                <div className="grid gap-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="border rounded-2xl p-3 sm:p-4 bg-white grid gap-2">
                      <Shimmer />
                      <Shimmer />
                    </div>
                  ))}
                </div>
              ) : transactionsQ.isError ? (
                <div className="text-[12px] sm:text-sm text-rose-600 inline-flex items-center gap-2">
                  <Info size={16} /> Couldn’t load transactions.
                </div>
              ) : transactionsQ.data && transactionsQ.data.length > 0 ? (
                <div className="grid gap-3">
                  {transactionsQ.data.map((t) => (
                    <motion.div
                      key={t.orderId}
                      whileHover={{ scale: 1.005 }}
                      className="border rounded-2xl p-3 sm:p-4 bg-white flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4"
                    >
                      <div className="text-[11px] sm:text-xs sm:w-44 flex items-center justify-between sm:block">
                        <div className="text-zinc-500">{dateTimeFmt(t.createdAt)}</div>
                        <div className="font-medium sm:mt-1">{t.orderStatus}</div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] sm:text-sm font-semibold">{ngn.format(t.total)}</div>
                        <div className="text-[11px] sm:text-xs text-zinc-600 mt-1 break-words">
                          {t.payment ? (
                            <>
                              <PaymentBadgeInline status={t.payment.status} /> {t.payment.provider || "—"} •{" "}
                              {t.payment.channel || "—"} • Ref: <span className="font-mono">{t.payment.reference || "—"}</span>
                            </>
                          ) : (
                            "No payment attempts yet"
                          )}
                        </div>
                      </div>

                      <div className="sm:ml-auto flex items-center justify-between sm:justify-end gap-3">
                        <Link to={`/orders?open=${t.orderId}`} className="text-[12px] sm:text-sm text-fuchsia-700 hover:underline">
                          Details
                        </Link>
                        {t.orderStatus !== "PAID" && (
                          <motion.div whileHover={{ y: -1 }}>
                            <Link
                              to={`/payment?orderId=${t.orderId}`}
                              className="text-[12px] sm:text-sm rounded-full border px-3 py-1.5 bg-white hover:bg-zinc-50 transition"
                            >
                              Pay now
                            </Link>
                          </motion.div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] sm:text-sm text-zinc-600">No recent transactions.</div>
              )}
            </GlassCard>

            {/* Insights */}
            <GlassCard title="Your insights" icon={<Sparkles size={16} />}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Stat
                  label="Total spent"
                  value={totalSpentQ.isLoading ? "…" : ngn.format(totalSpentQ.data ?? 0)}
                  icon={<CreditCard size={16} />}
                  accent="emerald"
                />
                <Stat
                  label="Orders"
                  value={String(ordersSummaryQ.data?.ordersCount ?? 0)}
                  icon={<ShoppingBag size={16} />}
                  accent="cyan"
                />
                <Stat
                  label="Member since"
                  value={me?.joinedAt ? `${dateFmt(me.joinedAt)} • ${sinceJoined(me.joinedAt)} ago` : "—"}
                />
              </div>
              <p className="text-[11px] sm:text-xs text-zinc-600 mt-3">
                Tip: Turn on personalised recommendations in Preferences to see smarter picks here.
              </p>
            </GlassCard>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
