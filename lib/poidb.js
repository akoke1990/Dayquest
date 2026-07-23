// DayQuest — Supabase client helper for the POI database.
//
// Increment 1 (store + label). Used by scripts/ingest-pois.js to upsert
// ingest-sourced POI rows into the `poi` table. The app/server quest-serving
// path does NOT use this yet.
//
// Configuration is via env (SUPABASE_URL + SUPABASE_SERVICE_KEY). The
// service_role key bypasses RLS, so the ingest can write `pending` rows that
// the public/anon key can never see until a curator approves them.
//
// IMPORTANT: @supabase/supabase-js is imported DYNAMICALLY, inside the write
// helpers — not at module top level. The package lives under app/node_modules
// today; a top-level import would throw MODULE_NOT_FOUND and crash file-mode
// ingest (which never needs Supabase at all). `poidbConfigured` is a pure env
// check with no import, so callers can branch before ever touching the client.

/**
 * True only if BOTH Supabase env vars are present — evaluated at access time.
 * Callers use this to choose the live-upsert path vs. the file-output path. It
 * performs no import and no network call, so it is always safe to read.
 *
 * Use this function (not a captured constant) when env vars may be loaded by a
 * .env loader AFTER this module is imported — ES module imports are hoisted, so
 * a module-load-time const could read the env before the loader ran.
 */
export function isPoidbConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

/**
 * Boolean snapshot of configuration AT IMPORT TIME. Convenient for callers that
 * set SUPABASE_* in the shell before launching (the common case). If your
 * process loads a .env file at runtime, prefer isPoidbConfigured() so the check
 * sees the loaded vars.
 */
export const poidbConfigured = isPoidbConfigured();

const NOT_CONFIGURED_MSG =
  "Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_KEY " +
  "(the service_role key) to upsert to the poi table.";
const SUPABASE_TIMEOUT_MS = 5_000;

// Ingest-sourced columns ONLY. This allowlist is the mechanism that prevents
// re-ingest from clobbering human curation: rows are projected down to these
// keys before upsert, so supabase-js derives an ON CONFLICT DO UPDATE that
// touches ONLY these columns. The curation columns (category, tags, blurb,
// quality_flag) and `status` are deliberately absent — on a conflicting row
// they keep their existing curated values; on a new row the DB DEFAULTs apply
// (status defaults to 'pending'). `geom` is omitted too — it is a GENERATED
// column the DB computes from lat/lng.
export const INGEST_COLUMNS = [
  "name",
  "lat",
  "lng",
  "geohash",
  "area",
  "kind",
  "lore",
  "source",
  "source_url",
  "license",
  "ext_id",
];

/** Project a row down to the ingest-only columns (drops curation + status). */
export function projectIngestRow(row) {
  const out = {};
  for (const k of INGEST_COLUMNS) {
    if (row[k] !== undefined) out[k] = row[k];
  }
  return out;
}

// Lazily-created singleton client. Created on first write so file-mode never
// pays the import.
let _client = null;
async function getClient() {
  if (!poidbConfigured) throw new Error(NOT_CONFIGURED_MSG);
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
 * Upsert ingest rows into `poi` on the (source, ext_id) conflict key, in
 * batches. Each row is projected to INGEST_COLUMNS first, so existing curation
 * columns and `status` are never overwritten.
 *
 * @param {Array<object>} rows  candidate rows (any extra keys are dropped)
 * @param {object} [opts]
 * @param {number} [opts.batchSize=500]
 * @returns {Promise<{ upserted: number, batches: number }>}
 */
export async function upsertPois(rows, { batchSize = 500 } = {}) {
  if (!poidbConfigured) throw new Error(NOT_CONFIGURED_MSG);
  const client = await getClient();
  const payload = rows.map(projectIngestRow);

  let upserted = 0;
  let batches = 0;
  for (let i = 0; i < payload.length; i += batchSize) {
    const batch = payload.slice(i, i + batchSize);
    const { error, count } = await client
      .from("poi")
      .upsert(batch, { onConflict: "source,ext_id", count: "exact" })
      .abortSignal(AbortSignal.timeout(SUPABASE_TIMEOUT_MS));
    if (error) throw new Error(`poi upsert failed: ${error.message}`);
    upserted += count ?? batch.length;
    batches += 1;
  }
  return { upserted, batches };
}

// Full column set the LABELER (curation authority) writes: ingest columns PLUS
// the curation verdict (category/tags/blurb/quality_flag/status). Unlike
// INGEST_COLUMNS this DELIBERATELY writes status + curation — it's how a pending
// row becomes quest-eligible. Writing all columns (not just curation) means the
// upsert works whether the row pre-exists from write-through or is brand new.
export const CURATED_COLUMNS = [
  ...INGEST_COLUMNS,
  "category",
  "tags",
  "blurb",
  "quality_flag",
  "status",
];

/** Project a row down to the curated columns (ingest + curation verdict). */
export function projectCuratedRow(row) {
  const out = {};
  for (const k of CURATED_COLUMNS) {
    if (row[k] !== undefined) out[k] = row[k];
  }
  return out;
}

/**
 * Upsert LABELED rows into `poi` on (source, ext_id), writing curation columns
 * and status. This is the labeler/enrichment write path — the ONLY one allowed
 * to set category/tags/blurb/quality_flag/status. Idempotent: re-labeling a
 * place updates its verdict in place.
 *
 * @param {Array<object>} rows  fully-labeled rows (ingest + curation fields)
 * @param {object} [opts]
 * @param {number} [opts.batchSize=500]
 * @returns {Promise<{ upserted: number, batches: number }>}
 */
export async function upsertCuratedPois(rows, { batchSize = 500 } = {}) {
  if (!poidbConfigured) throw new Error(NOT_CONFIGURED_MSG);
  const client = await getClient();
  const payload = rows.map(projectCuratedRow);

  let upserted = 0;
  let batches = 0;
  for (let i = 0; i < payload.length; i += batchSize) {
    const batch = payload.slice(i, i + batchSize);
    const { error, count } = await client
      .from("poi")
      .upsert(batch, { onConflict: "source,ext_id", count: "exact" })
      .abortSignal(AbortSignal.timeout(SUPABASE_TIMEOUT_MS));
    if (error) throw new Error(`poi curated upsert failed: ${error.message}`);
    upserted += count ?? batch.length;
    batches += 1;
  }
  return { upserted, batches };
}

/**
 * Thin read helper. Returns approved POIs for an area (or all areas). Provided
 * for later increments / sanity checks; the ingest does not require it.
 *
 * @param {object} [opts]
 * @param {string} [opts.area]              filter to one Area name
 * @param {string} [opts.status='approved'] status filter
 * @param {number} [opts.limit=200]
 * @returns {Promise<Array<object>>}
 */
export async function queryPois({ area, status = "approved", limit = 200 } = {}) {
  if (!poidbConfigured) throw new Error(NOT_CONFIGURED_MSG);
  const client = await getClient();
  let q = client
    .from("poi")
    .select("id,name,lat,lng,geohash,area,kind,lore,category,tags,blurb,quality_flag,status,source,source_url,license")
    .eq("status", status)
    .limit(limit);
  if (area) q = q.eq("area", area);
  q = q.abortSignal(AbortSignal.timeout(SUPABASE_TIMEOUT_MS));
  const { data, error } = await q;
  if (error) throw new Error(`poi query failed: ${error.message}`);
  return data ?? [];
}
