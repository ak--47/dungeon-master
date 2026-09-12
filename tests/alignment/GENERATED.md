# generated alignment slice

Run only from the isolated alignment worktree with installed dependencies:

```sh
set -o pipefail
sandbox-exec -p '(version 1) (allow default) (deny network*)' node node_modules/vitest/vitest.mjs run --config tests/alignment/vitest.config.js tests/alignment/generated.test.js 2>&1 | tail -50
```

No default suite, global setup, install, import, network call, or data/tmp prune.
The existing runner owns build/preflight/full-gate orchestration. This command
validates only this slice. Generation uses empty credentials and memory output.

## fixture and counting contract

Each fresh config generates 1,500 users over January 2025 in UTC, concurrency
one. Rates are 0.5 and 0.9 events/user/day. The explicit event targets are 22,500
and 40,500; born-in lifetimes and scheduling mean realized volumes are lower.
The fixture keeps Browse/Search/Help traffic, a competing usage funnel, and
repeated usage entries after the primary first funnel. Repeat attempts here
mean naturally repeated usage-funnel passes. The `attempts.min/max` retry knob
and anonymous identity stitching remain gaps.

First-funnel cohorts calibrate conversion without unique-user saturation.
The TTC hook operates on the repeated usage funnel amid competing traffic.
The public evaluator receives caller-owned report steps, count mode, reentry,
grace, and window options from [scenarios.mjs](scenarios.mjs), independent of
generation config. Unique-user reports and totals/reentry reports are retained
separately. The entry-delimited counter in [measures.mjs](measures.mjs) is a
diagnostic; it does not claim Mixpanel per-attempt semantics.

Experiment conversion uses `$experiment_started` entrants, filtered to the
named experiment, and profile-stamped sticky variants. TTC uses exposure to
outcome. Denominators are entrants, never raw outcome counts or all profiles.
World tests include both no-op/absent-world affected-event count ratios and
unaffected Search count ratios. Each neutral uses the same statistic and seeds
as its associated effect. Seed pairing is not user-level common randomness.

## fixed bounds and reuse

[scenarios.mjs](scenarios.mjs) declares practical effect bounds and minimum
denominators before execution. Means weight the three seeds equally. Each
individual run must pass denominator and non-saturation guards. No scenario
is skipped based on observed data. Bounds are practical regression tolerances,
not fitted confidence intervals. Per-seed observations remain in the report.

```js
import { runScenario, scenarioConfig, measureScenario, REPORTS } from './scenarios.mjs';
import { runFixture } from './fixtures.mjs';

const measured = await runScenario({ id: 'conditions', seed: 'sweep-001', strength: 'dense', treatment: true, reports: REPORTS });
const config = scenarioConfig('persona-volume', 'sweep-001', 'mixed', true);
const sample = await runFixture(config);
const customMeasurement = measureScenario('persona-volume', sample, REPORTS);
```

Execute reuse code under the same OS sandbox. The API does not enforce the
sandbox itself. The existing runner owns the overall deadline; the observed
generated-only run takes about 30 seconds. Individual tests have a 90-second
timeout. No claim is made that a slow machine must finish the full matrix in 90s.

[coverage.json](coverage.json) records declared types, public exports, and doc
table controls. [COVERAGE.md](COVERAGE.md) explains its conservative classes.
Inventory size is not proof completeness. [GENERATED-FAILURES.md](GENERATED-FAILURES.md)
documents retained red findings. Test completion rewrites only this slice's
coverage and result artifacts, including on failure.