import { useMemo } from "react";
import SiteLayout from "../../layouts/SiteLayout";
import api from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useModal } from "../../components/ModalProvider";
import { useNavigate } from "react-router-dom";
import { Lock, LogOut, Monitor, Smartphone, Trash2 } from "lucide-react";

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

export default function AccountSessions() {
  const { openModal } = useModal();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const token = useAuthStore((s: any) => s.token);
  const logout = useAuthStore((s: any) => s.logout);

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
      logout?.();
      navigate("/login");
    }
  };

  const busy = revokeOneM.isPending || revokeOthersM.isPending;

  const headerRight = useMemo(() => {
    return (
      <button
        disabled={busy || !sessions.length}
        onClick={() => revokeOthersM.mutate()}
        className="inline-flex items-center gap-2 rounded-full border bg-white px-4 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-60"
      >
        <LogOut size={16} />
        Log out other devices
      </button>
    );
  }, [busy, sessions.length, revokeOthersM]);

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
          <div className="px-4 py-3 border-b text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <Lock size={16} />
            Active & recent sessions
          </div>

          {sessionsQ.isLoading ? (
            <div className="p-4 text-sm text-zinc-600">Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-sm text-zinc-600">No sessions found.</div>
          ) : (
            <div className="divide-y">
              {sessions.map((s) => {
                const isCurrent = currentSessionId && s.id === currentSessionId;
                const isRevoked = !!s.revokedAt;
                const dev = guessDevice(s.userAgent);

                return (
                  <div key={s.id} className="p-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-700">{dev.icon}</span>
                        <div className="font-semibold text-zinc-900 truncate">
                          {s.deviceName?.trim() || dev.label}
                        </div>
                        {isCurrent && (
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
                        {isRevoked && s.revokedReason && <div>Reason: {s.revokedReason}</div>}
                      </div>
                    </div>

                    <div className="shrink-0">
                      <button
                        disabled={busy || isRevoked}
                        onClick={() => onRevoke(s.id)}
                        className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-60"
                        title={isCurrent ? "Log out this device" : "Revoke this session"}
                      >
                        <Trash2 size={16} />
                        {isCurrent ? "Log out" : "Revoke"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
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
