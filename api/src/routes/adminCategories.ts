// api/src/routes/adminCategories.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middleware/auth.js";
import slugify from "../lib/slugify.js";
import { requiredString } from "../lib/http.js";

const r = Router();

// ✅ Admin area: allow ADMIN + SUPER_ADMIN (whatever your requireAdmin means)
// ❌ Do NOT requireSupplier here
r.use(requireAuth, requireAdmin);

/* ---------------- Catalog: Categories ---------------- */
// GET /api/admin/categories
r.get("/", async (_req, res, next) => {
  try {
    const rows = await prisma.category.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/categories  (Super admin only)
r.post("/", requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, slug, parentId = null, position = 0, isActive = true } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });

    const data = {
      name: String(name),
      slug: String(slug || slugify(name)),
      parentId: parentId || null,
      position: Number(position) || 0,
      isActive: !!isActive,
    };

    const created = await prisma.category.create({ data });
    res.json({ ok: true, category: created });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/categories/:id  (Super admin only)
r.put("/:id", requireSuperAdmin, async (req, res, next) => {
  try {
    const id = requiredString(req.params.id);
    const { name, slug, parentId, position, isActive } = req.body || {};

    const updated = await prisma.category.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: String(name) } : {}),
        ...(slug !== undefined ? { slug: String(slug) } : {}),
        ...(parentId !== undefined ? { parentId: parentId || null } : {}),
        ...(position !== undefined ? { position: Number(position) } : {}),
        ...(isActive !== undefined ? { isActive: !!isActive } : {}),
      },
    });

    res.json({ ok: true, category: updated });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/categories/:id  (Super admin only)
r.delete("/:id", requireSuperAdmin, async (req, res, next) => {
  try {
    const id = requiredString(req.params.id);

    const used = await prisma.product.count({ where: { categoryId: id } });
    if (used > 0) {
      return res.status(409).json({ error: "Cannot delete: category is in use by products" });
    }

    await prisma.category.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default r;
