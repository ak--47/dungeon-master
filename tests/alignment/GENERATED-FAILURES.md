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

## review correction: real standalone competitors and stronger evidence

The G1 section above is historical and preserved verbatim. Its organic-noise
claim was wrong: every fixture event appeared in a funnel, so automatic
strictness removed all of them from standalone selection. Browse, Search and
Help now explicitly set `isStrictEvent: false`. A fourth weighted competitor,
Background Activity, appears in no funnel. Observed Background Activity
counts are asserted in the baseline and every treatment/neutral arm.
The initial 0.5/0.9 rates, 1,500 users, seeds and acceptance bounds remain
unchanged. Both rates are sparse despite the old `dense` label for 0.9.

The historical statement that weak G1 was only plausibly budget-related is
superseded by the separate lifecycle executor's birth/usage-clock finding.
That executor owns the runtime repair. This executor changed no runtime
files and did not substitute a different retention denominator. Birth still
means observed First Entry; return still means elapsed bucket seven, with
complete follow-up and unique users. See LIFECYCLE-REPAIR.md for the runtime
contract. Sparse budgets can still limit observed return after that repair.

The old low-curve duplicate was a determinism check, not a neutral contrast.
It has been removed. Neutral retention now compares the independently drawn
target/control profile segments in the same low-curve output on day seven.
Each segment needs 100 eligible users. The high/low arms still each need
250 eligible users and mean lift >=0.10. No floor was reduced.

Every seed now needs the intended treatment direction and a positive
contrast against its neutral configuration. Neutral bands apply per seed,
so an average cannot hide an inverted seed or a bad neutral. Wilson 95%
intervals use unique-user conversion/retention counts. TTC reports per-user
mean and median seed ranges; these are descriptive ranges, not confidence
intervals. Three seeds do not establish universal power or full Cartesian
coverage. Source equivalence remains limited to the explicitly cited local
contracts, with no network or live-project comparison.

### intermediate evidence, retained for comparison

The first corrected-noise run recorded 17 passes and 3 reds before the full
direct-control set was added. Hook-TTC neutral ratios included 0.729930 and
0.707068, below the unchanged 0.75 band. Sparse retention had 246 eligible
users in one arm, below the unchanged 250 minimum. Its mean lift was
0.199496; the denominator failure remained red.

A later complete run, with concurrent lifecycle edits, recorded 25 passes
and 2 hook-TTC reds. Runtime start/end hashes differed, so those values
cannot isolate the effect of a runtime repair. Sparse retention mean lifts
were 0.149419 and 0.303977, with all eligible counts above 1,100. Hook-TTC
neutral ratios were [0.568121, 0.491002, 0.427335] at 0.5 and
[0.867960, 1.444807, 1.104655] at 0.9. The first set also had treatment
mean 0.123871 below the unchanged 0.15 lower bound. All these results remain
provisional until a stable-source run; current outcomes and hashes are in
generated-results.json.

All five new direct-control tests passed: eight condition operators against
generated profile subsets; sticky/context profile correlation; campaign
eligibility/stickiness/cap=2; selective world property mutation; and event
weights separated from property weights. Each used three seeds and asserted
nonempty affected and control populations. The input-only registry also
passed its 23-helper/6-pattern count and output-field exclusion checks.

The optional 5-events/user/day diagnostic retains both sparse acceptance
cases. It reports high/low retention, denominators, realized events and
standalone counts without granting acceptance from that rate. The recorded
concurrent-source run produced over 114,000 events per diagnostic arm and
over 19,000 standalone-only rows. Higher density is real observed traffic,
not a replacement for the sparse regression contract.

### stable-source confirmation

The final generated-only sandbox run completed with 25 passes and 2 reds
(27 tests including the optional density diagnostic). The recorded runtime
hashes were unchanged from start to end:

- user-loop.js: `9d4f3b204fca3db328814bbb1347a0b6842b5765bb48952687cfdf6131d3253c`
- funnels.js: `d0f2e58ca90ffc375f9fbeb35071f040db92484efcd43f4000dc7d961c32f783`

This run reproduced the later measurements above. G1 now passes both sparse
cases on the lifecycle executor's repaired runtime: mean lifts 0.149419 and
0.303977, with the original 0.10 floor and 250-user guard. Same-run neutral
segment mean differences are -0.021983 and 0.001806; all seed differences
meet the original neutral band. This does not establish literal 80%/20%
retention calibration.

G2 remains red: hook-TTC neutral ratios fail the unchanged [0.75, 1.30]
band at both rates. At 0.5 all three neutral seeds are below the band, and
mean treatment 0.123871 also misses [0.15, 0.40]. At 0.9 seed 43 is
1.444807, which the passing mean 1.139141 previously hid. Positive
treatment-versus-neutral direction alone does not rescue these failures.
No hook/runtime change or relaxed threshold was made here.

Baseline standalone-only counts are 1,769 / 1,743 / 1,827. Optional 5/day
retention lifts are 0.507044 / 0.485409 / 0.502741; each arm has
114,523-119,028 events and 19,614-20,418 standalone-only rows. These are
three-seed descriptive observations only.

The rebuilt registry has 321 entries for canonical inputs, presets and
hook exports, including 23 helpers and 6 patterns. Untested controls remain
explicit. Output-field inflation and repeated documentation entries were
removed; the entry count is not a tested-feature percentage.