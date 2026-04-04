// api/src/routes/orders.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireSuperAdmin } from "../middleware/auth.js";
import { logOrderActivityTx } from "../services/activity.service.js";
import { syncProductInStockCacheTx } from "../services/inventory.service.js";
import { NotificationType, Prisma } from "@prisma/client";
import { recomputeProductStockTx } from "../services/stockRecalc.service.js";

import crypto from "crypto";
import { sendOrderOtpNotifications } from "../services/otpNotify.service.js";
import { z } from "zod";
import {
  requestOrderOtpForPurposeTx,
  verifyOrderOtpForPurposeTx,
} from "../services/orderOtp.service.js";

// ✅ notifications helpers
import {
  notifyUser,
  notifyAdmins,
  notifySupplierBySupplierId,
  notifyMany,
} from "../services/notifications.service.js";
import { requiredString } from "../lib/http.js";
import { hasSuccessfulPaymentForOrderTx, markPendingPaymentsCanceledTx, restoreOrderInventoryTx } from "../services/orderInventory.service.js";
import { sendSupplierPurchaseOrderEmail } from "../lib/email.js";

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
  kind?: "BASE" | "VARIANT";

  productId: string;
  variantId?: string | null;

  // explicit chosen offer id from client
  offerId?: string | null;

  qty: number;

  selectedOptions?: Array<{
    attributeId: string;
    attribute: string;
    valueId?: string;
    value: string;
  }>;

  unitPrice?: number;
  unitPriceCache?: number;
};

type CreateOrderBody = {
  items: CartItem[];
  shippingAddressId?: string;
  shippingAddress?: Address;
  billingAddressId?: string;
  billingAddress?: Address;
  notes?: string | null;

  // new
  shippingQuoteIds?: string[] | null;
  selectedUserShippingAddressId?: string;

  // legacy fallback
  shippingQuoteId?: string | null;

  shippingFee?: number;
  shippingCurrency?: string;
  shippingRateSource?: string;

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
  if (p.startsWith("+")) return p;
  return p; // safest: do not guess
}

function truthySetting(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(s);
}

type SelectedShippingQuoteMap = Record<string, SelectedShippingQuote>;

function productCheckoutReadyRelationFilter() {
  return { is: { status: "LIVE", isDeleted: false } } as const;
}

async function getSelectedShippingQuotesTx(
  tx: any,
  args: { shippingQuoteIds?: string[] | null; shippingQuoteId?: string | null; userId: string }
): Promise<SelectedShippingQuoteMap> {
  const rawIds = [
    ...(Array.isArray(args.shippingQuoteIds) ? args.shippingQuoteIds : []),
    ...(args.shippingQuoteId ? [args.shippingQuoteId] : []),
  ]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);

  const uniqueIds = Array.from(new Set(rawIds));
  if (!uniqueIds.length) return {};

  const rows = await tx.shippingQuote.findMany({
    where: {
      id: { in: uniqueIds },
      userId: args.userId,
      status: { in: ["DRAFT", "SELECTED"] as any },
    },
    select: {
      id: true,
      supplierId: true,
      rateSource: true,
      status: true,
      expiresAt: true,
      serviceLevel: true,
      zoneCode: true,
      zoneName: true,
      currency: true,
      shippingFee: true,
      remoteSurcharge: true,
      fuelSurcharge: true,
      handlingFee: true,
      insuranceFee: true,
      totalFee: true,
      etaMinDays: true,
      etaMaxDays: true,
      pickupAddressId: true,
      destinationAddressId: true,
      pricingMetaJson: true,
    },
  });

  if (rows.length !== uniqueIds.length) {
    throw new Error("One or more selected shipping quotes were not found.");
  }

  const out: SelectedShippingQuoteMap = {};

  for (const q of rows) {
    if (q.expiresAt && new Date(q.expiresAt) <= new Date()) {
      throw new Error(`Selected shipping quote ${q.id} has expired.`);
    }

    out[String(q.supplierId)] = {
      id: String(q.id),
      supplierId: String(q.supplierId),
      rateSource: String(q.rateSource) as any,
      serviceLevel: String(q.serviceLevel ?? "STANDARD"),
      zoneCode: q.zoneCode ? String(q.zoneCode) : null,
      zoneName: q.zoneName ? String(q.zoneName) : null,
      currency: String(q.currency ?? "NGN"),
      shippingFee: asNumber(q.shippingFee, 0),
      remoteSurcharge: asNumber(q.remoteSurcharge, 0),
      fuelSurcharge: asNumber(q.fuelSurcharge, 0),
      handlingFee: asNumber(q.handlingFee, 0),
      insuranceFee: asNumber(q.insuranceFee, 0),
      totalFee: asNumber(q.totalFee, 0),
      etaMinDays: q.etaMinDays == null ? null : Number(q.etaMinDays),
      etaMaxDays: q.etaMaxDays == null ? null : Number(q.etaMaxDays),
      pickupAddressId: q.pickupAddressId ? String(q.pickupAddressId) : null,
      destinationAddressId: q.destinationAddressId ? String(q.destinationAddressId) : null,
      pricingMetaJson: q.pricingMetaJson ?? null,
    };
  }

  return out;
}


type UserShippingAddressSnapshot = {
  id: string;
  label: string | null;
  recipientName: string | null;
  phone: string;
  whatsappPhone: string | null;
  houseNumber: string | null;
  streetName: string | null;
  postCode: string | null;
  town: string | null;
  city: string;
  state: string;
  country: string;
  lga: string | null;
  landmark: string | null;
  directionsNote: string | null;

  // NEW
  phoneVerifiedAt: Date | null;
  phoneVerifiedBy: string | null;
  verificationMeta: any;
};

function normalizePhoneLoose(phone?: string | null) {
  return String(phone ?? "").replace(/[^\d+]/g, "").replace(/^\+/, "").trim();
}

function isSavedShippingAddressVerifiedForCheckout(args: {
  saved: UserShippingAddressSnapshot | null | undefined;
  userPhone?: string | null;
  userPhoneVerifiedAt?: Date | string | null;
}) {
  const saved = args.saved;
  if (!saved) return false;

  if (saved.phoneVerifiedAt) return true;

  const savedPhone = normalizePhoneLoose(saved.phone);
  const userPhone = normalizePhoneLoose(args.userPhone);

  if (
    savedPhone &&
    userPhone &&
    savedPhone === userPhone &&
    args.userPhoneVerifiedAt
  ) {
    return true;
  }

  return false;
}


const COMPLAINT_WINDOW_DAYS = Number(process.env.COMPLAINT_WINDOW_DAYS ?? 5);

async function getComplaintWindowDaysTx(tx: any): Promise<number> {
  const raw =
    (await readSettingValueTx(tx, "complaintWindowDays")) ??
    (await readSettingValueTx(tx, "refundRequestWindowDays")) ??
    (await readSettingValueTx(tx, "COMPLAINT_WINDOW_DAYS")) ??
    process.env.COMPLAINT_WINDOW_DAYS ??
    5;

  const n = Number(raw);
  if (!Number.isFinite(n)) return 5;
  return Math.max(0, Math.floor(n));
}

function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function isWithinComplaintWindow(
  baseDate: Date | string | null | undefined,
  windowDays: number
) {
  if (!baseDate) return false;

  const dt = baseDate instanceof Date ? baseDate : new Date(baseDate);
  if (Number.isNaN(+dt)) return false;

  if (!Number.isFinite(windowDays) || windowDays <= 0) return false;

  const cutoff = addDays(dt, windowDays);
  return now() <= cutoff;
}

async function getUserShippingAddressForCheckoutTx(
  tx: any,
  args: { userId: string; selectedUserShippingAddressId: string }
): Promise<UserShippingAddressSnapshot> {
  const row = await tx.userShippingAddress.findFirst({
    where: {
      id: String(args.selectedUserShippingAddressId),
      userId: String(args.userId),
      isActive: true,
    },
    select: {
      id: true,
      label: true,
      recipientName: true,
      phone: true,
      whatsappPhone: true,
      houseNumber: true,
      streetName: true,
      postCode: true,
      town: true,
      city: true,
      state: true,
      country: true,
      lga: true,
      landmark: true,
      directionsNote: true,

      // NEW
      phoneVerifiedAt: true,
      phoneVerifiedBy: true,
      verificationMeta: true,
    },
  });

  if (!row) {
    throw new Error("Selected delivery address was not found for this user.");
  }

  return row;
}

async function createOrderAddressSnapshotFromUserShippingAddressTx(
  tx: any,
  saved: UserShippingAddressSnapshot
) {
  return tx.address.create({
    data: {
      houseNumber: saved.houseNumber ?? null,
      streetName: saved.streetName ?? null,
      postCode: saved.postCode ?? null,
      town: saved.town ?? null,
      city: saved.city ?? null,
      state: saved.state ?? null,
      country: saved.country ?? null,
      lga: saved.lga ?? null,
      landmark: saved.landmark ?? null,
      directionsNote: saved.directionsNote ?? null,
      isValidated: false,
    },
    select: { id: true },
  });
}

function buildOrderShippingBreakdownFromQuotes(quotesBySupplier: SelectedShippingQuoteMap) {
  const quotes = Object.values(quotesBySupplier);

  const currency = quotes[0]?.currency ?? "NGN";

  const totals = quotes.reduce(
    (acc, q) => {
      acc.shippingFee += round2(q.shippingFee);
      acc.remoteSurcharge += round2(q.remoteSurcharge);
      acc.fuelSurcharge += round2(q.fuelSurcharge);
      acc.handlingFee += round2(q.handlingFee);
      acc.insuranceFee += round2(q.insuranceFee);
      acc.totalFee += round2(q.totalFee);
      return acc;
    },
    {
      shippingFee: 0,
      remoteSurcharge: 0,
      fuelSurcharge: 0,
      handlingFee: 0,
      insuranceFee: 0,
      totalFee: 0,
    }
  );

  return {
    currency,
    quoteIds: quotes.map((q) => q.id),
    suppliers: quotes.map((q) => ({
      supplierId: q.supplierId,
      quoteId: q.id,
      serviceLevel: q.serviceLevel,
      zoneCode: q.zoneCode,
      zoneName: q.zoneName,
      rateSource: q.rateSource,
      components: {
        shippingFee: round2(q.shippingFee),
        remoteSurcharge: round2(q.remoteSurcharge),
        fuelSurcharge: round2(q.fuelSurcharge),
        handlingFee: round2(q.handlingFee),
        insuranceFee: round2(q.insuranceFee),
      },
      totalFee: round2(q.totalFee),
      etaMinDays: q.etaMinDays,
      etaMaxDays: q.etaMaxDays,
      pickupAddressId: q.pickupAddressId,
      destinationAddressId: q.destinationAddressId,
      pricingMeta: q.pricingMetaJson ?? null,
    })),
    totals,
  };
}

type CheckoutSettingsSnapshot = {
  taxMode: "INCLUDED" | "ADDED" | "NONE";
  taxRatePct: number;
  baseServiceFeeNGN: number;
  commsUnitCostNGN: number;

  gatewayFeePercent: number;
  gatewayFixedFeeNGN: number;
  gatewayFeeCapNGN: number;

  supplierMinBayesRating: number;
  supplierPriceBandPct: number;
  supplierBayesM: number;
  supplierGlobalRatingC: number;

  marginPercent: number;
  minMarginNGN: number;
  maxMarginPct: number;
};

async function loadCheckoutSettingsTx(tx: any): Promise<CheckoutSettingsSnapshot> {
  const rows = await tx.setting.findMany({
    where: {
      key: {
        in: [
          "taxMode",
          "taxRatePct",
          "baseServiceFeeNGN",
          "platformBaseFeeNGN",
          "commsServiceFeeNGN",
          "commsUnitCostNGN",
          "commsServiceFeeUnitNGN",
          "commsUnitFeeNGN",
          "gatewayFeePercent",
          "gatewayFixedFeeNGN",
          "gatewayFeeCapNGN",
          "supplierMinBayesRating",
          "supplierPriceBandPct",
          "supplierBayesM",
          "supplierGlobalRatingC",
          "platformMarginPercent",
          "marginPercent",
          "pricingMarkupPercent",
          "platformMinMarginNGN",
          "minMarginNGN",
          "maxMarginPct",
        ],
      },
    },
    select: { key: true, value: true },
  });

  const map = new Map<string, string>();
  for (const r of rows) map.set(String(r.key), String(r.value ?? ""));

  const num = (v: any, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };

  const taxMode = toTaxMode(map.get("taxMode"));

  const baseServiceFeeNGN = Math.max(
    0,
    num(
      map.get("baseServiceFeeNGN") ??
      map.get("platformBaseFeeNGN") ??
      map.get("commsServiceFeeNGN"),
      0
    )
  );

  const commsUnitCostNGN = Math.max(
    0,
    num(
      map.get("commsUnitCostNGN") ??
      map.get("commsServiceFeeUnitNGN") ??
      map.get("commsUnitFeeNGN"),
      0
    )
  );

  const marginPercent = Math.max(
    0,
    num(
      map.get("platformMarginPercent") ??
      map.get("marginPercent") ??
      map.get("pricingMarkupPercent"),
      10
    )
  );

  const minMarginNGN = Math.max(
    0,
    num(
      map.get("platformMinMarginNGN") ??
      map.get("minMarginNGN"),
      0
    )
  );

  const maxMarginPct = Math.max(0, num(map.get("maxMarginPct"), 100));

  return {
    taxMode,
    taxRatePct: Math.max(0, num(map.get("taxRatePct"), 0)),
    baseServiceFeeNGN,
    commsUnitCostNGN,

    gatewayFeePercent: Math.max(0, num(map.get("gatewayFeePercent"), 0)),
    gatewayFixedFeeNGN: Math.max(0, num(map.get("gatewayFixedFeeNGN"), 0)),
    gatewayFeeCapNGN: Math.max(0, num(map.get("gatewayFeeCapNGN"), 0)),

    supplierMinBayesRating: Math.max(0, num(map.get("supplierMinBayesRating"), 3.8)),
    supplierPriceBandPct: Math.max(0, num(map.get("supplierPriceBandPct"), 2)),
    supplierBayesM: Math.max(1, num(map.get("supplierBayesM"), 20)),
    supplierGlobalRatingC: Math.max(0, num(map.get("supplierGlobalRatingC"), 4.2)),

    marginPercent,
    minMarginNGN,
    maxMarginPct,
  };
}
function getClientCheckoutUnitPrice(line: any): number | null {
  const direct = Number(line?.unitPrice);
  if (Number.isFinite(direct) && direct > 0) return round2(direct);

  const cached = Number(line?.unitPriceCache);
  if (Number.isFinite(cached) && cached > 0) return round2(cached);

  return null;
}

function getFallbackCustomerUnitFromSupplierCost(
  supplierUnitCost: number,
  settings: CheckoutSettingsSnapshot,
  ctx: { productId: string; variantId: string | null }
): number {
  const cfg = getMarginConfig(settings);
  const marginPercent = resolveMarginPercentForItem(settings);

  const percentMarginValue = round2(supplierUnitCost * (marginPercent / 100));
  const actualMargin = Math.max(cfg.minMarginNGN, percentMarginValue);

  const customerUnit = round2(supplierUnitCost + actualMargin);

  if (!(customerUnit > 0)) {
    throw new Error(
      `Could not compute customer unit price for product ${ctx.productId}${ctx.variantId ? ` variant ${ctx.variantId}` : ""
      }.`
    );
  }

  return customerUnit;
}

function assertClientCheckoutUnitReasonable(
  clientUnit: number,
  supplierUnitCost: number,
  settings: CheckoutSettingsSnapshot,
  ctx: { productId: string; variantId: string | null }
) {
  if (!(clientUnit > 0)) {
    throw new Error(
      `Invalid checkout unit price for product ${ctx.productId}${ctx.variantId ? ` variant ${ctx.variantId}` : ""
      }.`
    );
  }

  if (clientUnit + 1 < supplierUnitCost) {
    throw new Error(
      `Checkout unit price is below supplier cost for product ${ctx.productId}${ctx.variantId ? ` variant ${ctx.variantId}` : ""
      }.`
    );
  }

  const maxMarginPct = Math.max(0, Number(settings.maxMarginPct ?? 100));
  const maxReasonable =
    supplierUnitCost > 0
      ? round2(supplierUnitCost * (1 + maxMarginPct / 100) + Math.max(0, settings.minMarginNGN))
      : clientUnit;

  if (supplierUnitCost > 0 && clientUnit - maxReasonable > 5) {
    throw new Error(
      `Checkout unit price is outside allowed margin bounds for product ${ctx.productId}${ctx.variantId ? ` variant ${ctx.variantId}` : ""
      }.`
    );
  }
}


async function readSettingValueTx(tx: any, key: string): Promise<string | null> {
  const s = await tx.setting.findUnique({
    where: { key },
    select: { value: true },
  });
  return s?.value ?? null;
}

type SelectedShippingQuote = {
  id: string;
  supplierId: string;
  rateSource: "FALLBACK_ZONE" | "LIVE_CARRIER" | "MANUAL";
  serviceLevel: string;
  zoneCode: string | null;
  zoneName: string | null;
  currency: string;
  shippingFee: number;
  remoteSurcharge: number;
  fuelSurcharge: number;
  handlingFee: number;
  insuranceFee: number;
  totalFee: number;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  pickupAddressId: string | null;
  destinationAddressId: string | null;
  pricingMetaJson: any;
};


async function attachShippingQuoteToOrderTx(
  tx: any,
  args: { quoteId: string; orderId: string }
) {
  await tx.shippingQuote.update({
    where: { id: args.quoteId },
    data: {
      orderId: args.orderId,
      status: "CONVERTED_TO_ORDER",
    } as any,
  });
}

function buildOrderShippingBreakdownJson(q: SelectedShippingQuote) {
  return {
    quoteId: q.id,
    serviceLevel: q.serviceLevel,
    zoneCode: q.zoneCode,
    zoneName: q.zoneName,
    currency: q.currency,
    rateSource: q.rateSource,
    components: {
      shippingFee: round2(q.shippingFee),
      remoteSurcharge: round2(q.remoteSurcharge),
      fuelSurcharge: round2(q.fuelSurcharge),
      handlingFee: round2(q.handlingFee),
      insuranceFee: round2(q.insuranceFee),
    },
    totalFee: round2(q.totalFee),
    etaMinDays: q.etaMinDays,
    etaMaxDays: q.etaMaxDays,
    pricingMeta: q.pricingMetaJson ?? null,
  };
}

async function shouldDebugSupplierSelectionTx(tx: any) {
  const forced = await readSettingValueTx(tx, "debugSupplierSelection");
  if (truthySetting(forced)) return true;
  return String(process.env.NODE_ENV ?? "").toLowerCase() !== "production";
}

function safeNum(n: any, d = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : d;
}

function fmt2(n: any) {
  return Math.round(safeNum(n, 0) * 100) / 100;
}

/* ---------------- Supplier gating ---------------- */

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
function supplierCheckoutReadyRelationFilter() {
  return { is: checkoutReadySupplierWhere() } as const;
}

// ✅ allocation safety: only ACTIVE supplier required
async function assertSupplierPurchasableTx(tx: any, supplierId: string) {
  const sid = String(supplierId ?? "").trim();
  if (!sid) throw new Error("Bad allocation: missing supplierId.");

  const ok = await tx.supplier.findFirst({
    where: { id: sid, ...checkoutReadySupplierWhere() },
    select: { id: true },
  });

  if (!ok) throw new Error(`Supplier ${sid} is not available for checkout.`);
}

function estimateGatewayFee(
  amountNaira: number,
  settings?: {
    gatewayFeePercent?: number;
    gatewayFixedFeeNGN?: number;
    gatewayFeeCapNGN?: number;
  }
) {
  if (!Number.isFinite(amountNaira) || amountNaira <= 0) return 0;

  const gatewayFeePercent = Number(settings?.gatewayFeePercent ?? 0);
  const gatewayFixedFeeNGN = Number(settings?.gatewayFixedFeeNGN ?? 0);
  const gatewayFeeCapNGN = Number(settings?.gatewayFeeCapNGN ?? 0);

  const percentFee = amountNaira * (gatewayFeePercent / 100);
  const gross = percentFee + gatewayFixedFeeNGN;

  if (gatewayFeeCapNGN > 0) {
    return Math.min(gross, gatewayFeeCapNGN);
  }

  return gross;
}


function toNumber(v: any, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toTaxMode(v: any): "INCLUDED" | "ADDED" | "NONE" {
  const s = String(v ?? "").toUpperCase();
  return s === "ADDED" || s === "NONE" ? (s as any) : "INCLUDED";
}

/** ✅ Helper: is shipping enabled globally? */
async function isShippingEnabledTx(tx: any): Promise<boolean> {
  const raw =
    (await readSettingValueTx(tx, "shippingEnabled")) ??
    (await readSettingValueTx(tx, "enableShipping")) ??
    (await readSettingValueTx(tx, "shipping.enabled"));
  return truthySetting(raw);
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

/* ---------- ShippingRateSource normalization (enum-safe) ---------- */

const SHIPPING_RATE_SOURCES = new Set(["MANUAL", "FALLBACK_ZONE", "LIVE_CARRIER"]);

function normalizeShippingRateSource(v: any): string | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return null;
  if (SHIPPING_RATE_SOURCES.has(s)) return s;
  return "MANUAL";
}

/* ---------------- Supplier selection: Gate + 2% band ---------------- */

function bayesRating(R: any, v: any, C: number, m: number) {
  const rr = Number(R);
  const vv = Number(v);

  const safeR = Number.isFinite(rr) ? rr : 0;
  const safeV = Number.isFinite(vv) ? Math.max(0, vv) : 0;

  const safeC = Number.isFinite(Number(C)) ? Number(C) : 4.2;
  const safeM = Number.isFinite(Number(m)) ? Math.max(1, Number(m)) : 20;

  return (safeV / (safeV + safeM)) * safeR + (safeM / (safeV + safeM)) * safeC;
}

function getSupplierSelectionPolicy(settings: CheckoutSettingsSnapshot) {
  return {
    minBayesRating: settings.supplierMinBayesRating,
    bandPercent: settings.supplierPriceBandPct,
    bayesM: settings.supplierBayesM,
    globalRatingC: settings.supplierGlobalRatingC,
  };
}

type CandidateOffer = {
  id: string;
  supplierId: string;
  availableQty: number;

  unitPrice: number;

  model: "BASE_OFFER" | "VARIANT_OFFER" | "LEGACY_OFFER";

  supplierProductOfferId: string | null;
  supplierVariantOfferId: string | null;

  leadDays?: number | null;
  supplierRatingAvg?: number | null;
  supplierRatingCount?: number | null;
};

function orderCandidatesGateBand(
  candidates: CandidateOffer[],
  settings: CheckoutSettingsSnapshot
) {
  if (!candidates.length) return candidates;

  const policy = getSupplierSelectionPolicy(settings);

  let cheapest = Infinity;
  for (const c of candidates) cheapest = Math.min(cheapest, Number(c.unitPrice) || Infinity);

  const bandMax = cheapest * (1 + policy.bandPercent / 100);

  const scored = candidates.map((c) => {
    const bayes = bayesRating(
      c.supplierRatingAvg,
      c.supplierRatingCount,
      policy.globalRatingC,
      policy.bayesM
    );

    const lead = Number.isFinite(Number(c.leadDays)) ? Number(c.leadDays) : Infinity;
    const inBand = Number(c.unitPrice) <= bandMax;

    return { c, bayes, lead, inBand };
  });

  const gated = scored.filter((x) => x.bayes >= policy.minBayesRating);
  const pool = gated.length ? gated : scored;

  pool.sort((a, b) => {
    if (a.inBand !== b.inBand) return a.inBand ? -1 : 1;
    if (b.bayes !== a.bayes) return b.bayes - a.bayes;
    if (a.lead !== b.lead) return a.lead - b.lead;
    return Number(a.c.unitPrice) - Number(b.c.unitPrice);
  });

  return pool.map((x) => x.c);
}

async function debugSupplierSelectionTx(
  tx: any,
  args: {
    productId: string;
    variantId: string | null;
    qtyNeeded: number;
    policy: { minBayesRating: number; bandPercent: number; bayesM: number; globalRatingC: number };
    before: CandidateOffer[];
    after: CandidateOffer[];
  }
) {
  const enabled = await shouldDebugSupplierSelectionTx(tx);
  if (!enabled) return;

  const { productId, variantId, qtyNeeded, policy, before, after } = args;

  if (!before.length) {
    console.debug("[supplier-select] no candidates", { productId, variantId, qtyNeeded });
    return;
  }

  const cheapest = Math.min(...before.map((c) => safeNum(c.unitPrice, Infinity)));
  const bandMax = cheapest * (1 + policy.bandPercent / 100);

  const score = (c: CandidateOffer) => {
    const bayes =
      (Number(c.supplierRatingCount ?? 0) / (Number(c.supplierRatingCount ?? 0) + policy.bayesM)) *
      safeNum(c.supplierRatingAvg, 0) +
      (policy.bayesM / (Number(c.supplierRatingCount ?? 0) + policy.bayesM)) * policy.globalRatingC;

    const inBand = safeNum(c.unitPrice, Infinity) <= bandMax;
    const passesGate = bayes >= policy.minBayesRating;

    return { bayes: fmt2(bayes), inBand, passesGate };
  };

  const beforeScored = before
    .map((c) => {
      const s = score(c);
      return {
        supplierId: c.supplierId,
        offerId: c.id,
        model: c.model,
        basePrice: fmt2(c.unitPrice),
        qty: safeNum(c.availableQty, 0),
        leadDays: c.leadDays ?? null,
        ratingAvg: c.supplierRatingAvg ?? null,
        ratingCount: c.supplierRatingCount ?? null,
        bayes: s.bayes,
        inBand: s.inBand,
        passesGate: s.passesGate,
      };
    })
    .sort((a, b) => a.basePrice - b.basePrice);

  const gatedCount = beforeScored.filter((x) => x.passesGate).length;
  const fallbackUsed = gatedCount === 0;

  const topAfter = (after || []).slice(0, 5).map((c) => {
    const s = score(c);
    return {
      supplierId: c.supplierId,
      offerId: c.id,
      model: c.model,
      basePrice: fmt2(c.unitPrice),
      qty: safeNum(c.availableQty, 0),
      leadDays: c.leadDays ?? null,
      bayes: s.bayes,
      inBand: s.inBand,
      passesGate: s.passesGate,
    };
  });

  console.debug("[supplier-select]", {
    productId,
    variantId,
    qtyNeeded,
    policy: {
      bandPercent: policy.bandPercent,
      minBayesRating: policy.minBayesRating,
      bayesM: policy.bayesM,
      globalRatingC: policy.globalRatingC,
    },
    cheapest: fmt2(cheapest),
    bandMax: fmt2(bandMax),
    candidatesCheapestFirst: beforeScored.slice(0, 12),
    fallbackUsed,
    orderedTop5: topAfter,
  });
}

function retailOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

async function getCheckoutRetailUnitPriceTx(
  tx: any,
  args: {
    productId: string;
    variantId: string | null;
  }
): Promise<number> {
  const { productId, variantId } = args;

  let variantRetail: number | null = null;

  if (variantId) {
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        productId: true,
        retailPrice: true,
        isActive: true,
        archivedAt: true,
      },
    });

    if (!variant || String(variant.productId) !== String(productId)) {
      throw new Error(`Variant ${variantId} does not belong to product ${productId}.`);
    }

    if (variant.isActive !== true || variant.archivedAt != null) {
      throw new Error(`Variant ${variantId} is not active.`);
    }

    variantRetail = retailOrNull(variant.retailPrice);
  }

  const product = await tx.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      retailPrice: true,
      autoPrice: true,
      status: true,
      isDeleted: true,
    },
  });

  if (!product || product.isDeleted) {
    throw new Error("Product not found.");
  }

  const productRetail =
    retailOrNull(product.retailPrice) ??
    retailOrNull(product.autoPrice);

  const retail = variantRetail ?? productRetail;

  if (retail == null || retail <= 0) {
    throw new Error(`Missing retail price for product ${productId}.`);
  }

  return round2(retail);
}

function sortOffersCheapestFirst(list: CandidateOffer[]) {
  list.sort((a, b) =>
    a.unitPrice !== b.unitPrice ? a.unitPrice - b.unitPrice : b.availableQty - a.availableQty
  );
  return list;
}

/* ---------------- Offers helpers (base offer + variant offer + legacy) ---------------- */

async function fetchActiveBaseOffersTx(
  tx: any,
  where: { productId: string }
): Promise<CandidateOffer[]> {
  const rows =
    ((await tx.supplierProductOffer.findMany({
      where: {
        productId: where.productId,
        isActive: true,
        inStock: true,
        availableQty: { gt: 0 },
        basePrice: { gt: 0 },
        product: productCheckoutReadyRelationFilter(),
        supplier: supplierCheckoutReadyRelationFilter(),
      },
      select: {
        id: true,
        supplierId: true,
        availableQty: true,
        basePrice: true,
        leadDays: true,
        supplier: {
          select: {
            status: true,
            ratingAvg: true,
            ratingCount: true,
          },
        },
      },
    })) as any[]) ?? [];

  const current: CandidateOffer[] = rows
    .map((row: any) => {
      const supplierId = String(row.supplierId ?? "").trim();
      const price = asNumber(row.basePrice, 0);
      const qty = Math.max(0, asNumber(row.availableQty, 0));
      const supplierStatus = String(row.supplier?.status ?? "").toUpperCase();

      if (!supplierId || !(price > 0) || !(qty > 0)) return null;
      if (supplierStatus !== "ACTIVE") return null;

      return {
        id: String(row.id),
        supplierId,
        availableQty: qty,
        unitPrice: price,
        model: "BASE_OFFER" as const,
        supplierProductOfferId: String(row.id),
        supplierVariantOfferId: null,
        leadDays: row.leadDays == null ? null : Number(row.leadDays),
        supplierRatingAvg:
          row.supplier?.ratingAvg != null ? Number(row.supplier.ratingAvg) : null,
        supplierRatingCount:
          row.supplier?.ratingCount != null ? Number(row.supplier.ratingCount) : null,
      } as CandidateOffer;
    })
    .filter(Boolean) as CandidateOffer[];

  if (current.length) {
    return sortOffersCheapestFirst(current);
  }

  const legacyList =
    (await (tx.supplierOffer?.findMany?.({
      where: {
        productId: where.productId,
        variantId: null,
        isActive: true,
        inStock: true,
        availableQty: { gt: 0 },
        unitPrice: { gt: 0 },
      },
      select: {
        id: true,
        supplierId: true,
        availableQty: true,
        unitPrice: true,
        inStock: true,
      },
    }) ?? [])) ?? [];

  const legacy: CandidateOffer[] = (legacyList || [])
    .map((o: any) => {
      const sid = String(o.supplierId ?? "").trim();
      const qty = Math.max(0, asNumber(o.availableQty, 0));
      const unit = asNumber(o.unitPrice, 0);

      if (!sid || !(qty > 0) || !(unit > 0)) return null;

      return {
        id: String(o.id),
        supplierId: sid,
        availableQty: qty,
        unitPrice: unit,
        model: "LEGACY_OFFER" as const,
        supplierProductOfferId: null,
        supplierVariantOfferId: null,
      } as CandidateOffer;
    })
    .filter(Boolean) as CandidateOffer[];

  return sortOffersCheapestFirst(legacy);
}

export async function fetchOneOfferByIdTx(
  tx: any,
  offerId: string
): Promise<(CandidateOffer & { productId: string; variantId: string | null }) | null> {
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
        unitPrice: true,
        leadDays: true,
        supplierProductOfferId: true,
        supplier: {
          select: {
            status: true,
            ratingAvg: true,
            ratingCount: true,
          },
        },
        variant: {
          select: {
            productId: true,
          },
        },
        product: {
          select: {
            status: true,
            isDeleted: true,
          },
        },
      } as any,
    });

    if (vo) {
      const sid = String(vo.supplierId ?? "").trim();
      const qty = Math.max(0, asNumber(vo.availableQty, 0));
      const supplierUnit = asNumber(vo.unitPrice, 0);
      const supplierStatus = String(vo.supplier?.status ?? "").toUpperCase();
      const productStatus = String(vo.product?.status ?? "").toUpperCase();
      const productDeleted = !!vo.product?.isDeleted;

      if (!sid) return null;
      if (vo.isActive !== true) return null;
      if (!(qty > 0)) return null;
      if (!(supplierUnit > 0)) return null;
      if (supplierStatus !== "ACTIVE") return null;
      if (productDeleted || productStatus !== "LIVE") return null;

      const pid = String(vo.variant?.productId ?? vo.productId ?? "").trim();
      if (!pid) return null;

      return {
        id: String(vo.id),
        supplierId: sid,
        availableQty: qty,
        unitPrice: supplierUnit,
        model: "VARIANT_OFFER",
        supplierProductOfferId: vo.supplierProductOfferId
          ? String(vo.supplierProductOfferId)
          : null,
        supplierVariantOfferId: String(vo.id),
        leadDays: vo.leadDays == null ? null : Number(vo.leadDays),
        supplierRatingAvg:
          vo.supplier?.ratingAvg != null ? Number(vo.supplier.ratingAvg) : null,
        supplierRatingCount:
          vo.supplier?.ratingCount != null ? Number(vo.supplier.ratingCount) : null,
        productId: pid,
        variantId: vo.variantId == null ? null : String(vo.variantId),
      };
    }
  } catch {
    //
  }

  try {
    const bo = await tx.supplierProductOffer.findUnique({
      where: { id: offerId },
      select: {
        id: true,
        supplierId: true,
        productId: true,
        basePrice: true,
        availableQty: true,
        isActive: true,
        inStock: true,
        leadDays: true,
        supplier: {
          select: {
            status: true,
            ratingAvg: true,
            ratingCount: true,
          },
        },
        product: {
          select: {
            status: true,
            isDeleted: true,
          },
        },
      },
    });

    if (bo) {
      const sid = String(bo.supplierId ?? "").trim();
      const qty = Math.max(0, asNumber(bo.availableQty, 0));
      const supplierUnit = asNumber(bo.basePrice, 0);
      const supplierStatus = String(bo.supplier?.status ?? "").toUpperCase();
      const productStatus = String(bo.product?.status ?? "").toUpperCase();
      const productDeleted = !!bo.product?.isDeleted;

      if (!sid) return null;
      if (bo.isActive !== true) return null;
      if (!(qty > 0)) return null;
      if (!(supplierUnit > 0)) return null;
      if (supplierStatus !== "ACTIVE") return null;
      if (productDeleted || productStatus !== "LIVE") return null;

      return {
        id: String(bo.id),
        supplierId: sid,
        availableQty: qty,
        unitPrice: supplierUnit,
        model: "BASE_OFFER",
        supplierProductOfferId: String(bo.id),
        supplierVariantOfferId: null,
        leadDays: bo.leadDays == null ? null : Number(bo.leadDays),
        supplierRatingAvg:
          bo.supplier?.ratingAvg != null ? Number(bo.supplier.ratingAvg) : null,
        supplierRatingCount:
          bo.supplier?.ratingCount != null ? Number(bo.supplier.ratingCount) : null,
        productId: String(bo.productId),
        variantId: null,
      };
    }
  } catch {
    //
  }

  const so =
    (await (tx.supplierOffer?.findFirst?.({
      where: { id: offerId, isActive: true },
      select: {
        id: true,
        productId: true,
        variantId: true,
        supplierId: true,
        availableQty: true,
        unitPrice: true,
        inStock: true,
      },
    }) ?? null)) ?? null;

  if (!so) return null;

  const sid = String(so.supplierId ?? "").trim();
  const qty = Math.max(0, asNumber(so.availableQty, 0));
  const unit = asNumber(so.unitPrice, 0);

  if (!sid) return null;
  if (!(qty > 0)) return null;
  if (!(unit > 0)) return null;

  return {
    id: String(so.id),
    supplierId: sid,
    availableQty: qty,
    unitPrice: unit,
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
  const vos =
    ((await tx.supplierVariantOffer.findMany({
      where: {
        productId: where.productId,
        variantId: where.variantId,
        isActive: true,
        availableQty: { gt: 0 },
        unitPrice: { gt: 0 },
        product: {
          status: "LIVE",
          isDeleted: false,
        },
        supplier: {
          ...checkoutReadySupplierWhere(),
        },
      } as any,
      select: {
        id: true,
        supplierId: true,
        availableQty: true,
        unitPrice: true,
        supplierProductOfferId: true,
        leadDays: true,
        supplier: {
          select: {
            status: true,
            ratingAvg: true,
            ratingCount: true,
          },
        },
      } as any,
    })) as any[]) ?? [];

  const current: CandidateOffer[] = vos
    .map((vo: any) => {
      const supplierId = String(vo.supplierId ?? "").trim();
      const unit = asNumber(vo.unitPrice, 0);
      const qty = Math.max(0, asNumber(vo.availableQty, 0));
      const supplierStatus = String(vo.supplier?.status ?? "").toUpperCase();

      if (!supplierId || !(unit > 0) || !(qty > 0)) return null;
      if (supplierStatus !== "ACTIVE") return null;

      return {
        id: String(vo.id),
        supplierId,
        availableQty: qty,
        unitPrice: unit,
        model: "VARIANT_OFFER" as const,
        supplierProductOfferId: vo.supplierProductOfferId
          ? String(vo.supplierProductOfferId)
          : null,
        supplierVariantOfferId: String(vo.id),
        leadDays: vo.leadDays != null ? Number(vo.leadDays) : null,
        supplierRatingAvg:
          vo.supplier?.ratingAvg != null ? Number(vo.supplier.ratingAvg) : null,
        supplierRatingCount:
          vo.supplier?.ratingCount != null ? Number(vo.supplier.ratingCount) : null,
      } as CandidateOffer;
    })
    .filter(Boolean) as CandidateOffer[];

  if (current.length) {
    return sortOffersCheapestFirst(current);
  }

  const legacy =
    (await (tx.supplierOffer?.findMany?.({
      where: {
        productId: where.productId,
        variantId: where.variantId,
        isActive: true,
        availableQty: { gt: 0 },
        unitPrice: { gt: 0 },
      },
      select: {
        id: true,
        supplierId: true,
        availableQty: true,
        unitPrice: true,
        inStock: true,
      },
    }) ?? [])) ?? [];

  const legacyOut: CandidateOffer[] = (legacy || [])
    .map((o: any) => {
      const sid = String(o.supplierId ?? "").trim();
      const qty = Math.max(0, asNumber(o.availableQty, 0));
      const unit = asNumber(o.unitPrice, 0);

      if (!sid || !(qty > 0) || !(unit > 0)) return null;

      return {
        id: String(o.id),
        supplierId: sid,
        availableQty: qty,
        unitPrice: unit,
        model: "LEGACY_OFFER" as const,
        supplierProductOfferId: null,
        supplierVariantOfferId: null,
      } as CandidateOffer;
    })
    .filter(Boolean) as CandidateOffer[];

  return sortOffersCheapestFirst(legacyOut);
}

async function explainUnavailableLineTx(
  tx: any,
  args: {
    productId: string;
    variantId: string | null;
    explicitOfferId?: string | null;
    productTitle: string;
    optionsLabel?: string;
  }
): Promise<string> {
  const suffix = `${args.productTitle}${args.optionsLabel ?? ""}`;

  const explainBaseRow = (row: any) => {
    if (!row) return null;

    if (String(row.productId ?? "") !== String(args.productId)) {
      return `Selected offer for ${suffix} belongs to a different product.`;
    }
    if (row.product?.isDeleted) {
      return `${suffix} is deleted and cannot be purchased.`;
    }
    if (String(row.product?.status ?? "").toUpperCase() !== "LIVE") {
      return `${suffix} is not LIVE for checkout.`;
    }
    if (row.isActive !== true) {
      return `The selected base offer for ${suffix} is inactive.`;
    }
    if (row.inStock !== true) {
      return `The selected base offer for ${suffix} is marked out of stock.`;
    }
    if (!(Number(row.availableQty ?? 0) > 0)) {
      return `The selected base offer for ${suffix} has no available quantity.`;
    }
    if (!(Number(row.basePrice ?? 0) > 0)) {
      return `The selected base offer for ${suffix} has no valid price.`;
    }
    if (String(row.supplier?.status ?? "").toUpperCase() !== "ACTIVE") {
      return `Supplier "${row.supplier?.name ?? "Unknown supplier"}" is not ACTIVE for checkout.`;
    }
    return `The selected base offer for ${suffix} is not checkout-eligible.`;
  };

  const explainVariantRow = (row: any) => {
    if (!row) return null;

    const rowProductId = String(
      row.variant?.productId ?? row.productId ?? ""
    );

    if (rowProductId !== String(args.productId)) {
      return `Selected offer for ${suffix} belongs to a different product.`;
    }
    if (args.variantId && String(row.variantId ?? "") !== String(args.variantId)) {
      return `Selected offer for ${suffix} belongs to a different variant.`;
    }
    if (row.product?.isDeleted) {
      return `${suffix} is deleted and cannot be purchased.`;
    }
    if (String(row.product?.status ?? "").toUpperCase() !== "LIVE") {
      return `${suffix} is not LIVE for checkout.`;
    }
    if (row.isActive !== true) {
      return `The selected variant offer for ${suffix} is inactive.`;
    }
    if (row.inStock !== true) {
      return `The selected variant offer for ${suffix} is marked out of stock.`;
    }
    if (!(Number(row.availableQty ?? 0) > 0)) {
      return `The selected variant offer for ${suffix} has no available quantity.`;
    }
    if (!(Number(row.unitPrice ?? 0) > 0)) {
      return `The selected variant offer for ${suffix} has no valid price.`;
    }
    if (String(row.supplier?.status ?? "").toUpperCase() !== "ACTIVE") {
      return `Supplier "${row.supplier?.name ?? "Unknown supplier"}" is not ACTIVE for checkout.`;
    }
    return `The selected variant offer for ${suffix} is not checkout-eligible.`;
  };

  if (args.explicitOfferId) {
    const [explicitVariant, explicitBase, explicitLegacy] = await Promise.all([
      tx.supplierVariantOffer.findUnique({
        where: { id: String(args.explicitOfferId) },
        select: {
          id: true,
          productId: true,
          variantId: true,
          isActive: true,
          inStock: true,
          availableQty: true,
          unitPrice: true,
          supplier: { select: { id: true, name: true, status: true } },
          variant: { select: { productId: true } },
          product: { select: { status: true, isDeleted: true } },
        } as any,
      }).catch(() => null),

      tx.supplierProductOffer.findUnique({
        where: { id: String(args.explicitOfferId) },
        select: {
          id: true,
          productId: true,
          isActive: true,
          inStock: true,
          availableQty: true,
          basePrice: true,
          supplier: { select: { id: true, name: true, status: true } },
          product: { select: { status: true, isDeleted: true } },
        } as any,
      }).catch(() => null),

      (tx.supplierOffer?.findFirst?.({
        where: { id: String(args.explicitOfferId) },
        select: {
          id: true,
          productId: true,
          variantId: true,
          isActive: true,
          inStock: true,
          availableQty: true,
          unitPrice: true,
          supplierId: true,
        } as any,
      }) ?? Promise.resolve(null)).catch(() => null),
    ]);

    if (explicitVariant) {
      return explainVariantRow(explicitVariant) ?? `Selected offer for ${suffix} is not available.`;
    }

    if (explicitBase) {
      return explainBaseRow(explicitBase) ?? `Selected offer for ${suffix} is not available.`;
    }

    if (explicitLegacy) {
      if (String(explicitLegacy.productId ?? "") !== String(args.productId)) {
        return `Selected offer for ${suffix} belongs to a different product.`;
      }
      if (args.variantId && String(explicitLegacy.variantId ?? "") !== String(args.variantId)) {
        return `Selected offer for ${suffix} belongs to a different variant.`;
      }
      if (explicitLegacy.isActive !== true) {
        return `The selected legacy offer for ${suffix} is inactive.`;
      }
      if (explicitLegacy.inStock !== true) {
        return `The selected legacy offer for ${suffix} is marked out of stock.`;
      }
      if (!(Number(explicitLegacy.availableQty ?? 0) > 0)) {
        return `The selected legacy offer for ${suffix} has no available quantity.`;
      }
      if (!(Number(explicitLegacy.unitPrice ?? 0) > 0)) {
        return `The selected legacy offer for ${suffix} has no valid price.`;
      }
    }
  }

  if (args.variantId) {
    const rawVariantOffers = await tx.supplierVariantOffer.findMany({
      where: {
        productId: String(args.productId),
        variantId: String(args.variantId),
      } as any,
      select: {
        id: true,
        productId: true,
        variantId: true,
        isActive: true,
        inStock: true,
        availableQty: true,
        unitPrice: true,
        supplier: { select: { id: true, name: true, status: true } },
        product: { select: { status: true, isDeleted: true } },
      } as any,
      take: 10,
    }).catch(() => []);

    if (rawVariantOffers.length) {
      const firstReason =
        rawVariantOffers.map(explainVariantRow).find(Boolean) ?? null;
      if (firstReason) return firstReason;
      return `Variant offers exist for ${suffix}, but none are checkout-eligible.`;
    }

    return `No persisted variant offer exists for ${suffix}.`;
  }

  const rawBaseOffers = await tx.supplierProductOffer.findMany({
    where: {
      productId: String(args.productId),
    } as any,
    select: {
      id: true,
      productId: true,
      isActive: true,
      inStock: true,
      availableQty: true,
      basePrice: true,
      supplier: { select: { id: true, name: true, status: true } },
      product: { select: { status: true, isDeleted: true } },
    } as any,
    take: 10,
  }).catch(() => []);

  if (rawBaseOffers.length) {
    const firstReason =
      rawBaseOffers.map(explainBaseRow).find(Boolean) ?? null;
    if (firstReason) return firstReason;
    return `Base offers exist for ${suffix}, but none are checkout-eligible.`;
  }

  const rawLegacyBase =
    (await (tx.supplierOffer?.findMany?.({
      where: {
        productId: String(args.productId),
        variantId: null,
      },
      select: {
        id: true,
        productId: true,
        variantId: true,
        isActive: true,
        inStock: true,
        availableQty: true,
        unitPrice: true,
        supplierId: true,
      } as any,
      take: 10,
    }) ?? Promise.resolve([])).catch(() => [])) ?? [];

  if (rawLegacyBase.length) {
    const first = rawLegacyBase[0];
    if (first.isActive !== true) {
      return `Legacy base offer for ${suffix} is inactive.`;
    }
    if (first.inStock !== true) {
      return `Legacy base offer for ${suffix} is marked out of stock.`;
    }
    if (!(Number(first.availableQty ?? 0) > 0)) {
      return `Legacy base offer for ${suffix} has no available quantity.`;
    }
    if (!(Number(first.unitPrice ?? 0) > 0)) {
      return `Legacy base offer for ${suffix} has no valid price.`;
    }
  }

  return `No persisted supplier offers exist for ${suffix}.`;
}

/* ---------------- Stock decrement (atomic) ---------------- */
async function flushTouchedProductsTx(tx: any, touchedProductIds: Set<string>) {
  await Promise.all(
    Array.from(touchedProductIds).map(async (productId) => {
      await recomputeProductStockTx(tx, productId);
      await syncProductInStockCacheTx(tx, productId);
    })
  );
}

async function attachShippingQuotesToOrderTx(
  tx: any,
  args: { quoteIds: string[]; orderId: string }
) {
  const ids = Array.from(
    new Set((args.quoteIds || []).map((x) => String(x ?? "").trim()).filter(Boolean))
  );

  if (!ids.length) return;

  await tx.shippingQuote.updateMany({
    where: { id: { in: ids } },
    data: {
      orderId: args.orderId,
      status: "CONVERTED_TO_ORDER",
    } as any,
  });
}

async function decrementOfferQtyTx(
  tx: any,
  offer: CandidateOffer,
  take: number,
  touchedProductIds?: Set<string>
) {
  if (take <= 0) return;

  if (offer.model === "BASE_OFFER") {
    const r = await tx.supplierProductOffer.updateMany({
      where: { id: offer.id, availableQty: { gte: take } },
      data: { availableQty: { decrement: take } },
    });
    if (r.count !== 1) throw new Error("Concurrent stock update detected (base).");

    const after = await tx.supplierProductOffer.findUnique({
      where: { id: offer.id },
      select: { availableQty: true, productId: true },
    });

    if (after?.productId && touchedProductIds) {
      touchedProductIds.add(String(after.productId));
    }

    if (asNumber(after?.availableQty, 0) <= 0) {
      await tx.supplierProductOffer.update({
        where: { id: offer.id },
        data: { inStock: false },
      });
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
      select: {
        availableQty: true,
        productId: true,
        variant: { select: { productId: true } },
      },
    } as any);

    const pid = String((afterVar as any)?.variant?.productId ?? afterVar?.productId ?? "");
    if (pid && touchedProductIds) {
      touchedProductIds.add(pid);
    }

    if (asNumber(afterVar?.availableQty, 0) <= 0) {
      await tx.supplierVariantOffer.update({
        where: { id: offer.id },
        data: { inStock: false },
      });
    }
    return;
  }

  const r = await tx.supplierOffer.updateMany({
    where: { id: offer.id, availableQty: { gte: take } },
    data: { availableQty: { decrement: take } },
  });
  if (r.count !== 1) throw new Error("Concurrent stock update detected.");

  const after = await tx.supplierOffer.findUnique({
    where: { id: offer.id },
    select: { availableQty: true, productId: true },
  });

  if (after?.productId && touchedProductIds) {
    touchedProductIds.add(String(after.productId));
  }

  if (asNumber(after?.availableQty, 0) <= 0) {
    await tx.supplierOffer.update({
      where: { id: offer.id },
      data: { inStock: false },
    });
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

  const wantedCount = Math.max(
    wantedIdPairs.size,
    wantedAttrIdNamePairs.size,
    wantedNamePairs.size
  );
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
    if (
      !wantedIdPairs.size &&
      wantedAttrIdNamePairs.size &&
      setEquals(sets.attrIdNameSet, wantedAttrIdNamePairs)
    )
      return String(v.id);
    if (
      !wantedIdPairs.size &&
      !wantedAttrIdNamePairs.size &&
      wantedNamePairs.size &&
      setEquals(sets.nameSet, wantedNamePairs)
    )
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
      (!wantedIdPairs.size &&
        !wantedAttrIdNamePairs.size &&
        wantedNamePairs.size &&
        setContainsAll(sets.nameSet, wantedNamePairs));

    if (!ok) continue;

    const extra = Math.max(0, sets.optionCount - wantedCount);
    if (!best || extra < best.extra) best = { id: String(v.id), extra };
  }

  return best ? best.id : null;
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
      `Unit price mismatch for product ${ctx.productId}${ctx.variantId ? ` (variant ${ctx.variantId})` : ""
      }. ` + `Client sent ${n}, server computed ${serverUnit}.`
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
  if (!E) return "PENDING";
  return E.HELD ?? E.ON_HOLD ?? E.HOLD ?? E.PENDING ?? E.CREATED ?? Object.values(E)[0];
}

async function clearActiveCartForUserTx(tx: any, userId: string) {
  const cart = await tx.cart.findFirst({
    where: { userId: String(userId), status: "ACTIVE" as any },
    select: { id: true },
  });

  if (!cart?.id) return { cleared: 0 };

  const del = await tx.cartItem.deleteMany({
    where: { cartId: String(cart.id) },
  });

  return { cleared: Number(del.count || 0) };
}

/* ---------------- Purchase Orders ---------------- */

async function ensurePurchaseOrdersForOrderTx(
  tx: any,
  orderId: string,
  quotesBySupplier?: SelectedShippingQuoteMap
) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      shippingFee: true,
      shippingCurrency: true,
      shippingBreakdownJson: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found.`);
  }

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

    // NET payable to supplier
    const supplierUnit = money(it.chosenSupplierUnitPrice);
    const supplierLine = round2(supplierUnit * qty);

    // What customer paid for this line
    const customerUnit = money(it.unitPrice);
    const customerLine = round2(
      it.lineTotal != null ? money(it.lineTotal) : customerUnit * qty
    );

    const cur =
      bySupplier.get(sid) ?? {
        supplierId: sid,
        supplierAmount: 0,
        customerSubtotal: 0,
        itemIds: [],
      };

    cur.supplierAmount = round2(cur.supplierAmount + supplierLine);
    cur.customerSubtotal = round2(cur.customerSubtotal + customerLine);
    cur.itemIds.push(String(it.id));
    bySupplier.set(sid, cur);
  }

  const supplierIds = Array.from(bySupplier.keys());

  if (!supplierIds.length) return [];

  const suppliers = await tx.supplier.findMany({
    where: { id: { in: supplierIds } },
    select: { id: true, name: true },
  });

  const supplierNameById = new Map(
    suppliers.map((s: any) => [String(s.id), String(s.name)])
  );

  const quotes = quotesBySupplier ?? {};
  const breakdown = (order.shippingBreakdownJson ?? null) as any;

  const breakdownQuoteMap = new Map<
    string,
    {
      shippingFeeChargedToCustomer: number;
      shippingCurrency: string;
      shippingServiceLevel: string | null;
      shippedFromAddressId: string | null;
      shippedToAddressId: string | null;
      shippingCarrierName: string | null;
    }
  >();

  if (breakdown && Array.isArray(breakdown.suppliers)) {
    for (const row of breakdown.suppliers) {
      const sid = String(row?.supplierId ?? "").trim();
      if (!sid) continue;

      const totalFee = round2(
        Number(row?.totalFee ?? row?.totals?.totalFee ?? 0)
      );

      const shippingCurrency = String(
        row?.currency ?? breakdown?.currency ?? order.shippingCurrency ?? "NGN"
      );

      const shippingServiceLevel = row?.serviceLevel
        ? String(row.serviceLevel)
        : null;

      const shippedFromAddressId = row?.pickupAddressId
        ? String(row.pickupAddressId)
        : null;

      const shippedToAddressId = row?.destinationAddressId
        ? String(row.destinationAddressId)
        : null;

      const shippingCarrierName =
        String(row?.rateSource ?? "").toUpperCase() === "LIVE_CARRIER"
          ? String(
            row?.pricingMeta?.carrierName ??
            row?.pricingMetaJson?.carrierName ??
            ""
          ).trim() || null
          : null;

      breakdownQuoteMap.set(sid, {
        shippingFeeChargedToCustomer: totalFee,
        shippingCurrency,
        shippingServiceLevel,
        shippedFromAddressId,
        shippedToAddressId,
        shippingCarrierName,
      });
    }
  }

  const totalOrderShippingFee = round2(Number(order.shippingFee ?? 0));
  const totalCustomerSubtotal = round2(
    Array.from(bySupplier.values()).reduce(
      (sum, g) => sum + round2(g.customerSubtotal),
      0
    )
  );

  const createdPOs: any[] = [];

  for (const sid of supplierIds) {
    const g = bySupplier.get(sid)!;

    const supplierAmount = round2(g.supplierAmount);
    const customerSubtotal = round2(g.customerSubtotal);

    // margin = customer paid - supplier payable
    const platformFee = round2(Math.max(0, customerSubtotal - supplierAmount));

    const directQuote = quotes[sid] ?? null;
    const fallbackQuote = breakdownQuoteMap.get(sid) ?? null;

    let shippingFeeChargedToCustomer = 0;
    let shippingCurrency = String(order.shippingCurrency ?? "NGN");
    let shippingServiceLevel: string | null = null;
    let shippedFromAddressId: string | null = null;
    let shippedToAddressId: string | null = null;
    let shippingCarrierName: string | null = null;

    if (directQuote) {
      shippingFeeChargedToCustomer = round2(directQuote.totalFee);
      shippingCurrency = directQuote.currency ?? shippingCurrency;
      shippingServiceLevel = directQuote.serviceLevel ?? null;
      shippedFromAddressId = directQuote.pickupAddressId ?? null;
      shippedToAddressId = directQuote.destinationAddressId ?? null;
      shippingCarrierName =
        directQuote.rateSource === "LIVE_CARRIER"
          ? String(directQuote?.pricingMetaJson?.carrierName ?? "").trim() || null
          : null;
    } else if (fallbackQuote) {
      shippingFeeChargedToCustomer = round2(
        fallbackQuote.shippingFeeChargedToCustomer
      );
      shippingCurrency = fallbackQuote.shippingCurrency ?? shippingCurrency;
      shippingServiceLevel = fallbackQuote.shippingServiceLevel ?? null;
      shippedFromAddressId = fallbackQuote.shippedFromAddressId ?? null;
      shippedToAddressId = fallbackQuote.shippedToAddressId ?? null;
      shippingCarrierName = fallbackQuote.shippingCarrierName ?? null;
    } else if (totalOrderShippingFee > 0 && totalCustomerSubtotal > 0) {
      shippingFeeChargedToCustomer = round2(
        (customerSubtotal / totalCustomerSubtotal) * totalOrderShippingFee
      );
    }

    const po = await tx.purchaseOrder.upsert({
      where: { orderId_supplierId: { orderId, supplierId: sid } },
      create: {
        orderId,
        supplierId: sid,
        subtotal: customerSubtotal,
        platformFee,
        supplierAmount,
        status: "CREATED",
        shippingFeeChargedToCustomer,
        shippingCurrency,
        shippingServiceLevel,
        shippedFromAddressId,
        shippedToAddressId,
        shippingCarrierName,
      },
      update: {
        subtotal: customerSubtotal,
        platformFee,
        supplierAmount,
        shippingFeeChargedToCustomer,
        shippingCurrency,
        shippingServiceLevel,
        shippedFromAddressId,
        shippedToAddressId,
        shippingCarrierName,
      },
      select: { id: true, supplierId: true },
    });

    await tx.purchaseOrderItem.deleteMany({
      where: { purchaseOrderId: po.id },
    });

    if (g.itemIds.length) {
      await tx.purchaseOrderItem.createMany({
        data: g.itemIds.map((orderItemId) => ({
          purchaseOrderId: po.id,
          orderItemId,
        })),
      });
    }

    createdPOs.push({
      id: po.id,
      supplierId: sid,
      supplierName: supplierNameById.get(sid) ?? null,
      subtotal: customerSubtotal,
      supplierAmount,
      platformFee,
      shippingFeeChargedToCustomer,
      shippingCurrency,
      shippingServiceLevel,
      shippedFromAddressId,
      shippedToAddressId,
      shippingCarrierName,
    });
  }

  return createdPOs;
}

export function resolveMarginPercentForItem(settings: CheckoutSettingsSnapshot): number {
  const cfg = getMarginConfig(settings);

  let margin = Number(cfg.defaultPercent ?? 0);
  if (!Number.isFinite(margin) || margin < 0) margin = 0;

  margin = Math.min(margin, cfg.maxMarginPct);
  return margin;
}

function getMarginConfig(settings: CheckoutSettingsSnapshot) {
  return {
    defaultPercent: Math.min(
      Math.max(0, Number(settings.marginPercent ?? 0)),
      Math.max(0, Number(settings.maxMarginPct ?? 100))
    ),
    minMarginNGN: Math.max(0, Number(settings.minMarginNGN ?? 0)),
    maxMarginPct: Math.max(0, Number(settings.maxMarginPct ?? 100)),
  };
}

/**
 * IMPORTANT:
 * Margin deduction for supplier payout must be based on the supplier cost,
 * NOT the retail/customer price.
 *
 * Example:
 * supplier cost = 16500
 * marginPercent = 10
 * supplier net payable = 14850
 */
function computeSupplierNetPayableFromSupplierCost(
  settings: CheckoutSettingsSnapshot,
  args: {
    supplierUnitCost: number;
    productId: string;
    variantId: string | null;
  }
) {
  const supplierUnitCost = round2(Number(args.supplierUnitCost ?? 0));
  if (!(supplierUnitCost > 0)) {
    throw new Error(
      `Invalid supplier unit cost for product ${args.productId}${args.variantId ? ` variant ${args.variantId}` : ""
      }.`
    );
  }

  const marginPercent = resolveMarginPercentForItem(settings);

  // Your requested rule:
  // amount payable = supplier cost - (marginPercent% of supplier cost)
  const marginAmount = round2(supplierUnitCost * (marginPercent / 100));
  const supplierNetUnitPayable = round2(supplierUnitCost - marginAmount);

  if (supplierNetUnitPayable < 0) {
    throw new Error(
      `Computed supplier net payable is negative for product ${args.productId}${args.variantId ? ` variant ${args.variantId}` : ""
      }.`
    );
  }

  return {
    marginPercent,
    supplierGrossUnitCost: supplierUnitCost,
    supplierMarginAmount: marginAmount,
    supplierNetUnitPayable,
  };
}

function computeSupplierPayoutFromRetail(
  settings: CheckoutSettingsSnapshot,
  args: { retailUnit: number; productId: string; variantId: string | null }
) {
  const { retailUnit, productId } = args;

  if (!Number.isFinite(retailUnit) || retailUnit <= 0) {
    throw new Error("Invalid retail unit price.");
  }

  const cfg = getMarginConfig(settings);
  const marginPercent = resolveMarginPercentForItem(settings);

  const percentMarginValue = round2(retailUnit * (marginPercent / 100));
  const actualMargin = Math.max(cfg.minMarginNGN, percentMarginValue);

  if (actualMargin >= retailUnit) {
    throw new Error(
      `Configured margin is too high for retail price on product ${productId}.`
    );
  }

  const supplierPayout = round2(retailUnit - actualMargin);

  return {
    marginPercent,
    platformMargin: actualMargin,
    supplierPayout,
  };
}


function resolveServiceFeeBaseSnapshot(
  body: CreateOrderBody,
  settings: CheckoutSettingsSnapshot
): number {
  const fromBody = Number(body?.serviceFeeBase);

  if (Number.isFinite(fromBody) && fromBody >= 0) {
    return round2(fromBody);
  }

  // fallback only at order creation time if checkout forgot to send it
  return round2(Math.max(0, Number(settings.baseServiceFeeNGN ?? 0)));
}


/**
 * Align to settings.ts checkout/service-fee:
 * - serviceFeeComms = unitFee * totalUnits
 * - grossBeforeGateway = itemsSubtotal + vatAddOn + base + comms
 * - gateway estimated on grossBeforeGateway
 */


/* ---------------- Sellability checks ---------------- */

async function assertProductSellableTx(tx: any, productId: string) {
  const p = await tx.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      title: true,
      status: true,
      deletedAt: true,
      ownerId: true,
      supplierId: true,
    },
  });

  if (!p || p.deletedAt) throw new Error("Product not found.");
  if (String(p.status).toUpperCase() !== "LIVE") {
    throw new Error(`Product "${p.title}" is not available for purchase.`);
  }

  return { title: String(p.title ?? "") };
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

/* ---------------- Supplier notifications helpers (THE REQUEST) ---------------- */

async function notifySuppliersForOrderTx(
  tx: any,
  orderId: string,
  payload: { type: NotificationType; title: string; body: string; data?: any }
) {
  const pos = await tx.purchaseOrder.findMany({
    where: { orderId },
    select: { id: true, supplierId: true },
  });

  for (const po of pos) {
    try {
      await notifySupplierBySupplierId(
        String(po.supplierId),
        {
          ...payload,
          data: { ...(payload.data ?? {}), orderId, purchaseOrderId: po.id },
        },
        tx
      );
    } catch (err: any) {
      console.error("[notifySupplier] failed", {
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        orderId,
        message: err?.message,
        code: err?.code,
      });
    }
  }
}


async function notifyOneSupplierForPoTx(
  tx: any,
  args: { orderId: string; purchaseOrderId: string; supplierId: string },
  payload: { type: NotificationType; title: string; body: string; data?: any }
) {
  try {
    await notifySupplierBySupplierId(
      String(args.supplierId),
      {
        ...payload,
        data: {
          ...(payload.data ?? {}),
          orderId: args.orderId,
          purchaseOrderId: args.purchaseOrderId,
        },
      },
      tx
    );
  } catch (err: any) {
    console.error("[notifySupplier] failed", {
      supplierId: args.supplierId,
      purchaseOrderId: args.purchaseOrderId,
      orderId: args.orderId,
      message: err?.message,
      code: err?.code,
    });
  }
}



/* =========================================================
   POST /api/orders — create + allocate across offers
========================================================= */

function normalizeRequestedKind(line: any): "BASE" | "VARIANT" {
  const raw = String(line?.kind ?? "").trim().toUpperCase();

  if (raw === "VARIANT") return "VARIANT";
  if (raw === "BASE") return "BASE";

  if (line?.variantId != null && String(line.variantId).trim()) {
    return "VARIANT";
  }

  return "BASE";
}

function fireAndForgetOrderPostCommit(args: {
  orderId: string;
  total: number;
  userId: string;
}) {
  void (async () => {
    try {
      await notifyUser(
        args.userId,
        {
          type: NotificationType.ORDER_PLACED,
          title: "Order placed",
          body: `Your order ${args.orderId} has been created.`,
          data: {
            orderId: args.orderId,
            total: args.total,
          },
        },
        prisma as any
      );
    } catch (notifyErr) {
      console.error("Failed to notify user after order create:", notifyErr);
    }

    try {
      await notifyAdmins(
        {
          type: NotificationType.ORDER_PLACED,
          title: "New order created",
          body: `Order ${args.orderId} was created with total ₦${args.total}.`,
          data: {
            orderId: args.orderId,
            total: args.total,
          },
        },
        prisma as any
      );
    } catch (notifyErr) {
      console.error("Failed to notify admins after order create:", notifyErr);
    }

    try {
      await prisma.$transaction(async (tx: any) => {
        await clearActiveCartForUserTx(tx, args.userId);
      });
    } catch (cartErr) {
      console.error("Failed to clear active cart after order create:", cartErr);
    }
  })();
}


router.post("/", requireAuth, async (req: Request, res: Response) => {
  const body = req.body as CreateOrderBody;
  const items = Array.isArray(body.items) ? body.items : [];

  const shippingEnabled = await isShippingEnabledTx(prisma as any);

  if (items.length === 0) {
    return res.status(400).json({ error: "No items." });
  }

  if (
    !body.selectedUserShippingAddressId &&
    !body.shippingAddressId &&
    !body.shippingAddress
  ) {
    return res.status(400).json({
      error:
        "selectedUserShippingAddressId, shippingAddress, or shippingAddressId is required.",
    });
  }

  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const toNumberLocal = (v: any, def = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };

  try {
    const txResult = await prisma.$transaction(
      async (tx: any) => {
        const settings = await loadCheckoutSettingsTx(tx);
        const shippingEnabledTxVal = shippingEnabled;
        const touchedProductIds = new Set<string>();

        let selectedShippingQuotesBySupplier: SelectedShippingQuoteMap = {};
        let shippingFeeFinal = 0;
        let shippingCurrencyFinal = "NGN";
        let shippingRateSourceFinal: string | null = null;

        if (shippingEnabledTxVal) {
          selectedShippingQuotesBySupplier = await getSelectedShippingQuotesTx(tx, {
            shippingQuoteIds: body.shippingQuoteIds ?? null,
            shippingQuoteId: body.shippingQuoteId ?? null,
            userId,
          });

          const selectedQuotes = Object.values(selectedShippingQuotesBySupplier);

          const clientShippingFee = round2(
            Math.max(0, toNumberLocal((body as any).shippingFee, 0))
          );

          shippingFeeFinal = round2(
            selectedQuotes.length
              ? selectedQuotes.reduce((s, q) => s + round2(q.totalFee), 0)
              : clientShippingFee
          );

          shippingCurrencyFinal = String(
            selectedQuotes[0]?.currency ?? (body as any).shippingCurrency ?? "NGN"
          );

          const rawRate =
            selectedQuotes.length === 1
              ? selectedQuotes[0].rateSource
              : selectedQuotes.length > 1
                ? "MANUAL"
                : (body as any).shippingRateSource || "MANUAL";

          shippingRateSourceFinal = normalizeShippingRateSource(rawRate);
        }

        let shippingAddressId: string | null = null;
        let billingAddressId: string | null = null;
        let selectedUserShippingAddressId: string | null = null;

        const buyer = await tx.user.findUnique({
          where: { id: String(userId) },
          select: {
            id: true,
            phone: true,
            phoneVerifiedAt: true,
          },
        });

        if (!buyer) {
          throw new Error("User not found.");
        }

        const DELIVERY_PHONE_UNVERIFIED_MSG =
          "The selected delivery phone is not verified. Please verify it before placing your order.";

        if (body.selectedUserShippingAddressId) {
          const saved = await getUserShippingAddressForCheckoutTx(tx, {
            userId,
            selectedUserShippingAddressId: body.selectedUserShippingAddressId,
          });

          const verified = isSavedShippingAddressVerifiedForCheckout({
            saved,
            userPhone: buyer.phone,
            userPhoneVerifiedAt: buyer.phoneVerifiedAt,
          });

          if (!verified) {
            throw new Error(DELIVERY_PHONE_UNVERIFIED_MSG);
          }

          const snapshot = await createOrderAddressSnapshotFromUserShippingAddressTx(
            tx,
            saved
          );

          if (!snapshot?.id) {
            throw new Error("Could not create shipping address snapshot.");
          }

          shippingAddressId = String(snapshot.id);
          selectedUserShippingAddressId = String(saved.id);
        } else if (body.shippingAddressId) {
          const rawShippingAddressId = String(body.shippingAddressId).trim();

          const savedUserShipping = await tx.userShippingAddress.findFirst({
            where: {
              id: rawShippingAddressId,
              userId,
              isActive: true,
            },
            select: {
              id: true,
              label: true,
              recipientName: true,
              phone: true,
              whatsappPhone: true,
              houseNumber: true,
              streetName: true,
              postCode: true,
              town: true,
              city: true,
              state: true,
              country: true,
              lga: true,
              landmark: true,
              directionsNote: true,
              phoneVerifiedAt: true,
              phoneVerifiedBy: true,
              verificationMeta: true,
            },
          });

          if (savedUserShipping) {
            const verified = isSavedShippingAddressVerifiedForCheckout({
              saved: savedUserShipping,
              userPhone: buyer.phone,
              userPhoneVerifiedAt: buyer.phoneVerifiedAt,
            });

            if (!verified) {
              throw new Error(DELIVERY_PHONE_UNVERIFIED_MSG);
            }

            const snapshot = await createOrderAddressSnapshotFromUserShippingAddressTx(
              tx,
              savedUserShipping
            );

            if (!snapshot?.id) {
              throw new Error("Could not create shipping address snapshot.");
            }

            shippingAddressId = String(snapshot.id);
            selectedUserShippingAddressId = String(savedUserShipping.id);
          } else {
            throw new Error(
              "Selected delivery address was not found. Please reselect your saved delivery detail."
            );
          }
        } else if (body.shippingAddress) {
          const a = body.shippingAddress;

          const createdShipping = await tx.address.create({
            data: {
              houseNumber: a.houseNumber ?? null,
              streetName: a.streetName ?? null,
              postCode: a.postCode ?? null,
              town: a.town ?? null,
              city: a.city ?? null,
              state: a.state ?? null,
              country: a.country ?? null,
              lga: (a as any).lga ?? null,
              landmark: (a as any).landmark ?? null,
              directionsNote: (a as any).directionsNote ?? null,
              placeId: (a as any).placeId ?? null,
              validationSource: (a as any).validationSource ?? null,
              isValidated: Boolean((a as any).isValidated ?? false),
              latitude:
                (a as any).latitude != null && `${(a as any).latitude}` !== ""
                  ? Number((a as any).latitude)
                  : null,
              longitude:
                (a as any).longitude != null && `${(a as any).longitude}` !== ""
                  ? Number((a as any).longitude)
                  : null,
              validatedAt:
                (a as any).validatedAt ? new Date((a as any).validatedAt) : null,
            },
            select: { id: true },
          });

          shippingAddressId = String(createdShipping.id);
        }

        if (!shippingAddressId) {
          throw new Error("A shipping address is required to create this order.");
        }

        if (body.billingAddressId) {
          const existingBilling = await tx.address.findUnique({
            where: { id: String(body.billingAddressId) },
            select: { id: true },
          });

          if (!existingBilling) {
            throw new Error("Billing address not found.");
          }

          billingAddressId = String(existingBilling.id);
        } else if (body.billingAddress) {
          const b = body.billingAddress;

          const createdBilling = await tx.address.create({
            data: {
              houseNumber: b.houseNumber ?? null,
              streetName: b.streetName ?? null,
              postCode: b.postCode ?? null,
              town: b.town ?? null,
              city: b.city ?? null,
              state: b.state ?? null,
              country: b.country ?? null,
              lga: (b as any).lga ?? null,
              landmark: (b as any).landmark ?? null,
              directionsNote: (b as any).directionsNote ?? null,
              placeId: (b as any).placeId ?? null,
              validationSource: (b as any).validationSource ?? null,
              isValidated: Boolean((b as any).isValidated ?? false),
              latitude:
                (b as any).latitude != null && `${(b as any).latitude}` !== ""
                  ? Number((b as any).latitude)
                  : null,
              longitude:
                (b as any).longitude != null && `${(b as any).longitude}` !== ""
                  ? Number((b as any).longitude)
                  : null,
              validatedAt:
                (b as any).validatedAt ? new Date((b as any).validatedAt) : null,
            },
            select: { id: true },
          });

          billingAddressId = String(createdBilling.id);
        }

        const order = await tx.order.create({
          data: {
            userId,
            shippingAddressId,
            selectedUserShippingAddressId,
            billingAddressId,
            subtotal: 0,
            tax: 0,
            total: 0,
            status: "CREATED",
            shippingFee: shippingEnabledTxVal ? shippingFeeFinal : 0,
            shippingCurrency: shippingCurrencyFinal,
            ...(shippingEnabledTxVal && shippingRateSourceFinal
              ? { shippingRateSource: shippingRateSourceFinal as any }
              : {}),
            shippingBreakdownJson:
              shippingEnabledTxVal && Object.keys(selectedShippingQuotesBySupplier).length
                ? buildOrderShippingBreakdownFromQuotes(selectedShippingQuotesBySupplier)
                : shippingEnabledTxVal && shippingFeeFinal > 0
                  ? {
                    quoteId: null,
                    serviceLevel: "STANDARD",
                    zoneCode: null,
                    zoneName: null,
                    currency: shippingCurrencyFinal,
                    rateSource:
                      (shippingRateSourceFinal as any) ??
                      normalizeShippingRateSource("MANUAL"),
                    components: {
                      shippingFee: shippingFeeFinal,
                      remoteSurcharge: 0,
                      fuelSurcharge: 0,
                      handlingFee: 0,
                      insuranceFee: 0,
                    },
                    totalFee: shippingFeeFinal,
                    etaMinDays: null,
                    etaMaxDays: null,
                    pricingMeta: { source: "checkout_fallback" },
                  }
                  : null,
          },
          select: { id: true },
        });

        await logOrderActivityTx(tx, order.id, ACT.ORDER_CREATED as any, "Order created");
        if (body.notes && String(body.notes).trim()) {
          await logOrderActivityTx(tx, order.id, ACT.NOTE as any, String(body.notes).trim());
        }

        let runningSubtotal = 0;

        for (const line of items) {
          const productId = String((line as any).productId ?? "").trim();
          if (!productId) throw new Error("Invalid line item: missing productId.");

          const qtyNeeded = Number((line as any).qty ?? (line as any).quantity ?? 0);
          if (!Number.isFinite(qtyNeeded) || qtyNeeded <= 0) {
            throw new Error("Invalid line item.");
          }

          const { title: productTitle } = await assertProductSellableTx(tx, productId);

          const selectedOptionsRaw = (line as any).selectedOptions ?? null;
          let selectedOptions: any = null;
          try {
            if (typeof selectedOptionsRaw === "string") {
              selectedOptions = JSON.parse(selectedOptionsRaw);
            } else {
              selectedOptions = selectedOptionsRaw;
            }
          } catch {
            selectedOptions = selectedOptionsRaw;
          }

          const explicitOfferIdRaw =
            (line as any).offerId ?? (line as any).supplierOfferId ?? null;
          const explicitOfferId = explicitOfferIdRaw
            ? String(explicitOfferIdRaw).trim()
            : null;

          const requestedKind = normalizeRequestedKind(line);

          const rawVariantId = (line as any).variantId ?? null;
          const directVariantId =
            rawVariantId && String(rawVariantId).trim()
              ? String(rawVariantId).trim()
              : null;

          let explicitOffer:
            | (CandidateOffer & { productId: string; variantId: string | null })
            | null = null;
          let candidates: CandidateOffer[] = [];

          if (explicitOfferId) {
            explicitOffer = await fetchOneOfferByIdTx(tx, explicitOfferId);

            if (explicitOffer && String(explicitOffer.productId) !== String(productId)) {
              console.warn(
                "[create-order] explicit offer belongs to different product; ignoring",
                {
                  productId,
                  explicitOfferId,
                  explicitOfferProductId: explicitOffer.productId,
                }
              );
              explicitOffer = null;
            }
          }

          let variantId: string | null = null;

          if (explicitOffer?.model === "VARIANT_OFFER" && explicitOffer.variantId) {
            variantId = String(explicitOffer.variantId);
          } else if (
            explicitOffer?.model === "BASE_OFFER" ||
            (explicitOffer?.model === "LEGACY_OFFER" && !explicitOffer.variantId)
          ) {
            variantId = null;
          } else if (requestedKind === "VARIANT") {
            if (directVariantId) {
              variantId = directVariantId;
            } else {
              const variantFromOptions = await resolveVariantIdFromSelectedOptionsTx(
                tx,
                productId,
                selectedOptions
              );
              variantId = variantFromOptions ? String(variantFromOptions) : null;
            }
          } else {
            variantId = null;
          }

          if (explicitOffer?.model === "VARIANT_OFFER" && explicitOffer.variantId) {
            const explicitVariantId = String(explicitOffer.variantId);

            if (variantId && String(variantId) !== explicitVariantId) {
              console.warn(
                "[create-order] explicit offer variant differs from requested variant; forcing explicit variant",
                {
                  productId,
                  explicitOfferId,
                  explicitVariantId,
                  requestedVariantId: variantId,
                }
              );
            }

            variantId = explicitVariantId;
          }

          if (
            explicitOffer?.model === "BASE_OFFER" ||
            (explicitOffer?.model === "LEGACY_OFFER" && !explicitOffer.variantId)
          ) {
            if (variantId) {
              console.warn(
                "[create-order] explicit base offer received with variant-like selections; forcing base path",
                {
                  productId,
                  explicitOfferId,
                  requestedVariantId: variantId,
                  selectedOptions,
                }
              );
            }

            variantId = null;
          }

          console.debug("[create-order] normalized line intent", {
            productId,
            requestedKind,
            directVariantId,
            resolvedVariantId: variantId,
            explicitOfferId,
            explicitOfferModel: explicitOffer?.model ?? null,
            explicitOfferVariantId: explicitOffer?.variantId ?? null,
            selectedOptions,
          });

          const optionsLabel = formatSelectedOptionsForMsg(
            variantId ? selectedOptions : null
          );

          if (variantId) {
            await assertVariantSellableTx(tx, productId, variantId);
            candidates = await fetchActiveOffersTx(tx, { productId, variantId });
          } else {
            candidates = await fetchActiveBaseOffersTx(tx, { productId });
          }

          if (explicitOffer) {
            const explicitStillAvailable = candidates.find((c) => c.id === explicitOffer.id);
            if (explicitStillAvailable) {
              candidates = [
                explicitStillAvailable,
                ...candidates.filter((c) => c.id !== explicitStillAvailable.id),
              ];
            } else {
              console.warn(
                "[create-order] explicit offer not in fresh candidate set; falling back to fresh candidates",
                {
                  productId,
                  variantId,
                  explicitOfferId: explicitOffer.id,
                  explicitOfferModel: explicitOffer.model,
                }
              );
            }
          }

          const candidatesBefore = candidates.slice();
          const policy = getSupplierSelectionPolicy(settings);
          candidates = orderCandidatesGateBand(candidates, settings);

          await debugSupplierSelectionTx(tx, {
            productId,
            variantId,
            qtyNeeded,
            policy,
            before: candidatesBefore,
            after: candidates,
          });

          if (!candidates.length) {
            const exactReason = await explainUnavailableLineTx(tx, {
              productId,
              variantId,
              explicitOfferId,
              productTitle,
              optionsLabel,
            });

            throw new Error(exactReason);
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

            const take = Math.min(need, o.availableQty);
            await decrementOfferQtyTx(tx, o, take, touchedProductIds);

            allocations.push({
              supplierId: o.supplierId,
              qty: take,
              supplierUnitCost: Number(o.unitPrice),
              model: o.model,
              supplierProductOfferId:
                o.model === "BASE_OFFER"
                  ? o.supplierProductOfferId ?? o.id
                  : o.model === "VARIANT_OFFER"
                    ? o.supplierProductOfferId ?? null
                    : null,
              supplierVariantOfferId:
                o.model === "VARIANT_OFFER" ? String(o.id) : null,
            });

            need -= take;
          }

          const checkoutUnit = getClientCheckoutUnitPrice(line);

          if (!(Number.isFinite(checkoutUnit) && Number(checkoutUnit) > 0)) {
            throw new Error(
              `Missing checkout unit price for ${productTitle}${optionsLabel}.`
            );
          }

          const orderItemRows = allocations.map((alloc) => {
            const supplierUnitCostGross = round2(Number(alloc.supplierUnitCost || 0));
            if (!(supplierUnitCostGross > 0)) {
              throw new Error(
                `Missing supplier unit cost for ${productTitle}${optionsLabel}.`
              );
            }

            const pricing = computeSupplierNetPayableFromSupplierCost(settings, {
              supplierUnitCost: supplierUnitCostGross,
              productId,
              variantId,
            });

            return {
              orderId: order.id,
              productId,
              variantId,
              chosenSupplierProductOfferId: alloc.supplierProductOfferId,
              chosenSupplierVariantOfferId: alloc.supplierVariantOfferId,
              chosenSupplierId: alloc.supplierId,

              // IMPORTANT:
              // Freeze NET payable here so all downstream PO/allocation/payout logic
              // uses the already-deducted amount.
              chosenSupplierUnitPrice: pricing.supplierNetUnitPayable,

              title: productTitle,
              unitPrice: round2(Number(checkoutUnit)),
              quantity: alloc.qty,
              lineTotal: round2(Number(checkoutUnit) * alloc.qty),

              selectedOptions:
                variantId
                  ? {
                    raw: selectedOptions ?? null,
                    pricingSnapshot: {
                      supplierGrossUnitCost: pricing.supplierGrossUnitCost,
                      marginPercent: pricing.marginPercent,
                      supplierMarginAmount: pricing.supplierMarginAmount,
                      supplierNetUnitPayable: pricing.supplierNetUnitPayable,
                    },
                  }
                  : {
                    raw: null,
                    pricingSnapshot: {
                      supplierGrossUnitCost: pricing.supplierGrossUnitCost,
                      marginPercent: pricing.marginPercent,
                      supplierMarginAmount: pricing.supplierMarginAmount,
                      supplierNetUnitPayable: pricing.supplierNetUnitPayable,
                    },
                  },
            };
          });

          if (orderItemRows.length) {
            await tx.orderItem.createMany({
              data: orderItemRows,
            });
          }

          for (const row of orderItemRows) {
            runningSubtotal += round2(Number(row.lineTotal));
          }

          await logOrderActivityTx(
            tx,
            order.id,
            "PRICING_SNAPSHOT" as any,
            `Order item priced via CHECKOUT_PRICE for ${productTitle}${optionsLabel}`,
            {
              productId,
              variantId,
              productTitle,
              qtyNeeded,
              allocations: orderItemRows.map((r: any) => {
                const snap = r?.selectedOptions?.pricingSnapshot ?? null;
                return {
                  supplierId: r.chosenSupplierId,
                  qty: r.quantity,
                  supplierGrossUnitCost: snap?.supplierGrossUnitCost ?? null,
                  marginPercent: snap?.marginPercent ?? null,
                  supplierMarginAmount: snap?.supplierMarginAmount ?? null,
                  supplierNetUnitPayable: r.chosenSupplierUnitPrice,
                  finalCustomerUnit: r.unitPrice,
                  lineTotal: r.lineTotal,
                };
              }),
              pricingSource: "CHECKOUT_PRICE",
            }
          );
        }

        await flushTouchedProductsTx(tx, touchedProductIds);

        const subtotal = round2(runningSubtotal);

        const taxMode = settings.taxMode;
        const taxRatePct = settings.taxRatePct;
        const rate = Math.max(0, taxRatePct) / 100;

        const vatIncluded =
          taxMode === "INCLUDED" && rate > 0
            ? subtotal - subtotal / (1 + rate)
            : 0;
        const vatAddOn =
          taxMode === "ADDED" && rate > 0 ? subtotal * rate : 0;

        const serviceFeeBaseSnapshot = resolveServiceFeeBaseSnapshot(body, settings);
        const serviceFeeCommsSnapshot = 0;
        const serviceFeeGatewaySnapshot = 0;
        const serviceFeeTotalSnapshot = serviceFeeBaseSnapshot;

        const shippingFee = shippingEnabledTxVal ? shippingFeeFinal : 0;
        const total = round2(subtotal + vatAddOn + shippingFee);

        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: {
            subtotal,
            tax: round2(
              taxMode === "INCLUDED"
                ? vatIncluded
                : taxMode === "ADDED"
                  ? vatAddOn
                  : 0
            ),
            total,
            serviceFeeBase: serviceFeeBaseSnapshot,
            serviceFeeComms: serviceFeeCommsSnapshot,
            serviceFeeGateway: serviceFeeGatewaySnapshot,
            serviceFeeTotal: serviceFeeTotalSnapshot,
            serviceFee: serviceFeeTotalSnapshot,
            shippingFee,
            shippingCurrency: shippingCurrencyFinal,
            ...(shippingEnabledTxVal && shippingRateSourceFinal
              ? { shippingRateSource: shippingRateSourceFinal as any }
              : { shippingRateSource: undefined }),
            shippingBreakdownJson:
              shippingEnabledTxVal && Object.keys(selectedShippingQuotesBySupplier).length
                ? buildOrderShippingBreakdownFromQuotes(selectedShippingQuotesBySupplier)
                : shippingEnabledTxVal && shippingFee > 0
                  ? {
                    quoteId: null,
                    serviceLevel: "STANDARD",
                    zoneCode: null,
                    zoneName: null,
                    currency: shippingCurrencyFinal,
                    rateSource:
                      (shippingRateSourceFinal as any) ??
                      normalizeShippingRateSource("MANUAL"),
                    components: {
                      shippingFee,
                      remoteSurcharge: 0,
                      fuelSurcharge: 0,
                      handlingFee: 0,
                      insuranceFee: 0,
                    },
                    totalFee: shippingFee,
                    etaMinDays: null,
                    etaMaxDays: null,
                    pricingMeta: { source: "checkout_fallback" },
                  }
                  : null,
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
            shippingFee: true,
            shippingCurrency: true,
            shippingRateSource: true,
            shippingBreakdownJson: true,
          },
        });

        const purchaseOrders = await ensurePurchaseOrdersForOrderTx(
          tx,
          order.id,
          selectedShippingQuotesBySupplier
        );

        if (shippingEnabledTxVal) {
          await attachShippingQuotesToOrderTx(tx, {
            quoteIds: Object.values(selectedShippingQuotesBySupplier).map((q) => q.id),
            orderId: updatedOrder.id,
          });
        }

        return {
          response: {
            ...updatedOrder,
            meta: {
              taxMode,
              taxRatePct,
              vatIncluded: round2(vatIncluded),
              vatAddOn: round2(vatAddOn),
              serviceFeeMeta: {
                source: Number.isFinite(Number(body?.serviceFeeBase))
                  ? "checkout_snapshot"
                  : "settings_fallback",
                serviceFeeBase: serviceFeeBaseSnapshot,
                serviceFeeComms: serviceFeeCommsSnapshot,
                serviceFeeGateway: serviceFeeGatewaySnapshot,
                serviceFeeTotal: serviceFeeTotalSnapshot,
                includedInRetailPrice: true,
                addedAgainToOrderTotal: false,
              },
              purchaseOrders,
              pricing: {
                mode: "retail-price-with-supplier-cost-allocation",
              },
            },
          },
          postCommit: {
            orderId: updatedOrder.id,
            total: updatedOrder.total,
            userId: String(userId),
          },
        };
      },
      {
        isolationLevel: "ReadCommitted" as any,
        maxWait: 10_000,
        timeout: 45_000,
      }
    );

    const created = txResult.response;

    res.status(201).json({ data: created });

    fireAndForgetOrderPostCommit({
      orderId: txResult.postCommit.orderId,
      total: txResult.postCommit.total,
      userId: txResult.postCommit.userId,
    });

    return;
  } catch (e: any) {
    console.error("create order failed:", e);
    return res.status(400).json({ error: e?.message || "Could not create order" });
  }
});
/* ---------------- Availability helpers (used by GET routes) ---------------- */


function isRefundOpenStatus(status: any) {
  const s = String(status ?? "").toUpperCase();
  return [
    "REQUESTED",
    "SUPPLIER_REVIEW",
    "SUPPLIER_ACCEPTED",
    "SUPPLIER_REJECTED",
    "ESCALATED",
    "APPROVED",
    "PROCESSING",
  ].includes(s);
}

router.post("/refund-request", requireAuth, async (req: any, res) => {
  const actorId = String(req.user?.id ?? "").trim();
  const role = String(req.user?.role ?? "").trim().toUpperCase();

  if (!actorId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (role === "SUPPLIER" || ["ADMIN", "SUPER_ADMIN"].includes(role)) {
    return res.status(403).json({
      error: "Only customers can create refund requests here.",
    });
  }

  try {
    const out = await prisma.$transaction(async (tx: any) => {
      const complaintWindowDays = await getComplaintWindowDaysTx(tx);

      const orderId = String(req.body?.orderId ?? "").trim();
      if (!orderId) throw new Error("Missing orderId");

      const reason = String(
        req.body?.reason ??
        req.body?.refundReason ??
        req.body?.message ??
        req.body?.note ??
        req.body?.description ??
        ""
      ).trim();

      if (!reason) throw new Error("Please provide a refund reason.");

      const itemIds = Array.from(
        new Set(
          [
            ...(Array.isArray(req.body?.itemIds) ? req.body.itemIds : []),
            ...(Array.isArray(req.body?.orderItemIds) ? req.body.orderItemIds : []),
            ...(Array.isArray(req.body?.items)
              ? req.body.items.map((x: any) => x?.orderItemId ?? x?.id)
              : []),
          ]
            .map((x) => String(x ?? "").trim())
            .filter(Boolean)
        )
      );

      const purchaseOrderId = String(
        req.body?.purchaseOrderId ?? req.body?.poId ?? ""
      ).trim();

      const note = String(
        req.body?.customerNote ?? req.body?.note ?? ""
      ).trim();

      const providerReference = String(
        req.body?.providerReference ?? req.body?.reference ?? ""
      ).trim();

      const order = await tx.order.findFirst({
        where: { id: orderId, userId: actorId },
        select: {
          id: true,
          userId: true,
          status: true,
          createdAt: true,
          items: {
            select: {
              id: true,
              title: true,
              quantity: true,
              unitPrice: true,
              lineTotal: true,
              chosenSupplierId: true,
            },
          },
          purchaseOrders: {
            select: {
              id: true,
              supplierId: true,
              status: true,
              createdAt: true,
              deliveredAt: true,
              shippedAt: true,
              deliveryOtpVerifiedAt: true,
            },
          },
          payments: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });

      if (!order) throw new Error("Order not found.");

      const orderStatus = String(order.status ?? "").toUpperCase();
      const latestPaidPayment = (order.payments || []).find(
        (p: any) =>
          ["PAID", "VERIFIED", "SUCCESS", "SUCCESSFUL", "COMPLETED", "FUNDED"].includes(
            String(p.status ?? "").toUpperCase()
          )
      );

      const isPaidEffective =
        ["PAID", "FUNDED", "COMPLETED"].includes(orderStatus) || !!latestPaidPayment;

      if (!isPaidEffective) {
        throw new Error("Refund requests are only allowed for paid orders.");
      }

      if (["REFUNDED", "CANCELED", "CANCELLED"].includes(orderStatus)) {
        throw new Error("This order is not eligible for refund.");
      }

      let selectedOrderItems = Array.isArray(order.items) ? order.items : [];

      if (itemIds.length) {
        selectedOrderItems = selectedOrderItems.filter((it: any) =>
          itemIds.includes(String(it.id))
        );
      }

      if (!selectedOrderItems.length) {
        throw new Error("Selected refund items were not found on this order.");
      }

      const supplierIds = Array.from(
        new Set(
          selectedOrderItems
            .map((it: any) => String(it?.chosenSupplierId ?? "").trim())
            .filter(Boolean)
        )
      );

      let supplierId: string | null =
        supplierIds.length === 1 ? String(supplierIds[0]) : null;

      let finalPurchaseOrderId: string | null = purchaseOrderId || null;

      if (finalPurchaseOrderId) {
        const matchedPo = (order.purchaseOrders || []).find(
          (x: any) => String(x.id) === String(finalPurchaseOrderId)
        );

        if (!matchedPo) {
          throw new Error("Selected purchase order was not found on this order.");
        }

        if (matchedPo?.supplierId) {
          supplierId = String(matchedPo.supplierId);
        }
      } else if (supplierId) {
        const po = (order.purchaseOrders || []).find(
          (x: any) => String(x.supplierId) === String(supplierId)
        );
        if (po?.id) finalPurchaseOrderId = String(po.id);
      }

      let refundBaseDate: Date | string | null | undefined = null;

      if (finalPurchaseOrderId) {
        const matchedPo = (order.purchaseOrders || []).find(
          (x: any) => String(x.id) === String(finalPurchaseOrderId)
        );

        if (!matchedPo) {
          throw new Error("Selected purchase order was not found on this order.");
        }

        const poStatus = String(matchedPo.status ?? "").toUpperCase();

        refundBaseDate =
          matchedPo.deliveredAt ??
          matchedPo.deliveryOtpVerifiedAt ??
          null;

        if (!refundBaseDate) {
          throw new Error("Refund requests can only be made after delivery.");
        }

        if (
          !["DELIVERED", "REFUND_REQUESTED", "REFUND_REJECTED", "REFUND_APPROVED"].includes(poStatus) &&
          !matchedPo.deliveredAt &&
          !matchedPo.deliveryOtpVerifiedAt
        ) {
          throw new Error("Refund requests can only be made after delivery.");
        }
      } else {
        const deliveredDates = (order.purchaseOrders || [])
          .map((po: any) => po?.deliveredAt ?? po?.deliveryOtpVerifiedAt ?? null)
          .filter(Boolean)
          .map((x: any) => new Date(x))
          .filter((d: Date) => !Number.isNaN(+d))
          .sort((a: Date, b: Date) => a.getTime() - b.getTime());

        if (!deliveredDates.length) {
          throw new Error("Refund requests can only be made after delivery.");
        }

        refundBaseDate = deliveredDates[0];
      }

      if (!isWithinComplaintWindow(refundBaseDate, complaintWindowDays)) {
        throw new Error(
          `Refund requests are only allowed within ${complaintWindowDays} days of delivery.`
        );
      }

      const existingRefunds = await tx.refund.findMany({
        where: {
          orderId,
          requestedByUserId: actorId,
          ...(finalPurchaseOrderId ? { purchaseOrderId: finalPurchaseOrderId } : {}),
        },
        select: {
          id: true,
          status: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      const existingOpen = existingRefunds.find((r: any) =>
        isRefundOpenStatus(r?.status)
      );

      if (existingOpen) {
        throw new Error("A refund request already exists for this order.");
      }

      const requestedAmount = selectedOrderItems.reduce((sum: number, it: any) => {
        const lineTotal =
          it?.lineTotal != null
            ? Number(it.lineTotal)
            : Number(it.unitPrice ?? 0) * Number(it.quantity ?? 0);

        return sum + (Number.isFinite(lineTotal) ? lineTotal : 0);
      }, 0);

      const refundAmountDecimal = new Prisma.Decimal(String(requestedAmount));

      const refund = await tx.refund.create({
        data: {
          orderId,
          purchaseOrderId: finalPurchaseOrderId || undefined,
          supplierId: supplierId || undefined,
          requestedByUserId: actorId,
          status: "REQUESTED" as any,
          reason,
          itemsAmount: refundAmountDecimal,
          totalAmount: refundAmountDecimal,
          customerNote: note || undefined,
          providerReference: providerReference || undefined,
        },
      });

      if (selectedOrderItems.length) {
        await tx.refundItem.createMany({
          data: selectedOrderItems.map((it: any) => ({
            refundId: refund.id,
            orderItemId: String(it.id),
            qty: Math.max(1, Number(it.quantity || 1)),
          })),
          skipDuplicates: true,
        });
      }

      await tx.refundEvent.create({
        data: {
          refundId: refund.id,
          type: "CUSTOMER_REQUESTED",
          message: reason,
          meta: {
            orderId,
            purchaseOrderId: finalPurchaseOrderId,
            supplierId,
            itemIds: selectedOrderItems.map((it: any) => String(it.id)),
            complaintWindowDays,
            refundBaseDate,
          },
        },
      });

      if (finalPurchaseOrderId) {
        try {
          await tx.purchaseOrder.update({
            where: { id: finalPurchaseOrderId },
            data: { status: "REFUND_REQUESTED" as any },
          });
        } catch {
          //
        }
      }

      return {
        refund,
        supplierId,
        purchaseOrderId: finalPurchaseOrderId,
        itemCount: selectedOrderItems.length,
        complaintWindowDays,
      };
    });

    if (out.refund.requestedByUserId) {
      await notifyUser(out.refund.requestedByUserId, {
        type: "REFUND_REQUESTED",
        title: "Refund request submitted",
        body: `Your refund request for order ${out.refund.orderId} has been submitted.`,
        data: {
          refundId: out.refund.id,
          orderId: out.refund.orderId,
          purchaseOrderId: out.purchaseOrderId ?? null,
        },
      });
    }

    if (out.supplierId) {
      const supplier = await prisma.supplier.findUnique({
        where: { id: out.supplierId },
        select: { userId: true },
      });

      if (supplier?.userId) {
        await notifyUser(supplier.userId, {
          type: "REFUND_REQUESTED",
          title: "Refund request received",
          body: `A customer submitted a refund request for order ${out.refund.orderId}.`,
          data: {
            refundId: out.refund.id,
            orderId: out.refund.orderId,
            purchaseOrderId: out.purchaseOrderId ?? null,
          },
        });
      }
    }

    const admins = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } as any },
      select: { id: true },
    });

    await notifyMany(
      admins.map((a: any) => String(a.id)),
      {
        type: "REFUND_REQUESTED",
        title: "New refund request",
        body: `A refund request was submitted for order ${out.refund.orderId}.`,
        data: {
          refundId: out.refund.id,
          orderId: out.refund.orderId,
          purchaseOrderId: out.purchaseOrderId ?? null,
        },
      }
    );

    return res.status(201).json({
      ok: true,
      data: out.refund,
      meta: {
        created: true,
        purchaseOrderId: out.purchaseOrderId ?? null,
        supplierId: out.supplierId ?? null,
        itemCount: out.itemCount,
        complaintWindowDays: out.complaintWindowDays,
      },
    });
  } catch (e: any) {
    return res.status(400).json({
      error: e?.message || "Failed to submit refund request",
    });
  }
});


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
          supplier: supplierCheckoutReadyRelationFilter(),
        },
      })
      : [];

  const baseMap = new Map<string, number>();
  for (const r of baseAgg as any[]) {
    baseMap.set(
      String(r.productId),
      Math.max(0, Number(r._sum?.availableQty ?? 0))
    );
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
    variantMap.set(
      `${String(r.productId)}::${String(r.variantId)}`,
      Math.max(0, Number(r._sum?.availableQty ?? 0))
    );
  }

  return pairs.map((p) => {
    const pid = String(p.productId);
    const vid = p.variantId ? String(p.variantId) : null;
    const totalAvailable =
      vid == null ? baseMap.get(pid) ?? 0 : variantMap.get(`${pid}::${vid}`) ?? 0;
    return { productId: pid, variantId: vid, totalAvailable };
  });
}

async function buildAvailabilityGetter(pairs: Pair[]) {
  const rows = await computeAvailabilityForPairsTx(prisma as any, pairs, {
    includeBase: true,
  });

  const map: Record<
    string,
    { availableQty: number; inStock: boolean }
  > = {};
  for (const r of rows) {
    const qty = Math.max(0, Number((r as any).totalAvailable || 0));
    map[availKey((r as any).productId, (r as any).variantId)] = {
      availableQty: qty,
      inStock: qty > 0,
    };
  }

  for (const p of pairs) {
    const k = availKey(p.productId, p.variantId);
    if (!map[k]) map[k] = { availableQty: 0, inStock: false };
  }

  return (productId: string, variantId: string | null) =>
    map[availKey(productId, variantId)] ?? { availableQty: 0, inStock: false };
}

/* =========================================================
   GET /api/orders (admins only)
========================================================= */

type OrdersListSortKey = "id" | "user" | "items" | "total" | "status" | "date";
type OrdersListSortDir = "asc" | "desc";

type ParsedOrdersListQuery = {
  page: number;
  pageSize: number;
  skip: number;
  q: string;
  status: string | null;
  from: string | null;
  to: string | null;
  minTotal: number | null;
  maxTotal: number | null;
  sortBy: OrdersListSortKey;
  sortDir: OrdersListSortDir;
};

function parsePositiveInt(v: any, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function parseNullableNumber(v: any): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseSortKey(v: any): OrdersListSortKey {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "id" || s === "user" || s === "items" || s === "total" || s === "status" || s === "date") {
    return s;
  }
  return "date";
}

function parseSortDir(v: any): OrdersListSortDir {
  return String(v ?? "").trim().toLowerCase() === "asc" ? "asc" : "desc";
}

function parseYmdStart(v: any): Date | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(+d) ? null : d;
}

function parseYmdEnd(v: any): Date | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T23:59:59.999Z`);
  return Number.isNaN(+d) ? null : d;
}

function parseOrdersListQuery(req: Request): ParsedOrdersListQuery {
  const page = parsePositiveInt(req.query.page, 1);
  const pageSize = Math.min(100, parsePositiveInt(req.query.pageSize ?? req.query.limit, 10));
  const skip = (page - 1) * pageSize;

  const q = String(req.query.q ?? "").trim();

  const rawStatus = String(req.query.status ?? "").trim().toUpperCase();
  const status = rawStatus && rawStatus !== "ALL" ? rawStatus : null;

  return {
    page,
    pageSize,
    skip,
    q,
    status,
    from: String(req.query.from ?? "").trim() || null,
    to: String(req.query.to ?? "").trim() || null,
    minTotal: parseNullableNumber(req.query.minTotal),
    maxTotal: parseNullableNumber(req.query.maxTotal),
    sortBy: parseSortKey(req.query.sortBy),
    sortDir: parseSortDir(req.query.sortDir),
  };
}

function buildOrdersWhere(args: {
  userId?: string;
  q?: string;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  minTotal?: number | null;
  maxTotal?: number | null;
  includeUserEmail?: boolean;
}) {
  const AND: any[] = [];

  if (args.userId) {
    AND.push({ userId: String(args.userId) });
  }

  if (args.status) {
    AND.push({ status: String(args.status) });
  }

  const fromDate = parseYmdStart(args.from);
  const toDate = parseYmdEnd(args.to);

  if (fromDate || toDate) {
    AND.push({
      createdAt: {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      },
    });
  }

  if (args.minTotal != null || args.maxTotal != null) {
    AND.push({
      total: {
        ...(args.minTotal != null ? { gte: args.minTotal } : {}),
        ...(args.maxTotal != null ? { lte: args.maxTotal } : {}),
      },
    });
  }

  const q = String(args.q ?? "").trim();
  if (q) {
    const OR: any[] = [
      { id: { contains: q } },
      {
        items: {
          some: {
            title: {
              contains: q,
              mode: "insensitive" as const,
            },
          },
        },
      },
      {
        payments: {
          some: {
            reference: {
              contains: q,
              mode: "insensitive" as const,
            },
          },
        },
      },
    ];

    if (args.includeUserEmail) {
      OR.push({
        user: {
          email: {
            contains: q,
            mode: "insensitive" as const,
          },
        },
      });
    }

    AND.push({ OR });
  }

  if (AND.length === 0) return {};
  if (AND.length === 1) return AND[0];
  return { AND };
}

function buildOrdersOrderBy(sortBy: OrdersListSortKey, sortDir: OrdersListSortDir, isAdminList: boolean) {
  const dir = sortDir;

  switch (sortBy) {
    case "id":
      return [{ id: dir }, { createdAt: "desc" as const }];

    case "total":
      return [{ total: dir }, { createdAt: "desc" as const }];

    case "status":
      return [{ status: dir }, { createdAt: "desc" as const }];

    case "user":
      return isAdminList
        ? ([{ user: { email: dir } } as any, { createdAt: "desc" as const }])
        : ([{ createdAt: "desc" as const }]);

    case "items":
      return [{ items: { _count: dir } } as any, { createdAt: "desc" as const }];

    case "date":
    default:
      return [{ createdAt: dir }, { id: "desc" as const }];
  }
}

function makePaginatedResponse<T>(args: {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const totalPages = Math.max(1, Math.ceil(args.total / args.pageSize));

  return {
    data: args.rows,
    total: args.total,
    page: args.page,
    pageSize: args.pageSize,
    totalPages,
  };
}

function fireAndForgetCancelPostCommit(args: {
  mode: "ORDER_ONLY" | "SUPPLIER_PO" | "ORDER_ALL";
  orderId: string;
  orderUserId: string;
  actorRole: string;
  supplierId?: string | null;
  canceledPurchaseOrderIds?: string[];
  allCanceled?: boolean;
}) {
  void (async () => {
    try {
      if (args.mode === "SUPPLIER_PO") {
        await notifyUser(
          String(args.orderUserId),
          {
            type: NotificationType.PURCHASE_ORDER_STATUS_UPDATE,
            title: "Order update",
            body: `A supplier canceled part of your order ${args.orderId}.`,
            data: {
              orderId: args.orderId,
              supplierId: args.supplierId ?? null,
              purchaseOrderIds: args.canceledPurchaseOrderIds ?? [],
              allCanceled: !!args.allCanceled,
            },
          },
          prisma as any
        );

        await notifyAdmins(
          {
            type: NotificationType.PURCHASE_ORDER_STATUS_UPDATE,
            title: "Supplier canceled PO",
            body: `A supplier canceled a purchase order for order ${args.orderId}.`,
            data: {
              orderId: args.orderId,
              supplierId: args.supplierId ?? null,
              purchaseOrderIds: args.canceledPurchaseOrderIds ?? [],
              allCanceled: !!args.allCanceled,
            },
          },
          prisma as any
        );

        return;
      }

      if (args.mode === "ORDER_ONLY" || args.mode === "ORDER_ALL") {
        try {
          await notifyUser(
            String(args.orderUserId),
            {
              type: NotificationType.ORDER_CANCELED,
              title: "Order canceled",
              body: `Your order ${args.orderId} has been canceled.`,
              data: { orderId: args.orderId },
            },
            prisma as any
          );
        } catch (e) {
          console.error("cancel post-commit user notify failed:", e);
        }

        try {
          await notifyAdmins(
            {
              type: NotificationType.ORDER_CANCELED,
              title: "Order canceled",
              body: `Order ${args.orderId} was canceled.`,
              data: { orderId: args.orderId },
            },
            prisma as any
          );
        } catch (e) {
          console.error("cancel post-commit admin notify failed:", e);
        }

        if (args.mode === "ORDER_ALL") {
          try {
            await notifySuppliersForOrderTx(prisma as any, args.orderId, {
              type: NotificationType.PURCHASE_ORDER_STATUS_UPDATE,
              title: "Order canceled",
              body: `Order ${args.orderId} was canceled.`,
              data: { orderId: args.orderId },
            });
          } catch (e) {
            console.error("cancel post-commit supplier notify failed:", e);
          }
        }
      }
    } catch (e) {
      console.error("fireAndForgetCancelPostCommit failed:", e);
    }
  })();
}

router.get("/", requireAuth, async (req, res) => {
  try {
    if (!isAdmin((req as any).user?.role)) {
      return res.status(403).json({ error: "Admins only" });
    }

    const parsed = parseOrdersListQuery(req);
    const where = buildOrdersWhere({
      q: parsed.q,
      status: parsed.status,
      from: parsed.from,
      to: parsed.to,
      minTotal: parsed.minTotal,
      maxTotal: parsed.maxTotal,
      includeUserEmail: true,
    });

    const orderBy = buildOrdersOrderBy(parsed.sortBy, parsed.sortDir, true);

    const asNumLocal = (v: any, d = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };

    const [total, orders] = await prisma.$transaction([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy,
        skip: parsed.skip,
        take: parsed.pageSize,
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
          shippingFee: true,
          shippingCurrency: true,
          shippingRateSource: true,
          shippingBreakdownJson: true,
          serviceFeeTotal: true,
          user: { select: { email: true } },
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
          _count: {
            select: {
              items: true,
            },
          },
        },
      }),
    ]);

    const orderIds = orders.map((o: any) => o.id);
    if (orderIds.length === 0) {
      return res.json(
        makePaginatedResponse({
          rows: [],
          total,
          page: parsed.page,
          pageSize: parsed.pageSize,
        })
      );
    }

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
        select: {
          id: true,
          orderId: true,
          status: true,
          provider: true,
          reference: true,
          amount: true,
          createdAt: true,
        },
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
    } catch {
      //
    }

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

      const productIds = Array.from(
        new Set(
          allItems
            .map((it) => String(it.productId || "").trim())
            .filter(Boolean)
        )
      );

      const variantIds = Array.from(
        new Set(
          allItems
            .map((it) => String(it.variantId || "").trim())
            .filter(Boolean)
        )
      );

      const [products, variants] = await Promise.all([
        productIds.length
          ? prisma.product.findMany({
            where: { id: { in: productIds } },
            select: {
              id: true,
              title: true,
              imagesJson: true,
            },
          })
          : Promise.resolve([]),
        variantIds.length
          ? prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: {
              id: true,
              sku: true,
              productId: true,
              imagesJson: true,
            },
          })
          : Promise.resolve([]),
      ]);

      const productById = new Map<string, any>();
      for (const p of products as any[]) {
        productById.set(String(p.id), p);
      }

      const variantById = new Map<string, any>();
      for (const v of variants as any[]) {
        variantById.set(String(v.id), v);
      }

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
        const itemStatus = supplierId
          ? poStatusByOrderSupplier[`${oid}::${supplierId}`] ?? "PENDING"
          : "PENDING";

        const product = productById.get(pid) || null;
        const variant = vid ? variantById.get(vid) || null : null;

        const variantImages = Array.isArray(variant?.imagesJson)
          ? variant.imagesJson.filter(Boolean)
          : [];

        const productImages = Array.isArray(product?.imagesJson)
          ? product.imagesJson.filter(Boolean)
          : [];

        const resolvedImage =
          variantImages[0] ??
          productImages[0] ??
          null;

        (itemsByOrder[oid] ||= []).push({
          id: it.id,
          productId: it.productId,
          variantId: it.variantId ?? null,
          title: it.title ?? product?.title ?? "—",
          unitPrice,
          quantity,
          lineTotal,
          status: itemStatus,
          chosenSupplierProductOfferId: it.chosenSupplierProductOfferId ?? null,
          chosenSupplierVariantOfferId: it.chosenSupplierVariantOfferId ?? null,
          chosenSupplierId: it.chosenSupplierId ?? null,
          chosenSupplierUnitPrice:
            it.chosenSupplierUnitPrice != null ? asNumLocal(it.chosenSupplierUnitPrice, 0) : null,
          selectedOptions: it.selectedOptions ?? null,
          currentAvailableQty: availableQty,
          currentInStock: inStock,

          product: product
            ? {
              id: String(product.id),
              title: product.title ?? null,
              imagesJson: productImages,
            }
            : null,

          variant: variant
            ? {
              id: String(variant.id),
              sku: variant.sku ?? null,
              productId: variant.productId ?? null,
              imagesJson: variantImages,
            }
            : null,

          imageSnapshot: resolvedImage,
        });
      }
    } catch (e) {
      console.error("Failed to load order items", e);
    }

    const rows = orders.map((o: any) => {
      const oid = String(o.id);
      return {
        ...o,
        items: itemsByOrder[oid] || [],
        payments: paymentsByOrder[oid] || [],
        paidAmount: paidAmountByOrder[oid] || 0,
        itemsCount: Number(o?._count?.items ?? (itemsByOrder[oid]?.length || 0)),
        deliveryOtpVerifiedAt: (o as any).purchaseOrder?.deliveryOtpVerifiedAt ?? null,
        purchaseOrder: undefined,
        _count: undefined,
      };
    });

    return res.json(
      makePaginatedResponse({
        rows,
        total,
        page: parsed.page,
        pageSize: parsed.pageSize,
      })
    );
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
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = parseOrdersListQuery(req);

    const where = buildOrdersWhere({
      userId: String(userId),
      q: parsed.q,
      status: parsed.status,
      from: parsed.from,
      to: parsed.to,
      minTotal: parsed.minTotal,
      maxTotal: parsed.maxTotal,
      includeUserEmail: false,
    });

    const orderBy = buildOrdersOrderBy(parsed.sortBy, parsed.sortDir, false);

    const asNumLocal = (x: any, d = 0) => {
      const n = Number(x);
      return Number.isFinite(n) ? n : d;
    };

    const toShopperStatus = (s: any) => {
      const u = String(s || "").toUpperCase();
      if (!u || u === "PENDING" || u === "CREATED" || u === "FUNDED") return "PROCESSING";
      return u;
    };

    const {
      complaintWindowDays,
      total,
      baseOrders,
      poRows,
      allItems,
    } = await prisma.$transaction(async (tx: any) => {
      const complaintWindowDays = await getComplaintWindowDaysTx(tx);

      const [total, baseOrders] = await Promise.all([
        tx.order.count({ where }),
        tx.order.findMany({
          where,
          orderBy,
          skip: parsed.skip,
          take: parsed.pageSize,
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
            shippingFee: true,
            shippingCurrency: true,
            shippingRateSource: true,
            shippingBreakdownJson: true,
            serviceFeeTotal: true,
            payments: {
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                status: true,
                provider: true,
                reference: true,
                amount: true,
                createdAt: true,
              },
            },
            purchaseOrders: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                supplierId: true,
                status: true,
                payoutStatus: true,
                deliveredAt: true,
                deliveryOtpVerifiedAt: true,
                shippedAt: true,
                createdAt: true,
                supplier: { select: { id: true, name: true } },
              },
            },
            _count: {
              select: {
                items: true,
              },
            },
          },
        }),
      ]);

      const orderIds = baseOrders.map((o: any) => o.id);

      if (!orderIds.length) {
        return {
          complaintWindowDays,
          total,
          baseOrders,
          poRows: [],
          allItems: [],
        };
      }

      const [poRows, allItems] = await Promise.all([
        tx.purchaseOrder.findMany({
          where: { orderId: { in: orderIds } },
          select: {
            orderId: true,
            supplierId: true,
            status: true,
            deliveredAt: true,
            deliveryOtpVerifiedAt: true,
            createdAt: true,
          },
        }),
        tx.orderItem.findMany({
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
        }),
      ]);

      return {
        complaintWindowDays,
        total,
        baseOrders,
        poRows,
        allItems,
      };
    });

    const orderIds = baseOrders.map((o: any) => o.id);

    if (orderIds.length === 0) {
      return res.json(
        makePaginatedResponse({
          rows: [],
          total,
          page: parsed.page,
          pageSize: parsed.pageSize,
        })
      );
    }

    const poStatusByOrderSupplier: Record<string, string> = {};
    for (const po of poRows as any[]) {
      poStatusByOrderSupplier[`${String(po.orderId)}::${String(po.supplierId)}`] = String(po.status || "PENDING");
    }

    const productIds = Array.from(
      new Set(
        (allItems as any[])
          .map((it) => String(it.productId || "").trim())
          .filter(Boolean)
      )
    );

    const variantIds = Array.from(
      new Set(
        (allItems as any[])
          .map((it) => String(it.variantId || "").trim())
          .filter(Boolean)
      )
    );

    const [products, variants] = await Promise.all([
      productIds.length
        ? prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            title: true,
            imagesJson: true,
          },
        })
        : Promise.resolve([]),
      variantIds.length
        ? prisma.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: {
            id: true,
            sku: true,
            productId: true,
            imagesJson: true,
          },
        })
        : Promise.resolve([]),
    ]);

    const productById = new Map<string, any>();
    for (const p of products as any[]) {
      productById.set(String(p.id), p);
    }

    const variantById = new Map<string, any>();
    for (const v of variants as any[]) {
      variantById.set(String(v.id), v);
    }

    const uniqPairs: Pair[] = [];
    const seen = new Set<string>();
    for (const it of allItems as any[]) {
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
      const rawPoStatus = supplierId
        ? poStatusByOrderSupplier[`${oid}::${supplierId}`] ?? "PENDING"
        : "PENDING";

      const product = productById.get(pid) || null;
      const variant = vid ? variantById.get(vid) || null : null;

      const variantImages = Array.isArray(variant?.imagesJson)
        ? variant.imagesJson.filter(Boolean)
        : [];

      const productImages = Array.isArray(product?.imagesJson)
        ? product.imagesJson.filter(Boolean)
        : [];

      const resolvedImage =
        variantImages[0] ??
        productImages[0] ??
        null;

      (itemsByOrder[oid] ||= []).push({
        id: it.id,
        productId: it.productId,
        variantId: it.variantId ?? null,
        title: it.title ?? product?.title ?? "—",
        unitPrice,
        quantity: qty,
        lineTotal,
        status: toShopperStatus(rawPoStatus),
        supplierStatusRaw: String(rawPoStatus || "PENDING"),
        chosenSupplierProductOfferId: it.chosenSupplierProductOfferId ?? null,
        chosenSupplierVariantOfferId: it.chosenSupplierVariantOfferId ?? null,
        chosenSupplierId: it.chosenSupplierId ?? null,
        chosenSupplierUnitPrice:
          it.chosenSupplierUnitPrice != null ? asNumLocal(it.chosenSupplierUnitPrice, 0) : null,
        currentAvailableQty: availableQty,
        currentInStock: inStock,
        selectedOptions: it.selectedOptions ?? null,

        product: product
          ? {
            id: String(product.id),
            title: product.title ?? null,
            imagesJson: productImages,
          }
          : null,

        variant: variant
          ? {
            id: String(variant.id),
            sku: variant.sku ?? null,
            productId: variant.productId ?? null,
            imagesJson: variantImages,
          }
          : null,

        imageSnapshot: resolvedImage,
      });
    }

    const rows = baseOrders.map((o: any) => ({
      id: o.id,
      status: o.status,
      subtotal: asNumLocal(o.subtotal, 0),
      tax: asNumLocal(o.tax, 0),
      total: asNumLocal(o.total, 0),
      createdAt: o.createdAt?.toISOString?.() ?? o.createdAt,
      complaintWindowDays,
      items: itemsByOrder[o.id] || [],
      itemsCount: Number(o?._count?.items ?? (itemsByOrder[o.id]?.length || 0)),
      serviceFeeBase: asNumLocal(o.serviceFeeBase, 0),
      serviceFeeComms: asNumLocal(o.serviceFeeComms, 0),
      serviceFeeGateway: asNumLocal(o.serviceFeeGateway, 0),
      serviceFeeTotal: asNumLocal(o.serviceFeeTotal, 0),
      payments: Array.isArray(o.payments)
        ? o.payments.map((p: any) => ({
          id: String(p.id),
          status: String(p.status ?? ""),
          provider: p.provider ?? null,
          reference: p.reference ?? null,
          amount: p.amount != null ? asNumLocal(p.amount, 0) : null,
          createdAt: p.createdAt?.toISOString?.() ?? p.createdAt ?? null,
        }))
        : [],
      purchaseOrders: Array.isArray(o.purchaseOrders)
        ? o.purchaseOrders.map((po: any) => ({
          id: String(po.id),
          supplierId: String(po.supplierId),
          supplierName: po?.supplier?.name ?? null,
          status: po?.status ?? null,
          payoutStatus: po?.payoutStatus ?? null,
          createdAt: po?.createdAt?.toISOString?.() ?? po?.createdAt ?? null,
          shippedAt: po?.shippedAt?.toISOString?.() ?? po?.shippedAt ?? null,
          deliveredAt: po?.deliveredAt?.toISOString?.() ?? po?.deliveredAt ?? null,
          deliveryOtpVerifiedAt:
            po?.deliveryOtpVerifiedAt?.toISOString?.() ?? po?.deliveryOtpVerifiedAt ?? null,
        }))
        : [],
    }));

    return res.json(
      makePaginatedResponse({
        rows,
        total,
        page: parsed.page,
        pageSize: parsed.pageSize,
      })
    );
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

    const [countAll, paidPaymentsAgg, refundedAgg, latest] = await prisma.$transaction([
      prisma.order.count({ where: { userId } }),

      prisma.payment.aggregate({
        where: {
          order: { userId },
          status: "PAID" as any,
        },
        _sum: { amount: true },
      }),

      prisma.refund.aggregate({
        where: {
          requestedByUserId: userId,
          status: "REFUNDED" as any,
        },
        _sum: { totalAmount: true },
      }),

      prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, status: true, total: true, createdAt: true },
      }),
    ]);

    const grossSpent = Number((paidPaymentsAgg as any)._sum.amount ?? 0);
    const refundedSpent = Number((refundedAgg as any)._sum.totalAmount ?? 0);
    const totalSpent = Math.max(0, grossSpent - refundedSpent);

    res.json({
      ordersCount: countAll,
      grossSpent,
      refundedSpent,
      totalSpent,
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
    const id = requiredString(req.params.id);

    const {
      complaintWindowDays,
      order,
    } = await prisma.$transaction(async (tx: any) => {
      const complaintWindowDays = await getComplaintWindowDaysTx(tx);

      const order = await tx.order.findUnique({
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
          shippingFee: true,
          shippingCurrency: true,
          shippingRateSource: true,
          shippingBreakdownJson: true,

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
              shippedAt: true,
              deliveredAt: true,
              deliveryOtpVerifiedAt: true,
              payoutStatus: true,
              paidOutAt: true,
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

      return {
        complaintWindowDays,
        order,
      };
    });

    if (!order) return res.status(404).json({ error: "Order not found" });

    const adminUser = isAdmin((req as any).user?.role);
    if (!adminUser && String(order.user?.id) !== String((req as any).user?.id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const asNumLocal = (v: any, d = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };

    const toShopperStatus = (s: any) => {
      const u = String(s || "").toUpperCase();
      if (!u || u === "PENDING" || u === "CREATED" || u === "FUNDED") {
        return "PROCESSING";
      }
      return u;
    };

    const poStatusBySupplier = new Map<string, string>();
    for (const po of ((order as any).purchaseOrders || []) as any[]) {
      poStatusBySupplier.set(
        String(po.supplierId),
        String(po.status || "PENDING")
      );
    }

    const rawItems = ((order as any).items || []) as any[];

    const productIds = Array.from(
      new Set(
        rawItems
          .map((it) => String(it.productId || "").trim())
          .filter(Boolean)
      )
    );

    const variantIds = Array.from(
      new Set(
        rawItems
          .map((it) => String(it.variantId || "").trim())
          .filter(Boolean)
      )
    );

    const [products, variants] = await Promise.all([
      productIds.length
        ? prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            title: true,
            imagesJson: true,
          },
        })
        : Promise.resolve([]),
      variantIds.length
        ? prisma.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: {
            id: true,
            sku: true,
            productId: true,
            imagesJson: true,
          },
        })
        : Promise.resolve([]),
    ]);

    const productById = new Map<string, any>();
    for (const p of products as any[]) {
      productById.set(String(p.id), p);
    }

    const variantById = new Map<string, any>();
    for (const v of variants as any[]) {
      variantById.set(String(v.id), v);
    }

    const uniqPairs: Pair[] = [];
    const seen = new Set<string>();
    for (const it of rawItems) {
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
      subtotal: asNumLocal((order as any).subtotal, 0),
      tax: asNumLocal((order as any).tax, 0),
      total: asNumLocal((order as any).total, 0),

      serviceFeeBase: asNumLocal((order as any).serviceFeeBase, 0),
      serviceFeeComms: asNumLocal((order as any).serviceFeeComms, 0),
      serviceFeeGateway: asNumLocal((order as any).serviceFeeGateway, 0),
      serviceFeeTotal: asNumLocal((order as any).serviceFeeTotal, 0),
      serviceFee: asNumLocal((order as any).serviceFee, 0),

      shippingFee: asNumLocal((order as any).shippingFee, 0),
      shippingCurrency: (order as any).shippingCurrency ?? "NGN",
      shippingRateSource: (order as any).shippingRateSource ?? null,
      shippingBreakdownJson: (order as any).shippingBreakdownJson ?? null,

      complaintWindowDays,

      createdAt:
        (order as any).createdAt?.toISOString?.() ?? (order as any).createdAt,

      items: rawItems.map((it: any) => {
        const pid = String(it.productId);
        const vid = it.variantId == null ? null : String(it.variantId);
        const { availableQty, inStock } = getAvail(pid, vid);

        const supplierId = it.chosenSupplierId ? String(it.chosenSupplierId) : "";
        const rawPoStatus = supplierId
          ? poStatusBySupplier.get(supplierId) ?? "PENDING"
          : "PENDING";

        const product = productById.get(pid) || null;
        const variant = vid ? variantById.get(vid) || null : null;

        const variantImages = Array.isArray(variant?.imagesJson)
          ? variant.imagesJson.filter(Boolean)
          : [];

        const productImages = Array.isArray(product?.imagesJson)
          ? product.imagesJson.filter(Boolean)
          : [];

        const resolvedImage =
          variantImages[0] ??
          productImages[0] ??
          null;

        return {
          id: it.id,
          productId: it.productId,
          variantId: it.variantId ?? null,
          title: it.title ?? product?.title ?? "—",
          unitPrice: asNumLocal(it.unitPrice, 0),
          quantity: asNumLocal(it.quantity, 1),
          lineTotal: asNumLocal(
            it.lineTotal,
            asNumLocal(it.unitPrice, 0) * asNumLocal(it.quantity, 1)
          ),
          status: adminUser ? String(rawPoStatus) : toShopperStatus(rawPoStatus),
          supplierStatusRaw: String(rawPoStatus),
          chosenSupplierProductOfferId: it.chosenSupplierProductOfferId ?? null,
          chosenSupplierVariantOfferId: it.chosenSupplierVariantOfferId ?? null,
          chosenSupplierId: it.chosenSupplierId ?? null,
          chosenSupplierUnitPrice:
            it.chosenSupplierUnitPrice != null
              ? asNumLocal(it.chosenSupplierUnitPrice, 0)
              : null,
          currentAvailableQty: availableQty,
          currentInStock: inStock,
          selectedOptions: it.selectedOptions ?? null,

          product: product
            ? {
              id: String(product.id),
              title: product.title ?? null,
              imagesJson: productImages,
            }
            : null,

          variant: variant
            ? {
              id: String(variant.id),
              sku: variant.sku ?? null,
              productId: variant.productId ?? null,
              imagesJson: variantImages,
            }
            : null,

          imageSnapshot: resolvedImage,
        };
      }),

      payments: Array.isArray((order as any).payments)
        ? ((order as any).payments as any[]).map((p: any) => ({
          id: String(p.id),
          status: String(p.status ?? ""),
          provider: p.provider ?? null,
          channel: p.channel ?? null,
          reference: p.reference ?? null,
          amount: p.amount != null ? asNumLocal(p.amount, 0) : null,
          feeAmount: p.feeAmount != null ? asNumLocal(p.feeAmount, 0) : null,
          createdAt: p.createdAt?.toISOString?.() ?? p.createdAt ?? null,
          allocations: Array.isArray(p.allocations)
            ? p.allocations.map((a: any) => ({
              id: String(a.id),
              supplierId: String(a.supplierId),
              supplierName:
                a?.supplier?.name ?? a?.supplierNameSnapshot ?? null,
              amount: a.amount != null ? asNumLocal(a.amount, 0) : null,
              status: a.status ?? null,
              purchaseOrderId: a.purchaseOrderId ?? null,
            }))
            : [],
        }))
        : [],

      purchaseOrders: Array.isArray((order as any).purchaseOrders)
        ? ((order as any).purchaseOrders as any[]).map((po: any) => ({
          id: String(po.id),
          supplierId: String(po.supplierId),
          supplierName: po?.supplier?.name ?? null,
          status: po?.status ?? null,
          subtotal: po?.subtotal != null ? asNumLocal(po.subtotal, 0) : null,
          platformFee: po?.platformFee != null ? asNumLocal(po.platformFee, 0) : null,
          supplierAmount:
            po?.supplierAmount != null ? asNumLocal(po.supplierAmount, 0) : null,
          createdAt: po?.createdAt?.toISOString?.() ?? po?.createdAt ?? null,
          shippedAt: po?.shippedAt?.toISOString?.() ?? po?.shippedAt ?? null,
          deliveredAt: po?.deliveredAt?.toISOString?.() ?? po?.deliveredAt ?? null,
          deliveryOtpVerifiedAt:
            po?.deliveryOtpVerifiedAt?.toISOString?.() ??
            po?.deliveryOtpVerifiedAt ??
            null,
          payoutStatus: po?.payoutStatus ?? null,
          paidOutAt: po?.paidOutAt?.toISOString?.() ?? po?.paidOutAt ?? null,
        }))
        : [],
    };

    return res.json({ data });
  } catch (e: any) {
    console.error("get order failed:", e);
    return res.status(500).json({ error: e?.message || "Failed to fetch order" });
  }
});

/* =========================================================
   GET /api/orders/:orderId/profit (super admin)
========================================================= */

router.get("/:orderId/profit", requireSuperAdmin, async (req, res) => {
  try {
    const orderId = requiredString(req.params.orderId);

    const [order, paidPayments, refundedAgg, itemMetrics] = await Promise.all([
      prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          total: true,
          subtotal: true,
          tax: true,
          shippingFee: true,
          serviceFeeBase: true,
          serviceFeeComms: true,
          serviceFeeGateway: true,
          serviceFeeTotal: true,
          status: true,
          createdAt: true,
        },
      }),

      prisma.payment.findMany({
        where: {
          orderId,
          status: "PAID" as any,
        },
        select: {
          id: true,
          amount: true,
          feeAmount: true,
          status: true,
          createdAt: true,
          paidAt: true,
          refundedAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),

      prisma.refund.aggregate({
        where: {
          orderId,
          status: "REFUNDED" as any,
        },
        _sum: {
          totalAmount: true,
        },
      }),

      prisma.orderItemProfit.findMany({
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
      }),
    ]);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const N = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const summary = itemMetrics.reduce(
      (s: any, x: any) => {
        s.revenue += N(x.revenue);
        s.cogs += N(x.cogs);
        s.gateway += N(x.allocatedGatewayFee);
        s.comms += N(x.allocatedCommsFee);
        s.base += N(x.allocatedBaseServiceFee);
        s.profit += N(x.profit);
        return s;
      },
      { revenue: 0, cogs: 0, gateway: 0, comms: 0, base: 0, profit: 0 }
    );

    const paidAmount = paidPayments.reduce(
      (a: number, p: any) => a + N(p.amount),
      0
    );

    const gatewayFeeActual = paidPayments.reduce(
      (a: number, p: any) => a + N(p.feeAmount),
      0
    );

    const refundedAmount = N((refundedAgg as any)?._sum?.totalAmount);

    const orderTotal = N(order.total);
    const grossRevenue = N(summary.revenue);
    const grossProfit = N(summary.profit);

    // Realized factor after refunds.
    // Example:
    // paid 100k, refunded 20k, order total 100k => factor 0.8
    // This keeps revenue/profit aligned with partial refunds.
    const effectiveFactor =
      orderTotal > 0
        ? Math.max(0, Math.min(1, (paidAmount - refundedAmount) / orderTotal))
        : 0;

    const realizedRevenue = grossRevenue * effectiveFactor;
    const realizedCogs = N(summary.cogs) * effectiveFactor;
    const realizedGateway = N(summary.gateway) * effectiveFactor;
    const realizedComms = N(summary.comms) * effectiveFactor;
    const realizedBase = N(summary.base) * effectiveFactor;
    const realizedProfit = grossProfit * effectiveFactor;

    return res.json({
      order: {
        id: order.id,
        status: order.status,
        subtotal: N(order.subtotal),
        tax: N(order.tax),
        shippingFee: N(order.shippingFee),
        total: N(order.total),
        serviceFeeBase: N(order.serviceFeeBase),
        serviceFeeComms: N(order.serviceFeeComms),
        serviceFeeGateway: N(order.serviceFeeGateway),
        serviceFeeRecorded: N(order.serviceFeeTotal),
        paidAmount,
        refundedAmount,
        netPaidAmount: Math.max(0, paidAmount - refundedAmount),
        gatewayFeeActual,
        effectiveFactor,
      },

      summary: {
        // original full-order metrics
        grossRevenue,
        grossProfit,
        cogs: N(summary.cogs),
        gateway: N(summary.gateway),
        comms: N(summary.comms),
        base: N(summary.base),

        // refund impact
        refundedAmount,

        // realized / refund-adjusted metrics
        netRevenue: realizedRevenue,
        netProfit: realizedProfit,
        netCogs: realizedCogs,
        netGateway: realizedGateway,
        netComms: realizedComms,
        netBase: realizedBase,
      },

      items: itemMetrics,
    });
  } catch (e: any) {
    console.error("profit endpoint failed:", e);
    res.status(500).json({ error: e?.message || "Failed to fetch profit" });
  }
});

/* ===========================
   OTP endpoints
=========================== */

const OrderOtpPurpose = z.enum(["PAY_ORDER", "CANCEL_ORDER"]);

router.post("/:id/otp/request", requireAuth, async (req, res) => {
  const orderId = requiredString(req.params.id);
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
    if (String(order.userId) !== String(actorId))
      return res.status(403).json({ error: "Forbidden" });
  }

  if (purpose === "CANCEL_ORDER") {
    const adminOk = isAdmin((req as any).user?.role);
    const ownerOk = String(order.userId) === String(actorId);
    if (!adminOk && !ownerOk)
      return res.status(403).json({ error: "Forbidden" });
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
  const targetEmail =
    purpose === "PAY_ORDER"
      ? order.user?.email ?? null
      : (req as any).user?.email ?? null;
  const targetPhoneE164 =
    purpose === "PAY_ORDER"
      ? normalizeE164(order.user?.phone ?? null)
      : normalizeE164((req as any).user?.phone ?? null);

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
        ? `email to ${String(targetEmail).replace(
          /(^.).+(@.*$)/,
          "$1***$2"
        )}`
        : null;

  return res.json({ requestId: reqRow.id, expiresInSec, channelHint });
});

router.post("/:id/otp/verify", requireAuth, async (req, res) => {
  try {
    const orderId = requiredString(req.params.id);
    const actorId = getUserId(req);
    if (!actorId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = OrderOtpPurpose.safeParse(req.body?.purpose);
    if (!parsed.success) return res.status(400).json({ error: "Invalid purpose" });
    const purpose = parsed.data;

    const raw = req.body?.otp ?? req.body?.code ?? "";
    const code = String(raw).trim();
    if (!/^\d{6}$/.test(code))
      return res.status(400).json({ error: "OTP must be 6 digits" });

    const out = await prisma.$transaction(async (tx) => {
      // find latest unconsumed request for this user/order/purpose
      const row = await tx.orderOtpRequest.findFirst({
        where: {
          orderId,
          purpose,
          userId: String(actorId),
          consumedAt: null,
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          salt: true,
          codeHash: true,
          expiresAt: true,
          attempts: true,
          lockedUntil: true,
          verifiedAt: true,
        },
      });

      if (!row) throw new Error("OTP request not found");
      if (row.lockedUntil && row.lockedUntil > now())
        throw new Error("OTP temporarily locked. Try again later.");
      if (row.expiresAt && row.expiresAt <= now())
        throw new Error("OTP expired");

      const attempts = Number(row.attempts ?? 0);
      if (attempts >= OTP_MAX_ATTEMPTS) {
        const lockedUntil = addMinutes(now(), OTP_LOCK_MINS);
        await tx.orderOtpRequest.update({
          where: { id: row.id },
          data: { lockedUntil },
        });
        throw new Error("Too many attempts. OTP locked temporarily.");
      }

      const expected = String(row.codeHash);
      const actual = hashOtp(code, String(row.salt));
      if (expected !== actual) {
        await tx.orderOtpRequest.update({
          where: { id: row.id },
          data: { attempts: { increment: 1 } },
        });
        throw new Error("Invalid OTP");
      }

      await tx.orderOtpRequest.update({
        where: { id: row.id },
        data: { verifiedAt: now() },
      });
      return { otpToken: String(row.id) };
    });

    return res.json({ ok: true, otpToken: out.otpToken });
  } catch (e: any) {
    return res
      .status(400)
      .json({ ok: false, error: e?.message || "OTP verification failed" });
  }
});

async function assertValidOtpTokenTx(
  tx: any,
  args: {
    orderId: string;
    purpose: "PAY_ORDER" | "CANCEL_ORDER";
    otpToken: string;
    actorId: string;
    actorRole: string;
  }
) {
  const { orderId, purpose, otpToken, actorId } = args;

  const row = await tx.orderOtpRequest.findFirst({
    where: { id: otpToken, orderId, purpose, verifiedAt: { not: null } },
    select: { id: true, userId: true, expiresAt: true, consumedAt: true },
  });

  if (!row) throw new Error("OTP token invalid");
  if (row.consumedAt) throw new Error("OTP token already used");
  if (row.expiresAt && row.expiresAt <= now())
    throw new Error("OTP token expired");
  if (String(row.userId) !== String(actorId))
    throw new Error("OTP token not valid for this user");

  await tx.orderOtpRequest.update({
    where: { id: row.id },
    data: { consumedAt: now() },
  });
  return true;
}

function requireOtp(purpose: "PAY_ORDER" | "CANCEL_ORDER") {
  return async (req: any, res: any, next: any) => {
    try {
      const orderId = requiredString(req.params.orderId ?? req.params.id);
      const otpToken = String(req.header("x-otp-token") ?? "").trim();
      if (!otpToken)
        return res.status(401).json({ error: "Missing x-otp-token" });

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
      return res
        .status(401)
        .json({ error: e?.message || "OTP required" });
    }
  };
}

router.post(
  "/:orderId/cancel",
  requireAuth,
  requireOtp("CANCEL_ORDER"),
  async (req: any, res) => {
    try {
      const userId = String(req.user?.id ?? "");
      const role = String(req.user?.role ?? "");
      const orderId = String(req.params.orderId);

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const adminOk = isAdmin(role);
      const supplierOk = isSupplier(role);

      const out = await prisma.$transaction(
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: orderId },
            select: {
              id: true,
              userId: true,
              status: true,
              total: true,
              user: { select: { id: true, email: true } },
            },
          });

          if (!order) throw new Error("Order not found");

          if (!adminOk && !supplierOk && String(order.userId) !== String(userId)) {
            throw new Error("Forbidden");
          }

          const pos = await tx.purchaseOrder.findMany({
            where: { orderId },
            select: { id: true, supplierId: true, status: true },
          });

          const hasPaid = await hasSuccessfulPaymentForOrderTx(tx, orderId);

          if (!pos.length) {
            if (!hasPaid) {
              await restoreOrderInventoryTx(tx, orderId);
              await markPendingPaymentsCanceledTx(
                tx,
                orderId,
                "Order canceled before payment"
              );
            }

            await tx.order.update({
              where: { id: orderId },
              data: { status: "CANCELED" as any },
            });

            await logOrderActivityTx(
              tx,
              orderId,
              ACT.STATUS_CHANGE as any,
              "Order canceled"
            );

            return {
              mode: "ORDER_ONLY" as const,
              orderId,
              canceled: true,
              purchaseOrdersCANCELED: 0,
              postCommit: {
                mode: "ORDER_ONLY" as const,
                orderId,
                orderUserId: String(order.userId),
                actorRole: String(role || "").toUpperCase(),
                canceledPurchaseOrderIds: [] as string[],
                allCanceled: true,
              },
            };
          }

          if (supplierOk && !adminOk) {
            const supplier = await tx.supplier.findFirst({
              where: { userId },
              select: { id: true, name: true },
            });

            if (!supplier?.id) throw new Error("Supplier access required");

            const myPos = pos.filter(
              (po: any) => String(po.supplierId) === String(supplier.id)
            );

            if (!myPos.length) throw new Error("No purchase order for this supplier");

            const canceledPurchaseOrderIds: string[] = [];

            for (const po of myPos) {
              await tx.purchaseOrder.update({
                where: { id: po.id },
                data: {
                  status: "CANCELED" as any,
                  canceledAt: new Date(),
                  cancelReason: "SUPPLIER_CANCELED",
                },
              });

              canceledPurchaseOrderIds.push(String(po.id));

              await logOrderActivityTx(
                tx,
                orderId,
                ACT.STATUS_CHANGE as any,
                `Purchase order ${po.id} canceled by supplier`
              );
            }

            const refreshed = await tx.purchaseOrder.findMany({
              where: { orderId },
              select: { status: true },
            });

            const allCanceled = refreshed.every(
              (x: any) => String(x.status).toUpperCase() === "CANCELED"
            );

            if (allCanceled) {
              if (!hasPaid) {
                await restoreOrderInventoryTx(tx, orderId);
                await markPendingPaymentsCanceledTx(
                  tx,
                  orderId,
                  "All supplier POs canceled before payment"
                );
              }

              await tx.order.update({
                where: { id: orderId },
                data: { status: "CANCELED" as any },
              });

              await logOrderActivityTx(
                tx,
                orderId,
                ACT.STATUS_CHANGE as any,
                "Order canceled (all POs canceled)"
              );
            }

            return {
              mode: "SUPPLIER_PO" as const,
              orderId,
              canceled: true,
              purchaseOrdersCANCELED: myPos.length,
              postCommit: {
                mode: "SUPPLIER_PO" as const,
                orderId,
                orderUserId: String(order.userId),
                actorRole: String(role || "").toUpperCase(),
                supplierId: String(supplier.id),
                canceledPurchaseOrderIds,
                allCanceled,
              },
            };
          }

          if (!hasPaid) {
            await restoreOrderInventoryTx(tx, orderId);
            await markPendingPaymentsCanceledTx(
              tx,
              orderId,
              "Order canceled before payment"
            );
          }

          await tx.order.update({
            where: { id: orderId },
            data: { status: "CANCELED" as any },
          });

          await tx.purchaseOrder.updateMany({
            where: { orderId },
            data: {
              status: "CANCELED" as any,
              canceledAt: new Date(),
              cancelReason: hasPaid
                ? "ORDER_CANCELED_AFTER_PAYMENT"
                : "ORDER_CANCELED_BEFORE_PAYMENT",
            },
          });

          await logOrderActivityTx(
            tx,
            orderId,
            ACT.STATUS_CHANGE as any,
            "Order canceled"
          );

          return {
            mode: "ORDER_ALL" as const,
            orderId,
            canceled: true,
            purchaseOrdersCANCELED: pos.length,
            postCommit: {
              mode: "ORDER_ALL" as const,
              orderId,
              orderUserId: String(order.userId),
              actorRole: String(role || "").toUpperCase(),
              canceledPurchaseOrderIds: pos.map((po: any) => String(po.id)),
              allCanceled: true,
            },
          };
        },
        {
          isolationLevel: "ReadCommitted" as any,
          maxWait: 10_000,
          timeout: 45_000,
        }
      );

      res.json({
        ok: true,
        mode: out.mode,
        orderId: out.orderId,
        canceled: out.canceled,
        purchaseOrdersCANCELED: out.purchaseOrdersCANCELED,
      });

      fireAndForgetCancelPostCommit(out.postCommit);
      return;
    } catch (e: any) {
      console.error("cancel order failed:", e);
      return res.status(400).json({
        ok: false,
        error: e?.message || "Failed to cancel order",
      });
    }
  }
);

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
    if (!isSupplier(role) && !isAdmin(role))
      return res.status(403).json({ error: "Forbidden" });

    const out = await prisma.$transaction(async (tx) => {
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
      console.warn("Cancel OTP cooldown:", e?.message, {
        retryAt: e?.retryAt,
        orderId: req.params.orderId,
      });
    } else if (status >= 400 && status < 500) {
      console.warn("Cancel OTP client error:", e?.message, {
        status,
        orderId: req.params.orderId,
      });
    } else {
      console.error(
        "POST /api/orders/:orderId/cancel-otp/request failed:",
        e
      );
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

  if (!userId)
    return res
      .status(200)
      .json({ ok: false, code: "UNAUTHORIZED", message: "Unauthorized" });
  if (!isSupplier(role) && !isAdmin(role))
    return res
      .status(200)
      .json({ ok: false, code: "FORBIDDEN", message: "Forbidden" });

  const raw = req.body?.otp ?? req.body?.code ?? "";
  const otp = String(raw).trim();
  const requestId = req.body?.requestId
    ? String(req.body.requestId).trim()
    : undefined;

  if (!/^\d{6}$/.test(otp)) {
    return res
      .status(200)
      .json({ ok: false, code: "OTP_FORMAT", message: "OTP must be 6 digits" });
  }

  try {
    const out = await prisma.$transaction(async (tx) => {
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
      !!e?.code &&
      (String(e.code).startsWith("OTP_") ||
        ["UNAUTHORIZED", "FORBIDDEN"].includes(String(e.code)));

    if (isOtpFailure) {
      return res.status(200).json({
        ok: false,
        code: e.code,
        message: e.message || "OTP verification failed",
        ...(e?.requestId ? { requestId: e.requestId } : {}),
        ...(e?.expiresAt ? { expiresAt: e.expiresAt } : {}),
        ...(e?.attempts != null ? { attempts: e.attempts } : {}),
        ...(e?.remainingAttempts != null
          ? { remainingAttempts: e.remainingAttempts }
          : {}),
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