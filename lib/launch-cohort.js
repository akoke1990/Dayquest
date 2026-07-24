const error = (errors, path, message) => errors.push(`${path}: ${message}`);

const checkUnique = (errors, items, key, basePath) => {
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    const value = item?.[key];
    if (seen.has(value)) error(errors, `${basePath}[${index}].${key}`, `duplicate ${value}`);
    seen.add(value);
  }
};

const distanceM = (a, b) => {
  const values = [a?.lat, a?.lng, b?.lat, b?.lng];
  if (!values.every(Number.isFinite)) return null;
  const radius = 6_371_000;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)));
};

export function validateLaunchCohort({ artifact, bank, sourceCandidates, foundationRemote, remote }) {
  const errors = [];
  const routes = Array.isArray(artifact?.routes) ? artifact.routes : [];
  const candidates = Array.isArray(artifact?.candidates) ? artifact.candidates : [];

  if (artifact?.artifact_type !== "dayquest_nyc_launch_canary_cohort") {
    error(errors, "artifact_type", "must be dayquest_nyc_launch_canary_cohort");
  }
  if (artifact?.contract_version !== "launch-cohort-v1") {
    error(errors, "contract_version", "must be launch-cohort-v1");
  }
  for (const key of ["field_verified", "publication_claimed", "published", "live"]) {
    if (artifact?.state?.[key] !== false) error(errors, `state.${key}`, "must be false");
  }
  if (artifact?.state?.research_mode !== "remote_only") error(errors, "state.research_mode", "must be remote_only");
  if (artifact?.state?.current_gate !== "needs_field_check") error(errors, "state.current_gate", "must be needs_field_check");
  if (routes.length !== 2) error(errors, "routes", "must contain primary and reserve routes");
  if (!candidates.length) error(errors, "candidates", "must not be empty");
  checkUnique(errors, routes, "route_id", "routes");
  checkUnique(errors, candidates, "candidate_id", "candidates");

  const roles = routes.map((route) => route.role).sort();
  if (JSON.stringify(roles) !== JSON.stringify(["primary", "reserve"])) error(errors, "routes", "must contain exactly one primary and one reserve");
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const routeById = new Map(routes.map((route) => [route.route_id, route]));
  const bankIdeas = new Map((bank?.hunt_ideas || []).map((item) => [item.id, item]));
  const bankPlaces = new Map((bank?.places || []).map((item) => [item.id, item]));
  const bankClues = new Map((bank?.clue_packages || []).map((item) => [item.id, item]));
  for (const [index, route] of routes.entries()) {
    const path = `routes[${index}]`;
    const ids = Array.isArray(route.candidate_ids) ? route.candidate_ids : [];
    if (ids.length < 3 || ids.length > 5) error(errors, `${path}.candidate_ids`, "must contain 3-5 stops");
    if (route.stop_count !== ids.length) error(errors, `${path}.stop_count`, "must equal candidate_ids length");
    if (route.cohort_status !== "scout_required") error(errors, `${path}.cohort_status`, "must be scout_required");
    if (route.walkability?.status !== "requires_scout") error(errors, `${path}.walkability.status`, "must be requires_scout");
    if (route.walkability?.route_geometry_claimed !== false) error(errors, `${path}.walkability.route_geometry_claimed`, "must be false");
    if (route.walkability?.network_route_distance_status !== "unknown") error(errors, `${path}.walkability.network_route_distance_status`, "must be unknown");
    if (route.walkability?.crossing_barrier_status !== "unknown") error(errors, `${path}.walkability.crossing_barrier_status`, "must be unknown");
    for (const [order, id] of ids.entries()) {
      const candidate = candidateById.get(id);
      if (!candidate) error(errors, `${path}.candidate_ids[${order}]`, "does not resolve in cohort candidates");
      else if (candidate.route_id !== route.route_id || candidate.route_order !== order + 1) error(errors, `${path}.candidate_ids[${order}]`, "route membership/order mismatch");
    }
    const locations = ids.map((id) => {
      const placeId = candidateById.get(id)?.existing_ids?.bank_place_id;
      return bankPlaces.get(placeId)?.location;
    });
    if (locations.some((location) => !Number.isFinite(location?.lat) || !Number.isFinite(location?.lng))) {
      error(errors, `${path}.walkability`, "all route candidates must resolve to finite bank coordinates");
    } else {
      const sequenceLength = locations.slice(1).reduce(
        (sum, location, locationIndex) => sum + distanceM(locations[locationIndex], location),
        0
      );
      let maxSpan = 0;
      for (const left of locations) {
        for (const right of locations) maxSpan = Math.max(maxSpan, distanceM(left, right));
      }
      if (route.walkability?.source_coordinate_sequence_length_m !== sequenceLength) {
        error(errors, `${path}.walkability.source_coordinate_sequence_length_m`, `must equal recomputed ${sequenceLength}`);
      }
      if (route.walkability?.source_coordinate_max_span_m !== maxSpan) {
        error(errors, `${path}.walkability.source_coordinate_max_span_m`, `must equal recomputed ${maxSpan}`);
      }
    }
  }

  const sourceById = new Map((sourceCandidates?.candidates || []).map((item) => [item.research_id, item]));
  const foundationById = new Map((foundationRemote?.verifications || []).map((item) => [item.verification_id, item]));
  const remoteById = new Map((remote?.records || []).map((item) => [item.candidate_id, item]));
  for (const [index, candidate] of candidates.entries()) {
    const path = `candidates[${index}]`;
    const ids = candidate.existing_ids || {};
    const route = routeById.get(candidate.route_id);
    if (!route) error(errors, `${path}.route_id`, "does not resolve in cohort routes");
    for (const key of ["field_verified", "publication_claimed", "published", "live"]) {
      if (candidate.current_state?.[key] !== false) error(errors, `${path}.current_state.${key}`, "must be false");
    }
    if (candidate.current_state?.research_mode !== "remote_only") error(errors, `${path}.current_state.research_mode`, "must be remote_only");
    if (candidate.current_state?.launch_gate !== "needs_field_check") error(errors, `${path}.current_state.launch_gate`, "must be needs_field_check");

    const idea = bankIdeas.get(candidate.candidate_id);
    const place = bankPlaces.get(ids.bank_place_id);
    const clue = bankClues.get(ids.bank_clue_package_id);
    const source = sourceById.get(ids.source_candidate_id);
    const foundation = foundationById.get(ids.foundation_remote_verification_id);
    const detailed = remoteById.get(candidate.candidate_id);
    if (!idea) error(errors, `${path}.candidate_id`, "does not resolve in content bank");
    if (ids.bank_hunt_idea_id !== candidate.candidate_id) error(errors, `${path}.existing_ids.bank_hunt_idea_id`, "must equal candidate_id");
    if (!place || !idea?.place_ids?.includes(ids.bank_place_id)) error(errors, `${path}.existing_ids.bank_place_id`, "does not resolve through the bank hunt idea");
    if (!place?.observable_evidence?.some((item) => item.evidence_id === ids.bank_evidence_id) || !idea?.observable_target_ids?.includes(ids.bank_evidence_id)) error(errors, `${path}.existing_ids.bank_evidence_id`, "does not resolve through bank place and hunt idea");
    if (!clue || clue.hunt_idea_id !== candidate.candidate_id || clue.place_id !== ids.bank_place_id) error(errors, `${path}.existing_ids.bank_clue_package_id`, "does not resolve through bank hunt idea and place");
    if (!source || source.place_id !== ids.bank_place_id) error(errors, `${path}.existing_ids.source_candidate_id`, "does not resolve to the selected bank place");
    if (!foundation || foundation.subject_id !== ids.bank_place_id) error(errors, `${path}.existing_ids.foundation_remote_verification_id`, "does not resolve to the selected bank place");
    if (!detailed || detailed.place_id !== ids.bank_place_id || detailed.evidence_id !== ids.detailed_remote_evidence_id) error(errors, `${path}.existing_ids.detailed_remote_evidence_id`, "does not resolve through detailed remote candidate and place");
    if (detailed?.decision !== "canary_eligible") error(errors, `${path}.current_state.detailed_remote_decision`, "detailed remote decision must be canary_eligible");
    if (detailed?.field_verified !== false) error(errors, `${path}.current_state.field_verified`, "detailed remote record must remain false");
    if (candidate.current_state?.detailed_remote_decision !== detailed?.decision) error(errors, `${path}.current_state.detailed_remote_decision`, "must match detailed remote record");
    if (candidate.current_state?.foundation_remote_decision !== foundation?.decision) error(errors, `${path}.current_state.foundation_remote_decision`, "must match foundation remote record");
    if (candidate.risk?.remote_tier !== "low") error(errors, `${path}.risk.remote_tier`, "must be low");
    if (candidate.risk?.risk_weight !== 1) error(errors, `${path}.risk.risk_weight`, "must be 1 for low risk");
    if (candidate.risk?.known_business_dependency !== false) error(errors, `${path}.risk.known_business_dependency`, "must be false");
    if (candidate.risk?.remote_tier !== detailed?.risk_tier || candidate.risk?.known_business_dependency !== detailed?.operations_risk?.business_dependency) error(errors, `${path}.risk`, "must match detailed remote record");

    if (candidate.accessibility_status !== "unknown") {
      error(errors, `${path}.accessibility_status`, "must remain unknown until field evidence is reviewed");
    }
    for (const question of ["access", "safety", "closure", "staleness"]) {
      if (typeof candidate.field_questions?.[question] !== "string" || !candidate.field_questions[question].trim()) {
        error(errors, `${path}.field_questions.${question}`, "must be a non-empty scout question");
      }
    }
    if (candidate.required_scout_outcome?.status !== "pending") {
      error(errors, `${path}.required_scout_outcome.status`, "must remain pending");
    }
    const passRequirements = candidate.required_scout_outcome?.pass_requirements;
    if (!Array.isArray(passRequirements) || passRequirements.length < 3 || passRequirements.some((item) => typeof item !== "string" || !item.trim())) {
      error(errors, `${path}.required_scout_outcome.pass_requirements`, "must contain at least three non-empty requirements");
    }
    const dispositions = candidate.required_scout_outcome?.allowed_dispositions;
    const requiredDispositions = ["pass_to_evidence_review", "replace_with_paired_reserve", "pause"];
    if (!Array.isArray(dispositions) || requiredDispositions.some((item) => !dispositions.includes(item))) {
      error(errors, `${path}.required_scout_outcome.allowed_dispositions`, "must include review, paired replacement, and pause");
    }
    if (!Array.isArray(candidate.disqualifiers) || candidate.disqualifiers.length < 1 || candidate.disqualifiers.some((item) => typeof item !== "string" || !item.trim())) {
      error(errors, `${path}.disqualifiers`, "must contain non-empty disqualifiers");
    }
    const pair = candidateById.get(candidate.replacement_pair?.candidate_id);
    if (!pair || pair.candidate_id === candidate.candidate_id) {
      error(errors, `${path}.replacement_pair.candidate_id`, "must resolve to another cohort candidate");
    } else {
      if (pair.route_id === candidate.route_id) error(errors, `${path}.replacement_pair.candidate_id`, "must pair across primary and reserve routes");
      if (pair.replacement_pair?.candidate_id !== candidate.candidate_id) error(errors, `${path}.replacement_pair.candidate_id`, "pairing must be reciprocal");
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.sort(),
    counts: { routes: routes.length, candidates: candidates.length },
  };
}
