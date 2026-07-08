// Pluggable place-data sources for DayQuest.
//
// Each source is an async function: (lat, lng, opts) -> [candidate, ...]
// A "candidate" is the authoritative record we trust for coordinates/name/url.
// The LLM never invents these — it only picks which ones to use, by id.
//
// MVP ships ONE source: Wikipedia GeoSearch (keyless, gives location AND lore).
// Later: addOpenStreetMap (parks/green space), addPlaces (new/quirky spots).

import { poidbConfigured, queryPois } from "./poidb.js";

const WIKI_API = "https://en.wikipedia.org/w/api.php";
// Wikipedia asks for a descriptive User-Agent with contact info.
const USER_AGENT = "DayQuest/0.1 (MVP scavenger-hunt prototype; contact: andrew@firstprinciplefunds.com)";

// ~8s timeout so a slow Wikipedia can't stall gatherCandidates. Applies PER
// call (wikiFetch runs twice: geosearch + extracts); a timeout throws and, via
// Promise.allSettled in gatherCandidates, just drops Wikipedia for this request.
const WIKI_TIMEOUT_MS = 8000;

async function wikiFetch(params) {
  const url = `${WIKI_API}?${new URLSearchParams({ format: "json", ...params })}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(WIKI_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Wikipedia API ${res.status}: ${await res.text()}`);
  return res.json();
}

// Truncate lore so we don't blow up the token budget on long articles.
function clip(text, max = 600) {
  if (!text) return "";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") + "…" : t;
}

/**
 * Wikipedia source: nearby geotagged articles + their intro extracts (the lore).
 * @returns candidates: { source, name, lat, lng, distance_m, lore, source_url }
 */
export async function fromWikipedia(lat, lng, { radius_m = 1500, limit = 40 } = {}) {
  // 1. GeoSearch — real, geotagged places near the origin.
  const geo = await wikiFetch({
    action: "query",
    list: "geosearch",
    gscoord: `${lat}|${lng}`,
    gsradius: String(radius_m), // metres, max 10000
    gslimit: String(limit),
  });
  const hits = geo?.query?.geosearch ?? [];
  if (hits.length === 0) return [];

  // 2. Pull intro extracts for those pages in one batched call (the story).
  const pageids = hits.map((h) => h.pageid).join("|");
  const ex = await wikiFetch({
    action: "query",
    prop: "extracts",
    exintro: "1",
    explaintext: "1",
    pageids,
  });
  const pages = ex?.query?.pages ?? {};

  return hits.map((h) => ({
    source: "wikipedia",
    name: h.title,
    kind: "", // Wikipedia gives prose lore instead of a type tag
    lat: h.lat,
    lng: h.lon,
    distance_m: Math.round(h.dist),
    lore: clip(pages[h.pageid]?.extract),
    source_url: `https://en.wikipedia.org/?curid=${h.pageid}`,
  }));
}

// --- Source 2: OpenStreetMap (parks, gardens, viewpoints, natural oddities) --
// Keyless via the Overpass API. No prose lore — we surface a factual `kind`
// from the OSM tags so the guide can pick for variety without inventing facts.

const OVERPASS_API = "https://overpass-api.de/api/interpreter";
// ~6s ceiling: Overpass is frequently overloaded and is the slowest source. On
// timeout the fetch throws and Promise.allSettled drops OSM for this request —
// Wikipedia + Places still return — so a stalled Overpass can't drag the build.
const OVERPASS_TIMEOUT_MS = 6000;

export function haversine_m(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Map raw OSM tags to a short, human-readable type (factual, not invented).
function osmKind(tags = {}) {
  if (tags.tourism === "artwork") return tags.artwork_type ? `public art (${tags.artwork_type})` : "public art";
  if (tags.tourism === "viewpoint") return "scenic viewpoint";
  if (tags.leisure === "park") return "public park";
  if (tags.leisure === "garden") return "garden";
  if (tags.leisure === "nature_reserve") return "nature reserve";
  if (tags.historic) return `historic ${tags.historic.replace(/_/g, " ")}`;
  if (tags.natural) return `natural feature (${tags.natural.replace(/_/g, " ")})`;
  return "place of interest";
}

export async function fromOpenStreetMap(lat, lng, { radius_m = 1500, limit = 40 } = {}) {
  const r = radius_m;
  const around = `(around:${r},${lat},${lng})`;
  // Categories chosen for the DayQuest vibe: green space, art, oddities, history.
  const query = `[out:json][timeout:25];
(
  nwr${around}["leisure"~"^(park|garden|nature_reserve)$"]["name"];
  nwr${around}["tourism"~"^(artwork|viewpoint)$"]["name"];
  nwr${around}["historic"]["name"];
  nwr${around}["natural"~"^(peak|spring|cave_entrance|waterfall|tree)$"]["name"];
);
out center tags ${limit * 3};`;

  const res = await fetch(OVERPASS_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Overpass API ${res.status}: ${await res.text()}`);
  const data = await res.json();

  return (data.elements ?? [])
    .map((el) => {
      const plat = el.lat ?? el.center?.lat;
      const plng = el.lon ?? el.center?.lon;
      if (plat == null || plng == null) return null;
      return {
        source: "openstreetmap",
        name: el.tags.name,
        kind: osmKind(el.tags),
        lat: plat,
        lng: plng,
        distance_m: haversine_m(lat, lng, plat, plng),
        lore: "", // OSM has no prose; the guide stays generic for these
        source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      };
    })
    .filter(Boolean);
}

// --- Source 3: Google Places API (New) ---------------------------------------
// The "new/quirky/current" layer: notable local spots, art, attractions, parks
// and landmarks that Wikipedia (needs a geotagged article) and OSM (sparse in
// suburbs) miss — crucial for low-density areas like Smithtown / Long Island.
//
// Endpoint: POST https://places.googleapis.com/v1/places:searchNearby (Places New).
// COST: Places (New) is billed PER REQUEST, and the X-Goog-FieldMask header sets
// the SKU tier for the WHOLE request. We request only the fields we need; adding
// editorialSummary (an Atmosphere-tier field) bills the request at that higher
// tier, but it's the only cheap source of prose `lore` and stays within free tier
// for our handful of calls. We make ONE request per location and cache by rounded
// lat/lng to avoid repeat paid calls during testing.

const PLACES_API = "https://places.googleapis.com/v1/places:searchNearby";
const PLACES_TIMEOUT_MS = 5000;

// Field mask: ONLY what we map into the candidate shape. This controls SKU cost.
const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.editorialSummary",
].join(",");

// Discovery-worthy Table A types (verified against the place-types docs). Biases
// toward parks/art/landmarks/attractions and AWAY from commercial noise (gas
// stations, banks, chain stores, generic restaurants never carry these types).
// includedTypes is any-match, so this is most of the filter on its own.
const PLACES_INCLUDED_TYPES = [
  "park", "garden", "botanical_garden", "national_park", "state_park",
  "hiking_area", "beach", "marina",
  "monument", "sculpture", "plaza", "historical_landmark", "cultural_landmark",
  "art_gallery", "museum", "visitor_center",
  "zoo", "aquarium", "wildlife_park",
  "observation_deck", "planetarium", "performing_arts_theater",
  "tourist_attraction",
];

// Friendly, human-readable label from the Places type tags (factual, not invented).
const PLACES_KIND_LABELS = {
  park: "park",
  garden: "garden",
  botanical_garden: "botanical garden",
  national_park: "national park",
  state_park: "state park",
  hiking_area: "hiking area",
  beach: "beach",
  marina: "marina",
  monument: "monument",
  sculpture: "public art",
  art_gallery: "art gallery",
  plaza: "plaza",
  historical_landmark: "historic landmark",
  cultural_landmark: "cultural landmark",
  museum: "museum",
  visitor_center: "visitor center",
  zoo: "zoo",
  aquarium: "aquarium",
  wildlife_park: "wildlife park",
  observation_deck: "observation deck",
  planetarium: "planetarium",
  performing_arts_theater: "theater",
  tourist_attraction: "attraction",
};

function placesKind(primaryType, types = []) {
  if (primaryType && PLACES_KIND_LABELS[primaryType]) return PLACES_KIND_LABELS[primaryType];
  for (const t of types) {
    if (PLACES_KIND_LABELS[t]) return PLACES_KIND_LABELS[t];
  }
  // Fall back to humanising whatever primaryType/type we got.
  const raw = primaryType || types[0];
  return raw ? raw.replace(/_/g, " ") : "place of interest";
}

// In-memory cache keyed by rounded lat/lng (3 decimals ≈ 110m), mirroring area.js,
// so repeated test runs on the same coord don't re-bill the Places API.
const placesCache = new Map();
const placesCacheKey = (lat, lng) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

/**
 * Google Places (New) source: notable nearby spots — parks, art, landmarks,
 * museums, attractions — filtered to discovery-worthy types (not commercial noise).
 * Key-gated and graceful: returns [] if GOOGLE_MAPS_API_KEY is unset or on ANY
 * error/timeout (never throws).
 * @returns candidates: { source, name, kind, lat, lng, distance_m, lore, source_url }
 */
export async function fromPlaces(lat, lng, { radius_m = 1500 } = {}) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return []; // keyless/preview path unchanged

  const ck = placesCacheKey(lat, lng);
  if (placesCache.has(ck)) return placesCache.get(ck);

  try {
    const res = await fetch(PLACES_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes: PLACES_INCLUDED_TYPES,
        maxResultCount: 20, // Nearby Search (New) caps at 20
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: radius_m },
        },
      }),
      signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
    });
    // Surface the body on error so a bad request (e.g. INVALID_ARGUMENT) is
    // diagnosable rather than looking like an empty area.
    if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);
    const data = await res.json();

    const candidates = (data.places ?? [])
      .map((p) => {
        const plat = p.location?.latitude;
        const plng = p.location?.longitude;
        const name = p.displayName?.text;
        if (plat == null || plng == null || !name) return null;
        return {
          source: "google",
          name,
          kind: placesKind(p.primaryType, p.types),
          lat: plat,
          lng: plng,
          distance_m: haversine_m(lat, lng, plat, plng),
          lore: clip(p.editorialSummary?.text),
          source_url: p.id
            ? `https://www.google.com/maps/place/?q=place_id:${p.id}`
            : "",
        };
      })
      .filter(Boolean);

    placesCache.set(ck, candidates);
    return candidates;
  } catch (err) {
    console.warn(`  (a data source failed: Places API: ${err.message})`);
    return [];
  }
}

// --- Curated POI database source (Supabase) ---------------------------------
// A first-class source alongside the live web sources, active ONLY when Supabase
// is configured (poidbConfigured). Returns APPROVED, human-curated rows for the
// quest's Area — so when it fires, its lore-rich rows win the name-dedupe below
// (it's listed FIRST in `sources`). When unconfigured it's a cheap no-op ([]),
// so the live-only pipeline is byte-identical to before. Area-scoped (matching
// how write-through stamps rows), then distance-filtered to the gather radius.
async function fromPoiDb(lat, lng, opts = {}) {
  if (!poidbConfigured || !opts.area) return [];
  const radius_m = opts.radius_m || 1500;
  let rows;
  try {
    rows = await queryPois({ area: opts.area, status: "approved", limit: 200 });
  } catch (err) {
    console.warn(`  (a data source failed: POI DB: ${err.message})`);
    return [];
  }
  return rows
    .map((r) => ({
      source: r.source || "poidb",
      name: r.name,
      kind: r.kind || "",
      lat: r.lat,
      lng: r.lng,
      distance_m: haversine_m(lat, lng, r.lat, r.lng),
      // Curated blurb is the richest lore; fall back to the sourced snippet.
      lore: r.blurb || r.lore || "",
      source_url: r.source_url || "",
    }))
    .filter(
      (c) =>
        Number.isFinite(c.lat) &&
        Number.isFinite(c.lng) &&
        c.name &&
        c.distance_m <= radius_m * 1.5
    );
}

// Map a gathered candidate to a `poi` ingest row for write-through. ext_id is the
// (source, ext_id) conflict key — source_url is unique within a source, so it
// makes upserts idempotent (re-seeing a place updates, never duplicates). name is
// the last-resort key for the rare source_url-less candidate. Curation columns
// (category/tags/blurb/quality_flag/status) are intentionally omitted so the
// upsert never clobbers a curator's work; new rows land as `pending` by default.
export function candidateToPoiRow(c, area) {
  return {
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    area: area || null,
    kind: c.kind || "",
    lore: c.lore || "",
    source: c.source,
    source_url: c.source_url || null,
    ext_id: c.source_url || c.name,
  };
}

/**
 * Gather candidates from all enabled sources, de-dupe by name, sort by distance.
 * Adding a source later = push another function into `sources`.
 */
export async function gatherCandidates(lat, lng, opts = {}) {
  const { maxCandidates = 60 } = opts;
  // Wikipedia first so it wins name-collisions (it carries prose lore), then OSM,
  // then Google Places (new/quirky layer) — appended last so the lore-rich keyless
  // sources win name-dedupe ties.
  // Curated DB first so its lore-rich rows win name-dedupe over raw web hits;
  // it's a no-op ([]) unless Supabase is configured.
  const sources = [fromPoiDb, fromWikipedia, fromOpenStreetMap, fromPlaces];
  const results = await Promise.allSettled(sources.map((s) => s(lat, lng, opts)));

  const seen = new Set();
  const candidates = [];
  for (const r of results) {
    if (r.status !== "fulfilled") {
      console.warn(`  (a data source failed: ${r.reason?.message ?? r.reason})`);
      continue;
    }
    for (const c of r.value) {
      const key = c.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(c);
    }
  }
  candidates.sort((a, b) => a.distance_m - b.distance_m);
  return candidates.slice(0, maxCandidates); // cap to keep the LLM prompt lean
}
