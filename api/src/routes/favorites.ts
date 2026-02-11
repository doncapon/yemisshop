// api/src/routes/favorites.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

/**
 * GET /api/favorites/mine
 * Returns { productIds: string[] }
 */
router.get("/mine", requireAuth, async (req, res, next) => {
  try {
    const rows = await prisma.favorite.findMany({
      where: { userId: req.user!.id },
      select: { productId: true },
      orderBy: { createdAt: "desc" },
    });

    res.json({ productIds: rows.map((r) => r.productId) });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/favorites/toggle
 * Body: { productId: string }
 * Returns { favorited: boolean }
 */
router.post("/toggle", requireAuth, async (req, res, next) => {
  try {
    const { productId } = req.body as { productId?: string };
    if (!productId) return res.status(400).json({ error: "productId is required" });

    const existing = await prisma.favorite.findUnique({
      where: { userId_productId: { userId: req.user!.id, productId } },
      select: { id: true },
    });

    if (existing) {
      await prisma.favorite.delete({
        where: { userId_productId: { userId: req.user!.id, productId } },
      });
      return res.json({ favorited: false });
    }

    // verify product exists (optional but nice)
    const prod = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!prod) return res.status(404).json({ error: "Product not found" });

    await prisma.favorite.create({
      data: { userId: req.user!.id, productId },
    });

    return res.json({ favorited: true });
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/favorites/:productId
 * Remove a single favorite
 */
router.delete("/:productId", requireAuth, async (req, res, next) => {
  try {
    const productId = String(req.params.productId || "").trim();
    if (!productId) return res.status(400).json({ error: "productId is required" });

    await prisma.favorite
      .delete({
        where: {
          userId_productId: {
            userId: req.user!.id,
            productId,
          },
        },
      })
      .catch(() => {
        // ignore if not found
      });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/favorites
 * Clear all favorites for current user
 */
router.delete("/", requireAuth, async (req, res, next) => {
  try {
    await prisma.favorite.deleteMany({ where: { userId: req.user!.id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
