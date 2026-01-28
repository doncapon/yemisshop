// src/pages/supplier/SupplierDashboard.tsx
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
  Tags,
} from "lucide-react";
import { Link } from "react-router-dom";
import SiteLayout from "../../layouts/SiteLayout";
import SupplierLayout from "../../layouts/SupplierLayout";
import { fetchSupplierDashboardSummary } from "../../api/supplierDashboard";
import { useQuery } from "@tanstack/react-query";
import { fetchSupplierDashboardInsights } from "../../api/supplierInsights";


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

export default function SupplierDashboard() {
  const summaryQ = useQuery({
    queryKey: ["supplier", "dashboard", "summary"],
    queryFn: fetchSupplierDashboardSummary,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const insightsQ = useQuery({
    queryKey: ["supplier", "dashboard", "insights"],
    queryFn: fetchSupplierDashboardInsights,
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

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to="/supplier/products"
                className="inline-flex items-center gap-2 rounded-full bg-white text-zinc-900 px-4 py-2 text-sm font-semibold hover:opacity-95"
              >
                Manage products <ArrowRight size={16} />
              </Link>

              <Link
                to="/supplier/orders"
                className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
              >
                View orders <ArrowRight size={16} />
              </Link>

              {/* ✅ NEW: Catalog requests */}
              <Link
                to="/supplier/catalog-requests"
                className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
              >
                Catalog requests <Tags size={16} />
              </Link>

              {/* ✅ Settings link */}
              <Link
                to="/supplier/settings"
                className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
              >
                Settings <Settings size={16} />
              </Link>
            </div>
            {/* ✅ small loading/error line */}
            {summaryQ.isFetching && (
              <div className="mt-3 text-xs text-white/80">Loading dashboard…</div>
            )}
            {summaryQ.isError && (
              <div className="mt-3 text-xs text-white/90">
                Failed to load dashboard.{" "}
                <button className="underline" onClick={() => summaryQ.refetch()}>
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>

        {/* KPI Grid */}
        <div className="mt-6 grid gap-3 md:gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <Stat label="Live products" value={`${kpis.liveProducts}`} icon={<Package size={18} />} />
          <Stat label="Low stock" value={`${kpis.lowStock}`} icon={<Box size={18} />} hint="Restock soon" />
          <Stat label="Pending orders" value={`${kpis.pendingOrders}`} icon={<ShoppingBag size={18} />} />
          <Stat label="Shipped today" value={`${kpis.shippedToday}`} icon={<Truck size={18} />} />
          <Stat label="Available balance" value={ngn.format(kpis.balance)} icon={<CircleDollarSign size={18} />} />
          <Stat
            label="Store rating"
            value={kpis.rating ? `${kpis.rating.toFixed(1)}` : "—"}
            icon={<BadgeCheck size={18} />}
          />
        </div>

        {/* Panels */}
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

                // ✅ NEW: Catalog requests checklist item
                {
                  title: "Request catalog items",
                  desc: "Need a new brand/category/attribute? Submit a request for admin approval.",
                  to: "/supplier/catalog-requests",
                },

                { title: "Update store settings", desc: "Pickup address, payout details & notifications.", to: "/supplier/settings" },
              ].map((x) => (
                <Link
                  key={x.title}
                  to={x.to}
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
              {insightsQ.isFetching && (
                <div className="rounded-xl border bg-white p-3 text-zinc-600">Loading insights…</div>
              )}

              {insightsQ.isError && (
                <div className="rounded-xl border bg-white p-3 text-rose-700">
                  Failed to load insights.{" "}
                  <button className="underline" onClick={() => insightsQ.refetch()}>
                    Retry
                  </button>
                </div>
              )}

              {!insightsQ.isFetching && !insightsQ.isError && (
                <>
                  <div className="rounded-xl border bg-white p-3">
                    Top product (last {insights?.windowDays ?? 30} days):{" "}
                    <b>{insights?.topProduct?.title ?? "—"}</b>
                    {insights?.topProduct ? (
                      <div className="text-[11px] text-zinc-500 mt-1">
                        Revenue: <b>{ngn.format(insights.topProduct.revenue)}</b> • Units:{" "}
                        <b>{insights.topProduct.units}</b>
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
                      Refunds: <b>{insights?.refunds ?? 0}</b> • Purchase orders:{" "}
                      <b>{insights?.purchaseOrders ?? 0}</b>
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

              {/* Keep CTAs */}
              <Link
                to="/supplier/catalog-requests"
                className="block rounded-xl border bg-white p-3 hover:bg-black/5 transition"
              >
                <div className="font-semibold text-zinc-900">Catalog requests</div>
                <div className="text-xs text-zinc-600">Ask admin to add new brands, categories or attributes</div>
              </Link>

              <Link
                to="/supplier/settings"
                className="block rounded-xl border bg-white p-3 hover:bg-black/5 transition"
              >
                <div className="font-semibold text-zinc-900">Settings</div>
                <div className="text-xs text-zinc-600">Edit payout, pickup and notifications</div>
              </Link>
            </div>

          </Card>
        </div>
      </SupplierLayout>
    </SiteLayout>
  );
}
