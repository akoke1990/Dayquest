# App Privacy label worksheet — DayQuest iOS 1.0

**Status:** conservative draft, not a completed App Store Connect declaration. Review the exact binary, production configuration/logs/schema, SDK privacy manifests, processors, and Apple's current definitions before submission.

## Proposed top-level answers

- **Tracking:** No represented ad network, IDFA, data broker, or cross-app targeted-ad flow. Blocked on `{{OWNER_PRODUCTION_TRACKING_AND_CONTRACT_CONFIRMATION}}`.
- **Linked data:** Yes for account/profile/social/gameplay. Treat install-ID records and precise-location requests as potentially linked until production log separation is proved.
- Omitting Supabase UID does not alone make data unlinked; assess IP/access logs, timing, install/account coexistence, and operator practices.

## Inventory tied to actual flows

| Apple data type | Collected | Linked (draft) | Purpose | Repository evidence / flow | Gate |
|---|---:|---:|---|---|---|
| Precise Location | Yes | **Conservative: Yes** | App Functionality; Personalization | `app/App.js` gets foreground GPS and sends `lat`/`lng` to `GET /quest`; local map/distance/find and breadcrumb use. `lib/api-server.js` receives coordinates and resolves/builds/caches quests. | Confirm request/access logs and processors. Breadcrumb is represented local-only. |
| Email Address | Yes | Yes | App Functionality | Apple/Google → Supabase Auth; `app/lib/auth.js` upserts profile email. | Confirm live config/RLS/retention/deletion. |
| Name | Yes | Yes | App Functionality | Provider metadata → profile display name; visible to relevant social/leaderboard users. | Confirm live visibility/RLS. |
| User ID | Yes | Yes | App Functionality | Supabase UID keys profiles/friends/results; friend links contain UID. | Confirm invite/deletion behavior. |
| Device ID | Yes | **Conservative: Yes** | Functionality; Analytics | Random per-install `dq_...` ID is sent to `/event`, `/feedback`, `/score`; server writes JSONL. Not IDFA. | Decide Apple category/linkage after production correlation review. |
| Product Interaction | When analytics enabled | **Conservative: Yes** | Analytics | `track()` sends event, timestamp, sanitized props, install ID. Saved setting can disable future events; hydrated default is enabled. | Approve default/consent, event catalog, retention, linkage. Not retroactive deletion. |
| Other User Content | Yes | **Conservative: Yes** | Functionality; Analytics | Ratings/text/stop flags/context go to `/feedback` with install ID, independent of analytics toggle. | Disclose separately; approve retention/deletion process. |
| Gameplay / Other Usage | Yes | Yes for account; conservative Yes for install-ID sink | App Functionality | Profile totals/shared results go to Supabase. `/score` gets area/theme/points/time/install ID. Full history, visited list, breadcrumb, bests remain local. | Map to current Apple taxonomy. |
| Photos or Videos | No in represented collection flow | No | App Functionality | Copied locally; system share is user-directed. `/photo` returns 501. | Recheck binary/SDK. Any upload or remote photo verification changes label. |
| Crash/Performance Diagnostics | Not established | TBD | TBD | No monitoring SDK in `app/package.json`; monitoring is only proposed in launch plan. | `{{PRODUCTION_MONITORING_SDK_AND_DIAGNOSTICS_CONFIRMATION}}` |
| Purchases/Financial | No | No | — | No 1.0 StoreKit/IAP/subscription/ads flow. | Deployment 2 requires separate review. |

## Local-only inventory in represented flow

Active quest/progress/preferences; GPS breadcrumb/timestamps; quest photos; completed history/visited places; collections/local score/streak/bests; reminder metadata; analytics choice. Local reset attempts to clear represented keys/photos/reminder. iCloud/device backup behavior is unresolved: `{{LOCAL_DATA_BACKUP_BEHAVIOR}}`.

## SDK/processor review

Confirm production roles/terms for Supabase; actual DayQuest API host; Anthropic if live fallback is active; Google Maps/Places/Geocoding/Auth; Apple authentication/maps/revocation; OSM endpoints; Wikipedia/Wikimedia; Expo/EAS runtime/update/diagnostics; monitoring/support vendors. Archive every bundled SDK privacy manifest and required-reason API declaration from the resolved binary.

## Risks requiring resolution

1. The machine inventory now uses conservative linked treatment for precise location and install-ID records; owner may change only with production evidence and signed privacy review.
2. Analytics defaults enabled after hydration; owner/legal must approve presentation and disclosure.
3. Feedback and score sink use install ID but are not gated by analytics toggle.
4. Account deletion cannot locate historical JSONL by auth UID; install-ID/backup handling is unresolved.
5. Server can use Anthropic after curated fallback. Do not state all quests are curated unless production proves it.
6. Production manifests, access logs, RLS/storage, subprocessors, and contracts were not live-audited here.

Final answers require `{{SIGNED_PRIVACY_INVENTORY_APPROVAL}}` tied to shipping commit/build.
