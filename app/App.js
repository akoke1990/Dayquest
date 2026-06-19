import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
// SDK 54 ships the new object-oriented FileSystem API at the package root
// (File / Directory / Paths). We use it to copy captured photos out of the
// ImagePicker cache — which iOS evicts — into the persistent document dir.
import { File, Directory, Paths } from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE, TEASER } from "./config";
// On iOS this uses Apple Maps (no API key needed — works in Expo Go).
// Android / a production build needs a Google Maps API key wired into app.json
// under `android.config.googleMaps.apiKey` (and PROVIDER_GOOGLE). We deliberately
// leave the provider as the platform default so Expo Go testing needs no key.
import MapView, { Marker, Polyline } from "react-native-maps";

const QUEST_EMOJI = { photo: "📷", find_detail: "🔍", question: "❓", collect: "✨" };
const CHECKIN_RADIUS_M = 100; // how close you must be to check in

// --- Local persistence (pause/resume) + anonymous analytics -----------------
const STORE_KEY = "dayquest.activeQuest.v1"; // { quest, progress }
const INSTALL_KEY = "dayquest.installId.v1";
const HISTORY_KEY = "dayquest.history.v1"; // [{ id, completed_at, theme, origin_label, stops:[{name,photoUri,source_url}], points, quest, progress }]
const SCORE_KEY = "dayquest.score.v1"; // { total, quests_completed, streak_weeks, last_week_index }

// Light scoring knobs (no levels grind, no leaderboards — UX is "a little win").
const POINTS_PER_QUEST = 100;
const POINTS_PER_PHOTO = 25;

// Persistent home for quest photos copied out of the ImagePicker cache.
const PHOTO_DIR = "dayquest-photos";

// One anonymous id per install, generated once. NO PII — just a random token.
let _installId = null;
async function getInstallId() {
  if (_installId) return _installId;
  try {
    let id = await AsyncStorage.getItem(INSTALL_KEY);
    if (!id) {
      id = `dq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      await AsyncStorage.setItem(INSTALL_KEY, id);
    }
    _installId = id;
    return id;
  } catch {
    return null;
  }
}

// Fire-and-forget analytics. A dead server must NEVER break the quest flow —
// every failure is swallowed so check-in / photo / share keep working offline.
function track(event, props = {}) {
  (async () => {
    try {
      const install_id = await getInstallId();
      await fetch(`${API_BASE}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, install_id, props, ts: new Date().toISOString() }),
      });
    } catch {
      /* offline / no server — analytics is best-effort only */
    }
  })();
}

// Same fire-and-forget contract for tester feedback.
function sendFeedback(payload) {
  (async () => {
    try {
      const install_id = await getInstallId();
      await fetch(`${API_BASE}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, install_id, ts: new Date().toISOString() }),
      });
    } catch {
      /* best-effort */
    }
  })();
}

// Copy a captured photo from the ImagePicker cache into the app's persistent
// document directory and return the durable file:// uri. iOS evicts cache-dir
// uris, so saved quests would otherwise lose their photos across restarts.
// Best-effort: on any failure we fall back to the original (cache) uri so the
// in-session flow never breaks.
async function persistPhoto(cacheUri) {
  try {
    const dir = new Directory(Paths.document, PHOTO_DIR);
    dir.create({ intermediates: true, idempotent: true });
    // Keep the original extension; name by time + randomness to avoid collisions.
    const dot = cacheUri.lastIndexOf(".");
    const ext = dot > cacheUri.lastIndexOf("/") ? cacheUri.slice(dot) : ".jpg";
    const name = `dq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const src = new File(cacheUri);
    const dest = new File(dir, name);
    src.copy(dest);
    return dest.uri;
  } catch {
    return cacheUri; // fall back to the cache uri — better than no photo
  }
}

// A monotonic week index: snap a date to the Monday of its ISO week and divide
// by 7 days. This increments by exactly 1 each week and never resets at a year
// boundary, so "consecutive weeks" math stays correct (unlike ISO week NUMBER).
function weekIndex(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay(): 0=Sun..6=Sat. Shift so Monday is the start of the week.
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow); // back up to Monday
  return Math.floor(d.getTime() / (7 * 24 * 60 * 60 * 1000));
}

// Read the lifetime score, tolerating a missing/corrupt blob.
async function readScore() {
  try {
    const raw = await AsyncStorage.getItem(SCORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        total: s.total || 0,
        quests_completed: s.quests_completed || 0,
        streak_weeks: s.streak_weeks || 0,
        last_week_index: s.last_week_index ?? null,
      };
    }
  } catch {
    /* corrupt — start fresh */
  }
  return { total: 0, quests_completed: 0, streak_weeks: 0, last_week_index: null };
}

// Apply one completed quest to the score: add points, bump the count, and roll
// the WEEKLY streak (consecutive ISO weeks with ≥1 completion — per product
// decision, weekly NOT daily). Returns the new score so the caller can render.
async function recordScore(pointsEarned) {
  const prev = await readScore();
  const wk = weekIndex();
  let streak = prev.streak_weeks;
  if (prev.last_week_index == null) streak = 1; // first ever completion
  else if (wk === prev.last_week_index) streak = prev.streak_weeks || 1; // same week — no change
  else if (wk === prev.last_week_index + 1) streak = prev.streak_weeks + 1; // next week — extend
  else streak = 1; // a gap — streak resets
  const next = {
    total: prev.total + pointsEarned,
    quests_completed: prev.quests_completed + 1,
    streak_weeks: streak,
    last_week_index: wk,
  };
  await AsyncStorage.setItem(SCORE_KEY, JSON.stringify(next)).catch(() => {});
  return next;
}

// Read the saved quest history (newest-first list), tolerating missing/corrupt.
async function readHistory() {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch {
    /* corrupt — treat as empty */
  }
  return [];
}

// Append one completed quest to the history log (prepended so it reads
// newest-first). Stores the lean summary the spec asks for PLUS a full quest +
// progress snapshot so the existing recap card can re-render unchanged.
async function appendHistory(record) {
  const list = await readHistory();
  list.unshift(record);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(list)).catch(() => {});
  return list;
}

// A short, human date for a history row, e.g. "Jun 19, 2026".
function formatHistoryDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

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
  const [screen, setScreen] = useState("hydrating"); // hydrating | welcome | loading | ready | error
  const [quest, setQuest] = useState(null);
  const [error, setError] = useState("");
  const [coords, setCoords] = useState(null); // live position
  const [progress, setProgress] = useState({}); // { [order_index]: { checkedIn, photoUri } }
  const [saved, setSaved] = useState(null); // an in-progress quest restored from disk (for Resume)
  const [feedbackRating, setFeedbackRating] = useState(null); // "up" | "down"
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [flagged, setFlagged] = useState({}); // { [order_index]: true } — stop reported
  const [score, setScore] = useState({ total: 0, quests_completed: 0, streak_weeks: 0 }); // lifetime, shown on Welcome
  const [pointsEarned, setPointsEarned] = useState(0); // points from the just-finished quest (recap badge)
  const [history, setHistory] = useState([]); // saved past quests, newest-first
  const [historyRecord, setHistoryRecord] = useState(null); // a past quest opened from "My Quests"
  const recapRef = useRef(null); // the recap card we turn into a shareable image
  const completedFiredRef = useRef(false); // guard so quest_completed fires once

  // On launch: ensure an install id exists, then check for an in-progress quest
  // to offer a Resume. We do this BEFORE showing Welcome to avoid a flash of the
  // no-resume state. "In progress" = saved quest exists and not all stops done.
  useEffect(() => {
    (async () => {
      getInstallId();
      // Load lifetime score so Welcome can show the running total + streak.
      readScore().then(setScore).catch(() => {});
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const q = parsed?.quest;
          const prog = parsed?.progress || {};
          const done = q ? q.stops.filter((s) => prog[s.order_index]?.photoUri).length : 0;
          if (q && done < q.stops.length) setSaved(parsed);
        }
      } catch {
        /* corrupt/missing — just start fresh */
      }
      setScreen("welcome");
    })();
  }, []);

  // Persist the active quest + progress whenever it changes while playing, so
  // the quest survives an app close (UX-SPEC §1.7).
  useEffect(() => {
    if (screen !== "ready" || !quest) return;
    AsyncStorage.setItem(STORE_KEY, JSON.stringify({ quest, progress })).catch(() => {});
  }, [screen, quest, progress]);

  // Watch the user's location while a quest is active, so distances stay live.
  useEffect(() => {
    if (screen !== "ready") return;
    let sub;
    (async () => {
      try {
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
          (loc) => setCoords(loc.coords)
        );
      } catch {
        /* permission may not be granted on a resumed quest — distances just stay null */
      }
    })();
    return () => sub && sub.remove();
  }, [screen]);

  // Fire quest_completed exactly once, when the last stop's photo lands.
  useEffect(() => {
    if (screen !== "ready" || !quest) return;
    const done = quest.stops.filter((s) => progress[s.order_index]?.photoUri).length;
    if (done === quest.stops.length && !completedFiredRef.current) {
      completedFiredRef.current = true;
      track("quest_completed", { stops: quest.stops.length });

      // --- Light scoring + history (all ON-DEVICE, no login/server) --------
      const photoCount = quest.stops.filter((s) => progress[s.order_index]?.photoUri).length;
      const earned = POINTS_PER_QUEST + photoCount * POINTS_PER_PHOTO;
      setPointsEarned(earned);

      (async () => {
        // Append to the persisted history log. We store the lean summary the
        // spec asks for AND a full quest+progress snapshot so the recap card
        // re-renders unchanged when this quest is reopened from "My Quests".
        const record = {
          id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          completed_at: new Date().toISOString(),
          theme: quest.theme,
          origin_label: quest.origin?.label || "",
          stops: quest.stops.map((s) => ({
            name: s.place?.name || "",
            photoUri: progress[s.order_index]?.photoUri || null,
            source_url: s.place?.source_url || null,
          })),
          points: earned,
          quest, // full snapshot — recap needs lat/lng, lore_hook, intro
          progress, // { [order_index]: { photoUri, ... } } — recap reads this
        };
        const list = await appendHistory(record);
        setHistory(list);

        // Roll the lifetime total, count, and weekly streak.
        const next = await recordScore(earned);
        setScore(next);
        // Local data only — but fire an analytics ping that points were earned.
        track("points_earned", { points: earned, total: next.total, streak_weeks: next.streak_weeks });
      })();

      // Completed quests should not reappear as a "Resume" offer.
      AsyncStorage.removeItem(STORE_KEY).catch(() => {});
    }
  }, [screen, quest, progress]);

  async function startQuest() {
    setScreen("loading");
    setError("");
    setProgress({});
    setCoords(null);
    setFeedbackRating(null);
    setFeedbackText("");
    setFeedbackSent(false);
    setFlagged({});
    setPointsEarned(0);
    completedFiredRef.current = false;
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
      setSaved(null);
      setScreen("ready");
      track("quest_started", { stops: data.stops?.length });
    } catch (e) {
      setError(`${e.message}\n\nIs the server running (npm run serve)?\nTrying: ${API_BASE}`);
      setScreen("error");
    }
  }

  // Restore an in-progress quest from disk (UX-SPEC §1.1 / §1.7).
  function resumeQuest() {
    if (!saved?.quest) return;
    setQuest(saved.quest);
    setProgress(saved.progress || {});
    setCoords(null);
    setFeedbackRating(null);
    setFeedbackText("");
    setFeedbackSent(false);
    setFlagged({});
    setPointsEarned(0);
    const done = saved.quest.stops.filter((s) => saved.progress?.[s.order_index]?.photoUri).length;
    completedFiredRef.current = done === saved.quest.stops.length;
    setSaved(null);
    setScreen("ready");
    track("quest_resumed", { stops: saved.quest.stops?.length });
  }

  // Clear saved state — a deliberate abandon (UX-SPEC §1.7, an abandonment signal).
  function commitAbandon() {
    track("quest_abandoned");
    AsyncStorage.removeItem(STORE_KEY).catch(() => {});
    setSaved(null);
    setQuest(null);
    setProgress({});
    setScreen("welcome");
  }

  // One gentle confirm before we throw away an in-progress quest (UX-SPEC §1.7).
  function abandonQuest() {
    Alert.alert(
      "Abandon this quest?",
      "Your progress and photos for this quest will be cleared.",
      [
        { text: "Keep going", style: "cancel" },
        { text: "Abandon", style: "destructive", onPress: commitAbandon },
      ]
    );
  }

  function flagStop(stop) {
    if (flagged[stop.order_index]) return;
    setFlagged((f) => ({ ...f, [stop.order_index]: true }));
    sendFeedback({
      kind: "stop_flag",
      stop_name: stop.place?.name,
      source_url: stop.place?.source_url,
      reason: "Tester flagged this stop from the stop card.",
      theme: quest?.theme,
    });
  }

  function submitFeedback() {
    sendFeedback({ kind: "quest", rating: feedbackRating, text: feedbackText.trim() || null, theme: quest?.theme });
    setFeedbackSent(true);
  }

  function checkIn(orderIndex) {
    setProgress((p) => ({ ...p, [orderIndex]: { ...p[orderIndex], checkedIn: true } }));
    track("stop_checked_in", { order_index: orderIndex });
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
      // Copy the photo out of the (evictable) ImagePicker cache into the app's
      // persistent document dir, then store THAT uri so saved quests keep their
      // photos across restarts. Falls back to the cache uri on any failure.
      const uri = await persistPhoto(result.assets[0].uri);
      setProgress((p) => ({ ...p, [orderIndex]: { ...p[orderIndex], checkedIn: true, photoUri: uri } }));
      track("stop_photo", { order_index: orderIndex });
    }
  }

  // Open the "My Quests" history screen, loading the saved list fresh from disk.
  async function openHistory() {
    const list = await readHistory();
    setHistory(list);
    setHistoryRecord(null);
    setScreen("history");
    track("history_opened", { count: list.length });
  }

  async function shareRecap() {
    track("shared");
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
  // Renders the 9:16 share-magnet recap. Defaults to the live quest/progress,
  // but accepts an explicit quest + progress so a past quest opened from the
  // "My Quests" history screen re-renders with this exact same card.
  function renderRecap(q = quest, prog = progress, earned = pointsEarned) {
    const photoStops = q.stops.filter((s) => prog[s.order_index]?.photoUri);
    // Hero = first completed stop's photo (the spec's default).
    const heroStop = photoStops[0] || q.stops[0];
    const heroUri = prog[heroStop.order_index]?.photoUri;
    const filmstrip = photoStops.filter((s) => s.order_index !== heroStop.order_index);
    const km = (totalWalkedM(q.stops) / 1000).toFixed(1);

    return (
      <View style={styles.recapWrap}>
        {earned > 0 ? (
          <View style={styles.pointsBadge}>
            <Text style={styles.pointsBadgeText}>You earned {earned} points!</Text>
          </View>
        ) : null}
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
              {q.theme}
            </Text>
            <Text style={styles.recapPlace} numberOfLines={1}>
              {q.origin.label}
            </Text>

            <View style={styles.recapProofRow}>
              {/* Journey proof: a compact route trace (View-based, so it survives captureRef). */}
              <RouteTrace stops={q.stops} />

              {/* Filmstrip of the other photos, subordinate to the hero. */}
              <View style={styles.recapFilmstrip}>
                {filmstrip.slice(0, 3).map((s) => (
                  <Image
                    key={s.order_index}
                    source={{ uri: prog[s.order_index].photoUri }}
                    style={styles.recapFilm}
                  />
                ))}
              </View>
            </View>

            <View style={styles.recapFooter}>
              <Text style={styles.recapStat}>
                {q.stops.length} stops · {km} km explored
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

  if (screen === "hydrating") {
    return (
      <View style={styles.center}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
  }

  if (screen === "welcome" || screen === "error") {
    const savedQuest = saved?.quest;
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.welcomeContent}>
        <StatusBar style="dark" />
        <Text style={styles.logo}>DayQuest</Text>
        <Text style={styles.tagline}>Find a little adventure near you.</Text>

        {/* Lifetime score + weekly streak — shown once anything's been earned. */}
        {score.total > 0 ? (
          <View style={styles.scoreRow}>
            <View style={styles.scoreStat}>
              <Text style={styles.scoreNum}>{score.total}</Text>
              <Text style={styles.scoreLabel}>points</Text>
            </View>
            <View style={styles.scoreStat}>
              <Text style={styles.scoreNum}>{score.quests_completed}</Text>
              <Text style={styles.scoreLabel}>quests</Text>
            </View>
            <View style={styles.scoreStat}>
              <Text style={styles.scoreNum}>🔥 {score.streak_weeks}</Text>
              <Text style={styles.scoreLabel}>week streak</Text>
            </View>
          </View>
        ) : null}

        {/* Resume sits above the fold when a quest is in progress (UX-SPEC §1.1). */}
        {savedQuest ? (
          <View style={styles.resumeBox}>
            <Text style={styles.resumeLabel}>You have a quest in progress</Text>
            <Text style={styles.resumeTheme} numberOfLines={2}>{savedQuest.theme}</Text>
            <TouchableOpacity style={styles.button} onPress={resumeQuest}>
              <Text style={styles.buttonText}>Resume your quest</Text>
            </TouchableOpacity>
            <Text style={styles.abandonLink} onPress={abandonQuest}>
              Abandon quest
            </Text>
          </View>
        ) : null}

        {/* Delight before any ask: a permission-free "surprising place near you"
            teaser (UX-SPEC §2). Static — does NOT call /quest. */}
        <View style={styles.teaserCard}>
          <Text style={styles.teaserKicker}>A surprising place near you</Text>
          <Text style={styles.teaserPlace}>{TEASER.place}</Text>
          <Text style={styles.teaserFact}>{TEASER.fact}</Text>
          <Text style={styles.teaserArea}>{TEASER.area}</Text>
        </View>

        {screen === "error" ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={startQuest}>
          <Text style={styles.buttonText}>{screen === "error" ? "Try again" : "Start a Quest"}</Text>
        </TouchableOpacity>
        {/* Plain-language permission framing, shown before the OS dialog. */}
        <Text style={styles.permNote}>
          We'll use your location to find places to explore — only while you're on a quest.
        </Text>

        {/* Entry point to the on-device saved-quest history. */}
        <Text style={styles.historyLink} onPress={openHistory}>
          📜 My Quests
        </Text>
      </ScrollView>
    );
  }

  if (screen === "history") {
    // Detail view: reuse the exact recap card for a saved quest.
    if (historyRecord) {
      return (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <StatusBar style="dark" />
          <Text style={styles.backLink} onPress={() => setHistoryRecord(null)}>
            ← My Quests
          </Text>
          <Text style={styles.theme}>{historyRecord.theme}</Text>
          <Text style={styles.progress}>{formatHistoryDate(historyRecord.completed_at)}</Text>
          {/* Pass the saved snapshot + its earned points into the shared recap. */}
          {renderRecap(historyRecord.quest, historyRecord.progress, historyRecord.points || 0)}
          <View style={{ height: 40 }} />
        </ScrollView>
      );
    }
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <StatusBar style="dark" />
        <Text style={styles.backLink} onPress={() => setScreen("welcome")}>
          ← Back
        </Text>
        <Text style={styles.theme}>My Quests</Text>
        {history.length === 0 ? (
          <Text style={styles.intro}>
            No quests yet. Finish one and it'll be saved here — with your photos.
          </Text>
        ) : (
          history.map((rec) => {
            const thumb = rec.stops?.find((s) => s.photoUri)?.photoUri || null;
            return (
              <TouchableOpacity
                key={rec.id}
                style={styles.histRow}
                onPress={() => setHistoryRecord(rec)}
              >
                {thumb ? (
                  <Image source={{ uri: thumb }} style={styles.histThumb} />
                ) : (
                  <View style={[styles.histThumb, styles.histThumbEmpty]} />
                )}
                <View style={styles.histRowText}>
                  <Text style={styles.histTheme} numberOfLines={2}>{rec.theme}</Text>
                  <Text style={styles.histMeta}>
                    {formatHistoryDate(rec.completed_at)} · {rec.points} pts
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
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
      <View style={styles.headerRow}>
        <Text style={[styles.theme, { flex: 1 }]}>{quest.theme}</Text>
        {/* Always-available pause/abandon (UX-SPEC §1.7). */}
        <Text style={styles.abandonHeader} onPress={abandonQuest}>Abandon</Text>
      </View>
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

      {/* Quick delight signal + optional note after completion (UX-SPEC §1.8). */}
      {allDone ? (
        <View style={styles.feedbackCard}>
          {feedbackSent ? (
            <Text style={styles.feedbackThanks}>Thanks — that helps us pick better places. 🙏</Text>
          ) : (
            <>
              <Text style={styles.feedbackQ}>How was this quest?</Text>
              <View style={styles.feedbackThumbs}>
                <Text
                  style={[styles.thumb, feedbackRating === "up" && styles.thumbActive]}
                  onPress={() => setFeedbackRating("up")}
                >
                  👍
                </Text>
                <Text
                  style={[styles.thumb, feedbackRating === "down" && styles.thumbActive]}
                  onPress={() => setFeedbackRating("down")}
                >
                  👎
                </Text>
              </View>
              <TextInput
                style={styles.feedbackInput}
                placeholder="Anything we should know? (optional)"
                placeholderTextColor="#9a8e80"
                value={feedbackText}
                onChangeText={setFeedbackText}
                maxLength={500}
              />
              <TouchableOpacity
                style={[styles.actionBtn, feedbackRating == null && !feedbackText.trim() && styles.actionBtnDisabled]}
                onPress={submitFeedback}
                disabled={feedbackRating == null && !feedbackText.trim()}
              >
                <Text style={styles.actionText}>Send feedback</Text>
              </TouchableOpacity>
            </>
          )}
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

            <View style={styles.cardFooter}>
              <Text style={styles.source} onPress={() => Linking.openURL(s.place.source_url)}>
                source ↗
              </Text>
              {/* Per-stop flag (UX-SPEC learning loop) — records name + source + reason. */}
              <Text style={styles.flagLink} onPress={() => flagStop(s)}>
                {flagged[s.order_index] ? "✓ flagged — thanks" : "something off with this stop?"}
              </Text>
            </View>
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
  welcomeContent: { padding: 24, paddingTop: 88, alignItems: "center" },

  // Welcome teaser + resume
  teaserCard: { backgroundColor: "#fff", borderRadius: 18, padding: 20, marginTop: 28, width: "100%", borderWidth: 1, borderColor: "#e6dfd2" },
  teaserKicker: { fontSize: 12, fontWeight: "800", color: ACCENT, letterSpacing: 1, textTransform: "uppercase" },
  teaserPlace: { fontSize: 22, fontWeight: "800", color: INK, marginTop: 6, letterSpacing: -0.3 },
  teaserFact: { fontSize: 15, color: INK, opacity: 0.82, marginTop: 8, lineHeight: 22 },
  teaserArea: { fontSize: 13, color: GREEN, fontWeight: "700", marginTop: 10 },
  permNote: { fontSize: 12, color: INK, opacity: 0.55, textAlign: "center", marginTop: 14, lineHeight: 17 },
  // Lifetime score + weekly streak strip on Welcome
  scoreRow: { flexDirection: "row", marginTop: 20, width: "100%", justifyContent: "space-around", backgroundColor: "#fff", borderRadius: 16, paddingVertical: 14, borderWidth: 1, borderColor: "#e6dfd2" },
  scoreStat: { alignItems: "center" },
  scoreNum: { fontSize: 22, fontWeight: "800", color: INK },
  scoreLabel: { fontSize: 12, color: INK, opacity: 0.6, marginTop: 2 },
  historyLink: { fontSize: 15, color: ACCENT, fontWeight: "700", marginTop: 24, textDecorationLine: "underline" },

  // Points-earned badge on the completion recap
  pointsBadge: { backgroundColor: GREEN, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 20, marginBottom: 14 },
  pointsBadgeText: { color: "#fff", fontSize: 17, fontWeight: "800" },

  // My Quests history screen
  backLink: { fontSize: 15, color: ACCENT, fontWeight: "700", marginBottom: 10 },
  histRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, padding: 12, marginTop: 12, borderWidth: 1, borderColor: "#e6dfd2" },
  histThumb: { width: 56, height: 56, borderRadius: 10, marginRight: 14 },
  histThumbEmpty: { backgroundColor: "#e6dfd2" },
  histRowText: { flex: 1 },
  histTheme: { fontSize: 16, fontWeight: "800", color: INK },
  histMeta: { fontSize: 13, color: INK, opacity: 0.6, marginTop: 4 },

  resumeBox: { backgroundColor: "#fff", borderRadius: 18, padding: 18, marginTop: 24, width: "100%", borderWidth: 1, borderColor: GREEN, alignItems: "center" },
  resumeLabel: { fontSize: 13, fontWeight: "700", color: GREEN },
  resumeTheme: { fontSize: 18, fontWeight: "800", color: INK, marginTop: 4, textAlign: "center" },
  abandonLink: { fontSize: 13, color: ACCENT, textDecorationLine: "underline", marginTop: 12 },

  // Active-screen header + abandon
  headerRow: { flexDirection: "row", alignItems: "flex-start" },
  abandonHeader: { fontSize: 13, color: ACCENT, fontWeight: "700", marginTop: 8, marginLeft: 12 },

  // Feedback card
  feedbackCard: { backgroundColor: "#fff", borderRadius: 16, padding: 18, marginBottom: 16 },
  feedbackQ: { fontSize: 17, fontWeight: "700", color: INK },
  feedbackThumbs: { flexDirection: "row", marginTop: 10, marginBottom: 4 },
  thumb: { fontSize: 30, marginRight: 18, opacity: 0.4 },
  thumbActive: { opacity: 1 },
  feedbackInput: { borderWidth: 1, borderColor: "#e6dfd2", borderRadius: 10, padding: 12, fontSize: 15, color: INK, marginTop: 10, backgroundColor: CREAM },
  feedbackThanks: { fontSize: 15, color: GREEN, fontWeight: "700" },

  // Per-stop flag
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  flagLink: { fontSize: 12, color: INK, opacity: 0.5, textDecorationLine: "underline" },
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
  source: { fontSize: 12, color: ACCENT },

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
