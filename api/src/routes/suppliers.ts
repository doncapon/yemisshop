// api/src/routes/suppliers.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import jwt from "jsonwebtoken";
import {
  fetchCacBasic,
  type CacCompanyType as DojahCompanyType,
} from "../lib/dojahClient.js";
import { requireAuth, requireSupplier } from "../middleware/auth.js";

const router = Router();

const CacCompanyTypeEnum = z.enum([
  "BUSINESS_NAME",
  "COMPANY",
  "INCORPORATED_TRUSTEES",
  "LIMITED_PARTNERSHIP",
  "LIMITED_LIABILITY_PARTNERSHIP",
]);

type CacCompanyType = z.infer<typeof CacCompanyTypeEnum>;

type CacEntity = {
  company_name: string;
  rc_number: string;
  address?: string | null;
  state?: string | null;
  city?: string | null;
  lga?: string | null;
  email?: string | null;
  type_of_company: CacCompanyType;
  date_of_registration?: string | null;
  nature_of_business?: string | null;
  share_capital?: number | null;
  share_details?: unknown;
};

const KYC_TICKET_SECRET =
  process.env.KYC_TICKET_SECRET || "CHANGE_ME_KYC_TICKET_SECRET";
const TICKET_TTL_SEC = 10 * 60; // 10 minutes
const MISMATCH_COOLDOWN_SEC = 60; // slow brute-force guessing
const NOTFOUND_COOLDOWN_HOURS = 24;

/* ------------------------------ helpers -------------------------------- */

const norm = (s: any) => String(s ?? "").trim().toLowerCase();
const digits = (s: any) => String(s ?? "").replace(/\D/g, "");

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function ymdFromParts(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function normalizeDateToYMD(raw?: string | null): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // already ISO-ish
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // dd/mm/yyyy or mm/dd/yyyy
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = Number(slash[3]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(y))
      return null;

    // heuristic: if first part > 12, it's day/month
    let day = b;
    let month = a;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return ymdFromParts(y, month, day);
  }

  // fallback parse
  try {
    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) return null;
    return ymdFromParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  } catch {
    return null;
  }
}

function matchesAllFour(
  entity: CacEntity,
  input: {
    rcNumber: string;
    companyType: string;
    companyName: string;
    regDate: string;
  }
) {
  const rcOk =
    digits(input.rcNumber) !== "" &&
    digits(input.rcNumber) === digits(entity.rc_number);

  const typeOk =
    String(input.companyType).trim().toUpperCase() ===
    String(entity.type_of_company).trim().toUpperCase();

  const nameOk =
    norm(input.companyName) !== "" &&
    norm(input.companyName) === norm(entity.company_name);

  const entryDate = normalizeDateToYMD(entity.date_of_registration);
  const uiDate = String(input.regDate || "").trim();
  const dateOk = !!uiDate && !!entryDate && entryDate === uiDate;

  return rcOk && typeOk && nameOk && dateOk;
}

function signTicket(payload: {
  rcNumber: string;
  companyType: CacCompanyType;
  companyNameNorm: string;
  regDateYmd: string;
}) {
  return jwt.sign({ k: "cac-verify", ...payload }, KYC_TICKET_SECRET, {
    expiresIn: TICKET_TTL_SEC,
  });
}

/* ---------------- Supplier identity endpoints ----------------
   Frontend tries:
   /api/supplier/me
   /api/supplier/profile
   /api/supplier/dashboard
--------------------------------------------------------------- */

async function getSupplierForUser(userId: string) {
  return prisma.supplier.findFirst({
    where: { userId },
    select: { id: true, name: true, status: true },
  });
}

function supplierPayload(s: { id: string; name: string; status: any }) {
  return {
    supplierId: s.id,
    supplierName: s.name,
    status: s.status,
    supplier: { id: s.id, name: s.name, status: s.status },
    id: s.id,
    name: s.name,
  };
}

function getUserId(req: any): string | null {
  return req?.user?.id || req?.auth?.userId || req?.userId || null;
}

// What the frontend expects (SupplierMeDto)
// ✅ FIX: include bankCountry/bankCode + verification fields
function toSupplierMeDto(s: any) {
  return {
    id: s.id,
    name: s.name,

    contactEmail: s.contactEmail ?? null,
    whatsappPhone: s.whatsappPhone ?? null,
    rcNumber: s.rcNumber ?? null,

    bankCountry: s.bankCountry ?? null,
    bankCode: s.bankCode ?? null,
    bankName: s.bankName ?? null,
    accountName: s.accountName ?? null,
    accountNumber: s.accountNumber ?? null,

    bankVerificationStatus: s.bankVerificationStatus ?? null,
    bankVerificationNote: s.bankVerificationNote ?? null,
    bankVerificationRequestedAt:
      s.bankVerificationRequestedAt?.toISOString?.() ??
      s.bankVerificationRequestedAt ??
      null,
    bankVerifiedAt:
      s.bankVerifiedAt?.toISOString?.() ?? s.bankVerifiedAt ?? null,

    registeredAddress: s.registeredAddress
      ? {
          streetName: s.registeredAddress.streetName ?? null,
          town: s.registeredAddress.town ?? null,
          city: s.registeredAddress.city ?? null,
          state: s.registeredAddress.state ?? null,
          country: s.registeredAddress.country ?? null,
        }
      : null,
  };
}

/**
 * GET /api/supplier/me
 * Returns supplier profile for the authenticated supplier user
 */
router.get("/me", requireAuth, async (req, res) => {

  const role = req.user?.role;
  const userId = req.user?.id;
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  let supplierId: string | null = null;
  if (isAdmin) supplierId = String(req.query?.supplierId ?? "").trim() || null;
  else supplierId = (await prisma.supplier.findFirst({ where: { userId }, select: { id: true } }))?.id ?? null;

  if (!supplierId) return res.status(403).json({ error: "Supplier access required" });
  const supplier = await prisma.supplier.findFirst({
  where: { id: supplierId }, 
    select: {
      id: true,
      name: true,
      contactEmail: true,
      whatsappPhone: true,
      rcNumber: true,

      bankCountry: true,
      bankCode: true,
      bankName: true,
      accountNumber: true,
      accountName: true,

      bankVerificationStatus: true,
      bankVerificationNote: true,
      bankVerificationRequestedAt: true,
      bankVerifiedAt: true,

      registeredAddress: {
        select: {
          streetName: true,
          town: true,
          city: true,
          state: true,
          country: true,
        },
      },
    },
  });

  return res.json({ data: toSupplierMeDto(supplier) });
});

const UpdateSupplierMeSchema = z
  .object({
    contactEmail: z.string().email().nullable().optional(),
    whatsappPhone: z.string().nullable().optional(),

    bankCountry: z.string().nullable().optional(),
    bankName: z.string().nullable().optional(),
    bankCode: z.string().nullable().optional(), // ✅ IMPORTANT
    accountNumber: z.string().nullable().optional(),
    accountName: z.string().nullable().optional(),
  })
  .partial();

/**
 * PUT /api/supplier/me
 * Updates ONLY editable supplier settings (support + payout)
 * Does NOT allow business name / CAC address edits.
 */
router.put("/me", requireAuth, requireSupplier, async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: "Unauthenticated" });

  let parsed: z.infer<typeof UpdateSupplierMeSchema>;
  try {
    parsed = UpdateSupplierMeSchema.parse(req.body ?? {});
  } catch (e: any) {
    return res
      .status(400)
      .json({ error: "Invalid payload", details: e?.errors ?? e });
  }

  const supplier = await prisma.supplier.findFirst({
    where: { userId: uid },
    select: {
      id: true,

      // current bank snapshot (needed to detect changes)
      bankCountry: true,
      bankCode: true,
      bankName: true,
      accountNumber: true,
      accountName: true,

      bankVerificationStatus: true,
      bankVerificationRequestedAt: true,
      bankVerifiedAt: true,
      bankVerifiedById: true,
      bankVerificationNote: true,
    },
  });

  if (!supplier) return res.status(404).json({ error: "Supplier not found" });

  // Build update payload (only allow fields that are present)
  const data: any = {};

  // contact fields
  if ("contactEmail" in parsed) data.contactEmail = parsed.contactEmail ?? null;
  if ("whatsappPhone" in parsed) data.whatsappPhone = parsed.whatsappPhone ?? null;

  // --- Bank fields supplier can submit (admin must verify) ---
  // Compute "next" bank snapshot = (incoming if present) else (current)
  const nextBankCountry =
    "bankCountry" in parsed ? (parsed as any).bankCountry ?? null : supplier.bankCountry ?? null;

  const nextBankCode =
    "bankCode" in parsed ? (parsed as any).bankCode ?? null : supplier.bankCode ?? null;

  const nextBankName =
    "bankName" in parsed ? (parsed as any).bankName ?? null : supplier.bankName ?? null;

  const nextAccountNumber =
    "accountNumber" in parsed ? (parsed as any).accountNumber ?? null : supplier.accountNumber ?? null;

  const nextAccountName =
    "accountName" in parsed ? (parsed as any).accountName ?? null : supplier.accountName ?? null;

  // Apply bank changes only if field was included in payload
  if ("bankCountry" in parsed) data.bankCountry = nextBankCountry;
  if ("bankCode" in parsed) data.bankCode = nextBankCode; // ✅ ensure it persists
  if ("bankName" in parsed) data.bankName = nextBankName;
  if ("accountNumber" in parsed) data.accountNumber = nextAccountNumber;
  if ("accountName" in parsed) data.accountName = nextAccountName;

  // Detect whether any bank detail changed (only for fields included)
  const bankChanged =
    ("bankCountry" in parsed && (supplier.bankCountry ?? null) !== (nextBankCountry ?? null)) ||
    ("bankCode" in parsed && (supplier.bankCode ?? null) !== (nextBankCode ?? null)) ||
    ("bankName" in parsed && (supplier.bankName ?? null) !== (nextBankName ?? null)) ||
    ("accountNumber" in parsed && (supplier.accountNumber ?? null) !== (nextAccountNumber ?? null)) ||
    ("accountName" in parsed && (supplier.accountName ?? null) !== (nextAccountName ?? null));

  // Core fields required to verify
  const hasCoreBankDetails =
    !!(nextBankCode && String(nextBankCode).trim()) &&
    !!(nextAccountNumber && String(nextAccountNumber).trim());

  // If bank changed:
  // - If they now have bank details -> request verification (PENDING)
  // - If they cleared core details -> revert to UNVERIFIED
  if (bankChanged) {
    if (hasCoreBankDetails) {
      data.bankVerificationStatus = "PENDING";
      data.bankVerificationRequestedAt = new Date();

      // clear previous verification result so admin must decide again
      data.bankVerifiedAt = null;
      data.bankVerifiedById = null;
      data.bankVerificationNote = null;
    } else {
      data.bankVerificationStatus = "UNVERIFIED";
      data.bankVerificationRequestedAt = null;
      data.bankVerifiedAt = null;
      data.bankVerifiedById = null;
      data.bankVerificationNote = null;
    }
  }

  const updated = await prisma.supplier.update({
    where: { id: supplier.id },
    data,
    select: {
      id: true,
      name: true,
      contactEmail: true,
      whatsappPhone: true,
      rcNumber: true,

      bankCountry: true,
      bankCode: true,
      bankName: true,
      accountNumber: true,
      accountName: true,

      bankVerificationStatus: true,
      bankVerificationNote: true,
      bankVerificationRequestedAt: true,
      bankVerifiedAt: true,

      registeredAddress: {
        select: {
          streetName: true,
          town: true,
          city: true,
          state: true,
          country: true,
        },
      },
    },
  });

  return res.json({ data: toSupplierMeDto(updated) });
});

router.get("/profile", requireAuth, requireSupplier, async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: "Unauthenticated" });

  const s = await getSupplierForUser(uid);
  if (!s) return res.status(404).json({ error: "Supplier not found" });

  return res.json({ data: supplierPayload(s) });
});

router.get("/dashboard", requireAuth, requireSupplier, async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: "Unauthenticated" });

  const s = await getSupplierForUser(uid);
  if (!s) return res.status(404).json({ error: "Supplier not found" });

  return res.json({ data: supplierPayload(s) });
});

/* --------------------------- GET /cac-status --------------------------- */
/**
 * Safe status endpoint (NO entity leakage)
 * GET /api/suppliers/cac-status?rc_number=...&company_type=...
 */
router.get("/cac-status", async (req, res, next) => {
  try {
    const q = z
      .object({
        rc_number: z.string().min(1),
        company_type: CacCompanyTypeEnum,
      })
      .parse(req.query);

    const row = await prisma.cacLookup.findUnique({
      where: {
        CacLookup_rc_companyType_key: {
          rcNumber: q.rc_number,
          companyType: q.company_type,
        },
      },
      select: { outcome: true, retryAt: true, checkedAt: true },
    });

    if (!row) return res.json({ status: "NONE" as const });

    const now = new Date();
    if (row.retryAt && row.retryAt > now) {
      return res.json({
        status: "COOLDOWN" as const,
        retryAt: row.retryAt.toISOString(),
        checkedAt: row.checkedAt?.toISOString?.() ?? null,
      });
    }

    return res.json({
      status: row.outcome ?? "NONE",
      checkedAt: row.checkedAt?.toISOString?.() ?? null,
    });
  } catch (e) {
    next(e);
  }
});

/* --------------------------- POST /cac-verify --------------------------- */
/**
 * POST /api/suppliers/cac-verify
 * body: { rc_number, company_type, assertedCompanyName, assertedRegistrationDate }
 */
router.post("/cac-verify", async (req, res, next) => {
  try {
    const body = z
      .object({
        rc_number: z.string().min(1),
        company_type: CacCompanyTypeEnum,
        assertedCompanyName: z.string().min(1),
        assertedRegistrationDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
      })
      .parse(req.body);

    const rcNumber = body.rc_number.trim();
    const companyType = body.company_type;
    const assertedCompanyName = body.assertedCompanyName.trim();
    const assertedRegistrationDate = body.assertedRegistrationDate.trim();

    const now = new Date();

    const cached = await prisma.cacLookup.findUnique({
      where: {
        CacLookup_rc_companyType_key: { rcNumber, companyType },
      },
      select: { outcome: true, retryAt: true, checkedAt: true, entity: true },
    });

    // cooldown
    if (cached?.retryAt && cached.retryAt > now) {
      return res.json({
        status: "COOLDOWN" as const,
        retryAt: cached.retryAt.toISOString(),
      });
    }

    // cache hit (entity present) => no Dojah call
    if (cached?.entity) {
      const entity = cached.entity as any as CacEntity;

      const ok = matchesAllFour(entity, {
        rcNumber,
        companyType,
        companyName: assertedCompanyName,
        regDate: assertedRegistrationDate,
      });

      if (!ok) {
        const retryAt = new Date(Date.now() + MISMATCH_COOLDOWN_SEC * 1000);

        await prisma.cacLookup.update({
          where: { CacLookup_rc_companyType_key: { rcNumber, companyType } },
          data: { retryAt, checkedAt: now },
        });

        return res.json({
          status: "MISMATCH" as const,
          retryAt: retryAt.toISOString(),
        });
      }

      // ✅ CAC matches – check if a supplier already exists for this RC/companyType
      const existingSupplier = await prisma.supplier.findFirst({
        where: {
          rcNumber,
          companyType, // assumes supplier.companyType uses same enum
        },
        select: { id: true, status: true },
      });

      if (existingSupplier) {
        return res.json({
          status: "SUPPLIER_EXISTS" as const,
          supplierId: existingSupplier.id,
          entity,
          message:
            "A supplier with this RC number is already registered on DaySpring. Please sign in instead.",
        });
      }

      const ticket = signTicket({
        rcNumber,
        companyType,
        companyNameNorm: norm(assertedCompanyName),
        regDateYmd: assertedRegistrationDate,
      });

      return res.json({
        status: "VERIFIED" as const,
        verificationTicket: ticket,
        entity,
      });
    }

    // no cache -> call Dojah once
    try {
      const r = await fetchCacBasic({
        rc_number: rcNumber,
        company_type: companyType as unknown as DojahCompanyType,
      });

      const entity = r?.entity as any as CacEntity | undefined;

      if (!entity) {
        const retryAt = new Date(
          Date.now() + NOTFOUND_COOLDOWN_HOURS * 3600 * 1000
        );

        await prisma.cacLookup.upsert({
          where: { CacLookup_rc_companyType_key: { rcNumber, companyType } },
          update: {
            outcome: "NOT_FOUND",
            checkedAt: now,
            retryAt,
            entity: null as any,
          },
          create: {
            rcNumber,
            companyType,
            outcome: "NOT_FOUND",
            checkedAt: now,
            retryAt,
            entity: null as any,
          },
        });

        return res.json({
          status: "NOT_FOUND" as const,
          retryAt: retryAt.toISOString(),
        });
      }

      // cache entity
      await prisma.cacLookup.upsert({
        where: { CacLookup_rc_companyType_key: { rcNumber, companyType } },
        update: {
          outcome: "OK",
          entity: entity as any,
          checkedAt: now,
          retryAt: null,
        },
        create: {
          rcNumber,
          companyType,
          outcome: "OK",
          entity: entity as any,
          checkedAt: now,
          retryAt: null,
        },
      });

      const ok = matchesAllFour(entity, {
        rcNumber,
        companyType,
        companyName: assertedCompanyName,
        regDate: assertedRegistrationDate,
      });

      if (!ok) {
        const retryAt = new Date(Date.now() + MISMATCH_COOLDOWN_SEC * 1000);

        await prisma.cacLookup.update({
          where: { CacLookup_rc_companyType_key: { rcNumber, companyType } },
          data: { retryAt, checkedAt: now },
        });

        return res.json({
          status: "MISMATCH" as const,
          retryAt: retryAt.toISOString(),
        });
      }

      // ✅ CAC matches – check if supplier already exists
      const existingSupplier = await prisma.supplier.findFirst({
        where: {
          rcNumber,
          companyType,
        },
        select: { id: true, status: true },
      });

      if (existingSupplier) {
        return res.json({
          status: "SUPPLIER_EXISTS" as const,
          supplierId: existingSupplier.id,
          entity,
          message:
            "A supplier with this RC number is already registered on DaySpring. Please sign in instead.",
        });
      }

      const ticket = signTicket({
        rcNumber,
        companyType,
        companyNameNorm: norm(assertedCompanyName),
        regDateYmd: assertedRegistrationDate,
      });

      return res.json({
        status: "VERIFIED" as const,
        verificationTicket: ticket,
        entity,
      });
    } catch (e: any) {
      const status = e?.response?.status;

      if (status === 404 || status === 422) {
        const retryAt = new Date(
          Date.now() + NOTFOUND_COOLDOWN_HOURS * 3600 * 1000
        );

        await prisma.cacLookup.upsert({
          where: { CacLookup_rc_companyType_key: { rcNumber, companyType } },
          update: {
            outcome: "NOT_FOUND",
            checkedAt: now,
            retryAt,
            entity: null as any,
          },
          create: {
            rcNumber,
            companyType,
            outcome: "NOT_FOUND",
            checkedAt: now,
            retryAt,
            entity: null as any,
          },
        });

        return res.json({
          status: "NOT_FOUND" as const,
          retryAt: retryAt.toISOString(),
        });
      }

      return res.json({
        status: "PROVIDER_ERROR" as const,
        message: "CAC provider failed. Please try again.",
      });
    }
  } catch (e) {
    next(e);
  }
});


/* --------------------------- POST /cac-cache --------------------------- */
/**
 * Compatibility endpoint: store lookup cache only.
 */
router.post("/cac-cache", async (req, res, next) => {
  try {
    const body = z
      .object({
        rcNumber: z.string().min(1),
        companyType: CacCompanyTypeEnum,
        entity: z.any(),
        provider: z.string().default("DOJAH").optional(),
      })
      .parse(req.body);

    const now = new Date();

    await prisma.cacLookup.upsert({
      where: {
        CacLookup_rc_companyType_key: {
          rcNumber: body.rcNumber,
          companyType: body.companyType,
        },
      },
      update: { outcome: "OK", entity: body.entity as any, checkedAt: now, retryAt: null },
      create: { rcNumber: body.rcNumber, companyType: body.companyType, outcome: "OK", entity: body.entity as any, checkedAt: now, retryAt: null },
    });

    return res.status(201).json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
