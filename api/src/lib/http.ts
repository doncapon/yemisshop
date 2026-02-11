export function q1(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return undefined;
}

export function requiredString(v: unknown, field = "value"): string {
  const s = q1(v);
  if (!s) throw new Error(`Missing or invalid ${field}`);
  return s;
}
