// src/pages/admin/AdminApplicants.tsx
import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../../api/client";
import {
  Search,
  Filter,
  ChevronRight,
  ChevronLeft,
  FileText,
  Mail,
  User,
  MapPin,
  Clock,
  X,
  Edit3,
  CheckCircle2,
} from "lucide-react";

type JobApplicationStatus = "NEW" | "REVIEWED" | "SHORTLISTED" | "REJECTED";

type JobApplicationLite = {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  roleId: string | null;
  roleTitle: string | null;
  linkedinUrl?: string | null;
  cvFilename?: string | null;
  cvMimeType?: string | null;
  cvSize?: number | null;
  message: string;
  status: JobApplicationStatus;
  notes?: string | null;
};

type RoleSummary = {
  roleId: string | null;
  roleTitle: string | null;
  count: number;
};

type ListResponse = {
  items: JobApplicationLite[];
  nextCursor?: string | null;
  roleSummary: RoleSummary[];
};

const STATUS_LABEL: Record<JobApplicationStatus, string> = {
  NEW: "New",
  REVIEWED: "Reviewed",
  SHORTLISTED: "Shortlisted",
  REJECTED: "Rejected",
};

const STATUS_BADGE_CLASS: Record<JobApplicationStatus, string> = {
  NEW: "bg-amber-50 text-amber-800 border-amber-200",
  REVIEWED: "bg-slate-50 text-slate-800 border-slate-200",
  SHORTLISTED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  REJECTED: "bg-rose-50 text-rose-800 border-rose-200",
};

export default function AdminApplicants() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState<JobApplicationStatus | "ALL">("ALL");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<JobApplicationStatus | null>(null);
  const [localNotes, setLocalNotes] = useState<string>("");

  const { data, isLoading, isError, refetch, isFetching } = useQuery<ListResponse>({
    queryKey: ["admin-applicants", { statusFilter, roleFilter, search, cursor }],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter !== "ALL") params.status = statusFilter;
      if (roleFilter !== "ALL") params.roleId = roleFilter;
      if (search.trim()) params.search = search.trim();
      if (cursor) params.cursor = cursor;

      const { data } = await api.get<ListResponse>("/api/admin/careers/applications", {
        params,
      });
      return data;
    },
  });

  const items = data?.items ?? [];
  const roleSummary = data?.roleSummary ?? [];
  const nextCursor = data?.nextCursor ?? null;

  const selectedApp = useMemo(
    () => items.find((x) => x.id === selectedId) || null,
    [items, selectedId]
  );

  // When selecting an application, sync local status/notes
  const handleSelect = (id: string) => {
    const app = items.find((x) => x.id === id);
    setSelectedId(id);
    if (app) {
      setLocalStatus(app.status);
      setLocalNotes(app.notes ?? "");
    }
  };

  const clearSelection = () => {
    setSelectedId(null);
    setLocalStatus(null);
    setLocalNotes("");
  };

  const mutation = useMutation({
    mutationFn: async (payload: { id: string; status?: JobApplicationStatus; notes?: string }) => {
      const { id, ...rest } = payload;
      const { data } = await api.patch<{ ok: boolean; item: JobApplicationLite }>(
        `/api/admin/careers/applications/${id}`,
        rest
      );
      return data.item;
    },
    onSuccess: (updated) => {
      qc.setQueryData<ListResponse>(
        ["admin-applicants", { statusFilter, roleFilter, search, cursor }],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((x) => (x.id === updated.id ? updated : x)),
          };
        }
      );
    },
  });

  const handleSave = async () => {
    if (!selectedApp) return;
    const patch: { id: string; status?: JobApplicationStatus; notes?: string } = {
      id: selectedApp.id,
    };

    if (localStatus && localStatus !== selectedApp.status) {
      patch.status = localStatus;
    }
    if (localNotes !== (selectedApp.notes ?? "")) {
      patch.notes = localNotes;
    }

    if (!patch.status && typeof patch.notes === "undefined") {
      return;
    }

    await mutation.mutateAsync(patch);
  };

  const handleResetCursor = () => {
    setCursor(null);
    clearSelection();
  };

  const handleNextCursor = () => {
    if (nextCursor) {
      setCursor(nextCursor);
      clearSelection();
    }
  };

  // simple role options
  const roleOptions = useMemo(() => {
    const list = roleSummary.filter((r) => r.roleId || r.roleTitle);
    return list;
  }, [roleSummary]);

  const loadingLabel = isLoading || isFetching ? "Loading…" : "Applicants";

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-base sm:text-lg md:text-xl font-semibold text-ink">
              Job applicants
            </h1>
            <p className="text-[11px] sm:text-xs text-ink-soft">
              View and manage applications submitted via the DaySpring careers page.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => navigate("/admin")}
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-1.5 text-xs sm:text-[13px] text-ink hover:bg-black/5"
            >
              <ChevronLeft size={13} />
              Back to admin
            </button>
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-1.5 text-xs sm:text-[13px] text-ink hover:bg-black/5"
            >
              <Clock size={13} className={isFetching ? "animate-spin" : ""} />
              {isFetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col gap-4 sm:gap-6 lg:flex-row">
        {/* Left – list & filters */}
        <section className="flex-1 flex flex-col gap-3 sm:gap-4">
          {/* Filters */}
          <div className="rounded-2xl border bg-white shadow-sm p-3 sm:p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="inline-flex items-center gap-2 text-[11px] sm:text-xs text-ink-soft">
                <Filter size={14} className="text-ink-soft" />
                <span>{loadingLabel}</span>
                <span className="text-ink">
                  {items.length} shown
                  {cursor ? " (page)" : ""}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,1.1fr)] gap-2.5">
              {/* Search */}
              <div className="relative">
                <span className="absolute inset-y-0 left-2 flex items-center text-zinc-400">
                  <Search size={14} />
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setCursor(null);
                    clearSelection();
                  }}
                  placeholder="Search name, email or role…"
                  className="w-full rounded-xl border border-slate-300/80 bg-white pl-7 pr-2 py-1.5 text-[11px] sm:text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                />
              </div>

              {/* Role filter */}
              <div>
                <select
                  value={roleFilter}
                  onChange={(e) => {
                    setRoleFilter(e.target.value);
                    setCursor(null);
                    clearSelection();
                  }}
                  className="w-full rounded-xl border border-slate-300/80 bg-white px-2.5 py-1.5 text-[11px] sm:text-xs text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                >
                  <option value="ALL">All roles</option>
                  {roleOptions.map((r) => (
                    <option
                      key={`${r.roleId ?? "general"}-${r.roleTitle ?? "General"}`}
                      value={r.roleId ?? ""}
                    >
                      {r.roleTitle || "General application"} ({r.count})
                    </option>
                  ))}
                </select>
              </div>

              {/* Status filter */}
              <div className="flex gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as JobApplicationStatus | "ALL");
                    setCursor(null);
                    clearSelection();
                  }}
                  className="flex-1 rounded-xl border border-slate-300/80 bg-white px-2.5 py-1.5 text-[11px] sm:text-xs text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                >
                  <option value="ALL">All statuses</option>
                  <option value="NEW">New</option>
                  <option value="REVIEWED">Reviewed</option>
                  <option value="SHORTLISTED">Shortlisted</option>
                  <option value="REJECTED">Rejected</option>
                </select>
                {cursor && (
                  <button
                    type="button"
                    onClick={handleResetCursor}
                    className="inline-flex items-center justify-center rounded-xl border bg-white px-2.5 py-1.5 text-[10px] sm:text-[11px] text-ink hover:bg-black/5"
                  >
                    <ChevronLeft size={13} />
                    Reset page
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* List */}
          <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
            <div className="hidden md:grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.7fr)] gap-3 px-4 py-2 border-b bg-surface text-[11px] font-medium text-ink-soft">
              <span>Applicant</span>
              <span>Role</span>
              <span>Status</span>
              <span className="text-right">Applied</span>
            </div>

            {isLoading && (
              <div className="p-4 text-xs text-ink-soft">Loading applications…</div>
            )}

            {isError && !isLoading && (
              <div className="p-4 text-xs text-rose-700">
                Could not load applications. Please try again.
              </div>
            )}

            {!isLoading && items.length === 0 && !isError && (
              <div className="p-4 text-xs text-ink-soft">No applications found.</div>
            )}

            <div className="divide-y">
              {items.map((app) => {
                const isSelected = app.id === selectedId;
                const appliedAt = new Date(app.createdAt);
                const appliedLabel = appliedAt.toLocaleString();

                return (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => handleSelect(app.id)}
                    className={`w-full text-left px-3 sm:px-4 py-3 flex flex-col gap-1 md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.7fr)] md:gap-3 hover:bg-surface ${
                      isSelected ? "bg-surface/80" : ""
                    }`}
                  >
                    {/* Applicant */}
                    <div className="flex items-start gap-2">
                      <div className="mt-[2px] hidden sm:flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/90 text-white text-[11px] font-semibold">
                        {app.name
                          .split(" ")
                          .map((p) => p[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-medium text-ink truncate">{app.name}</span>
                          {app.status === "NEW" && (
                            <span className="ml-1 inline-flex items-center rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[9px] px-1.5 py-[1px]">
                              New
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-ink-soft">
                          <Mail size={11} className="text-zinc-400" />
                          <span className="truncate">{app.email}</span>
                        </div>
                      </div>
                    </div>

                    {/* Role */}
                    <div className="mt-1 md:mt-0">
                      <div className="text-[11px] text-ink truncate">
                        {app.roleTitle || "General application"}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-ink-soft">
                        <User size={11} className="text-zinc-400" />
                        <span>{app.roleId || "N/A"}</span>
                      </div>
                    </div>

                    {/* Status */}
                    <div className="mt-1 md:mt-0 flex items-center">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] ${STATUS_BADGE_CLASS[app.status]}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current/60" />
                        {STATUS_LABEL[app.status]}
                      </span>
                    </div>

                    {/* Applied at */}
                    <div className="mt-1 md:mt-0 flex items-center justify-between md:justify-end gap-2">
                      <span className="text-[10px] text-ink-soft text-right truncate">
                        {appliedLabel}
                      </span>
                      <ChevronRight
                        size={14}
                        className="text-zinc-400 hidden sm:inline-block"
                      />
                    </div>
                  </button>
                );
              })}
            </div>

            {nextCursor && items.length > 0 && (
              <div className="border-t px-3 sm:px-4 py-2.5 flex items-center justify-between text-[10px] sm:text-xs">
                <span className="text-ink-soft">More results available…</span>
                <button
                  type="button"
                  onClick={handleNextCursor}
                  className="inline-flex items-center gap-1 rounded-xl border bg-white px-2.5 py-1 text-[10px] sm:text-xs text-ink hover:bg-black/5"
                >
                  Next page
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Right – details panel */}
        <section className="w-full lg:w-[320px] xl:w-[360px] shrink-0">
          <div className="rounded-2xl border bg-white shadow-sm p-3 sm:p-4 h-full flex flex-col">
            {!selectedApp ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-[11px] sm:text-xs text-ink-soft gap-2">
                <Edit3 size={18} className="text-zinc-400" />
                <p>Select an applicant to view details.</p>
              </div>
            ) : (
              <>
                {(() => {
                  const effectiveStatus: JobApplicationStatus =
                    localStatus ?? selectedApp.status;

                  return (
                    <>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-sm sm:text-base font-semibold text-ink">
                              {selectedApp.name}
                            </h2>
                            <button
                              type="button"
                              onClick={clearSelection}
                              className="inline-flex items-center justify-center rounded-full border bg-surface px-1.5 py-1 text-[10px] text-ink-soft hover:bg-black/5"
                            >
                              <X size={12} />
                            </button>
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-ink-soft mt-0.5">
                            <Mail size={11} className="text-zinc-400" />
                            <span className="truncate">{selectedApp.email}</span>
                          </div>
                          {selectedApp.roleTitle && (
                            <div className="mt-1 text-[10px] text-ink-soft flex items-center gap-1">
                              <MapPin size={11} className="text-zinc-400" />
                              <span>
                                {selectedApp.roleTitle}{" "}
                                {selectedApp.roleId ? (
                                  <span className="text-zinc-400">
                                    ({selectedApp.roleId})
                                  </span>
                                ) : null}
                              </span>
                            </div>
                          )}
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] ${STATUS_BADGE_CLASS[effectiveStatus]}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current/60" />
                          {STATUS_LABEL[effectiveStatus]}
                        </span>
                      </div>

                      {/* Status + LinkedIn + CV */}
                      <div className="space-y-2 mb-3">
                        <div className="space-y-1">
                          <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                            Status
                          </label>
                          <select
                            value={effectiveStatus}
                            onChange={(e) =>
                              setLocalStatus(e.target.value as JobApplicationStatus)
                            }
                            className="w-full rounded-xl border border-slate-300/80 bg-white px-2.5 py-1.5 text-[11px] sm:text-xs text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                          >
                            <option value="NEW">New</option>
                            <option value="REVIEWED">Reviewed</option>
                            <option value="SHORTLISTED">Shortlisted</option>
                            <option value="REJECTED">Rejected</option>
                          </select>
                        </div>

                        {selectedApp.linkedinUrl && (
                          <div className="text-[10px] sm:text-[11px] text-ink-soft">
                            <span className="font-medium text-ink">LinkedIn: </span>
                            <a
                              href={selectedApp.linkedinUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              {selectedApp.linkedinUrl}
                            </a>
                          </div>
                        )}

                        <div className="text-[10px] sm:text-[11px] text-ink-soft flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <FileText size={12} className="text-zinc-400" />
                            {selectedApp.cvFilename ? (
                              <span>
                                CV attached:{" "}
                                <span className="font-medium text-ink">
                                  {selectedApp.cvFilename}
                                </span>
                                {selectedApp.cvSize != null && (
                                  <span className="text-zinc-400">
                                    {" "}
                                    ({Math.round(selectedApp.cvSize / 1024)} KB,{" "}
                                    {selectedApp.cvMimeType || "file"})
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span>No CV attached.</span>
                            )}
                          </div>

                          {selectedApp.cvFilename && (
                            <div className="flex items-center justify-between gap-2">
                              <a
                                href={`/api/admin/careers/applications/${selectedApp.id}/cv`}
                                target="_blank"
                                rel="noreferrer"
                                download={selectedApp.cvFilename || undefined}
                                className="inline-flex items-center gap-1 rounded-xl border bg-white px-2.5 py-1 text-[10px] sm:text-[11px] text-ink hover:bg-black/5"
                              >
                                <FileText size={12} />
                                Download CV
                              </a>
                              <span className="text-[9px] text-zinc-400">
                                The original file is also in the careers mailbox.
                              </span>
                            </div>
                          )}

                          {!selectedApp.cvFilename && (
                            <span className="text-[9px] text-zinc-400">
                              Check the careers mailbox for more context.
                            </span>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}

                {/* Message */}
                <div className="mb-3">
                  <label className="block text-[10px] sm:text-[11px] font-medium text-ink mb-1">
                    Application message
                  </label>
                  <div className="rounded-xl border border-slate-200 bg-surface px-2.5 py-2 text-[11px] sm:text-xs text-ink max-h-40 overflow-auto whitespace-pre-wrap">
                    {selectedApp.message}
                  </div>
                </div>

                {/* Notes */}
                <div className="flex-1 flex flex-col">
                  <label className="block text-[10px] sm:text-[11px] font-medium text-ink mb-1">
                    Internal notes
                  </label>
                  <textarea
                    value={localNotes}
                    onChange={(e) => setLocalNotes(e.target.value)}
                    rows={4}
                    className="flex-1 min-h-[80px] rounded-xl border border-slate-300/80 bg-white px-2.5 py-2 text-[11px] sm:text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm resize-y"
                    placeholder="Optional notes for HR/admin (not visible to the candidate)…"
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {mutation.isSuccess && (
                      <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] text-emerald-700">
                        <CheckCircle2 size={13} />
                        Saved
                      </span>
                    )}
                    {mutation.isError && (
                      <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] text-rose-700">
                        Failed to save. Try again.
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={mutation.isPending}
                      className="ml-auto inline-flex items-center gap-2 rounded-xl bg-primary-600 px-3 py-1.5 text-[11px] sm:text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-60"
                    >
                      {mutation.isPending ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}