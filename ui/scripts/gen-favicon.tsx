// import React from "react";
// import { renderToStaticMarkup } from "react-dom/server";
// import fs from "fs/promises";
// import path from "path";

// import DaySpringLogo from "../src/components/brand/DayspringLogo";

// async function main() {
//   // Render your logo (icon only)
//   const html = renderToStaticMarkup(<DaySpringLogo size={64} showText={false} />);

//   // Extract only the <svg>...</svg> from the rendered output
//   const match = html.match(/<svg[\s\S]*?<\/svg>/);
//   if (!match) throw new Error("Could not find <svg> in rendered output.");

//   let svg = match[0];

//   // Ensure xmlns for standalone SVG file
//   if (!svg.includes('xmlns="http://www.w3.org/2000/svg"')) {
//     svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
//   }

//   // (Optional) remove className, role, aria-label if you want a super-minimal favicon
//   // svg = svg.replace(/\sclass="[^"]*"/g, "").replace(/\srole="[^"]*"/g, "").replace(/\saria-label="[^"]*"/g, "");

//   const outPath = path.resolve(process.cwd(), "public", "favicon.svg");
//   await fs.mkdir(path.dirname(outPath), { recursive: true });
//   await fs.writeFile(outPath, svg, "utf8");

//   console.log("✅ Wrote", outPath);
// }

// main().catch((e) => {
//   console.error(e);
//   process.exit(1);
// });
