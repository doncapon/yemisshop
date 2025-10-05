// src/routes/categories.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../lib/authMiddleware.js';

const router = Router();

// Public: list categories
router.get('/', async (_req, res, next) => {
  try {
    const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    res.json(categories);
  } catch (e) {
    next(e);
  }
});

// Admin CRUD
// If your Category model does not have parentId, keep schema to just { name }
const categorySchema = z.object({
  name: z.string().min(2),
  // parentId: z.string().optional(), // <-- enable only if your schema supports it
});

router.post(
  '/',
  authMiddleware,
  requireRole(['ADMIN']),
  async (req, res, next) => {
    try {
      const data = categorySchema.parse(req.body);
      const cat = await prisma.category.create({ data });
      res.status(201).json(cat);
    } catch (e) {
      next(e);
    }
  }
);

router.put(
  '/:id',
  authMiddleware,
  requireRole(['ADMIN']),
  async (req, res, next) => {
    try {
      const data = categorySchema.partial().parse(req.body);
      const cat = await prisma.category.update({ where: { id: req.params.id }, data });
      res.json(cat);
    } catch (e) {
      next(e);
    }
  }
);

router.delete(
  '/:id',
  authMiddleware,
  requireRole(['ADMIN']),
  async (req, res, next) => {
    try {
      await prisma.category.delete({ where: { id: req.params.id } });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  }
);

export default router;
