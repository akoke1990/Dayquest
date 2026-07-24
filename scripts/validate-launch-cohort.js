import { readFileSync } from "node:fs";

import { validateLaunchCohort } from "../lib/launch-cohort.js";

const root = new URL("../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

const result = validateLaunchCohort({
  artifact: readJson("content/nyc/launch-cohort/nyc-launch-cohort.v1.json"),
  bank: readJson("content/nyc/content-bank.v1.json"),
  sourceCandidates: readJson("content/nyc/source-candidates.v2.json"),
  foundationRemote: readJson("content/nyc/remote-verification.v1.json"),
  remote: readJson("content/nyc/remote-verification/villages.remote-v1.json"),
});

if (!result.valid) {
  for (const message of result.errors) console.error(message);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    valid: true,
    artifact: "nyc-launch-cohort.v1.json",
    routes: result.counts.routes,
    candidates: result.counts.candidates,
    state: "remote_only_needs_field_check",
  }));
}
