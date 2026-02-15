// api/src/middleware/auth.ts
import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { getAccessTokenCookieName } from "../lib/authCookies.js";
import { prisma } from "../lib/prisma.js";

// ✅ Import the typed Role + policy helpers
import type { Role as PolicyRole, Role } from "../lib/sessionPolicy.js";
import { DEFAULT_POLICY, SESSION_POLICY, normRole as normPolicyRole } from "../lib/sessionPolicy.js";

type JwtPayload = {
  id?: string;
  email?: string;
  role?: PolicyRole | string;
  k?: "access" | "verify" | string;
  sid?: string;
  iat?: number;
  exp?: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __auth_ignore: boolean | undefined;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string; email?: string; role?: string; k?: string; sid?: string };
  }
}

const ACCESS_JWT_SECRET = process.env.ACCESS_JWT_SECRET || process.env.JWT_SECRET || "CHANGE_ME_DEV_SECRET";

function bearerFromAuthHeader(req: Request): string | null {
  const h = String(req.headers.authorization ?? "");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

function tokenFromCookie(req: Request): string | null {
  const name = getAccessTokenCookieName();
  const raw = (req as any).cookies?.[name];
  return raw ? String(raw) : null;
}

function readToken(req: Request): string | null {
  return bearerFromAuthHeader(req) || tokenFromCookie(req) || null;
}

function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, ACCESS_JWT_SECRET) as any;
    return decoded as JwtPayload;
  } catch {
    return null;
  }
}

// ✅ Keep a simple string normalizer for guard checks only
function normRoleStr(r: Role): string {
  return String(r ?? "").trim().toUpperCase();
}

function isRevoked(row: { revokedAt: Date | null } | null) {
  return !!row?.revokedAt;
}

// throttle lastSeen updates to reduce DB writes
const LAST_SEEN_THROTTLE_MS = 60_000;

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    // allow bypass in test harnesses if you use it
    if (globalThis.__auth_ignore) return next();

    const token = readToken(req);
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const decoded = verifyToken(token);
    if (!decoded?.id) return res.status(401).json({ error: "Unauthorized" });

    // require access token
    const k = String(decoded.k ?? "access");
    if (k !== "access") return res.status(401).json({ error: "Unauthorized" });

    const userId = String(decoded.id);
    const sid = decoded.sid ? String(decoded.sid) : null;

    // ✅ Require sid so we can enforce idle/logout per session
    if (!sid) return res.status(401).json({ error: "Unauthorized" });

    // Load session + user role (trust DB as source of truth)
    const sess = await prisma.userSession.findUnique({
      where: { id: sid },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        revokedReason: true,
        user: { select: { role: true, email: true } },
      },
    });

    if (!sess) return res.status(401).json({ error: "Unauthorized" });
    if (sess.userId !== userId) return res.status(401).json({ error: "Unauthorized" });
    if (isRevoked(sess)) return res.status(401).json({ error: "Unauthorized" });

    const now = Date.now();

    // ✅ CRITICAL: use the typed normalizer from sessionPolicy (returns PolicyRole | null)
    const role: PolicyRole | null =
      normPolicyRole(sess.user?.role) ?? normPolicyRole(decoded.role) ?? null;

    // ✅ Now TS is happy: role is PolicyRole, not string
    const policy = role ? SESSION_POLICY[role] : DEFAULT_POLICY;

    const createdAtMs = sess.createdAt.getTime();
    const lastSeenMs = sess.lastSeenAt.getTime();

    // absolute expiry: prefer DB expiresAt if set, else compute from createdAt + role policy
    const absoluteExpiryMs = sess.expiresAt?.getTime() ?? (createdAtMs + policy.absoluteMs);

    // idle expiry
    const idleExpiryMs = lastSeenMs + policy.idleMs;

    const expired = now > absoluteExpiryMs || now > idleExpiryMs;

    if (expired) {
      // revoke so future requests fail fast
      await prisma.userSession.update({
        where: { id: sid },
        data: {
          revokedAt: new Date(),
          revokedReason: now > idleExpiryMs ? "IDLE_TIMEOUT" : "ABSOLUTE_TIMEOUT",
        },
      });
      return res.status(401).json({ error: "Session expired" });
    }

    // ✅ update lastSeenAt (throttled)
    if (now - lastSeenMs > LAST_SEEN_THROTTLE_MS) {
      await prisma.userSession.update({
        where: { id: sid },
        data: { lastSeenAt: new Date() },
      });
    }

    req.user = {
      id: userId,
      email: sess.user?.email ? String(sess.user.email) : decoded.email ? String(decoded.email) : undefined,
      role: role ?? (decoded.role ? String(decoded.role) : undefined), // keep as string for downstream checks
      k,
      sid,
    };

    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
};

export const requireVerifySession: RequestHandler = (req, res, next) => {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const decoded = verifyToken(token);
  if (!decoded?.id) return res.status(401).json({ error: "Unauthorized" });

  const k = String(decoded.k ?? "");
  if (k !== "verify") return res.status(401).json({ error: "Unauthorized" });

  req.user = {
    id: String(decoded.id),
    email: decoded.email ? String(decoded.email) : undefined,
    role: decoded.role ? String(decoded.role) : undefined,
    k,
    sid: decoded.sid ? String(decoded.sid) : undefined,
  };

  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  requireAuth(req, res, () => {
    const r = normRoleStr(req.user?.role);
    if (r === "ADMIN" || r === "SUPER_ADMIN") return next();
    return res.status(403).json({ error: "Forbidden" });
  });
};

export const requireSuperAdmin: RequestHandler = (req, res, next) => {
  requireAuth(req, res, () => {
    const r = normRoleStr(req.user?.role);
    if (r === "SUPER_ADMIN") return next();
    return res.status(403).json({ error: "Forbidden" });
  });
};

export const requireSupplier: RequestHandler = (req, res, next) => {
  requireAuth(req, res, () => {
    const r = normRoleStr(req.user?.role);
    if (r === "SUPPLIER") return next();
    return res.status(403).json({ error: "Forbidden" });
  });
};
