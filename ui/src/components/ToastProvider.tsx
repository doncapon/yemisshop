import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { registerToastApi, unregisterToastApi } from "./toastBus";

type Toast = {
  id: string;
  title?: string;
  message: React.ReactNode;
  duration?: number; // ms
};

type ToastContextValue = {
  push: (t: Omit<Toast, "id">) => string; // returns id
  remove: (id: string) => void;
  update: (id: string, patch: Partial<Omit<Toast, "id">>) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider />");
  return ctx;
}

function safeUuid() {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    // ignore
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type TimerMeta = {
  timeoutId?: number;
  remainingMs: number;
  startedAt: number; // ms epoch
  isPaused: boolean;
};

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // per-toast timing state (for pause/resume)
  const timersRef = useRef<Map<string, TimerMeta>>(new Map());

  const clearTimeoutFor = useCallback((id: string) => {
    const meta = timersRef.current.get(id);
    if (meta?.timeoutId) window.clearTimeout(meta.timeoutId);
    if (meta) meta.timeoutId = undefined;
  }, []);

  const remove = useCallback(
    (id: string) => {
      clearTimeoutFor(id);
      timersRef.current.delete(id);
      setToasts((list) => list.filter((t) => t.id !== id));
    },
    [clearTimeoutFor]
  );

  const scheduleDismiss = useCallback(
    (id: string) => {
      const meta = timersRef.current.get(id);
      if (!meta) return;

      clearTimeoutFor(id);

      // if already expired, remove immediately
      if (meta.remainingMs <= 0) {
        remove(id);
        return;
      }

      meta.startedAt = Date.now();
      meta.isPaused = false;

      meta.timeoutId = window.setTimeout(() => {
        remove(id);
      }, meta.remainingMs);
    },
    [clearTimeoutFor, remove]
  );

  const pause = useCallback(
    (id: string) => {
      const meta = timersRef.current.get(id);
      if (!meta || meta.isPaused) return;

      const elapsed = Date.now() - meta.startedAt;
      meta.remainingMs = Math.max(0, meta.remainingMs - elapsed);
      meta.isPaused = true;

      clearTimeoutFor(id);
    },
    [clearTimeoutFor]
  );

  const resume = useCallback(
    (id: string) => {
      const meta = timersRef.current.get(id);
      if (!meta || !meta.isPaused) return;
      scheduleDismiss(id);
    },
    [scheduleDismiss]
  );

  const update = useCallback((id: string, patch: Partial<Omit<Toast, "id">>) => {
    setToasts((list) =>
      list.map((t) => {
        if (t.id !== id) return t;
        return { ...t, ...patch };
      })
    );
  }, []);

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = safeUuid();
      const duration = t.duration ?? 5000;

      const toast: Toast = { id, ...t, duration };
      setToasts((list) => [...list, toast]);

      timersRef.current.set(id, {
        remainingMs: Math.max(0, duration),
        startedAt: Date.now(),
        isPaused: false,
      });
      scheduleDismiss(id);

      return id;
    },
    [scheduleDismiss]
  );

  const value = useMemo(() => ({ push, remove, update }), [push, remove, update]);

  // register global API for non-hook callers (MiniCartToast, etc.)
  useEffect(() => {
    const api = { push, remove, update };
    registerToastApi(api);
    return () => unregisterToastApi(api);
  }, [push, remove, update]);

  // cleanup timers on unmount (safety)
  useEffect(() => {
    return () => {
      for (const id of timersRef.current.keys()) {
        clearTimeoutFor(id);
      }
      timersRef.current.clear();
    };
  }, [clearTimeoutFor]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* ✅ Top-right stack: scroll VERTICALLY if many toasts */}
      <div
        className="
          fixed top-4 right-4 z-[9999]
          w-[calc(100vw-2rem)] sm:w-auto
          max-h-[calc(100vh-2rem)]
          overflow-y-auto overflow-x-hidden
          pr-1
          [scrollbar-gutter:stable]
        "
        style={{ WebkitOverflowScrolling: "touch" }}
        aria-label="Notifications"
      >
        <div className="flex flex-col gap-3 items-end">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="
                relative w-80 max-w-full
                rounded-xl border shadow-lg bg-white text-gray-900
                overflow-hidden hover:shadow-xl
                animate-[toast-in_200ms_ease-out]
                flex flex-col
                max-h-[calc(100vh-6rem)]
              "
              role="status"
              onMouseEnter={() => pause(t.id)}
              onMouseLeave={() => resume(t.id)}
              onFocus={() => pause(t.id)}
              onBlur={() => resume(t.id)}
              tabIndex={-1}
            >
              {/* Accent bar */}
              <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-rose-500 shrink-0" />

              {/* ✅ Scrollable toast body (this is what fixes HUGE cart content) */}
              <div
                className="
                  p-3 pr-10
                  flex-1 min-h-0 min-w-0
                  overflow-y-auto overflow-x-hidden
                  overscroll-contain
                "
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {t.title && (
                  <div
                    className="font-semibold mb-1 truncate"
                    title={typeof t.title === "string" ? t.title : undefined}
                  >
                    {t.title}
                  </div>
                )}

                <div className="text-sm break-words">{t.message}</div>
              </div>

              <button
                onClick={() => remove(t.id)}
                className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-black/5 hover:bg-black/10"
                aria-label="Dismiss"
                type="button"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* keyframes */}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(-6px) translateX(6px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) translateX(0) scale(1); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
