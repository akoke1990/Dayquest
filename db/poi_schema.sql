-- DayQuest — POI table schema (Supabase Postgres + PostGIS).
--
-- ============================================================================
-- Run this in Supabase → SQL Editor  (one time, before the first ingest).
-- ============================================================================
--
-- This is "Increment 1: store + label". It creates the single source-of-truth
-- `poi` table that the ingest script populates and a human curates in the
-- Supabase Table Editor. It does NOT wire quest-serving — that's a later
-- increment.
--
-- Geo model: `geom` is geography(Point,4326) so future ST_DWithin radius
-- queries take meters directly (no projection math). It is a GENERATED column
-- derived from base lat/lng, so the ingest never has to push a PostGIS value
-- through the REST API — it just sends lat/lng and Postgres computes geom.

-- PostGIS powers the geography column + GiST radius index.
create extension if not exists postgis;

-- pgcrypto / gen_random_uuid() is built into modern Postgres (Supabase has it),
-- but enable defensively so id defaults work on any instance.
create extension if not exists pgcrypto;

create table if not exists public.poi (
  id            uuid primary key default gen_random_uuid(),

  -- --- ingest-sourced columns (the ingest writes/refreshes these) -----------
  name          text not null,
  lat           double precision not null,
  lng           double precision not null,
  -- geom is derived from base lat/lng. ST_MakePoint takes (x=lng, y=lat).
  -- GENERATED ALWAYS ... STORED keeps it in sync and indexable; the expression
  -- is immutable so it is legal in a generated column.
  geom          geography(Point, 4326)
                  generated always as
                  (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  geohash       text,                       -- p7-ish cell, computed in JS at ingest
  area          text,                       -- named Area, e.g. "Greenwich Village, NY"
  kind          text,                       -- factual OSM/Places type (read-only context)
  lore          text,                       -- sourced snippet (Wikipedia extract); CC BY-SA
  source        text not null,              -- wikipedia | openstreetmap | google
  source_url    text not null,              -- attribution link
  license       text,                       -- CC-BY-SA (Wikipedia) | ODbL (OSM) | ...
  ext_id        text not null,              -- stable upstream id; (source, ext_id) is the upsert key

  -- --- curation columns (a human fills these; the ingest NEVER clobbers them) -
  category      text,                       -- green | art | water | historic | other
  tags          text[],                     -- vibe tokens: quiet, quirky, iconic, ...
  blurb         text,                       -- curator-rewritten DayQuest copy (DayQuest-owned)
  quality_flag  smallint,                   -- curator 1–3 quality/confidence
  status        text not null default 'pending',  -- pending | approved | maybe | flagged

  -- --- timestamps ------------------------------------------------------------
  created_at    timestamptz default now(),
  reviewed_at   timestamptz,

  -- Keep status to the known vocabulary.
  constraint poi_status_chk
    check (status in ('pending', 'approved', 'maybe', 'flagged'))
);

-- Idempotent re-ingest: upsert on (source, ext_id). ext_id is NOT NULL so the
-- dedup never leaks (NULLs are distinct in a Postgres unique index).
create unique index if not exists poi_source_extid_uidx on public.poi (source, ext_id);

-- Radius queries (later increment): GiST on the geography column.
create index if not exists poi_geom_gix on public.poi using gist (geom);

-- The serve-gate filter and per-Area curation views.
create index if not exists poi_status_idx on public.poi (status);
create index if not exists poi_area_idx   on public.poi (area);

-- ============================================================================
-- Row-Level Security
-- ============================================================================
-- Enable RLS, then grant the public/anon role SELECT of *approved* rows only,
-- so the app/server can later read approved POIs with the publishable (anon)
-- key. No anon INSERT/UPDATE policy: the ingest authenticates with the
-- service_role key, which BYPASSES RLS entirely — so ingest upserts just work
-- and writes stay locked to that key.
alter table public.poi enable row level security;

-- Idempotent policy creation (Postgres has no "create policy if not exists").
drop policy if exists poi_public_read_approved on public.poi;
create policy poi_public_read_approved
  on public.poi
  for select
  to anon, authenticated
  using (status = 'approved');
