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

      {/* ✅ Mobile-first: centered & full-width-ish, Desktop: top-right */}
      <div
        className="
  pointer-events-auto
  relative w-full sm:w-80
  max-[200px]:w-full
  rounded-xl max-[200px]:rounded-lg
  border border-zinc-200
  bg-white text-zinc-900
  shadow-md sm:shadow-lg
  overflow-hidden
  hover:shadow-lg sm:hover:shadow-xl
  animate-[toast-in_180ms_ease-out]
  flex flex-col
  max-h-[min(60vh,22rem)] sm:max-h-[calc(100vh-6rem)]
  max-[200px]:max-h-[min(70vh,14rem)]
"

        style={{ WebkitOverflowScrolling: "touch" }}
        aria-label="Notifications"
      >
        {/* pointer-events-none on wrapper prevents blocking clicks underneath;
            re-enable on actual toasts */}
        <div className="flex flex-col gap-2 sm:gap-3 items-stretch sm:items-end">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="
                pointer-events-auto
                relative w-full sm:w-80
                rounded-xl border border-zinc-200
                bg-white text-zinc-900
                shadow-md sm:shadow-lg
                overflow-hidden
                hover:shadow-lg sm:hover:shadow-xl
                animate-[toast-in_180ms_ease-out]
                flex flex-col
                max-h-[min(60vh,22rem)] sm:max-h-[calc(100vh-6rem)]
              "
              role="status"
              onMouseEnter={() => pause(t.id)}
              onMouseLeave={() => resume(t.id)}
              onFocus={() => pause(t.id)}
              onBlur={() => resume(t.id)}
              tabIndex={-1}
            >
              {/* Accent bar (slimmer on mobile) */}
              <div className="h-0.5 sm:h-1 max-[200px]:h-[2px] w-full bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-rose-500 shrink-0" />

              {/* ✅ Scrollable toast body (keeps huge content neat) */}
              <div
                className="
    p-2.5 sm:p-3
    max-[200px]:p-1.5
    pr-9 sm:pr-10
    max-[200px]:pr-7
    flex-1 min-h-0 min-w-0
    overflow-y-auto overflow-x-hidden
    overscroll-contain
  "
                style={{ WebkitOverflowScrolling: "touch" }}
              >

                {t.title && (
                  <div
                    className="font-semibold mb-0.5 sm:mb-1 truncate text-[13px] sm:text-sm max-[200px]:text-[11px]"
                    title={typeof t.title === "string" ? t.title : undefined}
                  >
                    {t.title}
                  </div>
                )}

                <div className="text-[12px] sm:text-sm max-[200px]:text-[11px] leading-5 max-[200px]:leading-4 break-words">
                  {t.message}
                </div>

              </div>

              <button
                onClick={() => remove(t.id)}
                className="
    absolute top-2 right-2
    max-[200px]:top-1 max-[200px]:right-1
    h-7 w-7
    max-[200px]:h-6 max-[200px]:w-6
    grid place-items-center
    text-[12px] sm:text-xs max-[200px]:text-[11px]
    rounded-lg max-[200px]:rounded-md
    bg-black/5 hover:bg-black/10
    active:scale-95
    focus:outline-none focus:ring-4 focus:ring-fuchsia-100
  "
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
          from { opacity: 0; transform: translateY(-4px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
