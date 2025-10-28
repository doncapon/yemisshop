// // api/src/routes/admin.settings.ts
// import { Router } from 'express';
// import { prisma } from '../lib/prisma.js';
// import { requireAdmin } from '../middleware/auth.js';

// const router = Router();
// /** Helpers */
// async function getSetting(key: string): Promise<string | null> {
//   const row = await prisma.setting.findUnique({ where: { key } });
//   return row?.value ?? null;
// }
// async function setSetting(key: string, value: string) {
//   return prisma.setting.upsert({
//     where: { key },
//     create: { key, value },
//     update: { value },
//   });
// }
// const asNum = (v: any) => {
//   const n = Number(v);
//   return Number.isFinite(n) ? n : null;
// };

// /* ------------------------------------------------------------------ */
// /*  ADMIN: COMMS unit cost                                             */
// /*  Keys: commsUnitCost (number-as-string, e.g. "40")                  */
// /* ------------------------------------------------------------------ */




// router.get('/comms', requireAdmin, async (req, res) => {
//   const raw = await getSetting('commsServiceFeeNGN');
//   const value = raw != null ? Number(raw) : 0;
//   return res.json({ key: 'commsServiceFeeNGN', value });
// });

// router.put('/comms', requireAdmin, async (req, res) => {
//   const n = asNum(req.body?.value);
//   if (n == null || n < 0) return res.status(400).json({ error: 'value must be a non-negative number' });
//   await setSetting('commsServiceFeeNGN', String(n));
//   return res.json({ key: 'commsServiceFeeNGN', value: n });
// });

// /* ------------------------------------------------------------------ */
// /*  TAX settings                                                       */
// /*  Keys: taxMode ("INCLUDED"|"ADDED"|"NONE"), taxRatePct ("7.5")      */
// /* ------------------------------------------------------------------ */
// const VALID_TAX_MODES = new Set(['INCLUDED', 'ADDED', 'NONE']);

// /** ADMIN read */
// router.get('/tax', requireAdmin, async (req, res) => {
//   const mode = (await getSetting('taxMode')) ?? 'INCLUDED';
//   const pct = (await getSetting('taxRatePct')) ?? '7.5';
//   const taxMode = VALID_TAX_MODES.has(mode) ? mode : 'INCLUDED';
//   const taxRatePct = Number(pct) || 0;
//   return res.json({ taxMode, taxRatePct });
// });

// /** ADMIN write */
// router.put('/tax', requireAdmin, async (req, res) => {
//   const body = req.body ?? {};
//   const modeRaw = String(body.taxMode ?? '').toUpperCase();
//   const pctNum = asNum(body.taxRatePct);

//   if (!VALID_TAX_MODES.has(modeRaw)) {
//     return res.status(400).json({ error: 'taxMode must be INCLUDED, ADDED or NONE' });
//   }
//   if (pctNum == null || pctNum < 0 || pctNum > 50) {
//     return res.status(400).json({ error: 'taxRatePct must be a number between 0 and 50' });
//   }

//   await setSetting('taxMode', modeRaw);
//   await setSetting('taxRatePct', String(pctNum));

//   return res.json({ taxMode: modeRaw, taxRatePct: pctNum });
// });

// export default router;
