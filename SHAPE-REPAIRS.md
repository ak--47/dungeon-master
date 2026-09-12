# Shape helper repairs

## Contract decisions before implementation

- DECIDE 1: Preserve `applySessionShape`'s original retiming-only contract: same array, same objects, same counts, unchanged non-time fields. Default placement stays inside the original stream's inclusive min/max time span. That span is not an inferred dataset end; it is a conservative safe span for an already-valid input stream.
- DECIDE 2: Add optional `datasetStart` and `datasetEnd` bounds (ISO strings, unix seconds, or unix milliseconds, matching helper time conversion). Hooks can pass `meta.datasetStart` and `meta.datasetEnd` directly. Preserve the existing session-count formula and original-day preference. Compress clusters to fit partial days. If there is insufficient capacity for the requested number of 30-minute-timeout sessions, throw `RangeError` before changing any records. Never silently reduce the target or drop records.
- DECIDE 3: Keep `applyPathBias` append-only. Its original public return contract says the same array is augmented in place; the implementation clones steps after the earliest chronological anchor. It does not reserve space or rewrite competing traffic. `share` selects users for injection, not a guaranteed final branch percentage. No destructive override will be added.

## Source evidence

Mixpanel checkout: `/Users/ak/code/analytics`, revision `717286d2d3ed03e9e3f9cb4346e4c6b2e561fb9a`.

- `backend/arb/reader/queries/session_query.cpp:899-915`: timeout mode splits on strict `gap > session_timeout_ms`, an optional maximum duration, or a calendar-day index change. These tests target the default 30-minute timeout, UTC, no maximum-duration setting.
- `backend/arb/reader/queries/flows_query.cpp:1018-1080`: visible non-anchor events enter the ongoing flow. Appended events cannot exclude intervening original events.
- `backend/arb/reader/queries/flows_query.cpp:1101-1110`: unique counting ignores a new flow once a user started a flow. The first anchor therefore matters, not the first anchor in array order.
- Original `lib/hook-helpers/shape.js:173-195`: retiming only, no additions/drops, same objects; exact cluster formula and no midnight crossing.
- Original `lib/hook-helpers/shape.js:111-134`: first-anchor injection, own-stream templates, same array augmented in place.
- `HOOKS.md`, recipes 4.30/4.31: recipe 4.30 already asks callers to verify effective share rather than assume it landed. Its straight-path example needs an explicit competing-traffic qualification.

## Existing acceptance assertion requiring coordination

`tests/alignment/helpers-generated.test.js` is not changed. Its original path assertion is `expect.soft(metric / eligible).toBe(1)` for treatment at `share: 1`. FOUND 2 measured 298/300 for seed 89, with exact clone counts. That assertion is stronger than the append contract. The source above supports first-flow measurement but not exclusion of competing traffic. Keep the failure visible for the acceptance owner; add a separate measured Flows branch-lift proof, not only a clone-count proof.

## Reproduction and repair spec

Before production edits, add small fixtures to `tests/alignment/shape-contracts.test.js`:

- Two records, previous-day noon and exact final midnight: retain both inside the original span and produce two sessions.
- A partial final day with an explicit end: no output beyond that bound.
- Two requested sessions inside one 20-minute day slice: explicit atomic capacity failure, no mutation or hidden target reduction.

Implementation bounds each candidate day's capacity, redistributes placements within its week when a partial day fills, and validates all placements before writing timestamps. Session gaps remain strictly above 30 minutes across same-day clusters and below 30 minutes inside each cluster. A midnight endpoint can hold a zero-span cluster. Original week/day selection remains the placement domain; explicit bounds limit those days and can expand their usable portion, not move a user's cadence to unrelated weeks.

## Validation results

- Before the helper edit: all three small regressions failed (midnight escape, partial-day escape, absent capacity error).
- Final new contracts: **11 passed**, 1.62s, setup 0ms. Six generated boundary runs cover three seeds and midnight/00:05 endpoints. All preserve exact insert IDs, non-time payloads, derived session counts, and session labels; no future outputs and no event loss. Emitted counts were 1838/1787/1745 at midnight and 1858/1787/1789 at 00:05. Populations were 119-120 users per run.
- Existing unit regressions: **15 passed**, 0.215s, setup 0ms, using temporary `tmp/shape-regression-vitest.config.mjs` (not committed).
- Unmodified generated session/shape acceptance slice: **4 passed, 1 failed, 10 skipped**, 4.63s. Treatment session totals 2365/2347/2403; all seeds report `lostEvents: 0` and `missingSessions: 0`. Timeout contrast still passes.
- Remaining red in the owned acceptance slice: **1**, the documented overclaim at `helpers-generated.test.js:170`. Final seed 89 has 294/295 immediate branches, not 100%. The assertion stays untouched for the acceptance owner.
- New genuine Flows proof uses `extractFlows` with unique counting, one Browse anchor, two forward slots, and no repeat collapse. Pre-hook versus emitted target branches: seed 17 **214 -> 300 / 300 eligible**; seed 43 **204 -> 298 / 298**; seed 89 **213 -> 294 / 295**. All exceed the predeclared 15-percentage-point lift and 90% final-share thresholds. The small collision fixture also proves why 100% is not an append guarantee.
- No editor diagnostics in the helper, helper types, or new tests. Scoped `git diff --check` passed.

Commands used the network-denied sandbox and installed local Vitest:

```sh
sandbox-exec -p '(version 1) (allow default) (deny network*)' node node_modules/vitest/vitest.mjs run --config tests/alignment/vitest.config.js tests/alignment/shape-contracts.test.js
sandbox-exec -p '(version 1) (allow default) (deny network*)' node node_modules/vitest/vitest.mjs run --config tests/alignment/vitest.config.js tests/alignment/helpers-generated.test.js -t 'generated session and shape proofs'
sandbox-exec -p '(version 1) (allow default) (deny network*)' node node_modules/vitest/vitest.mjs run --config tmp/shape-regression-vitest.config.mjs tests/unit/hook-helpers-shape.test.js
```

Full helper-suite attempts were interrupted by concurrent terminal commands; no completed full-suite count is claimed. Concurrent agents changed generation and shared fixtures during this work, so final populations differ from the original FOUND report. No changes were made here to acceptance, fixtures, scenarios, runners, or user-loop. Source evidence is local, not a live Mixpanel query; pruning visibility and arbitrary-share calibration remain outside this repair.