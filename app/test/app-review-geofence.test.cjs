const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");
const { FIND_RADIUS_M, distanceM, isWithinFindRadius } = require("../lib/geofence");
const { APP_REVIEW_ROUTE, validateAppReviewRoute } = require("../lib/reviewRoute");

function assertNoLifecycleFields(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoLifecycleFields);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    assert.notEqual(key, "published");
    assert.notEqual(key, "field_verified");
    assert.notEqual(key, "canary_eligible");
    assertNoLifecycleFields(value[key]);
  }
}

test("shared find geofence stays exactly 50m and distinguishes 65m from 45m", () => {
  assert.equal(FIND_RADIUS_M, 50);
  const stop = APP_REVIEW_ROUTE.stops[0];
  const outside = stop.simulated_walk.find((step) => step.label === "65m outside");
  const inside = stop.simulated_walk.find((step) => step.label === "45m inside");

  assert.ok(outside, "route includes a deterministic outside-radius checkpoint");
  assert.ok(inside, "route includes a deterministic inside-radius checkpoint");
  assert.ok(distanceM(outside.latitude, outside.longitude, stop.place.lat, stop.place.lng) > FIND_RADIUS_M);
  assert.ok(distanceM(inside.latitude, inside.longitude, stop.place.lat, stop.place.lng) <= FIND_RADIUS_M);
  assert.equal(isWithinFindRadius(outside, stop.place), false);
  assert.equal(isWithinFindRadius(inside, stop.place), true);
});

test("bundled App Review route is isolated demonstration content with exactly three stops", () => {
  const validation = validateAppReviewRoute(APP_REVIEW_ROUTE);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(APP_REVIEW_ROUTE.purpose, "app_review_demonstration");
  assert.equal(APP_REVIEW_ROUTE.version, "1.0.0");
  assert.equal(APP_REVIEW_ROUTE.stops.length, 3);
  assertNoLifecycleFields(APP_REVIEW_ROUTE);
  for (const stop of APP_REVIEW_ROUTE.stops) {
    assert.match(stop.place.name, /^Demo /);
    assert.ok(stop.quest_prompt);
    assert.deepEqual(stop.simulated_walk.map((step) => step.label), [
      "350m cold",
      "220m cool",
      "120m warm",
      "65m outside",
      "45m inside",
    ]);
  }
});

test("App.js uses the shared geofence module instead of local radius math", () => {
  const source = fs.readFileSync(path.join(appRoot, "App.js"), "utf8");
  assert.match(source, /from "\.\/lib\/geofence"/);
  assert.doesNotMatch(source, /const FIND_RADIUS_M\s*=/);
  assert.doesNotMatch(source, /function distanceM\(/);
  assert.match(source, /isWithinFindRadius\(/);
});
