// api/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    // Run each test file in its own isolated context
    isolate: true,
    // Timeout per test (ms)
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/**/*.d.ts"],
    },
    include: ["tests/**/*.test.ts"],
  },
});
