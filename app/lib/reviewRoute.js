const { FIND_RADIUS_M, distanceM, isWithinFindRadius } = require("./geofence");
const APP_REVIEW_ROUTE = require("../content/app-review-route.v1.json");

const WALK_LABELS = Object.freeze([
  "350m cold",
  "220m cool",
  "120m warm",
  "65m outside",
  "45m inside",
]);

const LIFECYCLE_FIELDS = new Set(["published", "field_verified", "canary_eligible"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function collectLifecycleErrors(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectLifecycleErrors(item, `${path}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (LIFECYCLE_FIELDS.has(key)) errors.push(`${path}.${key} is not allowed in review demo content`);
    collectLifecycleErrors(child, `${path}.${key}`, errors);
  }
}

function validateAppReviewRoute(route) {
  const errors = [];
  if (route?.purpose !== "app_review_demonstration") errors.push("purpose must be app_review_demonstration");
  if (route?.version !== "1.0.0") errors.push("version must be 1.0.0");
  if (!Array.isArray(route?.stops) || route.stops.length !== 3) errors.push("route must contain exactly three stops");
  collectLifecycleErrors(route, "route", errors);

  for (const [index, stop] of (route?.stops || []).entries()) {
    const path = `stops[${index}]`;
    if (stop.order_index !== index + 1) errors.push(`${path}.order_index must be ${index + 1}`);
    if (!/^Demo /.test(stop?.place?.name || "")) errors.push(`${path}.place.name must be a generic Demo label`);
    if (!stop?.place?.source_id?.startsWith("app-review-demo:")) errors.push(`${path}.place.source_id must be demo scoped`);
    if (!stop?.quest_prompt) errors.push(`${path}.quest_prompt is required`);
    const labels = (stop?.simulated_walk || []).map((step) => step.label);
    if (JSON.stringify(labels) !== JSON.stringify(WALK_LABELS)) {
      errors.push(`${path}.simulated_walk must contain deterministic review checkpoints`);
    }
    const outside = stop?.simulated_walk?.find((step) => step.label === "65m outside");
    const inside = stop?.simulated_walk?.find((step) => step.label === "45m inside");
    if (!outside || isWithinFindRadius(outside, stop.place)) {
      errors.push(`${path}.65m outside must stay outside the ${FIND_RADIUS_M}m find radius`);
    }
    if (!inside || !isWithinFindRadius(inside, stop.place)) {
      errors.push(`${path}.45m inside must be inside the ${FIND_RADIUS_M}m find radius`);
    }
    for (const step of stop?.simulated_walk || []) {
      if (!Number.isFinite(distanceM(step.latitude, step.longitude, stop.place.lat, stop.place.lng))) {
        errors.push(`${path}.${step.label} coordinates must be finite`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function createAppReviewQuest() {
  const route = clone(APP_REVIEW_ROUTE);
  return {
    route_id: route.route_id,
    purpose: route.purpose,
    version: route.version,
    theme: route.theme,
    intro: route.intro,
    origin: route.origin,
    stops: route.stops,
    meta: {
      route_id: route.route_id,
      route_version: route.version,
      purpose: route.purpose,
    },
    mode: "app_review",
  };
}

module.exports = {
  APP_REVIEW_ROUTE,
  WALK_LABELS,
  createAppReviewQuest,
  validateAppReviewRoute,
};
