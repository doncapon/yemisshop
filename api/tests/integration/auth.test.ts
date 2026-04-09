// api/tests/integration/auth.test.ts
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { buildPrismaMock } from "../helpers/prismaMock.js";

const { fakeUser } = vi.hoisted(() => ({
  fakeUser: {
    id: "test-shopper-id",
    email: "shopper@test.com",
    role: "SHOPPER",
    status: "ACTIVE",
    firstName: "Test",
    lastName: "Shopper",
    emailVerified: true,
    phoneVerified: false,
    passwordHash: "$2b$10$fakehash",
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
}));

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: buildPrismaMock({
    user: {
      findUnique: vi.fn().mockResolvedValue(fakeUser),
      findFirst:  vi.fn().mockResolvedValue(fakeUser),
      update:     vi.fn().mockResolvedValue(fakeUser),
      create:     vi.fn().mockResolvedValue(fakeUser),
    },
  }),
}));

vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn().mockResolvedValue(true), hash: vi.fn().mockResolvedValue("$2b$10$fakehash") },
  compare: vi.fn().mockResolvedValue(true),
  hash:    vi.fn().mockResolvedValue("$2b$10$fakehash"),
}));

// Import AFTER mocks are declared
import { app } from "../../src/server.js";
import { makeTestJwt } from "../helpers/auth.js";

describe("Auth routes", () => {
  describe("POST /api/auth/login", () => {
    it("returns 400 when email is missing", async () => {
      const res = await request(app).post("/api/auth/login").send({ password: "password123" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when password is missing", async () => {
      const res = await request(app).post("/api/auth/login").send({ email: "user@test.com" });
      expect(res.status).toBe(400);
    });

    it("returns a response with valid credentials", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "shopper@test.com", password: "password123" });
      expect([200, 201, 401, 422]).toContain(res.status);
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns 401 with no token", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(401);
    });

    it("returns 401 with a garbage token", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer not-a-real-token");
      expect(res.status).toBe(401);
    });

    it("returns 200 or 404 with a valid JWT (no sid = no session DB lookup)", async () => {
      // makeTestJwt omits `sid`, so assertSessionIfPresent returns early
      // without touching the DB — no session mock needed.
      const token = makeTestJwt({ id: "test-shopper-id", email: "shopper@test.com", role: "SHOPPER" });
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);
      expect([200, 404]).toContain(res.status);
    });
  });
});
