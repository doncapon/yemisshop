import React from "react";
import { Bell } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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

function getNotifUrl(n: NotificationWire, userRole?: string): string | null {
  const d = n.data ?? {};
  const t = n.type;
  const role = String(userRole ?? "").toUpperCase();
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const isSupplier = role === "SUPPLIER" || role === "SUPPLIER_RIDER";

  // Explicit override wins
  if (d.url) return String(d.url);
  if (d.link) return String(d.link);

  const enc = encodeURIComponent;

  switch (t) {
    // ── Customer order events ──────────────────────────────────────────────
    case "ORDER_PLACED":
    case "ORDER_PAID":
    case "ORDER_CANCELED":
    case "PAYMENT_FAILED":
    case "RIDER_DELIVERED":
      return d.orderId ? `/orders?orderId=${enc(d.orderId)}` : "/orders";

    // ── Refunds ───────────────────────────────────────────────────────────
    case "REFUND_REQUESTED":
    case "REFUND_STATUS_CHANGED":
      if (isAdmin) return d.orderId ? `/orders?orderId=${enc(d.orderId)}` : "/admin?tab=refunds";
      return d.orderId ? `/orders?orderId=${enc(d.orderId)}` : "/returns-refunds";

    // ── Disputes ──────────────────────────────────────────────────────────
    case "DISPUTE_OPENED":
    case "DISPUTE_STATUS_CHANGED":
      return d.orderId ? `/orders?orderId=${enc(d.orderId)}` : "/orders";

    // ── Supplier purchase-order events ────────────────────────────────────
    case "PURCHASE_ORDER_CREATED":
    case "PURCHASE_ORDER_FUNDED":
    case "PURCHASE_ORDER_STATUS_UPDATE":
    case "RIDER_ASSIGNED": {
      const sid = d.supplierId ? `&supplierId=${enc(d.supplierId)}` : "";
      return d.purchaseOrderId
        ? `/supplier/orders?poId=${enc(d.purchaseOrderId)}${sid}`
        : d.supplierId
          ? `/supplier/orders?supplierId=${enc(d.supplierId)}`
          : "/supplier/orders";
    }

    // ── Payouts ───────────────────────────────────────────────────────────
    case "SUPPLIER_PAYOUT_RELEASED":
    case "SUPPLIER_PAYOUT_HELD":
    case "SUPPLIER_PAYOUT_FAILED":
      if (isAdmin) return "/admin?tab=payouts";
      return d.purchaseOrderId ? `/supplier/orders?poId=${enc(d.purchaseOrderId)}` : "/supplier";

    // ── Supplier product status (admin approves → supplier sees result) ───
    case "PRODUCT_APPROVED":
    case "PRODUCT_REJECTED":
    case "PRODUCT_DISABLED":
    case "PRODUCT_DELETED":
      return "/supplier/products";

    // ── Offer / change requests ───────────────────────────────────────────
    case "SUPPLIER_OFFER_CHANGE_SUBMITTED":
      return "/admin/offer-changes";
    case "SUPPLIER_OFFER_CHANGE_APPROVED":
    case "SUPPLIER_OFFER_CHANGE_REJECTED":
      return "/supplier/catalog-offers";

    case "PRODUCT_CHANGE_SUBMITTED":
      return d.productId ? `/admin?tab=products&pTab=moderation&productId=${enc(d.productId)}` : "/admin?tab=products&pTab=moderation";
    case "PRODUCT_CHANGE_APPROVED":
    case "PRODUCT_CHANGE_REJECTED":
      return "/supplier/products";

    // ── Product submitted for admin review ────────────────────────────────
    case "PRODUCT_SUBMITTED":
      return d.productId ? `/admin?tab=products&pTab=moderation&productId=${enc(d.productId)}` : "/admin?tab=products&pTab=moderation";

    // ── Supplier profile / docs ───────────────────────────────────────────
    case "SUPPLIER_KYC_STATUS_CHANGED":
    case "SUPPLIER_BANK_STATUS_CHANGED":
      return isAdmin
        ? (d.supplierId ? `/admin/supplier-documents?supplierId=${enc(d.supplierId)}` : "/admin/supplier-documents")
        : "/supplier/onboarding/documents";

    case "SUPPLIER_DOCUMENT_UPLOADED":
      return d.supplierId ? `/admin/supplier-documents?supplierId=${enc(d.supplierId)}` : "/admin/supplier-documents";

    // ── Supplier reviews ──────────────────────────────────────────────────
    case "SUPPLIER_REVIEW_RECEIVED":
      return "/supplier";

    // ── Generic / fallback ────────────────────────────────────────────────
    case "GENERIC":
    default:
      if (d.orderId && !isSupplier) return `/orders?orderId=${enc(d.orderId)}`;
      if (d.purchaseOrderId && isAdmin) {
        const sid = d.supplierId ? `&supplierId=${enc(d.supplierId)}` : "";
        return `/supplier/orders?poId=${enc(d.purchaseOrderId)}${sid}`;
      }
      if (d.purchaseOrderId) return `/supplier/orders?poId=${enc(d.purchaseOrderId)}`;
      if (d.productId && isAdmin) return `/admin?tab=products`;
      if (d.productId) return `/products/${enc(d.productId)}`;
      return null;
  }
}

export default function NotificationsBell({
  placement = "navbar",
  className = "",
  enableRealtime = true,
  pollIntervalMs = 30_000,
}: Props) {
  const navigate = useNavigate();
  const user = useAuthStore((s: any) => s.user);
  const userId = user?.id as string | undefined;

  const sessionExpired = useAuthStore((s: any) => s.sessionExpired);
  const markSessionExpired = useAuthStore((s: any) => s.markSessionExpired);

  const qc = useQueryClient();

  const [open, setOpen] = React.useState(false);
  const [inlineToast, setInlineToast] = React.useState<NotificationWire | null>(null);

  const toastTimeoutRef = React.useRef<number | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  /* -------- mobile detection (for centered modal dropdown) -------- */

  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(mq.matches);
    apply();

    // Safari < 14 fallback
    if ((mq as any).addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    } else {
      (mq as any).addListener(apply);
      return () => (mq as any).removeListener(apply);
    }
  }, []);

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
      const raw = localStorage.getItem(seenIdsKey);
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
        localStorage.setItem(seenIdsKey, JSON.stringify(arr));
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
        if (is401(e)) markSessionExpired();
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
      // Capture IDs loaded from localStorage BEFORE overwriting with full list.
      const alreadySeenIds = prevIdsRef.current;

      prevIdsRef.current = new Set(items.map((n) => n.id));
      saveSeenIdsToSession(prevIdsRef.current);
      didInitRef.current = true;

      // Login toast: once per browser session, only for notifications not
      // previously seen (i.e. not in the persisted localStorage set).
      if (canShowLoginToast) {
        const newestUnread = [...items]
          .filter((n) => !n.readAt && !alreadySeenIds.has(n.id))
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
      const anchor = popoverRef.current;
      const panel = panelRef.current;
      const target = e.target as Node | null;

      if (!target) return;

      // ✅ allow clicks inside either the bell area or the dropdown panel
      if (anchor && anchor.contains(target)) return;
      if (panel && panel.contains(target)) return;

      setOpen(false);
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
    if (sessionExpired) return;
    if (isSseDisabled) return;
    if (sseRef.current) return;

    try {
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

  if (!userId || sessionExpired) return null;

  const unreadCount = data?.unreadCount ?? data?.items?.filter((n) => !n.readAt).length ?? 0;
  const items = data?.items ?? [];

  const handleMarkAllRead = () => {
    if (!items.length) return;
    markReadMutation.mutate("all");
  };

  const handleNotifNavigate = (n: NotificationWire) => {
    if (!n.readAt) markReadMutation.mutate([n.id]);
    const url = getNotifUrl(n, user?.role);
    if (url) navigate(url);
    setOpen(false);
    setInlineToast(null);
  };

  const handleItemClick = (n: NotificationWire) => handleNotifNavigate(n);

  const wrapperClass =
    placement === "floating"
      ? "fixed top-[calc(env(safe-area-inset-top)+0.75rem)] right-[calc(env(safe-area-inset-right)+0.75rem)] z-50"
      : "relative z-50";

  const Panel = (
    <div
      ref={panelRef}
      className="w-[min(92vw,360px)] rounded-2xl border border-zinc-200 bg-white/95 backdrop-blur shadow-lg overflow-hidden"
      role="dialog"
      aria-label="Notifications"
    >
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

      <div className="max-h-[60vh] md:max-h-[360px] overflow-y-auto">
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
  );

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
            <span
              className="
                absolute -top-1 -right-1
                grid place-items-center
                rounded-full bg-fuchsia-600 text-white font-semibold leading-none
                w-5 h-5 text-[10px]
                md:min-w-[20px] md:w-auto md:h-5 md:px-1.5
              "
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {/* Desktop dropdown (anchored to bell) */}
        {open && !isMobile && (
          <div className="absolute right-0 mt-2 z-50">{Panel}</div>
        )}
      </div>

      {/* Mobile dropdown (centered + fully visible) */}
      {open &&
        isMobile &&
        createPortal(
          <div className="fixed inset-0 z-[9998] flex items-center justify-center px-4">
            {/* backdrop */}
            <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px]" onClick={() => setOpen(false)} />
            <div className="relative z-[9999]">{Panel}</div>
          </div>,
          document.body
        )}

      {/* Inline toast for newest notification (PORTAL: avoids transform/overflow clipping) */}
      {inlineToast &&
        createPortal(
          <div
            className="fixed top-24 right-6 z-[9999] max-w-sm md:max-w-md"
            onMouseEnter={clearToastTimer}
            onMouseLeave={scheduleToastHide}
          >
            <div
              className={`rounded-2xl border border-zinc-200 bg-white/95 shadow-xl px-4 py-3.5 md:px-5 md:py-4 ${getNotifUrl(inlineToast, user?.role) ? "cursor-pointer hover:bg-zinc-50 transition-colors" : ""}`}
              onClick={() => getNotifUrl(inlineToast, user?.role) && handleNotifNavigate(inlineToast)}
              role={getNotifUrl(inlineToast, user?.role) ? "button" : undefined}
            >
              <div className="flex items-start gap-3">
                <div className="mt-[4px] h-2.5 w-2.5 rounded-full bg-fuchsia-500 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-zinc-900 truncate">{inlineToast.title}</div>
                  <div className="mt-1 text-[13px] leading-snug text-zinc-800 line-clamp-4">{inlineToast.body}</div>
                  {getNotifUrl(inlineToast, user?.role) && (
                    <div className="mt-1.5 text-[11px] text-fuchsia-600 font-medium">Tap to view →</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
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
