// api/src/routes/dojahProxy.ts
import { Router } from 'express';
import axios from 'axios';
import { z } from 'zod';

import { fetchCacBasic, type CacCompanyType } from '../lib/dojahClient.js';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../middleware/auth.js';

import {
  checkGate,
  recordOutcome,
  getGate,
  clearGate,
  setCooldown,
  resetDailyWindow,
} from '../lib/cacThrottle.js';

const router = Router();

// Single canonical enum for parsing/narrowing
const CacCompanyTypeEnum = z.enum([
  'BUSINESS_NAME',
  'COMPANY',
  'INCORPORATED_TRUSTEES',
  'LIMITED_PARTNERSHIP',
  'LIMITED_LIABILITY_PARTNERSHIP',
]);

const QuerySchema = z.object({
  rc_number: z.string().min(1),
  company_type: CacCompanyTypeEnum,
  adminOverride: z.union([z.literal('1'), z.literal('true')]).optional(),
});

// GET /api/integrations/dojah/cac/basic?rc_number=...&company_type=...
router.get('/cac/basic', async (req, res) => {

  const q = (() => {
    try {
      return QuerySchema.parse(req.query);
    } catch {
      return null;
    }
  })();

  if (!q) {
    return res.status(400).json({ error: 'rc_number and valid company_type are required' });
  }

  const rc_number = q.rc_number;
  const company_type = q.company_type as CacCompanyType;
  const adminOverride =
    !!q.adminOverride ||
    String(req.headers['x-admin-override'] || '').toLowerCase() === '1';

  // 🚦 Throttle gate
  const gate = checkGate(rc_number, company_type, { adminOverride });
  if (gate.blocked) {
    return res.status(200).json({
      throttled: true,
      reason: gate.reason,
      retryAt: gate.retryAt,
    });
  }

try {
  const data = await fetchCacBasic({ rc_number, company_type });

  // Positive cache
  await prisma.cacLookup.upsert({
    where: { CacLookup_rc_companyType_key: { rcNumber: rc_number, companyType: company_type } },
    update: {
      outcome: 'OK',
      entity: data as any,
      checkedAt: new Date(),
      retryAt: null,
    },
    create: {
      rcNumber: rc_number,
      companyType: company_type,
      outcome: 'OK',
      entity: data as any,
      checkedAt: new Date(),
      retryAt: null,
    },
  });

  recordOutcome(rc_number, company_type, 'OK');
  return res.status(200).json(data);
} catch (err: any) {
  if (axios.isAxiosError(err) && err.response?.status === 404) {
    // Negative cache + throttle backoff
    recordOutcome(rc_number, company_type, 'NOT_FOUND');
    const state = getGate(rc_number, company_type);
    const retryAtIso = state?.retryAt ? new Date(state.retryAt).toISOString() : undefined;

    await prisma.cacLookup.upsert({
      where: { CacLookup_rc_companyType_key: { rcNumber: rc_number, companyType: company_type } },
      update: {
        outcome: 'NOT_FOUND',
        entity: null,
        checkedAt: new Date(),
        retryAt: state?.retryAt ? new Date(state.retryAt) : null,
      },
      create: {
        rcNumber: rc_number,
        companyType: company_type,
        outcome: 'NOT_FOUND',
        entity: null,
        checkedAt: new Date(),
        retryAt: state?.retryAt ? new Date(state.retryAt) : null,
      },
    });

    return res.status(200).json({ not_found: true, retryAt: retryAtIso, error: 'CAC record not found' });
  }

  recordOutcome(rc_number, company_type, 'ERROR');
  return res.status(502).json({
    upstream: 'dojah',
    error: err?.response?.data?.error || err?.message || 'Upstream error',
  });
}
});

/* ===================== ADMIN: throttle inspection ===================== */
// GET /api/integrations/dojah/admin/cac/gate?rc_number=...&company_type=...
router.get('/admin/cac/gate', requireAdmin, async (req, res) => {
  const q = z.object({
    rc_number: z.string().min(1),
    company_type: CacCompanyTypeEnum,
  }).parse(req.query);

  const state = getGate(q.rc_number, q.company_type);
  if (!state) return res.json({ exists: false });

  return res.json({
    exists: true,
    ...state,
    retryAtIso: state.retryAt ? new Date(state.retryAt).toISOString() : null,
    windowResetAtIso: new Date(state.windowResetAt).toISOString(),
  });
});

/* ===================== ADMIN: clear throttle ===================== */
// POST /api/integrations/dojah/admin/cac/clear-throttle
// body: { rc_number, company_type }
router.post('/admin/cac/clear-throttle', requireAdmin, async (req, res) => {
  const body = z.object({
    rc_number: z.string().min(1),
    company_type: CacCompanyTypeEnum,
  }).parse(req.body);

  clearGate(body.rc_number, body.company_type);
  return res.json({ ok: true });
});

/* ===================== ADMIN: set cooldown ===================== */
// POST /api/integrations/dojah/admin/cac/set-cooldown
// body: { rc_number, company_type, minutes, resetDaily? }
router.post('/admin/cac/set-cooldown', requireAdmin, async (req, res) => {
  const body = z.object({
    rc_number: z.string().min(1),
    company_type: CacCompanyTypeEnum,
    minutes: z.coerce.number().min(0).max(7 * 24 * 60),
    resetDaily: z.coerce.boolean().optional().default(false),
  }).parse(req.body);

  if (body.resetDaily) resetDailyWindow(body.rc_number, body.company_type);
  const e = setCooldown(body.rc_number, body.company_type, body.minutes * 60 * 1000);

  return res.json({
    ok: true,
    retryAt: e.retryAt,
    retryAtIso: new Date(e.retryAt).toISOString(),
  });
});

/* ===================== ADMIN: set supplier KYC status ===================== */
// POST /api/integrations/dojah/admin/supplier/kyc-status
// body: { rcNumber, status: 'NONE'|'CHECKED'|'APPROVED'|'REJECTED'|'PENDING' }
router.post('/admin/supplier/kyc-status', requireAdmin, async (req, res, next) => {
  try {
    const body = z.object({
      rcNumber: z.string().min(1),
      status: z.enum(['NONE', 'CHECKED', 'APPROVED', 'REJECTED', 'PENDING']),
    }).parse(req.body);

    const data: any = { kycStatus: body.status };
    const now = new Date();
    if (body.status === 'APPROVED') data.kycApprovedAt = now;
    if (body.status === 'CHECKED')  data.kycCheckedAt  = now;

    const sup = await prisma.supplier.update({
      where: { rcNumber: body.rcNumber },
      data,
    });

    return res.json({ ok: true, supplierId: sup.id, kycStatus: sup.kycStatus });
  } catch (e) {
    next(e);
  }
});

/* ===================== ADMIN: reset supplier KYC payload ===================== */
// POST /api/integrations/dojah/admin/supplier/kyc-reset
// body: { rcNumber }
router.post('/admin/supplier/kyc-reset', requireAdmin, async (req, res, next) => {
  try {
    const body = z.object({
      rcNumber: z.string().min(1),
    }).parse(req.body);

    const sup = await prisma.supplier.update({
      where: { rcNumber: body.rcNumber },
      data: {
        kycStatus: 'NONE',
        kycRawPayload: null,
        ownerVerified: false,
        kycCheckedAt: null,
        kycApprovedAt: null,
      },
    });

    // Nuke throttle state so a fresh call can occur
    clearGate(body.rcNumber, (sup.companyType as string) || 'COMPANY');

    return res.json({ ok: true, supplierId: sup.id, kycStatus: sup.kycStatus });
  } catch (e) {
    next(e);
  }
});

export default router;
