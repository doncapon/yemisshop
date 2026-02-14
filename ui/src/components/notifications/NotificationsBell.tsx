import React from "react";
import { Bell } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { createPortal } from "react-dom";

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
  placement?: "navbar" | "floating";
  className?: string;
  enableRealtime?: boolean;
  pollIntervalMs?: number;
};

type SseMessage =
  | { type: "notification"; notification: NotificationWire; unreadCount?: number }
  | { type: "snapshot"; items: NotificationWire[]; unreadCount: number };

const is401 = (e: any) => Number(e?.response?.status) === 401;

export default function NotificationsBell({
  placement = "navbar",
  className = "",
  enableRealtime = true,
  pollIntervalMs = 30_000,
}: Props) {
  const user = useAuthStore((s: any) => s.user);
  const userId = user?.id as string | undefined;

  const sessionExpired = useAuthStore((s: any) => s.sessionExpired);
  const markSessionExpired = useAuthStore((s: any) => s.markSessionExpired);

  const qc = useQueryClient();

  const [open, setOpen] = React.useState(false);
  const [inlineToast, setInlineToast] = React.useState<NotificationWire | null>(null);

  const toastTimeoutRef = React.useRef<number | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);

  /* -------- toast timer helpers (5s, pause on hover) -------- */

  const clearToastTimer = React.useCallback(() => {
    if (toastTimeoutRef.current != null) {
      window.clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
  }, []);

  const scheduleToastHide = React.useCallback(() => {
    clearToastTimer();
    toastTimeoutRef.current = window.setTimeout(() => {
      setInlineToast(null);
      toastTimeoutRef.current = null;
    }, 5000);
  }, [clearToastTimer]);

  /* -------- no-toast-on-refresh + login toast once -------- */

  const prevIdsRef = React.useRef<Set<string>>(new Set());
  const didInitRef = React.useRef(false);

  const seenIdsKey = React.useMemo(() => {
    if (!userId) return null;
    return `notif_seen_ids:${userId}`;
  }, [userId]);

  const loginSessionKey = React.useMemo(() => {
    if (!userId) return null;
    return `notif_login_toast_shown:${userId}`;
  }, [userId]);

  const loadSeenIdsFromSession = React.useCallback(() => {
    if (!seenIdsKey) return new Set<string>();
    try {
      const raw = sessionStorage.getItem(seenIdsKey);
      if (!raw) return new Set<string>();
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return new Set<string>();
      return new Set(arr.map((x) => String(x)));
    } catch {
      return new Set<string>();
    }
  }, [seenIdsKey]);

  const saveSeenIdsToSession = React.useCallback(
    (set: Set<string>) => {
      if (!seenIdsKey) return;
      try {
        const arr = Array.from(set).slice(0, 300);
        sessionStorage.setItem(seenIdsKey, JSON.stringify(arr));
      } catch {
        // ignore
      }
    },
    [seenIdsKey]
  );

  React.useEffect(() => {
    // reset whenever user changes
    didInitRef.current = false;
    prevIdsRef.current = loadSeenIdsFromSession();
    setOpen(false);
    setInlineToast(null);
    clearToastTimer();
  }, [userId, clearToastTimer, loadSeenIdsFromSession]);

  /* -------- polling query (stops on 401) -------- */

  const { data, isLoading, isError } = useQuery({
    queryKey: ["notifications", userId],
    enabled: !!userId && !sessionExpired,
    staleTime: 15_000,
    refetchInterval: sessionExpired ? false : pollIntervalMs,
    refetchOnWindowFocus: false,
    retry: (failCount: number, e: any) => {
      if (is401(e)) return false; // ✅ don’t retry 401
      return failCount < 2;
    },
    queryFn: async () => {
      try {
        const { data } = await api.get("/api/notifications", {
          params: { limit: 20 },
          withCredentials: true, // ✅ cookie auth
        });
        const payload = (data as any)?.data ?? data ?? {};
        return payload as NotificationsResponse;
      } catch (e: any) {
        if (is401(e)) {
          // ✅ clear user and stop all authed queries globally
          markSessionExpired();
        }
        throw e;
      }
    },
  });

  React.useEffect(() => {
    if (!data?.items || !userId) return;

    const items = data.items;

    const canShowLoginToast =
      !!loginSessionKey && sessionStorage.getItem(loginSessionKey) !== "1";

    // first load baseline
    if (!didInitRef.current) {
      prevIdsRef.current = new Set(items.map((n) => n.id));
      saveSeenIdsToSession(prevIdsRef.current);
      didInitRef.current = true;

      // login toast once per session
      if (canShowLoginToast) {
        const newestUnread = [...items]
          .filter((n) => !n.readAt)
          .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];

        if (newestUnread) {
          setInlineToast(newestUnread);
          scheduleToastHide();
        }
        sessionStorage.setItem(loginSessionKey!, "1");
      }
      return;
    }

    // subsequent polls: only genuine new unread
    const prevIds = prevIdsRef.current;
    const newUnread = items.find((n) => !prevIds.has(n.id) && !n.readAt);

    if (newUnread) {
      setInlineToast(newUnread);
      scheduleToastHide();
    }

    prevIdsRef.current = new Set(items.map((n) => n.id));
    saveSeenIdsToSession(prevIdsRef.current);
  }, [data?.items, userId, loginSessionKey, scheduleToastHide, saveSeenIdsToSession]);

  React.useEffect(() => {
    return () => clearToastTimer();
  }, [clearToastTimer]);

  /* -------- close dropdown on outside click + ESC -------- */

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

  /* -------- mark as read (stops on 401) -------- */

  const markReadMutation = useMutation({
    mutationFn: async (ids: string[] | "all") => {
      try {
        if (ids === "all") {
          await api.post("/api/notifications/read", { all: true }, { withCredentials: true });
        } else if (ids.length) {
          await api.post("/api/notifications/read", { ids }, { withCredentials: true });
        }
      } catch (e: any) {
        if (is401(e)) markSessionExpired();
        throw e;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", userId] }),
  });

  /* -------- realtime SSE (optional, auto-disable on 404-ish failures) -------- */

  const sseRef = React.useRef<EventSource | null>(null);
  const [sseAlive, setSseAlive] = React.useState(false);

  // session flag to stop retrying SSE if endpoint is missing / blocked
  const sseDisabledKey = React.useMemo(() => {
    if (!userId) return null;
    return `notif_sse_disabled:${userId}`;
  }, [userId]);

  const isSseDisabled = React.useMemo(() => {
    if (!sseDisabledKey) return false;
    return sessionStorage.getItem(sseDisabledKey) === "1";
  }, [sseDisabledKey]);

  const disableSseForSession = React.useCallback(() => {
    if (!sseDisabledKey) return;
    sessionStorage.setItem(sseDisabledKey, "1");
  }, [sseDisabledKey]);

  const upsertIntoCacheAndToast = React.useCallback(
    (incoming: NotificationWire, unreadCountOverride?: number) => {
      if (!userId) return;

      qc.setQueryData(["notifications", userId], (old: any) => {
        const prev: NotificationsResponse =
          (old as NotificationsResponse) ?? { items: [], unreadCount: 0, nextCursor: null };

        const exists = prev.items.some((x) => x.id === incoming.id);
        const nextItems = exists
          ? prev.items
          : [incoming, ...prev.items]
              .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
              .slice(0, 20);

        const computedUnread =
          typeof unreadCountOverride === "number"
            ? unreadCountOverride
            : nextItems.filter((n) => !n.readAt).length;

        return { ...prev, items: nextItems, unreadCount: computedUnread };
      });

      // toast only if truly new + unread
      const prevIds = prevIdsRef.current;
      if (!prevIds.has(incoming.id) && !incoming.readAt) {
        setInlineToast(incoming);
        scheduleToastHide();
      }

      prevIdsRef.current = new Set([incoming.id, ...Array.from(prevIdsRef.current)]);
      saveSeenIdsToSession(prevIdsRef.current);
    },
    [qc, userId, scheduleToastHide, saveSeenIdsToSession]
  );

  React.useEffect(() => {
    if (!enableRealtime) return;
    if (!userId) return;
    if (sessionExpired) return; // ✅ don't attempt SSE when session is invalid
    if (isSseDisabled) return;
    if (sseRef.current) return;

    try {
      // If your API is same-origin (via Vite proxy), cookies will flow.
      const es = new EventSource("/api/notifications/stream");
      sseRef.current = es;

      es.onopen = () => setSseAlive(true);

      es.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as SseMessage;

          if (msg?.type === "notification" && (msg as any).notification?.id) {
            upsertIntoCacheAndToast(msg.notification, msg.unreadCount);
            return;
          }

          if (msg?.type === "snapshot" && Array.isArray((msg as any).items)) {
            const snap = msg as any as { items: NotificationWire[]; unreadCount: number };
            qc.setQueryData(["notifications", userId], {
              items: snap.items.slice(0, 20),
              unreadCount: snap.unreadCount ?? snap.items.filter((n) => !n.readAt).length,
              nextCursor: null,
            });

            prevIdsRef.current = new Set(snap.items.map((n) => n.id));
            saveSeenIdsToSession(prevIdsRef.current);
          }
        } catch {
          // ignore malformed
        }
      };

      es.onerror = () => {
        setSseAlive(false);

        // If it errors before opening, disable SSE for this session
        // (EventSource doesn't give status code)
        disableSseForSession();

        try {
          es.close();
        } catch {}
        sseRef.current = null;
      };

      return () => {
        setSseAlive(false);
        try {
          es.close();
        } catch {}
        sseRef.current = null;
      };
    } catch {
      setSseAlive(false);
      disableSseForSession();
      sseRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableRealtime, userId, sessionExpired, isSseDisabled, qc, upsertIntoCacheAndToast, saveSeenIdsToSession]);

  // if user cleared (expired), bell should disappear (prevents UI + calls)
  if (!userId || sessionExpired) return null;

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
      <div ref={popoverRef} className={`${wrapperClass} ${className}`}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white/90 backdrop-blur shadow-sm hover:bg-zinc-50 transition"
          aria-label="Notifications"
          title={sseAlive ? "Notifications (live)" : "Notifications"}
        >
          <Bell size={18} className="text-zinc-700" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-fuchsia-600 text-[10px] font-semibold text-white flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-[min(92vw,360px)] rounded-2xl border border-zinc-200 bg-white/95 backdrop-blur shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100">
              <div className="flex items-center gap-2">
                <div className="text-[14px] md:text-xs font-semibold text-zinc-700">Notifications</div>
                {enableRealtime && (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      sseAlive
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-zinc-50 text-zinc-600 border-zinc-200"
                    }`}
                  >
                    {sseAlive ? "LIVE" : "POLL"}
                  </span>
                )}
              </div>

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
                <div className="p-3 text-xs text-zinc-600">Loading notifications…</div>
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
                        className={`px-3 py-2.5 text-xs cursor-pointer hover:bg-zinc-50 ${
                          unread ? "bg-fuchsia-50/60" : "bg-white"
                        }`}
                        onClick={() => handleItemClick(n)}
                      >
                        <div className="flex items-start gap-2">
                          <div
                            className={`mt-[3px] h-2 w-2 rounded-full ${
                              unread ? "bg-fuchsia-500" : "bg-zinc-300"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-zinc-800 truncate">{n.title}</div>
                            <div className="mt-0.5 text-[11px] text-zinc-600 line-clamp-2">{n.body}</div>
                            <div className="mt-0.5 text-[10px] text-zinc-400">{formatTime(n.createdAt)}</div>
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

      {/* Inline toast for newest notification (PORTAL: avoids transform/overflow clipping) */}
      {inlineToast &&
        createPortal(
          <div
            className="fixed top-24 right-6 z-[9999] max-w-sm md:max-w-md"
            onMouseEnter={clearToastTimer}
            onMouseLeave={scheduleToastHide}
          >
            <div className="rounded-2xl border border-zinc-200 bg-white/95 shadow-xl px-4 py-3.5 md:px-5 md:py-4">
              <div className="flex items-start gap-3">
                <div className="mt-[4px] h-2.5 w-2.5 rounded-full bg-fuchsia-500 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-zinc-900 truncate">{inlineToast.title}</div>
                  <div className="mt-1 text-[13px] leading-snug text-zinc-800 line-clamp-4">{inlineToast.body}</div>
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
          </div>,
          document.body
        )}
    </>
  );
}
