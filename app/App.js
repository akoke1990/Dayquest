import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  Linking,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
// expo-linking: parse incoming deep links (dayquest://friend?uid= and
// dayquest://join?hunt=) into { hostname, queryParams }. Autolinked — needs no
// app.json plugin entry. The OAuth redirect also rides the dayquest:// scheme,
// so the handler filters STRICTLY on hostname ("friend"/"join") and ignores the
// rest (the OAuth redirect has no such host), keeping sign-in untouched.
import * as ExpoLinking from "expo-linking";
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
import { API_BASE, TEASER, APP_SCHEME } from "./config";
// Optional, anonymous-first auth layer. `authConfigured` is false by default
// (empty Supabase keys), in which case every auth helper is a safe no-op and the
// sign-in UI is hidden — the app runs exactly as it does today.
import { authConfigured } from "./lib/supabase";
// Social layer (friends, shared-hunt results, leaderboard) — Supabase-direct,
// RLS-protected. Every helper is a safe no-op when unconfigured or signed out,
// so the solo/guest flow is untouched.
import {
  requestFriend,
  acceptFriend,
  declineFriend,
  listFriends,
  postHuntResult,
  leaderboard as fetchLeaderboard,
} from "./lib/social";
// Native Apple sign-in button + types. The module is safe to import on all
// platforms; the button/sheet only render on iOS (gated below).
import * as AppleAuthentication from "expo-apple-authentication";
import {
  signInWithProvider,
  signInWithAppleNative,
  signOut,
  getCurrentUser,
  onAuthChange,
  profileFromUser,
  upsertProfile,
  loadProfile,
  pushScore,
} from "./lib/auth";
// Map provider is chosen at RUNTIME (see `isExpoGo` below):
//  - In Expo Go (iOS) we use the platform DEFAULT provider (Apple Maps) with NO
//    customMapStyle, because PROVIDER_GOOGLE + customMapStyle does NOT work in
//    Expo Go — this keeps the current testing flow working with no API key.
//  - In a real dev/standalone build we use PROVIDER_GOOGLE + the stylized
//    customMapStyle (the Pokémon-GO look). That build reads the Google Maps key
//    from app.config.js (ios.config.googleMapsApiKey / android.config.googleMaps.apiKey).
import MapView, { Marker, Polyline, Circle, PROVIDER_GOOGLE } from "react-native-maps";
import Constants from "expo-constants";
import mapStyle from "./mapStyle";
import QuestScanner from "./QuestScanner";
import CameraCatch from "./CameraCatch";

// True only when running inside Expo Go. In a real build `appOwnership` is
// null/undefined, so this is false and Google + the custom style activate.
// Defensive: ANY uncertainty that still smells like Expo Go (the legacy
// storeClient execution environment) keeps us on the safe Apple-Maps path.
const isExpoGo =
  Constants.appOwnership === "expo" ||
  Constants.executionEnvironment === "storeClient";

const QUEST_EMOJI = { photo: "📷", find_detail: "🔍", question: "❓", collect: "✨" };
const CHECKIN_RADIUS_M = 100; // how close you must be to check in (legacy stop card)
// --- Scavenger-hunt tuning ---------------------------------------------------
const SEARCH_ZONE_RADIUS_M = 200; // the <Circle> "it's somewhere in here" hunt zone
const FIND_RADIUS_M = 50; // within this of the target → FOUND IT (reveal + collect)
// After this long on one clue we surface the manual "reveal anyway" escape, so a
// GPS/accessibility issue can never trap the user on a clue.
const ESCAPE_AFTER_MS = 45000;
const FALLBACK_ITEM = "🎁"; // virtual_item when the server hasn't supplied one

// Warmer/colder proximity bands (metal-detector feel). Ordered cold→hot. Each
// band carries its UI label + a haptic style fired on band CHANGE (throttle).
const PROX_BANDS = [
  { id: "cold", max: Infinity, label: "❄️ Ice cold", hint: "Keep exploring…", color: "#3B82C4" },
  { id: "cool", max: 300, label: "😐 Getting closer", hint: "You're on the trail", color: "#1F6FB2" },
  { id: "warm", max: 150, label: "🔥 Warm", hint: "It's nearby!", color: "#F5B400" },
  { id: "hot", max: 50, label: "🔥🔥 Red hot!", hint: "You're right on top of it!", color: "#E8590C" },
];
// Map a live distance (m) to its band. Walks hot→cold and returns the first
// whose `max` the distance is at/under; cold is the catch-all (max: Infinity).
function proximityBand(distM) {
  if (distM == null) return null;
  for (let i = PROX_BANDS.length - 1; i >= 0; i--) {
    if (distM <= PROX_BANDS[i].max) return PROX_BANDS[i];
  }
  return PROX_BANDS[0];
}
const SCREEN_H = Dimensions.get("window").height; // for sheet peek/expanded sizing
const SCREEN_W = Dimensions.get("window").width; // confetti spread on the find reveal

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
// Soft-gate choice: "1" once the user has tapped "Continue as guest". When set
// (or when a signed-in session exists), the sign-in entry screen is skipped on
// launch so we never re-prompt someone who already chose anonymous-first.
const GUEST_KEY = "dayquest.guest.v1";

// Persistent log of every individual place the user has CHECKED INTO (across all
// quests, even partial ones). De-duped by placeKey. Newest-first array of
// { placeKey, name, area, photoUri, visited_at }.
const VISITED_KEY = "dayquest.visited.v1";

// Light scoring knobs (no levels grind, no leaderboards — UX is "a little win").
// The CORE earning event is now the CHECK-IN: every stop you reach banks points
// immediately. Completion adds a bonus on top. Photo is folded into the check-in
// (no separate photo award) so we never double-count a stop.
const POINTS_PER_CHECKIN = 25; // banked the instant a stop is checked in (once per stop per quest)
const POINTS_PER_QUEST = 100; // completion bonus, on top of the per-check-in points
const POINTS_PER_PHOTO = 25; // retained for back-compat reading of old saved recaps; not awarded live

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

// Bank points for a single CHECK-IN. Deliberately lighter than recordScore: it
// only bumps the lifetime `total` and persists — it does NOT touch
// quests_completed or the weekly streak (those are completion-only semantics).
// Returns the new score so the caller can render the running total immediately.
async function addCheckinPoints(points) {
  const prev = await readScore();
  const next = { ...prev, total: prev.total + points };
  await AsyncStorage.setItem(SCORE_KEY, JSON.stringify(next)).catch(() => {});
  return next;
}

// --- Visited places log (every check-in, across all quests) ------------------
// Read the visited-places log (newest-first), tolerating missing/corrupt.
async function readVisited() {
  try {
    const raw = await AsyncStorage.getItem(VISITED_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch {
    /* corrupt — treat as empty */
  }
  return [];
}

// Append (or refresh) one visited place. De-duped by placeKey GLOBALLY across all
// quests: visiting the same place twice keeps the FIRST visit (and its existing
// photo) rather than duplicating — we only fill in a missing photo/area. Newest
// entries are prepended so the list reads newest-first. Persists immediately.
async function appendVisited({ placeKey: key, name, area, photoUri, visited_at }) {
  if (!key) return await readVisited();
  const list = await readVisited();
  const existing = list.find((v) => v.placeKey === key);
  if (existing) {
    // Already logged — keep the original visited_at, just backfill missing bits.
    if (!existing.photoUri && photoUri) existing.photoUri = photoUri;
    if (!existing.area && area) existing.area = area;
  } else {
    list.unshift({
      placeKey: key,
      name: name || "Unknown spot",
      area: area || "Your Area",
      photoUri: photoUri || null,
      visited_at: visited_at || new Date().toISOString(),
    });
  }
  await AsyncStorage.setItem(VISITED_KEY, JSON.stringify(list)).catch(() => {});
  return list;
}

// Attach a photo to an already-logged visited place (when the user snaps one
// after checking in). No-op if the place isn't logged yet. Persists immediately.
async function setVisitedPhoto(key, photoUri) {
  if (!key || !photoUri) return await readVisited();
  const list = await readVisited();
  const existing = list.find((v) => v.placeKey === key);
  if (existing && !existing.photoUri) {
    existing.photoUri = photoUri;
    await AsyncStorage.setItem(VISITED_KEY, JSON.stringify(list)).catch(() => {});
  }
  return list;
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

// Collect a single virtual item the instant a target is FOUND (the hunt's
// reveal-and-collect). Extends the existing per-Area discovery entry with the
// item emoji — preserving the {name, source_url, first_seen} shape the
// Collections screen already renders. Idempotent by placeKey (re-finding the
// same place keeps the first item). Persists immediately and returns the map.
async function collectItem(areaLabel, place, item) {
  const key = placeKey(place);
  if (!key) return await readCollections();
  const area = areaLabel || "Your Area";
  const collections = await readCollections();
  const entry = collections[area] || { discovered: {} };
  const discovered = { ...entry.discovered };
  if (!discovered[key]) {
    discovered[key] = {
      name: place?.name || "",
      source_url: place?.source_url || null,
      first_seen: new Date().toISOString(),
      item: item || FALLBACK_ITEM,
    };
  } else if (!discovered[key].item && item) {
    discovered[key] = { ...discovered[key], item };
  }
  collections[area] = { ...entry, discovered };
  await AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections)).catch(() => {});
  return collections;
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

// A map region for the HUNT: frame ONLY the current target's search zone (+ the
// user if known) — never all stops, which would leak the other targets'
// locations by zooming to encompass them. Spans ~2.5× the zone so the whole
// circle is comfortably visible with the user in frame.
function regionForHunt(target, coords) {
  if (!target?.place) {
    // No target (shouldn't happen on a live hunt) — fall back to the user.
    if (coords) {
      return {
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
    }
    return { latitude: 0, longitude: 0, latitudeDelta: 0.05, longitudeDelta: 0.05 };
  }
  const lats = [target.place.lat];
  const lngs = [target.place.lng];
  if (coords) {
    lats.push(coords.latitude);
    lngs.push(coords.longitude);
  }
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  // The zone radius in degrees (rough): ~111km per degree lat. Pad so the full
  // ~200m circle fits with margin even when the user is at its centre.
  const zoneDeg = (SEARCH_ZONE_RADIUS_M / 111000) * 2.6;
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.6, zoneDeg),
    longitudeDelta: Math.max((maxLng - minLng) * 1.6, zoneDeg),
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
const CONFETTI_COLORS = ["#1773D6", "#27C04A", "#FFB300", "#FF5B6E", "#7A5CFF"];
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
        <Text style={styles.celebrateTitle}>🎉 Hunt complete!</Text>
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

// A behavior-transparent press wrapper that adds a juicy scale-bounce on touch.
// It is PURELY chrome: the TouchableOpacity stays the OUTER element and carries
// `style` (so position/margin/alignSelf — including the absolutely-positioned
// FABs — resolve exactly as before), forwarding every prop. The Animated.View
// is INNER and only scales the children off press in/out. So onPress/disabled/
// hitSlop/accessibility/layout all behave identically — this just makes the
// button content squish on tap. The app's other TouchableOpacity call sites are
// untouched.
function PressBounce({ style, children, scaleTo = 0.93, ...rest }) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () =>
    Animated.spring(scale, {
      toValue: scaleTo,
      friction: 6,
      tension: 200,
      useNativeDriver: true,
    }).start();
  const pressOut = () =>
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      tension: 180,
      useNativeDriver: true,
    }).start();
  return (
    <TouchableOpacity
      {...rest}
      style={style}
      onPressIn={pressIn}
      onPressOut={pressOut}
      activeOpacity={0.85}
    >
      <Animated.View
        style={{ transform: [{ scale }], alignItems: "center", justifyContent: "center" }}
      >
        {children}
      </Animated.View>
    </TouchableOpacity>
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
  // Synchronous double-award guard: order indices already awarded check-in points
  // THIS quest. Wins the sub-frame race two near-simultaneous taps (button +
  // override) could slip past the render-closure `progress` check. Reset per quest.
  const awardedRef = useRef(new Set());

  // --- Collections + scorecard (single-player game layer) ----------------------
  const [collections, setCollections] = useState({}); // { [area]: { discovered: {...} } }
  const [visited, setVisited] = useState([]); // every checked-in place, newest-first
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
  // --- HUNT state (scavenger hunt = Level 2) ----------------------------------
  // The order_index of the target currently being REVEALED (the "You found it!"
  // moment), or null when none is showing. Set on a find (GPS ≤ find radius or
  // manual reveal); cleared when the user taps "Next clue" — which advances the
  // hunt to the next not-found target. Gates the completion auto-present so the
  // final reveal isn't covered.
  const [findReveal, setFindReveal] = useState(null);
  // True while the camera-catch overlay is presented (the COLLECT step of a
  // find). Reachable ONLY from inside the find reveal (findReveal != null), so
  // the catch is structurally geo-gated to the solved place — it can't be opened
  // from anywhere else. Reset in nextClue() when the find completes.
  const [catching, setCatching] = useState(false);
  const [hintShown, setHintShown] = useState(false); // current target's hint revealed
  const [escapeArmed, setEscapeArmed] = useState(false); // the "reveal anyway" fallback shown after a while
  // Warmer/colder: last proximity band we buzzed for (so haptics fire on band
  // CHANGE, not every GPS tick — the metal-detector throttle).
  const lastBandRef = useRef(null);
  // Find guard: order indices whose find has already been triggered this quest,
  // so GPS jitter around the find radius can't re-fire the reveal. Reset per quest.
  const foundFiredRef = useRef(new Set());
  // Re-entry guard for completeCatch (the catch→advance handler). Prevents a
  // sprite-tap + skip-tap from double-firing the collect-fly/advance. Reset per
  // find in nextClue().
  const completingRef = useRef(false);
  // Snapshot of the Area's ALREADY-discovered placeKeys taken when a quest is
  // generated, BEFORE any find collects into the set. The completion "+N new
  // spots" delta diffs against this — because collectItem() now writes each find
  // into `discovered` live, a completion-time diff against the merged set would
  // always be 0. Captured per quest in startQuest/resumeQuest.
  const preQuestDiscoveredRef = useRef(new Set());
  // Animated values for the find reveal (card pop) + item collect (fly-to-rail).
  const revealCardAnim = useRef(new Animated.Value(0)).current;
  const collectAnim = useRef(new Animated.Value(0)).current;
  const warmthAnim = useRef(new Animated.Value(0)).current; // pulsing warmer/colder indicator
  // The pop-out stop card and the completion overlay are each driven by a plain
  // Animated.Value (0→1) via Animated.timing/spring — no gesture-handler /
  // reanimated, so it's rock-solid in Expo Go SDK 54.
  const cardAnim = useRef(new Animated.Value(0)).current; // stop pop-out card
  const recapAnim = useRef(new Animated.Value(0)).current; // completion overlay
  const revealAnim = useRef(new Animated.Value(0)).current; // freshly-generated quest reveal card
  // Whether the completion overlay is currently presented. Auto-presented once
  // when the quest first completes (false→true transition), re-openable via the
  // floating Recap button, dismissable back to the clean map.
  const [recapOpen, setRecapOpen] = useState(false);
  const recapAutoPresentedRef = useRef(false); // guard: auto-present completion once

  // --- Quest Setup sheet (choose WHERE + SIZE) --------------------------------
  // setupReturn is where Cancel goes back to ("welcome" or "ready").
  const [setupReturn, setSetupReturn] = useState("welcome");
  const [setupMode, setSetupMode] = useState("current"); // "current" | "place"
  const [setupQuery, setSetupQuery] = useState(""); // typed place text
  const [setupPlace, setSetupPlace] = useState(null); // resolved { name, lat, lng }
  const [setupResolving, setSetupResolving] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [setupSize, setSetupSize] = useState("quick"); // "quick" | "explore" | "epic"
  // Clue side-panel collapse state. Starts open; the handle/tab toggles it so the
  // clue can be tucked against the left edge to keep the map + warmer/colder clear.
  const [cluePanelOpen, setCluePanelOpen] = useState(true);
  const [travelMode, setTravelMode] = useState("walk"); // "walk" | "bike" — sent as mode= (bike = bigger loop, server-handled)

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

  // Animate the freshly-generated quest REVEAL card in. Reset to 0 on enter so
  // re-entering the reveal screen (a new quest after the first) re-plays the
  // game-y scale/flip/fade. Spring gives it the satisfying card "pop".
  useEffect(() => {
    if (screen !== "reveal") return;
    revealAnim.setValue(0);
    Animated.spring(revealAnim, {
      toValue: 1,
      friction: 7,
      tension: 55,
      useNativeDriver: true,
    }).start();
  }, [screen, revealAnim]);

  // Tapping a FOUND target's dot opens its post-reveal detail card (lore + photo
  // bonus). Only found targets are pinned/tappable — unfound ones aren't on the
  // map, so this never reveals a place early.
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

  // --- Multiplayer (friends + shared hunts + leaderboard) ---------------------
  // ALL gated behind being signed in. Guests/unconfigured see a "sign in to play
  // with friends" prompt; the solo flow never touches any of this.
  const [friends, setFriends] = useState({ friends: [], incoming: [], outgoing: [] });
  const [friendsBusy, setFriendsBusy] = useState(false);
  const [friendsNote, setFriendsNote] = useState(""); // inline status ("Request sent!" etc.)
  const [leaderRows, setLeaderRows] = useState([]); // current shared-hunt leaderboard
  const [leaderBusy, setLeaderBusy] = useState(false);
  const [leaderReturn, setLeaderReturn] = useState("welcome"); // where the leaderboard's Back goes
  // A deep link (friend/join) can arrive during "hydrating" or before `user`
  // resolves. We stash it here and process it ONCE the launch auth decision has
  // settled (see the deep-link effect), so the link never races the boot.
  const pendingLinkRef = useRef(null);
  const [joinNote, setJoinNote] = useState(""); // "joining…" / far-from-area banner
  // True once the authoritative launch decision (in the hydration effect) has
  // run. Deep links are queued until this flips so they never race boot/auth.
  const [booted, setBooted] = useState(false);
  // Bumped whenever a deep link arrives warm, so the dispatch effect re-runs.
  const [linkTick, setLinkTick] = useState(0);

  // On launch: ensure an install id exists, then check for an in-progress quest
  // to offer a Resume. We do this BEFORE showing Welcome to avoid a flash of the
  // no-resume state. "In progress" = saved quest exists and not all stops done.
  useEffect(() => {
    (async () => {
      getInstallId();
      // Load lifetime score so Welcome can show the running total + streak.
      readScore().then(setScore).catch(() => {});
      // Load the single-player game-layer state (collections + visited + bests).
      readCollections().then(setCollections).catch(() => {});
      readVisited().then(setVisited).catch(() => {});
      readBests().then(setBests).catch(() => {});
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const q = parsed?.quest;
          const prog = parsed?.progress || {};
          const done = q ? q.stops.filter((s) => prog[s.order_index]?.found).length : 0;
          if (q && done < q.stops.length) setSaved(parsed);
        }
      } catch {
        /* corrupt/missing — just start fresh */
      }

      // --- Soft sign-in gate routing (ONE authoritative launch decision) ------
      // Resolve all three inputs — saved quest (above), a prior guest choice, and
      // an existing Supabase session — BEFORE leaving "hydrating", so a signed-in
      // user or a returning guest goes straight to welcome with NO flash of the
      // sign-in screen. Order: signed-in OR guest-chosen → welcome, ELSE → signin.
      let guestChosen = false;
      try {
        guestChosen = (await AsyncStorage.getItem(GUEST_KEY)) === "1";
      } catch {
        /* missing — treat as not-yet-chosen */
      }
      let sessionUser = null;
      if (authConfigured) {
        // Local-storage session read; fast on cold launch (no network). If it
        // ever hangs that's a real-device concern, not a bundle one.
        sessionUser = await getCurrentUser().catch(() => null);
        if (sessionUser) {
          setUser(sessionUser);
          loadProfile(sessionUser.id).then((p) => p && setProfile(p)).catch(() => {});
        }
      }
      setScreen(sessionUser || guestChosen ? "welcome" : "signin");
      // Launch decision settled — release any deep link that arrived during boot.
      setBooted(true);
    })();
  }, []);

  // Keep `user` in sync with auth changes (sign-in/out elsewhere). The INITIAL
  // session restore now happens in the hydration effect above so the launch
  // route is decided once; this is purely the live subscription. Skipped when
  // auth isn't configured.
  useEffect(() => {
    if (!authConfigured) return;
    const unsub = onAuthChange((u) => {
      setUser(u);
      if (!u) setProfile(null);
    });
    return unsub;
  }, []);

  // --- Deep links: dayquest://friend?uid=… and dayquest://join?hunt=… ---------
  // Two arrival paths: cold-start (getInitialURL) and warm (addEventListener).
  // A link can land before boot/auth settles, so we STASH it in a ref and the
  // dispatch effect below replays it once `booted` is true. We filter STRICTLY
  // on the parsed hostname ("friend"/"join"); the OAuth redirect rides the same
  // dayquest:// scheme but has NO such host, so it's naturally ignored here.
  useEffect(() => {
    let mounted = true;
    function handle(url) {
      if (!url || !mounted) return;
      let parsed;
      try {
        parsed = ExpoLinking.parse(url);
      } catch {
        return;
      }
      const host = parsed?.hostname;
      if (host !== "friend" && host !== "join") return; // ignore OAuth + anything else
      pendingLinkRef.current = { host, params: parsed.queryParams || {} };
      // Nudge the dispatcher: if we're already booted, process now; otherwise
      // the booted-flip effect will pick it up.
      setLinkTick((t) => t + 1);
    }
    ExpoLinking.getInitialURL()
      .then((url) => url && handle(url))
      .catch(() => {});
    const sub = ExpoLinking.addEventListener("url", ({ url }) => handle(url));
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  // Dispatch a stashed deep link once the launch decision has settled. Friend
  // links and join links both require sign-in (multiplayer is gated): if signed
  // out, we route to the sign-in screen and KEEP the pending link so it replays
  // the moment `user` becomes set. Configured-but-signed-out and unconfigured
  // both fall back to sign-in / the gentle prompt without losing the intent.
  useEffect(() => {
    if (!booted) return;
    const pending = pendingLinkRef.current;
    if (!pending) return;

    // Multiplayer requires Supabase configured. If not, drop the link to the
    // sign-in screen's "coming soon" state — nothing else we can do.
    if (!authConfigured) {
      pendingLinkRef.current = null;
      return;
    }
    // Not signed in yet → send to sign-in and WAIT (keep the pending link). The
    // effect re-runs when `user` flips after a successful sign-in.
    if (!user) {
      setScreen("signin");
      return;
    }

    // Signed in — consume the link.
    pendingLinkRef.current = null;
    if (pending.host === "friend") {
      const uid = pending.params.uid;
      (async () => {
        const res = await requestFriend(userRef.current, uid);
        if (res?.ignored) {
          setFriendsNote("That's your own invite link 🙂");
        } else if (res?.error) {
          setFriendsNote(res.error);
        } else if (res?.accepted) {
          setFriendsNote("You're now friends!");
        } else if (res?.existing) {
          setFriendsNote("You're already connected.");
        } else {
          setFriendsNote("Friend request sent!");
        }
        openFriends();
      })();
    } else if (pending.host === "join") {
      const hid = pending.params.hunt;
      if (hid) joinHunt(hid);
    }
  }, [booted, user, linkTick]);

  // Persist the active quest + progress whenever it changes while playing, so
  // the quest survives an app close (UX-SPEC §1.7).
  useEffect(() => {
    // Don't re-persist after completion: the completion effect removes STORE_KEY,
    // but the watcher is still live, so a stray post-finish GPS point (now that
    // routePath is a dep) would otherwise resurrect the just-deleted blob. The
    // final legitimate save still happens — this effect runs before the completion
    // effect flips the ref on the last-photo render (declaration order).
    // Persist on "reveal" too: a freshly generated quest sitting on the reveal
    // card is already durable, so killing the app there → relaunch offers Resume
    // (→ map, skipping the reveal, which is correct: reveal is the entry moment,
    // not a re-gate). Tapping "Begin" only flips the screen, never resets progress.
    if ((screen !== "ready" && screen !== "reveal") || !quest || completedFiredRef.current) return;
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

  // --- Warmer/colder + auto-find (the metal-detector loop) --------------------
  // Runs on every live position update for the CURRENT target (first not-found
  // stop). Computes the proximity band, buzzes ONLY on a band CHANGE (throttle —
  // not every GPS tick), pulsing stronger the hotter we get, and AUTO-TRIGGERS
  // the find when we reach the find radius. Lives here (not in the watcher
  // callback, which closes over a stale [screen]) so it always sees the live
  // coords + the freshest progress/target.
  useEffect(() => {
    if (screen !== "ready" || !quest || !coords || findReveal != null) return;
    const target = quest.stops.find((s) => !progress[s.order_index]?.found);
    if (!target?.place) return;
    const dist = distanceM(coords.latitude, coords.longitude, target.place.lat, target.place.lng);

    // Reached the find radius → reveal + collect (guarded inside findStop).
    if (dist <= FIND_RADIUS_M) {
      findStop(target.order_index, false);
      return;
    }

    // Band change → haptic pulse, stronger the hotter. Throttles by band id.
    const band = proximityBand(dist);
    if (band && band.id !== lastBandRef.current) {
      const prev = lastBandRef.current;
      lastBandRef.current = band.id;
      // Only buzz when getting WARMER (or first reading) — colder is silent, so
      // it reads as a metal detector, not a nag.
      const order = ["cold", "cool", "warm", "hot"];
      if (prev == null || order.indexOf(band.id) > order.indexOf(prev)) {
        const style =
          band.id === "hot"
            ? Haptics.ImpactFeedbackStyle.Heavy
            : band.id === "warm"
            ? Haptics.ImpactFeedbackStyle.Medium
            : Haptics.ImpactFeedbackStyle.Light;
        Haptics.impactAsync(style).catch(() => {});
      }
    }
  }, [coords, screen, quest, progress, findReveal]);

  // Pulse the warmer/colder indicator continuously, FASTER the hotter. Re-armed
  // whenever the current target's band changes. A looping scale breath via the
  // existing Animated API (Expo-Go safe). Idle (slow) when cold.
  useEffect(() => {
    if (screen !== "ready" || !quest) return;
    const target = quest.stops.find((s) => !progress[s.order_index]?.found);
    const dist =
      coords && target?.place
        ? distanceM(coords.latitude, coords.longitude, target.place.lat, target.place.lng)
        : null;
    const band = proximityBand(dist);
    // Pulse period shrinks as we heat up (metal-detector quickening).
    const period =
      band?.id === "hot" ? 380 : band?.id === "warm" ? 650 : band?.id === "cool" ? 1000 : 1500;
    warmthAnim.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(warmthAnim, { toValue: 1, duration: period, useNativeDriver: true }),
        Animated.timing(warmthAnim, { toValue: 0, duration: period, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
    // Re-run when the band would change (distance bucket) — keyed on a coarse
    // band id rather than raw coords so it doesn't restart on every GPS tick.
  }, [
    screen,
    quest,
    findReveal,
    proximityBand(
      coords && quest
        ? (() => {
            const t = quest.stops.find((s) => !progress[s.order_index]?.found);
            return t?.place
              ? distanceM(coords.latitude, coords.longitude, t.place.lat, t.place.lng)
              : null;
          })()
        : null
    )?.id,
  ]);

  // Arm the manual "reveal anyway" escape after a while on the SAME clue, so a
  // GPS/accessibility issue can never trap the user. Resets per target (keyed on
  // the current target's order_index + findReveal).
  useEffect(() => {
    if (screen !== "ready" || !quest || findReveal != null) {
      return;
    }
    const target = quest.stops.find((s) => !progress[s.order_index]?.found);
    if (!target) return;
    setEscapeArmed(false);
    const id = setTimeout(() => setEscapeArmed(true), ESCAPE_AFTER_MS);
    return () => clearTimeout(id);
    // Re-arm when the active target changes (its order_index) or a reveal closes.
  }, [
    screen,
    quest,
    findReveal,
    quest?.stops.find((s) => !progress[s.order_index]?.found)?.order_index,
  ]);

  // Fire quest_completed exactly once, when the last target is FOUND. In the hunt
  // a stop is "done" when found (reveal+collect), NOT when a photo lands — the
  // photo is now an optional post-reveal bonus.
  useEffect(() => {
    if (screen !== "ready" || !quest) return;
    const done = quest.stops.filter((s) => progress[s.order_index]?.found).length;
    if (done === quest.stops.length && !completedFiredRef.current) {
      completedFiredRef.current = true;
      track("quest_completed", { stops: quest.stops.length });
      // The success haptic fires from the Celebration banner on mount (the
      // visible "you did it" moment) — not here — so it never double-buzzes.

      // --- Light scoring + history (all ON-DEVICE, no login/server) --------
      // The per-stop check-in points were ALREADY banked into the lifetime total
      // live (see checkIn). To avoid double-counting, completion only banks the
      // +100 completion BONUS. The recap badge still SHOWS the full quest value
      // (check-ins + bonus) so the celebration reflects everything earned.
      const foundCount = quest.stops.filter((s) => progress[s.order_index]?.found).length;
      const bonusToBank = POINTS_PER_QUEST; // the not-yet-awarded portion
      const earned = foundCount * POINTS_PER_CHECKIN + POINTS_PER_QUEST; // display total
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
          // Travel mode for the gallery card (🚶/🚴). Stamped onto the quest at
          // generation; defaults to walk for quests saved before this existed.
          mode: quest.mode || "walk",
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

        // Roll the lifetime total, count, and weekly streak. Only the BONUS is
        // added to the total here — the per-check-in points are already banked
        // (avoids double-counting). quests_completed + streak still advance.
        const next = await recordScore(bonusToBank);
        setScore(next);
        // Local data only — but fire an analytics ping that points were earned.
        track("points_earned", { points: earned, total: next.total, streak_weeks: next.streak_weeks });

        // Collections: stops are ALREADY in the discovery set (collectItem wrote
        // each find live). recordCollections is now idempotent-safe and just
        // ensures any edge-case stop is present. The "+N new spots" delta is
        // computed against the PRE-QUEST snapshot (taken before any find), since a
        // diff against the now-merged set would always be 0.
        const { collections: nextCollections } = await recordCollections(areaLabel, quest.stops);
        setCollections(nextCollections);
        const preSet = preQuestDiscoveredRef.current;
        let newCount = 0;
        for (const s of quest.stops) {
          const k = placeKey(s.place);
          if (k && !preSet.has(k)) newCount += 1;
        }
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

        // SHARED HUNT result → leaderboard. Only when this quest has a hunt_id
        // (a shared hunt) AND the user is signed in. Solo/guest quests have no
        // hunt_id, so postHuntResult is a no-op and the leaderboard never grows
        // a row for them. Best-effort; upserts on (user_id, hunt_id) so a re-
        // complete just refreshes the row. Reuses the already-computed values.
        if (userRef.current && quest.hunt_id) {
          postHuntResult(userRef.current, {
            hunt_id: quest.hunt_id,
            area: areaLabel,
            found_count: foundCount,
            total_stops: quest.stops.length,
            time_seconds: timeS,
            points: earned,
          }).catch(() => {});
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
  // The find REVEAL overlay must be dismissed before the completion overlay
  // auto-presents — otherwise the final find's reveal/collect animation is
  // covered instantly. `findReveal` (the stop being revealed) gates this: while
  // it's set the user is reading the reveal, and dismissing it advances/completes.
  useEffect(() => {
    if (screen !== "ready" || !quest) return;
    const done = quest.stops.filter((s) => progress[s.order_index]?.found).length;
    const allDone = done === quest.stops.length;
    if (allDone && !findReveal && !recapAutoPresentedRef.current) {
      recapAutoPresentedRef.current = true;
      setSelectedStop(null); // clear any open stop card so the overlay is clean
      setRecapOpen(true);
    }
  }, [screen, quest, progress, findReveal]);

  // Start a quest. With NO args this is the simple one-tap default: request
  // permission → current GPS → quick quest (byte-identical to the original).
  // With opts.lat/lng it quests at a chosen place (Quest Setup sheet): no
  // permission/GPS needed, the typed label is passed through, and opts.size
  // scales the loop. opts.label, when present, makes the server skip the
  // reverse-geocode so the HUD shows the place the user typed.
  async function startQuest(opts = {}) {
    const hasPlace = Number.isFinite(opts.lat) && Number.isFinite(opts.lng);
    setScreen("loading");
    setError("");
    setProgress({});
    awardedRef.current = new Set(); // fresh quest — no stops awarded yet
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
    // Fresh hunt: no reveal showing, no hint, escape disarmed, bands/finds reset.
    setFindReveal(null);
    setHintShown(false);
    setEscapeArmed(false);
    lastBandRef.current = null;
    foundFiredRef.current = new Set();
    try {
      let latitude, longitude;
      if (hasPlace) {
        // Questing at a typed place — no device location needed.
        latitude = opts.lat;
        longitude = opts.lng;
      } else {
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (perm !== "granted") {
          setError("We need your location to find an adventure nearby.");
          setScreen("error");
          return;
        }
        const loc = await Location.getCurrentPositionAsync({});
        setCoords(loc.coords);
        ({ latitude, longitude } = loc.coords);
      }

      // Build the query: keep the one-tap URL identical (no label/size) so the
      // simple default path is unchanged; only append what the setup sheet adds.
      const params = new URLSearchParams({ lat: String(latitude), lng: String(longitude) });
      if (opts.label) params.set("label", opts.label);
      if (opts.size && opts.size !== "quick") params.set("size", opts.size);
      // Walk/Bike travel mode. Bike = a bigger loop; the server scales the
      // distance — we just send the mode. Omitted for the default walk so the
      // simple one-tap URL stays minimal.
      if (opts.mode && opts.mode !== "walk") params.set("mode", opts.mode);
      // SHARED HUNT (multiplayer). `shared=1` asks the server to mint a durable
      // hunt_id (the host starting a friend hunt). `huntId` (a joiner) fetches
      // the SAME existing hunt by id so everyone gets identical clues/places.
      // The server returns the quest WITH a `hunt_id` in both cases. Solo quests
      // send neither, so their URL/response are byte-identical to before.
      if (opts.shared) params.set("shared", "1");
      if (opts.huntId) {
        params.set("shared", "1");
        params.set("hunt_id", String(opts.huntId));
      }

      // No-repeat: exclude the places the user has already visited so each quest
      // in an area stays fresh. Build a comma-separated list of placeKeys from the
      // newest ~100 visited records (URLSearchParams URL-encodes the value). Built
      // here so EVERY entry point (welcome fast-path, New Quest FAB, completion,
      // setup) excludes visited. Best-effort: a read failure just sends no exclude.
      // EXCEPTION: a shared-hunt JOIN (opts.huntId) must send NO exclude — the
      // server returns the stored hunt verbatim so every player gets IDENTICAL
      // clues/places; a per-joiner exclude would diverge the hunt.
      if (!opts.huntId) {
        try {
          const visitedList = await readVisited(); // newest-first
          const excludeKeys = visitedList
            .slice(0, 100)
            .map((v) => v.placeKey)
            .filter(Boolean);
          if (excludeKeys.length) params.set("exclude", excludeKeys.join(","));
        } catch {
          /* no exclude — quest still builds, just may repeat places */
        }
      }

      const res = await fetch(`${API_BASE}/quest?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not build a quest here.");

      // Stamp the chosen travel mode onto the quest object so it's available to
      // the reveal card AND durable into the saved-history snapshot (the gallery
      // card reads it back; `travelMode` state would have reset on a cold-start
      // resume). Defaults to "walk" for the simple one-tap path.
      // Snapshot the Area's already-discovered places BEFORE any find collects
      // into the set, so the completion "+N new spots" delta is accurate (finds
      // now write into `discovered` live).
      const startArea = data.origin?.label || "Your Area";
      preQuestDiscoveredRef.current = new Set(
        Object.keys(collections[startArea]?.discovered || {})
      );
      // The spread preserves data.hunt_id when the server returns one (shared
      // start OR join), so it rides the quest object through to the completion
      // effect → hunt_results upsert. Solo quests have no hunt_id (no-op there).
      setQuest({ ...data, mode: opts.mode || "walk" });
      setSaved(null);

      // JOIN gracefulness: if the joiner is far from the hunt's area, surface a
      // gentle banner (don't block — they can still see the clues/leaderboard).
      // We compare the joiner's coords to the hunt origin when both are known.
      if (opts.huntId) {
        const oLat = data.origin?.lat;
        const oLng = data.origin?.lng;
        if (Number.isFinite(oLat) && Number.isFinite(oLng)) {
          const farM = distanceM(latitude, longitude, oLat, oLng);
          if (farM > 3000) {
            setJoinNote(
              `Heads up — this hunt is in ${data.origin?.label || "another area"}, about ` +
                `${(farM / 1000).toFixed(1)} km away. You can follow along, but the finds are there.`
            );
          } else {
            setJoinNote("");
          }
        }
      } else {
        setJoinNote("");
      }

      // Freshly generated quests open on the animated REVEAL card (the "<Area>
      // Quest" collectible). Tapping it enters the map ("ready"). resumeQuest()
      // goes straight to "ready", so resumed/in-progress quests never see this.
      setScreen("reveal");
      track("quest_started", {
        stops: data.stops?.length,
        size: opts.size || "quick",
        placed: hasPlace,
        shared: Boolean(opts.shared || opts.huntId),
        joined: Boolean(opts.huntId),
      });
    } catch (e) {
      // A failed start already wiped the in-memory progress at the top of this
      // function, but `quest` still holds the PREVIOUS quest. Drop that stale
      // quest so the error/welcome screen never offers it as a (progress-wiped)
      // Resume — which, if tapped, would persist the empty progress over the good
      // STORE_KEY blob and lose the real check-ins/photos. The disk blob is still
      // intact, so re-read it into `saved`: any genuinely in-progress quest is then
      // offered as Resume via the safe cold-start path (full progress restored).
      setQuest(null);
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const q = parsed?.quest;
          const prog = parsed?.progress || {};
          const done = q ? q.stops.filter((s) => prog[s.order_index]?.found).length : 0;
          if (q && done < q.stops.length) setSaved(parsed);
        }
      } catch {
        /* corrupt/missing — just no Resume offered */
      }
      setError(`${e.message}\n\nIs the server running (npm run serve)?\nTrying: ${API_BASE}`);
      setScreen("error");
    }
  }

  // Restore an in-progress quest from disk (UX-SPEC §1.1 / §1.7).
  function resumeQuest() {
    // LIVE branch (the lost-quest fix): when the quest is still in memory — the
    // user merely backed out to welcome via a HUD sub-screen, nothing was reset —
    // `saved` is null but `quest`/`progress`/routePathRef/startedAtRef/awardedRef
    // are all still correct. Just return to the map; touch nothing else so they
    // land exactly where they left off (stops, check-ins, photos, route, points).
    if (quest && !saved) {
      setScreen("ready");
      return;
    }
    // COLD-START branch: nothing live in memory — rehydrate from the disk blob
    // captured at launch (the existing path, unchanged below).
    if (!saved?.quest) return;
    setQuest(saved.quest);
    const restored = saved.progress || {};
    setProgress(restored);
    // Pre-seed the award guard with stops already FOUND last session, so a
    // resumed hunt can't re-award points for a target that already banked them.
    // The hunt resumes at the first not-found target with prior finds intact.
    awardedRef.current = new Set(
      Object.keys(restored).filter((k) => restored[k]?.found).map((k) => Number(k))
    );
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
    const done = saved.quest.stops.filter((s) => saved.progress?.[s.order_index]?.found).length;
    completedFiredRef.current = done === saved.quest.stops.length;
    celebratedRef.current = completedFiredRef.current; // already-complete resume shouldn't re-celebrate
    // Clean map on resume. If the resumed quest is ALREADY complete, arm the
    // auto-present guard so the overlay doesn't slam up — the Recap button opens
    // it on demand. An in-progress resume leaves it disarmed so finishing the
    // last stop still auto-presents completion.
    setSelectedStop(null);
    setRecapOpen(false);
    recapAutoPresentedRef.current = completedFiredRef.current;
    // Hunt resumes at the CURRENT clue (first not-found target) with finds intact.
    // Pre-seed the find guard from the already-found stops so they can't re-fire.
    foundFiredRef.current = new Set(
      Object.keys(restored).filter((k) => restored[k]?.found).map((k) => Number(k))
    );
    // Re-derive the pre-quest discovered snapshot for the "+N new spots" delta:
    // the Area's discovered set MINUS this quest's own stops (so spots found this
    // quest still count as new even though collectItem already wrote them live).
    const resumeArea = saved.quest.origin?.label || "Your Area";
    const resumeDiscovered = new Set(
      Object.keys(collections[resumeArea]?.discovered || {})
    );
    for (const s of saved.quest.stops) {
      const k = placeKey(s.place);
      if (k) resumeDiscovered.delete(k);
    }
    preQuestDiscoveredRef.current = resumeDiscovered;
    setFindReveal(null);
    setHintShown(false);
    setEscapeArmed(false);
    lastBandRef.current = null;
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
    awardedRef.current = new Set();
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

  // The single CHOKEPOINT for banking a FIND. Called by findStop() on every find
  // path (GPS-triggered, "found it" tap, or manual reveal fallback). The find is
  // now the CORE earning event: it banks points immediately, marks the target
  // FOUND, records the place into Visited AND its virtual_item into Collections,
  // and persists synchronously — all guarded so finding the same target twice
  // (GPS jitter around the find radius) never double-awards (once per target per
  // quest).
  async function checkIn(orderIndex) {
    // Idempotency guard: points + visited + collect happen exactly once per target
    // per quest. The render-closure check covers the normal (re-rendered) case;
    // the synchronous ref wins the sub-frame race two near-simultaneous triggers
    // (a GPS tick + the "found it" tap) could otherwise slip past, since we yield
    // at the first await before any re-render.
    if (progress[orderIndex]?.found || awardedRef.current.has(orderIndex)) return;
    awardedRef.current.add(orderIndex);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    const stop = quest?.stops?.find((s) => s.order_index === orderIndex);
    const area = quest?.origin?.label || "Your Area";
    const key = placeKey(stop?.place);
    const item = stop?.virtual_item || FALLBACK_ITEM;

    // Compute the next progress explicitly so we can persist it synchronously
    // below (don't rely on the debounced persist effect — the award must be
    // durable the instant it happens, closing any kill-between window). `found`
    // is the hunt's completion/resume predicate; `checkedIn` kept for back-compat.
    const next = {
      ...progress,
      [orderIndex]: { ...progress[orderIndex], checkedIn: true, found: true },
    };
    setProgress(next);

    // Persist the active-quest blob right now with the freshest route path, so a
    // crash immediately after the award can't lose the checked-in flag.
    AsyncStorage.setItem(
      STORE_KEY,
      JSON.stringify({ quest, progress: next, startedAt: startedAtRef.current, routePath: routePathRef.current })
    ).catch(() => {});

    track("stop_found", { order_index: orderIndex });

    // Bank the per-find points (lifetime total only — not quests_completed or
    // streak). Then push the fresh total to the cloud profile if signed in.
    const score2 = await addCheckinPoints(POINTS_PER_CHECKIN);
    setScore(score2);
    track("find_points_earned", { points: POINTS_PER_CHECKIN, total: score2.total });
    if (userRef.current) {
      pushScore(userRef.current, score2)
        .then(() => loadProfile(userRef.current.id))
        .then((p) => p && setProfile(p))
        .catch(() => {});
    }

    // Log the place to the persistent Visited history (de-duped by placeKey).
    const list = await appendVisited({
      placeKey: key,
      name: stop?.place?.name || "",
      area,
      photoUri: progress[orderIndex]?.photoUri || null,
      visited_at: new Date().toISOString(),
    });
    setVisited(list);

    // COLLECT the virtual item into the Area's collection right now (don't wait
    // for completion — a find should be durable on its own). Records the item
    // emoji alongside the existing {name, source_url, first_seen} entry.
    if (key) {
      const c = await collectItem(area, stop?.place, item);
      setCollections(c);
    }
  }

  // Trigger a FIND: the animated reveal-and-collect moment. Called when the user
  // reaches the find radius (GPS), taps "I found it!", or uses the manual reveal
  // escape. Guarded by foundFiredRef so GPS jitter can't double-fire the reveal.
  // `viaEscape` distinguishes the safety fallback (no-trap) for analytics; it
  // still grants the item + points (a small reward is fine — keeps it un-trappy).
  function findStop(orderIndex, viaEscape = false) {
    if (foundFiredRef.current.has(orderIndex)) return;
    foundFiredRef.current.add(orderIndex);
    setSelectedStop(null); // close any open card so the reveal owns the screen
    setEscapeArmed(false);
    setFindReveal(orderIndex); // show the reveal overlay for this target
    track("stop_revealed", { order_index: orderIndex, via: viaEscape ? "escape" : "found" });
    // Bank points + visited + collect the item (idempotent chokepoint). NOTE:
    // collection is durable HERE, at find — so every catch path (catch, skip,
    // permission-denied, no-camera) results in a collected item with no extra
    // work. The camera-catch is a presentation/celebration layer on top.
    checkIn(orderIndex);
    // Play the reveal card pop. Reset to 0 first so a second find in the same
    // session re-plays the animation. The item "collect-fly" (collectAnim) is NOT
    // played here anymore — it's deferred until the user CATCHES the item (camera
    // catch / skip / fallback) via completeCatch(), so the collectible visibly
    // stays "in the place" until caught.
    revealCardAnim.setValue(0);
    collectAnim.setValue(0);
    Animated.spring(revealCardAnim, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }).start();
  }

  // Open the camera-catch (the COLLECT step). Only callable from the find reveal
  // (the button lives in renderFindReveal), keeping the catch geo-gated.
  function openCatch() {
    setCatching(true);
  }

  // Finish the catch: play the item "collect-fly" toward the collection rail, then
  // advance. Called from every catch path — caught the sprite, skipped the camera,
  // or fell back (denied / no camera). collectItem already ran in checkIn (durable
  // at find), so we re-run it idempotently here purely so the collect is also
  // explicit at the catch and any FALLBACK_ITEM edge stays consistent; it's keyed
  // by placeKey so re-running is harmless. Either way the find completes.
  async function completeCatch(orderIndex) {
    // Re-entry guard: the camera path leaves both the sprite-tap and the footer
    // "skip" tappable, so two near-simultaneous taps could otherwise fire this
    // twice (double collect-fly + double nextClue). The collect itself is
    // idempotent, but this keeps the animation/advance clean. Cleared in nextClue.
    if (completingRef.current) return;
    completingRef.current = true;
    setCatching(false);
    // Idempotent re-collect (no-op if already in the set) — makes "tap → collects"
    // literally true on the catch path and self-documents the contract.
    const stop = quest?.stops?.find((s) => s.order_index === orderIndex);
    if (stop) {
      const area = quest?.origin?.label || "Your Area";
      const item = stop?.virtual_item || FALLBACK_ITEM;
      if (placeKey(stop?.place)) {
        const c = await collectItem(area, stop?.place, item);
        setCollections(c);
      }
    }
    // Play the collect-fly celebration, then advance to the next clue/completion.
    collectAnim.setValue(0);
    Animated.timing(collectAnim, { toValue: 1, duration: 650, useNativeDriver: true }).start(({ finished }) => {
      if (finished) nextClue();
    });
  }

  // Advance past the current reveal to the NEXT clue (or completion). Clearing
  // findReveal un-gates the completion auto-present effect when it was the last.
  function nextClue() {
    setFindReveal(null);
    setCatching(false); // tear down the camera-catch overlay if it was up
    completingRef.current = false; // re-arm the catch-completion guard for the next find
    setHintShown(false);
    setEscapeArmed(false);
    lastBandRef.current = null; // re-arm warmer/colder for the new target
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
      // Attach the photo to this place's Visited record (no points awarded here —
      // points were banked at check-in; photo is purely the visual claim/thumbnail).
      const stop = quest?.stops?.find((s) => s.order_index === orderIndex);
      const key = placeKey(stop?.place);
      if (key) setVisitedPhoto(key, uri).then(setVisited).catch(() => {});
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

  // Open the "Places Visited" history (every checked-in place, newest-first),
  // reading fresh from disk so it always reflects the latest check-ins.
  async function openVisited() {
    const list = await readVisited();
    setVisited(list);
    setScreen("visited");
    track("visited_opened", { count: list.length });
  }

  // Open the Scorecard view (lifetime score + per-Area bests), fresh from disk.
  async function openScorecard() {
    const [c, b] = await Promise.all([readScore(), readBests()]);
    setScore(c);
    setBests(b);
    setScreen("scorecard");
    track("scorecard_opened", { areas: Object.keys(b).length });
  }

  // Soft gate: the user chose to keep going anonymously. Persist the choice so
  // the sign-in screen is never forced again, then drop into the existing
  // welcome/home flow. Guest must ALWAYS work — this is the no-trap path.
  async function continueAsGuest() {
    try {
      await AsyncStorage.setItem(GUEST_KEY, "1");
    } catch {
      /* persistence is best-effort — proceed regardless so we never trap */
    }
    track("guest_chosen");
    setScreen("welcome");
  }

  // Open the optional Profile screen.
  function openProfile() {
    setAuthError("");
    setScreen("profile");
    track("profile_opened");
  }

  // --- Friends (Supabase-direct, RLS) -----------------------------------------
  // Load the friend graph and show the Friends screen. Gated behind sign-in by
  // the caller; if somehow reached signed-out, the screen renders the prompt.
  async function openFriends() {
    setFriendsNote("");
    setScreen("friends");
    track("friends_opened");
    await refreshFriends();
  }

  async function refreshFriends() {
    if (!user) return;
    setFriendsBusy(true);
    try {
      const next = await listFriends(userRef.current);
      setFriends(next);
    } finally {
      setFriendsBusy(false);
    }
  }

  // Share MY invite link. Opening it on a friend's phone creates a request to me.
  async function shareFriendInvite() {
    if (!user) return;
    const link = `${APP_SCHEME}://friend?uid=${user.id}`;
    track("friend_invite_shared");
    try {
      await Share.share({
        message: `Add me on DayQuest! Tap to send me a friend request:\n${link}`,
      });
    } catch {
      /* user dismissed the share sheet — nothing to do */
    }
  }

  async function onAcceptFriend(friendshipId) {
    if (!user) return;
    setFriendsBusy(true);
    const res = await acceptFriend(userRef.current, friendshipId);
    setFriendsNote(res.error ? res.error : "Friend added!");
    await refreshFriends();
  }

  async function onDeclineFriend(friendshipId) {
    if (!user) return;
    setFriendsBusy(true);
    const res = await declineFriend(userRef.current, friendshipId);
    setFriendsNote(res.error ? res.error : "Request removed.");
    await refreshFriends();
  }

  // --- Shared hunts (multiplayer) ---------------------------------------------
  // Host a shared hunt: start via /quest?shared=1 (server mints a hunt_id). The
  // Invite action below shares the join link once the quest is live. Reuses the
  // current Setup choices (place/size/mode) exactly like startSetupQuest.
  function startSharedHunt() {
    if (!setupReady) return;
    track("shared_hunt_started");
    const base = { shared: true, size: setupSize, mode: travelMode };
    if (setupMode === "place" && setupPlace) {
      startQuest({ ...base, lat: setupPlace.lat, lng: setupPlace.lng, label: setupPlace.name });
    } else {
      startQuest(base);
    }
  }

  // Share the CURRENT shared hunt's join link. Friends opening it join the same
  // hunt (identical clues/places). No-op if the active quest isn't shared.
  async function shareHuntInvite() {
    const hid = quest?.hunt_id;
    if (!hid) return;
    const link = `${APP_SCHEME}://join?hunt=${hid}`;
    track("hunt_invite_shared");
    try {
      await Share.share({
        message: `Join my DayQuest hunt! We race the same clues — tap to play:\n${link}`,
      });
    } catch {
      /* dismissed */
    }
  }

  // Join an existing shared hunt by id (from a deep link). Fetches the SAME
  // stored hunt from the server and drops into it. Needs device location to
  // frame the map; the far-from-area case is handled gracefully in startQuest.
  function joinHunt(huntId) {
    if (!huntId) return;
    track("hunt_joined", { hunt_id: huntId });
    startQuest({ huntId });
  }

  // --- Leaderboard ------------------------------------------------------------
  // Open the per-shared-hunt leaderboard for a given hunt_id, remembering where
  // Back returns to.
  async function openLeaderboard(huntId, returnTo = "welcome") {
    if (!huntId) return;
    setLeaderReturn(returnTo);
    setScreen("leaderboard");
    track("leaderboard_opened");
    setLeaderBusy(true);
    try {
      const rows = await fetchLeaderboard(userRef.current, huntId);
      setLeaderRows(rows);
    } finally {
      setLeaderBusy(false);
    }
  }

  // --- Quest Setup sheet ------------------------------------------------------
  // Open the setup sheet, remembering where Cancel should return to.
  function openSetup() {
    setSetupReturn(screen === "ready" ? "ready" : "welcome");
    setSetupError("");
    setScreen("setup");
    track("setup_opened");
  }

  // Close the setup sheet without starting — back to wherever we came from.
  function closeSetup() {
    setScreen(setupReturn);
  }

  // Forward-geocode the typed place via the server. No device permission needed
  // (you may be planning a quest somewhere else entirely).
  async function resolveSetupPlace() {
    const q = setupQuery.trim();
    if (!q || setupResolving) return;
    setSetupResolving(true);
    setSetupError("");
    setSetupPlace(null);
    try {
      const res = await fetch(`${API_BASE}/resolve-place?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't find that place.");
      setSetupPlace({ name: data.name, lat: data.lat, lng: data.lng });
      track("place_resolved", { q });
    } catch (e) {
      setSetupError(e.message || "Couldn't find that place. Try a different name.");
    } finally {
      setSetupResolving(false);
    }
  }

  // Whether the sheet has everything it needs to start a quest.
  const setupReady =
    setupMode === "current" || (setupMode === "place" && setupPlace != null);

  // Generate a quest from the chosen location + size.
  function startSetupQuest() {
    if (!setupReady) return;
    if (setupMode === "place" && setupPlace) {
      startQuest({ lat: setupPlace.lat, lng: setupPlace.lng, label: setupPlace.name, size: setupSize, mode: travelMode });
    } else {
      startQuest({ size: setupSize, mode: travelMode });
    }
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
      // iOS Apple uses the NATIVE flow (Apple's system sheet → identity token →
      // supabase.signInWithIdToken). It returns the same shape as the web-redirect
      // helper, so everything below is identical. Google (and Apple on non-iOS)
      // keep the existing web-redirect OAuth.
      const res =
        provider === "apple" && Platform.OS === "ios"
          ? await signInWithAppleNative()
          : await signInWithProvider(provider);
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
      // If sign-in happened from the soft-gate entry screen, proceed into the
      // home/welcome flow as a signed-in user. Sign-in from the Profile screen
      // stays put — its signed-in card renders in place (existing behavior).
      if (screen === "signin") setScreen("welcome");
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

  // The "Continue with Apple" control. On iOS we MUST use Apple's own branded
  // button (App Store Guideline 4.8 / Apple HIG) — rendered with an explicit
  // width+height (it draws blank without them). `cornerRadius` matches the site's
  // surrounding buttons (28 on the rounded sign-in screen, 12 on the profile
  // card). On Android there is no Apple sign-in, so we render nothing.
  function renderAppleButton({ cornerRadius }) {
    if (Platform.OS !== "ios") return null;
    return (
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={cornerRadius}
        style={[styles.appleBtn, authBusy && styles.actionBtnDisabled]}
        onPress={() => {
          if (authBusy) return;
          handleSignIn("apple");
        }}
      />
    );
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

  // --- Sign-in entry (SOFT gate) ---------------------------------------------
  // The app's first screen on a fresh launch. NOT a wall: "Continue as guest"
  // always works and is clearly tappable. Provider buttons run the existing
  // OAuth helpers; failure/cancel surfaces an inline message (never crashes).
  // When auth is unconfigured the provider buttons are replaced with a gentle
  // "sign-in unavailable" line and guest is the way forward. MUST return before
  // the `ready` fallthrough below,
  // which dereferences `quest` (null here).
  if (screen === "signin") {
    return (
      <View style={styles.signinScreen}>
        <StatusBar style="dark" />
        <View style={styles.signinHero}>
          <Text style={styles.signinLogo}>DayQuest</Text>
          <Text style={styles.signinValueProp}>
            Turn your neighborhood into an adventure.
          </Text>
        </View>

        <View style={styles.signinActions}>
          {authConfigured ? (
            <>
              <TouchableOpacity
                style={[styles.oauthBtn, styles.signinBtn, authBusy && styles.actionBtnDisabled]}
                onPress={() => handleSignIn("google")}
                disabled={authBusy}
                activeOpacity={0.85}
              >
                <Text style={styles.oauthBtnText}>Continue with Google</Text>
              </TouchableOpacity>
              {renderAppleButton({ cornerRadius: 28 })}
              {authBusy ? <ActivityIndicator style={{ marginTop: 16 }} color={ACCENT} /> : null}
              {authError ? <Text style={styles.error}>{authError}</Text> : null}
            </>
          ) : (
            <Text style={styles.signinUnavailable}>
              Sign-in isn't available right now — jump straight in below.
            </Text>
          )}

          {/* Always-available anonymous-first path. Never gated. */}
          <TouchableOpacity
            style={styles.guestBtn}
            onPress={continueAsGuest}
            disabled={authBusy}
            activeOpacity={0.7}
          >
            <Text style={styles.guestBtnText}>Continue as guest</Text>
          </TouchableOpacity>
          <Text style={styles.signinFootnote}>
            No account needed. You can sign in later to save your progress.
          </Text>
        </View>
      </View>
    );
  }

  if (screen === "welcome" || screen === "error") {
    // Resume is offered for EITHER an in-progress quest still live in memory (the
    // user backed out via a HUD sub-screen — `saved` is null but `quest` is intact)
    // OR a cold-start quest rehydrated from disk at launch (`saved`). A quest still
    // in memory that's already complete is excluded — there's nothing to resume.
    const liveInProgress =
      quest && quest.stops.some((s) => !progress[s.order_index]?.found);
    const savedQuest = liveInProgress ? quest : saved?.quest;
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
            <PressBounce style={styles.button} onPress={resumeQuest}>
              <Text style={styles.buttonText}>Resume your quest</Text>
            </PressBounce>
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

        {/* FRONT DOOR: the prominent path is picking area + walk/bike + size in
            Quest Setup (UX-SPEC core loop). On the error screen we keep the
            primary as a direct "Try again" one-tap retry. */}
        {screen === "error" ? (
          <PressBounce style={styles.button} onPress={() => startQuest()}>
            <Text style={styles.buttonText}>Try again</Text>
          </PressBounce>
        ) : (
          <PressBounce style={styles.button} onPress={openSetup}>
            <Text style={styles.buttonText}>Start a Quest</Text>
          </PressBounce>
        )}
        {/* Fast path retained: a one-tap quest at your current location. */}
        <Text style={styles.setupLink} onPress={() => startQuest()}>
          ⚡ Quick quest right here
        </Text>
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
        <Text style={styles.historyLink} onPress={openVisited}>
          📍 Places Visited
        </Text>
        <Text style={styles.historyLink} onPress={openHistory}>
          📜 My Quests
        </Text>

        {/* MULTIPLAYER entry — gated behind sign-in. Signed in: go to Friends.
            Configured-but-signed-out OR unconfigured: a gentle "sign in to play
            with friends" prompt that routes to the sign-in screen. The solo flow
            above is untouched either way. */}
        {user ? (
          <Text style={styles.historyLink} onPress={openFriends}>
            👥 Friends
          </Text>
        ) : (
          <Text
            style={styles.historyLink}
            onPress={() => (authConfigured ? setScreen("signin") : null)}
          >
            👥 Sign in to play with friends
          </Text>
        )}

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
            {renderAppleButton({ cornerRadius: 12 })}

            {authBusy ? <ActivityIndicator style={{ marginTop: 16 }} color={ACCENT} /> : null}
            {authError ? <Text style={styles.error}>{authError}</Text> : null}
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // --- FRIENDS screen ---------------------------------------------------------
  // Gated behind sign-in (the entry hides it for guests). Lists accepted friends,
  // incoming pending requests (Accept/Decline), and an Add-friend (share invite
  // link) action. All via Supabase RLS through lib/social.js.
  if (screen === "friends") {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <StatusBar style="dark" />
        <Text style={styles.backLink} onPress={() => setScreen("welcome")}>
          ← Back
        </Text>
        <Text style={styles.theme}>Friends</Text>

        {!user ? (
          <>
            <Text style={styles.intro}>
              Sign in to add friends, hunt together, and climb the leaderboard.
            </Text>
            {authConfigured ? (
              <TouchableOpacity style={styles.button} onPress={() => setScreen("signin")}>
                <Text style={styles.buttonText}>Sign in</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.permNote}>Friends are coming soon.</Text>
            )}
          </>
        ) : (
          <>
            <Text style={styles.intro}>
              Share your invite link so friends can add you — then hunt the same
              clues and race the leaderboard.
            </Text>

            <TouchableOpacity style={styles.button} onPress={shareFriendInvite}>
              <Text style={styles.buttonText}>➕ Add a friend (share link)</Text>
            </TouchableOpacity>

            {friendsNote ? <Text style={styles.friendsNote}>{friendsNote}</Text> : null}
            {friendsBusy ? <ActivityIndicator style={{ marginTop: 12 }} color={ACCENT} /> : null}

            {/* Incoming requests (Accept / Decline). */}
            {friends.incoming.length > 0 ? (
              <>
                <Text style={styles.setupSectionLabel}>Requests</Text>
                {friends.incoming.map((f) => (
                  <View key={f.friendshipId} style={styles.friendRow}>
                    <Text style={styles.friendName} numberOfLines={1}>
                      {f.display_name}
                    </Text>
                    <View style={styles.friendActions}>
                      <TouchableOpacity
                        style={styles.friendAccept}
                        onPress={() => onAcceptFriend(f.friendshipId)}
                        disabled={friendsBusy}
                      >
                        <Text style={styles.friendAcceptText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.friendDecline}
                        onPress={() => onDeclineFriend(f.friendshipId)}
                        disabled={friendsBusy}
                      >
                        <Text style={styles.friendDeclineText}>Decline</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </>
            ) : null}

            {/* Accepted friends. */}
            <Text style={styles.setupSectionLabel}>Your friends</Text>
            {friends.friends.length === 0 ? (
              <Text style={styles.permNote}>
                No friends yet. Share your invite link to add one.
              </Text>
            ) : (
              friends.friends.map((f) => (
                <View key={f.friendshipId} style={styles.friendRow}>
                  <Text style={styles.friendName} numberOfLines={1}>
                    👤 {f.display_name}
                  </Text>
                  <TouchableOpacity
                    style={styles.friendDecline}
                    onPress={() => onDeclineFriend(f.friendshipId)}
                    disabled={friendsBusy}
                  >
                    <Text style={styles.friendDeclineText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}

            {/* Outgoing pending (informational). */}
            {friends.outgoing.length > 0 ? (
              <>
                <Text style={styles.setupSectionLabel}>Pending (sent)</Text>
                {friends.outgoing.map((f) => (
                  <View key={f.friendshipId} style={styles.friendRow}>
                    <Text style={styles.friendName} numberOfLines={1}>
                      {f.display_name}
                    </Text>
                    <Text style={styles.friendPending}>Awaiting…</Text>
                  </View>
                ))}
              </>
            ) : null}
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // --- LEADERBOARD screen -----------------------------------------------------
  // Per-shared-hunt ranking (fastest → most found → most points), profile-joined.
  // "Back" returns to wherever it was opened from (reveal / ready / welcome).
  if (screen === "leaderboard") {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <StatusBar style="dark" />
        <Text
          style={styles.backLink}
          onPress={() => setScreen(leaderReturn === "reveal" ? "reveal" : leaderReturn)}
        >
          ← Back
        </Text>
        <Text style={styles.theme}>Leaderboard</Text>
        <Text style={styles.intro}>Fastest time wins. You vs your friends on this hunt.</Text>

        {leaderBusy ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={ACCENT} />
        ) : leaderRows.length === 0 ? (
          <Text style={styles.permNote}>
            No results yet. Finish the hunt (and have a friend finish too) to see the
            ranking here.
          </Text>
        ) : (
          leaderRows.map((r) => (
            <View
              key={r.userId}
              style={[styles.leaderRow, r.isMe && styles.leaderRowMe]}
            >
              <Text style={styles.leaderRank}>{r.rank}</Text>
              <Text style={styles.leaderName} numberOfLines={1}>
                {r.isMe ? "You" : r.display_name}
              </Text>
              <View style={styles.leaderStats}>
                <Text style={styles.leaderTime}>
                  {r.time_seconds == null ? "—" : formatDuration(r.time_seconds)}
                </Text>
                <Text style={styles.leaderMeta}>
                  {r.found_count}/{r.total_stops} · {r.points} pts
                </Text>
              </View>
            </View>
          ))
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
        <Text style={styles.intro}>Your collection of completed quests. Tap a card to relive it.</Text>
        {history.length === 0 ? (
          <Text style={styles.intro}>
            No quests yet. Finish one and it'll be saved here — as a collectible card.
          </Text>
        ) : (
          history.map((rec) => {
            // Hero photo = first stop that has one (the gallery card's banner).
            const thumb = rec.stops?.find((s) => s.photoUri)?.photoUri || null;
            const stopNames = (rec.stops || [])
              .map((s) => s.name)
              .filter(Boolean);
            const modeEmoji = rec.mode === "bike" ? "🚴" : "🚶";
            return (
              <TouchableOpacity
                key={rec.id}
                style={styles.questCard}
                onPress={() => setHistoryRecord(rec)}
                activeOpacity={0.88}
              >
                {/* Hero banner: the user's photography, full-bleed across the top. */}
                {thumb ? (
                  <Image source={{ uri: thumb }} style={styles.questCardHero} resizeMode="cover" />
                ) : (
                  <View style={[styles.questCardHero, styles.questCardHeroEmpty]}>
                    <Text style={styles.questCardHeroMark}>✦</Text>
                  </View>
                )}
                <View style={styles.questCardBody}>
                  <Text style={styles.questCardTheme} numberOfLines={2}>{rec.theme}</Text>
                  {rec.origin_label ? (
                    <Text style={styles.questCardArea} numberOfLines={1}>📍 {rec.origin_label}</Text>
                  ) : null}
                  {/* Meta chips: date · mode · points. */}
                  <View style={styles.questCardMetaRow}>
                    <Text style={styles.questCardMeta}>{formatHistoryDate(rec.completed_at)}</Text>
                    <Text style={styles.questCardDot}>·</Text>
                    <Text style={styles.questCardMeta}>{modeEmoji}</Text>
                    <Text style={styles.questCardDot}>·</Text>
                    <Text style={styles.questCardPts}>{rec.points} pts</Text>
                  </View>
                  {/* The stops hit on this quest. */}
                  {stopNames.length ? (
                    <Text style={styles.questCardStops} numberOfLines={2}>
                      {stopNames.join(" • ")}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  if (screen === "visited") {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <StatusBar style="dark" />
        <Text style={styles.backLink} onPress={() => setScreen("welcome")}>
          ← Back
        </Text>
        <Text style={styles.theme}>Places Visited</Text>
        <Text style={styles.intro}>Every spot you've checked into, newest first.</Text>
        {visited.length === 0 ? (
          <Text style={styles.intro}>
            No places yet. Check in at a stop on a quest and it shows up here — even if
            you don't finish the whole quest.
          </Text>
        ) : (
          visited.map((v) => (
            <View key={v.placeKey} style={styles.visitRow}>
              {v.photoUri ? (
                <Image source={{ uri: v.photoUri }} style={styles.collThumb} />
              ) : (
                <View style={[styles.collThumb, styles.collThumbEmpty]}>
                  <Text style={styles.collThumbMark}>📍</Text>
                </View>
              )}
              <View style={styles.visitMeta}>
                <Text style={styles.visitName} numberOfLines={2}>
                  {v.name || "Unknown spot"}
                </Text>
                <Text style={styles.visitArea} numberOfLines={1}>
                  {v.area || "Your Area"}
                </Text>
                <Text style={styles.visitDate}>{formatHistoryDate(v.visited_at)}</Text>
              </View>
            </View>
          ))
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

  if (screen === "setup") {
    return (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <StatusBar style="dark" />
        <Text style={styles.backLink} onPress={closeSetup}>
          ← Back
        </Text>
        <Text style={styles.theme}>Quest Setup</Text>
        <Text style={styles.setupIntro}>
          Choose where to explore and how far you want to roam.
        </Text>

        {/* WHERE ---------------------------------------------------------- */}
        <Text style={styles.setupSectionLabel}>Where</Text>
        <View style={styles.segmentRow}>
          <TouchableOpacity
            style={[styles.segment, setupMode === "current" && styles.segmentActive]}
            onPress={() => { setSetupMode("current"); setSetupError(""); }}
            activeOpacity={0.85}
          >
            <Text style={[styles.segmentText, setupMode === "current" && styles.segmentTextActive]}>
              📍 My location
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segment, setupMode === "place" && styles.segmentActive]}
            onPress={() => { setSetupMode("place"); setSetupError(""); }}
            activeOpacity={0.85}
          >
            <Text style={[styles.segmentText, setupMode === "place" && styles.segmentTextActive]}>
              🔎 A place
            </Text>
          </TouchableOpacity>
        </View>

        {setupMode === "place" ? (
          <View style={styles.placeBlock}>
            <View style={styles.placeInputRow}>
              <TextInput
                style={styles.placeInput}
                value={setupQuery}
                onChangeText={(t) => { setSetupQuery(t); setSetupPlace(null); setSetupError(""); }}
                placeholder="e.g. East Village, Stony Brook NY"
                placeholderTextColor={MUTE}
                autoCapitalize="words"
                returnKeyType="search"
                onSubmitEditing={resolveSetupPlace}
              />
              <TouchableOpacity
                style={styles.placeFindBtn}
                onPress={resolveSetupPlace}
                disabled={setupResolving || !setupQuery.trim()}
                activeOpacity={0.85}
              >
                {setupResolving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.placeFindText}>Find</Text>
                )}
              </TouchableOpacity>
            </View>
            {setupPlace ? (
              <Text style={styles.placeResolved}>✓ {setupPlace.name}</Text>
            ) : null}
            {setupError ? <Text style={styles.setupErr}>{setupError}</Text> : null}
          </View>
        ) : null}

        {/* HOW (travel mode) ---------------------------------------------- */}
        <Text style={styles.setupSectionLabel}>How</Text>
        <View style={styles.segmentRow}>
          <TouchableOpacity
            style={[styles.segment, travelMode === "walk" && styles.segmentActive]}
            onPress={() => setTravelMode("walk")}
            activeOpacity={0.85}
          >
            <Text style={[styles.segmentText, travelMode === "walk" && styles.segmentTextActive]}>
              🚶 Walk
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segment, travelMode === "bike" && styles.segmentActive]}
            onPress={() => setTravelMode("bike")}
            activeOpacity={0.85}
          >
            <Text style={[styles.segmentText, travelMode === "bike" && styles.segmentTextActive]}>
              🚲 Bike
            </Text>
          </TouchableOpacity>
        </View>

        {/* SIZE ----------------------------------------------------------- */}
        <Text style={styles.setupSectionLabel}>Size</Text>
        <View style={styles.sizeRow}>
          <TouchableOpacity
            style={[styles.sizeCard, setupSize === "quick" && styles.sizeCardActive]}
            onPress={() => setSetupSize("quick")}
            activeOpacity={0.85}
          >
            <Text style={styles.sizeName}>Quick</Text>
            <Text style={styles.sizeDetail}>~1km · 3 stops</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sizeCard, setupSize === "explore" && styles.sizeCardActive]}
            onPress={() => setSetupSize("explore")}
            activeOpacity={0.85}
          >
            <Text style={styles.sizeName}>Explore</Text>
            <Text style={styles.sizeDetail}>~2km · up to 5 stops</Text>
          </TouchableOpacity>
        </View>
        {/* Epic gets its own full-width row so the longer label has room and the
            two-up Quick/Explore cards above stay uncramped. Sends size=epic. */}
        <TouchableOpacity
          style={[styles.sizeCardWide, setupSize === "epic" && styles.sizeCardActive]}
          onPress={() => setSetupSize("epic")}
          activeOpacity={0.85}
        >
          <Text style={styles.sizeName}>Epic 🏆</Text>
          <Text style={styles.sizeDetail}>A longer hunt · 7–8 finds</Text>
        </TouchableOpacity>

        <PressBounce
          style={[styles.button, !setupReady && styles.buttonDisabled]}
          onPress={startSetupQuest}
          disabled={!setupReady}
        >
          <Text style={styles.buttonText}>Start Quest</Text>
        </PressBounce>

        {/* HUNT WITH FRIENDS — a shared hunt everyone races on identical clues.
            Gated behind sign-in: signed-in users get the button; otherwise a
            gentle prompt. The solo "Start Quest" above is unchanged. */}
        {user ? (
          <TouchableOpacity
            style={[styles.secondaryBtn, !setupReady && styles.buttonDisabled]}
            onPress={startSharedHunt}
            disabled={!setupReady}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryBtnText}>👥 Hunt with friends</Text>
          </TouchableOpacity>
        ) : authConfigured ? (
          <Text style={styles.setupLink} onPress={() => setScreen("signin")}>
            👥 Sign in to hunt with friends
          </Text>
        ) : null}

        {setupMode === "place" && !setupPlace ? (
          <Text style={styles.permNote}>Find a place above to start questing there.</Text>
        ) : null}
        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  if (screen === "loading") {
    return (
      <>
        <StatusBar style="dark" />
        <QuestScanner />
      </>
    );
  }

  // --- Quest REVEAL card ------------------------------------------------------
  // The "<Area> Quest" collectible, shown the moment a freshly generated quest
  // returns from the server. A game-y card that springs/flips/fades in (Animated
  // only) showing the THEME, area, mode, stop count, and a prominent Begin CTA.
  // Tapping Begin enters the existing map ("ready"); nothing is reset, so the
  // live quest/progress flow downstream is byte-identical to before. Defends
  // against a null quest (shouldn't happen — set before this screen) by falling
  // back to welcome so we never crash dereferencing quest fields.
  if (screen === "reveal") {
    if (!quest) {
      setScreen("welcome");
      return null;
    }
    const modeEmoji = quest.mode === "bike" ? "🚴" : "🚶";
    const modeLabel = quest.mode === "bike" ? "Bike" : "Walk";
    const stopCount = quest.stops?.length || 0;
    // Card transforms: a scale "pop" + a subtle Y-axis flip (perspective) + fade,
    // all native-driver-friendly. The shimmer of arriving as a collectible.
    const revealScale = revealAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
    const revealFlip = revealAnim.interpolate({ inputRange: [0, 1], outputRange: ["18deg", "0deg"] });
    const revealLift = revealAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
    return (
      <View style={styles.revealScreen}>
        <StatusBar style="light" />
        <Animated.View
          style={[
            styles.revealCard,
            {
              opacity: revealAnim,
              transform: [
                { perspective: 800 },
                { translateY: revealLift },
                { scale: revealScale },
                { rotateX: revealFlip },
              ],
            },
          ]}
        >
          <Text style={styles.revealKicker}>SCAVENGER HUNT UNLOCKED</Text>
          <Text style={styles.revealTheme}>
            {quest.origin?.label ? `${quest.origin.label} Hunt` : quest.theme}
          </Text>
          <Text style={styles.revealArea} numberOfLines={2}>
            {stopCount} hidden place{stopCount === 1 ? "" : "s"} to find
          </Text>

          <View style={styles.revealStatsRow}>
            <View style={styles.revealStat}>
              <Text style={styles.revealStatNum}>{modeEmoji}</Text>
              <Text style={styles.revealStatLabel}>{modeLabel}</Text>
            </View>
            <View style={styles.revealStatDivider} />
            <View style={styles.revealStat}>
              <Text style={styles.revealStatNum}>{stopCount}</Text>
              <Text style={styles.revealStatLabel}>{stopCount === 1 ? "find" : "finds"}</Text>
            </View>
          </View>

          {/* SHARED HUNT join banner: shown when the joiner is far from the
              hunt's area (set in startQuest). Gentle, non-blocking. */}
          {quest.hunt_id && joinNote ? (
            <Text style={styles.joinBanner}>{joinNote}</Text>
          ) : null}

          <PressBounce
            style={styles.revealBeginBtn}
            onPress={() => setScreen("ready")}
          >
            <Text style={styles.revealBeginText}>Begin</Text>
          </PressBounce>

          {/* SHARED HUNT actions: invite friends to race the identical hunt, and
              peek at the live leaderboard. Only on a shared hunt (has hunt_id). */}
          {quest.hunt_id ? (
            <>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={shareHuntInvite}
                activeOpacity={0.85}
              >
                <Text style={styles.secondaryBtnText}>📨 Invite friends</Text>
              </TouchableOpacity>
              <Text
                style={styles.setupLink}
                onPress={() => openLeaderboard(quest.hunt_id, "reveal")}
              >
                🏆 Leaderboard
              </Text>
            </>
          ) : null}

          <Text style={styles.revealHint}>Follow the clues. No pins — you have to hunt.</Text>
        </Animated.View>
      </View>
    );
  }

  // screen === "ready" — SCAVENGER HUNT, Pokémon-GO-style layout: a full-screen
  // map showing ONLY the current target's ~200m search ZONE (a Circle, never a
  // pin) + the live user dot. A floating clue card riddles the place (name
  // hidden), a warmer/colder meter tracks live GPS distance, and reaching the
  // find radius reveals + collects. Completion surfaces as a full-screen overlay.
  const doneCount = quest.stops.filter((s) => progress[s.order_index]?.found).length;
  const allDone = doneCount === quest.stops.length;
  // The CURRENT target = first not-found stop in walking order. null once all
  // found (the hunt is complete). Its name/pin stay HIDDEN until found.
  const currentTarget = quest.stops.find((s) => !progress[s.order_index]?.found) || null;
  // Live distance to the current target + its proximity band (warmer/colder).
  const targetDist =
    coords && currentTarget?.place
      ? distanceM(coords.latitude, coords.longitude, currentTarget.place.lat, currentTarget.place.lng)
      : null;
  const band = proximityBand(targetDist);
  // The stop being REVEALED right now (the "You found it!" moment), if any.
  const revealStop =
    findReveal != null ? quest.stops.find((s) => s.order_index === findReveal) : null;
  // The stop whose post-reveal detail is shown in the pop-out card (FOUND stops
  // only — tapping a collected target dot to re-read its lore / add a photo).
  const activeStop =
    selectedStop != null ? quest.stops.find((s) => s.order_index === selectedStop) : null;

  // --- Renderers for the hunt UI -----------------------------------------------
  // Post-reveal detail card for an ALREADY-FOUND target. The name + lore are now
  // safe to show (the place has been found); offers the optional quest_prompt
  // photo bonus + source/flag. Reached by tapping a found target's dot, or right
  // after the reveal via "Add a photo".
  function renderStopDetail(s) {
    const state = progress[s.order_index] || {};
    const item = s.virtual_item || FALLBACK_ITEM;
    return (
      <ScrollView
        style={styles.cardScroll}
        contentContainerStyle={styles.cardScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.foundBanner}>
          <Text style={styles.foundBannerText}>✓ Found it!  {item}</Text>
        </View>
        <Text style={styles.stopTitle} numberOfLines={2}>
          {s.place.name}
        </Text>
        <Text style={styles.body}>{s.description}</Text>
        <Text style={styles.why}>Why: {s.reason}</Text>
        {s.lore_hook ? <Text style={styles.lore}>{s.lore_hook}</Text> : null}
        {s.quest_prompt ? (
          <View style={styles.questBox}>
            <Text style={styles.questText}>
              {QUEST_EMOJI[s.quest_type] || "📷"}  {s.quest_prompt}
            </Text>
          </View>
        ) : null}

        {/* Optional photo BONUS (no longer gates completion). */}
        {state.photoUri ? (
          <Image source={{ uri: state.photoUri }} style={styles.photo} />
        ) : (
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGo]} onPress={() => takePhoto(s.order_index)}>
            <Text style={styles.actionText}>📷 Snap a photo (bonus)</Text>
          </TouchableOpacity>
        )}

        <View style={styles.cardFooter}>
          <Text style={styles.source} onPress={() => Linking.openURL(s.place.source_url)}>
            source ↗
          </Text>
          <Text style={styles.flagLink} onPress={() => flagStop(s)}>
            {flagged[s.order_index] ? "✓ flagged — thanks" : "something off with this stop?"}
          </Text>
        </View>
        <View style={{ height: 8 }} />
      </ScrollView>
    );
  }

  // The animated "You found it!" REVEAL: shows the place name + lore (safe now),
  // then offers the camera-CATCH as the COLLECT step. The collectible's emoji
  // flies into the collection rail only AFTER it's caught (collectAnim, played by
  // completeCatch). Overlays the map. The catch (and only the catch) is reachable
  // from here, so it's geo-gated to the solved place.
  //
  // When `catching` is true the full-screen CameraCatch overlay is rendered ON
  // TOP of this reveal (findReveal stays set so the completion auto-present stays
  // gated). Every CameraCatch outcome — caught the sprite (onCatch), or skipped /
  // fell back (onCancel) — runs completeCatch(): collect-fly → nextClue(). There
  // is no path that leaves the user stuck.
  function renderFindReveal(s) {
    const item = s.virtual_item || FALLBACK_ITEM;
    const remaining = quest.stops.filter((st) => !progress[st.order_index]?.found).length;
    const isLast = remaining === 0;
    const cardScaleR = revealCardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
    // The item "collects": pops up then flies toward the top-right collection rail.
    // Only animates once completeCatch() drives collectAnim 0→1 after a catch.
    const itemScale = collectAnim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 1.4, 0.4] });
    const itemTranslateY = collectAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -260] });
    const itemTranslateX = collectAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 120] });
    const itemOpacity = collectAnim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });
    // The "added to your collection" caption only makes sense after the catch.
    const captionOpacity = collectAnim.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] });
    return (
      <View style={styles.revealOverlay}>
        <Confetti width={SCREEN_W} />
        <Animated.View style={[styles.findCard, { opacity: revealCardAnim, transform: [{ scale: cardScaleR }] }]}>
          <Text style={styles.findKicker}>YOU FOUND IT!</Text>
          <Text style={styles.findName} numberOfLines={3}>
            {s.place.name}
          </Text>
          {s.lore_hook || s.reason ? (
            <Text style={styles.findLore} numberOfLines={6}>
              {s.lore_hook || s.reason}
            </Text>
          ) : null}

          {/* The collectible — flies toward the collection rail once caught. */}
          <View style={styles.collectWrap}>
            <Animated.Text
              style={[
                styles.collectItem,
                { opacity: itemOpacity, transform: [{ translateY: itemTranslateY }, { translateX: itemTranslateX }, { scale: itemScale }] },
              ]}
            >
              {item}
            </Animated.Text>
            <Animated.Text style={[styles.collectCaption, { opacity: captionOpacity }]}>
              {item} added to your collection
            </Animated.Text>
          </View>

          <View style={styles.findActions}>
            {!s.quest_prompt ? null : (
              // Opens the camera OVER the reveal (no findReveal/selectedStop
              // churn): the photo attaches in place, the reveal stays up, and the
              // user advances only via "Next clue" → full nextClue() cleanup. This
              // avoids un-gating completion early on the last find and avoids
              // leaking the next clue's hint via a missed lastBandRef/hintShown reset.
              <Text style={styles.findPhotoLink} onPress={() => takePhoto(s.order_index)}>
                📷 Add a photo
              </Text>
            )}
            {/* COLLECT step = catch the collectible with the camera (geo-gated to
                here). The skip is the never-trap escape — it collects + advances
                without the camera. */}
            <PressBounce style={styles.findCatchBtn} onPress={openCatch}>
              <Text style={styles.findCatchText}>📸 Catch your {item}!</Text>
            </PressBounce>
            <Text style={styles.findPhotoLink} onPress={() => completeCatch(s.order_index)}>
              {isLast ? "Skip camera, just collect & finish 🎉" : "Skip camera, just collect →"}
            </Text>
          </View>
        </Animated.View>

        {/* Full-screen camera-catch overlay (the COLLECT step). Mounted only
            while `catching`, only from inside this reveal → structurally
            geo-gated. Both outcomes route through completeCatch. */}
        {catching ? (
          <View style={StyleSheet.absoluteFill}>
            <CameraCatch
              item={item}
              itemName={s.place?.name || item}
              onCatch={() => completeCatch(s.order_index)}
              onCancel={() => completeCatch(s.order_index)}
            />
          </View>
        ) : null}
      </View>
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

        {/* Hunt framing: N places found, N items collected. */}
        <Text style={styles.discoverLine}>
          Hunt complete — {doneCount} place{doneCount === 1 ? "" : "s"} found,{" "}
          {doneCount} item{doneCount === 1 ? "" : "s"} collected.
        </Text>

        {/* Honest, count-led collections line for this Area. */}
        {newSpots > 0 ? (
          <Text style={styles.discoverLine}>
            +{newSpots} new spot{newSpots === 1 ? "" : "s"} discovered in{" "}
            {quest.origin?.label || "this area"}!
          </Text>
        ) : null}

        {renderRecap()}

        {/* SHARED HUNT: surface the leaderboard + a re-invite on completion. The
            hunt_results row was upserted by the completion effect; the buttons
            read/share live. Only on a shared hunt (has hunt_id). */}
        {quest.hunt_id ? (
          <View style={styles.sharedRecapCard}>
            <Text style={styles.sharedRecapTitle}>You vs your friends</Text>
            <TouchableOpacity
              style={styles.button}
              onPress={() => openLeaderboard(quest.hunt_id, "ready")}
            >
              <Text style={styles.buttonText}>🏆 See the leaderboard</Text>
            </TouchableOpacity>
            <Text style={styles.setupLink} onPress={shareHuntInvite}>
              📨 Invite more friends
            </Text>
          </View>
        ) : null}

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
                placeholderTextColor={MUTE}
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

        <TouchableOpacity style={styles.button} onPress={() => startQuest()}>
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

      {/* FULL-SCREEN map: the current target's SEARCH ZONE (a Circle, never a
          pin — the place is "somewhere in here") + the live user dot. NO planned
          route polyline and NO unfound-target pin (either would leak locations).
          We frame ONLY the current zone + user (regionForHunt), never all stops. */}
      <MapView
        style={StyleSheet.absoluteFill}
        // Expo Go: default provider (Apple Maps), no custom style — keeps the
        // working test flow intact. Built app: Google provider + stylized map.
        provider={isExpoGo ? undefined : PROVIDER_GOOGLE}
        customMapStyle={isExpoGo ? undefined : mapStyle}
        initialRegion={regionForHunt(currentTarget, coords)}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {/* SEARCH ZONE: a ~200m circle around the current target. The user knows
            the place is in here but must hunt — no exact pin is drawn for it. */}
        {currentTarget?.place ? (
          <Circle
            center={{ latitude: currentTarget.place.lat, longitude: currentTarget.place.lng }}
            radius={SEARCH_ZONE_RADIUS_M}
            strokeColor={band?.color || ACCENT}
            strokeWidth={3}
            fillColor="rgba(31,111,178,0.14)"
          />
        ) : null}
        {/* WALKED breadcrumb: where you've ACTUALLY been. Kept (it reveals only
            your own trail, not the targets). */}
        {routePath.length >= 2 ? (
          <Polyline
            coordinates={routePath.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))}
            strokeColor="rgba(63,174,78,0.75)"
            strokeWidth={7}
          />
        ) : null}
        {/* FOUND targets get a pin (revealed already — safe to show). Unfound
            targets are NEVER pinned, so the hunt stays a hunt. */}
        {quest.stops
          .filter((s) => progress[s.order_index]?.found)
          .map((s) => {
            const isSelected = selectedStop === s.order_index;
            return (
              <Marker
                key={`${s.order_index}-d-${isSelected ? "s" : "n"}`}
                coordinate={{ latitude: s.place.lat, longitude: s.place.lng }}
                title={s.place.name}
                anchor={{ x: 0.5, y: 0.5 }}
                onPress={() => selectStop(s.order_index)}
              >
                <MapPin orderIndex={s.order_index} completed selected={isSelected} />
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
        <TouchableOpacity style={styles.railBtn} onPress={openSetup} activeOpacity={0.8}>
          <Text style={styles.railIcon}>📍</Text>
          <Text style={styles.railLabel}>Setup</Text>
        </TouchableOpacity>
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

      {/* Top-center: compact progress chip ("2/3 found" or "Hunt complete!"). */}
      <View style={styles.hudProgress} pointerEvents="box-none">
        <View style={[styles.progressChip, allDone && styles.progressChipDone]}>
          <Text style={styles.progressChipText}>
            {allDone ? "🎉 Hunt complete!" : `${doneCount}/${quest.stops.length} found`}
          </Text>
        </View>
      </View>

      {/* ===== HUNT HUD: the clue card + warmer/colder meter. Shown while the
              hunt is live (a current target exists) and no reveal/completion is
              up. Pinned near the bottom above the FABs; pointerEvents box-none so
              map drags between elements still pan. ===== */}
      {currentTarget && !allDone && findReveal == null && !recapOpen ? (
        <View style={styles.huntHud} pointerEvents="box-none">
          {/* Warmer/colder meter — reflects live GPS distance, pulsing. Stays
              pinned at the bottom so the map + meter remain the focus; the clue
              moved out to the left side-panel below. */}
          <Animated.View
            style={[
              styles.warmthMeter,
              { borderColor: band?.color || ACCENT },
              {
                transform: [
                  {
                    scale: warmthAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, band?.id === "hot" ? 1.06 : band?.id === "warm" ? 1.04 : 1.02],
                    }),
                  },
                ],
                opacity: warmthAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }),
              },
            ]}
          >
            <Text style={[styles.warmthLabel, { color: band?.color || ACCENT }]}>
              {coords ? band?.label : "📡 Finding your location…"}
            </Text>
            <Text style={styles.warmthHint}>
              {coords ? band?.hint : "Make sure location is on to play the hunt."}
            </Text>
          </Animated.View>
        </View>
      ) : null}

      {/* ===== CLUE SIDE-PANEL: the riddle, docked to the LEFT edge and
              collapsible via a handle/tab so it never covers the whole map. When
              collapsed only the slim tab shows (📜 + clue number); tapping it
              expands the card. box-none lets the map pan around it. Same render
              guard as the warmth meter so they appear/disappear together. ===== */}
      {currentTarget && !allDone && findReveal == null && !recapOpen ? (
        <View style={styles.cluePanelWrap} pointerEvents="box-none">
          {cluePanelOpen ? (
            <View style={styles.cluePanel}>
              <ScrollView
                style={styles.cluePanelScroll}
                contentContainerStyle={styles.cluePanelScrollContent}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.clueKicker}>
                  CLUE {doneCount + 1} OF {quest.stops.length}
                </Text>
                <Text style={styles.clueText}>
                  {currentTarget.clue ||
                    "Somewhere in this circle hides your next discovery. Explore to find it!"}
                </Text>
                {hintShown && (currentTarget.hint || currentTarget.description) ? (
                  <Text style={styles.clueHint}>💡 {currentTarget.hint || currentTarget.description}</Text>
                ) : null}
                <View style={styles.clueActions}>
                  {!hintShown ? (
                    <Text style={styles.hintBtn} onPress={() => setHintShown(true)}>
                      🔍 Hint
                    </Text>
                  ) : (
                    <Text style={styles.hintBtnUsed}>💡 Hint shown</Text>
                  )}
                  <Text style={styles.foundItBtn} onPress={() => findStop(currentTarget.order_index, false)}>
                    I found it! →
                  </Text>
                </View>
                {/* No-trap fallback: a manual "reveal anyway" surfaces after a
                    while, or immediately once the hint is shown. Reveals + counts
                    as found so GPS/accessibility issues never trap the user. */}
                {escapeArmed || hintShown ? (
                  <Text style={styles.escapeLink} onPress={() => findStop(currentTarget.order_index, true)}>
                    Can't find it? Reveal this place →
                  </Text>
                ) : null}
              </ScrollView>
              {/* Collapse handle on the panel's right edge — tucks it away. */}
              <TouchableOpacity
                style={styles.clueHandle}
                onPress={() => setCluePanelOpen(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.clueHandleIcon}>‹</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Collapsed: only a slim tab against the left edge. Tap to expand.
            <TouchableOpacity
              style={styles.clueTab}
              onPress={() => setCluePanelOpen(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.clueTabIcon}>📜</Text>
              <Text style={styles.clueTabNum}>{doneCount + 1}/{quest.stops.length}</Text>
              <Text style={styles.clueTabChevron}>›</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      {/* Bottom-left: profile/score button — chunky, shows lifetime points,
          opens the Profile/Scorecard. */}
      <PressBounce style={styles.scoreFab} onPress={openScorecard}>
        <Text style={styles.scoreFabPts}>{profilePoints}</Text>
        <Text style={styles.scoreFabLabel}>pts</Text>
      </PressBounce>

      {/* Bottom-right: the prominent PRIMARY action. "Recap" once complete
          (re-opens the completion overlay), otherwise "New Quest". */}
      {allDone ? (
        <PressBounce
          style={[styles.primaryFab, styles.primaryFabRecap]}
          onPress={() => {
            setSelectedStop(null);
            setRecapOpen(true);
          }}
        >
          <Text style={styles.primaryFabIcon}>🎉</Text>
          <Text style={styles.primaryFabText}>Recap</Text>
        </PressBounce>
      ) : (
        <PressBounce style={styles.primaryFab} onPress={() => startQuest()}>
          <Text style={styles.primaryFabIcon}>＋</Text>
          <Text style={styles.primaryFabText}>New Quest</Text>
        </PressBounce>
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

      {/* ===== FIND REVEAL overlay (full-screen). The animated "You found it!"
              moment: place name + lore revealed, the virtual item flying into the
              collection. Shown until "Next clue" / "Finish the hunt". Sits ABOVE
              the clue HUD; the completion auto-present waits for this to clear. ===== */}
      {revealStop ? (
        <View style={StyleSheet.absoluteFill}>{renderFindReveal(revealStop)}</View>
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

// --- Palette (CARTOON GAME style) -------------------------------------------
// One source of truth for the app chrome. Punched-up, candy-bright but cohesive:
// a saturated game blue primary, vivid grass green, a sunny amber reward pop,
// and two playful secondary pops (coral + grape) for sticker accents. Crisp
// white cards on a soft sky background, a genuinely dark INK for sunlight
// legibility, and a dark ink-blue OUTLINE for the bold cartoon strokes.
//
// The legacy names are kept (CREAM/INK/ACCENT/GREEN/AMBER…) and simply
// re-pointed so every existing StyleSheet reference flips at once:
//   CREAM  -> soft sky background
//   INK    -> bold cool-dark text (kept very dark = sunlight legibility anchor)
//   ACCENT -> saturated game blue (chrome / CTAs)
//   GREEN  -> candy grass green
//   AMBER  -> sunny gold reward pop (balanced: white reads on it on chrome,
//             INK reads on it on the big CTAs)
const CREAM = "#E4F2FF"; // soft sky background (brighter, cooler-candy)
const CARD = "#FFFFFF"; // crisp white cards
const INK = "#0E2236"; // bold cool-dark text (deep navy — legibility anchor)
const ACCENT = "#1773D6"; // saturated game blue (chrome/CTAs)
const ACCENT_LIGHT = "#3F9BFF"; // brighter sky-blue (lines, lighter chrome)
const GREEN = "#27C04A"; // candy grass green (punchier)
const AMBER = "#FFB300"; // sunny gold reward / points / active-CTA pop
const CORAL = "#FF5B6E"; // playful secondary pop (badges / alerts / accents)
const GRAPE = "#7A5CFF"; // second playful pop (purple accent)
const OUTLINE = "#0E2236"; // bold cartoon-outline stroke (dark ink-blue)
const BORDER = "#CFE2F0"; // light card/list separator (hairlines, dividers)
const TINT = "#D6EAFF"; // selected-segment cool tint
const SCRIM = "rgba(14,34,54,0.58)"; // navy scrim over the map for pop-out cards
const NAVY = "#0C1B2C"; // dark recap-card background (cool, share artifact)
const MUTE = "#6E869B"; // muted placeholder / chevron text

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: CREAM, alignItems: "center", justifyContent: "center", padding: 28 },
  scroll: { flex: 1, backgroundColor: CREAM },
  scrollContent: { padding: 20, paddingTop: 64 },
  welcomeContent: { padding: 24, paddingTop: 88, alignItems: "center" },

  // --- Quest REVEAL card (freshly generated quest as a collectible) -----------
  revealScreen: { flex: 1, backgroundColor: ACCENT, alignItems: "center", justifyContent: "center", padding: 26 },
  revealCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: CARD,
    borderRadius: 36,
    paddingHorizontal: 26,
    paddingTop: 32,
    paddingBottom: 28,
    alignItems: "center",
    borderWidth: 5,
    borderColor: OUTLINE,
    shadowColor: OUTLINE,
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 18,
  },
  revealKicker: { fontSize: 14, fontWeight: "900", color: GREEN, letterSpacing: 2.5, textTransform: "uppercase" },
  revealTheme: { fontSize: 32, fontWeight: "900", color: INK, letterSpacing: -0.6, textAlign: "center", marginTop: 12, lineHeight: 37 },
  revealArea: { fontSize: 16, fontWeight: "900", color: ACCENT, marginTop: 10 },
  revealStatsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 22, marginBottom: 4 },
  revealStat: { alignItems: "center", paddingHorizontal: 22 },
  revealStatNum: { fontSize: 32, fontWeight: "900", color: INK },
  revealStatLabel: { fontSize: 13, fontWeight: "800", color: MUTE, marginTop: 2 },
  revealStatDivider: { width: 2, height: 44, backgroundColor: BORDER, borderRadius: 1 },
  revealBeginBtn: {
    backgroundColor: AMBER,
    borderRadius: 30,
    paddingVertical: 17,
    paddingHorizontal: 64,
    marginTop: 26,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: OUTLINE,
    shadowColor: OUTLINE,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  revealBeginText: { color: INK, fontSize: 21, fontWeight: "900", letterSpacing: 0.3 },
  revealHint: { fontSize: 13, fontWeight: "800", color: MUTE, marginTop: 14 },

  // Welcome teaser + resume
  teaserCard: { backgroundColor: "#fff", borderRadius: 24, padding: 20, marginTop: 28, width: "100%", borderWidth: 3, borderColor: OUTLINE, shadowColor: OUTLINE, shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  teaserKicker: { fontSize: 12, fontWeight: "900", color: ACCENT, letterSpacing: 1.5, textTransform: "uppercase" },
  teaserPlace: { fontSize: 23, fontWeight: "900", color: INK, marginTop: 6, letterSpacing: -0.3 },
  teaserFact: { fontSize: 15, color: INK, opacity: 0.82, marginTop: 8, lineHeight: 22 },
  teaserArea: { fontSize: 13, color: GREEN, fontWeight: "800", marginTop: 10 },
  permNote: { fontSize: 12, color: INK, opacity: 0.55, textAlign: "center", marginTop: 14, lineHeight: 17 },
  // Lifetime score + weekly streak strip on Welcome
  scoreRow: { flexDirection: "row", marginTop: 20, width: "100%", justifyContent: "space-around", backgroundColor: "#fff", borderRadius: 22, paddingVertical: 16, borderWidth: 3, borderColor: OUTLINE, shadowColor: OUTLINE, shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  scoreStat: { alignItems: "center" },
  scoreNum: { fontSize: 24, fontWeight: "900", color: INK },
  scoreLabel: { fontSize: 12, color: INK, opacity: 0.6, marginTop: 2, fontWeight: "700" },
  historyLink: { fontSize: 15, color: ACCENT, fontWeight: "800", marginTop: 16, textDecorationLine: "underline" },
  // Welcome nav row to the game-layer views
  navRow: { flexDirection: "row", marginTop: 24, gap: 14 },
  navLink: { fontSize: 15, color: ACCENT, fontWeight: "800", textDecorationLine: "underline" },

  // Collections screen
  collCard: { backgroundColor: "#fff", borderRadius: 22, marginTop: 14, borderWidth: 3, borderColor: OUTLINE, overflow: "hidden", shadowColor: OUTLINE, shadowOpacity: 0.13, shadowRadius: 9, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  collHeader: { flexDirection: "row", alignItems: "center", padding: 16 },
  collArea: { fontSize: 18, fontWeight: "900", color: INK },
  collCount: { fontSize: 14, color: GREEN, fontWeight: "800", marginTop: 3 },
  collPlace: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 9, borderTopWidth: 1, borderTopColor: BORDER },
  collThumb: { width: 42, height: 42, borderRadius: 12, marginRight: 12 },
  collThumbEmpty: { backgroundColor: CREAM, alignItems: "center", justifyContent: "center" },
  collThumbMark: { color: ACCENT, fontSize: 18, fontWeight: "900" },
  collPlaceName: { flex: 1, fontSize: 15, color: INK, fontWeight: "700" },
  // Chevron used by the Collections accordion header.
  listChevron: { fontSize: 24, color: MUTE, fontWeight: "900", marginLeft: 8 },

  // Places Visited screen (individual check-ins, newest-first)
  visitRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 20, padding: 13, marginTop: 12, borderWidth: 3, borderColor: OUTLINE, shadowColor: OUTLINE, shadowOpacity: 0.1, shadowRadius: 7, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  visitMeta: { flex: 1, marginLeft: 12 },
  visitName: { fontSize: 16, fontWeight: "900", color: INK },
  visitArea: { fontSize: 13, color: GREEN, fontWeight: "800", marginTop: 2 },
  visitDate: { fontSize: 12, color: INK, opacity: 0.55, marginTop: 3, fontWeight: "600" },

  // Scorecard screen
  scoreSectionTitle: { fontSize: 20, fontWeight: "900", color: INK, marginTop: 28, letterSpacing: -0.3 },
  bestCard: { backgroundColor: "#fff", borderRadius: 22, padding: 17, marginTop: 14, borderWidth: 3, borderColor: OUTLINE, shadowColor: OUTLINE, shadowOpacity: 0.12, shadowRadius: 9, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  bestArea: { fontSize: 17, fontWeight: "900", color: INK },
  bestStatsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  bestStat: { alignItems: "center", flex: 1 },
  bestNum: { fontSize: 21, fontWeight: "900", color: ACCENT },
  bestLabel: { fontSize: 12, color: INK, opacity: 0.6, marginTop: 2, fontWeight: "700" },

  // Completion celebration (hand-rolled Animated)
  celebrateWrap: { width: "100%", alignItems: "center", marginBottom: 16, overflow: "hidden" },
  confettiLayer: { position: "absolute", top: 0, left: 0, right: 0, height: 260 },
  celebrateBanner: { width: "100%", backgroundColor: GREEN, borderRadius: 26, paddingVertical: 22, paddingHorizontal: 18, alignItems: "center", borderWidth: 4, borderColor: OUTLINE, shadowColor: OUTLINE, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  celebrateTitle: { color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: 0.2 },
  celebratePoints: { color: "#fff", fontSize: 44, fontWeight: "900", letterSpacing: -1, marginTop: 4 },
  celebrateChips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 12 },
  celebrateChip: { color: GREEN, backgroundColor: "#fff", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 13, fontSize: 13, fontWeight: "900", overflow: "hidden" },
  celebrateBest: { color: "#FFE08A", fontSize: 16, fontWeight: "900", marginTop: 12 },
  discoverLine: { fontSize: 16, color: GREEN, fontWeight: "900", textAlign: "center", marginBottom: 14 },

  // --- Scavenger-hunt HUD (clue card + warmer/colder meter) -------------------
  huntHud: { position: "absolute", left: 14, right: 14, bottom: 96, alignItems: "stretch" },
  warmthMeter: {
    backgroundColor: CARD,
    borderRadius: 24,
    borderWidth: 4,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: "center",
    marginBottom: 10,
    shadowColor: OUTLINE,
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  warmthLabel: { fontSize: 21, fontWeight: "900", letterSpacing: 0.2 },
  warmthHint: { fontSize: 13, fontWeight: "800", color: MUTE, marginTop: 3, textAlign: "center" },
  // --- Clue SIDE-PANEL (left-docked, collapsible) -----------------------------
  // Vertically centered against the left edge; capped height so an expanded hint
  // never runs off-screen (the inner ScrollView takes over). Leaves the right
  // portion of the map clear so the warmer/colder meter + Circle stay the focus.
  cluePanelWrap: {
    position: "absolute",
    left: 0,
    top: SCREEN_H * 0.16,
    maxHeight: SCREEN_H * 0.5,
  },
  cluePanel: {
    flexDirection: "row",
    alignItems: "stretch",
    // Explicit width (not maxWidth): a vertical ScrollView inside a flex row
    // needs a determinate parent width or the text column can collapse/overflow.
    // ~72% leaves the right of the map (and the search Circle) visibly clear.
    width: SCREEN_W * 0.72,
    backgroundColor: CARD,
    borderTopRightRadius: 26,
    borderBottomRightRadius: 26,
    borderWidth: 4,
    borderLeftWidth: 0,
    borderColor: OUTLINE,
    shadowColor: OUTLINE,
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 3, height: 7 },
    elevation: 8,
  },
  cluePanelScroll: { flex: 1 },
  cluePanelScrollContent: { padding: 16, paddingRight: 4 },
  // The collapse handle — a slim grabber on the panel's right edge.
  clueHandle: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TINT,
    borderTopRightRadius: 22,
    borderBottomRightRadius: 22,
  },
  clueHandleIcon: { fontSize: 22, fontWeight: "900", color: ACCENT },
  // Collapsed tab — only this shows when the panel is tucked away.
  clueTab: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 15,
    paddingHorizontal: 12,
    backgroundColor: CARD,
    borderTopRightRadius: 22,
    borderBottomRightRadius: 22,
    borderWidth: 4,
    borderLeftWidth: 0,
    borderColor: OUTLINE,
    shadowColor: OUTLINE,
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 3, height: 5 },
    elevation: 6,
  },
  clueTabIcon: { fontSize: 22 },
  clueTabNum: { fontSize: 12, fontWeight: "900", color: ACCENT, marginTop: 4, letterSpacing: 0.5 },
  clueTabChevron: { fontSize: 18, fontWeight: "900", color: MUTE, marginTop: 2 },
  clueKicker: { fontSize: 12, fontWeight: "900", color: ACCENT, letterSpacing: 1.5, textTransform: "uppercase" },
  clueText: { fontSize: 19, fontWeight: "900", color: INK, marginTop: 8, lineHeight: 26 },
  clueHint: { fontSize: 15, fontWeight: "800", color: GREEN, marginTop: 10, lineHeight: 21 },
  clueActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 },
  hintBtn: { fontSize: 16, fontWeight: "900", color: ACCENT, paddingVertical: 6, paddingHorizontal: 4 },
  hintBtnUsed: { fontSize: 15, fontWeight: "800", color: MUTE, paddingVertical: 6 },
  foundItBtn: {
    fontSize: 16,
    fontWeight: "900",
    color: INK,
    backgroundColor: AMBER,
    borderRadius: 22,
    overflow: "hidden",
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderWidth: 3,
    borderColor: OUTLINE,
  },
  escapeLink: { fontSize: 13, fontWeight: "800", color: MUTE, marginTop: 12, textAlign: "center", textDecorationLine: "underline" },

  // --- Find REVEAL overlay (you found it! + collect) --------------------------
  revealOverlay: { flex: 1, backgroundColor: SCRIM, alignItems: "center", justifyContent: "center", padding: 24 },
  findCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: CARD,
    borderRadius: 34,
    padding: 28,
    alignItems: "center",
    borderWidth: 5,
    borderColor: OUTLINE,
    shadowColor: OUTLINE,
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 18,
  },
  findKicker: { fontSize: 14, fontWeight: "900", color: GREEN, letterSpacing: 2.5, textTransform: "uppercase" },
  findName: { fontSize: 28, fontWeight: "900", color: INK, textAlign: "center", marginTop: 10, lineHeight: 33, letterSpacing: -0.4 },
  findLore: { fontSize: 15, color: INK, opacity: 0.82, textAlign: "center", marginTop: 12, lineHeight: 22 },
  collectWrap: { alignItems: "center", marginTop: 18, height: 64, justifyContent: "center" },
  collectItem: { fontSize: 48 },
  collectCaption: { fontSize: 13, fontWeight: "900", color: GREEN, marginTop: 4 },
  findActions: { flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 22 },
  findPhotoLink: { fontSize: 15, fontWeight: "800", color: ACCENT, textDecorationLine: "underline" },
  findNextBtn: { backgroundColor: AMBER, borderRadius: 28, paddingVertical: 15, paddingHorizontal: 30, minHeight: 52, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: OUTLINE, shadowColor: OUTLINE, shadowOpacity: 0.28, shadowRadius: 9, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
  findNextText: { fontSize: 18, fontWeight: "900", color: INK, letterSpacing: 0.2 },
  // Prominent primary CTA for the camera-catch (the COLLECT step).
  findCatchBtn: { backgroundColor: AMBER, borderRadius: 28, paddingVertical: 16, paddingHorizontal: 32, minHeight: 52, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: OUTLINE, shadowColor: OUTLINE, shadowOpacity: 0.28, shadowRadius: 9, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
  findCatchText: { fontSize: 19, fontWeight: "900", color: INK, letterSpacing: 0.2 },

  // Energetic check-in / found states
  actionBtnGo: { backgroundColor: AMBER },
  foundBanner: { backgroundColor: GREEN, borderRadius: 18, paddingVertical: 11, alignItems: "center", marginTop: 12, borderWidth: 3, borderColor: OUTLINE },
  foundBannerText: { color: "#fff", fontSize: 16, fontWeight: "900" },

  // Optional sign-in / profile entry on Welcome
  profileLink: { fontSize: 15, color: ACCENT, fontWeight: "700", marginTop: 16, textDecorationLine: "underline" },
  profileLinkDisabled: { fontSize: 13, color: INK, opacity: 0.4, marginTop: 16 },

  // Profile screen
  profileCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 22, padding: 17, marginTop: 16, borderWidth: 3, borderColor: OUTLINE, shadowColor: OUTLINE, shadowOpacity: 0.12, shadowRadius: 9, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  profileAvatar: { width: 58, height: 58, borderRadius: 29, marginRight: 14, borderWidth: 3, borderColor: OUTLINE },
  profileAvatarEmpty: { backgroundColor: ACCENT, alignItems: "center", justifyContent: "center" },
  profileAvatarInitial: { color: "#fff", fontSize: 24, fontWeight: "900" },
  profileName: { fontSize: 19, fontWeight: "900", color: INK },
  profileEmail: { fontSize: 14, color: INK, opacity: 0.6, marginTop: 2, fontWeight: "600" },
  oauthBtn: { backgroundColor: "#fff", borderRadius: 16, paddingVertical: 16, alignItems: "center", marginTop: 14, borderWidth: 3, borderColor: OUTLINE },
  oauthBtnText: { color: INK, fontSize: 16, fontWeight: "800" },
  // Apple's native button needs an explicit width+height or it renders blank.
  // Full-width + 50pt matches the adjacent Google button's footprint at both sites.
  appleBtn: { width: "100%", height: 50, marginTop: 14 },

  // Points-earned badge on the completion recap
  pointsBadge: { backgroundColor: GREEN, borderRadius: 20, paddingVertical: 11, paddingHorizontal: 22, marginBottom: 14, borderWidth: 3, borderColor: OUTLINE },
  pointsBadgeText: { color: "#fff", fontSize: 17, fontWeight: "900" },

  // My Quests history screen
  backLink: { fontSize: 15, color: ACCENT, fontWeight: "800", marginBottom: 10 },
  histRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 20, padding: 13, marginTop: 12, borderWidth: 3, borderColor: OUTLINE, shadowColor: OUTLINE, shadowOpacity: 0.1, shadowRadius: 7, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  histThumb: { width: 58, height: 58, borderRadius: 14, marginRight: 14 },
  histThumbEmpty: { backgroundColor: BORDER },
  histRowText: { flex: 1 },
  histTheme: { fontSize: 16, fontWeight: "900", color: INK },
  histMeta: { fontSize: 13, color: INK, opacity: 0.6, marginTop: 4, fontWeight: "600" },

  // My Quests as a CARD GALLERY (each completed quest = a collectible card).
  questCard: {
    backgroundColor: CARD,
    borderRadius: 24,
    marginTop: 16,
    borderWidth: 4,
    borderColor: OUTLINE,
    overflow: "hidden",
    shadowColor: OUTLINE,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },
  questCardHero: { width: "100%", height: 150, backgroundColor: TINT },
  questCardHeroEmpty: { alignItems: "center", justifyContent: "center" },
  questCardHeroMark: { fontSize: 36, color: ACCENT_LIGHT, fontWeight: "900" },
  questCardBody: { padding: 16 },
  questCardTheme: { fontSize: 19, fontWeight: "900", color: INK, letterSpacing: -0.3, lineHeight: 24 },
  questCardArea: { fontSize: 14, fontWeight: "900", color: ACCENT, marginTop: 6 },
  questCardMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 8, flexWrap: "wrap" },
  questCardMeta: { fontSize: 13, color: INK, opacity: 0.6, fontWeight: "700" },
  questCardDot: { fontSize: 13, color: INK, opacity: 0.4, marginHorizontal: 6 },
  questCardPts: { fontSize: 13, color: GREEN, fontWeight: "900" },
  questCardStops: { fontSize: 13, color: INK, opacity: 0.7, marginTop: 8, lineHeight: 19 },

  resumeBox: { backgroundColor: "#fff", borderRadius: 24, padding: 19, marginTop: 24, width: "100%", borderWidth: 4, borderColor: GREEN, alignItems: "center", shadowColor: OUTLINE, shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  resumeLabel: { fontSize: 13, fontWeight: "900", color: GREEN, letterSpacing: 0.5, textTransform: "uppercase" },
  resumeTheme: { fontSize: 19, fontWeight: "900", color: INK, marginTop: 5, textAlign: "center" },
  abandonLink: { fontSize: 13, color: ACCENT, textDecorationLine: "underline", marginTop: 12, fontWeight: "700" },

  // Feedback card
  feedbackCard: { backgroundColor: "#fff", borderRadius: 22, padding: 19, marginBottom: 16, borderWidth: 3, borderColor: OUTLINE, shadowColor: OUTLINE, shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  feedbackQ: { fontSize: 17, fontWeight: "800", color: INK },
  feedbackThumbs: { flexDirection: "row", marginTop: 10, marginBottom: 4 },
  thumb: { fontSize: 32, marginRight: 18, opacity: 0.4 },
  thumbActive: { opacity: 1 },
  feedbackInput: { borderWidth: 2, borderColor: BORDER, borderRadius: 14, padding: 13, fontSize: 15, color: INK, marginTop: 10, backgroundColor: CREAM },
  feedbackThanks: { fontSize: 15, color: GREEN, fontWeight: "800" },

  // Per-stop flag
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  flagLink: { fontSize: 12, color: INK, opacity: 0.5, textDecorationLine: "underline" },
  // Sign-in entry (soft gate)
  signinScreen: { flex: 1, backgroundColor: CREAM, paddingHorizontal: 28, paddingTop: 120, paddingBottom: 48, justifyContent: "space-between" },
  signinHero: { alignItems: "center" },
  signinLogo: { fontSize: 60, fontWeight: "900", color: INK, letterSpacing: -1.6 },
  signinValueProp: { fontSize: 18, color: INK, opacity: 0.72, marginTop: 12, textAlign: "center", lineHeight: 25, fontWeight: "600" },
  signinActions: { width: "100%" },
  signinBtn: { paddingVertical: 18, borderRadius: 28, borderWidth: 3, borderColor: OUTLINE },
  signinUnavailable: { fontSize: 15, color: INK, opacity: 0.7, textAlign: "center", lineHeight: 22, marginBottom: 4 },
  guestBtn: { marginTop: 22, paddingVertical: 14, alignItems: "center" },
  guestBtnText: { fontSize: 17, color: ACCENT, fontWeight: "900", textDecorationLine: "underline" },
  signinFootnote: { fontSize: 13, color: INK, opacity: 0.5, textAlign: "center", marginTop: 8, lineHeight: 18 },

  logo: { fontSize: 52, fontWeight: "900", color: INK, letterSpacing: -1.4 },
  tagline: { fontSize: 17, color: INK, opacity: 0.7, marginTop: 8, textAlign: "center", fontWeight: "600" },
  error: { color: CORAL, marginTop: 20, textAlign: "center", lineHeight: 20, fontWeight: "700" },
  button: { backgroundColor: ACCENT, paddingVertical: 17, paddingHorizontal: 38, borderRadius: 30, marginTop: 28, alignSelf: "center", minHeight: 52, justifyContent: "center", borderWidth: 4, borderColor: OUTLINE, shadowColor: OUTLINE, shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 7 },
  buttonText: { color: "#fff", fontSize: 19, fontWeight: "900", letterSpacing: 0.3 },
  buttonDisabled: { opacity: 0.4 },

  // --- Multiplayer (friends + shared hunts + leaderboard) ---------------------
  secondaryBtn: { backgroundColor: "#fff", borderWidth: 4, borderColor: ACCENT, paddingVertical: 15, paddingHorizontal: 30, borderRadius: 30, marginTop: 14, alignSelf: "center", minHeight: 52, justifyContent: "center" },
  secondaryBtnText: { color: ACCENT, fontSize: 16, fontWeight: "900" },
  joinBanner: { fontSize: 13, color: INK, opacity: 0.85, textAlign: "center", marginTop: 14, marginBottom: 2, lineHeight: 18, backgroundColor: TINT, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 16, fontWeight: "600", borderWidth: 2, borderColor: BORDER },
  friendsNote: { fontSize: 14, color: GREEN, fontWeight: "800", textAlign: "center", marginTop: 14 },
  friendRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: CARD, borderWidth: 3, borderColor: OUTLINE, borderRadius: 20, paddingVertical: 13, paddingHorizontal: 15, marginTop: 10, shadowColor: OUTLINE, shadowOpacity: 0.1, shadowRadius: 7, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  friendName: { flex: 1, fontSize: 16, fontWeight: "800", color: INK, marginRight: 10 },
  friendActions: { flexDirection: "row", gap: 8 },
  friendAccept: { backgroundColor: ACCENT, paddingVertical: 9, paddingHorizontal: 15, borderRadius: 20, borderWidth: 2.5, borderColor: OUTLINE },
  friendAcceptText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  friendDecline: { backgroundColor: "#fff", borderWidth: 2.5, borderColor: BORDER, paddingVertical: 9, paddingHorizontal: 15, borderRadius: 20 },
  friendDeclineText: { color: MUTE, fontWeight: "900", fontSize: 14 },
  friendPending: { fontSize: 13, color: MUTE, fontWeight: "800" },
  sharedRecapCard: { backgroundColor: CARD, borderWidth: 3, borderColor: OUTLINE, borderRadius: 22, padding: 17, marginTop: 18, alignItems: "center", shadowColor: OUTLINE, shadowOpacity: 0.12, shadowRadius: 9, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  sharedRecapTitle: { fontSize: 17, fontWeight: "900", color: INK },
  leaderRow: { flexDirection: "row", alignItems: "center", backgroundColor: CARD, borderWidth: 3, borderColor: OUTLINE, borderRadius: 20, paddingVertical: 13, paddingHorizontal: 15, marginTop: 10, shadowColor: OUTLINE, shadowOpacity: 0.1, shadowRadius: 7, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  leaderRowMe: { borderColor: AMBER, borderWidth: 4, backgroundColor: "#FFF7E0" },
  leaderRank: { fontSize: 19, fontWeight: "900", color: ACCENT, width: 30 },
  leaderName: { flex: 1, fontSize: 16, fontWeight: "800", color: INK, marginRight: 8 },
  leaderStats: { alignItems: "flex-end" },
  leaderTime: { fontSize: 16, fontWeight: "900", color: INK },
  leaderMeta: { fontSize: 12, color: MUTE, fontWeight: "700", marginTop: 2 },

  // --- Quest Setup sheet ------------------------------------------------------
  setupLink: { fontSize: 14, color: ACCENT, fontWeight: "800", textAlign: "center", marginTop: 16 },
  setupIntro: { fontSize: 15, color: INK, opacity: 0.7, marginTop: 6, lineHeight: 21, fontWeight: "600" },
  setupSectionLabel: { fontSize: 13, fontWeight: "900", color: INK, opacity: 0.6, letterSpacing: 1, textTransform: "uppercase", marginTop: 26, marginBottom: 10 },
  segmentRow: { flexDirection: "row", gap: 10 },
  segment: { flex: 1, paddingVertical: 15, borderRadius: 18, borderWidth: 3, borderColor: BORDER, backgroundColor: "#fff", alignItems: "center", minHeight: 52, justifyContent: "center" },
  segmentActive: { borderColor: ACCENT, backgroundColor: TINT },
  segmentText: { fontSize: 15, fontWeight: "800", color: INK, opacity: 0.7 },
  segmentTextActive: { color: ACCENT, opacity: 1 },
  placeBlock: { marginTop: 14 },
  placeInputRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  placeInput: { flex: 1, backgroundColor: "#fff", borderWidth: 3, borderColor: BORDER, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, fontSize: 16, color: INK },
  placeFindBtn: { backgroundColor: ACCENT, borderRadius: 16, paddingHorizontal: 20, paddingVertical: 13, minWidth: 64, minHeight: 48, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: OUTLINE },
  placeFindText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  placeResolved: { fontSize: 15, color: GREEN, fontWeight: "800", marginTop: 12 },
  setupErr: { fontSize: 14, color: CORAL, marginTop: 12, lineHeight: 20, fontWeight: "700" },
  sizeRow: { flexDirection: "row", gap: 12 },
  sizeCard: { flex: 1, padding: 16, borderRadius: 20, borderWidth: 3, borderColor: BORDER, backgroundColor: "#fff" },
  sizeCardWide: { padding: 16, borderRadius: 20, borderWidth: 3, borderColor: BORDER, backgroundColor: "#fff", marginTop: 12 },
  sizeCardActive: { borderColor: ACCENT, backgroundColor: TINT },
  sizeName: { fontSize: 18, fontWeight: "900", color: INK },
  sizeDetail: { fontSize: 13, color: INK, opacity: 0.65, marginTop: 4, fontWeight: "600" },
  theme: { fontSize: 32, fontWeight: "900", color: INK, letterSpacing: -0.5 },
  intro: { fontSize: 16, color: INK, opacity: 0.75, marginTop: 6, lineHeight: 22, fontWeight: "600" },
  progress: { fontSize: 15, color: ACCENT, fontWeight: "800", marginTop: 12, marginBottom: 16 },
  card: { backgroundColor: "#fff", borderRadius: 22, padding: 19, marginBottom: 16, borderWidth: 3, borderColor: OUTLINE, shadowColor: OUTLINE, shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  cardDone: { opacity: 0.7, borderWidth: 3, borderColor: GREEN },
  stopTitle: { fontSize: 21, fontWeight: "900", color: INK, paddingRight: 36 },
  distance: { fontSize: 13, color: ACCENT, fontWeight: "800", marginTop: 2, marginBottom: 8 },
  body: { fontSize: 15, color: INK, lineHeight: 21 },
  why: { fontSize: 14, color: INK, opacity: 0.7, marginTop: 6, fontStyle: "italic" },
  lore: { fontSize: 14, color: INK, opacity: 0.8, marginTop: 8, lineHeight: 20 },
  questBox: { backgroundColor: CREAM, borderRadius: 16, padding: 13, marginTop: 12, borderWidth: 2, borderColor: BORDER },
  questText: { fontSize: 15, color: INK, fontWeight: "700" },
  actionBtn: { backgroundColor: ACCENT, borderRadius: 16, paddingVertical: 14, alignItems: "center", marginTop: 12, minHeight: 48, justifyContent: "center", borderWidth: 3, borderColor: OUTLINE },
  actionBtnDisabled: { backgroundColor: "#A9C3D6", borderColor: "#7E97AA" },
  actionText: { color: "#fff", fontSize: 16, fontWeight: "900" },
  override: { fontSize: 13, color: ACCENT, textAlign: "center", marginTop: 10, textDecorationLine: "underline", fontWeight: "700" },
  photo: { width: "100%", height: 180, borderRadius: 16, marginTop: 12, borderWidth: 3, borderColor: OUTLINE },
  source: { fontSize: 12, color: ACCENT, fontWeight: "600" },

  // --- Map-first active screen --------------------------------------------------
  mapScreen: { flex: 1, backgroundColor: CREAM },

  // Numbered stop dots, with completed/selected variants. Bold cartoon outline.
  pin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: ACCENT,
    borderWidth: 3,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: OUTLINE,
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  pinDone: { backgroundColor: GREEN },
  pinSelected: {
    backgroundColor: AMBER, // brighter gold for the active stop
    borderColor: "#fff",
    borderWidth: 3.5,
    shadowOpacity: 0.45,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
  },
  pinText: { color: "#fff", fontSize: 15, fontWeight: "900" },

  // --- Floating HUD (Pokémon-GO style) ----------------------------------------
  // Top-left identity chip (theme + area).
  hudTopLeft: { position: "absolute", top: 56, left: 16, right: 96 },
  identityChip: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    backgroundColor: "rgba(255,255,255,0.97)",
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 3,
    borderColor: OUTLINE,
    shadowColor: OUTLINE,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  identityTheme: { fontSize: 15, fontWeight: "900", color: INK, letterSpacing: -0.2 },
  identityArea: { fontSize: 12, color: GREEN, fontWeight: "800", marginTop: 2 },

  // Top-right stacked side rail of round buttons.
  hudSideRail: { position: "absolute", top: 54, right: 14, alignItems: "center", gap: 12 },
  railBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "rgba(255,255,255,0.97)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: OUTLINE,
    shadowColor: OUTLINE,
    shadowOpacity: 0.26,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  railBtnAbandon: { backgroundColor: "rgba(255,235,236,0.98)", borderColor: CORAL },
  railIcon: { fontSize: 22 },
  railLabel: { fontSize: 9, fontWeight: "900", color: INK, marginTop: 1, letterSpacing: 0.2 },
  railLabelAbandon: { fontSize: 9, fontWeight: "900", color: CORAL, marginTop: 1 },

  // Top-center progress chip.
  hudProgress: { position: "absolute", top: 60, left: 0, right: 0, alignItems: "center" },
  progressChip: {
    backgroundColor: ACCENT,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 17,
    borderWidth: 3,
    borderColor: OUTLINE,
    shadowColor: OUTLINE,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  progressChipDone: { backgroundColor: GREEN },
  progressChipText: { color: "#fff", fontSize: 14, fontWeight: "900", letterSpacing: 0.3 },

  // Bottom-left score/profile FAB.
  scoreFab: {
    position: "absolute",
    bottom: 38,
    left: 22,
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: AMBER,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: OUTLINE,
    shadowColor: OUTLINE,
    shadowOpacity: 0.34,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  // INK (not white) on AMBER keeps the points reading high-contrast as AMBER brightens.
  scoreFabPts: { color: INK, fontSize: 23, fontWeight: "900", letterSpacing: -0.5 },
  scoreFabLabel: { color: INK, fontSize: 11, fontWeight: "900", marginTop: -2, opacity: 0.8 },

  // Bottom-right primary action FAB (New Quest / Recap).
  primaryFab: {
    position: "absolute",
    bottom: 38,
    right: 22,
    minWidth: 92,
    height: 76,
    borderRadius: 38,
    paddingHorizontal: 18,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: OUTLINE,
    shadowColor: OUTLINE,
    shadowOpacity: 0.34,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  primaryFabRecap: { backgroundColor: GREEN },
  primaryFabIcon: { color: "#fff", fontSize: 23, fontWeight: "900", marginBottom: -1 },
  primaryFabText: { color: "#fff", fontSize: 13, fontWeight: "900", letterSpacing: 0.2 },

  // --- Pop-out stop card -------------------------------------------------------
  cardScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: SCRIM },
  cardCenter: { flex: 1, alignItems: "center", justifyContent: "center", padding: 18 },
  popCard: {
    width: "100%",
    maxWidth: 460,
    maxHeight: SCREEN_H * 0.78,
    backgroundColor: CREAM,
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
    borderWidth: 5,
    borderColor: OUTLINE,
    shadowColor: OUTLINE,
    shadowOpacity: 0.4,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  cardClose: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 2,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: OUTLINE,
  },
  cardCloseText: { fontSize: 17, fontWeight: "900", color: INK },
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
    backgroundColor: NAVY,
    borderRadius: 20,
    overflow: "hidden",
  },
  recapHeroWrap: { flex: 3, justifyContent: "flex-end" },
  recapHero: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  recapHeroFallback: { backgroundColor: NAVY },
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
  recapPlace: { color: AMBER, fontSize: 14, fontWeight: "700", marginTop: 3 },
  recapProofRow: { flexDirection: "row", alignItems: "center", marginVertical: 12 },
  recapFilmstrip: { flex: 1, flexDirection: "row", marginLeft: 14, flexWrap: "wrap" },
  recapFilm: { width: 52, height: 52, borderRadius: 8, marginRight: 6, marginBottom: 6 },
  recapFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  recapStat: { color: "#fff", opacity: 0.7, fontSize: 13, fontWeight: "600" },
  recapMark: { fontSize: 15, fontWeight: "800", color: AMBER, letterSpacing: 1 },

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
    backgroundColor: ACCENT_LIGHT,
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
  traceFinishDot: { backgroundColor: AMBER },
  traceDot: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: ACCENT_LIGHT,
    borderWidth: 1.5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  traceDotText: { color: "#fff", fontSize: 10, fontWeight: "800" },
});
