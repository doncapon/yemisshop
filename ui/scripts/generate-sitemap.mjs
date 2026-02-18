// scripts/generate-sitemap.mjs
import fs from "node:fs";
import path from "node:path";

const SITE_URL = process.env.SITE_URL || "https://dayspringhouse.com";

// IMPORTANT: this must be reachable from Cloudflare build.
// If your API is same domain in production, keep it like this:
const API_BASE = process.env.API_BASE || "https://dayspringhouse.com";

// Your public products endpoint
const PRODUCTS_URL = `${API_BASE}/api/products`;

// Vite serves anything in /public at the site root
const outPath = path.join(process.cwd(), "public", "sitemap.xml");

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function fetchAllProductIds() {
  const take = 100; // your API caps take at 100, perfect
  let skip = 0;
  let total = Infinity;

  const ids = [];

  while (skip < total) {
    const u = new URL(PRODUCTS_URL);
    u.searchParams.set("take", String(take));
    u.searchParams.set("skip", String(skip));
    // keep this light for speed (no includes needed)
    // u.searchParams.set("include", ""); // optional

    const res = await fetch(u.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch products: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    const data = Array.isArray(json?.data) ? json.data : [];
    total = Number(json?.total ?? data.length);

    for (const p of data) {
      if (p?.id) ids.push(String(p.id));
    }

    // if API returns fewer than take, stop (safety)
    if (data.length < take) break;

    skip += take;
  }

  return Array.from(new Set(ids));
}

async function main() {
  const staticUrls = [
    `${SITE_URL}/`,
    `${SITE_URL}/privacy`,
    `${SITE_URL}/cart`,
    // add other PUBLIC routes you want indexed:
    // `${SITE_URL}/support`,
  ];

  let productUrls = [];
  try {
    const ids = await fetchAllProductIds();
    productUrls = ids.map((id) => `${SITE_URL}/product/${id}`);
    console.log(`[sitemap] fetched ${ids.length} product ids`);
  } catch (e) {
    console.warn("[sitemap] could not fetch products; continuing with static only:", e?.message || e);
  }

  const urls = [...new Set([...staticUrls, ...productUrls])];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url>\n` +
          `    <loc>${esc(u)}</loc>\n` +
          `  </url>\n`
      )
      .join("") +
    `</urlset>\n`;

  fs.writeFileSync(outPath, xml, "utf8");
  console.log(`[sitemap] wrote ${urls.length} urls to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
