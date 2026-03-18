import { prisma } from "../lib/prisma.js";
import { releaseDueHeldPayoutsOnce } from "./payoutRelease.job.js";
import { expireUnpaidOrdersOnce } from "./expireUnpaidOrders.job.js";
import { recomputeProductStockOnce } from "./recomputeProductStock.jobs.js";

type JobResult = unknown;

type Job = {
  name: string;
  run: () => Promise<JobResult>;
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
    },
  ];

  const mediumJobs: Job[] = [
    {
      name: "payout-release",
      run: releaseDueHeldPayoutsOnce,
    },
    {
      name: "recompute-product-stock",
      run: recomputeProductStockOnce,
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
      const result = await job.run();

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