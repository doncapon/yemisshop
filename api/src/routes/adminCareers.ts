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

  // 🔢 These can arrive as strings from the form; coerce them
  minSalary: coerceNullableNumber.optional(),
  maxSalary: coerceNullableNumber.optional(),
  currency: z.string().nullable().optional(),

  isPublished: z.boolean().optional(),
  isDeleted: z.boolean().optional(),

  // 🔢 sortOrder also comes as a string – coerce to number, optional
  sortOrder: coerceOptionalNumber,

  applicationEmail: z.string().email().nullable().optional(),
  applicationUrl: z.string().url().nullable().optional(),
  introHtml: z.string().nullable().optional(),
  responsibilitiesJson: z.any().nullable().optional(),
  requirementsJson: z.any().nullable().optional(),
  benefitsJson: z.any().nullable().optional(),

  // Comes from <input type="date" /> as "YYYY-MM-DD"
  closingDate: z.string().nullable().optional(),
});

const createJobSchema = careersJobRoleBase;
const updateJobSchema = careersJobRoleBase.partial();

/* ----------------------------------------------------------------------------
 * Middleware
 * --------------------------------------------------------------------------*/

router.use(requireAuth, requireAdmin);

/* ----------------------------------------------------------------------------
 * Jobs – list (with basic pagination)
 * --------------------------------------------------------------------------*/

router.get(
  "/jobs",
  wrap(async (req: Request, res: Response) => {
    const page = Number(req.query.page ?? 1) || 1;
    const pageSize = Number(req.query.pageSize ?? 20) || 20;

    const [items, total] = await Promise.all([
      prisma.careersJobRole.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.careersJobRole.count(),
    ]);

    res.json({
      items,
      total,
      page,
      pageSize,
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

        // 🔑 FIX: convert "2026-03-27" → Date object for Prisma
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
    const id =  requiredString(req.params.id);
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

        // 🔑 FIX: same conversion logic on update
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
    const id =  requiredString(req.params.id);

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
const listQuerySchema = z.object({
  roleId: z.string().max(200).optional().or(z.literal("")),
  status: z.enum(["NEW", "REVIEWED", "SHORTLISTED", "REJECTED"]).optional(),
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

const updateBodySchema = z.object({
  status: z.enum(["NEW", "REVIEWED", "SHORTLISTED", "REJECTED"]).optional(),
  notes: z.string().max(5000).optional(),
});

/* ----------------------------------------------------------------------------
 * Admin-only
 * --------------------------------------------------------------------------*/
router.use(requireAuth);
router.use(requireAdmin);

/* ----------------------------------------------------------------------------
 * GET /api/admin/careers/applications
 * --------------------------------------------------------------------------*/
router.get(
  "/applications",
  wrap(async (req: Request, res: Response) => {
    const q = listQuerySchema.parse(req.query);

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

    const take = q.limit ?? 20;
    const cursor = q.cursor && q.cursor.trim() ? { id: q.cursor.trim() } : null;

    const apps = await prisma.jobApplication.findMany({
      where,
      take: take + 1, // fetch one extra to know if there's a next page
      ...(cursor ? { cursor, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
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

    let nextCursor: string | null = null;
    if (apps.length > take) {
      const last = apps[apps.length - 1];
      nextCursor = last.id;
      apps.pop();
    }

    // role summary – useful for filters
    // NOTE: Prisma 6.19.2 does NOT allow `_all` inside `orderBy._count`
    // so we sort by the count of `id` instead (equivalent to total rows).
    const roleSummary = await prisma.jobApplication.groupBy({
      by: ["roleId", "roleTitle"],
      _count: { _all: true },
      orderBy: {
        _count: {
          id: "desc", // ✅ valid: sort by count of `id` per group
        },
      },
    });

    res.json({
      items: apps,
      nextCursor,
      roleSummary: roleSummary.map((r) => ({
        roleId: r.roleId,
        roleTitle: r.roleTitle,
        count: r._count._all,
      })),
    });
  })
);

/* ----------------------------------------------------------------------------
 * PATCH /api/admin/careers/applications/:id
 * --------------------------------------------------------------------------*/
router.patch(
  "/applications/:id",
  wrap(async (req: Request, res: Response) => {
    const id = requiredString( req.params.id);
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
