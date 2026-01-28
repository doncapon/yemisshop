import { Router } from "express";
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
 * UI sends: { type, name, slug?, notes?, parentId?, attributeType?, attributeId?, valueName?, valueCode? }
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
        name: input.valueName,          // stored as "name"
        code: input.valueCode ?? null,  // stored as "code"
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
        // status defaults to PENDING
      },
    });

    return res.status(201).json({ ok: true, request: created });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/supplier/catalog-requests
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

    const rows = await prisma.catalogRequest.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: "desc" },
    });

    const data = rows.map((row: { payload: any; reason: any; }) => {
      const p = (row.payload ?? {}) as any;

      // payload shapes:
      // - CATEGORY/BRAND: { name, slug, notes, parentId? }
      // - ATTRIBUTE: { name, type, notes }
      // - ATTRIBUTE_VALUE: { attributeId, name, code, notes }

      return {
        ...row,

        // Common UI fields
        name: p.name ?? null,
        slug: p.slug ?? null,
        parentId: p.parentId ?? null,
        notes: p.notes ?? row.reason ?? null,

        // Attribute fields
        attributeType: p.type ?? null,       // for ATTRIBUTE, p.type is TEXT/SELECT/MULTISELECT
        attributeId: p.attributeId ?? null,  // for ATTRIBUTE_VALUE

        // Attribute value fields
        valueName: p.name ?? null,           // ATTRIBUTE_VALUE stored as p.name
        valueCode: p.code ?? null,           // ATTRIBUTE_VALUE stored as p.code
      };
    });

    res.json({ data });
  } catch (e) {
    next(e);
  }
});

export default r;
