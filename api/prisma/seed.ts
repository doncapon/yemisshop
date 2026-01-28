// prisma/seed.ts

import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';
import { Prisma } from '@prisma/client';
/* ----------------------------------------------------------------------------
  Config (env)
---------------------------------------------------------------------------- */
const SUPER_EMAIL = process.env.SUPERADMIN_EMAIL || 'superadmin@example.com';
const SUPER_PASS = process.env.SUPERADMIN_PASSWORD || 'SuperAdmin123!';
const SUPER_FIRST = process.env.SUPERADMIN_FIRSTNAME || 'Super';
const SUPER_LAST = process.env.SUPERADMIN_LASTNAME || 'Admin';

const PRODUCT_COUNT = Number(process.env.SEED_PRODUCT_COUNT || 10);

// Offers/availability targets
const MIN_SUPPLIERS_PER_PRODUCT = 2;
const MAX_SUPPLIERS_PER_PRODUCT = 4;
const MIN_AVAILABLE = 10;
const MAX_AVAILABLE = 40;

const log = (...a: any[]) => console.log('[seed]', ...a);
const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function pics(seed: string | number) {
  return [
    `https://picsum.photos/seed/dayspring-${seed}/800/600`,
    `https://picsum.photos/seed/dayspring-${seed}-b/800/600`,
  ];
}

function toDec(n: number) {
  return new Prisma.Decimal(Math.round(n * 100) / 100);
}

function supplierBaseFromRetail(retail: number): Prisma.Decimal {
  // base: ~55%–85% of retail
  const pct = 0.55 + Math.random() * 0.3;
  const val = Math.max(300, Math.round(retail * pct));
  return new Prisma.Decimal(val);
}

function priceBumpFromRetail(retail: number): Prisma.Decimal {
  // bump: 0%–15% of retail, min 0
  const pct = Math.random() * 0.15;
  const val = Math.max(0, Math.round(retail * pct));
  return new Prisma.Decimal(val);
}

/* ----------------------------------------------------------------------------
  Core bootstrap
---------------------------------------------------------------------------- */
async function ensureSuperAdmin() {
  log('Ensuring Super Admin exists…');

  const existing = await prisma.user.findUnique({
    where: { email: SUPER_EMAIL },
    select: { id: true, role: true },
  });

  if (existing) {
    if (existing.role !== 'SUPER_ADMIN') {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: 'SUPER_ADMIN', status: 'VERIFIED', emailVerifiedAt: new Date() },
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
      houseNumber: '1',
      streetName: 'Leadership Ave',
      city: 'Abuja',
      state: 'FCT',
      postCode: '',
      town: '',
      country: 'Nigeria',
    },
  });

  const user = await prisma.user.create({
    data: {
      email: SUPER_EMAIL,
      password: passwordHash,
      role: 'SUPER_ADMIN',
      firstName: SUPER_FIRST,
      lastName: SUPER_LAST,
      phone: '+2348100000001',
      status: 'VERIFIED',
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

async function ensureCoreSettings() {
  try {
    await prisma.setting.createMany({
      data: [
        { key: 'taxMode', value: 'INCLUDED', isPublic: true },
        { key: 'taxRatePct', value: '7.5', isPublic: true },
        { key: 'commsUnitCostNGN', value: '100', isPublic: false },
        { key: 'profitMode', value: 'accurate', isPublic: false },
        { key: 'serviceFeeBaseNGN', value: '1000', isPublic: false },
        { key: 'platformBaseFeeNGN', value: '100', isPublic: false },
      ],
      skipDuplicates: true,
    });
    log('Core settings ensured.');
  } catch {
    log('Skipping settings (table may not exist yet).');
  }
}

/* ----------------------------------------------------------------------------
  Reference data: suppliers, categories, brands
---------------------------------------------------------------------------- */
async function ensureSuppliers() {
  const names = [
    'Dayspring Wholesale',
    'MarketHub NG',
    'PrimeMall Distributors',
    'UrbanGoods Africa',
    'Lagos Mega Supply',
    'SwiftDrop NG',
    'Allied Trade Co',
    'Vertex Retailers NG',
  ];

  const outs: { id: string; name: string }[] = [];
  for (const n of names) {
    const out = await prisma.supplier.upsert({
      where: { name: n },
      update: {},
      create: {
        name: n,
        type: n.includes('Prime') || n.includes('Swift') || n.includes('MarketHub') ? 'ONLINE' : 'PHYSICAL',
        status: 'ACTIVE',
        contactEmail: `${n.toLowerCase().replace(/[^a-z0-9]+/g, '')}@example.com`,
        whatsappPhone: `+23481${randInt(0, 9)}${randInt(10000000, 99999999)}`,
      },
      select: { id: true, name: true },
    });
    outs.push(out);
  }

  log(`Suppliers ensured: ${outs.length}`);
  return outs;
}

async function ensureCategoriesAndBrands() {
  const catNames = ['Home & Kitchen', 'Electronics', 'Fashion', 'Beauty', 'Groceries', 'Health'];
  const brandNames = ['DaySpring', 'NaijaTech', 'GreenFarm', 'FitLife', 'UrbanPro', 'BrightHome'];

  const cats: { id: string }[] = [];
  for (const [idx, name] of catNames.entries()) {
    const slug = name
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const c = await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { name, slug, isActive: true, position: idx },
      select: { id: true },
    });
    cats.push(c);
  }

  const brands: { id: string }[] = [];
  for (const b of brandNames) {
    const slug = b.toLowerCase();
    const br = await prisma.brand.upsert({
      where: { slug },
      update: {},
      create: {
        name: b,
        slug,
        logoUrl: `https://picsum.photos/seed/${slug}/160/160`,
        isActive: true,
      },
      select: { id: true },
    });
    brands.push(br);
  }

  return { cats, brands };
}

/* ----------------------------------------------------------------------------
  Attributes (5) + values
  We seed:
   - Color (Red, Blue, Black)
   - Size (S, M, L)
   - Material (Cotton, Plastic, Steel)
   - Volume (250ml, 500ml, 1L)
   - Weight (250g, 500g, 1kg)
---------------------------------------------------------------------------- */
type SeedAttr = {
  name: string;
  type?: string;
  values: { name: string; code?: string }[];
};

async function ensureAttributes() {
  const attrs: SeedAttr[] = [
    {
      name: 'Color',
      type: 'SELECT',
      values: [
        { name: 'Red', code: 'RED' },
        { name: 'Blue', code: 'BLUE' },
        { name: 'Black', code: 'BLACK' },
      ],
    },
    {
      name: 'Size',
      type: 'SELECT',
      values: [
        { name: 'S', code: 'S' },
        { name: 'M', code: 'M' },
        { name: 'L', code: 'L' },
      ],
    },
    {
      name: 'Material',
      type: 'SELECT',
      values: [
        { name: 'Cotton', code: 'COTTON' },
        { name: 'Plastic', code: 'PLASTIC' },
        { name: 'Steel', code: 'STEEL' },
      ],
    },
    {
      name: 'Volume',
      type: 'SELECT',
      values: [
        { name: '250ml', code: '250ML' },
        { name: '500ml', code: '500ML' },
        { name: '1L', code: '1L' },
      ],
    },
    {
      name: 'Weight',
      type: 'SELECT',
      values: [
        { name: '250g', code: '250G' },
        { name: '500g', code: '500G' },
        { name: '1kg', code: '1KG' },
      ],
    },
  ];

  const out: {
    attributeId: string;
    name: string;
    values: { id: string; name: string; code?: string | null }[];
  }[] = [];

  for (const a of attrs) {
    const attr = await prisma.attribute.upsert({
      where: { id: undefined as any }, // no unique on name, so we do findFirst + create/update
      update: {},
      create: {
        name: a.name,
        type: a.type ?? 'SELECT',
        isActive: true,
      },
      select: { id: true, name: true },
    }).catch(async () => {
      // fallback: findFirst by name, then create if missing
      const existing = await prisma.attribute.findFirst({
        where: { name: a.name },
        select: { id: true, name: true },
      });
      if (existing) return existing;
      return prisma.attribute.create({
        data: { name: a.name, type: a.type ?? 'SELECT', isActive: true },
        select: { id: true, name: true },
      });
    });

    // ensure values (AttributeValue has no unique on (attributeId,name), so we do findFirst per value
    const vals: { id: string; name: string; code?: string | null }[] = [];
    for (const [pos, v] of a.values.entries()) {
      const existingVal = await prisma.attributeValue.findFirst({
        where: { attributeId: attr.id, name: v.name },
        select: { id: true, name: true, code: true },
      });

      if (existingVal) {
        // keep code/position tidy
        await prisma.attributeValue.update({
          where: { id: existingVal.id },
          data: { code: v.code ?? existingVal.code ?? null, position: pos, isActive: true },
        });
        vals.push(existingVal);
        continue;
      }

      const created = await prisma.attributeValue.create({
        data: {
          attributeId: attr.id,
          name: v.name,
          code: v.code ?? null,
          position: pos,
          isActive: true,
        },
        select: { id: true, name: true, code: true },
      });
      vals.push(created);
    }

    out.push({ attributeId: attr.id, name: attr.name, values: vals });
  }

  log(`Attributes ensured: ${out.length}`);
  return out;
}

/* ----------------------------------------------------------------------------
  Product creation with variants + options
  - Create 10 products with status = "LIVE"
  - For each product:
      * create product attribute options (ProductAttributeOption) for the attributes we use
      * create variants (combinations of a subset of attributes) with ProductVariantOption rows
      * attach SupplierProductOffer base rows
      * attach SupplierVariantOffer rows with priceBump per variant per supplier (optional)
      * compute availableQty for product & variants from offers
---------------------------------------------------------------------------- */

function pick<T>(arr: T[], n: number) {
  const copy = [...arr];
  copy.sort(() => Math.random() - 0.5);
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
}

function variantLabelFrom(values: { attr: string; val: string }[]) {
  return values.map((x) => `${x.attr}:${x.val}`).join('-');
}

async function ensureProductAttributeOptions(productId: string, attrs: Awaited<ReturnType<typeof ensureAttributes>>) {
  // Ensure ProductAttributeOption rows for each attribute/value used in variants.
  // We'll just ensure ALL seeded values are selectable for the product (simple demo).
  // If you want only subset per product, limit here.
  for (const a of attrs) {
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
        // ignore dupes
      }
    }
  }
}

async function createVariantsForProduct(args: {
  productId: string;
  skuBase: string;
  retail: number;
  attrs: Awaited<ReturnType<typeof ensureAttributes>>;
}) {
  const { productId, skuBase, retail, attrs } = args;

  const attrByName = new Map(attrs.map((a) => [a.name, a]));
  const color = attrByName.get('Color')!;
  const size = attrByName.get('Size')!;
  const material = attrByName.get('Material')!;
  const volume = attrByName.get('Volume')!;
  const weight = attrByName.get('Weight')!;

  // Use a subset so variants don't explode:
  //  - products 1..5: Color x Size = 9 variants
  //  - products 6..10: Material x (Volume or Weight) = 9 variants
  // We’ll decide by skuBase suffix parity outside, but you can change.
  const useColorSize = skuBase.endsWith('1') || skuBase.endsWith('2') || skuBase.endsWith('3') || skuBase.endsWith('4') || skuBase.endsWith('5');

  const A1 = useColorSize ? color : material;
  const A2 = useColorSize ? size : (Math.random() > 0.5 ? volume : weight);

  const values1 = A1.values.slice(0, 3);
  const values2 = A2.values.slice(0, 3);

  const createdVariants: { id: string; sku: string | null }[] = [];

  let idx = 1;
  for (const v1 of values1) {
    for (const v2 of values2) {
      const vSku = `${skuBase}-V${String(idx).padStart(2, '0')}`;
      idx++;

      // Variant price: retail +/- small bump (keeps it realistic)
      const variantRetail = Math.max(500, retail + randInt(-200, 600));

      const variant = await prisma.productVariant.create({
        data: {
          productId,
          sku: vSku,
          retailPrice: toDec(variantRetail),
          inStock: true,
          imagesJson: pics(vSku) as any,
          isActive: true,
          availableQty: 0, // will be recomputed after offers
          options: {
            create: [
              { attributeId: A1.attributeId, valueId: v1.id, priceBump: null },
              { attributeId: A2.attributeId, valueId: v2.id, priceBump: null },
            ],
          },
        },
        select: { id: true, sku: true },
      });

      createdVariants.push(variant);
    }
  }

  return { createdVariants, usedAttributes: [A1, A2] };
}

async function ensureSupplierOffersForProduct(args: {
  productId: string;
  retail: number;
  suppliers: { id: string }[];
}) {
  const { productId, retail, suppliers } = args;

  const supplierCount = randInt(MIN_SUPPLIERS_PER_PRODUCT, Math.min(MAX_SUPPLIERS_PER_PRODUCT, suppliers.length));
  const chosenSuppliers = pick(suppliers, supplierCount);

  const baseOffers: { supplierId: string; offerId: string }[] = [];

  for (const s of chosenSuppliers) {
    // Upsert base offer (unique on supplierId+productId)
    const base = await prisma.supplierProductOffer.upsert({
      where: { supplierId_productId: { supplierId: s.id, productId } },
      update: {
        basePrice: supplierBaseFromRetail(retail),
        availableQty: randInt(MIN_AVAILABLE, MAX_AVAILABLE),
        inStock: true,
        isActive: true,
        leadDays: randInt(1, 10),
        currency: 'NGN',
      },
      create: {
        supplierId: s.id,
        productId,
        basePrice: supplierBaseFromRetail(retail),
        availableQty: randInt(MIN_AVAILABLE, MAX_AVAILABLE),
        inStock: true,
        isActive: true,
        leadDays: randInt(1, 10),
        currency: 'NGN',
      },
      select: { id: true },
    });

    baseOffers.push({ supplierId: s.id, offerId: base.id });
  }

  // compute product availability from base offers (simple sum of active+inStock)
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
  retail: number;
  variants: { id: string; sku: string | null }[];
  baseOffers: { supplierId: string; offerId: string }[];
}) {
  const { productId, retail, variants, baseOffers } = args;

  // For each supplier base offer, create variant offers for ~60% of variants
  for (const b of baseOffers) {
    const sample = variants.filter(() => Math.random() < 0.6);

    for (const v of sample) {
      // Unique on supplierId+variantId
      try {
        const row = await prisma.supplierVariantOffer.upsert({
          where: { supplierId_variantId: { supplierId: b.supplierId, variantId: v.id } },
          update: {
            productId,
            supplierProductOfferId: b.offerId,
            priceBump: priceBumpFromRetail(retail),
            availableQty: randInt(MIN_AVAILABLE, MAX_AVAILABLE),
            inStock: true,
            isActive: true,
            leadDays: randInt(1, 12),
            currency: 'NGN',
          },
          create: {
            supplierId: b.supplierId,
            productId,
            variantId: v.id,
            supplierProductOfferId: b.offerId,
            priceBump: priceBumpFromRetail(retail),
            availableQty: randInt(MIN_AVAILABLE, MAX_AVAILABLE),
            inStock: true,
            isActive: true,
            leadDays: randInt(1, 12),
            currency: 'NGN',
          },
          select: { id: true },
        });
        void row;
      } catch {
        // ignore (race/constraint)
      }
    }
  }

  // Recompute each variant availability from variant offers (sum active+inStock)
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

async function seedProducts(args: {
  superAdminId: string;
  cats: { id: string }[];
  brands: { id: string }[];
  suppliers: { id: string }[];
  attrs: Awaited<ReturnType<typeof ensureAttributes>>;
}) {
  const { superAdminId, cats, brands, suppliers, attrs } = args;

  log(`Seeding ${PRODUCT_COUNT} products with status LIVE + variants…`);

  const titles = [
    'Wireless Headphones',
    'Stainless Steel Kettle',
    'Cotton T-Shirt',
    'Vitamin C Serum',
    'Smart LED Bulb',
    'Bluetooth Speaker',
    'Bamboo Chopping Board',
    'Running Sneakers',
    'Digital Bathroom Scale',
    'Football (Size 5)',
  ];

  for (let i = 1; i <= PRODUCT_COUNT; i++) {
    const cat = cats[(i - 1) % cats.length];
    const brand = brands[(i - 1) % brands.length];

    const title = `${titles[(i - 1) % titles.length]} #${i}`;
    const sku = `LIVE-${String(i).padStart(5, '0')}`;
    const retail = 4000 + i * 350;

    // your schema has @@unique([sku, isDeleted]) but no named compound unique input shown here
    // so we do a safe “find then create/update” by (sku, isDeleted=false)
    const existing = await prisma.product.findFirst({
      where: { sku, isDeleted: false },
      select: { id: true },
    });

    const product = existing
      ? await prisma.product.update({
        where: { id: existing.id },
        data: {
          title,
          description: 'Seeded LIVE product. Replace with real catalog before launch.',
          retailPrice: toDec(retail),
          inStock: true,
          status: 'LIVE',
          imagesJson: pics(sku) as any,
          isDeleted: false,
          availableQty: 0,
          category: { connect: { id: cat.id } },
          brand: { connect: { id: brand.id } },

          // ✅ FIX: use relations, not ownerId/createdById/updatedById
          owner: { connect: { id: superAdminId } },
          createdBy: { connect: { id: superAdminId } },
          updatedBy: { connect: { id: superAdminId } },
        },
        select: { id: true },
      })
      : await prisma.product.create({
        data: {
          title,
          description: 'Seeded LIVE product. Replace with real catalog before launch.',
          retailPrice: toDec(retail),
          sku,
          inStock: true,
          status: 'LIVE',
          imagesJson: pics(sku) as any,
          isDeleted: false,
          availableQty: 0,
          category: { connect: { id: cat.id } },
          brand: { connect: { id: brand.id } },

          // ✅ FIX: use relations, not ownerId/createdById/updatedById
          owner: { connect: { id: superAdminId } },
          createdBy: { connect: { id: superAdminId } },
          updatedBy: { connect: { id: superAdminId } },
        },
        select: { id: true },
      });

    // Ensure product attribute options (so UI can filter/select)
    await ensureProductAttributeOptions(product.id, attrs);

    // Clear old variants for deterministic seed (optional)
    // If you want to keep existing variants, comment this block out.
    await prisma.productVariant.deleteMany({ where: { productId: product.id } });

    // Create variants (combos)
    const { createdVariants } = await createVariantsForProduct({
      productId: product.id,
      skuBase: sku,
      retail,
      attrs,
    });

    // Supplier base offers (SupplierProductOffer)
    const baseOffers = await ensureSupplierOffersForProduct({
      productId: product.id,
      retail,
      suppliers,
    });

    // Supplier variant offers (SupplierVariantOffer)
    await ensureSupplierVariantOffersForVariants({
      productId: product.id,
      retail,
      variants: createdVariants,
      baseOffers,
    });

    // Also update product availableQty again as base + variant (optional)
    // Here we keep product.availableQty as base-offer sum (simple),
    // but you can switch to max(baseSum, variantSum) if your UI expects.
  }

  log('Products + variants seeded.');
}

/* ----------------------------------------------------------------------------
  Main
---------------------------------------------------------------------------- */
async function main() {
  await ensureCoreSettings();
  const superId = await ensureSuperAdmin();
  const suppliers = await ensureSuppliers();
  const { cats, brands } = await ensureCategoriesAndBrands();
  const attrs = await ensureAttributes();

  await seedProducts({ superAdminId: superId, cats, brands, suppliers, attrs });

  log('Seed complete.');
  log(`Login as: ${SUPER_EMAIL} / ${SUPER_PASS}`);
}

main()
  .catch((e) => {
    console.error('[seed] failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
