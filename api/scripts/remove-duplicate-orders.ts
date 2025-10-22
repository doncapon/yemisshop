import { prisma } from '../src/lib/prisma.js';


async function run() {
  // 1) find groups with duplicates
  const dups = await prisma.payment.groupBy({
    by: ['orderId'],
    _count: { _all: true },
    having: {
      orderId: {
        _count: { gt: 1 }, // ✅ correct 'having' shape
      },
    },
  });

  for (const g of dups) {
    const rows = await prisma.payment.findMany({
      where: { orderId: g.orderId },
      orderBy: [{ createdAt: 'desc' }],
    });

    // Prefer a PAID one; otherwise keep most recent
    const keep = rows.find((r: { status: string; }) => r.status === 'PAID') ?? rows[0];
    const remove = rows.filter((r: { id: any; }) => r.id !== keep.id);

    for (const r of remove) {
      await prisma.payment.delete({ where: { id: r.id } });
    }
    console.log(`Order ${g.orderId}: kept ${keep.id} (${keep.status}), removed ${remove.length}`);
  }
}

run()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });