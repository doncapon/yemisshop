// api/tests/integration/health.test.ts
// Smoke test — verifies the server boots and responds.

import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../src/server.js";

describe("GET /api/health", () => {
  it("returns 200 ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });
});
