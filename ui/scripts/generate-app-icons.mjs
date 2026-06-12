/**
 * Generates Capacitor source assets from favicon.svg.
 * Outputs:
 *   assets/icon-only.png       – 1024×1024, transparent bg (adaptive icon fg layer)
 *   assets/icon-background.png – 1024×1024, solid white bg
 *   assets/splash.png          – 2732×2732, white bg with centered logo
 *   assets/splash-dark.png     – 2732×2732, dark bg (#0f172a) with centered logo
 *
 * After running this once, replace these files with your final artwork.
 * Then run: npm run cap:icons
 */
import sharp from "sharp";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(__dirname, "..");
const assetsDir = resolve(uiRoot, "assets");

if (!existsSync(assetsDir)) {
  mkdirSync(assetsDir, { recursive: true });
}

const svgBuffer = readFileSync(resolve(uiRoot, "favicon.svg"));

console.log("Generating app icon source images from favicon.svg...");

// 1. icon-only.png – transparent background, 1024×1024
await sharp(svgBuffer)
  .resize(1024, 1024, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toFile(resolve(assetsDir, "icon-only.png"));
console.log("  ✓ assets/icon-only.png (1024×1024)");

// 2. icon-background.png – solid white, 1024×1024
await sharp({
  create: {
    width: 1024,
    height: 1024,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  },
})
  .png()
  .toFile(resolve(assetsDir, "icon-background.png"));
console.log("  ✓ assets/icon-background.png (1024×1024)");

// 3. Resize SVG for splash center logo (600px)
const LOGO_SIZE = 600;
const logoBuffer = await sharp(svgBuffer)
  .resize(LOGO_SIZE, LOGO_SIZE, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();

const SPLASH = 2732;
const logoOffset = Math.round((SPLASH - LOGO_SIZE) / 2);

// 4. splash.png – white bg with centered logo
await sharp({
  create: {
    width: SPLASH,
    height: SPLASH,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  },
})
  .composite([{ input: logoBuffer, left: logoOffset, top: logoOffset }])
  .png()
  .toFile(resolve(assetsDir, "splash.png"));
console.log("  ✓ assets/splash.png (2732×2732)");

// 5. splash-dark.png – dark bg (#0f172a) with centered logo
await sharp({
  create: {
    width: SPLASH,
    height: SPLASH,
    channels: 4,
    background: { r: 15, g: 23, b: 42, alpha: 1 },
  },
})
  .composite([{ input: logoBuffer, left: logoOffset, top: logoOffset }])
  .png()
  .toFile(resolve(assetsDir, "splash-dark.png"));
console.log("  ✓ assets/splash-dark.png (2732×2732)");

console.log("\nDone. Run `npm run cap:icons` to generate all platform sizes.");
console.log("Replace assets/*.png with your final brand artwork anytime.");
