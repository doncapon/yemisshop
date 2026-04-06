// api/src/routes/auth.ts
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";

import { prisma } from "../lib/prisma.js";
import { sendVerifyEmail, sendResetorForgotPasswordEmail } from "../lib/email.js";
import { signJwt, signAccessJwt } from "../lib/jwt.js";
import { requireAuth, requireVerifySession } from "../middleware/auth.js";
import { issueOtp, verifyOtp } from "../lib/otp.js";
import { Prisma, SupplierType } from "@prisma/client";
import {
  setAccessTokenCookie,
  clearAuthCookies,
  getAccessTokenCookieName,
} from "../lib/authCookies.js";

// ---------------- ENV / constants ----------------
const APP_URL = process.env.APP_URL || "http://localhost:5173";
const API_BASE_URL = process.env.API_URL || "http://localhost:8080";
const EMAIL_JWT_SECRET = process.env.EMAIL_JWT_SECRET || "CHANGE_ME_DEV_SECRET";

const EMAIL_RESEND_COOLDOWN_SEC = 60;
const EMAIL_DAILY_CAP = 5;
const EMAIL_TTL_MIN = 60;

const RESEND_COOLDOWN_SEC = 60;
const DAILY_CAP = 50;

// ---------------- Schemas ----------------
const RegisterSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    firstName: z.string().min(1),
    middleName: z.string().optional(),
    lastName: z.string().min(1),
    role: z.string().default("SHOPPER"),

    // selected dial code from country picker
    dialCode: z.preprocess(
      (v) => {
        const s = String(v ?? "").trim();
        return s ? s : undefined;
      },
      z
        .string()
        .refine((v) => /^\+\d{1,4}$/.test(v), "Invalid country dial code")
        .optional()
    ),

    // can be local or user-typed with leading 0 / 00
    localPhone: z.preprocess(
      (v) => {
        const s = String(v ?? "").trim();
        return s ? s : undefined;
      },
      z
        .string()
        .transform((v) => v.replace(/[^\d+]/g, ""))
        .refine((v) => v.length >= 6, "Please enter a valid phone number")
        .refine((v) => v.length <= 18, "Please enter a valid phone number")
        .optional()
    ),

    dateOfBirth: z
      .string()
      .transform((s) => new Date(s))
      .refine((d) => !Number.isNaN(+d), { message: "Invalid date of birth" })
      .refine(
        (d) => {
          const today = new Date();
          const years = (today.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
          return years >= 16;
        },
        { message: "You must be at least 16 years old" }
      ),
  })
  .superRefine((data, ctx) => {
    const hasDialCode = !!data.dialCode;
    const hasLocalPhone = !!data.localPhone;

    if (hasDialCode !== hasLocalPhone) {
      if (!hasDialCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dialCode"],
          message: "Country dial code is required when phone number is provided",
        });
      }

      if (!hasLocalPhone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["localPhone"],
          message: "Phone number is required when country dial code is provided",
        });
      }
    }
  });

function isPhoneVerificationRequired(user: {
  role?: string | null;
  phone?: string | null;
}) {
  const role = String(user.role ?? "").trim().toUpperCase();
  const hasPhone = !!String(user.phone ?? "").trim();
  return role === "SUPPLIER" || hasPhone;
}

const VerifyPhoneSchema = z.object({
  email: z.string().email(),
  otp: z.string().min(4).max(8),
});

const ForgotSchema = z.object({ email: z.string().email() });
const ResetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8),
});

const router = Router();

/** Issue a JWT email-verify link and send it via the central mail helper */
async function issueAndEmailEmailVerification(userId: string, email: string) {
  const token = jwt.sign({ sub: userId, email, k: "email-verify" }, EMAIL_JWT_SECRET, {
    expiresIn: "60m",
  });

  const verifyUrl = `${API_BASE_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await sendVerifyEmail(email, verifyUrl);
}

// ---------------- helpers ----------------
const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler =>
    (req, res, next) => {
      fn(req, res, next).catch(next);
    };

function normalizeDialCode(input?: string | null): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits || digits.length > 4) return null;
  return `+${digits}`;
}

function normalizePhoneToE164(
  input: unknown,
  opts?: {
    dialCode?: string | null;
    assumeLocalIfNoPlus?: boolean;
  }
): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  const dialCode = normalizeDialCode(opts?.dialCode ?? null);
  const cleaned = raw.replace(/[^\d+]/g, "");

  // Already international format
  if (/^\+\d{8,15}$/.test(cleaned)) {
    return cleaned;
  }

  // Starts with 00 => remove 00 and add +
  if (/^00\d{8,15}$/.test(cleaned)) {
    return `+${cleaned.slice(2)}`;
  }

  // Starts with 0 => remove 0 and prefix selected country dial code
  if (/^0\d{6,14}$/.test(cleaned)) {
    if (!dialCode) return null;
    return `${dialCode}${cleaned.slice(1)}`;
  }

  // Plain digits => treat as local if dial code exists
  if (/^\d{6,15}$/.test(cleaned)) {
    if (opts?.assumeLocalIfNoPlus === false) {
      return `+${cleaned}`;
    }
    if (!dialCode) return null;
    return `${dialCode}${cleaned}`;
  }

  return null;
}

function getCountryCodeDigitsFromDialCode(dialCode?: string | null): string | null {
  const dc = normalizeDialCode(dialCode);
  return dc ? dc.slice(1) : null;
}

function getNationalNumberFromE164(e164: string, dialCode?: string | null): string | null {
  const dc = normalizeDialCode(dialCode);
  if (!dc) return null;
  if (!e164.startsWith(dc)) return null;
  const national = e164.slice(dc.length);
  return national || null;
}

function normRoleLoose(role: unknown) {
  let r = String(role ?? "").trim().toUpperCase();
  r = r.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
  if (r === "SUPERADMIN") r = "SUPER_ADMIN";
  if (r === "SUPER_ADMINISTRATOR") r = "SUPER_ADMIN";
  return r;
}

function getSessionTtlDays(role: unknown) {
  const r = normRoleLoose(role);
  return r === "ADMIN" ||
    r === "SUPER_ADMIN" ||
    r === "SUPPLIER" ||
    r === "SUPPLIER_RIDER"
    ? 7
    : 30;
}

function buildPublicProfile(user: {
  id: string;
  email?: string | null;
  role?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  emailVerifiedAt?: Date | string | null;
  phoneVerifiedAt?: Date | string | null;
  status?: string | null;
}) {
  return {
    id: String(user.id),
    email: String(user.email ?? ""),
    role: normRoleLoose(user.role),
    firstName: user.firstName ?? null,
    middleName: user.middleName ?? null,
    lastName: user.lastName ?? null,
    emailVerified: !!user.emailVerifiedAt,
    phoneVerified: !!user.phoneVerifiedAt,
    status: user.status ?? null,
  };
}

function asNum(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function toPagination(req: Request, defaults?: { pageSize?: number; maxPageSize?: number }) {
  const q = req.query as any;
  const defaultPageSize = Math.max(1, asNum(defaults?.pageSize, 10));
  const maxPageSize = Math.max(defaultPageSize, asNum(defaults?.maxPageSize, 100));

  const rawPage = asNum(q.page, 0);
  const rawPageSize = asNum(q.pageSize, 0);

  const hasPageStyle = rawPage > 0 || rawPageSize > 0;

  if (hasPageStyle) {
    const pageSize = Math.min(maxPageSize, Math.max(1, rawPageSize || defaultPageSize));
    const page = Math.max(1, rawPage || 1);
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    return { page, pageSize, take, skip };
  }

  const takeRaw = asNum(q.take, defaultPageSize);
  const skipRaw = asNum(q.skip, 0);

  const take = Math.min(maxPageSize, Math.max(1, takeRaw));
  const skip = Math.max(0, skipRaw);
  const pageSize = take;
  const page = Math.floor(skip / take) + 1;

  return { page, pageSize, take, skip };
}

function buildPaginatedResult<T>(params: {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const { rows, total, page, pageSize } = params;
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
  };
}

async function createUserSession(req: Request, userId: string, role?: string | null) {
  const ua = String(req.headers["user-agent"] ?? "").slice(0, 500) || null;

  const xff = String(req.headers["x-forwarded-for"] ?? "");
  const ip =
    (xff.split(",")[0]?.trim() || "").slice(0, 80) ||
    (String((req as any).ip ?? "").slice(0, 80) || null);

  const deviceName = String(req.headers["x-device-name"] ?? "").slice(0, 120) || null;
  const expiresAt = new Date(Date.now() + getSessionTtlDays(role) * 24 * 60 * 60 * 1000);

  try {
    const session = await prisma.userSession.create({
      data: {
        userId,
        ip,
        userAgent: ua,
        deviceName,
        lastSeenAt: new Date(),
        expiresAt,
      } as any,
      select: { id: true },
    });

    return String(session.id);
  } catch (err) {
    console.error("[auth.createUserSession] failed:", err);
    return "";
  }
}

async function activateSupplierIfFullyVerified(user: {
  id: string;
  role: any;
  emailVerifiedAt?: Date | string | null;
  phoneVerifiedAt?: Date | string | null;
}) {
  const isSupplier = normRoleLoose(user.role) === "SUPPLIER";
  const fullyVerified = !!user.emailVerifiedAt && !!user.phoneVerifiedAt;

  if (!isSupplier || !fullyVerified) return;

  await prisma.supplier.updateMany({
    where: { userId: user.id },
    data: { status: "ACTIVE" as any },
  });
}

type PhoneConflict =
  | {
      entity: "USER";
      id: string;
      email?: string | null;
      role?: string | null;
      phone: string;
    }
  | {
      entity: "SUPPLIER";
      id: string;
      userId?: string | null;
      name?: string | null;
      contactEmail?: string | null;
      phone: string;
    }
  | {
      entity: "SUPPLIER_RIDER";
      id: string;
      userId?: string | null;
      name?: string | null;
      email?: string | null;
      role?: string | null;
      phone: string;
    }
  | {
      entity: "EMPLOYEE";
      id: string;
      firstName?: string | null;
      lastName?: string | null;
      emailWork?: string | null;
      emailPersonal?: string | null;
      phone: string;
    };

async function findPhoneConflictAcrossBoard(
  phoneInput: unknown,
  opts?: {
    dialCode?: string | null;
    excludeUserId?: string | null;
    excludeSupplierId?: string | null;
    excludeEmployeeId?: string | null;
  }
): Promise<PhoneConflict | null> {
  const normalized = normalizePhoneToE164(phoneInput, { dialCode: opts?.dialCode });
  if (!normalized) return null;

  const excludeUserId = String(opts?.excludeUserId ?? "").trim() || null;
  const excludeSupplierId = String(opts?.excludeSupplierId ?? "").trim() || null;
  const excludeEmployeeId = String(opts?.excludeEmployeeId ?? "").trim() || null;

  const [users, suppliers, riders, employees] = await prisma.$transaction([
    prisma.user.findMany({
      where: {
        phone: { not: null },
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      } as any,
      select: {
        id: true,
        email: true,
        role: true,
        phone: true,
      },
    }),
    prisma.supplier.findMany({
      where: {
        whatsappPhone: { not: null },
        ...(excludeSupplierId ? { id: { not: excludeSupplierId } } : {}),
      } as any,
      select: {
        id: true,
        userId: true,
        name: true,
        contactEmail: true,
        whatsappPhone: true,
      },
    }),
    prisma.supplierRider.findMany({
      where: {
        phone: { not: null },
      } as any,
      select: {
        id: true,
        userId: true,
        name: true,
        phone: true,
        user: {
          select: {
            email: true,
            role: true,
          },
        },
      },
    }),
    prisma.employee.findMany({
      where: {
        phone: { not: null },
        ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}),
      } as any,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        emailWork: true,
        emailPersonal: true,
        phone: true,
      },
    }),
  ]);

  for (const user of users ?? []) {
    const candidate = normalizePhoneToE164((user as any).phone, { assumeLocalIfNoPlus: false });
    if (candidate && candidate === normalized) {
      return {
        entity: "USER",
        id: String((user as any).id),
        email: (user as any).email ?? null,
        role: (user as any).role ?? null,
        phone: candidate,
      };
    }
  }

  for (const supplier of suppliers ?? []) {
    if (excludeUserId && String((supplier as any).userId ?? "") === excludeUserId) continue;
    const candidate = normalizePhoneToE164((supplier as any).whatsappPhone, {
      assumeLocalIfNoPlus: false,
    });
    if (candidate && candidate === normalized) {
      return {
        entity: "SUPPLIER",
        id: String((supplier as any).id),
        userId: (supplier as any).userId ?? null,
        name: (supplier as any).name ?? null,
        contactEmail: (supplier as any).contactEmail ?? null,
        phone: candidate,
      };
    }
  }

  for (const rider of riders ?? []) {
    if (excludeUserId && String((rider as any).userId ?? "") === excludeUserId) continue;
    const candidate = normalizePhoneToE164((rider as any).phone, {
      assumeLocalIfNoPlus: false,
    });
    if (candidate && candidate === normalized) {
      return {
        entity: "SUPPLIER_RIDER",
        id: String((rider as any).id),
        userId: (rider as any).userId ?? null,
        name: (rider as any).name ?? null,
        email: (rider as any)?.user?.email ?? null,
        role: (rider as any)?.user?.role ?? null,
        phone: candidate,
      };
    }
  }

  for (const employee of employees ?? []) {
    const candidate = normalizePhoneToE164((employee as any).phone, {
      assumeLocalIfNoPlus: false,
    });
    if (candidate && candidate === normalized) {
      return {
        entity: "EMPLOYEE",
        id: String((employee as any).id),
        firstName: (employee as any).firstName ?? null,
        lastName: (employee as any).lastName ?? null,
        emailWork: (employee as any).emailWork ?? null,
        emailPersonal: (employee as any).emailPersonal ?? null,
        phone: candidate,
      };
    }
  }

  return null;
}

function buildPhoneDuplicateError(conflict: PhoneConflict, normalizedPhone: string) {
  if (conflict.entity === "USER") {
    return {
      error: "Phone number already in use.",
      code: "PHONE_ALREADY_IN_USE",
      field: "phone",
      phone: normalizedPhone,
      conflict: {
        entity: "USER",
        role: String(conflict.role ?? "").trim() || null,
        email: conflict.email ?? null,
      },
    };
  }

  if (conflict.entity === "SUPPLIER") {
    return {
      error: "Phone number already in use.",
      code: "PHONE_ALREADY_IN_USE",
      field: "phone",
      phone: normalizedPhone,
      conflict: {
        entity: "SUPPLIER",
        name: conflict.name ?? null,
        email: conflict.contactEmail ?? null,
      },
    };
  }

  if (conflict.entity === "SUPPLIER_RIDER") {
    return {
      error: "Phone number already in use.",
      code: "PHONE_ALREADY_IN_USE",
      field: "phone",
      phone: normalizedPhone,
      conflict: {
        entity: "SUPPLIER_RIDER",
        name: conflict.name ?? null,
        email: conflict.email ?? null,
        role: conflict.role ?? null,
      },
    };
  }

  return {
    error: "Phone number already in use.",
    code: "PHONE_ALREADY_IN_USE",
    field: "phone",
    phone: normalizedPhone,
    conflict: {
      entity: "EMPLOYEE",
      name: [conflict.firstName, conflict.lastName].filter(Boolean).join(" ") || null,
      email: conflict.emailWork ?? conflict.emailPersonal ?? null,
    },
  };
}

function isPhoneRegistryUniqueError(err: unknown) {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2002") return false;

  const targets = Array.isArray((err.meta as any)?.target)
    ? (err.meta as any).target.map((v: any) => String(v))
    : [String((err.meta as any)?.target ?? "")];

  return targets.some((t: any) => t.includes("e164"));
}

async function registerCanonicalPhone(
  tx: Prisma.TransactionClient,
  params: {
    e164: string;
    dialCode?: string | null;
    ownerType: "USER";
    ownerId: string;
    purpose: string;
    isVerified?: boolean;
  }
) {
  await tx.phoneRegistry.create({
    data: {
      e164: params.e164,
      countryCode: getCountryCodeDigitsFromDialCode(params.dialCode) ?? undefined,
      national: getNationalNumberFromE164(params.e164, params.dialCode) ?? undefined,
      purpose: params.purpose,
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      isVerified: !!params.isVerified,
    },
  });
}

async function markCanonicalPhoneVerified(userId: string, e164?: string | null) {
  const phone = String(e164 ?? "").trim();
  if (!phone) return;

  await prisma.phoneRegistry.updateMany({
    where: {
      ownerType: "USER",
      ownerId: userId,
      e164: phone,
    },
    data: {
      isVerified: true,
    },
  });
}

// ---------------- LOGIN ----------------
router.post(
  "/login",
  wrap(async (req, res) => {
    const { email, password } = (req.body || {}) as {
      email?: string;
      password?: string;
    };

    const emailNorm = String(email ?? "").trim().toLowerCase();
    const passwordRaw = String(password ?? "");

    if (!emailNorm || !passwordRaw) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const loginUserSelect = {
      id: true,
      email: true,
      password: true,
      role: true,
      firstName: true,
      middleName: true,
      lastName: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      status: true,
      phone: true,
    } satisfies Prisma.UserSelect;

    type LoginUserRow = Prisma.UserGetPayload<{
      select: typeof loginUserSelect;
    }>;

    const user: LoginUserRow | null = await prisma.user.findFirst({
      where: {
        email: {
          equals: emailNorm,
          mode: "insensitive",
        },
      },
      select: loginUserSelect,
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(passwordRaw, String(user.password ?? ""));
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const userId = String(user.id);
    const userRole = String(user.role ?? "");
    const profile = buildPublicProfile(user);

    const sid = await createUserSession(req, userId, userRole);
    const ttlDays = getSessionTtlDays(userRole);

    const token = signAccessJwt(
      {
        id: userId,
        sub: userId,
        email: String(user.email ?? ""),
        role: normRoleLoose(userRole),
        k: "access",
        sid: sid || undefined,
      } as any,
      `${ttlDays}d`
    );

    setAccessTokenCookie(res, token, { maxAgeDays: ttlDays });
    res.setHeader("Cache-Control", "no-store");

    const roleNorm = normRoleLoose(userRole);
    const needsVerification =
      roleNorm === "SUPPLIER" && !(profile.emailVerified && profile.phoneVerified);

    return res.json({
      profile,
      needsVerification,
    });
  })
);

// ---------------- LOGOUT ----------------
router.post(
  "/logout",
  wrap(async (req, res) => {
    try {
      const cookieName = getAccessTokenCookieName();
      const token = (req as any)?.cookies?.[cookieName]
        ? String((req as any).cookies[cookieName])
        : "";

      if (token) {
        const secret =
          process.env.ACCESS_JWT_SECRET ||
          process.env.JWT_SECRET ||
          "CHANGE_ME_DEV_SECRET";

        const decoded = jwt.verify(token, secret) as any;

        const sid = decoded?.sid ? String(decoded.sid) : "";
        const uid = String(decoded?.id ?? decoded?.sub ?? "");

        if (sid && uid) {
          await prisma.userSession.updateMany({
            where: { id: sid, userId: uid, revokedAt: null },
            data: { revokedAt: new Date() } as any,
          });
        }
      }
    } catch (err) {
      console.warn("[auth.logout] session revoke skipped:", err);
    }

    clearAuthCookies(res);
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true });
  })
);

// ---------------- COMPLETE VERIFIED LOGIN ----------------
router.post(
  "/complete-verified-login",
  requireVerifySession,
  wrap(async (req, res) => {
    const userId = String(req.user?.id ?? "").trim();
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userSelect = {
      id: true,
      email: true,
      role: true,
      firstName: true,
      middleName: true,
      lastName: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      status: true,
      phone: true,
    } satisfies Prisma.UserSelect;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const profile = buildPublicProfile(user);
    const roleNorm = normRoleLoose(user.role);

    const fullyVerified =
      !!user.emailVerifiedAt &&
      (!isPhoneVerificationRequired({ role: user.role, phone: user.phone }) ||
        !!user.phoneVerifiedAt);

    if (!fullyVerified) {
      return res.status(400).json({
        error: "Please verify your email and phone before continuing.",
        profile,
      });
    }

    await activateSupplierIfFullyVerified(user as any);

    const sid = await createUserSession(req, user.id, user.role);
    const ttlDays = getSessionTtlDays(user.role);

    const token = signAccessJwt(
      {
        id: user.id,
        sub: user.id,
        email: String(user.email ?? ""),
        role: roleNorm,
        k: "access",
        sid: sid || undefined,
      } as any,
      `${ttlDays}d`
    );

    setAccessTokenCookie(res, token, { maxAgeDays: ttlDays });
    res.setHeader("Cache-Control", "no-store");

    return res.json({
      ok: true,
      profile,
      needsVerification: false,
    });
  })
);

// ---------------- ME ----------------
router.get(
  "/me",
  requireAuth,
  wrap(async (req, res) => {
    const userId = String(req.user?.id ?? "").trim();
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { page, pageSize, take, skip } = toPagination(req, {
      pageSize: 10,
      maxPageSize: 100,
    });

    const authMeSelect = {
      id: true,
      email: true,
      role: true,
      firstName: true,
      middleName: true,
      lastName: true,
      status: true,
      phone: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      joinedAt: true,
      address: true,
      defaultShippingAddressId: true,
      defaultShippingAddress: true,
    } satisfies Prisma.UserSelect;

    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: authMeSelect,
    });

    if (!u) {
      return res.status(404).json({ error: "User not found" });
    }

    let shippingAddressesTotal = 0;
    let shippingAddressesRows: any[] = [];

    try {
      const out = await prisma.$transaction([
        prisma.userShippingAddress.count({
          where: { userId, isActive: true } as any,
        }),
        prisma.userShippingAddress.findMany({
          where: { userId, isActive: true } as any,
          orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
          take,
          skip,
        }),
      ]);

      shippingAddressesTotal = Number(out[0] ?? 0);
      shippingAddressesRows = Array.isArray(out[1]) ? out[1] : [];
    } catch (err) {
      console.error("[auth.me] shipping address lookup failed:", err);
      shippingAddressesTotal = 0;
      shippingAddressesRows = [];
    }

    const fallbackPrimaryShippingAddress =
      (u as any).defaultShippingAddress ??
      shippingAddressesRows.find((a: any) => a?.isDefault) ??
      shippingAddressesRows[0] ??
      null;

    return res.json({
      data: {
        id: u.id,
        email: u.email,
        role: normRoleLoose(u.role),
        firstName: u.firstName ?? null,
        middleName: (u as any).middleName ?? null,
        lastName: u.lastName ?? null,
        status: (u as any).status ?? null,
        phone: (u as any).phone ?? null,
        joinedAt: (u as any).joinedAt ?? null,
        address: (u as any).address ?? null,
        emailVerified: !!(u as any).emailVerifiedAt,
        phoneVerified: !!(u as any).phoneVerifiedAt,
        emailVerifiedAt: (u as any).emailVerifiedAt ?? null,
        phoneVerifiedAt: (u as any).phoneVerifiedAt ?? null,

        shippingAddress: fallbackPrimaryShippingAddress,
        defaultShippingAddress: (u as any).defaultShippingAddress ?? fallbackPrimaryShippingAddress,
        defaultShippingAddressId:
          (u as any).defaultShippingAddressId ?? fallbackPrimaryShippingAddress?.id ?? null,

        shippingAddresses: buildPaginatedResult({
          rows: shippingAddressesRows,
          total: shippingAddressesTotal,
          page,
          pageSize,
        }),
      },
    });
  })
);

// ---------------- PUBLIC helpers for VerifyEmail page ----------------
router.get("/email-status", async (req, res) => {
  const email = String(req.query.email ?? "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email is required" });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true, firstName: true, lastName: true },
  });

  if (!user) return res.status(404).json({ error: "No account for this email" });

  return res.json({
    id: user.id,
    email,
    emailVerifiedAt: user.emailVerifiedAt,
    firstName: user.firstName,
    lastName: user.lastName,
  });
});

// ---------------- PUBLIC resend verification email ----------------
const fmtErr = (e: any) => {
  if (!e) return "Unknown error";
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
};

router.post(
  "/resend-verification",
  wrap(async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "email is required" });

    const u = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        emailVerifiedAt: true,
        emailVerifyLastSentAt: true,
        emailVerifySendCountDay: true,
      },
    });

    if (!u) return res.status(404).json({ error: "No account for this email" });

    if (u.emailVerifiedAt) {
      return res.json({ ok: true, nextResendAfterSec: EMAIL_RESEND_COOLDOWN_SEC, expiresInSec: 0 });
    }

    const now = new Date();
    const last = u.emailVerifyLastSentAt ? +u.emailVerifyLastSentAt : 0;
    const since = Math.floor((+now - last) / 1000);

    if (since < EMAIL_RESEND_COOLDOWN_SEC) {
      return res.status(429).json({
        error: "Please wait before resending",
        retryAfterSec: EMAIL_RESEND_COOLDOWN_SEC - since,
      });
    }

    if ((u.emailVerifySendCountDay ?? 0) >= EMAIL_DAILY_CAP) {
      return res.status(429).json({ error: "Daily resend limit reached" });
    }

    try {
      await prisma.user.update({
        where: { id: u.id },
        data: {
          emailVerifyLastSentAt: now,
          emailVerifySendCountDay: (u.emailVerifySendCountDay ?? 0) + 1,
        },
      });

      await issueAndEmailEmailVerification(u.id, email);

      return res.json({
        ok: true,
        nextResendAfterSec: EMAIL_RESEND_COOLDOWN_SEC,
        expiresInSec: EMAIL_TTL_MIN * 60,
      });
    } catch (e) {
      console.error("[resend-verification] send failed:", fmtErr(e));
      return res.status(502).json({ error: "Mail send failed", detail: fmtErr(e) });
    }
  })
);

// ---------------- REGISTER ----------------
router.post(
  "/register",
  wrap(async (req, res) => {
    const body = RegisterSchema.parse(req.body);

    const existing = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
      select: { id: true },
    });
    if (existing) return res.status(409).json({ error: "Email already registered" });

    const passwordHash = await bcrypt.hash(body.password, 10);

    let phone: string | null = null;
    if (body.dialCode && body.localPhone) {
      phone = normalizePhoneToE164(body.localPhone, {
        dialCode: body.dialCode,
      });

      if (!phone) {
        return res.status(400).json({ error: "Please enter a valid phone number" });
      }

      const conflict = await findPhoneConflictAcrossBoard(phone);
      if (conflict) {
        return res.status(409).json(buildPhoneDuplicateError(conflict, phone));
      }
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: body.email.toLowerCase(),
            password: passwordHash,
            role: "SHOPPER",
            firstName: body.firstName,
            middleName: body.middleName,
            lastName: body.lastName,
            phone,
            status: "PENDING",
            dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
          } as any,
        });

        if (phone) {
          await registerCanonicalPhone(tx, {
            e164: phone,
            dialCode: body.dialCode,
            ownerType: "USER",
            ownerId: user.id,
            purpose: "PRIMARY",
            isVerified: false,
          });
        }

        return user;
      });

      const result = {
        message: phone
          ? "Registered. Verify email and phone number."
          : "Registered. Verify your email to continue.",
        tempToken: signJwt(
          { id: created.id, role: created.role, email: created.email, k: "verify" },
          "1h"
        ),
        phoneOtpSent: false,
        emailSent: false,
        smsSent: false,
      };

      try {
        try {
          await issueAndEmailEmailVerification(created.id, created.email);
          await prisma.user.update({
            where: { id: created.id },
            data: { emailVerifyLastSentAt: new Date(), emailVerifySendCountDay: 1 } as any,
          });
          result.emailSent = true;
        } catch (e) {
          console.warn("[register] send email verification failed:", (e as any)?.message);
        }

        if (phone) {
          const r = await issueOtp({
            identifier: created.id,
            userId: created.id,
            phone,
            channelPref: "whatsapp",
          });

          result.phoneOtpSent = !!r.ok;

          console.log("[register] OTP send result", {
            userId: created.id,
            phoneE164: phone,
            ok: r.ok,
            error: r.ok ? null : r.error,
          });

          if (r.ok) {
            await prisma.user.update({
              where: { id: created.id },
              data: {
                phoneOtpLastSentAt: new Date(),
                phoneOtpSendCountDay: 1,
              } as any,
            });
          }
        }
      } catch (e) {
        console.warn("[register] post-register side-effects failed (continuing):", (e as any)?.message);
      }

      return res.status(201).json(result);
    } catch (err) {
      if (isPhoneRegistryUniqueError(err)) {
        return res.status(409).json({
          error: "Phone number already in use.",
          code: "PHONE_ALREADY_IN_USE",
          field: "phone",
          phone,
        });
      }
      throw err;
    }
  })
);

// ---------------- VERIFY EMAIL CALLBACK ----------------
router.get("/verify-email", async (req, res) => {
  const raw = String(req.query.token ?? "");
  if (!raw) return res.status(400).send("Missing token");

  const now = new Date();
  const UI_URL = String(process.env.APP_URL || "https://dayspringhouse.com").replace(/\/$/, "");

  const redirectUi = (params: Record<string, string>) => {
    const qp = new URLSearchParams(params);
    return res.redirect(302, `${UI_URL}/verify?${qp.toString()}`);
  };

  try {
    const decoded = jwt.verify(raw, EMAIL_JWT_SECRET) as {
      sub: string;
      email: string;
      k: string;
    };
    if (decoded.k !== "email-verify") throw new Error("invalid-kind");

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        email: true,
        role: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        status: true,
      } as any,
    });

    if (!user) return res.status(404).send("Account not found");

    const email = (decoded.email || (user as any).email || "").toLowerCase();

    let nextUser = user as any;
    if (!(user as any).emailVerifiedAt) {
      const phoneRequired = isPhoneVerificationRequired({
        role: (user as any).role,
        phone: (user as any).phone,
      });
      const phoneOk = !phoneRequired || !!(user as any).phoneVerifiedAt;
      const newStatus = phoneOk ? "VERIFIED" : "PARTIAL";

      nextUser = await prisma.user.update({
        where: { id: (user as any).id },
        data: { emailVerifiedAt: now, status: newStatus as any } as any,
        select: {
          id: true,
          email: true,
          role: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          status: true,
        } as any,
      });
    }

    await activateSupplierIfFullyVerified(nextUser);

    return redirectUi({
      ok: "1",
      e: email,
      role: String((user as any).role || ""),
      phoneOk: nextUser.phoneVerifiedAt ? "1" : "0",
    });
  } catch {
    const legacy = await prisma.user.findFirst({
      where: {
        emailVerifyToken: raw,
        emailVerifyTokenExpiresAt: { gt: now },
      } as any,
      select: {
        id: true,
        email: true,
        role: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        status: true,
      } as any,
    });

    if (!legacy) {
      return redirectUi({ ok: "0", err: "token" });
    }

    const email = String((legacy as any).email || "").toLowerCase();

    let nextUser = legacy as any;

    if (!(legacy as any).emailVerifiedAt) {
      const phoneRequired = isPhoneVerificationRequired({
        role: (legacy as any).role,
        phone: (legacy as any).phone,
      });
      const phoneOk = !phoneRequired || !!(legacy as any).phoneVerifiedAt;
      const newStatus = phoneOk ? "VERIFIED" : "PARTIAL";

      nextUser = await prisma.user.update({
        where: { id: (legacy as any).id },
        data: {
          emailVerifiedAt: now,
          status: newStatus as any,
          emailVerifyToken: null,
          emailVerifyTokenExpiresAt: null,
        } as any,
        select: {
          id: true,
          email: true,
          role: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          status: true,
        } as any,
      });
    } else {
      nextUser = await prisma.user.update({
        where: { id: (legacy as any).id },
        data: {
          emailVerifyToken: null,
          emailVerifyTokenExpiresAt: null,
        } as any,
        select: {
          id: true,
          email: true,
          role: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          status: true,
        } as any,
      });
    }

    await activateSupplierIfFullyVerified(nextUser);

    return redirectUi({
      ok: "1",
      e: email,
      role: String((legacy as any).role || ""),
      phoneOk: nextUser.phoneVerifiedAt ? "1" : "0",
    });
  }
});

// ---------------- Forgot / Reset password ----------------
router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = ForgotSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.json({ ok: true });

    const token = crypto.randomBytes(24).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { resetPasswordToken: token, resetPasswordExpiresAt: expires } as any,
    });

    const resetUrl = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await sendResetorForgotPasswordEmail(
      user.email,
      resetUrl,
      "Reset your DaySpring password",
      "Click the link to reset your password:"
    );

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const { token, password } = ResetSchema.parse(req.body);
    const user = await prisma.user.findFirst({
      where: { resetPasswordToken: token, resetPasswordExpiresAt: { gt: new Date() } } as any,
    });
    if (!user) return res.status(400).json({ error: "Invalid or expired token" });

    const hashed = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        resetPasswordToken: null,
        resetPasswordExpiresAt: null,
      } as any,
    });

    res.json({ ok: true, message: "Password updated" });
  } catch (e) {
    next(e);
  }
});

router.get("/reset-token/validate", async (req, res, next) => {
  try {
    const token = String(req.query.token || "");
    if (!token) return res.json({ ok: false });

    const user = await prisma.user.findFirst({
      where: { resetPasswordToken: token, resetPasswordExpiresAt: { gt: new Date() } } as any,
      select: { id: true },
    });

    return res.json({ ok: !!user });
  } catch (e) {
    next(e);
  }
});

// ---------------- OTP Verification (phone) ----------------
router.post("/verify-otp", requireVerifySession, async (req, res) => {
  const userId = req.user?.id;
  const code = String(req.body?.otp ?? "").trim();
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!code) return res.status(400).json({ error: "OTP is required" });

  try {
    const out = await verifyOtp({ identifier: userId, code });
    if (!out.ok) {
      return res.status(400).json({ error: out.error || "Invalid OTP. Please try again." });
    }

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true, role: true, phone: true } as any,
    });

    const now = new Date();

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        phoneVerifiedAt: now,
        status: (existing as any)?.emailVerifiedAt ? "VERIFIED" : "PARTIAL",
      } as any,
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        status: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
      } as any,
    });

    await markCanonicalPhoneVerified(String((updated as any).id), String((updated as any).phone ?? ""));
    await activateSupplierIfFullyVerified(updated as any);

    return res.json({
      ok: true,
      profile: {
        id: (updated as any).id,
        email: (updated as any).email,
        role: (updated as any).role as any,
        firstName: (updated as any).firstName,
        lastName: (updated as any).lastName,
        emailVerified: !!(updated as any).emailVerifiedAt,
        phoneVerified: !!(updated as any).phoneVerifiedAt,
        status: (updated as any).status,
      },
    });
  } catch (err: any) {
    console.error("verify-otp error:", { message: err?.message, stack: err?.stack, userId });
    return res.status(500).json({ error: "Could not verify OTP" });
  }
});

// ---------------- Resend OTP (phone) ----------------
router.post("/resend-otp", requireVerifySession, async (req, res) => {
  try {
    const userId = String(req.user?.id || "");
    if (!userId) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const requestedPhone = String(req.body?.phone ?? "").trim();
    const requestedDialCode = String(req.body?.dialCode ?? "").trim();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const normalizedRequestedPhone = requestedPhone
      ? normalizePhoneToE164(requestedPhone, {
          dialCode: requestedDialCode || undefined,
        })
      : null;

    const storedPhoneE164 = normalizePhoneToE164(user.phone, {
      assumeLocalIfNoPlus: false,
    });

    if (requestedPhone && !normalizedRequestedPhone) {
      return res.status(400).json({
        error: "Phone number must be in a valid format and include a valid selected country dial code when local.",
      });
    }

    if (normalizedRequestedPhone && storedPhoneE164 && normalizedRequestedPhone !== storedPhoneE164) {
      return res.status(400).json({
        error: "Requested phone number does not match the phone number saved on this account.",
      });
    }

    const phoneE164 = normalizedRequestedPhone || storedPhoneE164;

    if (!phoneE164) {
      return res.status(400).json({
        error: "No phone number is available for OTP delivery.",
      });
    }

    const result = await issueOtp({
      identifier: user.id,
      userId: user.id,
      phone: phoneE164,
      channelPref: "whatsapp",
    });

    if (!result.ok) {
      return res.status(400).json({
        error: result.error || "Could not send phone verification code.",
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        phoneOtpLastSentAt: new Date(),
        phoneOtpSendCountDay: {
          increment: 1,
        } as any,
      },
    });

    return res.json({
      ok: true,
      message: "Verification code sent.",
    });
  } catch (err: any) {
    console.error("[resend-otp] error", err);
    return res.status(500).json({
      error: err?.message || "Could not send phone verification code.",
    });
  }
});

const KYC_TICKET_SECRET = process.env.KYC_TICKET_SECRET || "CHANGE_ME_KYC_TICKET_SECRET";

// Company type validator for suppliers
const CacCompanyTypeEnum = z.enum([
  "BUSINESS_NAME",
  "COMPANY",
  "INCORPORATED_TRUSTEES",
  "LIMITED_PARTNERSHIP",
  "LIMITED_LIABILITY_PARTNERSHIP",
]);

const registerSupplierSchema = z.object({
  role: z.literal("SUPPLIER").optional(),
  businessName: z.string().min(1, "Business name is required"),
  legalName: z.string().nullable().optional(),
  registrationType: z.enum(["INDIVIDUAL", "REGISTERED_BUSINESS"]).nullable().optional(),
  registrationCountryCode: z.string().trim().min(2).max(8).nullable().optional(),
  supplierType: z.enum(["PHYSICAL", "ONLINE"]),
  contactFirstName: z.string().min(1, "First name is required"),
  contactLastName: z.string().min(1, "Last name is required"),
  contactEmail: z.string().email("Valid email is required"),
  contactDialCode: z.string().trim().refine((v) => /^\+\d{1,4}$/.test(v), "Invalid country dial code"),
  contactPhone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[^\d+]/g, ""))
    .refine((v) => v.length >= 6, "Valid phone number is required")
    .refine((v) => v.length <= 18, "Valid phone number is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .refine((v) => /[A-Za-z]/.test(v), "Password must include a letter")
    .refine((v) => /\d/.test(v), "Password must include a number")
    .refine((v) => /[^A-Za-z0-9]/.test(v), "Password must include a special character"),
});

// small helpers
const norm = (s: any) => String(s ?? "").trim().toLowerCase();
const digits = (s: any) => String(s ?? "").replace(/\D/g, "");

function normalizeDateToYMD(raw?: string | null): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = Number(slash[3]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(y)) return null;

    let day = b;
    let month = a;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    }
    const pad2 = (n: number) => String(n).padStart(2, "0");
    return `${y}-${pad2(month)}-${pad2(day)}`;
  }

  try {
    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) return null;
    const pad2 = (n: number) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  } catch {
    return null;
  }
}

function matchesAllFour(
  entity: any,
  input: {
    rcNumber: string;
    companyType: string;
    companyName: string;
    regDate: string;
  }
) {
  const rcOk = digits(input.rcNumber) !== "" && digits(input.rcNumber) === digits(entity.rc_number);
  const typeOk =
    String(input.companyType).trim().toUpperCase() ===
    String(entity.type_of_company).trim().toUpperCase();
  const nameOk = norm(input.companyName) !== "" && norm(input.companyName) === norm(entity.company_name);

  const entryDate = normalizeDateToYMD(entity.date_of_registration);
  const uiDate = String(input.regDate || "").trim();
  const dateOk = !!uiDate && !!entryDate && entryDate === uiDate;

  return rcOk && typeOk && nameOk && dateOk;
}

async function pickUniqueSupplierName(desired: string, rc: string) {
  const base = desired.trim();
  const existing = await prisma.supplier.findUnique({ where: { name: base } });
  if (!existing) return base;

  let candidate = `${base} (RC ${rc})`;
  const clash1 = await prisma.supplier.findUnique({ where: { name: candidate } });
  if (!clash1) return candidate;

  for (let i = 2; i <= 50; i++) {
    candidate = `${base} (RC ${rc}) #${i}`;
    const clash = await prisma.supplier.findUnique({ where: { name: candidate } });
    if (!clash) return candidate;
  }
  return `${base} (RC ${rc}) #${Date.now()}`;
}

// ---------------- REGISTER SUPPLIER ----------------
router.post("/register-supplier", async (req, res) => {
  try {
    const parsed = registerSupplierSchema.parse(req.body ?? {});

    const {
      businessName,
      legalName,
      registrationType,
      registrationCountryCode,
      contactFirstName,
      contactLastName,
      contactEmail,
      contactPhone,
      contactDialCode,
      password,
    } = parsed;

    const emailLower = contactEmail.trim().toLowerCase();
    const normalizedPhone = normalizePhoneToE164(contactPhone, {
      dialCode: contactDialCode,
    });
    const trimmedBusinessName = businessName.trim();
    const trimmedLegalName = String(legalName ?? "").trim() || null;

    if (!normalizedPhone) {
      return res.status(400).json({
        error: "Valid phone number is required",
        field: "contactPhone",
      });
    }

    const phoneConflict = await findPhoneConflictAcrossBoard(normalizedPhone);
    if (phoneConflict) {
      return res.status(409).json(buildPhoneDuplicateError(phoneConflict, normalizedPhone));
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: emailLower },
      select: { id: true },
    });

    if (existingUser) {
      return res.status(409).json({
        error: "A user with this email already exists.",
      });
    }

    let supplierName = trimmedBusinessName;
    const existingExactName = await prisma.supplier.findUnique({
      where: { name: supplierName },
      select: { id: true },
    });

    if (existingExactName) {
      let i = 2;
      while (true) {
        const candidate = `${trimmedBusinessName} ${i}`;
        const exists = await prisma.supplier.findUnique({
          where: { name: candidate },
          select: { id: true },
        });
        if (!exists) {
          supplierName = candidate;
          break;
        }
        i++;
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: emailLower,
            password: passwordHash,
            role: "SUPPLIER",
            firstName: contactFirstName.trim(),
            lastName: contactLastName.trim(),
            phone: normalizedPhone,
            status: "PENDING",
          },
          select: {
            id: true,
            role: true,
            email: true,
            phone: true,
          },
        });

        // Canonical uniqueness row is attached to USER.
        // Supplier.whatsappPhone mirrors the same phone but is not separately registered.
        await registerCanonicalPhone(tx, {
          e164: normalizedPhone,
          dialCode: contactDialCode,
          ownerType: "USER",
          ownerId: user.id,
          purpose: "PRIMARY",
          isVerified: false,
        });

        const supplier = await tx.supplier.create({
          data: {
            userId: user.id,
            name: supplierName,
            contactEmail: emailLower,
            whatsappPhone: normalizedPhone,
            type: SupplierType.PHYSICAL,
            legalName: trimmedLegalName,
            registeredBusinessName:
              registrationType === "REGISTERED_BUSINESS" ? trimmedBusinessName : null,
            registrationType: registrationType ?? null,
            registrationCountryCode:
              String(registrationCountryCode ?? "").trim().toUpperCase() || null,
            status: "PENDING_VERIFICATION",
            kycStatus: "PENDING",
          },
          select: {
            id: true,
          },
        });

        return { user, supplier };
      });

      const result = {
        message: "Supplier registered. Please verify email and WhatsApp number to continue.",
        supplierId: created.supplier.id,
        tempToken: signJwt(
          { id: created.user.id, role: created.user.role, email: created.user.email, k: "verify" },
          "1h"
        ),
        emailSent: false,
        phoneOtpSent: false,
      };

      try {
        await issueAndEmailEmailVerification(created.user.id, created.user.email);
        result.emailSent = true;

        await prisma.user.update({
          where: { id: created.user.id },
          data: {
            emailVerifyLastSentAt: new Date(),
            emailVerifySendCountDay: 1,
          },
        });
      } catch {
        // ignore
      }

      try {
        const phoneE164 = String(created.user.phone || "").trim();
        if (phoneE164 && phoneE164.startsWith("+")) {
          const r = await issueOtp({
            identifier: created.user.id,
            userId: created.user.id,
            phone: phoneE164,
            channelPref: "whatsapp",
          });

          result.phoneOtpSent = !!r.ok;

          if (r.ok) {
            await prisma.user.update({
              where: { id: created.user.id },
              data: {
                phoneOtpLastSentAt: new Date(),
                phoneOtpSendCountDay: 1,
              },
            });
          }
        }
      } catch {
        // ignore
      }

      return res.status(201).json(result);
    } catch (err) {
      if (isPhoneRegistryUniqueError(err)) {
        return res.status(409).json({
          error: "Phone number already in use.",
          code: "PHONE_ALREADY_IN_USE",
          field: "contactPhone",
          phone: normalizedPhone,
        });
      }
      throw err;
    }
  } catch (err: any) {
    console.error("[register-supplier] error", err);

    if (err?.name === "ZodError") {
      return res.status(400).json({
        error: "Invalid payload",
        details: err.errors,
      });
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({
        error: "A supplier or user already exists with these details.",
        meta: err.meta,
      });
    }

    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

// model PhoneRegistry {
//   id          String   @id @default(cuid())
//   e164        String   @unique
//   countryCode String?
//   national    String?
//   purpose     String?
//   ownerType   String
//   ownerId     String
//   isVerified  Boolean  @default(false)
//   createdAt   DateTime @default(now())
//   updatedAt   DateTime @updatedAt

//   @@index([ownerType, ownerId])
//   @@index([countryCode])
// }