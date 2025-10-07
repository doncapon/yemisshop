// src/components/Footer.tsx
import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="bg-surface-alt border-t border-[--color-surface-ring] text-ink">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-10">
        {/* Top: brand + newsletter */}
        <div className="grid gap-8 md:grid-cols-12 md:gap-12 items-start">
          <div className="md:col-span-4">
            <Link to="/" className="inline-flex items-center gap-2">
              <span className="inline-grid place-items-center w-9 h-9 rounded-xl bg-primary-600 text-white font-semibold">
                YS
              </span>
              <span className="font-semibold text-lg">YemiShop</span>
            </Link>
            <p className="mt-3 text-sm text-ink-soft">
              Quality products from trusted suppliers. Fast delivery. Secure checkout.
            </p>

            {/* Payments (placeholders) */}
            <div className="mt-5 flex items-center gap-3">
              <span className="h-6 w-10 rounded bg-surface ring-1 ring-[--color-surface-ring]" title="Visa" />
              <span className="h-6 w-10 rounded bg-surface ring-1 ring-[--color-surface-ring]" title="Mastercard" />
              <span className="h-6 w-10 rounded bg-surface ring-1 ring-[--color-surface-ring]" title="Verve" />
              <span className="h-6 w-10 rounded bg-surface ring-1 ring-[--color-surface-ring]" title="Paystack" />
            </div>
          </div>

          {/* Link columns */}
          <div className="md:col-span-8 grid grid-cols-2 sm:grid-cols-3 gap-8">
            <div>
              <h3 className="text-sm font-semibold mb-3">Shop</h3>
              <ul className="space-y-2 text-sm text-ink-soft">
                <li><Link to="/" className="hover:text-ink">Catalogue</Link></li>
                <li><Link to="/cart" className="hover:text-ink">Cart</Link></li>
                <li><Link to="/orders" className="hover:text-ink">Purchase history</Link></li>
                <li><Link to="/profile" className="hover:text-ink">Your account</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3">Support</h3>
              <ul className="space-y-2 text-sm text-ink-soft">
                <li><Link to="/help" className="hover:text-ink">Help Center</Link></li>
                <li><Link to="/returns" className="hover:text-ink">Returns & refunds</Link></li>
                <li><Link to="/shipping" className="hover:text-ink">Shipping info</Link></li>
                <li><a href="mailto:support@yemisshop.com" className="hover:text-ink">support@yemisshop.com</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3">Company</h3>
              <ul className="space-y-2 text-sm text-ink-soft">
                <li><Link to="/about" className="hover:text-ink">About us</Link></li>
                <li><Link to="/careers" className="hover:text-ink">Careers</Link></li>
                <li><Link to="/contact" className="hover:text-ink">Contact</Link></li>
                <li><Link to="/blog" className="hover:text-ink">Blog</Link></li>
              </ul>
            </div>
          </div>

          {/* Newsletter */}
          <div className="md:col-span-12">
            <div className="mt-2 rounded-xl border border-[--color-surface-ring] bg-surface p-4 sm:p-5">
              <div className="sm:flex sm:items-center sm:justify-between gap-4">
                <div className="max-w-xl">
                  <h4 className="font-semibold">Get deals & updates</h4>
                  <p className="text-sm text-ink-soft">
                    Subscribe to receive promos, new arrivals, and exclusive offers.
                  </p>
                </div>
                <form
                  className="mt-3 sm:mt-0 flex gap-2"
                  onSubmit={(e) => { e.preventDefault(); /* integrate later */ }}
                >
                  <input
                    type="email"
                    placeholder="you@example.com"
                    className="border rounded-lg px-3 py-2 w-64 max-w-full outline-none focus:ring-2 ring-primary-300"
                    required
                  />
                  <button
                    type="submit"
                    className="rounded-lg px-3 py-2 bg-primary-600 text-white hover:bg-primary-700 transition"
                  >
                    Subscribe
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-8 pt-6 border-t border-[--color-surface-ring] flex flex-col sm:flex-row items-center gap-3 justify-between text-sm text-ink-soft">
          <p>© {new Date().getFullYear()} YemiShop. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link to="/privacy" className="hover:text-ink">Privacy</Link>
            <Link to="/terms" className="hover:text-ink">Terms</Link>
            <Link to="/cookies" className="hover:text-ink">Cookies</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
