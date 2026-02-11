// api/src/lib/settings.ts
import { prisma } from "../lib/prisma.js";

/**
 * Single, deduped Settings helper module.
 *
 * Key rules:
 * - Setting.value is stored as string in Prisma (NOT nullable in most schemas).
 * - Callers may pass null/undefined; we never send null to Prisma for `value`.
 *   - For updates: omit `value` if null/undefined.
 *   - For creates: use "" (empty string) if missing, to satisfy required string.
 *
 * Also:
 * - If your schema does NOT have unique key, we fall back to findFirst + update/create.
 * - If the table/model doesn't exist (P2021), we treat reads as null and writes throw.
 */

/* -------------------------------- helpers -------------------------------- */

const normKey = (k: unknown) => String(k ?? "").trim();

const toStringOrUndefined = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  return String(v);
};

const isPrismaTableMissing = (e: any) => String(e?.code) === "P2021";

/* ----------------------------- public API ----------------------------- */

/** Read raw string (null if missing or table not found). */
export async function readSetting(key: string): Promise<string | null> {
  const k = normKey(key);
  if (!k) return null;

  try {
    const row = await prisma.setting.findUnique({
      where: { key: k },
      select: { value: true },
    });
    return row?.value ?? null;
  } catch (e: any) {
    // Some schemas don't have unique key; fallback to findFirst
    try {
      const row = await prisma.setting.findFirst({
        where: { key: k },
        select: { value: true },
      });
      return row?.value ?? null;
    } catch (e2: any) {
      if (isPrismaTableMissing(e2)) return null;
      if (isPrismaTableMissing(e)) return null;
      throw e2;
    }
  }
}

/**
 * Upsert a setting as string.
 * Returns the saved value (string, or null if value was null and update was skipped).
 *
 * NOTE:
 * - If `value` is null/undefined:
 *   - If key exists: we do a no-op update (returns existing).
 *   - If key missing: we create with "" (empty string) so Prisma is satisfied.
 */
export async function writeSetting(
  key: string,
  value: unknown,
  extra?: Record<string, any>,
): Promise<string | null> {
  const k = normKey(key);
  if (!k) throw new Error("writeSetting: key is required");

  const v = toStringOrUndefined(value);

  // build update payload; NEVER send null for value
  const updateData: Record<string, any> = { ...(extra || {}) };
  if (v !== undefined) updateData.value = v;

  // create payload must satisfy required value:string in most schemas
  const createData: Record<string, any> = { key: k, ...(extra || {}) };
  createData.value = v ?? "";

  try {
    // Prefer upsert if key is unique in schema
    const row = await prisma.setting.upsert({
      where: { key: k },
      create: createData as any,
      update: updateData as any,
      select: { value: true },
    });
    return row?.value ?? null;
  } catch (e: any) {
    if (isPrismaTableMissing(e)) {
      throw new Error(
        "Setting table not found. Add a Setting model to your Prisma schema.",
      );
    }

    // Fallback for schemas where key isn't unique / upsert not supported as expected
    const existing = await prisma.setting
      .findFirst({ where: { key: k }, select: { id: true, value: true } })
      .catch((err: any) => {
        if (isPrismaTableMissing(err)) return null;
        throw err;
      });

    if (existing?.id) {
      // if v is undefined, don't touch value; just update other extra fields
      const updated = await prisma.setting.update({
        where: { id: existing.id },
        data: updateData as any,
        select: { value: true },
      });
      return updated?.value ?? null;
    }

    const created = await prisma.setting.create({
      data: createData as any,
      select: { value: true },
    });
    return created?.value ?? null;
  }
}

/** Number helper with default. */
export async function readNumberSetting(key: string, def = 0): Promise<number> {
  const v = await readSetting(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/** Boolean helper with default (accepts "true"/"1"/"yes"/"on"). */
export async function readBooleanSetting(
  key: string,
  def = false,
): Promise<boolean> {
  const v = await readSetting(key);
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  return ["true", "1", "yes", "on"].includes(s);
}

/** JSON helper (parse object/array), returns default if missing/invalid. */
export async function readJSONSetting<T = unknown>(
  key: string,
  def: T,
): Promise<T> {
  const v = await readSetting(key);
  if (!v) return def;
  try {
    return JSON.parse(v) as T;
  } catch {
    return def;
  }
}

/** Write JSON (stringifies). */
export async function writeJSONSetting(
  key: string,
  value: unknown,
  extra?: Record<string, any>,
): Promise<string | null> {
  return writeSetting(key, JSON.stringify(value ?? null), extra);
}
