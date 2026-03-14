// web/src/pages/admin/SettingsAdminPage.tsx
import { useEffect, useMemo, useState } from "react";
import api from "../../api/client.js";
import SiteLayout from "../../layouts/SiteLayout.js";

type Setting = {
  id: string;
  key: string;
  value: string;
  isPublic?: boolean | null;
  meta?: any | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type ValueType = "text" | "select";

type PayoutSchedulerCardState = {
  enabled: boolean;
  intervalHours: 3 | 4 | 6 | 8 | 12 | 24;
  timezone: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunSummary: {
    scanned?: number;
    released?: number;
    skipped?: number;
    failed?: number;
    details?: Array<{
      allocationId: string;
      purchaseOrderId: string | null;
      action: "released" | "skipped" | "failed";
      reason?: string;
    }>;
  } | null;
  lastRunError: string | null;
};

const KNOWN_KEY_OPTIONS: Record<string, string[]> = {
  taxMode: ["INCLUDED", "ADDED", "NONE"],
  shippingEnabled: ["true", "false"],
  shippingMode: ["DELIVERY", "PICKUP_ONLY"],

  payoutReleaseSchedulerEnabled: ["true", "false"],
  payoutReleaseIntervalHours: ["3", "4", "6", "8", "12", "24"],
  payoutReleaseSchedulerTimezone: ["UTC", "Europe/London"],
};

const SCHEDULER_INTERVAL_OPTIONS = [
  { value: 3, label: "Every 3 hours" },
  { value: 4, label: "Every 4 hours" },
  { value: 6, label: "Every 6 hours" },
  { value: 8, label: "Every 8 hours" },
  { value: 12, label: "Every 12 hours" },
  { value: 24, label: "Once daily" },
] as const;

const SCHEDULER_TIMEZONE_OPTIONS = ["UTC", "Europe/London"];

export default function SettingsAdminPage() {
  const [rows, setRows] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [schedulerLoading, setSchedulerLoading] = useState(true);
  const [schedulerSaving, setSchedulerSaving] = useState(false);
  const [schedulerRunningNow, setSchedulerRunningNow] = useState(false);
  const [scheduler, setScheduler] = useState<PayoutSchedulerCardState>({
    enabled: true,
    intervalHours: 6,
    timezone: "UTC",
    lastRunAt: null,
    lastRunStatus: null,
    lastRunSummary: null,
    lastRunError: null,
  });

  const [q, setQ] = useState("");

  const [creating, setCreating] = useState<{
    key: string;
    value: string;
    isPublic: boolean;
    meta: string;
    valueType: ValueType;
    optionsText: string;
  }>({
    key: "",
    value: "",
    isPublic: false,
    meta: "",
    valueType: "text",
    optionsText: "",
  });

  async function loadSettingsList() {
    const res = await api.get<Setting[]>("/api/settings");
    setRows(res.data);
  }

  async function loadSchedulerCard() {
    const res = await api.get<PayoutSchedulerCardState>("/api/settings/payout-release-scheduler");
    setScheduler(res.data);
  }

  async function loadAll() {
    try {
      setLoading(true);
      setSchedulerLoading(true);
      await Promise.all([loadSettingsList(), loadSchedulerCard()]);
      setErr(null);
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || "Failed to load settings");
    } finally {
      setLoading(false);
      setSchedulerLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    const key = creating.key.trim();
    const presets = KNOWN_KEY_OPTIONS[key];

    if (Array.isArray(presets) && presets.length) {
      setCreating((s) => {
        const optionsText = presets.join(",");
        const currentIsValid = presets.includes(s.value);
        return {
          ...s,
          valueType: s.valueType === "text" ? "select" : s.valueType,
          optionsText,
          value: currentIsValid ? s.value : presets[0],
        };
      });
    }
  }, [creating.key]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) => r.key.toLowerCase().includes(s) || (r.value || "").toLowerCase().includes(s)
    );
  }, [rows, q]);

  const optionsArray = useMemo(() => {
    if (creating.valueType !== "select") return [];
    return (creating.optionsText || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }, [creating.valueType, creating.optionsText]);

  function safeParseJSON(s: string) {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!creating.key) return;

    try {
      let meta: any = creating.meta ? safeParseJSON(creating.meta) : null;

      if (creating.valueType === "select") {
        const opts = optionsArray;
        if (opts.length) {
          meta = { ...(meta && typeof meta === "object" ? meta : {}), options: opts };
          if (!opts.includes(creating.value)) {
            throw new Error("Selected value must be one of the provided options.");
          }
        }
      }

      const res = await api.post<Setting>("/api/settings", {
        key: creating.key.trim(),
        value: creating.value,
        isPublic: creating.isPublic,
        meta,
      });

      setRows((prev) => [res.data, ...prev]);
      setCreating({
        key: "",
        value: "",
        isPublic: false,
        meta: "",
        valueType: "text",
        optionsText: "",
      });
      setErr(null);

      if (
        ["payoutReleaseSchedulerEnabled", "payoutReleaseIntervalHours", "payoutReleaseSchedulerTimezone"].includes(
          res.data.key
        )
      ) {
        await loadSchedulerCard();
      }
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || "Create failed");
    }
  }

  async function updateRow(
    row: Setting,
    patch: Partial<Pick<Setting, "value" | "isPublic" | "meta">>
  ) {
    try {
      if (!row.updatedAt) {
        const res = await api.patch<Setting>(`/api/settings/${row.id}`, patch);
        setRows((prev) => prev.map((r) => (r.id === row.id ? res.data : r)));
        setErr(null);
        return;
      }

      const res = await api.patch<Setting>(`/api/settings/${row.id}`, {
        ...patch,
        expectedUpdatedAt: row.updatedAt,
      });

      setRows((prev) => prev.map((r) => (r.id === row.id ? res.data : r)));
      setErr(null);

      if (
        ["payoutReleaseSchedulerEnabled", "payoutReleaseIntervalHours", "payoutReleaseSchedulerTimezone"].includes(
          row.key
        )
      ) {
        await loadSchedulerCard();
      }
    } catch (e: any) {
      if (e?.response?.status === 409) {
        const msg =
          e?.response?.data?.error ||
          "This setting was updated by someone else. Your change was not saved.";
        const current: Setting | undefined = e?.response?.data?.current;

        setErr(msg);

        if (current?.id) {
          setRows((prev) => prev.map((r) => (r.id === current.id ? current : r)));
        }
        return;
      }

      setErr(e?.response?.data?.error || e?.message || "Update failed");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete setting?")) return;
    try {
      await api.delete<void>(`/api/settings/${id}`);
      const deleted = rows.find((r) => r.id === id);
      setRows((prev) => prev.filter((r) => r.id !== id));

      if (
        deleted &&
        ["payoutReleaseSchedulerEnabled", "payoutReleaseIntervalHours", "payoutReleaseSchedulerTimezone"].includes(
          deleted.key
        )
      ) {
        await loadSchedulerCard();
      }
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || "Delete failed");
    }
  }

  async function saveSchedulerCard() {
    try {
      setSchedulerSaving(true);
      await api.post("/api/settings/payout-release-scheduler", {
        enabled: scheduler.enabled,
        intervalHours: scheduler.intervalHours,
        timezone: scheduler.timezone,
      });
      await Promise.all([loadSchedulerCard(), loadSettingsList()]);
      setErr(null);
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || "Failed to save payout release scheduler");
    } finally {
      setSchedulerSaving(false);
    }
  }

  async function runSchedulerNow() {
    if (!confirm("Run payout release now?")) return;

    try {
      setSchedulerRunningNow(true);
      await api.post("/api/settings/payout-release-scheduler/run-now");
      await Promise.all([loadSchedulerCard(), loadSettingsList()]);
      setErr(null);
    } catch (e: any) {
      setErr(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          e?.message ||
          "Failed to run payout release now"
      );
    } finally {
      setSchedulerRunningNow(false);
    }
  }

  const summary = scheduler.lastRunSummary;

  return (
    <SiteLayout>
      <div className="min-h-[calc(100vh-64px)] bg-zinc-50">
        <div className="p-6 max-w-5xl mx-auto">
          <h1 className="text-2xl font-semibold mb-4 text-zinc-900">Settings</h1>

          {err && (
            <div className="bg-white border border-zinc-200 text-zinc-800 px-3 py-2 rounded-lg mb-4">
              {err}
            </div>
          )}

          {/* Dedicated payout scheduler card */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-5 mb-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">Payout Release Scheduler</h2>
                <p className="text-sm text-zinc-600 mt-1">
                  Control how often held supplier payouts are checked and released.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg border border-zinc-200 text-zinc-900 disabled:opacity-50"
                  onClick={runSchedulerNow}
                  disabled={schedulerLoading || schedulerRunningNow}
                >
                  {schedulerRunningNow ? "Running…" : "Run now"}
                </button>

                <button
                  type="button"
                  className="px-4 py-2 rounded-lg bg-zinc-900 text-white disabled:opacity-50"
                  onClick={saveSchedulerCard}
                  disabled={schedulerLoading || schedulerSaving}
                >
                  {schedulerSaving ? "Saving…" : "Save scheduler"}
                </button>
              </div>
            </div>

            {schedulerLoading ? (
              <div className="text-sm text-zinc-600">Loading scheduler…</div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                  <label className="block">
                    <div className="text-sm font-medium text-zinc-700 mb-1">Enabled</div>
                    <select
                      className="border border-zinc-200 rounded-lg px-3 py-2 bg-white text-zinc-900 w-full focus:outline-none focus:ring-2 focus:ring-zinc-200"
                      value={scheduler.enabled ? "true" : "false"}
                      onChange={(e) =>
                        setScheduler((s) => ({
                          ...s,
                          enabled: e.target.value === "true",
                        }))
                      }
                    >
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </label>

                  <label className="block">
                    <div className="text-sm font-medium text-zinc-700 mb-1">Frequency</div>
                    <select
                      className="border border-zinc-200 rounded-lg px-3 py-2 bg-white text-zinc-900 w-full focus:outline-none focus:ring-2 focus:ring-zinc-200"
                      value={String(scheduler.intervalHours)}
                      onChange={(e) =>
                        setScheduler((s) => ({
                          ...s,
                          intervalHours: Number(e.target.value) as 3 | 4 | 6 | 8 | 12 | 24,
                        }))
                      }
                    >
                      {SCHEDULER_INTERVAL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={String(opt.value)}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <div className="text-sm font-medium text-zinc-700 mb-1">Timezone</div>
                    <select
                      className="border border-zinc-200 rounded-lg px-3 py-2 bg-white text-zinc-900 w-full focus:outline-none focus:ring-2 focus:ring-zinc-200"
                      value={scheduler.timezone}
                      onChange={(e) =>
                        setScheduler((s) => ({
                          ...s,
                          timezone: e.target.value,
                        }))
                      }
                    >
                      {SCHEDULER_TIMEZONE_OPTIONS.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                  <InfoTile
                    label="Status"
                    value={scheduler.lastRunStatus || "—"}
                  />
                  <InfoTile
                    label="Last run"
                    value={scheduler.lastRunAt ? new Date(scheduler.lastRunAt).toLocaleString() : "—"}
                  />
                  <InfoTile
                    label="Released"
                    value={String(summary?.released ?? 0)}
                  />
                  <InfoTile
                    label="Skipped / Failed"
                    value={`${summary?.skipped ?? 0} / ${summary?.failed ?? 0}`}
                  />
                </div>

                {summary && (
                  <div className="rounded-xl border border-zinc-200 p-4 bg-zinc-50 mb-4">
                    <div className="text-sm font-medium text-zinc-800 mb-2">Last run summary</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-zinc-700">
                      <div>Scanned: <span className="font-semibold">{summary.scanned ?? 0}</span></div>
                      <div>Released: <span className="font-semibold">{summary.released ?? 0}</span></div>
                      <div>Skipped: <span className="font-semibold">{summary.skipped ?? 0}</span></div>
                      <div>Failed: <span className="font-semibold">{summary.failed ?? 0}</span></div>
                    </div>

                    {!!summary.details?.length && (
                      <div className="mt-3 overflow-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-zinc-600">
                              <th className="text-left py-2 pr-3">Allocation</th>
                              <th className="text-left py-2 pr-3">PO</th>
                              <th className="text-left py-2 pr-3">Action</th>
                              <th className="text-left py-2">Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {summary.details.slice(0, 10).map((d, idx) => (
                              <tr key={`${d.allocationId}-${idx}`} className="border-t border-zinc-200">
                                <td className="py-2 pr-3 font-mono text-xs text-zinc-800 break-all">
                                  {d.allocationId}
                                </td>
                                <td className="py-2 pr-3 font-mono text-xs text-zinc-700 break-all">
                                  {d.purchaseOrderId || "—"}
                                </td>
                                <td className="py-2 pr-3 text-zinc-800">
                                  {d.action}
                                </td>
                                <td className="py-2 text-zinc-600 break-all">
                                  {d.reason || "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {!!scheduler.lastRunError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    <div className="font-medium mb-1">Last error</div>
                    <div className="break-all">{scheduler.lastRunError}</div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              className="border border-zinc-200 rounded-lg px-3 py-2 bg-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
              placeholder="Search key/value…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {/* Create new */}
          <form
            onSubmit={create}
            className="bg-white border border-zinc-200 rounded-2xl p-4 mb-6 space-y-3 shadow-sm"
          >
            <div className="font-medium text-zinc-900">Create setting</div>

            <div className="grid md:grid-cols-2 gap-3">
              <input
                className="border border-zinc-200 rounded-lg px-3 py-2 bg-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                placeholder="key (e.g. taxMode)"
                value={creating.key}
                onChange={(e) => setCreating((s) => ({ ...s, key: e.target.value }))}
                required
              />

              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="radio"
                    name="valueType"
                    checked={creating.valueType === "text"}
                    onChange={() => setCreating((s) => ({ ...s, valueType: "text" }))}
                  />
                  Text
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="radio"
                    name="valueType"
                    checked={creating.valueType === "select"}
                    onChange={() =>
                      setCreating((s) => {
                        const key = s.key.trim();
                        const presets = KNOWN_KEY_OPTIONS[key];
                        const optionsText = presets?.length ? presets.join(",") : s.optionsText || "";
                        const first = presets?.[0] || s.value || "";
                        return {
                          ...s,
                          valueType: "select",
                          optionsText,
                          value: s.value || first,
                        };
                      })
                    }
                  />
                  Select
                </label>
              </div>
            </div>

            {creating.valueType === "text" ? (
              <div className="grid md:grid-cols-2 gap-3">
                <input
                  className="border border-zinc-200 rounded-lg px-3 py-2 bg-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                  placeholder="value (string)"
                  value={creating.value}
                  onChange={(e) => setCreating((s) => ({ ...s, value: e.target.value }))}
                  required
                />
                <label className="flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="checkbox"
                    checked={creating.isPublic}
                    onChange={(e) => setCreating((s) => ({ ...s, isPublic: e.target.checked }))}
                  />
                  Public (readable without admin)
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid md:grid-cols-2 gap-3">
                  <input
                    className="border border-zinc-200 rounded-lg px-3 py-2 bg-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                    placeholder="Options (comma-separated), e.g. INCLUDED,ADDED,NONE"
                    value={creating.optionsText}
                    onChange={(e) =>
                      setCreating((s) => ({
                        ...s,
                        optionsText: e.target.value,
                      }))
                    }
                  />

                  <label className="flex items-center gap-2 text-sm text-zinc-700">
                    <input
                      type="checkbox"
                      checked={creating.isPublic}
                      onChange={(e) => setCreating((s) => ({ ...s, isPublic: e.target.checked }))}
                    />
                    Public (readable without admin)
                  </label>
                </div>

                <div className="grid md:grid-cols-2 gap-3 items-center">
                  <div className="text-sm text-zinc-600">Preview/select a value:</div>
                  <select
                    className="border border-zinc-200 rounded-lg px-3 py-2 bg-white text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                    value={creating.value}
                    onChange={(e) => setCreating((s) => ({ ...s, value: e.target.value }))}
                    required
                  >
                    <option value="" disabled>
                      {optionsArray.length ? "Select…" : "Add options above…"}
                    </option>
                    {optionsArray.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <input
              className="border border-zinc-200 rounded-lg px-3 py-2 w-full bg-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
              placeholder='meta (JSON, e.g. {"help":"shown in UI"})'
              value={creating.meta}
              onChange={(e) => setCreating((s) => ({ ...s, meta: e.target.value }))}
            />

            <div>
              <button
                type="submit"
                className="bg-zinc-900 text-white px-4 py-2 rounded-lg disabled:opacity-50"
                disabled={
                  !creating.key ||
                  !creating.value ||
                  (creating.valueType === "select" && optionsArray.length === 0)
                }
              >
                + Create
              </button>
            </div>
          </form>

          {/* List */}
          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50">
                <tr className="text-zinc-700">
                  <th className="text-left p-3 w-[28%]">Key</th>
                  <th className="text-left p-3 w-[36%]">Value</th>
                  <th className="text-left p-3 w-[16%]">Public</th>
                  <th className="text-left p-3 w-[12%]">Updated</th>
                  <th className="text-right p-3 w-[8%]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-zinc-600">
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-zinc-600">
                      No settings found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.id} className="border-t border-zinc-100">
                      <td className="p-3 font-mono text-xs md:text-sm break-all text-zinc-900">
                        {r.key}
                      </td>
                      <td className="p-3">
                        <InlineText
                          value={r.value}
                          updatedAt={r.updatedAt || null}
                          onSave={(v) => updateRow(r, { value: v })}
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={!!r.isPublic}
                          onChange={(e) => updateRow(r, { isPublic: e.target.checked })}
                        />
                      </td>
                      <td className="p-3 text-zinc-500">
                        {r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "—"}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          className="text-zinc-700 hover:text-zinc-900 hover:underline"
                          onClick={() => remove(r.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-3 bg-zinc-50">
      <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">{label}</div>
      <div className="text-sm font-semibold text-zinc-900 break-words">{value}</div>
    </div>
  );
}

function InlineText({
  value,
  updatedAt,
  onSave,
}: {
  value: string;
  updatedAt: string | null;
  onSave: (v: string) => Promise<void> | void;
}) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);

  useEffect(() => setV(value), [value]);

  return (
    <div className="flex gap-2 items-center">
      <input
        className="border border-zinc-200 rounded-lg px-2 py-1 w-full bg-white text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-200"
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <button
        className="px-2 py-1 border border-zinc-200 rounded-lg text-xs text-zinc-900 disabled:opacity-50"
        disabled={busy || v === value || !updatedAt}
        title={!updatedAt ? "Row has no updatedAt; refresh the page." : undefined}
        onClick={async () => {
          try {
            setBusy(true);
            await onSave(v);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save
      </button>
    </div>
  );
}