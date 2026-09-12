# generated proof findings

## G1: day-seven retention misses the practical lift floor

Status: evidenced red. Both noise strengths fail the predeclared 0.10 absolute
lift floor. No engine repair, threshold reduction, skip, or expected-failure
annotation belongs to this slice.

| noise | high-curve retained / eligible by seed | low-curve retained / eligible by seed | mean lift |
|---|---|---|---|
| mixed, 0.5 events/user/day | 22/257, 12/265, 23/285 | 11/375, 12/387, 5/372 | 0.045935 |
| dense, 0.9 events/user/day | 34/282, 32/262, 31/292 | 11/378, 12/356, 18/382 | 0.079647 |

Seeds, in table order: `alignment-generated-17`, `alignment-generated-43`,
`alignment-generated-89`. Each run has 1,500 users, 30 days, UTC, and concurrency
one. The original 600-user probe failed denominator guards; increasing to 1,500
fixed those guards without changing the effect bounds.

The high linear curve requests day1=0.9, day7=0.8, day14=0.7, day30=0.6.
The low curve requests day1=0.4, day7=0.2, day14=0.1, day30=0.05.
All six seed contrasts are positive. The result supports weak directional
ordering at these budgets, but does not pass the requested practical threshold
or establish literal 80%/20% retention calibration.

### report specification

Birth is the first `First Entry` event, identified by `user_id`. Return is any
event in elapsed bucket seven: `[birth + 7 days, birth + 8 days)`. Only births
with the complete bucket visible before the pinned dataset end enter the
denominator. This excludes right-censored users, with a minimum 250 eligible
users in every treatment and neutral run. Each user counts at most once.
No calendar alignment, unbounded carry, session partition, or profile-created
timestamp substitutes for the birth event.

The neutral control repeats the low curve through an independently constructed
config and measures the same retention statistic. Its paired mean difference
is zero. Same seed across different configs does not guarantee user-level
common randomness. The high/low eligible cohorts differ and are reported.

### source evidence, read offline

Local analytics revision: `717286d2d3ed03e9e3f9cb4346e4c6b2e561fb9a`.
`backend/arb/reader/queries/retention_query.cpp:1120` requires return after birth.
The current bucket calculation is at line 1259, subtracting aligned birth time
from return time before `time_duration_buckets_get_bucket`. With calendar
alignment off, this is elapsed-time bucketing. The saved source has moved since
the older line numbers in [HOOKS.md](../../HOOKS.md#L454).

The generator's `buildActiveDayPlan` in
[user-loop.js](../../lib/orchestrators/user-loop.js#L1154) selects weighted UTC
days, derives a target day count from the curve, and allocates a finite event
budget across them. If events are fewer than selected days, some days get zero.
This is a plausible explanation for weak realized retention at sparse budgets.
It is not a proven runtime defect or a reason to change report semantics.

### preserved passing comparisons

The other 17 tests passed in the observed run. Conditions show +45.6 to +46.2
points. Persona conversion shows +30.5 to +31.9 points, TTC about 0.249x, and
volume 2.94 to 3.09x. Experiment exposure-normalized conversion shows +31.9 to
+33.9 points, with its TTC bounds passing. Weighted common values realize
80.3% to 80.5%. World amplification realizes 2.65 to 3.39x, with unaffected
Search volume 0.90 to 1.13x. The usage-funnel TTC hook realizes 0.217 to 0.258x.

These are means across three seeds for each noise strength, not confidence
intervals or a full parameter-space guarantee. See
[generated-results.json](generated-results.json) for per-seed counts and test
outcomes. The generated gate intentionally exits nonzero while G1 remains red.