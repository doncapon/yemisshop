export type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | "SUPPLIER_RIDER";

export type SessionPolicy = { idleMs: number; absoluteMs: number };

export const SESSION_POLICY: Record<Role, SessionPolicy> = {
  ADMIN: { idleMs: 30 * 60_000, absoluteMs: 12 * 60 * 60_000 },
  SUPER_ADMIN: { idleMs: 30 * 60_000, absoluteMs: 12 * 60 * 60_000 },
  SHOPPER: { idleMs: 7 * 24 * 60 * 60_000, absoluteMs: 30 * 24 * 60 * 60_000 },
  SUPPLIER: { idleMs: 60 * 60_000, absoluteMs: 7 * 24 * 60 * 60_000 },
  SUPPLIER_RIDER: { idleMs: 60 * 60_000, absoluteMs: 7 * 24 * 60 * 60_000 },
};

export const DEFAULT_POLICY: SessionPolicy = { idleMs: 24 * 60 * 60_000, absoluteMs: 30 * 24 * 60 * 60_000 };

export function normRole(v: any): Role | null {
  const r = String(v ?? "").trim().toUpperCase();
  if (
    r === "ADMIN" ||
    r === "SUPER_ADMIN" ||
    r === "SHOPPER" ||
    r === "SUPPLIER" ||
    r === "SUPPLIER_RIDER"
  ) {
    return r as Role;
  }
  return null;
}
