// Durable, service-role-only content/safety failure queue.
// Supabase is loaded lazily so local and preview runs without credentials never
// import or contact the client. Failures are sanitized and reported as `false`;
// the API decides whether that means production must fail closed.

const SUPABASE_TIMEOUT_MS = 5_000;

export function contentFailuresConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

let clientSingleton = null;
async function getClient() {
  if (clientSingleton) return clientSingleton;
  const { createClient } = await import("@supabase/supabase-js");
  clientSingleton = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return clientSingleton;
}

function queueRow(report) {
  return {
    reason: report.reason,
    place_id: report.place_id,
    quest_content_version_id: report.quest_content_version_id ?? null,
    priority: report.priority,
    curator_action: report.curator_action,
    accessibility_status: report.accessibility_status,
    request_id: report.request_id,
    status: report.status,
  };
}

function logFailure(requestId) {
  console.error(JSON.stringify({
    level: "error",
    event: "content_failure_store_failed",
    operation: "insert",
    request_id: requestId,
  }));
}

export async function persistContentFailure(report, options = {}) {
  if (!options.client && !contentFailuresConfigured()) return false;
  try {
    const client = options.client || await getClient();
    const { error } = await client
      .from("content_failures")
      .insert(queueRow(report))
      .abortSignal(AbortSignal.timeout(SUPABASE_TIMEOUT_MS));
    if (error) {
      logFailure(report.request_id);
      return false;
    }
    return true;
  } catch {
    logFailure(report.request_id);
    return false;
  }
}
