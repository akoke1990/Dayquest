# DayQuest — UX / Experience Design Spec (v1)

**Owner:** UX/Product Design · **Date:** 2026-06-19 · **Status:** Decision-grade, for Phase 1 build
**Scope:** MVP v1 only. Discovery-first, photo-only, solo, anonymous, NYC. Builds on the existing app (`app/App.js`) and the warm cream/ink/terracotta palette (`CREAM #f4f1ea`, `INK #2b2622`, `ACCENT #b5562e`, `GREEN #4a7c59`).
**North Star:** Completed Quest Days. Every screen below is judged by whether it moves someone from "open app" → "finished a hunt" → "wants to do it again / shares it."

**Deliberately NOT in this spec** (per PRD): no account/login gate, no social feed, no map of friends, no XP/levels/leaderboards, no push. We stay anonymous and solo. Where a choice trades simplicity for completeness, we choose simplicity — this is an MVP to test one question: *is one hunt delightful and finishable?*

---

## 0. The three corrections this spec makes to the current build

The current app (`App.js`) is a strong skeleton but has three gaps against the PRD:

1. **No map.** It's a distance list. The PRD promotes navigation to P0 ("Navigation is core"). We add a lightweight map.
2. **No pause/resume/abandon.** Also P0 (protects completion rate against real-world interruption). We make progress durable and resumable.
3. **It asks before it delights.** `startQuest()` fires the OS location permission prompt the instant "Start a Quest" is tapped (App.js:61). The PRD demands the user "get it" *before being asked for anything.* We fix this in §2.

And one finding that changes the **engineering quest-assembly rules**, not just the UI — see §4.

---

## 1. End-to-end flow (MVP v1)

Seven states. Lean on purpose. Each: **purpose · key content · primary action.**

### 1.1 Welcome (delight-first, no permission yet)
- **Purpose:** Make a stranger feel "oh, this is cool" in under 5 seconds, with zero asks.
- **Key content:** Logo + tagline ("Find a little adventure near you."). Below it, a live **teaser card** for a real, nearby, surprising place — a photo (or warm illustration), the place name, and one brag-worthy fact. (See §2 — this is the magic moment.)
- **Primary action:** `Start a Quest`. Tapping this — and *only* this — triggers location permission, framed by an inline one-liner: *"We'll use your location to find places to explore — only while you're on a quest."*
- Secondary (only when returning mid-quest): `Resume your quest` appears above the fold if a quest is in progress.

### 1.2 Vibe + time-budget pick (optional, skippable, one screen)
- **Purpose:** The single biggest personalization lever is *time fit*, not mood (PRD). Capture it in one light tap; let people skip.
- **Key content:** Two small chip rows. **Time:** `~30 min` (default, pre-selected) · `~1 hr` · `Surprise me`. **Vibe (secondary, optional):** `Storied / historic` · `Green / nature` · `Architecture` · `Anything`. A `Skip → just give me one` link is always present and equally weighted.
- **Primary action:** `Find my quest`. (Skipping = default 30 min / Anything.)
- **Lean note:** this screen must never feel like a form. Defaults are pre-selected so the fastest path is one tap. It appears *after* permission is granted, while the quest builds in the background — so the pick costs the user no extra wait.

### 1.3 Quest overview / preview
- **Purpose:** Earn the "yes, I'll walk this." Set honest expectations so people don't abandon mid-walk.
- **Key content:**
  - Theme title + 1-line intro (e.g. *"Arches, Elms & Bohemian Echoes"* / the Greenwich Village intro from `quest.json`).
  - **At-a-glance bar:** `3 stops · ~0.8 km loop · ~35 min` (computed, honest — see §4) plus a one-word terrain cue (`flat`).
  - **A real map** showing the numbered stop pins, the walking route line, and a "you are here" dot. This is the navigation surface (P0). List of stops sits below the map as preview cards (name + one-line reason + walk time to next).
  - A short "what you'll do" line: *"Walk a loop, snap a photo at each spot, collect the story."*
- **Primary action:** `Start exploring`. Secondary: `Show me another` (regenerate) — cheap insurance against a quest that doesn't appeal.

### 1.4 Stop detail (the active screen)
- **Purpose:** Get the user to the next pin, and make arrival feel earned.
- **Key content:** One focused stop at a time (not the full scroll list):
  - Map snippet with the route to *this* pin + **live distance** ("169 m away") and a direction/heading cue.
  - Stop name, the **story hook** (`lore_hook`) — this is the discovery payload, give it room and good typography — and the **photo prompt** in its own box (e.g. *"Stand at the base and shoot straight up the trunk…"*). The prompt is what turns a glance into a *look*.
  - Progress chip: `Stop 2 of 3`. A pause/menu affordance (§1.7).
- **Primary action:** contextual, single button that morphs by state: `Walk closer to check in` (disabled, distance shown) → `Check in here` (in range) → `Take your photo` → `Next stop →`.
- A persistent, visible `Can't check in? I'm here →` override (see §5).

### 1.5 Arrival / check-in
- **Purpose:** Mark the threshold of discovery — the small "ding, you made it" beat.
- **Key content:** When GPS confirms arrival (or override), a brief, warm confirmation: a subtle haptic + the hook re-surfaced ("You found Manhattan's oldest living thing"). This is a *moment*, not a modal — keep it 1 second, then reveal the photo CTA.
- **Primary action:** `Take your photo`.

### 1.6 Photo capture → stop complete
- **Purpose:** Create the artifact (the social/keepsake currency) and confirm progress.
- **Key content:** Native camera (current behavior, App.js:87 — camera-first, library fallback is correct). On return: the user's photo, a green ✓, and a one-line "nice shot" affirmation + the next stop's name and walk time.
- **Primary action:** `Next stop →` (or `Finish` on the last stop). Allow a quiet `retake`.

### 1.7 Pause / resume / abandon (P0, currently missing)
- **Purpose:** Real life interrupts a 30-minute walk. Don't let an interruption become an abandon.
- **Behavior:** Progress (`checkedIn`, `photoUri` per stop) persists to local storage so the quest survives an app close. A pause control in the stop-detail header opens a small sheet: `Resume` · `Take a break (saved)` · `Abandon quest`. On reopen, Welcome shows `Resume your quest` (§1.1). Abandon asks one gentle confirm and is logged for analytics (abandonment signal).

### 1.8 Completion → recap + shareable card
- **Purpose:** The reward moment *and* the growth loop. See §3 — this is the highest-leverage surface.
- **Primary action:** `Share my adventure`. Secondary: `Start a new quest`, and a `👍 / 👎` one-tap delight signal (PRD success metric).

---

## 2. The magic-moment onboarding

**Goal:** A first-timer feels delight *before being asked for anything* — no permission wall, no form, no empty state.

**The core problem to fix:** today, the first tap = an OS location dialog (a system-modal ask, the least delightful possible first impression). We invert the order: **show, then ask.**

**The move — "one delightful place, free, up front":**

1. **On first open, the Welcome screen renders a live teaser card** for one genuinely surprising place. We can place a coarse, **permission-free** teaser by IP-region (NYC) or by serving a curated "hero" place for the city — no precise GPS needed. Example payload, straight from our real quest: a photo of **Hangman's Elm** with the line *"Manhattan's oldest living thing — an English elm that's been standing 300+ years, right in Washington Square."* That single fact does the work: it reframes a tree the user has walked past into something worth seeing.
2. **The card is the hook, not chrome.** It says, implicitly: *DayQuest knows cool things about where you are.* That is the entire value prop, delivered in one card, for free, before any ask.
3. **Only when the user taps `Start a Quest`** do we request location — and we frame *why* in human words inline first ("…only while you're on a quest"), so the OS dialog lands as a confirmation of something they already want, not a cold gate.
4. **The first stop is engineered to be the payoff.** Quest assembly should lead with the strongest "hero" anchor so the very first arrival in a user's first session is the most impressive one. Front-load the wow; don't save it for stop 3.
5. **Zero-fork path:** the fastest possible run is `Start a Quest` → (permission) → `Find my quest` (defaults pre-picked) → overview → walk. No required typing, no account, ever.

**The test for onboarding:** if a user could close the app after the Welcome screen and still tell a friend one cool fact about their neighborhood, onboarding succeeded — even if they never started a quest.

---

## 3. Completion recap + shareable card (the growth loop)

This is the single highest-leverage surface in a discovery app: a free, organic acquisition channel that costs us nothing per post. The current recap (App.js:158–185) is a **keepsake** — it commemorates for the user. We need a **magnet** — something a *stranger scrolling past it* wants to chase. Different job, different design.

### What's wrong with the current card (be specific)
- **Inward framing:** *"I explored 3 storied places near Greenwich Village."* That's a diary entry. It tells a viewer nothing about *what they'd get.*
- **Equal tiny thumbnails (84×84):** the user's own photo — their best shot, the actual social currency — is shrunk to a stamp among equals. The hero of the card should be the human's photography, not a grid.
- **No identity hook:** a viewer can't tell *where this is* or *that it's repeatable.* No pull.

### The test for every element on the card
> *Does this pull in a non-user, or does it only commemorate for the user?* Hero photo, fact-caption, and quest identity pull. A badge emoji and a thumbnail grid only commemorate.

### Spec — what the shareable card contains
- **Frame:** **9:16, story-native** (Instagram/TikTok Stories, the dominant share surface). The in-app recap can stay portrait-card; the *exported image* is 9:16.
- **Hero:** the user's **best/featured photo**, full-bleed, large. (Let the user pick which of their stop photos is the hero; default to the first completed.) Their photography is the thing strangers respond to.
- **Caption — a brag-worthy fact, not a tally.** Pull the most striking `lore_hook`/`reason` of the quest as an overlaid line: *"I found Manhattan's oldest living thing — 300+ years old."* This is what makes a viewer stop scrolling.
- **Quest identity (the pull):** quest name + neighborhood — *"Arches, Elms & Bohemian Echoes · Greenwich Village, NYC."* A viewer must be able to think *"where is that? I want to do that."* This is the line that converts a viewer into a user.
- **Journey proof:** a small **route map trace** with the numbered stops — visual evidence it was a *walk/expedition*, not one selfie. (Reinforces the product is about movement and discovery.)
- **One personal stat, lightly:** `3 stops · 0.8 km explored` — small, bottom corner. Proof of effort without turning it into a fitness flex.
- **Brand mark:** small, classy `DayQuest` wordmark in `ACCENT` (keep the existing restraint). Not a watermark splat — a signature.
- **Secondary stops:** the other photos appear as a small filmstrip *below the hero*, not as co-equals.

### Mechanics
- Keep `captureRef` → `Sharing.shareAsync` (App.js:110). Add the 9:16 export layout.
- **Frictionless share, no account:** one tap to the native share sheet. Never gate sharing behind sign-up.
- **Measure:** share rate is a PRD delight metric — instrument open-share-sheet and (where the OS allows) completed share.

---

## 4. Walkability / spread — the load-bearing call

**Question:** is clustering three monuments around one square fine, or should a quest feel like a walk across a few blocks?

**Answer: clustering is not fine — and our real generated quest is broken under our own arrival mechanic.** This is a measured finding, not taste.

### The evidence (computed from `quest.json` + `App.js`)
`distance_m` in the JSON is **distance-from-origin**, not stop-to-stop. The actual **pairwise inter-stop distances** are:

| Pair | Distance |
|---|---|
| Arch → Elm | **150 m** |
| Arch → Church | **149 m** |
| Elm → Church | **187 m** |

Total walked path (Arch → Elm → Church): **337 m** — under a 5-minute stroll.

The check-in radius is **`CHECKIN_RADIUS_M = 100`** (App.js:20), i.e. a **200 m-diameter** arrival zone per stop. At 150–187 m separation, **every stop's check-in zone overlaps its neighbors'.** Concretely: a user can often satisfy "you're here!" for stop 2 while still standing at stop 1. The core arrival mechanic — *walk closer → check in → arrive* — barely engages. Arrival stops feeling earned. The "expedition" the PRD sells collapses into "stand in a square and spin."

**Engineering takeaway (one sentence):** the quest-assembly rule must change — this quest would never pass the spread gate below, and the fact it was generated as our flagship example means the assembler currently has no spread constraint at all.

### The encodable guideline (anchored, not gut)
Three anchors give engineering numbers they can defend:

**Floor — derived from the GPS mechanic.** Adjacent stops must be **≥ 2× the check-in radius** so arrival zones don't collide and arrival is a real event.
- With `CHECKIN_RADIUS_M = 100` → **minimum 250 m between consecutive stops** (2× radius + margin). **Ideal 300–600 m** (a 4–7 minute walk between stops — long enough to feel like travel, short enough not to bore).

**Ceiling — derived from the 30-minute ritual.** Budget the default quest: walking at ~80 m/min, reserve ~3–4 min dwell+photo per stop. For a 3-stop / ~30-min quest that leaves ~18 min walking → **total loop ≈ 1.0–1.5 km**. So:
- **3-stop quest:** total loop **0.8–1.5 km**, ~25–35 min.
- **5-stop quest (~1 hr pick):** total loop **1.5–3.0 km**, ~50–70 min.
- **Hard ceiling** per default quest: **2 km** unless the user picked `~1 hr`. Never silently ship a slog.

**Spread justification — varied micro-contexts.** Beyond raw distance, require **stop variety** (e.g. a park monument → a street-level façade → a tucked-away courtyard/interior). Variety naturally forces block-level separation *and* creates the felt sense of journey — "I moved through different places," not "I rotated in one plaza." Three monuments ringing one square fail this even where distances scraped by.

### The rule, stated for the assembler
> A valid quest has **3–5 stops**, each consecutive pair **≥ 250 m apart** (ideal 300–600 m), a **total loop of 0.8–1.5 km** for the 30-min default (up to ~3 km for the 1-hr pick), and **≥ 2 distinct place-types/micro-contexts**. Reject or re-assemble candidates that violate the floor or the loop ceiling. Lead the route with the strongest "hero" anchor (§2).

**UX justification:** movement *is* the product (PRD: "exploration, movement, discovery"). A quest that doesn't move you isn't an adventure, it's a lookup. The 250 m floor protects the arrival mechanic; the 1.5 km ceiling protects completion rate; variety protects against "samey." All three map directly to PRD churn risks #1 and #2.

---

## 5. Accessibility & trust (sending real people into the physical world)

We are directing humans to walk somewhere real. That carries a duty of care the UI must honor.

- **Safety note, lightweight but present.** On the quest overview, one calm line: *"Stay aware of traffic and your surroundings — look up from your phone."* On the first quest only, a one-time gentle card: *"DayQuest sends you to public, open places. Trust your judgment; skip any stop that feels unsafe and use 'I'm here' to continue."* Not a scary legal wall — a trusted-friend tone.
- **Manual override must always be visible, never buried.** Keep the existing `Can't check in? I'm here →` (App.js:231–235) on *every* stop, at full opacity, equal in prominence to the primary CTA's neighborhood. GPS fails in urban canyons (exactly our NYC use case); a hidden override turns a glitch into a dead-end and a lost Completed Quest Day. Every stop must be completable without working GPS.
- **Honest distance & time, everywhere.** Show real walk time/distance on overview and per stop (§1.3, §4). Never under-promise the walk. "~35 min" that turns into an hour is a betrayal that costs trust and retention (churn risk #2).
- **Skippable stops.** Let a user skip a stop (closed, blocked, feels off) and still complete the quest. A skip is logged but doesn't fail the day. Completion should be resilient, not brittle.
- **Permission honesty.** Request location **only when needed**, framed in plain words (§2), and only foreground/while-using — never "always." We never ask for more than the walk requires.
- **Legibility & contrast.** The cream/ink palette is high-contrast and good outdoors; keep body text ≥ 15pt (current spec is fine), ensure the disabled-CTA grey (`#cbb8a8`) still reads as text in sunlight, support OS dynamic type, and give all tap targets ≥ 44pt. Outdoor-in-sunlight is our primary reading condition — design for the bright screen, not the desk.
- **Source transparency (trust in the content).** Keep the `source ↗` link (App.js:238). Every claimed fact is checkable — this is what separates DayQuest from generic AI slop and earns the discovery trust the whole product rests on.

---

## Summary of decisions for the build team
1. **Add a map** (P0) to overview + stop detail; **add pause/resume/abandon** with persisted progress (P0).
2. **Invert onboarding:** delight first (a free, permission-less teaser place with a surprising fact), permission only on `Start a Quest`, defaults pre-picked so the happy path is ~one tap.
3. **Rebuild the recap as a 9:16 magnet:** user's hero photo + a brag-worthy fact caption + quest name & neighborhood + a route trace. Test every element against "does it pull in a stranger."
4. **Encode spread in quest assembly:** consecutive stops ≥ 250 m (ideal 300–600 m), total loop 0.8–1.5 km (30-min) / up to ~3 km (1-hr), ≥ 2 distinct micro-contexts, hero anchor first. **The current flagship quest fails this and must be regenerated.**
5. **Trust touches:** always-visible override, honest time/distance, a calm safety line, skippable stops, plain-language permission, sunlight-legible UI, checkable sources.
