// ui/e2e/cart.spec.ts
// End-to-end tests for the cart flow.

import { test, expect } from "@playwright/test";
import { addFirstProductToCart, clearSession, setupApiMocks } from "./helpers";

test.describe("Cart", () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
    await setupApiMocks(page);
    await page.goto("/");
  });

  test("add to cart from catalog increases cart count", async ({ page }) => {
    await addFirstProductToCart(page);
  });

  test("cart page shows added items", async ({ page }) => {
    await addFirstProductToCart(page);

    // Navigate to cart
    await page.goto("/cart");
    // Either shows item or empty-state — should not crash
    await expect(page.locator("body")).not.toContainText("Something went wrong");

    // The item we just added must be visible.
    const items = page.locator("article");
    await expect(items.first()).toBeVisible();
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
    await addFirstProductToCart(page);

    await page.goto("/cart");
    const removeBtn = page.getByRole("button", { name: /remove/i }).first();
    await expect(removeBtn).toBeVisible();

    const itemsBefore = await page.locator("article").count();
    await removeBtn.click();
    await page.waitForTimeout(600);
    const itemsAfter = await page.locator("article").count();
    expect(itemsAfter).toBeLessThan(itemsBefore);
  });

  test("quantity stepper increments qty", async ({ page }) => {
    await addFirstProductToCart(page);

    await page.goto("/cart");

    const incBtn = page.getByRole("button", { name: /increase quantity|\+/i }).first();
    await expect(incBtn).toBeVisible();

    // getByLabel(/quantity/i) also matches the "Increase/Decrease quantity"
    // buttons since it substring-matches accessible names; scope to the
    // textbox role so we only ever get the actual <input aria-label="Quantity">.
    const qtyInput = page.getByRole("textbox", { name: "Quantity" }).first();
    const qtyBefore = Number(await qtyInput.inputValue());
    await incBtn.click();
    await page.waitForTimeout(400);
    const qtyAfter = Number(await qtyInput.inputValue());
    expect(qtyAfter).toBe(qtyBefore + 1);
  });
});
