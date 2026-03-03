// api/src/routes/newsletter.ts
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

import { sendMail, canSendRealEmail } from "../lib/email.js";
import { prisma } from "../lib/prisma.js";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "../lib/newsletterToken.js";

const router = express.Router();

/* -----------------------------
   Helpers
----------------------------- */

const subscribeSchema = z.object({
  email: z
    .string()
    .email("Please enter a valid email address.")
    .max(320),
  // optional, but handy so you can see where signups originate
  source: z.string().max(100).optional(),
});

const unsubscribeSchema = z.object({
  token: z.string().min(1, "Missing unsubscribe token"),
});

const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => any) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// Helper to build public base URL for links in emails
const WEB_BASE_URL =
  (process.env.WEB_BASE_URL ||
    process.env.PUBLIC_WEB_URL ||
    process.env.APP_WEB_URL ||
    "").trim() || "http://localhost:5173";

/* -----------------------------
   Subscribe
----------------------------- */

/**
 * POST /api/newsletter/subscribe
 *
 * Body:    { email: string, source?: string }
 * Success: { success: true, message: string }
 * Error:   { success: false, message: string }
 */
router.post(
  "/subscribe",
  wrap(async (req, res) => {
    const parsed = subscribeSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid email address.",
      });
    }

    const rawEmail = parsed.data.email;
    const email = rawEmail.trim().toLowerCase();
    const source = parsed.data.source || "footer";

    try {
      const now = new Date();

      // 1) Upsert in DB and get the subscriber record
      const sub = await prisma.newsletterSubscriber.upsert({
        where: { email },
        create: {
          email,
          source,
          createdAt: now,
          updatedAt: now,
          confirmedAt: now,      // treat as confirmed (you can switch to double opt-in later)
          unsubscribedAt: null,
        },
        update: {
          source,
          updatedAt: now,
          unsubscribedAt: null,  // resubscribe if they had unsubscribed
        },
      });

      // 2) Build unsubscribe link
      const token = createUnsubscribeToken(sub.id);
      const unsubscribeUrl = `${WEB_BASE_URL.replace(/\/+$/, "")}/unsubscribe?token=${encodeURIComponent(
        token
      )}`;

      // 3) Welcome / confirmation email to subscriber
      const welcomeHtml = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#111">
          <h2 style="margin:0 0 8px 0">Thanks for subscribing to DaySpring</h2>
          <p style="margin:0 0 10px 0">
            You’re now signed up to receive updates from <strong>DaySpring</strong> —
            including new product drops, supplier highlights, and occasional deals.
          </p>
          <p style="margin:0 0 10px 0">
            We’ll keep messages useful and relevant to shopping on DaySpringHouse.com:
          </p>
          <ul style="margin:0 0 10px 18px;padding:0;">
            <li>New arrivals from trusted suppliers</li>
            <li>Occasional promos and discounts</li>
            <li>Platform updates that improve your shopping experience</li>
          </ul>
          <p style="margin:10px 0 6px 0;color:#6b7280;font-size:12px">
            If you no longer want these emails, you can unsubscribe anytime:
          </p>
          <p style="margin:0 0 12px 0;font-size:12px;">
            <a href="${unsubscribeUrl}" style="color:#4f46e5;">Unsubscribe from DaySpring updates</a>
          </p>
          <p style="margin:10px 0 0 0;color:#6b7280;font-size:12px">
            — DaySpring
          </p>
        </div>
      `;

      await sendMail({
        to: email,
        subject: "You’re subscribed to DaySpring updates",
        html: welcomeHtml,
      });

      // 4) Internal notification (optional)
      const internalHtml = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.5;color:#111">
          <p style="margin:0 0 6px 0">New newsletter subscriber:</p>
          <p style="margin:0 0 6px 0">
            <strong style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace">
              ${email}
            </strong>
          </p>
          <p style="margin:4px 0 0 0;color:#6b7280;font-size:12px">
            Source: ${source}
          </p>
        </div>
      `;

      await sendMail({
        to: "support@dayspringhouse.com",
        subject: `New DaySpring newsletter signup — ${email}`,
        html: internalHtml,
      });

      return res.status(201).json({
        success: true,
        message: canSendRealEmail
          ? "Thanks for subscribing! Please check your email for a welcome message."
          : "Thanks for subscribing! (Email preview logged on the server while email is in sandbox mode.)",
      });
    } catch (err) {
      console.error("[newsletter] subscribe error", err);
      return res.status(500).json({
        success: false,
        message:
          "We couldn't subscribe you right now. Please try again in a moment.",
      });
    }
  })
);

/* -----------------------------
   Unsubscribe
----------------------------- */

/**
 * POST /api/newsletter/unsubscribe
 *
 * Body: { token: string }
 * Success: { success: true, message: string }
 */
router.post(
  "/unsubscribe",
  wrap(async (req, res) => {
    const parsed = unsubscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request.",
      });
    }

    const token = parsed.data.token;
    const subscriberId = verifyUnsubscribeToken(token);

    if (!subscriberId) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired unsubscribe link.",
      });
    }

    try {
      const now = new Date();

      const sub = await prisma.newsletterSubscriber.update({
        where: { id: subscriberId },
        data: {
          unsubscribedAt: now,
          updatedAt: now,
        },
      });

      // Optional: send confirmation email
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#111">
          <h2 style="margin:0 0 8px 0">You’ve been unsubscribed</h2>
          <p style="margin:0 0 10px 0">
            You will no longer receive DaySpring newsletter updates at
            <strong>${sub.email}</strong>.
          </p>
          <p style="margin:0 0 10px 0;color:#6b7280;font-size:12px">
            If this was a mistake, you can subscribe again anytime from the DaySpring website footer
            or your account pages.
          </p>
          <p style="margin:10px 0 0 0;color:#6b7280;font-size:12px">
            — DaySpring
          </p>
        </div>
      `;

      await sendMail({
        to: sub.email,
        subject: "You’ve been unsubscribed from DaySpring updates",
        html,
      });

      return res.json({
        success: true,
        message: "You have been unsubscribed from DaySpring updates.",
      });
    } catch (err: any) {
      console.error("[newsletter] unsubscribe error", err);

      // Handle not-found gracefully (token could be from a deleted subscriber)
      if (err?.code === "P2025") {
        return res.json({
          success: true,
          message: "You have already been unsubscribed.",
        });
      }

      return res.status(500).json({
        success: false,
        message: "We couldn't process your unsubscribe request. Please try again later.",
      });
    }
  })
);

export default router;