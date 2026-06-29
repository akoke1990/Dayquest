// DayQuest — multi-neighborhood NYC POI pull (keyless: Wikipedia + OSM; Google
// Places too if GOOGLE_MAPS_API_KEY is set). This is a PURE DATA PULL — no
// Anthropic / paid-AI calls — that produces the INPUT to a downstream labeling
// pass.
//
//   node scripts/pull-nyc.js   (or: npm run pull:nyc)
//
// What it does:
//   - For each target Manhattan neighborhood (center coords), sweeps a small 3x3
//     grid (~350m spacing, ~900m gather radius) and gathers candidates via
//     lib/sources.js (Wikipedia GeoSearch + OSM Overpass + Places-if-keyed).
//   - Dedupes across ALL neighborhoods by a stable id (source + ext_id parsed
//     from source_url — reused from ingest-pois.js / ingest-gv.js).
//   - Tags each unique place with the neighborhood whose center is CLOSEST.
//   - FILTERS to the interesting using lib/quest.js interestScore (keeps
//     lore-rich + notable kinds, drops story-less generic entries), then caps
//     each neighborhood to its ~top 60-80 by (interest_score desc, dist asc).
//   - Writes data/nyc-pois-raw.json (data/ is gitignored — intermediate file).
//   - Prints total unique POIs + per-neighborhood counts + sample names, and
//     reports any source that timed out (so we know coverage).
//
// Overpass 429/504s are handled gracefully: gatherCandidates' Promise.allSettled
// drops a failed source for that grid point (Wikipedia/Places still land). We tee
// console.warn here to surface which sources failed during the sweep.

import { mkdirSync, writeFileSync } from "node:fs";
import { gatherCandidates, haversine_m } from "../lib/sources.js";
import { interestScore } from "../lib/quest.js";

// --- Target neighborhoods (center coords) ------------------------------------
const NEIGHBORHOODS = [
  { name: "Greenwich Village", lat: 40.7335, lng: -73.9970 },
  { name: "East Village", lat: 40.7265, lng: -73.9815 },
  { name: "SoHo", lat: 40.7233, lng: -74.0030 },
  { name: "Tribeca", lat: 40.7163, lng: -74.0086 },
  { name: "West Village", lat: 40.7358, lng: -74.0036 },
  { name: "Financial District", lat: 40.7075, lng: -74.0113 },
  { name: "Chinatown", lat: 40.7158, lng: -73.9970 },
];

// --- Grid / gather tuning -----------------------------------------------------
const GRID_N = 3; // 3x3 = 9 origin points per neighborhood ("a few points")
const SPACING_M = 350; // ~300-400m spacing
const RADIUS_M = 900; // ~800-1000m gather radius (passed to every source)
const PER_NEIGHBORHOOD_CAP = 70; // ~top 60-80 by interest
const PACE_MS = 3000; // polite delay between grid points (Overpass throttles)

// 1° latitude ≈ 111_320m; 1° longitude shrinks by cos(lat).
const M_PER_DEG_LAT = 111_320;
function buildGrid(center, gridN, spacingM) {
  const dLat = spacingM / M_PER_DEG_LAT;
  const dLng = spacingM / (M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));
  const points = [];
  const half = (gridN - 1) / 2;
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      points.push({ lat: center.lat + i * dLat, lng: center.lng + j * dLng });
    }
  }
  return points;
}

// --- Stable upstream id from source_url (reused from ingest-pois.js) ----------
// Wikipedia: ...?curid=PAGEID  →  "PAGEID"
// OSM:       .../TYPE/ID       →  "TYPE/ID"
// Google:    ...place_id:ID    →  "ID"
// Fallback: the source_url itself, so an unexpected URL never collides/drops.
function extId(c) {
  if (c.source === "wikipedia") {
    const m = c.source_url.match(/[?&]curid=(\d+)/);
    if (m) return m[1];
  } else if (c.source === "openstreetmap") {
    const m = c.source_url.match(/openstreetmap\.org\/(node|way|relation)\/(\d+)/);
    if (m) return `${m[1]}/${m[2]}`;
  } else if (c.source === "google") {
    const m = c.source_url.match(/place_id:([^&]+)/);
    if (m) return m[1];
  }
  return c.source_url; // fallback dedupe key — never null
}

// Closest neighborhood center to a place (the neighborhood it's tagged under).
function closestNeighborhood(lat, lng) {
  let best = NEIGHBORHOODS[0];
  let bestD = Infinity;
  for (const n of NEIGHBORHOODS) {
    const d = haversine_m(lat, lng, n.lat, n.lng);
    if (d < bestD) { bestD = d; best = n; }
  }
  return { name: best.name, distance_m: bestD };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Tee console.warn so we can surface which sources failed during the sweep.
  // gatherCandidates swallows source failures into console.warn and returns only
  // the survivors, so the return value alone can't tell us what timed out.
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(" "));
    origWarn(...args);
  };

  const byKey = new Map(); // "source|ext_id" -> { ...candidate, ext_id }

  // Direct coverage: which sources actually LANDED at each grid point. More
  // reliable than parsing the opaque warn string ("operation was aborted") which
  // carries no source name. (Overpass times out under load — Promise.allSettled
  // drops it for that point while Wikipedia/Places still land.)
  let gridPoints = 0;
  const landedOnPoints = { wikipedia: 0, openstreetmap: 0, google: 0 };
  const keyless = !process.env.GOOGLE_MAPS_API_KEY; // fromPlaces returns [] unqueried

  for (const n of NEIGHBORHOODS) {
    const grid = buildGrid(n, GRID_N, SPACING_M);
    console.log(`\n  ${n.name}: ${grid.length} grid points @ ~${SPACING_M}m spacing, radius ${RADIUS_M}m`);
    for (let i = 0; i < grid.length; i++) {
      const { lat, lng } = grid[i];
      // maxCandidates high so the per-call slice doesn't drop rows the cross-grid
      // dedupe would otherwise keep.
      const candidates = await gatherCandidates(lat, lng, {
        maxCandidates: 1000,
        radius_m: RADIUS_M,
      });
      gridPoints++;
      const sourcesHere = new Set(candidates.map((c) => c.source));
      for (const s of sourcesHere) if (s in landedOnPoints) landedOnPoints[s]++;
      let added = 0;
      for (const c of candidates) {
        const key = `${c.source}|${extId(c)}`;
        if (byKey.has(key)) continue;
        byKey.set(key, { ...c, ext_id: extId(c) });
        added++;
      }
      console.log(
        `    [${String(i + 1).padStart(2)}/${grid.length}] ${lat.toFixed(4)},${lng.toFixed(4)} ` +
          `→ ${candidates.length} candidates, +${added} new (grand total ${byKey.size})`
      );
      if (i < grid.length - 1) await sleep(PACE_MS);
    }
  }

  console.warn = origWarn; // restore

  // --- Tag neighborhood (closest center), keep dist-to-center for tiebreak ----
  const tagged = [...byKey.values()].map((c) => {
    const nb = closestNeighborhood(c.lat, c.lng);
    return {
      candidate: c,
      neighborhood: nb.name,
      centerDist: nb.distance_m,
      interest_score: interestScore(c),
    };
  });

  // --- Filter to the interesting (drop story-less generic: score <= 0) --------
  const interesting = tagged.filter((t) => t.interest_score > 0);

  // --- Per-neighborhood cap: top N by (interest desc, dist-to-center asc) ------
  const byNeighborhood = new Map(); // name -> [tagged...]
  for (const t of interesting) {
    if (!byNeighborhood.has(t.neighborhood)) byNeighborhood.set(t.neighborhood, []);
    byNeighborhood.get(t.neighborhood).push(t);
  }

  const finalRows = [];
  for (const n of NEIGHBORHOODS) {
    const list = (byNeighborhood.get(n.name) || []).sort((a, b) => {
      const d = b.interest_score - a.interest_score;
      if (d !== 0) return d;
      return a.centerDist - b.centerDist;
    });
    const capped = list.slice(0, PER_NEIGHBORHOOD_CAP);
    for (const t of capped) {
      const c = t.candidate;
      finalRows.push({
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        kind: c.kind || "",
        lore: c.lore || "",
        source: c.source,
        source_url: c.source_url,
        ext_id: c.ext_id,
        neighborhood: t.neighborhood,
        interest_score: t.interest_score,
      });
    }
  }

  // --- Write -------------------------------------------------------------------
  const dataDir = new URL("../data/", import.meta.url);
  mkdirSync(dataDir, { recursive: true });
  const outPath = new URL("nyc-pois-raw.json", dataDir);
  writeFileSync(outPath, JSON.stringify(finalRows, null, 2) + "\n");

  // --- Summary -----------------------------------------------------------------
  console.log(`\n  ===== SUMMARY =====`);
  console.log(`  Total unique interesting POIs: ${finalRows.length} (from ${byKey.size} unique gathered)\n`);

  const counts = new Map();
  for (const r of finalRows) counts.set(r.neighborhood, (counts.get(r.neighborhood) || 0) + 1);
  for (const n of NEIGHBORHOODS) {
    const rows = finalRows.filter((r) => r.neighborhood === n.name);
    console.log(`  ${n.name}: ${counts.get(n.name) || 0}`);
    const samples = rows.slice(0, 5).map((r) => r.name).join(", ");
    if (samples) console.log(`      e.g. ${samples}`);
  }

  // Source breakdown.
  const bySource = finalRows.reduce((acc, r) => {
    acc[r.source] = (acc[r.source] || 0) + 1;
    return acc;
  }, {});
  console.log(`\n  By source: ${Object.entries(bySource).map(([s, n]) => `${n} ${s}`).join(", ")}`);

  // --- Coverage / timeout report (measured directly, not from warn strings) ----
  // Reports which sources LANDED per grid point. Overpass commonly times out
  // under load (the warn-tee total below counts the generic abort warnings).
  console.log(`\n  Source coverage (grid points where the source returned data):`);
  console.log(`    Wikipedia:    ${landedOnPoints.wikipedia}/${gridPoints}`);
  console.log(`    OSM/Overpass: ${landedOnPoints.openstreetmap}/${gridPoints}` +
    (landedOnPoints.openstreetmap < gridPoints ? "  (rest timed out — graceful drop)" : ""));
  console.log(`    Google Places: ${keyless ? "not queried (no GOOGLE_MAPS_API_KEY)" : `${landedOnPoints.google}/${gridPoints}`}`);
  console.log(`    (total source-failure warnings during sweep: ${warnings.length})`);

  console.log(`\n  Wrote ${outPath.pathname}\n`);
}

main().catch((err) => {
  console.error(`\n  Pull failed: ${err.message}\n`);
  process.exit(1);
});
