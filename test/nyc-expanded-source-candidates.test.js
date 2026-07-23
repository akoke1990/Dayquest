import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { importApprovedPois, validateContentBank } from "../lib/content-bank.js";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const sourceRows = readJson("../db/nyc-pois-labeled.json");
const candidates = readJson("../content/nyc/source-candidates.v2.json");
const tranches = [
  readJson("../content/nyc/research/village.v1.json"),
  readJson("../content/nyc/research/east-village-chinatown.v1.json"),
  readJson("../content/nyc/research/fidi-battery.v1.json"),
];

function hasKey(value, forbidden) {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, forbidden)) return true;
  return Object.values(value).some((child) => hasKey(child, forbidden));
}

test("three durable research tranches preserve 20 records each and their explicit rejections", () => {
  assert.deepEqual(tranches.map((artifact) => artifact.records.length), [20, 20, 20]);
  assert.deepEqual(tranches.map((artifact) => (artifact.rejected_notes || artifact.rejects).length), [8, 10, 6]);
  assert.ok(tranches.every((artifact) => artifact.field_verified === false || artifact.records.every((record) => record.needs_field_verification === true || record.lifecycle === "needs_field_verification")));
  assert.equal(hasKey(tranches, "difficulty"), false);
});

test("v2 portfolio contains the current 40 plus 60 normalized source-grounded candidates", () => {
  assert.equal(candidates.artifact_version, "2.0.0");
  assert.equal(candidates.site_id, "nyc");
  assert.equal(candidates.candidates.length, 100);
  assert.equal(candidates.provenance.field_verified, false);
  assert.equal(candidates.provenance.publication_claimed, false);
  assert.equal(new Set(candidates.candidates.map((item) => item.research_id.toLowerCase())).size, 100);
  assert.equal(hasKey(candidates, "difficulty"), false);
  assert.equal(candidates.rejected_candidates.length, 36);
});

test("new concepts use exact existing-place mappings or source-derived new places with grounded coordinates", () => {
  const approvedById = new Map(sourceRows.filter((row) => row.status === "approved").map((row) => [
    `place:${row.source.toLowerCase()}:${encodeURIComponent(String(row.ext_id).toLowerCase())}`,
    row,
  ]));
  const newCandidates = candidates.candidates.filter((item) => item.tranche_id !== "baseline-40");
  assert.equal(newCandidates.length, 60);
  assert.equal(newCandidates.filter((item) => item.mapping === "existing_place").length, 18);
  assert.equal(newCandidates.filter((item) => item.mapping === "new_place").length, 42);

  for (const item of newCandidates) {
    assert.ok(item.source.url && item.source.excerpt, `${item.research_id} lacks source evidence`);
    assert.ok(item.evidence.length > 0, `${item.research_id} lacks evidence`);
    assert.equal(item.idea.lifecycle, "needs_field_verification");
    assert.equal(item.clue_package.lifecycle, "candidate");
    if (item.mapping === "existing_place") {
      const row = approvedById.get(item.place_id);
      assert.ok(row, `${item.research_id} does not resolve to the approved catalog`);
      assert.equal(item.matched_catalog_name, row.name);
      assert.equal(item.new_place, null);
    } else {
      assert.equal(item.matched_catalog_name, null);
      assert.match(item.place_id, /^place:[a-z0-9._%~-]+:.+/);
      assert.ok(Number.isFinite(item.new_place.location.lat));
      assert.ok(Number.isFinite(item.new_place.location.lng));
      assert.ok(item.new_place.coordinate_source.url);
      assert.ok(item.new_place.coordinate_source.excerpt);
      assert.equal(item.place_id, item.new_place.id);
    }
  }
});

test("expanded merge is deterministic, deduplicated, balanced, and never publication-ready", () => {
  const first = importApprovedPois(sourceRows, candidates);
  const second = importApprovedPois(sourceRows, candidates);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  assert.equal(first.places.length, 248);
  assert.equal(first.hunt_ideas.length, 100);
  assert.equal(first.clue_packages.length, 100);
  assert.equal(new Set(first.places.map((place) => place.id)).size, 248);
  assert.equal(new Set(first.hunt_ideas.map((idea) => idea.id)).size, 100);
  assert.equal(new Set(first.clue_packages.map((clue) => clue.id)).size, 100);
  assert.equal(new Set(first.hunt_ideas.map((idea) => idea.title.toLowerCase())).size, 100);

  const records = [...first.places, ...first.hunt_ideas, ...first.clue_packages];
  assert.equal(records.filter((record) => record.lifecycle === "published").length, 0);
  assert.equal(records.filter((record) => record.lifecycle === "field_verified").length, 0);
  assert.equal(first.places.flatMap((place) => place.observable_evidence).filter((evidence) => evidence.verification.status === "field_verified").length, 0);
  assert.equal(first.places.filter((place) => place.field_review.status === "approved").length, 0);
  assert.equal(validateContentBank(first).valid, true);

  const categoryCounts = Object.groupBy(candidates.candidates, (item) => item.category);
  assert.ok(Object.keys(categoryCounts).length >= 8);
  assert.ok((categoryCounts.public_art || []).length >= 20);
  assert.ok((categoryCounts.park_garden || []).length >= 15);
  assert.ok((categoryCounts.architecture || []).length < 30);

  const newAreas = new Set(candidates.candidates.filter((item) => item.tranche_id !== "baseline-40").map((item) => item.area));
  for (const required of ["Greenwich Village", "West Village", "East Village", "Chinatown", "Financial District", "The Battery", "Battery Park City", "Battery Park City waterfront"]) {
    assert.ok(newAreas.has(required), `missing required area ${required}`);
  }
});

test("published hunt ideas are gated as strictly as published clues", () => {
  const bank = importApprovedPois(sourceRows, candidates);
  bank.hunt_ideas[0].lifecycle = "published";
  const result = validateContentBank(bank);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /published hunt idea requires a published place/);
  assert.match(result.errors.join("\n"), /published hunt idea requires field-verified evidence/);
  assert.match(result.errors.join("\n"), /published hunt idea requires approved reviews/);
});

test("new-place import rejects guessed coordinates and IDs not derived from canonical source identity", () => {
  const missingCoordinates = structuredClone(candidates);
  const firstNew = missingCoordinates.candidates.find((item) => item.mapping === "new_place");
  delete firstNew.new_place.coordinate_source.excerpt;
  assert.throws(() => importApprovedPois(sourceRows, missingCoordinates), /lacks source-grounded coordinates/);

  const unstableIdentity = structuredClone(candidates);
  const secondNew = unstableIdentity.candidates.find((item) => item.mapping === "new_place");
  secondNew.place_id = "place:invented:name-based-id";
  secondNew.new_place.id = secondNew.place_id;
  assert.throws(() => importApprovedPois(sourceRows, unstableIdentity), /not derived from canonical source identity/);
});
