// api/tests/setup.ts
// Global setup that runs before every test file.

import { vi, beforeAll, afterAll } from "vitest";

// ── 1. Minimal env stubs (via vi.stubEnv — no process types needed) ───────────
// These are set once globally; individual tests can override with their own
// vi.stubEnv() calls and call vi.unstubAllEnvs() in afterEach to restore.
vi.stubEnv("NODE_ENV", "test");
vi.stubEnv("JWT_SECRET", "test-jwt-secret-do-not-use-in-production");
vi.stubEnv("ACCESS_JWT_SECRET", "test-jwt-secret-do-not-use-in-production");
vi.stubEnv("APP_URL", "http://localhost:5173");
vi.stubEnv("RESEND_API_KEY", ""); // empty → email.ts logs instead of sending

// If a dedicated test DB URL is provided, use it
const testDbUrl = process.env.TEST_DATABASE_URL;
if (testDbUrl) {
  vi.stubEnv("DATABASE_URL", testDbUrl);
}

// ── 2. Auth bypass ───────────────────────────────────────────────────────────
// auth.ts checks `globalThis.__auth_ignore` before verifying tokens.
// Set this to true in individual tests that don't need real auth.
// Use `authenticatedRequest()` from helpers/auth.ts for authenticated tests.
(globalThis as any).__auth_ignore = false;

// ── 3. Silence noisy console output during tests ─────────────────────────────
beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});
