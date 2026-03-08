// api/prisma/seedProduct.ts
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

/* ----------------------------------------------------------------------------
  Config
---------------------------------------------------------------------------- */

const EXTRA_PRODUCTS_TOTAL = 30;

// Variant mix for these extra products
const EXTRA_VARIANT_FRACTION = 0.45;

// Inventory
const MIN_AVAILABLE = 8;
const MAX_AVAILABLE = 35;

// Brands per base product title
const MIN_BRANDS_PER_BASE = 2;
const MAX_BRANDS_PER_BASE = 4;

const log = (...a: any[]) => console.log("[seedProduct]", ...a);

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const chance = (p: number) => Math.random() < p;

function pick<T>(arr: T[], n: number) {
  const copy = [...arr];
  copy.sort(() => Math.random() - 0.5);
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
}

function pics(seed: string | number): string[] {
  return [
    `https://picsum.photos/seed/dayspring-extra-${seed}/800/600`,
    `https://picsum.photos/seed/dayspring-extra-${seed}-b/800/600`,
  ];
}

function toDec(n: number) {
  return new Prisma.Decimal(Math.round(n * 100) / 100);
}

function toDec2(n: number) {
  return new Prisma.Decimal(Math.round(n * 100) / 100);
}

function uniqSlugBase(s: string) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function productKeyForSupplier(title: string, brandId: string) {
  return `${uniqSlugBase(title)}::${String(brandId)}`;
}

/**
 * Supplier-level uniqueness for seeded "base products":
 * one supplier should not get duplicate occurrences of the same (title + brandId)
 * - checks BOTH the current run (usedBySupplier) and the existing DB
 */
async function pickSupplierForItemDbSafe(
  suppliers: { id: string }[],
  usedBySupplier: Map<string, Set<string>>,
  title: string,
  brandId: string
) {
  const key = productKeyForSupplier(title, brandId);
  const shuffled = [...suppliers].sort(() => Math.random() - 0.5);

  for (const s of shuffled) {
    const set = usedBySupplier.get(s.id) ?? new Set<string>();
    if (set.has(key)) continue;

    const existsInDb = await prisma.product.findFirst({
      where: {
        isDeleted: false,
        supplierId: s.id,
        brandId,
        title,
      },
      select: { id: true },
    });

    if (!existsInDb) return s.id;
  }

  return suppliers[randInt(0, suppliers.length - 1)].id;
}

/* ----------------------------------------------------------------------------
  Lookup existing seeded records from DB
---------------------------------------------------------------------------- */

async function getSuperAdminId() {
  const admin = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true, email: true },
  });

  if (!admin) {
    throw new Error(
      "No SUPER_ADMIN user found. Run your main seed first so products can be owned/created by an admin."
    );
  }

  return admin.id;
}

async function getSuppliers() {
  const suppliers = await prisma.supplier.findMany({
    where: {
      status: "ACTIVE",
      shippingEnabled: true,
      shipsNationwide: true,
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (!suppliers.length) {
    throw new Error("No active shipping-ready suppliers found. Run seed.ts first.");
  }

  return suppliers;
}

async function getCategories() {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, parentId: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
  });

  if (!categories.length) {
    throw new Error("No active categories found. Run seedCategories.ts first.");
  }

  return categories;
}

async function getBrands() {
  const brands = await prisma.brand.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });

  if (!brands.length) {
    throw new Error("No active brands found. Run seed.ts first.");
  }

  return brands;
}

async function getAttributes() {
  const attrs = await prisma.attribute.findMany({
    where: {
      isActive: true,
      name: { in: ["Color", "Size", "Material", "Capacity", "Volume", "Finish"] },
    },
    select: {
      id: true,
      name: true,
      values: {
        where: { isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: [{ position: "asc" }, { name: "asc" }],
      },
    },
    orderBy: { name: "asc" },
  });

  if (!attrs.length) {
    throw new Error("No attributes found. Run seedCategories.ts first.");
  }

  return attrs.map((a) => ({
    attributeId: a.id,
    name: a.name,
    values: a.values,
  }));
}

/* ----------------------------------------------------------------------------
  Shipping parcel helpers
---------------------------------------------------------------------------- */

type ParcelSeed = {
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  isFragile: boolean;
  isBulky: boolean;
  shippingClass: "STANDARD" | "FRAGILE" | "BULKY";
};

function parcelForTitle(title: string): ParcelSeed {
  const t = title.toLowerCase();

  if (
    t.includes("pressure cooker") ||
    t.includes("microwave") ||
    t.includes("air fryer") ||
    t.includes("water dispenser")
  ) {
    return {
      weightGrams: randInt(3500, 9000),
      lengthCm: randInt(28, 48),
      widthCm: randInt(24, 42),
      heightCm: randInt(26, 46),
      isFragile: chance(0.55),
      isBulky: true,
      shippingClass: chance(0.55) ? "FRAGILE" : "BULKY",
    };
  }

  if (
    t.includes("blender") ||
    t.includes("toaster") ||
    t.includes("kettle") ||
    t.includes("flask")
  ) {
    return {
      weightGrams: randInt(1000, 3500),
      lengthCm: randInt(18, 34),
      widthCm: randInt(14, 28),
      heightCm: randInt(18, 34),
      isFragile: chance(0.5),
      isBulky: false,
      shippingClass: chance(0.5) ? "FRAGILE" : "STANDARD",
    };
  }

  if (
    t.includes("plates") ||
    t.includes("bowls") ||
    t.includes("mugs") ||
    t.includes("glass") ||
    t.includes("serving")
  ) {
    return {
      weightGrams: randInt(600, 2600),
      lengthCm: randInt(16, 36),
      widthCm: randInt(16, 36),
      heightCm: randInt(8, 26),
      isFragile: true,
      isBulky: false,
      shippingClass: "FRAGILE",
    };
  }

  if (
    t.includes("rack") ||
    t.includes("organizer") ||
    t.includes("bin") ||
    t.includes("basket") ||
    t.includes("cabinet")
  ) {
    return {
      weightGrams: randInt(1200, 7000),
      lengthCm: randInt(20, 60),
      widthCm: randInt(18, 45),
      heightCm: randInt(10, 50),
      isFragile: false,
      isBulky: true,
      shippingClass: "BULKY",
    };
  }

  return {
    weightGrams: randInt(250, 1800),
    lengthCm: randInt(10, 30),
    widthCm: randInt(8, 24),
    heightCm: randInt(4, 20),
    isFragile: false,
    isBulky: false,
    shippingClass: "STANDARD",
  };
}

function variantParcelOverride(base: ParcelSeed) {
  const w = Math.max(100, base.weightGrams + randInt(-120, 220));
  const l = Math.max(5, base.lengthCm + randInt(-2, 3));
  const wd = Math.max(5, base.widthCm + randInt(-2, 3));
  const h = Math.max(2, base.heightCm + randInt(-2, 3));

  return {
    weightGrams: w,
    lengthCm: toDec2(l),
    widthCm: toDec2(wd),
    heightCm: toDec2(h),
    isFragileOverride: base.isFragile || chance(0.05),
    isBulkyOverride: base.isBulky || chance(0.05),
    shippingClassOverride: (base.isBulky
      ? "BULKY"
      : base.isFragile
        ? "FRAGILE"
        : "STANDARD") as string,
  };
}

/* ----------------------------------------------------------------------------
  Product attribute setup
---------------------------------------------------------------------------- */

async function ensureProductAttributeSetup(
  productId: string,
  attrs: Awaited<ReturnType<typeof getAttributes>>
) {
  for (const a of attrs) {
    await prisma.productAttribute.upsert({
      where: {
        productId_attributeId: {
          productId,
          attributeId: a.attributeId,
        },
      },
      update: {},
      create: {
        productId,
        attributeId: a.attributeId,
      },
    });

    for (const v of a.values) {
      try {
        await prisma.productAttributeOption.create({
          data: {
            productId,
            attributeId: a.attributeId,
            valueId: v.id,
          },
        });
      } catch {
        // ignore duplicate compound unique
      }
    }
  }
}

/* ----------------------------------------------------------------------------
  Variants
---------------------------------------------------------------------------- */

async function createVariantsForProduct(args: {
  productId: string;
  skuBase: string;
  retail: number;
  attrs: Awaited<ReturnType<typeof getAttributes>>;
  productParcel: ParcelSeed;
}) {
  const { productId, skuBase, retail, attrs, productParcel } = args;

  const byName = new Map(attrs.map((a) => [a.name, a]));
  const color = byName.get("Color");
  const size = byName.get("Size");
  const material = byName.get("Material");

  const createdVariants: {
    id: string;
    sku: string | null;
    retailPrice: Prisma.Decimal | null;
  }[] = [];

  if (color && size) {
    await prisma.productAttribute.upsert({
      where: { productId_attributeId: { productId, attributeId: color.attributeId } },
      update: {},
      create: { productId, attributeId: color.attributeId },
    });

    await prisma.productAttribute.upsert({
      where: { productId_attributeId: { productId, attributeId: size.attributeId } },
      update: {},
      create: { productId, attributeId: size.attributeId },
    });

    const colors = color.values.slice(0, Math.min(4, color.values.length));
    const sizes = size.values.slice(0, Math.min(4, size.values.length));

    const combos: Array<{ c: string; s: string }> = [];
    for (const c of colors) {
      for (const s of sizes) {
        combos.push({ c: c.id, s: s.id });
      }
    }

    const chosen = pick(combos, randInt(3, Math.min(6, combos.length)));
    const seen = new Set<string>();

    let idx = 1;
    for (const combo of chosen) {
      const key = `${combo.c}:${combo.s}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const vSku = `${skuBase}-V${String(idx).padStart(2, "0")}`;
      idx++;

      const variantRetail = Math.max(900, retail + randInt(-150, 1400));
      const override = variantParcelOverride(productParcel);

      const variant = await prisma.productVariant.create({
        data: {
          productId,
          sku: vSku,
          retailPrice: toDec(variantRetail),
          weightGrams: override.weightGrams,
          lengthCm: override.lengthCm,
          widthCm: override.widthCm,
          heightCm: override.heightCm,
          isFragileOverride: override.isFragileOverride,
          isBulkyOverride: override.isBulkyOverride,
          shippingClassOverride: override.shippingClassOverride,
          inStock: true,
          imagesJson: pics(vSku),
          isActive: true,
          availableQty: 0,
          options: {
            create: [
              { attributeId: color.attributeId, valueId: combo.c },
              { attributeId: size.attributeId, valueId: combo.s },
            ],
          },
        },
        select: { id: true, sku: true, retailPrice: true },
      });

      createdVariants.push(variant);
    }

    return createdVariants;
  }

  if (material) {
    await prisma.productAttribute.upsert({
      where: { productId_attributeId: { productId, attributeId: material.attributeId } },
      update: {},
      create: { productId, attributeId: material.attributeId },
    });

    const mats = material.values.slice(0, Math.min(5, material.values.length));
    const chosen = pick(mats, randInt(2, Math.min(4, mats.length)));

    let idx = 1;
    for (const m of chosen) {
      const vSku = `${skuBase}-V${String(idx).padStart(2, "0")}`;
      idx++;

      const variantRetail = Math.max(900, retail + randInt(-100, 900));
      const override = variantParcelOverride(productParcel);

      const variant = await prisma.productVariant.create({
        data: {
          productId,
          sku: vSku,
          retailPrice: toDec(variantRetail),
          weightGrams: override.weightGrams,
          lengthCm: override.lengthCm,
          widthCm: override.widthCm,
          heightCm: override.heightCm,
          isFragileOverride: override.isFragileOverride,
          isBulkyOverride: override.isBulkyOverride,
          shippingClassOverride: override.shippingClassOverride,
          inStock: true,
          imagesJson: pics(vSku),
          isActive: true,
          availableQty: 0,
          options: {
            create: [{ attributeId: material.attributeId, valueId: m.id }],
          },
        },
        select: { id: true, sku: true, retailPrice: true },
      });

      createdVariants.push(variant);
    }
  }

  return createdVariants;
}

/* ----------------------------------------------------------------------------
  Offers
---------------------------------------------------------------------------- */

function supplierBaseFromRetail(retail: number): Prisma.Decimal {
  const pct = 0.5 + Math.random() * 0.25;
  const val = Math.max(300, Math.round(retail * pct));
  return new Prisma.Decimal(val);
}

function supplierUnitPriceFromVariantRetail(variantRetail: number): Prisma.Decimal {
  const pct = 0.5 + Math.random() * 0.28;
  const val = Math.max(300, Math.round(variantRetail * pct));
  return new Prisma.Decimal(val);
}

async function ensureBaseOfferForProduct(args: {
  productId: string;
  retail: number;
  supplierId: string;
}) {
  const { productId, retail, supplierId } = args;
  const availableQty = randInt(MIN_AVAILABLE, MAX_AVAILABLE);

  return prisma.supplierProductOffer.upsert({
    where: {
      supplier_product_offer_unique: {
        productId,
        supplierId,
      },
    },
    update: {
      basePrice: supplierBaseFromRetail(retail),
      availableQty,
      inStock: availableQty > 0,
      isActive: true,
      leadDays: randInt(1, 7),
      currency: "NGN",
    },
    create: {
      productId,
      supplierId,
      basePrice: supplierBaseFromRetail(retail),
      availableQty,
      inStock: availableQty > 0,
      isActive: true,
      leadDays: randInt(1, 7),
      currency: "NGN",
    },
    select: { id: true, availableQty: true, productId: true },
  });
}

async function ensureVariantOffersForVariants(args: {
  productId: string;
  variants: { id: string; retailPrice: Prisma.Decimal | null }[];
  baseOfferId: string;
  supplierId: string;
}) {
  const { productId, variants, baseOfferId, supplierId } = args;

  for (const v of variants) {
    if (!chance(0.72)) continue;

    const vr = Number(v.retailPrice ?? 0) || 0;
    if (vr <= 0) continue;

    const qty = randInt(MIN_AVAILABLE, MAX_AVAILABLE);

    await prisma.supplierVariantOffer.upsert({
      where: {
        supplier_variant_offer_unique: {
          variantId: v.id,
          supplierId,
        },
      },
      update: {
        productId,
        supplierProductOfferId: baseOfferId,
        unitPrice: supplierUnitPriceFromVariantRetail(vr),
        availableQty: qty,
        inStock: qty > 0,
        isActive: true,
        leadDays: randInt(1, 9),
        currency: "NGN",
      },
      create: {
        productId,
        variantId: v.id,
        supplierId,
        supplierProductOfferId: baseOfferId,
        unitPrice: supplierUnitPriceFromVariantRetail(vr),
        availableQty: qty,
        inStock: qty > 0,
        isActive: true,
        leadDays: randInt(1, 9),
        currency: "NGN",
      },
      select: { id: true },
    });
  }

  for (const v of variants) {
    const agg = await prisma.supplierVariantOffer.aggregate({
      _sum: { availableQty: true },
      where: {
        variantId: v.id,
        isActive: true,
        inStock: true,
      },
    });

    const sum = Number(agg._sum.availableQty || 0);

    await prisma.productVariant.update({
      where: { id: v.id },
      data: {
        availableQty: sum,
        inStock: sum > 0,
      },
    });
  }
}

async function recomputeProductAvailability(productId: string) {
  const baseAgg = await prisma.supplierProductOffer.aggregate({
    _sum: { availableQty: true },
    where: {
      productId,
      isActive: true,
      inStock: true,
    },
  });

  const varAgg = await prisma.supplierVariantOffer.aggregate({
    _sum: { availableQty: true },
    where: {
      productId,
      isActive: true,
      inStock: true,
    },
  });

  const baseQty = Number(baseAgg._sum.availableQty ?? 0);
  const variantQty = Number(varAgg._sum.availableQty ?? 0);
  const total = Math.max(0, Math.trunc(baseQty + variantQty));

  await prisma.product.update({
    where: { id: productId },
    data: { availableQty: total, inStock: total > 0 },
  });
}

/* ----------------------------------------------------------------------------
  Product generation
---------------------------------------------------------------------------- */

function extraTitlesPool() {
  return [
    "Pressure Cooker",
    "Baking Tray Set",
    "Cake Mould",
    "Spatula Set",
    "Serving Bowl Set",
    "Lunch Box",
    "Storage Container Set",
    "Dish Rack",
    "Spice Rack",
    "Drawer Organizer",
    "Air Fryer",
    "Microwave Oven",
    "Plate Set",
    "Water Bottle",
    "Vacuum Flask",
    "Trash Bin",
    "Bathroom Cleaner",
    "Floor Cleaner",
    "Scrubbing Sponge Pack",
    "Cleaning Cloth Set",
    "Laundry Basket",
    "Drying Rack",
    "Ironing Board",
    "Wardrobe Organizer",
    "Stackable Storage Bin",
    "LED Desk Lamp",
    "Extension Power Strip",
    "Flower Pot",
    "Garden Hose",
    "Tool Kit Box",
    "Fire Extinguisher",
    "Soap Dispenser",
    "Bath Towel",
    "Shower Curtain",
    "Toilet Brush",
  ];
}

async function nextExtraSeedIndex() {
  const rows = await prisma.product.findMany({
    where: { sku: { startsWith: "EXTRA-" } },
    select: { sku: true },
  });

  let max = 0;
  for (const row of rows) {
    const m = String(row.sku || "").match(/^EXTRA-(\d{3,})$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }

  return max + 1;
}

async function seedExtraProducts(args: {
  superAdminId: string;
  categories: { id: string; name: string; slug: string | null; parentId: string | null }[];
  brands: { id: string; name: string; slug: string }[];
  suppliers: { id: string; name: string | null }[];
  attrs: Awaited<ReturnType<typeof getAttributes>>;
}) {
  const { superAdminId, categories, brands, suppliers, attrs } = args;

  log(`Creating ${EXTRA_PRODUCTS_TOTAL} extra products...`);

  if (brands.length < 4) {
    throw new Error("Need at least 4 brands to create the extra mix.");
  }

  const titles = extraTitlesPool();
  const plan: Array<{ title: string; brandId: string; sku: string; retail: number }> = [];

  let createdPlanned = 0;
  let nextIndex = await nextExtraSeedIndex();

  for (const title of titles) {
    if (createdPlanned >= EXTRA_PRODUCTS_TOTAL) break;

    const nBrands = randInt(MIN_BRANDS_PER_BASE, MAX_BRANDS_PER_BASE);
    const chosenBrands = pick(brands, nBrands);

    for (const brand of chosenBrands) {
      if (createdPlanned >= EXTRA_PRODUCTS_TOTAL) break;

      const sku = `EXTRA-${String(nextIndex).padStart(3, "0")}`;
      const retail = randInt(4500, 45000);

      plan.push({ title, brandId: brand.id, sku, retail });

      createdPlanned++;
      nextIndex++;
    }
  }

  const usedBySupplier = new Map<string, Set<string>>();
  const rootCategories = categories.filter((c) => !c.parentId);
  const leafCategories = categories.filter(
    (c) => !categories.some((x) => x.parentId === c.id)
  );
  const categoryPool = leafCategories.length
    ? leafCategories
    : rootCategories.length
      ? rootCategories
      : categories;

  for (const item of plan) {
    const existingBySku = await prisma.product.findFirst({
      where: { sku: item.sku, isDeleted: false },
      select: { id: true },
    });

    if (existingBySku) {
      log(`Skipping existing SKU ${item.sku}`);
      continue;
    }

    const supplierId = await pickSupplierForItemDbSafe(
      suppliers,
      usedBySupplier,
      item.title,
      item.brandId
    );

    const key = productKeyForSupplier(item.title, item.brandId);
    const set = usedBySupplier.get(supplierId) ?? new Set<string>();
    set.add(key);
    usedBySupplier.set(supplierId, set);

    const existsTitleBrandSupplier = await prisma.product.findFirst({
      where: {
        isDeleted: false,
        supplierId,
        brandId: item.brandId,
        title: item.title,
      },
      select: { id: true },
    });

    if (existsTitleBrandSupplier) {
      log(`Skipping duplicate (title+brand+supplier exists): ${item.title}`);
      continue;
    }

    const category = categoryPool[randInt(0, categoryPool.length - 1)];
    const parcel = parcelForTitle(item.title);

    const product = await prisma.product.create({
      data: {
        title: item.title,
        description: "Additional seeded product for development and testing.",
        retailPrice: toDec(item.retail),
        sku: item.sku,
        status: "LIVE",
        imagesJson: pics(`${item.sku}-${item.brandId}`),
        isDeleted: false,
        availableQty: 0,
        inStock: true,

        shippingCost: toDec2(0),
        weightGrams: parcel.weightGrams,
        lengthCm: toDec2(parcel.lengthCm),
        widthCm: toDec2(parcel.widthCm),
        heightCm: toDec2(parcel.heightCm),
        isFragile: parcel.isFragile,
        isBulky: parcel.isBulky,
        shippingClass: parcel.shippingClass,
        freeShipping: false,

        supplierId,
        categoryId: category.id,
        brandId: item.brandId,

        ownerId: superAdminId,
        createdById: superAdminId,
        updatedById: superAdminId,
      },
      select: { id: true, sku: true, title: true },
    });

    await ensureProductAttributeSetup(product.id, attrs);

    const baseOffer = await ensureBaseOfferForProduct({
      productId: product.id,
      retail: item.retail,
      supplierId,
    });

    if (chance(EXTRA_VARIANT_FRACTION)) {
      const variants = await createVariantsForProduct({
        productId: product.id,
        skuBase: item.sku,
        retail: item.retail,
        attrs,
        productParcel: parcel,
      });

      if (variants.length) {
        await ensureVariantOffersForVariants({
          productId: product.id,
          variants,
          baseOfferId: baseOffer.id,
          supplierId,
        });
      }
    }

    await recomputeProductAvailability(product.id);
    log(`Created ${product.sku} • ${product.title}`);
  }

  log("Extra products seeded.");
}

/* ----------------------------------------------------------------------------
  Main
---------------------------------------------------------------------------- */

async function main() {
  const superAdminId = await getSuperAdminId();
  const suppliers = await getSuppliers();
  const categories = await getCategories();
  const brands = await getBrands();
  const attrs = await getAttributes();

  await seedExtraProducts({
    superAdminId,
    categories,
    brands,
    suppliers,
    attrs,
  });

  log("Done.");
}

main()
  .catch((e) => {
    console.error("[seedProduct] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });