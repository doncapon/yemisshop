import { prisma } from "./prisma.js";

/**
 * Runs `fn` only if this process can acquire a Postgres transaction-scoped
 * advisory lock for `key`. If another process already holds the same key
 * (e.g. an overlapping cron trigger, or a second replica), this resolves
 * immediately with `{ ran: false }` instead of running `fn` — safe to call
 * concurrently without double-processing the same work.
 *
 * The lock releases automatically when the wrapping transaction ends
 * (commit, rollback, or the process crashing), so there's no separate
 * unlock step and no risk of a stuck lock outliving the job.
 */
export async function runWithAdvisoryLock<T>(
  key: number,
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number }
): Promise<{ ran: boolean; result?: T }> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${key}) AS locked
      `;
      const locked = rows?.[0]?.locked === true;

      if (!locked) {
        return { ran: false as const };
      }

      const result = await fn();
      return { ran: true as const, result };
    },
    { timeout: opts?.timeoutMs ?? 10 * 60_000, maxWait: 5_000 }
  );
}
