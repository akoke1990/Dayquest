-- Server-time authorization for the disclosed App Review demonstration.
-- The client must also be an app-review-capable build; this function only
-- verifies the authenticated user's immutable app_metadata and expiration.

create or replace function public.dayquest_verify_app_review_entitlement()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  entitlement jsonb;
  expires_at timestamptz;
begin
  select reviewer.raw_app_meta_data -> 'dayquest_app_review'
    into entitlement
    from auth.users as reviewer
    where reviewer.id = auth.uid();

  if entitlement is null
    or entitlement ->> 'aud' <> 'com.akoke18.dayquest'
    or entitlement ->> 'version' <> '1.0.0'
  then
    return false;
  end if;

  begin
    expires_at := (entitlement ->> 'expires_at')::timestamptz;
  exception when others then
    return false;
  end;

  return expires_at > now();
end;
$$;

revoke all on function public.dayquest_verify_app_review_entitlement() from public, anon;
grant execute on function public.dayquest_verify_app_review_entitlement() to authenticated;

comment on function public.dayquest_verify_app_review_entitlement() is
'Authorizes an authenticated App Review account using database time; returns no user or entitlement data.';