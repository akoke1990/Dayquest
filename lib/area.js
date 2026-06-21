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
      } catch (err) {
        console.warn(`  (area: Google reverse geocode failed: ${err.message})`);
      }
    }
    if (!name) {
      name = await reverseNominatim(lat, lng);
    }
  } catch (err) {
    console.warn(`  (area: reverse geocode failed: ${err.message})`);
  }

  if (name) {
    cache.set(key, name); // cache only successful named resolutions
    return { name, lat, lng };
  }
  return { name: GENERIC, lat, lng };
}
