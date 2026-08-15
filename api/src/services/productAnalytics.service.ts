// api/src/services/productAnalytics.service.ts
import { prisma } from "../lib/prisma.js";

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "object" && v && typeof (v as any).toNumber === "function") {
    return (v as any).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Orders in these states aren't real sales — excluded from analytics so
// suppliers/admins don't make placement decisions off inflated numbers.
const EXCLUDED_ORDER_STATUSES = ["CANCELED", "REFUNDED"];

export type ProductAnalyticsRow = {
  productId: string;
  title: string;
  supplierId: string | null;
  supplierName: string | null;
  units: number;
  revenue: number;
  uniqueCustomers: number;
};

export type ProductAnalyticsSummary = {
  totalRevenue: number;
  totalUnits: number;
  uniqueCustomers: number;
  productCount: number;
};

export type ProductAnalyticsTrendPoint = {
  date: string; // bucket start, YYYY-MM-DD
  revenue: number;
  units: number;
};

export type ProductAnalyticsStateRow = {
  state: string;
  units: number;
  revenue: number;
  uniqueCustomers: number;
};

export type ProductAnalyticsResult = {
  summary: ProductAnalyticsSummary;
  products: ProductAnalyticsRow[];
  trend: ProductAnalyticsTrendPoint[];
  byState: ProductAnalyticsStateRow[];
};

type TrendGranularity = "day" | "week" | "month";

function pickGranularity(from: Date, to: Date): TrendGranularity {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
  if (days <= 90) return "day";
  if (days <= 365) return "week";
  return "month";
}

function bucketKey(d: Date, granularity: TrendGranularity): string {
  if (granularity === "day") {
    return d.toISOString().slice(0, 10);
  }
  if (granularity === "week") {
    // Monday-start ISO week bucket, keyed by that Monday's date.
    const x = new Date(d);
    const day = x.getDay(); // 0=Sun..6=Sat
    const diffToMonday = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diffToMonday);
    x.setHours(0, 0, 0, 0);
    return x.toISOString().slice(0, 10);
  }
  // month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export async function computeProductAnalytics(params: {
  from: Date;
  to: Date;
  supplierId?: string | null;
  /** true = supplier's own earnings (chosenSupplierUnitPrice); false = customer-facing price (unitPrice). */
  useSupplierPrice: boolean;
}): Promise<ProductAnalyticsResult> {
  const { from, to, supplierId, useSupplierPrice } = params;

  const items = await prisma.orderItem.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      ...(supplierId ? { chosenSupplierId: supplierId } : {}),
      order: { status: { notIn: EXCLUDED_ORDER_STATUSES } },
    } as any,
    select: {
      productId: true,
      title: true,
      quantity: true,
      unitPrice: true,
      chosenSupplierUnitPrice: true,
      chosenSupplierId: true,
      createdAt: true,
      order: {
        select: {
          userId: true,
          shippingAddress: { select: { state: true } },
        },
      },
    },
  });

  type Row = {
    title: string;
    supplierId: string | null;
    units: number;
    revenue: number;
    customers: Set<string>;
  };
  const byProduct = new Map<string, Row>();
  const allCustomers = new Set<string>();

  const granularity = pickGranularity(from, to);
  const byBucket = new Map<string, { revenue: number; units: number }>();

  type StateRow = { units: number; revenue: number; customers: Set<string> };
  const byStateMap = new Map<string, StateRow>();

  for (const it of items as any[]) {
    const productId = String(it.productId ?? "");
    if (!productId) continue;

    const units = num(it.quantity);
    const price = useSupplierPrice ? num(it.chosenSupplierUnitPrice) : num(it.unitPrice);
    const revenue = price * units;
    const customerId = it.order?.userId ? String(it.order.userId) : null;

    const row = byProduct.get(productId) ?? {
      title: String(it.title ?? "—"),
      supplierId: it.chosenSupplierId ? String(it.chosenSupplierId) : null,
      units: 0,
      revenue: 0,
      customers: new Set<string>(),
    };

    row.units += units;
    row.revenue += revenue;
    if (customerId) {
      row.customers.add(customerId);
      allCustomers.add(customerId);
    }

    byProduct.set(productId, row);

    const state = String(it.order?.shippingAddress?.state ?? "").trim() || "Unknown";
    const stateRow = byStateMap.get(state) ?? { units: 0, revenue: 0, customers: new Set<string>() };
    stateRow.units += units;
    stateRow.revenue += revenue;
    if (customerId) stateRow.customers.add(customerId);
    byStateMap.set(state, stateRow);

    const bucket = bucketKey(new Date(it.createdAt), granularity);
    const b = byBucket.get(bucket) ?? { revenue: 0, units: 0 };
    b.revenue += revenue;
    b.units += units;
    byBucket.set(bucket, b);
  }

  const trend: ProductAnalyticsTrendPoint[] = Array.from(byBucket.entries())
    .map(([date, v]) => ({ date, revenue: round2(v.revenue), units: v.units }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Batch-resolve supplier names (only relevant when spanning multiple
  // suppliers, e.g. the admin's unfiltered view).
  const supplierIds = Array.from(
    new Set(Array.from(byProduct.values()).map((r) => r.supplierId).filter(Boolean) as string[])
  );
  const suppliers = supplierIds.length
    ? await prisma.supplier.findMany({
        where: { id: { in: supplierIds } },
        select: { id: true, name: true },
      })
    : [];
  const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));

  const products: ProductAnalyticsRow[] = Array.from(byProduct.entries())
    .map(([productId, row]) => ({
      productId,
      title: row.title,
      supplierId: row.supplierId,
      supplierName: row.supplierId ? supplierNameById.get(row.supplierId) ?? null : null,
      units: row.units,
      revenue: round2(row.revenue),
      uniqueCustomers: row.customers.size,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const summary: ProductAnalyticsSummary = {
    totalRevenue: round2(products.reduce((sum, p) => sum + p.revenue, 0)),
    totalUnits: products.reduce((sum, p) => sum + p.units, 0),
    uniqueCustomers: allCustomers.size,
    productCount: products.length,
  };

  const byState: ProductAnalyticsStateRow[] = Array.from(byStateMap.entries())
    .map(([state, v]) => ({
      state,
      units: v.units,
      revenue: round2(v.revenue),
      uniqueCustomers: v.customers.size,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return { summary, products, trend, byState };
}

export type ProductCustomerRow = {
  userId: string;
  name: string;
  email: string | null;
  units: number;
  revenue: number;
};

/** Drill-down: who bought a specific product in the window. Admin-only — never exposed to suppliers. */
export async function computeProductCustomers(params: {
  productId: string;
  from: Date;
  to: Date;
  supplierId?: string | null;
  useSupplierPrice: boolean;
}): Promise<ProductCustomerRow[]> {
  const { productId, from, to, supplierId, useSupplierPrice } = params;

  const items = await prisma.orderItem.findMany({
    where: {
      productId,
      createdAt: { gte: from, lte: to },
      ...(supplierId ? { chosenSupplierId: supplierId } : {}),
      order: { status: { notIn: EXCLUDED_ORDER_STATUSES } },
    } as any,
    select: {
      quantity: true,
      unitPrice: true,
      chosenSupplierUnitPrice: true,
      order: {
        select: {
          userId: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
    },
  });

  const byCustomer = new Map<string, ProductCustomerRow>();

  for (const it of items as any[]) {
    const user = it.order?.user;
    if (!user?.id) continue;

    const units = num(it.quantity);
    const price = useSupplierPrice ? num(it.chosenSupplierUnitPrice) : num(it.unitPrice);
    const revenue = price * units;

    const row = byCustomer.get(user.id) ?? {
      userId: user.id,
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || "—",
      email: user.email ?? null,
      units: 0,
      revenue: 0,
    };

    row.units += units;
    row.revenue += revenue;
    byCustomer.set(user.id, row);
  }

  return Array.from(byCustomer.values())
    .map((r) => ({ ...r, revenue: round2(r.revenue) }))
    .sort((a, b) => b.units - a.units);
}
