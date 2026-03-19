// src/pages/ProductReviews.tsx
import * as React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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

export default function ProductReviews() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["reviews", id],
    queryFn: async () => {
      const res = await api.get(`/api/products/${id}/reviews`);
      return res.data;
    },
  });

  const reviews: Review[] = data?.data ?? [];
  const summary = data?.summary ?? { ratingAvg: 0, ratingCount: 0 };

  if (isLoading) {
    return (
      <SiteLayout>
        <div className="p-6">Loading reviews…</div>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <div className="max-w-4xl mx-auto p-4 space-y-6">

        {/* Back */}
        <Link to={`/products/${id}`} className="text-sm text-zinc-500">
          ← Back to product
        </Link>

        {/* Summary */}
        <div className="bg-white rounded-2xl border p-5">
          <h1 className="text-xl font-semibold">Customer Reviews</h1>

          <div className="mt-3 flex items-center gap-3">
            <div className="text-3xl font-bold">
              {summary.ratingAvg?.toFixed(1) ?? "0.0"}
            </div>

            <div className="text-amber-500 text-xl">
              {Array.from({ length: 5 }).map((_, i) =>
                i < Math.round(summary.ratingAvg ?? 0) ? "★" : "☆"
              )}
            </div>

            <div className="text-sm text-zinc-500">
              ({summary.ratingCount} reviews)
            </div>
          </div>
        </div>

        {/* Reviews list */}
        <div className="space-y-4">
          {reviews.length === 0 && (
            <div className="text-sm text-zinc-500">
              No reviews yet.
            </div>
          )}

          {reviews.map((r) => (
            <div key={r.id} className="bg-white border rounded-2xl p-4">
              
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  {r.user?.firstName ?? "User"} {r.user?.lastName?.[0] ?? ""}.
                </div>

                <div className="text-xs text-zinc-400">
                  {new Date(r.createdAt).toLocaleDateString()}
                </div>
              </div>

              {/* Stars */}
              <div className="mt-1 text-amber-500">
                {Array.from({ length: 5 }).map((_, i) =>
                  i < r.rating ? "★" : "☆"
                )}
              </div>

              {/* Verified */}
              {r.verifiedPurchase && (
                <div className="mt-1 text-xs text-emerald-600 font-medium">
                  ✔ Verified purchase
                </div>
              )}

              {/* Title */}
              {r.title && (
                <div className="mt-2 font-semibold text-sm">
                  {r.title}
                </div>
              )}

              {/* Comment */}
              {r.comment && (
                <p className="mt-1 text-sm text-zinc-700">
                  {r.comment}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </SiteLayout>
  );
}