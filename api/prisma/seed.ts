// prisma/seed.ts
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

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

/** Pick a random price across buckets, with a slight bias towards mid bucket */
function randomPrice(): Prisma.Decimal {
  // Weighted pick: 35% low, 40% mid, 25% high
  const r = Math.random();
  const bucket =
    r < 0.35 ? PRICE_BUCKETS[0] : r < 0.75 ? PRICE_BUCKETS[1] : PRICE_BUCKETS[2];
  const value = randInt(bucket.min, bucket.max);
  return new Prisma.Decimal(value);
}

function productImages(i: number): string[] {
  // Multiple images per product
  return [
    `https://picsum.photos/seed/yemishop-${i}/800/600`,
    `https://picsum.photos/seed/yemishop-${i}-b/800/600`,
    `https://picsum.photos/seed/yemishop-${i}-c/800/600`,
  ];
}

async function main() {
  console.log('🧹 Clearing existing data (products, categories, suppliers, users)…');
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.supplier.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('👥 Seeding users…');
  const adminPwd = await bcrypt.hash('Admin123!', 10);
  const supplierPwd = await bcrypt.hash('Supplier123!', 10);
  const shopperPwd = await bcrypt.hash('Shopper123!', 10);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      password: adminPwd,
      role: 'ADMIN',
      firstName: 'Site',
      lastName: 'Admin',
      status: 'VERIFIED',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
  });

  const supplierUser = await prisma.user.create({
    data: {
      email: 'supplier@example.com',
      password: supplierPwd,
      role: 'SUPPLIER',
      firstName: 'Oluchi',
      lastName: 'Supplies',
      status: 'VERIFIED',
      emailVerifiedAt: new Date(),
    },
  });

  const shopper = await prisma.user.create({
    data: {
      email: 'shopper@example.com',
      password: shopperPwd,
      role: 'SHOPPER',
      firstName: 'Yemi',
      lastName: 'Shopper',
      status: 'VERIFIED',
      emailVerifiedAt: new Date(),
    },
  });

  console.log('🏭 Seeding supplier…');
  const supplier = await prisma.supplier.create({
    data: {
      name: 'YemiShop Wholesale',
      type: 'PHYSICAL',
      status: 'ACTIVE',
      contactEmail: 'wholesale@yemishop.com',
      whatsappPhone: '+2348100000000',
      payoutPctInt: 70,
      user: { connect: { id: supplierUser.id } },
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

  console.log('📦 Seeding products (60)…');
  const TOTAL_PRODUCTS = 60;

  for (let i = 1; i <= TOTAL_PRODUCTS; i++) {
    const cat = categories[(i - 1) % categories.length];
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
    const title = titlePool[i % titlePool.length] + ` #${i}`;

    const price = randomPrice();
    const sku = `SKU-${String(i).padStart(5, '0')}`;
    const stock = 20 + (i % 40);
    const images = productImages(i);

    await prisma.product.create({
      data: {
        title,
        description:
          'Quality product from YemiShop—reliable, durable and designed for everyday use. Great value at the right price.',
        price,
        sku,
        stock,
        vatFlag: true,
        status: 'PUBLISHED',
        imagesJson: images,
        supplier: { connect: { id: supplier.id } },
        category: { connect: { id: cat.id } },
        categoryName: cat.name,
      },
    });
  }

  console.log('✅ Seed complete.');
  console.log('Users:');
  console.log('  Admin:    admin@example.com / Admin123!');
  console.log('  Supplier: supplier@example.com / Supplier123!');
  console.log('  Shopper:  shopper@example.com / Shopper123!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
