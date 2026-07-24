# NYC 1.0 launch cohort operations runbook

**Artifact:** `nyc-launch-cohort.v1.json`  
**Current state:** remote-only scout queue; no stop is field verified, published, or live.

## Non-negotiable rule

Remote review can prioritize field work but cannot authorize publication. A scout records observations; the scout does not change lifecycle flags, rewrite physical claims, or publish content. Only an authorized evidence reviewer may approve a versioned transition after checking the submitted evidence.

## Roles

- **Scout:** visits the route, completes `FIELD_CHECKLIST.md` for each candidate, and submits evidence.
- **Evidence reviewer:** checks identity, recency, provenance, safety/access observations, clue accuracy, and route coherence.
- **Content safety owner:** can pause a candidate or route immediately; safety concerns do not wait for normal review.
- **Publisher:** applies an approved, versioned lifecycle transition and runs validators.
- **Canary operator:** watches reports and can withdraw the route.

No person should approve their own unsupported physical claim.

## 1. Prepare the scout packet

1. Run:
   ```sh
   npm run content:validate
   npm run content:validate:remote:nyc
   npm run content:validate:launch-cohort:nyc
   ```
2. Confirm the artifact still reports `remote_only`, `needs_field_check`, and all publication flags `false`.
3. Assign a scout date, scout identifier, primary route, and reserve route.
4. Copy one checklist per candidate. Preserve candidate and evidence IDs exactly.
5. Check same-day public advisories, weather, construction, closures, and events. These checks may cancel a visit but never establish field verification.

## 2. Conduct the field check

For each stop, the scout must:

1. Observe from a lawful public position; do not trespass, climb, touch protected objects, block circulation, or make purchases.
2. Confirm the exact candidate identity and scoped observable target.
3. Record whether the target is present, unique, legible/observable, and solvable without disclosing the answer.
4. Record actual approach, surface, crossing, obstruction, crowding, lighting, closure, and mobility conditions. Do not infer universal accessibility.
5. Test the intended completion viewpoint and the route segment from the prior stop.
6. Record timestamped evidence references according to the approved retention policy. Do not collect faces, private conversations, precise player trails, or unnecessary personal data.
7. Mark unknown whenever a condition was not observed.
8. Stop immediately for an unsafe condition and notify the content safety owner.

A scout may recommend only: `pass_to_evidence_review`, `replace_with_paired_reserve`, or `pause`.

## 3. Evidence review

The reviewer must verify:

- Candidate/place/evidence IDs resolve to the committed source artifacts.
- Evidence is current, attributable, and depicts the exact target and completion viewpoint.
- All access, safety, closure, staleness, and route questions have explicit observations or remain unknown.
- The clue and authored hints make only observations supported at the site.
- No task requires touching, climbing, purchase, private/interior access, intrusive photography, unsafe crossing, or obstruction.
- The 50 m geofence can represent a safe public completion zone.
- The route is coherent using actual pedestrian access; straight-line metadata is not accepted as route proof.
- A paired reserve has independent evidence if it will be eligible for replacement.

Reject the packet if evidence is missing, stale, ambiguous, or contradicts the target. Safety uncertainty produces `pause`, not publication.

## 4. Explicit lifecycle transition

Only after approval:

1. Create a new versioned evidence record; never overwrite remote evidence as though it were field evidence.
2. Record reviewer, review timestamp, evidence references, observed conditions, recheck date, and decision.
3. Update the linked place, idea, and clue package only through the existing lifecycle contract.
4. Set `field_verified` only for the exact claims observed. Accessibility stays `unknown` unless the approved evidence supports a narrower statement.
5. Keep `published` and `live` false until the complete route and replacements pass validation and release approval.
6. Run all content and launch-cohort validators and preserve their outputs with the release evidence.
7. Require a second explicit publishing action. Field verification is not publication.

## 5. Canary activation

1. Start with a controlled cohort and the approved route only.
2. Confirm durable content-failure reporting, replacement inventory, alerting, and pause permissions are operational.
3. Record the exact content version and replacement mapping.
4. Observe initial sessions directly where consented; do not record raw GPS trails or clue answers in analytics.
5. Review completion, abandonment, support burden, content failures, and safety reports after every early session.
6. Expand only after explicit evidence review; downloads alone are not a success criterion.

## 6. Pause, replace, retire

Pause immediately for:

- Unsafe report or unsafe scout observation.
- Closure, obstruction, construction, missing or materially altered target.
- Incorrect clue/hint or ambiguous destination.
- Inaccessible completion point inconsistent with represented behavior.
- Report persistence/alerting failure.

On pause:

1. Remove the candidate from delivery before investigating.
2. Preserve the report request ID and content version; do not collect unnecessary location or identity data.
3. Use only an independently approved paired reserve. Never auto-promote a remote-only reserve.
4. Re-verify and publish a new content version before reactivation.
5. Retire content when the target or safe completion experience is no longer durable.

## Release evidence required

- Completed field checklists.
- Versioned evidence records and reviewer decisions.
- Validator outputs and commit/build identifiers.
- Route and geofence device test.
- Durable report live read-back and alert test.
- Canary pause/replacement drill.
- Named content safety owner and rollback authority.
