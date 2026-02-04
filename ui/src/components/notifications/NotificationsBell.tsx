// src/components/notifications/NotificationsBell.tsx
import React from "react";
import { Bell } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";

type NotificationWire = {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: any;
  createdAt: string;
  readAt?: string | null;
};

type NotificationsResponse = {
  items: NotificationWire[];
  unreadCount: number;
  nextCursor?: string | null;
};

function formatTime(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

type Props = {
  /** "navbar" = inline/relative (recommended). "floating" = fixed top-right overlay. */
  placement?: "navbar" | "floating";
  /** Optional: additional wrapper classes */
  className?: string;
};

export default function NotificationsBell({ placement = "navbar", className = "" }: Props) {
  const user = useAuthStore((s: any) => s.user);
  const qc = useQueryClient();

  const [open, setOpen] = React.useState(false);
  const [inlineToast, setInlineToast] = React.useState<NotificationWire | null>(null);

  // store timer id so we can pause/resume
  const toastTimeoutRef = React.useRef<number | null>(null);

  // Wrapper ref for click-outside detection
  const popoverRef = React.useRef<HTMLDivElement | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["notifications"],
    enabled: !!user?.id,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await api.get("/api/notifications", { params: { limit: 20 } });
      const payload = (data as any)?.data ?? data ?? {};
      return payload as NotificationsResponse;
    },
  });

  /* -------- toast timer helpers (5s, pause on hover) -------- */

  const clearToastTimer = React.useCallback(() => {
    if (toastTimeoutRef.current != null) {
      window.clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
  }, []);

  const scheduleToastHide = React.useCallback(() => {
    clearToastTimer();
    // only schedule if there is a toast currently visible
    toastTimeoutRef.current = window.setTimeout(() => {
      setInlineToast(null);
      toastTimeoutRef.current = null;
    }, 5000);
  }, [clearToastTimer]);

  // Show toast when a NEW unread notification appears
  const prevIdsRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (!data?.items) return;

    const currentIds = new Set(data.items.map((n) => n.id));
    const prevIds = prevIdsRef.current;

    const newUnread = data.items.find((n) => !prevIds.has(n.id) && !n.readAt);
    if (newUnread) {
      setInlineToast(newUnread);
      scheduleToastHide(); // 🔁 start 5s timer whenever a new toast appears
    }

    prevIdsRef.current = currentIds;
  }, [data?.items, scheduleToastHide]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      clearToastTimer();
    };
  }, [clearToastTimer]);

  // Close on outside click + ESC
  React.useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const el = popoverRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (target && !el.contains(target)) setOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown as any);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const markReadMutation = useMutation({
    mutationFn: async (ids: string[] | "all") => {
      if (ids === "all") await api.post("/api/notifications/read", { all: true });
      else if (ids.length) await api.post("/api/notifications/read", { ids });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  if (!user?.id) return null;

  const unreadCount = data?.unreadCount ?? data?.items?.filter((n) => !n.readAt).length ?? 0;
  const items = data?.items ?? [];

  const handleMarkAllRead = () => {
    if (!items.length) return;
    markReadMutation.mutate("all");
  };

  const handleItemClick = (n: NotificationWire) => {
    if (!n.readAt) markReadMutation.mutate([n.id]);

    if (n.data?.orderId) {
      window.location.href = `/orders?orderId=${encodeURIComponent(n.data.orderId)}`;
    } else if (n.data?.purchaseOrderId && n.data?.supplierId) {
      window.location.href = `/supplier/orders?poId=${encodeURIComponent(n.data.purchaseOrderId)}`;
    }

    setOpen(false);
  };

  const wrapperClass =
    placement === "floating"
      ? "fixed top-[calc(env(safe-area-inset-top)+0.75rem)] right-[calc(env(safe-area-inset-right)+0.75rem)] z-50"
      : "relative z-50";

  return (
    <>
      {/* Bell button + dropdown wrapper */}
      <div ref={popoverRef} className={`${wrapperClass} ${className}`}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white/90 backdrop-blur shadow-sm hover:bg-zinc-50 transition"
          aria-label="Notifications"
        >
          <Bell size={18} className="text-zinc-700" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-fuchsia-600 text-[10px] font-semibold text-white flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {/* Dropdown panel */}
        {open && (
          <div className="absolute right-0 mt-2 w-[min(92vw,360px)] rounded-2xl border border-zinc-200 bg-white/95 backdrop-blur shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100">
              <div className="text-xs font-semibold text-zinc-700">Notifications</div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-[11px] px-2 py-1 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50"
                >
                  Mark all as read
                </button>
              )}
            </div>

            <div className="max-h-[360px] overflow-y-auto">
              {isLoading ? (
                <div className="p-3 text-xs text-zinc-500">Loading…</div>
              ) : isError ? (
                <div className="p-3 text-xs text-rose-600">Could not load notifications.</div>
              ) : !items.length ? (
                <div className="p-4 text-xs text-zinc-500">No notifications yet.</div>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {items.map((n) => {
                    const unread = !n.readAt;
                    return (
                      <li
                        key={n.id}
                        className={`px-3 py-2.5 text-xs cursor-pointer hover:bg-zinc-50 ${unread ? "bg-fuchsia-50/60" : "bg-white"
                          }`}
                        onClick={() => handleItemClick(n)}
                      >
                        <div className="flex items-start gap-2">
                          <div
                            className={`mt-[3px] h-2 w-2 rounded-full ${unread ? "bg-fuchsia-500" : "bg-zinc-300"
                              }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-zinc-800 truncate">{n.title}</div>
                            <div className="mt-0.5 text-[11px] text-zinc-600 line-clamp-2">
                              {n.body}
                            </div>
                            <div className="mt-0.5 text-[10px] text-zinc-400">
                              {formatTime(n.createdAt)}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Inline toast for newest notification (slightly bigger & clearer) */}
    {inlineToast && (
  <div
    // moved from bottom-right to a bit down from the top-right
    className="fixed top-24 right-6 z-50 max-w-sm md:max-w-md"
    onMouseEnter={clearToastTimer}   // pause auto-hide on hover
    onMouseLeave={scheduleToastHide} // resume 5s timer on leave
  >
    <div className="rounded-2xl border border-zinc-200 bg-white/95 shadow-xl px-4 py-3.5 md:px-5 md:py-4">
      <div className="flex items-start gap-3">
        <div className="mt-[4px] h-2.5 w-2.5 rounded-full bg-fuchsia-500 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-zinc-900 truncate">
            {inlineToast.title}
          </div>
          <div className="mt-1 text-[13px] leading-snug text-zinc-800 line-clamp-4">
            {inlineToast.body}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            clearToastTimer();
            setInlineToast(null);
          }}
          className="ml-2 text-xs text-zinc-400 hover:text-zinc-600"
          aria-label="Close notification preview"
        >
          ×
        </button>
      </div>
    </div>
  </div>
)}

    </>
  );
}
