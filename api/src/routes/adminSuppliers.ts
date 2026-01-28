// server/routes/adminSuppliers.ts
import { Router, type Request, type Response } from 'express';
import { SupplierType } from '@prisma/client'
import axios from 'axios';

import paystack from './paystack.js';
import { prisma } from '../lib/prisma.js';
import { requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import z from 'zod';

const router = Router();

/* ---------------- helpers ---------------- */

const toNull = <T = any>(v: T | undefined | null): T | null =>
  v === '' || v === undefined ? null : (v as any);

const toBool = (v: any, def = false) =>
  v === true || v === 'true' || v === 1 || v === '1'
    ? true
    : v === false || v === 'false' || v === 0 || v === '0'
      ? false
      : def;

const normAuth = (s?: string | null) => {
  const v = (s || '').toUpperCase();
  return (['NONE', 'BEARER', 'BASIC'] as const).includes(v as any)
    ? (v as 'NONE' | 'BEARER' | 'BASIC')
    : null;
};

const normPayoutMethod = (s?: string | null) => {
  const v = (s || '').toUpperCase();
  return (['TRANSFER', 'SPLIT'] as const).includes(v as any)
    ? (v as 'TRANSFER' | 'SPLIT')
    : null;
};

function normSupplierType(v: any): SupplierType {
  const s = String(v ?? '').toUpperCase();
  return (Object.values(SupplierType) as string[]).includes(s)
    ? (s as SupplierType)
    : SupplierType.PHYSICAL;
}

function normStatus(v: any) {
  return String(v ?? '').toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
}

const toUndef = <T = any>(v: T | undefined | null): T | undefined =>
  v === '' || v === undefined ? undefined : (v as any);

// for fields where you WANT to allow null-clears explicitly:
// - "" => undefined (ignore)
// - null => null (clear)
// - value => value
const toNullablePatch = <T = any>(v: T | undefined | null): T | null | undefined =>
  v === '' || v === undefined ? undefined : (v as any);

/**
 * New offers setup:
 * - SupplierProductOffer (base price per supplier per product)
 * - SupplierVariantOffer (per-variant bump per supplier per variant)
 *
 * So "supplier is in use" = has product offers OR variant offers OR POs, etc.
 */
async function supplierUsageCounts(supplierId: string) {
  const [productOffers, variantOffers, purchaseOrders, chosenOrderItems] = await Promise.all([
    prisma.supplierProductOffer.count({ where: { supplierId } }),
    prisma.supplierVariantOffer.count({ where: { supplierId } }),
    prisma.purchaseOrder.count({ where: { supplierId } }).catch(() => 0),
    prisma.orderItem.count({ where: { chosenSupplierId: supplierId } }).catch(() => 0),
  ]);

  return { productOffers, variantOffers, purchaseOrders, chosenOrderItems };
}

/**
 * Create Paystack transfer recipient if needed (non-blocking)
 */
async function createPaystackRecipientIfNeeded(supplier: {
  id: string;
  name: string;
  payoutMethod: string | null;
  bankCountry: string | null;
  bankCode: string | null;
  accountNumber: string | null;
  accountName: string | null;
  isPayoutEnabled: boolean | null;
  paystackRecipientCode: string | null;
}) {
  try {
    if (!supplier.isPayoutEnabled) return;
    if (String(supplier.payoutMethod || '').toUpperCase() !== 'TRANSFER') return;
    if (supplier.paystackRecipientCode) return;
    if (!supplier.accountNumber || !supplier.bankCode) return;

    const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET_KEY) {
      console.warn('Paystack recipient skipped: PAYSTACK_SECRET_KEY missing');
      return;
    }

    const isNG = (supplier.bankCountry || 'NG').toUpperCase() === 'NG';
    const type = isNG ? 'nuban' : 'bank_account';

    const resp = await axios.post(
      'https://api.paystack.co/transferrecipient',
      {
        type,
        name: supplier.accountName || supplier.name,
        account_number: supplier.accountNumber,
        bank_code: supplier.bankCode,
        currency: isNG ? 'NGN' : undefined,
      },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }, timeout: 10000 }
    );

    const code = resp.data?.data?.recipient_code || null;
    if (code) {
      await prisma.supplier.update({
        where: { id: supplier.id },
        data: { paystackRecipientCode: code },
      });
    }
  } catch (e: any) {
    console.error('Paystack recipient creation failed:', e?.response?.status, e?.response?.data || e?.message);
  }
}

/**
 * Detect bank field changes and compute the "flip to PENDING" patch.
 * - If any of these fields change: bankCountry, bankCode, bankName, accountNumber, accountName
 * - Then require admin verification again.
 */
function computeBankPendingPatch(args: {
  current: {
    bankCountry: string | null;
    bankCode: string | null;
    bankName: string | null;
    accountNumber: string | null;
    accountName: string | null;
    bankVerificationStatus: string | null;
  };
  next: Partial<{
    bankCountry: string | null | undefined;
    bankCode: string | null | undefined;
    bankName: string | null | undefined;
    accountNumber: string | null | undefined;
    accountName: string | null | undefined;
  }>;
}) {
  const { current, next } = args;

  // Only consider keys that are actually present in payload
  const keys: Array<keyof typeof next> = ['bankCountry', 'bankCode', 'bankName', 'accountNumber', 'accountName'];

  const changed = keys.some((k) => {
    if (!(k in next)) return false;
    const nv = (next as any)[k];
    // undefined means "no change"
    if (nv === undefined) return false;
    const cv = (current as any)[k];
    return String(nv ?? '') !== String(cv ?? '');
  });

  if (!changed) return { changed: false, patch: {} as any };

  // If they changed bank info, it must be re-verified
  return {
    changed: true,
    patch: {
      bankVerificationStatus: 'PENDING',
      bankVerificationRequestedAt: new Date(),
      bankVerifiedAt: null,
      bankVerifiedById: null,
      // keep note (or clear it). I prefer clearing to avoid stale notes:
      bankVerificationNote: null,
    },
  };
}

/* ---------------- routes ---------------- */

// GET /api/admin/suppliers
router.get('/', requireAdmin, async (_req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,

        contactEmail: true,
        whatsappPhone: true,

        apiBaseUrl: true,
        apiAuthType: true,
        apiKey: true,

        payoutMethod: true,
        bankCountry: true,
        bankCode: true,
        bankName: true,
        accountNumber: true,
        accountName: true,
        isPayoutEnabled: true,

        paystackRecipientCode: true,
        paystackSubaccountCode: true,

        bankVerificationStatus: true,
        bankVerificationNote: true,
        bankVerificationRequestedAt: true,
        bankVerifiedAt: true,
        bankVerifiedById: true, // remove if not in schema
      },
    });

    res.json({ data: suppliers });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to fetch suppliers' });
  }
});

// GET /api/admin/suppliers/:id
router.get('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,

        contactEmail: true,
        whatsappPhone: true,

        apiBaseUrl: true,
        apiAuthType: true,
        apiKey: true,

        payoutMethod: true,
        bankCountry: true,
        bankCode: true,
        bankName: true,
        accountNumber: true,
        accountName: true,
        isPayoutEnabled: true,

        paystackRecipientCode: true,
        paystackSubaccountCode: true,

        bankVerificationStatus: true,
        bankVerificationNote: true,
        bankVerificationRequestedAt: true,
        bankVerifiedAt: true,
        bankVerifiedById: true, // remove if not in schema
      },
    });

    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    res.json({ data: supplier });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to fetch supplier' });
  }
});

// POST /api/admin/suppliers
router.post('/', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const {
      name,
      type = 'PHYSICAL',
      status = 'ACTIVE',
      contactEmail,
      whatsappPhone,

      apiBaseUrl,
      apiAuthType,
      apiKey,

      payoutMethod,
      bankCountry,
      bankCode,
      bankName,
      accountNumber,
      accountName,
      isPayoutEnabled,
    } = req.body || {};

    if (!name) return res.status(400).json({ error: 'name is required' });

    const created = await prisma.supplier.create({
      data: {
        name: String(name).trim(),
        type: normSupplierType(type),
        status: normStatus(status),

        contactEmail: toNull(contactEmail),
        whatsappPhone: toNull(whatsappPhone),

        apiBaseUrl: toNull(apiBaseUrl),
        apiAuthType: normAuth(apiAuthType) ?? 'NONE',
        apiKey: toNull(apiKey),

        payoutMethod: normPayoutMethod(payoutMethod),
        bankCountry: (toNull(bankCountry) || 'NG') as any,
        bankCode: toNull(bankCode),
        bankName: toNull(bankName),
        accountNumber: toNull(accountNumber),
        accountName: toNull(accountName),
        isPayoutEnabled: toBool(isPayoutEnabled, false),

        // If bank details were provided at create time, we can mark as PENDING for verification.
        ...(bankCode || accountNumber
          ? {
              bankVerificationStatus: 'PENDING',
              bankVerificationRequestedAt: new Date(),
            }
          : {}),
      },
    });

    await createPaystackRecipientIfNeeded({
      id: created.id,
      name: created.name,
      payoutMethod: created.payoutMethod,
      bankCountry: created.bankCountry,
      bankCode: created.bankCode,
      accountNumber: created.accountNumber,
      accountName: created.accountName,
      isPayoutEnabled: created.isPayoutEnabled,
      paystackRecipientCode: created.paystackRecipientCode,
    });

    res.status(201).json({ data: created });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to create supplier' });
  }
});

// PUT /api/admin/suppliers/:id
router.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name,
      type,
      status,
      contactEmail,
      whatsappPhone,

      apiBaseUrl,
      apiAuthType,
      apiKey,

      payoutMethod,
      bankCountry,
      bankCode,
      bankName,
      accountNumber,
      accountName,
      isPayoutEnabled,
    } = req.body || {};

    // Read current first so we can (a) protect VERIFIED bank details, (b) flip to PENDING on change
    const current = await prisma.supplier.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        payoutMethod: true,
        bankCountry: true,
        bankCode: true,
        bankName: true,
        accountNumber: true,
        accountName: true,
        isPayoutEnabled: true,
        paystackRecipientCode: true,
        bankVerificationStatus: true,
      },
    });

    if (!current) return res.status(404).json({ error: 'Supplier not found' });

    // Prepare bank patch candidates (normalized like your current code)
    const nextBank = {
      ...(bankCountry !== undefined ? { bankCountry: toUndef(bankCountry) ?? undefined } : {}),
      ...(bankCode !== undefined ? { bankCode: toUndef(bankCode) ?? undefined } : {}),
      ...(bankName !== undefined ? { bankName: toUndef(bankName) ?? undefined } : {}),
      ...(accountNumber !== undefined ? { accountNumber: toUndef(accountNumber) ?? undefined } : {}),
      ...(accountName !== undefined ? { accountName: toUndef(accountName) ?? undefined } : {}),
    };

    const bankPending = computeBankPendingPatch({
      current: {
        bankCountry: current.bankCountry,
        bankCode: current.bankCode,
        bankName: current.bankName,
        accountNumber: current.accountNumber,
        accountName: current.accountName,
        bankVerificationStatus: current.bankVerificationStatus as any,
      },
      next: nextBank as any,
    });

    // If already VERIFIED, block changing bank details via this endpoint.
    // (If you prefer to ALLOW changes and just flip to PENDING, remove this block.)
    if (current.bankVerificationStatus === 'VERIFIED' && bankPending.changed) {
      return res.status(400).json({
        error: 'Bank details are VERIFIED and cannot be edited. Reject/Unlock or change via a dedicated flow.',
      });
    }

    const updated = await prisma.supplier.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(type !== undefined ? { type: normSupplierType(type) } : {}),
        ...(status !== undefined ? { status: normStatus(status) } : {}),

        ...(contactEmail !== undefined ? { contactEmail: toNullablePatch(contactEmail) } : {}),
        ...(whatsappPhone !== undefined ? { whatsappPhone: toNullablePatch(whatsappPhone) } : {}),

        ...(apiBaseUrl !== undefined ? { apiBaseUrl: toNullablePatch(apiBaseUrl) } : {}),
        ...(apiAuthType !== undefined ? { apiAuthType: normAuth(apiAuthType) ?? 'NONE' } : {}),
        ...(apiKey !== undefined ? { apiKey: toNullablePatch(apiKey) } : {}),

        ...(payoutMethod !== undefined ? { payoutMethod: normPayoutMethod(payoutMethod) } : {}),
        ...nextBank,
        ...(isPayoutEnabled !== undefined ? { isPayoutEnabled: toBool(isPayoutEnabled) } : {}),

        // flip to PENDING if bank details changed (only when not VERIFIED because we block above)
        ...(bankPending.changed ? bankPending.patch : {}),
      },
    });

    await createPaystackRecipientIfNeeded({
      id: updated.id,
      name: updated.name,
      payoutMethod: updated.payoutMethod,
      bankCountry: updated.bankCountry,
      bankCode: updated.bankCode,
      accountNumber: updated.accountNumber,
      accountName: updated.accountName,
      isPayoutEnabled: updated.isPayoutEnabled,
      paystackRecipientCode: updated.paystackRecipientCode,
    });

    res.json({ data: updated });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to update supplier' });
  }
});

// DELETE /api/admin/suppliers/:id
router.delete('/:id', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const usage = await supplierUsageCounts(id);

    const inUse =
      usage.productOffers > 0 || usage.variantOffers > 0 || usage.purchaseOrders > 0 || usage.chosenOrderItems > 0;

    if (inUse) {
      return res.status(400).json({
        error: 'Cannot delete supplier: it is in use',
        details: usage,
      });
    }

    await prisma.supplier.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to delete supplier' });
  }
});

// POST /api/admin/suppliers/:id/link-bank
router.post('/:id/link-bank', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { supplierName, bankCode, accountNumber, bankName, country = 'NG', currency = 'NGN' } = req.body || {};

    if (!bankCode || !accountNumber) {
      return res.status(400).json({ error: 'bankCode and accountNumber are required' });
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        bankVerificationStatus: true,
      },
    });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    // If VERIFIED, block link-bank changes too (consistent with PUT protection)
    if (supplier.bankVerificationStatus === 'VERIFIED') {
      return res.status(400).json({ error: 'Bank details are VERIFIED and cannot be changed.' });
    }

    const { data: r } = await paystack.post(
      '/transferrecipient',
      {
        type: String(country).toUpperCase() === 'NG' ? 'nuban' : 'bank_account',
        name: String(supplierName || supplier.name),
        account_number: String(accountNumber),
        bank_code: String(bankCode),
        currency: String(currency || 'NGN'),
      },
      { timeout: 10000 } as any
    );

    const recipientCode = r?.data?.recipient_code || null;
    const resolvedAccountName = r?.data?.details?.account_name ?? null;

    const sup = await prisma.supplier.update({
      where: { id },
      data: {
        bankCountry: String(country || 'NG'),
        bankCode: String(bankCode),
        bankName: toNull(bankName),
        accountNumber: String(accountNumber),
        accountName: resolvedAccountName,
        paystackRecipientCode: recipientCode,
        payoutMethod: 'TRANSFER',
        isPayoutEnabled: true,

        // ✅ require admin confirmation after linking/changing bank
        bankVerificationStatus: 'PENDING',
        bankVerificationRequestedAt: new Date(),
        bankVerifiedAt: null,
        bankVerifiedById: null,
        bankVerificationNote: null,
      },
    });

    res.json({ ok: true, supplier: sup });
  } catch (e: any) {
    console.error('link-bank failed:', e?.response?.status, e?.response?.data || e?.message);
    res.status(400).json({ error: e?.message || 'Failed to link bank' });
  }
});

// POST /api/admin/suppliers/:id/bank-verify
router.post('/:id/bank-verify', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const supplierId = String(req.params.id);

    const body = z
      .object({
        decision: z.enum(['VERIFIED', 'REJECTED']),
        note: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});

    const adminId = (req as any)?.user?.id ?? null;

    const current = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        name: true,
        payoutMethod: true,
        bankCountry: true,
        bankCode: true,
        bankName: true,
        accountNumber: true,
        accountName: true,
        isPayoutEnabled: true,
        paystackRecipientCode: true,
        bankVerificationStatus: true,
      },
    });

    if (!current) return res.status(404).json({ error: 'Supplier not found' });

    if (body.decision === 'VERIFIED') {
      if (!current.bankCode || !current.accountNumber) {
        return res.status(400).json({
          error: 'Cannot verify bank details: bankCode and accountNumber are required.',
        });
      }
    }

    const updated = await prisma.supplier.update({
      where: { id: supplierId },
      data:
        body.decision === 'VERIFIED'
          ? {
              bankVerificationStatus: 'VERIFIED',
              bankVerifiedAt: new Date(),
              bankVerifiedById: adminId,
              bankVerificationNote: body.note ?? null,
            }
          : {
              bankVerificationStatus: 'REJECTED',
              bankVerifiedAt: null,
              bankVerifiedById: null,
              bankVerificationNote: body.note ?? 'Rejected',
            },
      select: {
        id: true,
        bankVerificationStatus: true,
        bankVerificationNote: true,
        bankVerificationRequestedAt: true,
        bankVerifiedAt: true,
        bankVerifiedById: true, // remove if not in schema
      },
    });

    if (body.decision === 'VERIFIED') {
      await createPaystackRecipientIfNeeded({
        id: current.id,
        name: current.name,
        payoutMethod: current.payoutMethod,
        bankCountry: current.bankCountry,
        bankCode: current.bankCode,
        accountNumber: current.accountNumber,
        accountName: current.accountName,
        isPayoutEnabled: current.isPayoutEnabled,
        paystackRecipientCode: current.paystackRecipientCode,
      });
    }

    return res.json({ ok: true, data: updated });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || 'Failed to verify bank details' });
  }
});

export default router;
