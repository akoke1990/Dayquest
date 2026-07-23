#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { importApprovedPois, validateContentBank } from "../lib/content-bank.js";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const input = option("--in", new URL("../db/nyc-pois-labeled.json", import.meta.url));
const output = option("--out", new URL("../content/nyc/content-bank.v1.json", import.meta.url));

try {
  const rows = JSON.parse(readFileSync(input, "utf8"));
  const bank = importApprovedPois(rows);
  const result = validateContentBank(bank);
  if (!result.valid) throw new Error(`generated bank is invalid:\n${result.errors.join("\n")}`);
  writeFileSync(output, JSON.stringify(bank, null, 2) + "\n");
  console.log(`Imported ${result.counts.places} places; ${result.counts.hunt_ideas} hunt ideas; ${result.counts.clue_packages} clue packages → ${String(output)}`);
} catch (error) {
  console.error(`Content import failed: ${error.message}`);
  process.exitCode = 1;
}
