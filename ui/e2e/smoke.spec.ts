// ui/e2e/smoke.spec.ts
// Smoke tests — the most critical pages load without errors.

import { test, expect } from "@playwright/test";

test.describe("Smoke tests", () => {
  test("homepage loads", async ({ page }) => {
    await page.goto("/");
    await expect(page).not.toHaveTitle(/error/i);
    // The catalog / hero section should be present
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  });

  test("catalog page loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });

  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test("register page loads", async ({ page }) => {
    await page.goto("/register");
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  });

  test("404 page shows for unknown routes", async ({ page }) => {
    await page.goto("/this-page-does-not-exist-xyz");
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByRole("link", { name: /go to homepage/i })).toBeVisible();
  });

  test("cart page loads", async ({ page }) => {
    await page.goto("/cart");
    // Either shows cart contents or the empty state
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  });

  test("help centre page loads", async ({ page }) => {
    await page.goto("/help");
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  });
});
