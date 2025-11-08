// api/src/routes/cart.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

const router = Router();

type SelectedOption = { attributeId: string; valueId: string };

// Helper: coerce number
const toNum = (n: any, d = 0) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
};

// Helper: build "aid:vid" key
const pairKey = (aid?: string, vid?: string) =>
  `${String(aid || '').trim()}:${String(vid || '').trim()}`;

// POST /api/cart/items
router.post('/items', async (req, res) => {
  try {
    const {
      productId,
      variantId,                 // optional hint
      selectedOptions = [],      // Array<{ attributeId, valueId }>
      quantity = 1,
      // 👇 If you pass an orderId for a pending "cart order", we will persist.
      orderId,                   // <-- optional: the ID of an existing pending order that represents the cart
    } = req.body as {
      productId: string;
      variantId?: string | null;
      selectedOptions?: SelectedOption[];
      quantity?: number;
      orderId?: string | null;
    };

    if (!productId) {
      return res.status(400).json({ error: 'productId is required' });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        ProductVariant: {
          include: {
            // ProductVariant.options is ProductVariantOption[]
            options: {
              include: {
                attribute: true,
                value: true,
              },
            },
          },
        },
      },
    });

    if (!product) return res.status(404).json({ error: 'Product not found' });

    const base = toNum(product.price, 0);

    // Selected pairs (strings)
    const selectedPairs = new Set<string>(
      (Array.isArray(selectedOptions) ? selectedOptions : [])
        .filter((o): o is SelectedOption => !!o && !!o.attributeId && !!o.valueId)
        .map((o) => pairKey(o.attributeId, o.valueId))
    );

    // Find best match for selection (subset match: all selected pairs are in the variant)
    const variants = product.ProductVariant || [];
    const match = variants.find((v: { options: any; }) => {
      const vPairs = new Set<string>(
        (v.options || []).map((o: { attributeId: any; attribute: { id: any; }; valueId: any; value: { id: any; }; }) =>
          pairKey(o.attributeId || o.attribute?.id, o.valueId || o.value?.id)
        )
      );
      for (const p of selectedPairs) {
        if (!vPairs.has(p)) return false;
      }
      return selectedPairs.size > 0; // require that the user actually selected something
    });

    // Sum bumps from any option definition that matches selected pairs
    // (If you store priceBump on options, use that; otherwise bump=0.)
    let bumpSum = 0;
    if (selectedPairs.size > 0) {
      // flatten all option definitions once for lookup
      const allOptions = variants.flatMap((v: { options: any; }) => v.options || []);
      for (const key of selectedPairs) {
        const [aid, vid] = key.split(':');
        const opt = allOptions.find(
          (o: { attributeId: any; attribute: { id: any; }; valueId: any; value: { id: any; }; }) =>
            (String(o.attributeId || o.attribute?.id) === aid) &&
            (String(o.valueId || o.value?.id) === vid) &&
            (o as any) && ((o as any).priceBump != null || (o as any).bump != null)
        );
        if (opt) {
          bumpSum += toNum((opt as any).priceBump ?? (opt as any).bump, 0);
        }
      }
    }

    // Compute final price
    let unitPrice = base + bumpSum;
    if (match?.price != null && selectedPairs.size > 0) {
      // exact variant price overrides when user picked something
      unitPrice = toNum(match.price, unitPrice);
    }

    const resolvedVariantId = match?.id ?? variantId ?? null;

    // If caller gave us a valid pending "cart order" id, persist; else return preview.
    if (!orderId) {
      return res.json({
        data: {
          productId: product.id,
          variantId: resolvedVariantId,
          quantity: toNum(quantity, 1),
          unitPrice,
          lineTotal: unitPrice * toNum(quantity, 1),
          selectedOptions,
        },
        note: 'Preview only (no orderId provided). Pass orderId to persist.',
      });
    }

    // Verify order exists (and is a PENDING/Cart-like order if you enforce that)
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.status(400).json({ error: 'orderId is invalid or not found' });
    }

    const item = await prisma.orderItem.create({
      data: {
        orderId: orderId,
        productId: product.id,
        variantId: resolvedVariantId,
        title: product.title,
        quantity: toNum(quantity, 1),
        unitPrice,
        lineTotal: unitPrice * toNum(quantity, 1),
        selectedOptions, // JSON of attribute/value ids
        status: 'PENDING',
      },
    });

    return res.json({ data: { ...item, unitPrice }, note: 'Server price authoritative' });
  } catch (err: any) {
    console.error('POST /api/cart/items failed:', err);
    return res.status(500).json({ error: 'Could not add item to cart' });
  }
});

export default router;
