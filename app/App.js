import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
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
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
// SDK 54 ships the new object-oriented FileSystem API at the package root
// (File / Directory / Paths). We use it to copy captured photos out of the
// ImagePicker cache — which iOS evicts — into the persistent document dir.
import { File, Directory, Paths } from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE, TEASER } from "./config";
// Optional, anonymous-first auth layer. `authConfigured` is false by default
// (empty Supabase keys), in which case every auth helper is a safe no-op and the
// sign-in UI is hidden — the app runs exactly as it does today.
import { authConfigured } from "./lib/supabase";
import {
  signInWithProvider,
  signOut,
  getCurrentUser,
  onAuthChange,
  profileFromUser,
  upsertProfile,
  loadProfile,
  pushScore,
} from "./lib/auth";
// On iOS this uses Apple Maps (no API key needed — works in Expo Go).
// Android / a production build needs a Google Maps API key wired into app.json
// under `android.config.googleMaps.apiKey` (and PROVIDER_GOOGLE). We deliberately
// leave the provider as the platform default so Expo Go testing needs no key.
import MapView, { Marker, Polyline } from "react-native-maps";

const QUEST_EMOJI = { photo: "📷", find_detail: "🔍", question: "❓", collect: "✨" };
const CHECKIN_RADIUS_M = 100; // how close you must be to check in
const SCREEN_H = Dimensions.get("window").height; // for sheet peek/expanded sizing

// --- Local persistence (pause/resume) + anonymous analytics -----------------
const STORE_KEY = "dayquest.activeQuest.v1"; // { quest, progress }
const INSTALL_KEY = "dayquest.installId.v1";
const HISTORY_KEY = "dayquest.history.v1"; // [{ id, completed_at, theme, origin_label, stops:[{name,photoUri,source_url}], points, quest, progress }]
const SCORE_KEY = "dayquest.score.v1"; // { total, quests_completed, streak_weeks, last_week_index }
// Per-Area discovery log (Collections). Honest running count — no fake denominator.
// { [areaLabel]: { discovered: { [placeKey]: { name, source_url, first_seen } } } }
const COLLECTIONS_KEY = "dayquest.collections.v1";
// Per-Area personal bests for the async scorecard.
// { [areaLabel]: { best_points, fastest_time_s, quests, last_at } }
const BESTS_KEY = "dayquest.bests.v1";

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

// Fire-and-forget completion score to the cross-user board sink (data/scores.jsonl).
// Separate from the `points_earned` analytics ping — this is the durable board
// capture. Like track(), a dead server must never break the quest flow.
function postScore({ area, theme, points, time_s }) {
  (async () => {
    try {
      const install_id = await getInstallId();
      await fetch(`${API_BASE}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area, theme, points, time_s, install_id, ts: new Date().toISOString() }),
      });
    } catch {
      /* offline / no server — board capture is best-effort only */
    }
  })();
}

// A stable id for a discovered place: prefer its source_url, else its name.
function placeKey(place) {
  return place?.source_url || place?.name || null;
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

// --- Collections (per-Area discovery sets) ----------------------------------
// Read the collections map, tolerating missing/corrupt.
async function readCollections() {
  try {
    const raw = await AsyncStorage.getItem(COLLECTIONS_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") return obj;
    }
  } catch {
    /* corrupt — start fresh */
  }
  return {};
}

// Record a completed quest's stops into the discovery set for its Area. Returns
// { collections, newCount } where newCount is how many places were NOT already
// discovered — that's the "+N new spots discovered" recap line. The delta is
// computed against the EXISTING set before merging.
async function recordCollections(areaLabel, stops) {
  const area = areaLabel || "Your Area";
  const collections = await readCollections();
  const entry = collections[area] || { discovered: {} };
  const discovered = { ...entry.discovered };
  const now = new Date().toISOString();
  let newCount = 0;
  for (const s of stops) {
    const key = placeKey(s.place);
    if (!key) continue;
    if (!discovered[key]) {
      newCount += 1;
      discovered[key] = { name: s.place?.name || "", source_url: s.place?.source_url || null, first_seen: now };
    }
  }
  collections[area] = { ...entry, discovered };
  await AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections)).catch(() => {});
  return { collections, newCount };
}

// --- Personal bests (per-Area, for the scorecard) ----------------------------
async function readBests() {
  try {
    const raw = await AsyncStorage.getItem(BESTS_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") return obj;
    }
  } catch {
    /* corrupt — start fresh */
  }
  return {};
}

// Fold one completion into the per-Area bests. `timeS` may be null (a quest
// started before we tracked start time, or a corrupt blob) — then we only
// consider the points best. Returns { bests, isPointsBest, isTimeBest }.
async function recordBest(areaLabel, points, timeS) {
  const area = areaLabel || "Your Area";
  const bests = await readBests();
  const prev = bests[area] || { best_points: 0, fastest_time_s: null, quests: 0 };
  // Only celebrate a "best" when there's a prior record to beat in this area —
  // the first quest in a new area sets the baseline, it doesn't "break" one.
  const hadPrior = (prev.quests || 0) > 0;
  const isPointsBest = hadPrior && points > (prev.best_points || 0);
  const validTime = Number.isFinite(timeS) && timeS > 0;
  const isTimeBest = validTime && prev.fastest_time_s != null && timeS < prev.fastest_time_s;
  bests[area] = {
    best_points: Math.max(prev.best_points || 0, points),
    fastest_time_s: isTimeBest ? timeS : (prev.fastest_time_s ?? (validTime ? timeS : null)),
    quests: (prev.quests || 0) + 1,
    last_at: new Date().toISOString(),
  };
  await AsyncStorage.setItem(BESTS_KEY, JSON.stringify(bests)).catch(() => {});
  return { bests, isPointsBest, isTimeBest };
}

// Format an elapsed-seconds value as a compact "12m 34s" / "1h 03m".
function formatDuration(s) {
  if (!Number.isFinite(s) || s <= 0) return "—";
  const sec = Math.round(s);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, "0")}s`;
  return `${r}s`;
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

// Total distance along a recorded GPS path (sum of consecutive haversine legs),
// in metres. This is the TRUE walked distance — distinct from totalWalkedM, which
// sums the planned straight-line legs between stops.
function pathDistanceM(path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += distanceM(path[i - 1].latitude, path[i - 1].longitude, path[i].latitude, path[i].longitude);
  }
  return total;
}

// Minimum recorded distance before we trust the GPS path enough to headline it
// as "you walked X km". Below this (empty path, manual-override completion with
// little movement, a couple of jittery points) we fall back to the planned loop.
const MIN_TRUSTED_WALK_M = 50;

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
// Plot an arbitrary geo path as a capture-safe View trace. Two modes:
//  - `routePath` ({latitude,longitude}[]): the REAL walked breadcrumb — many
//    points, drawn as a continuous line with small endpoint markers (start/end),
//    no per-point numbers.
//  - `stops` (stop[]): the planned-loop fallback — numbered dots per stop.
// `routePath` wins when it has ≥2 points; otherwise we fall back to `stops`.
function RouteTrace({ stops, routePath }) {
  const useWalked = Array.isArray(routePath) && routePath.length >= 2;
  const lats = useWalked ? routePath.map((p) => p.latitude) : stops.map((s) => s.place.lat);
  const lngs = useWalked ? routePath.map((p) => p.longitude) : stops.map((s) => s.place.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 1;
  const spanLng = maxLng - minLng || 1;
  const inner = { w: TRACE_W - TRACE_PAD * 2, h: TRACE_H - TRACE_PAD * 2 };
  // Map each geo point to an (x, y) inside the padded box. Latitude grows upward, so flip y.
  const project = (lat, lng) => ({
    x: TRACE_PAD + ((lng - minLng) / spanLng) * inner.w,
    y: TRACE_PAD + (1 - (lat - minLat) / spanLat) * inner.h,
  });
  const pts = useWalked
    ? routePath.map((p) => project(p.latitude, p.longitude))
    : stops.map((s) => project(s.place.lat, s.place.lng));

  return (
    <View style={styles.trace}>
      {/* Connecting legs: a thin View per segment, rotated to point at the next point. */}
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
              useWalked ? styles.traceLegWalked : styles.traceLeg,
              { left: a.x, top: a.y, width: len, transform: [{ rotate: `${angle}deg` }] },
            ]}
          />
        );
      })}
      {useWalked
        ? // Walked breadcrumb: just mark start (green) and end (gold), no numbers.
          [0, pts.length - 1].map((i) => (
            <View
              key={`end-${i}`}
              style={[
                styles.traceEndDot,
                i === 0 ? styles.traceStartDot : styles.traceFinishDot,
                { left: pts[i].x - 6, top: pts[i].y - 6 },
              ]}
            />
          ))
        : // Planned loop: numbered stop dots.
          pts.map((p, i) => (
            <View key={`dot-${i}`} style={[styles.traceDot, { left: p.x - 9, top: p.y - 9 }]}>
              <Text style={styles.traceDotText}>{stops[i].order_index}</Text>
            </View>
          ))}
    </View>
  );
}

// --- Celebration (hand-rolled with Animated; no reanimated/gesture-handler) --
// A lightweight, Expo-Go-safe completion celebration: a burst of confetti
// (absolutely-positioned Views falling + spinning + fading) plus an animated
// count-up to the points earned and a pop-in badge. Chosen over a confetti lib
// to keep the only new dep at expo-haptics and avoid native surface risk —
// per the spec's "when in doubt, hand-roll with Animated."
const CONFETTI_COLORS = ["#b5562e", "#4a7c59", "#e0a449", "#d98452", "#6b8f71"];
const CONFETTI_N = 22;

function Confetti({ width }) {
  // Build the particles once. Each falls from above the card to past its bottom,
  // drifting sideways and spinning, fading out near the end.
  const pieces = useRef(
    Array.from({ length: CONFETTI_N }).map((_, i) => ({
      key: i,
      left: Math.random() * Math.max(width - 12, 40),
      size: 7 + Math.random() * 7,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      drift: (Math.random() - 0.5) * 80,
      delay: Math.random() * 250,
      duration: 1100 + Math.random() * 700,
      spins: 1 + Math.random() * 2,
      anim: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    const anims = pieces.map((p) =>
      Animated.timing(p.anim, {
        toValue: 1,
        duration: p.duration,
        delay: p.delay,
        useNativeDriver: true,
      })
    );
    Animated.parallel(anims).start();
  }, [pieces]);

  return (
    <View pointerEvents="none" style={styles.confettiLayer}>
      {pieces.map((p) => {
        const translateY = p.anim.interpolate({ inputRange: [0, 1], outputRange: [-40, 260] });
        const translateX = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] });
        const rotate = p.anim.interpolate({
          inputRange: [0, 1],
          outputRange: ["0deg", `${p.spins * 360}deg`],
        });
        const opacity = p.anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });
        return (
          <Animated.View
            key={p.key}
            style={{
              position: "absolute",
              top: 0,
              left: p.left,
              width: p.size,
              height: p.size * 0.6,
              borderRadius: 2,
              backgroundColor: p.color,
              opacity,
              transform: [{ translateY }, { translateX }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}

// The headline "you did it" banner: confetti + an animated count-up to the
// points earned + a pop-in scale, plus the streak / new-spots reveal.
function Celebration({ play = true, points, streakWeeks, newSpots, elapsedS, isBest }) {
  const [shown, setShown] = useState(play ? 0 : points); // displayed count-up number
  const counter = useRef(new Animated.Value(play ? 0 : points)).current;
  const pop = useRef(new Animated.Value(play ? 0 : 1)).current;
  const [width, setWidth] = useState(320);

  useEffect(() => {
    if (!play) return; // re-open: render the banner statically, no buzz / no replay
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Pop-in the banner.
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }).start();
    // Count up to the points total over ~900ms.
    const id = counter.addListener(({ value }) => setShown(Math.round(value)));
    Animated.timing(counter, { toValue: points, duration: 900, useNativeDriver: false }).start();
    return () => counter.removeListener(id);
  }, [play, points]);

  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  return (
    <View style={styles.celebrateWrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {play ? <Confetti width={width} /> : null}
      <Animated.View style={[styles.celebrateBanner, { opacity: pop, transform: [{ scale }] }]}>
        <Text style={styles.celebrateTitle}>🎉 Quest complete!</Text>
        <Text style={styles.celebratePoints}>+{shown} points</Text>
        <View style={styles.celebrateChips}>
          {newSpots > 0 ? (
            <Text style={styles.celebrateChip}>
              ✦ {newSpots} new spot{newSpots === 1 ? "" : "s"}
            </Text>
          ) : null}
          {elapsedS != null ? (
            <Text style={styles.celebrateChip}>⏱ {formatDuration(elapsedS)}</Text>
          ) : null}
          {streakWeeks > 0 ? (
            <Text style={styles.celebrateChip}>🔥 {streakWeeks}-week streak</Text>
          ) : null}
        </View>
        {isBest ? <Text style={styles.celebrateBest}>⭐ New personal best!</Text> : null}
      </Animated.View>
    </View>
  );
}

// A game-like numbered map pin with a little scale-pop when it becomes the
// selected stop. Hand-rolled Animated (no gesture stack) — Expo-Go safe.
function MapPin({ orderIndex, completed, selected }) {
  const scale = useRef(new Animated.Value(selected ? 1 : 0.92)).current;
  useEffect(() => {
    Animated.spring(scale, {
      toValue: selected ? 1.18 : 1,
      friction: 5,
      tension: 90,
      useNativeDriver: true,
    }).start();
  }, [selected, scale]);
  return (
    <Animated.View
      style={[
        styles.pin,
        completed && styles.pinDone,
        selected && styles.pinSelected,
        { transform: [{ scale }] },
      ]}
    >
      <Text style={styles.pinText}>{completed ? "✓" : orderIndex}</Text>
    </Animated.View>
  );
}

export default function App() {
  const [screen, setScreen] = useState("hydrating"); // hydrating | welcome | loading | ready | error
  const [quest, setQuest] = useState(null);
  const [error, setError] = useState("");
  const [coords, setCoords] = useState(null); // live position
  // The actual path walked this quest: [{ latitude, longitude, t }]. State drives
  // the live map Polyline; the ref is the freshest copy the location callback
  // (which only closes over [screen]) and the completion effect read/write.
  const [routePath, setRoutePath] = useState([]);
  const routePathRef = useRef([]);
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
  const startedAtRef = useRef(null); // epoch ms when the active quest went live (for completion time)
  const celebratedRef = useRef(false); // guard so confetti + success haptic play once per quest

  // --- Collections + scorecard (single-player game layer) ----------------------
  const [collections, setCollections] = useState({}); // { [area]: { discovered: {...} } }
  const [bests, setBests] = useState({}); // { [area]: { best_points, fastest_time_s, quests } }
  const [expandedArea, setExpandedArea] = useState(null); // which Area's place list is open in Collections
  // Per-completion celebration facts, surfaced in the recap.
  const [newSpots, setNewSpots] = useState(0); // new places discovered this quest
  const [elapsedS, setElapsedS] = useState(null); // seconds to complete this quest
  const [bestFlags, setBestFlags] = useState({ points: false, time: false }); // "New personal best!"

  // --- Map-first active screen (Pokémon-GO style): floating controls + pop-outs --
  // `selectedStop` is the order_index of the stop whose detail is shown in the
  // pop-out card, or null when the map is clean. It is intentionally kept OUT of
  // the completion effect's deps so it never re-fires scoring/history.
  const [selectedStop, setSelectedStop] = useState(null);
  // The pop-out stop card and the completion overlay are each driven by a plain
  // Animated.Value (0→1) via Animated.timing/spring — no gesture-handler /
  // reanimated, so it's rock-solid in Expo Go SDK 54.
  const cardAnim = useRef(new Animated.Value(0)).current; // stop pop-out card
  const recapAnim = useRef(new Animated.Value(0)).current; // completion overlay
  // Whether the completion overlay is currently presented. Auto-presented once
  // when the quest first completes (false→true transition), re-openable via the
  // floating Recap button, dismissable back to the clean map.
  const [recapOpen, setRecapOpen] = useState(false);
  const recapAutoPresentedRef = useRef(false); // guard: auto-present completion once

  // Pop the stop card in/out whenever a stop is selected/deselected.
  useEffect(() => {
    Animated.spring(cardAnim, {
      toValue: selectedStop != null ? 1 : 0,
      friction: 7,
      tension: 70,
      useNativeDriver: true,
    }).start();
  }, [selectedStop, cardAnim]);

  // Fade/scale the completion overlay in/out.
  useEffect(() => {
    Animated.timing(recapAnim, {
      toValue: recapOpen ? 1 : 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [recapOpen, recapAnim]);

  // Tapping a map dot or a list row selects a stop → its pop-out card.
  // Tapping a second dot while a card is open SWAPS the content (re-selection).
  function selectStop(orderIndex) {
    setSelectedStop(orderIndex);
  }
  // Dismiss the pop-out card back to the clean map (X / tap-outside).
  function closeCard() {
    setSelectedStop(null);
  }

  // --- Optional auth (anonymous-first; all null/no-op when unconfigured) ------
  const [user, setUser] = useState(null); // Supabase auth user, or null
  const [profile, setProfile] = useState(null); // row from the `profiles` table
  const [authBusy, setAuthBusy] = useState(false); // sign-in/out in flight
  const [authError, setAuthError] = useState(""); // last sign-in error, if any
  const userRef = useRef(null); // latest user for the completion effect (avoids re-subscribing)
  userRef.current = user;

  // On launch: ensure an install id exists, then check for an in-progress quest
  // to offer a Resume. We do this BEFORE showing Welcome to avoid a flash of the
  // no-resume state. "In progress" = saved quest exists and not all stops done.
  useEffect(() => {
    (async () => {
      getInstallId();
      // Load lifetime score so Welcome can show the running total + streak.
      readScore().then(setScore).catch(() => {});
      // Load the single-player game-layer state (collections + bests).
      readCollections().then(setCollections).catch(() => {});
      readBests().then(setBests).catch(() => {});
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

  // Restore an existing Supabase session (if signed in) and keep `user` in sync
  // with auth changes. Entirely skipped when auth isn't configured.
  useEffect(() => {
    if (!authConfigured) return;
    (async () => {
      const u = await getCurrentUser();
      if (u) {
        setUser(u);
        loadProfile(u.id).then((p) => p && setProfile(p)).catch(() => {});
      }
    })();
    const unsub = onAuthChange((u) => {
      setUser(u);
      if (!u) setProfile(null);
    });
    return unsub;
  }, []);

  // Persist the active quest + progress whenever it changes while playing, so
  // the quest survives an app close (UX-SPEC §1.7).
  useEffect(() => {
    // Don't re-persist after completion: the completion effect removes STORE_KEY,
    // but the watcher is still live, so a stray post-finish GPS point (now that
    // routePath is a dep) would otherwise resurrect the just-deleted blob. The
    // final legitimate save still happens — this effect runs before the completion
    // effect flips the ref on the last-photo render (declaration order).
    if (screen !== "ready" || !quest || completedFiredRef.current) return;
    AsyncStorage.setItem(
      STORE_KEY,
      JSON.stringify({ quest, progress, startedAt: startedAtRef.current, routePath })
    ).catch(() => {});
  }, [screen, quest, progress, routePath]);

  // Watch the user's location while a quest is active, so distances stay live.
  useEffect(() => {
    if (screen !== "ready") return;
    let sub;
    (async () => {
      try {
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
          (loc) => {
            const c = loc.coords;
            // Accumulate the walked path. Read/write the REF (the callback only
            // closes over [screen], so routePath state is stale here). Skip points
            // within ~5m of the last to filter GPS jitter — distanceInterval:10
            // already throttles, this just smooths the standing-still wobble.
            const path = routePathRef.current;
            const last = path[path.length - 1];
            if (
              !last ||
              distanceM(last.latitude, last.longitude, c.latitude, c.longitude) >= 5
            ) {
              const next = [...path, { latitude: c.latitude, longitude: c.longitude, t: Date.now() }];
              routePathRef.current = next;
              setRoutePath(next);
            }
            setCoords(c);
          }
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
      // The success haptic fires from the Celebration banner on mount (the
      // visible "you did it" moment) — not here — so it never double-buzzes.

      // --- Light scoring + history (all ON-DEVICE, no login/server) --------
      const photoCount = quest.stops.filter((s) => progress[s.order_index]?.photoUri).length;
      const earned = POINTS_PER_QUEST + photoCount * POINTS_PER_PHOTO;
      setPointsEarned(earned);

      // Completion time: elapsed since the quest went live. null if we never
      // captured a start (quest predating this feature) — bests skip it cleanly.
      const startedAt = startedAtRef.current;
      const timeS = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null;
      setElapsedS(timeS);
      const areaLabel = quest.origin?.label || "Your Area";

      // Snapshot the recorded walked path (freshest from the ref) and its true
      // distance, so the recap + saved history show the REAL journey.
      const walkedPath = routePathRef.current;
      const walkedDistanceM = pathDistanceM(walkedPath);

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
          // Route tracking: the real walked path + true walked distance/duration,
          // so "My Quests" can redisplay the journey trace and honest stats later.
          routePath: walkedPath,
          walkedDistanceM,
          durationS: timeS,
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

        // Collections: record this quest's stops into the Area's discovery set,
        // computing the "+N new spots" delta against the pre-merge set.
        const { collections: nextCollections, newCount } = await recordCollections(areaLabel, quest.stops);
        setCollections(nextCollections);
        setNewSpots(newCount);

        // Personal bests: best points + fastest time per Area, for the scorecard.
        const { bests: nextBests, isPointsBest, isTimeBest } = await recordBest(areaLabel, earned, timeS);
        setBests(nextBests);
        setBestFlags({ points: isPointsBest, time: isTimeBest });

        // Capture this completion to the cross-user board sink (built out later).
        postScore({ area: areaLabel, theme: quest.theme, points: earned, time_s: timeS });

        // If signed in, push the fresh totals up to the cloud profile. Best-
        // effort: pushScore swallows all errors and is a no-op when unconfigured
        // or signed out, so this never affects the local quest flow.
        if (userRef.current) {
          pushScore(userRef.current, next)
            .then(() => loadProfile(userRef.current.id))
            .then((p) => p && setProfile(p))
            .catch(() => {});
        }
      })();

      // Completed quests should not reappear as a "Resume" offer.
      AsyncStorage.removeItem(STORE_KEY).catch(() => {});
    }
  }, [screen, quest, progress]);

  // Auto-present the completion overlay exactly once, when the quest first
  // becomes complete (the last photo lands). Ref-guarded so it never re-opens
  // on subsequent renders — once the user closes it, the floating Recap button
  // re-opens it. An already-complete resume pre-sets the guard (see resumeQuest)
  // so reopening such a quest doesn't slam the overlay back up.
  useEffect(() => {
    if (screen !== "ready" || !quest) return;
    const done = quest.stops.filter((s) => progress[s.order_index]?.photoUri).length;
    const allDone = done === quest.stops.length;
    if (allDone && !recapAutoPresentedRef.current) {
      recapAutoPresentedRef.current = true;
      setSelectedStop(null); // clear any open stop card so the overlay is clean
      setRecapOpen(true);
    }
  }, [screen, quest, progress]);

  async function startQuest() {
    setScreen("loading");
    setError("");
    setProgress({});
    setCoords(null);
    routePathRef.current = [];
    setRoutePath([]);
    setFeedbackRating(null);
    setFeedbackText("");
    setFeedbackSent(false);
    setFlagged({});
    setPointsEarned(0);
    setNewSpots(0);
    setElapsedS(null);
    setBestFlags({ points: false, time: false });
    completedFiredRef.current = false;
    celebratedRef.current = false;
    startedAtRef.current = Date.now();
    // Fresh quest: clean map, no open card/overlay, completion auto-present armed.
    setSelectedStop(null);
    setRecapOpen(false);
    recapAutoPresentedRef.current = false;
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
    // Restore the walked-so-far path so the watcher keeps appending to it
    // instead of starting a fresh trail (UX-SPEC §1: survives pause/resume).
    routePathRef.current = Array.isArray(saved.routePath) ? saved.routePath : [];
    setRoutePath(routePathRef.current);
    setFeedbackRating(null);
    setFeedbackText("");
    setFeedbackSent(false);
    setFlagged({});
    setPointsEarned(0);
    setNewSpots(0);
    setElapsedS(null);
    setBestFlags({ points: false, time: false });
    // Restore the original start time so the completion timer survives a resume.
    // Falls back to now() for quests saved before we tracked start time.
    startedAtRef.current = saved.startedAt || Date.now();
    const done = saved.quest.stops.filter((s) => saved.progress?.[s.order_index]?.photoUri).length;
    completedFiredRef.current = done === saved.quest.stops.length;
    celebratedRef.current = completedFiredRef.current; // already-complete resume shouldn't re-celebrate
    // Clean map on resume. If the resumed quest is ALREADY complete, arm the
    // auto-present guard so the overlay doesn't slam up — the Recap button opens
    // it on demand. An in-progress resume leaves it disarmed so finishing the
    // last stop still auto-presents completion.
    setSelectedStop(null);
    setRecapOpen(false);
    recapAutoPresentedRef.current = completedFiredRef.current;
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
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

  // Open the Collections view (per-Area discovery sets), loading fresh from disk.
  async function openCollections() {
    const c = await readCollections();
    setCollections(c);
    setExpandedArea(null);
    setScreen("collections");
    track("collections_opened", { areas: Object.keys(c).length });
  }

  // Open the Scorecard view (lifetime score + per-Area bests), fresh from disk.
  async function openScorecard() {
    const [c, b] = await Promise.all([readScore(), readBests()]);
    setScore(c);
    setBests(b);
    setScreen("scorecard");
    track("scorecard_opened", { areas: Object.keys(b).length });
  }

  // Open the optional Profile screen.
  function openProfile() {
    setAuthError("");
    setScreen("profile");
    track("profile_opened");
  }

  // Run web-redirect OAuth for a provider, then upsert + load the profile,
  // merging the local score totals up. All failures are surfaced gently and
  // never crash the app.
  async function handleSignIn(provider) {
    if (!authConfigured || authBusy) return;
    setAuthBusy(true);
    setAuthError("");
    track("sign_in_started", { provider });
    try {
      const res = await signInWithProvider(provider);
      if (res.canceled) {
        return; // user backed out — no error
      }
      if (res.error || !res.user) {
        setAuthError(res.error || "Sign-in failed. Please try again.");
        track("sign_in_failed", { provider });
        return;
      }
      setUser(res.user);
      track("sign_in_succeeded", { provider });
      // Merge local totals into the profile, then load it back as the truth.
      const merged = await upsertProfile(res.user, score);
      if (merged) setProfile(merged);
      else {
        const p = await loadProfile(res.user.id);
        if (p) setProfile(p);
      }
    } catch (e) {
      setAuthError(e?.message || "Sign-in failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    setAuthBusy(true);
    try {
      await signOut();
    } finally {
      setUser(null);
      setProfile(null);
      setAuthBusy(false);
      track("sign_out");
    }
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
  function renderRecap(
    q = quest,
    prog = progress,
    earned = pointsEarned,
    path = routePath,
    durationS = elapsedS
  ) {
    const photoStops = q.stops.filter((s) => prog[s.order_index]?.photoUri);
    // Hero = first completed stop's photo (the spec's default).
    const heroStop = photoStops[0] || q.stops[0];
    const heroUri = prog[heroStop.order_index]?.photoUri;
    const filmstrip = photoStops.filter((s) => s.order_index !== heroStop.order_index);

    // True walked distance from the recorded GPS path. Fall back to the planned
    // straight-line loop when the path is empty/too short (manual override, a
    // quest that predates route tracking) so we never show a broken "0.0 km".
    const walkedM = pathDistanceM(path);
    const trustWalk = Array.isArray(path) && path.length >= 2 && walkedM >= MIN_TRUSTED_WALK_M;
    const km = ((trustWalk ? walkedM : totalWalkedM(q.stops)) / 1000).toFixed(1);
    // Headline stat: honest about whether it's the real walk or the planned loop.
    const statLine = trustWalk
      ? Number.isFinite(durationS) && durationS > 0
        ? `You walked ${km} km in ${formatDuration(durationS)}`
        : `You walked ${km} km`
      : `${q.stops.length} stops · ${km} km explored`;

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
              {/* Journey proof: a compact route trace (View-based, so it survives
                  captureRef). Plots the REAL walked path when we trusted it for the
                  stat; otherwise the planned numbered-stop loop. */}
              <RouteTrace stops={q.stops} routePath={trustWalk ? path : null} />

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
              <Text style={styles.recapStat}>{statLine}</Text>
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

        {/* Entry points to the single-player game layer + saved history. */}
        <View style={styles.navRow}>
          <Text style={styles.navLink} onPress={openCollections}>
            🗺️ Collections
          </Text>
          <Text style={styles.navLink} onPress={openScorecard}>
            🏅 Scorecard
          </Text>
        </View>
        <Text style={styles.historyLink} onPress={openHistory}>
          📜 My Quests
        </Text>

        {/* OPTIONAL sign-in entry — NOT a gate. Hidden entirely unless Supabase
            is configured. Shows the signed-in name once signed in, otherwise a
            gentle "save your profile" invite. The whole app works without it. */}
        {authConfigured ? (
          user ? (
            <Text style={styles.profileLink} onPress={openProfile}>
              👤 {profile?.display_name || profileFromUser(user)?.display_name || "Your profile"}
            </Text>
          ) : (
            <Text style={styles.profileLink} onPress={openProfile}>
              ✨ Sign in to save your profile
            </Text>
          )
        ) : (
          <Text style={styles.profileLinkDisabled}>Profiles coming soon</Text>
        )}
      </ScrollView>
    );
  }

  if (screen === "profile") {
    const display = profile?.display_name || profileFromUser(user)?.display_name;
    const email = profile?.email || profileFromUser(user)?.email;
    const avatar = profile?.avatar_url || profileFromUser(user)?.avatar_url;
    const pts = profile?.total_points ?? score.total;
    const quests = profile?.quests_completed ?? score.quests_completed;
    const streak = profile?.streak_weeks ?? score.streak_weeks;
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <StatusBar style="dark" />
        <Text style={styles.backLink} onPress={() => setScreen("welcome")}>
          ← Back
        </Text>
        <Text style={styles.theme}>Profile</Text>

        {user ? (
          <>
            {/* Signed-in identity from the provider. */}
            <View style={styles.profileCard}>
              {avatar ? (
                <Image source={{ uri: avatar }} style={styles.profileAvatar} />
              ) : (
                <View style={[styles.profileAvatar, styles.profileAvatarEmpty]}>
                  <Text style={styles.profileAvatarInitial}>
                    {(display || email || "?").slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                {display ? <Text style={styles.profileName}>{display}</Text> : null}
                {email ? <Text style={styles.profileEmail}>{email}</Text> : null}
              </View>
            </View>

            {/* Their score, synced to the cloud profile. */}
            <View style={styles.scoreRow}>
              <View style={styles.scoreStat}>
                <Text style={styles.scoreNum}>{pts}</Text>
                <Text style={styles.scoreLabel}>points</Text>
              </View>
              <View style={styles.scoreStat}>
                <Text style={styles.scoreNum}>{quests}</Text>
                <Text style={styles.scoreLabel}>quests</Text>
              </View>
              <View style={styles.scoreStat}>
                <Text style={styles.scoreNum}>🔥 {streak}</Text>
                <Text style={styles.scoreLabel}>week streak</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.button, authBusy && styles.actionBtnDisabled]}
              onPress={handleSignOut}
              disabled={authBusy}
            >
              <Text style={styles.buttonText}>Sign out</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.intro}>
              Sign in to save your points, quests and streak to your account — so they
              follow you to a new phone. Your quests keep working either way.
            </Text>

            <TouchableOpacity
              style={[styles.oauthBtn, authBusy && styles.actionBtnDisabled]}
              onPress={() => handleSignIn("google")}
              disabled={authBusy}
            >
              <Text style={styles.oauthBtnText}>Continue with Google</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.oauthBtn, styles.oauthBtnApple, authBusy && styles.actionBtnDisabled]}
              onPress={() => handleSignIn("apple")}
              disabled={authBusy}
            >
              <Text style={[styles.oauthBtnText, styles.oauthBtnTextApple]}>
                Continue with Apple
              </Text>
            </TouchableOpacity>

            {authBusy ? <ActivityIndicator style={{ marginTop: 16 }} color={ACCENT} /> : null}
            {authError ? <Text style={styles.error}>{authError}</Text> : null}
          </>
        )}
        <View style={{ height: 40 }} />
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
          {/* Pass the saved snapshot + its earned points + walked route/duration
              into the shared recap so a past quest redisplays its real journey. */}
          {renderRecap(
            historyRecord.quest,
            historyRecord.progress,
            historyRecord.points || 0,
            historyRecord.routePath || [],
            historyRecord.durationS ?? null
          )}
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

  if (screen === "collections") {
    // Build a placeKey -> photoUri lookup from history so discovered places can
    // show a thumbnail when we have one. Keyed by source_url || name to match
    // the discovery key. We DON'T store photoUri in the collection itself.
    const photoByKey = {};
    for (const rec of history) {
      for (const s of rec.stops || []) {
        const key = s.source_url || s.name;
        if (key && s.photoUri && !photoByKey[key]) photoByKey[key] = s.photoUri;
      }
    }
    const areas = Object.keys(collections).sort((a, b) => {
      const na = Object.keys(collections[a]?.discovered || {}).length;
      const nb = Object.keys(collections[b]?.discovered || {}).length;
      return nb - na;
    });
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <StatusBar style="dark" />
        <Text style={styles.backLink} onPress={() => setScreen("welcome")}>
          ← Back
        </Text>
        <Text style={styles.theme}>Collections</Text>
        <Text style={styles.intro}>Notable spots you've discovered, area by area.</Text>
        {areas.length === 0 ? (
          <Text style={styles.intro}>
            No discoveries yet. Finish a quest and the places you visit get logged here.
          </Text>
        ) : (
          areas.map((area) => {
            const discovered = collections[area]?.discovered || {};
            const places = Object.entries(discovered).sort(
              (a, b) => (a[1].first_seen || "").localeCompare(b[1].first_seen || "")
            );
            const open = expandedArea === area;
            return (
              <View key={area} style={styles.collCard}>
                <TouchableOpacity
                  style={styles.collHeader}
                  onPress={() => setExpandedArea(open ? null : area)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.collArea} numberOfLines={1}>{area}</Text>
                    <Text style={styles.collCount}>
                      {places.length} {places.length === 1 ? "spot" : "spots"} discovered
                    </Text>
                  </View>
                  <Text style={styles.listChevron}>{open ? "⌄" : "›"}</Text>
                </TouchableOpacity>
                {open
                  ? places.map(([key, p]) => {
                      const thumb = photoByKey[key];
                      return (
                        <View key={key} style={styles.collPlace}>
                          {thumb ? (
                            <Image source={{ uri: thumb }} style={styles.collThumb} />
                          ) : (
                            <View style={[styles.collThumb, styles.collThumbEmpty]}>
                              <Text style={styles.collThumbMark}>✦</Text>
                            </View>
                          )}
                          <Text style={styles.collPlaceName} numberOfLines={2}>
                            {p.name || "Unknown spot"}
                          </Text>
                        </View>
                      );
                    })
                  : null}
              </View>
            );
          })
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  if (screen === "scorecard") {
    // Per-Area bests, most-recently-played first.
    const areas = Object.keys(bests).sort(
      (a, b) => (bests[b]?.last_at || "").localeCompare(bests[a]?.last_at || "")
    );
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <StatusBar style="dark" />
        <Text style={styles.backLink} onPress={() => setScreen("welcome")}>
          ← Back
        </Text>
        <Text style={styles.theme}>Scorecard</Text>

        {/* Lifetime totals (reused score.v1). */}
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

        <Text style={styles.scoreSectionTitle}>Personal bests by area</Text>
        <Text style={styles.intro}>You vs. your best — beat your record next time.</Text>
        {areas.length === 0 ? (
          <Text style={styles.intro}>
            No completed quests yet. Your area records show up here once you finish one.
          </Text>
        ) : (
          areas.map((area) => {
            const b = bests[area];
            return (
              <View key={area} style={styles.bestCard}>
                <Text style={styles.bestArea} numberOfLines={1}>{area}</Text>
                <View style={styles.bestStatsRow}>
                  <View style={styles.bestStat}>
                    <Text style={styles.bestNum}>{b.best_points}</Text>
                    <Text style={styles.bestLabel}>best points</Text>
                  </View>
                  <View style={styles.bestStat}>
                    <Text style={styles.bestNum}>{formatDuration(b.fastest_time_s)}</Text>
                    <Text style={styles.bestLabel}>fastest</Text>
                  </View>
                  <View style={styles.bestStat}>
                    <Text style={styles.bestNum}>{b.quests}</Text>
                    <Text style={styles.bestLabel}>quests</Text>
                  </View>
                </View>
              </View>
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

  // screen === "ready" — MAP-FIRST, Pokémon-GO-style layout: a full-screen map
  // with selectable numbered stop dots and floating round controls at the
  // corners/sides. Tapping a stop pops out a centered detail CARD (the full
  // check-in/photo/override flow); completion surfaces as a full-screen overlay.
  const doneCount = quest.stops.filter((s) => progress[s.order_index]?.photoUri).length;
  const allDone = doneCount === quest.stops.length;
  // The stop whose detail is shown in the pop-out card.
  const activeStop =
    selectedStop != null ? quest.stops.find((s) => s.order_index === selectedStop) : null;

  // --- Renderers for the pop-out card / completion overlay ---------------------
  function renderStopDetail(s) {
    const state = progress[s.order_index] || {};
    const dist = coords ? distanceM(coords.latitude, coords.longitude, s.place.lat, s.place.lng) : null;
    const inRange = dist != null && dist <= CHECKIN_RADIUS_M;
    const completed = Boolean(state.photoUri);
    return (
      <ScrollView
        style={styles.cardScroll}
        contentContainerStyle={styles.cardScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.stopTitle} numberOfLines={2}>
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

        {/* Check-in → photo flow (unchanged behavior). */}
        {state.photoUri ? (
          <>
            <View style={styles.foundBanner}>
              <Text style={styles.foundBannerText}>✓ Found it!</Text>
            </View>
            <Image source={{ uri: state.photoUri }} style={styles.photo} />
          </>
        ) : state.checkedIn ? (
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGo]} onPress={() => takePhoto(s.order_index)}>
            <Text style={styles.actionText}>📷 Snap it to claim!</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.actionBtn, inRange && styles.actionBtnGo, !inRange && styles.actionBtnDisabled]}
              onPress={() => checkIn(s.order_index)}
              disabled={!inRange}
            >
              <Text style={styles.actionText}>
                {inRange ? "📍 GO! Check in here" : "Walk closer to check in"}
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
        <View style={{ height: 8 }} />
      </ScrollView>
    );
  }

  function renderCompletion() {
    return (
      <ScrollView
        style={styles.overlayScroll}
        contentContainerStyle={styles.overlayScrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hand-rolled celebration: confetti + points count-up + streak/best reveal.
            `play` (confetti + success haptic) fires only the FIRST time the
            completed sheet is shown for this quest — re-opening it within the
            session shows the banner statically, no re-buzz. NOTE: completion is
            always reached from the expanded stop-detail sheet, so this branch
            mounts exactly when the last photo lands — keep that coupling in mind. */}
        {(() => {
          const play = !celebratedRef.current;
          celebratedRef.current = true;
          return (
            <Celebration
              play={play}
              points={pointsEarned}
              streakWeeks={score.streak_weeks}
              newSpots={newSpots}
              elapsedS={elapsedS}
              isBest={bestFlags.points || bestFlags.time}
            />
          );
        })()}

        {/* Honest, count-led collections line for this Area. */}
        {newSpots > 0 ? (
          <Text style={styles.discoverLine}>
            +{newSpots} new spot{newSpots === 1 ? "" : "s"} discovered in{" "}
            {quest.origin?.label || "this area"}!
          </Text>
        ) : null}

        {renderRecap()}

        {/* Quick delight signal + optional note after completion (UX-SPEC §1.8). */}
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

        <TouchableOpacity style={styles.button} onPress={startQuest}>
          <Text style={styles.buttonText}>New Quest</Text>
        </TouchableOpacity>
        <View style={{ height: 16 }} />
      </ScrollView>
    );
  }

  // Pop-out card transforms: scale/fade pop from the existing Animated API.
  const cardScale = cardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] });
  // The completion overlay scales/fades in from the same family of transforms.
  const overlayScale = recapAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });

  // Lifetime points shown on the profile/score button (bottom-left).
  const profilePoints = score.total;

  return (
    <View style={styles.mapScreen}>
      <StatusBar style="dark" />

      {/* FULL-SCREEN map: numbered dots in walking order, route line, "you are here". */}
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={regionForStops(quest.stops, coords)}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {/* PLANNED route: the accent line connecting the stops in walking order. */}
        <Polyline
          coordinates={quest.stops.map((s) => ({ latitude: s.place.lat, longitude: s.place.lng }))}
          strokeColor={ACCENT}
          strokeWidth={4}
        />
        {/* WALKED path: the live breadcrumb of where you've ACTUALLY been —
            thicker + translucent green, visually distinct from the planned line. */}
        {routePath.length >= 2 ? (
          <Polyline
            coordinates={routePath.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))}
            strokeColor="rgba(74,124,89,0.7)"
            strokeWidth={7}
          />
        ) : null}
        {quest.stops.map((s) => {
          const completed = Boolean(progress[s.order_index]?.photoUri);
          const isSelected = selectedStop === s.order_index;
          return (
            <Marker
              // Key folds in completed/selected so the custom marker re-renders
              // its style when those change (RN-maps caches marker children).
              key={`${s.order_index}-${completed ? "d" : "o"}-${isSelected ? "s" : "n"}`}
              coordinate={{ latitude: s.place.lat, longitude: s.place.lng }}
              title={s.place.name}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => selectStop(s.order_index)}
            >
              <MapPin orderIndex={s.order_index} completed={completed} selected={isSelected} />
            </Marker>
          );
        })}
      </MapView>

      {/* ===== Floating HUD (Pokémon-GO style). pointerEvents box-none so the
              gaps between controls pass touches through to the live map. ===== */}

      {/* Top-left: quest identity + area label, as a glassy floating chip. */}
      <View style={styles.hudTopLeft} pointerEvents="box-none">
        <View style={styles.identityChip}>
          <Text style={styles.identityTheme} numberOfLines={1}>{quest.theme}</Text>
          {quest.origin?.label ? (
            <Text style={styles.identityArea} numberOfLines={1}>📍 {quest.origin.label}</Text>
          ) : null}
        </View>
      </View>

      {/* Top-right: a stacked side rail of round buttons — the things reachable
          from Welcome (Collections, Scorecard, Sign in) + Abandon. */}
      <View style={styles.hudSideRail} pointerEvents="box-none">
        <TouchableOpacity style={styles.railBtn} onPress={openCollections} activeOpacity={0.8}>
          <Text style={styles.railIcon}>🗺️</Text>
          <Text style={styles.railLabel}>Spots</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.railBtn} onPress={openScorecard} activeOpacity={0.8}>
          <Text style={styles.railIcon}>🏅</Text>
          <Text style={styles.railLabel}>Scores</Text>
        </TouchableOpacity>
        {authConfigured ? (
          <TouchableOpacity style={styles.railBtn} onPress={openProfile} activeOpacity={0.8}>
            <Text style={styles.railIcon}>{user ? "👤" : "✨"}</Text>
            <Text style={styles.railLabel}>{user ? "You" : "Sign in"}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={[styles.railBtn, styles.railBtnAbandon]} onPress={abandonQuest} activeOpacity={0.8}>
          <Text style={styles.railIcon}>✕</Text>
          <Text style={styles.railLabelAbandon}>Quit</Text>
        </TouchableOpacity>
      </View>

      {/* Top-center: compact progress chip ("2/3" or "Complete!"). */}
      <View style={styles.hudProgress} pointerEvents="box-none">
        <View style={[styles.progressChip, allDone && styles.progressChipDone]}>
          <Text style={styles.progressChipText}>
            {allDone ? "🎉 Complete!" : `${doneCount}/${quest.stops.length} stops`}
          </Text>
        </View>
      </View>

      {/* Bottom-left: profile/score button — chunky, shows lifetime points,
          opens the Profile/Scorecard. */}
      <TouchableOpacity style={styles.scoreFab} onPress={openScorecard} activeOpacity={0.85}>
        <Text style={styles.scoreFabPts}>{profilePoints}</Text>
        <Text style={styles.scoreFabLabel}>pts</Text>
      </TouchableOpacity>

      {/* Bottom-right: the prominent PRIMARY action. "Recap" once complete
          (re-opens the completion overlay), otherwise "New Quest". */}
      {allDone ? (
        <TouchableOpacity
          style={[styles.primaryFab, styles.primaryFabRecap]}
          onPress={() => {
            setSelectedStop(null);
            setRecapOpen(true);
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryFabIcon}>🎉</Text>
          <Text style={styles.primaryFabText}>Recap</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.primaryFab} onPress={startQuest} activeOpacity={0.85}>
          <Text style={styles.primaryFabIcon}>＋</Text>
          <Text style={styles.primaryFabText}>New Quest</Text>
        </TouchableOpacity>
      )}

      {/* ===== Pop-out stop CARD (replaces the old expanded bottom sheet). A
              centered, scale/fade-popped Animated card carrying the FULL
              check-in / photo / override / source / flag flow. Tap the scrim or
              the X to dismiss back to the clean map. ===== */}
      {activeStop ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Tap-outside scrim. */}
          <TouchableOpacity
            style={styles.cardScrim}
            activeOpacity={1}
            onPress={closeCard}
          />
          <View style={styles.cardCenter} pointerEvents="box-none">
            <Animated.View style={[styles.popCard, { opacity: cardAnim, transform: [{ scale: cardScale }] }]}>
              <TouchableOpacity style={styles.cardClose} onPress={closeCard} activeOpacity={0.7}>
                <Text style={styles.cardCloseText}>✕</Text>
              </TouchableOpacity>
              {renderStopDetail(activeStop)}
            </Animated.View>
          </View>
        </View>
      ) : null}

      {/* ===== Completion OVERLAY (full-screen, scrollable). Holds the
              celebration + 9:16 recap + feedback + New Quest. Full-screen (not a
              small card) so the keyboard doesn't cover feedback and captureRef
              lays the recap out at real size. ===== */}
      {recapOpen ? (
        <Animated.View
          style={[styles.completionOverlay, { opacity: recapAnim, transform: [{ scale: overlayScale }] }]}
        >
          <View style={styles.overlayHeader}>
            <TouchableOpacity onPress={() => setRecapOpen(false)} activeOpacity={0.7}>
              <Text style={styles.overlayClose}>✕ Back to map</Text>
            </TouchableOpacity>
          </View>
          {renderCompletion()}
        </Animated.View>
      ) : null}
    </View>
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
  historyLink: { fontSize: 15, color: ACCENT, fontWeight: "700", marginTop: 16, textDecorationLine: "underline" },
  // Welcome nav row to the game-layer views
  navRow: { flexDirection: "row", marginTop: 24, gap: 14 },
  navLink: { fontSize: 15, color: ACCENT, fontWeight: "800", textDecorationLine: "underline" },

  // Collections screen
  collCard: { backgroundColor: "#fff", borderRadius: 16, marginTop: 14, borderWidth: 1, borderColor: "#e6dfd2", overflow: "hidden" },
  collHeader: { flexDirection: "row", alignItems: "center", padding: 16 },
  collArea: { fontSize: 17, fontWeight: "800", color: INK },
  collCount: { fontSize: 14, color: GREEN, fontWeight: "700", marginTop: 3 },
  collPlace: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f0ebe1" },
  collThumb: { width: 40, height: 40, borderRadius: 8, marginRight: 12 },
  collThumbEmpty: { backgroundColor: CREAM, alignItems: "center", justifyContent: "center" },
  collThumbMark: { color: ACCENT, fontSize: 18, fontWeight: "800" },
  collPlaceName: { flex: 1, fontSize: 15, color: INK, fontWeight: "600" },
  // Chevron used by the Collections accordion header.
  listChevron: { fontSize: 24, color: "#cbbfae", fontWeight: "700", marginLeft: 8 },

  // Scorecard screen
  scoreSectionTitle: { fontSize: 18, fontWeight: "800", color: INK, marginTop: 28 },
  bestCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginTop: 14, borderWidth: 1, borderColor: "#e6dfd2" },
  bestArea: { fontSize: 16, fontWeight: "800", color: INK },
  bestStatsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  bestStat: { alignItems: "center", flex: 1 },
  bestNum: { fontSize: 19, fontWeight: "800", color: ACCENT },
  bestLabel: { fontSize: 12, color: INK, opacity: 0.6, marginTop: 2 },

  // Completion celebration (hand-rolled Animated)
  celebrateWrap: { width: "100%", alignItems: "center", marginBottom: 16, overflow: "hidden" },
  confettiLayer: { position: "absolute", top: 0, left: 0, right: 0, height: 260 },
  celebrateBanner: { width: "100%", backgroundColor: GREEN, borderRadius: 18, paddingVertical: 20, paddingHorizontal: 18, alignItems: "center" },
  celebrateTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  celebratePoints: { color: "#fff", fontSize: 38, fontWeight: "900", letterSpacing: -1, marginTop: 4 },
  celebrateChips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 12 },
  celebrateChip: { color: GREEN, backgroundColor: "#fff", borderRadius: 12, paddingVertical: 5, paddingHorizontal: 11, fontSize: 13, fontWeight: "800", overflow: "hidden" },
  celebrateBest: { color: "#ffe9a8", fontSize: 15, fontWeight: "800", marginTop: 12 },
  discoverLine: { fontSize: 16, color: GREEN, fontWeight: "800", textAlign: "center", marginBottom: 14 },

  // Energetic check-in / found states
  actionBtnGo: { backgroundColor: "#e0a449" },
  foundBanner: { backgroundColor: GREEN, borderRadius: 12, paddingVertical: 10, alignItems: "center", marginTop: 12 },
  foundBannerText: { color: "#fff", fontSize: 16, fontWeight: "800" },

  // Optional sign-in / profile entry on Welcome
  profileLink: { fontSize: 15, color: ACCENT, fontWeight: "700", marginTop: 16, textDecorationLine: "underline" },
  profileLinkDisabled: { fontSize: 13, color: INK, opacity: 0.4, marginTop: 16 },

  // Profile screen
  profileCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 16, padding: 16, marginTop: 16, borderWidth: 1, borderColor: "#e6dfd2" },
  profileAvatar: { width: 56, height: 56, borderRadius: 28, marginRight: 14 },
  profileAvatarEmpty: { backgroundColor: ACCENT, alignItems: "center", justifyContent: "center" },
  profileAvatarInitial: { color: "#fff", fontSize: 24, fontWeight: "800" },
  profileName: { fontSize: 18, fontWeight: "800", color: INK },
  profileEmail: { fontSize: 14, color: INK, opacity: 0.6, marginTop: 2 },
  oauthBtn: { backgroundColor: "#fff", borderRadius: 12, paddingVertical: 15, alignItems: "center", marginTop: 14, borderWidth: 1, borderColor: "#d8cfc0" },
  oauthBtnText: { color: INK, fontSize: 16, fontWeight: "700" },
  oauthBtnApple: { backgroundColor: "#000", borderColor: "#000" },
  oauthBtnTextApple: { color: "#fff" },

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
  stopTitle: { fontSize: 20, fontWeight: "700", color: INK, paddingRight: 36 },
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

  // --- Map-first active screen --------------------------------------------------
  mapScreen: { flex: 1, backgroundColor: CREAM },

  // Numbered stop dots (terracotta), with completed/selected variants.
  pin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: ACCENT,
    borderWidth: 2.5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  pinDone: { backgroundColor: GREEN },
  pinSelected: {
    backgroundColor: "#e0a449", // brighter gold for the active stop
    borderColor: "#fff",
    borderWidth: 3,
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  pinText: { color: "#fff", fontSize: 14, fontWeight: "800" },

  // --- Floating HUD (Pokémon-GO style) ----------------------------------------
  // Top-left identity chip (theme + area).
  hudTopLeft: { position: "absolute", top: 56, left: 16, right: 96 },
  identityChip: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 20,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#e6dfd2",
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  identityTheme: { fontSize: 15, fontWeight: "800", color: INK, letterSpacing: -0.2 },
  identityArea: { fontSize: 12, color: GREEN, fontWeight: "700", marginTop: 2 },

  // Top-right stacked side rail of round buttons.
  hudSideRail: { position: "absolute", top: 54, right: 14, alignItems: "center", gap: 12 },
  railBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.96)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  railBtnAbandon: { backgroundColor: "rgba(255,238,232,0.97)" },
  railIcon: { fontSize: 20 },
  railLabel: { fontSize: 9, fontWeight: "800", color: INK, marginTop: 1, letterSpacing: 0.2 },
  railLabelAbandon: { fontSize: 9, fontWeight: "800", color: ACCENT, marginTop: 1 },

  // Top-center progress chip.
  hudProgress: { position: "absolute", top: 60, left: 0, right: 0, alignItems: "center" },
  progressChip: {
    backgroundColor: ACCENT,
    borderRadius: 16,
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  progressChipDone: { backgroundColor: GREEN },
  progressChipText: { color: "#fff", fontSize: 14, fontWeight: "900", letterSpacing: 0.3 },

  // Bottom-left score/profile FAB.
  scoreFab: {
    position: "absolute",
    bottom: 38,
    left: 22,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#e0a449",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  scoreFabPts: { color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  scoreFabLabel: { color: "#fff", fontSize: 11, fontWeight: "800", marginTop: -2, opacity: 0.9 },

  // Bottom-right primary action FAB (New Quest / Recap).
  primaryFab: {
    position: "absolute",
    bottom: 38,
    right: 22,
    minWidth: 88,
    height: 72,
    borderRadius: 36,
    paddingHorizontal: 18,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  primaryFabRecap: { backgroundColor: GREEN },
  primaryFabIcon: { color: "#fff", fontSize: 22, fontWeight: "900", marginBottom: -1 },
  primaryFabText: { color: "#fff", fontSize: 13, fontWeight: "900", letterSpacing: 0.2 },

  // --- Pop-out stop card -------------------------------------------------------
  cardScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(43,38,34,0.45)" },
  cardCenter: { flex: 1, alignItems: "center", justifyContent: "center", padding: 18 },
  popCard: {
    width: "100%",
    maxWidth: 460,
    maxHeight: SCREEN_H * 0.78,
    backgroundColor: CREAM,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  cardClose: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e6dfd2",
  },
  cardCloseText: { fontSize: 16, fontWeight: "800", color: INK },
  // flexShrink (NOT flex:1) so the ScrollView shrinks to the card's maxHeight-only
  // bound and actually scrolls — keeping the bottom-of-card manual override /
  // source / flag reachable even on a tall stop (long description + captured photo).
  cardScroll: { flexShrink: 1 },
  cardScrollContent: { paddingBottom: 16, paddingRight: 4 },

  // --- Completion overlay (full-screen, scrollable) ----------------------------
  completionOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: CREAM },
  overlayHeader: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 4 },
  overlayClose: { fontSize: 15, color: ACCENT, fontWeight: "800" },
  overlayScroll: { flex: 1 },
  overlayScrollContent: { paddingHorizontal: 20, paddingBottom: 40 },

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
  // Walked-path leg: thicker + green to match the live map breadcrumb.
  traceLegWalked: {
    position: "absolute",
    height: 3,
    backgroundColor: GREEN,
    transformOrigin: "left center",
  },
  // Start/finish markers on the walked trace (no per-point numbers).
  traceEndDot: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  traceStartDot: { backgroundColor: GREEN },
  traceFinishDot: { backgroundColor: "#e0a449" },
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
