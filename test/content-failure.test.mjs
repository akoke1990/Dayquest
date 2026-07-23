import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApiHandler } from "../lib/api-server.js";
import { buildCuratedReplacement } from "../lib/curated-quest.js";

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
      id: placeId, name: `Verified place ${index}`, category: "public_art",
      location: { lat: 40.72 + index * 0.001, lng: -74, area: "NYC" },
      observable_evidence: [{ evidence_id: evidenceId, claim: `Visible feature ${index}`, verification: { status: "field_verified" } }],
      sources: [{ url: `https://example.test/${index}` }], tags: [], ...common,
    },
    idea: { id: ideaId, title: `Idea ${index}`, concept: "Verified city details", place_ids: [placeId], observable_target_ids: [evidenceId], ...common },
    clue: {
      id: `clue:nyc:test:${index}`, place_id: placeId, hunt_idea_id: ideaId,
      clue: `Find visible feature ${index}.`, hints: [1, 2, 3].map((rung) => ({ rung, text: `Hint ${rung}`, evidence_refs: [evidenceId] })),
      evidence_refs: [evidenceId], ...common,
    },
  };
}

function bank(records) {
  return {
    schema_version: "1.0.0", site_id: "nyc",
    places: records.map((record) => record.place),
    hunt_ideas: records.map((record) => record.idea),
    clue_packages: records.map((record) => record.clue),
  };
}

async function withApi(options, run) {
  const server = createServer(createApiHandler(options));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function post(base, body) {
  const response = await fetch(`${base}/content-failure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

function dependencies(overrides = {}) {
  const trap = async () => { throw new Error("live provider path must not run"); };
  return {
    loadCuratedQuest: trap,
    loadCuratedReplacement: async () => null,
    buildQuest: trap,
    resolveArea: trap,
    resolvePlace: trap,
    fetchSharedHunt: async () => null,
    upsertSharedHunt: async () => false,
    appendRecord: () => {},
    ...overrides,
  };
}

test("curated replacement uses the existing lifecycle gate and excludes every active-quest place", () => {
  const records = [0, 1, 2, 3, 4].map((index) => fixtureRecord(index));
  records[4] = fixtureRecord(4, "needs_field_verification");

  const replacement = buildCuratedReplacement(bank(records), {
    reportedPlaceId: records[0].place.id,
    excludedPlaceIds: new Set([records[0].place.id, records[1].place.id, records[2].place.id]),
    orderIndex: 2,
  });

  assert.equal(replacement.place.source_id, records[3].place.id);
  assert.equal(replacement.order_index, 2);
  assert.equal(replacement.place.source, "dayquest_content_bank");
});

test("unsafe report is stored as safety-priority structured data and returns a curated same-slot replacement", async () => {
  const records = [];
  const calls = [];
  const replacement = { order_index: 99, clue: "Replacement clue", place: { source_id: "place:test:new" } };
  await withApi({ dependencies: dependencies({
    appendRecord: (file, record) => records.push({ file, record }),
    loadCuratedReplacement: async (input) => { calls.push(input); return replacement; },
  }) }, async (base) => {
    const result = await post(base, {
      reason: "unsafe",
      place_id: "place:test:reported",
      slot: 2,
      excluded_place_ids: ["place:test:a", "place:test:b", "place:test:reported"],
      quest_content_version_id: "nyc:1.0.0:abc",
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.body.replacement.order_index, 2);
    assert.equal(result.body.penalty, false);
    assert.equal(result.body.report.priority, "safety");
    assert.deepEqual(calls[0], {
      reportedPlaceId: "place:test:reported",
      excludedPlaceIds: new Set(["place:test:a", "place:test:b", "place:test:reported"]),
      orderIndex: 2,
    });
    assert.equal(records[0].file, "content-failures.jsonl");
    assert.deepEqual(records[0].record, {
      reason: "unsafe",
      place_id: "place:test:reported",
      quest_content_version_id: "nyc:1.0.0:abc",
      priority: "safety",
      curator_action: "immediate_review",
      accessibility_status: "unknown",
    });
  });
});

test("replacement unavailable is explicit and never invokes live generation", async () => {
  let replacementCalls = 0;
  await withApi({ dependencies: dependencies({
    loadCuratedReplacement: async () => { replacementCalls += 1; return null; },
  }) }, async (base) => {
    const result = await post(base, {
      reason: "blocked_closed",
      place_id: "place:test:reported",
      slot: 1,
      excluded_place_ids: ["place:test:reported"],
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.code, "REPLACEMENT_UNAVAILABLE");
    assert.equal(result.body.penalty, false);
    assert.equal(replacementCalls, 1);
  });
});

test("curated replacement loader failure is an explicit unavailable response", async () => {
  await withApi({ dependencies: dependencies({
    loadCuratedReplacement: async () => { throw new Error("bank unreadable"); },
  }) }, async (base) => {
    const result = await post(base, {
      reason: "missing",
      place_id: "place:test:reported",
      slot: 1,
      excluded_place_ids: ["place:test:reported"],
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.code, "REPLACEMENT_UNAVAILABLE");
    assert.equal(result.body.penalty, false);
    assert.doesNotMatch(JSON.stringify(result.body), /bank unreadable/);
  });
});

test("content-failure endpoint rejects free text, coordinates, photos, and unknown reasons", async () => {
  await withApi({ dependencies: dependencies() }, async (base) => {
    for (const body of [
      { reason: "other", place_id: "place:test:1", slot: 1, excluded_place_ids: [] },
      { reason: "incorrect", place_id: "place:test:1", slot: 1, excluded_place_ids: [], text: "details" },
      { reason: "missing", place_id: "place:test:1", slot: 1, excluded_place_ids: [], lat: 40.72 },
      { reason: "inaccessible", place_id: "place:test:1", slot: 1, excluded_place_ids: [], photo: "data" },
    ]) {
      const result = await post(base, body);
      assert.equal(result.response.status, 400);
      assert.equal(result.body.code, "INVALID_CONTENT_FAILURE");
    }
  });
});
