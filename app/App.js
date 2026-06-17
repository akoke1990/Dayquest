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

      {allDone ? (
        <View style={styles.recapWrap}>
          {/* This view is captured as the shareable image */}
          <View ref={recapRef} collapsable={false} style={styles.recap}>
            <Text style={styles.badge}>🏅</Text>
            <Text style={styles.recapTitle}>{quest.theme}</Text>
            <Text style={styles.recapSub}>
              I explored {quest.stops.length} storied places near {quest.origin.label}.
            </Text>
            <View style={styles.recapPhotos}>
              {quest.stops.map((s) => {
                const uri = progress[s.order_index]?.photoUri;
                return (
                  <View key={s.order_index} style={styles.recapThumbWrap}>
                    {uri ? <Image source={{ uri }} style={styles.recapThumb} /> : null}
                    <Text style={styles.recapName} numberOfLines={1}>
                      {s.place.name}
                    </Text>
                  </View>
                );
              })}
            </View>
            <Text style={styles.recapMark}>DayQuest</Text>
          </View>
          <TouchableOpacity style={styles.actionBtn} onPress={shareRecap}>
            <Text style={styles.actionText}>📤 Share my adventure</Text>
          </TouchableOpacity>
        </View>
      ) : null}

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
  recapWrap: { marginBottom: 20 },
  recap: { backgroundColor: INK, borderRadius: 20, padding: 22, alignItems: "center" },
  badge: { fontSize: 52 },
  recapTitle: { fontSize: 24, fontWeight: "800", color: "#fff", textAlign: "center", marginTop: 6 },
  recapSub: { fontSize: 15, color: "#fff", opacity: 0.85, textAlign: "center", marginTop: 8, lineHeight: 21 },
  recapPhotos: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", marginTop: 16 },
  recapThumbWrap: { width: 92, margin: 4, alignItems: "center" },
  recapThumb: { width: 84, height: 84, borderRadius: 10 },
  recapName: { fontSize: 11, color: "#fff", opacity: 0.8, marginTop: 4, textAlign: "center" },
  recapMark: { fontSize: 14, fontWeight: "800", color: ACCENT, marginTop: 18, letterSpacing: 1 },
});
