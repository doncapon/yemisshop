import { Router } from 'express';
import { requireAdmin, requireSuperAdmin} from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import slugify from '../lib/slugify.js'; // simple helper; add below snippet if you don't have one
import { requiredString } from '../lib/http.js';



const r = Router();
/* ---------------- Catalog: Brands ---------------- */
r.get('/', async (_req, res) => {
  const rows = await prisma.brand.findMany({ orderBy: [{ name: 'asc' }] });
  res.json({ data: rows });
});

r.post('/', requireSuperAdmin, requireAdmin, async (req, res) => {
  const { name, slug, logoUrl = null, isActive = true } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const created = await prisma.brand.create({
    data: {
      name: String(name),
      slug: String(slug || slugify(name)),
      logoUrl: logoUrl ? String(logoUrl) : null,
      isActive: !!isActive,
    },
  });
  res.json({ ok: true, brand: created });
});

r.put('/:id', requireSuperAdmin,  requireAdmin, async (req, res) => {
  const id = requiredString(req.params.id);
  const { name, slug, logoUrl, isActive } = req.body || {};
  const updated = await prisma.brand.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: String(name) } : {}),
      ...(slug !== undefined ? { slug: String(slug) } : {}),
      ...(logoUrl !== undefined ? { logoUrl: logoUrl ? String(logoUrl) : null } : {}),
      ...(isActive !== undefined ? { isActive: !!isActive } : {}),
    },
  });
  res.json({ ok: true, brand: updated });
});

// DELETE /api/admin/brands/:id
r.delete('/:id', requireSuperAdmin, requireAdmin, async (req, res, next) => {
  try {
    const id = requiredString(req.params.id);

    const used = await prisma.product.count({ where: { brandId: id } });
    if (used > 0) {
      return res.status(409).json({ error: 'Cannot delete: brand is in use by products' });
    }

    await prisma.brand.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});


export default r ;
