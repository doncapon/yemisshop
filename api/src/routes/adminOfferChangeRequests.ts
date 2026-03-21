// api/src/routes/adminOfferChangeRequests.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

/**
 * Small async wrapper (same idea you use elsewhere)
 */
function wrap(fn: any) {
  return (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);
}

function toPositiveInt(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return v > 0 ? v : fallback;
}

/**
 * GET /api/admin/offer-change-requests
 * Optional query:
 *   - status=PENDING|APPROVED|REJECTED|CANCELED|EXPIRED|ANY
 *   - scope=BASE_OFFER|VARIANT_OFFER|ANY
 *   - page=1..n
 *   - pageSize=1..100
 */
router.get(
  "/",
  requireAdmin,
  wrap(
    async (
      req: {
        query: {
          status?: any;
          scope?: any;
          page?: any;
          pageSize?: any;
        };
      },
      res: {
        json: (arg0: {
          data: any[];
          total: number;
          page: number;
          pageSize: number;
          totalPages: number;
        }) => any;
      }
    ) => {
      const statusRaw = String(req.query.status ?? "PENDING").toUpperCase();
      const scopeRaw = String(req.query.scope ?? "ANY").toUpperCase();

      const page = toPositiveInt(req.query.page, 1);
      const pageSizeRaw = toPositiveInt(req.query.pageSize, 20);
      const pageSize = Math.min(pageSizeRaw, 100);
      const skip = (page - 1) * pageSize;

      const where: any = {};
      if (statusRaw !== "ANY") where.status = statusRaw;
      if (scopeRaw !== "ANY") where.scope = scopeRaw;

      const [total, rows] = await Promise.all([
        prisma.supplierOfferChangeRequest.count({ where }),
        prisma.supplierOfferChangeRequest.findMany({
          where,
          orderBy: { requestedAt: "desc" },
          skip,
          take: pageSize,
          select: {
            id: true,
            status: true,
            scope: true,

            supplierId: true,
            productId: true,

            supplierProductOfferId: true,
            supplierVariantOfferId: true,

            // real fields on SupplierOfferChangeRequest
            patchJson: true,
            note: true,
            requestedByUserId: true,
            reviewedByUserId: true,
            requestedAt: true,
            reviewedAt: true,
            reviewNote: true,
            createdAt: true,
            updatedAt: true,

            supplier: { select: { id: true, name: true } },
            product: { select: { id: true, title: true, sku: true } },

            // if UI needs variantId, it's on SupplierVariantOffer
            supplierVariantOffer: {
              select: {
                id: true,
                variantId: true,
              },
            },

            requestedBy: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
            reviewedBy: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
      ]);

      /**
       * Backward-compat mapping:
       * Older UI may expect:
       *  - proposedPatch
       *  - currentSnapshot
       *  - variantId
       */
      const data = rows.map((r: any) => ({
        ...r,
        proposedPatch: r.patchJson ?? null,
        currentSnapshot: null,
        variantId: r.supplierVariantOffer?.variantId ?? null,
      }));

      const totalPages = Math.max(1, Math.ceil(total / pageSize));

      return res.json({
        data,
        total,
        page,
        pageSize,
        totalPages,
      });
    }
  )
);

export default router;