// src/pages/TermsConditions.tsx
import React from "react";
import { motion } from "framer-motion";
import SiteLayout from "../layouts/SiteLayout";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

/**
 * Terms & Conditions for DaySpring
 *
 * NOTE: This is a general template based on your DaySpring marketplace model.
 * You should ask a qualified lawyer to review and adapt before going live.
 */
export default function TermsConditions() {
  return (
    <SiteLayout>
      <div className="min-h-[80vh] bg-surface">
        {/* Hero */}
        <section className="border-b bg-gradient-to-br from-primary-800 via-primary-700 to-indigo-800 text-white">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
            <motion.div
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.4 }}
              variants={fadeUp}
              className="space-y-3"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">
                Legal
              </p>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
                DaySpring Terms &amp; Conditions
              </h1>
              <p className="max-w-2xl text-sm sm:text-base text-white/85">
                These Terms &amp; Conditions govern your use of the DaySpring e-commerce
                marketplace, including as a shopper, supplier, or rider. By accessing or
                using DaySpring, you agree to these Terms.
              </p>
              <p className="text-[11px] sm:text-xs text-white/75">
                Last updated: {new Date().getFullYear()}
              </p>
            </motion.div>
          </div>
        </section>

        {/* Main content */}
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          {/* Intro notice */}
          <div className="rounded-2xl border bg-white shadow-sm p-4 sm:p-5 mb-6">
            <p className="text-[11px] sm:text-xs text-ink-soft">
              <span className="font-semibold text-ink">Important:</span> This document is a
              general template for the DaySpring marketplace. It does not constitute legal
              advice. You should ask a qualified lawyer to review and adapt these Terms so
              they fully comply with applicable laws in your country or region.
            </p>
          </div>

          {/* Sections */}
          <div className="prose prose-sm sm:prose-base max-w-none prose-headings:text-ink prose-p:text-ink-soft prose-li:text-ink-soft">
            {/* 1. Agreement */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              1. Agreement &amp; Scope
            </h2>
            <p>
              These Terms &amp; Conditions (&quot;Terms&quot;) apply to your access to and
              use of the DaySpring e-commerce marketplace and all related websites,
              services, features, and tools (collectively, the &quot;Services&quot;).
              &quot;DaySpring&quot;, &quot;we&quot;, &quot;us&quot; or &quot;our&quot;
              refers to the operator of the DaySpring platform.
            </p>
            <p>
              By creating an account, placing an order, registering as a supplier, using a
              rider account, or accessing any part of the Services, you agree to be bound
              by these Terms and any other policies referenced here (including our Privacy
              Policy, Returns &amp; Refunds guidance, and any supplier or rider-specific
              terms).
            </p>
            <p>
              If you do not agree to these Terms, you must not use the Services. If you
              continue to use the Services after updates to these Terms are published, you
              will be deemed to have accepted the updated Terms.
            </p>

            {/* 2. Accounts */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              2. Account Requirements &amp; Eligibility
            </h2>
            <p>
              2.1. To use certain features of the Services (including placing orders,
              registering as a supplier, and accessing payouts), you must create a
              DaySpring account (&quot;Account&quot;) and provide accurate, current, and
              complete information, such as your full name, email address, phone number,
              and delivery or business address.
            </p>
            <p>
              2.2. You are responsible for keeping your account information up to date. We
              may reject an application for an Account or suspend/close an existing
              Account at our sole discretion, for example where information appears
              inaccurate, incomplete, or fraudulent.
            </p>
            <p>
              2.3. You must be:
            </p>
            <ul>
              <li>
                (i) at least 18 years of age; or
              </li>
              <li>
                (ii) at least the age of majority in your jurisdiction of residence and
                use of the Services.
              </li>
            </ul>
            <p>
              2.4. Shoppers may use DaySpring for personal or household purchases.
              Suppliers and riders acknowledge that they are using the Services in
              connection with a business activity and not as consumers.
            </p>
            <p>
              2.5. You must not share your login credentials with any unauthorised person.
              You are fully responsible for all activities that occur under your Account.
            </p>

            {/* 3. Roles */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              3. Roles on the DaySpring Marketplace
            </h2>
            <p>
              3.1. DaySpring is a marketplace that connects independent third-party
              sellers (&quot;Suppliers&quot;) with customers (&quot;Shoppers&quot;), and
              may also connect Suppliers with delivery riders (&quot;Riders&quot;).
            </p>
            <ul>
              <li>
                <strong>Shoppers</strong> use the platform to browse products, compare
                offers from different Suppliers, place orders, and request returns or
                refunds.
              </li>
              <li>
                <strong>Suppliers</strong> list or attach offers to products, set prices
                and lead times, manage stock, and fulfil orders.
              </li>
              <li>
                <strong>Riders</strong> deliver orders on behalf of Suppliers and/or
                DaySpring, including using OTP-secured delivery flows where applicable.
              </li>
            </ul>
            <p>
              3.2. Suppliers and Riders are independent contractors/businesses, not
              employees, agents, or partners of DaySpring. They are solely responsible for
              complying with all applicable legal, tax, and regulatory requirements
              relating to their use of the Services.
            </p>

            {/* 4. Communication & Security */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              4. Communication, Security &amp; OTP
            </h2>
            <p>
              4.1. You consent to DaySpring contacting you via email, SMS, phone call,
              in-app notifications, or other channels using the contact details associated
              with your Account or orders. We will use these channels to send order
              updates, security alerts, service notices, and marketing messages where
              permitted by law.
            </p>
            <p>
              4.2. You are responsible for maintaining the confidentiality of your
              password and any one-time passcodes (OTPs) sent to you. DaySpring cannot be
              liable for loss or damage resulting from your failure to keep your Account
              and OTPs secure.
            </p>
            <p>
              4.3. For eligible deliveries, a one-time passcode (OTP) may be generated and
              shared with you when a Rider is close to your address. You must only share
              this OTP with the authorised DaySpring Rider at your door. Sharing your OTP
              with any other person may result in fraud or loss for which DaySpring
              cannot be held responsible.
            </p>

            {/* 5. User responsibilities */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              5. User Responsibilities &amp; Content
            </h2>
            <p>
              5.1. You are responsible for all information, content, and materials you
              provide, upload, or otherwise make available through the Services
              (&quot;User Content&quot;), including product listings, images, reviews,
              messages, and documents.
            </p>
            <p>
              5.2. You represent and warrant that your User Content:
            </p>
            <ul>
              <li>is accurate and not misleading;</li>
              <li>
                does not infringe any third-party intellectual property or privacy rights;
              </li>
              <li>
                complies with all applicable laws and DaySpring policies, including any
                prohibited items or content policies we publish; and
              </li>
              <li>
                does not contain abusive, defamatory, obscene, hateful, or otherwise
                offensive material.
              </li>
            </ul>
            <p>
              5.3. A breach of these Terms or any related policy, as determined at
              DaySpring&apos;s sole discretion, may result in immediate suspension or
              termination of your Account and/or access to the Services, without
              compensation.
            </p>

            {/* 6. Prohibited uses */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              6. Prohibited Uses
            </h2>
            <p>You agree that you will not use the Services to:</p>
            <ul>
              <li>
                engage in any unlawful, fraudulent, deceptive, or misleading activity;
              </li>
              <li>
                post or distribute content that is abusive, threatening, harassing,
                defamatory, obscene, or otherwise offensive;
              </li>
              <li>
                impersonate any person or entity, or misrepresent your affiliation with
                any person or entity;
              </li>
              <li>
                interfere with or disrupt the security, integrity, or performance of the
                Services, including by attempting to gain unauthorised access to any
                systems;
              </li>
              <li>
                reverse engineer, decompile, or attempt to derive source code from any
                part of the Services, except as permitted by law;
              </li>
              <li>
                use automated tools (such as bots or scrapers) to access or collect data
                from the Services without our prior written consent.
              </li>
            </ul>

            {/* 7. Prohibited items */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              7. Prohibited &amp; Restricted Items
            </h2>
            <p>
              7.1. Suppliers may not list, sell, advertise, or otherwise promote any item
              that is illegal, unsafe, or otherwise prohibited under applicable law or
              DaySpring policies. Without limitation, the following categories are
              generally prohibited or restricted:
            </p>
            <ul>
              <li>
                (a) Illegal drugs, controlled substances, drug paraphernalia, and
                prescription-only medicines;
              </li>
              <li>
                (b) Weapons, explosives, and other dangerous items, including firearms and
                ammunition;
              </li>
              <li>
                (c) Items that promote, support, or glorify hatred, violence, or
                discrimination;
              </li>
              <li>
                (d) Adult or pornographic content, services, or products not permitted by
                local law;
              </li>
              <li>
                (e) Stolen goods, counterfeit items, or items that infringe intellectual
                property rights;
              </li>
              <li>
                (f) Items restricted under international trade, export, or sanctions laws.
              </li>
            </ul>
            <p>
              7.2. DaySpring may remove any listing or content, or suspend a Supplier
              Account, where we believe a prohibited or restricted item has been listed,
              even if it has not yet been purchased.
            </p>

            {/* 8. Orders, pricing, payments */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              8. Orders, Pricing &amp; Payments
            </h2>
            <p>
              8.1. Prices displayed on DaySpring are generally shown in Nigerian Naira
              (NGN) or another local currency where indicated. Prices, discounts, and
              availability are set by Suppliers and may change at any time before you
              confirm your order at checkout.
            </p>
            <p>
              8.2. Despite our efforts, some items may be mispriced or incorrectly
              described. We do not guarantee that all descriptions, images, or other
              information are error-free. If we discover an error in price or description:
            </p>
            <ul>
              <li>
                (a) we may contact you with the correct details and give you the option to
                proceed or cancel; or
              </li>
              <li>(b) we may cancel the order and refund any amounts paid.</li>
            </ul>
            <p>
              8.3. When you place an order, you are making an offer to purchase items from
              the relevant Supplier. DaySpring (or our payment partners) will typically
              capture or authorise payment once the order is confirmed. We and/or the
              Supplier may reject or cancel orders at our discretion, including due to
              stock issues, suspected fraud, or pricing errors.
            </p>
            <p>
              8.4. Payments on DaySpring are processed by third-party payment providers
              (for example, card processors or local payment gateways). DaySpring is not a
              bank, investment platform, or financial institution. We do not hold funds on
              deposit for you; we simply facilitate payment from Shoppers to Suppliers,
              minus any fees agreed with Suppliers.
            </p>

            {/* 9. Shipping */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              9. Shipping, Delivery &amp; Risk
            </h2>
            <p>
              9.1. Delivery timelines shown on product pages or during checkout are
              estimates only and are not guaranteed. Actual delivery may vary due to
              supplier handling, Rider availability, traffic, weather, public holidays, or
              other factors outside DaySpring&apos;s control.
            </p>
            <p>
              9.2. Risk of loss or damage to items typically passes when the order is
              delivered to your stated delivery address and, where applicable, when the
              Rider successfully verifies the OTP with you. If you provide incorrect or
              incomplete address details, this may delay delivery or result in
              non-delivery, for which DaySpring and Suppliers may not be responsible.
            </p>
            <p>
              9.3. DaySpring cannot be held liable for delays or failures to deliver
              caused by events beyond our reasonable control, including strikes, civil
              commotion, security incidents, extreme weather, natural disasters,
              epidemics, or failure of third-party services.
            </p>

            {/* 10. Returns & refunds */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              10. Returns, Refunds &amp; Issues
            </h2>
            <p>
              10.1. DaySpring provides tools for Shoppers to request returns or refunds in
              line with our Returns &amp; Refunds guidance and local consumer protection
              laws. In general, you should:
            </p>
            <ul>
              <li>
                start from the relevant order in your account and select the affected
                item;
              </li>
              <li>
                submit a return/refund request within the specified window (for example,
                within seven (7) days of delivery, unless otherwise stated on the product
                page or required by law);
              </li>
              <li>
                provide accurate information and clear photos showing the issue (such as
                damage, wrong item, or missing items).
              </li>
            </ul>
            <p>
              10.2. Suppliers are responsible for honouring DaySpring&apos;s return and
              refund policies and any mandatory legal rights that apply. DaySpring may
              mediate disputes between Shoppers and Suppliers but is not a party to the
              sale contract between them.
            </p>
            <p>
              10.3. Where a refund is approved, the refund will normally be processed via
              the original payment method, subject to the timelines and processes of the
              relevant payment provider. DaySpring is not responsible for delays caused by
              third-party payment processors or banks.
            </p>

            {/* 11. Supplier & Rider */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              11. Supplier &amp; Rider Obligations
            </h2>
            <p>
              11.1. If you use DaySpring as a Supplier, you agree to:
            </p>
            <ul>
              <li>
                provide accurate product information, prices, and stock levels at all
                times;
              </li>
              <li>
                fulfil accepted orders within the stated lead time and in accordance with
                local laws and safety standards;
              </li>
              <li>
                cooperate promptly with DaySpring and Shoppers in resolving complaints,
                returns, and refunds;
              </li>
              <li>
                maintain valid business registrations, tax registrations, and any licenses
                required for your products; and
              </li>
              <li>
                keep your payout details (such as bank account information) accurate and
                up to date.
              </li>
            </ul>
            <p>
              11.2. If you use DaySpring as a Rider, you agree to:
            </p>
            <ul>
              <li>follow all instructions given through the DaySpring platform;</li>
              <li>handle orders with care and deliver them promptly and safely;</li>
              <li>
                use OTP codes and any other security steps required at the point of
                delivery; and
              </li>
              <li>
                comply with all applicable driving, transport, and safety regulations in
                the areas where you operate.
              </li>
            </ul>

            {/* 12. IP */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              12. Intellectual Property
            </h2>
            <p>
              12.1. The DaySpring platform, including its software, design, logos,
              trademarks, and all content created by or for DaySpring (excluding User
              Content and third-party marks) is owned by or licensed to DaySpring and is
              protected by intellectual property laws.
            </p>
            <p>
              12.2. DaySpring grants you a limited, non-exclusive, non-transferable, and
              revocable license to access and use the Services for their intended
              purposes, subject to your compliance with these Terms. You must not copy,
              modify, distribute, sell, or create derivative works from any part of the
              Services without our prior written permission.
            </p>
            <p>
              12.3. You retain ownership of your User Content. By uploading or posting
              User Content on DaySpring, you grant DaySpring a non-exclusive,
              worldwide, royalty-free license to host, store, display, reproduce, and use
              that content for the purpose of operating, improving, and promoting the
              Services.
            </p>

            {/* 13. Liability */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              13. Disclaimers &amp; Limitation of Liability
            </h2>
            <p>
              13.1. DaySpring is a marketplace platform. We do not manufacture, store, or
              inspect the items sold by Suppliers. Suppliers are solely responsible for
              their products, offers, and services. To the maximum extent permitted by
              law, any legal or quality claim in relation to an item you purchase must be
              brought directly against the relevant Supplier.
            </p>
            <p>
              13.2. Except where prohibited by law, DaySpring provides the Services on an
              &quot;as is&quot; and &quot;as available&quot; basis, without warranties of
              any kind, whether express or implied, including but not limited to implied
              warranties of merchantability, fitness for a particular purpose, and
              non-infringement.
            </p>
            <p>
              13.3. To the maximum extent permitted by law, DaySpring will not be liable
              for any indirect, incidental, special, consequential, or punitive damages,
              or for any loss of profits, revenue, data, or goodwill, arising out of or
              in connection with your use of the Services, whether based in contract,
              tort (including negligence), strict liability, or otherwise.
            </p>
            <p>
              13.4. Nothing in these Terms is intended to exclude or limit any rights you
              may have as a consumer under mandatory law that cannot be excluded.
            </p>

            {/* 14. Suspension / termination */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              14. Suspension &amp; Termination
            </h2>
            <p>
              14.1. DaySpring may suspend or terminate your Account or access to the
              Services at any time, with or without notice, if we reasonably believe that
              you:
            </p>
            <ul>
              <li>have breached these Terms or any applicable policy;</li>
              <li>
                have engaged in fraud, misuse, or abuse of the platform; or
              </li>
              <li>
                pose a risk to the security, integrity, or reputation of DaySpring, other
                users, or third parties.
              </li>
            </ul>
            <p>
              14.2. You may stop using the Services and request closure of your Account at
              any time. Closing your Account does not relieve you of any obligations or
              liabilities incurred before closure (for example, outstanding payments or
              unresolved disputes).
            </p>
            <p>
              14.3. Provisions which by their nature should survive termination (including
              those relating to intellectual property, limitation of liability, and
              dispute resolution) shall continue in full force and effect.
            </p>

            {/* 15. Changes */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              15. Changes to the Services &amp; Terms
            </h2>
            <p>
              15.1. DaySpring may update, modify, or discontinue any part of the Services
              at any time, including adding or removing features, adjusting fees (where
              applicable), or changing the way offers and products are displayed.
            </p>
            <p>
              15.2. We may update these Terms from time to time. When we do, we will
              publish the updated Terms on the DaySpring website and may provide
              additional notice (for example via email or in-app notification) where the
              change is material. Your continued use of the Services after the updated
              Terms are published will constitute your acceptance of the updates.
            </p>

            {/* 16. Governing law & disputes */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              16. Governing Law &amp; Dispute Resolution
            </h2>
            <p>
              16.1. Except where otherwise required by mandatory local law, these Terms
              and any non-contractual obligations arising out of or in connection with
              them are governed by the laws of the Federal Republic of Nigeria, without
              reference to its conflict of laws principles.
            </p>
            <p>
              16.2. DaySpring encourages users to contact support first to try to resolve
              issues informally. If a dispute cannot be resolved within a reasonable
              time, you and DaySpring agree to seek resolution through good-faith
              negotiations and, where both parties agree, mediation or another alternative
              dispute resolution process.
            </p>
            <p>
              16.3. Subject to any mandatory consumer rights you may have, any legal
              proceedings relating to these Terms may be brought in the courts of Nigeria
              (or another jurisdiction agreed between you and DaySpring).
            </p>

            {/* 17. Misc */}
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              17. Miscellaneous
            </h2>
            <p>
              17.1. If any provision of these Terms is found to be invalid or
              unenforceable, that provision shall be deemed modified to the minimum
              extent necessary or severed, and the remaining provisions will remain in
              full force and effect.
            </p>
            <p>
              17.2. No delay or failure by DaySpring to exercise any right or remedy under
              these Terms shall constitute a waiver of that right or remedy.
            </p>
            <p>
              17.3. You may not assign, transfer, or subcontract any of your rights or
              obligations under these Terms without our prior written consent. DaySpring
              may assign, transfer, or subcontract its rights and obligations under these
              Terms in connection with a restructuring, merger, acquisition, or sale of
              assets, or by operation of law.
            </p>
            <p>
              17.4. These Terms, together with any policies or documents referenced in
              them, constitute the entire agreement between you and DaySpring regarding
              your use of the Services.
            </p>
          </div>
        </main>
      </div>
    </SiteLayout>
  );
}