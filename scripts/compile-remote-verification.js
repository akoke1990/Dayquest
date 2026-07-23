#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { compileRemoteVerification, validateRemoteVerification, validateSourceRegistry } from "../lib/source-verification.js";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const bankInput = option("--bank", new URL("../content/nyc/content-bank.v1.json", import.meta.url));
const registryInput = option("--registry", new URL("../content/nyc/source-registry.v1.json", import.meta.url));
const output = option("--out", new URL("../content/nyc/remote-verification.v1.json", import.meta.url));

try {
  const bank = JSON.parse(readFileSync(bankInput, "utf8"));
  const registry = JSON.parse(readFileSync(registryInput, "utf8"));
  const registryResult = validateSourceRegistry(registry);
  if (!registryResult.valid) throw new Error(`source registry is invalid:\n${registryResult.errors.join("\n")}`);
  const artifact = compileRemoteVerification(bank, registry, "content/nyc/content-bank.v1.json");
  const result = validateRemoteVerification(artifact, registry);
  if (!result.valid) throw new Error(`remote verification is invalid:\n${result.errors.join("\n")}`);
  writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n");
  console.log(`Compiled ${result.counts.verifications} remote verification records with ${result.counts.claims} claims → ${String(output)}`);
} catch (error) {
  console.error(`Remote verification compile failed: ${error.message}`);
  process.exitCode = 1;
}
