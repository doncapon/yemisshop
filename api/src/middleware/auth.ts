// api/src/middleware/auth.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { getAccessTokenCookieName } from "../lib/authCookies.js";

type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | "SUPPLIER_RIDER";

type JwtPayload = {
  id?: string;
  email?: string;
  role?: Role | string;
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

function normRole(r: any): string {
  return String(r ?? "").trim().toUpperCase();
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const decoded = verifyToken(token);
  if (!decoded?.id) return res.status(401).json({ error: "Unauthorized" });

  // require access token
  const k = String(decoded.k ?? "access");
  if (k !== "access") return res.status(401).json({ error: "Unauthorized" });

  req.user = {
    id: String(decoded.id),
    email: decoded.email ? String(decoded.email) : undefined,
    role: decoded.role ? String(decoded.role) : undefined,
    k,
    sid: decoded.sid ? String(decoded.sid) : undefined,
  };

  next();
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
    const r = normRole(req.user?.role);
    if (r === "ADMIN" || r === "SUPER_ADMIN") return next();
    return res.status(403).json({ error: "Forbidden" });
  });
};

export const requireSuperAdmin: RequestHandler = (req, res, next) => {
  requireAuth(req, res, () => {
    const r = normRole(req.user?.role);
    if (r === "SUPER_ADMIN") return next();
    return res.status(403).json({ error: "Forbidden" });
  });
};

export const requireSupplier: RequestHandler = (req, res, next) => {
  requireAuth(req, res, () => {
    const r = normRole(req.user?.role);
    if (r === "SUPPLIER") return next();
    return res.status(403).json({ error: "Forbidden" });
  });
};
