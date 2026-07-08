// Core quest-building logic, shared by the CLI (generate-quest.js) and the
// HTTP server (server.js). No printing here — this just returns the quest object.

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { gatherCandidates, haversine_m, candidateToPoiRow } from "./sources.js";
import { poidbConfigured, upsertPois } from "./poidb.js";

// --- Walkability / spread constraint (see UX-SPEC.md §4) ---------------------
// CHECKIN_RADIUS_M = 100 in the app → 200m-diameter arrival zones. Consecutive
// stops must clear 2× the radius (+margin) so arrival zones don't overlap and
// GPS arrival stays a real event. Ceiling protects the ~30-min ritual.
const MIN_STOP_SEP_M = 250; // floor between consecutive stops
const MAX_LOOP_M = 1500; // ceiling on total walked path (default / "quick")

// --- Quest MODE × SIZE presets (travel-scaled) -------------------------------
// A preset is keyed by (mode, size). WALK reproduces today's behaviour EXACTLY
// (pickSep=250, default 1500m gather radius) so existing walk quests stay
// byte-identical. BIKE raises the loop ceiling, widens the gather radius (so
// there ARE far-enough stops to reach), and — critically — raises pickSep, the
// TARGET consecutive-stop separation the greedy pick aims for. The hard
// MIN_STOP_SEP_M=250 FLOOR is unchanged in every mode (it's what spreadReport
// gates on); pickSep only pushes the preview pick to choose stops that are
// further apart, producing the "noticeably longer" bike loop. Stop counts are
// identical across modes per size (quick 3 / explore 5 / epic up to 8); epic
// scales the loop ceiling + gather radius up from explore while keeping the
// hard ≥250m spread floor.
//
// Fields per preset:
//   maxStops      — desired stop count (3 quick / 5 explore)
//   loopCeiling   — max total walked/ridden path (gates spread.ok)
//   loopRangeText — human range used in the AI prompt only
//   pickSep       — TARGET min separation the greedy preview pick aims for
//                   (>= the hard 250m floor; bike pushes stops further apart)
//   radius_m      — gather radius passed to gatherCandidates / each source
const MODE_SIZE_PRESETS = {
  walk: {
    quick: { maxStops: 3, loopCeiling: MAX_LOOP_M, loopRangeText: "~0.8–1.5km", pickSep: MIN_STOP_SEP_M, radius_m: 1500 },
    explore: { maxStops: 5, loopCeiling: 2200, loopRangeText: "~1.2–2.2km", pickSep: MIN_STOP_SEP_M, radius_m: 1500 },
    epic: { maxStops: 8, loopCeiling: 4000, loopRangeText: "~3–4km", pickSep: MIN_STOP_SEP_M, radius_m: 2500 },
  },
  bike: {
    quick: { maxStops: 3, loopCeiling: 4000, loopRangeText: "~2–4km", pickSep: 700, radius_m: 3500 },
    explore: { maxStops: 5, loopCeiling: 6000, loopRangeText: "~3–6km", pickSep: 700, radius_m: 5000 },
    epic: { maxStops: 8, loopCeiling: 10000, loopRangeText: "~6–10km", pickSep: 900, radius_m: 7000 },
  },
};
const DEFAULT_MODE = "walk";
const DEFAULT_SIZE = "quick";
const DEFAULT_DIFFICULTY = "hard";
// Map any incoming difficulty value to a known level; unknown/missing → hard.
// All four levels are EXPLICITLY whitelisted so an explicit ?difficulty=tricky
// (or easy) still resolves to itself — only missing/garbage collapses to the
// "hard" default. (Before the default flipped to hard, "tricky" worked only by
// falling through to the default; now it must be named or it'd become hard.)
// MUST stay in sync with server.js normDifficulty (mirrored, not imported — same
// reason as normSize/normMode: the cache key is computed server-side).
function normDifficulty(difficulty) {
  return difficulty === "easy" || difficulty === "tricky" || difficulty === "hard" || difficulty === "impossible"
    ? difficulty
    : DEFAULT_DIFFICULTY;
}
// Map any incoming mode value to a known preset row; unknown/missing → walk.
function normMode(mode) {
  return mode === "bike" ? "bike" : DEFAULT_MODE;
}
// Map any incoming size value to a known preset; unknown/missing → quick.
function normSize(size) {
  return size === "explore" || size === "epic" ? size : DEFAULT_SIZE;
}
// Resolve (mode, size) to a preset; unknown/missing collapse to walk/quick.
function presetFor(mode, size) {
  return MODE_SIZE_PRESETS[normMode(mode)][normSize(size)];
}

// Sum of consecutive stop-to-stop legs (NOT origin→stop1, NOT closed back to
// start) — matches §4's "total walked path" definition.
function legDistances(stops) {
  const legs = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1].place;
    const b = stops[i].place;
    legs.push(haversine_m(a.lat, a.lng, b.lat, b.lng));
  }
  return legs;
}

// A quest passes the spread gate if every consecutive leg ≥ floor and the
// total loop ≤ ceiling. The ceiling is per-call (size-dependent); defaults to
// the original MAX_LOOP_M so existing callers behave identically.
// Returns { ok, legs, total, minLeg }.
function spreadReport(stops, loopCeiling = MAX_LOOP_M) {
  const legs = legDistances(stops);
  const total = legs.reduce((s, d) => s + d, 0);
  const minLeg = legs.length ? Math.min(...legs) : 0;
  const ok = minLeg >= MIN_STOP_SEP_M && total <= loopCeiling;
  return { ok, legs, total, minLeg };
}

// --- Tiny .env loader (avoids a dotenv dependency) ---------------------------
export function loadEnv() {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const path = new URL("../.env", import.meta.url);
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env file — fine if the var is already set in the environment */
  }
}

// --- The curation brief: this is DayQuest's editorial voice ------------------
// Parameterised by quest size so the count + loop range stay truthful. The
// 3-stop "quick" wording is identical to the original.
// Per-difficulty guidance for the CLUE/HINT writing only. This is INJECTED into
// the system prompt and is strictly subordinate to the hard rules above it — it
// dials cleverness UP and hint-helpfulness DOWN, but it NEVER relaxes the GOLDEN
// CLUE RULE (no name), SAFE & FAIR (solvable from real observable features/given
// lore only — never an invented fact, never unsafe), or the tone filter. The
// "impossible" tier is "nearly impossible" = VERY HARD, not a trick with no
// answer: it must still be fair and solvable in principle.
function difficultyGuidance(difficulty) {
  switch (normDifficulty(difficulty)) {
    case "easy":
      return `DIFFICULTY: EASY. Keep the riddle SHORT but make it TRANSPARENT —
point almost directly at the most OBVIOUS observable feature (colour, shape, what
it's made of, what's right next to it) so it's easy to crack with little thought.
Still a tight, playful riddle, NOT a paragraph and NOT the name. The HINT should
all-but-give-it-away — point almost directly at the spot (still WITHOUT the name).
Keep it warm and confidence-building for a first-timer.`;
    case "hard":
      return `DIFFICULTY: HARD. Keep the riddle SHORT but make it OBLIQUE and
CRYPTIC — lean on wordplay, metaphor, and indirect reference so it takes real
thought to crack. Crypticness, NOT length: a few tight lines, never a paragraph.
Hint at an observable feature sidelong rather than naming it. Stay strictly
grounded in real observable features (never an invented fact). The HINT offers a
modest nudge — narrows the search but still makes them work for it.`;
    case "impossible":
      return `DIFFICULTY: NEARLY IMPOSSIBLE. Keep the riddle SHORT but make it
HIGHLY cryptic and lateral — obscure, oblique, minimal direct help, for hardcore
solvers who relish a fierce puzzle. Maximally cryptic, NOT long: still a few
tight lines, never a paragraph. CRITICAL FAIRNESS RULE (this OVERRIDES the
temptation to be unsolvable): "nearly impossible" means VERY HARD, NOT a trick
with no answer. The clue MUST remain fair and solvable IN PRINCIPLE, grounded
ONLY in the place's real, observable features — NEVER an invented fact, NEVER a
reference to something not provided, NEVER literally unanswerable, NEVER unsafe.
A determined solver standing nearby, reasoning hard from real detail, must be
ABLE to arrive at the right place. You may be maximally oblique and demand
lateral leaps, but every leap must land on a REAL clue. The HINT still barely
helps — one faint, oblique nudge — but it must NOT be useless, and it must NEVER
name the place.`;
    case "tricky":
    default:
      return `DIFFICULTY: TRICKY (default). Write a SHORT riddle of moderate
cleverness — a fun puzzle most people can solve: one step of inference between
the clue and the place, but not cryptic. A tight line or two hinting at one
observable feature with a light touch of wordplay — never a paragraph. The HINT
is genuinely helpful — clearly narrows it down (still no name).`;
  }
}

// Quest THEME filter. Only the shipped types are honoured; anything else (incl.
// "surprise") → null, i.e. today's mixed hunt. Kept deliberately small — new
// types ride the curated-DB work, not raw source-tag guessing.
function normType(type) {
  return type === "historic" || type === "barcrawl" ? type : null;
}

// Injected into the system prompt when a theme is chosen. This is SELECTION +
// TONE steering over the already-gathered real candidates — never an instruction
// to invent. If the theme's places are genuinely sparse nearby, the model still
// falls back to the best available (a themed hunt beats a failed one).
function themeGuidance(type) {
  switch (type) {
    case "historic":
      return `\n\nTHEME — HISTORIC: Build a HISTORY hunt. STRONGLY prefer the
storied and old: landmarks, monuments, memorials, plaques, ruins, historic
buildings, sites of real past events. Skip picks with no historical hook when a
storied option exists. Let the theme colour the intro and the post-find lore.`;
    case "barcrawl":
      return `\n\nTHEME — BAR CRAWL: Build a nightlife hunt. STRONGLY prefer bars,
pubs, taverns, breweries, cocktail lounges, and storied drinking spots; historic
or characterful watering holes are ideal. Keep the tone fun and social. Order
the stops as a sensible crawl. (Still a find-on-foot hunt — clues never name the
place.) If true bars are sparse, fall back to the liveliest social venues.`;
    default:
      return "";
  }
}

function systemPrompt(maxStops, loopRangeText, difficulty = DEFAULT_DIFFICULTY, type = null) {
  return `You are a warm, curious local guide who designs short walking
SCAVENGER HUNTS in the spirit of Atlas Obscura — favouring the storied, the
historic, the quietly strange: old libraries, fable-laden rivers, monuments,
ruins, public art, hidden gardens, quirky neighbourhood landmarks.

You are given a numbered list of REAL nearby places (with coordinates, distance,
and a snippet of real history), ALREADY RANKED so the most storied/unusual appear
first. Your job is to CURATE these into a fun, FAIR, SAFE hunt — not invent. For
each chosen place you write a CLUE that leads an explorer to FIND it on foot
WITHOUT naming it, an easier fallback HINT, and a small thematic collectible (a
"virtual item") they earn on finding it.

THE CLUE IS A SHORT, PUNCHY, PLAYFUL RIDDLE — think classic treasure-hunt riddle,
NOT a history lesson. Aim for ≤30 words, ideally 1–4 short lines (a couplet,
quatrain, or a crisp cryptic line or two). Be game-like, intriguing, a little
clever — wordplay, rhyme, and metaphor are welcome. Do NOT write a paragraph; do
NOT cram the place's history into the clue; do NOT spell out a long descriptive
sentence with the facts embedded. Lead with ONE or TWO observable features
rendered as a riddle. The rich history is the REWARD — it lives in the post-find
reveal (reason / lore_hook / description), shown only AFTER they find the place,
never in the clue itself.

Example of the voice to hit (illustrative, not a template): for a marble arch at
the foot of Fifth Avenue — "Where Fifth Avenue is born, a marble crown stands
tall — two figures guard the gate to the square. Pass beneath." Short, evocative,
riddle-like. THAT brevity and voice — at every difficulty.

CHOOSE THE MOST INTERESTING PLACES — this is the heart of DayQuest:
- The goal of every stop is the reaction "I never knew that was here" / "that's
  wild." Favour the storied, the quirky, the surprising, the secretly-historic:
  places with real lore in their snippet, public art, monuments, ruins,
  viewpoints, natural oddities, hidden or unusual landmarks.
- When a more interesting option exists, NEVER settle for a generic, mundane,
  forgettable pick — a plain park with no story, an ordinary patch of green, an
  anonymous "point of interest." Boring is the failure mode to avoid.
- The list is pre-ranked by interestingness (most storied/unusual first), so when
  you must choose between comparable stops, prefer the ones earlier in the list —
  but you still own VARIETY and the SPREAD/WALKABILITY constraints below; do not
  cluster, and don't pick several of the same kind just because they rank high.

Hard rules:
- Choose places ONLY from the list, by their integer id. Never invent a place.
- Pick up to ${maxStops} (and at least 3) that form a fun, walkable loop and
  offer VARIETY: at least 2 distinct place-types/micro-contexts (e.g. a park
  monument → a street-level façade → a tucked-away courtyard) — don't pick
  several of the same kind.
- SPREAD / WALKABILITY (this is load-bearing — a quest must feel like a walk,
  not standing in one square): consecutive stops should ideally be 300–600m
  apart, and NEVER closer than ~250m. The total walking loop (sum of the
  consecutive legs) should be ${loopRangeText} — about a 30–45 minute walk. Use
  the given coordinates/distances to judge this; reject clusters that ring a
  single plaza.
- HERO FIRST: choose the single most striking/iconic place as stop 1 (the
  payoff a first-time explorer hits first), then order the remaining stops into
  a sensible walking sequence.
- Drop anything that is not a visitable public spot a person can walk up to —
  e.g. administrative areas, neighbourhoods, schools, private property, whole
  districts, or a person/event with no physical site.
- SAFE & FAIR: a clue must be SOLVABLE on foot using only observable features,
  history, or lore you were actually given — never a fact you made up, never
  trivia an explorer couldn't see or reason out while standing nearby. NEVER
  send anyone somewhere unsafe, private, off-limits, or that requires trespass,
  climbing, or crossing traffic carelessly. Clues lead to the PUBLIC, walk-up
  face of the place.
- TONE / SENSITIVITY: DayQuest is a joyful adventure. NEVER choose a place that
  is DEFINED by tragedy, disaster, death, or atrocity — e.g. fatal fires, the
  site of a massacre, shooting, bombing, terror attack, riot, or any place
  remembered chiefly for mass death or suffering. Keep every quest light and
  positive. (A normal historic spot that merely mentions a long-ago event in
  passing is fine; what's barred is a site whose whole identity is a tragedy.)
- Only use history/lore that is supported by the provided snippet. If a place
  has no snippet, build the clue from generic OBSERVABLE features (its kind, its
  setting) and do NOT invent facts. You may add playful framing only if clearly
  marked as such ("Legend has it…").
- THE GOLDEN CLUE RULE: a clue and a hint must NEVER contain the place's name,
  or an unmistakable unique synonym of it. The name is the REWARD, revealed only
  AFTER the explorer finds the spot. Lead with what they can SEE, rendered as a
  short riddle — NOT the history, and NOT the label on the map. (The story is the
  post-find reveal, never the clue.) Compression is where a riddle can slip and
  accidentally name the place — stay vigilant when you tighten it.

CLUE DIFFICULTY (tunes ONLY how hard the clue/hint are to crack — it NEVER
overrides any hard rule above; the golden rule, SAFE & FAIR grounding, and the
tone filter ALWAYS hold at every level):
${difficultyGuidance(difficulty)}${themeGuidance(type)}`;
}

// Forced-tool output keeps the response strictly structured & SDK-version-robust.
// Parameterised by max stop count so "explore" can return up to 5 while "quick"
// keeps the original 3-stop schema wording.
function emitTool(maxStops) {
  return {
  name: "emit_quest",
  description: `Return the curated scavenger hunt (3 to ${maxStops} stops).`,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      theme: { type: "string", description: "A short, playful name for today's scavenger hunt." },
      intro: { type: "string", description: "One warm sentence to set the mood and frame the hunt." },
      stops: {
        type: "array",
        description: `Between 3 and ${maxStops} stops, in walking order.`,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "integer", description: "The id of the chosen place from the list." },
            order_index: { type: "integer", description: `Walking order, starting at 1 (1..${maxStops}).` },
            description: { type: "string", description: "REVEAL content (shown after the find): one plain sentence on what it is. Do NOT name the place here in a way that spoils the clue." },
            clue: { type: "string", description: "REQUIRED. A SHORT, PUNCHY, PLAYFUL RIDDLE (≤~30 words, ideally 1–4 short lines) that leads the explorer to FIND this real place on foot by hinting at ONE or TWO OBSERVABLE features. Treasure-hunt riddle voice — wordplay/rhyme/metaphor welcome — NOT a paragraph and NOT a history lesson. Keep history OUT of the clue (it belongs in the reveal: lore_hook/reason/description). MUST NEVER contain the place's name (the name is revealed only after they find it)." },
            hint: { type: "string", description: "REQUIRED. One easier fallback hint for someone stuck — narrows it down further but still does NOT name the place outright." },
            virtual_item: { type: "string", description: "REQUIRED. A small thematic collectible earned on finding this place: a leading emoji + a short name, tied to the place's character (e.g. \"🕯️ Ghostlight Lantern\", \"⚓ Harbor Token\")." },
            reason: { type: "string", description: "REVEAL content (shown after the find): one sentence on why it's worth a look." },
            lore_hook: { type: "string", description: "REVEAL content (shown after the find): the rich story/fable/history — the post-find payoff (\"here's the story behind it\"), grounded in the snippet. This is where the history that was kept OUT of the clue lives. Empty if no snippet. May name the place freely — it's revealed here." },
            quest_type: { type: "string", enum: ["photo", "find"], description: "\"find\" for a pure scavenger find, or \"photo\" if a photo bonus is offered." },
            quest_prompt: { type: "string", description: "OPTIONAL post-find photo bonus (\"snap it now that you've found it\") — a fun, observable detail. Not required to advance." },
          },
          required: ["id", "order_index", "description", "clue", "hint", "virtual_item", "reason", "lore_hook", "quest_type"],
        },
      },
    },
    required: ["theme", "intro", "stops"],
  },
  };
}

function buildUserPrompt(candidates, label, maxStops = 3) {
  const lines = candidates.map(
    (c, i) =>
      `[${i}] ${c.name}${c.kind ? ` — ${c.kind}` : ""} — ${c.distance_m}m away\n` +
      `     ${c.lore ? c.lore : "(no history snippet available)"}`
  );
  const count = maxStops > 3 ? `${3}–${maxStops}-stop` : "3-stop";
  return (
    `Origin: ${label}\n\n` +
    `Nearby real places:\n${lines.join("\n\n")}\n\n` +
    `Design today's ${count} DayQuest scavenger hunt: for each chosen place ` +
    `write a SHORT, punchy riddle-clue (a few lines, not a paragraph) that leads ` +
    `the explorer to FIND it without naming it — keep the history for the reveal — ` +
    `plus an easier fallback hint and a thematic collectible. Refer to places by their [id].`
  );
}

/**
 * Build a quest for a location.
 * - With an ANTHROPIC_API_KEY: Claude curates and writes the quest (AI mode).
 * - Without a key (or PREVIEW=1): a free, no-AI "preview" with templated quests
 *   built from the same real Wikipedia/OSM data.
 * Throws only on TOO_FEW nearby places.
 * @returns { theme, intro, origin, stops: [{ ...narrative, place }], meta }
 */
export async function buildQuest(lat, lng, label = `${lat}, ${lng}`, opts = {}) {
  // Travel mode ("walk" default / "bike") × size ("quick" default / "explore").
  // Unknown values fall back to walk/quick so old callers and bad input behave
  // identically. The preset carries stop count, loop ceiling, the preview pick's
  // target separation (pickSep), and the gather radius.
  const preset = presetFor(opts.mode, opts.size);
  let { maxStops, loopCeiling, loopRangeText, pickSep, radius_m } = preset;

  // Distance override from the Settings "how far to roam" chip (meters). Clamp to
  // a sane band, then scale the loop ceiling WITH it — the spread gate caps total
  // loop length, so a wider gather with the preset's small ceiling would be
  // rejected. Omitted → preset defaults, so the simple path is unchanged.
  if (Number.isFinite(opts.radius) && opts.radius > 0) {
    radius_m = Math.max(500, Math.min(8000, Math.round(opts.radius)));
    loopCeiling = Math.max(loopCeiling, Math.round(radius_m * 2.2));
    loopRangeText = `up to ~${(loopCeiling / 1000).toFixed(1)}km`;
  }

  // Theme filter ("historic" | "barcrawl" | undefined). Steers the model's stop
  // selection + narrative tone via the system prompt. undefined = today's mixed
  // "surprise" hunt. Live candidate data (OSM/Wikipedia/Places) already carries
  // the relevant places; the prompt biases WHICH get chosen.
  const type = normType(opts.type);

  // Clue DIFFICULTY ("tricky" default | easy | hard | impossible). Unknown/missing
  // → tricky. Tunes ONLY how hard the clue/hint are to solve (injected into the
  // system prompt); it leaves spread/size/mode/exclude and every hard rule intact.
  const difficulty = normDifficulty(opts.difficulty);

  // Anti-repeat: a set of place keys the caller has already visited. A key is a
  // candidate's source_url (preferred) OR its name. Filtered out BELOW so the
  // user gets fresh stops on a returning quest. Default empty (first-timers).
  const excludeSet = opts.exclude instanceof Set ? opts.exclude : new Set();
  const excluded = (c) => excludeSet.has(c.source_url) || excludeSet.has(c.name);

  // Treat a missing OR placeholder key as "no key" so preview mode kicks in.
  const key = process.env.ANTHROPIC_API_KEY;
  const looksReal = key && key.startsWith("sk-ant-") && !key.includes("...") && key.length > 40;
  const preview = !looksReal || process.env.PREVIEW === "1";

  // D-022 sensitivity gate + anti-repeat exclude: drop tragedy/disaster-defined
  // places AND any place the user has already visited from the pool BEFORE
  // anything else, so neither path (AI prompt nor preview) can serve them.
  // Filtering here (not in the source) keeps the data intact while making the
  // candidate list — and the [id] join the AI path relies on — consistent.
  // Bike's wider radius_m is threaded into gatherCandidates so far-enough stops
  // exist to fill the larger loop.
  // `area` (label) scopes the curated-DB source AND stamps write-through rows, so
  // read and write agree on the Area key.
  const gathered = await gatherCandidates(lat, lng, { radius_m, area: label });

  // WRITE-THROUGH: grow the POI DB with everything we just surfaced (minus the
  // sensitivity-gated), independent of THIS user's per-quest exclude — so the
  // curated pool accumulates from real usage. Fire-and-forget: a DB write never
  // blocks or fails a quest. No-op unless Supabase is configured. New rows land
  // as `pending` (curation columns/status untouched), so they don't feed quests
  // until a curator approves them.
  if (poidbConfigured) {
    const rows = gathered
      .filter((c) => !isSensitive(c))
      .map((c) => candidateToPoiRow(c, label));
    if (rows.length) {
      upsertPois(rows)
        .then((r) => console.log(`  (poi DB: upserted ${r.upserted} rows for ${label})`))
        .catch((err) => console.warn(`  (poi DB write skipped: ${err.message})`));
    }
  }

  let candidates = gathered.filter((c) => !isSensitive(c) && !excluded(c));

  // Too-few fallback: if exclude (or a sparse area) drops the pool below the
  // 3-stop minimum, re-gather ONCE with a wider radius and re-apply both filters
  // before giving up. Graceful — never crashes, never silently repeats a place.
  if (candidates.length < 3) {
    const wider = await gatherCandidates(lat, lng, { radius_m: Math.max(radius_m * 2, 6000) });
    candidates = wider.filter((c) => !isSensitive(c) && !excluded(c));
  }
  if (candidates.length < 3) {
    const e = new Error("Not enough nearby places to build a quest here.");
    e.code = "TOO_FEW";
    throw e;
  }

  // CHANGE 2: surface the storied/quirky/surprising candidates FIRST. Sort the
  // canonical array in place (after the too-few fallback) so BOTH paths read the
  // same interest-ordered pool: the AI prompt enumerates it by index and joins
  // chosen ids back to candidates[id]; pickVaried iterates the pool in order. We
  // SORT, never filter — sparse areas keep every generic fallback, just ranked
  // below the interesting ones, so spread/area constraints are untouched.
  sortByInterest(candidates);

  if (preview) return templatedQuest(lat, lng, label, candidates, preset, difficulty);

  const client = new Anthropic();

  // Forced-tool + id-join assembly: one model call → an authoritative-coords
  // quest. Anti-hallucination (ids only, joined back to real records) is intact.
  async function assemble() {
    const resp = await client.messages.create({
      // Configurable via DAYQUEST_MODEL; defaults to the cheaper Sonnet tier for
      // dev/validation. Flip to "claude-opus-4-8" via env to spend on quality.
      model: process.env.DAYQUEST_MODEL || "claude-sonnet-4-6",
      max_tokens: 4000,
      system: systemPrompt(maxStops, loopRangeText, difficulty, type),
      tools: [emitTool(maxStops)],
      tool_choice: { type: "tool", name: "emit_quest" },
      messages: [{ role: "user", content: buildUserPrompt(candidates, label, maxStops) }],
    });

    const block = resp.content.find((b) => b.type === "tool_use");
    if (!block) throw new Error("Model did not return a structured quest.");

    // Join the chosen ids back to the authoritative records (anti-hallucination).
    const stops = [];
    for (const s of block.input.stops) {
      const place = candidates[s.id];
      if (!place) continue; // model referenced a non-existent id — drop it
      stops.push({ ...s, place });
    }
    // Trust the model's hero-first walking order (order_index); don't reorder.
    stops.sort((a, b) => a.order_index - b.order_index);
    // Defensive cap: if the model over-returns, keep the first maxStops (already
    // in walking order). "quick" stays at 3, so its behaviour is unchanged.
    if (stops.length > maxStops) stops.length = maxStops;

    return { theme: block.input.theme, intro: block.input.intro, stops };
  }

  // Post-validate spread on REAL coords; bounded retry; keep best on failure.
  // "Best" = passes the loop ceiling and has the largest minimum consecutive
  // gap (so we fall back to the most walkable candidate, not the most clustered).
  // Ceiling is size-dependent (loopCeiling) for both the gate and the ranking.
  // The first assemble() almost always passes the spread gate; extra retries
  // cost the most time for the least gain. Cap at 1 retry (worst case 2 Claude
  // calls, not 4). The "keep best-spread candidate" fallback below still runs,
  // so a rare gate-miss degrades gracefully rather than regressing quality.
  const MAX_RETRIES = 1;
  let best = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const candidate = await assemble();
    const rep = spreadReport(candidate.stops, loopCeiling);
    if (rep.ok) {
      best = { candidate, rep };
      break;
    }
    const better =
      !best ||
      (rep.total <= loopCeiling && best.rep.total > loopCeiling) ||
      (rep.total <= loopCeiling === best.rep.total <= loopCeiling &&
        rep.minLeg > best.rep.minLeg);
    if (better) best = { candidate, rep };
  }

  if (!best.rep.ok) {
    console.warn(
      `  (spread gate not met after ${MAX_RETRIES} retries — keeping best candidate: ` +
        `legs ${best.rep.legs.join("m, ")}m, loop ${best.rep.total}m)`
    );
  }

  return {
    theme: best.candidate.theme,
    intro: best.candidate.intro,
    origin: { lat, lng, label },
    stops: best.candidate.stops,
    meta: {
      mode: "ai",
      difficulty,
      candidate_count: candidates.length,
      spread: { ok: best.rep.ok, legs_m: best.rep.legs, loop_m: best.rep.total },
    },
  };
}

// --- Sensitivity guardrail (CEO decision D-022) ------------------------------
// DayQuest is a joyful adventure app: quests must NEVER serve places DEFINED by
// tragedy/disaster/mass-death/atrocity (e.g. "Triangle Shirtwaist Factory fire",
// 146 deaths). We do NOT delete such places from the data — they're just never
// chosen as a quest stop. This is the ONE shared filter used by BOTH the AI path
// (buildQuest, before the prompt) and the preview path (pickVaried) so the two
// can never drift apart.
//
// Name vs lore use DIFFERENT breadth on purpose:
// - NAME is broad: a place literally *named* "...fire/massacre/shooting" is
//   defined by that tragedy, so we exclude on the catch-all vocabulary.
// - LORE is high-precision: a normal historic place's intro often mentions a
//   fire/battle/uprising in passing ("burned in 1840 and was rebuilt"; Stonewall
//   Inn's lore names the 1969 "riots"). Matching those generic singletons in
//   lore would wrongly exclude landmarks, so lore only triggers on unambiguous
//   mass-death/atrocity terms.
const TRAGEDY_NAME =
  /\b(massacre|disaster|catastrophe|fire|wildfire|riot|shooting|bombing|bombed|terror|terrorist|atrocity|lynching|genocide|holocaust|pogrom|killings?|deaths?|fatalities|victims?|tragedy|explosion|sinking|wreck|famine|plague)\b|9\/11/i;

// Lore: only unambiguous mass-death / atrocity language. Deliberately omits the
// generic singletons (fire, riot, attack, battle, burning, uprising, siege) that
// pepper ordinary historic lore.
// Note: bare "death(s)" is NOT a trigger — ordinary historic lore says things
// like "after the death of its founder." We require mass/violent framing: a
// death/fatality COUNT, or "mass death", or unambiguous atrocity nouns.
const TRAGEDY_LORE =
  /\b(massacre|massacred|atrocity|atrocities|lynching|lynched|genocide|holocaust|pogrom|terrorist attack|fatal fire|deadliest|mass shooting|mass death)\b|\b\d[\d,]*\s+(?:people\s+)?(?:were\s+)?(?:killed|died|perished|dead|deaths?|fatalities|casualties|victims?)\b|\b(?:killed|claimed)\s+(?:more than\s+|over\s+|some\s+|nearly\s+|an estimated\s+)?\d[\d,]*\b|9\/11/i;

/**
 * Shared sensitivity gate (D-022). True if a candidate place is DEFINED by
 * tragedy/disaster/mass-death/atrocity and must NOT be served in a quest.
 * Tolerates missing kind/lore (so bare {name} records are safe to test).
 * @param {{name?: string, kind?: string, lore?: string}} c
 */
export function isSensitive(c) {
  const name = `${c?.name || ""} ${c?.kind || ""}`;
  if (TRAGEDY_NAME.test(name)) return true;
  if (c?.lore && TRAGEDY_LORE.test(c.lore)) return true;
  return false;
}

// --- Interestingness scoring (CHANGE 2) --------------------------------------
// Bias the candidate pool toward the storied / quirky / surprising BEFORE the AI
// or preview picker sees it, so "I never knew that was here" beats "a plain park
// with no story". This SORTS (never filters) the canonical `candidates` array in
// place, so sparse areas keep their generic fallbacks — they just sink below the
// interesting ones. Both downstream paths read this same ordering: the AI prompt
// enumerates `candidates` by index (interesting surfaced first) and pickVaried
// iterates the pool in order (so its greedy passes reach for the quirky first).
//
// Score = lore bonus (a real Wikipedia snippet → storied) + kind bonus (historic,
// public art, monument, ruins, viewpoint, natural oddity, …) − a small generic
// penalty for a plain park/garden with NO story. Distance is the tiebreaker so we
// don't surface a far-flung oddity that blows the loop ceiling over a near one.
const INTERESTING_KIND =
  /\b(historic|heritage|monument|memorial|statue|sculpture|public art|artwork|mural|ruins?|castle|tower|fort|archaeolog|viewpoint|lookout|observation|landmark|attraction|shrine|temple|chapel|cathedral|abbey|lighthouse|windmill|obelisk|fountain|spring|waterfall|cave|grotto|gorge|peak|volcano|geyser|curio|quirk|oddit|unusual|folly|grave|crypt|catacomb)\b/i;
const GENERIC_KIND = /\b(park|garden|playground|recreation|green|pitch|field)\b/i;

// Pure, exported for unit testing. Higher = more interesting (surfaced first).
export function interestScore(c) {
  let score = 0;
  const hasLore = !!(c.lore && c.lore.trim());
  if (hasLore) score += 3; // a real story is the strongest "interesting" signal
  const kind = `${c.kind || ""} ${c.name || ""}`;
  if (INTERESTING_KIND.test(kind)) score += 2; // storied/quirky place-type
  // Penalise a plain green space that brings NO story to the table (a bare park
  // with no lore is the canonical "generic" pick). A park WITH lore keeps its
  // lore bonus — only the story-less ones are pushed down.
  if (!hasLore && GENERIC_KIND.test(kind) && !INTERESTING_KIND.test(kind)) score -= 2;
  return score;
}

// Sort candidates in place: interest DESC, then nearest (distance) ASC as the
// tiebreaker so the loop stays tight. Stable-enough for our needs (Array.sort).
function sortByInterest(candidates) {
  candidates.sort((a, b) => {
    const d = interestScore(b) - interestScore(a);
    if (d !== 0) return d;
    return (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity);
  });
  return candidates;
}

function bucketOf(c) {
  const k = (c.kind || "").toLowerCase();
  const n = c.name.toLowerCase();
  if (/park|garden|nature reserve/.test(k) || /\bpark\b|\bgardens?\b|\bsquare\b/.test(n)) return "green";
  if (/art|statue|sculpture|monument|memorial/.test(k) || /statue|memorial|monument/.test(n)) return "art";
  if (/natural|spring|waterfall/.test(k) || /river|pond|lake|fountain|creek/.test(n)) return "water";
  if (/historic/.test(k)) return "historic";
  return "other";
}

// True if `c` clears the target separation against every already-picked stop,
// so arrival zones never overlap (UX-SPEC.md §4). `sep` is the TARGET min gap:
// MIN_STOP_SEP_M for walk, larger for bike so stops sit further apart and the
// loop comes out noticeably longer. The hard 250m FLOOR is still enforced by
// spreadReport — sep only steers the greedy pick (passes 1 & 2). Pass 3's
// minimum-fill fallback ignores sep entirely (see pickVaried).
function farEnough(c, picked, sep = MIN_STOP_SEP_M) {
  return picked.every((p) => haversine_m(c.lat, c.lng, p.lat, p.lng) >= sep);
}

// Greedy pick: nearest place from each distinct bucket first, then fill —
// always honouring the ≥250m separation floor so the quest actually walks.
// `target` is the desired stop count (3 for quick, up to 5 for explore).
//
// The floor-ignoring fallback (pass 3) ONLY tops up to the 3-stop MINIMUM, never
// past it: a quest must have 3 stops even in a sparse area, but "explore"'s 4th
// and 5th stops are strictly optional and admitted ONLY if they clear the floor.
// So explore degrades to a clean 3/4 rather than padding to 5 with overlapping
// (sub-250m) stops — honouring the spread invariant for the extra stops.
const MIN_STOPS = 3;
// Exported for deterministic unit testing of the (target, sep) selection across
// mode×size without depending on flaky live data sources. Pure function.
export function pickVaried(candidates, target = 3, sep = MIN_STOP_SEP_M) {
  const usable = candidates.filter((c) => !isSensitive(c));
  const pool = usable.length >= MIN_STOPS ? usable : candidates;
  const picked = [];
  const buckets = new Set();
  // Pass 1: one nearest place per distinct bucket, far enough from prior picks
  // (target separation `sep` — larger for bike so the loop spreads out).
  for (const c of pool) {
    if (picked.length >= target) break;
    const b = bucketOf(c);
    if (!buckets.has(b) && farEnough(c, picked, sep)) { picked.push(c); buckets.add(b); }
  }
  // Pass 2: fill remaining slots with any place that still clears the target sep.
  for (const c of pool) {
    if (picked.length >= target) break;
    if (!picked.includes(c) && farEnough(c, picked, sep)) picked.push(c);
  }
  // Pass 3: graceful fallback — only to reach the 3-stop MINIMUM (so sparse
  // areas still get a quest). Stops beyond #3 are never padded below the floor.
  for (const c of pool) {
    if (picked.length >= MIN_STOPS) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked.slice(0, target);
}

// Order chosen stops into a sensible walking sequence: start at the stop
// closest to the origin, then nearest-neighbour. (Once the ≥250m floor holds
// pairwise, any order clears the floor; ordering just minimises the loop.)
function orderForWalk(chosen, lat, lng) {
  const remaining = [...chosen];
  const route = [];
  let cur = { lat, lng };
  while (remaining.length) {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine_m(cur.lat, cur.lng, remaining[i].lat, remaining[i].lng);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    cur = remaining[bestI];
    route.push(remaining.splice(bestI, 1)[0]);
  }
  return route;
}

const REASON = {
  green: "A pocket of green to slow down in.",
  art: "A piece of public art most people walk right past.",
  water: "A bit of waterside calm in the middle of the city.",
  historic: "A little piece of history hiding in plain sight.",
  other: "A neighbourhood spot worth pausing at.",
};

function questPrompt(bucket, name) {
  switch (bucket) {
    case "green": return "Find the most photogenic tree, bench, or view here and snap it.";
    case "art": return `Photograph ${name} from its most flattering angle.`;
    case "water": return "Frame the water in a photo — catch a reflection if you can.";
    case "historic": return "Get a photo of the oldest detail you can spot here.";
    default: return `Take a photo that captures what makes ${name} interesting.`;
  }
}

// --- Preview (keyless) scavenger-hunt generators -----------------------------
// These build a clue / hint / virtual item WITHOUT ever using the place's name.
// They lean only on the bucket (green/art/water/historic/other) — generic,
// OBSERVABLE framing — so the keyless path never leaks the name into the clue.
// (Raw lore is deliberately NOT used for the clue: a Wikipedia snippet almost
// always leads with the place's name, which would defeat the hunt.)

// A SHORT, punchy riddle that points at the TYPE of place by what you'd see,
// never its name. Stays solvable on foot (it describes an observable category
// nearby). Difficulty shifts ONLY crypticness, NEVER length: every level emits a
// tight 1–2 line riddle. Easy is the most transparent riddle for the bucket;
// hard/impossible pick a more oblique riddle for the SAME bucket. The keyless
// path has no real lore, so it can't get genuinely lore-cryptic — it just leans
// harder on metaphor as difficulty rises. NO trailing "(Easy)…" sentences, no
// appended nudges: keeping it a riddle at every tier is the whole point.
function previewClue(bucket, difficulty = DEFAULT_DIFFICULTY) {
  const variants = PREVIEW_CLUES[bucket] || PREVIEW_CLUES.other;
  // easy → transparent, tricky → moderate, hard/impossible → cryptic. Each is a
  // standalone short riddle; difficulty only swaps obliqueness, not length.
  switch (normDifficulty(difficulty)) {
    case "easy": return variants.easy;
    case "hard":
    case "impossible": return variants.cryptic;
    case "tricky":
    default: return variants.tricky;
  }
}

// Short bucket riddles at three crypticness tiers (easy / tricky / cryptic). Each
// is name-free, observable-grounded, and ≤~25 words / 1–2 lines — a riddle, not a
// description. hard + impossible both use `cryptic` (the keyless path has no lore
// to go deeper on; obliqueness is its ceiling).
const PREVIEW_CLUES = {
  green: {
    easy: "Trees, a bench, a patch of open sky — find the green breath the city takes nearby.",
    tricky: "Where pavement yields to root and leaf, find the quiet the block keeps for relief.",
    cryptic: "Seek the lung that has no wall, the calm the concrete cannot swallow.",
  },
  art: {
    easy: "Something was made just to be seen — find the still figure most folk walk past.",
    tricky: "Made to be looked at, it never looks back — find what stands where stories and pavement meet.",
    cryptic: "It poses for no one yet draws every eye — find the silent maker's mark passers-by deny.",
  },
  water: {
    easy: "Follow the glint — find where the city meets a ripple or a pool.",
    tricky: "Where the ground turns to mirror and murmur, find what flows or gathers below.",
    cryptic: "Seek the restless mirror that runs but never tires — lowest, brightest, never still.",
  },
  historic: {
    easy: "Find the oldest face on the block — weathered stone, a carved date, time still showing.",
    tricky: "Hunt the spot that wears its years — a date, a worn detail the new streets forgot.",
    cryptic: "Where the old town still shows its bones, find the face that outlived every neighbour.",
  },
  other: {
    easy: "Find the spot locals pass daily and visitors miss — the quiet landmark hiding in plain sight.",
    tricky: "Hiding in plain sight, known to locals, missed by the rest — find the corner everyone walks past.",
    cryptic: "Seek the open secret: famous to the near, invisible to the passing — follow the worn path to it.",
  },
};

// An easier fallback — narrows the search by setting/feature, still no name.
// Difficulty scales the hint INVERSELY (matching the AI path): easy hands the
// search over almost completely; impossible offers only a faint nudge. Never the
// name at any level.
function previewHint(bucket, difficulty = DEFAULT_DIFFICULTY) {
  const base = previewHintBase(bucket);
  switch (normDifficulty(difficulty)) {
    case "easy":
      return `${base} You're practically on top of it — just look around.`;
    case "hard":
      return `A faint nudge: ${base}`;
    case "impossible":
      return `Barely a hint: ${base} That's all you get.`;
    case "tricky":
    default:
      return base;
  }
}

function previewHintBase(bucket) {
  switch (bucket) {
    case "green": return "Head for the leafiest corner around — you'll know it by the trees and somewhere to sit.";
    case "art": return "Look up and around at eye level for something deliberately placed — a statue, sculpture, or marker.";
    case "water": return "Aim for the lowest, wettest edge of the area — wherever water gathers or flows.";
    case "historic": return "Find the oldest-looking façade or structure on the block and step up to it.";
    default: return "It's the most photographed or talked-about spot in a couple of blocks — follow the foot traffic.";
  }
}

// A small thematic collectible: leading emoji + short name, tied to bucket.
function previewItem(bucket) {
  switch (bucket) {
    case "green": return "🌳 Ancient Acorn";
    case "art": return "🎨 Hidden Masterpiece Token";
    case "water": return "💧 Reflecting Drop";
    case "historic": return "📜 Timeworn Seal";
    default: return "🗺️ Explorer's Mark";
  }
}

function firstSentence(text, max = 160) {
  if (!text) return "";
  const s = text.split(/(?<=\.)\s/)[0];
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, "") + "…" : s;
}

function templatedQuest(lat, lng, label, candidates, preset = MODE_SIZE_PRESETS[DEFAULT_MODE][DEFAULT_SIZE], difficulty = DEFAULT_DIFFICULTY) {
  const { maxStops, loopCeiling, pickSep = MIN_STOP_SEP_M } = preset;
  const diff = normDifficulty(difficulty);
  const chosen = orderForWalk(pickVaried(candidates, maxStops, pickSep), lat, lng);
  const stops = chosen.map((place, i) => {
    const bucket = bucketOf(place);
    return {
      id: candidates.indexOf(place),
      order_index: i + 1,
      // REVEAL content (shown after the find). Generic, name-free framing.
      description: place.kind ? `A ${place.kind} in the neighbourhood.` : "A local landmark worth a look.",
      // Scavenger-hunt fields — clue/hint NEVER reference place.name (the name is
      // reveal-only); they're built from the bucket so the keyless path is safe.
      clue: previewClue(bucket, diff),
      hint: previewHint(bucket, diff),
      virtual_item: previewItem(bucket),
      // REVEAL content (shown after the find). reason + lore_hook may name the
      // place; lore_hook carries the real Wikipedia snippet (name allowed here).
      reason: REASON[bucket],
      lore_hook: place.lore ? firstSentence(place.lore, 220) : "",
      // "find" with an OPTIONAL post-find photo bonus (not required to advance).
      quest_type: "find",
      quest_prompt: questPrompt(bucket, place.name),
      place,
    };
  });

  // "Up to N" is a soft max: drop trailing (farthest) optional stops while the
  // walked loop exceeds the size ceiling, so a sparse-area explore stays a real
  // ~2km walk rather than a 3km+ trek. Never drops below the 3-stop minimum.
  // orderForWalk is nearest-neighbour from origin, so the tail is the longest
  // leg; trimming it keeps order_index contiguous. At target=3 (quick) there are
  // no optional stops, so this never fires — quick stays byte-identical.
  while (stops.length > MIN_STOPS && spreadReport(stops, loopCeiling).total > loopCeiling) {
    stops.pop();
  }

  const rep = spreadReport(stops, loopCeiling);
  return {
    theme: "A Little Local Scavenger Hunt",
    intro: stops.length === 3
      ? "Three hidden spots to track down on a short walk. Solve each clue, find the place, claim your collectible. Ready to hunt?"
      : `${stops.length} hidden spots to track down on a short walk. Solve each clue, find the place, claim your collectible. Ready to hunt?`,
    origin: { lat, lng, label },
    stops,
    meta: {
      mode: "preview",
      difficulty: diff,
      candidate_count: candidates.length,
      spread: { ok: rep.ok, legs_m: rep.legs, loop_m: rep.total },
    },
  };
}
