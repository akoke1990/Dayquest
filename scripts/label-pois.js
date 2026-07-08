// DayQuest — POI LABELER / enrichment pass ("the learning step").
//
// This is the missing downstream stage referenced by pull-nyc.js: it turns RAW
// pulled places (name/kind/lore) into QUEST-ELIGIBLE curated rows by assigning a
// category, theme tags, a punchy blurb, a quality flag, and a status. It's what
// closes the "constantly adding to the DB" loop — write-through fills the DB with
// `pending` rows; this pass promotes the good ones to `approved` so quests can
// actually pull them.
//
// Usage:
//   node scripts/label-pois.js                       # label data/nyc-pois-raw.json → data/nyc-pois-labeled.gen.json
//   node scripts/label-pois.js --in data/foo.json    # custom input file
//   node scripts/label-pois.js --db                  # read `pending` rows from Supabase, write curated rows back
//   node scripts/label-pois.js --limit 20            # only the first 20 (fast test)
//   node scripts/label-pois.js --out data/x.json     # custom output file (file mode)
//   (or: npm run label:pois -- <args>)
//
// LABELING BACKEND (auto-detected, mirrors lib/quest.js):
//   - Real ANTHROPIC_API_KEY  → Claude writes the category/tags/blurb (best).
//   - No/placeholder key      → a deterministic keyword HEURISTIC runs instead,
//                               so the pipeline works today with zero spend.
//
// SAFE BY DEFAULT: file mode writes a *.gen.json (never clobbers the hand-curated
// data/nyc-pois-labeled.json). --db is the only path that writes Supabase, and it
// no-ops with a clear message when Supabase isn't configured.

import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { poidbConfigured, queryPois, upsertCuratedPois } from "../lib/poidb.js";

// --- Controlled vocabularies (must match the app's expectations) -------------
// The 13 categories the curated dataset uses (single-valued per place).
const CATEGORIES = [
  "historic_site", "architecture", "religious", "monument_memorial", "landmark",
  "museum", "gallery", "public_art", "park_garden", "venue_nightlife",
  "shop_market", "infrastructure", "other",
];
// The theme tags (multi-valued). Kept in sync with the app's theme filters.
const TAGS = [
  "historic", "architecture", "art", "iconic", "music", "immigrant_history",
  "political", "foodie", "hidden_gem", "scandal_crime", "literary",
  "lgbtq_history", "film_tv", "maritime", "revolutionary", "haunted",
];

// --- CLI args ----------------------------------------------------------------
function parseArgs(argv) {
  const a = { in: "data/nyc-pois-raw.json", out: "data/nyc-pois-labeled.gen.json", db: false, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--db") a.db = true;
    else if (k === "--in") a.in = argv[++i];
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--limit") a.limit = Number(argv[++i]) || 0;
  }
  return a;
}

// --- Key detection (same gate as lib/quest.js) -------------------------------
function hasRealKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  return Boolean(key && key.startsWith("sk-ant-") && !key.includes("...") && key.length > 40);
}

// --- Heuristic labeler (no LLM) ----------------------------------------------
// Deterministic keyword mapping over kind + lore + name. Intentionally
// conservative: it approves clearly-storied places, flags story-less generics,
// and leaves the ambiguous middle as `maybe` for a later (LLM or human) pass.
const CATEGORY_RULES = [
  [/\b(bar|pub|tavern|brewery|nightclub|cocktail|lounge|beer)\b/i, "venue_nightlife"],
  [/\b(church|synagogue|temple|mosque|cathedral|chapel|congregation|religious)\b/i, "religious"],
  [/\b(museum)\b/i, "museum"],
  [/\b(gallery)\b/i, "gallery"],
  [/\b(monument|memorial|statue of|obelisk)\b/i, "monument_memorial"],
  [/\b(mural|artwork|public art|sculpture|installation)\b/i, "public_art"],
  [/\b(park|garden|square|greenway|plaza)\b/i, "park_garden"],
  [/\b(bridge|tunnel|pier|subway|station|infrastructure|aqueduct)\b/i, "infrastructure"],
  [/\b(shop|store|market|bookstore|boutique|deli|bakery)\b/i, "shop_market"],
  [/\b(historic|built in 1|founded in 1|18\d\d|17\d\d|19[0-2]\d|landmark building)\b/i, "historic_site"],
  [/\b(building|architect|tower|hall|mansion|brownstone|facade|beaux-arts|gothic)\b/i, "architecture"],
  [/\b(landmark|iconic)\b/i, "landmark"],
];
const TAG_RULES = [
  [/\b(historic|history|18\d\d|17\d\d|founded|built in)\b/i, "historic"],
  [/\b(architect|beaux-arts|gothic|facade|brownstone|design)\b/i, "architecture"],
  [/\b(art|mural|sculpture|gallery|artist)\b/i, "art"],
  [/\b(iconic|famous|world-renowned|celebrated)\b/i, "iconic"],
  [/\b(music|jazz|concert|band|opera|venue)\b/i, "music"],
  [/\b(immigrant|tenement|ellis island|diaspora)\b/i, "immigrant_history"],
  [/\b(political|protest|suffrage|union|rally|labor)\b/i, "political"],
  [/\b(restaurant|food|cuisine|diner|dish|culinary|eatery)\b/i, "foodie"],
  [/\b(hidden|tucked|secret|overlooked|little-known)\b/i, "hidden_gem"],
  [/\b(murder|crime|scandal|gang|mob|notorious|riot)\b/i, "scandal_crime"],
  [/\b(writer|author|poet|novel|literary|bookshop)\b/i, "literary"],
  [/\b(lgbtq|gay|stonewall|queer|pride)\b/i, "lgbtq_history"],
  [/\b(film|movie|tv|filmed|hollywood|cinema)\b/i, "film_tv"],
  [/\b(maritime|ship|harbor|dock|seafaring|naval)\b/i, "maritime"],
  [/\b(revolution|colonial|1776|founding father)\b/i, "revolutionary"],
  [/\b(haunted|ghost|spectre|apparition|spirit)\b/i, "haunted"],
];

function heuristicLabel(poi) {
  const hay = `${poi.name || ""} ${poi.kind || ""} ${poi.lore || ""}`;
  let category = "other";
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(hay)) { category = cat; break; }
  }
  const tags = [];
  for (const [re, tag] of TAG_RULES) {
    if (re.test(hay) && !tags.includes(tag)) tags.push(tag);
  }
  const loreLen = (poi.lore || "").trim().length;
  // quality_flag: 1 = strong (rich lore), 2 = usable, 3 = weak.
  const quality_flag = loreLen > 200 ? 1 : loreLen > 40 ? 2 : 3;
  // status: approve storied places, flag story-less generics, else maybe.
  let status;
  if (loreLen > 120 && category !== "other") status = "approved";
  else if (loreLen < 30 && category === "other") status = "flagged";
  else status = "maybe";
  // blurb: heuristic can't write copy — clip the first sentence of the lore.
  const blurb = clipSentence(poi.lore) || poi.name || "";
  return { category, tags, blurb, quality_flag, status };
}

function clipSentence(text, max = 140) {
  if (!text) return "";
  const first = String(text).split(/(?<=[.!?])\s/)[0].trim();
  return first.length > max ? first.slice(0, max - 1).trim() + "…" : first;
}

// --- LLM labeler (Claude, forced tool) ---------------------------------------
// One structured call per place. Anti-drift: the tool schema constrains category
// to the enum and tags to the vocabulary; anything off-list is dropped/snapped.
const labelTool = {
  name: "label_poi",
  description: "Assign curation metadata to one point of interest.",
  input_schema: {
    type: "object",
    properties: {
      category: { type: "string", enum: CATEGORIES, description: "Single best category." },
      tags: { type: "array", items: { type: "string", enum: TAGS }, description: "0-4 theme tags that truly apply." },
      blurb: { type: "string", description: "One punchy sentence in a playful, curious voice (≤140 chars). No hype, grounded in the real place." },
      quality_flag: { type: "integer", enum: [1, 2, 3], description: "1 = storied/strong pick, 2 = usable, 3 = weak/generic." },
      status: { type: "string", enum: ["approved", "maybe", "flagged"], description: "approved = quest-worthy now; maybe = borderline; flagged = skip (generic/dupe/unsafe)." },
    },
    required: ["category", "tags", "blurb", "quality_flag", "status"],
  },
};

async function llmLabel(client, poi) {
  const resp = await client.messages.create({
    model: process.env.DAYQUEST_MODEL || "claude-sonnet-4-6",
    max_tokens: 400,
    system:
      "You are a sharp local curator for a scavenger-hunt game. Given one real place " +
      "(name, type, and a factual snippet), assign its category, up to 4 theme tags, a " +
      "punchy one-line blurb, a quality flag, and a status. Approve only genuinely " +
      "interesting, safe, findable places; flag generic/story-less/unsafe ones. Never " +
      "invent facts — ground the blurb only in the snippet.",
    tools: [labelTool],
    tool_choice: { type: "tool", name: "label_poi" },
    messages: [{
      role: "user",
      content: `NAME: ${poi.name}\nTYPE: ${poi.kind || "(unknown)"}\nAREA: ${poi.neighborhood || poi.area || "(unknown)"}\nSNIPPET: ${poi.lore || "(none)"}`,
    }],
  });
  const block = resp.content.find((b) => b.type === "tool_use");
  if (!block) throw new Error("model returned no label");
  const v = block.input;
  // Defensive snap to vocab (the enum should enforce this, but be safe).
  return {
    category: CATEGORIES.includes(v.category) ? v.category : "other",
    tags: (v.tags || []).filter((t) => TAGS.includes(t)).slice(0, 4),
    blurb: clipSentence(v.blurb, 140) || poi.name,
    quality_flag: [1, 2, 3].includes(v.quality_flag) ? v.quality_flag : 2,
    status: ["approved", "maybe", "flagged"].includes(v.status) ? v.status : "maybe",
  };
}

// --- Row assembly ------------------------------------------------------------
// Merge a raw POI + its label into a full curated row (ingest cols + verdict).
function toCuratedRow(poi, label) {
  return {
    name: poi.name,
    lat: poi.lat,
    lng: poi.lng,
    area: poi.area || poi.neighborhood || null,
    kind: poi.kind || "",
    lore: poi.lore || "",
    source: poi.source,
    source_url: poi.source_url || null,
    ext_id: poi.ext_id || poi.source_url || poi.name,
    category: label.category,
    tags: label.tags,
    blurb: label.blurb,
    quality_flag: label.quality_flag,
    status: label.status,
  };
}

// --- Main --------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const useLLM = hasRealKey();
  console.log(`\n  DayQuest POI labeler — backend: ${useLLM ? "Claude (LLM)" : "heuristic (no key)"}`);

  // Load input: DB pending rows, or a raw JSON file.
  let input;
  if (args.db) {
    if (!poidbConfigured) {
      console.error("  ✗ --db requested but Supabase isn't configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY).");
      process.exit(1);
    }
    console.log("  Reading `pending` rows from Supabase…");
    input = await queryPois({ status: "pending", limit: 1000 });
  } else {
    console.log(`  Reading ${args.in}…`);
    input = JSON.parse(readFileSync(args.in, "utf8"));
  }
  if (args.limit > 0) input = input.slice(0, args.limit);
  console.log(`  ${input.length} places to label.\n`);

  const client = useLLM ? new Anthropic() : null;
  const rows = [];
  const counts = { approved: 0, maybe: 0, flagged: 0 };
  for (let i = 0; i < input.length; i++) {
    const poi = input[i];
    let label;
    try {
      label = useLLM ? await llmLabel(client, poi) : heuristicLabel(poi);
    } catch (err) {
      console.warn(`  (label failed for "${poi.name}": ${err.message} — heuristic fallback)`);
      label = heuristicLabel(poi);
    }
    counts[label.status] = (counts[label.status] || 0) + 1;
    rows.push(toCuratedRow(poi, label));
    if ((i + 1) % 25 === 0 || i === input.length - 1) {
      process.stdout.write(`\r  labeled ${i + 1}/${input.length}`);
    }
  }
  console.log(`\n\n  Verdicts: ${counts.approved} approved · ${counts.maybe} maybe · ${counts.flagged} flagged`);

  // Write output: DB (curated upsert) or a *.gen.json file.
  if (args.db) {
    console.log("  Upserting curated rows to Supabase…");
    const res = await upsertCuratedPois(rows);
    console.log(`  ✓ upserted ${res.upserted} rows in ${res.batches} batch(es).`);
  } else {
    writeFileSync(args.out, JSON.stringify(rows, null, 2));
    console.log(`  ✓ wrote ${rows.length} labeled rows → ${args.out}`);
  }
}

main().catch((err) => {
  console.error("  ! labeler error:", err.message);
  process.exit(1);
});
