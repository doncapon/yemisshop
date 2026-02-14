import { useEffect, useMemo, useState } from "react";
import SiteLayout from "../../layouts/SiteLayout";
import api from "../../api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useModal } from "../../components/ModalProvider";
import { useNavigate } from "react-router-dom";
import {
  Lock,
  LogOut,
  Monitor,
  Smartphone,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { performLogout } from "../../utils/logout";
import { useAuthStore } from "../../store/auth";

type SessionDto = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip?: string | null;
  userAgent?: string | null;
  deviceName?: string | null;
  revokedAt?: string | null;
  revokedReason?: string | null;
};

function maskIp(ip?: string | null) {
  if (!ip) return "—";
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.x.x`;
  return ip;
}

function guessDevice(ua?: string | null) {
  const s = (ua ?? "").toLowerCase();
  if (!s) return { icon: <Monitor size={16} />, label: "Unknown device" };
  if (s.includes("iphone") || s.includes("android") || s.includes("mobile")) {
    return { icon: <Smartphone size={16} />, label: "Mobile" };
  }
  return { icon: <Monitor size={16} />, label: "Desktop" };
}

type TabKey = "ACTIVE" | "RECENT";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = clamp(page, 1, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  return {
    page: safePage,
    pageSize,
    total,
    totalPages,
    items: items.slice(start, end),
  };
}

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

function readNumber(key: string, fallback: number) {
  try {
    const v = localStorage.getItem(key);
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}
function writeNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* noop */
  }
}

/* ---------------------- UI helpers ---------------------- */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-2 text-[12px] sm:text-xs">
      <div className="text-zinc-500">{label}</div>
      <div className="text-zinc-800 min-w-0 break-words">{value}</div>
    </div>
  );
}

function Pill({
  tone = "zinc",
  children,
}: {
  tone?: "emerald" | "rose" | "zinc";
  children: React.ReactNode;
}) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "rose"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : "bg-zinc-50 text-zinc-700 border-zinc-200";

  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${cls}`}>
      {children}
    </span>
  );
}

export default function AccountSessions() {
  const { openModal } = useModal();
  const qc = useQueryClient();
  const navigate = useNavigate();

  // ✅ cookie-mode: gate by hydrated + user, NOT token
  const hydrated = useAuthStore((s: any) => s.hydrated);
  const user = useAuthStore((s: any) => s.user);

  const [tab, setTab] = useState<TabKey>("ACTIVE");

  // separate page + pageSize per tab (persisted)
  const [activePage, setActivePage] = useState(1);
  const [recentPage, setRecentPage] = useState(1);

  const [activePageSize, setActivePageSize] = useState(() =>
    readNumber("acct_sessions_active_pageSize", 10)
  );
  const [recentPageSize, setRecentPageSize] = useState(() =>
    readNumber("acct_sessions_recent_pageSize", 10)
  );

  // jump-to-page input per tab (text to allow empty/typing)
  const [activeJump, setActiveJump] = useState("");
  const [recentJump, setRecentJump] = useState("");

  useEffect(() => writeNumber("acct_sessions_active_pageSize", activePageSize), [activePageSize]);
  useEffect(() => writeNumber("acct_sessions_recent_pageSize", recentPageSize), [recentPageSize]);

  const sessionsQ = useQuery({
    queryKey: ["auth", "sessions"],
    enabled: !!hydrated && !!user?.id, // ✅ cookie-mode
    queryFn: async () => {
      const { data } = await api.get<{ data: SessionDto[]; currentSessionId: string | null }>(
        "/api/auth/sessions"
      );
      return data;
    },
    staleTime: 15_000,
  });

  // ✅ If cookie expired / not logged in, redirect cleanly
  useEffect(() => {
    const status = (sessionsQ.error as any)?.response?.status;
    if (status === 401) {
      performLogout("/login", navigate);
    }
  }, [sessionsQ.error, navigate]);

  const currentSessionId = sessionsQ.data?.currentSessionId ?? null;
  const sessions = sessionsQ.data?.data ?? [];

  const revokeOneM = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/auth/sessions/${id}`);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
    onError: (e: any) => {
      openModal({
        title: "Could not revoke",
        message: e?.response?.data?.error || "Please try again.",
      });
    },
  });

  const revokeOthersM = useMutation({
    mutationFn: async () => {
      await api.post(`/api/auth/sessions/revoke-others`, {});
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["auth", "sessions"] });
      openModal({ title: "Done", message: "Logged out other devices." });
    },
    onError: (e: any) => {
      openModal({
        title: "Could not log out others",
        message: e?.response?.data?.error || "Please try again.",
      });
    },
  });

  const onRevoke = async (id: string) => {
    const isCurrent = currentSessionId && id === currentSessionId;

    await revokeOneM.mutateAsync(id);

    if (isCurrent) {
      openModal({
        title: "Logged out",
        message: "This device session was revoked. Please log in again.",
      });

      // ✅ single logout+redirect path (no double navigate)
      await performLogout("/login", navigate);
      return;
    }
  };

  const busy = revokeOneM.isPending || revokeOthersM.isPending;

  const { activeSessions, recentSessions } = useMemo(() => {
    const active = sessions
      .filter((s) => !s.revokedAt)
      .slice()
      .sort((a, b) => {
        const ta = +new Date(a.lastSeenAt || a.createdAt);
        const tb = +new Date(b.lastSeenAt || b.createdAt);
        return tb - ta;
      });

    const recent = sessions
      .filter((s) => !!s.revokedAt)
      .slice()
      .sort((a, b) => {
        const ra = a.revokedAt ? +new Date(a.revokedAt) : 0;
        const rb = b.revokedAt ? +new Date(b.revokedAt) : 0;
        if (rb !== ra) return rb - ra;

        const ta = +new Date(a.lastSeenAt || a.createdAt);
        const tb = +new Date(b.lastSeenAt || b.createdAt);
        return tb - ta;
      });

    return { activeSessions: active, recentSessions: recent };
  }, [sessions]);

  // keep pages valid when list sizes or page size change
  useEffect(() => {
    const maxPages = Math.max(1, Math.ceil(activeSessions.length / activePageSize));
    setActivePage((p) => clamp(p, 1, maxPages));
  }, [activeSessions.length, activePageSize]);

  useEffect(() => {
    const maxPages = Math.max(1, Math.ceil(recentSessions.length / recentPageSize));
    setRecentPage((p) => clamp(p, 1, maxPages));
  }, [recentSessions.length, recentPageSize]);

  // reset jump inputs when tab changes for nicer UX
  useEffect(() => {
    setActiveJump("");
    setRecentJump("");
  }, [tab]);

  const currentPage = tab === "ACTIVE" ? activePage : recentPage;
  const setCurrentPage = (p: number) => {
    if (tab === "ACTIVE") setActivePage(p);
    else setRecentPage(p);
  };

  const currentPageSize = tab === "ACTIVE" ? activePageSize : recentPageSize;
  const setCurrentPageSize = (n: number) => {
    if (tab === "ACTIVE") {
      setActivePageSize(n);
      setActivePage(1);
    } else {
      setRecentPageSize(n);
      setRecentPage(1);
    }
  };

  const currentJump = tab === "ACTIVE" ? activeJump : recentJump;
  const setCurrentJump = (v: string) => {
    if (tab === "ACTIVE") setActiveJump(v);
    else setRecentJump(v);
  };

  const paged = useMemo(() => {
    const list = tab === "ACTIVE" ? activeSessions : recentSessions;
    return paginate(list, currentPage, currentPageSize);
  }, [tab, activeSessions, recentSessions, currentPage, currentPageSize]);

  const applyJump = () => {
    const n = Number(String(currentJump || "").trim());
    if (!Number.isFinite(n)) return;
    const target = clamp(Math.floor(n), 1, paged.totalPages);
    setCurrentPage(target);
  };

  return (
    <SiteLayout>
      <div className="max-w-screen-xl mx-auto px-3 sm:px-4 md:px-8 py-5 sm:py-6">
        {/* ✅ Mobile-first header: stacks, keeps CTA tidy */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900">
              Manage sessions
            </h1>
            <p className="mt-1 text-[13px] sm:text-sm text-zinc-600">
              See where your account is signed in and revoke access.
            </p>
          </div>

          <button
            disabled={busy || !activeSessions.length}
            onClick={() => revokeOthersM.mutate()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border bg-white px-4 py-2 text-[13px] sm:text-sm font-semibold hover:bg-black/5 disabled:opacity-60 whitespace-nowrap"
            title={!activeSessions.length ? "No active sessions to revoke" : "Log out other devices"}
          >
            <LogOut size={16} />
            <span className="sm:hidden">Log out others</span>
            <span className="hidden sm:inline">Log out other devices</span>
          </button>
        </div>

        <div className="mt-4 sm:mt-5 rounded-2xl border bg-white overflow-hidden">
          {/* ✅ Top bar: title + tabs wrap nicely */}
          <div className="px-4 py-3 border-b flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <Lock size={16} />
              Sessions
            </span>

            <div className="inline-flex w-full sm:w-auto rounded-full border bg-zinc-50 p-1">
              <button
                type="button"
                onClick={() => setTab("ACTIVE")}
                className={`flex-1 sm:flex-none px-3 py-2 sm:py-1.5 rounded-full text-xs font-semibold transition ${
                  tab === "ACTIVE"
                    ? "bg-white shadow-sm text-zinc-900"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                Active <span className="opacity-70">({activeSessions.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab("RECENT")}
                className={`flex-1 sm:flex-none px-3 py-2 sm:py-1.5 rounded-full text-xs font-semibold transition ${
                  tab === "RECENT"
                    ? "bg-white shadow-sm text-zinc-900"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                Recent <span className="opacity-70">({recentSessions.length})</span>
              </button>
            </div>
          </div>

          {/* ✅ Controls: compact, no long sentence on mobile */}
          <div className="px-4 py-3 border-b bg-zinc-50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-zinc-700">
              <span className="font-semibold">Rows</span>
              <select
                value={String(currentPageSize)}
                onChange={(e) => setCurrentPageSize(Number(e.target.value))}
                className="rounded-full border bg-white px-3 py-2 sm:py-1.5 text-xs font-semibold"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
              <span className="hidden sm:inline ml-2 text-zinc-500">
                {tab === "ACTIVE"
                  ? "Active sessions shown first by last seen"
                  : "Revoked sessions shown by revoked date"}
              </span>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-2">
              <div className="text-xs text-zinc-600">
                Page <b className="text-zinc-900">{paged.page}</b> / {paged.totalPages}
              </div>

              <div className="flex items-center gap-2">
                <input
                  value={currentJump}
                  onChange={(e) => setCurrentJump(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyJump();
                  }}
                  inputMode="numeric"
                  placeholder="Go…"
                  className="w-16 sm:w-20 rounded-full border bg-white px-3 py-2 sm:py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={applyJump}
                  disabled={!paged.total || paged.totalPages <= 1}
                  className="rounded-full border bg-white px-3 py-2 sm:py-1.5 text-xs font-semibold hover:bg-black/5 disabled:opacity-60"
                >
                  Go
                </button>
              </div>
            </div>
          </div>

          {sessionsQ.isLoading ? (
            <div className="p-4 text-sm text-zinc-600">Loading sessions…</div>
          ) : sessionsQ.isError ? (
            <div className="p-4 text-sm text-zinc-600">Could not load sessions. Please refresh.</div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-sm text-zinc-600">No sessions found.</div>
          ) : paged.total === 0 ? (
            <div className="p-4 text-sm text-zinc-600">
              {tab === "ACTIVE" ? "No active sessions." : "No recent (revoked) sessions."}
            </div>
          ) : (
            <>
              {/* ✅ Mobile: each session looks like a neat card; desktop still fine */}
              <div className="p-3 sm:p-0 sm:divide-y">
                {paged.items.map((s) => {
                  const isCurrent = currentSessionId && s.id === currentSessionId;
                  const isRevoked = !!s.revokedAt;
                  const dev = guessDevice(s.userAgent);

                  const deviceTitle = s.deviceName?.trim() || dev.label;

                  return (
                    <div
                      key={s.id}
                      className="sm:p-4 p-3 mb-3 sm:mb-0 rounded-2xl sm:rounded-none border sm:border-0 bg-white"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-zinc-700 shrink-0">{dev.icon}</span>
                            <div className="font-semibold text-zinc-900 truncate max-w-[70vw] sm:max-w-[520px]">
                              {deviceTitle}
                            </div>

                            {isCurrent && !isRevoked && <Pill tone="emerald">This device</Pill>}
                            {isRevoked && <Pill tone="rose">Revoked</Pill>}
                          </div>

                          {/* ✅ cleaner meta layout */}
                          <div className="mt-2 grid gap-1.5">
                            <InfoRow label="IP" value={maskIp(s.ip)} />
                            <InfoRow
                              label="Last seen"
                              value={new Date(s.lastSeenAt).toLocaleString()}
                            />
                            <InfoRow
                              label="Created"
                              value={new Date(s.createdAt).toLocaleString()}
                            />
                            {isRevoked && (
                              <>
                                <InfoRow
                                  label="Revoked"
                                  value={new Date(s.revokedAt as string).toLocaleString()}
                                />
                                {s.revokedReason && (
                                  <InfoRow label="Reason" value={s.revokedReason} />
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* ✅ actions: full-width on mobile, inline on desktop */}
                      <div className="mt-3 flex gap-2 sm:justify-end">
                        {tab === "ACTIVE" ? (
                          <button
                            disabled={busy || isRevoked}
                            onClick={() => onRevoke(s.id)}
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border bg-white px-3 py-2 text-[13px] sm:text-sm font-semibold hover:bg-black/5 disabled:opacity-60"
                            title={isCurrent ? "Log out this device" : "Revoke this session"}
                          >
                            <Trash2 size={16} />
                            {isCurrent ? "Log out" : "Revoke"}
                          </button>
                        ) : (
                          <button
                            disabled
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border bg-white px-3 py-2 text-[13px] sm:text-sm font-semibold opacity-60"
                            title="This session is already revoked"
                          >
                            <Trash2 size={16} />
                            Revoked
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination footer */}
              <div className="px-4 py-3 border-t bg-zinc-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-xs text-zinc-600">
                  Showing{" "}
                  <span className="font-semibold text-zinc-900">
                    {Math.min((paged.page - 1) * paged.pageSize + 1, paged.total)}
                  </span>
                  {"–"}
                  <span className="font-semibold text-zinc-900">
                    {Math.min(paged.page * paged.pageSize, paged.total)}
                  </span>{" "}
                  of <span className="font-semibold text-zinc-900">{paged.total}</span>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-2 sm:py-1.5 text-xs font-semibold hover:bg-black/5 disabled:opacity-60"
                    disabled={paged.page <= 1}
                    onClick={() => setCurrentPage(paged.page - 1)}
                  >
                    <ChevronLeft size={14} />
                    Prev
                  </button>

                  <span className="text-xs text-zinc-700 whitespace-nowrap">
                    <b className="text-zinc-900">{paged.page}</b> / {paged.totalPages}
                  </span>

                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-2 sm:py-1.5 text-xs font-semibold hover:bg-black/5 disabled:opacity-60"
                    disabled={paged.page >= paged.totalPages}
                    onClick={() => setCurrentPage(paged.page + 1)}
                  >
                    Next
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="mt-4 text-[11px] text-zinc-500 leading-relaxed">
          Revoking a session invalidates its access token on the next request (because the JWT
          sessionId is checked).
        </div>
      </div>
    </SiteLayout>
  );
}
