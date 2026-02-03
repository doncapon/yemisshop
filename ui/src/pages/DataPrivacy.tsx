import { useMemo, useState } from "react";
import SiteLayout from "../layouts/SiteLayout";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Cookie,
  Lock,
  Users,
  Globe,
  Trash2,
  FileText,
  ChevronDown,
  ChevronUp,
  Mail,
} from "lucide-react";

type Section = {
  id: string;
  title: string;
  icon: React.ReactNode;
  content: React.ReactNode;
};

function Anchor({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <a
      href={`#${id}`}
      className="text-sm text-fuchsia-700 hover:underline"
      onClick={(e) => {
        // smoother feel without requiring router hash
        e.preventDefault();
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        window.history.replaceState({}, "", `#${id}`);
      }}
    >
      {children}
    </a>
  );
}

function GlassCard(props: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`rounded-2xl border border-white/40 bg-white/70 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.08)] p-5 ${
        props.className || ""
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-fuchsia-500/15 to-cyan-500/15 text-fuchsia-600 shrink-0">
            {props.icon ?? <ShieldCheck size={18} />}
          </span>
          <h2 className="text-lg font-semibold tracking-tight truncate">
            {props.title}
          </h2>
        </div>
        {props.right}
      </div>
      {props.children}
    </motion.section>
  );
}

function AccordionItem({
  id,
  title,
  icon,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-24 rounded-2xl border bg-white/80 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-4 text-left flex items-start gap-3 hover:bg-black/5 transition"
        aria-expanded={open}
      >
        <span className="mt-0.5 text-fuchsia-700">{icon}</span>
        <span className="flex-1 min-w-0">
          <div className="font-semibold text-zinc-900">{title}</div>
          <div className="text-xs text-zinc-500 mt-0.5">
            Tap to {open ? "collapse" : "expand"}
          </div>
        </span>
        <span className="text-zinc-500">{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
      </button>
      {open && <div className="px-4 pb-4 text-sm text-zinc-700 leading-relaxed">{children}</div>}
    </div>
  );
}

export default function DataPrivacy() {
  const [openId, setOpenId] = useState<string>("overview");

  const updatedAt = useMemo(() => {
    // You can replace with a build-time value or server config later
    return "February 3, 2026";
  }, []);

  const companyName = "Dayspring Household"; // <-- change to your business name
  const dpoEmail = "privacy@dayspringhouse.com"; // <-- change
  const supportEmail = "support@dayspringhouse.com"; // <-- change
  const country = "Nigeria";

  const sections: Section[] = useMemo(
    () => [
      {
        id: "overview",
        title: "Overview",
        icon: <FileText size={18} />,
        content: (
          <>
            <p>
              This Data & Privacy Notice explains how <b>{companyName}</b> collects, uses, shares and protects your
              personal data when you use our website/app, place orders, make payments, request support, or interact
              with our services.
            </p>
            <p className="mt-3">
              We aim to comply with applicable data protection laws in <b>{country}</b>, including the{" "}
              <b>Nigeria Data Protection Act 2023 (NDPA)</b>, and any relevant guidance issued by the{" "}
              <b>Nigeria Data Protection Commission (NDPC)</b>.
            </p>
          </>
        ),
      },
      {
        id: "data-we-collect",
        title: "Data we collect",
        icon: <Users size={18} />,
        content: (
          <>
            <p>
              We collect data you provide directly, data generated when you use the service, and data from trusted
              third parties (e.g., payment providers).
            </p>

            <div className="mt-3 space-y-2">
              <div>
                <b>Account & profile</b>: name, email, phone, password (stored as a secure hash), and optional profile
                details.
              </div>
              <div>
                <b>Orders & delivery</b>: items purchased, quantities, prices, delivery address, delivery instructions,
                order status and history.
              </div>
              <div>
                <b>Payments</b>: payment reference, payment status, amount, channel/provider, and timestamps.{" "}
                <b>We do not store full card details</b> on our servers (handled by payment processors).
              </div>
              <div>
                <b>Support & communications</b>: messages you send us, call logs (if you call us), and verification
                codes/OTPs (time-limited).
              </div>
              <div>
                <b>Device & usage</b>: IP address, browser type, device identifiers, pages/events in the app, and error
                logs (to keep the service reliable and secure).
              </div>
              <div>
                <b>Cookies</b>: small files to keep you logged in, remember preferences, and measure performance (see
                “Cookies” below).
              </div>
            </div>
          </>
        ),
      },
      {
        id: "why-we-use-data",
        title: "Why we use your data (purposes)",
        icon: <ShieldCheck size={18} />,
        content: (
          <>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                To create and manage your account, authenticate you, and keep your sessions secure.
              </li>
              <li>
                To process orders, fulfil deliveries, issue receipts/invoices, and handle returns/refunds.
              </li>
              <li>
                To process payments and detect/prevent fraud, misuse, and security incidents.
              </li>
              <li>
                To provide customer support and respond to your requests.
              </li>
              <li>
                To send transactional messages (order updates, payment confirmations, delivery notifications).
              </li>
              <li>
                To improve our services through analytics, debugging, performance monitoring and product testing.
              </li>
              <li>
                To comply with legal obligations (e.g., tax, accounting, consumer protection, law enforcement requests).
              </li>
            </ul>
          </>
        ),
      },
      {
        id: "legal-basis",
        title: "Legal basis (NDPA)",
        icon: <Lock size={18} />,
        content: (
          <>
            <p>
              Under NDPA, we rely on one or more lawful bases to process personal data:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>
                <b>Contract</b>: processing needed to provide services you request (e.g., fulfil your order).
              </li>
              <li>
                <b>Legal obligation</b>: where required by law (e.g., tax/accounting record keeping).
              </li>
              <li>
                <b>Legitimate interests</b>: e.g., preventing fraud, securing the platform, improving reliability—while
                respecting your rights.
              </li>
              <li>
                <b>Consent</b>: for certain optional activities such as marketing messages or non-essential cookies (where
                applicable). You can withdraw consent at any time.
              </li>
            </ul>
          </>
        ),
      },
      {
        id: "sharing",
        title: "Who we share data with",
        icon: <Users size={18} />,
        content: (
          <>
            <p>
              We may share your data only as needed to run the service. Examples:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>
                <b>Payment providers</b> (to process payments and confirm status).
              </li>
              <li>
                <b>Delivery/Logistics partners</b> (to deliver your orders).
              </li>
              <li>
                <b>Communication providers</b> (email/SMS/WhatsApp) for OTPs and transactional notifications.
              </li>
              <li>
                <b>Cloud/hosting & monitoring</b> providers (infrastructure, error logging, analytics).
              </li>
              <li>
                <b>Professional advisers</b> (lawyers, auditors) where necessary.
              </li>
              <li>
                <b>Authorities</b> when legally required or to protect rights/safety.
              </li>
            </ul>

            <p className="mt-3">
              We require vendors to protect your data and use it only to provide services to us (and not for their own
              marketing unless you separately consent).
            </p>
          </>
        ),
      },
      {
        id: "international-transfers",
        title: "International transfers",
        icon: <Globe size={18} />,
        content: (
          <>
            <p>
              Some service providers may process or store data outside {country}. When we transfer data internationally,
              we take steps to ensure appropriate safeguards are in place (e.g., contractual protections, security
              controls, and vendor due diligence) consistent with NDPA requirements.
            </p>
          </>
        ),
      },
      {
        id: "cookies",
        title: "Cookies & tracking",
        icon: <Cookie size={18} />,
        content: (
          <>
            <p>
              Cookies help the site work and improve user experience. Typical cookie categories:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>
                <b>Strictly necessary</b>: login/session, security, and basic functionality.
              </li>
              <li>
                <b>Preferences</b>: remember your settings like theme or language.
              </li>
              <li>
                <b>Analytics</b>: understand usage and improve performance (aggregated where possible).
              </li>
              <li>
                <b>Marketing</b> (optional): measure ad performance and personalise offers (if you enable it).
              </li>
            </ul>

            <p className="mt-3">
              You can control cookies via your browser settings. If you disable strictly necessary cookies, some parts of
              the service may not function properly.
            </p>
          </>
        ),
      },
      {
        id: "security",
        title: "How we protect your data",
        icon: <Lock size={18} />,
        content: (
          <>
            <ul className="list-disc pl-5 space-y-2">
              <li>Encryption in transit (HTTPS/TLS) and secure storage for sensitive fields where applicable.</li>
              <li>Passwords stored using strong hashing (not plain text).</li>
              <li>Role-based access controls and audit trails for admin actions (where implemented).</li>
              <li>Monitoring for suspicious activity and rate limiting on sensitive endpoints (e.g., OTP).</li>
              <li>Vendor due diligence and least-privilege access on infrastructure.</li>
            </ul>

            <p className="mt-3">
              No system is 100% secure, but we work to continually improve safeguards.
            </p>
          </>
        ),
      },
      {
        id: "retention",
        title: "Retention (how long we keep data)",
        icon: <Trash2 size={18} />,
        content: (
          <>
            <p>
              We keep personal data only as long as needed for the purposes above, including legal, accounting and
              dispute-resolution requirements.
            </p>

            <div className="mt-3 space-y-2">
              <div>
                <b>Account data</b>: kept while your account is active; deleted/anonymised when no longer needed (subject
                to legal retention rules).
              </div>
              <div>
                <b>Order & payment records</b>: typically retained for statutory accounting/tax obligations and to handle
                disputes/returns.
              </div>
              <div>
                <b>OTPs/verification codes</b>: stored only briefly (time-limited) for verification and security.
              </div>
              <div>
                <b>Logs</b>: retained for security and troubleshooting for a limited period.
              </div>
            </div>
          </>
        ),
      },
      {
        id: "your-rights",
        title: "Your rights (NDPA)",
        icon: <ShieldCheck size={18} />,
        content: (
          <>
            <p>
              Subject to NDPA and other applicable laws, you may have rights to:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>Request access to your personal data.</li>
              <li>Request correction of inaccurate/incomplete data.</li>
              <li>Request deletion/erasure in certain circumstances.</li>
              <li>Object to processing or request restriction in certain cases.</li>
              <li>Withdraw consent (where processing is based on consent).</li>
              <li>Request data portability (where applicable).</li>
              <li>Complain to the regulator (NDPC) if you believe your rights were violated.</li>
            </ul>

            <p className="mt-3">
              To exercise these rights, contact us using the details below. We may need to verify your identity before
              fulfilling requests.
            </p>
          </>
        ),
      },
      {
        id: "children",
        title: "Children",
        icon: <Users size={18} />,
        content: (
          <>
            <p>
              Our services are intended for adults. If you believe a child has provided us with personal data, please
              contact us so we can take appropriate steps.
            </p>
          </>
        ),
      },
      {
        id: "changes",
        title: "Changes to this notice",
        icon: <FileText size={18} />,
        content: (
          <>
            <p>
              We may update this notice from time to time. We will update the “Last updated” date and may notify you via
              the app or email when changes are material.
            </p>
          </>
        ),
      },
      {
        id: "contact",
        title: "Contact us",
        icon: <Mail size={18} />,
        content: (
          <>
            <p>
              If you have questions or requests about privacy:
            </p>
            <div className="mt-3 space-y-2">
              <div>
                <b>Privacy contact / DPO (if applicable):</b>{" "}
                <a className="text-fuchsia-700 hover:underline" href={`mailto:${dpoEmail}`}>
                  {dpoEmail}
                </a>
              </div>
              <div>
                <b>Support:</b>{" "}
                <a className="text-fuchsia-700 hover:underline" href={`mailto:${supportEmail}`}>
                  {supportEmail}
                </a>
              </div>
              <div className="text-xs text-zinc-500">
                Please include your account email/phone and a brief description of your request.
              </div>
            </div>
          </>
        ),
      },
    ],
    [companyName, country, dpoEmail, supportEmail]
  );

  const heroLinks = useMemo(
    () => [
      { id: "data-we-collect", label: "Data we collect" },
      { id: "cookies", label: "Cookies" },
      { id: "your-rights", label: "Your rights" },
      { id: "contact", label: "Contact" },
    ],
    []
  );

  return (
    <SiteLayout>
      <div className="max-w-screen-2xl mx-auto">
        {/* Hero */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(closest-side,rgba(255,0,167,0.08),transparent_70%),radial-gradient(closest-side,rgba(0,204,255,0.10),transparent_70%)]" />
          <div className="relative px-4 md:px-8 pt-10 pb-6">
            <motion.h1
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-2xl md:text-3xl font-bold tracking-tight text-zinc-900"
            >
              Data & Privacy
            </motion.h1>
            <p className="mt-2 text-sm text-zinc-600 max-w-3xl">
              Transparency matters. Here’s how we handle your data when you shop, pay, and track deliveries on{" "}
              <b>{companyName}</b>.
            </p>
            <div className="mt-3 text-xs text-zinc-500">
              Last updated: <b>{updatedAt}</b>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              {heroLinks.map((l) => (
                <span key={l.id} className="inline-flex">
                  <Anchor id={l.id}>{l.label}</Anchor>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Content grid */}
        <div className="px-4 md:px-8 pb-12 grid gap-6 lg:grid-cols-[360px_1fr]">
          {/* Left rail */}
          <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
            <GlassCard title="Quick summary" icon={<ShieldCheck size={18} />}>
              <ul className="text-sm text-zinc-700 space-y-2 leading-relaxed">
                <li>We collect data to process orders, payments, deliveries and support.</li>
                <li>We don’t sell your personal data.</li>
                <li>Payments are handled by payment providers; we don’t store full card details.</li>
                <li>You have rights under NDPA (access, correction, deletion, objection, etc.).</li>
              </ul>
            </GlassCard>

            <GlassCard title="Table of contents" icon={<FileText size={18} />}>
              <div className="grid gap-2 text-sm">
                {sections.map((s) => (
                  <Anchor key={s.id} id={s.id}>
                    {s.title}
                  </Anchor>
                ))}
              </div>
            </GlassCard>
          </div>

          {/* Right rail */}
          <div className="space-y-4">
            {sections.map((s) => (
              <AccordionItem
                key={s.id}
                id={s.id}
                title={s.title}
                icon={s.icon}
                open={openId === s.id}
                onToggle={() => setOpenId((cur) => (cur === s.id ? "" : s.id))}
              >
                {s.content}
              </AccordionItem>
            ))}

            <div className="text-[11px] text-zinc-500 pt-2">
              This page is a general notice. Your specific processing may vary depending on features you enable (e.g.,
              marketing tracking, loyalty programmes, marketplace/suppliers, etc.).
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
