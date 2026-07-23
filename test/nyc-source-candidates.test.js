import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { importApprovedPois, validateContentBank } from "../lib/content-bank.js";

const sourceRows = JSON.parse(readFileSync(new URL("../db/nyc-pois-labeled.json", import.meta.url), "utf8"));
const candidates = JSON.parse(readFileSync(new URL("../content/nyc/source-candidates.v1.json", import.meta.url), "utf8"));

function hasKey(value, forbidden) {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, forbidden)) return true;
  return Object.values(value).some((child) => hasKey(child, forbidden));
}

test("versioned NYC candidate artifact contains all 40 researched concepts and documented exclusions", () => {
  assert.equal(candidates.artifact_version, "1.0.0");
  assert.equal(candidates.site_id, "nyc");
  assert.equal(candidates.candidates.length, 40);
  assert.equal(new Set(candidates.candidates.map((item) => item.research_id)).size, 40);
  assert.equal(new Set(candidates.candidates.map((item) => item.place_id)).size, 40);
  assert.ok(candidates.rejected_candidates.length >= 12);
  assert.equal(hasKey(candidates, "difficulty"), false);
});

test("every source candidate maps to one exact approved stable place and preserves source support", () => {
  const approvedIds = new Set(sourceRows.filter((row) => row.status === "approved").map(
    (row) => `place:${row.source.toLowerCase()}:${encodeURIComponent(String(row.ext_id).toLowerCase())}`
  ));
  for (const item of candidates.candidates) {
    assert.ok(approvedIds.has(item.place_id), `${item.research_id} has an unmapped place_id`);
    assert.match(item.source.url, /^https:\/\/en\.wikipedia\.org\/\?curid=\d+$/);
    assert.ok(item.source.excerpt.length > 10);
    assert.ok(item.evidence.length >= 1);
    assert.ok(item.evidence.every((evidence) => evidence.claim.length > 0));
    assert.equal(item.idea.lifecycle, "needs_field_verification");
    assert.equal(item.clue_package.lifecycle, "candidate");
    assert.ok(item.clue_package.riddle.length > 0);
    assert.equal(item.clue_package.hints.length, 2);
  }
});

test("candidate merge produces deterministic unverified ideas and draft clues", () => {
  const first = importApprovedPois(sourceRows, candidates);
  const second = importApprovedPois(sourceRows, candidates);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  assert.equal(first.places.length, 206);
  assert.equal(first.hunt_ideas.length, 40);
  assert.equal(first.clue_packages.length, 40);
  assert.deepEqual(first.hunt_ideas.map((idea) => idea.id), [...first.hunt_ideas.map((idea) => idea.id)].sort());
  assert.deepEqual(first.clue_packages.map((clue) => clue.id), [...first.clue_packages.map((clue) => clue.id)].sort());

  const candidatePlaceIds = new Set(candidates.candidates.map((item) => item.place_id));
  for (const place of first.places) {
    if (!candidatePlaceIds.has(place.id)) continue;
    assert.equal(place.lifecycle, "needs_field_verification");
    assert.ok(place.observable_evidence.length >= 1);
    assert.ok(place.observable_evidence.every((evidence) => evidence.verification.status === "source_verified"));
    assert.ok(place.observable_evidence.every((evidence) => evidence.verification.method === "source_review"));
    assert.ok(place.observable_evidence.every((evidence) => evidence.verification.verified_at === null));
  }

  assert.equal(validateContentBank(first).valid, true);
});

test("candidate integration makes no publication or field-verification claim", () => {
  const bank = importApprovedPois(sourceRows, candidates);
  const records = [...bank.places, ...bank.hunt_ideas, ...bank.clue_packages];
  assert.equal(records.filter((record) => record.lifecycle === "published").length, 0);
  assert.equal(records.filter((record) => record.lifecycle === "field_verified").length, 0);
  assert.equal(bank.places.flatMap((place) => place.observable_evidence)
    .filter((evidence) => evidence.verification.status === "field_verified").length, 0);
  assert.equal(bank.places.filter((place) => place.field_review.status === "approved").length, 0);
});

test("validator rejects candidate clue evidence from another place", () => {
  const bank = importApprovedPois(sourceRows, candidates);
  const [first, second] = bank.clue_packages;
  first.evidence_refs = [...second.evidence_refs];
  first.hints[0].evidence_refs = [...second.evidence_refs];
  const result = validateContentBank(bank);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /evidence from another place/);
});

test("validator rejects source-researched evidence that masquerades as a field check", () => {
  const bank = importApprovedPois(sourceRows, candidates);
  const evidence = bank.places.find((place) => place.observable_evidence.length).observable_evidence[0];
  evidence.verification.method = "human_site_check";
  const result = validateContentBank(bank);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /source_verified evidence requires source_review/);
});
