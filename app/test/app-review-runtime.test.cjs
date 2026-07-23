const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  REVIEW_DEMO_BANNER,
  REVIEW_DEMO_RECAP_LABEL,
  createReviewDemoRuntime,
} = require("../lib/reviewQuestRuntime");

const repoRoot = path.resolve(__dirname, "..", "..");

function throwingSinks() {
  const fail = (name) => () => {
    throw new Error(`review runtime called production sink: ${name}`);
  };
  return {
    location: {
      requestPermission: fail("location.requestPermission"),
      getCurrentPosition: fail("location.getCurrentPosition"),
      watchPosition: fail("location.watchPosition"),
    },
    storage: {
      getItem: fail("storage.getItem"),
      setItem: fail("storage.setItem"),
      removeItem: fail("storage.removeItem"),
      multiRemove: fail("storage.multiRemove"),
    },
    networkFetch: fail("fetch"),
    analytics: fail("analytics"),
    feedback: fail("feedback"),
    score: fail("score"),
    pushScore: fail("pushScore"),
    postHuntResult: fail("postHuntResult"),
    notification: fail("notification"),
    photoStorage: fail("photoStorage"),
    createInstallId: fail("createInstallId"),
    supabaseGameplayMutation: fail("supabaseGameplayMutation"),
  };
}

test("review demo runtime completes entirely in memory without production sinks", () => {
  const runtime = createReviewDemoRuntime({ sinks: throwingSinks() });
  const quest = runtime.start();

  assert.equal(quest.purpose, "app_review_demonstration");
  assert.equal(quest.stops.length, 3);
  assert.equal(runtime.bannerText, REVIEW_DEMO_BANNER);
  assert.equal(runtime.recapLabel, REVIEW_DEMO_RECAP_LABEL);

  for (const stop of quest.stops) {
    assert.equal(runtime.currentStop().order_index, stop.order_index);
    assert.equal(runtime.currentCheckpoint().label, "350m cold");
    runtime.advanceSimulatedWalk();
    runtime.advanceSimulatedWalk();
    const outside = runtime.advanceSimulatedWalk();
    assert.equal(outside.label, "65m outside");
    assert.equal(runtime.tryFindCurrentStop().found, false);

    const inside = runtime.advanceSimulatedWalk();
    assert.equal(inside.label, "45m inside");
    const result = runtime.tryFindCurrentStop();
    assert.equal(result.found, true);
    assert.equal(runtime.getProgress()[stop.order_index].found, true);
  }

  assert.equal(runtime.isComplete(), true);
  assert.equal(runtime.buildRecap().label, "Demo — not saved");
  assert.equal(Object.keys(runtime.getProgress()).length, 3);

  const restarted = createReviewDemoRuntime({ sinks: throwingSinks() });
  restarted.start();
  assert.deepEqual(restarted.getProgress(), {});
});

test("review demo runtime exposes no production delivery endpoint", () => {
  const runtime = createReviewDemoRuntime({ sinks: throwingSinks() });
  const quest = runtime.start();
  assert.equal(quest.meta.purpose, "app_review_demonstration");
  assert.equal(quest.meta.route_id, "app-review-demonstration-v1");
  assert.equal(quest.meta.api_path, undefined);
  assert.doesNotMatch(JSON.stringify(quest), /\/quest|\/event|\/feedback|\/score|shared_hunts/i);
});

test("public quest delivery does not import or serve the App Review fixture", () => {
  for (const relative of ["server.js", "lib/api-server.js", "lib/curated-quest.js", "lib/content-bank.js"]) {
    const source = fs.readFileSync(path.join(repoRoot, relative), "utf8");
    assert.doesNotMatch(source, /app-review-route|app_review_demonstration|app-review-demonstration/i);
  }
});
