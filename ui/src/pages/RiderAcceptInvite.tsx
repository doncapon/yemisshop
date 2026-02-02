import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import SiteLayout from "../layouts/SiteLayout";

export default function RiderAcceptInvite() {
  const [sp] = useSearchParams();
  const nav = useNavigate();

  const email = useMemo(() => String(sp.get("email") ?? "").trim().toLowerCase(), [sp]);
  const token = useMemo(() => String(sp.get("token") ?? "").trim(), [sp]);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    dateOfBirth: "",
    password: "",
    confirmPassword: "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const onChange =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
    };

  const validate = () => {
    if (!email) return "Missing email in invite link";
    if (!token) return "Missing token in invite link";

    const pwd = form.password ?? "";
    const hasMinLen = pwd.length >= 8;
    const hasLetter = /[A-Za-z]/.test(pwd);
    const hasNumber = /\d/.test(pwd);
    const hasSpecial = /[^A-Za-z0-9]/.test(pwd);
    if (!hasMinLen || !hasLetter || !hasNumber || !hasSpecial) {
      return "Password must be at least 8 characters and include a letter, a number, and a special character.";
    }
    if (form.password !== form.confirmPassword) return "Passwords do not match";

    if (form.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth)) {
      return "Please use a valid date (YYYY-MM-DD).";
    }

    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setOkMsg(null);

    const v = validate();
    if (v) return setErr(v);

    try {
      setSubmitting(true);

      const payload = {
        email,
        token,
        password: form.password,
        firstName: form.firstName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
        phone: form.phone.trim() || undefined,
        dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth).toISOString() : undefined,
      };

      await api.post("/api/riders/accept-invite", payload);

      setOkMsg("Setup complete ✅ Redirecting to login…");
      window.setTimeout(() => nav("/login", { replace: true }), 700);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to accept invite");
    } finally {
      setSubmitting(false);
    }
  };

  const linkInvalid = !email || !token;

  return (
    <SiteLayout>
      <div className="min-h-[100dvh] grid place-items-center px-4">
        <form onSubmit={submit} className="w-full max-w-xl rounded-2xl border bg-white p-6 space-y-4">
          <h1 className="text-xl font-semibold">Accept Rider Invite</h1>

          {err && (
            <div className="rounded-md border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
              {err}
            </div>
          )}

          {okMsg && !err && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-2 text-sm">
              {okMsg}
            </div>
          )}

          <div className="text-sm text-slate-600">
            Invite for: <span className="font-medium text-slate-900">{email || "—"}</span>
          </div>

          {linkInvalid && (
            <div className="text-sm rounded-md border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2">
              This invite link is missing required parameters. Please ask the supplier to resend the invite link.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className="rounded-xl border px-3 py-3"
              placeholder="First name (optional)"
              value={form.firstName}
              onChange={onChange("firstName")}
            />
            <input
              className="rounded-xl border px-3 py-3"
              placeholder="Last name (optional)"
              value={form.lastName}
              onChange={onChange("lastName")}
            />
          </div>

          <input
            className="rounded-xl border px-3 py-3"
            placeholder="Phone (optional)"
            value={form.phone}
            onChange={onChange("phone")}
          />

          <div>
            <label className="block text-sm font-medium text-slate-800 mb-1">Date of birth (optional)</label>
            <input
              type="date"
              className="w-full rounded-xl border px-3 py-3"
              value={form.dateOfBirth}
              onChange={onChange("dateOfBirth")}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              type="password"
              className="rounded-xl border px-3 py-3"
              placeholder="Password"
              value={form.password}
              onChange={onChange("password")}
            />
            <input
              type="password"
              className="rounded-xl border px-3 py-3"
              placeholder="Confirm password"
              value={form.confirmPassword}
              onChange={onChange("confirmPassword")}
            />
          </div>

          <button
            type="submit"
            disabled={submitting || linkInvalid}
            className="w-full rounded-xl bg-black text-white py-3 font-semibold disabled:opacity-50"
          >
            {submitting ? "Setting up…" : "Finish setup"}
          </button>
        </form>
      </div>
    </SiteLayout>
  );
}
