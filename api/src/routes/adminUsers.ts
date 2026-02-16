// api/src/routes/adminUsers.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { Prisma } from "@prisma/client";

const router = Router();

/* ----------------------------- role helpers ----------------------------- */
function normRoleStr(r: unknown): string {
  let s = String(r ?? "").trim().toUpperCase();
  s = s.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
  if (s === "SUPERADMIN") s = "SUPER_ADMIN";
  if (s === "SUPER_ADMINISTRATOR") s = "SUPER_ADMIN";
  if (s === "SUPERUSER") s = "SUPER_USER";
  return s;
}

/** Minimal admin guard (use your existing requireAdmin if you have one) */
function requireAdmin(req: any, res: any, next: any) {
  const role = normRoleStr(req?.user?.role);
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

router.use(requireAuth);
router.use(requireAdmin);

/* ------------------------- Prisma schema-safe picks ------------------------- */
/**
 * This prevents "Unknown field X" crashes when your Prisma schema changes.
 * We filter selects/filters to only fields that exist in the model.
 */
const MODEL_FIELDS = new Map<string, Set<string>>();

function getModelFieldSet(modelName: string): Set<string> {
  const cached = MODEL_FIELDS.get(modelName);
  if (cached) return cached;

  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  const set = new Set<string>(
    (model?.fields ?? [])
      .filter((f) => f.kind === "scalar" || f.kind === "enum")
      .map((f) => f.name)
  );

  MODEL_FIELDS.set(modelName, set);
  return set;
}

function pickSelect(modelName: string, desired: Record<string, boolean>) {
  const fields = getModelFieldSet(modelName);
  const out: Record<string, boolean> = {};
  for (const k of Object.keys(desired)) {
    if (fields.has(k)) out[k] = true;
  }
  return out;
}

function hasField(modelName: string, field: string) {
  return getModelFieldSet(modelName).has(field);
}

/* ------------------------------ routes ------------------------------ */

/**
 * GET /api/admin/users?q=...&limit=...
 * Also supports: ?search=, ?query=, ?keyword= for UI compatibility.
 *
 * Small helper for picking a user to impersonate.
 */
async function handleUserSearch(req: any, res: any) {
  const qRaw =
    String(req.query.q ?? "").trim() ||
    String(req.query.search ?? "").trim() ||
    String(req.query.query ?? "").trim() ||
    String(req.query.keyword ?? "").trim();

  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20) || 20));

  const q = qRaw.trim();

  // Build OR filters only for fields that exist
  let where: any = undefined;
  if (q.length > 0) {
    const OR: any[] = [];

    // id exact match (assumed always exists)
    OR.push({ id: q });

    if (hasField("User", "email")) OR.push({ email: { contains: q, mode: "insensitive" as const } });
    if (hasField("User", "firstName")) OR.push({ firstName: { contains: q, mode: "insensitive" as const } });
    if (hasField("User", "lastName")) OR.push({ lastName: { contains: q, mode: "insensitive" as const } });
    // optional field in some schemas
    if (hasField("User", "displayName")) OR.push({ displayName: { contains: q, mode: "insensitive" as const } });

    where = { OR };
  }

  const select = pickSelect("User", {
    id: true,
    email: true,
    role: true,
    firstName: true,
    lastName: true,
    displayName: true, // auto-removed if not in your schema ✅
    createdAt: true,
    status: true,
  });

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: select as any,
  });

  res.json({ data: users });
}

router.get("/users", async (req, res, next) => {
  try {
    await handleUserSearch(req, res);
  } catch (e) {
    next(e);
  }
});

// UI fallback endpoint your dashboard tries: /api/admin/users/search?q=...
router.get("/users/search", async (req, res, next) => {
  try {
    await handleUserSearch(req, res);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/admin/users/:userId
 * Read-only profile fetch for impersonation view.
 */
router.get("/users/:userId", async (req, res, next) => {
  try {
    const userId = String(req.params.userId);

    const select = pickSelect("User", {
      id: true,
      email: true,
      role: true,
      firstName: true,
      lastName: true,
      displayName: true, // auto-removed if not in schema ✅
      phone: true,
      createdAt: true,
      joinedAt: true,
      status: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      dob: true,
      address: true,
      shippingAddress: true,
      language: true,
      theme: true,
      currency: true,
      productInterests: true,
      notificationPrefs: true,
    });

    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: select as any,
    });

    if (!u) return res.status(404).json({ error: "User not found" });

    // shape it to match your MeResponse-ish expectations
    res.json({
      id: (u as any).id,
      email: (u as any).email,
      role: (u as any).role,
      firstName: (u as any).firstName ?? null,
      lastName: (u as any).lastName ?? null,
      displayName: (u as any).displayName ?? null, // will just be null if not selected/doesn't exist
      phone: (u as any).phone ?? null,
      joinedAt: ((u as any).joinedAt ?? (u as any).createdAt) ?? null,
      status: (u as any).status ?? null,
      emailVerified: Boolean((u as any).emailVerifiedAt),
      phoneVerified: Boolean((u as any).phoneVerifiedAt),
      dob: (u as any).dob ?? null,
      address: (u as any).address ?? null,
      shippingAddress: (u as any).shippingAddress ?? null,
      language: (u as any).language ?? null,
      theme: (u as any).theme ?? null,
      currency: (u as any).currency ?? null,
      productInterests: Array.isArray((u as any).productInterests) ? (u as any).productInterests : undefined,
      notificationPrefs: (u as any).notificationPrefs ?? null,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/admin/users/:userId/orders?limit=...
 * Read-only orders list for impersonation view.
 */
router.get("/users/:userId/orders", async (req, res, next) => {
  try {
    const userId = String(req.params.userId);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20) || 20));

    const orders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        status: true,
        total: true,
        items: {
          select: {
            id: true,
            productId: true,
            title: true,
            quantity: true,
          },
        },
      } as any,
    });

    res.json({ data: orders });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/admin/users/:userId/orders/summary
 */
router.get("/users/:userId/orders/summary", async (req, res, next) => {
  try {
    const userId = String(req.params.userId);

    const [ordersCount, paidAgg, recent] = await Promise.all([
      prisma.order.count({ where: { userId } }),
      prisma.order.aggregate({
        where: { userId, status: { in: ["PAID", "COMPLETED"] } as any },
        _sum: { total: true },
      } as any),
      prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, status: true, total: true, createdAt: true } as any,
      }),
    ]);

    res.json({
      ordersCount,
      totalSpent: Number((paidAgg as any)?._sum?.total ?? 0),
      recent,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/admin/users/:userId/payments/recent?limit=...
 * Read-only payment-ish feed (works if you have Payment model related to Order).
 */
router.get("/users/:userId/payments/recent", async (req, res, next) => {
  try {
    const userId = String(req.params.userId);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10) || 10));

    // Payment -> Order(userId)
    const rows = await prisma.payment.findMany({
      where: { order: { userId } } as any,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        reference: true,
        status: true,
        channel: true,
        provider: true,
        createdAt: true,
        paidAt: true,
        amount: true,
        orderId: true,
        order: { select: { id: true, createdAt: true, status: true, total: true } },
      } as any,
    });

    // Shape to match your RecentTransaction mapping expectations
    const data = rows.map((p: any) => ({
      orderId: String(p.orderId ?? p.order?.id ?? ""),
      createdAt: String(p.paidAt ?? p.createdAt ?? p.order?.createdAt ?? new Date().toISOString()),
      total: Number(p.order?.total ?? p.amount ?? 0),
      orderStatus: String(p.order?.status ?? p.status ?? "PENDING"),
      payment: {
        id: String(p.id),
        reference: p.reference ?? null,
        status: String(p.status ?? "PENDING"),
        channel: p.channel ?? null,
        provider: p.provider ?? null,
        createdAt: String(p.createdAt ?? new Date().toISOString()),
      },
    }));

    res.json({ data });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/users/:userId/payments/summary
router.get("/users/:userId/payments/summary", async (req, res, next) => {
  try {
    const userId = String(req.params.userId);

    // 1) Pull recent payments for the user's orders (no enum filter)
    const rows = await prisma.payment.findMany({
      where: { order: { userId } } as any,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        amount: true,
        orderId: true,
        order: { select: { total: true } },
      } as any,
      take: 500, // prevent huge scans; adjust if needed
    });

    // 2) Decide what counts as "paid"
    // Keep this list tight to values you *actually* store.
    // From your UI screenshot you definitely have "PAID".
    const PAID_LIKE = new Set([
      "PAID",
      "SUCCESS",
      "SUCCESSFUL",
      "COMPLETED",
      "DONE",
    ]);

    // 3) Sum DISTINCT orders with at least one paid-like payment
    // (prevents double counting retries)
    const seenOrders = new Set<string>();
    let total = 0;

    for (const p of rows as any[]) {
      const st = String(p.status ?? "").toUpperCase().trim();
      if (!PAID_LIKE.has(st)) continue;

      const oid = String(p.orderId ?? "");
      if (!oid || seenOrders.has(oid)) continue;
      seenOrders.add(oid);

      total += Number(p?.order?.total ?? p?.amount ?? 0) || 0;
    }

    // 4) Fallback: if no paid-like payments found, derive from orders using "paid-like" order statuses
    // This solves your exact case where Order is AWAITING_FULFILLMENT but payment is PAID,
    // and also covers environments where payments are not persisted.
    if (!Number.isFinite(total) || total <= 0) {
      const PAID_LIKE_ORDER_STATUSES = [
        "PAID",
        "COMPLETED",
        "AWAITING_FULFILLMENT",
        "PROCESSING",
        "SHIPPED",
        "DELIVERED",
      ];

      const agg = await prisma.order.aggregate({
        where: { userId, status: { in: PAID_LIKE_ORDER_STATUSES as any } } as any,
        _sum: { total: true },
      } as any);

      total = Number((agg as any)?._sum?.total ?? 0);
    }

    return res.json({
      totalPaid: total,
      totalPaidNgn: total,
    });
  } catch (e) {
    next(e);
  }
});



export default router;
