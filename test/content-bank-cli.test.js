import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;

function run(script, args = []) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
}

test("importer CLI writes deterministic validated content without changing source candidates", () => {
  const dir = mkdtempSync(join(tmpdir(), "dayquest-bank-"));
  const output = join(dir, "bank.json");
  const candidatePath = new URL("../content/nyc/source-candidates.v2.json", import.meta.url);
  const candidateBytes = readFileSync(candidatePath, "utf8");
  const args = ["scripts/import-nyc-content-bank.js", "--out", output];
  const first = run(...[args[0], args.slice(1)]);
  assert.equal(first.status, 0, first.stderr);
  const bytes = readFileSync(output, "utf8");
  const second = run(...[args[0], args.slice(1)]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(output, "utf8"), bytes);
  assert.equal(readFileSync(candidatePath, "utf8"), candidateBytes);
  assert.match(first.stdout, /248 places; 100 hunt ideas; 100 clue packages/);
});

test("candidate compiler is byte-idempotent and never overwrites durable research tranches", () => {
  const dir = mkdtempSync(join(tmpdir(), "dayquest-candidates-"));
  const output = join(dir, "candidates.json");
  const sourcePaths = [
    "content/nyc/source-candidates.v1.json",
    "content/nyc/research/village.v1.json",
    "content/nyc/research/east-village-chinatown.v1.json",
    "content/nyc/research/fidi-battery.v1.json",
    "content/nyc/research/new-place-coordinates.v1.json",
  ].map((path) => new URL(`../${path}`, import.meta.url));
  const before = sourcePaths.map((path) => readFileSync(path, "utf8"));
  const first = run("scripts/compile-nyc-source-candidates.js", [output]);
  assert.equal(first.status, 0, first.stderr);
  const bytes = readFileSync(output, "utf8");
  const second = run("scripts/compile-nyc-source-candidates.js", [output]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(output, "utf8"), bytes);
  assert.deepEqual(sourcePaths.map((path) => readFileSync(path, "utf8")), before);
  assert.match(first.stdout, /100 candidates \(60 new; 18 exact mappings; 42 new places\)/);
});

test("validator CLI exits nonzero for invalid content", () => {
  const dir = mkdtempSync(join(tmpdir(), "dayquest-bank-invalid-"));
  const input = join(dir, "invalid.json");
  writeFileSync(input, JSON.stringify({ schema_version: "1.0.0", site_id: "nyc", places: [], hunt_ideas: [], clue_packages: [], difficulty: "hard" }));
  const result = run("scripts/validate-content-bank.js", [input]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /difficulty is not part of content-bank v1/);
});

test("remote-verification compiler and validator CLIs are deterministic", () => {
  const dir = mkdtempSync(join(tmpdir(), "dayquest-remote-"));
  const output = join(dir, "remote.json");
  const first = run("scripts/compile-remote-verification.js", ["--out", output]);
  assert.equal(first.status, 0, first.stderr);
  const bytes = readFileSync(output, "utf8");
  const second = run("scripts/compile-remote-verification.js", ["--out", output]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(output, "utf8"), bytes);
  assert.match(first.stdout, /Compiled 100 remote verification records with 100 claims/);
  const validation = run("scripts/validate-remote-verification.js", [output]);
  assert.equal(validation.status, 0, validation.stderr);
  assert.match(validation.stdout, /Valid remote verification v1.0.0: 100 records; 100 claims/);
});

test("remote-verification validator exits nonzero for malformed content", () => {
  const dir = mkdtempSync(join(tmpdir(), "dayquest-remote-invalid-"));
  const input = join(dir, "invalid.json");
  writeFileSync(input, JSON.stringify({ schema_version: "1.0.0", site_id: "nyc", registry_version: "1.0.0", generated_from: "test", verifications: [], raw_route: [] }));
  const result = run("scripts/validate-remote-verification.js", [input]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /raw_route is not allowed|raw_route is forbidden/);
});
