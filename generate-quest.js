// DayQuest — quest generator CLI (the "brain", run from the terminal).
//
//   node generate-quest.js [lat] [lng]
//
// Defaults to the Edinburgh Royal Mile (dense with history + fables) so the
// output shows the app at its best. Pass your own coordinates to try home.

import { writeFileSync } from "node:fs";
import { buildQuest, loadEnv } from "./lib/quest.js";

// Royal Mile (near St Giles') — a walkable Old Town spine, not castle-locked.
const DEFAULT = { lat: 55.9496, lng: -3.1883, label: "Edinburgh Royal Mile" };

function printQuest(quest) {
  console.log(`\n  🗺  ${quest.theme}`);
  console.log(`  📍 ${quest.origin.label}`);
  console.log(`  ${quest.intro}\n`);
  for (const s of quest.stops) {
    console.log(`  ${s.order_index}. ${s.place.name}  (${s.place.distance_m}m)`);
    console.log(`     ${s.description}`);
    console.log(`     Why: ${s.reason}`);
    if (s.lore_hook) console.log(`     Lore: ${s.lore_hook}`);
    console.log(`     🎯 [${s.quest_type}] ${s.quest_prompt}`);
    console.log(`     ↳ ${s.place.source_url}\n`);
  }
}

async function main() {
  loadEnv();
  const lat = process.argv[2] ? Number(process.argv[2]) : DEFAULT.lat;
  const lng = process.argv[3] ? Number(process.argv[3]) : DEFAULT.lng;
  const label = process.argv[2] ? `${lat}, ${lng}` : DEFAULT.label;

  console.log(`\n  Building a quest near ${label}…`);
  const quest = await buildQuest(lat, lng, label);
  printQuest(quest);

  writeFileSync(new URL("quest.json", import.meta.url), JSON.stringify(quest, null, 2));
  console.log("  Saved full quest to quest.json\n");
}

main().catch((err) => {
  if (err.code === "NO_KEY") {
    console.error(
      "\n  Missing ANTHROPIC_API_KEY.\n" +
        "  1) Copy .env.example to .env\n" +
        "  2) Paste your key (get one at https://console.anthropic.com/settings/keys)\n"
    );
  } else {
    console.error(`\n  Error: ${err.message}\n`);
  }
  process.exit(1);
});
