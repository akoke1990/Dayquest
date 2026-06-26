# DayQuest POI Database — store + label (Increment 1)

A persistent, curated POI database in Supabase so we can later serve
curated/shared Area tours **without** calling Claude or Google. This increment
covers **store + label** only — it does NOT wire quest generation to read from
the DB (that's a later increment).

## Files

- `db/poi_schema.sql` — the `poi` table (Postgres + PostGIS) + RLS. Run once.
- `lib/poidb.js` — Supabase client helper (`poidbConfigured`, `upsertPois`, `queryPois`).
- `scripts/ingest-pois.js` — the ingest (`npm run ingest:pois`).

## The `poi` table (summary)

| Column | Origin | Notes |
|---|---|---|
| `id` (uuid) | derived | PK, `gen_random_uuid()`. Internal only. |
| `name`, `lat`, `lng` | ingest | Authoritative place + coords. |
| `geom` (geography Point 4326) | **generated** | `ST_SetSRID(ST_MakePoint(lng,lat),4326)` — computed by the DB; ingest never sends it. Powers future `ST_DWithin`. |
| `geohash` | ingest | p7 (~153m) cell, computed in JS at ingest. |
| `area` | ingest | Named Area, e.g. `Greenwich Village, NY`. |
| `kind` | ingest | Factual OSM/Places type (read-only curator context). |
| `lore` | ingest | Sourced snippet (Wikipedia extract). CC BY-SA → keep `source_url`/`license`. |
| `source`, `source_url`, `license`, `ext_id` | ingest | Attribution + dedupe key. |
| `category` | **curation** | `green \| art \| water \| historic \| other`. |
| `tags` (text[]) | **curation** | vibe tokens: `quiet`, `quirky`, `iconic`, … |
| `blurb` | **curation** | curator-rewritten DayQuest copy (DayQuest-owned). |
| `quality_flag` (smallint) | **curation** | 1–3 quality/confidence. |
| `status` | **curation** | `pending \| approved \| maybe \| flagged` (default `pending`). |
| `created_at`, `reviewed_at` | timestamps | |

**Indexes:** unique `(source, ext_id)` (idempotent upsert), GiST on `geom`,
btree on `status` and `area`.

**RLS:** enabled. Public/anon role may `SELECT` rows where `status='approved'`
only. There is no anon INSERT/UPDATE policy — the ingest authenticates with the
`service_role` key, which **bypasses RLS**, so writes are locked to that key.

## Curation — in the Supabase Table Editor (no custom admin UI)

Curate directly in **Supabase → Table Editor → `poi`**:

1. **Filter by `area`** (e.g. `Greenwich Village, NY`) and `status = pending`.
2. For each row, use `name` / `kind` / `lore` / `source_url` as read-only
   context, then fill the curation columns:
   - `category` — one of `green | art | water | historic | other`
   - `tags` — vibe tokens (`quiet`, `quirky`, `kid-ok`, `iconic`, `hidden`)
   - `blurb` — rewrite into DayQuest's voice (this is DayQuest-owned copy)
   - `quality_flag` — 1–3
3. Set **`status`**:

   | status | meaning |
   |---|---|
   | `approved` | **served.** Real, public, open, safe — passed your review. |
   | `maybe` | keep for later — e.g. a sensitive/tragedy site (per D-022) we may handle with care, not auto-serve. |
   | `flagged` | junk — non-visitable, private, a district/school, an event with no site. Not served, kept so re-ingest doesn't resurface it for review. |

Only `approved` rows will ever be served (later increment). Set `reviewed_at`
when you finish a row if you want an audit trail (optional).

## Idempotent upsert that never clobbers curation

Re-running the ingest must refresh open data **without** undoing a curator's
work. The mechanism (see `lib/poidb.js`):

- `upsertPois()` projects every row down to an **allowlist of ingest columns**
  (`INGEST_COLUMNS`: name, lat, lng, geohash, area, kind, lore, source,
  source_url, license, ext_id) **before** sending it.
- supabase-js derives the `ON CONFLICT (source, ext_id) DO UPDATE SET …` list
  from the keys present in the payload. Because `status`, `category`, `tags`,
  `blurb`, and `quality_flag` are **not in the payload**, they are excluded from
  the update — a conflicting (already-curated) row keeps those values untouched.
- New rows get the DB column defaults: `status` defaults to `'pending'`,
  curation columns to NULL.
- `geom` is a generated column (DB computes it), so it's never sent either.

Net effect: re-ingest updates only the open-data columns; curated columns and
`status` survive across runs.

## Running it

```bash
# File mode (no Supabase key) — writes data/poi-<area>.json for review:
npm run ingest:pois -- --seed data/gv-pois.json --label "Greenwich Village, NY"
npm run ingest:pois                      # default GV grid (hits Wikipedia/OSM)

# Live mode:
#   1. Run db/poi_schema.sql in the Supabase SQL editor (one time).
#   2. Install deps at the repo root (pulls in @supabase/supabase-js, which is
#      otherwise only under app/ and NOT resolvable from lib/ or scripts/):
npm install
#   3. Set the keys, then re-run — it upserts to Supabase instead of writing a file:
export SUPABASE_URL="https://<project>.supabase.co"
export SUPABASE_SERVICE_KEY="<service_role key>"
npm run ingest:pois -- --seed data/gv-pois.json --label "Greenwich Village, NY"
```

Other args: `--place "East Village"` (forward-geocode), `--lat/--lng --label`,
`--grid 5`, `--radius 300`.
