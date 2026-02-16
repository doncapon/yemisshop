// api/src/middleware/auth.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { getAccessTokenCookieName } from "../lib/authCookies.js";
import { prisma } from "../lib/prisma.js";

// ✅ Import policy helpers (kept; used lightly to avoid unused)
import type { Role as PolicyRole } from "../lib/sessionPolicy.js";
import { normRole as normPolicyRole } from "../lib/sessionPolicy.js";

type JwtPayload = {
  id?: string;              // some tokens
  sub?: string;             // standard JWT subject (common)
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

const ACCESS_JWT_SECRET =
  process.env.ACCESS_JWT_SECRET || process.env.JWT_SECRET || "CHANGE_ME_DEV_SECRET";

/* ----------------------------- helpers ----------------------------- */

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
  // cookie-first in practice, but keep Bearer as a fallback for tooling/admin scripts
  return tokenFromCookie(req) || bearerFromAuthHeader(req) || null;
}

function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, ACCESS_JWT_SECRET) as any;
    return decoded as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * ✅ Guard role normalizer (independent of policy)
 * - handles SUPERADMIN / SUPER ADMIN / SUPER-ADMIN
 * - handles spacing/dashes
 */
function normRoleStr(r: unknown): string {
  let s = String(r ?? "").trim().toUpperCase();
  s = s.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
  if (s === "SUPERADMIN") s = "SUPER_ADMIN";
  if (s === "SUPER_ADMINISTRATOR") s = "SUPER_ADMIN";
  if (s === "SUPERUSER") s = "SUPER_USER";
  return s;
}

function isRevoked(row: { revokedAt: Date | null } | null) {
  return !!row?.revokedAt;
}

// throttle lastSeen updates to reduce DB writes
const LAST_SEEN_THROTTLE_MS = 60_000;

async function assertSessionIfPresent(decoded: JwtPayload) {
  const sid = decoded.sid ? String(decoded.sid) : "";
  if (!sid) return;

  // Your schema might be Session or AuthSession.
  const sessionModel: any = (prisma as any).session || (prisma as any).authSession;
  if (!sessionModel?.findUnique) return; // if model doesn't exist, don't block login

  const userId = String(decoded.id ?? decoded.sub ?? "");
  if (!userId) return;

  const row = await sessionModel.findUnique({
    where: { id: sid },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true, lastSeenAt: true },
  });

  if (!row || String(row.userId) !== userId) throw new Error("session-not-found");
  if (isRevoked(row)) throw new Error("session-revoked");

  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new Error("session-expired");
  }

  // throttle lastSeen updates
  const last = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0;
  if (Date.now() - last > LAST_SEEN_THROTTLE_MS) {
    // best-effort update, do not fail request
    sessionModel
      .update({ where: { id: sid }, data: { lastSeenAt: new Date() } })
      .catch(() => null);
  }
}

function attachReqUser(req: Request, decoded: JwtPayload) {
  const id = String(decoded.id ?? decoded.sub ?? "");
  const roleRaw = decoded.role ?? "";
  const role = normRoleStr(roleRaw);

  // also normalize via policy helper (covers more variants), but keep our canonical output
  const policyNorm = normPolicyRole(role as any) || role;

  req.user = {
    id,
    email: decoded.email ? String(decoded.email) : undefined,
    role: normRoleStr(policyNorm),
    k: decoded.k ? String(decoded.k) : undefined,
    sid: decoded.sid ? String(decoded.sid) : undefined,
  };
}

function unauthorized(res: Response, msg?: string) {
  return res.status(401).json({ error: "Unauthorized", message: msg || "Unauthenticated" });
}

function forbidden(res: Response) {
  return res.status(403).json({ error: "Forbidden" });
}

/* ----------------------------- core guards ----------------------------- */

export const requireAuth: RequestHandler = async (req, res, next) => {
  // dev escape hatch if you use it
  if (globalThis.__auth_ignore) return next();

  const token = readToken(req);
  if (!token) return unauthorized(res, "Missing auth cookie");

  const decoded = verifyToken(token);
  const userId = String(decoded?.id ?? decoded?.sub ?? "");
  if (!decoded || !userId) return unauthorized(res, "Invalid token");

  // Only "access" tokens should be allowed here (unless token has no k, then allow)
  const k = String(decoded.k ?? "");
  if (k && k !== "access") return unauthorized(res, "Wrong token type");

  try {
    await assertSessionIfPresent(decoded);
  } catch (e: any) {
    return unauthorized(res, e?.message || "Session invalid");
  }

  attachReqUser(req, decoded);
  return next();
};

export const requireVerifySession: RequestHandler = async (req, res, next) => {
  if (globalThis.__auth_ignore) return next();

  const token = readToken(req);
  if (!token) return unauthorized(res);

  const decoded = verifyToken(token);
  const userId = String(decoded?.id ?? decoded?.sub ?? "");
  if (!decoded || !userId) return unauthorized(res);

  const k = String(decoded.k ?? "");
  if (k !== "verify") return unauthorized(res);

  try {
    await assertSessionIfPresent(decoded);
  } catch (e: any) {
    return unauthorized(res, e?.message || "Session invalid");
  }

  attachReqUser(req, decoded);
  return next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  requireAuth(req, res, () => {
    const r = normRoleStr(req.user?.role);
    if (r === "ADMIN" || r === "SUPER_ADMIN") return next();
    return forbidden(res);
  });
};

export const requireSuperAdmin: RequestHandler = (req, res, next) => {
  requireAuth(req, res, () => {
    const r = normRoleStr(req.user?.role);
    if (r === "SUPER_ADMIN") return next();
    return forbidden(res);
  });
};

export const requireSupplier: RequestHandler = (req, res, next) => {
  requireAuth(req, res, () => {
    const r = normRoleStr(req.user?.role);
    if (r === "SUPPLIER") return next();
    return forbidden(res);
  });
};
