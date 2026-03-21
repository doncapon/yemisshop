// api/src/routes/adminSupplierDocuments.ts
import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { requiredString } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

type SupplierDocumentKind =
  | "BUSINESS_REGISTRATION_CERTIFICATE"
  | "GOVERNMENT_ID"
  | "PROOF_OF_ADDRESS"
  | "TAX_DOCUMENT"
  | "BANK_PROOF"
  | "OTHER";

type SupplierDocStatus = "PENDING" | "APPROVED" | "REJECTED";

const REQUIRED_ALWAYS: SupplierDocumentKind[] = [
  "GOVERNMENT_ID",
  "PROOF_OF_ADDRESS",
];

function isBusinessRegistrationRequired(registrationType?: string | null) {
  return String(registrationType || "").toUpperCase() === "REGISTERED_BUSINESS";
}

function requiredKindsForSupplier(supplier: any): SupplierDocumentKind[] {
  const base = [...REQUIRED_ALWAYS];
  if (isBusinessRegistrationRequired(supplier?.registrationType)) {
    base.unshift("BUSINESS_REGISTRATION_CERTIFICATE");
  }
  return base;
}

function normalizeDocStatus(v: any): SupplierDocStatus {
  const s = String(v || "").toUpperCase();
  if (s === "APPROVED") return "APPROVED";
  if (s === "REJECTED") return "REJECTED";
  return "PENDING";
}

function latestDocByKind(docs: any[], kind: SupplierDocumentKind) {
  return [...docs]
    .filter((d) => d.kind === kind)
    .sort(
      (a, b) =>
        new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
    )[0];
}

function hasApprovedRequiredDocs(supplier: any, docs: any[]) {
  const requiredKinds = requiredKindsForSupplier(supplier);
  return requiredKinds.every((kind) => {
    const latest = latestDocByKind(docs, kind);
    return latest && normalizeDocStatus(latest.status) === "APPROVED";
  });
}

function hasRejectedRequiredDoc(supplier: any, docs: any[]) {
  const requiredKinds = requiredKindsForSupplier(supplier);
  return requiredKinds.some((kind) => {
    const latest = latestDocByKind(docs, kind);
    return latest && normalizeDocStatus(latest.status) === "REJECTED";
  });
}

function hasPendingRequiredDoc(supplier: any, docs: any[]) {
  const requiredKinds = requiredKindsForSupplier(supplier);
  return requiredKinds.some((kind) => {
    const latest = latestDocByKind(docs, kind);
    return latest && normalizeDocStatus(latest.status) === "PENDING";
  });
}

function parsePositiveInt(
  value: unknown,
  fallback: number,
  opts?: { min?: number; max?: number }
) {
  const min = opts?.min ?? 1;
  const max = opts?.max ?? Number.MAX_SAFE_INTEGER;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const int = Math.trunc(n);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

function buildPaginationMeta(total: number, page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return {
    total,
    page,
    pageSize,
    pageCount,
    hasNextPage: page < pageCount,
    hasPrevPage: page > 1,
  };
}

async function recomputeSupplierVerification(tx: any, supplierId: string) {
  const supplier = await tx.supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
      status: true,
      kycStatus: true,
      registrationType: true,
      documents: {
        orderBy: { uploadedAt: "desc" },
        select: {
          id: true,
          kind: true,
          status: true,
          uploadedAt: true,
        },
      },
    },
  });

  if (!supplier) return null;

  const docs = supplier.documents || [];
  const requiredKinds = requiredKindsForSupplier(supplier);

  const allRequiredPresent = requiredKinds.every((kind) => !!latestDocByKind(docs, kind));
  const allRequiredApproved = hasApprovedRequiredDocs(supplier, docs);
  const anyRequiredRejected = hasRejectedRequiredDoc(supplier, docs);
  const anyRequiredPending = hasPendingRequiredDoc(supplier, docs);

  const now = new Date();

  let nextKycStatus = supplier.kycStatus;
  let nextStatus = supplier.status;

  let kycApprovedAt: Date | null = null;
  let kycCheckedAt: Date | null = now;
  let kycRejectedAt: Date | null = null;
  let kycRejectionReason: string | null = null;

  if (!allRequiredPresent) {
    nextKycStatus = "PENDING";
    nextStatus = "PENDING_VERIFICATION";
  } else if (anyRequiredRejected) {
    nextKycStatus = "REJECTED";
    nextStatus = "PENDING_VERIFICATION";
    kycRejectedAt = now;
  } else if (allRequiredApproved) {
    nextKycStatus = "APPROVED";
    nextStatus = "PENDING_VERIFICATION";
    kycApprovedAt = now;
    kycRejectedAt = null;
  } else if (anyRequiredPending) {
    nextKycStatus = "PENDING";
    nextStatus = "PENDING_VERIFICATION";
  } else {
    nextKycStatus = "PENDING";
    nextStatus = "PENDING_VERIFICATION";
  }

  const updated = await tx.supplier.update({
    where: { id: supplierId },
    data: {
      kycStatus: nextKycStatus,
      status: nextStatus,
      kycApprovedAt,
      kycCheckedAt,
      kycRejectedAt,
      kycRejectionReason,
    },
    select: {
      id: true,
      name: true,
      legalName: true,
      registeredBusinessName: true,
      status: true,
      kycStatus: true,
      kycApprovedAt: true,
      kycCheckedAt: true,
      kycRejectedAt: true,
      kycRejectionReason: true,
      registrationType: true,
    },
  });

  return {
    supplier: {
      ...updated,
      businessName:
        updated.registeredBusinessName ||
        updated.legalName ||
        updated.name ||
        "Unnamed supplier",
    },
    summary: {
      requiredKinds,
      allRequiredPresent,
      allRequiredApproved,
      anyRequiredRejected,
      anyRequiredPending,
    },
  };
}

/**
 * GET /api/admin/supplier-documents
 * List suppliers with document approval summary
 * Server-side paginated
 */
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1, { min: 1 });
    const pageSize = parsePositiveInt(req.query.pageSize, 20, { min: 1, max: 100 });

    const [total, suppliers] = await Promise.all([
      prisma.supplier.count(),
      prisma.supplier.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          legalName: true,
          registeredBusinessName: true,
          registrationType: true,
          registrationCountryCode: true,
          status: true,
          kycStatus: true,
          kycApprovedAt: true,
          kycCheckedAt: true,
          kycRejectedAt: true,
          kycRejectionReason: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          documents: {
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              kind: true,
              status: true,
              originalFilename: true,
              uploadedAt: true,
              reviewedAt: true,
            },
          },
        },
      }),
    ]);

    const rows = suppliers.map((s: any) => {
      const requiredKinds = requiredKindsForSupplier(s);

      const summary = requiredKinds.map((kind) => {
        const latest = latestDocByKind(s.documents || [], kind);
        return {
          kind,
          present: !!latest,
          status: latest ? normalizeDocStatus(latest.status) : "MISSING",
          documentId: latest?.id || null,
          uploadedAt: latest?.uploadedAt || null,
        };
      });

      const approvedCount = summary.filter((x) => x.status === "APPROVED").length;
      const pendingCount = summary.filter((x) => x.status === "PENDING").length;
      const rejectedCount = summary.filter((x) => x.status === "REJECTED").length;
      const missingCount = summary.filter((x) => x.status === "MISSING").length;

      return {
        id: s.id,
        businessName:
          s.registeredBusinessName ||
          s.legalName ||
          s.name ||
          "Unnamed supplier",
        supplierName: s.name || null,
        legalName: s.legalName || null,
        registeredBusinessName: s.registeredBusinessName || null,
        registrationType: s.registrationType,
        registrationCountryCode: s.registrationCountryCode,
        status: s.status,
        kycStatus: s.kycStatus,
        kycApprovedAt: s.kycApprovedAt,
        kycCheckedAt: s.kycCheckedAt,
        kycRejectedAt: s.kycRejectedAt,
        kycRejectionReason: s.kycRejectionReason,
        createdAt: s.createdAt,
        user: s.user,
        requiredKinds,
        approvedCount,
        pendingCount,
        rejectedCount,
        missingCount,
        readyForApproval: missingCount === 0 && pendingCount === 0 && rejectedCount === 0,
        summary,
      };
    });

    const pagination = buildPaginationMeta(total, page, pageSize);

    res.json({
      data: rows,
      items: rows,
      ...pagination,
    });
  } catch (e: any) {
    res.status(500).json({
      error: e?.message || "Could not load supplier document review list.",
    });
  }
});

/**
 * GET /api/admin/supplier-documents/:supplierId
 * Get one supplier and paginated documents
 */
router.get("/:supplierId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const supplierId = String(req.params.supplierId || "").trim();
    if (!supplierId) {
      return res.status(400).json({ error: "supplierId is required" });
    }

    const page = parsePositiveInt(req.query.page, 1, { min: 1 });
    const pageSize = parsePositiveInt(req.query.pageSize, 20, { min: 1, max: 100 });

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        name: true,
        legalName: true,
        registeredBusinessName: true,
        registrationType: true,
        registrationCountryCode: true,
        status: true,
        kycStatus: true,
        kycApprovedAt: true,
        kycCheckedAt: true,
        kycRejectedAt: true,
        kycRejectionReason: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    const requiredKinds = requiredKindsForSupplier(supplier);

    const [totalDocuments, pagedDocuments, summaryDocs] = await Promise.all([
      prisma.supplierDocument.count({
        where: { supplierId },
      }),
      prisma.supplierDocument.findMany({
        where: { supplierId },
        orderBy: [{ uploadedAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          supplierId: true,
          kind: true,
          storageKey: true,
          originalFilename: true,
          mimeType: true,
          size: true,
          status: true,
          note: true,
          uploadedAt: true,
          reviewedAt: true,
        },
      }),
      prisma.supplierDocument.findMany({
        where: { supplierId },
        orderBy: [{ uploadedAt: "desc" }],
        select: {
          id: true,
          kind: true,
          status: true,
          uploadedAt: true,
        },
      }),
    ]);

    const documentsPagination = buildPaginationMeta(totalDocuments, page, pageSize);

    const payload = {
      ...supplier,
      businessName:
        supplier.registeredBusinessName ||
        supplier.legalName ||
        supplier.name ||
        "Unnamed supplier",
      requiredKinds,
      allRequiredApproved: hasApprovedRequiredDocs(supplier, summaryDocs || []),
      documents: pagedDocuments,
      documentsPagination,
    };

    res.json({
      data: payload,
      items: pagedDocuments,
      total: totalDocuments,
      page,
      pageSize,
      pageCount: documentsPagination.pageCount,
      hasNextPage: documentsPagination.hasNextPage,
      hasPrevPage: documentsPagination.hasPrevPage,
    });
  } catch (e: any) {
    res.status(500).json({
      error: e?.message || "Could not load supplier documents.",
    });
  }
});

/**
 * PATCH /api/admin/supplier-documents/document/:documentId/review
 * Approve or reject a document, then recompute supplier approval state
 * body: { status: "APPROVED" | "REJECTED", note?: string }
 */
router.patch("/document/:documentId/review", requireAuth, requireAdmin, async (req, res) => {
  try {
    const documentId = requiredString(req.params.documentId);
    const status = String(req.body?.status || "").toUpperCase();
    const note =
      req.body?.note === undefined || req.body?.note === null
        ? null
        : String(req.body.note).trim() || null;

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ error: "Invalid review status." });
    }

    const existing = await prisma.supplierDocument.findUnique({
      where: { id: documentId },
      select: { id: true, supplierId: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Supplier document not found." });
    }

    const result = await prisma.$transaction(async (tx: any) => {
      await tx.supplierDocument.update({
        where: { id: documentId },
        data: {
          status: status as any,
          note,
          reviewedAt: new Date(),
        },
      });

      return recomputeSupplierVerification(tx, existing.supplierId);
    });

    return res.json({ ok: true, data: result });
  } catch (e: any) {
    console.error("[PATCH /api/admin/supplier-documents/document/:documentId/review]", e);
    return res.status(500).json({
      error: e?.message || "Could not review supplier document.",
    });
  }
});

/**
 * POST /api/admin/supplier-documents/:supplierId/recompute
 * Force recompute supplier approval state from current docs
 */
router.post("/:supplierId/recompute", requireAuth, requireAdmin, async (req, res) => {
  try {
    const supplierId = String(req.params.supplierId || "").trim();
    if (!supplierId) {
      return res.status(400).json({ error: "supplierId is required" });
    }

    const result = await prisma.$transaction(async (tx: any) => {
      return recomputeSupplierVerification(tx, supplierId);
    });

    if (!result) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    res.json({
      message: "Supplier verification state recomputed.",
      data: result,
    });
  } catch (e: any) {
    res.status(500).json({
      error: e?.message || "Could not recompute supplier verification.",
    });
  }
});

router.post("/:supplierId/approve-supplier", requireAuth, requireAdmin, async (req, res) => {
  try {
    const supplierId = String(req.params.supplierId || "").trim();
    if (!supplierId) {
      return res.status(400).json({ error: "Supplier id is required." });
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        name: true,
        legalName: true,
        registeredBusinessName: true,
        userId: true,
        registrationType: true,
        documents: {
          orderBy: { uploadedAt: "desc" },
          select: {
            id: true,
            kind: true,
            status: true,
            uploadedAt: true,
          },
        },
      },
    });

    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found." });
    }

    const requiredKinds: SupplierDocumentKind[] = ["GOVERNMENT_ID", "PROOF_OF_ADDRESS"];
    if (String(supplier.registrationType || "").toUpperCase() === "REGISTERED_BUSINESS") {
      requiredKinds.unshift("BUSINESS_REGISTRATION_CERTIFICATE");
    }

    const latestByKind = new Map<string, any>();
    for (const doc of supplier.documents) {
      if (!latestByKind.has(doc.kind)) latestByKind.set(doc.kind, doc);
    }

    const missingOrUnapproved = requiredKinds.filter((kind) => {
      const doc = latestByKind.get(kind);
      return !doc || String(doc.status || "").toUpperCase() !== "APPROVED";
    });

    if (missingOrUnapproved.length > 0) {
      return res.status(400).json({
        error: `Supplier cannot be approved yet. Outstanding requirements: ${missingOrUnapproved.join(", ")}`,
      });
    }

    await prisma.supplier.update({
      where: { id: supplierId },
      data: {
        kycStatus: "APPROVED",
        status: "ACTIVE",
        kycApprovedAt: new Date(),
        kycCheckedAt: new Date(),
        kycRejectedAt: null,
        kycRejectionReason: null,
      },
    });

    return res.json({ ok: true });
  } catch (e: any) {
    console.error("[POST /api/admin/supplier-documents/:supplierId/approve-supplier]", e);
    return res.status(500).json({
      error: e?.message || "Could not approve supplier.",
    });
  }
});

router.post("/:supplierId/reject-supplier", requireAuth, requireAdmin, async (req, res) => {
  try {
    const supplierId = String(req.params.supplierId || "").trim();
    if (!supplierId) {
      return res.status(400).json({ error: "Supplier id is required." });
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });

    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found." });
    }

    await prisma.supplier.update({
      where: { id: supplierId },
      data: {
        kycStatus: "REJECTED",
        status: "REJECTED",
        kycCheckedAt: new Date(),
        kycRejectedAt: new Date(),
      },
    });

    return res.json({ ok: true });
  } catch (e: any) {
    console.error("[POST /api/admin/supplier-documents/:supplierId/reject-supplier]", e);
    return res.status(500).json({
      error: e?.message || "Could not reject supplier.",
    });
  }
});

export default router;