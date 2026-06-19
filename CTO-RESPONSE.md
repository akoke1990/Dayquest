# DayQuest — CTO Engineering Scope (Phase 1)

**From:** CTO · **Date:** 2026-06-19 · **Reads with:** `CTO-BRIEF.md`, `PRD-v1.md`, `PRD.md`
**Status:** Decision-grade. Doc only — no code changes; validation precedes building.

---

## TL;DR

Extend the working Expo/Node/Anthropic prototype — do not migrate. The core loop
is real and the AI plumbing (forced-tool structured output + id-join
anti-hallucination + server-side keys) is exactly what we'd otherwise rebuild.
The genuinely new work is three things, in order: **(1) clear the validation
gate**, **(2) build the curated POI DB**, **(3) build the map + quest cache.**
Everything stateful (accounts, push, history) waits for Phase 2.

**Reality check from reading the code — gaps the brief understates:**
- **No map exists.** `app/App.js` is a list + live distances only. Map is P0
  (D-008) and is **net-new build**, not "hardening."
- **No POI DB exists.** `lib/sources.js` live-fetches Wikipedia+OSM on every
  request. The curated DB — our moat — is built from zero.
- **No caching exists.** Every `/quest` call regenerates from scratch and (in AI
  mode) pays the LLM. Decision 2 is real work.
- **`lib/quest.js` hardcodes `claude-opus-4-8`**, but the brief mandates
  "Sonnet 4.6 for cost." This needs alignment before we spend on the gate.

---

## Decision 0 — Stack: **EXTEND Expo/Node/Anthropic. Do not migrate.**

Not re-litigated — both PRD and brief settled it. The engineering rationale:

- **The loop works and the AI is wired.** Migrating to FlutterFlow/Firebase/
  OpenAI throws away a validated location→quest→check-in→photo→recap flow plus
  the server key boundary, to validate an *unproven* product. Highest-cost
  mistake available to us.
- **FlutterFlow + Firebase earn their keep on managed auth, storage, and
  push — all Phase-2 concerns.** Adopting them now is paying for infrastructure
  the MVP is explicitly told not to build (no accounts, no push).
- **Expo → TestFlight/Internal Track is cheap** for the 50–100-tester gate. No
  custom native code is needed for Phase 1 (camera, location, maps are all
  Expo-supported).

**Phase-2 reconsideration trigger:** when we commit to building the retention
layer (accounts + occasion-triggered push + persisted history). At that point:
- If Phase 1 ends on a **SQL** store (it will — see Decision 1), **Supabase is
  the smoother migration than Firebase** (Postgres + auth + storage + we keep
  our schema; Firebase forces a NoSQL re-model). **Recommendation: lean
  Supabase-ward**, and we can pre-adopt it as the POI-DB host now (see below) to
  de-risk that migration.
- Keep the Node `/quest` API regardless — it's the key boundary and stays valid
  in front of any backend.

---

## The 5 decisions I own

| # | Decision | Call | Why (1 line) |
|---|---|---|---|
| 1 | Where the POI DB lives + ingest/review workflow | **Supabase Postgres + PostGIS**, seeded by an ingest script → review sheet → import | One store now *and* the Phase-2 backend; PostGIS gives spatial queries for free |
| 2 | Caching strategy | **Cache generated quests in the same DB, keyed by `geohash(precision 7) + vibe + time_budget`, TTL ~30d** | Caps LLM spend; precision-7 ≈ 150m cell ≈ "same starting block" |
| 3 | Minimal persistence | **Infra only: POI DB + quest cache + fire-and-forget analytics. No user PII. Quest progress stays client-side** (App.js already holds it in React state) | Quests are ephemeral until accounts exist (Phase 2) |
| 4 | AI provider | **Anthropic, Sonnet 4.6** | Structured output + id-join already work and keys are wired; switch model off hardcoded Opus to the cheaper Sonnet tier |
| 5 | Load-bearing else | **Attribution carry-through, the human-review = content-safety gate, and an analytics sink for Completed Quest Days** | Legal (CC BY-SA / ODbL) + the North Star are non-optional |

### Notes on each

**1 — POI DB.** For a near-solo team, one neighborhood, ephemeral quests, the
lowest-friction stores are SQLite or a hosted Postgres. I recommend **Supabase
(hosted Postgres + PostGIS)** over local SQLite for one reason: it's *also* the
Phase-2 backend (auth/storage/realtime), so we pay the setup cost once and avoid
a migration later. Free tier covers Phase 1 comfortably. PostGIS gives
`ST_DWithin` radius queries so AI assembly reads "approved POIs within Nm" with
no app-side haversine. (If Supabase setup stalls the gate, fall back to local
SQLite + the `geosearch` we already do — the schema is identical and migrates
cleanly. Don't let infra block the gate.)

**2 — Caching.** Geohash the origin to **precision 7 (~153m × 153m cell)** and
combine with `vibe` + `time_budget` into the cache key. Coarser (p6, ~1.2km)
serves stale routes across too wide an area; finer (p8, ~38m) never hits. Store
the generated quest JSON in the DB with a `created_at`; serve cached if < ~30d
old, else regenerate. This is what makes AI cost flat in usage rather than
linear. Critically: **the gate runs uncached** (we want fresh, varied output to
score); caching is wired *after* the gate.

**3 — Persistence.** Phase 1 needs almost no state, exactly as the brief
predicted:
- **Server-side:** POI DB, quest cache, analytics events. That's it.
- **Client-side (already exists):** per-quest progress lives in `App.js` React
  state — check-ins, photos. Fine to lose on app close pre-accounts.
- **Deferred to Phase 2:** accounts/auth, persisted quest history, badge
  collection, anything tying a quest to a *person*.

**4 — AI provider.** Stay on **Anthropic**, switch the hardcoded
`claude-opus-4-8` in `lib/quest.js` to **Sonnet 4.6** for the gate and bulk
generation (the brief's cost call). Reasons to not switch to OpenAI: forced
tool-use (`tool_choice: {type:"tool"}`) gives us strict structured output that
the id-join anti-hallucination depends on, and it's already working; the keys
are already server-side; cross-vendor migration is pure cost with no MVP upside.
Revisit only if Sonnet quality fails the gate (then test Opus before testing a
new vendor).

**5 — Load-bearing else.**
- **Attribution must persist in the schema** (`source`, `source_url`, license)
  and surface in-app — the prototype already shows `source ↗`; the DB must
  carry it through. CC BY-SA (Wikipedia) / ODbL (OSM) are non-negotiable
  (PRD §9).
- **The human-review step *is* the content-safety gate** (PRD §87/§108): the
  `status` field below is where "real, public, open, safe" gets enforced.
- **Analytics sink** for Completed Quest Days + the funnel
  (start → preview → check-in → photo → complete → share). Fire-and-forget POST
  to the Node API; no PII, anonymous device/install id only.

---

## Phase-1 architecture sketch

### A. Curated POI database

One table is enough for Phase 1.

```
poi
  id            uuid / serial      -- internal id (this is what AI picks by)
  name          text
  lat, lng      double             -- authoritative coords (AI never sets these)
  geom          geography(Point)   -- PostGIS, for ST_DWithin radius queries
  geohash7      text               -- denormalized, for cache-key + cheap bucketing
  category      text               -- green | art | water | historic | other
  tags          text[]             -- vibe matching (e.g. "quirky","quiet","kid-ok")
  blurb         text               -- short curated/sourced lore (the story seed)
  quality_flag  smallint           -- curator's 1–3 star
  status        text               -- pending | approved | flagged   (the gate)
  source        text               -- wikipedia | osm
  source_url    text               -- attribution link
  license       text               -- CC BY-SA | ODbL
  created_at, reviewed_at, reviewed_by
```

**Ingest + review workflow (cheapest viable):**
1. **Ingest script** (reuses `lib/sources.js`) sweeps the launch neighborhood on
   a grid of origins → dedupes → writes rows as `status = pending`.
2. **Export to a Google Sheet** (one row per POI). The curator filters out
   non-visitable junk (districts, schools, private property — the prototype's
   `EVENT_LIKE`/drop rules encode the instinct already), sets `category`,
   `tags`, `quality_flag`, tightens the `blurb`, marks `status = approved` or
   `flagged`.
3. **Import script** writes the sheet back. AI assembly reads **`approved` only.**

No admin UI in Phase 1 — a sheet is the right altitude for one neighborhood and a
solo curator. Build an admin view only when curation outgrows a sheet (multi-city).

### B. Quest-generation pipeline (extend `lib/quest.js`)

Keep the existing shape; swap the data source and add caching:

```
GET /quest?lat=&lng=&vibe=&minutes=
  → cache lookup: key = geohash7(lat,lng) + vibe + minutes
      → hit (< 30d): return cached quest JSON
      → miss:
          → SELECT approved POIs WHERE ST_DWithin(geom, origin, R)  [DB-first]
          → if too few: fall back to live gatherCandidates() (current behavior)
          → AI assembles: picks 3–5 by id, theme, per-stop story hook + photo quest
          → id-join: join chosen ids back to authoritative POI rows  [UNCHANGED]
          → write to cache, return
```

The **id-join anti-hallucination pattern is preserved verbatim** — the only
change is candidates come from the `approved` POI table first, live open-data
second. Forced-tool output and the `EMIT_TOOL` schema stay; widen `stops` to
3–5 and add `vibe`/`minutes` to the prompt.

### C. Check-in & photo (mostly built — confirm, don't rebuild)

- **Check-in = client-side ~100m proximity** — already implemented
  (`CHECKIN_RADIUS_M = 100`, live `watchPositionAsync`).
- **Mandatory manual override** — already implemented ("Can't check in? I'm
  here →"). No server-side geofencing. Good as-is.
- **Photo = capture + attach only.** Already implemented. **NO AI photo
  verification** — explicitly cut; do not build.

---

## Build sequence (validation gate first — blocks everything)

0. **Align the model** — point `lib/quest.js` at **Sonnet 4.6** (trivial, but do
   it before spending on the gate).
1. **★ VALIDATION GATE ★** — with a funded key, generate **10–20 quests across
   the chosen neighborhood (uncached)** and human-score them *real / visitable /
   accurate / interesting* against the PRD's ~90% bar. **If weak, fix prompt +
   source before anything else.** Hours, not days. **This blocks 2–5.**
2. **Curated POI DB** — stand up Supabase, ingest script → review sheet →
   import; wire AI assembly to read `approved` POIs first (live fallback).
3. **Quest cache** — geohash-keyed, in the same DB.
4. **App build/harden** — **map (net-new, P0)**, quest preview, pause/resume/
   abandon, time/distance fit, magic-moment onboarding, analytics events.
5. **Ship to ~50–100 NYC testers** via Expo/TestFlight; watch the North Star.

---

## What I need back from CPO / CEO

1. **A funded Anthropic API key (OD-1) — leads everything; the gate cannot run
   without it.** This is the single blocker.
2. **The launch neighborhood — my pick: Greenwich Village.** Dense, walkable,
   high Wikipedia/OSM coverage, strong Atlas-Obscura-flavored lore, tourist +
   local appeal. (FiDi is the runner-up: dense and historic but quieter on
   weekends and thinner residential repeat-use.) Pick one; nail it.
3. **A monthly API budget ceiling** so I can size caching aggressiveness and the
   gate's quest count.
4. **Who does the curation** — the review sheet needs one owner with editorial
   taste. ~1 neighborhood is a few focused sessions, not a hire.
