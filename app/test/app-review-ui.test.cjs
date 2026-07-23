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

test("App Review entry is explicit and rendered only for verified entitled reviewers", () => {
  assert.match(appSource, /APP_REVIEW_CAPABLE/);
  assert.match(appSource, /loadReviewEntitlement/);
  const welcome = sourceBetween('if (screen === "welcome" || screen === "error")', "{renderMenuDrawer()}");
  assert.match(welcome, /reviewEntitlement\.available[\s\S]*App Review Demonstration/);
  assert.doesNotMatch(welcome, /AsyncStorage\.getItem[\s\S]*app_review|email[\s\S]*App Review Demonstration/i);
});

test("entering App Review revalidates the entitlement with the server", () => {
  const startDemo = sourceBetween("async function startAppReviewDemo()", "  function syncAppReviewDemo");
  assert.match(startDemo, /await refreshReviewEntitlement\(\)/);
  assert.match(startDemo, /if \(!nextEntitlement\.available\) return/);
});

test("App Review demo screen shows persistent simulation banner and non-saved recap label", () => {
  const demoScreen = sourceBetween('if (screen === "appReviewDemo")', 'if (screen === "hydrating")');
  assert.match(demoScreen, /REVIEW_DEMO_BANNER/);
  assert.match(demoScreen, /REVIEW_DEMO_RECAP_LABEL/);
  assert.match(demoScreen, /Advance simulated walk/);
  assert.match(demoScreen, /I found it!/);
  assert.match(demoScreen, /simulated location, progress not saved/);
});

test("App Review demo path does not call production side-effect sinks", () => {
  const startDemo = sourceBetween("function startAppReviewDemo()", "  async function startQuest");
  const demoScreen = sourceBetween('if (screen === "appReviewDemo")', 'if (screen === "hydrating")');
  const combined = `${startDemo}\n${demoScreen}`;
  assert.doesNotMatch(combined, /Location\./);
  assert.doesNotMatch(combined, /fetch\(/);
  assert.doesNotMatch(combined, /AsyncStorage\.(getItem|setItem|removeItem|multiRemove)/);
  assert.doesNotMatch(combined, /\btrack\(/);
  assert.doesNotMatch(combined, /sendFeedback|postScore|pushScore|postHuntResult/);
  assert.doesNotMatch(combined, /Notifications\.|persistPhoto|takePhoto|CameraCatch|getInstallId/);
});

test("sign-out and account deletion clear App Review entitlement access", () => {
  const signOutHandler = sourceBetween("async function handleSignOut()", "  async function clearLocalData");
  const deletionHandler = sourceBetween("async function confirmAccountDeletion()", "  function requestAccountDeletion");
  assert.match(signOutHandler, /setReviewEntitlement\(REVIEW_ENTITLEMENT_UNAVAILABLE\)/);
  assert.match(deletionHandler, /setReviewEntitlement\(REVIEW_ENTITLEMENT_UNAVAILABLE\)/);
});

test("deep links are not an App Review activation path", () => {
  const deepLinks = sourceBetween("// --- Deep links:", "// Dispatch a stashed deep link");
  assert.match(deepLinks, /host !== "friend" && host !== "join"/);
  assert.doesNotMatch(deepLinks, /appReview|app-review|review/i);
});
