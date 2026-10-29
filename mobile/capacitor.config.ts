import type { CapacitorConfig } from "@capacitor/cli";

// The app loads the deployed REEF web app inside a native shell, so it always runs the
// latest release and the existing Supabase sign-in, API and Reefie chat work unchanged.
const WEB_APP_URL = process.env.REEF_WEB_URL ?? "https://reef-joe-d0a1.vercel.app";

const config: CapacitorConfig = {
  appId: "za.co.reef.operations",
  appName: "REEF",
  webDir: "www",
  server: {
    url: WEB_APP_URL,
    cleartext: false,
    errorPath: "offline.html",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: { launchShowDuration: 1200, backgroundColor: "#0d1b2a" },
    StatusBar: { style: "DARK", backgroundColor: "#0d1b2a" },
  },
};

export default config;
