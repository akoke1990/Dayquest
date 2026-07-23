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
    contentFailuresConfigured: () => false,
    persistContentFailure: async () => false,
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

test("configured unsafe report is durably stored before returning a curated same-slot replacement", async () => {
  const records = [];
  const persisted = [];
  const sequence = [];
  const calls = [];
  const replacement = { order_index: 99, clue: "Replacement clue", place: { source_id: "place:test:new" } };
  await withApi({ production: true, dependencies: dependencies({
    appendRecord: (file, record) => records.push({ file, record }),
    contentFailuresConfigured: () => true,
    persistContentFailure: async (record) => { sequence.push("persist"); persisted.push(record); return true; },
    loadCuratedReplacement: async (input) => { sequence.push("replace"); calls.push(input); return replacement; },
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
    assert.equal(result.body.report.durable_persisted, true);
    assert.match(result.body.report.request_id, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(sequence, ["persist", "replace"]);
    assert.deepEqual(calls[0], {
      reportedPlaceId: "place:test:reported",
      excludedPlaceIds: new Set(["place:test:a", "place:test:b", "place:test:reported"]),
      orderIndex: 2,
    });
    const expectedRecord = {
      reason: "unsafe",
      place_id: "place:test:reported",
      quest_content_version_id: "nyc:1.0.0:abc",
      priority: "safety",
      curator_action: "immediate_review",
      accessibility_status: "unknown",
      request_id: result.body.report.request_id,
      status: "open",
    };
    assert.deepEqual(persisted, [expectedRecord]);
    assert.deepEqual(records, [{ file: "content-failures.jsonl", record: expectedRecord }]);
  });
});

test("unconfigured nonproduction keeps local fallback and reports that persistence was not durable", async () => {
  const replacement = { clue: "Local replacement", place: { source_id: "place:test:new" } };
  await withApi({ production: false, dependencies: dependencies({
    loadCuratedReplacement: async () => replacement,
  }) }, async (base) => {
    const result = await post(base, {
      reason: "incorrect",
      place_id: "place:test:reported",
      slot: 1,
      excluded_place_ids: ["place:test:reported"],
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.report.durable_persisted, false);
    assert.match(result.body.report.request_id, /^[0-9a-f-]{36}$/i);
  });
});

test("unconfigured production fails closed before selecting any replacement", async () => {
  let replacementCalls = 0;
  await withApi({ production: true, dependencies: dependencies({
    loadCuratedReplacement: async () => { replacementCalls += 1; return { clue: "must not return" }; },
  }) }, async (base) => {
    const result = await post(base, {
      reason: "unsafe",
      place_id: "place:test:reported",
      slot: 1,
      excluded_place_ids: ["place:test:reported"],
    });
    assert.equal(result.response.status, 503);
    assert.equal(result.body.code, "CONTENT_FAILURE_PERSISTENCE_UNAVAILABLE");
    assert.equal(result.body.penalty, false);
    assert.equal(result.body.report.durable_persisted, false);
    assert.equal(result.body.report.request_id, result.body.request_id);
    assert.equal(result.body.replacement, undefined);
    assert.equal(replacementCalls, 0);
  });
});

test("production durable write failure is sanitized and fails closed before replacement", async () => {
  let replacementCalls = 0;
  await withApi({ production: true, dependencies: dependencies({
    contentFailuresConfigured: () => true,
    persistContentFailure: async () => { throw new Error("postgres secret raw failure"); },
    loadCuratedReplacement: async () => { replacementCalls += 1; return { clue: "must not return" }; },
  }) }, async (base) => {
    const result = await post(base, {
      reason: "blocked_closed",
      place_id: "place:test:reported",
      slot: 1,
      excluded_place_ids: ["place:test:reported"],
    });
    assert.equal(result.response.status, 503);
    assert.equal(result.body.code, "CONTENT_FAILURE_PERSISTENCE_UNAVAILABLE");
    assert.equal(result.body.penalty, false);
    assert.equal(result.body.report.durable_persisted, false);
    assert.equal(result.body.report.request_id, result.body.request_id);
    assert.doesNotMatch(JSON.stringify(result.body), /postgres|secret|raw failure/i);
    assert.equal(replacementCalls, 0);
  });
});

test("durably recorded report returns explicit unavailable when no curated replacement exists", async () => {
  let replacementCalls = 0;
  await withApi({ production: true, dependencies: dependencies({
    contentFailuresConfigured: () => true,
    persistContentFailure: async () => true,
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
    assert.equal(result.body.report.durable_persisted, true);
    assert.equal(result.body.report.request_id, result.body.request_id);
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

test("content-failure endpoint rejects free text, coordinates, routes, media, clue content, and identifiers", async () => {
  let persistenceCalls = 0;
  await withApi({ dependencies: dependencies({
    contentFailuresConfigured: () => true,
    persistContentFailure: async () => { persistenceCalls += 1; return true; },
  }) }, async (base) => {
    const valid = {
      reason: "incorrect",
      place_id: "place:test:1",
      slot: 1,
      excluded_place_ids: ["place:test:1"],
    };
    for (const body of [
      { ...valid, reason: "other" },
      { ...valid, text: "details" },
      { ...valid, lat: 40.72 },
      { ...valid, lng: -74 },
      { ...valid, route: [[40.72, -74]] },
      { ...valid, photo: "data" },
      { ...valid, clue_text: "secret clue" },
      { ...valid, answer: "secret answer" },
      { ...valid, email: "private@example.test" },
      { ...valid, ip: "192.0.2.1" },
      { ...valid, user_id: "user" },
      { ...valid, install_id: "install" },
      { ...valid, free_form: "details" },
    ]) {
      const result = await post(base, body);
      assert.equal(result.response.status, 400);
      assert.equal(result.body.code, "INVALID_CONTENT_FAILURE");
    }
    assert.equal(persistenceCalls, 0);
  });
});
