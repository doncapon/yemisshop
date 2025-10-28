// api/src/services/admin.service.ts
import { Prisma, PrismaClient, PaymentStatus } from '@prisma/client';
import type { Role } from '../types/role.js';
import { prisma } from '../lib/prisma.js';
import { startOfDay, addDays } from 'date-fns';

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
  price: Prisma.Decimal | number | string;
  status: string;
  imagesJson?: string[];
  createdAt?: Date | string;
};

export type AdminPayment = {
  id: string;
  orderId: string;
  userEmail?: string | null;
  amount: Prisma.Decimal | number | string;
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
  gatewayFees: number;
  taxCollected: number;
  commsNet: number;
  grossProfit: number;
};

export async function computeProfitForWindow(prismaArg: PrismaClient, from: Date, to: Date): Promise<ProfitBreakdown> {
  const prisma = prismaArg || ({} as PrismaClient);

  // Pull paid/refunded payments in the window (with createdAt fallback)
  const payments = await prisma.payment.findMany({
    where: {
      OR: [
        {
          status: { in: [PaymentStatus.PAID] },
          OR: [
            { paidAt: { gte: from, lte: to } },
            { paidAt: null, createdAt: { gte: from, lte: to } },
          ],
        },
        {
          status: { in: [PaymentStatus.REFUNDED] },
          OR: [
            { refundedAt: { gte: from, lte: to } },
            { refundedAt: null, createdAt: { gte: from, lte: to } },
          ],
        },
      ],
    },
    select: { status: true, amount: true, feeAmount: true, orderId: true },
  });

  let revenuePaid = 0, refunds = 0, gatewayFees = 0;
  const paidByOrder = new Map<string, number>();
  const refundedByOrder = new Map<string, number>();

  for (const p of payments) {
    if (p.status === PaymentStatus.PAID) {
      revenuePaid += N(p.amount);
      gatewayFees += N(p.feeAmount);
      if (p.orderId) paidByOrder.set(p.orderId, N(paidByOrder.get(p.orderId)) + N(p.amount));
    } else if (p.status === PaymentStatus.REFUNDED) {
      refunds += N(p.amount);
      if (p.orderId) refundedByOrder.set(p.orderId, N(refundedByOrder.get(p.orderId)) + N(p.amount));
    }
  }
  const revenueNet = revenuePaid - refunds;

  // For pro-rating tax/serviceFee, fetch the impacted orders
  const orderIds = Array.from(new Set([...paidByOrder.keys(), ...refundedByOrder.keys()]));

  const effectiveFactorFor = (orderTotal: number, orderId: string) => {
    const paid = N(paidByOrder.get(orderId));
    const refunded = N(refundedByOrder.get(orderId));
    return orderTotal > 0 ? Math.max(0, Math.min(1, (paid - refunded) / orderTotal)) : 0;
  };

  // Tax collected (pass-through; net of refunds)
  let taxCollected = 0;
  if (orderIds.length) {
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, tax: true, total: true },
    });
    for (const o of orders) {
      const factor = effectiveFactorFor(N(o.total), o.id);
      taxCollected += N(o.tax) * factor;
    }
  }

  // Comms: sum actual OrderComms within the window (preferred)
  const commsRows = await prisma.orderComms.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { amount: true },
  });
  let commsNet = commsRows.reduce((s, r) => s + N(r.amount), 0);

  // Fallback: if you haven't logged OrderComms yet, use pro-rated serviceFee
  if (commsRows.length === 0 && orderIds.length) {
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, total: true, serviceFee: true },
    });
    for (const o of orders) {
      const factor = effectiveFactorFor(N(o.total), o.id);
      commsNet += N(o.serviceFee) * factor;
    }
  }

  const grossProfit = commsNet - gatewayFees;

  return { revenuePaid, refunds, revenueNet, gatewayFees, taxCollected, commsNet, grossProfit };
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

    prisma.product.count({
      where: { status: 'PUBLISHED' as any, AND: [variantAwareAvailable, anyActiveOffer] },
    }),

    prisma.product.count({ where: { ProductVariant: { some: {} } } }),
    prisma.product.count({ where: { ProductVariant: { none: {} } } }),

    // base (non-variant-aware) stock among published
    prisma.product.count({ where: { status: 'PUBLISHED' as any, inStock: true } }),
    prisma.product.count({ where: { status: 'PUBLISHED' as any, inStock: false } }),
  ]);

  const productsOffline = Math.max(0, productsPublished - productsLive);

  // Users
  const [totalUsers, totalCustomers, totalAdmins, totalSuperAdmins] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'SHOPPER' } }),
    prisma.user.count({ where: { role: 'ADMIN' } }),
    prisma.user.count({ where: { role: 'SUPER_ADMIN' } }),
  ]);

  // Orders today
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const ordersToday = await prisma.order.count({
    where: { createdAt: { gte: todayStart, lte: todayEnd }, NOT: { status: 'CANCELED' } },
  });


  // Sparklines (7d)
  const sparklineRevenue7d: number[] = [];
  const sparklineProfit7d: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const { revenueNet: rev, grossProfit: gp } = await computeProfitForWindow(
      prisma,
      startOfDay(d),
      endOfDay(d),
    );
    sparklineRevenue7d.push(rev);
    sparklineProfit7d.push(gp);
  }

  // Whatever you already compute (examples shown; keep yours)
  const [
    ordersCount,
    usersCount,
    revenueTodayAgg,
    profitEventsToday,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.user.count(),
    prisma.payment.aggregate({
      _sum: { amount: true },
      where: { status: 'PAID', paidAt: { gte: todayStart } },
    }),
    prisma.paymentEvent.findMany({
      where: { type: 'PROFIT_COMPUTED', createdAt: { gte: todayStart } },
      select: { data: true },
    }),
  ]);

  // Sum profit from JSON payloads
  const profitToday = profitEventsToday.reduce((sum: number, ev: any) => {
    const p = Number((ev as any).data?.profit ?? 0);
    return Number.isFinite(p) ? sum + p : sum;
  }, 0);

  const revenueToday = Number(revenueTodayAgg._sum.amount || 0);

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
// --- helpers (top of file, once) ---
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
// Variant-aware & offer-aware filters (use your relation names)
const noActiveOffer = {
  AND: [
    { supplierOffers: { none: { isActive: true, inStock: true } } },
    { ProductVariant: { none: { offers: { some: { isActive: true, inStock: true } } } } },
  ],
} as const;

const variantAwareAvailable: Prisma.ProductWhereInput = {
  OR: [
    { inStock: true },
    { ProductVariant: { some: { inStock: true } } },
  ],
};

const anyOffer: Prisma.ProductWhereInput = {
  // any SupplierOffer attached to the product (includes variant-specific offers)
  supplierOffers: { some: {} },
};

const noOffer: Prisma.ProductWhereInput = {
  supplierOffers: { none: {} },
};

const anyActiveOffer: Prisma.ProductWhereInput = {
  supplierOffers: { some: { isActive: true, inStock: true } },
};

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export async function findUsers(q?: string): Promise<AdminUser[]> {
  const where: Prisma.UserWhereInput = q
    ? {
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        // allow role search by string
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
  };
  products: {
    offline: number;
    total: number;
    pending: number;
    rejected: number;
    published: number;         // approval state
    live: number;              // published & available (variant-aware) & active offers
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
 * We’ll set `status` to 'SUSPENDED'. Frontend union allows custom strings.
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
 * Suspend / deactivate a user.
 * We’ll set `status` to 'SUSPENDED'. Frontend union allows custom strings.
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

/**
 * Mark a payment as PAID.
 * Also opportunistically set the parent order status to PAID.
 * (If you track multi-payment totals, you may want to sum and compare.)
 */
export async function markPaymentPaid(paymentId: string) {
  const payment = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'PAID', paidAt: new Date() },   // ✅
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


/**
 * Mark a payment as REFUNDED.
 * If you want to adjust order status automatically, you can set:
 *  - 'CANCELED' if all payments are refunded/failed
 */
export async function markPaymentRefunded(paymentId: string) {
  const payment = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'REFUNDED' },
    select: { id: true, orderId: true, status: true, amount: true },
  });

  // Optional: If no PAID payments remain for this order, mark order as CANCELED
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

/** List products pending review, optional search by title. */
export async function pendingProducts(q?: string): Promise<AdminProduct[]> {
  const where: Prisma.ProductWhereInput = {
    status: 'PENDING',
    ...(q
      ? { title: { contains: q, mode: 'insensitive' } }
      : {}),
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

/** Approve a pending product -> PUBLISHED. */
export async function approveProduct(productId: string) {
  const prod = await prisma.product.update({
    where: { id: productId },
    data: { status: 'PUBLISHED' },
    select: {
      id: true, title: true, status: true, price: true, imagesJson: true, createdAt: true,
    },
  });
  return prod;
}

/** Reject a pending product -> REJECTED. */
export async function rejectProduct(productId: string) {
  const prod = await prisma.product.update({
    where: { id: productId },
    data: { status: 'REJECTED' },
    select: {
      id: true, title: true, status: true, price: true, imagesJson: true, createdAt: true,
    },
  });
  return prod;
}

/* ================================================================== */
/* =======================  NEW: Payments  ========================== */
/* ================================================================== */

/**
 * List payments with optional query:
 * - matches payment id OR order id OR user email (via order.user)
 */
export async function listPayments(q?: string): Promise<AdminPayment[]> {
  // Build where:
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

  return rows.map((r: { id: any; orderId: any; amount: any; status: any; provider: any; channel: any; createdAt: any; order: { user: { email: any; }; }; }) => ({
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

/**
 * Snapshot platform config & last security events.
 * Tries optional tables: Setting, SecurityEvent. Falls back gracefully.
 */
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





  // Optional: a Settings table — if present, prefer its values
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

  // Optional: SecurityEvent table
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