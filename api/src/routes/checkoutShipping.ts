// api/src/routes/checkoutShipping.ts
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
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

  // legacy Address table id
  shippingAddressId: z.string().min(1).optional(),

  // preferred saved user shipping address id
  selectedUserShippingAddressId: z.string().min(1).optional(),

  // tolerate common frontend aliases too
  selectedShippingAddressId: z.string().min(1).optional(),
  userShippingAddressId: z.string().min(1).optional(),
  deliveryAddressId: z.string().min(1).optional(),

  // raw manual address fallback
  shippingAddress: AddressSchema.optional(),

  serviceLevel: z
    .nativeEnum(DeliveryServiceLevel)
    .optional()
    .default(DeliveryServiceLevel.STANDARD),
});

type ResolvedDestinationAddress = {
  houseNumber?: string;
  streetName?: string;
  postCode?: string;
  town?: string;
  city?: string;
  state?: string;
  country?: string;
  lga?: string | null;
};

type ResolvedDestination = {
  destinationAddressId: string | null;
  destinationAddress?: ResolvedDestinationAddress | null;
  selectedUserShippingAddressId: string | null;
  selectedUserShippingAddress:
    | {
        id: string;
        label: string | null;
        recipientName: string | null;
        phone: string;
        whatsappPhone: string | null;
        houseNumber: string | null;
        streetName: string | null;
        postCode: string | null;
        town: string | null;
        city: string;
        state: string;
        country: string;
        lga: string | null;
        landmark: string | null;
        directionsNote: string | null;
      }
    | null;
};

function strOrUndef(v: string | null | undefined): string | undefined {
  return v == null ? undefined : v;
}

function cleanId(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  return s || undefined;
}

function normalizeSelectedUserShippingAddressId(
  body: z.infer<typeof BodySchema>
): string | undefined {
  return (
    cleanId(body.selectedUserShippingAddressId) ||
    cleanId(body.selectedShippingAddressId) ||
    cleanId(body.userShippingAddressId) ||
    cleanId(body.deliveryAddressId)
  );
}

async function resolveCheckoutDestination(args: {
  userId: string;
  shippingAddressId?: string;
  selectedUserShippingAddressId?: string;
  shippingAddress?: z.infer<typeof AddressSchema>;
}): Promise<ResolvedDestination> {
  const userId = String(args.userId ?? "").trim();
  const shippingAddressId = cleanId(args.shippingAddressId);
  const selectedUserShippingAddressId = cleanId(args.selectedUserShippingAddressId);
  const shippingAddress = args.shippingAddress;

  // Highest priority: saved multi-address book entry
  if (selectedUserShippingAddressId) {
    const saved = await prisma.userShippingAddress.findFirst({
      where: {
        id: selectedUserShippingAddressId,
        userId,
        isActive: true,
      },
      select: {
        id: true,
        label: true,
        recipientName: true,
        phone: true,
        whatsappPhone: true,
        houseNumber: true,
        streetName: true,
        postCode: true,
        town: true,
        city: true,
        state: true,
        country: true,
        lga: true,
        landmark: true,
        directionsNote: true,
      },
    });

    if (!saved) {
      throw new Error("Selected delivery address was not found for this user.");
    }

    return {
      destinationAddressId: null,
      selectedUserShippingAddressId: saved.id,
      selectedUserShippingAddress: saved,
      destinationAddress: {
        houseNumber: strOrUndef(saved.houseNumber),
        streetName: strOrUndef(saved.streetName),
        postCode: strOrUndef(saved.postCode),
        town: strOrUndef(saved.town),
        city: strOrUndef(saved.city),
        state: strOrUndef(saved.state),
        country: strOrUndef(saved.country),
        lga: saved.lga ?? null,
      },
    };
  }

  // Legacy Address table id
  if (shippingAddressId) {
    return {
      destinationAddressId: shippingAddressId,
      destinationAddress: null,
      selectedUserShippingAddressId: null,
      selectedUserShippingAddress: null,
    };
  }

  // Raw one-off address
  if (shippingAddress) {
    return {
      destinationAddressId: null,
      destinationAddress: {
        houseNumber: strOrUndef(shippingAddress.houseNumber),
        streetName: strOrUndef(shippingAddress.streetName),
        postCode: strOrUndef(shippingAddress.postCode),
        town: strOrUndef(shippingAddress.town),
        city: strOrUndef(shippingAddress.city),
        state: strOrUndef(shippingAddress.state),
        country: strOrUndef(shippingAddress.country),
        lga: shippingAddress.lga ?? null,
      },
      selectedUserShippingAddressId: null,
      selectedUserShippingAddress: null,
    };
  }

  throw new Error(
    "Either selectedUserShippingAddressId, shippingAddressId, or shippingAddress is required"
  );
}

router.post("/shipping-fee-local", requireAuth, async (req, res) => {
  try {
    const body = BodySchema.parse(req.body);
    const userId = String((req as any).user?.id ?? "").trim();

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const normalizedSelectedUserShippingAddressId =
      normalizeSelectedUserShippingAddressId(body);

    console.log(
      "[shipping-fee-local input]",
      JSON.stringify(
        {
          userId,
          itemCount: body.items.length,
          shippingAddressId: cleanId(body.shippingAddressId) ?? null,
          selectedUserShippingAddressId:
            cleanId(body.selectedUserShippingAddressId) ?? null,
          selectedShippingAddressId:
            cleanId(body.selectedShippingAddressId) ?? null,
          userShippingAddressId: cleanId(body.userShippingAddressId) ?? null,
          deliveryAddressId: cleanId(body.deliveryAddressId) ?? null,
          normalizedSelectedUserShippingAddressId:
            normalizedSelectedUserShippingAddressId ?? null,
          hasRawShippingAddress: !!body.shippingAddress,
          rawShippingAddressSummary: body.shippingAddress
            ? {
                city: body.shippingAddress.city,
                state: body.shippingAddress.state,
                country: body.shippingAddress.country,
                lga: body.shippingAddress.lga ?? null,
              }
            : null,
          serviceLevel: body.serviceLevel,
        },
        null,
        2
      )
    );

    const resolved = await resolveCheckoutDestination({
      userId,
      shippingAddressId: cleanId(body.shippingAddressId),
      selectedUserShippingAddressId: normalizedSelectedUserShippingAddressId,
      shippingAddress: body.shippingAddress,
    });

    const result = await quoteShippingForCheckout({
      userId,
      items: body.items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId ?? null,
        qty: i.qty,
      })),
      destinationAddressId: resolved.destinationAddressId,
      destinationAddress: resolved.destinationAddress,
      serviceLevel: body.serviceLevel,
    });

    console.log(
      "[shipping-fee-local result]",
      JSON.stringify(
        {
          selectedUserShippingAddressId: resolved.selectedUserShippingAddressId,
          destinationAddressId: resolved.destinationAddressId,
          destinationMode: resolved.selectedUserShippingAddressId
            ? "USER_SAVED_SHIPPING_ADDRESS"
            : resolved.destinationAddressId
            ? "ADDRESS_ID"
            : "RAW_ADDRESS",
          destinationAddress: resolved.destinationAddress ?? null,
          result,
        },
        null,
        2
      )
    );

    return res.json({
      ...result,
      meta: {
        selectedUserShippingAddressId: resolved.selectedUserShippingAddressId,
        selectedUserShippingAddress: resolved.selectedUserShippingAddress,
        destinationAddressId: resolved.destinationAddressId,
        destinationAddress: resolved.destinationAddress ?? null,
        destinationMode: resolved.selectedUserShippingAddressId
          ? "USER_SAVED_SHIPPING_ADDRESS"
          : resolved.destinationAddressId
          ? "ADDRESS_ID"
          : "RAW_ADDRESS",
      },
    });
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return res.status(400).json({
        error: "Invalid shipping quote payload",
        details: e.errors,
      });
    }

    const msg = String(e?.message || "");
    if (
      msg.includes("Either selectedUserShippingAddressId") ||
      msg.includes("Selected delivery address was not found")
    ) {
      return res.status(400).json({ error: msg });
    }

    console.error("POST /api/checkout/shipping-fee-local failed:", e);
    return res.status(500).json({
      error: e?.message || "Failed to compute shipping fee",
    });
  }
});

export default router;