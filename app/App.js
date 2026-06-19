import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
// On iOS this uses Apple Maps (no API key needed — works in Expo Go).
// Android / a production build needs a Google Maps API key wired into app.json
// under `android.config.googleMaps.apiKey` (and PROVIDER_GOOGLE). We deliberately
// leave the provider as the platform default so Expo Go testing needs no key.
import MapView, { Marker, Polyline } from "react-native-maps";
import { API_BASE } from "./config";

const QUEST_EMOJI = { photo: "📷", find_detail: "🔍", question: "❓", collect: "✨" };
const CHECKIN_RADIUS_M = 100; // how close you must be to check in

// Distance between two lat/lng points, in metres.
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// A map region that frames all the stops (and the user, if known) with padding.
// We compute deltas from the lat/lng bounds rather than leaning on fitToCoordinates,
// which is flaky on a static / non-interactive map.
function regionForStops(stops, coords) {
  const pts = stops.map((s) => ({ lat: s.place.lat, lng: s.place.lng }));
  if (coords) pts.push({ lat: coords.latitude, lng: coords.longitude });
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    // pad the span by ~40%, with a small floor so a tight cluster isn't over-zoomed
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.004),
    longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.004),
  };
}

// Total walked distance along the route (sum of consecutive stop-to-stop legs), in metres.
function totalWalkedM(stops) {
  let total = 0;
  for (let i = 1; i < stops.length; i++) {
    total += distanceM(
      stops[i - 1].place.lat,
      stops[i - 1].place.lng,
      stops[i].place.lat,
      stops[i].place.lng
    );
  }
  return total;
}

// A short, brag-worthy caption from a stop's lore (first sentence of lore_hook, trimmed).
function bragCaption(stop) {
  const text = (stop.lore_hook || stop.reason || "").trim();
  // Avoid lookbehind regex — Hermes (RN's default engine) doesn't support it.
  const idx = text.search(/[.!?]\s/);
  const firstSentence = idx === -1 ? text : text.slice(0, idx + 1);
  if (firstSentence.length <= 140) return firstSentence;
  return firstSentence.slice(0, 137).trimEnd() + "…";
}

// A compact, non-interactive route trace built from plain Views (numbered dots +
// rotated line segments). We deliberately avoid a live MapView here: native map
// surfaces frequently export blank under captureRef, and this trace must survive
// the screenshot as "journey proof" (UX-SPEC §3).
const TRACE_W = 96;
const TRACE_H = 96;
const TRACE_PAD = 14; // keep dots off the edge
function RouteTrace({ stops }) {
  const lats = stops.map((s) => s.place.lat);
  const lngs = stops.map((s) => s.place.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 1;
  const spanLng = maxLng - minLng || 1;
  const inner = { w: TRACE_W - TRACE_PAD * 2, h: TRACE_H - TRACE_PAD * 2 };
  // Map each stop to an (x, y) inside the padded box. Latitude grows upward, so flip y.
  const pts = stops.map((s) => ({
    x: TRACE_PAD + ((s.place.lng - minLng) / spanLng) * inner.w,
    y: TRACE_PAD + (1 - (s.place.lat - minLat) / spanLat) * inner.h,
  }));

  return (
    <View style={styles.trace}>
      {/* Connecting legs: a thin View per segment, rotated to point at the next dot. */}
      {pts.slice(1).map((p, i) => {
        const a = pts[i];
        const dx = p.x - a.x;
        const dy = p.y - a.y;
        const len = Math.hypot(dx, dy);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        return (
          <View
            key={`leg-${i}`}
            style={[
              styles.traceLeg,
              { left: a.x, top: a.y, width: len, transform: [{ rotate: `${angle}deg` }] },
            ]}
          />
        );
      })}
      {/* Numbered stop dots. */}
      {pts.map((p, i) => (
        <View key={`dot-${i}`} style={[styles.traceDot, { left: p.x - 9, top: p.y - 9 }]}>
          <Text style={styles.traceDotText}>{stops[i].order_index}</Text>
        </View>
      ))}
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState("welcome"); // welcome | loading | ready | error
  const [quest, setQuest] = useState(null);
  const [error, setError] = useState("");
  const [coords, setCoords] = useState(null); // live position
  const [progress, setProgress] = useState({}); // { [order_index]: { checkedIn, photoUri } }
  const recapRef = useRef(null); // the recap card we turn into a shareable image

  // Watch the user's location while a quest is active, so distances stay live.
  useEffect(() => {
    if (screen !== "ready") return;
    let sub;
    (async () => {
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
        (loc) => setCoords(loc.coords)
      );
    })();
    return () => sub && sub.remove();
  }, [screen]);

  async function startQuest() {
    setScreen("loading");
    setError("");
    setProgress({});
    setCoords(null);
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== "granted") {
        setError("We need your location to find an adventure nearby.");
        setScreen("error");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setCoords(loc.coords);
      const { latitude, longitude } = loc.coords;

      const res = await fetch(`${API_BASE}/quest?lat=${latitude}&lng=${longitude}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not build a quest here.");

      setQuest(data);
      setScreen("ready");
    } catch (e) {
      setError(`${e.message}\n\nIs the server running (npm run serve)?\nTrying: ${API_BASE}`);
      setScreen("error");
    }
  }

  function checkIn(orderIndex) {
    setProgress((p) => ({ ...p, [orderIndex]: { ...p[orderIndex], checkedIn: true } }));
  }

  async function takePhoto(orderIndex) {
    // Prefer the camera. Only fall back to the photo library when the camera
    // isn't available (e.g. a simulator) — not when the user simply cancels.
    let result;
    let cameraUsed = false;
    try {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (cam.status === "granted") {
        cameraUsed = true;
        result = await ImagePicker.launchCameraAsync({ quality: 0.5 });
      }
    } catch {
      cameraUsed = false; // no camera on this device — use the library instead
    }
    if (!cameraUsed) {
      result = await ImagePicker.launchImageLibraryAsync({ quality: 0.5 });
    }
    if (result && !result.canceled && result.assets?.[0]) {
      const uri = result.assets[0].uri;
      setProgress((p) => ({ ...p, [orderIndex]: { ...p[orderIndex], checkedIn: true, photoUri: uri } }));
    }
  }

  async function shareRecap() {
    try {
      const uri = await captureRef(recapRef, { format: "png", quality: 0.95 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      }
    } catch {
      /* sharing unavailable (e.g. some simulators) — ignore */
    }
  }

  // The 9:16 share-magnet recap (UX-SPEC §3). Built to pull in a stranger:
  // hero photo, brag-worthy fact caption, quest identity, route-trace proof,
  // one light stat, signature, and a filmstrip of the other photos.
  function renderRecap() {
    const photoStops = quest.stops.filter((s) => progress[s.order_index]?.photoUri);
    // Hero = first completed stop's photo (the spec's default).
    const heroStop = photoStops[0] || quest.stops[0];
    const heroUri = progress[heroStop.order_index]?.photoUri;
    const filmstrip = photoStops.filter((s) => s.order_index !== heroStop.order_index);
    const km = (totalWalkedM(quest.stops) / 1000).toFixed(1);

    return (
      <View style={styles.recapWrap}>
        {/* This 9:16 view is what captureRef exports as the shareable image. */}
        <View ref={recapRef} collapsable={false} style={styles.recapCard}>
          {/* Hero: the user's photography, full-bleed and large. */}
          <View style={styles.recapHeroWrap}>
            {heroUri ? (
              <Image source={{ uri: heroUri }} style={styles.recapHero} resizeMode="cover" />
            ) : (
              <View style={[styles.recapHero, styles.recapHeroFallback]} />
            )}
            {/* Brag-worthy fact caption overlaid on the hero — not a tally. */}
            <View style={styles.recapCaptionWrap}>
              <Text style={styles.recapCaption} numberOfLines={4}>
                {bragCaption(heroStop)}
              </Text>
            </View>
          </View>

          {/* Lower panel: quest identity, journey proof, stat, signature. */}
          <View style={styles.recapPanel}>
            <Text style={styles.recapTheme} numberOfLines={2}>
              {quest.theme}
            </Text>
            <Text style={styles.recapPlace} numberOfLines={1}>
              {quest.origin.label}
            </Text>

            <View style={styles.recapProofRow}>
              {/* Journey proof: a compact route trace (View-based, so it survives captureRef). */}
              <RouteTrace stops={quest.stops} />

              {/* Filmstrip of the other photos, subordinate to the hero. */}
              <View style={styles.recapFilmstrip}>
                {filmstrip.slice(0, 3).map((s) => (
                  <Image
                    key={s.order_index}
                    source={{ uri: progress[s.order_index].photoUri }}
                    style={styles.recapFilm}
                  />
                ))}
              </View>
            </View>

            <View style={styles.recapFooter}>
              <Text style={styles.recapStat}>
                {quest.stops.length} stops · {km} km explored
              </Text>
              <Text style={styles.recapMark}>DayQuest</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.actionBtn} onPress={shareRecap}>
          <Text style={styles.actionText}>📤 Share my adventure</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (screen === "welcome" || screen === "error") {
    return (
      <View style={styles.center}>
        <StatusBar style="dark" />
        <Text style={styles.logo}>DayQuest</Text>
        <Text style={styles.tagline}>Find a little adventure near you.</Text>
        {screen === "error" ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={startQuest}>
          <Text style={styles.buttonText}>{screen === "error" ? "Try again" : "Start a Quest"}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (screen === "loading") {
    return (
      <View style={styles.center}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.tagline}>Building your quest…</Text>
      </View>
    );
  }

  // screen === "ready"
  const doneCount = quest.stops.filter((s) => progress[s.order_index]?.photoUri).length;
  const allDone = doneCount === quest.stops.length;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <StatusBar style="dark" />
      <Text style={styles.theme}>{quest.theme}</Text>
      <Text style={styles.intro}>{quest.intro}</Text>
      <Text style={styles.progress}>
        {allDone ? "🎉 Quest complete!" : `${doneCount} of ${quest.stops.length} stops done`}
      </Text>

      {/* Overview map: numbered pins in walking order, the route line, and "you are here".
          Interactive (never captured), so a live MapView is safe here. */}
      <View style={styles.mapWrap}>
        <MapView
          style={styles.map}
          initialRegion={regionForStops(quest.stops, coords)}
          showsUserLocation
          showsMyLocationButton={false}
        >
          <Polyline
            coordinates={quest.stops.map((s) => ({ latitude: s.place.lat, longitude: s.place.lng }))}
            strokeColor={ACCENT}
            strokeWidth={4}
          />
          {quest.stops.map((s) => (
            <Marker
              key={s.order_index}
              coordinate={{ latitude: s.place.lat, longitude: s.place.lng }}
              title={s.place.name}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.pin}>
                <Text style={styles.pinText}>{s.order_index}</Text>
              </View>
            </Marker>
          ))}
        </MapView>
      </View>

      {allDone ? renderRecap() : null}

      {quest.stops.map((s) => {
        const state = progress[s.order_index] || {};
        const dist = coords ? distanceM(coords.latitude, coords.longitude, s.place.lat, s.place.lng) : null;
        const inRange = dist != null && dist <= CHECKIN_RADIUS_M;
        const completed = Boolean(state.photoUri);

        return (
          <View key={s.order_index} style={[styles.card, completed && styles.cardDone]}>
            <Text style={styles.stopTitle}>
              {completed ? "✓ " : ""}
              {s.order_index}. {s.place.name}
            </Text>
            <Text style={styles.distance}>
              {dist != null ? `${dist} m away` : `${s.place.distance_m} m from start`}
              {inRange ? " · you're here!" : ""}
            </Text>
            <Text style={styles.body}>{s.description}</Text>
            <Text style={styles.why}>Why: {s.reason}</Text>
            {s.lore_hook ? <Text style={styles.lore}>{s.lore_hook}</Text> : null}
            <View style={styles.questBox}>
              <Text style={styles.questText}>
                {QUEST_EMOJI[s.quest_type] || "🎯"}  {s.quest_prompt}
              </Text>
            </View>

            {/* Check-in → photo flow */}
            {state.photoUri ? (
              <Image source={{ uri: state.photoUri }} style={styles.photo} />
            ) : state.checkedIn ? (
              <TouchableOpacity style={styles.actionBtn} onPress={() => takePhoto(s.order_index)}>
                <Text style={styles.actionText}>📷 Take your photo</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, !inRange && styles.actionBtnDisabled]}
                  onPress={() => checkIn(s.order_index)}
                  disabled={!inRange}
                >
                  <Text style={styles.actionText}>
                    {inRange ? "📍 Check in here" : "Walk closer to check in"}
                  </Text>
                </TouchableOpacity>
                {/* Manual override so bad GPS never dead-ends the user */}
                <Text style={styles.override} onPress={() => checkIn(s.order_index)}>
                  Can't check in? I'm here →
                </Text>
              </>
            )}

            <Text style={styles.source} onPress={() => Linking.openURL(s.place.source_url)}>
              source ↗
            </Text>
          </View>
        );
      })}

      <TouchableOpacity style={styles.button} onPress={startQuest}>
        <Text style={styles.buttonText}>New Quest</Text>
      </TouchableOpacity>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const CREAM = "#f4f1ea";
const INK = "#2b2622";
const ACCENT = "#b5562e";
const GREEN = "#4a7c59";

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: CREAM, alignItems: "center", justifyContent: "center", padding: 28 },
  scroll: { flex: 1, backgroundColor: CREAM },
  scrollContent: { padding: 20, paddingTop: 64 },
  logo: { fontSize: 44, fontWeight: "800", color: INK, letterSpacing: -1 },
  tagline: { fontSize: 17, color: INK, opacity: 0.7, marginTop: 8, textAlign: "center" },
  error: { color: ACCENT, marginTop: 20, textAlign: "center", lineHeight: 20 },
  button: { backgroundColor: ACCENT, paddingVertical: 16, paddingHorizontal: 36, borderRadius: 30, marginTop: 28, alignSelf: "center" },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  theme: { fontSize: 30, fontWeight: "800", color: INK, letterSpacing: -0.5 },
  intro: { fontSize: 16, color: INK, opacity: 0.75, marginTop: 6, lineHeight: 22 },
  progress: { fontSize: 15, color: ACCENT, fontWeight: "700", marginTop: 12, marginBottom: 16 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 18, marginBottom: 16 },
  cardDone: { opacity: 0.7, borderWidth: 1, borderColor: GREEN },
  stopTitle: { fontSize: 20, fontWeight: "700", color: INK },
  distance: { fontSize: 13, color: ACCENT, fontWeight: "600", marginTop: 2, marginBottom: 8 },
  body: { fontSize: 15, color: INK, lineHeight: 21 },
  why: { fontSize: 14, color: INK, opacity: 0.7, marginTop: 6, fontStyle: "italic" },
  lore: { fontSize: 14, color: INK, opacity: 0.8, marginTop: 8, lineHeight: 20 },
  questBox: { backgroundColor: CREAM, borderRadius: 12, padding: 12, marginTop: 12 },
  questText: { fontSize: 15, color: INK, fontWeight: "600" },
  actionBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 12 },
  actionBtnDisabled: { backgroundColor: "#cbb8a8" },
  actionText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  override: { fontSize: 13, color: ACCENT, textAlign: "center", marginTop: 10, textDecorationLine: "underline" },
  photo: { width: "100%", height: 180, borderRadius: 12, marginTop: 12 },
  source: { fontSize: 12, color: ACCENT, marginTop: 10 },

  // Overview map
  mapWrap: { height: 220, borderRadius: 16, overflow: "hidden", marginBottom: 16 },
  map: { ...StyleSheet.absoluteFillObject },
  pin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: ACCENT,
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  pinText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  // 9:16 share-magnet recap
  recapWrap: { marginBottom: 20, alignItems: "center" },
  recapCard: {
    width: "100%",
    aspectRatio: 9 / 16,
    backgroundColor: INK,
    borderRadius: 20,
    overflow: "hidden",
  },
  recapHeroWrap: { flex: 3, justifyContent: "flex-end" },
  recapHero: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  recapHeroFallback: { backgroundColor: "#3a342e" },
  recapCaptionWrap: {
    paddingHorizontal: 18,
    paddingTop: 40,
    paddingBottom: 16,
    // soft scrim so the caption reads over any photo
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  recapCaption: { color: "#fff", fontSize: 19, fontWeight: "700", lineHeight: 25 },
  recapPanel: { flex: 2, padding: 18, justifyContent: "space-between" },
  recapTheme: { color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  recapPlace: { color: ACCENT, fontSize: 14, fontWeight: "700", marginTop: 3 },
  recapProofRow: { flexDirection: "row", alignItems: "center", marginVertical: 12 },
  recapFilmstrip: { flex: 1, flexDirection: "row", marginLeft: 14, flexWrap: "wrap" },
  recapFilm: { width: 52, height: 52, borderRadius: 8, marginRight: 6, marginBottom: 6 },
  recapFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  recapStat: { color: "#fff", opacity: 0.7, fontSize: 13, fontWeight: "600" },
  recapMark: { fontSize: 15, fontWeight: "800", color: ACCENT, letterSpacing: 1 },

  // Route trace (View-based, capture-safe)
  trace: {
    width: TRACE_W,
    height: TRACE_H,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  traceLeg: {
    position: "absolute",
    height: 2,
    backgroundColor: ACCENT,
    transformOrigin: "left center",
  },
  traceDot: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: ACCENT,
    borderWidth: 1.5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  traceDotText: { color: "#fff", fontSize: 10, fontWeight: "800" },
});
