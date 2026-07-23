import { readFileSync } from "node:fs";

const CONTENT_BANK_SCHEMA = JSON.parse(
  readFileSync(new URL("../content/nyc/schema/content-bank.schema.v1.json", import.meta.url), "utf8")
);

const LIFECYCLE_STATES = Object.freeze([
  "candidate",
  "needs_source_review",
  "needs_field_verification",
  "field_verified",
  "published",
  "retired",
]);

export const CONTENT_BANK_VERSION = "1.0.0";
export const PLACE_CATEGORIES = Object.freeze([
  "architecture", "gallery", "historic_site", "infrastructure", "landmark",
  "monument_memorial", "museum", "other", "park_garden", "public_art",
  "religious", "shop_market", "venue_nightlife",
]);
export { LIFECYCLE_STATES };

function requiredIdentityPart(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`POI requires stable source identity (${label})`);
  return encodeURIComponent(text.toLowerCase());
}

export function stablePlaceId(row) {
  const source = requiredIdentityPart(row?.source, "source");
  const externalId = requiredIdentityPart(row?.ext_id, "ext_id");
  return `place:${source}:${externalId}`;
}

function importPlace(row) {
  const id = stablePlaceId(row);
  const source = String(row.source).trim().toLowerCase();
  const externalId = String(row.ext_id).trim();
  return {
    id,
    record_version: 1,
    lifecycle: "needs_source_review",
    name: row.name,
    location: { lat: row.lat, lng: row.lng, area: row.area || null },
    category: row.category,
    tags: Array.isArray(row.tags) ? [...row.tags] : [],
    aliases: [],
    prohibited_aliases: [row.name],
    observable_evidence: [],
    viewpoint_approach: {
      public_approach: null,
      exterior_visible: "unknown",
      requires_entry: "unknown",
    },
    access_safety_mobility: {
      step_free_approach: "unknown",
      hours_dependent: "unknown",
      purchase_required: "unknown",
      sensory_requirements: [],
      safety_notes: null,
      accessibility_notes: null,
    },
    seasonality: { availability: "unknown", notes: null },
    sources: [{
      source_id: `source:${requiredIdentityPart(source, "source")}:${requiredIdentityPart(externalId, "ext_id")}`,
      provider: source,
      external_id: externalId,
      url: row.source_url || null,
      license: row.license || null,
      review_status: "unreviewed",
      excerpt: row.lore || null,
    }],
    legacy_editorial_context: {
      blurb: row.blurb || null,
      quality_flag: row.quality_flag ?? null,
      prior_status: row.status,
    },
    editorial_review: { status: "not_started", reviewer: null, reviewed_at: null, notes: null },
    field_review: { status: "not_started", reviewer: null, verified_at: null, notes: null },
    migration: { importer: "approved-nyc-pois-v1", source_file: "db/nyc-pois-labeled.json" },
  };
}

function blankReview(kind) {
  return kind === "field"
    ? { status: "not_started", reviewer: null, verified_at: null, notes: null }
    : { status: "not_started", reviewer: null, reviewed_at: null, notes: null };
}

function candidateToken(candidate) {
  const token = String(candidate?.research_id ?? "").toLowerCase();
  if (!/^dq-nyc-[a-z0-9-]+$/.test(token)) throw new Error(`Invalid candidate research_id: ${candidate?.research_id}`);
  return token;
}

function importCandidatePlace(candidate, artifact) {
  const input = candidate.new_place;
  if (!input || input.id !== candidate.place_id || candidate.mapping !== "new_place") {
    throw new Error(`Candidate ${candidate.research_id} has invalid new-place mapping`);
  }
  const expectedPlaceId = `place:${candidate.source.provider}:${encodeURIComponent(candidate.source.external_id)}`;
  if (input.id !== expectedPlaceId) {
    throw new Error(`Candidate ${candidate.research_id} place ID is not derived from canonical source identity`);
  }
  if (!Number.isFinite(input.location?.lat) || !Number.isFinite(input.location?.lng)
    || !input.coordinate_source?.url || !input.coordinate_source?.excerpt) {
    throw new Error(`Candidate ${candidate.research_id} lacks source-grounded coordinates`);
  }
  const identitySourceId = `source:${candidate.source.provider}:${encodeURIComponent(candidate.source.external_id)}:identity`;
  const coordinateSourceId = `source:${input.coordinate_source.provider}:${encodeURIComponent(input.coordinate_source.external_id)}`;
  return {
    id: input.id,
    record_version: 1,
    lifecycle: "needs_field_verification",
    name: input.name,
    location: { ...input.location },
    category: input.category,
    tags: [candidate.tranche_id],
    aliases: [],
    prohibited_aliases: [input.name],
    observable_evidence: [],
    viewpoint_approach: {
      public_approach: candidate.access_safety_mobility,
      exterior_visible: "unknown",
      requires_entry: "unknown",
    },
    access_safety_mobility: {
      step_free_approach: "unknown",
      hours_dependent: "unknown",
      purchase_required: "unknown",
      sensory_requirements: [],
      safety_notes: candidate.access_safety_mobility,
      accessibility_notes: null,
    },
    seasonality: { availability: "unknown", notes: candidate.durability_risk },
    sources: [{
      source_id: identitySourceId,
      provider: candidate.source.provider,
      external_id: candidate.source.external_id,
      url: candidate.source.identity_url || candidate.source.url,
      license: null,
      review_status: "reviewed",
      excerpt: candidate.source.excerpt,
    }, {
      source_id: coordinateSourceId,
      provider: input.coordinate_source.provider,
      external_id: input.coordinate_source.external_id,
      url: input.coordinate_source.url,
      license: "OpenStreetMap contributors / ODbL",
      review_status: "reviewed",
      excerpt: input.coordinate_source.excerpt,
    }],
    legacy_editorial_context: {
      blurb: null,
      quality_flag: null,
      prior_status: "source_researched_candidate",
      coordinate_query_url: input.coordinate_source.query_url,
    },
    editorial_review: blankReview("editorial"),
    field_review: blankReview("field"),
    migration: { importer: "nyc-source-candidates-v2", source_file: artifact.provenance.source_artifacts.join(",") },
  };
}

function mergeSourceCandidates(bank, artifact) {
  if (artifact == null) return bank;
  if (!["1.0.0", "2.0.0"].includes(artifact.artifact_version) || artifact.site_id !== "nyc" || !Array.isArray(artifact.candidates)) {
    throw new Error("Invalid NYC source-candidate artifact");
  }
  const placesById = new Map(bank.places.map((place) => [place.id, place]));
  const seenResearchIds = new Set();

  for (const candidate of artifact.candidates) {
    if (candidate.mapping !== "new_place") continue;
    if (placesById.has(candidate.place_id)) throw new Error(`Duplicate stable place identity: ${candidate.place_id}`);
    const place = importCandidatePlace(candidate, artifact);
    placesById.set(place.id, place);
    bank.places.push(place);
  }
  bank.places.sort((a, b) => a.id.localeCompare(b.id));

  for (const candidate of artifact.candidates) {
    const token = candidateToken(candidate);
    if (seenResearchIds.has(token)) throw new Error(`Duplicate candidate research_id: ${candidate.research_id}`);
    seenResearchIds.add(token);

    const place = placesById.get(candidate.place_id);
    if (!place) throw new Error(`Candidate ${candidate.research_id} references unknown place ${candidate.place_id}`);
    if (candidate.mapping !== "new_place" && place.name !== candidate.matched_catalog_name) {
      throw new Error(`Candidate ${candidate.research_id} catalog name does not exactly match ${place.name}`);
    }
    const source = candidate.source;
    if (!source?.url || !source?.excerpt || !source.provider || !source.external_id) {
      throw new Error(`Candidate ${candidate.research_id} has unsupported source identity`);
    }
    if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) {
      throw new Error(`Candidate ${candidate.research_id} requires source-supported evidence`);
    }

    const sourceId = `source:${source.provider}:${encodeURIComponent(source.external_id)}:research-${token}`;
    place.sources.push({
      source_id: sourceId,
      provider: source.provider,
      external_id: String(source.external_id),
      url: source.url,
      license: place.sources[0].license,
      review_status: "reviewed",
      excerpt: source.excerpt,
    });
    const evidenceIds = candidate.evidence.map((item) => {
      const evidenceId = `evidence:candidate:${token}-${item.local_id}`;
      place.observable_evidence.push({
        evidence_id: evidenceId,
        claim: item.claim,
        observable_target: item.observable_target,
        source_ids: [sourceId],
        viewpoint: item.viewpoint,
        stability: item.stability,
        seasonality: item.seasonality,
        verification: {
          status: "source_verified",
          method: "source_review",
          verified_by: `source-candidate-artifact:${artifact.artifact_version}`,
          verified_at: null,
        },
      });
      return evidenceId;
    });
    place.lifecycle = "needs_field_verification";
    place.record_version = 2;

    const ideaId = `idea:nyc:${token}`;
    bank.hunt_ideas.push({
      id: ideaId,
      record_version: 1,
      lifecycle: candidate.idea.lifecycle,
      title: candidate.title,
      concept: candidate.idea.concept,
      place_ids: [place.id],
      observable_target_ids: evidenceIds,
      editorial_review: blankReview("editorial"),
      field_review: blankReview("field"),
    });
    bank.clue_packages.push({
      id: `clue:nyc:candidate:${token}`,
      record_version: 1,
      lifecycle: candidate.clue_package.lifecycle,
      place_id: place.id,
      hunt_idea_id: ideaId,
      language: "en-US",
      clue: candidate.clue_package.riddle,
      hints: candidate.clue_package.hints.map((text, index) => ({
        rung: index + 1,
        text,
        evidence_refs: evidenceIds,
      })),
      evidence_refs: evidenceIds,
      editorial_review: blankReview("editorial"),
      field_review: blankReview("field"),
    });
  }
  bank.hunt_ideas.sort((a, b) => a.id.localeCompare(b.id));
  bank.clue_packages.sort((a, b) => a.id.localeCompare(b.id));
  return bank;
}

export function importApprovedPois(rows, sourceCandidates = null) {
  if (!Array.isArray(rows)) throw new Error("POI input must be an array");
  const byId = new Map();
  for (const row of rows) {
    if (row?.status !== "approved") continue;
    const place = importPlace(row);
    if (byId.has(place.id)) throw new Error(`Duplicate stable place identity: ${place.id}`);
    byId.set(place.id, place);
  }
  const places = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return mergeSourceCandidates({
    schema_version: CONTENT_BANK_VERSION,
    site_id: "nyc",
    places,
    hunt_ideas: [],
    clue_packages: [],
  }, sourceCandidates);
}

function findForbiddenDifficulty(value, path = "bank") {
  if (!value || typeof value !== "object") return null;
  if (Object.hasOwn(value, "difficulty")) return `${path}.difficulty is not part of content-bank v1`;
  for (const [key, child] of Object.entries(value)) {
    const found = findForbiddenDifficulty(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function validateReview(review, path, errors) {
  const statuses = ["not_started", "in_progress", "approved", "changes_requested"];
  if (!review || !statuses.includes(review.status)) errors.push(`${path}.status is invalid`);
}

function validateLifecycle(record, path, errors) {
  if (!LIFECYCLE_STATES.includes(record?.lifecycle)) errors.push(`${path}.lifecycle is invalid`);
  if (!Number.isInteger(record?.record_version) || record.record_version < 1) {
    errors.push(`${path}.record_version must be a positive integer`);
  }
}

function resolveSchemaRef(ref) {
  if (!ref.startsWith("#/")) throw new Error(`Unsupported schema reference ${ref}`);
  return ref.slice(2).split("/").reduce((value, token) => value[token.replaceAll("~1", "/").replaceAll("~0", "~")], CONTENT_BANK_SCHEMA);
}

function schemaTypeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function validateAgainstSchema(schema, value, path, errors) {
  if (schema.$ref) return validateAgainstSchema(resolveSchemaRef(schema.$ref), value, path, errors);
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    errors.push(`${path} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => schemaTypeMatches(value, type))) {
      errors.push(`${path} must be type ${types.join(" or ")}`);
      return;
    }
  }
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path} is too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path} does not match ${schema.pattern}`);
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push(`${path} must be a date-time`);
    if (schema.format === "uri") {
      try { new URL(value); } catch { errors.push(`${path} must be a URI`); }
    }
  }
  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path} requires at least ${schema.minItems} items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path} allows at most ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${path} items must be unique`);
    if (schema.items) value.forEach((item, index) => validateAgainstSchema(schema.items, item, `${path}[${index}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required`);
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) errors.push(`${path}.${key} is not allowed`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) validateAgainstSchema(childSchema, value[key], `${path}.${key}`, errors);
    }
  }
}

export function validateContentBank(bank) {
  const errors = [];
  const arrays = ["places", "hunt_ideas", "clue_packages"];
  if (!bank || typeof bank !== "object") {
    return { valid: false, errors: ["bank must be an object"], counts: { places: 0, hunt_ideas: 0, clue_packages: 0 } };
  }
  validateAgainstSchema(CONTENT_BANK_SCHEMA, bank, "bank", errors);
  if (bank.schema_version !== CONTENT_BANK_VERSION) errors.push(`schema_version must be ${CONTENT_BANK_VERSION}`);
  if (bank.site_id !== "nyc") errors.push("site_id must be nyc");
  for (const key of arrays) if (!Array.isArray(bank[key])) errors.push(`${key} must be an array`);
  const counts = Object.fromEntries(arrays.map((key) => [key, Array.isArray(bank[key]) ? bank[key].length : 0]));
  if (errors.some((error) => error.endsWith("must be an array"))) return { valid: false, errors, counts };

  const forbiddenDifficulty = findForbiddenDifficulty(bank);
  if (forbiddenDifficulty) errors.push(forbiddenDifficulty);

  const placeIds = new Set();
  const placesById = new Map();
  const evidenceIds = new Set();
  const evidenceById = new Map();
  for (const [index, place] of bank.places.entries()) {
    const path = `places[${index}]`;
    validateLifecycle(place, path, errors);
    if (!/^place:[a-z0-9._%~-]+:.+/.test(place.id || "")) errors.push(`${path}.id is not a stable place ID`);
    if (placeIds.has(place.id)) errors.push(`${path}.id is duplicated`);
    placeIds.add(place.id);
    placesById.set(place.id, place);
    if (!PLACE_CATEGORIES.includes(place.category)) errors.push(`${path}.category is outside the vocabulary`);
    if (!place.name || typeof place.name !== "string") errors.push(`${path}.name is required`);
    if (!Number.isFinite(place.location?.lat) || !Number.isFinite(place.location?.lng)) errors.push(`${path}.location requires numeric lat/lng`);
    if (!Array.isArray(place.sources) || place.sources.length === 0) errors.push(`${path}.sources requires at least one source`);
    const sourceIds = new Set((place.sources || []).map((source) => source.source_id));
    if (!Array.isArray(place.observable_evidence)) errors.push(`${path}.observable_evidence must be an array`);
    for (const evidence of place.observable_evidence || []) {
      if (!evidence.evidence_id || evidenceIds.has(evidence.evidence_id)) errors.push(`${path} has missing or duplicate evidence_id`);
      evidenceIds.add(evidence.evidence_id);
      evidenceById.set(evidence.evidence_id, { evidence, place_id: place.id });
      if (!evidence.claim || !evidence.source_ids?.length) errors.push(`${path}.${evidence.evidence_id || "evidence"} requires a claim and source_ids`);
      for (const sourceId of evidence.source_ids || []) {
        if (!sourceIds.has(sourceId)) errors.push(`${path}.${evidence.evidence_id || "evidence"} references unknown source_id ${sourceId}`);
      }
      if (evidence.verification?.status === "source_verified"
        && evidence.verification.method !== "source_review") {
        errors.push(`${path}.${evidence.evidence_id || "evidence"}: source_verified evidence requires source_review method`);
      }
      if (evidence.verification?.status === "field_verified"
        && evidence.verification.method !== "human_site_check") {
        errors.push(`${path}.${evidence.evidence_id || "evidence"}: field_verified evidence requires human_site_check method`);
      }
    }
    validateReview(place.editorial_review, `${path}.editorial_review`, errors);
    validateReview(place.field_review, `${path}.field_review`, errors);
    if (place.lifecycle === "published") {
      const fieldEvidence = (place.observable_evidence || []).some((item) => item.verification?.status === "field_verified");
      if (!fieldEvidence) errors.push(`${path}: published place requires field-verified observable evidence`);
      if (place.editorial_review?.status !== "approved" || place.field_review?.status !== "approved") {
        errors.push(`${path}: published place requires approved editorial and field reviews`);
      }
    }
  }

  const ideaIds = new Set();
  for (const [index, idea] of bank.hunt_ideas.entries()) {
    const path = `hunt_ideas[${index}]`;
    validateLifecycle(idea, path, errors);
    if (!/^idea:nyc:[a-z0-9._~-]+$/.test(idea.id || "")) errors.push(`${path}.id is not a stable idea ID`);
    if (ideaIds.has(idea.id)) errors.push(`${path}.id is duplicated`);
    ideaIds.add(idea.id);
    for (const placeId of idea.place_ids || []) if (!placeIds.has(placeId)) errors.push(`${path} references unknown place_id ${placeId}`);
    for (const evidenceId of idea.observable_target_ids || []) {
      const evidenceRecord = evidenceById.get(evidenceId);
      if (!evidenceRecord) errors.push(`${path} references unknown evidence_id ${evidenceId}`);
      else if (!(idea.place_ids || []).includes(evidenceRecord.place_id)) errors.push(`${path} references evidence from another place ${evidenceId}`);
    }
    validateReview(idea.editorial_review, `${path}.editorial_review`, errors);
    validateReview(idea.field_review, `${path}.field_review`, errors);
    if (idea.lifecycle === "published") {
      const publishedPlaces = (idea.place_ids || []).length > 0
        && idea.place_ids.every((placeId) => placesById.get(placeId)?.lifecycle === "published");
      if (!publishedPlaces) errors.push(`${path}: published hunt idea requires a published place`);
      const referencedEvidence = (idea.observable_target_ids || []).map((id) => evidenceById.get(id)).filter(Boolean);
      if (!referencedEvidence.length || !referencedEvidence.every(({ evidence }) => evidence.verification?.status === "field_verified")) {
        errors.push(`${path}: published hunt idea requires field-verified evidence`);
      }
      if (idea.editorial_review?.status !== "approved" || idea.field_review?.status !== "approved") {
        errors.push(`${path}: published hunt idea requires approved reviews`);
      }
    }
  }

  const clueIds = new Set();
  for (const [index, clue] of bank.clue_packages.entries()) {
    const path = `clue_packages[${index}]`;
    validateLifecycle(clue, path, errors);
    if (!/^clue:nyc:[a-z0-9._~-]+:[a-z0-9._~-]+$/.test(clue.id || "")) errors.push(`${path}.id is not a stable clue ID`);
    if (clueIds.has(clue.id)) errors.push(`${path}.id is duplicated`);
    clueIds.add(clue.id);
    if (!placeIds.has(clue.place_id)) errors.push(`${path} references unknown place_id ${clue.place_id}`);
    if (clue.hunt_idea_id != null && !ideaIds.has(clue.hunt_idea_id)) errors.push(`${path} references unknown hunt_idea_id ${clue.hunt_idea_id}`);
    for (const evidenceId of clue.evidence_refs || []) {
      const evidenceRecord = evidenceById.get(evidenceId);
      if (!evidenceRecord) errors.push(`${path} references unknown evidence_id ${evidenceId}`);
      else if (evidenceRecord.place_id !== clue.place_id) errors.push(`${path} references evidence from another place ${evidenceId}`);
    }
    for (const [hintIndex, hint] of (clue.hints || []).entries()) {
      for (const evidenceId of hint.evidence_refs || []) {
        const evidenceRecord = evidenceById.get(evidenceId);
        if (!evidenceRecord) errors.push(`${path}.hints[${hintIndex}] references unknown evidence_id ${evidenceId}`);
        else if (evidenceRecord.place_id !== clue.place_id) errors.push(`${path}.hints[${hintIndex}] references evidence from another place ${evidenceId}`);
      }
    }
    validateReview(clue.editorial_review, `${path}.editorial_review`, errors);
    validateReview(clue.field_review, `${path}.field_review`, errors);
    if (clue.lifecycle === "published") {
      if (!clue.clue?.trim() || !Array.isArray(clue.hints) || clue.hints.length !== 3) errors.push(`${path}: published clue requires clue text and exactly three hints`);
      if (!clue.evidence_refs?.length) errors.push(`${path}: published clue requires evidence_refs`);
      if (clue.editorial_review?.status !== "approved" || clue.field_review?.status !== "approved") errors.push(`${path}: published clue requires approved reviews`);
      const place = placesById.get(clue.place_id);
      if (place?.lifecycle !== "published") {
        errors.push(`${path}: published clue requires a published place`);
      }
      const referencedEvidence = (clue.evidence_refs || [])
        .map((evidenceId) => evidenceById.get(evidenceId))
        .filter(Boolean);
      const evidenceIsFieldVerified = referencedEvidence.length > 0
        && referencedEvidence.every(
          ({ evidence, place_id: evidencePlaceId }) =>
            evidencePlaceId === clue.place_id
            && evidence.verification?.status === "field_verified"
        );
      if (!evidenceIsFieldVerified) {
        errors.push(`${path}: published clue requires field-verified evidence from its place`);
      }
      const publishedText = [clue.clue, ...(clue.hints || []).map((hint) => hint.text)].join(" ").toLocaleLowerCase();
      for (const alias of place?.prohibited_aliases || []) {
        const normalizedAlias = String(alias).trim().toLocaleLowerCase();
        if (normalizedAlias && publishedText.includes(normalizedAlias)) {
          errors.push(`${path}: published text contains prohibited alias ${JSON.stringify(alias)}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, counts };
}
