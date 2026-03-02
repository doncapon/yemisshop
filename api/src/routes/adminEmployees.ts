// api/src/routes/adminEmployees.ts
import express, {
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { requiredString } from "../lib/http.js";

const router = express.Router();

/* ----------------------------------------------------------------------------
 * Async wrapper
 * --------------------------------------------------------------------------*/
const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => any): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

/* ----------------------------------------------------------------------------
 * Zod schemas
 * --------------------------------------------------------------------------*/

const listQuerySchema = z.object({
  status: z
    .enum(["ACTIVE", "PROBATION", "ON_LEAVE", "EXITED"])
    .optional(),
  department: z.string().max(200).optional().or(z.literal("")),
  search: z.string().max(200).optional().or(z.literal("")),
  cursor: z.string().optional().or(z.literal("")),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return 20;
      return Math.min(100, Math.max(1, n));
    }),
});

// Everything the Admin UI can update
const updateBodySchema = z.object({
  status: z.enum(["ACTIVE", "PROBATION", "ON_LEAVE", "EXITED"]).optional(),
  baseSalaryNGN: z.number().int().nonnegative().nullable().optional(),
  payFrequency: z
    .enum(["MONTHLY", "WEEKLY", "OTHER"])
    .nullable()
    .optional(),

  bankName: z.string().max(200).nullable().optional(),
  bankCode: z.string().max(50).nullable().optional(),
  accountNumber: z.string().max(50).nullable().optional(),
  accountName: z.string().max(200).nullable().optional(),

  isPayrollReady: z.boolean().nullable().optional(),
});

// Create employee document (after upload to /api/uploads or S3 etc.)
const createDocumentBodySchema = z.object({
  kind: z.enum(["PASSPORT", "NIN_SLIP", "TAX", "CONTRACT", "OTHER"]),
  storageKey: z.string().min(1),
  originalFilename: z.string().min(1),
  mimeType: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
});

/* ----------------------------------------------------------------------------
 * Admin-only
 * --------------------------------------------------------------------------*/
router.use(requireAuth);
router.use(requireAdmin);

/* ----------------------------------------------------------------------------
 * GET /api/admin/employees
 * List employees + department summary
 * --------------------------------------------------------------------------*/
router.get(
  "/",
  wrap(async (req: Request, res: Response) => {
    const q = listQuerySchema.parse(req.query);

    const where: any = {};

    if (q.status) {
      where.status = q.status;
    }

    if (q.department && q.department.trim()) {
      where.department = q.department.trim();
    }

    if (q.search && q.search.trim()) {
      const term = q.search.trim();
      where.OR = [
        { firstName: { contains: term, mode: "insensitive" } },
        { lastName: { contains: term, mode: "insensitive" } },
        { emailWork: { contains: term, mode: "insensitive" } },
        { emailPersonal: { contains: term, mode: "insensitive" } },
        { jobTitle: { contains: term, mode: "insensitive" } },
        { department: { contains: term, mode: "insensitive" } },
      ];
    }

    const take = q.limit ?? 20;
    const cursor =
      q.cursor && q.cursor.trim() ? { id: q.cursor.trim() } : null;

    const employees = await prisma.employee.findMany({
      where,
      take: take + 1,
      ...(cursor ? { cursor, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,

        firstName: true,
        lastName: true,
        emailWork: true,
        emailPersonal: true,
        phone: true,

        jobTitle: true,
        department: true,
        status: true,
        startDate: true,

        baseSalaryNGN: true,
        payFrequency: true,

        bankName: true,
        bankCode: true,
        accountNumber: true,
        accountName: true,
        isPayrollReady: true,

        hasPassportDoc: true,
        hasNinSlipDoc: true,
        hasTaxDoc: true,
      },
    });

    let nextCursor: string | null = null;
    if (employees.length > take) {
      const last = employees[employees.length - 1];
      nextCursor = last.id;
      employees.pop();
    }

    // Department summary – for filters
    const departmentSummary = await prisma.employee.groupBy({
      by: ["department"],
      _count: {
        id: true,
      },
      // Prisma 6 groupBy: orderBy _count must use a real field, not _all
      orderBy: {
        _count: {
          id: "desc",
        },
      },
    });

    res.json({
      items: employees.map((e) => ({
        ...e,
        // ensure JSON serialisation is nice; startDate/createdAt already ISO
      })),
      nextCursor,
      departmentSummary: departmentSummary.map((d) => ({
        department: d.department,
        count: d._count.id,
      })),
    });
  })
);

/* ----------------------------------------------------------------------------
 * PATCH /api/admin/employees/:id
 * Update employment / salary / bank / payroll flags
 * --------------------------------------------------------------------------*/
router.patch(
  "/:id",
  wrap(async (req: Request, res: Response) => {
    const id = requiredString(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Missing employee id" });
    }

    const body = updateBodySchema.parse(req.body);

    // Build Prisma data object, only including fields that are actually present
    const data: any = {};

    if (typeof body.status !== "undefined") {
      data.status = body.status;
    }

    if (typeof body.baseSalaryNGN !== "undefined") {
      // allow null to clear it
      data.baseSalaryNGN =
        body.baseSalaryNGN === null ? null : body.baseSalaryNGN;
    }

    if (typeof body.payFrequency !== "undefined") {
      data.payFrequency = body.payFrequency;
    }

    if (typeof body.bankName !== "undefined") {
      data.bankName = body.bankName;
    }
    if (typeof body.bankCode !== "undefined") {
      data.bankCode = body.bankCode;
    }
    if (typeof body.accountNumber !== "undefined") {
      data.accountNumber = body.accountNumber;
    }
    if (typeof body.accountName !== "undefined") {
      data.accountName = body.accountName;
    }

    if (typeof body.isPayrollReady !== "undefined") {
      data.isPayrollReady =
        body.isPayrollReady === null ? false : body.isPayrollReady;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const updated = await prisma.employee.update({
      where: { id },
      data,
      select: {
        id: true,
        createdAt: true,

        firstName: true,
        lastName: true,
        emailWork: true,
        emailPersonal: true,
        phone: true,

        jobTitle: true,
        department: true,
        status: true,
        startDate: true,

        baseSalaryNGN: true,
        payFrequency: true,

        bankName: true,
        bankCode: true,
        accountNumber: true,
        accountName: true,
        isPayrollReady: true,

        hasPassportDoc: true,
        hasNinSlipDoc: true,
        hasTaxDoc: true,
      },
    });

    res.json({ ok: true, item: updated });
  })
);

/* ----------------------------------------------------------------------------
 * GET /api/admin/employees/:id/documents
 * List documents for a specific employee
 * --------------------------------------------------------------------------*/
router.get(
  "/:id/documents",
  wrap(async (req: Request, res: Response) => {
    const employeeId = requiredString(req.params.id);
    if (!employeeId) {
      return res.status(400).json({ error: "Missing employee id" });
    }

    const docs = await prisma.employeeDocument.findMany({
      where: { employeeId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        kind: true,
        storageKey: true,
        originalFilename: true,
        mimeType: true,
        size: true,
      },
    });

    // Optional: If you have a CDN base URL for uploads, you can expose a URL
    const base = process.env.UPLOADS_PUBLIC_BASE_URL ?? "";

    const items = docs.map((d) => ({
      ...d,
      url: base
        ? `${base.replace(/\/$/, "")}/${d.storageKey.replace(/^\//, "")}`
        : null,
    }));

    res.json({ items });
  })
);

/* ----------------------------------------------------------------------------
 * POST /api/admin/employees/:id/documents
 * Create a new document record after file upload
 * --------------------------------------------------------------------------*/
router.post(
  "/:id/documents",
  wrap(async (req: Request, res: Response) => {
    const employeeId = requiredString(req.params.id);
    if (!employeeId) {
      return res.status(400).json({ error: "Missing employee id" });
    }

    // Validate body
    const body = createDocumentBodySchema.parse(req.body);

    // Optional: ensure employee exists
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const doc = await prisma.$transaction(async (tx) => {
      const created = await tx.employeeDocument.create({
        data: {
          employeeId,
          kind: body.kind,
          storageKey: body.storageKey,
          originalFilename: body.originalFilename,
          mimeType: body.mimeType,
          size: typeof body.size === "number" ? body.size : null,
        },
        select: {
          id: true,
          createdAt: true,
          kind: true,
          storageKey: true,
          originalFilename: true,
          mimeType: true,
          size: true,
        },
      });

      // Maintain boolean flags on Employee for quick filtering
      const updates: any = {};
      if (body.kind === "PASSPORT") {
        updates.hasPassportDoc = true;
      } else if (body.kind === "NIN_SLIP") {
        updates.hasNinSlipDoc = true;
      } else if (body.kind === "TAX") {
        updates.hasTaxDoc = true;
      }

      if (Object.keys(updates).length > 0) {
        await tx.employee.update({
          where: { id: employeeId },
          data: updates,
        });
      }

      return created;
    });

    const base = process.env.UPLOADS_PUBLIC_BASE_URL ?? "";
    const item = {
      ...doc,
      url: base
        ? `${base.replace(/\/$/, "")}/${doc.storageKey.replace(/^\//, "")}`
        : null,
    };

    res.status(201).json({ ok: true, item });
  })
);

/* ----------------------------------------------------------------------------
 * DELETE /api/admin/employees/:id/documents/:docId
 * Delete document + keep Employee flags in sync
 * --------------------------------------------------------------------------*/
router.delete(
  "/:id/documents/:docId",
  wrap(async (req: Request, res: Response) => {
    const employeeId = requiredString(req.params.id);
    const docId = requiredString(req.params.docId);

    if (!employeeId || !docId) {
      return res.status(400).json({ error: "Missing employee or document id" });
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.employeeDocument.findUnique({
        where: { id: docId },
        select: {
          id: true,
          kind: true,
          employeeId: true,
        },
      });

      if (!existing || existing.employeeId !== employeeId) {
        throw new Error("Document not found for this employee");
      }

      const kind = existing.kind;

      await tx.employeeDocument.delete({
        where: { id: docId },
      });

      // Re-check if there are remaining docs of this kind
      const remainingCount = await tx.employeeDocument.count({
        where: {
          employeeId,
          kind,
        },
      });

      if (remainingCount === 0) {
        const updates: any = {};
        if (kind === "PASSPORT") {
          updates.hasPassportDoc = false;
        } else if (kind === "NIN_SLIP") {
          updates.hasNinSlipDoc = false;
        } else if (kind === "TAX") {
          updates.hasTaxDoc = false;
        }

        if (Object.keys(updates).length > 0) {
          await tx.employee.update({
            where: { id: employeeId },
            data: updates,
          });
        }
      }
    });

    res.json({ ok: true });
  })
);

export default router;