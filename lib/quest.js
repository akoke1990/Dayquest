// Core quest-building logic, shared by the CLI (generate-quest.js) and the
// HTTP server (server.js). No printing here — this just returns the quest object.

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { gatherCandidates, haversine_m } from "./sources.js";

// --- Walkability / spread constraint (see UX-SPEC.md §4) ---------------------
// CHECKIN_RADIUS_M = 100 in the app → 200m-diameter arrival zones. Consecutive
// stops must clear 2× the radius (+margin) so arrival zones don't overlap and
// GPS arrival stays a real event. Ceiling protects the ~30-min ritual.
const MIN_STOP_SEP_M = 250; // floor between consecutive stops
const MAX_LOOP_M = 1500; // ceiling on total walked path (default / "quick")

// --- Quest SIZE presets (walk-scaled) ----------------------------------------
// "quick" reproduces today's behaviour EXACTLY (3 stops, ~0.8-1.5km loop). The
// >=250m spread floor is preserved for both; "explore" only raises the stop
// count and the loop ceiling modestly so it stays a real walk, not a hike.
const SIZE_PRESETS = {
  quick: { maxStops: 3, loopCeiling: MAX_LOOP_M, loopRangeText: "~0.8–1.5km" },
  explore: { maxStops: 5, loopCeiling: 2200, loopRangeText: "~1.2–2.2km" },
};
const DEFAULT_SIZE = "quick";
// Map any incoming size value to a known preset; unknown/missing → quick.
function presetFor(size) {
  return SIZE_PRESETS[size] || SIZE_PRESETS[DEFAULT_SIZE];
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
function systemPrompt(maxStops, loopRangeText) {
  return `You are a warm, curious local guide who designs short walking
scavenger hunts in the spirit of Atlas Obscura — favouring the storied, the
historic, the quietly strange: old libraries, fable-laden rivers, monuments,
ruins, public art, hidden gardens, quirky neighbourhood landmarks.

You are given a numbered list of REAL nearby places (with coordinates, distance,
and a snippet of real history). Your job is to CURATE, not invent.

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
- TONE / SENSITIVITY: DayQuest is a joyful adventure. NEVER choose a place that
  is DEFINED by tragedy, disaster, death, or atrocity — e.g. fatal fires, the
  site of a massacre, shooting, bombing, terror attack, riot, or any place
  remembered chiefly for mass death or suffering. Keep every quest light and
  positive. (A normal historic spot that merely mentions a long-ago event in
  passing is fine; what's barred is a site whose whole identity is a tragedy.)
- Only state history/lore that is supported by the provided snippet. If a place
  has no snippet, keep its description generic ("worth a look because…") and do
  NOT invent facts. You may add playful framing only if clearly marked as such
  ("Legend has it…").
- Each quest is a short PHOTO challenge: ask the explorer to photograph a
  specific, real, observable detail of that place (doable on foot in a minute).`;
}

// Forced-tool output keeps the response strictly structured & SDK-version-robust.
// Parameterised by max stop count so "explore" can return up to 5 while "quick"
// keeps the original 3-stop schema wording.
function emitTool(maxStops) {
  return {
  name: "emit_quest",
  description: `Return the curated walking quest (3 to ${maxStops} stops).`,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      theme: { type: "string", description: "A short, playful name for today's quest." },
      intro: { type: "string", description: "One warm sentence to set the mood." },
      stops: {
        type: "array",
        description: `Between 3 and ${maxStops} stops, in walking order.`,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "integer", description: "The id of the chosen place from the list." },
            order_index: { type: "integer", description: `Walking order, starting at 1 (1..${maxStops}).` },
            description: { type: "string", description: "One sentence on what it is." },
            reason: { type: "string", description: "One sentence on why it's worth a look." },
            lore_hook: { type: "string", description: "The story/fable, grounded in the snippet. Empty if no snippet." },
            quest_type: { type: "string", enum: ["photo"], description: "Always \"photo\" for the MVP." },
            quest_prompt: { type: "string", description: "A fun photo challenge tied to a real, observable detail of this place." },
          },
          required: ["id", "order_index", "description", "reason", "lore_hook", "quest_type", "quest_prompt"],
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
    `Design today's ${count} DayQuest. Refer to places by their [id].`
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
  // Walk-scaled size: "quick" (default, 3 stops) or "explore" (up to 5). Unknown
  // values fall back to quick so old callers and bad input behave identically.
  const preset = presetFor(opts.size);
  const { maxStops, loopCeiling, loopRangeText } = preset;

  // Treat a missing OR placeholder key as "no key" so preview mode kicks in.
  const key = process.env.ANTHROPIC_API_KEY;
  const looksReal = key && key.startsWith("sk-ant-") && !key.includes("...") && key.length > 40;
  const preview = !looksReal || process.env.PREVIEW === "1";

  // D-022 sensitivity gate: drop tragedy/disaster-defined places from the pool
  // BEFORE anything else, so neither path (AI prompt nor preview) can ever serve
  // them. Filtering here (not in the source) keeps the data intact while making
  // the candidate list — and the [id] join the AI path relies on — consistent.
  const candidates = (await gatherCandidates(lat, lng)).filter((c) => !isSensitive(c));
  if (candidates.length < 3) {
    const e = new Error("Not enough nearby places to build a quest here.");
    e.code = "TOO_FEW";
    throw e;
  }

  if (preview) return templatedQuest(lat, lng, label, candidates, preset);

  const client = new Anthropic();

  // Forced-tool + id-join assembly: one model call → an authoritative-coords
  // quest. Anti-hallucination (ids only, joined back to real records) is intact.
  async function assemble() {
    const resp = await client.messages.create({
      // Configurable via DAYQUEST_MODEL; defaults to the cheaper Sonnet tier for
      // dev/validation. Flip to "claude-opus-4-8" via env to spend on quality.
      model: process.env.DAYQUEST_MODEL || "claude-sonnet-4-6",
      max_tokens: 4000,
      system: systemPrompt(maxStops, loopRangeText),
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
  const MAX_RETRIES = 3;
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

function bucketOf(c) {
  const k = (c.kind || "").toLowerCase();
  const n = c.name.toLowerCase();
  if (/park|garden|nature reserve/.test(k) || /\bpark\b|\bgardens?\b|\bsquare\b/.test(n)) return "green";
  if (/art|statue|sculpture|monument|memorial/.test(k) || /statue|memorial|monument/.test(n)) return "art";
  if (/natural|spring|waterfall/.test(k) || /river|pond|lake|fountain|creek/.test(n)) return "water";
  if (/historic/.test(k)) return "historic";
  return "other";
}

// True if `c` clears the spread floor against every already-picked stop, so
// arrival zones never overlap (UX-SPEC.md §4). Layered on top of bucket-variety.
function farEnough(c, picked) {
  return picked.every((p) => haversine_m(c.lat, c.lng, p.lat, p.lng) >= MIN_STOP_SEP_M);
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
function pickVaried(candidates, target = 3) {
  const usable = candidates.filter((c) => !isSensitive(c));
  const pool = usable.length >= MIN_STOPS ? usable : candidates;
  const picked = [];
  const buckets = new Set();
  // Pass 1: one nearest place per distinct bucket, far enough from prior picks.
  for (const c of pool) {
    if (picked.length >= target) break;
    const b = bucketOf(c);
    if (!buckets.has(b) && farEnough(c, picked)) { picked.push(c); buckets.add(b); }
  }
  // Pass 2: fill remaining slots with any place that still clears the floor.
  for (const c of pool) {
    if (picked.length >= target) break;
    if (!picked.includes(c) && farEnough(c, picked)) picked.push(c);
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

function firstSentence(text, max = 160) {
  if (!text) return "";
  const s = text.split(/(?<=\.)\s/)[0];
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, "") + "…" : s;
}

function templatedQuest(lat, lng, label, candidates, preset = SIZE_PRESETS[DEFAULT_SIZE]) {
  const { maxStops, loopCeiling } = preset;
  const chosen = orderForWalk(pickVaried(candidates, maxStops), lat, lng);
  const stops = chosen.map((place, i) => {
    const bucket = bucketOf(place);
    return {
      id: candidates.indexOf(place),
      order_index: i + 1,
      // Keep description light; let the real Wikipedia snippet carry as "lore"
      // so the two lines don't duplicate each other.
      description: place.kind ? `A ${place.kind} in the neighbourhood.` : "A local landmark worth a look.",
      reason: REASON[bucket],
      lore_hook: place.lore ? firstSentence(place.lore, 220) : "",
      quest_type: "photo",
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
    theme: "A Little Local Wander",
    intro: stops.length === 3
      ? "Three nearby spots, a short walk, and a few stories. Ready to explore?"
      : `${stops.length} nearby spots, a short walk, and a few stories. Ready to explore?`,
    origin: { lat, lng, label },
    stops,
    meta: {
      mode: "preview",
      candidate_count: candidates.length,
      spread: { ok: rep.ok, legs_m: rep.legs, loop_m: rep.total },
    },
  };
}
