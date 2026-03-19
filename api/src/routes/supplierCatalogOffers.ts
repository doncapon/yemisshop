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

function parsePositiveInt(v: any, fallback: number, min = 1, max = 100) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return fallback;
  return Math.min(i, max);
}

function parseNonNegativeInt(v: any, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return i < 0 ? fallback : i;
}

function offerableProductStatuses() {
  // Your schema default is PUBLISHED.
  // Keeping LIVE too so older rows/routes do not break.
  return ["PUBLISHED", "LIVE"];
}

async function getSupplierForUser(userId: string) {
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
  ].find(hasSOCRField) as string | undefined) ?? "requestedByUserId";

function socrSet(key: string | null, value: any) {
  return key ? { [key]: value } : {};
}

function socrIf(name: string, value: any) {
  return hasSOCRField(name) ? { [name]: value } : {};
}

async function queuePendingChangeRequest(
  tx: any,
  args: {
    supplierId: string;
    productId: string;
    scope: "BASE_OFFER" | "VARIANT_OFFER";
    supplierProductOfferId?: string;
    supplierVariantOfferId?: string;
    patch: any;
    snapshot: any;
    requestedByUserId: string;
  }
) {
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

  return {
    ...row,
    proposedPatch: SOCR_PATCH_KEY ? row?.[SOCR_PATCH_KEY] ?? null : null,
  };
}

/**
 * GET /api/supplier/catalog/products
 * Server-side pagination:
 * - page / pageSize
 * - also supports legacy skip / take
 */
router.get("/products", requireAuth, async (req: any, res) => {
  const role = req.user?.role;
  const userId = String(req.user?.id ?? "").trim();

  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!isSupplier(role)) {
    return res.status(403).json({ error: "Supplier access required" });
  }

  const s = await getSupplierForUser(userId);
  if (!s?.id) return res.status(403).json({ error: "Supplier not found" });

  const supplierId = s.id;

  const q = String(req.query?.q ?? "").trim();

  const pageParam = req.query?.page;
  const pageSizeParam = req.query?.pageSize;
  const takeParam = req.query?.take;
  const skipParam = req.query?.skip;

  const pageSize = parsePositiveInt(pageSizeParam ?? takeParam, 20, 1, 100);
  const page = parsePositiveInt(pageParam, 1, 1, 100000);

  const skipFromPage = (page - 1) * pageSize;
  const skip = skipParam != null ? parseNonNegativeInt(skipParam, skipFromPage) : skipFromPage;
  const take = pageSize;

  const where: any = {
    isDeleted: false,
    status: { in: offerableProductStatuses() },
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
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
      select: {
        id: true,
        title: true,
        description: true,
        sku: true,
        retailPrice: true,
        imagesJson: true,
        inStock: true,
        availableQty: true,
        supplierId: true,
        status: true,
        brand: { select: { id: true, name: true } },

        ProductVariant: {
          where: { isActive: true, archivedAt: null },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            sku: true,
            retailPrice: true,
            inStock: true,
            availableQty: true,
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
          where: { supplierId },
          select: {
            id: true,
            supplierId: true,
            productId: true,
            basePrice: true,
            availableQty: true,
            leadDays: true,
            isActive: true,
            inStock: true,
            currency: true,
            createdAt: true,
            updatedAt: true,
            pendingChangeId: true,
          },
          take: 1,
        },

        supplierVariantOffers: {
          where: { supplierId },
          select: {
            id: true,
            supplierId: true,
            productId: true,
            variantId: true,
            supplierProductOfferId: true,
            unitPrice: true,
            availableQty: true,
            leadDays: true,
            isActive: true,
            inStock: true,
            currency: true,
            createdAt: true,
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
    const variantOffers = Array.isArray(p.supplierVariantOffers) ? p.supplierVariantOffers : [];

    const normVariants = variants.map((v: any) => {
      const myVariantOffer =
        variantOffers.find((vo: any) => String(vo.variantId) === String(v.id)) ?? null;

      return {
        ...v,
        imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
        retailPrice: v.retailPrice ?? null,
        supplierVariantOffer: myVariantOffer
          ? {
              id: myVariantOffer.id,
              supplierId: myVariantOffer.supplierId,
              productId: myVariantOffer.productId,
              variantId: myVariantOffer.variantId,
              supplierProductOfferId: myVariantOffer.supplierProductOfferId ?? null,
              unitPrice: myVariantOffer.unitPrice != null ? Number(myVariantOffer.unitPrice) : 0,
              availableQty: myVariantOffer.availableQty ?? 0,
              leadDays: myVariantOffer.leadDays ?? null,
              isActive: !!myVariantOffer.isActive,
              inStock: !!myVariantOffer.inStock,
              currency: myVariantOffer.currency ?? "NGN",
              createdAt: myVariantOffer.createdAt,
              updatedAt: myVariantOffer.updatedAt,
            }
          : null,
      };
    });

    const myBaseOffer = Array.isArray(p.supplierProductOffers) ? p.supplierProductOffers[0] ?? null : null;

    return {
      id: p.id,
      title: p.title,
      description: p.description,
      sku: p.sku,
      retailPrice: p.retailPrice ?? null,
      imagesJson: productImages,
      inStock: !!p.inStock,
      availableQty: p.availableQty ?? 0,
      supplierId: p.supplierId ?? null,
      status: p.status,
      brand: p.brand ?? null,
      offer: myBaseOffer
        ? {
            id: myBaseOffer.id,
            supplierId: myBaseOffer.supplierId,
            productId: myBaseOffer.productId,
            basePrice: myBaseOffer.basePrice != null ? Number(myBaseOffer.basePrice) : 0,
            availableQty: myBaseOffer.availableQty ?? 0,
            leadDays: myBaseOffer.leadDays ?? null,
            isActive: !!myBaseOffer.isActive,
            inStock: !!myBaseOffer.inStock,
            currency: myBaseOffer.currency ?? "NGN",
            createdAt: myBaseOffer.createdAt,
            updatedAt: myBaseOffer.updatedAt,
            pendingChangeId: myBaseOffer.pendingChangeId ?? null,
          }
        : null,
      ProductVariant: normVariants,
    };
  });

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, take)));
  const currentPage = Math.floor(skip / take) + 1;

  return res.json({
    data: {
      items: normalized,
      total,
      page: currentPage,
      pageSize: take,
      totalPages,
      hasNextPage: skip + take < total,
      hasPrevPage: skip > 0,
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
  if (!isSupplier(role)) {
    return res.status(403).json({ error: "Supplier access required" });
  }

  const s = await getSupplierForUser(userId);
  if (!s?.id) {
    return res
      .status(403)
      .json({ error: "Supplier profile not found for this user" });
  }

  const id = requiredString(req.params.id);

  const p = await prisma.product.findFirst({
    where: {
      id,
      isDeleted: false,
      OR: [
        { supplierId: s.id } as any,
        ...(s.userId
          ? ([{ ownerId: s.userId } as any, { userId: s.userId } as any] as any[])
          : []),
        { supplierProductOffers: { some: { supplierId: s.id } } } as any,
        { supplierVariantOffers: { some: { supplierId: s.id } } } as any,
        {
          AND: [
            { status: { in: offerableProductStatuses() } } as any,
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
          supplierVariantOffers: {
            where: { supplierId: s.id },
            select: {
              id: true,
              supplierId: true,
              productId: true,
              variantId: true,
              supplierProductOfferId: true,
              unitPrice: true,
              availableQty: true,
              inStock: true,
              isActive: true,
              leadDays: true,
              currency: true,
              createdAt: true,
              updatedAt: true,
            },
            take: 1,
          },
        },
        orderBy: { createdAt: "asc" },
      },

      supplierProductOffers: {
        where: { supplierId: s.id },
        select: {
          id: true,
          supplierId: true,
          productId: true,
          basePrice: true,
          currency: true,
          inStock: true,
          isActive: true,
          leadDays: true,
          availableQty: true,
          createdAt: true,
          updatedAt: true,
          pendingChangeId: true,
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
            supplierId: myOffer.supplierId,
            productId: myOffer.productId,
            basePrice,
            currency: myOffer.currency,
            inStock: myOffer.inStock,
            isActive: myOffer.isActive,
            leadDays: myOffer.leadDays ?? null,
            availableQty: myOffer.availableQty ?? 0,
            createdAt: myOffer.createdAt,
            updatedAt: myOffer.updatedAt,
            pendingChangeId: myOffer.pendingChangeId ?? null,
          }
        : null,

      variants:
        (p as any).ProductVariant?.map((v: any) => {
          const vo = v.supplierVariantOffers?.[0] ?? null;
          return {
            id: v.id,
            sku: v.sku,
            retailPrice: v.retailPrice ?? null,
            availableQty: v.availableQty ?? 0,
            inStock: v.inStock ?? true,
            imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
            unitPrice: vo?.unitPrice != null ? Number(vo.unitPrice) : 0,
            supplierVariantOffer: vo
              ? {
                  id: vo.id,
                  supplierId: vo.supplierId,
                  productId: vo.productId,
                  variantId: vo.variantId,
                  supplierProductOfferId: vo.supplierProductOfferId ?? null,
                  unitPrice: Number(vo.unitPrice ?? 0),
                  availableQty: vo.availableQty ?? 0,
                  inStock: vo.inStock ?? true,
                  isActive: vo.isActive ?? true,
                  leadDays: vo.leadDays ?? null,
                  currency: vo.currency ?? "NGN",
                  createdAt: vo.createdAt,
                  updatedAt: vo.updatedAt,
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

router.put("/offers/base", requireAuth, async (req: any, res) => {
  const role = req.user?.role;
  const userId = String(req.user?.id ?? "").trim();
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!isSupplier(role)) {
    return res.status(403).json({ error: "Supplier access required" });
  }

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

  const p = await prisma.product.findUnique({
    where: { id: body.productId },
    select: { id: true, isDeleted: true, status: true, supplierId: true },
  });

  if (!p || p.isDeleted || !offerableProductStatuses().includes(String(p.status))) {
    return res.status(404).json({ error: "Product not found/offerable" });
  }

  if (p.supplierId !== supplierId) {
    return res
      .status(403)
      .json({ error: "You can only edit offers for your own products" });
  }

  const existing = await prisma.supplierProductOffer.findUnique({
    where: {
      supplier_product_offer_unique: {
        productId: body.productId,
        supplierId,
      },
    },
    select: {
      id: true,
      supplierId: true,
      productId: true,
      basePrice: true,
      availableQty: true,
      leadDays: true,
      isActive: true,
      inStock: true,
      currency: true,
      createdAt: true,
      updatedAt: true,
      pendingChangeId: true,
    },
  });

  if (!existing) {
    const created = await prisma.supplierProductOffer.create({
      data: {
        productId: body.productId,
        supplierId,
        basePrice: body.basePrice,
        availableQty: body.availableQty,
        leadDays: body.leadDays ?? null,
        isActive: body.isActive,
        inStock: body.inStock,
        currency: body.currency ?? "NGN",
      },
      select: {
        id: true,
        supplierId: true,
        productId: true,
        basePrice: true,
        availableQty: true,
        leadDays: true,
        isActive: true,
        inStock: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
        pendingChangeId: true,
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

    if (immediateChanged) {
      updatedOffer = await tx.supplierProductOffer.update({
        where: { id: existing.id },
        data: {
          availableQty: body.availableQty,
          inStock: body.inStock,
        },
        select: {
          id: true,
          supplierId: true,
          productId: true,
          basePrice: true,
          availableQty: true,
          leadDays: true,
          isActive: true,
          inStock: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
          pendingChangeId: true,
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

router.put("/offers/variant", requireAuth, async (req: any, res) => {
  const role = req.user?.role;
  const userId = String(req.user?.id ?? "").trim();
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!isSupplier(role)) {
    return res.status(403).json({ error: "Supplier access required" });
  }

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
    !offerableProductStatuses().includes(String(v.product.status))
  ) {
    return res.status(404).json({ error: "Variant not found/offerable" });
  }

  if (v.product.supplierId !== supplierId) {
    return res
      .status(403)
      .json({ error: "You can only edit offers for your own products" });
  }

  const baseOffer = await prisma.supplierProductOffer.findUnique({
    where: {
      supplier_product_offer_unique: {
        productId: body.productId,
        supplierId,
      },
    },
    select: { id: true },
  });

  if (!baseOffer) {
    return res
      .status(400)
      .json({ error: "Create a base offer for this product first." });
  }

  const existing = await prisma.supplierVariantOffer.findUnique({
    where: {
      supplier_variant_offer_unique: {
        variantId: body.variantId,
        supplierId,
      },
    },
    select: {
      id: true,
      supplierId: true,
      productId: true,
      variantId: true,
      unitPrice: true,
      availableQty: true,
      leadDays: true,
      isActive: true,
      inStock: true,
      currency: true,
      supplierProductOfferId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!existing) {
    const created = await prisma.supplierVariantOffer.create({
      data: {
        productId: body.productId,
        variantId: body.variantId,
        supplierId,
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
        supplierId: true,
        productId: true,
        variantId: true,
        supplierProductOfferId: true,
        unitPrice: true,
        availableQty: true,
        leadDays: true,
        isActive: true,
        inStock: true,
        currency: true,
        createdAt: true,
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
          supplierId: true,
          productId: true,
          variantId: true,
          supplierProductOfferId: true,
          unitPrice: true,
          availableQty: true,
          leadDays: true,
          isActive: true,
          inStock: true,
          currency: true,
          createdAt: true,
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

router.delete("/offers/variant/:id", requireAuth, async (req: any, res) => {
  const role = req.user?.role;
  const userId = String(req.user?.id ?? "").trim();
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!isSupplier(role)) {
    return res.status(403).json({ error: "Supplier access required" });
  }

  const s = await getSupplierForUser(userId);
  if (!s?.id) return res.status(403).json({ error: "Supplier not found" });
  const supplierId = s.id;

  const id = requiredString(req.params.id ?? "");

  const found = await prisma.supplierVariantOffer.findUnique({
    where: { id },
    select: {
      id: true,
      supplierId: true,
      product: { select: { supplierId: true } },
    },
  });

  if (!found || found.supplierId !== supplierId || found.product.supplierId !== supplierId) {
    return res.status(404).json({ error: "Not found" });
  }

  await prisma.supplierVariantOffer.delete({ where: { id } });
  return res.json({ ok: true });
});

router.delete("/offers/base/:productId", requireAuth, async (req: any, res) => {
  const role = req.user?.role;
  const userId = String(req.user?.id ?? "").trim();
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!isSupplier(role)) {
    return res.status(403).json({ error: "Supplier access required" });
  }

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
    where: {
      supplier_product_offer_unique: {
        productId,
        supplierId,
      },
    },
    select: { id: true },
  });

  if (!base) return res.status(404).json({ error: "Not found" });

  await prisma.$transaction([
    prisma.supplierVariantOffer.deleteMany({ where: { productId, supplierId } }),
    prisma.supplierProductOffer.delete({ where: { id: base.id } }),
  ]);

  return res.json({ ok: true });
});

export default router;