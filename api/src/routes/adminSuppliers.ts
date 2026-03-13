// server/routes/adminSuppliers.ts
import { Router, type Request, type Response } from "express";
import { Prisma, SupplierType } from "@prisma/client";
import axios from "axios";

import paystack from "./paystack.js";
import { prisma } from "../lib/prisma.js";
import { requireAdmin, requireSuperAdmin } from "../middleware/auth.js";
import z from "zod";
import { requiredString } from "../lib/http.js";

const router = Router();

/* ---------------- helpers ---------------- */

const toNull = <T = any>(v: T | undefined | null): T | null =>
  v === "" || v === undefined ? null : (v as any);

const toBool = (v: any, def = false) =>
  v === true || v === "true" || v === 1 || v === "1"
    ? true
    : v === false || v === "false" || v === 0 || v === "0"
      ? false
      : def;

const normAuth = (s?: string | null) => {
  const v = (s || "").toUpperCase();
  return (["NONE", "BEARER", "BASIC"] as const).includes(v as any)
    ? (v as "NONE" | "BEARER" | "BASIC")
    : null;
};

const normPayoutMethod = (s?: string | null) => {
  const v = (s || "").toUpperCase();
  return (["TRANSFER", "SPLIT"] as const).includes(v as any)
    ? (v as "TRANSFER" | "SPLIT")
    : null;
};

function normSupplierType(v: any): SupplierType {
  const s = String(v ?? "").toUpperCase();
  return (Object.values(SupplierType) as string[]).includes(s)
    ? (s as SupplierType)
    : SupplierType.PHYSICAL;
}

function normStatus(v: any) {
  return String(v ?? "").toUpperCase() === "ACTIVE" ? "ACTIVE" : "INACTIVE";
}

const toUndef = <T = any>(v: T | undefined | null): T | undefined =>
  v === "" || v === undefined ? undefined : (v as any);

// for fields where you WANT to allow null-clears explicitly:
// - "" => undefined (ignore)
// - null => null (clear)
// - value => value
const toNullablePatch = <T = any>(v: T | undefined | null): T | null | undefined =>
  v === "" || v === undefined ? undefined : (v as any);

function toIsoDateOnly(v: any): string | null {
  if (!v) return null;
  try {
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

/* ---------------- shared admin supplier DTO ---------------- */
/**
 * Keep admin supplier details aligned with supplier.ts so the admin
 * "View Supplier" screen can show the same onboarding/profile data.
 */

const supplierAdminSelect = {
  id: true,
  name: true,
  type: true,

  contactEmail: true,
  whatsappPhone: true,

  legalName: true,
  registeredBusinessName: true,
  registrationNumber: true,
  registrationType: true,
  registrationDate: true,
  registrationCountryCode: true,
  registryAuthorityId: true,

  registryAuthority: {
    select: {
      id: true,
      countryCode: true,
      code: true,
      name: true,
      websiteUrl: true,
      isActive: true,
    },
  },

  natureOfBusiness: true,

  status: true,
  kycStatus: true,
  kycApprovedAt: true,
  kycCheckedAt: true,
  kycRejectedAt: true,
  kycRejectionReason: true,

  bankCountry: true,
  bankCode: true,
  bankName: true,
  accountNumber: true,
  accountName: true,

  bankVerificationStatus: true,
  bankVerificationNote: true,
  bankVerificationRequestedAt: true,
  bankVerifiedAt: true,
  bankVerifiedById: true,

  pickupContactName: true,
  pickupContactPhone: true,
  pickupInstructions: true,
  shippingEnabled: true,
  shipsNationwide: true,
  supportsDoorDelivery: true,
  supportsPickupPoint: true,

  registeredAddressId: true,
  pickupAddressId: true,
  registeredAddress: true,
  pickupAddress: true,

  apiBaseUrl: true,
  apiAuthType: true,
  apiKey: true,

  payoutMethod: true,
  isPayoutEnabled: true,
  paystackRecipientCode: true,
  paystackSubaccountCode: true,

  userId: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  },
} as const;

function toAdminSupplierDto(s: any) {
  return {
    id: s.id,
    supplierId: s.id,

    name: s.name,
    businessName: s.name,

    type: s.type ?? null,
    supplierType: s.type ?? null,

    contactEmail: s.contactEmail ?? s.user?.email ?? null,
    email: s.contactEmail ?? s.user?.email ?? null,

    whatsappPhone: s.whatsappPhone ?? s.user?.phone ?? null,
    contactPhone: s.whatsappPhone ?? s.user?.phone ?? null,

    legalName: s.legalName ?? null,
    registeredBusinessName: s.registeredBusinessName ?? null,
    registrationNumber: s.registrationNumber ?? null,
    registrationType: s.registrationType ?? null,
    registrationDate: toIsoDateOnly(s.registrationDate),
    registrationCountryCode: s.registrationCountryCode ?? null,

    registryAuthorityId: s.registryAuthorityId ?? null,

    registryAuthority: s.registryAuthority
      ? {
        id: s.registryAuthority.id,
        countryCode: s.registryAuthority.countryCode ?? null,
        code: s.registryAuthority.code ?? null,
        name: s.registryAuthority.name ?? null,
        websiteUrl: s.registryAuthority.websiteUrl ?? null,
        isActive: s.registryAuthority.isActive ?? null,
      }
      : null,

    natureOfBusiness: s.natureOfBusiness ?? null,

    status: s.status ?? null,
    kycStatus: s.kycStatus ?? null,
    kycApprovedAt: s.kycApprovedAt ?? null,
    kycCheckedAt: s.kycCheckedAt ?? null,
    kycRejectedAt: s.kycRejectedAt ?? null,
    kycRejectionReason: s.kycRejectionReason ?? null,

    bankCountry: s.bankCountry ?? null,
    bankCode: s.bankCode ?? null,
    bankName: s.bankName ?? null,
    accountName: s.accountName ?? null,
    accountNumber: s.accountNumber ?? null,

    bankVerificationStatus: s.bankVerificationStatus ?? null,
    bankVerificationNote: s.bankVerificationNote ?? null,
    bankVerificationRequestedAt: s.bankVerificationRequestedAt ?? null,
    bankVerifiedAt: s.bankVerifiedAt ?? null,
    bankVerifiedById: s.bankVerifiedById ?? null,

    pickupContactName: s.pickupContactName ?? null,
    pickupContactPhone: s.pickupContactPhone ?? null,
    pickupInstructions: s.pickupInstructions ?? null,
    shippingEnabled: s.shippingEnabled ?? null,
    shipsNationwide: s.shipsNationwide ?? null,
    supportsDoorDelivery: s.supportsDoorDelivery ?? null,
    supportsPickupPoint: s.supportsPickupPoint ?? null,

    registeredAddress: s.registeredAddress ?? null,
    pickupAddress: s.pickupAddress ?? null,

    apiBaseUrl: s.apiBaseUrl ?? null,
    apiAuthType: s.apiAuthType ?? null,
    apiKey: s.apiKey ?? null,

    payoutMethod: s.payoutMethod ?? null,
    isPayoutEnabled: s.isPayoutEnabled ?? null,
    paystackRecipientCode: s.paystackRecipientCode ?? null,
    paystackSubaccountCode: s.paystackSubaccountCode ?? null,

    user: s.user
      ? {
        id: s.user.id,
        firstName: s.user.firstName ?? null,
        lastName: s.user.lastName ?? null,
        contactFirstName: s.user.firstName ?? null,
        contactLastName: s.user.lastName ?? null,
        email: s.user.email ?? null,
        phone: s.user.phone ?? null,
        contactPhone: s.user.phone ?? s.whatsappPhone ?? null,
      }
      : null,

    firstName: s.user?.firstName ?? null,
    lastName: s.user?.lastName ?? null,
    contactFirstName: s.user?.firstName ?? null,
    contactLastName: s.user?.lastName ?? null,
  };
}

/**
 * New offers setup:
 * - SupplierProductOffer (base price per product)
 * - SupplierVariantOffer (per-variant price per product variant)
 *
 * So "supplier is in use" = has product offers OR variant offers OR POs, etc.
 */
async function supplierUsageCounts(supplierId: string) {
  const [productOffers, variantOffers, purchaseOrders, chosenOrderItems] = await Promise.all([
    prisma.supplierProductOffer.count({
      where: {
        product: {
          supplierId,
        },
      },
    }),

    prisma.supplierVariantOffer.count({
      where: {
        product: {
          supplierId,
        },
      },
    }),

    prisma.purchaseOrder.count({ where: { supplierId } }).catch(() => 0),

    prisma.orderItem.count({ where: { chosenSupplierId: supplierId } }).catch(() => 0),
  ]);

  return { productOffers, variantOffers, purchaseOrders, chosenOrderItems };
}

/**
 * Create Paystack transfer recipient if needed (non-blocking)
 */
async function createPaystackRecipientIfNeeded(supplier: {
  id: string;
  name: string;
  payoutMethod: string | null;
  bankCountry: string | null;
  bankCode: string | null;
  accountNumber: string | null;
  accountName: string | null;
  isPayoutEnabled: boolean | null;
  paystackRecipientCode: string | null;
}) {
  try {
    if (!supplier.isPayoutEnabled) return;
    if (String(supplier.payoutMethod || "").toUpperCase() !== "TRANSFER") return;
    if (supplier.paystackRecipientCode) return;
    if (!supplier.accountNumber || !supplier.bankCode) return;

    const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_TEST_SECRET_KEY;
    if (!PAYSTACK_SECRET_KEY) {
      console.warn("Paystack recipient skipped: PAYSTACK_SECRET_KEY missing");
      return;
    }

    const isNG = (supplier.bankCountry || "NG").toUpperCase() === "NG";
    const type = isNG ? "nuban" : "bank_account";

    const resp = await axios.post(
      "https://api.paystack.co/transferrecipient",
      {
        type,
        name: supplier.accountName || supplier.name,
        account_number: supplier.accountNumber,
        bank_code: supplier.bankCode,
        currency: isNG ? "NGN" : undefined,
      },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }, timeout: 10000 }
    );

    const code = resp.data?.data?.recipient_code || null;
    if (code) {
      await prisma.supplier.update({
        where: { id: supplier.id },
        data: { paystackRecipientCode: code },
      });
    }
  } catch (e: any) {
    console.error("Paystack recipient creation failed:", e?.response?.status, e?.response?.data || e?.message);
  }
}

/**
 * Detect bank field changes and compute the "flip to PENDING" patch.
 * - If any of these fields change: bankCountry, bankCode, bankName, accountNumber, accountName
 * - Then require admin verification again.
 *
 * IMPORTANT:
 * If bank details change, we also DISABLE payouts + clear paystackRecipientCode
 * so "VERIFIED badge" and "payout ready" cannot drift apart.
 */
function computeBankPendingPatch(args: {
  current: {
    bankCountry: string | null;
    bankCode: string | null;
    bankName: string | null;
    accountNumber: string | null;
    accountName: string | null;
    bankVerificationStatus: string | null;
  };
  next: Partial<{
    bankCountry: string | null | undefined;
    bankCode: string | null | undefined;
    bankName: string | null | undefined;
    accountNumber: string | null | undefined;
    accountName: string | null | undefined;
  }>;
}) {
  const { current, next } = args;

  const keys: Array<keyof typeof next> = ["bankCountry", "bankCode", "bankName", "accountNumber", "accountName"];

  const changed = keys.some((k) => {
    if (!(k in next)) return false;
    const nv = (next as any)[k];
    if (nv === undefined) return false;
    const cv = (current as any)[k];
    return String(nv ?? "") !== String(cv ?? "");
  });

  if (!changed) return { changed: false, patch: {} as any };

  return {
    changed: true,
    patch: {
      bankVerificationStatus: "PENDING",
      bankVerificationRequestedAt: new Date(),
      bankVerifiedAt: null,
      bankVerifiedById: null,
      bankVerificationNote: null,

      isPayoutEnabled: false,
      paystackRecipientCode: null,
      // paystackSubaccountCode: null,
    },
  };
}

/* ---------------- routes ---------------- */

// GET /api/admin/suppliers
router.get("/", requireAdmin, async (_req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,

        contactEmail: true,
        whatsappPhone: true,

        apiBaseUrl: true,
        apiAuthType: true,
        apiKey: true,

        payoutMethod: true,
        bankCountry: true,
        bankCode: true,
        bankName: true,
        accountNumber: true,
        accountName: true,
        isPayoutEnabled: true,

        paystackRecipientCode: true,
        paystackSubaccountCode: true,

        bankVerificationStatus: true,
        bankVerificationNote: true,
        bankVerificationRequestedAt: true,
        bankVerifiedAt: true,
        bankVerifiedById: true,

        createdAt: true,
        updatedAt: true,
        userId: true,
        kycStatus: true,
        isDeleted: true,

        registeredAddress: true,
        pickupAddress: true,

        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    const rows = await Promise.all(
      suppliers.map(async (s) => {
        const usage = await supplierUsageCounts(s.id);

        const deletable =
          usage.productOffers === 0 &&
          usage.variantOffers === 0 &&
          usage.purchaseOrders === 0 &&
          usage.chosenOrderItems === 0;

        return {
          ...s,
          firstName: s.user?.firstName ?? null,
          lastName: s.user?.lastName ?? null,
          email: s.contactEmail ?? s.user?.email ?? null,
          phone: s.whatsappPhone ?? s.user?.phone ?? null,
          businessName: s.name ?? null,

          productOffers: usage.productOffers,
          variantOffers: usage.variantOffers,
          purchaseOrders: usage.purchaseOrders,
          chosenOrderItems: usage.chosenOrderItems,
          deletable,
        };
      })
    );

    res.json({ data: rows });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "Failed to fetch suppliers" });
  }
});

/**
 * GET /api/admin/suppliers/ledger
 * Query:
 * - supplierId (optional)
 * - q (optional): matches referenceId/referenceType/id
 * - type (optional): CREDIT|DEBIT
 * - take, skip
 */
router.get("/ledger", requireAdmin, async (req: Request, res: Response) => {
  try {
    const supplierId = String((req.query as any)?.supplierId ?? "").trim() || null;
    const qRaw = String((req.query as any)?.q ?? "").trim();
    const typeRaw = String((req.query as any)?.type ?? "").trim().toUpperCase();
    const take = Math.min(200, Math.max(1, Number((req.query as any)?.take ?? 50) || 50));
    const skip = Math.max(0, Number((req.query as any)?.skip ?? 0) || 0);

    const where: any = {};
    if (supplierId) where.supplierId = supplierId;
    if (typeRaw) where.type = typeRaw;

    if (qRaw) {
      const q = qRaw;
      where.OR = [
        { id: { contains: q } },
        { referenceId: { contains: q } },
        { referenceType: { contains: q } },
        { supplierId: { contains: q } },
      ];
    }

    const rows = await prisma.supplierLedgerEntry.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      skip,
      include: {
        supplier: { select: { id: true, name: true } },
      },
    });

    const total = await prisma.supplierLedgerEntry.count({ where });

    return res.json({
      ok: true,
      data: rows,
      meta: { supplierId, q: qRaw || null, type: typeRaw || null, take, skip, total },
    });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to fetch ledger" });
  }
});

// GET /api/admin/suppliers/:id
router.get("/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = requiredString(req.params.id);

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: supplierAdminSelect,
    });

    if (!supplier) return res.status(404).json({ error: "Supplier not found" });

    res.json({ data: toAdminSupplierDto(supplier) });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "Failed to fetch supplier" });
  }
});

// POST /api/admin/suppliers
router.post("/", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const {
      name,
      type = "PHYSICAL",
      status = "ACTIVE",
      contactEmail,
      whatsappPhone,

      apiBaseUrl,
      apiAuthType,
      apiKey,

      payoutMethod,
      bankCountry,
      bankCode,
      bankName,
      accountNumber,
      accountName,
      isPayoutEnabled,
    } = req.body || {};

    if (!name) return res.status(400).json({ error: "name is required" });

    const created = await prisma.supplier.create({
      data: {
        name: String(name).trim(),
        type: normSupplierType(type),
        status: normStatus(status),

        contactEmail: toNull(contactEmail),
        whatsappPhone: toNull(whatsappPhone),

        apiBaseUrl: toNull(apiBaseUrl),
        apiAuthType: normAuth(apiAuthType) ?? "NONE",
        apiKey: toNull(apiKey),

        payoutMethod: normPayoutMethod(payoutMethod),
        bankCountry: (toNull(bankCountry) || "NG") as any,
        bankCode: toNull(bankCode),
        bankName: toNull(bankName),
        accountNumber: toNull(accountNumber),
        accountName: toNull(accountName),
        isPayoutEnabled: toBool(isPayoutEnabled, false),

        ...(bankCode || accountNumber
          ? {
            bankVerificationStatus: "PENDING",
            bankVerificationRequestedAt: new Date(),
          }
          : {}),
      },
    });

    await createPaystackRecipientIfNeeded({
      id: created.id,
      name: created.name,
      payoutMethod: created.payoutMethod,
      bankCountry: created.bankCountry,
      bankCode: created.bankCode,
      accountNumber: created.accountNumber,
      accountName: created.accountName,
      isPayoutEnabled: created.isPayoutEnabled,
      paystackRecipientCode: created.paystackRecipientCode,
    });

    res.status(201).json({ data: created });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "Failed to create supplier" });
  }
});

// PUT /api/admin/suppliers/:id
router.put("/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = requiredString(req.params.id);
    const {
      name,
      type,
      status,
      contactEmail,
      whatsappPhone,

      apiBaseUrl,
      apiAuthType,
      apiKey,

      payoutMethod,
      bankCountry,
      bankCode,
      bankName,
      accountNumber,
      accountName,
      isPayoutEnabled,
    } = req.body || {};

    const current = await prisma.supplier.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        payoutMethod: true,
        bankCountry: true,
        bankCode: true,
        bankName: true,
        accountNumber: true,
        accountName: true,
        isPayoutEnabled: true,
        paystackRecipientCode: true,
        bankVerificationStatus: true,
      },
    });

    if (!current) return res.status(404).json({ error: "Supplier not found" });

    const nextBank = {
      ...(bankCountry !== undefined ? { bankCountry: toUndef(bankCountry) ?? undefined } : {}),
      ...(bankCode !== undefined ? { bankCode: toUndef(bankCode) ?? undefined } : {}),
      ...(bankName !== undefined ? { bankName: toUndef(bankName) ?? undefined } : {}),
      ...(accountNumber !== undefined ? { accountNumber: toUndef(accountNumber) ?? undefined } : {}),
      ...(accountName !== undefined ? { accountName: toUndef(accountName) ?? undefined } : {}),
    };

    const bankPending = computeBankPendingPatch({
      current: {
        bankCountry: current.bankCountry,
        bankCode: current.bankCode,
        bankName: current.bankName,
        accountNumber: current.accountNumber,
        accountName: current.accountName,
        bankVerificationStatus: current.bankVerificationStatus as any,
      },
      next: nextBank as any,
    });

    if (current.bankVerificationStatus === "VERIFIED" && bankPending.changed) {
      return res.status(400).json({
        error: "Bank details are VERIFIED and cannot be edited. Reject/Unlock or change via a dedicated flow.",
      });
    }

    const updated = await prisma.supplier.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(type !== undefined ? { type: normSupplierType(type) } : {}),
        ...(status !== undefined ? { status: normStatus(status) } : {}),

        ...(contactEmail !== undefined ? { contactEmail: toNullablePatch(contactEmail) } : {}),
        ...(whatsappPhone !== undefined ? { whatsappPhone: toNullablePatch(whatsappPhone) } : {}),

        ...(apiBaseUrl !== undefined ? { apiBaseUrl: toNullablePatch(apiBaseUrl) } : {}),
        ...(apiAuthType !== undefined ? { apiAuthType: normAuth(apiAuthType) ?? "NONE" } : {}),
        ...(apiKey !== undefined ? { apiKey: toNullablePatch(apiKey) } : {}),

        ...(payoutMethod !== undefined ? { payoutMethod: normPayoutMethod(payoutMethod) } : {}),
        ...nextBank,
        ...(isPayoutEnabled !== undefined ? { isPayoutEnabled: toBool(isPayoutEnabled) } : {}),

        ...(bankPending.changed ? bankPending.patch : {}),
      },
    });

    await createPaystackRecipientIfNeeded({
      id: updated.id,
      name: updated.name,
      payoutMethod: updated.payoutMethod,
      bankCountry: updated.bankCountry,
      bankCode: updated.bankCode,
      accountNumber: updated.accountNumber,
      accountName: updated.accountName,
      isPayoutEnabled: updated.isPayoutEnabled,
      paystackRecipientCode: updated.paystackRecipientCode,
    });

    res.json({ data: updated });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "Failed to update supplier" });
  }
});

// DELETE /api/admin/suppliers/:id
router.delete("/:id", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const id = requiredString(req.params.id);

    const usage = await supplierUsageCounts(id);

    const inUse =
      usage.productOffers > 0 ||
      usage.variantOffers > 0 ||
      usage.purchaseOrders > 0 ||
      usage.chosenOrderItems > 0;

    if (inUse) {
      return res.status(400).json({
        error: "Cannot delete supplier: supplier has business records",
        details: usage,
      });
    }

    await prisma.supplier.delete({ where: { id } });

    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "Failed to delete supplier" });
  }
});


router.post("/:id/archive", requireSuperAdmin, async (req, res) => {
  try {
    const id = requiredString(req.params.id);

    const updated = await prisma.supplier.update({
      where: { id },
      data: {
        status: "INACTIVE",
        isDeleted: true,
      },
    });

    res.json({ ok: true, data: updated });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "Failed to archive supplier" });
  }
});

// POST /api/admin/suppliers/:id/link-bank
router.post("/:id/link-bank", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const id = requiredString(req.params.id);
    const { supplierName, bankCode, accountNumber, bankName, country = "NG", currency = "NGN" } = req.body || {};

    if (!bankCode || !accountNumber) {
      return res.status(400).json({ error: "bankCode and accountNumber are required" });
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        bankVerificationStatus: true,
      },
    });
    if (!supplier) return res.status(404).json({ error: "Supplier not found" });

    if (supplier.bankVerificationStatus === "VERIFIED") {
      return res.status(400).json({ error: "Bank details are VERIFIED and cannot be changed." });
    }

    const { data: r } = await paystack.post(
      "/transferrecipient",
      {
        type: String(country).toUpperCase() === "NG" ? "nuban" : "bank_account",
        name: String(supplierName || supplier.name),
        account_number: String(accountNumber),
        bank_code: String(bankCode),
        currency: String(currency || "NGN"),
      },
      { timeout: 10000 } as any
    );

    const recipientCode = r?.data?.recipient_code || null;
    const resolvedAccountName = r?.data?.details?.account_name ?? null;

    const sup = await prisma.supplier.update({
      where: { id },
      data: {
        bankCountry: String(country || "NG"),
        bankCode: String(bankCode),
        bankName: toNull(bankName),
        accountNumber: String(accountNumber),
        accountName: resolvedAccountName,
        paystackRecipientCode: recipientCode,
        payoutMethod: "TRANSFER",
        isPayoutEnabled: true,

        bankVerificationStatus: "PENDING",
        bankVerificationRequestedAt: new Date(),
        bankVerifiedAt: null,
        bankVerifiedById: null,
        bankVerificationNote: null,
      },
    });

    res.json({ ok: true, supplier: sup });
  } catch (e: any) {
    console.error("link-bank failed:", e?.response?.status, e?.response?.data || e?.message);
    res.status(400).json({ error: e?.message || "Failed to link bank" });
  }
});

// POST /api/admin/suppliers/:id/bank-verify
router.post("/:id/bank-verify", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const supplierId = requiredString(req.params.id);

    const body = z
      .object({
        decision: z.enum(["VERIFIED", "REJECTED"]),
        note: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});

    const adminId = (req as any)?.user?.id ?? null;

    const current = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        name: true,
        payoutMethod: true,
        bankCountry: true,
        bankCode: true,
        bankName: true,
        accountNumber: true,
        accountName: true,
        isPayoutEnabled: true,
        paystackRecipientCode: true,
        bankVerificationStatus: true,
      },
    });

    if (!current) return res.status(404).json({ error: "Supplier not found" });

    if (body.decision === "VERIFIED") {
      if (!current.bankCode || !current.accountNumber) {
        return res.status(400).json({
          error: "Cannot verify bank details: bankCode and accountNumber are required.",
        });
      }
    }

    const updated = await prisma.supplier.update({
      where: { id: supplierId },
      data:
        body.decision === "VERIFIED"
          ? {
            bankVerificationStatus: "VERIFIED",
            bankVerifiedAt: new Date(),
            bankVerifiedById: adminId,
            bankVerificationNote: body.note ?? null,

            isPayoutEnabled: true,

            ...(current.payoutMethod ? {} : { payoutMethod: "TRANSFER" }),
          }
          : {
            bankVerificationStatus: "REJECTED",
            bankVerifiedAt: null,
            bankVerifiedById: null,
            bankVerificationNote: body.note ?? "Rejected",
          },

      select: {
        id: true,
        name: true,

        payoutMethod: true,
        bankCountry: true,
        bankCode: true,
        accountNumber: true,
        accountName: true,
        isPayoutEnabled: true,
        paystackRecipientCode: true,

        bankVerificationStatus: true,
        bankVerificationNote: true,
        bankVerificationRequestedAt: true,
        bankVerifiedAt: true,
        bankVerifiedById: true,
      },
    });

    if (body.decision === "VERIFIED") {
      await createPaystackRecipientIfNeeded({
        id: updated.id,
        name: updated.name,
        payoutMethod: updated.payoutMethod,
        bankCountry: updated.bankCountry,
        bankCode: updated.bankCode,
        accountNumber: updated.accountNumber,
        accountName: updated.accountName,
        isPayoutEnabled: updated.isPayoutEnabled,
        paystackRecipientCode: updated.paystackRecipientCode,
      });
    }

    return res.json({ ok: true, data: updated });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to verify bank details" });
  }
});

/**
 * POST /api/admin/suppliers/:id/ledger-adjust
 * Manual adjustment (CREDIT/DEBIT)
 * Body:
 * - type: CREDIT|DEBIT
 * - amount: number (positive)
 * - currency?: string (default NGN)
 * - note?: string
 * - referenceType?: string (default MANUAL)
 * - referenceId?: string | null
 */
router.post("/:id/ledger-adjust", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const supplierId = requiredString(req.params.id || "").trim();
    if (!supplierId) return res.status(400).json({ error: "Missing supplier id" });

    const adminId = (req as any)?.user?.id ?? null;

    const body = z
      .object({
        type: z.enum(["CREDIT", "DEBIT"]),
        amount: z.union([z.number(), z.string()]),
        currency: z.string().min(1).optional(),
        note: z.string().max(500).optional(),
        referenceType: z.string().max(60).optional(),
        referenceId: z.string().max(200).nullable().optional(),
      })
      .parse(req.body ?? {});

    const amountNum = Number(body.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true },
    });
    if (!supplier) return res.status(404).json({ error: "Supplier not found" });

    const entry = await prisma.supplierLedgerEntry.create({
      data: {
        supplierId,
        type: body.type,
        amount: new Prisma.Decimal(amountNum),
        currency: (body.currency || "NGN").toUpperCase(),
        referenceType: (body.referenceType || "MANUAL").toUpperCase(),
        referenceId: body.referenceId ?? null,
        meta: {
          manual: true,
          note: body.note ?? null,
          adminId,
          supplierName: supplier.name,
        },
      },
      include: {
        supplier: { select: { id: true, name: true } },
      },
    });

    return res.json({ ok: true, data: entry });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to post ledger adjustment" });
  }
});

export default router;