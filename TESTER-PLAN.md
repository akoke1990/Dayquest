# DayQuest — First Tester Round Plan (Stony Brook / Long Island)

**Owner:** CPO · **Date:** 2026-06-21 · **Status:** Draft, ready when the game-layer build lands

The build is nearly there; the test is unplanned. This fixes that. Goal: get ~15–40
real people to do a DayQuest in the wild and tell us if it's fun and worth repeating.

---

## 1. The single question this round answers
**"Does a stranger finish a quest and want another?"** Everything below serves that.
We are NOT testing polish, edge cases, or scale — just: is the core loop fun in the real world.

## 2. Who & where
- **Where:** Stony Brook Village (proven hero zone) + greater Smithtown/LI now that Google Places gives coverage. Testers start near a walkable cluster (the village center / duck pond).
- **Who (15–40):** your own network on Long Island first — friends, family, neighbors. Then a second wave of friends-of-friends. Mix of: a couple of "tech-comfortable," several "normal phone users," ideally 1–2 who'd never install a beta (the truest signal).
- **Why this group:** they'll actually go outside and do it, and they'll tell you the truth.

## 3. How they run it (the friction reality)
Right now it needs Expo Go + your dev server running. That's fine for a *handful* of hands-on testers, **not** for 40 strangers. Two tiers:
- **Tier 1 (now, ~3–8 people):** hands-on — they install Expo Go, you send the link while your server's up, ideally you're with them or on a call. Highest-fidelity feedback.
- **Tier 2 (the real round, 15–40):** needs a **standalone build** (EAS Build → TestFlight/Play Internal) so there's no Expo Go / dev-server dependency. **This is the gating dependency for a real round** and requires the Apple Developer account ($99/yr) we've been deferring. Decision point: when we commit to Tier 2, we get the Apple account + a hosted server.

> CPO note: don't try to run 40 people through Expo Go — the setup friction will read as "the app is broken" and poison the signal. Do Tier 1 now for qualitative gold; stand up Tier 2 for the real numbers.

## 4. What we measure (we already capture most of it)
Analytics events already fire to the server (`data/events.jsonl`): quest_started, quest_completed, stop_checked_in, stop_photo, quest_abandoned, shared, points_earned. Plus feedback (👍/👎 + notes) and per-stop flags in `data/feedback.jsonl`.

| Metric | From | Target (first read) |
|---|---|---|
| **Activation** — % who finish their first quest | started vs completed | ≥ 40% |
| **Where they drop** — last stop before abandon | stop_checked_in vs abandoned | (diagnostic) |
| **Delight** — 👍 rate + share rate | feedback + shared | ≥ 50% 👍 |
| **Return** — % who start a 2nd quest within ~2 wks | started by install_id | the real bet |
| **Content quality** — flagged stops | feedback flags | < 10% of stops |

## 5. The 3 questions to ask every tester (verbatim is fine)
1. "Was that fun — would you do another?" (the whole ballgame)
2. "Did anything feel broken, confusing, or off?"
3. "Would you tell a friend about it? Why / why not?" (share-loop signal)

## 6. Success / kill criteria
- **Green (build the social layer):** most finish, ≥half 👍, several spontaneously do a 2nd quest or ask for more areas.
- **Yellow (fix the loop):** they finish but shrug — dig into *why* (content? walk? payoff?) before adding features.
- **Red (rethink):** they don't finish or don't care — stop building, fix the core fun.

## 7. Sequence
1. Game-layer build lands → CEO tests it solo on phone (final pre-tester gate).
2. **Tier 1** hands-on round with 3–8 LI people this/next weekend.
3. Read signal → decide Tier 2 (Apple account + hosted server + TestFlight).
4. Tier 2 real round → the retention read that gates the multiplayer/social pillar.
