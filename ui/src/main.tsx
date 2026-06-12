import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import ToastProvider from "./components/ToastProvider";

import { UnheadProvider } from "@unhead/react/client";
import { head } from "./seo/head";

// Capacitor native initialisation — only runs inside the native app shell
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

if (Capacitor.isNativePlatform()) {
  // Light status bar (dark icons on white background)
  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  StatusBar.setBackgroundColor({ color: "#ffffff" }).catch(() => {});

  // Hide the splash screen after the React tree mounts
  SplashScreen.hide({ fadeOutDuration: 300 }).catch(() => {});
}

const qc =new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      // optional: reduces "random" refetching
      staleTime: 60_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ToastProvider>
          <UnheadProvider head={head}>
            <App />
          </UnheadProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
