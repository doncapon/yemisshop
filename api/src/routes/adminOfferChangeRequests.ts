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

/**
 * GET /api/admin/offer-change-requests
 * Optional query:
 *   - status=PENDING|APPROVED|REJECTED|CANCELED|EXPIRED|ANY
 *   - scope=BASE_OFFER|VARIANT_OFFER|ANY
 */
router.get(
  "/",
  requireAdmin,
  wrap(async (req: { query: { status: any; scope: any; }; }, res: { json: (arg0: { data: any; }) => any; }) => {
    const statusRaw = String(req.query.status ?? "PENDING").toUpperCase();
    const scopeRaw = String(req.query.scope ?? "ANY").toUpperCase();

    const where: any = {};
    if (statusRaw !== "ANY") where.status = statusRaw;
    if (scopeRaw !== "ANY") where.scope = scopeRaw;

    const rows = await prisma.supplierOfferChangeRequest.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      select: {
        id: true,
        status: true,
        scope: true,

        supplierId: true,
        productId: true,

        supplierProductOfferId: true,
        supplierVariantOfferId: true,

        // ✅ real fields on SupplierOfferChangeRequest
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

        // ✅ if UI needs "variantId", it's on the SupplierVariantOffer (not on the request)
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
    });

    /**
     * Backward-compat mapping:
     * Your UI (or older code) is expecting:
     *  - proposedPatch
     *  - currentSnapshot
     *  - variantId
     *
     * SupplierOfferChangeRequest has patchJson + note,
     * and variantId exists only via supplierVariantOffer.
     */
    const data = rows.map((r: any) => ({
      ...r,
      // keep original fields too (patchJson) but provide alias
      proposedPatch: r.patchJson ?? null,
      currentSnapshot: null,
      variantId: r.supplierVariantOffer?.variantId ?? null,
    }));

    return res.json({ data });
  })
);

export default router;
