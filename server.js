// DayQuest — quest API server.
//
//   node server.js          (then open http://localhost:8787)
//
// The mobile app calls THIS, not Claude directly — so your API key stays on
// the server and never ships inside the app. One endpoint:
//
//   GET /quest?lat=<lat>&lng=<lng>   ->   the quest JSON
//
// Built on Node's standard library — no web framework dependency.

import { createServer } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { buildQuest, loadEnv } from "./lib/quest.js";
import { resolveArea, resolvePlace } from "./lib/area.js";

loadEnv();
const PORT = process.env.PORT || 8787;
const DATA_DIR = new URL("./data/", import.meta.url);

// --- In-memory quest cache (D-046 precursor) ---------------------------------
// Repeat testers cluster in a few neighbourhoods; a quest build is expensive
// (3 live data sources + up to 2 Claude calls). Cache the finished quest JSON
// keyed by a rounded coord (~110m, 3 decimals — matches sources.js placesCache)
// + normalised size + a coarse day bucket, so a second request for the same
// area/size/day returns instantly with NO data/Claude calls.
//
// NOTE: this cache is purely IN-MEMORY — it resets whenever the Render free
// instance sleeps, redeploys, or restarts. The persistent/shared version
// arrives with the POI DB (D-046). For the tester round this is enough: it
// makes clustered repeat quests instant within a single warm instance.
const QUEST_CACHE = new Map(); // insertion-ordered → FIFO eviction
const QUEST_CACHE_MAX = 500; // bound memory: ~500 quests
const QUEST_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h freshness window

// Mirror presetFor() in lib/quest.js EXACTLY: only "explore" is a distinct
// preset; everything else (incl. missing/garbage) collapses to "quick". This
// keeps the key tight (better hit-rate) while guaranteeing quick≠explore.
function normSize(size) {
  return size === "explore" ? "explore" : "quick";
}

// Coarse day bucket (UTC day index) — pairs with the TTL as a natural reset so
// a neighbourhood's quest refreshes across days even if the instance stays warm.
function dayBucket() {
  return Math.floor(Date.now() / (24 * 60 * 60 * 1000));
}

// Key parts: rounded coord + normalised size + day. label is deliberately NOT
// keyed — resolveArea(lat,lng) is deterministic per rounded coord, so co-located
// callers resolve the same label; an explicit ?label= only affects cosmetic
// origin text and serving the first caller's label is acceptable staleness.
function questCacheKey(lat, lng, size) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}|${normSize(size)}|${dayBucket()}`;
}

function questCacheGet(key) {
  const hit = QUEST_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > QUEST_CACHE_TTL_MS) {
    QUEST_CACHE.delete(key); // lazily drop stale entries
    return null;
  }
  return hit.quest;
}

function questCacheSet(key, quest) {
  // FIFO eviction: drop the oldest inserted entry once at capacity.
  if (QUEST_CACHE.size >= QUEST_CACHE_MAX) {
    QUEST_CACHE.delete(QUEST_CACHE.keys().next().value);
  }
  QUEST_CACHE.set(key, { quest, ts: Date.now() });
}

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*", // allow the app/browser to call during dev
  });
  res.end(JSON.stringify(body, null, 2));
}

// Read a request body, capped, and JSON.parse it. Returns the parsed object,
// or throws so the caller can answer 400. No framework — just collect chunks.
function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let aborted = false;
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        aborted = true;
        reject(new Error("Body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (aborted) return;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

// Append one JSON line to data/<file>, server-stamping a receive time so we
// don't trust client clocks. Creates data/ on first write (it's gitignored).
function appendJsonl(file, obj) {
  mkdirSync(DATA_DIR, { recursive: true });
  const line = JSON.stringify({ ...obj, server_ts: new Date().toISOString() }) + "\n";
  appendFileSync(new URL(file, DATA_DIR), line);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/" || url.pathname === "/health") {
    return send(res, 200, {
      service: "dayquest",
      usage: "GET /quest?lat=40.7308&lng=-73.9973",
      key_configured: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  }

  // Lightweight analytics: append one event line. No PII — just an anonymous
  // install id, an event name, and small numeric/string props.
  if (url.pathname === "/event" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (!body || typeof body.event !== "string" || !body.event) {
        return send(res, 400, { error: "Provide a string `event` field." });
      }
      appendJsonl("events.jsonl", {
        event: body.event,
        install_id: typeof body.install_id === "string" ? body.install_id : null,
        props: body.props && typeof body.props === "object" ? body.props : {},
        client_ts: typeof body.ts === "string" ? body.ts : null,
      });
      return send(res, 200, { ok: true });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  // Tester feedback: a thumbs signal + optional note, OR a per-stop flag.
  if (url.pathname === "/feedback" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (!body || typeof body !== "object") {
        return send(res, 400, { error: "Provide a JSON object." });
      }
      appendJsonl("feedback.jsonl", {
        kind: typeof body.kind === "string" ? body.kind : "quest", // "quest" | "stop_flag"
        install_id: typeof body.install_id === "string" ? body.install_id : null,
        rating: body.rating ?? null, // "up" | "down" | null
        text: typeof body.text === "string" ? body.text.slice(0, 1000) : null,
        stop_name: typeof body.stop_name === "string" ? body.stop_name : null,
        source_url: typeof body.source_url === "string" ? body.source_url : null,
        reason: typeof body.reason === "string" ? body.reason.slice(0, 1000) : null,
        theme: typeof body.theme === "string" ? body.theme : null,
        client_ts: typeof body.ts === "string" ? body.ts : null,
      });
      return send(res, 200, { ok: true });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  // Single-player scorecard sink: capture each completion's score + time so a
  // cross-user all-time board can be aggregated LATER. Append-only; the in-app
  // scorecard reads local data, not this. No PII beyond the anonymous install id.
  if (url.pathname === "/score" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (!body || typeof body !== "object") {
        return send(res, 400, { error: "Provide a JSON object." });
      }
      appendJsonl("scores.jsonl", {
        area: typeof body.area === "string" ? body.area : null,
        theme: typeof body.theme === "string" ? body.theme : null,
        points: Number.isFinite(body.points) ? body.points : null,
        time_s: Number.isFinite(body.time_s) ? body.time_s : null,
        install_id: typeof body.install_id === "string" ? body.install_id : null,
        client_ts: typeof body.ts === "string" ? body.ts : null,
      });
      return send(res, 200, { ok: true });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  // Forward geocoding: turn a typed place name into coordinates so the app's
  // Quest Setup sheet can quest somewhere OTHER than current GPS. Returns the
  // resolved display name + coords, or 404 when nothing matches.
  if (url.pathname === "/resolve-place") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) {
      return send(res, 400, { error: "Provide a non-empty `q` query param." });
    }
    const place = await resolvePlace(q); // never throws; null on no match/failure
    if (!place) {
      return send(res, 404, { error: `No place found for "${q}".` });
    }
    return send(res, 200, { name: place.name, lat: place.lat, lng: place.lng });
  }

  if (url.pathname === "/quest") {
    const latRaw = url.searchParams.get("lat");
    const lngRaw = url.searchParams.get("lng");
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    // Note: Number(null)===0, so check for missing params explicitly.
    if (latRaw === null || lngRaw === null || latRaw === "" || lngRaw === "" ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return send(res, 400, { error: "Provide valid numeric lat (-90..90) and lng (-180..180) query params." });
    }
    try {
      console.log(`  → quest request for ${lat}, ${lng}`);
      // Optional walk-scaled size: "quick" (default) | "explore". Unknown values
      // are ignored downstream (buildQuest falls back to quick).
      const size = url.searchParams.get("size") || undefined;

      // Cache check FIRST — before resolveArea + buildQuest — so a hit skips all
      // data/Claude calls. The body is returned byte-identical (we never tag it),
      // which is what guarantees the "same coord twice → identical" behaviour.
      const cacheKey = questCacheKey(lat, lng, size);
      const cached = questCacheGet(cacheKey);
      if (cached) {
        console.log(`  ← (cache hit) ${cached.stops.length} stops: ${cached.theme}`);
        return send(res, 200, cached);
      }

      // Resolve to an Area: if the caller passed an explicit label, honour it;
      // otherwise reverse-geocode coords into a human neighbourhood/town name so
      // origin.label is a real place (never raw coordinates). resolveArea never
      // throws — worst case it returns a generic "Your Area".
      const labelRaw = url.searchParams.get("label");
      const label = labelRaw && labelRaw.trim()
        ? labelRaw.trim()
        : (await resolveArea(lat, lng)).name;
      const quest = await buildQuest(lat, lng, label, { size });
      // Store ONLY a successfully built quest. TOO_FEW (and any other build
      // error) throws above and lands in catch → it never reaches here, so error
      // responses are never cached.
      questCacheSet(cacheKey, quest);
      console.log(`  ← ${quest.stops.length} stops: ${quest.theme} (area: ${label}, size: ${size || "quick"})`);
      return send(res, 200, quest);
    } catch (err) {
      if (err.code === "NO_KEY") return send(res, 503, { error: "Server has no ANTHROPIC_API_KEY configured." });
      if (err.code === "TOO_FEW") return send(res, 422, { error: err.message });
      console.error("  ! quest error:", err.message);
      return send(res, 500, { error: "Failed to build quest." });
    }
  }

  return send(res, 404, { error: "Not found. Try GET /quest?lat=..&lng=.." });
});

server.listen(PORT, () => {
  console.log(`\n  DayQuest API on http://localhost:${PORT}`);
  console.log(`  Try: http://localhost:${PORT}/quest?lat=40.7308&lng=-73.9973`);
  console.log(`  Key configured: ${Boolean(process.env.ANTHROPIC_API_KEY)}\n`);
});
