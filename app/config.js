import Constants from "expo-constants";

// The DayQuest API now runs in the cloud (Render), so the app works anywhere —
// no laptop, no same-Wi-Fi requirement, no `npm run serve`. This is the default.
//
// To point at a LOCAL dev server instead (e.g. testing server changes on your
// laptop over Wi-Fi), set `extra.API_URL` in app.json to your machine, e.g.
// "http://192.168.1.x:8787". When unset, we use the hosted server below.
const HOSTED_API = "https://dayquest.onrender.com";
const extraCfg = Constants.expoConfig?.extra || Constants.manifest?.extra || {};

export const API_BASE = extraCfg.API_URL || HOSTED_API;

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
