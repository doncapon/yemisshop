// api/src/lib/featureFlags.ts

/**
 * Internal logistics (platform-owned riders) — off by default. Suppliers
 * currently rely entirely on GIGL; this exists as a designed-but-dormant
 * path for a future in-house delivery fleet, managed exclusively by admins.
 */
export function isInternalLogisticsEnabled(): boolean {
  return String(process.env.INTERNAL_LOGISTICS_ENABLED || "").toLowerCase() === "true";
}
