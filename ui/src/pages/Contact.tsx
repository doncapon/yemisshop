// src/pages/Contact.tsx
import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Mail,
  Phone,
  MapPin,
  MessageCircle,
  Clock,
  Send,
  Info,
  ShieldCheck,
} from "lucide-react";
import SiteLayout from "../layouts/SiteLayout";
import api from "../api/client";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

export default function Contact() {
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [orderId, setOrderId] = useState("");
  const [message, setMessage] = useState("");
  const [topic, setTopic] = useState<"GENERAL" | "ORDER" | "SUPPLIER" | "OTHER">("GENERAL");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    setErrorMsg(null);
    setSubmitting(true);

    try {
      await api.post("/api/support/contact", {
        name: fullName,
        email,
        subject,
        orderId: orderId || undefined,
        message,
        topic,
      });

      setStatusMsg("Thanks for reaching out — we’ve received your message.");
      setErrorMsg(null);

      // reset form
      setFullName("");
      setEmail("");
      setSubject("");
      setOrderId("");
      setMessage("");
      setTopic("GENERAL");
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
              <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">
                Contact DaySpring
              </p>
              <h1 className="mt-2 text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight">
                We’re here to help you, every step of the way.
              </h1>
              <p className="mt-2 max-w-2xl text-xs sm:text-sm md:text-base text-white/85">
                Questions about an order, delivery, or becoming a supplier? Reach out and a member
                of the DaySpring team will get back to you as soon as possible.
              </p>
            </motion.div>
          </div>
        </section>

        {/* Main content */}
        <main className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-7 sm:py-9 space-y-7 sm:space-y-9">
          {/* Top grid: contact options + form */}
          <section className="grid gap-5 lg:gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.1fr)] items-start">
            {/* Contact options */}
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
              className="space-y-3 sm:space-y-4"
            >
              <h2 className="text-base sm:text-lg md:text-xl font-semibold text-ink">
                Get in touch
              </h2>
              <p className="text-[11px] sm:text-sm md:text-base text-ink-soft max-w-md">
                Choose the option that best matches your request. For anything account or order
                related, please use the email address registered on your DaySpring account.
              </p>

              <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border bg-white p-3 sm:p-4 md:p-5 shadow-sm space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-[10px] sm:text-[11px] font-medium text-primary-800">
                    <Mail size={14} />
                    Email support
                  </div>
                  <p className="text-[11px] sm:text-sm text-ink-soft">
                    For help with orders, returns, delivery issues, or general questions.
                  </p>
                  <div className="mt-1.5 text-[11px] sm:text-sm font-medium text-ink break-all">
                    support@dayspring.com
                  </div>
                </div>

                <div className="rounded-2xl border bg-white p-3 sm:p-4 md:p-5 shadow-sm space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[10px] sm:text-[11px] font-medium text-emerald-800">
                    <Phone size={14} />
                    Phone & chat
                  </div>
                  <p className="text-[11px] sm:text-sm text-ink-soft">
                    For urgent issues, you can reach us during working hours.
                  </p>
                  <div className="mt-1.5 text-[11px] sm:text-sm font-medium text-ink">
                    +234 (0) 800 000 0000
                  </div>
                  <p className="text-[10px] sm:text-[11px] text-ink-soft flex items-center gap-1 mt-1">
                    <Clock size={12} className="text-ink-soft" />
                    Mon–Sat, 9:00am – 6:00pm
                  </p>
                </div>

                <div className="rounded-2xl border bg-white p-3 sm:p-4 md:p-5 shadow-sm space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-[10px] sm:text-[11px] font-medium text-indigo-800">
                    <MessageCircle size={14} />
                    Supplier enquiries
                  </div>
                  <p className="text-[11px] sm:text-sm text-ink-soft">
                    Want to sell on DaySpring? We’ll help you get set up as a verified supplier.
                  </p>
                  <div className="mt-1.5 text-[11px] sm:text-sm font-medium text-ink break-all">
                    suppliers@dayspring.com
                  </div>
                </div>

                <div className="rounded-2xl border bg-white p-3 sm:p-4 md:p-5 shadow-sm space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full bg-zinc-50 px-3 py-1 text-[10px] sm:text-[11px] font-medium text-zinc-800">
                    <MapPin size={14} />
                    Office
                  </div>
                  <p className="text-[11px] sm:text-sm text-ink-soft">
                    Our operations are primarily online, but we’re based in:
                  </p>
                  <div className="mt-1.5 text-[11px] sm:text-sm font-medium text-ink">
                    Lagos, Nigeria
                  </div>
                  <p className="text-[10px] sm:text-[11px] text-ink-soft mt-1">
                    (Visits by appointment only.)
                  </p>
                </div>
              </div>
            </motion.div>

            {/* Contact form */}
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4, delay: 0.05 }}
              variants={fadeUp}
              className="rounded-2xl border bg-white shadow-sm p-3 sm:p-4 md:p-6"
            >
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={18} className="text-primary-600" />
                <div>
                  <h2 className="text-sm sm:text-base font-semibold text-ink">
                    Send us a message
                  </h2>
                  <p className="text-[10px] sm:text-[11px] text-ink-soft">
                    Fill in the form and we’ll get back to you as soon as we can.
                  </p>
                </div>
              </div>

              {statusMsg && (
                <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] sm:text-xs text-emerald-800">
                  {statusMsg}
                </div>
              )}
              {errorMsg && (
                <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] sm:text-xs text-rose-800">
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
                    Subject
                  </label>
                  <input
                    type="text"
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2 text-[11px] sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                    placeholder="How can we help?"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                    Topic
                  </label>
                  <select
                    value={topic}
                    onChange={(e) =>
                      setTopic(e.target.value as "GENERAL" | "ORDER" | "SUPPLIER" | "OTHER")
                    }
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2 text-[11px] sm:text-sm text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                  >
                    <option value="GENERAL">General enquiry</option>
                    <option value="ORDER">Order / delivery issue</option>
                    <option value="SUPPLIER">Supplier / seller enquiry</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                    Order ID (optional)
                  </label>
                  <input
                    type="text"
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2 text-[11px] sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                    placeholder="#DS123456"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                    Message
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2 text-[11px] sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm resize-y min-h-[90px]"
                    placeholder="Tell us a bit more about what you need help with…"
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                  <p className="text-[10px] sm:text-[11px] text-ink-soft flex items-center gap-1">
                    <Info size={12} className="text-ink-soft" />
                    We typically respond within 1–2 business days.
                  </p>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center justify-center gap-2 self-start sm:self-auto rounded-xl bg-primary-600 px-4 py-2 text-[11px] sm:text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <Send size={14} className="animate-pulse" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <Send size={14} />
                        Send message
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </section>

          {/* FAQ / quick help */}
          <section className="border-t pt-5 sm:pt-7">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4 }}
              variants={fadeUp}
              className="space-y-3 sm:space-y-4"
            >
              <h2 className="text-base sm:text-lg md:text-xl font-semibold text-ink">
                Quick answers
              </h2>
              <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
                <div className="rounded-2xl border bg-white p-3 sm:p-4 md:p-5 shadow-sm">
                  <h3 className="text-sm font-semibold text-ink">Order status</h3>
                  <p className="mt-1 text-[11px] sm:text-sm text-ink-soft">
                    You can track your order anytime from{" "}
                    <span className="font-medium text-ink">My Orders</span> in your DaySpring
                    account.
                  </p>
                </div>
                <div className="rounded-2xl border bg-white p-3 sm:p-4 md:p-5 shadow-sm">
                  <h3 className="text-sm font-semibold text-ink">Returns & refunds</h3>
                  <p className="mt-1 text-[11px] sm:text-sm text-ink-soft">
                    If there’s an issue with your item, open a return or dispute from your order
                    details page and our team will review it.
                  </p>
                </div>
                <div className="rounded-2xl border bg-white p-3 sm:p-4 md:p-5 shadow-sm">
                  <h3 className="text-sm font-semibold text-ink">Become a supplier</h3>
                  <p className="mt-1 text-[11px] sm:text-sm text-ink-soft">
                    Interested in listing your products on DaySpring? Visit the supplier registration
                    page to start your application.
                  </p>
                </div>
              </div>
            </motion.div>
          </section>
        </main>
      </div>
    </SiteLayout>
  );
}