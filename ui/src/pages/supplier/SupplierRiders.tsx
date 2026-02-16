import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import SupplierLayout from "../../layouts/SupplierLayout";
import api from "../../api/client";

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

function getAppBaseUrl() {
  // Prefer VITE_APP_URL if set; fallback to current origin
  const envUrl = (import.meta as any)?.env?.VITE_APP_URL;
  const u = String(envUrl || "").trim();
  if (u) return u.replace(/\/+$/, "");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return origin.replace(/\/+$/, "");
}

// ✅ Cookie calls helper (always send cookies)
const AXIOS_COOKIE_CFG = { withCredentials: true as const };

function pill(active: boolean) {
  return active
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-zinc-50 text-zinc-700 border-zinc-200";
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

  // NOTE: this is the invite token for the rider to accept the invite (NOT auth token)
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [lastInviteEmail, setLastInviteEmail] = useState<string | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const ridersQ = useQuery({
    queryKey: ["supplierRiders"],
    queryFn: async () => {
      const { data } = await api.get("/api/riders", AXIOS_COOKIE_CFG);
      return (data?.data ?? []) as RiderRow[];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
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

      // ✅ cookie auth
      const { data } = await api.post("/api/riders/invite", payload, AXIOS_COOKIE_CFG);
      return { data: data?.data, invitedEmail: email };
    },
    onSuccess: ({ data, invitedEmail }) => {
      const token = data?.inviteToken ?? null;

      setInviteToken(token);
      setLastInviteEmail(invitedEmail);

      qc.invalidateQueries({ queryKey: ["supplierRiders"] });

      // reset form after capturing email + token
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
      // ✅ cookie auth
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

  const rows = ridersQ.data ?? [];

  const inviteLink = useMemo(() => {
    if (!inviteToken) return null;
    const email = (lastInviteEmail || "").trim().toLowerCase();
    const base = getAppBaseUrl();
    // NOTE: this token is for invite acceptance (not auth)
    return `${base}/rider/accept?email=${encodeURIComponent(email)}&token=${encodeURIComponent(inviteToken)}`;
  }, [inviteToken, lastInviteEmail]);

  const canShowInviteBox = !!inviteToken;

  return (
    <SupplierLayout>
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900">Riders</h1>
            <p className="text-sm text-zinc-600">Invite riders and manage who can deliver.</p>
          </div>

          {/* Right-side status (optional small touch) */}
          <div className="text-xs text-zinc-500">
            {ridersQ.isLoading ? "Loading…" : `${rows.length} rider${rows.length === 1 ? "" : "s"}`}
          </div>
        </div>

        {/* Invite card */}
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

            {/* Inputs (mobile-first spacing) */}
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

            {/* Actions (✅ fit 320px: full width on mobile, grid if needed) */}
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

            {/* Token + link (temporary; in production email it) */}
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

        {/* List */}
        <div className="rounded-2xl border bg-white/90 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b bg-white/70 flex items-center justify-between">
            <h2 className="font-semibold text-zinc-900">All riders</h2>
            {ridersQ.isLoading && <span className="text-xs text-zinc-500">Loading…</span>}
          </div>

          {/* ✅ Mobile-first cards; desktop keeps row layout */}
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
        </div>
      </div>
    </SupplierLayout>
  );
}
