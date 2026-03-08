// src/routes/categories.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { requiredString } from "../lib/http.js";

const router = Router();

/* =========================================================
   Helpers
========================================================= */

function buildTree(categories: any[]) {
  const map = new Map();
  const roots: any[] = [];

  categories.forEach((c) => {
    map.set(c.id, { ...c, children: [] });
  });

  categories.forEach((c) => {
    if (c.parentId && map.has(c.parentId)) {
      map.get(c.parentId).children.push(map.get(c.id));
    } else {
      roots.push(map.get(c.id));
    }
  });

  return roots;
}

/* =========================================================
   Public: category tree
========================================================= */

router.get("/", async (_req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
      },
    });

    const tree = buildTree(categories);

    res.json({
      data: tree,
    });
  } catch (e) {
    next(e);
  }
});

/* =========================================================
   Admin CRUD
========================================================= */

const categorySchema = z.object({
  name: z.string().min(2),
  parentId: z.string().nullable().optional(),
});

router.post("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = categorySchema.parse(req.body);

    const slug = data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const cat = await prisma.category.create({
      data: {
        name: data.name,
        slug,
        parentId: data.parentId ?? null,
      },
    });

    res.status(201).json(cat);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = categorySchema.partial().parse(req.body);

    const cat = await prisma.category.update({
      where: { id: requiredString(req.params.id) },
      data,
    });

    res.json(cat);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.category.delete({
      where: { id: requiredString(req.params.id) },
    });

    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;