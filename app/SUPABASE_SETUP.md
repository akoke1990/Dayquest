# DayQuest — Supabase Auth + Profile Setup

Sign-in is **optional**. With the Supabase keys empty (the default), the app runs
fully anonymous — the sign-in entry shows a disabled "coming soon" state and
nothing touches Supabase. Wire the steps below to turn it on.

---

## 1. Create the `profiles` table + Row Level Security

Run this in the Supabase dashboard → **SQL Editor**. RLS ensures a signed-in user
can read/write **only their own row** (`id = auth.uid()`).

```sql
-- Profile row, one per auth user. id == auth user id.
create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  email            text,
  display_name     text,
  avatar_url       text,
  total_points     integer not null default 0,
  quests_completed integer not null default 0,
  streak_weeks     integer not null default 0,
  updated_at       timestamptz not null default now()
);

-- Keep updated_at fresh on every write.
create or replace function public.touch_profiles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.touch_profiles_updated_at();

-- Lock the table down.
alter table public.profiles enable row level security;

-- A user can SELECT only their own row.
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- A user can INSERT only a row whose id is their own uid.
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- A user can UPDATE only their own row.
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
```

The app upserts on `id` (conflict target = `id`), so the `insert` + `update`
policies together cover the upsert path. No `delete` policy is granted — profiles
are never deleted from the client.

### 1b. Public profile view (cross-user names/avatars — NO email/points)

Friends lists and leaderboards need to show OTHER users' **display name + avatar**
— but they must NEVER see another user's **email** or **total_points**. So
instead of a broad cross-user SELECT policy on `profiles` (which would expose the
whole row), expose a narrow **view** with only the three public columns. A plain
(non-`security_invoker`) view runs with its owner's rights, so it returns all
users' rows while the `profiles` table itself stays own-row-only.

Run this once (and DROP the old broad policy if you ever added one):

```sql
-- Public, non-PII projection of profiles for friends list + leaderboard.
-- Only id/display_name/avatar_url — email + points stay private to the owner.
create or replace view public.public_profiles as
  select id, display_name, avatar_url
  from public.profiles;

-- Any signed-in user may read the public view; anon too (harmless — the app
-- only queries it while signed in). The view is a definer view, so it does NOT
-- need SELECT on the base table to be granted to these roles.
grant select on public.public_profiles to authenticated, anon;

-- Remove the broad cross-user read on the base table if it was ever added, so
-- `profiles` reverts to own-row-only (email/points private). Safe if absent.
drop policy if exists "profiles_select_others" on public.profiles;
```

The app's `fetchProfiles()` (in `app/lib/social.js`) reads `public_profiles`;
the user's OWN profile (auth + score sync, in `app/lib/auth.js`) still reads
`profiles`. If the view isn't applied yet, `fetchProfiles` degrades to blank
names ("Player") — it never crashes.

---

## 2. Dashboard configuration checklist

Everything here is done in the Supabase dashboard for the project, plus the two
provider consoles.

### a. Project URL + anon key → app config
- Dashboard → **Project Settings → API**. Copy the **Project URL** and the
  **anon / public** key.
- Put them in `app/app.json` under `expo.extra`:
  ```json
  "extra": {
    "SUPABASE_URL": "https://YOUR-REF.supabase.co",
    "SUPABASE_ANON_KEY": "eyJhbGci..."
  }
  ```
  (Or inject `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` as env
  vars at build time — `config.js` reads `extra` first, then `process.env`.)
- The anon key is safe to ship in the client; RLS is what protects the data.
- As soon as both are non-empty, `authConfigured` flips to `true` and the
  sign-in UI appears. Restart Metro after changing `app.json`.

### b. Enable the Google provider
- Dashboard → **Authentication → Providers → Google → enable**.
- You need a **Google OAuth client** (Google Cloud Console → APIs & Services →
  Credentials → OAuth client ID, type *Web application*). Paste its **Client ID**
  and **Client secret** into the Supabase Google provider form.
- In the Google client's **Authorized redirect URIs**, add Supabase's callback:
  `https://YOUR-REF.supabase.co/auth/v1/callback`.

### c. Enable the Apple provider
- Dashboard → **Authentication → Providers → Apple → enable**.
- Requires an **Apple Developer account**: create a **Service ID** (Sign in with
  Apple), a **Key** (.p8) and your **Team ID**, and configure the Service ID's
  return URL to Supabase's callback
  `https://YOUR-REF.supabase.co/auth/v1/callback`.
- Enter the Service ID, Team ID, Key ID and the .p8 contents into the Supabase
  Apple provider form.

### d. Add the app's redirect URL (the one that returns to the app)
- Dashboard → **Authentication → URL Configuration → Redirect URLs**. Add the
  redirect URL the app sends as `redirectTo`. The app builds this with
  `AuthSession.makeRedirectUri({ scheme: 'dayquest' })` (see `getRedirectTo()` in
  `app/lib/auth.js`). With expo-auth-session 7.x there is **no** `auth.expo.io`
  proxy — `makeRedirectUri` returns a real URL for the current runtime:
  - **Standalone / dev build:** `dayquest://` (the app `scheme` from `app.json`).
    Add `dayquest://` (and `dayquest://*` if your dashboard wants a path wildcard).
  - **Expo Go:** a dev URL like `exp://127.0.0.1:8081/--/` (the host/IP is your
    Metro address and changes per machine/session), so it is awkward to
    allow-list. **Recommended:** test OAuth in a **development build**
    (`npx expo run:ios` / EAS dev build) where the redirect is the stable
    `dayquest://`. Expo Go can still run the whole anonymous app — only the live
    OAuth round-trip benefits from a dev build.
- **Get the exact value to allow-list** by logging what `getRedirectTo()` returns
  on the target device/runtime, then add precisely that string. Supabase rejects
  any redirect not on the allow-list.

---

## 3. What needs a real device + live project to verify
- The full OAuth round-trip (Google and Apple) — opens a browser, returns
  tokens, calls `setSession`.
- The `profiles` upsert/select round-trip under RLS.
- Push-on-completion: finishing a quest while signed in updates the profile row.

The unconfigured (anonymous) path is the default and bundles/runs without any of
the above.
