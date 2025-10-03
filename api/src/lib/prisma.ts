// src/lib/prisma.ts (workaround)
import prismaPkg from '@prisma/client';
const { PrismaClient } = prismaPkg as any;

const g = globalThis as any;
export const prisma = g.prisma ?? new PrismaClient({ log: ['warn', 'error'] });
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;
