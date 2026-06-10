export function normRole(role: unknown) {
  let r = String(role ?? "").trim().toUpperCase();
  r = r.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
  if (r === "SUPERADMIN") r = "SUPER_ADMIN";
  if (r === "SUPER_ADMINISTRATOR") r = "SUPER_ADMIN";
  return r;
}

export function getAuthUserKey(user: any) {
  const id = String(user?.id ?? "").trim();
  const email = String(user?.email ?? "").trim().toLowerCase();
  return id || email || "";
}

export function normalizePathname(path: string) {
  const p = String(path || "").trim();
  if (!p) return "/";
  if (p === "/") return "/";
  return p.replace(/\/+$/, "") || "/";
}

export function isPublicSupplierPath(pathname: string) {
  const p = normalizePathname(pathname);
  return p === "/register-supplier" || p === "/supplier/verify-contact";
}

export function defaultAuthedPathForRole(role: unknown) {
  const r = normRole(role);
  if (r === "SUPPLIER") return "/supplier";
  if (r === "SUPPLIER_RIDER") return "/supplier/orders";
  if (r === "ADMIN" || r === "SUPER_ADMIN") return "/admin";
  return "/";
}

export function getTempVerifyToken() {
  try {
    return localStorage.getItem("tempToken") || "";
  } catch {
    return "";
  }
}

export function hasTempVerifySession() {
  return !!String(getTempVerifyToken()).trim();
}
