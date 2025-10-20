// api/src/services/admin.service.ts
import { Prisma } from '@prisma/client';
import type { Role } from '../types/role.js';
import { prisma } from '../lib/prisma.js';
import { startOfDay, addDays } from 'date-fns';

/* ------------------------------------------------------------------ */
/* Types returned by the service                                       */
/* ------------------------------------------------------------------ */

export type Overview = {
  totalUsers: number;
  totalSuperAdmins: number;
  totalAdmins: number;
  totalCustomers: number;

  productsPending: number;
  productsPublished: number;
  productsInStock: number;
  productsOutOfStock: number;
  productsTotal: number;

  ordersToday: number;
  revenueToday: number;

  sparklineRevenue7d: number[];
};

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

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export async function getOverview(): Promise<Overview> {
  // Users
  const [totalUsers,totalCustomers, totalAdmins, totalSuperAdmins] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'SHOPPER' } }),
    prisma.user.count({ where: { role: 'ADMIN' } }),
    prisma.user.count({ where: { role: 'SUPER_ADMIN' } }),
  ]);

  // Products (assuming status: | 'PUBLISHED' | 'REJECTED')
  const [productsPending, productsPublished, productsInStock, productsOutOfStock, productsTotal] = await Promise.all([
    prisma.product.count({ where: { status: 'PENDING' } }),
    prisma.product.count({ where: { status: 'PUBLISHED'} }),
    prisma.product.count({ where: { status: 'PUBLISHED', inStock: true } }),
    prisma.product.count({ where: { status: 'PUBLISHED', inStock: false } }),
  prisma.product.count({ where: {status: { not: 'REJECTED'}}}),

  ]);




  // Orders today
  const todayStart = startOfDay(new Date());
  const todayEnd = addDays(todayStart, 1);

  const ordersToday = await prisma.order.count({
    where: {
      createdAt: { gte: todayStart, lt: todayEnd },
      // optional: exclude canceled orders
      NOT: { status: 'CANCELED' }, // remove this line if you want all orders
    },
  });



  const today = new Date();
  const from = new Date(today); from.setHours(0, 0, 0, 0);
  const to = new Date(today); to.setHours(23, 59, 59, 999);




  const paidToday = await prisma.payment.aggregate({
    _sum: { amount: true as any },
    where: {
      status: 'PAID',
      paidAt: { gte: from, lte: to },   // ✅ use paidAt
    },
  });
  const revenueToday = Number(paidToday._sum ? paidToday._sum.amount : 0) || 0;


  // Revenue sparkline for last 7 full days (including today)
  const sparklineRevenue7d: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    const agg = await prisma.payment.aggregate({
      _sum: { amount: true as any },
      where: {
        status: 'PAID',
        createdAt: { gte: startOfDay(day), lte: endOfDay(day) },
      },
    });
    sparklineRevenue7d.push(Number(agg._sum.amount ?? 0) || 0);
  }

  return {
    totalUsers,
    totalSuperAdmins,
    totalAdmins,
    totalCustomers,
    productsPending,
    productsPublished,
    productsInStock,
    productsOutOfStock,
    productsTotal,
    ordersToday,
    revenueToday,
    sparklineRevenue7d,
  };
}

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
  shippingRate: number | string | null;
  backupsEnabled: boolean;
  securityEvents: Array<{ message: string; level: string; createdAt?: Date | string }>;
}> {
  let paymentProvider = process.env.PAYMENT_PROVIDER || 'PAYSTACK';
  let shippingRate: number | string | null = null;
  let backupsEnabled = false;
  let securityEvents: Array<{ message: string; level: string; createdAt?: Date | string }> = [];

  // Optional: a Settings table — if present, prefer its values
  try {
    const settings = await prisma.setting?.findMany?.({
      where: { key: { in: ['paymentProvider', 'shippingRate', 'backupsEnabled'] } },
      select: { key: true, value: true },
    });

    if (Array.isArray(settings)) {
      const map = new Map(settings.map((s: any) => [s.key, s.value]));
      paymentProvider = (map.get('paymentProvider') ?? paymentProvider) as string;
      const sr = map.get('shippingRate');
      shippingRate = sr != null ? sr : shippingRate;
      const be = map.get('backupsEnabled');
      backupsEnabled = be === 'true' || be === true;
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

  return { paymentProvider, shippingRate, backupsEnabled, securityEvents };
}

/* ================================================================== */
/* =======================  NEW: Coupons  =========================== */
/* ================================================================== */

/**
 * Create a coupon/discount code.
 * Expects a Coupon model with fields: code (unique), pct (Int), maxUses (Int), usedCount (Int), status (String), createdAt (DateTime)
 * If you don't have one yet, you can add it in Prisma and migrate.
 */
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
    // Fallback: if the table doesn't exist, produce a clear message
    if (err?.code === 'P2021' || /prisma\.coupon/i.test(String(err))) {
      throw new Error('Coupon model not found. Please add a Coupon model to your Prisma schema.');
    }
    throw err;
  }
}

