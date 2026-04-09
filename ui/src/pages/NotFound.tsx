// src/pages/NotFound.tsx
import { Link, useLocation } from "react-router-dom";
import SiteLayout from "../layouts/SiteLayout";

export default function NotFound() {
  const location = useLocation();

  return (
    <SiteLayout>
      <div className="min-h-[88vh] bg-gradient-to-b from-primary-50/60 via-bg-soft to-bg-soft relative overflow-hidden grid place-items-center px-4">
        <div className="pointer-events-none -z-10 absolute -top-24 -left-24 size-80 rounded-full bg-primary-500/20 blur-3xl animate-pulse" />
        <div className="pointer-events-none -z-10 absolute -bottom-28 -right-24 size-96 rounded-full bg-fuchsia-400/20 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />

        <div className="max-w-md w-full text-center relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-3 py-1 text-[11px] font-semibold shadow-sm">
            <span className="inline-block size-1.5 rounded-full bg-white/90" />
            404 — Page not found
          </div>

          <h1 className="mt-4 text-6xl font-extrabold tracking-tight text-ink">
            404
          </h1>
          <p className="mt-2 text-xl font-semibold text-ink">
            This page doesn't exist
          </p>
          <p className="mt-2 text-sm text-ink-soft break-all">
            <span className="font-mono bg-zinc-100 px-1.5 py-0.5 rounded text-xs">
              {location.pathname}
            </span>{" "}
            was not found on this server.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-primary-600 to-fuchsia-600 text-white px-5 py-2.5 font-semibold shadow-sm hover:shadow-md focus:outline-none focus:ring-4 focus:ring-primary-200 transition text-sm"
            >
              Go to homepage
            </Link>
            <Link
              to="/orders"
              className="inline-flex items-center justify-center rounded-xl border border-border bg-white px-5 py-2.5 font-semibold text-ink shadow-sm hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-primary-100 transition text-sm"
            >
              My orders
            </Link>
          </div>

          <p className="mt-8 text-[12px] text-ink-soft">
            Need help?{" "}
            <Link to="/help" className="text-primary-600 hover:underline underline-offset-2">
              Visit our Help Centre
            </Link>
          </p>
        </div>
      </div>
    </SiteLayout>
  );
}
