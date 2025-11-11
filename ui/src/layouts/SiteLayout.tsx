// src/layouts/SiteLayout.tsx
import React from "react";
import Navbar from "../components/Navbar";

type Props = {
  children: React.ReactNode;
};

export default function SiteLayout({ children }: Props) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-primary-50/40 via-bg-soft to-bg-soft text-ink">
      <Navbar />

      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
