// src/jobs/registerJobs.ts
import cron from "node-cron";
import { releaseDueHeldPayoutsOnce } from "./payoutRelease.job.js";

let started = false;

export function registerJobs() {
  if (started) return;
  started = true;

  // every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    try {
      const result = await releaseDueHeldPayoutsOnce();
      console.log("I am in log called: ")

      if (result.scanned > 0) {
        console.log("[cron:payout-release]", result);
      }
    } catch (err) {
      console.error("[cron:payout-release] failed:", err);
    }
  });

  console.log("[cron] jobs registered");
}