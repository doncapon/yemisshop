// src/pages/admin/AdminNewsletter.tsx
import React, { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Mail, Info, AlertCircle } from "lucide-react";

import api from "../../api/client.js";
import { useAuthStore } from "../../store/auth";
import { useToast } from "../../components/ToastProvider.js";
import { useNavigate } from "react-router-dom";

const AXIOS_COOKIE_CFG = { withCredentials: true as const };

type Role =
    | "ADMIN"
    | "SUPER_ADMIN"
    | "SHOPPER"
    | "SUPPLIER"
    | "SUPPLIER_RIDER"
    | string;

type SendNewsletterPayload = {
    subject: string;
    html: string;
    dryRun?: boolean;
    limit?: number | null;
};

type SendNewsletterResult = {
    dryRun: boolean;
    totalFound: number;
    totalSent: number;
    stoppedByLimit: boolean;
};

type SendNewsletterHistoryItem = SendNewsletterResult & {
    at: string;
    subject: string;
};

export default function AdminNewsletterPage() {
    const user = useAuthStore((s) => s.user);
    const role = (user?.role || "SHOPPER") as Role;
    const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

    const toast = useToast();
    const navigate = useNavigate();

    const [subject, setSubject] = useState("");
    const [body, setBody] = useState("");
    const [limit, setLimit] = useState<string>("");
    const [dryRun, setDryRun] = useState<boolean>(true);

    const [lastResult, setLastResult] = useState<SendNewsletterResult | null>(null);
    const [history, setHistory] = useState<SendNewsletterHistoryItem[]>([]);

    const isValid = useMemo(() => {
        return subject.trim().length > 3 && body.trim().length > 10;
    }, [subject, body]);

    const mutation = useMutation<
        SendNewsletterResult,
        any,
        SendNewsletterPayload
    >({
        mutationKey: ["admin-newsletter-send"],
        mutationFn: async (payload: SendNewsletterPayload) => {
            const { data } = await api.post<SendNewsletterResult>(
                "/api/admin/newsletter/send",
                payload,
                AXIOS_COOKIE_CFG
            );
            return data;
        },
        onSuccess: (data) => {
            setLastResult(data);

            const item: SendNewsletterHistoryItem = {
                ...data,
                at: new Date().toISOString(),
                subject: subject.trim() || "(no subject)",
            };
            setHistory((prev) => [item, ...prev].slice(0, 3));

            toast.push({
                title: "Newsletter",
                message: data.dryRun
                    ? `Dry run complete — found ${data.totalFound} subscribers.`
                    : `Sent to ${data.totalSent} subscriber(s).`,
            });
        },
        onError: (err) => {
            toast.push({
                title: "Newsletter",
                message:
                    err?.response?.data?.error ||
                    err?.response?.data?.message ||
                    err?.message ||
                    "Failed to send newsletter.",
            });
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValid || mutation.isPending) return;

        const lim = limit.trim() ? Number(limit.trim()) : NaN;
        const limitNum = Number.isFinite(lim) && lim > 0 ? lim : undefined;

        const payload: SendNewsletterPayload = {
            subject: subject.trim(),
            html: body,
            dryRun,
            limit: limitNum ?? undefined,
        };

        if (!dryRun) {
            const ok = window.confirm(
                `Send this newsletter to all subscribers${limitNum ? ` (up to ${limitNum})` : ""
                }?`
            );
            if (!ok) return;
        }

        mutation.mutate(payload);
    };

    const loadingLabel = mutation.isPending
        ? dryRun
            ? "Running dry run…"
            : "Sending…"
        : dryRun
            ? "Run dry run"
            : "Send newsletter";

    const showPreview = subject.trim() || body.trim();

    if (!isAdmin) {
        return (
            <div className="px-3 py-6 max-w-xl mx-auto">
                <div className="rounded-xl border bg-white p-4 flex gap-2 text-amber-800">
                    <AlertCircle className="h-5 w-5" />
                    <div>
                        <h2 className="font-semibold">Admins only</h2>
                        <p className="text-sm text-ink-soft mt-1">
                            The newsletter tool is restricted to admin users.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="px-3 sm:px-4 md:px-6 py-4 md:py-6 max-w-5xl mx-auto">

            {/* BACK BUTTON */}
            <div className="mb-4">
                <button
                    onClick={() => navigate("/admin")}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] sm:text-sm
                     bg-surface border border-[--color-surface-ring]
                     hover:bg-surface-hover text-ink-soft hover:text-ink transition"
                >
                    ← Back to Admin
                </button>
            </div>

            {/* Header */}
            <div className="mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl sm:text-2xl font-semibold text-ink flex items-center gap-2">
                        <Mail className="h-5 w-5 text-primary-600" />
                        <span>Newsletter Broadcast</span>
                    </h1>
                    <p className="text-xs sm:text-sm text-ink-soft mt-1 max-w-xl">
                        Send occasional updates to all newsletter subscribers.
                        Start with a <strong>dry run</strong> to see how many users will receive it.
                    </p>
                </div>

                <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-[11px] text-amber-800 border border-amber-200">
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>Admins only</span>
                </div>
            </div>

            {/* Layout: form + preview */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                {/* Form card */}
                <div className="rounded-2xl border border-[--color-surface-ring] bg-white shadow-sm p-3.5 sm:p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                        <h2 className="text-sm sm:text-base font-semibold text-ink">
                            Compose newsletter
                        </h2>
                        <button
                            type="button"
                            className="text-[11px] sm:text-xs text-ink-soft hover:text-ink underline"
                            onClick={() => {
                                setSubject("DaySpring updates and new arrivals");
                                setBody(
                                    `<p>Hi there,</p>
<p>We&apos;re excited to share some updates from <strong>DaySpring</strong>:</p>
<ul>
  <li>New products from trusted suppliers</li>
  <li>Improved delivery timelines in selected areas</li>
  <li>Ongoing work on returns and refund experience</li>
</ul>
<p>Log in today to see what&apos;s new.</p>
<p>Thanks,<br/>The DaySpring team</p>`
                                );
                            }}
                        >
                            Insert sample content
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-3">
                        {/* Subject */}
                        <div>
                            <label className="block text-[11px] sm:text-xs font-medium text-ink mb-1.5">
                                Subject line
                            </label>
                            <input
                                type="text"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder="e.g. DaySpring — new arrivals and delivery updates"
                                className="w-full border rounded-xl px-3 py-2 text-[13px] sm:text-sm outline-none focus:ring-2 ring-primary-300 bg-white"
                            />
                        </div>

                        {/* Body */}
                        <div>
                            <label className="block text-[11px] sm:text-xs font-medium text-ink mb-1.5">
                                Email body (HTML or plain text)
                            </label>
                            <textarea
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                rows={10}
                                className="w-full border rounded-xl px-3 py-2 text-[13px] sm:text-sm outline-none focus:ring-2 ring-primary-300 bg-white font-mono"
                                placeholder={`<p>Hi there,</p>
<p>...</p>`}
                            />
                            <p className="mt-1 text-[11px] sm:text-xs text-ink-soft">
                                You can paste simple HTML (paragraphs, lists, bold, links) or plain
                                text. This will be sent as-is to all subscribers, with an
                                <span className="font-medium"> unsubscribe link </span>
                                appended automatically.
                            </p>
                        </div>

                        {/* Controls row */}
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                            <div className="flex items-center gap-2">
                                <input
                                    id="dry-run"
                                    type="checkbox"
                                    checked={dryRun}
                                    onChange={(e) => setDryRun(e.target.checked)}
                                    className="h-4 w-4 rounded border-ink-soft"
                                />
                                <label
                                    htmlFor="dry-run"
                                    className="text-[12px] sm:text-sm text-ink"
                                >
                                    Dry run (don&apos;t actually send)
                                </label>
                            </div>

                            <div className="flex items-center gap-2">
                                <label
                                    htmlFor="limit"
                                    className="text-[11px] sm:text-xs text-ink-soft"
                                >
                                    Limit
                                </label>
                                <input
                                    id="limit"
                                    type="number"
                                    min={1}
                                    value={limit}
                                    onChange={(e) => setLimit(e.target.value)}
                                    className="w-24 border rounded-xl px-2 py-1.5 text-[12px] sm:text-sm outline-none bg-white"
                                    placeholder="All"
                                />
                                <span className="text-[10px] sm:text-xs text-ink-soft">
                                    Leave blank for all subscribers
                                </span>
                            </div>
                        </div>

                        {/* Info strip */}
                        <div className="flex items-start gap-2 rounded-xl bg-surface px-3 py-2 border border-[--color-surface-ring]">
                            <Info className="h-3.5 w-3.5 text-ink-soft mt-0.5" />
                            <p className="text-[11px] sm:text-xs text-ink-soft">
                                We recommend running a <span className="font-medium">dry run</span>{" "}
                                first to confirm the number of subscribers. When you&apos;re ready,
                                uncheck dry run and send for real.
                            </p>
                        </div>

                        {/* Last run summary */}
                        {lastResult && (
                            <div className="rounded-xl border border-dashed border-[--color-surface-ring] bg-surface px-3 py-2 text-[11px] sm:text-xs text-ink-soft">
                                <div className="font-medium text-ink mb-0.5">
                                    Last {lastResult.dryRun ? "dry run" : "send"} result
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-1">
                                    <span>
                                        Found{" "}
                                        <span className="font-semibold text-ink">
                                            {lastResult.totalFound.toLocaleString()}
                                        </span>{" "}
                                        active subscriber(s)
                                    </span>
                                    {!lastResult.dryRun && (
                                        <span>
                                            · Sent to{" "}
                                            <span className="font-semibold text-ink">
                                                {lastResult.totalSent.toLocaleString()}
                                            </span>
                                        </span>
                                    )}
                                    {lastResult.stoppedByLimit && (
                                        <span className="text-amber-700">
                                            · Stopped early by limit
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Recent runs history (last 3) */}
                        {history.length > 0 && (
                            <div className="rounded-xl border border-[--color-surface-ring] bg-surface px-3 py-2 text-[11px] sm:text-xs text-ink-soft">
                                <div className="font-medium text-ink mb-1">Recent runs</div>
                                <ul className="space-y-0.5">
                                    {history.map((h) => {
                                        const d = new Date(h.at);
                                        const label = d.toLocaleString(undefined, {
                                            month: "short",
                                            day: "2-digit",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        });
                                        return (
                                            <li key={h.at + h.subject} className="flex flex-wrap gap-x-2 gap-y-0.5">
                                                <span className="text-ink-soft">
                                                    {label} — {h.dryRun ? "Dry run" : "Send"}
                                                </span>
                                                <span>
                                                    • Found{" "}
                                                    <span className="font-semibold text-ink">
                                                        {h.totalFound.toLocaleString()}
                                                    </span>
                                                </span>
                                                {!h.dryRun && (
                                                    <span>
                                                        • Sent{" "}
                                                        <span className="font-semibold text-ink">
                                                            {h.totalSent.toLocaleString()}
                                                        </span>
                                                    </span>
                                                )}
                                                {h.stoppedByLimit && (
                                                    <span className="text-amber-700">• Limited</span>
                                                )}
                                                <span className="truncate max-w-full">
                                                    • <span className="italic">{h.subject}</span>
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}

                        {/* Submit button */}
                        <div className="flex justify-end">
                            <button
                                type="submit"
                                disabled={!isValid || mutation.isPending}
                                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] sm:text-sm font-medium text-white transition
                  ${!isValid || mutation.isPending
                                        ? "bg-zinc-400 cursor-not-allowed"
                                        : dryRun
                                            ? "bg-primary-600 hover:bg-primary-700"
                                            : "bg-emerald-600 hover:bg-emerald-700"
                                    }`}
                            >
                                {mutation.isPending && (
                                    <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                                )}
                                <Send className="h-4 w-4" />
                                <span>{loadingLabel}</span>
                            </button>
                        </div>
                    </form>
                </div>

                {/* Preview card */}
                <div className="rounded-2xl border border-[--color-surface-ring] bg-surface p-3.5 sm:p-4">
                    <h2 className="text-sm sm:text-base font-semibold text-ink mb-2 flex items-center gap-2">
                        <Mail className="h-4 w-4 text-primary-600" />
                        <span>Preview</span>
                    </h2>
                    {!showPreview ? (
                        <p className="text-[12px] sm:text-sm text-ink-soft">
                            Start typing a subject and body on the left to see a preview. This
                            preview is approximate — email clients may render it slightly
                            differently.
                        </p>
                    ) : (
                        <div className="bg-white rounded-xl border border-[--color-surface-ring] p-3 sm:p-4 text-[12px] sm:text-sm text-ink overflow-auto max-h-[480px]">
                            <div className="mb-3 border-b border-[--color-surface-ring] pb-2 text-[11px] text-ink-soft">
                                <div>
                                    <span className="font-semibold text-ink mr-1">From:</span>
                                    DaySpring &lt;no-reply@dayspring.com&gt;
                                </div>
                                <div>
                                    <span className="font-semibold text-ink mr-1">Subject:</span>
                                    {subject || "—"}
                                </div>
                            </div>
                            <div
                                className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5"
                                dangerouslySetInnerHTML={{
                                    __html: body || "<p>(Empty body)</p>",
                                }}
                            />
                            <hr className="my-3 border-[--color-surface-ring]" />
                            <p className="text-[10px] text-ink-soft">
                                Unsubscribe footer will be appended automatically for each
                                recipient.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}