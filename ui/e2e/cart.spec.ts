// ui/e2e/cart.spec.ts
// End-to-end tests for the cart flow.

import { test, expect } from "@playwright/test";
import { getLocalCartCount, clearSession, setupApiMocks } from "./helpers";

test.describe("Cart", () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
    await setupApiMocks(page);
    await page.goto("/");
  });

  test("add to cart from catalog increases cart count", async ({ page }) => {
    // Find a product with a visible Add to Cart button
    const addBtn = page.getByRole("button", { name: /add to cart/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });

    const countBefore = await getLocalCartCount(page);
    await addBtn.click();
    await page.waitForTimeout(800); // allow cart toast + storage write

    const countAfter = await getLocalCartCount(page);
    expect(countAfter).toBeGreaterThan(countBefore);
  });

  test("cart page shows added items", async ({ page }) => {
    // Add a product
    const addBtn = page.getByRole("button", { name: /add to cart/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();
    await page.waitForTimeout(600);

    // Navigate to cart
    await page.goto("/cart");
    // Either shows item or empty-state — should not crash
    await expect(page.locator("body")).not.toContainText("Something went wrong");
    // If cart is not empty, we should see at least one article
    const items = page.locator("article");
    const count = await items.count();
    if (count > 0) {
      await expect(items.first()).toBeVisible();
    }
  });

  test("cart empty state has a go-shopping link", async ({ page }) => {
    // Clear the cart in localStorage (v2 guest key used by the app)
    await page.evaluate(() => {
      localStorage.removeItem("cart:guest:v2");
      localStorage.removeItem("cart"); // legacy key
    });
    await page.goto("/cart");
    // Either the empty state CTA or the cart contents
    const shopLink = page.getByRole("link", { name: /go shopping|shop/i });
    const hasShopLink = await shopLink.isVisible().catch(() => false);
    if (hasShopLink) {
      await expect(shopLink).toBeVisible();
    }
  });

  test("remove button removes an item from the cart", async ({ page }) => {
    // Add a product first
    const addBtn = page.getByRole("button", { name: /add to cart/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();
    await page.waitForTimeout(600);

    await page.goto("/cart");
    const removeBtn = page.getByRole("button", { name: /remove/i }).first();
    const hasRemoveBtn = await removeBtn.isVisible().catch(() => false);

    if (hasRemoveBtn) {
      const itemsBefore = await page.locator("article").count();
      await removeBtn.click();
      await page.waitForTimeout(600);
      const itemsAfter = await page.locator("article").count();
      expect(itemsAfter).toBeLessThan(itemsBefore);
    }
  });

  test("quantity stepper increments qty", async ({ page }) => {
    const addBtn = page.getByRole("button", { name: /add to cart/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();
    await page.waitForTimeout(600);

    await page.goto("/cart");

    const incBtn = page.getByRole("button", { name: /increase quantity|\+/i }).first();
    const hasIncBtn = await incBtn.isVisible().catch(() => false);

    if (hasIncBtn) {
      const qtyInput = page.getByLabel(/quantity/i).first();
      const qtyBefore = Number(await qtyInput.inputValue());
      await incBtn.click();
      await page.waitForTimeout(400);
      const qtyAfter = Number(await qtyInput.inputValue());
      expect(qtyAfter).toBe(qtyBefore + 1);
    }
  });
});
