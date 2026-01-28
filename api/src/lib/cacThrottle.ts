// api/src/lib/cacThrottle.ts

export type Outcome = 'OK' | 'NOT_FOUND' | 'ERROR';

type KeyState = {
  windowStart: number;
  countInWindow: number;
  consecNotFound: number;
  backoffUntil?: number;
  lastOutcome?: Outcome;
};

const states = new Map<string, KeyState>();

// Tune these as needed
const WINDOW_MS = 60 * 60 * 1000;     // 1 hour window
const MAX_PER_WINDOW = 3;             // max calls per key per window
const ERROR_BACKOFF_MS = 60 * 1000;   // 1 min after generic error
const NF_BACKOFFS_MS = [0, 5 * 60_000, 30 * 60_000, 12 * 60 * 60_000]; // 0→5m→30m→12h

function key(rc: string, type: string) {
  return `${rc}::${type}`;
}

function getOrRoll(rc: string, type: string): KeyState {
  const k = key(rc, type);
  const now = Date.now();
  let s = states.get(k);
  if (!s) {
    s = { windowStart: now, countInWindow: 0, consecNotFound: 0 };
    states.set(k, s);
  } else if (now - s.windowStart >= WINDOW_MS) {
    s.windowStart = now;
    s.countInWindow = 0;
    s.consecNotFound = 0;
    s.backoffUntil = undefined;
  }
  return s;
}

/** Gate check (no mutation). Admin override bypasses. */
export function checkGate(
  rc: string,
  type: string,
  opts?: { adminOverride?: boolean }
): { blocked: boolean; reason?: 'backoff' | 'rate'; retryAt?: string } {
  if (opts?.adminOverride) return { blocked: false };

  const s = getOrRoll(rc, type);
  const now = Date.now();

  // backoff gate
  if (s.backoffUntil && now < s.backoffUntil) {
    return { blocked: true, reason: 'backoff', retryAt: new Date(s.backoffUntil).toISOString() };
  }

  // rate limit gate
  if (s.countInWindow >= MAX_PER_WINDOW) {
    const retryAt = s.windowStart + WINDOW_MS;
    return { blocked: true, reason: 'rate', retryAt: new Date(retryAt).toISOString() };
  }

  return { blocked: false };
}

/** Record the outcome of an upstream call (mutates counters/backoff). */
export function recordOutcome(rc: string, type: string, outcome: Outcome): void {
  const s = getOrRoll(rc, type);
  const now = Date.now();

  s.countInWindow += 1;
  s.lastOutcome = outcome;

  if (outcome === 'OK') {
    s.consecNotFound = 0;
    s.backoffUntil = undefined;
    return;
  }

  if (outcome === 'NOT_FOUND') {
    s.consecNotFound += 1;
    const idx = Math.min(s.consecNotFound, NF_BACKOFFS_MS.length - 1);
    const wait = NF_BACKOFFS_MS[idx];
    s.backoffUntil = wait ? now + wait : undefined;
    return;
  }

  // ERROR
  s.backoffUntil = now + ERROR_BACKOFF_MS;
}

/** Admin helpers ---------------------------------------------------------- */

export function getGate(rc: string, type: string): {
  windowStart: number;
  countInWindow: number;
  lastOutcome?: Outcome;
  consecNotFound: number;
  backoffUntil?: number;
  windowResetAt: number;
  maxPerWindow: number;
  windowMs: number;
  retryAt: number | null;
} | null {
  const s = states.get(key(rc, type));
  if (!s) return null;
  const now = Date.now();
  const rateRetry = s.countInWindow >= MAX_PER_WINDOW ? s.windowStart + WINDOW_MS : null;
  const backoffRetry = s.backoffUntil && now < s.backoffUntil ? s.backoffUntil : null;
  const retryAt = backoffRetry ?? rateRetry ?? null;

  return {
    windowStart: s.windowStart,
    countInWindow: s.countInWindow,
    lastOutcome: s.lastOutcome,
    consecNotFound: s.consecNotFound,
    backoffUntil: s.backoffUntil,
    windowResetAt: s.windowStart + WINDOW_MS,
    maxPerWindow: MAX_PER_WINDOW,
    windowMs: WINDOW_MS,
    retryAt,
  };
}

export function clearGate(rc: string, type: string): void {
  states.delete(key(rc, type));
}

export function setCooldown(rc: string, type: string, durationMs: number): { retryAt: number } {
  const s = getOrRoll(rc, type);
  const now = Date.now();
  s.backoffUntil = now + Math.max(0, durationMs);
  return { retryAt: s.backoffUntil };
}

export function resetDailyWindow(rc: string, type: string): void {
  const s = getOrRoll(rc, type);
  s.windowStart = Date.now();
  s.countInWindow = 0;
}
