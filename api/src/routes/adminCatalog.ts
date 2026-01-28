// api/src/routes/adminCatalog.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAdmin, requireAuth, requireSupplier } from '../middleware/auth.js';

const router = Router();

function isAdmin(role?: string) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}


// GET /api/admin/catalog/usage
router.get('/usage', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    // ---------- Categories usage ----------
    const catGroup = await prisma.product.groupBy({
      by: ['categoryId'],
      _count: { _all: true },
    });
    const categories: Record<string, number> = {};
    for (const g of catGroup) {
      if (g.categoryId) categories[g.categoryId] = g._count._all;
    }

    // ---------- Brands usage ----------
    let brands: Record<string, number> = {};
    try {
      const brandGroup = await prisma.product.groupBy({
        by: ['brandId'],
        _count: { _all: true },
      });
      const m: Record<string, number> = {};
      for (const g of brandGroup) {
        if (g.brandId) m[g.brandId] = g._count._all;
      }
      brands = m;
    } catch {
      brands = {};
    }

    // ---------- Attributes usage ----------
    const attributes: Record<string, number> = {};

    // 1) product-level SELECT/MULTISELECT attribute selections
    try {
      const paoGroup = await prisma.productAttributeOption.groupBy({
        by: ['attributeId'],
        _count: { _all: true },
      });
      for (const g of paoGroup) {
        if (!g.attributeId) continue;
        attributes[g.attributeId] = (attributes[g.attributeId] || 0) + g._count._all;
      }
    } catch (e) {
      console.error('pao groupBy failed', e);
    }

    // 2) product-level TEXT attributes
    try {
      const patGroup = await prisma.productAttributeText.groupBy({
        by: ['attributeId'],
        _count: { _all: true },
      });
      for (const g of patGroup) {
        if (!g.attributeId) continue;
        attributes[g.attributeId] = (attributes[g.attributeId] || 0) + g._count._all;
      }
    } catch (e) {
      console.error('pat groupBy failed', e);
    }

    // 3) variant options (color/size etc chosen per variant)
    try {
      const pvoGroup = await prisma.productVariantOption.groupBy({
        by: ['attributeId'],
        _count: { _all: true },
      });
      for (const g of pvoGroup) {
        if (!g.attributeId) continue;
        attributes[g.attributeId] = (attributes[g.attributeId] || 0) + g._count._all;
      }
    } catch (e) {
      console.error('pvo groupBy failed', e);
    }

    return res.json({ categories, brands, attributes });
  } catch (e) {
    next(e);
  }
});



const slugify = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48) || 'recovered';

router.post('/backfill', requireAuth, async (req, res, next) => {
  try {
    if (!isAdmin(req.user?.role)) {
      return res.status(403).json({ error: 'Admins only' });
    }

    await prisma.$transaction(async (tx: { product: { groupBy: (arg0: { by: string[]; _count: { _all: boolean; } | { _all: boolean; }; }) => any; findFirst: (arg0: { where: { categoryId: string; } | { brandId: string; }; select: any; }) => any; }; category: { findUnique: (arg0: { where: { id: string; }; }) => any; create: (arg0: { data: { id: string; name: any; slug: string; isActive: boolean; }; }) => any; }; brand: { findUnique: (arg0: { where: { id: string; }; }) => any; create: (arg0: { data: { id: string; name: any; slug: string; isActive: boolean; }; }) => any; }; productAttributeOption: { groupBy: (arg0: { by: string[]; _count: { _all: boolean; }; }) => Promise<any>; findFirst: (arg0: { where: { attributeId: string; }; include: { attribute: { select: { name: boolean; type: boolean; }; }; }; }) => any; }; productVariantOption: { groupBy: (arg0: { by: string[]; _count: { _all: boolean; }; }) => Promise<any>; findFirst: (arg0: { where: { attributeId: string; }; include: { attribute: { select: { name: boolean; type: boolean; }; }; }; }) => any; }; attribute: { findUnique: (arg0: { where: { id: string; }; }) => Promise<any>; create: (arg0: { data: { id: string; name: string; type: string; isActive: boolean; }; }) => any; }; }) => {
      /* -------------------- 1) Categories from Product.categoryId -------------------- */
      const catRefs = await tx.product.groupBy({
        by: ['categoryId'],
        _count: { _all: true },
      });

      // ignore nulls; sort by usage desc
      catRefs
        .filter((r: { categoryId: any; }) => !!r.categoryId)
        .sort((a: { _count: { _all: number; }; }, b: { _count: { _all: number; }; }) => b._count._all - a._count._all);

      for (const r of catRefs) {
        const categoryId = r.categoryId as string | null;
        if (!categoryId) continue;

        const exists = await tx.category.findUnique({ where: { id: categoryId } });
        if (!exists) {
          // Try recover name from a sample product, else synthesize
          const sample = await tx.product.findFirst({
            where: { categoryId },
            select: { categoryName: true } as any, // tolerate if column doesn't exist
          });

          const name =
            (sample as any)?.categoryName ||
            `Recovered Category ${categoryId.slice(0, 6)}`;

          await tx.category.create({
            data: {
              id: categoryId,
              name,
              slug: slugify(name),
              isActive: true,
            },
          });
        }
      }

      /* -------------------- 2) Brands from Product.brandId -------------------- */
      try {
        const brandRefs = await tx.product.groupBy({
          by: ['brandId'],
          _count: { _all: true },
        });

        brandRefs
          .filter((r: { brandId: any; }) => !!r.brandId)
          .sort((a: { _count: { _all: number; }; }, b: { _count: { _all: number; }; }) => b._count._all - a._count._all);

        for (const r of brandRefs) {
          const brandId = r.brandId as string | null;
          if (!brandId) continue;

          const exists = await tx.brand.findUnique({ where: { id: brandId } });
          if (!exists) {
            // Try recover brand name off product, else synthesize
            const sample = await tx.product.findFirst({
              where: { brandId },
              select: { brandName: true, brand: { select: { name: true } } } as any,
            });

            const name =
              (sample as any)?.brandName ||
              (sample as any)?.brand?.name ||
              `Recovered Brand ${brandId.slice(0, 6)}`;

            await tx.brand.create({
              data: {
                id: brandId,
                name,
                slug: slugify(name),
                isActive: true,
              },
            });
          }
        }
      } catch (e) {
        console.warn('Backfill (Brand) skipped:', e);
      }

      /* --------- 3) Attributes best-effort from ProductAttributeOption & VariantOption --------- */

      // Gather attribute IDs from BOTH tables, filter out nulls
      const [paoRefs, pvoRefs] = await Promise.all([
        tx.productAttributeOption.groupBy({ by: ['attributeId'], _count: { _all: true } }).catch((e) => {
          console.error('pao groupBy failed', e);
          return [] as Array<{ attributeId: string | null; _count: { _all: number } }>;
        }),
        tx.productVariantOption.groupBy({ by: ['attributeId'], _count: { _all: true } }).catch((e) => {
          console.error('pvo groupBy failed', e);
          return [] as Array<{ attributeId: string | null; _count: { _all: number } }>;
        }),
      ]);

      const attrIdToCount = new Map<string, number>();
      for (const r of [...paoRefs, ...pvoRefs]) {
        if (!r.attributeId) continue;
        attrIdToCount.set(r.attributeId, (attrIdToCount.get(r.attributeId) || 0) + (r._count?._all || 0));
      }

      const attrIds = [...attrIdToCount.keys()].sort(
        (a, b) => (attrIdToCount.get(b) || 0) - (attrIdToCount.get(a) || 0),
      );

      for (const attributeId of attrIds) {
        const exists = await tx.attribute.findUnique({ where: { id: attributeId } }).catch(() => null);
        if (!exists) {
          // Try to recover attribute name/type via a sample from either table; if not, synthesize
          let name = `Recovered Attribute ${attributeId.slice(0, 6)}`;
          let type = 'SELECT';

          try {
            const samplePao = await tx.productAttributeOption.findFirst({
              where: { attributeId },
              include: { attribute: { select: { name: true, type: true } } },
            });
            if (samplePao?.attribute?.name) name = samplePao.attribute.name;
            if (samplePao?.attribute?.type) type = samplePao.attribute.type;
          } catch {}

          try {
            const samplePvo = await tx.productVariantOption.findFirst({
              where: { attributeId },
              include: { attribute: { select: { name: true, type: true } } },
            });
            if (samplePvo?.attribute?.name) name = samplePvo.attribute.name;
            if (samplePvo?.attribute?.type) type = samplePvo.attribute.type;
          } catch {}

          await tx.attribute.create({
            data: { id: attributeId, name, type, isActive: true },
          });
        }
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});


export default router;
