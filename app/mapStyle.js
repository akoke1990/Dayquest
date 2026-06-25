// Pokémon-GO-ish stylized Google Maps style for react-native-maps `customMapStyle`.
//
// IMPORTANT: this only applies in a real dev/standalone build with PROVIDER_GOOGLE.
// In Expo Go (iOS) the map uses the default Apple Maps provider and this style is
// NOT passed (see App.js — gated on `Constants.appOwnership === 'expo'`), because
// PROVIDER_GOOGLE + customMapStyle does not work in Expo Go.
//
// Look: a soft, gently muted base with saturated-but-tasteful greens for parks /
// landscape, calm water, and de-cluttered POIs + simplified roads — readable, not
// garish. Standard Google Maps JSON style array.
const mapStyle = [
  // Gentle muted base for all geometry + readable labels.
  {
    elementType: "geometry",
    stylers: [{ color: "#eaf3e7" }],
  },
  {
    elementType: "labels.text.fill",
    stylers: [{ color: "#4a5a4f" }],
  },
  {
    elementType: "labels.text.stroke",
    stylers: [{ color: "#f6faf3" }, { weight: 2 }],
  },
  // De-clutter: hide most POI icons + business labels so the quest stops stand out.
  {
    featureType: "poi",
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi.business",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "transit",
    stylers: [{ visibility: "off" }],
  },
  // Parks: soft, saturated green — the signature Pokémon-GO landscape pop.
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#a8d8a0" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#4a7c59" }],
  },
  // Landscape: a slightly lighter, friendly green wash.
  {
    featureType: "landscape.natural",
    elementType: "geometry",
    stylers: [{ color: "#cfe8c4" }],
  },
  {
    featureType: "landscape.man_made",
    elementType: "geometry",
    stylers: [{ color: "#e3eede" }],
  },
  // Roads: simplified, light, low-contrast so they recede behind the route line.
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#ffffff" }],
  },
  {
    featureType: "road",
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "road.arterial",
    elementType: "geometry",
    stylers: [{ color: "#fbfbf7" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#f4e7c8" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#e6d3a8" }],
  },
  {
    featureType: "road.local",
    elementType: "labels",
    stylers: [{ visibility: "simplified" }],
  },
  // Water: calm, gentle blue (not neon).
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#9fd0e0" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#3f7c8c" }],
  },
  // Administrative boundaries: faint, so they don't compete with the route.
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ visibility: "off" }],
  },
];

export default mapStyle;
