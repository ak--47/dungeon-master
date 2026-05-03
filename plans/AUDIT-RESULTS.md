# Audit Findings

**Branch:** `hooks-and-id-mgmt` (11 commits, `dc6597a`..`30d337b`)
**Auditor:** Claude Opus 4.6 (1M context)
**Date:** 2026-05-02
**Method:** Read plan → read code → run tests/typecheck → run full-fidelity dungeon + DuckDB queries → cross-reference claims

---

## Test & Typecheck Baseline

| Check | Agent's claim | Actual |
|-------|---------------|--------|
| `npm test` | 852 pass, 18 skip, 1 fail | **Confirmed** — 852 pass, 18 skip, 1 fail |
| `npm run typecheck` | (not mentioned) | **12 TypeScript errors** — agent didn't run this |
| Flaky test pre-existing | Yes | **Confirmed** — fails identically on `main` |

---

## Critical (ship-blocking)

### C1. `npm run typecheck` fails with 12 errors

Agent never ran typecheck. All 12 errors are in new Phase 4 code:

**`lib/verify/emulate-breakdown.js`** — 6 errors (lines 58-62, 134):
- Lines 58-62: The switch/case dispatcher passes the full `EmulateOptions` union type to each type-specific handler function. TypeScript can't narrow the union through the switch. These are type-annotation issues, not logic bugs — the runtime dispatch is correct.
- Line 134: `conversion_pct` property is dynamically added to objects after their initial push. TS doesn't see it in the original shape.

**`lib/verify/verify-dungeon.js`** — 6 errors (lines 40-41):
- Accesses `.eventData` and `.userProfilesData` on `Result | Result[]`. If someone passes an array of paths, `result.eventData` is `undefined` and `Array.from(undefined)` throws. No current caller triggers this, but it's a latent crash.

**Severity:** The TS errors are type-annotation issues (runtime works). But "typecheck passes" is an implicit project gate and the agent should have run it.

**Fix:** Narrow with type guards or `@ts-ignore` annotations. For `verify-dungeon.js`, add `if (Array.isArray(result)) result = result[0];` guard.

---

### C2. `isAttributionEvent` is typed and documented but never implemented

Plan §3.5 specifies: "When `hasCampaigns: true`, only events with `isAttributionEvent: true` get UTMs (25% of those events)."

`isAttributionEvent` appears in:
- `types.d.ts:665` — field definition with JSDoc
- `types.d.ts:80-85` — referenced in `hasCampaigns` JSDoc

`isAttributionEvent` does NOT appear in:
- `lib/generators/events.js` — UTM stamping logic at lines 93-96 still uses the legacy 25%-of-all-events path
- `lib/core/config-validator.js` — no validation
- `lib/orchestrators/user-loop.js` — no references

This is a typed, documented, publicized API promise with zero implementation behind it. Any dungeon that sets `isAttributionEvent: true` on events gets silently ignored.

**Fix:** Wire it into `events.js` UTM stamping logic, or remove from types and docs until implemented.

---

### C3. `applyFunnelFrequencyBreakdown` has zero test coverage

One of the 5 Phase 4 patterns has no integration test. It's exported from `lib/hook-patterns/index.js:11`, used in the reference dungeon `dungeons/technical/pattern-funnel-frequency.js`, but never imported or called in any test file. The plan §11 says "Each pattern: feed events, run pattern, assert emulator output."

**Fix:** Add a test in `tests/hook-patterns/patterns.test.js` exercising `applyFunnelFrequencyBreakdown` end-to-end.

---

## Major (should fix before merge)

### M1. ~200 lines of dead code from killed features in `user-loop.js`

The config-validator nulls out `subscription`, `attribution`, `geo`, `features`, `anomalies` (lines 577-582 of config-validator.js). But user-loop.js retains full execution branches for all of them:

| Lines | Feature | Status |
|-------|---------|--------|
| 53-58 | Destructured bindings | Dead (always null) |
| 189-225 | Geographic intelligence (37 lines) | Dead |
| 227-244 | Attribution campaign assignment (18 lines) | Dead |
| 256-265 | Campaign/region profile stamping | Dead |
| 268-279 | `featureCtx` population with null fields | Dead |
| 500-518 | Subscription lifecycle injection | Dead |
| 649-651 | Anomaly burst generation call | Dead |
| 718-828 | `generateSubscriptionEvents` function (110 lines) | Dead |
| 878-910 | `generateAnomalyBursts` function (32 lines) | Dead |

The agent's comment at line 52 says "retained only so the existing guards below no-op cleanly" — but this is exactly the kind of backwards-compat shim the project conventions say to avoid. The validator guarantees null; the dead branches should be deleted.

Similarly, `events.js` has dead branches at lines 182-278 for features/anomalies/geo/attribution via `featureCtx`.

**Fix:** Delete all dead branches and their helper functions. The validator null-guard is the single point of defense.

---

### M2. `isStrictEvent` events leak into standalone event generation

`user-loop.js` lines 362-366 build the weighted event pool for standalone generation:

```javascript
const weightedEvents = config.events.reduce((acc, event) => {
    const w = Math.max(1, Math.min(Math.floor(event.weight) || 1, 10));
    for (let i = 0; i < w; i++) acc.push(event);
    return acc;
}, []);
```

This does NOT filter `isStrictEvent` events. Result: events like `Sign Up` (with `isStrictEvent: true`) appear as standalone events outside funnels. DuckDB verification on the `identity-model-verify` dungeon shows users with 24+ Sign Up events when they should have at most 1 (from the funnel).

**Pre-existing or regression?** Pre-existing — the `weightedEvents` code was not modified by the refactor (confirmed via `git diff`). However, the refactor makes this much more visible because pre-refactor, all standalone events got `user_id` 42% of the time. Post-refactor, non-authed users' standalone events are `device_id`-only, making `isStrictEvent` violations conspicuous in Mixpanel Flows.

The config-validator already filters `isStrictEvent` at lines 101 and 442 for `inferFunnels()`, but the standalone event pool in user-loop isn't using the same filter.

**Fix:** Add `.filter(e => !e.isStrictEvent)` before the reduce on line 362.

---

### M3. `subpath exports missing ambient module declarations in `types.d.ts`

The public API (plan §10) exposes three subpath imports:
- `@ak--47/dungeon-master/hook-helpers`
- `@ak--47/dungeon-master/hook-patterns`
- `@ak--47/dungeon-master/verify`

These resolve at runtime (verified via `package.json` exports map at lines 15-17). But `types.d.ts` has no `declare module` blocks for any of them. TypeScript consumers importing from these subpaths get zero type information.

**Fix:** Add ambient module declarations in `types.d.ts`:
```typescript
declare module '@ak--47/dungeon-master/hook-helpers' { ... }
declare module '@ak--47/dungeon-master/hook-patterns' { ... }
declare module '@ak--47/dungeon-master/verify' { ... }
```

---

### M4. Pattern integration test tolerances are too generous

All 4 tests in `tests/hook-patterns/patterns.test.js` use tolerances wide enough that a half-broken or no-op pattern could pass:

| Test | Configured ratio | Asserted minimum | Problem |
|------|-----------------|-----------------|---------|
| `frequencyByFrequency` (line 63) | 3x (high/low) | `>= 2.0` | 1.5x impl passes |
| `aggregateByBin` (line 99) | 4x (high/low) | `>= 2.0` | 2.5x impl passes |
| `ttcBySegment` (line 148) | 8x (trial/enterprise) | `>= 3.0` | 4x impl passes |
| `attributedBySource` (line 193) | 10:5:1 weights | rank-order only | 3:2:1 impl passes |

Worse: for `frequencyByFrequency` and `aggregateByBin`, natural correlation between event counts may already produce a 2x ratio without the pattern doing anything. There are no negative controls (run without the pattern, assert ratio < threshold).

**Fix:** Tighten to ~50% of configured ratio (e.g., `>= 1.5x` for 3x config). Add at least one negative-control test that runs the dungeon without patterns and asserts the ratio is below the threshold.

---

### M5. `my-buddy-stories.test.js` variant ranking was gutted

The story spec says "Variant B > Variant A > Control" for downstream Agenda Generated events. The test (lines 46-49) only asserts variant presence:

```javascript
expect(variants.size).toBeGreaterThanOrEqual(2);
```

This would pass even if the hook that boosts Variant B was completely removed. The agent's justification (IMPLEMENTATION-NOTES.md) is that at `--small` scale the ordering can flip, but the test runs with 1000 users — enough for at least a partial ordering assertion (e.g., Variant B has the highest count).

Additionally, the "inverted-U" Story 2 assertion at line 74 is conditional:
```javascript
if (byBreakdown.has(6)) expect(at3).toBeGreaterThan(at6);
```
If no user answers 6 questions, the right-side-of-U assertion is silently skipped.

**Fix:**
- Assert Variant B has the highest downstream count (partial ordering)
- Make the inverted-U right-side assertion unconditional or fail if the bucket is missing

---

### M6. `avgDevicePerUser:0` + `isAuthEvent` silently undermines identity model

When `avgDevicePerUser: 0` (default), there's no device pool. The identity model's pre-auth `device_only` stamping falls through to the floor guard in `events.js:140-142`, which stamps `user_id` anyway. This means pre-auth events for born-in-dataset users get `user_id` — defeating the purpose of `isAuthEvent` entirely.

The validator doesn't warn. A dungeon author setting `isAuthEvent: true` on an event without `avgDevicePerUser >= 1` gets a completely broken identity model with no indication.

Plan §13 risk #3 calls out the `avgDevicePerUser > 1` + `hasSessionIds: false` case (sticky-per-session is meaningless) but doesn't address this arguably worse case.

**Fix:** Validator should warn when any event has `isAuthEvent: true` but `avgDevicePerUser` resolves to 0. Something like:
```
⚠️ isAuthEvent requires avgDevicePerUser >= 1 to produce pre-auth anonymous events. Set avgDevicePerUser or hasAnonIds: true.
```

---

## Minor (nice to fix)

### m1. `verifyDungeon` exported but never called

Part of the public API per plan §10, exported from `lib/verify/index.js:12`. But zero callers exist — no test, no script, no skill invokes it. The verify-hooks skill doc references it at line 139 but in a comment ("see `lib/verify/verify-dungeon.js`"), not a usage instruction. It's dead API with a latent crash bug (C1 above).

**Fix:** Add at least one test that calls `verifyDungeon` with a simple config + check array. Or remove from public API if it's truly forward-looking.

---

### m2. Stale JSDoc on `makeEvent` and `generateFunnelEvents`

`events.js:19-31` — JSDoc lists 10 parameters; actual signature has 12 (`featureCtx` and `identityCtx` undocumented). `funnels.js:507-516` — JSDoc lists 7; actual has 9. Both are Phase 2 additions. Not harmful but makes the JSDoc misleading for anyone reading the source.

---

### m3. Vestigial parameters in `makeEvent` and `generateUser`

- `makeEvent` parameter `sessionIds` (line 39): never referenced in function body. Session IDs are assigned post-hoc via `assignSessionIds()`. Every caller passes it; it's a no-op.
- `generateUser` parameters `amplitude`, `frequency`, `skew` (line 1159 of utils.js): compute a `daysAgoBorn` value via sine function that is immediately overridden by `bornRecentBias` logic in user-loop.js. Never passed by any caller.

---

### m4. `persona` field inconsistency across hook meta types

`everything` hook meta includes `persona` (user-loop.js:597). `user` hook meta includes `persona` (user-loop.js:288). But `funnel-pre` and `funnel-post` hook meta do NOT include `persona`, even though persona is available at funnel generation time. `HookMetaEverything` in `types.d.ts` also doesn't declare the `persona` field.

---

### m5. `data-quality duplicateRate` test passes with zero duplicates

`tests/advanced-features.test.js:297`: `expect(events.length).toBeGreaterThan(900)` for `duplicateRate: 0.1` on `numEvents: 1000`. Base generation often produces 900+ events without duplicates. The assertion should be `toBeGreaterThan(1000)` to verify duplicates actually increased the count.

---

### m6. `world events injectProps` test threshold too low

`tests/advanced-features.test.js:154`: `expect(withPromo.length).toBeGreaterThan(events.length * 0.5)` for an `injectProps` spanning the full dataset with `affectsEvents: '*'`. Should be close to 100%, not 50%.

---

### m7. Per-session sticky device uses global RNG, not hash-based pick

Plan §3.3 (implementation notes) says: "assign a device from the user's pool to each session deterministically (seeded by user_id + session index)." The implementation at user-loop.js:570 uses `chance.pickone(userDevicePool)`, which is deterministic via the global seed but shifts all assignments if any upstream RNG consumption changes. A hash-based pick would be more robust.

---

### m8. Duplicated inline helpers across hook modules

Five identical `toMs()` copies across `cohort.js:118`, `mutate.js:151`, `timing.js:101`, `inject.js:101`, `emulate-breakdown.js:262`. Two identical `simpleHashFloat()` copies in `funnel-frequency-breakdown.js:73` and `attributed-by-source.js:72`. Functional and not harmful (modules stay self-contained), but a DRY opportunity.

---

## False Alarms (claims that hold up under inspection)

### FA1. "Pre-existing flaky test" claim: CONFIRMED

`tests/hooks.test.js:902` — `expect(dupes.length).toBe(originals.length)` fails 227 vs 228. Tested by running `npm test -- --run tests/hooks.test.js` on code with no local changes (no stash needed — working tree clean). Same failure. Root cause: the hook duplicates events with +1h offset; events in the last hour of the dataset window produce dupes that land past `FIXED_NOW` and get clipped by the post-hook boundary filter at user-loop.js:609-613.

### FA2. Identity model core invariants: CONFIRMED (with caveats)

DuckDB verification on `identity-model-verify` dungeon (1000 users, 34848 events):

| Metric | Expected | Actual | Status |
|--------|----------|--------|--------|
| Stitch events (both user_id + device_id) | Present | 24,136 | OK |
| Device-only events (pre-auth) | Present | 9,994 | OK |
| User-only events (post-auth funnel) | Present | 718 | OK |
| Device distribution (avgDevicePerUser: 2) | ~2 avg | 1.43 avg | See caveat |

**Caveat on device distribution:** The avg devices/user is 1.43, not 2.0. This is because 446/818 authed users have exactly 1 device. The normal distribution with mean=2, sd=1 and floor at 1 produces many 1-device users. The distribution is `{1: 446, 2: 255, 3: 104, 4: 11, 5: 2}` which is reasonable for a floored normal.

**Caveat on stitch events:** Some users show multiple stitch events (up to 38). Investigation reveals this is due to the `isStrictEvent` leak (M2 above) — Sign Up events appearing as standalone events with both user_id and device_id (because the user already authed). Not a stitch-logic bug; it's the same standalone-pool filtering issue.

### FA3. Killed feature skips: CONFIRMED

All 18 `describe.skip` / `test.skip` entries in `tests/advanced-features.test.js` correspond to features explicitly killed in 1.4 (subscription, attribution, geo, features, anomalies). None hide regressions in surviving features (personas, world events, engagement decay, data quality).

### FA4. `attempts.min > max` validation: CONFIRMED

`config-validator.js:176-194` correctly throws when `max < min`. Also coerces non-finite values and clamps `conversionRate` to [0, 100].

### FA5. Mixpanel `$user_id` / `$device_id` naming: NON-ISSUE

Agent's investigation (IMPLEMENTATION-NOTES.md) is correct. `mixpanel-sender.js` already sets `fixData: true` and `v2_compat: true`, which handles the prefix normalization. No engine-side rename needed.

### FA6. Hook meta `attemptsConfig` is `null` (not `undefined`) when omitted: CONFIRMED

`funnels.js:47`: `attemptsConfig: meta.attemptsConfig || null` — resolves correctly to `null`.
`user-loop.js:391`: `const attemptsCfg = firstFunnel.attempts || null` — also `null`.
Matches plan §3.4.

### FA7. Multiple `isAuthEvent` in funnel sequence: CORRECTLY HANDLED

`funnels.js:197-201` uses `break` after finding the first `isAuthEvent`, matching spec §3.5: "Engine looks at the first occurrence."

### FA8. Hook helpers and patterns wiring: CORRECT

All 14 hook-helper atoms are correctly exported and used. All 5 pattern functions are correctly exported. All use the atoms they import correctly. The emulator produces Mixpanel-aligned tables for all 5 analysis types. The `package.json` exports map wires all three subpath exports.

### FA9. Types.d.ts quality: GOOD

All new fields present. JSDoc is dense and behavior-focused (not sloppy). `avgDevicePerUser` default correctly documented as 0. `AttemptsConfig` matches spec. Killed feature types fully removed.

---

## Summary

| Category | Count | Key items |
|----------|-------|-----------|
| Critical | 3 | Typecheck fails, `isAttributionEvent` unimplemented, `applyFunnelFrequencyBreakdown` untested |
| Major | 6 | Dead code, `isStrictEvent` leak, missing TS ambient decls, loose test tolerances, gutted variant test, silent identity model degradation |
| Minor | 8 | Various |
| False alarms | 9 | Core claims hold up |

**Overall assessment:** The identity model core logic is correctly implemented and the hook system is well-designed. The architecture is sound. The agent completed an ambitious 6-phase refactor with largely correct results. The main gaps are: (1) one spec'd feature is typed but unimplemented (`isAttributionEvent`), (2) typecheck was never run, (3) test coverage has real holes (one pattern untested, tolerances too loose, negative controls missing), and (4) ~200 lines of dead code should have been deleted rather than left as no-op branches.
