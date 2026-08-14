import http from "node:http";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// A dedicated, non-keep-alive agent for the dev proxy's backend connections.
// Without this, Vite/http-proxy reuses pooled sockets to the API server —
// the FIRST proxied request of the process completes fine, but reusing that
// same pooled connection for later requests reliably stalls mid-response
// (observed: it delivers a fixed partial byte count, then hangs forever).
// Forcing a fresh, closed-after-use connection per request avoids that.
const devProxyAgent = new http.Agent({ keepAlive: false });

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0", // expose on LAN so emulator + real devices can reach it
    warmup: {
      clientFiles: ["./src/main.tsx", "./src/App.tsx"],
    },
    proxy: {
      // Must come before the general "/api" rule below (Vite matches proxy
      // keys in declaration order by prefix) — this is a long-lived SSE
      // stream that's expected to sit idle between 25s keep-alive pings, so
      // it must NOT inherit the short fail-fast timeout used for ordinary
      // request/response API calls.
      "/api/notifications/stream": {
        target: "http://127.0.0.1:8081",
        changeOrigin: true,
        secure: false,
        agent: devProxyAgent,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Accept-Encoding", "identity");
          });
        },
      },
      "/api": {
        target: "http://127.0.0.1:8081",
        changeOrigin: true,
        secure: false,
        agent: devProxyAgent,
        // Safety net: if a proxied request still stalls (residual dev-only
        // flakiness in Vite's proxy under concurrent load), fail fast
        // instead of hanging indefinitely so the app's own retry logic can
        // recover in seconds rather than leaving the UI stuck loading.
        proxyTimeout: 8_000,
        timeout: 8_000,
        configure: (proxy) => {
          // Force backend to send uncompressed responses so Vite doesn't
          // mangle the chunked encoding when forwarding to the WebView.
          // NOTE: do NOT strip content-length/content-encoding here — since
          // the response is already guaranteed uncompressed (identity),
          // those headers are accurate. Deleting content-length without
          // adding Transfer-Encoding: chunked leaves the response length
          // ambiguous, which stalls the client on any response large enough
          // that it can't tell the body apart from a still-open connection.
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Accept-Encoding", "identity");
          });
        },
      },
      "/uploads": {
        target: "http://127.0.0.1:8081",
        changeOrigin: true,
        secure: false,
        agent: devProxyAgent,
        proxyTimeout: 8_000,
        timeout: 8_000,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Accept-Encoding", "identity");
          });
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-router-dom",
      "@tanstack/react-query",
      "framer-motion",
      "lucide-react",
      "axios",
      "zustand",
    ],
  },
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("lucide-react")) return "vendor-icons";
          return "vendor";
        },
      },
    },
  },
});
