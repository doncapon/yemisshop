// src/routes/settings.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireSuperAdmin } from "../middleware/auth.js";
import { requiredString } from "../lib/http.js";

const router = Router();

/* -------------------------------- helpers -------------------------------- */

async function readSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    try {
      const row = await prisma.setting.findFirst({ where: { key } });
      return row?.value ?? null;
    } catch {
      return null;
    }
  }
}

function toNumber(v: any, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toTaxMode(v: any): "INCLUDED" | "ADDED" | "NONE" {
  const s = String(v ?? "").toUpperCase();
  return s === "ADDED" || s === "NONE" ? (s as "ADDED" | "NONE") : "INCLUDED";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function estimateGatewayFee(amountNaira: number): number {
  if (!Number.isFinite(amountNaira) || amountNaira <= 0) return 0;
  const percent = amountNaira * 0.015;
  const extra = amountNaira > 2500 ? 100 : 0;
  return Math.min(percent + extra, 2000);
}

/* -------------------------- PUBLIC endpoints FIRST ----------------------- */

/**
 * GET /api/settings/public (no auth)
 * Returns a compact bundle used by checkout + pricing UI.
 */
router.get("/public", async (_req, res) => {
  try {
    const baseRaw =
      (await readSetting("baseServiceFeeNGN")) ??
      (await readSetting("serviceFeeBaseNGN")) ??
      (await readSetting("platformBaseFeeNGN")) ??
      (await readSetting("commsServiceFeeNGN")); // legacy fallback

    const unitRaw =
      (await readSetting("commsUnitCostNGN")) ??
      (await readSetting("commsServiceFeeUnitNGN")) ??
      (await readSetting("commsUnitFeeNGN"));

    const modeRaw = await readSetting("taxMode");
    const rateRaw = await readSetting("taxRatePct");

    // ✅ NEW: pricing markup/margin for retail calculation
    const marginRaw =
      (await readSetting("marginPercent")) ??
      (await readSetting("pricingMarkupPercent")) ??
      (await readSetting("markupPercent")) ??
      (await readSetting("platformMarginPercent"));

    const baseServiceFeeNGN = toNumber(baseRaw, 0);
    const commsUnitCostNGN = toNumber(unitRaw, 0);
    const taxMode = toTaxMode(modeRaw);
    const taxRatePct = toNumber(rateRaw, 0);

    const marginPercent = Math.max(0, toNumber(marginRaw, 0));

    res.json({
      baseServiceFeeNGN,
      commsUnitCostNGN,
      taxMode,
      taxRatePct,

      // ✅ include BOTH names for compatibility
      marginPercent,
      pricingMarkupPercent: marginPercent,
    });
  } catch (e) {
    console.error("GET /api/settings/public failed:", e);
    res.status(500).json({ error: "Failed to load public settings" });
  }
});


/**
 * GET /api/settings/checkout/service-fee
 *
 * Supported inputs:
 *  - ?units=TOTAL_CART_QTY   ✅ (this MUST be total qty, same as orders totalUnits)
 *  - ?itemsSubtotal=12345
 *  - ?supplierIds=s1,s1,s2 (optional: for display only)
 *  - ?productIds=p1,p2 (optional: for display only)
 */
router.get("/checkout/service-fee", async (req, res) => {
  try {
    // --- Load settings (EXACT same keys used by orders.ts)
    const unitRaw =
      (await readSetting("commsUnitCostNGN")) ??
      (await readSetting("commsServiceFeeUnitNGN")) ??
      (await readSetting("commsUnitFeeNGN"));

    const baseRaw =
      (await readSetting("baseServiceFeeNGN")) ??
      (await readSetting("serviceFeeBaseNGN")) ??
      (await readSetting("platformBaseFeeNGN")) ??
      (await readSetting("commsServiceFeeNGN")); // legacy base fallback

    const unitFee = Math.max(0, toNumber(unitRaw, 0));
    const base = Math.max(0, toNumber(baseRaw, 0));

    const supplierIdsParam = String(req.query.supplierIds ?? "").trim();
    const productIdsParam = String(req.query.productIds ?? "").trim();

    const pIds = productIdsParam
      ? productIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const sIds = supplierIdsParam
      ? supplierIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    const itemsSubtotal = toNumber(req.query.itemsSubtotal ?? req.query.subtotal ?? 0, 0);

    // ✅ Units is what drives comms fee; must equal total cart quantity (same as orders)
    const units = Math.max(0, Math.trunc(toNumber(req.query.units ?? req.query.totalUnits ?? 0, 0)));

    // --- Display-only counts (do not use these to compute comms fee)
    let notificationsCount = 0;
    let suppliersCountDisplay = 0;

    if (sIds.length) {
      notificationsCount = sIds.length;
      const distinct = new Set(sIds).size;
      suppliersCountDisplay = pIds.length === 1 ? 1 : Math.max(1, distinct);
    } else if (pIds.length) {
      const supplierSet = new Set<string>();

      try {
        const prods = await prisma.product.findMany({
          where: { id: { in: pIds } },
          select: { supplierId: true },
        });
        for (const p of prods) {
          const sid = (p as any).supplierId;
          if (sid) supplierSet.add(String(sid));
        }
      } catch {}

      // legacy offers if present
      try {
        const offers = await (prisma as any).supplierOffer.findMany({
          where: { productId: { in: pIds }, isActive: true },
          distinct: ["supplierId"],
          select: { supplierId: true },
        });
        for (const o of offers || []) {
          if (o?.supplierId) supplierSet.add(String(o.supplierId));
        }
      } catch {}

      const distinctSuppliers = supplierSet.size || pIds.length;
      notificationsCount = Math.max(1, distinctSuppliers);
      suppliersCountDisplay = pIds.length === 1 ? 1 : Math.max(1, distinctSuppliers);
    }

    const modeRaw = await readSetting("taxMode");
    const rateRaw = await readSetting("taxRatePct");
    const taxMode = toTaxMode(modeRaw);
    const taxRatePct = Math.max(0, toNumber(rateRaw, 0));

    const vatAddOn = taxMode === "ADDED" && taxRatePct > 0 ? (itemsSubtotal * taxRatePct) / 100 : 0;

    const serviceFeeBase = round2(base);
    const serviceFeeComms = round2(unitFee * units);

    const grossBeforeGateway = itemsSubtotal + vatAddOn + serviceFeeBase + serviceFeeComms;
    const serviceFeeGateway = round2(estimateGatewayFee(grossBeforeGateway));
    const serviceFeeTotal = round2(serviceFeeBase + serviceFeeComms + serviceFeeGateway);

    return res.json({
      unitFee,
      units,
      taxMode,
      taxRatePct,
      vatAddOn,

      serviceFeeBase,
      serviceFeeComms,
      serviceFeeGateway,
      serviceFeeTotal,
      serviceFee: serviceFeeTotal,

      // display
      notificationsCount,
      suppliersCount: suppliersCountDisplay,
    });
  } catch (e) {
    console.error("GET /api/settings/checkout/service-fee failed:", e);
    res.status(500).json({ error: "Failed to compute service fee" });
  }
});

/* ------------------------------ ADMIN CRUD ------------------------------- */

router.get("/", requireAuth, requireSuperAdmin, async (_req, res) => {
  const rows = await prisma.setting.findMany({ orderBy: { key: "asc" } });
  return res.json(rows);
});

router.get("/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  const row = await prisma.setting.findUnique({ where: { id: requiredString(req.params.id) } });
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(row);
});

router.post("/", requireAuth, requireSuperAdmin, async (req, res) => {
  const { key, value, isPublic = false, meta = null } = req.body ?? {};
  if (!key || typeof key !== "string") return res.status(400).json({ error: "key is required" });
  if (typeof value !== "string") return res.status(400).json({ error: "value must be a string" });

  try {
    try {
      const row = await prisma.setting.create({ data: { key, value, isPublic, meta } as any });
      return res.status(201).json(row);
    } catch (e: any) {
      if (e?.code === "P2022" || /Unknown argument .*isPublic|meta/i.test(String(e?.message))) {
        const row = await prisma.setting.create({ data: { key, value } as any });
        return res.status(201).json(row);
      }
      if (e?.code === "P2002") return res.status(409).json({ error: "Key already exists" });
      throw e;
    }
  } catch {
    return res.status(500).json({ error: "Create failed" });
  }
});

router.patch("/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  const { value, isPublic, meta } = req.body ?? {};
  const data: Record<string, any> = {};
  if (typeof value === "string") data.value = value;
  if (typeof isPublic === "boolean") data.isPublic = isPublic;
  if (meta !== undefined) data.meta = meta;

  if (!Object.keys(data).length) {
    return res.status(400).json({ error: "No updatable fields provided" });
  }

  try {
    try {
      const row = await prisma.setting.update({ where: { id: requiredString(req.params.id) }, data });
      return res.json(row);
    } catch (e: any) {
      if (e?.code === "P2022" || /Unknown argument .*isPublic|meta/i.test(String(e?.message))) {
        const fallback: Record<string, any> = {};
        if (typeof value === "string") fallback.value = value;
        const row = await prisma.setting.update({ where: { id: requiredString(req.params.id) }, data: fallback });
        return res.json(row);
      }
      if (e?.code === "P2025") return res.status(404).json({ error: "Not found" });
      throw e;
    }
  } catch {
    return res.status(500).json({ error: "Update failed" });
  }
});

router.delete("/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await prisma.setting.delete({ where: { id: requiredString(req.params.id) } });
    return res.status(204).end();
  } catch (e: any) {
    if (e?.code === "P2025") return res.status(404).json({ error: "Not found" });
    return res.status(500).json({ error: "Delete failed" });
  }
});

export default router;
