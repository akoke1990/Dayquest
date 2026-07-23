# DayQuest Private Custom Hunts — Implementation-Ready Brief

## Firm recommendation

Launch **Private Custom Hunts immediately post-launch**, not before or inside DayQuest 1.0.

Use a **creator-paid, single consumable in-app purchase**:

> **Create 1 Custom Hunt** — one private, personalized NYC hunt; participants join free.

Do **not** launch subscriptions, credit bundles, arbitrary-address hunts, custom clue writing, or public user-generated hunts.

Before 1.0, build only reusable prerequisites already needed by the free product: verified content publication, secure private invitations, failure-safe stop handling, account deletion, and privacy disclosures. After the free shared-hunt loop is working in production, ship Custom Hunts as the first premium release.

### Why post-launch

The inspected iOS release branch is technically healthy—**38/38 tests passed**—but it is not commercially ready for this feature:

- The current shared-hunt backbone is useful but generates area/day hunts, not owner-authored private events.
- Current deep-link multiplayer requires sign-in and exposes no premium entitlement model.
- The app has **no StoreKit/IAP dependency or transaction backend**.
- Account creation exists, but the in-app account-deletion implementation is still isolated on the compliance worktree and has not yet entered this release branch.
- `PRIVACY.md` remains a draft and does not cover purchases, custom messages, or multiplayer records.
- The versioned NYC content bank is not yet connected to live production quest serving.
- The bank contains **248 places, 100 hunt ideas, and 100 draft clue packages—but zero published or field-verified content**.
- The separate remote-curation artifacts classify the 100 candidates as **44 `canary_eligible`, 31 `needs_scout`, 22 `hold`, and 3 `reject`**, with **36 low-, 34 medium-, and 30 high-risk** records. Canary eligibility remains remote operational evidence—not field verification or publication.
- The PRD explicitly parks monetization until retention is demonstrated.
- Adding IAP, private UGC controls, deletion behavior, and App Review demo infrastructure would expand the 1.0 review surface substantially.

This should not delay the owner’s existing multiplayer-first launch strategy. First prove free friend invites and completed shared hunts; then monetize the higher-intent host use case.

---

## 1. Exact premium package

### Customer-facing name

**DayQuest Custom Hunt**

**StoreKit product:** `com.akoke18.dayquest.custom_hunt.single.v1`  
**Product type:** consumable  
**Store copy:** “Create one private, personalized NYC scavenger hunt for your group. Friends join free.”

### Included in one purchase

- One private hunt in a supported NYC DayQuest Area.
- **3–5 stops** selected only from DayQuest `published` places and clue packages.
- Up to **10 accepted participants**, including the creator.
- Occasion template:
  - Birthday
  - Date
  - Proposal
  - Team outing
  - Reunion
  - Family day
- One DayQuest-generated route and standard-quality clue set.
- Creator can:
  - reorder stops;
  - swap from a limited set of DayQuest-approved alternatives;
  - add an intro;
  - add an optional message after each stop;
  - add a finale message.
- Private invite link and fallback code.
- Shared completion recap.
- Creator edits until the first participant starts.
- One no-charge stop replacement if DayQuest withdraws or disables a place before play.

### Explicitly not included

- No arbitrary home, hotel, workplace, or private-address endpoints.
- No creator-authored clue or answer text.
- No uploaded images, video, audio, or attachments.
- No public listing, search, follower feed, or marketplace.
- No chat or participant-to-participant messaging.
- No paid boosts, extra points, exclusive collectibles, or leaderboard advantage.
- No guarantee of venue admission, operating hours, proposal outcome, or weather suitability.

### Validity

Recommended MVP defaults:

- Draft remains available for **30 days after purchase**.
- On publish, creator selects an event date within the next 30 days.
- Invite expires **7 days after the event date**.
- Participants may begin up to **48 hours before** the scheduled date.
- Existing sessions may finish for 24 hours after invite expiry.
- Hunt content freezes when the first participant starts, except platform safety replacement.

Dates should use the Area’s local timezone, not the creator device’s current timezone.

---

## 2. Pricing and business model

All prices below are **test hypotheses, not market facts**. The app must render the localized StoreKit price rather than hard-code a dollar amount.

### Recommended launch hypothesis

**US launch price: $7.99 for one custom hunt.**

Test range after enough purchase traffic:

- Low: **$5.99–$6.99**
- Core: **$7.99–$9.99**
- Premium ceiling: **$11.99–$12.99**

Primary measures:

- paywall-to-purchase conversion;
- purchase-to-publish conversion;
- creator completion;
- accepted participants per hunt;
- participant first-hunt completion;
- repeat creator purchase within 90 days;
- refund and support rates.

Do not run an elaborate multi-SKU pricing experiment at launch. Begin with one SKU and one price. Multiple near-identical products add App Store Connect work, entitlement ambiguity, and reconciliation risk.

### Model comparison

| Model | Advantages | Problems | Decision |
|---|---|---|---|
| One-time non-consumable creator unlock | Simplest restoration; easy message | Cannot be purchased repeatedly for separate occasions; “unlimited” creates weak unit economics and abuse exposure | Reject |
| Consumable single-hunt purchase | Matches occasional behavior; creator pays for a concrete event; repeatable; no renewal burden | StoreKit does not restore consumed products as durable entitlements; requires a server credit ledger | **Launch model** |
| Consumable credit bundles | Better repeat-organizer economics | Abstract currency, breakage complaints, balance/refund complexity | Defer |
| Subscription | Predictable revenue; attractive for professional organizers | Poor fit for weekly/occasional consumer use; recurring billing and cancellation overhead; higher App Review/support burden | Defer until repeat-host demand is proven |

Sell the user a **hunt**, not “coins.” Internally, the server may represent the purchase as one credit for transactional safety.

---

## 3. Apple-compliant purchase behavior

Because the purchase unlocks digital functionality and content used inside the app, use Apple in-app purchase on iOS. Do not show Stripe, web checkout, promo links, or “buy on our website” copy in the iOS flow.

### Transaction sequence

1. Creator must sign in before purchase.
2. App loads product title and price from StoreKit.
3. StoreKit presents Apple’s purchase sheet.
4. Client sends the signed transaction/JWS to the trusted backend.
5. Backend verifies:
   - bundle ID;
   - product ID;
   - environment;
   - transaction signature/status;
   - unique transaction ID;
   - authenticated DayQuest account.
6. In one database transaction:
   - record the verified purchase;
   - grant `+1` creation credit;
   - write an immutable ledger entry.
7. Client finishes the StoreKit transaction only after durable grant confirmation.
8. Creator creates a draft.
9. Credit is consumed only when a valid hunt is successfully published.

A generation, moderation, database, or network failure must not consume the credit.

### Restoration

A consumable is not a conventional restorable entitlement. DayQuest should nevertheless include **Restore Purchases / Sync Purchases** in Purchase Settings:

- invoke StoreKit sync for restorable present/future products;
- reconcile unfinished or previously verified transactions;
- reload the signed-in account’s server credit ledger.

Copy must be precise:

> “Purchased custom hunts are saved to your DayQuest account. Restore Purchases syncs eligible Apple purchases and reloads your available hunts.”

Do not promise that StoreKit can recreate an already-consumed hunt credit from local receipt restoration alone.

### Refunds and revocation

Process App Store Server Notifications V2 and periodic reconciliation.

Recommended policy:

- **Unspent credit refunded:** revoke that unspent credit.
- **Already-published hunt refunded:** do not terminate participant access mid-event. Mark it refunded, block duplicate benefit, and absorb the loss.
- **Repeated refund abuse:** restrict future custom-hunt purchases after review; never erase earned participant progress.
- **Revoked transaction before publish:** close the draft without consuming anything else.
- Provide Apple’s refund-request path or StoreKit refund-request UI where supported.

---

## 4. Creator flow

```text
Home
 └─ Create a Hunt for Friends
      └─ Premium explainer
           ├─ What’s included
           ├─ Friends join free
           └─ $localized_price · Create 1 Custom Hunt
                └─ Apple purchase sheet
                     └─ Choose occasion
                          └─ Choose event date + supported NYC Area
                               └─ Suggested 3–5 approved stops
                                    ├─ Reorder
                                    └─ Swap approved alternatives
                                         └─ Personalize
                                              ├─ Intro
                                              ├─ Optional post-stop notes
                                              └─ Finale
                                                   └─ Safety/moderation check
                                                        └─ Preview as player
                                                             └─ Publish & consume credit
                                                                  └─ Share private invite
```

### Creator safeguards

- Show the full route distance, estimated time, hours dependencies, mobility facts, and unknowns before publishing.
- If proposal is selected, explicitly advise the creator not to make safety-critical instructions or hide access/transport information.
- Allow preview without revealing answer locations in the participant presentation.
- Allow edit/cancel while still a draft.
- After first player starts, lock route and messages except:
  - invite revocation;
  - participant removal;
  - platform safety replacement.

---

## 5. Participant flow

```text
Private universal link / code
 └─ Invite preview
      ├─ Creator display name
      ├─ Occasion
      ├─ NYC Area
      ├─ Date
      ├─ 3–5 stops · distance · estimated time
      └─ “Joining is free”
           └─ Sign in / create account
                └─ Accept invitation
                     └─ Safety + accessibility summary
                          └─ Wait for start window / Start
                               └─ Existing DayQuest hunt loop
                                    └─ Shared finale + recap
```

### MVP identity recommendation

Require sign-in for both creator and participants. This is the leanest secure route because current friend/shared-hunt infrastructure already gates multiplayer behind Supabase auth, and private membership/RLS needs a stable principal.

“Join free” should mean **no participant payment**, not no account.

Guest participant capability tokens would improve conversion but require a parallel identity, migration, abuse, result-attribution, and deletion model. Defer that until invite drop-off is measured.

---

## 6. Content, moderation, PII, and safety rules

### Place eligibility

A custom hunt may reference only records where:

- place lifecycle is `published`;
- clue package lifecycle is `published`;
- editorial and field reviews are approved;
- at least one observable anchor is field-verified;
- public approach is known and legal;
- purchase is not required;
- safety is supported;
- risk is low or explicitly approved medium;
- clue does not depend solely on small text, hearing, color, touch, paid entry, or unstable business signage;
- freshness has not expired.

For MVP, exclude all remotely `needs_scout`, high-risk, paid, private, hours-unknown, and accessibility-unknown endpoints from premium routing. A customer paying for an occasion should get a stricter operational bar than a prototype fallback.

### Personal-message limits

Recommended:

- Intro: 240 characters.
- Post-stop message: 240 characters each.
- Finale: 500 characters.
- Plain text only.
- First names and ordinary affectionate language allowed.
- No URLs, phone numbers, email addresses, social handles, payment requests, private addresses, or instructions to enter a private location.

### Moderation

At save and publish:

1. Unicode normalization and control-character removal.
2. Link/contact/address/PII detection.
3. Block threats, hate, targeted harassment, sexual content involving minors, coercion, self-harm instructions, illegal activity, trespass, and dangerous challenges.
4. Profanity: warn for mild profanity; block slurs and targeted abuse.
5. Retain a moderation decision code—not raw message text—in analytics.
6. Provide participants:
   - Report hunt/message;
   - Leave hunt;
   - Block creator.
7. Provide a visible support contact.
8. Reported content becomes unavailable pending review; the underlying approved DayQuest hunt remains playable.

Private UGC must never enter the public clue/content bank.

---

## 7. Content failures must not punish players

This is a launch invariant, not a support policy.

Every stop must offer:

> **Can’t safely use this stop?**

Reasons: closed, inaccessible, changed, GPS problem, photo check failed, feels unsafe, other.

Behavior:

- Grant neutral completion credit for that stop.
- Do not reduce streak, completion badge, recap eligibility, or group standing.
- If the content service can safely select a verified nearby replacement, offer it rather than force it.
- If one person bypasses a stop, do not block the group finale.
- Never gate a proposal/finale message behind GPS, camera, AI photo validation, venue hours, or a purchase.
- Preserve cached hunt content through temporary backend outages.
- Platform retirement of a place must not invalidate completed hunts or delete recaps.
- Distinguish player skip from **content failure** in analytics; only the latter affects content quality metrics.

Any existing solve-to-advance behavior must be overridden for declared access, safety, GPS, and content failures.

---

## 8. Data model changes

Use Supabase/Postgres for durable state, but route all payment and moderation-sensitive writes through a trusted backend. Do not let the app directly insert credits or ownership records.

### New tables

```text
iap_transactions
- id uuid
- user_id uuid
- platform apple
- product_id text
- transaction_id text UNIQUE
- original_transaction_id text
- environment sandbox|production
- status verified|refunded|revoked
- purchased_at, updated_at
- raw_payload_encrypted / verification reference
- app_account_token uuid

credit_ledger
- id uuid
- user_id uuid
- transaction_id FK nullable
- hunt_id FK nullable
- delta int                    -- +1 grant, -1 publish, -1 refund reversal
- reason purchase|publish|refund|admin_adjustment
- created_at
- idempotency_key UNIQUE

custom_hunts
- id uuid
- creator_id uuid
- status draft|published|active|completed|expired|cancelled|moderation_hold
- occasion enum
- area_id
- scheduled_for date
- timezone
- title
- intro_message_ciphertext
- finale_message_ciphertext
- content_version
- published_at, first_started_at, expires_at
- purchase_transaction_id
- refunded_at

custom_hunt_stops
- hunt_id
- order_index
- place_id
- place_record_version
- clue_package_id
- clue_record_version
- post_stop_message_ciphertext
- replacement_for_stop_id nullable
- UNIQUE(hunt_id, order_index)

hunt_members
- hunt_id
- user_id
- role creator|participant
- status invited|accepted|started|completed|left|removed
- joined_at, started_at, completed_at
- UNIQUE(hunt_id, user_id)

hunt_invites
- id uuid
- hunt_id
- token_hash
- expires_at
- max_uses
- use_count
- revoked_at

content_incidents
- id
- hunt_id
- stop_id
- reporter_id
- reason_code
- state
- created_at
```

### Important contract change

The current `shared_hunts` design allows public selection with knowledge of the hunt ID and stores an entire mutable JSON quest. Premium hunts need:

- explicit membership-based RLS;
- opaque, high-entropy invite tokens;
- token hash storage;
- immutable content/version snapshots;
- creator ownership;
- expiry and revocation;
- no `select using (true)` for private rows.

Do not reuse the current 12-character deterministic area/day `hunt_id` as a private capability.

---

## 9. API surface

```text
POST /v1/iap/apple/confirm
POST /v1/iap/apple/sync
GET  /v1/entitlements/custom-hunts

POST /v1/custom-hunts/drafts
PATCH /v1/custom-hunts/:id
POST /v1/custom-hunts/:id/suggest-stops
POST /v1/custom-hunts/:id/swap-stop
POST /v1/custom-hunts/:id/moderate
POST /v1/custom-hunts/:id/publish
POST /v1/custom-hunts/:id/invites
POST /v1/custom-hunts/:id/invites/rotate
POST /v1/invites/:token/accept
GET  /v1/custom-hunts/:id/player
POST /v1/custom-hunts/:id/start
POST /v1/custom-hunts/:id/stops/:index/content-failure
POST /v1/custom-hunts/:id/report
DELETE /v1/custom-hunts/:id/members/:userId

POST /v1/accounts/delete
```

All mutating endpoints require auth, schema validation, idempotency keys, authorization checks, and bounded payloads.

---

## 10. StoreKit architecture options

### A. Direct StoreKit 2 bridge — recommended

Use an Expo-compatible React Native StoreKit/IAP bridge in the existing custom native build, with backend JWS verification and App Store Server Notifications V2.

**Pros:** lowest long-term dependency, full ledger control, no additional customer-data processor.  
**Cons:** more receipt/refund/reconciliation engineering.

The exact library should be validated against Expo SDK 54 and the project’s New Architecture/build settings before selection.

### B. RevenueCat or similar service

**Pros:** faster entitlement dashboards, webhook handling, cross-platform abstraction.  
**Cons:** new vendor, recurring cost, additional privacy/vendor-review work, and its entitlement abstraction still does not replace DayQuest’s publish-credit transaction.

Use only if engineering capacity, not platform control, is the primary constraint.

### C. Native Swift StoreKit module

**Pros:** strongest platform fidelity.  
**Cons:** highest bespoke native maintenance and least aligned with the current mostly-Expo codebase.

Not recommended for the first paid SKU.

---

## 11. Account deletion

Apple requires an in-app deletion path for apps supporting account creation. Add this before monetization—and preferably before 1.0 regardless.

On immediate deletion:

- revoke sessions and OAuth identities;
- delete profile, friendships, pending invitations, and participant membership PII;
- remove private custom messages;
- pseudonymize completed leaderboard/results rows;
- retain minimal purchase, refund, tax/accounting, and fraud records under a documented retention policy;
- keep the approved DayQuest route playable for already-accepted participants until its normal expiry;
- replace deleted personal messages with “This personal message is no longer available.”
- make unused consumable-credit loss explicit before confirmation;
- provide both immediate deletion and, optionally, “delete after my active event.”

A creator’s deletion must not strand participants inside an unusable route, but personal UGC cannot be retained indefinitely merely because the hunt exists.

---

## 12. Privacy-preserving analytics

Never send:

- raw GPS coordinates;
- route traces;
- invite tokens;
- message text;
- participant names/emails;
- photos;
- exact event date;
- full Apple transaction payloads.

Allowed event dimensions:

- coarse `area_id`;
- occasion;
- stop-count bucket;
- participant-count bucket;
- purchase outcome/error category;
- draft/publish/accept/start/complete timestamps rounded or aggregated;
- content-failure reason code;
- completion and refund status.

Recommended events:

```text
custom_paywall_viewed
custom_purchase_started/succeeded/failed
custom_credit_granted
custom_draft_created
custom_moderation_blocked
custom_published
custom_invite_shared/accepted/expired
custom_participant_started/completed
custom_content_failure
custom_refund_received
custom_repeat_purchase
```

Use a rotating pseudonymous analytics identifier rather than exposing auth IDs. Apply short raw-event retention and longer aggregate retention. Update the privacy policy and App Privacy answers for purchases, user content, identifiers, precise location while in use, and usage data.

---

## 13. Fraud and abuse controls

- Server verification of every Apple transaction.
- Unique transaction and idempotency constraints.
- Bind purchases to authenticated account using `appAccountToken`.
- Never trust client-reported credit balance or product price.
- Rate-limit purchases, drafts, publish attempts, invite acceptance, swaps, and moderation calls.
- High-entropy invite tokens; store hashes; constant-shape invalid/expired responses.
- Rotate or revoke leaked invitations.
- Enforce 10-member cap server-side.
- Server-authoritative stop count and result bounds.
- Do not award cash, tradable rewards, or valuable prizes.
- Flag impossible repeated completion timing without punishing ordinary players.
- Refund-abuse review at account level; do not rely only on IP address.
- Prevent creators from inviting blocked users.
- Creator cannot remove a participant after that participant has completed merely to erase their result.

---

## 14. Accessibility

- VoiceOver labels for every creator control, stop, ordering control, and invite status.
- Reordering must have Move Up/Move Down actions, not drag-only interaction.
- Dynamic Type and no clipped personal messages.
- 44-point minimum targets and sunlight-safe contrast.
- Reduced Motion alternative for reveal/celebration.
- Warmer/colder cannot rely on red/blue alone.
- No clue solvable only by color, hearing, touch, or tiny text.
- Camera/photo verification must have a non-camera failure-safe path.
- Surface step-free approach, distance, stairs, hours, and unknowns before acceptance.
- Allow a “step-free route required” creator preference only when enough verified places exist; never infer accessibility from missing data.
- Personal messages should be readable by assistive technology and not embedded in generated images.

---

## 15. Key edge cases

| Edge case | Required behavior |
|---|---|
| Apple purchase succeeds; server times out | Transaction remains unfinished; observer retries confirmation idempotently |
| Credit granted; draft creation fails | Credit remains available |
| Publish fails after moderation or route validation | No credit consumption |
| Double-tap purchase/confirm | One transaction, one credit |
| Creator cancels draft | Credit remains if never published |
| Invite leaked | Creator rotates token; existing members remain |
| Event fills during invite acceptance | Atomic cap enforcement; friendly “group full” state |
| Stop retired before first start | Free verified replacement or neutral skip |
| Stop fails during play | No-penalty bypass; finale remains available |
| Creator is refunded after event begins | Participants retain access |
| Creator deletes account | Remove messages/PII; preserve neutral route until expiry |
| Participant deletes account | Remove membership identity; anonymize aggregate result |
| Unsupported Area | No paywall; show supported NYC Areas before purchase |
| Offline during hunt | Cached route, clue, hints, and messages; queue progress |
| DST/timezone change | Scheduled in Area timezone |
| App reinstalled | Sign in and reload draft/credit/membership from server |
| Moderation false positive | Save draft locally/server-side, show editable flagged field, no credit loss |
| Proposal finale | Never gated by GPS, camera, clue success, or venue access |

---

## 16. App Review impact

For the premium release:

- Submit the IAP product with the app version that exposes it.
- Provide a review account with an available sandbox purchase path.
- Provide a prebuilt private sample hunt and invite code.
- Add a reviewer-only, clearly documented NYC demo mode that exercises creator preview and participant play without physical travel. It must not unlock production purchases or leak into normal users.
- Explain that creators pay; participants never pay.
- Demonstrate report, block, leave-hunt, and account deletion.
- Ensure IAP metadata accurately states participant and expiry limits.
- Update privacy policy, support URL, App Privacy disclosures, and Terms.
- No references to cheaper external payment.
- Test interrupted purchase, Ask to Buy/pending, refund, restore/sync, offline, and account deletion.
- Ensure all paid functionality is visible and testable to review; do not submit an unreachable or remotely disabled purchase flow.

---

## 17. Acceptance criteria

### Commercial and IAP

- Localized StoreKit title and price render.
- A verified transaction grants exactly one server credit.
- Replay of the same transaction grants nothing additional.
- Failed draft/publish cannot consume a credit.
- Successful publish consumes exactly one credit.
- Participant encounters no payment screen.
- Refund notification reconciles the ledger without stopping an active event.

### Content and personalization

- Only published, field-reviewed, risk-screened places can be selected.
- Creator cannot enter coordinates, addresses, clue text, or media.
- Every published hunt has 3–5 unique stops in a valid route.
- Ordering and approved swaps preserve route validation.
- Messages pass length, PII, safety, and moderation rules.
- All content/version IDs are snapshotted at publish.

### Privacy and access

- Unaccepted users cannot fetch hunt content by guessing an ID.
- Revoked/expired invite cannot admit a new member.
- Accepted member can continue if the invite later rotates.
- Analytics contain no coordinates, messages, tokens, photos, names, or emails.
- Account deletion is available in-app and verified end-to-end.

### Player resilience

- Every stop exposes content/access failure handling.
- Failure bypass does not reduce completion, recap, or finale eligibility.
- Hunt remains playable from cached content during a temporary API outage.
- Personal finale is accessible regardless of solve verification.
- VoiceOver, Dynamic Type, reduced motion, non-color cues, and non-drag ordering pass QA.

---

## 18. Staged implementation tickets

### Stage 0 — Required launch foundations, not premium UI

1. Publish genuinely field-verified NYC place/clue packages.
2. Connect live serving to versioned published content.
3. Replace public shared-hunt access with membership-aware private contracts.
4. Add secure universal links plus fallback invite code.
5. Add no-penalty content/access failure handling.
6. Implement in-app account deletion and update privacy disclosures.
7. Instrument free invite acceptance and shared completion.

### Stage 1 — Premium backend

8. Add IAP transaction and credit-ledger tables.
9. Implement Apple transaction verification and idempotent grant.
10. Implement App Store Server Notifications V2.
11. Add custom-hunt draft, stop snapshot, member, and invite schemas/RLS.
12. Add route suggestion, swap validation, moderation, publish, and expiry jobs.
13. Add data deletion/pseudonymization procedures.

### Stage 2 — Creator and player UX

14. Add premium explainer/paywall and StoreKit purchase observer.
15. Add occasion/date/Area flow.
16. Add suggested-stop reorder and approved swaps.
17. Add personal-message editor with inline moderation.
18. Add creator preview and atomic publish.
19. Add private invite acceptance and participant lobby.
20. Add report/block/leave and content-failure UX.
21. Add purchase sync, refund help, and credit status.

### Stage 3 — Release validation

22. StoreKit configuration and sandbox matrix.
23. Test duplicate, pending, interrupted, refunded, and revoked transactions.
24. Security/RLS and invite-token tests.
25. Accessibility audit.
26. Physical NYC route QA for every premium-eligible pool.
27. App Review demo hunt, reviewer instructions, metadata, screenshots, and privacy updates.
28. TestFlight host/participant pilot before production release.

---

## 19. Must be deferred

- Arbitrary private addresses or custom map pins.
- Custom clues, answers, riddles, or unsafe challenges.
- Public UGC marketplace or discoverable community hunts.
- Creator-uploaded photos/video/audio.
- Chat, comments, reactions, or participant media feed.
- Guest participant identities.
- Web checkout on iOS.
- Credit packs, gifting credits, transfers, or family balances.
- Subscription organizer tier.
- Corporate billing and invoice workflows.
- More than 10 participants.
- Multi-city creation.
- Real-time participant map/presence.
- Paid prizes, tournament rewards, or pay-to-win scoring.
- Generative route creation outside the published content system.
- Self-serve creator appeals or a full moderation console.

---

## Owner decisions needed

1. Approve **post-launch sequencing** rather than adding premium to 1.0.
2. Approve the **single consumable IAP** model.
3. Choose launch price: recommended hypothesis **$7.99**.
4. Confirm **3–5 stops** and **10-person** cap.
5. Confirm creator and participants must sign in for MVP.
6. Confirm event/draft/invite expiry windows.
7. Confirm exact message limits and whether post-stop messages are included.
8. Decide whether **Proposal** ships initially or follows after birthday/date pilots.
9. Confirm that all premium places require `published` plus field review, with no `needs_scout` fallback.
10. Decide whether medium-risk places are categorically excluded or require manual approval.
11. Approve direct StoreKit implementation versus a third-party purchase service.
12. Approve the spent-refund rule: participants retain active access; DayQuest absorbs the event.
13. Confirm whether private hunts are cooperative-only or retain a private leaderboard.
14. Assign moderation/support ownership and response-time expectations.
15. Assign the NYC field-verification owner and premium-eligible Area launch set.

## Inspection summary

- Reviewed the living PRD, UX specifications, current Expo flows, social/shared-hunt implementation, Node backend, Supabase contracts, release worktree, and NYC content/verification pipeline.
- Verified the iOS release test suite: **38 passed, 0 failed**.
- Found a solid reusable shared-hunt and auth foundation, but no IAP stack, no in-app deletion path, and no publication-ready NYC content in the new bank.
- **No files were created or modified.**
- Browser automation was unavailable because Chrome is not installed; Apple developer pages were inspected through read-only HTTP retrieval instead.