# App Review notes and review script — DayQuest 1.0

**Status:** draft. Do not paste until placeholders are resolved and scripts pass on the submitted build.

## Reviewer Notes draft

```text
DayQuest is a free, clue-led scavenger-hunt app with limited coverage in select New York City areas. Version 1.0 has no ads, subscriptions, or in-app purchases. Private Custom Hunts are not included.

DayQuest requests foreground location to request a nearby quest, show the player on the map, provide distance guidance, and recognize arrival. It does not request background location. Camera/photo access is optional, microphone access is disabled, and quest photos are not uploaded by the represented build.

Guest path: On first launch choose “Continue as guest.”
Reviewer path: Sign in with the dedicated reviewer account supplied in App Store Connect. When the submitted build is the `app-review` profile and the Supabase user has the short-lived `dayquest_app_review` entitlement for `com.akoke18.dayquest` version `1.0.0`, Home shows “App Review Demonstration.” Every entry is reauthorized with Supabase `getUser()` and the database-time `dayquest_verify_app_review_entitlement()` RPC, so a stale local session or changed device clock cannot grant access. Open it to run a disclosed simulated three-stop route. The banner says “App Review Demonstration — simulated location, progress not saved.” Tap “Advance simulated walk” through the 350m, 220m, 120m, 65m, and 45m checkpoints. At 65m, “I found it!” asks the reviewer to get closer; at 45m the unchanged 50m predicate finds the stop. The recap is labeled “Demo — not saved.”
Account path: {{BLOCKER_DEDICATED_REVIEWER_ACCOUNT_AND_ENTITLEMENT_EXPIRY}}

Account deletion after sign-in: Menu → Profile → Delete account. Reset guest data is a separate on-device action.

Privacy: {{BLOCKER_PRIVACY_POLICY_URL}}
Support: {{BLOCKER_SUPPORT_URL}}
Terms: {{BLOCKER_TERMS_URL}}
Deletion information: {{BLOCKER_DELETION_INFO_URL}}
Coverage/limitations: {{BLOCKER_EXACT_SHIPPING_NYC_COVERAGE_AND_LIMITATIONS}}
App Review contact: {{BLOCKER_REVIEW_CONTACT_NAME_EMAIL_PHONE}}
```

Never include private keys, service-role keys, tokens, or personal credentials. Supply only a dedicated reviewer account through App Store Connect's protected field.

## Script A — guest/core

The deterministic App Review demonstration path is implemented in source, but remains blocked operationally until the submitted build, reviewer account entitlement, and physical-device path are verified.

| Step | Action | Expected | Required evidence |
|---:|---|---|---|
| 1 | Install/launch candidate | Launches without account creation | Recording + build |
| 2 | Continue as guest | Help/welcome; no sign-in trap | Device result |
| 3 | Sign in with entitled reviewer account and open App Review Demonstration | Truthful disclosed demo quest loads; banner remains visible | Build/profile + Supabase entitlement proof |
| 4 | Start quest and allow While Using location | Map/clue render; no background prompt | Recording/settings |
| 5 | Expand clue; reveal hints; activate guidance | Progressive help; guidance does not find/advance remotely | Recording |
| 6 | Reach approved test stop | Find/reveal occurs from actual coordinates | Recording/redacted logs |
| 7 | Deny/skip camera | Can collect/advance without camera | Recording |
| 8 | Complete and open recap/history | Completion and persisted history | Recording |
| 9 | Force-close during another quest | Resume restores progress | Recording |
| 10 | Open Privacy & legal | Choices and public links work | URL capture |
| 11 | Reset guest data | Clearly local and separate from deletion | Disposable state recording |

## Script B — account/Apple/deletion

| Step | Action | Expected | Preconditions |
|---:|---|---|---|
| 1 | Open sign-in on iOS | Native Apple option alongside Google | Entitlement/provider configured |
| 2 | Sign in with `{{DEDICATED_REVIEWER_ACCOUNT}}` or reviewer Apple identity | Profile loads | Dedicated setup |
| 3 | Optional shared-hunt steps `{{SHARED_HUNT_REVIEW_STEPS}}` | Same hunt/leaderboard works | Stable second account |
| 4 | Menu → Profile → Delete account | Destructive action and effects clear | Live function |
| 5 | Confirm | Server deletion/revocation, local clear, sign-out | Live proof |
| 6 | Relaunch/old session | Deleted account not restored | Device proof |

If deletion destroys supplied credentials, provide a resettable disposable process or let review create an Apple account. Do not claim deletion operational before live checks pass.

## Permission denial

- Location denied: recoverable explanation and approved deterministic path.
- Camera/library denied: no core completion trap.
- Notifications denied: reminder optional; quest works.
- Microphone: never requested.

## Current blockers

- Dedicated reviewer credentials and short-lived Supabase entitlement provisioning.
- Deployment and live verification of `202607230002_app_review_entitlement.sql`.
- Physical-device verification of entitled and non-entitled accounts.
- Live backend, shipping cohort, and TestFlight behavior.
- SIWA token registration/revocation and deletion deployment.
- Public legal/support/deletion URLs (committed config defaults are blank).
- Current production curated content has zero eligible records; ordinary users still need a reliable live quest path.
- Durable safety/content-failure report storage and owner review workflow.
