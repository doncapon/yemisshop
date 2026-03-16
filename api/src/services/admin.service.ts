// api/src/services/admin.service.ts
import { PrismaClient, $Enums } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import type { Role } from '../types/role.js';
import { prisma } from '../lib/prisma.js';
import { DateTime } from 'luxon';
import { Decimal } from '@prisma/client/runtime/client';

/* ------------------------------------------------------------------ */
/* Types returned by the service                                       */
/* ------------------------------------------------------------------ */
export type AdminUser = {
  id: string;
  email: string;
  role: Role | string;
  status: string;
  createdAt?: Date | string;
};

export type AdminProduct = {
  id: string;
  title: string;
  retailPrice: Decimal | number | string | null;
  status: string;
  imagesJson?: string[];
  createdAt?: Date | string;
};


export type AdminPayment = {
  id: string;
  orderId: string;
  userEmail?: string | null;
  amount: Decimal | number | string;
  status: string;
  provider?: string | null;
  channel?: string | null;
  createdAt?: Date | string;
};

async function loadPlatformMarginPercent(prismaClient: PrismaClient): Promise<number> {
  const rows = await prismaClient.setting.findMany({
    where: {
      key: {
        in: ["platformMarginPercent", "marginPercent", "pricingMarkupPercent"],
      },
    },
    select: { key: true, value: true },
  });

  const map = new Map(rows.map((r: any) => [String(r.key), String(r.value ?? "")]));

  const raw =
    map.get("platformMarginPercent") ??
    map.get("marginPercent") ??
    map.get("pricingMarkupPercent") ??
    "0";

  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ----------------------------------------------------------------------------

const N = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function computeProfitForWindow(
  prismaClient: PrismaClient,
  from: Date,
  to: Date,
  mode: "cashflow" | "sales" = "cashflow"
): Promise<ProfitBreakdown> {
  const N = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  let scopedOrderIds: string[] | null = null;

  if (mode === "sales") {
    const ordersInWindow = await prismaClient.order.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { id: true },
    });

    scopedOrderIds = ordersInWindow.map((o: any) => String(o.id));

    if (!scopedOrderIds.length) {
      return {
        revenuePaid: 0,
        refunds: 0,
        revenueNet: 0,
        gatewayFees: 0,
        taxCollected: 0,
        commissionRevenue: 0,
        serviceFeeBaseRevenue: 0,
        grossProfit: 0,
      };
    }
  }

  const marginPercent = await loadPlatformMarginPercent(prismaClient);

  const payments = await prismaClient.payment.findMany({
    where: {
      status: { in: [$Enums.PaymentStatus.PAID, $Enums.PaymentStatus.REFUNDED] },
      ...(mode === "sales"
        ? { orderId: { in: scopedOrderIds! } }
        : {
          OR: [
            {
              status: $Enums.PaymentStatus.PAID,
              OR: [
                { paidAt: { gte: from, lte: to } },
                { paidAt: null, createdAt: { gte: from, lte: to } },
              ],
            },
            {
              status: $Enums.PaymentStatus.REFUNDED,
              OR: [
                { refundedAt: { gte: from, lte: to } },
                { refundedAt: null, createdAt: { gte: from, lte: to } },
              ],
            },
          ],
        }),
    },
    select: {
      status: true,
      amount: true,
      feeAmount: true,
      orderId: true,
    },
  });

  let revenuePaid = 0;
  let refunds = 0;
  let gatewayFees = 0;

  const paidByOrder = new Map<string, number>();
  const refundedByOrder = new Map<string, number>();

  for (const p of payments) {
    const amt = N(p.amount);
    const fee = N(p.feeAmount);
    const oid = String(p.orderId || "");

    if (p.status === $Enums.PaymentStatus.PAID) {
      revenuePaid += amt;
      gatewayFees += fee;
      if (oid) paidByOrder.set(oid, N(paidByOrder.get(oid)) + amt);
    } else if (p.status === $Enums.PaymentStatus.REFUNDED) {
      refunds += amt;
      if (oid) refundedByOrder.set(oid, N(refundedByOrder.get(oid)) + amt);
    }
  }

  const revenueNet = revenuePaid - refunds;

  const orderIds = Array.from(new Set([...paidByOrder.keys(), ...refundedByOrder.keys()]));

  if (!orderIds.length) {
    return {
      revenuePaid,
      refunds,
      revenueNet,
      gatewayFees,
      taxCollected: 0,
      commissionRevenue: 0,
      serviceFeeBaseRevenue: 0,
      grossProfit: 0,
    };
  }

  const orders = await prismaClient.order.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      total: true,
      tax: true,
      serviceFeeBase: true,
      items: {
        select: {
          quantity: true,
          chosenSupplierUnitPrice: true,
        },
      },
    } as any,
  });

  const effectiveFactorFor = (orderTotal: number, orderId: string) => {
    const paid = N(paidByOrder.get(orderId));
    const refunded = N(refundedByOrder.get(orderId));
    if (orderTotal <= 0) return 0;

    const ratio = (paid - refunded) / orderTotal;
    return Math.max(0, Math.min(1, ratio));
  };

  let taxCollected = 0;
  let commissionRevenue = 0;
  let serviceFeeBaseRevenue = 0;

  for (const o of orders as any[]) {
    const orderId = String(o.id);
    const orderTotal = N(o.total);
    const factor = effectiveFactorFor(orderTotal, orderId);

    if (factor <= 0) continue;

    taxCollected += N(o.tax) * factor;

    const supplierBaseTotal = (Array.isArray(o.items) ? o.items : []).reduce(
      (sum: number, it: any) => {
        const qty = Math.max(0, N(it.quantity));
        const supplierBaseUnit = N(it.chosenSupplierUnitPrice);
        return sum + supplierBaseUnit * qty;
      },
      0
    );

    const commission = supplierBaseTotal * (marginPercent / 100);
    const serviceBase = N(o.serviceFeeBase);

    commissionRevenue += commission * factor;
    serviceFeeBaseRevenue += serviceBase * factor;
  }

  const grossProfit = commissionRevenue + serviceFeeBaseRevenue;

  return {
    revenuePaid,
    refunds,
    revenueNet,
    gatewayFees,
    taxCollected,
    commissionRevenue,
    serviceFeeBaseRevenue,
    grossProfit,
  };
}


type ProfitBreakdown = {
  revenuePaid: number;
  refunds: number;
  revenueNet: number;

  // informational only
  gatewayFees: number;
  taxCollected: number;

  // ✅ aligned with Orders page
  commissionRevenue: number;
  serviceFeeBaseRevenue: number;

  // ✅ business profit
  grossProfit: number;
};

function safeTimeZone(tz?: string): string {
  const candidate = String(tz || "").trim();
  if (!candidate) return "UTC";

  try {
    Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return "UTC";
  }
}

export async function getOverview(timeZone = "UTC"): Promise<Overview> {
  const [
    productsTotal,
    productsPending,
    productsRejected,
    productsPublished,

    productsAvailable,
    productsPublishedAvailable,

    productsWithOffers,
    productsWithoutOffers,
    productsPublishedWithOffers,
    productsPublishedWithoutOffers,

    productsWithActiveOffer,
    productsPublishedWithActiveOffer,

    // "Live" = published, available, and has at least one active in-stock offer
    productsLive,

    productsWithVariants,
    productsSimple,

    productsPublishedInStockBaseOnly,
    productsPublishedOutOfStockBaseOnly,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { status: 'PENDING' as any } }),
    prisma.product.count({ where: { status: 'REJECTED' as any } }),
    prisma.product.count({ where: { status: 'PUBLISHED' as any } }),

    prisma.product.count({ where: variantAwareAvailable }),
    prisma.product.count({ where: { status: 'PUBLISHED' as any, AND: [variantAwareAvailable] } }),

    prisma.product.count({ where: anyOffer }),
    prisma.product.count({ where: noOffer }),
    prisma.product.count({ where: { status: 'PUBLISHED' as any, AND: [anyOffer] } }),
    prisma.product.count({ where: { status: 'PUBLISHED' as any, AND: [noOffer] } }),

    prisma.product.count({ where: anyActiveOffer }),
    prisma.product.count({ where: { status: 'PUBLISHED' as any, AND: [anyActiveOffer] } }),

    // ✅ FIX: do NOT rely on a "LIVE" status string; compute live from rules
    prisma.product.count({
      where: { status: 'PUBLISHED' as any, AND: [variantAwareAvailable, anyActiveOffer] },
    }),

    prisma.product.count({ where: { ProductVariant: { some: {} } } }),
    prisma.product.count({ where: { ProductVariant: { none: {} } } }),

    // base (non-variant-aware) stock among published (kept as-is)
    prisma.product.count({ where: { status: 'PUBLISHED' as any, inStock: true } }),
    prisma.product.count({ where: { status: 'PUBLISHED' as any, inStock: false } }),
  ]);

  const productsOffline = Math.max(0, productsPublished - productsLive);

  // Users
  const [totalUsers, totalCustomers, totalAdmins, totalSuperAdmins, totalSuppliers, totalSupplierRiders] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'SHOPPER' } }),
    prisma.user.count({ where: { role: 'ADMIN' } }),
    prisma.user.count({ where: { role: 'SUPER_ADMIN' } }),
    prisma.user.count({ where: { role: 'SUPPLIER' } }),
    prisma.user.count({ where: { role: 'SUPPLIER_RIDER' } }),
  ]);

  // ✅ Use same timezone boundaries as /admin/metrics/profit-summary
  const TZ = safeTimeZone(timeZone);
  const nowInTz = DateTime.now().setZone(TZ);
  const todayStartUtc = nowInTz.startOf("day").toUTC().toJSDate();
  const todayEndUtc = nowInTz.endOf("day").toUTC().toJSDate();

  // Orders today (use same UTC bounds derived from Lagos day)
  const ordersToday = await prisma.order.count({
    where: {
      createdAt: { gte: todayStartUtc, lte: todayEndUtc },
      NOT: { status: "CANCELED" },
    },
  });

  // Sparklines (7d) — also align them to Lagos day boundaries
  const sparklineRevenue7d: number[] = [];
  const sparklineProfit7d: number[] = [];

  for (let i = 6; i >= 0; i--) {
    const dayInTz = nowInTz.minus({ days: i });
    const fromUtc = dayInTz.startOf("day").toUTC().toJSDate();
    const toUtc = dayInTz.endOf("day").toUTC().toJSDate();

    const { revenueNet: rev, grossProfit: gp } = await computeProfitForWindow(
      prisma,
      fromUtc,
      toUtc,
      "sales"
    );

    sparklineRevenue7d.push(rev);
    sparklineProfit7d.push(gp);
  }

  // ✅ RevenueToday + ProfitToday from the SAME function
  const todayBreakdown = await computeProfitForWindow(
  prisma,
  todayStartUtc,
  todayEndUtc,
  "sales"
);

  // If your dashboard “Revenue Today” means net revenue, use revenueNet.
  // If you want gross paid revenue, use revenuePaid.
  const revenueToday = todayBreakdown.revenueNet; // or todayBreakdown.revenuePaid
  const profitToday = todayBreakdown.grossProfit;

  // keep these if you still need them elsewhere (not required for revenue/profit)
  const [ordersCount, usersCount] = await Promise.all([
    prisma.order.count(),
    prisma.user.count(),
  ]);

  return {
    ordersToday,
    revenueToday,
    sparklineRevenue7d,
    sparklineProfit7d,
    profitToday,
    users: {
      totalUsers,
      totalCustomers,
      totalAdmins,
      totalSuperAdmins,
      totalSuppliers,
      totalSupplierRiders
    },
    products: {
      offline: productsOffline,
      total: productsTotal,
      pending: productsPending,
      rejected: productsRejected,
      published: productsPublished,
      live: productsLive,
      availability: {
        allStatusesAvailable: productsAvailable,
        publishedAvailable: productsPublishedAvailable,
      },
      offers: {
        withAny: productsWithOffers,
        withoutAny: productsWithoutOffers,
        publishedWithAny: productsPublishedWithOffers,
        publishedWithoutAny: productsPublishedWithoutOffers,
        withActive: productsWithActiveOffer,
        publishedWithActive: productsPublishedWithActiveOffer,
      },
      variantMix: {
        withVariants: productsWithVariants,
        simple: productsSimple,
      },
      publishedBaseStock: {
        inStock: productsPublishedInStockBaseOnly,
        outOfStock: productsPublishedOutOfStockBaseOnly,
      },
    },
  };
}

// export async function createCoupon(args: { code: string; pct: number; maxUses: number }) {
//   const code = args.code.trim().toUpperCase();
//   if (!code) throw new Error('Coupon code is required');
//   if (args.pct < 1 || args.pct > 90) throw new Error('Percent must be between 1 and 90');
//   if (args.maxUses < 1) throw new Error('Max uses must be at least 1');

//   try {
//     const created = await prisma.coupon.create({
//       data: {
//         code,
//       },
//       select: { id: true, code: true, createdAt: true },
//     });
//     return created;
//   } catch (err: any) {
//     if (err?.code === 'P2021' || /prisma\.coupon/i.test(String(err))) {
//       throw new Error('Coupon model not found. Please add a Coupon model to your Prisma schema.');
//     }
//     throw err;
//   }
// }

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * ✅ UPDATED for new schema:
 * Product no longer has `supplierOffers`.
 * It has:
 *  - supplierProductOffers
 *  - supplierVariantOffers
 */

/**
 * Any ACTIVE & IN-STOCK offer with quantity > 0 (product-level OR variant-level).
 * This is your “real stock” now.
 */
const anyActiveOffer: Prisma.ProductWhereInput = {
  OR: [
    { supplierProductOffers: { some: { isActive: true, inStock: true, availableQty: { gt: 0 } } } },
    { supplierVariantOffers: { some: { isActive: true, inStock: true, availableQty: { gt: 0 } } } },
  ],
};

/**
 * ✅ FIX FOR YOUR ISSUE:
 * Products without ANY offers should be “out of stock”.
 * So “available” is now driven by offers (not by product.inStock / variant.inStock).
 */
const variantAwareAvailable: Prisma.ProductWhereInput = anyActiveOffer;

const anyOffer: Prisma.ProductWhereInput = {
  OR: [{ supplierProductOffers: { some: {} } }, { supplierVariantOffers: { some: {} } }],
};

const noOffer: Prisma.ProductWhereInput = {
  AND: [{ supplierProductOffers: { none: {} } }, { supplierVariantOffers: { none: {} } }],
};

// (kept in case you later need it)
const noActiveOffer: Prisma.ProductWhereInput = {
  AND: [
    { supplierProductOffers: { none: { isActive: true, inStock: true, availableQty: { gt: 0 } } } },
    { supplierVariantOffers: { none: { isActive: true, inStock: true, availableQty: { gt: 0 } } } },
  ],
};

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export async function findUsers(q?: string): Promise<AdminUser[]> {
  const where: Prisma.UserWhereInput = q
    ? {
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { role: { equals: q as Role } },
      ],
    }
    : {};

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });

  return users;
}

/* ---- Overview payload types (match your getOverview) ---- */
type Overview = {
  ordersToday: number;
  revenueToday: number;
  profitToday: number;
  sparklineRevenue7d: number[];
  sparklineProfit7d: number[];

  users: {
    totalUsers: number;
    totalCustomers: number;
    totalAdmins: number;
    totalSuperAdmins: number;
    totalSuppliers: number;
    totalSupplierRiders: number;
  };
  products: {
    offline: number;
    total: number;
    pending: number;
    rejected: number;
    published: number;
    live: number;
    availability: {
      allStatusesAvailable: number;
      publishedAvailable: number;
    };
    offers: {
      withAny: number;
      withoutAny: number;
      publishedWithAny: number;
      publishedWithoutAny: number;
      withActive: number;
      publishedWithActive: number;
    };
    variantMix: {
      withVariants: number;
      simple: number;
    };
    publishedBaseStock: {
      inStock: number;
      outOfStock: number;
    };
  };
};

/**
 * Suspend / deactivate a user.
 */
export async function suspendUser(userId: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { status: 'SUSPENDED' },
    select: { id: true, email: true, role: true, status: true },
  });
  return user;
}

/**
 * Reactivate a user.
 */
export async function reactivateUser(userId: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { status: 'VERIFIED' },
    select: { id: true, email: true, role: true, status: true },
  });
  return user;
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export async function markPaymentPaid(paymentId: string) {
  const payment = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'PAID', paidAt: new Date() },
    select: { id: true, orderId: true, status: true, amount: true },
  });
  if (payment.orderId) {
    await prisma.order.update({
      where: { id: payment.orderId },
      data: { status: 'PAID' },
    });
  }
  return payment;
}

export async function markPaymentRefunded(paymentId: string) {
  const payment = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'REFUNDED' },
    select: { id: true, orderId: true, status: true, amount: true },
  });

  if (payment.orderId) {
    const stillPaid = await prisma.payment.count({
      where: { orderId: payment.orderId, status: 'PAID' },
    });

    if (stillPaid === 0) {
      await prisma.order.update({
        where: { id: payment.orderId },
        data: { status: 'CANCELED' },
      });
    }
  }

  return payment;
}

/* ================================================================== */
/* =======================  NEW: Products  ========================== */
/* ================================================================== */

export async function pendingProducts(q?: string): Promise<AdminProduct[]> {
  const where: Prisma.ProductWhereInput = {
    status: 'PENDING',
    ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
  };

  const list = await prisma.product.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      retailPrice: true,
      status: true,
      imagesJson: true,
      createdAt: true,
    },
  });

  return list;
}

export async function approveProduct(productId: string) {
  const prod = await prisma.product.update({
    where: { id: productId },
    data: { status: 'PUBLISHED' },
    select: {
      id: true,
      title: true,
      status: true,
      retailPrice: true,
      imagesJson: true,
      createdAt: true,
    },
  });
  return prod;
}

export async function rejectProduct(productId: string) {
  const prod = await prisma.product.update({
    where: { id: productId },
    data: { status: 'REJECTED' },
    select: {
      id: true,
      title: true,
      status: true,
      retailPrice: true,
      imagesJson: true,
      createdAt: true,
    },
  });
  return prod;
}

/* ================================================================== */
/* =======================  NEW: Payments  ========================== */
/* ================================================================== */

export async function listPayments(q?: string): Promise<AdminPayment[]> {
  const where: Prisma.PaymentWhereInput = q
    ? {
      OR: [
        { id: { contains: q, mode: 'insensitive' } },
        { orderId: { contains: q, mode: 'insensitive' } },
        {
          order: {
            user: {
              email: { contains: q, mode: 'insensitive' },
            },
          },
        },
      ],
    }
    : {};

  const rows = await prisma.payment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      orderId: true,
      amount: true,
      status: true,
      provider: true,
      channel: true,
      createdAt: true,
      order: {
        select: {
          user: { select: { email: true } },
        },
      },
    },
  });

  return rows.map((r: any) => ({
    id: r.id,
    orderId: r.orderId,
    amount: r.amount,
    status: r.status,
    provider: r.provider,
    channel: r.channel,
    createdAt: r.createdAt,
    userEmail: r.order?.user?.email ?? null,
  }));
}

/* ================================================================== */
/* ===================  NEW: Ops / Security  ======================= */
/* ================================================================== */

export async function opsSnapshot(): Promise<{
  paymentProvider: string;
  backupsEnabled: boolean;
  securityEvents: Array<{ message: string; level: string; createdAt?: Date | string }>;
  commsUnitCost?: number;
  taxRatePct?: number;
}> {
  let paymentProvider = process.env.PAYMENT_PROVIDER || 'PAYSTACK';
  let backupsEnabled = false;
  let securityEvents: Array<{ message: string; level: string; createdAt?: Date | string }> = [];
  let commsUnitCost: number | undefined;
  let taxRatePct: number | undefined;

  try {
    const settings = await prisma.setting?.findMany?.({
      where: {
        key: {
          in: ['paymentProvider', 'backupsEnabled', 'commsUnitCost', 'taxRatePct'],
        },
      }, select: { key: true, value: true },
    });

    if (Array.isArray(settings)) {
      const map = new Map(settings.map((s: any) => [s.key, s.value]));
      paymentProvider = (map.get('paymentProvider') ?? paymentProvider) as string;
      const be = map.get('backupsEnabled');
      backupsEnabled = be === 'true' || be === true;

      const c = Number(map.get('commsUnitCost'));
      commsUnitCost = Number.isFinite(c) ? c : 0;

      const t = Number(map.get('taxRatePct'));
      taxRatePct = Number.isFinite(t) ? t : 0;
    }
  } catch {
    // ignore and use defaults
  }

  try {
    const securityEventClient = (prisma as any)["securityEvent"];
    if (securityEventClient?.findMany) {
      const events = await securityEventClient.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { message: true, level: true, createdAt: true },
      });
      if (Array.isArray(events)) securityEvents = events;
    }


  } catch {
    // ignore, return empty events
  }

  return { paymentProvider, backupsEnabled, securityEvents, commsUnitCost, taxRatePct };
}
