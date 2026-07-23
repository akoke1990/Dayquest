# Sign in with Apple and account-deletion live verification

**Status:** repository implementation exists; deployment and live behavior are unverified. Automated source tests do not satisfy this checklist.

## Observed foundation

Expo config includes Apple authentication, `usesAppleSignIn`, and bundle ID `com.akoke18.dayquest`. Native flow uses identity token with Supabase and forwards one-time authorization code for encrypted revocation state. Client calls authenticated Edge Function before local cleanup. Migration/function guard known linked data and delete auth last. These facts do not prove live configuration, deployment, secrets, schema, revocation, or device behavior.

## A. Apple configuration

- [ ] `{{APPLE_DEVELOPER_TEAM}}` and App ID capability confirmed.
- [ ] Candidate provisioning/entitlements contain Sign in with Apple.
- [ ] Supabase Apple provider is configured for exact native flow.
- [ ] Team/client/key IDs and private key are current and stored only as Edge Function secrets.
- [ ] Decide native bundle ID vs Services ID for authorization-code exchange; archive evidence.
- [ ] Key rotation/revocation owner and expiry monitoring assigned.
- [ ] Physical-device test identities cover Hide My Email and first/returning consent.

## B. Live sign-in

Archive TestFlight build, device/iOS, test alias, date, redacted logs, result.

- [ ] First consent returns required credential, session/profile, and successful authorization-code registration.
- [ ] Encrypted provider-secret row exists for Apple only.
- [ ] No token/code/key in client logs, analytics, crashes, screenshots, support output.
- [ ] Cancel is non-error; guest remains usable.
- [ ] Returning sign-in works when Apple omits name/email.
- [ ] Hide My Email behavior works without unsupported email-delivery claims.
- [ ] Sign-out/sign-in and force-close/relaunch behave correctly.
- [ ] Google/guest remain usable and Apple prominence is compliant.

## C. Live schema/deployment

- [ ] Diff migration against live schema.
- [ ] Inventory all auth-user FKs/ownership, views, triggers, functions, extensions, Storage, logs, backups, webhooks, analytics, processors.
- [ ] Extend reviewed contract/tests for every dependency; never bypass fail-closed guard.
- [ ] Apply migration through approved production change control.
- [ ] Configure every secret in `supabase/functions/delete-account/README.md`.
- [ ] Deploy `delete-account` to candidate's Supabase project.
- [ ] Confirm caller validation and service-role isolation.
- [ ] Resolve install-ID JSONL and backup access/deletion/retention.
- [ ] Document rollback without recreating deleted identity/data.

## D. Destructive end-to-end cases

Use disposable synthetic Apple/Google accounts and record seeded IDs.

| Case | Expected | Pass |
|---|---|---|
| Apple happy path | Revoke; approved rows removed/anonymized; auth last; local keys/photos/reminder clear; sign-out | [ ] |
| Google happy path | Approved linked cleanup; auth last; local cleanup/sign-out | [ ] |
| Friendships both directions | Rows removed | [ ] |
| Results/profile/provider secret | Removed per contract | [ ] |
| Shared creator link | `created_by` null per approved behavior | [ ] |
| Unknown dependency | Fails before auth deletion; local/session kept; retry shown | [ ] |
| Owned Storage object | Blocks until reviewed cleanup | [ ] |
| Apple revoke failure | Identity/local data retained for retry; no false success | [ ] |
| RPC success/auth failure | Retry safe/idempotent; `revoked_at` respected | [ ] |
| Offline/timeout | No local cleanup; retry; account usable | [ ] |
| Local cleanup failure after server success | Actual behavior documented/approved; no false erasure claim | [ ] |
| Reinstall/old token | Deleted session cannot regain account | [ ] |

## E. Discoverability/accessibility

- [ ] Menu → Profile → Delete account visible without support.
- [ ] Permanent deletion clearly differs from sign-out.
- [ ] Confirmation/busy/success/retry work with VoiceOver.
- [ ] Dynamic Type, contrast, focus order, targets, non-color status checked without making broad marketing claims.
- [ ] Guest reset remains separate and local.
- [ ] Public deletion/support copy matches live behavior.

Submission requires `{{APPLE_DELETION_EVIDENCE_ARCHIVE}}`, `{{ENGINEERING_APPROVER}}`, `{{PRIVACY_LEGAL_APPROVER}}`, and `{{RELEASE_OWNER}}`. Never store secret values here.
