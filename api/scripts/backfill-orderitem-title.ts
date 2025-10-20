// scripts/backfill-orderitem-title.ts
/// <reference types="node" />
import process from 'node:process'

import { prisma } from '../src/lib/prisma.js';

async function main() {
  const items = await prisma.orderItem.findMany({
    where: { title: null },
    select: { id: true, productId: true },
  });

  for (const it of items) {
    const p = await prisma.product.findUnique({ where: { id: it.productId }, select: { title: true } });
    await prisma.orderItem.update({
      where: { id: it.id },
      data: { title: p?.title ?? '' },
    });
  }
}
main().then(() => process.exit(0));
