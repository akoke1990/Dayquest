# App Review notes and review script — DayQuest 1.0

**Status:** draft. Do not paste until placeholders are resolved and scripts pass on the submitted build.

## Reviewer Notes draft

```text
DayQuest is a free, clue-led scavenger-hunt app with limited coverage in select New York City areas. Version 1.0 has no ads, subscriptions, or in-app purchases. Private Custom Hunts are not included.

DayQuest requests foreground location to request a nearby quest, show the player on the map, provide distance guidance, and recognize arrival. It does not request background location. Camera/photo access is optional, microphone access is disabled, and quest photos are not uploaded by the represented build.

Guest path: On first launch choose “Continue as guest.”
Reviewer path: {{BLOCKER_REVIEWER_DEMO_PATH_INSTRUCTIONS}}
Account path: {{BLOCKER_REVIEWER_ACCOUNT_OR_NO_ACCOUNT_JUSTIFICATION}}

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

**Blocked until a deterministic review path works from Apple's location without GPS spoofing.**

| Step | Action | Expected | Required evidence |
|---:|---|---|---|
| 1 | Install/launch candidate | Launches without account creation | Recording + build |
| 2 | Continue as guest | Help/welcome; no sign-in trap | Device result |
| 3 | Follow `{{REVIEWER_DEMO_PATH_INSTRUCTIONS}}` | Truthful demo quest loads | Backend/device proof |
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

- Deterministic out-of-NYC reviewer path (no GPS spoofing).
- Dedicated credentials/no-account approach.
- Live backend, shipping cohort, and TestFlight behavior.
- SIWA token registration/revocation and deletion deployment.
- Public legal/support/deletion URLs (committed config defaults are blank).
