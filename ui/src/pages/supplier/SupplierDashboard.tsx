// src/pages/supplier/SupplierDashboard.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Box,
  CircleDollarSign,
  Package,
  ShoppingBag,
  Sparkles,
  Truck,
  Settings,
  Undo2,
  Tags,
  ChevronDown,
  X,
  Search,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import { useQuery } from "@tanstack/react-query";

import api from "../../api/client";
import { useAuthStore } from "../../store/auth";

const ADMIN_SUPPLIER_KEY = "adminSupplierId";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border bg-white/90 backdrop-blur shadow-sm overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border bg-white/80 p-4 flex items-start gap-3">
      <div className="mt-0.5 text-zinc-700">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-zinc-500">{label}</div>
        <div className="text-lg font-semibold text-zinc-900">{value}</div>
        {hint && <div className="text-[11px] text-zinc-500 mt-1">{hint}</div>}
      </div>
    </div>
  );
}

type SupplierLite = {
  id: string;
  name?: string | null;
  businessName?: string | null;
  email?: string | null;
  status?: string | null;
};

function normStr(v: any) {
  return String(v ?? "").trim();
}

export default function SupplierDashboard() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s: any) => s.user?.role);
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const isRider = role === "SUPPLIER_RIDER";

  const [searchParams, setSearchParams] = useSearchParams();

  // ---- resolve current supplierId (admin context) ----
  const urlSupplierId = useMemo(() => {
    const v = normStr(searchParams.get("supplierId"));
    return v || undefined;
  }, [searchParams]);

  const storedSupplierId = useMemo(() => {
    const v = normStr(localStorage.getItem(ADMIN_SUPPLIER_KEY));
    return v || undefined;
  }, []);

  const adminSupplierId = isAdmin ? (urlSupplierId ?? storedSupplierId) : undefined;

  // If admin has stored supplier but URL missing, inject it
  useEffect(() => {
    if (!isAdmin) return;

    const fromUrl = normStr(searchParams.get("supplierId"));
    const fromStore = normStr(localStorage.getItem(ADMIN_SUPPLIER_KEY));

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
    if (to.includes("supplierId=")) return to;
    const sep = to.includes("?") ? "&" : "?";
    return `${to}${sep}supplierId=${encodeURIComponent(adminSupplierId)}`;
  };

  // --------------------------
  // Admin supplier selector UI
  // --------------------------
  const [pickerOpen, setPickerOpen] = useState(false);
  const [supplierQ, setSupplierQ] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!pickerOpen) return;
      const el = pickerRef.current;
      if (!el) return;
      if (!el.contains(e.target as any)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [pickerOpen]);

  // Pull suppliers for admin (server-search + client filter)
  const suppliersQ = useQuery({
    queryKey: ["admin", "suppliers", { q: supplierQ }],
    enabled: !!token && isAdmin && pickerOpen, // only fetch when open
    queryFn: async () => {
      // ✅ CHANGE THIS URL if yours differs
      const { data } = await api.get<{ data: SupplierLite[] }>("/api/admin/suppliers", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        params: { q: supplierQ.trim() || undefined, take: 50, skip: 0 },
      });
      return Array.isArray((data as any)?.data) ? (data as any).data : (data as any);
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const suppliers = suppliersQ.data ?? [];

  // Make typing immediately responsive even if backend ignores q:
  const filteredSuppliers = useMemo(() => {
    const needle = supplierQ.trim().toLowerCase();
    if (!needle) return suppliers;
    return suppliers.filter((s: { id: any; name: any; businessName: any; email: any; status: any }) => {
      const hay = [s.id, s.name, s.businessName, s.email, s.status]
        .map((x) => String(x ?? "").toLowerCase())
        .join(" ");
      return hay.includes(needle);
    });
  }, [suppliers, supplierQ]);

  // Fetch selected supplier label (so we can show name even if dropdown not open)
  const selectedSupplierQ = useQuery({
    queryKey: ["admin", "supplier", adminSupplierId],
    enabled: !!token && isAdmin && !!adminSupplierId,
    queryFn: async () => {
      // ✅ CHANGE THIS URL if yours differs
      const { data } = await api.get("/api/admin/suppliers/" + encodeURIComponent(String(adminSupplierId)), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      return (data as any)?.data ?? data;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const selectedSupplierLabel = useMemo(() => {
    if (!isAdmin) return null;
    const s = selectedSupplierQ.data as SupplierLite | null;
    if (!adminSupplierId) return "Select supplier…";
    if (!s) return `Supplier: ${adminSupplierId.slice(0, 8)}…`;
    const name = s.businessName || s.name || s.email || adminSupplierId;
    const extra = s.email && (s.businessName || s.name) ? ` • ${s.email}` : "";
    return `${name}${extra}`;
  }, [isAdmin, adminSupplierId, selectedSupplierQ.data]);

  function selectSupplier(id: string) {
    const nextId = normStr(id);
    if (!nextId) return;

    // persist
    localStorage.setItem(ADMIN_SUPPLIER_KEY, nextId);

    // update URL (replace so history doesn't spam)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("supplierId", nextId);
        return next;
      },
      { replace: true }
    );

    setPickerOpen(false);
  }

  function clearSupplierSelection() {
    localStorage.removeItem(ADMIN_SUPPLIER_KEY);

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("supplierId");
        return next;
      },
      { replace: true }
    );

    setSupplierQ("");
    setPickerOpen(false);
  }

  // --------------------------
  // Dashboard data (supplier endpoints support supplierId query for admin)
  // --------------------------
  const summaryQ = useQuery({
    queryKey: ["supplier", "dashboard", "summary", { supplierId: adminSupplierId }],
    enabled: !!token && (!isAdmin || !!adminSupplierId),
    queryFn: async () => {
      const { data } = await api.get("/api/supplier/dashboard/summary", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        params: { supplierId: adminSupplierId },
      });
      return (data as any)?.data ?? data;
    },
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const insightsQ = useQuery({
    queryKey: ["supplier", "dashboard", "insights", { supplierId: adminSupplierId }],
    enabled: !!token && (!isAdmin || !!adminSupplierId),
    queryFn: async () => {
      const { data } = await api.get("/api/supplier/dashboard/insights", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        params: { supplierId: adminSupplierId },
      });
      return (data as any)?.data ?? data;
    },
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const insights = insightsQ.data ?? null;

  const kpis = summaryQ.data ?? {
    liveProducts: 0,
    lowStock: 0,
    pendingOrders: 0,
    shippedToday: 0,
    balance: 0,
    paidOutTotal: 0,
    rating: 0,
    currency: "NGN",
  };

  const ngn = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  });

  return (
    <SiteLayout>
      <SupplierLayout>
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl mt-6 border">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700" />
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(closest-side,rgba(255,0,167,0.25),transparent_60%),radial-gradient(closest-side,rgba(0,204,255,0.25),transparent_60%)]" />
          <div className="relative px-5 md:px-8 py-8 text-white">
            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-2xl md:text-3xl font-bold tracking-tight"
            >
              Supplier Overview <Sparkles className="inline ml-1" size={22} />
            </motion.h1>

            <p className="mt-1 text-sm text-white/80">
              Track sales, manage products, and fulfill orders from one place.
            </p>

            {/* ✅ Admin supplier selector (hidden for riders) */}
            {isAdmin && !isRider && (
              <div className="mt-4" ref={pickerRef}>
                <div className="text-[11px] text-white/80 mb-1">Admin view</div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPickerOpen((v) => !v)}
                    className="inline-flex items-center gap-2 rounded-full bg-white text-zinc-900 px-4 py-2 text-sm font-semibold hover:opacity-95"
                    title="Choose supplier"
                  >
                    <span className="max-w-[260px] sm:max-w-[380px] truncate">
                      {selectedSupplierLabel ?? "Select supplier…"}
                    </span>
                    <ChevronDown size={16} />
                  </button>

                  {!!adminSupplierId && (
                    <button
                      type="button"
                      onClick={clearSupplierSelection}
                      className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
                      title="Clear supplier selection"
                    >
                      <X size={16} /> Clear
                    </button>
                  )}
                </div>

                {pickerOpen && (
                  <div className="mt-2 w-full max-w-xl rounded-2xl border border-white/20 bg-white/95 text-zinc-900 shadow-lg overflow-hidden">
                    <div className="p-3 border-b bg-white/80">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                        <input
                          value={supplierQ}
                          onChange={(e) => setSupplierQ(e.target.value)}
                          placeholder="Search suppliers by name, email, id…"
                          className="w-full rounded-xl border bg-white pl-9 pr-3 py-2 text-sm outline-none focus:ring-4 focus:ring-fuchsia-100 focus:border-fuchsia-400 transition"
                          autoFocus
                        />
                      </div>

                      {suppliersQ.isFetching && <div className="mt-2 text-[11px] text-zinc-500">Searching…</div>}
                      {suppliersQ.isError && (
                        <div className="mt-2 text-[11px] text-rose-700">
                          Failed to load suppliers. Check your admin suppliers endpoint.
                        </div>
                      )}
                    </div>

                    <div className="max-h-[320px] overflow-auto">
                      {filteredSuppliers.length === 0 && !suppliersQ.isFetching ? (
                        <div className="p-4 text-sm text-zinc-600">No suppliers found.</div>
                      ) : (
                        filteredSuppliers.map((s: any) => {
                          const name = s.businessName || s.name || "Unnamed supplier";
                          const email = s.email ? String(s.email) : "";
                          const active = adminSupplierId === s.id;

                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => selectSupplier(s.id)}
                              className={`w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-black/5 transition ${
                                active ? "bg-emerald-50" : "bg-white"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-zinc-900 truncate">{name}</div>
                                  <div className="text-[11px] text-zinc-600 truncate">
                                    {email ? `${email} • ` : ""}
                                    {s.id}
                                  </div>
                                </div>
                                {active && (
                                  <span className="text-[11px] px-2 py-1 rounded-full border bg-white text-emerald-700 border-emerald-200">
                                    Selected
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ✅ Header quick-links (HIDDEN for riders) */}
            {!isRider ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to={withSupplierCtx("/supplier/products")}
                  className="inline-flex items-center gap-2 rounded-full bg-white text-zinc-900 px-4 py-2 text-sm font-semibold hover:opacity-95"
                >
                  Manage products <ArrowRight size={16} />
                </Link>

                <Link
                  to={withSupplierCtx("/supplier/orders")}
                  className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
                >
                  View orders <ArrowRight size={16} />
                </Link>

                <Link
                  to={withSupplierCtx("/supplier/catalog-requests")}
                  className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
                >
                  Catalog requests <Tags size={16} />
                </Link>

                <Link
                  to={withSupplierCtx("/supplier/refunds")}
                  className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
                >
                  Refunds <Undo2 size={16} />
                </Link>

                <Link
                  to={withSupplierCtx("/supplier/settings")}
                  className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
                >
                  Settings <Settings size={16} />
                </Link>
              </div>
            ) : (
              <div className="mt-4">
                <Link
                  to={withSupplierCtx("/supplier/orders")}
                  className="inline-flex items-center gap-2 rounded-full bg-white text-zinc-900 px-4 py-2 text-sm font-semibold hover:opacity-95"
                >
                  Go to orders <ArrowRight size={16} />
                </Link>
                <div className="mt-3 text-xs text-white/80">
                  Riders can only view and deliver assigned orders.
                </div>
              </div>
            )}

            {/* small loading/error line */}
            {isAdmin && !adminSupplierId ? (
              <div className="mt-3 text-xs text-amber-200">Select a supplier above to load dashboard KPIs.</div>
            ) : summaryQ.isFetching ? (
              <div className="mt-3 text-xs text-white/80">Loading dashboard…</div>
            ) : summaryQ.isError ? (
              <div className="mt-3 text-xs text-white/90">
                Failed to load dashboard.{" "}
                <button className="underline" onClick={() => summaryQ.refetch()}>
                  Retry
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* KPI Grid (keep visible; it’s read-only info) */}
        <div className="mt-6 grid gap-3 md:gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <Stat label="Live products" value={`${kpis.liveProducts}`} icon={<Package size={18} />} />
          <Stat label="Low stock" value={`${kpis.lowStock}`} icon={<Box size={18} />} hint="Restock soon" />
          <Stat label="Pending orders" value={`${kpis.pendingOrders}`} icon={<ShoppingBag size={18} />} />
          <Stat label="Shipped today" value={`${kpis.shippedToday}`} icon={<Truck size={18} />} />
          <Stat label="Available balance" value={ngn.format(kpis.balance)} icon={<CircleDollarSign size={18} />} />
          <Stat label="Paid out" value={ngn.format(kpis.paidOutTotal)} icon={<CircleDollarSign size={18} />} />
          <Stat
            label="Store rating"
            value={kpis.rating ? `${kpis.rating.toFixed(1)}` : "—"}
            icon={<BadgeCheck size={18} />}
          />
        </div>

        {/* ✅ Panels (HIDDEN for riders) */}
        {!isRider ? (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <div className="px-5 py-4 border-b bg-white/70">
                <div className="text-sm font-semibold text-zinc-900">Today’s checklist</div>
                <div className="text-xs text-zinc-500">Fast actions suppliers do daily</div>
              </div>
              <div className="p-5 space-y-3">
                {[
                  { title: "Confirm stock levels", desc: "Update inventory for popular SKUs.", to: "/supplier/products" },
                  { title: "Fulfill pending orders", desc: "Pack and mark orders as shipped.", to: "/supplier/orders" },
                  { title: "Review payouts", desc: "Check balance and payout schedule.", to: "/supplier/payouts" },
                  {
                    title: "Request catalog items",
                    desc: "Need a new brand/category/attribute? Submit a request for admin approval.",
                    to: "/supplier/catalog-requests",
                  },
                  { title: "Update store settings", desc: "Pickup address, payout details & notifications.", to: "/supplier/settings" },
                ].map((x) => (
                  <Link
                    key={x.title}
                    to={withSupplierCtx(x.to)}
                    className="block rounded-2xl border bg-white hover:bg-black/5 transition p-4"
                  >
                    <div className="font-semibold text-zinc-900">{x.title}</div>
                    <div className="text-sm text-zinc-600">{x.desc}</div>
                  </Link>
                ))}
              </div>
            </Card>

            <Card>
              <div className="px-5 py-4 border-b bg-white/70">
                <div className="text-sm font-semibold text-zinc-900">Quick insights</div>
                <div className="text-xs text-zinc-500">Placeholder (wire to analytics)</div>
              </div>

              <div className="p-5 space-y-3 text-sm text-zinc-700">
                {isAdmin && !adminSupplierId ? (
                  <div className="rounded-xl border bg-white p-3 text-zinc-600">
                    Select a supplier above to load insights.
                  </div>
                ) : insightsQ.isFetching ? (
                  <div className="rounded-xl border bg-white p-3 text-zinc-600">Loading insights…</div>
                ) : insightsQ.isError ? (
                  <div className="rounded-xl border bg-white p-3 text-rose-700">
                    Failed to load insights.{" "}
                    <button className="underline" onClick={() => insightsQ.refetch()}>
                      Retry
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border bg-white p-3">
                      Top product (last {insights?.windowDays ?? 30} days): <b>{insights?.topProduct?.title ?? "—"}</b>
                      {insights?.topProduct ? (
                        <div className="text-[11px] text-zinc-500 mt-1">
                          Revenue: <b>{ngn.format(insights.topProduct.revenue)}</b> • Units: <b>{insights.topProduct.units}</b>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-xl border bg-white p-3">
                      Most ordered: <b>{insights?.mostOrdered?.title ?? "—"}</b>
                      {insights?.mostOrdered ? (
                        <div className="text-[11px] text-zinc-500 mt-1">
                          Units: <b>{insights.mostOrdered.units}</b>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-xl border bg-white p-3">
                      Refund rate (last {insights?.windowDays ?? 30} days):{" "}
                      <b>{(insights?.refundRatePct ?? 0).toFixed(1)}%</b>
                      <div className="text-[11px] text-zinc-500 mt-1">
                        Refunds: <b>{insights?.refunds ?? 0}</b> • Purchase orders: <b>{insights?.purchaseOrders ?? 0}</b>
                        {typeof insights?.pendingPayouts === "number" ? (
                          <>
                            {" "}
                            • Pending payouts: <b>{insights.pendingPayouts}</b>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </>
                )}

                <Link
                  to={withSupplierCtx("/supplier/catalog-requests")}
                  className="block rounded-xl border bg-white p-3 hover:bg-black/5 transition"
                >
                  <div className="font-semibold text-zinc-900">Catalog requests</div>
                  <div className="text-xs text-zinc-600">Ask admin to add new brands, categories or attributes</div>
                </Link>

                <Link
                  to={withSupplierCtx("/supplier/settings")}
                  className="block rounded-xl border bg-white p-3 hover:bg-black/5 transition"
                >
                  <div className="font-semibold text-zinc-900">Settings</div>
                  <div className="text-xs text-zinc-600">Edit payout, pickup and notifications</div>
                </Link>
              </div>
            </Card>
          </div>
        ) : (
          <div className="mt-6">
            <Card>
              <div className="px-5 py-4 border-b bg-white/70">
                <div className="text-sm font-semibold text-zinc-900">Rider access</div>
                <div className="text-xs text-zinc-500">You can only view and deliver assigned orders.</div>
              </div>
              <div className="p-5">
                <Link
                  to={withSupplierCtx("/supplier/orders")}
                  className="inline-flex items-center gap-2 rounded-full bg-primary-900 text-white px-4 py-2 text-sm font-semibold hover:opacity-95"
                >
                  View assigned orders <ArrowRight size={16} />
                </Link>
              </div>
            </Card>
          </div>
        )}
      </SupplierLayout>
    </SiteLayout>
  );
}
