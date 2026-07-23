# DayQuest NYC — 30-Day Demand Validation

**Decision:** Treat the App Store launch as a controlled demand experiment, not proof of product-market fit.  
**North star:** Completed Quest Days — a person or group starts and finishes a real-world quest.  
**Scope:** A limited, honestly labeled NYC launch cohort. No nationwide coverage claim and no Day 1 monetization.

## Questions this experiment must answer

1. Do players understand the promise and begin a quest?
2. Do they physically complete it?
3. Do the riddles, hints, destinations, and recovery paths create satisfying discovery?
4. Do players voluntarily return, share, invite someone, or request more areas?
5. Is content reliability operationally sustainable?
6. Is Private Custom Hunts demand real enough to justify deployment 2?

Downloads, account creation, time in app, and social impressions are secondary. They cannot substitute for completed and repeated Quest Days.

## Launch cohort

Recruit a directional first cohort across four intended uses:

- NYC locals looking for something to do
- Couples/friends seeking a date or social activity
- Visitors exploring a neighborhood
- Families or small groups seeking a structured outing

Target 30–50 completed first-use sessions during the initial 30 days, with 10–15 directly observed sessions. This is not a statistically conclusive sample; it is sufficient to expose severe comprehension, content, reliability, and value problems before nationwide expansion.

Do not count employees, the founder, or development agents as demand-validation users.

## Pre-registered decision thresholds

These thresholds are product hypotheses, not promises or industry facts.

### Continue and deepen NYC

Continue if the cohort provides converging evidence that:

- At least 50% of genuinely started quests complete.
- At least 20% of eligible first-time players start another quest within 14 days, or explicitly request another available Area when inventory limits prevent replay.
- Median post-quest satisfaction is at least 4 out of 5.
- At least 20% share, invite, join the private-hunt waitlist, or make an unprompted request for more DayQuest experiences.
- Fewer than 10% of started quests require a content-failure replacement.
- No unresolved credible safety report remains active.
- Qualitative interviews consistently mention a specific discovery, riddle, or moment rather than only saying the concept is “cool.”

### Reposition toward occasions

Prioritize Private Custom Hunts, dates, visitors, birthdays, and group occasions if:

- First-quest completion and satisfaction are strong,
- organic repeat exploration is weak,
- but sharing, invitation, occasion interest, or willingness to pay is strong.

This is a valid business shape; it means DayQuest is an occasion product rather than a frequent local habit.

### Pause expansion and redesign

Do not add cities if any of the following persist after one focused iteration:

- Fewer than 35% of genuinely started quests complete.
- Players say Maps or an ordinary walking guide produces equal or better value.
- Content failures repeatedly break trust.
- Players cannot explain what makes a DayQuest worth repeating.
- Reliable content costs or support burden exceed a plausible per-user business model.
- Serious safety, privacy, deletion, or accessibility failures remain unresolved.

## Funnel definitions

A “start” requires receiving a valid quest and entering the quest experience. Tapping a button before an API failure is not a start.

1. `quest_requested`
2. `quest_started`
3. `first_stop_found`
4. `quest_completed`
5. `quest_shared` or `friend_invited`
6. `second_quest_started`
7. `private_hunt_interest`

Existing events may be reused where their semantics match. Do not rename historical events without a versioned migration.

## Privacy-safe event contract

Allowed properties:

- Random install identifier while analytics remains enabled
- Event timestamp
- App version/build
- Coarse Area identifier such as `west_village`
- Quest content-version ID
- Number of stops
- Anonymous cohort/referral code
- Guided assistance used: boolean
- Replacement used: boolean
- Structured replacement reason enum
- Completion duration bucket, not a raw route
- Network/backend result class
- Accessibility assistance used: boolean, only when voluntarily activated

Forbidden properties:

- Raw latitude/longitude
- GPS trails or route paths
- Photos or photo metadata
- Clue answers or raw clue/quest payloads
- Email, Apple identity token, name, or username
- Free-form location or report text
- Device advertising identifier
- Precise venue history outside the quest’s versioned content IDs

Analytics must respect the in-app analytics setting. Safety reporting required to protect players must be operationally separated from optional product analytics and minimized to structured content IDs/reason codes.

## Essential measurements

### Activation

- Quest request success rate
- Quest start rate after a valid quest loads
- Time-to-valid-quest bucket
- Permission-denied and unsupported-Area outcomes

### Core experience

- First-stop and quest completion rates
- Stops completed per started quest
- Authored hint 1 and hint 2 usage
- Guided discovery usage
- Structured replacement frequency and reason
- Abandonment stage

### Value and retention

- Post-quest 1–5 satisfaction
- “What was the most memorable discovery?” interview response
- Another quest started within 7 and 14 days
- Share/invite action
- Request for another Area
- Private Custom Hunts waitlist interest

### Reliability and trust

- Crash-free quest sessions
- API success/timeout/unavailable class
- Content failure and replacement success
- Safety reports and time-to-pause
- Support contacts per completed Quest Day

## Research protocol

For 10–15 observed sessions:

1. Do not explain the interface unless safety requires intervention.
2. Ask the player to narrate what they think the next action will do.
3. Record structured observations without recording raw routes or private conversations.
4. After completion or abandonment, ask:
   - What did you expect before starting?
   - Where were you confused?
   - Which discovery was most memorable?
   - Would you do another one? With whom and when?
   - What, if anything, would you pay for?
   - How would you describe DayQuest to a friend?
5. Separate courtesy praise from behavior. Prioritize completion, return, sharing, and concrete stories.

## Weekly cadence

### Days 1–7 — reliability canary

- Small invited cohort only
- Observe most sessions
- Pause any unsafe or materially incorrect stop immediately
- Fix P0 reliability/comprehension defects before increasing traffic

### Days 8–14 — first repeat window

- Broaden to the four intended-use segments
- Measure completion, assistance, replacement, and satisfaction
- Contact first-week players only through consented research channels

### Days 15–21 — value and occasion test

- Offer additional approved Area availability where inventory permits
- Introduce a non-purchasing Private Custom Hunts interest prompt after completion
- Compare local exploration interest with occasion-driven interest

### Days 22–30 — decision

- Freeze feature additions
- Analyze funnel outcomes and observed sessions
- Classify the decision: deepen NYC, reposition toward occasions, or pause/redesign
- Do not authorize nationwide content production from downloads alone

## Owner dashboard

Review weekly:

- Completed Quest Days
- Unique quest starters
- Completion rate
- 7-day and 14-day second-quest rate
- Median satisfaction
- Share/invite/private-hunt-interest rate
- Replacement rate by structured reason
- Open safety reports and pause latency
- Backend timeout/error rate
- Crash-free quest-session rate

Small cohorts require raw counts beside percentages. Never present a percentage without its denominator.

## Monetization during validation

DayQuest 1.0 remains free with no ads, subscription, or in-app purchase. The only monetization experiment is a post-completion interest signal for Private Custom Hunts. Do not collect payment or imply availability.

Deployment 2 proceeds only if behavior indicates occasion demand and the free experience is operationally stable.

## Expansion gate

A new neighborhood or city requires all of:

- Validated demand signal in the current market
- Lifecycle-safe curated inventory
- Risk-weighted remote verification
- Selective scouting/canary verification
- Penalty-free content replacement
- Local support and pause ownership
- Honest in-app coverage state

AI may research and draft expansion content, but cannot field-verify, approve safety/accessibility, or publish autonomously.
