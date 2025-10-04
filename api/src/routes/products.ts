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

router.get('/', async (_req, res, next) => {
  try {
    const products = await prisma.product.findMany();
    res.json(products.map(toProductDTO));
  } catch (e) {
    next(e);
  }
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
