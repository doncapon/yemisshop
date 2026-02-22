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
  selectedOptions?: any[];
  optionsKey?: string; // optional
  titleSnapshot?: string | null;
  imageSnapshot?: string | null;
  unitPriceCache?: number | null;
};

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
      kind,      // String in schema
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

  return res.json({ cartId: cart?.id ?? null, items: cart?.items ?? [] });
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
        selectedOptions: body.selectedOptions ?? [],
        optionsKey: String(body.optionsKey || ""),
        titleSnapshot: body.titleSnapshot ?? null,
        imageSnapshot: body.imageSnapshot ?? null,
        unitPriceCache: body.unitPriceCache != null ? body.unitPriceCache : null,
      },
      update: {
        qty: nextQty,
        selectedOptions: body.selectedOptions ?? undefined,
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
          selectedOptions: raw.selectedOptions ?? [],
          optionsKey: String(raw.optionsKey || ""),
          titleSnapshot: raw.titleSnapshot ?? null,
          imageSnapshot: raw.imageSnapshot ?? null,
          unitPriceCache: raw.unitPriceCache != null ? raw.unitPriceCache : null,
        },
        update: {
          qty: nextQty,
          selectedOptions: raw.selectedOptions ?? undefined,
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