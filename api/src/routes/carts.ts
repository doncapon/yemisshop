// api/src/routes/cart.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { CartStatus, Prisma } from "@prisma/client";

const router = Router();

type CartKind = "BASE" | "VARIANT";

type IncomingItem = {
  productId: string;
  variantId?: string | null;
  kind?: CartKind;
  qty?: number;
  selectedOptions?: any[]; // raw from client
  optionsKey?: string; // optional
  titleSnapshot?: string | null;
  imageSnapshot?: string | null;
  unitPriceCache?: number | null;
};

type SelectedOptionSnapshot = {
  attributeId: string;
  attribute: string;
  valueId?: string | null;
  value: string;
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function normKind(kind?: string, variantId?: string | null): CartKind {
  const k = String(kind || "").toUpperCase();
  if (k === "BASE" || k === "VARIANT") return k as CartKind;
  return variantId ? "VARIANT" : "BASE";
}

function asInt(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function clampQty(q: any) {
  return Math.max(1, asInt(q, 1));
}

/** Heuristic: detect IDs / codes like `cmm7f4...` so we don't treat them as labels */
function isCodeLike(raw: unknown): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return false;

  // If it has spaces, treat as a normal human label.
  if (/\s/.test(s)) return false;

  // Explicit DaySpring-style IDs like cmm7f4...
  if (/^cmm[0-9a-z]{5,}$/i.test(s)) return true;

  // UUID-ish tokens
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return true;
  }

  // Very long pure hex strings
  if (/^[0-9a-f]{16,}$/i.test(s)) return true;

  // Otherwise, assume it’s a human-readable name (e.g. Black-M, Blue_L)
  return false;
}

/**
 * Normalise a raw `selectedOptions` array into a clean snapshot:
 *  - Ensures attributeId / valueId are strings
 *  - Fills in attribute/value names from DB when missing or code-like
 *  - For variant lines, derives directly from ProductVariantOption relations
 */
async function computeSelectedOptionsSnapshot(args: {
  productId: string;
  variantId?: string | null;
  selectedOptions?: any;
}): Promise<SelectedOptionSnapshot[] | null> {
  const productId = String(args.productId);
  const variantId = args.variantId == null ? null : String(args.variantId);

  // 1) Variant line → derive from variant options (source of truth)
  if (variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: {
        options: {
          include: {
            attribute: true,
            value: true,
          },
        },
      },
    });

    if (!variant) return null;

    const out: SelectedOptionSnapshot[] = variant.options.map((opt) => ({
      attributeId: opt.attributeId,
      attribute: opt.attribute?.name ?? "",
      valueId: opt.valueId,
      value: opt.value?.name ?? "",
    }));

    return out.length ? out : null;
  }

  // 2) Base line with manual selectedOptions
  const rawArr = Array.isArray(args.selectedOptions)
    ? args.selectedOptions
    : args.selectedOptions
    ? [args.selectedOptions]
    : [];

  if (!rawArr.length) return null;

  // Detect if everything already has good labels (no DB hit required)
  const alreadyHumanReadable = rawArr.every((o: any) => {
    const attrName = String(o?.attribute ?? "").trim();
    const valName = String(o?.value ?? "").trim();
    if (!attrName && !valName) return false;
    return !isCodeLike(attrName) && !isCodeLike(valName);
  });

  if (alreadyHumanReadable) {
    const mapped: SelectedOptionSnapshot[] = rawArr
      .map((o: any) => {
        const attributeId = String(o?.attributeId ?? "");
        const valueId = o?.valueId != null ? String(o.valueId) : undefined;
        const attribute = String(o?.attribute ?? "").trim();
        const value = String(o?.value ?? "").trim();

        if (!attributeId && !valueId && !attribute && !value) return null;

        return {
          attributeId,
          attribute,
          valueId,
          value,
        };
      })
      .filter(Boolean) as SelectedOptionSnapshot[];

    return mapped.length ? mapped : null;
  }

  // We need to look up names by IDs
  const attrIds = new Set<string>();
  const valIds = new Set<string>();

  for (const o of rawArr) {
    const aId = o?.attributeId ? String(o.attributeId) : "";
    const vId = o?.valueId ? String(o.valueId) : "";

    if (aId) attrIds.add(aId);
    if (vId) valIds.add(vId);
  }

  const [attributes, values] = await Promise.all([
    attrIds.size
      ? prisma.attribute.findMany({
          where: { id: { in: Array.from(attrIds) } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    valIds.size
      ? prisma.attributeValue.findMany({
          where: { id: { in: Array.from(valIds) } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const attrMap = new Map(attributes.map((a) => [a.id, a.name]));
  const valMap = new Map(values.map((v) => [v.id, v.name]));

  const normalized: SelectedOptionSnapshot[] = rawArr
    .map((o: any) => {
      const attributeId = o?.attributeId ? String(o.attributeId) : "";
      const valueId = o?.valueId != null ? String(o.valueId) : undefined;

      const existingAttr = String(o?.attribute ?? "").trim();
      const existingVal = String(o?.value ?? "").trim();

      const attribute =
        (!existingAttr || isCodeLike(existingAttr)) && attributeId
          ? attrMap.get(attributeId) || existingAttr
          : existingAttr;

      const value =
        (!existingVal || isCodeLike(existingVal)) && valueId
          ? valMap.get(valueId) || existingVal
          : existingVal;

      if (!attributeId && !valueId && !attribute && !value) return null;

      return {
        attributeId,
        attribute,
        valueId,
        value,
      };
    })
    .filter(Boolean) as SelectedOptionSnapshot[];

  return normalized.length ? normalized : null;
}

async function getOrCreateActiveCart(userId: string) {
  let cart = await prisma.cart.findFirst({
    where: { userId, status: CartStatus.ACTIVE },
    select: { id: true },
  });

  if (!cart) {
    cart = await prisma.cart.create({
      data: { userId, status: CartStatus.ACTIVE },
      select: { id: true },
    });
  }

  return cart;
}

/**
 * ✅ Matches schema:
 * - BASE: @@unique([cartId, productId, kind, optionsKey], name: "cart_line_base_unique")
 * - VARIANT: @@unique([cartId, productId, variantId, kind, optionsKey], name: "cart_line_variant_unique")
 */
function lineUniqWhere(cartId: string, it: IncomingItem): Prisma.CartItemWhereUniqueInput {
  const productId = String(it.productId);
  const variantId = it.variantId == null ? null : String(it.variantId);
  const kind = normKind(it.kind, variantId);
  const optionsKey = String(it.optionsKey || "");

  if (kind === "VARIANT") {
    if (!variantId) throw new Error("variantId is required when kind=VARIANT");

    const compound: Prisma.CartItemCart_line_variant_uniqueCompoundUniqueInput = {
      cartId,
      productId,
      variantId, // ✅ non-null for this unique
      kind, // String in schema
      optionsKey,
    };

    return { cart_line_variant_unique: compound };
  }

  const compound: Prisma.CartItemCart_line_base_uniqueCompoundUniqueInput = {
    cartId,
    productId,
    kind,
    optionsKey,
  };

  return { cart_line_base_unique: compound };
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/cart
 * returns active cart items for current user
 */
router.get("/", requireAuth, async (req, res) => {
  const userId = String((req as any).user.id);

  const cart = await prisma.cart.findFirst({
    where: { userId, status: CartStatus.ACTIVE },
    select: {
      id: true,
      items: {
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          productId: true,
          variantId: true,
          kind: true,
          qty: true,
          selectedOptions: true,
          optionsKey: true,
          titleSnapshot: true,
          imageSnapshot: true,
          unitPriceCache: true,
          updatedAt: true,
        },
      },
    },
  });

  let items = cart?.items ?? [];

  // Enrich selectedOptions for older/stale items so UI sees human-readable labels
  const enrichedItems = await Promise.all(
    items.map(async (it) => {
      const snapshot = await computeSelectedOptionsSnapshot({
        productId: it.productId,
        variantId: it.variantId,
        selectedOptions: it.selectedOptions as any,
      });

      return {
        ...it,
        selectedOptions: snapshot ?? it.selectedOptions,
      };
    })
  );

  return res.json({ cartId: cart?.id ?? null, items: enrichedItems });
});

/**
 * GET /api/cart/summary
 * (used by useCartCount.ts)
 */
router.get("/summary", requireAuth, async (req, res) => {
  const userId = String((req as any).user.id);

  const cart = await prisma.cart.findFirst({
    where: { userId, status: CartStatus.ACTIVE },
    select: { id: true },
  });

  if (!cart) return res.json({ cartId: null, totalQty: 0, distinct: 0 });

  const agg = await prisma.cartItem.aggregate({
    where: { cartId: cart.id },
    _sum: { qty: true },
    _count: { id: true },
  });

  return res.json({
    cartId: cart.id,
    totalQty: Number(agg._sum.qty || 0),
    distinct: Number(agg._count.id || 0),
  });
});

/**
 * GET /api/cart/count
 */
router.get("/count", requireAuth, async (req, res) => {
  const userId = String((req as any).user.id);

  const cart = await prisma.cart.findFirst({
    where: { userId, status: CartStatus.ACTIVE },
    select: { id: true },
  });

  if (!cart) return res.json({ totalQty: 0, distinct: 0 });

  const agg = await prisma.cartItem.aggregate({
    where: { cartId: cart.id },
    _sum: { qty: true },
    _count: { id: true },
  });

  return res.json({
    totalQty: Number(agg._sum.qty || 0),
    distinct: Number(agg._count.id || 0),
  });
});

/**
 * POST /api/cart/items
 * add +1 (or qty) to a line in ACTIVE cart
 */
router.post("/items", requireAuth, async (req, res) => {
  try {
    const userId = String((req as any).user.id);
    const body = (req.body || {}) as IncomingItem;

    if (!body.productId) return res.status(400).json({ error: "productId required" });

    const cart = await getOrCreateActiveCart(userId);

    const variantId = body.variantId == null ? null : String(body.variantId);
    const kind = normKind(body.kind, variantId);
    const qtyAdd = clampQty(body.qty ?? 1);

    // 🔍 Build a nice human-readable selectedOptions snapshot
    const selectedOptionsSnapshot =
      (await computeSelectedOptionsSnapshot({
        productId: body.productId,
        variantId,
        selectedOptions: body.selectedOptions,
      })) ?? [];

    const where = lineUniqWhere(cart.id, { ...body, variantId, kind });

    const existing = await prisma.cartItem.findUnique({
      where,
      select: { id: true, qty: true },
    });

    const nextQty = (existing?.qty ?? 0) + qtyAdd;

    const item = await prisma.cartItem.upsert({
      where,
      create: {
        cartId: cart.id,
        productId: String(body.productId),
        variantId,
        kind,
        qty: nextQty,
        selectedOptions: selectedOptionsSnapshot,
        optionsKey: String(body.optionsKey || ""),
        titleSnapshot: body.titleSnapshot ?? null,
        imageSnapshot: body.imageSnapshot ?? null,
        unitPriceCache: body.unitPriceCache != null ? body.unitPriceCache : null,
      },
      update: {
        qty: nextQty,
        selectedOptions: selectedOptionsSnapshot.length ? selectedOptionsSnapshot : undefined,
        titleSnapshot: body.titleSnapshot ?? undefined,
        imageSnapshot: body.imageSnapshot ?? undefined,
        unitPriceCache: body.unitPriceCache != null ? body.unitPriceCache : undefined,
      },
      select: { id: true, qty: true },
    });

    return res.json({ ok: true, item });
  } catch (e: any) {
    console.error("POST /api/cart/items failed:", e?.message || e);
    return res.status(400).json({ error: e?.message || "Bad request" });
  }
});

/**
 * PATCH /api/cart/items/:id  { qty }
 */
router.patch("/items/:id", requireAuth, async (req, res) => {
  const userId = String((req as any).user.id);
  const id = String(req.params.id || "");
  const qty = clampQty(req.body?.qty);

  const cart = await prisma.cart.findFirst({
    where: { userId, status: CartStatus.ACTIVE },
    select: { id: true },
  });
  if (!cart) return res.status(404).json({ error: "No active cart" });

  const item = await prisma.cartItem.findFirst({
    where: { id, cartId: cart.id },
    select: { id: true },
  });
  if (!item) return res.status(404).json({ error: "Item not found" });

  const updated = await prisma.cartItem.update({
    where: { id },
    data: { qty },
    select: { id: true, qty: true },
  });

  return res.json({ ok: true, item: updated });
});

/**
 * DELETE /api/cart/items/:id
 */
router.delete("/items/:id", requireAuth, async (req, res) => {
  const userId = String((req as any).user.id);
  const id = String(req.params.id || "");

  const cart = await prisma.cart.findFirst({
    where: { userId, status: CartStatus.ACTIVE },
    select: { id: true },
  });
  if (!cart) return res.json({ ok: true });

  const item = await prisma.cartItem.findFirst({
    where: { id, cartId: cart.id },
    select: { id: true },
  });
  if (!item) return res.json({ ok: true });

  await prisma.cartItem.delete({ where: { id } });
  return res.json({ ok: true });
});

/**
 * POST /api/cart/merge  { items: IncomingItem[] }
 * merges guest items into ACTIVE cart (sum qty)
 */
router.post("/merge", requireAuth, async (req, res) => {
  try {
    const userId = String((req as any).user.id);
    const items: IncomingItem[] = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!items.length) return res.json({ ok: true, merged: 0 });

    const cart = await getOrCreateActiveCart(userId);

    let merged = 0;

    for (const raw of items) {
      if (!raw?.productId) continue;

      const variantId = raw.variantId == null ? null : String(raw.variantId);
      const kind = normKind(raw.kind, variantId);
      const qtyAdd = clampQty(raw.qty ?? 1);

      // 🔍 Enrich selectedOptions for merged guest lines too
      const selectedOptionsSnapshot =
        (await computeSelectedOptionsSnapshot({
          productId: raw.productId,
          variantId,
          selectedOptions: raw.selectedOptions,
        })) ?? [];

      const where = lineUniqWhere(cart.id, { ...raw, variantId, kind });

      const existing = await prisma.cartItem.findUnique({
        where,
        select: { qty: true },
      });

      const nextQty = (existing?.qty ?? 0) + qtyAdd;

      await prisma.cartItem.upsert({
        where,
        create: {
          cartId: cart.id,
          productId: String(raw.productId),
          variantId,
          kind,
          qty: nextQty,
          selectedOptions: selectedOptionsSnapshot,
          optionsKey: String(raw.optionsKey || ""),
          titleSnapshot: raw.titleSnapshot ?? null,
          imageSnapshot: raw.imageSnapshot ?? null,
          unitPriceCache: raw.unitPriceCache != null ? raw.unitPriceCache : null,
        },
        update: {
          qty: nextQty,
          selectedOptions: selectedOptionsSnapshot.length ? selectedOptionsSnapshot : undefined,
          titleSnapshot: raw.titleSnapshot ?? undefined,
          imageSnapshot: raw.imageSnapshot ?? undefined,
          unitPriceCache: raw.unitPriceCache != null ? raw.unitPriceCache : undefined,
        },
      });

      merged += 1;
    }

    return res.json({ ok: true, merged });
  } catch (e: any) {
    console.error("POST /api/cart/merge failed:", e?.message || e);
    return res.status(400).json({ error: e?.message || "Bad request" });
  }
});

export default router;