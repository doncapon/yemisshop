// api/src/routes/adminNewsletter.ts
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { sendMail } from "../lib/email.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { createUnsubscribeToken } from "../lib/newsletterToken.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => any) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const broadcastSchema = z.object({
  subject: z.string().min(3, "Subject is required").max(200),
  html: z.string().min(5, "HTML content is required"),
  // optional flags so you can test safely
  // 👉 default is FALSE, so real sends happen unless you explicitly request dryRun
  dryRun: z.boolean().default(false),
  limit: z.number().int().positive().max(5000).optional(), // safety cap
});

// Base URL for unsubscribe links
const WEB_BASE_URL =
  (process.env.WEB_BASE_URL ||
    process.env.PUBLIC_WEB_URL ||
    process.env.APP_WEB_URL ||
    "").trim() || "http://localhost:5173";

// Type to make TS happy about batch
type NewsletterSubscriberRow = {
  id: string;
  email: string;
  unsubscribedAt: Date | null;
};

/* -------------------------------------------------------------------------- */
/* POST /api/admin/newsletter/send                                            */
/* -------------------------------------------------------------------------- */
/**
 * Body: {
 *   subject: string;
 *   html: string;
 *   dryRun?: boolean;   // default: false (we send real emails)
 *   limit?: number;
 * }
 *
 * Returns (matches SendNewsletterResult in UI):
 * {
 *   dryRun: boolean;
 *   totalFound: number;
 *   totalSent: number;
 *   stoppedByLimit: boolean;
 * }
 */
router.post(
  "/send",
  requireAuth,
  requireAdmin,
  wrap(async (req: Request, res: Response) => {
    const parsed = broadcastSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error:
          parsed.error.issues[0]?.message ??
          "Invalid newsletter broadcast payload.",
      });
    }

    // 👇 dryRun will already be false by default, thanks to .default(false)
    const { subject, html, dryRun, limit } = parsed.data;

    const batchSize = 100;
    let cursor: string | null = null;
    let totalFound = 0;
    let totalSent = 0;
    let stoppedByLimit = false;

    while (true) {
      const batch: NewsletterSubscriberRow[] =
        await prisma.newsletterSubscriber.findMany({
          where: {
            unsubscribedAt: null,
          },
          take: batchSize,
          ...(cursor && {
            skip: 1,
            cursor: { id: cursor },
          }),
          orderBy: { id: "asc" },
        });

      if (!batch.length) break;

      for (const sub of batch) {
        totalFound += 1;

        if (limit && totalFound > limit) {
          stoppedByLimit = true;
          break;
        }

        // Per-user unsubscribe link
        const token = createUnsubscribeToken(sub.id);
        const unsubscribeUrl = `${WEB_BASE_URL.replace(
          /\/+$/,
          ""
        )}/unsubscribe?token=${encodeURIComponent(token)}`;

        // Append unsubscribe footer to the provided HTML
        const htmlWithFooter = `
${html}
<hr style="margin-top:24px;border:none;border-top:1px solid #e5e7eb;" />
<p style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;color:#6b7280;margin-top:12px;">
  You’re receiving this email because you subscribed to DaySpring newsletter updates.
  If you no longer wish to receive these, you can
  <a href="${unsubscribeUrl}" style="color:#4f46e5;text-decoration:underline;">unsubscribe here</a>.
</p>
        `.trim();

        if (!dryRun) {
          try {
            await sendMail({
              to: sub.email,
              subject,
              html: htmlWithFooter,
            });
            totalSent += 1;
          } catch (err) {
            // Don't kill the whole batch on a single failure
            console.error("[adminNewsletter] Failed for", sub.email, err);
          }
        }
      }

      if (limit && totalFound >= limit) {
        stoppedByLimit = true;
      }

      if (stoppedByLimit) break;

      cursor = batch[batch.length - 1].id;
    }

    // 🔁 Shape matches SendNewsletterResult used in AdminNewsletter.tsx
    return res.json({
      dryRun: !!dryRun,
      totalFound,
      totalSent: dryRun ? 0 : totalSent,
      stoppedByLimit,
    });
  })
);

export default router;