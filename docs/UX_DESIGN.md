# DayQuest — UX Design

> Every screen, flow, and UI hierarchy for the DayQuest mobile app.
> Designed **within the existing build**: a single-file Expo `App.js` state
> machine using the established palette and the `quest.json` data shape. Nothing
> here requires a new framework, a backend change, or a designer's tooling — each
> screen is an incremental edit to the state machine that already ships.

---

## 0. Design principles

1. **One thing at a time.** A walk is sequential. The screen should mostly show
   *the stop you're walking to*, not a wall of all three.
2. **The phone gets out of the way.** This is an app for looking *up* at the
   world. Big targets, few words, no menus to learn.
3. **Earn the reveal.** Lore, the next stop, and the badge are unlocked by
   *doing* — checking in, snapping the photo. Progress is the engagement loop.
4. **Never dead-end.** Bad GPS, no places nearby, denied permission — every
   failure has a visible way forward (this already exists in code; keep it).
5. **Stay in the world we built.** Atlas-Obscura taste, warm paper palette,
   rounded cards. No new visual language.

### Visual tokens (already in `App.js` — do not change)

| Token | Hex | Use |
|---|---|---|
| `CREAM` | `#f4f1ea` | App background, quest-prompt boxes |
| `INK` | `#2b2622` | Primary text, recap card background |
| `ACCENT` (rust) | `#b5562e` | Buttons, distance, progress, links |
| `GREEN` | `#4a7c59` | "Done" / success state |
| Card | `#fff`, radius 16, padding 18 | Every content surface |
| Button | rust pill, radius 30 (primary) / 12 (inline) | Actions |

---

## 1. Screen inventory

The app today is **4 states** (`welcome` · `loading` · `ready`-as-one-long-list ·
inline recap). This design refactors `ready` into a **focused journey** and names
every state explicitly. Same data, same file, same palette.

| # | Screen | Status today | Change |
|---|---|---|---|
| S1 | Welcome / Start | ✅ exists | Add a permission "beat" before the spinner |
| S2 | Location permission | ⚠️ implicit | Make it a designed moment |
| S3 | Loading | ✅ exists | Add a line of flavor copy |
| S4 | **Quest Overview** | ⚠️ buried in list | Becomes the map/orientation screen |
| S5 | **Active Stop (focus)** | ❌ new | The core screen — one stop at a time |
| S6 | Check-in moment | ⚠️ inline button | Promoted to a clear in-range state |
| S7 | Quest action + confirm | ⚠️ photo only | Unified component; photo now, 3 types later |
| S8 | Stop complete → next | ❌ new | The reward + hand-off beat |
| S9 | Quest complete / Recap | ✅ exists | Keep; reachable from overview |
| E1 | Permission denied | ✅ exists | Keep |
| E2 | No quest nearby | ✅ exists | Distinguish copy from E1 |
| E3 | Can't check in (GPS) | ✅ exists | Keep manual override |

**Future / Phase 2 (README "possible next" — out of MVP scope):** live map view,
accounts + quest history, social/leaderboard. Sketched in §7, not designed in detail.

---

## 2. User flows

### Happy path
```
S1 Welcome
   └─tap "Start a Quest"
S2 Permission ask ──granted──▶ S3 Loading ──quest built──▶ S4 Overview
                                                                │
                                                   tap a stop / "Begin"
                                                                ▼
                                              ┌──────── S5 Active Stop ◀───┐
                                              │   (walking, distance live) │
                                              │            │               │
                                              │     in range (≤100m)       │
                                              │            ▼               │
                                              │   S6 Check-in (enabled)    │
                                              │            │               │
                                              │     tap "Check in"         │
                                              │            ▼               │
                                              │   S7 Quest action (photo)  │
                                              │            │               │
                                              │     photo captured         │
                                              │            ▼               │
                                              │   S8 Stop complete ────────┘ next stop
                                              └────────────┘
                                          last stop done
                                                  ▼
                                          S9 Recap + Share ──"New Quest"──▶ S1
```

### Branches that already exist in code (design them, don't invent new ones)
```
S2 Permission ──denied──────────────▶ E1 "We need your location"  ──[Try again]──▶ S2
S3 Loading  ──server/no places───────▶ E2 "No quest nearby"        ──[Try again]──▶ S3
S6 Check-in ──GPS won't confirm──────▶ E3 inline override "I'm here →" ──▶ S7
```
> E3 is not a separate screen — it's the always-present underlined override link
> beneath the check-in button (already in `App.js:232`). Keep it. It is the
> single most important anti-frustration affordance in the app.

---

## 3. Wireframes + screen descriptions

### S1 — Welcome
```
┌─────────────────────────────┐
│                             │
│                             │
│         DayQuest            │  ← logo, 44pt, ink, weight 800
│   Find a little adventure   │  ← tagline, 17pt, ink @70%
│        near you.            │
│                             │
│                             │
│    ┌───────────────────┐    │
│    │   Start a Quest   │    │  ← rust pill, 18pt
│    └───────────────────┘    │
│                             │
│   3 nearby spots · a short  │  ← NEW: tiny expectation-setter
│   walk · a few good stories │     13pt, ink @55%
└─────────────────────────────┘
```
**Description.** Calm cover. One verb. The added micro-line sets the contract
(short, walkable, storied) so the first quest can't disappoint by surprise.
**Hierarchy:** Logo → Tagline → [Start] → expectation line.

---

### S2 — Location permission (designed beat, not a bare OS dialog)
```
┌─────────────────────────────┐
│           📍                │
│                             │
│   DayQuest needs your       │  ← 22pt ink
│   location to find an       │
│   adventure right where     │
│   you're standing.          │
│                             │
│   We only use it while      │  ← 14pt ink @60% — trust line
│   you're on a quest.        │
│                             │
│    ┌───────────────────┐    │
│    │  Find my adventure│    │  → triggers OS permission dialog
│    └───────────────────┘    │
└─────────────────────────────┘
```
**Description.** A one-screen primer *before* the iOS/Android system prompt, so
the OS dialog isn't the user's first explanation. Tapping the button calls
`requestForegroundPermissionsAsync()`. Denied → **E1**. Granted → **S3**.
**Why this matters:** raising the system prompt cold tanks grant rates; a
single sentence of "why + only while questing" recovers them. Cheap to add.

---

### S3 — Loading
```
┌─────────────────────────────┐
│                             │
│           ◠ (spinner)       │  ← ActivityIndicator, rust
│                             │
│    Building your quest…     │  ← 17pt ink @70%
│                             │
│   Reading the neighbourhood │  ← NEW rotating flavor line:
│   for stories…              │     "Finding photogenic corners…"
│                             │     "Plotting a short loop…"
└─────────────────────────────┘
```
**Description.** Quest generation is a network + LLM round-trip (felt latency).
A rotating sub-line turns a wait into a tease. Pure cosmetic; no data needed.

---

### S4 — Quest Overview  ★ (the orientation screen)
```
┌─────────────────────────────┐
│ A Little Local Wander       │  ← quest.theme, 30pt 800
│ Three nearby spots, a short │  ← quest.intro, 16pt @75%
│ walk, and a few stories.    │
│ ───────────────────────────│
│  ●━━━━○━━━━○   0 of 3       │  ← progress spine (rust filled / outline)
│ ───────────────────────────│
│ ┌─────────────────────────┐ │
│ │ 1  Washington Sq. Park  │ │  ← stop preview card (collapsed)
│ │    📷 · 17 m from start  │ │     name + type emoji + distance
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ 2  Giuseppe Garibaldi   │ │
│ │    📷 · 46 m            │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ 3  Bust of A. L. Holley │ │
│ │    📷 · 88 m            │ │
│ └─────────────────────────┘ │
│    ┌───────────────────┐    │
│    │   Begin the walk  │    │  → opens S5 at stop 1
│    └───────────────────┘    │
└─────────────────────────────┘
```
**Description.** The map of the journey before it starts. Stops are *previews*
only (name, type, distance) — lore and quest prompt are intentionally withheld
to preserve the reveal at each stop. "Begin the walk" enters focus mode at the
first incomplete stop. Tapping any card jumps to that stop in S5.
This screen is also the **hub** you return to between stops.
**Hierarchy:** Theme → Intro → Progress spine → Stop previews (list) → [Begin].
**Cheap-to-build note:** this is the existing `ready` list with the per-stop
detail removed and a Begin button added — *less* code, not more.

---

### S5 — Active Stop (focus view)  ★ THE CORE SCREEN
```
┌─────────────────────────────┐
│ ‹ Overview        Stop 1/3  │  ← back to S4 + position
│ ───────────────────────────│
│  ●━━━━○━━━━○                │  ← same progress spine
│                             │
│  Washington Square Park     │  ← place.name, 26pt 800
│  ┌───────────────────────┐  │
│  │      ↑ 17 m           │  │  ← LIVE distance, big, rust
│  │   head this way       │  │     updates from watchPosition
│  └───────────────────────┘  │
│                             │
│  A pocket of green to       │  ← reason, italic @70%
│  slow down in.              │
│                             │
│  “Washington Square Park    │  ← lore_hook, the story — 14pt
│   is a 9.75-acre public     │     (revealed on this screen)
│   park… a tradition of      │
│   celebrating nonconformity”│
│   source ↗                  │  ← Linking to source_url
│                             │
│  ┌───────────────────────┐  │
│  │ 📷  Find the most       │ │  ← quest_prompt in CREAM box
│  │ photogenic tree, bench │ │
│  │ or view and snap it.   │ │
│  └───────────────────────┘  │
│                             │
│  ┌───────────────────────┐  │
│  │   Walk closer to       │  │  ← check-in button (disabled
│  │   check in   (88 m)    │  │     until ≤100m) — see S6
│  └───────────────────────┘  │
│   Can't check in? I'm here →│  ← E3 manual override (keep!)
└─────────────────────────────┘
```
**Description.** Everything for *this one stop*, nothing for the others. The
live distance is the hero element — it answers the only question a walker has
("am I close?"). Lore is the payoff for arriving. The quest prompt sits ready.
The check-in button is the gate to S6/S7.
**Hierarchy:** Nav/position → Progress → Place name → **Live distance** → Reason
→ Lore (+source) → Quest prompt → Check-in CTA → Override.

---

### S6 — Check-in moment (an in-range *state* of S5, not a new screen)
```
   …when distance ≤ 100 m the check-in zone changes:

│  ┌───────────────────────┐  │
│  │      ↑ 12 m           │  │  ← distance turns GREEN
│  │   you're here! 🎉     │  │
│  └───────────────────────┘  │
│           …                 │
│  ┌───────────────────────┐  │
│  │   📍 Check in here     │  │  ← button ENABLES (rust → tappable)
│  └───────────────────────┘  │
```
**Description.** Arrival is celebrated. The disabled "Walk closer" button
(`actionBtnDisabled` grey) flips to an enabled rust "Check in here", the
distance pill goes green and reads "you're here!". This is a state transition
inside S5 driven by `inRange` — already computed in `App.js:191`.

---

### S7 — Quest action + confirm (unified component)
```
After check-in, the action area becomes the quest interaction.
MVP data = photo only. Component is built to fan out to all 4 types.

PHOTO (ships today):
│  ┌───────────────────────┐  │
│  │  📷 Take your photo    │  │  → launchCameraAsync
│  └───────────────────────┘  │
        …after capture…
│  ┌───────────────────────┐  │
│  │   [ your photo 📷 ]    │  │  ← thumbnail, 180h, radius 12
│  └───────────────────────┘  │
│  ✓ Nice shot!  → next stop  │

FUTURE (schema already lists these; pipeline emits photo-only today):
🔍 find_detail → "I found it" confirm button
❓ question    → single text input + "Submit" (answer in quest data)
✨ collect     → "Add to my collection" + a little inventory shelf
```
**Description.** One action slot whose contents switch on `quest_type`. Today
`quest.js:67` locks the enum to `"photo"`, so only the photo branch renders —
but designing the slot as a switch means adding `question`/`find_detail`/
`collect` later is a *content* change, not a redesign. The four emojis already
exist in `App.js:19` (`QUEST_EMOJI`), so the visual language is pre-committed.
**Recommendation to founder:** ship photo-only (it already works); add a second
type only after real walkers tell you photo gets repetitive.

---

### S8 — Stop complete → next (the hand-off beat)
```
┌─────────────────────────────┐
│                             │
│            ✓                │  ← big green check
│      Stop 1 done!           │  ← 24pt
│                             │
│  ●●━━━○━━━━○   1 of 3        │  ← progress spine advances
│                             │
│   [ your photo thumbnail ]  │
│                             │
│   Next: Giuseppe Garibaldi  │  ← peek at next stop
│        46 m away            │
│                             │
│    ┌───────────────────┐    │
│    │  Walk to stop 2 → │    │  → S5 at next stop
│    └───────────────────┘    │
│        Back to overview     │  ← S4
└─────────────────────────────┘
```
**Description.** The momentum machine. Each completion gives a clear reward
(check + progress advance + your photo) and immediately points at the next
target so there's never a "now what?" gap. After the *last* stop this routes to
S9 instead. Can be a lightweight overlay/modal over S5 to keep it cheap.
**Hierarchy:** Reward (✓) → Progress → Your photo → Next target → [Walk to next].

---

### S9 — Quest complete / Recap + Share
```
┌─────────────────────────────┐
│ 🎉 Quest complete!          │
│ ───────────────────────────│
│ ┌─────────────────────────┐ │  ← INK card = the shareable image
│ │          🏅             │ │     (captureRef → Share)
│ │  A Little Local Wander  │ │
│ │  I explored 3 storied   │ │
│ │  places near Greenwich  │ │
│ │  Village, NYC.          │ │
│ │  [▢][▢][▢]  ← 3 photos  │ │
│ │       DayQuest          │ │
│ └─────────────────────────┘ │
│    ┌───────────────────┐    │
│    │ 📤 Share my       │    │  → expo Sharing
│    │    adventure      │    │
│    └───────────────────┘    │
│    ┌───────────────────┐    │
│    │    New Quest      │    │  → S1
│    └───────────────────┘    │
└─────────────────────────────┘
```
**Description.** Already built (`App.js:158-186`) — keep it nearly as-is. The
dark recap card is the app's one *outbound* artifact (the growth loop: a friend
sees the share, asks what it is). Only change: it's now its own screen reached
from S8/S4, not appended to the bottom of a long scroll.
**Hierarchy:** Celebration → Shareable card (badge/title/photos/wordmark) →
[Share] → [New Quest].

---

### E1 / E2 / E3 — Error & recovery states
```
E1 PERMISSION DENIED          E2 NO QUEST NEARBY
┌──────────────────┐          ┌──────────────────┐
│      DayQuest    │          │      DayQuest    │
│  We need your    │          │  Couldn't find   │
│  location to find│          │  enough stories  │
│  an adventure    │          │  right here.     │
│  nearby.         │          │  Try a busier    │
│                  │          │  spot or a town  │
│  [ Try again ]   │          │  centre.         │
│  Open Settings → │          │  [ Try again ]   │
└──────────────────┘          └──────────────────┘

E3 = inline override on S5/S6 (NOT a screen):
   "Can't check in? I'm here →"   always present under check-in.
```
**Description.** Each failure names the cause in human words and offers exactly
one forward action. E1 adds a deep-link to system Settings (the only fix once a
user hard-denies). E2 reframes "error" as "wrong spot" — protects the founder
from a 1-star "it doesn't work" when the real issue is a quiet rural location.
E3 guarantees a flaky GPS never traps a user mid-quest.

---

## 4. Global UI hierarchy

```
DayQuest (single state machine — screen = state variable)
│
├─ Entry layer
│   ├─ S1 Welcome ........... verb-only cover
│   ├─ S2 Permission ........ trust primer → OS dialog
│   └─ S3 Loading ........... flavor-copy wait
│
├─ Quest layer  (the loop)
│   ├─ S4 Overview ★ ........ HUB: theme, progress spine, stop previews
│   │     └─ Begin / tap stop
│   ├─ S5 Active Stop ★ ..... FOCUS: name · LIVE distance · lore · prompt
│   │     ├─ S6 Check-in ..... in-range state (green, button enables)
│   │     ├─ S7 Quest action . photo today / 4 types later
│   │     └─ E3 override ..... always-present escape hatch
│   └─ S8 Stop complete ..... reward + next-target hand-off
│
├─ Exit layer
│   └─ S9 Recap ★ ........... shareable badge card → New Quest
│
└─ Error layer
    ├─ E1 Permission denied .. + Open Settings
    └─ E2 No quest nearby .... reframed as location, not failure
```

**Persistent elements across the Quest layer:**
- **Progress spine** (`●━━○━━○`) — the same component on S4/S5/S8; the single
  thread of continuity and the core engagement signal.
- **Live distance** — present on S5/S6; the walker's compass.
- **Manual override** — present wherever check-in is required.

---

## 5. The one structural decision (recorded)

**Flat scroll (today) → focused journey (proposed).**
The task asked to optimize for *simplicity AND engagement*; those pull apart in
a single long list (simple to build, but flat and skimmable-to-death). The
hybrid resolves it:

- **Overview (S4)** keeps the simplicity — one glance shows the whole walk.
- **Active Stop (S5)** adds the engagement — one stop, live distance, lore
  revealed on arrival, a clear reward (S8) before the next.

This is the recommended spine. Crucially it is **not more code than today** —
it's the existing `ready` list split into a hub (S4, simpler) + a focus card
(S5, the detail that's already written, shown one at a time) + two small reward/
hand-off overlays (S8). Same data, same palette, same file.

---

## 6. Build sequence (cheapest path for a non-technical founder)

| Step | Effort | Screens | Note |
|---|---|---|---|
| 1 | tiny | S1 expectation line, S3 flavor copy | copy-only |
| 2 | small | S2 permission primer | one screen before OS dialog |
| 3 | medium | S4 Overview hub + S5 focus split | the refactor; the real work |
| 4 | small | S8 stop-complete overlay | momentum reward |
| 5 | tiny | E2 vs E1 copy split | protect the rating |
| — | later | S7 quest-type fan-out, Phase 2 (§7) | only after real-user signal |

Ship 1–2 in an afternoon; 3–5 are the meaningful release. Photo-only stays.

---

## 7. Future / Phase 2 (out of MVP scope — sketches only)

Per the README's "possible next": these are deliberately **not** designed in
detail to keep the MVP small.

- **Map view** — a pin map alternative to S4's list; tab-toggle on the overview.
  Adds a maps dependency + tile cost. Defer until walkers ask "where exactly?".
- **Accounts + history** — a "Past Quests" list of recap cards. Needs storage +
  auth. Defer until someone finishes a 2nd quest and wants the 1st back.
- **More quest types** — `question` / `find_detail` / `collect` (S7). Pipeline
  + app both photo-only today; add one type when photo feels repetitive.
- **Social** — leaderboards / shared quests. Far future; the recap-card share
  (S9) is the only growth loop the MVP needs.

> Guardrail: every Phase-2 item adds a dependency, a cost, or a backend. The MVP
> deliberately has none of those. Don't build them to feel complete — build them
> when a real walker's behavior asks for them.
