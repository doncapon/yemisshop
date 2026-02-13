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

export default function AccountSessions() {
  const { openModal } = useModal();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const token = useAuthStore((s: any) => s.token);
  const logout = useAuthStore((s: any) => s.logout);

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
    enabled: !!token,
    queryFn: async () => {
      const { data } = await api.get<{ data: SessionDto[]; currentSessionId: string | null }>(
        "/api/auth/sessions"
      );
      return data;
    },
    staleTime: 15_000,
  });

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
      await performLogout("/login",navigate); // ✅ clears cookie + clears state

      navigate("/login");
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

  const headerRight = useMemo(() => {
    return (
      <button
        disabled={busy || !activeSessions.length}
        onClick={() => revokeOthersM.mutate()}
        className="inline-flex items-center gap-2 rounded-full border bg-white px-4 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-60"
        title={!activeSessions.length ? "No active sessions to revoke" : "Log out other devices"}
      >
        <LogOut size={16} />
        Log out other devices
      </button>
    );
  }, [busy, activeSessions.length, revokeOthersM]);

  const applyJump = () => {
    const n = Number(String(currentJump || "").trim());
    if (!Number.isFinite(n)) return;
    const target = clamp(Math.floor(n), 1, paged.totalPages);
    setCurrentPage(target);
  };

  return (
    <SiteLayout>
      <div className="max-w-screen-xl mx-auto px-3 md:px-8 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Manage sessions</h1>
            <p className="mt-1 text-sm text-zinc-600">
              See where your account is signed in and revoke access.
            </p>
          </div>
          {headerRight}
        </div>

        <div className="mt-5 rounded-2xl border bg-white overflow-hidden">
          <div className="px-4 py-3 border-b text-sm font-semibold text-zinc-900 flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2">
              <Lock size={16} />
              Sessions
            </span>

            {/* Tabs */}
            <div className="inline-flex rounded-full border bg-zinc-50 p-1">
              <button
                type="button"
                onClick={() => setTab("ACTIVE")}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
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
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                  tab === "RECENT"
                    ? "bg-white shadow-sm text-zinc-900"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                Recent <span className="opacity-70">({recentSessions.length})</span>
              </button>
            </div>
          </div>

          {/* Controls row: page size + jump */}
          <div className="px-4 py-3 border-b bg-zinc-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-zinc-700">
              <span className="font-semibold">Rows:</span>
              <select
                value={String(currentPageSize)}
                onChange={(e) => setCurrentPageSize(Number(e.target.value))}
                className="rounded-full border bg-white px-3 py-1.5 text-xs font-semibold"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>

              <span className="ml-2 text-zinc-500">
                {tab === "ACTIVE" ? "Active sessions shown first by last seen" : "Revoked sessions shown by revoked date"}
              </span>
            </div>

            <div className="flex items-center gap-2">
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
                  placeholder="Go to…"
                  className="w-20 rounded-full border bg-white px-3 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={applyJump}
                  disabled={!paged.total || paged.totalPages <= 1}
                  className="rounded-full border bg-white px-3 py-1.5 text-xs font-semibold hover:bg-black/5 disabled:opacity-60"
                >
                  Go
                </button>
              </div>
            </div>
          </div>

          {sessionsQ.isLoading ? (
            <div className="p-4 text-sm text-zinc-600">Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-sm text-zinc-600">No sessions found.</div>
          ) : paged.total === 0 ? (
            <div className="p-4 text-sm text-zinc-600">
              {tab === "ACTIVE" ? "No active sessions." : "No recent (revoked) sessions."}
            </div>
          ) : (
            <>
              <div className="divide-y">
                {paged.items.map((s) => {
                  const isCurrent = currentSessionId && s.id === currentSessionId;
                  const isRevoked = !!s.revokedAt;
                  const dev = guessDevice(s.userAgent);

                  return (
                    <div key={s.id} className="p-4 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-zinc-700">{dev.icon}</span>
                          <div className="font-semibold text-zinc-900 truncate max-w-[60vw] sm:max-w-[420px]">
                            {s.deviceName?.trim() || dev.label}
                          </div>

                          {isCurrent && !isRevoked && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                              This device
                            </span>
                          )}

                          {isRevoked && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
                              Revoked
                            </span>
                          )}
                        </div>

                        <div className="mt-1 text-xs text-zinc-600 space-y-0.5">
                          <div>IP: {maskIp(s.ip)}</div>
                          <div>Last seen: {new Date(s.lastSeenAt).toLocaleString()}</div>
                          <div>Created: {new Date(s.createdAt).toLocaleString()}</div>
                          {isRevoked && (
                            <>
                              <div>Revoked: {new Date(s.revokedAt as string).toLocaleString()}</div>
                              {s.revokedReason && <div>Reason: {s.revokedReason}</div>}
                            </>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0">
                        {tab === "ACTIVE" ? (
                          <button
                            disabled={busy || isRevoked}
                            onClick={() => onRevoke(s.id)}
                            className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-60"
                            title={isCurrent ? "Log out this device" : "Revoke this session"}
                          >
                            <Trash2 size={16} />
                            {isCurrent ? "Log out" : "Revoke"}
                          </button>
                        ) : (
                          <button
                            disabled
                            className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-2 text-sm font-semibold opacity-60"
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

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1.5 text-xs font-semibold hover:bg-black/5 disabled:opacity-60"
                    disabled={paged.page <= 1}
                    onClick={() => setCurrentPage(paged.page - 1)}
                  >
                    <ChevronLeft size={14} />
                    Prev
                  </button>

                  <span className="text-xs text-zinc-700">
                    Page <b className="text-zinc-900">{paged.page}</b> / {paged.totalPages}
                  </span>

                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1.5 text-xs font-semibold hover:bg-black/5 disabled:opacity-60"
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

        <div className="mt-4 text-[11px] text-zinc-500">
          Revoking a session invalidates its access token on the next request (because the JWT
          sessionId is checked).
        </div>
      </div>
    </SiteLayout>
  );
}
