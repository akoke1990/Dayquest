// This dynamic file is the single source of truth for Expo application config.
// Native Google Maps builds read their key from the selected EAS environment;
// the committed/default value intentionally stays blank.
const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || "";
const privacyPolicyUrl = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL || "";
const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL || "";
const supportUrl = process.env.EXPO_PUBLIC_SUPPORT_URL || "";

module.exports = {
  name: "DayQuest",
  slug: "dayquest",
  version: "1.0.0",
  scheme: "dayquest",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  plugins: [
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "DayQuest uses your location to find a scavenger hunt nearby.",
        locationAlwaysPermission: false,
        locationAlwaysAndWhenInUsePermission: false,
      },
    ],
    [
      "expo-image-picker",
      {
        cameraPermission:
          "DayQuest uses your camera so you can photograph each stop on your quest.",
        photosPermission:
          "DayQuest accesses your photos so you can pick an image for a stop.",
        microphonePermission: false,
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission:
          "DayQuest uses your camera so you can catch the collectible waiting at each place you discover.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    "expo-web-browser",
    "expo-apple-authentication",
    // Keep this last: expo-notifications autolinking may add aps-environment,
    // but DayQuest only schedules local notifications.
    "./plugins/with-local-notifications-only",
  ],
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.akoke18.dayquest",
    buildNumber: "1",
    usesAppleSignIn: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
    config: {
      googleMapsApiKey,
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    config: {
      googleMaps: {
        apiKey: googleMapsApiKey,
      },
    },
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  extra: {
    SUPABASE_URL: "https://xoonknhsurzwwahfhnjy.supabase.co",
    SUPABASE_ANON_KEY:
      "sb_publishable_oekh-4raDYaxlNsLqhOylQ_WwwF-AGE",
    GOOGLE_MAPS_API_KEY: googleMapsApiKey,
    PRIVACY_POLICY_URL: privacyPolicyUrl,
    TERMS_URL: termsUrl,
    SUPPORT_URL: supportUrl,
    eas: {
      projectId: "d590e873-0a0e-4d25-a78f-32478af4a91f",
    },
  },
};
