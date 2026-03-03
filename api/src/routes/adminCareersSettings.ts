// api/src/routes/adminCareersSettings.ts
import express from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { z } from "zod";

import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

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

const locationTypeEnum = z
  .enum(["ONSITE", "HYBRID", "REMOTE"])
  .optional()
  .nullable();

const settingsSchema = z.object({
  isCareersEnabled: z.coerce.boolean().optional(),
  allowOpenApplications: z.coerce.boolean().optional(),

  careersEmail: z.string().email().optional().nullable(),
  careersInboxLabel: z.string().optional().nullable(),
  defaultLocation: z.string().optional().nullable(),
  defaultLocationType: locationTypeEnum,

  careersIntroHtml: z.string().optional().nullable(),
  careersFooterHtml: z.string().optional().nullable(),
  seoTitle: z.string().optional().nullable(),
  seoDescription: z.string().optional().nullable(),
});

/* ----------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------*/

async function getOrCreateSettings() {
  let settings = await prisma.careersSettings.findFirst({
    where: { id: 1 },
  });

  if (!settings) {
    settings = await prisma.careersSettings.create({
      data: {
        id: 1,
        isCareersEnabled: true,
        allowOpenApplications: false,
      },
    });
  }

  return settings;
}

/* ----------------------------------------------------------------------------
 * Routes
 * --------------------------------------------------------------------------*/

// GET /api/admin/careers/settings
router.get(
  "/",
  requireAuth,
  requireAdmin,
  wrap(async (req, res) => {
    const settings = await getOrCreateSettings();
    res.json(settings);
  })
);

// PATCH /api/admin/careers/settings
router.patch(
  "/",
  requireAuth,
  requireAdmin,
  wrap(async (req, res) => {
    const payload = settingsSchema.parse(req.body);

    const updated = await prisma.careersSettings.update({
      where: { id: 1 },
      data: payload,
    });

    res.json(updated);
  })
);

export default router;