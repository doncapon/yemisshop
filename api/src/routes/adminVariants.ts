import { Router } from "express";
import { prisma } from '../lib/prisma.js'


function toNumOrNull(n: any): number | null {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

type VariantOptionIn = {
  attributeId: string;
  valueId: string;
  priceBump?: number | null; // may be undefined / null / number
};

type VariantIn = {
  id?: string | null;
  sku?: string | null;
  price?: number | null;
  inStock?: boolean | null;
  imagesJson?: string[] | null;
  options?: VariantOptionIn[];
};

const router = Router();

router.patch("/api/admin/variants/:variantId", async (req, res) => {
  const { variantId } = req.params;
  const { sku, price, inStock, imagesJson, options } = req.body as VariantIn;

  try {
    const data: any = {
      ...(sku !== undefined ? { sku } : {}),
      ...(price !== undefined ? { price: toNumOrNull(price) } : {}),
      ...(inStock !== undefined ? { inStock } : {}),
      ...(imagesJson !== undefined ? { imagesJson } : {}),
    };

    const result = await prisma.$transaction(async (tx: { productVariant: { update: (arg0: { where: { id: string; }; data: any; }) => any; findUnique: (arg0: { where: { id: string; }; include: { options: { include: { attribute: boolean; value: { select: { id: boolean; name: boolean; code: boolean; }; }; }; }; }; }) => any; }; productVariantOption: { findMany: (arg0: { where: { variantId: string; }; select: { id: boolean; attributeId: boolean; valueId: boolean; }; }) => any; deleteMany: (arg0: { where: { id: { in: any; }; }; }) => any; upsert: (arg0: { where: any; create: { variantId: string; attributeId: string; valueId: string; priceBump: number | null; }; update: { priceBump: number | null; }; }) => any; }; }) => {
      await tx.productVariant.update({ where: { id: variantId }, data });

      if (Array.isArray(options)) {
        const keep = new Set(options.map((o) => `${o.attributeId}:${o.valueId}`));

        const stale = await tx.productVariantOption.findMany({
          where: { variantId },
          select: { id: true, attributeId: true, valueId: true },
        });

        const toDelete = stale.filter((o: { attributeId: any; valueId: any; }) => !keep.has(`${o.attributeId}:${o.valueId}`)).map((o: { id: any; }) => o.id);
        if (toDelete.length) await tx.productVariantOption.deleteMany({ where: { id: { in: toDelete } } });

        for (const o of options) {
          await tx.productVariantOption.upsert({
            where: {
              variantId_attributeId_valueId: {
                variantId,
                attributeId: o.attributeId,
                valueId: o.valueId,
              },
            } as any,
            create: {
              variantId,
              attributeId: o.attributeId,
              valueId: o.valueId,
              priceBump: toNumOrNull(o.priceBump),
            },
            update: { priceBump: toNumOrNull(o.priceBump) },
          });
        }
      }

      return tx.productVariant.findUnique({
        where: { id: variantId },
        include: {
          options: {
            include: {
              attribute: true,
              value: { select: { id: true, name: true, code: true } },
            },
          },
        },
      });
    });

    res.json({ data: result });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to update variant", detail: e?.message });
  }
});


export default router;
