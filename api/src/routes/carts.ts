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
  optionsKey?: string;
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

type CartItemRowLite = {
  id: string;
  cartId: string;
  productId: string;
  variantId: string | null;
  kind: string;
  qty: number;
  selectedOptions: Prisma.JsonValue | null;
  optionsKey: string;
  titleSnapshot: string | null;
  imageSnapshot: string | null;
  unitPriceCache: Prisma.Decimal | number | null;
  updatedAt: Date;
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

function isCodeLike(raw: unknown): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  if (/\s/.test(s)) return false;
  if (/^cmm[0-9a-z]{5,}$/i.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  if (/^[0-9a-f]{16,}$/i.test(s)) return true;
  return false;
}

function normalizeSelectedOptionsSnapshot(raw: any): SelectedOptionSnapshot[] {
  const arr = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((o: any) => ({
      attributeId: String(o?.attributeId ?? "").trim(),
      attribute: String(o?.attribute ?? "").trim(),
      valueId: o?.valueId != null ? String(o.valueId).trim() : null,
      value: String(o?.value ?? "").trim(),
    }))
    .filter(
      (o) => o.attributeId || o.attribute || o.valueId || o.value
    );

  arr.sort((a, b) => {
    const aKey = `${a.attributeId}:${a.valueId ?? a.value}`;
    const bKey = `${b.attributeId}:${b.valueId ?? b.value}`;
    return aKey.localeCompare(bKey);
  });

  return arr;
}

function buildCanonicalOptionsKey(selectedOptions?: SelectedOptionSnapshot[] | null): string {
  const arr = normalizeSelectedOptionsSnapshot(selectedOptions);
  if (!arr.length) return "";

  return arr
    .map((o) => `${o.attributeId}=${o.valueId ?? o.value}`)
    .join("|");
}

function logicalCartLineKey(args: {
  productId: string;
  variantId?: string | null;
  kind?: string | null;
  optionsKey?: string | null;
}) {
  const productId = String(args.productId);
  const variantId = args.variantId == null ? null : String(args.variantId);
  const kind = normKind(args.kind ?? undefined, variantId);
  const optionsKey = String(args.optionsKey ?? "");

  if (kind === "VARIANT") {
    return `${productId}::${variantId ?? ""}::VARIANT::${optionsKey}`;
  }

  return `${productId}::::BASE::${optionsKey}`;
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
  const variantId = args.variantId == null ? null : String(args.variantId);

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

    return out.length ? normalizeSelectedOptionsSnapshot(out) : null;
  }

  const rawArr = Array.isArray(args.selectedOptions)
    ? args.selectedOptions
    : args.selectedOptions
      ? [args.selectedOptions]
      : [];

  if (!rawArr.length) return null;

  const alreadyHumanReadable = rawArr.every((o: any) => {
    const attrName = String(o?.attribute ?? "").trim();
    const valName = String(o?.value ?? "").trim();
    if (!attrName && !valName) return false;
    return !isCodeLike(attrName) && !isCodeLike(valName);
  });

  if (alreadyHumanReadable) {
    const mapped: SelectedOptionSnapshot[] = rawArr
      .map((o: any) => {
        const attributeId = String(o?.attributeId ?? "").trim();
        const valueId = o?.valueId != null ? String(o.valueId).trim() : null;
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

    return mapped.length ? normalizeSelectedOptionsSnapshot(mapped) : null;
  }

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
      const attributeId = o?.attributeId ? String(o.attributeId).trim() : "";
      const valueId = o?.valueId != null ? String(o.valueId).trim() : null;

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

  return normalized.length ? normalizeSelectedOptionsSnapshot(normalized) : null;
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

function lineUniqWhere(cartId: string, it: {
  productId: string;
  variantId?: string | null;
  kind?: CartKind;
  optionsKey?: string;
}): Prisma.CartItemWhereUniqueInput {
  const productId = String(it.productId);
  const variantId = it.variantId == null ? null : String(it.variantId);
  const kind = normKind(it.kind, variantId);
  const optionsKey = String(it.optionsKey || "");

  if (kind === "VARIANT") {
    if (!variantId) throw new Error("variantId is required when kind=VARIANT");

    const compound: Prisma.CartItemCart_line_variant_uniqueCompoundUniqueInput = {
      cartId,
      productId,
      variantId,
      kind,
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

async function cleanupDuplicateCartItems(cartId: string) {
  const items = await prisma.cartItem.findMany({
    where: { cartId },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      cartId: true,
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
  });

  if (items.length < 2) return;

  const groups = new Map<string, CartItemRowLite[]>();

  for (const item of items) {
    const selectedOptions = normalizeSelectedOptionsSnapshot(item.selectedOptions);
    const canonicalOptionsKey = buildCanonicalOptionsKey(selectedOptions);
    const key = logicalCartLineKey({
      productId: item.productId,
      variantId: item.variantId,
      kind: item.kind,
      optionsKey: canonicalOptionsKey,
    });

    const arr = groups.get(key) ?? [];
    arr.push({
      ...item,
      optionsKey: canonicalOptionsKey,
      selectedOptions,
    });
    groups.set(key, arr);
  }

  const txs: Prisma.PrismaPromise<any>[] = [];

  for (const [, rows] of groups) {
    if (rows.length <= 1) {
      const only = rows[0];
      if (!only) continue;

      const normalizedSelected = normalizeSelectedOptionsSnapshot(only.selectedOptions);
      const normalizedOptionsKey = buildCanonicalOptionsKey(normalizedSelected);

      const needsUpdate =
        String(only.optionsKey ?? "") !== normalizedOptionsKey ||
        JSON.stringify(only.selectedOptions ?? null) !== JSON.stringify(normalizedSelected);

      if (needsUpdate) {
        txs.push(
          prisma.cartItem.update({
            where: { id: only.id },
            data: {
              optionsKey: normalizedOptionsKey,
              selectedOptions: normalizedSelected,
            },
          })
        );
      }
      continue;
    }

    const [keeper, ...duplicates] = rows;

    const maxQty = Math.max(...rows.map((r) => Math.max(1, Number(r.qty) || 1)));
    const bestTitle = rows.find((r) => r.titleSnapshot)?.titleSnapshot ?? null;
    const bestImage = rows.find((r) => r.imageSnapshot)?.imageSnapshot ?? null;
    const bestUnitPrice = rows.find((r) => r.unitPriceCache != null)?.unitPriceCache ?? null;
    const bestSelected =
      normalizeSelectedOptionsSnapshot(
        rows.find((r) => normalizeSelectedOptionsSnapshot(r.selectedOptions).length)?.selectedOptions ?? []
      ) ?? [];

    const canonicalOptionsKey = buildCanonicalOptionsKey(bestSelected);

    txs.push(
      prisma.cartItem.update({
        where: { id: keeper.id },
        data: {
          qty: maxQty,
          selectedOptions: bestSelected,
          optionsKey: canonicalOptionsKey,
          titleSnapshot: bestTitle,
          imageSnapshot: bestImage,
          unitPriceCache: bestUnitPrice as any,
        },
      })
    );

    for (const dup of duplicates) {
      txs.push(
        prisma.cartItem.delete({
          where: { id: dup.id },
        })
      );
    }
  }

  if (txs.length) {
    await prisma.$transaction(txs);
  }
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/cart
 */
router.get("/", requireAuth, async (req, res) => {
  const userId = String((req as any).user.id);

  const cart = await prisma.cart.findFirst({
    where: { userId, status: CartStatus.ACTIVE },
    select: { id: true },
  });

  if (!cart) {
    return res.json({ cartId: null, items: [] });
  }

  await cleanupDuplicateCartItems(cart.id);

  const freshCart = await prisma.cart.findUnique({
    where: { id: cart.id },
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

  const enrichedItems = await Promise.all(
    (freshCart?.items ?? []).map(async (it) => {
      const snapshot = await computeSelectedOptionsSnapshot({
        productId: it.productId,
        variantId: it.variantId,
        selectedOptions: it.selectedOptions as any,
      });

      return {
        ...it,
        selectedOptions: snapshot ?? it.selectedOptions,
        optionsKey: buildCanonicalOptionsKey(snapshot ?? (it.selectedOptions as any)),
      };
    })
  );

  return res.json({ cartId: freshCart?.id ?? null, items: enrichedItems });
});

/**
 * GET /api/cart/summary
 */
router.get("/summary", requireAuth, async (req, res) => {
  const userId = String((req as any).user.id);

  const cart = await prisma.cart.findFirst({
    where: { userId, status: CartStatus.ACTIVE },
    select: { id: true },
  });

  if (!cart) return res.json({ cartId: null, totalQty: 0, distinct: 0 });

  await cleanupDuplicateCartItems(cart.id);

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

  await cleanupDuplicateCartItems(cart.id);

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
 * Additive on purpose for explicit add-to-cart actions.
 */
router.post("/items", requireAuth, async (req, res) => {
  try {
    const userId = String((req as any).user.id);
    const body = (req.body || {}) as IncomingItem;

    if (!body.productId) return res.status(400).json({ error: "productId required" });

    const cart = await getOrCreateActiveCart(userId);
    await cleanupDuplicateCartItems(cart.id);

    const variantId = body.variantId == null ? null : String(body.variantId);
    const kind = normKind(body.kind, variantId);
    const qtyAdd = clampQty(body.qty ?? 1);

    const selectedOptionsSnapshot =
      (await computeSelectedOptionsSnapshot({
        productId: body.productId,
        variantId,
        selectedOptions: body.selectedOptions,
      })) ?? [];

    const canonicalOptionsKey = buildCanonicalOptionsKey(selectedOptionsSnapshot);

    const where = lineUniqWhere(cart.id, {
      productId: String(body.productId),
      variantId,
      kind,
      optionsKey: canonicalOptionsKey,
    });

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
        optionsKey: canonicalOptionsKey,
        titleSnapshot: body.titleSnapshot ?? null,
        imageSnapshot: body.imageSnapshot ?? null,
        unitPriceCache: body.unitPriceCache != null ? body.unitPriceCache : null,
      },
      update: {
        qty: nextQty,
        selectedOptions: selectedOptionsSnapshot,
        optionsKey: canonicalOptionsKey,
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
 * PATCH /api/cart/items/:id
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

  await cleanupDuplicateCartItems(cart.id);

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

  await cleanupDuplicateCartItems(cart.id);

  const item = await prisma.cartItem.findFirst({
    where: { id, cartId: cart.id },
    select: { id: true },
  });
  if (!item) return res.json({ ok: true });

  await prisma.cartItem.delete({ where: { id } });
  return res.json({ ok: true });
});

/**
 * POST /api/cart/merge
 * Idempotent merge:
 * - does NOT keep adding the same guest cart on every retry/refresh
 * - uses max(existing.qty, guest.qty)
 */
router.post("/merge", requireAuth, async (req, res) => {
  try {
    const userId = String((req as any).user.id);
    const items: IncomingItem[] = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!items.length) return res.json({ ok: true, merged: 0 });

    const cart = await getOrCreateActiveCart(userId);
    await cleanupDuplicateCartItems(cart.id);

    let merged = 0;

    for (const raw of items) {
      if (!raw?.productId) continue;

      const variantId = raw.variantId == null ? null : String(raw.variantId);
      const kind = normKind(raw.kind, variantId);
      const incomingQty = clampQty(raw.qty ?? 1);

      const selectedOptionsSnapshot =
        (await computeSelectedOptionsSnapshot({
          productId: raw.productId,
          variantId,
          selectedOptions: raw.selectedOptions,
        })) ?? [];

      const canonicalOptionsKey = buildCanonicalOptionsKey(selectedOptionsSnapshot);

      const where = lineUniqWhere(cart.id, {
        productId: String(raw.productId),
        variantId,
        kind,
        optionsKey: canonicalOptionsKey,
      });

      const existing = await prisma.cartItem.findUnique({
        where,
        select: { qty: true },
      });

      const nextQty = Math.max(existing?.qty ?? 0, incomingQty);

      await prisma.cartItem.upsert({
        where,
        create: {
          cartId: cart.id,
          productId: String(raw.productId),
          variantId,
          kind,
          qty: nextQty,
          selectedOptions: selectedOptionsSnapshot,
          optionsKey: canonicalOptionsKey,
          titleSnapshot: raw.titleSnapshot ?? null,
          imageSnapshot: raw.imageSnapshot ?? null,
          unitPriceCache: raw.unitPriceCache != null ? raw.unitPriceCache : null,
        },
        update: {
          qty: nextQty,
          selectedOptions: selectedOptionsSnapshot,
          optionsKey: canonicalOptionsKey,
          titleSnapshot: raw.titleSnapshot ?? undefined,
          imageSnapshot: raw.imageSnapshot ?? undefined,
          unitPriceCache: raw.unitPriceCache != null ? raw.unitPriceCache : undefined,
        },
      });

      merged += 1;
    }

    await cleanupDuplicateCartItems(cart.id);

    return res.json({ ok: true, merged });
  } catch (e: any) {
    console.error("POST /api/cart/merge failed:", e?.message || e);
    return res.status(400).json({ error: e?.message || "Bad request" });
  }
});

export default router;