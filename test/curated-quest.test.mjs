import assert from "node:assert/strict";
import test from "node:test";

import { buildCuratedQuest, eligibleContentRecords } from "../lib/curated-quest.js";

function review() {
  return { status: "approved", reviewer: "editor", reviewed_at: "2026-01-01T00:00:00Z", verified_at: "2026-01-01T00:00:00Z", notes: null };
}

function fixtureRecord(index, lifecycle = "published", delivery = undefined) {
  const placeId = `place:test:${index}`;
  const ideaId = `idea:nyc:test-${index}`;
  const evidenceId = `evidence:test:item-${index}`;
  const common = { lifecycle, record_version: index + 1, editorial_review: review(), field_review: review(), ...(delivery ? { delivery } : {}) };
  return {
    place: {
      id: placeId, name: `Verified place ${index}`, category: index % 2 ? "public_art" : "architecture",
      location: { lat: 40.72 + index * 0.004, lng: -74 + index * 0.002, area: "NYC" },
      observable_evidence: [{ evidence_id: evidenceId, claim: `Visible feature ${index}`, verification: { status: "field_verified" } }],
      sources: [{ url: `https://example.test/${index}` }], tags: [], ...common,
    },
    idea: {
      id: ideaId, title: `Idea ${index}`, concept: "Verified city details", place_ids: [placeId], observable_target_ids: [evidenceId], ...common,
    },
    clue: {
      id: `clue:nyc:test:${index}`, place_id: placeId, hunt_idea_id: ideaId,
      clue: `Find visible feature number ${index}.`, hints: [1, 2, 3].map((rung) => ({ rung, text: `Hint ${rung} for ${index}`, evidence_refs: [evidenceId] })),
      evidence_refs: [evidenceId], ...common,
    },
  };
}

function bank(records) {
  return {
    schema_version: "1.0.0", site_id: "nyc",
    places: records.map((r) => r.place),
    hunt_ideas: records.map((r) => r.idea),
    clue_packages: records.map((r) => r.clue),
  };
}

test("only published or explicitly canary-eligible field-verified record chains are eligible", () => {
  const published = fixtureRecord(0);
  const canary = fixtureRecord(1, "field_verified", { canary_eligible: true });
  const candidate = fixtureRecord(2, "candidate");
  const unverifiedCanary = fixtureRecord(3, "needs_field_verification", { canary_eligible: true });
  const eligible = eligibleContentRecords(bank([published, canary, candidate, unverifiedCanary]));
  assert.deepEqual(eligible.map((record) => record.clue.id), [published.clue.id, canary.clue.id]);
});

test("paused and retired records are never delivered", () => {
  const active = fixtureRecord(0);
  const paused = fixtureRecord(1, "published", { paused: true });
  const retired = fixtureRecord(2, "retired", { canary_eligible: true });
  const eligible = eligibleContentRecords(bank([active, paused, retired]));
  assert.deepEqual(eligible.map((record) => record.place.id), [active.place.id]);
});

test("curated quest selection is deterministic and includes immutable content version IDs", () => {
  const records = [0, 1, 2, 3, 4].map((index) => fixtureRecord(index));
  const first = buildCuratedQuest(bank(records), 40.72, -74, { size: "quick" });
  const second = buildCuratedQuest(bank(records), 40.72, -74, { size: "quick" });
  assert.deepEqual(first, second);
  assert.equal(first.stops.length, 3);
  assert.match(first.meta.content_version_id, /^nyc:1\.0\.0:[a-f0-9]{16}$/);
  for (const stop of first.stops) {
    assert.match(stop.content_version_id, /@\d+\|.*@\d+\|.*@\d+$/);
  }
});

test("no eligible content returns null rather than fabricating or promoting candidates", () => {
  const candidates = [0, 1, 2].map((index) => fixtureRecord(index, "needs_field_verification"));
  assert.equal(buildCuratedQuest(bank(candidates), 40.72, -74), null);
});
