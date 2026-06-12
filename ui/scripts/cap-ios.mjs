/**
 * Wrapper for `npx cap run ios` with optional Capacitor dev server URL.
 * Must be run on a Mac with Xcode installed.
 *
 * Usage:
 *   node scripts/cap-ios.mjs                          # production build
 *   node scripts/cap-ios.mjs http://localhost:5173     # simulator live-reload
 *   node scripts/cap-ios.mjs http://192.168.x.x:5173  # real device live-reload
 */
import { spawnSync } from "child_process";

const devUrl = process.argv[2]?.trim() || undefined;

const childEnv = { ...process.env };
if (devUrl) {
  childEnv.CAPACITOR_DEV_SERVER_URL = devUrl;
}

const result = spawnSync("npx", ["cap", "run", "ios"], {
  stdio: "inherit",
  env: childEnv,
  shell: true,
});

if (result.status === 0) process.exit(0);

// Fallback: find the connected simulator/device and launch directly
console.log("\n[cap-ios] Capacitor timed out — attempting xcrun launch fallback...");
const launch = spawnSync(
  "xcrun",
  ["simctl", "launch", "booted", "com.dayspringhouse.app"],
  { stdio: "inherit" }
);
process.exit(launch.status ?? 0);
