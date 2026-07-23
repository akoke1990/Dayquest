#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateRemoteVerification, validateSourceRegistry } from "../lib/source-verification.js";

const input = process.argv[2] || new URL("../content/nyc/remote-verification.v1.json", import.meta.url);
const registryInput = process.argv[3] || new URL("../content/nyc/source-registry.v1.json", import.meta.url);

try {
  const registry = JSON.parse(readFileSync(registryInput, "utf8"));
  const registryResult = validateSourceRegistry(registry);
  const artifact = JSON.parse(readFileSync(input, "utf8"));
  const result = validateRemoteVerification(artifact, registry);
  const errors = [...registryResult.errors.map((error) => `registry: ${error}`), ...result.errors];
  if (errors.length) {
    for (const error of errors) console.error(`ERROR ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Valid remote verification v${artifact.schema_version}: ${result.counts.verifications} records; ${result.counts.claims} claims; ${registryResult.counts.providers} providers`);
  }
} catch (error) {
  console.error(`ERROR Could not validate ${String(input)}: ${error.message}`);
  process.exitCode = 1;
}
