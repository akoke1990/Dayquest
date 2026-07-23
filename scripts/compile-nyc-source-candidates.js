#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const output = process.argv[2] || new URL("../content/nyc/source-candidates.v2.json", import.meta.url);

const baseline = readJson("content/nyc/source-candidates.v1.json");
const coordinates = readJson("content/nyc/research/new-place-coordinates.v1.json");
const coordinateByResearchId = new Map(coordinates.coordinates.map((item) => [item.research_id, item]));
const tranches = [
  { id: "village-20", file: "content/nyc/research/village.v1.json", artifact: readJson("content/nyc/research/village.v1.json") },
  { id: "east-village-chinatown-20", file: "content/nyc/research/east-village-chinatown.v1.json", artifact: readJson("content/nyc/research/east-village-chinatown.v1.json") },
  { id: "fidi-battery-20", file: "content/nyc/research/fidi-battery.v1.json", artifact: readJson("content/nyc/research/fidi-battery.v1.json") },
];

const existingMappings = new Map([
  ["DQ-NYC-VILLAGE-046", ["place:wikipedia:8486521", "Weehawken Street"]],
  ["DQ-NYC-VILLAGE-047", ["place:wikipedia:30604303", "Jackson Square Park"]],
  ["DQ-NYC-VILLAGE-048", ["place:wikipedia:8189363", "Abingdon Square Park"]],
  ["DQ-NYC-VILLAGE-049", ["place:wikipedia:3554439", "Magnolia Bakery"]],
  ["DQ-NYC-VILLAGE-050", ["place:wikipedia:4789409", "Westbeth Artists Community"]],
  ["DQ-NYC-VILLAGE-053", ["place:wikipedia:745249", "Washington Square Park"]],
  ["DQ-NYC-VILLAGE-054", ["place:wikipedia:745249", "Washington Square Park"]],
  ["DQ-NYC-VILLAGE-056", ["place:wikipedia:1286196", "Judson Memorial Church"]],
  ["DQ-NYC-VILLAGE-058", ["place:wikipedia:8771828", "Blue Note Jazz Club"]],
  ["DQ-NYC-VILLAGE-059", ["place:wikipedia:12560294", "Whitney Museum of American Art (original building)"]],
  ["DQ-NYC-VILLAGE-060", ["place:wikipedia:964700", "Gay Street (Manhattan)"]],
  ["DQ-NYC-R041", ["place:wikipedia:1358227", "Tompkins Square Park"]],
  ["DQ-NYC-R042", ["place:wikipedia:1358227", "Tompkins Square Park"]],
  ["DQ-NYC-R044", ["place:wikipedia:33946565", "La Plaza Cultural de Armando Perez"]],
  ["DQ-NYC-R053", ["place:wikipedia:7501248", "Confucius Plaza"]],
  ["DQ-NYC-FD-014", ["place:wikipedia:11869644", "Zuccotti Park"]],
  ["DQ-NYC-FD-015", ["place:wikipedia:996283", "28 Liberty Street"]],
  ["DQ-NYC-FD-016", ["place:wikipedia:21560", "New York Stock Exchange"]],
]);

const categoryRules = [
  [/public art|transit art|map art/i, "public_art"],
  [/monument|memorial/i, "monument_memorial"],
  [/park|garden|landscape|nature|waterfront|water|ecology|wildlife/i, "park_garden"],
  [/architecture|architectural/i, "architecture"],
  [/infrastructure|bilingual lettering/i, "infrastructure"],
  [/religious/i, "religious"],
  [/storefront|shop|food|craft/i, "shop_market"],
  [/venue|nightlife|food-and-drink/i, "venue_nightlife"],
  [/historic|history/i, "historic_site"],
];
const exactCategories = new Set(["architecture", "gallery", "historic_site", "infrastructure", "landmark", "monument_memorial", "museum", "other", "park_garden", "public_art", "religious", "shop_market", "venue_nightlife"]);
function normalizeCategory(value) {
  if (exactCategories.has(value)) return value;
  for (const [pattern, category] of categoryRules) if (pattern.test(value)) return category;
  return "other";
}
function normalizeProvider(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9._~-]+/g, "-").replace(/^-|-$/g, "");
}
function sourcePlaceId(provider, externalId) {
  const normalizedProvider = normalizeProvider(provider);
  const identity = String(externalId).trim();
  if (!normalizedProvider || !identity) throw new Error("New place requires canonical source identity");
  return `place:${normalizedProvider}:${encodeURIComponent(identity)}`;
}
function sourceIdentity(record) {
  return record.stable_source_identity || record.source_identity;
}
function sourceEvidence(record) {
  const identity = sourceIdentity(record);
  const evidence = record.evidence;
  return {
    provider: normalizeProvider(identity.provider),
    external_id: String(identity.external_id),
    identity_url: identity.url || identity.canonical_url || record.source_url,
    url: evidence?.url || record.source_url || identity.url || identity.canonical_url,
    excerpt: evidence?.quoted_evidence || record.source_quote || record.quoted_evidence,
  };
}
function targetType(category, text) {
  const value = `${category} ${text}`.toLowerCase();
  if (/street|lane|plaza|corridor|grid|sidewalk/.test(value)) return "streetscape";
  if (/building|facade|façade|arch|church|theatre|pavilion/.test(value)) return "facade";
  if (/park|garden|pond|fountain|beach|lawn|tree|landscape/.test(value)) return "landscape";
  if (/art|statue|sculpt|mosaic|memorial|monument|bronze|painting/.test(value)) return "artwork";
  if (/sign|letter|word|inscription|date/.test(value)) return "signage";
  if (/light|sun/.test(value)) return "light";
  if (/shape|triangle|cube|spiral|geometry/.test(value)) return "shape";
  return "object";
}
function stabilityFromRisk(value) {
  const text = String(value).toLowerCase();
  if (text.includes("high") || text.includes("volatile")) return "volatile";
  if (text.includes("season")) return "seasonal";
  if (text.includes("low")) return "stable";
  return "unknown";
}
function areaOf(record) {
  return record.area;
}
function normalizeRecord(record, tranche) {
  const source = sourceEvidence(record);
  const category = normalizeCategory(record.category);
  const existing = existingMappings.get(record.research_id);
  const coordinate = coordinateByResearchId.get(record.research_id);
  let placeId;
  let matchedCatalogName;
  let newPlace;
  if (existing) {
    [placeId, matchedCatalogName] = existing;
    newPlace = null;
  } else {
    if (!coordinate) throw new Error(`Deferred ${record.research_id}: no source-grounded coordinates`);
    placeId = sourcePlaceId(source.provider, source.external_id);
    matchedCatalogName = null;
    newPlace = {
      id: placeId,
      name: record.canonical_place,
      location: { lat: coordinate.lat, lng: coordinate.lng, area: areaOf(record) },
      category,
      coordinate_source: coordinate.coordinate_source,
    };
  }
  const observable = record.observable_target;
  const viewpoint = record.public_approach_safety_mobility || record.access_safety_mobility;
  const risk = record.durability_risk;
  return {
    research_id: record.research_id,
    tranche_id: tranche.id,
    title: record.title,
    mapping: existing ? "existing_place" : "new_place",
    matched_catalog_name: matchedCatalogName,
    place_id: placeId,
    new_place: newPlace,
    canonical_place: record.canonical_place,
    area: areaOf(record),
    category,
    category_source_value: record.category,
    observable_target: observable,
    satisfying_reason: record.reveal_concept,
    access_safety_mobility: viewpoint,
    durability_risk: risk,
    source,
    evidence: [{
      local_id: "observable-target",
      claim: observable,
      observable_target: targetType(category, observable),
      viewpoint,
      stability: stabilityFromRisk(risk),
      seasonality: risk,
    }],
    idea: { lifecycle: "needs_field_verification", concept: `${observable} ${record.reveal_concept}` },
    clue_package: { lifecycle: "candidate", riddle: record.riddle, hints: record.hints },
  };
}

const baselineCandidates = baseline.candidates.map((candidate) => {
  const [area, categoryLabel = "other"] = candidate.neighborhood_category.split(" · ").map((part) => part.trim());
  return {
    ...candidate,
    tranche_id: "baseline-40",
    mapping: "existing_place",
    new_place: null,
    area,
    category: normalizeCategory(categoryLabel),
    category_source_value: categoryLabel,
  };
});
const newCandidates = tranches.flatMap((tranche) => tranche.artifact.records.map((record) => normalizeRecord(record, tranche)));
const rejectedCandidates = [
  ...baseline.rejected_candidates.map((item) => ({ ...item, tranche_id: "baseline-40" })),
  ...tranches.flatMap((tranche) => (tranche.artifact.rejected_notes || tranche.artifact.rejects).map((item) => ({ ...item, tranche_id: tranche.id }))),
];
const artifact = {
  artifact_version: "2.0.0",
  site_id: "nyc",
  provenance: {
    report: "NYC DayQuest — deterministic 100-idea candidate portfolio",
    research_date: "2026-07-22",
    field_verified: false,
    publication_claimed: false,
    source_artifacts: ["content/nyc/source-candidates.v1.json", ...tranches.map((item) => item.file), "content/nyc/research/new-place-coordinates.v1.json"],
  },
  normalization: {
    category_mapping: "First exact v1 category match; otherwise ordered documented keyword mapping; fallback other.",
    observable_target_mapping: "Ordered streetscape, facade, landscape, artwork, signage, light, shape keyword mapping; fallback object.",
  },
  candidates: [...baselineCandidates, ...newCandidates].sort((a, b) => a.research_id.localeCompare(b.research_id)),
  rejected_candidates: rejectedCandidates,
};
if (artifact.candidates.length !== 100 || newCandidates.length !== 60) throw new Error("Expected 40 baseline plus 60 new candidates");
if (new Set(artifact.candidates.map((item) => item.research_id.toLowerCase())).size !== 100) throw new Error("Duplicate research ID");
writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n");
console.log(`Compiled ${artifact.candidates.length} candidates (${newCandidates.length} new; ${newCandidates.filter((item) => item.mapping === "existing_place").length} exact mappings; ${newCandidates.filter((item) => item.mapping === "new_place").length} new places) and ${rejectedCandidates.length} rejected/deferred records → ${String(output)}`);
