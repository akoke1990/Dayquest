import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApiHandler } from "../lib/api-server.js";

async function withApi(options, run) {
  const server = createServer(createApiHandler(options));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function providerTraps(overrides = {}) {
  const trap = async () => { throw new Error("provider path must not run"); };
  return {
    loadCuratedQuest: async () => null,
    buildQuest: trap,
    resolveArea: trap,
    resolvePlace: trap,
    fetchSharedHunt: async () => null,
    upsertSharedHunt: async () => false,
    sharedHuntsConfigured: () => false,
    appendRecord: () => {},
    ...overrides,
  };
}

async function json(response) {
  return { response, body: await response.json() };
}

test("health, readiness, and root are bounded provider-free fast paths", async () => {
  await withApi({ dependencies: providerTraps() }, async (base) => {
    for (const path of ["/health", "/ready", "/"]) {
      const start = performance.now();
      const { response, body } = await json(await fetch(base + path));
      assert.equal(response.status, 200);
      assert.ok(performance.now() - start < 200, `${path} exceeded local fast-path budget`);
      assert.equal(body.service, "dayquest");
    }
  });
});

test("eligible curated quest bypasses area and live providers", async () => {
  let providerCalls = 0;
  const curated = {
    theme: "Curated NYC",
    intro: "Three verified finds.",
    origin: { lat: 40.72, lng: -74, label: "NYC" },
    stops: [{}, {}, {}],
    meta: { mode: "curated", content_version_id: "bank:abc" },
  };
  await withApi({ dependencies: providerTraps({
    loadCuratedQuest: async () => curated,
    buildQuest: async () => { providerCalls += 1; },
    resolveArea: async () => { providerCalls += 1; },
  }) }, async (base) => {
    const { response, body } = await json(await fetch(`${base}/quest?lat=40.72&lng=-74`));
    assert.equal(response.status, 200);
    assert.equal(body.meta.mode, "curated");
    assert.equal(body.meta.content_version_id, "bank:abc");
    assert.equal(providerCalls, 0);
  });
});

test("curated-bank failure degrades to safe provider fallback", async () => {
  let builds = 0;
  await withApi({ dependencies: providerTraps({
    loadCuratedQuest: async () => { throw new Error("broken bank"); },
    resolveArea: async () => ({ name: "Fallback Area" }),
    buildQuest: async () => {
      builds += 1;
      return { theme: "Fallback", intro: "Safe fallback", origin: {}, stops: [{}, {}, {}], meta: { mode: "preview" } };
    },
  }) }, async (base) => {
    const { response, body } = await json(await fetch(`${base}/quest?lat=40.72&lng=-74`));
    assert.equal(response.status, 200);
    assert.equal(body.meta.mode, "preview");
    assert.equal(builds, 1);
  });
});

test("malformed and oversized JSON receive sanitized 400 and 413 responses", async () => {
  await withApi({ dependencies: providerTraps(), bodyLimits: { default: 64 } }, async (base) => {
    const malformed = await json(await fetch(`${base}/feedback`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{oops",
    }));
    assert.equal(malformed.response.status, 400);
    assert.equal(malformed.body.code, "INVALID_JSON");
    assert.ok(malformed.body.request_id);
    assert.equal(typeof malformed.body.error, "string");
    assert.doesNotMatch(malformed.body.error, /SyntaxError|stack/i);

    const oversized = await json(await fetch(`${base}/feedback`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x".repeat(100) }),
    }));
    assert.equal(oversized.response.status, 413);
    assert.equal(oversized.body.code, "BODY_TOO_LARGE");
  });
});

test("client scores are stored and acknowledged only as non-authoritative submissions", async () => {
  const records = [];
  await withApi({ dependencies: providerTraps({ appendRecord: (file, record) => records.push({ file, record }) }) }, async (base) => {
    const { response, body } = await json(await fetch(`${base}/score`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ points: 999999, time_s: 1, install_id: "tester" }),
    }));
    assert.equal(response.status, 202);
    assert.equal(body.authoritative, false);
    assert.equal(records.length, 1);
    assert.equal(records[0].record.authoritative, false);
    assert.equal(records[0].record.authority, "client_reported");
  });
});

test("route deadlines return a structured 504 without leaking provider errors", async () => {
  await withApi({
    routeTimeoutMs: 25,
    dependencies: providerTraps({
      loadCuratedQuest: async () => null,
      resolveArea: async () => ({ name: "NYC" }),
      buildQuest: async () => new Promise(() => {}),
    }),
  }, async (base) => {
    const start = performance.now();
    const { response, body } = await json(await fetch(`${base}/quest?lat=40.72&lng=-74`));
    assert.equal(response.status, 504);
    assert.equal(body.code, "ROUTE_TIMEOUT");
    assert.ok(performance.now() - start < 250);
  });
});

test("provider failures degrade to sanitized 503 responses", async () => {
  await withApi({ dependencies: providerTraps({
    loadCuratedQuest: async () => null,
    resolveArea: async () => ({ name: "NYC" }),
    buildQuest: async () => { throw new Error("upstream secret token=do-not-leak"); },
  }) }, async (base) => {
    const { response, body } = await json(await fetch(`${base}/quest?lat=40.72&lng=-74`));
    assert.equal(response.status, 503);
    assert.equal(body.code, "QUEST_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(body), /do-not-leak|token=/);
  });
});

test("photo payloads are size-capped and raw upload is explicitly unsupported", async () => {
  await withApi({ dependencies: providerTraps(), bodyLimits: { photo: 32 } }, async (base) => {
    const oversized = await json(await fetch(`${base}/photo`, {
      method: "POST", headers: { "content-type": "application/octet-stream" }, body: "x".repeat(64),
    }));
    assert.equal(oversized.response.status, 413);
    assert.equal(oversized.body.code, "BODY_TOO_LARGE");
    const unsupported = await json(await fetch(`${base}/photo`, {
      method: "POST", headers: { "content-type": "application/octet-stream" }, body: "small",
    }));
    assert.equal(unsupported.response.status, 501);
    assert.equal(unsupported.body.code, "PHOTO_UPLOAD_UNSUPPORTED");
  });
});

test("production CORS allows native requests and configured origins but rejects unknown browser origins", async () => {
  await withApi({ dependencies: providerTraps(), production: true, allowedOrigins: ["https://app.dayquest.example"] }, async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const allowed = await fetch(`${base}/health`, { headers: { origin: "https://app.dayquest.example" } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.dayquest.example");
    const denied = await json(await fetch(`${base}/health`, { headers: { origin: "https://evil.example" } }));
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.code, "ORIGIN_NOT_ALLOWED");
  });
});

test("endpoint-specific rate limits return Retry-After", async () => {
  await withApi({ dependencies: providerTraps(), rateLimits: { feedback: { max: 1, windowMs: 60_000 } } }, async (base) => {
    const send = () => fetch(`${base}/feedback`, {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" }, body: "{}",
    });
    assert.equal((await send()).status, 200);
    const limited = await send();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  });
});
