import express, { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { z } from "zod";
import { SupplierShippingProfileMode, SupplierShippingCoverage } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => any): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

async function requireSupplierContext(req: Request) {
  const userId = String((req as any).user?.id ?? "").trim();
  if (!userId) throw new Error("Unauthorized");

  const supplier = await prisma.supplier.findFirst({
    where: {
      userId,
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!supplier) {
    const err: any = new Error("Supplier account not found");
    err.status = 404;
    throw err;
  }

  return supplier;
}

// Suppliers only ever quote/ship through GIGL (or a future platform-owned
// fleet) — shippingProfileMode, fulfillmentMode, flat fees, rate cards, and
// per-order defaults are admin/platform-controlled concepts, never supplier
// self-service. The schema/quote-engine paths for those still exist
// (dormant) for a possible future platform-priced rate-card system, but
// suppliers can't reach them.
const SupplierSettingsSchema = z.object({
  shippingEnabled: z.coerce.boolean(),
  shippingCoverage: z.nativeEnum(SupplierShippingCoverage),
});

router.get(
  "/me",
  requireAuth,
  wrap(async (req, res) => {
    const supplier = await requireSupplierContext(req);

    const fullSupplier = await prisma.supplier.findUnique({
      where: { id: supplier.id },
      select: {
        id: true,
        name: true,
        shippingEnabled: true,
        shippingCoverage: true,
        shippingProfileMode: true,
        pickupAddressId: true,
        registeredAddressId: true,
        pickupAddress: {
          select: {
            id: true,
            state: true,
            lga: true,
            town: true,
            city: true,
            country: true,
          },
        },
        registeredAddress: {
          select: {
            id: true,
            state: true,
            lga: true,
            town: true,
            city: true,
            country: true,
          },
        },
      },
    });

    return res.json({ supplier: fullSupplier });
  })
);

router.put(
  "/me/settings",
  requireAuth,
  wrap(async (req, res) => {
    const supplier = await requireSupplierContext(req);
    const body = SupplierSettingsSchema.parse(req.body);

    const updated = await prisma.supplier.update({
      where: { id: supplier.id },
      data: {
        shippingEnabled: body.shippingEnabled,
        shippingCoverage: body.shippingCoverage,
        shippingProfileMode: SupplierShippingProfileMode.DEFAULT_PLATFORM,
      },
      select: {
        id: true,
        shippingEnabled: true,
        shippingCoverage: true,
        shippingProfileMode: true,
      },
    });

    return res.json({ ok: true, supplier: updated });
  })
);

export default router;
