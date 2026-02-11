import { Router } from 'express';
import { requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { requiredString } from '../lib/http.js';

const r = Router();

/* ---------------- Helpers ---------------- */

function isNonEmptyString(v: any): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/* ---------------- Catalog: Attributes & Values ---------------- */

// GET /api/admin/attributes
r.get('/', async (_req, res) => {
  const rows = await prisma.attribute.findMany({
    orderBy: [{ name: 'asc' }],
    include: {
      values: {
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      },
    },
  });

  res.json({ data: rows });
});

// POST /api/admin/attributes
r.post('/', requireSuperAdmin,  requireAdmin, async (req, res) => {
  const { name, type = 'SELECT', isActive = true } = req.body || {};

  if (!isNonEmptyString(name)) {
    return res.status(400).json({ error: 'name required' });
  }

  try {
    const created = await prisma.attribute.create({
      data: {
        name: String(name).trim(),
        type: String(type),
        isActive: !!isActive,
      },
    });

    res.json({ ok: true, attribute: created });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      // unique constraint (e.g. name)
      return res
        .status(409)
        .json({ error: 'Attribute with this name already exists' });
    }
    throw e;
  }
});

// PUT /api/admin/attributes/:id
r.put('/:id', requireSuperAdmin, requireAdmin,async (req, res) => {
  const id = requiredString(req.params.id);
  const { name, type, isActive } = req.body || {};

  const data: any = {};
  if (name !== undefined) {
    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: 'name cannot be empty' });
    }
    data.name = String(name).trim();
  }
  if (type !== undefined) data.type = String(type);
  if (isActive !== undefined) data.isActive = !!isActive;

  try {
    const updated = await prisma.attribute.update({
      where: { id },
      data,
    });

    res.json({ ok: true, attribute: updated });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return res
        .status(409)
        .json({ error: 'Attribute with this name already exists' });
    }
    throw e;
  }
});

/* ---------------- Attribute Values (Options) ---------------- */

// POST /api/admin/attributes/:attributeId/values
// Require: name, code (non-empty), and enforce unique code
r.post('/:attributeId/values', requireSuperAdmin, requireAdmin, async (req, res) => {
  const attributeId = requiredString(req.params.attributeId);
  const { name, code, position = 0, isActive = true } = req.body || {};

  if (!isNonEmptyString(name)) {
    return res.status(400).json({ error: 'name required' });
  }
  if (!isNonEmptyString(code)) {
    return res.status(400).json({ error: 'code required' });
  }

  const cleanCode = String(code).trim();

  // Ensure code is globally unique across AttributeValue
  const existing = await prisma.attributeValue.findFirst({
    where: { code: cleanCode },
  });
  if (existing) {
    return res
      .status(409)
      .json({ error: 'code must be unique across attribute values' });
  }

  const created = await prisma.attributeValue.create({
    data: {
      attributeId,
      name: String(name).trim(),
      code: cleanCode,
      position: Number(position) || 0,
      isActive: !!isActive,
    },
  });

  res.json({ ok: true, value: created });
});

// PUT /api/admin/attributes/:attributeId/values/:id
// If code is provided, it must be non-empty & unique
r.put('/:attributeId/values/:id', requireSuperAdmin, async (req, res) => {
  const id = requiredString(req.params.id);
  const { name, code, position, isActive } = req.body || {};

  const data: any = {};

  if (name !== undefined) {
    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: 'name cannot be empty' });
    }
    data.name = String(name).trim();
  }

  if (code !== undefined) {
    if (!isNonEmptyString(code)) {
      return res.status(400).json({ error: 'code cannot be empty' });
    }
    const cleanCode = String(code).trim();

    // Unique among all other values
    const existing = await prisma.attributeValue.findFirst({
      where: {
        code: cleanCode,
        NOT: { id },
      },
    });
    if (existing) {
      return res
        .status(409)
        .json({ error: 'code must be unique across attribute values' });
    }

    data.code = cleanCode;
  }

  if (position !== undefined) {
    const n = Number(position);
    if (!Number.isFinite(n)) {
      return res.status(400).json({ error: 'position must be a number' });
    }
    data.position = n;
  }

  if (isActive !== undefined) {
    data.isActive = !!isActive;
  }

  const updated = await prisma.attributeValue.update({
    where: { id },
    data,
  });

  res.json({ ok: true, value: updated });
});

// DELETE /api/admin/attributes/:attributeId/values/:id
r.delete('/:attributeId/values/:id', requireSuperAdmin, async (req, res) => {
  const id = requiredString(req.params.id);
  await prisma.attributeValue.delete({ where: { id } });
  res.json({ ok: true });
});

/* ---------------- Delete Attribute ---------------- */

// DELETE /api/admin/attributes/:id
r.delete('/:id', requireSuperAdmin,  requireAdmin, async (req, res, next) => {
  try {
    const id = requiredString(req.params.id);

    // Check if attribute is used anywhere before deleting
    let used = 0;

    // These guards are wrapped in try in case some models don't exist in schema
    try {
      // If you have a ProductAttributeValue-like model:
      // @ts-ignore
      used += await prisma.productAttributeValue.count({
        where: { attributeId: id },
      });
    } catch {}

    try {
      used += await prisma.productVariantOption.count({
        where: { attributeId: id },
      });
    } catch {}

    if (used > 0) {
      return res
        .status(409)
        .json({ error: 'Cannot delete: attribute is in use' });
    }

    await prisma.attribute.delete({ where: { id } });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default r;
