# DayQuest — Product Requirements Document (living)

**Owner:** CPO · **Last updated:** 2026-06-19 · **Status:** Pre-MVP, core loop built

This is the single source of truth for what DayQuest is, what we're building next,
and why. Every feature decision is checked against the Vision and scored with the
Prioritization Framework below.

---

## 1. Vision

**DayQuest is a real-world discovery game** — wake up anywhere (your city or a new
one), and turn boredom into an adventure: explore real, storied places, earn points,
collect completions, track the route you walked, and compete & share with friends.

**Pokémon GO × Atlas Obscura × Strava × social** (amended 2026-06-21, D-034):
- **Explore & collect** (Pokémon GO) — go to real places, earn points, complete
  "seen-them-all" missions/collections.
- **Storied content** (Atlas Obscura) — the quirky, history-rich soul; *why* each
  place matters. This is our content engine.
- **Track & share your route** (Strava) — record the path you walked, with stats,
  and share it.
- **Compete & social** — scavenger hunts against friends, a shared feed.

We exist to get people **off the couch, outside, and exploring** — solo or together.
The feeling: *"I had a real adventure today."*

**Build-order discipline (still discovery-first in sequence):** Pokémon GO and Strava
are both fun *solo* first; social/competitive is the amplifier and the hard, cold-start
part. So we build the great **solo discovery game** (collections + route tracking +
game juice) *before* friend-competition + social feed. Accounts (Supabase) are now in,
which is the prerequisite for the social layer when we get there.

## 2. Target user (initial wedge)

Curious urban explorers, ~25–45, in dense, history-rich cities. Three live
segments, one launch city:

- **Local explorers** — want a low-effort reason to go outside and see something new.
- **Couples / parents** — a ready-made activity for an afternoon with someone.
- **Visitors / tourists** — want the "hidden gems," not the tourist-trap list.

**Launch market: New York City.** Single-city focus so we can nail content
density and quality before scaling. (Decision D-002.)

## 3. Positioning

Atlas Obscura's *taste* — storied, quirky, historic — delivered as a **generated,
gamified, location-aware daily quest** instead of a guidebook. Not a map of
everything; a curated *handful* with a reason to go and a small challenge.

We do **not** scrape Atlas Obscura. Content is built from open data (Wikipedia,
OpenStreetMap) and curated/narrated by AI. (Legally clean; see §9.)

## 4. The core loop

```
Open app → detect location → get a 3-stop hunt → walk → check in (GPS) →
photo each stop → completion badge → shareable recap
```

## 5. What's built today (honest state)

| Piece | State |
|---|---|
| Place data: Wikipedia + OpenStreetMap (keyless, fault-tolerant) | ✅ working live |
| AI curation (Claude picks 3 + writes lore/quests; can't hallucinate places) | ⚠️ **built, never run** (needs API key) |
| **Free preview mode** (templated quests, no AI, no key) | ✅ working — demoable today |
| API server (`/quest`) keeping keys server-side | ✅ working |
| Mobile app (Expo): full loop — location → list → GPS check-in (+ manual override) → photo → badge → shareable recap image | ✅ built, config-validated |
| Accounts, persistence, history, map, caching, monetization | ❌ none yet |

**The MVP is demoable right now in preview mode at $0.** The AI quality is the
single unverified link.

## 6. What the MVP must PROVE (the bet)

Feasibility is largely proven. The **riskiest assumption is retention**, not "can
we build it." The MVP exists to answer:

> Do people **complete** a hunt — and do they **come back** for another?

Everything in "Now" is chosen to produce that signal. We do not build retention
*mechanics* (accounts, streaks) until we see that the raw loop is fun enough to
finish once.

## 7. North Star & metrics

- **North Star:** **Completed Quest Days** — the number of days a user completes
  ≥ 1 quest. Chosen over DAU/engagement because the goal is people *in the real
  world having experiences*, not screen time. (D-007)
- **Activation:** % of installs that complete their first full 3-stop hunt (target ≥ 40%).
- **Retention:** Completed Quest Days per *month*; % who return for a 2nd quest
  within ~2–4 weeks; W4 return. (Weekly/occasional cadence — not daily; D-012.)
- **Delight:** share rate on the recap; post-quest 👍/👎.
- **Quality (pre-launch):** human review — % of generated stops that are real,
  visitable, and accurately described.

## 8. Roadmap (Now / Next / Later)

Sequenced to prove the bet (§6) first, then build the habit, then revenue.

### NOW — prove the loop is fun & finishable
1. **Verify AI quality** — get a key, run real quests across NYC, human-review output. *(Gate; blocks all quality calls.)*
2. **Get it on real testers' phones** (Expo/TestFlight) and watch people do a hunt.
3. **Quest-quality tuning** based on what real output and real walks reveal.
4. **Lightweight analytics** — instrument activation, completion, return, share.
5. **NYC demo toggle** — reliable demos regardless of tester location.
6. **Response caching** — cache generated hunts by area to control LLM cost as testing scales.

### NEXT — build the habit & the growth loop
7. **Accounts** (anonymous → optional) so progress persists.
8. **Fresh quests on demand + occasion-triggered nudges + weekly streaks** — the retention engine for a weekly/occasional cadence (not daily).
9. **Collection: badges + history** — a reason to come back and a sense of progress.
10. **Sharpened share loop** — make the recap something people *want* to post (growth).
11. **Map view** of the day's stops.

### LATER — revenue & scale
12. **Freemium**: free daily quest; premium = unlimited quests + themed packs (spooky / history / foodie).
13. **Partner / sponsored stops**, tourism-board & local-business deals.
14. **Multi-city content operations**; social / friends; offline mode.

## 9. Safety, privacy, legal (non-negotiables)

- Send people only to **public, visitable, safe** places; no trespass/risky framing.
- **Location** requested only at quest start, with a clear reason; minimize storage.
- **No invented history** — AI narrates lore only from sourced text; playful
  framing must be clearly marked ("Legend has it…").
- **Attribution** kept for Wikipedia (CC BY-SA) / OSM (ODbL).
- Privacy policy required for store launch; "13+" to sidestep COPPA initially.

## 10. Monetization thesis (parked — do not build pre-retention)

Freemium consumer (daily free quest; premium unlocks volume + themed/city packs),
evolving toward **B2B/tourism** (sponsored stops, partner trails). Revenue is
explicitly deprioritized until retention is proven.

## 11. Prioritization framework

Every proposed feature is scored 1–5 on four lenses. **Pre-PMF weighting** reflects
that retention is the bet and revenue is parked:

| Lens | Weight (pre-PMF) | Question |
|---|---|---|
| **User value** | ×3 | Does it make the core "tiny adventure" feeling better? |
| **Retention impact** | ×3 | Does it bring people back / build a habit? |
| **Dev effort** | ×2 (inverted) | Cheap and simple wins; we're a tiny team. |
| **Revenue impact** | ×1 | Parked until retention is proven. |

Decision rule: **score it, then sanity-check against §6 (the bet) and §1 (vision).**
A high score that doesn't serve the bet still waits.

## 12. Feature decision log

| ID | Decision | Rationale | Date |
|---|---|---|---|
| D-001 | Build "DB + augment with LLM," not LLM-only | Cost control, safety, quality; LLM curates real data | 2026-06-17 |
| D-002 | Launch in NYC, single city | Nail content density/quality before scaling | 2026-06-19 |
| D-003 | Ship a free, no-key preview mode | Lets us demo/test the full loop at $0 while AI is unverified | 2026-06-19 |
| D-004 | MVP optimizes for **retention proof**, not features | Feasibility is largely solved; retention is the open risk | 2026-06-19 |
| D-005 | Photo-only quests for MVP | Matches the completion flow; other quest types are post-MVP | 2026-06-17 |
| D-006 | Cut PRD v1 (`PRD-v1.md`); accounts/daily-cadence are P1, not P0 | v1 must prove the raw loop is finishable & fun before we build the retention layer | 2026-06-19 |
| D-007 | North Star = **Completed Quest Days** | Goal is real-world experiences, not screen time | 2026-06-19 |
| D-008 | Map promoted to P0 | Navigating to a stop is core to the loop, not a nice-to-have | 2026-06-19 |
| D-009 ✓ | Cut XP/levels/leaderboards/social/fitness-integrations from MVP | Mechanics amplify a proven loop; they can't rescue a generic one — sequence after Phase 1 | 2026-06-19 |
| D-010 ✓ | Quest source = **hybrid**: curated POI DB (bootstrapped from open data + human curation) as source of truth; **AI generates routes & assembles** adventures from it | Determines magical vs generic; AI assembles, never invents | 2026-06-19 |
| D-011 ✓ | **Discovery-first** (gamification is a P2+ amplifier, not MVP) | Prove the walk is fun before spending on the game layer | 2026-06-19 |
| D-012 ✓ | **Not a daily-use product** — cadence is weekly/occasional | Push→occasion-triggered, streaks→weekly, retention measured per month; raises the bar on per-quest quality | 2026-06-19 |
| D-013 (CTO rec, needs CEO) | **Extend** Expo/Node/Anthropic; **pre-adopt Supabase (Postgres+PostGIS)** as POI-DB host now | Don't rebuild; Supabase is a smoother Phase-2 path than Firebase (Firebase forces NoSQL re-model). Supersedes original FlutterFlow/Firebase assumption | 2026-06-19 |
| D-014 (CTO rec, needs CEO) | **AI provider = Anthropic, Sonnet 4.6** (not OpenAI); stop hardcoding Opus | Forced-tool + id-join anti-hallucination already work; switching vendors is cost with no MVP upside. Supersedes original OpenAI assumption | 2026-06-19 |
| D-015 ✓ | **Seed Greenwich Village first** (one neighborhood, excellently) | First quest must land; CPO + CTO both pick GV | 2026-06-19 |
| D-016 ✓ | **Validation gate PASSED** — first real AI quest (Opus, GV) was accurate, sourced, varied, on-theme | Core-bet feasibility validated; proceed to build | 2026-06-19 |
| D-017 ✓ | **Encode walkability/spread** in the assembler: consecutive stops ≥250m (ideal 300–600m), loop ~0.8–1.5km, ≥2 place-types, striking anchor first | UX found flagship quest's stops 149–187m apart vs a 100m check-in radius → zones overlap, defeating GPS arrival; reads as standstill not walk | 2026-06-19 |
| D-018 ✓ | **Invert onboarding** — permission-free "surprising nearby place" teaser before asking for location | Delight before any ask; permission only on Start | 2026-06-19 |
| D-019 ✓ | **Recap = 9:16 share-magnet** (hero photo + brag-fact + quest name + neighborhood + route trace), not an inward keepsake | Recap is the growth loop; must pull in non-users | 2026-06-19 |
| D-020 ✓ | Model configurable via `DAYQUEST_MODEL` (default Sonnet 4.6); GV ingest produced **772 curation-ready POIs** | Cheap dev/validation; curation pipeline is live | 2026-06-19 |
| D-021 ✓ | **Sonnet 4.6 quality confirmed** on a live GV quest (rich, accurate, well-written) → default stays Sonnet | Don't need Opus for good quests; ~40% cheaper | 2026-06-19 |
| D-022 ✓ | **Exclude tragedy/disaster/death-defined sites from MVP quests**, but KEEP them in the POI DB marked `maybe` (deferred) for a future respectful "history" mode | Joyful-adventure tone for MVP; don't lose the data. POI `status` enum becomes pending/approved/**maybe**/flagged. Fix = AI-mode pre-filter + prompt guardrail now; curation marks sensitive sites `maybe` | 2026-06-19 |
| D-017a (finding) | Spread retry **works** but clustered icons (Arch+Elm, ~150m) can't always hit the 250m floor without dropping the best content → kept-best fell back to a 150m leg | Reinforces that the **curated DB is the real fix**, not prompt-tuning | 2026-06-19 |
| D-023 ✓ | **Defer curation** — not MVP/first-tester-blocking. AI-over-open-data + the automated guardrails (tone filter, spread retry) carry the first *friendly* tester round | CEO call. Tradeoff: quests are good-not-perfect (occasional clustering; tone filter is an automated stand-in for a curator). **Curation returns before public/store launch & before scaling cities** | 2026-06-19 |
| D-024 ✓ | **First test anchored on Stony Brook Village** (proven hero zone: 32 POIs, real 1.2km loop). Smithtown/St. James too sparse in open data (18/8, 7/4) → joins later via a light curation pass | Avoid a coverage false-negative; testers start at the village center | 2026-06-19 |
| D-025 ✓ | **Not walking-only (post-MVP):** add travel modes (walk/bike/drive) so spread-out suburban areas (Smithtown, LI) become viable. MVP + first test stay walking | CEO insight; driving/biking between stops dissolves the low-density coverage problem | 2026-06-19 |
| D-026 ✓ | **Green-light paid APIs / API keys / OSS** where they make the product better (budget-aware: lean on caching + free tiers). Headline use: **Google Places as the 3rd data source** | Loosens the keyless constraint; Places solves suburban coverage (Smithtown/LI) + the "new/quirky" layer Wikipedia/OSM miss | 2026-06-19 |
| D-027 ✓ | **First real device test PASSED** — app runs on a physical phone (Expo Go, SDK 54); CEO verdict: "the overall idea is there, UI needs work" | Concept validated on-device. Feasibility + appeal both confirmed → next focus is a UI/UX polish pass | 2026-06-19 |
| D-028 ✓ | Build **quest history + saved data + light scoring** — on-device (AsyncStorage), anonymous (reuse install id), **NO login wall**, no leaderboards; photos persisted durably. | CEO clarified the goal is saving/history + light gamification, NOT auth — stays discovery-first & ungated. Full accounts still deferred (P1) | 2026-06-19 |
| D-029 ✓ | **Auth + profiles via Supabase**, **web-redirect OAuth** (Google + Apple, Expo-Go-compatible). Sign-in is **OPTIONAL** (anonymous-first, not a gate); app degrades gracefully if Supabase unconfigured. Native buttons + dev build deferred to pre-launch. | CEO pulled accounts forward; chose open-source Supabase (also the planned backend, D-013) + web-OAuth to keep Expo Go testing. Apple native needs a $99 dev acct → later | 2026-06-19 |
| D-030 ✓ | **Map-first UI redesign** of the active-quest screen: full-screen map; quest stops as tappable numbered dots; a draggable **bottom sheet** lists the stops and expands to a stop's detail (desc/lore/quest/check-in/photo) on tap. Dots = the 3–5 quest stops (stays a curated quest, not a POI browser). | CEO design direction; mobile-native take on "map + sidebar". Replaces the list-of-cards screen + serves as its polish pass | 2026-06-20 |
| D-031 ✓ (NORTH STAR for location) | **"Areas" are a first-class object** — named, curated, walkable explore-zones. GPS *defaults you into the nearest Area*; choosing/planning/touring are all ways of *selecting* an Area. Area size scales with travel mode (walk=neighborhood, bike=district, drive=region). The **library of curated Areas is the moat & the revenue surface** (sponsored Areas/stops, city packs, tourism). Build the data model Area-first now; defer the Area browser/trip-planning/multi-city library until post-retention. | CEO "best long-term play" call. Location ≠ GPS detection; GPS is one lens onto the Areas library. Unifies local/planner/tourist; generalizes D-025 travel modes; where monetization lives | 2026-06-21 |
| D-032 ✓ | **First Area build = reverse-geocode + Area label.** GPS auto-detect (default) → resolve to a *named Area* (e.g. "East Village, NYC") with a one-tap override; the label feeds the quest header, welcome teaser, and the share card (fixes the coords-on-share-card bug). Model it as "resolve to an Area," not "fetch by lat/lng." | Cheapest first brick of D-031; no login dependency; also closes a known share-card gap | 2026-06-21 |
| D-033 ✓ | **Google Places = 3rd data source** (`fromPlaces` in lib/sources.js). Server-side, key-gated (graceful empty-array fallback when no key, so keyless/preview path still works). Filter to discovery-worthy types (parks, art, museums, landmarks, attractions, notable local spots) — NOT generic commercial noise. Field-masked + cached for cost control. | Unlocks suburban/LI coverage (Smithtown) + the "new/quirky/current" layer Wikipedia/OSM miss. Google key now configured | 2026-06-21 |
| D-034 ✓ (AMENDS D-011) | **Vision = real-world discovery GAME** (Pokémon GO × Atlas Obscura × Strava × social): explore & collect, storied content, route tracking, friend competition + sharing. **End state is game-first; build order stays solo-first** (solo game fun before multiplayer/social, which has cold-start risk). Earned by the on-device validation that the loop is fun. | CEO articulated the real vision after testing. Confirmed on-device (D-027); accounts now in (D-029) to support the eventual social layer | 2026-06-21 |
| D-035 ✓ | **Solo discovery-game increment (building):** (1) collections/missions ("discovered X of N notable spots in [Area]"), (2) **single-player async scorecard** (personal bests + points/time per quest/Area; an all-time board that's populated from user #1 and grows into live competition as density arrives — no live players needed), (3) gamey juice + look (points-fly, confetti, badge unlocks, haptics, brighter playful energy on the real map). | CEO greenlit. Async/personal-best design makes "competition" work at our tiny scale — no multiplayer cold-start | 2026-06-21 |
| D-036 ✓ (building) | **Route tracking** — record the walked path (foreground GPS, Expo-Go-safe; reuses the live location watcher), draw it on the map distinct from the planned route, compute real distance + duration, show on recap + save to history; survives pause/resume. | The Strava "see where I walked" pillar; foreground-only avoids the dev-build requirement of background location | 2026-06-22 |
| D-037 ✓ | **Strava = optional EXPORT, deferred + after route tracking.** Needs a Strava developer app + OAuth (external dependency, like the Apple acct). We OWN the route data first; "Export to Strava" is a follow-on, not a blocker. | Don't gate our route feature on a third-party API/approval; build the owned version, add export later | 2026-06-22 |
| D-038 ✓ (SUPERSEDES D-030 bottom sheet) | **Pokémon-GO UI redesign:** full-screen vibrant map; **floating round corner/side buttons** (profile/score, new quest, collections, scorecard) instead of a bottom list; **tap a stop dot → a pop-out card** for that one stop (replaces the persistent bottom sheet); bolder game look (chunky glossy buttons, brighter palette, glowing markers, avatar at location). | CEO tested the bottom sheet and disliked it; wants Pokémon-GO feel + side/pop-out controls | 2026-06-24 |
| D-039 ✓ | **Lush custom map tiles (the signature PoGo look) require a dev build** (Google provider + custom style; not possible in Expo Go / Apple Maps). Ship ~80% of the feel in Expo Go now (layout, buttons, pop-out, visuals); custom map world lands with the EAS dev build (needed for real testers anyway). | Honest Expo Go constraint; sequence the map world with the dev-build milestone | 2026-06-24 |
| D-041 ✓ | **Dev build RUNS on device with custom map; Pokémon-GO layout validated** — CEO: "layout looks better, closer to the Pokémon GO effect." | The dev-build milestone is achieved; the map + floating-HUD direction is confirmed on real hardware | 2026-06-26 |
| D-043 ✓ (queued, after sign-in build) | **Quest Setup picker** (side button): choose location = current GPS **or a typed place** ("East Village", via forward-geocoding) + a **walk-scaled size** control (Quick ~1km/3 stops vs Explore ~2km/5 stops). Realizes the Areas picker (D-031/D-032). | CEO ask; the clean, walkable part shipped first | 2026-06-26 |
| D-044 ✓ (next increment) | **Shared "same-for-everyone in an area" quest** — one canonical quest per Area served to all users (deterministic), enabling true head-to-head competition on the scorecard. Foundation of the multiplayer pillar. Server change + personal-vs-area choice in the picker. | CEO ask; ties scorecard → real competition; on-ramp to social pillar | 2026-06-26 |
| D-047 ✓ (building) | **Quest speed pass:** (1) in-memory quest cache by area+size (repeat = instant), (2) cap Overpass timeout + trim Claude spread-retry loop, (3) keep server warm (external pinger / always-on), (4) Pokémon-GO "scanning…" loading animation. Real fix = POI-DB-served quests (D-046). | CEO: quest build feels slow (live 3-source + Claude + retries + free-tier cold start) | 2026-06-27 |
| D-050 ✓ (queued, after current app build) — BUG | **Active quest is being lost when the user backs out.** Must fix: the in-progress quest + progress persist through navigation/backgrounding; a prominent **Resume** restores it. (Current build strengthens persistence — verify it covers the back-out case; if not, dedicated fix.) | CEO bug report; losing a quest mid-walk is a hard churn moment | 2026-06-27 |
| D-051 ✓ (queued) | **Walk + Bike modes** (biking pulled forward from D-045; bike = bigger loop ~3–6km **within the chosen area**, still GPS-check-in-friendly; driving stays deferred) + **make area-picking a prominent front-door choice** (the Quest Setup picker exists per D-043 but is buried behind the one-tap default). | CEO: app is for walking AND biking; users pick their area, not defaulted | 2026-06-27 |
| D-058 ✓ (building) | **Clue on a side-panel card** (relocate the hunt clue from the floating card to a side-docked, collapsible panel; keep warmer/colder + search zone) + **longer quests** (new "Epic" size ~7–8 stops, bigger loop). | CEO: clue on side panel; longer quests | 2026-06-28 |
| D-059 (SCOPED — needs go-ahead) | **AR camera collectible** — catch an area-exclusive virtual item through the camera (Pokémon-GO-style). Feasible as **"lite AR"**: live camera (expo-camera) + an animated overlay sprite + tap-to-catch, geo-gated to the area/find. NOT full world-anchored ARKit (heavy/expensive/not lean in Expo). New dep → new native build. | CEO: catch a virtual thing with the camera, area-only | 2026-06-28 |
| D-060 (BIG — recommend defer until core validated) | **Friends / multiplayer** — social graph (Supabase friendships/invites), shared/competitive hunts. The largest pillar; has a cold-start problem (no friends on the app yet) + weeks of build. Async-leaderboard groundwork exists (D-044). CPO rec: build AFTER a real-tester signal that solo hunts are fun. | CEO: "do it with friends" | 2026-06-28 |
| D-057 ✓ (building) — CORE MECHANIC PIVOT | **Scavenger-hunt mode (Level 2)** becomes the PRIMARY experience: each place is HIDDEN; the user gets a **clue/riddle** (AI-written, grounded in real lore, never names the place) + a fallback **hint**; the map shows a **search zone** (circle, no exact pin) + a **warmer/colder** proximity meter (+ haptic pulse) from live GPS; reaching the find radius (~50m) triggers **FOUND IT → reveal + collect a virtual item** (themeable). One target at a time, sequentially. Manual "reveal" fallback for safety/GPS. Points per find; items = collections; reuses pipeline/areas/walk-bike/no-repeat/recap. Replaces the guided-tour presentation (kept in git history). Events (D-055)/themes (D-056)/tester-push parked per CEO. | CEO pivot to find the fun: "more like a scavenger hunt — clues to find a place, collect a virtual item." Inherently more game than a tour | 2026-06-28 |
| D-053 ✓ (queued, next app build) | **Quests-as-collectible-cards UX:** pick/type area → an animated "<Area> Quest" card → tap → opens the map/quest → on completion the card is SAVED (showing the locations hit) into a gallery. Unifies with the recap/My-Quests artifact (same card, created→completed states). Places still also under Places Visited. | CEO UX vision; reinforces the game/collectible feel | 2026-06-27 |
| D-056 ✓ (designed; flagship of the curated DB) | **Themed tours via DB labeling** — e.g. a "ghost/haunted tour" lists places tagged `haunted`. Reuses the POI DB `tags`/`category` (already built, D-046) + curation workflow. A `theme` option joins Quest Setup; quest-gen filters candidates by tag. **Two stacking paths:** (1) AI-themed via prompt (quick, anywhere, test appeal — AI surfaces hauntings from lore), (2) curated tags (reliable, THE moat). Tag vocab: haunted/foodie/historic/public-art/literary/nature/architecture… **Monetization: premium theme packs** (free general quest + paid Spooky/Foodie/etc.) — the concrete freemium model. | CEO feature; flagship of why the curated DB exists; strong replayability + revenue | 2026-06-28 |
| D-055 (PARKED — post-tester-round) | **Local events / "what's on" layer** — time-bound entries in the POI DB (starts_at/expires_at); quest-gen can mix in a timely event stop. Strong retention lever for a non-daily app ("a reason THIS weekend is different"). **Use event APIs, NOT scraping** (legal/reliability). **Flavor = LOCAL / CULTURAL / COMMUNITY** (CEO, 2026-06-28): markets, gallery openings, free music, festivals, library/park/museum happenings — NOT big ticketed concerts/sports. Lead sources: **civic open-data** (e.g. NYC Open Data) + community/cultural calendars + Eventbrite-community; Ticketmaster only as minor filler. Tradeoff to accept: this flavor is the most fragmented and leans on per-city civic feeds, so it scales city-by-city rather than one global API (matches our one-neighborhood-at-a-time curation model). Needs scheduled re-ingest (events expire). Reuses curation/no-repeat/area machinery. | CEO wants events, local/cultural flavor; CPO: great Phase-2 depth, build AFTER validating the core loop with real testers | 2026-06-28 |
| D-054 ✓ (queued) | **Pokémon-GO color palette** — shift UI chrome (buttons/cards/backgrounds) from warm cream/terracotta (Atlas-Obscura editorial) to bright cool PoGo tones (sky-blue/teal, vivid green, white cards, bold accents). Commits the brand to "game" over "editorial" (consistent with D-034/D-038). Map already PoGo-styled. | CEO: "want the colors more pokemon go-ish" | 2026-06-27 |
| D-052 ✓ (queued) — CORE LOOP | **No repeat quests:** generation EXCLUDES places the user has already visited (from their account history / on-device for guests), so each quest in an area is fresh. App sends visited-place keys → `/quest` filters candidates. **Must coexist with the speed cache (D-047):** a request carrying an exclude-list bypasses/varies the cache (fresh quest); first-timers + shared quests still hit the cache. The refined core loop: pick area → pick walk/bike → fresh quest → saved to account. | CEO vision: "save that data against their account so they don't get the same quest twice" | 2026-06-27 |
| D-048 ✓ (building) | **Reward every check-in + visited-places history:** award points on CHECK-IN of any stop (not just photo/completion), recorded + persisted immediately; a viewable "Places Visited" history built from check-ins; ensure progress persists reliably on-device (sync totals to Supabase profile when signed in). | CEO: points for checking into any place; users look back at places visited; partial quests should still reward | 2026-06-27 |
| D-046 ✓ (queued, after picker) — AMENDS D-023 | **Build the persistent curated POI database in Supabase** (Postgres + PostGIS). Ingest from open data (Wikipedia/OSM/Places) → store + human-label (name, area, category, tags, lore/blurb, status pending/approved/maybe/flagged). Then **serve curated/shared area tours straight from the DB — no Claude, no Google call.** The moat + the cost lever + the source for shared canonical tours (D-044). Curation UI = Supabase's built-in table editor (no custom admin for now). | CEO pulled curation forward, framed as cost control. Reuses the GV ingest (772 POIs) + CTO-POI-DB-PLAN.md schema; home = the Supabase we already have | 2026-06-26 |
| D-045 ✓ (deferred increment) | **Drive/Bike mode + multi-mile radius** (the literal "5 miles") — its own focused build because it reworks check-in proximity, walkable-loop logic, and route tracking (all currently foot-based). Walk-scaled control ships now (D-043); true travel radius later. Realizes D-025. | Don't half-build driving; sequence it properly | 2026-06-26 |
| D-049 ✓ | **Google sign-in WORKS end-to-end** on the standalone build (Supabase OAuth + `dayquest://` redirect allow-listed). Auth pillar live; profile sync active. Apple still pending its Supabase provider config. | Confirmed by CEO in the standalone app | 2026-06-27 |
| D-042 ✓ (building) | **Sign-in-FIRST screen** as the app entry point (Google + Apple prominent) **WITH a "Continue as guest" skip** — soft gate, not a hard wall. Preserves anonymous-first activation (D-029) while satisfying "start with sign-in." Can harden to required later once auth is proven. Needs Supabase redirect allow-list (`dayquest://`). | CEO directive after testing; soft gate protects first-session activation | 2026-06-26 |
| D-040 ✓ | **Dev-build milestone:** EAS Build (eas.json) → standalone app that unlocks (1) custom Google map style (PoGo look), (2) Apple login, (3) real-device standalone testing. Code/config prepped now WITHOUT breaking Expo Go (default map provider stays until the built app switches to Google). Prereqs: enable Maps SDK iOS/Android on the Google key; an Expo/EAS account; **iOS device install needs the Apple Developer acct ($99/yr)** — Android dev build is free (just install the APK). | The step that turns "demo I keep tweaking" into "app real testers can use," and the only path to the signature map | 2026-06-25 |

## 13. Open decisions (need CEO input)

- **OD-1 (open):** Get an API key to validate AI quality — unblocks the gate.
- **OD-2 (resolved):** Not a daily-use product — cadence is weekly/occasional; habit mechanics reframed (D-012).
- **OD-3 (ratified):** Retention (Completed Quest Days), not feature breadth, is the MVP success bar.
