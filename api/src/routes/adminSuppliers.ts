// server/routes/adminSuppliers.ts
import { Router } from 'express';
import { PrismaClient, SupplierType } from '@prisma/client';
import paystack from './paystack.js';
import axios from 'axios';
import { requireAdmin, requireSuperAdmin } from '../middleware/auth.js';

const prisma = new PrismaClient();
const router = Router();

// GET /api/admin/suppliers
router.get('/', requireAdmin, async (_req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: 'asc' },
    });
    res.json({ data: suppliers });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to fetch suppliers' });
  }
});


/* ---------------- helpers ---------------- */

const toNull = <T = any>(v: T | undefined | null): T | null =>
  (v === '' || v === undefined ? null : (v as any));

const toBool = (v: any, def = false) =>
  v === true || v === 'true' || v === 1 || v === '1' ? true : v === false || v === 'false' ? false : def;

const normAuth = (s?: string | null) => {
  const v = (s || '').toUpperCase();
  return (['NONE', 'BEARER', 'BASIC'] as const).includes(v as any) ? (v as 'NONE' | 'BEARER' | 'BASIC') : null;
};

const normPayoutMethod = (s?: string | null) => {
  const v = (s || '').toUpperCase();
  return (['TRANSFER', 'SPLIT'] as const).includes(v as any) ? (v as 'TRANSFER' | 'SPLIT') : null;
};

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
    if (supplier.payoutMethod !== 'TRANSFER') return;
    if (supplier.paystackRecipientCode) return; // already have one
    if (!supplier.accountNumber || !supplier.bankCode) return;

    const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET_KEY) {
      console.warn('Paystack recipient skipped: PAYSTACK_SECRET_KEY missing');
      return;
    }

    const type = (supplier.bankCountry || 'NG') === 'NG' ? 'nuban' : 'bank_account';

    const resp = await axios.post(
      'https://api.paystack.co/transferrecipient',
      {
        type,
        name: supplier.accountName || supplier.name,
        account_number: supplier.accountNumber,
        bank_code: supplier.bankCode,
        currency: (supplier.bankCountry || 'NG') === 'NG' ? 'NGN' : undefined,
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
    // do not throw — supplier save should not be blocked
  }
}

/* ---------------- routes ---------------- */

// POST /api/admin/suppliers
router.post('/', requireSuperAdmin, async (req, res) => {
  try {
    const {
      name,
      type = 'PHYSICAL',
      status = 'ACTIVE',
      contactEmail,
      whatsappPhone,

      // API creds
      apiBaseUrl,
      apiAuthType,
      apiKey,

      // payout & bank
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
        name: String(name),
        type: (Object.values(SupplierType) as string[]).includes(String(type)) ? type : SupplierType.PHYSICAL,
        status: String(status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',

        contactEmail: toNull(contactEmail),
        whatsappPhone: toNull(whatsappPhone),

        apiBaseUrl: toNull(apiBaseUrl),
        apiAuthType: normAuth(apiAuthType) ?? 'NONE',
        apiKey: toNull(apiKey),

        payoutMethod: normPayoutMethod(payoutMethod),
        bankCountry: toNull(bankCountry) || 'NG',
        bankCode: toNull(bankCode),
        bankName: toNull(bankName),
        accountNumber: toNull(accountNumber),
        accountName: toNull(accountName),
        isPayoutEnabled: toBool(isPayoutEnabled, false),
      },
    });

    // Optional: create a Paystack transfer recipient now (non-blocking)
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
router.put('/:id', requireSuperAdmin, async (req, res) => {
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

    const updated = await prisma.supplier.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: String(name) } : {}),
        ...(type !== undefined
          ? { type: (Object.values(SupplierType) as string[]).includes(String(type)) ? type : SupplierType.PHYSICAL }
          : {}),
        ...(status !== undefined ? { status: String(status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' } : {}),

        ...(contactEmail !== undefined ? { contactEmail: toNull(contactEmail) } : {}),
        ...(whatsappPhone !== undefined ? { whatsappPhone: toNull(whatsappPhone) } : {}),

        ...(apiBaseUrl !== undefined ? { apiBaseUrl: toNull(apiBaseUrl) } : {}),
        ...(apiAuthType !== undefined ? { apiAuthType: normAuth(apiAuthType) ?? 'NONE' } : {}),
        ...(apiKey !== undefined ? { apiKey: toNull(apiKey) } : {}),

        ...(payoutMethod !== undefined ? { payoutMethod: normPayoutMethod(payoutMethod) } : {}),
        ...(bankCountry !== undefined ? { bankCountry: toNull(bankCountry) } : {}),
        ...(bankCode !== undefined ? { bankCode: toNull(bankCode) } : {}),
        ...(bankName !== undefined ? { bankName: toNull(bankName) } : {}),
        ...(accountNumber !== undefined ? { accountNumber: toNull(accountNumber) } : {}),
        ...(accountName !== undefined ? { accountName: toNull(accountName) } : {}),
        ...(isPayoutEnabled !== undefined ? { isPayoutEnabled: toBool(isPayoutEnabled) } : {}),
        // NOTE: paystackRecipientCode and paystackSubaccountCode are *not* client-writable here on purpose.
      },
    });

    // If payouts just got enabled (or bank details changed), ensure recipient
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
router.delete('/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Optional: prevent delete if supplier is referenced by products
    const count = await prisma.product.count({ where: { supplierId: id } });
    if (count > 0) return res.status(400).json({ error: 'Cannot delete supplier: it is in use by products' });

    await prisma.supplier.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to delete supplier' });
  }
});


// POST /api/admin/suppliers/:id/link-bank
// body: { bankCode, accountNumber, bankName?, country? = "NG", currency? = "NGN" }
router.post('/:id/link-bank', async (req, res) => {
  const { id } = req.params;
  const { supplierName,bankCode, accountNumber, bankName, country = 'NG', currency = 'NGN' } = req.body;

  // 1) Create Transfer Recipient
  const { data: r } = await paystack.post('/transferrecipient', {
    type: 'nuban', // NG bank account
    name: supplierName, // optional; you can first resolve account to get name
    account_number: accountNumber,
    bank_code: bankCode,
    currency
  }); // returns data.recipient_code
  const recipientCode = r?.data?.recipient_code;

  // 2) Save on supplier
  const sup = await prisma.supplier.update({
    where: { id },
    data: {
      bankCountry: country, bankCode, bankName, accountNumber,
      accountName: r?.data?.details?.account_name ?? null,
      paystackRecipientCode: recipientCode,
      payoutMethod: 'TRANSFER',
      isPayoutEnabled: true
    }
  });

  res.json({ ok: true, supplier: sup });
});



export default router;
