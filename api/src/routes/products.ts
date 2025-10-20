import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';

const router = Router();

function toProductDTO(p: any) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    price: Number(p.price),      // <- normalize Decimal -> number
    sku: p.sku,
    inStock: p.inStock,
    vatFlag: p.vatFlag,
    status: p.status,
    imagesJson: p.imagesJson,            // text[]
    supplierId: p.supplierId,
    supplierTypeOverride: p.supplierTypeOverride,
    commissionPctInt: p.commissionPctInt ?? null,
    categoryId: p.categoryId,
    categoryName: p.categoryName
  };
}

// Single product
router.get('/:id', async (req, res, next) => {
  try {
    const p = await prisma.product.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, title: true, description: true, price: true,
        imagesJson: true, categoryId: true, inStock: true,
        category: { select: { name: true } },
      },
    });
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({
      id: p.id,
      title: p.title,
      description: p.description,
      price: Number(p.price),
      imagesJson: p.imagesJson ?? [],
      categoryId: p.categoryId,
      stock: p.stock,
      categoryName: p.category?.name ?? null,
    });
  } catch (e) { next(e); }
});


router.get('/:id', async (req, res, next) => {
  try {
    const p = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(toProductDTO(p));
  } catch (e) {
    next(e);
  }
});


router.get('/:id/similar', async (req, res, next) => {
  try {
    const { id } = req.params;
    const me = await prisma.product.findUnique({ where: { id } });
    if (!me) return res.status(404).json({ error: 'Product not found' });

    const byCat = await prisma.product.findMany({
      where: { id: { not: id }, categoryId: me.categoryId ?? undefined },
      take: 12,
      orderBy: { createdAt: 'desc' },
    });

    // Fallback by price window if category is empty
    let results = byCat;
    if (results.length < 6) {
      const price = Number(me.price) || 0;
      const window = { min: Math.max(0, price * 0.6), max: price * 1.4 };
      const byPrice = await prisma.product.findMany({
        where: {
          id: { not: id },
          price: { gte: window.min, lte: window.max },
        },
        take: 12,
        orderBy: { createdAt: 'desc' },
      });
      // merge unique
      const seen = new Set(results.map((r: { id: any; }) => r.id));
      for (const p of byPrice) if (!seen.has(p.id)) results.push(p);
    }

    res.json(results.slice(0, 12));
  } catch (e) { next(e); }
});


/**
 * GET /api/products
 * Query:
 *  - q: string (search title/description/category)
 *  - categoryId: string
 *  - brandIds: string | string[] (comma-separated or repeated)
 *  - minPrice, maxPrice: number
 *  - inStock: "1" | "true" | "0" | "false"
 *  - page, pageSize: number
 *  - include: csv: "brand,variants,attributes"
 *
 * Includes:
 *  - brand: Product.brand
 *  - variants: ProductVariant[] with options (Attribute + AttributeValue)
 *  - attributes:
 *      - productAttributeValues (Attribute, AttributeValue)
 *      - productAttributeTexts (Attribute)
 */
const QuerySchema = z.object({
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
  include: z
    .string()
    .optional()
    .transform((s) => new Set((s ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))),
});



/**
 * GET /api/products
 * Optional: ?include=brand,variants,attributes
 * Public: no auth required.
 */
// api/src/routes/products.ts (inside r.get('/', ...))
router.get('/', async (req, res) => {
  try {
    const includeParam = String(req.query.include || '').toLowerCase();
    const wantBrand = includeParam.includes('brand');
    const wantVariants = includeParam.includes('variants');
    const wantAttributes = includeParam.includes('attributes');

    const products = await prisma.product.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        id: true,
        title: true,
        description: true,
        price: true,
        inStock: true,
        imagesJson: true,

        // keep if you store it
        categoryId: true,
        categoryName: true,

        // 🔥 add this join
        category: { select: { id: true, name: true, slug: true } },

        brandId: true,
        ...(wantBrand && { brand: { select: { id: true, name: true } } }),
        ...(wantVariants && {
          ProductVariant: {
            select: { id: true, sku: true, price: true, inStock: true, imagesJson: true },
          },
        }),
        ...(wantAttributes && {
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
        }),
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = products.map((p: any) => {
      const variants = wantVariants ? (p.ProductVariant ?? []) : [];
      const attributesSummary =
        wantAttributes
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
          : [];

      return {
        id: p.id,
        title: p.title,
        description: p.description,
        price: p.price,
        inStock: p.inStock,
        imagesJson: p.imagesJson,

        // ✅ prefer canonical category name from join
        categoryId: p.categoryId ?? p.category?.id ?? null,
        categoryName: p.category?.name ?? p.categoryName ?? null,
        categorySlug: p.category?.slug ?? null, // (handy later)

        brandId: p.brandId,
        brand: wantBrand && p.brand ? { id: p.brand.id, name: p.brand.name } : undefined,
        brandName: wantBrand && p.brand ? p.brand.name : null,
        variants,
        attributesSummary,
      };
    });

    res.json({ data });

  } catch (e) {
    console.error('GET /api/products failed:', e);
    res.status(500).json({ error: 'Could not load products.' });
  }
});

// api/src/routes/products.ts (or wherever your GET /:id lives)
router.get('/:id', async (req, res) => {
  try {
    const includeParam = String(req.query.include || '').toLowerCase();
    const wantBrand = includeParam.includes('brand');
    const wantVariants = includeParam.includes('variants');
    const wantAttributes = includeParam.includes('attributes');

    const products = await prisma.product.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        id: true,
        title: true,
        description: true,
        price: true,
        inStock: true,
        imagesJson: true,

        // keep if you store it
        categoryId: true,
        categoryName: true,

        // 🔥 add this join
        category: { select: { id: true, name: true, slug: true } },

        brandId: true,
        ...(wantBrand && { brand: { select: { id: true, name: true } } }),
        ...(wantVariants && {
          ProductVariant: {
            select: { id: true, sku: true, price: true, inStock: true, imagesJson: true },
          },
        }),
        ...(wantAttributes && {
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
        }),
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = products.map((p: any) => {
      const variants = wantVariants ? (p.ProductVariant ?? []) : [];
      const attributesSummary =
        wantAttributes
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
          : [];

      return {
        id: p.id,
        title: p.title,
        description: p.description,
        price: p.price,
        inStock: p.inStock,
        imagesJson: p.imagesJson,

        // ✅ prefer canonical category name from join
        categoryId: p.categoryId ?? p.category?.id ?? null,
        categoryName: p.category?.name ?? p.categoryName ?? null,
        categorySlug: p.category?.slug ?? null, // (handy later)

        brandId: p.brandId,
        brand: wantBrand && p.brand ? { id: p.brand.id, name: p.brand.name } : undefined,
        brandName: wantBrand && p.brand ? p.brand.name : null,
        variants,
        attributesSummary,
      };
    });

    res.json({ data });

  } catch (e) {
    console.error('GET /api/products/:id failed:', e);
    res.status(500).json({ error: 'Could not load product.' });
  }
});



export default router;
