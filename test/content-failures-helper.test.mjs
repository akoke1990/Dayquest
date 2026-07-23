import assert from "node:assert/strict";
import test from "node:test";

import { contentFailuresConfigured, persistContentFailure } from "../lib/content-failures.js";

const validReport = {
  reason: "unsafe",
  place_id: "place:test:reported",
  quest_content_version_id: "nyc:1.0.0:abc",
  priority: "safety",
  curator_action: "immediate_review",
  accessibility_status: "unknown",
  request_id: "11111111-1111-4111-8111-111111111111",
  status: "open",
};

test("content-failure configuration requires both service-role environment values", () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_KEY;
  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    assert.equal(contentFailuresConfigured(), false);
    process.env.SUPABASE_URL = "https://example.supabase.co";
    assert.equal(contentFailuresConfigured(), false);
    process.env.SUPABASE_SERVICE_KEY = "service-role-test-value";
    assert.equal(contentFailuresConfigured(), true);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = previousKey;
  }
});

test("durable helper inserts only the closed structured report contract", async () => {
  let table;
  let row;
  let signal;
  const client = {
    from(value) {
      table = value;
      return {
        insert(valueToInsert) {
          row = valueToInsert;
          return {
            async abortSignal(value) {
              signal = value;
              return { error: null };
            },
          };
        },
      };
    },
  };

  const persisted = await persistContentFailure({
    ...validReport,
    email: "private@example.test",
    user_id: "forbidden",
    install_id: "forbidden",
    lat: 40.7,
    route: [1, 2],
    clue_text: "forbidden",
    answer: "forbidden",
    free_form: "forbidden",
  }, { client });

  assert.equal(persisted, true);
  assert.equal(table, "content_failures");
  assert.deepEqual(row, validReport);
  assert.ok(signal instanceof AbortSignal);
});
