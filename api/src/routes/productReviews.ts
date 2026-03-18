// api/src/routes/productReviews.ts
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { Prisma, PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { recomputeSupplierRatingWithReviews } from "../services/supplierRating.service.js";

const router = express.Router();

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

async function getVerifiedDeliveredPurchase(opts: {
  userId: string;
  productId: string;
  supplierId: string;
}) {
  const { userId, productId, supplierId } = opts;

  const poItem = await prisma.purchaseOrderItem.findFirst({
    where: {
      purchaseOrder: {
        supplierId,
        status: PurchaseOrderStatus.DELIVERED,
        order: {
          userId,
        },
      },
      orderItem: {
        productId,
      },
    },
    orderBy: {
      purchaseOrder: {
        deliveredAt: "desc",
      },
    },
    select: {
      purchaseOrderId: true,
      orderItem: {
        select: {
          variantId: true,
          productId: true,
        },
      },
      purchaseOrder: {
        select: {
          id: true,
          status: true,
          deliveredAt: true,
        },
      },
    },
  });

  if (!poItem?.purchaseOrderId) {
    return {
      verified: false,
      purchaseOrderId: null as string | null,
      variantId: null as string | null,
    };
  }

  return {
    verified: true,
    purchaseOrderId: poItem.purchaseOrderId,
    variantId: poItem.orderItem?.variantId ? String(poItem.orderItem.variantId) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* POST /api/products/:productId/reviews                                      */
/* -------------------------------------------------------------------------- */
router.post(
  "/products/:productId/reviews",
  requireAuth,
  wrap(async (req: any, res: Response) => {
    const userId = String(req.user?.id ?? "");
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const productId = String(req.params.productId ?? "").trim();
    if (!productId) {
      return res.status(400).json({ error: "Missing productId" });
    }

    const parsed = ReviewBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid payload",
        details: parsed.error.flatten(),
      });
    }

    const { rating, title, comment, variantId } = parsed.data;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        supplierId: true,
      },
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    if (!product.supplierId) {
      return res.status(400).json({
        error: "Product is not linked to a supplier",
      });
    }

    const supplierId = String(product.supplierId);

    const purchase = await getVerifiedDeliveredPurchase({
      userId,
      productId,
      supplierId,
    });

    if (!purchase.verified || !purchase.purchaseOrderId) {
      return res.status(403).json({
        error: "Only customers who bought and received this product can review it.",
      });
    }

    if (variantId) {
      const variant = await prisma.productVariant.findFirst({
        where: {
          id: String(variantId),
          productId,
        },
        select: { id: true },
      });

      if (!variant) {
        return res.status(400).json({
          error: "Selected variant does not belong to this product.",
        });
      }
    }

    const review = await prisma.supplierReview.upsert({
      where: {
        SupplierReview_user_product_unique: {
          supplierId,
          productId,
          userId,
        },
      },
      update: {
        rating,
        title: title ?? null,
        comment: comment ?? null,
        variantId: variantId ?? null,
        verifiedPurchase: true,
        purchaseOrderId: purchase.purchaseOrderId,
      },
      create: {
        supplierId,
        productId,
        userId,
        rating,
        title: title ?? null,
        comment: comment ?? null,
        variantId: variantId ?? purchase.variantId ?? null,
        verifiedPurchase: true,
        purchaseOrderId: purchase.purchaseOrderId,
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
router.get(
  "/products/:productId/reviews",
  wrap(async (req: Request, res: Response) => {
    const productId = String(req.params.productId ?? "").trim();

    const reviewWithUserSelect =
      Prisma.validator<Prisma.SupplierReviewFindManyArgs>()({
        where: { productId },
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
        },
      })),
      summary: {
        ratingAvg: Number(agg._avg.rating ?? 0) || 0,
        ratingCount: agg._count._all ?? 0,
      },
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/products/:productId/reviews/summary                               */
/* -------------------------------------------------------------------------- */
router.get(
  "/products/:productId/reviews/summary",
  wrap(async (req: Request, res: Response) => {
    const productId = String(req.params.productId ?? "").trim();

    const agg = await prisma.supplierReview.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { _all: true },
    });

    return res.json({
      data: {
        ratingAvg: Number(agg._avg.rating ?? 0) || 0,
        ratingCount: agg._count._all ?? 0,
      },
    });
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/products/:productId/reviews/my                                    */
/* -------------------------------------------------------------------------- */
router.get(
  "/products/:productId/reviews/my",
  requireAuth,
  wrap(async (req: any, res: Response) => {
    const userId = String(req.user?.id ?? "");
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const productId = String(req.params.productId ?? "").trim();

    const review = await prisma.supplierReview.findFirst({
      where: {
        productId,
        userId,
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

    return res.json({
      data: review ?? null,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* DELETE /api/products/:id/reviews/my                                        */
/* -------------------------------------------------------------------------- */
router.delete(
  "/products/:id/reviews/my",
  requireAuth,
  wrap(async (req: any, res: Response) => {
    const productId = String(req.params.id ?? "").trim();
    const userId = String(req.user?.id ?? "");

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const deleteResult = await prisma.supplierReview.deleteMany({
      where: {
        userId,
        productId,
      },
    });

    const agg = await prisma.supplierReview.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { _all: true },
    });

    return res.json({
      data: {
        success: true,
        deletedCount: deleteResult.count,
        ratingAvg: agg._avg.rating ?? null,
        ratingCount: agg._count._all ?? 0,
      },
    });
  })
);

export default router;