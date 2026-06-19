// DayQuest — Greenwich Village POI ingest (keyless: Wikipedia + OSM).
//
//   node scripts/ingest-gv.js   (or: npm run ingest:gv)
//
// Sweeps a small grid of origin points across Greenwich Village, gathers
// candidates via lib/sources.js (Wikipedia GeoSearch + OSM Overpass), dedupes
// across the whole grid by (source + ext_id), and writes a curation-ready
// dataset (CSV + JSON) for a human curator to review in a spreadsheet.
//
// No external database, no API key, no Anthropic spend. The grid overlaps on
// purpose so we don't miss neighbourhood edges; dedupe removes the repeats.

import { mkdirSync, writeFileSync } from "node:fs";
import { gatherCandidates } from "../lib/sources.js";

// --- Grid: ~5x5 points at ~300m spacing, centred on Washington Square --------
const CENTER = { lat: 40.7308, lng: -73.9973 }; // Greenwich Village, NYC
const GRID_N = 5; // 5x5 = 25 origin points
const SPACING_M = 300;

// 1° latitude ≈ 111_320m everywhere; 1° longitude shrinks by cos(lat).
const M_PER_DEG_LAT = 111_320;
const dLat = SPACING_M / M_PER_DEG_LAT;
const dLng = SPACING_M / (M_PER_DEG_LAT * Math.cos((CENTER.lat * Math.PI) / 180));

function buildGrid() {
  const points = [];
  const half = (GRID_N - 1) / 2;
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      points.push({ lat: CENTER.lat + i * dLat, lng: CENTER.lng + j * dLng });
    }
  }
  return points;
}

// --- Stable upstream id from the candidate's source_url ----------------------
// Wikipedia: ...?curid=PAGEID   →  "PAGEID"
// OSM:       .../TYPE/ID        →  "TYPE/ID"
// Fallback: the source_url itself, so an unexpected URL never collides/drops.
function extId(c) {
  if (c.source === "wikipedia") {
    const m = c.source_url.match(/[?&]curid=(\d+)/);
    if (m) return m[1];
  } else if (c.source === "openstreetmap") {
    const m = c.source_url.match(/openstreetmap\.org\/(node|way|relation)\/(\d+)/);
    if (m) return `${m[1]}/${m[2]}`;
  }
  return c.source_url; // fallback dedupe key
}

const LICENSE = { wikipedia: "CC-BY-SA", openstreetmap: "ODbL" };

// --- Minimal RFC-4180 CSV escaping -------------------------------------------
function csvCell(value) {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(cells) {
  return cells.map(csvCell).join(",");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const grid = buildGrid();
  console.log(`\n  Ingesting Greenwich Village: ${grid.length} grid points @ ~${SPACING_M}m spacing\n`);

  const byKey = new Map(); // "source|ext_id" -> candidate (first wins)
  for (let i = 0; i < grid.length; i++) {
    const { lat, lng } = grid[i];
    // maxCandidates high so the per-call slice doesn't drop rows the cross-grid
    // dedupe would otherwise keep.
    const candidates = await gatherCandidates(lat, lng, { maxCandidates: 1000 });
    let added = 0;
    for (const c of candidates) {
      const key = `${c.source}|${extId(c)}`;
      if (byKey.has(key)) continue;
      byKey.set(key, { ...c, ext_id: extId(c) });
      added++;
    }
    console.log(
      `  [${String(i + 1).padStart(2)}/${grid.length}] ${lat.toFixed(4)},${lng.toFixed(4)} ` +
        `→ ${candidates.length} candidates, +${added} new (total ${byKey.size})`
    );
    // Overpass throttles aggressively (burst-then-429); pace generously so the
    // OSM layer (parks/art/viewpoints — the Atlas-Obscura vibe) survives the sweep.
    if (i < grid.length - 1) await sleep(3000);
  }

  const pois = [...byKey.values()].sort((a, b) =>
    a.source === b.source ? a.name.localeCompare(b.name) : a.source.localeCompare(b.source)
  );

  // Build curation-ready rows: ingest fields + EMPTY curation columns.
  const rows = pois.map((c) => ({
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    kind: c.kind || "",
    lore: c.lore || "",
    source: c.source,
    source_url: c.source_url,
    ext_id: c.ext_id, // stable upstream id — the (source, ext_id) upsert key
    license: LICENSE[c.source] || "",
    // --- curator fills these in the spreadsheet ---
    category: "",
    tags: "",
    blurb: "",
    quality_flag: "",
    status: "pending",
  }));

  const COLUMNS = [
    "name", "lat", "lng", "kind", "lore", "source", "source_url", "ext_id", "license",
    "category", "tags", "blurb", "quality_flag", "status",
  ];

  const dataDir = new URL("../data/", import.meta.url);
  mkdirSync(dataDir, { recursive: true });

  const csv =
    [csvRow(COLUMNS), ...rows.map((r) => csvRow(COLUMNS.map((k) => r[k])))].join("\n") + "\n";
  writeFileSync(new URL("gv-pois.csv", dataDir), csv);
  writeFileSync(new URL("gv-pois.json", dataDir), JSON.stringify(rows, null, 2) + "\n");

  const wiki = rows.filter((r) => r.source === "wikipedia").length;
  const osm = rows.filter((r) => r.source === "openstreetmap").length;
  console.log(
    `\n  Done. ${rows.length} unique Greenwich Village POIs ` +
      `(${wiki} Wikipedia, ${osm} OpenStreetMap).\n` +
      `  Wrote data/gv-pois.csv and data/gv-pois.json — ready for curation.\n`
  );
}

main().catch((err) => {
  console.error(`\n  Ingest failed: ${err.message}\n`);
  process.exit(1);
});
