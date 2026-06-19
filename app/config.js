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

// The configured test area for the first friendly tester round.
// Used as a coarse, permission-FREE default so the Welcome teaser can render
// before we ever ask for GPS (UX-SPEC §2).
export const TEST_AREA = { lat: 40.9165, lng: -73.1412, label: "Stony Brook Village, NY" };

// A curated "surprising place near you" teaser shown on Welcome before any ask.
// This is STATIC on purpose — it must NOT hit /quest (the paid AI path) just to
// delight someone who hasn't started yet. Refresh per test round if desired.
export const TEASER = {
  place: "Stony Brook Grist Mill",
  fact: "Built in 1699, it literally reshaped the land — carving out the Mill Pond that still defines the village waterfront. One of the oldest surviving buildings on Long Island.",
  area: TEST_AREA.label,
};
