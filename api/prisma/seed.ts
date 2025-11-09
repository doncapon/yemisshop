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

function pickSome<T>(arr: T[], min = 1, max = 3): T[] {
  if (!arr.length) return [];
  const n = Math.max(min, Math.min(max, randInt(min, max), arr.length));
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) {
    const idx = randInt(0, copy.length - 1);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

/** Supplier available stock: keep between 1 and 29 for usable offers */
function randomAvailable() {
  return randInt(1, 29);
}

const PRICE_BUCKETS = [
  { min: 1000, max: 4999 },
  { min: 5000, max: 9999 },
  { min: 10000, max: 99999 },
] as const;

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
    `https://picsum.photos/seed/dayspring-${seed}/800/600`,
    `https://picsum.photos/seed/dayspring-${seed}-b/800/600`,
    `https://picsum.photos/seed/dayspring-${seed}-c/800/600`,
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

  // Order of deletes respects FKs (children -> parents)
  await prisma.$transaction(
    [
      prisma.orderItemProfit.deleteMany(),
      prisma.orderComms.deleteMany(),
      prisma.orderCoupon.deleteMany(),
      prisma.coupon.deleteMany(),

      prisma.paymentEvent.deleteMany(),
      prisma.orderActivity.deleteMany(),
      prisma.purchaseOrderItem.deleteMany(),
      prisma.purchaseOrder.deleteMany(),

      prisma.orderItem.deleteMany(),
      prisma.payment.deleteMany(),
      prisma.order.deleteMany(),

      prisma.supplierOffer.deleteMany(),
      prisma.productVariantOption.deleteMany(),
      prisma.productVariant.deleteMany(),

      prisma.productAttributeText.deleteMany(),
      prisma.productAttributeOption.deleteMany(),

      prisma.favorite.deleteMany(),
      prisma.wishlist.deleteMany(),
      prisma.product.deleteMany(),

      prisma.attributeValue.deleteMany(),
      prisma.attribute.deleteMany(),
      prisma.brand.deleteMany(),
      prisma.category.deleteMany(),

      prisma.setting.deleteMany(),

      prisma.supplier.deleteMany(),
      prisma.emailVerifyToken.deleteMany(),
      prisma.otp.deleteMany(),
      prisma.user.deleteMany(),
      prisma.address.deleteMany(),
    ].filter(Boolean) as any
  );

  console.log('⚙️  Seeding settings…');
  try {
    await prisma.setting.createMany({
      data: [
        { key: 'taxMode', value: 'INCLUDED', isPublic: true },
        { key: 'taxRatePct', value: '7.5', isPublic: true },
        { key: 'commsUnitCostNGN', value: '100', isPublic: false },
      ],
      skipDuplicates: true,
    });
  } catch {
    /* table might not exist; ignore */
  }

  console.log('👥 Seeding users…');
  const adminPwd = await bcrypt.hash('Admin123!', 10);
  const superAdminPwd = await bcrypt.hash('SuperAdmin123!', 10);
  const shopperPwd = await bcrypt.hash('Shopper123!', 10);

  // Addresses
  const [adminHome, adminShip] = await Promise.all([
    makeAddress({
      houseNumber: '10',
      streetName: 'Admin Crescent',
      city: 'Ikeja',
      state: 'Lagos',
    }),
    makeAddress({
      houseNumber: '12',
      streetName: 'Admin Crescent',
      city: 'Ikeja',
      state: 'Lagos',
    }),
  ]);
  const [superAdminHome, superAdminShip] = await Promise.all([
    makeAddress({
      houseNumber: '22B',
      streetName: 'Leadership Ave',
      city: 'Abuja',
      state: 'FCT',
    }),
    makeAddress({
      houseNumber: '5',
      streetName: 'Steward Road',
      city: 'Abuja',
      state: 'FCT',
    }),
  ]);
  const [shopperHome, shopperShip] = await Promise.all([
    makeAddress({
      houseNumber: '7',
      streetName: 'Market Lane',
      city: 'Ibadan',
      state: 'Oyo',
    }),
    makeAddress({
      houseNumber: '9',
      streetName: 'Market Lane',
      city: 'Ibadan',
      state: 'Oyo',
    }),
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
        name: 'Dayspring Wholesale',
        type: SupplierType.PHYSICAL,
        status: 'ACTIVE',
        contactEmail: 'wholesale@dayspring.com',
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
    categoryNames.map((name, idx) =>
      prisma.category.create({
        data: {
          name,
          slug: name
            .toLowerCase()
            .replace(/&/g, 'and')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, ''),
          isActive: true,
          position: idx,
        },
      })
    )
  );

  console.log('🏷️  Seeding brands…');
  const brandSeeds = ['DaySpring', 'NaijaTech', 'GreenFarm', 'FitLife'];
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

  console.log('🏷️  Seeding attributes & values (Color, Size, Weight, Volume)…');

  // Core selectable attributes
  const colorAttr = await prisma.attribute.create({
    data: { name: 'Color', type: 'SELECT', isActive: true },
  });
  const sizeAttr = await prisma.attribute.create({
    data: { name: 'Size', type: 'SELECT', isActive: true },
  });
  const weightAttr = await prisma.attribute.create({
    data: { name: 'Weight', type: 'SELECT', isActive: true },
  });
  const volumeAttr = await prisma.attribute.create({
    data: { name: 'Volume', type: 'SELECT', isActive: true },
  });

  // Optional descriptive attribute
  const materialAttr = await prisma.attribute.create({
    data: { name: 'Material', type: 'TEXT', isActive: true },
  });

  const colorValues = await prisma.$transaction([
    prisma.attributeValue.create({
      data: { attributeId: colorAttr.id, name: 'Red', code: 'RED', position: 1 },
    }),
    prisma.attributeValue.create({
      data: { attributeId: colorAttr.id, name: 'Blue', code: 'BLU', position: 2 },
    }),
    prisma.attributeValue.create({
      data: { attributeId: colorAttr.id, name: 'Black', code: 'BLK', position: 3 },
    }),
    prisma.attributeValue.create({
      data: { attributeId: colorAttr.id, name: 'Green', code: 'GRN', position: 4 },
    }),
    prisma.attributeValue.create({
      data: { attributeId: colorAttr.id, name: 'White', code: 'WHT', position: 5 },
    }),
  ]);

  const sizeValues = await prisma.$transaction([
    prisma.attributeValue.create({
      data: { attributeId: sizeAttr.id, name: 'S', code: 'S', position: 1 },
    }),
    prisma.attributeValue.create({
      data: { attributeId: sizeAttr.id, name: 'M', code: 'M', position: 2 },
    }),
    prisma.attributeValue.create({
      data: { attributeId: sizeAttr.id, name: 'L', code: 'L', position: 3 },
    }),
    prisma.attributeValue.create({
      data: { attributeId: sizeAttr.id, name: 'XL', code: 'XL', position: 4 },
    }),
  ]);

  const weightValues = await prisma.$transaction([
    prisma.attributeValue.create({
      data: { attributeId: weightAttr.id, name: '250g', code: '250G', position: 1 },
    }),
    prisma.attributeValue.create({
      data: { attributeId: weightAttr.id, name: '500g', code: '500G', position: 2 },
    }),
    prisma.attributeValue.create({
      data: { attributeId: weightAttr.id, name: '1kg', code: '1KG', position: 3 },
    }),
  ]);

  const volumeValues = await prisma.$transaction([
    prisma.attributeValue.create({
      data: { attributeId: volumeAttr.id, name: '250ml', code: '250ML', position: 1 },
    }),
    prisma.attributeValue.create({
      data: { attributeId: volumeAttr.id, name: '500ml', code: '500ML', position: 2 },
    }),
    prisma.attributeValue.create({
      data: { attributeId: volumeAttr.id, name: '1L', code: '1L', position: 3 },
    }),
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

  const TOTAL_LIVE = 50;
  const TOTAL_IN_STOCK = 60;
  const TOTAL_OUT_OF_STOCK = 30;
  const TOTAL = TOTAL_IN_STOCK + TOTAL_OUT_OF_STOCK;

  type CreatedProduct = { id: string; i: number };
  const createdProducts: CreatedProduct[] = [];
  function randomPositiveQty(min = 1, max = 20) {
    return randInt(min, max);
  }

  for (let i = 1; i <= TOTAL; i++) {
    const cat = categories[(i - 1) % categories.length];
    const brand = brands[(i - 1) % brands.length];
    const title = `${titlePool[i % titlePool.length]} #${i}`;
    const sup = suppliers[(i - 1) % suppliers.length];

    const shouldBeLive = Math.random() < 0.9; // ~90% LIVE

    const p = await prisma.product.create({
      data: {
        title,
        description:
          'Quality product from DaySpring—reliable, durable and designed for everyday use. Great value at the right price.',
        price: randomPrice(),
        sku: `SKU-${String(i).padStart(5, '0')}`,
        inStock: i <= TOTAL_IN_STOCK,
        status: shouldBeLive ? 'LIVE' : 'PUBLISHED',
        imagesJson: productImages(i),
        communicationCost: new Prisma.Decimal(50),

        // 👇 ensure LIVE products get > 0 availableQty
        availableQty: shouldBeLive ? randomPositiveQty() : 0,

        supplier: { connect: { id: sup.id } },
        category: { connect: { id: cat.id } },
        brand: { connect: { id: brand.id } },
        owner: { connect: { id: admin.id } },
      },
      select: { id: true },
    });

    createdProducts.push({ id: p.id, i });
  }


  // Extra pending products (no need to be super rich here)
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
          'Awaiting moderation. Submitted for review prior to publishing.',
        price: randomPrice(),
        sku: `SKU-PEND-${String(j).padStart(4, '0')}`,
        inStock: chance(0.6),
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
  // Link allowed values (ProductAttributeOption) as a superset for variants
  for (const { id } of createdProducts) {
    // Colors: 1–4
    for (const c of pickSome(colorValues, 1, 4)) {
      await prisma.productAttributeOption.create({
        data: {
          productId: id,
          attributeId: c.attributeId,
          valueId: c.id,
        },
      });
    }

    // Sizes: maybe
    if (chance(0.6)) {
      for (const s of pickSome(sizeValues, 1, 3)) {
        await prisma.productAttributeOption.create({
          data: {
            productId: id,
            attributeId: s.attributeId,
            valueId: s.id,
          },
        });
      }
    }

    // Weight: maybe
    if (chance(0.4)) {
      for (const w of pickSome(weightValues, 1, 2)) {
        await prisma.productAttributeOption.create({
          data: {
            productId: id,
            attributeId: w.attributeId,
            valueId: w.id,
          },
        });
      }
    }

    // Volume: maybe
    if (chance(0.4)) {
      for (const v of pickSome(volumeValues, 1, 2)) {
        await prisma.productAttributeOption.create({
          data: {
            productId: id,
            attributeId: v.attributeId,
            valueId: v.id,
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
          value: sample([
            'Cotton',
            'Polyester',
            'Cotton/Poly Blend',
            'Stainless Steel',
            'BPA-free Plastic',
            'Premium Plastic',
          ]),
        },
      });
    }
  }

  console.log('🔀 Creating variants with mixed attribute combos for ~half of products…');

  const variantsByProduct: Record<string, { id: string; sku: string }[]> = {};

  for (const { id, i } of createdProducts) {
    // Only about half of products will have variants
    if (!chance(0.55)) {
      variantsByProduct[id] = [];
      continue;
    }

    const product = await prisma.product.findUnique({
      where: { id },
      select: { price: true, sku: true },
    });
    if (!product) {
      variantsByProduct[id] = [];
      continue;
    }

    const baseSku = (product.sku || `SKU-V-${String(i).padStart(4, '0')}`).toUpperCase();
    const basePrice = Number(product.price || 0);

    // Read allowed options back
    const paos = await prisma.productAttributeOption.findMany({
      where: { productId: id },
      select: { attributeId: true, valueId: true },
    });

    const allowedByAttr = paos.reduce<Record<string, string[]>>((acc, row) => {
      (acc[row.attributeId] ||= []).push(row.valueId);
      return acc;
    }, {});

    const allowedColors = allowedByAttr[colorAttr.id] || colorValues.map((v) => v.id);
    const allowedSizes = allowedByAttr[sizeAttr.id] || [];
    const allowedWeights = allowedByAttr[weightAttr.id] || [];
    const allowedVolumes = allowedByAttr[volumeAttr.id] || [];

    const localVariants: { id: string; sku: string }[] = [];
    const maxVariants = randInt(2, 6);

    // We’ll build variants with varied combos
    const makeVariantCombo = async (
      attrs: { attrId: string; values: string[] }[]
    ) => {
      if (!attrs.length) return;

      // pick one value per attr
      const chosen: { attrId: string; valueId: string }[] = [];
      for (const a of attrs) {
        if (!a.values.length) return;
        chosen.push({ attrId: a.attrId, valueId: sample(a.values) });
      }

      // Ensure uniqueness by SKU
      const skuParts = chosen.map((c) => {
        const val = c.valueId;
        return val.slice(0, 4).toUpperCase();
      });
      const sku = `${baseSku}-${skuParts.join('-')}`;

      if (localVariants.some((lv) => lv.sku === sku)) return;

      // small random bump
      const bump = [0, 200, 300, 500][randInt(0, 3)];
      const finalPrice = Math.max(500, basePrice + bump);

      const variant = await prisma.productVariant.create({
        data: {
          productId: id,
          sku,
          price: bump ? new Prisma.Decimal(finalPrice) : null, // if null, frontend can fallback to product price
          inStock: chance(0.85),
          imagesJson: productImages(`${i}-${sku}`),
          availableQty: randInt(5, 40),
        },
      });

      for (const c of chosen) {
        await prisma.productVariantOption.create({
          data: {
            variantId: variant.id,
            attributeId: c.attrId,
            valueId: c.valueId,
            // Some bumps on attribute values (not strictly required)
            priceBump:
              bump && chance(0.3)
                ? new Prisma.Decimal(randInt(50, bump))
                : null,
          },
        });
      }

      localVariants.push({ id: variant.id, sku });
    };

    // Generate a mix:
    // Some Color-only
    if (allowedColors.length && localVariants.length < maxVariants && chance(0.7)) {
      await makeVariantCombo([{ attrId: colorAttr.id, values: allowedColors }]);
    }

    // Color + Size
    if (
      allowedColors.length &&
      allowedSizes.length &&
      localVariants.length < maxVariants &&
      chance(0.9)
    ) {
      await makeVariantCombo([
        { attrId: colorAttr.id, values: allowedColors },
        { attrId: sizeAttr.id, values: allowedSizes },
      ]);
    }

    // Color + Size + Weight
    if (
      allowedColors.length &&
      allowedSizes.length &&
      allowedWeights.length &&
      localVariants.length < maxVariants &&
      chance(0.6)
    ) {
      await makeVariantCombo([
        { attrId: colorAttr.id, values: allowedColors },
        { attrId: sizeAttr.id, values: allowedSizes },
        { attrId: weightAttr.id, values: allowedWeights },
      ]);
    }

    // Size + Volume
    if (
      allowedSizes.length &&
      allowedVolumes.length &&
      localVariants.length < maxVariants &&
      chance(0.5)
    ) {
      await makeVariantCombo([
        { attrId: sizeAttr.id, values: allowedSizes },
        { attrId: volumeAttr.id, values: allowedVolumes },
      ]);
    }

    variantsByProduct[id] = localVariants;
  }
console.log('💸 Creating supplier offers (variant-rich & ready)…');

const allProducts = await prisma.product.findMany({
  select: { id: true, price: true, status: true },
});

// To respect unique(supplierId, productId, variantId)
const usedOfferKeys = new Set<string>(); // `${supplierId}::${productId}::${variantId || 'NULL'}`

for (const p of allProducts) {
  const retail = Number(p.price) || 5000;
  const vList = variantsByProduct[p.id] || [];
  const hasVariants = vList.length > 0;
  const isLive = p.status === 'LIVE';

  // Helper to safely create an offer without violating the unique constraint
  const createOffer = async (opts: {
    supplierId: string;
    variantId: string | null;
    baseRetail?: number;
    leadMin?: number;
    leadMax?: number;
  }) => {
    const key = `${opts.supplierId}::${p.id}::${opts.variantId || 'NULL'}`;
    if (usedOfferKeys.has(key)) return null;

    const baseRetail = opts.baseRetail ?? retail;
    const leadMin = opts.leadMin ?? 1;
    const leadMax = opts.leadMax ?? 7;

    const availableQty = randomPositiveQty(1, 29); // always > 0 for seeded offers
    const price = supplierOfferFromRetail(
      baseRetail * (0.95 + Math.random() * 0.15)
    );

    const offer = await prisma.supplierOffer.create({
      data: {
        supplierId: opts.supplierId,
        productId: p.id,
        variantId: opts.variantId,
        price,
        currency: 'NGN',
        availableQty,
        inStock: true,
        leadDays: randInt(leadMin, leadMax),
        isActive: true,
      },
    });

    usedOfferKeys.add(key);
    return offer;
  };

  if (hasVariants) {
    // Use lots of variants 🎯
    // 60–100% of variants get at least one offer
    const shuffledVariants = [...vList].sort(() => Math.random() - 0.5);
    const targetCount = Math.max(
      1,
      Math.round(shuffledVariants.length * (0.6 + Math.random() * 0.4))
    );
    const chosen = shuffledVariants.slice(0, targetCount);

    // For each chosen variant, create 1–2 offers from different suppliers
    for (const { id: variantId } of chosen) {
      const offerSuppliers = pickSome(suppliers, 1, 2);
      for (const sup of offerSuppliers) {
        await createOffer({
          supplierId: sup.id,
          variantId,
          baseRetail: retail,
          leadMin: 2,
          leadMax: 10,
        });
      }
    }

    // Optional: also 0–2 product-wide offers (no variantId)
    const extraGlobalOffers = randInt(0, 2);
    const globals = pickSome(suppliers, 0, extraGlobalOffers);
    for (const sup of globals) {
      await createOffer({
        supplierId: sup.id,
        variantId: null,
        baseRetail: retail * (0.9 + Math.random() * 0.2),
        leadMin: 1,
        leadMax: 5,
      });
    }
  } else {
    // No variants for this product → only product-wide offers
    // Make sure LIVE products are definitely purchasable
    const offerSuppliers = pickSome(suppliers, isLive ? 1 : 0, 3);
    if (offerSuppliers.length === 0) {
      // Fallback: always at least one
      offerSuppliers.push(sample(suppliers));
    }

    for (const sup of offerSuppliers) {
      await createOffer({
        supplierId: sup.id,
        variantId: null,
        baseRetail: retail,
        leadMin: 1,
        leadMax: 7,
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
