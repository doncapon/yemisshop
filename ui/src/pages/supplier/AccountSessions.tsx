//AccountSessions.tsx
import { useEffect, useMemo, useState } from "react";
import SiteLayout from "../../layouts/SiteLayout";
import api from "../../api/client";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
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

type TabKey = "ACTIVE" | "RECENT";

type SessionsPageDto = {
  rows: SessionDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  currentSessionId: string | null;
  counts?: {
    active?: number;
    recent?: number;
  };
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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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

function normalizeSessionsPayload(raw: any, fallbackTab: TabKey, fallbackPage: number, fallbackPageSize: number): SessionsPageDto {
  // If raw.data is an array it's the old format { data: [...sessions], currentSessionId }.
  // In that case keep raw as the payload so payload.data finds the sessions array below.
  const dataField = raw?.data;
  const payload = Array.isArray(dataField) ? raw : (dataField ?? raw ?? {});

  const rows = Array.isArray(payload?.rows)
    ? payload.rows
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  const total = Number.isFinite(Number(payload?.total)) ? Number(payload.total) : rows.length;
  const pageSize =
    Number.isFinite(Number(payload?.pageSize)) && Number(payload.pageSize) > 0
      ? Number(payload.pageSize)
      : fallbackPageSize;

  const computedTotalPages = Math.max(1, Math.ceil(total / pageSize));
  const page =
    Number.isFinite(Number(payload?.page)) && Number(payload.page) > 0
      ? Number(payload.page)
      : fallbackPage;

  const totalPages =
    Number.isFinite(Number(payload?.totalPages)) && Number(payload.totalPages) > 0
      ? Number(payload.totalPages)
      : computedTotalPages;

  const currentSessionId =
    payload?.currentSessionId ??
    payload?.meta?.currentSessionId ??
    null;

  const counts =
    payload?.counts && typeof payload.counts === "object"
      ? {
          active: Number.isFinite(Number(payload.counts.active)) ? Number(payload.counts.active) : undefined,
          recent: Number.isFinite(Number(payload.counts.recent)) ? Number(payload.counts.recent) : undefined,
        }
      : undefined;

  const hasPrevPage =
    typeof payload?.hasPrevPage === "boolean" ? payload.hasPrevPage : page > 1;

  const hasNextPage =
    typeof payload?.hasNextPage === "boolean" ? payload.hasNextPage : page < totalPages;

  // Backward-compat fallback if backend still returns all sessions
  if (!payload?.rows && !payload?.items && Array.isArray(rows)) {
    const filtered = rows
      .filter((s: SessionDto) => (fallbackTab === "ACTIVE" ? !s.revokedAt : !!s.revokedAt))
      .sort((a: SessionDto, b: SessionDto) => {
        if (fallbackTab === "RECENT") {
          const ra = a.revokedAt ? +new Date(a.revokedAt) : 0;
          const rb = b.revokedAt ? +new Date(b.revokedAt) : 0;
          if (rb !== ra) return rb - ra;
        }
        const ta = +new Date(a.lastSeenAt || a.createdAt);
        const tb = +new Date(b.lastSeenAt || b.createdAt);
        return tb - ta;
      });

    const filteredTotal = filtered.length;
    const filteredTotalPages = Math.max(1, Math.ceil(filteredTotal / fallbackPageSize));
    const safePage = clamp(fallbackPage, 1, filteredTotalPages);
    const start = (safePage - 1) * fallbackPageSize;
    const pageRows = filtered.slice(start, start + fallbackPageSize);

    return {
      rows: pageRows,
      total: filteredTotal,
      page: safePage,
      pageSize: fallbackPageSize,
      totalPages: filteredTotalPages,
      hasNextPage: safePage < filteredTotalPages,
      hasPrevPage: safePage > 1,
      currentSessionId,
      counts: {
        active: rows.filter((s: SessionDto) => !s.revokedAt).length,
        recent: rows.filter((s: SessionDto) => !!s.revokedAt).length,
      },
    };
  }

  return {
    rows,
    total,
    page: clamp(page, 1, Math.max(1, totalPages)),
    pageSize,
    totalPages: Math.max(1, totalPages),
    hasNextPage,
    hasPrevPage,
    currentSessionId,
    counts,
  };
}

export default function AccountSessions() {
  const { openModal } = useModal();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const hydrated = useAuthStore((s: any) => s.hydrated);
  const user = useAuthStore((s: any) => s.user);

  const [tab, setTab] = useState<TabKey>("ACTIVE");

  const [activePage, setActivePage] = useState(1);
  const [recentPage, setRecentPage] = useState(1);

  const [activePageSize, setActivePageSize] = useState(() =>
    readNumber("acct_sessions_active_pageSize", 10)
  );
  const [recentPageSize, setRecentPageSize] = useState(() =>
    readNumber("acct_sessions_recent_pageSize", 10)
  );

  const [activeJump, setActiveJump] = useState("");
  const [recentJump, setRecentJump] = useState("");

  useEffect(() => writeNumber("acct_sessions_active_pageSize", activePageSize), [activePageSize]);
  useEffect(() => writeNumber("acct_sessions_recent_pageSize", recentPageSize), [recentPageSize]);

  const currentPage = tab === "ACTIVE" ? activePage : recentPage;
  const currentPageSize = tab === "ACTIVE" ? activePageSize : recentPageSize;
  const currentJump = tab === "ACTIVE" ? activeJump : recentJump;

  const setCurrentPage = (p: number) => {
    if (tab === "ACTIVE") setActivePage(p);
    else setRecentPage(p);
  };

  const setCurrentPageSize = (n: number) => {
    if (tab === "ACTIVE") {
      setActivePageSize(n);
      setActivePage(1);
    } else {
      setRecentPageSize(n);
      setRecentPage(1);
    }
  };

  const setCurrentJump = (v: string) => {
    if (tab === "ACTIVE") setActiveJump(v);
    else setRecentJump(v);
  };

  const enabled = !!hydrated && !!user?.id;

  async function fetchSessionsPage(targetTab: TabKey, page: number, pageSize: number): Promise<SessionsPageDto> {
    const { data } = await api.get("/api/auth/sessions", {
      params: {
        page,
        pageSize,
        tab: targetTab,
        status: targetTab,
      },
    });

    return normalizeSessionsPayload(data, targetTab, page, pageSize);
  }

  const sessionsQ = useQuery({
    queryKey: ["auth", "sessions", tab, currentPage, currentPageSize],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () => fetchSessionsPage(tab, currentPage, currentPageSize),
    staleTime: 15_000,
  });

  const activeMetaQ = useQuery({
    queryKey: ["auth", "sessions", "ACTIVE", "meta"],
    enabled,
    queryFn: () => fetchSessionsPage("ACTIVE", 1, 1),
    staleTime: 15_000,
  });

  const recentMetaQ = useQuery({
    queryKey: ["auth", "sessions", "RECENT", "meta"],
    enabled,
    queryFn: () => fetchSessionsPage("RECENT", 1, 1),
    staleTime: 15_000,
  });

  useEffect(() => {
    const status = (sessionsQ.error as any)?.response?.status;
    if (status === 401) {
      performLogout("/login", navigate);
    }
  }, [sessionsQ.error, navigate]);

  const currentSessionId =
    sessionsQ.data?.currentSessionId ??
    activeMetaQ.data?.currentSessionId ??
    recentMetaQ.data?.currentSessionId ??
    null;

  const activeTotal =
    activeMetaQ.data?.counts?.active ??
    activeMetaQ.data?.total ??
    (tab === "ACTIVE" ? sessionsQ.data?.total : 0) ??
    0;

  const recentTotal =
    recentMetaQ.data?.counts?.recent ??
    recentMetaQ.data?.total ??
    (tab === "RECENT" ? sessionsQ.data?.total : 0) ??
    0;

  const pageData = sessionsQ.data ?? {
    rows: [],
    total: 0,
    page: currentPage,
    pageSize: currentPageSize,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
    currentSessionId,
  };

  const rows = pageData.rows ?? [];
  const busy = false;

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

      await performLogout("/login", navigate);
    }
  };

  const mutationBusy = revokeOneM.isPending || revokeOthersM.isPending;
  const activeHasAny = activeTotal > 0;

  useEffect(() => {
    setActiveJump("");
    setRecentJump("");
  }, [tab]);

  useEffect(() => {
    const maxPages = Math.max(1, activeMetaQ.data?.totalPages || Math.ceil(activeTotal / activePageSize) || 1);
    setActivePage((p) => clamp(p, 1, maxPages));
  }, [activeTotal, activePageSize, activeMetaQ.data?.totalPages]);

  useEffect(() => {
    const maxPages = Math.max(1, recentMetaQ.data?.totalPages || Math.ceil(recentTotal / recentPageSize) || 1);
    setRecentPage((p) => clamp(p, 1, maxPages));
  }, [recentTotal, recentPageSize, recentMetaQ.data?.totalPages]);

  const applyJump = () => {
    const n = Number(String(currentJump || "").trim());
    if (!Number.isFinite(n)) return;
    const target = clamp(Math.floor(n), 1, pageData.totalPages);
    setCurrentPage(target);
  };

  const startItem = pageData.total === 0 ? 0 : (pageData.page - 1) * pageData.pageSize + 1;
  const endItem = pageData.total === 0 ? 0 : Math.min(pageData.page * pageData.pageSize, pageData.total);

  return (
    <SiteLayout>
      <div className="max-w-screen-xl mx-auto px-3 sm:px-4 md:px-8 py-5 sm:py-6">
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
            disabled={mutationBusy || !activeHasAny}
            onClick={() => revokeOthersM.mutate()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border bg-white px-4 py-2 text-[13px] sm:text-sm font-semibold hover:bg-black/5 disabled:opacity-60 whitespace-nowrap"
            title={!activeHasAny ? "No active sessions to revoke" : "Log out other devices"}
          >
            <LogOut size={16} />
            <span className="sm:hidden">Log out others</span>
            <span className="hidden sm:inline">Log out other devices</span>
          </button>
        </div>

        <div className="mt-4 sm:mt-5 rounded-2xl border bg-white overflow-hidden">
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
                Active <span className="opacity-70">({activeTotal})</span>
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
                Recent <span className="opacity-70">({recentTotal})</span>
              </button>
            </div>
          </div>

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
                Page <b className="text-zinc-900">{pageData.page}</b> / {pageData.totalPages}
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
                  disabled={!pageData.total || pageData.totalPages <= 1}
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
          ) : pageData.total === 0 ? (
            <div className="p-4 text-sm text-zinc-600">
              {tab === "ACTIVE" ? "No active sessions." : "No recent (revoked) sessions."}
            </div>
          ) : (
            <>
              <div className="p-3 sm:p-0 sm:divide-y">
                {rows.map((s) => {
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

                      <div className="mt-3 flex gap-2 sm:justify-end">
                        {tab === "ACTIVE" ? (
                          <button
                            disabled={mutationBusy || isRevoked}
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

              <div className="px-4 py-3 border-t bg-zinc-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-xs text-zinc-600">
                  Showing{" "}
                  <span className="font-semibold text-zinc-900">{startItem}</span>
                  {"–"}
                  <span className="font-semibold text-zinc-900">{endItem}</span> of{" "}
                  <span className="font-semibold text-zinc-900">{pageData.total}</span>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-2 sm:py-1.5 text-xs font-semibold hover:bg-black/5 disabled:opacity-60"
                    disabled={!pageData.hasPrevPage}
                    onClick={() => setCurrentPage(pageData.page - 1)}
                  >
                    <ChevronLeft size={14} />
                    Prev
                  </button>

                  <span className="text-xs text-zinc-700 whitespace-nowrap">
                    <b className="text-zinc-900">{pageData.page}</b> / {pageData.totalPages}
                  </span>

                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-2 sm:py-1.5 text-xs font-semibold hover:bg-black/5 disabled:opacity-60"
                    disabled={!pageData.hasNextPage}
                    onClick={() => setCurrentPage(pageData.page + 1)}
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