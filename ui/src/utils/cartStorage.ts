// src/utils/cartStorage.ts
import { useAuthStore } from "../store/auth";

const GUEST_CART_KEY = "cart:guest:v2";
const USER_CART_KEY_PREFIX = "cart:user:";
const CART_KEY_SUFFIX = ":v2";
const GUEST_CART_TTL_DAYS = 14;

type CartStorageV2 = {
  v: 2;
  items: any[];
  updatedAt: number;
  expiresAt: number;
};

const nowMs = () => Date.now();
const daysToMs = (d: number) => Math.max(0, d) * 24 * 60 * 60 * 1000;

function userCartKey(userId: string) {
  return `${USER_CART_KEY_PREFIX}${userId}${CART_KEY_SUFFIX}`;
}

function activeKey() {
  const uid = useAuthStore.getState().user?.id;
  return uid ? userCartKey(String(uid)) : GUEST_CART_KEY;
}

function safeParse(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isExpired(expiresAt: number) {
  return Number.isFinite(expiresAt) && expiresAt > 0 ? nowMs() > expiresAt : false;
}

export function loadCartRaw(): any[] {
  const key = activeKey();
  const v2 = safeParse(localStorage.getItem(key)) as CartStorageV2 | null;

  if (v2?.v === 2 && Array.isArray(v2.items)) {
    if (isExpired(v2.expiresAt)) {
      localStorage.removeItem(key);
      return [];
    }
    return v2.items;
  }

  // Back-compat: allow reading legacy cart ONLY for guests
  if (key === GUEST_CART_KEY) {
    const legacy = safeParse(localStorage.getItem("cart"));
    if (Array.isArray(legacy)) return legacy;
  }

  return [];
}

export function saveCartRaw(items: any[]) {
  const key = activeKey();
  const payload: CartStorageV2 = {
    v: 2,
    items: Array.isArray(items) ? items : [],
    updatedAt: nowMs(),
    expiresAt: nowMs() + daysToMs(key.startsWith(USER_CART_KEY_PREFIX) ? 90 : GUEST_CART_TTL_DAYS),
  };

  localStorage.setItem(key, JSON.stringify(payload));

  // kill legacy key so it can’t resurrect from old writers
  try {
    localStorage.removeItem("cart");
  } catch {}

  window.dispatchEvent(new Event("cart:updated"));
}

export function clearAllCartKeysForLogout() {
  const uid = useAuthStore.getState().user?.id ? String(useAuthStore.getState().user!.id) : null;

  localStorage.removeItem(GUEST_CART_KEY);
  localStorage.removeItem("cart"); // legacy
  if (uid) localStorage.removeItem(userCartKey(uid));

  window.dispatchEvent(new Event("cart:updated"));
}