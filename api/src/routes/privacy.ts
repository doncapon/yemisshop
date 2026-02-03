// api/src/routes/privacy.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

/**
 * GET /api/privacy/consent
 * Returns the user's current consent flags + timestamps.
 */
router.get("/consent", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const u = await prisma.user.findUnique({
      where: { id: String(userId) },
      select: {
        consentAnalyticsAt: true,
        consentMarketingAt: true,
      },
    });

    // if user somehow missing, still return a safe shape
    return res.json({
      ok: true,
      data: {
        analytics: !!u?.consentAnalyticsAt,
        marketing: !!u?.consentMarketingAt,
        consentAnalyticsAt: u?.consentAnalyticsAt ?? null,
        consentMarketingAt: u?.consentMarketingAt ?? null,
      },
    });
  } catch (e: any) {
    console.error("[privacy] get consent failed", e);
    return res.status(500).json({ error: "Failed to load consent" });
  }
});

/**
 * POST /api/privacy/consent
 * Body: { analytics: boolean, marketing: boolean }
 *
 * Rules:
 * - marketing implies analytics (can't have marketing without analytics)
 * - turning a flag OFF clears its timestamp (null)
 * - turning a flag ON sets timestamp to "now"
 */
router.post("/consent", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    let analytics = !!req.body?.analytics;
    let marketing = !!req.body?.marketing;

    // marketing implies analytics
    if (marketing && !analytics) analytics = true;

    const now = new Date();

    const u = await prisma.user.update({
      where: { id: String(userId) },
      data: {
        consentAnalyticsAt: analytics ? now : null,
        consentMarketingAt: marketing ? now : null,
      },
      select: {
        consentAnalyticsAt: true,
        consentMarketingAt: true,
      },
    });

    return res.json({
      ok: true,
      data: {
        analytics: !!u.consentAnalyticsAt,
        marketing: !!u.consentMarketingAt,
        consentAnalyticsAt: u.consentAnalyticsAt,
        consentMarketingAt: u.consentMarketingAt,
      },
    });
  } catch (e: any) {
    console.error("[privacy] save consent failed", e);
    return res.status(500).json({ error: "Failed to save consent" });
  }
});

export default router;
