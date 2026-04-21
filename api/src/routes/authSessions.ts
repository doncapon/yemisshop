// api/src/routes/authSessions.ts
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { clearAccessTokenCookie } from "../lib/authCookies.js";
import { requiredString } from "../lib/http.js";

const router = Router();

const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

function getUserId(req: any) {
  return req.user?.id || req.auth?.userId;
}

// middleware sets req.user.sid
function getSessionId(req: any) {
  return req.user?.sid || req.auth?.sessionId || null;
}

function normalizeMe(raw: any) {
  if (!raw) return null;

  const emailVerified =
    raw.emailVerified === true || !!raw.emailVerifiedAt || raw.emailVerifiedAt === 1;

  const phoneVerified =
    raw.phoneVerified === true || !!raw.phoneVerifiedAt || raw.phoneVerifiedAt === 1;

  return {
    id: String(raw.id ?? ""),
    email: String(raw.email ?? ""),
    role: String(raw.role ?? "SHOPPER"),
    firstName: raw.firstName ?? null,
    middleName: raw.middleName ?? null,
    lastName: raw.lastName ?? null,
    status: raw.status ?? null,
    emailVerified,
    phoneVerified,
  };
}

/**
 * GET /api/auth/session
 * Always 200:
 * - { user: null, sid: null } if anonymous
 * - { user: {...}, sid } if logged in
 */
router.get(
  "/session",
  wrap(async (req, res) => {
    const userId = getUserId(req);
    const sid = getSessionId(req);

    if (!userId) {
      return res.json({ user: null, sid: null });
    }

    let profile: any = null;

    try {
      profile = await prisma.user.findUnique({
        where: { id: String(userId) },
        select: {
          id: true,
          email: true,
          role: true,
          firstName: true,
          middleName: true,
          lastName: true,
          status: true,
          emailVerified: true as any,
          phoneVerified: true as any,
          emailVerifiedAt: true as any,
          phoneVerifiedAt: true as any,
        } as any,
      });
    } catch {
      profile = (req as any).user ?? null;
    }

    const me = normalizeMe(profile);
    if (!me?.id) return res.json({ user: null, sid: null });

    return res.json({ user: me, sid: sid ?? null });
  })
);

/**
 * GET /api/auth/me (soft)
 * Returns 200 with { user: null, sid: null } when anonymous.
 */
router.get(
  "/me",
  wrap(async (req, res) => {
    const userId = getUserId(req);
    const sid = getSessionId(req);

    if (!userId) return res.json({ user: null, sid: null });

    let profile: any = null;
    try {
      profile = await prisma.user.findUnique({
        where: { id: String(userId) },
        select: {
          id: true,
          email: true,
          role: true,
          firstName: true,
          middleName: true,
          lastName: true,
          status: true,
          emailVerified: true as any,
          phoneVerified: true as any,
          emailVerifiedAt: true as any,
          phoneVerifiedAt: true as any,
        } as any,
      });
    } catch {
      profile = (req as any).user ?? null;
    }

    const me = normalizeMe(profile);
    if (!me?.id) return res.json({ user: null, sid: null });

    return res.json(me);
  })
);

// GET /api/auth/sessions
router.get("/sessions", requireAuth, wrap(async (req, res) => {
  const userId = getUserId(req);
  const currentSessionId = getSessionId(req);

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const tab = String(req.query.tab || req.query.status || "ACTIVE").toUpperCase();
  const isActive = tab !== "RECENT";
  const rawPage = Math.max(1, Number(req.query.page) || 1);
  const rawPageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));

  const where = {
    userId: String(userId),
    revokedAt: isActive ? null : { not: null as null },
  };

  const [sessions, total, activeCount, recentCount] = await Promise.all([
    prisma.userSession.findMany({
      where,
      orderBy: isActive ? { lastSeenAt: "desc" } : { revokedAt: "desc" },
      skip: (rawPage - 1) * rawPageSize,
      take: rawPageSize,
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
    }),
    prisma.userSession.count({ where }),
    prisma.userSession.count({ where: { userId: String(userId), revokedAt: null } }),
    prisma.userSession.count({ where: { userId: String(userId), revokedAt: { not: null } } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / rawPageSize));

  res.json({
    rows: sessions,
    total,
    page: rawPage,
    pageSize: rawPageSize,
    totalPages,
    hasNextPage: rawPage < totalPages,
    hasPrevPage: rawPage > 1,
    currentSessionId: currentSessionId ?? null,
    counts: { active: activeCount, recent: recentCount },
  });
}));

// DELETE /api/auth/sessions/:id
router.delete("/sessions/:id", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const id = requiredString(req.params.id);

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

// PATCH /api/auth/sessions/:id
router.patch("/sessions/:id", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const id = requiredString(req.params.id);
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

export default router;