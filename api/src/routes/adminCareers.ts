// api/src/routes/adminCareers.ts
import express from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";
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
 * Helpers
 * --------------------------------------------------------------------------*/

// Coerce "123456", 123456, "123456.78" → number
// Empty string / null / undefined → null
const coerceNullableNumber = z.preprocess((v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}, z.number().nullable());

// Coerce string/number → number (or leave undefined if invalid/blank)
const coerceOptionalNumber = z.preprocess((v) => {
  if (v === "" || v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}, z.number().optional());

function parsePositiveInt(v: unknown, fallback: number, min = 1, max = 100) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return fallback;
  return Math.min(i, max);
}

function toPagination(req: Request, defaults?: { pageSize?: number; maxPageSize?: number }) {
  const defaultPageSize = Math.max(1, Number(defaults?.pageSize ?? 20));
  const maxPageSize = Math.max(defaultPageSize, Number(defaults?.maxPageSize ?? 100));

  const rawPage = Number(req.query.page);
  const rawPageSize = Number(req.query.pageSize);
  const hasPageStyle = Number.isFinite(rawPage) || Number.isFinite(rawPageSize);

  if (hasPageStyle) {
    const page = parsePositiveInt(req.query.page, 1, 1, 100000);
    const pageSize = parsePositiveInt(req.query.pageSize, defaultPageSize, 1, maxPageSize);
    const skip = (page - 1) * pageSize;
    const take = pageSize;
    return { page, pageSize, skip, take };
  }

  const take = parsePositiveInt(req.query.take, defaultPageSize, 1, maxPageSize);
  const skipRaw = Number(req.query.skip);
  const skip = Number.isFinite(skipRaw) && skipRaw >= 0 ? Math.trunc(skipRaw) : 0;
  const pageSize = take;
  const page = Math.floor(skip / take) + 1;

  return { page, pageSize, skip, take };
}

function paginatedResult<T>(args: {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  extra?: Record<string, any>;
}) {
  const { rows, total, page, pageSize, extra } = args;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  return {
    rows,
    total,
    page: safePage,
    pageSize,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPrevPage: safePage > 1,
    ...(extra ?? {}),
  };
}

/* ----------------------------------------------------------------------------
 * Zod schemas
 * --------------------------------------------------------------------------*/

const employmentTypes = ["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY", "INTERN"] as const;
const locationTypes = ["ONSITE", "HYBRID", "REMOTE"] as const;

const careersJobRoleBase = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  department: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  employmentType: z.enum(employmentTypes).nullable().optional(),
  locationType: z.enum(locationTypes).nullable().optional(),

  minSalary: coerceNullableNumber.optional(),
  maxSalary: coerceNullableNumber.optional(),
  currency: z.string().nullable().optional(),

  isPublished: z.boolean().optional(),
  isDeleted: z.boolean().optional(),

  sortOrder: coerceOptionalNumber,

  applicationEmail: z.string().email().nullable().optional(),
  applicationUrl: z.string().url().nullable().optional(),
  introHtml: z.string().nullable().optional(),
  responsibilitiesJson: z.any().nullable().optional(),
  requirementsJson: z.any().nullable().optional(),
  benefitsJson: z.any().nullable().optional(),

  closingDate: z.string().nullable().optional(),
});

const createJobSchema = careersJobRoleBase;
const updateJobSchema = careersJobRoleBase.partial();

/* ----------------------------------------------------------------------------
 * Middleware
 * --------------------------------------------------------------------------*/

router.use(requireAuth, requireAdmin);

/* ----------------------------------------------------------------------------
 * Jobs – list (server-side pagination)
 * Supports:
 * - page=1&pageSize=20
 * - take=20&skip=0
 * Optional:
 * - q=search
 * - isPublished=true|false
 * - isDeleted=true|false
 * --------------------------------------------------------------------------*/

router.get(
  "/jobs",
  wrap(async (req: Request, res: Response) => {
    const { page, pageSize, skip, take } = toPagination(req, {
      pageSize: 20,
      maxPageSize: 100,
    });

    const q = String(req.query.q ?? "").trim();
    const rawIsPublished = String(req.query.isPublished ?? "").trim().toLowerCase();
    const rawIsDeleted = String(req.query.isDeleted ?? "").trim().toLowerCase();

    const where: any = {};

    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        { department: { contains: q, mode: "insensitive" } },
        { location: { contains: q, mode: "insensitive" } },
      ];
    }

    if (rawIsPublished === "true") where.isPublished = true;
    if (rawIsPublished === "false") where.isPublished = false;

    if (rawIsDeleted === "true") where.isDeleted = true;
    if (rawIsDeleted === "false") where.isDeleted = false;

    const [rows, total] = await prisma.$transaction([
      prisma.careersJobRole.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
      prisma.careersJobRole.count({ where }),
    ]);

    res.json({
      data: paginatedResult({
        rows,
        total,
        page,
        pageSize,
      }),
    });
  })
);

/* ----------------------------------------------------------------------------
 * Jobs – create
 * --------------------------------------------------------------------------*/

router.post(
  "/jobs",
  wrap(async (req: Request, res: Response) => {
    const parsed = createJobSchema.parse(req.body);

    const job = await prisma.careersJobRole.create({
      data: {
        title: parsed.title,
        slug: parsed.slug,
        department: parsed.department ?? null,
        location: parsed.location ?? null,
        employmentType: parsed.employmentType ?? null,
        locationType: parsed.locationType ?? null,
        minSalary: parsed.minSalary ?? null,
        maxSalary: parsed.maxSalary ?? null,
        currency: parsed.currency ?? null,
        isPublished: parsed.isPublished ?? false,
        isDeleted: parsed.isDeleted ?? false,
        sortOrder: parsed.sortOrder ?? 0,
        applicationEmail: parsed.applicationEmail ?? null,
        applicationUrl: parsed.applicationUrl ?? null,
        introHtml: parsed.introHtml ?? null,
        responsibilitiesJson: parsed.responsibilitiesJson ?? null,
        requirementsJson: parsed.requirementsJson ?? null,
        benefitsJson: parsed.benefitsJson ?? null,
        closingDate: parsed.closingDate ? new Date(parsed.closingDate) : null,
      },
    });

    res.status(201).json(job);
  })
);

/* ----------------------------------------------------------------------------
 * Jobs – update
 * --------------------------------------------------------------------------*/

router.patch(
  "/jobs/:id",
  wrap(async (req: Request, res: Response) => {
    const id = requiredString(req.params.id);
    const parsed = updateJobSchema.parse(req.body);

    const job = await prisma.careersJobRole.update({
      where: { id },
      data: {
        ...(parsed.title !== undefined && { title: parsed.title }),
        ...(parsed.slug !== undefined && { slug: parsed.slug }),
        ...(parsed.department !== undefined && { department: parsed.department }),
        ...(parsed.location !== undefined && { location: parsed.location }),
        ...(parsed.employmentType !== undefined && { employmentType: parsed.employmentType }),
        ...(parsed.locationType !== undefined && { locationType: parsed.locationType }),
        ...(parsed.minSalary !== undefined && { minSalary: parsed.minSalary }),
        ...(parsed.maxSalary !== undefined && { maxSalary: parsed.maxSalary }),
        ...(parsed.currency !== undefined && { currency: parsed.currency }),
        ...(parsed.isPublished !== undefined && { isPublished: parsed.isPublished }),
        ...(parsed.isDeleted !== undefined && { isDeleted: parsed.isDeleted }),
        ...(parsed.sortOrder !== undefined && { sortOrder: parsed.sortOrder }),
        ...(parsed.applicationEmail !== undefined && { applicationEmail: parsed.applicationEmail }),
        ...(parsed.applicationUrl !== undefined && { applicationUrl: parsed.applicationUrl }),
        ...(parsed.introHtml !== undefined && { introHtml: parsed.introHtml }),
        ...(parsed.responsibilitiesJson !== undefined && {
          responsibilitiesJson: parsed.responsibilitiesJson,
        }),
        ...(parsed.requirementsJson !== undefined && {
          requirementsJson: parsed.requirementsJson,
        }),
        ...(parsed.benefitsJson !== undefined && { benefitsJson: parsed.benefitsJson }),
        ...(parsed.closingDate !== undefined && {
          closingDate: parsed.closingDate ? new Date(parsed.closingDate) : null,
        }),
      },
    });

    res.json(job);
  })
);

/* ----------------------------------------------------------------------------
 * Jobs – delete (soft delete)
 * --------------------------------------------------------------------------*/

router.delete(
  "/jobs/:id",
  wrap(async (req: Request, res: Response) => {
    const id = requiredString(req.params.id);

    const job = await prisma.careersJobRole.update({
      where: { id },
      data: {
        isDeleted: true,
        isPublished: false,
      },
    });

    res.json(job);
  })
);

/* ----------------------------------------------------------------------------
 * Zod schemas
 * --------------------------------------------------------------------------*/
const applicationsQuerySchema = z.object({
  roleId: z.string().max(200).optional().or(z.literal("")),
  status: z.enum(["NEW", "REVIEWED", "SHORTLISTED", "REJECTED"]).optional(),
  search: z.string().max(200).optional().or(z.literal("")),
  page: z.string().optional().or(z.literal("")),
  pageSize: z.string().optional().or(z.literal("")),
  take: z.string().optional().or(z.literal("")),
  skip: z.string().optional().or(z.literal("")),
});

const updateBodySchema = z.object({
  status: z.enum(["NEW", "REVIEWED", "SHORTLISTED", "REJECTED"]).optional(),
  notes: z.string().max(5000).optional(),
});

/* ----------------------------------------------------------------------------
 * Admin-only
 * --------------------------------------------------------------------------*/
router.use(requireAuth);
router.use(requireAdmin);

function readGroupCount(v: unknown): number {
  if (!v || typeof v !== "object") return 0;

  const x = v as Record<string, unknown>;

  if (typeof x.id === "number") return x.id;
  if (typeof x._all === "number") return x._all;

  return 0;
}

/* ----------------------------------------------------------------------------
 * GET /api/admin/careers/applications
 * Server-side pagination:
 * - page=1&pageSize=20
 * - take=20&skip=0
 * Optional:
 * - roleId
 * - status
 * - search
 * --------------------------------------------------------------------------*/
router.get(
  "/applications",
  wrap(async (req: Request, res: Response) => {
    const q = applicationsQuerySchema.parse(req.query);
    const { page, pageSize, skip, take } = toPagination(req, {
      pageSize: 20,
      maxPageSize: 100,
    });

    const where: any = {};

    if (q.roleId && q.roleId.trim()) {
      where.roleId = q.roleId.trim();
    }

    if (q.status) {
      where.status = q.status;
    }

    if (q.search && q.search.trim()) {
      const term = q.search.trim();
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
        { roleTitle: { contains: term, mode: "insensitive" } },
      ];
    }

    const [items, total, roleSummary] = await prisma.$transaction([
      prisma.jobApplication.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          createdAt: true,
          name: true,
          email: true,
          roleId: true,
          roleTitle: true,
          linkedinUrl: true,
          cvFilename: true,
          cvMimeType: true,
          cvSize: true,
          message: true,
          status: true,
          notes: true,
        },
      }),
      prisma.jobApplication.count({ where }),
      prisma.jobApplication.groupBy({
        by: ["roleId", "roleTitle"],
        _count: { _all: true, id: true },
        orderBy: {
          _count: {
            id: "desc",
          },
        },
      }),
    ]);


    res.json({
      data: paginatedResult({
        rows: items,
        total,
        page,
        pageSize,
        extra: {
          roleSummary: roleSummary.map((r) => ({
            roleId: r.roleId,
            roleTitle: r.roleTitle,
            count: readGroupCount(r._count),
          })),
        },
      }),
    });
  })
);

/* ----------------------------------------------------------------------------
 * PATCH /api/admin/careers/applications/:id
 * --------------------------------------------------------------------------*/
router.patch(
  "/applications/:id",
  wrap(async (req: Request, res: Response) => {
    const id = requiredString(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Missing application id" });
    }

    const body = updateBodySchema.parse(req.body);

    if (!body.status && typeof body.notes === "undefined") {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const updated = await prisma.jobApplication.update({
      where: { id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(typeof body.notes !== "undefined" ? { notes: body.notes } : {}),
      },
      select: {
        id: true,
        createdAt: true,
        name: true,
        email: true,
        roleId: true,
        roleTitle: true,
        linkedinUrl: true,
        cvFilename: true,
        cvMimeType: true,
        cvSize: true,
        message: true,
        status: true,
        notes: true,
      },
    });

    res.json({ ok: true, item: updated });
  })
);

export default router;