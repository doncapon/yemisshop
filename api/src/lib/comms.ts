// api/src/lib/comms.ts
import {prisma}  from '../lib/prisma.js';

const KEY = 'globalCommsFeeNaira';

export async function getGlobalCommsFee(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const n = Number(row?.value);
  return Number.isFinite(n) ? n : 0; // default 0 if not set
}
