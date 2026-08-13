export type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | "SUPPLIER_RIDER";

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
