// DayQuest — POI ingest into the Supabase `poi` table (Increment 1: store).
//
// Usage:
//   node scripts/ingest-pois.js                         # default: Greenwich Village grid
//   node scripts/ingest-pois.js --place "East Village"  # forward-geocode a named place
//   node scripts/ingest-pois.js --lat 40.73 --lng -73.99 --label "Greenwich Village, NY"
//   node scripts/ingest-pois.js --seed data/gv-pois.json --label "Greenwich Village, NY"
//   node scripts/ingest-pois.js --radius 400 --grid 5    # grid tuning
//
//   (or: npm run ingest:pois -- <args>)
//
// What it does:
//   - Resolves an Area to ingest (named place via resolvePlace, OR --lat/--lng
//     + --label, OR a seed file, OR the default Greenwich Village center).
//   - Sweeps a grid via gatherCandidates (Wikipedia + OSM + Places-if-keyed),
//     OR loads an existing data/*.json seed file (so we don't re-hit the APIs).
//   - Dedupes by (source + ext_id) parsed from source_url (reused from ingest-gv).
//   - Stamps license per source, sets area, computes geohash, status defaults
//     to 'pending' (set by the DB, NOT sent in the upsert payload).
//   - If SUPABASE_SERVICE_KEY is set → upserts via lib/poidb.js (no-clobber).
//     Else → writes data/poi-<area>.json for review.
//
// Idempotent + curation-safe: see lib/poidb.js INGEST_COLUMNS — re-running
// upserts on (source, ext_id) and never overwrites a curator's
// category/tags/blurb/quality_flag/status.

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { gatherCandidates } from "../lib/sources.js";
import { resolvePlace, resolveArea } from "../lib/area.js";
import { isPoidbConfigured, upsertPois } from "../lib/poidb.js";

// --- Tiny .env loader (guard-free; the lib/quest.js one early-returns when
// ANTHROPIC_API_KEY is set, which would skip our SUPABASE vars). ----------------
function loadEnv() {
  try {
    const path = new URL("../.env", import.meta.url);
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env file — fine if vars are set in the environment */
  }
}

// --- Geohash encoder (base32, dependency-free). p7 ≈ 153m cell. ---------------
// Derived from base lat/lng (NOT from geom) per the CTO plan's note that a
// generated geohash can't reference another generated column.
const GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
function geohashEncode(lat, lng, precision = 7) {
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { ch = (ch << 1) | 1; lngMin = mid; }
      else { ch = ch << 1; lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latMin = mid; }
      else { ch = ch << 1; latMax = mid; }
    }
    even = !even;
    if (++bit === 5) {
      hash += GEOHASH_BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

// --- Stable upstream id from source_url (reused from ingest-gv.js) ------------
function extId(c) {
  if (c.ext_id) return c.ext_id; // seed files already carry it
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

const LICENSE = { wikipedia: "CC-BY-SA", openstreetmap: "ODbL", google: "Google" };

// --- Args ---------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i++; }
    }
  }
  return args;
}

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "area";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Default center: Greenwich Village, NYC (matches ingest-gv.js).
const DEFAULT_CENTER = { lat: 40.7308, lng: -73.9973 };
const DEFAULT_LABEL = "Greenwich Village, NY";

// Turn a deduped candidate into a poi-table-shaped row. status is intentionally
// 'pending' here for the FILE output's readability; the Supabase upsert path
// projects it OUT (lib/poidb.js) so it never clobbers a curated row.
function toRow(c, area) {
  const eid = extId(c);
  return {
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    geohash: geohashEncode(c.lat, c.lng, 7),
    area,
    kind: c.kind || "",
    lore: c.lore || "",
    source: c.source,
    source_url: c.source_url,
    license: c.license || LICENSE[c.source] || "",
    ext_id: eid,
    // --- curation columns (curator fills in Supabase Table Editor) ---
    category: "",
    tags: [],
    blurb: "",
    quality_flag: null,
    status: "pending",
  };
}

async function gatherFromGrid(center, label, gridN, spacingM) {
  // Resolve the Area name from the center unless an explicit label was given.
  let area = label;
  if (!area) {
    const resolved = await resolveArea(center.lat, center.lng);
    area = resolved.name;
  }
  const grid = buildGrid(center, gridN, spacingM);
  console.log(
    `\n  Ingesting "${area}": ${grid.length} grid points @ ~${spacingM}m spacing\n`
  );

  const byKey = new Map(); // "source|ext_id" -> candidate (first wins)
  for (let i = 0; i < grid.length; i++) {
    const { lat, lng } = grid[i];
    const candidates = await gatherCandidates(lat, lng, { maxCandidates: 1000 });
    let added = 0;
    for (const c of candidates) {
      const key = `${c.source}|${extId(c)}`;
      if (byKey.has(key)) continue;
      byKey.set(key, c);
      added++;
    }
    console.log(
      `  [${String(i + 1).padStart(2)}/${grid.length}] ${lat.toFixed(4)},${lng.toFixed(4)} ` +
        `→ ${candidates.length} candidates, +${added} new (total ${byKey.size})`
    );
    if (i < grid.length - 1) await sleep(3000); // Overpass throttles aggressively
  }
  return { area, candidates: [...byKey.values()] };
}

function loadFromSeed(seedPath, label) {
  const raw = JSON.parse(readFileSync(seedPath, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`seed file ${seedPath} is not a JSON array`);
  // Seed rows may already be poi-shaped (from ingest-gv) — dedupe again by
  // (source, ext_id) so a re-run / merged file never duplicates.
  const byKey = new Map();
  for (const c of raw) {
    const key = `${c.source}|${extId(c)}`;
    if (!byKey.has(key)) byKey.set(key, c);
  }
  const area = label || "Greenwich Village, NY";
  console.log(`\n  Seeding "${area}" from ${seedPath}: ${byKey.size} unique rows\n`);
  return { area, candidates: [...byKey.values()] };
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  const gridN = Number(args.grid) || 5;
  const spacingM = Number(args.radius) || 300;

  let area, candidates;
  if (args.seed) {
    ({ area, candidates } = loadFromSeed(args.seed, args.label));
  } else if (args.place) {
    const place = await resolvePlace(String(args.place));
    if (!place) {
      console.error(`\n  Could not geocode "${args.place}". Try --lat/--lng + --label.\n`);
      process.exit(1);
    }
    ({ area, candidates } = await gatherFromGrid(
      { lat: place.lat, lng: place.lng },
      args.label || place.name,
      gridN,
      spacingM
    ));
  } else if (args.lat && args.lng) {
    ({ area, candidates } = await gatherFromGrid(
      { lat: Number(args.lat), lng: Number(args.lng) },
      args.label,
      gridN,
      spacingM
    ));
  } else {
    // Default: Greenwich Village grid (label fixed so it needs no network).
    ({ area, candidates } = await gatherFromGrid(
      DEFAULT_CENTER,
      args.label || DEFAULT_LABEL,
      gridN,
      spacingM
    ));
  }

  const rows = candidates
    .map((c) => toRow(c, area))
    .sort((a, b) =>
      a.source === b.source ? a.name.localeCompare(b.name) : a.source.localeCompare(b.source)
    );

  const bySource = rows.reduce((acc, r) => {
    acc[r.source] = (acc[r.source] || 0) + 1;
    return acc;
  }, {});
  const sourceSummary = Object.entries(bySource).map(([s, n]) => `${n} ${s}`).join(", ");

  if (isPoidbConfigured()) {
    console.log(`  SUPABASE configured — upserting ${rows.length} rows into poi …`);
    const { upserted, batches } = await upsertPois(rows);
    console.log(
      `\n  Done. Upserted ${upserted} POIs for "${area}" in ${batches} batch(es) (${sourceSummary}).\n` +
        `  Curation columns (category/tags/blurb/quality_flag/status) were NOT touched on existing rows.\n`
    );
  } else {
    const dataDir = new URL("../data/", import.meta.url);
    mkdirSync(dataDir, { recursive: true });
    const fname = `poi-${slugify(area)}.json`;
    writeFileSync(new URL(fname, dataDir), JSON.stringify(rows, null, 2) + "\n");
    console.log(
      `\n  SUPABASE_SERVICE_KEY not set — wrote rows to data/ for review;\n` +
        `  set the key to upsert to Supabase.\n` +
        `\n  Done. ${rows.length} unique POIs for "${area}" (${sourceSummary}).\n` +
        `  Wrote data/${fname}.\n`
    );
    // Print a couple of sample rows so a dry-run is self-verifying.
    console.log("  Sample rows:\n" + JSON.stringify(rows.slice(0, 2), null, 2) + "\n");
  }
}

main().catch((err) => {
  console.error(`\n  Ingest failed: ${err.message}\n`);
  process.exit(1);
});
