// api/src/services/admin.service.ts
import { PrismaClient, $Enums } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import type { Role } from '../types/role.js';
import { prisma } from '../lib/prisma.js';
import { startOfDay, addDays } from 'date-fns';
import { Decimal } from '@prisma/client/runtime/binary';
import { DateTime } from 'luxon';

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
  price: Decimal | number | string;
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

// ----------------------------------------------------------------------------

const N = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

type ProfitBreakdown = {
  revenuePaid: number;
  refunds: number;
  revenueNet: number;

  // costs
  gatewayFees: number;

  // informational
  taxCollected: number;

  // platform fee revenue (excluding gateway fee)
  commsNet: number;

  // ✅ NEW: product margin net (retail - supplier) pro-rated for refunds
  marginNet: number;

  // ✅ FIXED: platform gross profit (margin + platform fees - gateway fees)
  grossProfit: number;
};

export async function computeProfitForWindow(
  prismaClient: PrismaClient,
  from: Date,
  to: Date,
  mode: "cashflow" | "sales" = "cashflow"
): Promise<ProfitBreakdown> {
  const N = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  // ----------------------------
  // window scoping
  // ----------------------------
  let scopedOrderIds: string[] | null = null;

  if (mode === "sales") {
    const ordersInWindow = await prismaClient.order.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { id: true },
    });
    scopedOrderIds = ordersInWindow.map((o) => o.id);
    if (!scopedOrderIds.length) {
      return {
        revenuePaid: 0,
        refunds: 0,
        revenueNet: 0,
        gatewayFees: 0,
        taxCollected: 0,
        commsNet: 0,
        marginNet: 0,
        grossProfit: 0,
      };
    }
  }

  // ----------------------------
  // PAYMENTS: revenue/refunds/fees
  // ----------------------------
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
    select: { status: true, amount: true, feeAmount: true, orderId: true },
  });

  let revenuePaid = 0;
  let refunds = 0;
  let gatewayFees = 0;

  const paidByOrder = new Map<string, number>();
  const refundedByOrder = new Map<string, number>();

  for (const p of payments) {
    const amt = N(p.amount);
    const fee = N(p.feeAmount);

    if (p.status === $Enums.PaymentStatus.PAID) {
      revenuePaid += amt;
      gatewayFees += fee;
      if (p.orderId) paidByOrder.set(p.orderId, N(paidByOrder.get(p.orderId)) + amt);
    } else {
      refunds += amt;
      if (p.orderId) refundedByOrder.set(p.orderId, N(refundedByOrder.get(p.orderId)) + amt);
    }
  }

  const revenueNet = revenuePaid - refunds;

  const orderIds = Array.from(new Set([...paidByOrder.keys(), ...refundedByOrder.keys()]));

  const effectiveFactorFor = (orderTotal: number, orderId: string) => {
    const paid = N(paidByOrder.get(orderId));
    const refunded = N(refundedByOrder.get(orderId));
    if (orderTotal <= 0) return 0;
    const ratio = (paid - refunded) / orderTotal;
    return Math.max(0, Math.min(1, ratio));
  };

  // ----------------------------
  // TAX (informational)
  // ----------------------------
  let taxCollected = 0;
  if (orderIds.length) {
    const orders = await prismaClient.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, tax: true, total: true },
    });

    for (const o of orders) {
      const f = effectiveFactorFor(N(o.total), o.id);
      taxCollected += N(o.tax) * f;
    }
  }

  // ----------------------------
  // COMMS (platform fee revenue, exclude gateway)
  // ✅ single-source: orderComms if it exists, else fallback to serviceFeeBase+serviceFeeComms
  // ----------------------------
  let commsNet = 0;

  // Try orderComms first
  let commsRows: Array<{ amount: any; orderId?: string | null }> = [];
  try {
    commsRows = await prismaClient.orderComms.findMany({
      where: {
        ...(mode === "sales"
          ? { orderId: { in: scopedOrderIds! } }
          : { createdAt: { gte: from, lte: to } }),
      },
      select: { amount: true, orderId: true },
    });
  } catch {
    commsRows = [];
  }

  if (commsRows.length) {
    // If refunds exist, pro-rate per order using effective factor (only if orderId present)
    if (refunds > 0 && orderIds.length) {
      // build order totals map once
      const totals = await prismaClient.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, total: true },
      });
      const totalById = new Map(totals.map((o) => [o.id, N(o.total)]));

      for (const r of commsRows) {
        const oid = String(r.orderId || "");
        if (!oid) continue;
        const f = effectiveFactorFor(N(totalById.get(oid)), oid);
        commsNet += N(r.amount) * f;
      }
    } else {
      // no refunds -> just sum
      commsNet = commsRows.reduce((s, r) => s + N(r.amount), 0);
    }
  } else if (orderIds.length) {
    // fallback: serviceFeeBase + serviceFeeComms pro-rated
    const svcOrders = await prismaClient.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        total: true,
        serviceFeeBase: true,
        serviceFeeComms: true,
        serviceFeeGateway: true,
        serviceFeeTotal: true,
      } as any,
    });

    for (const o of svcOrders as any[]) {
      const f = effectiveFactorFor(N(o.total), String(o.id));
      if (f <= 0) continue;

      const base = N(o.serviceFeeBase);
      const comms = N(o.serviceFeeComms);

      if (base !== 0 || comms !== 0) {
        commsNet += (base + comms) * f;
      } else {
        const totalFee = N(o.serviceFeeTotal);
        const gw = N(o.serviceFeeGateway);
        if (totalFee !== 0) commsNet += Math.max(0, totalFee - Math.max(0, gw)) * f;
      }
    }
  }

  // ----------------------------
  // MARGIN (retail - supplier cost)
  // ✅ retail: item.unitPrice (what customer paid per unit)
  // ✅ cost: chosenSupplierUnitPrice ONLY IF > 0 else treat as unknown => 0 contribution (not negative)
  // ----------------------------
  let marginNet = 0;

  if (orderIds.length) {
    const ordersWithItems = await prismaClient.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        total: true,
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            chosenSupplierUnitPrice: true,
          },
        },
      } as any,
    });

    for (const o of ordersWithItems as any[]) {
      const oid = String(o.id);
      const f = effectiveFactorFor(N(o.total), oid);
      if (f <= 0) continue;

      const items: any[] = Array.isArray(o.items) ? o.items : [];

      for (const it of items) {
        const qty = Math.max(0, N(it.quantity ?? 1));
        if (qty <= 0) continue;

        const retail = N(it.unitPrice);
        const supplierCost = N(it.chosenSupplierUnitPrice);

        // if cost is missing/0, we cannot compute margin reliably -> skip
        if (supplierCost <= 0 || retail <= 0) continue;

        const perUnitMargin = retail - supplierCost;

        // log genuine negative margins for data inspection
        if (perUnitMargin < 0) {
          console.warn("NEG_MARGIN_ITEM", {
            orderId: oid,
            qty,
            retail,
            supplierCost,
            perUnitMargin,
            loss: perUnitMargin * qty,
          });
        }

        marginNet += perUnitMargin * qty * f;
      }
    }
  }

  // ----------------------------
  // PROFIT
  // ----------------------------
  const grossProfit = marginNet + commsNet - gatewayFees;

  return {
    revenuePaid,
    refunds,
    revenueNet,
    gatewayFees,
    taxCollected,
    commsNet,
    marginNet,
    grossProfit,
  };
}


export async function getOverview(): Promise<Overview> {
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
  const TZ = "Africa/Lagos";
  const nowLagos = DateTime.now().setZone(TZ);
  const todayStartUtc = nowLagos.startOf("day").toUTC().toJSDate();
  const todayEndUtc = nowLagos.endOf("day").toUTC().toJSDate();

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
    const dayLagos = nowLagos.minus({ days: i });
    const fromUtc = dayLagos.startOf("day").toUTC().toJSDate();
    const toUtc = dayLagos.endOf("day").toUTC().toJSDate();

    const { revenueNet: rev, grossProfit: gp } = await computeProfitForWindow(prisma, fromUtc, toUtc);
    sparklineRevenue7d.push(rev);
    sparklineProfit7d.push(gp);
  }

  // ✅ RevenueToday + ProfitToday from the SAME function
  const todayBreakdown = await computeProfitForWindow(prisma, todayStartUtc, todayEndUtc);

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

export async function createCoupon(args: { code: string; pct: number; maxUses: number }) {
  const code = args.code.trim().toUpperCase();
  if (!code) throw new Error('Coupon code is required');
  if (args.pct < 1 || args.pct > 90) throw new Error('Percent must be between 1 and 90');
  if (args.maxUses < 1) throw new Error('Max uses must be at least 1');

  try {
    const created = await prisma.coupon.create({
      data: {
        code,
        pct: Math.round(args.pct),
        maxUses: Math.round(args.maxUses),
        usedCount: 0,
        status: 'ACTIVE',
      },
      select: { id: true, code: true, pct: true, maxUses: true, usedCount: true, status: true, createdAt: true },
    });
    return created;
  } catch (err: any) {
    if (err?.code === 'P2021' || /prisma\.coupon/i.test(String(err))) {
      throw new Error('Coupon model not found. Please add a Coupon model to your Prisma schema.');
    }
    throw err;
  }
}

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
      price: true,
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
      price: true,
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
      price: true,
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
      where: { key: { in: ['paymentProvider', 'backupsEnabled'] } },
      select: { key: true, value: true },
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
    const events = await prisma.securityEvent?.findMany?.({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { message: true, level: true, createdAt: true },
    });
    if (Array.isArray(events)) {
      securityEvents = events;
    }
  } catch {
    // ignore, return empty events
  }

  return { paymentProvider, backupsEnabled, securityEvents, commsUnitCost, taxRatePct };
}
