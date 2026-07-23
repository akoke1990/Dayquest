-- Durable DayQuest content/safety failure queue.
-- Apply before enabling production content-failure replacement. The API writes
-- with SUPABASE_SERVICE_KEY only; clients have no direct table access.

create table public.content_failures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reason text not null check (reason in (
    'unsafe', 'blocked_closed', 'inaccessible', 'missing', 'incorrect'
  )),
  place_id text not null check (
    char_length(place_id) between 7 and 200 and place_id like 'place:%'
  ),
  quest_content_version_id text check (
    quest_content_version_id is null
    or char_length(quest_content_version_id) between 1 and 200
  ),
  priority text not null check (priority in ('safety', 'content')),
  curator_action text not null check (curator_action in (
    'immediate_review', 'availability_review', 'accessibility_review', 'content_review'
  )),
  accessibility_status text not null default 'unknown'
    check (accessibility_status in ('unknown')),
  request_id uuid not null unique,
  status text not null default 'open'
    check (status in ('open', 'in_review', 'resolved', 'dismissed')),
  check (
    (reason = 'unsafe' and priority = 'safety' and curator_action = 'immediate_review')
    or (reason = 'blocked_closed' and priority = 'content' and curator_action = 'availability_review')
    or (reason = 'inaccessible' and priority = 'content' and curator_action = 'accessibility_review')
    or (reason in ('missing', 'incorrect') and priority = 'content' and curator_action = 'content_review')
  )
);

create index content_failures_open_priority_created_at_idx
  on public.content_failures (priority, created_at)
  where status = 'open';
create index content_failures_open_created_at_idx
  on public.content_failures (created_at)
  where status = 'open';

alter table public.content_failures enable row level security;
alter table public.content_failures force row level security;
revoke all on table public.content_failures from public, anon, authenticated;
grant select, insert, update, delete on table public.content_failures to service_role;

comment on table public.content_failures is
'DayQuest service-role-only structured content/safety queue. Contains no location, route, media, clue, answer, account, install, network, or free-form data.';
