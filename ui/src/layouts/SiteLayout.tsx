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

  // ✅ global safety reset in case a modal/drawer/backdrop left the app "frozen"
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;

    body.style.overflow = "";
    body.style.pointerEvents = "";
    html.style.overflow = "";
    html.style.pointerEvents = "";

    body.classList.remove("overflow-hidden");
    html.classList.remove("overflow-hidden");

    return () => {
      body.style.pointerEvents = "";
      html.style.pointerEvents = "";
    };
  }, []);

  return (
    <div className="min-h-screen w-full overflow-x-hidden flex flex-col bg-gradient-to-b from-primary-50/40 via-bg-soft to-bg-soft text-ink">
      <MiniCartToastHost />
      <Navbar />

      {/* Global overlays */}
      <ConsentBanner />

      <main className="w-full flex-1 pt-3 md:pt-0 bg-purple-400">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto py-4 md:py-8 md">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}