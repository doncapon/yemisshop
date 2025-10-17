// prisma/seed.ts
import { PrismaClient, Prisma, SupplierType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const now = new Date();

/** Random helpers */
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

function productImages(i: number): string[] {
  return [
    `https://picsum.photos/seed/yemishop-${i}/800/600`,
    `https://picsum.photos/seed/yemishop-${i}-b/800/600`,
    `https://picsum.photos/seed/yemishop-${i}-c/800/600`,
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

async function main() {
  console.log('🧹 Clearing existing data …');

  // Delete in FK-safe order
  await prisma.$transaction([
    prisma.purchaseOrderItem.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.purchaseOrder.deleteMany(),
    prisma.order.deleteMany(),
    prisma.favorite.deleteMany(),
    prisma.wishlist.deleteMany(),
    prisma.product.deleteMany(),
    prisma.category.deleteMany(),
    prisma.supplier.deleteMany(),
    prisma.user.deleteMany(),
    prisma.address.deleteMany(),
  ]);

  console.log('👥 Seeding users…');
  const adminPwd = await bcrypt.hash('Admin123!', 10);
  const superAdminPwd = await bcrypt.hash('SuperAdmin123!', 10);
  const shopperPwd = await bcrypt.hash('Shopper123!', 10); // 👈 new

  // Create addresses first (we’ll attach to users)
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

  // ✅ Shopper addresses
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

  // ADMIN
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

  // SUPER_ADMIN
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

  // 👤 SHOPPER (verified)
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

  console.log('🏭 Seeding supplier (without user)…');
  // Create a supplier WITHOUT linking to any user (userId is optional in your schema)
  const supplier = await prisma.supplier.create({
    data: {
      name: 'YemiShop Wholesale',
      type: SupplierType.PHYSICAL,
      status: 'ACTIVE',
      contactEmail: 'wholesale@yemishop.com',
      whatsappPhone: '+2348100000000',
      payoutPctInt: 70,
    },
  });

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
    categoryNames.map((name) => prisma.category.create({ data: { name } }))
  );

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

  // First 60: in stock (stock: true)
  for (let i = 1; i <= TOTAL_IN_STOCK; i++) {
    const cat = categories[(i - 1) % categories.length];
    const title = `${titlePool[i % titlePool.length]} #${i}`;

    await prisma.product.create({
      data: {
        title,
        description:
          'Quality product from YemiShop—reliable, durable and designed for everyday use. Great value at the right price.',
        price: randomPrice(),
        sku: `SKU-${String(i).padStart(5, '0')}`,
        stock: true, // ✅ boolean
        vatFlag: true,
        status: 'PUBLISHED',
        imagesJson: productImages(i),
        supplier: { connect: { id: supplier.id } },
        category: { connect: { id: cat.id } },
        categoryName: cat.name,
      },
    });
  }

  // Next 30: out of stock (stock: false)
  for (let j = TOTAL_IN_STOCK + 1; j <= TOTAL_IN_STOCK + TOTAL_OUT_OF_STOCK; j++) {
    const cat = categories[(j - 1) % categories.length];
    const title = `${titlePool[j % titlePool.length]} #${j}`;

    await prisma.product.create({
      data: {
        title,
        description:
          'Quality product from YemiShop—reliable, durable and designed for everyday use. Great value at the right price.',
        price: randomPrice(),
        sku: `SKU-${String(j).padStart(5, '0')}`,
        stock: false, // ✅ boolean
        vatFlag: true,
        status: 'PUBLISHED',
        imagesJson: productImages(j),
        supplier: { connect: { id: supplier.id } },
        category: { connect: { id: cat.id } },
        categoryName: cat.name,
      },
    });
  }

  console.log('✅ Seed complete.');
  console.log('Users:');
  console.log('  Admin:        admin@example.com / Shopper123!');
  console.log('  Super Admin:  superadmin@example.com / Shopper123!');
  console.log('  Shopper:      shopper@example.com / Shopper123!'); // 👈 new
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
