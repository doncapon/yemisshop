// api/src/lib/settings.ts
import { prisma } from '../lib/prisma.js';

/** Read raw string (null if missing or table not found). */
export async function readSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({
      where: { key },
      select: { value: true },
    });
    const v = row?.value;
    return v == null ? null : String(v);
  } catch (e: any) {
    // Table not found, etc. → treat as unset
    if (e?.code === 'P2021') return null;
    throw e;
  }
}

/** Upsert a setting as string. Returns the saved value (string or null). */
export async function writeSetting(key: string, value: any): Promise<string | null> {
  const v = value == null ? null : String(value);
  try {
    const row = await prisma.setting.upsert({
      where: { key },
      create: { key, value: v },
      update: { value: v },
      select: { value: true },
    });
    return row.value ?? null;
  } catch (e: any) {
    if (e?.code === 'P2021') {
      // If the table doesn't exist yet, surface a clear error
      throw new Error('Setting table not found. Add a Setting model to your Prisma schema.');
    }
    throw e;
  }
}

/** Number helper with default. */
export async function readNumberSetting(key: string, def = 0): Promise<number> {
  const v = await readSetting(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/** Boolean helper with default (accepts "true"/"1"/true). */
export async function readBooleanSetting(key: string, def = false): Promise<boolean> {
  const v = await readSetting(key);
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

/** JSON helper (parse object/array), returns default if missing/invalid. */
export async function readJSONSetting<T = unknown>(key: string, def: T): Promise<T> {
  const v = await readSetting(key);
  if (!v) return def;
  try {
    return JSON.parse(v) as T;
  } catch {
    return def;
  }
}

/** Write JSON (stringifies). */
export async function writeJSONSetting(key: string, value: unknown): Promise<void> {
  await writeSetting(key, JSON.stringify(value ?? null));
}
