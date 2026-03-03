// src/pages/Cookies.tsx
import React from "react";
import SiteLayout from "../layouts/SiteLayout";

const sectionClass = "space-y-2";
const h2Class = "text-lg sm:text-xl font-semibold text-ink";
const h3Class = "text-sm sm:text-base font-semibold text-ink";
const pClass = "text-[12px] sm:text-sm text-ink-soft";
const liClass = "text-[12px] sm:text-sm text-ink-soft";

export default function CookiesPage() {
  const year = new Date().getFullYear();

  return (
    <SiteLayout>
      <div className="min-h-[80vh] bg-surface">
        {/* Hero */}
        <section className="border-b bg-gradient-to-br from-primary-700 via-primary-600 to-indigo-700 text-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
              Cookies &amp; similar technologies
            </h1>
            <p className="mt-3 max-w-2xl text-sm sm:text-base text-white/85">
              This page explains how DaySpring uses cookies and similar technologies on our
              website and apps, and the choices you have.
            </p>
            <p className="mt-2 text-[11px] sm:text-xs text-white/70">
              Last updated: {year}
            </p>
          </div>
        </section>

        {/* Main */}
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8 sm:space-y-10 text-ink">
          {/* 1. Intro */}
          <section className={sectionClass}>
            <h2 className={h2Class}>1. What are cookies?</h2>
            <p className={pClass}>
              Cookies are small text files that are stored on your device when you visit a
              website. They help the site remember your actions and preferences over time.
            </p>
            <p className={pClass}>
              As well as cookies, we sometimes use similar technologies such as local storage,
              session storage, and device identifiers. In this policy, we call all of these
              “cookies” for simplicity.
            </p>
          </section>

          {/* 2. Who is “DaySpring”? */}
          <section className={sectionClass}>
            <h2 className={h2Class}>2. Who is responsible for cookies on DaySpring?</h2>
            <p className={pClass}>
              When we say <strong>“DaySpring”</strong>, <strong>“we”</strong>, or{" "}
              <strong>“us”</strong>, we mean the operators of the DaySpring House e-commerce
              platform (dayspringhouse.com and related domains).
            </p>
            <p className={pClass}>
              We control the cookies used on our site, except for certain third-party cookies
              that are set and controlled by our partners (for example, payment providers or
              analytics tools).
            </p>
          </section>

          {/* 3. Types of cookies you use */}
          <section className={sectionClass}>
            <h2 className={h2Class}>3. Types of cookies we use</h2>
            <p className={pClass}>
              We use the following categories of cookies on DaySpring:
            </p>

            <div className="space-y-3">
              <div>
                <h3 className={h3Class}>3.1. Strictly necessary cookies</h3>
                <p className={pClass}>
                  These cookies are essential for the website to function and cannot be
                  switched off in our systems. They are usually only set in response to
                  actions you take, such as:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li className={liClass}>Signing in to your DaySpring account</li>
                  <li className={liClass}>Maintaining your secure session while you browse</li>
                  <li className={liClass}>Keeping items in your cart between pages</li>
                  <li className={liClass}>
                    Remembering your cookie choices and basic security settings
                  </li>
                </ul>
                <p className={pClass}>
                  Without these cookies, services you&apos;ve asked for (such as checkout and
                  secure account pages) cannot be provided.
                </p>
              </div>

              <div>
                <h3 className={h3Class}>3.2. Performance &amp; analytics cookies</h3>
                <p className={pClass}>
                  These cookies help us understand how shoppers, suppliers and admins use
                  DaySpring so we can improve the experience. For example, they may:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li className={liClass}>Count visits and traffic sources</li>
                  <li className={liClass}>See which pages are most and least popular</li>
                  <li className={liClass}>Help us identify navigation or performance issues</li>
                </ul>
                <p className={pClass}>
                  Information is usually collected in aggregate form, and we don’t use these
                  cookies to identify you directly unless explicitly stated.
                </p>
              </div>

              <div>
                <h3 className={h3Class}>3.3. Functionality cookies</h3>
                <p className={pClass}>
                  These cookies allow the site to remember choices you make, such as:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li className={liClass}>Preferred delivery addresses or locations</li>
                  <li className={liClass}>Saved filters or sort options in the catalogue</li>
                  <li className={liClass}>Whether you’ve seen particular announcements</li>
                </ul>
                <p className={pClass}>
                  If you do not allow these cookies, some features may not work as smoothly,
                  but the site will still function.
                </p>
              </div>

              <div>
                <h3 className={h3Class}>3.4. Marketing &amp; communication cookies</h3>
                <p className={pClass}>
                  Where enabled and permitted by law, we may use cookies to:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li className={liClass}>
                    Measure the effectiveness of promotions or campaigns
                  </li>
                  <li className={liClass}>
                    Avoid showing you the same pop-ups or banners repeatedly
                  </li>
                  <li className={liClass}>
                    Tailor certain messages around products or categories you interact with
                  </li>
                </ul>
                <p className={pClass}>
                  You can usually turn off non-essential marketing cookies using our cookie
                  settings or through your browser.
                </p>
              </div>
            </div>
          </section>

          {/* 4. Examples based on your actual implementation */}
          <section className={sectionClass}>
            <h2 className={h2Class}>4. How DaySpring uses cookies &amp; storage</h2>
            <p className={pClass}>
              On DaySpring, we use a mix of cookies and browser storage (like{" "}
              <strong>localStorage</strong> and <strong>sessionStorage</strong>) to provide a
              smooth experience across:
            </p>

            <ul className="list-disc list-inside space-y-1">
              <li className={liClass}>
                <strong>Authentication &amp; security</strong> – keeping you signed in to your
                account, protecting access to your dashboard and orders, and preventing
                misuse of login or password reset flows.
              </li>
              <li className={liClass}>
                <strong>Shopping experience</strong> – remembering what’s in your cart (for
                guests and signed-in users), wishlist behaviour, and basic site preferences.
              </li>
              <li className={liClass}>
                <strong>Supplier &amp; admin tools</strong> – helping suppliers and admins
                move between pages in their dashboards without constantly re-authenticating.
              </li>
              <li className={liClass}>
                <strong>Payments</strong> – enabling secure payment flows with our payment
                partners (for example, Paystack or card processors). These partners may set
                their own cookies to fight fraud, comply with regulation, and process
                payments.
              </li>
            </ul>

            <p className={pClass}>
              Some of this information is stored only for your current session (for example, in{" "}
              <code className="bg-zinc-100 px-1 rounded text-[11px]">sessionStorage</code>), and
              some may persist for longer (for example, cart contents in{" "}
              <code className="bg-zinc-100 px-1 rounded text-[11px]">localStorage</code> so you
              don&apos;t lose your cart if you close the tab).
            </p>
          </section>

          {/* 5. Consent banner vs this page */}
          <section className={sectionClass}>
            <h2 className={h2Class}>5. Cookie banner vs. this cookie page</h2>
            <p className={pClass}>
              When you visit DaySpring for the first time on a new browser, you may see a{" "}
              <strong>cookie banner</strong> or notice. That banner:
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li className={liClass}>
                Lets you know that we use cookies and similar technologies
              </li>
              <li className={liClass}>
                May ask for your consent for non-essential cookies (like analytics or
                marketing cookies)
              </li>
              <li className={liClass}>
                Allows you to accept, reject, or customise certain categories (where
                available)
              </li>
            </ul>
            <p className={pClass}>
              This <strong>Cookie policy page</strong> goes into more detail about what those
              cookies are, why we use them, and how you can manage them at any time.
            </p>
          </section>

          {/* 6. Managing your cookies */}
          <section className={sectionClass}>
            <h2 className={h2Class}>6. How you can control cookies</h2>
            <p className={pClass}>
              You have choices about how cookies are used on DaySpring:
            </p>

            <ul className="list-disc list-inside space-y-1">
              <li className={liClass}>
                <strong>Browser settings:</strong> Most web browsers let you block or delete
                cookies, or notify you before a cookie is stored. The exact steps depend on
                your browser (for example, Chrome, Safari, Firefox, Edge).
              </li>
              <li className={liClass}>
                <strong>Cookie banner / settings:</strong> If you previously accepted cookies
                and want to change your mind, you can clear cookies in your browser for
                dayspringhouse.com and revisit the site to see the banner again, or use any
                in-product “cookie settings” link we provide.
              </li>
              <li className={liClass}>
                <strong>Device settings:</strong> Mobile operating systems may offer
                additional controls over app tracking and identifiers.
              </li>
            </ul>

            <p className={pClass}>
              If you block or delete certain cookies, some features of DaySpring may not work
              correctly (for example, staying signed in, keeping items in your cart, or
              completing checkout).
            </p>
          </section>

          {/* 7. Third-party cookies */}
          <section className={sectionClass}>
            <h2 className={h2Class}>7. Third-party cookies</h2>
            <p className={pClass}>
              Some cookies are set by third parties that provide services to DaySpring. These
              may include:
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li className={liClass}>Payment processors and fraud-prevention tools</li>
              <li className={liClass}>Analytics and performance measurement providers</li>
              <li className={liClass}>
                Customer support tools or embedded content (for example, if we later add
                chat widgets or surveys)
              </li>
            </ul>
            <p className={pClass}>
              These third parties have their own privacy and cookie policies which govern how
              they use information collected via their cookies. We aim to work only with
              reputable providers that respect your privacy and comply with applicable laws.
            </p>
          </section>

          {/* 8. Data protection & privacy link */}
          <section className={sectionClass}>
            <h2 className={h2Class}>8. How cookies relate to your privacy</h2>
            <p className={pClass}>
              Some cookies collect or infer information that may be considered personal data,
              such as a device identifier, account identifier, or IP address. Our use of that
              information is also governed by our{" "}
              <a href="/privacy" className="text-primary-700 hover:underline">
                Data &amp; Privacy Notice
              </a>
              .
            </p>
            <p className={pClass}>
              Depending on where you live, you may have additional privacy rights (for example,
              the right to access, correct or delete certain data). You can learn more and
              exercise these rights via our Privacy page or by contacting us.
            </p>
          </section>

          {/* 9. Updates */}
          <section className={sectionClass}>
            <h2 className={h2Class}>9. Updates to this cookie policy</h2>
            <p className={pClass}>
              We may update this cookie policy from time to time, for example if we add new
              features, partners, or change how we use cookies. When we do, we&apos;ll update
              the “Last updated” date at the top of this page. In some cases, we may provide
              additional notice (for example, via a banner or email).
            </p>
          </section>

          {/* 10. Contact */}
          <section className={sectionClass}>
            <h2 className={h2Class}>10. Contacting us</h2>
            <p className={pClass}>
              If you have any questions about how DaySpring uses cookies or similar
              technologies, you can contact us at:
            </p>
            <p className={pClass}>
              <a
                href="mailto:support@dayspringhouse.com"
                className="text-primary-700 hover:underline"
              >
                support@dayspringhouse.com
              </a>
            </p>
            <p className="mt-2 text-[11px] sm:text-xs text-ink-soft">
              This page is for general information only and does not constitute legal advice.
            </p>
          </section>
        </main>
      </div>
    </SiteLayout>
  );
}