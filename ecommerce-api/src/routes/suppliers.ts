import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';

const router = Router();

const supplierSchema = z.object({
  name: z.string().min(2),
  contactEmail: z.string().email().optional(),
  whatsappPhone: z.string().optional(), // E.164
  status: z.enum(['ACTIVE','DISABLED']).optional(),
  type: z.enum(['PHYSICAL','ONLINE']).optional(),
  apiBaseUrl: z.string().url().optional(),
  apiAuthType: z.enum(['BEARER','BASIC']).optional(),
  apiKey: z.string().optional(),
  payoutPct: z.coerce.number().min(0).max(100).optional(),
  userId: z.string().optional()
});

router.get('/', auth(), requireRole('ADMIN'), async (_req, res) => {
  res.json(await prisma.supplier.findMany());
});

router.post('/', auth(), requireRole('ADMIN'), async (req, res) => {
  const data = supplierSchema.parse(req.body);
  res.status(201).json(await prisma.supplier.create({ data }));
});

router.put('/:id', auth(), requireRole('ADMIN'), async (req, res) => {
  const data = supplierSchema.partial().parse(req.body);
  res.json(await prisma.supplier.update({ where: { id: req.params.id }, data }));
});

export default router;
