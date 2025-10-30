// api/src/routes/products.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const router = Router();


function toNumber(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function mapVariant(v: any) {
  return {
    id: v.id,
    sku: v.sku ?? null,
    price: v.price != null ? Number(v.price) : null,
    inStock: v.inStock !== false,
    imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
    options: Array.isArray(v.options)
      ? v.options.map((o: any) => ({
          attribute: { id: o.attribute.id, name: o.attribute.name, type: o.attribute.type },
          value: { id: o.value.id, name: o.value.name, code: o.value.code ?? null },
        }))
      : undefined,
  };
}

function mapProduct(
  p: any,
  opts: { brand: boolean; variants: boolean; attributes: boolean }
) {
  const out: any = {
    id: p.id,
    title: p.title,
    description: p.description,
    price: p.price != null ? Number(p.price) : null,
    inStock: p.inStock !== false,
    imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
    categoryId: p.categoryId ?? p.category?.id ?? null,
    categoryName: p.category?.name ?? p.categoryName ?? null,
    brandId: p.brandId ?? null,
  };

  if (opts.brand) {
    out.brand = p.brand ? { id: p.brand.id, name: p.brand.name } : null;
    out.brandName = p.brand ? p.brand.name : null;
  }

  if (opts.variants) {
    out.variants = (p.ProductVariant || []).map(mapVariant);
  }

  if (opts.attributes) {
    // NEW: read from product.attributeOptions (+ ProductAttributeText)
    const pao = p.attributeOptions || [];
    const pats = p.ProductAttributeText || [];
    out.attributeValues = pao.map((o: any) => ({
      id: o.id,
      attribute: { id: o.attribute.id, name: o.attribute.name, type: o.attribute.type },
      value: { id: o.value.id, name: o.value.name, code: o.value.code ?? null },
    }));
    out.attributeTexts = pats.map((at: any) => ({
      id: at.id,
      attribute: { id: at.attribute.id, name: at.attribute.name, type: at.attribute.type },
      value: at.value,
    }));
  }

  return out;
}

/* ---------------- LIST: GET /api/products ---------------- */
const ListQuery = z.object({
  q: z.string().optional(),
  categoryId: z.string().optional(),
  brandIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (!v) return [] as string[];
      if (Array.isArray(v))
        return v.flatMap((s) =>
          s.split(',').map((x) => x.trim()).filter(Boolean)
        );
      return v.split(',').map((x) => x.trim()).filter(Boolean);
    }),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  inStock: z
    .enum(['1', 'true', '0', 'false'])
    .optional()
    .transform((v) => (v ? v === '1' || v === 'true' : undefined)),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(60).default(24),
  include: z.string().optional(),
});

// --- tiny helper: parse include flags ---
function parseInclude(q: any) {
  const incStr = String(q?.include ?? '').trim();
  const parts = incStr ? incStr.split(',').map((s: string) => s.trim().toLowerCase()) : [];
  const set = new Set(parts);
  return {
    brand: set.has('brand'),
    variants: set.has('variants'),
    attributes: set.has('attributes'),
    offers: set.has('offers'),
  };
}

// --- reusable select builder for variants ---
const variantSelectBase = {
  id: true,
  sku: true,
  price: true,
  inStock: true,
  imagesJson: true,
} as const;

// --- main route ---
// GET /api/products?include=brand,variants,attributes,offers&status=LIVE
router.get('/', async (req, res) => {
  const inc = parseInclude(req.query);

  // ---- 1) Status parsing ---------------------------------------------------
  const ALLOWED = new Set(['ANY', 'LIVE', 'PUBLISHED', 'PENDING', 'REJECTED', 'ARCHIVED']);
  const rawStatus = String(req.query.status ?? 'LIVE').toUpperCase();
  const wantStatus = ALLOWED.has(rawStatus) ? rawStatus : 'LIVE';

  // ---- 2) Base guards (price > 0 either at product or any variant) --------
  const priceGuard: any = {
    OR: [
      { price: { gt: new Prisma.Decimal(0) } },
      {
        ProductVariant: {
          some: { price: { not: null, gt: new Prisma.Decimal(0) } },
        },
      },
    ],
  };

  // ---- 3) Availability guard (ONLY valid columns) -------------------------
  const availabilityGuard: any = {
    OR: [
      { inStock: true },
      { ProductVariant: { some: { inStock: true } } },
      {
        supplierOffers: {
          some: {
            isActive: true,
            inStock: true,
            availableQty: { gt: 0 }, // ✅ only field that exists per your seed
          },
        },
      },
    ],
  };

  // ---- 4) Include builder --------------------------------------------------
  const variantSelectBase = {
    id: true, sku: true, price: true, inStock: true, imagesJson: true,
  };
  const include: any = {
    category: { select: { id: true, name: true, slug: true } },
    ...(inc.brand ? { brand: { select: { id: true, name: true } } } : {}),
    ...(inc.variants
      ? {
          ProductVariant: {
            orderBy: { createdAt: 'asc' },
            select: variantSelectBase,
          },
        }
      : {}),
    ...(inc.attributes
      ? {
          attributeOptions: {
            include: {
              attribute: { select: { id: true, name: true, type: true } },
              value: { select: { id: true, name: true, code: true } },
            },
          },
          ProductAttributeText: {
            include: { attribute: { select: { id: true, name: true, type: true } } },
            orderBy: [{ attribute: { name: 'asc' } }],
          },
        }
      : {}),
    // Do NOT include supplierOffers relation directly; we stitch it when requested
  };

  // ---- 5) Helper: map row to payload --------------------------------------
  function mapRow(
    p: any,
    offersByProduct: Map<string, any[]>,
    offersByVariant: Map<string, any[]>,
    includeVariants: boolean,
    includeAttrs: boolean,
    includeBrand: boolean,
    includeOffers: boolean
  ) {
    const variants =
      includeVariants &&
      (p.ProductVariant ?? []).map((v: any) => ({
        id: v.id,
        sku: v.sku ?? null,
        price: v.price != null ? Number(v.price) : null,
        inStock: v.inStock !== false,
        imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
        ...(includeOffers
          ? {
              offers: (offersByVariant.get(String(v.id)) || []).map((o: any) => ({
                id: o.id,
                isActive: o.isActive !== false,
                inStock: o.inStock !== false,
                availableQty: o.availableQty != null ? Number(o.availableQty) : null,
                productId: o.productId ?? null,
                variantId: o.variantId ?? null,
              })),
            }
          : {}),
      }));

    return {
      id: p.id,
      title: p.title,
      description: p.description,
      status: p.status ?? null,
      price: p.price != null ? Number(p.price) : null,
      inStock: p.inStock !== false,
      imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
      categoryId: p.categoryId ?? p.category?.id ?? null,
      categoryName: p.category?.name ?? null,
      ...(includeBrand && p.brand
        ? { brand: { id: p.brand.id, name: p.brand.name }, brandName: p.brand.name }
        : { brand: null, brandName: null }),
      ...(includeVariants ? { variants } : {}),
      ...(includeOffers
        ? {
            supplierOffers: (offersByProduct.get(String(p.id)) || []).map((o: any) => ({
              id: o.id,
              isActive: o.isActive !== false,
              inStock: o.inStock !== false,
              availableQty: o.availableQty != null ? Number(o.availableQty) : null,
              productId: o.productId ?? null,
              variantId: o.variantId ?? null,
            })),
          }
        : {}),
      attributesSummary: includeAttrs
        ? [
            ...(p.attributeOptions ?? []).map((x: any) => ({
              attribute: x.attribute?.name ?? '',
              value: x.value?.name ?? '',
            })),
            ...(p.ProductAttributeText ?? []).map((x: any) => ({
              attribute: x.attribute?.name ?? '',
              value: String(x.value ?? ''),
            })),
          ]
        : undefined,
    };
  }

  // ---- 6) Runner with optional offer stitching ----------------------------
  async function runQuery(status: string) {
    const statusGuard = status === 'ANY' ? {} : { status: status as any };
    const rows = await prisma.product.findMany({
      where: { AND: [priceGuard, availabilityGuard, statusGuard] },
      orderBy: { createdAt: 'desc' },
      include,
    });

    let offersByProduct = new Map<string, any[]>();
    let offersByVariant = new Map<string, any[]>();

    if (inc.offers && rows.length > 0) {
      const productIds = rows.map((r) => String(r.id));
      const variantIds = inc.variants
        ? rows.flatMap((r) => (r.ProductVariant ?? []).map((v: any) => String(v.id)))
        : [];

      const offers = await prisma.supplierOffer.findMany({
        where: {
          OR: [
            { productId: { in: productIds } },
            ...(variantIds.length ? [{ variantId: { in: variantIds } }] : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          isActive: true,
          inStock: true,
          availableQty: true,
          productId: true,
          variantId: true,
        },
      });

      for (const o of offers) {
        if (o.variantId) {
          const key = String(o.variantId);
          const arr = offersByVariant.get(key) || [];
          arr.push(o);
          offersByVariant.set(key, arr);
        } else if (o.productId) {
          const key = String(o.productId);
          const arr = offersByProduct.get(key) || [];
          arr.push(o);
          offersByProduct.set(key, arr);
        }
      }
    }

    return rows.map((p) =>
      mapRow(p, offersByProduct, offersByVariant, !!inc.variants, !!inc.attributes, !!inc.brand, !!inc.offers)
    );
  }

  try {
    // Primary attempt
    const data = await runQuery(wantStatus);
    return res.json({ data });
  } catch (e: any) {
    const msg = String(e?.message || '');
    const looksEnum = msg.includes('Invalid enum') || msg.includes('Argument status:') || msg.includes('invalid input value');

    if (wantStatus === 'LIVE' && looksEnum) {
      console.warn('[products] LIVE not in enum; falling back to PUBLISHED');
      try {
        const data = await runQuery('PUBLISHED');
        return res.json({ data, note: 'Fell back to PUBLISHED because LIVE enum not found' });
      } catch (e2) {
        console.error('GET /api/products fallback failed:', e2);
        return res.status(500).json({ error: 'Could not load products (fallback failed)' });
      }
    }

    console.error('GET /api/products failed:', e);
    return res.status(500).json({ error: 'Could not load products' });
  }
});


/* ---------------- SIMILAR: must be before '/:id' ---------------- */
router.get('/:id/similar', async (req, res, next) => {
  try {
    const { id } = req.params;

    const me = await prisma.product.findFirst({
      where: { id, status: 'PUBLISHED' as any },
      select: { id: true, price: true, categoryId: true },
    });
    if (!me) return res.status(404).json({ error: 'Product not found' });

    let results = await prisma.product.findMany({
      where: {
        id: { not: id },
        status: 'PUBLISHED' as any,
        ...(me.categoryId ? { categoryId: me.categoryId } : {}),
      },
      take: 12,
      orderBy: { createdAt: 'desc' },
    });

    if (results.length < 6) {
      const price = toNumber(me.price);
      const byPrice = await prisma.product.findMany({
        where: {
          id: { not: id },
          status: 'PUBLISHED' as any,
          price: { gte: Math.max(0, price * 0.6), lte: price * 1.4 },
        },
        take: 12,
        orderBy: { createdAt: 'desc' },
      });
      const seen = new Set(results.map((r: any) => r.id));
      for (const p of byPrice) if (!seen.has(p.id)) results.push(p);
      results = results.slice(0, 12);
    }

    res.json(
      results.map((p: any) => ({
        id: p.id,
        title: p.title,
        price: Number(p.price),
        imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
        inStock: p.inStock !== false,
      })),
    );
  } catch (e) {
    next(e);
  }
});

// GET /api/products/:id?include=brand,variants,attributes,offers
router.get('/:id', async (req, res) => {
  try {
    const inc = parseInclude(req.query);
    const id = String(req.params.id);

    // 1) Fetch by id ONLY — no status/price gating in the DB query
    const row = await prisma.product.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        ...(inc.brand ? { brand: { select: { id: true, name: true } } } : {}),
        ...(inc.variants
          ? {
              // keep your relation field name as used elsewhere (ProductVariant)
              ProductVariant: {
                orderBy: { createdAt: 'asc' },
                select: { id: true, sku: true, price: true, inStock: true, imagesJson: true },
              },
            }
          : {}),
        ...(inc.attributes
          ? {
              attributeOptions: {
                include: {
                  attribute: { select: { id: true, name: true, type: true } },
                  value: { select: { id: true, name: true, code: true } },
                },
              },
              ProductAttributeText: {
                include: { attribute: { select: { id: true, name: true, type: true } } },
                orderBy: [{ attribute: { name: 'asc' } }],
              },
            }
          : {}),
        ...(inc.offers
          ? {
              SupplierOffer: {
                where: { isActive: true },
                select: {
                  id: true,
                  supplierId: true,
                  variantId: true,
                  price: true,
                  currency: true,
                  availableQty: true,
                  inStock: true,
                  leadDays: true,
                  isActive: true,
                },
              },
            }
          : {}),
      },
    });

    // 2) Not found at all
    if (!row) return res.status(404).json({ error: 'Product not found' });

    // 3) Public visibility rule — strict LIVE only
    if (String(row.status).toUpperCase() !== 'LIVE') {
      return res.status(404).json({ error: 'Product not found' });
    }

    // 4) Map payload (no price/variant-price gating here to avoid false 404s)
    const variants =
      inc.variants &&
      (row as any).ProductVariant?.map((v: any) => ({
        id: v.id,
        sku: v.sku ?? null,
        price: v.price != null ? Number(v.price) : null,
        inStock: v.inStock !== false,
        imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
      }));

    const data: any = {
      id: row.id,
      title: row.title,
      description: row.description,
      price: row.price != null ? Number(row.price) : null,
      inStock: row.inStock !== false,
      imagesJson: Array.isArray(row.imagesJson) ? row.imagesJson : [],
      categoryId: row.categoryId ?? row.category?.id ?? null,
      categoryName: row.category?.name ?? null,
      brandId: row.brandId ?? null,
      brand: inc.brand && row.brand ? { id: row.brand.id, name: row.brand.name } : null,
      brandName: inc.brand && row.brand ? row.brand.name : null,
      ...(inc.variants ? { variants } : {}),
      attributesSummary: inc.attributes
        ? [
            ...((row as any).attributeOptions ?? []).map((x: any) => ({
              attribute: x.attribute?.name ?? '',
              value: x.value?.name ?? '',
            })),
            ...((row as any).ProductAttributeText ?? []).map((x: any) => ({
              attribute: x.attribute?.name ?? '',
              value: String(x.value ?? ''),
            })),
          ]
        : undefined,
    };

    if (inc.offers) {
      data.supplierOffers =
        (row as any).SupplierOffer?.map((o: any) => ({
          id: o.id,
          supplierId: o.supplierId,
          variantId: o.variantId,
          price: o.price != null ? Number(o.price) : null,
          currency: o.currency,
          availableQty: o.availableQty ?? 0,
          inStock: o.inStock !== false,
          leadDays: o.leadDays ?? null,
          isActive: o.isActive !== false,
        })) ?? [];
    }

    return res.json({ data });
  } catch (e) {
    console.error('GET /api/products/:id failed:', e);
    return res.status(500).json({ error: 'Could not load product' });
  }
});


export default router;
