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

export function importApprovedPois(rows) {
  if (!Array.isArray(rows)) throw new Error("POI input must be an array");
  const byId = new Map();
  for (const row of rows) {
    if (row?.status !== "approved") continue;
    const place = importPlace(row);
    if (byId.has(place.id)) throw new Error(`Duplicate stable place identity: ${place.id}`);
    byId.set(place.id, place);
  }
  const places = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    schema_version: CONTENT_BANK_VERSION,
    site_id: "nyc",
    places,
    hunt_ideas: [],
    clue_packages: [],
  };
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
    for (const evidenceId of idea.observable_target_ids || []) if (!evidenceIds.has(evidenceId)) errors.push(`${path} references unknown evidence_id ${evidenceId}`);
    validateReview(idea.editorial_review, `${path}.editorial_review`, errors);
    validateReview(idea.field_review, `${path}.field_review`, errors);
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
    for (const evidenceId of clue.evidence_refs || []) if (!evidenceIds.has(evidenceId)) errors.push(`${path} references unknown evidence_id ${evidenceId}`);
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
