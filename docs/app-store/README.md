# DayQuest iOS 1.0 App Store submission package

**Package status:** working draft; **not submission-ready**.
**Inspected baseline:** `e4100243d976d7b16a0d379014ca19daaef0fb1c` on 2026-07-23.
**Scope:** free DayQuest 1.0 for a limited New York City launch. No ads, subscriptions, or in-app purchases are represented in the inspected 1.0 code. Private Custom Hunts are deployment 2 and must not delay 1.0.

This directory translates repository evidence into App Store Connect copy, review instructions, capture plans, and release gates. A checked box means evidence was actually obtained; unchecked items and `{{BLOCKING_PLACEHOLDER}}` values are hard stops, not suggested facts.

## Artifact index

| Artifact | Purpose |
|---|---|
| [`METADATA.md`](METADATA.md) | Metadata draft, character budgets, category proposal, and age-rating rationale |
| [`APP_PRIVACY.md`](APP_PRIVACY.md) | Conservative App Privacy label worksheet with code/data-flow evidence |
| [`privacy-inventory.json`](privacy-inventory.json) | Machine-readable privacy inventory (existing compliance artifact) |
| [`REVIEW_NOTES.md`](REVIEW_NOTES.md) | Reviewer-notes draft and step-by-step review scripts |
| [`SCREENSHOTS.md`](SCREENSHOTS.md) | Device/screen capture matrix and truthful-copy constraints |
| [`PUBLICATION_CHECKLIST.md`](PUBLICATION_CHECKLIST.md) | Support, privacy, terms, and deletion URL publication gates |
| [`APPLE_AND_DELETION_CHECKLIST.md`](APPLE_AND_DELETION_CHECKLIST.md) | Sign in with Apple and live account-deletion verification |
| [`TESTFLIGHT_MATRIX.md`](TESTFLIGHT_MATRIX.md) | Real-device TestFlight coverage and evidence ledger |
| [`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md) | Build selection, submission, release, monitoring, and rollback runbook |
| [`OWNER_INPUTS.md`](OWNER_INPUTS.md) | Consolidated factual/legal/contact/URL decisions Andrew must supply |
| [`reviewer-checklist.md`](reviewer-checklist.md) | Existing privacy/deletion compliance checklist |

Related source drafts are in `docs/legal/`. They are not approved or published.

## Non-negotiable release truth

- DayQuest 1.0 is free. Do not configure or mention ads, subscriptions, IAP, paid unlocks, or prices.
- Private Custom Hunts remain a post-1.0 deployment. Do not expose deployment-2 copy, SKU, paywall, or screenshots in 1.0.
- Market the initial availability as **limited NYC coverage**. Do not imply all of NYC, nationwide, or worldwide quest coverage.
- Source-reviewed and remotely reviewed places are **not field verified**. Do not use “field verified,” “verified in person,” “safe,” “accessible,” “always open,” or equivalent claims without recorded field evidence for the shipping cohort.
- The content bank contains candidates whose lifecycle is `needs_field_verification`; candidate/research artifacts are not publication approval. Select and verify a shipping cohort before public release.
- Do not call a draft URL “published,” a repository function “deployed,” or an automated test a live-device verification.
- Do not claim accessibility support from uncompleted checks. Accessibility testing is a release gate, not marketing copy.

## Submission gate summary

The package documents, but does not resolve, these current hard stops:

1. owner/legal facts and public HTTPS URLs;
2. final production processor, retention, rights, age, and data-linkage decisions;
3. live Supabase deletion deployment/schema preflight and Apple token-revocation proof;
4. stable reviewer access outside the launch geography or reviewer instructions that Apple accepts;
5. final limited NYC launch cohort and field/safety/access review evidence;
6. physical-device/TestFlight and accessibility evidence;
7. reviewer credentials if the selected review path requires an account;
8. final screenshots captured from the exact candidate build;
9. App Store Connect account/team, export, content-rights, and release-control answers.

No EAS build, deployment, App Store Connect edit, upload, submission, or publication is performed by this package.
