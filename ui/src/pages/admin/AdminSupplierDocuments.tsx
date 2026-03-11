// src/pages/admin/AdminSupplierDocuments.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    AlertTriangle,
    BadgeCheck,
    CheckCircle2,
    Clock3,
    Download,
    ExternalLink,
    Eye,
    FileBadge2,
    FileText,
    IdCard,
    Landmark,
    Loader2,
    RefreshCcw,
    Search,
    ShieldCheck,
    X,
    XCircle,
} from "lucide-react";
import api from "../../api/client";
import SiteLayout from "../../layouts/SiteLayout";

type SupplierDocumentKind =
    | "BUSINESS_REGISTRATION_CERTIFICATE"
    | "GOVERNMENT_ID"
    | "PROOF_OF_ADDRESS"
    | "TAX_DOCUMENT"
    | "BANK_PROOF"
    | "OTHER";

type SupplierDocStatus = "PENDING" | "APPROVED" | "REJECTED";
type SummaryStatus = SupplierDocStatus | "MISSING";

type SupplierSummaryRow = {
    id: string;
    businessName?: string | null;
    registrationType?: string | null;
    registrationCountryCode?: string | null;
    status?: string | null;
    kycStatus?: string | null;
    createdAt?: string | null;
    user?: {
        id?: string | null;
        email?: string | null;
        firstName?: string | null;
        lastName?: string | null;
    } | null;
    requiredKinds: SupplierDocumentKind[];
    approvedCount: number;
    pendingCount: number;
    rejectedCount: number;
    missingCount: number;
    readyForApproval: boolean;
    summary: Array<{
        kind: SupplierDocumentKind;
        present: boolean;
        status: SummaryStatus;
        documentId?: string | null;
        uploadedAt?: string | null;
    }>;
};

type SupplierDocument = {
    id: string;
    supplierId: string;
    kind: SupplierDocumentKind;
    storageKey: string;
    originalFilename: string;
    mimeType?: string | null;
    size?: number | null;
    status?: SupplierDocStatus | null;
    note?: string | null;
    uploadedAt?: string | null;
    reviewedAt?: string | null;
    url?: string | null;
};

type SupplierDetail = {
    id: string;
    businessName?: string | null;
    registrationType?: string | null;
    registrationCountryCode?: string | null;
    status?: string | null;
    kycStatus?: string | null;
    requiredKinds: SupplierDocumentKind[];
    allRequiredApproved?: boolean;
    readyForApproval?: boolean;
    user?: {
        id?: string | null;
        email?: string | null;
        firstName?: string | null;
        lastName?: string | null;
    } | null;
    documents: SupplierDocument[];
};

const DOC_LABELS: Record<SupplierDocumentKind, string> = {
    BUSINESS_REGISTRATION_CERTIFICATE: "Business registration / RC proof",
    GOVERNMENT_ID: "Government ID / NIN",
    PROOF_OF_ADDRESS: "Proof of address",
    TAX_DOCUMENT: "Tax document",
    BANK_PROOF: "Bank proof",
    OTHER: "Other document",
};

function docIcon(kind: SupplierDocumentKind) {
    if (kind === "GOVERNMENT_ID") return <IdCard className="h-4 w-4 text-zinc-700" />;
    if (kind === "PROOF_OF_ADDRESS") return <Landmark className="h-4 w-4 text-zinc-700" />;
    if (kind === "BUSINESS_REGISTRATION_CERTIFICATE") {
        return <FileBadge2 className="h-4 w-4 text-zinc-700" />;
    }
    return <FileText className="h-4 w-4 text-zinc-700" />;
}

function humanFileSize(size?: number | null) {
    if (!size || size <= 0) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let value = size;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
        value /= 1024;
        idx += 1;
    }
    return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function statusChip(status?: string | null) {
    const s = String(status || "").toUpperCase();

    if (s === "APPROVED" || s === "ACTIVE" || s === "VERIFIED" || s === "COMPLETED") {
        return "bg-emerald-100 text-emerald-700 border border-emerald-200";
    }
    if (s === "REJECTED") return "bg-rose-100 text-rose-700 border border-rose-200";
    if (s === "PENDING") return "bg-amber-100 text-amber-700 border border-amber-200";
    if (s === "MISSING") return "bg-zinc-100 text-zinc-700 border border-zinc-200";
    return "bg-zinc-100 text-zinc-700 border border-zinc-200";
}

function latestDocsByKind(docs: SupplierDocument[]) {
    const map = new Map<SupplierDocumentKind, SupplierDocument>();
    for (const doc of [...docs].sort((a, b) => {
        return new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime();
    })) {
        if (!map.has(doc.kind)) map.set(doc.kind, doc);
    }
    return map;
}

function buildDocumentUrl(doc?: SupplierDocument | null) {
    if (!doc) return null;

    const explicitUrl = String(doc.url || "").trim();
    if (explicitUrl) {
        if (/^https?:\/\//i.test(explicitUrl)) return explicitUrl;
        if (explicitUrl.startsWith("/")) return explicitUrl;
    }

    const storageKey = String(doc.storageKey || "").trim();
    if (!storageKey) return null;

    return `/uploads/${encodeURI(storageKey.replace(/\\/g, "/"))}`;
}

function getFileExtension(name?: string | null) {
    const raw = String(name || "").trim().toLowerCase();
    const idx = raw.lastIndexOf(".");
    return idx >= 0 ? raw.slice(idx + 1) : "";
}

function isImageDocument(doc?: SupplierDocument | null) {
    const mime = String(doc?.mimeType || "").toLowerCase();
    const ext = getFileExtension(doc?.originalFilename);
    return (
        mime.startsWith("image/") ||
        ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(ext)
    );
}

function isPdfDocument(doc?: SupplierDocument | null) {
    const mime = String(doc?.mimeType || "").toLowerCase();
    const ext = getFileExtension(doc?.originalFilename);
    return mime === "application/pdf" || ext === "pdf";
}

function isTextLikeDocument(doc?: SupplierDocument | null) {
    const mime = String(doc?.mimeType || "").toLowerCase();
    const ext = getFileExtension(doc?.originalFilename);
    return mime.startsWith("text/") || ["txt", "json", "csv", "log", "xml"].includes(ext);
}

function canInlinePreview(doc?: SupplierDocument | null) {
    return isImageDocument(doc) || isPdfDocument(doc) || isTextLikeDocument(doc);
}

function openDocumentInNewTab(doc?: SupplierDocument | null) {
    const url = buildDocumentUrl(doc);
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
}

function downloadDocument(doc?: SupplierDocument | null) {
    const url = buildDocumentUrl(doc);
    if (!url) return;

    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.download = doc?.originalFilename || "document";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function InlinePreview({ doc }: { doc: SupplierDocument }) {
    const url = buildDocumentUrl(doc);

    if (!url) {
        return (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-500">
                File preview is unavailable because the file URL could not be resolved.
            </div>
        );
    }

    if (isImageDocument(doc)) {
        return (
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
                <img
                    src={url}
                    alt={doc.originalFilename || "Document preview"}
                    className="max-h-[72vh] w-full object-contain bg-white"
                />
            </div>
        );
    }

    if (isPdfDocument(doc)) {
        return (
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
                <iframe
                    src={url}
                    title={doc.originalFilename || "PDF preview"}
                    className="h-[72vh] w-full"
                />
            </div>
        );
    }

    if (isTextLikeDocument(doc)) {
        return (
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
                <iframe
                    src={url}
                    title={doc.originalFilename || "Text preview"}
                    className="h-[72vh] w-full"
                />
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-600">
            <p className="font-medium text-zinc-900">Preview not available for this file type.</p>
            <p className="mt-2">You can still open it in a new tab or download it for review.</p>
        </div>
    );
}

function PreviewModal({
    doc,
    onClose,
}: {
    doc: SupplierDocument | null;
    onClose: () => void;
}) {
    useEffect(() => {
        if (!doc) return;

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [doc, onClose]);

    if (!doc) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 sm:p-6"
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-6xl rounded-[28px] border border-white/20 bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                    <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-zinc-900">
                            {doc.originalFilename || "Document preview"}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500">
                            <span>{DOC_LABELS[doc.kind]}</span>
                            <span>•</span>
                            <span>{humanFileSize(doc.size)}</span>
                            <span>•</span>
                            <span>{doc.mimeType || "Unknown type"}</span>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => openDocumentInNewTab(doc)}
                            className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
                        >
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Open
                        </button>

                        <button
                            type="button"
                            onClick={() => downloadDocument(doc)}
                            className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
                        >
                            <Download className="mr-2 h-4 w-4" />
                            Download
                        </button>

                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
                        >
                            <X className="mr-2 h-4 w-4" />
                            Close
                        </button>
                    </div>
                </div>

                <div className="p-4 sm:p-6">
                    <InlinePreview doc={doc} />
                </div>
            </div>
        </div>
    );
}

function StatCard({
    icon,
    label,
    value,
    tone = "zinc",
}: {
    icon: React.ReactNode;
    label: string;
    value: number;
    tone?: "zinc" | "amber" | "rose" | "emerald";
}) {
    const toneMap = {
        zinc: "bg-zinc-100 text-zinc-700",
        amber: "bg-amber-100 text-amber-700",
        rose: "bg-rose-100 text-rose-700",
        emerald: "bg-emerald-100 text-emerald-700",
    };

    return (
        <div className="rounded-[24px] border border-zinc-200 bg-white px-4 py-4 shadow-sm sm:px-5">
            <div className="flex items-center gap-3">
                <div className={`rounded-2xl p-3 ${toneMap[tone]}`}>{icon}</div>
                <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-500">{label}</div>
                    <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">{value}</div>
                </div>
            </div>
        </div>
    );
}

function InfoTile({
    label,
    value,
}: {
    label: string;
    value: React.ReactNode;
}) {
    return (
        <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
            <div className="mt-2 text-sm font-semibold text-zinc-900">{value}</div>
        </div>
    );
}

export default function AdminSupplierDocuments() {
    const [loadingList, setLoadingList] = useState(true);
    const [listError, setListError] = useState<string | null>(null);
    const [rows, setRows] = useState<SupplierSummaryRow[]>([]);

    const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [detail, setDetail] = useState<SupplierDetail | null>(null);

    const [reviewingDocId, setReviewingDocId] = useState<string | null>(null);
    const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<
        "ALL" | "PENDING" | "APPROVED" | "REJECTED" | "MISSING"
    >("ALL");
    const [previewDoc, setPreviewDoc] = useState<SupplierDocument | null>(null);

    const [supplierActionLoading, setSupplierActionLoading] = useState<
        "approve" | "reject" | null
    >(null);

    const [page, setPage] = useState(1);
    const PAGE_SIZE = 8;

    const loadList = useCallback(async () => {
        try {
            setLoadingList(true);
            setListError(null);

            const { data } = await api.get("/api/admin/supplier-documents", {
                withCredentials: true,
            });

            const items = Array.isArray(data?.data) ? data.data : [];
            setRows(items);

            if (!selectedSupplierId && items.length > 0) {
                setSelectedSupplierId(items[0].id);
            }
        } catch (e: any) {
            setListError(
                e?.response?.data?.error ||
                e?.response?.data?.message ||
                "Could not load supplier document review list."
            );
        } finally {
            setLoadingList(false);
        }
    }, [selectedSupplierId]);

    const loadDetail = useCallback(async (supplierId: string) => {
        try {
            setDetailLoading(true);
            setDetailError(null);

            const { data } = await api.get(`/api/admin/supplier-documents/${supplierId}`, {
                withCredentials: true,
            });

            setDetail((data?.data || null) as SupplierDetail | null);
        } catch (e: any) {
            setDetailError(
                e?.response?.data?.error ||
                e?.response?.data?.message ||
                "Could not load supplier document details."
            );
            setDetail(null);
        } finally {
            setDetailLoading(false);
        }
    }, []);

    useEffect(() => {
        loadList();
    }, [loadList]);

    useEffect(() => {
        if (!selectedSupplierId) {
            setDetail(null);
            return;
        }
        loadDetail(selectedSupplierId);
    }, [selectedSupplierId, loadDetail]);

    const filteredRows = useMemo(() => {
        const q = query.trim().toLowerCase();

        return rows.filter((row) => {
            const text = [
                row.businessName,
                row.user?.email,
                row.user?.firstName,
                row.user?.lastName,
                row.registrationType,
                row.status,
                row.kycStatus,
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            const matchesQuery = !q || text.includes(q);

            const matchesStatus =
                statusFilter === "ALL"
                    ? true
                    : statusFilter === "APPROVED"
                        ? row.readyForApproval || row.summary.some((x) => x.status === "APPROVED")
                        : statusFilter === "PENDING"
                            ? row.pendingCount > 0
                            : statusFilter === "REJECTED"
                                ? row.rejectedCount > 0
                                : row.missingCount > 0;

            return matchesQuery && matchesStatus;
        });
    }, [rows, query, statusFilter]);

    useEffect(() => {
        setPage(1);
    }, [query, statusFilter]);

    const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

    const paginatedRows = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredRows.slice(start, start + PAGE_SIZE);
    }, [filteredRows, page]);

    useEffect(() => {
        if (page > totalPages) {
            setPage(totalPages);
        }
    }, [page, totalPages]);

    const stats = useMemo(() => {
        return {
            total: rows.length,
            pending: rows.filter((r) => r.pendingCount > 0).length,
            rejected: rows.filter((r) => r.rejectedCount > 0).length,
            missing: rows.filter((r) => r.missingCount > 0).length,
            ready: rows.filter((r) => r.readyForApproval).length,
        };
    }, [rows]);

    const reviewDocument = async (
        documentId: string,
        status: "APPROVED" | "REJECTED"
    ) => {
        try {
            setReviewingDocId(documentId);
            setDetailError(null);

            await api.patch(
                `/api/admin/supplier-documents/document/${documentId}/review`,
                {
                    status,
                    note: reviewNotes[documentId]?.trim() || null,
                },
                { withCredentials: true }
            );

            await loadList();
            if (selectedSupplierId) {
                await loadDetail(selectedSupplierId);
            }
        } catch (e: any) {
            setDetailError(
                e?.response?.data?.error ||
                e?.response?.data?.message ||
                "Could not review supplier document."
            );
        } finally {
            setReviewingDocId(null);
        }
    };

    const recomputeSupplier = async () => {
        if (!selectedSupplierId) return;

        try {
            setDetailLoading(true);
            setDetailError(null);

            await api.post(
                `/api/admin/supplier-documents/${selectedSupplierId}/recompute`,
                {},
                { withCredentials: true }
            );

            await loadList();
            await loadDetail(selectedSupplierId);
        } catch (e: any) {
            setDetailError(
                e?.response?.data?.error ||
                e?.response?.data?.message ||
                "Could not recompute supplier approval state."
            );
        } finally {
            setDetailLoading(false);
        }
    };

    const approveSupplier = async () => {
        if (!selectedSupplierId) return;

        try {
            setSupplierActionLoading("approve");
            setDetailError(null);

            await api.post(
                `/api/admin/supplier-documents/${selectedSupplierId}/approve-supplier`,
                {},
                { withCredentials: true }
            );

            await loadList();
            await loadDetail(selectedSupplierId);
        } catch (e: any) {
            setDetailError(
                e?.response?.data?.error ||
                e?.response?.data?.message ||
                "Could not approve supplier."
            );
        } finally {
            setSupplierActionLoading(null);
        }
    };

    const rejectSupplier = async () => {
        if (!selectedSupplierId) return;

        try {
            setSupplierActionLoading("reject");
            setDetailError(null);

            await api.post(
                `/api/admin/supplier-documents/${selectedSupplierId}/reject-supplier`,
                {},
                { withCredentials: true }
            );

            await loadList();
            await loadDetail(selectedSupplierId);
        } catch (e: any) {
            setDetailError(
                e?.response?.data?.error ||
                e?.response?.data?.message ||
                "Could not reject supplier."
            );
        } finally {
            setSupplierActionLoading(null);
        }
    };

    const latestByKind = useMemo(() => {
        return detail ? latestDocsByKind(detail.documents || []) : new Map();
    }, [detail]);

    const extraDocuments = useMemo(() => {
        if (!detail) return [];
        return detail.documents.filter((d) => !detail.requiredKinds.includes(d.kind));
    }, [detail]);

    const pageWrap = "min-h-[100dvh] bg-gradient-to-b from-zinc-50 via-white to-zinc-50";
    const shell =
        "rounded-[30px] border border-white/70 bg-white/90 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur";
    const card =
        "rounded-[26px] border border-zinc-200 bg-white/95 shadow-[0_10px_30px_rgba(15,23,42,0.05)]";
    const panel =
        "rounded-[22px] border border-zinc-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]";
    const input =
        "w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] md:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm";
    const secondaryBtn =
        "inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60";

    return (
        <SiteLayout>
            <div className={pageWrap}>
                <div className="px-3 py-5 sm:px-4 sm:py-7 xl:px-6">
                    <div className="mx-auto w-full max-w-[1680px] space-y-5">
                        <div className={`${shell} p-4 sm:p-5 lg:p-6`}>
                            <div className="flex flex-col gap-5">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                    <div>
                                        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-[30px]">
                                            Supplier document review
                                        </h1>
                                        <p className="mt-1 text-sm text-zinc-600">
                                            Review onboarding files, verify each required document, and make the final
                                            supplier decision.
                                        </p>
                                    </div>

                                    {listError && (
                                        <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                                            {listError}
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                                    <StatCard
                                        icon={<FileText className="h-5 w-5" />}
                                        label="Suppliers"
                                        value={stats.total}
                                        tone="zinc"
                                    />
                                    <StatCard
                                        icon={<Clock3 className="h-5 w-5" />}
                                        label="Pending review"
                                        value={stats.pending}
                                        tone="amber"
                                    />
                                    <StatCard
                                        icon={<XCircle className="h-5 w-5" />}
                                        label="Rejected"
                                        value={stats.rejected}
                                        tone="rose"
                                    />
                                    <StatCard
                                        icon={<ShieldCheck className="h-5 w-5" />}
                                        label="Ready / approved"
                                        value={stats.ready}
                                        tone="emerald"
                                    />
                                    <StatCard
                                        icon={<AlertTriangle className="h-5 w-5" />}
                                        label="Missing docs"
                                        value={stats.missing}
                                        tone="zinc"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[390px_minmax(0,1fr)]">
                            <aside className="xl:sticky xl:top-4 xl:self-start">
                                <div className={`${shell} p-4 sm:p-5`}>
                                    <div className="flex flex-col gap-3">
                                        <div className="flex flex-col gap-3">
                                            <div className="relative">
                                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                                                <input
                                                    value={query}
                                                    onChange={(e) => setQuery(e.target.value)}
                                                    placeholder="Search supplier, email, status..."
                                                    className={`${input} pl-10`}
                                                />
                                            </div>

                                            <select
                                                value={statusFilter}
                                                onChange={(e) =>
                                                    setStatusFilter(
                                                        e.target.value as
                                                        | "ALL"
                                                        | "PENDING"
                                                        | "APPROVED"
                                                        | "REJECTED"
                                                        | "MISSING"
                                                    )
                                                }
                                                className={input}
                                            >
                                                <option value="ALL">All statuses</option>
                                                <option value="PENDING">Pending</option>
                                                <option value="APPROVED">Approved / ready</option>
                                                <option value="REJECTED">Rejected</option>
                                                <option value="MISSING">Missing</option>
                                            </select>

                                            <button
                                                type="button"
                                                onClick={loadList}
                                                disabled={loadingList}
                                                className={secondaryBtn}
                                            >
                                                <RefreshCcw className="mr-2 h-4 w-4" />
                                                Refresh
                                            </button>
                                        </div>

                                        <div className="border-t border-zinc-200 pt-3">
                                            {loadingList ? (
                                                <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    Loading suppliers…
                                                </div>
                                            ) : filteredRows.length === 0 ? (
                                                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
                                                    No suppliers matched your filters.
                                                </div>
                                            ) : (
                                                <div className="space-y-3">
                                                    {paginatedRows.map((row) => {
                                                        const selected = selectedSupplierId === row.id;

                                                        return (
                                                            <button
                                                                key={row.id}
                                                                type="button"
                                                                onClick={() => setSelectedSupplierId(row.id)}
                                                                className={`w-full rounded-[22px] border p-4 text-left transition ${selected
                                                                        ? "border-zinc-900 bg-zinc-900 text-white shadow-lg"
                                                                        : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
                                                                    }`}
                                                            >
                                                                <div className="flex items-start justify-between gap-3">
                                                                    <div className="min-w-0">
                                                                        <div className="truncate text-base font-semibold">
                                                                            {row.businessName || "Unnamed supplier"}
                                                                        </div>
                                                                        <div
                                                                            className={`mt-1 truncate text-sm ${selected ? "text-zinc-300" : "text-zinc-500"
                                                                                }`}
                                                                        >
                                                                            {row.user?.email || "No email"}
                                                                        </div>
                                                                    </div>

                                                                    <Eye
                                                                        className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-white" : "text-zinc-500"
                                                                            }`}
                                                                    />
                                                                </div>

                                                                <div className="mt-3 flex flex-wrap gap-2">
                                                                    <span
                                                                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${selected ? "bg-white/10 text-white" : statusChip(row.kycStatus)
                                                                            }`}
                                                                    >
                                                                        KYC: {row.kycStatus || "—"}
                                                                    </span>

                                                                    <span
                                                                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${selected ? "bg-white/10 text-white" : statusChip(row.status)
                                                                            }`}
                                                                    >
                                                                        Status: {row.status || "—"}
                                                                    </span>
                                                                </div>

                                                                <div
                                                                    className={`mt-4 grid grid-cols-4 gap-2 rounded-2xl px-1 text-[11px] ${selected ? "text-zinc-200" : "text-zinc-600"
                                                                        }`}
                                                                >
                                                                    <div>
                                                                        <div className="text-sm font-semibold">{row.approvedCount}</div>
                                                                        <div>Approved</div>
                                                                    </div>
                                                                    <div>
                                                                        <div className="text-sm font-semibold">{row.pendingCount}</div>
                                                                        <div>Pending</div>
                                                                    </div>
                                                                    <div>
                                                                        <div className="text-sm font-semibold">{row.rejectedCount}</div>
                                                                        <div>Rejected</div>
                                                                    </div>
                                                                    <div>
                                                                        <div className="text-sm font-semibold">{row.missingCount}</div>
                                                                        <div>Missing</div>
                                                                    </div>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>

                                        {!loadingList && filteredRows.length > 0 && (
                                            <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4">
                                                <div className="text-xs text-zinc-500">
                                                    Showing {(page - 1) * PAGE_SIZE + 1}–
                                                    {Math.min(page * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
                                                </div>

                                                <div className="flex items-center justify-between gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                                                        disabled={page <= 1}
                                                        className={secondaryBtn}
                                                    >
                                                        Prev
                                                    </button>

                                                    <div className="text-sm text-zinc-700">
                                                        Page <span className="font-semibold">{page}</span> of{" "}
                                                        <span className="font-semibold">{totalPages}</span>
                                                    </div>

                                                    <button
                                                        type="button"
                                                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                                        disabled={page >= totalPages}
                                                        className={secondaryBtn}
                                                    >
                                                        Next
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </aside>

                            <main className="min-w-0">
                                <div className={`${shell} p-4 sm:p-5 lg:p-6`}>
                                    {!selectedSupplierId ? (
                                        <div className="flex min-h-[420px] items-center justify-center rounded-[24px] border border-dashed border-zinc-300 bg-zinc-50 text-center text-sm text-zinc-500">
                                            Select a supplier to review submitted documents.
                                        </div>
                                    ) : detailLoading ? (
                                        <div className="flex min-h-[420px] items-center justify-center text-sm text-zinc-500">
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Loading document details…
                                        </div>
                                    ) : detailError ? (
                                        <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                                            {detailError}
                                        </div>
                                    ) : !detail ? (
                                        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500">
                                            No supplier detail available.
                                        </div>
                                    ) : (
                                        <div className="space-y-5">
                                            <section className={`${card} p-5 sm:p-6`}>
                                                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                                    <div className="min-w-0">
                                                        <h2 className="truncate text-2xl font-semibold tracking-tight text-zinc-900">
                                                            {detail.businessName || "Unnamed supplier"}
                                                        </h2>
                                                        <p className="mt-1 text-sm text-zinc-600">
                                                            {detail.user?.firstName || detail.user?.lastName
                                                                ? `${detail.user?.firstName || ""} ${detail.user?.lastName || ""}`.trim()
                                                                : "No contact name"}
                                                            {detail.user?.email ? ` • ${detail.user.email}` : ""}
                                                        </p>
                                                    </div>

                                                    <div className="flex flex-wrap gap-2">
                                                        <span
                                                            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusChip(
                                                                detail.status
                                                            )}`}
                                                        >
                                                            Status: {detail.status || "—"}
                                                        </span>
                                                        <span
                                                            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusChip(
                                                                detail.kycStatus
                                                            )}`}
                                                        >
                                                            KYC: {detail.kycStatus || "—"}
                                                        </span>
                                                    </div>
                                                </div>

                                                {detail.allRequiredApproved &&
                                                    String(detail.kycStatus || "").toUpperCase() !== "APPROVED" && (
                                                        <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                                                            All required documents are approved. This supplier is now ready for
                                                            final admin approval.
                                                        </div>
                                                    )}

                                                <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                                                    <InfoTile
                                                        label="Registration type"
                                                        value={
                                                            <span className="break-words whitespace-normal">
                                                                {detail.registrationType || "—"}
                                                            </span>
                                                        }
                                                    />
                                                    <InfoTile
                                                        label="Country"
                                                        value={detail.registrationCountryCode || "—"}
                                                    />
                                                    <InfoTile
                                                        label="Required docs approved"
                                                        value={detail.allRequiredApproved ? "Yes" : "No"}
                                                    />
                                                    <InfoTile
                                                        label="Final supplier state"
                                                        value={
                                                            detail.allRequiredApproved
                                                                ? "Ready for admin decision"
                                                                : "Waiting for all required docs"
                                                        }
                                                    />
                                                </div>
                                            </section>

                                            <section className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_330px]">
                                                <div className="min-w-0 space-y-5">
                                                    <div className={`${card} p-5 sm:p-6`}>
                                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                            <div>
                                                                <h3 className="text-base font-semibold text-zinc-900">
                                                                    Required document summary
                                                                </h3>
                                                                <p className="mt-1 text-sm text-zinc-600">
                                                                    Review the latest file submitted for each required document.
                                                                </p>
                                                            </div>

                                                            <button
                                                                type="button"
                                                                onClick={recomputeSupplier}
                                                                disabled={detailLoading}
                                                                className={secondaryBtn}
                                                            >
                                                                <RefreshCcw className="mr-2 h-4 w-4" />
                                                                Recompute status
                                                            </button>
                                                        </div>

                                                        <div className="mt-5 space-y-4">
                                                            {detail.requiredKinds.map((kind) => {
                                                                const doc = latestByKind.get(kind);

                                                                return (
                                                                    <div
                                                                        key={kind}
                                                                        className={`${panel} overflow-hidden p-4 sm:p-5`}
                                                                    >
                                                                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                                            <div className="min-w-0 flex-1">
                                                                                <div className="flex items-start gap-3">
                                                                                    <div className="rounded-2xl bg-zinc-100 p-3">
                                                                                        {docIcon(kind)}
                                                                                    </div>

                                                                                    <div className="min-w-0 flex-1">
                                                                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                                                                            <div className="min-w-0">
                                                                                                <h4 className="text-sm font-semibold text-zinc-900">
                                                                                                    {DOC_LABELS[kind]}
                                                                                                </h4>

                                                                                                {!doc ? (
                                                                                                    <p className="mt-1 text-sm text-zinc-500">
                                                                                                        No file submitted yet.
                                                                                                    </p>
                                                                                                ) : (
                                                                                                    <>
                                                                                                        <p className="mt-1 truncate text-sm text-zinc-800">
                                                                                                            {doc.originalFilename}
                                                                                                        </p>
                                                                                                        <div className="mt-1 text-xs text-zinc-500">
                                                                                                            Size: {humanFileSize(doc.size)} • Uploaded:{" "}
                                                                                                            {doc.uploadedAt
                                                                                                                ? new Date(doc.uploadedAt).toLocaleString()
                                                                                                                : "—"}
                                                                                                        </div>
                                                                                                    </>
                                                                                                )}
                                                                                            </div>

                                                                                            <div className="shrink-0">
                                                                                                <span
                                                                                                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${doc ? statusChip(doc.status) : statusChip("MISSING")
                                                                                                        }`}
                                                                                                >
                                                                                                    {doc?.status || "MISSING"}
                                                                                                </span>
                                                                                            </div>
                                                                                        </div>

                                                                                        {doc?.note ? (
                                                                                            <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
                                                                                                <span className="font-semibold">Review note:</span>{" "}
                                                                                                {doc.note}
                                                                                            </div>
                                                                                        ) : null}
                                                                                    </div>
                                                                                </div>

                                                                                {doc && (
                                                                                    <>
                                                                                        <div className="mt-4 flex flex-wrap gap-2">
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => setPreviewDoc(doc)}
                                                                                                className={secondaryBtn}
                                                                                            >
                                                                                                <Eye className="mr-2 h-4 w-4" />
                                                                                                Preview
                                                                                            </button>

                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => openDocumentInNewTab(doc)}
                                                                                                className={secondaryBtn}
                                                                                            >
                                                                                                <ExternalLink className="mr-2 h-4 w-4" />
                                                                                                Open file
                                                                                            </button>

                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => downloadDocument(doc)}
                                                                                                className={secondaryBtn}
                                                                                            >
                                                                                                <Download className="mr-2 h-4 w-4" />
                                                                                                Download
                                                                                            </button>
                                                                                        </div>

                                                                                        {!canInlinePreview(doc) && (
                                                                                            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                                                                                This file type may not preview inline in the browser.
                                                                                                Use Open file or Download.
                                                                                            </div>
                                                                                        )}

                                                                                        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                                                                                            <textarea
                                                                                                value={reviewNotes[doc.id] || ""}
                                                                                                onChange={(e) =>
                                                                                                    setReviewNotes((s) => ({
                                                                                                        ...s,
                                                                                                        [doc.id]: e.target.value,
                                                                                                    }))
                                                                                                }
                                                                                                rows={3}
                                                                                                className="w-full rounded-2xl border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-200 transition shadow-sm"
                                                                                                placeholder="Optional admin note for approval or rejection"
                                                                                            />

                                                                                            <div className="flex flex-wrap gap-2 xl:justify-end">
                                                                                                <button
                                                                                                    type="button"
                                                                                                    onClick={() => reviewDocument(doc.id, "APPROVED")}
                                                                                                    disabled={reviewingDocId === doc.id}
                                                                                                    className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                                                                                                >
                                                                                                    {reviewingDocId === doc.id ? (
                                                                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                                                                    ) : (
                                                                                                        <CheckCircle2 className="mr-2 h-4 w-4" />
                                                                                                    )}
                                                                                                    Approve
                                                                                                </button>

                                                                                                <button
                                                                                                    type="button"
                                                                                                    onClick={() => reviewDocument(doc.id, "REJECTED")}
                                                                                                    disabled={reviewingDocId === doc.id}
                                                                                                    className="inline-flex items-center justify-center rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                                                                                                >
                                                                                                    {reviewingDocId === doc.id ? (
                                                                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                                                                    ) : (
                                                                                                        <AlertTriangle className="mr-2 h-4 w-4" />
                                                                                                    )}
                                                                                                    Reject
                                                                                                </button>
                                                                                            </div>
                                                                                        </div>
                                                                                    </>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    {extraDocuments.length > 0 && (
                                                        <div className={`${card} p-5 sm:p-6`}>
                                                            <h3 className="text-base font-semibold text-zinc-900">
                                                                Additional uploaded documents
                                                            </h3>
                                                            <p className="mt-1 text-sm text-zinc-600">
                                                                Extra files submitted outside the required onboarding list.
                                                            </p>

                                                            <div className="mt-5 space-y-3">
                                                                {extraDocuments.map((doc) => (
                                                                    <div
                                                                        key={doc.id}
                                                                        className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm"
                                                                    >
                                                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                                                            <div className="min-w-0">
                                                                                <div className="truncate text-sm font-semibold text-zinc-900">
                                                                                    {DOC_LABELS[doc.kind]} — {doc.originalFilename}
                                                                                </div>
                                                                                <div className="mt-1 text-xs text-zinc-500">
                                                                                    {humanFileSize(doc.size)}
                                                                                    {doc.uploadedAt
                                                                                        ? ` • Uploaded ${new Date(doc.uploadedAt).toLocaleString()}`
                                                                                        : ""}
                                                                                </div>
                                                                            </div>

                                                                            <div className="flex flex-wrap items-center gap-2">
                                                                                <span
                                                                                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusChip(
                                                                                        doc.status
                                                                                    )}`}
                                                                                >
                                                                                    {doc.status || "PENDING"}
                                                                                </span>

                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => setPreviewDoc(doc)}
                                                                                    className={secondaryBtn}
                                                                                >
                                                                                    <Eye className="mr-2 h-4 w-4" />
                                                                                    Preview
                                                                                </button>

                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => openDocumentInNewTab(doc)}
                                                                                    className={secondaryBtn}
                                                                                >
                                                                                    <ExternalLink className="mr-2 h-4 w-4" />
                                                                                    Open file
                                                                                </button>

                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => downloadDocument(doc)}
                                                                                    className={secondaryBtn}
                                                                                >
                                                                                    <Download className="mr-2 h-4 w-4" />
                                                                                    Download
                                                                                </button>
                                                                            </div>
                                                                        </div>

                                                                        {!canInlinePreview(doc) && (
                                                                            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                                                                This file type may not preview inline in the browser. Use
                                                                                Open file or Download.
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                <aside className="space-y-5">
                                                    <div className={`${card} p-5 sm:p-6`}>
                                                        <h3 className="text-base font-semibold text-zinc-900">
                                                            Final supplier decision
                                                        </h3>
                                                        <p className="mt-1 text-sm text-zinc-600">
                                                            Approve only when all required documents have been reviewed and are
                                                            acceptable.
                                                        </p>

                                                        <div className="mt-5 space-y-3">
                                                            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                                                                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                                                                    Readiness
                                                                </div>
                                                                <div className="mt-2 text-sm font-semibold text-zinc-900">
                                                                    {detail.allRequiredApproved
                                                                        ? "Ready for admin decision"
                                                                        : "Waiting for all required docs"}
                                                                </div>
                                                            </div>

                                                            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                                                                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                                                                    Document summary
                                                                </div>
                                                                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                                                                    <div>
                                                                        <div className="font-semibold text-zinc-900">
                                                                            {detail.requiredKinds.length}
                                                                        </div>
                                                                        <div className="text-zinc-500">Required</div>
                                                                    </div>
                                                                    <div>
                                                                        <div className="font-semibold text-zinc-900">
                                                                            {detail.requiredKinds.filter((kind) => {
                                                                                const doc = latestByKind.get(kind);
                                                                                return String(doc?.status || "").toUpperCase() === "APPROVED";
                                                                            }).length}
                                                                        </div>
                                                                        <div className="text-zinc-500">Approved</div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <button
                                                                type="button"
                                                                onClick={approveSupplier}
                                                                disabled={!detail.allRequiredApproved || supplierActionLoading !== null}
                                                                className="inline-flex w-full items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                                                            >
                                                                {supplierActionLoading === "approve" ? (
                                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                                ) : (
                                                                    <BadgeCheck className="mr-2 h-4 w-4" />
                                                                )}
                                                                Approve supplier
                                                            </button>

                                                            <button
                                                                type="button"
                                                                onClick={rejectSupplier}
                                                                disabled={supplierActionLoading !== null}
                                                                className="inline-flex w-full items-center justify-center rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                                                            >
                                                                {supplierActionLoading === "reject" ? (
                                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                                ) : (
                                                                    <XCircle className="mr-2 h-4 w-4" />
                                                                )}
                                                                Reject supplier
                                                            </button>
                                                        </div>
                                                    </div>
                                                </aside>
                                            </section>
                                        </div>
                                    )}
                                </div>
                            </main>
                        </div>
                    </div>
                </div>
            </div>

            <PreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
        </SiteLayout>
    );
}