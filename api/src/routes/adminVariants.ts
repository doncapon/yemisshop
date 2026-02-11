// api/src/routes/productVariants.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";

function toNumOrNull(n: any): number | null {
  if (n === "" || n == null) return null;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

type VariantOptionIn = {
  attributeId: string;
  valueId: string;
  // ✅ priceBump removed completely
};

type VariantIn = {
  id?: string | null;
  sku?: string | null;

  // ✅ Full variant price only (no bump math)
  price?: number | null;

  inStock?: boolean | null;
  imagesJson?: string[] | null;
  options?: VariantOptionIn[];
};

const router = Router();

router.patch("/:variantId", async (req, res) => {
  const { variantId } = req.params;
  const { sku, price, inStock, imagesJson, options } = req.body as VariantIn;

  try {
    const data: any = {
      ...(sku !== undefined ? { sku } : {}),
      // ✅ Prisma field is retailPrice (mapped to DB column "price")
      ...(price !== undefined ? { retailPrice: toNumOrNull(price) } : {}),
      ...(inStock !== undefined ? { inStock } : {}),
      ...(imagesJson !== undefined ? { imagesJson } : {}),
    };

    const result = await prisma.$transaction(async (tx) => {
      await tx.productVariant.update({ where: { id: variantId }, data });

      if (Array.isArray(options)) {
        // keep only valid option pairs
        const keep = new Set(
          options
            .filter((o) => o?.attributeId && o?.valueId)
            .map((o) => `${String(o.attributeId)}:${String(o.valueId)}`)
        );

        const stale = await tx.productVariantOption.findMany({
          where: { variantId },
          select: { id: true, attributeId: true, valueId: true },
        });

        const toDelete = stale
          .filter((o: any) => !keep.has(`${String(o.attributeId)}:${String(o.valueId)}`))
          .map((o: any) => o.id);

        if (toDelete.length) {
          await tx.productVariantOption.deleteMany({ where: { id: { in: toDelete } } });
        }

        for (const o of options) {
          if (!o?.attributeId || !o?.valueId) continue;

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
              // ✅ no priceBump / no bump fields written
            },
            update: {
              // ✅ nothing to update (still valid upsert)
            },
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

    return res.json({ data: result });
  } catch (e: any) {
    return res.status(500).json({ error: "Failed to update variant", detail: e?.message });
  }
});

export default router;
