import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { releaseDueHeldPayoutsOnce } from "./payoutRelease.job.js";

let started = false;
let payoutTask: cron.ScheduledTask | null = null;
let configRefreshTimer: NodeJS.Timeout | null = null;
let isPayoutReleaseRunning = false;
let appliedConfigKey = "";

type SchedulerConfig = {
  enabled: boolean;
  intervalHours: 3 | 4 | 6 | 8 | 12 | 24;
  timezone: string;
};

function isTruthy(v: unknown) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

async function readSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    try {
      const row = await prisma.setting.findFirst({ where: { key } });
      return row?.value ?? null;
    } catch {
      return null;
    }
  }
}

async function upsertSetting(key: string, value: string, isPublic = false, meta: any = null) {
  try {
    await prisma.setting.upsert({
      where: { key },
      update: { value, isPublic, meta },
      create: { key, value, isPublic, meta } as any,
    });
  } catch (e: any) {
    if (e?.code === "P2022" || /Unknown argument .*isPublic|meta/i.test(String(e?.message))) {
      const existing = await prisma.setting.findFirst({ where: { key } });
      if (existing) {
        await prisma.setting.update({
          where: { id: existing.id },
          data: { value } as any,
        });
      } else {
        await prisma.setting.create({
          data: { key, value } as any,
        });
      }
      return;
    }
    throw e;
  }
}

function parseIntervalHours(v: unknown): 3 | 4 | 6 | 8 | 12 | 24 {
  const n = Number(v);
  if (n === 3 || n === 4 || n === 6 || n === 8 || n === 12 || n === 24) return n;
  return 6;
}

function parseTimezone(v: unknown): string {
  const s = String(v ?? "").trim();
  return s || "UTC";
}

function buildCronExpression(intervalHours: 3 | 4 | 6 | 8 | 12 | 24): string {
  if (intervalHours === 24) return "0 0 * * *";
  return `0 */${intervalHours} * * *`;
}

async function loadSchedulerConfig(): Promise<SchedulerConfig> {
  const enabledRaw = await readSetting("payoutReleaseSchedulerEnabled");
  const intervalRaw = await readSetting("payoutReleaseIntervalHours");
  const timezoneRaw = await readSetting("payoutReleaseSchedulerTimezone");

  return {
    enabled: enabledRaw === null ? true : isTruthy(enabledRaw),
    intervalHours: parseIntervalHours(intervalRaw),
    timezone: parseTimezone(timezoneRaw),
  };
}

async function persistRunMeta(args: {
  status: "IDLE" | "RUNNING" | "SUCCESS" | "FAILED";
  ranAt?: Date | null;
  summary?: any;
  error?: string | null;
}) {
  const ranAtValue = args.ranAt ? args.ranAt.toISOString() : "";
  const summaryValue = args.summary ? JSON.stringify(args.summary) : "";
  const errorValue = args.error ? String(args.error) : "";

  await Promise.all([
    upsertSetting("payoutReleaseLastRunStatus", args.status),
    upsertSetting("payoutReleaseLastRunAt", ranAtValue),
    upsertSetting("payoutReleaseLastRunSummary", summaryValue),
    upsertSetting("payoutReleaseLastRunError", errorValue),
  ]);
}

async function runPayoutReleaseOnce() {
  if (isPayoutReleaseRunning) {
    console.log("[cron:payout-release] skipped: already running on this instance");
    return;
  }

  isPayoutReleaseRunning = true;
  const startedAt = new Date();

  try {
    await persistRunMeta({
      status: "RUNNING",
      ranAt: startedAt,
      summary: null,
      error: null,
    });

    console.log("[cron:payout-release] tick", {
      ranAt: startedAt.toISOString(),
    });

    const result = await releaseDueHeldPayoutsOnce();

    console.log("[cron:payout-release] done", {
      durationMs: Date.now() - startedAt.getTime(),
      scanned: result?.scanned ?? 0,
      released: result?.released ?? 0,
      skipped: result?.skipped ?? 0,
      failed: result?.failed ?? 0,
    });

    await persistRunMeta({
      status: "SUCCESS",
      ranAt: startedAt,
      summary: result,
      error: null,
    });
  } catch (err: any) {
    console.error("[cron:payout-release] failed:", err);

    await persistRunMeta({
      status: "FAILED",
      ranAt: startedAt,
      summary: null,
      error: String(err?.message || err || "unknown_error"),
    });
  } finally {
    isPayoutReleaseRunning = false;
  }
}

function destroyPayoutTask() {
  if (!payoutTask) return;
  payoutTask.stop();
  payoutTask.destroy();
  payoutTask = null;
}

async function syncPayoutScheduler() {
  const cfg = await loadSchedulerConfig();
  const nextConfigKey = JSON.stringify(cfg);

  if (nextConfigKey === appliedConfigKey) return;

  destroyPayoutTask();

  if (!cfg.enabled) {
    appliedConfigKey = nextConfigKey;
    console.log("[cron] payout release scheduler disabled", cfg);
    return;
  }

  const expression = buildCronExpression(cfg.intervalHours);

  payoutTask = cron.schedule(
    expression,
    async () => {
      await runPayoutReleaseOnce();
    },
    {
      timezone: cfg.timezone,
    }
  );

  appliedConfigKey = nextConfigKey;

  console.log("[cron] payout release scheduler registered", {
    expression,
    intervalHours: cfg.intervalHours,
    timezone: cfg.timezone,
    enabled: cfg.enabled,
  });
}

export function registerJobs() {
  if (started) return;

  const shouldRunScheduler = isTruthy(process.env.RUN_SCHEDULER);

  if (!shouldRunScheduler) {
    console.log("[cron] scheduler disabled on this instance");
    return;
  }

  started = true;

  void syncPayoutScheduler();

  configRefreshTimer = setInterval(() => {
    void syncPayoutScheduler();
  }, 5 * 60_000); // was 60_000

  if (typeof configRefreshTimer.unref === "function") {
    configRefreshTimer.unref();
  }

  console.log("[cron] jobs bootstrap complete");
}

export function stopJobs() {
  destroyPayoutTask();

  if (configRefreshTimer) {
    clearInterval(configRefreshTimer);
    configRefreshTimer = null;
  }

  appliedConfigKey = "";
  isPayoutReleaseRunning = false;
  started = false;
}
