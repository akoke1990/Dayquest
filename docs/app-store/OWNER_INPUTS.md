# OWNER_INPUTS — facts and approvals Andrew must supply

Every item is unresolved without evidence. Do not replace placeholders with guesses.

## Seller, rights, App Store account

- [ ] Exact `{{LEGAL_ENTITY_NAME}}`, address/jurisdiction disclosures, copyright holder.
- [ ] Apple Developer/App Store Connect team, roles, publishing authority.
- [ ] SKU and DayQuest name/trademark availability.
- [ ] Rights attestation for name/icon/copy/screenshots/maps/place/source/open data/media.
- [ ] Exact-build export answers/approver; territories; localizations.

## Public contacts/URLs

- [ ] `{{SUPPORT_CONTACT}}`, mailbox owner/delivery test; `{{SUPPORT_URL}}`.
- [ ] `{{PRIVACY_POLICY_URL}}`; `{{TERMS_URL}}`; `{{DELETION_INFO_URL}}`; marketing URL or not used.
- [ ] App Review contact name/email/phone.
- [ ] Support SLA, launch escalation owner/hours, safety/content escalation, after-hours process.
- [ ] DNS/TLS/page monitoring owner and recovery access.

## Legal/privacy decisions

- [ ] Counsel-approved policies/terms/support, effective dates, consumer/dispute/governing terms.
- [ ] Age audience/children/Made for Kids position.
- [ ] Jurisdictional rights/legal bases, territories, request verification/timelines.
- [ ] Retention by class: Supabase, event/feedback/score JSONL, access/security, support, backups, local/device/cloud backup.
- [ ] Install-ID request/deletion and backup process.
- [ ] Processor/transfer/contracts: Supabase, API host, Anthropic, Google, Apple, OSM, Wikimedia/Wikipedia, Expo/EAS, monitoring/support.
- [ ] No production tracking/ads/data-broker confirmation.
- [ ] Analytics default/consent approval; feedback/score independence disclosure.
- [ ] Monitoring/diagnostics inventory; open-data/provider attribution.
- [ ] Signed exact-build App Privacy and SDK manifest/required-reason API review.

## Product/content truth

- [ ] Confirm free 1.0: no ads/subscription/IAP/paywall/paid unlock/Custom Hunt UI.
- [ ] Exact NYC coverage and versioned shipping place/clue IDs.
- [ ] Per-record field review dates/reviewers/current condition, access/safety/mobility/hours, publication approval.
- [ ] Acknowledge source/remote review is not field verification.
- [ ] Content pause/retire/replacement owner and tested controls.
- [ ] Whether barcrawl/ghosts ship; content audit and age-rating consequences.
- [ ] Penalty-free unsafe/closed/inaccessible/content-failure behavior.
- [ ] Final metadata/category/copy and Apple age-rating answers/result.

## Reviewer access

- [ ] Deterministic out-of-NYC path without GPS spoofing or false coverage.
- [ ] Dedicated reviewer account or approved account-creation approach; credentials only in ASC.
- [ ] Account reset/reseed after deletion.
- [ ] Shared-hunt/friends test setup or omit optional script.
- [ ] Review limitations, backend uptime owner, response owner.

## Apple/Supabase deletion

- [ ] Apple native/Services ID decision, key rotation owner, provider config.
- [ ] Edge secrets securely configured (never put values here).
- [ ] Live schema/storage/backups/external inventory and migration/deployment approvals.
- [ ] Physical Apple/Google deletion/revocation/fail-closed/retry/idempotency/local cleanup/reinstall evidence.
- [ ] Engineering, privacy/legal, release signoff on deletion/retention.

## TestFlight/screenshots/release

- [ ] iOS floor and device/OS matrix.
- [ ] Production EAS values and approved build/upload process.
- [ ] Performance/SLO/monitoring thresholds and owners.
- [ ] Coordinator, QA approver, evidence archive, completed TestFlight matrix.
- [ ] Current screenshot slots/pixels/devices/locales/headlines/rights approvals.
- [ ] Candidate commit/build/environment IDs/config/checksum manifest.
- [ ] Release mode/phasing/window/on-call/go-no-go approvers.
- [ ] Backend/content/Supabase/web/client rollback owners and access.
- [ ] Observation period and stop/pause thresholds.

## Status assertions requiring evidence

- [ ] Public pages approved/reachable.
- [ ] Backend/deletion artifacts deployed.
- [ ] SIWA/deletion live-verified.
- [ ] Launch places field reviewed/published (only per actual evidence).
- [ ] Accessibility checks passed within stated scope; no broad unapproved claim.
- [ ] Screenshots from exact candidate.
- [ ] Privacy/age answers entered/approved.
- [ ] Candidate submitted/approved/released.

## Secrets boundary

Never provide passwords, tokens, private/service-role keys, signing certificates, or encryption keys in git/docs/screenshots. Reviewer credentials belong only in App Store Connect protected fields; secrets belong in approved secret stores.
