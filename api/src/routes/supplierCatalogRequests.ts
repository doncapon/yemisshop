import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const r = Router();

/** Convert empty strings -> undefined (so .optional() fields don't fail .min(1)) */
const emptyToUndef = (v: unknown) => {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t.length ? t : undefined;
};

/** Case-insensitive enum for type */
const TypeSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
  z.enum(["BRAND", "CATEGORY", "ATTRIBUTE", "ATTRIBUTE_VALUE"])
);

const AttributeTypeSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
  z.enum(["TEXT", "SELECT", "MULTISELECT"])
);

/**
 * UI sends:
 * { type, name, slug?, notes?, parentId?, attributeType?, attributeId?, valueName?, valueCode? }
 */
const baseSchema = z.object({
  type: TypeSchema,

  name: z.preprocess(emptyToUndef, z.string().min(1)).optional(),
  slug: z.preprocess(emptyToUndef, z.string().min(1)).optional(),
  notes: z.preprocess(emptyToUndef, z.string().max(500)).optional(),
  parentId: z.preprocess(emptyToUndef, z.string().min(1)).optional(),

  // attribute-specific
  attributeType: AttributeTypeSchema.optional(),
  attributeId: z.preprocess(emptyToUndef, z.string().min(1)).optional(),
  valueName: z.preprocess(emptyToUndef, z.string().min(1)).optional(),
  valueCode: z.preprocess(emptyToUndef, z.string().min(1)).optional(),
});

type BaseInput = z.infer<typeof baseSchema>;

function buildPayload(input: BaseInput) {
  switch (input.type) {
    case "CATEGORY":
      return {
        name: input.name,
        slug: input.slug ?? null,
        parentId: input.parentId ?? null,
        notes: input.notes ?? null,
      };

    case "BRAND":
      return {
        name: input.name,
        slug: input.slug ?? null,
        notes: input.notes ?? null,
      };

    case "ATTRIBUTE":
      return {
        name: input.name,
        type: input.attributeType ?? "SELECT",
        notes: input.notes ?? null,
      };

    case "ATTRIBUTE_VALUE":
      return {
        attributeId: input.attributeId,
        name: input.valueName,
        code: input.valueCode ?? null,
        notes: input.notes ?? null,
      };
  }
}

function validateByType(input: BaseInput) {
  if (input.type === "CATEGORY") {
    if (!input.name) return "Category name is required";
  }
  if (input.type === "BRAND") {
    if (!input.name) return "Brand name is required";
  }
  if (input.type === "ATTRIBUTE") {
    if (!input.name) return "Attribute name is required";
    if (!input.attributeType) return "attributeType is required";
  }
  if (input.type === "ATTRIBUTE_VALUE") {
    if (!input.attributeId) return "attributeId is required";
    if (!input.valueName) return "valueName is required";
  }
  return null;
}

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
  const hasPageStyle =
    Number.isFinite(rawPage) ||
    Number.isFinite(rawPageSize);

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

/**
 * POST /api/supplier/catalog-requests
 */
r.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = baseSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", issues: parsed.error.flatten() });
    }

    const input = parsed.data;

    const typeErr = validateByType(input);
    if (typeErr) return res.status(400).json({ error: typeErr });

    const supplier = await prisma.supplier.findUnique({
      where: { userId: req.user!.id },
      select: { id: true },
    });

    if (!supplier) {
      return res.status(403).json({ error: "Supplier account not found for this user" });
    }

    const payload = buildPayload(input);

    const created = await prisma.catalogRequest.create({
      data: {
        type: input.type,
        supplierId: supplier.id,
        payload: payload as any,
        reason: input.notes ?? null,
      },
    });

    return res.status(201).json({ ok: true, request: created });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/supplier/catalog-requests
 * Server-side pagination:
 * - page=1&pageSize=20
 * - or take=20&skip=0
 *
 * Optional filters:
 * - status=PENDING|APPROVED|REJECTED
 * - type=BRAND|CATEGORY|ATTRIBUTE|ATTRIBUTE_VALUE
 * - q=search text
 */
r.get("/", requireAuth, async (req, res, next) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { userId: req.user!.id },
      select: { id: true },
    });

    if (!supplier) {
      return res.status(403).json({ error: "Supplier account not found for this user" });
    }

    const { page, pageSize, skip, take } = toPagination(req, {
      pageSize: 20,
      maxPageSize: 100,
    });

    const rawStatus = String(req.query.status ?? "").trim().toUpperCase();
    const rawType = String(req.query.type ?? "").trim().toUpperCase();
    const q = String(req.query.q ?? "").trim();

    const allowedStatuses = new Set(["PENDING", "APPROVED", "REJECTED"]);
    const allowedTypes = new Set(["BRAND", "CATEGORY", "ATTRIBUTE", "ATTRIBUTE_VALUE"]);

    const where: any = {
      supplierId: supplier.id,
    };

    if (rawStatus && allowedStatuses.has(rawStatus)) {
      where.status = rawStatus;
    }

    if (rawType && allowedTypes.has(rawType)) {
      where.type = rawType;
    }

    if (q) {
      where.OR = [
        { reason: { contains: q, mode: "insensitive" } },
        { payload: { path: ["name"], string_contains: q } },
        { payload: { path: ["slug"], string_contains: q } },
        { payload: { path: ["notes"], string_contains: q } },
        { payload: { path: ["code"], string_contains: q } },
        { payload: { path: ["attributeId"], string_contains: q } },
        { payload: { path: ["parentId"], string_contains: q } },
      ];
    }

    const [rows, total] = await prisma.$transaction([
      prisma.catalogRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      prisma.catalogRequest.count({ where }),
    ]);

    const mappedRows = rows.map((row: any) => {
      const p = (row.payload ?? {}) as any;

      return {
        ...row,
        name: p.name ?? null,
        slug: p.slug ?? null,
        parentId: p.parentId ?? null,
        notes: p.notes ?? row.reason ?? null,
        attributeType: p.type ?? null,
        attributeId: p.attributeId ?? null,
        valueName: row.type === "ATTRIBUTE_VALUE" ? (p.name ?? null) : null,
        valueCode: row.type === "ATTRIBUTE_VALUE" ? (p.code ?? null) : null,
      };
    });

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return res.json({
      data: {
        rows: mappedRows,
        total,
        page,
        pageSize,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (e) {
    next(e);
  }
});

export default r;