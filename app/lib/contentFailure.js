const CONTENT_FAILURE_REASONS = Object.freeze([
  { value: "unsafe", label: "Unsafe" },
  { value: "blocked_closed", label: "Blocked or closed" },
  { value: "inaccessible", label: "Inaccessible" },
  { value: "missing", label: "Missing" },
  { value: "incorrect", label: "Incorrect" },
]);

function buildContentFailureRequest(quest, stop, reason) {
  if (!CONTENT_FAILURE_REASONS.some((option) => option.value === reason)) {
    throw new Error("Choose a listed content-failure reason.");
  }
  const placeId = stop?.place?.source_id;
  const excludedPlaceIds = (quest?.stops || []).map((item) => item?.place?.source_id).filter(Boolean);
  if (!placeId || !excludedPlaceIds.includes(placeId) || !Number.isInteger(stop?.order_index)) {
    throw new Error("Only a current curated stop can be replaced.");
  }
  return {
    reason,
    place_id: placeId,
    slot: stop.order_index,
    excluded_place_ids: [...new Set(excludedPlaceIds)],
    quest_content_version_id: quest?.meta?.content_version_id,
  };
}

function markContentFailure(progress, slot, reason, reportedPlaceId, status) {
  return {
    ...progress,
    [slot]: {
      ...(progress[slot] || {}),
      contentFailure: {
        reason,
        reported_place_id: reportedPlaceId,
        status,
      },
    },
  };
}

function applyContentReplacement(quest, progress, slot, replacement) {
  const failure = progress[slot]?.contentFailure;
  const nextStop = { ...replacement, order_index: slot, id: slot - 1 };
  return {
    quest: {
      ...quest,
      stops: quest.stops.map((stop) => stop.order_index === slot ? nextStop : stop),
    },
    progress: {
      ...progress,
      [slot]: {
        contentFailureReport: failure ? { ...failure, status: "replaced" } : undefined,
      },
    },
  };
}

module.exports = {
  CONTENT_FAILURE_REASONS,
  applyContentReplacement,
  buildContentFailureRequest,
  markContentFailure,
};
