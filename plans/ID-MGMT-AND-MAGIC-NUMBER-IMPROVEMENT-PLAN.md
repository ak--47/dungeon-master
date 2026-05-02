# ID-MGMT-AND-MAGIC-NUMBER-IMPROVEMENT-PLAN.md

**Status:** Draft, ready for autonomous overnight execution
**Author:** Claude (grill-me session with AK, 2026-05-02)
**Scope:** Refactor identity management + magic-number hook tooling + skill split
**Backwards compat:** Strictly additive. No breaking changes to dungeon format.

---

## 1. Context

### Pain points in current dungeon-master

1. **Identity is incoherent.** Every event independently rolls a 42% chance of getting `user_id` stamped. `hasAnonIds: true` adds random `anonymousIds[]` and per-event picks one for `device_id`. Result: users appear "doing things" before their `Sign Up` event in Mixpanel Flows reports (see screenshot 1 of the my-buddy verification). There is no model of pre-auth → post-auth identity transition. `isFirstFunnel` runs once but does not interact with identity.

2. **No multi-attempt signup.** Real users land, abandon, come back, and try again. Today: each user does the first funnel exactly once (or skips it). No retry semantics.

3. **No multi-device modeling.** Power users use multiple devices. Today: `device_id` per event is a random pick, not sticky to a session/device.

4. **Magic-number hooks don't map to Mixpanel's analyses.** Mixpanel exposes "Frequency Distribution of Event A by Frequency per User of Event B" (Insights), the same in Funnels (frequency-per-user breakdown), aggregate-per-user breakdowns, time-to-convert breakdowns, and "Attributed by". Today's hook patterns produce broad inverted-U distributions but don't reliably produce these specific table shapes. There is no helper API to write these patterns idiomatically.

5. **`create-dungeon` skill does too much.** Schema design + hook engineering + verification all live in one skill. Skill prompt is huge and LLMs lose context. No clean way to engineer hooks against an existing dungeon.

6. **Phase 2 features (subscription, attribution, geo, features, anomalies) duplicate hook capability** in some cases and add type-surface noise. They make the dungeon config harder for LLMs to reason about.

7. **`types.d.ts` does not exhaustively encode behavior.** LLMs reading it cannot know that `hasAnonIds: true` produces random per-event device assignment, that `isFirstFunnel` only fires once, etc. JSDoc must be the single source of truth for dungeon authors (especially LLM authors).

### What this plan delivers

- A coherent, opt-in identity model: per-user device pool, sticky session→device, isFirstFunnel pre/stitch/post identity stamping, multi-attempt signup
- An exposed hook-helper API (atoms + patterns) that lets `write-hooks` skill produce Mixpanel-analysis-aligned data with concise hook code
- A Mixpanel breakdown emulator that produces the exact table shapes Mixpanel shows, for verifier-side and consumer-side use
- A 3-skill pipeline: `create-dungeon` (schema + all config knobs) → `write-hooks` (hooks only, no flag-stamping) → `verify-hooks` (uses emulator)
- A trimmed Phase 2 entity surface (kill subscription, attribution, geo, features, anomalies; replace attribution with `isAttributionEvent` event flag)
- A rewritten `types.d.ts` with full JSDoc as the single source of truth

---

## 2. Decisions locked (recap of grill session)

| # | Decision |
|---|----------|
| Q1 | Hybrid identity model: engine handles default case via `isAuthEvent` flag; hooks act as escape hatch for advanced cases |
| Q2 | `attempts: { min, max, conversionRate }` is an additive param on ANY funnel. Hook meta exposes `isFirstFunnel`, `isBorn`, `attemptsConfig`, `attemptNumber`, `totalAttempts`, `isFinalAttempt`. `conversionRate` is a number 0–100 (matches existing type) — not a decimal. |
| Q3a | `isAuthEvent: true` is an event-level flag. Multiple events may carry it. Funnel-maker, when running an `isFirstFunnel`, finds the first `isAuthEvent` in the sequence to determine the identity assignment moment. |
| Q3b | For `isFirstFunnel` only: events before the first `isAuthEvent` step are stamped with `device_id` only (pre-auth). The `isAuthEvent` step is the stitch — both `device_id` and `user_id` stamped. Events after the stitch in that funnel get `user_id` only. For non-`isFirstFunnel` funnels: `user_id` only (pre-existing identity). |
| Q3c | New top-level `avgDevicePerUser` (whole number, default 1, ≤0 coerced to 1). When > 1: per-user device pool sized via normal distribution; sessions are sticky to a device; every event gets `user_id + device_id`. The pre/post-auth split with the stitch is shown only in `isFirstFunnel` runs for born-in-dataset users. |
| Q4 | `hasAnonIds: true` is now an alias for `avgDevicePerUser: 1`. Both work. Old field marked `@deprecated, prefer avgDevicePerUser` in JSDoc. |
| Q5 | Magic numbers via hook helpers (no new top-level config entity). Atoms + patterns expose the analytical primitives Mixpanel needs. |
| Q6 | Both atoms (composable) AND patterns (built on atoms) exist. All exposed as public package exports. Helpers MUST have unit tests + reference-dungeon proof. |
| Q7 | Public API: `utils`, `validate`, `hook-helpers`, `hook-patterns`, `verify` (`verifyDungeon` function + `emulateBreakdown` Mixpanel emulator). |
| Q8a | Kill from engine: `subscription`, `attribution`, `geo`, `features`, `anomalies`. Keep: `personas`, `worldEvents`, `engagementDecay`, `dataQuality`. Replace `attribution` with new `isAttributionEvent: true` event flag (25% UTM stamp on flagged events). Backwards-compat: `hasCampaigns: true` with no `isAttributionEvent`-flagged events → randomly stamp UTMs on ~25% of events (current behavior). |
| Q8b | No mass migration of existing dungeons. Killed configs are silently ignored. Hook rework on legacy dungeons is a separate future phase. |
| Q9 | 6 phases, sequenced types → identity → atoms → patterns+emulator → skills → reference dungeons. Plan file lives at project root. |

### Key constraints

- **Strictly additive** to dungeon config (no breaking changes for opt-out users)
- **`types.d.ts` is the source of truth** — every behavior nuance encoded in JSDoc
- **No flag-stamping in hooks.** Hooks may add config-defined properties; never add cohort-label flags like `is_whale = true`
- **`create-dungeon` skill scope:** schema + ALL config knobs (event weights, funnel `props`, `timeToConvert`, `conversionRate`, `attempts`, `isAuthEvent`, `isAttributionEvent`, `avgDevicePerUser`, etc.). Realistic baseline dataset on its own — no engineered story trends
- **`write-hooks` skill scope:** hook code only. May add new properties to the schema only when the hook can't work with the existing schema. Never flag-stamps
- **Skills last.** Implement skills after engine + helpers + emulator are working and reference dungeons pass verification

---

## 3. Architecture changes

### 3.1 Identity model

Per-user lifecycle, after this plan:

```
Pre-existing user (born before dataset window):
  All events: { user_id, device_id }   (already stitched before window)
  device_id is sticky per session; user has avgDevicePerUser-sized pool

Born-in-dataset user, attempt N of N (final attempt):
  Pre-auth events (before first isAuthEvent in funnel sequence):
    { device_id }
  Stitch event (the first isAuthEvent in the funnel sequence):
    { user_id, device_id }   <-- THE one record with both stamped
  Post-auth events in same funnel:
    { user_id }              <-- no device_id
  All subsequent events outside isFirstFunnel:
    { user_id, device_id }   (per-session sticky device pick)

Born-in-dataset user, attempt 1..N-1 (failed prior attempts):
  All events from these attempts: { device_id } only (pre-auth, never stitched)
```

### 3.2 Funnel `attempts` semantics

```js
{
  sequence: [...],
  isFirstFunnel: true,         // existing
  conversionRate: 70,          // existing — applies to FINAL attempt
  attempts: {                  // NEW (additive, optional)
    min: 0,                    // 0 = single attempt (default behavior)
    max: 3,                    // upper bound on number of failed prior attempts
    conversionRate: 70         // overrides funnel.conversionRate for the final attempt
                               // (omit = inherit funnel.conversionRate)
  }
}
```

- `attempts.min` and `attempts.max` describe the count of **failed prior attempts**, not total attempts.
- Each prior attempt = a partial funnel run that drops out at a random step before reaching any `isAuthEvent`. The events generated belong to the user's pre-auth event stream.
- The final attempt uses `attempts.conversionRate` (or falls back to funnel `conversionRate`) and either completes (reaches the `isAuthEvent` and beyond) or abandons.
- For non-isFirstFunnel funnels, each attempt is independent (treats like multiple usage sessions, e.g., abandon-cart).

### 3.3 Multi-device model (`avgDevicePerUser`)

```js
{
  avgDevicePerUser: 1   // top-level (whole number, default 1, ≤0 → 1)
}
```

- `1` (default) = one device per user. Every event with a device gets the user's single device_id.
- `>1` = pick number of devices per user from a normal distribution centered on this value (clamped ≥1, integer-rounded). Each user has a device pool of that size. Each session sticks to one device picked from the user's pool.
- `hasAnonIds: true` is an alias for `avgDevicePerUser: 1` (deprecation notice in JSDoc).
- Default `avgDevicePerUser` for legacy dungeons that don't set it AND don't set `hasAnonIds: true`: `0` (no device_id stamping at all). This preserves current backwards compat — only opting in (either via the alias or explicit `avgDevicePerUser`) activates the new device model.

### 3.4 Hook meta additions

`type === "funnel-pre"` and `type === "funnel-post"`:
- `meta.isFirstFunnel: boolean`
- `meta.isBorn: boolean`                        // is this user born in dataset
- `meta.attemptsConfig: AttemptsConfig | null`
- `meta.attemptNumber: number`                   // 1..totalAttempts (1-indexed)
- `meta.totalAttempts: number`                   // resolved from attempts.{min,max}
- `meta.isFinalAttempt: boolean`                 // attemptNumber === totalAttempts

`type === "everything"`:
- `meta.authTime: number | null`                 // unix ms of stitch event, null if user never authed
- `meta.isPreAuth(event): boolean`               // helper bound to user's authTime

These let hooks branch on identity context cleanly.

### 3.5 New event flags

```js
{
  event: "Sign Up",
  isFirstEvent: true,          // existing
  isAuthEvent: true,           // NEW — marks identity transition moment
  isAttributionEvent: true,    // NEW — 25% chance gets UTMs stamped on this event
  // ...
}
```

- `isAuthEvent`: any number of events may carry this flag. Engine looks at the first occurrence in the user's stream when handling identity stitching. Inside an `isFirstFunnel` sequence, this is the stitch step.
- `isAttributionEvent`: replaces the killed `attribution` config. When `hasCampaigns: true`, only events with this flag get UTMs (25% of those events). If `hasCampaigns: true` and no events carry the flag → backwards-compat: ~25% of all events get UTMs (current behavior).

---

## 4. Phase 1 — Types audit + kill list

**Acceptance criteria:**
- `types.d.ts` rewritten: every public field has full JSDoc explaining behavior, defaults, interactions
- Killed entities removed from `Dungeon` interface
- New fields added with JSDoc encoding the rules in Section 3
- `validateDungeonConfig` updated: silently ignores killed config keys (logs a single deprecation warning per dungeon)
- All existing dungeons continue to load + run (regression test: run all `dungeons/vertical/*` and `dungeons/technical/*` at small scale, confirm no exceptions)

**Files to modify:**
- `types.d.ts` (full rewrite of relevant sections; preserve names that survive)
- `lib/core/config-validator.js` (silently strip killed fields, log deprecation warning, validate new fields)

**New fields in types.d.ts:**
- `Dungeon.avgDevicePerUser?: number` — JSDoc must encode: whole number, default 1, ≤0 → 1, 1 = single device, >1 = multi-device pool with sticky session
- `EventConfig.isAuthEvent?: boolean` — JSDoc must encode: marks identity transition; multiple events can carry it; first occurrence in user stream is the stitch when in isFirstFunnel
- `EventConfig.isAttributionEvent?: boolean` — JSDoc must encode: 25% UTM stamp; backwards-compat fallback to hasCampaigns behavior
- `Funnel.attempts?: AttemptsConfig` — JSDoc must encode: failed-prior-attempt count, conversionRate override, isFirstFunnel-vs-usage semantics

**Deprecated fields (keep working, mark `@deprecated` in JSDoc):**
- `Dungeon.hasAnonIds` → "Prefer `avgDevicePerUser`. `true` is an alias for `avgDevicePerUser: 1`."

**Killed fields (remove from interface, ignore at runtime, log one warning):**
- `Dungeon.subscription`
- `Dungeon.attribution`
- `Dungeon.geo`
- `Dungeon.features`
- `Dungeon.anomalies`

**JSDoc style guide for this audit:**
- Each field gets: short summary + Default + Behavior + Interactions (with related fields) + Backwards-compat notes
- For boolean flags, document what `true` AND `false` produce
- For numeric ranges, document min/max/typical
- For object configs, document each sub-field
- Cross-reference: `@see` tags between related fields (`hasAnonIds` ↔ `avgDevicePerUser`, `isAuthEvent` ↔ `isFirstFunnel.attempts`)

**Verification gate:**
- `npm test` passes
- `node scripts/run-many.mjs dungeons/vertical --parallel 4` runs all verticals at default scale without errors
- `node scripts/verify-runner.mjs dungeons/user/my-buddy.js verify-mybuddy --small` still PASSes its 3 hooks (sanity check that the audit didn't break the existing model)

---

## 5. Phase 2 — Identity model

**Acceptance criteria:**
- The identity model in Section 3.1 is implemented end-to-end
- Born-in-dataset users with `isAuthEvent` in their first funnel produce exactly one stitch record (event with both `user_id` and `device_id`)
- Pre-auth events in the first funnel attempts are stamped with `device_id` only
- Post-auth events in the first funnel are stamped with `user_id` only
- Non-isFirstFunnel events (and pre-existing user events) are stamped per the multi-device rules
- `attempts` config produces the configured number of pre-auth attempts
- All hook meta additions are populated correctly

**Files to modify:**
- `lib/orchestrators/user-loop.js` — main orchestration: per-user identity setup, pre/post-auth event partitioning, attempts loop
- `lib/generators/events.js` — remove the random 42% `user_id` dice; honor identity context passed in by user-loop
- `lib/generators/funnels.js` — surface `attempts`-aware iteration; populate funnel-pre/post hook meta
- `lib/utils/utils.js` — `generateUser` updated for `avgDevicePerUser` device pool sizing
- `lib/core/context.js` — add identity context primitives if needed

**Implementation notes:**
- Device pool per user: `numDevices = max(1, round(normalDist(avgDevicePerUser, sd=avgDevicePerUser/2)))`. If `avgDevicePerUser === 1`, always 1.
- Session→device sticky mapping: when sessions are computed, assign a device from the user's pool to each session deterministically (seeded by user_id + session index). All events in that session get that `device_id`.
- For users with `avgDevicePerUser === 0` (the legacy default) and no `hasAnonIds: true`: no `device_id` stamping anywhere. Backwards compat preserved.
- `attempts` loop:
  - Resolve `totalAttempts = chance.integer({ min: attempts.min, max: attempts.max }) + 1` (the +1 is the final attempt)
  - For attempts 1..N-1 (failed): run a truncated funnel sequence, dropping at a random pre-auth step, no `isAuthEvent` event fires
  - For attempt N (final): run normally; convert per `attempts.conversionRate || funnel.conversionRate`
- For an `isFirstFunnel` user whose final attempt does NOT convert: user remains in pre-auth state forever (no events ever get `user_id`). Realistic.

**Verification gate:**
- New `tests/identity-model.test.js` — Vitest tests for:
  - Single-attempt isFirstFunnel: exactly 1 stitch record per converted user, 0 stitch records per non-converted user
  - Multi-attempt isFirstFunnel: prior attempts have only device_id; final converted attempt produces stitch
  - Multi-device user: events across different sessions have different device_ids, but all share user_id (post-auth)
  - Pre-existing user: every event has user_id (no anon-only events)
  - Backwards compat: dungeon without `isAuthEvent`, `attempts`, or `avgDevicePerUser` produces same event counts as before (within tolerance)
- DuckDB verification on a small reference dungeon (use a `dungeons/technical/` dungeon — see Phase 6 ad-hoc testing notes):
  - `SELECT COUNT(*) FROM events WHERE user_id IS NOT NULL AND device_id IS NOT NULL` — count of stitch records ≈ count of converted born-in-dataset users
  - `SELECT COUNT(DISTINCT device_id) per user_id` — distribution matches `avgDevicePerUser` config

---

## 6. Phase 3 — Hook helpers (atoms)

**Acceptance criteria:**
- `lib/hook-helpers/` directory exists with one file per logical group
- Every atom has unit tests in `tests/hook-helpers/*.test.js`
- Atoms exported from `@ak--47/dungeon-master/hook-helpers` package subpath
- JSDoc on every atom explains: signature, mutation behavior, when to call from which hook type, gotchas

**Atom catalog (initial set — extend as patterns reveal needs):**

```
lib/hook-helpers/
├── cohort.js
│   ├── binUsersByEventCount(events, eventName, bins)
│   │     → 'low' | 'sweet' | 'over' | <custom-key>
│   ├── binUsersByEventInRange(events, eventName, startTime, endTime, bins)
│   ├── countEventsBetween(events, eventA, eventB)         // count events between first A and first B
│   └── userInProfileSegment(profile, segmentKey, segmentValues)
├── mutate.js
│   ├── cloneEvent(template, overrides)                     // returns new event with spread+override
│   ├── dropEventsWhere(events, predicate)                  // mutates in place; returns count dropped
│   ├── scaleEventCount(events, eventName, factor)          // clones to upscale, drops to downscale
│   ├── scalePropertyValue(events, predicate, propertyName, factor)
│   └── shiftEventTime(event, deltaMs)
├── timing.js
│   ├── scaleTimingBetween(events, eventA, eventB, factor)  // adjust user's earliest A→B gap by factor
│   ├── scaleFunnelTTC(funnelEvents, factor)                // for use inside funnel-post
│   └── findFirstSequence(events, [eventNames], maxGapMin)  // detect ordered sequence within window
├── inject.js
│   ├── injectAfterEvent(events, sourceEvent, templateEvent, gapMs, overrides)
│   ├── injectBetween(events, eventA, eventB, templateEvent, overrides)
│   └── injectBurst(events, templateEvent, count, anchorTime, spreadMs)
└── identity.js (new — wraps Phase 2 primitives for hook authors)
    ├── meta.authTime     (already in meta, exposed here for clarity)
    ├── meta.isPreAuth(event)
    ├── isPreAuthEvent(event, authTime)
    └── splitByAuth(events, authTime)  → { preAuth: [], postAuth: [], stitch: event | null }
```

**Files to modify:**
- `package.json` — add `exports['./hook-helpers']`
- `lib/hook-helpers/index.js` — re-exports from sub-files

**Verification gate:**
- `npm test tests/hook-helpers/` passes
- A test fixture dungeon in `dungeons/technical/` is updated to use ≥3 atoms, verifies via DuckDB query that the atom-driven mutation produces the expected pattern (this is one of the "ad-hoc testing" cases mentioned by AK)

---

## 7. Phase 4 — Hook patterns + Mixpanel breakdown emulator

**Acceptance criteria:**
- `lib/hook-patterns/` exists. Each pattern is a high-level recipe built on atoms
- Each pattern has a reference dungeon under `dungeons/technical/` that exercises it
- Each pattern's reference dungeon, when run + queried via the emulator, produces a Mixpanel-aligned table that matches expected ratios (asserted in test)
- Mixpanel breakdown emulator exists at `lib/verify/emulate-breakdown.js` and is exported as `emulateBreakdown` from `@ak--47/dungeon-master/verify`

**Initial pattern catalog (one per Mixpanel analysis type):**

```
lib/hook-patterns/
├── frequency-by-frequency.js
│   └── applyFrequencyByFrequency(events, profile, {
│         cohortEvent, cohortPeriod: 'all'|'week'|'day',
│         bins: { name → range },
│         targetEvent, multipliers: { binName → number }
│       })
│       Engineers the count(target) ↔ count(cohort) joint distribution.
├── funnel-frequency-breakdown.js
│   └── applyFunnelFrequencyBreakdown(events, profile, funnelEvents, {
│         cohortEvent, bins, dropMultipliers: { binName → number }
│       })
│       For use inside funnel-post; varies completion at the final step by user's count of cohortEvent.
├── aggregate-per-user-by-bin.js
│   └── applyAggregateByBin(events, profile, {
│         cohortEvent, bins, propertyName, deltas: { binName → number }
│       })
│       Adjusts the average of property X per user by their cohort bin.
├── time-to-convert-by-segment.js
│   └── applyTTCBySegment(funnelEvents, profile, {
│         segmentKey, factors: { segmentValue → number }
│       })
│       Funnel-post helper; scales gaps. Documented caveat about MIN-to-MIN cross-event SQL.
└── attributed-by-source.js
    └── applyAttributedBySource(events, profile, {
          sourceEvent, sourceProperty,
          downstreamEvent, weights: { sourceValue → number }
        })
        Stamps a downstream property based on the value of a preceding event's property,
        weighted to produce specific attribution patterns.
```

**Mixpanel breakdown emulator API:**

```js
import { emulateBreakdown } from '@ak--47/dungeon-master/verify';

// Frequency × Frequency (Insights)
const tbl = emulateBreakdown(events, {
  type: 'frequencyByFrequency',
  metricEvent: 'Join Meeting',
  breakdownByFrequencyOf: 'Complete Action Item',
  perUser: true
});
// → [{ metric_freq, breakdown_freq, user_count }]

// Funnel frequency breakdown
const tbl = emulateBreakdown(events, {
  type: 'funnelFrequency',
  steps: ['Sign Up', 'Onboarding Question', 'Complete Action Item'],
  breakdownByFrequencyOf: 'Onboarding Question'
});
// → [{ step, breakdown_freq, conversions, conversion_pct }]

// Aggregate per user
const tbl = emulateBreakdown(events, {
  type: 'aggregatePerUser',
  event: 'Submit Feedback',
  property: 'Rating',
  agg: 'avg',
  breakdownByFrequencyOf: 'Complete Action Item'
});

// Time to convert
const tbl = emulateBreakdown(events, {
  type: 'timeToConvert',
  fromEvent: 'Sign Up',
  toEvent: 'Complete Action Item',
  breakdownByUserProperty: 'subscription_tier'
});

// Attributed by
const tbl = emulateBreakdown(events, {
  type: 'attributedBy',
  conversionEvent: 'Sign Up',
  attributionEvent: 'View Shared Page',
  attributionProperty: 'Referrer Type',
  model: 'firstTouch' | 'lastTouch'
});
```

The emulator's output table is what `verify-hooks` skill (Phase 5) uses to assert pattern correctness, AND what consumers can use in their own CI to validate dungeons against expected business shapes.

**Files to create:**
- `lib/hook-patterns/*.js` (one per pattern)
- `lib/hook-patterns/index.js` (re-exports)
- `lib/verify/emulate-breakdown.js` + `lib/verify/index.js`
- `tests/hook-patterns/*.test.js` (one per pattern, asserting emulator output matches expected ratios)
- `dungeons/technical/<pattern-name>.js` (one per pattern, reference impl)
- `package.json` exports for `./hook-patterns` and `./verify`

**Verification gate:**
- All `tests/hook-patterns/*.test.js` PASS
- Each reference dungeon, when run via `verify-runner.mjs`, produces emulator outputs whose ratios are within ±15% of the configured pattern parameters

---

## 8. Phase 5 — Skill split

**Acceptance criteria:**
- Three skills exist with clearly separated scope and docs
- Each skill is invokable independently
- The pipeline `create-dungeon → write-hooks → verify-hooks` works end-to-end on a fresh prompt

### 8.1 `create-dungeon` (refactor)

**Scope:** schema + ALL config knobs. Realistic baseline dataset on its own.

Includes choosing good values for:
- Event names, weights, properties (with realistic distributions via `weighNumRange`, etc.)
- `superProps` and `userProps` (with consistency rules per existing playbook)
- Funnels with `sequence`, `conversionRate`, `timeToConvert`, `weight`, `isFirstFunnel`, `attempts`
- `isAuthEvent`, `isAttributionEvent`, `isFirstEvent`, `isStrictEvent`, `isChurnEvent` flags on events
- Top-level: `datasetStart`, `datasetEnd`, `numUsers`, `avgEventsPerUserPerDay`, `seed`, `format`, device flags, `avgDevicePerUser`, `hasLocation`, `hasCampaigns`, `hasSessionIds`, `hasAvatar`, `macro`, `soup`
- Phase 2 entities that survive: `personas`, `worldEvents`, `engagementDecay`, `dataQuality` (use sparingly; document when each is appropriate)

Excludes:
- Hook function (default to no hook OR a stub that only stamps superProps)
- Engineered story trends (the realistic baseline is the goal; trends are the next skill's job)

Skill doc updates:
- Remove all hook-design content
- Add references to `write-hooks` skill for engineering trends
- Add `isAuthEvent` placement guidelines (recommend placing in isFirstFunnel sequence)
- Add `attempts` configuration guidelines (when to use, typical ranges)
- Add `avgDevicePerUser` guidelines (B2C consumer apps: 1; B2B SaaS: 1-2; multi-device-heavy products: 2-3)

### 8.2 `write-hooks` (NEW)

**Scope:** hook code only. May add new properties to the schema only when the hook can't work with the existing schema. NEVER flag-stamps.

Inputs:
- Path to existing dungeon JS file
- Story intent (free-text or structured)

Outputs:
- Modified dungeon file with `hook:` function appended/replaced
- Documentation block above the config explaining each engineered pattern
- Mixpanel report instructions for each pattern (via emulator)

Skill doc must include:
- The atom catalog from Phase 3 (signature + when to use)
- The pattern catalog from Phase 4 (signature + Mixpanel report it produces)
- Identity-aware patterns (when to use `meta.authTime`, `meta.isPreAuth`)
- Funnel-attempts patterns (use `meta.attemptNumber` to vary behavior across attempts)
- Anti-flag-stamping rules (verbatim from existing `create-dungeon` skill, but stricter — this is a hard wall)
- Verification loop: after writing hooks, run `verify-hooks` skill and iterate until all PASS

### 8.3 `verify-hooks` (refine)

**Scope:** verify hook patterns produce intended Mixpanel-analysis outputs.

Refinements:
- Use `emulateBreakdown` from `lib/verify` instead of hand-rolled DuckDB pivots for the standard analysis types
- Standard checks include: superProp consistency, identity-model invariants (stitch count == converted-born count, no anon-only events for pre-existing users), and per-pattern emulator assertions
- Output report includes: emulator table snapshots so analyst can compare to Mixpanel UI directly
- When verification fails, recommend whether to fix in schema (rare) or in hook (common)

**Verification gate (sprint-level):**
- Run the full pipeline on a fresh prompt: `create-dungeon "AI meeting assistant" → write-hooks "engineer 3 magic numbers including a frequency × frequency pattern" → verify-hooks` produces a passing dungeon with 3 emulator-asserted patterns.

---

## 9. Phase 6 — Reference dungeon refresh

**Acceptance criteria:**
- `dungeons/user/my-buddy.js` migrated to new identity model (uses `isAuthEvent` on `Sign Up`, `attempts` on the shared-link funnel, `avgDevicePerUser` for realism). Hooks rewritten to use atoms + patterns. All 3 stories verify PASS through the emulator.
- One additional `dungeons/vertical/*.js` migrated as a B2B example (recommend `sass.js`)
- `dungeons/technical/*` updated as ad-hoc test cases for hook patterns (each pattern from Phase 4 has at least one technical-dungeon test)

**Verification gate:**
- `node scripts/verify-runner.mjs dungeons/user/my-buddy.js` PASS
- `node scripts/verify-runner.mjs dungeons/technical/simple.js` PASS
- All `dungeons/technical/*` PASS (used as Phase 3-4 verification fixtures)

---

## 10. Public API surface (final)

After this sprint:

```js
// Default export — unchanged
import DUNGEON_MASTER from '@ak--47/dungeon-master';

// Utility primitives — already used in every dungeon config
import {
  weighNumRange, pickAWinner, initChance,
  TimeSoup, weighArray
} from '@ak--47/dungeon-master/utils';

// Validator
import { validateDungeonConfig } from '@ak--47/dungeon-master/validate';

// Hook helpers (Phase 3)
import {
  binUsersByEventCount, countEventsBetween, userInProfileSegment,
  cloneEvent, dropEventsWhere, scaleEventCount, scalePropertyValue, shiftEventTime,
  scaleTimingBetween, scaleFunnelTTC, findFirstSequence,
  injectAfterEvent, injectBetween, injectBurst,
  isPreAuthEvent, splitByAuth
} from '@ak--47/dungeon-master/hook-helpers';

// Hook patterns (Phase 4)
import {
  applyFrequencyByFrequency,
  applyFunnelFrequencyBreakdown,
  applyAggregateByBin,
  applyTTCBySegment,
  applyAttributedBySource
} from '@ak--47/dungeon-master/hook-patterns';

// Verifier + Mixpanel breakdown emulator (Phase 4)
import { verifyDungeon, emulateBreakdown } from '@ak--47/dungeon-master/verify';

// Types
import type { Dungeon, EventConfig, Funnel, AttemptsConfig } from '@ak--47/dungeon-master';
```

---

## 11. Test strategy

| Layer | Where | What |
|-------|-------|------|
| Unit | `tests/hook-helpers/*.test.js` | Each atom: input, mutation, output |
| Unit | `tests/hook-patterns/*.test.js` | Each pattern: feed events, run pattern, assert emulator output |
| Unit | `tests/identity-model.test.js` | Identity stitch counts, multi-device pool, attempts iteration |
| Integration | `tests/sanity.test.js` (extend) | All dungeons load + run without errors after Phase 1 audit |
| Integration | `tests/api-surface.test.js` (new) | Every documented public export resolves |
| End-to-end | `scripts/verify-runner.mjs <every dungeon>` | Reference dungeons PASS |
| Skill-level | Manual: run the pipeline end-to-end | `create-dungeon → write-hooks → verify-hooks` produces a passing dungeon |

CI on PR runs `npm test` + `node scripts/run-many.mjs dungeons/vertical --parallel 4` + `node scripts/verify-runner.mjs` on the reference dungeons.

---

## 12. Backwards compatibility checklist

| Old behavior | New behavior | Migration |
|--------------|--------------|-----------|
| `hasAnonIds: true` | Same: random per-user device pool, but now sticky-per-session under `avgDevicePerUser: 1` semantics | None required; alias works |
| `hasAnonIds: false` (default) | Same: no `device_id` stamping | None required |
| Random 42% per-event `user_id` stamping | **REMOVED.** Identity now deterministic per the new model | Existing dungeons that don't set `isAuthEvent` get every event stamped with `user_id` (same as before-but-cleaner). Existing dungeons that DON'T set `avgDevicePerUser` and DON'T set `hasAnonIds: true` get NO `device_id` (existing behavior). |
| `subscription`, `attribution`, `geo`, `features`, `anomalies` config keys | **REMOVED from engine.** Configs silently ignored; one warning logged | Hooks may need rework in a future phase to recreate these patterns. NOT in scope this sprint. |
| `hasCampaigns: true` (no events flagged) | UTMs randomly stamped on ~25% of events (existing behavior) | None required |
| `hasCampaigns: true` + ≥1 `isAttributionEvent: true` event | UTMs only on those events (25% of them) | Opt-in via the new flag |

---

## 13. Open risks + deferred work

1. **Risk: pre-existing dungeons regress on event counts.** The killed Phase 2 entities and the change in identity stamping may shift event counts in existing dungeons. Mitigation: run all `dungeons/vertical/*` after Phase 1 and Phase 2; document any meaningful deltas.
2. **Risk: emulator drift from real Mixpanel.** Mixpanel can change its breakdown semantics; our emulator must match. Mitigation: emulator implementation references Mixpanel docs in a comment block; add a doc note that emulator is "best-effort approximation."
3. **Risk: `avgDevicePerUser > 1` with `hasSessionIds: false`.** Without sessions, sticky-per-session is meaningless. Validator should warn and fall back to per-event random pick from pool.
4. **Risk: `isAuthEvent` placed mid-funnel with downstream pre-auth events.** Logically inconsistent. Validator should warn but not error (keeps flexibility for advanced authors).
5. **Deferred: subscription rework.** AK said this needs a separate phase. Note placement: `isSubscriptionEvent: true` on event flag style, or revisit in Phase 7.
6. **Deferred: hook-rework migration on legacy dungeons that used killed Phase 2 entities.** Separate sprint.
7. **Deferred: documentation site.** This plan rewrites `types.d.ts` and skill READMEs but does not produce a hosted docs site.

---

## 14. Execution notes for the implementing agent

- **Use `dungeons/technical/*` freely** as ad-hoc testing fixtures. They are not customer-facing stories — feel free to repurpose them to exercise new identity primitives, atoms, patterns, and emulator queries. Each pattern from Phase 4 should land at least one technical dungeon as its reference test case.
- **Phases are gated.** Do not start Phase N+1 until Phase N's verification gate passes.
- **Skills last.** Do not edit `.claude/skills/*` until Phases 1–4 are passing AND at least one reference dungeon (Phase 6 work, can interleave) is migrated and PASSing. Skill content reflects everything learned in earlier phases.
- **Commit per phase.** Use conventional commit prefixes: `phase1:`, `phase2:`, etc. Include phase verification gate output in the commit message.
- **When in doubt, prefer the simpler decision.** This plan locks the major design calls; smaller decisions (parameter names, file organization within a phase, exact JSDoc wording) are at the implementing agent's discretion.
- **Update `CLAUDE.md`** at the end of the sprint to reflect the new architecture, public API, and skill pipeline.

---

## 15. Out of scope (explicitly)

- Changes to `mixpanel-import` integration
- Changes to `mixpanel-sender.js` (output side untouched)
- New Mixpanel-side analyses beyond the 5 listed in Section 7
- Migrating the killed Phase 2 dungeon configs to hook equivalents (separate sprint)
- A hosted docs site
- Performance optimization beyond what falls out of natural cleanup
- Subscription rework (deferred per Q8a)
