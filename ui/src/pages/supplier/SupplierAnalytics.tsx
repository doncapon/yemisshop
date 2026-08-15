import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";

type TrendPoint = { date: string; revenue: number; units: number };
type ProductRow = {
  productId: string;
  title: string;
  units: number;
  revenue: number;
  uniqueCustomers: number;
};
type StateRow = { state: string; units: number; revenue: number; uniqueCustomers: number };

const ngn = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

const PRESETS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "365 days", days: 365 },
] as const;

function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatTrendLabel(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export default function SupplierAnalytics() {
  const [presetDays, setPresetDays] = useState(30);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toDateInput(d);
  });
  const [to, setTo] = useState(() => toDateInput(new Date()));

  function applyPreset(days: number) {
    setPresetDays(days);
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setFrom(toDateInput(start));
    setTo(toDateInput(end));
  }

  const analyticsQ = useQuery({
    queryKey: ["supplier", "analytics", "products", from, to],
    queryFn: async () => {
      const { data } = await api.get("/api/supplier/dashboard/analytics/products", {
        withCredentials: true,
        params: { from, to },
      });
      return data?.data as {
        summary: { totalRevenue: number; totalUnits: number; uniqueCustomers: number; productCount: number };
        products: ProductRow[];
        trend: TrendPoint[];
        byState: StateRow[];
      };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const summary = analyticsQ.data?.summary;
  const products = analyticsQ.data?.products ?? [];
  const trend = analyticsQ.data?.trend ?? [];
  const byState = analyticsQ.data?.byState ?? [];
  const topProducts = products.slice(0, 8);
  const topStates = byState.slice(0, 8);

  return (
    <SupplierLayout>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
          <p className="text-sm text-slate-500">
            How your products are selling — use this to spot what's working and where to focus.
          </p>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => applyPreset(p.days)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  presetDays === p.days
                    ? "bg-teal-600 text-white border-teal-600"
                    : "bg-white text-zinc-700 border-zinc-200 hover:bg-teal-50 hover:border-teal-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setPresetDays(-1);
                  setFrom(e.target.value);
                }}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                max={to}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setPresetDays(-1);
                  setTo(e.target.value);
                }}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                min={from}
                max={toDateInput(new Date())}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Earnings" value={summary ? ngn.format(summary.totalRevenue) : "—"} />
          <SummaryCard label="Units sold" value={summary ? summary.totalUnits.toLocaleString() : "—"} />
          <SummaryCard
            label="Unique customers"
            value={summary ? summary.uniqueCustomers.toLocaleString() : "—"}
          />
          <SummaryCard
            label="Products with sales"
            value={summary ? summary.productCount.toLocaleString() : "—"}
          />
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-zinc-900 mb-1">Earnings trend</h3>
          <p className="text-xs text-zinc-500 mb-3">Selected period, bucketed automatically by range.</p>
          <div className="h-64">
            {analyticsQ.isLoading ? (
              <div className="h-full flex items-center justify-center text-sm text-zinc-400">
                Loading…
              </div>
            ) : trend.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-zinc-400">
                No sales in this period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="supplierRevenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0d9488" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatTrendLabel}
                    tick={{ fontSize: 11, fill: "#71717a" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `₦${Number(v).toLocaleString()}`}
                    tick={{ fontSize: 11, fill: "#71717a" }}
                    axisLine={false}
                    tickLine={false}
                    width={70}
                  />
                  <Tooltip
                    formatter={(value: any) => ngn.format(Number(value))}
                    labelFormatter={(label) => formatTrendLabel(String(label))}
                    contentStyle={{ borderRadius: 12, fontSize: 12, border: "1px solid #e4e4e7" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#0d9488"
                    strokeWidth={2}
                    fill="url(#supplierRevenueFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-zinc-900 mb-1">Top products</h3>
          <p className="text-xs text-zinc-500 mb-3">Your top 8 by earnings in the selected period.</p>
          <div className="h-72">
            {topProducts.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-zinc-400">
                No sales in this period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topProducts}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => `₦${Number(v).toLocaleString()}`}
                    tick={{ fontSize: 11, fill: "#71717a" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="title"
                    width={160}
                    tick={{ fontSize: 11, fill: "#3f3f46" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value: any) => ngn.format(Number(value))}
                    contentStyle={{ borderRadius: 12, fontSize: 12, border: "1px solid #e4e4e7" }}
                  />
                  <Bar dataKey="revenue" fill="#0d9488" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-zinc-900 mb-1">Sales by location</h3>
          <p className="text-xs text-zinc-500 mb-3">
            Where your buyers are, by delivery state — no customer identity, just where demand comes
            from.
          </p>
          <div className="h-64">
            {topStates.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-zinc-400">
                No sales in this period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topStates}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "#71717a" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="state"
                    width={110}
                    tick={{ fontSize: 11, fill: "#3f3f46" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value: any, name) => [
                      name === "units" ? `${value} unit${value === 1 ? "" : "s"}` : value,
                      "Units sold",
                    ]}
                    contentStyle={{ borderRadius: 12, fontSize: 12, border: "1px solid #e4e4e7" }}
                  />
                  <Bar dataKey="units" fill="#0d9488" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-gradient-to-r from-teal-50/80 to-emerald-50/50">
            <h3 className="text-sm font-semibold text-zinc-900">All products</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-zinc-600">Product</th>
                  <th className="text-right px-4 py-2 font-medium text-zinc-600">Units</th>
                  <th className="text-right px-4 py-2 font-medium text-zinc-600">Earnings</th>
                  <th className="text-right px-4 py-2 font-medium text-zinc-600">Customers</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {products.map((p) => (
                  <tr key={p.productId}>
                    <td className="px-4 py-2.5 font-medium text-zinc-900">{p.title}</td>
                    <td className="px-4 py-2.5 text-right">{p.units.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">{ngn.format(p.revenue)}</td>
                    <td className="px-4 py-2.5 text-right">{p.uniqueCustomers.toLocaleString()}</td>
                  </tr>
                ))}

                {!products.length && !analyticsQ.isLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                      No sales in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </SupplierLayout>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-zinc-900">{value}</div>
    </div>
  );
}
