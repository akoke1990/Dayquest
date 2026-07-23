import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { importApprovedPois, stablePlaceId, validateContentBank } from "../lib/content-bank.js";

const sourceRows = JSON.parse(
  readFileSync(new URL("../db/nyc-pois-labeled.json", import.meta.url), "utf8")
);

test("stablePlaceId derives a deterministic source identity", () => {
  assert.equal(stablePlaceId({ source: "wikipedia", ext_id: "9235531" }), "place:wikipedia:9235531");
});

test("approved POIs import idempotently without observable claims or clues", () => {
  const first = importApprovedPois(sourceRows);
  const second = importApprovedPois(sourceRows);

  assert.deepEqual(second, first);
  assert.equal(first.schema_version, "1.0.0");
  assert.equal(first.site_id, "nyc");
  assert.equal(first.places.length, 206);
  assert.deepEqual(first.hunt_ideas, []);
  assert.deepEqual(first.clue_packages, []);
  assert.equal(new Set(first.places.map((place) => place.id)).size, 206);

  for (const place of first.places) {
    assert.equal(place.lifecycle, "needs_source_review");
    assert.deepEqual(place.observable_evidence, []);
    assert.equal(place.field_review.status, "not_started");
    assert.equal(place.editorial_review.status, "not_started");
    assert.equal(place.sources.length, 1);
    assert.equal(place.sources[0].review_status, "unreviewed");
  }
});

test("import rejects approved rows without stable source identity", () => {
  assert.throws(
    () => importApprovedPois([{ ...sourceRows[0], ext_id: "" }]),
    /stable source identity/
  );
});

test("validator accepts the unverified imported bank", () => {
  const result = validateContentBank(importApprovedPois(sourceRows));
  assert.deepEqual(result, { valid: true, errors: [], counts: { places: 206, hunt_ideas: 0, clue_packages: 0 } });
});

test("validator rejects dangling references and unverified publication", () => {
  const bank = importApprovedPois(sourceRows.slice(0, 1));
  bank.places[0].lifecycle = "published";
  bank.clue_packages.push({
    id: "clue:nyc:example:001",
    record_version: 1,
    lifecycle: "candidate",
    place_id: "place:wikipedia:missing",
    hunt_idea_id: null,
    language: "en-US",
    clue: "",
    hints: [],
    evidence_refs: [],
    editorial_review: { status: "not_started", reviewer: null, reviewed_at: null, notes: null },
    field_review: { status: "not_started", reviewer: null, verified_at: null, notes: null },
  });

  const result = validateContentBank(bank);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /published place requires field-verified observable evidence/);
  assert.match(result.errors.join("\n"), /unknown place_id/);
});

test("validator rejects the removed difficulty concept in new records", () => {
  const bank = importApprovedPois(sourceRows.slice(0, 1));
  bank.hunt_ideas.push({
    id: "idea:nyc:example",
    record_version: 1,
    lifecycle: "candidate",
    title: "Example",
    concept: "",
    place_ids: [bank.places[0].id],
    observable_target_ids: [],
    difficulty: "hard",
    editorial_review: { status: "not_started", reviewer: null, reviewed_at: null, notes: null },
    field_review: { status: "not_started", reviewer: null, verified_at: null, notes: null },
  });
  const result = validateContentBank(bank);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /difficulty is not part of content-bank v1/);
});

test("validator enforces required schema fields and evidence vocabularies", () => {
  const bank = importApprovedPois(sourceRows.slice(0, 1));
  delete bank.places[0].viewpoint_approach;
  bank.places[0].observable_evidence.push({
    evidence_id: "evidence:wikipedia-9235531:bad",
    claim: "Malformed test claim.",
    observable_target: "invalid-target",
    source_ids: ["source:wikipedia:missing"],
    viewpoint: "test",
    stability: "invalid-stability",
    seasonality: null,
    verification: { status: "unverified", method: "invalid-method", verified_by: null, verified_at: null },
  });

  const result = validateContentBank(bank);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /viewpoint_approach is required/);
  assert.match(result.errors.join("\n"), /observable_target must be one of/);
  assert.match(result.errors.join("\n"), /unknown source_id/);
});

test("validator requires published clues to use a published place and field-verified evidence", () => {
  const bank = importApprovedPois(sourceRows.slice(0, 1));
  const place = bank.places[0];
  const evidenceId = "evidence:wikipedia-9235531:unverified";
  place.observable_evidence.push({
    evidence_id: evidenceId,
    claim: "Unverified test observation.",
    observable_target: "facade",
    source_ids: [place.sources[0].source_id],
    viewpoint: "Test viewpoint.",
    stability: "stable",
    seasonality: null,
    verification: { status: "unverified", method: null, verified_by: null, verified_at: null },
  });
  bank.clue_packages.push({
    id: "clue:nyc:wikipedia-9235531:unverified",
    record_version: 1,
    lifecycle: "published",
    place_id: place.id,
    hunt_idea_id: null,
    language: "en-US",
    clue: "Test clue text.",
    hints: [1, 2, 3].map((rung) => ({ rung, text: `Hint ${rung}`, evidence_refs: [evidenceId] })),
    evidence_refs: [evidenceId],
    editorial_review: { status: "approved", reviewer: "tester", reviewed_at: "2026-07-22T00:00:00Z", notes: null },
    field_review: { status: "approved", reviewer: "tester", verified_at: "2026-07-22T00:00:00Z", notes: null },
  });

  const result = validateContentBank(bank);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /published clue requires a published place/);
  assert.match(result.errors.join("\n"), /published clue requires field-verified evidence/);
});

test("validator blocks prohibited aliases in published clue text", () => {
  const bank = importApprovedPois(sourceRows.slice(0, 1));
  const place = bank.places[0];
  const evidenceId = "evidence:wikipedia-9235531:obs-01";
  place.observable_evidence.push({
    evidence_id: evidenceId,
    claim: "Verified test observation.",
    observable_target: "facade",
    source_ids: [place.sources[0].source_id],
    viewpoint: "Verified public approach.",
    stability: "stable",
    seasonality: null,
    verification: { status: "field_verified", method: "human_site_check", verified_by: "tester", verified_at: "2026-07-22T00:00:00Z" },
  });
  place.lifecycle = "published";
  place.editorial_review = { status: "approved", reviewer: "tester", reviewed_at: "2026-07-22T00:00:00Z", notes: null };
  place.field_review = { status: "approved", reviewer: "tester", verified_at: "2026-07-22T00:00:00Z", notes: null };
  bank.clue_packages.push({
    id: "clue:nyc:wikipedia-9235531:001",
    record_version: 1,
    lifecycle: "published",
    place_id: place.id,
    hunt_idea_id: null,
    language: "en-US",
    clue: `Look for ${place.name}.`,
    hints: [1, 2, 3].map((rung) => ({ rung, text: `Hint ${rung}`, evidence_refs: [evidenceId] })),
    evidence_refs: [evidenceId],
    editorial_review: place.editorial_review,
    field_review: place.field_review,
  });

  const result = validateContentBank(bank);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /contains prohibited alias/);
});
