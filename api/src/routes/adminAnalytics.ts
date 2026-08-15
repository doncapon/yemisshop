// api/src/routes/adminAnalytics.ts
import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth.js";
import { computeProductAnalytics, computeProductCustomers } from "../services/productAnalytics.service.js";

const router = Router();

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseRange(query: any): { from: Date; to: Date } {
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);

  const from = query.from ? new Date(String(query.from)) : startOfDay(defaultFrom);
  const to = query.to ? new Date(String(query.to)) : endOfDay(now);

  return {
    from: Number.isNaN(from.getTime()) ? startOfDay(defaultFrom) : startOfDay(from),
    to: Number.isNaN(to.getTime()) ? endOfDay(now) : endOfDay(to),
  };
}

/**
 * GET /api/admin/analytics/products
 * Platform-wide product sales analytics for the admin dashboard — meant to
 * be shared with suppliers to help them understand what's selling.
 * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&supplierId=(optional)
 */
router.get("/products", requireAdmin, async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const supplierId = req.query?.supplierId ? String(req.query.supplierId).trim() : null;

    const result = await computeProductAnalytics({
      from,
      to,
      supplierId: supplierId || undefined,
      useSupplierPrice: false, // admin sees customer-facing GMV
    });

    return res.json({
      data: { ...result, range: { from: from.toISOString(), to: to.toISOString() }, supplierId },
    });
  } catch (e: any) {
    console.error("[GET /api/admin/analytics/products] failed:", e);
    return res.status(500).json({ error: e?.message || "Could not load analytics." });
  }
});

const CustomersQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  supplierId: z.string().optional(),
});

/**
 * GET /api/admin/analytics/products/:productId/customers
 * Drill-down: which customers bought this product in the window.
 * Admin-only — never exposed to suppliers (they never get customer PII).
 */
router.get("/products/:productId/customers", requireAdmin, async (req, res) => {
  try {
    const productId = String(req.params.productId || "").trim();
    if (!productId) return res.status(400).json({ error: "Missing productId" });

    const q = CustomersQuerySchema.parse(req.query);
    const { from, to } = parseRange(q);

    const rows = await computeProductCustomers({
      productId,
      from,
      to,
      supplierId: q.supplierId || undefined,
      useSupplierPrice: false,
    });

    return res.json({ data: rows });
  } catch (e: any) {
    console.error("[GET /api/admin/analytics/products/:id/customers] failed:", e);
    return res.status(500).json({ error: e?.message || "Could not load customers." });
  }
});

export default router;
