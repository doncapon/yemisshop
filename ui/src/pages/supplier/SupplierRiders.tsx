import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";
import { ChevronLeft, ChevronRight } from "lucide-react";

type RiderRow = {
  id: string;
  userId: string;
  supplierId: string;
  name?: string | null;
  phone?: string | null;
  isActive: boolean;
  createdAt: string;
  user?: {
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    status?: string | null;
  };
};

type RidersPageDto = {
  rows: RiderRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  counts?: {
    active?: number;
    inactive?: number;
  };
  supplierId?: string;
};

function getAppBaseUrl() {
  const envUrl = (import.meta as any)?.env?.VITE_APP_URL;
  const u = String(envUrl || "").trim();
  if (u) return u.replace(/\/+$/, "");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return origin.replace(/\/+$/, "");
}

const AXIOS_COOKIE_CFG = { withCredentials: true as const };
const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

function pill(active: boolean) {
  return active
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-zinc-50 text-zinc-700 border-zinc-200";
}

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
    //
  }
}

function normalizeRidersPayload(raw: any, fallbackPage: number, fallbackPageSize: number): RidersPageDto {
  const payload = raw?.data ?? raw ?? {};
  const rows = Array.isArray(payload?.rows)
    ? payload.rows
    : Array.isArray(payload)
      ? payload
      : [];

  const total = Number.isFinite(Number(payload?.total)) ? Number(payload.total) : rows.length;
  const pageSize =
    Number.isFinite(Number(payload?.pageSize)) && Number(payload.pageSize) > 0
      ? Number(payload.pageSize)
      : fallbackPageSize;

  const totalPages =
    Number.isFinite(Number(payload?.totalPages)) && Number(payload.totalPages) > 0
      ? Number(payload.totalPages)
      : Math.max(1, Math.ceil(total / pageSize));

  const page =
    Number.isFinite(Number(payload?.page)) && Number(payload.page) > 0
      ? Number(payload.page)
      : fallbackPage;

  const safePage = Math.min(Math.max(1, page), Math.max(1, totalPages));

  return {
    rows,
    total,
    page: safePage,
    pageSize,
    totalPages: Math.max(1, totalPages),
    hasNextPage:
      typeof payload?.hasNextPage === "boolean" ? payload.hasNextPage : safePage < totalPages,
    hasPrevPage:
      typeof payload?.hasPrevPage === "boolean" ? payload.hasPrevPage : safePage > 1,
    counts:
      payload?.counts && typeof payload.counts === "object"
        ? {
            active: Number.isFinite(Number(payload.counts.active))
              ? Number(payload.counts.active)
              : undefined,
            inactive: Number.isFinite(Number(payload.counts.inactive))
              ? Number(payload.counts.inactive)
              : undefined,
          }
        : undefined,
    supplierId: payload?.supplierId ? String(payload.supplierId) : undefined,
  };
}

export default function SupplierRiders() {
  const qc = useQueryClient();

  const [invite, setInvite] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
    name: "",
  });

  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [lastInviteEmail, setLastInviteEmail] = useState<string | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => readNumber("supplier_riders_pageSize", 10));
  const [jump, setJump] = useState("");

  useEffect(() => writeNumber("supplier_riders_pageSize", pageSize), [pageSize]);

  const ridersQ = useQuery({
    queryKey: ["supplierRiders", page, pageSize],
    queryFn: async () => {
      const { data } = await api.get("/api/riders", {
        ...AXIOS_COOKIE_CFG,
        params: { page, pageSize },
      });
      return normalizeRidersPayload(data, page, pageSize);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  const inviteM = useMutation({
    mutationFn: async () => {
      setErr(null);
      setMsg(null);

      const email = invite.email.trim().toLowerCase();
      if (!email) throw new Error("Email is required");

      const payload = {
        email,
        firstName: invite.firstName.trim(),
        lastName: invite.lastName.trim(),
        phone: invite.phone.trim() || undefined,
        name: invite.name.trim() || undefined,
      };

      const { data } = await api.post("/api/riders/invite", payload, AXIOS_COOKIE_CFG);
      return { data: data?.data, invitedEmail: email };
    },
    onSuccess: ({ data, invitedEmail }) => {
      const token = data?.inviteToken ?? null;

      setInviteToken(token);
      setLastInviteEmail(invitedEmail);

      qc.invalidateQueries({ queryKey: ["supplierRiders"] });

      setInvite({ email: "", firstName: "", lastName: "", phone: "", name: "" });

      setMsg(token ? "Invite created." : "Invite created, but no token returned.");
    },
    onError: (e: any) => {
      const apiMsg = e?.response?.data?.error;
      const localMsg = e?.message;
      setErr(apiMsg || localMsg || "Invite failed");
    },
  });

  const toggleM = useMutation({
    mutationFn: async (p: { riderId: string; isActive: boolean }) => {
      const { data } = await api.patch(
        `/api/riders/${p.riderId}`,
        { isActive: p.isActive },
        AXIOS_COOKIE_CFG
      );
      return data?.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supplierRiders"] }),
    onError: (e: any) => {
      const apiMsg = e?.response?.data?.error;
      setErr(apiMsg || "Update failed");
    },
  });

  const pageData = ridersQ.data ?? {
    rows: [],
    total: 0,
    page,
    pageSize,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  };

  useEffect(() => {
    if (page > pageData.totalPages) {
      setPage(pageData.totalPages);
    }
  }, [page, pageData.totalPages]);

  const rows = pageData.rows ?? [];
  const activeCount =
    pageData.counts?.active ??
    rows.filter((r) => r.isActive).length;
  const inactiveCount =
    pageData.counts?.inactive ??
    rows.filter((r) => !r.isActive).length;

  const inviteLink = useMemo(() => {
    if (!inviteToken) return null;
    const email = (lastInviteEmail || "").trim().toLowerCase();
    const base = getAppBaseUrl();
    return `${base}/rider/accept?email=${encodeURIComponent(email)}&token=${encodeURIComponent(inviteToken)}`;
  }, [inviteToken, lastInviteEmail]);

  const canShowInviteBox = !!inviteToken;

  const startItem = pageData.total === 0 ? 0 : (pageData.page - 1) * pageData.pageSize + 1;
  const endItem =
    pageData.total === 0 ? 0 : Math.min(pageData.page * pageData.pageSize, pageData.total);

  const applyJump = () => {
    const n = Number(String(jump || "").trim());
    if (!Number.isFinite(n)) return;
    const target = Math.max(1, Math.min(pageData.totalPages, Math.floor(n)));
    setPage(target);
  };

  return (
    <SupplierLayout>
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900">Riders</h1>
            <p className="text-sm text-zinc-600">Invite riders and manage who can deliver.</p>
          </div>

          <div className="text-xs text-zinc-500">
            {ridersQ.isLoading
              ? "Loading…"
              : `${pageData.total} rider${pageData.total === 1 ? "" : "s"} • ${activeCount} active • ${inactiveCount} inactive`}
          </div>
        </div>

        <div className="rounded-2xl border bg-white/90 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b bg-white/70 flex items-center justify-between">
            <h2 className="font-semibold text-zinc-900">Invite a rider</h2>
          </div>

          <div className="p-4 sm:p-5">
            {err && (
              <div className="mb-3 text-sm rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2">
                {err}
              </div>
            )}

            {msg && !err && (
              <div className="mb-3 text-sm rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-2">
                {msg}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
              <input
                className="rounded-xl border px-3 py-3 text-sm"
                placeholder="Email *"
                value={invite.email}
                onChange={(e) => setInvite((x) => ({ ...x, email: e.target.value }))}
                inputMode="email"
                autoComplete="email"
              />
              <input
                className="rounded-xl border px-3 py-3 text-sm"
                placeholder="Phone (optional)"
                value={invite.phone}
                onChange={(e) => setInvite((x) => ({ ...x, phone: e.target.value }))}
                inputMode="tel"
                autoComplete="tel"
              />
              <input
                className="rounded-xl border px-3 py-3 text-sm"
                placeholder="First name"
                value={invite.firstName}
                onChange={(e) => setInvite((x) => ({ ...x, firstName: e.target.value }))}
                autoComplete="given-name"
              />
              <input
                className="rounded-xl border px-3 py-3 text-sm"
                placeholder="Last name"
                value={invite.lastName}
                onChange={(e) => setInvite((x) => ({ ...x, lastName: e.target.value }))}
                autoComplete="family-name"
              />
              <input
                className="rounded-xl border px-3 py-3 text-sm sm:col-span-2"
                placeholder="Display name (optional)"
                value={invite.name}
                onChange={(e) => setInvite((x) => ({ ...x, name: e.target.value }))}
              />
            </div>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => inviteM.mutate()}
                disabled={inviteM.isPending}
                className="w-full rounded-xl bg-zinc-900 text-white px-4 py-3 text-sm font-semibold disabled:opacity-50"
              >
                {inviteM.isPending ? "Inviting…" : "Invite rider"}
              </button>

              <button
                type="button"
                disabled={!canShowInviteBox}
                onClick={async () => {
                  if (!inviteLink) return;
                  try {
                    await navigator.clipboard.writeText(inviteLink);
                    setMsg("Invite link copied ✅");
                  } catch {
                    setMsg("Could not copy. Please copy manually.");
                  }
                }}
                className="w-full rounded-xl border bg-white px-4 py-3 text-sm font-semibold disabled:opacity-50"
              >
                Copy link
              </button>

              <a
                className={`w-full rounded-xl border bg-white px-4 py-3 text-sm font-semibold text-center ${
                  !inviteLink || !lastInviteEmail ? "opacity-50 pointer-events-none" : ""
                }`}
                href={
                  inviteLink && lastInviteEmail
                    ? `mailto:${encodeURIComponent(lastInviteEmail)}?subject=${encodeURIComponent(
                        "Rider invite"
                      )}&body=${encodeURIComponent(inviteLink)}`
                    : undefined
                }
              >
                Email link
              </a>
            </div>

            {canShowInviteBox && (
              <div className="mt-4 rounded-2xl border bg-zinc-50 p-4 text-sm space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-zinc-500">Invite token</div>
                    <code className="block break-all text-xs">{inviteToken}</code>
                  </div>
                  <span className="shrink-0 inline-flex items-center rounded-full border px-2 py-1 text-[11px] bg-white text-zinc-700">
                    TEMP
                  </span>
                </div>

                <div className="text-xs text-zinc-600">
                  Invited email: <span className="font-medium text-zinc-900">{lastInviteEmail || "—"}</span>
                </div>

                <div className="text-xs text-zinc-600">Send this link to the rider:</div>
                <code className="block break-all text-xs bg-white border rounded-xl p-3">
                  {inviteLink ?? "(missing link)"}
                </code>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border bg-white/90 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b bg-white/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="font-semibold text-zinc-900">All riders</h2>
              <div className="text-xs text-zinc-500">
                {ridersQ.isLoading
                  ? "Loading…"
                  : pageData.total > 0
                    ? `Showing ${startItem}-${endItem} of ${pageData.total}`
                    : "No riders yet"}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={String(pageSize)}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded-full border bg-white px-3 py-2 text-xs font-semibold"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>

              <input
                value={jump}
                onChange={(e) => setJump(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyJump();
                }}
                inputMode="numeric"
                placeholder="Go…"
                className="w-16 rounded-full border bg-white px-3 py-2 text-xs"
              />

              <button
                type="button"
                onClick={applyJump}
                disabled={pageData.totalPages <= 1}
                className="rounded-full border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
              >
                Go
              </button>
            </div>
          </div>

          <div className="divide-y">
            {rows.map((r) => {
              const label =
                r.name ||
                `${r.user?.firstName ?? ""} ${r.user?.lastName ?? ""}`.trim() ||
                r.user?.email ||
                r.id;

              const phone = r.phone || r.user?.phone || "—";
              const email = r.user?.email || "—";

              return (
                <div key={r.id} className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-zinc-900 truncate">{label}</div>

                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] ${pill(
                            r.isActive
                          )}`}
                        >
                          {r.isActive ? "ACTIVE" : "INACTIVE"}
                        </span>
                        {r.user?.status ? (
                          <span className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] bg-white text-zinc-700">
                            {String(r.user.status).toUpperCase()}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 text-xs text-zinc-600 break-words">
                        <div>
                          <span className="text-zinc-500">Email:</span> {email}
                        </div>
                        <div>
                          <span className="text-zinc-500">Phone:</span> {phone}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleM.mutate({ riderId: r.id, isActive: !r.isActive })}
                      disabled={toggleM.isPending}
                      className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold border disabled:opacity-50 ${
                        r.isActive
                          ? "bg-white hover:bg-black/5"
                          : "bg-zinc-900 text-white border-zinc-900 hover:opacity-90"
                      }`}
                    >
                      {r.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </div>
              );
            })}

            {!rows.length && !ridersQ.isLoading && (
              <div className="p-6 text-sm text-zinc-600">No riders yet. Invite one above.</div>
            )}
          </div>

          <div className="px-4 sm:px-5 py-3 border-t bg-zinc-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-xs text-zinc-600">
              Showing <span className="font-semibold text-zinc-900">{startItem}</span>
              {"–"}
              <span className="font-semibold text-zinc-900">{endItem}</span> of{" "}
              <span className="font-semibold text-zinc-900">{pageData.total}</span>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
                disabled={!pageData.hasPrevPage}
                onClick={() => setPage(pageData.page - 1)}
              >
                <ChevronLeft size={14} />
                Prev
              </button>

              <span className="text-xs text-zinc-700 whitespace-nowrap">
                <b className="text-zinc-900">{pageData.page}</b> / {pageData.totalPages}
              </span>

              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
                disabled={!pageData.hasNextPage}
                onClick={() => setPage(pageData.page + 1)}
              >
                Next
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </SupplierLayout>
  );
}