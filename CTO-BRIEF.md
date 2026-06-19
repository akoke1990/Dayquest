# DayQuest — CTO Product Brief (Phase 1)

**From:** CPO · **Date:** 2026-06-19 · **Reads with:** `PRD-v1.md`, `PRD.md`
**Purpose:** translate the ratified product decisions into an engineering scope.
This brief states *what* and *why*; the CTO owns *how* (stack, schema, services).

---

## Context: what's already decided (don't re-open)
- **Discovery-first** — gamification (XP/levels/leaderboards) is P2+, **not MVP** (D-011, D-009).
- **Quest source = hybrid** — a **curated POI database is the source of truth**; **AI generates routes and assembles** adventures from it; AI never invents places (D-010).
- **Not a daily app** — weekly/occasional cadence; no daily-streak machinery (D-012).
- **Photo-only quests**, **NYC** launch, **anonymous** users in MVP (D-005, D-002).
- **The bet:** prove one hunt is *delightful and finishable*, then that people *return over weeks*. Engineering scope is judged against that, not feature count.

## What already exists (working prototype)
- **Expo app** (SDK 56): full loop — location → quest → list → GPS check-in (+ manual override) → photo → badge → shareable recap image.
- **Node API** (`/quest?lat=&lng=`) keeping keys server-side.
- **Quest engine** (`lib/quest.js`): gathers candidates → AI picks/curates by **id** → code joins ids back to authoritative records (anti-hallucination). **Photo-only.**
- **Data sources** (`lib/sources.js`): Wikipedia + OpenStreetMap, keyless, fault-tolerant.
- **Free preview mode** (templated, no AI) so we build at $0 and only spend on AI-quality validation.

**This means the core loop is built.** The CTO's job is not to rebuild it — it's to (a) make the stack call, (b) clear the validation gate, (c) build the curated-POI-DB layer that makes quests *non-generic*.

---

## DECISION 0 (CTO must resolve first): the stack
The CEO's earlier brief assumed **FlutterFlow + Firebase + Google Maps + OpenAI**.
The working prototype is **Expo + Node + Anthropic**. These diverge.

**CPO recommendation:** **Do not rebuild for Phase 1.** Extend the working
Expo/Node/Anthropic prototype to validate the bet. Reassess the stack for Phase 2
(retention layer) when we actually need managed auth/DB/storage/push — *that's*
where Firebase earns its keep. Rebuilding now throws away a working loop to
validate an unproven product. Decide consciously; don't default into a rewrite.

---

## The immediate gate (smallest possible next step)
Before any new build: **run real AI quests in NYC and review quality.** The code
already does this — it needs a funded API key (Sonnet 4.6 for cost). Output:
~10–20 quests across NYC neighborhoods, human-scored for *real / visitable /
accurate / interesting*. **If quality is weak, we fix the prompt + source before
building anything else.** This is hours, not days.

---

## Phase 1 build scope (after the gate)

### 1. The curated POI database (the real new work — our moat)
The thing that makes quests magical vs. generic. Requirements:
- A store of vetted points of interest for the launch area, each with: name, location, category/tags, a quality flag, a short curated blurb or sourced lore, and source/attribution.
- **Bootstrapped from open data** (Wikipedia/OSM) — *not* hand-entered from scratch — then **human-filtered/tagged/enriched**. Curation = quality layer on open-data breadth.
- A simple internal way for a human to review/approve/flag POIs (admin view or even a spreadsheet-to-DB pipeline for MVP — keep it cheap).
- AI assembly reads from this DB (preferred) and may fall back to live open-data where the DB is thin.

### 2. Quest generation pipeline (extend what exists)
- Input: user location (+ optional time/distance budget).
- Select nearby candidates from the curated DB → **AI assembles** a 3–5 stop walkable route with a theme, per-stop story hook, and a photo quest → return **ids**, join to authoritative records server-side.
- Keep the **id-join anti-hallucination** pattern. Keep keys server-side. Add **response caching by area** to control cost as usage grows.

### 3. Check-in & photo (already built — harden)
- **Geofencing = client-side proximity** (~100m) with a **mandatory manual override**. No server-side geofencing needed for MVP.
- **Photo = capture + attach only.** GPS confirms arrival; the photo is the keepsake. *(See cut below.)*

### 4. App
- Add: quest **preview**, **pause/resume/abandon**, **time/distance fit**, and a fast **magic-moment onboarding**. Map is **P0**.

---

## Explicitly OUT of Phase 1 (do not build)
- **AI photo verification** — the CEO's original list included it; **cut.** GPS check-in + a captured photo is sufficient. Verifying that a photo "matches" the place is costly, error-prone, and adds friction for near-zero MVP value. Revisit only if we see check-in fraud, which is irrelevant pre-PMF.
- **Leaderboards, XP, levels** — P2+ (D-009). No social graph density at launch; empty boards demotivate.
- **Accounts/auth** — minimal/anonymous in MVP; full accounts arrive with the Phase 2 retention layer.
- **Push notifications** — Phase 2 (occasion-triggered, not daily).
- **Friend/group quests, messaging, marketplace, UGC** — later.

---

## Technical decisions the CTO owns (please propose)
1. **Stack** (Decision 0) — extend Expo/Node, or migrate? With rationale.
2. **Where the curated POI DB lives** and the cheapest viable ingest+review workflow.
3. **Caching strategy** for generated quests (by geo-cell?) to cap API cost.
4. **Minimal persistence** needed for Phase 1 vs. deferred to Phase 2 (we may need almost none — quests can be ephemeral until accounts exist).
5. **AI provider** — prototype is Anthropic; the CEO brief said OpenAI. Pick one and note why (cost/quality/structured-output support).

## Suggested sequence
1. Decide stack (Decision 0).
2. Clear the validation gate (run + score NYC quests). ← *blocks everything; do first*
3. Build the curated POI DB + wire AI assembly to it.
4. Harden app (preview/resume/time-fit/onboarding/map).
5. Ship to ~50–100 NYC testers; instrument the North Star.

## Open question back to CPO/CEO
- Launch neighborhood(s) for the curated DB seed — start with **1 NYC neighborhood** done *excellently* (recommend Greenwich Village or Financial District) rather than all of NYC done thinly?
