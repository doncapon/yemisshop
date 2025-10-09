import { Router } from 'express';
import { authMiddleware, AuthedRequest} from '../lib/authMiddleware.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

// Get my wishlist (ids or full products)
router.get('/', authMiddleware, async (req: AuthedRequest, res, next) => {
  try {
    const favs = await prisma.favorite.findMany({
      where: { userId: req.user!.id },
      select: { productId: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ productIds: favs.map((f: { productId: any; }) => f.productId) });
  } catch (e) { next(e); }
});

// Toggle (add if missing, remove if present)
router.post('/toggle/:productId', authMiddleware, async (req: AuthedRequest, res, next) => {
  try {
    const { productId } = req.params;
    const existing = await prisma.favorite.findUnique({
      where: { userId_productId: { userId: req.user!.id, productId } },
    });

    if (existing) {
      await prisma.favorite.delete({ where: { id: existing.id } });
      return res.json({ liked: false });
    } else {
      await prisma.favorite.create({
        data: { userId: req.user!.id, productId },
      });
      return res.json({ liked: true });
    }
  } catch (e) { next(e); }
});


router.use(authMiddleware);

// List ids
router.get('/', async (req: any, res, next) => {
  try {
    const userId = req.user.id;
    const rows = await prisma.wishlist.findMany({
      where: { userId },
      select: { productId: true },
    });
    res.json({ productIds: rows.map((r: { productId: any; }) => r.productId) });
  } catch (e) { next(e); }
});

// Toggle single product
router.post('/toggle', async (req: any, res, next) => {
  try {
    const userId = req.user.id;
    const { productId } = req.body as { productId: string };
    if (!productId) return res.status(400).json({ error: 'productId required' });

    const existing = await prisma.wishlist.findUnique({
      where: { userId_productId: { userId, productId } },
    });

    if (existing) {
      await prisma.wishlist.delete({
        where: { userId_productId: { userId, productId } },
      });
      return res.json({ liked: false });
    } else {
      await prisma.wishlist.create({ data: { userId, productId } });
      return res.json({ liked: true });
    }
  } catch (e) { next(e); }
});

export default router;
