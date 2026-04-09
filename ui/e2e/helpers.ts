// ui/e2e/helpers.ts
// Shared helpers for all E2E specs.

import type { Page } from "@playwright/test";

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Log in via the UI login form.
 * Uses E2E_SHOPPER_EMAIL / E2E_SHOPPER_PASSWORD env vars or test defaults.
 */
export async function loginAs(
  page: Page,
  role: "shopper" | "admin" | "supplier" = "shopper"
) {
  const creds = {
    shopper: {
      email: process.env.E2E_SHOPPER_EMAIL || "shopper@test.com",
      password: process.env.E2E_SHOPPER_PASSWORD || "Test1234!",
    },
    admin: {
      email: process.env.E2E_ADMIN_EMAIL || "admin@test.com",
      password: process.env.E2E_ADMIN_PASSWORD || "Test1234!",
    },
    supplier: {
      email: process.env.E2E_SUPPLIER_EMAIL || "supplier@test.com",
      password: process.env.E2E_SUPPLIER_PASSWORD || "Test1234!",
    },
  }[role];

  await page.goto("/login");
  await page.getByLabel(/email/i).fill(creds.email);
  await page.locator("#login-password").fill(creds.password);
  await page.getByRole("button", { name: /log in/i }).click();
  // Wait until we're no longer on /login
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 });
}

/**
 * Clear all cookies and localStorage (effectively log out without UI).
 */
export async function clearSession(page: Page) {
  await page.context().clearCookies();
  // localStorage.clear() requires a real origin — navigate to the app root
  // first if we're still on about:blank (i.e. before the first goto in a test).
  const url = page.url();
  if (!url.startsWith("http")) {
    await page.goto("/");
  }
  // Clear storage then immediately re-seed the consent key so the cookie
  // consent banner (which appears when "consent" is absent) never blocks tests.
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      "consent",
      JSON.stringify({ analytics: false, marketing: false, setAt: new Date().toISOString() })
    );
  });
}

// ── Cart ──────────────────────────────────────────────────────────────────────

/**
 * Read the current cart item count from localStorage (fast, no navigation).
 * The app uses "cart:guest:v2" key with { v: 2, items: [...] } format for guests.
 */
export async function getLocalCartCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    try {
      // Try v2 guest key first
      const raw = localStorage.getItem("cart:guest:v2");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.v === 2 && Array.isArray(parsed.items)) {
          return parsed.items.reduce((s: number, x: any) => s + (Number(x?.qty) || 0), 0);
        }
      }
      // Fallback: legacy "cart" key
      const legacy = localStorage.getItem("cart");
      if (legacy) {
        const arr = JSON.parse(legacy);
        return Array.isArray(arr) ? arr.reduce((s: number, x: any) => s + (Number(x?.qty) || 0), 0) : 0;
      }
      return 0;
    } catch {
      return 0;
    }
  });
}

// ── API mocks ─────────────────────────────────────────────────────────────────

const MOCK_PRODUCTS = [
  {
    id: "mock-1",
    title: "Mock Widget A",
    status: "LIVE",
    inStock: true,
    availableQty: 20,
    retailPrice: 5000,
    supplierProductOffers: [
      {
        id: "offer-1",
        isActive: true,
        inStock: true,
        availableQty: 20,
        basePrice: 4000,
        unitPrice: 4000,
        currency: "NGN",
      },
    ],
    variants: [],
  },
  {
    id: "mock-2",
    title: "Mock Gadget B",
    status: "LIVE",
    inStock: true,
    availableQty: 5,
    retailPrice: 12000,
    supplierProductOffers: [
      {
        id: "offer-2",
        isActive: true,
        inStock: true,
        availableQty: 5,
        basePrice: 10000,
        unitPrice: 10000,
        currency: "NGN",
      },
    ],
    variants: [],
  },
  {
    id: "mock-3",
    title: "Mock Doohickey C",
    status: "LIVE",
    inStock: true,
    availableQty: 8,
    retailPrice: 3500,
    supplierProductOffers: [
      {
        id: "offer-3",
        isActive: true,
        inStock: true,
        availableQty: 8,
        basePrice: 2800,
        unitPrice: 2800,
        currency: "NGN",
      },
    ],
    variants: [],
  },
];

/**
 * Intercept API routes needed by the Catalog and Cart pages so tests run
 * without a live backend.  Call this before page.goto("/") in beforeEach.
 */
export async function setupApiMocks(page: Page) {
  // Seed consent before any navigation so the cookie banner never appears.
  await page.addInitScript(() => {
    localStorage.setItem(
      "consent",
      JSON.stringify({ analytics: false, marketing: false, setAt: new Date().toISOString() })
    );
  });

  // Products list — registered first (lowest priority in LIFO matching)
  await page.route("**/api/products**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: MOCK_PRODUCTS }),
    })
  );

  // Single product by ID — registered after the broad route so it wins (LIFO)
  await page.route("**/api/products/*", (route) => {
    const url = route.request().url();
    const match = url.match(/\/api\/products\/([^/?]+)/);
    const pid = match?.[1];
    const product = MOCK_PRODUCTS.find((p) => p.id === pid) ?? MOCK_PRODUCTS[0];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: product }),
    });
  });

  // Sub-resource routes — registered last so they have highest priority
  await page.route("**/api/products/*/similar", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    })
  );
  await page.route("**/api/products/*/reviews/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: null }),
    })
  );

  // Pricing settings (zeros are fine — products have explicit prices)
  await page.route("**/api/settings/public**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        baseServiceFeeNGN: 0,
        commsUnitCostNGN: 0,
        gatewayFeePercent: 0,
        gatewayFixedFeeNGN: 0,
        gatewayFeeCapNGN: 0,
      }),
    })
  );

  // Categories (empty list — no filter panel data needed)
  await page.route("**/api/categories**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    })
  );
}

// ── Navigation ────────────────────────────────────────────────────────────────

/**
 * Wait for the page to finish its loading spinner / skeleton.
 */
export async function waitForPageLoad(page: Page) {
  await page.waitForLoadState("networkidle");
}
