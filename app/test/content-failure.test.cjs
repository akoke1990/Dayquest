const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(appRoot, "App.js"), "utf8");
const {
  CONTENT_FAILURE_REASONS,
  applyContentReplacement,
  buildContentFailureRequest,
  markContentFailure,
} = require("../lib/contentFailure");

function quest() {
  return {
    meta: { content_version_id: "nyc:1.0.0:abc" },
    stops: [1, 2, 3].map((index) => ({
      order_index: index,
      clue: `Clue ${index}`,
      place: { source_id: `place:test:${index}`, name: `Place ${index}` },
    })),
  };
}

test("content-failure reasons are structured and contain no free-form option", () => {
  assert.deepEqual(CONTENT_FAILURE_REASONS.map(({ value }) => value), [
    "unsafe", "blocked_closed", "inaccessible", "missing", "incorrect",
  ]);
});

test("report request contains only curated identifiers and excludes every active stop", () => {
  const activeQuest = quest();
  const request = buildContentFailureRequest(activeQuest, activeQuest.stops[1], "unsafe");
  assert.deepEqual(request, {
    reason: "unsafe",
    place_id: "place:test:2",
    slot: 2,
    excluded_place_ids: ["place:test:1", "place:test:2", "place:test:3"],
    quest_content_version_id: "nyc:1.0.0:abc",
  });
  assert.doesNotMatch(JSON.stringify(request), /lat|lng|coordinate|photo|answer|email|text/i);
});

test("marking a content failure blocks the slot without finding, solving, awarding, or advancing it", () => {
  const progress = { 1: { found: true, checkedIn: true } };
  const next = markContentFailure(progress, 2, "inaccessible", "place:test:2", "unavailable");
  assert.deepEqual(next[1], progress[1]);
  assert.deepEqual(next[2], {
    contentFailure: {
      reason: "inaccessible",
      reported_place_id: "place:test:2",
      status: "unavailable",
    },
  });
  assert.equal(next[2].found, undefined);
  assert.equal(next[2].checkedIn, undefined);
  assert.equal(next[2].itemless, undefined);
  assert.equal(next[3], undefined);
});

test("replacement preserves the current order slot and clears only that slot's unresolved state", () => {
  const activeQuest = quest();
  const progress = markContentFailure({}, 2, "missing", "place:test:2", "pending");
  const replacement = { order_index: 8, clue: "New clue", place: { source_id: "place:test:new" } };
  const result = applyContentReplacement(activeQuest, progress, 2, replacement);

  assert.equal(result.quest.stops.length, 3);
  assert.equal(result.quest.stops[1].order_index, 2);
  assert.equal(result.quest.stops[1].place.source_id, "place:test:new");
  assert.equal(result.progress[2].found, undefined);
  assert.equal(result.progress[2].contentFailure, undefined);
  assert.deepEqual(result.progress[2].contentFailureReport, {
    reason: "missing",
    reported_place_id: "place:test:2",
    status: "replaced",
  });
});

test("current-clue report UI confirms a structured reason and uses the penalty-free replacement path", () => {
  assert.match(appSource, /Report a problem with this stop/);
  assert.match(appSource, /CONTENT_FAILURE_REASONS\.map/);
  assert.match(appSource, /Alert\.alert\(\s*"Replace this stop\?"/);
  assert.match(appSource, /fetch\(`\$\{API_BASE\}\/content-failure`/);
  assert.match(appSource, /No safe replacement is available right now/);

  const handlerStart = appSource.indexOf("async function replaceFailedStop");
  const handlerEnd = appSource.indexOf("\n  function confirmContentFailure", handlerStart);
  assert.notEqual(handlerStart, -1);
  assert.notEqual(handlerEnd, -1);
  const handler = appSource.slice(handlerStart, handlerEnd);
  assert.doesNotMatch(handler, /findStop\s*\(|checkIn\s*\(|addCheckinPoints|collectItem|setFindReveal|found:\s*true/);
});

test("reporting synchronously blocks a simultaneous GPS find before React state updates", () => {
  const reportHandler = appSource.slice(
    appSource.indexOf("async function replaceFailedStop"),
    appSource.indexOf("\n  function confirmContentFailure")
  );
  const checkIn = appSource.slice(
    appSource.indexOf("async function checkIn"),
    appSource.indexOf("\n  // Trigger a FIND")
  );
  const findStop = appSource.slice(
    appSource.indexOf("function findStop"),
    appSource.indexOf("\n  function completeCatch")
  );

  const synchronousBlock = reportHandler.indexOf("contentFailureBlockedPlacesRef.current.add(request.place_id)");
  const asyncStateUpdate = reportHandler.indexOf("setProgress(pendingProgress)");
  assert.ok(synchronousBlock >= 0 && synchronousBlock < asyncStateUpdate);
  assert.match(checkIn, /contentFailureBlockedPlacesRef\.current\.has\(stop\?\.place\?\.source_id\)/);
  assert.match(findStop, /contentFailureBlockedPlacesRef\.current\.has\(stop\?\.place\?\.source_id\)/);
});
