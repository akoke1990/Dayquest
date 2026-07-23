# App Store metadata draft — DayQuest 1.0

**Status:** editorial draft; owner approval and App Store Connect availability checks required.

## Product scope

- Version 1.0.0; price: free.
- No ads, subscriptions, or in-app purchases are represented in the inspected 1.0 code.
- Private Custom Hunts are deployment 2, excluded from 1.0, and must not delay 1.0.
- Initial availability is limited to select New York City areas: `{{BLOCKER_FINAL_NYC_COVERAGE_LIST}}`.

## App Store fields

| Field | Draft | Limit / gate |
|---|---|---|
| Name | `DayQuest` | 8/30; trademark/availability check required |
| Subtitle | `Scavenger Hunts Around NYC` | 26/30; truthfully limits geography |
| Promotional text | `Turn a walk into a clue-led quest through select New York City neighborhoods. Find real places, collect surprises, and share the adventure with friends.` | 152/170 |
| Primary category | `Games` | Proposal; owner approval required |
| Secondary category | `Travel` | Proposal; owner approval or omission required |

Keywords (94/100 characters):

```text
scavenger,hunt,NYC,walking,clues,adventure,explore,neighborhoods,friends,places,city,discovery
```

Recheck counts after any edit. Do not add “verified,” “safe,” “accessible,” “all NYC,” “offline,” “AR,” “free forever,” or paid-feature terms without exact-build evidence.

## Description

```text
Turn an ordinary walk into a DayQuest.

DayQuest creates clue-led scavenger hunts around select New York City neighborhoods. Follow hints, use the map and warmer-or-colder guidance, discover each stop, and collect a surprise when you arrive.

PLAY YOUR WAY
• Continue as a guest or sign in
• Start a nearby solo quest
• Invite signed-in friends to the same shared hunt
• Reveal optional hints and location guidance if you get stuck
• Save progress and resume an unfinished quest
• Keep photos, visited places, collections, scores, and quest recaps on your device
• Plan an on-device reminder for a future hunt

BUILT FOR EXPLORATION
DayQuest uses foreground location during a quest to find nearby places, show your position, provide distance guidance, and recognize arrival. Camera and photo access are optional. Quest photos stay on your device in this version unless you choose to share them through the iOS share sheet.

LIMITED NYC LAUNCH
DayQuest 1.0 launches with limited coverage in select New York City areas. Availability varies by location, and place details or conditions can change. Follow posted rules, stay aware of traffic and surroundings, and skip any stop that is closed, inaccessible, or feels unsafe.

DayQuest 1.0 is free and contains no ads, subscriptions, or in-app purchases.
```

Reconcile shared-hunt availability with the production build. Never enumerate neighborhoods until the final shipping cohort is supplied and verified.

## Age-rating rationale (not a rating declaration)

Apple's live questionnaire must be completed against exact shipping content.

| Topic | Evidence / proposed basis | Gate |
|---|---|---|
| Advertising | No ad SDK/flow in inspected package or code | Reconfirm binary/contracts |
| IAP / loot boxes | No StoreKit/IAP; collectibles have no represented cash value | Reconfirm binary |
| User-generated content | Friends, invite links, names/avatars, shared results, optional feedback; no 1.0 chat, public posting, or custom-hunt authoring | Owner/App Review interpretation |
| Messaging/chat | None represented | Reconfirm binary |
| Web access | Source and legal/support links may open external content | Confirm destinations |
| Location | Real-world foreground location/walking are core | Answer accurately |
| Gambling/contests | Points/streaks/leaderboards; no wagers, cash prizes, or paid entry represented | Reconfirm operations |
| Horror/fear | Optional ghosts theme includes legends/macabre history | Audit frequency/intensity |
| Alcohol | `barcrawl` theme can surface bars/pubs/taverns | **Hard gate:** decide whether it ships; answer frequency/intensity and apply required controls |
| Violence/sexual/profanity | Not established by metadata inspection | Audit exact cohort/generated content |
| Unrestricted web/social | No general browser/public feed; auth and source links exist | Owner/App Review interpretation |

Rating blocker: `{{BLOCKER_FINAL_APPLE_AGE_RATING_ANSWERS_AND_RESULT}}`. Do not advertise a numeric rating early.

## Other declarations

- Copyright: `{{BLOCKER_COPYRIGHT_YEAR_AND_RIGHTS_HOLDER}}`
- Content rights: `{{BLOCKER_OWNER_CONTENT_RIGHTS_ATTESTATION}}`
- Export: source sets `ITSAppUsesNonExemptEncryption: false`; owner must answer from exact build/legal facts.
- Made for Kids / audience: `{{BLOCKER_AGE_AUDIENCE_AND_CHILDREN_POSITION}}`
- Territories: `{{BLOCKER_APP_STORE_TERRITORIES}}`
- SKU: `{{BLOCKER_APP_STORE_CONNECT_SKU}}`
