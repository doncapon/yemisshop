# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Authentication >> Forgot password >> renders forgot password page
- Location: e2e\auth.spec.ts:57:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByLabel(/email/i)
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByLabel(/email/i)

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
          - generic [ref=e37]:
            - generic [ref=e38]:
              - generic [ref=e39]: Account recovery
              - heading "Forgot your password?" [level=1] [ref=e41]
              - paragraph [ref=e42]: Enter the email linked to your account and we’ll send a secure reset link.
            - generic [ref=e43]:
              - generic [ref=e44]:
                - generic [ref=e45]: Email address
                - generic [ref=e46]:
                  - generic:
                    - img
                  - textbox "Email address" [ref=e47]:
                    - /placeholder: you@example.com
                - paragraph [ref=e48]: We’ll email you a reset link if the address is registered.
              - button "Send reset link" [disabled] [ref=e49]
              - generic [ref=e50]:
                - generic [ref=e51]:
                  - text: Remembered your password?
                  - link "Sign in" [ref=e52] [cursor=pointer]:
                    - /url: /login
                  - text: .
                - generic [ref=e53]:
                  - text: New here?
                  - link "Create an account" [ref=e54] [cursor=pointer]:
                    - /url: /register
                  - text: .
            - paragraph [ref=e55]:
              - text: By requesting a reset, you agree to our
              - link "Terms" [ref=e56] [cursor=pointer]:
                - /url: /terms
              - text: and
              - link "Privacy Policy" [ref=e57] [cursor=pointer]:
                - /url: /privacy
              - text: .
    - contentinfo [ref=e58]:
      - generic [ref=e59]:
        - generic [ref=e60]:
          - link "DS DaySpringHouse" [ref=e62] [cursor=pointer]:
            - /url: /
            - generic [ref=e63]: DS
            - generic [ref=e64]: DaySpringHouse
          - paragraph [ref=e65]: Quality products from trusted suppliers. Fast delivery. Secure checkout.
        - generic [ref=e66]:
          - generic [ref=e68]:
            - generic [ref=e69]:
              - heading "Shop" [level=3] [ref=e70]
              - list [ref=e71]:
                - listitem [ref=e72]:
                  - link "Catalogue" [ref=e73] [cursor=pointer]:
                    - /url: /
                - listitem [ref=e74]:
                  - link "Cart" [ref=e75] [cursor=pointer]:
                    - /url: /cart
                - listitem [ref=e76]:
                  - link "Purchase history" [ref=e77] [cursor=pointer]:
                    - /url: /orders
                - listitem [ref=e78]:
                  - link "Your account" [ref=e79] [cursor=pointer]:
                    - /url: /profile
                - listitem [ref=e80]:
                  - link "Sessions" [ref=e81] [cursor=pointer]:
                    - /url: /account/sessions
            - generic [ref=e82]:
              - heading "Support" [level=3] [ref=e83]
              - list [ref=e84]:
                - listitem [ref=e85]:
                  - link "Help Center" [ref=e86] [cursor=pointer]:
                    - /url: /help
                - listitem [ref=e87]:
                  - link "Returns & refunds" [ref=e88] [cursor=pointer]:
                    - /url: /returns-refunds
                - listitem [ref=e89]:
                  - link "support@dayspringhouse.com" [ref=e90] [cursor=pointer]:
                    - /url: mailto:support@dayspringhouse.com
            - generic [ref=e91]:
              - heading "Company" [level=3] [ref=e92]
              - list [ref=e93]:
                - listitem [ref=e94]:
                  - link "About us" [ref=e95] [cursor=pointer]:
                    - /url: /about
                - listitem [ref=e96]:
                  - link "Careers" [ref=e97] [cursor=pointer]:
                    - /url: /careers
                - listitem [ref=e98]:
                  - link "Contact us" [ref=e99] [cursor=pointer]:
                    - /url: /contact
          - generic [ref=e102]:
            - generic [ref=e103]:
              - heading "Get deals & updates" [level=4] [ref=e104]
              - paragraph [ref=e105]: Subscribe to receive promos, new arrivals, and exclusive offers.
            - generic [ref=e106]:
              - textbox "you@example.com" [ref=e107]
              - button "Subscribe" [ref=e108]
            - paragraph [ref=e109]: By subscribing, you agree to receive marketing emails from DaySpring. You can unsubscribe at any time from the email footer.
        - generic [ref=e110]:
          - paragraph [ref=e111]: © 2026 DaySpring. All rights reserved.
          - generic [ref=e112]:
            - link "Privacy" [ref=e113] [cursor=pointer]:
              - /url: /privacy
            - link "Terms" [ref=e114] [cursor=pointer]:
              - /url: /terms
            - link "Cookies" [ref=e115] [cursor=pointer]:
              - /url: /cookies
  - generic "Notifications" [ref=e116]
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
  15 |       await page.getByRole("button", { name: /sign in|log in/i }).click();
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
> 59 |       await expect(page.getByLabel(/email/i)).toBeVisible();
     |                                               ^ Error: expect(locator).toBeVisible() failed
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