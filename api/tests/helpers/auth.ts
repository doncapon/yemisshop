// api/tests/helpers/auth.ts
// Helpers for creating test JWTs and making authenticated supertest requests.

import jwt from "jsonwebtoken";
import type { SuperTest, Test } from "supertest";

const JWT_SECRET =
  process.env.ACCESS_JWT_SECRET || process.env.JWT_SECRET || "test-jwt-secret-do-not-use-in-production";

export type TestRole = "SHOPPER" | "SUPPLIER" | "ADMIN" | "SUPER_ADMIN";

export type TestUser = {
  id: string;
  email: string;
  role: TestRole;
};

// Stable fake IDs used across tests — override as needed
export const TEST_USERS = {
  shopper: { id: "test-shopper-id", email: "shopper@test.com", role: "SHOPPER" } as TestUser,
  supplier: { id: "test-supplier-id", email: "supplier@test.com", role: "SUPPLIER" } as TestUser,
  admin: { id: "test-admin-id", email: "admin@test.com", role: "ADMIN" } as TestUser,
  superAdmin: { id: "test-superadmin-id", email: "superadmin@test.com", role: "SUPER_ADMIN" } as TestUser,
};

/**
 * Create a signed JWT for a test user.
 * Uses the same secret as the running server.
 */
export function makeTestJwt(user: TestUser, expiresIn = "1h"): string {
  return jwt.sign(
    {
      id: user.id,
      sub: user.id,
      email: user.email,
      role: user.role,
      k: "access",
    },
    JWT_SECRET,
    { expiresIn }
  );
}

/**
 * Returns a supertest `.set()` chain that injects a Bearer token.
 *
 * Usage:
 *   const res = await withAuth(request(app).get("/api/profile"), TEST_USERS.shopper);
 */
export function withAuth(req: Test, user: TestUser): Test {
  return req.set("Authorization", `Bearer ${makeTestJwt(user)}`);
}

/**
 * Bypasses the auth middleware entirely for the duration of the callback.
 * Useful when you want to test route logic without worrying about tokens.
 */
export async function bypassAuth(fn: () => Promise<void>) {
  (globalThis as any).__auth_ignore = true;
  try {
    await fn();
  } finally {
    (globalThis as any).__auth_ignore = false;
  }
}
