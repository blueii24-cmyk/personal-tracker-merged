import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android wrapper for the existing Personal Tracker web app.
 * Change `appId` BEFORE the first Play Store upload: it is permanent afterwards.
 * Keep the default https scheme: records live in the WebView's storage for the origin https://localhost, so
 * changing `androidScheme` or `hostname` later would make existing installs lose their records.
 */
const config: CapacitorConfig = {
  appId: "com.blueii24.personaltracker",
  appName: "Personal Tracker",
  webDir: "out",
  android: {
    // Only ever load the bundled app. No remote pages, no cleartext traffic.
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SystemBars: {
      // Edge-to-edge: the web layer receives the real insets and pads itself.
      insetsHandling: "css",
      style: "DEFAULT",
    },
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: "#f0f4f9",
      showSpinner: false,
    },
  },
};

export default config;
