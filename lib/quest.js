// Core quest-building logic, shared by the CLI (generate-quest.js) and the
// HTTP server (server.js). No printing here — this just returns the quest object.

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { gatherCandidates } from "./sources.js";

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
const SYSTEM = `You are a warm, curious local guide who designs short walking
scavenger hunts in the spirit of Atlas Obscura — favouring the storied, the
historic, the quietly strange: old libraries, fable-laden rivers, monuments,
ruins, public art, hidden gardens, quirky neighbourhood landmarks.

You are given a numbered list of REAL nearby places (with coordinates, distance,
and a snippet of real history). Your job is to CURATE, not invent.

Hard rules:
- Choose places ONLY from the list, by their integer id. Never invent a place.
- Pick exactly 3 that form a fun, walkable loop and offer VARIETY (don't pick
  three of the same kind).
- Drop anything that is not a visitable public spot a person can walk up to —
  e.g. administrative areas, neighbourhoods, schools, private property, whole
  districts, or a person/event with no physical site.
- Only state history/lore that is supported by the provided snippet. If a place
  has no snippet, keep its description generic ("worth a look because…") and do
  NOT invent facts. You may add playful framing only if clearly marked as such
  ("Legend has it…").
- Each quest is a short PHOTO challenge: ask the explorer to photograph a
  specific, real, observable detail of that place (doable on foot in a minute).`;

// Forced-tool output keeps the response strictly structured & SDK-version-robust.
const EMIT_TOOL = {
  name: "emit_quest",
  description: "Return the curated 3-stop quest.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      theme: { type: "string", description: "A short, playful name for today's quest." },
      intro: { type: "string", description: "One warm sentence to set the mood." },
      stops: {
        type: "array",
        description: "Exactly 3 stops, in walking order.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "integer", description: "The id of the chosen place from the list." },
            order_index: { type: "integer", description: "1, 2, or 3 — walking order." },
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

function buildUserPrompt(candidates, label) {
  const lines = candidates.map(
    (c, i) =>
      `[${i}] ${c.name}${c.kind ? ` — ${c.kind}` : ""} — ${c.distance_m}m away\n` +
      `     ${c.lore ? c.lore : "(no history snippet available)"}`
  );
  return (
    `Origin: ${label}\n\n` +
    `Nearby real places:\n${lines.join("\n\n")}\n\n` +
    `Design today's 3-stop DayQuest. Refer to places by their [id].`
  );
}

/**
 * Build a quest for a location. Throws on no key / too few places / model error.
 * @returns { theme, intro, origin, stops: [{ ...narrative, place }] }
 */
export async function buildQuest(lat, lng, label = `${lat}, ${lng}`) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error("Missing ANTHROPIC_API_KEY");
    e.code = "NO_KEY";
    throw e;
  }

  const candidates = await gatherCandidates(lat, lng);
  if (candidates.length < 3) {
    const e = new Error("Not enough nearby places to build a quest here.");
    e.code = "TOO_FEW";
    throw e;
  }

  const client = new Anthropic();
  const resp = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4000,
    system: SYSTEM,
    tools: [EMIT_TOOL],
    tool_choice: { type: "tool", name: "emit_quest" },
    messages: [{ role: "user", content: buildUserPrompt(candidates, label) }],
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
  stops.sort((a, b) => a.order_index - b.order_index);

  return {
    theme: block.input.theme,
    intro: block.input.intro,
    origin: { lat, lng, label },
    stops,
    meta: { candidate_count: candidates.length },
  };
}
