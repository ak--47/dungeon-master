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
Both rates are sparse. The legacy label `dense` means 0.9 only. It does not
claim high density. Browse/Search/Help explicitly set `isStrictEvent: false`.
Background Activity has weight 5 and appears in no funnel. Its observed count
proves standalone generation, with at least 100 rows in each scenario arm
and over 300 in each baseline seed. These four event types compete in the
standalone pool; all three original funnels remain competitors too.

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
unaffected Search count ratios. Retention uses elapsed day seven from the
observed First Entry and excludes right-censored births. High-minus-low
retention still requires 0.10 mean lift and 250 eligible users per arm.
The retention neutral compares target and control profile segments within
the same low-curve run on day seven, with at least 100 eligible users per
segment. A repeated identical low-curve config is no longer neutral evidence.
Seed pairing is not user-level common randomness.

## fixed bounds and reuse

[scenarios.mjs](scenarios.mjs) declares practical effect bounds and minimum
denominators before execution. The original bounds are unchanged. Means
weight the three seeds equally. Every seed must show the treatment direction
and beat its neutral config, so ignoring all treatment knobs cannot pass.
Every neutral seed must also meet its original band. Individual runs must
pass denominator, standalone-count and non-saturation guards. No scenario
is skipped based on observed data. Bounds are practical regression tolerances,
not fitted confidence intervals. The report adds 95% Wilson intervals for
unique-user conversion and retention. Repeated attempts do not count as
independent users in those intervals. TTC records each converted user's
mean completion time, then reports the mean and median across users and
their ranges across seeds. These ranges are descriptive, not TTC confidence
intervals. Wilson intervals assume binomial user observations; they do not
establish literal engine probabilities or universal statistical power.

Three seeds are too few to infer universal statistical power. This is a
descriptive regression matrix, not full Cartesian coverage. Runtime hashes
at run start/end expose concurrent source changes. Unequal hashes require
a stable-source rerun before attributing an effect to a runtime repair.

## direct controls and optional density

Direct proofs cover all eight condition operators against independently
filtered generated profile sets; sticky event/profile correlation alongside
context functions; campaign eligibility, five-field stickiness and cap=2;
world property selectivity with an unchanged property; and standalone event
weights independently of Browse's 80/20 property weights. Each runs three
seeds with populated output. Other values, boundaries and interactions
remain untested.

Prefix the sandbox command with `ALIGNMENT_DENSITY_DIAGNOSTIC=1` to add the
5-events/user/day retention diagnostic. It records high/low retention,
denominators and realized counts in `controls`, and requires over 1,000
standalone rows per arm. Its effect is diagnostic only. It does not replace
either sparse acceptance case or lower the 0.10 floor.

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

[coverage.json](coverage.json) records canonical author inputs, named presets
and all 29 hook exports, grouped like [INVENTORY.md](INVENTORY.md). Output
types, resolved fields, hook metadata and duplicate documentation mentions
are excluded. Untested inputs and source limits remain explicit.
[COVERAGE.md](COVERAGE.md) separates proof classes from current outcomes.
Inventory size is not proof completeness. [GENERATED-FAILURES.md](GENERATED-FAILURES.md)
documents retained red findings. Test completion rewrites only this slice's
coverage and result artifacts, including on failure.