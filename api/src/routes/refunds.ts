// api/src/routes/refunds.ts
// api/src/routes/adminRefunds.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyMany, notifyUser } from "../services/notifications.service.js";
import { requiredString } from "../lib/http.js";
import { syncProductInStockCacheTx } from "../services/inventory.service.js";
import { recomputeProductStockTx } from "../services/stockRecalc.service.js";
import { Prisma } from "@prisma/client";

const router = Router();

function normRole(r?: string) {
  return String(r || "").toUpperCase();
}

function normStr(v: any) {
  return String(v ?? "").trim();
}

function toDecimal(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return new Prisma.Decimal(0);
  return new Prisma.Decimal(n);
}

function sumOrderItems(orderItems: Array<{ unitPrice: any; quantity: number }>) {
  let itemsAmount = new Prisma.Decimal(0);
  for (const it of orderItems) {
    const price = toDecimal(it.unitPrice);
    const qty = new Prisma.Decimal(Number(it.quantity || 0));
    itemsAmount = itemsAmount.plus(price.mul(qty));
  }
  return itemsAmount;
}

/** PO status helpers (safe string-based to avoid enum mismatch at runtime) */
function poStatusUpper(v: any) {
  return String(v ?? "").toUpperCase();
}

function toPositiveInt(value: any, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return v > 0 ? v : fallback;
}

/**
 * GET /api/refunds
 *
 * Admin:
 * - sees all refunds
 * - supports q, status, page, pageSize
 *
 * Shopper:
 * - sees only refunds where requestedByUserId = actorId
 *
 * Supplier:
 * - sees only refunds for their supplierId
 *
 * Query:
 * - q: optional search by orderId, purchaseOrderId, supplierId, providerReference
 * - status: optional RefundStatus
 * - page, pageSize
 *
 * Backward compatibility:
 * - still accepts take, skip
 */
router.get("/", requireAuth, async (req: any, res) => {
  const actorId = normStr(req.user?.id);
  const role = normRole(req.user?.role);

  if (!actorId) return res.status(401).json({ error: "Unauthorized" });

  const q = normStr(req.query.q).toLowerCase();
  const status = normStr(req.query.status).toUpperCase();

  const pageRaw = req.query.page;
  const pageSizeRaw = req.query.pageSize;

  const hasPageMode = pageRaw !== undefined || pageSizeRaw !== undefined;

  const page = hasPageMode ? toPositiveInt(pageRaw, 1) : 1;
  const pageSize = Math.min(100, toPositiveInt(pageSizeRaw, 20));

  const take = hasPageMode
    ? pageSize
    : Math.min(100, Math.max(1, Number(req.query.take ?? 50)));

  const skip = hasPageMode
    ? (page - 1) * pageSize
    : Math.max(0, Number(req.query.skip ?? 0));

  const resolvedPage = hasPageMode ? page : Math.floor(skip / Math.max(1, take)) + 1;
  const resolvedPageSize = hasPageMode ? pageSize : take;

  const where: any = {};

  if (status) {
    where.status = status;
  }

  if (isAdmin(role)) {
    if (q) {
      where.OR = [
        { orderId: { contains: q, mode: "insensitive" } },
        { purchaseOrderId: { contains: q, mode: "insensitive" } },
        { supplierId: { contains: q, mode: "insensitive" } },
        { providerReference: { contains: q, mode: "insensitive" } },
      ];
    }
  } else if (role === "SUPPLIER") {
    const supplier = await prisma.supplier.findFirst({
      where: { userId: actorId },
      select: { id: true },
    });

    if (!supplier?.id) {
      return res.status(403).json({ error: "Supplier account not found" });
    }

    where.supplierId = supplier.id;

    if (q) {
      where.AND = [
        { supplierId: supplier.id },
        {
          OR: [
            { orderId: { contains: q, mode: "insensitive" } },
            { purchaseOrderId: { contains: q, mode: "insensitive" } },
            { providerReference: { contains: q, mode: "insensitive" } },
          ],
        },
      ];
      delete where.supplierId;
    }
  } else {
    // shopper / normal user
    where.requestedByUserId = actorId;

    if (q) {
      where.AND = [
        { requestedByUserId: actorId },
        {
          OR: [
            { orderId: { contains: q, mode: "insensitive" } },
            { purchaseOrderId: { contains: q, mode: "insensitive" } },
            { providerReference: { contains: q, mode: "insensitive" } },
          ],
        },
      ];
      delete where.requestedByUserId;
    }
  }

  const [rows, total] = await Promise.all([
    prisma.refund.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: {
        order: {
          select: {
            id: true,
            userId: true,
            status: true,
            createdAt: true,
            total: true,
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            status: true,
            payoutStatus: true,
            supplierId: true,
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
            userId: true,
          },
        },
        requestedBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        adminResolvedBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        items: {
          include: {
            orderItem: {
              select: {
                id: true,
                title: true,
                quantity: true,
                unitPrice: true,
                lineTotal: true,
              },
            },
          },
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 8,
        },
      },
    }),
    prisma.refund.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, resolvedPageSize)));

  return res.json({
    ok: true,
    data: rows,
    meta: {
      total,
      page: resolvedPage,
      pageSize: resolvedPageSize,
      totalPages,
      take,
      skip,
      role,
    },
  });
});


function uniqStrings(values: any[]): string[] {
  return Array.from(
    new Set(
      (values || [])
        .map((v) => String(v ?? "").trim())
        .filter(Boolean)
    )
  );
}

function isRefundOpenStatus(status: any) {
  const s = String(status ?? "").toUpperCase();
  return [
    "REQUESTED",
    "SUPPLIER_REVIEW",
    "SUPPLIER_ACCEPTED",
    "SUPPLIER_REJECTED",
    "ESCALATED",
    "APPROVED",
    "PROCESSING",
  ].includes(s);
}

function pickRefundReason(body: any) {
  return normStr(
    body?.reason ??
      body?.refundReason ??
      body?.message ??
      body?.note ??
      body?.description
  );
}

function pickRefundItemIds(body: any): string[] {
  const direct = Array.isArray(body?.itemIds) ? body.itemIds : [];
  const orderItemIds = Array.isArray(body?.orderItemIds) ? body.orderItemIds : [];
  const itemsFromObjects = Array.isArray(body?.items)
    ? body.items.map((x: any) => x?.orderItemId ?? x?.id)
    : [];

  return uniqStrings([...direct, ...orderItemIds, ...itemsFromObjects]);
}

function pickRefundPurchaseOrderId(body: any) {
  return normStr(body?.purchaseOrderId ?? body?.poId ?? "");
}

async function createCustomerRefundRequestTx(
  tx: any,
  args: {
    actorId: string;
    role: string;
    body: any;
  }
) {
  const actorId = normStr(args.actorId);
  const role = normRole(args.role);
  const body = args.body ?? {};

  if (!actorId) throw new Error("Unauthorized");
  if (role === "SUPPLIER" || isAdmin(role)) {
    throw new Error("Only customers can create refund requests here.");
  }

  const orderId = normStr(body?.orderId);
  if (!orderId) throw new Error("Missing orderId");

  const reason = pickRefundReason(body);
  if (!reason) throw new Error("Please provide a refund reason.");

  const requestedPurchaseOrderId = pickRefundPurchaseOrderId(body);
  const requestedItemIds = pickRefundItemIds(body);

  const order = await tx.order.findFirst({
    where: { id: orderId, userId: actorId },
    select: {
      id: true,
      userId: true,
      status: true,
      total: true,
      items: {
        select: {
          id: true,
          title: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
          orderId: true,
          chosenSupplierId: true,
        },
      },
      purchaseOrders: {
        select: {
          id: true,
          supplierId: true,
          status: true,
          payoutStatus: true,
        },
      },
    },
  });

  if (!order) {
    throw new Error("Order not found.");
  }

  const allOrderItems = Array.isArray(order.items) ? order.items : [];
  if (!allOrderItems.length) {
    throw new Error("This order has no refundable items.");
  }

  let selectedOrderItems = allOrderItems;

  if (requestedItemIds.length) {
    selectedOrderItems = allOrderItems.filter((it: any) =>
      requestedItemIds.includes(String(it.id))
    );

    if (!selectedOrderItems.length) {
      throw new Error("Selected refund items were not found on this order.");
    }
  }

  const supplierIds = uniqStrings(
    selectedOrderItems.map((it: any) => it?.chosenSupplierId)
  );

  let supplierId: string | null = null;
  if (supplierIds.length === 1) {
    supplierId = supplierIds[0];
  }

  let purchaseOrderId: string | null = null;

  if (requestedPurchaseOrderId) {
    const po = (order.purchaseOrders || []).find(
      (x: any) => String(x.id) === requestedPurchaseOrderId
    );
    if (!po) {
      throw new Error("Selected purchase order was not found on this order.");
    }
    purchaseOrderId = String(po.id);
    supplierId = String(po.supplierId ?? supplierId ?? "");
  } else if (supplierId) {
    const matchedPo = (order.purchaseOrders || []).find(
      (x: any) => String(x.supplierId) === String(supplierId)
    );
    if (matchedPo?.id) {
      purchaseOrderId = String(matchedPo.id);
    }
  }

  const existingRefunds = await tx.refund.findMany({
    where: {
      orderId,
      requestedByUserId: actorId,
      ...(purchaseOrderId ? { purchaseOrderId } : {}),
    },
    select: { id: true, status: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const existingOpen = existingRefunds.find((r: any) =>
    isRefundOpenStatus(r?.status)
  );

  if (existingOpen) {
    throw new Error("A refund request already exists for this order.");
  }

  const refundAmount = selectedOrderItems.reduce((sum: Prisma.Decimal, it: any) => {
    const lineTotal =
      it?.lineTotal != null
        ? toDecimal(it.lineTotal)
        : toDecimal(it.unitPrice).mul(new Prisma.Decimal(Number(it.quantity || 0)));
    return sum.plus(lineTotal);
  }, new Prisma.Decimal(0));

const created = await tx.refund.create({
  data: {
    orderId,
    purchaseOrderId: purchaseOrderId || undefined,
    supplierId: supplierId || undefined,
    requestedByUserId: actorId,
    status: "REQUESTED" as any,
    reason,
    itemsAmount: refundAmount,
    totalAmount: refundAmount,
    customerNote: normStr(body?.note || body?.customerNote || "") || undefined,
    providerReference: normStr(body?.providerReference || body?.reference || "") || undefined,
  } as any,
  select: {
    id: true,
    orderId: true,
    purchaseOrderId: true,
    supplierId: true,
    requestedByUserId: true,
    status: true,
    itemsAmount: true,
    totalAmount: true,
    createdAt: true,
  },
});

  if (selectedOrderItems.length) {
    await tx.refundItem.createMany({
      data: selectedOrderItems.map((it: any) => ({
        refundId: created.id,
        orderItemId: String(it.id),
        qty: Math.max(1, Number(it.quantity || 1)),
      })),
      skipDuplicates: true,
    });
  }

  await tx.refundEvent.create({
    data: {
      refundId: created.id,
      type: "CUSTOMER_REQUESTED",
      message: reason,
      meta: {
        orderId,
        purchaseOrderId,
        supplierId,
        itemCount: selectedOrderItems.length,
        itemIds: selectedOrderItems.map((it: any) => String(it.id)),
      },
    },
  });

  if (purchaseOrderId) {
    try {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          status: "REFUND_REQUESTED" as any,
        },
      });
    } catch {
      //
    }
  }

  return {
    refund: created,
    selectedOrderItems,
    supplierId,
    purchaseOrderId,
  };
}


/**
 * POST /api/refunds
 * POST /api/refunds/request
 *
 * Shopper creates a refund request.
 * Accepted body shapes (backward compatible):
 * {
 *   orderId: string,
 *   purchaseOrderId?: string,
 *   reason?: string,
 *   refundReason?: string,
 *   note?: string,
 *   itemIds?: string[],
 *   orderItemIds?: string[],
 *   items?: Array<{ orderItemId?: string; id?: string }>
 * }
 */
async function handleCreateRefundRequest(req: any, res: any) {
  const actorId = normStr(req.user?.id);
  const role = normRole(req.user?.role);

  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const out = await prisma.$transaction(async (tx) => {
      return createCustomerRefundRequestTx(tx, {
        actorId,
        role,
        body: req.body,
      });
    });

    if (out.refund.requestedByUserId) {
      await notifyUser(out.refund.requestedByUserId, {
        type: "REFUND_REQUESTED",
        title: "Refund request submitted",
        body: `Your refund request for order ${out.refund.orderId} has been submitted.`,
        data: {
          refundId: out.refund.id,
          orderId: out.refund.orderId,
          purchaseOrderId: out.refund.purchaseOrderId ?? null,
        },
      });
    }

    if (out.supplierId) {
      const supplier = await prisma.supplier.findUnique({
        where: { id: out.supplierId },
        select: { id: true, userId: true, name: true },
      });

      if (supplier?.userId) {
        await notifyUser(supplier.userId, {
          type: "REFUND_REQUESTED",
          title: "Refund request received",
          body: `A customer submitted a refund request for order ${out.refund.orderId}.`,
          data: {
            refundId: out.refund.id,
            orderId: out.refund.orderId,
            purchaseOrderId: out.purchaseOrderId ?? null,
          },
        });
      }
    }

    const adminUserIds = await getAdminUserIds();
    await notifyMany(adminUserIds, {
      type: "REFUND_REQUESTED",
      title: "New refund request",
      body: `A refund request was submitted for order ${out.refund.orderId}.`,
      data: {
        refundId: out.refund.id,
        orderId: out.refund.orderId,
        purchaseOrderId: out.purchaseOrderId ?? null,
      },
    });

    return res.status(201).json({
      ok: true,
      data: out.refund,
      meta: {
        created: true,
        purchaseOrderId: out.purchaseOrderId ?? null,
        supplierId: out.supplierId ?? null,
        itemCount: out.selectedOrderItems.length,
      },
    });
  } catch (e: any) {
    return res.status(400).json({
      error: e?.message || "Failed to submit refund request",
    });
  }
}

router.post("/", requireAuth, handleCreateRefundRequest);
router.post("/request", requireAuth, handleCreateRefundRequest);

const isAdmin = (role?: string) =>
  ["ADMIN", "SUPER_ADMIN"].includes(String(role || "").toUpperCase());

function norm(s?: any) {
  return String(s ?? "").trim();
}

function upper(s?: any) {
  return norm(s).toUpperCase();
}

function lower(s?: any) {
  return norm(s).toLowerCase();
}

async function getAdminUserIds() {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } as any },
    select: { id: true },
  });
  return admins.map((a: { id: string }) => a.id);
}

/**
 * GET /api/refunds/mine
 *
 * Backward-compatible shopper endpoint used by frontend pages.
 * Returns only refunds requested by the authenticated user.
 */
router.get("/mine", requireAuth, async (req: any, res) => {
  const actorId = normStr(req.user?.id);
  const role = normRole(req.user?.role);

  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // keep this endpoint shopper-focused only
  if (role === "SUPPLIER" || isAdmin(role)) {
    return res.json({
      ok: true,
      data: [],
      meta: {
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        take: 20,
        skip: 0,
        role,
      },
    });
  }

  const q = normStr(req.query.q).toLowerCase();
  const status = normStr(req.query.status).toUpperCase();

  const pageRaw = req.query.page;
  const pageSizeRaw = req.query.pageSize;

  const hasPageMode = pageRaw !== undefined || pageSizeRaw !== undefined;

  const page = hasPageMode ? toPositiveInt(pageRaw, 1) : 1;
  const pageSize = Math.min(100, toPositiveInt(pageSizeRaw, 20));

  const take = hasPageMode
    ? pageSize
    : Math.min(100, Math.max(1, Number(req.query.take ?? req.query.limit ?? 50)));

  const skip = hasPageMode
    ? (page - 1) * pageSize
    : Math.max(0, Number(req.query.skip ?? 0));

  const resolvedPage = hasPageMode ? page : Math.floor(skip / Math.max(1, take)) + 1;
  const resolvedPageSize = hasPageMode ? pageSize : take;

  const where: any = {
    requestedByUserId: actorId,
  };

  if (status) {
    where.status = status;
  }

  if (q) {
    where.AND = [
      { requestedByUserId: actorId },
      {
        OR: [
          { orderId: { contains: q, mode: "insensitive" } },
          { purchaseOrderId: { contains: q, mode: "insensitive" } },
          { providerReference: { contains: q, mode: "insensitive" } },
        ],
      },
    ];
    delete where.requestedByUserId;
  }

  const [rows, total] = await Promise.all([
    prisma.refund.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: {
        order: {
          select: {
            id: true,
            userId: true,
            status: true,
            createdAt: true,
            total: true,
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            status: true,
            payoutStatus: true,
            supplierId: true,
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
            userId: true,
          },
        },
        requestedBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        adminResolvedBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        items: {
          include: {
            orderItem: {
              select: {
                id: true,
                title: true,
                quantity: true,
                unitPrice: true,
                lineTotal: true,
              },
            },
          },
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 8,
        },
      },
    }),
    prisma.refund.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, resolvedPageSize)));

  return res.json({
    ok: true,
    data: rows,
    meta: {
      total,
      page: resolvedPage,
      pageSize: resolvedPageSize,
      totalPages,
      take,
      skip,
      role,
    },
  });
});

/**
 * PATCH /api/refunds/:id/decision
 * body: { decision: "APPROVE"|"REJECT", note? }
 *
 * Rules:
 * - You can only APPROVE/REJECT from certain states (prevents weird transitions)
 * - Writes RefundEvent
 * - Notifies: customer + supplier + admins (updated)
 */
router.patch("/:id/decision", requireAuth, async (req: any, res) => {
  if (!isAdmin(req.user?.role)) return res.status(403).json({ error: "Admin only" });

  const id = norm(req.params.id);
  const decision = upper(req.body?.decision);
  const note = norm(req.body?.note) || null;

  if (!["APPROVE", "REJECT"].includes(decision)) {
    return res.status(400).json({ error: "Invalid decision" });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          orderId: true,
          purchaseOrderId: true,
          supplierId: true,
          requestedByUserId: true,
        },
      });
      if (!refund) throw new Error("Refund not found");

      const allowed = new Set([
        "SUPPLIER_REVIEW",
        "SUPPLIER_ACCEPTED",
        "SUPPLIER_REJECTED",
        "ESCALATED",
        "REQUESTED",
      ]);
      if (!allowed.has(String(refund.status))) {
        throw new Error(`Cannot decide refund from status: ${refund.status}`);
      }

      const nextStatus = decision === "APPROVE" ? ("APPROVED" as any) : ("REJECTED" as any);

      const r2 = await tx.refund.update({
        where: { id },
        data: {
          status: nextStatus,
          adminResolvedAt: new Date(),
          adminResolvedById: req.user?.id ?? null,
          adminDecision: decision,
          adminNote: note ?? undefined,
        },
      });

      await tx.refundEvent.create({
        data: {
          refundId: id,
          type: decision === "APPROVE" ? "ADMIN_APPROVED" : "ADMIN_REJECTED",
          message: note ?? undefined,
          meta: { adminId: req.user?.id, decision },
        },
      });

      return { r2, refund };
    });

    const refundRow = updated.r2;
    const refundMeta = updated.refund;

    if (refundMeta.requestedByUserId) {
      await notifyUser(refundMeta.requestedByUserId, {
        type: "REFUND_STATUS_CHANGED",
        title: "Refund updated",
        body:
          decision === "APPROVE"
            ? `Your refund was approved for order ${refundMeta.orderId}.`
            : `Your refund was rejected for order ${refundMeta.orderId}.`,
        data: { refundId: refundMeta.id, orderId: refundMeta.orderId, decision },
      });
    }

    if (refundMeta.supplierId) {
      const supplier = await prisma.supplier.findUnique({
        where: { id: refundMeta.supplierId },
        select: { userId: true, name: true },
      });
      if (supplier?.userId) {
        await notifyUser(supplier.userId, {
          type: "REFUND_STATUS_CHANGED",
          title: "Refund updated",
          body:
            decision === "APPROVE"
              ? `Admin approved a refund on order ${refundMeta.orderId}.`
              : `Admin rejected a refund on order ${refundMeta.orderId}.`,
          data: { refundId: refundMeta.id, orderId: refundMeta.orderId, decision },
        });
      }
    }

    const adminUserIds = await getAdminUserIds();
    await notifyMany(adminUserIds, {
      type: "REFUND_STATUS_CHANGED",
      title: "Refund decision recorded",
      body: `Admin ${decision} for refund on order ${refundMeta.orderId}.`,
      data: { refundId: refundMeta.id, orderId: refundMeta.orderId, decision },
    });

    return res.json({ ok: true, data: refundRow });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to record decision" });
  }
});

/**
 * POST /api/refunds/:id/approve
 * Approves a refund request.
 *
 * Inventory behavior:
 * - restores stock for refunded order items immediately on approval
 * - increments chosen supplier offer qty back
 * - recomputes product stock cache
 *
 * Rules:
 * - only admin
 * - only allow approval from REQUESTED / SUPPLIER_REVIEW / SUPPLIER_ACCEPTED / ESCALATED
 * - if already APPROVED, returns current row
 */
router.post("/:id/approve", requireAuth, async (req: any, res) => {
  if (!isAdmin(req.user?.role)) {
    return res.status(403).json({ error: "Admin only" });
  }

  const id = norm(requiredString(req.params.id));

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          orderId: true,
          purchaseOrderId: true,
          supplierId: true,
          requestedByUserId: true,
        },
      });

      if (!refund) {
        throw new Error("Refund not found");
      }

      const currentStatus = String(refund.status || "").toUpperCase();

      if (currentStatus === "APPROVED") {
        const existing = await tx.refund.findUnique({ where: { id } });
        return { refund: existing, meta: refund, alreadyApproved: true };
      }

      if (
        !["REQUESTED", "SUPPLIER_REVIEW", "SUPPLIER_ACCEPTED", "ESCALATED"].includes(
          currentStatus
        )
      ) {
        throw new Error(`Cannot approve refund from status: ${refund.status}`);
      }

      const refundItems = await tx.refundItem.findMany({
        where: { refundId: id },
        select: {
          id: true,
          qty: true,
          orderItemId: true,
          orderItem: {
            select: {
              id: true,
              orderId: true,
              productId: true,
              variantId: true,
              quantity: true,
              chosenSupplierProductOfferId: true,
              chosenSupplierVariantOfferId: true,
            },
          },
        },
      });

      const approvedRefund = await tx.refund.update({
        where: { id },
        data: {
          status: "APPROVED" as any,
          adminResolvedAt: new Date(),
          adminResolvedById: String(req.user?.id),
          adminDecision: req.body?.adminDecision
            ? String(req.body.adminDecision)
            : "APPROVED",
          adminNote: req.body?.adminNote ? String(req.body.adminNote) : undefined,
        },
      });

      await tx.refundEvent.create({
        data: {
          refundId: id,
          type: "ADMIN_APPROVED",
          message: "Refund approved",
          meta: {
            adminId: req.user?.id,
            adminDecision: req.body?.adminDecision ?? "APPROVED",
            adminNote: req.body?.adminNote ?? null,
          },
        },
      });

      if (refund.purchaseOrderId) {
        try {
          await tx.purchaseOrder.update({
            where: { id: refund.purchaseOrderId },
            data: {
              status: "REFUND_REQUESTED" as any,
            },
          });
        } catch {
          // ignore
        }
      }

      for (const ri of refundItems) {
        const oi = ri.orderItem;
        if (!oi) continue;

        const restoreQty = Math.max(0, Number(ri.qty ?? oi.quantity ?? 0));

        if (restoreQty <= 0) continue;

        if (oi.chosenSupplierVariantOfferId) {
          const updatedVariantOffer = await tx.supplierVariantOffer.update({
            where: { id: String(oi.chosenSupplierVariantOfferId) },
            data: {
              availableQty: { increment: restoreQty },
              inStock: true,
            },
            select: {
              id: true,
              availableQty: true,
              productId: true,
              variantId: true,
            },
          });

          const variantProductId = updatedVariantOffer.productId
            ? String(updatedVariantOffer.productId)
            : oi.productId
              ? String(oi.productId)
              : null;

          if (variantProductId) {
            await recomputeProductStockTx(tx, variantProductId);
            await syncProductInStockCacheTx(tx, variantProductId);
          }
        } else if (oi.chosenSupplierProductOfferId) {
          const updatedBaseOffer = await tx.supplierProductOffer.update({
            where: { id: String(oi.chosenSupplierProductOfferId) },
            data: {
              availableQty: { increment: restoreQty },
              inStock: true,
            },
            select: {
              id: true,
              availableQty: true,
              productId: true,
            },
          });

          const baseProductId = updatedBaseOffer.productId
            ? String(updatedBaseOffer.productId)
            : oi.productId
              ? String(oi.productId)
              : null;

          if (baseProductId) {
            await recomputeProductStockTx(tx, baseProductId);
            await syncProductInStockCacheTx(tx, baseProductId);
          }
        } else if (oi.productId) {
          await recomputeProductStockTx(tx, String(oi.productId));
          await syncProductInStockCacheTx(tx, String(oi.productId));
        }
      }

      return {
        refund: approvedRefund,
        meta: refund,
        alreadyApproved: false,
      };
    });

    const refundMeta = updated.meta;

    if (refundMeta.requestedByUserId) {
      await notifyUser(refundMeta.requestedByUserId, {
        type: "REFUND_STATUS_CHANGED",
        title: "Refund approved",
        body: `Your refund has been approved for order ${refundMeta.orderId}.`,
        data: {
          refundId: refundMeta.id,
          orderId: refundMeta.orderId,
          status: "APPROVED",
        },
      });
    }

    if (refundMeta.supplierId) {
      const supplier = await prisma.supplier.findUnique({
        where: { id: refundMeta.supplierId },
        select: { userId: true, name: true },
      });

      if (supplier?.userId) {
        await notifyUser(supplier.userId, {
          type: "REFUND_STATUS_CHANGED",
          title: "Refund approved",
          body: `A refund has been approved for order ${refundMeta.orderId}.`,
          data: {
            refundId: refundMeta.id,
            orderId: refundMeta.orderId,
            status: "APPROVED",
          },
        });
      }
    }

    const adminUserIds = await getAdminUserIds();
    await notifyMany(adminUserIds, {
      type: "REFUND_STATUS_CHANGED",
      title: "Refund approved",
      body: `Refund approved for order ${refundMeta.orderId}.`,
      data: {
        refundId: refundMeta.id,
        orderId: refundMeta.orderId,
        status: "APPROVED",
      },
    });

    return res.json({
      ok: true,
      data: updated.refund,
      meta: {
        inventoryRestored: !updated.alreadyApproved,
      },
    });
  } catch (e: any) {
    return res.status(400).json({
      error: e?.message || "Failed to approve refund",
    });
  }
});

export default router;