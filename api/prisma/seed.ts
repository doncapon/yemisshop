// prisma/seed.ts
import bcrypt from "bcryptjs";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

/* ----------------------------------------------------------------------------
  Config (env)
---------------------------------------------------------------------------- */
const SUPER_EMAIL = process.env.SUPERADMIN_EMAIL || "superadmin@example.com";
const SUPER_PASS = process.env.SUPERADMIN_PASSWORD || "SuperAdmin123!";
const SUPER_FIRST = process.env.SUPERADMIN_FIRSTNAME || "Super";
const SUPER_LAST = process.env.SUPERADMIN_LASTNAME || "Admin";

const SUPPLIER_EMAIL = process.env.SEED_SUPPLIER_EMAIL || "supplier@example.com";
const SUPPLIER_PASS = process.env.SEED_SUPPLIER_PASSWORD || "Supplier123!";
const SUPPLIER_FIRST = process.env.SEED_SUPPLIER_FIRSTNAME || "Seed";
const SUPPLIER_LAST = process.env.SEED_SUPPLIER_LASTNAME || "Supplier";

const PRODUCT_COUNT = 5;
const BASE_ONLY_COUNT = 3; // 3 base-only, 2 variant

// offers
const MIN_OFFERS_PER_PRODUCT = 3;
const MAX_OFFERS_PER_PRODUCT = 5;

const MIN_AVAILABLE = 10;
const MAX_AVAILABLE = 40;

const log = (...a: any[]) => console.log("[seed]", ...a);
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

function pics(seed: string | number) {
  return [
    `https://picsum.photos/seed/dayspring-${seed}/800/600`,
    `https://picsum.photos/seed/dayspring-${seed}-b/800/600`,
  ];
}

function toDec(n: number) {
  return new Prisma.Decimal(Math.round(n * 100) / 100);
}

function pick<T>(arr: T[], n: number) {
  const copy = [...arr];
  copy.sort(() => Math.random() - 0.5);
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
}

/* ----------------------------------------------------------------------------
  Core bootstrap
---------------------------------------------------------------------------- */
async function ensureCoreSettings() {
  try {
    await prisma.setting.createMany({
      data: [
        { key: "taxMode", value: "INCLUDED", isPublic: true },
        { key: "taxRatePct", value: "7.5", isPublic: true },
        { key: "commsUnitCostNGN", value: "100", isPublic: false },
        { key: "profitMode", value: "accurate", isPublic: false },
        { key: "serviceFeeBaseNGN", value: "1000", isPublic: false },
        { key: "platformBaseFeeNGN", value: "100", isPublic: false },
      ],
      skipDuplicates: true,
    });
    log("Core settings ensured.");
  } catch {
    log("Skipping settings (table may not exist yet).");
  }
}

async function ensureSuperAdmin() {
  log("Ensuring Super Admin exists…");

  const existing = await prisma.user.findUnique({
    where: { email: SUPER_EMAIL },
    select: { id: true, role: true },
  });

  if (existing) {
    if (existing.role !== "SUPER_ADMIN") {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          role: "SUPER_ADMIN",
          status: "VERIFIED",
          emailVerifiedAt: new Date(),
        },
      });
      log(`Upgraded existing user to SUPER_ADMIN: ${SUPER_EMAIL}`);
    } else {
      log(`Super Admin already present: ${SUPER_EMAIL}`);
    }
    return existing.id;
  }

  const passwordHash = await bcrypt.hash(SUPER_PASS, 10);

  const address = await prisma.address.create({
    data: {
      houseNumber: "1",
      streetName: "Leadership Ave",
      city: "Abuja",
      state: "FCT",
      postCode: "",
      town: "",
      country: "Nigeria",
    },
  });

  const user = await prisma.user.create({
    data: {
      email: SUPER_EMAIL,
      password: passwordHash,
      role: "SUPER_ADMIN",
      firstName: SUPER_FIRST,
      lastName: SUPER_LAST,
      phone: "+2348100000001",
      status: "VERIFIED",
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      joinedAt: new Date(),
      address: { connect: { id: address.id } },
      shippingAddress: { connect: { id: address.id } },
    },
    select: { id: true },
  });

  log(`Created Super Admin: ${SUPER_EMAIL}`);
  return user.id;
}

/* ----------------------------------------------------------------------------
  Supplier user + suppliers
---------------------------------------------------------------------------- */
async function ensureSupplierUserAndMainSupplier() {
  log("Ensuring Supplier user + Supplier exists…");

  const existingUser = await prisma.user.findUnique({
    where: { email: SUPPLIER_EMAIL },
    select: { id: true },
  });

  let userId: string;

  if (!existingUser) {
    const passwordHash = await bcrypt.hash(SUPPLIER_PASS, 10);
    const address = await prisma.address.create({
      data: {
        houseNumber: "12",
        streetName: "Supplier Road",
        city: "Lagos",
        state: "Lagos",
        country: "Nigeria",
      },
    });

    const created = await prisma.user.create({
      data: {
        email: SUPPLIER_EMAIL,
        password: passwordHash,
        role: "SUPPLIER",
        firstName: SUPPLIER_FIRST,
        lastName: SUPPLIER_LAST,
        phone: "+2348100000002",
        status: "VERIFIED",
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
        joinedAt: new Date(),
        address: { connect: { id: address.id } },
        shippingAddress: { connect: { id: address.id } },
      },
      select: { id: true },
    });

    userId = created.id;
    log(`Created Supplier user: ${SUPPLIER_EMAIL}`);
  } else {
    userId = existingUser.id;
    log(`Supplier user already present: ${SUPPLIER_EMAIL}`);
  }

  // Ensure Supplier row linked to this user (Supplier.userId is unique)
  const supplierName = "Seed Main Supplier";
  const mainSupplier = await prisma.supplier.upsert({
    where: { name: supplierName },
    update: {
      userId,
      type: "ONLINE",
      status: "ACTIVE",
      contactEmail: SUPPLIER_EMAIL,
      whatsappPhone: "+2348100000002",
    },
    create: {
      name: supplierName,
      userId,
      type: "ONLINE",
      status: "ACTIVE",
      contactEmail: SUPPLIER_EMAIL,
      whatsappPhone: "+2348100000002",
    },
    select: { id: true, name: true },
  });

  log(`Main supplier ensured (with creds): ${mainSupplier.name}`);

  // 4 other suppliers (no creds)
  const otherNames = ["Seed Supplier A", "Seed Supplier B", "Seed Supplier C", "Seed Supplier D"];
  const others: { id: string; name: string }[] = [];
  for (const n of otherNames) {
    const s = await prisma.supplier.upsert({
      where: { name: n },
      update: {},
      create: {
        name: n,
        type: n.includes("A") || n.includes("C") ? "PHYSICAL" : "ONLINE",
        status: "ACTIVE",
        contactEmail: `${n.toLowerCase().replace(/[^a-z0-9]+/g, "")}@example.com`,
        whatsappPhone: `+23481${randInt(0, 9)}${randInt(10000000, 99999999)}`,
      },
      select: { id: true, name: true },
    });
    others.push(s);
  }

  log(`Other suppliers ensured (no creds): ${others.length}`);
  return { mainSupplier, suppliers: [mainSupplier, ...others] };
}

/* ----------------------------------------------------------------------------
  Categories + brands (minimal)
---------------------------------------------------------------------------- */
async function ensureCategoriesAndBrands() {
  const cat = await prisma.category.upsert({
    where: { name: "Seed Category" },
    update: { isActive: true },
    create: { name: "Seed Category", slug: "seed-category", isActive: true, position: 1 },
    select: { id: true },
  });

  const brand = await prisma.brand.upsert({
    where: { slug: "seed-brand" },
    update: { isActive: true },
    create: { name: "Seed Brand", slug: "seed-brand", logoUrl: "https://picsum.photos/seed/seed-brand/160/160", isActive: true },
    select: { id: true },
  });

  return { cat, brand };
}

/* ----------------------------------------------------------------------------
  Attributes (only what we need for 2 variant products)
  Color (Red, Blue, Black)
  Size (S, M, L)
---------------------------------------------------------------------------- */
type SeedAttr = { name: string; type?: string; values: { name: string; code?: string }[] };

async function ensureAttributes() {
  const attrs: SeedAttr[] = [
    {
      name: "Color",
      type: "SELECT",
      values: [
        { name: "Red", code: "RED" },
        { name: "Blue", code: "BLUE" },
        { name: "Black", code: "BLACK" },
      ],
    },
    {
      name: "Size",
      type: "SELECT",
      values: [
        { name: "S", code: "S" },
        { name: "M", code: "M" },
        { name: "L", code: "L" },
      ],
    },
  ];

  const out: {
    attributeId: string;
    name: string;
    values: { id: string; name: string; code?: string | null }[];
  }[] = [];

  for (const a of attrs) {
    // Attribute has no unique name, so do findFirst then create if missing
    let attr = await prisma.attribute.findFirst({
      where: { name: a.name },
      select: { id: true, name: true },
    });

    if (!attr) {
      attr = await prisma.attribute.create({
        data: { name: a.name, type: a.type ?? "SELECT", isActive: true },
        select: { id: true, name: true },
      });
    } else {
      // keep it active
      await prisma.attribute.update({
        where: { id: attr.id },
        data: { isActive: true, type: a.type ?? "SELECT" },
      });
    }

    const vals: { id: string; name: string; code?: string | null }[] = [];
    for (const [pos, v] of a.values.entries()) {
      const existingVal = await prisma.attributeValue.findFirst({
        where: { attributeId: attr.id, name: v.name },
        select: { id: true, name: true, code: true },
      });

      if (existingVal) {
        await prisma.attributeValue.update({
          where: { id: existingVal.id },
          data: { code: v.code ?? existingVal.code ?? null, position: pos, isActive: true },
        });
        vals.push(existingVal);
      } else {
        const created = await prisma.attributeValue.create({
          data: { attributeId: attr.id, name: v.name, code: v.code ?? null, position: pos, isActive: true },
          select: { id: true, name: true, code: true },
        });
        vals.push(created);
      }
    }

    out.push({ attributeId: attr.id, name: attr.name, values: vals });
  }

  log(`Attributes ensured: ${out.length}`);
  return out;
}

/* ----------------------------------------------------------------------------
  Product attribute options (allow selection in UI)
---------------------------------------------------------------------------- */
async function ensureProductAttributeOptions(productId: string, attrs: Awaited<ReturnType<typeof ensureAttributes>>) {
  for (const a of attrs) {
    for (const v of a.values) {
      try {
        await prisma.productAttributeOption.create({
          data: { productId, attributeId: a.attributeId, valueId: v.id },
        });
      } catch {
        // ignore dupes
      }
    }
  }
}

/* ----------------------------------------------------------------------------
  Variants creation (schema-compliant)
---------------------------------------------------------------------------- */
async function createVariantsForProduct(args: {
  productId: string;
  skuBase: string;
  retail: number;
  attrs: Awaited<ReturnType<typeof ensureAttributes>>;
}) {
  const { productId, skuBase, retail, attrs } = args;

  const attrByName = new Map(attrs.map((a) => [a.name, a]));
  const color = attrByName.get("Color")!;
  const size = attrByName.get("Size")!;

  const values1 = color.values.slice(0, 3);
  const values2 = size.values.slice(0, 3);

  const createdVariants: { id: string; sku: string | null; retailPrice: Prisma.Decimal | null }[] = [];

  let idx = 1;
  for (const v1 of values1) {
    for (const v2 of values2) {
      const vSku = `${skuBase}-V${String(idx).padStart(2, "0")}`;
      idx++;

      const variantRetail = Math.max(500, retail + randInt(-200, 600));

      const variant = await prisma.productVariant.create({
        data: {
          productId,
          sku: vSku,
          retailPrice: toDec(variantRetail), // maps to "price" column
          inStock: true,
          imagesJson: pics(vSku) as any,
          isActive: true,
          availableQty: 0,
          options: {
            create: [
              // ✅ schema has NO priceBump on ProductVariantOption
              { attributeId: color.attributeId, valueId: v1.id },
              { attributeId: size.attributeId, valueId: v2.id },
            ],
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
  Supplier offers
  - SupplierProductOffer.basePrice
  - SupplierVariantOffer.unitPrice (full unit price now)
---------------------------------------------------------------------------- */
function supplierBaseFromRetail(retail: number): Prisma.Decimal {
  // base: ~55%–85% of retail
  const pct = 0.55 + Math.random() * 0.3;
  const val = Math.max(300, Math.round(retail * pct));
  return new Prisma.Decimal(val);
}

function supplierUnitPriceFromVariantRetail(variantRetail: number): Prisma.Decimal {
  // supplier unit price= ~55%–90% of variant retail
  const pct = 0.55 + Math.random() * 0.35;
  const val = Math.max(300, Math.round(variantRetail * pct));
  return new Prisma.Decimal(val);
}

async function ensureSupplierOffersForProduct(args: {
  productId: string;
  retail: number;
  suppliers: { id: string }[];
}) {
  const { productId, retail, suppliers } = args;

  const supplierCount = randInt(MIN_OFFERS_PER_PRODUCT, Math.min(MAX_OFFERS_PER_PRODUCT, suppliers.length));
  const chosenSuppliers = pick(suppliers, supplierCount);

  const baseOffers: { supplierId: string; offerId: string }[] = [];

  for (const s of chosenSuppliers) {
    const base = await prisma.supplierProductOffer.upsert({
      where: { supplierId_productId: { supplierId: s.id, productId } },
      update: {
        basePrice: supplierBaseFromRetail(retail),
        availableQty: randInt(MIN_AVAILABLE, MAX_AVAILABLE),
        inStock: true,
        isActive: true,
        leadDays: randInt(1, 10),
        currency: "NGN",
      },
      create: {
        supplierId: s.id,
        productId,
        basePrice: supplierBaseFromRetail(retail),
        availableQty: randInt(MIN_AVAILABLE, MAX_AVAILABLE),
        inStock: true,
        isActive: true,
        leadDays: randInt(1, 10),
        currency: "NGN",
      },
      select: { id: true },
    });

    baseOffers.push({ supplierId: s.id, offerId: base.id });
  }

  // product availability = sum of active+inStock base offers
  const agg = await prisma.supplierProductOffer.aggregate({
    _sum: { availableQty: true },
    where: { productId, isActive: true, inStock: true },
  });

  const sum = Number(agg._sum.availableQty || 0);

  await prisma.product.update({
    where: { id: productId },
    data: { availableQty: sum, inStock: sum > 0 },
  });

  return baseOffers;
}

async function ensureSupplierVariantOffersForVariants(args: {
  productId: string;
  variants: { id: string; retailPrice: Prisma.Decimal | null }[];
  baseOffers: { supplierId: string; offerId: string }[];
}) {
  const { productId, variants, baseOffers } = args;

  // For each supplier base offer, create variant offers for ~60% of variants
  for (const b of baseOffers) {
    const sample = variants.filter(() => Math.random() < 0.6);

    for (const v of sample) {
      const vr = Number(v.retailPrice ?? 0) || 0;
      if (vr <= 0) continue;

      try {
        await prisma.supplierVariantOffer.upsert({
          where: { supplierId_variantId: { supplierId: b.supplierId, variantId: v.id } },
          update: {
            productId,
            supplierProductOfferId: b.offerId,
            unitPrice: supplierUnitPriceFromVariantRetail(vr), // ✅ full unit price now
            availableQty: randInt(MIN_AVAILABLE, MAX_AVAILABLE),
            inStock: true,
            isActive: true,
            leadDays: randInt(1, 12),
            currency: "NGN",
          },
          create: {
            supplierId: b.supplierId,
            productId,
            variantId: v.id,
            supplierProductOfferId: b.offerId,
            unitPrice: supplierUnitPriceFromVariantRetail(vr), // ✅ full unit price now
            availableQty: randInt(MIN_AVAILABLE, MAX_AVAILABLE),
            inStock: true,
            isActive: true,
            leadDays: randInt(1, 12),
            currency: "NGN",
          },
          select: { id: true },
        });
      } catch {
        // ignore
      }
    }
  }

  // Recompute each variant availability from variant offers
  for (const v of variants) {
    const agg = await prisma.supplierVariantOffer.aggregate({
      _sum: { availableQty: true },
      where: { variantId: v.id, isActive: true, inStock: true },
    });

    const sum = Number(agg._sum.availableQty || 0);
    await prisma.productVariant.update({
      where: { id: v.id },
      data: { availableQty: sum, inStock: sum > 0 },
    });
  }
}

/* ----------------------------------------------------------------------------
  Seed Products
---------------------------------------------------------------------------- */
async function seedProducts(args: {
  superAdminId: string;
  catId: string;
  brandId: string;
  suppliers: { id: string }[];
  attrs: Awaited<ReturnType<typeof ensureAttributes>>;
}) {
  const { superAdminId, catId, brandId, suppliers, attrs } = args;

  log(`Seeding ${PRODUCT_COUNT} LIVE products (${BASE_ONLY_COUNT} simple, ${PRODUCT_COUNT - BASE_ONLY_COUNT} variant)…`);

  const titles = [
    "Seed Kettle",
    "Seed Headphones",
    "Seed T-Shirt",
    "Seed Sneakers",
    "Seed Speaker",
  ];

  for (let i = 1; i <= PRODUCT_COUNT; i++) {
    const title = `${titles[i - 1]} #${i}`;
    const sku = `SEED-LIVE-${String(i).padStart(3, "0")}`;
    const retail = 4500 + i * 300;

    const existing = await prisma.product.findFirst({
      where: { sku, isDeleted: false },
      select: { id: true },
    });

    const product = existing
      ? await prisma.product.update({
          where: { id: existing.id },
          data: {
            title,
            description: "Seeded LIVE product for dev/testing.",
            retailPrice: toDec(retail),
            inStock: true,
            status: "LIVE",
            imagesJson: pics(sku) as any,
            isDeleted: false,
            availableQty: 0,
            category: { connect: { id: catId } },
            brand: { connect: { id: brandId } },

            owner: { connect: { id: superAdminId } },
            createdBy: { connect: { id: superAdminId } },
            updatedBy: { connect: { id: superAdminId } },
          },
          select: { id: true },
        })
      : await prisma.product.create({
          data: {
            title,
            description: "Seeded LIVE product for dev/testing.",
            retailPrice: toDec(retail),
            sku,
            inStock: true,
            status: "LIVE",
            imagesJson: pics(sku) as any,
            isDeleted: false,
            availableQty: 0,
            category: { connect: { id: catId } },
            brand: { connect: { id: brandId } },

            owner: { connect: { id: superAdminId } },
            createdBy: { connect: { id: superAdminId } },
            updatedBy: { connect: { id: superAdminId } },
          },
          select: { id: true },
        });

    const isVariantProduct = i > BASE_ONLY_COUNT;

    if (isVariantProduct) {
      // Ensure attribute options for variant products
      await ensureProductAttributeOptions(product.id, attrs);

      // wipe variants for deterministic seed
      await prisma.productVariant.deleteMany({ where: { productId: product.id } });

      // create variants
      const createdVariants = await createVariantsForProduct({
        productId: product.id,
        skuBase: sku,
        retail,
        attrs,
      });

      // base offers 3–5 suppliers
      const baseOffers = await ensureSupplierOffersForProduct({
        productId: product.id,
        retail,
        suppliers,
      });

      // variant offers using unitPrice
      await ensureSupplierVariantOffersForVariants({
        productId: product.id,
        variants: createdVariants,
        baseOffers,
      });
    } else {
      // base-only: just base offers 3–5 suppliers
      await ensureSupplierOffersForProduct({
        productId: product.id,
        retail,
        suppliers,
      });

      // optional: ensure no variants
      await prisma.productVariant.deleteMany({ where: { productId: product.id } });
    }
  }

  log("Products seeded.");
}

/* ----------------------------------------------------------------------------
  Main
---------------------------------------------------------------------------- */
async function main() {
  await ensureCoreSettings();

  const superId = await ensureSuperAdmin();
  const { suppliers } = await ensureSupplierUserAndMainSupplier();
  const { cat, brand } = await ensureCategoriesAndBrands();
  const attrs = await ensureAttributes();

  await seedProducts({
    superAdminId: superId,
    catId: cat.id,
    brandId: brand.id,
    suppliers,
    attrs,
  });

  log("Seed complete.");
  log(`Super Admin: ${SUPER_EMAIL} / ${SUPER_PASS}`);
  log(`Supplier: ${SUPPLIER_EMAIL} / ${SUPPLIER_PASS}`);
}

main()
  .catch((e) => {
    console.error("[seed] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
