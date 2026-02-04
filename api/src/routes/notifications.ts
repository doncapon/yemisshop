// api/src/routes/notifications.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

/**
 * GET /api/notifications
 * Query:
 *  - limit?: number (default 20, max 50)
 *  - cursor?: string (id of last item from previous page)
 */
router.get("/", requireAuth, async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const limitRaw = Number(req.query.limit ?? 20);
    const limit = Math.min(Math.max(1, limitRaw || 20), 50);
    const cursorId = req.query.cursor ? String(req.query.cursor) : undefined;

    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        take: limit,
        orderBy: { createdAt: "desc" },
        ...(cursorId
          ? {
              skip: 1,
              cursor: { id: cursorId },
            }
          : {}),
      }),
      prisma.notification.count({
        where: { userId, readAt: null },
      }),
    ]);

    const nextCursor =
      items.length === limit ? items[items.length - 1]?.id ?? null : null;

    return res.json({
      ok: true,
      data: {
        items,
        unreadCount,
        nextCursor,
      },
    });
  } catch (err: any) {
    console.error("GET /api/notifications error", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message ?? "Failed to load notifications",
    });
  }
});

/**
 * POST /api/notifications/read
 * Body:
 *  - ids?: string[]  (mark specific notifications as read)
 *  - all?: boolean   (if true, mark all current user's notifications as read)
 */
router.post("/read", requireAuth, async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const ids = Array.isArray(req.body?.ids)
      ? (req.body.ids as string[]).map((x) => String(x)).filter(Boolean)
      : [];
    const markAll = req.body?.all === true;

    if (!markAll && !ids.length) {
      return res.status(400).json({
        ok: false,
        error: "BAD_REQUEST",
        message: "Provide ids[] or all=true",
      });
    }

    const whereBase = { userId, readAt: null as Date | null };

    const where = markAll
      ? whereBase
      : { ...whereBase, id: { in: ids } };

    const result = await prisma.notification.updateMany({
      where,
      data: { readAt: new Date() },
    });

    return res.json({
      ok: true,
      data: { updated: result.count },
    });
  } catch (err: any) {
    console.error("POST /api/notifications/read error", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message ?? "Failed to update notifications",
    });
  }
});

export default router;
