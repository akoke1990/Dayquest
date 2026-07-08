// Dynamic Expo config.
//
// app.json stays the single source of truth for everything; this file only
// LAYERS ON the native Google Maps API key slots that a real build needs,
// reading the value from `expo.extra.GOOGLE_MAPS_API_KEY` (which lives in
// app.json, default ""). JSON can't interpolate or carry comments, hence this
// small dynamic config. Fully reversible: delete this file and Expo falls back
// to app.json exactly as before.
//
// Expo-Go-safe: dynamic config doesn't touch the JS bundle, and the keys below
// are only consumed by a native prebuild/standalone build — Expo Go ignores them.
//
// NOTE: the BUILT app needs the Google Maps key to have BOTH "Maps SDK for iOS"
// and "Maps SDK for Android" enabled in Google Cloud. Put the real key in
// app.json -> expo.extra.GOOGLE_MAPS_API_KEY (do NOT commit a real key).
const appJson = require("./app.json");

const expo = appJson.expo;
// Key resolution order: EAS env var first (set as a project env variable on
// expo.dev — injected on EAS build servers, so cloud builds get the real key
// without it ever living in git), then the app.json extra slot (the original
// laptop-local flow), then "".
const googleMapsApiKey =
  process.env.GOOGLE_MAPS_API_KEY ||
  (expo.extra && expo.extra.GOOGLE_MAPS_API_KEY) ||
  "";

module.exports = {
  ...expo,
  ios: {
    ...expo.ios,
    config: {
      ...(expo.ios && expo.ios.config),
      googleMapsApiKey,
    },
  },
  android: {
    ...expo.android,
    config: {
      ...(expo.android && expo.android.config),
      googleMaps: {
        apiKey: googleMapsApiKey,
      },
    },
  },
};
