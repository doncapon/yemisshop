import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import { requireAuth, requireSupplier } from "../middleware/auth.js";
import { SupplierShippingCoverage } from "@prisma/client";

const router = Router();

/* ---------------- Supplier identity endpoints ---------------- */

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
    businessName: null,
  };
}

function getUserId(req: any): string | null {
  return req?.user?.id || req?.auth?.userId || req?.userId || null;
}

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

function cleanString(v: any): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function cleanBool(v: any): boolean | undefined {
  if (v === undefined) return undefined;
  return !!v;
}

function norm(v: any) {
  return String(v ?? "").trim();
}

function sameDate(a: any, b: any) {
  const aa = a ? new Date(a) : null;
  const bb = b ? new Date(b) : null;
  const av = aa && !Number.isNaN(+aa) ? aa.toISOString().slice(0, 10) : "";
  const bv = bb && !Number.isNaN(+bb) ? bb.toISOString().slice(0, 10) : "";
  return av === bv;
}

const AddressInputSchema = z
  .object({
    houseNumber: z.string().nullable().optional(),
    streetName: z.string().nullable().optional(),
    postCode: z.string().nullable().optional(),
    town: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    lga: z.string().nullable().optional(),
    directionsNote: z.string().nullable().optional(),
    landmark: z.string().nullable().optional(),
  })
  .strict();

type NormalizedAddressInput = {
  houseNumber?: string | null;
  streetName?: string | null;
  postCode?: string | null;
  town?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  lga?: string | null;
  directionsNote?: string | null;
  landmark?: string | null;
};

function normalizeAddressInput(
  input?: z.infer<typeof AddressInputSchema> | null
): NormalizedAddressInput | undefined {
  if (input === undefined || input === null) return undefined;

  return {
    houseNumber: cleanString(input.houseNumber),
    streetName: cleanString(input.streetName),
    postCode: cleanString(input.postCode),
    town: cleanString(input.town),
    city: cleanString(input.city),
    state: cleanString(input.state),
    country: cleanString(input.country),
    lga: cleanString(input.lga),
    directionsNote: cleanString(input.directionsNote),
    landmark: cleanString(input.landmark),
  };
}

function addressHasAnyValue(addr: NormalizedAddressInput | undefined) {
  if (!addr) return false;
  return Boolean(
    addr.houseNumber ||
      addr.streetName ||
      addr.postCode ||
      addr.town ||
      addr.city ||
      addr.state ||
      addr.country ||
      addr.lga ||
      addr.directionsNote ||
      addr.landmark
  );
}

function addressSnapshot(addr: any) {
  return {
    houseNumber: norm(addr?.houseNumber),
    streetName: norm(addr?.streetName),
    postCode: norm(addr?.postCode),
    town: norm(addr?.town),
    city: norm(addr?.city),
    state: norm(addr?.state),
    country: norm(addr?.country),
    lga: norm(addr?.lga),
    landmark: norm(addr?.landmark),
    directionsNote: norm(addr?.directionsNote),
  };
}

function sameAddress(a: any, b: any) {
  const aa = addressSnapshot(a);
  const bb = addressSnapshot(b);
  return (
    aa.houseNumber === bb.houseNumber &&
    aa.streetName === bb.streetName &&
    aa.postCode === bb.postCode &&
    aa.town === bb.town &&
    aa.city === bb.city &&
    aa.state === bb.state &&
    aa.country === bb.country &&
    aa.lga === bb.lga &&
    aa.landmark === bb.landmark &&
    aa.directionsNote === bb.directionsNote
  );
}

function collectSensitiveSupplierChanges(existing: any, incoming: any) {
  const changed: string[] = [];

  if (norm(existing?.legalName) !== norm(incoming?.legalName)) changed.push("legalName");
  if (norm(existing?.registeredBusinessName) !== norm(incoming?.registeredBusinessName)) {
    changed.push("registeredBusinessName");
  }
  if (norm(existing?.registrationNumber) !== norm(incoming?.registrationNumber)) {
    changed.push("registrationNumber");
  }
  if (norm(existing?.registrationType) !== norm(incoming?.registrationType)) {
    changed.push("registrationType");
  }
  if (!sameDate(existing?.registrationDate, incoming?.registrationDate)) {
    changed.push("registrationDate");
  }
  if (norm(existing?.registrationCountryCode) !== norm(incoming?.registrationCountryCode)) {
    changed.push("registrationCountryCode");
  }
  if (norm(existing?.registryAuthorityId) !== norm(incoming?.registryAuthorityId)) {
    changed.push("registryAuthorityId");
  }
  if (norm(existing?.natureOfBusiness) !== norm(incoming?.natureOfBusiness)) {
    changed.push("natureOfBusiness");
  }

  if (!sameAddress(existing?.registeredAddress, incoming?.registeredAddress)) {
    changed.push("registeredAddress");
  }
  if (!sameAddress(existing?.pickupAddress, incoming?.pickupAddress)) {
    changed.push("pickupAddress");
  }

  if (norm(existing?.bankCountry) !== norm(incoming?.bankCountry)) changed.push("bankCountry");
  if (norm(existing?.bankCode) !== norm(incoming?.bankCode)) changed.push("bankCode");
  if (norm(existing?.bankName) !== norm(incoming?.bankName)) changed.push("bankName");
  if (norm(existing?.accountNumber) !== norm(incoming?.accountNumber)) changed.push("accountNumber");
  if (norm(existing?.accountName) !== norm(incoming?.accountName)) changed.push("accountName");

  return changed;
}

function hasBankSensitiveChange(changed: string[]) {
  return changed.some((k) =>
    ["bankCountry", "bankCode", "bankName", "accountNumber", "accountName"].includes(k)
  );
}

function maskAccountNumberForActivityLog(v: any) {
  const s = String(v ?? "").replace(/\D/g, "");
  if (s.length <= 4) return s;
  return `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

/* ---------------- Supplier DTO ---------------- */

function toSupplierMeDto(s: any) {
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

    pickupContactName: s.pickupContactName ?? null,
    pickupContactPhone: s.pickupContactPhone ?? null,
    pickupInstructions: s.pickupInstructions ?? null,
    shippingEnabled: s.shippingEnabled ?? null,
    shippingCoverage: s.shippingCoverage ?? null,

    registeredAddress: s.registeredAddress ?? null,
    pickupAddress: s.pickupAddress ?? null,

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
          emailVerifiedAt: s.user.emailVerifiedAt ?? null,
          phoneVerifiedAt: s.user.phoneVerifiedAt ?? null,
        }
      : null,

    firstName: s.user?.firstName ?? null,
    lastName: s.user?.lastName ?? null,
    contactFirstName: s.user?.firstName ?? null,
    contactLastName: s.user?.lastName ?? null,

    emailVerifiedAt: s.user?.emailVerifiedAt ?? null,
    phoneVerifiedAt: s.user?.phoneVerifiedAt ?? null,
  };
}

/* ---------------- Shared select ---------------- */

const supplierMeSelect = {
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

  pickupContactName: true,
  pickupContactPhone: true,
  pickupInstructions: true,
  shippingEnabled: true,
  shippingCoverage: true,

  registeredAddressId: true,
  pickupAddressId: true,
  registeredAddress: true,
  pickupAddress: true,

  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
    },
  },
} as const;

/* ---------------- GET /api/supplier/me ---------------- */

router.get("/me", requireAuth, async (req, res) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;

    const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

    let supplierId: string | null = null;

    if (isAdmin) {
      supplierId = String(req.query?.supplierId ?? "").trim() || null;
    } else {
      const s = await prisma.supplier.findFirst({
        where: { userId },
        select: { id: true },
      });

      supplierId = s?.id ?? null;
    }

    if (!supplierId) {
      return res.status(403).json({ error: "Supplier access required" });
    }

    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId },
      select: supplierMeSelect,
    });

    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    return res.json({ data: toSupplierMeDto(supplier) });
  } catch (e: any) {
    console.error("[GET /api/supplier/me] failed:", e);
    return res.status(500).json({
      error: e?.message || "Could not load supplier profile.",
    });
  }
});

/* ---------------- PUT /api/supplier/me ---------------- */

const yyyyMmDd = /^\d{4}-\d{2}-\d{2}$/;

const UpdateSupplierMeSchema = z
  .object({
    businessName: z.string().nullable().optional(),
    supplierType: z.string().nullable().optional(),
    contactPhone: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    contactFirstName: z.string().nullable().optional(),
    contactLastName: z.string().nullable().optional(),

    name: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    contactEmail: z.string().email().nullable().optional(),
    whatsappPhone: z.string().nullable().optional(),

    legalName: z.string().nullable().optional(),
    registeredBusinessName: z.string().nullable().optional(),
    registrationNumber: z.string().nullable().optional(),
    registrationType: z.string().nullable().optional(),

    registrationDate: z.string().regex(yyyyMmDd).nullable().optional(),
    registrationCountryCode: z.string().nullable().optional(),
    registryAuthorityId: z.string().nullable().optional(),

    natureOfBusiness: z.string().nullable().optional(),

    bankCountry: z.string().nullable().optional(),
    bankName: z.string().nullable().optional(),
    bankCode: z.string().nullable().optional(),
    accountNumber: z.string().nullable().optional(),
    accountName: z.string().nullable().optional(),

    registeredAddress: AddressInputSchema.nullable().optional(),
    pickupAddress: AddressInputSchema.nullable().optional(),
    pickupContactName: z.string().nullable().optional(),
    pickupContactPhone: z.string().nullable().optional(),
    pickupInstructions: z.string().nullable().optional(),
    shippingEnabled: z.boolean().optional(),
    shippingCoverage: z.nativeEnum(SupplierShippingCoverage).optional(),

    // Onboarding-only controls for when bank verification actually starts:
    // - deferBankVerification: persist bank fields as a draft without
    //   flipping bankVerificationStatus to PENDING (so the step stays
    //   editable while the supplier is still on it).
    // - submitBankForVerification: explicitly transition to PENDING (used
    //   when the supplier advances past the bank step), regardless of
    //   whether any bank field actually changed in this same call.
    deferBankVerification: z.boolean().optional(),
    submitBankForVerification: z.boolean().optional(),
  })
  .strict();

router.put("/me", requireAuth, requireSupplier, async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    let parsed: z.infer<typeof UpdateSupplierMeSchema>;

    try {
      parsed = UpdateSupplierMeSchema.parse(req.body ?? {});
    } catch (e: any) {
      return res.status(400).json({ error: "Invalid payload", details: e.errors });
    }

    const supplier = await prisma.supplier.findFirst({
      where: { userId: uid },
      select: {
        id: true,
        userId: true,
        name: true,
        legalName: true,
        registeredBusinessName: true,
        registrationNumber: true,
        registrationType: true,
        registrationDate: true,
        registrationCountryCode: true,
        registryAuthorityId: true,
        natureOfBusiness: true,

        bankCountry: true,
        bankCode: true,
        bankName: true,
        accountNumber: true,
        accountName: true,
        bankVerificationStatus: true,

        status: true,
        kycStatus: true,
        kycApprovedAt: true,
        kycCheckedAt: true,
        kycRejectedAt: true,
        kycRejectionReason: true,

        registeredAddressId: true,
        pickupAddressId: true,
        registeredAddress: true,
        pickupAddress: true,
      },
    });

    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    const supplierData: any = {};
    const userData: any = {};

    const nextStoreName =
      cleanString(parsed.businessName) !== undefined
        ? cleanString(parsed.businessName)
        : cleanString(parsed.name);

    if (nextStoreName !== undefined) {
      supplierData.name = nextStoreName;
    }

    const nextType =
      cleanString(parsed.supplierType) !== undefined
        ? cleanString(parsed.supplierType)
        : cleanString(parsed.type);

    if (nextType !== undefined) {
      supplierData.type = nextType;
    }

    const nextContactEmail =
      cleanString(parsed.contactEmail) !== undefined
        ? cleanString(parsed.contactEmail)
        : cleanString(parsed.email);

    if (nextContactEmail !== undefined) {
      supplierData.contactEmail = nextContactEmail;
      userData.email = nextContactEmail;
    }

    const nextPhone =
      cleanString(parsed.contactPhone) !== undefined
        ? cleanString(parsed.contactPhone)
        : cleanString(parsed.whatsappPhone);

    if (nextPhone !== undefined) {
      supplierData.whatsappPhone = nextPhone;
      userData.phone = nextPhone;
    }

    if ("legalName" in parsed) {
      supplierData.legalName = cleanString(parsed.legalName);
    }

    if ("registeredBusinessName" in parsed) {
      supplierData.registeredBusinessName = cleanString(parsed.registeredBusinessName);
    }

    if ("registrationNumber" in parsed) {
      supplierData.registrationNumber = cleanString(parsed.registrationNumber);
    }

    if ("registrationType" in parsed) {
      supplierData.registrationType = cleanString(parsed.registrationType);
    }

    if ("registrationDate" in parsed) {
      supplierData.registrationDate = parsed.registrationDate
        ? new Date(parsed.registrationDate)
        : null;
    }

    if ("registrationCountryCode" in parsed) {
      supplierData.registrationCountryCode = cleanString(parsed.registrationCountryCode);
    }

    if ("registryAuthorityId" in parsed) {
      supplierData.registryAuthorityId = cleanString(parsed.registryAuthorityId);
    }

    if ("natureOfBusiness" in parsed) {
      supplierData.natureOfBusiness = cleanString(parsed.natureOfBusiness);
    }

    if ("bankCountry" in parsed) {
      supplierData.bankCountry = cleanString(parsed.bankCountry);
    }

    if ("bankCode" in parsed) {
      supplierData.bankCode = cleanString(parsed.bankCode);
    }

    if ("bankName" in parsed) {
      supplierData.bankName = cleanString(parsed.bankName);
    }

    if ("accountNumber" in parsed) {
      supplierData.accountNumber = cleanString(parsed.accountNumber);
    }

    if ("accountName" in parsed) {
      supplierData.accountName = cleanString(parsed.accountName);
    }

    if ("pickupContactName" in parsed) {
      supplierData.pickupContactName = cleanString(parsed.pickupContactName);
    }

    if ("pickupContactPhone" in parsed) {
      supplierData.pickupContactPhone = cleanString(parsed.pickupContactPhone);
    }

    if ("pickupInstructions" in parsed) {
      supplierData.pickupInstructions = cleanString(parsed.pickupInstructions);
    }

    if ("shippingEnabled" in parsed) {
      supplierData.shippingEnabled = cleanBool(parsed.shippingEnabled);
    }

    if ("shippingCoverage" in parsed) {
      supplierData.shippingCoverage = parsed.shippingCoverage;
    }

    const nextFirstName =
      cleanString(parsed.contactFirstName) !== undefined
        ? cleanString(parsed.contactFirstName)
        : cleanString(parsed.firstName);

    const nextLastName =
      cleanString(parsed.contactLastName) !== undefined
        ? cleanString(parsed.contactLastName)
        : cleanString(parsed.lastName);

    if (nextFirstName !== undefined) {
      userData.firstName = nextFirstName;
    }

    if (nextLastName !== undefined) {
      userData.lastName = nextLastName;
    }

    const registeredAddressInput = normalizeAddressInput(parsed.registeredAddress);
    const pickupAddressInput = normalizeAddressInput(parsed.pickupAddress);

    const incomingSnapshot = {
      legalName:
        "legalName" in parsed ? cleanString(parsed.legalName) : supplier.legalName,
      registeredBusinessName:
        "registeredBusinessName" in parsed
          ? cleanString(parsed.registeredBusinessName)
          : supplier.registeredBusinessName,
      registrationNumber:
        "registrationNumber" in parsed
          ? cleanString(parsed.registrationNumber)
          : supplier.registrationNumber,
      registrationType:
        "registrationType" in parsed
          ? cleanString(parsed.registrationType)
          : supplier.registrationType,
      registrationDate:
        "registrationDate" in parsed
          ? parsed.registrationDate || null
          : supplier.registrationDate,
      registrationCountryCode:
        "registrationCountryCode" in parsed
          ? cleanString(parsed.registrationCountryCode)
          : supplier.registrationCountryCode,
      registryAuthorityId:
        "registryAuthorityId" in parsed
          ? cleanString(parsed.registryAuthorityId)
          : supplier.registryAuthorityId,
      natureOfBusiness:
        "natureOfBusiness" in parsed
          ? cleanString(parsed.natureOfBusiness)
          : supplier.natureOfBusiness,

      bankCountry:
        "bankCountry" in parsed ? cleanString(parsed.bankCountry) : supplier.bankCountry,
      bankCode:
        "bankCode" in parsed ? cleanString(parsed.bankCode) : supplier.bankCode,
      bankName:
        "bankName" in parsed ? cleanString(parsed.bankName) : supplier.bankName,
      accountNumber:
        "accountNumber" in parsed
          ? cleanString(parsed.accountNumber)
          : supplier.accountNumber,
      accountName:
        "accountName" in parsed ? cleanString(parsed.accountName) : supplier.accountName,

      registeredAddress:
        registeredAddressInput !== undefined
          ? registeredAddressInput
          : supplier.registeredAddress,
      pickupAddress:
        pickupAddressInput !== undefined ? pickupAddressInput : supplier.pickupAddress,
    };

    const sensitiveChanged = collectSensitiveSupplierChanges(supplier, incomingSnapshot);
    const shouldResetKyc = sensitiveChanged.length > 0;
    const bankFieldsChanged = hasBankSensitiveChange(sensitiveChanged);
    const shouldResetBankVerification =
      parsed.submitBankForVerification === true
        ? true
        : parsed.deferBankVerification === true
          ? false
          : bankFieldsChanged;

    await prisma.$transaction(async (tx) => {
      let nextRegisteredAddressId = supplier.registeredAddressId ?? null;
      let nextPickupAddressId = supplier.pickupAddressId ?? null;

      if (registeredAddressInput !== undefined) {
        if (addressHasAnyValue(registeredAddressInput)) {
          if (nextRegisteredAddressId) {
            await tx.address.update({
              where: { id: nextRegisteredAddressId },
              data: registeredAddressInput,
            });
          } else {
            const created = await tx.address.create({
              data: registeredAddressInput,
              select: { id: true },
            });
            nextRegisteredAddressId = created.id;
          }
        } else {
          nextRegisteredAddressId = null;
        }
      }

      if (pickupAddressInput !== undefined) {
        if (addressHasAnyValue(pickupAddressInput)) {
          if (nextPickupAddressId) {
            await tx.address.update({
              where: { id: nextPickupAddressId },
              data: pickupAddressInput,
            });
          } else {
            const created = await tx.address.create({
              data: pickupAddressInput,
              select: { id: true },
            });
            nextPickupAddressId = created.id;
          }
        } else {
          nextPickupAddressId = null;
        }
      }

      if (registeredAddressInput !== undefined) {
        supplierData.registeredAddressId = nextRegisteredAddressId;
      }

      if (pickupAddressInput !== undefined) {
        supplierData.pickupAddressId = nextPickupAddressId;
      }

      if (shouldResetKyc) {
        supplierData.kycStatus = "PENDING";
        supplierData.status = "PENDING_VERIFICATION";
        supplierData.kycApprovedAt = null;
        supplierData.kycRejectedAt = null;
        supplierData.kycRejectionReason = null;
        supplierData.kycCheckedAt = new Date();
      }

      if (shouldResetBankVerification) {
        supplierData.bankVerificationStatus = "PENDING";
        supplierData.bankVerifiedAt = null;
        supplierData.bankVerifiedById = null;
        supplierData.bankVerificationRequestedAt = new Date();
      }

      // Lightweight audit trail: log the actual field change (not the later
      // "submit for verification" confirmation, which has no new diff of
      // its own) so admins can spot patterns like frequent bank-detail
      // changes without needing a full change-request/versioning system.
      if (bankFieldsChanged) {
        const bankChangedFields = sensitiveChanged.filter((k) =>
          ["bankCountry", "bankCode", "bankName", "accountNumber", "accountName"].includes(k)
        );

        try {
          await tx.supplierActivity.create({
            data: {
              supplierId: supplier.id,
              type: "BANK_DETAILS_CHANGED",
              message: `Bank details changed (${bankChangedFields.join(", ")}).`,
              meta: {
                fields: bankChangedFields,
                bankName: incomingSnapshot.bankName ?? null,
                bankCode: incomingSnapshot.bankCode ?? null,
                accountNumberMasked: maskAccountNumberForActivityLog(
                  incomingSnapshot.accountNumber
                ),
              },
            },
          });
        } catch (activityError) {
          console.error(
            "[PUT /api/supplier/me] SupplierActivity log failed:",
            activityError
          );
        }
      }

      // Changing pickup/registered address is a physical-location change —
      // require fresh proof of address for the new location rather than
      // letting a stale, previously-approved document silently cover it.
      const addressChanged =
        sensitiveChanged.includes("registeredAddress") ||
        sensitiveChanged.includes("pickupAddress");

      if (addressChanged) {
        const latestProofOfAddress = await tx.supplierDocument.findFirst({
          where: { supplierId: supplier.id, kind: "PROOF_OF_ADDRESS" },
          orderBy: { uploadedAt: "desc" },
          select: { id: true, status: true },
        });

        if (latestProofOfAddress && latestProofOfAddress.status !== "REJECTED") {
          await tx.supplierDocument.update({
            where: { id: latestProofOfAddress.id },
            data: {
              status: "REJECTED",
              note: "Address changed — please upload updated proof of address for your new location.",
            },
          });
        }

        try {
          await tx.supplierActivity.create({
            data: {
              supplierId: supplier.id,
              type: "ADDRESS_CHANGED",
              message: `${sensitiveChanged
                .filter((k) => k === "registeredAddress" || k === "pickupAddress")
                .join(" and ")} changed — proof of address resubmission required.`,
              meta: {
                fields: sensitiveChanged.filter(
                  (k) => k === "registeredAddress" || k === "pickupAddress"
                ),
              },
            },
          });
        } catch (activityError) {
          console.error(
            "[PUT /api/supplier/me] SupplierActivity log failed:",
            activityError
          );
        }
      }

      if (Object.keys(supplierData).length) {
        await tx.supplier.update({
          where: { id: supplier.id },
          data: supplierData,
        });
      }

      if (supplier.userId && Object.keys(userData).length) {
        await tx.user.update({
          where: { id: supplier.userId },
          data: userData,
        });
      }

      if (shouldResetKyc || shouldResetBankVerification) {
        const updatedSupplier = await tx.supplier.findUnique({
          where: { id: supplier.id },
          select: {
            id: true,
            name: true,
            legalName: true,
            registeredBusinessName: true,
          },
        });

        const admins = await tx.user.findMany({
          where: {
            role: { in: ["ADMIN", "SUPER_ADMIN"] },
          },
          select: { id: true },
        });

        const supplierDisplayName =
          updatedSupplier?.registeredBusinessName ||
          updatedSupplier?.legalName ||
          updatedSupplier?.name ||
          "A supplier";

        // submitBankForVerification lands here with no other field diffs
        // (the bank fields were already persisted by an earlier draft save),
        // so give admins an accurate, bank-specific message in that case.
        const changeDescription =
          !shouldResetKyc && shouldResetBankVerification
            ? "submitted bank details for verification"
            : "updated verification-sensitive details and requires re-review";

        if (admins.length > 0) {
          try {
            await tx.notification.createMany({
              data: admins.map((admin) => ({
                userId: admin.id,
                type: "SUPPLIER_DOCUMENT_UPLOADED" as any,
                title: "Supplier details changed",
                body: `${supplierDisplayName} ${changeDescription}. Supplier ID: ${supplier.id}`,
                data: { supplierId: supplier.id },
              })),
            });
          } catch (notificationError) {
            console.error(
              "[PUT /api/supplier/me] notification createMany failed:",
              notificationError
            );
          }
        }
      }
    });

    const updated = await prisma.supplier.findFirst({
      where: { id: supplier.id },
      select: supplierMeSelect,
    });

    if (!updated) {
      return res.status(404).json({ error: "Supplier not found after update" });
    }

    return res.json({
      data: toSupplierMeDto(updated),
      meta: {
        sensitiveChanged,
        kycReset: shouldResetKyc,
        bankVerificationReset: shouldResetBankVerification,
      },
    });
  } catch (e: any) {
    console.error("[PUT /api/supplier/me] failed:", e);
    return res.status(500).json({
      error: e?.message || "Could not update supplier profile.",
    });
  }
});

/* ---------------- Supplier profile ---------------- */

router.get("/profile", requireAuth, requireSupplier, async (req, res) => {
  const uid = getUserId(req);
  if (!uid) {
    return res.status(401).json({ error: "Unauthenticated" });
  }

  const s = await getSupplierForUser(uid);

  if (!s) {
    return res.status(404).json({ error: "Supplier not found" });
  }

  return res.json({ data: supplierPayload(s) });
});

/* ---------------- Supplier dashboard ---------------- */

router.get("/dashboard", requireAuth, requireSupplier, async (req, res) => {
  const uid = getUserId(req);

  if (!uid) {
    return res.status(401).json({ error: "Unauthenticated" });
  }

  const s = await getSupplierForUser(uid);

  if (!s) {
    return res.status(404).json({ error: "Supplier not found" });
  }

  return res.json({ data: supplierPayload(s) });
});

export default router;