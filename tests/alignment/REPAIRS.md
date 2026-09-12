# counting contracts: repair results

44 counting contracts pass. the scoped regression gate passes 207 tests across
nine files. installed TypeScript typecheck and declaration build both pass.

runtime commit: `2c1293da76a84c0224a42bde1e93259b9c89861d`.
branch: `alignment/knob-story-proof`.
worktree: `/Users/ak/code/dungeon-master-alignment-work`.

## C1-C4 are green

| contract | repair | added checks |
| --- | --- | --- |
| C1 | an event that records the ordered last step and matches the ordered first step immediately anchors the next attempt | both edge selectors, exclusive anchor bound, strict window expiry, any-order edge exclusion, equal-time forward progress, single-step termination |
| C2 | completed histories absorb events through inclusive 2000ms grace; restart consumes no absorbed event twice | 1999/2000/2001ms, unrelated post-grace event, grace disabled, independent window expiry, late exclusions, shared-edge exclusion exception, woRepeat, unchanged totals default |
| C3 | derive session ordinals from the full stream once, then pass the map through a private evaluator to HPC buckets | sessions preset, explicit session windows with reentry and woRepeat, wrong-property step rejection, public validation |
| C4 | merge reached property snapshots in recorded path order with the source's undefined/null predicate | null/undefined matrix, conflicting and falsy values, frozen snapshots, explicit STEP selection, partial paths, any-order paths with non-monotonic timestamps |

the original nine contracts remain in place. the narrow initial sandbox run
reproduced all five assertion failures and four passing controls. after the
repairs, all 44 pass without skips or expected-failure markers.

three existing assertions conflicted with completion grace. the corrected
reentry fixture now records one completion for A1000/B2000/A3000/B4000. the
totals fixture records two completions for that stream plus A5000/B6000. the
partial-attempt fixture moves its final A from 3000ms to 5000ms, beyond grace,
and still asserts a retained partial attempt. these changes affect only
`tests/unit/funnel-engine.test.js`.

one new late-exclusion fixture initially put the next A at 13s, within 2s of
X12.001. the engine correctly buffered X against that new attempt. the final
fixture anchors at 16s to isolate the completed history's grace boundary.
no exclusion behavior was removed to make the test pass.

## source read before each repair

analytics revision: `717286d2d3ed03e9e3f9cb4346e4c6b2e561fb9a`.
source root: `/Users/ak/code/analytics`, read-only.

- C1: `backend/arb/reader/queries/funnel_query.cpp:1262`, `:1368`, `:1615`, `:1647`, `:1663`.
- C2: `backend/arb/reader/funnels/history.cpp:25`, `:696`; `backend/arb/reader/queries/funnel_query.cpp:1615`, `:1663`.
- C3: `api/version_2_0/arb_funnels/validate.py:432`; `backend/arb/reader/queries/funnel_query.cpp:733`, `:748`, `:788`; `backend/arb/reader/funnels/conversion_window.hpp:27`; `backend/arb/reader/queries/session_query.cpp:906`, `:931`.
- C4: `backend/arb/reader/funnels/property_set_buffer.cpp:35`, `:43`, `:191`; `backend/arb/reader/funnels/history.cpp:611`.

the touch merge follows the executable predicate. null does not replace a
defined non-null value, despite the nearby source comment's simpler wording.

## validation commands and results

all test and compiler processes used the macOS policy below. no endpoint was
probed. commands used installed packages, with no `npx` or installs.

```sh
cd /Users/ak/code/dungeon-master-alignment-work
set -o pipefail
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  node node_modules/vitest/vitest.mjs run \
  --config tests/alignment/vitest.config.js tests/alignment/contracts.test.js \
  2>&1 | tail -50
```

result: 44 passed. initial result before edits: 5 failed, 4 passed.

```sh
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  node node_modules/vitest/vitest.mjs run \
  --config tests/alignment/repair-vitest.config.js 2>&1 | tail -50
```

result: 207 passed across the contracts file and these eight unit files:

| file under `tests/unit/` | passing tests |
| --- | ---: |
| `funnel-engine.test.js` | 63 |
| `funnel-session-window.test.js` | 18 |
| `session-metrics.test.js` | 18 |
| `step0-anchored-trends.test.js` | 12 |
| `any-order-funnel.test.js` | 19 |
| `funnel-frequency-modes.test.js` | 16 |
| `ttc-details.test.js` | 12 |
| `apply-funnel-defaults.test.js` | 5 |

the temporary repair config remains local and untracked for reruns. it includes
only those files and contracts, uses one fork, disables concurrent tests, and
sets both `globalSetup` and `setupFiles` to empty arrays. the shared alignment
config and runner were not edited.

```sh
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  node node_modules/typescript/bin/tsc --noEmit
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  node node_modules/typescript/bin/tsc --project tsconfig.build.json
git diff --check
```

both compiler commands and diff checks pass. an initial typecheck rejected
`Object.hasOwn` under this repo's configured library target. the repair uses
`Object.prototype.hasOwnProperty.call` and both compiler gates pass afterward.

## compatibility and limits

`reentry` still defaults to `false`, including `countMode: 'totals'`. this
preserves the documented public compatibility gap with analytics general
counting. no default migration occurred. HPC session checks retain local
30-minute timeout, 24-hour maximum, UTC day boundaries, and no project-specific
session exclusions.

these are source-derived local contracts. analytics was not compiled or run.
no differential execution, generated trend proof, sweep, customer evaluation,
network access, import, install, or push occurred in this repair slice. the
default full suite was not run because its global setup deletes tmp/data.

the other executor owns generated alignment files. those files, the red
`FAILURES.md` record, and alignment infrastructure were not edited or staged.
commits use explicit paths and disable Git hooks to prevent unsandboxed setup;
the sandboxed tests and compiler gates ran before committing.

## C1 follow-up: shared-edge finalization does not require reentry

red/spec commit: `c0a2c2e`. this follow-up changes only
`lib/verify/funnel-engine.js`, `tests/alignment/contracts.test.js`, and this
appendix. earlier results above describe the original repair.

source re-read first: analytics `backend/arb/reader/queries/funnel_query.cpp`
at 1368 sets the shared-edge flag without a count-mode restriction. at 1615,
the history finalizes before the incoming event can apply exclusions. the
decision to stop searching comes afterward, at 1651-1668.

the exact repro uses seconds relative to `2024-01-15T00:00:00.000Z`:
`A0 B10 A20 X21`, steps `A B A`, and `exclusionSteps: [{ event: 'X' }]`.
with reentry omitted, the old matcher returned `completed: false, reached: 1`.
the contract requires `completed: true, reached: 2`.

28 new checks cover direct and HPC evaluation. each checks omitted options,
explicit `reentry: false`, explicit uniques, and totals with reentry omitted
or false. nonshared `A B C` completions still accept the late exclusion.
separate totals controls include a second complete path and require exactly
one attempt, anchored at the original A0.

the repair separates `sharedEdgeCompleted` from `restartSharedEdge`.
shared-edge completion ends the current scan even when replay is disabled.
only restart permission lets the next scan reuse the completion event.
`woRepeat` keeps its window-only finalization. public defaults and signatures
are unchanged.

completed focused command, before and immediately after the repair:

```sh
cd /Users/ak/code/dungeon-master-alignment-work
set -o pipefail
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  node node_modules/vitest/vitest.mjs run \
  --config tests/alignment/repair-vitest.config.js \
  tests/alignment/contracts.test.js \
  -t 'C1: shared-edge finalization without reentry' 2>&1 | tail -50
```

red: 12 failed, 16 passed, 44 unselected. green: 28 passed, 44 unselected.
the red/spec commit preceded every production edit in this follow-up.

completed full regression command:

```sh
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  node /Users/ak/code/dungeon-master-alignment-work/node_modules/vitest/vitest.mjs run \
  --config /Users/ak/code/dungeon-master-alignment-work/tests/alignment/repair-vitest.config.js \
  2>&1 | tail -50
```

result: 235 passed across nine files, including all 72 contracts and 163
existing funnel unit tests. no skipped tests in the full gate. the completed
run started at 01:13:39 and took 1.52s. editor diagnostics found no errors in
the two code files. one earlier full-run tool response showed another
executor's command and was discarded as evidence.

all Vitest runs used the installed local package and denied network access.
the repair config disabled global setup and pruning. no install, network,
push, public API edit, or other production edit occurred in this follow-up.
other executors' changes remain outside these commits.