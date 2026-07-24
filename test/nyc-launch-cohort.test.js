import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateLaunchCohort } from "../lib/launch-cohort.js";

const root = new URL("../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

const inputs = () => ({
  artifact: readJson("content/nyc/launch-cohort/nyc-launch-cohort.v1.json"),
  bank: readJson("content/nyc/content-bank.v1.json"),
  sourceCandidates: readJson("content/nyc/source-candidates.v2.json"),
  foundationRemote: readJson("content/nyc/remote-verification.v1.json"),
  remote: readJson("content/nyc/remote-verification/villages.remote-v1.json"),
});

test("the committed NYC launch cohort is valid against its source artifacts", () => {
  const result = validateLaunchCohort(inputs());
  assert.deepEqual(result.errors, []);
  assert.equal(result.counts.routes, 2);
  assert.equal(result.counts.candidates, 8);
});

test("candidate and route IDs must be unique", () => {
  const data = inputs();
  data.artifact.candidates[1].candidate_id = data.artifact.candidates[0].candidate_id;
  data.artifact.routes[1].route_id = data.artifact.routes[0].route_id;
  const result = validateLaunchCohort(data);
  assert.match(result.errors.join("\n"), /candidate_id: duplicate/);
  assert.match(result.errors.join("\n"), /route_id: duplicate/);
});

test("field-verification, publication, and live claims are rejected at every level", () => {
  const paths = [
    ["state", "field_verified"],
    ["state", "publication_claimed"],
    ["state", "published"],
    ["state", "live"],
  ];
  for (const [group, key] of paths) {
    const data = inputs();
    data.artifact[group][key] = true;
    assert.match(validateLaunchCohort(data).errors.join("\n"), new RegExp(`${group}\\.${key}: must be false`));
  }
  for (const key of ["field_verified", "publication_claimed", "published", "live"]) {
    const data = inputs();
    data.artifact.candidates[0].current_state[key] = true;
    assert.match(validateLaunchCohort(data).errors.join("\n"), new RegExp(`current_state\\.${key}: must be false`));
  }
});

test("one primary and one reserve route each have 3-5 ordered stops and conservative walkability metadata", () => {
  const mutations = [
    (data) => { data.artifact.routes[1].role = "primary"; },
    (data) => { data.artifact.routes[0].candidate_ids = data.artifact.routes[0].candidate_ids.slice(0, 2); },
    (data) => { data.artifact.routes[0].stop_count = 5; },
    (data) => { data.artifact.routes[0].walkability.route_geometry_claimed = true; },
    (data) => { data.artifact.routes[0].walkability.network_route_distance_status = "known"; },
    (data) => { data.artifact.routes[0].walkability.source_coordinate_sequence_length_m += 1; },
    (data) => { data.artifact.routes[0].walkability.source_coordinate_max_span_m += 1; },
  ];
  for (const mutate of mutations) {
    const data = inputs();
    mutate(data);
    assert.notDeepEqual(validateLaunchCohort(data).errors, []);
  }
});

test("all exact bank, source-candidate, foundation-remote, and detailed-remote references resolve", () => {
  const keys = [
    "bank_place_id",
    "bank_evidence_id",
    "bank_clue_package_id",
    "source_candidate_id",
    "foundation_remote_verification_id",
    "detailed_remote_evidence_id",
  ];
  for (const key of keys) {
    const data = inputs();
    data.artifact.candidates[0].existing_ids[key] = `missing:${key}`;
    assert.match(validateLaunchCohort(data).errors.join("\n"), new RegExp(`existing_ids\\.${key}`));
  }
});

test("admission rejects hold, reject, non-canary, non-low-risk, and dependent candidates", () => {
  for (const decision of ["hold", "reject", "needs_scout"]) {
    const data = inputs();
    const id = data.artifact.candidates[0].candidate_id;
    data.remote.records.find((record) => record.candidate_id === id).decision = decision;
    assert.match(validateLaunchCohort(data).errors.join("\n"), /detailed remote decision must be canary_eligible/);
  }
  const higherRisk = inputs();
  higherRisk.artifact.candidates[0].risk.remote_tier = "medium";
  assert.match(validateLaunchCohort(higherRisk).errors.join("\n"), /risk\.remote_tier: must be low/);
  const dependent = inputs();
  dependent.artifact.candidates[0].risk.known_business_dependency = true;
  assert.match(validateLaunchCohort(dependent).errors.join("\n"), /known_business_dependency: must be false/);
});

test("every scout record keeps accessibility unknown and requires questions, outcomes, disqualifiers, and a reciprocal reserve pairing", () => {
  const mutations = [
    (candidate) => { candidate.accessibility_status = "accessible"; },
    (candidate) => { delete candidate.field_questions.safety; },
    (candidate) => { candidate.required_scout_outcome.status = "passed"; },
    (candidate) => { candidate.required_scout_outcome.pass_requirements = []; },
    (candidate) => { candidate.disqualifiers = []; },
    (candidate) => { candidate.replacement_pair.candidate_id = "missing:reserve"; },
  ];
  for (const mutate of mutations) {
    const data = inputs();
    mutate(data.artifact.candidates[0]);
    assert.notDeepEqual(validateLaunchCohort(data).errors, []);
  }
});
