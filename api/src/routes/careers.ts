// api/src/routes/careers.ts
import {
    Router,
    type Request,
    type Response,
    type NextFunction,
    type RequestHandler,
} from "express";
import { z } from "zod";
import multer from "multer";
import { sendMail } from "../lib/email.js";
import { prisma } from "../lib/prisma.js";
import type { Prisma } from "@prisma/client";

const router = Router();

const wrap =
    (fn: (req: Request, res: Response, next: NextFunction) => any): RequestHandler =>
        (req, res, next) =>
            Promise.resolve(fn(req, res, next)).catch(next);

/* ----------------------------------------------------------------------------
 * Multer setup for CV upload
 * --------------------------------------------------------------------------*/

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
    },
    fileFilter: (req, file, cb) => {
        // Accept common CV formats
        const allowed = [
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/rtf",
            "application/vnd.oasis.opendocument.text",
        ];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Unsupported file type. Please upload a PDF or Word document."));
        }
    },
});



function isRefundOpenStatus(status: any) {
    const s = String(status ?? "").toUpperCase();
    return [
        "REQUESTED",
        "SUPPLIER_REVIEW",
        "SUPPLIER_ACCEPTED",
        "SUPPLIER_REJECTED",
        "ESCALATED",
        "APPROVED",
        "PROCESSING",
    ].includes(s);
}
/* ----------------------------------------------------------------------------
 * Zod schema (fields come from multipart/form-data)
 * --------------------------------------------------------------------------*/

const applySchema = z.object({
    name: z.string().min(1).max(120),
    email: z.string().email(),
    roleId: z.string().max(200).nullable().optional(),
    roleTitle: z.string().max(200).nullable().optional(),
    linkedinUrl: z
        .string()
        .max(500)
        .optional()
        .or(z.literal("")),
    message: z.string().min(10).max(5000),
});

/* ----------------------------------------------------------------------------
 * Simple in-memory rate limiting (per process)
 * --------------------------------------------------------------------------*/

type Counter = { count: number; firstAt: number };

const emailLimits = new Map<string, Counter>();
const ipLimits = new Map<string, Counter>();

const EMAIL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const EMAIL_MAX = 3;

const IP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const IP_MAX = 10;

function checkAndBumpCounter(
    map: Map<string, Counter>,
    key: string,
    windowMs: number,
    limit: number
): boolean {
    const now = Date.now();
    const existing = map.get(key);

    if (!existing) {
        map.set(key, { count: 1, firstAt: now });
        return true;
    }

    if (now - existing.firstAt > windowMs) {
        map.set(key, { count: 1, firstAt: now });
        return true;
    }

    if (existing.count >= limit) {
        return false;
    }

    existing.count += 1;
    return true;
}

function getClientIp(req: Request): string {
    const xff = (req.headers["x-forwarded-for"] as string | undefined) || "";
    const first = xff.split(",")[0].trim();
    return first || (req.ip as string) || "unknown";
}

/* ----------------------------------------------------------------------------
 * Route: POST /api/careers/apply
 * --------------------------------------------------------------------------*/

router.post(
    "/apply",
    upload.single("cvFile"),
    wrap(async (req: Request, res: Response) => {
        const body = applySchema.parse(req.body);

        const {
            name,
            email,
            roleId,
            roleTitle,
            linkedinUrl,
            message,
        } = body;

        const ip = getClientIp(req);
        const userAgent = (req.headers["user-agent"] as string | undefined) || null;

        // Multer puts file on req.file if provided
        const file = req.file || null;

        // --- Rate limits ---
        const okEmail = checkAndBumpCounter(
            emailLimits,
            email.toLowerCase(),
            EMAIL_WINDOW_MS,
            EMAIL_MAX
        );
        if (!okEmail) {
            return res.status(429).json({
                error:
                    "You’ve reached the limit for applications from this email in a short period. Please try again later.",
            });
        }

        const okIp = checkAndBumpCounter(ipLimits, ip, IP_WINDOW_MS, IP_MAX);
        if (!okIp) {
            return res.status(429).json({
                error:
                    "You’ve reached the limit for applications from this network. Please try again later.",
            });
        }

        const finalRoleTitle = roleTitle || "General application";

        // --- Persist to database ---
        const appRecord = await prisma.jobApplication.create({
            data: {
                name,
                email,
                roleId: roleId || null,
                roleTitle: finalRoleTitle,
                linkedinUrl: linkedinUrl || null,
                // we can store file metadata for reference
                cvFilename: file?.originalname || null,
                cvMimeType: file?.mimetype || null,
                cvSize: file?.size ?? null,
                message,
                ip,
                userAgent,
            },
        });

        // --- Build email HTML ---
        const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#111">
        <h2 style="margin:0 0 6px 0">New job application — DaySpring</h2>
        <p style="margin:0 0 10px 0;color:#374151;">You received a new application from the careers page.</p>

        <div style="margin:10px 0 14px 0;padding:10px 12px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;">
          <p style="margin:0;font-size:14px;"><strong>Name:</strong> ${name}</p>
          <p style="margin:4px 0;font-size:14px;">
            <strong>Email:</strong> <a href="mailto:${email}">${email}</a>
          </p>
          <p style="margin:4px 0;font-size:14px;">
            <strong>Role:</strong> ${finalRoleTitle}${roleId ? ` <span style="color:#6b7280;font-size:12px;">(${roleId})</span>` : ""
            }
          </p>

          ${linkedinUrl && linkedinUrl.trim()
                ? `<p style="margin:4px 0;font-size:14px;">
                   <strong>LinkedIn:</strong> <a href="${linkedinUrl}" target="_blank" rel="noreferrer">${linkedinUrl}</a>
                 </p>`
                : ""
            }

          ${file
                ? `<p style="margin:4px 0;font-size:14px;">
                   <strong>CV attached:</strong> ${file.originalname} (${Math.round(file.size / 1024)} KB)
                 </p>`
                : `<p style="margin:4px 0;font-size:14px;color:#b91c1c;"><strong>No CV attached</strong></p>`
            }

          <p style="margin:4px 0;font-size:12px;color:#6b7280;">
            Application ID: <span style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace">
              ${appRecord.id}
            </span>
          </p>
        </div>

        <p style="margin:0 0 6px 0;font-size:14px;"><strong>Message:</strong></p>
        <p style="margin:0 0 12px 0;white-space:pre-wrap;font-size:14px;">
          ${message}
        </p>

        <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb;" />
        <p style="margin:0;font-size:12px;color:#6b7280;">
          This application was submitted via the DaySpring careers page.
          ${ip
                ? `<br/>IP: <span style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace">${ip}</span>`
                : ""
            }
        </p>
      </div>
    `;

        // Build attachment array if file present
        const attachments =
            file && file.buffer
                ? [
                    {
                        filename: file.originalname,
                        content: file.buffer,
                        contentType: file.mimetype,
                    },
                ]
                : undefined;

        await sendMail({
            to: "careers@dayspring.com",
            subject: `Job application — ${finalRoleTitle}`,
            html,
            replyTo: email,
            attachments,
        });

        res.json({ ok: true, id: appRecord.id });
    })
);


/* ----------------------------------------------------------------------------
 * Zod schemas
 * --------------------------------------------------------------------------*/

const listQuerySchema = z.object({
    search: z.string().optional(),
    department: z.string().optional(),
    employmentType: z
        .enum(["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY", "INTERN"])
        .optional(),
    locationType: z.enum(["ONSITE", "HYBRID", "REMOTE"]).optional(),
    includeClosed: z
        .enum(["0", "1"])
        .transform((v) => v === "1")
        .optional()
        .default("0"),
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

const todayUtc = () => {
    const d = new Date();
    // normalise to midnight if you want date-only filtering – but
    // here just use now; closed = closingDate < now
    return d;
};

/* ----------------------------------------------------------------------------
 * Routes
 * --------------------------------------------------------------------------*/

// GET /api/careers/jobs
router.get(
    "/jobs",
    wrap(async (req, res) => {
        const { search, department, employmentType, locationType, includeClosed, page, pageSize } =
            listQuerySchema.parse(req.query);

        const where: Prisma.CareersJobRoleWhereInput = {
            isDeleted: false,
            isPublished: true,
        };

        if (!includeClosed) {
            const now = todayUtc();
            where.OR = [
                { closingDate: null },
                { closingDate: { gte: now } },
            ];
        }

        if (department) {
            where.department = { contains: department, mode: "insensitive" };
        }

        if (employmentType) {
            where.employmentType = employmentType as any;
        }

        if (locationType) {
            where.locationType = locationType as any;
        }

        if (search) {
            where.OR = [
                ...(where.OR ?? []),
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
                // You can trim the fields here if you want a lighter payload
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

// GET /api/careers/jobs/:slug
router.get(
    "/jobs/:slug",
    wrap(async (req, res) => {
        const slug = String(req.params.slug || "").trim();

        if (!slug) {
            return res.status(400).json({ error: "Missing slug" });
        }

        const now = todayUtc();

        const job = await prisma.careersJobRole.findFirst({
            where: {
                slug,
                isDeleted: false,
                isPublished: true,
                OR: [
                    { closingDate: null },
                    { closingDate: { gte: now } },
                ],
            },
        });

        if (!job) {
            return res.status(404).json({ error: "Job not found" });
        }

        res.json(job);
    })
);

export default router;