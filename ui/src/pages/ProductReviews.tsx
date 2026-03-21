// src/pages/ProductReviews.tsx
import * as React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import api from "../api/client";
import SiteLayout from "../layouts/SiteLayout";

type Review = {
  id: string;
  rating: number;
  title?: string;
  comment?: string;
  verifiedPurchase: boolean;
  createdAt: string;
  user: {
    firstName?: string;
    lastName?: string;
  };
};

type ReviewsResponse = {
  data: Review[];
  summary?: {
    ratingAvg?: number;
    ratingCount?: number;
  };
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};

const PAGE_SIZE = 10;

export default function ProductReviews() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    setPage(1);
  }, [id]);

  const { data, isLoading, isFetching, isError, refetch } = useQuery<ReviewsResponse>({
    queryKey: ["reviews", id, page, PAGE_SIZE],
    enabled: !!id,
    queryFn: async () => {
      const res = await api.get(`/api/products/${id}/reviews`, {
        params: {
          page,
          pageSize: PAGE_SIZE,
        },
      });

      return res.data as ReviewsResponse;
    },
    placeholderData: (prev) => prev,
  });

  const reviews: Review[] = Array.isArray(data?.data) ? data!.data : [];
  const summary = data?.summary ?? { ratingAvg: 0, ratingCount: 0 };
  const total = Number(data?.total ?? summary.ratingCount ?? 0);
  const currentPage = Math.max(1, Number(data?.page ?? page));
  const pageSize = Math.max(1, Number(data?.pageSize ?? PAGE_SIZE));
  const totalPages = Math.max(
    1,
    Number(
      data?.totalPages ||
        Math.ceil((Number(data?.total ?? 0) || 0) / pageSize) ||
        1
    )
  );

  const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = total === 0 ? 0 : Math.min(currentPage * pageSize, total);

  if (isLoading && !data) {
    return (
      <SiteLayout>
        <div className="p-6">Loading reviews…</div>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        <Link to={`/products/${id}`} className="text-sm text-zinc-500">
          ← Back to product
        </Link>

        <div className="bg-white rounded-2xl border p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold">Customer Reviews</h1>

              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <div className="text-3xl font-bold">
                  {Number(summary.ratingAvg ?? 0).toFixed(1)}
                </div>

                <div className="text-amber-500 text-xl">
                  {Array.from({ length: 5 }).map((_, i) =>
                    i < Math.round(Number(summary.ratingAvg ?? 0)) ? "★" : "☆"
                  )}
                </div>

                <div className="text-sm text-zinc-500">
                  ({Number(summary.ratingCount ?? 0)} reviews)
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center justify-center rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-60"
            >
              {isFetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-zinc-600">
            Showing <span className="font-semibold text-zinc-900">{from}</span>-
            <span className="font-semibold text-zinc-900">{to}</span> of{" "}
            <span className="font-semibold text-zinc-900">{total}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={currentPage <= 1 || isFetching}
              className="inline-flex items-center justify-center rounded-xl border bg-white px-2.5 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
              aria-label="First page"
            >
              <ChevronsLeft size={16} />
            </button>

            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1 || isFetching}
              className="inline-flex items-center rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
            >
              Prev
            </button>

            <div className="min-w-[96px] text-center text-sm text-zinc-600">
              Page <span className="font-semibold text-zinc-900">{currentPage}</span> /{" "}
              <span className="font-semibold text-zinc-900">{totalPages}</span>
            </div>

            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages || isFetching}
              className="inline-flex items-center rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
            >
              Next
            </button>

            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={currentPage >= totalPages || isFetching}
              className="inline-flex items-center justify-center rounded-xl border bg-white px-2.5 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
              aria-label="Last page"
            >
              <ChevronsRight size={16} />
            </button>
          </div>
        </div>

        {isError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Failed to load reviews.
          </div>
        )}

        <div className="space-y-4">
          {!isError && reviews.length === 0 && (
            <div className="text-sm text-zinc-500">No reviews yet.</div>
          )}

          {reviews.map((r) => (
            <div key={r.id} className="bg-white border rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">
                  {r.user?.firstName ?? "User"} {r.user?.lastName?.[0] ?? ""}.
                </div>

                <div className="text-xs text-zinc-400">
                  {new Date(r.createdAt).toLocaleDateString()}
                </div>
              </div>

              <div className="mt-1 text-amber-500">
                {Array.from({ length: 5 }).map((_, i) => (i < r.rating ? "★" : "☆"))}
              </div>

              {r.verifiedPurchase && (
                <div className="mt-1 text-xs text-emerald-600 font-medium">
                  ✔ Verified purchase
                </div>
              )}

              {r.title && <div className="mt-2 font-semibold text-sm">{r.title}</div>}

              {r.comment && <p className="mt-1 text-sm text-zinc-700">{r.comment}</p>}
            </div>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={currentPage <= 1 || isFetching}
              className="inline-flex items-center justify-center rounded-xl border bg-white px-2.5 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
              aria-label="First page"
            >
              <ChevronsLeft size={16} />
            </button>

            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1 || isFetching}
              className="inline-flex items-center rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
            >
              Prev
            </button>

            <div className="min-w-[96px] text-center text-sm text-zinc-600">
              Page <span className="font-semibold text-zinc-900">{currentPage}</span> /{" "}
              <span className="font-semibold text-zinc-900">{totalPages}</span>
            </div>

            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages || isFetching}
              className="inline-flex items-center rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
            >
              Next
            </button>

            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={currentPage >= totalPages || isFetching}
              className="inline-flex items-center justify-center rounded-xl border bg-white px-2.5 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
              aria-label="Last page"
            >
              <ChevronsRight size={16} />
            </button>
          </div>
        )}
      </div>
    </SiteLayout>
  );
}