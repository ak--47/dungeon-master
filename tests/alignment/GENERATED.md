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
one, except hook-TTC, predeclared at 3,000 users. Rates remain 0.5 and 0.9
events/user/day. Event targets are 22,500 and 40,500 for ordinary scenarios,
and 45,000 and 81,000 for hook-TTC. Realized volumes are lower.
The original 1,500-user hook-TTC case was underpowered for the unchanged
70-conversion guard; its counts and rates remain in GENERATED-FAILURES.md.
This is a descriptive denominator correction, not a universal power claim.
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
Seed pairing across different generation configs is not user-level common randomness.
The hook-TTC experiment below instead copies the same generated streams inside
one run and checks exact pairing.

## fixed bounds and reuse

[scenarios.mjs](scenarios.mjs) declares practical effect bounds and minimum
denominators before execution. The original bounds are unchanged. Means
weight the three seeds equally. Every seed must show the treatment direction
and beat its neutral config, so ignoring all treatment knobs cannot pass.
Every neutral seed must also meet its original band. For hook-TTC this applies
to the factor-1 intervention ratio, not raw random-cohort balance. Individual runs must
pass denominator, standalone-count and non-saturation guards. No scenario
is skipped based on observed data. Bounds are practical regression tolerances,
not fitted confidence intervals. The report adds 95% Wilson intervals for
unique-user conversion and retention. Repeated attempts do not count as
independent users in those intervals. TTC records each converted user's
mean completion time, then reports the mean and median across users and
their ranges across seeds. These ranges are descriptive, not TTC confidence
intervals. Report `meanHours` uses the arithmetic mean of integer-second
gap sums, rounded to the nearest second before conversion to hours, matching
the reader and merger. Per-user descriptive means retain the unrounded mean
of those integer-second gaps. Wilson intervals assume binomial user observations; they do not
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

Runner and sweep callers can independently pass `numUsers` to `runScenario`
or `runHookTtcPair`, or as the fifth argument to `scenarioConfig`. The third
argument to `makeFixture` also sets users. Every path scales `numEvents`
proportionally without changing the rate, seeds, competitors, or thresholds.
For example, `runHookTtcPair({ seed: 'sweep-001', numUsers: 1500 })` retains
the original small-N diagnostic. No runner or sweep implementation changed.
Results report `requestedUsersByScenario`, summary/seed `requestedUsers`,
and `directControlUsers`; absent-hook controls report their actual 3,000 users.
There is no global 1,500-user claim. The sizing test covers both rates and
treatment states for every scenario, including independent 1,800-user overrides.

## G2 paired intervention contract

`runScenario` keeps its argument and return shape. For `id: 'hook-ttc'`, it
adds the fields below. `ttcRatio` remains the raw target/control ratio.
Other scenarios retain their original effect statistics. No engine API changes.

| field | exact meaning |
|---|---|
| `baselineTtcRatio` | R_before = target/control report mean TTC on the full untouched stream |
| `baselineAdjustedTtcRatio` | Q = R_emitted / R_before for treatment; R_factor1 / R_before when `treatment: false` |
| `interventionNeutralTtcRatio` | N = R_factor1 / R_before, asserted exactly 1 |
| `pairing` | checked event counts, converted counts, exact identity/membership/anchor/control flags, timestamp bounds, session relabel count |

Sweep executors must use `baselineAdjustedTtcRatio` for hook-TTC's unchanged
positive band `[0.15, 0.40]`. Use `interventionNeutralTtcRatio` for the unchanged
neutral band `[0.75, 1.30]`. The generated proof requires N exactly 1 and Q
inside the positive band per seed, as well as the equal-weight three-seed mean.
Raw treatment `ttcRatio < 1` remains required for every seed. Baseline random
cohort imbalance is reported without a balance acceptance condition.

For both arms from one generation, use the additive test-harness export:

```js
import { runHookTtcPair } from './scenarios.mjs';
const { baseline, treatment, neutral } = await runHookTtcPair({
	seed: 'sweep-001', strength: 'mixed', reports: REPORTS,
});
const effect = treatment.baselineAdjustedTtcRatio;
const noOpEffect = neutral.interventionNeutralTtcRatio;
```

`runHookTtcPair` generates the complete original mixed fixture once per seed
and rate. Inside the actual `everything` hook it copies every record before
mutation, applies factor 1 to another deep copy, then applies factor 0.25 to
the actual treatment records. It captures the post-hook records and measures
the emitted final treatment. Copies consume no RNG; the TTC helper consumes
no RNG. `treatment: false` runs the same paired capture with factor 1 on the
actual stream. Independent calls to `runScenario` still generate independently;
use `runHookTtcPair` to share one full realization.

Assertions compare exact insert IDs, all matched step IDs, completed/drop-off
membership and entry anchors. Factor 1 preserves the complete records exactly.
Control records preserve every field, including session IDs. The treatment
hook changes only timestamps. Final storage preserves every captured field
except `session_id`, which the engine re-derives after time changes; the report
counts those relabels. This unique-user report does not partition by session.
Every arm must retain the complete original event count and ID set, and all
timestamps must lie inside the pinned window. Future clipping therefore fails
the test instead of silently changing completion membership.

Separate absent-hook and factor-1 runs compare all profiles and all final event
records in order, excluding only independently generated UUID `insert_id`s.
Their measured Q must equal 1 and exceed the positive band's 0.40 ceiling.
This tests hook removal through the actual generation pipeline. The paired
within-run assertions compare exact UUIDs without excluding them.

`scenarioConfig` and `measureScenario` remain available for raw measurements.
They do not reconstruct lost pre-hook records or fabricate paired fields.
Use `runScenario` or `runHookTtcPair` when the sweep needs the paired fields.

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
documents retained red findings. Test completion rewrites `generated-results.json`,
including on failure. It no longer rewrites the separately owned coverage artifacts.
Start/end hashes cover the entrypoint, lifecycle, generators, TTC helper,
timing helper, funnel evaluator, fixtures, and the three generated harness files.
The run also asserts identical hashes and records `stableSource`.