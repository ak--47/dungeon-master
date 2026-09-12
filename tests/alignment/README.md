# offline alignment checks

start with [REPORT.md](REPORT.md) for completed validation and remaining proof gaps.
[FINAL-VALIDATION.md](FINAL-VALIDATION.md) is the authoritative final run record.
[INVENTORY.md](INVENTORY.md) lists author controls and proof gaps.
[API-COMPATIBILITY.md](API-COMPATIBILITY.md) explains output changes and retained defaults.
[PR.md](PR.md) is the local review handoff. no GitHub PR has been opened here.

## run from the repository root

use installed dependencies only. these commands install nothing and do not prune data/tmp.
historical validation ran in `/Users/ak/code/dungeon-master-alignment-work`.
after the main executor moves the branch checkout, use the final path below.

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
the default sweep output replaces [sweep-results.json](sweep-results.json) and
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
[vitest.config.js](vitest.config.js) disables global setup and cleanup and uses
worktree-local cache storage. do not substitute the default suite or the run-dungeon
task; their setup can prune data/tmp.

## sandbox regression commands

[regression-vitest.config.js](regression-vitest.config.js), committed at `6df615e`,
selects all unit and integration tests with globals and no global setup or setup
files. the final run passed 1,838 tests with one existing skip across 93 files in
20.58s. it excludes E2E and standalone industry-generation runners.

```sh
cd /Users/ak/code/dungeon-master
set -o pipefail
sandbox-exec -p '(version 1) (allow default) (deny network*)' env NODE_ENV=test NODE_OPTIONS='' VSCODE_INSPECTOR_OPTIONS='' node node_modules/vitest/vitest.mjs run --config tests/alignment/regression-vitest.config.js 2>&1 | tail -50
```

[repair-vitest.config.js](repair-vitest.config.js) preserves the exact nine-file
selection behind historical 207/235-test evidence: alignment counting contracts
plus eight legacy unit files, with no global setup or setup files. this checkpoint
includes the existing file unchanged after sandboxed syntax validation. a rerun
uses current source, so those historical counts are not a promised result.

```sh
sandbox-exec -p '(version 1) (allow default) (deny network*)' env NODE_OPTIONS='' VSCODE_INSPECTOR_OPTIONS='' node node_modules/vitest/vitest.mjs run --config tests/alignment/repair-vitest.config.js 2>&1 | tail -50
```

these direct Vitest commands use serial forks and per-test timeouts. they do not
use the alignment runner's 600-second process-group deadline.

## final checks are complete within their recorded scope

clone repair `5e0caa5` passed 12 focused contracts. the main executor reported
175 gate tests passed across nine files in 60.65s. the post-repair sweep at
`6df615e`, saved in `fd112f8`, completed 297 cells with 77 stable source hashes:
125 supported and 172 insufficient-evidence, zero other verdicts. these results
do not prove all knobs or live analytics parity. [REPORT.md](REPORT.md) retains
exact results, historical failures, and proof gaps. this docs pass ran no tests.