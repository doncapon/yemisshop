import { useMemo, useState } from "react";
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
import api from "../../api/client.js";

type TrendPoint = { date: string; revenue: number; units: number };
type ProductRow = {
  productId: string;
  title: string;
  supplierId: string | null;
  supplierName: string | null;
  units: number;
  revenue: number;
  uniqueCustomers: number;
};
type CustomerRow = {
  userId: string;
  name: string;
  email: string | null;
  units: number;
  revenue: number;
};
type SupplierOption = { id: string; name?: string | null };
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

export default function AdminProductAnalytics() {
  const [presetDays, setPresetDays] = useState(30);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toDateInput(d);
  });
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [supplierId, setSupplierId] = useState("");
  const [drillDownProduct, setDrillDownProduct] = useState<ProductRow | null>(null);

  function applyPreset(days: number) {
    setPresetDays(days);
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setFrom(toDateInput(start));
    setTo(toDateInput(end));
  }

  const suppliersQ = useQuery({
    queryKey: ["admin", "suppliers", "forAnalytics"],
    queryFn: async () => {
      const res = await api.get("/api/admin/suppliers", { withCredentials: true });
      const raw = res.data?.data ?? res.data ?? [];
      return (Array.isArray(raw) ? raw : []) as SupplierOption[];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const analyticsQ = useQuery({
    queryKey: ["admin", "analytics", "products", from, to, supplierId],
    queryFn: async () => {
      const { data } = await api.get("/api/admin/analytics/products", {
        withCredentials: true,
        params: { from, to, supplierId: supplierId || undefined },
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

  const customersQ = useQuery({
    queryKey: ["admin", "analytics", "productCustomers", drillDownProduct?.productId, from, to, supplierId],
    enabled: !!drillDownProduct,
    queryFn: async () => {
      const { data } = await api.get(
        `/api/admin/analytics/products/${encodeURIComponent(drillDownProduct!.productId)}/customers`,
        { withCredentials: true, params: { from, to, supplierId: supplierId || undefined } }
      );
      return (data?.data ?? []) as CustomerRow[];
    },
    staleTime: 30_000,
  });

  const summary = analyticsQ.data?.summary;
  const products = analyticsQ.data?.products ?? [];
  const trend = analyticsQ.data?.trend ?? [];
  const byState = analyticsQ.data?.byState ?? [];
  const suppliers = suppliersQ.data ?? [];

  const topProducts = useMemo(() => products.slice(0, 8), [products]);
  const topStates = useMemo(() => byState.slice(0, 8), [byState]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-semibold text-zinc-900">Product analytics</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              What's selling, who's buying it, and how it's trending — shareable with suppliers to
              help them improve placement.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => applyPreset(p.days)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  presetDays === p.days
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-zinc-700 border-zinc-200 hover:bg-blue-50 hover:border-blue-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Supplier</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
            >
              <option value="">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.id}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Revenue" value={summary ? ngn.format(summary.totalRevenue) : "—"} />
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
        <h3 className="text-sm font-semibold text-zinc-900 mb-1">Revenue trend</h3>
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
                  <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
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
                  formatter={(value: any, name) => [
                    name === "revenue" ? ngn.format(Number(value)) : value,
                    name === "revenue" ? "Revenue" : "Units",
                  ]}
                  labelFormatter={(label) => formatTrendLabel(String(label))}
                  contentStyle={{ borderRadius: 12, fontSize: 12, border: "1px solid #e4e4e7" }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#2563eb"
                  strokeWidth={2}
                  fill="url(#revenueFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-zinc-900 mb-1">Top products by revenue</h3>
        <p className="text-xs text-zinc-500 mb-3">Top 8 in the selected period.</p>
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
                <Bar dataKey="revenue" fill="#2563eb" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-zinc-900 mb-1">Sales by location</h3>
        <p className="text-xs text-zinc-500 mb-3">Where buyers are, by delivery state.</p>
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
                  tickFormatter={(v) => `₦${Number(v).toLocaleString()}`}
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
                  formatter={(value: any) => ngn.format(Number(value))}
                  contentStyle={{ borderRadius: 12, fontSize: 12, border: "1px solid #e4e4e7" }}
                />
                <Bar dataKey="revenue" fill="#2563eb" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-gradient-to-r from-blue-50/80 to-sky-50/50">
          <h3 className="text-sm font-semibold text-zinc-900">All products</h3>
          <p className="text-xs text-zinc-500 mt-0.5">Click a row to see which customers bought it.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-zinc-600">Product</th>
                <th className="text-left px-4 py-2 font-medium text-zinc-600">Supplier</th>
                <th className="text-right px-4 py-2 font-medium text-zinc-600">Units</th>
                <th className="text-right px-4 py-2 font-medium text-zinc-600">Revenue</th>
                <th className="text-right px-4 py-2 font-medium text-zinc-600">Customers</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.map((p) => (
                <tr
                  key={p.productId}
                  className="cursor-pointer hover:bg-blue-50/50 transition"
                  onClick={() => setDrillDownProduct(p)}
                >
                  <td className="px-4 py-2.5 font-medium text-zinc-900">{p.title}</td>
                  <td className="px-4 py-2.5 text-zinc-600">{p.supplierName || "—"}</td>
                  <td className="px-4 py-2.5 text-right">{p.units.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right">{ngn.format(p.revenue)}</td>
                  <td className="px-4 py-2.5 text-right">{p.uniqueCustomers.toLocaleString()}</td>
                </tr>
              ))}

              {!products.length && !analyticsQ.isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                    No sales in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {drillDownProduct && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setDrillDownProduct(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b bg-gradient-to-r from-blue-50/80 to-sky-50/50 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-zinc-900">{drillDownProduct.title}</h3>
                <p className="text-xs text-zinc-500">Customers who bought this in the selected period</p>
              </div>
              <button
                type="button"
                onClick={() => setDrillDownProduct(null)}
                className="rounded-full border bg-white px-2.5 py-1 text-xs font-semibold hover:bg-zinc-50"
              >
                Close
              </button>
            </div>

            <div className="overflow-y-auto divide-y">
              {customersQ.isLoading ? (
                <div className="p-6 text-center text-sm text-zinc-400">Loading…</div>
              ) : (customersQ.data ?? []).length === 0 ? (
                <div className="p-6 text-center text-sm text-zinc-400">No customers found.</div>
              ) : (
                (customersQ.data ?? []).map((c) => (
                  <div key={c.userId} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-zinc-900 truncate">{c.name}</div>
                      <div className="text-xs text-zinc-500 truncate">{c.email || "—"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-zinc-900">{ngn.format(c.revenue)}</div>
                      <div className="text-xs text-zinc-500">{c.units} unit{c.units === 1 ? "" : "s"}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
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
