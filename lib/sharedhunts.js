// DayQuest — durable store for SHARED (multiplayer) hunts.
//
// Closes the server's TODO(D-046) seam: the in-memory Map that holds the single
// canonical quest per hunt_id is fragile (lost on Render sleep/redeploy/restart),
// so friends can't join a hunt hours later. This helper backs that store with a
// Supabase `shared_hunts` table (see db/MULTIPLAYER_DESIGN.md) WHEN a service
// client is configured, and is a graceful no-op otherwise.
//
// Pattern mirrors lib/poidb.js EXACTLY:
//   - configured = BOTH SUPABASE_URL + SUPABASE_SERVICE_KEY present (env check,
//     no import, no network — always safe to read);
//   - @supabase/supabase-js is imported DYNAMICALLY, inside the helpers, ONLY
//     when configured — so PREVIEW / no-key runs never touch the package;
//   - the service_role key bypasses RLS, so the server can write rows the public
//     anon key reads back via the `select using (true)` policy.
//
// Durability-write failures are SWALLOWED (logged, not thrown): a flaky DB must
// never 500 a hunt creation. server.js always keeps its in-memory Map as the
// fast read-through layer in front of this, so a Supabase miss/error degrades to
// exactly today's in-memory behaviour.

/**
 * True only if BOTH Supabase env vars are present — evaluated at access time
 * (no import, no network). Callers branch on this to choose durable vs. no-op.
 */
export function sharedHuntsConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

// Lazily-created singleton client. Created on first durable read/write so the
// no-key (PREVIEW / local-without-key / Render-without-key) path never pays the
// dynamic import.
let _client = null;
async function getClient() {
  if (_client) return _client;
  const { createClient } = await import("@supabase/supabase-js");
  _client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return _client;
}

/**
 * Read the stored canonical hunt object for a hunt_id from Supabase.
 *
 * Returns the `quest` column verbatim (the FULL shared response object the server
 * stored — `{ hunt_id, shared:true, ...quest }`), so a join is byte-identical to
 * the create. Returns null on miss, when unconfigured, or on ANY error (the
 * server then falls back to its in-memory Map / regeneration path — never 500s).
 *
 * @param {string} id  hunt_id (PK)
 * @returns {Promise<object|null>} the stored response object, or null
 */
export async function fetchSharedHunt(id) {
  if (!sharedHuntsConfigured()) return null;
  try {
    const client = await getClient();
    const { data, error } = await client
      .from("shared_hunts")
      .select("quest")
      .eq("hunt_id", id)
      .maybeSingle();
    if (error) {
      console.error("  ! shared_hunts select failed:", error.message);
      return null;
    }
    return data?.quest ?? null;
  } catch (err) {
    console.error("  ! shared_hunts select threw:", err.message);
    return null;
  }
}

/**
 * Upsert the canonical hunt into Supabase, keyed on hunt_id (PK). Stores the FULL
 * response object in the `quest` jsonb column so reads replay it byte-identically.
 *
 * Swallows all errors (logs, returns false) — a durability-write failure must not
 * break hunt creation; the in-memory Map (written by the caller) still serves the
 * hunt for the life of the warm instance.
 *
 * @param {string} id          hunt_id (PK)
 * @param {object} quest       the full shared response object to persist
 * @param {object} [meta]
 * @param {string} [meta.area] human area label
 * @param {string} [meta.mode] normalised mode (walk|bike)
 * @param {string} [meta.size] normalised size (quick|explore|epic)
 * @returns {Promise<boolean>} true if persisted, false if unconfigured/failed
 */
export async function upsertSharedHunt(id, quest, { area, mode, size } = {}) {
  if (!sharedHuntsConfigured()) return false;
  try {
    const client = await getClient();
    const { error } = await client.from("shared_hunts").upsert(
      {
        hunt_id: id,
        area: area ?? null,
        mode: mode ?? null,
        size: size ?? null,
        quest,
        // created_by stays null: service-role writes have no auth.uid(); the
        // column is nullable in the design-doc schema.
        created_at: new Date().toISOString(),
      },
      { onConflict: "hunt_id" }
    );
    if (error) {
      console.error("  ! shared_hunts upsert failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("  ! shared_hunts upsert threw:", err.message);
    return false;
  }
}
