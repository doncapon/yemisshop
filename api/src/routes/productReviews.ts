// api/src/routes/productReviews.ts
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { recomputeSupplierRatingWithReviews } from "../services/supplierRating.service.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const wrap =
  (fn: (req: Request, res: Response) => any) =>
  (req: Request, res: Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

const ReviewBodySchema = z.object({
  rating: z.coerce.number().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  comment: z.string().trim().max(2000).optional(),
  variantId: z.string().trim().optional(),
});

/**
 * Check if this user actually bought this product from this supplier
 * (for "verified purchase" badge).
 *
 * NOTE: adjust `order: { userId }` if your schema uses `shopperId` etc.
 */
async function isVerifiedPurchase(opts: {
  userId: string;
  supplierId: string;
  productId: string;
}) {
  const { userId, supplierId, productId } = opts;

  const item = await prisma.orderItem.findFirst({
    where: {
      productId,
      chosenSupplierId: supplierId,
      order: {
        userId, // 🔁 change to shopperId if needed
      } as any,
    } as any,
    select: { id: true, orderId: true },
  });

  if (!item) return { verified: false, orderId: null };
  return { verified: true, orderId: item.orderId ?? null };
}

/* -------------------------------------------------------------------------- */
/* POST /api/products/:productId/reviews                                      */
/* -------------------------------------------------------------------------- */
/**
 * Body: { rating: 1–5, title?, comment?, variantId? }
 *
 * One review per (supplierId, productId, userId) using
 * @@unique([supplierId, productId, userId]) => SupplierReview_user_product_unique
 */
router.post(
  "/products/:productId/reviews",
  requireAuth,
  wrap(async (req: any, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const productId = String(req.params.productId ?? "");
    const parsed = ReviewBodySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid payload",
        details: parsed.error.flatten(),
      });
    }

    const { rating, title, comment, variantId } = parsed.data;

    // 1) Load product + supplierId (one supplier per product in your model)
    const product = await prisma.product.findFirst({
      where: { id: productId },
      select: { id: true, supplierId: true },
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    if (!product.supplierId) {
      return res
        .status(400)
        .json({ error: "Product is not linked to a supplier" });
    }

    const supplierId = String(product.supplierId);

    // 2) Check verified purchase
    const { verified, orderId } = await isVerifiedPurchase({
      userId: String(userId),
      supplierId,
      productId,
    });

    // 3) Upsert review (one review per user per product per supplier)
    const review = await prisma.supplierReview.upsert({
      where: {
        SupplierReview_user_product_unique: {
          supplierId,
          productId,
          userId: String(userId),
        },
      },
      update: {
        rating,
        title: title ?? null,
        comment: comment ?? null,
        variantId: variantId ?? null,
        verifiedPurchase: verified,
        // keep existing purchaseOrderId if already set
        purchaseOrderId: orderId ?? undefined,
      },
      create: {
        supplierId,
        productId,
        userId: String(userId),
        rating,
        title: title ?? null,
        comment: comment ?? null,
        variantId: variantId ?? null,
        verifiedPurchase: verified,
        purchaseOrderId: orderId ?? null, // field is nullable in your schema
      },
      select: {
        id: true,
        supplierId: true,
        productId: true,
        variantId: true,
        userId: true,
        rating: true,
        title: true,
        comment: true,
        verifiedPurchase: true,
        purchaseOrderId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 4) Recompute combined rating and persist on Supplier
    const { ratingAvg, ratingCount } =
      await recomputeSupplierRatingWithReviews(supplierId);

    return res.status(200).json({
      data: {
        review,
        supplierRating: {
          ratingAvg,
          ratingCount,
        },
      },
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/products/:productId/reviews                                       */
/* -------------------------------------------------------------------------- */
/**
 * Public list of reviews for a product, + average rating.
 *
 * ✅ Uses Prisma.validator so rows are typed with `user`, fixing
 * "Property 'user' does not exist on type …".
 */
router.get(
  "/products/:productId/reviews",
  wrap(async (req: Request, res: Response) => {
    // 🔧 Coerce route param to simple string so Prisma is happy
    const productId = String(req.params.productId ?? "");

    // Define the select using Prisma.validator to get a typed payload
    const reviewWithUserSelect =
      Prisma.validator<Prisma.SupplierReviewFindManyArgs>()({
        where: { productId }, // `productId` is now a plain string
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          rating: true,
          title: true,
          comment: true,
          verifiedPurchase: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

    const [rows, agg] = await Promise.all([
      prisma.supplierReview.findMany(reviewWithUserSelect),
      prisma.supplierReview.aggregate({
        where: { productId },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);

    const avg = agg._avg.rating ?? 0;
    const count = agg._count._all ?? 0;

    return res.json({
      data: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        comment: r.comment,
        verifiedPurchase: r.verifiedPurchase,
        createdAt: r.createdAt,
        user: {
          id: r.user.id,
          firstName: r.user.firstName ?? null,
          lastName: r.user.lastName ?? null,
          email: r.user.email ?? null,
        },
      })),
      summary: {
        ratingAvg: Number(avg) || 0,
        ratingCount: count,
      },
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/products/:productId/reviews/summary                               */
/* -------------------------------------------------------------------------- */
/**
 * Lightweight summary endpoint for the product detail badge:
 * returns only { ratingAvg, ratingCount }.
 */
router.get(
  "/products/:productId/reviews/summary",
  wrap(async (req: Request, res: Response) => {
    const productId = String(req.params.productId ?? "");

    const agg = await prisma.supplierReview.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { _all: true },
    });

    const ratingAvg = Number(agg._avg.rating ?? 0) || 0;
    const ratingCount = agg._count._all ?? 0;

    return res.json({
      data: {
        ratingAvg,
        ratingCount,
      },
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/products/:productId/reviews/my                                    */
/* -------------------------------------------------------------------------- */
/**
 * Get the current authenticated user's review for this product (if any).
 */
router.get(
  "/products/:productId/reviews/my",
  requireAuth,
  wrap(async (req: any, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const productId = String(req.params.productId ?? "");

    const review = await prisma.supplierReview.findFirst({
      where: {
        productId,
        userId: String(userId),
      },
      select: {
        id: true,
        supplierId: true,
        productId: true,
        variantId: true,
        userId: true,
        rating: true,
        title: true,
        comment: true,
        verifiedPurchase: true,
        purchaseOrderId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Frontend is usually fine with null if user hasn't reviewed yet
    return res.json({
      data: review ?? null,
    });
  })
);

/* ------------------------------------------------------------------
 * DELETE /api/products/:id/reviews/my
 * ------------------------------------------------------------------
 * Removes the current user's review(s) for this product.
 * Uses SupplierReview model (your schema).
 * ------------------------------------------------------------------*/
router.delete(
  "/products/:id/reviews/my",
  requireAuth,
  wrap(async (req: any, res: Response) => {
    const productId = String(req.params.id ?? "");
    const userId = req.user?.id as string | undefined;

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Delete all reviews this user left for this product (any supplier)
    const deleteResult = await prisma.supplierReview.deleteMany({
      where: {
        userId: String(userId),
        productId,
      },
    });

    // For the "reset my rating" UX it's nicer to always return success
    if (deleteResult.count === 0) {
      return res.json({
        data: {
          success: true,
          deletedCount: 0,
          ratingAvg: null,
          ratingCount: 0,
        },
      });
    }

    // Recompute aggregate for this product from SupplierReview
    const agg = await prisma.supplierReview.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { _all: true },
    });

    const ratingAvg = agg._avg.rating ?? null;
    const ratingCount = agg._count._all ?? 0;

    return res.json({
      data: {
        success: true,
        deletedCount: deleteResult.count,
        ratingAvg,
        ratingCount,
      },
    });
  })
);

export default router;