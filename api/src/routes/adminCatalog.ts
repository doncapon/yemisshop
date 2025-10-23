// api/src/routes/adminCatalog.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function isAdmin(role?: string) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

// GET /api/admin/catalog/usage
router.get('/usage', authMiddleware, async (req, res, next) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ error: 'Admins only' });

    // Categories usage
    const catGroup = await prisma.product.groupBy({
      by: ['categoryId'],
      _count: { _all: true },
    });
    const categories: Record<string, number> = {};
    for (const g of catGroup) {
      if (g.categoryId) categories[g.categoryId] = g._count._all;
    }

    // Brands usage
    let brands: Record<string, number> = {};
    try {
      const brandGroup = await prisma.product.groupBy({
        by: ['brandId'],
        _count: { _all: true },
        where: { brandId: { not: null } },
      });
      const m: Record<string, number> = {};
      for (const g of brandGroup) {
        if (g.brandId) m[g.brandId] = g._count._all;
      }
      brands = m;
    } catch {
      brands = {};
    }

    // Attributes usage — attempt common schemas, fall back to empty
    const attributes: Record<string, number> = {};

    // Try productAttributeValues table (attributeId on row)
    try {
      const pavGroup = await prisma.productAttributeValue.groupBy({
        by: ['attributeId'],
        _count: { _all: true },
      });
      for (const g of pavGroup) {
        if (g.attributeId) attributes[g.attributeId] = (attributes[g.attributeId] || 0) + g._count._all;
      }
    } catch (e) {
      console.error('pav groupBy failed', e);
    }

    // Try variant options table (if you have variant options carrying attributeId)
    try {
      const voGroup = await prisma.productVariantOption.groupBy({
        by: ['attributeId'],
        _count: { _all: true },
      });
      for (const g of voGroup) {
        if (g.attributeId) attributes[g.attributeId] = (attributes[g.attributeId] || 0) + g._count._all;
      }
    } catch (e) {
      console.error('vo groupBy failed', e);
    }

    return res.json({ categories, brands, attributes });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/catalog/backfill
router.post('/backfill', authMiddleware, async (req, res, next) => {
  try {
    if (!isAdmin(req.user?.role)) return res.status(403).json({ error: 'Admins only' });

    await prisma.$transaction(async (tx: {
      product: { groupBy: (arg0: { by: string[]; _count: { _all: boolean; } | { _all: boolean; }; where: { categoryId: { not: null; }; } | { brandId: { not: null; }; }; }) => any; findFirst: (arg0: { where: { categoryId: any; } | { brandId: any; }; }) => any; }; category: {
        findUnique: (arg0: { where: { id: any; }; }) => any; create: (arg0: {
          data: {
            id: any; // preserve id so linked products remain valid
            name: any; slug: any; isActive: boolean;
          };
        }) => any;
      }; brand: { findUnique: (arg0: { where: { id: any; }; }) => any; create: (arg0: { data: { id: any; name: any; slug: any; isActive: boolean; }; }) => any; }; productAttributeValue: { groupBy: (arg0: { by: string[]; _count: { _all: boolean; }; where: { attributeId: { not: null; }; }; }) => any; }; attribute: { findUnique: (arg0: { where: { id: any; } | { id: any; }; }) => any; create: (arg0: { data: { id: any; name: string; type: string; isActive: boolean; } | { id: any; name: string; type: string; isActive: boolean; }; }) => any; }; productVariantOption: { groupBy: (arg0: { by: string[]; _count: { _all: boolean; }; where: { attributeId: { not: null; }; }; }) => any; };
    }) => {
      // 1) Backfill Categories
      const catRefs = await tx.product.groupBy({
        by: ['categoryId'],
        _count: { _all: true },
        where: { categoryId: { not: null } },
      });

      for (const r of catRefs) {
        if (!r.categoryId) continue;
        const exists = await tx.category.findUnique({ where: { id: r.categoryId } });
        if (!exists) {
          // Create placeholder category; if you store categoryName on product, try to recover it
          const sample = await tx.product.findFirst({ where: { categoryId: r.categoryId } });
          const nameCandidate = (sample as any)?.categoryName || `Recovered Category ${r.categoryId.slice(0, 6)}`;
          const slugCandidate = nameCandidate
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '')
            .slice(0, 48) || `recovered-${r.categoryId.slice(0, 6)}`;

          await tx.category.create({
            data: {
              id: r.categoryId, // preserve id so linked products remain valid
              name: nameCandidate,
              slug: slugCandidate,
              isActive: true,
            },
          });
        }
      }

      // 2) Backfill Brands (if brandId exists on product)
      try {
        const brandRefs = await tx.product.groupBy({
          by: ['brandId'],
          _count: { _all: true },
          where: { brandId: { not: null } },
        });

        for (const r of brandRefs) {
          if (!r.brandId) continue;
          const exists = await tx.brand.findUnique({ where: { id: r.brandId } });
          if (!exists) {
            const sample = await tx.product.findFirst({ where: { brandId: r.brandId } });
            const nameCandidate =
              (sample as any)?.brandName || (sample as any)?.brand?.name || `Recovered Brand ${r.brandId.slice(0, 6)}`;
            const slugCandidate = nameCandidate
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/(^-|-$)/g, '')
              .slice(0, 48) || `recovered-${r.brandId.slice(0, 6)}`;

            await tx.brand.create({
              data: {
                id: r.brandId,
                name: nameCandidate,
                slug: slugCandidate,
                isActive: true,
              },
            });
          }
        }
      } catch { /* ignore if no brand table */ }

      // 3) Backfill Attributes (best-effort, try common tables)
      // 3a) From productAttributeValue.attributeId
      try {
        const pavRefs = await tx.productAttributeValue.groupBy({
          by: ['attributeId'],
          _count: { _all: true },
          where: { attributeId: { not: null } },
        });

        for (const r of pavRefs) {
          if (!r.attributeId) continue;
          const exists = await tx.attribute.findUnique({ where: { id: r.attributeId } });
          if (!exists) {
            await tx.attribute.create({
              data: {
                id: r.attributeId,
                name: `Recovered Attribute ${r.attributeId.slice(0, 6)}`,
                type: 'SELECT',
                isActive: true,
              },
            });
          }
        }
      } catch { /* ignore */ }

      // 3b) From productVariantOption.attributeId
      try {
        const voRefs = await tx.productVariantOption.groupBy({
          by: ['attributeId'],
          _count: { _all: true },
          where: { attributeId: { not: null } },
        });

        for (const r of voRefs) {
          if (!r.attributeId) continue;
          const exists = await tx.attribute.findUnique({ where: { id: r.attributeId } });
          if (!exists) {
            await tx.attribute.create({
              data: {
                id: r.attributeId,
                name: `Recovered Attribute ${r.attributeId.slice(0, 6)}`,
                type: 'SELECT',
                isActive: true,
              },
            });
          }
        }
      } catch { /* ignore */ }
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
