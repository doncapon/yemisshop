// src/routes/suppliers.ts
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';

const router = Router();

// Zod schema for incoming payloads (note: payoutPct maps to Prisma's)
const supplierSchema = z.object({
  name: z.string().min(2),
  contactEmail: z.string().email().optional(),
  whatsappPhone: z.string().optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  type: z.enum(['PHYSICAL', 'ONLINE']).optional(),
  apiBaseUrl: z.string().url().optional(),
  apiAuthType: z.enum(['BEARER', 'BASIC']).optional(),
  apiKey: z.string().optional(),
  payoutPct: z.coerce.number().min(0).max(100).optional(),
  userId: z.string().optional(),
});

// map API payload → Prisma create shape
function toCreateData(input: z.infer<typeof supplierSchema>) {
  return {
    name: input.name,
    contactEmail: input.contactEmail ?? null,
    whatsappPhone: input.whatsappPhone ?? null,
    status: input.status ?? 'ACTIVE',
    type: input.type ?? 'PHYSICAL',
    apiBaseUrl: input.apiBaseUrl ?? null,
    apiAuthType: input.apiAuthType ?? null,
    apiKey: input.apiKey ?? null,
    userId: input.userId ?? null,
  };
}

// map partial payload → Prisma update shape
function toUpdateData(input: Partial<z.infer<typeof supplierSchema>>) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail ?? null;
  if (input.whatsappPhone !== undefined) data.whatsappPhone = input.whatsappPhone ?? null;
  if (input.status !== undefined) data.status = input.status;
  if (input.type !== undefined) data.type = input.type;
  if (input.apiBaseUrl !== undefined) data.apiBaseUrl = input.apiBaseUrl ?? null;
  if (input.apiAuthType !== undefined) data.apiAuthType = input.apiAuthType ?? null;
  if (input.apiKey !== undefined) data.apiKey = input.apiKey ?? null;
  if (input.userId !== undefined) data.userId = input.userId ?? null;
  return data;
}

// Cast your middlewares to generic RequestHandler to satisfy Express overloads
const adminOnly: RequestHandler[] = [
  auth() as unknown as RequestHandler,
  requireRole('ADMIN') as unknown as RequestHandler,
];

// List suppliers (ADMIN)
router.get('/', ...adminOnly, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const suppliers = await prisma.supplier.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(suppliers);
  } catch (e) {
    next(e);
  }
});

// Create supplier (ADMIN)
router.post('/', ...adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = supplierSchema.parse(req.body);
    const created = await prisma.supplier.create({ data: toCreateData(parsed) });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

// Update supplier (ADMIN)
router.put('/:id', ...adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = supplierSchema.partial().parse(req.body);
    const updated = await prisma.supplier.update({
      where: { id: req.params.id },
      data: toUpdateData(parsed),
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
