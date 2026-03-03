// src/pages/HelpCenter.tsx
import React from "react";
import { motion } from "framer-motion";
import {
  HelpCircle,
  Search,
  ShoppingBag,
  Truck,
  ShieldCheck,
  RefreshCcw,
  Package,
  CreditCard,
  User,
  Store,
  ArrowRight,
  MessageCircle,
} from "lucide-react";

import SiteLayout from "../layouts/SiteLayout";
import { useAuthStore } from "../store/auth";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | "SUPPLIER_RIDER" | string;

const shopperFaq = [
  {
    q: "How do I find products?",
    a: [
      "Use the search bar at the top to search by product name, brand or category.",
      "Filter results by price, brand, rating or availability where available.",
      "Look for badges like “In stock” or  “Out of stock  when shown.",
    ],
  },
  {
    q: "How do I place an order?",
    a: [
      "Open a product page and choose the right variant (size, colour, pack size, etc.).",
      "Review the available supplier offers — prices and delivery timelines may differ.",
      "Click “Add to cart”, then open your cart to review items and continue to checkout.",
      "Fill in your delivery address, choose delivery option and confirm payment.",
    ],
  },
  {
    q: "How do I track my order?",
    a: [
      "Go to “My orders” from your account menu.",
      "Each order shows its current status, expected delivery date and key events.",
      "When a rider is on the way, you’ll see live updates such as “Out for delivery”.",
    ],
  },
  {
    q: "What is OTP-secured delivery?",
    a: [
      "For some orders, we generate a one-time PIN (OTP) when the rider is close.",
      "Share this code only with the DaySpring rider when the item arrives.",
      "The rider confirms the OTP in their app to complete delivery, helping prevent fraud.",
    ],
  },
  {
    q: "How do returns and refunds work?",
    a: [
      "If there’s a problem with your order, go to “My orders” and select the affected item.",
      "Click “Request return / refund” and follow the steps to tell us what went wrong.",
      "Upload clear photos of the item and packaging where possible.",
      "You can track the status of your request on the “Returns & refunds” page.",
    ],
  },
];

const supplierFaq = [
  {
    q: "How do I become a supplier?",
    a: [
      "Click “Become a supplier” from the header or Help Center.",
      "Fill in your business details and upload any required documents (e.g. CAC where applicable).",
      "Add your bank account details so we can send payouts when orders are completed.",
      "Our team may review and approve your account before your products go live.",
    ],
  },
  {
    q: "How do I add products and offers?",
    a: [
      "Use your supplier dashboard to create a new product or link to an existing DaySpring listing.",
      "Add variants (e.g. different sizes or colours) so shoppers can choose accurately.",
      "Set your base prices and, where available, variant-level prices and lead times.",
      "Keep stock and pricing up to date to remain visible in the catalog.",
    ],
  },
  {
    q: "How are orders assigned and fulfilled?",
    a: [
      "When a shopper chooses your offer, the order appears in your supplier orders panel.",
      "Prepare the items and hand them over to a DaySpring rider or your assigned rider, depending on your configuration.",
      "For OTP-secured deliveries, your rider must collect the OTP from the shopper at the door before completing delivery.",
    ],
  },
  {
    q: "How and when do I get paid?",
    a: [
      "Completed orders flow into your payouts view once any return/refund window has passed.",
      "Ensure your bank details are correct and your payout status is enabled in your profile.",
      "Payouts are usually batched; exact timing may depend on your agreement and local banking schedules.",
    ],
  },
  {
    q: "What happens when a customer requests a refund?",
    a: [
      "Refund requests that involve your products will appear in the returns/refunds area of your dashboard (where enabled).",
      "We may ask for additional information or photos from you, especially for quality disputes.",
      "Once a decision is made, you’ll see how it affects your payouts for that order.",
    ],
  },
];

const smallTipClass = "text-[11px] sm:text-xs text-ink-soft";

export default function HelpCenter() {
  const user = useAuthStore((s) => s.user);
  const role = (user?.role || "SHOPPER") as Role;
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  return (
    <SiteLayout>
      <div className="min-h-[80vh] bg-surface">
        {/* Hero */}
        <section className="border-b bg-gradient-to-br from-primary-700 via-primary-600 to-indigo-700 text-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
            <motion.div
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.4 }}
              variants={fadeUp}
              className="space-y-3"
            >
              <div className="inline-flex items-center gap-2 rounded-full bg-black/10 px-3 py-1 text-[11px] font-medium">
                <HelpCircle className="h-3.5 w-3.5" />
                Help Center
              </div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
                How can we help you today?
              </h1>
              <p className="max-w-2xl text-sm sm:text-base text-white/85">
                Step-by-step guides for shoppers and suppliers on DaySpring — from placing your first
                order to managing returns, deliveries, and payouts.
              </p>
            </motion.div>

            {/* Quick audiences */}
            <motion.div
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.5, delay: 0.1 }}
              variants={fadeUp}
              className="mt-6 grid gap-3 sm:grid-cols-3"
            >
              <a
                href="#for-shoppers"
                className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs sm:text-sm hover:bg-white/15 transition"
              >
                <ShoppingBag className="h-4 w-4" />
                <div>
                  <div className="font-semibold">I&apos;m a shopper</div>
                  <div className="text-[11px] text-white/80">
                    Learn how to browse, order, track and return items.
                  </div>
                </div>
              </a>
              <a
                href="#for-suppliers"
                className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs sm:text-sm hover:bg-white/15 transition"
              >
                <Store className="h-4 w-4" />
                <div>
                  <div className="font-semibold">I&apos;m a supplier</div>
                  <div className="text-[11px] text-white/80">
                    Onboarding, offers, stock and payouts.
                  </div>
                </div>
              </a>
              <a
                href="#returns-refunds"
                className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs sm:text-sm hover:bg-white/15 transition"
              >
                <RefreshCcw className="h-4 w-4" />
                <div>
                  <div className="font-semibold">Returns &amp; refunds</div>
                  <div className="text-[11px] text-white/80">
                    See how DaySpring handles issues and disputes.
                  </div>
                </div>
              </a>
            </motion.div>
          </div>
        </section>

        {/* Main content */}
        <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-10">
          {/* Global tips */}
          <section className="grid gap-4 lg:grid-cols-3">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
              className="lg:col-span-2 rounded-2xl border bg-white shadow-sm p-4 sm:p-5 space-y-3"
            >
              <div className="flex items-center gap-2 mb-1">
                <Search className="h-4 w-4 text-primary-600" />
                <h2 className="text-sm sm:text-base font-semibold text-ink">
                  Quick tips for using DaySpring
                </h2>
              </div>
              <ul className="space-y-2 text-[12px] sm:text-sm text-ink-soft">
                <li>
                  • Use the search bar and filters to find the best offer for each product (price,
                  delivery time, and availability may differ by supplier).
                </li>
                <li>
                  • Always double-check variant choices (size, colour, volume, etc.) before adding to
                  cart.
                </li>
                <li>
                  • Look out for status badges on your orders — they tell you exactly where things are
                  (processing, dispatched, out for delivery, delivered, refunded, etc.).
                </li>
                <li>
                  • Enable email and phone verification on your account for smoother checkout and
                  delivery updates.
                </li>
              </ul>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4, delay: 0.05 }}
              variants={fadeUp}
              className="rounded-2xl border bg-white shadow-sm p-4 sm:p-5 space-y-2"
            >
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <h3 className="text-sm font-semibold text-ink">Safety &amp; security</h3>
              </div>
              <p className="text-[12px] sm:text-sm text-ink-soft">
                DaySpring uses secure payments, OTP-verified deliveries on eligible orders and
                verified suppliers to protect both shoppers and sellers. Never share your OTP or
                account password with anyone claiming to be support.
              </p>
            </motion.div>
          </section>

          {/* For shoppers */}
          <section id="for-shoppers" className="space-y-4">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
            >
              <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-[11px] font-medium text-primary-800">
                <ShoppingBag className="h-3.5 w-3.5" />
                For shoppers
              </div>
              <h2 className="mt-2 text-lg sm:text-xl font-semibold text-ink">
                Your guide to shopping on DaySpring
              </h2>
              <p className="mt-1 text-[12px] sm:text-sm text-ink-soft max-w-2xl">
                From first visit to first delivery, here’s how to get the most out of DaySpring as a
                customer.
              </p>
            </motion.div>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Shopper journey */}
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.4 }}
                variants={fadeUp}
                className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm space-y-3"
              >
                <h3 className="text-sm sm:text-base font-semibold text-ink">Getting started</h3>
                <ol className="space-y-2 text-[12px] sm:text-sm text-ink-soft list-decimal list-inside">
                  <li>Create an account or continue as a guest to browse products.</li>
                  <li>
                    Verify your email/phone where prompted — this helps with order notifications and
                    security.
                  </li>
                  <li>
                    Set your delivery address so DaySpring can show you realistic delivery timelines.
                  </li>
                </ol>

                <h4 className="mt-3 text-sm font-semibold text-ink">Placing an order</h4>
                <ol className="space-y-2 text-[12px] sm:text-sm text-ink-soft list-decimal list-inside">
                  <li>Search or browse for the item you want.</li>
                  <li>Select the right variant (size, colour, pack size, etc.).</li>
                  <li>
                    Review available supplier offers — compare prices, delivery estimates and
                    availability.
                  </li>
                  <li>Add your chosen offer to cart and proceed to checkout.</li>
                  <li>
                    Choose a payment method and confirm. You’ll see your order instantly in{" "}
                    <span className="font-medium">My orders</span>.
                  </li>
                </ol>
              </motion.div>

              {/* Shopper FAQs */}
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.4, delay: 0.05 }}
                variants={fadeUp}
                className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm space-y-3"
              >
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-primary-600" />
                  <h3 className="text-sm sm:text-base font-semibold text-ink">
                    Common shopper questions
                  </h3>
                </div>
                <div className="space-y-2">
                  {shopperFaq.map((item) => (
                    <details
                      key={item.q}
                      className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 py-2 text-[12px] sm:text-sm"
                    >
                      <summary className="cursor-pointer font-medium text-ink flex items-center justify-between gap-2">
                        <span>{item.q}</span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-ink-soft" />
                      </summary>
                      <ul className="mt-1.5 space-y-1.5 text-ink-soft">
                        {item.a.map((line) => (
                          <li key={line}>• {line}</li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              </motion.div>
            </div>
          </section>

          {/* Shipping & delivery */}
          <section id="shipping-delivery" className="space-y-4">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
              className="flex items-center gap-2"
            >
              <Truck className="h-4 w-4 text-primary-600" />
              <h2 className="text-lg sm:text-xl font-semibold text-ink">Shipping &amp; delivery</h2>
            </motion.div>

            <div className="grid gap-4 lg:grid-cols-3">
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.4 }}
                variants={fadeUp}
                className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm"
              >
                <h3 className="text-sm font-semibold text-ink">Delivery timelines</h3>
                <p className="mt-1 text-[12px] sm:text-sm text-ink-soft">
                  Each supplier sets their own handling time and delivery estimate. At checkout,
                  DaySpring shows the best available option based on your address and the supplier’s
                  lead time.
                </p>
              </motion.div>
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.4, delay: 0.05 }}
                variants={fadeUp}
                className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm"
              >
                <h3 className="text-sm font-semibold text-ink">Delivery updates</h3>
                <p className="mt-1 text-[12px] sm:text-sm text-ink-soft">
                  You’ll receive updates when your order is accepted, packaged, dispatched and
                  delivered. You can always see the latest status in{" "}
                  <span className="font-medium">My orders</span>.
                </p>
              </motion.div>
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.4, delay: 0.1 }}
                variants={fadeUp}
                className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm"
              >
                <h3 className="text-sm font-semibold text-ink">OTP-secured deliveries</h3>
                <p className="mt-1 text-[12px] sm:text-sm text-ink-soft">
                  For some orders, we require a one-time PIN (OTP) on delivery. Only share this code
                  with the DaySpring rider at your door. This helps confirm that the right person
                  received the order.
                </p>
              </motion.div>
            </div>
          </section>

          {/* For suppliers */}
          <section id="for-suppliers" className="space-y-4">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
            >
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-800">
                <Store className="h-3.5 w-3.5" />
                For suppliers
              </div>
              <h2 className="mt-2 text-lg sm:text-xl font-semibold text-ink">
                Growing your business on DaySpring
              </h2>
              <p className="mt-1 text-[12px] sm:text-sm text-ink-soft max-w-2xl">
                DaySpring connects you with customers while handling payments, logistics and trust
                signals — so you can focus on great products and service.
              </p>
            </motion.div>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Supplier journey */}
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.4 }}
                variants={fadeUp}
                className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm space-y-3"
              >
                <h3 className="text-sm sm:text-base font-semibold text-ink">
                  Onboarding &amp; verification
                </h3>
                <ol className="space-y-2 text-[12px] sm:text-sm text-ink-soft list-decimal list-inside">
                  <li>Click “Become a supplier” and complete the registration form.</li>
                  <li>
                    Provide accurate business details and any required registration numbers or CAC
                    documents.
                  </li>
                  <li>Add your bank account details for payouts and enable payouts once approved.</li>
                </ol>

                <h3 className="mt-3 text-sm sm:text-base font-semibold text-ink">
                  Adding products &amp; offers
                </h3>
                <ol className="space-y-2 text-[12px] sm:text-sm text-ink-soft list-decimal list-inside">
                  <li>
                    Create new products or attach offers to existing DaySpring catalog items (where
                    supported).
                  </li>
                  <li>
                    Add variants (e.g. size, colour, weight) and keep stock levels accurate to avoid
                    cancellations.
                  </li>
                  <li>
                    Set clear prices and lead times. Competitive offers are more likely to be shown to
                    shoppers.
                  </li>
                </ol>
              </motion.div>

              {/* Supplier FAQs */}
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.4, delay: 0.05 }}
                variants={fadeUp}
                className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm space-y-3"
              >
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-emerald-600" />
                  <h3 className="text-sm sm:text-base font-semibold text-ink">
                    Common supplier questions
                  </h3>
                </div>
                <div className="space-y-2">
                  {supplierFaq.map((item) => (
                    <details
                      key={item.q}
                      className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 py-2 text-[12px] sm:text-sm"
                    >
                      <summary className="cursor-pointer font-medium text-ink flex items-center justify-between gap-2">
                        <span>{item.q}</span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-ink-soft" />
                      </summary>
                      <ul className="mt-1.5 space-y-1.5 text-ink-soft">
                        {item.a.map((line) => (
                          <li key={line}>• {line}</li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              </motion.div>
            </div>
          </section>

          {/* Returns & refunds */}
          <section id="returns-refunds" className="space-y-4">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
              className="flex items-center gap-2"
            >
              <RefreshCcw className="h-4 w-4 text-primary-600" />
              <h2 className="text-lg sm:text-xl font-semibold text-ink">
                Returns, refunds &amp; issues
              </h2>
            </motion.div>

            <div className="grid gap-4 lg:grid-cols-2">
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.4 }}
                variants={fadeUp}
                className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm space-y-2"
              >
                <h3 className="text-sm sm:text-base font-semibold text-ink">For shoppers</h3>
                <ul className="space-y-1.5 text-[12px] sm:text-sm text-ink-soft">
                  <li>
                    • Most items can be returned within a defined window after delivery (you’ll see
                    the exact rules at checkout or on the product page).
                  </li>
                  <li>
                    • Start from your order details, choose the item and click{" "}
                    <span className="font-medium">Request return/refund</span>.
                  </li>
                  <li>
                    • Add a clear reason, short description and photos of the issue to help us review
                    quickly.
                  </li>
                  <li>
                    • Track your case progress on the{" "}
                    <span className="font-medium">Returns &amp; refunds</span> page.
                  </li>
                </ul>
              </motion.div>

              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.4, delay: 0.05 }}
                variants={fadeUp}
                className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm space-y-2"
              >
                <h3 className="text-sm sm:text-base font-semibold text-ink">For suppliers</h3>
                <ul className="space-y-1.5 text-[12px] sm:text-sm text-ink-soft">
                  <li>
                    • When a shopper raises an issue related to your products, we may contact you for
                    clarification or additional evidence.
                  </li>
                  <li>
                    • Respond promptly through your dashboard to avoid delays in resolving the case.
                  </li>
                  <li>
                    • Final decisions can affect payouts for the affected order — this will be shown
                    in your payout/settlement view where applicable.
                  </li>
                  <li>
                    • Focus on clear descriptions and consistent packaging to reduce disputes over
                    quality or quantity.
                  </li>
                </ul>
              </motion.div>
            </div>
          </section>

          {/* Optional admin block (only visible when logged in as admin) */}
          {isAdmin && (
            <section className="space-y-3 border-t pt-6">
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.4 }}
                variants={fadeUp}
                className="rounded-2xl border bg-slate-950 text-slate-50 p-4 sm:p-5 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <h2 className="text-sm sm:text-base font-semibold">
                    Admin &amp; operations guide (internal)
                  </h2>
                </div>
                <p className="text-[12px] sm:text-sm text-slate-200/85">
                  You&apos;re viewing this because you&apos;re signed in as an admin. Use the admin
                  dashboard to review refunds, impersonate customers where permitted, manage
                  suppliers, and monitor platform health. For deeper operational playbooks, keep a
                  separate internal document or wiki (e.g. escalation rules, fraud checklists, payout
                  overrides).
                </p>
                <p className={smallTipClass + " text-slate-300"}>
                  Tip: link your internal wiki or runbook from here, but keep sensitive details behind
                  admin authentication.
                </p>
              </motion.div>
            </section>
          )}

          {/* Contact / CTA */}
          <section className="border-t pt-6 sm:pt-8">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
              className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            >
              <div>
                <h2 className="text-lg sm:text-xl font-semibold text-ink">
                  Still need help with DaySpring?
                </h2>
                <p className="mt-1 text-[12px] sm:text-sm text-ink-soft max-w-xl">
                  If something isn&apos;t clear, reach out to our support team with your order ID,
                  supplier name or any screenshots you have. We&apos;re here to help shoppers and
                  suppliers resolve issues fairly.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/contact"
                  className="inline-flex items-center justify-center rounded-xl bg-primary-600 px-4 py-2 text-xs sm:text-sm font-medium text-white hover:bg-primary-700"
                >
                  <MessageCircle className="h-4 w-4 mr-1.5" />
                  Contact support
                </a>
                <a
                  href="/returns-refunds"
                  className="inline-flex items-center justify-center rounded-xl border border-primary-200 bg-white px-4 py-2 text-xs sm:text-sm font-medium text-primary-700 hover:bg-primary-50"
                >
                  <Package className="h-4 w-4 mr-1.5" />
                  View my returns
                </a>
              </div>
            </motion.div>
          </section>
        </main>
      </div>
    </SiteLayout>
  );
}