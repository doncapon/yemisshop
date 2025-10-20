// prisma/seed.ts
import { PrismaClient, Prisma, SupplierType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { email } from 'zod/v4';

const prisma = new PrismaClient();
const now = new Date();

/** ---------------- Helpers ---------------- */
function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Price buckets aligned with your UI filters */
const PRICE_BUCKETS = [
  { label: '₦1,000 – ₦4,999', min: 1000, max: 4999 },
  { label: '₦5,000 – ₦9,999', min: 5000, max: 9999 },
  { label: '₦10,000 – ₦99,999', min: 10000, max: 99999 },
] as const;

function randomPrice(): Prisma.Decimal {
  const r = Math.random();
  const bucket =
    r < 0.35 ? PRICE_BUCKETS[0] : r < 0.75 ? PRICE_BUCKETS[1] : PRICE_BUCKETS[2];
  const value = randInt(bucket.min, bucket.max);
  return new Prisma.Decimal(value);
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

/** ---------------- Seed Script ---------------- */
async function main() {
  console.log('🧹 Clearing existing data …');

  // FK-safe clear: remove most dependent tables first
  await prisma.$transaction(
    [
      prisma.productVariantOption.deleteMany(),
      prisma.productVariant.deleteMany(),
      prisma.productAttributeValue?.deleteMany?.() as any, // only if you added the table
      prisma.productAttributeText?.deleteMany?.() as any,  // only if you added the table
      prisma.purchaseOrderItem.deleteMany(),
      prisma.payment.deleteMany(),
      prisma.orderItem.deleteMany(),
      prisma.purchaseOrder.deleteMany(),
      prisma.order.deleteMany(),
      prisma.favorite.deleteMany(),
      prisma.wishlist.deleteMany(),
      prisma.product.deleteMany(),
      prisma.attributeValue.deleteMany(),
      prisma.attribute.deleteMany(),
      prisma.brand.deleteMany(),
      prisma.category.deleteMany(),
      prisma.supplier.deleteMany(),
      prisma.user.deleteMany(),
      prisma.address.deleteMany(),
    ].filter(Boolean)
  );

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

  const superAdmin = await prisma.user.create({
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

  const shopper = await prisma.user.create({
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
  // Create a few suppliers and reuse them across products
  const suppliers = await prisma.$transaction([
    prisma.supplier.create({
      data: {
        name: 'YemiShop Wholesale',
        type: SupplierType.PHYSICAL,
        status: 'ACTIVE',
        contactEmail: 'wholesale@yemishop.com',
        whatsappPhone: '+2348100000000',
        payoutPctInt: 70,
      },
    }),
    prisma.supplier.create({
      data: {
        name: 'MarketHub NG',
        type: SupplierType.PHYSICAL,
        status: 'ACTIVE',
        contactEmail: 'contact@markethub.ng',
        whatsappPhone: '+2348100000005',
        payoutPctInt: 65,
      },
    }),
    prisma.supplier.create({
      data: {
        name: 'PrimeMall Distributors',
        type: SupplierType.ONLINE,
        status: 'ACTIVE',
        contactEmail: 'support@primemall.ng',
        whatsappPhone: '+2348100000006',
        payoutPctInt: 72,
      },
    }),
  ]);


  console.log('🏷️  Seeding categories (with slugs)…');
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
  // Attributes: Color (SELECT), Size (SELECT), Material (TEXT-like via ProductAttributeText when used)
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
  ]);

  const sizeValues = await prisma.$transaction([
    prisma.attributeValue.create({ data: { attributeId: sizeAttr.id, name: 'M', code: 'M', position: 1 } }),
    prisma.attributeValue.create({ data: { attributeId: sizeAttr.id, name: 'L', code: 'L', position: 2 } }),
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

  // Create all PUBLISHED products first (with inStock)
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
          'Quality product from YemiShop—reliable, durable and designed for everyday use. Great value at the right price.',
        price: randomPrice(),
        sku: `SKU-${String(i).padStart(5, '0')}`,
        inStock: i <= TOTAL_IN_STOCK,
        vatFlag: true,
        status: 'PUBLISHED',
        imagesJson: productImages(i),
        supplier: { connect: { id: sup.id } },        // 👈 attach supplier
        category: { connect: { id: cat.id } },
        brand: { connect: { id: brand.id } },
        owner: { connect: { id: admin.id } },         // 👈 connect by id (email not needed)
      },
      select: { id: true },
    });


    createdProducts.push({ id: p.id, i });
  }

  /** ---------------------------------------------------------
   *  NEW: Add 30 products with status 'PENDING' for moderation
   * --------------------------------------------------------- */
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
        description:
          'Awaiting moderation. Submitted by admin for review prior to publishing.',
        price: randomPrice(),
        sku: `SKU-PEND-${String(j).padStart(4, '0')}`,
        inStock: Math.random() > 0.4,
        vatFlag: true,
        status: 'PENDING',
        imagesJson: productImages(`pending-${j}`),
        supplier: { connect: { id: sup2.id } },        // 👈 attach supplier
        category: { connect: { id: cat.id } },
        brand: { connect: { id: brand.id } },
        owner: { connect: { id: admin.id } },          // 👈 connect by id
      },
    });


  }

  console.log('🏷️  Tagging some products with attributes…');
  // If you’ve added ProductAttributeValue / ProductAttributeText models:
  // Safe-guard calls when tables exist
  const haveAttrValueTable =
    typeof (prisma as any).productAttributeValue?.create === 'function';
  const haveAttrTextTable =
    typeof (prisma as any).productAttributeText?.create === 'function';

  if (haveAttrValueTable) {
    const [red, blue] = colorValues;
    const [sizeM, sizeL] = sizeValues;

    // Tag first 20 *published* products with Color/Size
    for (const { id, i } of createdProducts.slice(0, 20)) {
      const color = i % 2 === 0 ? red : blue;
      const size = i % 3 === 0 ? sizeL : sizeM;

      await prisma.productAttributeValue.create({
        data: { productId: id, attributeId: colorAttr.id, valueId: color.id },
      });
      await prisma.productAttributeValue.create({
        data: { productId: id, attributeId: sizeAttr.id, valueId: size.id },
      });
    }
  }

  if (haveAttrTextTable) {
    // Add material text for a few *published* products (illustrative)
    for (const { id } of createdProducts.slice(0, 6)) {
      await prisma.productAttributeText.create({
        data: {
          productId: id,
          attributeId: materialAttr.id,
          value: 'Cotton/Polyester Blend',
        },
      });
    }
  }

  console.log('🔀 Creating variants (Color × Size) for first 12 products…');
  // Requires ProductVariant & ProductVariantOption tables
  const canVariants =
    typeof (prisma as any).productVariant?.create === 'function' &&
    typeof (prisma as any).productVariantOption?.create === 'function';

  if (canVariants) {
    // Create 2×2 variants: [Red, Blue] × [M, L]
    const [red, blue] = colorValues;
    const [sizeM, sizeL] = sizeValues;

    const productsForVariants = createdProducts.slice(0, 12);
    for (const { id, i } of productsForVariants) {
      const baseSku = `SKU-V-${String(i).padStart(4, '0')}`;

      // four combinations
      const combos = [
        { color: red, size: sizeM, sku: `${baseSku}-RED-M`, priceBump: 0, inStock: true },
        { color: red, size: sizeL, sku: `${baseSku}-RED-L`, priceBump: 300, inStock: true },
        { color: blue, size: sizeM, sku: `${baseSku}-BLU-M`, priceBump: 200, inStock: true },
        { color: blue, size: sizeL, sku: `${baseSku}-BLU-L`, priceBump: 500, inStock: (i % 3) !== 0 },
      ];

      // Fetch product to read base price for an optional variant price override
      const product = await prisma.product.findUnique({ where: { id } });
      const basePrice = Number(product?.price || 0);

      for (const [idx, c] of combos.entries()) {
        const variant = await prisma.productVariant.create({
          data: {
            productId: id,
            sku: c.sku,
            price: c.priceBump ? new Prisma.Decimal(basePrice + c.priceBump) : undefined,
            inStock: c.inStock,
            imagesJson: productImages(`${i}-${idx + 1}`),
          },
        });

        await prisma.productVariantOption.create({
          data: {
            variantId: variant.id,
            attributeId: colorAttr.id,
            valueId: c.color.id,
          },
        });

        await prisma.productVariantOption.create({
          data: {
            variantId: variant.id,
            attributeId: sizeAttr.id,
            valueId: c.size.id,
          },
        });
      }
    }
  } else {
    console.log('⚠️  Variant tables not found. Skipping variant creation.');
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
