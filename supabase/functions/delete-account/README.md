# `delete-account` Edge Function — release runbook

This function is **not deployed by this repository change**.

## Required Supabase secrets

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (Edge Function only; never the app)
- `APPLE_TEAM_ID`
- `APPLE_CLIENT_ID` — confirm whether the native bundle ID `com.akoke18.dayquest` or the configured Services ID is correct for the authorization code flow
- `APPLE_KEY_ID`
- `APPLE_PRIVATE_KEY_P8` — full `.p8` PEM, secret value
- `ACCOUNT_DELETION_TOKEN_ENCRYPTION_KEY` — base64 of exactly 32 random bytes

Generate the encryption key locally with `openssl rand -base64 32`; store it only as a Supabase secret. Losing it prevents revocation of stored Apple refresh tokens and therefore blocks safe deletion for those accounts.

## Preflight (must be run against the real project)

1. Review `supabase/migrations/202607220001_account_deletion.sql` against the live schema.
2. Inventory every FK to `auth.users`, every ownership column, every Storage bucket, server logs, backup policy, and external processor deletion requirement.
3. Resolve any `Unknown user-linked ... block deletion` result by extending the contract and tests; never bypass the guard.
4. Confirm `shared_hunts.created_by` is nullable before migration; the represented design declares it nullable.
5. Decide and document the retention schedule and backup deletion behavior.

## Deployment (owner-run only)

```sh
supabase link --project-ref <PROJECT_REF>
supabase db push
supabase secrets set SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
  APPLE_TEAM_ID=... APPLE_CLIENT_ID=... APPLE_KEY_ID=... APPLE_PRIVATE_KEY_P8=... \
  ACCOUNT_DELETION_TOKEN_ENCRYPTION_KEY=...
supabase functions deploy delete-account --no-verify-jwt
```

`--no-verify-jwt` delegates JWT validation to the function because it explicitly calls `auth.getUser()` with the bearer token. The service-role client is created only after caller validation.

## Live verification

Use dedicated test accounts for Google and Apple:

1. Sign in and verify an `auth_provider_secrets` row is created for Apple only.
2. Create profile, friendships in both directions, hunt results, and a creator-linked shared hunt.
3. Delete in-app. Verify Apple revoke returns success, known rows are deleted, `shared_hunts.created_by` is null, auth user is gone, session is signed out, and local photos/keys are gone.
4. Simulate an RPC failure/unknown table and verify local data remains and retry is offered.
5. Simulate `auth.admin.deleteUser` failure after RPC; retry must use `revoked_at` and idempotent deletes.
6. Verify a Storage-owned object blocks deletion until a reviewed Storage API cleanup is implemented.

Do not submit while any Apple account lacks a stored revocation token or any release blocker in `docs/app-store/reviewer-checklist.md` is open.
