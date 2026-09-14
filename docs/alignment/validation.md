# offline alignment checks

Start with [the alignment reference](README.md) for the contracts and
[the 1.8.2 live report](live-report.md) for completed evidence. Reading them
requires no test run. [Inventory](inventory.md) and [coverage](coverage.md)
describe narrower offline slices; [the archive](archive/1.8.1/README.md)
preserves earlier checkpoints and superseded claims.

## run from the repository root

Use installed dependencies from the repository root. These commands install
nothing and do not prune data/tmp. Old worktree paths in archived reports are
historical provenance, not required working directories.

```sh
cd /Users/ak/code/dungeon-master
set -o pipefail
node tests/alignment/run.mjs --preflight 2>&1 | tail -50
node tests/alignment/run.mjs --timeout-ms=600000 2>&1 | tail -50
node tests/alignment/run.mjs --sweep --timeout-ms=600000 2>&1 | tail -50
```

| mode | stages |
| --- | --- |
| `--preflight` | declaration build check with no emit, then offline preflight |
| no mode | build, preflight, serial alignment regression tests |
| `--sweep` | build, preflight, selected sweep infrastructure checks, then bounded generated sweep |

the sweep does **not** run the full regression gate. each command has its own deadline.
the runner uses the installed TypeScript version and adds the TS6 compatibility flag when needed.
the default sweep output replaces [sweep-results.json](../../tests/alignment/sweep-results.json) and
[sweep-results.md](sweep-results.md). use `--output=tests/alignment/.cache/review-sweep`
to retain the committed evidence during a diagnostic rerun.

## the sandbox fails closed

every compiler, test, and generation child runs under macOS
`/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)'`.
descendants inherit network denial. other platforms fail closed.
preflight requires EPERM/EACCES from local TCP bind and connect; refusal, timeout,
or success fails the check. it contacts no external endpoint.

the supervisor enforces a maximum 600-second deadline across each invocation.
`--timeout-ms=N` can lower it, never raise it. expiry kills the active process
group and descendants with SIGKILL and exits 124. SIGINT/SIGTERM also kill the group.
the sweep tests include a real hanging worker and descendant termination check.

network denial does not restrict filesystem writes. the dedicated
[vitest.config.js](../../tests/alignment/vitest.config.js) disables global setup and cleanup and uses
worktree-local cache storage. do not substitute the default suite or the run-dungeon
task; their setup can prune data/tmp.

## sandbox regression commands

[regression-vitest.config.js](../../tests/alignment/regression-vitest.config.js)
selects unit and integration tests with no global setup or setup files. The
1.8.2 release passed 2,022 tests with one existing skip across 93 files.
It excludes E2E and standalone generation runners. Counts are historical,
not fixed acceptance targets for future versions.

```sh
cd /Users/ak/code/dungeon-master
set -o pipefail
sandbox-exec -p '(version 1) (allow default) (deny network*)' env NODE_ENV=test NODE_OPTIONS='' VSCODE_INSPECTOR_OPTIONS='' node node_modules/vitest/vitest.mjs run --config tests/alignment/regression-vitest.config.js 2>&1 | tail -50
```

[repair-vitest.config.js](../../tests/alignment/repair-vitest.config.js) preserves the exact nine-file
selection behind historical 207/235-test evidence: alignment counting contracts
plus eight legacy unit files, with no global setup or setup files. this checkpoint
includes the existing file unchanged after sandboxed syntax validation. a rerun
uses current source, so those historical counts are not a promised result.

```sh
sandbox-exec -p '(version 1) (allow default) (deny network*)' env NODE_OPTIONS='' VSCODE_INSPECTOR_OPTIONS='' node node_modules/vitest/vitest.mjs run --config tests/alignment/repair-vitest.config.js 2>&1 | tail -50
```

these direct Vitest commands use serial forks and per-test timeouts. they do not
use the alignment runner's 600-second process-group deadline.

## use the cheapest check that can disprove a claim

| change | first check |
| --- | --- |
| docs or report locations | documentation and report-writer tests |
| one counting rule | tiny contract fixture and neighboring unit tests |
| hook timing or mutation | paired before/after stream with neutral controls |
| generation/lifecycle | small mixed dungeon, identity/bounds, deterministic rerun |
| broad engine change | alignment gate, regression, bounded sweep, engine matrix |
| live report translation | tiny imported fixture, readiness, then native query |

The generated test file rewrites its JSON snapshot. Do not run it simply to read
documentation. Coverage regeneration writes Markdown to `docs/alignment/coverage.md`
and keeps registry JSON in tests. The default sweep writes Markdown to
`docs/alignment/sweep-results.md` and keeps JSON in tests. Custom `--output`
prefixes still produce adjacent JSON and Markdown.

1.8.2 passed 335 alignment tests. Its bounded sweep completed 297 cells: 125
supported, 172 insufficient evidence, and no effect/contract failures. Separate
live comparisons measured imported data. See [the live report](live-report.md)
for exact scope; old no-live statements in the archive are historical.

Live checks are separately authorized. Follow [live validation](live-validation.md)
for isolation, query budgets, readiness, and retained artifacts. Never use a
pruning setup while evidence or deployment data is still needed.