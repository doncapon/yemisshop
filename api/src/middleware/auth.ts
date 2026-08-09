// api/src/middleware/auth.ts
import type { Request, Response, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";

import type { Role as PolicyRole } from "../lib/sessionPolicy.js";
import { normRole as normPolicyRole } from "../lib/sessionPolicy.js";
import { getAccessTokenCookieName, setAccessTokenCookie } from "../lib/authCookies.js";
import { signAccessJwt } from "../lib/jwt.js";

type JwtPayload = {
  id?: string;
  sub?: string;
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

function getSessionTtlDays(role: unknown) {
  const r = normRoleStr(role);
  return r === "ADMIN" ||
    r === "SUPER_ADMIN" ||
    r === "SUPPLIER" ||
    r === "SUPPLIER_RIDER"
    ? 7
    : 30;
}

function getSessionTtlMs(role: unknown) {
  return getSessionTtlDays(role) * 24 * 60 * 60 * 1000;
}

const LAST_SEEN_THROTTLE_MS = 60_000;
/**
 * Refresh the browser cookie/JWT when we have observed real activity recently.
 * Using the same cadence as lastSeen keeps the session truly sliding-from-activity
 * without rewriting cookies on every single request.
 */
const TOKEN_ACTIVITY_REFRESH_THROTTLE_MS = 60_000;
const TOKEN_REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000; // refresh if < 24h left

type SessionCheckResult = {
  shouldRefresh: boolean;
};

async function assertSessionIfPresent(decoded: JwtPayload): Promise<SessionCheckResult> {
  const sid = decoded.sid ? String(decoded.sid) : "";
  if (!sid) return { shouldRefresh: false };

  const sessionModel: any =
    (prisma as any).userSession || (prisma as any).session || (prisma as any).authSession;

  if (!sessionModel?.findUnique) return { shouldRefresh: false };

  const userId = String(decoded.id ?? decoded.sub ?? "");
  if (!userId) return { shouldRefresh: false };

  const row = await sessionModel.findUnique({
    where: { id: sid },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true, lastSeenAt: true },
  });

  if (!row || String(row.userId) !== userId) throw new Error("session-not-found");
  if (isRevoked(row)) throw new Error("session-revoked");

  const now = Date.now();
  const expiresAtMs = row.expiresAt ? new Date(row.expiresAt).getTime() : 0;

  if (expiresAtMs && expiresAtMs <= now) {
    throw new Error("session-expired");
  }

  const role = normRoleStr(decoded.role);
  const ttlMs = getSessionTtlMs(role);

  const lastSeenMs = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0;

  /**
   * IMPORTANT:
   * Do not base "should slide session" on lastSeenAt if you also update lastSeenAt
   * more frequently than the slide threshold, otherwise the session may never slide.
   *
   * Instead, whenever we accept that the user is active enough to touch lastSeenAt,
   * we also push expiresAt forward from *now*.
   *
   * This makes the session an actual idle-timeout session:
   * active user => expiry keeps moving forward
   * inactive user => countdown starts from their last activity
   */
  const shouldTouchLastSeen =
    !lastSeenMs || now - lastSeenMs > LAST_SEEN_THROTTLE_MS;

  if (shouldTouchLastSeen) {
    const nextExpiresAt = new Date(now + ttlMs);

    sessionModel
      .update({
        where: { id: sid },
        data: {
          lastSeenAt: new Date(now),
          expiresAt: nextExpiresAt,
        },
      })
      .catch(() => null);
  }

  const tokenExpMs = decoded.exp ? decoded.exp * 1000 : 0;

  /**
   * Refresh access token/cookie when:
   * 1) we observed real activity and updated lastSeen/expiresAt, or
   * 2) token is nearing expiry
   */
  const shouldRefreshToken =
    shouldTouchLastSeen ||
    (!!tokenExpMs && tokenExpMs - now <= TOKEN_REFRESH_WINDOW_MS);

  return {
    shouldRefresh: shouldRefreshToken,
  };
}

function attachReqUser(req: Request, decoded: JwtPayload) {
  const id = String(decoded.id ?? decoded.sub ?? "");
  const roleRaw = decoded.role ?? "";
  const role = normRoleStr(roleRaw);
  const policyNorm = normPolicyRole(role as any) || role;

  req.user = {
    id,
    email: decoded.email ? String(decoded.email) : undefined,
    role: normRoleStr(policyNorm),
    k: decoded.k ? String(decoded.k) : undefined,
    sid: decoded.sid ? String(decoded.sid) : undefined,
  };
}

function maybeRefreshAccessCookie(res: Response, decoded: JwtPayload) {
  const userId = String(decoded.id ?? decoded.sub ?? "");
  if (!userId) return;

  const role = normRoleStr(decoded.role);
  const ttlDays = getSessionTtlDays(role);

  const refreshedToken = signAccessJwt(
    {
      id: userId,
      sub: userId,
      email: decoded.email ? String(decoded.email) : "",
      role,
      k: "access",
      sid: decoded.sid ? String(decoded.sid) : undefined,
    } as any,
    `${ttlDays}d`
  );

  setAccessTokenCookie(res, refreshedToken, { maxAgeDays: ttlDays });
}

function unauthorized(res: Response, msg?: string) {
  return res.status(401).json({ error: "Unauthorized", message: msg || "Unauthenticated" });
}

function forbidden(res: Response) {
  return res.status(403).json({ error: "Forbidden" });
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  if ((globalThis as any).__auth_ignore) return next();

  let token = readToken(req);

  if (!token) {
    const authHeader = String(req.headers.authorization || "").trim();
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      token = authHeader.slice(7).trim();
    }
  }

  if (!token) return unauthorized(res, "Missing auth token");

  const decoded = verifyToken(token);
  const userId = String(decoded?.id ?? decoded?.sub ?? "");
  if (!decoded || !userId) return unauthorized(res, "Invalid token");

  const k = String(decoded?.k ?? "").trim();
  const isAccessToken = !k || k === "access";
  const isVerifyToken = k === "verify";

  if (!isAccessToken && !isVerifyToken) {
    return unauthorized(res, "Wrong token type");
  }

  if (isAccessToken) {
    try {
      const sessionCheck = await assertSessionIfPresent(decoded);
      if (sessionCheck.shouldRefresh) {
        maybeRefreshAccessCookie(res, decoded);
      }
    } catch (e: any) {
      return unauthorized(res, e?.message || "Session invalid");
    }
  }

  attachReqUser(req, decoded);
  (req as any).auth = decoded;
  (req as any).authTokenKind = isVerifyToken ? "verify" : "access";

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
  if (k !== "verify" && k !== "access" && k !== "") {
    return unauthorized(res);
  }

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