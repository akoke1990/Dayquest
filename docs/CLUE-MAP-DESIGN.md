# DayQuest — Clue + Map Redesign (the "I'm hunting" screen)

**Author:** Senior UX/UI · **Date:** 2026-06-29 · **Status:** Design doc for eng (deltas, not code)
**Reads alongside:** `docs/UX-RESEARCH.md` (R1 anti-frustration clue, R2 noisy-GPS, R3 edge-glow + debounce). This builds on that research; it does not supersede it.
**Scope:** The live hunt screen only — clue presentation + map guidance + how they work together. Everything is a concrete delta against today's `app/App.js`.

---

## 0. What we're fixing (and what we keep)

The founder walked a real hunt and the clue + map "need to be fixed." Here is exactly what exists today, so the changes below are surgical:

**Today (from `app/App.js`):**
- Full-screen `MapView` with `initialRegion={regionForHunt(...)}` — **no map ref, so it never recenters on a new clue** (App.js: only `initialRegion` is set; no `animateToRegion`).
- A **200m `<Circle>`** ("it's somewhere in here") around the current target; no pin for the unfound place.
- **Edge-glow** border frame (`styles.edgeGlow`) tinting blue→red with proximity, driven by movement-gated `heatCoords` (the `HEAT_MOVE_M = 12` gate).
- A **bottom-center warmth meter** (`styles.warmthMeter`) with band label + hint ("🔥 Warm / It's nearby!").
- A **left-docked collapsible clue card** (`styles.cluePanel`) — tap body to reveal hint, "🔍 Hint", "I found it! →", and an escape "Can't find it? Reveal this place →" that arms after `ESCAPE_AFTER_MS = 45000`.
- Data shape per stop (`lib/quest.js`): exactly **one `clue` + one `hint`** + post-find reveal (`description`, `reason`, `lore_hook`, `virtual_item`). Difficulty is hard→impossible.
- Find at ≤ `FIND_RADIUS_M = 50` → "YOU FOUND IT!" reveal → camera-catch the collectible.

**KEEP — do not rebuild (already correct per research):**
- ✅ **Edge-glow instead of full-screen tint** — already satisfies R3 (legible outdoors, no center wash).
- ✅ **12m movement-gated heat** — already satisfies R2 (hides GPS jitter).
- ✅ **No pin for the unfound target / soft circle** — correct "somewhere in here" framing (§2a).
- ✅ **45s reveal escape** — already a partial R1 never-trap. We strengthen it, not replace it.
- ✅ **Hot/warm/cool/cold bands + band-change haptic** — keep the model; refine the surface.

**The four real problems:**
1. **Clue placement is wrong for a *hard* clue.** A hard clue gets **re-read** repeatedly. A narrow left-docked rail truncates long riddle text, fights the edge-glow on the left edge, and reads as a dismissible side-note — not the thing the whole game is about.
2. **The map never recenters.** Walk out of frame or advance to clue 2 and you're stranded looking at the wrong patch of map. (Confirmed: `initialRegion` only.)
3. **The hint ladder is too short and too punishing.** Two rungs (clue → one hint), and the only further help is a full give-up reveal. For an *intentionally near-impossible* clue, that's the exact Adventure-Lab frustration R1 warns about.
4. **The warmer/colder signal is split and quiet.** The meter (bottom) and the glow (edges) say the same thing in two places, and there's no *trend* ("am I getting warmer as I walk?") — which is what hot/cold games actually run on.

---

## 1. THE CLUE EXPERIENCE

### 1.1 Recommended placement: a **bottom clue sheet** (peek / expanded), not a left rail

**Decision:** Replace the left-docked `cluePanel` with a **bottom sheet** that has two rest states — **peek** (default) and **expanded** — plus the existing collapse to nothing.

**Why bottom, not left (the headline call):**
- A hard clue is **re-read 5–10 times**. Re-reading wants **full screen width** and comfortable line length. The left rail is ~60% width and truncates/scrolls — the worst surface for the most-read text in the app.
- Bottom sheets are the **universal maps pattern** (Apple/Google Maps, Pokémon GO nearby tray). Thumb-reachable, swipe-to-expand is muscle memory.
- It **doesn't fight the edge-glow.** The glow lives on the screen *border*; a left rail sits right on top of the left glow edge. A bottom sheet docks below the glow's bottom edge and reads as a separate layer.
- It frees the **left and right edges** for the warmer/colder glow to be symmetric and legible.

The clue is the product. Give it the prime, full-width, re-readable real estate.

### 1.2 The hint ladder — a real **3-rung ladder** (and where each rung's text comes from)

R1 wants nudge → strong hint → reveal. Today's schema gives **one clue + one hint**, so the "nudge" rung has **no content source.** Resolve it explicitly:

| Rung | When it unlocks | Content source | Cost / framing |
|---|---|---|---|
| **0 — The clue** | Always shown | `stop.clue` | Free. The puzzle. |
| **1 — Nudge** | On demand anytime, OR auto-offered after ~90s on this clue | **System-derived, no new content:** the place's *kind/category* + a soft proximity steer — e.g. "It's a *monument*, and you're **getting warmer** — keep heading the way the glow brightened." Kind comes from `place.kind` (**verified present in `quest.json`**, e.g. "historic monument"), BUT it is **sometimes empty** (e.g. Wikipedia-sourced places like Washington Square Park have `kind: ""`). So rung 1 must **degrade gracefully**: when `kind` is blank, drop the category clause and use the warmer/colder steer alone ("You're **getting warmer** — keep heading this way"). The trend comes from §2.3. | Free. Costs nothing, breaks the "I'm totally stuck" wall. |
| **2 — Strong hint** | On demand after rung 1 (or after ~3 min) | `stop.hint` (today's single hint) | Free, but framed as "the big hint" so it feels earned, not default. |
| **3 — Reveal** | On demand after rung 2, OR auto-armed at `ESCAPE_AFTER_MS` (keep the 45s) | place name (today's escape `findStop(idx, true)`) | "Show me where" — still counts as found, keep playing. Never blocks. |

**The one place this touches generation (call it out even though the doc is "not code"):** Rung 1 as specced needs **no** new generated field — it's assembled from `place.kind` + the live warmer/colder trend. *Optional upgrade:* add a third generated string `nudge` to the `lib/quest.js` schema (a one-line, oblique narrowing that's softer than `hint`) if playtests show the system-derived nudge feels robotic. Ship the system-derived version first; it's free and removes the data dependency.

**Pacing principle (R1):** never push spoilers, always allow pulling help. Each rung is a *tap*, plus a *time-based gentle offer* ("Want a nudge?" appears after 90s — it does **not** auto-reveal). The 45s→reveal escape stays as the ultimate never-trap.

### 1.3 Progress, difficulty framing, and "what do I do now"

- **Progress:** keep the top-center `progressChip` ("2/3 found") AND keep the clue kicker "CLUE 2 OF 3" in the sheet header. Two glanceable spots is fine — they serve different glances (map-level vs clue-level).
- **Difficulty framing:** add a small difficulty pip in the sheet header — e.g. `◆◆◇ HARD`. This **sets expectations** (R1's "self-select" — a hard clue *should* feel hard; naming it converts frustration into challenge). One line, muted.
- **"What do I do now" line:** the sheet's peek state always ends with a single **directive micro-line** that reflects the warmer/colder trend: "🔥 Warmer — keep going this way" / "❄️ Colder — try doubling back" / "📡 Move a few steps to get a reading." This is the moment-to-moment instruction that's missing today.

### 1.4 Map ↔ clue coexistence: **coexist (peek), toggle to expand** — never split

- **Default = peek:** map owns the screen; the clue sheet shows ~2 lines of clue + the directive line + the action row. Map fully interactive above it.
- **Expand (swipe up / tap):** sheet rises to ~55% for the full clue, the difficulty pip, the hint ladder, lore-free. Map still visible above.
- **Collapse (swipe down):** sheet drops to a slim tab (keep today's `clueTab` idea — 📜 + "2/3") so a power-player can have a clean map.
- **No split-screen, no separate clue *view* you navigate to.** Context-switching away from the map to read the clue, then back, breaks the hunt loop. The peek sheet keeps both alive at once.

### 1.5 Recommended CLUE layout (wireframe)

```
┌─────────────────────────────────────────┐
│ ░░ warm edge-glow border (all 4 sides) ░░ │
│ ░                                        ░ │  ← edge-glow = warmer/colder (KEEP)
│ ░   [theme chip]      ( 2/3 found )      ░ │  ← top HUD (KEEP)   [🗺️][🏅][✕] side rail
│ ░                                        ░ │
│ ░                                        ░ │
│ ░              M A P                     ░ │  ← live map, recenters on new clue (§2)
│ ░         (soft 200m circle)             ░ │
│ ░             ◉ you                      ░ │
│ ░                                        ░ │
│ ░                                        ░ │
│ ░  [pts]                      [＋ Quest] ░ │  ← FABs (KEEP)
│ ░╔══════════════════════════════════════╗░│
│ ░║ ▁▁  CLUE 2 OF 3        ◆◆◇ HARD      ║░│  ← BOTTOM CLUE SHEET (peek)
│  ║ "Where the iron horse once drank,    ║ │     full width, re-readable
│  ║  brick arches still keep the rain…"  ║ │     (swipe ▲ to expand for full text
│  ║ 🔥 Warmer — keep heading this way     ║ │      + hint ladder)
│  ║ [ 💡 Nudge ]              [ Found it! ]║ │
│  ╚══════════════════════════════════════╝ │
└─────────────────────────────────────────┘

EXPANDED (swipe ▲):
  ╔══════════════════════════════════════╗
  ║ ▔▔        CLUE 2 OF 3    ◆◆◇ HARD     ║
  ║ "Where the iron horse once drank,     ║
  ║  brick arches still keep the rain off ║
  ║  travelers who no longer come."       ║   ← full clue, full width
  ║                                       ║
  ║ HINT LADDER                           ║
  ║  ① 💡 Nudge      [ tap to reveal ]    ║   ← rung 1: kind + warmer/colder steer
  ║  ② 🔦 Big hint   [ locked → tap ① ]   ║   ← rung 2: stop.hint
  ║  ③ 🗺️ Show me where (still counts)    ║   ← rung 3: reveal, never-trap
  ║                                       ║
  ║ [ I found it! → ]                     ║
  ╚══════════════════════════════════════╝
```

---

## 2. THE MAP EXPERIENCE

### 2.1 Search zone — **keep the fixed 200m soft circle. Do NOT shrink it.**

**Decision:** Keep `SEARCH_ZONE_RADIUS_M = 200` as a fixed, soft, translucent circle. **Reject the shrinking zone.**

**Why not shrink:** a circle that shrinks toward the true center *is the giveaway* — the place is always at the centroid, so a tightening ring draws an X on the target. Let **warmer/colder do the narrowing** instead (that's its whole job, and it doesn't reveal a fixed point — it reveals *your* relationship to the target as you move). The fixed circle just says "in here somewhere," which research §2a explicitly favors over implied precision.

**Refinements to the circle (deltas):**
- Make the fill **lighter and warmer** (current `rgba(31,111,178,0.14)` blue reads cold/techy and clashes with the warm palette) — use a low-alpha terracotta/cream wash so it doesn't fight the map or the glow.
- Keep stroke color tied to the band (it already does, `band?.color`) — nice, the ring subtly warms too.
- In dense Manhattan, 200m is right (R2: generous; GPS error is tens of meters). Do **not** go below ~150m anywhere below 40th St.

### 2.2 The "you are here" marker — give it character

Today: `showsUserLocation` (the OS default blue dot). Delta: keep the OS dot for accuracy-halo truthfulness, but it's the one un-branded thing on a styled map. **Low-priority polish:** a custom avatar marker (research §2a — a characterful "you" anchors immersion). Not a top-3; the dot works. If kept, ensure it's the high-contrast OS dot (legible in sun).

### 2.3 Warmer/colder — unify the surfaces and add a **trend cue** (no bearing arrow)

This is the most important map refinement. Three concrete moves:

**(a) Make the edge-glow the primary signal; demote the bottom meter to a one-line directive.**
Today the glow (edges) and the meter (bottom block) duplicate the band. The big bottom meter block competes with the clue sheet for bottom space. **Delta:** fold the band label into the clue sheet's directive micro-line (§1.3). The glow carries the *state* (color/intensity); the sheet carries the *words* ("🔥 Warmer — this way"). Remove the standalone `warmthMeter` block. One signal, two coherent expressions, no duplication, and the bottom is freed for the clue.

**(b) Add a TREND, not just a state — this is the hot/cold game's engine.**
Today the glow shows absolute proximity band. **Delta:** on each movement-gated `heatCoords` update (every ≥12m), compare distance to the *previous* heat distance and fire a transient cue:
- got closer → glow **pulses warmer + a rising "ding" + a crisp haptic**; directive = "🔥 Warmer — keep going this way."
- got farther → glow **cools + a falling tone**; directive = "❄️ Colder — try doubling back."
This converts "I'm in a warm zone" (static) into "I'm walking the right way" (actionable) — the felt difference between a thermometer and a metal detector. It needs no new data, just a `prevHeatDist` ref.

> ⚠️ **The trend is the GPS-noise-sensitive layer — needs field-tuning.** R2's premise is tens-of-meters error. A distance delta over a single 12m gated move can be **swamped by GPS error**, so a naive trend can *lie* ("🔥 warmer" while you actually walked away). A confidently-wrong directional cue is worse than none. Mitigations eng must apply: (i) require a **larger move threshold** for the *trend* than for the band update (e.g. trend only fires on ≥25–30m of net travel, smoothed over the last 2 readings); (ii) **fall back to absolute band-state only** when `|Δdist|` is within GPS-error noise (don't claim a direction you can't support); (iii) the named **absolute bands** (hot/warm/cool/cold) remain the trustworthy backbone — the trend is the fragile garnish on top, exactly as Geocaching's model leans on absolute named states. Treat the trend's thresholds as a playtest-tuned knob, not a fixed constant.

**(c) Reject a compass/heading arrow to the target.** The task asks — answer is **no.** Geocaching/Adventure Lab can show a bearing arrow *because they expose the cache coordinates*; we deliberately hide the pin. An arrow pointing at the target *is* the pin. The warmer/colder **trend** (b) gives directional information honestly — it rewards moving and tells you if the last move helped — without ever drawing a line to the answer. Don't add the arrow.

**(d) Sound (new, opt-in default-on).** Add a short audio layer to (b): a soft rising blip on "warmer," a low one on "colder," and a distinct chime entering "🔥🔥 Red hot." Research §2f/R3 explicitly calls for audio near "on fire." Respect the mute switch; pair every sound with the existing haptic so silent play still works.

### 2.4 Zoom & recenter — **the top map fix**

**The gap (confirmed):** the map sets `initialRegion` once and has no ref, so it **never recenters.** Walk out of frame, or advance to clue 2 (a new circle somewhere else), and the map is showing the wrong place. This is the single most jarring thing about the current hunt.

**Deltas:**
1. **Add a `mapRef` + `animateToRegion`.** On every **new clue** (`currentTarget` changes / `findReveal` clears → next), animate to `regionForHunt(currentTarget, coords)` over ~600ms. The hunter is always dropped into the right neighborhood.
2. **Add a recenter FAB** (📍, bottom-right above the score FAB). Maps convention; one tap re-frames you + the zone. Cheap, expected, removes "I'm lost on the map."
3. **Gentle auto-follow, debounced:** if the user drifts near the screen edge and hasn't manually panned in ~8s, ease-recenter on them. Don't fight active panning (track a "user touched the map" flag; pause auto-follow ~5s after any gesture).
4. **Lock zoom bounds** (research: Munzee's runaway zoom is the cautionary tale) — `minZoomLevel`/`maxZoomLevel` so a pinch can't fling them to space or into the pavement.

### 2.5 Legibility outdoors (sunlight)

- Edge-glow already wins here vs. full tint (R3) — **keep.**
- Clue sheet: **opaque** cream background with ink text (not glassmorphism/translucent) — translucent panels die in sunlight. High contrast, large type (≥17pt clue body).
- Map: the warm custom `mapStyle` is fine; just verify the 200m circle fill is light enough not to mush low-contrast labels in bright light.
- Directive line + difficulty pip: high-contrast, no thin gray-on-gray.

### 2.6 Recommended MAP layout (wireframe — the unified "I'm hunting" screen)

```
┌─────────────────────────────────────────┐
│ ▓▓▓▓▓ glow WARMS & PULSES when you ▓▓▓▓▓ │  ← edge-glow: state (color/intensity)
│ ▓                                       ▓ │     + TREND pulse on each ≥12m move
│ ▓ [Ghost Signs of SoHo]   (2/3 found)   ▓ │     (warmer = brighter pulse + ding)
│ ▓                              [🗺️ Spots]▓ │
│ ▓        ___________                     ▓ │  ← side rail (KEEP) [🏅][✕]
│ ▓      /             \                   ▓ │
│ ▓     |   soft 200m   |                  ▓ │  ← FIXED circle (warm wash). Never shrinks.
│ ▓     |    circle     |    ◉ you         ▓ │  ← OS "you" dot (or avatar)
│ ▓      \ ___________ /                   ▓ │
│ ▓                                        ▓ │
│ ▓                              [ 📍 ]    ▓ │  ← NEW recenter FAB
│ ▓ [125 pts]                  [＋ Quest]  ▓ │
│ ▓╔═══════════════════════════════════════╗│
│  ║ ▁▁  CLUE 2 OF 3         ◆◆◇ HARD       ║  ← clue sheet (peek) carries the WORDS:
│  ║ "Where the iron horse once drank…"     ║     clue + directive trend line
│  ║ 🔥 Warmer — keep heading this way       ║     (the old bottom meter is GONE,
│  ║ [ 💡 Nudge ]               [ Found it! ]║      folded into this directive line)
│  ╚═══════════════════════════════════════╝ │
└─────────────────────────────────────────┘

ONE SCREEN, THREE LAYERS THAT AGREE:
  • EDGE-GLOW  = warmer/colder STATE + TREND   (peripheral, glanceable, no center wash)
  • MAP        = where you are + the soft zone  (recenters on each new clue)
  • CLUE SHEET = the puzzle + the WORDS of the trend + the hint ladder + Found it
```

---

## 3. Prioritized, implementable recommendations

Each is a concrete delta to today's `app/App.js` (and one optional `lib/quest.js` touch). Ranked by felt-experience leverage.

### ⭐ TOP 3 (build these first — biggest felt improvement)

1. **Recenter the map on every new clue + add a recenter FAB.** *(§2.4)*
   Add `mapRef` + `animateToRegion(regionForHunt(currentTarget, coords))` when `currentTarget` changes; add a 📍 FAB; debounced auto-follow; lock zoom bounds. **Why #1:** the map currently strands you on the wrong patch — this is the most jarring, lowest-effort, highest-relief fix.

2. **Move the clue from the left rail to a bottom peek/expand sheet.** *(§1.1, §1.4, §1.5)*
   Full-width, re-readable, swipe-to-expand, opaque cream/ink. **Why #2:** the clue is the product and a hard clue gets re-read constantly; the left rail is the wrong surface for the most-read text.

3. **Ship the real 3-rung hint ladder + a trend-aware directive line.** *(§1.2, §1.3, §2.3b)*
   Rung 1 = system-derived nudge (place kind + warmer/colder steer, no new content), rung 2 = `stop.hint`, rung 3 = reveal (keep the 45s never-trap). Fold the band into a single "🔥 Warmer — this way" directive; add the warmer/colder **trend** (closer-since-last-move) with pulse + ding. **Why #3:** this is the anti-frustration core (R1) and the metal-detector feel (§2f) — it's what makes a hard hunt *fun* instead of punishing.

### Then (high value, after top 3)

4. **Unify warmer/colder surfaces — remove the standalone bottom `warmthMeter`.** *(§2.3a)* Glow = state+trend; sheet directive = words. Frees the bottom for the clue, kills the duplication.

5. **Add the warmer/colder audio layer** (rising/falling blips + red-hot chime), default-on, mute-respecting, paired with existing haptics. *(§2.3d)*

6. **Add the difficulty pip** (`◆◆◇ HARD`) to the clue header to set expectations and reframe difficulty as challenge, not bug. *(§1.3)*

7. **Soften/warm the 200m circle fill** (terracotta/cream wash, lighter alpha) so it stops reading cold and stops mushing labels in sun. Keep it **fixed** — do not shrink. *(§2.1)*

### Polish / later

8. **Custom "you" avatar marker** instead of the OS blue dot. *(§2.2)*
9. **Optional generated `nudge` field** in `lib/quest.js` if playtests show the system-derived rung-1 nudge feels robotic. *(§1.2)* — the only change that touches quest generation; deferred on purpose.

---

## 4. Explicitly rejected (so eng doesn't build them)

- **❌ Compass/bearing arrow to the target** — it's the hidden pin in disguise. The warmer/colder *trend* gives honest directional feedback instead. *(§2.3c)*
- **❌ Shrinking search zone** — a ring tightening on the centroid draws an X on the answer. Fixed circle + warmer/colder narrowing instead. *(§2.1)*
- **❌ Full-screen color tint** — already correctly rejected (R3); edge-glow stays.
- **❌ A separate clue *screen* you navigate to** — breaks the hunt loop; peek sheet keeps map + clue alive together.

---

## 5. References (from `docs/UX-RESEARCH.md`)
- **R1** anti-frustration clue (tiered hint ladder, never hard-block) — Adventure Lab clue-friction lesson.
- **R2** noisy GPS (movement-gated refresh ≥10–15m, generous geofence) — already met by `HEAT_MOVE_M = 12`.
- **R3** warmer/colder as peripheral glow + haptic + audio, not full tint — already met by edge-glow; we add the trend + audio.
- **§2a** map-first HUD, soft search-zone circle, lock zoom bounds (Munzee cautionary tale).
- **§2f** tiered named bands + movement-gated refresh + reddish-hotter color (Geocaching hot/cold).
- Pokémon GO nearby tray (bottom sheet pattern); Adventure Lab compass (why we *don't* copy the bearing arrow — they expose coords, we don't).
