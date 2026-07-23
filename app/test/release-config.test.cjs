const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");

function loadConfig(googleMapsApiKey = "") {
  const configPath = path.join(appRoot, "app.config.js");
  delete require.cache[require.resolve(configPath)];
  const previous = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = googleMapsApiKey;
  try {
    return require(configPath);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previous;
  }
}

test("dynamic Expo config is the only app config and keeps committed map keys blank", () => {
  assert.equal(fs.existsSync(path.join(appRoot, "app.json")), false);
  const config = loadConfig();
  assert.equal(config.orientation, "portrait");
  assert.equal(config.ios.supportsTablet, false);
  assert.equal(config.ios.buildNumber, "1");
  assert.equal(config.extra.GOOGLE_MAPS_API_KEY, "");
  assert.equal(config.ios.config.googleMapsApiKey, "");
  assert.equal(config.android.config.googleMaps.apiKey, "");
});

test("GOOGLE_MAPS_API_KEY is injected into runtime and native config", () => {
  const config = loadConfig("test-google-key");
  assert.equal(config.extra.GOOGLE_MAPS_API_KEY, "test-google-key");
  assert.equal(config.ios.config.googleMapsApiKey, "test-google-key");
  assert.equal(config.android.config.googleMaps.apiKey, "test-google-key");
});

test("location config allows only foreground access", () => {
  const config = loadConfig();
  const location = config.plugins.find(
    (entry) => Array.isArray(entry) && entry[0] === "expo-location"
  );
  assert.ok(location, "expo-location plugin is configured");
  assert.equal(location[1].locationAlwaysPermission, false);
  assert.equal(location[1].locationAlwaysAndWhenInUsePermission, false);
  assert.notEqual(location[1].locationWhenInUsePermission, false);
});

test("camera plugins explicitly disable unused microphone permissions", () => {
  const config = loadConfig();
  for (const pluginName of ["expo-image-picker", "expo-camera"]) {
    const plugin = config.plugins.find((entry) => Array.isArray(entry) && entry[0] === pluginName);
    assert.ok(plugin, `${pluginName} plugin is configured`);
    assert.equal(plugin[1].microphonePermission, false);
  }
  const camera = config.plugins.find((entry) => Array.isArray(entry) && entry[0] === "expo-camera");
  assert.equal(camera[1].recordAudioAndroid, false);
});

test("EAS profiles select named environments and production owns build numbers", () => {
  const eas = require(path.join(appRoot, "eas.json"));
  assert.equal(eas.cli.appVersionSource, "remote");
  assert.equal(eas.build.development.environment, "development");
  assert.equal(eas.build.preview.environment, "preview");
  assert.equal(eas.build.production.environment, "production");
  assert.equal(eas.build.production.autoIncrement, true);
});

test("iOS icon is 1024px square and opaque", () => {
  const output = execFileSync(
    "sips",
    ["-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", path.join(appRoot, "assets/icon.png")],
    { encoding: "utf8" }
  );
  assert.match(output, /pixelWidth: 1024/);
  assert.match(output, /pixelHeight: 1024/);
  assert.match(output, /hasAlpha: no/);
});
