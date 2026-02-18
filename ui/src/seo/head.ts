import { createHead } from "@unhead/react/client";

export const head = createHead();

type OgTag = { property: string; content: string };

export function setSeo(input: {
  title?: string;
  description?: string;
  canonical?: string;
  og?: OgTag[];
  jsonLd?: { id: string; data: any };
}) {
  const meta: any[] = [];
  const link: any[] = [];
  const script: any[] = [];

  if (input.description) meta.push({ name: "description", content: input.description });

  for (const t of input.og || []) {
    if (!t?.property || !t?.content) continue;
    meta.push({ property: t.property, content: t.content });
  }

  if (input.canonical) link.push({ rel: "canonical", href: input.canonical });

  if (input.jsonLd?.data) {
    script.push({
      key: input.jsonLd.id || "jsonld",
      type: "application/ld+json",
      children: JSON.stringify(input.jsonLd.data),
    });
  }

  const entry = head.push({
    title: input.title,
    meta,
    link,
    script,
  });

  return () => entry.dispose();
}
