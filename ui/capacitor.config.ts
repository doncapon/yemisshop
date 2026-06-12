import type { CapacitorConfig } from "@capacitor/cli";

// When CAPACITOR_DEV_SERVER_URL is set, Capacitor loads the WebView from that
// URL instead of the built dist/ folder. The Vite proxy then forwards /api/*
// to your local backend — no localhost confusion in the emulator.
//
// Emulator:   CAPACITOR_DEV_SERVER_URL=http://10.0.2.2:5173
// Real device: CAPACITOR_DEV_SERVER_URL=http://<your-LAN-IP>:5173
const devUrl = process.env.CAPACITOR_DEV_SERVER_URL?.trim() || undefined;

const config: CapacitorConfig = {
  appId: "com.dayspringhouse.app",
  appName: "DaySpring",
  webDir: "dist",

  android: {
    backgroundColor: "#ffffff",
  },

  server: {
    // Use https scheme on Android so cookies & CORS work the same as web
    androidScheme: "https",
    ...(devUrl ? { url: devUrl, cleartext: true } : {}),
  },

  plugins: {
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#ffffff",
      overlaysWebView: false,
    },

    SplashScreen: {
      launchShowDuration: 1800,
      launchAutoHide: true,
      backgroundColor: "#ffffff",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },

    App: {
      // Deep-link scheme: dayspring://
      // Configure in Google Play / App Store as well
    },

    // Route all fetch/XHR through Android's native OkHttp client instead of
    // the WebView's Chromium network stack. This fixes ERR_INVALID_CHUNKED_ENCODING
    // and ERR_CONTENT_LENGTH_MISMATCH that Chrome WebView has with proxied responses.
    CapacitorHttp: {
      enabled: true,
    },

    CapacitorCookies: {
      enabled: true,
    },
  },
};

export default config;
