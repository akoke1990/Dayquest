# DayQuest iOS 1.0 — App Store Launch Plan

**Plan date:** 2026-07-23  
**Release branch baseline:** `release/ios-1.0` at `a6decdd`  
**Execution branch:** `release/app-store-readiness`

## Launch milestones

These are separate gates. A successful EAS build does not imply that the later gates are complete.

| Milestone | Target window | Current state | Exit criteria |
|---|---:|---|---|
| Internal installable build | Complete | Build 3 installed through EAS internal distribution | Signed build installs and launches on a registered iPhone |
| TestFlight smoke candidate | 2026-07-30 to 2026-08-02 | Not submitted | Production backend deployed; hint/guidance fix integrated; critical paths pass on a physical iPhone; TestFlight build uploaded |
| App Store-submittable release candidate | 2026-08-06 to 2026-08-13 | In progress | Compliance, deletion, reviewer mode, legal URLs, privacy inventory, accessibility/device matrix, metadata and screenshots complete |
| Responsible public launch | 2026-08-13 to 2026-08-27 | Not ready | Apple approval plus production monitoring, rollback, support ownership and a safe launch-content cohort |

The earliest responsible public date assumes no major real-device defect, Apple-account blocker, legal-copy delay, backend deployment failure, or review rejection.

## Current verified foundation

- Existing EAS project: `@akoke18/dayquest`
- iOS bundle identifier: `com.akoke18.dayquest`
- Version 1.0.0 internal preview build completed successfully
- App icon verified as 1024×1024 and opaque
- Dynamic Expo configuration is the single config source
- Export-compliance declaration is explicit
- Integrated automated suite was green before the in-progress hint branch
- Account deletion and legal/support configuration foundations exist in source
- Fast health and curated-content backend foundations exist in source
- NYC content bank, evidence model, lifecycle gates and remote reviews exist

## Critical launch blockers

### P0 — blocks TestFlight smoke confidence

- [ ] Finish, independently review and integrate `fix/hint-guided-discovery`
- [ ] Deploy the hardened backend; verify `/health`, `/`, and `/quest` latency from outside Render
- [ ] Ensure first-use quest delivery does not depend on live Claude generation
- [ ] Produce a fresh immutable TestFlight build from a clean commit
- [ ] Run physical-device smoke tests: fresh install, location, map, quest load, hints, guidance, GPS find, camera alternative, completion, restart/resume

### P0 — blocks App Store submission

- [ ] Deploy and verify the Supabase account-deletion migration and Edge Function
- [ ] Verify authenticated deletion cascade, failure behavior and local cleanup against the live project
- [ ] Verify Sign in with Apple and token revocation on a TestFlight device
- [ ] Audit Supabase RLS and server authorization boundaries
- [ ] Publish truthful Privacy Policy, Terms, Support and deletion-information URLs
- [ ] Complete App Store privacy answers and required-reason API/privacy-manifest review
- [ ] Add a deterministic reviewer/demo path that works outside NYC without GPS spoofing
- [ ] Complete VoiceOver, Dynamic Type, reduced-motion, contrast, non-color-cue and touch-target checks
- [ ] Prepare App Store metadata, screenshots, age rating, export answer and reviewer notes

### P0 — blocks responsible public release

- [ ] Select a limited launch-content cohort; do not expose all researched candidates
- [ ] Add penalty-free replacement and content/access/safety reporting
- [ ] Add immediate pause/retire controls and operational ownership
- [ ] Verify route safety and target observability for the launch cohort using risk-weighted scouting/canaries
- [ ] Configure crash/error monitoring without raw GPS, clue answers, photos, emails or quest payloads
- [ ] Document production rollback, support escalation and staged/phased release

## Owner inputs required

Do not invent these values in code or legal copy.

- [ ] App Store seller/legal entity name
- [ ] Public support email
- [ ] Public support URL/domain
- [ ] Privacy Policy URL
- [ ] Terms of Use URL
- [ ] Data-deletion information URL
- [ ] Final App Store subtitle and category
- [ ] Support escalation owner during launch week
- [ ] Confirmation of the Apple Developer/App Store Connect team that will publish the app

## Real-device release matrix

At minimum test:

- Fresh install and upgrade from the internal build
- Supported older iPhone/iOS combination and a current iPhone/iOS combination
- Location allowed, denied, limited/inaccurate and changed in Settings
- Slow network, offline start, Render restart and provider timeout
- Map-key failure and location unavailable
- Semantic hint 1, optional hint 2 and guided discovery
- Exact guidance does not mark a stop found or advance before geofence arrival
- Stop blocked/unsafe/inaccessible replacement path
- Camera denied and non-camera completion alternative
- Sign in with Apple, sign-out, deletion, deletion failure and reinstall
- Quest persistence across force-close and restart
- Notifications and haptics
- VoiceOver, Dynamic Type, reduced motion, contrast and non-color cues
- Reviewer/demo mode outside the launch geography

## Monthly operating budget

These figures exclude salaries, paid field scouting, legal work, advertising and taxes.

### Bare technical minimum — approximately $27/month

- Apple Developer membership annualized: $8.25
- Render Starter web service: $7
- Supabase Free: $0
- EAS Free/on-demand allowance: $0 base
- Batch AI/editorial allowance: $10
- Domain/support hosting annualized estimate: $2

This is technically possible, but Supabase Free can pause after inactivity and is not the recommended production posture.

### Recommended launch stack — approximately $67/month

- Apple Developer membership annualized: $8.25
- Render Starter always-on web service: $7
- Supabase Pro: $25
- EAS base: $0 if the included build allowance is sufficient
- Batch AI curation/riddle budget: $25
- Domain/support hosting annualized estimate: $2
- Monitoring: $0 initially on a privacy-configured free tier

Budget **$75–$100/month** to allow for build overages, map/geocoding usage, email/support tooling, or extra AI editorial runs.

### Early growth — approximately $145–$495/month

A practical range once DayQuest has meaningful usage or frequent releases:

- Render Standard through Pro: $25–$85
- Supabase Pro plus possible overages/compute: $25–$75
- EAS/build capacity: illustrative $19–$99 allowance; verify the selected Expo plan at purchase time
- Batch AI/content operations: $50–$150
- Monitoring/support tooling: $15–$75
- Apple annualized and domain: approximately $10

The product should not call Claude for every player quest. Precompiled curated quests keep AI spend bounded and remove a reliability dependency.

## Cost controls

- Serve versioned, precompiled content from the first-use path
- Use Claude only in offline editorial jobs; require explicit batch budgets
- Cache area and route data
- Keep Render always-on at the smallest instance until measured load requires scaling
- Start with one Supabase production project
- Use privacy-configured free monitoring tiers until event volume requires paid retention
- Set provider billing alerts and hard monthly caps where available
- Keep raw photos, GPS trails and quest payloads out of analytics

## Source pricing checked 2026-07-23

- Apple Developer Program: 99 USD per membership year — <https://developer.apple.com/support/compare-memberships/>
- Render: Hobby $0 plus compute; Starter web service $7/month; Standard $25/month; Pro $85/month — <https://render.com/pricing>
- Supabase: Free $0; Pro from $25/month, including one Micro compute credit — <https://supabase.com/pricing>
- Expo/EAS: <https://expo.dev/pricing> — final optional paid-plan cost must be confirmed when selecting the build plan because the public page is dynamically priced.

## Execution order

1. Finish and verify the hint/guidance branch.
2. Deploy and measure the hardened backend.
3. Create a new TestFlight build from a clean integrated commit.
4. Run the physical-device matrix and fix P0 failures with tests.
5. Deploy and live-test account deletion and Apple revocation.
6. Publish legal/support surfaces and complete the privacy inventory.
7. Implement and test reviewer/demo mode.
8. Finalize the limited launch-content cohort and safety operations.
9. Produce metadata, screenshots and reviewer notes.
10. Run an independent final release/security review.
11. Submit to App Store Connect and use phased release after approval.
