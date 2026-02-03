type Consent = { analytics: boolean; marketing: boolean; setAt: string };
const KEY = "consent";

export function getConsent(): Consent | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

export function setConsent(c: { analytics: boolean; marketing: boolean }) {
  const v: Consent = { ...c, setAt: new Date().toISOString() };
  localStorage.setItem(KEY, JSON.stringify(v));
  return v;
}
