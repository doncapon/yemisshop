// src/pages/About.tsx
import React from "react";
import { motion } from "framer-motion";
import { ShoppingBag, ShieldCheck, Truck, Store, Sparkles, Users } from "lucide-react";
import SiteLayout from "../layouts/SiteLayout";
import { useAuthStore } from "../store/auth";

// import DaySpringLogo from "../components/brand/DayspringLogo"; // optional

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

export default function About() {
  // 👇 derived auth state: true when logged in
  const hasUser = useAuthStore((s) => !!s.user);

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
            >
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                About DaySpring
              </p>
              <h1 className="mt-2 text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
                A brighter way to shop and sell online.
              </h1>
              <p className="mt-3 max-w-2xl text-sm sm:text-base text-white/85">
                DaySpring is a next-generation e-commerce marketplace built to make shopping
                simple, secure, and accessible — for shoppers, suppliers, and the communities
                around them.
              </p>
            </motion.div>
          </div>
        </section>

        {/* Main content */}
        <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-10">
          {/* Who we are */}
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
              className="space-y-4"
            >
              <h2 className="text-lg sm:text-xl font-semibold text-ink">Who we are</h2>
              <p className="text-sm sm:text-base text-ink-soft">
                DaySpring connects trusted suppliers with shoppers through a platform built on{" "}
                <span className="font-medium text-ink">transparency, reliability, and speed</span>.
                From first click to final delivery, we obsess over the small details so you don’t
                have to.
              </p>
              <p className="text-sm sm:text-base text-ink-soft">
                Our mission is simple:{" "}
                <span className="font-medium text-ink">
                  to give every shopper and every supplier a brighter beginning — every single day.
                </span>
              </p>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              variants={fadeUp}
              className="rounded-2xl border bg-white shadow-sm p-4 sm:p-5 space-y-4"
            >
              <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-[11px] font-medium text-primary-800">
                <Sparkles size={14} />
                Smart, secure marketplace
              </div>
              <ul className="space-y-3 text-sm text-ink-soft">
                <li className="flex gap-2">
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary-500" />
                  Built for African shoppers and suppliers, with real-world challenges in mind.
                </li>
                <li className="flex gap-2">
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary-500" />
                  Powered by strong technology, transparent pricing, and clear communication.
                </li>
                <li className="flex gap-2">
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary-500" />
                  Designed to feel fast, familiar, and safe — on any device.
                </li>
              </ul>
            </motion.div>
          </section>

          {/* What we stand for */}
          <section className="space-y-4">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
            >
              <h2 className="text-lg sm:text-xl font-semibold text-ink">What we stand for</h2>
              <p className="text-sm sm:text-base text-ink-soft max-w-2xl">
                DaySpring isn’t just an online store. It’s a marketplace shaped around four pillars:
                transparency, speed, security, and empowerment.
              </p>
            </motion.div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: <ShieldCheck className="h-5 w-5" />,
                  title: "Transparency",
                  body: "Clear prices, clear delivery timelines, and no hidden tricks. You always know what you’re paying for.",
                },
                {
                  icon: <ShoppingBag className="h-5 w-5" />,
                  title: "Speed & convenience",
                  body: "From browsing to checkout, every step is optimized for a fast, smooth experience.",
                },
                {
                  icon: <Truck className="h-5 w-5" />,
                  title: "Secure delivery",
                  body: "OTP-secured deliveries and verified riders help keep your orders safe from dispatch to doorstep.",
                },
                {
                  icon: <Store className="h-5 w-5" />,
                  title: "Empowering sellers",
                  body: "Verified suppliers get the tools they need to grow — from smart offers to real-time inventory.",
                },
              ].map((item) => (
                <motion.div
                  key={item.title}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, amount: 0.1 }}
                  transition={{ duration: 0.35 }}
                  variants={fadeUp}
                  className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm"
                >
                  <div className="inline-flex items-center justify-center rounded-xl bg-primary-50 text-primary-700 p-2 mb-3">
                    {item.icon}
                  </div>
                  <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                  <p className="mt-1 text-xs sm:text-sm text-ink-soft">{item.body}</p>
                </motion.div>
              ))}
            </div>
          </section>

          {/* What makes DaySpring different */}
          <section className="space-y-4">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
            >
              <h2 className="text-lg sm:text-xl font-semibold text-ink">
                What makes DaySpring different
              </h2>
              <p className="text-sm sm:text-base text-ink-soft max-w-2xl">
                Every part of the platform is designed around real people — shoppers, suppliers, and
                riders — not just transactions.
              </p>
            </motion.div>

            <div className="grid gap-4 lg:grid-cols-2">
              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.4 }}
                variants={fadeUp}
                className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm space-y-3"
              >
                <h3 className="text-sm sm:text-base font-semibold text-ink">
                  Built for trust from day one
                </h3>
                <ul className="space-y-2 text-xs sm:text-sm text-ink-soft">
                  <li>• Verified suppliers and business checks before products go live.</li>
                  <li>• Smart pricing and supplier offers so you see fair, competitive prices.</li>
                  <li>• Real-time stock and variant availability — no more “sorry, it’s out of stock”.</li>
                </ul>
              </motion.div>

              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.4, delay: 0.05 }}
                variants={fadeUp}
                className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm space-y-3"
              >
                <h3 className="text-sm sm:text-base font-semibold text-ink">
                  Customer-first by design
                </h3>
                <ul className="space-y-2 text-xs sm:text-sm text-ink-soft">
                  <li>• Clear order tracking from checkout to delivery.</li>
                  <li>• Helpful, human support when you need it.</li>
                  <li>• Feedback loops that actually shape how the platform grows.</li>
                </ul>
              </motion.div>
            </div>
          </section>

          {/* Story / vision */}
          <section className="grid gap-6 lg:grid-cols-2">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
              className="space-y-3"
            >
              <h2 className="text-lg sm:text-xl font-semibold text-ink">Our story</h2>
              <p className="text-sm sm:text-base text-ink-soft">
                DaySpring started with a simple belief:{" "}
                <span className="font-medium text-ink">
                  shopping should be joyful, not stressful.
                </span>{" "}
                What began as a way to help local sellers reach more customers has grown into a
                full ecosystem connecting shoppers, suppliers, riders, and admins in one place.
              </p>
              <p className="text-sm sm:text-base text-ink-soft">
                Behind the scenes is a team of builders, testers, and operators who care deeply
                about reliability, experience, and trust — the things you don’t always see, but
                always feel.
              </p>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4, delay: 0.05 }}
              variants={fadeUp}
              className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm space-y-4"
            >
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-medium text-indigo-800">
                <Users size={14} />
                Vision & mission
              </div>

              <div className="space-y-3 text-xs sm:text-sm text-ink-soft">
                <div>
                  <h3 className="text-sm font-semibold text-ink">Our vision</h3>
                  <p className="mt-1">
                    To become the most trusted e-commerce platform in Africa — built on integrity,
                    speed, and innovation.
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-ink">Our mission</h3>
                  <p className="mt-1">
                    To empower shoppers with convenience, empower suppliers with opportunity, and
                    empower communities with better commerce.
                  </p>
                </div>
              </div>
            </motion.div>
          </section>

          {/* CTA */}
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
                  Join the DaySpring community
                </h2>
                <p className="mt-1 text-xs sm:text-sm text-ink-soft max-w-xl">
                  Whether you’re a shopper looking for great deals or a supplier ready to grow,
                  there’s a place for you at DaySpring.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/"
                  className="inline-flex items-center justify-center rounded-xl bg-primary-600 px-4 py-2 text-xs sm:text-sm font-medium text-white hover:bg-primary-700"
                >
                  Start shopping
                </a>
                {/* Only for unauthenticated users */}
                {!hasUser && (
                  <a
                    href="/register-supplier"
                    className="inline-flex items-center justify-center rounded-xl border border-primary-200 bg-white px-4 py-2 text-xs sm:text-sm font-medium text-primary-700 hover:bg-primary-50"
                  >
                    Become a supplier
                  </a>
                )}
              </div>
            </motion.div>
          </section>
        </main>
      </div>
    </SiteLayout>
  );
}