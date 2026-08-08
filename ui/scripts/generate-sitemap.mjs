// scripts/generate-sitemap.mjs
import fs from "node:fs";
import path from "node:path";

const SITE_URL = process.env.VITE_APP_URL || "https://dayspringhouse.com";

// IMPORTANT: this must be reachable from Cloudflare build.
// If your API is same domain in production, keep it like this:
const API_BASE = process.env.VITE_API_URL || "https://api.dayspringhouse.com";

// Your public products endpoint
const PRODUCTS_URL = `${API_BASE}/api/products`;

// Your public categories endpoint (returns a nested tree)
const CATEGORIES_URL = `${API_BASE}/api/categories`;

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

async function fetchAllCategoryIds() {
  const res = await fetch(CATEGORIES_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Failed to fetch categories: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const roots = Array.isArray(json?.data) ? json.data : [];
  const ids = [];

  const walk = (nodes) => {
    for (const n of nodes) {
      if (n?.id) ids.push(String(n.id));
      if (Array.isArray(n?.children) && n.children.length) walk(n.children);
    }
  };
  walk(roots);

  return Array.from(new Set(ids));
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // Static pages, with how often they realistically change and how important
  // they are relative to product pages.
  const staticUrls = [
    { loc: `${SITE_URL}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${SITE_URL}/about`, changefreq: "monthly", priority: "0.5" },
    { loc: `${SITE_URL}/contact`, changefreq: "monthly", priority: "0.5" },
    { loc: `${SITE_URL}/help`, changefreq: "monthly", priority: "0.5" },
    { loc: `${SITE_URL}/careers`, changefreq: "weekly", priority: "0.4" },
    { loc: `${SITE_URL}/privacy`, changefreq: "yearly", priority: "0.3" },
    { loc: `${SITE_URL}/terms`, changefreq: "yearly", priority: "0.3" },
    { loc: `${SITE_URL}/cookies`, changefreq: "yearly", priority: "0.3" },
  ].map((u) => ({ ...u, lastmod: today }));

  let productUrls = [];
  try {
    const ids = await fetchAllProductIds();
    productUrls = ids.map((id) => ({
      loc: `${SITE_URL}/products/${id}`,
      changefreq: "weekly",
      priority: "0.8",
    }));
    console.log(`[sitemap] fetched ${ids.length} product ids`);
  } catch (e) {
    console.warn("[sitemap] could not fetch products; continuing with static only:", e?.message || e);
  }

  // Category views are only independently indexable because Catalog.tsx now
  // syncs the selected category into ?category=<id> on the homepage.
  let categoryUrls = [];
  try {
    const ids = await fetchAllCategoryIds();
    categoryUrls = ids.map((id) => ({
      loc: `${SITE_URL}/?category=${id}`,
      changefreq: "weekly",
      priority: "0.6",
    }));
    console.log(`[sitemap] fetched ${ids.length} category ids`);
  } catch (e) {
    console.warn("[sitemap] could not fetch categories; continuing without them:", e?.message || e);
  }

  const seen = new Set();
  const urls = [...staticUrls, ...productUrls, ...categoryUrls].filter((u) => {
    if (seen.has(u.loc)) return false;
    seen.add(u.loc);
    return true;
  });

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url>\n` +
          `    <loc>${esc(u.loc)}</loc>\n` +
          (u.lastmod ? `    <lastmod>${esc(u.lastmod)}</lastmod>\n` : "") +
          `    <changefreq>${esc(u.changefreq)}</changefreq>\n` +
          `    <priority>${esc(u.priority)}</priority>\n` +
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
