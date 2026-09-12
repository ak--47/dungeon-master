# offline alignment checks

start with [REPORT.md](REPORT.md) for recorded results and open blockers.
[INVENTORY.md](INVENTORY.md) lists author controls and proof gaps.
[API-COMPATIBILITY.md](API-COMPATIBILITY.md) explains output changes and retained defaults.
[PR.md](PR.md) is the local review handoff. no GitHub PR has been opened here.

## run from the isolated worktree

use installed dependencies only. these commands install nothing and do not prune data/tmp.

```sh
cd /Users/ak/code/dungeon-master-alignment-work
set -o pipefail
node tests/alignment/run.mjs --preflight 2>&1 | tail -50
node tests/alignment/run.mjs 2>&1 | tail -50
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

## final gate remains pending

after the provenance repair, the main executor must run the no-mode gate above
and selected existing funnel regressions with a reviewed, committed, no-prune
configuration. the local repair config currently covers contracts plus eight old
unit files; it must be included in the reproducible handoff. keep OS network denial
and the bounded supervisor when integrating those checks.

record the exact final command, commit, test counts, and result in
[REPORT.md](REPORT.md). a completed sweep alone does not close this gate.