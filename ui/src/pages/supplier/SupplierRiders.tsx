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

  const ridersQ = useQuery({
    queryKey: ["supplierRiders"],
    queryFn: async () => {
      const { data } = await api.get("/api/riders");
      return (data?.data ?? []) as RiderRow[];
    },
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

      const { data } = await api.post("/api/riders/invite", payload);
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
      const { data } = await api.patch(`/api/riders/${p.riderId}`, { isActive: p.isActive });
      return data?.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supplierRiders"] }),
  });

  const rows = ridersQ.data ?? [];

  const inviteLink = useMemo(() => {
    if (!inviteToken) return null;
    const email = (lastInviteEmail || "").trim().toLowerCase();
    const base = getAppBaseUrl();
    return `${base}/rider/accept?email=${encodeURIComponent(email)}&token=${encodeURIComponent(inviteToken)}`;
  }, [inviteToken, lastInviteEmail]);

  const canShowInviteBox = !!inviteToken;

  return (
    <SupplierLayout>
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Riders</h1>
            <p className="text-sm text-slate-600">Invite riders and manage who can deliver.</p>
          </div>
        </div>

        {/* Invite card */}
        <div className="rounded-2xl border bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Invite a rider</h2>
          </div>

          {err && (
            <div className="mt-3 text-sm rounded-md border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2">
              {err}
            </div>
          )}

          {msg && !err && (
            <div className="mt-3 text-sm rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-2">
              {msg}
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className="rounded-xl border px-3 py-3"
              placeholder="Email"
              value={invite.email}
              onChange={(e) => setInvite((x) => ({ ...x, email: e.target.value }))}
            />
            <input
              className="rounded-xl border px-3 py-3"
              placeholder="Phone (optional)"
              value={invite.phone}
              onChange={(e) => setInvite((x) => ({ ...x, phone: e.target.value }))}
            />
            <input
              className="rounded-xl border px-3 py-3"
              placeholder="First name"
              value={invite.firstName}
              onChange={(e) => setInvite((x) => ({ ...x, firstName: e.target.value }))}
            />
            <input
              className="rounded-xl border px-3 py-3"
              placeholder="Last name"
              value={invite.lastName}
              onChange={(e) => setInvite((x) => ({ ...x, lastName: e.target.value }))}
            />
            <input
              className="rounded-xl border px-3 py-3 md:col-span-2"
              placeholder="Display name (optional)"
              value={invite.name}
              onChange={(e) => setInvite((x) => ({ ...x, name: e.target.value }))}
            />
          </div>

          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => inviteM.mutate()}
              disabled={inviteM.isPending}
              className="rounded-xl bg-black text-white px-4 py-2 font-semibold disabled:opacity-50"
            >
              {inviteM.isPending ? "Inviting…" : "Invite rider"}
            </button>

            {canShowInviteBox && (
              <>
                <button
                  type="button"
                  onClick={async () => {
                    if (!inviteLink) return;
                    try {
                      await navigator.clipboard.writeText(inviteLink);
                      setMsg("Invite link copied ✅");
                    } catch {
                      setMsg("Could not copy. Please copy manually.");
                    }
                  }}
                  className="rounded-xl border bg-white px-4 py-2 font-semibold"
                >
                  Copy link
                </button>

                <a
                  className="rounded-xl border bg-white px-4 py-2 font-semibold"
                  href={
                    inviteLink && lastInviteEmail
                      ? `mailto:${encodeURIComponent(lastInviteEmail)}?subject=${encodeURIComponent(
                          "Rider invite"
                        )}&body=${encodeURIComponent(inviteLink)}`
                      : undefined
                  }
                  onClick={(e) => {
                    if (!inviteLink || !lastInviteEmail) e.preventDefault();
                  }}
                >
                  Email link
                </a>
              </>
            )}
          </div>

          {/* Token + link (temporary; in production email it) */}
          {canShowInviteBox && (
            <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-sm space-y-2">
              <div>
                <span className="font-medium">Invite token:</span>{" "}
                <code className="break-all">{inviteToken}</code>
              </div>

              <div className="text-slate-600">
                Invited email:{" "}
                <span className="font-medium text-slate-800">{lastInviteEmail || "—"}</span>
              </div>

              <p className="text-slate-600">Send this link to the rider:</p>

              <code className="block break-all">{inviteLink ?? "(missing link)"}</code>
            </div>
          )}
        </div>

        {/* List */}
        <div className="rounded-2xl border bg-white overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="font-semibold">All riders</h2>
            {ridersQ.isLoading && <span className="text-sm text-slate-500">Loading…</span>}
          </div>

          <div className="divide-y">
            {rows.map((r) => {
              const label =
                r.name ||
                `${r.user?.firstName ?? ""} ${r.user?.lastName ?? ""}`.trim() ||
                r.user?.email ||
                r.id;

              const phone = r.phone || r.user?.phone || "—";

              return (
                <div key={r.id} className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <div className="font-semibold">{label}</div>
                    <div className="text-sm text-slate-600">
                      {r.user?.email ?? "—"} • {phone} • status: {r.isActive ? "ACTIVE" : "INACTIVE"}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleM.mutate({ riderId: r.id, isActive: !r.isActive })}
                    disabled={toggleM.isPending}
                    className={`rounded-xl px-4 py-2 font-semibold border ${
                      r.isActive ? "bg-white" : "bg-black text-white border-black"
                    } disabled:opacity-50`}
                  >
                    {r.isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>
              );
            })}

            {!rows.length && !ridersQ.isLoading && (
              <div className="p-6 text-sm text-slate-600">No riders yet. Invite one above.</div>
            )}
          </div>
        </div>
      </div>
    </SupplierLayout>
  );
}
