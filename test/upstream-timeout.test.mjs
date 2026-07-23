import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI and Supabase upstream calls have explicit deadlines", async () => {
  const quest = await readFile(new URL("../lib/quest.js", import.meta.url), "utf8");
  assert.match(quest, /ANTHROPIC_TIMEOUT_MS/);
  assert.match(quest, /maxRetries:\s*0/);
  const poi = await readFile(new URL("../lib/poidb.js", import.meta.url), "utf8");
  const shared = await readFile(new URL("../lib/sharedhunts.js", import.meta.url), "utf8");
  assert.match(poi, /\.abortSignal\(AbortSignal\.timeout\(SUPABASE_TIMEOUT_MS\)\)/);
  assert.match(shared, /\.abortSignal\(AbortSignal\.timeout\(SUPABASE_TIMEOUT_MS\)\)/);
});
