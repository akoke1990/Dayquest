# DayQuest App Store privacy/account-deletion reviewer checklist

## Hard stop: owner/legal inputs

- [ ] `LEGAL_ENTITY_NAME` approved (no guessed company/address).
- [ ] `SUPPORT_CONTACT` and public `SUPPORT_URL` active and tested.
- [ ] `PRIVACY_POLICY_URL` and `TERMS_URL` published, HTTPS, stable, and configured as Expo/EAS release variables.
- [ ] Data-class `RETENTION_SCHEDULE`, backup behavior, deletion timelines, legal bases, rights, territories, age position, processor/transfer disclosures, and open-data notices approved.
- [ ] Confirm actual DayQuest API host and all production subprocessors/contracts.
- [ ] Decide how install-ID JSONL logs and backups respond to deletion/access requests; the account deletion RPC cannot identify those logs by auth user.

## Build/configuration

- [ ] Set `EXPO_PUBLIC_PRIVACY_POLICY_URL`, `EXPO_PUBLIC_TERMS_URL`, and `EXPO_PUBLIC_SUPPORT_URL` (or matching Expo `extra` values).
- [ ] Review `docs/app-store/privacy-inventory.json` against the exact shipping binary, SDK privacy manifests, server config, and App Store Connect definitions.
- [ ] Resolve conservative linked/unlinked decisions for precise location, install ID, usage, and feedback.
- [ ] Verify permission strings match behavior; location is foreground only, camera is optional, photo library is optional.
- [ ] Remove/replace any UI claim that photos are remotely “verified” unless verification is actually built and disclosed.

## Supabase/account deletion (no deployment performed here)

- [ ] Compare live schema, functions, triggers, views, Storage buckets, extensions, backups, logs, and external integrations to the repository data contract.
- [ ] Review/apply `supabase/migrations/202607220001_account_deletion.sql`.
- [ ] Configure all secrets listed in `supabase/functions/delete-account/README.md`.
- [ ] Deploy `delete-account`; confirm client function name/project match.
- [ ] Ensure every Apple sign-in creates encrypted revocation state. Existing Apple users without a refresh token need an approved re-authorization/migration path.
- [ ] Live-test Google deletion and Apple deletion on physical iOS hardware.
- [ ] Verify profile, friendships (both sides), hunt results, shared-hunt creator linkage, auth identity, and provider-secret outcomes.
- [ ] Verify unknown FK/ownership columns and owned Storage objects fail closed before auth deletion.
- [ ] Verify server failure leaves local AsyncStorage/photos/session available for retry.
- [ ] Verify server success clears represented local keys/photos/reminders, signs out, and routes to sign-in.
- [ ] Verify repeated data RPC/auth-delete-failure retry uses Apple `revoked_at` and idempotent SQL.

## Durable content-failure queue (hard stop; no deployment performed here)

- [ ] Review/apply `supabase/migrations/202607230001_content_failures.sql`; verify RLS enabled/forced, zero anon/authenticated policies or grants, and service-role-only table privileges.
- [ ] Configure server-only `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` on the production API host; verify neither value reaches app/public config, responses, or logs.
- [ ] Post every structured reason against production-like content and complete a service-role **live read-back** by response `request_id`; confirm the row has only the approved structured columns.
- [ ] Prove unconfigured and failed writes return sanitized 503 `CONTENT_FAILURE_PERSISTENCE_UNAVAILABLE`, `penalty:false`, and no replacement or live-AI call.
- [ ] Enable and test a **queue alert** for persistence failures and overdue open `safety` rows; archive redacted alert evidence.
- [ ] Assign the immediate unsafe pause owner (`{{CONTENT_SAFETY_OWNER}}`) and verify that owner can pause/retire affected content immediately.

## In-app reviewer path

- [ ] Signed in: Menu → Profile → Delete account is easy to find.
- [ ] Confirmation names permanent effects and cannot be mistaken for sign-out.
- [ ] VoiceOver announces deletion/reset buttons, busy/disabled state, and retry error.
- [ ] Guest: Menu → Settings → Reset guest data is clearly separate from account deletion.
- [ ] Menu → Privacy & legal accurately shows local/cloud handling, analytics choice, legal links, support, and attribution.
- [ ] Analytics off prevents future `track()` events; owner confirms whether user-initiated feedback/score behavior should remain available.

## App Store Connect/reviewer notes

- [ ] Enter the privacy nutrition label from the reviewed machine inventory, not this draft verbatim.
- [ ] Privacy Policy URL and Support URL are publicly reachable without login.
- [ ] Reviewer test account and steps are supplied; no production secrets included.
- [ ] Reviewer note: “Account deletion: Menu → Profile → Delete account.”
- [ ] Explain guest reset separately and state there are no in-app purchases/subscriptions in the represented build (reconfirm shipping binary).
- [ ] Confirm Sign in with Apple token revocation with live logs that do not expose tokens.

## Required evidence archive

- [ ] Shipping commit/build number and `npx expo config --type public` output.
- [ ] Test output and physical-device screen recording (confirmation, failure retry, success).
- [ ] Redacted Supabase logs for caller validation, Apple revoke success, RPC summary, and auth deletion.
- [ ] Live-schema preflight result and signed owner/legal approval of published drafts.
