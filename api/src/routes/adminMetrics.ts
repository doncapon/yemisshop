// src/routes/adminMetrics.ts
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { DateTime } from "luxon";
import { computeProfitForWindow } from '../services/admin.service.js';


const router = Router();


router.get("/profit-summary", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const TZ = "Africa/Lagos";

    const nowLagos = DateTime.now().setZone(TZ);
    const defaultYMD = nowLagos.toFormat("yyyy-LL-dd");

    const qFrom = String(req.query.from ?? defaultYMD);
    const qTo = String(req.query.to ?? defaultYMD);

    const fromLagos = DateTime.fromFormat(qFrom, "yyyy-LL-dd", { zone: TZ });
    const toLagos = DateTime.fromFormat(qTo, "yyyy-LL-dd", { zone: TZ });

    if (!fromLagos.isValid || !toLagos.isValid) {
      return res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD for from/to." });
    }

    const fromStartUtc = fromLagos.startOf("day").toUTC();
    const toEndUtc = toLagos.endOf("day").toUTC();

    if (fromStartUtc.toMillis() > toEndUtc.toMillis()) {
      return res.status(400).json({ error: "`from` must be <= `to`" });
    }

    // ✅ Real computation (not paymentEvent JSON)
    const breakdown = await computeProfitForWindow(
      prisma,
      fromStartUtc.toJSDate(),
      toEndUtc.toJSDate()
    );

    // Also compute "today" in Lagos (separately)
    const todayStartUtc = nowLagos.startOf("day").toUTC();
    const todayEndUtc = nowLagos.endOf("day").toUTC();

    const todayBreakdown = await computeProfitForWindow(
      prisma,
      todayStartUtc.toJSDate(),
      todayEndUtc.toJSDate()
    );

    return res.json({
      timezone: TZ,
      range: { from: qFrom, to: qTo },

      // Useful boundaries for debugging
      boundaries: {
        lagos: {
          fromStart: fromLagos.startOf("day").toISO(),
          toEnd: toLagos.endOf("day").toISO(),
        },
        utc: {
          fromStart: fromStartUtc.toISO(),
          toEnd: toEndUtc.toISO(),
        },
      },

      ...breakdown,

      // optional: dashboard-safe value if you never want negative tiles
      grossProfitSafe: Math.max(0, breakdown.grossProfit),

      today: {
        ...todayBreakdown,
        grossProfitSafe: Math.max(0, todayBreakdown.grossProfit),
      },
    });
  } catch (e: any) {
    console.error("profit-summary failed:", e);
    return res.status(500).json({ error: "Failed to compute profit summary" });
  }
});



export default router;
