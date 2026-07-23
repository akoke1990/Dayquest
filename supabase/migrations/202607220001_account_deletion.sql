-- DayQuest account-deletion data contract.
-- Derived from app/lib/auth.js, app/lib/social.js, lib/sharedhunts.js,
-- app/SUPABASE_SETUP.md and db/MULTIPLAYER_DESIGN.md at release commit 07ece04.
-- Apply only after reviewing the preflight queries against the target project.

create table if not exists public.auth_provider_secrets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null check (provider in ('apple')),
  encrypted_refresh_token text not null,
  revoked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.auth_provider_secrets enable row level security;
revoke all on table public.auth_provider_secrets from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_provider_secrets to service_role;

create or replace function public.delete_dayquest_user_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  unknown_dependencies text[];
  owned_storage_count bigint := 0;
  profiles_deleted bigint := 0;
  friendships_deleted bigint := 0;
  results_deleted bigint := 0;
  shared_hunts_anonymized bigint := 0;
begin
  if p_user_id is null then
    raise exception 'user id is required';
  end if;

  -- Fail closed if the live schema has acquired any user-shaped public column
  -- that this contract does not enumerate. This catches non-FK ownership columns.
  select array_agg(format('%I.%I(%I)', c.table_schema, c.table_name, c.column_name) order by 1)
    into unknown_dependencies
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.column_name in ('user_id', 'owner_id', 'created_by', 'profile_id')
    and (c.table_name, c.column_name) not in (
      ('hunt_results', 'user_id'),
      ('shared_hunts', 'created_by'),
      ('auth_provider_secrets', 'user_id')
    );
  if coalesce(array_length(unknown_dependencies, 1), 0) > 0 then
    raise exception 'Unknown user-linked columns block deletion: %', array_to_string(unknown_dependencies, ', ');
  end if;

  -- Also fail closed on any unknown FK that points at auth.users, regardless of
  -- its column name. Known represented dependencies are enumerated explicitly.
  select array_agg(format('%I.%I(%I)', n.nspname, r.relname, a.attname) order by 1)
    into unknown_dependencies
  from pg_constraint con
  join pg_class r on r.oid = con.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  cross join lateral unnest(con.conkey) as key(attnum)
  join pg_attribute a on a.attrelid = r.oid and a.attnum = key.attnum
  where con.contype = 'f'
    and con.confrelid = 'auth.users'::regclass
    and n.nspname = 'public'
    and (r.relname, a.attname) not in (
      ('profiles', 'id'),
      ('friendships', 'requester_id'),
      ('friendships', 'addressee_id'),
      ('hunt_results', 'user_id'),
      ('shared_hunts', 'created_by'),
      ('auth_provider_secrets', 'user_id')
    );
  if coalesce(array_length(unknown_dependencies, 1), 0) > 0 then
    raise exception 'Unknown user-linked foreign keys block deletion: %', array_to_string(unknown_dependencies, ', ');
  end if;

  -- No server photo bucket exists in the repository. Refuse to pretend unknown
  -- Storage objects were deleted; add a reviewed Storage API deletion phase first.
  if to_regclass('storage.objects') is not null then
    execute 'select count(*) from storage.objects where owner_id::text = $1'
      into owned_storage_count using p_user_id::text;
    if owned_storage_count > 0 then
      raise exception 'Unknown user-linked storage.objects (%) block deletion', owned_storage_count;
    end if;
  end if;

  -- Every statement is idempotent. This function runs transactionally: an error
  -- rolls back all changes, making a corrected retry safe.
  if to_regclass('public.friendships') is not null then
    execute 'delete from public.friendships where requester_id = $1 or addressee_id = $1'
      using p_user_id;
    get diagnostics friendships_deleted = row_count;
  end if;

  if to_regclass('public.hunt_results') is not null then
    execute 'delete from public.hunt_results where user_id = $1' using p_user_id;
    get diagnostics results_deleted = row_count;
  end if;

  -- Shared hunt content is not personal content and remains usable by invitees;
  -- remove creator linkage instead of deleting the canonical quest.
  if to_regclass('public.shared_hunts') is not null then
    execute 'update public.shared_hunts set created_by = null where created_by = $1'
      using p_user_id;
    get diagnostics shared_hunts_anonymized = row_count;
  end if;

  if to_regclass('public.profiles') is not null then
    execute 'delete from public.profiles where id = $1' using p_user_id;
    get diagnostics profiles_deleted = row_count;
  end if;

  -- auth_provider_secrets intentionally remains until auth.admin.deleteUser()
  -- succeeds. Its FK then cascades. This preserves retry-safe Apple revocation.
  return jsonb_build_object(
    'profiles_deleted', profiles_deleted,
    'friendships_deleted', friendships_deleted,
    'hunt_results_deleted', results_deleted,
    'shared_hunts_anonymized', shared_hunts_anonymized
  );
end;
$$;

revoke all on function public.delete_dayquest_user_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_dayquest_user_data(uuid) to service_role;

comment on function public.delete_dayquest_user_data(uuid) is
'DayQuest fail-closed, idempotent linked-data deletion. Edge Function authenticates caller; service_role only.';
