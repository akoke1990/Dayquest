// Pluggable place-data sources for DayQuest.
//
// Each source is an async function: (lat, lng, opts) -> [candidate, ...]
// A "candidate" is the authoritative record we trust for coordinates/name/url.
// The LLM never invents these — it only picks which ones to use, by id.
//
// MVP ships ONE source: Wikipedia GeoSearch (keyless, gives location AND lore).
// Later: addOpenStreetMap (parks/green space), addPlaces (new/quirky spots).

const WIKI_API = "https://en.wikipedia.org/w/api.php";
// Wikipedia asks for a descriptive User-Agent with contact info.
const USER_AGENT = "DayQuest/0.1 (MVP scavenger-hunt prototype; contact: andrew@firstprinciplefunds.com)";

async function wikiFetch(params) {
  const url = `${WIKI_API}?${new URLSearchParams({ format: "json", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
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

function haversine_m(lat1, lng1, lat2, lng2) {
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

/**
 * Gather candidates from all enabled sources, de-dupe by name, sort by distance.
 * Adding a source later = push another function into `sources`.
 */
export async function gatherCandidates(lat, lng, opts = {}) {
  const { maxCandidates = 60 } = opts;
  // Wikipedia first so it wins name-collisions (it carries prose lore).
  const sources = [fromWikipedia, fromOpenStreetMap]; // TODO: fromPlaces (new/quirky)
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
