# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Authentication >> Registration form >> shows validation for password mismatch
- Location: e2e\auth.spec.ts:42:5

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - main [ref=e4]:
      - generic [ref=e7]: Loading page…
    - contentinfo [ref=e8]:
      - generic [ref=e9]:
        - generic [ref=e10]:
          - link "DS DaySpringHouse" [ref=e12] [cursor=pointer]:
            - /url: /
            - generic [ref=e13]: DS
            - generic [ref=e14]: DaySpringHouse
          - paragraph [ref=e15]: Quality products from trusted suppliers. Fast delivery. Secure checkout.
        - generic [ref=e16]:
          - generic [ref=e18]:
            - generic [ref=e19]:
              - heading "Shop" [level=3] [ref=e20]
              - list [ref=e21]:
                - listitem [ref=e22]:
                  - link "Catalogue" [ref=e23] [cursor=pointer]:
                    - /url: /
                - listitem [ref=e24]:
                  - link "Cart" [ref=e25] [cursor=pointer]:
                    - /url: /cart
                - listitem [ref=e26]:
                  - link "Purchase history" [ref=e27] [cursor=pointer]:
                    - /url: /orders
                - listitem [ref=e28]:
                  - link "Your account" [ref=e29] [cursor=pointer]:
                    - /url: /profile
                - listitem [ref=e30]:
                  - link "Sessions" [ref=e31] [cursor=pointer]:
                    - /url: /account/sessions
            - generic [ref=e32]:
              - heading "Support" [level=3] [ref=e33]
              - list [ref=e34]:
                - listitem [ref=e35]:
                  - link "Help Center" [ref=e36] [cursor=pointer]:
                    - /url: /help
                - listitem [ref=e37]:
                  - link "Returns & refunds" [ref=e38] [cursor=pointer]:
                    - /url: /returns-refunds
                - listitem [ref=e39]:
                  - link "support@dayspringhouse.com" [ref=e40] [cursor=pointer]:
                    - /url: mailto:support@dayspringhouse.com
            - generic [ref=e41]:
              - heading "Company" [level=3] [ref=e42]
              - list [ref=e43]:
                - listitem [ref=e44]:
                  - link "About us" [ref=e45] [cursor=pointer]:
                    - /url: /about
                - listitem [ref=e46]:
                  - link "Careers" [ref=e47] [cursor=pointer]:
                    - /url: /careers
                - listitem [ref=e48]:
                  - link "Contact us" [ref=e49] [cursor=pointer]:
                    - /url: /contact
          - generic [ref=e52]:
            - generic [ref=e53]:
              - heading "Get deals & updates" [level=4] [ref=e54]
              - paragraph [ref=e55]: Subscribe to receive promos, new arrivals, and exclusive offers.
            - generic [ref=e56]:
              - textbox "you@example.com" [ref=e57]
              - button "Subscribe" [ref=e58]
            - paragraph [ref=e59]: By subscribing, you agree to receive marketing emails from DaySpring. You can unsubscribe at any time from the email footer.
        - generic [ref=e60]:
          - paragraph [ref=e61]: © 2026 DaySpring. All rights reserved.
          - generic [ref=e62]:
            - link "Privacy" [ref=e63] [cursor=pointer]:
              - /url: /privacy
            - link "Terms" [ref=e64] [cursor=pointer]:
              - /url: /terms
            - link "Cookies" [ref=e65] [cursor=pointer]:
              - /url: /cookies
  - generic "Notifications" [ref=e66]
```