// ui/src/tests/unit/cartModel.test.ts
// Unit tests for the cart model utility — pure functions, no DOM needed.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  readCartLines,
  writeCartLines,
  upsertCartLine,
  toCartPageItems,
  qtyInCart,
  type CartLine,
} from "../../utils/cartModel";

// ── Mock cartStorage so we don't touch localStorage directly ─────────────────
let storedCart: any = null;

vi.mock("../../utils/cartStorage", () => ({
  loadCartRaw: vi.fn(() => storedCart ?? []),
  saveCartRaw: vi.fn((data: any) => { storedCart = data; }),
}));

import { loadCartRaw, saveCartRaw } from "../../utils/cartStorage";

beforeEach(() => {
  storedCart = null;
  vi.clearAllMocks();
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseLine: CartLine = {
  productId: "prod-1",
  variantId: null,
  kind: "BASE",
  optionsKey: "",
  qty: 1,
  titleSnapshot: "Test Product",
  unitPriceCache: 5000,
};

const variantLine: CartLine = {
  productId: "prod-2",
  variantId: "var-1",
  kind: "VARIANT",
  optionsKey: "Color:Red|Size:M",
  qty: 2,
  titleSnapshot: "Variant Product",
  unitPriceCache: 8000,
  selectedOptions: [
    { attribute: "Color", value: "Red" },
    { attribute: "Size", value: "M" },
  ],
};

// ── readCartLines ─────────────────────────────────────────────────────────────

describe("readCartLines", () => {
  it("returns empty array when storage is empty", () => {
    const lines = readCartLines();
    expect(lines).toEqual([]);
  });

  it("returns stored lines", () => {
    storedCart = [baseLine];
    const lines = readCartLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].productId).toBe("prod-1");
  });

  it("filters out lines with qty 0", () => {
    storedCart = [{ ...baseLine, qty: 0 }];
    const lines = readCartLines();
    expect(lines).toHaveLength(0);
  });

  it("does not throw when storage contains garbage", () => {
    storedCart = [{ notAProduct: true }, null, undefined, 123];
    expect(() => readCartLines()).not.toThrow();
  });
});

// ── writeCartLines ────────────────────────────────────────────────────────────

describe("writeCartLines", () => {
  it("persists lines to storage", () => {
    writeCartLines([baseLine]);
    expect(saveCartRaw).toHaveBeenCalledOnce();
  });

  it("does not re-write when cart has not changed", () => {
    storedCart = [baseLine];
    writeCartLines([baseLine]);
    // saveCartRaw should not be called because content is identical
    expect(saveCartRaw).not.toHaveBeenCalled();
  });
});

// ── upsertCartLine ────────────────────────────────────────────────────────────

describe("upsertCartLine", () => {
  it("adds a new line when cart is empty", () => {
    const result = upsertCartLine(baseLine);
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("prod-1");
    expect(result[0].qty).toBe(1);
  });

  it("updates quantity of an existing line", () => {
    storedCart = [baseLine];
    const result = upsertCartLine({ ...baseLine, qty: 5 });
    expect(result).toHaveLength(1);
    expect(result[0].qty).toBe(5);
  });

  it("removes a line when qty is set to 0", () => {
    storedCart = [baseLine];
    const result = upsertCartLine({ ...baseLine, qty: 0 });
    expect(result).toHaveLength(0);
  });

  it("adds a second distinct line", () => {
    storedCart = [baseLine];
    const result = upsertCartLine(variantLine);
    expect(result).toHaveLength(2);
  });

  it("treats BASE and VARIANT as different identity even for same productId", () => {
    storedCart = [baseLine];
    const result = upsertCartLine({ ...variantLine, productId: "prod-1" });
    expect(result).toHaveLength(2);
  });

  it("preserves existing titleSnapshot when incoming is empty", () => {
    storedCart = [baseLine];
    const result = upsertCartLine({ ...baseLine, qty: 3, titleSnapshot: null });
    expect(result[0].titleSnapshot).toBe("Test Product");
  });

  it("preserves existing unitPriceCache when incoming is null", () => {
    storedCart = [baseLine];
    const result = upsertCartLine({ ...baseLine, qty: 3, unitPriceCache: null });
    expect(result[0].unitPriceCache).toBe(5000);
  });
});

// ── toCartPageItems ───────────────────────────────────────────────────────────

describe("toCartPageItems", () => {
  it("maps lines to cart page items", () => {
    const items = toCartPageItems([baseLine, variantLine]);
    expect(items).toHaveLength(2);
  });

  it("computes totalPrice correctly", () => {
    const items = toCartPageItems([{ ...baseLine, qty: 3, unitPriceCache: 2000 }]);
    expect(items[0].totalPrice).toBe(6000);
  });

  it("uses resolveImageUrl when provided", () => {
    const resolve = vi.fn().mockReturnValue("https://cdn.test/img.jpg");
    const items = toCartPageItems(
      [{ ...baseLine, imageSnapshot: "/uploads/img.jpg" }],
      resolve
    );
    expect(resolve).toHaveBeenCalledWith("/uploads/img.jpg");
    expect(items[0].image).toBe("https://cdn.test/img.jpg");
  });
});

// ── qtyInCart ─────────────────────────────────────────────────────────────────

describe("qtyInCart", () => {
  it("returns 0 when product is not in cart", () => {
    expect(qtyInCart([], "prod-x", null)).toBe(0);
  });

  it("returns qty for matching BASE line", () => {
    expect(qtyInCart([{ ...baseLine, qty: 4 }], "prod-1", null)).toBe(4);
  });

  it("returns 0 for wrong productId", () => {
    expect(qtyInCart([baseLine], "prod-999", null)).toBe(0);
  });

  it("matches by variantId for quick-add VARIANT lines (optionsKey empty)", () => {
    // qtyInCart only looks at quick-add lines (optionsKey="").
    // A fully-configured variant line with a non-empty optionsKey is intentionally excluded.
    const quickVariant: CartLine = { ...variantLine, optionsKey: "" };
    expect(qtyInCart([quickVariant], "prod-2", "var-1")).toBe(2);
  });

  it("does not match VARIANT line when looking for BASE", () => {
    expect(qtyInCart([variantLine], "prod-2", null)).toBe(0);
  });
});
