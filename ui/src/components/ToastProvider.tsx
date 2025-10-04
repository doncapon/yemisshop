import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

type Toast = {
  id: string;
  title?: string;
  message: string;
  duration?: number; // ms
};

type ToastContextValue = {
  push: (t: Omit<Toast, 'id'>) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider />');
  return ctx;
}

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    const duration = t.duration ?? 5000; // default 5s
    const toast: Toast = { id, ...t, duration };
    setToasts((list) => [...list, toast]);
    // auto-dismiss
    setTimeout(() => remove(id), duration);
  }, [remove]);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Top-right stack */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="w-80 max-w-[90vw] rounded-xl border shadow-lg bg-white text-gray-900 overflow-hidden animate-[toast-in_200ms_ease-out] hover:shadow-xl"
            role="status"
          >
            {/* Accent bar */}
            <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-rose-500" />
            <div className="p-3">
              {t.title && <div className="font-semibold mb-1">{t.title}</div>}
              <div className="text-sm">{t.message}</div>
            </div>
            <button
              onClick={() => remove(t.id)}
              className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-black/5 hover:bg-black/10"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
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
