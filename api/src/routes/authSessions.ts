// api/src/routes/authSessions.ts
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { clearAccessTokenCookie } from "../lib/authCookies.js";

const router = Router();

const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

function getUserId(req: any) {
  return req.user?.id || req.auth?.userId;
}

// ✅ IMPORTANT: middleware sets req.user.sid (not sessionId)
function getSessionId(req: any) {
  return req.user?.sid || req.auth?.sessionId || null;
}

// GET /api/auth/sessions
router.get("/sessions", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const currentSessionId = getSessionId(req);

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const sessions = await prisma.userSession.findMany({
    where: { userId: String(userId) },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      lastSeenAt: true,
      ip: true,
      userAgent: true,
      deviceName: true,
      revokedAt: true,
      revokedReason: true,
    },
  });

  res.json({ data: sessions, currentSessionId: currentSessionId ?? null });
});

// DELETE /api/auth/sessions/:id  (revoke one session)
router.delete("/sessions/:id", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const id = String(req.params.id);

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const s = await prisma.userSession.findFirst({
    where: { id, userId: String(userId) },
    select: { id: true, revokedAt: true },
  });
  if (!s) return res.status(404).json({ error: "Session not found" });

  await prisma.userSession.update({
    where: { id },
    data: { revokedAt: new Date(), revokedReason: "Revoked by user" },
  });

  res.json({ ok: true });
});

// POST /api/auth/sessions/revoke-others
router.post("/sessions/revoke-others", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const currentSessionId = getSessionId(req);

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  if (!currentSessionId) {
    return res.status(400).json({ error: "Current session not found" });
  }

  await prisma.userSession.updateMany({
    where: {
      userId: String(userId),
      id: { not: String(currentSessionId) },
      revokedAt: null,
    },
    data: { revokedAt: new Date(), revokedReason: "Logged out other devices" },
  });

  res.json({ ok: true });
});

// PATCH /api/auth/sessions/:id (optional: rename device)
router.patch("/sessions/:id", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const id = String(req.params.id);
  const deviceName = typeof req.body?.deviceName === "string" ? req.body.deviceName.trim() : "";

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const s = await prisma.userSession.findFirst({
    where: { id, userId: String(userId) },
    select: { id: true },
  });
  if (!s) return res.status(404).json({ error: "Session not found" });

  await prisma.userSession.update({
    where: { id },
    data: { deviceName: deviceName ? deviceName.slice(0, 40) : null },
  });

  res.json({ ok: true });
});

// POST /api/auth/logout  ✅ ALWAYS clears cookie, even if auth is broken
router.post("/logout", wrap(async (req, res) => {
  // Best-effort revoke current session if present (optional)
  try {
    const sid = (req as any)?.user?.sid as string | undefined;
    if (sid) {
      await prisma.userSession.updateMany({
        where: { id: sid },
        data: { revokedAt: new Date(), revokedReason: "Logged out" } as any,
      });
    }
  } catch {
    // ignore
  }

  clearAccessTokenCookie(res);
  return res.json({ ok: true });
}));

export default router;
