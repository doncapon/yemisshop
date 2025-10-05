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
      phone: '+2348012345678'
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
  const catElectronics = await prisma.category.upsert({
    where: { name: 'Electronics' },
    update: {},
    create: { name: 'Electronics' },
  });

  const catKitchen = await prisma.category.upsert({
    where: { name: 'Kitchen' },
    update: {},
    create: { name: 'Kitchen' },
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
      categoryId: catElectronics.id,
      categoryName: catElectronics.name,
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
      categoryId: catElectronics.id,
      categoryName: catElectronics.name,

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
      stock: 100,
      vatFlag: true,
      status: 'PUBLISHED',
      imagesJson: ['https://picsum.photos/seed/b/400/300'],
      categoryId: catElectronics.id,
      categoryName: catElectronics.name,
      supplierId: online.id,
      supplierTypeOverride: 'ONLINE',
      commissionPctInt: 30,
    },
    create: {
      id: 'p2',
      title: 'Online Gift Card',
      description: 'Instant code (ONLINE route)',
      price: 5000.51,
      sku: 'GC-005',
      stock: 100,
      vatFlag: true,
      status: 'PUBLISHED',
      imagesJson: ['https://picsum.photos/seed/b/400/300'],
      categoryId: catElectronics.id,
      supplierId: online.id,
      categoryName: catElectronics.name,

      supplierTypeOverride: 'ONLINE',
      commissionPctInt: 30,
    },
  });


  // p3
  await prisma.product.upsert({
    where: { id: 'p3' },
    update: {
      title: 'Frying Pan',
      description: 'Instant code (ONLINE route)',
      price: 2510.0,
      sku: 'GC-005',
      stock: 90,
      vatFlag: true,
      status: 'PUBLISHED',
      imagesJson: ['https://picsum.photos/seed/b/400/300'],
      categoryId: catKitchen.id,
      categoryName: catKitchen.name,
      supplierId: online.id,
      supplierTypeOverride: 'ONLINE',
      commissionPctInt: 30,
    },
    create: {
      id: 'p3',
      title: 'Frying Pan',
      description: 'Instant code (ONLINE route)',
      price: 2510.0,
      sku: 'GC-005',
      stock: 90,
      vatFlag: true,
      status: 'PUBLISHED',
      imagesJson: ['https://picsum.photos/seed/b/400/300'],
      categoryId: catKitchen.id,
      supplierId: online.id,
      categoryName: catKitchen.name,

      supplierTypeOverride: 'ONLINE',
      commissionPctInt: 30,
    },
  });


  // prisma/seed.ts (snippet)
  const addr = await prisma.address.create({
    data: {
      houseNumber: '12',
      streetName: 'Palm Street',
      postCode: '100001',
      town: 'Ikeja',
      city: 'Lagos',
      state: 'Lagos',
      country: 'NG',
    },
  });

  const ship = await prisma.address.create({
    data: {
      houseNumber: '3B',
      streetName: 'Market Rd',
      postCode: '100002',
      town: 'Yaba',
      city: 'Lagos',
      state: 'Lagos',
      country: 'NG',
    },
  });

  await prisma.user.update({
    where: { email: 'shopper@example.com' },
    data: {
      address: { connect: { id: addr.id } },
      shippingAddress: { connect: { id: ship.id } },
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
