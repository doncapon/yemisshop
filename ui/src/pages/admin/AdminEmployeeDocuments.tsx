// src/pages/admin/AdminEmployeeDocuments.tsx
import React, { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import {
  ArrowLeft,
  FileText,
  UploadCloud,
  Trash2,
  Clock,
  AlertCircle,
  CheckCircle2,
  X,
  Download,
} from "lucide-react";

type EmployeeDocumentKind =
  | "PASSPORT"
  | "NIN_SLIP"
  | "TAX"
  | "CONTRACT"
  | "OTHER";

type EmployeeDocumentLite = {
  id: string;
  createdAt: string;
  kind: EmployeeDocumentKind;
  storageKey: string;
  originalFilename: string;
  mimeType?: string | null;
  size?: number | null;
  url?: string | null;
};

type DocumentsResponse = {
  items: EmployeeDocumentLite[];
};

type UploadFile = {
  key?: string;
  storageKey?: string;
  url: string;
  absoluteUrl?: string;
  originalFilename?: string;
  mimeType?: string;
  size?: number;
};

type UploadResponse = {
  ok?: boolean;
  files?: UploadFile[];
  urls?: string[];
};

const KIND_LABEL: Record<EmployeeDocumentKind, string> = {
  PASSPORT: "Passport / ID page",
  NIN_SLIP: "NIN slip",
  TAX: "Tax / PAYE docs",
  CONTRACT: "Employment contract",
  OTHER: "Other document",
};

function formatBytes(size?: number | null): string {
  if (!size || size <= 0) return "—";
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

/**
 * Resolve a usable URL for a document.
 * - Prefer backend-provided doc.url if present.
 * - Otherwise derive from storageKey -> /uploads/<storageKey>
 *
 * storageKey is expected to be a relative path under UPLOADS_DIR,
 * e.g. "employees/123/docs/1730-file.pdf".
 */
function getDocUrl(doc: EmployeeDocumentLite | null): string | null {
  if (!doc) return null;

  // If backend already sent a URL, trust it
  if (doc.url) return doc.url;

  if (!doc.storageKey) return null;

  // Use encodeURI so folder separators (/) are preserved
  // If you ever mount uploads somewhere else, change the base here
  return `/uploads/${encodeURI(doc.storageKey)}`;
}

export default function AdminEmployeeDocuments() {
  const navigate = useNavigate();
  const { employeeId } = useParams<{ employeeId: string }>();
  const qc = useQueryClient();

  const [selectedKind, setSelectedKind] =
    useState<EmployeeDocumentKind>("PASSPORT");
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<EmployeeDocumentLite | null>(
    null
  );

  const queryKey = useMemo(
    () => ["admin-employee-docs", employeeId],
    [employeeId]
  );

  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<DocumentsResponse>({
    queryKey,
    queryFn: async () => {
      if (!employeeId) {
        throw new Error("Missing employee id");
      }
      const { data } = await api.get<DocumentsResponse>(
        `/api/admin/employees/${employeeId}/documents`
      );
      return data;
    },
    enabled: !!employeeId,
  });

  const items = data?.items ?? [];

  const uploadAndAttachMutation = useMutation({
    mutationFn: async (args: { kind: EmployeeDocumentKind; file: File }) => {
      if (!employeeId) throw new Error("Missing employee id");

      // Reset previous error
      setUploadError(null);

      // 1) upload file to /api/uploads
      const fd = new FormData();
      fd.append("file", args.file);
      // Optional folder hint for nicer FS layout
      fd.append("folder", `employees/${employeeId}/docs`);

      const uploadRes = await api.post<UploadResponse>("/api/uploads", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const uf = uploadRes.data.files?.[0];
      if (!uf) {
        throw new Error("Upload response missing file metadata");
      }

      const storageKey = uf.storageKey ?? uf.key;
      if (!storageKey) {
        throw new Error("Upload response missing storageKey");
      }

      const originalFilename =
        uf.originalFilename ?? args.file.name ?? "document";
      const mimeType = uf.mimeType ?? args.file.type ?? undefined;
      const size =
        typeof uf.size === "number" ? uf.size : args.file.size ?? undefined;

      // 2) create document record for this employee
      const { data } = await api.post<{
        ok: boolean;
        item: EmployeeDocumentLite;
      }>(`/api/admin/employees/${employeeId}/documents`, {
        kind: args.kind,
        storageKey,
        originalFilename,
        mimeType,
        size,
      });

      return data.item;
    },
    onSuccess: (created) => {
      qc.setQueryData<DocumentsResponse>(queryKey, (old) => {
        if (!old) return { items: [created] };
        return { items: [created, ...old.items] };
      });
      setFile(null);
    },
    onError: (err: any) => {
      setUploadError(
        err?.response?.data?.error ||
          err?.message ||
          "Could not upload document"
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => {
      if (!employeeId) throw new Error("Missing employee id");
      await api.delete(
        `/api/admin/employees/${employeeId}/documents/${docId}`
      );
      return docId;
    },
    onSuccess: (docId) => {
      qc.setQueryData<DocumentsResponse>(queryKey, (old) => {
        if (!old) return old;
        return {
          items: old.items.filter((d) => d.id !== docId),
        };
      });
      // If we're previewing this doc, close the preview
      setPreviewDoc((current) =>
        current && current.id === docId ? null : current
      );
    },
  });

  const handleUpload = () => {
    if (!file || !employeeId) return;
    uploadAndAttachMutation.mutate({ kind: selectedKind, file });
  };

  const handleDelete = (docId: string) => {
    if (!employeeId) return;
    const ok = window.confirm("Delete this document? This cannot be undone.");
    if (!ok) return;
    deleteMutation.mutate(docId);
  };

  if (!employeeId) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center">
        <div className="rounded-2xl border bg-white shadow-sm px-4 py-3 text-sm text-rose-700 flex items-center gap-2">
          <AlertCircle size={16} />
          Missing employee id in URL.
        </div>
      </div>
    );
  }

  const isImage = (doc: EmployeeDocumentLite | null) =>
    !!doc?.mimeType && doc.mimeType.startsWith("image/");

  const previewUrl = getDocUrl(previewDoc);

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/admin/employees")}
              className="inline-flex items-center justify-center rounded-full border bg-white px-2 py-1 text-[11px] sm:text-xs text-ink-soft hover:bg-black/5"
            >
              <ArrowLeft size={14} className="mr-1" />
              Back
            </button>
            <div>
              <h1 className="text-base sm:text-lg md:text-xl font-semibold text-ink">
                Employee documents
              </h1>
              <p className="text-[11px] sm:text-xs text-ink-soft">
                Upload and manage HR documents for this employee (passport,
                NIN, tax, contracts…).
              </p>
              <p className="text-[10px] text-ink-soft mt-0.5">
                Employee ID:{" "}
                <span className="font-mono text-[10px] text-ink">
                  {employeeId}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => refetch()}
            className="self-start sm:self-auto inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-1.5 text-xs sm:text-[13px] text-ink hover:bg-black/5"
          >
            <Clock size={13} className={isFetching ? "animate-spin" : ""} />
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col gap-4 lg:flex-row">
        {/* Left – upload form */}
        <section className="w-full lg:w-[280px] xl:w-[320px] shrink-0">
          <div className="rounded-2xl border bg-white shadow-sm p-3 sm:p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <UploadCloud size={18} className="text-ink-soft" />
              <h2 className="text-sm font-semibold text-ink">
                Upload new document
              </h2>
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                Document type
              </label>
              <select
                value={selectedKind}
                onChange={(e) =>
                  setSelectedKind(e.target.value as EmployeeDocumentKind)
                }
                className="w-full rounded-xl border border-slate-300/80 bg-white px-2.5 py-1.5 text-[11px] sm:text-xs text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
              >
                <option value="PASSPORT">Passport / ID page</option>
                <option value="NIN_SLIP">NIN slip</option>
                <option value="TAX">Tax / PAYE docs</option>
                <option value="CONTRACT">Employment contract</option>
                <option value="OTHER">Other document</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] sm:text-[11px] font-medium text-ink">
                File
              </label>
              <div className="rounded-xl border border-dashed border-slate-300/80 bg-surface px-3 py-3 flex flex-col gap-2 items-start">
                <input
                  type="file"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFile(f);
                    setUploadError(null);
                  }}
                  className="block text-[11px] sm:text-xs text-ink"
                />
                <p className="text-[10px] sm:text-[11px] text-ink-soft">
                  PDF, image or other HR documents. Keep sensitive files
                  encrypted at rest on the server.
                </p>
                {file && (
                  <div className="mt-1 text-[10px] sm:text-[11px] text-ink-soft">
                    <span className="font-medium text-ink">
                      Selected: {file.name}
                    </span>{" "}
                    ({formatBytes(file.size)})
                  </div>
                )}
              </div>
            </div>

            {uploadError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 flex items-start gap-2 text-[10px] sm:text-[11px] text-rose-700">
                <AlertCircle size={14} className="mt-[1px]" />
                <p>{uploadError}</p>
              </div>
            )}

            {uploadAndAttachMutation.isSuccess && !uploadError && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 flex items-start gap-2 text-[10px] sm:text-[11px] text-emerald-700">
                <CheckCircle2 size={14} className="mt-[1px]" />
                <p>Document uploaded.</p>
              </div>
            )}

            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || uploadAndAttachMutation.isPending}
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-3 py-1.75 text-[11px] sm:text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {uploadAndAttachMutation.isPending ? "Uploading…" : "Upload file"}
            </button>
          </div>
        </section>

        {/* Right – documents list */}
        <section className="flex-1 flex flex-col">
          <div className="rounded-2xl border bg-white shadow-sm flex-1 flex flex-col overflow-hidden">
            <div className="border-b px-3 sm:px-4 py-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[11px] sm:text-xs text-ink-soft">
                <FileText size={14} className="text-ink-soft" />
                <span>Documents</span>
                <span className="text-ink">
                  {items.length} file{items.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            {isLoading && (
              <div className="p-4 text-xs text-ink-soft">
                Loading documents…
              </div>
            )}

            {isError && !isLoading && (
              <div className="p-4 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle size={14} />
                Could not load documents. Please try again.
              </div>
            )}

            {!isLoading && items.length === 0 && !isError && (
              <div className="p-4 text-xs text-ink-soft">
                No documents uploaded for this employee yet.
              </div>
            )}

            {items.length > 0 && (
              <div className="divide-y max-h-[520px] overflow-auto">
                {items.map((doc) => {
                  const url = getDocUrl(doc);

                  return (
                    <div
                      key={doc.id}
                      className="px-3 sm:px-4 py-2.5 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <div className="mt-[2px] flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/90 text-white text-[10px] font-semibold">
                          {doc.kind === "PASSPORT"
                            ? "PP"
                            : doc.kind === "NIN_SLIP"
                            ? "NIN"
                            : doc.kind === "TAX"
                            ? "TAX"
                            : doc.kind === "CONTRACT"
                            ? "CTR"
                            : "DOC"}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 text-[11px] sm:text-xs text-ink truncate">
                            <span className="font-medium truncate">
                              {doc.originalFilename}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1 text-[10px] text-ink-soft">
                            <span className="inline-flex items-center rounded-full bg-slate-50 border border-slate-200 px-1.5 py-[1px]">
                              {KIND_LABEL[doc.kind]}
                            </span>
                            <span>•</span>
                            <span>{formatBytes(doc.size ?? undefined)}</span>
                            <span>•</span>
                            <span>{formatDateTime(doc.createdAt)}</span>
                            {doc.mimeType && (
                              <>
                                <span>•</span>
                                <span>{doc.mimeType}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-1 sm:mt-0">
                        {url && (
                          <>
                            <button
                              type="button"
                              onClick={() => setPreviewDoc(doc)}
                              className="inline-flex items-center justify-center rounded-xl border bg-white px-2.5 py-1 text-[10px] sm:text-[11px] text-ink hover:bg-black/5"
                            >
                              View
                            </button>
                            <a
                              href={url}
                              download={doc.originalFilename || "document"}
                              className="inline-flex items-center justify-center rounded-xl border bg-white px-2.5 py-1 text-[10px] sm:text-[11px] text-ink hover:bg-black/5"
                            >
                              <Download size={13} className="mr-1" />
                              Download
                            </a>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(doc.id)}
                          disabled={deleteMutation.isPending}
                          className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] sm:text-[11px] text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                        >
                          <Trash2 size={13} className="mr-1" />
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Fullscreen preview overlay */}
      {previewDoc && previewUrl && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="relative w-[96vw] h-[90vh] max-w-5xl bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b bg-white/90 backdrop-blur">
              <div className="flex items-center gap-2 min-w-0">
                <FileText size={16} className="text-ink-soft" />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-ink truncate">
                    {previewDoc.originalFilename}
                  </div>
                  <div className="text-[10px] text-ink-soft truncate">
                    {KIND_LABEL[previewDoc.kind]} •{" "}
                    {formatBytes(previewDoc.size ?? undefined)}{" "}
                    {previewDoc.mimeType ? `• ${previewDoc.mimeType}` : null}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewUrl}
                  download={previewDoc.originalFilename || "document"}
                  className="inline-flex items-center justify-center rounded-xl border bg-white px-2.5 py-1 text-[10px] sm:text-[11px] text-ink hover:bg-black/5"
                >
                  <Download size={13} className="mr-1" />
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="inline-flex items-center justify-center rounded-xl border bg-white px-2 py-1 text-[10px] sm:text-[11px] text-ink hover:bg-black/5"
                >
                  <X size={13} className="mr-1" />
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 bg-slate-50">
              {isImage(previewDoc) ? (
                <div className="w-full h-full flex items-center justify-center bg-slate-900">
                  <img
                    src={previewUrl}
                    alt={previewDoc.originalFilename}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              ) : (
                <iframe
                  src={previewUrl}
                  title={previewDoc.originalFilename}
                  className="w-full h-full border-0"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}