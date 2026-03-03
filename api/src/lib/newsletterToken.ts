// api/src/lib/newsletterToken.ts
import crypto from "crypto";

const NEWSLETTER_SECRET =
  (process.env.NEWSLETTER_SECRET || process.env.APP_SECRET || "").trim() ||
  "dev-newsletter-secret-change-me";

/**
 * Token format:  "<subscriberId>.<hmac>"
 * where hmac = HMAC-SHA256(subscriberId, NEWSLETTER_SECRET) in base64url
 */
export function createUnsubscribeToken(subscriberId: string): string {
  const payload = String(subscriberId);
  const sig = crypto
    .createHmac("sha256", NEWSLETTER_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * Returns subscriberId if token is valid, otherwise null.
 */
export function verifyUnsubscribeToken(token: string): string | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const expectedSig = crypto
    .createHmac("sha256", NEWSLETTER_SECRET)
    .update(payload)
    .digest("base64url");

  // use timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  return payload;
}