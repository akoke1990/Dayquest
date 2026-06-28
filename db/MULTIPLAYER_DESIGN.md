# DayQuest — Multiplayer / Friends Design (for the Wave-2 build)

**Owner:** CPO/Eng · **Date:** 2026-06-28 · Scope: the lean, launch-viable multiplayer (D-061).
Builds on the **shared-hunt backbone** already shipped (server `hunt_id`, `GET /quest?shared=1`,
`GET /shared-hunt/:id`). NOT real-time live presence — that's a later, bigger build.

## The experience (lean multiplayer)
1. **Add friends** — invite by link/code (deep link `dayquest://join?...`) or accept a request.
2. **Hunt together** — one friend starts a shared hunt (gets a `hunt_id`), shares a join link; friends join → everyone gets the **identical** hunt (same clues/places/order).
3. **Compete** — each player's result posts to a **leaderboard** (fastest, most found, points). Async — you don't need to be online at the same time.

## Architecture decision
- **Social data (friends, results, leaderboard) → app talks DIRECTLY to Supabase** (RLS-protected, the Supabase-native pattern — minimal new server code).
- **Shared-hunt content → the existing Node `/quest?shared` server** (already built). **Move the shared-hunt store from in-memory → a Supabase `shared_hunts` table** so a hunt survives server sleep/redeploy and friends can join hours later (closes the server's TODO(D-046) seam).

## Supabase schema (SQL to add)
```sql
-- 1. Friendships (request → accept model)
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references auth.users on delete cascade not null,
  addressee_id uuid references auth.users on delete cascade not null,
  status text not null default 'pending',           -- pending | accepted
  created_at timestamptz default now(),
  unique (requester_id, addressee_id)
);
alter table public.friendships enable row level security;
-- you can see/insert/update rows where you're either side
create policy friendships_select on public.friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);
create policy friendships_insert on public.friendships for insert
  with check (auth.uid() = requester_id);
create policy friendships_update on public.friendships for update      -- accept/decline
  using (auth.uid() = addressee_id or auth.uid() = requester_id);

-- 2. Hunt results (the leaderboard rows)
create table public.hunt_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  hunt_id text not null,                  -- the shared hunt's id
  area text,
  found_count int default 0,
  total_stops int default 0,
  time_seconds int,
  points int default 0,
  completed_at timestamptz default now(),
  unique (user_id, hunt_id)               -- one result per person per hunt
);
alter table public.hunt_results enable row level security;
create policy results_insert on public.hunt_results for insert with check (auth.uid() = user_id);
create policy results_update on public.hunt_results for update using (auth.uid() = user_id);
-- read your own + anyone who shares a hunt you're in (simplest: read any result for a hunt_id you have a result in)
create policy results_select on public.hunt_results for select
  using (auth.uid() = user_id
     or hunt_id in (select hunt_id from public.hunt_results where user_id = auth.uid()));

-- 3. Shared hunts (durable store; moves the server's in-memory map here)
create table public.shared_hunts (
  hunt_id text primary key,
  area text, mode text, size text,
  quest jsonb not null,
  created_by uuid references auth.users,
  created_at timestamptz default now()
);
alter table public.shared_hunts enable row level security;
create policy shared_hunts_select on public.shared_hunts for select using (true);   -- joinable by anyone with the id
-- writes via service role from the server (RLS bypassed) OR an authenticated insert policy
```

## App UI (Wave 2)
- **Friends screen:** your friends list, pending requests (accept/decline), an **Add friend** flow (share your join link / enter a code).
- **"Hunt with friends":** on the Quest Setup or a finished shared-hunt, an **Invite** action (share the `hunt_id` join link). Opening a `dayquest://join?hunt=<id>` link joins that hunt.
- **Leaderboard:** per shared-hunt, friends ranked by time/found/points; a "you vs friends" view.
- On hunt completion (signed in), **post a `hunt_results` row**; the leaderboard reads from it.

## Build split (Wave 2)
1. **Server:** move `sharedHuntGet/Set` to the Supabase `shared_hunts` table (durable). (Needs the service key.)
2. **App ↔ Supabase:** friends (invite/accept/list), join-by-link (deep link), post hunt_results, leaderboard view. App-side + the SQL above.

## Out of scope (later)
Real-time live presence (seeing friends move on the map), team/co-op modes, chat. The async leaderboard is the launch version.
