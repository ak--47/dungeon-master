# Shape helper repairs

## compatibility and acceptance revision

DECIDE 1: omitted bounds keep the original full-UTC-day algorithm. The previous
repair's stream-min/max default broke a valid legacy call: events at 12:00 and
12:20, two sessions per week, one event per session, five-minute span. The old
helper fits both sessions within that UTC day. Legacy overfull requests also
remain nonthrowing, even when derived sessions merge. The regressions cover both.

DECIDE 2: `datasetStart` and `datasetEnd` remain additive optional arguments.
The helper has no internal dataset end and cannot infer it from the last event.
Either explicit bound enables constrained placement. An omitted side uses its
corresponding original full-day edge. Impossible bounded capacity and invalid
bounds throw before mutation. Generated session tests now pass both
`meta.datasetStart` and `meta.datasetEnd`; their no-lost-events assertions remain
and also compare exact emitted IDs. Omitted-bound compatibility does not claim
protection against the engine clipping events beyond an unknown dataset end.

DECIDE 3: the strict path assertion now checks the append contract. At `share: 1`,
every eligible recipient gets exactly Search then Help clones, at first-anchor
+2s/+4s, with source payloads and fresh IDs. Original events and array order stay
unchanged at the hook. Emitted payloads and chronological order must match the
complete expected stream, including all competing events. Runtime append behavior
is unchanged.

The separate report-visible check uses `extractFlows`, unique counting, the first
Browse anchor, two forward slots, and no repeat collapse. Treatment must reach
at least 95% branch share and exceed its own pre-hook neutral share by at least
15 percentage points. This is a paired comparison on the same generated users;
separate RNG-consuming treatment/control runs are not claimed to be identical.

These acceptance thresholds are **revised after observation**, for the semantic
reason above. They were not predeclared before the original red. The original
298/300 result and `share: 1 => every immediate branch` failure remain in
[HELPERS-FAILURES.md](tests/alignment/HELPERS-FAILURES.md), unchanged. That result
supports a strong branch effect without proving 100% immediate-branch selection.
The earlier repair record below remains as historical evidence, including its
now-superseded min/max decision and the acceptance test it left red.

## current validation

Both owned files pass together: **28 passed** (13 shape contracts, 15 generated
helper tests), 13.74s, setup 0ms. All identity cases passed in this completed run.
No setup files, default global setup, installs, or network calls were enabled.

- Session treatment totals: 2363/2347/2403 across seeds 17/43/89. Every neutral
	and treatment cell reports zero lost events and zero missing sessions. Exact
	emitted IDs match the pre-hook ledger, including the timeout test.
- Paired first-flow branches: 214 -> 300 of 300, 204 -> 298 of 298,
	213 -> 294 of 295. Final shares are 100%, 100%, 99.66%; lifts are 28.67,
	31.54, 27.46 percentage points. Exact append payload/order assertions pass.
- Six generated boundary runs preserve all records at midnight and 00:05.
	The omitted-bound noon regression and overfull-day regression pass.
- The first completed combined run caught an empty-stream test ledger entry
	under `undefined`. Empty hook arrays now skip that ledger. All nonempty
	owners must still appear in emitted output; no preservation assertion was removed.
- Interrupted or unrelated shared-terminal output was excluded from evidence.
	The completed run is captured locally in `tmp/shape-owned-validation.log`.
- Editor diagnostics are clean for the helper, declarations, and both tests.

```sh
set -o pipefail
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
	node node_modules/vitest/vitest.mjs run \
	--config tests/alignment/vitest.config.js \
	tests/alignment/shape-contracts.test.js \
	tests/alignment/helpers-generated.test.js 2>&1 | tail -50
```

## earlier repair decisions (superseded where noted above)

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

## earlier acceptance assertion requiring coordination

`tests/alignment/helpers-generated.test.js` is not changed. Its original path assertion is `expect.soft(metric / eligible).toBe(1)` for treatment at `share: 1`. FOUND 2 measured 298/300 for seed 89, with exact clone counts. That assertion is stronger than the append contract. The source above supports first-flow measurement but not exclusion of competing traffic. Keep the failure visible for the acceptance owner; add a separate measured Flows branch-lift proof, not only a clone-count proof.

## Reproduction and repair spec

Before production edits, add small fixtures to `tests/alignment/shape-contracts.test.js`:

- Two records, previous-day noon and exact final midnight: retain both inside the original span and produce two sessions.
- A partial final day with an explicit end: no output beyond that bound.
- Two requested sessions inside one 20-minute day slice: explicit atomic capacity failure, no mutation or hidden target reduction.

Implementation bounds each candidate day's capacity, redistributes placements within its week when a partial day fills, and validates all placements before writing timestamps. Session gaps remain strictly above 30 minutes across same-day clusters and below 30 minutes inside each cluster. A midnight endpoint can hold a zero-span cluster. Original week/day selection remains the placement domain; explicit bounds limit those days and can expand their usable portion, not move a user's cadence to unrelated weeks.

## earlier validation results

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