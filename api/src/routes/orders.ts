// api/src/routes/orders.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireSuperAdmin } from "../middleware/auth.js";
import { logOrderActivityTx } from "../services/activity.service.js";
import { syncProductInStockCacheTx } from "../services/inventory.service.js";
import { Prisma } from "@prisma/client";
import { recomputeProductStockTx } from "../services/stockRecalc.service.js";

import crypto from "crypto";
// If you created the orchestrator:
import { sendOrderOtpNotifications } from "../services/otpNotify.service.js";
import { z } from "zod";
import { assertVerifiedOrderOtp } from "./adminOrders.js";
import { requestOrderOtpForPurposeTx, verifyOrderOtpForPurposeTx } from "../services/orderOtp.service.js";

const router = Router();

const isAdmin = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";

/* ------------------------ Helpers & Types ------------------------ */

const round2 = (n: number) => Math.round(n * 100) / 100;

function getUserId(req: any): string | undefined {
  return req.user?.id || req.auth?.userId || undefined;
}

type Address = {
  houseNumber?: string;
  streetName?: string;
  postCode?: string | null;
  town?: string | null;
  city?: string;
  state?: string;
  country?: string;
};

type CartItem = {
  productId: string;
  variantId?: string | null;

  // explicit chosen offer id from client (SupplierVariantOffer.id or SupplierProductOffer.id or legacy SupplierOffer.id)
  offerId?: string | null;

  qty: number;

  selectedOptions?: Array<{
    attributeId: string;
    attribute: string;
    valueId?: string;
    value: string;
  }>;

  // client may send it; server will NOT trust it for pricing
  unitPrice?: number;
};

type CreateOrderBody = {
  items: CartItem[];
  shippingAddressId?: string;
  shippingAddress?: Address;
  billingAddressId?: string;
  billingAddress?: Address;
  notes?: string | null;

  // optional snapshot fields from checkout (ignored for billing)
  serviceFeeBase?: number;
  serviceFeeComms?: number;
  serviceFeeGateway?: number;
  serviceFeeTotal?: number;
  serviceFee?: number;
  itemsSubtotal?: number;
  taxMode?: string;
  taxRatePct?: number;
  vatAddOn?: number;
  total?: number;
};

const ACT = {
  ORDER_CREATED: "ORDER_CREATED",
  NOTE: "NOTE",
  STATUS_CHANGE: "STATUS_CHANGE",
} as const;

const asNumber = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const ACTIVE_PRODUCT_STATUSES = new Set(["LIVE", "ACTIVE"]);

const OTP_LEN = 6;
const OTP_EXPIRES_MINS = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCK_MINS = 30;
const OTP_RESEND_COOLDOWN_SECS = 60;

function now() {
  return new Date();
}

function addMinutes(d: Date, mins: number) {
  return new Date(d.getTime() + mins * 60_000);
}

function addSeconds(d: Date, secs: number) {
  return new Date(d.getTime() + secs * 1000);
}

function genOtp6() {
  // 000000-999999
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

// Hash OTP with a per-record salt
function hashOtp(code: string, salt: string) {
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

// E.164 normalization (basic). You may already have better.
function normalizeE164(phone?: string | null) {
  if (!phone) return null;
  const p = phone.trim();
  if (!p) return null;
  // If user stores E.164 already, keep it
  if (p.startsWith("+")) return p;
  // Otherwise you *must* decide default country. For NG example:
  // return `+234${p.replace(/^0/, "")}`;
  return p; // safest: do not guess
}

/* ---------------- Supplier gating ----------------
   IMPORTANT CHANGE:
   - Checkout should NOT depend on Product.ownerId/Product.supplierId.
   - Checkout should be allowed as long as there are active supplier offers.
   - Therefore: do NOT require supplier payout/bank readiness for checkout.
   - Keep payoutReadySupplierWhere for PAYOUT logic only (allocations/payout screens etc).
-------------------------------------------------- */

// used by payout flows only
function payoutReadySupplierWhere() {
  return {
    status: "ACTIVE",
    isPayoutEnabled: true,
    bankVerificationStatus: "VERIFIED",

    AND: [
      { accountNumber: { not: "" } },
      { accountName: { not: "" } },
      { bankCode: { not: "" } },
      { bankCountry: { not: "" } },
    ],
  } as const;
}

// used by checkout (order creation, availability, offer selection)
function checkoutReadySupplierWhere() {
  return {
    status: "ACTIVE",
  } as const;
}

async function getSupplierForUser(userId: string) {
  return prisma.supplier.findFirst({
    where: { userId },
    select: { id: true, name: true, status: true },
  });
}

// Prisma-safe relation filters
function supplierPayoutReadyRelationFilter() {
  return { is: payoutReadySupplierWhere() } as const;
}

function supplierCheckoutReadyRelationFilter() {
  return { is: checkoutReadySupplierWhere() } as const;
}

// ✅ FINAL safety check used during allocation
// ✅ CHANGE: only require "ACTIVE" supplier (NOT payout/bank readiness)
async function assertSupplierPurchasableTx(tx: any, supplierId: string) {
  const sid = String(supplierId ?? "").trim();
  if (!sid) throw new Error("Bad allocation: missing supplierId.");

  const ok = await tx.supplier.findFirst({
    where: { id: sid, ...checkoutReadySupplierWhere() },
    select: { id: true },
  });

  if (!ok) {
    throw new Error(`Supplier ${sid} is not available for checkout.`);
  }
}

function estimateGatewayFee(amountNaira: number): number {
  if (!Number.isFinite(amountNaira) || amountNaira <= 0) return 0;
  const percent = amountNaira * 0.015;
  const extra = amountNaira > 2500 ? 100 : 0;
  return Math.min(percent + extra, 2000);
}

async function readSettingValueTx(tx: any, key: string): Promise<string | null> {
  try {
    const s = await tx.setting.findUnique({ where: { key } });
    return s?.value ?? null;
  } catch {
    const s = await tx.setting.findFirst({ where: { key } });
    return s?.value ?? null;
  }
}

function toNumber(v: any, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toTaxMode(v: any): "INCLUDED" | "ADDED" | "NONE" {
  const s = String(v ?? "").toUpperCase();
  return s === "ADDED" || s === "NONE" ? (s as any) : "INCLUDED";
}

async function getTaxModeTx(tx: any): Promise<"INCLUDED" | "ADDED" | "NONE"> {
  const raw = await readSettingValueTx(tx, "taxMode");
  return toTaxMode(raw);
}

async function getTaxRatePctTx(tx: any): Promise<number> {
  const raw = await readSettingValueTx(tx, "taxRatePct");
  const n = toNumber(raw, 0);
  return n >= 0 ? n : 0;
}

async function getBaseServiceFeeNGNTx(tx: any): Promise<number> {
  const baseRaw =
    (await readSettingValueTx(tx, "baseServiceFeeNGN")) ??
    (await readSettingValueTx(tx, "serviceFeeBaseNGN")) ??
    (await readSettingValueTx(tx, "platformBaseFeeNGN")) ??
    (await readSettingValueTx(tx, "commsServiceFeeNGN"));
  return Math.max(0, toNumber(baseRaw, 0));
}

async function getCommsUnitCostNGNTx(tx: any): Promise<number> {
  const unitRaw =
    (await readSettingValueTx(tx, "commsUnitCostNGN")) ??
    (await readSettingValueTx(tx, "commsServiceFeeUnitNGN")) ??
    (await readSettingValueTx(tx, "commsUnitFeeNGN"));
  return Math.max(0, toNumber(unitRaw, 0));
}

function actorRole(req: any): string {
  return String(req.user?.role ?? req.auth?.role ?? "").toUpperCase();
}

function isSupplier(role?: string) {
  const r = String(role || "").toUpperCase();
  return r === "SUPPLIER";
}

function money(n: any): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Build supplier POs from OrderItems (supports split orders automatically).
 * Uses chosenSupplierId and chosenSupplierUnitPrice to compute supplierAmount.
 */
async function ensurePurchaseOrdersForOrderTx(tx: any, orderId: string) {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: {
      id: true,
      quantity: true,
      lineTotal: true,
      unitPrice: true,
      chosenSupplierId: true,
      chosenSupplierUnitPrice: true,
    },
  });

  const bySupplier = new Map<
    string,
    {
      supplierId: string;
      supplierAmount: number;
      customerSubtotal: number;
      itemIds: string[];
    }
  >();

  for (const it of items) {
    const sid = it.chosenSupplierId ? String(it.chosenSupplierId) : "";
    if (!sid) continue;

    const qty = Math.max(0, Number(it.quantity ?? 0));
    const supplierUnit = money(it.chosenSupplierUnitPrice);
    const supplierLine = supplierUnit * qty;

    const customerUnit = money(it.unitPrice);
    const customerLine = it.lineTotal != null ? money(it.lineTotal) : customerUnit * qty;

    const cur =
      bySupplier.get(sid) ??
      { supplierId: sid, supplierAmount: 0, customerSubtotal: 0, itemIds: [] };

    cur.supplierAmount += supplierLine;
    cur.customerSubtotal += customerLine;
    cur.itemIds.push(String(it.id));
    bySupplier.set(sid, cur);
  }

  const supplierIds = Array.from(bySupplier.keys());
  const suppliers = await tx.supplier.findMany({
    where: { id: { in: supplierIds } },
    select: { id: true, name: true },
  });
  const supplierNameById = new Map(suppliers.map((s: any) => [String(s.id), String(s.name)]));

  const createdPOs: any[] = [];

  for (const sid of supplierIds) {
    const g = bySupplier.get(sid)!;

    const supplierAmount = round2(g.supplierAmount);
    const customerSubtotal = round2(g.customerSubtotal);
    const platformFee = round2(Math.max(0, customerSubtotal - supplierAmount));

    const po = await tx.purchaseOrder.upsert({
      where: { orderId_supplierId: { orderId, supplierId: sid } },
      create: {
        orderId,
        supplierId: sid,
        subtotal: customerSubtotal,
        platformFee,
        supplierAmount,
        status: "CREATED",
      },
      update: {
        subtotal: customerSubtotal,
        platformFee,
        supplierAmount,
      },
      select: { id: true, supplierId: true },
    });

    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: po.id } });

    for (const orderItemId of g.itemIds) {
      await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId: po.id,
          orderItemId,
        },
      });
    }

    createdPOs.push({
      id: po.id,
      supplierId: sid,
      supplierName: supplierNameById.get(sid) ?? null,
    });
  }

  return createdPOs;
}

/**
 * Align to settings.ts checkout/service-fee:
 * - serviceFeeComms = unitFee * totalUnits
 * - grossBeforeGateway = itemsSubtotal + vatAddOn + base + comms
 * - gateway estimated on grossBeforeGateway
 */
async function computeServiceFeeForOrderTx(tx: any, orderId: string, itemsSubtotal: number) {
  const base = await getBaseServiceFeeNGNTx(tx);
  const unitFee = await getCommsUnitCostNGNTx(tx);

  const rows = await tx.orderItem.findMany({
    where: { orderId },
    select: { quantity: true },
  });

  const totalUnits = rows.reduce((s: number, r: any) => s + Math.max(0, Number(r.quantity ?? 0)), 0);

  const taxMode = await getTaxModeTx(tx);
  const taxRatePct = await getTaxRatePctTx(tx);

  const vatAddOn = taxMode === "ADDED" && taxRatePct > 0 ? (itemsSubtotal * taxRatePct) / 100 : 0;

  const serviceFeeBase = round2(Math.max(0, base));
  const serviceFeeComms = round2(Math.max(0, unitFee * totalUnits));

  const grossBeforeGateway = itemsSubtotal + vatAddOn + serviceFeeBase + serviceFeeComms;
  const serviceFeeGateway = round2(estimateGatewayFee(grossBeforeGateway));
  const serviceFeeTotal = round2(serviceFeeBase + serviceFeeComms + serviceFeeGateway);

  return {
    serviceFeeBase,
    serviceFeeComms,
    serviceFeeGateway,
    serviceFeeTotal,
    serviceFee: serviceFeeTotal,
    meta: { totalUnits, unitFee, taxMode, taxRatePct, vatAddOn, grossBeforeGateway },
  };
}

/* ---------------- Sellability checks ---------------- */

async function assertProductSellableTx(tx: any, productId: string) {
  const p = await tx.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      title: true,
      status: true,
      deletedAt: true,
      // keep these if you need them elsewhere, but DO NOT enforce them
      ownerId: true,
      supplierId: true,
    },
  });

  if (!p || p.deletedAt) throw new Error("Product not found.");
  if (String(p.status).toUpperCase() !== "LIVE") {
    throw new Error(`Product "${p.title}" is not available for purchase.`);
  }

  // ✅ IMPORTANT: Do NOT require ownerId or supplierId here.
  // Offers will determine which supplier fulfills the order.
  return { title: hookingTitle(p.title) };
}

// keep exact title formatting as-is (no schema change)
function hookingTitle(t: any) {
  return String(t ?? "");
}

async function assertVariantSellableTx(tx: any, productId: string, variantId: string) {
  const v = await tx.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, productId: true, isActive: true, archivedAt: true },
  });

  if (!v || String(v.productId) !== String(productId)) {
    throw new Error(`Variant ${variantId} does not belong to product ${productId}.`);
  }
  if (v.isActive !== true || v.archivedAt != null) {
    throw new Error(`Variant ${variantId} is not active.`);
  }
}

/* ---------------- Offers helpers (base offer + variant offer + legacy) ---------------- */

type CandidateOffer = {
  id: string;
  supplierId: string; // ✅ force non-null
  availableQty: number;

  // supplier cost for allocation (NOT customer retail)
  // For VARIANT_OFFER this is SupplierBase + SupplierVariantBump ("SupplierFullPrice")
  offerPrice: number;

  model: "BASE_OFFER" | "VARIANT_OFFER" | "LEGACY_OFFER";

  supplierProductOfferId: string | null;
  supplierVariantOfferId: string | null;
};

function sortOffersCheapestFirst(list: CandidateOffer[]) {
  list.sort((a, b) =>
    a.offerPrice !== b.offerPrice ? a.offerPrice - b.offerPrice : b.availableQty - a.availableQty
  );
  return list;
}

async function fetchActiveBaseOffersTx(
  tx: any,
  where: { productId: string }
): Promise<CandidateOffer[]> {
  // ✅ CHANGE: do NOT require payout-ready/bank verified for checkout.
  // only require supplier ACTIVE (via relation), and keep offer-level "isActive/basePrice/stock" checks.
  const rows = await tx.supplierProductOffer.findMany({
    where: {
      productId: where.productId,
      isActive: true,
      inStock: true,
      availableQty: { gt: 0 },
      basePrice: { gt: 0 },

      // ✅ supplier must be ACTIVE for checkout (NOT payout-ready)
      supplier: supplierCheckoutReadyRelationFilter(),
    },
    select: {
      id: true,
      supplierId: true,
      availableQty: true,
      basePrice: true,
    },
  });

  // ✅ pick CHEAPEST base per supplier (not “last one wins”)
  const bestBaseBySupplier = new Map<string, { id: string; basePrice: number; availableQty: number }>();

  for (const r of rows || []) {
    const sid = String(r.supplierId ?? "");
    if (!sid) continue;

    const price = asNumber(r.basePrice, 0);
    const qty = Math.max(0, asNumber(r.availableQty, 0));
    if (!(price > 0) || !(qty > 0)) continue;

    const cur = bestBaseBySupplier.get(sid);
    if (!cur || price < cur.basePrice || (price === cur.basePrice && qty > cur.availableQty)) {
      bestBaseBySupplier.set(sid, { id: String(r.id), basePrice: price, availableQty: qty });
    }
  }

  const usable: CandidateOffer[] = Array.from(bestBaseBySupplier.entries()).map(([sid, b]) => ({
    id: b.id,
    supplierId: sid,
    availableQty: b.availableQty,
    offerPrice: b.basePrice,
    model: "BASE_OFFER" as const,
    supplierProductOfferId: b.id,
    supplierVariantOfferId: null,
  }));

  if (usable.length) return sortOffersCheapestFirst(usable);

  // legacy fallback (kept)
  const legacyList =
    (await (tx.supplierOffer?.findMany?.({
      where: {
        productId: where.productId,
        variantId: null,
        isActive: true,
        inStock: true,
        availableQty: { gt: 0 },
        offerPrice: { gt: 0 },
      },
      select: { id: true, supplierId: true, availableQty: true, offerPrice: true },
    }) ?? [])) ?? [];

  const legacy: CandidateOffer[] = (legacyList || [])
    .map((o: any) => {
      const sid = String(o.supplierId ?? "");
      if (!sid) return null;
      return {
        id: String(o.id),
        supplierId: sid,
        availableQty: Math.max(0, asNumber(o.availableQty, 0)),
        offerPrice: asNumber(o.offerPrice, 0),
        model: "LEGACY_OFFER" as const,
        supplierProductOfferId: null,
        supplierVariantOfferId: null,
      };
    })
    .filter(Boolean)
    .filter((o: any) => o.availableQty > 0 && o.offerPrice > 0);

  return sortOffersCheapestFirst(legacy);
}

export async function fetchOneOfferByIdTx(
  tx: any,
  offerId: string
): Promise<(CandidateOffer & { productId: string; variantId: string | null }) | null> {
  // ✅ CHANGE:
  // This function is used to infer productId/variantId from an offerId.
  // It should NOT fail just because supplier is not payout-ready or product has no owner/supplier.
  // Allocation-time already enforces supplier ACTIVE via assertSupplierPurchasableTx.

  // 1) Try variant offer id
  try {
    const vo = await tx.supplierVariantOffer.findUnique({
      where: { id: offerId },
      select: {
        id: true,
        supplierId: true,
        productId: true,
        variantId: true,
        availableQty: true,
        isActive: true,
        inStock: true,
        priceBump: true,
        supplierProductOfferId: true,
      },
    });

    if (vo) {
      const sid = String(vo.supplierId ?? "");
      if (!sid) return null;

      if (vo.isActive !== true || vo.inStock !== true || asNumber(vo.availableQty, 0) <= 0) return null;

      // Base offer is pricing source only — require basePrice (do NOT require payout-ready)
      const base = await tx.supplierProductOffer.findFirst({
        where: {
          productId: vo.productId,
          supplierId: vo.supplierId,
          isActive: true,
          basePrice: { gt: 0 },
          // optional but consistent:
          supplier: supplierCheckoutReadyRelationFilter(),
        },
        orderBy: [{ basePrice: "asc" }, { availableQty: "desc" }],
        select: { id: true, supplierId: true, basePrice: true, availableQty: true },
      });

      if (!base) return null;

      const supplierFullPrice = asNumber(base.basePrice, 0) + asNumber(vo.priceBump, 0);
      if (!(supplierFullPrice > 0)) return null;

      const effectiveQty = Math.max(0, asNumber(vo.availableQty, 0));
      if (!(effectiveQty > 0)) return null;

      return {
        id: String(vo.id),
        supplierId: sid,
        availableQty: effectiveQty,
        offerPrice: supplierFullPrice,
        model: "VARIANT_OFFER",
        supplierProductOfferId: String(base.id),
        supplierVariantOfferId: String(vo.id),
        productId: String(vo.productId),
        variantId: vo.variantId == null ? null : String(vo.variantId),
      };
    }
  } catch {
    // ignore
  }

  // 2) Try base offer id
  try {
    const bo = await tx.supplierProductOffer.findUnique({
      where: { id: offerId },
      select: {
        id: true,
        productId: true,
        supplierId: true,
        basePrice: true,
        isActive: true,
        inStock: true,
        availableQty: true,
        supplier: { select: { status: true } },
      },
    });

    if (bo) {
      const sid = String(bo.supplierId ?? "");
      if (!sid) return null;

      if (bo.isActive !== true || bo.inStock !== true || asNumber(bo.availableQty, 0) <= 0) return null;
      if (String(bo.supplier?.status ?? "").toUpperCase() !== "ACTIVE") return null;

      const supplierUnit = asNumber(bo.basePrice, 0);
      if (!(supplierUnit > 0)) return null;

      return {
        id: String(bo.id),
        supplierId: sid,
        availableQty: Math.max(0, asNumber(bo.availableQty, 0)),
        offerPrice: supplierUnit,
        model: "BASE_OFFER",
        supplierProductOfferId: String(bo.id),
        supplierVariantOfferId: null,
        productId: String(bo.productId),
        variantId: null,
      };
    }
  } catch {
    // ignore
  }

  // 3) legacy SupplierOffer fallback (kept)
  const so =
    (await (tx.supplierOffer?.findFirst?.({
      where: { id: offerId, isActive: true },
      select: {
        id: true,
        productId: true,
        variantId: true,
        supplierId: true,
        availableQty: true,
        offerPrice: true,
        inStock: true,
      },
    }) ?? null)) ?? null;

  if (!so) return null;

  const sid = String(so.supplierId ?? "");
  if (!sid) return null;

  if (so.inStock !== true || asNumber(so.availableQty, 0) <= 0) return null;

  return {
    id: String(so.id),
    supplierId: sid,
    availableQty: Math.max(0, asNumber(so.availableQty, 0)),
    offerPrice: asNumber(so.offerPrice, 0),
    model: "LEGACY_OFFER",
    supplierProductOfferId: null,
    supplierVariantOfferId: null,
    productId: String(so.productId),
    variantId: so.variantId == null ? null : String(so.variantId),
  };
}

async function fetchActiveOffersTx(
  tx: any,
  where: { productId: string; variantId: string }
): Promise<CandidateOffer[]> {
  // ✅ CHANGE: do NOT require payout-ready/bank verified for checkout.
  const vos = await tx.supplierVariantOffer.findMany({
    where: {
      productId: where.productId,
      variantId: where.variantId,
      isActive: true,
      inStock: true,
      availableQty: { gt: 0 },

      supplier: supplierCheckoutReadyRelationFilter(),
    },
    select: {
      id: true,
      supplierId: true,
      availableQty: true,
      priceBump: true,
    },
  });

  // legacy fallback if you still support it
  if (!vos.length) {
    const legacy =
      (await (tx.supplierOffer?.findMany?.({
        where: {
          productId: where.productId,
          variantId: where.variantId,
          isActive: true,
          inStock: true,
          availableQty: { gt: 0 },
          offerPrice: { gt: 0 },
        },
        select: { id: true, supplierId: true, availableQty: true, offerPrice: true },
      }) ?? [])) ?? [];

    const legacyOut: CandidateOffer[] = (legacy || [])
      .map((o: any) => {
        const sid = String(o.supplierId ?? "");
        if (!sid) return null;
        return {
          id: String(o.id),
          supplierId: sid,
          availableQty: Math.max(0, asNumber(o.availableQty, 0)),
          offerPrice: asNumber(o.offerPrice, 0),
          model: "LEGACY_OFFER",
          supplierProductOfferId: null,
          supplierVariantOfferId: null,
        };
      })
      .filter(Boolean)
      .filter((o: any) => o.availableQty > 0 && o.offerPrice > 0);

    return sortOffersCheapestFirst(legacyOut);
  }

  // ✅ CHEAPEST bump per supplier for THIS variant
  const bestVarBySupplier = new Map<string, { id: string; bump: number; qty: number }>();
  for (const vo of vos) {
    const sid = String(vo.supplierId ?? "");
    if (!sid) continue;

    const bump = asNumber(vo.priceBump, 0);
    const qty = Math.max(0, asNumber(vo.availableQty, 0));
    if (!(qty > 0)) continue;

    const cur = bestVarBySupplier.get(sid);
    if (!cur || bump < cur.bump || (bump === cur.bump && qty > cur.qty)) {
      bestVarBySupplier.set(sid, { id: String(vo.id), bump, qty });
    }
  }

  const supplierIds = Array.from(bestVarBySupplier.keys());
  if (!supplierIds.length) return [];

  const baseRows = await tx.supplierProductOffer.findMany({
    where: {
      productId: where.productId,
      supplierId: { in: supplierIds },
      isActive: true,
      basePrice: { gt: 0 },

      supplier: supplierCheckoutReadyRelationFilter(),
    },
    select: { id: true, supplierId: true, basePrice: true },
  });

  // ✅ CHEAPEST base per supplier
  const bestBaseBySupplier = new Map<string, { id: string; basePrice: number }>();
  for (const b of baseRows || []) {
    const sid = String(b.supplierId ?? "");
    if (!sid) continue;
    const price = asNumber(b.basePrice, 0);
    if (!(price > 0)) continue;

    const cur = bestBaseBySupplier.get(sid);
    if (!cur || price < cur.basePrice) {
      bestBaseBySupplier.set(sid, { id: String(b.id), basePrice: price });
    }
  }

  const out: CandidateOffer[] = [];
  for (const sid of supplierIds) {
    const v = bestVarBySupplier.get(sid);
    const b = bestBaseBySupplier.get(sid);
    if (!v || !b) continue;

    const supplierFullPrice = b.basePrice + v.bump;
    if (!(supplierFullPrice > 0)) continue;

    out.push({
      id: v.id,
      supplierId: sid,
      availableQty: v.qty,
      offerPrice: supplierFullPrice,
      model: "VARIANT_OFFER",
      supplierProductOfferId: b.id,
      supplierVariantOfferId: v.id,
    });
  }

  return sortOffersCheapestFirst(out);
}

/* ---------------- Stock decrement (atomic) ---------------- */

async function recordSupplierAllocationsOnPaidTx(tx: any, paymentId: string, orderId: string) {
  const pos = await tx.purchaseOrder.findMany({
    where: { orderId },
    include: { supplier: { select: { id: true, name: true } } },
  });

  if (!pos.length) return [];

  await tx.supplierPaymentAllocation.deleteMany({ where: { paymentId } });

  const rows = [];
  for (const po of pos) {
    rows.push(
      await tx.supplierPaymentAllocation.create({
        data: {
          paymentId,
          orderId,
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          amount: po.supplierAmount,
          status: supplierAllocHoldStatus(),
          supplierNameSnapshot: po.supplier?.name ?? null,
          meta: { purchaseOrderStatus: po.status },
        },
      })
    );

    // ❌ DO NOT update PO status to FUNDED here anymore
  }

  await tx.payment.update({
    where: { id: paymentId },
    data: {
      supplierBreakdownJson: pos.map((po: any) => ({
        supplierId: po.supplierId,
        supplierName: po.supplier?.name ?? null,
        purchaseOrderId: po.id,
        supplierAmount: Number(po.supplierAmount ?? 0),
      })),
    },
  });

  return rows;
}

async function decrementOfferQtyTx(tx: any, offer: CandidateOffer, take: number) {
  if (take <= 0) return;

  if (offer.model === "BASE_OFFER") {
    const r = await tx.supplierProductOffer.updateMany({
      where: { id: offer.id, availableQty: { gte: take } },
      data: { availableQty: { decrement: take } },
    });
    if (r.count !== 1) throw new Error("Concurrent stock update detected (base).");

    const after = await tx.supplierProductOffer.findUnique({
      where: { id: offer.id },
      select: { availableQty: true, productId: true }, // ✅ include productId
    });

    // ✅ ALWAYS recompute after successful decrement (or at least when after exists)
    if (after?.productId) {
      await recomputeProductStockTx(tx, String(after.productId));
    }

    if (asNumber(after?.availableQty, 0) <= 0) {
      await tx.supplierProductOffer.update({ where: { id: offer.id }, data: { inStock: false } });
    }

    return;
  }

  if (offer.model === "VARIANT_OFFER") {
    const r = await tx.supplierVariantOffer.updateMany({
      where: { id: offer.id, availableQty: { gte: take } },
      data: { availableQty: { decrement: take } },
    });
    if (r.count !== 1) throw new Error("Concurrent stock update detected (variant).");

    const afterVar = await tx.supplierVariantOffer.findUnique({
      where: { id: offer.id },
      select: { availableQty: true, productId: true }, // ✅ include productId
    });

    if (afterVar?.productId) {
      await recomputeProductStockTx(tx, String(afterVar.productId)); // ✅ correct argument
    }

    if (asNumber(afterVar?.availableQty, 0) <= 0) {
      await tx.supplierVariantOffer.update({ where: { id: offer.id }, data: { inStock: false } });
    }

    return;
  }

  // LEGACY_OFFER
  const r = await tx.supplierOffer.updateMany({
    where: { id: offer.id, availableQty: { gte: take } },
    data: { availableQty: { decrement: take } },
  });
  if (r.count !== 1) throw new Error("Concurrent stock update detected.");

  const after = await tx.supplierOffer.findUnique({
    where: { id: offer.id },
    select: { availableQty: true, productId: true }, // ✅ include productId
  });

  if (after?.productId) {
    await recomputeProductStockTx(tx, String(after.productId));
  }

  if (asNumber(after?.availableQty, 0) <= 0) {
    await tx.supplierOffer.update({ where: { id: offer.id }, data: { inStock: false } });
  }
}

/* ---------------- Variant resolution + Retail pricing ---------------- */

const norm = (s: any) => String(s ?? "").trim().toLowerCase();

async function resolveVariantIdFromSelectedOptionsTx(
  tx: any,
  productId: string,
  selectedOptions: any
): Promise<string | null> {
  const arr = Array.isArray(selectedOptions) ? selectedOptions : [];

  const wantedIdPairs = new Set<string>();
  const wantedAttrIdNamePairs = new Set<string>();
  const wantedNamePairs = new Set<string>();

  for (const x of arr) {
    const attributeId = x?.attributeId != null ? String(x.attributeId) : "";
    const valueId = x?.valueId != null ? String(x.valueId) : "";
    const attributeName = x?.attribute != null ? norm(x.attribute) : "";
    const valueName = x?.value != null ? norm(x.value) : "";

    if (attributeId && valueId) wantedIdPairs.add(`${attributeId}::${valueId}`);
    if (attributeId && valueName) wantedAttrIdNamePairs.add(`${attributeId}::${valueName}`);
    if (attributeName && valueName) wantedNamePairs.add(`${attributeName}::${valueName}`);
  }

  const wantedCount = Math.max(wantedIdPairs.size, wantedAttrIdNamePairs.size, wantedNamePairs.size);
  if (!wantedCount) return null;

  const variants = await tx.productVariant.findMany({
    where: { productId, isActive: true, archivedAt: null },
    select: {
      id: true,
      options: {
        select: {
          attributeId: true,
          valueId: true,
          attribute: { select: { name: true } },
          value: { select: { name: true } },
        },
      },
    },
  });

  const buildVariantSets = (v: any) => {
    const idSet = new Set<string>();
    const attrIdNameSet = new Set<string>();
    const nameSet = new Set<string>();

    for (const o of v.options || []) {
      const aId = o?.attributeId != null ? String(o.attributeId) : "";
      const vId = o?.valueId != null ? String(o.valueId) : "";
      const aName = o?.attribute?.name != null ? norm(o.attribute.name) : "";
      const vName = o?.value?.name != null ? norm(o.value.name) : "";

      if (aId && vId) idSet.add(`${aId}::${vId}`);
      if (aId && vName) attrIdNameSet.add(`${aId}::${vName}`);
      if (aName && vName) nameSet.add(`${aName}::${vName}`);
    }

    return { idSet, attrIdNameSet, nameSet, optionCount: (v.options || []).length };
  };

  const setEquals = (a: Set<string>, b: Set<string>) => {
    if (a.size !== b.size) return false;
    for (const k of a) if (!b.has(k)) return false;
    return true;
  };

  const setContainsAll = (container: Set<string>, needed: Set<string>) => {
    for (const k of needed) if (!container.has(k)) return false;
    return true;
  };

  for (const v of variants) {
    const sets = buildVariantSets(v);

    if (wantedIdPairs.size && setEquals(sets.idSet, wantedIdPairs)) return String(v.id);
    if (!wantedIdPairs.size && wantedAttrIdNamePairs.size && setEquals(sets.attrIdNameSet, wantedAttrIdNamePairs))
      return String(v.id);
    if (!wantedIdPairs.size && !wantedAttrIdNamePairs.size && wantedNamePairs.size && setEquals(sets.nameSet, wantedNamePairs))
      return String(v.id);
  }

  let best: { id: string; extra: number } | null = null;

  for (const v of variants) {
    const sets = buildVariantSets(v);

    const ok =
      (wantedIdPairs.size && setContainsAll(sets.idSet, wantedIdPairs)) ||
      (!wantedIdPairs.size &&
        wantedAttrIdNamePairs.size &&
        setContainsAll(sets.attrIdNameSet, wantedAttrIdNamePairs)) ||
      (!wantedIdPairs.size && !wantedAttrIdNamePairs.size && wantedNamePairs.size && setContainsAll(sets.nameSet, wantedNamePairs));

    if (!ok) continue;

    const extra = Math.max(0, sets.optionCount - wantedCount);
    if (!best || extra < best.extra) best = { id: String(v.id), extra };
  }

  return best ? best.id : null;
}

async function resolveRetailCustomerUnitTx(tx: any, productId: string, variantId: string | null): Promise<number> {
  const prod = await tx.product.findUnique({
    where: { id: productId },
    select: { retailPrice: true },
  });

  const productRetail = asNumber(prod?.retailPrice, 0);
  if (!(productRetail > 0)) {
    throw new Error(`Missing retail base price (Product.retailPrice) for product ${productId}.`);
  }

  if (!variantId) return round2(productRetail);

  const v = await tx.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      productId: true,
      retailPrice: true,
      options: { select: { priceBump: true } },
    } as any,
  });

  if (!v || String((v as any).productId) !== String(productId)) {
    throw new Error(`Variant ${variantId} does not belong to product ${productId}.`);
  }

  const bumpFromVariant = Math.max(0, asNumber((v as any).retailPrice, 0));
  if (bumpFromVariant > 0) {
    return round2(productRetail + bumpFromVariant);
  }

  const bumps = ((v as any).options || [])
    .map((o: any) => Math.max(0, asNumber(o?.priceBump, 0)))
    .filter((n: number) => n > 0);

  const singleBump = bumps.length ? Math.max(...bumps) : 0;

  return round2(productRetail + singleBump);
}

function assertClientUnitPriceMatches(
  serverUnit: number,
  clientUnit: any,
  ctx: { productId: string; variantId: string | null }
) {
  if (clientUnit == null) return;

  const n = Number(clientUnit);
  if (!Number.isFinite(n) || n <= 0) return;

  const tolerance = 1;
  if (Math.abs(serverUnit - n) > tolerance) {
    throw new Error(
      `Unit price mismatch for product ${ctx.productId}${ctx.variantId ? ` (variant ${ctx.variantId})` : ""}. ` +
        `Client sent ${n}, server computed ${serverUnit}.`
    );
  }
}

function formatSelectedOptionsForMsg(selectedOptions: any): string {
  const arr = Array.isArray(selectedOptions) ? selectedOptions : [];

  const parts = arr
    .map((o: any) => {
      const a = String(o?.attribute ?? "").trim();
      const v = String(o?.value ?? "").trim();
      if (a && v) return `${a}: ${v}`;
      return v || a || "";
    })
    .filter(Boolean);

  return parts.length ? ` (${parts.join(", ")})` : "";
}

function supplierAllocHoldStatus(): any {
  const E = (Prisma as any).SupplierPaymentStatus;
  if (!E) return "PENDING"; // fallback

  // pick the best "hold/escrow" style status that exists in YOUR enum
  return E.HELD ?? E.ON_HOLD ?? E.HOLD ?? E.PENDING ?? E.CREATED ?? Object.values(E)[0];
}

/* =========================================================
   POST /api/orders — create + allocate across offers
========================================================= */

router.post("/", requireAuth, async (req: Request, res: Response) => {
  const body = req.body as CreateOrderBody;
  const items = Array.isArray(body.items) ? body.items : [];

  if (items.length === 0) return res.status(400).json({ error: "No items." });
  if (!body.shippingAddressId && !body.shippingAddress) {
    return res.status(400).json({ error: "shippingAddress or shippingAddressId is required." });
  }

  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const created = await prisma.$transaction(
      async (tx: any) => {
        const data: any = {
          subtotal: 0,
          tax: 0,
          total: 0,
          status: "CREATED",
          user: { connect: { id: userId } },
        };

        if (body.shippingAddressId) {
          data.shippingAddress = { connect: { id: body.shippingAddressId } };
        } else {
          const a = body.shippingAddress!;
          data.shippingAddress = {
            create: {
              houseNumber: a.houseNumber ?? null,
              streetName: a.streetName ?? null,
              postCode: a.postCode ?? null,
              town: a.town ?? null,
              city: a.city ?? null,
              state: a.state ?? null,
              country: a.country ?? null,
            },
          };
        }

        if (body.billingAddressId) {
          data.billingAddress = { connect: { id: body.billingAddressId } };
        } else if (body.billingAddress) {
          const b = body.billingAddress;
          data.billingAddress = {
            create: {
              houseNumber: b.houseNumber ?? null,
              streetName: b.streetName ?? null,
              postCode: b.postCode ?? null,
              town: b.town ?? null,
              city: b.city ?? null,
              state: b.state ?? null,
              country: b.country ?? null,
            },
          };
        }

        const order = await tx.order.create({ data });

        await logOrderActivityTx(tx, order.id, ACT.ORDER_CREATED as any, "Order created");
        if (body.notes && String(body.notes).trim()) {
          await logOrderActivityTx(tx, order.id, ACT.NOTE as any, String(body.notes).trim());
        }

        let runningSubtotal = 0;

        for (const line of items) {
          const productId = String((line as any).productId ?? "").trim();
          if (!productId) throw new Error("Invalid line item: missing productId.");

          const qtyNeeded = Number((line as any).qty ?? (line as any).quantity ?? 0);
          if (!Number.isFinite(qtyNeeded) || qtyNeeded <= 0) throw new Error("Invalid line item.");

          const { title: productTitle } = await assertProductSellableTx(tx, productId);

          const selectedOptionsRaw = (line as any).selectedOptions ?? null;
          let selectedOptions: any = null;
          try {
            if (typeof selectedOptionsRaw === "string") selectedOptions = JSON.parse(selectedOptionsRaw);
            else selectedOptions = selectedOptionsRaw;
          } catch {
            selectedOptions = selectedOptionsRaw;
          }

          const optionsLabel = formatSelectedOptionsForMsg(selectedOptions);

          const explicitOfferId = (line as any).offerId ?? (line as any).supplierOfferId ?? null;

          let variantId: string | null = null;
          let candidates: CandidateOffer[] = [];

          const variantFromOptions = await resolveVariantIdFromSelectedOptionsTx(tx, productId, selectedOptions);

          // ✅ offerId is only used to *identify variant combo*, NOT to lock supplier.
          if (explicitOfferId) {
            const one = await fetchOneOfferByIdTx(tx, String(explicitOfferId));
            if (!one) throw new Error(`Offer not found/disabled for product ${productId}.`);
            if (String(one.productId) !== productId) {
              throw new Error(`Offer mismatch: wrong product for offer ${explicitOfferId}.`);
            }

            variantId = one.variantId ? String(one.variantId) : null;
            if (!variantId && variantFromOptions) variantId = String(variantFromOptions);

            if (variantId) {
              await assertVariantSellableTx(tx, productId, variantId);
              candidates = await fetchActiveOffersTx(tx, { productId, variantId });
            } else {
              candidates = await fetchActiveBaseOffersTx(tx, { productId });
            }
          } else {
            const rawVariantId = (line as any).variantId ?? null;
            const trimmed = rawVariantId && String(rawVariantId).trim() ? String(rawVariantId).trim() : null;

            if (trimmed) variantId = trimmed;
            else if (variantFromOptions) variantId = String(variantFromOptions);

            if (variantId) {
              await assertVariantSellableTx(tx, productId, variantId);
              candidates = await fetchActiveOffersTx(tx, { productId, variantId });
            } else {
              candidates = await fetchActiveBaseOffersTx(tx, { productId });
            }
          }

          sortOffersCheapestFirst(candidates);

          if (!candidates.length) {
            throw new Error(`No active supplier offers for: ${productTitle}${optionsLabel}.`);
          }

          const totalAvailable = candidates.reduce(
            (s, o) => s + Math.max(0, Number(o.availableQty || 0)),
            0
          );
          if (totalAvailable < qtyNeeded) {
            throw new Error(
              `Insufficient stock for ${productTitle}${optionsLabel}. Need ${qtyNeeded}, available ${totalAvailable}.`
            );
          }

          const customerUnit = await resolveRetailCustomerUnitTx(tx, productId, variantId);
          assertClientUnitPriceMatches(customerUnit, (line as any).unitPrice, { productId, variantId });

          let need = qtyNeeded;

          const allocations: Array<{
            supplierId: string;
            qty: number;
            supplierUnitCost: number;
            model: CandidateOffer["model"];
            supplierProductOfferId: string | null;
            supplierVariantOfferId: string | null;
          }> = [];

          for (const o of candidates) {
            if (need <= 0) break;
            if (o.availableQty <= 0) continue;

            if (!o.supplierId) {
              throw new Error(`Bad offer data: missing supplierId for offer ${o.id}`);
            }

            // ✅ Only require ACTIVE supplier; product ownership irrelevant
            await assertSupplierPurchasableTx(tx, o.supplierId);

            const take = Math.min(need, o.availableQty);
            await decrementOfferQtyTx(tx, o, take);

            allocations.push({
              supplierId: o.supplierId,
              qty: take,
              supplierUnitCost: o.offerPrice,
              model: o.model,
              supplierProductOfferId:
                o.model === "BASE_OFFER"
                  ? o.supplierProductOfferId ?? o.id
                  : o.model === "VARIANT_OFFER"
                    ? o.supplierProductOfferId ?? null
                    : null,
              supplierVariantOfferId: o.model === "VARIANT_OFFER" ? String(o.id) : null,
            });

            need -= take;
          }

          for (const alloc of allocations) {
            await tx.orderItem.create({
              data: {
                orderId: order.id,
                productId,
                variantId: variantId,

                chosenSupplierProductOfferId: alloc.supplierProductOfferId,
                chosenSupplierVariantOfferId: alloc.supplierVariantOfferId,
                chosenSupplierId: alloc.supplierId,
                chosenSupplierUnitPrice: alloc.supplierUnitCost,

                title: productTitle,
                unitPrice: customerUnit,
                quantity: alloc.qty,
                lineTotal: customerUnit * alloc.qty,

                selectedOptions: selectedOptions ?? null,
              },
            });

            runningSubtotal += customerUnit * alloc.qty;
          }

          await syncProductInStockCacheTx(tx, productId);
        }

        const subtotal = round2(runningSubtotal);

        const taxMode = await getTaxModeTx(tx);
        const taxRatePct = await getTaxRatePctTx(tx);

        const rate = Math.max(0, taxRatePct) / 100;

        // ✅ If INCLUDED: extract VAT portion from subtotal (which already includes VAT)
        const vatIncluded = taxMode === "INCLUDED" && rate > 0 ? subtotal - subtotal / (1 + rate) : 0;

        // ✅ If ADDED: compute VAT to add on top
        const vatAddOn = taxMode === "ADDED" && rate > 0 ? subtotal * rate : 0;

        const svc = await computeServiceFeeForOrderTx(tx, order.id, subtotal);
        const total = round2(subtotal + vatAddOn + svc.serviceFeeTotal);

        const purchaseOrders = await ensurePurchaseOrdersForOrderTx(tx, order.id);

        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: {
            subtotal,
            tax: round2(taxMode === "INCLUDED" ? vatIncluded : taxMode === "ADDED" ? vatAddOn : 0),
            total,

            serviceFeeBase: svc.serviceFeeBase,
            serviceFeeComms: svc.serviceFeeComms,
            serviceFeeGateway: svc.serviceFeeGateway,
            serviceFeeTotal: svc.serviceFeeTotal,
            serviceFee: svc.serviceFeeTotal,
          },
          select: {
            id: true,
            subtotal: true,
            tax: true,
            total: true,
            status: true,
            createdAt: true,
            serviceFeeBase: true,
            serviceFeeComms: true,
            serviceFeeGateway: true,
            serviceFeeTotal: true,
          },
        });

        return {
          ...updatedOrder,
          meta: {
            taxMode,
            taxRatePct,
            vatIncluded: round2(vatIncluded),
            vatAddOn: round2(vatAddOn),
            serviceFeeMeta: svc.meta,
            purchaseOrders,
          },
        };
      },
      { isolationLevel: "Serializable" as any }
    );

    return res.status(201).json({ data: created });
  } catch (e: any) {
    console.error("create order failed:", e);
    return res.status(400).json({ error: e?.message || "Could not create order" });
  }
});

/* ---------------- Availability helpers (used by GET routes) ---------------- */

type Pair = { productId: string; variantId: string | null };
type AvailabilityRow = { productId: string; variantId: string | null; totalAvailable: number };

function availKey(productId: string, variantId: string | null) {
  return `${String(productId)}::${variantId ?? "null"}`;
}

export async function computeAvailabilityForPairsTx(
  tx: any,
  pairs: Pair[],
  opts?: { includeBase?: boolean }
): Promise<AvailabilityRow[]> {
  const includeBase = opts?.includeBase ?? true;

  const basePairs = pairs.filter((p) => !p.variantId);
  const variantPairs = pairs.filter((p) => !!p.variantId);

  const baseAgg =
    includeBase && basePairs.length
      ? await tx.supplierProductOffer.groupBy({
          by: ["productId"],
          _sum: { availableQty: true },
          where: {
            productId: { in: basePairs.map((p) => p.productId) },
            basePrice: { gt: 0 },
            isActive: true,
            inStock: true,

            // ✅ CHANGE: availability should reflect checkout-ready suppliers (ACTIVE),
            // not payout-ready bank-verified suppliers
            supplier: supplierCheckoutReadyRelationFilter(),
          },
        })
      : [];

  const baseMap = new Map<string, number>();
  for (const r of baseAgg as any[]) {
    baseMap.set(String(r.productId), Math.max(0, Number(r._sum?.availableQty ?? 0)));
  }

  const variantAgg = variantPairs.length
    ? await tx.supplierVariantOffer.groupBy({
        by: ["productId", "variantId"],
        _sum: { availableQty: true },
        where: {
          OR: variantPairs.map((p) => ({
            productId: p.productId,
            variantId: p.variantId!,
          })),
          isActive: true,
          inStock: true,

          supplier: supplierCheckoutReadyRelationFilter(),
        },
      })
    : [];

  const variantMap = new Map<string, number>();
  for (const r of variantAgg as any[]) {
    variantMap.set(`${String(r.productId)}::${String(r.variantId)}`, Math.max(0, Number(r._sum?.availableQty ?? 0)));
  }

  return pairs.map((p) => {
    const pid = String(p.productId);
    const vid = p.variantId ? String(p.variantId) : null;

    const totalAvailable = vid == null ? baseMap.get(pid) ?? 0 : variantMap.get(`${pid}::${vid}`) ?? 0;

    return { productId: pid, variantId: vid, totalAvailable };
  });
}

async function buildAvailabilityGetter(pairs: Pair[]) {
  const rows = await computeAvailabilityForPairsTx(prisma as any, pairs, { includeBase: true });

  const map: Record<string, { availableQty: number; inStock: boolean }> = {};
  for (const r of rows) {
    const qty = Math.max(0, Number((r as any).totalAvailable || 0));
    map[availKey((r as any).productId, (r as any).variantId)] = { availableQty: qty, inStock: qty > 0 };
  }

  for (const p of pairs) {
    const k = availKey(p.productId, p.variantId);
    if (!map[k]) map[k] = { availableQty: 0, inStock: false };
  }

  return (productId: string, variantId: string | null) => map[availKey(productId, variantId)] ?? { availableQty: 0, inStock: false };
}

/* =========================================================
   GET /api/orders (admins only)
========================================================= */

router.get("/", requireAuth, async (req, res) => {
  try {
    if (!isAdmin((req as any).user?.role)) {
      return res.status(403).json({ error: "Admins only" });
    }

    const limitRaw = Number(req.query.limit);
    const take = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50;

    const q = String(req.query.q ?? "").trim();
    const where: any = q
      ? {
          OR: [{ id: { contains: q } }, { user: { email: { contains: q, mode: "insensitive" as const } } }],
        }
      : {};

    const asNumLocal = (v: any, d = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };

    const orders = await prisma.order.findMany({
      where: {},
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        subtotal: true,
        tax: true,
        total: true,
        createdAt: true,
        serviceFeeBase: true,
        serviceFeeComms: true,
        serviceFeeGateway: true,
        serviceFeeTotal: true,

        user: {
          select: { email: true },
        },

        purchaseOrders: {
          select: {
            id: true,
            supplierId: true,
            status: true,
            payoutStatus: true,
            deliveryOtpVerifiedAt: true,
            deliveredAt: true,
            shippedAt: true,
            createdAt: true,
          },
        },
      },
    });

    const orderIds = orders.map((o: any) => o.id);
    if (orderIds.length === 0) return res.json({ data: [] });

    const poRows = await prisma.purchaseOrder.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true, supplierId: true, status: true },
    });
    const poStatusByOrderSupplier: Record<string, string> = {};
    for (const po of poRows as any[]) {
      poStatusByOrderSupplier[`${String(po.orderId)}::${String(po.supplierId)}`] = String(po.status || "PENDING");
    }

    const paymentsByOrder: Record<string, any[]> = {};
    try {
      const payRows = await prisma.payment.findMany({
        where: { orderId: { in: orderIds } },
        orderBy: { createdAt: "desc" },
        select: { id: true, orderId: true, status: true, provider: true, reference: true, amount: true, createdAt: true },
      });

      for (const p of payRows as any[]) {
        const oid = String(p.orderId);
        (paymentsByOrder[oid] ||= []).push({
          id: String(p.id),
          status: String(p.status),
          provider: p.provider ?? null,
          reference: p.reference ?? null,
          amount: p.amount != null ? Number(p.amount) : null,
          createdAt: p.createdAt?.toISOString?.() ?? p.createdAt ?? null,
        });
      }
    } catch (e) {
      console.error("Failed to load payments for orders", e);
    }

    const paidAmountByOrder: Record<string, number> = {};
    try {
      const paid = await prisma.payment.findMany({
        where: { orderId: { in: orderIds }, status: "PAID" as any },
        select: { orderId: true, amount: true },
      });
      for (const p of paid as any[]) {
        const id = String(p.orderId);
        paidAmountByOrder[id] = (paidAmountByOrder[id] || 0) + asNumLocal(p.amount, 0);
      }
    } catch {}

    const itemsByOrder: Record<string, any[]> = {};
    let allItems: any[] = [];
    try {
      allItems = await prisma.orderItem.findMany({
        where: { orderId: { in: orderIds } },
        select: {
          id: true,
          orderId: true,
          productId: true,
          variantId: true,
          title: true,
          unitPrice: true,
          quantity: true,
          lineTotal: true,

          chosenSupplierProductOfferId: true,
          chosenSupplierVariantOfferId: true,
          chosenSupplierId: true,
          chosenSupplierUnitPrice: true,
          selectedOptions: true,
        },
        orderBy: [{ orderId: "asc" }, { id: "asc" }],
      });

      const uniqPairs: Pair[] = [];
      const seen = new Set<string>();
      for (const it of allItems) {
        const pid = String(it.productId);
        const vid = it.variantId == null ? null : String(it.variantId);
        const k = availKey(pid, vid);
        if (!seen.has(k)) {
          seen.add(k);
          uniqPairs.push({ productId: pid, variantId: vid });
        }
      }
      const getAvail = await buildAvailabilityGetter(uniqPairs);

      for (const it of allItems) {
        const oid = String(it.orderId);
        const unitPrice = asNumLocal(it.unitPrice, 0);
        const quantity = asNumLocal(it.quantity, 1);
        const lineTotal = asNumLocal(it.lineTotal ?? unitPrice * quantity, unitPrice * quantity);

        const pid = String(it.productId);
        const vid = it.variantId == null ? null : String(it.variantId);
        const { availableQty, inStock } = getAvail(pid, vid);

        const supplierId = it.chosenSupplierId ? String(it.chosenSupplierId) : "";
        const itemStatus = supplierId ? poStatusByOrderSupplier[`${oid}::${supplierId}`] ?? "PENDING" : "PENDING";

        (itemsByOrder[oid] ||= []).push({
          id: it.id,
          productId: it.productId,
          variantId: it.variantId ?? null,
          title: it.title ?? "—",
          unitPrice,
          quantity,
          lineTotal,

          status: itemStatus,

          chosenSupplierProductOfferId: it.chosenSupplierProductOfferId ?? null,
          chosenSupplierVariantOfferId: it.chosenSupplierVariantOfferId ?? null,
          chosenSupplierId: it.chosenSupplierId ?? null,
          chosenSupplierUnitPrice: it.chosenSupplierUnitPrice != null ? asNumLocal(it.chosenSupplierUnitPrice, 0) : null,

          selectedOptions: it.selectedOptions ?? null,
          currentAvailableQty: availableQty,
          currentInStock: inStock,
        });
      }
    } catch (e) {
      console.error("Failed to load order items", e);
    }

    const data = orders.map((o: any) => ({
      id: o.id,
      userEmail: o.user?.email ?? null,
      status: o.status,
      subtotal: asNumLocal(o.subtotal, 0),
      tax: asNumLocal(o.tax, 0),
      total: asNumLocal(o.total, 0),

      serviceFeeBase: asNumLocal(o.serviceFeeBase, 0),
      serviceFeeComms: asNumLocal(o.serviceFeeComms, 0),
      serviceFeeGateway: asNumLocal(o.serviceFeeGateway, 0),
      serviceFeeTotal: asNumLocal(o.serviceFeeTotal, 0),

      paidAmount: paidAmountByOrder[o.id] || 0,
      createdAt: o.createdAt?.toISOString?.() ?? o.createdAt,
      items: itemsByOrder[o.id] || [],
      payments: paymentsByOrder[o.id] || [],
    }));

    return res.json({
      data: orders.map((o: any) => ({
        ...o,
        // this part in your snippet looked inconsistent (purchaseOrder vs purchaseOrders),
        // but kept as-is to avoid schema changes:
        deliveryOtpVerifiedAt: o.purchaseOrder?.deliveryOtpVerifiedAt ?? null,
        purchaseOrder: undefined,
      })),
    });
  } catch (e: any) {
    console.error("GET /api/orders failed:", e?.message, e?.stack);
    res.status(500).json({ error: e?.message || "Failed to fetch orders" });
  }
});

/* =========================================================
   GET /api/orders/mine — end user
========================================================= */

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit);
    const take = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50;

    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const asNumLocal = (x: any, d = 0) => {
      const n = Number(x);
      return Number.isFinite(n) ? n : d;
    };

    const toShopperStatus = (s: any) => {
      const u = String(s || "").toUpperCase();
      if (!u || u === "PENDING" || u === "CREATED" || u === "FUNDED") return "PROCESSING";
      return u;
    };

    const baseOrders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        status: true,
        subtotal: true,
        tax: true,
        total: true,
        createdAt: true,
        serviceFeeBase: true,
        serviceFeeComms: true,
        serviceFeeGateway: true,
        serviceFeeTotal: true,
      },
    });

    const orderIds = baseOrders.map((o: any) => o.id);
    if (orderIds.length === 0) return res.json({ data: [] });

    const poRows = await prisma.purchaseOrder.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true, supplierId: true, status: true },
    });
    const poStatusByOrderSupplier: Record<string, string> = {};
    for (const po of poRows as any[]) {
      poStatusByOrderSupplier[`${String(po.orderId)}::${String(po.supplierId)}`] = String(po.status || "PENDING");
    }

    const allItems = await prisma.orderItem.findMany({
      where: { orderId: { in: orderIds } },
      select: {
        id: true,
        orderId: true,
        productId: true,
        variantId: true,
        title: true,
        unitPrice: true,
        quantity: true,
        lineTotal: true,

        chosenSupplierProductOfferId: true,
        chosenSupplierVariantOfferId: true,
        chosenSupplierId: true,
        chosenSupplierUnitPrice: true,
        selectedOptions: true,
      },
      orderBy: [{ orderId: "asc" }, { id: "asc" }],
    });

    const uniqPairs: Pair[] = [];
    const seen = new Set<string>();
    for (const it of allItems) {
      const pid = String(it.productId);
      const vid = it.variantId == null ? null : String(it.variantId);
      const k = availKey(pid, vid);
      if (!seen.has(k)) {
        seen.add(k);
        uniqPairs.push({ productId: pid, variantId: vid });
      }
    }
    const getAvail = await buildAvailabilityGetter(uniqPairs);

    const itemsByOrder: Record<string, any[]> = {};
    for (const it of allItems as any[]) {
      const oid = String(it.orderId);

      const qty = asNumLocal(it.quantity, 1);
      const unitPrice = asNumLocal(it.unitPrice, 0);
      const lineTotal = asNumLocal(it.lineTotal ?? unitPrice * qty, unitPrice * qty);

      const pid = String(it.productId);
      const vid = it.variantId == null ? null : String(it.variantId);
      const { availableQty, inStock } = getAvail(pid, vid);

      const supplierId = it.chosenSupplierId ? String(it.chosenSupplierId) : "";
      const rawPoStatus = supplierId ? poStatusByOrderSupplier[`${oid}::${supplierId}`] ?? "PENDING" : "PENDING";

      (itemsByOrder[oid] ||= []).push({
        id: it.id,
        productId: it.productId,
        variantId: it.variantId ?? null,
        title: it.title ?? "—",
        unitPrice,
        quantity: qty,
        lineTotal,

        status: toShopperStatus(rawPoStatus),
        supplierStatusRaw: String(rawPoStatus || "PENDING"),

        chosenSupplierProductOfferId: it.chosenSupplierProductOfferId ?? null,
        chosenSupplierVariantOfferId: it.chosenSupplierVariantOfferId ?? null,
        chosenSupplierId: it.chosenSupplierId ?? null,
        chosenSupplierUnitPrice: it.chosenSupplierUnitPrice != null ? asNumLocal(it.chosenSupplierUnitPrice, 0) : null,

        currentAvailableQty: availableQty,
        currentInStock: inStock,
        selectedOptions: it.selectedOptions ?? null,
      });
    }

    const data = baseOrders.map((o: any) => ({
      id: o.id,
      status: o.status,
      subtotal: asNumLocal(o.subtotal, 0),
      tax: asNumLocal(o.tax, 0),
      total: asNumLocal(o.total, 0),
      createdAt: o.createdAt?.toISOString?.() ?? o.createdAt,
      items: itemsByOrder[o.id] || [],

      serviceFeeBase: asNumLocal(o.serviceFeeBase, 0),
      serviceFeeComms: asNumLocal(o.serviceFeeComms, 0),
      serviceFeeGateway: asNumLocal(o.serviceFeeGateway, 0),
      serviceFeeTotal: asNumLocal(o.serviceFeeTotal, 0),
    }));

    res.json({ data });
  } catch (e: any) {
    console.error("list my orders failed:", e?.message, e?.stack);
    res.status(500).json({ error: e?.message || "Failed to fetch your orders" });
  }
});

/* =========================================================
   GET /api/orders/summary (end user)
========================================================= */

router.get("/summary", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req)!;

    const [countAll, paidAgg, latest] = await prisma.$transaction([
      prisma.order.count({ where: { userId } }),
      prisma.order.aggregate({
        where: { userId, status: { in: ["PAID", "COMPLETED"] } as any },
        _sum: { total: true },
      }),
      prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        take: 5,
        select: { id: true, status: true, total: true, createdAt: true },
      }),
    ]);

    res.json({
      ordersCount: countAll,
      totalSpent: Number((paidAgg as any)._sum.total ?? 0),
      recent: (latest as any[]).map((o: any) => ({
        id: o.id,
        status: o.status,
        total: Number(o.total ?? 0),
        createdAt: o.createdAt?.toISOString?.() ?? o.createdAt,
      })),
    });
  } catch (err: any) {
    console.error("orders summary failed:", err);
    res.status(500).json({ error: err?.message || "Failed to fetch summary" });
  }
});

/* =========================================================
   GET /api/orders/:id — single order
========================================================= */

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;

    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        subtotal: true,
        tax: true,
        total: true,
        createdAt: true,

        serviceFeeBase: true,
        serviceFeeComms: true,
        serviceFeeGateway: true,
        serviceFeeTotal: true,
        serviceFee: true,

        user: { select: { id: true, email: true } },

        items: {
          select: {
            id: true,
            orderId: true,
            productId: true,
            variantId: true,
            title: true,
            unitPrice: true,
            quantity: true,
            lineTotal: true,
            chosenSupplierId: true,
            chosenSupplierUnitPrice: true,
            chosenSupplierProductOfferId: true,
            chosenSupplierVariantOfferId: true,
            selectedOptions: true,
          },
        },

        purchaseOrders: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            supplierId: true,
            status: true,
            subtotal: true,
            platformFee: true,
            supplierAmount: true,
            createdAt: true,
            supplier: { select: { id: true, name: true } },
          },
        },

        payments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            provider: true,
            channel: true,
            reference: true,
            amount: true,
            feeAmount: true,
            createdAt: true,
            allocations: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                supplierId: true,
                amount: true,
                status: true,
                purchaseOrderId: true,
                supplierNameSnapshot: true,
                supplier: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!order) return res.status(404).json({ error: "Order not found" });

    const adminUser = isAdmin((req as any).user?.role);
    if (!adminUser && String(order.user?.id) !== String((req as any).user?.id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (adminUser) {
      const hasPOs = (order as any).purchaseOrders?.length > 0;
      const latestPaidPayment = ((order as any).payments || []).find((p: any) => String(p.status) === "PAID");
      const hasAlloc = latestPaidPayment?.allocations?.length > 0;

      if (!hasPOs || (latestPaidPayment && !hasAlloc)) {
        await prisma.$transaction(async (tx: any) => {
          if (!hasPOs) {
            await ensurePurchaseOrdersForOrderTx(tx, id);
          }
          if (latestPaidPayment && !hasAlloc) {
            await recordSupplierAllocationsOnPaidTx(tx, String(latestPaidPayment.id), id);
          }
        });
      }
    }

    const asNumLocal = (v: any, d = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };

    const toShopperStatus = (s: any) => {
      const u = String(s || "").toUpperCase();
      if (!u || u === "PENDING" || u === "CREATED" || u === "FUNDED") return "PROCESSING";
      return u;
    };

    const poStatusBySupplier = new Map<string, string>();
    for (const po of ((order as any).purchaseOrders || []) as any[]) {
      poStatusBySupplier.set(String(po.supplierId), String(po.status || "PENDING"));
    }

    const uniqPairs: Pair[] = [];
    const seen = new Set<string>();
    for (const it of (order as any).items as any[]) {
      const pid = String(it.productId);
      const vid = it.variantId == null ? null : String(it.variantId);
      const k = availKey(pid, vid);
      if (!seen.has(k)) {
        seen.add(k);
        uniqPairs.push({ productId: pid, variantId: vid });
      }
    }
    const getAvail = await buildAvailabilityGetter(uniqPairs);

    const data = {
      id: (order as any).id,
      userEmail: (order as any).user?.email ?? null,
      status: (order as any).status,
      subtotal: Number((order as any).subtotal ?? 0),
      tax: Number((order as any).tax ?? 0),
      total: Number((order as any).total ?? 0),

      serviceFeeBase: Number((order as any).serviceFeeBase ?? 0),
      serviceFeeComms: Number((order as any).serviceFeeComms ?? 0),
      serviceFeeGateway: Number((order as any).serviceFeeGateway ?? 0),
      serviceFeeTotal: Number((order as any).serviceFeeTotal ?? 0),

      createdAt: (order as any).createdAt?.toISOString?.() ?? (order as any).createdAt,
      items: ((order as any).items as any[]).map((it: any) => {
        const pid = String(it.productId);
        const vid = it.variantId == null ? null : String(it.variantId);
        const { availableQty, inStock } = getAvail(pid, vid);

        const supplierId = it.chosenSupplierId ? String(it.chosenSupplierId) : "";
        const rawPoStatus = supplierId ? poStatusBySupplier.get(supplierId) ?? "PENDING" : "PENDING";

        return {
          id: it.id,
          productId: it.productId,
          variantId: it.variantId ?? null,
          title: it.title ?? "—",
          unitPrice: asNumLocal(it.unitPrice, 0),
          quantity: asNumLocal(it.quantity, 1),
          lineTotal: asNumLocal(it.lineTotal, asNumLocal(it.unitPrice, 0) * asNumLocal(it.quantity, 1)),

          status: adminUser ? String(rawPoStatus) : toShopperStatus(rawPoStatus),
          supplierStatusRaw: String(rawPoStatus),

          chosenSupplierProductOfferId: it.chosenSupplierProductOfferId ?? null,
          chosenSupplierVariantOfferId: it.chosenSupplierVariantOfferId ?? null,

          chosenSupplierId: it.chosenSupplierId ?? null,
          chosenSupplierUnitPrice: it.chosenSupplierUnitPrice != null ? asNumLocal(it.chosenSupplierUnitPrice, 0) : null,

          currentAvailableQty: availableQty,
          currentInStock: inStock,
          selectedOptions: it.selectedOptions ?? null,
        };
      }),
      payments: (order as any).payments,
      purchaseOrders: (order as any).purchaseOrders ?? [],
    };

    res.json({ data });
  } catch (e: any) {
    console.error("get order failed:", e);
    res.status(500).json({ error: e?.message || "Failed to fetch order" });
  }
});

/* =========================================================
   GET /api/orders/:orderId/profit (super admin)
========================================================= */

router.get("/:orderId/profit", requireSuperAdmin, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        total: true,
        serviceFeeTotal: true,
        status: true,
        createdAt: true,
      },
    });

    if (!order) return res.status(404).json({ error: "Order not found" });

    const payments = await prisma.payment.findMany({
      where: { orderId, status: "PAID" as any },
      select: { id: true, amount: true, feeAmount: true },
    });

    const itemMetrics = await prisma.orderItemProfit.findMany({
      where: { orderId },
      orderBy: { computedAt: "desc" },
      select: {
        orderItemId: true,
        qty: true,
        unitPrice: true,
        chosenSupplierUnitPrice: true,
        revenue: true,
        cogs: true,
        allocatedGatewayFee: true,
        allocatedCommsFee: true,
        allocatedBaseServiceFee: true,
        profit: true,
        computedAt: true,
      },
    });

    const summary = itemMetrics.reduce(
      (s: any, x: any) => {
        s.revenue += Number(x.revenue || 0);
        s.cogs += Number(x.cogs || 0);
        s.gateway += Number(x.allocatedGatewayFee || 0);
        s.comms += Number(x.allocatedCommsFee || 0);
        s.base += Number(x.allocatedBaseServiceFee || 0);
        s.profit += Number(x.profit || 0);
        return s;
      },
      { revenue: 0, cogs: 0, gateway: 0, comms: 0, base: 0, profit: 0 }
    );

    res.json({
      order: {
        id: order.id,
        status: order.status,
        total: Number(order.total || 0),
        serviceFeeRecorded: Number((order as any).serviceFeeTotal || 0),
        paidAmount: payments.reduce((a: number, p: any) => a + Number(p.amount || 0), 0),
        gatewayFeeActual: payments.reduce((a: number, p: any) => a + Number(p.feeAmount || 0), 0),
      },
      summary,
      items: itemMetrics,
    });
  } catch (e: any) {
    console.error("profit endpoint failed:", e);
    res.status(500).json({ error: e?.message || "Failed to fetch profit" });
  }
});

const OrderOtpPurpose = z.enum(["PAY_ORDER", "CANCEL_ORDER"]);
router.post("/:id/otp/request", requireAuth, async (req, res) => {
  const orderId = String(req.params.id);
  const actorId = getUserId(req);
  if (!actorId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = OrderOtpPurpose.safeParse(req.body?.purpose);
  if (!parsed.success) return res.status(400).json({ error: "Invalid purpose" });
  const purpose = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      user: { select: { email: true, phone: true } },
      status: true,
      createdAt: true,
    },
  });
  if (!order) return res.status(404).json({ error: "Order not found" });

  if (purpose === "PAY_ORDER") {
    if (String(order.userId) !== String(actorId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  if (purpose === "CANCEL_ORDER") {
    const adminOk = isAdmin((req as any).user?.role);
    const ownerOk = String(order.userId) === String(actorId);
    if (!adminOk && !ownerOk) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const t = now();

  const last = await prisma.orderOtpRequest.findFirst({
    where: { orderId, purpose },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last?.createdAt) {
    const nextAllowed = addSeconds(last.createdAt, OTP_RESEND_COOLDOWN_SECS);
    if (nextAllowed > t) {
      return res.status(429).json({
        error: "Please wait before requesting another OTP",
        retryAt: nextAllowed,
      });
    }
  }

  const expiresInSec = OTP_EXPIRES_MINS * 60;

  const code = genOtp6();
  const salt = crypto.randomUUID();
  const codeHash = hashOtp(code, salt);
  const expiresAt = addSeconds(t, expiresInSec);

  const bindUserId = purpose === "PAY_ORDER" ? String(order.userId) : String(actorId);
  const targetEmail = purpose === "PAY_ORDER" ? (order.user?.email ?? null) : ((req as any).user?.email ?? null);
  const targetPhoneE164 =
    purpose === "PAY_ORDER" ? normalizeE164(order.user?.phone ?? null) : normalizeE164((req as any).user?.phone ?? null);

  const reqRow = await prisma.orderOtpRequest.create({
    data: {
      orderId,
      userId: bindUserId,
      purpose,
      salt,
      codeHash,
      expiresAt,
      attempts: 0,
      lockedUntil: null,
      verifiedAt: null,
      consumedAt: null,
    } as any,
    select: { id: true },
  });

  try {
    await sendOrderOtpNotifications({
      userEmail: targetEmail,
      userPhoneE164: targetPhoneE164,
      code,
      expiresMins: OTP_EXPIRES_MINS,
      purposeLabel: purpose === "PAY_ORDER" ? "Pay order" : "Cancel order",
      orderId,
      brand: "DaySpring",
    });
  } catch (e) {
    console.error("order otp notify failed:", e);
  }

  const channelHint =
    targetPhoneE164 && targetPhoneE164.length >= 4
      ? `sms/whatsapp to ***${targetPhoneE164.slice(-4)}`
      : targetEmail
        ? `email to ${String(targetEmail).replace(/(^.).+(@.*$)/, "$1***$2")}`
        : null;

  return res.json({
    requestId: reqRow.id,
    expiresInSec,
    channelHint,
  });
});

async function assertValidOtpTokenTx(
  tx: any,
  args: { orderId: string; purpose: "PAY_ORDER" | "CANCEL_ORDER"; otpToken: string; actorId: string; actorRole: string }
) {
  const { orderId, purpose, otpToken, actorId } = args;

  const row = await tx.orderOtpRequest.findFirst({
    where: {
      id: otpToken,
      orderId,
      purpose,
      verifiedAt: { not: null },
    },
    select: { id: true, userId: true, expiresAt: true, consumedAt: true },
  });

  if (!row) throw new Error("OTP token invalid");
  if (row.consumedAt) throw new Error("OTP token already used");
  if (row.expiresAt && row.expiresAt <= now()) throw new Error("OTP token expired");

  if (String(row.userId) !== String(actorId)) {
    throw new Error("OTP token not valid for this user");
  }

  await tx.orderOtpRequest.update({
    where: { id: row.id },
    data: { consumedAt: now() },
  });

  return true;
}

function requireOtp(purpose: "PAY_ORDER" | "CANCEL_ORDER") {
  return async (req: any, res: any, next: any) => {
    try {
      const orderId = String(req.params.id);
      const otpToken = String(req.header("x-otp-token") ?? "").trim();
      if (!otpToken) return res.status(401).json({ error: "Missing x-otp-token" });

      const actorId = getUserId(req);
      if (!actorId) return res.status(401).json({ error: "Unauthorized" });

      await prisma.$transaction(async (tx: any) => {
        await assertValidOtpTokenTx(tx, {
          orderId,
          purpose,
          otpToken,
          actorId,
          actorRole: actorRole(req),
        });
      });

      next();
    } catch (e: any) {
      return res.status(401).json({ error: e?.message || "OTP required" });
    }
  };
}

router.post("/:id/otp/verify", requireAuth, async (req, res) => {
  const orderId = String(req.params.id);
  const actorId = getUserId(req);
  if (!actorId) return res.status(401).json({ error: "Unauthorized" });

  const purposeP = OrderOtpPurpose.safeParse(req.body?.purpose);
  if (!purposeP.success) return res.status(400).json({ error: "Invalid purpose" });
  const purpose = purposeP.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true },
  });
  if (!order) return res.status(404).json({ error: "Order not found" });

  const requestId = String(req.body?.requestId ?? "").trim();
  const otp = String(req.body?.otp ?? "").trim();

  if (!requestId) return res.status(400).json({ error: "Missing requestId" });
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: "Invalid otp format" });

  const row = await prisma.orderOtpRequest.findFirst({
    where: { id: requestId, orderId, purpose },
    select: {
      id: true,
      userId: true,
      salt: true,
      codeHash: true,
      expiresAt: true,
      verifiedAt: true,
      attempts: true,
      lockedUntil: true,
      consumedAt: true,
    },
  });

  if (!row) return res.status(404).json({ error: "OTP request not found" });

  if (purpose === "PAY_ORDER") {
    if (String(order.userId) !== String(actorId)) return res.status(403).json({ error: "Forbidden" });
    if (String(row.userId) !== String(actorId)) return res.status(403).json({ error: "Forbidden" });
  } else {
    const adminOk = isAdmin((req as any).user?.role);
    const ownerOk = String(order.userId) === String(actorId);
    if (!adminOk && !ownerOk) return res.status(403).json({ error: "Forbidden" });

    if (String(row.userId) !== String(actorId)) return res.status(403).json({ error: "Forbidden" });
  }

  const t = now();

  if (row.consumedAt) return res.status(400).json({ error: "OTP token already used" });
  if (row.verifiedAt) return res.json({ token: row.id });

  if (row.lockedUntil && row.lockedUntil > t) {
    return res.status(429).json({ error: "OTP verification temporarily locked", lockedUntil: row.lockedUntil });
  }

  if (row.expiresAt <= t) return res.status(400).json({ error: "OTP expired" });

  const attemptedHash = hashOtp(otp, row.salt);
  const a = Buffer.from(attemptedHash, "hex");
  const b = Buffer.from(row.codeHash, "hex");
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    const nextAttempts = (row.attempts ?? 0) + 1;
    const lockedUntil = nextAttempts >= OTP_MAX_ATTEMPTS ? addMinutes(t, OTP_LOCK_MINS) : null;

    await prisma.orderOtpRequest.update({
      where: { id: row.id },
      data: { attempts: nextAttempts, lockedUntil },
    });

    return res.status(400).json({ error: "Incorrect OTP", attempts: nextAttempts, lockedUntil });
  }

  await prisma.orderOtpRequest.update({
    where: { id: row.id },
    data: { verifiedAt: t, attempts: 0, lockedUntil: null },
  });

  return res.json({ token: row.id });
});

// /api/orders
router.post("/:orderId/cancel", requireAuth, async (req, res) => {
  const { orderId } = req.params;
  const actorId = String((req as any).user?.id ?? "");

  if (!actorId) return res.status(401).json({ error: "Unauthorized" });

  // ✅ OTP REQUIRED
  try {
    const otpToken = String(req.headers["x-otp-token"] ?? req.body?.otpToken ?? "").trim();
    await assertVerifiedOrderOtp(orderId, "CANCEL_ORDER", otpToken, actorId);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "OTP verification required" });
  }

  try {
    const updated = await prisma.$transaction(async (tx: any) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            select: {
              id: true,
              productId: true,
              variantId: true,
              quantity: true,
              chosenSupplierProductOfferId: true,
              chosenSupplierVariantOfferId: true,
            },
          },
          payments: { select: { status: true } },
        },
      });

      if (!order) throw new Error("Order not found");

      const ownerId = String((order as any).userId ?? (order as any).customerId ?? "");
      if (!ownerId || ownerId !== actorId) {
        return res.status(403).json({ error: "Not allowed to cancel this order" });
      }

      const os = String(order.status || "").toUpperCase();
      if (os === "CANCELED") return order;

      const hasPaid = (order.payments || []).some((p: any) => {
        const s = String(p.status || "").toUpperCase();
        return ["PAID", "SUCCESS", "SUCCESSFUL", "VERIFIED", "COMPLETED"].includes(s);
      });

      if (hasPaid || ["PAID", "COMPLETED"].includes(os)) {
        throw new Error("Cannot cancel an order that has been paid/completed.");
      }

      // restock
      for (const it of order.items) {
        const qty = Number(it.quantity || 0);
        if (!qty || qty <= 0) continue;

        if (it.chosenSupplierVariantOfferId) {
          const updatedOffer = await tx.supplierVariantOffer.update({
            where: { id: it.chosenSupplierVariantOfferId },
            data: { availableQty: { increment: qty } },
            select: { id: true, availableQty: true, productId: true },
          });

          if (Number(updatedOffer.availableQty) > 0) {
            await tx.supplierVariantOffer.update({
              where: { id: updatedOffer.id },
              data: { inStock: true },
            });
          }

          if (updatedOffer.productId) {
            await recomputeProductStockTx(tx, String(updatedOffer.productId));
          }
        } else if (it.chosenSupplierProductOfferId) {
          const updatedOffer = await tx.supplierProductOffer.update({
            where: { id: it.chosenSupplierProductOfferId },
            data: { availableQty: { increment: qty } },
            select: { id: true, availableQty: true, productId: true },
          });

          if (Number(updatedOffer.availableQty) > 0) {
            await tx.supplierProductOffer.update({
              where: { id: updatedOffer.id },
              data: { inStock: true },
            });
          }

          if (updatedOffer.productId) {
            await recomputeProductStockTx(tx, String(updatedOffer.productId));
          }
        }

        if (it.productId) {
          await syncProductInStockCacheTx(tx, String(it.productId));
        }
      }

      const canceled = await tx.order.update({
        where: { id: orderId },
        data: { status: "CANCELED" },
      });

      await logOrderActivityTx(tx, orderId, ACT.STATUS_CHANGE as any, "Order canceled by customer");

      return canceled;
    });

    return res.json({ ok: true, data: updated });
  } catch (e: any) {
    const msg = e?.message || "Failed to cancel order";
    return res.status(400).json({ error: msg });
  }
});

// Map PO status into flow base (same logic as your PATCH)
const toFlowBase = (s: string) => {
  const x = String(s || "").toUpperCase().trim();
  if (x === "CANCELLED") return "CANCELED";
  if (["CREATED", "FUNDED", "PROCESSING"].includes(x)) return "PENDING";
  if (x === "OUT_FOR_DELIVERY") return "SHIPPED";
  return x;
};

// Option A rule: cancel OTP required only at CONFIRMED/PACKED (supplier only)
const cancelRequiresOtp = (curBase: string) => {
  const cur = toFlowBase(curBase);
  return cur === "CONFIRMED" || cur === "PACKED";
};

/**
 * POST /api/orders/:orderId/cancel-otp/request
 * Sends OTP to customer so supplier can cancel a CONFIRMED/PACKED order.
 */
router.post("/:orderId/cancel-otp/request", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const { orderId } = req.params;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!isSupplier(role) && !isAdmin(role)) return res.status(403).json({ error: "Forbidden" });

    // ... your supplierId + PO checks ...

    const out = await prisma.$transaction(async (tx: any) => {
      return requestOrderOtpForPurposeTx(tx as any, {
        orderId: String(orderId),
        purpose: "CANCEL_ORDER",
        actorUserId: String(userId),
        notifyTo: "ORDER_OWNER",
        brand: "DaySpring",
      });
    });

    return res.json({ ok: true, ...out });
  } catch (e: any) {
    const status = Number(e?.status) || 500;

    if (status === 429) {
      console.warn("Cancel OTP cooldown:", e?.message, { retryAt: e?.retryAt, orderId: req.params.orderId });
    } else if (status >= 400 && status < 500) {
      console.warn("Cancel OTP client error:", e?.message, { status, orderId: req.params.orderId });
    } else {
      console.error("POST /api/orders/:orderId/cancel-otp/request failed:", e);
    }

    return res.status(status).json({
      error: e?.message || "Failed to request cancel OTP",
      ...(e?.retryAt ? { retryAt: e.retryAt } : {}),
      ...(e?.requestId ? { requestId: e.requestId } : {}),
      ...(e?.expiresAt ? { expiresAt: e.expiresAt } : {}),
    });
  }
});

/**
 * POST /api/orders/:orderId/cancel-otp/verify
 * Body: { otp: "123456" } OR { code: "123456" }
 * Returns { otpToken } which the supplier will pass as x-otp-token
 */
router.post("/:orderId/cancel-otp/verify", requireAuth, async (req: any, res) => {
  const userId = req.user?.id;
  const role = req.user?.role;
  const { orderId } = req.params;

  if (!userId) return res.status(200).json({ ok: false, code: "UNAUTHORIZED", message: "Unauthorized" });
  if (!isSupplier(role) && !isAdmin(role)) {
    return res.status(200).json({ ok: false, code: "FORBIDDEN", message: "Forbidden" });
  }

  const raw = req.body?.otp ?? req.body?.code ?? "";
  const otp = String(raw).trim();

  const requestId = req.body?.requestId ? String(req.body.requestId).trim() : undefined;

  if (!/^\d{6}$/.test(otp)) {
    return res.status(200).json({ ok: false, code: "OTP_FORMAT", message: "OTP must be 6 digits" });
  }

  try {
    const out = await prisma.$transaction(async (tx: any) => {
      return verifyOrderOtpForPurposeTx(tx, {
        orderId: String(orderId),
        purpose: "CANCEL_ORDER",
        code: otp,
        actorUserId: String(userId),
        requestId,
      });
    });

    return res.json({ ok: true, otpToken: out.otpToken, requestId: out.requestId });
  } catch (e: any) {
    const isOtpFailure =
      !!e?.code && (String(e.code).startsWith("OTP_") || ["UNAUTHORIZED", "FORBIDDEN"].includes(String(e.code)));

    if (isOtpFailure) {
      return res.status(200).json({
        ok: false,
        code: e.code,
        message: e.message || "OTP verification failed",
        ...(e?.requestId ? { requestId: e.requestId } : {}),
        ...(e?.expiresAt ? { expiresAt: e.expiresAt } : {}),
        ...(e?.attempts != null ? { attempts: e.attempts } : {}),
        ...(e?.remainingAttempts != null ? { remainingAttempts: e.remainingAttempts } : {}),
        ...(e?.lockedUntil ? { lockedUntil: e.lockedUntil } : {}),
      });
    }

    const status = Number(e?.status) || 500;
    return res.status(status).json({
      ok: false,
      code: e?.code || "OTP_FAILED",
      message: e?.message || "OTP verification failed",
    });
  }
});

export default router;
