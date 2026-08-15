import { prisma } from "../lib/prisma.js";
import { runWithAdvisoryLock } from "../lib/advisoryLock.js";
import { releaseDueHeldPayoutsOnce } from "./payoutRelease.job.js";
import { expireUnpaidOrdersOnce } from "./expireUnpaidOrders.job.js";
import { recomputeProductStockOnce } from "./recomputeProductStock.jobs.js";
import { checkLowStockOnce } from "./lowStockCheck.job.js";

type JobResult = unknown;

type Job = {
  name: string;
  run: () => Promise<JobResult>;
  /** Postgres advisory lock key — must be stable and unique per job. */
  lockKey: number;
};

function getJobGroup(): "fast" | "medium" | "daily" | "all" {
  const raw = String(process.env.JOB_GROUP ?? "fast").trim().toLowerCase();
  if (raw === "fast" || raw === "medium" || raw === "daily" || raw === "all") {
    return raw;
  }
  return "fast";
}

function getJobs(group: ReturnType<typeof getJobGroup>): Job[] {
  const fastJobs: Job[] = [
    {
      name: "expire-unpaid-orders",
      run: expireUnpaidOrdersOnce,
      lockKey: 7_270_001,
    },
  ];

  const mediumJobs: Job[] = [
    {
      name: "payout-release",
      run: releaseDueHeldPayoutsOnce,
      lockKey: 7_270_002,
    },
    {
      name: "recompute-product-stock",
      run: recomputeProductStockOnce,
      lockKey: 7_270_003,
    },
    {
      name: "low-stock-check",
      run: checkLowStockOnce,
      lockKey: 7_270_004,
    },
  ];

  const dailyJobs: Job[] = [];

  if (group === "fast") return fastJobs;
  if (group === "medium") return mediumJobs;
  if (group === "daily") return dailyJobs;
  return [...fastJobs, ...mediumJobs, ...dailyJobs];
}

async function main() {
  const group = getJobGroup();
  const jobs = getJobs(group);

  console.log("[worker] started", {
    group,
    jobCount: jobs.length,
  });

  for (const job of jobs) {
    const startedAt = Date.now();

    try {
      console.log(`[worker] running ${job.name}`);

      const { ran, result } = await runWithAdvisoryLock(job.lockKey, job.run);

      if (!ran) {
        console.log(`[worker] skipped ${job.name}: lock already held (another run in progress)`);
        continue;
      }

      console.log(`[worker] done ${job.name}`, {
        durationMs: Date.now() - startedAt,
        result,
      });
    } catch (err) {
      console.error(`[worker] failed ${job.name}`, err);
    }
  }

  console.log("[worker] finished", { group });
}

main()
  .catch((err) => {
    console.error("[worker] fatal error", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });