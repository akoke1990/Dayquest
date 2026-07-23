const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(appRoot, "App.js"), "utf8");

function sourceBetween(startNeedle, endNeedle) {
  const start = appSource.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing source start: ${startNeedle}`);
  const end = appSource.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing source end: ${endNeedle}`);
  return appSource.slice(start, end);
}

test("authored stop hints normalize strings and objects without fabricating movement nudges", () => {
  const { normalizeStopHints } = require("../lib/hintFlow");
  const stop = {
    hints: [
      " Look up at the clock face. ",
      { text: "Find the carved initials near the west entrance." },
      { text: "Look up at the clock face." },
      "A third hint should not appear.",
    ],
    hint: "Legacy fallback should not appear when authored hints exist.",
  };

  assert.deepEqual(normalizeStopHints(stop), [
    "Look up at the clock face.",
    "Find the carved initials near the west entrance.",
  ]);
  assert.deepEqual(normalizeStopHints({ hints: " Under the arch. ", hint: "Fallback" }), [
    "Under the arch.",
  ]);
  assert.deepEqual(normalizeStopHints({ hints: { text: " Count the bronze birds. " } }), [
    "Count the bronze birds.",
  ]);
  assert.deepEqual(normalizeStopHints({ place: { kind: "monument" } }), []);
});

test("authored stop hints fall back to one legacy hint without inventing a second hint", () => {
  const { normalizeStopHints } = require("../lib/hintFlow");

  assert.deepEqual(normalizeStopHints({ hints: ["   "], hint: " Try the plaque by the gate. " }), [
    "Try the plaque by the gate.",
  ]);
  assert.deepEqual(normalizeStopHints({ hints: [], hint: "" }), []);
});

test("hint ladder uses authored hints and leaves movement in the directive", () => {
  const ladder = sourceBetween("HINT LADDER", "{/* Guide: exact unnamed marker only.");

  assert.match(appSource, /const currentHints = normalizeStopHints\(currentTarget\)/);
  assert.match(ladder, /currentHints\.map/);
  assert.doesNotMatch(ladder, /nudgeText|currentTarget\.hint|currentTarget\.description|place\.kind/);
  assert.match(appSource, /Warmer — keep heading this way/);
  assert.equal(appSource.includes("diffPip"), false);
});

test("guide action copy and handler are not wired to the find/award path", () => {
  const guideHandler = sourceBetween("function activateGuidance(orderIndex)", "  // Manual recenter");

  assert.equal(appSource.includes("still counts"), false);
  assert.match(appSource, /Guide me there/);
  assert.match(guideHandler, /\[orderIndex\]: \{ \.\.\.progress\[orderIndex\], guided: true \}/);
  assert.match(guideHandler, /AsyncStorage\.setItem/);
  assert.doesNotMatch(guideHandler, /findStop\s*\(|checkIn\s*\(|setFindReveal|found:\s*true|awardItem|viaEscape/);
});

test("guided target marker is current-target only and unnamed", () => {
  const guidedMarker = sourceBetween(
    "{guidanceActive && currentTarget?.place ? (",
    "      </MapView>"
  );
  const checkIn = sourceBetween("async function checkIn(orderIndex)", "  // Trigger a FIND");

  assert.match(appSource, /const guidanceActive = !!currentTarget && !!progress\[currentTarget\.order_index\]\?\.guided/);
  assert.match(guidedMarker, /<Marker/);
  assert.match(guidedMarker, /<MapPin orderIndex=\{currentTarget\.order_index\} guided \/>/);
  assert.doesNotMatch(guidedMarker, /\btitle=|\bdescription=|onPress=|selectStop|findStop/);
  assert.match(checkIn, /\[orderIndex\]: \{ \.\.\.progress\[orderIndex\], checkedIn: true, found: true \}/);
  assert.match(checkIn, /guided: !!progress\[orderIndex\]\?\.guided/);
});
