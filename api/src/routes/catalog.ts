// api/src/routes/catalog.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const r = Router();

/**
 * Public/Authenticated read endpoints for catalog meta
 * (safe for suppliers & shoppers)
 */

r.get("/categories", async (_req, res, next) => {
  try {
    const rows = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

r.get("/brands", async (_req, res, next) => {
  try {
    const rows = await prisma.brand.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }],
    });
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

r.get("/attributes", async (_req, res, next) => {
  try {
    const rows = await prisma.attribute.findMany({
      where: { isActive: true },
      include: {
        values: {
          where: { isActive: true },
          orderBy: [{ position: "asc" }, { name: "asc" }],
        },
      },
      orderBy: [{ name: "asc" }],
    });
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// Convenience: one call for everything
r.get("/meta", async (_req, res, next) => {
  try {
    const [categories, brands, attributes] = await Promise.all([
      prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ position: "asc" }, { name: "asc" }],
      }),
      prisma.brand.findMany({
        where: { isActive: true },
        orderBy: [{ name: "asc" }],
      }),
      prisma.attribute.findMany({
        where: { isActive: true },
        include: {
          values: {
            where: { isActive: true },
            orderBy: [{ position: "asc" }, { name: "asc" }],
          },
        },
        orderBy: [{ name: "asc" }],
      }),
    ]);

    res.json({ data: { categories, brands, attributes } });
  } catch (e) {
    next(e);
  }
});

export default r;
