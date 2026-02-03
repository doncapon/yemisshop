// src/layouts/SiteLayout.tsx
import React, { useEffect } from "react";
import Navbar from "../components/Navbar";
import { captureAttributionFromUrl } from "../utils/attribution";
import ConsentBanner from "../components/ConsentBanner";

type Props = {
  children: React.ReactNode;
};

export default function SiteLayout({ children }: Props) {
    useEffect(() => {
    captureAttributionFromUrl();
  }, []);
  return (
    <div className="min-h-screen w-full overflow-x-hidden flex flex-col bg-gradient-to-b from-primary-50/40 via-bg-soft to-bg-soft text-ink">
      <Navbar />

      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 md:py-8">
          {children}
            <ConsentBanner />
        </div>
      </main>
    </div>
  );
}
