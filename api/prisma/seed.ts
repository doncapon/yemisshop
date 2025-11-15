// prisma/seed.ts
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ---- Configurable via env ---------------------------------------------------
const SUPER_EMAIL = process.env.SUPERADMIN_EMAIL || 'superadmin@example.com';
const SUPER_PASS  = process.env.SUPERADMIN_PASSWORD || 'SuperAdmin123!';
const SUPER_FIRST = process.env.SUPERADMIN_FIRSTNAME || 'Super';
const SUPER_LAST  = process.env.SUPERADMIN_LASTNAME  || 'Admin';

// Create a tiny demo catalog only if you explicitly opt in:
const DEMO_SEED = String(process.env.DEMO_SEED || 'false') === 'true';
// Size of demo catalog if DEMO_SEED=true
const DEMO_PRODUCT_COUNT = Number(process.env.DEMO_PRODUCT_COUNT || 20);

// Offer/availability targets
const MIN_OFFERS_PER_PRODUCT = 2;
const MAX_OFFERS_PER_PRODUCT = 5;
const MIN_AVAILABLE_PER_OFFER = 10;
const MAX_AVAILABLE_PER_OFFER = 30;

// Small helpers ---------------------------------------------------------------
const log = (...a: any[]) => console.log('[seed]', ...a);
const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function supplierOfferFromRetail(retail: number): Prisma.Decimal {
  // keep margin vs retail: ~65%–90% of retail
  const pct = 0.65 + Math.random() * 0.25;
  const val = Math.max(500, Math.round(retail * pct));
  return new Prisma.Decimal(val);
}

// -----------------------------------------------------------------------------
// Core bootstrap
// -----------------------------------------------------------------------------
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

async function ensureCoreTaxSettings() {
  try {
    await prisma.setting.createMany({
      data: [
        { key: 'taxMode', value: 'INCLUDED', isPublic: true },
        { key: 'taxRatePct', value: '7.5', isPublic: true },
        { key: 'commsUnitCostNGN', value: '100', isPublic: false },
      ],
      skipDuplicates: true,
    });
    log('Core settings ensured.');
  } catch {
    log('Skipping settings (table may not exist yet).');
  }
}

// -----------------------------------------------------------------------------
// Shared reference data (idempotent upserts)
// -----------------------------------------------------------------------------
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

  const outs = [];
  for (const n of names) {
    const out = await prisma.supplier.upsert({
      where: { name: n },
      update: {},
      create: {
        name: n,
        type: n.includes('Online') || n.includes('Prime') || n.includes('Swift') ? 'ONLINE' : 'PHYSICAL',
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
  const catNames = [
    'Home & Kitchen',
    'Electronics',
    'Fashion',
    'Beauty & Personal Care',
    'Groceries',
    'Health & Wellness',
  ];
  const brandNames = ['DaySpring', 'NaijaTech', 'GreenFarm', 'FitLife', 'UrbanPro', 'BrightHome'];

  const cats = [];
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
      select: { id: true, slug: true },
    });
    cats.push(c);
  }

  const brands = [];
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
      select: { id: true, slug: true },
    });
    brands.push(br);
  }

  return { cats, brands };
}

// -----------------------------------------------------------------------------
// DEMO catalog (only if DEMO_SEED=true)
// -----------------------------------------------------------------------------
function pics(seed: string | number) {
  return [
    `https://picsum.photos/seed/dayspring-${seed}/800/600`,
    `https://picsum.photos/seed/dayspring-${seed}-b/800/600`,
  ];
}

async function seedDemoCatalog(superAdminId: string, cats: { id: string }[], brands: { id: string }[], suppliers: { id: string }[]) {
  log(`Seeding DEMO catalog (${DEMO_PRODUCT_COUNT} products)…`);

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

  for (let i = 1; i <= DEMO_PRODUCT_COUNT; i++) {
    const cat = cats[(i - 1) % cats.length];
    const brand = brands[(i - 1) % brands.length];
    const title = `${titles[i % titles.length]} #${i}`;
    const sku = `DEMO-${String(i).padStart(5, '0')}`;
    const retail = 4000 + i * 250;

    const product = await prisma.product.upsert({
      where: { sku },
      update: {
        title,
        description:
          'Demo product seeded for DaySpring. Replace with real catalog before launch.',
        price: new Prisma.Decimal(retail),
        inStock: true,
        status: 'LIVE',
        imagesJson: pics(i),
        availableQty: 0, // will recalc from offers below
        category: { connect: { id: cat.id } },
        brand: { connect: { id: brand.id } },
        owner: { connect: { id: superAdminId } },
        supplier: {
          // pick a deterministic default supplier
          connect: { id: suppliers[(i - 1) % suppliers.length].id },
        },
      },
      create: {
        title,
        description:
          'Demo product seeded for DaySpring. Replace with real catalog before launch.',
        price: new Prisma.Decimal(retail),
        sku,
        inStock: true,
        status: 'LIVE',
        imagesJson: pics(i),
        availableQty: 0,
        category: { connect: { id: cat.id } },
        brand: { connect: { id: brand.id } },
        owner: { connect: { id: superAdminId } },
        supplier: { connect: { id: suppliers[(i - 1) % suppliers.length].id } },
      },
      select: { id: true, price: true },
    });

    // Ensure offers & availability for this product
    await ensureOffersForProduct(product.id, Number(product.price), suppliers);
  }

  log('DEMO catalog seeded.');
}

// -----------------------------------------------------------------------------
// Offers + availability for ALL products (idempotent “augmenter”)
// -----------------------------------------------------------------------------
async function ensureOffersForProduct(
  productId: string,
  retailPrice: number,
  suppliers: { id: string }[]
) {
  // Existing generic offers (variantId=null)
  const existing = await prisma.supplierOffer.findMany({
    where: { productId, variantId: null },
    select: { id: true, supplierId: true, availableQty: true },
  });

  const have = existing.length;
  const target = Math.max(
    MIN_OFFERS_PER_PRODUCT,
    Math.min(MAX_OFFERS_PER_PRODUCT, have || randInt(MIN_OFFERS_PER_PRODUCT, MAX_OFFERS_PER_PRODUCT))
  );

  // Choose additional suppliers that don't already have an offer for this product
  const existingSupplierIds = new Set(existing.map((o) => o.supplierId));
  const pool = suppliers.filter((s) => !existingSupplierIds.has(s.id));

  const toCreate = Math.max(0, target - have);
  const chosen = pool.sort(() => Math.random() - 0.5).slice(0, toCreate);

  for (const sup of chosen) {
    try {
      await prisma.supplierOffer.create({
        data: {
          supplierId: sup.id,
          productId,
          variantId: null,
          price: supplierOfferFromRetail(retailPrice || 5000),
          currency: 'NGN',
          availableQty: randInt(MIN_AVAILABLE_PER_OFFER, MAX_AVAILABLE_PER_OFFER),
          inStock: true,
          leadDays: randInt(1, 10),
          isActive: true,
        },
      });
    } catch {
      // unique([supplierId, productId, variantId]) might race if parallel; ignore on conflict
    }
  }

  // Recalculate product.availableQty as SUM of active, inStock offers (variantId=null)
  const agg = await prisma.supplierOffer.aggregate({
    _sum: { availableQty: true },
    where: { productId, variantId: null, isActive: true, inStock: true },
  });

  const sum = Number(agg._sum.availableQty || 0);
  await prisma.product.update({
    where: { id: productId },
    data: { availableQty: sum, inStock: sum > 0 },
  });
}

async function ensureOffersForAllProducts(suppliers: { id: string }[]) {
  log('Ensuring offers & availability for ALL products…');

  // Iterate in batches to avoid loading too much at once
  const pageSize = 200;
  let skip = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await prisma.product.findMany({
      select: { id: true, price: true },
      skip,
      take: pageSize,
      orderBy: { createdAt: 'asc' },
    });
    if (batch.length === 0) break;

    for (const p of batch) {
      await ensureOffersForProduct(p.id, Number(p.price || 5000), suppliers);
    }

    skip += batch.length;
  }

  log('Offers & availability ensured for all products.');
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function main() {
  await ensureCoreTaxSettings();
  const superId = await ensureSuperAdmin();
  const suppliers = await ensureSuppliers();
  const { cats, brands } = await ensureCategoriesAndBrands();

  // Create demo catalog only if you opt in via env
  if (DEMO_SEED) {
    await seedDemoCatalog(superId, cats, brands, suppliers);
  }

  // Always augment whatever products exist (demo or your own) with offers+availability
  await ensureOffersForAllProducts(suppliers);

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
