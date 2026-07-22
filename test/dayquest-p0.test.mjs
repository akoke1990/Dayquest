import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const APP_URL = new URL("../app/App.js", import.meta.url);

async function appSource() {
  return readFile(APP_URL, "utf8");
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

async function loadReadScore(storedValue) {
  const source = await appSource();
  const declaration = sourceBetween(
    source,
    "async function readScore()",
    "// Apply one completed quest to the score"
  );
  const AsyncStorage = {
    async getItem() {
      return storedValue;
    },
  };
  return vm.runInNewContext(`${declaration}\nreadScore`, {
    AsyncStorage,
    SCORE_KEY: "dq_score_v1",
  });
}

test("readScore preserves shield state and supplies legacy defaults", async () => {
  const persistedReadScore = await loadReadScore(
    JSON.stringify({
      total: 150,
      quests_completed: 2,
      streak_weeks: 3,
      last_week_index: 42,
      shield: 0,
      shield_used_week: 42,
    })
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(await persistedReadScore())),
    {
      total: 150,
      quests_completed: 2,
      streak_weeks: 3,
      last_week_index: 42,
      shield: 0,
      shield_used_week: 42,
    }
  );

  const legacyReadScore = await loadReadScore(
    JSON.stringify({
      total: 25,
      quests_completed: 1,
      streak_weeks: 1,
      last_week_index: 41,
    })
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(await legacyReadScore())),
    {
      total: 25,
      quests_completed: 1,
      streak_weeks: 1,
      last_week_index: 41,
      shield: 1,
      shield_used_week: null,
    }
  );
});

test("readScore returns complete defaults when no score is stored", async () => {
  const readMissingScore = await loadReadScore(null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await readMissingScore())),
    {
      total: 0,
      quests_completed: 0,
      streak_weeks: 0,
      last_week_index: null,
      shield: 1,
      shield_used_week: null,
    }
  );
});

test("shared completion submits the genuine earned find count", async () => {
  const source = await appSource();
  const completionEffect = sourceBetween(
    source,
    "// Fire quest_completed exactly once",
    "// Auto-present the completion overlay exactly once"
  );

  assert.match(
    completionEffect,
    /const earnedFindCount = quest\.stops\.filter\([\s\S]*?\.itemless[\s\S]*?\)\.length;/
  );
  assert.match(completionEffect, /found_count:\s*earnedFindCount\b/);
  assert.doesNotMatch(completionEffect, /found_count:\s*foundCount\b/);
});
