# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: catalog.spec.ts >> Catalog >> filter button opens the filter panel on mobile
- Location: e2e\catalog.spec.ts:51:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.setViewportSize: Test timeout of 30000ms exceeded.
```

# Test source

```ts
  1  | // ui/e2e/catalog.spec.ts
  2  | // End-to-end tests for the catalog / product browsing experience.
  3  | 
  4  | import { test, expect } from "@playwright/test";
  5  | import { setupApiMocks } from "./helpers";
  6  | 
  7  | test.describe("Catalog", () => {
  8  |   test.beforeEach(async ({ page }) => {
  9  |     await setupApiMocks(page);
  10 |     await page.goto("/");
  11 |   });
  12 | 
  13 |   test("shows a list of products", async ({ page }) => {
  14 |     // Products are cards / articles on the page
  15 |     const products = page.locator("article, [data-testid='product-card']");
  16 |     await expect(products.first()).toBeVisible({ timeout: 10_000 });
  17 |   });
  18 | 
  19 |   test("search filters products", async ({ page }) => {
  20 |     // Use the visible search input (the mobile-only one may be hidden on desktop)
  21 |     const searchInput = page.getByPlaceholder(/search/i).filter({ visible: true }).first();
  22 |     await expect(searchInput).toBeVisible();
  23 | 
  24 |     await searchInput.fill("test");
  25 |     // Wait for debounce + network
  26 |     await page.waitForTimeout(600);
  27 |     // The grid should still be visible (either results or empty state)
  28 |     await expect(page.locator("body")).not.toContainText("Something went wrong");
  29 |   });
  30 | 
  31 |   test("clearing search restores full list", async ({ page }) => {
  32 |     const searchInput = page.getByPlaceholder(/search/i).filter({ visible: true }).first();
  33 |     await searchInput.fill("xyz");
  34 |     await page.waitForTimeout(600);
  35 |     // Clear via the X button or clearing the input
  36 |     await searchInput.clear();
  37 |     await page.waitForTimeout(600);
  38 |     await expect(page.locator("body")).not.toContainText("Something went wrong");
  39 |   });
  40 | 
  41 |   test("clicking a product navigates to product detail", async ({ page }) => {
  42 |     const firstProduct = page.locator("article, [data-testid='product-card']").first();
  43 |     await expect(firstProduct).toBeVisible({ timeout: 10_000 });
  44 | 
  45 |     // Click the product title or the card itself
  46 |     await firstProduct.click();
  47 |     await page.waitForURL(/\/products\//, { timeout: 8_000 });
  48 |     await expect(page).toHaveURL(/\/products\//);
  49 |   });
  50 | 
  51 |   test("filter button opens the filter panel on mobile", async ({ page }) => {
> 52 |     await page.setViewportSize({ width: 390, height: 844 });
     |                ^ Error: page.setViewportSize: Test timeout of 30000ms exceeded.
  53 |     const filterBtn = page.getByRole("button", { name: /filter/i });
  54 |     await expect(filterBtn).toBeVisible();
  55 |     await filterBtn.click();
  56 |     // The drawer / panel should open — scope to the dialog to avoid hidden text matches
  57 |     await expect(page.locator("[role='dialog']").getByText(/filter|sort/i).first()).toBeVisible();
  58 |   });
  59 | });
  60 | 
  61 | test.describe("Product detail", () => {
  62 |   test.beforeEach(async ({ page }) => {
  63 |     await setupApiMocks(page);
  64 |   });
  65 | 
  66 |   test("product detail page loads", async ({ page }) => {
  67 |     // Navigate to catalog first and click a product
  68 |     await page.goto("/");
  69 |     const firstProduct = page.locator("[data-testid='product-card']").first();
  70 |     await expect(firstProduct).toBeVisible({ timeout: 10_000 });
  71 |     await firstProduct.click();
  72 |     await page.waitForURL(/\/products\//, { timeout: 8_000 });
  73 | 
  74 |     // Check for key elements — use heading role to avoid hidden/off-screen h1 matches
  75 |     await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 5_000 });
  76 |     await expect(page.getByRole("button", { name: /add to cart/i }).first()).toBeVisible({ timeout: 5_000 });
  77 |   });
  78 | 
  79 |   test("add to cart button is present on product detail", async ({ page }) => {
  80 |     await page.goto("/");
  81 |     const firstProduct = page.locator("[data-testid='product-card']").first();
  82 |     await expect(firstProduct).toBeVisible({ timeout: 10_000 });
  83 |     await firstProduct.click();
  84 |     await page.waitForURL(/\/products\//, { timeout: 8_000 });
  85 |     await expect(page.getByRole("button", { name: /add to cart/i }).first()).toBeVisible({ timeout: 5_000 });
  86 |   });
  87 | });
  88 | 
```