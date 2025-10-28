// prisma/seed.ts
import { PrismaClient, Prisma, SupplierType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const now = new Date();

/* ---------------- Helpers ---------------- */
const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const sample = <T,>(arr: T[]) => arr[randInt(0, arr.length - 1)];
const chance = (p: number) => Math.random() < p;

function pickSome<T>(arr: T[], min = 1, max = 3) {
  const n = Math.max(min, Math.min(max, randInt(min, max)));
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) {
    out.push(copy.splice(randInt(0, copy.length - 1), 1)[0]);
  }
  return out;
}

const PRICE_BUCKETS = [
  { min: 1000, max: 4999 },
  { min: 5000, max: 9999 },
  { min: 10000, max: 99999 },
] as const;
function randomAvailable() {
  // tweak range as you like
  return randInt(0, 180);
}

function randomPrice(): Prisma.Decimal {
  const b =
    Math.random() < 0.35
      ? PRICE_BUCKETS[0]
      : Math.random() < 0.75
        ? PRICE_BUCKETS[1]
        : PRICE_BUCKETS[2];
  return new Prisma.Decimal(randInt(b.min, b.max));
}

function productImages(seed: string | number): string[] {
  return [
    `https://picsum.photos/seed/yemishop-${seed}/800/600`,
    `https://picsum.photos/seed/yemishop-${seed}-b/800/600`,
    `https://picsum.photos/seed/yemishop-${seed}-c/800/600`,
  ];
}

async function makeAddress(seed: {
  houseNumber: string;
  streetName: string;
  city: string;
  state: string;
  country?: string;
  postCode?: string;
  town?: string;
}) {
  return prisma.address.create({
    data: {
      houseNumber: seed.houseNumber,
      streetName: seed.streetName,
      city: seed.city,
      state: seed.state,
      postCode: seed.postCode ?? '',
      town: seed.town ?? '',
      country: seed.country ?? 'Nigeria',
    },
  });
}

/** Supplier offer price (keep margin vs retail): 65–90% of retail */
function supplierOfferFromRetail(retail: number) {
  const pct = 0.65 + Math.random() * 0.25; // 65%–90%
  const val = Math.max(500, Math.round(retail * pct));
  return new Prisma.Decimal(val);
}

/* ---------------- Seed Script ---------------- */
async function main() {
  console.log('🧹 Clearing existing data …');

  // Delete dependents first (many tables are optional; guard each call)
  await prisma.$transaction(
    [
      prisma.paymentEvent?.deleteMany?.() as any,
      prisma.orderActivity?.deleteMany?.() as any,
      prisma.purchaseOrderItem?.deleteMany?.() as any,
      prisma.purchaseOrder?.deleteMany?.() as any,
      prisma.orderItem?.deleteMany?.() as any,
      prisma.payment?.deleteMany?.() as any,

      prisma.supplierOffer?.deleteMany?.() as any,
      prisma.productVariantOption?.deleteMany?.() as any,
      prisma.productVariant?.deleteMany?.() as any,

      prisma.productAttributeText?.deleteMany?.() as any,
      prisma.productAttributeOption?.deleteMany?.() as any, // ← new link table

      prisma.favorite?.deleteMany?.() as any,
      prisma.wishlist?.deleteMany?.() as any,
      prisma.product?.deleteMany?.() as any,

      prisma.attributeValue?.deleteMany?.() as any,
      prisma.attribute?.deleteMany?.() as any,
      prisma.brand?.deleteMany?.() as any,
      prisma.category?.deleteMany?.() as any,

      prisma.supplier?.deleteMany?.() as any,
      prisma.emailVerifyToken?.deleteMany?.() as any,
      prisma.otp?.deleteMany?.() as any,
      prisma.user?.deleteMany?.() as any,
      prisma.address?.deleteMany?.() as any,
      prisma.setting?.deleteMany?.() as any, // optional
    ].filter(Boolean)
  );

  console.log('⚙️  Seeding settings (if table exists)…');
  try {
    await prisma.setting.createMany({
      data: [
        { key: 'taxMode', value: 'INCLUDED' },   // or ADDED / NONE
        { key: 'taxRatePct', value: '7.5' },
        { key: 'commsUnitCostNGN', value: '100' },
      ],
      skipDuplicates: true,
    });
  } catch {
    // settings table may not exist yet; ignore
  }

  console.log('👥 Seeding users…');
  const adminPwd = await bcrypt.hash('Admin123!', 10);
  const superAdminPwd = await bcrypt.hash('SuperAdmin123!', 10);
  const shopperPwd = await bcrypt.hash('Shopper123!', 10);

  // Addresses
  const [adminHome, adminShip] = await Promise.all([
    makeAddress({ houseNumber: '10', streetName: 'Admin Crescent', city: 'Ikeja', state: 'Lagos' }),
    makeAddress({ houseNumber: '12', streetName: 'Admin Crescent', city: 'Ikeja', state: 'Lagos' }),
  ]);
  const [superAdminHome, superAdminShip] = await Promise.all([
    makeAddress({ houseNumber: '22B', streetName: 'Leadership Ave', city: 'Abuja', state: 'FCT' }),
    makeAddress({ houseNumber: '5', streetName: 'Steward Road', city: 'Abuja', state: 'FCT' }),
  ]);
  const [shopperHome, shopperShip] = await Promise.all([
    makeAddress({ houseNumber: '7', streetName: 'Market Lane', city: 'Ibadan', state: 'Oyo' }),
    makeAddress({ houseNumber: '9', streetName: 'Market Lane', city: 'Ibadan', state: 'Oyo' }),
  ]);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      password: adminPwd,
      role: 'ADMIN',
      firstName: 'Site',
      lastName: 'Admin',
      phone: '+2348100000001',
      status: 'VERIFIED',
      emailVerifiedAt: now,
      phoneVerifiedAt: now,
      joinedAt: now,
      address: { connect: { id: adminHome.id } },
      shippingAddress: { connect: { id: adminShip.id } },
    },
  });

  await prisma.user.create({
    data: {
      email: 'superadmin@example.com',
      password: superAdminPwd,
      role: 'SUPER_ADMIN',
      firstName: 'Super',
      lastName: 'Admin',
      phone: '+2348100000004',
      status: 'VERIFIED',
      emailVerifiedAt: now,
      phoneVerifiedAt: now,
      joinedAt: now,
      address: { connect: { id: superAdminHome.id } },
      shippingAddress: { connect: { id: superAdminShip.id } },
    },
  });

  await prisma.user.create({
    data: {
      email: 'shopper@example.com',
      password: shopperPwd,
      role: 'SHOPPER',
      firstName: 'Yemi',
      lastName: 'Shopper',
      phone: '+2348100000003',
      status: 'VERIFIED',
      emailVerifiedAt: now,
      phoneVerifiedAt: now,
      joinedAt: now,
      address: { connect: { id: shopperHome.id } },
      shippingAddress: { connect: { id: shopperShip.id } },
    },
  });

  console.log('🏭 Seeding suppliers…');
  const suppliers = await prisma.$transaction([
    prisma.supplier.create({
      data: {
        name: 'YemiShop Wholesale',
        type: SupplierType.PHYSICAL,
        status: 'ACTIVE',
        contactEmail: 'wholesale@yemishop.com',
        whatsappPhone: '+2348100000000',
      },
    }),
    prisma.supplier.create({
      data: {
        name: 'MarketHub NG',
        type: SupplierType.PHYSICAL,
        status: 'ACTIVE',
        contactEmail: 'contact@markethub.ng',
        whatsappPhone: '+2348100000005',
      },
    }),
    prisma.supplier.create({
      data: {
        name: 'PrimeMall Distributors',
        type: SupplierType.ONLINE,
        status: 'ACTIVE',
        contactEmail: 'support@primemall.ng',
        whatsappPhone: '+2348100000006',
      },
    }),
    prisma.supplier.create({
      data: {
        name: 'UrbanGoods Africa',
        type: SupplierType.ONLINE,
        status: 'ACTIVE',
        contactEmail: 'hello@urbangoods.africa',
        whatsappPhone: '+2348100000007',
      },
    }),
    prisma.supplier.create({
      data: {
        name: 'Lagos Mega Supply',
        type: SupplierType.PHYSICAL,
        status: 'ACTIVE',
        contactEmail: 'sales@lagosmega.ng',
        whatsappPhone: '+2348100000008',
      },
    }),
    prisma.supplier.create({
      data: {
        name: 'SwiftDrop NG',
        type: SupplierType.ONLINE,
        status: 'ACTIVE',
        contactEmail: 'ops@swiftdrop.ng',
        whatsappPhone: '+2348100000009',
      },
    }),
  ]);

  console.log('🏷️  Seeding categories…');
  const categoryNames = [
    'Home & Kitchen',
    'Electronics',
    'Fashion',
    'Beauty & Personal Care',
    'Groceries',
    'Health & Wellness',
    'Toys & Games',
    'Sports & Outdoor',
  ];
  const categories = await Promise.all(
    categoryNames.map((name) =>
      prisma.category.create({
        data: {
          name,
          slug: name
            .toLowerCase()
            .replace(/&/g, 'and')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, ''),
          isActive: true,
          position: 0,
        },
      })
    )
  );

  console.log('🏷️  Seeding brands…');
  const brandSeeds = ['YemiBasics', 'NaijaTech', 'GreenFarm', 'FitLife'];
  const brands = await Promise.all(
    brandSeeds.map((b) =>
      prisma.brand.create({
        data: {
          name: b,
          slug: b.toLowerCase(),
          logoUrl: `https://picsum.photos/seed/${b}/160/160`,
          isActive: true,
        },
      })
    )
  );

  console.log('🏷️  Seeding attributes & values…');
  // Attributes: Color (SELECT), Size (SELECT), Material (TEXT)
  const colorAttr = await prisma.attribute.create({
    data: { name: 'Color', type: 'SELECT', isActive: true },
  });
  const sizeAttr = await prisma.attribute.create({
    data: { name: 'Size', type: 'SELECT', isActive: true },
  });
  const materialAttr = await prisma.attribute.create({
    data: { name: 'Material', type: 'TEXT', isActive: true },
  });

  const colorValues = await prisma.$transaction([
    prisma.attributeValue.create({ data: { attributeId: colorAttr.id, name: 'Red', code: 'RED', position: 1 } }),
    prisma.attributeValue.create({ data: { attributeId: colorAttr.id, name: 'Blue', code: 'BLU', position: 2 } }),
    prisma.attributeValue.create({ data: { attributeId: colorAttr.id, name: 'Black', code: 'BLK', position: 3 } }),
    prisma.attributeValue.create({ data: { attributeId: colorAttr.id, name: 'Green', code: 'GRN', position: 4 } }),
    prisma.attributeValue.create({ data: { attributeId: colorAttr.id, name: 'White', code: 'WHT', position: 5 } }),
  ]);

  const sizeValues = await prisma.$transaction([
    prisma.attributeValue.create({ data: { attributeId: sizeAttr.id, name: 'S', code: 'S', position: 1 } }),
    prisma.attributeValue.create({ data: { attributeId: sizeAttr.id, name: 'M', code: 'M', position: 2 } }),
    prisma.attributeValue.create({ data: { attributeId: sizeAttr.id, name: 'L', code: 'L', position: 3 } }),
    prisma.attributeValue.create({ data: { attributeId: sizeAttr.id, name: 'XL', code: 'XL', position: 4 } }),
  ]);

  console.log('📦 Seeding products…');
  const titlePool = [
    'Wireless Headphones',
    'Stainless Steel Kettle',
    'Cotton T-Shirt',
    'Vitamin C Serum',
    'Organic Basmati Rice (5kg)',
    'Digital Bathroom Scale',
    'Building Blocks Set',
    'Football (Size 5)',
    'Bluetooth Speaker',
    'Bamboo Chopping Board',
    'Running Sneakers',
    'Moisturising Body Lotion',
    'Granola Cereal (1kg)',
    'Yoga Mat (Non-slip)',
    'Remote Control Car',
    'Smart LED Bulb',
    'Chef’s Knife',
    'Classic Denim Jeans',
    'Hair Dryer',
    'Herbal Green Tea (50 bags)',
  ];

  const TOTAL_IN_STOCK = 60;
  const TOTAL_OUT_OF_STOCK = 30;
  const TOTAL = TOTAL_IN_STOCK + TOTAL_OUT_OF_STOCK;

  const createdProducts: { id: string; i: number }[] = [];
  for (let i = 1; i <= TOTAL; i++) {
    const cat = categories[(i - 1) % categories.length];
    const brand = brands[(i - 1) % brands.length];
    const title = `${titlePool[i % titlePool.length]} #${i}`;
    const sup = suppliers[(i - 1) % suppliers.length];

    const p = await prisma.product.create({
      data: {
        title,
        description:
          'Quality product from DaySpring—reliable, durable and designed for everyday use. Great value at the right price.',
        price: randomPrice(),
        sku: `SKU-${String(i).padStart(5, '0')}`,
        inStock: i <= TOTAL_IN_STOCK,
        status: 'PUBLISHED',
        imagesJson: productImages(i),
        communicationCost: new Prisma.Decimal(50),

        supplier: { connect: { id: sup.id } },
        category: { connect: { id: cat.id } },
        brand: { connect: { id: brand.id } },
        owner: { connect: { id: admin.id } },
      },
      select: { id: true },
    });

    createdProducts.push({ id: p.id, i });
  }

  // Pending products too
  const TOTAL_PENDING = 30;
  console.log(`⏳ Seeding ${TOTAL_PENDING} pending products…`);
  for (let j = 1; j <= TOTAL_PENDING; j++) {
    const cat = categories[(j - 1) % categories.length];
    const brand = brands[(j - 1) % brands.length];
    const title = `${titlePool[(j * 3) % titlePool.length]} (Pending #${j})`;
    const sup2 = suppliers[(j - 1) % suppliers.length];

    await prisma.product.create({
      data: {
        title,
        description: 'Awaiting moderation. Submitted by admin for review prior to publishing.',
        price: randomPrice(),
        sku: `SKU-PEND-${String(j).padStart(4, '0')}`,
        inStock: Math.random() > 0.4,
        status: 'PENDING',
        imagesJson: productImages(`pending-${j}`),
        supplier: { connect: { id: sup2.id } },
        category: { connect: { id: cat.id } },
        brand: { connect: { id: brand.id } },
        owner: { connect: { id: admin.id } },
      },
    });
  }

  console.log('🏷️  Tagging products with allowed attribute options…');
  // Link Color/Size values to products via ProductAttributeOption
  for (const { id, i } of createdProducts) {
    // Colors (1–3 allowed values)
    const colors = pickSome(colorValues, 1, 3);
    for (const c of colors) {
      await prisma.productAttributeOption.create({
        data: {
          productId: id,
          attributeId: c.attributeId,
          valueId: c.id,
        },
      });
    }

    // Sizes (0–2 allowed values)
    if (chance(0.75)) {
      const sizes = pickSome(sizeValues, 1, 2);
      for (const s of sizes) {
        await prisma.productAttributeOption.create({
          data: {
            productId: id,
            attributeId: s.attributeId,
            valueId: s.id,
          },
        });
      }
    }

    // Material text on ~40%
    if (chance(0.4)) {
      await prisma.productAttributeText.create({
        data: {
          productId: id,
          attributeId: materialAttr.id,
          value: sample(['Cotton', 'Polyester', 'Cotton/Poly Blend', 'Stainless Steel', 'BPA-free Plastic']),
        },
      });
    }
  }

  console.log('🔀 Creating random variants…');
  const variantsByProduct: Record<string, { id: string; sku: string }[]> = {};

  for (const { id, i } of createdProducts) {
    // Each product gets 0–6 variants randomly
    const makeVariants = randInt(0, 6);
    if (makeVariants === 0) continue;

    const product = await prisma.product.findUnique({ where: { id } });
    const baseSku = (product?.sku || `SKU-V-${String(i).padStart(4, '0')}`).toUpperCase();

    const localVariants: { id: string; sku: string }[] = [];

    // Use the product's allowed options (if any); fallback to global values
    const allowedColorIds = (
      await prisma.productAttributeOption.findMany({
        where: { productId: id, attributeId: colorAttr.id },
        select: { valueId: true },
      })
    ).map((r) => r.valueId);
    const allowedSizeIds = (
      await prisma.productAttributeOption.findMany({
        where: { productId: id, attributeId: sizeAttr.id },
        select: { valueId: true },
      })
    ).map((r) => r.valueId);

    const colors = (allowedColorIds.length
      ? colorValues.filter((v) => allowedColorIds.includes(v.id))
      : colorValues);

    const sizes = (allowedSizeIds.length
      ? sizeValues.filter((v) => allowedSizeIds.includes(v.id))
      : sizeValues);

    if (!colors.length || !sizes.length) {
      // If there is no overlap, just skip making variants for this product
      variantsByProduct[id] = [];
      continue;
    }

    // Generate up to makeVariants combinations
    outer: for (const c of colors) {
      for (const s of sizes) {
        if (localVariants.length >= makeVariants) break outer;

        const base = Number(product?.price || 0);
        const bump = [0, 200, 300, 500][randInt(0, 3)];
        const sku = `${baseSku}-${(c.code || c.name).toUpperCase()}-${(s.code || s.name).toUpperCase()}`;

        const v = await prisma.productVariant.create({
          data: {
            productId: id,
            sku,
            price: bump ? new Prisma.Decimal(base + bump) : undefined, // nullable => uses product price
            inStock: chance(0.8),
            imagesJson: productImages(`${i}-${sku}`),
          },
        });

        await prisma.productVariantOption.create({
          data: { variantId: v.id, attributeId: colorAttr.id, valueId: c.id },
        });
        await prisma.productVariantOption.create({
          data: { variantId: v.id, attributeId: sizeAttr.id, valueId: s.id },
        });

        localVariants.push({ id: v.id, sku });
      }
    }

    variantsByProduct[id] = localVariants;
  }

  console.log('💸 Creating supplier offers (at least one per product)…');
  const allProducts = await prisma.product.findMany({
    select: { id: true, price: true },
  });

  for (const p of allProducts) {
    const retail = Number(p.price);
    const vList = variantsByProduct[p.id] || [];

    // Always at least ONE product-wide offer
    const supForProductWide = sample(suppliers);
    const avail1 = randomAvailable();
    await prisma.supplierOffer.create({
      data: {
        supplierId: supForProductWide.id,
        productId: p.id,
        variantId: null,
        price: supplierOfferFromRetail(retail),
        currency: 'NGN',
        availableQty: avail1,            // 👈 NEW
        inStock: avail1 > 0,          // 👈 derive from available
        leadDays: randInt(1, 5),
        isActive: true,
      },
    });


    // Maybe add more product-wide offers (0–2 more)
    const extraPw = randInt(0, 2);
    const extraSuppliers = pickSome(
      suppliers.filter((s) => s.id !== supForProductWide.id),
      0,
      extraPw
    );
    for (const sup of extraSuppliers) {
      const avail2 = randomAvailable();
      await prisma.supplierOffer.create({
        data: {
          supplierId: sup.id,
          productId: p.id,
          variantId: null,
          price: supplierOfferFromRetail(retail * (0.95 + Math.random() * 0.1)),
          currency: 'NGN',
          availableQty: avail2,           // 👈 NEW
          inStock: avail2 > 0,         // 👈 derive from available
          leadDays: randInt(2, 7),
          isActive: true,
        },
      });
    }


    // Variant-specific offers for some products (~50%)
    if (vList.length && chance(0.5)) {
      const chosenVariants = pickSome(vList, 1, Math.min(3, vList.length));
      for (const v of chosenVariants) {
        const sup = sample(suppliers);
        const availV = randomAvailable();
        await prisma.supplierOffer.create({
          data: {
            supplierId: sup.id,
            productId: p.id,
            variantId: v.id,
            price: supplierOfferFromRetail(retail * (0.95 + Math.random() * 0.15)),
            currency: 'NGN',
            availableQty: availV,         // 👈 NEW
            inStock: availV > 0,       // 👈 derive from available
            leadDays: randInt(2, 8),
            isActive: true,
          },
        });
      }
    }

  }

  console.log('✅ Seed complete.');
  console.log('Users:');
  console.log('  Admin:        admin@example.com / Admin123!');
  console.log('  Super Admin:  superadmin@example.com / SuperAdmin123!');
  console.log('  Shopper:      shopper@example.com / Shopper123!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
