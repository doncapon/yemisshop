// src/pages/UserDashboard.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  ExternalLink,
  Eye,
  Search,
  X,
  Users,
  Lock,
} from "lucide-react";
import { motion } from "framer-motion";
import SiteLayout from "../layouts/SiteLayout";

import { loadCartRaw, saveCartRaw } from "../utils/cartStorage";
import { performLogout } from "../utils/logout";

type LocalCartItem = { productId: string; qty: number };

/* ---------------------- Types ---------------------- */
type Role = "ADMIN" | "SUPER_ADMIN" | "SUPER_USER" | "SHOPPER" | "SUPPLIER" | "SUPPLIER_RIDER";

type Address = {
  houseNumber?: string | null;
  streetName?: string | null;
  postCode?: string | null;
  town?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  phone?: string | null;
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
  emailVerifiedAt?: string | null;
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

type AdminUserLite = {
  id: string;
  email: string;
  role?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  status?: string | null;
};

/* ---------------------- Cookie auth helpers ---------------------- */
const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function isAuthError(e: any) {
  const s = e?.response?.status;
  return s === 401 || s === 403;
}

function isNotFound(e: any) {
  return e?.response?.status === 404;
}

function normRole(r: any) {
  let s = String(r ?? "").trim().toUpperCase();
  s = s.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
  if (s === "SUPERADMIN") s = "SUPER_ADMIN";
  if (s === "SUPER_ADMINISTRATOR") s = "SUPER_ADMIN";
  return s;
}

/* ---------------------- Local cart merge ---------------------- */
function mergeIntoLocalCart(items: LocalCartItem[]) {
  try {
    const curr = Array.isArray(loadCartRaw()) ? loadCartRaw() : [];
    const byPid = new Map<string, any>();

    for (const x of curr) {
      const pid = String(x?.productId ?? "");
      if (!pid) continue;
      byPid.set(pid, { ...x });
    }

    for (const it of items) {
      const pid = String(it.productId ?? "");
      if (!pid) continue;

      const prev = byPid.get(pid);
      const prevQty = Math.max(0, Number(prev?.qty) || 0);
      const addQty = Math.max(0, Number(it.qty) || 0);

      if (prev) {
        byPid.set(pid, { ...prev, qty: Math.max(1, prevQty + addQty) });
      } else {
        byPid.set(pid, {
          kind: "BASE",
          productId: pid,
          variantId: null,
          qty: Math.max(1, addQty || 1),
          selectedOptions: [],
        });
      }
    }

    saveCartRaw(Array.from(byPid.values()));
  } catch {
    //
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

function isTruthyFlag(v: any) {
  return v === true || v === 1 || v === "1" || v === "true" || v === "TRUE";
}

function resolveEmailVerified(raw: any): boolean {
  if (!raw) return false;

  const payload = unwrapData<any>(raw);
  const status = String(payload?.status ?? "").trim().toUpperCase();

  return (
    isTruthyFlag(payload?.emailVerified) ||
    payload?.emailVerifiedAt != null ||
    payload?.user?.emailVerifiedAt != null ||
    isTruthyFlag(payload?.user?.emailVerified) ||
    status === "VERIFIED"
  );
}

function resolveEmailVerifiedAt(raw: any): string | null {
  if (!raw) return null;

  const payload = unwrapData<any>(raw);
  return payload?.emailVerifiedAt ?? payload?.user?.emailVerifiedAt ?? null;
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
  if (years > 0) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (months > 0) parts.push(`${months} month${months === 1 ? "" : "s"}`);
  if (parts.length === 0) {
    const diffDays = Math.max(1, Math.floor((now.getTime() - start.getTime()) / (24 * 3600 * 1000)));
    parts.push(`${diffDays} day${diffDays === 1 ? "" : "s"}`);
  }
  return parts.slice(0, 2).join(" ");
}

function initialsFrom(first?: string | null, last?: string | null, fallback?: string) {
  const a = (first || "").trim();
  const b = (last || "").trim();
  if (a || b) return `${a?.[0] ?? ""}${b?.[0] ?? ""}`.toUpperCase() || "U";
  return (fallback?.[0] || "U").toUpperCase();
}

function unwrapData<T = any>(x: any): T {
  if (x && typeof x === "object") {
    if ("data" in x) return (x as any).data as T;
    if ("item" in x) return (x as any).item as T;
    if ("items" in x) return (x as any).items as T;
  }
  return x as T;
}

async function firstSuccessful<T>(urls: string[], map: (raw: any) => T): Promise<T> {
  let lastErr: any = null;
  for (const url of urls) {
    try {
      const res = await api.get(url, AXIOS_COOKIE_CFG);
      return map(unwrapData(res.data));
    } catch (e: any) {
      lastErr = e;
      if (isAuthError(e)) break;
    }
  }
  throw lastErr ?? new Error("Request failed");
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

/* ---------------------- Data hooks ---------------------- */
function useViewerMe(onAuthError?: () => void) {
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
    retry: (count, e: any) => (isAuthError(e) || isNotFound(e) ? false : count < 1),
  });
}

function useAdminUserSearch(q: string, enabled: boolean, onAuthError?: () => void) {
  const dq = useDebouncedValue(q, 250);

  return useQuery({
    queryKey: ["admin", "userSearch", dq],
    enabled: enabled && dq.trim().length >= 2,
    queryFn: async (): Promise<AdminUserLite[]> => {
      try {
        const query = encodeURIComponent(dq.trim());
        const urls = [
          `/api/admin/users?q=${query}&limit=8`,
          `/api/admin/users?search=${query}&limit=8`,
          `/api/admin/users?query=${query}&limit=8`,
          `/api/admin/users?keyword=${query}&limit=8`,
        ];

        const rows = await firstSuccessful<any>(urls, (payload: any) => payload);

        const list: any[] = Array.isArray(rows?.items)
          ? rows.items
          : Array.isArray(rows?.data)
            ? rows.data
            : Array.isArray(rows)
              ? rows
              : [];

        return list
          .map((u: any): AdminUserLite | null => {
            const id = u?.id ?? u?.userId ?? u?._id;
            const email = u?.email ?? u?.user?.email;
            if (!id || !email) return null;

            return {
              id: String(id),
              email: String(email),
              role: u?.role ?? u?.user?.role ?? null,
              firstName: u?.firstName ?? u?.user?.firstName ?? null,
              lastName: u?.lastName ?? u?.user?.lastName ?? null,
              displayName: u?.displayName ?? u?.user?.displayName ?? null,
              status: u?.status ?? u?.user?.status ?? null,
            };
          })
          .filter(Boolean) as AdminUserLite[];
      } catch (e: any) {
        if (isAuthError(e)) onAuthError?.();
        return [];
      }
    },
    staleTime: 10_000,
    retry: (count, e: any) => (isAuthError(e) || isNotFound(e) ? false : count < 1),
  });
}

function useTargetMe(targetUserId: string | null, onAuthError?: () => void) {
  return useQuery({
    queryKey: ["me", "target", targetUserId || "self"],
    queryFn: async () => {
      if (!targetUserId) {
        try {
          const raw = (await api.get<any>("/api/auth/me", AXIOS_COOKIE_CFG)).data;

          return {
            id: String(raw?.id ?? ""),
            email: String(raw?.email ?? ""),
            role: (normRole(raw?.role) || "SHOPPER") as Role,
            firstName: raw?.firstName ?? null,
            lastName: raw?.lastName ?? null,
            displayName: raw?.displayName ?? null,
            phone: raw?.phone ?? null,
            joinedAt: raw?.joinedAt ?? raw?.createdAt ?? raw?.created_at ?? raw?.registeredAt ?? null,
            status: raw?.status ?? null,
            emailVerified: resolveEmailVerified(raw),
            emailVerifiedAt: resolveEmailVerifiedAt(raw),
            dob: raw?.dob ?? raw?.dateOfBirth ?? null,
            address: raw?.address ?? null,
            shippingAddress: raw?.shippingAddress ?? null,
            language: raw?.language ?? null,
            theme: raw?.theme ?? null,
            currency: raw?.currency ?? null,
            productInterests: Array.isArray(raw?.productInterests) ? raw.productInterests : undefined,
            notificationPrefs: raw?.notificationPrefs ?? null,
          };
        } catch (e: any) {
          if (isAuthError(e)) onAuthError?.();
          throw e;
        }
      }

      try {
        const urls = [`/api/admin/users/${encodeURIComponent(targetUserId)}`];

        return await firstSuccessful<MeResponse>(urls, (u: any) => ({
          id: String(u?.id ?? targetUserId),
          email: String(u?.email ?? ""),
          role: (normRole(u?.role) || "SHOPPER") as Role,
          firstName: u?.firstName ?? null,
          lastName: u?.lastName ?? null,
          displayName: u?.displayName ?? null,
          phone: u?.phone ?? null,
          joinedAt: u?.joinedAt ?? u?.createdAt ?? null,
          status: u?.status ?? null,
          emailVerified: resolveEmailVerified(u),
          emailVerifiedAt: resolveEmailVerifiedAt(u),
          dob: u?.dob ?? null,
          address: u?.address ?? null,
          shippingAddress: u?.shippingAddress ?? null,
          language: u?.language ?? null,
          theme: u?.theme ?? null,
          currency: u?.currency ?? null,
          productInterests: Array.isArray(u?.productInterests) ? u.productInterests : undefined,
          notificationPrefs: u?.notificationPrefs ?? null,
        }));
      } catch (e: any) {
        if (isAuthError(e)) onAuthError?.();
        throw e;
      }
    },
    staleTime: 30_000,
    retry: (count, e: any) => (isAuthError(e) || isNotFound(e) ? false : count < 1),
  });
}

function useRecentOrders(limit: number, targetUserId: string | null, onAuthError?: () => void) {
  return useQuery({
    queryKey: ["orders", "recent", limit, targetUserId || "self"],
    queryFn: async (): Promise<OrderLite[]> => {
      try {
        if (!targetUserId) {
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
        }

        const urls = [`/api/admin/users/${encodeURIComponent(targetUserId)}/orders?limit=${limit}`];

        return await firstSuccessful<OrderLite[]>(urls, (payload: any) => {
          const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
          return list.map((o: any) => ({
            id: String(o.id),
            createdAt: String(o.createdAt),
            status: String(o.status),
            total: Number(o.total ?? 0),
            items: (Array.isArray(o.items) ? o.items : []).map((it: any) => ({
              id: String(it.id ?? `${o.id}:${it.productId ?? it.id ?? "it"}`),
              productId: String(it.productId ?? it.product?.id ?? it.id ?? ""),
              title: String(it.title ?? it.product?.title ?? "—"),
              quantity: Number(it.quantity ?? it.qty ?? 1),
            })),
            trackingUrl: o.trackingUrl ?? null,
          }));
        });
      } catch (e: any) {
        if (isAuthError(e)) onAuthError?.();
        throw e;
      }
    },
    staleTime: 20_000,
    retry: (count, e: any) => (isAuthError(e) || isNotFound(e) ? false : count < 1),
  });
}

function useOrdersSummary(targetUserId: string | null, onAuthError?: () => void) {
  return useQuery({
    queryKey: ["orders", "summary", targetUserId || "self"],
    queryFn: async (): Promise<OrdersSummary> => {
      try {
        if (!targetUserId) {
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
        }

        const summaryUrls = [`/api/admin/users/${encodeURIComponent(targetUserId)}/orders/summary`];
        const listUrls = [`/api/admin/users/${encodeURIComponent(targetUserId)}/orders?limit=1000`];

        const list = await firstSuccessful<any[]>(listUrls, (payload: any) => {
          const arr = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
          return arr;
        });

        const byStatus: Record<string, number> = {};
        let derivedTotalSpent = 0;
        for (const o of list) {
          const s = String(o.status || "UNKNOWN").toUpperCase();
          byStatus[s] = (byStatus[s] || 0) + 1;
          if (s === "PAID" || s === "COMPLETED") derivedTotalSpent += Number(o.total ?? 0);
        }

        try {
          const summary = await firstSuccessful<any>(summaryUrls, (x) => x);
          const recent = Array.isArray(summary?.recent) ? summary.recent : [];
          return {
            ordersCount: Number(summary?.ordersCount ?? list.length),
            totalSpent: Number(summary?.totalSpent ?? derivedTotalSpent),
            recent: recent.map((o: any) => ({
              id: String(o.id),
              status: String(o.status),
              total: Number(o.total ?? 0),
              createdAt: String(o.createdAt),
            })),
            byStatus,
          };
        } catch {
          return {
            ordersCount: list.length,
            totalSpent: derivedTotalSpent,
            recent: list.slice(0, 5).map((o: any) => ({
              id: String(o.id),
              status: String(o.status),
              total: Number(o.total ?? 0),
              createdAt: String(o.createdAt),
            })),
            byStatus,
          };
        }
      } catch (e: any) {
        if (isAuthError(e)) onAuthError?.();
        return { ordersCount: 0, totalSpent: 0, recent: [], byStatus: {} };
      }
    },
    staleTime: 30_000,
    retry: (count, e: any) => (isAuthError(e) || isNotFound(e) ? false : count < 1),
  });
}

function useEmailVerificationStatus(email: string | null | undefined, onAuthError?: () => void) {
  return useQuery({
    queryKey: ["auth", "email-status", email || ""],
    enabled: !!email,
    queryFn: async () => {
      try {
        const res = await api.get("/api/auth/email-status", {
          params: { email },
        });

        const payload = unwrapData<any>(res.data);

        return {
          emailVerified: resolveEmailVerified(payload),
          emailVerifiedAt: resolveEmailVerifiedAt(payload),
          raw: payload,
        };
      } catch (e: any) {
        if (isAuthError(e)) onAuthError?.();
        throw e;
      }
    },
    staleTime: 10_000,
    retry: (count, e: any) => (isAuthError(e) || isNotFound(e) ? false : count < 1),
  });
}

function useRecentTransactions(limit: number, targetUserId: string | null, onAuthError?: () => void) {
  return useQuery({
    queryKey: ["payments", "recent-orders", limit, targetUserId || "self"],
    queryFn: async (): Promise<RecentTransaction[]> => {
      try {
        if (!targetUserId) {
          const res = await api.get<{ data: any[] }>(`/api/payments/recent?limit=${limit}`, AXIOS_COOKIE_CFG);
          const orders = Array.isArray(res.data?.data) ? res.data.data : [];

          return orders.map((o: any) => {
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
        }

        const urls = [`/api/admin/users/${encodeURIComponent(targetUserId)}/payments/recent?limit=${limit}`];

        return await firstSuccessful<RecentTransaction[]>(urls, (payload: any) => {
          const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
          return rows.map((o: any) => {
            const p = o.latestPayment || o.payment || o;
            const orderId = String(o.orderId ?? o.order?.id ?? o.order?.orderId ?? o.id ?? "");
            const createdAt = String(p?.paidAt || p?.createdAt || o.createdAt || new Date().toISOString());
            const total = Number(o.total ?? o.amount ?? p?.amount ?? 0);
            const orderStatus = String(o.orderStatus ?? o.status ?? p?.status ?? "PENDING");

            const payment =
              p && (p.id || p.reference || p.status)
                ? {
                  id: String(p.id ?? ""),
                  reference: p.reference ?? null,
                  status: String(p.status ?? orderStatus),
                  channel: p.channel ?? null,
                  provider: p.provider ?? null,
                  createdAt: String(p.createdAt || createdAt),
                }
                : undefined;

            return { orderId, createdAt, total, orderStatus, payment };
          });
        });
      } catch (e: any) {
        if (isAuthError(e)) onAuthError?.();
        throw e;
      }
    },
    staleTime: 20_000,
    retry: (count, e: any) => (isAuthError(e) || isNotFound(e) ? false : count < 1),
  });
}

function useTotalSpent(targetUserId: string | null, onAuthError?: () => void) {
  return useQuery({
    queryKey: ["payments", "totalSpent", targetUserId || "self"],
    queryFn: async () => {
      if (targetUserId) {
        try {
          const urls = [
            `/api/admin/users/${encodeURIComponent(targetUserId)}/payments/summary`,
            `/api/admin/users/${encodeURIComponent(targetUserId)}/orders/summary`,
          ];

          const summary = await firstSuccessful<any>(urls, (x) => x);
          const v = summary?.totalPaid ?? summary?.totalPaidNgn ?? summary?.totalSpent ?? summary?.paidTotal;
          if (typeof v === "number" && Number.isFinite(v)) return v;
        } catch (e: any) {
          if (isAuthError(e)) {
            onAuthError?.();
            return 0;
          }
        }

        try {
          const listUrls = [`/api/admin/users/${encodeURIComponent(targetUserId)}/orders?limit=1000`];
          const list = await firstSuccessful<any[]>(listUrls, (payload: any) => {
            const arr = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
            return arr;
          });
          return list
            .filter((o) => ["PAID", "COMPLETED"].includes(String(o.status || "").toUpperCase()))
            .reduce((s, o) => s + (Number(o.total ?? 0) || 0), 0);
        } catch (e: any) {
          if (isAuthError(e)) onAuthError?.();
          return 0;
        }
      }

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

      try {
        const s = await api.get<{ ordersCount: number; totalSpent: number }>("/api/orders/summary", AXIOS_COOKIE_CFG);
        if (typeof s.data?.totalSpent === "number") return s.data.totalSpent;
      } catch (e: any) {
        if (isAuthError(e)) {
          onAuthError?.();
          return 0;
        }
      }

      try {
        const res = await api.get<{ data: any[] }>("/api/orders/mine?limit=1000", AXIOS_COOKIE_CFG);
        const list = Array.isArray(res.data?.data) ? res.data.data : [];
        return list
          .filter((o) => ["PAID", "COMPLETED"].includes(String(o.status || "").toUpperCase()))
          .reduce((s, o) => s + (Number(o.total ?? 0) || 0), 0);
      } catch (e: any) {
        if (isAuthError(e)) onAuthError?.();
        return 0;
      }
    },
    staleTime: 30_000,
    retry: (count, e: any) => (isAuthError(e) || isNotFound(e) ? false : count < 1),
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
      className={`overflow-visible rounded-2xl border border-zinc-200/60 bg-white/70 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.08)] p-4 sm:p-5 lg:p-6 ${props.className || ""}`}
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500/15 to-cyan-500/15 text-fuchsia-600 sm:h-8 sm:w-8">
            {props.icon ?? <Sparkles size={16} />}
          </span>
          <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight sm:text-base">{props.title}</h2>
        </div>
        {props.right ? <div className="shrink-0 self-start sm:self-auto">{props.right}</div> : null}
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
    <motion.div whileHover={{ y: -2 }} className={`rounded-2xl border bg-white p-3 ring-1 shadow-sm sm:p-4 ${ring}`}>
      <div className="flex items-center gap-3">
        <span className={`inline-grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br sm:h-10 sm:w-10 ${iconBg}`}>
          {props.icon}
        </span>

        <div className="min-w-0">
          <div className="truncate text-[10px] uppercase tracking-wide text-zinc-500 sm:text-[11px]">{props.label}</div>
          <div className="mt-0.5 text-lg font-semibold sm:text-xl">{props.value}</div>
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
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] sm:text-xs ${tone}`}>
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

  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] sm:text-xs ${tone}`}>{s}</span>;
}

function prettyStatus(s?: string) {
  const v = String(s || "").trim();
  if (!v) return "UNKNOWN";
  return v.replace(/_/g, " ").replace(/\s+/g, " ").toUpperCase();
}

function OrderStatusChip({ status }: { status: string }) {
  const s = prettyStatus(status);
  const tone =
    s === "PAID" || s === "COMPLETED" || s === "DELIVERED"
      ? "bg-emerald-600/10 text-emerald-700 border-emerald-600/20"
      : s === "FAILED" || s === "CANCELLED"
        ? "bg-rose-500/10 text-rose-700 border-rose-600/20"
        : s === "SHIPPED" || s === "PROCESSING" || s === "AWAITING FULFILLMENT"
          ? "bg-cyan-500/10 text-cyan-700 border-cyan-600/20"
          : "bg-amber-500/10 text-amber-700 border-amber-600/20";

  return (
    <span className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-[11px] sm:text-xs ${tone}`} title={s}>
      <span className="truncate">{s}</span>
    </span>
  );
}

/* ---------------------- Page ---------------------- */
export default function UserDashboard(props: { adminUserId?: string } = {}) {
  const nav = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { openModal } = useModal();
  const params = useParams<{ userId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const redirectToLogin = () => {
    nav("/login", { replace: true, state: { from: location.pathname + location.search } });
  };

  const viewerMeQ = useViewerMe(redirectToLogin);
  const viewer = viewerMeQ.data;

  const viewerRole = normRole(viewer?.role);
  const viewerIsAdmin = viewerRole === "ADMIN" || viewerRole === "SUPER_ADMIN";
  const isSuperAdmin = viewerRole === "SUPER_ADMIN";

  const asParam = searchParams.get("as");
  const requestedTargetId = props.adminUserId || params.userId || asParam || null;
  const targetUserId = viewerIsAdmin ? requestedTargetId : null;
  const isViewingOtherUser = Boolean(targetUserId && viewer?.id && targetUserId !== viewer.id);

  const meQ = useTargetMe(targetUserId, redirectToLogin);
  const ordersQ = useRecentOrders(5, targetUserId, redirectToLogin);
  const ordersSummaryQ = useOrdersSummary(targetUserId, redirectToLogin);
  const transactionsQ = useRecentTransactions(5, targetUserId, redirectToLogin);
  const totalSpentQ = useTotalSpent(targetUserId, redirectToLogin);

  const resendEmail = useResendEmail(redirectToLogin);

  const [rebuyingId, setRebuyingId] = useState<string | null>(null);

  const [impQ, setImpQ] = useState("");
  const adminSearchQ = useAdminUserSearch(impQ, viewerIsAdmin, redirectToLogin);

  const exitImpersonation = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("as");
    setSearchParams(next, { replace: true });
    qc.invalidateQueries({ queryKey: ["me", "target"] }).catch(() => null);
    qc.invalidateQueries({ queryKey: ["orders"] }).catch(() => null);
    qc.invalidateQueries({ queryKey: ["payments"] }).catch(() => null);
  };

  const startImpersonation = (userId: string) => {
    const id = String(userId || "").trim();
    if (!id) return;

    const next = new URLSearchParams(searchParams);
    next.set("as", id);
    setSearchParams(next, { replace: true });

    qc.invalidateQueries({ queryKey: ["me", "target"] }).catch(() => null);
    qc.invalidateQueries({ queryKey: ["orders"] }).catch(() => null);
    qc.invalidateQueries({ queryKey: ["payments"] }).catch(() => null);
  };

  async function buyAgain(orderId: string) {
    if (isViewingOtherUser) {
      openModal({
        title: "Not available in Admin view",
        message: "Buy-again is a shopper action. Switch back to your account to use it.",
      });
      return;
    }

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

  const me = meQ.data;
  const initials = initialsFrom(me?.firstName, me?.lastName, me?.email);

  const emailStatusQ = useEmailVerificationStatus(me?.email, redirectToLogin);

  const isEmailVerified =
    resolveEmailVerified(emailStatusQ.data) ||
    resolveEmailVerified(me);

  const greetingName =
    me?.firstName?.trim() ||
    me?.displayName?.trim() ||
    me?.email?.split?.("@")?.[0] ||
    "there";

  const displayPhone = me?.shippingAddress?.phone || me?.phone || "—";

  const statusOrder = ["PENDING", "PROCESSING", "PAID", "SHIPPED", "DELIVERED", "FAILED", "CANCELLED"];
  const byStatusEntries = useMemo(() => {
    const map = ordersSummaryQ.data?.byStatus || {};
    const known = statusOrder.filter((k) => map[k] > 0).map((k) => [k, map[k]] as const);
    const unknown = Object.entries(map)
      .filter(([k]) => !statusOrder.includes(k))
      .sort((a, b) => a[0].localeCompare(b[0])) as Array<[string, number]>;
    return [...known, ...unknown];
  }, [ordersSummaryQ.data]);

  const Shimmer = () => (
    <div className="h-3 w-full animate-pulse rounded bg-gradient-to-r from-zinc-200 via-zinc-100 to-zinc-200" />
  );

  const statsGridClass =
    "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))] sm:[grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]";

  const viewerBadge = viewerIsAdmin ? (
    <span className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-[12px]">
      <ShieldCheck size={14} className="text-fuchsia-700" />
      <span className="font-semibold">{isSuperAdmin ? "SuperAdmin" : "Admin"}</span>
    </span>
  ) : null;

  return (
    <SiteLayout>
      <div className="mx-auto max-w-screen-2xl text-[13px] sm:text-[14px]">
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(closest-side,rgba(255,0,167,0.08),transparent_70%),radial-gradient(closest-side,rgba(0,204,255,0.10),transparent_70%)]" />
          <div className="relative px-4 pb-3 pt-5 sm:pb-4 sm:pt-7 md:px-8">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <motion.h1
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl md:text-3xl"
                >
                  {me ? `Hey ${greetingName}!` : "Welcome!"}{" "}
                  <span className="inline-block align-middle">
                    <Sparkles className="inline text-fuchsia-600" size={20} />
                  </span>
                </motion.h1>

                <p className="text-[12px] leading-5 text-zinc-600 sm:text-sm sm:leading-6">
                  Your vibe, your orders, your payments—everything in one electric dashboard ⚡
                </p>

                {viewerBadge ? <div className="mt-2">{viewerBadge}</div> : null}

                {isViewingOtherUser && (
                  <div className="mt-3 inline-flex w-full flex-wrap items-center gap-2 rounded-2xl border bg-white/70 px-3 py-2 text-[12px] sm:text-sm">
                    <span className="inline-flex items-center gap-2">
                      <Eye size={16} className="text-cyan-700" />
                      <b className="font-semibold">Admin view:</b>
                      <span className="font-mono">{targetUserId}</span>
                    </span>

                    <span className="inline-flex items-center gap-2 rounded-full border bg-white px-2.5 py-0.5">
                      <Lock size={14} className="text-zinc-600" />
                      <span className="text-zinc-700">Read-only</span>
                    </span>

                    <span className="text-zinc-600">•</span>
                    <span className="truncate text-zinc-700">{me?.email || "—"}</span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-zinc-700">{normRole(me?.role) || "SHOPPER"}</span>

                    <span className="ml-auto inline-flex gap-2">
                      <button
                        className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1 hover:bg-zinc-50"
                        onClick={() => nav("/admin")}
                        title="Back to Admin"
                      >
                        Admin <ExternalLink size={14} />
                      </button>

                      <button
                        className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1 hover:bg-zinc-50"
                        onClick={exitImpersonation}
                        title="Exit view-as mode"
                      >
                        Exit view <X size={14} />
                      </button>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid items-start gap-6 px-4 pb-12 md:px-8 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-8">
          <div className="min-w-0 space-y-6 lg:sticky lg:top-6 lg:self-start lg:space-y-7">
            {viewerIsAdmin && (
              <GlassCard
                title="View as user"
                icon={<Users size={16} />}
                right={
                  isViewingOtherUser ? (
                    <button
                      className="inline-flex items-center gap-1 text-[12px] text-zinc-700 hover:underline sm:text-sm"
                      onClick={exitImpersonation}
                      title="Exit impersonation"
                    >
                      Exit <X size={14} />
                    </button>
                  ) : (
                    <span className="text-[12px] text-zinc-500 sm:text-sm">Read-only</span>
                  )
                }
              >
                <div className="text-[12px] text-zinc-600 sm:text-sm">
                  Search a user and open their dashboard in <b>read-only</b> mode.
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      value={impQ}
                      onChange={(e) => setImpQ(e.target.value)}
                      placeholder="Search by email / name / id…"
                      className="w-full rounded-full border bg-white py-2 pl-9 pr-10 text-[12px] outline-none focus:ring-2 focus:ring-fuchsia-200 sm:text-sm"
                    />
                    {impQ.trim().length > 0 && (
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full hover:bg-zinc-100"
                        onClick={() => setImpQ("")}
                        title="Clear"
                      >
                        <X size={14} className="text-zinc-600" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className="rounded-full border bg-white px-4 py-2 text-[12px] font-semibold hover:bg-zinc-50 sm:text-sm"
                    onClick={() => {
                      const raw = impQ.trim();
                      if (!raw) return;

                      const list = adminSearchQ.data || [];
                      const exact =
                        list.find((u) => String(u.id).toLowerCase() === raw.toLowerCase()) ||
                        list.find((u) => String(u.email).toLowerCase() === raw.toLowerCase());

                      if (exact?.id) return startImpersonation(exact.id);
                      if (!raw.includes("@") && raw.length >= 8) return startImpersonation(raw);

                      openModal({
                        title: "Select a user",
                        message: "Pick a user from the results list (email search must resolve to a user id).",
                      });
                    }}
                    title="Open"
                  >
                    Open
                  </button>
                </div>

                <div className="mt-3">
                  {adminSearchQ.isFetching && (
                    <div className="inline-flex items-center gap-2 text-[12px] text-zinc-600 sm:text-sm">
                      <RefreshCcw size={14} className="animate-spin" />
                      Searching…
                    </div>
                  )}

                  {!adminSearchQ.isFetching && (adminSearchQ.data?.length || 0) === 0 && impQ.trim().length >= 2 && (
                    <div className="inline-flex items-center gap-2 text-[12px] text-zinc-600 sm:text-sm">
                      <Info size={14} />
                      No users found.
                    </div>
                  )}

                  {(adminSearchQ.data?.length || 0) > 0 && (
                    <div className="mt-2 grid gap-2">
                      {adminSearchQ.data!.map((u) => {
                        const who = (u.displayName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email).trim();
                        const role = normRole(u.role) || "SHOPPER";
                        const active = isViewingOtherUser && targetUserId === u.id;

                        return (
                          <button
                            key={u.id}
                            type="button"
                            className={`w-full rounded-2xl border bg-white px-3 py-2 text-left transition hover:bg-zinc-50 ${active ? "border-cyan-200 ring-2 ring-cyan-200" : "border-zinc-200"}`}
                            onClick={() => startImpersonation(u.id)}
                            title="View dashboard (read-only)"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-[12px] font-semibold text-zinc-900 sm:text-sm">{who}</div>
                                <div className="truncate text-[11px] text-zinc-600 sm:text-xs">{u.email}</div>
                                <div className="mt-1 truncate font-mono text-[10px] text-zinc-500 sm:text-[11px]">{u.id}</div>
                              </div>

                              <div className="shrink-0 text-right">
                                <div className="inline-flex items-center gap-2 rounded-full border bg-white px-2 py-0.5 text-[11px] sm:text-xs">
                                  <Lock size={12} className="text-zinc-600" />
                                  <span className="text-zinc-700">{role}</span>
                                </div>
                                {u.status ? <div className="mt-1 text-[10px] text-zinc-500 sm:text-[11px]">{String(u.status)}</div> : null}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="mt-3 text-[11px] text-zinc-500 sm:text-xs">
                  Tip: use <span className="font-mono">?as=&lt;userId&gt;</span> to deep-link view-as mode.
                </div>
              </GlassCard>
            )}

            <GlassCard
              title="Profile"
              icon={<ShoppingBag size={16} />}
              right={
                !isViewingOtherUser ? (
                  <button
                    className="text-[12px] text-fuchsia-600 hover:underline sm:text-sm"
                    onClick={() => nav("/profile")}
                    aria-label="Edit profile"
                  >
                    Edit
                  </button>
                ) : (
                  <span className="text-[12px] text-zinc-500 sm:text-sm">View-only</span>
                )
              }
            >
              <div className="flex items-start gap-3 sm:gap-4">
                {me ? (
                  <motion.div whileHover={{ rotate: -2 }}>
                    <div className="grid h-12 w-12 place-items-center rounded-2xl border bg-gradient-to-br from-zinc-900 to-zinc-700 text-sm font-semibold text-white shadow sm:h-14 sm:w-14 sm:text-base">
                      {initials}
                    </div>
                  </motion.div>
                ) : (
                  <div className="h-12 w-12 animate-pulse rounded-2xl bg-zinc-200 sm:h-14 sm:w-14" />
                )}

                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold sm:text-base">
                    {me ? `${me.firstName ?? ""} ${me?.lastName ?? ""}`.trim() || me.email : <Shimmer />}
                  </div>

                  <div className="truncate text-[12px] text-zinc-600 sm:text-sm">
                    {me?.email || (meQ.isLoading ? <Shimmer /> : "—")}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-600 sm:text-xs">
                    <Clock3 size={13} className="text-cyan-600" />
                    <span className="truncate">Joined {dateFmt(me?.joinedAt)}</span>
                    {me ? (
                      isEmailVerified ? (
                        <span className="inline-flex items-center gap-1 rounded-full border bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 sm:text-xs">
                          <CheckCircle2 size={13} /> Email verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 sm:text-xs">
                          <AlertCircle size={13} /> Email pending
                        </span>
                      )
                    ) : null}
                  </div>
                </div>
              </div>

              {isViewingOtherUser && isSuperAdmin && (
                <div className="mt-4 rounded-2xl border bg-white p-3 text-[12px] sm:text-sm">
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500 sm:text-[11px]">SuperAdmin view</div>
                  <div className="grid grid-cols-1 gap-1.5 text-zinc-700">
                    <div>
                      <span className="text-zinc-500">Phone:</span> <span className="font-mono">{displayPhone}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">DOB:</span> <span className="font-mono">{me?.dob || "—"}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Address:</span>{" "}
                      <span className="font-mono">
                        {me?.address
                          ? `${me.address.houseNumber ?? ""} ${me.address.streetName ?? ""}, ${me.address.city ?? ""} ${me.address.state ?? ""} ${me.address.postCode ?? ""} ${me.address.country ?? ""}`
                            .replace(/\s+/g, " ")
                            .trim() || "—"
                          : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Shipping:</span>{" "}
                      <span className="font-mono">
                        {me?.shippingAddress
                          ? `${me.shippingAddress.houseNumber ?? ""} ${me.shippingAddress.streetName ?? ""}, ${me.shippingAddress.city ?? ""} ${me.shippingAddress.state ?? ""} ${me.shippingAddress.postCode ?? ""} ${me.shippingAddress.country ?? ""}`
                            .replace(/\s+/g, " ")
                            .trim() || "—"
                          : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 text-[11px] text-zinc-500 sm:text-xs">
                    Reminder: “view as” must be enforced server-side with role checks + audit logging.
                  </div>
                </div>
              )}

              <div className="mt-4 grid grid-cols-2 gap-3 text-[12px] sm:text-sm">
                {!isViewingOtherUser ? (
                  <>
                    <Link className="group inline-flex items-center gap-1.5 text-cyan-700 hover:underline" to="/profile">
                      Manage <ChevronRight className="transition group-hover:translate-x-0.5" size={14} />
                    </Link>
                    <Link
                      className="group justify-self-end inline-flex items-center gap-1.5 text-cyan-700 hover:underline"
                      to="/orders"
                    >
                      Orders <ChevronRight className="transition group-hover:translate-x-0.5" size={14} />
                    </Link>
                  </>
                ) : (
                  <>
                    <span className="text-zinc-500">View-only</span>
                    <span className="justify-self-end text-zinc-500">—</span>
                  </>
                )}
              </div>
            </GlassCard>

            {!isViewingOtherUser && (
              <GlassCard title="Verification" icon={<ShieldCheck size={16} />}>
                <div className="space-y-3 text-[12px] sm:text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <MailCheck size={15} className="text-emerald-600" />
                      <span className="truncate">Email {isEmailVerified ? "verified" : "pending"}</span>                    </span>

                    {!isEmailVerified && (
                      <motion.button
                        whileHover={{ y: -1 }}
                        className="rounded-full border bg-white px-3 py-1 text-[12px] transition hover:bg-zinc-50 sm:text-sm"
                        disabled={resendEmail.isPending}
                        onClick={async () => {
                          try {
                            await resendEmail.mutateAsync();
                            qc.invalidateQueries({ queryKey: ["me"] });
                            qc.invalidateQueries({ queryKey: ["me", "target"] });
                            qc.invalidateQueries({ queryKey: ["auth", "email-status"] });
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
                </div>
              </GlassCard>
            )}

            <GlassCard title="Security & Privacy" icon={<ShieldCheck size={16} />}>
              <div className="grid gap-2 text-[12px] sm:text-sm">
                {!isViewingOtherUser ? (
                  <>
                    <Link to="/forgot-password" className="group inline-flex items-center gap-1.5 text-fuchsia-700 hover:underline">
                      Change password <ChevronRight className="transition group-hover:translate-x-0.5" size={14} />
                    </Link>
                    <Link to="/account/sessions" className="group inline-flex items-center gap-1.5 text-fuchsia-700 hover:underline">
                      Sessions & devices <ChevronRight className="transition group-hover:translate-x-0.5" size={14} />
                    </Link>
                  </>
                ) : (
                  <div className="text-[12px] text-zinc-600 sm:text-sm">
                    View-only mode (admin). Security controls are not shown here.
                  </div>
                )}
                <Link to="/privacy" className="group inline-flex items-center gap-1.5 text-fuchsia-700 hover:underline">
                  Data & privacy <ChevronRight className="transition group-hover:translate-x-0.5" size={14} />
                </Link>
              </div>
            </GlassCard>

            {!isViewingOtherUser && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border bg-white px-4 py-2 text-[12px] transition hover:bg-zinc-50 sm:text-sm"
                onClick={async () => {
                  try {
                    await performLogout("/login", nav);
                  } catch {
                    qc.clear();
                    nav("/login");
                  }
                }}
              >
                <LogOut size={15} /> Logout
              </motion.button>
            )}
          </div>

          <div className="min-w-0 space-y-5 sm:space-y-6">
            <GlassCard
              title="Your orders at a glance"
              icon={<ShoppingBag size={16} />}
              right={
                !isViewingOtherUser ? (
                  <Link className="inline-flex items-center gap-1 text-[12px] text-fuchsia-700 hover:underline sm:text-sm" to="/orders">
                    View all <ChevronRight size={14} />
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-2 text-[12px] text-zinc-500 sm:text-sm">
                    <Lock size={14} /> Read-only
                  </span>
                )
              }
            >
              {ordersSummaryQ.isLoading ? (
                <div className={statsGridClass}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="rounded-2xl border bg-white p-3 sm:p-4">
                      <Shimmer />
                      <div className="mt-2">
                        <Shimmer />
                      </div>
                    </div>
                  ))}
                </div>
              ) : ordersSummaryQ.isError ? (
                <div className="inline-flex items-center gap-2 text-[12px] text-rose-600 sm:text-sm">
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

            <GlassCard
              title="Recent orders"
              icon={<Truck size={16} />}
              right={
                !isViewingOtherUser ? (
                  <Link className="inline-flex items-center gap-1 text-[12px] text-fuchsia-700 hover:underline sm:text-sm" to="/orders">
                    View all <ChevronRight size={14} />
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-2 text-[12px] text-zinc-500 sm:text-sm">
                    <Lock size={14} /> Read-only
                  </span>
                )
              }
            >
              {ordersQ.isLoading ? (
                <div className="grid gap-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="grid gap-2 rounded-2xl border bg-white p-3 sm:p-4">
                      <Shimmer />
                      <Shimmer />
                    </div>
                  ))}
                </div>
              ) : ordersQ.isError ? (
                <div className="inline-flex items-center gap-2 text-[12px] text-rose-600 sm:text-sm">
                  <Info size={16} /> Couldn’t load orders.
                </div>
              ) : ordersQ.data && ordersQ.data.length > 0 ? (
                <div className="grid gap-3">
                  {ordersQ.data.map((o) => (
                    <motion.div key={o.id} whileHover={{ scale: 1.005 }} className="rounded-2xl border bg-white p-3 sm:p-4">
                      <div className="grid gap-3 md:grid-cols-[140px_minmax(0,1fr)_240px] md:items-center md:gap-4">
                        <div className="flex min-w-0 items-center justify-between md:block md:justify-start">
                          <div className="text-[11px] text-zinc-500 sm:text-xs">{dateFmt(o.createdAt)}</div>
                          <div className="min-w-0 md:mt-2">
                            <OrderStatusChip status={o.status} />
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-zinc-900 sm:text-sm">{ngn.format(o.total)}</div>
                          <div className="mt-1 truncate text-[12px] text-zinc-600 sm:text-sm">
                            {o.items.length === 0
                              ? "No items"
                              : o.items.length === 1
                                ? o.items[0].title
                                : `${o.items[0].title} + ${o.items.length - 1} more`}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 md:justify-end">
                          {!isViewingOtherUser ? (
                            <Link to={`/orders?open=${o.id}`} className="text-[12px] text-fuchsia-700 hover:underline sm:text-sm">
                              Details
                            </Link>
                          ) : (
                            <span className="text-[12px] text-zinc-500 sm:text-sm">—</span>
                          )}

                          <motion.button
                            whileHover={{ y: -1 }}
                            className="rounded-full border bg-white px-3 py-1.5 text-[12px] transition hover:bg-zinc-50 disabled:opacity-50 sm:text-sm"
                            onClick={() => buyAgain(o.id)}
                            disabled={rebuyingId === o.id || isViewingOtherUser}
                            title={isViewingOtherUser ? "Disabled in admin view" : "Re-add all items from this order to your cart"}
                          >
                            {rebuyingId === o.id ? "Adding…" : "Buy again"}
                          </motion.button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-zinc-600 sm:text-sm">No recent orders yet.</div>
              )}
            </GlassCard>

            <GlassCard title="Recent transactions" icon={<CreditCard size={16} />}>
              {transactionsQ.isLoading ? (
                <div className="grid gap-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="grid gap-2 rounded-2xl border bg-white p-3 sm:p-4">
                      <Shimmer />
                      <Shimmer />
                    </div>
                  ))}
                </div>
              ) : transactionsQ.isError ? (
                <div className="inline-flex items-center gap-2 text-[12px] text-rose-600 sm:text-sm">
                  <Info size={16} /> Couldn’t load transactions.
                </div>
              ) : transactionsQ.data && transactionsQ.data.length > 0 ? (
                <div className="grid gap-3">
                  {transactionsQ.data.map((t) => (
                    <motion.div
                      key={`${t.orderId}:${t.createdAt}`}
                      whileHover={{ scale: 1.005 }}
                      className="flex flex-col gap-3 rounded-2xl border bg-white p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4"
                    >
                      <div className="flex items-center justify-between text-[11px] sm:block sm:w-44 sm:text-xs">
                        <div className="text-zinc-500">{dateTimeFmt(t.createdAt)}</div>
                        <div className="font-medium sm:mt-1">{t.orderStatus}</div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold sm:text-sm">{ngn.format(t.total)}</div>
                        <div className="mt-1 break-words text-[11px] text-zinc-600 sm:text-xs">
                          {t.payment ? (
                            <>
                              <PaymentBadgeInline status={t.payment.status} /> {t.payment.provider || "—"} • {t.payment.channel || "—"} • Ref:{" "}
                              <span className="font-mono">{t.payment.reference || "—"}</span>
                            </>
                          ) : (
                            "No payment attempts yet"
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 sm:ml-auto sm:justify-end">
                        {!isViewingOtherUser ? (
                          <Link to={`/orders?open=${t.orderId}`} className="text-[12px] text-fuchsia-700 hover:underline sm:text-sm">
                            Details
                          </Link>
                        ) : (
                          <span className="text-[12px] text-zinc-500 sm:text-sm">—</span>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-zinc-600 sm:text-sm">No recent transactions.</div>
              )}
            </GlassCard>

            <GlassCard title="Your insights" icon={<Sparkles size={16} />}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                  value={
                    me?.joinedAt || (me as any)?.createdAt
                      ? sinceJoined(me?.joinedAt || (me as any)?.createdAt) + " ago"
                      : meQ.isLoading
                        ? "…"
                        : "—"
                  }
                  icon={<Clock3 size={16} />}
                  accent="violet"
                />
              </div>

              {(me?.joinedAt || (me as any)?.createdAt) && (
                <p className="mt-1 text-[11px] text-zinc-500 sm:text-xs">
                  Joined {dateFmt(me?.joinedAt || (me as any)?.createdAt)}
                </p>
              )}

              {isViewingOtherUser ? (
                <p className="mt-3 text-[11px] text-zinc-600 sm:text-xs">
                  Admin view is <b>read-only</b>. Any shopper actions are disabled by design.
                </p>
              ) : (
                <p className="mt-3 text-[11px] text-zinc-600 sm:text-xs">
                  Tip: Turn on personalised recommendations in Preferences to see smarter picks here.
                </p>
              )}
            </GlassCard>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}