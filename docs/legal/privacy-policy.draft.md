# DayQuest Privacy Policy — factual draft

**Status:** Draft; not legal advice; not approved or published.
**Effective / last updated:** {{EFFECTIVE_DATE}}
**Operator:** {{LEGAL_ENTITY_NAME}}
**Support / privacy contact:** {{SUPPORT_CONTACT}}
**Public policy URL:** {{PRIVACY_POLICY_URL}}

The bracketed variables above are release blockers. Do not replace them with guesses.

## Scope

This draft describes the DayQuest mobile app and the DayQuest quest API represented in this repository. The release owner must confirm the production configuration, business practices, processor contracts, backups, and applicable law before publication.

## Data DayQuest handles

- **Precise location:** After foreground permission is granted, the app reads GPS while a quest is active. Coordinates are used to request a nearby quest from the DayQuest server, show the device on a map, calculate distance/warmer-colder state, confirm a find, and build a route breadcrumb.
- **Route history:** Breadcrumb coordinates and timestamps for an active/completed quest are saved in app-local AsyncStorage. The represented app does not upload that breadcrumb route.
- **Photos:** Camera or photo-library images selected for a quest are copied to the app's local document directory and referenced by local quest/history records. The represented app does not upload quest photos to DayQuest or Supabase. Sharing happens only when the user opens the system share sheet.
- **Optional account data:** If a user signs in with Apple or Google, Supabase Auth handles the authentication identity. A DayQuest profile may contain user ID, email, display name, avatar URL, total points, completed-quest count, and streak.
- **Gameplay and social data:** Local quest progress, history, places visited, collections, scores, settings, reminders, and personal bests are stored on-device. Signed-in shared-hunt results and friend relationships are stored in Supabase. Shared hunt content contains place/quest data and may retain no creator link after account deletion.
- **Install identifier and usage:** The app creates a random install ID. If optional analytics are enabled, it sends that ID, event name, timestamp, and event properties to the DayQuest server. The server code writes JSON-lines logs. It does not include the Supabase account ID in these analytics calls, but an install ID is still an identifier under Apple's categories.
- **Feedback/support content:** Quest ratings, optional text, stop flags, and related quest/stop context are sent with the install ID to the DayQuest server when the user submits feedback.
- **Local notifications:** Planned-hunt reminders are scheduled on-device. The represented app does not use remote push delivery.

## Purposes

The represented code uses this data for app functionality (authentication, quest generation, navigation, finding places, saving progress, friends and leaderboards, sharing, support), product personalization (nearby quest generation and local history), and analytics chosen in the Privacy screen. No advertising SDK, cross-app tracking integration, or data-broker path appears in this repository. The release owner must confirm no production system or contract changes that fact.

## Processors and sources

Production configuration may send data to or display data from:

- **Supabase:** authentication, profiles, friends, shared-hunt results/content, and account deletion.
- **Render or {{DAYQUEST_API_HOST}}:** hosts the DayQuest API and its current file-based analytics, feedback, and score sinks.
- **Anthropic:** quest-generation processing performed by the server; confirm the exact request fields and contract before publication.
- **Google:** map display, place/geocoding data, and Google authentication where configured.
- **Apple:** Apple authentication, maps in Expo Go/iOS configurations, and token revocation.
- **OpenStreetMap contributors / OSM services:** open place/geographic data under ODbL attribution requirements.
- **Wikipedia / Wikimedia:** source content and links under their applicable licenses/terms.
- **Expo / EAS:** app build/update infrastructure as configured; owner must determine whether production runtime services collect diagnostics.

Processor list, legal bases, international transfers, and contract links require owner/legal confirmation: {{PROCESSOR_AND_TRANSFER_DETAILS}}.

## Retention

No approved production retention duration is represented in the repository. Before release, publish a data-class-specific schedule covering Supabase data, API JSONL logs, backups, security records, support requests, and local-only data: **{{RETENTION_SCHEDULE}}**. Local data remains until the user resets/deletes it, uninstalls the app, or the OS removes it, subject to device behavior.

## Choices and deletion

- Use DayQuest as a guest without creating a DayQuest account.
- Deny camera access and use the camera-skip path.
- Turn future optional analytics off in **Settings → Privacy & legal**. This does not retroactively erase server logs.
- Reset guest/local data in Settings. This removes represented AsyncStorage keys, the DayQuest photo directory, and a stored reminder from that device.
- Signed-in users can choose **Profile → Delete account**. After confirmation, the app invokes an authenticated Supabase Edge Function. The reviewed contract deletes profiles, friendships, hunt results, anonymizes shared-hunt creator linkage, revokes a stored Apple token when applicable, and deletes the auth user. It fails closed if unknown user-linked tables or Storage objects are detected. Only after server success does the app remove local data and sign out.

Account deletion does not currently identify or erase historical API JSONL records by account because those records are keyed to a random install ID, not the Supabase user ID. The local install ID is reset after successful account deletion. The release owner/legal reviewer must decide whether and how install-ID requests and backups are handled: {{INSTALL_ID_AND_BACKUP_DELETION_PROCESS}}.

## Safety and open data

DayQuest directs people to real-world places. Users should obey laws and signs, avoid trespass, remain aware of traffic and surroundings, and skip any place that feels unsafe. Place facts may be incomplete or outdated; source links are provided for review.

OpenStreetMap data requires attribution to OpenStreetMap contributors and is available under the Open Database License. Wikipedia/Wikimedia and individual linked sources have their own attribution and license terms. Final notices: {{OPEN_DATA_ATTRIBUTION_TEXT_AND_LINKS}}.

## Rights and contact

Applicable rights and response procedures depend on release territories and the operator. Legal counsel must supply: {{JURISDICTION_SPECIFIC_RIGHTS_AND_LEGAL_BASES}}. Contact {{SUPPORT_CONTACT}} using {{SUPPORT_URL}}.
