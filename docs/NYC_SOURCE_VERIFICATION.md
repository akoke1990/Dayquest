# NYC Source Registry and Remote Verification v1

This pipeline is an **offline authoring foundation**. It performs no network calls, stores no credentials, does not ingest curator output, and does not alter the player UI or publishing path.

## Artifacts and commands

- Provider contract: `content/nyc/schema/source-registry.schema.v1.json`
- Seed registry: `content/nyc/source-registry.v1.json`
- Claim contract: `content/nyc/schema/remote-verification.schema.v1.json`
- Deterministic compiled artifact: `content/nyc/remote-verification.v1.json`
- Compiler: `scripts/compile-remote-verification.js`
- Validator: `scripts/validate-remote-verification.js`

```bash
npm run content:compile:remote:nyc
npm run content:validate:remote:nyc
npm test
```

The compiler adapts the current 100 source-reviewed candidate claims without changing `content-bank.v1.json`. Missing dates, current-condition checks, access facts, and visual checks remain `null`/`unknown`; every adapted record is `source_reviewed` and `needs_scout`. It never upgrades desk research into a field observation.

## Provider registry

Each provider declares:

- `trust_tier`;
- claim roles in `allowed_uses`;
- `link_only`, metadata/excerpt, or licensed-asset storage policy;
- license and attribution requirements;
- authentication shape, credential environment-variable names, and rate-limit guidance.

The seed covers official NYC sources, Wikimedia Commons, Wikidata, OpenStreetMap, a licensed-imagery placeholder, public first-party/editorial pages, and a lower-trust change-signal placeholder. Registry metadata contains no credential values. Restricted pages are link-only and must not be scraped.

A provider's trust tier is not permission to use it for every claim. For example, lower-trust public change signals may only support `change_signal`; they cannot establish identity, access, or safety.

## Claim and evidence contract

Claims have one role:

`identity`, `coordinates`, `observable_target`, `current_status`, `public_access`, `accessibility`, `historical_context`, `visual_confirmation`, or `change_signal`.

Every evidence item identifies its registered provider, source URL, source date (or `null`), review time (or `null`), freshness policy/status, remote method, attribution, and license. `supports_claim_ids` may connect claims only within the same verification record; dangling and cross-record references fail validation.

Remote methods are source/record/structured-data/map/image/change-signal review. `human_site_check` is deliberately absent and rejected: **remote/source verification and field verification are separate facts**. Existing content-bank field reviews remain the field-verification contract.

## Confidence, risk, decisions, and lifecycle

Confidence is dimensional, never one opaque score: `identity`, `spatial`, `observability`, `currency`, and `access_safety`, each `unknown`/`low`/`medium`/`high`. Risk is `low`, `medium`, or `high`.

Rules compute one decision:

- `canary_eligible` — all required claim roles have fresh, permitted, licensed/attributed evidence; all confidence dimensions are high; public/free/safe access is supported; risk is not high.
- `needs_scout` — evidence is incomplete, stale/unknown, lower confidence, access is unknown, or risk is high.
- `hold` — known private, paid, or unsafe access.
- `reject` — content is explicitly unsupported.

Hard gates run before confidence. A high score cannot make private, paid, unsafe, stale, disallowed, unlicensed, or unsupported material canary-eligible.

The remote lifecycle is `source_reviewed` → `remote_verified` → `canary` → `proven`, with `paused` and `retired`. This is additive and does not rename or reinterpret current content-bank lifecycle values, preserving compatibility with the 100-candidate bank.

## Privacy and deterministic operation

The schema rejects raw route, GPS trace, precise-location/analytics, and device-ID fields. Compilers sort stable IDs and serialize with a final newline, yielding byte-identical output for identical inputs. Editors must add reviewed evidence through durable, versioned inputs; the compiler never calls provider APIs or vendor SDKs.
