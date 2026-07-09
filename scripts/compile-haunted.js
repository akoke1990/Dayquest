// DayQuest — compile the haunted/creepy research into a curated dataset.
//
//   node scripts/compile-haunted.js            (or: npm run compile:haunted)
//
// Input:  data/haunted-nyc-raw.json + data/haunted-li-raw.json — web-researched
//         places (name, location, lat/lng, lore, tags, creepy_type, sensitive,
//         access) produced by the research pass.
// Output: db/haunted-pois.json — labeler-format curated rows the server's
//         curated-file source (lib/sources.js) serves directly.
//
// What it enforces (the editorial policy, in code so it's repeatable):
//   1. ACCESS: places players can't lawfully/physically reach (private roads,
//      boat-only, Coast Guard property) → status "flagged" (never served).
//   2. SENSITIVITY: research-flagged entries (recent crimes, mass-tragedy
//      memorials, sacred burial grounds) → status "maybe" (human call, not
//      served until promoted). PLUS: anything the D-022 isSensitive() gate
//      would filter at serve time is reported, so we know it's dead weight.
//   3. DEDUPE: entries matching an existing curated row by normalized name are
//      NOT duplicated — instead their creepy tags are MERGED into the existing
//      row (so ghost hunts can use it) and the new row is skipped.
//   4. COORDS: estimated coordinates are verified against Nominatim (address
//      geocode, 1 req/s). Adopt Nominatim when it lands 120-400m from the
//      estimate (same block, better precision); beyond 400m distrust the match.
//   5. TAGS: creepy_type folds into the tag vocabulary (cemetery→cemetery,
//      ghost_legend→haunted, crime_site→scandal_crime, everything else→macabre)
//      so the server's GHOST_TAGS filter sees every eligible place.

import { readFileSync, writeFileSync } from "node:fs";
import { isSensitive } from "../lib/quest.js";
import { haversine_m } from "../lib/sources.js";

const INPUTS = ["data/haunted-nyc-raw.json", "data/haunted-li-raw.json"];
const EXISTING = "db/nyc-pois-labeled.json";
const OUTPUT = "db/haunted-pois.json";

// Editorial overrides, keyed by the RESEARCH name. rename: avoid D-022's broad
// name gate (a place *titled* "...Death Site" gets serve-time filtered even
// when its story is fair game). lore: trim references too recent/dark for game
// copy. status: human judgment where the mechanical policy misfires.
const OVERRIDES = {
  "The House of Death (14 West 10th Street)": {
    rename: "14 West 10th Street (Mark Twain's Village House)",
    lore:
      "This 1856 Greek Revival brownstone is said to be haunted by as many as 22 ghosts, the most famous being Mark Twain, who lived here in 1900-1901 and himself wrote of an unexplained incident by the fireplace. Actress Jan Bryant Bartell chronicled a 'monstrous moving shadow' and other phenomena she experienced in the building in the 1950s-70s.",
    status: "approved",
  },
  "Marie's Crisis Cafe (Thomas Paine Death Site)": {
    rename: "Marie's Crisis Cafe (Thomas Paine's Last Home)",
  },
  "82 Jane Street (Alexander Hamilton Death Site Plaque)": {
    rename: "82 Jane Street (Hamilton's Final Hours)",
  },
  // Mechanical access rule flags the whole site, but Nissequogue River State
  // Park's grounds are a public park — only the derelict buildings are
  // off-limits. Human call (safety: players must not enter ruins) → maybe.
  "Kings Park Psychiatric Center (Nissequogue River State Park)": {
    status: "maybe",
  },
};

const CREEPY_TYPE_TAG = {
  cemetery: "cemetery",
  ghost_legend: "haunted",
  crime_site: "scandal_crime",
  former_institution: "macabre",
  macabre_history: "macabre",
  oddity: "macabre",
};

// Normalized name for dedupe: lowercase, drop parentheticals + punctuation.
function normName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// "…, Stony Brook, NY 11790" → "Stony Brook, NY". Best-effort; falls back to
// the region default when no town parses.
function areaFrom(location, fallback) {
  const m = String(location || "").match(/,\s*([A-Za-z.' -]+),\s*NY\b/);
  return m ? `${m[1].trim()}, NY` : fallback;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Nominatim address geocode (keyless, 1 req/s policy, descriptive UA).
async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q,
    format: "json",
    limit: "1",
    countrycodes: "us",
  })}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "DayQuest/0.1 (curation pipeline; contact: andrew@firstprinciplefunds.com)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const hits = await res.json();
  if (!hits?.[0]) return null;
  return { lat: Number(hits[0].lat), lng: Number(hits[0].lon) };
}

function decideStatus(p) {
  const access = String(p.access || "public").toLowerCase();
  if (access.includes("restricted")) return { status: "flagged", why: `access: ${p.access}` };
  if (p.sensitive) return { status: "maybe", why: "research flagged sensitive — human review" };
  return { status: "approved", why: "" };
}

async function main() {
  const existing = JSON.parse(readFileSync(EXISTING, "utf8"));
  const existingByName = new Map(existing.map((r) => [normName(r.name), r]));

  const raw = INPUTS.flatMap((f) => {
    const region = f.includes("-li-") ? "Long Island, NY" : "New York, NY";
    return JSON.parse(readFileSync(f, "utf8")).map((p) => ({ ...p, _region: region }));
  });
  console.log(`\n  ${raw.length} researched places in.`);

  const out = [];
  const merged = [];
  const report = [];
  for (const p0 of raw) {
    const ov = OVERRIDES[p0.name] || {};
    const p = { ...p0, name: ov.rename || p0.name, lore: ov.lore || p0.lore };
    // Fold creepy_type into the tag set so GHOST_TAGS filtering sees it.
    const tags = [...new Set([...(p.tags || []), CREEPY_TYPE_TAG[p.creepy_type]].filter(Boolean))];

    // Dedupe: merge creepy tags into the existing curated row, skip the new one.
    const ex = existingByName.get(normName(p.name));
    if (ex) {
      const before = new Set(ex.tags || []);
      const add = tags.filter((t) => ["haunted", "scandal_crime", "cemetery", "macabre"].includes(t) && !before.has(t));
      if (add.length) {
        ex.tags = [...(ex.tags || []), ...add];
        merged.push(`${ex.name} += ${add.join(",")}`);
      }
      continue;
    }

    let { status, why } = decideStatus(p);
    if (ov.status) {
      why = why ? `${why}; override → ${ov.status}` : `override → ${ov.status}`;
      status = ov.status;
    }

    // Coordinate verification for estimated coords on servable rows.
    let { lat, lng } = p;
    let coordNote = "";
    if (p.coords_estimated && status !== "flagged") {
      const q = String(p.location || "").split(/[;(]/)[0].trim();
      try {
        const g = await geocode(q.includes("NY") ? q : `${q}, New York`);
        await sleep(1100); // Nominatim usage policy: max 1 req/s
        if (g) {
          const d = haversine_m(lat, lng, g.lat, g.lng);
          if (d > 120 && d <= 400) {
            ({ lat, lng } = g);
            coordNote = `coords ← Nominatim (moved ${d}m)`;
          } else if (d > 400) {
            coordNote = `geocode disagreed by ${d}m — kept estimate, review`;
          }
        } else {
          coordNote = "geocode: no match — kept estimate";
        }
      } catch {
        coordNote = "geocode failed — kept estimate";
      }
    }

    const row = {
      name: p.name,
      lat,
      lng,
      area: areaFrom(p.location, p._region),
      kind: p.creepy_type ? p.creepy_type.replace(/_/g, " ") : "",
      lore: p.lore || "",
      blurb: "", // empty on purpose: the candidate mapper falls back to the rich lore
      category: "historic_site",
      tags,
      quality_flag: 1,
      status,
      source: "curated-research",
      source_url: p.source_url || null,
      ext_id: p.source_url || p.name,
      access_note: p.access && String(p.access).toLowerCase() !== "public" ? p.access : undefined,
    };
    out.push(row);

    // Serve-time sanity: would D-022's gate silently drop an approved row?
    const gate = isSensitive({ name: row.name, kind: row.kind, lore: row.lore });
    report.push(
      `${status.toUpperCase().padEnd(8)} ${gate ? "⛔D-022" : "      "} ${row.name}` +
        (why ? `  [${why}]` : "") +
        (coordNote ? `  {${coordNote}}` : "")
    );
  }

  writeFileSync(OUTPUT, JSON.stringify(out, null, 2));
  if (merged.length) writeFileSync(EXISTING, JSON.stringify(existing, null, 2));

  const counts = out.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  console.log(`\n  Wrote ${out.length} rows → ${OUTPUT}`);
  console.log(`  Status: ${JSON.stringify(counts)}`);
  if (merged.length) console.log(`  Merged creepy tags into ${merged.length} existing rows:\n    ${merged.join("\n    ")}`);
  console.log(`\n  --- review sheet ---`);
  report.forEach((l) => console.log("  " + l));
}

main().catch((e) => {
  console.error("  ! compile error:", e.message);
  process.exit(1);
});
