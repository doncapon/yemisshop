import { Router } from 'express';
import {  requireSuperAdmin} from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';


const r = Router();
/* ---------------- Catalog: Attributes & Values ---------------- */
r.get('/', async (_req, res) => {
  const rows = await prisma.attribute.findMany({
    orderBy: [{ name: 'asc' }],
    include: { values: { orderBy: [{ position: 'asc' }, { name: 'asc' }] } },
  });
  res.json({ data: rows });
});

r.post('/', requireSuperAdmin, async (req, res) => {
  const { name, type = 'SELECT', isActive = true } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const created = await prisma.attribute.create({
    data: { name: String(name), type: String(type), isActive: !!isActive },
  });
  res.json({ ok: true, attribute: created });
});

r.put('/:id', requireSuperAdmin, async (req, res) => {
  const id = req.params.id;
  const { name, type, isActive } = req.body || {};
  const updated = await prisma.attribute.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: String(name) } : {}),
      ...(type !== undefined ? { type: String(type) } : {}),
      ...(isActive !== undefined ? { isActive: !!isActive } : {}),
    },
  });
  res.json({ ok: true, attribute: updated });
});

// Values
r.post('/:attributeId/values', requireSuperAdmin, async (req, res) => {
  const attributeId = req.params.attributeId;
  const { name, code = null, position = 0, isActive = true } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const created = await prisma.attributeValue.create({
    data: { attributeId, name: String(name), code: code ? String(code) : null, position: Number(position) || 0, isActive: !!isActive },
  });
  res.json({ ok: true, value: created });
});

r.put('/:attributeId/values/:id', requireSuperAdmin, async (req, res) => {
  const id = req.params.id;
  const { name, code, position, isActive } = req.body || {};
  const updated = await prisma.attributeValue.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: String(name) } : {}),
      ...(code !== undefined ? { code: code ? String(code) : null } : {}),
      ...(position !== undefined ? { position: Number(position) } : {}),
      ...(isActive !== undefined ? { isActive: !!isActive } : {}),
    },
  });
  res.json({ ok: true, value: updated });
});

r.delete('/:attributeId/values/:id', requireSuperAdmin, async (req, res) => {
  const id = req.params.id;
  await prisma.attributeValue.delete({ where: { id } });
  res.json({ ok: true });
});





// DELETE /api/admin/attributes/:id
r.delete('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const id = req.params.id;

    // Any product attribute/value using this?
    let used = 0;
    try {
      used += await prisma.productAttributeValue.count({ where: { attributeId: id } });
    } catch {}
    try {
      used += await prisma.productVariantOption.count({ where: { attributeId: id } });
    } catch {}

    if (used > 0) {
      return res.status(409).json({ error: 'Cannot delete: attribute is in use' });
    }

    await prisma.attribute.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});


export default r;