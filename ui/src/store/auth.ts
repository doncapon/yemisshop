import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import api from "../api/client";
import { wasJustLoggedOut } from "../utils/logout";

const GUEST_CART_KEY = "cart:guest:v2";
const USER_CART_KEY_PREFIX = "cart:user:";
const CART_KEY_SUFFIX = ":v2";

function userCartKey(userId: string) {
  return `${USER_CART_KEY_PREFIX}${userId}${CART_KEY_SUFFIX}`;
}

function loadCartV2(key: string): any[] {
  try {
    const raw = localStorage.getItem(key);
    const v2 = raw ? JSON.parse(raw) : null;
    if (v2?.v === 2 && Array.isArray(v2.items)) return v2.items;

    if (key === GUEST_CART_KEY) {
      const legacy = localStorage.getItem("cart");
      const arr = legacy ? JSON.parse(legacy) : [];
      return Array.isArray(arr) ? arr : [];
    }
  } catch {}
  return [];
}

function saveCartV2(key: string, items: any[]) {
  const now = Date.now();
  const isUser = key.startsWith(USER_CART_KEY_PREFIX);

  localStorage.setItem(
    key,
    JSON.stringify({
      v: 2,
      items,
      updatedAt: now,
      expiresAt: now + (isUser ? 90 : 14) * 24 * 60 * 60 * 1000,
    })
  );

  try {
    localStorage.removeItem("cart");
  } catch {}
}

export function mergeGuestCartIntoUserCart(userId: string) {
  try {
    const guest = loadCartV2(GUEST_CART_KEY);
    if (!guest.length) return;

    const key = userCartKey(userId);
    const userCart = loadCartV2(key);

    const idxOf = (arr: any[], line: any) =>
      arr.findIndex(
        (x) =>
          String(x?.productId) === String(line?.productId) &&
          String(x?.variantId ?? "") === String(line?.variantId ?? "")
      );

    for (const g of guest) {
      const i = idxOf(userCart, g);
      if (i >= 0) {
        const prevQty = Math.max(0, Number(userCart[i]?.qty) || 0);
        const addQty = Math.max(0, Number(g?.qty) || 0);
        userCart[i] = { ...userCart[i], ...g, qty: prevQty + addQty };
      } else {
        userCart.push(g);
      }
    }

    saveCartV2(key, userCart);

    try {
      localStorage.removeItem(GUEST_CART_KEY);
    } catch {}
    try {
      localStorage.removeItem("cart");
    } catch {}

    window.dispatchEvent(new Event("cart:updated"));
  } catch {}
}

export type Role = "ADMIN" | "SUPER_ADMIN" | "SHOPPER" | "SUPPLIER" | "SUPPLIER_RIDER";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  status?: string | null;
};

type AuthState = {
  hydrated: boolean;
  bootstrapping: boolean;

  user: AuthUser | null;
  needsVerification: boolean;
  sessionExpired: boolean;

  setUser: (u: AuthUser | null) => void;
  setNeedsVerification: (v: boolean) => void;
  markSessionExpired: () => void;
  clear: () => void;

  bootstrap: () => Promise<void>;
};

const is401or403 = (e: any) => {
  const s = Number(e?.response?.status);
  return s === 401 || s === 403;
};

function normRole(role: unknown): Role {
  let r = String(role ?? "").trim().toUpperCase();
  r = r.replace(/[\s\-]+/g, "_").replace(/__+/g, "_");
  if (r === "SUPERADMIN") r = "SUPER_ADMIN";
  if (r === "SUPER_ADMINISTRATOR") r = "SUPER_ADMIN";

  if (r === "ADMIN") return "ADMIN";
  if (r === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (r === "SUPPLIER") return "SUPPLIER";
  if (r === "SUPPLIER_RIDER") return "SUPPLIER_RIDER";
  return "SHOPPER";
}

function normalizeUser(u: any): AuthUser | null {
  if (!u?.id) return null;

  return {
    ...u,
    role: normRole(u?.role),
  } as AuthUser;
}

function pickAuthUser(payload: any): AuthUser | null {
  const candidate =
    payload?.data?.user ??
    payload?.data?.data ??
    payload?.data ??
    payload?.user ??
    payload ??
    null;

  return normalizeUser(candidate);
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      bootstrapping: false,

      user: null,
      needsVerification: false,
      sessionExpired: false,

      setUser: (u) =>
        set({
          user: normalizeUser(u),
          sessionExpired: false,
        }),

      setNeedsVerification: (v) =>
        set({
          needsVerification: !!v,
        }),

      markSessionExpired: () =>
        set({
          user: null,
          needsVerification: false,
          sessionExpired: true,
          hydrated: true,
          bootstrapping: false,
        }),

      clear: () =>
        set({
          user: null,
          needsVerification: false,
          sessionExpired: false,
          hydrated: true,
          bootstrapping: false,
        }),

      bootstrap: async () => {
        if (get().bootstrapping) return;

        if (wasJustLoggedOut(3000)) {
          set({
            user: null,
            needsVerification: false,
            sessionExpired: false,
            hydrated: true,
            bootstrapping: false,
          });
          return;
        }

        set({
          bootstrapping: true,
          hydrated: false,
        });

        const previousUser = get().user;

        try {
          const response = await api.get("/api/auth/me", { withCredentials: true });
          const me = pickAuthUser(response);

          if (me?.id) {
            set({
              user: me,
              needsVerification: false,
              sessionExpired: false,
            });
            mergeGuestCartIntoUserCart(String(me.id));
          } else {
            set({
              user: null,
              needsVerification: false,
              sessionExpired: false,
            });
          }
        } catch (e: any) {
          if (is401or403(e)) {
            set({
              user: null,
              needsVerification: false,
              sessionExpired: true,
            });
          } else {
            // Keep previous good session on transient/network issues.
            set({
              user: previousUser ?? get().user,
              sessionExpired: false,
            });
          }
        } finally {
          set({
            hydrated: true,
            bootstrapping: false,
          });
        }
      },
    }),
    {
      name: "auth_store_v1",
      storage: createJSONStorage(() => window.sessionStorage),
      partialize: (s) => ({
        user: s.user,
        needsVerification: s.needsVerification,
        sessionExpired: s.sessionExpired,
      }),
      onRehydrateStorage: () => (state) => {
        // Do not mark hydrated=true here.
        // Hydrated should mean the live /api/auth/me check has completed.
        if (state) {
          state.bootstrapping = false;
        }
      },
    }
  )
);