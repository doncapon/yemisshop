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
 * Enums / Zod schemas
 * --------------------------------------------------------------------------*/

const statusEnum = z.enum(["ACTIVE", "PROBATION", "ON_LEAVE", "EXITED"]);
const payFrequencyEnum = z.enum(["MONTHLY", "WEEKLY", "OTHER"]);

// Query params for employee list
const listQuerySchema = z.object({
  status: statusEnum.optional(),
  search: z.string().optional(),
  department: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// Query params for employee documents list
const documentsListQuerySchema = z.object({
  kind: z.enum(["PASSPORT", "NIN_SLIP", "TAX", "CONTRACT", "OTHER"]).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// Base body schema used for create/update
const baseEmployeeBodySchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),

  // 🔓 Be lenient on email format (string or null)
  emailWork: z.string().max(255).optional().nullable(),
  emailPersonal: z.string().max(255).optional().nullable(),
  phone: z.string().max(255).optional().nullable(),

  jobTitle: z.string().max(255).optional().nullable(),
  department: z.string().max(255).optional().nullable(),
  status: statusEnum.default("ACTIVE"),

  // receives ISO string or null from UI
  startDate: z.string().optional().nullable(),

  baseSalaryNGN: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === "" || v == null) return null;
      const n = typeof v === "string" ? Number(v) : v;
      return Number.isFinite(n) ? n : null;
    }),

  payFrequency: payFrequencyEnum.optional().nullable(),

  bankName: z.string().max(255).optional().nullable(),
  bankCode: z.string().max(255).optional().nullable(),
  accountNumber: z.string().max(255).optional().nullable(),
  accountName: z.string().max(255).optional().nullable(),

  isPayrollReady: z.boolean().optional().default(false),

  // doc flags – backend is permissive; they default to false
  hasPassportDoc: z.boolean().optional().default(false),
  hasNinSlipDoc: z.boolean().optional().default(false),
  hasTaxDoc: z.boolean().optional().default(false),
});

const createEmployeeSchema = baseEmployeeBodySchema;
const updateEmployeeSchema = baseEmployeeBodySchema.partial();

// Create employee document (after upload to /api/uploads or S3 etc.)
const createDocumentBodySchema = z.object({
  kind: z.enum(["PASSPORT", "NIN_SLIP", "TAX", "CONTRACT", "OTHER"]),
  storageKey: z.string().min(1),
  originalFilename: z.string().min(1),
  mimeType: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
});

/* ----------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------*/

function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildListWhere(input: z.infer<typeof listQuerySchema>) {
  const where: any = {};

  if (input.status) {
    where.status = input.status;
  }

  if (input.department && input.department.trim()) {
    where.department = {
      contains: input.department.trim(),
      mode: "insensitive",
    };
  }

  if (input.search && input.search.trim()) {
    const q = input.search.trim();
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { emailWork: { contains: q, mode: "insensitive" } },
      { emailPersonal: { contains: q, mode: "insensitive" } },
      { jobTitle: { contains: q, mode: "insensitive" } },
      { department: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
    ];
  }

  return where;
}

function buildDocumentsWhere(
  employeeId: string,
  input: z.infer<typeof documentsListQuerySchema>
) {
  const where: any = { employeeId };

  if (input.kind) {
    where.kind = input.kind;
  }

  if (input.search && input.search.trim()) {
    const q = input.search.trim();
    where.OR = [
      { originalFilename: { contains: q, mode: "insensitive" } },
      { storageKey: { contains: q, mode: "insensitive" } },
      { mimeType: { contains: q, mode: "insensitive" } },
    ];
  }

  return where;
}

function paginationMeta(total: number, page: number, pageSize: number) {
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

/* ----------------------------------------------------------------------------
 * Middleware
 * --------------------------------------------------------------------------*/

router.use(requireAuth);
router.use(requireAdmin);

/* ----------------------------------------------------------------------------
 * Routes
 * --------------------------------------------------------------------------*/

/**
 * GET /api/admin/employees
 * List employees with filters & pagination
 */
router.get(
  "/",
  wrap(async (req: Request, res: Response) => {
    const query = listQuerySchema.parse(req.query);
    const where = buildListWhere(query);

    const [total, items] = await Promise.all([
      prisma.employee.count({ where }),
      prisma.employee.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    res.json({
      items,
      ...paginationMeta(total, query.page, query.pageSize),
    });
  })
);

/**
 * POST /api/admin/employees
 * Create a new employee
 */
router.post(
  "/",
  wrap(async (req: Request, res: Response) => {
    const body = createEmployeeSchema.parse(req.body);

    const employee = await prisma.employee.create({
      data: {
        firstName: body.firstName,
        lastName: body.lastName,

        emailWork: body.emailWork ?? null,
        emailPersonal: body.emailPersonal ?? null,
        phone: body.phone ?? null,

        jobTitle: body.jobTitle ?? null,
        department: body.department ?? null,
        status: body.status ?? "ACTIVE",

        startDate: toDateOrNull(body.startDate ?? null),

        baseSalaryNGN: body.baseSalaryNGN ?? null,
        payFrequency: body.payFrequency ?? null,

        bankName: body.bankName ?? null,
        bankCode: body.bankCode ?? null,
        accountNumber: body.accountNumber ?? null,
        accountName: body.accountName ?? null,

        isPayrollReady: body.isPayrollReady ?? false,
        hasPassportDoc: body.hasPassportDoc ?? false,
        hasNinSlipDoc: body.hasNinSlipDoc ?? false,
        hasTaxDoc: body.hasTaxDoc ?? false,
      },
    });

    res.status(201).json(employee);
  })
);

/**
 * PATCH /api/admin/employees/:id
 * Update existing employee (including payroll toggle)
 */
router.patch(
  "/:id",
  wrap(async (req: Request, res: Response) => {
    const id = requiredString(req.params.id, "id");
    const body = updateEmployeeSchema.parse(req.body);

    const data: any = {};

    if (body.firstName !== undefined) data.firstName = body.firstName;
    if (body.lastName !== undefined) data.lastName = body.lastName;

    if (body.emailWork !== undefined) data.emailWork = body.emailWork;
    if (body.emailPersonal !== undefined) data.emailPersonal = body.emailPersonal;
    if (body.phone !== undefined) data.phone = body.phone;

    if (body.jobTitle !== undefined) data.jobTitle = body.jobTitle;
    if (body.department !== undefined) data.department = body.department;
    if (body.status !== undefined) data.status = body.status;

    if (body.startDate !== undefined) {
      data.startDate = toDateOrNull(body.startDate ?? null);
    }

    if (body.baseSalaryNGN !== undefined) {
      data.baseSalaryNGN = body.baseSalaryNGN;
    }

    if (body.payFrequency !== undefined) {
      data.payFrequency = body.payFrequency;
    }

    if (body.bankName !== undefined) data.bankName = body.bankName;
    if (body.bankCode !== undefined) data.bankCode = body.bankCode;
    if (body.accountNumber !== undefined) data.accountNumber = body.accountNumber;
    if (body.accountName !== undefined) data.accountName = body.accountName;

    if (body.isPayrollReady !== undefined) {
      data.isPayrollReady = body.isPayrollReady;
    }

    if (body.hasPassportDoc !== undefined) data.hasPassportDoc = body.hasPassportDoc;
    if (body.hasNinSlipDoc !== undefined) data.hasNinSlipDoc = body.hasNinSlipDoc;
    if (body.hasTaxDoc !== undefined) data.hasTaxDoc = body.hasTaxDoc;

    const employee = await prisma.employee.update({
      where: { id },
      data,
    });

    res.json(employee);
  })
);

/**
 * GET /api/admin/employees/:id
 */
router.get(
  "/:id",
  wrap(async (req: Request, res: Response) => {
    const id = requiredString(req.params.id, "id");

    const employee = await prisma.employee.findUnique({
      where: { id },
    });

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    res.json(employee);
  })
);

/* ----------------------------------------------------------------------------
 * GET /api/admin/employees/:id/documents
 * List documents for a specific employee with server-side pagination
 * --------------------------------------------------------------------------*/
router.get(
  "/:id/documents",
  wrap(async (req: Request, res: Response) => {
    const employeeId = requiredString(req.params.id, "id");
    const query = documentsListQuerySchema.parse(req.query);

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const where = buildDocumentsWhere(employeeId, query);
    const base = process.env.UPLOADS_PUBLIC_BASE_URL ?? "";

    const [total, docs] = await Promise.all([
      prisma.employeeDocument.count({ where }),
      prisma.employeeDocument.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          createdAt: true,
          kind: true,
          storageKey: true,
          originalFilename: true,
          mimeType: true,
          size: true,
        },
      }),
    ]);

    const items = docs.map((d) => ({
      ...d,
      url: base
        ? `${base.replace(/\/$/, "")}/${d.storageKey.replace(/^\//, "")}`
        : null,
    }));

    res.json({
      items,
      ...paginationMeta(total, query.page, query.pageSize),
    });
  })
);

/* ----------------------------------------------------------------------------
 * POST /api/admin/employees/:id/documents
 * Create a new document record after file upload
 * --------------------------------------------------------------------------*/
router.post(
  "/:id/documents",
  wrap(async (req: Request, res: Response) => {
    const employeeId = requiredString(req.params.id, "id");

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
    const employeeId = requiredString(req.params.id, "id");
    const docId = requiredString(req.params.docId, "docId");

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
        return res.status(404).json({ error: "Document not found for this employee" });
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

      return null;
    });

    res.json({ ok: true });
  })
);

export default router;