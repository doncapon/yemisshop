// api/src/routes/adminCatalogRequests.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import slugify from "../lib/slugify.js";
import { z } from "zod";

const r = Router();
r.use(requireAuth, requireAdmin);

const CatalogRequestTypeZ = z.enum(["BRAND", "CATEGORY", "ATTRIBUTE", "ATTRIBUTE_VALUE"]);
const CatalogRequestStatusZ = z.enum(["PENDING", "APPROVED", "REJECTED"]);

const CategoryPayloadZ = z.object({
  name: z.string().min(1),
  slug: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  position: z.number().int().optional().nullable(),
  isActive: z.boolean().optional().nullable(),
});

const BrandPayloadZ = z.object({
  name: z.string().min(1),
  slug: z.string().optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  isActive: z.boolean().optional().nullable(),
});

const AttributePayloadZ = z.object({
  name: z.string().min(1),
  type: z.enum(["TEXT", "SELECT", "MULTISELECT"]).default("SELECT"),
  placeholder: z.string().optional().nullable(),
  isActive: z.boolean().optional().nullable(),
});

const AttributeValuePayloadZ = z.object({
  attributeId: z.string().min(1),
  name: z.string().min(1),
  code: z.string().optional().nullable(),
  position: z.number().int().optional().nullable(),
  isActive: z.boolean().optional().nullable(),
});

function validatePayloadByType(type: z.infer<typeof CatalogRequestTypeZ>, payload: unknown) {
  switch (type) {
    case "CATEGORY":
      return CategoryPayloadZ.parse(payload);
    case "BRAND":
      return BrandPayloadZ.parse(payload);
    case "ATTRIBUTE":
      return AttributePayloadZ.parse(payload);
    case "ATTRIBUTE_VALUE":
      return AttributeValuePayloadZ.parse(payload);
    default:
      throw new Error("Unsupported type");
  }
}

function prismaUniqueConflict(e: any) {
  return e?.code === "P2002";
}

/**
 * GET /api/admin/catalog-requests
 * Optional query: ?status=PENDING&type=CATEGORY
 */
r.get("/", async (req, res, next) => {
  try {
    const status = req.query.status ? CatalogRequestStatusZ.parse(req.query.status) : undefined;
    const type = req.query.type ? CatalogRequestTypeZ.parse(req.query.type) : undefined;

    const rows = await prisma.catalogRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      include: {
        supplier: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/admin/catalog-requests/:id
 * Edit payload/adminNote BEFORE approving.
 * Only allowed if status=PENDING.
 */
r.patch("/:id", async (req, res, next) => {
  try {
    const id = req.params.id;

    const bodyZ = z.object({
      payload: z.any().optional(),
      adminNote: z.string().optional().nullable(),
    });
    const body = bodyZ.parse(req.body ?? {});

    const existing = await prisma.catalogRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.status !== "PENDING") {
      return res.status(409).json({ error: "Only PENDING requests can be edited" });
    }

    const nextPayload =
      body.payload !== undefined ? validatePayloadByType(existing.type as any, body.payload) : existing.payload;

    const updated = await prisma.catalogRequest.update({
      where: { id },
      data: {
        payload: nextPayload as any,
        ...(body.adminNote !== undefined ? { adminNote: body.adminNote } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true } },
      },
    });

    res.json({ ok: true, request: updated });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/admin/catalog-requests/:id/approve
 * Uses whatever payload is currently stored (after PATCH edits).
 */
r.post("/:id/approve", async (req, res, next) => {
  try {
    const id = req.params.id;

    const result = await prisma.$transaction(async (tx: { catalogRequest: { findUnique: (arg0: { where: { id: string; }; }) => any; update: (arg0: { where: { id: string; }; data: { status: string; reviewedAt: Date; reviewedById: any; }; }) => any; }; category: { create: (arg0: { data: { name: string; slug: string; parentId: string | null; position: number; isActive: boolean; }; }) => any; }; brand: { create: (arg0: { data: { name: string; slug: string; logoUrl: string | null; isActive: boolean; }; }) => any; }; attribute: { create: (arg0: { data: { name: string; type: "TEXT" | "SELECT" | "MULTISELECT"; isActive: boolean; }; }) => any; findUnique: (arg0: { where: { id: string; }; }) => any; }; attributeValue: { create: (arg0: { data: { attributeId: string; name: string; code: string | null; position: number; isActive: boolean; }; }) => any; }; }) => {
      const reqRow = await tx.catalogRequest.findUnique({ where: { id } });
      if (!reqRow) return { status: 404 as const, body: { error: "Not found" } };
      if (reqRow.status !== "PENDING") {
        return { status: 409 as const, body: { error: "Request is not PENDING" } };
      }

      // Validate payload shape for safety (also normalizes)
      const payload = validatePayloadByType(reqRow.type as any, reqRow.payload);

      // Create the actual catalog entity
      let created: any = null;

      try {
        if (reqRow.type === "CATEGORY") {
          const p = payload as z.infer<typeof CategoryPayloadZ>;
          const name = p.name.trim();
          const slug = (p.slug?.trim() || slugify(name)).toString();

          created = await tx.category.create({
            data: {
              name,
              slug,
              parentId: p.parentId || null,
              position: p.position ?? 0,
              isActive: p.isActive ?? true,
            },
          });
        }

        if (reqRow.type === "BRAND") {
          const p = payload as z.infer<typeof BrandPayloadZ>;
          const name = p.name.trim();
          const slug = (p.slug?.trim() || slugify(name)).toString();

          created = await tx.brand.create({
            data: {
              name,
              slug,
              logoUrl: p.logoUrl?.trim() || null,
              isActive: p.isActive ?? true,
            },
          });
        }

        if (reqRow.type === "ATTRIBUTE") {
          const p = payload as z.infer<typeof AttributePayloadZ>;
          const name = p.name.trim();

          created = await tx.attribute.create({
            data: {
              name,
              type: p.type,
              isActive: p.isActive ?? true,
              // NOTE: your Attribute model doesn’t show placeholder field in schema;
              // if you later add it, include it here.
            },
          });
        }

        if (reqRow.type === "ATTRIBUTE_VALUE") {
          const p = payload as z.infer<typeof AttributeValuePayloadZ>;

          // ensure attribute exists
          const attr = await tx.attribute.findUnique({ where: { id: p.attributeId } });
          if (!attr) {
            return { status: 400 as const, body: { error: "attributeId is invalid (attribute not found)" } };
          }

          created = await tx.attributeValue.create({
            data: {
              attributeId: p.attributeId,
              name: p.name.trim(),
              code: p.code?.trim() || null,
              position: p.position ?? 0,
              isActive: p.isActive ?? true,
            },
          });
        }
      } catch (e: any) {
        if (prismaUniqueConflict(e)) {
          return { status: 409 as const, body: { error: "Already exists (unique constraint)" } };
        }
        throw e;
      }

      const reviewedById = (req as any).user?.id || null;

      const updatedRequest = await tx.catalogRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          reviewedAt: new Date(),
          reviewedById,
        },
      });

      return { status: 200 as const, body: { ok: true, request: updatedRequest, created } };
    });

    return res.status(result.status).json(result.body);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/admin/catalog-requests/:id/reject
 */
r.post("/:id/reject", async (req, res, next) => {
  try {
    const id = req.params.id;
    const bodyZ = z.object({ adminNote: z.string().optional().nullable() });
    const body = bodyZ.parse(req.body ?? {});

    const existing = await prisma.catalogRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.status !== "PENDING") {
      return res.status(409).json({ error: "Request is not PENDING" });
    }

    const reviewedById = (req as any).user?.id || null;

    const updated = await prisma.catalogRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        adminNote: body.adminNote ?? existing.adminNote,
        reviewedAt: new Date(),
        reviewedById,
      },
    });

    res.json({ ok: true, request: updated });
  } catch (e) {
    next(e);
  }
});

export default r;
