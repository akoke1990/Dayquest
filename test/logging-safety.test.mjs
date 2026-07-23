import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = ["api-server.js", "area.js", "quest.js", "sharedhunts.js", "sources.js"];

test("serving paths never log raw upstream errors, secrets, coordinates, routes, tokens, or photos", async () => {
  for (const file of files) {
    const source = await readFile(new URL(`../lib/${file}`, import.meta.url), "utf8");
    const consoleCalls = source.split("\n").filter((line) => /console\.(?:log|warn|error)/.test(line));
    for (const line of consoleCalls) {
      assert.doesNotMatch(line, /err(?:or)?\.message|reason\?\.message|\$\{(?:lat|lng|label|url|key|token|route|photo)/i, `${file}: ${line.trim()}`);
    }
  }
});
