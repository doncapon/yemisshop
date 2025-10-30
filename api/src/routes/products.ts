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

  // 1) parse status with safe defaults
  const ALLOWED = new Set(['ANY', 'LIVE', 'PUBLISHED', 'PENDING', 'REJECTED', 'ARCHIVED']);
  const rawStatus = String(req.query.status ?? 'LIVE').toUpperCase();
  const wantStatus = ALLOWED.has(rawStatus) ? rawStatus : 'LIVE';

  // 2) common filters: price guard + optional status (we’ll try LIVE; if that explodes, we’ll retry with PUBLISHED)
  const commonWhere: any = {
    OR: [
      { price: { gt: new Prisma.Decimal(0) } },
      { ProductVariant: { some: { price: { not: null, gt: new Prisma.Decimal(0) } } } },
    ],
  };
  const withStatus = (status: string) =>
    status === 'ANY' ? commonWhere : { ...commonWhere, status: status as any };

  // 3) common include
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
  };

  // tiny mapper for response
  const mapRow = (p: any, offersByProduct: Map<string, any[]>, offersByVariant: Map<string, any[]>, includeVariants: boolean, includeAttrs: boolean, includeBrand: boolean, includeOffers: boolean) => {
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
      brandId: p.brandId ?? null,
      ...(includeBrand && p.brand ? { brand: { id: p.brand.id, name: p.brand.name }, brandName: p.brand.name } : { brand: null, brandName: null }),
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
  };

  // function to fetch + (optionally) stitch offers
  async function runQueryWith(whereObj: any) {
    const rows = await prisma.product.findMany({
      where: whereObj,
      orderBy: { createdAt: 'desc' },
      include,
    });

    // If offers were requested, fetch them with separate queries to avoid relying on relation field names.
    let offersByProduct = new Map<string, any[]>();
    let offersByVariant = new Map<string, any[]>();

    if (inc.offers && rows.length > 0) {
      const productIds = rows.map((r: any) => String(r.id));
      const variantIds = inc.variants
        ? rows.flatMap((r: any) => (r.ProductVariant ?? []).map((v: any) => String(v.id)))
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

    const data = rows.map((p: any) =>
      mapRow(p, offersByProduct, offersByVariant, !!inc.variants, !!inc.attributes, !!inc.brand, !!inc.offers)
    );

    return data;
  }

  try {
    // Try with requested status (default LIVE)
    const data = await runQueryWith(withStatus(wantStatus));
    return res.json({ data });
  } catch (e: any) {
    // If LIVE isn't in your enum yet, Prisma throws an invalid enum error.
    const msg = String(e?.message || '');
    const looksLikeEnumError =
      msg.includes('Invalid enum') || msg.includes('Argument status:') || msg.includes('invalid input value');

    // graceful fallback: if the client asked for LIVE but your DB doesn’t know it yet,
    // retry with PUBLISHED so the page doesn’t 500. Remove this once LIVE exists in your enum.
    if (wantStatus === 'LIVE' && looksLikeEnumError) {
      console.warn('[products] LIVE status not present in DB enum, falling back to PUBLISHED');
      try {
        const data = await runQueryWith(withStatus('PUBLISHED'));
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

/* ---------------- DETAIL: GET /api/products/:id ---------------- */
router.get('/:id', async (req, res, next) => {
  try {
    const inc = parseInclude(req.query);
    const p = await prisma.product.findFirst({
      where: { id: req.params.id, status: 'PUBLISHED' as any },
      include: {
        category: { select: { id: true, name: true } },
        ...(inc.brand ? { brand: { select: { id: true, name: true } } } : {}),
        ...(inc.variants
          ? {
              ProductVariant: {
                include: {
                  options: {
                    include: {
                      attribute: { select: { id: true, name: true, type: true } },
                      value: { select: { id: true, name: true, code: true } },
                    },
                  },
                },
                orderBy: { createdAt: 'asc' },
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
                orderBy: [{ attribute: { name: 'asc' } }],
              },
              ProductAttributeText: {
                include: {
                  attribute: { select: { id: true, name: true, type: true } },
                },
                orderBy: [{ attribute: { name: 'asc' } }],
              },
            }
          : {}),
      },
    });

    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(mapProduct(p, inc));
  } catch (e) {
    next(e);
  }
});

export default router;
