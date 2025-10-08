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

export default router;
