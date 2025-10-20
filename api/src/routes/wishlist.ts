// api/src/routes/favorites.ts
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthedRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

// All routes require auth
router.use(authMiddleware);

/**
 * GET /api/favorites/mine
 * Returns a compact list of product ids in the user's wishlist.
 */
router.get('/mine', async (req: AuthedRequest, res, next) => {
  try {
    const rows = await prisma.favorite.findMany({
      where: { userId: req.user!.id },
      select: { productId: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ productIds: rows.map((r: { productId: any; }) => r.productId) });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/favorites/toggle
 * Body: { productId: string }
 * Toggles a favorite. Response: { favorited: boolean }
 */
const ToggleSchema = z.object({
  productId: z.string().min(1, 'productId required'),
});

router.post('/toggle', async (req: AuthedRequest, res, next) => {
  try {
    const { productId } = ToggleSchema.parse(req.body);

    // Check if exists
    const existing = await prisma.favorite.findUnique({
      where: {
        userId_productId: {
          userId: req.user!.id,
          productId,
        },
      },
    });

    if (existing) {
      await prisma.favorite.delete({ where: { id: existing.id } });
      return res.json({ favorited: false });
    } else {
      // (optional) ensure product exists & is visible
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) return res.status(404).json({ error: 'Product not found' });

      await prisma.favorite.create({
        data: {
          userId: req.user!.id,
          productId,
        },
      });
      return res.json({ favorited: true });
    }
  } catch (e) {
    next(e);
  }
});

export default router;
