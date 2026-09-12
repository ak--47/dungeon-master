# final validation after clone repair

validation stayed in `/Users/ak/code/dungeon-master-alignment-work`, branch `alignment/knob-story-proof`. production source commit: `5e0caa55967a3d7c5ad0dbdb5d451e0d053d5dd7`. this includes documentation commit `53ece91`. regression config commit and sweep HEAD: `6df615ec71bf700f7ef26271d06317b8de1d8e19`.

## unit and integration regression passed

one full regression run completed in 20.58 seconds under macOS `sandbox-exec` with `(deny network*)`. 93 files passed. 1,838 tests passed, zero failed, and one existing test was skipped.

| tier | files passed | tests passed | failed | skipped |
| --- | ---: | ---: | ---: | ---: |
| unit | 60 | 1,486 | 0 | 0 |
| integration | 33 | 352 | 0 | 1 |

the existing skip is `progress callback > percentComplete reaches close to 100` in [progress-callback.test.js](../integration/progress-callback.test.js). its comment records that throttled callbacks do not guarantee a completion flush on fast runs. no test or assertion was changed.

[regression-vitest.config.js](regression-vitest.config.js) includes all unit and integration test files, enables globals, disables global setup and setup files, uses one serial fork, and sets a 60-second test timeout. it excludes E2E and standalone industry-generation runners. unit schema checks still inspect existing dungeon definitions. no global data or tmp prune ran. no network-error text appeared in the retained regression output.

command (from the isolated worktree):

```sh
set -o pipefail
sandbox-exec -p '(version 1) (allow default) (deny network*)' env NODE_ENV=test NODE_OPTIONS='' VSCODE_INSPECTOR_OPTIONS='' node node_modules/vitest/vitest.mjs run --config tests/alignment/regression-vitest.config.js --reporter=default --reporter=json --outputFile.json=tmp/final-regression-results.json 2>&1 | sandbox-exec -p '(version 1) (allow default) (deny network*)' tee tmp/final-regression.log | sandbox-exec -p '(version 1) (allow default) (deny network*)' tail -50
```

full logs and structured results remain in ignored local `tmp/final-regression.log` and `tmp/final-regression-results.json`. the pre-existing untracked [repair-vitest.config.js](repair-vitest.config.js) remains unchanged and uncommitted.

## fresh sweep completed after the repair

one sweep started at `2026-09-12T05:52:32.596Z`. it completed in 339.097 seconds within its unchanged 600-second deadline. all 297 cells and 99 three-seed groups completed. no groups were deferred; all required coverage passed.

| verdict | cells |
| --- | ---: |
| supported | 125 |
| insufficient-evidence | 172 |
| diluted | 0 |
| inverse | 0 |
| contractfail | 0 |

594 dungeon generations emitted 17,083,972 events and 2,598,510 standalone rows. the largest dungeon emitted 281,751 events; the largest request was 299,997. peak worker RSS was 602 MiB. no worker, memory, or deadline failure occurred. 42 persona-conversion saturation warnings remain recorded. insufficient-evidence cells do not establish supported effects. aggregate events do not establish single-dungeon capacity.

the sweep passed its TypeScript 5.8.3 build with `--noEmit`, two offline-preflight tests (0.132 seconds), and eight selected infrastructure tests (0.365 seconds). the existing infrastructure name filter skipped three tests. Node was v24.11.1. all children inherited OS network denial.

```sh
set -o pipefail
sandbox-exec -p '(version 1) (allow default) (deny network*)' env NODE_OPTIONS='' VSCODE_INSPECTOR_OPTIONS='' node tests/alignment/run.mjs --sweep --timeout-ms=600000 2>&1 | sandbox-exec -p '(version 1) (allow default) (deny network*)' tee tmp/final-sweep.log | sandbox-exec -p '(version 1) (allow default) (deny network*)' tail -50
```

full output remains in ignored local `tmp/final-sweep.log`. current evidence is [sweep-results.json](sweep-results.json), [sweep-results.md](sweep-results.md), and [SWEEP-RUN.md](SWEEP-RUN.md).

## gate provenance and source fingerprints

the main executor reported its final alignment gate at `5e0caa5`: 175 tests passed across nine files in 60.65 seconds. this executor did not rerun that gate. the inherited dirty [generated-results.json](generated-results.json) has matching start/end hashes, and all 11 recorded hashes match current source. its SHA-256 is `623b5681f07cf85226f329066d319fa0c34ef7afc8c1d37ef6f9474ea771f679`.

the fresh sweep records 77 matching start/end SHA-256 hashes, independently checked against current files. the SHA-256 of `JSON.stringify(sourceAtEnd)` is `bb003a74f409b0777eddcd871f39d2d207ba103d6d96ff70d53ed8121987364e`. full per-file hashes remain in the sweep JSON.

| source | SHA-256 |
| --- | --- |
| `index.js` | `f8e1cee40072ea52295fb13ffea1464d7282a2820e3fc3a16ab9837fbb5ca43b` |
| `lib/orchestrators/user-loop.js` | `a20a588ff51220843ba82c226f8d0d844f9715956341d9d3032eef96645701ac` |
| `lib/generators/events.js` | `677c08c2fac3e700a57e056a7e494428161c891e92331fd3394dfafeee8f877b` |
| `lib/generators/funnels.js` | `c9a6f32281ed321d78338bb6f55d0594ee0b3268c58e253004103ea280178924` |
| `types.d.ts` | `7a4d505ba9046a39786df1863bd645fa858e10e8419d70a4a862abafb8b04520` |

production files, public API, package metadata, and [coverage.json](coverage.json) did not change. coverage instrumentation was not requested or run. no installs, pushes, global pruning, or unsandboxed validation commands ran. Git staging uses explicit paths; commits use `core.hooksPath=/dev/null` under the same sandbox.

the main worktree remained clean at `15a3fea8feba831f3c258c9dbcfbb386421337be`. this work adds only the reusable regression config and validation evidence. the existing repair config remains untracked.