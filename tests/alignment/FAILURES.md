# Counting contracts: red checkpoint

## Scope and provenance

This slice adds infrastructure and failing contracts only. No runtime fix, default
reentry change, generated dungeon, sweep, customer import, install, or push occurred.
All fixtures use one user and seconds relative to 2024-01-15 00:00:00 UTC. The tests
convert those seconds to ISO strings. Expected values were derived from analytics
source before assertions were written; analytics itself was not compiled or run.
This is source-derived contract testing, not differential execution.

- Dungeon-master starting revision: `15a3fea8feba831f3c258c9dbcfbb386421337be`.
- Passing infrastructure checkpoint: `d012a55` (6 regression tests passed).
- Analytics revision: `717286d2d3ed03e9e3f9cb4346e4c6b2e561fb9a`, clean checkout.
- Source root inspected read-only: `/Users/ak/code/analytics`.
- Source paths below are relative to that root. Line numbers refer to this revision,
  not the older source line numbers in dungeon-master's existing comments.
- No proprietary source text is reproduced here.

## Measured results

The counting file has 5 failing assertions and 4 passing controls. Each failure is
an ordinary assertion failure, not an expected-failure marker, skip, or test error.
`reached` below is the zero-based highest reached step for each recorded attempt.

| ID | Fixture and options | Expected | Observed |
| --- | --- | --- | --- |
| C1 | A0 B10 A20 B30 A40; steps A B A; totals, explicit reentry | 2 completions; reached [2,2,0]; step totals [3,2,2] | 1 completion; reached [2,0]; step totals [2,1,1] |
| C2 | A0 B10 A11 B12; steps A B; totals, explicit reentry | 1 completion; reached [1]; step totals [1,1] | 2 completions; reached [1,1]; step totals [2,2] |
| C3 | A0 plan=x, X1200 plan=y, B2400 plan=x; steps A B; HPC plan; sessions | x: 1 completion; reached [1]; step totals [1,1] | x: 0 completions; reached [0]; step totals [1,0] |
| C4-first | A0 without src, B10 src=paid; first touch | src=paid | undefined |
| C4-last | A0 src=paid, B10 without src; last touch | src=paid | undefined |

Passing controls: distinct-edge reentry after three seconds; full-stream session
bridge without HPC; a real 40-minute gap does not complete HPC sessions; both
properties present preserve first/last precedence and explicit-step selection.

## C1: shared-edge reentry

Source: `backend/arb/reader/queries/funnel_query.cpp:1262` identifies a matching
ordered first/last edge; `:1368` requests a second pass for the completion event;
`:1615` bypasses the ordinary completion wait when starting the next funnel;
`:1647` marks the shared edge; `:1663` creates the next history for that event.
Thus A20 closes attempt 1 and anchors attempt 2; A40 closes attempt 2 and anchors
the final partial attempt. Totals must retain that final partial.

Local diagnosis: `lib/verify/funnel-engine.js:588` stores the next index after the
completion event; `:957` resumes there and never replays a shared edge.

Fix spec for the next slice: represent shared-edge restart explicitly for ordered
first/last matches, finalize the old attempt, and use that event once as the next
anchor. Preserve selector matching, anchor bounds, conversion windows, partial
totals, and guaranteed forward progress. Do not globally rewind every completion
or extend this rule to any-order edges without source confirmation. C1 and the
distinct-edge control must pass together; add filtered-edge and no-loop checks.

## C2: completion grace before ordinary reentry

Source: `backend/arb/reader/funnels/history.cpp:25` defines the inclusive 2000ms
ordering allowance; `:696` keeps a completed history mutable during that allowance.
`backend/arb/reader/queries/funnel_query.cpp:1615` checks this before expiry and
`:1663` creates a fresh history only after expiry. The shared-edge exception is
separate. With no window expiry and distinct edges, A11/B12 remain inside the
history completed at B10; they do not become another conversion.

Local diagnosis: `lib/verify/funnel-engine.js:665` stops its completion scan when
no exclusion steps are configured. Its restart index also remains tied to the
completion rather than to the first event past the grace period.

Fix spec: keep the completion history open through the inclusive grace boundary,
even without configured exclusions. Do not replay absorbed events on restart.
Restart on the first eligible event strictly beyond grace, except for C1's
shared-edge case or independent window expiry. Preserve late-exclusion processing,
woRepeat behavior, and the explicit graceperiod=false verifier option. Add 1999ms,
2000ms, and 2001ms boundary checks plus late-exclusion regression checks.

## C3: session derivation precedes HPC partitioning

Source: `api/version_2_0/arb_funnels/validate.py:432` rewrites session counting to
general_wo_repeat with a one-session window. In
`backend/arb/reader/queries/funnel_query.cpp:733`, session-only events update the
per-user ordinal without requiring an HPC bucket; `:748` obtains the per-user
state before HPC routing; `:788` updates it after processing a session-end event.
`backend/arb/reader/funnels/conversion_window.hpp:27` compares session ordinals.
`backend/arb/reader/queries/session_query.cpp:906` splits sessions on strict timeout,
max length, or day change, updating last-event time at `:931`.

The fixture assumes timeout sessions with a 30-minute gap limit, a 24-hour maximum,
UTC, and no session-event exclusions, matching the local sessionizer defaults.
Each full-stream gap is 20 minutes; filtering away X makes an artificial 40-minute
gap. This expectation does not cover arbitrary project session definitions.

Local diagnosis: `lib/verify/funnel-engine.js:1023` partitions events by property,
`:1045` invokes evaluateFunnel on each partition, and `:874` derives ordinals from
that partition rather than the original user stream.

Fix spec: derive session ordinals once from the full user stream before HPC
routing, and carry that context to each bucket's window evaluator. Do not route
wrong-property events as eligible steps. Preserve object identity or an explicit
stable ordinal mapping and preserve public option validation. Both session bridge
controls must pass; cover explicit session windows as well as the sessions preset.

## C4: first/last merges reached-step properties

Source: `backend/arb/reader/funnels/property_set_buffer.cpp:35` merges reached steps
in forward order for last touch and `:43` in reverse order for first touch.
The executable merge predicate at `:191` preserves defined fallback values when
another step is undefined. Its null handling is subtler than the nearby comment:
a null does not overwrite an already defined non-null value. The caller at
`backend/arb/reader/funnels/history.cpp:611` bounds merging by reached and uses the
recorded path order. Explicit STEP selection remains separate.

Local diagnosis: `lib/verify/funnel-engine.js:1059` selects a single snapshot for
first/last, so an absent property on that snapshot loses another reached value.

Fix spec: merge properties across reached steps in the correct direction, without
mutating snapshots. Preserve defined fallback values and implement the source's
actual undefined/null predicate, not a blind object spread. Keep explicit STEP
selection separate. Add partial-path, null/undefined, conflicting-value, snapshot
immutability, and any-order path checks in the fix slice. Current C4 fixtures test
absent properties only; they do not prove the entire null/any-order contract.

## Compatibility gap: totals defaults

Source: `backend/arb/reader/queries/funnel_query.cpp:592` and `:609` enable multiple
histories for general counting. Dungeon-master documents explicit opt-in reentry
in [HOOKS.md](../../HOOKS.md#L538), and defaults reentry to false in
[funnel-engine.js](../../lib/verify/funnel-engine.js#L814). Totals alone therefore
does not imply analytics general-count behavior. This is an existing public
compatibility gap, not an authorization to change the default. All repeat-count
fixtures here specify reentry=true. Decide migration/versioning separately.

## Reproduction and limits

```sh
cd /Users/ak/code/dungeon-master-alignment-work
set -o pipefail
node tests/alignment/run.mjs --preflight 2>&1 | tail -50
node tests/alignment/run.mjs 2>&1 | tail -50
```

The first command passes its build and 2 preflight tests. The full gate builds
first, passes preflight, then returns exit 1 with 5 failed / 10 passed regression
tests (9 counting/control tests and 6 infrastructure/preflight tests).

Narrow reproduction after the build gate:

```sh
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  node node_modules/vitest/vitest.mjs run \
  --config tests/alignment/vitest.config.js tests/alignment/contracts.test.js \
  2>&1 | tail -50
```

All test runs used that OS policy. No external endpoint was probed. The harness
is macOS-only and fails closed elsewhere. It has a shared 600-second hard deadline;
the infrastructure test checks deadline exit during build, not a hung generated
worker. No sweep was run and no sweep fixtures exist yet. No mixed-dungeon proof,
statistical claim, comprehensive source parity, analytics execution, or runtime
repair is claimed. An initial manual build probe with a TS6 flag failed because
the installed compiler is older; the runner's version-aware build gate passes.