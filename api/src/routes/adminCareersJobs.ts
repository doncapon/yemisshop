// api/src/routes/adminCareersJobs.ts
import express from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
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

const employmentTypeEnum = z
  .enum(["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY", "INTERN"])
  .optional()
  .nullable();

const locationTypeEnum = z
  .enum(["ONSITE", "HYBRID", "REMOTE"])
  .optional()
  .nullable();
const baseJobShape = {
  title: z.string().min(2),

  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase, alphanumeric, and dashes"),

  department: z.string().min(1).optional().nullable(),
  location: z.string().min(1).optional().nullable(),
  employmentType: employmentTypeEnum,
  locationType: locationTypeEnum,

  minSalary: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number().int().nonnegative().optional()
  ),

  maxSalary: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number().int().nonnegative().optional()
  ),

  currency: z.string().min(1).optional().nullable(),

  isPublished: z.coerce.boolean().optional(),

  sortOrder: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number().int().optional()
  ),

  applicationEmail: z.string().email().optional().nullable(),
  applicationUrl: z.string().url().optional().nullable(),

  introHtml: z.string().optional().nullable(),

  responsibilitiesJson: z.union([z.string(), z.any()]).optional().nullable(),
  requirementsJson: z.union([z.string(), z.any()]).optional().nullable(),
  benefitsJson: z.union([z.string(), z.any()]).optional().nullable(),

  // 🔧 Simpler + version-safe: just accept a string, we’ll turn it into Date later
  closingDate: z.string().optional().nullable(),
};

const createJobSchema = z.object(baseJobShape);

const updateJobSchema = z.object({
  id: z.string().nonempty(), // or requiredString if you prefer your helper

  // 🔧 Make all fields optional on update (including slug) WITHOUT redefining slug twice
  ...Object.fromEntries(
    Object.entries(baseJobShape).map(([key, schema]) => [
      key,
      (schema as any).optional(),
    ])
  ),
});

// list / filter
const listQuerySchema = z.object({
  search: z.string().optional(),
  department: z.string().optional(),
  isPublished: z
    .enum(["0", "1"])
    .transform((v) => v === "1")
    .optional(),
  includeDeleted: z
    .enum(["0", "1"])
    .transform((v) => v === "1")
    .optional(),
  page: z
    .preprocess((v) => (v == null || v === "" ? undefined : Number(v)), z.number().int().min(1))
    .optional()
    .default(1),
  pageSize: z
    .preprocess((v) => (v == null || v === "" ? undefined : Number(v)), z.number().int().min(1))
    .optional()
    .default(20),
});

/* ----------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------*/

function parseJsonMaybe(v: any) {
  if (v == null || v === "") return undefined;
  if (typeof v === "object") return v;
  if (typeof v !== "string") return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

/* ----------------------------------------------------------------------------
 * Routes
 * --------------------------------------------------------------------------*/

// GET /api/admin/careers/jobs
router.get(
  "/",
  requireAuth,
  requireAdmin,
  wrap(async (req, res) => {
    const { search, department, isPublished, includeDeleted, page, pageSize } =
      listQuerySchema.parse(req.query);

    const where: Prisma.CareersJobRoleWhereInput = {
      isDeleted: includeDeleted ? undefined : false,
    };

    if (typeof isPublished === "boolean") {
      where.isPublished = isPublished;
    }

    if (department) {
      where.department = { contains: department, mode: "insensitive" };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
        { department: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
      ];
    }

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const [items, total] = await Promise.all([
      prisma.careersJobRole.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
      prisma.careersJobRole.count({ where }),
    ]);

    res.json({
      items,
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
    });
  })
);

// GET /api/admin/careers/jobs/:id
router.get(
  "/:id",
  requireAuth,
  requireAdmin,
  wrap(async (req, res) => {
    const id = requiredString(req.params.id);

    const job = await prisma.careersJobRole.findFirst({
      where: { id, isDeleted: false },
    });

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json(job);
  })
);

// POST /api/admin/careers/jobs
router.post(
  "/",
  requireAuth,
  requireAdmin,
  wrap(async (req, res) => {
    const data = createJobSchema.parse(req.body);

    const job = await prisma.careersJobRole.create({
      data: {
        ...data,
        responsibilitiesJson: parseJsonMaybe(data.responsibilitiesJson),
        requirementsJson: parseJsonMaybe(data.requirementsJson),
        benefitsJson: parseJsonMaybe(data.benefitsJson),
        closingDate: data.closingDate
          ? new Date(data.closingDate as string)
          : undefined,
      },
    });

    res.status(201).json(job);
  })
);

// PATCH /api/admin/careers/jobs/:id
router.patch(
  "/:id",
  requireAuth,
  requireAdmin,
  wrap(async (req, res) => {
    const id = requiredString(req.params.id);
    const payload = updateJobSchema.parse({ ...req.body, id });

    const existing = await prisma.careersJobRole.findFirst({
      where: { id, isDeleted: false },
    });

    if (!existing) {
      return res.status(404).json({ error: "Job not found" });
    }

    const updateData: Prisma.CareersJobRoleUpdateInput = {};

    // only assign defined fields (avoid overwriting with undefined)
    for (const [key, value] of Object.entries(payload)) {
      if (key === "id") continue;
      if (value === undefined) continue;

      if (key === "responsibilitiesJson" || key === "requirementsJson" || key === "benefitsJson") {
        (updateData as any)[key] = parseJsonMaybe(value);
      } else if (key === "closingDate") {
        (updateData as any)[key] = value ? new Date(value as string) : null;
      } else {
        (updateData as any)[key] = value as any;
      }
    }

    const updated = await prisma.careersJobRole.update({
      where: { id },
      data: updateData,
    });

    res.json(updated);
  })
);

// DELETE /api/admin/careers/jobs/:id (soft-delete)
router.delete(
  "/:id",
  requireAuth,
  requireAdmin,
  wrap(async (req, res) => {
    const id = requiredString(req.params.id);

    const existing = await prisma.careersJobRole.findFirst({
      where: { id, isDeleted: false },
    });

    if (!existing) {
      return res.status(404).json({ error: "Job not found" });
    }

    const updated = await prisma.careersJobRole.update({
      where: { id },
      data: {
        isDeleted: true,
        isPublished: false,
      },
    });

    res.json(updated);
  })
);

export default router;