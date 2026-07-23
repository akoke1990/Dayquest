import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  compileRemoteVerification,
  evaluateCanaryGate,
  validateRemoteVerification,
  validateSourceRegistry,
} from "../lib/source-verification.js";

const registryPath = new URL("../content/nyc/source-registry.v1.json", import.meta.url);
const bankPath = new URL("../content/nyc/content-bank.v1.json", import.meta.url);
const loadRegistry = () => JSON.parse(readFileSync(registryPath, "utf8"));

test("source registry is versioned, seeded, and valid", () => {
  const registry = loadRegistry();
  const result = validateSourceRegistry(registry);
  assert.deepEqual(result, { valid: true, errors: [], counts: { providers: registry.providers.length } });
  assert.equal(registry.schema_version, "1.0.0");
  assert.ok(registry.providers.some((item) => item.provider_id === "nyc-official"));
  assert.ok(registry.providers.some((item) => item.provider_id === "wikimedia-commons"));
  assert.ok(registry.providers.some((item) => item.provider_id === "wikidata"));
  assert.ok(registry.providers.some((item) => item.provider_id === "openstreetmap"));
  assert.ok(registry.providers.some((item) => item.provider_id === "licensed-imagery"));
  assert.ok(registry.providers.some((item) => item.trust_tier === "change_signal"));
});

test("v1 schemas declare the registry and claim-level remote contract", () => {
  const sourceSchema = JSON.parse(readFileSync(new URL("../content/nyc/schema/source-registry.schema.v1.json", import.meta.url), "utf8"));
  const remoteSchema = JSON.parse(readFileSync(new URL("../content/nyc/schema/remote-verification.schema.v1.json", import.meta.url), "utf8"));
  assert.equal(sourceSchema.$id, "https://dayquest.app/schemas/source-registry/v1.0.0");
  assert.equal(remoteSchema.$id, "https://dayquest.app/schemas/remote-verification/v1.0.0");
  assert.deepEqual(remoteSchema.$defs.claim.properties.role.enum, ["identity", "coordinates", "observable_target", "current_status", "public_access", "accessibility", "historical_context", "visual_confirmation", "change_signal"]);
  assert.deepEqual(remoteSchema.$defs.verification.properties.lifecycle.enum, ["source_reviewed", "remote_verified", "canary", "proven", "paused", "retired"]);
  assert.deepEqual(remoteSchema.$defs.verification.properties.decision.enum, ["canary_eligible", "needs_scout", "hold", "reject"]);
});

test("registry rejects duplicate IDs and incomplete attribution or license rules", () => {
  const registry = loadRegistry();
  registry.providers.push(structuredClone(registry.providers[0]));
  registry.providers[0].licensing.attribution_required = true;
  registry.providers[0].licensing.attribution = null;
  registry.providers[0].unexpected = true;
  const result = validateSourceRegistry(registry);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /provider_id .* duplicated/);
  assert.match(result.errors.join("\n"), /requires attribution text/);
  assert.match(result.errors.join("\n"), /unexpected is not allowed/);
});

function canaryRecord() {
  const roles = ["identity", "coordinates", "observable_target", "current_status", "public_access", "accessibility", "visual_confirmation"];
  return {
    verification_id: "verification:nyc:test-place",
    subject_id: "place:wikipedia:test-place",
    lifecycle: "remote_verified",
    verification_scope: "remote",
    claims: roles.map((role, index) => ({
      claim_id: `claim:nyc:test-place:${role}`,
      role,
      text: `Supported ${role} claim`,
      supports_claim_ids: index ? [`claim:nyc:test-place:${roles[index - 1]}`] : [],
      evidence: [{
        evidence_id: `remote-evidence:nyc:test-place:${role}`,
        provider_id: ["coordinates", "public_access", "accessibility"].includes(role)
          ? "openstreetmap"
          : role === "current_status" ? "nyc-official" : "wikimedia-commons",
        source_url: `https://example.test/${role}`,
        source_date: "2026-07-20",
        reviewed_at: "2026-07-22T00:00:00Z",
        freshness: { max_age_days: 30, status: "fresh" },
        verification_method: role === "visual_confirmation" ? "licensed_or_open_image_review" : "source_review",
        attribution: "Required source attribution",
        license: "Recorded source license",
      }],
    })),
    confidence: { identity: "high", spatial: "high", observability: "high", currency: "high", access_safety: "high" },
    risk: "low",
    constraints: { public_access: "yes", purchase_required: "no", safety: "supported", unsupported: false },
    decision: "canary_eligible",
    decision_reasons: [],
  };
}

test("rules gate canary eligibility and cannot be bypassed by confidence", () => {
  const registry = loadRegistry();
  assert.deepEqual(evaluateCanaryGate(canaryRecord(), registry), { decision: "canary_eligible", reasons: [] });
  for (const [field, value, expected] of [
    ["public_access", "no", "hold"],
    ["purchase_required", "yes", "hold"],
    ["safety", "unsafe", "hold"],
    ["unsupported", true, "reject"],
  ]) {
    const record = canaryRecord();
    record.constraints[field] = value;
    record.confidence = { identity: "high", spatial: "high", observability: "high", currency: "high", access_safety: "high" };
    assert.equal(evaluateCanaryGate(record, registry).decision, expected, field);
  }
  const highRisk = canaryRecord();
  highRisk.risk = "high";
  assert.equal(evaluateCanaryGate(highRisk, registry).decision, "needs_scout");
});

test("remote validator rejects stale evidence, disallowed usage, and dangling cross-claim references", () => {
  const registry = loadRegistry();
  const record = canaryRecord();
  record.claims[0].supports_claim_ids = ["claim:nyc:missing"];
  record.claims[0].evidence[0].freshness.status = "stale";
  record.claims[0].evidence[0].provider_id = "public-change-signals";
  const artifact = { schema_version: "1.0.0", site_id: "nyc", registry_version: "1.0.0", generated_from: "test", verifications: [record] };
  const result = validateRemoteVerification(artifact, registry);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /stale evidence cannot support canary eligibility/);
  assert.match(result.errors.join("\n"), /does not allow identity/);
  assert.match(result.errors.join("\n"), /unknown claim_id/);
});

test("remote contract forbids field-verification claims and raw route or precise analytics data", () => {
  const registry = loadRegistry();
  const record = canaryRecord();
  record.verification_scope = "field";
  record.claims[0].evidence[0].verification_method = "human_site_check";
  record.raw_route = [{ lat: 1, lng: 2 }];
  record.precise_analytics = { device_id: "secret" };
  const artifact = { schema_version: "1.0.0", site_id: "nyc", registry_version: "1.0.0", generated_from: "test", verifications: [record] };
  const result = validateRemoteVerification(artifact, registry);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /verification_scope must be remote/);
  assert.match(result.errors.join("\n"), /human_site_check is field verification/);
  assert.match(result.errors.join("\n"), /raw_route is forbidden/);
  assert.match(result.errors.join("\n"), /precise_analytics is forbidden/);
});

test("compiler deterministically adapts all 100 current claims without asserting field verification", () => {
  const bank = JSON.parse(readFileSync(bankPath, "utf8"));
  const registry = loadRegistry();
  const first = compileRemoteVerification(bank, registry, "content/nyc/content-bank.v1.json");
  const second = compileRemoteVerification(bank, registry, "content/nyc/content-bank.v1.json");
  assert.deepEqual(second, first);
  assert.equal(first.verifications.length, 100);
  assert.equal(first.verifications.reduce((count, item) => count + item.claims.length, 0), 100);
  assert.ok(first.verifications.every((item) => item.verification_scope === "remote"));
  assert.ok(first.verifications.every((item) => item.lifecycle === "source_reviewed"));
  assert.ok(first.verifications.every((item) => item.decision === "needs_scout"));
  assert.ok(first.verifications.every((item) => item.claims.every((claim) => claim.evidence.every((evidence) => evidence.verification_method !== "human_site_check"))));
  const result = validateRemoteVerification(first, registry);
  assert.deepEqual(result, { valid: true, errors: [], counts: { verifications: 100, claims: 100 } });
});
