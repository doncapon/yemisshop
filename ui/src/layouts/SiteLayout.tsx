// src/layouts/SiteLayout.tsx
import React, { useEffect } from "react";
import Navbar from "../components/Navbar";
import { captureAttributionFromUrl } from "../utils/attribution";
import ConsentBanner from "../components/ConsentBanner";
import MiniCartToastHost from "../components/cart/MiniCartToast";

type Props = {
  children: React.ReactNode;
};

export default function SiteLayout({ children }: Props) {
  useEffect(() => {
    captureAttributionFromUrl();
  }, []);

  return (
    <div className="min-h-screen w-full overflow-x-hidden flex flex-col bg-gradient-to-b from-primary-50/40 via-bg-soft to-bg-soft text-ink">
      <MiniCartToastHost />
      <Navbar />

      {/* Global overlays */}
      <ConsentBanner />

      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Removed duplicate px-4 to avoid double padding */}
        <div className="max-w-6xl mx-auto py-4 md:py-8">{children}</div>
      </main>
    </div>
  );
}
