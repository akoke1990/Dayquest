// Reverse geocoding: GPS coordinates -> a human "Area" label.
//
// This is the foundation for Areas as a first-class DayQuest concept. Instead of
// printing raw "lat, lng" on the quest header and share card, we resolve a
// neighbourhood/town name like "East Village, NY" or "Stony Brook, NY".
//
// resolveArea(lat, lng) -> { name, lat, lng }
//
// Fallback chain (richest -> most graceful):
//   1. Google Geocoding API   — only if GOOGLE_MAPS_API_KEY is set (server-side).
//   2. OpenStreetMap Nominatim — free, keyless reverse geocode.
//   3. Generic "Your Area"     — on ANY failure/timeout. NEVER raw coords, never throws.
//
// Dependency-free: uses global fetch (Node 18+) and AbortSignal.timeout.

// DayQuest User-Agent — Nominatim/Wikipedia etiquette wants a descriptive UA
// with contact info, and Nominatim blocks generic/missing ones.
const USER_AGENT =
  "DayQuest/0.1 (MVP scavenger-hunt prototype; contact: andrew@firstprinciplefunds.com)";

const TIMEOUT_MS = 4000;
const GENERIC = "Your Area";

// In-memory cache keyed by rounded lat/lng (3 decimals ≈ 110m). We cache only
// successful NAMED resolutions — never the generic fallback, so a single
// transient timeout can't poison a cell forever.
const cache = new Map();
const cacheKey = (lat, lng) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

// "New York" -> "NY" when Nominatim gives an ISO3166-2 code like "US-NY".
// Dependency-free: no hardcoded 50-state map needed.
function regionAbbrev(addr) {
  const iso = addr?.["ISO3166-2-lvl4"]; // e.g. "US-NY"
  if (typeof iso === "string" && iso.includes("-")) {
    const part = iso.split("-")[1];
    if (part && part.length <= 3) return part;
  }
  return null;
}

// Compose "<locality || city>, <region>" from Nominatim address fields.
// Prefer the most specific neighbourhood-ish name, fall back to city-ish.
// Nominatim sometimes returns an administrative artefact rather than a real
// place name (e.g. NYC's "Manhattan Community Board 3"). Skip those so we don't
// print a bureaucratic district instead of a neighbourhood.
function isAdminArtefact(s) {
  return typeof s === "string" && /community board|community district|electoral|administrative/i.test(s);
}

function composeNominatimName(addr = {}) {
  const localityCandidates = [addr.neighbourhood, addr.suburb, addr.quarter, addr.city_district];
  const locality = localityCandidates.find((c) => c && !isAdminArtefact(c));
  const city =
    addr.city || addr.town || addr.village || addr.hamlet || addr.municipality;
  const primary = locality || city;
  if (!primary) return null;

  // Region: prefer a short state abbrev; else the city (so a neighbourhood reads
  // "East Village, New York City" rather than dangling); else nothing.
  const region = regionAbbrev(addr) || (locality && city ? city : addr.state);
  // Avoid "City, City" duplication.
  if (region && region !== primary) return `${primary}, ${region}`;
  return primary;
}

async function reverseNominatim(lat, lng) {
  const url =
    "https://nominatim.openstreetmap.org/reverse?" +
    new URLSearchParams({
      format: "json",
      lat: String(lat),
      lon: String(lng),
      zoom: "16", // neighbourhood / town level (14 returns admin districts in dense cities)
      addressdetails: "1",
    });
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  return composeNominatimName(data?.address);
}

// Pull a short name from Google's address_components. Defensive: any missing
// field is fine. Prefer neighbourhood, then sublocality/locality, plus a short
// region (the state's short_name, e.g. "NY").
function composeGoogleName(results = []) {
  for (const result of results) {
    const comps = result?.address_components;
    if (!Array.isArray(comps)) continue;
    const byType = (type, key = "long_name") => {
      const c = comps.find((x) => Array.isArray(x?.types) && x.types.includes(type));
      return c ? c[key] : null;
    };
    const primary =
      byType("neighborhood") ||
      byType("sublocality") ||
      byType("locality") ||
      byType("postal_town");
    if (!primary) continue;
    const region =
      byType("administrative_area_level_1", "short_name") || byType("locality");
    if (region && region !== primary) return `${primary}, ${region}`;
    return primary;
  }
  return null;
}

async function reverseGoogle(lat, lng, key) {
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?" +
    new URLSearchParams({
      latlng: `${lat},${lng}`,
      key,
      result_type: "neighborhood|sublocality|locality|postal_town",
    });
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Google ${res.status}`);
  const data = await res.json();
  if (data?.status && data.status !== "OK") {
    // ZERO_RESULTS, REQUEST_DENIED, etc — let the caller fall through.
    throw new Error(`Google status ${data.status}`);
  }
  return composeGoogleName(data?.results);
}

// --- Forward geocoding: a typed place name -> coordinates -------------------
// The mirror image of resolveArea: turn "East Village" / "Stony Brook NY" into
// { name, lat, lng } so the user can quest somewhere OTHER than current GPS.
// Same fallback chain (Google if keyed → Nominatim → null), same etiquette.
// Its own cache (keyed by the lowercased query string) so it never collides
// with the reverse-geocode cache's "lat,lng" keys.
const placeCache = new Map();

// Pull a clean display name + coords from Google forward-geocode results.
// Prefer the same short composition the reverse path uses (neighbourhood, NY);
// fall back to Google's verbose formatted_address only if that yields nothing.
function parseGooglePlace(data) {
  const result = data?.results?.[0];
  const loc = result?.geometry?.location;
  if (!result || !loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
    return null;
  }
  const name = composeGoogleName(data.results) || result.formatted_address || null;
  return { name, lat: loc.lat, lng: loc.lng };
}

async function forwardGoogle(query, key) {
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?" +
    new URLSearchParams({ address: query, key });
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Google ${res.status}`);
  const data = await res.json();
  if (data?.status && data.status !== "OK") {
    throw new Error(`Google status ${data.status}`);
  }
  return parseGooglePlace(data);
}

// Tidy Nominatim's often-verbose display_name down to the first 2-3 parts so it
// reads like a place chip ("East Village, Manhattan, New York") not a full
// postal address. Falls back to the raw string if anything's unexpected.
function tidyDisplayName(displayName) {
  if (typeof displayName !== "string" || !displayName) return null;
  const parts = displayName.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 3) return parts.join(", ");
  return parts.slice(0, 3).join(", ");
}

async function forwardNominatim(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    // addressdetails=1 so we can reuse composeNominatimName, which strips
    // bureaucratic artefacts (e.g. "Manhattan Community Board 3") the raw
    // display_name carries — keeping forward + reverse naming consistent.
    new URLSearchParams({ format: "json", q: query, limit: "1", addressdetails: "1" });
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  const hit = Array.isArray(data) ? data[0] : null;
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Prefer the same clean composition the reverse path uses; fall back to a
  // tidied display_name, then the raw query.
  const name = composeNominatimName(hit.address) || tidyDisplayName(hit.display_name) || query;
  return { name, lat, lng };
}

/**
 * Forward-geocode a typed place name to coordinates + a clean display name.
 * Never throws. Returns null on empty query, no match, or any failure/timeout.
 * @param {string} query  e.g. "East Village", "Stony Brook NY"
 * @returns {Promise<{ name: string, lat: number, lng: number } | null>}
 */
export async function resolvePlace(query) {
  const q = typeof query === "string" ? query.trim() : "";
  if (!q) return null;

  const key = q.toLowerCase();
  if (placeCache.has(key)) return placeCache.get(key);

  let place = null;
  try {
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;
    if (googleKey) {
      try {
        place = await forwardGoogle(q, googleKey);
      } catch {
        console.warn(JSON.stringify({ level: "warn", event: "geocode_provider_failed", provider: "google", operation: "forward" }));
      }
    }
    if (!place) {
      place = await forwardNominatim(q);
    }
  } catch {
    console.warn(JSON.stringify({ level: "warn", event: "geocode_provider_failed", provider: "nominatim", operation: "forward" }));
  }

  // Cache only successful resolutions, mirroring resolveArea: a transient
  // timeout shouldn't poison a query string forever.
  if (place && place.name && Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
    placeCache.set(key, place);
    return place;
  }
  return null;
}

/**
 * Resolve coordinates to a human Area label. Never throws; never returns raw
 * coordinates. On any failure/timeout returns the generic "Your Area".
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ name: string, lat: number, lng: number }>}
 */
export async function resolveArea(lat, lng) {
  const key = cacheKey(lat, lng);
  if (cache.has(key)) return { name: cache.get(key), lat, lng };

  let name = null;
  try {
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;
    if (googleKey) {
      try {
        name = await reverseGoogle(lat, lng, googleKey);
      } catch {
        console.warn(JSON.stringify({ level: "warn", event: "geocode_provider_failed", provider: "google", operation: "reverse" }));
      }
    }
    if (!name) {
      name = await reverseNominatim(lat, lng);
    }
  } catch {
    console.warn(JSON.stringify({ level: "warn", event: "geocode_provider_failed", provider: "nominatim", operation: "reverse" }));
  }

  if (name) {
    cache.set(key, name); // cache only successful named resolutions
    return { name, lat, lng };
  }
  return { name: GENERIC, lat, lng };
}
