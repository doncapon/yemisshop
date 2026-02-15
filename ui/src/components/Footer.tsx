// src/components/Footer.tsx
import { Link } from "react-router-dom";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-surface-alt border-t border-[--color-surface-ring] text-ink mt-10 overflow-x-hidden">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-6 sm:py-8">
        {/* Top: brand + summary */}
        <div className="flex flex-col gap-3 sm:gap-5">
          <div className="flex items-center gap-2">
            <Link to="/" className="inline-flex items-center gap-2 min-w-0">
              <span className="inline-grid place-items-center w-8 h-8 rounded-xl bg-primary-600 text-white text-[11px] font-semibold shrink-0">
                DS
              </span>
              <span className="font-semibold tracking-tight text-[14px] sm:text-lg truncate">
                DaySpring
              </span>
            </Link>
          </div>

          <p className="text-[11px] sm:text-sm leading-snug text-ink-soft max-w-md">
            Quality products from trusted suppliers. Fast delivery. Secure checkout.
          </p>

          {/* Payments (placeholders) */}
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span
              className="h-5 w-9 rounded bg-surface ring-1 ring-[--color-surface-ring]"
              title="Visa"
            />
            <span
              className="h-5 w-9 rounded bg-surface ring-1 ring-[--color-surface-ring]"
              title="Mastercard"
            />
            <span
              className="h-5 w-9 rounded bg-surface ring-1 ring-[--color-surface-ring]"
              title="Verve"
            />
            <span
              className="h-5 w-9 rounded bg-surface ring-1 ring-[--color-surface-ring]"
              title="Paystack"
            />
          </div>
        </div>

        {/* Links + Newsletter */}
        <div className="mt-6 flex flex-col gap-5 sm:gap-8 md:grid md:grid-cols-12 md:gap-10">
          {/* Link columns */}
          <div className="md:col-span-7 lg:col-span-8 min-w-0">
            {/* ✅ Mobile: 2 cols, Tablet+: 3 cols */}
            <div className="grid grid-cols-[0.88fr_1.12fr] sm:grid-cols-3 gap-x-3 gap-y-6">
              <div className="min-w-0">
                <h3 className="text-[11px] sm:text-sm font-semibold tracking-tight mb-2 sm:mb-3">
                  Shop
                </h3>
                <ul className="space-y-1.5 text-[11px] sm:text-sm text-ink-soft">
                  <li>
                    <Link to="/" className="hover:text-ink">
                      Catalogue
                    </Link>
                  </li>
                  <li>
                    <Link to="/cart" className="hover:text-ink">
                      Cart
                    </Link>
                  </li>
                  <li>
                    <Link to="/orders" className="hover:text-ink">
                      Purchase history
                    </Link>
                  </li>
                  <li>
                    <Link to="/profile" className="hover:text-ink">
                      Your account
                    </Link>
                  </li>
                </ul>
              </div>

              <div className="min-w-0">
                <h3 className="text-[11px] sm:text-sm font-semibold tracking-tight mb-2 sm:mb-3">
                  Support
                </h3>
                <ul className="space-y-1.5 text-[11px] sm:text-sm text-ink-soft min-w-0">
                  <li>
                    <Link to="/help" className="hover:text-ink">
                      Help Center
                    </Link>
                  </li>
                  <li>
                    <Link to="/returns" className="hover:text-ink">
                      Returns &amp; refunds
                    </Link>
                  </li>
                  <li>
                    <Link to="/shipping" className="hover:text-ink">
                      Shipping info
                    </Link>
                  </li>

                  {/* ✅ Fix: allow email to wrap nicely on mobile */}
                  <li className="min-w-0">
                    <a
                      href="mailto:support@dayspringhouse.com"
                      className="hover:text-ink whitespace-nowrap text-[10.5px] sm:text-sm"
                    >
                      support@dayspringhouse.com
                    </a>
                  </li>
                </ul>
              </div>

              <div className="min-w-0">
                <h3 className="text-[11px] sm:text-sm font-semibold tracking-tight mb-2 sm:mb-3">
                  Company
                </h3>
                <ul className="space-y-1.5 text-[11px] sm:text-sm text-ink-soft">
                  <li>
                    <Link to="/about" className="hover:text-ink">
                      About us
                    </Link>
                  </li>
                  <li>
                    <Link to="/careers" className="hover:text-ink">
                      Careers
                    </Link>
                  </li>
                  <li>
                    <Link to="/contact" className="hover:text-ink">
                      Contact
                    </Link>
                  </li>
                  <li>
                    <Link to="/blog" className="hover:text-ink">
                      Blog
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Newsletter */}
          <div className="md:col-span-5 lg:col-span-4 min-w-0">
            <div className="rounded-2xl border border-[--color-surface-ring] bg-surface p-3.5 sm:p-4">
              <div className="flex flex-col gap-2.5">
                <div className="min-w-0">
                  <h4 className="text-[13px] sm:text-sm font-semibold tracking-tight">
                    Get deals &amp; updates
                  </h4>
                  <p className="text-[11px] sm:text-sm leading-snug text-ink-soft">
                    Subscribe to receive promos, new arrivals, and exclusive offers.
                  </p>
                </div>

                <form
                  className="flex flex-col sm:flex-row gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    // integrate newsletter handler here
                  }}
                >
                  <input
                    type="email"
                    placeholder="you@example.com"
                    className="border rounded-xl px-3 py-2 text-[12px] sm:text-sm w-full outline-none focus:ring-2 ring-primary-300 bg-white"
                    required
                  />
                  <button
                    type="submit"
                    className="rounded-xl px-3 py-2 text-[12px] sm:text-sm bg-primary-600 text-white hover:bg-primary-700 transition w-full sm:w-auto font-semibold"
                  >
                    Subscribe
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-6 sm:mt-8 pt-4 sm:pt-5 border-t border-[--color-surface-ring] flex flex-col sm:flex-row items-start sm:items-center gap-2.5 sm:gap-3 justify-between text-[10px] sm:text-xs md:text-sm text-ink-soft">
          <p className="leading-snug">© {year} DaySpring. All rights reserved.</p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Link to="/privacy" className="hover:text-ink">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-ink">
              Terms
            </Link>
            <Link to="/cookies" className="hover:text-ink">
              Cookies
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
