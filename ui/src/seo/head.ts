// src/seo/head.ts
type MetaName = { name: string; content: string };
type MetaProp = { property: string; content: string };

function upsertMetaByName(name: string, content: string) {
  if (!content) return;
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${CSS.escape(name)}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertMetaByProperty(property: string, content: string) {
  if (!content) return;
  let el = document.head.querySelector<HTMLMetaElement>(`meta[property="${CSS.escape(property)}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  if (!href) return;
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${CSS.escape(rel)}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function upsertJsonLd(id: string, data: unknown) {
  const json = JSON.stringify(data);
  let el = document.head.querySelector<HTMLScriptElement>(
    `script[type="application/ld+json"][data-seo="${CSS.escape(id)}"]`
  );
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.setAttribute("data-seo", id);
    document.head.appendChild(el);
  }
  el.textContent = json;
}

export function setSeo(opts: {
  title?: string;
  description?: string;
  canonical?: string;
  og?: MetaProp[];
  meta?: MetaName[];
  jsonLd?: { id: string; data: unknown };
}) {
  if (opts.title) document.title = opts.title;

  if (opts.description) upsertMetaByName("description", opts.description);

  (opts.meta ?? []).forEach((m) => upsertMetaByName(m.name, m.content));
  (opts.og ?? []).forEach((m) => upsertMetaByProperty(m.property, m.content));

  if (opts.canonical) upsertLink("canonical", opts.canonical);

  if (opts.jsonLd) upsertJsonLd(opts.jsonLd.id, opts.jsonLd.data);
}
