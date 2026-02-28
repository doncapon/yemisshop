// api/src/routes/supplierCatalogOffers.ts
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requiredString } from "../lib/http.js";

const router = Router();

const isSupplier = (role?: string) =>
  String(role || "").toUpperCase() === "SUPPLIER";
const isAdmin = (role?: string) =>
  ["ADMIN", "SUPER_ADMIN"].includes(String(role || "").toUpperCase());

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sameNum(a: any, b: any) {
  return num(a) === num(b);
}

function sameStr(a: any, b: any) {
  return String(a ?? "") === String(b ?? "");
}

function sameBool(a: any, b: any) {
  return Boolean(a) === Boolean(b);
}

async function getSupplierForUser(userId: string) {
  // Include userId because you reference it later in GET /:id
  const s = await prisma.supplier.findUnique({
    where: { userId },
    select: { id: true, status: true, userId: true },
  });
  return s ?? null;
}

/* ------------------------------------------------------------------ */
/* SupplierOfferChangeRequest schema-safe helpers                      */
/* ------------------------------------------------------------------ */

const SOCR_MODEL =
  Prisma.dmmf.datamodel.models.find(
    (m) => String(m.name || "").toLowerCase() === "supplierofferchangerequest"
  ) ?? null;

const SOCR_FIELDS = new Set<string>((SOCR_MODEL?.fields ?? []).map((f) => f.name));
const hasSOCRField = (name: string) => SOCR_FIELDS.has(name);

// Find a “patch json” field name that exists in YOUR schema
const SOCR_PATCH_KEY =
  ([
    "proposedPatch",
    "proposedPatchJson",
    "patch",
    "patchJson",
    "requestedPatch",
    "requestedPatchJson",
    "changes",
    "changesJson",
    "deltaJson",
  ].find(hasSOCRField) as string | undefined) ?? null;

// Find a “snapshot json” field name that exists in YOUR schema
const SOCR_SNAPSHOT_KEY =
  ([
    "currentSnapshot",
    "currentSnapshotJson",
    "snapshot",
    "snapshotJson",
    "currentState",
    "currentStateJson",
  ].find(hasSOCRField) as string | undefined) ?? null;

const SOCR_REQUESTED_BY_KEY =
  ([
    "requestedByUserId",
    "requestedById",
    "requestedBy",
  ].find(hasSOCRField) as string | undefined) ?? "requestedByUserId"; // fallback to what you used

function socrSet(key: string | null, value: any) {
  return key ? { [key]: value } : {};
}

function socrIf(name: string, value: any) {
  return hasSOCRField(name) ? { [name]: value } : {};
}

/**
 * Queue or update a pending change request WITHOUT relying on schema-specific @@unique names.
 * Also avoids compile-time Prisma type errors by using tx as any, BUT keeps runtime safe
 * by only setting fields that exist in the DMMF.
 */
async function queuePendingChangeRequest(tx: any, args: {
  supplierId: string;
  productId: string;
  scope: "BASE_OFFER" | "VARIANT_OFFER";
  supplierProductOfferId?: string;
  supplierVariantOfferId?: string;
  patch: any;
  snapshot: any;
  requestedByUserId: string;
}) {
  const model = (tx as any).supplierOfferChangeRequest;
  if (!model?.findFirst) return null;

  const where: any = {
    status: "PENDING",
    supplierId: args.supplierId,
    scope: args.scope,
  };

  if (args.scope === "BASE_OFFER") {
    where.supplierProductOfferId = args.supplierProductOfferId;
  } else {
    where.supplierVariantOfferId = args.supplierVariantOfferId;
  }

  const existing = await model.findFirst({
    where,
    select: { id: true },
  });

  const baseData: any = {
    supplierId: args.supplierId,
    productId: args.productId,
    scope: args.scope,
    status: "PENDING",
    ...(args.scope === "BASE_OFFER"
      ? { supplierProductOfferId: args.supplierProductOfferId }
      : { supplierVariantOfferId: args.supplierVariantOfferId }),
    ...socrSet(SOCR_PATCH_KEY, args.patch),
    ...socrSet(SOCR_SNAPSHOT_KEY, args.snapshot),
    ...(SOCR_REQUESTED_BY_KEY ? { [SOCR_REQUESTED_BY_KEY]: args.requestedByUserId } : {}),
    ...socrIf("requestedAt", new Date()),
  };

  const updateData: any = {
    ...socrSet(SOCR_PATCH_KEY, args.patch),
    ...(SOCR_REQUESTED_BY_KEY ? { [SOCR_REQUESTED_BY_KEY]: args.requestedByUserId } : {}),
    ...socrIf("requestedAt", new Date()),
    // clear any previous review fields if they exist
    ...socrIf("reviewedAt", null),
    ...socrIf("reviewedByUserId", null),
    ...socrIf("reviewedById", null),
    ...socrIf("rejectionReason", null),
    ...socrIf("reviewNote", null),
    status: "PENDING",
  };

  const select: any = { id: true, status: true, requestedAt: true, scope: true };
  if (SOCR_PATCH_KEY) select[SOCR_PATCH_KEY] = true;

  const row = existing?.id
    ? await model.update({ where: { id: existing.id }, data: updateData, select })
    : await model.create({ data: baseData, select });

  // ✅ normalize to what your frontend was expecting
  return {
    ...row,
    proposedPatch: SOCR_PATCH_KEY ? row?.[SOCR_PATCH_KEY] ?? null : null,
  };
}

/**
 * GET /api/supplier/catalog/products
 * - Suppliers can browse products from OTHER suppliers (or products with no supplierId)
 * - Search by title, sku, variant sku, attribute name/value name
 */
router.get("/products", requireAuth, async (req: any, res) => {
  const role = req.user?.role;
  const userId = String(req.user?.id ?? "").trim();

  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!isSupplier(role))
    return res.status(403).json({ error: "Supplier access required" });

  const s = await getSupplierForUser(userId);
  if (!s?.id) return res.status(403).json({ error: "Supplier not found" });

  const supplierId = s.id;

  const q = String(req.query?.q ?? "").trim();
  const take = Math.min(50, Math.max(1, Number(req.query?.take ?? 20) || 20));
  const skip = Math.max(0, Number(req.query?.skip ?? 0) || 0);

  const where: any = {
    isDeleted: false,
    status: "LIVE",
    OR: [{ supplierId: { not: supplierId } }, { supplierId: null }],
  };

  if (q) {
    where.AND = [
      {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          {
            ProductVariant: {
              some: {
                OR: [
                  { sku: { contains: q, mode: "insensitive" } },
                  {
                    options: {
                      some: {
                        OR: [
                          {
                            attribute: {
                              name: { contains: q, mode: "insensitive" },
                            },
                          },
                          { value: { name: { contains: q, mode: "insensitive" } } },
                          { value: { code: { contains: q, mode: "insensitive" } } },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
          {
            brand: {
              is: { name: { contains: q, mode: "insensitive" } },
            },
          },
        ],
      },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        title: true,
        sku: true,
        retailPrice: true,
        imagesJson: true,
        inStock: true,
        supplierId: true,
        brand: { select: { id: true, name: true } },

        ProductVariant: {
          where: { isActive: true, archivedAt: null },
          select: {
            id: true,
            sku: true,
            retailPrice: true,
            inStock: true,
            imagesJson: true,
            options: {
              select: {
                attributeId: true,
                valueId: true,
                unitPrice: true,
                attribute: { select: { id: true, name: true, type: true } },
                value: { select: { id: true, name: true, code: true } },
              },
            },
          },
        },

        supplierProductOffers: {
          select: {
            id: true,
            basePrice: true,
            availableQty: true,
            leadDays: true,
            isActive: true,
            inStock: true,
            currency: true,
            updatedAt: true,
          },
          take: 1, // defensive, in case of legacy duplicates
        },
        supplierVariantOffers: {
          select: {
            id: true,
            variantId: true,
            unitPrice: true,
            availableQty: true,
            leadDays: true,
            isActive: true,
            inStock: true,
            currency: true,
            updatedAt: true,
          },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const normalized = (items ?? []).map((p: any) => {
    const productImages = Array.isArray(p.imagesJson) ? p.imagesJson : [];

    const variants = Array.isArray(p.ProductVariant) ? p.ProductVariant : [];
    const normVariants = variants.map((v: any) => ({
      ...v,
      imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
      price: v.retailPrice ?? null,
    }));

    return {
      ...p,
      imagesJson: productImages,
      ProductVariant: normVariants,
      retailPrice: p.retailPrice ?? null,
    };
  });

  return res.json({
    data: {
      items: normalized,
      total,
      skip,
      take,
      supplierId,
    },
  });
});

router.get("/:id", requireAuth, async (req: any, res) => {
  const role = req.user?.role;
  const userId = requiredString(req.user?.id ?? "").trim();

  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!isSupplier(role))
    return res.status(403).json({ error: "Supplier access required" });

  const s = await getSupplierForUser(userId);
  if (!s?.id)
    return res
      .status(403)
      .json({ error: "Supplier profile not found for this user" });

  const id = requiredString(req.params.id);

  const p = await prisma.product.findFirst({
    where: {
      id,
      isDeleted: false,
      OR: [
        // own product
        { supplierId: s.id } as any,
        // legacy owner/user links
        ...(s.userId
          ? ([{ ownerId: s.userId } as any, { userId: s.userId } as any] as any[])
          : []),
        // legacy “has my offers” filters – now just kept for compatibility
        { supplierProductOffers: { some: {} } } as any,
        { supplierVariantOffers: { some: {} } } as any,
        // public LIVE products from catalog
        {
          AND: [
            { status: "LIVE" as any },
            { OR: [{ supplierId: { not: s.id } }, { supplierId: null }] } as any,
          ],
        } as any,
      ],
    },
    include: {
      ProductVariant: {
        where: { isActive: true, archivedAt: null } as any,
        include: {
          options: {
            select: {
              attributeId: true,
              valueId: true,
              attribute: { select: { id: true, name: true, type: true } },
              value: { select: { id: true, name: true, code: true } },
            },
          },
          // ✅ no supplierId filter – one canonical offer per variant
          supplierVariantOffers: {
            select: {
              id: true,
              unitPrice: true,
              availableQty: true,
              inStock: true,
              isActive: true,
              leadDays: true,
              currency: true,
            },
            take: 1,
          },
        },
        orderBy: { createdAt: "asc" },
      },

      // ✅ no supplierId filter – one canonical base offer per product
      supplierProductOffers: {
        select: {
          id: true,
          basePrice: true,
          currency: true,
          inStock: true,
          isActive: true,
          leadDays: true,
          availableQty: true,
        },
        take: 1,
      },
    },
  });

  if (!p) return res.status(404).json({ error: "Not found" });

  const myOffer = (p as any).supplierProductOffers?.[0] ?? null;

  const baseOfferId = myOffer?.id ?? null;
  const variantOfferIds =
    (p as any).ProductVariant?.map(
      (vv: any) => vv?.supplierVariantOffers?.[0]?.id
    ).filter(Boolean) ?? [];

  const pending = await prisma.supplierOfferChangeRequest.findMany({
    where: {
      status: "PENDING",
      supplierId: s.id,
      OR: [
        ...(baseOfferId ? [{ supplierProductOfferId: baseOfferId }] : []),
        ...(variantOfferIds.length
          ? [{ supplierVariantOfferId: { in: variantOfferIds } }]
          : []),
      ],
    },
    select: {
      id: true,
      scope: true,
      supplierProductOfferId: true,
      supplierVariantOfferId: true,
      requestedAt: true,
    },
  });

  const basePrice = myOffer?.basePrice != null ? Number(myOffer.basePrice) : 0;
  const baseQty = myOffer?.availableQty ?? (p as any).availableQty ?? 0;
  const currency = myOffer?.currency ?? "NGN";

  let [attributeValues, attributeTexts] = await Promise.all([
    prisma.productAttributeOption.findMany({
      where: { productId: id },
      select: { attributeId: true, valueId: true },
    }),
    prisma.productAttributeText.findMany({
      where: { productId: id },
      select: { attributeId: true, value: true },
    }),
  ]);

  if (!attributeValues.length) {
    attributeValues = await prisma.productVariantOption.findMany({
      where: { variant: { productId: id } } as any,
      select: { attributeId: true, valueId: true },
      distinct: ["attributeId", "valueId"] as any,
    });
  }

  return res.json({
    data: {
      attributeValues,
      attributeTexts,
      id: (p as any).id,
      title: (p as any).title,
      description: (p as any).description,
      sku: (p as any).sku,
      status: (p as any).status,
      imagesJson: Array.isArray((p as any).imagesJson)
        ? (p as any).imagesJson
        : [],
      categoryId: (p as any).categoryId ?? null,
      brandId: (p as any).brandId ?? null,

      basePrice,
      currency,
      availableQty: baseQty,
      pendingOfferChanges: pending,
      offer: myOffer
        ? {
            id: myOffer.id,
            basePrice,
            currency: myOffer.currency,
            inStock: myOffer.inStock,
            isActive: myOffer.isActive,
            leadDays: myOffer.leadDays ?? null,
            availableQty: myOffer.availableQty ?? 0,
          }
        : null,

      variants:
        (p as any).ProductVariant?.map((v: any) => {
          const vo = v.supplierVariantOffers?.[0] ?? null;
          return {
            id: v.id,
            sku: v.sku,
            unitPrice: vo?.unitPrice != null ? Number(vo.unitPrice) : 0,
            availableQty: vo?.availableQty ?? v.availableQty ?? 0,
            inStock: vo?.inStock ?? v.inStock,
            isActive: vo?.isActive ?? true,
            supplierVariantOffer: vo
              ? {
                  id: vo.id,
                  unitPrice: Number(vo.unitPrice ?? 0),
                  availableQty: vo.availableQty ?? 0,
                  inStock: vo.inStock ?? true,
                  isActive: vo.isActive ?? true,
                  leadDays: vo.leadDays ?? null,
                  currency: vo.currency ?? "NGN",
                }
              : null,
            options: Array.isArray(v.options)
              ? v.options.map((o: any) => ({
                  attributeId: o.attributeId,
                  valueId: o.valueId,
                }))
              : [],
          };
        }) ?? [],
    },
  });
});



/**
 * PUT /api/supplier/catalog/offers/base
 * Supplier edits the canonical base offer for THEIR product.
 */
router.put("/offers/base", requireAuth, async (req: any, res) => {
  const role = req.user?.role;
  const userId = String(req.user?.id ?? "").trim();
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!isSupplier(role))
    return res.status(403).json({ error: "Supplier access required" });

  const s = await getSupplierForUser(userId);
  if (!s?.id) return res.status(403).json({ error: "Supplier not found" });
  const supplierId = s.id;

  const body = z
    .object({
      productId: z.string().min(1),
      basePrice: z.number().nonnegative(),
      availableQty: z.number().int().nonnegative().default(0),
      leadDays: z.number().int().nonnegative().nullable().optional(),
      isActive: z.boolean().default(true),
      inStock: z.boolean().default(true),
      currency: z.string().optional().default("NGN"),
    })
    .parse(req.body);

  // Product must be LIVE and owned by this supplier
  const p = await prisma.product.findUnique({
    where: { id: body.productId },
    select: { id: true, isDeleted: true, status: true, supplierId: true },
  });

  if (!p || p.isDeleted || p.status !== "LIVE") {
    return res.status(404).json({ error: "Product not found/offerable" });
  }
  if (p.supplierId !== supplierId) {
    return res
      .status(403)
      .json({ error: "You can only edit offers for your own products" });
  }

  // Canonical base offer is 1:1 with productId
  const existing = await prisma.supplierProductOffer.findUnique({
    where: { productId: body.productId },
    select: {
      id: true,
      basePrice: true,
      availableQty: true,
      leadDays: true,
      isActive: true,
      inStock: true,
      currency: true,
      updatedAt: true,
    },
  });

  if (!existing) {
    const created = await prisma.supplierProductOffer.create({
      data: {
        productId: body.productId,
        basePrice: body.basePrice,
        availableQty: body.availableQty,
        leadDays: body.leadDays ?? null,
        isActive: body.isActive,
        inStock: body.inStock,
        currency: body.currency ?? "NGN",
      },
      select: {
        id: true,
        productId: true,
        basePrice: true,
        availableQty: true,
        leadDays: true,
        isActive: true,
        inStock: true,
        currency: true,
        updatedAt: true,
      },
    });

    return res.json({ data: created, meta: { reviewQueued: false } });
  }

  const immediateChanged =
    (existing.availableQty ?? 0) !== body.availableQty ||
    sameBool(existing.inStock, body.inStock) === false;

  const reviewPatch: any = {};
  const reviewChanged =
    !sameNum(existing.basePrice, body.basePrice) ||
    !sameStr(existing.currency, body.currency) ||
    (existing.leadDays ?? null) !== (body.leadDays ?? null) ||
    !sameBool(existing.isActive, body.isActive);

  if (!sameNum(existing.basePrice, body.basePrice)) {
    reviewPatch.basePrice = body.basePrice;
  }
  if (!sameStr(existing.currency, body.currency)) {
    reviewPatch.currency = body.currency ?? "NGN";
  }
  if ((existing.leadDays ?? null) !== (body.leadDays ?? null)) {
    reviewPatch.leadDays = body.leadDays ?? null;
  }
  if (!sameBool(existing.isActive, body.isActive)) {
    reviewPatch.isActive = body.isActive;
  }

  const result = await prisma.$transaction(async (tx) => {
    let updatedOffer = existing;

    // qty / stock can be applied immediately
    if (immediateChanged) {
      updatedOffer = await tx.supplierProductOffer.update({
        where: { id: existing.id },
        data: {
          availableQty: body.availableQty,
          inStock: body.inStock,
        },
        select: {
          id: true,
          productId: true,
          basePrice: true,
          availableQty: true,
          leadDays: true,
          isActive: true,
          inStock: true,
          currency: true,
          updatedAt: true,
        },
      });
    }

    let queued: any = null;
    if (reviewChanged) {
      queued = await queuePendingChangeRequest(tx, {
        supplierId,
        productId: body.productId,
        scope: "BASE_OFFER",
        supplierProductOfferId: existing.id,
        patch: reviewPatch,
        snapshot: {
          basePrice: num(existing.basePrice),
          currency: existing.currency ?? "NGN",
          leadDays: existing.leadDays ?? null,
          isActive: !!existing.isActive,
        },
        requestedByUserId: userId,
      });
    }

    return { updatedOffer, queued };
  });

  return res.json({
    data: result.updatedOffer,
    meta: {
      reviewQueued: !!result.queued,
      changeRequest: result.queued,
    },
  });
});

/**
 * PUT /api/supplier/catalog/offers/variant
 * Supplier edits the canonical offer for a specific variant of THEIR product.
 */
router.put("/offers/variant", requireAuth, async (req: any, res) => {
  const role = req.user?.role;
  const userId = String(req.user?.id ?? "").trim();
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!isSupplier(role))
    return res.status(403).json({ error: "Supplier access required" });

  const s = await getSupplierForUser(userId);
  if (!s?.id) return res.status(403).json({ error: "Supplier not found" });
  const supplierId = s.id;

  const body = z
    .object({
      productId: z.string().min(1),
      variantId: z.string().min(1),
      unitPrice: z.number().nonnegative(),
      availableQty: z.number().int().nonnegative().default(0),
      leadDays: z.number().int().nonnegative().nullable().optional(),
      isActive: z.boolean().default(true),
      inStock: z.boolean().default(true),
      currency: z.string().optional().default("NGN"),
    })
    .parse(req.body);

  const v = await prisma.productVariant.findUnique({
    where: { id: body.variantId },
    select: {
      id: true,
      productId: true,
      product: {
        select: {
          id: true,
          isDeleted: true,
          status: true,
          supplierId: true,
        },
      },
    },
  });

  if (
    !v ||
    v.productId !== body.productId ||
    v.product.isDeleted ||
    v.product.status !== "LIVE"
  ) {
    return res.status(404).json({ error: "Variant not found/offerable" });
  }

  if (v.product.supplierId !== supplierId) {
    return res
      .status(403)
      .json({ error: "You can only edit offers for your own products" });
  }

  // Base offer must exist for this product
  const baseOffer = await prisma.supplierProductOffer.findUnique({
    where: { productId: body.productId },
    select: { id: true },
  });
  if (!baseOffer) {
    return res
      .status(400)
      .json({ error: "Create a base offer for this product first." });
  }

  // Variant offer is 1:1 with variantId
  const existing = await prisma.supplierVariantOffer.findUnique({
    where: { variantId: body.variantId },
    select: {
      id: true,
      productId: true,
      variantId: true,
      unitPrice: true,
      availableQty: true,
      leadDays: true,
      isActive: true,
      inStock: true,
      currency: true,
      supplierProductOfferId: true,
    },
  });

  if (!existing) {
    const created = await prisma.supplierVariantOffer.create({
      data: {
        productId: body.productId,
        variantId: body.variantId,
        supplierProductOfferId: baseOffer.id,
        unitPrice: body.unitPrice,
        availableQty: body.availableQty,
        leadDays: body.leadDays ?? null,
        isActive: body.isActive,
        inStock: body.inStock,
        currency: body.currency ?? "NGN",
      },
      select: {
        id: true,
        productId: true,
        variantId: true,
        unitPrice: true,
        availableQty: true,
        leadDays: true,
        isActive: true,
        inStock: true,
        currency: true,
        updatedAt: true,
      },
    });
    return res.json({ data: created, meta: { reviewQueued: false } });
  }

  const immediateChanged =
    (existing.availableQty ?? 0) !== body.availableQty ||
    sameBool(existing.inStock, body.inStock) === false;

  const reviewPatch: any = {};
  const reviewChanged =
    !sameNum(existing.unitPrice, body.unitPrice) ||
    !sameStr(existing.currency, body.currency) ||
    (existing.leadDays ?? null) !== (body.leadDays ?? null) ||
    !sameBool(existing.isActive, body.isActive);

  if (!sameNum(existing.unitPrice, body.unitPrice)) {
    reviewPatch.unitPrice = body.unitPrice;
  }
  if (!sameStr(existing.currency, body.currency)) {
    reviewPatch.currency = body.currency ?? "NGN";
  }
  if ((existing.leadDays ?? null) !== (body.leadDays ?? null)) {
    reviewPatch.leadDays = body.leadDays ?? null;
  }
  if (!sameBool(existing.isActive, body.isActive)) {
    reviewPatch.isActive = body.isActive;
  }

  const result = await prisma.$transaction(async (tx) => {
    let updatedOffer: any = existing;

    if (immediateChanged) {
      updatedOffer = await tx.supplierVariantOffer.update({
        where: { id: existing.id },
        data: {
          availableQty: body.availableQty,
          inStock: body.inStock,
          supplierProductOfferId: baseOffer.id,
        },
        select: {
          id: true,
          productId: true,
          variantId: true,
          unitPrice: true,
          availableQty: true,
          leadDays: true,
          isActive: true,
          inStock: true,
          currency: true,
          updatedAt: true,
        },
      });
    }

    let queued: any = null;
    if (reviewChanged) {
      queued = await queuePendingChangeRequest(tx, {
        supplierId,
        productId: body.productId,
        scope: "VARIANT_OFFER",
        supplierVariantOfferId: existing.id,
        patch: reviewPatch,
        snapshot: {
          unitPrice: num(existing.unitPrice),
          currency: existing.currency ?? "NGN",
          leadDays: existing.leadDays ?? null,
          isActive: !!existing.isActive,
        },
        requestedByUserId: userId,
      });
    }

    return { updatedOffer, queued };
  });

  return res.json({
    data: result.updatedOffer,
    meta: { reviewQueued: !!result.queued, changeRequest: result.queued },
  });
});

/**
 * DELETE /api/supplier/catalog/offers/variant/:id
 * Remove variant-level canonical offer (only if variant belongs to this supplier).
 */
router.delete("/offers/variant/:id", requireAuth, async (req: any, res) => {
  const role = req.user?.role;
  const userId = String(req.user?.id ?? "").trim();
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!isSupplier(role))
    return res.status(403).json({ error: "Supplier access required" });

  const s = await getSupplierForUser(userId);
  if (!s?.id) return res.status(403).json({ error: "Supplier not found" });
  const supplierId = s.id;

  const id = requiredString(req.params.id ?? "");

  const found = await prisma.supplierVariantOffer.findUnique({
    where: { id },
    select: {
      id: true,
      product: { select: { supplierId: true } },
    },
  });

  if (!found || found.product.supplierId !== supplierId) {
    return res.status(404).json({ error: "Not found" });
  }

  await prisma.supplierVariantOffer.delete({ where: { id } });
  return res.json({ ok: true });
});

/**
 * DELETE /api/supplier/catalog/offers/base/:productId
 * Remove base + variant offers for a product owned by this supplier.
 */
router.delete("/offers/base/:productId", requireAuth, async (req: any, res) => {
  const role = req.user?.role;
  const userId = String(req.user?.id ?? "").trim();
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!isSupplier(role))
    return res.status(403).json({ error: "Supplier access required" });

  const s = await getSupplierForUser(userId);
  if (!s?.id) return res.status(403).json({ error: "Supplier not found" });
  const supplierId = s.id;

  const productId = String(req.params.productId ?? "");

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, supplierId: true },
  });

  if (!product || product.supplierId !== supplierId) {
    return res.status(404).json({ error: "Product not found" });
  }

  const base = await prisma.supplierProductOffer.findUnique({
    where: { productId },
    select: { id: true },
  });
  if (!base) return res.status(404).json({ error: "Not found" });

  await prisma.$transaction([
    prisma.supplierVariantOffer.deleteMany({ where: { productId } }),
    prisma.supplierProductOffer.delete({ where: { id: base.id } }),
  ]);

  return res.json({ ok: true });
});

export default router;
