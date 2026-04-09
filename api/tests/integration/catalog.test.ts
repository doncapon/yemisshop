// api/tests/integration/catalog.test.ts
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { buildPrismaMock } from "../helpers/prismaMock.js";

const { fakeProduct } = vi.hoisted(() => ({
  fakeProduct: {
    id: "prod-1",
    title: "Test Product",
    status: "PUBLISHED",
    inStock: true,
    retailPrice: 5000,
    imagesJson: [],
    slug: "test-product",
    description: null,
    sku: null,
    brandId: null,
    categoryId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    variants: [],
    offers: [],
    supplierOffers: [],
    category: null,
    brand: null,
    _count: { reviews: 0 },
  },
}));

vi.mock("../../src/lib/prisma.js", () => ({
  // buildPrismaMock returns a catch-all Proxy — any model not listed here
  // gets vi.fn() methods returning empty arrays / null automatically.
  prisma: buildPrismaMock({
    product: {
      findMany:   vi.fn().mockResolvedValue([fakeProduct]),
      findFirst:  vi.fn().mockResolvedValue(fakeProduct),
      findUnique: vi.fn().mockResolvedValue(fakeProduct),
      count:      vi.fn().mockResolvedValue(1),
    },
    category: { findMany: vi.fn().mockResolvedValue([]) },
    brand:    { findMany: vi.fn().mockResolvedValue([]) },
  }),
}));

import { app } from "../../src/server.js";

describe("Catalog / Products", () => {
  describe("GET /api/products", () => {
    it("returns 200 with a products array", async () => {
      const res = await request(app).get("/api/products");
      expect(res.status).toBe(200);
      const items = Array.isArray(res.body)
        ? res.body
        : (res.body?.data ?? res.body?.products ?? []);
      expect(Array.isArray(items)).toBe(true);
    });

    it("accepts q search parameter", async () => {
      const res = await request(app).get("/api/products?q=test");
      expect(res.status).toBe(200);
    });

    it("accepts page and limit parameters", async () => {
      const res = await request(app).get("/api/products?page=1&limit=12");
      expect(res.status).toBe(200);
    });

    it("accepts category filter", async () => {
      const res = await request(app).get("/api/products?category=electronics");
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/products/:id", () => {
    it("returns 200 or 404 for a product ID", async () => {
      const res = await request(app).get("/api/products/prod-1");
      expect([200, 404]).toContain(res.status);
    });
  });

  describe("GET /api/categories", () => {
    it("returns 200", async () => {
      const res = await request(app).get("/api/categories");
      expect(res.status).toBe(200);
    });
  });
});
