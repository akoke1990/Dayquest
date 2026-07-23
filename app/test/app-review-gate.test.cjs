const assert = require("node:assert/strict");
const test = require("node:test");

const {
  APP_REVIEW_AUDIENCE,
  APP_REVIEW_VERSION,
  evaluateReviewEntitlement,
  loadReviewEntitlement,
} = require("../lib/reviewerEntitlement");

function userWithEntitlement(patch = {}) {
  return {
    id: "reviewer-user",
    app_metadata: {
      dayquest_app_review: {
        aud: APP_REVIEW_AUDIENCE,
        version: APP_REVIEW_VERSION,
        expires_at: "2026-08-01T00:00:00.000Z",
        ...patch,
      },
    },
  };
}

test("review demo gate denies every non-dual-gated combination", () => {
  const now = new Date("2026-07-23T12:00:00.000Z");
  const validUser = userWithEntitlement();

  assert.equal(evaluateReviewEntitlement({ appReviewCapable: false, user: null, now }).available, false);
  assert.equal(evaluateReviewEntitlement({ appReviewCapable: false, user: validUser, now }).available, false);
  assert.equal(evaluateReviewEntitlement({ appReviewCapable: true, user: null, now }).available, false);
  assert.equal(evaluateReviewEntitlement({ appReviewCapable: true, user: {}, now }).available, false);
  assert.equal(evaluateReviewEntitlement({ appReviewCapable: true, user: validUser, now }).available, true);
});

test("review demo gate rejects expired, wrong audience, and wrong version entitlements", () => {
  const now = new Date("2026-07-23T12:00:00.000Z");
  for (const patch of [
    { expires_at: "2026-07-23T11:59:59.000Z" },
    { aud: "com.example.other" },
    { version: "1.0.1" },
    { expires_at: "not-a-date" },
  ]) {
    const result = evaluateReviewEntitlement({
      appReviewCapable: true,
      user: userWithEntitlement(patch),
      now,
    });
    assert.equal(result.available, false);
  }
});

test("review demo entitlement is loaded only from fresh Supabase getUser and server-time verification", async () => {
  let getUserCalls = 0;
  let rpcCalls = 0;
  const supabase = {
    auth: {
      getUser: async () => {
        getUserCalls += 1;
        return { data: { user: userWithEntitlement() }, error: null };
      },
      getSession: async () => {
        throw new Error("getSession must not authorize review mode");
      },
    },
    rpc: async (name) => {
      rpcCalls += 1;
      assert.equal(name, "dayquest_verify_app_review_entitlement");
      return { data: true, error: null };
    },
  };

  const result = await loadReviewEntitlement(supabase, {
    appReviewCapable: true,
    now: new Date("2026-07-23T12:00:00.000Z"),
  });

  assert.equal(getUserCalls, 1);
  assert.equal(rpcCalls, 1);
  assert.equal(result.available, true);
  assert.equal(result.userId, "reviewer-user");
});

test("review demo entitlement fails closed when server-time authorization denies or is unavailable", async () => {
  for (const rpc of [
    async () => ({ data: false, error: null }),
    async () => ({ data: null, error: new Error("rpc unavailable") }),
    async () => { throw new Error("offline"); },
  ]) {
    const result = await loadReviewEntitlement({
      auth: { getUser: async () => ({ data: { user: userWithEntitlement() }, error: null }) },
      rpc,
    }, {
      appReviewCapable: true,
      // A manipulated device clock must not be enough to authorize access.
      now: new Date("2020-01-01T00:00:00.000Z"),
    });
    assert.equal(result.available, false);
    assert.equal(result.reason, "server_verification_failed");
  }
});

test("review demo entitlement fails closed when getUser errors", async () => {
  const result = await loadReviewEntitlement(
    { auth: { getUser: async () => ({ data: { user: null }, error: new Error("offline") }) } },
    { appReviewCapable: true, now: new Date("2026-07-23T12:00:00.000Z") }
  );

  assert.equal(result.available, false);
});
