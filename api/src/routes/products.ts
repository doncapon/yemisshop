import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

const router = Router();

function toProductDTO(p: any) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    price: Number(p.price),      // <- normalize Decimal -> number
    sku: p.sku,
    stock: p.stock,
    vatFlag: p.vatFlag,
    status: p.status,
    imagesJson: p.imagesJson,            // text[]
    supplierId: p.supplierId,
    supplierTypeOverride: p.supplierTypeOverride,
    commissionPctInt: p.commissionPctInt ?? null,
    categoryId: p.categoryId,
    categoryName: p.categoryName
  };
}

// List products
router.get('/', async (_req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        price: true,
        imagesJson: true,       // must be an array column (e.g. text[])
        categoryId: true,
        category: { select: { name: true } },
      },
    });

    res.json(
      products.map((p: { id: any; title: any; description: any; price: any; imagesJson: any; categoryId: any; category: { name: any; }; }) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        price: Number(p.price),          // send number to the UI
        imagesJson: p.imagesJson ?? [],  // fallback to []
        categoryId: p.categoryId,
        categoryName: p.category?.name ?? null,
      }))
    );
  } catch (e) { next(e); }
});

// Single product
router.get('/:id', async (req, res, next) => {
  try {
    const p = await prisma.product.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, title: true, description: true, price: true,
        imagesJson: true, categoryId: true,
        category: { select: { name: true } },
      },
    });
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({
      id: p.id,
      title: p.title,
      description: p.description,
      price: Number(p.price),
      imagesJson: p.imagesJson ?? [],
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
    });
  } catch (e) { next(e); }
});


router.get('/:id', async (req, res, next) => {
  try {
    const p = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(toProductDTO(p));
  } catch (e) {
    next(e);
  }
});


router.get('/:id/similar', async (req, res, next) => {
  try {
    const { id } = req.params;
    const me = await prisma.product.findUnique({ where: { id } });
    if (!me) return res.status(404).json({ error: 'Product not found' });

    const byCat = await prisma.product.findMany({
      where: { id: { not: id }, categoryId: me.categoryId ?? undefined },
      take: 12,
      orderBy: { createdAt: 'desc' },
    });

    // Fallback by price window if category is empty
    let results = byCat;
    if (results.length < 6) {
      const price = Number(me.price) || 0;
      const window = { min: Math.max(0, price * 0.6), max: price * 1.4 };
      const byPrice = await prisma.product.findMany({
        where: {
          id: { not: id },
          price: { gte: window.min, lte: window.max },
        },
        take: 12,
        orderBy: { createdAt: 'desc' },
      });
      // merge unique
      const seen = new Set(results.map((r: { id: any; }) => r.id));
      for (const p of byPrice) if (!seen.has(p.id)) results.push(p);
    }

    res.json(results.slice(0, 12));
  } catch (e) { next(e); }
});


export default router;
