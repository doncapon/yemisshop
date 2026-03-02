// src/pages/Careers.tsx
import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Briefcase,
  Users,
  Settings,
  Truck,
  ChevronRight,
  MapPin,
  Clock,
  ShieldCheck,
} from "lucide-react";
import SiteLayout from "../layouts/SiteLayout";
import api from "../api/client";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

type Role = {
  id: string;
  title: string;
  team: string;
  type: string;
  location: string;
  isNew?: boolean;
  isHot?: boolean;
  highlight?: boolean;
  summary: string;
  bullets: string[];
};

const roles: Role[] = [
  {
    id: "admin-platform",
    title: "Platform Administrator",
    team: "Operations",
    type: "Full-time",
    location: "Remote / Lagos, Nigeria",
    isNew: true,
    isHot: true,
    highlight: true,
    summary:
      "Help keep the DaySpring platform running smoothly — managing users, permissions, content, and escalations.",
    bullets: [
      "Manage user and supplier accounts, roles, and access controls.",
      "Monitor platform health, flags, and admin dashboards.",
      "Work closely with support and engineering to resolve issues quickly.",
    ],
  },
  {
    id: "admin-customer",
    title: "Customer Experience Administrator",
    team: "Customer Support",
    type: "Full-time",
    location: "Remote / Hybrid",
    isNew: true,
    highlight: true,
    summary:
      "Sit at the heart of our customer operations — coordinating tickets, escalations, and feedback loops.",
    bullets: [
      "Oversee order, refund, and dispute workflows in admin tools.",
      "Support frontline agents with decisions and approvals.",
      "Turn customer feedback into structured insights for the team.",
    ],
  },
  {
    id: "admin-supplier",
    title: "Supplier Operations Administrator",
    team: "Supplier & Marketplace",
    type: "Full-time",
    location: "Remote / Lagos, Nigeria",
    summary:
      "Support our suppliers behind the scenes — approvals, catalog checks, compliance, and quality.",
    bullets: [
      "Review and approve supplier registrations and product listings.",
      "Monitor pricing, stock, and quality signals across the marketplace.",
      "Partner with suppliers to keep catalog and offers clean and compliant.",
    ],
  },
  {
    id: "engineer-fullstack",
    title: "Full-Stack Engineer (React / Node)",
    team: "Engineering",
    type: "Full-time",
    location: "Remote-friendly",
    summary:
      "Build and improve core DaySpring experiences across shopper, supplier, and admin tools.",
    bullets: [
      "Work across our React + Node/Express + Prisma stack.",
      "Ship features that balance reliability, performance, and UX.",
      "Collaborate with design, QA, and operations on daily iterations.",
    ],
  },
  {
    id: "support-specialist",
    title: "Customer Support Specialist",
    team: "Customer Support",
    type: "Full-time",
    location: "Remote / Call-centre",
    summary:
      "Be the first friendly voice customers hear when they need help with orders, delivery, or payments.",
    bullets: [
      "Handle inbound queries via email, chat, and phone.",
      "Troubleshoot orders, deliveries, and refunds with empathy.",
      "Document recurring issues and help improve internal playbooks.",
    ],
  },
  {
    id: "rider-ops",
    title: "Rider Operations Coordinator",
    team: "Logistics",
    type: "Full-time",
    location: "On-site / Hybrid",
    summary:
      "Coordinate supplier riders, delivery routes, and OTP handovers to keep orders moving smoothly.",
    bullets: [
      "Work with suppliers and riders to schedule and track deliveries.",
      "Monitor OTP delivery flows and resolve exceptions.",
      "Support performance tracking for riders and routes.",
    ],
  },
];

export default function Careers() {
  const adminRoles = roles.filter((r) => r.title.toLowerCase().includes("admin"));
  const otherRoles = roles.filter((r) => !r.title.toLowerCase().includes("admin"));

  // Application form state
  const [selectedRoleId, setSelectedRoleId] = useState<string | "">("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null;

  const scrollToForm = () => {
    const el = document.getElementById("careers-apply-form");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleClickApplyForRole = (roleId: string) => {
    setSelectedRoleId(roleId);
    scrollToForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setStatusMsg(null);
    setErrorMsg(null);

    try {
      const fd = new FormData();
      fd.append("name", fullName);
      fd.append("email", email);
      if (selectedRole?.id) fd.append("roleId", selectedRole.id);
      if (selectedRole?.title) fd.append("roleTitle", selectedRole.title);
      if (linkedinUrl) fd.append("linkedinUrl", linkedinUrl);
      fd.append("message", message);
      if (cvFile) fd.append("cvFile", cvFile);

      await api.post("/api/careers/apply", fd); // axios will set multipart headers for FormData

      setStatusMsg("Thanks for applying — we’ve received your application.");
      setErrorMsg(null);

      // reset minimal fields (keep role selection so they remember what they applied for)
      setFullName("");
      setEmail("");
      setLinkedinUrl("");
      setCvFile(null);
      setMessage("");
    } catch (err: any) {
      const apiErr = err?.response?.data?.error || "Something went wrong. Please try again.";
      setErrorMsg(apiErr);
      setStatusMsg(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SiteLayout>
      <div className="min-h-[80vh] bg-surface">
        {/* Hero */}
        <section className="border-b bg-gradient-to-br from-primary-700 via-primary-600 to-indigo-700 text-white">
          <div className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8">
            <motion.div
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.4 }}
              variants={fadeUp}
            >
              <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">
                Careers at DaySpring
              </p>
              <h1 className="mt-2 text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight">
                Help us build a brighter way to shop and sell.
              </h1>
              <p className="mt-2 max-w-2xl text-xs sm:text-sm md:text-base text-white/85">
                DaySpring is growing, and we’re looking for people who care about reliability,
                customer experience, and thoughtful products. Right now, we’re especially keen to
                meet <span className="font-semibold">administrators</span> who can help run the
                platform behind the scenes.
              </p>
            </motion.div>
          </div>
        </section>

        {/* Main content */}
        <main className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-7 sm:py-9 space-y-7 sm:space-y-9">
          {/* Why join */}
          <section className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
              className="space-y-3 sm:space-y-4"
            >
              <h2 className="text-base sm:text-lg md:text-xl font-semibold text-ink">
                Why work at DaySpring?
              </h2>
              <p className="text-[11px] sm:text-sm md:text-base text-ink-soft">
                DaySpring is more than an online store — it’s a marketplace and an operations
                engine. You’ll be working with a small, focused team that values{" "}
                <span className="font-medium text-ink">
                  ownership, clear thinking, and steady execution
                </span>
                .
              </p>
              <p className="text-[11px] sm:text-sm md:text-base text-ink-soft">
                We care about meaningful work, not performative busyness. If you like solving
                real-world problems for shoppers, suppliers, and riders, you’ll feel at home here.
              </p>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border bg-white p-3 sm:p-4 shadow-sm">
                  <div className="inline-flex items-center justify-center rounded-xl bg-primary-50 text-primary-700 p-2 mb-2">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <h3 className="text-xs sm:text-sm font-semibold text-ink">
                    Real responsibility
                  </h3>
                  <p className="mt-1 text-[11px] sm:text-xs text-ink-soft">
                    You’ll own meaningful parts of the platform and systems, not just tasks.
                  </p>
                </div>
                <div className="rounded-2xl border bg-white p-3 sm:p-4 shadow-sm">
                  <div className="inline-flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 p-2 mb-2">
                    <Users className="h-4 w-4" />
                  </div>
                  <h3 className="text-xs sm:text-sm font-semibold text-ink">
                    Close-knit team
                  </h3>
                  <p className="mt-1 text-[11px] sm:text-xs text-ink-soft">
                    Work directly with engineering, support, and operations — short feedback loops.
                  </p>
                </div>
                <div className="rounded-2xl border bg-white p-3 sm:p-4 shadow-sm">
                  <div className="inline-flex items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 p-2 mb-2">
                    <Truck className="h-4 w-4" />
                  </div>
                  <h3 className="text-xs sm:text-sm font-semibold text-ink">
                    Real-world impact
                  </h3>
                  <p className="mt-1 text-[11px] sm:text-xs text-ink-soft">
                    Your decisions affect how people buy, sell, and receive goods every day.
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4, delay: 0.05 }}
              variants={fadeUp}
              className="rounded-2xl border bg-white p-3 sm:p-4 md:p-5 shadow-sm space-y-3"
            >
              <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-[10px] sm:text-[11px] font-medium text-primary-800">
                <Briefcase size={14} />
                We’re hiring administrators
              </div>
              <p className="text-[11px] sm:text-sm text-ink-soft">
                Administrators play a key role at DaySpring. You’ll keep our tools, workflows, and
                data clean — so the rest of the team can move faster with confidence.
              </p>
              <ul className="space-y-1.5 text-[11px] sm:text-xs text-ink-soft">
                <li>• Comfortable working across multiple dashboards and systems.</li>
                <li>• Strong attention to detail and a bias for clear documentation.</li>
                <li>• Calm under pressure and able to manage competing priorities.</li>
              </ul>
              <p className="text-[11px] sm:text-xs text-ink-soft mt-2">
                If you have experience as an admin, ops coordinator, or support lead — we’d love to
                hear from you.
              </p>
            </motion.div>
          </section>

          {/* Current roles - Admin first */}
          <section className="space-y-4 sm:space-y-5">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div>
                <h2 className="text-base sm:text-lg md:text-xl font-semibold text-ink">
                  Open roles
                </h2>
                <p className="text-[11px] sm:text-sm text-ink-soft">
                  We’re currently prioritising administrator roles, but we’re always happy to meet
                  strong candidates across operations, support, and engineering.
                </p>
              </div>
              <a
                href="mailto:careers@dayspring.com?subject=General%20application"
                className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-3 py-2 text-[11px] sm:text-sm font-medium text-white hover:bg-primary-700"
              >
                Send general application
                <ChevronRight size={14} />
              </a>
            </motion.div>

            {/* Admin roles */}
            {adminRoles.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs sm:text-sm font-semibold text-ink flex items-center gap-2">
                  <Settings size={14} className="text-primary-600" />
                  Administrator roles
                  <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 text-[10px] px-2 py-0.5">
                    Actively hiring
                  </span>
                </h3>
                <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
                  {adminRoles.map((role) => (
                    <motion.div
                      key={role.id}
                      initial="hidden"
                      whileInView="visible"
                      viewport={{ once: true, amount: 0.15 }}
                      transition={{ duration: 0.35 }}
                      variants={fadeUp}
                      className={`rounded-2xl border bg-white p-3 sm:p-4 md:p-5 shadow-sm flex flex-col ${
                        role.highlight ? "border-primary-200" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-sm sm:text-base font-semibold text-ink">
                            {role.title}
                          </h4>
                          <p className="mt-0.5 text-[11px] sm:text-xs text-ink-soft">
                            {role.team}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {(role.isNew || role.isHot) && (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 text-[9px] px-2 py-0.5">
                              {role.isNew ? "New" : "Hiring"}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-50 text-zinc-700 text-[9px] px-2 py-0.5">
                            <MapPin size={11} />
                            {role.location}
                          </span>
                        </div>
                      </div>

                      <p className="mt-2 text-[11px] sm:text-xs text-ink-soft">{role.summary}</p>

                      <ul className="mt-2 space-y-1.5 text-[11px] sm:text-xs text-ink-soft">
                        {role.bullets.map((b, idx) => (
                          <li key={idx}>• {b}</li>
                        ))}
                      </ul>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-ink-soft">
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5">
                            <Briefcase size={11} />
                            {role.type}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleClickApplyForRole(role.id)}
                          className="inline-flex items-center gap-1 rounded-xl border border-primary-200 bg-primary-50 px-3 py-1.5 text-[11px] sm:text-xs font-medium text-primary-700 hover:bg-primary-100"
                        >
                          Apply for this role
                          <ChevronRight size={13} />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Other roles */}
            {otherRoles.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs sm:text-sm font-semibold text-ink flex items-center gap-2">
                  <Users size={14} className="text-indigo-600" />
                  Other roles
                </h3>
                <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
                  {otherRoles.map((role) => (
                    <motion.div
                      key={role.id}
                      initial="hidden"
                      whileInView="visible"
                      viewport={{ once: true, amount: 0.15 }}
                      transition={{ duration: 0.35 }}
                      variants={fadeUp}
                      className="rounded-2xl border bg-white p-3 sm:p-4 md:p-5 shadow-sm flex flex-col"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-sm sm:text-base font-semibold text-ink">
                            {role.title}
                          </h4>
                          <p className="mt-0.5 text-[11px] sm:text-xs text-ink-soft">
                            {role.team}
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-50 text-zinc-700 text-[9px] px-2 py-0.5">
                          <MapPin size={11} />
                          {role.location}
                        </span>
                      </div>

                      <p className="mt-2 text-[11px] sm:text-xs text-ink-soft">{role.summary}</p>

                      <ul className="mt-2 space-y-1.5 text-[11px] sm:text-xs text-ink-soft">
                        {role.bullets.map((b, idx) => (
                          <li key={idx}>• {b}</li>
                        ))}
                      </ul>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 text-ink-soft text-[10px] sm:text-[11px] px-2 py-0.5">
                          <Briefcase size={11} />
                          {role.type}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleClickApplyForRole(role.id)}
                          className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-1.5 text-[11px] sm:text-xs font-medium text-primary-700 hover:bg-primary-50"
                        >
                          Apply
                          <ChevronRight size={13} />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Application form */}
          <section id="careers-apply-form" className="border-t pt-5 sm:pt-7">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
              className="rounded-2xl border bg-white shadow-sm p-3 sm:p-4 md:p-6 space-y-3 sm:space-y-4"
            >
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-primary-600" />
                <div>
                  <h2 className="text-base sm:text-lg md:text-xl font-semibold text-ink">
                    Apply to DaySpring
                  </h2>
                  <p className="text-[10px] sm:text-[11px] text-ink-soft">
                    Fill in a few details and attach your CV. You can also email{" "}
                    <span className="font-medium text-ink">careers@dayspring.com</span> directly.
                  </p>
                </div>
              </div>

              {statusMsg && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] sm:text-xs text-emerald-800">
                  {statusMsg}
                </div>
              )}
              {errorMsg && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] sm:text-xs text-rose-800">
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                      Full name
                    </label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2 text-[11px] sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                      placeholder="Enter your name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                      Email address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2 text-[11px] sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                    Role you’re applying for
                  </label>
                  <select
                    value={selectedRoleId}
                    onChange={(e) => setSelectedRoleId(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2 text-[11px] sm:text-sm text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                  >
                    <option value="">Select a role</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.title} — {role.team}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                      LinkedIn profile (optional)
                    </label>
                    <input
                      type="url"
                      value={linkedinUrl}
                      onChange={(e) => setLinkedinUrl(e.target.value)}
                      className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2 text-[11px] sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                      placeholder="https://www.linkedin.com/in/you"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                      CV (PDF / Word)
                    </label>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.rtf,.odt"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setCvFile(file);
                      }}
                      className="block w-full text-[11px] sm:text-sm text-ink file:mr-2 file:rounded-lg file:border file:border-slate-300 file:bg-slate-50 file:px-3 file:py-1.5 file:text-[10px] sm:file:text-xs file:font-medium file:text-ink hover:file:bg-slate-100"
                    />
                    <p className="text-[9px] sm:text-[10px] text-ink-soft">
                      Max 10MB. PDF or Word document preferred.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                    Short message
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2 text-[11px] sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm resize-y min-h-[90px]"
                    placeholder="Tell us a bit about your experience and why you’d like to work at DaySpring…"
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                  <p className="text-[10px] sm:text-[11px] text-ink-soft flex items-center gap-1">
                    <Clock size={12} />
                    We review applications on a rolling basis.
                  </p>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 self-start sm:self-auto rounded-xl bg-primary-600 px-4 py-2 text-[11px] sm:text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <ChevronRight size={14} className="animate-pulse" />
                        Sending application…
                      </>
                    ) : (
                      <>
                        <ChevronRight size={14} />
                        Submit application
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </section>
        </main>
      </div>
    </SiteLayout>
  );
}