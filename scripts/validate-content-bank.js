#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateContentBank } from "../lib/content-bank.js";

const input = process.argv[2] || new URL("../content/nyc/content-bank.v1.json", import.meta.url);

try {
  const bank = JSON.parse(readFileSync(input, "utf8"));
  const result = validateContentBank(bank);
  if (!result.valid) {
    for (const error of result.errors) console.error(`ERROR ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Valid content bank v${bank.schema_version}: ${result.counts.places} places; ${result.counts.hunt_ideas} hunt ideas; ${result.counts.clue_packages} clue packages`);
  }
} catch (error) {
  console.error(`ERROR Could not validate ${String(input)}: ${error.message}`);
  process.exitCode = 1;
}
