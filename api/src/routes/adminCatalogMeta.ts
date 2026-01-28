import express from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

// GET /api/admin/categories
router.get("/categories", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await prisma.category.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
    return res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/brands
router.get("/brands", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await prisma.brand.findMany({
      orderBy: [{ name: "asc" }],
    });
    return res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/attributes  (IMPORTANT: include values)
router.get("/attributes", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await prisma.attribute.findMany({
      orderBy: [{ name: "asc" }],
      include: {
        values: {
          orderBy: [{ position: "asc" }, { name: "asc" }],
        },
      },
    });
    return res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

export default router;
