// api/src/routes/adminDisputes.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { requiredString } from "../lib/http.js";
import { NotificationType, DisputeStatus } from "@prisma/client";
import {
  notifySupplierBySupplierId,
  notifyCustomerDisputeStatusChanged,
} from "../services/notifications.service.js";

const router = Router();

function parsePositiveInt(v: any, fallback: number, opts: { min?: number; max?: number } = {}) {
  const n = Number(v);
  const min = opts.min ?? 1;
  const max = opts.max ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/**
 * GET /api/admin/disputes
 * Server-side paginated, optional status filter + search by order id/subject.
 */
router.get("/", requireAdmin, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1, { min: 1 });
    const pageSize = parsePositiveInt(req.query.pageSize, 20, { min: 1, max: 100 });
    const statusRaw = String(req.query.status ?? "").trim().toUpperCase();
    const q = String(req.query.q ?? "").trim();

    const where: any = {};
    if (statusRaw && (DisputeStatus as any)[statusRaw]) {
      where.status = statusRaw;
    }
    if (q) {
      where.OR = [
        { orderId: { contains: q, mode: "insensitive" } },
        { subject: { contains: q, mode: "insensitive" } },
        { id: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.disputeCase.count({ where }),
      prisma.disputeCase.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { id: true, email: true, firstName: true, lastName: true } },
          supplier: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, status: true } },
        },
      }),
    ]);

    return res.json({ data: rows, meta: { page, pageSize, total, status: statusRaw || null, q: q || null } });
  } catch (e: any) {
    console.error("GET /api/admin/disputes failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to fetch disputes" });
  }
});

router.get("/:id", requireAdmin, async (req, res) => {
  try {
    const id = requiredString(req.params.id);

    const dispute = await prisma.disputeCase.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } },
        supplier: { select: { id: true, name: true, whatsappPhone: true } },
        purchaseOrder: { select: { id: true, status: true, supplierId: true } },
        order: { select: { id: true, status: true, total: true, createdAt: true } },
      },
    });

    if (!dispute) return res.status(404).json({ error: "Dispute not found" });

    return res.json({ data: dispute });
  } catch (e: any) {
    console.error("GET /api/admin/disputes/:id failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to fetch dispute" });
  }
});

/**
 * POST /api/admin/disputes/:id/resolve
 * body: { status: "SUPPLIER_RESPONSE" | "ESCALATED" | "RESOLVED" | "CLOSED", adminDecision?: string }
 * A single flexible transition endpoint - CLOSED/RESOLVED are terminal, everything else is admin judgment.
 */
router.post("/:id/resolve", requireAdmin, async (req: any, res) => {
  try {
    const id = requiredString(req.params.id);
    const statusRaw = String(req.body?.status ?? "").trim().toUpperCase();
    const adminDecision = String(req.body?.adminDecision ?? "").trim() || null;
    const adminId = String(req.user?.id ?? "") || null;

    if (!(DisputeStatus as any)[statusRaw]) {
      return res.status(400).json({
        error: `Invalid status '${statusRaw}'. Allowed: ${Object.keys(DisputeStatus).join(", ")}`,
      });
    }

    const current = await prisma.disputeCase.findUnique({
      where: { id },
      select: { id: true, status: true, orderId: true, subject: true, supplierId: true },
    });
    if (!current) return res.status(404).json({ error: "Dispute not found" });

    if (current.status === "CLOSED") {
      return res.status(409).json({ error: "Dispute is already closed" });
    }

    const isTerminal = statusRaw === "RESOLVED" || statusRaw === "CLOSED";

    const updated = await prisma.disputeCase.update({
      where: { id },
      data: {
        status: statusRaw as any,
        adminDecision: adminDecision ?? undefined,
        resolvedByUserId: isTerminal ? adminId : undefined,
        resolvedAt: isTerminal ? new Date() : undefined,
      },
    });

    notifyCustomerDisputeStatusChanged(id, { adminDecision }).catch((e) =>
      console.error("[admin disputes resolve] customer notify failed", e)
    );

    if (current.supplierId) {
      notifySupplierBySupplierId(current.supplierId, {
        type: NotificationType.DISPUTE_STATUS_CHANGED,
        title: "Dispute update",
        body: `Dispute on order ${current.orderId} (${current.subject}) is now ${statusRaw.toLowerCase()}.${
          adminDecision ? ` Outcome: ${adminDecision}` : ""
        }`,
        data: { disputeId: id, orderId: current.orderId, status: statusRaw },
      }).catch((e) => console.error("[admin disputes resolve] supplier notify failed", e));
    }

    return res.json({ ok: true, data: updated });
  } catch (e: any) {
    console.error("POST /api/admin/disputes/:id/resolve failed:", e);
    return res.status(400).json({ error: e?.message || "Failed to resolve dispute" });
  }
});

export default router;
