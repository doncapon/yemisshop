type Attribution = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  fbclid?: string;
  referrerUrl?: string;
  landingPath?: string;
  capturedAt?: string;
};

const KEY = "attribution";

export function captureAttributionFromUrl() {
  try {
    const url = new URL(window.location.href);
    const p = url.searchParams;

    const pick = (k: string) => p.get(k) || undefined;

    const at: Attribution = {
      utm_source: pick("utm_source"),
      utm_medium: pick("utm_medium"),
      utm_campaign: pick("utm_campaign"),
      utm_content: pick("utm_content"),
      utm_term: pick("utm_term"),
      gclid: pick("gclid"),
      fbclid: pick("fbclid"),
      referrerUrl: document.referrer || undefined,
      landingPath: url.pathname + url.search,
      capturedAt: new Date().toISOString(),
    };

    // Only store if it contains something meaningful
    const hasAny =
      at.utm_source || at.utm_medium || at.utm_campaign || at.gclid || at.fbclid || at.referrerUrl;

    if (!hasAny) return;

    // Preserve first-touch if already present (recommended)
    const existing = getAttribution();
    const merged = { ...at, ...existing }; // existing wins (first-touch)
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* noop */
  }
}

export function getAttribution(): Attribution | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

export function clearAttribution() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
