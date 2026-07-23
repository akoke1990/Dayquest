const APP_REVIEW_AUDIENCE = "com.akoke18.dayquest";
const APP_REVIEW_VERSION = "1.0.0";
const APP_REVIEW_METADATA_KEY = "dayquest_app_review";

function unavailable(reason) {
  return { available: false, reason };
}

function expiryTime(value) {
  if (typeof value !== "string" || !value) return NaN;
  return new Date(value).getTime();
}

function evaluateReviewEntitlement({
  appReviewCapable,
  user,
  now = new Date(),
  audience = APP_REVIEW_AUDIENCE,
  version = APP_REVIEW_VERSION,
} = {}) {
  if (appReviewCapable !== true) return unavailable("build_not_capable");
  const entitlement = user?.app_metadata?.[APP_REVIEW_METADATA_KEY];
  if (!entitlement || typeof entitlement !== "object") return unavailable("missing_entitlement");
  if (entitlement.aud !== audience) return unavailable("wrong_audience");
  if (entitlement.version !== version) return unavailable("wrong_version");

  const expiresAtMs = expiryTime(entitlement.expires_at);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs) || expiresAtMs <= nowMs) {
    return unavailable("expired");
  }

  return {
    available: true,
    reason: "entitled",
    userId: user?.id || null,
    expiresAt: entitlement.expires_at,
  };
}

async function loadReviewEntitlement(supabaseClient, options = {}) {
  if (options.appReviewCapable !== true) return unavailable("build_not_capable");
  if (!supabaseClient?.auth?.getUser || !supabaseClient?.rpc) return unavailable("auth_unavailable");
  try {
    const { data, error } = await supabaseClient.auth.getUser();
    if (error || !data?.user) return unavailable("verification_failed");
    const evaluated = evaluateReviewEntitlement({ ...options, user: data.user });
    if (!evaluated.available) return evaluated;

    // `getUser()` proves the metadata came from Supabase, but a device clock can
    // be manipulated. Require the database-time RPC to validate the same stored
    // entitlement before exposing the demonstration.
    const { data: serverAuthorized, error: serverError } = await supabaseClient.rpc(
      "dayquest_verify_app_review_entitlement"
    );
    if (serverError || serverAuthorized !== true) {
      return unavailable("server_verification_failed");
    }
    return evaluated;
  } catch {
    return unavailable("server_verification_failed");
  }
}

module.exports = {
  APP_REVIEW_AUDIENCE,
  APP_REVIEW_METADATA_KEY,
  APP_REVIEW_VERSION,
  evaluateReviewEntitlement,
  loadReviewEntitlement,
};
