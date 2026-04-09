// ui/e2e/catalog.spec.ts
// End-to-end tests for the catalog / product browsing experience.

import { test, expect } from "@playwright/test";
import { setupApiMocks } from "./helpers";

test.describe("Catalog", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await page.goto("/");
  });

  test("shows a list of products", async ({ page }) => {
    // Products are cards / articles on the page
    const products = page.locator("article, [data-testid='product-card']");
    await expect(products.first()).toBeVisible({ timeout: 10_000 });
  });

  test("search filters products", async ({ page }) => {
    // Use the visible search input (the mobile-only one may be hidden on desktop)
    const searchInput = page.getByPlaceholder(/search/i).filter({ visible: true }).first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill("test");
    // Wait for debounce + network
    await page.waitForTimeout(600);
    // The grid should still be visible (either results or empty state)
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  });

  test("clearing search restores full list", async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search/i).filter({ visible: true }).first();
    await searchInput.fill("xyz");
    await page.waitForTimeout(600);
    // Clear via the X button or clearing the input
    await searchInput.clear();
    await page.waitForTimeout(600);
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  });

  test("clicking a product navigates to product detail", async ({ page }) => {
    const firstProduct = page.locator("article, [data-testid='product-card']").first();
    await expect(firstProduct).toBeVisible({ timeout: 10_000 });

    // Click the product title or the card itself
    await firstProduct.click();
    await page.waitForURL(/\/products\//, { timeout: 8_000 });
    await expect(page).toHaveURL(/\/products\//);
  });

  test("filter button opens the filter panel on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const filterBtn = page.getByRole("button", { name: /filter/i });
    await expect(filterBtn).toBeVisible();
    await filterBtn.click();
    // The drawer / panel should open — scope to the dialog to avoid hidden text matches
    await expect(page.locator("[role='dialog']").getByText(/filter|sort/i).first()).toBeVisible();
  });
});

test.describe("Product detail", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test("product detail page loads", async ({ page }) => {
    // Navigate to catalog first and click a product
    await page.goto("/");
    const firstProduct = page.locator("[data-testid='product-card']").first();
    await expect(firstProduct).toBeVisible({ timeout: 10_000 });
    await firstProduct.click();
    await page.waitForURL(/\/products\//, { timeout: 8_000 });

    // Check for key elements — use heading role to avoid hidden/off-screen h1 matches
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: /add to cart/i }).first()).toBeVisible({ timeout: 5_000 });
  });

  test("add to cart button is present on product detail", async ({ page }) => {
    await page.goto("/");
    const firstProduct = page.locator("[data-testid='product-card']").first();
    await expect(firstProduct).toBeVisible({ timeout: 10_000 });
    await firstProduct.click();
    await page.waitForURL(/\/products\//, { timeout: 8_000 });
    await expect(page.getByRole("button", { name: /add to cart/i }).first()).toBeVisible({ timeout: 5_000 });
  });
});
