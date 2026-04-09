# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: catalog.spec.ts >> Product detail >> product detail page loads
- Location: e2e\catalog.spec.ts:66:3

# Error details

```
Test timeout of 30000ms exceeded.
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
          - generic [ref=e37]: Loading product…
    - contentinfo [ref=e38]:
      - generic [ref=e39]:
        - generic [ref=e40]:
          - link "DS DaySpringHouse" [ref=e42] [cursor=pointer]:
            - /url: /
            - generic [ref=e43]: DS
            - generic [ref=e44]: DaySpringHouse
          - paragraph [ref=e45]: Quality products from trusted suppliers. Fast delivery. Secure checkout.
        - generic [ref=e46]:
          - generic [ref=e48]:
            - generic [ref=e49]:
              - heading "Shop" [level=3] [ref=e50]
              - list [ref=e51]:
                - listitem [ref=e52]:
                  - link "Catalogue" [ref=e53] [cursor=pointer]:
                    - /url: /
                - listitem [ref=e54]:
                  - link "Cart" [ref=e55] [cursor=pointer]:
                    - /url: /cart
                - listitem [ref=e56]:
                  - link "Purchase history" [ref=e57] [cursor=pointer]:
                    - /url: /orders
                - listitem [ref=e58]:
                  - link "Your account" [ref=e59] [cursor=pointer]:
                    - /url: /profile
                - listitem [ref=e60]:
                  - link "Sessions" [ref=e61] [cursor=pointer]:
                    - /url: /account/sessions
            - generic [ref=e62]:
              - heading "Support" [level=3] [ref=e63]
              - list [ref=e64]:
                - listitem [ref=e65]:
                  - link "Help Center" [ref=e66] [cursor=pointer]:
                    - /url: /help
                - listitem [ref=e67]:
                  - link "Returns & refunds" [ref=e68] [cursor=pointer]:
                    - /url: /returns-refunds
                - listitem [ref=e69]:
                  - link "support@dayspringhouse.com" [ref=e70] [cursor=pointer]:
                    - /url: mailto:support@dayspringhouse.com
            - generic [ref=e71]:
              - heading "Company" [level=3] [ref=e72]
              - list [ref=e73]:
                - listitem [ref=e74]:
                  - link "About us" [ref=e75] [cursor=pointer]:
                    - /url: /about
                - listitem [ref=e76]:
                  - link "Careers" [ref=e77] [cursor=pointer]:
                    - /url: /careers
                - listitem [ref=e78]:
                  - link "Contact us" [ref=e79] [cursor=pointer]:
                    - /url: /contact
          - generic [ref=e82]:
            - generic [ref=e83]:
              - heading "Get deals & updates" [level=4] [ref=e84]
              - paragraph [ref=e85]: Subscribe to receive promos, new arrivals, and exclusive offers.
            - generic [ref=e86]:
              - textbox "you@example.com" [ref=e87]
              - button "Subscribe" [ref=e88]
            - paragraph [ref=e89]: By subscribing, you agree to receive marketing emails from DaySpring. You can unsubscribe at any time from the email footer.
        - generic [ref=e90]:
          - paragraph [ref=e91]: © 2026 DaySpring. All rights reserved.
          - generic [ref=e92]:
            - link "Privacy" [ref=e93] [cursor=pointer]:
              - /url: /privacy
            - link "Terms" [ref=e94] [cursor=pointer]:
              - /url: /terms
            - link "Cookies" [ref=e95] [cursor=pointer]:
              - /url: /cookies
  - generic "Notifications" [ref=e96]
```