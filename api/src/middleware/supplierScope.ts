import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";

type Role = "SHOPPER" | "ADMIN" | "SUPER_ADMIN" | "SUPPLIER";

function asRole(r: any): Role | null {
  const v = String(r || "").replace(/[\s-]/g, "").toUpperCase();
  if (v === "SUPERADMIN" || v === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (v === "ADMIN") return "ADMIN";
  if (v === "SUPPLIER") return "SUPPLIER";
  if (v === "SHOPPER" || v === "USER") return "SHOPPER";
  return null;
}

// Extend Express Request with supplierId
declare global {
  namespace Express {
    interface Request {
      supplierId?: string;
    }
  }
}

/**
 * Require SUPPLIER or SUPER_ADMIN and set req.supplierId.
 *
 * - SUPPLIER: resolves supplierId from DB using req.user.id (User -> Supplier).
 * - SUPER_ADMIN: can pass supplierId via:
 *    - req.params.supplierId
 *    - req.query.supplierId
 *    - req.body.supplierId
 *
 * If SUPER_ADMIN doesn't pass a supplierId, you can decide:
 *  - either error (recommended for supplier routes)
 *  - or allow "unscoped" (NOT recommended)
 */
export async function requireSupplierScope(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });

  const role = asRole(req.user.role);
  if (role !== "SUPPLIER" && role !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  // If supplier user: resolve supplier profile by userId
  if (role === "SUPPLIER") {
    const supplier = await prisma.supplier.findFirst({
      where: { userId: req.user.id },
      select: { id: true },
    });

    if (!supplier) {
      return res.status(403).json({ error: "No supplier profile linked to this account" });
    }

    req.supplierId = supplier.id;
    return next();
  }

  // SUPER_ADMIN: allow specifying supplierId
  const supplierId =
    (req.params as any).supplierId ||
    (req.query as any).supplierId ||
    (req.body as any)?.supplierId;

  if (!supplierId) {
    return res.status(400).json({ error: "supplierId is required for SUPER_ADMIN on supplier routes" });
  }

  const exists = await prisma.supplier.findUnique({
    where: { id: String(supplierId) },
    select: { id: true },
  });

  if (!exists) return res.status(404).json({ error: "Supplier not found" });

  req.supplierId = String(supplierId);
  return next();
}
