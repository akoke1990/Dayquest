import { readFileSync } from "node:fs";
import { validateJsonSchema } from "./json-schema.js";

const SOURCE_REGISTRY_SCHEMA = JSON.parse(readFileSync(new URL("../content/nyc/schema/source-registry.schema.v1.json", import.meta.url), "utf8"));
const REMOTE_VERIFICATION_SCHEMA = JSON.parse(readFileSync(new URL("../content/nyc/schema/remote-verification.schema.v1.json", import.meta.url), "utf8"));

export const SOURCE_REGISTRY_VERSION = "1.0.0";
export const CLAIM_ROLES = Object.freeze([
  "identity", "coordinates", "observable_target", "current_status", "public_access",
  "accessibility", "historical_context", "visual_confirmation", "change_signal",
]);

export function validateSourceRegistry(registry) {
  const errors = validateJsonSchema(SOURCE_REGISTRY_SCHEMA, registry, "registry");
  const providers = Array.isArray(registry?.providers) ? registry.providers : [];
  if (registry?.schema_version !== SOURCE_REGISTRY_VERSION) errors.push(`schema_version must be ${SOURCE_REGISTRY_VERSION}`);
  if (!Array.isArray(registry?.providers)) errors.push("providers must be an array");
  const seen = new Set();
  for (const [index, provider] of providers.entries()) {
    const path = `providers[${index}]`;
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider?.provider_id || "")) errors.push(`${path}.provider_id is invalid`);
    if (seen.has(provider?.provider_id)) errors.push(`${path}.provider_id ${provider?.provider_id} is duplicated`);
    seen.add(provider?.provider_id);
    if (!Array.isArray(provider?.allowed_uses) || provider.allowed_uses.some((role) => !CLAIM_ROLES.includes(role))) errors.push(`${path}.allowed_uses is invalid`);
    if (provider?.licensing?.attribution_required && !provider.licensing.attribution?.trim()) errors.push(`${path}.licensing requires attribution text`);
    if (provider?.licensing?.license_required && !provider.licensing.license?.trim()) errors.push(`${path}.licensing requires a license`);
    if (provider?.storage_policy === "store_licensed_asset" && provider?.licensing?.license_required !== true) errors.push(`${path} may store assets only with an explicit license rule`);
    if (provider?.access?.auth !== "none" && !(provider?.access?.credential_env || []).length) errors.push(`${path}.access must name credential environment variables`);
  }
  return { valid: errors.length === 0, errors, counts: { providers: providers.length } };
}

const REQUIRED_CANARY_ROLES = Object.freeze([
  "identity", "coordinates", "observable_target", "current_status", "public_access",
  "accessibility", "visual_confirmation",
]);
const CONFIDENCE_DIMENSIONS = Object.freeze(["identity", "spatial", "observability", "currency", "access_safety"]);
const LIFECYCLES = Object.freeze(["source_reviewed", "remote_verified", "canary", "proven", "paused", "retired"]);
const DECISIONS = Object.freeze(["canary_eligible", "needs_scout", "hold", "reject"]);
const REMOTE_METHODS = Object.freeze([
  "source_review", "official_record_review", "structured_data_review", "map_review",
  "licensed_or_open_image_review", "change_signal_review",
]);

function providerIndex(registry) {
  const result = new Map();
  for (const provider of registry?.providers || []) {
    result.set(provider.provider_id, provider);
    for (const alias of provider.aliases || []) result.set(alias, provider);
  }
  return result;
}

function remoteEvidence(record) {
  return (record.claims || []).flatMap((claim) => (claim.evidence || []).map((evidence) => ({ claim, evidence })));
}

export function evaluateCanaryGate(record, registry) {
  const reasons = [];
  const providers = providerIndex(registry);
  if (record?.constraints?.unsupported === true) return { decision: "reject", reasons: ["content is unsupported"] };
  if (record?.constraints?.public_access === "no") reasons.push("target is not publicly accessible");
  if (record?.constraints?.purchase_required === "yes") reasons.push("purchase or paid entry is required");
  if (record?.constraints?.safety === "unsafe") reasons.push("access is unsafe");
  if (reasons.length) return { decision: "hold", reasons };

  const scoutReasons = [];
  if (record?.risk === "high") scoutReasons.push("high-risk content requires a scout");
  if (record?.constraints?.public_access !== "yes") scoutReasons.push("public access is not confirmed");
  if (record?.constraints?.purchase_required !== "no") scoutReasons.push("free access is not confirmed");
  if (record?.constraints?.safety !== "supported") scoutReasons.push("safety is not supported");
  const roles = new Set((record?.claims || []).filter((claim) => claim.evidence?.length).map((claim) => claim.role));
  for (const role of REQUIRED_CANARY_ROLES) if (!roles.has(role)) scoutReasons.push(`missing ${role} claim`);
  for (const { claim, evidence } of remoteEvidence(record || {})) {
    const provider = providers.get(evidence.provider_id);
    if (!provider || !provider.allowed_uses.includes(claim.role)) scoutReasons.push(`${evidence.provider_id} does not allow ${claim.role}`);
    if (evidence.freshness?.status !== "fresh") scoutReasons.push(`${claim.claim_id} evidence is not fresh`);
    if (provider?.licensing?.attribution_required && !evidence.attribution?.trim()) scoutReasons.push(`${evidence.evidence_id} lacks attribution`);
    if (provider?.licensing?.license_required && !evidence.license?.trim()) scoutReasons.push(`${evidence.evidence_id} lacks license`);
  }
  for (const dimension of CONFIDENCE_DIMENSIONS) {
    if (record?.confidence?.[dimension] !== "high") scoutReasons.push(`${dimension} confidence is not high`);
  }
  return scoutReasons.length ? { decision: "needs_scout", reasons: [...new Set(scoutReasons)] } : { decision: "canary_eligible", reasons: [] };
}

function findForbiddenData(value, path, errors) {
  if (!value || typeof value !== "object") return;
  const forbidden = new Set(["route", "raw_route", "gps_trace", "precise_location", "precise_analytics", "device_id"]);
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) errors.push(`${path}.${key} is forbidden`);
    findForbiddenData(child, `${path}.${key}`, errors);
  }
}

export function validateRemoteVerification(artifact, registry) {
  const errors = validateJsonSchema(REMOTE_VERIFICATION_SCHEMA, artifact, "artifact");
  const verifications = Array.isArray(artifact?.verifications) ? artifact.verifications : [];
  if (artifact?.schema_version !== "1.0.0") errors.push("schema_version must be 1.0.0");
  if (artifact?.site_id !== "nyc") errors.push("site_id must be nyc");
  if (artifact?.registry_version !== registry?.schema_version) errors.push("registry_version does not match registry");
  if (!Array.isArray(artifact?.verifications)) errors.push("verifications must be an array");
  findForbiddenData(artifact, "artifact", errors);
  const providers = providerIndex(registry);
  const verificationIds = new Set();
  const claimIds = new Set();
  const evidenceIds = new Set();
  for (const [recordIndex, record] of verifications.entries()) {
    const path = `verifications[${recordIndex}]`;
    if (verificationIds.has(record.verification_id)) errors.push(`${path}.verification_id is duplicated`);
    verificationIds.add(record.verification_id);
    if (record.verification_scope !== "remote") errors.push(`${path}.verification_scope must be remote`);
    if (!LIFECYCLES.includes(record.lifecycle)) errors.push(`${path}.lifecycle is invalid`);
    if (!DECISIONS.includes(record.decision)) errors.push(`${path}.decision is invalid`);
    if (!["low", "medium", "high"].includes(record.risk)) errors.push(`${path}.risk is invalid`);
    for (const dimension of CONFIDENCE_DIMENSIONS) if (!["unknown", "low", "medium", "high"].includes(record.confidence?.[dimension])) errors.push(`${path}.confidence.${dimension} is invalid`);
    for (const claim of record.claims || []) {
      if (claimIds.has(claim.claim_id)) errors.push(`${path}.${claim.claim_id} is duplicated`);
      claimIds.add(claim.claim_id);
      if (!CLAIM_ROLES.includes(claim.role)) errors.push(`${path}.${claim.claim_id}.role is invalid`);
      for (const evidence of claim.evidence || []) {
        if (evidenceIds.has(evidence.evidence_id)) errors.push(`${path}.${evidence.evidence_id} is duplicated`);
        evidenceIds.add(evidence.evidence_id);
        const provider = providers.get(evidence.provider_id);
        if (!provider) errors.push(`${path}.${evidence.evidence_id} references unknown provider ${evidence.provider_id}`);
        else if (!provider.allowed_uses.includes(claim.role)) errors.push(`${path}.${evidence.evidence_id}: ${evidence.provider_id} does not allow ${claim.role}`);
        if (evidence.verification_method === "human_site_check") errors.push(`${path}.${evidence.evidence_id}: human_site_check is field verification, not remote verification`);
        else if (!REMOTE_METHODS.includes(evidence.verification_method)) errors.push(`${path}.${evidence.evidence_id}.verification_method is invalid`);
        if (provider?.licensing?.attribution_required && !evidence.attribution?.trim()) errors.push(`${path}.${evidence.evidence_id} requires attribution`);
        if (provider?.licensing?.license_required && !evidence.license?.trim()) errors.push(`${path}.${evidence.evidence_id} requires license`);
        if (record.decision === "canary_eligible" && evidence.freshness?.status !== "fresh") errors.push(`${path}.${evidence.evidence_id}: stale evidence cannot support canary eligibility`);
        if (evidence.source_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(evidence.source_date)) errors.push(`${path}.${evidence.evidence_id}.source_date must be YYYY-MM-DD or null`);
      }
    }
    const localClaims = new Set((record.claims || []).map((claim) => claim.claim_id));
    for (const claim of record.claims || []) for (const ref of claim.supports_claim_ids || []) if (!localClaims.has(ref)) errors.push(`${path}.${claim.claim_id} references unknown claim_id ${ref}`);
    const gate = evaluateCanaryGate(record, registry);
    if (record.decision !== gate.decision) errors.push(`${path}.decision must be ${gate.decision}: ${gate.reasons.join("; ")}`);
  }
  return { valid: errors.length === 0, errors, counts: { verifications: verifications.length, claims: claimIds.size } };
}

export function compileRemoteVerification(bank, registry, generatedFrom = "content-bank") {
  if (!Array.isArray(bank?.places)) throw new Error("content bank places must be an array");
  const providers = providerIndex(registry);
  const verifications = [];
  for (const place of [...bank.places].sort((a, b) => a.id.localeCompare(b.id))) {
    const sources = new Map((place.sources || []).map((source) => [source.source_id, source]));
    for (const evidence of [...(place.observable_evidence || [])].sort((a, b) => a.evidence_id.localeCompare(b.evidence_id))) {
      const remoteSources = [];
      for (const sourceId of [...evidence.source_ids].sort()) {
        const source = sources.get(sourceId);
        if (!source) throw new Error(`${evidence.evidence_id} references unknown source ${sourceId}`);
        const provider = providers.get(source.provider);
        if (!provider) throw new Error(`${evidence.evidence_id} uses unregistered provider ${source.provider}`);
        remoteSources.push({
          evidence_id: `remote-${evidence.evidence_id}:${encodeURIComponent(sourceId)}`,
          provider_id: provider.provider_id,
          source_url: source.url,
          source_date: null,
          reviewed_at: evidence.verification?.verified_at || null,
          freshness: { max_age_days: evidence.stability === "volatile" ? 7 : evidence.stability === "seasonal" ? 90 : 365, status: "unknown" },
          verification_method: "source_review",
          attribution: provider.licensing.attribution_required ? provider.licensing.attribution : null,
          license: source.license || (provider.licensing.license_required ? provider.licensing.license : null),
        });
      }
      const token = evidence.evidence_id.replace(/^evidence:/, "").replace(/[^a-zA-Z0-9._~-]+/g, "-");
      const record = {
        verification_id: `verification:nyc:${token}`,
        subject_id: place.id,
        lifecycle: "source_reviewed",
        verification_scope: "remote",
        claims: [{
          claim_id: `claim:nyc:${token}`,
          role: "observable_target",
          text: evidence.claim,
          supports_claim_ids: [],
          evidence: remoteSources,
        }],
        confidence: { identity: "medium", spatial: "unknown", observability: "medium", currency: "unknown", access_safety: "unknown" },
        risk: evidence.stability === "volatile" ? "high" : evidence.stability === "stable" ? "low" : "medium",
        constraints: { public_access: "unknown", purchase_required: "unknown", safety: "unknown", unsupported: false },
        decision: "needs_scout",
        decision_reasons: [],
      };
      const gate = evaluateCanaryGate(record, registry);
      record.decision = gate.decision;
      record.decision_reasons = gate.reasons;
      verifications.push(record);
    }
  }
  verifications.sort((a, b) => a.verification_id.localeCompare(b.verification_id));
  return {
    schema_version: "1.0.0",
    site_id: bank.site_id,
    registry_version: registry.schema_version,
    generated_from: generatedFrom,
    verifications,
  };
}
