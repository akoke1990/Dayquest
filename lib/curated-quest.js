import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const BANK_URL = new URL("../content/nyc/content-bank.v1.json", import.meta.url);
const MIN_STOPS = 3;
const STOP_COUNTS = Object.freeze({ quick: 3, explore: 5, epic: 8 });
let bankPromise;

function isApproved(record) {
  return record?.editorial_review?.status === "approved"
    && record?.field_review?.status === "approved";
}

function isDeliverable(record) {
  if (!record || record.lifecycle === "retired" || record.delivery?.paused === true) return false;
  if (record.lifecycle === "published") return isApproved(record);
  return record.lifecycle === "field_verified"
    && record.delivery?.canary_eligible === true
    && isApproved(record);
}

function hasFieldEvidence(place, evidenceIds) {
  const evidence = new Map((place?.observable_evidence || []).map((item) => [item.evidence_id, item]));
  return evidenceIds.length > 0 && evidenceIds.every(
    (id) => evidence.get(id)?.verification?.status === "field_verified"
  );
}

/** Return complete place/idea/clue chains that are safe for delivery. */
export function eligibleContentRecords(bank) {
  if (!bank || bank.site_id !== "nyc") return [];
  const places = new Map((bank.places || []).map((record) => [record.id, record]));
  const ideas = new Map((bank.hunt_ideas || []).map((record) => [record.id, record]));
  const records = [];

  for (const clue of bank.clue_packages || []) {
    const place = places.get(clue.place_id);
    const idea = ideas.get(clue.hunt_idea_id);
    if (!isDeliverable(place) || !isDeliverable(idea) || !isDeliverable(clue)) continue;
    if (!(idea.place_ids || []).includes(place.id)) continue;
    if (!hasFieldEvidence(place, clue.evidence_refs || [])) continue;
    if (!clue.clue?.trim() || !Array.isArray(clue.hints) || clue.hints.length !== 3) continue;
    records.push({ place, idea, clue });
  }
  return records.sort((a, b) => a.clue.id.localeCompare(b.clue.id));
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function recordVersionId({ place, idea, clue }) {
  return `${place.id}@${place.record_version}|${idea.id}@${idea.record_version}|${clue.id}@${clue.record_version}`;
}

function questVersionId(bank, records) {
  const basis = records.map(recordVersionId).sort().join("\n");
  const digest = createHash("sha256").update(basis).digest("hex").slice(0, 16);
  return `${bank.site_id}:${bank.schema_version}:${digest}`;
}

function normalizedSize(value) {
  return value === "explore" || value === "epic" ? value : "quick";
}

/** Build a provider-free deterministic quest, or null when fewer than three safe records exist. */
export function buildCuratedQuest(bank, lat, lng, options = {}) {
  const size = normalizedSize(options.size);
  const requestedRadius = Number(options.radius);
  const radius = Number.isFinite(requestedRadius) && requestedRadius > 0
    ? Math.max(500, Math.min(8000, Math.round(requestedRadius)))
    : (size === "epic" ? 2500 : 1500);
  const limit = STOP_COUNTS[size];
  const excluded = options.exclude instanceof Set ? options.exclude : new Set();

  const eligible = eligibleContentRecords(bank)
    .map((record) => ({
      ...record,
      distance_m: distanceMeters(lat, lng, record.place.location.lat, record.place.location.lng),
    }))
    .filter(({ place, distance_m }) => distance_m <= radius * 1.5
      && !excluded.has(place.id)
      && !excluded.has(place.name)
      && !place.sources?.some((source) => source.url && excluded.has(source.url)))
    .sort((a, b) => a.distance_m - b.distance_m || a.clue.id.localeCompare(b.clue.id))
    .slice(0, limit);

  if (eligible.length < MIN_STOPS) return null;
  const contentVersionId = questVersionId(bank, eligible);
  const area = eligible[0].place.location.area || "New York City";
  return {
    theme: eligible[0].idea.title,
    intro: eligible[0].idea.concept || "A field-verified New York City scavenger hunt.",
    origin: { lat, lng, label: area },
    stops: eligible.map(({ place, clue, distance_m }, index) => ({
      id: index,
      order_index: index + 1,
      description: `A ${String(place.category || "landmark").replaceAll("_", " ")} in New York City.`,
      clue: clue.clue,
      hint: clue.hints[0].text,
      hints: clue.hints.map((hint) => hint.text),
      virtual_item: "🗽 Curator's Mark",
      reason: eligible[index].idea.concept || "A field-verified city detail worth noticing.",
      lore_hook: "",
      quest_type: "find",
      content_version_id: recordVersionId(eligible[index]),
      place: {
        source: "dayquest_content_bank",
        source_id: place.id,
        name: place.name,
        kind: place.category,
        lat: place.location.lat,
        lng: place.location.lng,
        distance_m,
        lore: "",
        source_url: place.sources?.find((source) => source.url)?.url || "",
        tags: place.tags || [],
        category: place.category,
      },
    })),
    meta: {
      mode: "curated",
      content_version_id: contentVersionId,
      content_schema_version: bank.schema_version,
      candidate_count: eligible.length,
    },
  };
}

function replacementStop(record, orderIndex, distance_m) {
  const { place, idea, clue } = record;
  return {
    id: orderIndex - 1,
    order_index: orderIndex,
    description: `A ${String(place.category || "landmark").replaceAll("_", " ")} in New York City.`,
    clue: clue.clue,
    hint: clue.hints[0].text,
    hints: clue.hints.map((hint) => hint.text),
    virtual_item: "🗽 Curator's Mark",
    reason: idea.concept || "A field-verified city detail worth noticing.",
    lore_hook: "",
    quest_type: "find",
    content_version_id: recordVersionId(record),
    place: {
      source: "dayquest_content_bank",
      source_id: place.id,
      name: place.name,
      kind: place.category,
      lat: place.location.lat,
      lng: place.location.lng,
      distance_m,
      lore: "",
      source_url: place.sources?.find((source) => source.url)?.url || "",
      tags: place.tags || [],
      category: place.category,
    },
  };
}

/** Select one provider-free replacement from the same lifecycle-safe curated inventory. */
export function buildCuratedReplacement(bank, { reportedPlaceId, excludedPlaceIds, orderIndex }) {
  const reported = (bank?.places || []).find((place) => place.id === reportedPlaceId);
  if (!reported?.location || !(excludedPlaceIds instanceof Set) || !Number.isInteger(orderIndex)) return null;
  const candidate = eligibleContentRecords(bank)
    .filter(({ place }) => !excludedPlaceIds.has(place.id) && place.id !== reportedPlaceId)
    .map((record) => ({
      record,
      distance_m: distanceMeters(
        reported.location.lat,
        reported.location.lng,
        record.place.location.lat,
        record.place.location.lng
      ),
    }))
    .sort((a, b) => a.distance_m - b.distance_m || a.record.clue.id.localeCompare(b.record.clue.id))[0];
  return candidate ? replacementStop(candidate.record, orderIndex, candidate.distance_m) : null;
}

export async function loadCuratedQuest(lat, lng, options = {}) {
  bankPromise ||= readFile(BANK_URL, "utf8").then(JSON.parse);
  return buildCuratedQuest(await bankPromise, lat, lng, options);
}

export async function loadCuratedReplacement(input) {
  bankPromise ||= readFile(BANK_URL, "utf8").then(JSON.parse);
  return buildCuratedReplacement(await bankPromise, input);
}
