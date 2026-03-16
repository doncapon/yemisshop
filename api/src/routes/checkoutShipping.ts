import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { DeliveryServiceLevel } from "@prisma/client";
import { quoteShippingForCheckout } from "../services/shipping/shippingQuote.service.js";

const router = Router();

const ItemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  qty: z.number().int().positive().default(1),
});

const AddressSchema = z.object({
  houseNumber: z.string().optional().default(""),
  streetName: z.string().optional().default(""),
  postCode: z.string().optional().default(""),
  town: z.string().optional().default(""),
  city: z.string().min(1),
  state: z.string().min(1),
  country: z.string().min(1),
  lga: z.string().nullable().optional(),
});

const BodySchema = z.object({
  items: z.array(ItemSchema).min(1),
  shippingAddressId: z.string().min(1).optional(),
  shippingAddress: AddressSchema.optional(),
  serviceLevel: z
    .nativeEnum(DeliveryServiceLevel)
    .optional()
    .default(DeliveryServiceLevel.STANDARD),
});

router.post("/shipping-fee-local", requireAuth, async (req, res) => {
  try {
    const body = BodySchema.parse(req.body);

    if (!body.shippingAddressId && !body.shippingAddress) {
      return res.status(400).json({
        error: "Either shippingAddressId or shippingAddress is required",
      });
    }

    const result = await quoteShippingForCheckout({
      userId: (req as any).user?.id ?? null,
      items: body.items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId ?? null,
        qty: i.qty,
      })),
      destinationAddressId: body.shippingAddressId ?? null,
      destinationAddress: body.shippingAddress
        ? {
          houseNumber: body.shippingAddress.houseNumber,
          streetName: body.shippingAddress.streetName,
          postCode: body.shippingAddress.postCode,
          town: body.shippingAddress.town,
          city: body.shippingAddress.city,
          state: body.shippingAddress.state,
          country: body.shippingAddress.country,
          lga: body.shippingAddress.lga ?? null,
        }
        : null,
      serviceLevel: body.serviceLevel,
    });

    console.log(
      "[shipping-fee-local result]",
      JSON.stringify(result, null, 2)
    );

    return res.json(result);
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return res.status(400).json({
        error: "Invalid shipping quote payload",
        details: e.errors,
      });
    }

    console.error("POST /api/checkout/shipping-fee-local failed:", e);
    return res.status(500).json({
      error: e?.message || "Failed to compute shipping fee",
    });
  }
});

export default router;