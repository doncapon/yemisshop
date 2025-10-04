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
      name: 'Admin',
    },
  });

  // Supplier user (owner of the physical supplier)
  const supplierUser = await prisma.user.upsert({
    where: { email: 'supplier@example.com' },
    update: {},
    create: {
      email: 'supplier@example.com',
      password: await bcrypt.hash('Supplier123!', 10),
      role: 'SUPPLIER',
      name: 'Acme Owner',
    },
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
      address: '12 Palm Street, Lagos',
    },
  });

  // Suppliers
  // PHYSICAL: upsert by userId (unique)
  const physical = await prisma.supplier.upsert({
    where: { userId: supplierUser.id }, // ✅ unique selector
    update: {
      name: 'MarketHub PHYSICAL',
      whatsappPhone: '+447916244852',
      type: 'PHYSICAL',
      payoutPctInt: 70,
      status: 'ACTIVE',
    },
    create: {
      name: 'MarketHub PHYSICAL',
      whatsappPhone: '+447916244852',
      type: 'PHYSICAL',
      payoutPctInt: 70,
      status: 'ACTIVE',
      userId: supplierUser.id,
    },
  });

  // ONLINE: upsert by a fixed id (we control it)
  const online = await prisma.supplier.upsert({
    where: { id: 'supplier-online' }, // ✅ fixed id acts as unique
    update: {
      name: 'DropShip ONLINE',
      whatsappPhone: '+447916244852',
      type: 'ONLINE',
      apiBaseUrl: 'https://supplier.example.com/api',
      apiAuthType: 'BEARER',
      apiKey: 'demo-api-key',
      status: 'ACTIVE',
    },
    create: {
      id: 'supplier-online',
      name: 'DropShip ONLINE',
      whatsappPhone: '+447916244852',
      type: 'ONLINE',
      apiBaseUrl: 'https://supplier.example.com/api',
      apiAuthType: 'BEARER',
      apiKey: 'demo-api-key',
      status: 'ACTIVE',
    },
  });

  // Category
  const cat = await prisma.category.upsert({
    where: { name: 'Electronics' },
    update: {},
    create: { name: 'Electronics' },
  });

  // Products (use price as major units; Decimal is accepted as number/string)
  await prisma.product.upsert({
    where: { id: 'p1' },
    update: {
      title: 'Wireless Headphones',
      description: 'Over-ear, noise cancelling.',
      price: 9999.0,
      sku: 'WH-001',
      stock: 25,
      vatFlag: true,
      status: 'PUBLISHED',
      imagesJson: ['https://picsum.photos/seed/a/400/300'],
      categoryId: cat.id,
      supplierId: physical.id,
    },
    create: {
      id: 'p1',
      title: 'Wireless Headphones',
      description: 'Over-ear, noise cancelling.',
      price: 9999.0,
      sku: 'WH-001',
      stock: 25,
      vatFlag: true,
      status: 'PUBLISHED',
      imagesJson: ['https://picsum.photos/seed/a/400/300'],
      categoryId: cat.id,
      supplierId: physical.id,
    },
  });

  await prisma.product.upsert({
    where: { id: 'p2' },
    update: {
      title: 'Online Gift Card',
      description: 'Instant code (ONLINE route)',
      price: 5000.0,
      sku: 'GC-005',
      stock: 999,
      vatFlag: true,
      status: 'PUBLISHED',
      imagesJson: ['https://picsum.photos/seed/b/400/300'],
      categoryId: cat.id,
      supplierId: online.id,
      supplierTypeOverride: 'ONLINE',
      commissionPctInt: 30,
    },
    create: {
      id: 'p2',
      title: 'Online Gift Card',
      description: 'Instant code (ONLINE route)',
      price: 5000.0,
      sku: 'GC-005',
      stock: 999,
      vatFlag: true,
      status: 'PUBLISHED',
      imagesJson: ['https://picsum.photos/seed/b/400/300'],
      categoryId: cat.id,
      supplierId: online.id,
      supplierTypeOverride: 'ONLINE',
      commissionPctInt: 30,
    },
  });

  console.log('Seed OK:', {
    admin: admin.email,
    supplier: supplierUser.email,
    shopper: shopper.email,
    physicalSupplier: physical.id,
    onlineSupplier: online.id,
  });
}

main().finally(() => prisma.$disconnect());
