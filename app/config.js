import Constants from "expo-constants";

// Your phone can't reach the laptop's "localhost". When you run `npx expo start`,
// Expo knows the laptop's LAN address — we reuse it and just swap to the API
// port (8787). That means you can test on a real phone with zero edits, as long
// as the phone and laptop are on the same Wi-Fi and `npm run serve` is running.
function detectApiBase() {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    Constants.manifest?.debuggerHost;
  if (hostUri) {
    const host = hostUri.split(":")[0];
    return `http://${host}:8787`;
  }
  return "http://localhost:8787"; // web / simulator fallback
}

export const API_BASE = detectApiBase();
