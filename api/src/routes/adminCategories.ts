// api/src/routes/adminCategories.ts
import { Router } from 'express';
import { requireAuth, requireAdmin , requireSuperAdmin} from '../middleware/auth.js';
import slugify from '../lib/slugify.js'; // simple helper; add below snippet if you don't have one
import { prisma } from '../lib/prisma.js';


const r = Router();
r.use(requireAuth, requireAdmin);

/* ---------------- Catalog: Categories ---------------- */
r.get('/', async (_req, res) => {
  const rows = await prisma.category.findMany({
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  });
  res.json({ data: rows });
});

r.post('/', requireSuperAdmin, async (req, res) => {
  const { name, slug, parentId = null, position = 0, isActive = true } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const data = {
    name: String(name),
    slug: String(slug || slugify(name)),
    parentId: parentId || null,
    position: Number(position) || 0,
    isActive: !!isActive,
  };
  const created = await prisma.category.create({ data });
  res.json({ ok: true, category: created });
});

r.put('/:id', requireSuperAdmin, async (req, res) => {
  const id = req.params.id;
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
});

// DELETE /api/admin/categories/:id
r.delete('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const id = req.params.id;

    const used = await prisma.product.count({ where: { categoryId: id } });
    if (used > 0) {
      return res.status(409).json({ error: 'Cannot delete: category is in use by products' });
    }

    await prisma.category.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});


export default r;
