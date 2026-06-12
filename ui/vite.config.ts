import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0", // expose on LAN so emulator + real devices can reach it
    warmup: {
      clientFiles: ["./src/main.tsx", "./src/App.tsx"],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          // Force backend to send uncompressed responses so Vite doesn't
          // mangle the chunked encoding when forwarding to the WebView.
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Accept-Encoding", "identity");
          });
          proxy.on("proxyRes", (proxyRes) => {
            delete proxyRes.headers["content-length"];
            delete proxyRes.headers["content-encoding"];
          });
        },
      },
      "/uploads": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Accept-Encoding", "identity");
          });
          proxy.on("proxyRes", (proxyRes) => {
            delete proxyRes.headers["content-length"];
            delete proxyRes.headers["content-encoding"];
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
