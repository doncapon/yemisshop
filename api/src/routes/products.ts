// api/src/routes/products.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

const router = Router();

/* ---------------- helpers ---------------- */
function parseInclude(q: any) {
  const inc = String(q?.include || '').toLowerCase();
  return {
    brand: inc.includes('brand'),
    variants: inc.includes('variants'),
    attributes: inc.includes('attributes'),
  };
}

function toNumber(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function mapVariant(v: any) {
  return {
    id: v.id,
    sku: v.sku,
    price: v.price != null ? Number(v.price) : null,
    inStock: v.inStock !== false,
    imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
    options: (v.options || []).map((o: any) => ({
      attribute: {
        id: o.attribute.id,
        name: o.attribute.name,
        type: o.attribute.type,
      },
      value: {
        id: o.value.id,
        name: o.value.name,
        code: o.value.code ?? null,
      },
    })),
  };
}

function mapProduct(p: any, opts: { brand: boolean; variants: boolean; attributes: boolean }) {
  const out: any = {
    id: p.id,
    title: p.title,
    description: p.description,
    price: Number(p.price),
    inStock: p.inStock !== false,
    imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
    categoryId: p.categoryId ?? null,
    categoryName: p.category?.name ?? p.categoryName ?? null,
    brandId: p.brandId ?? null,
  };

  if (opts.brand) {
    out.brand = p.brand ? { id: p.brand.id, name: p.brand.name } : null;
    out.brandName = p.brand ? p.brand.name : null;
  }

  if (opts.variants) {
    const vs = (p.ProductVariant || []).map(mapVariant);
    out.variants = vs;
  }

  if (opts.attributes) {
    const pavs = p.ProductAttributeValue || [];
    const pats = p.ProductAttributeText || [];
    out.attributeValues = pavs.map((av: any) => ({
      id: av.id,
      attribute: { id: av.attribute.id, name: av.attribute.name, type: av.attribute.type },
      value: { id: av.value.id, name: av.value.name, code: av.value.code ?? null },
    }));
    out.attributeTexts = pats.map((at: any) => ({
      id: at.id,
      attribute: { id: at.attribute.id, name: at.attribute.name, type: at.attribute.type },
      value: at.value,
    }));
  }

  return out;
}

/* ---------------- LIST: GET /api/products ----------------
   Supports filters + ?include=brand,variants,attributes
--------------------------------------------------------- */

const ListQuery = z.object({
  q: z.string().optional(),
  categoryId: z.string().optional(),
  brandIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (!v) return [] as string[];
      if (Array.isArray(v)) return v.flatMap((s) => s.split(',').map((x) => x.trim()).filter(Boolean));
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

// GET /api/products?include=brand,variants,attributes
router.get('/', async (req, res) => {
  try {
    const includeStr = String(req.query.include || '').toLowerCase();
    const wantBrand       = includeStr.includes('brand');
    const wantVariants    = includeStr.includes('variants');
    const wantAttributes  = includeStr.includes('attributes');
    const wantOffers      = includeStr.includes('offers');
    const withOffersOnly  = ['1', 'true', 'yes'].includes(String(req.query.withOffersOnly || '').toLowerCase());

    const where: any = { status: 'PUBLISHED' };

    // Optional: only return products that have at least one active, in-stock offer
    if (withOffersOnly && wantOffers) {
      where.OR = [
        { supplierOffers: { some: { isActive: true, inStock: true } } },
        { ProductVariant: { some: { offers: { some: { isActive: true, inStock: true } } } } },
      ];
    }

    const rows = await prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      // Use include for relations; scalars come by default (no select).
      include: {
        category: { select: { id: true, name: true, slug: true } },
        ...(wantBrand ? { brand: { select: { id: true, name: true } } } : {}),

        // product-wide offers
        ...(wantOffers ? {
          supplierOffers: {
            select: { id: true, isActive: true, inStock: true, price: true, currency: true }
          }
        } : {}),

        // variants (name is ProductVariant in your schema)
        ...(wantVariants ? {
          ProductVariant: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true, sku: true, price: true, inStock: true, imagesJson: true,
              ...(wantOffers ? {
                offers: {
                  select: { id: true, isActive: true, inStock: true, price: true, currency: true }
                }
              } : {}),
            },
          }
        } : {}),

        // attributes
        ...(wantAttributes ? {
          ProductAttributeValue: {
            select: {
              id: true,
              attribute: { select: { id: true, name: true, type: true } },
              value: { select: { id: true, name: true, code: true } },
            },
          },
          ProductAttributeText: {
            select: {
              id: true,
              attribute: { select: { id: true, name: true, type: true } },
              value: true,
            },
          },
        } : {}),
      },
    });

    const data = rows.map((p: any) => {
      const variants = (p.ProductVariant ?? []).map((v: any) => ({
        id: v.id,
        sku: v.sku,
        price: v.price != null ? Number(v.price) : undefined,
        inStock: v.inStock !== false,
        imagesJson: Array.isArray(v.imagesJson) ? v.imagesJson : [],
        ...(wantOffers ? { offers: Array.isArray(v.offers) ? v.offers : [] } : {}),
      }));

      return {
        id: p.id,
        title: p.title,
        description: p.description,
        price: p.price != null ? Number(p.price) : undefined,
        inStock: p.inStock !== false,
        imagesJson: Array.isArray(p.imagesJson) ? p.imagesJson : [],
        categoryId: p.categoryId ?? p.category?.id ?? null,
        categoryName: p.category?.name ?? null,
        brandId: p.brandId ?? null,
        brand: wantBrand && p.brand ? { id: p.brand.id, name: p.brand.name } : null,
        brandName: wantBrand && p.brand ? p.brand.name : null,

        // expose offers so the frontend can filter on them
        ...(wantOffers ? { supplierOffers: Array.isArray(p.supplierOffers) ? p.supplierOffers : [] } : {}),
        ...(wantVariants ? { variants } : {}),

        attributesSummary: wantAttributes
          ? [
              ...(p.ProductAttributeValue ?? []).map((x: any) => ({
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
    });

    res.json({ data });
  } catch (e) {
    console.error('GET /api/products failed:', e);
    res.status(500).json({ error: 'Could not load products' });
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

    // prefer same category
    let results = await prisma.product.findMany({
      where: {
        id: { not: id },
        status: 'PUBLISHED' as any,
        ...(me.categoryId ? { categoryId: me.categoryId } : {}),
      },
      take: 12,
      orderBy: { createdAt: 'desc' },
    });

    // fallback by price window
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
      const seen = new Set(results.map((r: { id: any; }) => r.id));
      for (const p of byPrice) if (!seen.has(p.id)) results.push(p);
      results = results.slice(0, 12);
    }

    res.json(
      results.map((p: { id: any; title: any; price: any; imagesJson: any; inStock: boolean; }) => ({
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

/* ---------------- DETAIL: GET /api/products/:id ----------------
   Returns a single product object directly (no {data: ...} wrapper)
   Supports ?include=brand,variants,attributes
--------------------------------------------------------------- */

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
              ProductAttributeValue: {
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

    // Return the product object directly (what ProductDetail expects)
    res.json(mapProduct(p, inc));
  } catch (e) {
    next(e);
  }
});

export default router;
