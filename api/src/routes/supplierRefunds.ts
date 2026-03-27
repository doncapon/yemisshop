// api/src/routes/supplierRefunds.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyMany, notifyUser } from "../services/notifications.service.js";
import { requiredString } from "../lib/http.js";
import { NotificationType } from "@prisma/client";
import { z } from "zod";

const router = Router();

const isSupplier = (role?: string) => String(role || "").toUpperCase() === "SUPPLIER";
const isAdmin = (role?: string) =>
  ["ADMIN", "SUPER_ADMIN"].includes(String(role || "").toUpperCase());

function norm(s?: any) {
  return String(s ?? "").trim();
}

function upper(s?: any) {
  return norm(s).toUpperCase();
}

function uniqStrings(values: any[]): string[] {
  return Array.from(
    new Set(
      (values || [])
        .map((v) => String(v ?? "").trim())
        .filter(Boolean)
    )
  );
}

function normalizeUrlList(values: any): string[] {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  return uniqStrings(
    list
      .map((v: any) => String(v ?? "").trim())
      .filter(Boolean)
  );
}

function pickEvidenceByItemIdFromMeta(meta: any): Record<string, string[]> {
  const out: Record<string, string[]> = {};

  const rawMap = meta?.evidenceByItemId;
  if (rawMap && typeof rawMap === "object" && !Array.isArray(rawMap)) {
    for (const [rawItemId, rawUrls] of Object.entries(rawMap)) {
      const itemId = norm(rawItemId);
      if (!itemId) continue;

      const urls = normalizeUrlList(rawUrls);
      if (urls.length) {
        out[itemId] = urls;
      }
    }
  }

  const rawArray = Array.isArray(meta?.evidence) ? meta.evidence : [];
  for (const row of rawArray) {
    const itemId = norm(row?.itemId ?? row?.orderItemId ?? row?.id);
    if (!itemId) continue;

    const urls = normalizeUrlList(row?.urls ?? row?.evidenceUrls ?? row?.images ?? []);
    if (!urls.length) continue;

    out[itemId] = uniqStrings([...(out[itemId] || []), ...urls]);
  }

  return out;
}

function flattenEvidenceUrls(evidenceByItemId: Record<string, string[]>): string[] {
  return uniqStrings(
    Object.values(evidenceByItemId || {}).flatMap((urls) => normalizeUrlList(urls))
  );
}

function countEvidenceUrls(evidenceByItemId: Record<string, string[]>): number {
  return Object.values(evidenceByItemId || {}).reduce((sum, urls) => {
    return sum + (Array.isArray(urls) ? urls.length : 0);
  }, 0);
}

function getItemTitle(orderItem: any) {
  return (
    norm(orderItem?.title) ||
    norm(orderItem?.productTitle) ||
    norm(orderItem?.product?.title) ||
    "Item"
  );
}

function serializeRefundForSupplier(refund: any) {
  const evidenceByItemId = pickEvidenceByItemIdFromMeta(refund?.meta || {});
  const flattenedEvidenceUrls = flattenEvidenceUrls(evidenceByItemId);

  const items = Array.isArray(refund?.items) ? refund.items : [];
  const itemsWithEvidence = items.map((ri: any) => {
    const orderItemId = norm(ri?.orderItemId ?? ri?.orderItem?.id);
    const evidenceUrls = orderItemId ? evidenceByItemId[orderItemId] || [] : [];

    return {
      ...ri,
      orderItem: ri?.orderItem
        ? {
            ...ri.orderItem,
          }
        : ri?.orderItem ?? null,
      evidenceUrls,
      evidenceCount: evidenceUrls.length,
    };
  });

  const evidenceItems = itemsWithEvidence
    .map((ri: any) => {
      const itemId = norm(ri?.orderItemId ?? ri?.orderItem?.id);
      const urls = normalizeUrlList(ri?.evidenceUrls);
      if (!itemId || !urls.length) return null;

      return {
        itemId,
        title: getItemTitle(ri?.orderItem),
        qty:
          Number(ri?.qty ?? ri?.orderItem?.quantity ?? 0) > 0
            ? Number(ri?.qty ?? ri?.orderItem?.quantity ?? 0)
            : null,
        urls,
        count: urls.length,
      };
    })
    .filter(Boolean);

  return {
    ...refund,
    items: itemsWithEvidence,
    evidenceByItemId,
    evidenceUrls: flattenedEvidenceUrls,
    evidenceCount: flattenedEvidenceUrls.length,
    evidenceItemCount: evidenceItems.length,
    evidenceItems,
  };
}

async function getSupplierForUser(userId: string) {
  return prisma.supplier.findFirst({
    where: { userId },
    select: { id: true, name: true, userId: true },
  });
}

async function getAdminUserIds() {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } as any },
    select: { id: true },
  });
  return admins.map((a: { id: string }) => a.id);
}

function getRefundDelegate(db: any) {
  return db.refund || db.refundRequest || db.orderRefund || db.refunds || null;
}

/**
 * Resolve supplierId for this request:
 * - Admin can pass ?supplierId=...
 * - Supplier uses their own supplierId
 */
async function resolveSupplierId(req: any) {
  const role = req.user?.role;
  const userId = req.user?.id;

  if (!userId) return null;

  if (isAdmin(role)) {
    const sid = norm(req.query?.supplierId);
    return sid || null;
  }

  if (isSupplier(role)) {
    const s = await getSupplierForUser(userId);
    return s?.id ?? null;
  }

  return null;
}

const supplierRefundActionSchema = z.object({
  action: z.enum(["ACCEPT", "REJECT", "ESCALATE"]),
  note: z.string().trim().max(2000).optional().nullable(),
});

function mapActionToStatus(action: "ACCEPT" | "REJECT" | "ESCALATE") {
  if (action === "ACCEPT") {
    return {
      nextStatus: "SUPPLIER_ACCEPTED",
      supplierResponse: "ACCEPT",
      eventType: "SUPPLIER_ACCEPTED",
      defaultMessage: "Supplier accepted the refund request.",
    };
  }

  if (action === "REJECT") {
    return {
      nextStatus: "SUPPLIER_REJECTED",
      supplierResponse: "REJECT",
      eventType: "SUPPLIER_REJECTED",
      defaultMessage: "Supplier rejected the refund request.",
    };
  }

  return {
    nextStatus: "ESCALATED",
    supplierResponse: "DISPUTE",
    eventType: "SUPPLIER_ESCALATED",
    defaultMessage: "Supplier escalated the refund request.",
  };
}

async function actOnRefund(
  userId: string,
  role: string | undefined,
  refundId: string,
  action: "ACCEPT" | "REJECT" | "ESCALATE",
  note?: string | null
) {
  if (!userId) {
    const err: any = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }

  if (!isSupplier(role)) {
    const err: any = new Error("Supplier access required");
    err.statusCode = 403;
    throw err;
  }

  const supplier = await getSupplierForUser(userId);
  if (!supplier?.id) {
    const err: any = new Error("Supplier profile not found");
    err.statusCode = 403;
    throw err;
  }

  const mapped = mapActionToStatus(action);

  const out = await prisma.$transaction(async (tx) => {
    const RefundTx = getRefundDelegate(tx);
    if (!RefundTx) {
      const err: any = new Error("Refund model delegate not found on Prisma tx client.");
      err.statusCode = 500;
      throw err;
    }

    const refund = await RefundTx.findUnique({
      where: { id: refundId },
      include: {
        supplier: { select: { id: true, name: true } },
        purchaseOrder: {
          select: {
            id: true,
            supplierId: true,
            status: true,
            payoutStatus: true,
          },
        },
        order: {
          select: {
            id: true,
            status: true,
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
      },
    });

    if (!refund) {
      const err: any = new Error("Refund not found");
      err.statusCode = 404;
      throw err;
    }

    const refundSupplierId = norm(refund.supplierId || refund.purchaseOrder?.supplierId);
    if (!refundSupplierId || refundSupplierId !== supplier.id) {
      const err: any = new Error("Forbidden");
      err.statusCode = 403;
      throw err;
    }

    const currentStatus = upper(refund.status);
    if (!["REQUESTED", "SUPPLIER_REVIEW"].includes(currentStatus)) {
      const err: any = new Error(`Cannot act on refund in status ${currentStatus || "UNKNOWN"}`);
      err.statusCode = 400;
      throw err;
    }

    const updateData: any = {
      status: mapped.nextStatus as any,
      supplierRespondedAt: new Date(),
      supplierResponse: mapped.supplierResponse,
    };

    if (note !== undefined) {
      updateData.supplierNote = note;
    }

    const updated = await RefundTx.update({
      where: { id: refundId },
      data: updateData,
      include: {
        supplier: { select: { id: true, name: true } },
        purchaseOrder: {
          select: {
            id: true,
            supplierId: true,
            status: true,
            payoutStatus: true,
          },
        },
        order: {
          select: {
            id: true,
            status: true,
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
        items: {
          include: {
            orderItem: {
              select: {
                id: true,
                title: true,
                quantity: true,
                unitPrice: true,
              },
            },
          },
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });

    const RefundEventTx = (tx as any).refundEvent || (tx as any).refundEvents || null;
    if (RefundEventTx?.create) {
      await RefundEventTx.create({
        data: {
          refundId,
          type: mapped.eventType,
          message: note?.trim() || mapped.defaultMessage,
          meta: {
            supplierId: supplier.id,
            supplierUserId: userId,
            action,
            nextStatus: mapped.nextStatus,
          },
        },
      });
    }

    return {
      updated,
      refundMeta: refund,
      nextStatus: mapped.nextStatus,
      supplier,
    };
  });

  const adminIds = await getAdminUserIds();
  if (adminIds.length) {
    await notifyMany(adminIds, {
      type: NotificationType.PURCHASE_ORDER_STATUS_UPDATE,
      title: "Supplier responded to refund",
      body: `Supplier ${out.supplier.name || "Supplier"} marked refund as ${out.nextStatus} for order ${out.refundMeta.orderId}.`,
      data: {
        refundId: out.refundMeta.id,
        orderId: out.refundMeta.orderId,
        purchaseOrderId: out.refundMeta.purchaseOrderId,
        supplierId: out.supplier.id,
        status: out.nextStatus,
        action,
      },
    });
  }

  if ((out.refundMeta as any).requestedByUserId) {
    await notifyUser((out.refundMeta as any).requestedByUserId, {
      type: NotificationType.PURCHASE_ORDER_STATUS_UPDATE,
      title: "Refund update",
      body: `Your refund request for order ${out.refundMeta.orderId} is now ${out.nextStatus}.`,
      data: {
        refundId: out.refundMeta.id,
        orderId: out.refundMeta.orderId,
        purchaseOrderId: out.refundMeta.purchaseOrderId,
        status: out.nextStatus,
        action,
      },
    });
  }

  return {
    ...out,
    updated: serializeRefundForSupplier(out.updated),
  };
}

/**
 * GET /api/supplier/refunds
 */
router.get("/", requireAuth, async (req: any, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const supplierId = await resolveSupplierId(req);
  if (!supplierId) return res.status(403).json({ error: "Supplier access required" });

  const qRaw = norm(req.query.q);
  const statusRaw = norm(req.query.status);
  const take = Math.min(200, Math.max(1, Number(req.query.take ?? 50) || 50));
  const skip = Math.max(0, Number(req.query.skip ?? 0) || 0);

  const Refund = getRefundDelegate(prisma);
  if (!Refund) {
    return res.status(500).json({ error: "Refund model delegate not found on Prisma client." });
  }

  const where: any = { supplierId };

  if (statusRaw) {
    where.status = upper(statusRaw);
  }

  if (qRaw) {
    const q = qRaw;
    where.OR = [
      { id: { contains: q } },
      { orderId: { contains: q } },
      { purchaseOrderId: { contains: q } },
      { providerReference: { contains: q } },
      { reason: { contains: q } },
      { supplierNote: { contains: q } },
    ];
  }

  const rows = await Refund.findMany({
    where,
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    take,
    skip,
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
          userId: true,
        },
      },
      order: true,
      purchaseOrder: true,
      requestedBy: true,
      items: {
        include: {
          orderItem: true,
        },
      },
      events: true,
    },
  });

  const serializedRows = rows.map(serializeRefundForSupplier);

  return res.json({
    data: serializedRows,
    meta: {
      take,
      skip,
      q: qRaw || null,
      status: statusRaw || null,
      supplierId,
      count: serializedRows.length,
    },
  });
});

/**
 * PATCH /api/supplier/refunds/:id
 * body: { action: "ACCEPT"|"REJECT"|"ESCALATE", note? }
 */
router.patch("/:id", requireAuth, async (req: any, res: Response) => {
  const userId = req.user?.id;
  const role = req.user?.role;
  const id = norm(requiredString(req.params.id));

  const parsed = supplierRefundActionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
  }

  try {
    const out = await actOnRefund(userId, role, id, parsed.data.action, parsed.data.note ?? null);
    return res.json({
      ok: true,
      data: out.updated,
      message:
        parsed.data.action === "ACCEPT"
          ? "Refund accepted."
          : parsed.data.action === "REJECT"
            ? "Refund rejected."
            : "Refund escalated.",
    });
  } catch (e: any) {
    const statusCode = Number(e?.statusCode || 400);
    const msg = e?.message || "Failed to update refund";
    return res.status(statusCode).json({ error: msg });
  }
});

/**
 * POST /api/supplier/refunds/:refundId/action
 * body: { action: "ACCEPT"|"REJECT"|"ESCALATE", note? }
 */
router.post("/:refundId/action", requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const refundId = norm(req.params.refundId);

  if (!refundId) {
    return res.status(400).json({ error: "Refund id is required" });
  }

  const parsed = supplierRefundActionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
  }

  try {
    const out = await actOnRefund(
      user?.id,
      user?.role,
      refundId,
      parsed.data.action,
      parsed.data.note ?? null
    );

    return res.json({
      ok: true,
      data: out.updated,
      message:
        parsed.data.action === "ACCEPT"
          ? "Refund accepted."
          : parsed.data.action === "REJECT"
            ? "Refund rejected."
            : "Refund escalated.",
    });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || 400);
    return res.status(statusCode).json({
      error: error?.message || "Failed to process refund action",
    });
  }
});

/**
 * POST /api/supplier/refunds/:refundId/accept
 * body: { note? }
 */
router.post("/:refundId/accept", requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const refundId = norm(req.params.refundId);
  const note = req.body?.note == null ? null : norm(req.body.note);

  if (!refundId) {
    return res.status(400).json({ error: "Refund id is required" });
  }

  try {
    const out = await actOnRefund(user?.id, user?.role, refundId, "ACCEPT", note);
    return res.json({
      ok: true,
      data: out.updated,
      message: "Refund accepted.",
    });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || 400);
    return res.status(statusCode).json({
      error: error?.message || "Failed to accept refund",
    });
  }
});

/**
 * POST /api/supplier/refunds/:refundId/reject
 * body: { note? }
 */
router.post("/:refundId/reject", requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const refundId = norm(req.params.refundId);
  const note = req.body?.note == null ? null : norm(req.body.note);

  if (!refundId) {
    return res.status(400).json({ error: "Refund id is required" });
  }

  try {
    const out = await actOnRefund(user?.id, user?.role, refundId, "REJECT", note);
    return res.json({
      ok: true,
      data: out.updated,
      message: "Refund rejected.",
    });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || 400);
    return res.status(statusCode).json({
      error: error?.message || "Failed to reject refund",
    });
  }
});

/**
 * POST /api/supplier/refunds/:refundId/escalate
 * body: { note? }
 */
router.post("/:refundId/escalate", requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const refundId = norm(req.params.refundId);
  const note = req.body?.note == null ? null : norm(req.body.note);

  if (!refundId) {
    return res.status(400).json({ error: "Refund id is required" });
  }

  try {
    const out = await actOnRefund(user?.id, user?.role, refundId, "ESCALATE", note);
    return res.json({
      ok: true,
      data: out.updated,
      message: "Refund escalated.",
    });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || 400);
    return res.status(statusCode).json({
      error: error?.message || "Failed to escalate refund",
    });
  }
});

export default router;