const PRESERVE_LOCAL_STORAGE_EXACT = new Set([
  "auth-storage",
  "persist:auth-storage",
  "auth:lastUserKey",
  "theme",
  "appearance",
  "accent_color",
]);

const PRESERVE_SESSION_STORAGE_EXACT = new Set(["auth:lastUserKey"]);

function shouldPreserveLocalStorageKey(key: string) {
  const k = String(key || "").trim();
  if (!k) return true;
  if (PRESERVE_LOCAL_STORAGE_EXACT.has(k)) return true;
  if (
    k === "auth" ||
    k.startsWith("auth-storage") ||
    k.startsWith("persist:auth") ||
    k.startsWith("zustand-auth") ||
    k.startsWith("supabase.auth")
  ) {
    return true;
  }
  return false;
}

function shouldPreserveSessionStorageKey(key: string) {
  const k = String(key || "").trim();
  if (!k) return true;
  if (PRESERVE_SESSION_STORAGE_EXACT.has(k)) return true;
  return false;
}

function clearStorageBucket(
  storage: Storage,
  shouldPreserve: (key: string) => boolean,
) {
  const keysToRemove: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key) continue;
    if (shouldPreserve(key)) continue;
    keysToRemove.push(key);
  }
  for (const key of keysToRemove) {
    try {
      storage.removeItem(key);
    } catch {}
  }
}

export function clearUserScopedBrowserStateForUserSwitch(nextUserKey: string) {
  try {
    clearStorageBucket(window.localStorage, shouldPreserveLocalStorageKey);
  } catch {}

  try {
    clearStorageBucket(window.sessionStorage, shouldPreserveSessionStorageKey);
  } catch {}

  try {
    sessionStorage.setItem("auth:lastUserKey", nextUserKey);
  } catch {}

  try {
    window.dispatchEvent(
      new CustomEvent("app:user-switched", { detail: { userKey: nextUserKey } }),
    );
  } catch {}
}
