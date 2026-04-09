# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Authentication >> Login form validation >> shows error when email is empty
- Location: e2e\auth.spec.ts:13:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: /sign in|log in/i })
    - locator resolved to <button type="submit" class="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-600 to-pink-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:shadow-md focus:outline-none focus:ring-4 focus:ring-fuchsia-300/40 active:scale-[0.995] disabled:opacity-50">Log in</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - main [ref=e4]:
      - generic [ref=e6]:
        - generic [ref=e8]:
          - generic [ref=e9]:
            - link "DaySpring home" [ref=e10] [cursor=pointer]:
              - /url: /
              - generic:
                - generic:
                  - img "DaySpring"
                  - generic: DaySpring
            - navigation [ref=e11]:
              - link "Products" [ref=e12] [cursor=pointer]:
                - /url: /
                - generic:
                  - img
                - generic: Products
              - link "Cart" [ref=e13] [cursor=pointer]:
                - /url: /cart
                - generic:
                  - img
                - generic: Cart
          - generic [ref=e15]:
            - button "Become a supplier" [ref=e16]:
              - img [ref=e17]
              - generic [ref=e21]: Become a supplier
            - button "Login" [ref=e22]:
              - img [ref=e23]
              - generic [ref=e26]: Login
            - button "Register" [ref=e27]:
              - img [ref=e28]
              - generic [ref=e31]: Register
        - main [ref=e33]:
          - generic [ref=e38]:
            - generic [ref=e39]:
              - generic [ref=e42]:
                - img "DaySpring" [ref=e43]
                - generic [ref=e60]: DaySpring
              - heading "Sign in" [level=1] [ref=e61]
              - paragraph [ref=e62]: Access your cart, orders and personalised dashboard.
            - generic [ref=e63]:
              - generic [ref=e64]:
                - generic [ref=e65]: Email
                - generic [ref=e66]:
                  - textbox "Email" [ref=e67]:
                    - /placeholder: you@example.com
                  - generic: ✉
              - generic [ref=e68]:
                - generic [ref=e69]:
                  - generic [ref=e70]: Password
                  - link "Forgot password?" [ref=e71] [cursor=pointer]:
                    - /url: /forgot-password
                - generic [ref=e72]:
                  - textbox "Password" [ref=e73]:
                    - /placeholder: ••••••••
                  - button "Show" [ref=e74]:
                    - img [ref=e75]
              - button "Log in" [ref=e78]
              - generic [ref=e79]:
                - text: Don’t have an account?
                - link "Create one" [ref=e80] [cursor=pointer]:
                  - /url: /register
            - paragraph [ref=e81]:
              - text: Secured by industry-standard encryption • Need help?
              - link "Contact support" [ref=e82] [cursor=pointer]:
                - /url: /support
    - contentinfo [ref=e83]:
      - generic [ref=e84]:
        - generic [ref=e85]:
          - link "DS DaySpringHouse" [ref=e87] [cursor=pointer]:
            - /url: /
            - generic [ref=e88]: DS
            - generic [ref=e89]: DaySpringHouse
          - paragraph [ref=e90]: Quality products from trusted suppliers. Fast delivery. Secure checkout.
        - generic [ref=e91]:
          - generic [ref=e93]:
            - generic [ref=e94]:
              - heading "Shop" [level=3] [ref=e95]
              - list [ref=e96]:
                - listitem [ref=e97]:
                  - link "Catalogue" [ref=e98] [cursor=pointer]:
                    - /url: /
                - listitem [ref=e99]:
                  - link "Cart" [ref=e100] [cursor=pointer]:
                    - /url: /cart
                - listitem [ref=e101]:
                  - link "Purchase history" [ref=e102] [cursor=pointer]:
                    - /url: /orders
                - listitem [ref=e103]:
                  - link "Your account" [ref=e104] [cursor=pointer]:
                    - /url: /profile
                - listitem [ref=e105]:
                  - link "Sessions" [ref=e106] [cursor=pointer]:
                    - /url: /account/sessions
            - generic [ref=e107]:
              - heading "Support" [level=3] [ref=e108]
              - list [ref=e109]:
                - listitem [ref=e110]:
                  - link "Help Center" [ref=e111] [cursor=pointer]:
                    - /url: /help
                - listitem [ref=e112]:
                  - link "Returns & refunds" [ref=e113] [cursor=pointer]:
                    - /url: /returns-refunds
                - listitem [ref=e114]:
                  - link "support@dayspringhouse.com" [ref=e115] [cursor=pointer]:
                    - /url: mailto:support@dayspringhouse.com
            - generic [ref=e116]:
              - heading "Company" [level=3] [ref=e117]
              - list [ref=e118]:
                - listitem [ref=e119]:
                  - link "About us" [ref=e120] [cursor=pointer]:
                    - /url: /about
                - listitem [ref=e121]:
                  - link "Careers" [ref=e122] [cursor=pointer]:
                    - /url: /careers
                - listitem [ref=e123]:
                  - link "Contact us" [ref=e124] [cursor=pointer]:
                    - /url: /contact
          - generic [ref=e127]:
            - generic [ref=e128]:
              - heading "Get deals & updates" [level=4] [ref=e129]
              - paragraph [ref=e130]: Subscribe to receive promos, new arrivals, and exclusive offers.
            - generic [ref=e131]:
              - textbox "you@example.com" [ref=e132]
              - button "Subscribe" [ref=e133]
            - paragraph [ref=e134]: By subscribing, you agree to receive marketing emails from DaySpring. You can unsubscribe at any time from the email footer.
        - generic [ref=e135]:
          - paragraph [ref=e136]: © 2026 DaySpring. All rights reserved.
          - generic [ref=e137]:
            - link "Privacy" [ref=e138] [cursor=pointer]:
              - /url: /privacy
            - link "Terms" [ref=e139] [cursor=pointer]:
              - /url: /terms
            - link "Cookies" [ref=e140] [cursor=pointer]:
              - /url: /cookies
  - generic "Notifications" [ref=e141]
```

# Test source

```ts
  1  | // ui/e2e/auth.spec.ts
  2  | // End-to-end tests for login, register, and logout flows.
  3  | 
  4  | import { test, expect } from "@playwright/test";
  5  | import { clearSession } from "./helpers";
  6  | 
  7  | test.describe("Authentication", () => {
  8  |   test.beforeEach(async ({ page }) => {
  9  |     await clearSession(page);
  10 |   });
  11 | 
  12 |   test.describe("Login form validation", () => {
  13 |     test("shows error when email is empty", async ({ page }) => {
  14 |       await page.goto("/login");
> 15 |       await page.getByRole("button", { name: /sign in|log in/i }).click();
     |                                                                   ^ Error: locator.click: Test timeout of 30000ms exceeded.
  16 |       // Should show some validation feedback (HTML5 or custom)
  17 |       const emailInput = page.getByLabel(/email/i);
  18 |       await expect(emailInput).toBeVisible();
  19 |     });
  20 | 
  21 |     test("shows error with invalid credentials", async ({ page }) => {
  22 |       await page.goto("/login");
  23 |       await page.getByLabel(/email/i).fill("notareal@user.com");
  24 |       await page.getByLabel(/password/i).fill("WrongPassword123!");
  25 |       await page.getByRole("button", { name: /sign in|log in/i }).click();
  26 | 
  27 |       // Should show an error message (not navigate away)
  28 |       await page.waitForTimeout(1500);
  29 |       await expect(page).toHaveURL(/login/);
  30 |     });
  31 |   });
  32 | 
  33 |   test.describe("Registration form", () => {
  34 |     test("renders the registration form", async ({ page }) => {
  35 |       await page.goto("/register");
  36 |       // Check for key fields
  37 |       await expect(page.getByLabel(/email/i).first()).toBeVisible();
  38 |       // Scope to the form to avoid matching a nav "Register" link
  39 |       await expect(page.locator("form").getByRole("button", { name: /create account|register|sign up/i })).toBeVisible();
  40 |     });
  41 | 
  42 |     test("shows validation for password mismatch", async ({ page }) => {
  43 |       await page.goto("/register");
  44 |       const passwordFields = await page.getByLabel(/password/i).all();
  45 |       if (passwordFields.length >= 2) {
  46 |         await passwordFields[0].fill("Password123!");
  47 |         await passwordFields[1].fill("Different456!");
  48 |         await page.locator("form").getByRole("button", { name: /create account|register|sign up/i }).click();
  49 |         // Should still be on register page
  50 |         await page.waitForTimeout(500);
  51 |         await expect(page).toHaveURL(/register/);
  52 |       }
  53 |     });
  54 |   });
  55 | 
  56 |   test.describe("Forgot password", () => {
  57 |     test("renders forgot password page", async ({ page }) => {
  58 |       await page.goto("/forgot-password");
  59 |       await expect(page.getByLabel(/email/i)).toBeVisible();
  60 |     });
  61 |   });
  62 | 
  63 |   test.describe("Protected routes redirect to login", () => {
  64 |     test("/orders redirects to login when not authenticated", async ({ page }) => {
  65 |       await page.goto("/orders");
  66 |       await page.waitForURL(/login|orders/, { timeout: 5000 });
  67 |       // If redirected to login, pass. If stayed on orders (guest allowed), also pass.
  68 |       const url = page.url();
  69 |       expect(url.includes("login") || url.includes("orders")).toBe(true);
  70 |     });
  71 | 
  72 |     test("/profile redirects to login when not authenticated", async ({ page }) => {
  73 |       await page.goto("/profile");
  74 |       await page.waitForURL(/login|profile/, { timeout: 5000 });
  75 |       const url = page.url();
  76 |       expect(url.includes("login") || url.includes("profile")).toBe(true);
  77 |     });
  78 |   });
  79 | });
  80 | 
```