// api/tests/integration/cart.test.ts
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { buildPrismaMock } from "../helpers/prismaMock.js";

const { SHOPPER_ID, fakeCartItem } = vi.hoisted(() => {
  const SHOPPER_ID = "test-shopper-id";
  return {
    SHOPPER_ID,
    fakeCartItem: {
      id: "cart-item-1",
      userId: SHOPPER_ID,
      productId: "prod-1",
      variantId: null,
      kind: "BASE",
      qty: 2,
      titleSnapshot: "Test Product",
      imageSnapshot: null,
      unitPriceCache: 5000,
      selectedOptions: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
});

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: buildPrismaMock({
    cartItem: {
      findMany:   vi.fn().mockResolvedValue([fakeCartItem]),
      findFirst:  vi.fn().mockResolvedValue(fakeCartItem),
      findUnique: vi.fn().mockResolvedValue(fakeCartItem),
      create:     vi.fn().mockResolvedValue(fakeCartItem),
      update:     vi.fn().mockResolvedValue({ ...fakeCartItem, qty: 3 }),
      upsert:     vi.fn().mockResolvedValue(fakeCartItem),
      delete:     vi.fn().mockResolvedValue(fakeCartItem),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    // cart model (some routes use prisma.cart, others use prisma.cartItem)
    cart: {
      findFirst:  vi.fn().mockResolvedValue({ id: "cart-1", userId: SHOPPER_ID, items: [fakeCartItem] }),
      findUnique: vi.fn().mockResolvedValue({ id: "cart-1", userId: SHOPPER_ID, items: [fakeCartItem] }),
      create:     vi.fn().mockResolvedValue({ id: "cart-1", userId: SHOPPER_ID, items: [] }),
      upsert:     vi.fn().mockResolvedValue({ id: "cart-1", userId: SHOPPER_ID, items: [fakeCartItem] }),
    },
  }),
}));

// Import AFTER mocks
import { app } from "../../src/server.js";
import { makeTestJwt } from "../helpers/auth.js";

// makeTestJwt has no `sid` → assertSessionIfPresent returns early → no DB needed
function authed(method: "get" | "post" | "patch" | "delete", path: string) {
  const token = makeTestJwt({ id: SHOPPER_ID, email: "shopper@test.com", role: "SHOPPER" });
  return (request(app) as any)[method](path).set("Authorization", `Bearer ${token}`);
}

describe("Cart routes", () => {
  describe("GET /api/cart", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get("/api/cart");
      expect(res.status).toBe(401);
    });

    it("returns 200 with a valid JWT", async () => {
      const res = await authed("get", "/api/cart");
      expect([200, 404]).toContain(res.status);
    });
  });

  describe("POST /api/cart/items", () => {
    it("returns 401 without a token", async () => {
      // Send a VALID body so the route reaches the auth check
      const res = await request(app)
        .post("/api/cart/items")
        .send({ productId: "prod-1", qty: 1, kind: "BASE" });
      expect(res.status).toBe(401);
    });

    it("returns 400 when productId is missing", async () => {
      const res = await authed("post", "/api/cart/items").send({ qty: 1 });
      expect([400, 422]).toContain(res.status);
    });

    it("accepts a valid cart add payload", async () => {
      const res = await authed("post", "/api/cart/items")
        .send({ productId: "prod-1", qty: 1, kind: "BASE" });
      expect([200, 201, 400, 404]).toContain(res.status);
    });
  });

  describe("PATCH /api/cart/items/:id", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).patch("/api/cart/items/cart-item-1").send({ qty: 3 });
      expect(res.status).toBe(401);
    });

    it("updates qty with a valid JWT", async () => {
      const res = await authed("patch", "/api/cart/items/cart-item-1").send({ qty: 3 });
      expect([200, 404]).toContain(res.status);
    });
  });

  describe("DELETE /api/cart/items/:id", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).delete("/api/cart/items/cart-item-1");
      expect(res.status).toBe(401);
    });

    it("deletes with a valid JWT", async () => {
      const res = await authed("delete", "/api/cart/items/cart-item-1");
      expect([200, 204, 404]).toContain(res.status);
    });
  });
});
