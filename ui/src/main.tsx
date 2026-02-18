import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import ToastProvider from "./components/ToastProvider";

import { UnheadProvider } from "@unhead/react/client";
import { head } from "./seo/head"; // ✅ use the SAME head instance

const qc =new QueryClient({
  defaultOptions: {
    queries: {
      // ✅ prevents tab-switch refetch
      refetchOnWindowFocus: false,

      // ✅ also prevents network reconnect refetch surprise
      refetchOnReconnect: false,

      // ✅ fresh when you LAND on a page/component
      // use "always" if you want it to fetch even if cached
      refetchOnMount: "always",

      // optional – reduce noisy retries
      retry: 1,
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
