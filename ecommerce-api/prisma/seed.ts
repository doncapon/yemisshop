// prisma/seed.ts
import { prisma } from '../src/lib/prisma.js';
import bcrypt from 'bcryptjs';

async function main() {
  // Admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      password: await bcrypt.hash('Admin123!', 10),
      role: 'ADMIN',
      name: 'Admin'
    }
  });

  // Supplier user
  const supplierUser = await prisma.user.upsert({
    where: { email: 'supplier@example.com' },
    update: {},
    create: {
      email: 'supplier@example.com',
      password: await bcrypt.hash('Supplier123!', 10),
      role: 'SUPPLIER',
      name: 'Acme Owner'
    }
  });

  // Shopper
  const shopper = await prisma.user.upsert({
    where: { email: 'shopper@example.com' },
    update: {},
    create: {
      email: 'shopper@example.com',
      password: await bcrypt.hash('Shopper123!', 10),
      role: 'SHOPPER',
      name: 'Jane Shopper',
      phone: '+2348012345678',
      address: '12 Palm Street, Lagos'
    }
  });

  // Suppliers
  const physical = await prisma.supplier.create({
    data: {
      name: 'MarketHub PHYSICAL',
      whatsappPhone: '+447916244852',
      type: 'PHYSICAL',
      payoutPctInt: 70,            // integer percent
      userId: supplierUser.id
    }
  });

  const online = await prisma.supplier.create({
    data: {
      name: 'DropShip ONLINE',
      whatsappPhone: '+447916244852',
      type: 'ONLINE',
      apiBaseUrl: 'https://supplier.example.com/api',
      apiAuthType: 'BEARER',
      apiKey: 'demo-api-key'
    }
  });

  // Category (use upsert to avoid unique conflicts if you re-run seed)
  const cat = await prisma.category.upsert({
    where: { name: 'Electronics' },
    update: {},
    create: { name: 'Electronics' }
  });

  // Products (use new fields: priceMinor, imagesJson, commissionPctInt)
  await prisma.product.createMany({
    data: [
      {
        id: 'p1',
        title: 'Wireless Headphones',
        description: 'Over-ear, noise cancelling.',
        priceMinor: 999900, // ₦9,999.00 stored as minor units
        sku: 'WH-001',
        stock: 25,
        vatFlag: true,
        status: 'PUBLISHED',
        imagesJson: ['https://picsum.photos/seed/a/400/300'] as any, // Json field
        categoryId: cat.id,
        supplierId: physical.id
      },
      {
        id: 'p2',
        title: 'Online Gift Card',
        description: 'Instant code (ONLINE route)',
        priceMinor: 500000, // ₦5,000.00
        sku: 'GC-005',
        stock: 999,
        vatFlag: true,
        status: 'PUBLISHED',
        imagesJson: ['https://picsum.photos/seed/b/400/300'] as any,
        categoryId: cat.id,
        supplierId: online.id,
        supplierTypeOverride: 'ONLINE',
        commissionPctInt: 30
      }
    ]
  });

  console.log('Seed OK:', {
    admin: admin.email,
    supplier: supplierUser.email,
    shopper: shopper.email
  });
}

main().finally(() => prisma.$disconnect());
