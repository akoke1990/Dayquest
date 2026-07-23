# DayQuest iOS 1.0 release and rollback runbook

**Scope:** documentation only. Do not run EAS, deploy, upload, submit, release, or edit App Store Connect from this workstream.

## Principles

Ship free 1.0 with no ads/subscriptions/IAP; Custom Hunts stay deployment 2. Release only an approved limited-NYC cohort. Remote/source review is not field verification. Build, legal, backend, content, deletion, TestFlight, review, and monitoring gates are independent. Apple has no instant previous-binary rollback; prefer halt/phased pause/content retirement/fix forward.

## 1. Freeze candidate

- [ ] Record clean reviewed `{{CANDIDATE_COMMIT}}`; CI/tests green.
- [ ] Confirm config name/version/bundle, portrait/no iPad, SIWA, permissions, export declaration.
- [ ] Confirm production EAS environment, remote build numbers, auto-increment.
- [ ] Archive resolved dependencies/SDK manifests.
- [ ] Confirm no deployment-2 copy/SKU and no ads/IAP/subscriptions.
- [ ] Apply owner-approved tag policy `{{TAG_POLICY}}`.

## 2. Production prerequisites

- [ ] API externally healthy (`/health`, `/ready`, `/`, representative `/quest`) within approved thresholds.
- [ ] Approved content cohort published through lifecycle with claim-appropriate field/access/safety evidence.
- [ ] Research candidates cannot leak; pause/retire and penalty-free replacement exercised.
- [ ] Supabase RLS/auth/social reviewed; deletion deployed/live-tested.
- [ ] Production map key restricted.
- [ ] Public URLs/config, privacy/manifests, age/content rights/export, metadata/screenshots/reviewer notes approved.
- [ ] Privacy-safe monitoring, support inbox, on-call owners active.

## 3. Deterministic checks

```sh
npm test
node --test test/ios-compliance.test.mjs
cd app && npm run test:release-config
cd app && npx expo-doctor
cd app && npx expo config --type public --json
cd app && npx expo config --type introspect --json
```

Archive outputs without secrets. Native/export checks are in `app/RELEASE_CONFIG.md`.

## 4. Owner-run build/TestFlight

1. Verify Expo/Apple team and production environment.
2. Run `{{APPROVED_EAS_BUILD_COMMAND}}`.
3. Record EAS ID/artifact/commit/version/build/signing/config.
4. Upload via `{{APPROVED_UPLOAD_PROCESS}}`.
5. Inspect processing/export/privacy warnings; resolve all unexplained warnings.
6. Run `TESTFLIGHT_MATRIX.md` physically.
7. Any P0/P1 fix requires new commit/build/evidence.

## 5. App Store Connect four-eyes review

- [ ] Correct record/team/version; free price/territories; no 1.0 IAP/subscription.
- [ ] Approved metadata/age/privacy/URLs/screenshots/reviewer contact/account/script/deletion path.
- [ ] Content-rights/export answers independently reviewed.
- [ ] Release control `{{MANUAL_OR_AUTOMATIC_RELEASE_DECISION}}` (manual preferred).
- [ ] Submission authorized by `{{SUBMISSION_APPROVER}}`.

## 6. Review and go/no-go

Answer review from exact-build evidence; record rejection/response/change in `{{REVIEW_LOG_PATH}}`. Behavior/binary/backend/privacy/content changes trigger impact review/new build as needed.

Before release: Apple approval valid; production dependencies/URLs healthy; cohort/current conditions and controls rechecked; no P0 security/privacy/deletion/safety/data-loss/auth/review issue; support/on-call active; alerts tested; rollback owners have access; release decision signed by release, engineering, privacy/legal, content/safety, QA, support. Phased policy: `{{PHASED_RELEASE_POLICY}}`.

## 7. Incident/rollback matrix

| Incident | Containment | Recovery | Owner |
|---|---|---|---|
| Unsafe/closed stop | Pause/retire; penalty-free bypass/replacement | Re-verify/new content version | `{{CONTENT_SAFETY_OWNER}}` |
| API outage | Serve approved cached/curated path or halt | Roll server after compatibility review | `{{BACKEND_OWNER}}` |
| Auth/RLS exposure | Halt; disable feature/provider; preserve evidence | Fix, legal/security assessment | `{{SECURITY_OWNER}}` |
| Deletion/revocation | Halt; retain retry/support; no false success | Repair and rerun destructive matrix | `{{PRIVACY_ENGINEERING_OWNER}}` |
| Bad binary | Pause phased/manual; remove from sale only by owner/legal decision | Fix forward/expedited review if eligible | `{{IOS_RELEASE_OWNER}}` |
| Legal/support host | Halt; restore DNS/TLS/host | Verify app/ASC; archive | `{{WEB_SUPPORT_OWNER}}` |
| Invasive telemetry | Disable endpoint/SDK; restrict access | Approved incident/deletion/disclosure response | `{{PRIVACY_OWNER}}` |

Never roll back a database change if it recreates deleted data or breaks clients. Every rollback needs compatibility/data-integrity review.

## 8. Post-release

Record build/date/territories/phasing; monitor for `{{POST_LAUNCH_OBSERVATION_WINDOW}}`; daily go/no-go; reconcile incidents; publish retrospective. Only after 1.0 stability/retention gates may deployment-2 Custom Hunts begin a separate StoreKit/privacy/review workstream.
