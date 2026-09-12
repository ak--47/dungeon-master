# Offline alignment gate

Run from the isolated alignment worktree. Use installed dependencies only.

```sh
set -o pipefail
node tests/alignment/run.mjs --preflight 2>&1 | tail -50
node tests/alignment/run.mjs 2>&1 | tail -50
```

The runner runs the build gate (`tsconfig.build.json`, no emit), then the
offline preflight, then the serial regression gate. `--preflight` stops after
the first two stages. The installed TypeScript major version controls whether
the TS6 deprecation flag is needed. No install or default Vitest suite runs.

Every build/test stage executes under `/usr/bin/sandbox-exec -p
'(version 1) (allow default) (deny network*)'`. The runner itself is a supervisor;
the OS policy covers each test process and its descendants. The preflight
requires EPERM/EACCES for both local TCP bind and local TCP connect. ECONNREFUSED,
timeouts, and successful connections fail. It uses no external address.
Only macOS is supported; other platforms fail closed. Network denial is not a
filesystem sandbox. The dedicated configuration has no global setup or cleanup.
Its cache location is local to this worktree, not the shared node_modules link.

The single 600-second deadline covers build, preflight, regression, and any
future sweep. `--timeout-ms=N` can lower it, never raise it. The supervisor kills
the active detached process group with SIGKILL when time expires (exit 124),
including a blocked worker. SIGINT/SIGTERM also kill that group. The infrastructure
test exercises a deadline during build, not a future generation worker.

`--sweep` first requires the regression gate to pass, then selects only
`*.sweep.test.js`. No sweep fixtures exist in this execution slice; requesting
a sweep after a green gate therefore fails on empty collection. Do not run it yet.

The normal Vitest configuration excludes this directory. Importing that config
in the infrastructure test only inspects it; it never invokes its global setup.
The normal suite's data/tmp pruning is not part of this harness.