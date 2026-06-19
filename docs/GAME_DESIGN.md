# DayQuest — Game Design

*Lead design spec for the progression / reward / retention systems.*
Audience: the founder + whoever builds the screens. Written to be built **cheaply** and **incrementally** on top of the existing quest generator.

---

## 0. The core idea (read this first)

Pokémon Go made you collect a fictional bestiary. **DayQuest makes you collect the real world.** Every stop the generator already returns carries a `place.kind` (statue, park, mural, church, bridge…), a `source` (Wikipedia/OSM), `lore`, and `distance_m`. That taxonomy *is* a Pokédex of physical places. We don't have to invent collectibles — they're already in the data.

Three product pillars, each borrowed from a proven game:

| Pillar | Borrowed from | What it does | Works where data is… |
|---|---|---|---|
| **Collect the world** | Pokémon Go | Place-kind collections + rarity reveal | …dense (cities) |
| **Effort & you-vs-you** | Strava | Distance/steps XP, route records, re-walks | …sparse OR dense (needs no POIs) |
| **Show up daily** | Duolingo | Streaks, daily quest, freezes | …anywhere |

The Strava pillar is load-bearing. It's the only one that produces a rewarding session for a user in a small town with 3 nearby places — and it's what brings a city user back after they've "caught" their whole neighborhood. **If a low-density user can't have a good day-1 and a city user can't have a good day-30, the design has failed.** Every system below is checked against both.

---

## 1. XP — the universal currency

XP is earned from **three independent sources** so that *someone always has something to earn*, regardless of where they are.

**A. Discovery XP** (POI-dependent — the Pokémon Go engine)
| Event | XP | Notes |
|---|---|---|
| Check in at a stop (GPS verified) | 20 | The atomic action |
| Read the lore (tap "the story") | +5 | Rewards curiosity, the thing that makes us not-just-Strava |
| Photo submitted for a photo-quest | +10 | |
| **First-ever** check-in at a place | +50 | The "gotcha!" hit — only once per place, ever |
| New **place-kind** added to collection | +100 | First statue, first lighthouse, etc. |
| Rarity bonus | ×1 / ×2 / ×4 / ×8 / ×16 | by tier (see §5) — applied to the check-in |
| Complete a full quest (all 3 stops) | +75 | Loop bonus, encourages finishing |

**B. Effort XP** (POI-free — the Strava engine, works literally anywhere)
| Event | XP |
|---|---|
| Per 100 m walked on an active quest | +1 |
| Daily step milestone (2k / 5k / 10k) | +25 / +75 / +200 |
| Beat your own time on a re-walked loop (a "PR") | +50 |

**C. Bonus XP** (engagement multipliers)
- **Streak multiplier** (see §8): ×1.0 → ×2.0 on *all* XP.
- **Daily-quest-of-the-day** completion: +100 flat.

> **Anti-farming.** Check-in XP at a place you've already collected decays: 20 → 10 → 5 → 1 on repeat visits. First-visit and new-kind bonuses fire **once, ever**. This stops someone grinding the same park bench. Effort XP has a daily cap (e.g. 500) so you can't drive around racking up distance.

> **Cheap to build.** All of A/C is computed client-side from data the app already has (the quest JSON + the GPS check-in event). Only rarity (§5) needs the server, and that's a cached lookup.

---

## 2. Levels — "Explorer Rank"

A gentle, never-ending curve. Levels are **identity + unlocks**, not gates that block play.

**Curve:** XP to reach level *n* = `100 × n^1.6` (rounded). So:

| Level | Title | Cumulative XP | Unlocks |
|---|---|---|---|
| 1 | Wanderer | 0 | — |
| 3 | Stroller | ~900 | Rarity reveal turns on (places show their tier) |
| 5 | Pathfinder | ~2,800 | Daily quest length can grow to 4 stops |
| 10 | Explorer | ~13k | Choose a quest *theme* (history / nature / art) |
| 15 | Pioneer | ~32k | "Free roam" — generate a quest anywhere, off the daily |
| 25 | Cartographer | ~110k | Custom quest length (3–6), share a route with a friend |
| 40+ | Voyager → Legend | — | Prestige cosmetics, profile flair |

Rationale: early unlocks (rarity at L3) come fast to hook; later ones are about *agency* (themes, length, sharing) — the Strava-style "the app gets more yours over time." No unlock ever removes content; a new user still gets the full delight on day one.

---

## 3. Collections — the heart of it

This is the most distinctive system and the strongest retention driver in dense areas. **Two collection dimensions:**

### 3a. The Kinds Codex (a real-world Pokédex)
Every `place.kind` is a collectible slot. The generator already emits these from OSM/Wikipedia (`public art (statue)`, parks, etc.). We define a curated set of ~40–60 **canonical kinds**, mapping raw OSM tags onto them:

> Statue · Mural · Fountain · Bridge · Lighthouse · Clock tower · Church · Synagogue · Temple · Cemetery · Castle/Fort · Park · Garden · Pier · Waterfall · Cave · Summit · Historic house · Theater · Library · Market · Diner/Classic eatery · Mosaic · Memorial · Observatory · Windmill · Covered bridge · Ruins · …

Each is a card: greyed-out silhouette until you check in at one, then it flips to reveal your *first* example, a count ("you've found 7 statues"), and the best lore you collected. **"Gotta find 'em all"** — but of the real world.

### 3b. Neighborhood / Region maps
A second axis: places grouped by **area** (derived from the quest `origin.label` or reverse-geocoded). "You've explored 4 of ~30 notable spots in Greenwich Village." A faint completion ring per neighborhood you've touched. This rewards *going deep locally* (good for everyone) and *going wide* (travelers light up new regions).

### 3c. Sets (curated mini-collections)
Hand-authorable themed sets that span kinds — cheap content the founder can add as JSON: "The Five Boroughs' Oldest Bridges," "NYC Speakeasy Doors," "Hidden Animal Statues." Completing a set = a badge + XP + a cosmetic. These are how you keep collections fresh without writing code.

> **Replayability note:** collections in your home area *do* fill up. That's fine — that's when the Strava pillar (§7) and seasonal sets (§6) take over. Collections are the **acquisition** phase; effort/streaks are the **retention** phase.

---

## 4. Badges — milestone achievements

Badges mark *behaviors*, not just collection counts, so there's always a near-term one to chase. Three families:

- **Onboarding (fast dopamine):** First Quest · First Photo · First Story Read · First Streak (3 days).
- **Mastery (long tail):** Statue Hunter (10/50/100 statues) · Bridgewalker · Night Owl (5 dusk/dark check-ins) · Early Bird · Globetrotter (5 regions) · Completionist (finish a neighborhood) · Hidden-Gem Hunter (find 10 Rare+ places, see §5).
- **Effort (Strava-style, POI-free):** 5 km in a day · 50 km lifetime · 7-day streak · 30-day streak · Personal-best on 10 routes.

Tiered (bronze/silver/gold) where it makes sense, so one badge line gives months of pull. Badges are pure client-side counters over the event log — trivial to build, no backend.

---

## 5. Rarity — make discovery thrilling (and honest)

The advisor's key catch: **fame and rarity are opposites.** The Eiffel Tower is famous but everyone can reach it; the weird little forgotten statue down an alley *feels* rare but Wikipedia barely knows it. So we use **two axes**, not one number:

### Axis 1 — Renown (how celebrated)
Computed server-side, cached per place forever (compute once, never per-quest):
- Wikipedia **monthly pageviews** (free Wikimedia REST batch call).
- Article **length / extract size** (already returned with the lore — free).
- OSM `wikipedia`/`wikidata`/`heritage` tags present.

Renown drives **"Wonders"** — a separate prestige collection of celebrated landmarks. High-renown places get a gold frame and a "Wonder" tag. This is the *bucket-list* feeling.

### Axis 2 — Scarcity (how hidden-gem)
- **Inverse** of renown (low pageviews / short or no article = more hidden).
- **Isolation:** few other candidates nearby (`candidate_count` low / large `distance_m`).
- Has lore but low fame = the sweet spot: a *story nobody knows*.

Scarcity drives the **Common → Uncommon → Rare → Epic → Legendary** tier shown on check-in, with the XP multiplier (§1) and a reveal animation. Finding a "Legendary hidden gem" — a storied place almost no one visits — is the single most shareable moment in the app.

> Why two axes is *better* product: a user in a small town has **no Wonders but plenty of hidden gems** — their rare-find dopamine is intact even with zero famous landmarks nearby. Rarity stops being a big-city privilege.

**Tier thresholds** (tune later): score each place 0–100 on each axis; Legendary = top ~3% scarcity, etc. Start with simple percentile cutoffs over your candidate pool; refine with real data.

---

## 6. Quests — daily & seasonal

### 6a. Daily Quest (the habit)
The existing 3-stop generated hunt, refreshed once per day per user, is the **Daily Quest**. Completing it: big XP, advances the streak, +100 daily bonus. One per day keeps it a *ritual*, not a grind. A "re-roll" (generate a different one) is a Level-15 unlock or a small earned token, so it stays special.

**Sparse-area fallback (critical — see §9):** if the generator can't assemble 3 storied stops within walking distance, the Daily degrades gracefully to a mix of *micro-quests* and *effort quests* (defined in §9) so **every user, everywhere, gets an openable daily session.**

### 6b. Seasonal Quests (the calendar)
Multi-week themed events the founder authors as JSON — no code per event:
- **Spooky Season (Oct):** find 5 cemeteries / gothic churches / "haunted" lore places → exclusive badge + frame.
- **Bloom (Spring):** parks, gardens, blossoming trees.
- **Hidden Histories (Feb):** high-scarcity, high-lore places only.
- **Summit Summer:** elevation/effort-themed, Strava-flavored.

Seasonal quests are the **replayability engine for collected areas** — they re-surface the same neighborhood through a new lens ("you've been to this cemetery, but not *at dusk in October*"). They also create natural FOMO + return cadence. Keep them light: a themed checklist + a time-boxed badge + a leaderboard (§ layer-3). No new tech.

---

## 7. The Strava layer — effort, routes & you-vs-you

This is what makes DayQuest work in a cornfield **and** on day 300 in Brooklyn. None of it needs a POI.

- **Routes are re-walkable.** A completed quest loop is saved as a **Route**. Re-walk it → the app times you and tracks a **personal best**. "Beat your time" = XP + a PR badge. Suddenly a place you've "collected" is replayable.
- **Effort XP & step milestones** (§1B) accrue from movement alone.
- **Segments (later):** notable path stretches ("the river walk") with private leaderboards — you vs. your past self first, friends optional.
- **Weekly effort goal:** a Duolingo-style "explore 3 days this week" ring, satisfiable by *any* activity. This is the universal retention floor.

> Design stance: collection is the **honeymoon**, effort is the **marriage**. Build the honeymoon to hook, but the effort layer is why anyone stays.

---

## 8. Streaks — the daily-return ritual

Straight from Duolingo, because it works:
- A **streak** = consecutive days with ≥1 check-in *or* an effort-quest completion (so it's keepable even with no POIs nearby — important).
- **XP multiplier** scales with streak: ×1.0 (day 1) → ×1.5 (day 7) → ×2.0 (day 30, capped). Visible on the home screen — losing it should *hurt*.
- **Streak Freeze:** one auto-freeze, earned every 7-day streak (not sold). Forgiveness prevents the rage-quit when a real life day happens.
- **Milestones:** 3 / 7 / 30 / 100 / 365 days → badges + cosmetic flair. The 365 "Year of Wandering" badge is the long-term north star.

---

## 9. The cold-start problem (the make-or-break section)

A suburban/rural user's Wikipedia+OSM walking radius might return **3 candidates, or 0.** Without a fix, daily quests can't assemble, collections never fill, and rarity is meaningless. Solution: **three tiers of content that degrade gracefully**, plus the always-on effort layer.

1. **Tier 1 — Storied quest (dense areas).** What exists today: 3 real lore-rich stops. Best experience.
2. **Tier 2 — Micro-quests from generic OSM features.** When storied POIs are thin, generate stops from *ordinary* mapped features that exist almost everywhere: "the oldest building on this street," "a notable tree," "an interesting front door / façade," "the highest point you can see," "a mural or painted wall." OSM has these tags broadly; Claude writes a small observational prompt. Lore-light but *exploration-rich*. These still grant collection kinds (Tree, Façade, View…).
3. **Tier 3 — Anywhere quests (zero POIs needed).** Pure sensory/observation + effort prompts: "walk 10 minutes in a direction you've never gone and photograph one thing that surprised you," "find something older than you," "follow the sound of water." Powered entirely by the **effort engine** — distance, photo, streak. Works in a desert.

**The rule:** the Daily Quest generator tries Tier 1 → 2 → 3 and always returns *something worth opening the app for*. The effort/streak XP (§1B, §8) underwrites every tier, so progression never stalls on geography.

> This is also the cheapest possible content pipeline: tiers 2–3 are prompt templates, not new infrastructure.

---

## 10. Anti-cheat & economy (keep it honest, keep it cheap)

- **GPS check-in already exists** — that's the core integrity gate. Keep the manual override but flag override-heavy accounts; don't punish (offline GPS is genuinely flaky).
- **Rarity is server-computed & cached** — the client can't fabricate a Legendary.
- **XP decay + daily effort cap** (§1) kill the obvious grinds.
- **No pay-to-win, minimal economy.** Optional cosmetics / extra re-rolls / streak freezes could monetize later, but the MVP has *no store* — every reward is earned. Simpler to build, better for trust.

---

## 11. Build order — what to ship first

Eight systems, sequenced for a non-technical founder building cheap. **Don't build them flat — build the loop, prove retention, then layer.**

### MVP core loop (build these first — this is the whole game in miniature)
1. **XP** (sources A + C, client-side) — §1
2. **Levels / Explorer Rank** — §2
3. **Streaks** (+ multiplier, + one freeze) — §8
4. **Kinds Codex** collection (§3a) — the signature feature
5. **Rarity reveal** — start with **scarcity axis only**, simple percentile cutoffs; Renown/Wonders later — §5
6. **Cold-start Tiers 1–3** in the generator — §9 *(this is infrastructure, not polish — without it half your users bounce; build it alongside the loop)*

> Ship this and you have a genuinely fun, retentive game that works everywhere.

### Layer 2 (after the loop proves out)
7. **Effort XP + Routes + PRs** (Strava engine) — §1B, §7 *(promote earlier if early users are rural)*
8. **Badges** (counters over the existing event log) — §4
9. **Neighborhood maps** (§3b) + **Renown/Wonders** second rarity axis (§5)

### Layer 3 (retention & virality, once there's a base)
10. **Seasonal quests** + curated **Sets** (founder-authored JSON) — §6b, §3c
11. **Segments / leaderboards / friend route-sharing** — §7

---

## 12. The one-sentence test

> **A user in a small town opens DayQuest on a Tuesday in February and a user in Brooklyn opens it on day 300 — do both have a session worth their time?**

- Small-town Tuesday: a Tier-2/3 micro-quest, effort XP toward a step milestone, a streak to protect, maybe a Rare *hidden gem* nobody's logged. ✅
- Brooklyn day 300: home collection's full, but there's a re-walkable Route PR to beat, a Seasonal "Hidden Histories" set re-framing known places, and a 300-day streak that would *hurt* to lose. ✅

If both stay true as you build, the design is working.
