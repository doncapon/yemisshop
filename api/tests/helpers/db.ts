// api/tests/helpers/db.ts
// Prisma test utilities.
//
// INTEGRATION TESTS (real DB):
//   Set TEST_DATABASE_URL in .env.test to a dedicated PostgreSQL database.
//   Never point at your production or dev DB.
//
// UNIT TESTS (mocked DB):
//   Use vi.mock("../src/lib/prisma.js") and supply your own mock return values.

import { vi } from "vitest";

/**
 * Returns a deep partial mock of the Prisma client suitable for unit tests.
 * Pass return values per-test with mockResolvedValueOnce / mockReturnValue.
 *
 * Usage in a test file:
 *
 *   vi.mock("../../src/lib/prisma.js", () => ({ prisma: mockPrisma() }));
 */
export function mockPrisma() {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      // Return a nested proxy for any property access (e.g. prisma.user.findMany)
      return new Proxy(
        {},
        {
          get(_t, method) {
            // Return a vi.fn() for any method call
            return vi.fn().mockResolvedValue(null);
          },
        }
      );
    },
  };
  return new Proxy({}, handler);
}

/**
 * Wrap a test in a Prisma transaction that rolls back after the test.
 * Only works when TEST_DATABASE_URL is a real database.
 *
 * Usage:
 *   it("does something", withRollback(async (tx) => {
 *     await tx.user.create({ ... });
 *     // assertions ...
 *   }));
 */
export function withRollback(fn: (tx: any) => Promise<void>) {
  return async () => {
    const { prisma } = await import("../../src/lib/prisma.js");
    // Prisma doesn't support manual rollbacks in interactive transactions
    // so we use a try/finally pattern with a known sentinel error.
    const ROLLBACK = Symbol("test-rollback");
    try {
      await (prisma as any).$transaction(async (tx: any) => {
        await fn(tx);
        throw ROLLBACK; // always roll back
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e; // re-throw real errors
    }
  };
}
