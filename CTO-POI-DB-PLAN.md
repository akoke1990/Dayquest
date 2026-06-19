# DayQuest — Curated POI DB + Ingest/Cache Design (Phase 1)

**From:** CTO · **Date:** 2026-06-19 · **Reads with:** `CTO-RESPONSE.md`, `CTO-BRIEF.md`, `PRD-v1.md`
**Status:** Decision-grade DESIGN doc. **No code, no build.** We are gate-first — the
AI quest-quality gate runs next; this exists so the build is trivial once it clears.
**Scope:** seed ONE neighborhood (Greenwich Village, NYC) on Supabase Postgres + PostGIS.
Model is Sonnet 4.6; funded key is being provisioned.

---

## TL;DR

One `poi` table is the source of truth; one `quest_cache` table caps API cost. A
near-solo workflow seeds it: **ingest script (reuses `lib/sources.js` logic) → Google
Sheet for a non-technical curator → import script.** AI assembly reads `status='approved'`
POIs within a radius (PostGIS `ST_DWithin`), with a live-open-data fallback where the DB
is thin. **The anti-hallucination id-join is preserved exactly — the model picks by a
per-request list index, never a DB key** (see §4; this corrects an error in the prior
scope). Phase 1 stores infra only: POIs, cache, anonymous analytics. No accounts, no PII.

---

## 1. POI table schema (`poi`) — Supabase Postgres + PostGIS

PostGIS extension enabled. Geo column is `geography(Point, 4326)` so `ST_DWithin` takes a
radius in **meters** directly (no projection math). `geohash7` is a generated column.

| Column | Type | Origin | Purpose |
|---|---|---|---|
| `id` | `uuid` (default `gen_random_uuid()`) | derived | **Internal** PK. Telemetry, cache provenance, sheet round-trip. **Never shown to the LLM, never chosen by it** (see §4). |
| `name` | `text not null` | ingest | Place name. From `candidate.name` (Wikipedia title / OSM `name`). |
| `lat` | `double precision not null` | ingest | Authoritative latitude. From `candidate.lat`. AI never sets coords. |
| `lng` | `double precision not null` | ingest | Authoritative longitude. From `candidate.lng`. |
| `geom` | `geography(Point,4326) not null` | derived | `ST_SetSRID(ST_MakePoint(lng,lat),4326)`. Powers `ST_DWithin` radius selection. |
| `geohash7` | `text` | derived | Denormalized p7 (~153m cell). Cache-key component + cheap bucketing. **Populate both `geom` and `geohash7` at ingest from base `lat/lng`** (`ST_GeoHash` needs `geometry` not `geography`, and Postgres forbids a generated column referencing another — so derive from base columns, not from `geom`). |
| `category` | `text` | curation | Coarse type for variety: `green\|art\|water\|historic\|other`. Curator sets; seeded from prototype `bucketOf()` / OSM `kind`. |
| `tags` | `text[]` | curation | Vibe-match tokens (`quiet`, `quirky`, `kid-ok`, `iconic`, `hidden`). Drives `vibe` filtering at assembly. |
| `kind` | `text` | ingest | Factual OSM type (`public art`, `public park`, `scenic viewpoint`) from `osmKind()`. Empty for Wikipedia. Display + variety hint. |
| `blurb` | `text` | **curation** | **Curator-rewritten** original DayQuest copy. **DayQuest-owned — no attribution burden.** The editorial voice. |
| `lore` | `text` | ingest | **Sourced** snippet (Wikipedia `extract`, clipped). **CC BY-SA — attribution required** (see `license`). Empty for OSM. |
| `quality_flag` | `smallint` | curation | Curator's 1–3 quality/confidence rating. AI/selection can prefer higher. |
| `status` | `text not null default 'pending'` | curation | **THE SAFETY GATE.** `pending \| approved \| flagged`. Only `approved` is ever served. Enforces PRD §87/§107: real, public, open, safe. |
| `source` | `text not null` | ingest | `wikipedia \| openstreetmap`. From `candidate.source`. |
| `source_url` | `text not null` | ingest | Attribution link. From `candidate.source_url`. |
| `license` | `text not null` | ingest | `CC-BY-SA` (Wikipedia text) or `ODbL` (OSM data). **Two distinct values** — text vs data licenses differ; both must carry through. |
| `created_at` | `timestamptz default now()` | derived | Ingest timestamp. |
| `reviewed_at` | `timestamptz` | curation | When the curator set status. |
| `reviewed_by` | `text` | curation | Curator identity (free text; not a user account). |
| `ext_id` | `text` | ingest | Stable upstream id (Wikipedia `pageid`, OSM `type/id`) for **idempotent re-ingest dedupe**. Unique-indexed with `source`. **Not in the candidate object today** — it lives only inside `source_url` (`?curid=${pageid}`, `/${el.type}/${el.id}`); extract it at ingest (parse `source_url`, or extend the source fns to emit it). |

**Indexes:** GiST on `geom` (radius queries); btree on `status` (gate filter);
`(source, ext_id)` unique (idempotent ingest); btree on `geohash7`.

**License rule:** `blurb` is ours and carries no attribution; `lore` is CC BY-SA and
**must** surface `source_url`/`license` in-app wherever it appears (the prototype already
shows `source ↗` — the DB carries it through). PRD §9 / brief Decision 5.

---

## 2. Cheapest viable ingest → human-review → import (Greenwich Village)

No admin UI. A Google Sheet is the right altitude for one neighborhood + one curator.

**Step 1 — Ingest (script, reuses `lib/sources.js` logic conceptually).**
- Sweep Greenwich Village on a small **grid of origins** (e.g. ~5×5 points at ~300m
  spacing covering the ~1km² neighborhood) calling the existing
  `gatherCandidates(lat,lng)` (Wikipedia GeoSearch + OSM Overpass), each already returning
  `{source,name,kind,lat,lng,distance_m,lore,source_url}`.
- **Dedupe** across the grid by `(source, ext_id)` — the grid overlaps deliberately so we
  don't miss edges; dedupe removes the repeats. (Name-only dedupe, as `gatherCandidates`
  does per-call, isn't enough across a grid.)
- Stamp `license` per source (`wikipedia→CC-BY-SA`, `openstreetmap→ODbL`), set
  `status='pending'`, leave `category/tags/blurb/quality_flag` empty.
- Upsert into `poi` on `(source, ext_id)` so re-runs are idempotent — fresh open data,
  no duplicate rows, never clobbers a curator's `approved` edits (upsert only the
  ingest-origin columns; leave curation columns untouched if the row exists).

**Step 2 — Export to Google Sheet (script → CSV/Sheets API).**
- One row per `pending` POI: read-only context columns (`name, kind, lore, source_url,
  distance, map_link`) + curator-edit columns (`category, tags, blurb, quality_flag,
  status`). Include hidden `id` for the round-trip.
- Curator (one owner with editorial taste) does the quality layer: drops non-visitable
  junk (districts, schools, private property, person/event-with-no-site — the prototype's
  `EVENT_LIKE`/drop instincts encode this), sets `category`/`tags`, **rewrites `blurb`**
  into DayQuest voice, sets `quality_flag`, and marks `status=approved` or `flagged`.
  This **is** the content-safety gate.

**Step 3 — Import (script → upsert by `id`).**
- Read the sheet back, write curation columns + `status` + `reviewed_at`/`reviewed_by`
  to matching `id`s. Only edited rows change. AI assembly then reads `approved` only.

**Cost:** Wikipedia + Overpass are keyless/free; Supabase free tier covers one
neighborhood; Sheets is free. The only spend is the curator's time (a few focused
sessions, not a hire). Build an admin UI only when curation outgrows a sheet (multi-city).

---

## 3. Quest cache table (`quest_cache`) — cap API cost

| Column | Type | Purpose |
|---|---|---|
| `cache_key` | `text PRIMARY KEY` | `geohash7 + '\|' + vibe + '\|' + time_budget` (e.g. `dr5ru7q\|quiet\|60`). |
| `geohash7` | `text not null` | p7 origin cell (~153m ≈ "same starting block"). p6 too coarse, p8 never hits. |
| `vibe` | `text not null` | Requested vibe (or `any`). |
| `time_budget` | `smallint not null` | Requested minutes, bucketed (e.g. 30/60/90). |
| `quest_json` | `jsonb not null` | The full assembled quest, including the joined authoritative `place` per stop. |
| `created_at` | `timestamptz default now()` | TTL anchor. |

**Lookup:** build `cache_key` from the request; serve `quest_json` if
`now() - created_at < 30d`, else regenerate and upsert. Makes AI cost **flat in usage**
rather than linear.

**Invalidation tradeoff (accepted for Phase 1):** TTL is the *only* invalidation. If a
curator re-curates a POI, cached quests referencing it stay stale up to the TTL. Acceptable
at one-neighborhood scale; a manual cache-purge on import is a one-liner if it bites. A
nightly purge of expired rows keeps the table small.

**Gate note:** the validation gate runs **uncached** (fresh, varied output to score
honestly). Caching is wired *after* the gate clears.

---

## 4. How AI assembly reads from the DB (id-join preserved exactly)

The anti-hallucination guarantee is the most load-bearing decision here, so state it
precisely. **In the current code (`lib/quest.js` + `lib/sources.js`) the LLM-facing id is
the per-request array index** — `buildUserPrompt` numbers candidates `[${i}]` and the join
is `candidates[s.id]`. **`s.id` is a list position, not a database key.**

**Design rule (corrects CTO-RESPONSE.md, which implied the model picks DB ids):**
> The model is shown an **ephemeral, per-request list index** and emits that index. The
> Postgres `poi.id` (uuid) rides *inside* each candidate object for telemetry/cache
> provenance — it is **never rendered into the prompt and never chosen by the model.**

Why this matters: asking the model for real uuids reintroduces hallucination risk *and*
breaks the fallback (live candidates have no DB id). With the index-join, DB-sourced and
live candidates join **identically**.

**Flow (extend `buildQuest`, keep `EMIT_TOOL`/forced-tool/id-join verbatim):**
```
GET /quest?lat=&lng=&vibe=&minutes=
  cache_key = geohash7(lat,lng) + vibe + minutes
  → hit (<30d): return quest_json
  → miss:
      candidates = SELECT id,name,lat,lng,kind,blurb,lore,source,source_url,license,
                          category,tags, ST_Distance(geom, origin) AS distance_m
                   FROM poi
                   WHERE status='approved'
                     AND ST_DWithin(geom, origin, R)   -- R from minutes (e.g. 1500m)
                     AND (vibe = 'any' OR vibe = ANY(tags))
                   ORDER BY distance_m
                   LIMIT 60;                            -- same cap as gatherCandidates
      if candidates.length < 3:                         -- DB thin here
          candidates = gatherCandidates(lat,lng)        -- live fallback (current behavior)
                       filtered by EVENT_LIKE/drop heuristics  -- partial safety substitute
      build list with [index] ids (DB uuid carried, not shown)
      Claude (Sonnet 4.6) assembles 3–5 stops by index → forced-tool emit_quest
      join: place = candidates[s.id]   -- UNCHANGED index-join
      write quest_json to cache; return
```
Changes vs today: candidates come from `approved` POIs first (live second); `stops`
widened 3→3–5; `vibe`/`minutes` added to the prompt. The candidate object now also carries
curator `blurb` (preferred display copy) and `category/tags`. **Model flips off hardcoded
`claude-opus-4-8` → Sonnet 4.6** before the gate spends.

---

## 5. The fallback bypasses the human-review gate — named, not buried

PRD §87/§107 require every **served** stop to have passed human review (real, public,
open, safe). **The live-open-data fallback serves un-reviewed POIs by design** — a real
tension. Phase-1 mitigations:
- Apply the prototype's `EVENT_LIKE`/non-visitable drop heuristics to fallback candidates
  (automated stand-in for human review).
- **Restrict fallback to the curated launch zone** (Greenwich Village bbox); outside it,
  return "no quest here yet" rather than serving ungated content citywide.
- Log every fallback-served stop so the curator can review-and-promote later, shrinking
  fallback reliance over time.

Whether ungated fallback content is acceptable at all is an **open question (Q1)** — the
gate's whole premise is human-vetted quality.

---

## 6. What stays OUT of Phase 1

- **No accounts / auth / PII** — anonymous only; analytics keyed to a device/install id, no
  personal data. (PRD D-002, brief §74.)
- **No persisted user state** — quest progress (check-ins, photos) stays in `App.js` React
  state, fine to lose on close. Persistence arrives with Phase-2 accounts.
- **No admin UI** — the Google Sheet is the review surface.
- **No AI photo verification, no leaderboards/XP, no push** — explicitly cut (brief §72–76).
- **Server-side stores = exactly three:** `poi`, `quest_cache`, fire-and-forget analytics.

*Supabase is adopted now as the POI host because it's also the Phase-2 backend (auth/
storage), so we pay setup once and avoid a migration — but we use only Postgres+PostGIS in
Phase 1. If Supabase setup threatens to block the gate, fall back to local SQLite with an
identical schema; do not let infra block the gate.*

---

## 7. Open questions back to CPO / CEO

1. **Is ungated live-fallback content acceptable?** (§5) The gate's premise is human-vetted
   quality; the fallback serves un-reviewed POIs. Options: allow with heuristics+logging /
   restrict to curated zone only / disable entirely (smaller but 100%-vetted launch). **CTO
   lean: restrict to the Greenwich Village zone + heuristics + log-for-promotion.**
2. **`vibe` vocabulary — fixed list or freeform?** A small fixed set
   (`quiet/quirky/historic/green/iconic`) keeps `tags` curation consistent *and* makes the
   cache key low-cardinality (better hit rate). **CTO lean: fixed ~5.**
3. **`time_budget` buckets** — confirm 30/60/90 min as the only three values (also a cache
   key cardinality lever).
4. **Curator owner + bar** — who owns the sheet, and is `quality_flag ≥ 2` the serve
   threshold or is `status=approved` sufficient alone?
5. **Attribution surface** — confirm in-app display of `source_url`/`license` for
   `lore`-derived copy satisfies CC BY-SA / ODbL (a recap-screen credits line). Legal-ish;
   want it confirmed before testers see content.
```
