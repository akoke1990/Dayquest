# DayQuest — UX/Design Research (decision-grade)

**Author:** Senior Product/UX Research · **Date:** 2026-06-29 · **Status:** External research input for UI decisions
**Scope:** Researches the **full DayQuest concept** (map + hard clues + warmer/colder + AR catch + gamification + multiplayer), then uses the team's current MVP cuts (see `UX-SPEC.md`, `docs/UX_DESIGN.md`) as a **sequencing lens** in the recommendations. This file is research; it does not supersede the build specs.
**Sibling docs:** `UX-SPEC.md` (v1 build spec), `docs/UX_DESIGN.md` (screen inventory), `docs/GAME_DESIGN.md`. Read alongside.

---

## Executive summary

**Top findings**

1. **The "hard clue" is the single biggest product risk, and the competitor with the closest model proves it.** Adventure Lab (Geocaching's clue-based product) rates **4.9★ over 6,400 ratings** — yet its most consistent complaint is *answer/clue friction*: clues referencing closed businesses, answers that must be typed in an exact format ("I had to enter it as 'es'…"), and stages that lock when found out of order. ([App Store](https://apps.apple.com/us/app/adventure-lab/id1412140803)) For DayQuest, where clues are **AI-generated** and intentionally **hard→nearly-impossible**, this is the failure mode that will dominate 1-star reviews unless designed against from day one.

2. **GPS in Manhattan cannot be trusted for tight geofences or smooth warmer/colder.** Smartphone positioning in dense urban canyons degrades to **tens of meters** of horizontal error from multipath (satellite signals bouncing off building façades) — a peer-reviewed study confirms standard GNSS struggles in these environments and that signal-strength weighting is needed to recover accuracy. ([PMC urban-canyon study](https://pmc.ncbi.nlm.nih.gov/articles/PMC12349109/)) Popular/secondary write-ups put NYC street-level error in the **10–50 m+ range with occasional erratic jumps** near mirrored façades (treat the most dramatic figures as illustrative, not measured). This is *the* technical constraint behind the Adventure Lab "shows me a mile away / won't let me check in" complaints — and it directly threatens both DayQuest's warmer/colder tint (jitter = the map flickering red/blue while you stand still) and the AR check-in. Design around it; do not assume it away.

3. **The warmer/colder mechanic is loved when it's a smooth, debounced *signal*, not a literal distance readout.** Geocaching's hot/cold ("on fire" ≤10 m, "burning hot" ≤25 m) only refreshes after the player **moves ≥15 m**, with a radar variant updating every ~5 s on ≥3 m movement. ([Geocaching forums](https://forums.geocaching.com/GC/index.php?/topic/391158-hotter-or-colder-game/)) The debounce is *why it feels good* and *why it hides GPS jitter*. DayQuest's tint must adopt the same movement-gated smoothing.

4. **"Catching feels good" is built from anticipation + skill + variable reward — not from AR fidelity.** Pokémon GO's catch satisfaction comes from the ball's **three-shake suspense**, the skill of an "Excellent" throw, and a **1% critical-catch firework** — a textbook variable-reward layer. ([Pokémon GO Hub](https://pokemongohub.net/post/guide/go-hub-guide-to-mastering-the-art-of-catching-pokemon/)) Notably, **AR is optional in Pokémon GO** and many players turn it off; the magic is the encounter loop, not the camera. This de-risks DayQuest's "lite-AR catch": ship the satisfying *moment* first, AR second.

5. **Map-first location games consistently under-invest in onboarding, and it's their #1 reviewer pain.** Both Pokémon GO and Munzee are described as confusing on first run — Pokémon GO gives "no clear instructions on how to actually capture" ([UXPin](https://www.uxpin.com/studio/blog/beyond-hype-ux-reality-check-pokemon-go/)); Munzee is "overly complex to the point that I've had friends say 'No thanks.'" ([App Store, 3.7★](https://apps.apple.com/us/app/munzee/id1367282248)) The whole category leaves a **gap DayQuest can own: teach-by-doing onboarding that reaches a real "found it" moment in under 2 minutes.**

6. **Gamification retains only when tied to intrinsic payoff; bolted-on points/streaks demotivate.** Duolingo's streaks reportedly make users **~3× more likely to return** and helped cut churn (figures from marketing case-studies, directionally consistent) — but the same mechanics put Duolingo on **deceptive.design** for coercive reminders and guilt-tripping. ([925studios](https://www.925studios.co/blog/duolingo-design-breakdown), [Tiina Golub](https://tiinagolub.medium.com/lots-of-intersting-thoughts-here-ba20cf717201)) DayQuest's own PRD already calls cadence "weekly/occasional, not daily" — so **a daily streak would be a dark pattern here.** The retention spine is *discovery*, with light weekly amplifiers.

7. **The "discovery/lore" niche is wide open and well-liked.** Atlas Obscura users say they "use this app literally all the time" and love being taken "to the strangest, coolest, quirkiest places" — but it's a **read-only guide, not a game.** ([Atlas Obscura App Store](https://apps.apple.com/us/app/atlas-obscura-travel-guide/id1563250221)) Nobody owns *Atlas-Obscura-grade lore × a real game loop.* That is DayQuest's defensible gap.

**Top 7 prioritized recommendations** (full detail + evidence in §3)

| # | Recommendation | Tied to |
|---|---|---|
| **R1** | **Build an anti-frustration clue system** — every clue has a tiered hint ladder (nudge → strong hint → reveal), fuzzy/forgiving answer matching, and a "skip/reveal, keep playing" escape. Never hard-block completion. | Finding 1, Adventure Lab |
| **R2** | **Treat GPS as noisy: debounce everything, geofence generously.** Movement-gated warmer/colder (refresh only after ≥10–15 m moved), a check-in radius ≥30–50 m in Manhattan, and an always-visible "I'm here" manual override. | Findings 2–3 |
| **R3** | **Make warmer/colder a smoothed compass-edge glow, not a full-screen tint.** Keep the map legible; encode hot/cold in a peripheral ring + haptic + audio, not by tinting the whole readable surface red/blue. | Finding 3, §2f, sunlight risk |
| **R4** | **Engineer the "catch" as a 3-beat moment** (approach shimmer → skillful tap/throw → variable reward reveal) with haptics + sound. Ship this *without* AR for v1; make camera-AR an opt-in flourish. | Finding 4 |
| **R5** | **Onboard by doing: a 90-second guaranteed-find first quest** with a planted easy clue, ending in a real collectible. No carousel, no permission wall first. | Finding 5, §2d |
| **R6** | **Weekly (not daily) streaks + a collectible card gallery as the retention spine.** No guilt notifications. Make the intrinsic discovery the reward; gamification is the frame, not the bait. | Finding 6, Duolingo |
| **R7** | **Lean into the warm cream/ink/terracotta + hand-illustrated direction you already have** to escape AI-slop. Custom map style, sticker/postcard collectibles, one characterful display typeface. No purple gradients, no generic Inter-on-glassmorphism. | Finding 7, §3 anti-slop |

---

## 1. Competitive landscape

For each: what the UI does well · what users praise/complain about · the ONE thing DayQuest should steal or avoid.

### Pokémon GO — the genre's UX benchmark (and cautionary tale)
- **Does well:** A living, custom-styled map *is* the home screen; the avatar "you" marker anchors a believable world; the **encounter/catch loop** layers AR + chance + skill into a variable-reward hook (three-shake suspense, "Excellent" throws, 1% critical-catch fireworks). A built-in screenshot button acknowledges the share instinct. ([Pokémon GO Hub](https://pokemongohub.net/post/guide/go-hub-guide-to-mastering-the-art-of-catching-pokemon/), [UXPin](https://www.uxpin.com/studio/blog/beyond-hype-ux-reality-check-pokemon-go/), [Pixso UI review](https://pixso.net/tips/pokemon-go-ui/))
- **Complaints:** Tutorial is thin — "no clear instructions on how to actually capture"; menus are "clunky and slow"; the game "does very little to teach players what features do." ([UXPin](https://www.uxpin.com/studio/blog/beyond-hype-ux-reality-check-pokemon-go/), [WebSearch synthesis of pokemongohub/community.pokemon.com](https://community.pokemon.com/en-us/discussion/15016/feedback-ui-ux-design))
- **STEAL:** the **3-beat variable-reward catch moment**. **AVOID:** shipping it with a near-zero tutorial — DayQuest's clue/AR loop is *less* self-evident than throwing a ball.

### Geocaching + Adventure Lab — the closest analog to DayQuest's clue model
- **Does well:** Adventure Lab is "much more polished than the old Wherigo system"; location-anchored multi-stage stories; **4.9★ / 6.4K ratings** shows the *format* works. ([App Store](https://apps.apple.com/us/app/adventure-lab/id1412140803))
- **Complaints (the important ones for us):** clues referencing **closed/changed businesses**; **exact-format answer matching** that rejects correct answers; **stages locked in order** so an out-of-sequence find blocks completion; map showing you "a mile away" so the question won't open. ([App Store](https://apps.apple.com/us/app/adventure-lab/id1412140803), [justuseapp reviews](https://justuseapp.com/en/app/1412140803/adventure-lab/reviews))
- **STEAL:** the polished staged-story container. **AVOID:** rigid answer matching, brittle clues, and hard sequence/geofence locks. **This is the most directly transferable lesson in the whole report — see R1.**

### Munzee — what over-complexity does to a location game
- **Does well:** encourages walking; deep badge/event system for committed players. **3.7★ / 117 ratings.**
- **Complaints:** map is "atrocious" — a slight bump zooms "clear out in space looking down on CONUS"; "overly complex… friends say 'No thanks'"; servers down "for hours," laggy; pay-to-compete pressure. ([App Store](https://apps.apple.com/us/app/munzee/id1367282248), [Wikipedia](https://en.wikipedia.org/wiki/Munzee))
- **STEAL:** nothing strongly. **AVOID:** feature-creep and a fiddly map camera. Lock sensible zoom bounds; resist the urge to bolt on systems.

### Actionbound — education/museum "bounds"
- **Does well:** flexible builder (quizzes, GPS challenges, multimedia); "well made," "easy for the novice"; free personal use. ([justuseapp](https://justuseapp.com/en/app/582660833/actionbound/reviews))
- **Complaints:** interface "feels somewhat dated"; published bounds are publicly discoverable. ([PlayTours roundup](https://www.playtours.app/post/all-in-one-guide-to-scavenger-hunt-app-reviews-from-g2-beyond))
- **STEAL:** the multimedia-stop pattern. **AVOID:** the dated, utilitarian aesthetic — DayQuest's edge is *delight*, not a tool feel.

### Scavify — corporate/team-building hunts
- **Does well:** "very easy to use," no login setup, clear on-screen instructions; reliable. ([PlayTours](https://www.playtours.app/post/best-scavenger-hunt-apps-in-2025-ranked-by-features-pricing-reviews))
- **Complaints:** expensive (~$1,300/100-person event); thin public review footprint.
- **STEAL:** **no-login, instant-start** for first play (matches your spec's anonymous MVP). **AVOID:** B2B-event framing — wrong audience.

### Let's Roam — consumer city scavenger hunts (direct competitor)
- **Does well:** lighthearted photo-based hunts; people enjoy wandering, laughing with friends, picking up trivia. ([PlayTours](https://www.playtours.app/post/best-scavenger-hunt-apps-for-2023-tried-tested))
- **Complaints:** **inconsistent quality** — hunts "too short," "too basic to justify the price," **outdated maps, vague instructions, inaccurate GPS.** ([PlayTours roundup](https://www.playtours.app/post/all-in-one-guide-to-scavenger-hunt-app-reviews-from-g2-beyond))
- **STEAL:** the social/laughing-with-friends energy (validates multiplayer). **AVOID:** content inconsistency — your AI generation must hit a *reliable* quality floor or you inherit this exact complaint at scale.

### Atlas Obscura app — the lore bar to clear
- **Does well:** beloved curation — "use it literally all the time," takes people to "the strangest, coolest, quirkiest places"; multiple photos per place; responsive devs. ([App Store](https://apps.apple.com/us/app/atlas-obscura-travel-guide/id1563250221))
- **Complaints:** it's a **guide, not a game** — no loop, no progression, no reason to *complete* anything.
- **STEAL:** the **lore quality + "I never knew this existed" payoff** (your PRD's intrinsic, non-fakeable retention driver). **AVOID:** stopping at read-only. **The gap: Atlas-Obscura lore × a real game loop = DayQuest's whitespace.**

### Strava — route discovery + social competition
- **Does well:** clean modern map UI; **heatmap** for route discovery (darker = more-traveled); **segment leaderboards** drive friendly competition that "discourages walking it back." ([Strava heatmap](https://www.strava.com/maps/global-heatmap), [Jonathan McCurdy UX case study](https://jona-mcc.medium.com/strava-route-explore-d797850735bd))
- **Complaints:** leaderboards can intimidate casual users (competition is motivating *or* alienating depending on framing).
- **STEAL:** **async leaderboards + "popular routes" social proof** (fits your async-leaderboard plan). **AVOID:** making competition the default frame for a discovery game — keep it opt-in/secondary.

### Duolingo — gamification & streaks done (controversially) well
- **Does well:** streaks reportedly drive ~**3× daily return** with material churn reduction and DAU growth (marketing-sourced figures, directionally credible); streak freeze as a safety valve. ([925studios](https://www.925studios.co/blog/duolingo-design-breakdown), [Propel](https://www.trypropel.ai/resources/duolingo-customer-retention-strategy))
- **Complaints:** on **deceptive.design** for coercive reminders, guilt-trips, and monetizing streak anxiety ("Don't let Duo down!"). ([Tiina Golub](https://tiinagolub.medium.com/lots-of-intersting-thoughts-here-ba20cf717201))
- **STEAL:** streak-freeze-style forgiveness; visible progress milestones. **AVOID:** daily-streak guilt — **wrong cadence for a weekly product**, and a documented dark pattern. Use *weekly* streaks.

**Gaps DayQuest can own:** (1) Atlas-Obscura-grade lore inside a *real game loop*; (2) a clue game that is *hard but never frustrating* (the anti-Adventure-Lab); (3) **first-find in <2 min** in a category that universally under-onboards; (4) a discovery game with **healthy, weekly** gamification rather than daily-streak coercion.

---

## 2. UI/UX patterns that work

### (a) Map-first location-game HUD
- **The map is the home screen**, not a tab — Pokémon GO/Strava both make the styled map the primary surface. ([Pixso](https://pixso.net/tips/pokemon-go-ui/))
- **A characterful "you" marker** (avatar, not a stock blue dot) anchors identity and immersion. ([UXPin](https://www.uxpin.com/studio/blog/beyond-hype-ux-reality-check-pokemon-go/))
- **Minimal persistent HUD:** one primary action + small status; push everything else behind a single tap. Pokémon GO and Munzee both get dinged when the HUD/menus get dense. ([community.pokemon.com](https://community.pokemon.com/en-us/discussion/15016/feedback-ui-ux-design))
- **Constrain the map camera:** lock zoom bounds and recenter — Munzee's runaway zoom is a cautionary example. ([App Store](https://apps.apple.com/us/app/munzee/id1367282248))
- **Search zone overlay:** a soft translucent circle (not a hard wall) communicates "somewhere in here" without implying false precision — important given GPS error.

### (b) Scavenger-hunt clue presentation (clue + hint + progress, no clutter)
- **One stop at a time** beats a wall of stops (your own `UX_DESIGN.md` principle, confirmed by category — Adventure Lab's staged container).
- **Progressive disclosure of help:** clue shown by default; hint(s) are *pulled*, not pushed, so solvers aren't spoiled and strugglers aren't stuck. Mobile-game onboarding research: "introduce one mechanic at a time," "avoid information overload." ([Udonis FTUE](https://www.blog.udonis.co/mobile-marketing/mobile-games/first-time-user-experience))
- **Forgiving answer entry** is a *clue-presentation* concern, not just backend — Adventure Lab's exact-match rejections are a top complaint. ([App Store](https://apps.apple.com/us/app/adventure-lab/id1412140803))
- **Lightweight progress chip** ("Stop 2 of 3") — a small milestone indicator motivates without clutter. ([TechAhead onboarding](https://www.techaheadcorp.com/blog/19-mobile-app-onboarding-best-practices-examples/))

### (c) The finding/catching moment (make it rewarding)
- **Anticipation beat:** Pokémon GO's three-shake ball delays resolution — suspense *is* the reward. ([Pokémon GO Hub](https://pokemongohub.net/post/guide/go-hub-guide-to-mastering-the-art-of-catching-pokemon/))
- **Skill expression:** the "Excellent" throw rewards precision; even a light skill input makes the reward feel *earned*.
- **Variable reward:** the 1% critical-catch firework is the hook — rare, delightful surprises drive repeat engagement (Nir Eyal model). ([UXPin](https://www.uxpin.com/studio/blog/beyond-hype-ux-reality-check-pokemon-go/))
- **AR is optional:** AR+ is a mode many players disable; the loop carries the magic, not the camera. ([iMore AR+](https://www.imore.com/heres-how-pokemon-gos-new-ar-mode-works)) → de-risks DayQuest's lite-AR.
- **Multi-sensory confirmation:** haptic + sound + animation together; the "ding, you made it" beat (already in your spec §1.5).

### (d) Onboarding to first-fun-fast (<2 min)
- **Teach by doing, not by telling** — "learning through doing is one of the best onboarding practices"; show what's *different* immediately. ([Udonis](https://www.blog.udonis.co/mobile-marketing/mobile-games/first-time-user-experience), [Plotline](https://www.plotline.so/blog/mobile-app-onboarding-examples))
- **Delight before asking for permissions** — your spec already fixes the "asks before it delights" bug; the category's universal onboarding weakness (Pokémon GO, Munzee) is the opening for DayQuest to win.
- **Milestone scaffolding:** small steps + progress indicators keep first-run momentum. ([TechAhead](https://www.techaheadcorp.com/blog/19-mobile-app-onboarding-best-practices-examples/))

### (e) Gamification that retains vs. demotivates
- **Retains:** streaks (3× return), visible progress, collections, *opt-in* leaderboards, forgiveness mechanics (streak freeze). ([925studios](https://www.925studios.co/blog/duolingo-design-breakdown), [Strava](https://jona-mcc.medium.com/strava-route-explore-d797850735bd))
- **Demotivates / dark:** coercive daily reminders, guilt-tripping, monetized anxiety, leaderboards that intimidate newcomers. ([deceptive.design via Tiina Golub](https://tiinagolub.medium.com/lots-of-intersting-thoughts-here-ba20cf717201))
- **Rule of thumb:** gamification works when it *frames* an intrinsic reward (discovery) and fails when it *substitutes* for one (hollow points).

### (f) Warmer/colder proximity mechanic — what feels good
- **Tiered, named states** ("on fire" ≤10 m, "burning hot" ≤25 m) read better than raw meters. ([Geocaching forums](https://forums.geocaching.com/GC/index.php?/topic/391158-hotter-or-colder-game/))
- **Movement-gated refresh is the secret:** update only after the player moves **≥15 m** (or a radar variant every ~5 s on ≥3 m). This both *feels* deliberate and *hides GPS jitter*. ([Geocaching forums](https://forums.geocaching.com/GC/index.php?/topic/391158-hotter-or-colder-game/))
- **Color-coded proximity is a known pattern:** reddish = hotter, bluish/greenish = colder (way-finder patents, AR-geocaching signal-strength demos). ([WebSearch synthesis](https://devpost.com/software/ar-geocaching)) — but see §4 for the legibility caveat on *full-screen* tint.

---

## 3. Prioritized recommendations for DayQuest's UI

Ranked by leverage. Each tied to evidence above.

**R1 — Anti-frustration clue system (highest leverage; this is the product).**
Evidence: Adventure Lab's 4.9★ can't protect it from clue-friction complaints (closed businesses, exact-match rejects, hard locks). [App Store]. DayQuest's clues are *AI-generated and intentionally hard* — strictly higher risk.
Build: (a) **Tiered hint ladder** per stop — free nudge after ~2 min stuck, stronger hint on demand, full reveal always available ("Show me where" — keep playing, maybe smaller reward). (b) **Fuzzy answer matching** (case/whitespace/synonym/number-word tolerant) if any answer entry exists. (c) **Never hard-block**: out-of-order finds and unsolved clues must always have a forward path. (d) **Clue freshness guard**: validate against current OSM/Places data so you never cite a closed business. Cut: any rigid "exact answer or nothing" gate.

**R2 — Treat GPS as noisy; debounce and geofence generously.**
Evidence: urban-canyon multipath degrades smartphone positioning to tens of meters (peer-reviewed) [PMC]; secondary reports put NYC street-level error around 10–50 m+ with erratic jumps. This is the root cause of Adventure Lab/Let's Roam "won't let me check in" complaints.
Build: warmer/colder refreshes **only after ≥10–15 m of movement**; check-in radius **≥30–50 m** in dense Manhattan (tune by area); a **persistent "I'm here" manual override** (your spec already has this — keep it prominent); smooth the position with a short rolling average. Cut: tight (<20 m) geofences anywhere below 40th St.

**R3 — Warmer/colder as a peripheral glow + haptic, NOT a full-screen red/blue tint.**
Evidence: full-screen tint fights outdoor legibility (sunlight needs ~1,000+ nits and high contrast; tinting the whole map *reduces* contrast exactly when you can least afford it). [GSMArena/AbraxSys]. And GPS jitter would make a full tint flicker. Movement-gated smoothing required regardless. [Geocaching forums].
Build: encode hot/cold in a **screen-edge ring/compass glow** (warm = ring warms + pulses + haptic intensifies; cold = ring cools + calms), keeping the map body legible. Add a short audio cue near "on fire." Reserve any heavier visual payoff for the final ~10 m. Cut: tinting the readable map surface.

**R4 — Engineer the "catch" as a 3-beat moment; AR opt-in.**
Evidence: Pokémon GO's satisfaction = anticipation + skill + variable reward, and AR is optional. [Pokémon GO Hub, iMore].
Build: **Beat 1 approach shimmer** (the collectible "appears" as you arrive, with haptic) → **Beat 2 a light skill input** (tap-to-grab / quick gesture, low-stakes) → **Beat 3 variable-reward reveal** (common vs. rare card, occasional "critical" sparkle, sound + haptic). Ship this *as a styled 2D moment for v1*; make **camera-AR an opt-in flourish** (per your MVP scope — AR is correctly deferred). The moment, not the camera, is the magic.

**R5 — Onboarding = a 90-second guaranteed-find first quest.**
Evidence: category-wide onboarding failure (Pokémon GO "no instructions," Munzee "too much trouble"); "teach by doing." [UXPin, App Store, Udonis].
Build: first-run drops the user into a **short, easy, planted quest** (one nearby easy stop, a gentle clue, an assured collectible) that *ends in a real "found it" + first card* — teaching clue→map→warmer/colder→catch by playing it once. Delight first, **permission prompt only at the moment it's needed** (your spec already corrects this). Cut: intro carousels, sign-up walls, mechanic tooltips before play.

**R6 — Weekly streaks + collectible card gallery as the retention spine; no guilt.**
Evidence: streaks drive 3× return *but* daily-streak coercion is a documented dark pattern; your PRD cadence is weekly/occasional. [925studios, deceptive.design, PRD].
Build: a **weekly** streak ("explored this week"), a **card gallery** of completed hunts (the Atlas-Obscura collection feeling), and **opt-in async leaderboards** among friends (Strava model). Notifications are *invitational* ("a new quest near you this weekend"), never guilt ("don't lose your streak!"). Cut: daily streaks, loss-aversion push copy, default-on competitive ranking.

**R7 — Distinctive, anti-AI-slop aesthetic — push the direction you already have.**
You've *already dodged* the slop trap: the **cream `#f4f1ea` / ink `#2b2622` / terracotta `#b5562e` / green `#4a7c59`** palette is warm, editorial, and ownable — not the purple-gradient/glassmorphism default. Push it further:
- **Custom-styled map** (warm paper tones, hand-drawn-feeling labels) so even the base layer is on-brand — the opposite of a default Apple/Google map.
- **Collectibles as illustrated postcards/stickers** with a consistent illustration hand — this becomes the shareable, screenshot-worthy artifact (Pokémon GO's screenshot instinct, but classier).
- **One characterful display typeface** for headers (a warm humanist or a quirky editorial face), paired with a clean readable body face. Avoid Inter/SF-everywhere flatness *and* avoid trendy variable-gradient logotypes.
- **Texture over gradients:** subtle paper grain, ink strokes, sticker drop-shadows — tactile, not glossy.
**Avoid:** purple→blue gradients, glassmorphism, neon dark mode, generic 3D blobs, stock geometric mascots, centered-everything emptiness. These read as "AI-generated app" in 2026 and undercut the premium-discovery positioning.

*(Lower-priority but worth tracking: R8 — opt-in social "shared identical hunt" race with async leaderboard, Strava-style, post-MVP; R9 — share-card export from the gallery to drive organic growth.)*

---

## 4. Risks & cautions (DayQuest-specific)

1. **Hard clues = frustration / churn.** Highest risk. AI clues that are *too clever*, ambiguous, or reference stale POI data will generate the exact 1-star complaints Adventure Lab gets, amplified. **Mitigation: R1** (hint ladder, never-block, freshness guard) + a human/automated QA pass on generated clues + a difficulty signal so users self-select. [App Store: Adventure Lab].

2. **GPS precision in Manhattan.** Tens-of-meters error from urban-canyon multipath (peer-reviewed), reportedly 10–50 m+ with erratic jumps at street level. Breaks tight geofences *and* smooth warmer/colder. **Mitigation: R2** (generous radius, movement-gated refresh, manual override, rolling-average smoothing). Test physically in Midtown, the Financial District, and near glass façades before launch. [PMC]. (The most vivid published figures come from SEO content pages — verify against your own field test rather than citing them as fact.)

3. **Warmer/colder map-tint legibility outdoors.** Sunlight readability needs high brightness *and contrast*; a full-screen red/blue tint reduces contrast when ambient light is already washing out the screen. **Mitigation: R3** (peripheral glow + haptic + audio instead of full tint; reserve strong visuals for the final approach). [GSMArena, AbraxSys].

4. **The AR catch.** AR fidelity is hard outdoors (lighting, tracking) and Pokémon GO players routinely disable it. **Mitigation: R4** — ship a satisfying 2D moment for v1; AR opt-in later. Don't gate the core reward on camera/AR working. [iMore].

5. **Safety / sending people to real places.** Niantic paid **$4M** to settle a trespass class action and agreed to **remove stops within 40 m of residences**, a complaint pipeline (95% in 15 days), and in-game warnings. Players have been injured, robbed (geo-lured), and worse. **Mitigation:** (a) **never place hunt endpoints on/within ~40 m of private residences** — bias to public landmarks/parks/streets; (b) respect business/park hours; (c) in-app "stay aware / obey signs / don't trespass" safety copy at quest start; (d) a fast report/removal channel; (e) avoid secluded endpoints, especially for any future night play. This is legal + ethical, not optional. [NYU JIPEL, Dexerto].

6. **AI content quality floor (Let's Roam's lesson).** Inconsistent hunt quality ("too basic," "vague instructions") is a top consumer-scavenger-hunt complaint and will scale with AI generation. **Mitigation:** quality gate on every generated quest (lore accuracy, clue solvability, route sanity, POI freshness) before it ships to a user. [PlayTours].

---

## Sources

- Pokémon GO catch mechanics — https://pokemongohub.net/post/guide/go-hub-guide-to-mastering-the-art-of-catching-pokemon/
- Pokémon GO UX reality check (UXPin) — https://www.uxpin.com/studio/blog/beyond-hype-ux-reality-check-pokemon-go/
- Pokémon GO UI review (Pixso) — https://pixso.net/tips/pokemon-go-ui/
- Pokémon GO AR+ mode (iMore) — https://www.imore.com/heres-how-pokemon-gos-new-ar-mode-works
- Pokémon Forums UI/UX feedback — https://community.pokemon.com/en-us/discussion/15016/feedback-ui-ux-design
- Adventure Lab App Store (4.9★/6.4K) — https://apps.apple.com/us/app/adventure-lab/id1412140803
- Adventure Lab reviews (justuseapp) — https://justuseapp.com/en/app/1412140803/adventure-lab/reviews
- Munzee App Store (3.7★) — https://apps.apple.com/us/app/munzee/id1367282248
- Munzee (Wikipedia) — https://en.wikipedia.org/wiki/Munzee
- Actionbound reviews — https://justuseapp.com/en/app/582660833/actionbound/reviews
- Scavenger-hunt app roundup (PlayTours) — https://www.playtours.app/post/all-in-one-guide-to-scavenger-hunt-app-reviews-from-g2-beyond
- Scavenger-hunt apps 2025 (PlayTours) — https://www.playtours.app/post/best-scavenger-hunt-apps-in-2025-ranked-by-features-pricing-reviews
- Atlas Obscura App Store — https://apps.apple.com/us/app/atlas-obscura-travel-guide/id1563250221
- Strava global heatmap — https://www.strava.com/maps/global-heatmap
- Strava Route Explore UX case study — https://jona-mcc.medium.com/strava-route-explore-d797850735bd
- Duolingo design breakdown (925studios) — https://www.925studios.co/blog/duolingo-design-breakdown
- Duolingo retention (Propel) — https://www.trypropel.ai/resources/duolingo-customer-retention-strategy
- Duolingo dark patterns commentary — https://tiinagolub.medium.com/lots-of-intersting-thoughts-here-ba20cf717201
- Geocaching "hotter or colder" forum — https://forums.geocaching.com/GC/index.php?/topic/391158-hotter-or-colder-game/
- AR geocaching (signal-strength hot/cold) — https://devpost.com/software/ar-geocaching
- Mobile game FTUE (Udonis) — https://www.blog.udonis.co/mobile-marketing/mobile-games/first-time-user-experience
- Mobile onboarding best practices (TechAhead) — https://www.techaheadcorp.com/blog/19-mobile-app-onboarding-best-practices-examples/
- Mobile onboarding examples (Plotline) — https://www.plotline.so/blog/mobile-app-onboarding-examples
- GPS drift in NYC urban canyons — https://www.alibaba.com/product-insights/why-does-my-phone-s-gps-drift-in-dense-urban-canyons-like-nyc-and-how-to-correct-it.html
- Urban-canyon positioning study (PMC) — https://pmc.ncbi.nlm.nih.gov/articles/PMC12349109/
- Sunlight-readable display nits (AbraxSys) — https://www.abraxsyscorp.com/how-many-nits-does-my-screen-need-for-sunlight-readability/
- GSMArena sunlight legibility test — https://www.gsmarena.com/gsmarena_lab_tests-review-751p2.php
- Pokémon GO trespass settlement (NYU JIPEL) — https://jipel.law.nyu.edu/pokemon-gos-virtual-trespass-suit-reaches-settlement-agreement/
- Niantic anti-trespass measures (Dexerto) — https://www.dexerto.com/pokemon/niantic-steps-up-efforts-in-trying-to-stop-pokemon-go-players-trespassing-1004519/
