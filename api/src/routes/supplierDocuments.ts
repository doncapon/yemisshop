import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireSupplier } from "../middleware/auth.js";
import { z } from "zod";

const router = Router();

function getUserId(req: any): string | null {
  return req?.user?.id || req?.auth?.userId || req?.userId || null;
}

async function getSupplierForUser(userId: string) {
  return prisma.supplier.findFirst({
    where: { userId },
    select: {
      id: true,
      name: true,
      legalName: true,
      registeredBusinessName: true,
      registrationType: true,
    },
  });
}

const SupplierDocumentKindSchema = z.enum([
  "BUSINESS_REGISTRATION_CERTIFICATE",
  "GOVERNMENT_ID",
  "PROOF_OF_ADDRESS",
  "TAX_DOCUMENT",
  "BANK_PROOF",
  "OTHER",
]);

const CreateSupplierDocumentSchema = z.object({
  kind: SupplierDocumentKindSchema,
  storageKey: z.string().min(1),
  originalFilename: z.string().min(1),
  mimeType: z.string().nullable().optional(),
  size: z.number().int().nullable().optional(),
});

function toSupplierDocumentDto(d: any) {
  return {
    id: d.id,
    supplierId: d.supplierId,
    kind: d.kind,
    storageKey: d.storageKey,
    originalFilename: d.originalFilename,
    mimeType: d.mimeType ?? null,
    size: d.size ?? null,
    status: d.status ?? null,
    note: d.note ?? null,
    uploadedAt: d.uploadedAt ?? null,
    reviewedAt: d.reviewedAt ?? null,
    reviewedByUserId: d.reviewedByUserId ?? null,
    url: `/uploads/${encodeURI(String(d.storageKey || "").replace(/\\/g, "/"))}`,
  };
}

/* ---------------- GET /api/supplier/documents ---------------- */

router.get("/", requireAuth, requireSupplier, async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const supplier = await getSupplierForUser(uid);
    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    const docs = await prisma.supplierDocument.findMany({
      where: { supplierId: supplier.id },
      orderBy: { uploadedAt: "desc" },
    });

    return res.json({
      data: docs.map(toSupplierDocumentDto),
    });
  } catch (e: any) {
    console.error("[GET /api/supplier/documents] failed:", e);
    return res.status(500).json({
      error: e?.message || "Could not load supplier documents.",
    });
  }
});

/* ---------------- POST /api/supplier/documents ---------------- */
/**
 * Expects body like:
 * {
 *   kind,
 *   storageKey,
 *   originalFilename,
 *   mimeType,
 *   size
 * }
 *
 * This is designed to be used AFTER uploading file via /api/uploads
 */
router.post("/", requireAuth, requireSupplier, async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    let parsed: z.infer<typeof CreateSupplierDocumentSchema>;
    try {
      parsed = CreateSupplierDocumentSchema.parse(req.body ?? {});
    } catch (e: any) {
      return res.status(400).json({
        error: "Invalid payload",
        details: e.errors,
      });
    }

    const supplier = await getSupplierForUser(uid);
    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    // Optional business rule:
    // do not allow business cert upload requirement for non-registered business
    if (
      parsed.kind === "BUSINESS_REGISTRATION_CERTIFICATE" &&
      String(supplier.registrationType || "").toUpperCase() !== "REGISTERED_BUSINESS"
    ) {
      // Allowed for now
    }

    const created = await prisma.$transaction(async (tx) => {
      const doc = await tx.supplierDocument.create({
        data: {
          supplierId: supplier.id,
          kind: parsed.kind,
          storageKey: parsed.storageKey,
          originalFilename: parsed.originalFilename,
          mimeType: parsed.mimeType ?? null,
          size: parsed.size ?? null,
          status: "PENDING",
        },
      });

      const admins = await tx.user.findMany({
        where: {
          role: {
            in: ["ADMIN", "SUPER_ADMIN"],
          },
        },
        select: { id: true },
      });

      const supplierName =
        supplier.registeredBusinessName ||
        supplier.legalName ||
        supplier.name ||
        "A supplier";

      if (admins.length > 0) {
        try {
          await tx.notification.createMany({
            data: admins.map((admin) => ({
              userId: admin.id,
              type: "SUPPLIER_DOCUMENT_UPLOADED" as any,
              title: "Supplier document uploaded",
              body: `${supplierName} uploaded a ${parsed.kind
                .replace(/_/g, " ")
                .toLowerCase()} for review.`,
              isRead: false,
            })),
          });
        } catch (notificationError) {
          console.error(
            "[POST /api/supplier/documents] notification createMany failed:",
            notificationError
          );
        }
      }

      return doc;
    });

    return res.status(201).json({
      data: toSupplierDocumentDto(created),
    });
  } catch (e: any) {
    console.error("[POST /api/supplier/documents] failed:", e);
    return res.status(500).json({
      error: e?.message || "Could not create supplier document.",
    });
  }
});

export default router;