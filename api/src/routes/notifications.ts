// api/src/routes/notifications.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

/**
 * In-memory SSE clients keyed by userId.
 * NOTE: Works on a single Node instance.
 * If you scale to multiple instances, move this to Redis pub/sub.
 */
type SseClient = {
  res: any;
  pingTimer: NodeJS.Timeout;
};
const clientsByUser = new Map<string, Set<SseClient>>();

function sseWrite(res: any, payload: any) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function addClient(userId: string, client: SseClient) {
  const set = clientsByUser.get(userId) ?? new Set<SseClient>();
  set.add(client);
  clientsByUser.set(userId, set);
}

function removeClient(userId: string, client: SseClient) {
  const set = clientsByUser.get(userId);
  if (!set) return;
  set.delete(client);
  if (!set.size) clientsByUser.delete(userId);
}

/**
 * Call this after you create a notification to push realtime toast.
 * You can import and call this from your notifications service.
 */
export function emitNotificationToUser(userId: string, notification: any, unreadCount?: number) {
  const set = clientsByUser.get(userId);
  if (!set || !set.size) return;

  for (const c of set) {
    try {
      sseWrite(c.res, {
        type: "notification",
        notification,
        unreadCount,
      });
    } catch {
      // ignore; cleanup handled by close events / ping timer failures
    }
  }
}

/* ----------------------------- GET /api/notifications ----------------------------- */
router.get("/", requireAuth, async (req: any, res) => {
  const userId = String(req.user?.id ?? req.userId ?? "");
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));

  const items = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const unreadCount = await prisma.notification.count({
    where: { userId, readAt: null },
  });

  return res.json({
    data: {
      items,
      unreadCount,
      nextCursor: null,
    },
  });
});

/* -------------------------- POST /api/notifications/read -------------------------- */
router.post("/read", requireAuth, async (req: any, res) => {
  const userId = String(req.user?.id ?? req.userId ?? "");
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body ?? {};
  const all = !!body.all;
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map((x: any) => String(x)) : [];

  if (all) {
    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  } else if (ids.length) {
    await prisma.notification.updateMany({
      where: { userId, id: { in: ids } },
      data: { readAt: new Date() },
    });
  }

  return res.json({ ok: true });
});

/* ------------------------ GET /api/notifications/stream ------------------------ */
/**
 * SSE endpoint.
 * Auth must be cookie-based OR your requireAuth must accept the same auth for EventSource.
 * EventSource cannot send Authorization headers.
 */
router.get("/stream", requireAuth, async (req: any, res) => {
  const userId = String(req.user?.id ?? req.userId ?? "");
  if (!userId) return res.status(401).end();

  // Required SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // If behind nginx/proxy buffering:
  res.setHeader("X-Accel-Buffering", "no");

  // Flush headers immediately
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  // Initial snapshot (so client can baseline without toasting)
  try {
    const items = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const unreadCount = await prisma.notification.count({
      where: { userId, readAt: null },
    });

    sseWrite(res, { type: "snapshot", items, unreadCount });
  } catch {
    // even if snapshot fails, keep stream open
    sseWrite(res, { type: "snapshot", items: [], unreadCount: 0 });
  }

  // keep-alive ping (helps proxies keep it open)
  const pingTimer = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      // ignore
    }
  }, 25_000);

  const client: SseClient = { res, pingTimer };
  addClient(userId, client);

  // Cleanup when client disconnects
  req.on("close", () => {
    clearInterval(pingTimer);
    removeClient(userId, client);
    try {
      res.end();
    } catch {
      // ignore
    }
  });
});

export default router;
