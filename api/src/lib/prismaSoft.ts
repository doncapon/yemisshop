// src/lib/prismaSoft.ts
import { Prisma, PrismaClient } from '@prisma/client';
import {prisma} from '../lib/prisma.js'

/**
 * All list reads exclude soft-deleted rows.
 * delete/deleteMany perform a soft delete.
 * findUnique is converted to a findFirst that also excludes soft-deleted rows.
 */
export const prismaSoft = prisma.$extends({
  query: {
    product: {
      // findMany(...): keep only non-deleted
      findMany(
        ctx: {
          args: Prisma.ProductFindManyArgs;
          query: (args: Prisma.ProductFindManyArgs) => Promise<any>;
        }
      ) {
        const { args, query } = ctx;
        const where = (args.where ?? {}) as Prisma.ProductWhereInput;
        args.where = {
          AND: [{ isDeleted: false }, where],
        } satisfies Prisma.ProductWhereInput;
        return query(args);
      },

      // findFirst(...): keep only non-deleted
      findFirst(
        ctx: {
          args: Prisma.ProductFindFirstArgs;
          query: (args: Prisma.ProductFindFirstArgs) => Promise<any>;
        }
      ) {
        const { args, query } = ctx;
        const where = (args.where ?? {}) as Prisma.ProductWhereInput;
        args.where = {
          AND: [{ isDeleted: false }, where],
        } satisfies Prisma.ProductWhereInput;
        return query(args);
      },

      // findUnique(...): convert to findFirst + isDeleted: false (can’t inject into WhereUniqueInput)
      findUnique(
        ctx: { args: Prisma.ProductFindUniqueArgs }
      ) {
        const { args } = ctx;
        const whereUnique = args.where; // id/sku/...
        return prisma.product.findFirst({
          select: args.select,
          include: args.include,
          where: {
            AND: [
              { isDeleted: false },
              whereUnique as unknown as Prisma.ProductWhereInput,
            ],
          },
        });
      },

      // delete(...): soft delete
      delete(
        ctx: { args: Prisma.ProductDeleteArgs }
      ) {
        return prisma.product.update({
          where: ctx.args.where,
          data: { isDeleted: true, deletedAt: new Date() },
        });
      },

      // deleteMany(...): soft delete
      deleteMany(
        ctx: { args: Prisma.ProductDeleteManyArgs }
      ) {
        return prisma.product.updateMany({
          where: ctx.args.where,
          data: { isDeleted: true, deletedAt: new Date() },
        });
      },
    },
  },

  // Optional helper you can call when you want a unique fetch that guarantees not-deleted
  model: {
    product: {
      async findUniqueNotDeleted(args: Prisma.ProductFindUniqueArgs) {
        return prisma.product.findFirst({
          select: args.select,
          include: args.include,
          where: {
            AND: [
              { isDeleted: false },
              args.where as unknown as Prisma.ProductWhereInput,
            ],
          },
        });
      },
    },
  },
});
