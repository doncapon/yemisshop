// api/tests/helpers/prismaMock.ts
// A catch-all Proxy mock for Prisma that returns sensible defaults for any
// model/method so routes don't crash when they touch models not explicitly set up.
//
// Usage in a test file:
//
//   const { prismaOverrides } = vi.hoisted(() => ({ prismaOverrides: {} as any }));
//
//   vi.mock("../../src/lib/prisma.js", () => ({
//     prisma: buildPrismaMock(prismaOverrides),
//   }));
//
// Then in a test:
//   prismaOverrides.user = { findUnique: vi.fn().mockResolvedValue(myUser) };

import { vi } from "vitest";

function modelProxy(overrides?: Record<string, any>) {
  return new Proxy(overrides ?? {}, {
    get(_target, method: string) {
      if (method in (_target as any)) return (_target as any)[method];
      // Default returns for common Prisma methods
      if (method === "findMany")   return vi.fn().mockResolvedValue([]);
      if (method === "findFirst")  return vi.fn().mockResolvedValue(null);
      if (method === "findUnique") return vi.fn().mockResolvedValue(null);
      if (method === "count")      return vi.fn().mockResolvedValue(0);
      if (method === "create")     return vi.fn().mockResolvedValue({});
      if (method === "update")     return vi.fn().mockResolvedValue({});
      if (method === "upsert")     return vi.fn().mockResolvedValue({});
      if (method === "delete")     return vi.fn().mockResolvedValue({});
      if (method === "deleteMany") return vi.fn().mockResolvedValue({ count: 0 });
      if (method === "createMany") return vi.fn().mockResolvedValue({ count: 0 });
      if (method === "updateMany") return vi.fn().mockResolvedValue({ count: 0 });
      if (method === "groupBy")    return vi.fn().mockResolvedValue([]);
      if (method === "aggregate")  return vi.fn().mockResolvedValue({});
      return vi.fn().mockResolvedValue(null);
    },
  });
}

export function buildPrismaMock(modelOverrides: Record<string, any> = {}) {
  return new Proxy(modelOverrides, {
    get(target, prop: string) {
      if (prop === "$transaction") {
        return vi.fn(async (fnOrArray: any) => {
          if (Array.isArray(fnOrArray)) return Promise.all(fnOrArray);
          return fnOrArray(buildPrismaMock(modelOverrides));
        });
      }
      if (prop === "$queryRaw" || prop === "$executeRaw") {
        return vi.fn().mockResolvedValue([]);
      }
      if (prop === "$queryRawUnsafe") return vi.fn().mockResolvedValue([]);
      if (prop === "$connect" || prop === "$disconnect") return vi.fn().mockResolvedValue(undefined);
      // Named model overrides take priority
      if (prop in target) return modelProxy(target[prop]);
      // Everything else gets a generic model proxy
      return modelProxy();
    },
  });
}
