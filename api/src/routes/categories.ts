import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';

const router = Router();

// Public
router.get('/', async (_req, res) => {
  const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
  res.json(categories);
});

// Admin CRUD
const categorySchema = z.object({ name: z.string().min(2), parentId: z.string().optional() });

router.post('/', auth(), requireRole('ADMIN'), async (req, res) => {
  const data = categorySchema.parse(req.body);
  const cat = await prisma.category.create({ data });
  res.status(201).json(cat);
});

router.put('/:id', auth(), requireRole('ADMIN'), async (req, res) => {
  const data = categorySchema.partial().parse(req.body);
  const cat = await prisma.category.update({ where: { id: req.params.id }, data });
  res.json(cat);
});

router.delete('/:id', auth(), requireRole('ADMIN'), async (req, res) => {
  await prisma.category.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
