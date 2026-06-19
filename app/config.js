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

// --- Supabase (OPTIONAL) -----------------------------------------------------
// Sign-in is optional and anonymous-first. When these are EMPTY (the default),
// the auth layer stays dormant and the app runs exactly as it does today —
// nothing is constructed, nothing can crash.
//
// Wire real values via `app.json` → `expo.extra` (or an env var at build time).
// We read from Expo's `extra` first, then fall back to process.env so a CI/EAS
// build can inject them, then to an empty string so the unconfigured path is
// the safe default. NEVER hardcode the keys here.
const extra = Constants.expoConfig?.extra || Constants.manifest?.extra || {};

export const SUPABASE_URL =
  extra.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY =
  extra.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

// The custom URL scheme the OAuth redirect comes back to. Mirrors app.json's
// `expo.scheme`. In Expo Go the redirect is proxied, but the scheme is still
// used to build the redirect URL.
export const APP_SCHEME = "dayquest";
