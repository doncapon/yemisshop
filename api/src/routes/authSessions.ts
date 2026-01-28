// api/src/routes/authSessions.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

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

// ✅ POST /api/auth/logout (revoke current session)
router.post("/logout", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const sid = getSessionId(req);

  if (userId && sid) {
    await prisma.userSession.updateMany({
      where: { id: String(sid), userId: String(userId), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "Logged out" },
    });
  }

  res.json({ ok: true });
});

export default router;
