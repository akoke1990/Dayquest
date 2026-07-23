# NYC Content Bank v1 — Editor Guide

The v1 bank is an **offline authoring artifact**. It is not read by `lib/quest.js`, `server.js`, or the app, so this slice does not change live quest behavior.

## Files and commands

- Contract: `content/nyc/schema/content-bank.schema.v1.json`
- Baseline source candidates: `content/nyc/source-candidates.v1.json` (preserved input)
- Compiled 100-idea portfolio: `content/nyc/source-candidates.v2.json`
- Durable research tranches: `content/nyc/research/*.v1.json`
- Source-grounded coordinate registry: `content/nyc/research/new-place-coordinates.v1.json`
- NYC data: `content/nyc/content-bank.v1.json`
- Approved-POI + candidate build: `scripts/import-nyc-content-bank.js`
- Validator: `scripts/validate-content-bank.js`
- Source registry / remote verification guide: `docs/NYC_SOURCE_VERIFICATION.md`
- Seed source registry: `content/nyc/source-registry.v1.json`
- Claim-level remote artifact: `content/nyc/remote-verification.v1.json`

```bash
npm run content:compile:candidates:nyc  # deterministic 40 + 60 candidate compile
npm run content:import:nyc  # deterministic rebuild from db/nyc-pois-labeled.json
npm run content:validate  # validate the committed NYC bank
npm run content:compile:remote:nyc  # adapt claim evidence into the remote contract
npm run content:validate:remote:nyc # validate registry, claims, and canary gates
npm test                  # built-in Node tests
```

The importer selects only legacy rows with `status: "approved"`. It derives place IDs from `(source, ext_id)`, preserves source identity and source text, then deterministically merges the separately compiled v2 source-candidate artifact. The portfolio contains the original 40 plus 60 durable research records. They add source-reviewed-but-not-field-verified evidence, `needs_field_verification` hunt ideas, and `candidate` clue packages containing each report's draft riddle and two hints. The artifact also carries all rejected/deferred alternatives so rebuilds never need to guess at them.

Of the new 60 concepts, 18 map by exact stable ID and exact catalog name to existing places. The other 42 create source-derived place IDs. A new place is accepted only when its canonical research source has a stable provider/external ID and the coordinate registry supplies numeric coordinates with a public OpenStreetMap identity, URL, and excerpt. Missing identity or grounded coordinates fails compilation/import rather than triggering name-based guessing. Coordinates remain desk-sourced and do not imply a field check.

For approved POIs without a mapped candidate, the importer deliberately creates:

- places in `needs_source_review`;
- empty `observable_evidence` arrays;
- unknown access, approach, and seasonality fields.

For mapped source candidates, it preserves the exact catalog place ID, cited URL/excerpt, and observable claim. Evidence uses `verification.status: "source_verified"` with `method: "source_review"`; this means desk research only and never a current human site check. No imported record is `field_verified` or `published`.

Re-running either compiler produces byte-identical output for identical inputs. The candidate compiler writes only v2; the bank importer writes only the generated bank. Neither overwrites baseline candidates, research tranches, or the coordinate registry. Edit durable inputs rather than hand-editing generated records, then rebuild.

## Identity and versions

- Place: `place:<source>:<external_id>` (assigned by the importer; never rename it when display names or URLs change).
- Evidence: `evidence:<place-token>:<local-token>`.
- Hunt idea: `idea:nyc:<slug>`.
- Clue package: `clue:nyc:<place-token>:<package-token>`.
- `schema_version` versions the whole contract. `record_version` increments when an individual record changes materially.

References must use IDs, never names or URLs. IDs are immutable; retire obsolete records instead of recycling their IDs.

## Lifecycle

1. `candidate` — captured but not researched.
2. `needs_source_review` — identity exists; sources and claims need review.
3. `needs_field_verification` — sources are acceptable; public observability/access need an on-site check.
4. `field_verified` — current public approach, observable targets, safety, and mobility metadata were checked.
5. `published` — passed the single DayQuest quality bar and both reviews.
6. `retired` — retained for audit/replay identity but not eligible for future publication.

Promotion is explicit. Legacy `approved` is **not** equivalent to v1 `published`.

## Category vocabulary and diversity

Choose one primary category from the schema vocabulary:

`architecture`, `gallery`, `historic_site`, `infrastructure`, `landmark`, `monument_memorial`, `museum`, `other`, `park_garden`, `public_art`, `religious`, `shop_market`, `venue_nightlife`.

Category describes the target a player can look for, not merely why it is historically notable. Editors must intentionally seek varied objects, art, façades, materials, shapes, streetscapes, landscapes, views, spatial relationships, movement, and light. Review area/campaign mixes so architecture and historical sites do not crowd out public art, parks, commerce, infrastructure, and contemporary observable city life.

The v2 compiler normalizes research labels deterministically. Exact v1 categories win. Otherwise ordered category rules map public/transit/map art; monument/memorial; park/garden/landscape/nature/water; architecture; infrastructure/lettering; religious; storefront/shop/food/craft; venue/nightlife; and historic/history, with `other` as the fail-safe fallback. Observable targets use ordered keyword rules for streetscape, facade, landscape, artwork, signage, light, and shape, then fall back to `object`. The original label is preserved as `category_source_value` for audit.

There is no Easy/Tricky/Hard field in v1. Every published package must meet the same quality bar.

## Adding and reviewing a place

1. Add a stable place record or use an imported one. Confirm name, coordinates, source identity, URL, and license.
2. Review every source. Change each accepted source to `reviewed`; reject unsuitable sources explicitly. Preserved `excerpt` text is context only.
3. Add aliases and put the public name plus every answer-leaking alias/former name in `prohibited_aliases`.
4. Add only independently supportable `observable_evidence` records. Each record needs:
   - a discrete claim;
   - an `observable_target` type;
   - one or more `source_ids`;
   - the legal public viewpoint/approach from which it can be seen;
   - stability and seasonality;
   - verification status, method, reviewer, and timestamp.
5. Fill `viewpoint_approach`, `access_safety_mobility`, and `seasonality`. Do not replace unknown values with guesses.
6. Set editorial review metadata and move to `needs_field_verification` only after source review.
7. At the site, verify public visibility, current conditions, legal approach, steps, hours/entry/payment dependency, sensory assumptions, seasonality, and safety. Record what was actually checked.
8. Mark evidence `field_verified`, approve the field review, and promote the place to `field_verified`.

A source excerpt, map photo, model output, or prior legacy approval is not a human site check.

## Adding hunt ideas and clue packages

Create a hunt idea only from existing place and evidence IDs. `observable_target_ids` should show a varied target mix rather than a history-only theme.

A clue package remains `candidate` while being drafted. It must reference one place and only the evidence IDs used by its clue and hints. The v1 structure allows up to three ordered hint rungs; the source-candidate tranche preserves its two researched draft hints without inventing a third. Publication still requires exactly three reviewed rungs.

Before publishing a clue package, editors must verify:

- every factual assertion maps to listed evidence;
- at least one anchor is field-verified and visible from a legal public approach;
- clue/hints contain no prohibited alias or answer leak;
- the package does not require unsafe movement, trespass, purchase, entry, small text, color alone, hearing, or touch unless an approved alternate experience exists;
- three hints form an intentional progression and remain evidence-backed;
- nearby alternatives were checked and the target is uniquely resolvable;
- editorial and field reviews are both `approved`.

Only then may the related place and clue package move to `published`. The validator rejects publication without the required evidence/reviews; human review remains mandatory beyond automated checks.

## Validation and pull-request checklist

```bash
npm run content:validate
npm test
```

In the pull request, report:

- counts by lifecycle and category;
- IDs added, changed, published, or retired;
- source and field-review dates;
- unresolved `unknown` access/seasonality fields;
- category/observable-target balance;
- confirmation that no generated clue was auto-published.

Do not edit `lib/quest.js` or live serving paths as part of content-bank-only changes.
