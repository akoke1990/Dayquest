# DayQuest — Product Vision & MVP PRD (v1.1)

**Owner:** CPO · **Date:** 2026-06-19 · **Status:** Revised cut; 2 decisions open
Supersedes v1. Companion strategy doc: `PRD.md`.

---

## Mission

Help people rediscover the world around them through real-world adventures.
DayQuest turns ordinary places into meaningful experiences — exploration,
movement, discovery, storytelling — and aims to become the **go-to way to get
outside and explore** — a natural weekend/occasional ritual, not a daily one.

## Problem

People consume huge amounts of digital content and explore the physical world
very little. They're bored, isolated, under-moved, and short on ideas for what to
do nearby. Fitness apps track movement, travel apps suggest destinations, games
entertain — none make *going outside near home* feel like an adventure.

---

## The one question this PRD answers: **why will someone come back tomorrow?**

The honest answer — and the spine of the whole product:

1. **Discovery (foundation):** yesterday showed them something genuinely cool and
   nearby they didn't know existed. This is intrinsic and non-fakeable.
2. **Ritual (foundation):** it was a pleasant, low-effort 30-minute experience
   that felt good to do.
3. **Pull (amplifier):** a reason *this weekend* — or whenever they have a free
   few hours — is different: a fresh quest, a weekly streak, something to collect,
   a well-timed nudge.

**Expected cadence: weekly / occasional, not daily.** (D-012.) We design for the
weekend afternoon, the date, the visiting friend, the "I'm bored" Saturday — not
a daily streak. This *raises* the bar on quest quality (fewer shots to impress)
and on staying top-of-mind across gaps, and it reframes our retention mechanics
(weekly streaks, occasion-triggered nudges — not daily ones).

**Mechanics (XP, levels, leaderboards, collectibles) only amplify a loop that
already has #1 and #2. They cannot rescue a generic core.** Therefore our
sequencing is non-negotiable: **prove discovery + ritual first, then layer the
pull mechanics.** Building the game layer on an unproven walk is the single most
expensive mistake we could make.

This makes **quest quality the product**, which makes the *quest-source decision*
(below) the most important call we will make.

---

## North Star: Completed Quest Days

The number of days a user completes ≥ 1 quest. Chosen deliberately over "DAU" or
"engagement" — our goal is people **in the real world having experiences**, not
screen time. Every roadmap item is judged by whether it grows Completed Quest Days.

---

## Core user journey (MVP)

1. Open DayQuest.
2. (Optional) pick a **vibe + time budget** ("I have 30 min / curious").
3. Get a **3–5 stop** quest near you, with a title and a real reason to go.
4. **Preview** it (distance, time, stops) → start.
5. Walk to each stop → **GPS confirms arrival** (manual override always available).
6. **Photo / small challenge** at each stop → stop complete.
7. Finish → **badge + recap + shareable card**. Pause/resume anytime.

Solo only in MVP. (Friend/Group quests are a different, harder product — deferred.)

---

## MVP scope

### In — P0 (this is the loop we're testing)
- **Quest generation** from our hybrid source (see Keystone Decision) — 3–5 walkable, varied stops, each with a **story hook** and a photo quest.
- **Map + list** of stops with distance/time. *(Navigation is core — promoted to P0.)*
- **GPS check-in** + **manual override**.
- **Photo capture** per stop.
- **Quest preview, pause/resume, abandon** — protects completion rate against real-world interruptions.
- **Time/distance fit** ("30 min vs 2 hours") — the biggest personalization lever; bigger than mood.
- **Completion: badge + recap + shareable image.**
- **Anonymous use** (lightweight account only if needed to persist progress for the daily loop test).
- **Fast "magic moment" onboarding** — deliver one delightful stop before asking for anything, so users "get it" in the first session.
- **Content safety/quality gate** — rules + human review so every served stop is real, public, open, and safe.
- **Analytics** instrumenting the North Star and the funnel.

### Out of MVP — deferred to the retention layer (P1) or later
- **Push notifications** → P1 (Phase 2). Occasion-triggered (weekend / good weather / "been a while"), **not** daily — the lever that keeps a *non-daily* app top-of-mind. Not needed to prove Phase 1 (is one hunt fun?).
- **XP + levels** → P1. Hollow numbers until there's depth to progress *through*; add once content/collection depth exists.
- **Leaderboards** → P1+. Need a social graph and density we won't have; empty leaderboards *demotivate*.
- **Friend / Group quests, social feed** → Later. Different product; multiplayer cold-start is brutal.
- **Mood selector** → fold into the simpler vibe+time picker; expand later.
- **Strava / Apple Health / step tracking** → Later. Setup friction + integration cost before the core is proven; we can *claim* the fitness benefit without integrations on day one.
- **Multiple quest types** beyond photo → P2.
- **User-generated quests, marketplace, premium, sponsored, tourism** → Later.

---

## Keystone decision (RESOLVED — D-010): where do quests come from?

**Hybrid — AI assembles adventures over a curated POI database:**
- **Curated POI database** of high-quality, vetted points of interest — the quality floor and our moat.
- **AI generates routes** and **assembles adventures** from those points: walkable order, the story hook, the photo quest.
- **Quality/safety gate** before a POI enters the DB (real, public, open, safe).
- **User-generated: later** (cold-start + moderation).

**How we keep the DB lean (CPO note):** we **bootstrap it from open data**
(Wikipedia + OSM, already working) and have a human **filter, tag, and enrich**
the best entries — not hand-enter every POI from scratch. Curation is the
quality layer on top of open-data breadth, so the DB scales city-to-city without
a manual content army. The curated DB is the source of truth; AI is the
assembler, never the inventor of places.

## Strategic fork (RESOLVED — D-011): Discovery-first vs Game-first

Two coherent products with different MVPs:
- **Discovery-first (CPO recommends):** the magic is interesting places + stories; gamification is light seasoning layered in P1+. Cheaper to prove; matches the "why return" analysis.
- **Game-first:** DayQuest is a real-world RPG; XP/levels/collection/leaderboards are the engine and must be in MVP to test. Bigger build, bigger bet.

**Resolved: discovery-first.** Gamification (XP/levels/leaderboards) is a P2+
amplifier, built only after the discovery loop proves fun. v1.1 reflects this.

---

## Revised MVP roadmap

| Phase | Goal (what we're proving) | Build |
|---|---|---|
| **0 — Decide & validate** | Resolve quest-source + the fork; confirm AI quality | Keystone decision; run real AI quests across NYC; quality review |
| **1 — Prove the magic** | *Is one hunt delightful and finishable?* | Hybrid generation, story hooks, map+check-in+override, photo, preview/resume, time-fit, completion+share, analytics. ~50–100 NYC testers. |
| **2 — Prove the return** | *Do Completed Quest Days/month hold over weeks?* | Accounts, **occasion-triggered push**, **weekly** streaks, badge/collection. Build **only if** Phase 1 delight is real. |
| **3 — Amplify** | Deepen the habit | XP/levels (now there's depth), light share-to-pull social, themes |
| **4 — Revenue/scale** | Make it a business | Premium, sponsored stops, tourism partnerships, multi-city, UGC |

---

## Success metrics
- **Activation:** ≥ 40% of installs complete their first full quest.
- **Quality (pre-launch):** ≥ ~90% of generated stops real/visitable/accurate (human review).
- **Return (the bet):** Completed Quest Days per user **per month**; % who come back for a 2nd quest within ~2–4 weeks; week-4 retention. (Weekly/occasional cadence — *not* daily.)
- **Delight:** share rate; post-quest 👍/👎.
- **Effort/payoff:** quest completion rate + median stops completed (abandonment signal).

## Top 5 churn risks (designed against in this PRD)
1. Quests feel generic/samey. → hybrid source + hero anchors + story hooks.
2. Effort > payoff. → time-fit, strong reward moment, tight walkable loops.
3. Ran out of good nearby content. → content depth tracking; expand radius/themes.
4. No reason to come back. → occasion-triggered nudges + weekly streaks + fresh content (P2).
5. Forgotten between uses (the real risk for a non-daily app) + lonely empty social. → occasion triggers, a memorable artifact each time, share loop; defer social until density exists.
