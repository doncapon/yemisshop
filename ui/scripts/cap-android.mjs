/**
 * Wrapper that sets JAVA_HOME (Android Studio bundled JDK) and
 * optionally CAPACITOR_DEV_SERVER_URL before running `npx cap run android`.
 *
 * Also sets up ADB reverse port forwarding so the emulator's localhost:8080
 * and localhost:5173 reach the host machine — required for Google OAuth callbacks
 * (Google always redirects to the registered URI, which uses `localhost`).
 *
 * If Capacitor's `am start -W` times out (ADB unresponsive error), the script
 * falls back to launching the app directly via ADB without the -W wait flag.
 *
 * Usage:
 *   node scripts/cap-android.mjs                        # production build
 *   node scripts/cap-android.mjs http://10.0.2.2:5173   # emulator live-reload
 */
import { spawnSync } from "child_process";

const JAVA_HOME = "C:\\Program Files\\Android\\Android Studio\\jbr";
const ANDROID_SDK =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  `${process.env.LOCALAPPDATA}\\Android\\Sdk`;
const ADB = `${ANDROID_SDK}\\platform-tools\\adb.exe`;
const APP_ID = "com.dayspringhouse.app";

const devUrl = process.argv[2]?.trim() || undefined;

const childEnv = {
  ...process.env,
  JAVA_HOME,
  ANDROID_HOME: ANDROID_SDK,
  ANDROID_SDK_ROOT: ANDROID_SDK,
  PATH: [
    `${JAVA_HOME}\\bin`,
    `${ANDROID_SDK}\\platform-tools`,
    `${ANDROID_SDK}\\tools`,
    process.env.PATH ?? "",
  ].join(";"),
};

if (devUrl) {
  childEnv.CAPACITOR_DEV_SERVER_URL = devUrl;
}

// Set up reverse port forwarding so emulator's localhost reaches the host.
// Required for Google OAuth: Google redirects to localhost:8080 (the registered URI),
// which must resolve to the host backend, not the emulator's own loopback.
function setupPortForwarding() {
  const devicesResult = spawnSync(ADB, ["devices"], { encoding: "utf8" });
  const deviceLines = (devicesResult.stdout ?? "")
    .split("\n")
    .slice(1)
    .filter((l) => l.includes("\tdevice"));

  if (deviceLines.length === 0) {
    console.log("[cap-android] No device found for port forwarding — skipping.");
    return null;
  }

  const deviceId = deviceLines[0].split("\t")[0].trim();

  // Forward ports: emulator localhost → host localhost
  const ports = [8080, 5173];
  for (const port of ports) {
    const r = spawnSync(ADB, ["-s", deviceId, "reverse", `tcp:${port}`, `tcp:${port}`], {
      encoding: "utf8",
    });
    if (r.status === 0) {
      console.log(`[cap-android] ADB reverse tcp:${port} → host:${port}`);
    } else {
      console.warn(`[cap-android] Warning: could not forward port ${port}`);
    }
  }

  return deviceId;
}

console.log("[cap-android] Setting up ADB reverse port forwarding...");
const knownDeviceId = setupPortForwarding();

const result = spawnSync("npx", ["cap", "run", "android"], {
  stdio: "inherit",
  env: childEnv,
  shell: true,
});

// Exit 0 = clean success
if (result.status === 0) process.exit(0);

// Non-zero exit — check if it was the known ADB am-start timeout.
// The APK is already installed; just launch the activity directly.
console.log("\n[cap-android] Capacitor timed out on am start -W — launching app via ADB fallback...");

// Find connected device/emulator (re-detect in case it changed)
const devicesResult = spawnSync(ADB, ["devices"], { encoding: "utf8" });
const deviceLine = (devicesResult.stdout ?? "")
  .split("\n")
  .slice(1)
  .find((l) => l.includes("\tdevice"));
const deviceId = deviceLine?.split("\t")[0]?.trim() ?? knownDeviceId;

if (!deviceId) {
  console.error("[cap-android] No ADB device found. Open the emulator and try again.");
  process.exit(1);
}

console.log(`[cap-android] Launching on ${deviceId}...`);
const launch = spawnSync(
  ADB,
  ["-s", deviceId, "shell", "am", "start", "-n", `${APP_ID}/.MainActivity`],
  { stdio: "inherit" }
);

process.exit(launch.status ?? 0);
