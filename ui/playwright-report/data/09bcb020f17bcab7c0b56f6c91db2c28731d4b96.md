# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cart.spec.ts >> Cart >> add to cart from catalog increases cart count
- Location: e2e\cart.spec.ts:14:3

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
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
            - generic [ref=e36]:
              - generic [ref=e39]:
                - generic [ref=e40]:
                  - heading "Discover Products" [level=1] [ref=e41]
                  - paragraph [ref=e42]: Fresh picks, smart sorting, and instant search—tailored for you.
                - button "Filter categories & brands" [ref=e43]:
                  - img [ref=e44]
                  - text: Filter categories & brands
              - generic [ref=e54]:
                - complementary [ref=e55]:
                  - generic [ref=e56]:
                    - generic [ref=e57]:
                      - heading "Filter categories & brands" [level=3] [ref=e58]
                      - button "Reset all" [disabled] [ref=e59]
                    - generic [ref=e60]:
                      - generic [ref=e61]: Sort
                      - generic [ref=e62]:
                        - combobox [ref=e63]:
                          - option "Relevance" [selected]
                          - 'option "Price: Low → High"'
                          - 'option "Price: High → Low"'
                        - img
                    - generic [ref=e64]:
                      - generic [ref=e65]: Per page
                      - generic [ref=e66]:
                        - combobox [ref=e67]:
                          - option "8"
                          - option "12" [selected]
                          - option "24"
                        - img
                    - generic [ref=e69]:
                      - checkbox "In stock" [checked] [ref=e70]
                      - text: In stock
                    - generic [ref=e71]:
                      - generic [ref=e72]:
                        - heading "Categories" [level=4] [ref=e73]
                        - button "Reset" [disabled] [ref=e74]
                      - list [ref=e75]:
                        - listitem [ref=e76]:
                          - button "Uncategorized (3)" [ref=e77]:
                            - generic [ref=e78]: Uncategorized
                            - generic [ref=e79]: (3)
                    - generic [ref=e80]:
                      - generic [ref=e81]:
                        - heading "Price" [level=4] [ref=e82]
                        - button "Reset" [disabled] [ref=e83]
                      - list [ref=e84]:
                        - listitem [ref=e85]:
                          - button "₦1,000 – ₦4,999 (2)" [ref=e86]:
                            - generic [ref=e87]: ₦1,000 – ₦4,999
                            - generic [ref=e88]: (2)
                        - listitem [ref=e89]:
                          - button "₦10,000 – ₦49,999 (1)" [ref=e90]:
                            - generic [ref=e91]: ₦10,000 – ₦49,999
                            - generic [ref=e92]: (1)
                - generic [ref=e93]:
                  - generic [ref=e95]:
                    - img [ref=e96]
                    - textbox "Search products" [ref=e99]:
                      - /placeholder: Search products, brands, or categories…
                    - button "Search" [ref=e100]
                  - generic [ref=e101]:
                    - link "No image In stock Add to wishlist Mock Doohickey C Uncategorized ₦2,942.00 Add to cart" [ref=e102] [cursor=pointer]:
                      - /url: /products/mock-3
                      - generic [ref=e103]:
                        - generic: No image
                        - generic [ref=e104]: In stock
                        - button "Add to wishlist" [ref=e105]:
                          - img [ref=e106]
                      - generic [ref=e108]:
                        - heading "Mock Doohickey C" [level=3] [ref=e109]
                        - generic [ref=e110]: Uncategorized
                        - paragraph [ref=e112]: ₦2,942.00
                        - button "Add to cart" [ref=e115]
                    - link "No image In stock Add to wishlist Mock Widget A Uncategorized ₦4,160.00 Add to cart" [ref=e116] [cursor=pointer]:
                      - /url: /products/mock-1
                      - generic [ref=e117]:
                        - generic: No image
                        - generic [ref=e118]: In stock
                        - button "Add to wishlist" [ref=e119]:
                          - img [ref=e120]
                      - generic [ref=e122]:
                        - heading "Mock Widget A" [level=3] [ref=e123]
                        - generic [ref=e124]: Uncategorized
                        - paragraph [ref=e126]: ₦4,160.00
                        - button "Add to cart" [ref=e129]
                    - link "No image In stock Add to wishlist Mock Gadget B Uncategorized ₦10,250.00 Add to cart" [ref=e130] [cursor=pointer]:
                      - /url: /products/mock-2
                      - generic [ref=e131]:
                        - generic: No image
                        - generic [ref=e132]: In stock
                        - button "Add to wishlist" [ref=e133]:
                          - img [ref=e134]
                      - generic [ref=e136]:
                        - heading "Mock Gadget B" [level=3] [ref=e137]
                        - generic [ref=e138]: Uncategorized
                        - paragraph [ref=e140]: ₦10,250.00
                        - button "Add to cart" [ref=e143]
                  - generic [ref=e145]:
                    - generic [ref=e146]: Showing 1-3 of 3 products
                    - generic [ref=e147]:
                      - generic [ref=e148]:
                        - generic [ref=e149]: Go to
                        - spinbutton "Jump to page" [ref=e150]
                        - button "Go" [disabled] [ref=e151]
                      - generic [ref=e152]:
                        - button "First" [disabled] [ref=e153]
                        - button "Prev" [disabled] [ref=e154]
                        - button "1" [disabled] [ref=e157]
                        - button "Next" [disabled] [ref=e158]
                        - button "Last" [disabled] [ref=e159]
      - contentinfo [ref=e160]:
        - generic [ref=e161]:
          - generic [ref=e162]:
            - link "DS DaySpringHouse" [ref=e164] [cursor=pointer]:
              - /url: /
              - generic [ref=e165]: DS
              - generic [ref=e166]: DaySpringHouse
            - paragraph [ref=e167]: Quality products from trusted suppliers. Fast delivery. Secure checkout.
          - generic [ref=e168]:
            - generic [ref=e170]:
              - generic [ref=e171]:
                - heading "Shop" [level=3] [ref=e172]
                - list [ref=e173]:
                  - listitem [ref=e174]:
                    - link "Catalogue" [ref=e175] [cursor=pointer]:
                      - /url: /
                  - listitem [ref=e176]:
                    - link "Cart" [ref=e177] [cursor=pointer]:
                      - /url: /cart
                  - listitem [ref=e178]:
                    - link "Purchase history" [ref=e179] [cursor=pointer]:
                      - /url: /orders
                  - listitem [ref=e180]:
                    - link "Your account" [ref=e181] [cursor=pointer]:
                      - /url: /profile
                  - listitem [ref=e182]:
                    - link "Sessions" [ref=e183] [cursor=pointer]:
                      - /url: /account/sessions
              - generic [ref=e184]:
                - heading "Support" [level=3] [ref=e185]
                - list [ref=e186]:
                  - listitem [ref=e187]:
                    - link "Help Center" [ref=e188] [cursor=pointer]:
                      - /url: /help
                  - listitem [ref=e189]:
                    - link "Returns & refunds" [ref=e190] [cursor=pointer]:
                      - /url: /returns-refunds
                  - listitem [ref=e191]:
                    - link "support@dayspringhouse.com" [ref=e192] [cursor=pointer]:
                      - /url: mailto:support@dayspringhouse.com
              - generic [ref=e193]:
                - heading "Company" [level=3] [ref=e194]
                - list [ref=e195]:
                  - listitem [ref=e196]:
                    - link "About us" [ref=e197] [cursor=pointer]:
                      - /url: /about
                  - listitem [ref=e198]:
                    - link "Careers" [ref=e199] [cursor=pointer]:
                      - /url: /careers
                  - listitem [ref=e200]:
                    - link "Contact us" [ref=e201] [cursor=pointer]:
                      - /url: /contact
            - generic [ref=e204]:
              - generic [ref=e205]:
                - heading "Get deals & updates" [level=4] [ref=e206]
                - paragraph [ref=e207]: Subscribe to receive promos, new arrivals, and exclusive offers.
              - generic [ref=e208]:
                - textbox "you@example.com" [ref=e209]
                - button "Subscribe" [ref=e210]
              - paragraph [ref=e211]: By subscribing, you agree to receive marketing emails from DaySpring. You can unsubscribe at any time from the email footer.
          - generic [ref=e212]:
            - paragraph [ref=e213]: © 2026 DaySpring. All rights reserved.
            - generic [ref=e214]:
              - link "Privacy" [ref=e215] [cursor=pointer]:
                - /url: /privacy
              - link "Terms" [ref=e216] [cursor=pointer]:
                - /url: /terms
              - link "Cookies" [ref=e217] [cursor=pointer]:
                - /url: /cookies
    - generic "Notifications" [ref=e218]
  - generic [ref=e219]:
    - generic [ref=e221]:
      - generic [ref=e222]:
        - img [ref=e223]
        - generic [ref=e227]: Added to cart
      - button [ref=e228]:
        - img [ref=e229]
    - generic [ref=e232]:
      - generic [ref=e234]: Some quantities exceeded stock and were corrected.
      - generic [ref=e235]:
        - button "Continue shopping" [ref=e236]
        - button "View cart →" [ref=e237]
```

# Test source

```ts
  1   | // ui/e2e/cart.spec.ts
  2   | // End-to-end tests for the cart flow.
  3   | 
  4   | import { test, expect } from "@playwright/test";
  5   | import { getLocalCartCount, clearSession, setupApiMocks } from "./helpers";
  6   | 
  7   | test.describe("Cart", () => {
  8   |   test.beforeEach(async ({ page }) => {
  9   |     await clearSession(page);
  10  |     await setupApiMocks(page);
  11  |     await page.goto("/");
  12  |   });
  13  | 
  14  |   test("add to cart from catalog increases cart count", async ({ page }) => {
  15  |     // Find a product with a visible Add to Cart button
  16  |     const addBtn = page.getByRole("button", { name: /add to cart/i }).first();
  17  |     await expect(addBtn).toBeVisible({ timeout: 10_000 });
  18  | 
  19  |     const countBefore = await getLocalCartCount(page);
  20  |     await addBtn.click();
  21  |     await page.waitForTimeout(800); // allow cart toast + storage write
  22  | 
  23  |     const countAfter = await getLocalCartCount(page);
> 24  |     expect(countAfter).toBeGreaterThan(countBefore);
      |                        ^ Error: expect(received).toBeGreaterThan(expected)
  25  |   });
  26  | 
  27  |   test("cart page shows added items", async ({ page }) => {
  28  |     // Add a product
  29  |     const addBtn = page.getByRole("button", { name: /add to cart/i }).first();
  30  |     await expect(addBtn).toBeVisible({ timeout: 10_000 });
  31  |     await addBtn.click();
  32  |     await page.waitForTimeout(600);
  33  | 
  34  |     // Navigate to cart
  35  |     await page.goto("/cart");
  36  |     // Either shows item or empty-state — should not crash
  37  |     await expect(page.locator("body")).not.toContainText("Something went wrong");
  38  |     // If cart is not empty, we should see at least one article
  39  |     const items = page.locator("article");
  40  |     const count = await items.count();
  41  |     if (count > 0) {
  42  |       await expect(items.first()).toBeVisible();
  43  |     }
  44  |   });
  45  | 
  46  |   test("cart empty state has a go-shopping link", async ({ page }) => {
  47  |     // Clear the cart in localStorage (v2 guest key used by the app)
  48  |     await page.evaluate(() => {
  49  |       localStorage.removeItem("cart:guest:v2");
  50  |       localStorage.removeItem("cart"); // legacy key
  51  |     });
  52  |     await page.goto("/cart");
  53  |     // Either the empty state CTA or the cart contents
  54  |     const shopLink = page.getByRole("link", { name: /go shopping|shop/i });
  55  |     const hasShopLink = await shopLink.isVisible().catch(() => false);
  56  |     if (hasShopLink) {
  57  |       await expect(shopLink).toBeVisible();
  58  |     }
  59  |   });
  60  | 
  61  |   test("remove button removes an item from the cart", async ({ page }) => {
  62  |     // Add a product first
  63  |     const addBtn = page.getByRole("button", { name: /add to cart/i }).first();
  64  |     await expect(addBtn).toBeVisible({ timeout: 10_000 });
  65  |     await addBtn.click();
  66  |     await page.waitForTimeout(600);
  67  | 
  68  |     await page.goto("/cart");
  69  |     const removeBtn = page.getByRole("button", { name: /remove/i }).first();
  70  |     const hasRemoveBtn = await removeBtn.isVisible().catch(() => false);
  71  | 
  72  |     if (hasRemoveBtn) {
  73  |       const itemsBefore = await page.locator("article").count();
  74  |       await removeBtn.click();
  75  |       await page.waitForTimeout(600);
  76  |       const itemsAfter = await page.locator("article").count();
  77  |       expect(itemsAfter).toBeLessThan(itemsBefore);
  78  |     }
  79  |   });
  80  | 
  81  |   test("quantity stepper increments qty", async ({ page }) => {
  82  |     const addBtn = page.getByRole("button", { name: /add to cart/i }).first();
  83  |     await expect(addBtn).toBeVisible({ timeout: 10_000 });
  84  |     await addBtn.click();
  85  |     await page.waitForTimeout(600);
  86  | 
  87  |     await page.goto("/cart");
  88  | 
  89  |     const incBtn = page.getByRole("button", { name: /increase quantity|\+/i }).first();
  90  |     const hasIncBtn = await incBtn.isVisible().catch(() => false);
  91  | 
  92  |     if (hasIncBtn) {
  93  |       const qtyInput = page.getByLabel(/quantity/i).first();
  94  |       const qtyBefore = Number(await qtyInput.inputValue());
  95  |       await incBtn.click();
  96  |       await page.waitForTimeout(400);
  97  |       const qtyAfter = Number(await qtyInput.inputValue());
  98  |       expect(qtyAfter).toBe(qtyBefore + 1);
  99  |     }
  100 |   });
  101 | });
  102 | 
```